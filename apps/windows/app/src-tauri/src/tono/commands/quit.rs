//! Domain Tauri commands. Wire names stay unchanged.

use std::{net::SocketAddr, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager as _};
use tono_logging::{Type, logging};
use tono_core::{
    auth::{ApiError, DEFAULT_DEVICE_LIMIT, User, normalize_installation_id},
    connection::{ConnectStage, UiState},
    credentials::{CredentialKey, CredentialStore as _},
};
use crate::{
    core::service,
    process::AsyncHandler,
    tono::{
        audit::AuditEvent,
        catalog_sync, connection,
        credentials::TonoCredentialStore,
        state::{AccountState, TonoInner, TonoState},
    },
};
use super::*;

/// The protected-state predicate of the quit path: the machine is protected while the kill
/// switch is armed or a (dis)connection is in flight. Shared by `quit_release` and
/// `quit_protection_active` so "protected" can never drift between the release decision and the
/// service-stop decision.
fn fsm_reports_protection(inner: &TonoInner) -> bool {
    inner.fsm.kill_switch_armed()
        || inner.fsm.status().is_connected
        || inner.fsm.status().is_connecting
        || inner.fsm.status().is_protection_blocked
}


pub async fn quit_protection_active(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return false;
    };
    let inner = state.lock().await;
    fsm_reports_protection(&inner)
}

/// Whether asking the Service to stop itself on an unprotected quit is permitted. The durable
/// desired state must be proven "core should not be running": stopping the Windows service does
/// not rewrite the desired-state file, so stopping it while `core_should_be_running` is true (or
/// unreadable) would let the next service start resurrect a core the user already stopped. The
/// Service enforces the same check server-side (`owner_goodbye_verdict`); this client-side
/// pre-check is the fast path that keeps the quit log truthful.
#[cfg(any(windows, test))]
pub(super) fn service_stop_permitted_on_quit(
    desired_state_unknown: bool,
    desired_core_should_be_running: bool,
) -> bool {
    !desired_state_unknown && !desired_core_should_be_running
}

/// Unprotected interactive quit on Windows: ask TonoService to stop ITSELF over IPC
/// (`POST /lifecycle/owner-goodbye`), so no daemon lingers after the App exits. The direct SCM
/// stop this replaced cannot work — the App runs as a plain user and `OpenService(STOP)` on a
/// SYSTEM-owned service is `os error 5` — while the Service can always stop itself. The route
/// refuses (409) whenever the kill switch is armed or the desired state wants the core, so
/// connected/protected state is safe even if the local pre-check raced. Best-effort: the exit
/// is already committed, so every refusal or transport failure is logged, never propagated.
pub async fn stop_service_on_unprotected_quit() {
    #[cfg(windows)]
    {
        match service::tono_service_status_snapshot().await {
            Ok(snapshot)
                if service_stop_permitted_on_quit(
                    snapshot.desired_state_unknown,
                    snapshot.desired_core_should_be_running,
                ) => {}
            Ok(snapshot) => {
                logging!(
                    info,
                    Type::Service,
                    "Tono: 退出时保留 TonoService 运行：desired state 未证明 core 已停 \
                     (desired_core_should_be_running={}, desired_state_unknown={})",
                    snapshot.desired_core_should_be_running,
                    snapshot.desired_state_unknown
                );
                return;
            }
            Err(error) => {
                // IPC unanswered: the Service is either already stopped (goodbye would be a
                // no-op anyway) or wedged with an unprovable desired state. Skip rather than
                // strand a stale `core_should_be_running = true`.
                logging!(
                    info,
                    Type::Service,
                    "Tono: 服务未应答 IPC，退出时跳过服务自停（服务已停止或状态不可证明）: {error:#}"
                );
                return;
            }
        }
        match service::tono_request_service_owner_goodbye().await {
            Ok(()) => logging!(
                info,
                Type::Service,
                "Tono: 未连接状态退出，已通过 IPC 请求 TonoService 自停（下次连接会按需修复并拉起）"
            ),
            Err(error) => logging!(
                warn,
                Type::Service,
                "Tono: 退出时请求服务自停失败（退出继续进行）: {error:#}"
            ),
        }
    }
}

#[tauri::command]
pub async fn tono_prepare_update(
    state: tauri::State<'_, Arc<TonoState>>,
    next_version: String,
) -> Result<(), String> {
    let inner = state.lock().await;
    if next_version.trim().is_empty() {
        return Err("TONO_UPDATE_VERSION_REQUIRED".into());
    }
    let previous = env!("CARGO_PKG_VERSION");
    let mut journal = crate::tono::update_handoff::prepare(
        previous,
        next_version.trim(),
        inner.connect_generation,
        inner.fsm.status().is_connected,
        inner.fsm.kill_switch_armed(),
    );
    journal.selected_node_anonymous_id = inner.selected_node.clone();
    journal.catalog_revision = Some(inner.catalog_tracker.current_revision());
    journal.helper_protocol_version = tono_service_protocol::PROTOCOL_REVISION.to_string();
    journal.build_commit = option_env!("VERGEN_GIT_SHA")
        .or(option_env!("GITHUB_SHA"))
        .unwrap_or("")
        .to_string();
    crate::tono::update_handoff::save_prepared(&journal)
        .map_err(|error| format!("TONO_UPDATE_JOURNAL: {error}"))?;
    Ok(())
}

/// Explicit Quit/restart release (§6, L1): bump the generation, abort every task, then join the
/// single-flight explicit-release sequence. A preventable interactive exit is cancelled when
/// release cannot be proven; the unpreventable WM_ENDSESSION path applies its own short outer
/// budget in the run-event handler.
pub async fn quit_release(app: AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return Ok(());
    };
    let protected = {
        let mut inner = state.lock().await;
        inner.invalidate_connection(true);
        inner.tasks.abort_catalog_sync();
        fsm_reports_protection(&inner)
    };
    if protected {
        connection::release_explicit(&state, &app).await
    } else {
        Ok(())
    }
}

/// M3: exit is *committed* (RunEvent::Exit) — close the audit channel so
/// the writer drains, then wait for it (bounded). Kept strictly apart from
/// `quit_release`: a cancelled quit must not kill the audit trail.
pub async fn flush_audit_for_exit(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return;
    };
    state.audit().close_sender();
    if let Some(writer) = state.audit().take_writer() {
        let _ = tokio::time::timeout(AUDIT_FLUSH_BUDGET, writer).await;
    }
}

/// M3: the quit path was cancelled after `quit_release` already ran — the
/// barrier may really be gone while the FSM still claims protection.
/// Re-sync from the Service so the UI shows the truth.
pub async fn resync_after_cancelled_quit(app: AppHandle) {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return;
    };
    let kill_switch = service::tono_service_status_snapshot()
        .await
        .ok()
        .and_then(|snapshot| snapshot.kill_switch);
    let mut inner = state.lock().await;
    match kill_switch {
        Some(status) if status.wanted => {
            inner.cancel_server_tests();
            // Still armed (the release failed or never ran): reflect it.
            if status.verified {
                inner.fsm.mark_session_verified();
            }
            if !inner.fsm.kill_switch_armed() {
                inner.fsm.mark_kill_switch_armed();
            }
            inner.kill_switch = Some(status);
        }
        Some(_) => {
            // Verifiably disarmed: converge the FSM to released.
            inner.kill_switch = None;
            if inner.fsm.kill_switch_armed()
                || inner.fsm.status().is_connected
                || inner.fsm.status().is_protection_blocked
            {
                inner.fsm.sign_out_or_quit();
            }
        }
        None => {
            // No WFP answer (other platform or IPC down): keep the local
            // view and just re-emit below.
        }
    }
    emit_status(&app, &status_of(&inner));
}
