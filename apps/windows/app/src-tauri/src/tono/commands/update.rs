//! The App transports untrusted bytes. Only Service admits, consumes, adopts,
//! and commits an update. No Tauri updater installation or App journal authority.
use crate::{core::owner_identity::current_owner_credentials, tono::{connection, state::TonoState}, utils::dirs};
use anyhow::{Context as _, Result, ensure};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, ipc::Channel};
use tokio::{io::AsyncWriteExt as _, sync::Mutex};
use tono_logging::{Type, logging};
use tono_core::connection::ConnectionFsm;
use tono_service_protocol::{
    update_contract::{Phase, Protection, ReleaseManifest, TargetId},
    update_wire::{DISCOVERY_URL, RELEASE_ROOT, UpdateRequest, UpdateStatus},
};

static OFFER: Lazy<Mutex<Option<(String, String, ReleaseManifest)>>> = Lazy::new(|| Mutex::new(None));
static INSTALL: Mutex<()> = Mutex::const_new(());
static INCOMPLETE: AtomicBool = AtomicBool::new(false);

pub fn incomplete() -> bool {
    INCOMPLETE.load(Ordering::Acquire)
}

async fn native_capable() -> Result<bool> {
    let version = tono_service_protocol::get_version().await?;
    ensure!(version.code == 0, "Service capability is unavailable");
    Ok(version.data.as_ref().is_some_and(|v| {
        v.supports_client(
            tono_service_protocol::ProtocolVersion::current(),
            tono_service_protocol::MIN_SERVICE_REVISION_FOR_UPDATE_TRANSACTION,
        )
    }))
}

pub async fn request(request: UpdateRequest) -> Result<UpdateStatus> {
    ensure!(
        native_capable().await?,
        "Service does not support protected update v1; Disconnect and manually replace the legacy client"
    );
    let response = tono_service_protocol::update_transaction(&current_owner_credentials()?, request).await?;
    ensure!(response.code == 0, "{}", response.message);
    let status = response.data.context("Service omitted update status")?;
    INCOMPLETE.store(
        status.receipt.as_ref().is_some_and(|r| r.phase != Phase::Committed),
        Ordering::Release,
    );
    Ok(status)
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(600))
        .build()?)
}

async fn bounded(client: &reqwest::Client, url: &str, limit: usize) -> Result<String> {
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(30))
        .send()
        .await?
        .error_for_status()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(bytes.len() + chunk.len() <= limit, "update document exceeds limit");
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8(bytes)?)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    version: String,
    manifest_sha256: String,
}

#[tauri::command]
pub async fn tono_check_update() -> Result<Option<Offer>, String> {
    async {
        let client = client()?;
        let manifest = bounded(&client, DISCOVERY_URL, 16_384).await?;
        let decoded = ReleaseManifest::decode(manifest.as_bytes())?;
        let hash = decoded.sha256()?;
        let signature = bounded(
            &client,
            &format!("{RELEASE_ROOT}/{hash}/manifest.windows-x86_64.sig"),
            4096,
        )
        .await?;
        // Service verifies the signature and compiled/durable floor even when
        // the offer would be reported as "up to date". TLS/JSON is not authority.
        let status = request(UpdateRequest::Check {
            manifest: manifest.clone(),
            signature: signature.clone(),
        })
        .await?;
        let Some(verified) = status.offer else {
            *OFFER.lock().await = None;
            return Ok(None);
        };
        ensure!(verified == decoded, "Service verified a different manifest");
        let offer = Offer {
            version: verified.app_version.clone(),
            manifest_sha256: hash,
        };
        *OFFER.lock().await = Some((manifest, signature, verified));
        Ok::<_, anyhow::Error>(Some(offer))
    }
    .await
    .map_err(|e| format!("Protected update discovery failed: {e:#}"))
}

#[tauri::command]
pub async fn tono_install_update(
    app: AppHandle,
    state: tauri::State<'_, Arc<TonoState>>,
    manifest_sha256: String,
    progress: Channel<serde_json::Value>,
) -> Result<(), String> {
    let _install = INSTALL
        .try_lock()
        .map_err(|_| "An update request is already running".to_string())?;
    // The generation this update retired, if it got that far. Convergence may
    // only fold the attempt this update invalidated, never a live one.
    let mut invalidated = None;
    let mut preparation_complete = false;
    let outcome = async {
        let (manifest, signature, decoded) = OFFER.lock().await.clone().context("Check for updates again")?;
        ensure!(
            decoded.sha256()? == manifest_sha256,
            "selected update changed; check again"
        );
        let target = decoded
            .targets
            .iter()
            .find(|t| t.id == TargetId::WindowsX86_64)
            .context("no Windows target")?;
        let root = dirs::app_home_dir()?.join("update-downloads");
        tokio::fs::create_dir_all(&root).await?;
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).context("download nonce failed")?;
        let nonce = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let path = root.join(format!("{nonce}.exe"));
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .await?;
        let mut response = client()?
            .get(format!("{RELEASE_ROOT}/{manifest_sha256}/package.windows-x86_64.exe"))
            .send()
            .await?
            .error_for_status()?;
        progress.send(serde_json::json!({"event":"Started", "data":{"contentLength":target.artifact_size_bytes}}))?;
        let mut size = 0u64;
        while let Some(chunk) = response.chunk().await? {
            size += chunk.len() as u64;
            ensure!(size <= target.artifact_size_bytes, "package exceeds signed size");
            file.write_all(&chunk).await?;
            progress.send(serde_json::json!({"event":"Progress", "data":{"chunkLength":chunk.len()}}))?;
        }
        ensure!(size == target.artifact_size_bytes, "package is truncated");
        file.sync_all().await?;
        drop(file);
        progress.send(serde_json::json!({"event":"Finished"}))?;
        // These are user-context conveniences, not proof. Service independently
        // reads this authenticated user's proxy registry after private staging.
        crate::core::proxy_control::stop_guard().await;
        crate::core::proxy_control::clear_for_update().await?;
        {
            let mut inner = state.lock().await;
            inner.invalidate_connection(false);
            invalidated = Some(inner.connect_generation);
            inner.tasks.abort_catalog_sync();
        }
        INCOMPLETE.store(true, Ordering::Release);
        let prepared = request(UpdateRequest::Prepare {
            manifest,
            signature,
            package_path: path.to_string_lossy().into_owned(),
        })
        .await?;
        let receipt = prepared.receipt.context("Service omitted durable receipt")?;
        ensure!(
            receipt.phase == Phase::InstallationAuthorized && receipt.manifest_sha256 == manifest_sha256,
            "update preparation is incomplete; retained evidence needs recovery"
        );
        preparation_complete = true;
        let attempt_id = receipt.attempt_id;
        if let Err(error) = request(UpdateRequest::Install {
            attempt_id: attempt_id.clone(),
        })
        .await
        {
            // Never retry execution after a lost acknowledgement. Query only.
            let status = request(UpdateRequest::Status).await?;
            ensure!(
                status.receipt.as_ref().is_some_and(|r| r.attempt_id == attempt_id)
                    && matches!(status.execution.as_str(), "Launching" | "Consumed" | "Replaced"),
                "{error:#}"
            );
        }
        Ok::<_, anyhow::Error>(())
    }
    .await;
    // Success exits via the independent executor, never JS install()/quit.
    // A refusal before reservation is different from a lost response after it.
    // Query, never infer absence or replay installation after either failure.
    if outcome.is_err() && incomplete() {
        let _ = request(UpdateRequest::Status).await;
    }
    // A failed Prepare may leave Core running after its supervision was aborted.
    // An unreadable snapshot still must not strand the retired Connecting attempt.
    let core_running = crate::core::service::tono_service_status_snapshot()
        .await
        .ok()
        .map(|snapshot| snapshot.core_pid.is_some());
    let prepare_failed = outcome.is_err() && !preparation_complete;
    let release = {
        let mut inner = state.lock().await;
        let current = inner.connect_generation;
        let release = quiesce_connection_after_update(&mut inner.fsm, core_running, prepare_failed, invalidated, current);
        super::emit_status(&app, &super::status_of(&inner));
        release
    };
    if release {
        if let Err(error) = connection::disconnect_for_generation(
            Arc::clone(state.inner()), app.clone(), invalidated,
        ).await {
            logging!(warn, Type::Service, "Tono: failed update preparation could not restore internet: {error}");
        }
    }
    super::quit::resync_after_cancelled_quit(app).await;
    outcome.map_err(|e| format!("Protected update stopped: {e:#}"))
}

/// Fold the connection FSM once a native update has taken over, whatever the
/// update outcome then turns out to be.
///
/// `tono_install_update` invalidates the connection generation before talking
/// to the Service, so a connect transaction in flight unwinds with
/// `Attempt::Stale`, which by contract leaves the FSM untouched — the flow
/// that bumped the generation owns the cleanup, and this convergence is that
/// cleanup. An attempt that never armed goes back to Not Connected; an armed
/// one keeps the blocked latch and lands in Protected Offline: an update is
/// not a Disconnect and must not loosen protection. A Connected session is
/// folded when Core stopped. If Prepare failed with Core still running, its
/// retired supervision cannot renew DIRECT under the pending-update fence;
/// return true to restore internet through the update-aware release worker.
/// An unreadable snapshot is not evidence that Core stopped.
///
/// Connecting is folded only when `invalidated` (the generation this update
/// left behind) is still `current`: an update that failed before invalidating
/// (download, proxy clear) or an attempt admitted after the invalidation
/// (which bumps the generation) is live and owns its own FSM transitions.
fn quiesce_connection_after_update(
    fsm: &mut ConnectionFsm,
    core_running: Option<bool>,
    prepare_failed: bool,
    invalidated: Option<u64>,
    current: u64,
) -> bool {
    let release = prepare_failed && core_running == Some(true) && invalidated == Some(current)
        && fsm.status().is_connected;
    if fsm.status().is_connecting && invalidated == Some(current) {
        // Unarmed → Not Connected; armed → Protected Offline, latch retained.
        fsm.initial_release_failed();
    } else if fsm.status().is_connected && (core_running == Some(false) || release) {
        fsm.tunnel_died();
    }
    release
}

/// Whether this App process may run update recovery's automatic Connect (BRICK-W1).
///
/// After a restart mid-update every App is a later incarnation, and each one reconnected by
/// itself at every logon until the update committed. Only a certain answer that this process is
/// the executor's own successor opens the recovery Connect. A failed or uncertain Adopt, or a
/// relaunch, holds it for the rest of the process: a retried restore may then read the
/// incarnation the first Adopt already rebound, and must not take that as the answer. The
/// user's own Connect still finishes the update, and Restore internet still releases it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Adoption {
    Undecided = 0,
    Allowed = 1,
    Held = 2,
}

impl Adoption {
    /// The state after one Adopt request. `answered` is the Service's `successor_relaunched`
    /// when the request succeeded, `None` when it failed.
    pub(crate) fn after(self, answered: Option<bool>) -> Adoption {
        match (self, answered) {
            (Adoption::Undecided | Adoption::Allowed, Some(false)) => Adoption::Allowed,
            _ => Adoption::Held,
        }
    }

    fn from_u8(value: u8) -> Adoption {
        match value {
            0 => Adoption::Undecided,
            1 => Adoption::Allowed,
            _ => Adoption::Held,
        }
    }
}

static ADOPTION: AtomicU8 = AtomicU8::new(Adoption::Undecided as u8);

pub(crate) fn recovery_adoption() -> Adoption {
    Adoption::from_u8(ADOPTION.load(Ordering::Acquire))
}

fn record_adoption(answered: Option<bool>) {
    let _ = ADOPTION.fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
        Some(Adoption::from_u8(current).after(answered) as u8)
    });
}

pub async fn adopt() -> Result<Option<Protection>> {
    // A known legacy Service uses normal verified Disconnect/manual replacement.
    // A failed v1 adoption, unlike a proven absent attempt, must remain visible.
    if !native_capable().await? {
        return Ok(None);
    }
    INCOMPLETE.store(true, Ordering::Release);
    let adopted = request(UpdateRequest::Adopt).await;
    record_adoption(adopted.as_ref().ok().map(|status| status.successor_relaunched));
    let status = adopted?;
    let Some(receipt) = status.receipt.filter(|r| r.phase != Phase::Committed) else {
        return Ok(None);
    };
    if receipt.required_recovery != Protection::Connected {
        request(UpdateRequest::Commit).await?;
    }
    Ok(Some(receipt.required_recovery))
}

pub async fn disconnect_if_pending() -> Result<Option<tono_service_protocol::KillSwitchStatus>> {
    if !incomplete() {
        return Ok(None);
    }
    let pending = request(UpdateRequest::Status).await?;
    if !pending.receipt.is_some_and(|r| r.phase != Phase::Committed) {
        return Ok(None);
    }
    crate::core::proxy_control::stop_guard().await;
    crate::core::proxy_control::clear_for_update().await?;
    // A lost reply can follow a committed release; the caller treats errors as unconfirmed.
    // A release whose update record could not be proven or archived returns Ok with
    // `needs_attention`: the machine is open, so it must not read as armed.
    let released = request(UpdateRequest::Disconnect).await?;
    if let Some(reason) = released.needs_attention.as_deref() {
        logging!(warn, Type::Service, "Tono: update Disconnect released protection; update record still pending: {reason}");
    }
    // The Service command proves and records cleanup; this ordinary read also
    // supplies the released protection projection to the existing UI worker.
    let status = crate::core::service::tono_kill_switch_status().await?;
    crate::core::service::record_verified_release(&status);
    Ok(Some(status))
}

pub async fn commit_if_pending() -> Result<()> {
    if incomplete() {
        request(UpdateRequest::Commit).await?;
    }
    Ok(())
}

#[cfg(test)]
mod update_quiesce_tests {
    use super::*;
    use tono_core::connection::UiState;

    /// R2-F3: a connecting attempt the update invalidated must never stay
    /// Connecting. `Attempt::Stale` does not touch the FSM, `connect()` then
    /// refuses "already connecting", and Retry treats connecting as a no-op,
    /// so this convergence is the attempt's only exit short of the user
    /// clicking Disconnect.
    #[test]
    fn update_quiesce_never_strands_connecting() {
        // Cancelled before StartClash armed the WFP policy.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        quiesce_connection_after_update(&mut fsm, Some(false), false, Some(7), 7);
        assert!(!fsm.status().is_connecting);
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);
        assert!(!fsm.kill_switch_armed());

        // Cancelled after arm: the update is not a Disconnect — the blocked
        // latch survives and the machine lands in Protected Offline.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        quiesce_connection_after_update(&mut fsm, Some(false), false, Some(7), 7);
        assert!(!fsm.status().is_connecting);
        assert!(fsm.kill_switch_armed());
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);

        // The update failed before invalidating (e.g. the download broke), or
        // a new attempt was admitted after it (generation moved on): that
        // attempt is live and must not be touched.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        quiesce_connection_after_update(&mut fsm, Some(false), false, None, 7);
        assert!(fsm.status().is_connecting);
        quiesce_connection_after_update(&mut fsm, Some(false), false, Some(7), 8);
        assert!(fsm.status().is_connecting);
    }

    #[test]
    fn failed_prepare_with_running_core_releases_only_the_unsupervised_session() {
        let mut connected = ConnectionFsm::new();
        connected.begin_connect();
        connected.mark_kill_switch_armed();
        connected.mark_session_verified();
        connected.connect_succeeded().unwrap();

        let mut fsm = connected.clone();
        assert!(quiesce_connection_after_update(&mut fsm, Some(true), true, Some(7), 7));
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        // The worker, not this local fold, must prove DNS/Core/WFP release.
        assert!(fsm.kill_switch_armed());
        assert!(fsm.session_verified());

        let mut fsm = connected;
        assert!(!quiesce_connection_after_update(&mut fsm, Some(true), true, None, 7));
        assert!(!quiesce_connection_after_update(&mut fsm, Some(true), true, Some(7), 8));
        assert!(!quiesce_connection_after_update(&mut fsm, Some(true), false, Some(7), 7));
        assert!(fsm.status().is_connected);
    }

    #[test]
    fn failed_prepare_with_unreadable_snapshot_still_folds_connecting() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        assert!(!quiesce_connection_after_update(&mut fsm, None, true, Some(7), 7));
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);

        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        assert!(!quiesce_connection_after_update(&mut fsm, None, true, Some(7), 7));
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        assert!(fsm.kill_switch_armed());

        // Neither a newer live attempt nor Connected is disproven by missing IPC.
        fsm.begin_connect();
        assert!(!quiesce_connection_after_update(&mut fsm, None, true, Some(7), 8));
        assert!(fsm.status().is_connecting);
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        assert!(!quiesce_connection_after_update(&mut fsm, None, true, Some(8), 8));
        assert!(fsm.status().is_connected);
    }
}
