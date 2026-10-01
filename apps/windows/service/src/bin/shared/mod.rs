//! What the installer and the uninstaller both have to do.
//!
//! These two binaries are one job seen from either end: they take the same repair gate, run the
//! same maintenance flag, shell out the same way, and both have to clear the helper that shipped
//! before the service had a channel. Neither can import the other, and none of this belongs in the
//! library — it is how a privileged command-line tool behaves, not part of the IPC contract — so
//! it lives here and both declare it.

use anyhow::Error;

pub(crate) fn enter_repair_gate() -> Result<tono_service_protocol::ServiceRepairGate, Error> {
    match tono_service_protocol::acquire_service_repair_gate()? {
        Some(gate) => {
            #[cfg(windows)]
            tono_service_protocol::update_native::maintenance_allowed()?;
            Ok(gate)
        }
        None => {
            eprintln!("Service repair is already in progress");
            std::process::exit(tono_service_protocol::REPAIR_IN_PROGRESS_EXIT_CODE);
        }
    }
}

/// Run one future to completion on a fresh current-thread runtime, then return without waiting
/// for blocking work it left behind.
///
/// Dropping a tokio runtime waits for every `spawn_blocking` task to return, and the DNS and WFP
/// engine calls leave such a task running when they miss their deadline. A plain drop therefore
/// turned a timed-out engine call back into a hang, before the uninstall helper could prove Tono's
/// NRPT rule gone (BRICK-W4). `shutdown_background` does not wait. The abandoned calls only
/// read or release protection, never arm it; on the uninstall path the helper holds the repair
/// gate with the Service stopped or gone, and exits right after it reports. Installer gates also
/// read WFP, so a hung BFE RPC must not keep the repair gate forever. A powershell.exe such a call
/// started is in the library's kill-on-close exit job, so it ends when the helper exits and cannot
/// rewrite DNS after the gate is released.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn block_on_abandoning<F: std::future::Future>(future: F) -> Result<F::Output, Error> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let output = runtime.block_on(future);
    runtime.shutdown_background();
    Ok(output)
}

pub(crate) fn run_maintenance_if_requested() -> Result<bool, Error> {
    if !std::env::args().any(|argument| argument == "--cleanup-stale-owners") {
        return Ok(false);
    }
    let _gate = enter_repair_gate()?;
    let removed = tono_service_protocol::cleanup_stale_owner_state()?;
    println!("Removed {} stale owner state directories", removed.len());
    Ok(true)
}

#[cfg(windows)]
const STOP_POLL_ATTEMPTS: usize = 200;
#[cfg(windows)]
const STOP_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

/// Stop an SCM Service without treating normal StartPending/StopPending windows as failures,
/// escalating to process termination when the daemon never honours the stop. A wedged daemon
/// otherwise dead-ends both the installer (it cannot replace the service) and the uninstaller
/// (it cannot disarm) with a retry that can never succeed. Killing the process is safe on
/// either path: the WFP kill switch is persistent state that survives its process, so the
/// machine stays fail-closed until a fresh service reconciles it or a verified disarm runs.
/// Returns whether it was active when first observed so an installer can roll it back on error.
#[cfg(windows)]
pub(crate) fn stop_windows_service(
    service: &platform_lib::service::Service,
) -> Result<bool, Error> {
    use platform_lib::service::ServiceState;

    let initially_active = service.query_status()?.current_state != ServiceState::Stopped;
    if let Err(graceful_error) = stop_windows_service_gracefully(service) {
        println!(
            "Graceful SCM stop failed ({graceful_error:#}); force-terminating the service process."
        );
        force_stop_windows_service(service)?;
    }
    Ok(initially_active)
}

#[cfg(windows)]
fn stop_windows_service_gracefully(service: &platform_lib::service::Service) -> Result<(), Error> {
    use platform_lib::{Error as WindowsServiceError, service::ServiceState};

    const ERROR_SERVICE_CANNOT_ACCEPT_CTRL: i32 = 1061;
    const ERROR_SERVICE_NOT_ACTIVE: i32 = 1062;

    for _ in 0..STOP_POLL_ATTEMPTS {
        let state = service.query_status()?.current_state;
        if state == ServiceState::Stopped {
            return Ok(());
        }

        if matches!(
            state,
            ServiceState::StartPending
                | ServiceState::StopPending
                | ServiceState::ContinuePending
                | ServiceState::PausePending
        ) {
            std::thread::sleep(STOP_POLL_INTERVAL);
            continue;
        }

        if let Err(error) = service.stop()
            && !matches!(
                &error,
                WindowsServiceError::Winapi(error)
                    if matches!(
                        error.raw_os_error(),
                        Some(ERROR_SERVICE_CANNOT_ACCEPT_CTRL | ERROR_SERVICE_NOT_ACTIVE)
                    )
            )
        {
            return Err(error.into());
        }
        std::thread::sleep(STOP_POLL_INTERVAL);
    }

    anyhow::bail!("timed out waiting for service to stop")
}

/// The escalation path for a daemon that ignored the SCM stop. Suppress the configured
/// crash-restart actions first (best effort — without it the SCM relaunches the daemon five
/// seconds after the kill and races whatever the caller does next; the installer reinstates
/// the actions via `configure_windows_service_recovery`, the uninstaller deletes the service),
/// then terminate the process and wait until the SCM reports Stopped. The pid comes from
/// `QueryServiceStatusEx` (`SERVICE_STATUS_PROCESS.dwProcessId`); the pid file the daemon
/// writes beside its owner lock is the fallback when the SCM no longer reports one.
#[cfg(windows)]
pub(crate) fn force_stop_windows_service(
    service: &platform_lib::service::Service,
) -> Result<(), Error> {
    use platform_lib::service::{
        ServiceAction, ServiceActionType, ServiceFailureActions, ServiceFailureResetPeriod,
        ServiceState,
    };

    let no_restart = ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::Never,
        reboot_msg: None,
        command: None,
        actions: Some(vec![
            ServiceAction {
                action_type: ServiceActionType::None,
                delay: std::time::Duration::ZERO,
            };
            3
        ]),
    };
    if let Err(error) = service.update_failure_actions(no_restart) {
        // Not fatal: a restarted daemon loses the disarm race on the owner lock and the caller
        // reports a hard, retryable error instead of proceeding — still fail-closed.
        println!("Could not suppress SCM crash-restart before termination: {error}");
    }

    let status = service.query_status().ok();
    if status
        .as_ref()
        .is_some_and(|status| status.current_state == ServiceState::Stopped)
    {
        // A positive Stopped result needs no PID fallback, even if a crash left the file behind.
        return Ok(());
    }
    let pid = status
        .and_then(|status| status.process_id)
        .filter(|pid| *pid != 0)
        .or_else(read_service_pid_file);
    match pid {
        Some(pid) => {
            if terminate_service_process_by_pid(pid)? {
                println!("Terminated wedged service process {pid}.");
            } else {
                println!("Service process {pid} is gone or belongs to a different image.");
            }
        }
        // No pid anywhere: the process may already be gone with only the SCM state stale.
        // Fall through to the wait; failing there reports the truth.
        None => println!("Wedged service process id is unknown; waiting for the SCM state."),
    }

    for _ in 0..STOP_POLL_ATTEMPTS {
        if service.query_status()?.current_state == ServiceState::Stopped {
            return Ok(());
        }
        std::thread::sleep(STOP_POLL_INTERVAL);
    }
    anyhow::bail!("service did not reach Stopped even after its process was terminated")
}

/// The daemon records its pid beside the owner lock (`owner.rs`). The file outlives a wedged
/// or killed process, making it the pid source of last resort for escalations.
#[cfg(windows)]
pub(crate) fn read_service_pid_file() -> Option<u32> {
    std::fs::read_to_string(tono_service_protocol::service_paths().pid_file_path())
        .ok()
        .and_then(|content| content.trim().parse().ok())
}

#[cfg(windows)]
pub(crate) fn terminate_service_process_by_pid(pid: u32) -> Result<bool, Error> {
    let expected_image = tono_service_protocol::service_paths()
        .install_dir()
        .join("tono-service.exe");
    terminate_process_by_pid_matching_image(pid, Some(&expected_image))
}

/// Native, locale-independent process termination with a hard wait bound. The service library
/// keeps its own copy private (`core/process.rs`); this bin-side duplicate is deliberate —
/// these binaries must stay buildable from the public crate surface alone.
#[cfg(windows)]
pub(crate) fn terminate_process_by_pid(pid: u32) -> Result<(), Error> {
    terminate_process_by_pid_matching_image(pid, None).map(|_| ())
}

#[cfg(windows)]
fn terminate_process_by_pid_matching_image(
    pid: u32,
    expected_image: Option<&std::path::Path>,
) -> Result<bool, Error> {
    use anyhow::Context as _;
    use std::os::windows::ffi::OsStringExt as _;
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        ERROR_INVALID_PARAMETER, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
        QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
    };

    if pid == 0 {
        return Ok(false);
    }
    let mut access = PROCESS_TERMINATE | windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    if expected_image.is_some() {
        access |= PROCESS_QUERY_LIMITED_INFORMATION;
    }
    let raw = unsafe { OpenProcess(access, 0, pid) };
    if raw.is_null() {
        let error = std::io::Error::last_os_error();
        // An invalid pid means the process is already gone, which is the goal.
        if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
            return Ok(false);
        }
        return Err(error).with_context(|| format!("failed to open process {pid} for termination"));
    }
    // SAFETY: `OpenProcess` returned an owned process handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(raw.cast()) };
    let raw = handle.as_raw_handle() as HANDLE;

    if let Some(expected_image) = expected_image {
        // A pid file or SCM observation may outlive its process. Validate the image on the
        // same owned handle used for termination, so PID reuse cannot swap in another target.
        if unsafe { WaitForSingleObject(raw, 0) } == WAIT_OBJECT_0 {
            return Ok(false);
        }
        let mut image = vec![0u16; 32_768];
        let mut length = image.len() as u32;
        if unsafe { QueryFullProcessImageNameW(raw, 0, image.as_mut_ptr(), &mut length) } == 0 {
            let error = std::io::Error::last_os_error();
            if unsafe { WaitForSingleObject(raw, 0) } == WAIT_OBJECT_0 {
                return Ok(false);
            }
            return Err(error).with_context(|| {
                format!("failed to inspect service process {pid} before termination")
            });
        }
        let actual_image = std::path::PathBuf::from(std::ffi::OsString::from_wide(
            &image[..length as usize],
        ));
        let actual_image = std::fs::canonicalize(&actual_image)
            .with_context(|| format!("failed to resolve process {pid} image {actual_image:?}"))?;
        let expected_image = std::fs::canonicalize(expected_image)
            .with_context(|| format!("failed to resolve installed service image {expected_image:?}"))?;
        if !actual_image
            .to_string_lossy()
            .eq_ignore_ascii_case(&expected_image.to_string_lossy())
        {
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
    match unsafe { WaitForSingleObject(raw, 5_000) } {
        WAIT_OBJECT_0 => Ok(true),
        WAIT_TIMEOUT => anyhow::bail!("process {pid} did not exit within 5 seconds of termination"),
        _ => Err(std::io::Error::last_os_error())
            .with_context(|| format!("failed while waiting for terminated process {pid}")),
    }
}

#[cfg(all(target_os = "macos", not(feature = "development-channel")))]
pub fn uninstall_old_service() -> Result<(), Error> {
    use std::path::Path;

    for service_id in tono_service_protocol::LEGACY_MACOS_SERVICE_IDS {
        let plist_file = format!("/Library/LaunchDaemons/{service_id}.plist");
        let bundle_path = format!("/Library/PrivilegedHelperTools/{service_id}.bundle");
        let flat_binary = format!("/Library/PrivilegedHelperTools/{service_id}");

        // Leftover helpers are often already gone. launchctl failure must not
        // skip the remaining identities or the file cleanup below.
        let _ = run_command("launchctl", &["stop", service_id], false);
        let _ = run_command("launchctl", &["bootout", "system", &plist_file], false);
        let _ = run_command(
            "launchctl",
            &["disable", &format!("system/{service_id}")],
            false,
        );

        if Path::new(&plist_file).exists() {
            std::fs::remove_file(&plist_file)
                .map_err(|e| anyhow::anyhow!("Failed to remove leftover plist {plist_file}: {e}"))?;
        }
        if Path::new(&bundle_path).exists() {
            std::fs::remove_dir_all(&bundle_path).map_err(|e| {
                anyhow::anyhow!("Failed to remove leftover helper bundle {bundle_path}: {e}")
            })?;
        }
        if Path::new(&flat_binary).exists() {
            std::fs::remove_file(&flat_binary).map_err(|e| {
                anyhow::anyhow!("Failed to remove leftover helper binary {flat_binary}: {e}")
            })?;
        }
    }

    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn run_command(cmd: &str, args: &[&str], debug: bool) -> Result<(), Error> {
    if debug {
        println!("Executing: {} {}", cmd, args.join(" "));
    }

    let output = std::process::Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to execute '{}': {}", cmd, e))?;

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if debug {
        eprintln!(
            "Command failed (status: {}):\nstdout: {}\nstderr: {}",
            output.status, stdout, stderr
        );
    }

    Err(anyhow::anyhow!(
        "Command '{}' failed (status: {}):\nstdout: {}\nstderr: {}",
        cmd,
        output.status,
        stdout,
        stderr
    ))
}

#[cfg(all(test, windows))]
mod tests {
    use super::terminate_process_by_pid_matching_image;
    use std::process::{Child, Command, Stdio};

    struct ChildFixture(Child);

    impl Drop for ChildFixture {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn service_termination_does_not_kill_a_different_executable() -> anyhow::Result<()> {
        let mut child = ChildFixture(
            Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Start-Sleep -Seconds 30",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?,
        );
        // An existing, different executable ensures this tests image comparison rather than
        // failing to inspect a missing installed-service binary on the CI machine.
        let expected_image = std::env::current_exe()?;
        let terminated =
            terminate_process_by_pid_matching_image(child.0.id(), Some(&expected_image))?;
        let survived = child.0.try_wait()?.is_none();
        assert!(
            !terminated,
            "a foreign image must not authorize service termination"
        );
        assert!(survived, "the foreign child must remain alive");
        Ok(())
    }
}
