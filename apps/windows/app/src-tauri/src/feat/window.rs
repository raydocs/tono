use crate::config::Config;
use crate::core::{CoreManager, handle};
use crate::tono::state::TonoState;
use crate::utils;
use crate::utils::window_manager::WindowManager;
use std::sync::Arc;
use tauri::Manager as _;
use tono_logging::{Type, logging};
use tono_service_protocol::{KillSwitchStatus, ServiceStatusSnapshot};
use tokio::time::Duration;
#[cfg(target_os = "macos")]
use tokio::time::timeout;

/// Bounded core-stop wait for the unpreventable session-ending path.
///
/// Named so the committed-exit budget in `lib.rs` can be checked against it: that outer budget
/// runs on the Tauri main thread, so it must stay strictly larger than everything it covers.
pub const SESSION_ENDING_STOP_BUDGET: Duration = if cfg!(target_os = "windows") {
    Duration::from_secs(2)
} else {
    Duration::from_secs(3)
};

#[derive(Debug, Clone, Copy)]
pub struct CleanupResult {
    pub all_success: bool,
    pub core_stopped: bool,
}

const fn should_abort_exit_after_cleanup(core_stopped: bool, user_confirmed_protected_exit: bool) -> bool {
    // "Quit/Restart anyway" already accepted a still-armed barrier. A later Service-stop
    // failure must not veto that decision or invent a disarm.
    !core_stopped && !user_confirmed_protected_exit
}

async fn run_exit_cleanup_transition<Stop, StopFuture, Ancillary, AncillaryFuture>(
    stop_core: Stop,
    ancillary_cleanup: Ancillary,
) -> CleanupResult
where
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = bool>,
    Ancillary: FnOnce() -> AncillaryFuture,
    AncillaryFuture: std::future::Future<Output = bool>,
{
    if !stop_core().await {
        return CleanupResult {
            all_success: false,
            core_stopped: false,
        };
    }
    CleanupResult {
        all_success: ancillary_cleanup().await,
        core_stopped: true,
    }
}

async fn run_interactive_cleanup_transition<Stop, StopFuture, Ancillary, AncillaryFuture>(
    stop_core: Stop,
    ancillary_cleanup: Ancillary,
) -> CleanupResult
where
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = bool>,
    Ancillary: FnOnce() -> AncillaryFuture,
    AncillaryFuture: std::future::Future<Output = bool>,
{
    run_exit_cleanup_transition(stop_core, ancillary_cleanup).await
}

async fn run_session_ending_cleanup_transition<Stop, StopFuture, DeadlineFuture, Ancillary, AncillaryFuture>(
    stop_core: Stop,
    stop_deadline: DeadlineFuture,
    ancillary_cleanup: Ancillary,
) -> CleanupResult
where
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = bool>,
    DeadlineFuture: std::future::Future<Output = ()>,
    Ancillary: FnOnce() -> AncillaryFuture,
    AncillaryFuture: std::future::Future<Output = bool>,
{
    run_exit_cleanup_transition(
        || async {
            tokio::select! {
                biased;
                stopped = stop_core() => stopped,
                () = stop_deadline => false,
            }
        },
        ancillary_cleanup,
    )
    .await
}

async fn restore_dns_after_core_stop() -> bool {
    #[cfg(target_os = "macos")]
    match timeout(
        Duration::from_millis(1000),
        crate::utils::resolve::dns::restore_public_dns(),
    )
    .await
    {
        Ok(_) => {
            logging!(info, Type::Window, "DNS设置已恢复");
            true
        }
        Err(_) => {
            logging!(warn, Type::Window, "Warning: 恢复DNS设置超时");
            false
        }
    }
    #[cfg(not(target_os = "macos"))]
    true
}

/// Restart the application
pub async fn restart_app() {
    logging!(debug, Type::System, "启动重启应用流程");
    // 设置退出标志
    handle::Handle::global().set_is_exiting();
    let mut confirmed_protected_exit = false;

    // Tono: restart releases the kill switch like quit does (§6, P0-8). The click-level wait is
    // the same 8 s budget as interactive Quit: `set_is_exiting` already dropped frontend events,
    // so an unbounded await is a silent freeze. The native dialog bypasses that channel.
    let release = tokio::time::timeout(
        INTERACTIVE_QUIT_RELEASE_BUDGET,
        crate::tono::commands::quit_release(handle::Handle::app_handle().clone()),
    )
    .await;
    let release_wait_timed_out = release.is_err();
    if let Some(error) = interactive_release_wait_error(release) {
        logging!(
            error,
            Type::Service,
            "Tono: 无法证明重启前已恢复网络保护: {error}"
        );
        let refusal = refusal_protection(release_wait_timed_out).await;
        if !ask_to_restart_without_release(refusal).await {
            handle::Handle::global().clear_is_exiting();
            surface_cancelled_quit().await;
            handle::Handle::notice_message("app_restart::core_stop_failed", "");
            return;
        }
        confirmed_protected_exit = true;
        logging!(
            warn,
            Type::Service,
            "Tono: 用户选择在保护仍然生效的情况下重启；WFP 屏障保持封锁状态"
        );
    }

    Config::apply_all_and_save_file().await;

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result.all_success { 0 } else { 1 }
    );

    if should_abort_exit_after_cleanup(cleanup_result.core_stopped, confirmed_protected_exit) {
        handle::Handle::global().clear_is_exiting();
        refresh_tray_after_cancelled_exit().await;
        handle::Handle::notice_message("app_restart::core_stop_failed", "");
        return;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.restart();
}

/// Make a refused Quit visible: the exit flag is already cleared, so this restores (or
/// recreates) the main window that the close button hid. Best-effort by design — the window
/// operation debouncer may swallow it right after another window action, and that is still
/// better than the previous silent refusal.
async fn surface_cancelled_quit() {
    refresh_tray_after_cancelled_exit().await;
    let result = WindowManager::show_main_window().await;
    logging!(
        info,
        Type::Window,
        "Quit was cancelled; restoring the main window so the reason is visible: {result:?}"
    );
}

/// Status publishes skip the tray while `is_exiting` is set, so a release that completed (or was
/// refused) while Quit/Restart waited left the tray on its pre-exit icon and tooltip. Once a
/// cancel has cleared the flag, project the current state again, and restart the speed display,
/// which stops for good when an exit starts.
async fn refresh_tray_after_cancelled_exit() {
    let tray = crate::core::tray::Tray::global();
    if let Err(err) = tray.refresh_status().await {
        logging!(
            warn,
            Type::Tray,
            "Tono: failed to refresh the tray after a cancelled exit: {err:#}"
        );
    }
    let enable_tray_speed = Config::preferences()
        .await
        .latest_arc()
        .enable_tray_speed
        .unwrap_or(true);
    tray.update_speed_task(enable_tray_speed);
}

/// Interactive Quit and Restart's own budget for *proving* the release.
///
/// The release operation keeps its own 30 s reconciliation deadline and this wait never cancels
/// it — the worker is detached and single-flight. What this bounds is the click: waiting half a
/// minute with no window and no feedback is indistinguishable from the freeze this whole review
/// is about. Restart Tono uses the same bound: `set_is_exiting` suppresses frontend events, so
/// an unbounded wait is a silent freeze on the RestoringSessionScreen.
const INTERACTIVE_QUIT_RELEASE_BUDGET: Duration = Duration::from_secs(8);

/// Map a bounded `quit_release` wait into an optional error. A timeout is unproven, never success:
/// abandoning the wait does not abandon the release (single-flight), but the click must not hang.
fn interactive_release_wait_error<E>(wait: Result<Result<(), String>, E>) -> Option<String> {
    match wait {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error),
        Err(_) => Some(format!(
            "The release did not finish within {INTERACTIVE_QUIT_RELEASE_BUDGET:?}; the Tono Service may still be working on it."
        )),
    }
}

/// Bound on the Service read that picks the refusal dialog's wording. A Service busy with the
/// release, or wedged, answers nothing in time, and that reads as "not confirmed".
const REFUSAL_PROTECTION_READ_BUDGET: Duration = Duration::from_secs(2);

/// The Service's own status aggregate (kill switch plus any lifecycle mutation it is running) for
/// the refusal dialog; `None` when it did not answer.
async fn protection_for_refusal_dialog() -> Option<ServiceStatusSnapshot> {
    tokio::time::timeout(
        REFUSAL_PROTECTION_READ_BUDGET,
        crate::core::service::tono_service_status_snapshot(),
    )
    .await
    .ok()
    .and_then(Result::ok)
}

/// Whether any explicit release (this exit's, or a Disconnect it did not join, such as the one
/// the pending-update fence returns before) is still registered and can yet remove the barrier.
async fn release_in_progress() -> bool {
    let state = handle::Handle::app_handle()
        .try_state::<Arc<TonoState>>()
        .map(|state| state.inner().clone());
    match state {
        Some(state) => state.release_in_progress().await,
        None => false,
    }
}

/// What the refusal dialog may say about protection. A release that can still run decides the
/// wording on its own, so the Service is read only when none is; a release registered by the time
/// the read returns still counts as running.
async fn refusal_protection(release_wait_timed_out: bool) -> RefusalProtection {
    if release_wait_timed_out || release_in_progress().await {
        return classify_refusal(release_wait_timed_out, true, None);
    }
    let snapshot = protection_for_refusal_dialog().await;
    classify_service_refusal(release_in_progress().await, snapshot.as_ref())
}

/// Wording from the Service's own reading. This App's registry misses a release another user's
/// App started, and one of ours whose response was lost; the Service's `active_operation` does
/// not, so a Service still running any lifecycle mutation means the barrier may yet change.
fn classify_service_refusal(
    app_release_in_progress: bool,
    snapshot: Option<&ServiceStatusSnapshot>,
) -> RefusalProtection {
    let service_mutating = snapshot.is_some_and(|snapshot| snapshot.active_operation.is_some());
    classify_refusal(
        false,
        app_release_in_progress || service_mutating,
        snapshot.and_then(|snapshot| snapshot.kill_switch.as_ref()),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefusalProtection {
    /// The Service reports a wanted and live barrier, and no release is running.
    Held,
    /// A release may still finish after the dialog is answered.
    ReleaseMayComplete,
    /// No Service evidence of a live barrier.
    Unconfirmed,
}

/// "Stays protected" is a promise, so it needs the Service's reading of a wanted and live barrier
/// and a release that can no longer run. A click-level timeout does not cancel the release, and a
/// non-timeout error (the pending-update fence) can return while another release is in flight.
fn classify_refusal(
    release_wait_timed_out: bool,
    release_in_progress: bool,
    protection: Option<&KillSwitchStatus>,
) -> RefusalProtection {
    if release_wait_timed_out || release_in_progress {
        RefusalProtection::ReleaseMayComplete
    } else if protection.is_some_and(|status| status.wanted && status.live) {
        RefusalProtection::Held
    } else {
        RefusalProtection::Unconfirmed
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExitAction {
    Quit,
    Restart,
}

/// Title and body for exiting without a proven release. The raw release error is logged, not
/// shown: its text ("protection stays on", "assumed on") would contradict the evidence classes.
fn release_refusal_copy(action: ExitAction, refusal: RefusalProtection) -> (String, String) {
    let (action_word, question) = match action {
        ExitAction::Quit => (
            tono_i18n::t!("exitRefusal.quitAction"),
            tono_i18n::t!("exitRefusal.quitQuestion"),
        ),
        ExitAction::Restart => (
            tono_i18n::t!("exitRefusal.restartAction"),
            tono_i18n::t!("exitRefusal.restartQuestion"),
        ),
    };
    let (title, state) = match refusal {
        RefusalProtection::Held => (
            tono_i18n::t!("exitRefusal.titleHeld"),
            tono_i18n::t!("exitRefusal.held", action = action_word),
        ),
        RefusalProtection::ReleaseMayComplete => (
            tono_i18n::t!("exitRefusal.titleReleaseMayComplete"),
            tono_i18n::t!("exitRefusal.releaseMayComplete", action = action_word),
        ),
        RefusalProtection::Unconfirmed => (
            tono_i18n::t!("exitRefusal.titleUnconfirmed"),
            tono_i18n::t!("exitRefusal.unconfirmed"),
        ),
    };
    let body = format!(
        "{}\n\n{state}\n\n{}\n\n{question}",
        tono_i18n::t!("exitRefusal.intro"),
        tono_i18n::t!("exitRefusal.recovery"),
    );
    (title.into_owned(), body)
}

/// Ask whether to exit while network protection may still be armed.
///
/// The previous behaviour was to refuse, always. With the Service dead, uninstalled or wedged,
/// `tono_release_kill_switch` fails on both the IPC and its idempotent read-back, so release can
/// never succeed and every Quit click was rejected forever with nothing offered. The invariant
/// is that we must not *silently* open the network — not that the app must be unclosable.
/// Exiting here leaves whatever barrier exists armed, which is the fail-closed direction; the
/// dialog says what is known about it (see [`classify_refusal`]) plus the elevated command
/// that restores connectivity.
async fn ask_to_quit_without_release(refusal: RefusalProtection) -> bool {
    use tauri_plugin_dialog::{DialogExt as _, MessageDialogButtons, MessageDialogKind};

    let (title, body) = release_refusal_copy(ExitAction::Quit, refusal);
    let (tx, rx) = tokio::sync::oneshot::channel();
    handle::Handle::app_handle()
        .dialog()
        .message(body)
        .title(title)
        .buttons(MessageDialogButtons::OkCancelCustom(
            tono_i18n::t!("exitRefusal.quitButton").into_owned(),
            tono_i18n::t!("exitRefusal.stayOpen").into_owned(),
        ))
        .kind(MessageDialogKind::Warning)
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    // A dialog that cannot be shown must not become an unconditional exit.
    rx.await.unwrap_or(false)
}

/// Same fail-closed choice as Quit, for the RestoringSessionScreen "Restart Tono" button.
/// `notice_message` cannot reach the frontend while `is_exiting` is set, so this has to be a
/// native dialog — the same reason Quit cannot use a toast here.
async fn ask_to_restart_without_release(refusal: RefusalProtection) -> bool {
    use tauri_plugin_dialog::{DialogExt as _, MessageDialogButtons, MessageDialogKind};

    let (title, body) = release_refusal_copy(ExitAction::Restart, refusal);
    let (tx, rx) = tokio::sync::oneshot::channel();
    handle::Handle::app_handle()
        .dialog()
        .message(body)
        .title(title)
        .buttons(MessageDialogButtons::OkCancelCustom(
            tono_i18n::t!("exitRefusal.restartButton").into_owned(),
            tono_i18n::t!("exitRefusal.stayOpen").into_owned(),
        ))
        .kind(MessageDialogKind::Warning)
        .show(move |confirmed| {
            let _ = tx.send(confirmed);
        });
    rx.await.unwrap_or(false)
}

pub async fn quit() -> tono_signal::ShutdownOutcome {
    logging!(debug, Type::System, "启动退出流程");
    // 设置退出标志
    handle::Handle::global().set_is_exiting();

    // Tono: capture protection *before* the release below converges the FSM to "unprotected".
    // The connected-quit contract is that the Service keeps running after its barrier is
    // released; only a quit that was never protected stops the SCM service afterwards.
    #[cfg(windows)]
    let tono_protected_at_quit =
        crate::tono::commands::quit_protection_active(handle::Handle::app_handle()).await;
    let mut confirmed_protected_exit = false;

    // Tono: this is the sole owner of the preventable explicit-Quit release (§6). Session-ending
    // exits use their separate best-effort path in `RunEvent::Exit`.
    let release = tokio::time::timeout(
        INTERACTIVE_QUIT_RELEASE_BUDGET,
        crate::tono::commands::quit_release(handle::Handle::app_handle().clone()),
    )
    .await;
    let release_wait_timed_out = release.is_err();
    if let Some(error) = interactive_release_wait_error(release) {
        logging!(error, Type::Service, "Tono: 无法证明退出前已恢复网络保护: {error}");
        let refusal = refusal_protection(release_wait_timed_out).await;
        if !ask_to_quit_without_release(refusal).await {
            handle::Handle::global().clear_is_exiting();
            // A refused Quit is the only outcome that leaves the app running against the user's
            // intent, and by then the window is usually hidden (the X only hides) or already gone.
            // Without this the app just silently ignores Quit — the "it will not close" report.
            // Bringing the window back is what makes the notice below, and Disconnect, reachable.
            surface_cancelled_quit().await;
            handle::Handle::notice_message("app_quit::core_stop_failed", "");
            return tono_signal::ShutdownOutcome::Canceled;
        }
        confirmed_protected_exit = true;
        logging!(
            warn,
            Type::Service,
            "Tono: 用户选择在保护仍然生效的情况下退出；WFP 屏障保持封锁状态"
        );
    }

    Config::apply_all_and_save_file().await;

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result.all_success { 0 } else { 1 }
    );

    if should_abort_exit_after_cleanup(cleanup_result.core_stopped, confirmed_protected_exit) {
        handle::Handle::global().clear_is_exiting();
        surface_cancelled_quit().await;
        handle::Handle::notice_message("app_quit::core_stop_failed", "");
        return tono_signal::ShutdownOutcome::Canceled;
    }

    // Tono: an unprotected quit leaves nothing for the Service to do — the kill switch is not
    // armed and the core stop above already persisted `core_should_be_running = false`. Stop the
    // SCM service so no daemon lingers after the App exits; a protected quit keeps it running
    // (protection semantics win). Best-effort: never blocks or cancels the exit.
    #[cfg(windows)]
    if !tono_protected_at_quit {
        crate::tono::commands::stop_service_on_unprotected_quit().await;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.exit(if cleanup_result.all_success { 0 } else { 1 });
    tono_signal::ShutdownOutcome::Committed
}

pub async fn clean_async() -> CleanupResult {
    logging!(
        info,
        Type::System,
        "Starting interactive cleanup; controlled core stop will be awaited to completion"
    );

    let result = run_interactive_cleanup_transition(
        || async {
            logging!(info, Type::System, "Stopping core for interactive quit or restart");
            match CoreManager::global().stop_core().await {
                Ok(()) => {
                    logging!(info, Type::Window, "Core stopped for interactive quit or restart");
                    true
                }
                Err(error) => {
                    logging!(
                        warn,
                        Type::Window,
                        "Controlled core stop failed; interactive quit or restart must remain cancelled: {error:#}"
                    );
                    false
                }
            }
        },
        restore_dns_after_core_stop,
    )
    .await;

    logging!(
        info,
        Type::System,
        "Interactive cleanup complete - core stopped: {}, all cleanup successful: {}",
        result.core_stopped,
        result.all_success
    );

    result
}

pub async fn clean_session_ending_best_effort() -> CleanupResult {
    let stop_timeout = SESSION_ENDING_STOP_BUDGET;

    logging!(
        info,
        Type::System,
        "Starting bounded session-ending best-effort cleanup"
    );

    let result = run_session_ending_cleanup_transition(
        || async {
            logging!(info, Type::System, "Stopping core during session-ending best-effort cleanup");
            match CoreManager::global().stop_core().await {
                Ok(()) => {
                    logging!(info, Type::Window, "Core stopped during session-ending best-effort cleanup");
                    true
                }
                Err(error) => {
                    logging!(
                        warn,
                        Type::Window,
                        "Session-ending best-effort core stop failed; OS or session exit is already in progress: {error:#}"
                    );
                    false
                }
            }
        },
        async move {
            tokio::time::sleep(stop_timeout).await;
            logging!(
                warn,
                Type::Window,
                "Session-ending best-effort core stop timed out after {} seconds; OS or session exit is already in progress",
                stop_timeout.as_secs()
            );
        },
        restore_dns_after_core_stop,
    )
    .await;

    logging!(
        info,
        Type::System,
        "Session-ending best-effort cleanup finished - core stopped: {}, all cleanup successful: {}",
        result.core_stopped,
        result.all_success
    );

    result
}

#[cfg(target_os = "macos")]
pub async fn hide() {
    if let Some(window) = WindowManager::get_main_window()
        && window.is_visible().unwrap_or(false)
    {
        let _ = window.hide();
    }
    handle::Handle::global().set_activation_policy_accessory();
}

#[cfg(test)]
mod tests {
    use super::{
        classify_refusal, classify_service_refusal, interactive_release_wait_error,
        run_interactive_cleanup_transition, run_session_ending_cleanup_transition,
        should_abort_exit_after_cleanup, RefusalProtection, INTERACTIVE_QUIT_RELEASE_BUDGET,
    };
    use tono_service_protocol::{
        KillSwitchStatus, KillSwitchStatusMode, ServiceLifecycleState, ServiceOperationKind,
        ServiceOperationSnapshot, ServiceStatusSnapshot,
    };
    use tokio::time::Duration;
    use parking_lot::Mutex;
    use std::{
        future::pending,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        task::Poll,
    };
    use tokio::sync::Barrier;

    struct CancellationProbe {
        cancelled: Arc<AtomicBool>,
        completed: Arc<AtomicBool>,
    }

    impl Drop for CancellationProbe {
        fn drop(&mut self) {
            if !self.completed.load(Ordering::Acquire) {
                self.cancelled.store(true, Ordering::Release);
            }
        }
    }

    #[test]
    fn exit_aborts_when_controlled_core_stop_fails() {
        assert!(should_abort_exit_after_cleanup(false, false));
        assert!(!should_abort_exit_after_cleanup(true, false));
    }

    #[test]
    fn confirmed_quit_commits_when_service_stop_fails() {
        assert!(
            !should_abort_exit_after_cleanup(false, true),
            "Quit anyway already accepted a still-armed barrier"
        );
        assert!(!should_abort_exit_after_cleanup(true, true));
    }

    #[test]
    fn restart_release_wait_is_bounded_like_quit() {
        assert_eq!(INTERACTIVE_QUIT_RELEASE_BUDGET, Duration::from_secs(8));
        assert!(interactive_release_wait_error::<()>(Ok(Ok(()))).is_none());
        assert_eq!(
            interactive_release_wait_error::<()>(Ok(Err("ipc down".into()))).as_deref(),
            Some("ipc down")
        );
        let timed_out = interactive_release_wait_error::<()>(Err(())).expect("timeout is unproven");
        assert!(
            timed_out.contains("8s"),
            "the click-level message must name the budget, got {timed_out}"
        );
    }

    #[test]
    fn refusal_dialog_promises_protection_only_for_a_live_barrier_after_the_release_ended() {
        fn status(wanted: bool, live: bool) -> KillSwitchStatus {
            KillSwitchStatus {
                wanted,
                verified: wanted,
                live,
                mode: KillSwitchStatusMode::Blocked,
                tunnel_permit_rendered: false,
                endpoints: Vec::new(),
                direct_endpoint_digest: String::new(),
                last_error: None,
            }
        }
        let live = status(true, true);

        assert_eq!(classify_refusal(false, false, None), RefusalProtection::Unconfirmed);
        assert_eq!(
            classify_refusal(false, false, Some(&status(false, false))),
            RefusalProtection::Unconfirmed,
            "the Service reports protection off"
        );
        assert_eq!(
            classify_refusal(true, false, Some(&live)),
            RefusalProtection::ReleaseMayComplete,
            "a timed-out wait does not cancel the release"
        );
        assert_eq!(
            classify_refusal(false, true, Some(&live)),
            RefusalProtection::ReleaseMayComplete,
            "an error that did not join an in-flight release (update fence) is not its end"
        );
        assert_eq!(classify_refusal(false, false, Some(&live)), RefusalProtection::Held);
    }

    #[test]
    fn refusal_dialog_does_not_promise_protection_while_the_service_runs_a_mutation() {
        let snapshot = ServiceStatusSnapshot {
            snapshot_generation: 4,
            // Another user's release, or ours whose response was lost: not in this App's registry.
            active_operation: Some(ServiceOperationSnapshot {
                id: 7,
                kind: ServiceOperationKind::ReleaseKillSwitch,
                started_at_ms: 10,
                deadline_at_ms: 20,
            }),
            is_active: true,
            active_generation: Some(2),
            service_state: ServiceLifecycleState::Running,
            core_pid: Some(1234),
            core_generation: 1,
            core_started_at: None,
            last_core_exit_reason: None,
            restart_count: 0,
            last_recovery_at: None,
            desired_core_should_be_running: true,
            desired_generation: 3,
            desired_updated_at: 0,
            desired_state_unknown: false,
            macos_kill_switch_wanted: false,
            macos_kill_switch_live: false,
            macos_kill_switch_mode: Default::default(),
            kill_switch: Some(KillSwitchStatus {
                wanted: true,
                verified: true,
                live: true,
                mode: KillSwitchStatusMode::Blocked,
                tunnel_permit_rendered: false,
                endpoints: Vec::new(),
                direct_endpoint_digest: String::new(),
                last_error: None,
            }),
            network_events: Default::default(),
        };
        assert_eq!(
            classify_service_refusal(false, Some(&snapshot)),
            RefusalProtection::ReleaseMayComplete
        );
    }

    #[tokio::test]
    async fn interactive_cleanup_awaits_barrier_controlled_stop_without_cancellation() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let stop_started = Arc::new(Barrier::new(2));
        let release_stop = Arc::new(Barrier::new(2));
        let stop_cancelled = Arc::new(AtomicBool::new(false));
        let stop_completed = Arc::new(AtomicBool::new(false));

        let mut cleanup = Box::pin(run_interactive_cleanup_transition(
            {
                let calls = Arc::clone(&calls);
                let stop_started = Arc::clone(&stop_started);
                let release_stop = Arc::clone(&release_stop);
                let stop_cancelled = Arc::clone(&stop_cancelled);
                let stop_completed = Arc::clone(&stop_completed);
                move || async move {
                    let _probe = CancellationProbe {
                        cancelled: stop_cancelled,
                        completed: Arc::clone(&stop_completed),
                    };
                    calls.lock().push("core_stop");
                    stop_started.wait().await;
                    release_stop.wait().await;
                    stop_completed.store(true, Ordering::Release);
                    true
                }
            },
            {
                let calls = Arc::clone(&calls);
                move || async move {
                    calls.lock().push("ancillary_cleanup");
                    true
                }
            },
        ));

        assert!(matches!(futures::poll!(cleanup.as_mut()), Poll::Pending));
        stop_started.wait().await;
        assert!(matches!(futures::poll!(cleanup.as_mut()), Poll::Pending));
        assert!(!stop_cancelled.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["core_stop"]);

        release_stop.wait().await;
        let result = cleanup.await;

        assert!(result.core_stopped);
        assert!(result.all_success);
        assert!(!stop_cancelled.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["core_stop", "ancillary_cleanup"]);
    }

    #[tokio::test]
    async fn interactive_cleanup_does_not_run_ancillary_cleanup_after_stop_failure() {
        let calls = Mutex::new(Vec::new());

        let result = run_interactive_cleanup_transition(
            || async {
                calls.lock().push("core_stop");
                false
            },
            || async {
                calls.lock().push("ancillary_cleanup");
                true
            },
        )
        .await;

        assert!(!result.core_stopped);
        assert!(!result.all_success);
        assert_eq!(&*calls.lock(), &["core_stop"]);
    }

    #[tokio::test]
    async fn session_ending_cleanup_may_cancel_stop_and_skips_ancillary_after_timeout() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let stop_started = Arc::new(Barrier::new(2));
        let deadline_started = Arc::new(Barrier::new(2));
        let release_deadline = Arc::new(Barrier::new(2));
        let stop_cancelled = Arc::new(AtomicBool::new(false));
        let stop_completed = Arc::new(AtomicBool::new(false));

        let mut cleanup = Box::pin(run_session_ending_cleanup_transition(
            {
                let calls = Arc::clone(&calls);
                let stop_started = Arc::clone(&stop_started);
                let stop_cancelled = Arc::clone(&stop_cancelled);
                let stop_completed = Arc::clone(&stop_completed);
                move || async move {
                    let _probe = CancellationProbe {
                        cancelled: stop_cancelled,
                        completed: stop_completed,
                    };
                    calls.lock().push("core_stop");
                    stop_started.wait().await;
                    pending::<bool>().await
                }
            },
            {
                let deadline_started = Arc::clone(&deadline_started);
                let release_deadline = Arc::clone(&release_deadline);
                async move {
                    deadline_started.wait().await;
                    release_deadline.wait().await;
                }
            },
            {
                let calls = Arc::clone(&calls);
                move || async move {
                    calls.lock().push("ancillary_cleanup");
                    true
                }
            },
        ));

        assert!(matches!(futures::poll!(cleanup.as_mut()), Poll::Pending));
        stop_started.wait().await;
        deadline_started.wait().await;
        assert!(matches!(futures::poll!(cleanup.as_mut()), Poll::Pending));
        assert!(!stop_cancelled.load(Ordering::Acquire));

        release_deadline.wait().await;
        let result = cleanup.await;

        assert!(!result.core_stopped);
        assert!(!result.all_success);
        assert!(stop_cancelled.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["core_stop"]);
    }
}
