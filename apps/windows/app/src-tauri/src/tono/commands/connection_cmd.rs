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

/// Run the §6 connect transaction.
#[tauri::command]
pub async fn tono_connect(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    connection::connect(state.inner().clone(), app).await
}

/// Explicit disconnect: restores DNS, then releases the kill switch (§6).
#[tauri::command]
pub async fn tono_disconnect(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    connection::disconnect(state.inner().clone(), app).await
}

/// F3 connect progress for the steps UI. Semantics: the *latest*
/// transaction's record — during an attempt it shows live step state; after
/// success all steps read completed; after a failure the failed step and
/// the sanitized error persist until the next attempt resets them; before
/// the first attempt all steps read pending.
///
/// TS: `interface TonoConnectStep { key: string; label: string; state: "pending" | "current" | "completed" | "failed"; elapsedMs: number | null }`
/// TS: `interface TonoConnectProgress { steps: TonoConnectStep[]; totalElapsedMs: number | null; failedStage: string | null; error: string | null; retryAttempt: number; nextRetryAtMs: number | null }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoConnectProgress {
    pub steps: Vec<crate::tono::steps::StepRecord>,
    pub total_elapsed_ms: Option<u64>,
    pub failed_stage: Option<String>,
    pub error: Option<String>,
    pub retry_attempt: u32,
    pub next_retry_at_ms: Option<i64>,
}

/// Connect progress (F3).
#[tauri::command]
pub async fn tono_connect_progress(state: tauri::State<'_, Arc<TonoState>>) -> Result<TonoConnectProgress, String> {
    let inner = state.lock().await;
    let current_elapsed_ms = inner
        .step_started_at
        .map(|started| started.elapsed().as_millis() as u64);
    let steps = crate::tono::steps::snapshot_with_current_elapsed(&inner.connect_steps, current_elapsed_ms);
    Ok(TonoConnectProgress {
        total_elapsed_ms: crate::tono::steps::total_elapsed_ms(&steps),
        steps,
        failed_stage: inner.failed_stage.map(str::to_string),
        error: inner.connect_error.clone(),
        retry_attempt: inner.retry_attempt,
        next_retry_at_ms: inner.next_retry_at_ms,
    })
}

/// F3: abort any scheduled reconnect and run one immediately (the normal
/// predicate still applies — armed + idle Protected Offline + no pending
/// catalog choice). Connected/Connecting is a success no-op.
#[tauri::command]
pub async fn tono_retry_now(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    retry_now(state.inner().clone(), app).await
}

/// Shared Protected Offline retry entry for IPC and native surfaces such as the tray. Keeping
/// this beside the command prevents either caller from bypassing the reconnect predicate.
pub async fn retry_now(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    {
        let mut inner = state.lock().await;
        if connection::retry_now_is_noop(inner.fsm.status()) {
            return Ok(());
        }
        inner.tasks.abort_reconnect();
    }
    // Not `schedule_reconnect`: that consumes a rung of the backoff ladder, so
    // aborting the pending attempt and then asking for the *next* delay made this
    // button strictly delay recovery.
    connection::retry_reconnect_now(&state, &app).await;
    Ok(())
}

/// Current product status (also pushed on `tono://status`).
#[tauri::command]
pub async fn tono_status(state: tauri::State<'_, Arc<TonoState>>) -> Result<TonoStatus, String> {
    note_frontend_ipc();
    if let Some(status) = STATUS_SNAPSHOT.load_full() {
        return Ok((*status).clone());
    }
    let inner = state.lock().await;
    Ok(status_of(&inner))
}

/// Close one connection only on the controller generation that supplied its row.
#[tauri::command]
pub async fn tono_close_connection(
    state: tauri::State<'_, Arc<TonoState>>,
    id: String,
    controller_generation: u64,
) -> Result<(), String> {
    connection::close_owned_controller_connection(&state, controller_generation, Some(&id)).await
}

/// Close all connections only on the controller generation represented by the Activity page.
#[tauri::command]
pub async fn tono_close_all_connections(
    state: tauri::State<'_, Arc<TonoState>>,
    controller_generation: u64,
) -> Result<(), String> {
    connection::close_owned_controller_connection(&state, controller_generation, None).await
}
