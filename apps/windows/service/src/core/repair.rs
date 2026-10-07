use anyhow::{Context as _, Result};
use std::fs::{File, OpenOptions};

pub const REPAIR_IN_PROGRESS_EXIT_CODE: i32 = 75;

pub struct ServiceRepairGate {
    _file: File,
}

pub fn acquire_service_repair_gate() -> Result<Option<ServiceRepairGate>> {
    let directory = crate::prepare_service_install_directory()?;
    let path = directory.join(".repair.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .with_context(|| format!("failed to open service repair gate {path:?}"))?;
    lock_service_repair_gate(file, &path)
}

/// R681-release-gate-writes: the gate for a Release whose [`acquire_service_repair_gate`] failed.
/// It opens the existing `.repair.lock` without preparing the directories (no DACL reset) and
/// without creating it, and locks it the same way. An installer holding the gate holds this file
/// open and locked, so `Ok(None)` still means an installer owns the lifecycle; a missing file
/// means no installer has ever taken the gate there.
#[cfg(windows)]
pub(crate) fn probe_service_repair_gate() -> Result<Option<ServiceRepairGate>> {
    let path = crate::core::paths::service_paths()
        .install_dir()
        .join(".repair.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .with_context(|| format!("failed to open existing service repair gate {path:?}"))?;
    lock_service_repair_gate(file, &path)
}

fn lock_service_repair_gate(
    file: File,
    path: &std::path::Path,
) -> Result<Option<ServiceRepairGate>> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd as _;
        use std::os::unix::fs::PermissionsExt as _;

        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to secure service repair gate {path:?}"))?;
        let status = unsafe {
            platform_lib::flock(
                file.as_raw_fd(),
                platform_lib::LOCK_EX | platform_lib::LOCK_NB,
            )
        };
        if status == 0 {
            return Ok(Some(ServiceRepairGate { _file: file }));
        }
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::WouldBlock {
            return Ok(None);
        }
        Err(error).with_context(|| format!("failed to lock service repair gate {path:?}"))
    }

    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle as _;
        use windows_sys::Win32::Foundation::{ERROR_LOCK_VIOLATION, GetLastError};
        use windows_sys::Win32::Storage::FileSystem::LockFile;

        if unsafe { LockFile(file.as_raw_handle(), 0, 0, u32::MAX, u32::MAX) } != 0 {
            return Ok(Some(ServiceRepairGate { _file: file }));
        }
        if unsafe { GetLastError() } == ERROR_LOCK_VIOLATION {
            return Ok(None);
        }
        Err(std::io::Error::last_os_error())
            .with_context(|| format!("failed to lock service repair gate {path:?}"))
    }
}
