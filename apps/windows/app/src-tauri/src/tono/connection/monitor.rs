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
        CoreSample, HealthLegs, NetworkChangeOutcome, RecoveryReason, adapter_noise_keeps_session,
        classify_core_sample, connection_loop_continues, core_change_fires, kill_switch_unhealthy,
        monitor_requires_reconnect, network_event_fires, protected_dns_unhealthy,
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
use super::probes::probe_exit_once;
use super::physical_route::{RepairBudget, RouteEvent, RouteTracker, observe_route};

/// Connected-lifetime observation cadence, unchanged by the local deduplication.
pub(super) const NETWORK_MONITOR_INTERVAL: Duration = Duration::from_secs(2);

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
/// First connect uses compiled and Service-owned learned pins. Fresh answers
/// are learned here through the protected resolver, never persisted from an
/// unprotected physical-DNS lookup.
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
                            handle_network_change_inner(
                                &task_state,
                                &task_app,
                                RecoveryReason::BrowserDnsFailed,
                            )
                            .await,
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
                        if !connection_loop_continues(
                            handle_network_change(
                                &task_state,
                                &task_app,
                                RecoveryReason::DirectAppPathsChanged,
                            )
                            .await,
                        ) {
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

/// Advisory controller `/delay`, started at controller-ready so it overlaps
/// DNS and the admit TUN race. Not a gate and not an `exit_verified` input —
/// persistent 504s on distant Reality exits do not prove user traffic is dead.
/// Generation-only: `is_connected` is still false when this is spawned.
pub(super) fn spawn_advisory_exit_delay(state: &Arc<TonoState>, app: &AppHandle, generation: u64) {
    let state = Arc::clone(state);
    let app = app.clone();
    AsyncHandler::spawn(move || async move {
        let (secret, controller_port) = {
            let inner = state.lock().await;
            if inner.connect_generation != generation {
                return;
            }
            match (
                inner.controller_secret.clone(),
                inner.controller_port,
            ) {
                (Some(secret), Some(port)) => (secret, port),
                _ => return,
            }
        };
        let Ok(delay) = probe_exit_once(&secret, controller_port).await else {
            return;
        };
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            return;
        }
        inner.record_exit_delay(delay);
        commands::emit_status(&app, &commands::status_of(&inner));
    });
}

pub(super) fn asn_org_from_ipapi(json: &serde_json::Value) -> Option<String> {
    let nested_asn = json.get("asn").and_then(|value| value.as_object());
    let org = json
        .get("asn_org")
        .and_then(|value| value.as_str())
        .or_else(|| json.get("company_name").and_then(|value| value.as_str()))
        .or_else(|| {
            nested_asn
                .and_then(|asn| asn.get("org"))
                .and_then(|value| value.as_str())
        })
        .unwrap_or("")
        .trim();
    (!org.is_empty()).then(|| org.to_string())
}

/// DIRECT lookup of the home ISP, started before WFP lock so it can finish
/// during StartClash. Stored org is suggestion-only.
pub(super) fn spawn_isp_lookup(state: &Arc<TonoState>, app: &AppHandle, generation: u64) {
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
        let Some(org) = asn_org_from_ipapi(&json) else {
            return;
        };
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            return;
        }
        inner.isp_org = Some(org);
        commands::emit_status(&app, &commands::status_of(&inner));
    });
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
        let country = json
            .get("cc")
            .and_then(|value| value.as_str())
            .or_else(|| {
                nested_location
                    .and_then(|location| location.get("country_code"))
                    .and_then(|value| value.as_str())
            })
            .unwrap_or("");
        let org = asn_org_from_ipapi(&json).unwrap_or_default();
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

pub(super) async fn network_monitor_loop(state: Arc<TonoState>, app: AppHandle) {
    // H7: `Delay`, never the default `Burst` — see `HEALTH_FAILURE_THRESHOLD`.
    let mut interval = monitor_interval();
    interval.tick().await;
    let mut legs = HealthLegs::default();
    let mut missing_core_samples = 0_u32;
    let generation = state.lock().await.connect_generation;
    let mut service_unconfirmed = false;
    let mut local_repairs = RepairBudget::default();
    let mut route_repairs = RepairBudget::default();
    let mut route_tracker = RouteTracker::default();
    let mut route_dirty = false;
    let mut last_route_probe: Option<std::time::Instant> = None;
    let service_session = service::active_service_session().ok();

    loop {
        interval.tick().await;
        {
            let inner = state.lock().await;
            if inner.connect_generation != generation
                || inner.fsm.status().is_disconnecting
                || inner.fsm.status().is_connecting
                || (!inner.fsm.status().is_connected && !service_unconfirmed)
            {
                return;
            }
        }
        let (service_result, dns_result) = tokio::join!(
            service::tono_service_status_snapshot(), service::tono_protected_dns_status(),
        );
        let snapshot = match service_result {
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
                if legs.invalid() && !service_unconfirmed {
                    let mut inner = state.lock().await;
                    if inner.connect_generation != generation || inner.fsm.status().is_disconnecting {
                        return;
                    }
                    // IPC is an observation failure, not evidence that mihomo died.
                    // Withdraw the green claim, retain the persistent WFP floor and core,
                    // and keep polling. No HTTPS proof, StopClash or elapsed-time proof.
                    inner.fsm.tunnel_died();
                    if let Some(ks) = &mut inner.kill_switch {
                        ks.live = false;
                    }
                    service_unconfirmed = true;
                    commands::emit_status(&app, &commands::status_of(&inner));
                    state.audit().log(AuditEvent::ProtectedOffline { reason: "serviceUnconfirmed" });
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
        let protected_dns = dns_result.ok();
        legs.observe_protected_dns(protected_dns_unhealthy(protected_dns.as_ref()));

        let health_invalid = legs.invalid();
        let protection_invalid = legs.protection_invalid();

        let (invalidate, network_changed, core_changed, kill_switch_snapshot, service_events) = {
            let mut inner = state.lock().await;

            if inner.connect_generation != generation || inner.fsm.status().is_disconnecting {
                return;
            }
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

        // Notifications are hints, not transitions. Pending changes are sampled
        // again even without a second notification; a slow periodic sample covers
        // a missed IP Helper callback. This never delays initial Connected.
        if network_changed || route_tracker.pending()
            || last_route_probe.is_none_or(|at| at.elapsed() >= Duration::from_secs(15))
        {
            let observation = observe_route(route_tracker.current()).await;
            last_route_probe = Some(std::time::Instant::now());
            if route_tracker.observe(observation) == RouteEvent::Changed {
                route_dirty = true;
                route_repairs.reset();
                logging!(info, Type::Service, "Tono: physical route changed; reconciling local protection without replacing Core");
            }
        }

        let exit_changed = {
            let inner = state.lock().await;
            !crate::tono::exit_transport::applied_matches(&inner)
        };
        if exit_changed {
            if !connection_loop_continues(handle_network_change_inner(
                &state, &app, RecoveryReason::ExitConfigurationChanged,
            ).await) { return; }
            continue;
        }
        let home_changed = {
            let inner = state.lock().await;
            !super::same_residential_route(inner.routing.as_ref(), inner.applied_routing.as_ref())
        };
        if home_changed {
            if !connection_loop_continues(handle_network_change_inner(
                &state, &app, RecoveryReason::HomeRoutingChanged,
            ).await) { return; }
            continue;
        }

        if protection_invalid && !core_changed {
            {
                let mut inner = state.lock().await;
                if inner.connect_generation != generation || inner.fsm.status().is_disconnecting { return; }
                inner.fsm.tunnel_died();
                service_unconfirmed = true;
                commands::emit_status(&app, &commands::status_of(&inner));
            }
            // Repair rate is bounded, not lifetime: a third failure must not strand
            // the same core forever. Keep observing and retry slowly while offline;
            // never feed standing DNS failure into StopClash loops.
            if local_repairs.ready(std::time::Instant::now()) && let Some(session) = service_session.clone() {
                local_repairs.attempted(std::time::Instant::now());
                if let Ok(proof) = repair_local_protection(
                    &state, generation, session.clone(), snapshot.core_pid, snapshot.core_generation,
                    kill_switch_unhealthy(snapshot.kill_switch.as_ref()),
                ).await {
                    if accept_recovery_proof(&state, &app, generation, &session, snapshot.core_pid,
                        snapshot.core_generation, proof).await {
                        service_unconfirmed = false;
                        route_dirty = false;
                        local_repairs.reset();
                        route_repairs.reset();
                        legs = HealthLegs::default();
                    }
                }
            }
            continue;
        }

        if route_dirty && !core_changed && !health_invalid
            && route_repairs.ready(std::time::Instant::now())
            && let Some(session) = service_session.clone()
        {
            route_repairs.attempted(std::time::Instant::now());
            // The owned runtime already uses auto-route/auto-detect-interface; do
            // not restart or reload WinTUN for a physical route change. New DNS
            // adapters are reconciled, with the same local fake-ip gate as admission.
            let result = repair_local_protection(&state, generation, session.clone(),
                snapshot.core_pid, snapshot.core_generation, false).await;
            if let Ok(proof) = result {
                if accept_recovery_proof(&state, &app, generation, &session, snapshot.core_pid,
                    snapshot.core_generation, proof).await {
                    route_dirty = false;
                    service_unconfirmed = false;
                    route_repairs.reset();
                    local_repairs.reset();
                }
            }
            if route_dirty {
                let mut inner = state.lock().await;
                if inner.connect_generation != generation || inner.fsm.status().is_disconnecting { return; }
                inner.fsm.tunnel_died();
                service_unconfirmed = true;
                commands::emit_status(&app, &commands::status_of(&inner));
            }
        }

        if service_unconfirmed && !core_changed && !route_dirty
            && snapshot.core_pid.is_some()
            && !kill_switch_unhealthy(snapshot.kill_switch.as_ref())
            && !protected_dns_unhealthy(protected_dns.as_ref())
            && local_repairs.ready(std::time::Instant::now())
        {
            // Same captured core, one fake-ip and one fresh Service receipt. The
            // receipt is consumed now, never carried into a later monitor tick.
            if let Some(session) = service_session.as_ref() {
                local_repairs.attempted(std::time::Instant::now());
                // /dns/status is an observation cache, not this round's native
                // admission proof. The idempotent enable freshly proves DNS too.
                if let Ok(proof) = repair_local_protection(&state, generation, session.clone(),
                    snapshot.core_pid, snapshot.core_generation, false).await {
                    if accept_recovery_proof(&state, &app, generation, session, snapshot.core_pid,
                        snapshot.core_generation, proof).await {
                        service_unconfirmed = false;
                        local_repairs.reset();
                    }
                }
            }
        }
        // Adapter noise alone keeps Connected. Same-core KS/DNS failures were
        // handled in place above; core/session changes still require rebuild.
        // Third-party HTTPS is not consulted.
        if !route_dirty && !route_tracker.pending()
            && adapter_noise_keeps_session(invalidate, network_changed, core_changed, health_invalid)
        {
            logging!(
                info,
                Type::Service,
                "Tono: Windows reported a network change; core and protection unchanged, keeping Connected"
            );
        }
        if monitor_requires_reconnect(invalidate, core_changed, health_invalid) {
            let reason = if core_changed {
                RecoveryReason::CoreOrTunIdentity
            } else if protection_invalid {
                RecoveryReason::ProtectionFailed
            } else {
                RecoveryReason::ServiceUnreachable
            };
            if !connection_loop_continues(handle_network_change_inner(&state, &app, reason).await) {
                return;
            }
            legs = HealthLegs::default();
        }
    }
}

/// Repair only local protection on the captured runtime; never start/stop a core.
/// Cancellation cannot let a late DNS/WFP write cross an explicit release.
async fn repair_local_protection(
    state: &Arc<TonoState>,
    generation: u64,
    session: tono_service_protocol::OwnerSessionProof,
    expected_pid: Option<u32>,
    expected_core_generation: u32,
    relock: bool,
) -> Result<tono_service_protocol::ProtectionProof, String> {
    if !state.try_begin_recovery() { return Err("recovery already running".into()); }
    let started = std::time::Instant::now();
    let task_state = Arc::clone(state);
    let task = tokio::spawn(async move {
        let state = task_state;
        struct RecoveryGuard(Arc<TonoState>);
        impl Drop for RecoveryGuard {
            fn drop(&mut self) { self.0.end_recovery(); }
        }
        let _recovery = RecoveryGuard(Arc::clone(&state));
        let _mutation = state.begin_connect_mutation().await;
        if state.lock().await.connect_generation != generation { return Err("stale recovery".into()); }
        let before = service::tono_service_status_snapshot().await.map_err(|e| e.to_string())?;
        if expected_pid.is_none() || before.core_pid != expected_pid
            || before.core_generation != expected_core_generation
            || before.active_generation != Some(session.generation)
        { return Err("core identity changed before local repair".into()); }
        if relock {
            super::controller::lock_kill_switch_with_retries(&session).await?;
        } else {
            // DNS-only drift and physical route changes do not reinstall a proven
            // TUN permit. A fresh owner/core/Locked proof is mandatory instead.
            super::direct::prove_service_reload_mode(
                &before, &session, tono_service_protocol::KillSwitchStatusMode::Locked,
            )?;
        }
        if state.lock().await.connect_generation != generation { return Err("stale recovery".into()); }
        let dns = service::tono_enable_protected_dns_for_session(&session).await.map_err(|e| e.to_string())?;
        if protected_dns_unhealthy(Some(&dns)) { return Err("local DNS proof failed".into()); }
        // Complete all proof inside this round, then hand the owned receipt to
        // the caller exactly once. No second fake-ip/status loop is necessary.
        prove_recovered_runtime(&state, generation, &session, expected_pid, expected_core_generation).await
    });
    let result = task.await.map_err(|_| "local repair task failed".to_owned())?;
    state.audit().log(AuditEvent::LocalStep {
        generation, step: "local protection repair", elapsed_ms: started.elapsed().as_millis() as u64,
        outcome: if result.is_ok() { "completed" } else { "failed" },
    });
    result
}

/// The caller has a native DNS proof from this round. Bind fake-ip to the
/// captured core and commit only after Service freshly verifies that same core.
async fn prove_recovered_runtime(state: &Arc<TonoState>, generation: u64,
    session: &tono_service_protocol::OwnerSessionProof, expected_pid: Option<u32>, expected_core_generation: u32,
) -> Result<tono_service_protocol::ProtectionProof, String> {
    let pid = expected_pid.ok_or("missing recovery Core")?;
    if state.lock().await.connect_generation != generation { return Err("stale recovery".into()); }
    super::probes::verify_fake_ip().await?;
    let cancellation = {
        let inner = state.lock().await;
        if inner.connect_generation != generation { return Err("stale recovery".into()); }
        inner.connect_cancellation.clone()
    };
    service::tono_verify_and_commit_protection(session, pid, expected_core_generation, &cancellation)
        .await.map_err(|error| error.to_string())
}

/// Consumes one same-round proof. No timers, cached success, or old routing can
/// restore green. A healthy route handover keeps its existing Connected state.
async fn accept_recovery_proof(state: &Arc<TonoState>, app: &AppHandle, generation: u64,
    session: &tono_service_protocol::OwnerSessionProof, expected_pid: Option<u32>, expected_core_generation: u32,
    proof: tono_service_protocol::ProtectionProof,
) -> bool {
    if !expected_pid.is_some_and(|pid| service::protection_proof_matches(
        &proof, session.generation, pid, expected_core_generation)) { return false; }
    let mut inner = state.lock().await;
    if inner.connect_generation != generation || inner.fsm.status().is_disconnecting
        || !crate::tono::exit_transport::applied_matches(&inner)
        || !super::same_residential_route(inner.routing.as_ref(), inner.applied_routing.as_ref()) { return false; }
    inner.kill_switch = Some(proof.kill_switch);
    if !inner.fsm.status().is_connected {
        inner.fsm.begin_connect();
        if inner.fsm.connect_succeeded().is_err() { return false; }
        commands::emit_status(app, &commands::status_of(&inner));
    }
    true
}

/// Coarse recovery for core/session identity or applied-routing changes. Adapter noise
/// and same-core local protection repair stay in the monitor above, outside this path.
/// Keep WFP armed throughout any rebuild. The outcome controls whether this observer
/// continues; `Deferred` retains it while another single-flight recovery owns mutation.
pub(crate) async fn handle_network_change(
    state: &Arc<TonoState>,
    app: &AppHandle,
    reason: RecoveryReason,
) -> NetworkChangeOutcome {
    handle_network_change_inner(state, app, reason).await
}

pub(super) async fn handle_network_change_inner(
    state: &Arc<TonoState>,
    app: &AppHandle,
    reason: RecoveryReason,
) -> NetworkChangeOutcome {
    if !state.try_begin_recovery() {
        logging!(
            info,
            Type::Service,
            "Tono: 恢复任务已在进行，合并本次事件 ({})",
            reason.audit_reason()
        );
        return NetworkChangeOutcome::Deferred;
    }
    struct RecoveryGuard<'a>(&'a TonoState);
    impl Drop for RecoveryGuard<'_> {
        fn drop(&mut self) {
            self.0.end_recovery();
        }
    }
    let _recovery_guard = RecoveryGuard(state.as_ref());

    logging!(warn, Type::Service, "{}", reason.log_line());
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
        let inner = state.lock().await;
        // `is_disconnecting` is redundant now that `begin_disconnect` clears
        // `is_connected`, and it is written out anyway: this guard is the one
        // that has to say "not while a release is in flight" out loud, because
        // the generation captured below is the disconnect's own once one has
        // started, and the exit guard then compares a value to itself.
        let status = inner.fsm.status();
        if (!status.is_connected && !status.is_protection_blocked)
            || status.is_connecting || status.is_disconnecting
        {
            return NetworkChangeOutcome::Handled;
        }
        inner.connect_generation
    };
    {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation || inner.fsm.status().is_disconnecting {
            return NetworkChangeOutcome::Handled;
        }
        inner.fsm.tunnel_died();
        commands::emit_status(&app, &commands::status_of(&inner));
    }
    state.audit().log(AuditEvent::ProtectedOffline {
        reason: reason.audit_reason(),
    });
    let mutation = state.begin_connect_mutation().await;
    {
        let inner = state.lock().await;
        if inner.connect_generation != generation || inner.fsm.status().is_disconnecting {
            return NetworkChangeOutcome::Handled;
        }
    }
    let _ = service::tono_restrict_bootstrap().await;
    {
        let inner = state.lock().await;
        if inner.connect_generation != generation || inner.fsm.status().is_disconnecting {
            return NetworkChangeOutcome::Handled;
        }
    }
    // Stop the core before re-attempting, like both sibling teardowns (`switch_selected_node`,
    // `selected_node_vanished`). `restrict_bootstrap` only rewrites WFP; it leaves mihomo
    // running, and mihomo owns loopback:53 for the whole session — the very port `run_stages`'
    // DNS preflight binds. Without this, every sleep/wake and Wi-Fi flap burned attempt #1 on a
    // guaranteed "DNS UDP 127.0.0.1:53 is unavailable", recorded a ConnectFail, bumped the retry
    // counter and showed a DNS error, and only then stopped the core on the way out.
    // `false` = keep blocking: the core goes down, the barrier stays armed.
    let _ = service::tono_stop_core(false).await;
    drop(mutation);
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
                "Tono: 恢复已被更新的连接代际取代，交由其所有者处理 ({})",
                reason.audit_reason()
            );
            return NetworkChangeOutcome::Handled;
        }
    }
    match attempt(state, app).await {
        Attempt::Failed { error, generation } => {
            if fail_connect(state, app, error, generation).await.is_some() {
                schedule_reconnect(state, app).await;
            }
        }
        // A transient guard (a release still reconciling, a transition still finishing) is not a
        // verdict — without a reschedule the machine sits blocked with nothing left to retry.
        Attempt::GuardRejected(rejection) if guard_rejection_is_transient(&rejection) => {
            logging!(info, Type::Service, "Tono: 重连被暂态守卫拒绝，稍后重试: {rejection}");
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

/// F1: connection uses the compiled and already learned public IPv4 pins.
/// Node endpoints are admitted literals; no API DNS refresh is required to arm
/// WFP/start the tunnel. The existing post-Connected pin task refreshes via TUN.
pub(super) async fn bootstrap_hosts() -> Vec<String> {
    bootstrap::merge_bootstrap_hosts(&[])
}

#[cfg(test)]
mod tests {
    use super::asn_org_from_ipapi;

    #[tokio::test]
    async fn bootstrap_pin_preparation_needs_no_external_resolver() {
        let pins = super::bootstrap_hosts().await;
        for ip in crate::tono::bootstrap::pinned_bootstrap_ips() {
            assert!(pins.contains(&ip.to_string()));
        }
        assert!(pins.iter().all(|ip| ip.parse::<std::net::Ipv4Addr>().is_ok_and(tono_core::node::is_public_ipv4)));
        let source = include_str!("monitor.rs");
        let function = source.split("pub(super) async fn bootstrap_hosts()").nth(1).unwrap().split("#[cfg(test)]").next().unwrap();
        assert!(!function.contains("lookup_host"));
    }

    #[test]
    fn isp_org_comes_from_ipapi_without_storing_an_address() {
        let json = serde_json::json!({
            "ip": "183.212.182.34",
            "asn": { "org": "AS56046 China Mobile" },
        });
        assert_eq!(
            asn_org_from_ipapi(&json).as_deref(),
            Some("AS56046 China Mobile")
        );
    }
}

#[cfg(test)]
mod recovery_receipt_tests {
    #[test]
    fn repair_proof_has_one_fake_ip_gate_and_is_consumed_in_the_same_round() {
        let source = include_str!("monitor.rs");
        let repair = source.split("async fn repair_local_protection(").nth(1).unwrap()
            .split("/// Coarse recovery").next().unwrap();
        assert_eq!(repair.matches("verify_fake_ip().await").count(), 1);
        assert!(repair.contains("tono_verify_and_commit_protection"));
        assert!(!repair.contains("tono_kill_switch_status()"));
        let route = source.split("if route_dirty && !core_changed").nth(1).unwrap()
            .split("// Adapter noise alone keeps Connected.").next().unwrap();
        assert!(!route.contains("verify_fake_ip().await"));
        assert!(route.contains("accept_recovery_proof"));
        assert!(route.contains("service_unconfirmed = false"));
    }
}
