//! Connected-lifetime monitor, pin refresh, and network-change handling.

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tono_logging::{Type, logging};
use tono_plugin_core::{MihomoExt as _, models::Protocol};

use crate::core::service;
use crate::process::AsyncHandler;
use crate::tono::{
    audit::{self, AuditEvent},
    bootstrap, commands, signed_apps,
    connection_health::{
        CoreSample, HealthLegs, NetworkChangeOutcome, classify_core_sample, connection_loop_continues,
        core_change_fires, health_threshold_reached, kill_switch_unhealthy, monitor_requires_reconnect,
        network_event_fires, protected_dns_unhealthy,
    },
    connection_plan::{guard_rejection_is_transient, reconnect_allowed},
    state::TonoState,
};
use super::{
    Attempt, BoxedTask, MAX_DIRECT_SAMPLES, MAX_PROTECTED_ROUTE_SAMPLES, ProtectedRouteAggregate,
    SampledConnections, attempt, fail_connect, kill_switch_mode_key, new_direct_samples,
    observe_protected_routes, seed_autostart_after_connect,
};
use super::direct::dns_query_a;
use super::reconnect::schedule_reconnect;
use super::controller::{CONTROLLER_HTTP_TIMEOUT, controller_client, controller_url};
use super::probes::{verify_locked, verify_tun_data_plane};

/// `lookup_host` delegates to the OS resolver and has no Tokio timeout of its own. Bound every
/// lookup so a broken adapter/resolver cannot strand Connecting forever.
pub(super) const DNS_LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);

/// network_events poll cadence while Connected.
pub(super) const NETWORK_MONITOR_INTERVAL: Duration = Duration::from_secs(2);

/// F2: exit-probe cadence while Connected (the Mac "9.17 h fake-green"
/// lesson — a silent tunnel must be caught by probing, not by watching).
pub(super) const EXIT_PROBE_INTERVAL: Duration = Duration::from_secs(120);

/// How long a successful data-plane proof stands in for the next network-change event.
///
/// The event-driven probe below exists to tell a real network change apart from Tono's own
/// asynchronous WinTUN/route callbacks, and that reasoning is unchanged. What was missing is a
/// ceiling on how often it may run: the monitor ticks every
/// [`NETWORK_MONITOR_INTERVAL`], and on a machine whose adapters churn — a "network optimiser",
/// a second VPN, a flapping driver — Windows reports a new counter on nearly every tick. One
/// customer's audit log shows thirty-five events in four minutes, each starting a fresh
/// multi-origin HTTPS proof whose own budget is several seconds, so the probes overlapped and
/// piled up on a client that was otherwise healthy. Inside this window a proof that already
/// succeeded is reused; outside it the probe runs exactly as before. Detection is not weakened:
/// the periodic probe, the kill-switch leg, the DNS leg and the core-identity leg are all
/// untouched, and a burst that follows a genuine break still fails the first probe.
pub(super) const NETWORK_EVENT_PROBE_COOLDOWN: Duration = Duration::from_secs(15);

/// How long a recovered-in-place verdict stands before the same standing failure may fire the
/// monitor again.
///
/// A leg that stays unhealthy while the tunnel keeps carrying traffic — a Service that never
/// answers again, a wedged WFP — reaches [`HEALTH_FAILURE_THRESHOLD`] two ticks after every
/// re-seed, and every firing costs a warn line, an audit record and a three-origin HTTPS proof.
/// Unbounded that runs for the life of the session and rotates the audit file, erasing the record
/// of the very failure it is reporting. Inside this window the last proof still stands; a core
/// restart or a failed data-plane proof is fresh evidence and is never held back by it.
pub(super) const IN_PLACE_RECOVERY_COOLDOWN: Duration = Duration::from_secs(120);

/// The connected-lifetime monitor's tick source (H7). `Delay` re-bases the schedule after a slow
/// tick, so every threshold in [`HealthLegs`] counts genuinely *separate* observations spaced by
/// at least [`NETWORK_MONITOR_INTERVAL`]. `app/src-tauri/src/lib.rs` sets the same behaviour on
/// the main-thread pump watchdog for the same reason.
pub(super) fn monitor_interval() -> tokio::time::Interval {
    let mut interval = tokio::time::interval(NETWORK_MONITOR_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    interval
}

/// Remember control-plane addresses only from the protected resolver.
///
/// `bootstrap_hosts` still uses the system resolver so a first connect can
/// widen WFP for this session, but those answers must not be persisted: a
/// poisoned physical DNS would otherwise become tomorrow's recovery pin.
///
/// Runs once immediately, then every 15 minutes while this generation stays
/// connected, so a rotated anycast edge is learned without waiting for the
/// next reconnect.
pub(super) const CONTROL_PLANE_PIN_REFRESH_INTERVAL: Duration = Duration::from_secs(15 * 60);

/// WeChat path rediscovery. File identity (path/size/mtime) is cached, so a
/// miss only re-runs WinVerifyTrust when an install actually changes.
pub(super) const WECHAT_PATH_REFRESH_INTERVAL: Duration = Duration::from_secs(2 * 60);

/// Browser Secure DNS may be changed after Connect. Re-prove the browser-wide
/// setting while a residential route is active so that Web traffic cannot
/// silently lose hostname visibility until the next manual reconnect.
/// Nominal interval, not a hard detection deadline: scan timeout (5s), task
/// scheduling, and other awaited maintenance can extend the observation gap.
pub(super) const BROWSER_DNS_RECHECK_INTERVAL: Duration = Duration::from_secs(60);

/// How often the DIRECT overlay and protected residential routes are sampled while connected.
///
/// A sample, not a trace: each distinct `(address, port, protocol)` is recorded once per
/// session, so the cost is one controller read per minute and a handful of log lines on the
/// first minute of a session rather than one line per connection.
pub(super) const DIRECT_SAMPLE_INTERVAL: Duration = Duration::from_secs(60);

/// Upper bound on distinct destinations recorded in one session. WeChat's CDN rotates, so a
/// Read the controller once, record DIRECT diagnostics, and update protected-route evidence.
///
/// Returns `false` when the caller should stop sampling — a superseded generation, or every
/// applicable cap reached. Every other failure is swallowed: this is instrumentation, and a
/// controller that is briefly unreachable must never disturb a working tunnel.
pub(super) async fn sample_connections_once(
    state: &Arc<TonoState>,
    generation: u64,
    residential_target: Option<&str>,
    direct_seen: &mut std::collections::HashSet<(String, u16, bool, String)>,
    protected_seen: &mut std::collections::HashSet<u64>,
    protected_aggregate: &mut ProtectedRouteAggregate,
) -> bool {
    let direct_active = direct_seen.len() < MAX_DIRECT_SAMPLES;
    let protected_active = residential_target.is_some() && protected_seen.len() < MAX_PROTECTED_ROUTE_SAMPLES;
    if !direct_active && !protected_active {
        return false;
    }
    let (secret, port) = {
        let inner = state.lock().await;
        // `connect_generation`, matching the sibling arms of this task. The first version
        // compared `controller_generation` — a different counter, bumped per controller setup —
        // which never equalled the connect generation this task was spawned with, so the very
        // first tick disabled sampling and nothing was ever recorded.
        if inner.connect_generation != generation || !inner.fsm.status().is_connected {
            return false;
        }
        match inner.controller_secret.clone().zip(inner.controller_port) {
            Some(pair) => pair,
            None => return true,
        }
    };
    let Ok(client) = controller_client(Duration::from_secs(2)) else {
        return true;
    };
    let Ok(response) = client
        .get(controller_url(port, "/connections"))
        .bearer_auth(secret)
        .send()
        .await
    else {
        return true;
    };
    let Ok(payload) = response.json::<SampledConnections>().await else {
        return true;
    };

    if direct_active {
        for sample in new_direct_samples(&payload, direct_seen) {
            state.audit().log(crate::tono::audit::AuditEvent::DirectDial {
                address: sample.address,
                host: sample.host,
                port: sample.port,
                protocol: if sample.udp { "udp" } else { "tcp" },
                process: sample.process,
                chain: sample.chain,
                rule: sample.rule,
            });
        }
        if direct_seen.len() >= MAX_DIRECT_SAMPLES {
            state.audit().log(crate::tono::audit::AuditEvent::DirectDial {
                address: String::new(),
                host: String::new(),
                port: 0,
                protocol: "cap",
                process: String::new(),
                chain: String::new(),
                rule: format!("direct destination sample cap {MAX_DIRECT_SAMPLES} reached"),
            });
        }
    }

    if let Some(residential_target) = residential_target
        && protected_seen.len() < MAX_PROTECTED_ROUTE_SAMPLES
        && observe_protected_routes(
            &payload,
            residential_target,
            protected_seen,
            protected_aggregate,
        )
        && let Some((latest_route, latest_destination)) = protected_aggregate.latest
    {
        state.audit().log(crate::tono::audit::AuditEvent::ProtectedRouteEvidence {
            generation,
            residential_connection_count: protected_aggregate.residential,
            direct_connection_count: protected_aggregate.direct,
            proxied_connection_count: protected_aggregate.proxied,
            blocked_connection_count: protected_aggregate.blocked,
            unknown_connection_count: protected_aggregate.unknown,
            invariant_violation_count: protected_aggregate.invariant_violations(),
            latest_route: latest_route.as_str(),
            latest_destination: latest_destination.as_str(),
            sampling_capped: protected_seen.len() >= MAX_PROTECTED_ROUTE_SAMPLES,
        });
    }

    direct_seen.len() < MAX_DIRECT_SAMPLES
        || residential_target.is_some() && protected_seen.len() < MAX_PROTECTED_ROUTE_SAMPLES
}

pub(super) async fn spawn_control_plane_pin_refresh(
    state: &Arc<TonoState>,
    app: &AppHandle,
    generation: u64,
    residential_target: Option<String>,
) {
    let task_state = Arc::clone(state);
    let task_app = app.clone();
    let handle = AsyncHandler::spawn(move || async move {
        let mut pin_interval = tokio::time::interval(CONTROL_PLANE_PIN_REFRESH_INTERVAL);
        pin_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut wechat_interval = tokio::time::interval(WECHAT_PATH_REFRESH_INTERVAL);
        wechat_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut skip_first_wechat = true;
        let mut watching_wechat = true;
        let mut browser_dns_interval = tokio::time::interval_at(
            tokio::time::Instant::now() + BROWSER_DNS_RECHECK_INTERVAL,
            BROWSER_DNS_RECHECK_INTERVAL,
        );
        browser_dns_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut direct_interval = tokio::time::interval(DIRECT_SAMPLE_INTERVAL);
        direct_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut direct_seen: std::collections::HashSet<(String, u16, bool, String)> =
            std::collections::HashSet::new();
        let mut protected_seen = std::collections::HashSet::new();
        let mut protected_aggregate = ProtectedRouteAggregate::default();
        let mut sampling_connections = true;
        loop {
            tokio::select! {
                _ = direct_interval.tick(), if sampling_connections => {
                    sampling_connections = sample_connections_once(
                        &task_state,
                        generation,
                        residential_target.as_deref(),
                        &mut direct_seen,
                        &mut protected_seen,
                        &mut protected_aggregate,
                    ).await;
                }
                _ = pin_interval.tick() => {
                    if !refresh_control_plane_pins_once(&task_state, generation).await {
                        return;
                    }
                }
                _ = browser_dns_interval.tick(), if residential_target.is_some() => {
                    #[cfg(windows)]
                    if let Err(error) = crate::tono::browser_dns::verify_residential_browser_dns().await {
                        let redacted = audit::redact(&error);
                        logging!(
                            error,
                            Type::Service,
                            "Tono: browser Secure DNS verification failed during a residential session; restricting traffic and reconnecting: {redacted}"
                        );
                        task_state.audit().log(AuditEvent::HealthProbeFail {
                            probe: "browserDns",
                            error: redacted,
                        });
                        if !connection_loop_continues(
                            handle_network_change_inner(&task_state, &task_app, false).await,
                        ) {
                            return;
                        }
                    }
                }
                _ = wechat_interval.tick(), if watching_wechat => {
                    if skip_first_wechat {
                        skip_first_wechat = false;
                        continue;
                    }
                    if signed_wechat_paths_require_reconnect(&task_state, generation).await {
                        if !connection_loop_continues(handle_network_change(&task_state, &task_app).await) {
                            return;
                        }
                        // Recovered in place: no reconnect ran, so the applied path set cannot
                        // change for the rest of this session and this leg would report the same
                        // difference every two minutes. Retire the leg, not the task — the pin
                        // refresh and the direct sampling keep running.
                        watching_wechat = false;
                    }
                }
            }
        }
    });
    let mut inner = state.lock().await;
    if inner.connect_generation != generation || !inner.fsm.status().is_connected {
        handle.abort();
        return;
    }
    inner.tasks.abort_pin_refresh();
    inner.tasks.pin_refresh = Some(handle);
}

pub(super) async fn refresh_control_plane_pins_once(state: &Arc<TonoState>, generation: u64) -> bool {
    let (secret, port) = {
        let inner = state.lock().await;
        if inner.connect_generation != generation || !inner.fsm.status().is_connected {
            return false;
        }
        match (inner.controller_secret.clone(), inner.controller_port) {
            (Some(secret), Some(port)) => (secret, port),
            // Still connected: the controller endpoint is mid-replace. Keep
            // the 15-minute loop instead of aborting it forever.
            _ => return true,
        }
    };
    let Ok(client) = controller_client(CONTROLLER_HTTP_TIMEOUT) else {
        return true;
    };
    let Ok(addresses) = dns_query_a(&client, &secret, port, bootstrap::API_HOST).await else {
        return true;
    };
    let learned: Vec<String> = addresses
        .into_iter()
        .filter(|ip| tono_core::node::is_public_ipv4(*ip))
        .map(|ip| ip.to_string())
        .collect();
    if learned.is_empty() {
        return true;
    }
    bootstrap::remember_control_plane_addresses(&learned);
    bootstrap::persist_learned_pins_to_service().await;
    let inner = state.lock().await;
    if inner.connect_generation != generation {
        return false;
    }
    if let Err(error) = inner.client.transport().refresh_control_plane_pins().await {
        logging!(
            warn,
            Type::Service,
            "Tono: failed to refresh control-plane HTTP pins: {error:#}"
        );
    }
    true
}

pub(super) fn wechat_paths_changed(applied: Option<&[String]>, discovered: &[String]) -> bool {
    let Some(applied) = applied else {
        return false;
    };
    applied != discovered
}

pub(super) async fn signed_wechat_paths_require_reconnect(state: &Arc<TonoState>, generation: u64) -> bool {
    let applied = {
        let inner = state.lock().await;
        if inner.connect_generation != generation || !inner.fsm.status().is_connected {
            return false;
        }
        inner.applied_wechat_path_regexes.clone()
    };
    if applied.is_none() {
        return false;
    }
    let discovered = tokio::task::spawn_blocking(
        signed_apps::discover_signed_reviewed_direct_path_regexes,
    )
        .await
        .unwrap_or_default();
    let inner = state.lock().await;
    if inner.connect_generation != generation || !inner.fsm.status().is_connected {
        return false;
    }
    if wechat_paths_changed(applied.as_deref(), &discovered) {
        logging!(
            info,
            Type::Service,
            "Tono: signed reviewed direct-app paths changed; scheduling a protected reconnect"
        );
        true
    } else {
        false
    }
}

pub(super) fn spawn_exit_identity_lookup(state: &Arc<TonoState>, app: &AppHandle, generation: u64) {
    let state = Arc::clone(state);
    let app = app.clone();
    AsyncHandler::spawn(move || async move {
        let Ok(client) = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(4))
            .build()
        else {
            return;
        };
        let Ok(response) = client.get("https://api.ipapi.is").send().await else {
            return;
        };
        let Ok(json) = response.json::<serde_json::Value>().await else {
            return;
        };
        if json.get("error").is_some() {
            return;
        }
        let ip = json.get("ip").and_then(|value| value.as_str()).unwrap_or("");
        if ip.is_empty() {
            return;
        }
        let nested_location = json.get("location").and_then(|value| value.as_object());
        let nested_asn = json.get("asn").and_then(|value| value.as_object());
        let country = json
            .get("cc")
            .and_then(|value| value.as_str())
            .or_else(|| {
                nested_location
                    .and_then(|location| location.get("country_code"))
                    .and_then(|value| value.as_str())
            })
            .unwrap_or("");
        let org = json
            .get("asn_org")
            .and_then(|value| value.as_str())
            .or_else(|| json.get("company_name").and_then(|value| value.as_str()))
            .or_else(|| {
                nested_asn
                    .and_then(|asn| asn.get("org"))
                    .and_then(|value| value.as_str())
            })
            .unwrap_or("");
        let location = if country.is_empty() {
            None
        } else {
            Some(country.to_string())
        };
        let mut inner = state.lock().await;
        if inner.connect_generation != generation || !inner.fsm.status().is_connected {
            return;
        }
        inner.exit_ip = Some(ip.to_string());
        inner.exit_org = (!org.is_empty()).then(|| org.to_string());
        inner.exit_location = location;
        commands::emit_status(&app, &commands::status_of(&inner));
    });
}

/// Poll the Service network-event feed while Connected. Any counter change
/// (adapter change, sleep/wake) or core identity change (crash / TUN
/// rebuild, M4) invalidates Connected and reruns the full transaction
/// behind the still-armed barrier (§6).
pub(super) async fn spawn_network_monitor(state: &Arc<TonoState>, app: &AppHandle) {
    let task_state = state.clone();
    let task_app = app.clone();
    // Boxed trait object: the monitor loop re-enters `attempt`, so embedding
    // its opaque type here would make the async types infinitely recursive.
    let handle = AsyncHandler::spawn(move || Box::pin(network_monitor_loop(task_state, task_app)) as BoxedTask);
    let mut inner = state.lock().await;
    inner.tasks.abort_network_monitor();
    inner.tasks.network_monitor = Some(handle);
}

/// F2 leg 2: periodically repeat the same authoritative multi-origin real App request used at
/// Connect. The controller delay API is deliberately excluded: under `unified-delay` it is a
/// doubled measurement and persistent 504s on distant Reality exits do not prove user traffic is
/// dead. A single public origin is likewise insufficient: every independent TLS target must fail
/// before this leg reports failure.
pub(super) async fn periodic_data_plane_probe_failed(state: &Arc<TonoState>) -> bool {
    match verify_tun_data_plane().await {
        Ok(()) => false,
        Err(err) => {
            state.audit().log(AuditEvent::HealthProbeFail {
                probe: "tunDataPlane",
                error: err,
            });
            true
        }
    }
}

/// Whether the in-place recovery hold may still stand in for a teardown the Service leg asked
/// for. The cooldown bounds how long that hold runs; this is what it is held *on*: a data-plane
/// proof, taken fresh unless one is still inside [`NETWORK_EVENT_PROBE_COOLDOWN`] — without that
/// reuse a Service that never answers again would probe every other tick for the whole session.
pub(super) async fn in_place_hold_still_proven(
    state: &Arc<TonoState>,
    legs: &mut HealthLegs,
    last_proof: &mut Option<std::time::Instant>,
) -> bool {
    if last_proof.is_some_and(|at| at.elapsed() < NETWORK_EVENT_PROBE_COOLDOWN) {
        return true;
    }
    let failed = periodic_data_plane_probe_failed(state).await;
    *last_proof = if failed { None } else { Some(std::time::Instant::now()) };
    legs.observe_probe(failed);
    !failed
}

pub(super) async fn network_monitor_loop(state: Arc<TonoState>, app: AppHandle) {
    // H7: `Delay`, never the default `Burst` — see `HEALTH_FAILURE_THRESHOLD`.
    let mut interval = monitor_interval();
    interval.tick().await;
    let mut legs = HealthLegs::default();
    let mut missing_core_samples = 0_u32;
    let mut last_probe = std::time::Instant::now();
    // The last successful data-plane proof taken outside the periodic cadence, `None` until the
    // first one so the first network change after connect is always probed rather than inheriting
    // the connect-time verdict. The service-unreachable hold below reads and writes it too: a
    // proof is a proof whichever path paid for it, and reusing it inside
    // [`NETWORK_EVENT_PROBE_COOLDOWN`] is what keeps the hold from probing every other tick.
    let mut last_event_probe_ok: Option<std::time::Instant> = None;
    // The last recovered-in-place verdict, so a leg that stays failed while the tunnel keeps
    // working re-proves the data plane at the exit-probe cadence rather than every two ticks.
    let mut last_in_place_recovery: Option<std::time::Instant> = None;
    loop {
        interval.tick().await;
        {
            let inner = state.lock().await;
            if !inner.fsm.status().is_connected {
                return;
            }
        }
        let snapshot = match service::tono_service_status_snapshot().await {
            Ok(snapshot) => snapshot,
            Err(error) => {
                // A dead/unreachable Service is not a neutral sample: it is one failed
                // observation on the Service leg (H8 — it used to be counted on the kill-switch
                // *and* the protected-DNS leg against an `||` test, which made a single failing
                // poll worth two failures). Fail-closed is unchanged: consecutive failures still
                // reach the threshold and invalidate Connected. The other legs keep their
                // counters — a failed poll observed nothing, so it clears nothing either.
                legs.observe_service_failure();
                state.audit().log(AuditEvent::HealthProbeFail {
                    probe: "service",
                    error: error.to_string(),
                });
                if legs.invalid() {
                    // A Service that never answers again reaches the threshold two ticks after
                    // every re-seed; the cooldown is what stops that firing for the whole session.
                    if last_in_place_recovery.is_some_and(|at| at.elapsed() < IN_PLACE_RECOVERY_COOLDOWN) {
                        // Re-seed the one leg this poll observed. Wiping the whole record threw
                        // away kill-switch, protected-DNS and probe counts that a failed Service
                        // poll never contradicted — and nothing re-observes those legs for as
                        // long as the Service stays unreachable, so they were lost, not deferred.
                        legs.observe_service_ok();
                        // Elapsed time on its own is not evidence: this path continues before
                        // the periodic probe below, so nothing watches the tunnel while the hold
                        // runs.
                        if in_place_hold_still_proven(&state, &mut legs, &mut last_event_probe_ok).await {
                            continue;
                        }
                    }
                    if !connection_loop_continues(handle_network_change(&state, &app).await) {
                        return;
                    }
                    // The TUN proof succeeded: the Service was merely unreachable — an SCM
                    // recovery restart, or the updater replacing the runtime — while the tunnel
                    // it had already locked kept carrying traffic. Re-seed the legs (a failed
                    // poll observed nothing else, so a stale counter here would fire again on
                    // the very next tick) and keep monitoring this same session.
                    last_in_place_recovery = Some(std::time::Instant::now());
                    legs = HealthLegs::default();
                }
                continue;
            }
        };
        legs.observe_service_ok();

        // F2 leg 1: kill-switch completeness every tick.
        legs.observe_kill_switch(kill_switch_unhealthy(snapshot.kill_switch.as_ref()));

        // DNS health is checked independently of netmon. The first network event is used only
        // to seed the counter (to ignore our own connect-time interface churn), so an adapter
        // arriving in that narrow window would otherwise remain external-DNS until another event.
        let protected_dns = service::tono_protected_dns_status().await.ok();
        legs.observe_protected_dns(protected_dns_unhealthy(protected_dns.as_ref()));

        // F2 leg 2: periodic real App data-plane probe through the tunnel.
        if last_probe.elapsed() >= EXIT_PROBE_INTERVAL {
            last_probe = std::time::Instant::now();
            legs.observe_probe(periodic_data_plane_probe_failed(&state).await);
        }
        let health_invalid = legs.invalid();
        let protection_invalid = legs.protection_invalid();

        let (invalidate, network_changed, core_changed, kill_switch_snapshot, service_events) = {
            let mut inner = state.lock().await;

            // L3: surface kill switch changes as they are observed.
            let kill_switch_changed = snapshot.kill_switch.is_some() && inner.kill_switch != snapshot.kill_switch;
            if let Some(kill_switch) = &snapshot.kill_switch {
                inner.kill_switch = Some(kill_switch.clone());
            }

            // The first sample seeds every leg without firing (unchanged
            // first-seed semantics); afterwards the legs compare whole
            // Options so a seeded-None → Some transition is caught too (L-1).
            let first_sample = inner.network_events_counter.is_none();
            let counter = snapshot.network_events.counter;
            let network_changed = !first_sample && inner.network_events_counter != Some(counter);
            inner.network_events_counter = Some(counter);

            // M4: a core crash/restart shows up as a new pid or a bumped restart counter; the
            // TUN LUID is re-resolved by the fresh transaction's lock phase.
            //
            // H4: a *quiet* `core_pid: None` is not proof of a crash — the Service emits it
            // (with `restart_count: 0`, no error) whenever its per-poll `is_active` check reads
            // `Ok(None)` — so it must be sustained before it fires, and the baseline pid is kept
            // until it does. Overwriting the baseline with the quiet `None` would make the very
            // next healthy sample look like a pid change and tear the tunnel down anyway.
            let old_pid = inner.last_core_pid;
            let sample = classify_core_sample(
                inner.last_core_pid,
                inner.last_restart_count,
                snapshot.core_pid,
                snapshot.restart_count,
            );
            missing_core_samples = if sample == CoreSample::Missing {
                missing_core_samples.saturating_add(1)
            } else {
                0
            };
            let core_changed = !first_sample && core_change_fires(sample, missing_core_samples);
            if sample != CoreSample::Missing || core_changed {
                inner.last_core_pid = snapshot.core_pid;
                inner.last_restart_count = Some(snapshot.restart_count);
            }

            // P0-13: merge event bursts — only the first change inside the
            // debounce window invalidates Connected.
            let invalidated = network_event_fires(
                network_changed || core_changed,
                inner.last_network_event_at.map(|at| at.elapsed()),
            );
            if invalidated {
                inner.last_network_event_at = Some(std::time::Instant::now());
            }

            let snapshot_for_emit = kill_switch_changed.then(|| commands::status_of(&inner));
            let mut events: Vec<AuditEvent> = Vec::new();
            if kill_switch_changed && let Some(kill_switch) = &snapshot.kill_switch {
                events.push(AuditEvent::KillSwitchSnapshot {
                    wanted: kill_switch.wanted,
                    live: kill_switch.live,
                    mode: kill_switch_mode_key(kill_switch.mode),
                    endpoints: kill_switch.endpoints.len(),
                });
            }
            if network_changed {
                events.push(AuditEvent::NetworkChange { counter });
            }
            if core_changed {
                events.push(AuditEvent::CoreRestart {
                    old_pid,
                    new_pid: snapshot.core_pid,
                    restart_count: snapshot.restart_count,
                });
            }
            (invalidated, network_changed, core_changed, snapshot_for_emit, events)
        };
        for event in service_events {
            state.audit().log(event);
        }
        if let Some(status) = kill_switch_snapshot {
            commands::emit_status(&app, &status);
        }

        // IP Helper delivers Tono's own WinTUN/route and DNS-reconciliation callbacks
        // asynchronously. A callback can therefore land after the Service write window and
        // after this monitor seeded its counter, producing the old connectOk -> networkChange ->
        // reconnect loop. Do not trust the event either way: under the still-locked barrier,
        // repeat the same multi-origin HTTPS proof that admitted Connected. Success proves the
        // current tunnel still carries user traffic; failure corroborates the event and keeps the
        // existing fail-closed reconnect. Core identity and health failures remain unconditional.
        let event_probe_failed = if invalidate && network_changed && !core_changed && !health_invalid {
            let recently_proven = last_event_probe_ok
                .is_some_and(|at| at.elapsed() < NETWORK_EVENT_PROBE_COOLDOWN);
            if recently_proven {
                logging!(
                    info,
                    Type::Service,
                    "Tono: another Windows network change inside the proof window; reusing the last data-plane proof instead of probing again"
                );
                false
            } else {
                let failed = periodic_data_plane_probe_failed(&state).await;
                last_event_probe_ok = if failed {
                    None
                } else {
                    Some(std::time::Instant::now())
                };
                failed
            }
        } else {
            false
        };
        if invalidate && network_changed && !core_changed && !health_invalid && !event_probe_failed {
            logging!(
                info,
                Type::Service,
                "Tono: Windows reported a network change, but the locked TUN data plane remains healthy; keeping Connected"
            );
            legs.observe_probe(false);
            let generation = state.lock().await.connect_generation;
            let _ = refresh_control_plane_pins_once(&state, generation).await;
        }
        if monitor_requires_reconnect(invalidate, core_changed, health_invalid, event_probe_failed) {
            // A Service transport outage may reuse a recent proof in the branch
            // above. A successful Service snapshot that explicitly says WFP or
            // protected DNS is broken may not: HTTPS can still work while the
            // fail-closed boundary is absent. Force that case through repair;
            // ordinary network hints and exit-probe failures may still be
            // contradicted by a fresh in-place data-plane proof.
            if !connection_loop_continues(
                handle_network_change_inner(&state, &app, !protection_invalid).await,
            ) {
                return;
            }
            // Nothing was torn down, so this monitor still owns the live session. Re-seed the
            // legs against the fresh TUN proof rather than leaving the counters that fired.
            last_in_place_recovery = Some(std::time::Instant::now());
            legs = HealthLegs::default();
        }
    }
}

/// Network adapter change / sleep-wake / core restart / policy behavior
/// change (§6, M4, Build 28): invalidate Connected first, keep WFP armed
/// (restrict to bootstrap), rerun the full transaction.
///
/// The verdict is for the caller's own loop, not for the tunnel:
/// [`NetworkChangeOutcome::RecoveredInPlace`] means nothing was torn down and the caller is
/// still running inside the session it started in (see [`connection_loop_continues`]).
pub(crate) async fn handle_network_change(state: &Arc<TonoState>, app: &AppHandle) -> NetworkChangeOutcome {
    handle_network_change_inner(state, app, true).await
}

pub(super) async fn handle_network_change_inner(
    state: &Arc<TonoState>,
    app: &AppHandle,
    allow_in_place: bool,
) -> NetworkChangeOutcome {
    logging!(warn, Type::Service, "Tono: 检测到网络或核心变化，失效 Connected 并重连");
    // Captured under the same guard as the `is_connected` check, because that check is the
    // *entry* condition and everything below it runs across awaits. This helper is reached from
    // two callers and only one of them is connection-scoped: the cloud-policy sync runs inside
    // `tasks.catalog_sync`, which is account-scoped and deliberately survives a disconnect, so
    // `invalidate_connection` never aborts it. Without a generation, a policy revision arriving
    // while Connected would tear the tunnel down, the user would press Disconnect during the
    // resulting Protected Offline flash, the release would complete — and this task would then
    // walk into `attempt` and silently re-arm WFP and restart the core with no user action.
    // The netmon caller was protected only by accident, by `abort_network_monitor()` landing at
    // its next await; now both are protected on purpose.
    let generation = {
        let mut inner = state.lock().await;
        // `is_disconnecting` is redundant now that `begin_disconnect` clears
        // `is_connected`, and it is written out anyway: this guard is the one
        // that has to say "not while a release is in flight" out loud, because
        // the generation captured below is the disconnect's own once one has
        // started, and the exit guard then compares a value to itself.
        let status = inner.fsm.status();
        if !status.is_connected || status.is_disconnecting {
            return NetworkChangeOutcome::Handled;
        }
        inner.connect_generation
    };
    // Prefer an in-place proof while the core is still the same process.
    // Sleep/Wi-Fi flaps used to stop the core unconditionally, then burn the
    // first reconnect on "DNS 53 busy" because the just-killed listener was
    // the one we needed.
    if allow_in_place && verify_tun_data_plane().await.is_ok() {
        logging!(
            info,
            Type::Service,
            "Tono: network change recovered in place; core was not restarted"
        );
        return NetworkChangeOutcome::RecoveredInPlace;
    }
    {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation || inner.fsm.status().is_disconnecting {
            return NetworkChangeOutcome::Handled;
        }
        inner.fsm.tunnel_died();
        commands::emit_status(&app, &commands::status_of(&inner));
    }
    state.audit().log(AuditEvent::ProtectedOffline {
        reason: "networkChange",
    });
    let _ = service::tono_restrict_bootstrap().await;
    // Stop the core before re-attempting, like both sibling teardowns (`switch_selected_node`,
    // `selected_node_vanished`). `restrict_bootstrap` only rewrites WFP; it leaves mihomo
    // running, and mihomo owns loopback:53 for the whole session — the very port `run_stages`'
    // DNS preflight binds. Without this, every sleep/wake and Wi-Fi flap burned attempt #1 on a
    // guaranteed "DNS UDP 127.0.0.1:53 is unavailable", recorded a ConnectFail, bumped the retry
    // counter and showed a DNS error, and only then stopped the core on the way out.
    // `false` = keep blocking: the core goes down, the barrier stays armed.
    let _ = service::tono_stop_core(false).await;
    // Immediately before re-entering the transaction, and deliberately not earlier: a disconnect
    // bumps the generation as its very first act (`invalidate_connection(true)`, before any
    // IPC), so any release that will complete has already bumped by the time this reads. A moved
    // generation means someone else owns the machine — exit without touching the FSM, the core
    // or the UI, exactly like `StageFailure::Stale`.
    {
        let inner = state.lock().await;
        if inner.connect_generation != generation || inner.fsm.status().is_disconnecting {
            logging!(
                info,
                Type::Service,
                "Tono: 网络变化重连已被更新的连接代际取代，交由其所有者处理"
            );
            return NetworkChangeOutcome::Handled;
        }
    }
    match attempt(state, app).await {
        Attempt::Failed(err) => {
            let _ = fail_connect(state, app, err).await;
            schedule_reconnect(state, app).await;
        }
        // A transient guard (a release still reconciling, a transition still finishing) is not a
        // verdict — without a reschedule the machine sits blocked with nothing left to retry.
        Attempt::GuardRejected(reason) if guard_rejection_is_transient(&reason) => {
            logging!(info, Type::Service, "Tono: 重连被暂态守卫拒绝，稍后重试: {reason}");
            schedule_reconnect(state, app).await;
        }
        Attempt::Connected => seed_autostart_after_connect(),
        Attempt::GuardRejected(_) | Attempt::Stale => {}
    }
    // Everything past the in-place proof stopped the core, so even a fresh `Attempt::Connected`
    // is a new session with its own monitor and tasks: no caller's loop survives it.
    NetworkChangeOutcome::Handled
}

pub(super) async fn refresh_control_plane_pins_from_service(state: &TonoState) {
    bootstrap::hydrate_learned_pins_from_service().await;
    let inner = state.lock().await;
    if let Err(error) = inner.client.transport().refresh_control_plane_pins().await {
        logging!(
            warn,
            Type::Service,
            "Tono: failed to apply learned control-plane HTTP pins: {error:#}"
        );
    }
}

/// F1: merge the pinned bootstrap IPs with the live resolution of the API
/// host (best-effort — a failed lookup just yields the pins alone).
pub(super) async fn bootstrap_hosts() -> Vec<String> {
    let dynamic: Vec<String> =
        match tokio::time::timeout(DNS_LOOKUP_TIMEOUT, tokio::net::lookup_host((bootstrap::API_HOST, 443))).await {
            Ok(Ok(addrs)) => addrs.map(|addr| addr.ip().to_string()).collect(),
            Ok(Err(_)) | Err(_) => Vec::new(),
        };
    bootstrap::merge_bootstrap_hosts(&dynamic)
}
