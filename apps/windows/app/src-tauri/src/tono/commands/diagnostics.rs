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
    state.audit().set_periodic_telemetry_enabled(enabled)?;
    state.route_ledger().lock().advance_baseline();
    Ok(())
}

/// Whether this is an internal candidate build, which reports classified
/// connect failures without the timeline opt-in. The settings page says so.
#[tauri::command]
pub async fn tono_internal_build() -> Result<bool, String> {
    Ok(crate::tono::audit::internal_build())
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

// A timeout cannot stop a native syscall. Retain the permit inside the blocking worker,
// so repeated checks never accumulate more OS walks behind a stalled one.
static SYSTEM_INFO_PROBE: Lazy<Arc<tokio::sync::Semaphore>> =
    Lazy::new(|| Arc::new(tokio::sync::Semaphore::new(1)));

async fn system_info_probe(
    gate: Arc<tokio::sync::Semaphore>,
    provider: impl FnOnce() -> (String, Vec<String>) + Send + 'static,
) -> Option<(String, Vec<String>)> {
    let permit = gate.try_acquire_owned().ok()?;
    tokio::time::timeout(DIAGNOSTICS_PROBE_TIMEOUT, tokio::task::spawn_blocking(move || {
        let _permit = permit;
        provider()
    })).await.ok()?.ok()
}

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
pub(super) async fn collect_diagnostics_report(
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
    let (os_version, adapters) = system_info_probe(Arc::clone(&SYSTEM_INFO_PROBE), || {
        (
            tauri_plugin_tono_sysinfo::os_long_version(),
            tauri_plugin_tono_sysinfo::list_network_interfaces(),
        )
    })
    .await
    .unwrap_or_else(|| ("Unknown".to_string(), Vec::new()));

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
    let known_secrets = crate::tono::diagnostics::known_secrets(&inner);
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
        last_failure: inner.attempt_history.last_failure.as_ref(),
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDiagnosticsReport {
    #[serde(flatten)]
    report: crate::tono::diagnostics::DiagnosticsReport,
    local_evidence: LocalDiagnosticsEvidence,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalDiagnosticsEvidence {
    status: &'static str,
    app_build: Option<&'static str>,
    build_provenance: &'static str,
    account_scope: Option<String>,
    /// Fresh read of Service's committed watchdog evidence, not App's cached intent.
    protection_live: Option<bool>,
    protection_wanted: Option<bool>,
    expected_core_version: Option<String>,
    reported_core_version: Option<String>,
    reported_exit_protocol: Option<&'static str>,
    selected_protocol: Option<&'static str>,
    connection_generation: u64,
    controller_generation: u64,
    failure_at_ms: Option<i64>,
    current_attempt_id: Option<String>,
    last_failed_attempt: Option<crate::tono::local_evidence::FailedAttempt>,
    core_log: crate::tono::local_evidence::CoreLogEvidence,
}

/// Explicit local health check / Copy details. Kept separate from the upload contract and normal
/// page refresh: raw logs never leave Rust, and no extra cloud disclosure occurs.
#[tauri::command]
pub async fn tono_local_diagnostics_report(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<LocalDiagnosticsReport, String> {
    let identity = |inner: &TonoInner| (
        inner.connect_generation, inner.controller_generation,
        inner.connect_error_at_ms, inner.catalog_tracker.current_revision(),
        inner.selected_node.clone(), inner.retry_attempt,
        inner.attempt_history.current.as_ref().map(|attempt| attempt.id.clone()),
        inner.sign_in_generation,
    );
    let (before, controller) = {
        let inner = state.lock().await;
        (identity(&inner), inner.controller_port.zip(inner.controller_secret.clone()))
    };
    let report = collect_diagnostics_report(state.inner(), &app).await;
    // Windows status does not heal or mutate WFP. Failure stays unknown; do not fall
    // back to inner.kill_switch, which may predate a Service restart or stalled watchdog.
    let protection = tokio::time::timeout(DIAGNOSTICS_PROBE_TIMEOUT, service::tono_kill_switch_status())
        .await.ok().and_then(Result::ok);
    let core_log = crate::tono::local_evidence::collect_core_log().await;
    // Authenticated owned-controller response, not a measurement of the executable hash.
    // Do not use the UI plugin: its context is not installed until Connected.
    let reported_core_version = tokio::time::timeout(DIAGNOSTICS_PROBE_TIMEOUT, async {
        let (port, secret) = controller.as_ref()?;
        let client = reqwest::Client::builder().no_proxy()
            .redirect(reqwest::redirect::Policy::none()).build().ok()?;
        let response = client.get(format!("http://127.0.0.1:{port}/version"))
            .bearer_auth(secret).send().await.ok()?.error_for_status().ok()?;
        response.json::<tono_plugin_core::models::MihomoVersion>().await.ok().map(|value| value.version)
    }).await.ok().flatten()
        .filter(|value| !value.is_empty() && value.len() <= 128
            && value.bytes().all(|b| b.is_ascii_alphanumeric() || b".-_+".contains(&b)));
    let reported_exit_protocol = tokio::time::timeout(DIAGNOSTICS_PROBE_TIMEOUT, async {
        let (port, secret) = controller.as_ref()?;
        let client = reqwest::Client::builder().no_proxy()
            .redirect(reqwest::redirect::Policy::none()).build().ok()?;
        let group = client.get(format!("http://127.0.0.1:{port}/proxies/{}", tono_core::EXIT_GROUP_NAME))
            .bearer_auth(secret).send().await.ok()?.error_for_status().ok()?
            .json::<serde_json::Value>().await.ok()?;
        let name = group.get("now")?.as_str()?;
        let mut url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}/proxies/")).ok()?;
        url.path_segments_mut().ok()?.pop_if_empty().push(name);
        let proxy = client.get(url).bearer_auth(secret).send().await.ok()?.error_for_status().ok()?
            .json::<serde_json::Value>().await.ok()?;
        match proxy.get("type")?.as_str()? {
            "VLESS" => Some("vless"),
            "Hysteria2" => Some("hysteria2"),
            _ => None,
        }
    }).await.ok().flatten();
    let expected_core_version = serde_json::from_str::<serde_json::Value>(
        include_str!("../../../core-identity.json"),
    ).ok().and_then(|value| value.get("tonoCoreVersion")?.as_str().map(str::to_owned));
    let inner = state.lock().await;
    if identity(&inner) != before {
        return Err("Connection changed while collecting diagnostics; copy details again.".to_string());
    }
    Ok(LocalDiagnosticsReport {
        report,
        local_evidence: LocalDiagnosticsEvidence {
            status: "collected",
            app_build: option_env!("GITHUB_SHA").filter(|value| value.len() == 40
                && value.bytes().all(|b| b.is_ascii_hexdigit())),
            build_provenance: crate::tono::support_reports::build_provenance(option_env!("GITHUB_WORKFLOW"), cfg!(debug_assertions)),
            account_scope: crate::tono::route_preferences::scope_of(&inner),
            protection_live: protection.as_ref().map(|value| value.live),
            protection_wanted: protection.as_ref().map(|value| value.wanted),
            expected_core_version,
            reported_core_version,
            reported_exit_protocol,
            selected_protocol: inner.selected_node.as_ref().and_then(|name|
                inner.nodes.iter().find(|node| &node.name == name)
                    .map(|node| if node.is_hysteria2() { "hysteria2" } else { "vless-reality" })),
            connection_generation: before.0,
            controller_generation: before.1,
            failure_at_ms: before.2,
            current_attempt_id: before.6,
            last_failed_attempt: inner.attempt_history.last_failure.clone(),
            core_log,
        },
    })
}

/// Upload one diagnostics report and return its support reference code.
///
/// **User-initiated only.** This is the sole upload path and it exists
/// behind an explicit confirmation in the UI; nothing in the app calls it on
/// a timer, on a crash, or on a failed connect.
///
/// The preview body stays in Rust. The WebView sends only its ID, never a payload.
#[tauri::command]
pub async fn tono_upload_diagnostics(
    state: tauri::State<'_, Arc<TonoState>>,
    preview_id: String,
) -> Result<TonoDiagnosticsReceipt, String> {
    let (client, identity, report) = {
        let inner = state.lock().await;
        if inner.account_close.is_some() {
            return Err("account sign-out is still reconciling".to_string());
        }
        let identity = inner.client.diagnostics_log_identity().await;
        let report = state.support_reports.lock().take(
            &preview_id, (inner.sign_in_generation, identity), std::time::Instant::now(),
        )?;
        (inner.client.clone(), identity, report)
    };
    match client.upload_diagnostics_report_for_identity(&report, identity).await {
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
        ApiError::InvalidOrExpiredCode => "TONO_AUTH_INVALID_CODE",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn stalled_system_probe_times_out_without_queueing_another_native_walk() {
        let gate = Arc::new(tokio::sync::Semaphore::new(1));
        let (release, held) = std::sync::mpsc::channel();
        let (started, entered) = tokio::sync::oneshot::channel();
        let worker_gate = gate.clone();
        let probe = tokio::spawn(system_info_probe(worker_gate, move || {
            let _ = started.send(());
            let _ = held.recv();
            ("late OS".into(), vec!["late adapter".into()])
        }));
        entered.await.unwrap();
        tokio::time::advance(DIAGNOSTICS_PROBE_TIMEOUT).await;
        let timed_out = probe.await.unwrap();
        let repeated = system_info_probe(gate.clone(), || panic!("must not queue a second walk")).await;
        // Unblock even if an assertion fails, so the test runtime can shut down.
        release.send(()).unwrap();
        assert!(timed_out.is_none());
        assert!(repeated.is_none());
        let permit = gate.acquire().await.unwrap();
        drop(permit);
        tokio::time::resume();
        assert_eq!(system_info_probe(gate, || ("fresh OS".into(), vec![])).await.unwrap().0, "fresh OS");
    }
}
