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

use std::path::Path;

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
        Ok(()) => windows_kill_switch::lock(None).await.err(),
    };
    let Some(error) = failed else {
        return Ok(());
    };
    if restore_previous {
        restore_or_release(&path, &previous, &config, owner, error).await
    } else {
        // The caller asked for the full-tunnel document. Retry that document
        // only. Writing `previous` back would revive DIRECT rules.
        retry_requested_or_release(&path, document, &config, owner, error).await
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
        windows_kill_switch::lock(None).await
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
    document: &str,
    config: &ClashConfig,
    owner: &OwnerIdentity,
    error: anyhow::Error,
) -> Result<()> {
    let started = if write_document(path, document.as_bytes()).await.is_ok() {
        let manager = CORE_MANAGER.lock().await;
        manager.start_core(config.clone(), owner.clone()).await
    } else {
        Err(anyhow::anyhow!(
            "requested sing-box config could not be written"
        ))
    };
    if started.is_ok() && windows_kill_switch::lock(None).await.is_ok() {
        return Err(error.context(
            "sing-box replacement failed; the requested full tunnel is running",
        ));
    }
    release_general_traffic(error).await
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

async fn write_document(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("json.sing-next");
    tokio::fs::write(&tmp, bytes)
        .await
        .with_context(|| format!("failed to stage sing-box config {}", tmp.display()))?;
    crate::core::atomic_file::replace(&tmp, path)
        .await
        .with_context(|| format!("failed to publish sing-box config {}", path.display()))?;
    Ok(())
}
