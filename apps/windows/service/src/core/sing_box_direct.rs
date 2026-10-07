//! Restart the running sing-box process, then lock the full tunnel again.
//!
//! `start_core` retracts volatile permits before the new process exists. This
//! module locks immediately afterwards. If that lock cannot be proved, the
//! previous document is started and locked when `restore_previous` is set.
//! A rollback to the full tunnel passes false, so a failed start cannot put
//! DIRECT rules back. If the tunnel still cannot be proved, Core is stopped
//! and general traffic is released while AI destinations stay blocked.
//! Nothing here publishes Blocked as the outcome, and nothing calls the
//! mihomo reload bracket.

use std::future::Future;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context as _, Result, bail};

use crate::core::manager::CORE_MANAGER;
use crate::core::structure::{ClashConfig, OwnerIdentity, is_sing_box_core_path};
use crate::core::windows_kill_switch;

pub(crate) async fn replace_running_sing_box_document(
    owner: &OwnerIdentity,
    document: &str,
    restore_previous: bool,
) -> Result<()> {
    crate::core::sing_box_runtime::admit_owned_runtime(document)
        .map_err(|error| anyhow::anyhow!(error))?;
    windows_kill_switch::sing_box_full_tunnel_is_locked()?;
    let config = {
        let manager = CORE_MANAGER.lock().await;
        manager
            .running_core_config()
            .await
            .context("sing-box replacement has no running core")?
            .1
    };
    if !is_sing_box_core_path(&config.core_config.core_path) {
        bail!("sing-box replacement refused a mihomo process");
    }
    let path = std::path::PathBuf::from(&config.core_config.config_path);
    let previous = tokio::fs::read(&path).await.with_context(|| {
        format!(
            "failed to read the running sing-box config {}",
            path.display()
        )
    })?;
    if let Err(error) = write_document(&path, document.as_bytes()).await {
        return Err(error).context("sing-box replacement did not change the running config");
    }
    let started = {
        let manager = CORE_MANAGER.lock().await;
        manager.start_core(config.clone(), owner.clone()).await
    };
    let failed = match started {
        Err(error) => Some(error),
        Ok(()) => lock_new_tunnel().await.err(),
    };
    let Some(error) = failed else {
        return Ok(());
    };
    // The document the watchdog last restarted, which may be what ran before
    // the replacement. Its fake-IP slot is left as well (#1258).
    let respawned =
        crate::core::sing_box_fake_ip::respawned_document(&config.core_config.config_path).await;
    if restore_previous {
        let previous = crate::core::sing_box_fake_ip::retained_document(
            &previous,
            &[document.as_bytes(), respawned.as_slice()],
        );
        restore_or_release(&path, &previous, &config, owner, error).await
    } else {
        // The caller asked for the full-tunnel document. Retry that document
        // only. Writing `previous` back would revive DIRECT rules.
        let document = crate::core::sing_box_fake_ip::retained_document(
            document.as_bytes(),
            &[previous.as_slice(), respawned.as_slice()],
        );
        retry_requested_or_release(&path, &document, &config, owner, error).await
    }
}

async fn restore_or_release(
    path: &Path,
    previous: &[u8],
    config: &ClashConfig,
    owner: &OwnerIdentity,
    error: anyhow::Error,
) -> Result<()> {
    let file_restored = write_document(path, previous).await;
    let started = if file_restored.is_ok() {
        let manager = CORE_MANAGER.lock().await;
        manager.start_core(config.clone(), owner.clone()).await
    } else {
        Err(anyhow::anyhow!(
            "previous sing-box config could not be written back"
        ))
    };
    let locked = if started.is_ok() {
        lock_new_tunnel().await
    } else {
        Err(anyhow::anyhow!("previous sing-box process did not start"))
    };
    if locked.is_ok() {
        return Err(error.context("sing-box replacement failed; the proven full tunnel is running"));
    }
    release_general_traffic(error).await
}

async fn retry_requested_or_release(
    path: &Path,
    document: &[u8],
    config: &ClashConfig,
    owner: &OwnerIdentity,
    error: anyhow::Error,
) -> Result<()> {
    let started = if write_document(path, document).await.is_ok() {
        let manager = CORE_MANAGER.lock().await;
        manager.start_core(config.clone(), owner.clone()).await
    } else {
        Err(anyhow::anyhow!(
            "requested sing-box config could not be written"
        ))
    };
    if started.is_ok() && lock_new_tunnel().await.is_ok() {
        return Err(error.context(
            "sing-box replacement failed; the requested full tunnel is running",
        ));
    }
    release_general_traffic(error).await
}

/// The App's connect lock budget (`LOCK_ATTEMPTS` × `LOCK_RETRY_INTERVAL` in
/// `connection/controller.rs`): 50 × 200 ms.
const LOCK_ATTEMPTS: u32 = 50;
const LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(200);

/// `start_core` returns as soon as sing-box is spawned, before it has created
/// its WinTUN adapter, and the killed predecessor leaves a not-present row
/// under the same alias. A lock at that moment is refused as "did not resolve
/// to a LUID". The App's connect path retries exactly these refusals; without
/// the same retry here a replacement that locked before the adapter was up
/// failed, fell through to the restore (which races the same way) and
/// released general traffic.
async fn lock_new_tunnel() -> Result<()> {
    lock_with_retries(|| windows_kill_switch::lock(None), LOCK_RETRY_INTERVAL).await
}

async fn lock_with_retries<F, Fut>(mut lock: F, interval: Duration) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<()>>,
{
    let mut attempt = 1;
    loop {
        match lock().await {
            Err(error) if attempt < LOCK_ATTEMPTS && tunnel_not_ready(&error) => {
                attempt += 1;
                tokio::time::sleep(interval).await;
            }
            result => return result,
        }
    }
}

/// The adapter-not-ready refusals the App's `is_retryable_lock_error` retries.
fn tunnel_not_ready(error: &anyhow::Error) -> bool {
    let text = format!("{error:#}").to_lowercase();
    text.contains("did not resolve to a luid") || text.contains("is not a tunnel device")
}

async fn release_general_traffic(error: anyhow::Error) -> Result<()> {
    match windows_kill_switch::release_applying_narrow().await {
        Ok(_) => {
            let _ = CORE_MANAGER.lock().await.stop_core().await;
            Err(error.context(
                "sing-box replacement could not restore the full tunnel; general traffic was released and AI destinations stay blocked",
            ))
        }
        Err(release) => Err(error.context(format!(
            "sing-box replacement could not restore the full tunnel, and releasing general traffic was refused ({release:#})"
        ))),
    }
}

pub(crate) async fn write_document(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("json.sing-next");
    tokio::fs::write(&tmp, bytes)
        .await
        .with_context(|| format!("failed to stage sing-box config {}", tmp.display()))?;
    crate::core::atomic_file::replace(&tmp, path)
        .await
        .with_context(|| format!("failed to publish sing-box config {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    use super::lock_with_retries;

    #[tokio::test]
    async fn a_replacement_lock_waits_for_the_new_sing_box_adapter() {
        let calls = AtomicU32::new(0);
        let result = lock_with_retries(
            || {
                let call = calls.fetch_add(1, Ordering::SeqCst);
                async move {
                    if call < 2 {
                        anyhow::bail!(
                            "interface LUID 7 is reported as not present, so the tunnel alias did not resolve to a LUID of a present adapter; refusing to lock"
                        );
                    }
                    Ok(())
                }
            },
            Duration::ZERO,
        )
        .await;
        assert!(result.is_ok(), "the adapter came up on the third attempt");
        assert_eq!(calls.load(Ordering::SeqCst), 3);

        let calls = AtomicU32::new(0);
        let result = lock_with_retries(
            || {
                calls.fetch_add(1, Ordering::SeqCst);
                async {
                    anyhow::bail!(
                        "core changed before tunnel lock install; a fresh lock is required"
                    )
                }
            },
            Duration::ZERO,
        )
        .await;
        assert!(result.is_err());
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "other lock failures are not retried"
        );
    }
}
