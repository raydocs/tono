//! Connected-lifetime monitor, pin refresh, and network-change handling.

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tono_logging::{Type, logging};
use tono_plugin_core::{MihomoExt as _, models::Protocol};

use crate::core::service;
use crate::process::AsyncHandler;

tokio::task_local! {
    /// Policy rebuilds keep the existing protected reconnect. Health failures do not.
    static POLICY_REBUILD: ();
}
use crate::tono::{
    audit::{self, AuditEvent},
    bootstrap, commands, signed_apps,
    connection_health::{
        CoreSample, HealthLegs, NetworkChangeOutcome, NetworkEventProbeEffect, NetworkEventProbePlan,
        apply_network_event_probe,         classify_core_sample, commit_core_baseline, connection_loop_continues, core_change_fires,
        core_identity_change_owned,
        health_threshold_reached, kill_switch_unhealthy_for_monitor, may_recover_in_place,
        monitor_requires_reconnect, network_event_fires, next_network_events_counter,
        owned_direct_reload_in_flight,
        plan_network_event_probe, protected_dns_unhealthy,
    },
    connection_plan::{guard_rejection_is_transient, reconnect_allowed},
    state::{TonoInner, TonoState},
};
use tono_core::connection::ConnectionStatus;
use super::{
    Attempt, BoxedTask, MAX_DIRECT_SAMPLES, MAX_PROTECTED_ROUTE_SAMPLES, ProtectedRouteAggregate,
    fail_connect, kill_switch_mode_key, new_direct_samples, observe_protected_routes,
    seed_autostart_after_connect,
};
use super::direct::dns_query_a;
use super::reconnect::schedule_reconnect_for_generation;
use super::controller::{CONTROLLER_HTTP_TIMEOUT, controller_client, controller_url, fetch_connections};
use super::probes::{verify_locked, verify_tun_data_plane};
use super::platform::usable_physical_uplinks;

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

fn sample_commit_is_current(expected: (u64, u64), current: (u64, u64), connected: bool) -> bool {
    connected && expected == current
}

/// Which kill-switch reading the health monitor may publish after it has awaited DNS and the
/// data-plane probe. The captured aggregate is already stale if a lifecycle operation started
/// or finished in that gap (`snapshot_generation` moves), or if this connect generation ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CapturedKillSwitchPublish {
    /// The Service aggregate did not move. The captured reading is still current.
    Captured,
    /// A newer aggregate exists. Publish that one.
    Fresh,
    /// The session ended, or the second read failed. Leave the app's last reading in place.
    Skip,
}

fn captured_kill_switch_publish(
    captured_snapshot_generation: u64,
    fresh_snapshot_generation: Option<u64>,
    captured_connect_generation: u64,
    connect_generation_now: u64,
    still_connected: bool,
) -> CapturedKillSwitchPublish {
    if !still_connected || connect_generation_now != captured_connect_generation {
        return CapturedKillSwitchPublish::Skip;
    }
    match fresh_snapshot_generation {
        Some(fresh) if fresh == captured_snapshot_generation => CapturedKillSwitchPublish::Captured,
        Some(_) => CapturedKillSwitchPublish::Fresh,
        None => CapturedKillSwitchPublish::Skip,
    }
}

#[cfg(test)]
mod sample_commit_tests {
    #[test]
    fn a_replaced_controller_cannot_commit_a_late_sample_in_the_same_connection() {
        let started = (7, 12);
        assert!(super::sample_commit_is_current(started, started, true));
        // In-place controller replacement need not change the connect generation.
        assert!(!super::sample_commit_is_current(started, (7, 13), true));
    }

    #[test]
    fn a_stale_kill_switch_aggregate_is_not_published_after_the_service_moves() {
        use super::CapturedKillSwitchPublish;
        assert_eq!(
            super::captured_kill_switch_publish(4, Some(4), 7, 7, true),
            CapturedKillSwitchPublish::Captured
        );
        assert_eq!(
            super::captured_kill_switch_publish(4, Some(5), 7, 7, true),
            CapturedKillSwitchPublish::Fresh,
            "a DIRECT reload that finishes during the probe must win over the earlier Locked reading"
        );
        assert_eq!(
            super::captured_kill_switch_publish(4, None, 7, 7, true),
            CapturedKillSwitchPublish::Skip
        );
        assert_eq!(
            super::captured_kill_switch_publish(4, Some(4), 7, 8, true),
            CapturedKillSwitchPublish::Skip
        );
        assert_eq!(
            super::captured_kill_switch_publish(4, Some(5), 7, 7, false),
            CapturedKillSwitchPublish::Skip
        );
    }
}

#[cfg(test)]
mod monitor_registration_tests {
    use crate::tono::state::TaskRegistry;

    /// A monitor-driven reconnect runs inline in the old monitor's own task, so the
    /// connect tail that replaces the monitor registration executes inside the very
    /// task the slot still holds. The replacement must not abort that handle: tokio
    /// only marks a running task cancelled and destroys it at its next Pending await —
    /// in production the `state.lock().await` of `spawn_control_plane_pin_refresh` —
    /// silently dropping the session's optional DIRECT overlay after the FSM already
    /// committed Connected. Under the previous unconditional `abort_network_monitor()`
    /// the fixture task dies at the `yield_now().await` below, the send never runs,
    /// and this assertion fails.
    #[tokio::test]
    async fn a_monitor_replacing_its_own_registration_finishes_the_connect_tail() {
        let (self_handle_tx, self_handle_rx) = tokio::sync::oneshot::channel();
        let (tail_tx, tail_rx) = tokio::sync::oneshot::channel::<()>();
        let monitored = tokio::spawn(async move {
            let mut tasks = TaskRegistry::default();
            // The slot exactly as the recovered session left it: this very task.
            tasks.network_monitor = Some(self_handle_rx.await.expect("fixture handle must arrive"));
            // What `spawn_network_monitor` performs once the fresh monitor is spawned.
            let replacement = tauri::async_runtime::JoinHandle::Tokio(tokio::spawn(async {}));
            tasks.register_network_monitor(replacement);
            // First Pending point after the self-replacement, standing in for the
            // awaited state lock in the connect tail.
            tokio::task::yield_now().await;
            tail_tx
                .send(())
                .expect("the connect tail must survive replacing its own monitor registration");
        });
        self_handle_tx
            .send(tauri::async_runtime::JoinHandle::Tokio(monitored))
            .expect("fixture task must still be awaiting its handle");
        assert!(
            tail_rx.await.is_ok(),
            "a monitor replacing its own registration must not abort itself at the next await"
        );
    }
}

/// Read the controller once, ingest the route ledger, record DIRECT diagnostics, and update
/// protected-route evidence.
///
/// Returns `false` only when the generation is superseded or the session is no longer
/// connected. Caps still bound the DirectDial / protected-route evidence branches, but the
/// ledger keeps sampling for the rest of the session — otherwise bytesByRoute would freeze
/// once 512 DIRECT destinations had been seen.
pub(super) async fn sample_connections_once(
    state: &Arc<TonoState>,
    generation: u64,
    residential_target: Option<&str>,
    direct_seen: &mut std::collections::HashSet<(String, u16, bool, String)>,
    protected_seen: &mut std::collections::HashSet<u64>,
    protected_aggregate: &mut ProtectedRouteAggregate,
) -> bool {
    let (secret, port, controller_generation) = {
        let inner = state.lock().await;
        // `connect_generation`, matching the sibling arms of this task. The first version
        // compared `controller_generation` — a different counter, bumped per controller setup —
        // which never equalled the connect generation this task was spawned with, so the very
        // first tick disabled sampling and nothing was ever recorded.
        if inner.connect_generation != generation || !inner.fsm.status().is_connected {
            return false;
        }
        match inner.controller_secret.clone().zip(inner.controller_port) {
            Some((secret, port)) => (secret, port, inner.controller_generation),
            None => return true,
        }
    };
    let Some(payload) = fetch_connections(&secret, port).await else {
        return true;
    };
    // Fetching can outlive a disconnect, account switch, or controller rebuild.
    // Hold the product guard through the synchronous commit (never through HTTP)
    // so that neither the ledger nor diagnostic events enter a newer session.
    let inner = state.lock().await;
    if !sample_commit_is_current(
        (generation, controller_generation),
        (inner.connect_generation, inner.controller_generation),
        inner.fsm.status().is_connected,
    ) {
        // A same-session controller rebuild discards this response, not future
        // sampling: the next tick must capture the replacement controller.
        return inner.connect_generation == generation && inner.fsm.status().is_connected;
    }
    state.route_ledger().lock().ingest(&payload);

    let direct_active = direct_seen.len() < MAX_DIRECT_SAMPLES;
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

    drop(inner);
    true
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
                _ = wechat_interval.tick() => {
                    if skip_first_wechat {
                        skip_first_wechat = false;
                        continue;
                    }
                    if signed_wechat_paths_require_reconnect(&task_state, generation).await {
                        // Only a real protected reconnect re-applies the signed path set, so
                        // in-place recovery is not allowed here: a healthy TUN would otherwise
                        // keep the old paths for the whole session. Without in-place recovery
                        // the outcome is always Handled, and the new generation's task takes
                        // over watching.
                        if !connection_loop_continues(
                            handle_network_change_inner(&task_state, &task_app, false).await,
                        ) {
                            return;
                        }
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
    let client = {
        let inner = state.lock().await;
        if inner.connect_generation != generation {
            return false;
        }
        Arc::clone(&inner.client)
    };
    if let Err(error) = client.transport().refresh_control_plane_pins().await {
        logging!(
            warn,
            Type::Service,
            "Tono: failed to refresh control-plane HTTP pins: {error:#}"
        );
    }
    // Refresh only publishes DNS pins on the captured transport. A newer connection owns
    // lifecycle state, so a retired monitor must not keep its periodic loop alive.
    let inner = state.lock().await;
    inner.connect_generation == generation && inner.fsm.status().is_connected
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
        let measured_node = {
            let inner = state.lock().await;
            if inner.connect_generation != generation || !inner.fsm.status().is_connected {
                return;
            }
            let Some(node) = inner.selected_node.clone() else {
                return;
            };
            node
        };
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
        if !inner.commit_exit_identity(
            &measured_node,
            ip.to_string(),
            (!org.is_empty()).then(|| org.to_string()),
            location,
        ) {
            return;
        }
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
    // Slot replacement, not a blind abort: this call also runs from the connect
    // tail of a monitor-driven reconnect, i.e. from inside the very task the slot
    // still holds. See `TaskRegistry::register_network_monitor`.
    inner.tasks.register_network_monitor(handle);
}

/// R2-F2: Service-truth poll cadence while the FSM idles in Protected Offline. The
/// connected-lifetime monitor above is the opposite regime (it runs only while
/// `is_connected`), and the reconnect ladder needs `session_verified` — so an armed but
/// unverified barrier sat unwatched, and a Service restart that retired it
/// (`retire_unverified_on_service_start`) left the UI claiming "blocked" over an open
/// machine for as long as the app lived. One bounded local IPC read per interval, alive
/// only while the state holds.
pub(super) const PROTECTION_RESYNC_INTERVAL: Duration = Duration::from_secs(30);

/// The state the Service-truth poll watches: Protected Offline with no transaction in flight
/// (armed-unverified in the defect's original shape; verified sessions cost nothing extra and
/// their Service truth deserves the same answer). Exactly the state whose "this machine is
/// blocked" claim can outlive the barrier itself.
pub(super) fn protection_resync_watches(status: &tono_core::connection::ConnectionStatus) -> bool {
    status.is_protection_blocked
        && !status.is_connected
        && !status.is_connecting
        && !status.is_disconnecting
}

/// Construct the Service-truth poll task. Split from [`ensure_protection_resync_locked`] so
/// regressions can register a fixture task without a Tauri `AppHandle`.
pub(crate) fn spawn_protection_resync(
    state: &Arc<TonoState>,
    app: &AppHandle,
) -> tauri::async_runtime::JoinHandle<()> {
    let task_state = Arc::clone(state);
    let task_app = app.clone();
    AsyncHandler::spawn(move || Box::pin(protection_resync_loop(task_state, task_app)) as BoxedTask)
}

/// Register the Service-truth poll when the FSM idles in Protected Offline, retire it when it
/// does not. Idempotent: a live poll is left alone and a finished handle is replaced. The
/// registry abort plus the loop's own exit check (defense in depth) keep this from ever
/// becoming a resident task.
pub(crate) fn ensure_protection_resync_locked(
    inner: &mut TonoInner,
    spawn: impl FnOnce() -> tauri::async_runtime::JoinHandle<()>,
) {
    if !protection_resync_watches(inner.fsm.status()) {
        inner.tasks.abort_protection_resync();
        return;
    }
    if inner
        .tasks
        .protection_resync
        .as_ref()
        .is_some_and(|handle| !handle.inner().is_finished())
    {
        return;
    }
    inner.tasks.abort_protection_resync();
    inner.tasks.protection_resync = Some(spawn());
}

/// Lock-free-caller wrapper for tails that do not hold the product guard (startup restore).
pub(crate) async fn ensure_protection_resync(state: &Arc<TonoState>, app: &AppHandle) {
    let mut inner = state.lock().await;
    ensure_protection_resync_locked(&mut inner, || spawn_protection_resync(state, app));
}

/// The bounded Service-truth poll for idle Protected Offline (R2-F2). Every tick reads the
/// Service's own kill-switch verdict and folds it through the same
/// `apply_service_kill_switch` the cancelled-quit resync uses. Convergence is strictly
/// Service-proven — `wanted=false` is the only reading that releases the UI, and an
/// unanswered Service changes nothing — so this can never loosen protection; it only stops
/// the UI from claiming a barrier the Service already retired. Exits when the state is left;
/// a generation move during an in-flight read defers to the next tick instead of folding
/// stale evidence.
async fn protection_resync_loop(state: Arc<TonoState>, app: AppHandle) {
    let mut interval = tokio::time::interval(PROTECTION_RESYNC_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Consume the immediate first tick: the entry path just took its own Service reading (a
    // refused release, a startup protection probe), so the first poll belongs one interval out.
    interval.tick().await;
    loop {
        interval.tick().await;
        let generation = {
            let inner = state.lock().await;
            if !protection_resync_watches(inner.fsm.status()) {
                // Left idle Protected Offline (Connected, a new attempt, a release): its owner
                // retires this task; nothing here may outlive the state that justified it.
                return;
            }
            inner.connect_generation
        };
        let kill_switch = service::tono_service_status_snapshot()
            .await
            .ok()
            .and_then(|snapshot| snapshot.kill_switch);
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            // A transition was admitted while the IPC was in flight. Folding a pre-transition
            // reading could release the UI over a barrier that was re-armed in between; the
            // next tick re-reads under the new generation instead.
            continue;
        }
        if !protection_resync_watches(inner.fsm.status()) {
            return;
        }
        let previous_kill_switch = inner.kill_switch.clone();
        let previous_status = inner.fsm.status().clone();
        let service_disarmed = matches!(&kill_switch, Some(status) if !status.wanted);
        let reconnect_after_release = kill_switch
            .as_ref()
            .is_some_and(|status| status.reconnect_after_release);
        let disconnecting = inner.fsm.status().is_disconnecting;
        commands::quit::apply_service_kill_switch(&mut inner, kill_switch);
        if service_disarmed {
            logging!(
                info,
                Type::Service,
                "Tono: Service 已证明 WFP 解除（服务重启退休了未验证屏障，或释放已完成），Protected Offline 收敛为未连接"
            );
        }
        if inner.kill_switch != previous_kill_switch || inner.fsm.status() != &previous_status {
            commands::emit_status(&app, &commands::status_of(&inner));
        }
        let reconnect = service_disarmed
            && super::reconnect::crash_recovery_reconnect_allowed(
                reconnect_after_release,
                matches!(inner.account_state, crate::tono::state::AccountState::Ready),
                inner.selected_node.is_some(),
                inner.catalog_requires_choice,
                disconnecting,
            );
        if service_disarmed {
            drop(inner);
            if reconnect {
                let state = state.clone();
                let app = app.clone();
                AsyncHandler::spawn(move || async move {
                    if let Err(error) =
                        super::connect_for_generation(state, app, Some(generation)).await
                    {
                        logging!(
                            warn,
                            Type::Service,
                            "Tono: 崩溃恢复放行后的后台重连未完成: {error}"
                        );
                    }
                });
            }
            return;
        }
    }
}

#[cfg(test)]
mod protection_resync_tests {
    use super::*;
    use tono_core::connection::UiState;
    use tono_service_protocol::{KillSwitchStatus, KillSwitchStatusMode};

    /// R2-F2 regression, both halves of the fix:
    /// (a) the trigger — entering armed-unverified idle Protected Offline must leave a
    ///     registered Service-truth poll handle in the task registry (the defect: the slot did
    ///     not exist and nothing ever re-read the Service while the app lived);
    /// (b) the fold — a Service reading of `wanted=false` is the only reading that converges
    ///     this FSM to Not Connected with the armed latch cleared (the quit path's semantics,
    ///     now shared by the poll).
    #[tokio::test]
    async fn protected_offline_converges_when_the_service_proves_the_barrier_gone() {
        let state = Arc::new(TonoState::for_test());
        {
            let mut inner = state.lock().await;
            // First connect armed the barrier, the session never verified, and the initial
            // full release was refused: the exact fixture of the defect.
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.initial_release_failed();
            assert_eq!(inner.fsm.status().ui_state(), UiState::ProtectedOffline);
            assert!(!inner.fsm.session_verified());
            ensure_protection_resync_locked(&mut inner, || {
                tauri::async_runtime::spawn(std::future::pending::<()>())
            });
        }
        {
            let inner = state.lock().await;
            assert!(
                inner.tasks.protection_resync.is_some(),
                "idle Protected Offline must hold a registered Service-truth poll handle"
            );
        }
        state.lock().await.tasks.abort_protection_resync();

        // The Service restarted and retired the unverified barrier: its own reading says the
        // barrier is not wanted, and only that reading may release the UI.
        let service_disarmed = KillSwitchStatus {
            wanted: false,
            verified: false,
            live: false,
            mode: KillSwitchStatusMode::Blocked,
            tunnel_permit_rendered: false,
            endpoints: Vec::new(),
            direct_endpoint_digest: String::new(),
            last_error: None,
            reconnect_after_release: false,
        };
        let mut inner = state.lock().await;
        crate::tono::commands::quit::apply_service_kill_switch(&mut inner, Some(service_disarmed));
        assert!(
            !inner.fsm.kill_switch_armed(),
            "the Service proved the barrier gone; the armed latch must clear"
        );
        assert_eq!(inner.fsm.status().ui_state(), UiState::NotConnected);
    }
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
    // Failed network-event proofs that have not yet been confirmed. One failure
    // keeps the core up; the next tick probes again even if Windows is quiet.
    let mut pending_event_probe_failures: u32 = 0;
    // The last recovered-in-place verdict, so a leg that stays failed while the tunnel keeps
    // working re-proves the data plane at the exit-probe cadence rather than every two ticks.
    let mut last_in_place_recovery: Option<std::time::Instant> = None;
    loop {
        interval.tick().await;
        let (owned_direct_reload, captured_connect_generation, captured_reload_marker) = {
            let inner = state.lock().await;
            if !inner.fsm.status().is_connected {
                return;
            }
            (
                owned_direct_reload_in_flight(
                    inner.direct_reload_until,
                    inner.connect_generation,
                    std::time::Instant::now(),
                ),
                inner.connect_generation,
                inner.direct_reload_until,
            )
        };
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
        legs.observe_kill_switch(kill_switch_unhealthy_for_monitor(
            snapshot.kill_switch.as_ref(),
            owned_direct_reload,
        ));

        // DNS health is checked independently of netmon. The first network event is used only
        // to seed the counter (to ignore our own connect-time interface churn), so an adapter
        // arriving in that narrow window would otherwise remain external-DNS until another event.
        let protected_dns = service::tono_protected_dns_status().await.ok();
        legs.observe_protected_dns(protected_dns_unhealthy(protected_dns.as_ref()));

        // F2 leg 2: periodic real App data-plane probe through the tunnel.
        if last_probe.elapsed() >= EXIT_PROBE_INTERVAL {
            last_probe = std::time::Instant::now();
            if owned_direct_reload {
                // TUN permit is retracted for this session's own reload; a failed probe is not
                // evidence the tunnel died.
                legs.observe_probe(false);
            } else {
                legs.observe_probe(periodic_data_plane_probe_failed(&state).await);
            }
        }
        let health_invalid = legs.invalid();
        let protection_invalid = legs.protection_invalid();

        // The health legs above already consumed the snapshot from the start of this tick.
        // Publishing that same aggregate after the DNS read and the data-plane probe would
        // overwrite a kill switch the Service has since replaced (a DIRECT reload moves to
        // Blocked while this task is still in the probe). Read the generation again and
        // publish only a reading that is still current.
        let fresh_kill_switch = match service::tono_service_status_snapshot().await {
            Ok(fresh) => Some((fresh.snapshot_generation, fresh.kill_switch)),
            Err(_) => None,
        };

        let (invalidate, network_changed, core_changed, service_events) = {
            let mut inner = state.lock().await;

            let publish = captured_kill_switch_publish(
                snapshot.snapshot_generation,
                fresh_kill_switch.as_ref().map(|(generation, _)| *generation),
                captured_connect_generation,
                inner.connect_generation,
                inner.fsm.status().is_connected,
            );
            let published = match publish {
                CapturedKillSwitchPublish::Captured => snapshot.kill_switch.clone(),
                CapturedKillSwitchPublish::Fresh => {
                    fresh_kill_switch.as_ref().and_then(|(_, status)| status.clone())
                }
                CapturedKillSwitchPublish::Skip => None,
            };
            // L3: surface kill switch changes as they are observed. A skipped publish leaves
            // the previous reading; it does not clear a barrier the Service still holds.
            let kill_switch_changed = published.is_some() && inner.kill_switch != published;
            if let Some(kill_switch) = published {
                inner.kill_switch = Some(kill_switch);
            }

            // The first sample seeds every leg without firing (unchanged
            // first-seed semantics); afterwards the legs compare whole
            // Options so a seeded-None → Some transition is caught too (L-1).
            let first_sample = inner.network_events_counter.is_none();
            let counter = snapshot.network_events.counter;
            let network_changed = !first_sample && inner.network_events_counter != Some(counter);

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
            // #1228: a sing-box DIRECT replacement changes the Core pid on purpose. While this
            // session owns that reload, or it started or ended during this tick, defer the change
            // and keep the old baseline: the reload adopts the proved new pid before it clears,
            // and anything else still fires on the first tick after.
            let core_change_owned = core_identity_change_owned(
                owned_direct_reload,
                captured_reload_marker,
                inner.direct_reload_until,
                inner.connect_generation,
                std::time::Instant::now(),
            );
            let core_changed = !first_sample && !core_change_owned && core_change_fires(sample, missing_core_samples);

            // P0-13: the first change inside the window invalidates Connected.
            // A later change in that window stays pending. Consuming the
            // counter or the core baseline here would make the next tick look
            // quiet, so the event would be lost instead of retried.
            let invalidated = network_event_fires(
                network_changed || core_changed,
                inner.last_network_event_at.map(|at| at.elapsed()),
            );
            inner.network_events_counter = next_network_events_counter(
                inner.network_events_counter,
                counter,
                first_sample,
                invalidated,
            );
            if (sample != CoreSample::Missing || core_changed)
                && (first_sample || !core_change_owned)
                && commit_core_baseline(first_sample, core_changed, invalidated)
            {
                inner.last_core_pid = snapshot.core_pid;
                inner.last_restart_count = Some(snapshot.restart_count);
            }
            if invalidated {
                inner.last_network_event_at = Some(std::time::Instant::now());
            }

            // Under the lock, like every status publisher (H16-C-F3).
            if kill_switch_changed {
                commands::emit_status(&app, &commands::status_of(&inner));
            }
            let mut events: Vec<AuditEvent> = Vec::new();
            if kill_switch_changed && let Some(kill_switch) = inner.kill_switch.as_ref() {
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
            (invalidated, network_changed, core_changed, events)
        };
        for event in service_events {
            state.audit().log(event);
        }

        // IP Helper delivers Tono's own WinTUN/route and DNS-reconciliation callbacks
        // asynchronously. A callback can therefore land after the Service write window and
        // after this monitor seeded its counter, producing the old connectOk -> networkChange ->
        // reconnect loop. Do not trust the event either way: under the still-locked barrier,
        // repeat the same multi-origin HTTPS proof that admitted Connected. One failure is a
        // blip — the core stays up and the next tick confirms. A second failure rebuilds.
        // Core identity and health failures remain unconditional.
        let recent_proof = last_event_probe_ok
            .is_some_and(|at| at.elapsed() < NETWORK_EVENT_PROBE_COOLDOWN);
        let plan = plan_network_event_probe(
            invalidate,
            network_changed,
            core_changed,
            health_invalid,
            owned_direct_reload,
            pending_event_probe_failures,
            recent_proof,
        );
        let probed = match plan {
            NetworkEventProbePlan::Probe => Some(periodic_data_plane_probe_failed(&state).await),
            NetworkEventProbePlan::ReuseRecentProof => {
                logging!(
                    info,
                    Type::Service,
                    "Tono: another Windows network change inside the proof window; reusing the last data-plane proof instead of probing again"
                );
                None
            }
            NetworkEventProbePlan::Idle => None,
        };
        // A reload can start while the HTTPS request is awaiting its result. Re-read its
        // bounded owner marker before treating that expected blocked probe as a dead tunnel.
        let owned_direct_reload = {
            let inner = state.lock().await;
            owned_direct_reload_in_flight(inner.direct_reload_until, inner.connect_generation, std::time::Instant::now())
        };
        let discard_expected_block = owned_direct_reload && probed == Some(true);
        let (effect, next_pending) = if discard_expected_block {
            (NetworkEventProbeEffect::Unchanged, pending_event_probe_failures)
        } else {
            if matches!(plan, NetworkEventProbePlan::Probe) {
                last_event_probe_ok = match probed {
                    Some(true) => None,
                    Some(false) => Some(std::time::Instant::now()),
                    None => last_event_probe_ok,
                };
            }
            apply_network_event_probe(plan, probed.unwrap_or(false), pending_event_probe_failures)
        };
        pending_event_probe_failures = next_pending;
        if effect == NetworkEventProbeEffect::Hold {
            logging!(
                info,
                Type::Service,
                "Tono: network-change probe failed once; keeping the tunnel until the next tick confirms it"
            );
        }
        if effect == NetworkEventProbeEffect::Rebuild {
            if !connection_loop_continues(handle_network_change_inner(&state, &app, true).await) {
                return;
            }
            last_in_place_recovery = Some(std::time::Instant::now());
            legs = HealthLegs::default();
            pending_event_probe_failures = 0;
            continue;
        }
        // X2-1: a proven tunnel still has to drop a DIRECT overlay whose adapter
        // no longer carries a default route. A held blip has not proven the tunnel.
        if effect == NetworkEventProbeEffect::Proven && !may_keep_session_in_place(&state, true).await {
            if !connection_loop_continues(handle_network_change_inner(&state, &app, false).await) {
                return;
            }
            last_in_place_recovery = Some(std::time::Instant::now());
            legs = HealthLegs::default();
            pending_event_probe_failures = 0;
            continue;
        }
        if effect == NetworkEventProbeEffect::Proven {
            logging!(
                info,
                Type::Service,
                "Tono: Windows reported a network change, but the locked TUN data plane remains healthy; keeping Connected"
            );
            legs.observe_probe(false);
            let generation = state.lock().await.connect_generation;
            let _ = refresh_control_plane_pins_once(&state, generation).await;
        }
        // Probe failure is decided above. Passing false here keeps a single blip from
        // taking the old immediate-rebuild path. Core identity and protection legs still fire.
        if monitor_requires_reconnect(invalidate, core_changed, health_invalid, false, owned_direct_reload) {
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
            pending_event_probe_failures = 0;
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

/// A signed traffic-policy document changed behavior. Sleep/Wi-Fi in-place recovery does not
/// apply: old DIRECT grants and their lease heartbeat would otherwise survive a TUN probe.
pub(crate) async fn handle_policy_behavior_change(
    state: &Arc<TonoState>,
    app: &AppHandle,
    auth_generation: u64,
) -> NetworkChangeOutcome {
    // F5: while the FSM is Connecting there is no live session to tear down — the
    // entry guard inside `handle_network_change_inner` would silently drop the
    // change, leaving the committing session on the policy snapshot captured
    // before the first Core start. Record the deferral instead; the connect
    // commit consumes it and re-runs the optional-DIRECT decision with the
    // latest installed policy.
    {
        let mut inner = state.lock().await;
        // The caller's account check ran under an earlier lock; a sign-out or
        // account switch since then must not act on (or defer into) the new
        // account's attempt.
        if inner.sign_in_generation != auth_generation {
            return NetworkChangeOutcome::Handled;
        }
        match apply_policy_change_disposition(&mut inner) {
            PolicyChangeDisposition::ReconnectNow => {}
            PolicyChangeDisposition::DeferUntilConnected => {
                logging!(
                    info,
                    Type::Service,
                    "Tono: deferring policy behavior change that arrived during connect"
                );
                return NetworkChangeOutcome::Handled;
            }
            PolicyChangeDisposition::Ignore => return NetworkChangeOutcome::Handled,
        }
    }
    POLICY_REBUILD
        .scope(
            (),
            handle_network_change_inner(state, app, policy_behavior_change_allows_in_place_recovery()),
        )
        .await
}

/// What a traffic-policy behavior change should do when it arrives, given the
/// connect FSM's current state (F5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PolicyChangeDisposition {
    /// Connected: schedule the protected teardown + reconnect now.
    ReconnectNow,
    /// Connecting: record the deferral; the connect commit consumes it.
    DeferUntilConnected,
    /// Idle, or a release is in flight: the next connect captures the new
    /// policy on its own, and a teardown during Disconnect is never ours to run.
    Ignore,
}

/// The pure verdict for a policy behavior change against one FSM snapshot.
pub(super) fn policy_change_disposition(status: &ConnectionStatus) -> PolicyChangeDisposition {
    if status.is_disconnecting {
        PolicyChangeDisposition::Ignore
    } else if status.is_connecting {
        PolicyChangeDisposition::DeferUntilConnected
    } else if status.is_connected {
        PolicyChangeDisposition::ReconnectNow
    } else {
        PolicyChangeDisposition::Ignore
    }
}

/// Decide a policy behavior change under the state lock and record the
/// deferral when it lands while Connecting. `Connecting` wins over a leftover
/// `Connected` flag: a forming attempt is already carrying its own snapshot,
/// and tearing the tunnel down from underneath it is never this path's call.
pub(super) fn apply_policy_change_disposition(inner: &mut TonoInner) -> PolicyChangeDisposition {
    match policy_change_disposition(inner.fsm.status()) {
        PolicyChangeDisposition::DeferUntilConnected => {
            inner.record_pending_policy_change();
            PolicyChangeDisposition::DeferUntilConnected
        }
        other => other,
    }
}

/// F5 fallback: a deferred policy change whose refreshed document needs a
/// pre-TUN physical egress snapshot that the committing attempt never captured
/// (the policy went from no DIRECT content to some) cannot be applied in
/// place — the interface must be discovered before the first Core start.
/// Schedule the same protected teardown + reconnect a connected-session change
/// gets; the fresh transaction rediscovers the interface and installs the new
/// policy. Spawned detached for the same reasons as the account-scoped policy
/// sync caller. Carries the committing attempt's `generation` and drops out at
/// entry once that session is no longer the Connected one, so a Disconnect
/// followed by a new Connect is never torn down by this task.
pub(super) fn spawn_deferred_policy_reconnect(state: &Arc<TonoState>, app: &AppHandle, generation: u64) {
    let state = Arc::clone(state);
    let app = app.clone();
    AsyncHandler::spawn(move || async move {
        let auth_generation = {
            let inner = state.lock().await;
            if inner.connect_generation != generation || !inner.fsm.status().is_connected {
                return;
            }
            inner.sign_in_generation
        };
        handle_policy_behavior_change(&state, &app, auth_generation).await;
    });
}

pub(crate) const fn policy_behavior_change_allows_in_place_recovery() -> bool {
    false
}

/// Automatic health recovery releases general traffic with the secondary AI hold.
/// Strict protection and policy rebuilds keep their existing protected recovery path.
async fn release_after_health_failure<F>(
    strict: bool,
    policy_rebuild: bool,
    release: impl FnOnce(bool) -> F,
) -> Option<Result<(), String>>
where
    F: std::future::Future<Output = Result<(), String>>,
{
    if !tono_core::unarmed_probe::health_monitor_releases(strict, policy_rebuild) {
        return None;
    }
    Some(release(true).await)
}

/// X2-1: apply [`may_recover_in_place`] to the live session. The uplinks are read only when a
/// DIRECT overlay is committed, so a full-tunnel session pays nothing for it.
async fn may_keep_session_in_place(state: &Arc<TonoState>, tunnel_proven: bool) -> bool {
    let committed = if tunnel_proven {
        state.lock().await.applied_direct_interface.clone()
    } else {
        None
    };
    let uplinks = if committed.is_some() {
        usable_physical_uplinks().await.ok()
    } else {
        None
    };
    let keep = may_recover_in_place(tunnel_proven, committed.as_deref(), uplinks.as_deref());
    if tunnel_proven && !keep {
        logging!(
            warn,
            Type::Service,
            "Tono: DIRECT is bound to an adapter that no longer carries a usable default route; rebuilding the session under the locked barrier"
        );
    }
    keep
}

/// Serialize failure admission with selection/switch completion before transferring lifecycle
/// ownership to release. A hot switch deliberately keeps the connection generation.
async fn admit_health_release(
    state: &Arc<TonoState>,
    generation: u64,
    selected_node: Option<&str>,
    switch_task: Option<tokio::task::Id>,
    check_switch_task: bool,
) -> Result<(
    tokio::sync::OwnedRwLockReadGuard<()>,
    tokio::sync::OwnedRwLockWriteGuard<()>,
), NetworkChangeOutcome> {
    let selection = state.begin_policy_activation().await;
    let lifecycle = state.begin_privileged_release().await;
    let mut inner = state.lock().await;
    if inner.connect_generation != generation || !inner.fsm.status().is_connected {
        return Err(NetworkChangeOutcome::Handled);
    }
    if inner.selected_node.as_deref() != selected_node {
        // The runtime and its monitor still belong to this generation. Discard the old exit's
        // failure and let the next monitor tick observe the replacement instead of exiting.
        return Err(NetworkChangeOutcome::RecoveredInPlace);
    }
    // Finished switch handles stay registered until replacement, so even A → B → A or a
    // proved rollback invalidates the old request without changing the connection generation.
    if check_switch_task && inner.tasks.switch.as_ref().map(|task| task.inner().id()) != switch_task {
        return Err(NetworkChangeOutcome::RecoveredInPlace);
    }
    inner.tasks.abort_reconnect();
    Ok((selection, lifecycle))
}

fn capture_health_context(
    inner: &TonoInner, allow_in_place: bool,
) -> Result<(u64, Option<String>, Option<tokio::task::Id>), NetworkChangeOutcome> {
    let status = inner.fsm.status();
    if !status.is_connected || status.is_disconnecting {
        return Err(NetworkChangeOutcome::Handled);
    }
    // Selection is published before the switch moves the live selector. Its own proof owns
    // that transition; an old-runtime health request must not be labelled with the new exit.
    // Forced protection/policy recovery has separate evidence and retains its authority.
    if allow_in_place && inner.tasks.switch.as_ref().is_some_and(|task| !task.inner().is_finished()) {
        return Err(NetworkChangeOutcome::RecoveredInPlace);
    }
    Ok((inner.connect_generation, inner.selected_node.clone(),
        inner.tasks.switch.as_ref().map(|task| task.inner().id())))
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
    let (generation, selected_node, switch_task) = {
        let inner = state.lock().await;
        match capture_health_context(&inner, allow_in_place) {
            Ok(context) => context,
            Err(outcome) => return outcome,
        }
    };
    // Prefer an in-place proof while the core is still the same process.
    // Sleep/Wi-Fi flaps used to stop the core unconditionally, then burn the
    // first reconnect on "DNS 53 busy" because the just-killed listener was
    // the one we needed.
    if allow_in_place && may_keep_session_in_place(state, verify_tun_data_plane().await.is_ok()).await {
        let inner = state.lock().await;
        if inner.connect_generation != generation || !inner.fsm.status().is_connected {
            return NetworkChangeOutcome::Handled;
        }
        logging!(
            info,
            Type::Service,
            "Tono: network change recovered in place; core was not restarted"
        );
        return NetworkChangeOutcome::RecoveredInPlace;
    }
    // In-place proof failed. Ordinary health loss uses the shared disposition:
    // release the barrier and probe without a tunnel. A policy rebuild and an
    // explicit strict kill switch keep the protected reconnect below.
    let policy_rebuild = POLICY_REBUILD.try_with(|_| ()).is_ok();
    let strict = tono_core::strict_kill_switch_explicit(None);
    let health_guard = if tono_core::unarmed_probe::health_monitor_releases(strict, policy_rebuild) {
        match admit_health_release(state, generation, selected_node.as_deref(), switch_task, allow_in_place).await {
            Ok(guards) => Some(guards),
            Err(outcome) => return outcome,
        }
    } else {
        None
    };
    let health_release = release_after_health_failure(strict, policy_rebuild, |apply_narrow| async move {
        let (_selection, lifecycle) = health_guard.expect("ordinary health release owns admission");
        logging!(
            warn,
            Type::Service,
            "Tono: health failure is restoring the original network with the secondary AI hold"
        );
        if apply_narrow {
            super::disconnect::release_explicit_applying_narrow_with_guard(state, app, Some(lifecycle)).await
        } else {
            super::disconnect::release_explicit_with_guard(state, app, Some(lifecycle)).await
        }
    }).await;
    if let Some(result) = health_release {
        match result {
            Ok(()) => {
                let generation = state.lock().await.connect_generation;
                super::unarmed_probe::spawn_after_release(state, app, generation);
            }
            Err(error) => {
                logging!(
                    error,
                    Type::Service,
                    "Tono: health-failure release failed; not starting a tunnel: {error}"
                );
            }
        }
        return NetworkChangeOutcome::Handled;
    }
    // The exclusive release guard also excludes StartClash/DNS readers, including Retry now.
    // Keep it inside a detached worker: aborting netmon must not expose a still-running stop.
    let guard_state = Arc::clone(state);
    let recovery_state = Arc::clone(state);
    let recovery_app = app.clone();
    let stopped = tono_core::recovery::reconcile_recovery(
        async move { guard_state.begin_privileged_release().await },
        async move {
            {
                let mut inner = recovery_state.lock().await;
                if inner.connect_generation != generation || !inner.fsm.status().is_connected {
                    return false;
                }
                inner.fsm.tunnel_died();
                commands::emit_status(&recovery_app, &commands::status_of(&inner));
            }
            recovery_state.audit().log(AuditEvent::ProtectedOffline { reason: "networkChange" });
            // Stop(false) already restricts WFP under the Service lifecycle lock. A separate
            // owner-only restrict request could arrive late and mutate a replacement session.
            if let Err(error) = service::tono_stop_core(false).await {
                logging!(warn, Type::Service, "Tono: recovery stop requires reconciliation: {error:#}");
            }
            true
        },
    ).await;
    match stopped {
        Ok(true) => {}
        Ok(false) => return NetworkChangeOutcome::Handled,
        Err(error) => {
            logging!(error, Type::Service, "Tono: recovery worker failed; keeping protection: {error}");
            return NetworkChangeOutcome::Handled;
        }
    }
    // Teardown is settled and its exclusive guard is gone. A disconnect may have retired us
    // while waiting; check here and again inside attempt admission rather than adopting its
    // newer generation after this lock is released.
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
    match super::attempt_for_generation(state, app, Some(generation)).await {
        Attempt::Failed { generation, error, account_owner } => {
            if fail_connect(state, app, generation, error, account_owner).await {
                schedule_reconnect_for_generation(state, app, generation).await;
            }
        }
        // A transient guard (a release still reconciling, a transition still finishing) is not a
        // verdict — without a reschedule the machine sits blocked with nothing left to retry.
        Attempt::GuardRejected(reason) if guard_rejection_is_transient(&reason) => {
            logging!(info, Type::Service, "Tono: 重连被暂态守卫拒绝，稍后重试: {reason}");
            schedule_reconnect_for_generation(state, app, generation).await;
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
    let client = { Arc::clone(&state.lock().await.client) };
    if let Err(error) = client.transport().refresh_control_plane_pins().await {
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

#[cfg(test)]
mod tests {
    use super::{PolicyChangeDisposition, apply_policy_change_disposition};
    use crate::tono::state::TonoState;
    use std::sync::Arc;
    use futures::FutureExt;

    #[tokio::test]
    async fn health_proof_cannot_release_a_completed_switch_back_to_the_same_exit() {
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            let state = Arc::new(TonoState::for_test());
            let (generation, selected, switch_task) = {
                let mut inner = state.lock().await;
                inner.fsm.begin_connect();
                inner.fsm.mark_kill_switch_armed();
                inner.fsm.mark_session_verified();
                inner.fsm.connect_succeeded().unwrap();
                inner.selected_node = Some("A".to_owned());
                super::capture_health_context(&inner, true).unwrap()
            };
            // The old request stays pending while two separately owned hot switches finish.
            for next in ["B", "A"] {
                let _selection = state.begin_policy_update().await;
                let _lifecycle = state.begin_privileged_release().await;
                {
                    let mut inner = state.lock().await;
                    inner.tasks.switch.take();
                    inner.selected_node = Some(next.to_owned());
                    inner.tasks.switch = Some(tauri::async_runtime::spawn(async {}));
                }
                while !state.lock().await.tasks.switch.as_ref().unwrap().inner().is_finished() {
                    tokio::task::yield_now().await;
                }
            }
            assert_eq!(state.lock().await.connect_generation, generation);
            assert_eq!(state.lock().await.selected_node, selected);
            match super::admit_health_release(&state, generation, selected.as_deref(), switch_task, true).await {
                Ok(_) => panic!("an intervening switch must retire the old A proof even after selection returns to A"),
                Err(outcome) => assert_eq!(outcome, super::NetworkChangeOutcome::RecoveredInPlace),
            }
            let forced = super::admit_health_release(&state, generation, selected.as_deref(), switch_task, false)
                .await.expect("forced protection recovery keeps its authority across the switch fence");
            drop(forced);
            let fresh = {
                let inner = state.lock().await;
                super::capture_health_context(&inner, true).unwrap()
            };
            let admitted = super::admit_health_release(&state, fresh.0, fresh.1.as_deref(), fresh.2, true)
                .await.expect("the next fresh proof can still release the current runtime");
            drop(admitted);
        }).await.expect("switch proof identity must settle without deadlock");
    }

    #[tokio::test]
    async fn health_proof_during_published_selection_cannot_release_the_finishing_switch() {
        let state = Arc::new(TonoState::for_test());
        let selection = state.begin_policy_update().await;
        let lifecycle = state.begin_privileged_release().await;
        let (finish_switch, switch_finished) = tokio::sync::oneshot::channel();
        let context = {
            let mut inner = state.lock().await;
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            // The command has published B; its registered worker has not moved A's selector yet.
            inner.selected_node = Some("B".to_owned());
            inner.tasks.switch = Some(tauri::async_runtime::spawn(async move {
                switch_finished.await.unwrap();
            }));
            assert!(super::capture_health_context(&inner, false).is_ok(),
                "forced protection and policy recovery must retain their existing authority");
            super::capture_health_context(&inner, true)
        };
        finish_switch.send(()).unwrap();
        let switch = state.lock().await.tasks.switch.take().unwrap();
        switch.await.unwrap();
        drop(lifecycle);
        drop(selection);
        match context {
            Ok((generation, selected, switch_task)) => {
                assert!(super::admit_health_release(&state, generation, selected.as_deref(), switch_task, true).await.is_err(),
                    "a proof begun on old A after B publication must not release verified B");
            }
            Err(outcome) => assert_eq!(outcome, super::NetworkChangeOutcome::RecoveredInPlace),
        }
        let inner = state.lock().await;
        assert!(inner.fsm.status().is_connected);
        assert_eq!(inner.selected_node.as_deref(), Some("B"));
        assert_eq!(super::capture_health_context(&inner, true).unwrap(),
            (inner.connect_generation, Some("B".to_owned()), None),
            "the next tick must capture the settled replacement for a fresh proof");
    }

    #[tokio::test]
    async fn old_exit_health_failure_cannot_release_a_same_generation_hot_switch() {
        let state = Arc::new(TonoState::for_test());
        let (generation, selected) = {
            let mut inner = state.lock().await;
            inner.selected_node = Some("A".to_owned());
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            (inner.connect_generation, inner.selected_node.clone())
        };
        let (finish_proof, proof_finished) = tokio::sync::oneshot::channel();
        let proof_state = Arc::clone(&state);
        let old_proof = tokio::spawn(async move {
            proof_finished.await.unwrap();
            match super::admit_health_release(&proof_state, generation, selected.as_deref(), None, true).await {
                Ok(_) => panic!("an old A proof must not dispatch release against B"),
                Err(outcome) => outcome,
            }
        });
        {
            // Selection publication and hot-switch completion own these locks in this order.
            let _selection = state.begin_policy_update().await;
            let _switch = state.begin_privileged_release().await;
            let mut inner = state.lock().await;
            inner.selected_node = Some("B".to_owned());
            assert_eq!(inner.connect_generation, generation);
        }
        finish_proof.send(()).unwrap();
        assert_eq!(old_proof.await.unwrap(), super::NetworkChangeOutcome::RecoveredInPlace,
            "the same-generation monitor must continue watching the replacement");
        assert_eq!(state.lock().await.selected_node.as_deref(), Some("B"));
        assert!(state.lock().await.fsm.status().is_connected);
        let (_selection, lifecycle) = super::admit_health_release(&state, generation, Some("B"), None, true)
            .await.expect("a current B failure must still admit automatic AI-held release");
        assert!(state.begin_connect_mutation().now_or_never().is_none(),
            "the admitted release must exclude replacement startup");
        drop(lifecycle);
    }

    #[tokio::test]
    async fn automatic_health_release_keeps_ai_blocked_and_preserves_protected_recovery() {
        let mut general_blocked = true;
        let mut ai_blocked = true;
        let general = &mut general_blocked;
        let ai = &mut ai_blocked;
        let result = super::release_after_health_failure(false, false, |apply_narrow| async move {
            *general = false;
            *ai = apply_narrow;
            Ok(())
        }).await;
        assert_eq!(result, Some(Ok(())));
        assert!(!general_blocked, "ordinary health loss must restore general internet");
        assert!(ai_blocked, "automatic recovery must retain the secondary AI hold");

        let strict = super::release_after_health_failure(true, false, |_| async {
            panic!("strict protection must not dispatch a release")
        }).await;
        assert_eq!(strict, None);
        let rebuild = super::release_after_health_failure(false, true, |_| async {
            panic!("policy rebuild must stay on protected recovery")
        }).await;
        assert_eq!(rebuild, None);
        let refused = super::release_after_health_failure(false, false, |apply_narrow| async move {
            assert!(apply_narrow, "release refusal must not downgrade the AI hold");
            Err("injected release refusal".to_string())
        }).await;
        assert_eq!(refused, Some(Err("injected release refusal".to_string())));
    }

    /// F5: a policy behavior change that lands while Connecting is deferred to
    /// that attempt's commit, and only that attempt's. A deferral left behind by
    /// an attempt the user disconnected (or that failed, or whose account was
    /// closed) must be discarded, never consumed by the next session's commit —
    /// there it could schedule an unexplained protected teardown + reconnect.
    #[tokio::test]
    async fn a_policy_change_deferred_during_connecting_is_consumed_only_by_that_attempt() {
        let state = Arc::new(TonoState::for_test());
        let mut inner = state.lock().await;
        inner.retire_connection_generation(false);
        let abandoned = inner.connect_generation;
        inner.fsm.begin_connect();
        assert_eq!(
            apply_policy_change_disposition(&mut inner),
            PolicyChangeDisposition::DeferUntilConnected
        );
        // Disconnect, as `disconnect()` drives it.
        inner.invalidate_connection(true);
        inner.fsm.begin_disconnect();
        inner.fsm.finish_disconnect();

        // The next attempt is admitted (`begin_attempt` retires once more) and commits.
        inner.retire_connection_generation(false);
        let next = inner.connect_generation;
        assert_ne!(next, abandoned);
        inner.fsm.begin_connect();
        inner.fsm.mark_kill_switch_armed();
        inner.fsm.mark_session_verified();
        inner.fsm.connect_succeeded().unwrap();
        assert!(
            !inner.take_pending_policy_change(next),
            "a deferral from a disconnected attempt must not reach the next session"
        );

        // A deferral recorded by the committing attempt itself is still consumed, once.
        inner.fsm.begin_disconnect();
        inner.fsm.finish_disconnect();
        inner.retire_connection_generation(false);
        let current = inner.connect_generation;
        inner.fsm.begin_connect();
        apply_policy_change_disposition(&mut inner);
        inner.fsm.mark_kill_switch_armed();
        inner.fsm.mark_session_verified();
        inner.fsm.connect_succeeded().unwrap();
        assert!(inner.take_pending_policy_change(current));
        assert!(!inner.take_pending_policy_change(current), "consumption is once");
    }
}
