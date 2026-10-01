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
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
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
        Ok(Some(windows_process_identity(handle.0)?))
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

/// Query one already-open process object. A caller that also terminates this object must keep
/// the same handle through both operations, so PID reuse cannot retarget the termination.
#[cfg(windows)]
fn windows_process_identity(
    handle: windows_sys::Win32::Foundation::HANDLE,
) -> Result<ProcessIdentity> {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetProcessTimes, QueryFullProcessImageNameW};

    let mut path = vec![0u16; 32_768];
    let mut path_len = path.len() as u32;
    if unsafe { QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut path_len) } == 0 {
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
    if unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let started_at = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    Ok(ProcessIdentity {
        executable,
        started_at,
    })
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

/// Recovery may only terminate the process instance it previously inspected. On Windows the
/// final identity check and termination use one handle; a reused PID is left untouched.
pub(super) async fn terminate_process_if_identity_matches(
    pid: u32,
    expected: &ProcessIdentity,
) -> Result<bool> {
    #[cfg(unix)]
    {
        if process_identity(pid)?.as_ref() != Some(expected) {
            return Ok(false);
        }
        terminate_process(pid).await?;
        Ok(true)
    }

    #[cfg(windows)]
    {
        let expected = expected.clone();
        tokio::task::spawn_blocking(move || {
            terminate_process_windows_matching(pid, Some(&expected))
        })
        .await
        .context("Windows verified process termination worker failed")?
    }
}

/// Native, locale-independent Windows process termination with a hard wait bound. This is the
/// recovery path for a core left by an older Service; cores started by this build additionally
/// live in a kill-on-close Job Object (see `manager.rs`).
#[cfg(windows)]
fn terminate_process_windows(pid: u32) -> Result<()> {
    terminate_process_windows_matching(pid, None).map(|_| ())
}

#[cfg(windows)]
fn terminate_process_windows_matching(
    pid: u32,
    expected: Option<&ProcessIdentity>,
) -> Result<bool> {
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        ERROR_INVALID_PARAMETER, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, TerminateProcess,
        WaitForSingleObject,
    };

    if pid == 0 {
        return Ok(false);
    }
    let query_access = if expected.is_some() {
        PROCESS_QUERY_LIMITED_INFORMATION
    } else {
        0
    };
    let raw = unsafe {
        OpenProcess(
            PROCESS_TERMINATE | windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE | query_access,
            0,
            pid,
        )
    };
    if raw.is_null() {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
            return Ok(false);
        }
        return Err(error).with_context(|| format!("failed to open process {pid} for termination"));
    }
    // SAFETY: `OpenProcess` returned an owned process handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    let raw = handle.as_raw_handle() as HANDLE;

    if let Some(expected) = expected {
        match unsafe { WaitForSingleObject(raw, 0) } {
            WAIT_OBJECT_0 => return Ok(false),
            WAIT_TIMEOUT => {}
            _ => {
                return Err(std::io::Error::last_os_error())
                    .context("failed to inspect process state");
            }
        }
        let current = windows_process_identity(raw)?;
        if &current != expected {
            warn!("Process {pid} no longer matches the inspected identity; leaving it untouched");
            return Ok(false);
        }
    }

    if unsafe { TerminateProcess(raw, 1) } == 0 {
        // The process may have exited between OpenProcess and TerminateProcess.
        if unsafe { WaitForSingleObject(raw, 0) } != WAIT_OBJECT_0 {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("failed to terminate process {pid}"));
        }
    }
    match unsafe { WaitForSingleObject(raw, 2_000) } {
        WAIT_OBJECT_0 => Ok(true),
        WAIT_TIMEOUT => bail!("process {pid} did not terminate within 2 seconds"),
        _ => Err(std::io::Error::last_os_error())
            .with_context(|| format!("failed while waiting for process {pid} to terminate")),
    }
}

/// Start a helper process the DNS engine runs (powershell.exe, ipconfig.exe) inside one
/// kill-on-close Job Object that this process holds until it exits. A caller that abandons a
/// timed-out DNS call and then exits (the uninstall helper's `block_on_abandoning`, the Service's
/// `shutdown_background`) skips the guard that kills the child on the worker thread. Without the
/// job, a late restore script would keep running and could overwrite DNS a later install has
/// set. Exit closes the handle, and Windows ends every process still in the job. Normal runs are
/// unchanged: their child is waited for, or killed by its guard, long before exit.
///
/// The child joins the job before it runs anything ([`spawn_in_job`]), so every process it starts
/// is in the job too. A child that cannot join is terminated unrun and the start fails: a restore
/// that does not run is reported, while an unbound one could outlive this process. An exit
/// between creation and joining leaves a suspended child that never runs.
#[cfg(windows)]
#[cfg_attr(feature = "test", allow(dead_code))]
pub(super) fn spawn_bound_to_process_exit(
    command: &mut std::process::Command,
) -> Result<std::process::Child> {
    use std::os::windows::io::OwnedHandle;

    // Statics are never dropped, so the kernel closes this handle only when the process exits.
    static EXIT_JOB: std::sync::OnceLock<std::result::Result<OwnedHandle, String>> =
        std::sync::OnceLock::new();
    match EXIT_JOB.get_or_init(|| kill_on_close_job().map_err(|error| format!("{error:#}"))) {
        Ok(job) => spawn_in_job(job, command),
        Err(error) => {
            bail!("the exit Job Object could not be created, so nothing was started: {error}")
        }
    }
}

/// Create `command` suspended, assign it to `job`, and only then resume it. A child that cannot
/// join, or whose threads cannot be resumed, is terminated and waited for before the error is
/// returned.
#[cfg(windows)]
#[cfg_attr(feature = "test", allow(dead_code))]
fn spawn_in_job(
    job: &std::os::windows::io::OwnedHandle,
    command: &mut std::process::Command,
) -> Result<std::process::Child> {
    use std::os::windows::process::CommandExt as _;
    use windows_sys::Win32::System::Threading::CREATE_SUSPENDED;

    let mut child = command.creation_flags(CREATE_SUSPENDED).spawn()?;
    if let Err(error) =
        assign_to_job(job, &child).and_then(|()| resume_suspended_process(child.id()))
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    Ok(child)
}

/// Resume a process this process created suspended. `std::process::Child` keeps no thread handle,
/// so its threads are found by owner PID in a Toolhelp snapshot; the caller holds the process
/// handle, so the PID cannot be reused meanwhile, and a thread ID that now belongs to another
/// process is skipped. The child has run nothing yet, so its one thread is the primary thread
/// CreateProcess left suspended. A thread a third party injected would be resumed as well, which
/// is harmless once the process is in the job and does nothing to a thread already running.
/// If no thread was suspended, the child ran before it joined the job; that is an error, and the
/// caller terminates the child.
#[cfg(windows)]
#[cfg_attr(feature = "test", allow(dead_code))]
fn resume_suspended_process(pid: u32) -> Result<()> {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    };
    use windows_sys::Win32::System::Threading::{
        GetProcessIdOfThread, OpenThread, ResumeThread, THREAD_QUERY_LIMITED_INFORMATION,
        THREAD_SUSPEND_RESUME,
    };

    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: only successfully opened handles are wrapped, and each closes once.
            unsafe { CloseHandle(self.0) };
        }
    }

    // SAFETY: a snapshot of the thread table has no caller-supplied pointers to invalidate.
    let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if raw == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error())
            .with_context(|| format!("failed to list the threads of process {pid}"));
    }
    let snapshot = Handle(raw);
    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut suspended = 0_u32;
    // SAFETY: `snapshot` is a live snapshot and `entry` a valid, correctly sized in/out buffer.
    let mut has_entry = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
    while has_entry {
        if entry.th32OwnerProcessID == pid {
            // SAFETY: no pointers; a null result is checked before use.
            let raw = unsafe {
                OpenThread(
                    THREAD_SUSPEND_RESUME | THREAD_QUERY_LIMITED_INFORMATION,
                    0,
                    entry.th32ThreadID,
                )
            };
            if raw.is_null() {
                return Err(std::io::Error::last_os_error()).with_context(|| {
                    format!("failed to open thread {} of process {pid}", entry.th32ThreadID)
                });
            }
            let thread = Handle(raw);
            // SAFETY: `thread` is a live handle opened with the query and resume rights.
            if unsafe { GetProcessIdOfThread(thread.0) } == pid {
                // SAFETY: the same live handle. ResumeThread returns the suspend count the thread
                // had before this call.
                let previous = unsafe { ResumeThread(thread.0) };
                if previous == u32::MAX {
                    return Err(std::io::Error::last_os_error()).with_context(|| {
                        format!("failed to resume thread {} of process {pid}", entry.th32ThreadID)
                    });
                }
                if previous > 0 {
                    suspended += 1;
                }
            }
        }
        // SAFETY: same contract as the first call.
        has_entry = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
    }
    if suspended == 0 {
        bail!("process {pid} had no suspended thread, so it ran before it joined the job");
    }
    Ok(())
}

#[cfg(windows)]
#[cfg_attr(feature = "test", allow(dead_code))]
fn kill_on_close_job() -> Result<std::os::windows::io::OwnedHandle> {
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation, SetInformationJobObject,
    };

    let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if raw.is_null() {
        return Err(std::io::Error::last_os_error()).context("failed to create a Job Object");
    }
    // SAFETY: `CreateJobObjectW` returned a new owned handle.
    let job = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            job.as_raw_handle() as HANDLE,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error())
            .context("failed to make the Job Object kill on close");
    }
    Ok(job)
}

#[cfg(windows)]
#[cfg_attr(feature = "test", allow(dead_code))]
fn assign_to_job(
    job: &std::os::windows::io::OwnedHandle,
    child: &std::process::Child,
) -> Result<()> {
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

    if unsafe {
        AssignProcessToJobObject(
            job.as_raw_handle() as HANDLE,
            child.as_raw_handle() as HANDLE,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error())
            .with_context(|| format!("failed to assign process {} to a Job Object", child.id()));
    }
    Ok(())
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

#[cfg(any(windows, test))]
fn orphan_core_exemptions(
    exempt_pids: &[u32],
    runtime_record_pid: Option<u32>,
    preserve_runtime_record: bool,
) -> std::collections::BTreeSet<u32> {
    let mut exempt: std::collections::BTreeSet<u32> =
        exempt_pids.iter().copied().collect();
    if preserve_runtime_record && let Some(pid) = runtime_record_pid {
        exempt.insert(pid);
    }
    exempt
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
/// supervises, or one a start has just spawned. `preserve_runtime_record` additionally protects
/// the PID in the durable runtime record. That protection is deliberately caller-controlled: a
/// strongly proven active runtime needs it to close the watchdog-restart race, while an inactive
/// recorded Core is precisely the stale DNS owner that `PrepareCoreStart` must remove.
#[cfg(windows)]
pub(super) async fn sweep_orphan_core_processes(
    exempt_pids: &[u32],
    preserve_runtime_record: bool,
) -> Result<u32> {
    // Test builds never sweep the real process table: the selection rule is unit-tested directly,
    // and a `cargo test` run on a machine with Tono installed must not be able to kill the
    // installed core. This mirrors `STARTUP_RECONCILED` defaulting to done under `feature = "test"`.
    if cfg!(feature = "test") {
        let _ = (exempt_pids, preserve_runtime_record);
        return Ok(0);
    }
    let runtime_record_pid = if preserve_runtime_record {
        crate::core::runtime::read_core_runtime_record()
            .await?
            .map(|record| record.pid)
    } else {
        None
    };
    let exempt = orphan_core_exemptions(exempt_pids, runtime_record_pid, preserve_runtime_record);
    let candidates = core_image_candidates()?;
    let paths = candidates
        .iter()
        .map(|(pid, identity)| (*pid, identity.executable.clone()))
        .collect::<Vec<_>>();
    let orphans = select_orphan_core_pids(&paths, &exempt, |path| {
        crate::core::runtime_generation::is_installed_core_image_path(std::path::Path::new(path))
    });
    let mut terminated = 0_u32;
    for pid in orphans {
        let expected = &candidates
            .iter()
            .find(|(candidate, _)| *candidate == pid)
            .expect("a selected orphan came from the inspected candidates")
            .1;
        match terminate_process_if_identity_matches(pid, expected).await {
            Ok(true) => terminated += 1,
            Ok(false) => {}
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
pub(super) async fn sweep_orphan_core_processes(
    exempt_pids: &[u32],
    preserve_runtime_record: bool,
) -> Result<u32> {
    let _ = (exempt_pids, preserve_runtime_record);
    Ok(0)
}

/// Every running process whose image file name is the core's, as `(pid, process identity)`.
/// The name is only a pre-filter that keeps the per-process path query bounded; identity is
/// decided on the canonicalized path by the caller.
#[cfg(windows)]
fn core_image_candidates() -> Result<Vec<(u32, ProcessIdentity)>> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };

    const CORE_IMAGE_FILE_NAMES: &[&str] = &["tono-core.exe", "verge-mihomo.exe"];

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
        if CORE_IMAGE_FILE_NAMES
            .iter()
            .any(|name| image_name.eq_ignore_ascii_case(name))
        {
            // `process_identity` re-derives and canonicalizes the full image path; a process
            // that exited mid-sweep or refuses inspection is skipped, never guessed at.
            if let Ok(Some(identity)) = process_identity(entry.th32ProcessID) {
                candidates.push((entry.th32ProcessID, identity));
            }
        }
        // SAFETY: same contract as the first call.
        has_entry = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::{orphan_core_exemptions, select_orphan_core_pids};
    use std::collections::BTreeSet;

    #[tokio::test]
    async fn stale_creation_identity_does_not_terminate_the_live_process() -> anyhow::Result<()> {
        #[cfg(unix)]
        let mut command = tokio::process::Command::new("/bin/sleep");
        #[cfg(unix)]
        command.arg("30");
        #[cfg(windows)]
        let mut command = tokio::process::Command::new("ping.exe");
        #[cfg(windows)]
        command.args(["-n", "30", "127.0.0.1"]);
        let mut child = command
            .kill_on_drop(true)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        let pid = child.id().expect("the live child exposes a PID");
        let mut stale = super::process_identity(pid)?.expect("the child has an identity");
        stale.started_at = stale.started_at.wrapping_add(1);

        let terminated = super::terminate_process_if_identity_matches(pid, &stale).await?;
        let survived = child.try_wait()?.is_none();
        if survived {
            child.kill().await?;
        }
        assert!(
            !terminated,
            "a stale creation time must not authorize termination"
        );
        assert!(
            survived,
            "a live process with a different creation identity must survive"
        );
        Ok(())
    }

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

    #[test]
    fn inactive_runtime_record_does_not_exempt_its_dns_owner() {
        let candidates = vec![(
            4860_u32,
            r"C:\Program Files\Tono\verge-mihomo.exe".to_owned(),
        )];
        let installed = |path: &str| path.starts_with(r"C:\Program Files\Tono\");

        let inactive = orphan_core_exemptions(&[], Some(4860), false);
        assert_eq!(
            select_orphan_core_pids(&candidates, &inactive, installed),
            vec![4860],
            "an inactive Tono runtime record must not keep its loopback DNS owner alive"
        );

        let protected = orphan_core_exemptions(&[], Some(4860), true);
        assert!(
            select_orphan_core_pids(&candidates, &protected, installed).is_empty(),
            "a fully protected runtime record closes the watchdog replacement race"
        );
    }

    /// A DNS helper bound to the exit job ends when the job's last handle closes, which is what
    /// process exit does to the handle `spawn_bound_to_process_exit` keeps.
    #[cfg(windows)]
    #[test]
    fn closing_the_exit_job_ends_a_bound_helper() {
        let mut child = std::process::Command::new("ping.exe")
            .args(["-n", "30", "127.0.0.1"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("ping.exe starts");
        let job = super::kill_on_close_job().expect("the job is created");
        super::assign_to_job(&job, &child).expect("the helper joins the job");

        drop(job);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let ended = loop {
            if child
                .try_wait()
                .expect("the helper can be polled")
                .is_some()
            {
                break true;
            }
            if std::time::Instant::now() >= deadline {
                break false;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        if !ended {
            let _ = child.kill();
            let _ = child.wait();
        }
        assert!(ended, "closing the job must end the helper bound to it");
    }

    /// R680-dns-child-job-window: a DNS helper is created suspended and runs only once it is in
    /// the job. One that cannot join is terminated before it has run anything, and the start fails
    /// instead of leaving an unbound helper running. The start also fails when the helper had no
    /// suspended thread to resume, so this test fails if the helper is not created suspended.
    #[cfg(windows)]
    #[test]
    fn a_dns_helper_runs_only_after_joining_the_job() {
        let marker = |name: &str| {
            std::env::temp_dir().join(format!("tono-job-bind-{}-{name}", std::process::id()))
        };
        let mkdir = |path: &std::path::Path| {
            let mut command = std::process::Command::new("cmd.exe");
            command
                .args(["/d", "/c", "mkdir"])
                .arg(path)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            command
        };
        let joined = marker("joined");
        let refused = marker("refused");
        let _ = std::fs::remove_dir(&joined);
        let _ = std::fs::remove_dir(&refused);

        let job = super::kill_on_close_job().expect("the job is created");
        let mut child = super::spawn_in_job(&job, &mut mkdir(&joined))
            .expect("a helper that joins the job starts");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let status = loop {
            if let Some(status) = child.try_wait().expect("the helper can be polled") {
                break Some(status);
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        };
        let ran = status.is_some_and(|status| status.success()) && joined.is_dir();
        let _ = std::fs::remove_dir(&joined);
        assert!(ran, "a helper inside the job is resumed and runs: {status:?}");

        // A file handle is not a Job Object, so joining it fails.
        let not_a_job: std::os::windows::io::OwnedHandle =
            std::fs::File::open(std::env::current_exe().expect("the test binary has a path"))
                .expect("the test binary opens")
                .into();
        let refusal = super::spawn_in_job(&not_a_job, &mut mkdir(&refused))
            .expect_err("a helper that cannot join the job must not start");
        let never_ran = !refused.exists();
        let _ = std::fs::remove_dir(&refused);
        assert!(
            never_ran,
            "a helper that could not join the job must never run: {refusal:#}"
        );
    }
}
