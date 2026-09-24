//! Periodic diagnostic timeline upload (testing default-on).
//!
//! Every ~20 minutes while signed in, ship a short redacted audit window to
//! the control plane so operators can reconstruct network anomalies before
//! Claude bans. Users can disable this in Settings. A connectFail also posts
//! immediately to `telemetry/failures` (same consent, not the 3.5 log).
//! Failures never touch the connect / kill-switch path.

use std::{path::Path, sync::Arc, time::Duration};

use serde_json::Value;
use tauri::AppHandle;
use tono_core::auth::{
    ApiError, BytesByRoute, ConnectFailureReport, TELEMETRY_KIND_PERIODIC_WINDOW, TELEMETRY_SCHEMA_VERSION,
    TelemetryEvent, TelemetryWindowReport, UNKNOWN_CLASSIFIED_FAILURE,
};

use tono_logging::{Type, logging};

use tono_core::connection::UiState;

use crate::{
    process::AsyncHandler,
    tono::{
        audit::{AuditEvent, redact},
        state::TonoState,
    },
};

fn ui_state_key(ui_state: UiState) -> &'static str {
    match ui_state {
        UiState::NotConnected => "notConnected",
        UiState::Connecting(_) => "connecting",
        UiState::Connected => "connected",
        UiState::ProtectedOffline => "protectedOffline",
        UiState::Disconnecting => "disconnecting",
    }
}

/// Cadence for automatic timeline uploads while testing.
pub const PERIODIC_TELEMETRY_INTERVAL: Duration = Duration::from_secs(20 * 60);
/// First upload sooner so early connect failures still reach the server.
pub const PERIODIC_TELEMETRY_FIRST_DELAY: Duration = Duration::from_secs(5 * 60);
/// How much history to include in each window (slightly wider than the interval).
pub const PERIODIC_TELEMETRY_LOOKBACK: Duration = Duration::from_secs(22 * 60);
const MAX_EVENTS: usize = 200;
/// Hard cap on serialized body size (Worker limit is 64 KiB payload).
const MAX_PAYLOAD_BYTES: usize = 48 * 1024;

/// Consecutive `NotFound` uploads that trigger a session probe. A single 404
/// may be a worker mid-deploy flap; two in a row (spaced by the interval)
/// are not.
const NOT_FOUND_PROBE_THRESHOLD: u32 = 2;

/// What the periodic uploader does after a `NotFound` from the intake. The
/// device (re)claim path exists only inside interactive sign-in
/// (`ensureDevice` runs during email verify), so there is nothing to retry
/// against a persistent 404: the intake route either does not exist on the
/// serving worker (stale deploy; the account probe stays healthy) or the
/// session is dead — both states stand the uploader down instead of
/// re-failing every interval. The next auth generation (sign-in, app
/// restart) resumes uploads, which is also how a fixed backend is picked up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NotFoundVerdict {
    /// Inconclusive so far: keep the ordinary cadence.
    KeepCadence,
    /// The session probe succeeded, so account and device are fine: the
    /// serving worker does not have the telemetry route. Stand down.
    StandDownRouteMissing,
    /// The session probe says the session is dead (revoked device, expired
    /// pending claim). Stand down; startup restore owns the sign-out path.
    StandDownSessionDead,
}

fn not_found_verdict(consecutive: u32, probe: &Result<(), ApiError>) -> NotFoundVerdict {
    if consecutive < NOT_FOUND_PROBE_THRESHOLD {
        return NotFoundVerdict::KeepCadence;
    }
    match probe {
        Ok(()) => NotFoundVerdict::StandDownRouteMissing,
        Err(ApiError::Unauthorized) => NotFoundVerdict::StandDownSessionDead,
        // An inconclusive probe (transport error) must not stand the
        // uploader down on a guess.
        Err(_) => NotFoundVerdict::KeepCadence,
    }
}

const INCLUDE_KINDS: &[&str] = &[
    "connectBegin",
    "stage",
    "connectFail",
    "connectOk",
    "protectedRouteEvidence",
    "disconnectBegin",
    "disconnectOk",
    "releaseFail",
    "reconnectScheduled",
    "nodeSwitch",
    "protectedOffline",
    "killSwitchSnapshot",
    "networkChange",
    "coreRestart",
    "healthProbeFail",
    "syncFail",
    "policySyncOk",
    "policyActivated",
    "policyActivationSkipped",
    "policySyncFail",
    "diagnosticsUploaded",
    "diagnosticsUploadFail",
    "periodicTelemetryUploaded",
    "periodicTelemetryUploadFail",
];

/// Start the periodic uploader for one authenticated session.
pub(crate) async fn spawn_periodic_for_auth_generation(state: &Arc<TonoState>, _app: &AppHandle, generation: u64) {
    {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation {
            return;
        }
        state.route_ledger().lock().advance_baseline();
    }
    let task_state = state.clone();
    let handle = AsyncHandler::spawn(move || async move {
        let mut consecutive_not_found = 0_u32;
        tokio::time::sleep(PERIODIC_TELEMETRY_FIRST_DELAY).await;
        loop {
            // Same exit as the catalog/policy sync: a suspended account's
            // session is refused, so every upload would be a 401 and a refresh.
            if !crate::tono::catalog_sync::periodic_sync_continues(&*task_state.lock().await, generation) {
                return;
            }
            match upload_once(&task_state, generation).await {
                Ok(()) => consecutive_not_found = 0,
                Err(ApiError::NotFound) => {
                    consecutive_not_found += 1;
                    let probe = probe_session(&task_state, generation).await;
                    match not_found_verdict(consecutive_not_found, &probe) {
                        NotFoundVerdict::KeepCadence => {}
                        NotFoundVerdict::StandDownRouteMissing => {
                            logging!(
                                warn,
                                Type::Service,
                                "Tono: telemetry intake keeps returning 404 while the session is healthy; \
                                 periodic uploads stand down until the next sign-in or app restart"
                            );
                            return;
                        }
                        NotFoundVerdict::StandDownSessionDead => {
                            logging!(
                                warn,
                                Type::Service,
                                "Tono: telemetry intake returns 404 and the session probe is unauthorized; \
                                 periodic uploads stand down (session is dead)"
                            );
                            return;
                        }
                    }
                }
                Err(_) => {}
            }
            let jitter_ms = (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
                % 120_001) as i64
                - 60_000;
            let wait = PERIODIC_TELEMETRY_INTERVAL.saturating_add(Duration::from_millis(jitter_ms.unsigned_abs()));
            tokio::time::sleep(wait).await;
        }
    });
    let inner = state.lock().await;
    if inner.sign_in_generation != generation {
        handle.abort();
    }
}

/// Best-effort `POST telemetry/failures` for one connectFail. Never blocks
/// connect / kill-switch, and never retries a timeout. Uses the same consent
/// as the periodic window — this is not the 3.5 raw connection log.
pub(crate) fn spawn_connect_failure_report(
    state: &Arc<TonoState>,
    account_owner: (u64, u64),
    stage: Option<&'static str>,
    error: &str,
    node: Option<String>,
    transport: Option<&'static str>,
    code: Option<&str>,
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    if !state.audit().periodic_telemetry_enabled() || !state.audit().enabled() {
        return None;
    }
    let Some(node) = node.filter(|name| !name.trim().is_empty()) else {
        return None;
    };
    let stage = stage.unwrap_or("unknown").to_string();
    let code = code
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(UNKNOWN_CLASSIFIED_FAILURE)
        .to_string();
    let error = {
        let clipped: String = redact(error).chars().take(200).collect();
        (!clipped.is_empty()).then_some(clipped)
    };
    let transport = transport
        .filter(|value| *value == "tcp" || *value == "hy2")
        .map(str::to_string);
    let task_state = state.clone();
    Some(AsyncHandler::spawn(move || async move {
        let (generation, identity) = account_owner;
        let (client, tcp_delay_ms, exit_delay_ms) = {
            let inner = task_state.lock().await;
            if inner.sign_in_generation != generation || inner.account_close.is_some() || matches!(
                inner.account_state,
                crate::tono::state::AccountState::SignedOut | crate::tono::state::AccountState::Restoring
            ) {
                return;
            }
            (
                inner.client.clone(),
                inner.selected_tcp_delay_ms().map(|ms| ms as i64),
                inner.selected_exit_delay_ms().map(|ms| ms as i64),
            )
        };
        let os_version = AsyncHandler::spawn_blocking(|| tauri_plugin_tono_sysinfo::os_long_version())
            .await
            .unwrap_or_else(|_| "Unknown".to_string());
        {
            let inner = task_state.lock().await;
            if inner.sign_in_generation != generation {
                return;
            }
        }
        let report = ConnectFailureReport {
            ts: epoch_ms(),
            stage,
            code,
            error,
            node,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            os_version,
            os_arch: std::env::consts::ARCH.to_string(),
            platform: "windows".to_string(),
            core_errors: None,
            tcp_delay_ms,
            exit_delay_ms,
            transport,
        };
        let _ = client.upload_connect_failure_for_identity(&report, identity).await;
    }))
}

/// Probe whether the account session behind a `NotFound` upload is still
/// alive. A superseded generation counts as alive (the new session owns its
/// own uploader; this one is about to exit on the generation check anyway).
async fn probe_session(state: &Arc<TonoState>, generation: u64) -> Result<(), ApiError> {
    let client = {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation {
            return Ok(());
        }
        inner.client.clone()
    };
    client.me().await.map(|_| ())
}

async fn upload_once(state: &Arc<TonoState>, generation: u64) -> Result<(), ApiError> {
    if !state.audit().periodic_telemetry_enabled() || !state.audit().enabled() {
        return Ok(());
    }
    let (client, identity, account_scope) = {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation || inner.account_close.is_some() {
            return Ok(());
        }
        // The audit file outlives sign-out; only this account's records may ride its window.
        let Some(account_scope) = state.audit().account_scope() else {
            return Ok(());
        };
        (
            inner.client.clone(),
            inner.client.diagnostics_log_identity().await,
            account_scope,
        )
    };

    let (report, uploaded_totals, baseline_epoch) = build_window_report(state, account_scope)
        .await
        .map_err(ApiError::InvalidInput)?;
    {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation
            || !state.audit().periodic_telemetry_enabled()
            || state.route_ledger().lock().baseline_epoch() != baseline_epoch
        {
            return Ok(());
        }
    }
    let bytes = serde_json::to_vec(&report).map(|v| v.len()).unwrap_or(0) as u32;
    let event_count = report.event_count;
    match client.upload_telemetry_window_for_identity(&report, identity).await {
        Ok(receipt) => {
            let inner = state.lock().await;
            if inner.sign_in_generation != generation || !state.audit().periodic_telemetry_enabled() {
                return Ok(());
            }
            state.route_ledger().lock().acknowledge_snapshot(
                uploaded_totals,
                baseline_epoch,
                report.route_bytes_interval,
                receipt.route_bytes_interval_version,
            );
            state
                .audit()
                .log(AuditEvent::PeriodicTelemetryUploaded { event_count, bytes });
            Ok(())
        }
        Err(err) => {
            if matches!(err, ApiError::Server { status: 400, .. }) && report.route_bytes_interval.is_some() {
                let inner = state.lock().await;
                if inner.sign_in_generation == generation && state.audit().periodic_telemetry_enabled() {
                    state.route_ledger().lock().forget_interval_support(baseline_epoch);
                }
            }
            state
                .audit()
                .log(AuditEvent::PeriodicTelemetryUploadFail { error: err.to_string() });
            Err(err)
        }
    }
}

async fn build_window_report(
    state: &Arc<TonoState>,
    account_scope: String,
) -> Result<(TelemetryWindowReport, BytesByRoute, u64), String> {
    // Capture counters and their end time together, before any HTTP/IO await.
    let (now_ms, bytes_by_route, route_bytes_interval, uploaded_totals, baseline_epoch) = {
        let ledger = state.route_ledger().lock();
        let now_ms = epoch_ms();
        let interval = ledger.interval_at(now_ms);
        (
            now_ms,
            interval.map(|_| ledger.window_bytes()),
            interval,
            ledger.overall(),
            ledger.baseline_epoch(),
        )
    };
    let start_ms = now_ms.saturating_sub(PERIODIC_TELEMETRY_LOOKBACK.as_millis() as i64);
    let log_path = state.audit().log_path().to_path_buf();
    let (events, dropped) =
        tokio::task::spawn_blocking(move || collect_events(&log_path, start_ms, now_ms, &account_scope))
            .await
            .map_err(|err| err.to_string())??;

    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let os_version = AsyncHandler::spawn_blocking(|| tauri_plugin_tono_sysinfo::os_long_version())
        .await
        .unwrap_or_else(|_| "Unknown".to_string());

    let (
        ui_state,
        account_state,
        selected_server,
        catalog_revision,
        kill_switch_mode,
        kill_switch_wanted,
        kill_switch_live,
        exit_delay_ms,
        exit_delay_at_ms,
        tcp_delay_ms,
        tcp_delay_at_ms,
    ) = {
        let inner = state.lock().await;
        let status = inner.fsm.status();
        let revision = inner.catalog_tracker.current_revision();
        (
            ui_state_key(status.ui_state()).to_string(),
            inner.account_state.key().to_string(),
            inner.selected_node.clone(),
            (revision >= 0).then_some(revision),
            inner
                .kill_switch
                .as_ref()
                .map(|status| format!("{:?}", status.mode).to_lowercase()),
            inner.kill_switch.as_ref().map(|status| status.wanted),
            inner.kill_switch.as_ref().map(|status| status.live),
            inner.selected_exit_delay_ms().map(|ms| ms as i64),
            inner.selected_exit_delay_at_ms(),
            inner.selected_tcp_delay_ms().map(|ms| ms as i64),
            inner.selected_tcp_delay_at_ms(),
        )
    };

    let template = TelemetryWindowReport {
        schema_version: TELEMETRY_SCHEMA_VERSION,
        kind: TELEMETRY_KIND_PERIODIC_WINDOW.to_string(),
        window_start_ms: start_ms,
        window_end_ms: now_ms,
        app_version,
        os_version,
        os_arch: std::env::consts::ARCH.to_string(),
        ui_state,
        account_state,
        selected_server,
        catalog_revision,
        kill_switch_mode,
        kill_switch_wanted,
        kill_switch_live,
        dns_enabled: None,
        exit_delay_ms,
        exit_delay_at_ms,
        tcp_delay_ms,
        tcp_delay_at_ms,
        platform: Some("windows".to_string()),
        bytes_by_route,
        route_bytes_interval,
        event_count: 0,
        events_dropped: dropped,
        events: Vec::new(),
    };
    Ok((
        assemble_window(events, dropped, template),
        uploaded_totals,
        baseline_epoch,
    ))
}

/// Trim oldest events until the payload fits, then fall back to an empty
/// event list. `bytes_by_route` (and the rest of `template`) survives both
/// the trim loop and the empty fallback.
fn assemble_window(
    mut events: Vec<TelemetryEvent>,
    dropped: u32,
    template: TelemetryWindowReport,
) -> TelemetryWindowReport {
    while !events.is_empty() {
        let candidate = TelemetryWindowReport {
            event_count: events.len() as u32,
            events_dropped: dropped,
            events: events.clone(),
            ..template.clone()
        };
        let size = serde_json::to_vec(&candidate).map(|v| v.len()).unwrap_or(usize::MAX);
        if size <= MAX_PAYLOAD_BYTES {
            return candidate;
        }
        events.remove(0);
    }
    TelemetryWindowReport {
        event_count: 0,
        events_dropped: dropped,
        events: Vec::new(),
        ..template
    }
}

pub(super) fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn collect_events(
    path: &Path,
    start_ms: i64,
    end_ms: i64,
    account_scope: &str,
) -> Result<(Vec<TelemetryEvent>, u32), String> {
    if !path.exists() {
        return Ok((Vec::new(), 0));
    }
    let body = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut selected: Vec<TelemetryEvent> = Vec::new();
    let mut latest_protected_route: Option<(Value, i64)> = None;
    let mut dropped = 0u32;
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(ts) = value.get("ts").and_then(Value::as_i64) else {
            continue;
        };
        if ts < start_ms || ts > end_ms {
            continue;
        }
        // Unstamped (legacy, pre-sign-in) and other-account records never leave the device here.
        if value.get("_accountScope").and_then(Value::as_str) != Some(account_scope) {
            continue;
        }
        let Some(kind) = value.get("kind").and_then(Value::as_str) else {
            continue;
        };
        if kind == "signInStart" || kind == "signInOk" {
            dropped = dropped.saturating_add(1);
            continue;
        }
        if !INCLUDE_KINDS.iter().any(|k| *k == kind) {
            dropped = dropped.saturating_add(1);
            continue;
        }
        // Each row is already a cumulative session aggregate. Keep only the newest one in this
        // upload window, then expand its mutually-exclusive counters into a fixed maximum of six
        // enum-only events. This prevents a long session from multiplying rows in telemetry.
        if kind == "protectedRouteEvidence" {
            latest_protected_route = Some((value, ts));
            continue;
        }
        if let Some(event) = map_event(&value, ts, kind) {
            selected.push(event);
        } else {
            dropped = dropped.saturating_add(1);
        }
    }
    if let Some((value, ts)) = latest_protected_route {
        selected.extend(map_protected_route_events(&value, ts));
    }
    if selected.len() > MAX_EVENTS {
        let overflow = selected.len() - MAX_EVENTS;
        dropped = dropped.saturating_add(overflow as u32);
        selected = selected.split_off(overflow);
    }
    Ok((selected, dropped))
}

fn map_event(value: &Value, ts: i64, kind: &str) -> Option<TelemetryEvent> {
    let str_field = |key: &str| -> Option<String> {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(redact)
            .filter(|s| !s.is_empty())
    };
    let i64_field = |key: &str| -> Option<i64> {
        value.get(key).and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_u64().map(|n| n as i64))
                .or_else(|| v.as_f64().map(|n| n as i64))
        })
    };
    let bool_field = |key: &str| -> Option<bool> { value.get(key).and_then(Value::as_bool) };

    Some(TelemetryEvent {
        ts,
        kind: kind.to_string(),
        stage: str_field("stage"),
        error: str_field("error"),
        node: str_field("node"),
        action: str_field("action"),
        reason: str_field("reason"),
        probe: str_field("probe"),
        from: str_field("from"),
        to: str_field("to"),
        mode: str_field("mode"),
        reference: str_field("reference"),
        outcome: str_field("outcome"),
        code: str_field("code"),
        elapsed_ms: i64_field("elapsedMs"),
        delay_ms: i64_field("delayMs"),
        counter: i64_field("counter"),
        generation: i64_field("generation"),
        restart_count: i64_field("restartCount"),
        old_pid: i64_field("oldPid"),
        new_pid: i64_field("newPid"),
        revision: i64_field("revision"),
        domains: i64_field("domains"),
        media: i64_field("media"),
        web_domains: i64_field("webDomains"),
        wechat_tcp: i64_field("wechatTcp"),
        web_tcp: i64_field("webTcp"),
        udp: i64_field("udp"),
        endpoints: i64_field("endpoints"),
        event_count: i64_field("eventCount"),
        bytes: i64_field("bytes"),
        bytes_up: i64_field("bytesUp"),
        bytes_down: i64_field("bytesDown"),
        wanted: bool_field("wanted"),
        live: bool_field("live"),
        transport: str_field("transport").filter(|value| value == "tcp" || value == "hy2"),
    })
}

fn map_protected_route_events(value: &Value, ts: i64) -> Vec<TelemetryEvent> {
    const ROUTES: [(&str, &str); 5] = [
        ("RESIDENTIAL", "residentialConnectionCount"),
        ("DIRECT", "directConnectionCount"),
        ("PROXIED", "proxiedConnectionCount"),
        ("BLOCKED", "blockedConnectionCount"),
        ("UNKNOWN", "unknownConnectionCount"),
    ];
    const DESTINATIONS: [&str; 5] = ["ANTHROPIC", "TURNSTILE", "PAYMENT", "UPDATE", "TELEMETRY"];

    // Protected-route evidence is a privacy boundary: do not clone arbitrary audit fields into
    // the upload. Only the timestamp argument and numeric generation are allowed into the base;
    // route enums and counters are populated below from fixed whitelists.
    let base_value = serde_json::json!({ "generation": value.get("generation") });
    let base = map_event(&base_value, ts, "protectedRouteAggregate").expect("map_event always constructs an event");
    let mut events = Vec::with_capacity(6);
    for (route, field) in ROUTES {
        let Some(count) = value.get(field).and_then(Value::as_u64).filter(|count| *count > 0) else {
            continue;
        };
        let mut event = base.clone();
        event.kind = if matches!(route, "DIRECT" | "PROXIED") {
            "protectedRouteInvariantViolation".to_owned()
        } else {
            "protectedRouteAggregate".to_owned()
        };
        event.outcome = Some(route.to_owned());
        event.counter = Some(count.min(i64::MAX as u64) as i64);
        events.push(event);
    }

    let latest_route = value
        .get("latestRoute")
        .and_then(Value::as_str)
        .filter(|route| ROUTES.iter().any(|(allowed, _)| route == allowed));
    let latest_destination = value
        .get("latestDestination")
        .and_then(Value::as_str)
        .filter(|destination| DESTINATIONS.contains(destination));
    if let (Some(route), Some(destination)) = (latest_route, latest_destination) {
        let mut event = base;
        event.kind = "protectedRouteLatest".to_owned();
        event.outcome = Some(route.to_owned());
        event.code = Some(destination.to_owned());
        event.counter = None;
        events.push(event);
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!("tono-telemetry-{}-{}", tag, std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn single_not_found_keeps_cadence_so_a_flap_can_recover() {
        // One 404 may be a worker mid-deploy flap: the uploader stays on its
        // ordinary cadence and the next cycle can succeed (the streak resets
        // on the first Ok).
        for probe in [
            Ok(()),
            Err(ApiError::Unauthorized),
            Err(ApiError::Transport {
                kind: tono_core::auth::TransportKind::Timeout,
                message: "timeout".to_string(),
            }),
        ] {
            assert_eq!(
                not_found_verdict(NOT_FOUND_PROBE_THRESHOLD - 1, &probe),
                NotFoundVerdict::KeepCadence
            );
        }
    }

    #[test]
    fn persistent_not_found_with_a_healthy_session_stands_down() {
        assert_eq!(
            not_found_verdict(NOT_FOUND_PROBE_THRESHOLD, &Ok(())),
            NotFoundVerdict::StandDownRouteMissing
        );
    }

    #[test]
    fn persistent_not_found_with_a_dead_session_stands_down() {
        assert_eq!(
            not_found_verdict(NOT_FOUND_PROBE_THRESHOLD, &Err(ApiError::Unauthorized)),
            NotFoundVerdict::StandDownSessionDead
        );
    }

    #[test]
    fn persistent_not_found_with_an_inconclusive_probe_keeps_cadence() {
        // A transport-failed probe proves nothing about the route; guessing
        // here would silence uploads on a flaky network.
        let probe = Err(ApiError::Transport {
            kind: tono_core::auth::TransportKind::Connect,
            message: "connect".to_string(),
        });
        assert_eq!(
            not_found_verdict(NOT_FOUND_PROBE_THRESHOLD, &probe),
            NotFoundVerdict::KeepCadence
        );
    }

    #[test]
    fn collect_events_skips_sign_in_and_keeps_network() {
        let dir = TempDir::new("events");
        let path = dir.path().join("traffic-audit.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        let now = epoch_ms();
        writeln!(
            file,
            r#"{{"ts":{},"_accountScope":"owner","kind":"signInOk","email":"a@b.com"}}"#,
            now - 1000
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"ts":{},"_accountScope":"owner","kind":"networkChange","counter":3}}"#,
            now - 500
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"ts":{},"_accountScope":"owner","kind":"connectOk","node":"Tokyo · Sakura · hy2","elapsedMs":1200,"transport":"hy2"}}"#,
            now - 100
        )
        .unwrap();
        let (events, dropped) = collect_events(&path, now - 60_000, now, "owner").unwrap();
        assert_eq!(events.len(), 2);
        assert!(dropped >= 1);
        assert!(events.iter().all(|e| e.kind != "signInOk"));
        assert_eq!(events[0].kind, "networkChange");
        assert_eq!(events[0].counter, Some(3));
        assert_eq!(events[1].transport.as_deref(), Some("hy2"));
    }

    #[test]
    fn collect_events_copies_connect_fail_node_and_code() {
        let dir = TempDir::new("connect-fail");
        let path = dir.path().join("traffic-audit.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        let now = epoch_ms();
        writeln!(
            file,
            r#"{{"ts":{},"_accountScope":"owner","kind":"connectFail","stage":"checkingExit","error":"TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof","action":"fullRelease","transport":"tcp","code":"TONO_NODE_OR_CORE_UNREACHABLE","node":"Tokyo · Sakura"}}"#,
            now - 100
        )
        .unwrap();
        let (events, _) = collect_events(&path, now - 60_000, now, "owner").unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "connectFail");
        assert_eq!(events[0].stage.as_deref(), Some("checkingExit"));
        assert_eq!(events[0].code.as_deref(), Some("TONO_NODE_OR_CORE_UNREACHABLE"));
        assert_eq!(events[0].node.as_deref(), Some("Tokyo · Sakura"));
        assert_eq!(events[0].transport.as_deref(), Some("tcp"));
    }

    #[test]
    fn payment_route_evidence_preserves_only_the_reviewed_category() {
        let value = serde_json::json!({
            "generation":3, "residentialConnectionCount":1,
            "latestRoute":"RESIDENTIAL", "latestDestination":"PAYMENT",
            "host":"private-payment.example", "process":"private.exe", "token":"secret"
        });
        let events = map_protected_route_events(&value, 100);
        assert!(events.iter().any(|event| event.code.as_deref() == Some("PAYMENT")));
        let json = serde_json::to_string(&events).unwrap();
        for private in ["private-payment", "private.exe", "secret"] {
            assert!(!json.contains(private));
        }
    }

    #[test]
    fn protected_route_upload_is_latest_bounded_and_enum_only() {
        let dir = TempDir::new("protected-route");
        let path = dir.path().join("traffic-audit.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        let now = epoch_ms();
        writeln!(
            file,
            r#"{{"ts":{},"_accountScope":"owner","kind":"protectedRouteEvidence","generation":7,"residentialConnectionCount":1,"directConnectionCount":0,"proxiedConnectionCount":0,"blockedConnectionCount":0,"unknownConnectionCount":0,"latestRoute":"RESIDENTIAL","latestDestination":"ANTHROPIC"}}"#,
            now - 1000
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"ts":{},"_accountScope":"owner","kind":"protectedRouteEvidence","generation":7,"residentialConnectionCount":4,"directConnectionCount":2,"proxiedConnectionCount":1,"blockedConnectionCount":1,"unknownConnectionCount":1,"latestRoute":"PROXIED","latestDestination":"TURNSTILE","host":"private.example","path":"C:\\\\secret","node":"private-node","error":"private-error","probe":"private-probe"}}"#,
            now - 100
        )
        .unwrap();

        let (events, _) = collect_events(&path, now - 60_000, now, "owner").unwrap();
        assert_eq!(events.len(), 6, "five aggregate buckets plus one latest enum");
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == "protectedRouteInvariantViolation")
                .count(),
            2
        );
        assert!(events.iter().any(|event| {
            event.kind == "protectedRouteAggregate"
                && event.outcome.as_deref() == Some("RESIDENTIAL")
                && event.counter == Some(4)
        }));
        let latest = events
            .iter()
            .find(|event| event.kind == "protectedRouteLatest")
            .unwrap();
        assert_eq!(latest.outcome.as_deref(), Some("PROXIED"));
        assert_eq!(latest.code.as_deref(), Some("TURNSTILE"));
        assert_eq!(latest.generation, Some(7));
        assert!(events.iter().all(|event| event.node.is_none()));
        assert!(events.iter().all(|event| event.error.is_none()));
        assert!(events.iter().all(|event| event.probe.is_none()));
        let json = serde_json::to_string(&events).unwrap();
        assert!(!json.contains("private.example"));
        assert!(!json.contains("secret"));
        assert!(!json.contains("private-node"));
        assert!(!json.contains("private-error"));
        assert!(!json.contains("private-probe"));
    }

    #[test]
    fn collect_events_maps_disconnect_ok_bytes_and_elapsed() {
        let dir = TempDir::new("disconnect-ok");
        let path = dir.path().join("traffic-audit.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        let now = epoch_ms();
        writeln!(
            file,
            r#"{{"ts":{},"_accountScope":"owner","kind":"disconnectOk","elapsedMs":45000,"bytesUp":1234,"bytesDown":5678}}"#,
            now - 100
        )
        .unwrap();
        let (events, _) = collect_events(&path, now - 60_000, now, "owner").unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "disconnectOk");
        assert_eq!(events[0].elapsed_ms, Some(45_000));
        assert_eq!(events[0].bytes_up, Some(1234));
        assert_eq!(events[0].bytes_down, Some(5678));
    }

    fn window_template(bytes_by_route: Option<BytesByRoute>) -> TelemetryWindowReport {
        TelemetryWindowReport {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            kind: TELEMETRY_KIND_PERIODIC_WINDOW.to_string(),
            window_start_ms: 0,
            window_end_ms: 1,
            app_version: "0.0.72".to_string(),
            os_version: "Windows 11".to_string(),
            os_arch: "x86_64".to_string(),
            ui_state: "connected".to_string(),
            account_state: "ready".to_string(),
            selected_server: None,
            catalog_revision: None,
            kill_switch_mode: None,
            kill_switch_wanted: None,
            kill_switch_live: None,
            dns_enabled: None,
            exit_delay_ms: None,
            exit_delay_at_ms: None,
            tcp_delay_ms: None,
            tcp_delay_at_ms: None,
            platform: Some("windows".to_string()),
            bytes_by_route,
            route_bytes_interval: None,
            event_count: 0,
            events_dropped: 0,
            events: Vec::new(),
        }
    }

    #[test]
    fn assemble_window_keeps_bytes_by_route_through_trim_and_empty_fallback() {
        let bytes = BytesByRoute {
            cloud: 11,
            residential: 22,
            direct: 33,
        };
        let bulky: TelemetryEvent = serde_json::from_value(serde_json::json!({
            "ts": 1,
            "kind": "connectFail",
            "error": "x".repeat(8 * 1024),
        }))
        .unwrap();
        // Seven 8 KiB events exceed MAX_PAYLOAD_BYTES (48 KiB), so the trim loop runs.
        let events = vec![
            bulky.clone(),
            bulky.clone(),
            bulky.clone(),
            bulky.clone(),
            bulky.clone(),
            bulky.clone(),
            bulky,
        ];
        let trimmed = assemble_window(events, 4, window_template(Some(bytes)));
        assert!(
            serde_json::to_vec(&trimmed).unwrap().len() <= MAX_PAYLOAD_BYTES,
            "trim must produce a payload the Worker will accept"
        );
        assert_eq!(trimmed.bytes_by_route, Some(bytes));
        let json = serde_json::to_value(&trimmed).unwrap();
        assert_eq!(json["bytesByRoute"]["cloud"], 11);
        assert_eq!(json["bytesByRoute"]["residential"], 22);
        assert_eq!(json["bytesByRoute"]["direct"], 33);

        let empty = assemble_window(Vec::new(), 9, window_template(Some(bytes)));
        assert_eq!(empty.event_count, 0);
        assert!(empty.events.is_empty());
        assert_eq!(empty.events_dropped, 9);
        assert_eq!(empty.bytes_by_route, Some(bytes));
        let empty_json = serde_json::to_value(&empty).unwrap();
        assert_eq!(empty_json["bytesByRoute"]["cloud"], 11);
        assert_eq!(empty_json["bytesByRoute"]["direct"], 33);
    }

    #[test]
    fn periodic_window_carries_only_the_signed_in_accounts_records() {
        let dir = TempDir::new("account-scope");
        let (sender, mut receiver) = tokio::sync::mpsc::channel(8);
        let audit = crate::tono::audit::Audit::for_test(sender.clone(), dir.path(), true);
        let start = epoch_ms() - 60_000;
        let fail = || AuditEvent::ConnectFail {
            stage: Some("checkingExit"),
            error: "TONO_NODE_OR_CORE_UNREACHABLE".to_string(),
            action: "fullRelease",
            transport: Some("tcp"),
            code: Some("TONO_NODE_OR_CORE_UNREACHABLE".to_string()),
            node: Some("Tokyo · Sakura".to_string()),
        };
        audit.log(fail());
        audit.activate_log_upload_owner("account-a");
        audit.log(fail());
        let scope_a = audit.account_scope().unwrap();
        // Relaunch: fresh in-memory owner state over the same settings dir.
        let audit = crate::tono::audit::Audit::for_test(sender, dir.path(), true);
        audit.activate_log_upload_owner("account-a");
        assert_eq!(audit.account_scope().as_deref(), Some(scope_a.as_str()));
        let settings = std::fs::read_to_string(dir.path().join(crate::tono::audit::SETTINGS_FILE_NAME)).unwrap();
        let saved: Value = serde_json::from_str(&settings).unwrap();
        assert!(!saved["account_scope"].to_string().contains("account-a"));
        audit.log(AuditEvent::ConnectOk {
            node: "Tokyo · Sakura".to_string(),
            elapsed_ms: 900,
            transport: "tcp",
        });
        audit.abandon_log_upload_owner();
        audit.activate_log_upload_owner("account-b");
        let scope_b = audit.account_scope().unwrap();
        assert_ne!(scope_b, scope_a);
        audit.log(fail());
        let path = dir.path().join("traffic-audit.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        while let Ok(record) = receiver.try_recv() {
            writeln!(file, "{}", serde_json::to_string(&record).unwrap()).unwrap();
        }
        let kinds = |scope: &str| -> Vec<String> {
            let (events, _) = collect_events(&path, start, epoch_ms() + 1, scope).unwrap();
            events.into_iter().map(|event| event.kind).collect()
        };
        assert_eq!(kinds(&scope_a), ["connectFail", "connectOk"]);
        assert_eq!(kinds(&scope_b), ["connectFail"]);
    }
}
