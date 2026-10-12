//! The main Service registers the release service from its own image (PROPOSAL §10 v5).
//!
//! `tono-release.exe` is a byte-identical copy of the installed `tono-service.exe`, registered
//! as `TonoRelease` with `--release-service`. A copy rather than the same file, so replacing
//! the main Service never has to stop the release service and the other way round. The copy is
//! refreshed only under C, so it never changes while a release runs.

use super::Authority;
use crate::release_wire::{RELEASE_BINARY_NAME, RELEASE_SERVICE_DISPLAY_NAME, RELEASE_SERVICE_NAME};
use anyhow::{Context as _, Result};
use sha2::{Digest as _, Sha256};
use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::time::{Duration, Instant};

const STOP_TIMEOUT: Duration = Duration::from_secs(10);

pub fn spawn_ensure_installed() {
    let spawned = std::thread::Builder::new()
        .name("tono-release-install".into())
        .spawn(|| {
            if let Err(error) = ensure_installed() {
                tracing::warn!("the release service could not be installed: {error:#}");
            }
        });
    if let Err(error) = spawned {
        tracing::warn!("the release service installer thread could not start: {error}");
    }
}

fn digest(path: &Path) -> Result<Vec<u8>> {
    let bytes = std::fs::read(path).with_context(|| format!("failed to read {path:?}"))?;
    Ok(Sha256::digest(&bytes).to_vec())
}

pub(crate) fn ensure_installed() -> Result<()> {
    use platform_lib::service::{
        ServiceAccess, ServiceAction, ServiceActionType, ServiceErrorControl, ServiceFailureActions,
        ServiceFailureResetPeriod, ServiceInfo, ServiceStartType, ServiceState, ServiceType,
    };
    use platform_lib::service_manager::{ServiceManager, ServiceManagerAccess};

    let paths = crate::core::paths::service_paths();
    let source = std::env::current_exe()?.canonicalize()?;
    let installed = paths.install_dir().join("tono-service.exe").canonicalize()?;
    // Only the installed Service registers the release service, never a standalone run.
    if !source
        .to_string_lossy()
        .eq_ignore_ascii_case(&installed.to_string_lossy())
    {
        return Ok(());
    }
    let target = paths.install_dir().join(RELEASE_BINARY_NAME);
    let Some(_held) = Authority::live().lock(Duration::ZERO)? else {
        // A release is running; the next Service start refreshes the copy.
        return Ok(());
    };

    let manager = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    )?;
    let access = ServiceAccess::QUERY_STATUS
        | ServiceAccess::QUERY_CONFIG
        | ServiceAccess::CHANGE_CONFIG
        | ServiceAccess::START
        | ServiceAccess::STOP;
    let existing = manager.open_service(RELEASE_SERVICE_NAME, access).ok();
    let current = digest(&target).ok() == Some(digest(&source)?);

    if !current {
        if let Some(service) = existing.as_ref()
            && service.query_status()?.current_state != ServiceState::Stopped
        {
            let _ = service.stop();
            let deadline = Instant::now() + STOP_TIMEOUT;
            while service.query_status()?.current_state != ServiceState::Stopped {
                anyhow::ensure!(
                    Instant::now() < deadline,
                    "the release service did not stop within {}s",
                    STOP_TIMEOUT.as_secs()
                );
                std::thread::sleep(Duration::from_millis(200));
            }
        }
        let staged = paths
            .install_dir()
            .join(format!("{RELEASE_BINARY_NAME}.tmp-{}", std::process::id()));
        std::fs::copy(&source, &staged).with_context(|| format!("failed to stage {staged:?}"))?;
        crate::core::windows_security::secure_private_service_file_if_exists(&staged)?;
        crate::core::atomic_file::replace_blocking(&staged, &target)
            .with_context(|| format!("failed to publish {target:?}"))?;
    }

    let info = ServiceInfo {
        name: OsString::from(RELEASE_SERVICE_NAME),
        display_name: OsString::from(RELEASE_SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: target.clone(),
        launch_arguments: vec![OsString::from("--release-service")],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    };
    let service = match existing {
        Some(service) => {
            if !current {
                service.change_config(&info)?;
            }
            service
        }
        None => manager.create_service(&info, access)?,
    };
    service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(24 * 60 * 60)),
        reboot_msg: None,
        command: None,
        actions: Some(
            [5, 10, 30]
                .into_iter()
                .map(|seconds| ServiceAction {
                    action_type: ServiceActionType::Restart,
                    delay: Duration::from_secs(seconds),
                })
                .collect(),
        ),
    })?;
    service.set_failure_actions_on_non_crash_failures(true)?;
    if service.query_status()?.current_state == ServiceState::Stopped {
        service.start(&Vec::<&OsStr>::new())?;
    }
    Ok(())
}

/// Stop and delete the release service and its image. Called by the uninstaller.
pub fn remove() -> Result<()> {
    use platform_lib::service::{ServiceAccess, ServiceState};
    use platform_lib::service_manager::{ServiceManager, ServiceManagerAccess};

    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    if let Ok(service) = manager.open_service(
        RELEASE_SERVICE_NAME,
        ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE,
    ) {
        if service.query_status()?.current_state != ServiceState::Stopped {
            let _ = service.stop();
            let deadline = Instant::now() + STOP_TIMEOUT;
            while service.query_status()?.current_state != ServiceState::Stopped
                && Instant::now() < deadline
            {
                std::thread::sleep(Duration::from_millis(200));
            }
        }
        service.delete()?;
    }
    let target = crate::core::paths::service_paths()
        .install_dir()
        .join(RELEASE_BINARY_NAME);
    match std::fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to remove {target:?}")),
    }
}
