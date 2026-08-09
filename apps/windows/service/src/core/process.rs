#[cfg(windows)]
use anyhow::Context as _;
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::time::Duration;
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct ProcessIdentity {
    pub(super) executable: String,
    pub(super) started_at: u64,
}

pub(super) fn process_identity(pid: u32) -> Result<Option<ProcessIdentity>> {
    if !is_process_alive(pid) {
        return Ok(None);
    }

    #[cfg(target_os = "linux")]
    {
        let executable = std::fs::read_link(format!("/proc/{pid}/exe"))?
            .canonicalize()?
            .to_string_lossy()
            .into_owned();
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"))?;
        let fields = stat
            .rsplit_once(')')
            .ok_or_else(|| anyhow::anyhow!("invalid /proc stat for process {pid}"))?
            .1
            .split_whitespace()
            .collect::<Vec<_>>();
        let started_at = fields
            .get(19)
            .ok_or_else(|| anyhow::anyhow!("missing start time for process {pid}"))?
            .parse()?;
        Ok(Some(ProcessIdentity {
            executable,
            started_at,
        }))
    }

    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStringExt as _;

        let mut path = vec![0u8; platform_lib::PROC_PIDPATHINFO_MAXSIZE as usize];
        let path_len = unsafe {
            platform_lib::proc_pidpath(pid as i32, path.as_mut_ptr().cast(), path.len() as u32)
        };
        if path_len <= 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        path.truncate(path_len as usize);
        let executable = std::path::PathBuf::from(std::ffi::OsString::from_vec(path))
            .canonicalize()?
            .to_string_lossy()
            .into_owned();
        let mut info = unsafe { std::mem::zeroed::<platform_lib::proc_bsdinfo>() };
        let info_len = unsafe {
            platform_lib::proc_pidinfo(
                pid as i32,
                platform_lib::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut platform_lib::proc_bsdinfo).cast(),
                std::mem::size_of::<platform_lib::proc_bsdinfo>() as i32,
            )
        };
        if info_len != std::mem::size_of::<platform_lib::proc_bsdinfo>() as i32 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(Some(ProcessIdentity {
            executable,
            started_at: info
                .pbi_start_tvsec
                .saturating_mul(1_000_000)
                .saturating_add(info.pbi_start_tvusec),
        }))
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
        use windows_sys::Win32::System::Threading::{
            GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            QueryFullProcessImageNameW,
        };

        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        struct ProcessHandle(windows_sys::Win32::Foundation::HANDLE);
        impl Drop for ProcessHandle {
            fn drop(&mut self) {
                unsafe { CloseHandle(self.0) };
            }
        }
        let handle = ProcessHandle(handle);
        let mut path = vec![0u16; 32_768];
        let mut path_len = path.len() as u32;
        if unsafe { QueryFullProcessImageNameW(handle.0, 0, path.as_mut_ptr(), &mut path_len) } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        path.truncate(path_len as usize);
        let executable = std::path::PathBuf::from(String::from_utf16(&path)?)
            .canonicalize()?
            .to_string_lossy()
            .into_owned();
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if unsafe { GetProcessTimes(handle.0, &mut creation, &mut exit, &mut kernel, &mut user) }
            == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let started_at =
            (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
        Ok(Some(ProcessIdentity {
            executable,
            started_at,
        }))
    }

    #[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
    {
        let output = std::process::Command::new("ps")
            .args(["-o", "lstart=", "-o", "comm=", "-p", &pid.to_string()])
            .output()?;
        if !output.status.success() {
            return Ok(None);
        }
        let identity = String::from_utf8(output.stdout)?;
        Ok(Some(ProcessIdentity {
            executable: identity.trim().to_string(),
            started_at: 0,
        }))
    }
}

pub(super) fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let result = unsafe { platform_lib::kill(pid as i32, 0) };
        let exists = result == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(platform_lib::EPERM);
        if !exists {
            return false;
        }
        // A zombie has exited and no longer owns files or locks, even though kill(pid, 0)
        // continues to report it until its parent reaps it.
        let zombie = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .is_some_and(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .trim_start()
                    .starts_with('Z')
            });
        !zombie
    }

    #[cfg(windows)]
    {
        use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
        use windows_sys::Win32::Foundation::{
            ERROR_INVALID_PARAMETER, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, WaitForSingleObject,
        };

        if pid == 0 {
            return false;
        }
        let raw = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION
                    | windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE,
                0,
                pid,
            )
        };
        if raw.is_null() {
            // Invalid PID means gone. Access-denied or another inspection failure is treated as
            // alive: startup reconciliation must fail closed rather than open the network around
            // a process it could not prove had exited.
            return std::io::Error::last_os_error().raw_os_error()
                != Some(ERROR_INVALID_PARAMETER as i32);
        }
        // SAFETY: `OpenProcess` returned an owned process handle.
        let handle = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
        match unsafe { WaitForSingleObject(handle.as_raw_handle() as HANDLE, 0) } {
            WAIT_OBJECT_0 => false,
            WAIT_TIMEOUT => true,
            _ => true,
        }
    }
}

pub(super) async fn terminate_process(pid: u32) -> Result<()> {
    #[cfg(unix)]
    {
        warn!("Terminating process {}", pid);
        if unsafe { platform_lib::kill(pid as i32, platform_lib::SIGTERM) } != 0
            && std::io::Error::last_os_error().raw_os_error() != Some(platform_lib::ESRCH)
        {
            return Err(std::io::Error::last_os_error().into());
        }

        for _ in 0..10 {
            if !is_process_alive(pid) {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        warn!("Process {} did not exit, sending SIGKILL", pid);
        if unsafe { platform_lib::kill(pid as i32, platform_lib::SIGKILL) } != 0
            && std::io::Error::last_os_error().raw_os_error() != Some(platform_lib::ESRCH)
        {
            return Err(std::io::Error::last_os_error().into());
        }
        for _ in 0..10 {
            if !is_process_alive(pid) {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        bail!("process {pid} is still alive after SIGKILL");
    }

    #[cfg(windows)]
    {
        warn!("Terminating process {}", pid);
        tokio::task::spawn_blocking(move || terminate_process_windows(pid))
            .await
            .context("Windows process termination worker failed")??;
        Ok(())
    }
}

/// Native, locale-independent Windows process termination with a hard wait bound. This is the
/// recovery path for a core left by an older Service; cores started by this build additionally
/// live in a kill-on-close Job Object (see `manager.rs`).
#[cfg(windows)]
fn terminate_process_windows(pid: u32) -> Result<()> {
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        ERROR_INVALID_PARAMETER, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_TERMINATE, TerminateProcess, WaitForSingleObject,
    };

    if pid == 0 {
        return Ok(());
    }
    let raw = unsafe {
        OpenProcess(
            PROCESS_TERMINATE | windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE,
            0,
            pid,
        )
    };
    if raw.is_null() {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
            return Ok(());
        }
        return Err(error).with_context(|| format!("failed to open process {pid} for termination"));
    }
    // SAFETY: `OpenProcess` returned an owned process handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    let raw = handle.as_raw_handle() as HANDLE;

    if unsafe { TerminateProcess(raw, 1) } == 0 {
        // The process may have exited between OpenProcess and TerminateProcess.
        if unsafe { WaitForSingleObject(raw, 0) } != WAIT_OBJECT_0 {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("failed to terminate process {pid}"));
        }
    }
    match unsafe { WaitForSingleObject(raw, 2_000) } {
        WAIT_OBJECT_0 => Ok(()),
        WAIT_TIMEOUT => bail!("process {pid} did not terminate within 2 seconds"),
        _ => Err(std::io::Error::last_os_error())
            .with_context(|| format!("failed while waiting for process {pid} to terminate")),
    }
}

/// Which of the enumerated `(pid, canonical executable)` candidates are orphaned cores: the
/// image is Tono's installed core and no caller vouches for the PID (the runtime record's PID,
/// the core this process currently supervises, or one a start has just spawned). Pure, so the
/// selection rule is testable without a live process table.
#[cfg_attr(all(not(windows), not(test)), allow(dead_code))]
pub(super) fn select_orphan_core_pids(
    candidates: &[(u32, String)],
    exempt_pids: &std::collections::BTreeSet<u32>,
    is_installed_core_image: impl Fn(&str) -> bool,
) -> Vec<u32> {
    let mut selected: Vec<u32> = candidates
        .iter()
        .filter(|(pid, executable)| {
            !exempt_pids.contains(pid) && is_installed_core_image(executable)
        })
        .map(|(pid, _)| *pid)
        .collect();
    selected.sort_unstable();
    selected.dedup();
    selected
}

/// Terminate every running copy of Tono's installed core image that nothing live vouches for.
///
/// This is the fallback the record-based cleanup cannot be: `reconcile_service_startup` only
/// ever acts on the one PID the runtime record names, and `CoreManager` only tracks children
/// this process spawned — a core whose record was deleted after an identity mismatch, or one
/// spawned by a previous service instance or channel, is invisible to both and goes on holding
/// the fixed DNS listener and the TUN device against every later core. The sweep identifies
/// cores by canonicalized executable path against the same install-location allowlist a core
/// start is validated with, never by image name, so a mihomo the user installed themselves,
/// anywhere else on disk, is never touched.
///
/// `exempt_pids` are processes the caller vouches for: the core this process currently
/// supervises, or one a start has just spawned. The runtime record's PID is always added here:
/// a mismatched record means the PID now belongs to someone the record logic deliberately left
/// alone, and a stale record must never become a license to kill whatever now holds it.
#[cfg(windows)]
pub(super) async fn sweep_orphan_core_processes(exempt_pids: &[u32]) -> Result<u32> {
    // Test builds never sweep the real process table: the selection rule is unit-tested directly,
    // and a `cargo test` run on a machine with Tono installed must not be able to kill the
    // installed core. This mirrors `STARTUP_RECONCILED` defaulting to done under `feature = "test"`.
    if cfg!(feature = "test") {
        let _ = exempt_pids;
        return Ok(0);
    }
    let mut exempt: std::collections::BTreeSet<u32> = exempt_pids.iter().copied().collect();
    if let Some(record) = crate::core::runtime::read_core_runtime_record().await? {
        exempt.insert(record.pid);
    }
    let orphans = select_orphan_core_pids(&core_image_candidates()?, &exempt, |path| {
        crate::core::runtime_generation::is_installed_core_image_path(std::path::Path::new(path))
    });
    let mut terminated = 0_u32;
    for pid in orphans {
        match terminate_process(pid).await {
            Ok(()) => terminated += 1,
            Err(error) => warn!("Failed to terminate orphaned core process {pid}: {error:#}"),
        }
    }
    if terminated > 0 {
        warn!(
            "Terminated {terminated} orphaned core process(es) running Tono's installed core image"
        );
    }
    Ok(terminated)
}

/// Process-table enumeration is implemented for Windows only (Toolhelp32); unix core cleanup
/// remains record- and kill-on-close-based.
#[cfg(not(windows))]
pub(super) async fn sweep_orphan_core_processes(exempt_pids: &[u32]) -> Result<u32> {
    let _ = exempt_pids;
    Ok(0)
}

/// Every running process whose image file name is the core's, as `(pid, canonical executable)`.
/// The name is only a pre-filter that keeps the per-process path query bounded; identity is
/// decided on the canonicalized path by the caller.
#[cfg(windows)]
fn core_image_candidates() -> Result<Vec<(u32, String)>> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    const CORE_IMAGE_FILE_NAME: &str = "verge-mihomo.exe";

    // SAFETY: a snapshot of the process table has no caller-supplied pointers to invalidate.
    let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if raw == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error())
            .context("CreateToolhelp32Snapshot failed while sweeping for orphaned cores");
    }
    struct SnapshotHandle(windows_sys::Win32::Foundation::HANDLE);
    impl Drop for SnapshotHandle {
        fn drop(&mut self) {
            // SAFETY: the handle came from a successful `CreateToolhelp32Snapshot` and closes once.
            unsafe { CloseHandle(self.0) };
        }
    }
    let snapshot = SnapshotHandle(raw);

    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut candidates = Vec::new();
    // SAFETY: `snapshot` is a live snapshot and `entry` a valid, correctly sized in/out buffer.
    let mut has_entry = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while has_entry {
        let name_end = entry
            .szExeFile
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(entry.szExeFile.len());
        let image_name = String::from_utf16_lossy(&entry.szExeFile[..name_end]);
        if image_name.eq_ignore_ascii_case(CORE_IMAGE_FILE_NAME) {
            // `process_identity` re-derives and canonicalizes the full image path; a process
            // that exited mid-sweep or refuses inspection is skipped, never guessed at.
            if let Ok(Some(identity)) = process_identity(entry.th32ProcessID) {
                candidates.push((entry.th32ProcessID, identity.executable));
            }
        }
        // SAFETY: same contract as the first call.
        has_entry = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::select_orphan_core_pids;
    use std::collections::BTreeSet;

    #[test]
    fn orphan_selection_keeps_only_unvouched_installed_core_images() {
        let candidates = vec![
            (100_u32, r"C:\Program Files\Tono\verge-mihomo.exe".to_owned()),
            (200_u32, r"C:\Program Files\Tono\verge-mihomo.exe".to_owned()),
            (300_u32, r"C:\Users\alice\mihomo\verge-mihomo.exe".to_owned()),
        ];
        let exempt = BTreeSet::from([100_u32]);
        let installed = |path: &str| path.starts_with(r"C:\Program Files\Tono\");

        assert_eq!(
            select_orphan_core_pids(&candidates, &exempt, installed),
            vec![200],
            "the vouched-for PID and the image outside the install locations must both survive"
        );
    }

    #[test]
    fn orphan_selection_with_nothing_running_selects_nothing() {
        assert!(
            select_orphan_core_pids(&[], &BTreeSet::new(), |_| true).is_empty(),
            "an empty process table yields an empty selection"
        );
    }
}
