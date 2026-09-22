//! Explicit release and disconnect. Failures stay armed; only this path restores direct traffic.

use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tono_logging::{Type, logging};
#[cfg(not(windows))]
use crate::core::{CoreManager, manager::RunningMode};
use crate::core::service;
use crate::process::AsyncHandler;
use crate::tono::{audit::AuditEvent, commands, state::{LifecycleOperation, TonoState}};
#[cfg(not(windows))]
use crate::tono::connection_plan::stop_core_before_release;
use super::controller::fetch_connections;

/// UI budget for an explicit release. The ordered DNS → Core → WFP sequence runs in a detached
/// reconciliation task, so reaching this budget stops waiting but never cancels a safety step.
///
/// D1 — 30 s was below the Service's own reality, so the user was told the disconnect had failed
/// while the detached worker completed fine seconds later. One Service-side release runs a DNS
/// restore (two 10 s PowerShell batches plus two 25 s-budgeted engine reads, Service-side leg
/// budget 40 s — `service/src/core/dns.rs` / `windows_kill_switch::DNS_RESTORE_TIMEOUT`), a core
/// stop (≤ 3 s plus a watchdog join) and a WFP transaction. 40 + 3 + ~12 of stop/WFP/IPC
/// overhead ⇒ 55 s, which must stay strictly under the IPC client's own 65 s
/// (`service/src/client/mod.rs` `LIFECYCLE_TIMEOUT`) so a genuine hang is reported by the client
/// with its real cause rather than by this UI deadline.
pub(super) const EXPLICIT_RELEASE_TIMEOUT: Duration = Duration::from_secs(55);

/// The IPC client's own lifecycle budget. Mirrored here only so the invariant
/// `EXPLICIT_RELEASE_TIMEOUT < LIFECYCLE_TIMEOUT` is asserted rather than assumed.
#[cfg(test)]
pub(super) const SERVICE_LIFECYCLE_TIMEOUT: Duration = Duration::from_secs(65);

/// Explicit user release (Disconnect / Sign Out / Quit, §6; C1).
///
/// Windows executes DNS restore → matching Core stop/retire → WFP removal inside one owner-gated
/// Service handler, including from Protected Offline where the arming session is gone. Every
/// caller joins one App-side operation; its UI deadline never cancels the worker. A failed release
/// keeps the system armed and surfaces an error.
pub async fn release_explicit(state: &Arc<TonoState>, app: &AppHandle) -> Result<(), String> {
    release_explicit_with_guard(state, app, None).await
}

/// Account teardown must own the release, not just the UI's wait for it.
pub(crate) async fn release_for_account(state: &Arc<TonoState>, app: &AppHandle) -> Result<(), String> {
    let operation = start_explicit_release(state, app, None, false).await;
    complete_account_release(&operation).await
}

pub(crate) async fn complete_account_release(operation: &LifecycleOperation) -> Result<(), String> {
    operation.wait().await
}

/// Transfer failure's exclusive ownership to release, rather than reacquiring the same writer.
pub(super) async fn release_explicit_with_guard(
    state: &Arc<TonoState>, app: &AppHandle,
    guard: Option<tokio::sync::OwnedRwLockWriteGuard<()>>,
) -> Result<(), String> {
    let operation = start_explicit_release(state, app, guard, false).await;
    wait_explicit_release(&operation).await
}

async fn start_explicit_release(
    state: &Arc<TonoState>, app: &AppHandle,
    guard: Option<tokio::sync::OwnedRwLockWriteGuard<()>>,
    explicit_disconnect: bool,
) -> Arc<LifecycleOperation> {
    let worker_state = Arc::clone(state);
    let worker_app = app.clone();
    let task_state = Arc::clone(state);
    let task_app = app.clone();
    coordinate_release(state, guard,
        move |guard| async move {
            run_release_sequence(&worker_state, &worker_app, guard, explicit_disconnect).await
        },
        move || async move {
            let inner = task_state.lock().await;
            commands::emit_status(&task_app, &commands::status_of(&inner));
        },
    ).await
}

async fn wait_explicit_release(operation: &LifecycleOperation) -> Result<(), String> {
    match tokio::time::timeout(EXPLICIT_RELEASE_TIMEOUT, operation.wait()).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "release exceeded {EXPLICIT_RELEASE_TIMEOUT:?}; ordered background reconciliation continues and protection is assumed on until proven otherwise"
        )),
    }
}

/// Register and supervise exactly one real release. A joining failure drops its transferred
/// writer before waiting, allowing the existing worker to acquire it. No generation-based skip
/// can complete this operation: every joiner observes the actual release result.
pub(crate) async fn coordinate_release<F, C, S, SF>(
    state: &Arc<TonoState>, guard: Option<tokio::sync::OwnedRwLockWriteGuard<()>>,
    sequence: C, settled: S,
) -> Arc<LifecycleOperation>
where
    C: FnOnce(tokio::sync::OwnedRwLockWriteGuard<()>) -> F + Send + 'static,
    F: std::future::Future<Output = Result<(), String>> + Send + 'static,
    S: FnOnce() -> SF + Send + 'static,
    SF: std::future::Future<Output = ()> + Send + 'static,
{
    let (operation, is_new) = state.begin_release().await;
    if is_new {
        let task_state = Arc::clone(state);
        let worker_state = Arc::clone(state);
        let worker = tauri::async_runtime::spawn(async move {
            let guard = match guard {
                Some(guard) => guard,
                None => worker_state.begin_privileged_release().await,
            };
            let (generation, disconnecting, connected_at, secret, port) = {
                let inner = worker_state.lock().await;
                (inner.connect_generation, inner.fsm.status().is_disconnecting, inner.connected_at,
                    inner.controller_secret.clone(), inner.controller_port)
            };
            // The release, not its UI waiter, owns the bounded final sample too. Sampling never
            // delays dispatch of DNS/Core/WFP teardown and cannot mutate a replacement ledger.
            let (result, sample) = tokio::join!(sequence(guard), async {
                match (disconnecting, secret.as_deref(), port) {
                    (true, Some(secret), Some(port)) => fetch_connections(secret, port).await,
                    _ => None,
                }
            });
            if result.is_ok() {
                let mut inner = worker_state.lock().await;
                if inner.connect_generation == generation {
                    if let Some(payload) = sample.as_ref() {
                        worker_state.route_ledger().lock().ingest(payload);
                    }
                    if disconnecting {
                        worker_state.audit().log(AuditEvent::DisconnectOk {
                            elapsed_ms: super::session_elapsed_ms(connected_at),
                            bytes_up: sample.as_ref().map(|payload| payload.upload_total),
                            bytes_down: sample.as_ref().map(|payload| payload.download_total),
                        });
                    }
                }
                // Admission stays excluded by release_operation until ALL session metadata is
                // finalized. A cancelled/timed-out command has no remaining cleanup authority.
                inner.fsm.sign_out_or_quit();
                inner.controller_secret = None;
                inner.controller_port = None;
                inner.network_events_counter = None;
                inner.last_core_pid = None;
                inner.last_restart_count = None;
                inner.connected_at = None;
                inner.retry_attempt = 0;
                inner.next_retry_at_ms = None;
                worker_state.route_ledger().lock().clear_connection_counters();
            }
            result
        });
        let supervised_operation = Arc::clone(&operation);
        AsyncHandler::spawn(move || async move {
            let result = worker
                .await
                .map_err(|error| format!("release reconciliation task failed: {error}"))
                .and_then(|result| result);
            if let Err(message) = &result {
                task_state.lock().await.fsm.initial_release_failed();
                task_state
                    .audit()
                    .log(AuditEvent::ReleaseFail { error: message.clone() });
                logging!(error, Type::Service, "Tono: 安全释放对账失败: {message}");
            }
            task_state.finish_release(supervised_operation.id()).await;
            // A timed-out caller may no longer be present to repaint. Publish the final state (or
            // the still-protected failure state) after the coordinator has settled.
            settled().await;
            supervised_operation.complete(result);
        });
    } else {
        drop(guard);
    }
    operation
}

/// The release worker is never owned by one UI call. On Windows the owner-gated Service route is
/// already the transaction boundary: under one lifecycle lock it proves DNS restoration, stops
/// and retires the matching Core, then removes WFP. Calling those as three App-owned IPCs would
/// recreate a cancellation window between the steps. Other platforms retain their existing
/// helper sequence until their Service route provides the same complete stop semantics.
pub(super) async fn run_explicit_release_sequence(
    state: &Arc<TonoState>, app: &AppHandle,
    release_guard: tokio::sync::OwnedRwLockWriteGuard<()>,
) -> Result<(), String> {
    run_release_sequence(state, app, release_guard, false).await
}

async fn run_release_sequence(
    state: &Arc<TonoState>, _app: &AppHandle,
    _release_guard: tokio::sync::OwnedRwLockWriteGuard<()>,
    _explicit_disconnect: bool,
) -> Result<(), String> {
    // Wait for detached StartClash/DNS commits that began before the release generation bump.
    // Keeping this guard through the Service call also prevents a stale mutation from starting
    // between the wait and the atomic DNS/Core/WFP transaction.
    #[cfg(windows)]
    // An unprotected quit may have stopped the Service after the last release. Revive the
    // registered Service before asking its owner-gated endpoint to remove protection. This is
    // the path that hands the machine its Internet back, so it always gets its prompt: a repair
    // the user declined during a connect must not leave them hard-blocked with no way out.
    service::tono_service_ready_or_repair_now()
        .await
        .map_err(|error| format!("kill switch release failed; protection stays on: {error}"))?;

    #[cfg(windows)]
    let status = {
        // Only the user Disconnect command requests this durable release. Quit,
        // sign-out and automatic failure cleanup keep the pending-update fence.
        let update_release = if _explicit_disconnect {
            commands::update::disconnect_if_pending().await.map_err(|e| format!("update Disconnect remains unproven: {e:#}"))?
        } else { None };
        match update_release {
            Some(status) => status,
            None => service::tono_release_kill_switch().await
                .map_err(|error| format!("kill switch release failed; protection stays on: {error}"))?,
        }
    };

    #[cfg(not(windows))]
    let status = {
        service::tono_restore_protected_dns()
            .await
            .map_err(|error| format!("DNS restore failed; protection stays on: {error}"))?;
        let core_active = matches!(*CoreManager::global().get_running_mode(), RunningMode::Service);
        if stop_core_before_release(core_active, service::tono_session_live()) {
            let _ = service::tono_stop_core(false).await;
        }
        service::tono_release_kill_switch()
            .await
            .map_err(|error| format!("kill switch release failed; protection stays on: {error}"))?
    };

    if status.wanted || status.live {
        return Err(format!(
            "kill switch release returned an armed state (wanted={}, live={})",
            status.wanted, status.live
        ));
    }

    #[cfg(windows)]
    {
        let _ = crate::core::sysopt::Sysopt::global().reset_sysproxy().await;
    }

    let mut inner = state.lock().await;
    inner.kill_switch = Some(status);
    Ok(())
}

/// `tono_disconnect`: cancel the reconnect, then the explicit-release
/// sequence (DNS restore → core stop → owner-gated release, §6/C1).
/// Idempotent while a disconnect is already in flight (L6).
pub async fn disconnect(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    let operation = {
        let mut inner = state.lock().await;
        if inner.fsm.status().is_disconnecting {
            let operation = start_explicit_release(&state, &app, None, true).await;
            drop(inner);
            return wait_explicit_release(&operation).await;
        }
        inner.invalidate_connection(true);
        let status = inner.fsm.status();
        if !status.is_connected && !status.is_connecting && !status.is_protection_blocked
            && !commands::update::incomplete() {
            return Ok(());
        }
        inner.fsm.begin_disconnect();
        commands::emit_status(&app, &commands::status_of(&inner));
        // Register while the FSM lock still excludes admission. Sampling before registration
        // allowed a joining Disconnect/failure to finish release, admit B, then this caller's
        // delayed sample would dispatch another owner-wide release against B.
        start_explicit_release(&state, &app, None, true).await
    };
    state.audit().log(AuditEvent::DisconnectBegin { cause: "user" });
    wait_explicit_release(&operation).await
}

/// A releasing step failed mid-disconnect: fall back to Protected Offline
/// without ever disarming (§6). `initial_release_failed`, not
/// `connect_failed`: for an armed-but-unverified session the latter's
/// decision table resolves to FullRelease and clears the armed latch even
/// though the Service release just failed — the UI would show notConnected
/// over a still-blocking WFP barrier and `quit_release` would then skip the
/// release entirely. `initial_release_failed` keeps the real armed state
/// visible in every combination (and also clears a stuck `is_disconnecting`
/// when the release failed before any arm existed).
pub(super) async fn stay_armed_after_failed_release(state: &Arc<TonoState>, app: &AppHandle) {
    let mut inner = state.lock().await;
    inner.fsm.initial_release_failed();
    commands::emit_status(app, &commands::status_of(&inner));
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;

    #[tokio::test]
    async fn release_owner_finishes_session_metadata_after_the_ui_waiter_is_cancelled() {
        let state = Arc::new(TonoState::for_test());
        {
            let mut inner = state.lock().await;
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            inner.fsm.begin_disconnect();
            inner.connected_at = Some(std::time::Instant::now());
            inner.retry_attempt = 7;
            inner.next_retry_at_ms = Some(9876);
        }
        let (entered, at_release) = oneshot::channel();
        let (resume, resumed) = oneshot::channel();
        let (settled, settlement) = oneshot::channel();
        let operation = coordinate_release(&state, None,
            move |_guard| async move {
                entered.send(()).unwrap();
                resumed.await.unwrap();
                Ok(()) // A proven Service DNS/Core/WFP release, not a UI-only transition.
            },
            move || async move { settled.send(()).unwrap(); },
        ).await;
        at_release.await.unwrap();
        let waiter_operation = Arc::clone(&operation);
        let waiter = tokio::spawn(async move { waiter_operation.wait().await });
        waiter.abort();
        let _ = waiter.await;
        resume.send(()).unwrap();
        settlement.await.unwrap();
        operation.wait().await.unwrap();
        let inner = state.lock().await;
        assert!(inner.connected_at.is_none(), "the detached release owns the session clock too");
        assert_eq!(inner.retry_attempt, 0);
        assert!(inner.next_retry_at_ms.is_none());
        assert!(!inner.fsm.kill_switch_armed());
        assert!(!inner.fsm.status().is_disconnecting);
    }

    #[tokio::test]
    async fn failure_transfers_writer_and_disconnect_joins_the_real_release_result() {
        tokio::time::timeout(Duration::from_secs(5), async {
            let state = Arc::new(TonoState::for_test());
            let guard = state.begin_privileged_release().await;
            let (entered, at_release) = oneshot::channel();
            let (resume, resumed) = oneshot::channel();
            let (settled, settlement) = oneshot::channel();
            let failure = coordinate_release(&state, Some(guard),
                move |guard| async move {
                    entered.send(()).unwrap();
                    resumed.await.unwrap();
                    drop(guard);
                    Err("DNS restore failed; still protected".into())
                },
                move || async move { settled.send(()).unwrap(); },
            ).await;
            at_release.await.unwrap(); // would time out if transfer reacquired its own writer
            let disconnect = coordinate_release(&state, None,
                |_| async { panic!("Disconnect must join, not launch another release") },
                || async {},
            ).await;
            assert_eq!(failure.id(), disconnect.id());
            assert!(state.release_in_progress().await);
            let replacement = state.begin_connect_mutation();
            tokio::pin!(replacement);
            assert!(futures::poll!(&mut replacement).is_pending());
            resume.send(()).unwrap();
            assert_eq!(disconnect.wait().await, Err("DNS restore failed; still protected".into()));
            assert_eq!(failure.wait().await, disconnect.wait().await);
            settlement.await.unwrap();
            drop(replacement.await);

            // Opposite order: Disconnect registered first and waits for failure's held writer.
            // Joining must drop that writer, then report the actual failure, never stale-skip Ok.
            let guard = state.begin_privileged_release().await;
            let (entered, at_release) = oneshot::channel();
            let (resume, resumed) = oneshot::channel();
            let disconnect = coordinate_release(&state, None,
                move |guard| async move {
                    entered.send(()).unwrap();
                    resumed.await.unwrap();
                    drop(guard);
                    Err("release denied".into())
                },
                || async {},
            ).await;
            let failure = coordinate_release(&state, Some(guard),
                |_| async { panic!("failure must join the existing release") },
                || async {},
            ).await;
            at_release.await.unwrap();
            assert_eq!(failure.id(), disconnect.id());
            resume.send(()).unwrap();
            assert_eq!(failure.wait().await, Err("release denied".into()));
            assert_eq!(disconnect.wait().await, failure.wait().await);
        }).await.expect("guard transfer and both coordinator join orders must not deadlock");
    }
}
