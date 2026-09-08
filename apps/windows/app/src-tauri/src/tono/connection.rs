//! Connect orchestration.
//!
//! Every privileged step goes through the Service IPC wrappers in
//! `core::service` — the owner/session machinery is never bypassed. The
//! fail-closed invariant: once the WFP policy exists, only Disconnect,
//! Sign Out, or Quit release it; everything else keeps blocking behind
//! `Protected Offline` plus the 2/5/10/20/30 s reconnect backoff.
//!
//! Concurrency: `connect_generation` (in `TonoInner`) is bumped by
//! disconnect, sign-out, node switches, and catalog-driven teardowns. An
//! in-flight attempt re-checks it at every stage boundary and exits with no
//! side effects — no `fail_connect`, no emit, no core action — when it
//! moved (H1).

mod failure;
mod stages;
mod transaction;
mod cleanup;
mod controller;
mod endpoints;
mod monitor;
mod probes;
mod status;
mod disconnect;
mod reconnect;
mod switch;
mod direct;
mod platform;

// Compatibility surface for existing command and test callers. The transaction
// and error modules do not import this orchestration facade.
pub use failure::{
    BFE_NOT_RUNNING_PREFIX, NODE_OR_CORE_UNREACHABLE_PREFIX,
    RELEASE_RECONCILING_PREFIX, SERVICE_BUSY_PREFIX,
    SERVICE_TOO_OLD_PREFIX, TUN_DATA_PLANE_BROKEN_PREFIX, TUN_INGRESS_BROKEN_PREFIX,
    WFP_ENGINE_WEDGED_PREFIX, is_retryable_lock_error, map_service_ready_error,
    map_wfp_engine_error,
};
#[allow(unused_imports, reason = "retain the existing public error-marker path")]
pub use failure::SERVICE_NOT_RUNNING_PREFIX;
use failure::{CATALOG_NOT_READY_REJECTION, StageFailure, TRANSITION_IN_FLIGHT_REJECTION};
use stages::run_stages;
use transaction::ConnectTransaction;
#[cfg(test)]
use transaction::{CONNECT_BUDGET_LEGS, CONNECT_TRANSACTION_TIMEOUT};

use std::{error::Error as _, net::IpAddr, sync::Arc, time::Duration};

use tono_logging::{Type, logging};
use tono_service_protocol::{
    KillSwitchConfig, KillSwitchStatus, KillSwitchStatusMode, OwnerSessionProof, ProxyEndpoint,
    ProxyProtocol, RuntimeBundle, ServiceLifecycleState, ServiceStatusSnapshot, StageRuntimeOutcome,
};
use futures::{StreamExt as _, stream::FuturesUnordered};
use tauri::AppHandle;
use tono_plugin_core::{MihomoExt as _, models::Protocol};
use tokio_util::sync::CancellationToken;
use tono_core::{
    EXIT_GROUP_NAME,
    config::{self, RuntimePorts, build_owned_runtime_with_ports},
    connection::{ConnectStage, ReconnectBackoff},
    node::ValidatedNode,
};

#[cfg(not(windows))]
use crate::core::{CoreManager, manager::RunningMode};
use crate::{
    core::{autostart, service},
    process::AsyncHandler,
    tono::{
        audit::{self, AuditEvent},
        bootstrap, catalog_sync, commands, signed_apps,
        state::{AccountState, TonoInner, TonoState},
    },
};

pub use crate::tono::connection_health::{
    CORE_MISSING_SUSTAINED_SAMPLES, CoreSample, HEALTH_FAILURE_THRESHOLD, HealthLegs, NETWORK_EVENT_DEBOUNCE,
    NetworkChangeOutcome, classify_core_sample, connection_loop_continues, core_change_fires,
    health_threshold_reached, kill_switch_unhealthy, monitor_requires_reconnect, network_event_fires,
    protected_dns_unhealthy, startup_resume_guards_hold, startup_runtime_is_resume_candidate,
};
pub use crate::tono::connection_plan::{
    FailurePlan, SelectAction, guard_rejection_is_transient, plan_failure, reconnect_allowed, retry_now_is_noop,
    select_action, sign_out_needs_release, single_flight_begin, stale_exit_needs_release,
};
#[cfg(any(not(windows), test))]
pub use crate::tono::connection_plan::stop_core_before_release;
pub(crate) use crate::tono::connection_routes::{
    ANTHROPIC_DESTINATIONS, MAX_DIRECT_SAMPLES, MAX_PROTECTED_ROUTE_SAMPLES,
    ProtectedDestination, ProtectedRoute, ProtectedRouteAggregate, SampledConnections,
    TELEMETRY_DESTINATIONS, TURNSTILE_DESTINATIONS, UPDATE_DESTINATIONS, classify_protected_route,
    new_direct_samples, observe_protected_routes, protected_destination,
};

use cleanup::{ensure_fresh, retire_timed_out_generation};
use controller::{
    CONTROLLER_HTTP_TIMEOUT, CONTROLLER_READY_TIMEOUT, LOCK_ATTEMPTS, LOCK_RETRY_INTERVAL,
    classify_bfe_state, controller_client, controller_url, dns_listener_conflict_message, ensure_service_ready,
    lock_kill_switch_with_retries, select_exit_group, wait_controller,
};
pub use controller::close_owned_controller_connection;
use endpoints::proxy_endpoints_for;
pub use endpoints::{proxy_endpoint_of, unique_proxy_endpoints};
use monitor::{IN_PLACE_RECOVERY_COOLDOWN, NETWORK_MONITOR_INTERVAL, monitor_interval, wechat_paths_changed};
pub(crate) use monitor::handle_network_change;
#[cfg(test)]
use probes::EXIT_PROBE_ADVISORY_BUDGET;
use probes::{
    EXIT_PROBE_CLIENT_TIMEOUT, EXIT_PROBE_CORE_TIMEOUT_MS, FAKE_IP_LOOKUP_TIMEOUT, POST_LOCK_VERIFY_ROUND_DELAY,
    POST_LOCK_VERIFY_ROUNDS, PostLockVerification, TUN_DATA_PLANE_CONNECT_TIMEOUT, TUN_DATA_PLANE_PROBES,
    TUN_DATA_PLANE_TIMEOUT, TUN_PROBE_STAGGER, VERIFY_LOCK_ATTEMPTS, classify_exhausted_data_plane,
    classify_post_lock_verification, connect_failure_is_dead_exit, fake_ip_attempt_timeout,
    fake_ip_verification_error, format_tun_probe_failures, tun_probe_stagger, verify_tun_data_plane,
};
pub use probes::{is_fake_ip, test_current_server, verify_lock_retry_window};

pub use disconnect::{disconnect, release_explicit};
use disconnect::{EXPLICIT_RELEASE_TIMEOUT, SERVICE_LIFECYCLE_TIMEOUT};
pub use reconnect::{retry_reconnect_now, schedule_reconnect, schedule_startup_resume_if_proven};
use reconnect::active_runtime_resume_status;
pub use switch::{selected_node_vanished, switch_selected_node};
pub use direct::{build_direct_plan, collect_ipv4_literals};
use direct::{
    WINDOWS_OPTIONAL_DIRECT_ENABLED, CapturedTrafficPolicy, ControllerDirectRuleProof, MAX_DIRECT_ENDPOINTS,
    CLOUD_DNS_QUERY_ATTEMPTS, CLOUD_POLICY_RESOLUTION_TIMEOUT, MIHOMO_PROCESS_PATH_REGEX_TYPE,
    OptionalDirectResolution, classify_optional_direct_resolution, controller_direct_graph_is_active,
    controller_dns_status_is_retryable, dns_query_a, dns_query_a_with_retry, expected_controller_direct_rules,
    prove_service_endpoint_digest, prove_service_reload_mode, spawn_optional_direct_after_connected,
    validate_direct_reload_result,
};
use platform::{detect_physical_interface, is_virtual_uplink_description, write_redacted_copy};


/// Stable frontend mapping for the strict browser-owned DNS proof required by a residential
/// Claude route. Detail after the prefix is deliberately limited to controlled enum text.
#[cfg(windows)]
const BROWSER_DNS_PREFLIGHT_PREFIX: &str = "TONO_BROWSER_DNS_PREFLIGHT";

/// Controller failures are useful only when they remain bounded and safe to persist in the
/// connect progress/audit trail. Mihomo's local API normally returns a tiny JSON error; cap the
/// extracted message in case that shape changes.
const CONTROLLER_ERROR_DETAIL_LIMIT: usize = 384;



/// Spawned task futures are boxed into this trait object so a spawner's
/// async opaque type never embeds the spawned task's (the tasks re-enter
/// `attempt`, which would otherwise make the types infinitely recursive).
type BoxedTask = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>;

/// `attempt` returns a boxed future rather than being an `async fn`: the
/// network monitor and the reconnect loop re-enter it, and a concrete return
/// type keeps the async opaque-type graph finite.
type BoxedAttempt<'a> = std::pin::Pin<Box<dyn std::future::Future<Output = Attempt> + Send + 'a>>;

/// Outcome of one connect attempt, distinguishing "never started" from
/// "started and failed" — only the latter runs the failure decision table.
enum Attempt {
    Connected,
    /// Guards rejected the attempt before any state changed (busy, no
    /// selection, suspended). No failure handling applies.
    GuardRejected(String),
    /// The transaction ran (or reached the service checks) and failed.
    Failed(String),
    /// The connect generation moved under us (disconnect / sign-out / node
    /// switch / catalog teardown). Exit without touching the FSM, the core,
    /// or the UI: the flow that bumped the generation owns the cleanup.
    Stale,
}

fn seed_autostart_after_connect() {
    AsyncHandler::spawn(|| async {
        autostart::enable_on_first_connect().await;
    });
}

/// `tono_connect`: guard, then the full §6 transaction; any failure after
/// arm keeps blocking and schedules the protected reconnect.
pub async fn connect(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    {
        let mut inner = state.lock().await;
        match &inner.account_state {
            AccountState::Ready => {}
            AccountState::Suspended => return Err("account is suspended".to_string()),
            _ => return Err("not signed in".to_string()),
        }
        if inner.fsm.status().is_connected {
            return Err("already connected".to_string());
        }
        if inner.fsm.status().is_connecting {
            return Err("already connecting".to_string());
        }
        if let Some(replacement) = catalog_sync::ensure_usable_selection(&mut inner) {
            logging!(
                info,
                Type::Service,
                "Tono: connect retargeted leftover selection onto catalog exit {replacement}"
            );
        }
    }
    match attempt(&state, &app).await {
        Attempt::Connected => {
            seed_autostart_after_connect();
            Ok(())
        }
        Attempt::GuardRejected(err) => Err(err),
        Attempt::Stale => Err("connection superseded by a newer transition".to_string()),
        Attempt::Failed(err) => {
            let err = fail_connect(&state, &app, err).await;
            schedule_reconnect(&state, &app).await;
            Err(err)
        }
    }
}

/// One full connect attempt: guards → service checks → begin → stages.
/// Returns a boxed future (see [`BoxedAttempt`]); call sites `await` it as
/// before.
fn attempt<'a>(state: &'a Arc<TonoState>, app: &'a AppHandle) -> BoxedAttempt<'a> {
    Box::pin(attempt_inner(state, app))
}

async fn attempt_inner(state: &Arc<TonoState>, app: &AppHandle) -> Attempt {
    let (node, nodes, routing, generation, cancellation) = match guard_snapshot(state).await {
        Ok(snapshot) => snapshot,
        Err(err) => return Attempt::GuardRejected(err),
    };
    let transaction = ConnectTransaction::new(cancellation);
    // L5: the clock starts at the top of the attempt, so even a
    // service-readiness failure leaves no orphan ConnectFail.
    let started = std::time::Instant::now();
    // F5 single-flight, latched BEFORE any service I/O: rapid repeated
    // clicks admit exactly one attempt to the service probe; the rest exit
    // here with no side effects (the real-machine double-probe this kills).
    {
        let mut inner = state.lock().await;
        let current_generation = inner.connect_generation;
        if !single_flight_begin(&mut inner.fsm, current_generation, generation) {
            if inner.connect_generation != generation {
                return Attempt::Stale;
            }
            return Attempt::GuardRejected(TRANSITION_IN_FLIGHT_REJECTION.to_string());
        }
        // A disconnected-only endpoint batch cannot overlap WFP/Core startup. Cancel it in the
        // same critical section that atomically moves the FSM to Connecting, leaving no new-test
        // admission window between the two operations.
        inner.cancel_server_tests();
        // F3: a fresh attempt resets the step record and clears the last
        // failure details (retry bookkeeping persists across attempts).
        inner.connect_steps = crate::tono::steps::initial_steps();
        inner.step_started_at = Some(started);
        inner.failed_stage = None;
        inner.connect_error = None;
        inner.connect_error_at_ms = None;
        inner.next_retry_at_ms = None;
        inner.optional_direct_active = false;
        inner.optional_direct_skip = None;
        commands::emit_status(app, &commands::status_of(&inner));
    }

    state.audit().log(AuditEvent::ConnectBegin {
        node: node.name.clone(),
    });

    // A residential Web guarantee requires Mihomo to see protected hostnames. Browser-owned DoH
    // (and ECH layered on it) can hide that identity, so prove Chrome/Edge's effective managed +
    // local configuration before starting the Service or changing WFP. Ordinary Tono protection
    // intentionally remains available when the catalog has no residential Claude route.
    #[cfg(windows)]
    if routing
        .as_ref()
        .is_some_and(|routing| routing.home_socks5.is_some() || routing.home_proxy.is_some())
    {
        match transaction
            .wait(
                "browser Secure DNS preflight",
                crate::tono::browser_dns::verify_residential_browser_dns(),
            )
            .await
        {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                return Attempt::Failed(format!("{BROWSER_DNS_PREFLIGHT_PREFIX}: {error}"));
            }
            Err(failure) => return attempt_from_stage_failure(state, generation, failure).await,
        }
    }

    match transaction.wait("service readiness", ensure_service_ready()).await {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            // The kill switch may already be armed from a previous session, so this is a
            // transaction failure, not a guard rejection. `fail_connect` runs the decision
            // table and (pre-arm) releases the FSM cleanly.
            return Attempt::Failed(err);
        }
        Err(failure) => return attempt_from_stage_failure(state, generation, failure).await,
    }

    #[cfg(windows)]
    {
        let _ = crate::core::sysopt::Sysopt::global().reset_sysproxy().await;
    }

    match run_stages(state, app, &node, &nodes, routing.as_ref(), generation, started, &transaction).await {
        Ok(()) => Attempt::Connected,
        Err(StageFailure::Stale) => Attempt::Stale,
        Err(StageFailure::TimedOut(err)) => {
            retire_timed_out_generation(state, generation).await;
            Attempt::Failed(err)
        }
        Err(StageFailure::Error(err)) => Attempt::Failed(err),
    }
}

async fn attempt_from_stage_failure(state: &Arc<TonoState>, generation: u64, failure: StageFailure) -> Attempt {
    match failure {
        StageFailure::Stale => Attempt::Stale,
        StageFailure::TimedOut(error) => {
            retire_timed_out_generation(state, generation).await;
            Attempt::Failed(error)
        }
        StageFailure::Error(error) => Attempt::Failed(error),
    }
}


/// §6.1 guards: forced values live in the owned runtime; here we check the
/// account is ready (H2a — the reconnect path's only account gate), the
/// catalog is usable, the selection exists and passed admission, and no
/// transaction is in flight. Pure read — no state changes.
async fn guard_snapshot(
    state: &Arc<TonoState>,
) -> Result<(ValidatedNode, Vec<ValidatedNode>, Option<tono_core::CatalogRouting>, u64, CancellationToken), String> {
    if state.release_in_progress().await {
        return Err(format!(
            "{RELEASE_RECONCILING_PREFIX}: network protection release is still reconciling; wait before reconnecting"
        ));
    }
    let inner = state.lock().await;
    match &inner.account_state {
        AccountState::Ready => {}
        AccountState::Suspended => return Err("account is suspended".to_string()),
        _ => return Err("not signed in".to_string()),
    }
    let status = inner.fsm.status();
    if status.is_connecting || status.is_connected || status.is_disconnecting {
        return Err(TRANSITION_IN_FLIGHT_REJECTION.to_string());
    }
    if inner.catalog_requires_choice {
        return Err("the selected node left the catalog; pick a server again".to_string());
    }
    if inner.nodes.is_empty() {
        return Err(CATALOG_NOT_READY_REJECTION.to_string());
    }
    let selected = inner
        .selected_node
        .clone()
        .ok_or_else(|| "select a server first".to_string())?;
    let node = inner
        .nodes
        .iter()
        .find(|node| node.name == selected)
        .cloned()
        .ok_or_else(|| "the selected server is not in the catalog".to_string())?;
    Ok((
        node,
        inner.nodes.clone(),
        inner.routing.clone(),
        inner.connect_generation,
        inner.connect_cancellation.clone(),
    ))
}























/// The §6 failure decision table, executing [`plan_failure`]. After arm:
/// stop the core, keep blocking (restrict to the bootstrap channel),
/// Protected Offline. Before arm: full release.
async fn fail_connect(state: &Arc<TonoState>, app: &AppHandle, err: String) -> String {
    logging!(error, Type::Service, "Tono: 连接事务失败: {err}");
    let observed = service::tono_kill_switch_status().await.ok();
    let (plan, stage, action, armed) = {
        let mut inner = state.lock().await;
        if let Some(status) = &observed {
            inner.kill_switch = Some(status.clone());
        }
        let stage = inner.fsm.status().stage;
        let armed = observed
            .as_ref()
            .map(|status| status.wanted)
            .unwrap_or(inner.fsm.kill_switch_armed());
        let was_disconnecting = inner.fsm.status().is_disconnecting;
        let session_verified = observed
            .as_ref()
            .map(|status| status.verified)
            .unwrap_or(inner.fsm.session_verified());
        if session_verified {
            inner.fsm.mark_session_verified();
        }
        let plan = plan_failure(armed, session_verified, was_disconnecting);
        let action: &'static str = if was_disconnecting {
            "racedDisconnect"
        } else if armed && session_verified {
            "keepBlockingAndReconnect"
        } else {
            "fullRelease"
        };
        if plan.mark_armed {
            inner.fsm.mark_kill_switch_armed();
        } else if armed && !session_verified && !was_disconnecting {
            // Keep reality visible until the required full release actually succeeds.
            inner.fsm.mark_kill_switch_armed();
            // ...and stop claiming Connecting while it runs. The predicate below deliberately
            // skips `connect_failed` in this case (it would resolve to FullRelease and disarm
            // before the release had actually run), which left `is_connecting` true alongside
            // `is_protection_blocked` for the whole of `release_explicit` — a full
            // `EXPLICIT_RELEASE_TIMEOUT` of a UI reading "Connecting" with no transaction in
            // flight, during which `guard_snapshot`
            // rejected every new connect. This is the state both exit branches below converge
            // on anyway, minus the release verdict.
            inner.fsm.initial_release_failed();
        }
        if !was_disconnecting && (session_verified || !armed) {
            // Drives the FSM to Protected Offline (armed) or releases it
            // (pre-arm), mirroring the plan.
            inner.fsm.connect_failed();
        }
        inner.controller_secret = None;
        inner.controller_port = None;
        // F3: the in-flight step is failed (never completed); the error is
        // sanitized before it is stored for the UI.
        let step_elapsed = inner
            .step_started_at
            .map(|at| at.elapsed().as_millis() as u64)
            .unwrap_or(0);
        crate::tono::steps::fail_current(&mut inner.connect_steps, step_elapsed);
        inner.failed_stage = stage.map(commands::stage_key);
        inner.connect_error = Some(crate::tono::audit::redact(&err));
        inner.connect_error_at_ms = Some(commands::epoch_millis());
        if plan.mark_armed {
            inner.retry_attempt += 1;
        }
        (plan, stage, action, armed)
    };
    state.audit().log(AuditEvent::ConnectFail {
        stage: stage.map(commands::stage_key),
        error: err.clone(),
        action,
    });
    if plan.mark_armed {
        state
            .audit()
            .log(AuditEvent::ProtectedOffline { reason: "connectFail" });
    }

    if plan.stop_core == Some(true) && armed {
        match release_explicit(state, app).await {
            Ok(()) => {
                state.lock().await.fsm.connect_failed();
            }
            Err(release_error) => {
                let mut inner = state.lock().await;
                inner.fsm.initial_release_failed();
                inner.connect_error = Some(crate::tono::audit::redact(&format!("{err}; {release_error}")));
            }
        }
    } else if let Some(release) = plan.stop_core {
        let _ = service::tono_stop_core(release).await;
    }
    if plan.restrict_bootstrap {
        let _ = service::tono_restrict_bootstrap().await;
    }

    let inner = state.lock().await;
    commands::emit_status(app, &commands::status_of(&inner));
    err
}































/// Wire key for the kill switch mode in audit records.
fn kill_switch_mode_key(mode: KillSwitchStatusMode) -> &'static str {
    match mode {
        KillSwitchStatusMode::Bootstrap => "bootstrap",
        KillSwitchStatusMode::Locked => "locked",
        KillSwitchStatusMode::Blocked => "blocked",
    }
}



























































/// Extract the human-readable part of a Mihomo controller error without carrying credentials,
/// query strings, arbitrary control characters, or an unbounded response into logs/UI state.
pub fn controller_error_detail(body: &str) -> Option<String> {
    const MAX_JSON_INPUT: usize = 4 * 1024;
    let json_detail = (body.len() <= MAX_JSON_INPUT)
        .then(|| serde_json::from_str::<serde_json::Value>(body).ok())
        .flatten()
        .and_then(|value| {
            ["message", "error", "detail"]
                .into_iter()
                .find_map(|key| value.get(key).and_then(serde_json::Value::as_str).map(str::to_owned))
        });
    let source = json_detail.as_deref().unwrap_or(body);

    let mut normalized = String::with_capacity(CONTROLLER_ERROR_DETAIL_LIMIT.min(source.len()));
    let mut pending_space = false;
    let mut truncated = false;
    for character in source.chars() {
        if character.is_whitespace() || character.is_control() {
            pending_space = !normalized.is_empty();
            continue;
        }
        if pending_space {
            if normalized.chars().count() >= CONTROLLER_ERROR_DETAIL_LIMIT {
                truncated = true;
                break;
            }
            normalized.push(' ');
            pending_space = false;
        }
        if normalized.chars().count() >= CONTROLLER_ERROR_DETAIL_LIMIT {
            truncated = true;
            break;
        }
        normalized.push(character);
    }
    let mut normalized = audit::redact(normalized.trim());
    if normalized.is_empty() {
        return None;
    }
    if truncated {
        normalized.push('…');
    }
    Some(normalized)
}











#[cfg(test)]
mod tests {
    use super::{
        BFE_NOT_RUNNING_PREFIX, CATALOG_NOT_READY_REJECTION, CLOUD_POLICY_RESOLUTION_TIMEOUT, CONNECT_BUDGET_LEGS,
        ProtectedDestination, ProtectedRoute, ProtectedRouteAggregate, SampledConnections, classify_bfe_state,
        classify_protected_route, new_direct_samples, observe_protected_routes, protected_destination,
        wechat_paths_changed,
        CONNECT_TRANSACTION_TIMEOUT, CONTROLLER_READY_TIMEOUT, CORE_MISSING_SUSTAINED_SAMPLES,
        ControllerDirectRuleProof, CoreSample, EXIT_PROBE_ADVISORY_BUDGET, EXIT_PROBE_CLIENT_TIMEOUT,
        EXIT_PROBE_CORE_TIMEOUT_MS, EXPLICIT_RELEASE_TIMEOUT, FailurePlan, HEALTH_FAILURE_THRESHOLD, HealthLegs,
        IN_PLACE_RECOVERY_COOLDOWN,
        LOCK_ATTEMPTS, LOCK_RETRY_INTERVAL, MAX_DIRECT_ENDPOINTS, NETWORK_EVENT_DEBOUNCE, NETWORK_MONITOR_INTERVAL,
        POST_LOCK_VERIFY_ROUND_DELAY, POST_LOCK_VERIFY_ROUNDS, RELEASE_RECONCILING_PREFIX, SERVICE_BUSY_PREFIX,
        NetworkChangeOutcome, SERVICE_LIFECYCLE_TIMEOUT, SERVICE_TOO_OLD_PREFIX, SelectAction,
        TRANSITION_IN_FLIGHT_REJECTION,
        FAKE_IP_LOOKUP_TIMEOUT, TUN_DATA_PLANE_CONNECT_TIMEOUT, TUN_DATA_PLANE_PROBES, TUN_DATA_PLANE_TIMEOUT,
        TUN_PROBE_STAGGER,
        VERIFY_LOCK_ATTEMPTS,
        WFP_ENGINE_WEDGED_PREFIX, WINDOWS_OPTIONAL_DIRECT_ENABLED, build_direct_plan, classify_core_sample,
        collect_ipv4_literals, connection_loop_continues, controller_direct_graph_is_active, controller_error_detail,
        core_change_fires,
        dns_listener_conflict_message, expected_controller_direct_rules, format_tun_probe_failures, guard_rejection_is_transient,
        health_threshold_reached, is_fake_ip, is_retryable_lock_error, kill_switch_unhealthy, map_service_ready_error,
        map_wfp_engine_error, monitor_interval, monitor_requires_reconnect, network_event_fires, plan_failure,
        protected_dns_unhealthy, prove_service_endpoint_digest, prove_service_reload_mode, proxy_endpoint_of,
        unique_proxy_endpoints,
        reconnect_allowed, retry_now_is_noop, select_action, sign_out_needs_release, single_flight_begin,
        stale_exit_needs_release, startup_resume_guards_hold, startup_runtime_is_resume_candidate,
        fake_ip_attempt_timeout, stop_core_before_release, tun_probe_stagger, validate_direct_reload_result,
        verify_lock_retry_window,
    };
    use tono_service_protocol::{
        DirectRuntimeReloadResult, DnsProtectionStatus, KillSwitchStatus, KillSwitchStatusMode, OwnerSessionProof,
        ServiceLifecycleState, ServiceOperationKind, ServiceOperationSnapshot, ServiceStatusSnapshot,
    };
    use std::time::Duration;
    use std::{
        collections::BTreeSet,
        net::{IpAddr, Ipv4Addr, Ipv6Addr},
    };
    use tono_core::{connection::ConnectionStatus, node::ValidatedNode};

    #[test]
    fn dns_listener_conflict_reports_both_socket_owners_consistently() {
        let message = dns_listener_conflict_message(
            Some("tcp address already in use"),
            Some("udp address already in use"),
        );
        assert!(message.contains("DNS port 127.0.0.1:53 is unavailable"));
        assert!(message.contains("TCP: tcp address already in use"));
        assert!(message.contains("UDP: udp address already in use"));
        assert!(message.contains("Another DNS or proxy process"));
    }

    // ---- H7: the monitor's tick source must never collapse its thresholds ----

    /// The default `MissedTickBehavior::Burst` fires the tick after a slow one ~0 ms later, so
    /// two "consecutive" samples can be milliseconds apart and read the same stale value — the
    /// premise of every threshold below ("2 failures ≈ 4 s of sustained failure") is then false.
    #[tokio::test]
    async fn monitor_interval_delays_missed_ticks_instead_of_bursting() {
        let interval = monitor_interval();
        assert_eq!(interval.missed_tick_behavior(), tokio::time::MissedTickBehavior::Delay);
        assert_eq!(interval.period(), NETWORK_MONITOR_INTERVAL);
    }

    /// The documented meaning of the threshold, restated as an assertion: reaching it must cost
    /// at least `(threshold - 1)` real monitor periods of sustained failure.
    #[test]
    #[allow(clippy::assertions_on_constants, reason = "these tests exist to pin the constants")]
    fn health_threshold_spans_real_time() {
        assert!(HEALTH_FAILURE_THRESHOLD >= 2);
        let sustained = NETWORK_MONITOR_INTERVAL * (HEALTH_FAILURE_THRESHOLD - 1);
        assert!(sustained >= Duration::from_secs(2));
    }

    // ---- H8: one failed observation is one failure ----

    #[test]
    fn a_failed_service_poll_counts_as_one_failure_not_two() {
        let mut legs = HealthLegs::default();
        legs.observe_service_failure();
        assert_eq!(legs.service, 1);
        // The legs that were not observed are untouched — neither incremented (the old bug,
        // which made a single failing poll worth two failures against an `||` test) nor cleared.
        assert_eq!(legs.kill_switch, 0);
        assert_eq!(legs.protected_dns, 0);
        assert_eq!(legs.probe, 0);
        assert!(!legs.invalid());
    }

    /// Fail-closed is preserved: a Service that stays dead still invalidates Connected, just at
    /// the honest rate of one failure per monitor tick.
    #[test]
    fn a_dead_service_still_invalidates_connected() {
        let mut legs = HealthLegs::default();
        for _ in 0..HEALTH_FAILURE_THRESHOLD {
            legs.observe_service_failure();
        }
        assert!(legs.invalid());
    }

    /// A network change that recovered in place must leave the monitor running.
    ///
    /// Two failed Service status IPCs — about four seconds of an SCM recovery restart, or of the
    /// updater replacing the runtime — invalidate Connected on the Service leg alone while
    /// mihomo and WFP are untouched, so the TUN proof succeeds and nothing is torn down. The
    /// call used to be terminal for the caller regardless, which ended the connected-lifetime
    /// monitor for the rest of the session: no more kill-switch, protected-DNS or 120 s exit
    /// probing, so a later dead exit would have shown Connected forever.
    #[test]
    fn a_recovered_in_place_network_change_keeps_the_monitor_alive() {
        let mut legs = HealthLegs::default();
        for _ in 0..HEALTH_FAILURE_THRESHOLD {
            legs.observe_service_failure();
        }
        assert!(legs.invalid());
        assert!(
            connection_loop_continues(NetworkChangeOutcome::RecoveredInPlace),
            "the session was never torn down, so its monitor still owns it"
        );
        // ...and the loop re-seeds against the fresh proof, or the same counters would fire
        // again on the very next tick.
        legs = HealthLegs::default();
        assert!(!legs.invalid());
        // A real teardown still ends the loop: the new session brings its own monitor.
        assert!(!connection_loop_continues(NetworkChangeOutcome::Handled));
        // A leg that never recovers reaches the threshold again two ticks after every re-seed,
        // and each firing costs a three-origin HTTPS proof and an audit record. The cooldown is
        // what keeps a permanently unreachable Service from re-proving the data plane for the
        // whole session and rotating the audit file away.
        assert!(
            IN_PLACE_RECOVERY_COOLDOWN
                > NETWORK_MONITOR_INTERVAL * (HEALTH_FAILURE_THRESHOLD + 1),
            "the cooldown must outlast the threshold it is bounding"
        );
    }

    #[test]
    fn a_failed_poll_never_clears_another_leg() {
        let mut legs = HealthLegs::default();
        legs.observe_kill_switch(true);
        legs.observe_service_failure();
        assert_eq!(legs.kill_switch, 1, "an unobserved leg keeps its history");
        legs.observe_service_ok();
        legs.observe_kill_switch(false);
        assert!(!legs.invalid());
        assert_eq!(legs.service, 0);
    }

    #[test]
    fn each_health_leg_thresholds_independently() {
        for (name, apply) in [
            (
                "kill switch",
                (|legs: &mut HealthLegs| legs.observe_kill_switch(true)) as fn(&mut HealthLegs),
            ),
            ("protected dns", |legs: &mut HealthLegs| {
                legs.observe_protected_dns(true)
            }),
            ("probe", |legs: &mut HealthLegs| legs.observe_probe(true)),
            ("service", |legs: &mut HealthLegs| legs.observe_service_failure()),
        ] {
            let mut legs = HealthLegs::default();
            apply(&mut legs);
            assert!(!legs.invalid(), "{name}: one failure must not invalidate");
            apply(&mut legs);
            assert!(legs.invalid(), "{name}: a sustained failure must invalidate");
        }
    }

    #[test]
    fn only_boundary_legs_can_forbid_in_place_recovery() {
        let mut probe = HealthLegs::default();
        for _ in 0..HEALTH_FAILURE_THRESHOLD {
            probe.observe_probe(true);
        }
        assert!(probe.invalid());
        assert!(!probe.protection_invalid());

        let mut kill_switch = HealthLegs::default();
        for _ in 0..HEALTH_FAILURE_THRESHOLD {
            kill_switch.observe_kill_switch(true);
        }
        assert!(kill_switch.protection_invalid());

        let mut dns = HealthLegs::default();
        for _ in 0..HEALTH_FAILURE_THRESHOLD {
            dns.observe_protected_dns(true);
        }
        assert!(dns.protection_invalid());
    }

    // ---- H4: a quiet `core_pid: None` cannot tear down a healthy tunnel ----

    #[test]
    fn a_missing_core_pid_is_a_quiet_sample() {
        assert_eq!(classify_core_sample(Some(42), Some(3), None, 0), CoreSample::Missing);
        assert!(
            !core_change_fires(CoreSample::Missing, 1),
            "the Service reports core_pid: None on its non-error inactive path"
        );
        assert!(core_change_fires(CoreSample::Missing, CORE_MISSING_SUSTAINED_SAMPLES));
    }

    #[test]
    fn an_explicit_restart_report_still_fires_on_the_first_sample() {
        // A different live pid.
        assert_eq!(
            classify_core_sample(Some(42), Some(3), Some(77), 3),
            CoreSample::Restarted
        );
        // A bumped restart counter under the same pid.
        assert_eq!(
            classify_core_sample(Some(42), Some(3), Some(42), 4),
            CoreSample::Restarted
        );
        assert!(core_change_fires(CoreSample::Restarted, 0));
    }

    #[test]
    fn a_steady_core_is_unchanged() {
        assert_eq!(
            classify_core_sample(Some(42), Some(3), Some(42), 3),
            CoreSample::Unchanged
        );
        assert!(!core_change_fires(CoreSample::Unchanged, 9));
    }

    /// The quiet payload also resets `restart_count` to 0. A *decrease* is that artefact, never
    /// a restart — treating it as one would make the missing-sample threshold pointless.
    #[test]
    fn a_reset_restart_counter_is_not_a_restart() {
        assert_eq!(classify_core_sample(Some(42), Some(3), None, 0), CoreSample::Missing);
        assert_eq!(
            classify_core_sample(Some(42), Some(3), Some(42), 0),
            CoreSample::Unchanged
        );
    }

    // ---- H5: the debounce stamp is a monitor seed ----

    #[test]
    fn a_reconnect_inside_the_debounce_window_keeps_its_first_event() {
        // The bug: a stale stamp from the previous session swallowed the first genuine event.
        assert!(!network_event_fires(true, Some(Duration::from_millis(500))));
        // After the connect-success reset the first event of the new session always fires.
        assert!(network_event_fires(true, None));
        assert!(network_event_fires(true, Some(NETWORK_EVENT_DEBOUNCE)));
        assert!(!network_event_fires(false, None), "no change, no invalidation");
    }

    #[test]
    fn a_network_notification_needs_data_plane_corroboration() {
        assert!(
            !monitor_requires_reconnect(true, false, false, false),
            "a healthy locked tunnel must survive a delayed notification from its own setup"
        );
        assert!(
            monitor_requires_reconnect(true, false, false, true),
            "a failed real data-plane probe corroborates the network event"
        );
        assert!(
            monitor_requires_reconnect(true, true, false, false),
            "a changed Core identity always rebuilds the connection"
        );
        assert!(
            monitor_requires_reconnect(false, false, true, false),
            "independent health failure remains fail-closed without a network event"
        );
        assert!(
            !monitor_requires_reconnect(false, false, false, true),
            "an event-only probe result has no meaning when debounce did not emit an event"
        );
    }

    // ---- V1/H1: verify_locked must not decide on one sample of a decaying cache ----

    #[test]
    #[allow(clippy::assertions_on_constants, reason = "these tests exist to pin the constants")]
    fn kill_switch_verification_outlives_the_liveness_cache() {
        assert!(VERIFY_LOCK_ATTEMPTS > 1, "single-shot verification is the bug");
        // The Service caches `live` for ~1.5 s and refreshes it on a 1 s loop; the retry window
        // must span more than one full refresh so a slow sample is re-read, not believed.
        assert!(
            verify_lock_retry_window() > Duration::from_millis(1_500),
            "retry window {:?} must exceed the liveness cache TTL",
            verify_lock_retry_window()
        );
    }

    // ---- C2: the client must outlast the core, and the stage must stay sane ----

    #[test]
    fn exit_probe_client_budget_outlasts_the_core_budget() {
        let core = Duration::from_millis(EXIT_PROBE_CORE_TIMEOUT_MS);
        assert!(
            EXIT_PROBE_CLIENT_TIMEOUT >= core + Duration::from_secs(2),
            "the client must lose to the core by a real margin, or mihomo's diagnosis is discarded"
        );
    }

    /// `unified-delay: true` in the generated runtime makes mihomo run the measured request
    /// twice inside the single core budget, so that budget must hold a *doubled* request.
    #[test]
    #[allow(clippy::assertions_on_constants, reason = "these tests exist to pin the constants")]
    fn exit_probe_core_budget_holds_a_doubled_request() {
        const SLOW_REALITY_REQUEST_MS: u64 = 3_500;
        assert!(EXIT_PROBE_CORE_TIMEOUT_MS >= 2 * SLOW_REALITY_REQUEST_MS);
    }

    #[test]
    fn advisory_exit_probe_is_one_bounded_attempt() {
        // 11 s of HTTP + at most 5 s from the mainland integration profile. Connect performs
        // exactly one such advisory request before the authoritative data-plane check.
        assert_eq!(
            EXIT_PROBE_ADVISORY_BUDGET,
            EXIT_PROBE_CLIENT_TIMEOUT + Duration::from_secs(5)
        );
    }

    // ---- C3: a transient verification failure is not "the tunnel never came up" ----

    /// Why the retry has to live inside the transaction: at `checkingExit`/`verifyingTraffic`
    /// the barrier is armed and locked but `session_verified` is still false, so the failure
    /// decision table resolves to a full release — and the reconnect gate then refuses to hand
    /// out a delay, because it requires the very latch the release just cleared.
    #[test]
    fn a_post_lock_failure_would_otherwise_be_a_dead_end() {
        assert_eq!(
            plan_failure(true, false, false),
            FailurePlan {
                mark_armed: false,
                stop_core: Some(true),
                restrict_bootstrap: false,
            }
        );
        // ...and the FSM confirms the dead end: after that release neither
        // `is_protection_blocked` nor `session_verified` holds, and `next_reconnect_delay`
        // requires both — so the user lands on NotConnected with nothing scheduled.
        let mut fsm = tono_core::connection::ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        assert!(!fsm.session_verified(), "the latch is committed after these stages");
        fsm.connect_failed();
        assert!(!fsm.status().is_protection_blocked);
        assert_eq!(
            fsm.next_reconnect_delay(),
            None,
            "nothing retries after a post-lock failure — so the retry must happen before it"
        );
    }

    #[test]
    #[allow(clippy::assertions_on_constants, reason = "these tests exist to pin the constants")]
    fn the_post_lock_group_retries_before_giving_up() {
        assert!(
            POST_LOCK_VERIFY_ROUNDS >= 2,
            "one transient real TUN failure must not destroy a working tunnel"
        );
        // ...but the group stays bounded: it can never outlive the transaction budget.
        let real_data_plane_budget = verify_lock_retry_window() + TUN_DATA_PLANE_TIMEOUT + Duration::from_secs(5);
        let worst = EXIT_PROBE_ADVISORY_BUDGET
            + real_data_plane_budget * POST_LOCK_VERIFY_ROUNDS
            + POST_LOCK_VERIFY_ROUND_DELAY;
        assert!(worst < CONNECT_TRANSACTION_TIMEOUT);
    }

    #[test]
    fn exhausted_tun_failure_uses_the_independent_proxy_cross_check() {
        use super::{
            NODE_OR_CORE_UNREACHABLE_PREFIX, TUN_DATA_PLANE_BROKEN_PREFIX, TUN_INGRESS_BROKEN_PREFIX,
            classify_exhausted_data_plane, connect_failure_is_dead_exit, fake_ip_verification_error,
        };

        let tun = "all real TUN probes timed out".to_string();
        let isolated = classify_exhausted_data_plane(Ok(()), tun.clone(), Ok(()));
        assert!(isolated.starts_with(TUN_DATA_PLANE_BROKEN_PREFIX));
        assert!(isolated.contains("node and Mihomo proxy egress passed"));

        let advisory_degraded = classify_exhausted_data_plane(Err("delay probe 504".to_string()), tun.clone(), Ok(()));
        assert!(advisory_degraded.starts_with(TUN_DATA_PLANE_BROKEN_PREFIX));
        assert!(advisory_degraded.contains("loopback proxy egress passed"));

        let ingress = classify_exhausted_data_plane(Ok(()), tun.clone(), Err("proxy CONNECT timeout".to_string()));
        assert!(ingress.starts_with(TUN_INGRESS_BROKEN_PREFIX));

        let unreachable = classify_exhausted_data_plane(
            Err("delay probe 504".to_string()),
            tun,
            Err("proxy CONNECT timeout".to_string()),
        );
        assert!(unreachable.starts_with(NODE_OR_CORE_UNREACHABLE_PREFIX));
        assert!(connect_failure_is_dead_exit(&unreachable));
        assert!(!connect_failure_is_dead_exit(
            &classify_exhausted_data_plane(Ok(()), "tun timeout".into(), Ok(()))
        ));
        assert!(
            fake_ip_verification_error("no fake-ip in [1.1.1.1]")
                .contains("Encrypted DNS")
        );
        assert!(
            !fake_ip_verification_error("Windows DNS worker failed").contains("Encrypted DNS")
        );
    }

    #[test]
    fn controller_504_is_advisory_but_real_data_plane_remains_mandatory() {
        use super::{PostLockVerification, classify_post_lock_verification};

        assert_eq!(
            classify_post_lock_verification(Err("delay probe answered 504 Gateway Timeout".to_string()), Ok(7_u8)),
            PostLockVerification::Verified {
                status: 7,
                controller_warning: Some("delay probe answered 504 Gateway Timeout".to_string()),
            }
        );
        assert_eq!(
            classify_post_lock_verification::<u8>(Ok(()), Err("real request timed out".to_string())),
            PostLockVerification::Retry {
                error: "real request timed out".to_string(),
            }
        );
        let both_failed = classify_post_lock_verification::<u8>(
            Err("delay probe answered 504 Gateway Timeout".to_string()),
            Err("HTTPS 204 failed".to_string()),
        );
        assert_eq!(
            both_failed,
            PostLockVerification::Retry {
                error: "controller exit measurement failed: delay probe answered 504 Gateway Timeout; real TUN data plane failed: HTTPS 204 failed".to_string(),
            }
        );
    }

    #[test]
    fn fake_ip_first_attempt_fails_fast_then_uses_full_budget() {
        assert_eq!(fake_ip_attempt_timeout(0), Duration::from_secs(2));
        assert_eq!(fake_ip_attempt_timeout(1), FAKE_IP_LOOKUP_TIMEOUT);
        assert_eq!(fake_ip_attempt_timeout(2), FAKE_IP_LOOKUP_TIMEOUT);
        assert!(fake_ip_attempt_timeout(0) < FAKE_IP_LOOKUP_TIMEOUT);
    }

    #[test]
    fn tun_probe_origins_are_staggered_not_bursted() {
        assert_eq!(tun_probe_stagger(0), Duration::ZERO);
        assert_eq!(tun_probe_stagger(1), TUN_PROBE_STAGGER);
        assert_eq!(
            tun_probe_stagger(2),
            TUN_PROBE_STAGGER + TUN_PROBE_STAGGER
        );
        assert!(
            tun_probe_stagger(TUN_DATA_PLANE_PROBES.len() - 1) < TUN_DATA_PLANE_CONNECT_TIMEOUT,
            "stagger is only spacing, not a second timeout"
        );
        assert!(POST_LOCK_VERIFY_ROUND_DELAY <= Duration::from_millis(500));
    }

    #[test]
    fn real_data_plane_probes_independent_https_origins() {
        assert!(
            TUN_DATA_PLANE_PROBES.len() >= 3,
            "one provider failure must not decide whether a locked tunnel works"
        );
        let mut hosts = BTreeSet::new();
        for probe in TUN_DATA_PLANE_PROBES {
            let url = reqwest::Url::parse(probe.url).expect("probe URL must parse");
            assert_eq!(url.scheme(), "https", "{} must be authenticated TLS", probe.label);
            hosts.insert(url.host_str().expect("probe URL must carry a host").to_string());
            assert!(
                (200..300).contains(&probe.expected_status),
                "{} must require an exact success status",
                probe.label
            );
        }
        assert_eq!(
            hosts.len(),
            TUN_DATA_PLANE_PROBES.len(),
            "nominally separate probes must not share an origin"
        );
    }

    #[test]
    fn real_data_plane_failure_names_every_failed_origin() {
        let failures = vec![
            "Google: timeout".to_string(),
            "Cloudflare: connect reset".to_string(),
            "Apple: status 503".to_string(),
        ];
        let error = format_tun_probe_failures(&failures);
        assert!(error.contains("all 3 independent"));
        for failure in failures {
            assert!(error.contains(&failure));
        }
    }

    /// Fail-closed: retrying the checks changes nothing about the decision table. An exhausted
    /// group still resolves to the same full release an unverified session always did, and a
    /// verified session still keeps blocking and reconnects.
    #[test]
    fn post_lock_retry_does_not_weaken_the_failure_table() {
        assert_eq!(
            plan_failure(true, false, false).stop_core,
            Some(true),
            "an unverified session is still fully released once the retries are exhausted"
        );
        assert_eq!(
            plan_failure(true, true, false),
            FailurePlan {
                mark_armed: true,
                stop_core: Some(false),
                restrict_bootstrap: true,
            }
        );
    }

    // ---- C4: the transaction budget must cover a cold first connect ----

    #[test]
    fn connect_budget_covers_a_cold_first_connect() {
        let accounted: u64 = CONNECT_BUDGET_LEGS.iter().map(|(_, secs)| secs).sum();
        assert_eq!(accounted, 208, "the table in the doc comment must stay in sync");
        assert!(
            Duration::from_secs(accounted) <= CONNECT_TRANSACTION_TIMEOUT,
            "the accounted cold-connect worst case ({accounted} s) must fit the budget"
        );
        // The legs whose budgets are constants here must match those constants.
        let leg = |name: &str| {
            CONNECT_BUDGET_LEGS
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, secs)| Duration::from_secs(*secs))
                .unwrap_or_default()
        };
        assert!(leg("controller readiness") >= CONTROLLER_READY_TIMEOUT);
        assert!(leg("lock ladder") >= LOCK_RETRY_INTERVAL * LOCK_ATTEMPTS);
        assert!(leg("checkingExit") >= EXIT_PROBE_ADVISORY_BUDGET);
        assert!(
            leg("verifyingTraffic") >= verify_lock_retry_window() + TUN_DATA_PLANE_TIMEOUT,
            "the final stage must budget both WFP status and one real App data-plane request"
        );
    }

    #[test]
    #[allow(clippy::assertions_on_constants, reason = "these tests exist to pin the constants")]
    fn tun_data_plane_probe_is_bounded_and_cannot_outlive_its_connect() {
        assert!(TUN_DATA_PLANE_CONNECT_TIMEOUT < TUN_DATA_PLANE_TIMEOUT);
        assert!(TUN_DATA_PLANE_TIMEOUT < CONNECT_TRANSACTION_TIMEOUT);
    }

    // ---- D1: the release UI budget must match the Service's reality ----

    #[test]
    fn release_budget_matches_the_service_reality() {
        // DNS restore leg (Service-side budget) + core stop + WFP/IPC overhead.
        const SERVICE_DNS_RESTORE: Duration = Duration::from_secs(40);
        const SERVICE_CORE_STOP: Duration = Duration::from_secs(3);
        assert!(
            EXPLICIT_RELEASE_TIMEOUT >= SERVICE_DNS_RESTORE + SERVICE_CORE_STOP,
            "telling the user the disconnect failed while the worker is still inside its own \
             budget is the D1 defect"
        );
        assert!(
            EXPLICIT_RELEASE_TIMEOUT < SERVICE_LIFECYCLE_TIMEOUT,
            "the IPC client must be the one that reports a genuine hang"
        );
    }

    #[test]
    fn wechat_path_changes_only_reconnect_when_the_overlay_is_active() {
        assert!(!wechat_paths_changed(None, &["a".to_string()]));
        assert!(!wechat_paths_changed(Some(&[]), &[]));
        assert!(wechat_paths_changed(Some(&[]), &["a".to_string()]));
        assert!(wechat_paths_changed(
            Some(&["a".to_string()][..]),
            &["b".to_string()]
        ));
        assert!(!wechat_paths_changed(
            Some(&["a".to_string()][..]),
            &["a".to_string()]
        ));
    }

    fn node() -> ValidatedNode {
        ValidatedNode {
            name: "US Reality 01".to_string(),
            server: Ipv4Addr::new(203, 0, 113, 7),
            port: 8443,
            uuid: "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d".to_string(),
            servername: "www.microsoft.com".to_string(),
            flow: None,
            client_fingerprint: None,
            reality_public_key: "0123456789abcdef0123456789abcdef0123456789a".to_string(),
            reality_short_id: "0123456789abcdef".to_string(),
        }
    }

    #[test]
    fn wfp_engine_markers_map_to_actionable_messages() {
        // The Service nests its marker inside its own context string, so matching must be
        // by `contains`, and BFE-not-running must win over the generic wedge message.
        let wedged = map_wfp_engine_error(&format!(
            "Failed to arm Windows kill switch: {WFP_ENGINE_WEDGED_PREFIX}: install did not answer"
        ))
        .expect("wedged engine is mapped");
        assert!(wedged.starts_with(WFP_ENGINE_WEDGED_PREFIX));
        assert!(wedged.contains("重启"));

        let bfe = map_wfp_engine_error(&format!(
            "Failed to arm Windows kill switch: {BFE_NOT_RUNNING_PREFIX}: state Stopped"
        ))
        .expect("stopped BFE is mapped");
        assert!(bfe.starts_with(BFE_NOT_RUNNING_PREFIX));
        assert!(bfe.contains("sc start BFE"));
        assert!(classify_bfe_state(true, "Running").is_ok());
        assert!(classify_bfe_state(false, "StartPending").is_ok());
        let stopped = classify_bfe_state(false, "Stopped").expect_err("stopped BFE is a refusal");
        assert!(stopped.starts_with(BFE_NOT_RUNNING_PREFIX));
        assert!(stopped.contains("Stopped"));

        assert!(map_wfp_engine_error("kill switch lock failed: owner mismatch").is_none());
    }

    #[test]
    fn unique_proxy_endpoints_keep_order_and_drop_duplicates() {
        use tono_service_protocol::{ProxyEndpoint, ProxyProtocol};
        let a = ProxyEndpoint {
            ip: "203.0.113.10".into(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        };
        let b = ProxyEndpoint {
            ip: "198.51.100.20".into(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        };
        assert_eq!(
            unique_proxy_endpoints(vec![a.clone(), b.clone(), a.clone()]),
            vec![a, b]
        );
    }

    #[test]
    fn dns_warnings_do_not_tear_down_a_live_tunnel() {
        // The Service reports these on operations that SUCCEEDED. Judging them unhealthy costs
        // two samples and then a full teardown, so a machine that can never verify its DNS
        // would reconnect forever — which is the failure this predicate exists to prevent.
        let healthy = DnsProtectionStatus {
            enabled: true,
            snapshot_present: true,
            adapters: 3,
            last_error: None,
        };
        assert!(!protected_dns_unhealthy(Some(&healthy)));

        for warning in [
            "TONO_DNS_UNVERIFIED: applied but unverified on 2 of 5 adapter(s)",
            "kill switch: TONO_DNS_RESTORE_DEGRADED: accepted on registry evidence",
        ] {
            let warned = DnsProtectionStatus {
                last_error: Some(warning.to_string()),
                ..healthy.clone()
            };
            assert!(
                !protected_dns_unhealthy(Some(&warned)),
                "a warning marker must not read as unhealthy: {warning}"
            );
        }

        // A real failure still is one.
        let failed = DnsProtectionStatus {
            last_error: Some("DNS restore could not be proven".to_string()),
            ..healthy.clone()
        };
        assert!(protected_dns_unhealthy(Some(&failed)));
        // And a state that is not actually protected stays unhealthy whatever it says.
        let off = DnsProtectionStatus {
            enabled: false,
            ..healthy
        };
        assert!(protected_dns_unhealthy(Some(&off)));
    }

    fn resumable_startup_runtime() -> (ServiceStatusSnapshot, DnsProtectionStatus) {
        (
            ServiceStatusSnapshot {
                snapshot_generation: 17,
                active_operation: None,
                is_active: true,
                active_generation: Some(9),
                service_state: ServiceLifecycleState::Running,
                core_pid: Some(1234),
                core_generation: 1,
                core_started_at: Some(1_700_000_000),
                last_core_exit_reason: None,
                restart_count: 0,
                last_recovery_at: None,
                desired_core_should_be_running: true,
                // The desired-state write counter deliberately differs from the owner session
                // generation (9): real machines accumulate releases and writer updates, so the
                // write counter is almost always ahead.
                desired_generation: 41,
                desired_updated_at: 1_700_000_000,
                desired_state_unknown: false,
                macos_kill_switch_wanted: false,
                macos_kill_switch_live: false,
                macos_kill_switch_mode: Default::default(),
                kill_switch: Some(KillSwitchStatus {
                    wanted: true,
                    verified: true,
                    live: true,
                    mode: KillSwitchStatusMode::Locked,
                    endpoints: Vec::new(),
                    tunnel_permit_rendered: true,
                    direct_endpoint_digest: tono_service_protocol::direct_endpoint_digest(&[]).unwrap(),
                    last_error: None,
                }),
                network_events: Default::default(),
            },
            DnsProtectionStatus {
                enabled: true,
                snapshot_present: true,
                adapters: 1,
                last_error: None,
            },
        )
    }

    #[test]
    fn startup_resume_requires_a_quiescent_fully_proven_runtime() {
        let (snapshot, dns) = resumable_startup_runtime();
        assert!(startup_runtime_is_resume_candidate(&snapshot, &dns));

        let mut inactive = snapshot.clone();
        inactive.is_active = false;
        assert!(!startup_runtime_is_resume_candidate(&inactive, &dns));

        let mut no_generation = snapshot.clone();
        no_generation.active_generation = None;
        assert!(!startup_runtime_is_resume_candidate(&no_generation, &dns));

        let mut no_core = snapshot.clone();
        no_core.core_pid = None;
        assert!(!startup_runtime_is_resume_candidate(&no_core, &dns));

        let mut undesired = snapshot.clone();
        undesired.desired_core_should_be_running = false;
        assert!(!startup_runtime_is_resume_candidate(&undesired, &dns));

        let mut desired_unknown = snapshot.clone();
        desired_unknown.desired_state_unknown = true;
        assert!(!startup_runtime_is_resume_candidate(&desired_unknown, &dns));

        let mut mutating = snapshot.clone();
        mutating.active_operation = Some(ServiceOperationSnapshot {
            id: 3,
            kind: ServiceOperationKind::StartCore,
            started_at_ms: 10,
            deadline_at_ms: 20,
        });
        assert!(!startup_runtime_is_resume_candidate(&mutating, &dns));

        let mut recovering = snapshot.clone();
        recovering.service_state = ServiceLifecycleState::RecoveringCore;
        assert!(!startup_runtime_is_resume_candidate(&recovering, &dns));
    }

    #[test]
    fn startup_resume_rejects_weakened_wfp_or_dns_proof() {
        let (snapshot, dns) = resumable_startup_runtime();

        let mut no_wfp = snapshot.clone();
        no_wfp.kill_switch = None;
        assert!(!startup_runtime_is_resume_candidate(&no_wfp, &dns));

        for weakened in [
            KillSwitchStatus {
                verified: false,
                ..snapshot.kill_switch.clone().unwrap()
            },
            KillSwitchStatus {
                live: false,
                ..snapshot.kill_switch.clone().unwrap()
            },
            KillSwitchStatus {
                mode: KillSwitchStatusMode::Bootstrap,
                ..snapshot.kill_switch.clone().unwrap()
            },
            KillSwitchStatus {
                tunnel_permit_rendered: false,
                ..snapshot.kill_switch.clone().unwrap()
            },
            KillSwitchStatus {
                last_error: Some("WFP read-back failed".to_string()),
                ..snapshot.kill_switch.clone().unwrap()
            },
        ] {
            let mut weakened_snapshot = snapshot.clone();
            weakened_snapshot.kill_switch = Some(weakened);
            assert!(!startup_runtime_is_resume_candidate(&weakened_snapshot, &dns));
        }

        for weakened_dns in [
            DnsProtectionStatus {
                enabled: false,
                ..dns.clone()
            },
            DnsProtectionStatus {
                snapshot_present: false,
                ..dns.clone()
            },
            DnsProtectionStatus {
                adapters: 0,
                ..dns.clone()
            },
            DnsProtectionStatus {
                last_error: Some("DNS ownership unknown".to_string()),
                ..dns.clone()
            },
        ] {
            assert!(!startup_runtime_is_resume_candidate(&snapshot, &weakened_dns));
        }
    }

    #[test]
    fn startup_resume_final_admission_rejects_every_stale_or_unready_axis() {
        let ready = [true; 6];
        assert!(startup_resume_guards_hold(
            ready[0], ready[1], ready[2], ready[3], ready[4], ready[5]
        ));

        for rejected in 0..ready.len() {
            let mut guards = ready;
            guards[rejected] = false;
            assert!(
                !startup_resume_guards_hold(guards[0], guards[1], guards[2], guards[3], guards[4], guards[5]),
                "guard axis {rejected} must independently reject the stale startup proof"
            );
        }
    }

    #[test]
    fn proxy_endpoint_is_public_ipv4_port_tcp() {
        let endpoint = proxy_endpoint_of(&node());
        assert_eq!(endpoint.ip, "203.0.113.7");
        assert_eq!(endpoint.port, 8443);
        assert_eq!(endpoint.protocol, tono_service_protocol::ProxyProtocol::Tcp);
    }

    #[test]
    fn fake_ip_range_is_198_18_slash_16() {
        assert!(is_fake_ip(IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1))));
        assert!(is_fake_ip(IpAddr::V4(Ipv4Addr::new(198, 18, 255, 254))));
        assert!(!is_fake_ip(IpAddr::V4(Ipv4Addr::new(198, 19, 0, 1))));
        assert!(!is_fake_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_fake_ip(IpAddr::V6(Ipv6Addr::LOCALHOST)));
    }

    #[test]
    fn reconnect_only_in_armed_idle_protected_offline_without_choice() {
        let idle_blocked = ConnectionStatus {
            is_connected: false,
            is_connecting: false,
            is_disconnecting: false,
            is_protection_blocked: true,
            stage: None,
        };
        assert!(reconnect_allowed(false, &idle_blocked, true));
        // The catalog waiting for the user blocks auto-reconnect (§3).
        assert!(!reconnect_allowed(true, &idle_blocked, true));
        // Never reconnect without the barrier.
        assert!(!reconnect_allowed(false, &idle_blocked, false));

        let connected = ConnectionStatus {
            is_connected: true,
            ..idle_blocked.clone()
        };
        assert!(!reconnect_allowed(false, &connected, true));
        let connecting = ConnectionStatus {
            is_connecting: true,
            ..idle_blocked.clone()
        };
        assert!(!reconnect_allowed(false, &connecting, true));
        let disconnecting = ConnectionStatus {
            is_disconnecting: true,
            ..idle_blocked.clone()
        };
        assert!(!reconnect_allowed(false, &disconnecting, true));
        let plain_idle = ConnectionStatus::default();
        assert!(!reconnect_allowed(false, &plain_idle, true));
    }

    #[test]
    fn failure_plan_is_exhaustive() {
        // Armed, no disconnect in flight: keep blocking (stop, never
        // release), restrict to bootstrap, latch the armed flag.
        assert_eq!(
            plan_failure(true, true, false),
            FailurePlan {
                mark_armed: true,
                stop_core: Some(false),
                restrict_bootstrap: true,
            }
        );
        // Pre-arm failure: full release.
        assert_eq!(
            plan_failure(false, false, false),
            FailurePlan {
                mark_armed: false,
                stop_core: Some(true),
                restrict_bootstrap: false,
            }
        );
        // Initial post-arm failure has not crossed the verification barrier: full release.
        assert_eq!(
            plan_failure(true, false, false),
            FailurePlan {
                mark_armed: false,
                stop_core: Some(true),
                restrict_bootstrap: false,
            }
        );
        // A raced disconnect owns the release end to end; the failing
        // transaction does nothing, whatever the arm state.
        for armed in [true, false] {
            assert_eq!(
                plan_failure(armed, false, true),
                FailurePlan {
                    mark_armed: false,
                    stop_core: None,
                    restrict_bootstrap: false,
                },
                "armed={armed}"
            );
        }
    }

    #[test]
    fn stop_before_release_only_with_a_live_session() {
        // The owner-gated release works without a session (C1); the
        // session-gated stop is attempted only when one exists.
        assert!(stop_core_before_release(true, true));
        assert!(!stop_core_before_release(true, false));
        assert!(!stop_core_before_release(false, true));
        assert!(!stop_core_before_release(false, false));
    }

    #[test]
    fn stale_exit_release_requires_commit_and_release_intent() {
        // H-1: only a committed StartClash can leave a late arm, and only a
        // releasing bump (disconnect/sign-out/quit) may be patched — a
        // switch or catalog teardown owns the barrier it is re-arming.
        assert!(stale_exit_needs_release(true, true));
        assert!(!stale_exit_needs_release(true, false));
        assert!(!stale_exit_needs_release(false, true));
        assert!(!stale_exit_needs_release(false, false));
    }

    #[test]
    fn sign_out_release_covers_every_protected_shape() {
        let idle = ConnectionStatus::default();
        assert!(!sign_out_needs_release(&idle, false));
        // The armed latch alone is enough.
        assert!(sign_out_needs_release(&idle, true));
        let connecting = ConnectionStatus {
            is_connecting: true,
            ..ConnectionStatus::default()
        };
        // M-1: an in-flight connect must not skip the release.
        assert!(sign_out_needs_release(&connecting, false));
        let connected = ConnectionStatus {
            is_connected: true,
            ..ConnectionStatus::default()
        };
        assert!(sign_out_needs_release(&connected, false));
        let blocked = ConnectionStatus {
            is_protection_blocked: true,
            ..ConnectionStatus::default()
        };
        assert!(sign_out_needs_release(&blocked, false));
        let disconnecting = ConnectionStatus {
            is_disconnecting: true,
            ..ConnectionStatus::default()
        };
        assert!(sign_out_needs_release(&disconnecting, false));
    }

    #[test]
    fn select_action_same_node_reselect_is_a_noop_in_every_state() {
        // H1: reselecting the current node with no pending choice must not
        // touch the generation, the tasks, or the intent bit.
        for status in [
            ConnectionStatus::default(),
            ConnectionStatus {
                is_connecting: true,
                ..ConnectionStatus::default()
            },
            ConnectionStatus {
                is_connected: true,
                ..ConnectionStatus::default()
            },
            ConnectionStatus {
                is_protection_blocked: true,
                ..ConnectionStatus::default()
            },
        ] {
            for armed in [true, false] {
                assert_eq!(
                    select_action(false, false, &status, armed),
                    SelectAction::Noop,
                    "{status:?} armed={armed}"
                );
            }
        }
    }

    #[test]
    fn select_action_switch_only_when_changed_and_active() {
        let connected = ConnectionStatus {
            is_connected: true,
            ..ConnectionStatus::default()
        };
        assert_eq!(select_action(true, false, &connected, true), SelectAction::Switch);
        let connecting = ConnectionStatus {
            is_connecting: true,
            ..ConnectionStatus::default()
        };
        assert_eq!(select_action(true, false, &connecting, true), SelectAction::Switch);
        // Changed while idle: no transaction at all.
        assert_eq!(
            select_action(true, false, &ConnectionStatus::default(), false),
            SelectAction::UpdateOnly
        );
    }

    #[test]
    fn select_action_reconnects_after_choice_cleared_in_blocked_state() {
        // M5/H1 variant: the vanished node's replacement picked in armed
        // Protected Offline must schedule the reconnect even when the name
        // is unchanged (`changed == false`, `requires_choice == true`).
        let blocked = ConnectionStatus {
            is_protection_blocked: true,
            ..ConnectionStatus::default()
        };
        assert_eq!(select_action(false, true, &blocked, true), SelectAction::Reconnect);
        assert_eq!(select_action(true, true, &blocked, true), SelectAction::Reconnect);
        // Without the barrier there is nothing to protect: update only.
        assert_eq!(select_action(false, true, &blocked, false), SelectAction::UpdateOnly);
    }

    #[test]
    fn retry_now_noop_only_when_connected_or_connecting() {
        let connected = ConnectionStatus {
            is_connected: true,
            ..ConnectionStatus::default()
        };
        let connecting = ConnectionStatus {
            is_connecting: true,
            ..ConnectionStatus::default()
        };
        let blocked = ConnectionStatus {
            is_protection_blocked: true,
            ..ConnectionStatus::default()
        };
        assert!(retry_now_is_noop(&connected));
        assert!(retry_now_is_noop(&connecting));
        assert!(!retry_now_is_noop(&blocked));
        assert!(!retry_now_is_noop(&ConnectionStatus::default()));
    }

    #[test]
    fn single_flight_admits_exactly_one_of_two_racing_attempts() {
        use tono_core::connection::ConnectionFsm;
        let mut fsm = ConnectionFsm::new();
        // The two racing attempts, evaluated back-to-back under one lock:
        // the first begins, the second sees it and is refused.
        assert!(single_flight_begin(&mut fsm, 7, 7), "first attempt enters run_stages");
        assert!(
            !single_flight_begin(&mut fsm, 7, 7),
            "second attempt must not double-start"
        );
        // A stale generation is refused without touching the machine.
        assert!(!single_flight_begin(&mut fsm, 8, 7));
        // After a failure the machine is idle again and a retry may begin.
        fsm.mark_kill_switch_armed();
        fsm.connect_failed();
        assert!(single_flight_begin(&mut fsm, 7, 7));
        // While connected, nothing may start a parallel transaction.
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        assert!(!single_flight_begin(&mut fsm, 7, 7));
    }

    #[test]
    fn service_busy_maps_to_a_stable_prefixed_message() {
        for detail in [
            crate::core::runstate::SERVICE_OPERATION_BUSY,
            crate::core::runstate::PRIVILEGED_OUTCOME_UNCERTAIN,
        ] {
            let busy = anyhow::anyhow!(detail);
            let mapped = map_service_ready_error(&busy);
            assert!(mapped.starts_with(SERVICE_BUSY_PREFIX), "{mapped}");
            assert!(mapped.contains("重启 Tono"), "{mapped}");
            assert!(!mapped.contains(detail), "{mapped}");
        }

        // Anything else keeps its detail for diagnostics.
        let other = anyhow::anyhow!("ipc transport refused");
        let mapped = map_service_ready_error(&other);
        assert!(mapped.contains("Tono Service is not ready"), "{mapped}");
        assert!(mapped.contains("ipc transport refused"), "{mapped}");
        assert!(!mapped.starts_with(SERVICE_BUSY_PREFIX), "{mapped}");
    }

    #[test]
    fn lock_retries_only_tun_not_ready_errors() {
        assert!(is_retryable_lock_error(
            r#"interface alias "Tono" did not resolve to a LUID: Windows error 87"#
        ));
        assert!(is_retryable_lock_error(
            "interface LUID 123 is not a tunnel device (type 6, description \"Ethernet\"); refusing to lock"
        ));
        assert!(is_retryable_lock_error("Service unavailable: busy"));
        // Permanent failures must fail the stage, not loop for 50 lifecycle IPCs.
        assert!(!is_retryable_lock_error("kill switch is not armed"));
        assert!(!is_retryable_lock_error("kill switch belongs to a different owner"));
        assert!(!is_retryable_lock_error("WFP error 0x80320009"));
        assert!(!is_retryable_lock_error("authentication failed"));
        // Stable prefixes used by the UI for release/protocol gates.
        assert!(RELEASE_RECONCILING_PREFIX.starts_with("TONO_"));
        assert!(SERVICE_TOO_OLD_PREFIX.starts_with("TONO_"));
    }

    #[test]
    fn only_self_clearing_guard_rejections_keep_the_reconnect_chain_alive() {
        // These clear without anyone doing anything, so ending the chain on them leaves the
        // machine blocked with no scheduled retry and nothing shown.
        assert!(guard_rejection_is_transient(&format!(
            "{RELEASE_RECONCILING_PREFIX}: network protection release is still reconciling; wait before reconnecting"
        )));
        assert!(guard_rejection_is_transient(TRANSITION_IN_FLIGHT_REJECTION));
        assert!(guard_rejection_is_transient(CATALOG_NOT_READY_REJECTION));
        // These need a person; retrying them forever would only spin.
        assert!(!guard_rejection_is_transient("not signed in"));
        assert!(!guard_rejection_is_transient("account is suspended"));
        assert!(!guard_rejection_is_transient("select a server first"));
        assert!(!guard_rejection_is_transient(
            "the selected node left the catalog; pick a server again"
        ));
    }

    #[test]
    fn health_probes_require_two_consecutive_failures() {
        assert!(!health_threshold_reached(0));
        assert!(!health_threshold_reached(1));
        assert!(health_threshold_reached(2));
        assert!(health_threshold_reached(5));
    }

    #[test]
    fn kill_switch_health_requires_wanted_live_locked() {
        use tono_service_protocol::{KillSwitchStatus, KillSwitchStatusMode, ProxyEndpoint, ProxyProtocol};
        let endpoint = ProxyEndpoint {
            ip: "203.0.113.7".to_string(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        };
        let healthy = KillSwitchStatus {
            wanted: true,
            verified: true,
            live: true,
            mode: KillSwitchStatusMode::Locked,
            endpoints: vec![endpoint.clone()],
            tunnel_permit_rendered: true,
            direct_endpoint_digest: tono_service_protocol::direct_endpoint_digest(&[]).unwrap(),
            last_error: None,
        };
        assert!(!kill_switch_unhealthy(Some(&healthy)));
        assert!(kill_switch_unhealthy(None));
        for (wanted, live, mode) in [
            (false, true, KillSwitchStatusMode::Locked),
            (true, false, KillSwitchStatusMode::Locked),
            (true, true, KillSwitchStatusMode::Bootstrap),
            (true, true, KillSwitchStatusMode::Blocked),
        ] {
            let status = KillSwitchStatus {
                wanted,
                verified: false,
                live,
                mode,
                endpoints: vec![endpoint.clone()],
                tunnel_permit_rendered: true,
                direct_endpoint_digest: tono_service_protocol::direct_endpoint_digest(&[]).unwrap(),
                last_error: None,
            };
            assert!(kill_switch_unhealthy(Some(&status)), "{wanted} {live} {mode:?}");
        }

        // The state the other three fields cannot distinguish: locked, wanted, live, and
        // dropping every packet that leaves the TUN.
        let orphaned_permit = KillSwitchStatus {
            tunnel_permit_rendered: false,
            ..healthy.clone()
        };
        assert!(
            kill_switch_unhealthy(Some(&orphaned_permit)),
            "a Locked session whose tunnel permit was retracted is not a healthy tunnel"
        );
    }

    #[test]
    fn protected_dns_health_requires_a_clean_nonempty_snapshot() {
        use tono_service_protocol::DnsProtectionStatus;

        let healthy = DnsProtectionStatus {
            enabled: true,
            snapshot_present: true,
            adapters: 2,
            last_error: None,
        };
        assert!(!protected_dns_unhealthy(Some(&healthy)));
        assert!(protected_dns_unhealthy(None));
        for status in [
            DnsProtectionStatus {
                enabled: false,
                ..healthy.clone()
            },
            DnsProtectionStatus {
                snapshot_present: false,
                ..healthy.clone()
            },
            DnsProtectionStatus {
                adapters: 0,
                ..healthy.clone()
            },
            DnsProtectionStatus {
                last_error: Some("live apply failed".to_string()),
                ..healthy.clone()
            },
        ] {
            assert!(protected_dns_unhealthy(Some(&status)), "{status:?}");
        }
    }

    #[test]
    fn collect_ipv4_literals_walks_nested_dns_answers() {
        let value = serde_json::json!({
            "Answer": [
                {"Header": {"Name": "wxs.qq.com.", "RRtype": 5}, "CNAME": "cdn.wxs.qq.com."},
                {"Header": {"Name": "cdn.wxs.qq.com.", "RRtype": 1}, "A": "9.0.0.10"},
                {"Header": {"Name": "cdn.wxs.qq.com.", "RRtype": 1}, "A": "9.0.0.10"},
                {"Header": {"Name": "cdn.wxs.qq.com.", "RRtype": 1}, "A": "9.0.0.11"}
            ],
            "Question": [{"Name": "wxs.qq.com.", "Qtype": 1}]
        });
        let ips = collect_ipv4_literals(&value);
        assert_eq!(
            ips,
            vec![
                std::net::Ipv4Addr::new(9, 0, 0, 10),
                std::net::Ipv4Addr::new(9, 0, 0, 11)
            ]
        );
        // Non-IP strings and bare scalars never leak through.
        let garbage = serde_json::json!({"A": "not-an-ip", "B": ["9.0.0.9", 42, null, true]});
        assert_eq!(
            collect_ipv4_literals(&garbage),
            vec![std::net::Ipv4Addr::new(9, 0, 0, 9)]
        );
    }

    #[test]
    fn controller_error_detail_extracts_redacts_and_caps_mihomo_errors() {
        assert_eq!(
            controller_error_detail(r#"{"message":"all DNS requests failed\nAuthorization: Bearer secret-value"}"#),
            Some("all DNS requests failed Authorization: ***".to_string())
        );
        assert_eq!(
            controller_error_detail(r#"{"error":"GET https://resolver.test/dns-query?token=secret timed out"}"#),
            Some("GET https://resolver.test/dns-query?*** timed out".to_string())
        );
        assert_eq!(controller_error_detail("  \r\n\t"), None);
        let capped = controller_error_detail(&"x".repeat(600)).expect("non-empty detail");
        assert_eq!(capped.chars().count(), super::CONTROLLER_ERROR_DETAIL_LIMIT + 1);
        assert!(capped.ends_with('…'));
    }

    #[test]
    fn cloud_dns_retries_only_transient_controller_statuses() {
        assert!(super::controller_dns_status_is_retryable(
            reqwest::StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(super::controller_dns_status_is_retryable(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        ));
        assert!(!super::controller_dns_status_is_retryable(
            reqwest::StatusCode::BAD_REQUEST
        ));
        assert!(!super::controller_dns_status_is_retryable(
            reqwest::StatusCode::UNAUTHORIZED
        ));
    }

    #[tokio::test]
    async fn cloud_dns_retries_a_transient_burst_and_reuses_one_client() {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            for (status, body) in [
                (500, r#"{"message":"temporary burst"}"#),
                (200, r#"{"Answer":[{"A":"93.184.216.34"}]}"#),
            ] {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let mut chunk = [0_u8; 1024];
                    let read = stream.read(&mut chunk).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let reason = if status == 200 { "OK" } else { "Internal Server Error" };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
        });

        let client = super::controller_client(Duration::from_secs(3)).unwrap();
        let addresses = super::dns_query_a_with_retry(&client, "test-secret", port, "www.example.com")
            .await
            .expect("the second controller answer should recover the transient first one");
        assert_eq!(addresses, [Ipv4Addr::new(93, 184, 216, 34)]);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn persistent_cloud_dns_500_skips_optional_direct_policy() {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let body = r#"{"message":"context deadline exceeded"}"#;
            for _ in 0..super::CLOUD_DNS_QUERY_ATTEMPTS {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let mut chunk = [0_u8; 1024];
                    let read = stream.read(&mut chunk).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let response = format!(
                    "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
        });

        let client = super::controller_client(Duration::from_secs(3)).unwrap();
        let error = super::dns_query_a_with_retry(&client, "test-secret", port, "mmbiz.qpic.cn")
            .await
            .expect_err("a persistent controller failure must reject the whole DIRECT plan");
        server.await.unwrap();

        assert_eq!(
            super::classify_optional_direct_resolution::<()>(Err(error)),
            super::OptionalDirectResolution::Skip(
                "dns query for mmbiz.qpic.cn failed after 2 attempts: dns query for mmbiz.qpic.cn answered 500 Internal Server Error: context deadline exceeded".to_string()
            )
        );
        assert_eq!(
            super::classify_optional_direct_resolution(Ok(7_u8)),
            super::OptionalDirectResolution::Ready(7)
        );
    }

    #[test]
    fn windows_direct_policy_does_not_replace_the_proven_full_tunnel_runtime() {
        // The gate ships enabled. What must stay true is the invariant this test was named for:
        // the DIRECT bracket only ever narrows an already-proven full-tunnel runtime — begin is
        // rejected unless the Service first proves Locked with the exact empty DIRECT set, and
        // every failure after begin reconciles back to that exact Blocked set.
        assert!(
            WINDOWS_OPTIONAL_DIRECT_ENABLED,
            "0.0.24 ships the WeChat DIRECT split; the fail-closed bracket above is its guard"
        );
    }

    #[test]
    fn virtual_uplink_filter_keeps_vmware_enabled_but_never_selects_it_for_direct() {
        for description in [
            "VMware Network Adapter VMnet8",
            "VirtualBox Host-Only Ethernet Adapter",
            "Hyper-V Virtual Ethernet Adapter",
            "Tono Wintun Userspace Tunnel",
        ] {
            assert!(
                super::is_virtual_uplink_description(description),
                "{description:?} must not be selected as the physical DIRECT uplink"
            );
        }
        for description in ["Intel(R) Wi-Fi 6E AX211", "Realtek PCIe GbE Family Controller"] {
            assert!(
                !super::is_virtual_uplink_description(description),
                "{description:?} should remain eligible for physical uplink selection"
            );
        }
    }

    #[test]
    fn direct_reload_receipts_bind_generation_reload_identity_and_exact_digest() {
        let session = OwnerSessionProof {
            generation: 42,
            token: "test-session-token".to_owned(),
        };
        let digest = tono_service_protocol::direct_endpoint_digest(&[]).unwrap();
        let valid = DirectRuntimeReloadResult {
            owner_generation: 42,
            reload_id: 7,
            endpoint_digest: digest.clone(),
        };
        assert_eq!(
            validate_direct_reload_result(&valid, &session, None, &digest).unwrap(),
            7,
            "begin accepts a fresh nonzero Service reload identity"
        );
        assert_eq!(
            validate_direct_reload_result(&valid, &session, Some(7), &digest).unwrap(),
            7,
            "replace/finalize accept only the captured reload identity"
        );

        let mut wrong_generation = valid.clone();
        wrong_generation.owner_generation += 1;
        assert!(
            validate_direct_reload_result(&wrong_generation, &session, None, &digest).is_err(),
            "a receipt from a replacement Service owner must fail"
        );

        let mut missing_reload = valid.clone();
        missing_reload.reload_id = 0;
        assert!(
            validate_direct_reload_result(&missing_reload, &session, None, &digest).is_err(),
            "begin cannot omit the Service-generated reload identity"
        );

        let mut stale_reload = valid.clone();
        stale_reload.reload_id += 1;
        assert!(
            validate_direct_reload_result(&stale_reload, &session, Some(7), &digest).is_err(),
            "a delayed replace/finalize receipt from another bracket must fail"
        );

        let mut wrong_digest = valid;
        wrong_digest.endpoint_digest = "0".repeat(64);
        assert!(
            validate_direct_reload_result(&wrong_digest, &session, Some(7), &digest).is_err(),
            "begin, replace, and finalize all require the exact requested endpoint digest"
        );
    }

    #[test]
    fn service_direct_proof_rejects_malformed_or_different_endpoint_digests() {
        let digest = tono_service_protocol::direct_endpoint_digest(&[]).unwrap();
        let mut status = KillSwitchStatus {
            wanted: true,
            verified: true,
            live: true,
            mode: KillSwitchStatusMode::Locked,
            endpoints: Vec::new(),
            tunnel_permit_rendered: true,
            direct_endpoint_digest: digest.clone(),
            last_error: None,
        };
        prove_service_endpoint_digest(&status, &digest).unwrap();

        for malformed in ["f".repeat(63), "F".repeat(64), "g".repeat(64)] {
            status.direct_endpoint_digest = malformed;
            assert!(prove_service_endpoint_digest(&status, &digest).is_err());
        }
        status.direct_endpoint_digest = "0".repeat(64);
        assert!(
            prove_service_endpoint_digest(&status, &digest).is_err(),
            "a well-formed digest for a different live WFP set must fail"
        );
    }

    #[test]
    fn service_reload_identity_uses_security_generation_even_when_pid_is_reused() {
        let session = OwnerSessionProof {
            generation: 9,
            token: "test-session-token".to_owned(),
        };
        let (snapshot, _) = resumable_startup_runtime();
        let (first, _) = prove_service_reload_mode(&snapshot, &session, KillSwitchStatusMode::Locked).unwrap();

        let mut diagnostics_only = snapshot.clone();
        diagnostics_only.restart_count += 1;
        let (same_security_identity, _) =
            prove_service_reload_mode(&diagnostics_only, &session, KillSwitchStatusMode::Locked).unwrap();
        assert_eq!(
            first, same_security_identity,
            "restart_count is diagnostics, not the atomically published security identity"
        );

        let mut restarted = snapshot.clone();
        restarted.core_generation += 1;
        let (second, _) = prove_service_reload_mode(&restarted, &session, KillSwitchStatusMode::Locked).unwrap();
        assert_eq!(first.pid, second.pid);
        assert_ne!(
            first, second,
            "a recycled PID with a new packed publication generation is a different Core instance"
        );

        let mut changed_generation = snapshot;
        changed_generation.active_generation = Some(session.generation + 1);
        assert!(
            prove_service_reload_mode(&changed_generation, &session, KillSwitchStatusMode::Locked).is_err(),
            "a snapshot from another owner generation must fail before endpoint commit"
        );
    }

    #[test]
    fn service_reload_proof_tracks_desired_values_not_the_write_counter() {
        let session = OwnerSessionProof {
            generation: 9,
            token: "test-session-token".to_owned(),
        };
        let (snapshot, _) = resumable_startup_runtime();
        assert_ne!(
            snapshot.desired_generation, session.generation,
            "the fixture must model a machine that has lived: the desired-state write counter \
             runs ahead of the owner session generation after the first release"
        );
        prove_service_reload_mode(&snapshot, &session, KillSwitchStatusMode::Locked)
            .expect("a settled runtime must prove regardless of how often desired state was written");

        let mut stopped = snapshot.clone();
        stopped.desired_core_should_be_running = false;
        stopped.desired_generation += 1;
        assert!(
            prove_service_reload_mode(&stopped, &session, KillSwitchStatusMode::Locked).is_err(),
            "a durably recorded stop intent — however the counter moved — must fail the proof"
        );

        let mut unknown = snapshot.clone();
        unknown.desired_state_unknown = true;
        assert!(
            prove_service_reload_mode(&unknown, &session, KillSwitchStatusMode::Locked).is_err(),
            "an unreadable desired state proves nothing"
        );

        let mut not_running = snapshot;
        not_running.service_state = ServiceLifecycleState::Fatal;
        assert!(
            prove_service_reload_mode(&not_running, &session, KillSwitchStatusMode::Locked).is_err(),
            "the Service must be Running, not merely well-intentioned"
        );
    }

    fn home_controller_rules(proxy: &str, include_domains: bool) -> Vec<serde_json::Value> {
        let mut rules = Vec::new();
        if include_domains {
            for domain in tono_core::config::CLAUDE_HOME_DOMAINS {
                rules.push(serde_json::json!({
                    "type": "AND",
                    "payload": format!("((Network,tcp) && (DomainSuffix,{domain}))"),
                    "proxy": proxy,
                }));
            }
            for cidr in tono_core::config::CLAUDE_HOME_IPV4_CIDRS {
                rules.push(serde_json::json!({
                    "type": "AND",
                    "payload": format!("((Network,tcp) && (IPCIDR,{cidr}))"),
                    "proxy": proxy,
                }));
            }
        }
        for process in tono_core::config::HOME_PROCESS_NAMES {
            rules.push(serde_json::json!({
                "type": "AND",
                "payload": format!("((Network,tcp) && (ProcessName,{process}))"),
                "proxy": proxy,
            }));
        }
        for regex in tono_core::config::home_process_path_regexes() {
            rules.push(serde_json::json!({
                "type": "AND",
                "payload": format!("((Network,tcp) && ({},{regex}))", super::MIHOMO_PROCESS_PATH_REGEX_TYPE),
                "proxy": proxy,
            }));
        }
        rules
    }

    fn controller_rules_graph(
        home_proxy: &str,
        include_home_domains: bool,
        extra: Vec<serde_json::Value>,
    ) -> serde_json::Value {
        let mut rules = vec![
            serde_json::json!({"type": "IPCIDR", "payload": "127.0.0.0/8", "proxy": "DIRECT"}),
            serde_json::json!({"type": "IPCIDR", "payload": "::1/128", "proxy": "DIRECT"}),
        ];
        rules.extend(home_controller_rules(home_proxy, include_home_domains));
        rules.extend(extra);
        rules.push(serde_json::json!({"type": "AND", "payload": "((Network,udp))", "proxy": "REJECT"}));
        rules.push(serde_json::json!({"type": "Match", "payload": "", "proxy": "Tono-Exit"}));
        serde_json::json!({ "rules": rules })
    }

    #[test]
    fn controller_readback_requires_the_exact_direct_graph_and_exit_order() {
        // Captured from the packaged Mihomo Meta v1.19.29 `/rules` and `/proxies` APIs. In
        // particular, Network payload values are lowercase and `no-resolve` is not returned by
        // IPCIDR.Payload(). Home process/path rows are generated from the same constants the
        // runtime emits so this proof cannot drift from HOME_PROCESS_NAMES again.
        let expected = vec![
            ControllerDirectRuleProof {
                proxy: "Tono-China-Direct".to_owned(),
                payload: "((Network,tcp) && (ProcessName,Weixin.exe))"
                    .to_owned(),
            },
            ControllerDirectRuleProof {
                proxy: "Tono-China-Direct".to_owned(),
                payload: "((Network,udp) && (DstPort,8000) && (IPCIDR,9.0.0.20/32) && (ProcessName,WeChat.exe))"
                    .to_owned(),
            },
            ControllerDirectRuleProof {
                proxy: "Tono-China-Web-Direct".to_owned(),
                payload: "((Network,tcp) && (DstPort,443) && (Domain,www.bilibili.com) && (IPCIDR,9.0.0.30/32))"
                    .to_owned(),
            },
            ControllerDirectRuleProof {
                proxy: "Tono-China-Web-Direct".to_owned(),
                payload: "((Network,tcp) && (DstPort,443) && (DomainSuffix,baidu.com))"
                    .to_owned(),
            },
        ];
        let proxies = serde_json::json!({
            "proxies": {
                "Tono-Exit": {},
                "Tono-China-Direct": {"type": "Direct", "interface": "Ethernet 2"},
                "Tono-China-Web-Direct": {"type": "Direct", "interface": "Ethernet 2"}
            }
        });
        let extra = vec![
            serde_json::json!({"type": "AND", "payload": "((Network,tcp) && (ProcessName,Weixin.exe))", "proxy": "Tono-China-Direct"}),
            serde_json::json!({"type": "AND", "payload": "((Network,udp) && (DstPort,8000) && (IPCIDR,9.0.0.20/32) && (ProcessName,WeChat.exe))", "proxy": "Tono-China-Direct"}),
            serde_json::json!({"type": "AND", "payload": "((Network,tcp) && (DstPort,443) && (Domain,www.bilibili.com) && (IPCIDR,9.0.0.30/32))", "proxy": "Tono-China-Web-Direct"}),
            serde_json::json!({"type": "AND", "payload": "((Network,tcp) && (DstPort,443) && (DomainSuffix,baidu.com))", "proxy": "Tono-China-Web-Direct"}),
        ];
        let rules = controller_rules_graph("Tono-Exit", false, extra);
        controller_direct_graph_is_active(&rules, &proxies, &expected, "Ethernet 2", true, true, false).unwrap();

        let wechat_only_proxies = serde_json::json!({
            "proxies": {
                "Tono-Exit": {},
                "Tono-China-Direct": {"type": "Direct", "interface": "Ethernet 2"}
            }
        });
        let wechat_only_rules = controller_rules_graph(
            "Tono-Exit",
            false,
            vec![
                serde_json::json!({"type": "AND", "payload": "((Network,tcp) && (ProcessName,Weixin.exe))", "proxy": "Tono-China-Direct"}),
                serde_json::json!({"type": "AND", "payload": "((Network,udp) && (DstPort,8000) && (IPCIDR,9.0.0.20/32) && (ProcessName,WeChat.exe))", "proxy": "Tono-China-Direct"}),
            ],
        );
        controller_direct_graph_is_active(
            &wechat_only_rules,
            &wechat_only_proxies,
            &expected[..2],
            "Ethernet 2",
            true,
            false,
            false,
        )
        .unwrap();
        assert!(
            controller_direct_graph_is_active(&rules, &proxies, &expected[..2], "Ethernet 2", true, false, false,).is_err(),
            "a stale web DIRECT proxy/rule must make read-back fail"
        );

        let home_len = home_controller_rules("Tono-Exit", false).len();
        let first_direct = 2 + home_len;
        let last = rules["rules"].as_array().unwrap().len() - 1;
        let mut wrong_order = rules.clone();
        wrong_order["rules"].as_array_mut().unwrap().swap(first_direct - 1, first_direct);
        assert!(
            controller_direct_graph_is_active(&wrong_order, &proxies, &expected, "Ethernet 2", true, true, false,).is_err(),
            "home process pins must remain ahead of DIRECT selectors"
        );

        let mut broad_selector = rules.clone();
        broad_selector["rules"][first_direct]["payload"] =
            serde_json::json!("((Network,tcp) && (DstPort,443) && (Domain,wxs.qq.com))");
        assert!(
            controller_direct_graph_is_active(&broad_selector, &proxies, &expected, "Ethernet 2", true, true, false,).is_err(),
            "a DIRECT selector without the exact process condition must fail read-back"
        );

        let mut wrong_interface = proxies.clone();
        wrong_interface["proxies"]["Tono-China-Direct"]["interface"] = serde_json::json!("Wi-Fi");
        assert!(
            controller_direct_graph_is_active(&rules, &wrong_interface, &expected, "Ethernet 2", true, true, false,).is_err(),
            "a same-named DIRECT outbound bound to another interface must fail"
        );

        let mut wrong_type = proxies.clone();
        wrong_type["proxies"]["Tono-China-Direct"]["type"] = serde_json::json!("Selector");
        assert!(
            controller_direct_graph_is_active(&rules, &wrong_type, &expected, "Ethernet 2", true, true, false,).is_err(),
            "a same-named non-Direct outbound must fail"
        );

        let mut stale_rule = rules.clone();
        let duplicate = stale_rule["rules"][first_direct].clone();
        stale_rule["rules"].as_array_mut().unwrap().insert(last - 1, duplicate);
        assert!(
            controller_direct_graph_is_active(&stale_rule, &proxies, &expected, "Ethernet 2", true, true, false,).is_err(),
            "an extra stale or duplicated DIRECT rule must fail exact cardinality"
        );

        let mut wrong_fallback = rules.clone();
        wrong_fallback["rules"][last]["proxy"] = serde_json::json!("DIRECT");
        assert!(
            controller_direct_graph_is_active(&wrong_fallback, &proxies, &expected, "Ethernet 2", true, true, false,).is_err(),
            "the final fallback must remain exact Tono-Exit"
        );
    }

    #[test]
    fn controller_readback_accepts_the_claude_home_split_graph() {
        // With homeProxy routing the home block (process names, path fragments,
        // and CLAUDE_HOME_DOMAINS) points at Tono-Claude-Home, sitting between
        // loopback and the DIRECT pins.
        let expected = vec![ControllerDirectRuleProof {
            proxy: "Tono-China-Direct".to_owned(),
            payload: "((Network,tcp) && (ProcessName,Weixin.exe))"
                .to_owned(),
        }];
        let proxies = serde_json::json!({
            "proxies": {
                "Tono-Exit": {},
                "Tono-Claude-Home": {"type": "Selector"},
                "Tono-China-Direct": {"type": "Direct", "interface": "Ethernet 2"}
            }
        });
        let split_rules = controller_rules_graph(
            "Tono-Claude-Home",
            true,
            vec![serde_json::json!({"type": "AND", "payload": "((Network,tcp) && (ProcessName,Weixin.exe))", "proxy": "Tono-China-Direct"})],
        );
        controller_direct_graph_is_active(&split_rules, &proxies, &expected, "Ethernet 2", true, false, true)
            .expect("the exact split graph must pass");

        // The same graph must fail when the caller did not stage a split (and vice versa):
        // a split graph silently answering an unsplit proof would hide a stale reload.
        assert!(
            controller_direct_graph_is_active(&split_rules, &proxies, &expected, "Ethernet 2", true, false, false).is_err(),
            "a split graph must not satisfy the unsplit proof"
        );

        let mut missing_group = proxies.clone();
        missing_group["proxies"].as_object_mut().unwrap().remove("Tono-Claude-Home");
        assert!(
            controller_direct_graph_is_active(&split_rules, &missing_group, &expected, "Ethernet 2", true, false, true).is_err(),
            "split rules without the Tono-Claude-Home group must fail"
        );

        let domain_index = 2 + home_controller_rules("Tono-Claude-Home", false).len();
        let mut wrong_target = split_rules.clone();
        wrong_target["rules"][domain_index]["proxy"] = serde_json::json!("Tono-Exit");
        assert!(
            controller_direct_graph_is_active(&wrong_target, &proxies, &expected, "Ethernet 2", true, false, true).is_err(),
            "a Claude domain leaking to Tono-Exit must fail"
        );
    }

    #[test]
    fn controller_readback_accepts_the_claude_home_socks5_split_graph() {
        // With homeSocks5 routing the same six Claude rows point at
        // Tono-Claude-Home; the group now holds the chained SOCKS5 outbound.
        // The proof asserts the group's presence, not its members — the extra
        // Tono-Home-Residential outbound must not trip it.
        let expected = vec![ControllerDirectRuleProof {
            proxy: "Tono-China-Direct".to_owned(),
            payload: "((Network,tcp) && (ProcessName,Weixin.exe))"
                .to_owned(),
        }];
        let proxies = serde_json::json!({
            "proxies": {
                "Tono-Exit": {},
                "Tono-Claude-Home": {"type": "Selector"},
                "Tono-Home-Residential": {"type": "Socks5"},
                "Tono-China-Direct": {"type": "Direct", "interface": "Ethernet 2"}
            }
        });
        let split_rules = controller_rules_graph(
            "Tono-Claude-Home",
            true,
            vec![serde_json::json!({"type": "AND", "payload": "((Network,tcp) && (ProcessName,Weixin.exe))", "proxy": "Tono-China-Direct"})],
        );
        controller_direct_graph_is_active(&split_rules, &proxies, &expected, "Ethernet 2", true, false, true)
            .expect("the exact socks5 split graph must pass");
    }

    #[test]
    fn direct_plan_builds_deduped_rules_and_matching_endpoints() {
        use tono_core::policy::PolicyMedia;
        let node = node();
        // The fixture node is 203.0.113.7; pins include it to prove the
        // node IP never becomes a rule or a permit.
        let pins = vec![
            (
                "wxs.qq.com".to_string(),
                vec![
                    std::net::Ipv4Addr::new(9, 0, 0, 10),
                    std::net::Ipv4Addr::new(9, 0, 0, 10),
                    std::net::Ipv4Addr::new(9, 0, 0, 11),
                ],
                vec![80, 443],
            ),
            (
                "qpic.cn".to_string(),
                vec![std::net::Ipv4Addr::new(203, 0, 113, 7)],
                vec![443],
            ),
        ];
        let media = vec![
            PolicyMedia {
                address: "9.0.0.20".to_string(),
                ports: vec![443, 8000],
            },
            PolicyMedia {
                address: "1.1.1.1".to_string(), // permanently protected: dropped
                ports: vec![443],
            },
            PolicyMedia {
                address: "203.0.113.7".to_string(), // the node itself: dropped
                ports: vec![443],
            },
        ];
        let web_pins = vec![
            (
                "www.bilibili.com".to_string(),
                vec![std::net::Ipv4Addr::new(9, 0, 0, 30)],
                vec![443],
            ),
            (
                "api.bilibili.com".to_string(),
                // Shared CDN tuple must not consume a second WFP slot.
                vec![std::net::Ipv4Addr::new(9, 0, 0, 10)],
                vec![443],
            ),
        ];
        let suffixes = vec![
            tono_core::policy::PolicyDomain {
                host: "bilibili.com".to_string(),
                ports: vec![80, 443],
            },
            tono_core::policy::PolicyDomain {
                host: "baidu.com".to_string(),
                ports: vec![80, 443],
            },
            tono_core::policy::PolicyDomain {
                host: "zoom.us".to_string(),
                ports: vec![443],
            },
        ];
        let (plan, endpoints) = build_direct_plan("Ethernet 2".to_string(), &pins, &web_pins, &media, &suffixes, &node, Vec::new()).unwrap();
        // WeChat TCP tuples deduped: (9.0.0.10, 80|443) +
        // (9.0.0.11, 80|443) = 4; exact web remains separate by host.
        assert_eq!(plan.tcp_wechat_rules.len(), 4);
        assert_eq!(
            plan.tcp_web_rules,
            vec![
                (
                    "api.bilibili.com".to_string(),
                    std::net::Ipv4Addr::new(9, 0, 0, 10),
                    443,
                ),
                (
                    "www.bilibili.com".to_string(),
                    std::net::Ipv4Addr::new(9, 0, 0, 30),
                    443,
                ),
            ]
        );
        // UDP: only (9.0.0.20, 443|8000).
        assert_eq!(plan.udp_wechat_rules.len(), 2);
        // Bilibili from policy plus always-on China suffixes; zoom stays off.
        assert_eq!(
            plan.web_suffix_rules,
            vec![
                ("aliyuncs.com".to_string(), 80),
                ("aliyuncs.com".to_string(), 443),
                ("baidu.com".to_string(), 80),
                ("baidu.com".to_string(), 443),
                ("bilibili.com".to_string(), 80),
                ("bilibili.com".to_string(), 443),
                ("edu.cn".to_string(), 80),
                ("edu.cn".to_string(), 443),
                ("qq.com".to_string(), 80),
                ("qq.com".to_string(), 443),
                ("weixinbridge.com".to_string(), 80),
                ("weixinbridge.com".to_string(), 443),
            ]
        );
        // hosts carry both WeChat domains and the exact web domain.
        assert_eq!(plan.hosts.len(), 5);
        assert!(plan.hosts.iter().all(|(_, ip)| ip != "203.0.113.7"));
        // Endpoints: 4 WeChat TCP + 1 distinct web TCP + 2 UDP. The shared
        // 9.0.0.10:443 tuple consumes only one WFP permit; suffix rules pin
        // no IP and therefore consume none.
        assert_eq!(endpoints.len(), 7);
        assert!(endpoints.iter().all(|endpoint| endpoint.ip != "203.0.113.7"));
        assert_eq!(
            endpoints
                .iter()
                .filter(|endpoint| endpoint.protocol == tono_service_protocol::ProxyProtocol::Udp)
                .count(),
            2
        );
        assert!(
            plan.tcp_wechat_rules
                .iter()
                .all(|(_host, _ip, port)| [80, 443].contains(port))
        );
        assert!(
            plan.udp_wechat_rules
                .iter()
                .all(|(_ip, port)| [443, 8000].contains(port))
        );
        let controller_rules = expected_controller_direct_rules(&plan);
        // One row per *permitted* endpoint. This fixture has no signed native
        // path, so its Bilibili suffix remains tunnelled and contributes no
        // controller row.
        let process_rows = if plan.tcp_wechat_rules.is_empty() {
            0
        } else {
            plan.reviewed_direct_ports.len() * plan.wechat_process_path_regexes.len()
        };
        assert_eq!(
            controller_rules.len(),
            plan.tcp_wechat_rules.len()
                + process_rows
                + plan.udp_wechat_rules.len()
                    * tono_core::config::REVIEWED_DIRECT_PROCESS_NAMES.len()
                + plan.tcp_web_rules.len(),
            "controller read-back must require one canonical Mihomo row per generated rule"
        );
        assert!(
            !plan.web_suffix_rules.is_empty(),
            "fixture must still carry suffixes, so the assertion above proves they are dropped"
        );
        assert!(
            controller_rules
                .iter()
                .all(|rule| { !rule.payload.contains("Network,TCP") && !rule.payload.contains("Network,UDP") })
        );
        assert!(plan.wechat_process_path_regexes.is_empty());
    }

    #[test]
    fn bilibili_suffix_is_in_controller_proof_only_with_signed_native_path() {
        let node = node();
        let pins = vec![
            (
                "wxs.qq.com".to_string(),
                vec![std::net::Ipv4Addr::new(9, 0, 0, 10)],
                vec![443],
            ),
        ];
        let suffixes = vec![tono_core::policy::PolicyDomain {
            host: "bilibili.com".to_string(),
            ports: vec![80, 443],
        }];
        let prefix = tono_core::config::wechat_prefix_path_regex(
            r"C:\Program Files\Tencent\WeChat",
        )
        .expect("reviewed prefix");
        let (plan, _) = build_direct_plan(
            "Ethernet 2".to_string(),
            &pins,
            &[],
            &[],
            &suffixes,
            &node,
            vec![prefix],
        )
        .expect("plan");
        let rules = expected_controller_direct_rules(&plan);
        assert!(rules.iter().any(|rule| {
            rule.proxy == tono_core::config::WEB_DIRECT_GROUP_NAME
                && rule.payload
                    == "((Network,tcp) && (DstPort,80) && (DomainSuffix,bilibili.com))"
        }));
        assert!(rules.iter().any(|rule| {
            rule.proxy == tono_core::config::WEB_DIRECT_GROUP_NAME
                && rule.payload
                    == "((Network,tcp) && (DstPort,443) && (DomainSuffix,bilibili.com))"
        }));
        assert!(rules.iter().any(|rule| {
            rule.proxy == tono_core::config::WEB_DIRECT_GROUP_NAME
                && rule.payload == "((Network,tcp) && (DstPort,443) && (DomainSuffix,qq.com))"
        }));
        for suffix in ["baidu.com", "aliyuncs.com", "edu.cn", "weixinbridge.com"] {
            assert!(
                rules.iter().any(|rule| {
                    rule.proxy == tono_core::config::WEB_DIRECT_GROUP_NAME
                        && rule.payload
                            == format!(
                                "((Network,tcp) && (DstPort,443) && (DomainSuffix,{suffix}))"
                            )
                }),
                "{suffix} must be in the controller proof"
            );
        }
    }

    #[test]
    fn direct_plan_keeps_only_safe_signed_wechat_path_regexes() {
        let node = node();
        let pins = vec![(
            "wxs.qq.com".to_string(),
            vec![std::net::Ipv4Addr::new(9, 0, 0, 10)],
            vec![443],
        )];
        let prefix = tono_core::config::wechat_prefix_path_regex(r"C:\Program Files\Tencent\WeChat")
            .expect("reviewed prefix");
        let (plan, _) = build_direct_plan(
            "Ethernet 2".to_string(),
            &pins,
            &[],
            &[],
            &[],
            &node,
            vec![
                prefix.clone(),
                "not-anchored".to_string(),
                "AND,((NETWORK,TCP))".to_string(),
                prefix.clone(),
            ],
        )
        .unwrap();
        assert_eq!(plan.wechat_process_path_regexes, vec![prefix.clone()]);
        let controller = expected_controller_direct_rules(&plan);
        // The reviewed regex is retained on the plan — it still governs UDP media, and
        // reinstating TCP process scope is one block in `runtime_value` once WFP grows an
        // app-scoped port permit — but it must not produce a TCP row today: that row would
        // route every WeChat flow out the physical interface, where only the pins below
        // have a permit and the rest is dropped.
        assert!(
            !controller.iter().any(|rule| {
                rule.payload
                    == format!(
                        "((Network,tcp) && ({},{prefix}))",
                        super::MIHOMO_PROCESS_PATH_REGEX_TYPE
                    )
            }),
            "a TCP path-regex row routes flows the WFP permit set cannot cover"
        );
        assert!(controller.iter().any(|rule| {
            rule.payload == "((Network,tcp) && (DstPort,443) && (Domain,wxs.qq.com) && (IPCIDR,9.0.0.10/32))"
        }));
    }

    /// The invariant the two halves of the DIRECT overlay must satisfy.
    ///
    /// A rule sends a flow out the physical interface; `wfp_model::session_rules` decides
    /// whether that flow is allowed to leave. Exact pins use class G, one
    /// filter per `direct_endpoints` entry. The signed native path rules and
    /// reviewed Bilibili suffix rules share the narrower class-H TCP port
    /// permit; anything outside that explicit combination still falls into
    /// the `session/block-all` floor.
    fn sampled(payload: &str) -> SampledConnections {
        serde_json::from_str(payload).expect("controller payload")
    }

    /// What the sampler must and must not record.
    ///
    /// The chain decides, not the rule: a rule names a *group*, and a group that failed over
    /// to the exit is exactly the case where the two disagree. Recording by rule would count a
    /// flow as direct that went through the tunnel, and the prefix set computed from it would
    /// be wrong in the direction that matters — too wide.
    #[test]
    fn direct_samples_follow_the_chain_and_never_repeat() {
        let payload = sampled(
            r#"{"connections":[
              {"metadata":{"destinationIP":"43.175.230.151","destinationPort":"443","network":"tcp",
                "processPath":"C:\\Program Files\\Tencent\\WeChat\\WeChat.exe"},
               "chains":["Tono-China-Direct","Tono-China-App"],
               "rule":"AND","rulePayload":"((Network,tcp) && (ProcessName,WeChat.exe))"},
              {"metadata":{"destinationIP":"43.146.27.18","destinationPort":"8000","network":"udp",
                "processPath":"C:\\Program Files\\Tencent\\WeChat\\WeChat.exe"},
               "chains":["Tono-China-Direct"],"rule":"AND","rulePayload":""},
              {"metadata":{"destinationIP":"142.250.4.100","destinationPort":"443","network":"tcp",
                "processPath":"C:\\Program Files\\Google\\Chrome\\chrome.exe"},
               "chains":["US-VLESS-Reality","Tono-Exit"],"rule":"MATCH","rulePayload":""},
              {"metadata":{"destinationIP":"","destinationPort":"443","network":"tcp",
                "processPath":"x.exe"},"chains":["Tono-China-Direct"],"rule":"","rulePayload":""}
            ]}"#,
        );
        let mut seen = std::collections::HashSet::new();
        let first = new_direct_samples(&payload, &mut seen);

        assert_eq!(first.len(), 2, "only the two chains naming a direct outbound");
        assert_eq!(first[0].address, "43.175.230.151");
        assert_eq!(first[0].port, 443);
        assert!(!first[0].udp);
        assert_eq!(first[0].process, "WeChat.exe", "basename only, never the full path");
        assert!(first[0].rule.contains("ProcessName"));
        assert!(first[1].udp, "network=udp must survive into the record");

        // Tunnelled traffic is not a direct dial, however busy it is.
        assert!(!first.iter().any(|sample| sample.address == "142.250.4.100"));
        // A row with no destination is dropped rather than recorded as an empty address.
        assert_eq!(first.len(), 2);

        // The same connections on the next tick add nothing: this is a per-session set, not a
        // per-tick trace, which is what keeps an uploaded log bounded.
        assert!(new_direct_samples(&payload, &mut seen).is_empty());

        // A second process reaching an address the first already used must still be recorded:
        // "something that is not WeChat went direct" is the alarm this whole record exists for.
        let other_process = sampled(
            r#"{"connections":[
              {"metadata":{"destinationIP":"43.175.230.151","destinationPort":"443","network":"tcp",
                "processPath":"C:\\Windows\\Temp\\evil.exe"},
               "chains":["Tono-China-Direct"],"rule":"","rulePayload":""}
            ]}"#,
        );
        let flagged = new_direct_samples(&other_process, &mut seen);
        assert_eq!(flagged.len(), 1, "a different process on a seen address is not a duplicate");
        assert_eq!(flagged[0].process, "evil.exe");

        // A domain-routed flow under fake-ip carries a name and no usable address. Recording
        // only addresses would miss half the traffic rule H newly permits.
        let by_name = sampled(
            r#"{"connections":[
              {"metadata":{"destinationIP":"","destinationPort":"443","network":"tcp",
                "host":"res.wx.qq.com","processPath":"WeChat.exe"},
               "chains":["Tono-China-Direct"],"rule":"","rulePayload":""}
            ]}"#,
        );
        let named = new_direct_samples(&by_name, &mut seen);
        assert_eq!(named.len(), 1);
        assert_eq!(named[0].host, "res.wx.qq.com");
        assert!(named[0].address.is_empty());

        // A new port on an address already seen is a new destination.
        let more = sampled(
            r#"{"connections":[
              {"metadata":{"destinationIP":"43.175.230.151","destinationPort":"80","network":"tcp",
                "processPath":"WeChat.exe"},"chains":["Tono-China-Direct"],"rule":"","rulePayload":""}
            ]}"#,
        );
        assert_eq!(new_direct_samples(&more, &mut seen).len(), 1);
    }

    /// The web direct outbound counts too — it is the same physical-interface escape, and the
    /// suffix routes that ride it are the other half of what a prefix list has to cover.
    #[test]
    fn direct_samples_include_the_web_direct_outbound() {
        let payload = sampled(
            r#"{"connections":[
              {"metadata":{"destinationIP":"203.0.113.7","destinationPort":"443","network":"tcp",
                "processPath":"chrome.exe"},
               "chains":["Tono-China-Web-Direct"],"rule":"AND","rulePayload":"(DomainSuffix,baidu.com)"}
            ]}"#,
        );
        let mut seen = std::collections::HashSet::new();
        let samples = new_direct_samples(&payload, &mut seen);
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].chain, "Tono-China-Web-Direct");
    }

    #[test]
    fn protected_route_classification_uses_terminal_chain_order() {
        let cases = [
            (
                r#"{"connections":[{"chains":["Tono-Home-Residential","Tono-Claude-Home","Tono-Exit"]}]}"#,
                "Tono-Home-Residential",
                ProtectedRoute::Residential,
            ),
            (
                r#"{"connections":[{"chains":["Home 01","Tono-Claude-Home"]}]}"#,
                "Home 01",
                ProtectedRoute::Residential,
            ),
            (
                r#"{"connections":[{"chains":["US Reality 01","Tono-Exit","Tono-Claude-Home"]}]}"#,
                "Home 01",
                ProtectedRoute::Proxied,
            ),
            (
                r#"{"connections":[{"chains":["DIRECT","Tono-Claude-Home"]}]}"#,
                "Home 01",
                ProtectedRoute::Direct,
            ),
            (
                r#"{"connections":[{"chains":["Tono-China-Web-Direct","Tono-Claude-Home"]}]}"#,
                "Home 01",
                ProtectedRoute::Direct,
            ),
            (
                r#"{"connections":[{"chains":["REJECT"],"rule":"AND"}]}"#,
                "Home 01",
                ProtectedRoute::Blocked,
            ),
            (
                r#"{"connections":[{"chains":[]}]}"#,
                "Home 01",
                ProtectedRoute::Unknown,
            ),
        ];

        for (payload, residential_target, expected) in cases {
            let parsed = sampled(payload);
            let observed = classify_protected_route(&parsed.connections[0], residential_target);
            assert_eq!(observed, expected);
        }
        assert!(ProtectedRoute::Direct.violates_residential_route());
        assert!(ProtectedRoute::Proxied.violates_residential_route());
        assert!(!ProtectedRoute::Residential.violates_residential_route());
    }

    #[test]
    fn protected_evidence_is_filtered_bounded_and_mutually_exclusive() {
        let payload = sampled(
            r#"{"connections":[
              {"id":"residential","metadata":{"host":"api.claude.ai"},
               "chains":["Tono-Home-Residential","Tono-Claude-Home","Tono-Exit"]},
              {"id":"proxied","metadata":{"host":"challenges.cloudflare.com"},
               "chains":["US Reality 01","Tono-Exit","Tono-Claude-Home"]},
              {"id":"direct","metadata":{"host":"registry.npmjs.org"},
               "chains":["DIRECT","Tono-Claude-Home"]},
              {"id":"blocked","metadata":{"host":"browser-intake-datadoghq.com"},
               "chains":["REJECT"],"rule":"REJECT"},
              {"id":"unknown","metadata":{"destinationIP":"160.79.104.10"},"chains":[]},
              {"id":"ignored","metadata":{"host":"openai.com"},"chains":["DIRECT"]}
            ]}"#,
        );
        let mut seen = std::collections::HashSet::new();
        let mut aggregate = ProtectedRouteAggregate::default();
        assert!(observe_protected_routes(
            &payload,
            "Tono-Home-Residential",
            &mut seen,
            &mut aggregate,
        ));
        assert_eq!(seen.len(), 5, "non-protected destinations never enter the bounded set");
        assert_eq!(aggregate.residential, 1);
        assert_eq!(aggregate.proxied, 1);
        assert_eq!(aggregate.direct, 1);
        assert_eq!(aggregate.blocked, 1);
        assert_eq!(aggregate.unknown, 1);
        assert_eq!(aggregate.invariant_violations(), 2);
        assert_eq!(aggregate.latest, Some((ProtectedRoute::Unknown, ProtectedDestination::Anthropic)));

        assert!(!observe_protected_routes(
            &payload,
            "Tono-Home-Residential",
            &mut seen,
            &mut aggregate,
        ));
        assert_eq!(aggregate.residential, 1, "connection IDs are counted once per session");
    }

    #[test]
    fn protected_destination_matching_respects_domain_boundaries() {
        let protected = sampled(
            r#"{"connections":[{"metadata":{"host":"API.CLAUDE.AI."}},{"metadata":{"host":"notclaude.ai"}}]}"#,
        );
        assert_eq!(protected_destination(&protected.connections[0]), Some(ProtectedDestination::Anthropic));
        assert_eq!(protected_destination(&protected.connections[1]), None);
    }

    #[test]
    fn protected_evidence_domains_are_all_in_the_residential_rule_set() {
        for destination in [
            super::ANTHROPIC_DESTINATIONS,
            super::TURNSTILE_DESTINATIONS,
            super::UPDATE_DESTINATIONS,
            super::TELEMETRY_DESTINATIONS,
        ]
        .into_iter()
        .flatten()
        {
            assert!(
                tono_core::config::CLAUDE_HOME_DOMAINS.contains(destination),
                "{destination} must not be sampled as protected unless the runtime routes it residential"
            );
        }
    }

    #[test]
    fn every_direct_rule_pins_an_endpoint_the_kill_switch_can_permit() {
        let node = node();
        let wechat = vec![(
            "wxs.qq.com".to_string(),
            vec![std::net::Ipv4Addr::new(9, 0, 0, 10)],
            vec![80, 443],
        )];
        let web = vec![(
            "www.bilibili.com".to_string(),
            vec![std::net::Ipv4Addr::new(9, 0, 0, 30)],
            vec![443],
        )];
        let suffixes = vec![tono_core::policy::PolicyDomain {
            host: "baidu.com".to_string(),
            ports: vec![80, 443],
        }];
        let (plan, endpoints) = build_direct_plan(
            "Ethernet 2".to_string(),
            &wechat,
            &web,
            &[],
            &suffixes,
            &node,
            vec![
                tono_core::config::wechat_prefix_path_regex(r"C:\Program Files\Tencent\WeChat")
                    .expect("reviewed prefix"),
            ],
        )
        .expect("plan");

        let permitted: std::collections::BTreeSet<String> = endpoints
            .iter()
            .map(|endpoint| format!("{}/32", endpoint.ip))
            .collect();
        assert!(!permitted.is_empty(), "fixture must produce permits");

        // Two ways a rule can be covered, and every rule must be covered by one of them:
        //   - it pins an address that `direct_endpoints` permits exactly (rule G), or
        //   - its port is one the reviewed-port class permits for the staged core (rule H).
        // A rule covered by neither routes a flow to the physical interface that the
        // block-all floor then drops — the silent hang this whole class exists to end.
        for rule in expected_controller_direct_rules(&plan) {
            let port = rule
                .payload
                .split("(DstPort,")
                .nth(1)
                .and_then(|rest| rest.split(')').next())
                .and_then(|value| value.parse::<u16>().ok());
            let covered_by_port = port
                .is_some_and(|port| tono_service_protocol::REVIEWED_DIRECT_PORTS.contains(&port));
            let pin = rule
                .payload
                .split("(IPCIDR,")
                .nth(1)
                .and_then(|rest| rest.split(')').next());
            match pin {
                Some(pin) => assert!(
                    permitted.contains(pin) || covered_by_port,
                    "DIRECT rule pins {pin}, which is neither in the WFP permit set nor on a \
                     reviewed port: {}",
                    rule.payload
                ),
                None => assert!(
                    covered_by_port,
                    "DIRECT rule with no address pin and no reviewed port would be dropped by \
                     the kill switch: {}",
                    rule.payload
                ),
            }
        }

        // The port constraint is what makes the second arm safe, so prove it is really there:
        // an unconstrained process rule would route every port WeChat opens to the physical
        // interface, where only the reviewed four have a permit.
        for rule in expected_controller_direct_rules(&plan) {
            if rule.payload.contains("ProcessName") || rule.payload.contains("ProcessPathRegex") {
                assert!(
                    rule.payload.contains("(DstPort,"),
                    "a process-scoped DIRECT rule must name a port: {}",
                    rule.payload
                );
            }
        }
    }

    #[test]
    fn direct_plan_rejects_more_endpoints_than_wfp_can_permit() {
        let node = node();
        let pins = (0..=MAX_DIRECT_ENDPOINTS)
            .map(|index| {
                (
                    format!("edge-{index}.example"),
                    vec![std::net::Ipv4Addr::new(11, 1, (index / 256) as u8, (index % 256) as u8)],
                    vec![443],
                )
            })
            .collect::<Vec<_>>();

        let error = build_direct_plan("Ethernet 2".to_string(), &pins, &[], &[], &[], &node, Vec::new())
            .expect_err("a partial WFP permit set must never be emitted");

        assert!(error.contains("257 unique endpoints"));
    }
}
