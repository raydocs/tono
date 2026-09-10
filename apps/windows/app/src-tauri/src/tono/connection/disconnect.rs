//! Explicit release and disconnect. Failures stay armed; only this path restores direct traffic.

use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tono_logging::{Type, logging};
#[cfg(not(windows))]
use crate::core::{CoreManager, manager::RunningMode};
use crate::core::service;
use crate::process::AsyncHandler;
use crate::tono::{audit::AuditEvent, commands, state::TonoState};
#[cfg(not(windows))]
use crate::tono::connection_plan::stop_core_before_release;
use super::{BoxedTask, fail_connect};
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
    let (operation, is_new) = state.begin_release().await;
    if is_new {
        let task_state = Arc::clone(state);
        let task_app = app.clone();
        let worker_state = Arc::clone(state);
        let worker_app = app.clone();
        let worker =
            tauri::async_runtime::spawn(async move { run_explicit_release_sequence(&worker_state, &worker_app).await });
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
            let inner = task_state.lock().await;
            commands::emit_status(&task_app, &commands::status_of(&inner));
        });
    }

    match tokio::time::timeout(EXPLICIT_RELEASE_TIMEOUT, operation.wait()).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "release exceeded {EXPLICIT_RELEASE_TIMEOUT:?}; ordered background reconciliation continues and protection is assumed on until proven otherwise"
        )),
    }
}

/// The release worker is never owned by one UI call. On Windows the owner-gated Service route is
/// already the transaction boundary: under one lifecycle lock it proves DNS restoration, stops
/// and retires the matching Core, then removes WFP. Calling those as three App-owned IPCs would
/// recreate a cancellation window between the steps. Other platforms retain their existing
/// helper sequence until their Service route provides the same complete stop semantics.
pub(super) async fn run_explicit_release_sequence(state: &Arc<TonoState>, app: &AppHandle) -> Result<(), String> {
    // Wait for detached StartClash/DNS commits that began before the release generation bump.
    // Keeping this guard through the Service call also prevents a stale mutation from starting
    // between the wait and the atomic DNS/Core/WFP transaction.
    let _release_guard = state.begin_privileged_release().await;

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
    let (controller_secret, controller_port, connected_at) = {
        let mut inner = state.lock().await;
        if inner.fsm.status().is_disconnecting {
            return Ok(());
        }
        inner.invalidate_connection(true);
        let status = inner.fsm.status();
        if !status.is_connected && !status.is_connecting && !status.is_protection_blocked {
            return Ok(());
        }
        inner.fsm.begin_disconnect();
        commands::emit_status(&app, &commands::status_of(&inner));
        (
            inner.controller_secret.clone(),
            inner.controller_port,
            inner.connected_at,
        )
    };
    state.audit().log(AuditEvent::DisconnectBegin { cause: "user" });

    // Sample before tearing the core down. A failed sample must not stall or
    // fail the user's disconnect: elapsed/bytes stay None and we continue.
    let elapsed_ms = connected_at.map(|at| at.elapsed().as_millis() as u64);
    let sample = match (controller_secret.as_deref(), controller_port) {
        (Some(secret), Some(port)) => fetch_connections(secret, port).await,
        _ => None,
    };
    if let Some(payload) = sample.as_ref() {
        state.route_ledger().lock().ingest(payload);
    }
    let bytes_up = sample.as_ref().map(|payload| payload.upload_total);
    let bytes_down = sample.as_ref().map(|payload| payload.download_total);

    if let Err(err) = release_explicit(&state, &app).await {
        stay_armed_after_failed_release(&state, &app).await;
        return Err(err);
    }

    let mut inner = state.lock().await;
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
