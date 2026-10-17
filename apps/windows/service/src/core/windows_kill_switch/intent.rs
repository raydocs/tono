//! The persisted intent record: path, atomic write, tombstones.

use super::*;

pub(super) fn intent_path() -> PathBuf {
    crate::service_paths()
        .persistent_state_dir()
        .join("kill-switch.json")
}

pub(super) fn strict_recovery_path() -> PathBuf {
    crate::service_paths().persistent_state_dir().join("kill-switch-strict")
}

/// Independent of the mutable session record. Unknown/unreadable marker bytes are a hold,
/// not permission to release. Only an explicit release writes the exact cleared value.
pub(super) fn strict_recovery_required() -> bool {
    match std::fs::read(strict_recovery_path()) {
        Ok(bytes) => bytes != b"released\n",
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    }
}

pub(super) async fn persist_strict_recovery() -> Result<()> {
    atomic_write(&strict_recovery_path(), b"strict\n").await
}

pub(super) async fn clear_strict_recovery() -> Result<()> {
    if strict_recovery_required() {
        atomic_write(&strict_recovery_path(), b"released\n").await?;
    }
    Ok(())
}

/// Independent update recovery must respect the durable hold even if the session is lost.
pub fn strict_kill_switch_intent_on_disk() -> bool {
    strict_recovery_required() || std::fs::read(intent_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<IntentRecord>(&bytes).ok())
        .is_some_and(|intent| intent.wanted && intent.strict_kill_switch)
}

/// The owner recorded in the persisted intent, for the release service, which has no in-memory
/// armed state. A missing or unparseable record owns no one, exactly as `authorize_write_for`
/// treats a missing or ownerless intent; a record that exists but cannot be read is an error.
#[cfg(windows)]
pub(crate) fn persisted_intent_owner() -> std::io::Result<Option<String>> {
    match std::fs::read(intent_path()) {
        Ok(bytes) => Ok(serde_json::from_slice::<IntentRecord>(&bytes)
            .ok()
            .and_then(|intent| intent.owner_key)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Per-write sequence for intent temporaries (BRICK-W11). A shared
/// `kill-switch.tmp` let a later writer delete or overwrite an earlier
/// writer's in-flight bytes, and a `replace` that reported a timeout can
/// still commit afterwards and silently cover a successor's newer intent.
static INTENT_WRITE_SEQ: AtomicU64 = AtomicU64::new(1);
#[cfg(test)]
pub(super) static TEST_INTENT_VERIFY_CORRUPT: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
pub(super) static TEST_STRICT_CLEAR_FAILURE: AtomicBool = AtomicBool::new(false);

pub(super) async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    #[cfg(test)]
    {
        TEST_PERSIST_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
        if TEST_PERSIST_FAILURE.load(Ordering::Relaxed) {
            bail!("simulated persistent-state write failure");
        }
        // Model an uncommitted marker clear (e.g. a failed temporary-file flush), without
        // also breaking the session tombstone or the initial durable strict hold.
        if path == strict_recovery_path() && bytes == b"released\n"
            && TEST_STRICT_CLEAR_FAILURE.load(Ordering::Relaxed)
        {
            bail!("simulated strict recovery clear failure");
        }
    }
    crate::core::paths::ensure_persistent_state_layout()?;
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    // One temporary per write: no writer removes or reuses another's
    // in-flight file. A timed-out rename's source is left alone rather
    // than unlinked under it (cf. staging's reclaim rule).
    let temporary = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        INTENT_WRITE_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    tokio::fs::write(&temporary, bytes).await?;
    // The strict criterion must reach disk before grants. A stalled flush refuses publication
    // rather than holding the WFP writer forever; the temporary is not renamed on timeout.
    if path == strict_recovery_path() {
        tokio::time::timeout(std::time::Duration::from_secs(30), async {
            tokio::fs::OpenOptions::new().write(true).open(&temporary).await?.sync_all().await
        }).await.context("strict recovery flush timed out")??;
    }
    crate::core::platform_security::secure_private_service_file_if_exists(&temporary)?;
    crate::core::atomic_file::replace(&temporary, path)
        .await
        .with_context(|| format!("failed to move state into {path:?}"))?;
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    #[cfg(test)]
    if TEST_INTENT_VERIFY_CORRUPT.swap(false, Ordering::Relaxed) {
        // Deterministic stand-in for a stale rename landing between the
        // replace above and the read-back below.
        std::fs::write(path, b"stale-intent")?;
    }
    // A stale commit that landed before this read is a loud error the
    // caller already treats as "not proven" — never a quiet older intent.
    // (A rename landing after this read is still uncovered; it needs the
    // kernel rename to stall past a whole successor write. See BRICK-W11.)
    let committed = tokio::fs::read(path)
        .await
        .with_context(|| format!("failed to verify state at {path:?}"))?;
    if committed != bytes {
        anyhow::bail!("intent write did not commit: destination differs after replace");
    }
    Ok(())
}

pub(super) fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// A durable record that means an explicit release won and startup must finish removing any
/// provider-scoped WFP debris before it exposes IPC.
///
/// Keeping this record until the next Service start closes a subtle replacement race. A normal
/// release used to delete `kill-switch.json` after proving the filters absent. On this machine,
/// stopping that otherwise-clean Service during an in-place update made persistent filters
/// visible again. The replacement then saw "missing intent + filters" and correctly (but
/// disastrously for a disconnected user) installed the ownerless emergency block. `wanted:false`
/// is the existing, fail-open recovery contract; the next arm atomically replaces it with a
/// wanted record before touching WFP, and startup consumes it only after cleanup.
pub(super) fn disarmed_tombstone() -> IntentRecord {
    IntentRecord {
        wanted: false,
        mode: KillSwitchStatusMode::Blocked,
        verified: Some(false),
        tunnel_interface: String::new(),
        app_path: String::new(),
        endpoints: Vec::new(),
        api_host_ips: Vec::new(),
        updated_at: now_unix(),
        owner_key: None,
        strict_kill_switch: false,
        strict_contract: None,
        reconnect_after_release: false,
        reconnect_owner_key: None,
        apply_narrow_after_release: Some(false),
    }
}

/// `reconnect_owner` is the released session's owner; only that owner is told to reconnect.
pub(super) fn crash_recovery_tombstone(reconnect_owner: Option<String>) -> IntentRecord {
    let mut tombstone = disarmed_tombstone();
    tombstone.reconnect_after_release = true;
    tombstone.reconnect_owner_key = reconnect_owner;
    tombstone.apply_narrow_after_release = Some(true);
    tombstone
}

pub(super) async fn persist_disarmed_tombstone() -> Result<()> {
    atomic_write(
        &intent_path(),
        &serde_json::to_vec_pretty(&disarmed_tombstone())?,
    )
    .await
}

pub(super) async fn release_tombstone(apply_narrow: Option<bool>) -> IntentRecord {
    if apply_narrow.is_none() {
        // Idle SCM Stop preserves the automatic release/reconnect disposition on disk.
        if let Ok(bytes) = tokio::fs::read(intent_path()).await {
            if let Ok(intent) = serde_json::from_slice::<IntentRecord>(&bytes) {
                if !intent.wanted {
                    return intent;
                }
            }
        }
    }
    let mut tombstone = disarmed_tombstone();
    tombstone.apply_narrow_after_release = apply_narrow;
    tombstone
}

pub(super) async fn persist_automatic_release_tombstone() -> Result<()> {
    let tombstone = release_tombstone(Some(true)).await;
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await
}
