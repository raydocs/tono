//! Periodic diagnostic timeline upload (testing default-on).
//!
//! Every ~20 minutes while signed in, ship a short redacted audit window to
//! the control plane so operators can reconstruct network anomalies before
//! Claude bans. Users can disable this in Settings. Failures never touch the
//! connect / kill-switch path.

use std::{path::Path, sync::Arc, time::Duration};

use serde_json::Value;
use tauri::AppHandle;
use tono_core::auth::{
    ApiError, BytesByRoute, ConnectFailureReport, TELEMETRY_KIND_PERIODIC_WINDOW, TELEMETRY_SCHEMA_VERSION,
    TelemetryEvent, TelemetryWindowReport,
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
/// After a failure one window follows early, so the retry's outcome is visible
/// before the regular cadence would show it. Five minutes: three on-time
/// windows plus this still fit the account's hourly heartbeat budget of six.
const EARLY_WINDOW_AFTER_FAILURE: Duration = Duration::from_secs(5 * 60);
/// What the window and the failure report both call this client.
const PLATFORM: &str = "windows";

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
    "connectCatalogFailover",
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
    let task_state = state.clone();
    let handle = AsyncHandler::spawn(move || async move {
        let mut consecutive_not_found = 0_u32;
        tokio::time::sleep(PERIODIC_TELEMETRY_FIRST_DELAY).await;
        loop {
            {
                let inner = task_state.lock().await;
                if inner.sign_in_generation != generation {
                    return;
                }
                if matches!(
                    inner.account_state,
                    crate::tono::state::AccountState::SignedOut | crate::tono::state::AccountState::Restoring
                ) {
                    return;
                }
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
    let client = {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation {
            return Ok(());
        }
        inner.client.clone()
    };

    let report = build_window_report(state).await.map_err(ApiError::InvalidInput)?;
    let bytes = serde_json::to_vec(&report).map(|v| v.len()).unwrap_or(0) as u32;
    let event_count = report.event_count;
    match client.upload_telemetry_window(&report).await {
        Ok(_receipt) => {
            // Advance the bytesByRoute baseline only after a 2xx so a failed
            // window is retried with the same delta rather than losing those bytes.
            state.route_ledger().lock().advance_baseline();
            state
                .audit()
                .log(AuditEvent::PeriodicTelemetryUploaded { event_count, bytes });
            Ok(())
        }
        Err(err) => {
            state
                .audit()
                .log(AuditEvent::PeriodicTelemetryUploadFail { error: err.to_string() });
            Err(err)
        }
    }
}

async fn build_window_report(state: &Arc<TonoState>) -> Result<TelemetryWindowReport, String> {
    let now_ms = epoch_ms();
    let start_ms = now_ms.saturating_sub(PERIODIC_TELEMETRY_LOOKBACK.as_millis() as i64);
    let log_path = state.audit().log_path().to_path_buf();
    let (events, dropped) = tokio::task::spawn_blocking(move || collect_events(&log_path, start_ms, now_ms))
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

    let bytes_by_route: Option<BytesByRoute> = Some(state.route_ledger().lock().window_bytes());
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
        platform: Some(PLATFORM.to_string()),
        bytes_by_route,
        event_count: 0,
        events_dropped: dropped,
        events: Vec::new(),
    };
    Ok(assemble_window(events, dropped, template))
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

/// The stable `TONO_*` marker inside a connect error, or `UNKNOWN`. The Service
/// nests some markers inside its own context string, so the scan is not
/// anchored to the start.
pub(crate) fn failure_code(error: &str) -> String {
    let Some(start) = error.find("TONO_") else {
        return "UNKNOWN".to_string();
    };
    let token: String = error[start..]
        .chars()
        .take_while(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == '_')
        .take(80)
        .collect();
    if token.len() > "TONO_".len() {
        token
    } else {
        "UNKNOWN".to_string()
    }
}

/// Report one classified connect failure at once, then let one window follow
/// early. Detached: the connect path never waits on telemetry.
pub(crate) fn spawn_connect_failure_report(
    state: &Arc<TonoState>,
    stage: Option<&'static str>,
    code: String,
    error: String,
) {
    let state = state.clone();
    let _handle = AsyncHandler::spawn(move || async move {
        if let Some(generation) = report_connect_failure(&state, stage, code, error).await {
            tokio::time::sleep(EARLY_WINDOW_AFTER_FAILURE).await;
            let _ = upload_once(&state, generation).await;
        }
    });
}

/// Same consent as the window; skipped when no node was selected, because a
/// failure with nothing to pin to a machine is still carried by the window.
/// Returns the sign-in generation the report went out under.
async fn report_connect_failure(
    state: &Arc<TonoState>,
    stage: Option<&'static str>,
    code: String,
    error: String,
) -> Option<u64> {
    if !state.audit().periodic_telemetry_enabled() || !state.audit().enabled() {
        return None;
    }
    let (client, generation, node, tcp_delay_ms, exit_delay_ms) = {
        let inner = state.lock().await;
        if matches!(
            inner.account_state,
            crate::tono::state::AccountState::SignedOut | crate::tono::state::AccountState::Restoring
        ) {
            return None;
        }
        (
            inner.client.clone(),
            inner.sign_in_generation,
            inner.selected_node.clone(),
            inner.selected_tcp_delay_ms().map(|ms| ms as i64),
            inner.selected_exit_delay_ms().map(|ms| ms as i64),
        )
    };
    let node = node.filter(|name| !name.is_empty())?;
    let os_version = AsyncHandler::spawn_blocking(|| tauri_plugin_tono_sysinfo::os_long_version())
        .await
        .unwrap_or_else(|_| "Unknown".to_string());
    let report = ConnectFailureReport {
        ts: epoch_ms(),
        stage: stage.unwrap_or("unknown").to_string(),
        code,
        error: Some(redact(&error).chars().take(200).collect()),
        node: node.chars().take(120).collect(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os_version: os_version.chars().take(80).collect(),
        os_arch: std::env::consts::ARCH.to_string(),
        platform: PLATFORM.to_string(),
        core_errors: None,
        tcp_delay_ms,
        exit_delay_ms,
    };
    match client.upload_connect_failure(&report).await {
        Ok(_) => Some(generation),
        Err(err) => {
            logging!(warn, Type::Service, "Tono: connect failure report not delivered: {err}");
            None
        }
    }
}

fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn collect_events(path: &Path, start_ms: i64, end_ms: i64) -> Result<(Vec<TelemetryEvent>, u32), String> {
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
        writeln!(file, r#"{{"ts":{},"kind":"signInOk","email":"a@b.com"}}"#, now - 1000).unwrap();
        writeln!(file, r#"{{"ts":{},"kind":"networkChange","counter":3}}"#, now - 500).unwrap();
        writeln!(
            file,
            r#"{{"ts":{},"kind":"connectOk","node":"US","elapsedMs":1200}}"#,
            now - 100
        )
        .unwrap();
        let (events, dropped) = collect_events(&path, now - 60_000, now).unwrap();
        assert_eq!(events.len(), 2);
        assert!(dropped >= 1);
        assert!(events.iter().all(|e| e.kind != "signInOk"));
        assert_eq!(events[0].kind, "networkChange");
        assert_eq!(events[0].counter, Some(3));
    }

    #[test]
    fn collect_events_keeps_user_and_catalog_node_hops() {
        let dir = TempDir::new("hops");
        let path = dir.path().join("traffic-audit.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        let now = epoch_ms();
        writeln!(
            file,
            r#"{{"ts":{},"kind":"nodeSwitch","from":"Tokyo · Fuji","to":"Los Angeles · Pacific"}}"#,
            now - 500
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"ts":{},"kind":"connectCatalogFailover","from":"Los Angeles · Pacific","to":"Tokyo · Sakura"}}"#,
            now - 100
        )
        .unwrap();
        let (events, _) = collect_events(&path, now - 60_000, now).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, "nodeSwitch");
        assert_eq!(events[0].from.as_deref(), Some("Tokyo · Fuji"));
        assert_eq!(events[0].to.as_deref(), Some("Los Angeles · Pacific"));
        assert_eq!(events[1].kind, "connectCatalogFailover");
        assert_eq!(events[1].from.as_deref(), Some("Los Angeles · Pacific"));
        assert_eq!(events[1].to.as_deref(), Some("Tokyo · Sakura"));
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
            r#"{{"ts":{},"kind":"protectedRouteEvidence","generation":7,"residentialConnectionCount":1,"directConnectionCount":0,"proxiedConnectionCount":0,"blockedConnectionCount":0,"unknownConnectionCount":0,"latestRoute":"RESIDENTIAL","latestDestination":"ANTHROPIC"}}"#,
            now - 1000
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"ts":{},"kind":"protectedRouteEvidence","generation":7,"residentialConnectionCount":4,"directConnectionCount":2,"proxiedConnectionCount":1,"blockedConnectionCount":1,"unknownConnectionCount":1,"latestRoute":"PROXIED","latestDestination":"TURNSTILE","host":"private.example","path":"C:\\\\secret","node":"private-node","error":"private-error","probe":"private-probe"}}"#,
            now - 100
        )
        .unwrap();

        let (events, _) = collect_events(&path, now - 60_000, now).unwrap();
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
            r#"{{"ts":{},"kind":"disconnectOk","elapsedMs":45000,"bytesUp":1234,"bytesDown":5678}}"#,
            now - 100
        )
        .unwrap();
        let (events, _) = collect_events(&path, now - 60_000, now).unwrap();
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
            platform: Some(PLATFORM.to_string()),
            bytes_by_route,
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
}

#[cfg(test)]
mod failure_code_tests {
    use super::failure_code;

    #[test]
    fn the_marker_is_read_wherever_the_service_put_it() {
        assert_eq!(
            failure_code("TONO_NODE_OR_CORE_UNREACHABLE: tls handshake eof; suggest=Tokyo"),
            "TONO_NODE_OR_CORE_UNREACHABLE"
        );
        assert_eq!(
            failure_code("Tono Service is not ready: TONO_WFP_ENGINE_WEDGED: engine call timed out"),
            "TONO_WFP_ENGINE_WEDGED"
        );
        assert_eq!(failure_code("connection transition already in flight"), "UNKNOWN");
        assert_eq!(failure_code("TONO_"), "UNKNOWN");
    }
}
