//! The connect stage sequence. Stage order and cancellation-safe IPC are unchanged.
//! Adapters live in sibling modules. Do not give this module its own generation,
//! cleanup owner, or reconnect loop.

use std::sync::Arc;
use tauri::AppHandle;
use tono_core::{
    config::{self, build_owned_runtime_with_ports, generate_controller_secret},
    connection::ConnectStage,
    node::ValidatedNode,
};
use tono_logging::{Type, logging};
use tono_service_protocol::{KillSwitchConfig, RuntimeBundle};

use super::cleanup::{
    enable_dns_cancellation_safe, ensure_fresh, start_core_cancellation_safe,
};
use super::controller::{
    allocate_runtime_ports, configure_owned_controller_for_ui, lock_kill_switch_with_retries, preflight_bfe,
    preflight_dns_listener, wait_controller,
};
use super::endpoints::proxy_endpoint_of;
use super::monitor::{
    bootstrap_hosts, refresh_control_plane_pins_from_service, spawn_control_plane_pin_refresh,
    spawn_deferred_policy_reconnect, spawn_exit_identity_lookup, spawn_network_monitor,
};
use super::probes::{verify_fake_ip, verify_post_lock};
use super::status::set_stage;
use super::direct::{CapturedTrafficPolicy, WINDOWS_OPTIONAL_DIRECT_ENABLED, spawn_optional_direct_after_connected};
use super::platform::detect_physical_interface;
use super::reconnect::active_runtime_resume_status;
use super::{failure::StageFailure, transaction::ConnectTransaction};
use crate::{
    core::service,
    tono::{audit::AuditEvent, commands, state::TonoState},
};

/// The §6 stage sequence, from endpoint computation to `Connected`. The
/// generation is re-checked at every stage boundary; a moved generation
/// ends the transaction with no side effects.
pub(super) async fn run_stages(
    state: &Arc<TonoState>,
    app: &AppHandle,
    node: &ValidatedNode,
    nodes: &[ValidatedNode],
    routing: Option<&tono_core::CatalogRouting>,
    generation: u64,
    started: std::time::Instant,
    transaction: &ConnectTransaction,
    route_owner: Option<&crate::tono::route_preferences::PreferenceContext>,
) -> Result<(), StageFailure> {
    // §6.2: proxy endpoints (public IPv4/port/TCP) from the selected node;
    // the bootstrap API hosts are the only control-plane recovery channel.
    // When the catalog binds a home-broadband exit, its endpoint joins the
    // WFP permit set — otherwise the kill switch would block Mihomo's dial
    // to the very node the Claude split-routing rules point at. A homeSocks5
    // upstream is dialed through the tunnel (dialer-proxy), so it never
    // joins this permit set.
    let home_socks5 = routing.and_then(|routing| routing.home_socks5.as_ref());
    let home_node = if home_socks5.is_some() {
        None
    } else {
        routing
            .and_then(|routing| routing.home_proxy.as_deref())
            .and_then(|name| nodes.iter().find(|entry| entry.name == name))
    };
    let mut proxy_endpoints = vec![proxy_endpoint_of(node)];
    if let Some(home) = home_node
        && (home.server != node.server || home.port != node.port)
    {
        proxy_endpoints.push(proxy_endpoint_of(home));
    }

    transaction.check("preparing service")?;
    set_stage(state, app, ConnectStage::PreparingService, generation, started).await?;

    // Revision 12 closes both DNS-owner ordering holes. Reconcile under the authenticated Service
    // lifecycle lock before the App's loopback:53 availability test: orphaned installed cores and
    // a still-supervised/recorded core whose WFP+DNS protection is no longer fully proven are
    // stopped here. A completely protected runtime stays alive until StartClash replaces it;
    // third-party DNS software is never touched and still fails the bind proof below.
    let reconciled_cores = transaction
        .wait("preparing Tono Core ownership", service::tono_prepare_core_start())
        .await?
        .map_err(StageFailure::error)?;
    if reconciled_cores > 0 {
        logging!(
            warn,
            Type::Service,
            "Tono: Service stopped/reconciled {reconciled_cores} stale Core process(es) before DNS preflight"
        );
    }

    // Capture both the policy and its physical egress before WinTUN changes the default route.
    // Re-reading either after the first Core start can select the Tono adapter itself and makes
    // the runtime plan disagree with the WFP preflight that was actually performed. The policy
    // half may be replaced once more, under the commit below, when a policy behavior change that
    // arrived mid-connect is consumed (F5); the interface half never is — it is only ever
    // captured here, before the first Core start.
    let mut traffic_policy = {
        let inner = state.lock().await;
        inner.traffic_policy.clone().map(|document| CapturedTrafficPolicy {
            revision: inner.policy_tracker.current_revision(),
            digest: inner.policy_tracker.current_digest().unwrap_or_default().to_owned(),
            document,
        })
    };
    let needs_physical_interface = WINDOWS_OPTIONAL_DIRECT_ENABLED
        && traffic_policy.as_ref().is_some_and(|policy| policy.has_direct_content());

    // The preparation probes are independent of each other and all read-only /
    // cancellation-safe (the two port binds are released immediately; the core-path query is a
    // read IPC), so they run concurrently under one transaction wait instead of paying their
    // worst cases back to back (the bootstrap DNS lookup alone budgets 2 s):
    //  - F1: pinned bootstrap IPs merged with the live resolution — the WFP bootstrap permit
    //    must not depend on the system resolver once blocking starts, and the app's own API
    //    client is pinned to the same addresses (see `tono::bootstrap` / `tono::transport`).
    //  - The physical egress interface, still strictly before the first Core start (above).
    //  - Fresh loopback controller and diagnostic mixed-proxy ports eliminate collisions with
    //    another proxy or stale fixed listeners. The mixed listener is never a connection proof
    //    or product proxy: it is used only after a real TUN failure to distinguish node/Core
    //    egress from the Windows TUN path, and the runtime binds it explicitly to 127.0.0.1.
    //  - Mihomo's DNS listener still owns loopback:53 and publishes that resolver through the
    //    TUN endpoint at 198.18.0.2. Prove both listener sockets are available before installing
    //    WFP rather than timing out after the arm.
    //  - The Service-side core binary path validation.
    let (
        bootstrap_api_hosts,
        physical_interface_probe,
        runtime_ports,
        dns_preflight,
        active_runtime_resume,
        core_path,
        bfe_preflight,
    ) = transaction
        .wait("preparing service", async {
            refresh_control_plane_pins_from_service(state).await;
            tokio::join!(
                bootstrap_hosts(),
                async {
                    if needs_physical_interface {
                        Some(detect_physical_interface().await)
                    } else {
                        None
                    }
                },
                allocate_runtime_ports(),
                preflight_dns_listener(),
                active_runtime_resume_status(),
                service::tono_core_binary_path(),
                preflight_bfe(),
            )
        })
        .await?;
    let runtime_ports = runtime_ports.map_err(StageFailure::error)?;
    bfe_preflight.map_err(StageFailure::error)?;
    let controller_port = runtime_ports.controller_port;
    let mixed_port = runtime_ports.mixed_port;
    if let Err(error) = dns_preflight {
        if active_runtime_resume.is_some() {
            // The old, strongly proven same-owner Core is expected to own TCP/UDP loopback:53.
            // StartClash first re-arms WFP and then replaces that Core under the Service lifecycle
            // gate, so bypassing this one availability probe creates no direct-traffic window.
            logging!(
                info,
                Type::Service,
                "Tono: authenticated active runtime owns protected DNS; admitting fail-closed startup replacement ({error})"
            );
        } else {
            return Err(StageFailure::error(error));
        }
    }
    let core_path = core_path.map_err(StageFailure::error)?;
    let physical_interface = match physical_interface_probe {
        Some(interface) => {
            match interface {
                Ok(interface) => {
                    tono_core::config::DirectPlan::validate_physical_interface(&interface)
                        .map_err(StageFailure::error)?;
                    Some(interface)
                }
                Err(error) => {
                    // The cloud DIRECT overlay is optional. A machine with a virtual-only
                    // default route (or an adapter transition) must keep the proven full-tunnel
                    // runtime rather than turning an unrelated VMware/Hyper-V condition into a
                    // connection failure. WFP still has no physical DIRECT permits in this case.
                    logging!(
                        warn,
                        Type::Service,
                        "Tono: physical uplink discovery failed; skipping optional cloud DIRECT policy: {error}"
                    );
                    None
                }
            }
        }
        None => None,
    };
    // §5: the owned runtime carries a fresh random controller secret and the
    // account's exit credentials. The App never writes it to the user profile;
    // it reaches the Service over IPC.
    let secret = generate_controller_secret();
    let runtime = build_owned_runtime_with_ports(
        nodes,
        &node.name,
        &secret,
        None,
        home_node.map(|home| home.name.as_str()),
        home_socks5,
        runtime_ports,
    )
    .map_err(StageFailure::error)?;
    let bundle = RuntimeBundle {
        yaml: runtime.yaml().to_string(),
        assets: Vec::new(),
        remote_providers: Vec::new(),
        core_path: core_path.to_string_lossy().into_owned(),
    };
    let kill_switch = KillSwitchConfig {
        tunnel_interface: config::TUN_DEVICE_NAME.to_string(),
        proxy_endpoints: proxy_endpoints.clone(),
        bootstrap_api_hosts: bootstrap_api_hosts.clone(),
        // Omission = clear (service-side): the first start never carries
        // direct permits; the cloud-policy stage adds them later if needed.
        direct_endpoints: Vec::new(),
    };

    // §6.3: startingKillSwitch — the Service persists intent, installs the
    // bootstrap WFP policy, writes the runtime copy, and starts the core;
    // a failure inside is fail-closed on the Service side.
    set_stage(state, app, ConnectStage::StartingKillSwitch, generation, started).await?;
    ensure_fresh(state, generation).await?;
    transaction
        .wait(
            "starting kill switch and core",
            start_core_cancellation_safe(state, bundle, kill_switch, generation),
        )
        .await??;

    // The WFP policy exists from here on: the machine is fail-closed.
    {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            // The detached mutation already reconciled under lifecycle ownership. This outer
            // waiter owns no resource: another generation may have finished release/reconnect.
            return Err(StageFailure::Stale);
        }
        inner.fsm.mark_kill_switch_armed();
        inner.controller_secret = Some(secret.clone());
        inner.controller_port = Some(controller_port);
        commands::emit_status(app, &commands::status_of(&inner));
    }
    // Pin every later session-gated mutation to the owner generation created by this StartClash.
    // A stale detached operation must never consult the mutable global and accidentally adopt a
    // node switch's replacement session.
    let service_session = service::active_service_session().map_err(StageFailure::error)?;

    // §6.4 + §6.5: the controller bind and the WinTUN LUID appear independently
    // after StartClash. Waiting for them in series paid the lock ladder on
    // every connect even when `/version` was already answering.
    set_stage(state, app, ConnectStage::StartingTunnel, generation, started).await?;
    set_stage(state, app, ConnectStage::LockingTraffic, generation, started).await?;
    let (controller_ready, lock_ready) = transaction
        .wait("controller readiness and lock", async {
            tokio::join!(
                wait_controller(&secret, controller_port),
                lock_kill_switch_with_retries(&service_session),
            )
        })
        .await?;
    controller_ready.map_err(StageFailure::error)?;
    lock_ready.map_err(StageFailure::error)?;

    // Optional DIRECT is applied only after Connected. The critical path stays full-tunnel.

    // §6.7: securingDNS — snapshot + point resolvers at the protected TUN endpoint, then prove
    // an ordinary lookup returns a fake-ip address.
    set_stage(state, app, ConnectStage::SecuringDns, generation, started).await?;
    transaction
        .wait(
            "enabling protected DNS",
            enable_dns_cancellation_safe(state, generation, service_session.clone()),
        )
        .await??;
    ensure_fresh(state, generation).await?;
    transaction
        .wait("fake-IP verification", verify_fake_ip())
        .await?
        .map_err(StageFailure::error)?;

    // §6.8 + §6.9: checkingExit → verifyingTraffic, as one retryable verification group (C3).
    let mut kill_status = verify_post_lock(
        state,
        app,
        &secret,
        controller_port,
        mixed_port,
        generation,
        started,
        transaction,
    )
    .await?;

    // The durable logical-session latch is committed only after every existing check and a
    // final generation guard. A failure remains an ordinary connect failure.
    ensure_fresh(state, generation).await?;
    transaction
        .wait(
            "committing verified session",
            service::tono_mark_kill_switch_verified_for_session(&service_session),
        )
        .await?
        .map_err(StageFailure::error)?;
    kill_status.verified = true;

    if let Err(error) = commands::update::commit_if_pending().await {
        logging!(warn, Type::Service, "Update recovery commit remains unproven: {error:#}");
    }

    // The Tono runtime owns a fresh HTTP controller port and secret on every connection. The
    // dashboard reuses the Mihomo plugin's traffic WebSocket, so point that plugin at this
    // generation before publishing Connected. Updating the protocol last prevents a subscriber
    // from observing a half-configured HTTP context.
    // §6.10: only now Connected; monitors start.
    let mut deferred_policy_change = false;
    {
        let mut inner = controller_commit_guard(state, generation, || {
            configure_owned_controller_for_ui(state, app, &secret, controller_port);
        }).await?;
        inner.kill_switch = Some(kill_status);
        inner.controller_generation = inner.controller_generation.wrapping_add(1);
        inner.fsm.mark_session_verified();
        inner.fsm.connect_succeeded().map_err(StageFailure::error)?;
        // F5: a policy behavior change that arrived while this attempt was still
        // Connecting was deferred (`handle_network_change_inner` has nothing to
        // tear down mid-connect). Consume the deferral now and re-capture the
        // policy half of the snapshot from the latest installed document, so
        // this session's optional-DIRECT decision runs against the new policy
        // instead of the copy taken before the first Core start — which
        // `direct_context_is_current` would correctly reject, deferring the
        // change to the next manual reconnect.
        let deferred = inner.take_pending_policy_change(generation);
        if deferred {
            logging!(
                info,
                Type::Service,
                "Tono: consuming the policy behavior change deferred during this connect"
            );
            traffic_policy = inner.traffic_policy.clone().map(|document| CapturedTrafficPolicy {
                revision: inner.policy_tracker.current_revision(),
                digest: inner.policy_tracker.current_digest().unwrap_or_default().to_owned(),
                document,
            });
        }
        deferred_policy_change = deferred;
        crate::tono::route_preferences::record_verified(&inner, route_owner, &node.name);
        if let Err(error) = crate::tono::state::save_successful_selection(
            &inner.catalog_dir, &node.name,
            inner.attempt_history.current.as_ref().and_then(|attempt| attempt.catalog_revision).unwrap_or(-1),
            commands::epoch_millis(),
        ) {
            logging!(warn, Type::Service, "Tono: could not retain successful selection: {error}");
        }
        inner.exit_ip = None;
        inner.exit_org = None;
        inner.exit_location = None;
        // M4 seeds must reset on *every* success, not only on disconnect: a
        // reconnect's own StartClash always changes the core pid and bumps
        // the netmon counter, so comparing against pre-reconnect values made
        // the fresh monitor's first poll re-invalidate immediately — a
        // self-sustaining connect/teardown loop. Clearing them re-enters the
        // documented "first sample seeds without firing" path.
        inner.network_events_counter = None;
        inner.last_core_pid = None;
        inner.last_restart_count = None;
        // H5: the debounce timestamp is a monitor seed too. Leaving the previous session's
        // stamp behind meant a reconnect that completed inside NETWORK_EVENT_DEBOUNCE silently
        // *discarded* its first genuine event — the counter seed advanced past it, so the event
        // was lost rather than deferred, and the tunnel stayed green over a changed network.
        inner.last_network_event_at = None;
        // F3: every step completed; retry bookkeeping resets.
        let elapsed = inner
            .step_started_at
            .map(|at| at.elapsed().as_millis() as u64)
            .unwrap_or(0);
        crate::tono::steps::complete_all(&mut inner.connect_steps, elapsed);
        inner.retry_attempt = 0;
        inner.next_retry_at_ms = None;
        inner.connected_at = Some(std::time::Instant::now());
        state.route_ledger().lock().clear_connection_counters();
        commands::emit_status(app, &commands::status_of(&inner));
    }
    state.audit().log(AuditEvent::ConnectOk {
        node: node.name.clone(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        transport: node.catalog_transport(),
    });
    spawn_network_monitor(state, app).await;
    spawn_exit_identity_lookup(state, app, generation);
    let residential_target = if home_socks5.is_some() {
        Some(config::HOME_SOCKS5_OUTBOUND_NAME.to_owned())
    } else {
        home_node.map(|home| home.name.clone())
    };
    spawn_control_plane_pin_refresh(state, app, generation, residential_target).await;
    // F5 fallback: a deferred change whose refreshed policy needs a physical egress
    // snapshot this attempt never captured (the change went from no DIRECT content to
    // some, so `needs_physical_interface` was false when this attempt began) cannot be
    // applied in place — the interface must be discovered before the first Core start.
    // Rerun the same protected teardown + reconnect a connected-session change would
    // schedule; the fresh transaction rediscovers the interface and installs the new
    // policy. Skip this session's overlay spawn: without the snapshot it would only
    // record a deterministic skip. Keyed on "discovery never attempted", not on a missing
    // interface: a discovery that ran and failed (virtual-only default route) would fail
    // again after the teardown, so that case keeps the ordinary full-tunnel skip below.
    if deferred_policy_change
        && WINDOWS_OPTIONAL_DIRECT_ENABLED
        && !needs_physical_interface
        && traffic_policy.as_ref().is_some_and(|policy| policy.has_direct_content())
    {
        spawn_deferred_policy_reconnect(state, app, generation);
        return Ok(());
    }
    spawn_optional_direct_after_connected(
        state,
        app,
        node.clone(),
        nodes.to_vec(),
        home_node.cloned(),
        home_socks5.cloned(),
        secret,
        controller_port,
        mixed_port,
        generation,
        traffic_policy,
        physical_interface,
        service_session,
    );
    Ok(())
}

/// Bind controller publication to the state commit which follows it.
async fn controller_commit_guard<'a>(
    state: &'a Arc<TonoState>, generation: u64, publish: impl FnOnce() + Send,
) -> Result<tokio::sync::MutexGuard<'a, crate::tono::state::TonoInner>, StageFailure> {
    let inner = state.lock().await;
    if inner.connect_generation != generation {
        return Err(StageFailure::Stale);
    }
    publish();
    Ok(inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[tokio::test]
    async fn retired_verification_cannot_publish_a_controller_over_the_replacement() {
        let state = Arc::new(TonoState::for_test());
        let retired = {
            let mut inner = state.lock().await;
            let retired = inner.connect_generation;
            inner.invalidate_connection(true);
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            inner.controller_secret = Some("replacement-controller".into());
            inner.controller_port = Some(19991);
            retired
        };
        let published = AtomicBool::new(false);
        let late = controller_commit_guard(&state, retired, || published.store(true, Ordering::SeqCst)).await;
        assert!(matches!(late, Err(StageFailure::Stale)));
        assert!(!published.load(Ordering::SeqCst), "stale completion must not repoint the live UI controller");
        let inner = state.lock().await;
        assert!(inner.fsm.status().is_connected && inner.fsm.kill_switch_armed());
        assert_eq!(inner.controller_secret.as_deref(), Some("replacement-controller"));
        assert_eq!(inner.controller_port, Some(19991));
    }
}
