//! Explicit release and disconnect. Failures stay armed; only this path restores direct traffic.

use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tono_logging::{Type, logging};
#[cfg(not(windows))]
use crate::core::{CoreManager, manager::RunningMode};
use crate::core::service;
use crate::process::AsyncHandler;
use crate::tono::{audit::AuditEvent, commands, state::{ReleaseOperation, TonoState}};
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

/// Transfer failure's exclusive ownership to release, rather than reacquiring the same writer.
pub(super) async fn release_explicit_with_guard(
    state: &Arc<TonoState>, app: &AppHandle,
    guard: Option<tokio::sync::OwnedRwLockWriteGuard<()>>,
) -> Result<(), String> {
    let operation = start_explicit_release(state, app, guard).await;
    wait_explicit_release(&operation).await
}

async fn start_explicit_release(
    state: &Arc<TonoState>, app: &AppHandle,
    guard: Option<tokio::sync::OwnedRwLockWriteGuard<()>>,
) -> Arc<ReleaseOperation> {
    let worker_state = Arc::clone(state);
    let worker_app = app.clone();
    let task_state = Arc::clone(state);
    let task_app = app.clone();
    coordinate_release(state, guard,
        move |guard| async move {
            run_explicit_release_sequence(&worker_state, &worker_app, guard).await
        },
        move || async move {
            let inner = task_state.lock().await;
            commands::emit_status(&task_app, &commands::status_of(&inner));
        },
    ).await
}

async fn wait_explicit_release(operation: &ReleaseOperation) -> Result<(), String> {
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
async fn coordinate_release<F, C, S, SF>(
    state: &Arc<TonoState>, guard: Option<tokio::sync::OwnedRwLockWriteGuard<()>>,
    sequence: C, settled: S,
) -> Arc<ReleaseOperation>
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
            sequence(guard).await
        });
        let supervised_operation = Arc::clone(&operation);
        AsyncHandler::spawn(move || async move {
            let result = worker
                .await
                .map_err(|error| format!("release reconciliation task failed: {error}"))
                .and_then(|result| result);
            if let Err(message) = &result {
                task_state
                    .audit()
                    .log(AuditEvent::ReleaseFail { error: message.clone() });
                logging!(error, Type::Service, "Tono: 安全释放对账失败: {message}");
            }
            supervised_operation.complete(result);
            task_state.finish_release(supervised_operation.id()).await;
            // A timed-out caller may no longer be present to repaint. Publish the final state (or
            // the still-protected failure state) after the coordinator has settled.
            settled().await;
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
    _release_guard: tokio::sync::OwnedRwLockWriteGuard<()>,
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
    let status = service::tono_release_kill_switch()
        .await
        .map_err(|error| format!("kill switch release failed; protection stays on: {error}"))?;

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
    inner.controller_secret = None;
    inner.controller_port = None;
    inner.network_events_counter = None;
    inner.last_core_pid = None;
    inner.last_restart_count = None;
    // Also closes a caller that reached its UI budget and temporarily surfaced Protected
    // Offline; this transition is allowed only after the Service proved WFP is gone. A new
    // connect cannot race this commit because `guard_snapshot` rejects while the coordinator is
    // populated.
    inner.fsm.sign_out_or_quit();
    commands::emit_status(app, &commands::status_of(&inner));
    Ok(())
}

/// `tono_disconnect`: cancel the reconnect, then the explicit-release
/// sequence (DNS restore → core stop → owner-gated release, §6/C1).
/// Idempotent while a disconnect is already in flight (L6).
pub async fn disconnect(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    let (controller_secret, controller_port, connected_at, generation, operation) = {
        let mut inner = state.lock().await;
        if inner.fsm.status().is_disconnecting {
            let operation = start_explicit_release(&state, &app, None).await;
            drop(inner);
            return wait_explicit_release(&operation).await;
        }
        inner.invalidate_connection(true);
        let status = inner.fsm.status();
        if !status.is_connected && !status.is_connecting && !status.is_protection_blocked {
            return Ok(());
        }
        inner.fsm.begin_disconnect();
        commands::emit_status(&app, &commands::status_of(&inner));
        // Register while the FSM lock still excludes admission. Sampling before registration
        // allowed a joining Disconnect/failure to finish release, admit B, then this caller's
        // delayed sample would dispatch another owner-wide release against B.
        let operation = start_explicit_release(&state, &app, None).await;
        (
            inner.controller_secret.clone(),
            inner.controller_port,
            inner.connected_at,
            inner.connect_generation,
            operation,
        )
    };
    state.audit().log(AuditEvent::DisconnectBegin { cause: "user" });

    // Best-effort sample races the registered teardown. Missing counters must not delay the
    // privileged release or launch a second release after a joined operation already settled.
    let elapsed_ms = super::session_elapsed_ms(connected_at);
    let sample = match (controller_secret.as_deref(), controller_port) {
        (Some(secret), Some(port)) => fetch_connections(secret, port).await,
        _ => None,
    };
    if let Some(payload) = sample.as_ref() {
        state.route_ledger().lock().ingest(payload);
    }
    let bytes_up = sample.as_ref().map(|payload| payload.upload_total);
    let bytes_down = sample.as_ref().map(|payload| payload.download_total);

    if let Err(err) = wait_explicit_release(&operation).await {
        let mut inner = state.lock().await;
        if inner.connect_generation == generation {
            inner.fsm.initial_release_failed();
            commands::emit_status(&app, &commands::status_of(&inner));
        }
        return Err(err);
    }

    let mut inner = state.lock().await;
    if inner.connect_generation != generation {
        return Ok(());
    }
    inner.fsm.finish_disconnect();
    inner.controller_secret = None;
    inner.controller_port = None;
    inner.kill_switch = None;
    inner.network_events_counter = None;
    inner.last_core_pid = None;
    inner.last_restart_count = None;
    inner.connected_at = None;
    // F3: a user disconnect supersedes the backoff state.
    inner.retry_attempt = 0;
    inner.next_retry_at_ms = None;
    commands::emit_status(&app, &commands::status_of(&inner));
    drop(inner);
    state.route_ledger().lock().clear_connection_counters();
    state.audit().log(AuditEvent::DisconnectOk {
        elapsed_ms,
        bytes_up,
        bytes_down,
    });
    Ok(())
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
