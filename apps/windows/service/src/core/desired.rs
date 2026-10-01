use crate::core::auth::{AuthenticatedOwner, hash_session_token};
use crate::core::logger::set_or_update_writer;
use crate::core::manager::CORE_MANAGER;
use crate::core::paths::service_paths;
use crate::core::state::set_core_lifecycle_state;
use crate::{ClashConfig, OwnerIdentity, ServiceLifecycleState, WriterConfig};
use anyhow::{Context, Result};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tracing::{info, warn};

static DESIRED_STATE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DesiredState {
    pub core_should_be_running: bool,
    pub last_clash_config: Option<ClashConfig>,
    pub last_writer_config: Option<WriterConfig>,
    pub generation: u64,
    pub updated_at: u64,
    /// The boot that recorded the run intent (`boot_session::current`). A Windows Service start
    /// replays the intent only in that same boot; a missing value never matches (BRICK-W1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boot_session: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveOwnerState {
    pub owner_key: String,
    pub identity: OwnerIdentity,
    pub app_data_root: String,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub session_token_hash: String,
}

#[cfg(test)]
impl From<&AuthenticatedOwner> for ActiveOwnerState {
    fn from(owner: &AuthenticatedOwner) -> Self {
        Self {
            owner_key: owner.key.clone(),
            identity: owner.identity.clone(),
            app_data_root: owner.app_data_root.to_string_lossy().into_owned(),
            generation: 0,
            session_token_hash: String::new(),
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OwnerGenerationState {
    generation: u64,
}

pub async fn load_owner_desired_state(owner_key: &str) -> Result<DesiredState> {
    let path = service_paths()
        .for_owner_key(owner_key)
        .desired_state_path();
    read_json_or_default(&path).await
}

pub async fn persist_owner_core_started(
    owner: &AuthenticatedOwner,
    config: &ClashConfig,
) -> Result<DesiredState> {
    update_owner_desired_state(&owner.key, |state| {
        state.core_should_be_running = true;
        state.last_clash_config = Some(config.clone());
        state.last_writer_config = Some(config.log_config.clone());
        state.boot_session = crate::core::boot_session::current();
    })
    .await
}

pub async fn persist_owner_core_stopped(owner: &AuthenticatedOwner) -> Result<DesiredState> {
    persist_owner_core_stopped_by_key(&owner.key).await
}

pub async fn persist_owner_core_stopped_by_key(owner_key: &str) -> Result<DesiredState> {
    update_owner_desired_state(owner_key, |state| {
        state.core_should_be_running = false;
    })
    .await
}

pub async fn persist_owner_writer_config(
    owner: &AuthenticatedOwner,
    config: &WriterConfig,
) -> Result<DesiredState> {
    update_owner_desired_state(&owner.key, |state| {
        state.last_writer_config = Some(config.clone());
        if let Some(clash_config) = state.last_clash_config.as_mut() {
            clash_config.log_config = config.clone();
        }
    })
    .await
}

pub async fn load_active_owner() -> Result<Option<ActiveOwnerState>> {
    let path = service_paths().active_owner_path();
    // Deliberately no `secure_state_file_if_exists` here. Hardening a descriptor is a write, and
    // doing it on the read path made every reader — /status at a 2s cadence, StartClash, release
    // — depend on being able to take `WRITE_DAC | WRITE_OWNER` and on the file's owner still
    // being SYSTEM or Administrators. A backup/restore, a `takeown`, or an AV handle held without
    // sharing therefore bricked release permanently. The write path still hardens every file it
    // creates, which is where the guarantee actually comes from.
    match tokio::fs::read(&path).await {
        Ok(content) => match serde_json::from_slice(&content) {
            Ok(state) => Ok(Some(state)),
            Err(error) => {
                // A record that cannot be parsed will never parse: it names no provable owner,
                // which is exactly the state in which an owner-gated release is allowed to
                // proceed. Keep the bytes for diagnosis and continue as if there were none.
                quarantine_unusable_state(&path, &format!("could not be parsed: {error}")).await;
                Ok(None)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("failed to read active owner {path:?}")),
    }
}

/// Move a state file that can never be read again out of the way, best-effort.
///
/// Only permanent damage gets here — a file whose bytes do not parse. A transient read failure is
/// still reported to the caller, because destroying a live owner record on a passing sharing
/// violation would itself end a healthy session. Failure to quarantine is not fatal: the caller
/// has already decided to continue without the record, and the next writer replaces it anyway.
async fn quarantine_unusable_state(path: &std::path::Path, reason: &str) {
    let quarantined = path.with_extension(format!("json.corrupt.{}", unix_timestamp_secs()));
    match tokio::fs::rename(path, &quarantined).await {
        Ok(()) => warn!(
            "State file {path:?} {reason}; quarantined as {quarantined:?} and treated as absent"
        ),
        Err(error) => warn!(
            "State file {path:?} {reason} and could not be quarantined ({error}); treated as absent"
        ),
    }
}

#[cfg(test)]
pub async fn persist_active_owner(owner: &AuthenticatedOwner) -> Result<ActiveOwnerState> {
    let _guard = DESIRED_STATE_LOCK.lock().await;
    let state = ActiveOwnerState::from(owner);
    write_json_atomic(&service_paths().active_owner_path(), &state).await?;
    Ok(state)
}

pub async fn commit_active_owner_session(
    owner: &AuthenticatedOwner,
    session_token: &str,
) -> Result<ActiveOwnerState> {
    let session_token_hash = hash_session_token(session_token)?;
    let _guard = DESIRED_STATE_LOCK.lock().await;
    let paths = service_paths();
    let generation_path = paths.owner_generation_path();
    let mut generation_state: OwnerGenerationState = read_json_or_default(&generation_path).await?;
    generation_state.generation = generation_state.generation.saturating_add(1);
    write_json_atomic(&generation_path, &generation_state).await?;

    let state = ActiveOwnerState {
        owner_key: owner.key.clone(),
        identity: owner.identity.clone(),
        app_data_root: owner.app_data_root.to_string_lossy().into_owned(),
        generation: generation_state.generation,
        session_token_hash,
    };
    write_json_atomic(&paths.active_owner_path(), &state).await?;
    Ok(state)
}

pub async fn clear_active_owner() -> Result<()> {
    let _guard = DESIRED_STATE_LOCK.lock().await;
    let path = service_paths().active_owner_path();
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to remove active owner {path:?}")),
    }
}

/// Retire a stale unverified startup intent only when no other owner has taken over.
///
/// `true` means it is safe for the caller to remove the old owner's machine-wide protection:
/// there was no active owner, or the matching owner's desired run state was durably stopped and
/// its active record cleared. `false` means a different owner is active; opening WFP in that
/// ambiguous state would be unsafe.
pub(crate) async fn retire_owner_if_active(owner_key: &str) -> Result<bool> {
    let Some(active_owner) = load_active_owner().await? else {
        return Ok(true);
    };
    if active_owner.owner_key != owner_key {
        return Ok(false);
    }
    persist_owner_core_stopped_by_key(owner_key).await?;
    clear_active_owner().await?;
    Ok(true)
}

/// Retire whichever owner a legacy machine-wide protection record was paired with. Records from
/// before `owner_key` cannot prove an association, but startup runs before IPC accepts a new owner;
/// leaving the old desired state runnable after removing WFP would let a later Service restart
/// resurrect an unprotected Core.
pub(crate) async fn retire_legacy_active_owner() -> Result<()> {
    let Some(active_owner) = load_active_owner().await? else {
        return Ok(());
    };
    persist_owner_core_stopped_by_key(&active_owner.owner_key).await?;
    clear_active_owner().await
}

/// Restores persisted state and reports whether a core was successfully started.
pub async fn restore_desired_state() -> Result<bool> {
    backup_legacy_desired_states().await;

    let Some(active_owner) = load_active_owner().await? else {
        info!("No active owner to restore");
        return Ok(false);
    };
    let state = load_owner_desired_state(&active_owner.owner_key).await?;

    if let Some(writer_config) = state.last_writer_config.as_ref()
        && let Err(error) = set_or_update_writer(writer_config).await
    {
        warn!("Failed to restore writer config: {}", error);
    }

    if !state.core_should_be_running {
        info!("Desired state does not require core restore");
        return Ok(false);
    }

    // BRICK-W1. Neither hold rewrites the intent: the barrier stays as its own intent restored
    // it, and the user's next Connect replaces the run intent.
    #[cfg(windows)]
    {
        let current = crate::core::boot_session::current();
        if !recorded_in_this_boot(state.boot_session.as_deref(), current.as_deref()) {
            warn!(
                "Desired state asks for a Core, but its run intent was not recorded in this boot \
                 (recorded {:?}, current {current:?}); holding it until the user connects",
                state.boot_session
            );
            return Ok(false);
        }
        // A Windows StartClash always arms WFP, so a legitimate run intent always comes with a
        // wanted barrier, restored before this runs. One without it outlived a release that did
        // not retire it, such as the emergency disarm.
        if !crate::core::windows_kill_switch::status().await.wanted {
            warn!(
                "Desired state asks for a Core, but no wanted barrier was restored; a run intent \
                 without a restored barrier is not replayed"
            );
            return Ok(false);
        }
    }

    let Some(config) = state.last_clash_config else {
        warn!("Desired state requests core restore but has no ClashConfig");
        return Ok(false);
    };

    info!(
        "Restoring core from desired state generation {}",
        state.generation
    );
    if let Err(error) = CORE_MANAGER
        .lock()
        .await
        .start_core(config, active_owner.identity.clone())
        .await
    {
        // core 路径不存在通常表示 desired-state 已过期；清掉运行意图，避免重启时反复重试。
        // 其它失败保留意图并交给上层记录。
        if is_not_found_error(&error) {
            warn!(
                "Core binary not found while restoring desired state (stale/translocated path?); \
                 clearing desired core-run state to stop retrying: {error:#}"
            );
            if let Err(clear_error) =
                persist_owner_core_stopped_by_key(&active_owner.owner_key).await
            {
                warn!(
                    "Failed to clear stale desired state after not-found core path: {clear_error:#}"
                );
            }
            set_core_lifecycle_state(ServiceLifecycleState::Running);
            return Ok(false);
        }
        set_core_lifecycle_state(ServiceLifecycleState::Fatal);
        return Err(error);
    }
    Ok(true)
}

/// Whether this Service start will try to start Core.
///
/// A crash reboot does not: the run intent's boot session does not match (BRICK-W1),
/// so the kill switch must not sit on a block waiting for a process that will not appear.
pub(crate) async fn core_replay_expected_this_boot() -> bool {
    let Ok(Some(active_owner)) = load_active_owner().await else {
        return false;
    };
    let Ok(state) = load_owner_desired_state(&active_owner.owner_key).await else {
        return false;
    };
    if !state.core_should_be_running || state.last_clash_config.is_none() {
        return false;
    }
    #[cfg(windows)]
    {
        let current = crate::core::boot_session::current();
        if !recorded_in_this_boot(state.boot_session.as_deref(), current.as_deref()) {
            return false;
        }
    }
    true
}

/// Both markers present and equal. An unknown current boot or an intent recorded before this
/// field existed reads as another boot.
#[cfg(windows)]
fn recorded_in_this_boot(recorded: Option<&str>, current: Option<&str>) -> bool {
    matches!((recorded, current), (Some(recorded), Some(current)) if recorded == current)
}

/// 判断错误链中是否包含 NotFound I/O 错误，用于识别失效的 core 路径。
fn is_not_found_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io_error| io_error.kind() == std::io::ErrorKind::NotFound)
    })
}

async fn backup_legacy_desired_states() {
    let legacy_files = vec![service_paths().desired_state_path().to_path_buf()];
    #[cfg(target_os = "macos")]
    let legacy_files = legacy_files
        .into_iter()
        .chain([
            std::path::PathBuf::from("/var/lib/clash-verge-service/desired-state.json"),
            std::path::PathBuf::from(
                "/var/root/.local/state/clash-verge-service/desired-state.json",
            ),
        ])
        .collect::<Vec<_>>();

    for legacy in legacy_files {
        match backup_legacy_state_file(&legacy).await {
            Ok(Some(backup)) => info!(
                "Backed up legacy desired-state {:?} -> {:?}",
                legacy, backup
            ),
            Ok(None) => {}
            Err(error) => warn!(
                "Failed to back up legacy desired-state {:?}: {}",
                legacy, error
            ),
        }
    }
}

async fn backup_legacy_state_file(path: &std::path::Path) -> Result<Option<std::path::PathBuf>> {
    match tokio::fs::try_exists(path).await {
        Ok(false) => return Ok(None),
        Ok(true) => {}
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect legacy state {path:?}"));
        }
    }

    let backup = path.with_extension("json.legacy.bak");
    tokio::fs::rename(path, &backup)
        .await
        .with_context(|| format!("failed to back up legacy state {path:?} to {backup:?}"))?;
    Ok(Some(backup))
}

async fn update_owner_desired_state(
    owner_key: &str,
    update: impl FnOnce(&mut DesiredState),
) -> Result<DesiredState> {
    let _guard = DESIRED_STATE_LOCK.lock().await;
    let path = service_paths()
        .for_owner_key(owner_key)
        .desired_state_path();
    let mut state = read_json_or_default(&path).await?;
    update(&mut state);
    state.generation = state.generation.saturating_add(1);
    state.updated_at = unix_timestamp_secs();
    write_json_atomic(&path, &state).await?;
    Ok(state)
}

async fn read_json_or_default<T>(path: &std::path::Path) -> Result<T>
where
    T: for<'de> Deserialize<'de> + Default,
{
    // As in `load_active_owner`: reading must not require permission to rewrite the descriptor.
    match tokio::fs::read(path).await {
        Ok(content) => match serde_json::from_slice(&content) {
            Ok(state) => Ok(state),
            Err(error) => {
                // Same treatment as a missing file, which is what unparseable bytes amount to.
                // Left in place it made the first Disconnect report that the Core could not be
                // retired — a failure the user cannot act on and that a second click hid.
                quarantine_unusable_state(path, &format!("could not be parsed: {error}")).await;
                Ok(T::default())
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error).with_context(|| format!("failed to read state {path:?}")),
    }
}

async fn write_json_atomic<T>(path: &std::path::Path, value: &T) -> Result<()>
where
    T: Serialize,
{
    crate::core::paths::ensure_persistent_state_layout()?;
    if let Some(parent) = path.parent() {
        crate::core::platform_security::ensure_private_service_directory(parent)?;
    }

    let temp_path = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(value)?;
    // Flush the *data* before the rename. `MOVEFILE_WRITE_THROUGH` commits the directory entry,
    // not the file contents, so power loss just after the rename could otherwise leave a
    // zero-length ownership record — the corrupt file the read path now has to recover from.
    // Same order as `core::runtime`: write_all, flush, sync_all, then replace.
    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .with_context(|| format!("failed to create state temp file {temp_path:?}"))?;
    tokio::io::AsyncWriteExt::write_all(&mut file, &json)
        .await
        .with_context(|| format!("failed to write state temp file {temp_path:?}"))?;
    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    file.sync_all()
        .await
        .with_context(|| format!("failed to flush state temp file {temp_path:?}"))?;
    drop(file);
    secure_state_file_if_exists(&temp_path)?;
    crate::core::atomic_file::replace(&temp_path, path)
        .await
        .with_context(|| format!("failed to move state into {path:?}"))?;
    secure_state_file_if_exists(path)?;

    Ok(())
}

fn secure_state_file_if_exists(path: &std::path::Path) -> Result<()> {
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    Ok(())
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod owner_tests {
    use super::{
        backup_legacy_state_file, clear_active_owner, commit_active_owner_session,
        load_active_owner, load_owner_desired_state, persist_active_owner,
        persist_owner_core_started, persist_owner_core_stopped, write_json_atomic,
    };
    use crate::core::auth::AuthenticatedOwner;
    use crate::{ClashConfig, CoreConfig, OwnerIdentity};
    use serial_test::serial;

    fn test_owner(uid: u32) -> AuthenticatedOwner {
        AuthenticatedOwner {
            key: uid.to_string(),
            identity: OwnerIdentity::Unix { uid, gid: 20 },
            app_data_root: std::env::temp_dir(),
            peer_pid: None,
            peer_session_id: None,
        }
    }

    #[tokio::test]
    async fn desired_state_is_scoped_by_owner_key() -> anyhow::Result<()> {
        let owner_a = test_owner(90_001);
        let owner_b = test_owner(90_002);
        let config = ClashConfig {
            core_config: CoreConfig {
                core_path: "/tmp/mock-core-a".to_string(),
                ..Default::default()
            },
            log_config: Default::default(),
        };

        persist_owner_core_started(&owner_a, &config).await?;
        persist_owner_core_stopped(&owner_b).await?;

        assert!(
            load_owner_desired_state(&owner_a.key)
                .await?
                .core_should_be_running
        );
        assert!(
            !load_owner_desired_state(&owner_b.key)
                .await?
                .core_should_be_running
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn active_owner_can_be_atomically_replaced_and_cleared() -> anyhow::Result<()> {
        let owner_a = test_owner(90_003);
        let owner_b = test_owner(90_004);

        persist_active_owner(&owner_a).await?;
        assert_eq!(
            load_active_owner()
                .await?
                .as_ref()
                .map(|state| state.owner_key.as_str()),
            Some("90003")
        );

        persist_active_owner(&owner_b).await?;
        assert_eq!(
            load_active_owner()
                .await?
                .as_ref()
                .map(|state| state.owner_key.as_str()),
            Some("90004")
        );

        clear_active_owner().await?;
        assert!(load_active_owner().await?.is_none());
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn owner_generation_survives_active_owner_clear() -> anyhow::Result<()> {
        clear_active_owner().await?;
        let owner = test_owner(90_005);
        let first_token = "33".repeat(32);
        let first = commit_active_owner_session(&owner, &first_token).await?;

        assert_ne!(first.session_token_hash, first_token);
        assert!(
            !tokio::fs::read_to_string(crate::service_paths().active_owner_path())
                .await?
                .contains(&first_token)
        );

        clear_active_owner().await?;
        let second = commit_active_owner_session(&owner, &"44".repeat(32)).await?;

        assert!(second.generation > first.generation);
        clear_active_owner().await?;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn legacy_active_owner_defaults_session_fields() -> anyhow::Result<()> {
        clear_active_owner().await?;
        let owner = test_owner(90_006);
        let legacy_state = serde_json::json!({
            "owner_key": owner.key,
            "identity": owner.identity,
            "app_data_root": owner.app_data_root.to_string_lossy(),
        });
        write_json_atomic(&crate::service_paths().active_owner_path(), &legacy_state).await?;

        let active = load_active_owner()
            .await?
            .expect("legacy owner should load");

        assert_eq!(active.generation, 0);
        assert!(active.session_token_hash.is_empty());
        clear_active_owner().await?;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn session_commit_rejects_non_lowercase_hex_tokens() -> anyhow::Result<()> {
        clear_active_owner().await?;
        let owner = test_owner(90_007);

        for invalid in ["55".repeat(31), "AA".repeat(32), "gg".repeat(32)] {
            assert!(commit_active_owner_session(&owner, &invalid).await.is_err());
        }
        assert!(load_active_owner().await?.is_none());
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn a_corrupt_active_owner_record_is_quarantined_rather_than_refusing_forever()
    -> anyhow::Result<()> {
        clear_active_owner().await?;
        let owner = test_owner(90_008);
        commit_active_owner_session(&owner, &"77".repeat(32)).await?;
        let path = crate::service_paths().active_owner_path();
        tokio::fs::write(&path, b"{ not json at all").await?;

        // No provable owner, rather than an error every retry reproduces.
        assert!(load_active_owner().await?.is_none());
        assert!(!path.exists());

        let directory = path.parent().expect("state path has a parent");
        let mut quarantined = Vec::new();
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("active-owner.json.corrupt.")
            {
                quarantined.push(entry.path());
            }
        }
        assert_eq!(quarantined.len(), 1, "the bytes must be kept for diagnosis");
        for path in quarantined {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    /// A run intent as `persist_owner_core_started` leaves it, recorded in `boot_session`. The
    /// Core path does not exist, so a replay cannot succeed quietly.
    #[cfg(windows)]
    async fn seed_run_intent(owner: &AuthenticatedOwner, boot_session: &str) -> anyhow::Result<()> {
        persist_active_owner(owner).await?;
        let mut intent = serde_json::to_value(super::DesiredState {
            core_should_be_running: true,
            last_clash_config: Some(ClashConfig {
                core_config: CoreConfig {
                    core_path: r"C:\tono-missing\tono-core.exe".to_string(),
                    ..Default::default()
                },
                log_config: Default::default(),
            }),
            ..Default::default()
        })?;
        intent["boot_session"] = serde_json::json!(boot_session);
        write_json_atomic(
            &crate::service_paths()
                .for_owner_key(&owner.key)
                .desired_state_path(),
            &intent,
        )
        .await
    }

    #[cfg(windows)]
    async fn disarm_kill_switch() {
        let _ = crate::core::windows_kill_switch::emergency_disarm_windows_kill_switch().await;
    }

    /// BRICK-W1: after a crash, a BSOD or a power loss the Service started the recorded Core
    /// before anyone signed in. A run intent from an earlier boot is held and nothing is
    /// rewritten. A wanted barrier is armed first, so only the boot check can hold.
    #[cfg(windows)]
    #[tokio::test]
    #[serial]
    async fn restore_holds_a_run_intent_recorded_in_an_earlier_boot() -> anyhow::Result<()> {
        disarm_kill_switch().await;
        crate::core::windows_kill_switch::arm_bootstrap(
            &crate::KillSwitchConfig {
                tunnel_interface: "Tono".to_owned(),
                proxy_endpoints: vec![crate::ProxyEndpoint {
                    ip: "8.8.8.8".to_owned(),
                    port: 443,
                    protocol: crate::ProxyProtocol::Tcp,
                }],
                bootstrap_api_hosts: vec!["1.1.1.1".to_owned()],
                direct_endpoints: Vec::new(),
            },
            "/opt/tono/mihomo",
            "owner-alice",
        )
        .await?;
        let owner = test_owner(90_010);
        seed_run_intent(&owner, "an-earlier-boot").await?;

        let restored = super::restore_desired_state().await;
        let kept = load_owner_desired_state(&owner.key)
            .await?
            .core_should_be_running;
        disarm_kill_switch().await;
        clear_active_owner().await?;

        assert!(
            matches!(restored, Ok(false)),
            "a run intent from an earlier boot was replayed: {restored:?}"
        );
        assert!(kept, "the hold must not rewrite the run intent");
        Ok(())
    }

    /// The emergency disarm removes the barrier but never touches the run intent, and after
    /// BRICK-W2 the lease no longer fences startup by accident. A same-boot Service start must
    /// still not replay a Core with no barrier restored.
    #[cfg(windows)]
    #[tokio::test]
    #[serial]
    async fn restore_never_replays_a_run_intent_without_a_wanted_barrier() -> anyhow::Result<()> {
        disarm_kill_switch().await;
        let owner = test_owner(90_011);
        seed_run_intent(&owner, "tests-share-one-boot").await?;

        let restored = super::restore_desired_state().await;
        let kept = load_owner_desired_state(&owner.key)
            .await?
            .core_should_be_running;
        clear_active_owner().await?;

        assert!(
            matches!(restored, Ok(false)),
            "a run intent without a restored barrier was replayed: {restored:?}"
        );
        assert!(kept, "the hold must not rewrite the run intent");
        Ok(())
    }

    #[tokio::test]
    async fn legacy_global_state_is_backed_up_without_becoming_owner_state() -> anyhow::Result<()> {
        let root = std::env::temp_dir().join(format!(
            "legacy-desired-state-backup-{}",
            std::process::id()
        ));
        let legacy = root.join("desired-state.json");
        let backup = root.join("desired-state.json.legacy.bak");
        std::fs::create_dir_all(&root)?;
        std::fs::write(&legacy, br#"{"core_should_be_running":true}"#)?;

        backup_legacy_state_file(&legacy).await?;

        assert!(!legacy.exists());
        assert_eq!(
            std::fs::read(&backup)?,
            br#"{"core_should_be_running":true}"#
        );
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}
