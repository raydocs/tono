//! Connect orchestration.
//!
//! Every privileged step goes through the Service IPC wrappers in
//! `core::service` — the owner/session machinery is never bypassed. The
//! fail-closed invariant: once the WFP policy exists, only Disconnect,
//! Sign Out, Quit, ordinary self-heal exhaustion, or non-strict catalog
//! removal release it. Both automatic paths use the explicit release and
//! do not build another tunnel.
//! Windows has no strict kill switch, so a verified connect failure restores
//! the original network instead of sitting in Protected Offline. After that
//! release, TCP probes run while the original network stays up. A tunnel
//! starts only after one proof. Self-heal does not rewrite routes while a
//! hop is still unproven. An explicit strict kill switch keeps the block.
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
pub(crate) use reconnect::crash_recovery_reconnect_allowed;
mod switch;
mod direct;
mod heal;
pub(crate) use heal::{
    forget_hy2_choices, note_hy2_catalog, note_manual_selection, restore_hy2_choices,
};
mod platform;
mod unarmed_probe;
mod core_select;
mod attempt;
mod entry;
mod guards;
mod outcome;
mod controller_error;

// Compatibility surface for existing command and test callers. The transaction
// and error modules do not import this orchestration facade.
pub use failure::{
    BFE_NOT_RUNNING_PREFIX, NODE_OR_CORE_UNREACHABLE_PREFIX, PROTECTION_HELD_BY_ANOTHER_USER_PREFIX,
    RELEASE_RECONCILING_PREFIX, REMOTE_SESSION_CONNECT_REFUSED_PREFIX, SERVICE_BUSY_PREFIX,
    SERVICE_TOO_OLD_PREFIX, TUN_DATA_PLANE_BROKEN_PREFIX, TUN_INGRESS_BROKEN_PREFIX,
    WFP_ENGINE_WEDGED_PREFIX, is_retryable_lock_error, map_service_ready_error,
    map_wfp_engine_error,
};
#[allow(unused_imports, reason = "retain the existing public error-marker path")]
pub use failure::SERVICE_NOT_RUNNING_PREFIX;
use failure::{CATALOG_NOT_READY_REJECTION, StageFailure, TRANSITION_IN_FLIGHT_REJECTION};
use stages::{ready_service_and_prefetch, run_stages};
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
    health_threshold_reached, kill_switch_unhealthy, kill_switch_unhealthy_for_monitor,
    monitor_requires_reconnect, network_event_fires, owned_direct_reload_in_flight,
    protected_dns_unhealthy, startup_resume_guards_hold, startup_runtime_is_resume_candidate,
};
pub use crate::tono::connection_plan::{
    FailurePlan, SelectAction, guard_rejection_is_transient, plan_failure, plan_failure_using,
    reconnect_allowed, retry_now_is_noop, select_action, sign_out_needs_release, single_flight_begin,
    stale_exit_needs_release,
};
#[cfg(any(not(windows), test))]
pub use crate::tono::connection_plan::stop_core_before_release;
pub(crate) use crate::tono::connection_routes::{
    ANTHROPIC_DESTINATIONS, MAX_DIRECT_SAMPLES, MAX_PROTECTED_ROUTE_SAMPLES,
    ProtectedDestination, ProtectedRoute, ProtectedRouteAggregate, SampledConnections,
    PAYMENT_DESTINATIONS, TELEMETRY_DESTINATIONS, TURNSTILE_DESTINATIONS, UPDATE_DESTINATIONS, classify_protected_route,
    new_direct_samples, observe_protected_routes, protected_destination,
};

use cleanup::{ensure_fresh, retire_timed_out_generation};
use controller::{
    CONTROLLER_HTTP_TIMEOUT, CONTROLLER_READY_TIMEOUT, LOCK_ATTEMPTS, LOCK_RETRY_INTERVAL,
    classify_bfe_state, controller_client, controller_url, dns_listener_conflict_message,
    lock_kill_switch_with_retries, select_exit_group, wait_controller,
};
pub use controller::close_owned_controller_connection;
use endpoints::proxy_endpoints_for;
pub use endpoints::{proxy_endpoint_of, unique_proxy_endpoints};
use monitor::{IN_PLACE_RECOVERY_COOLDOWN, NETWORK_MONITOR_INTERVAL, monitor_interval, wechat_paths_changed};
pub(crate) use monitor::{
    ensure_protection_resync, ensure_protection_resync_locked, handle_network_change,
    handle_policy_behavior_change, policy_behavior_change_allows_in_place_recovery, spawn_protection_resync,
};
#[cfg(test)]
use probes::EXIT_PROBE_ADVISORY_BUDGET;
use probes::{
    EXIT_PROBE_CLIENT_TIMEOUT, EXIT_PROBE_CORE_TIMEOUT_MS, FAKE_IP_LOOKUP_TIMEOUT, POST_LOCK_VERIFY_ROUND_DELAY,
    POST_LOCK_VERIFY_ROUNDS, PostLockVerification, TUN_DATA_PLANE_CONNECT_TIMEOUT, TUN_DATA_PLANE_PROBES,
    TUN_DATA_PLANE_TIMEOUT, TUN_PROBE_STAGGER, VERIFY_LOCK_ATTEMPTS, classify_exhausted_data_plane,
    classify_post_lock_verification, connect_failure_is_dead_exit, fake_ip_attempt_timeout,
    fake_ip_verification_error, format_tun_probe_failures, tun_probe_stagger, verify_tun_data_plane,
};
#[cfg(test)]
use probes::{fake_ip_race_state, tun_dns_proves_fake_ip};
pub use probes::{is_fake_ip, test_current_server, verify_lock_retry_window};

pub use disconnect::{disconnect, release_explicit};
pub(crate) use disconnect::disconnect_for_generation;
pub(crate) use disconnect::release_for_account;
#[cfg(test)]
pub(crate) use disconnect::{complete_account_release, coordinate_release};
#[cfg(test)]
use disconnect::{EXPLICIT_RELEASE_TIMEOUT, SERVICE_LIFECYCLE_TIMEOUT};
pub use reconnect::{retry_reconnect_now, schedule_reconnect, schedule_startup_resume_if_proven};
use reconnect::active_runtime_resume_status;
pub use switch::{selected_node_vanished, switch_selected_node};
pub(crate) use switch::rebuild_for_catalog_routing_change;
pub use direct::{build_direct_plan, collect_ipv4_literals};
use direct::{
    WINDOWS_OPTIONAL_DIRECT_ENABLED, CapturedTrafficPolicy, ControllerDirectRuleProof, MAX_DIRECT_ENDPOINTS,
    CLOUD_DNS_QUERY_ATTEMPTS, CLOUD_POLICY_RESOLUTION_TIMEOUT, MIHOMO_PROCESS_PATH_REGEX_TYPE,
    OptionalDirectResolution, classify_optional_direct_resolution, controller_direct_graph_is_active,
    controller_dns_status_is_retryable, dns_query_a, dns_query_a_with_retry, expected_controller_direct_rules,
    prove_service_endpoint_digest, prove_service_reload_mode, spawn_optional_direct_after_connected,
    validate_direct_reload_result,
};
use platform::{detect_physical_interface, is_virtual_uplink_description};
pub(crate) use platform::remove_legacy_runtime_copy;
use attempt::{Attempt, attempt_for_generation};
#[cfg(test)]
pub(crate) use attempt::begin_attempt;
#[cfg(test)]
use attempt::{attempt_from_stage_failure, clear_uncommitted_direct_overlay, retain_attempt_failure, selection_still_current};
pub use entry::connect;
pub(crate) use entry::connect_for_generation;
use entry::{ConnectFailure, connect_for_generation_tracked, seed_autostart_after_connect};
use guards::guard_snapshot;
use outcome::fail_connect;
#[cfg(test)]
use outcome::record_connect_failure;
pub use controller_error::controller_error_detail;
#[cfg(test)]
use controller_error::CONTROLLER_ERROR_DETAIL_LIMIT;

/// Drop the ConnectOk session clock. A new connect attempt is not the session
/// that last reached ConnectOk, so disconnectOk must not report `elapsedMs`
/// from that earlier Instant.
fn clear_connected_at(connected_at: &mut Option<std::time::Instant>) {
    *connected_at = None;
}

/// Session duration for disconnectOk. `None` when there is no current ConnectOk.
fn session_elapsed_ms(connected_at: Option<std::time::Instant>) -> Option<u64> {
    connected_at.map(|at| at.elapsed().as_millis() as u64)
}

/// Spawned task futures are boxed into this trait object so a spawner's
/// async opaque type never embeds the spawned task's (the tasks re-enter
/// `attempt`, which would otherwise make the types infinitely recursive).
type BoxedTask = std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>;

/// Wire key for the kill switch mode in audit records.
fn kill_switch_mode_key(mode: KillSwitchStatusMode) -> &'static str {
    match mode {
        KillSwitchStatusMode::Bootstrap => "bootstrap",
        KillSwitchStatusMode::Locked => "locked",
        KillSwitchStatusMode::Blocked => "blocked",
    }
}

#[cfg(test)]
mod tests;
