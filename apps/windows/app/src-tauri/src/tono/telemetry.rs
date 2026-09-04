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
    ApiError, TELEMETRY_KIND_PERIODIC_WINDOW, TELEMETRY_SCHEMA_VERSION, TelemetryEvent, TelemetryWindowReport,
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
    let (mut events, dropped) = tokio::task::spawn_blocking(move || collect_events(&log_path, start_ms, now_ms))
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

    while !events.is_empty() {
        let candidate = TelemetryWindowReport {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            kind: TELEMETRY_KIND_PERIODIC_WINDOW.to_string(),
            window_start_ms: start_ms,
            window_end_ms: now_ms,
            app_version: app_version.clone(),
            os_version: os_version.clone(),
            os_arch: std::env::consts::ARCH.to_string(),
            ui_state: ui_state.clone(),
            account_state: account_state.clone(),
            selected_server: selected_server.clone(),
            catalog_revision,
            kill_switch_mode: kill_switch_mode.clone(),
            kill_switch_wanted,
            kill_switch_live,
            dns_enabled: None,
            exit_delay_ms,
            exit_delay_at_ms,
            tcp_delay_ms,
            tcp_delay_at_ms,
            event_count: events.len() as u32,
            events_dropped: dropped,
            events: events.clone(),
        };
        let size = serde_json::to_vec(&candidate).map(|v| v.len()).unwrap_or(usize::MAX);
        if size <= MAX_PAYLOAD_BYTES {
            return Ok(candidate);
        }
        events.remove(0);
    }

    Ok(TelemetryWindowReport {
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
        event_count: 0,
        events_dropped: dropped,
        events: Vec::new(),
    })
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
    const DESTINATIONS: [&str; 4] = ["ANTHROPIC", "TURNSTILE", "UPDATE", "TELEMETRY"];

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
}
