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

/// §8: whether the local traffic audit is enabled (default on).
#[tauri::command]
pub async fn tono_audit_enabled(state: tauri::State<'_, Arc<TonoState>>) -> Result<bool, String> {
    Ok(state.audit().enabled())
}

/// §8: toggle the local traffic audit; persisted atomically to
/// `tono/settings.json` (L3: a persistence failure surfaces as an error and
/// leaves the switch as it was).
#[tauri::command]
pub async fn tono_set_audit_enabled(state: tauri::State<'_, Arc<TonoState>>, enabled: bool) -> Result<(), String> {
    state.audit().set_enabled(enabled)
}

/// Whether periodic cloud diagnostic timeline upload is enabled (default OFF).
#[tauri::command]
pub async fn tono_periodic_telemetry_enabled(
    state: tauri::State<'_, Arc<TonoState>>,
) -> Result<bool, String> {
    Ok(state.audit().periodic_telemetry_enabled())
}

/// Toggle periodic cloud diagnostic timeline upload (user can disable anytime).
#[tauri::command]
pub async fn tono_set_periodic_telemetry_enabled(
    state: tauri::State<'_, Arc<TonoState>>,
    enabled: bool,
) -> Result<(), String> {
    state.audit().set_periodic_telemetry_enabled(enabled)
}

/// Whether the raw audit log is uploaded.
#[tauri::command]
pub async fn tono_network_log_upload_enabled(
    state: tauri::State<'_, Arc<TonoState>>,
) -> Result<bool, String> {
    Ok(state.audit().network_log_upload_enabled())
}

/// Toggle uploading the raw audit log. Separate from the telemetry switch on
/// purpose: this one sends the log itself, and one consent must not stand in for
/// a materially larger disclosure.
#[tauri::command]
pub async fn tono_set_network_log_upload_enabled(
    state: tauri::State<'_, Arc<TonoState>>,
    enabled: bool,
) -> Result<(), String> {
    state.audit().set_network_log_upload_enabled(enabled)
}

/// §8: the JSONL audit file info (for the settings page / support bundle).
///
/// TS: `interface TonoAuditLogInfo { path: string; droppedCount: number }`
/// NOTE: this replaces the previous plain-string return of this command
/// (L2: the drop count is now observable); the frontend consumer must be
/// updated in step.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoAuditLogInfo {
    pub path: String,
    pub dropped_count: u64,
}

/// §8: the JSONL audit file path plus the dropped-event counter.
#[tauri::command]
pub async fn tono_audit_log_path(state: tauri::State<'_, Arc<TonoState>>) -> Result<TonoAuditLogInfo, String> {
    Ok(TonoAuditLogInfo {
        path: state.audit().log_path().to_string_lossy().into_owned(),
        dropped_count: state.audit().dropped_count(),
    })
}

// ---- Diagnostics (user-initiated upload) ----

/// How long a single environment probe (Service protocol, DNS status) may
/// take before the report simply records "unknown" for it. Assembling
/// diagnostics must never hang the very UI the user reached for when
/// everything else is already broken.
const DIAGNOSTICS_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The receipt the intake returns.
///
/// TS: `interface TonoDiagnosticsReceipt { referenceCode: string; receivedAt: number | null }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoDiagnosticsReceipt {
    pub reference_code: String,
    pub received_at: Option<i64>,
}

/// Assemble the whitelisted report (see `tono::diagnostics` for the privacy
/// contract). Shared by the preview command and the upload command so the
/// text the user is shown and the payload that is sent cannot drift.
async fn collect_diagnostics_report(
    state: &Arc<TonoState>,
    app: &AppHandle,
) -> crate::tono::diagnostics::DiagnosticsReport {
    // Probes first, with no product lock held: they talk to the Service.
    let protocol = tokio::time::timeout(DIAGNOSTICS_PROBE_TIMEOUT, tono_service_protocol::get_version())
        .await
        .ok()
        .and_then(Result::ok)
        .filter(|response| response.code == 0)
        .and_then(|response| response.data);
    let dns = tokio::time::timeout(DIAGNOSTICS_PROBE_TIMEOUT, service::tono_protected_dns_status())
        .await
        .ok()
        .and_then(Result::ok);
    // sysinfo's adapter walk and OS query are blocking syscalls.
    let (os_version, adapters) = AsyncHandler::spawn_blocking(|| {
        (
            tauri_plugin_tono_sysinfo::os_long_version(),
            tauri_plugin_tono_sysinfo::list_network_interfaces(),
        )
    })
    .await
    .unwrap_or_else(|_| ("Unknown".to_string(), Vec::new()));

    let audit_log_path = state.audit().log_path().to_path_buf();
    let service_log_path = crate::tono::diagnostics::service_log_path();
    let home = crate::tono::diagnostics::home_dir();
    let app_version = app.package_info().version.to_string();

    let inner = state.lock().await;
    let status = inner.fsm.status();
    let current_elapsed_ms = inner
        .step_started_at
        .map(|started| started.elapsed().as_millis() as u64);
    let steps = crate::tono::steps::snapshot_with_current_elapsed(&inner.connect_steps, current_elapsed_ms);
    let revision = inner.catalog_tracker.current_revision();
    // The live secret values, handed to the scrubber to be *subtracted* from
    // free text (never emitted). Structural rules cover what is not here.
    let mut known_secrets: Vec<String> = Vec::new();
    if let Some(secret) = &inner.controller_secret {
        known_secrets.push(secret.clone());
    }
    for node in &inner.nodes {
        known_secrets.push(node.uuid.clone());
        known_secrets.push(node.reality_public_key.clone());
        known_secrets.push(node.reality_short_id.clone());
        known_secrets.push(node.server.to_string());
    }
    if let Ok(Some(token)) = inner.credentials.refresh_token() {
        known_secrets.push(token);
    }
    crate::tono::diagnostics::build_report(&crate::tono::diagnostics::DiagnosticsSources {
        app_version: &app_version,
        os_version: &os_version,
        os_arch: std::env::consts::ARCH,
        service_protocol: protocol.as_ref(),
        ui_state: ui_state_key(status.ui_state()),
        account_state: inner.account_state.key(),
        selected_server: inner.selected_node.as_deref(),
        catalog_revision: (revision >= 0).then_some(revision),
        kill_switch: inner.kill_switch.as_ref(),
        dns: dns.as_ref(),
        failed_stage: inner.failed_stage,
        connect_error: inner.connect_error.as_deref(),
        overlay_skip: inner.optional_direct_skip.as_deref(),
        retry_attempt: inner.retry_attempt,
        steps: &steps,
        adapter_names: &adapters,
        known_secrets: &known_secrets,
        audit_log_path: &audit_log_path,
        service_log_path: &service_log_path,
        home_dir: home.as_deref(),
        reported_at_ms: epoch_millis(),
    })
}

/// The exact payload an upload would send, for the "what will be sent"
/// disclosure and for Copy details. Purely local — nothing leaves the
/// machine on this command.
///
/// TS: see `TonoDiagnosticsReport` in `services/tono.ts`; the field list is
/// `tono_core::auth::DiagnosticsReport`.
#[tauri::command]
pub async fn tono_diagnostics_report(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<crate::tono::diagnostics::DiagnosticsReport, String> {
    Ok(collect_diagnostics_report(state.inner(), &app).await)
}

/// Upload one diagnostics report and return its support reference code.
///
/// **User-initiated only.** This is the sole upload path and it exists
/// behind an explicit confirmation in the UI; nothing in the app calls it on
/// a timer, on a crash, or on a failed connect.
///
/// The report is rebuilt here rather than accepted from the WebView: the
/// whitelist has to be enforced where the payload is constructed, or a
/// compromised renderer could post whatever it liked to the account's
/// diagnostics stream.
#[tauri::command]
pub async fn tono_upload_diagnostics(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<TonoDiagnosticsReceipt, String> {
    let client = {
        let inner = state.lock().await;
        inner.client.clone()
    };
    let report = collect_diagnostics_report(state.inner(), &app).await;
    match client.upload_diagnostics_report(&report).await {
        Ok(receipt) => {
            state.audit().log(AuditEvent::DiagnosticsUploaded {
                reference: receipt.reference_code.clone(),
            });
            Ok(TonoDiagnosticsReceipt {
                reference_code: receipt.reference_code,
                received_at: receipt.received_at,
            })
        }
        Err(err) => {
            let message = diagnostics_upload_error(&err);
            state
                .audit()
                .log(AuditEvent::DiagnosticsUploadFail { error: err.to_string() });
            Err(message)
        }
    }
}

/// Classify a sign-in failure into a stable prefix the frontend turns into actionable text.
///
/// Without this the raw error reached the login screen verbatim: a user in China saw
/// `could not reach Tono: pinned[connect: error sending request for url (...) <- client error
/// (Connect) <- 远程主机强迫关闭了一个现有的连接。 (os error 10054)]; system-dns[...]`, which
/// tells them nothing they can act on and looks like the product is broken rather than the
/// network being in the way.
///
/// `TONO_AUTH_UNREACHABLE` is the one worth separating. Both transport paths carry the same
/// hostname and therefore the same TLS SNI, so when both fail the same way the failure is
/// about reaching the control plane at all — not about the account, the code, or the app. The
/// actionable part is that sign-in only has to succeed once: the session persists afterwards
/// and the tunnel provides its own reachability, so one attempt from a working network is
/// enough. That is what the mapped message says.
pub(super) fn auth_error(err: &ApiError) -> String {
    let prefix = match err {
        ApiError::Transport { .. } => "TONO_AUTH_UNREACHABLE",
        ApiError::RateLimited => "TONO_AUTH_RATE_LIMITED",
        ApiError::DeviceLimit => "TONO_AUTH_DEVICE_LIMIT",
        ApiError::Unauthorized => "TONO_AUTH_UNAUTHORIZED",
        _ => return err.to_string(),
    };
    format!("{prefix}: {err}")
}

/// Classify an upload failure into a stable `TONO_DIAG_*` prefix the
/// frontend turns into actionable text (the same convention the connect
/// errors use, see `STABLE_ERROR_KEYS` in `services/tono.ts`).
fn diagnostics_upload_error(err: &ApiError) -> String {
    let prefix = match err {
        ApiError::Unauthorized => "TONO_DIAG_SIGNED_OUT",
        ApiError::RateLimited => "TONO_DIAG_RATE_LIMITED",
        ApiError::Transport { .. } => "TONO_DIAG_UNREACHABLE",
        // The intake is not deployed (or was withdrawn) — distinct from a
        // server fault, and there is nothing the user can do but copy the
        // details instead.
        ApiError::NotFound => "TONO_DIAG_UNAVAILABLE",
        _ => "TONO_DIAG_FAILED",
    };
    format!("{prefix}: {err}")
}
