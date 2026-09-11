//! The connect stage sequence. Stage order and cancellation-safe IPC are unchanged.
//! Adapters live in sibling modules. Do not give this module its own generation,
//! cleanup owner, or reconnect loop.

use std::sync::Arc;
use tauri::AppHandle;
use tono_core::{
    config::{self, build_owned_runtime_with_transport, generate_controller_secret},
    connection::ConnectStage,
    node::ValidatedNode,
};
use tono_logging::{Type, logging};
use tono_service_protocol::{KillSwitchConfig, RuntimeBundle};

use super::cleanup::{
    commit_protection_cancellation_safe, enable_dns_cancellation_safe, ensure_fresh, stale_after_arm, stale_after_dns, start_core_cancellation_safe,
};
use super::controller::{
    allocate_runtime_ports, configure_owned_controller_for_ui, lock_kill_switch_with_retries, preflight_bfe,
    admit_dns_listener, preflight_dns_listener, wait_controller,
};
use super::endpoints::proxy_endpoints_for;
use super::monitor::{
    bootstrap_hosts, refresh_control_plane_pins_from_service, spawn_advisory_exit_delay,
    spawn_control_plane_pin_refresh, spawn_exit_identity_lookup, spawn_isp_lookup,
    spawn_network_monitor,
};
use super::probes::{capture_admission_core, verify_fake_ip_with_repair};
use super::status::set_stage;
use super::direct::{CapturedTrafficPolicy, WINDOWS_OPTIONAL_DIRECT_ENABLED, spawn_optional_direct_after_connected};
use super::platform::{detect_physical_interface, write_redacted_copy};
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
    transport: tono_core::node::ExitTransport,
    generation: u64,
    started: std::time::Instant,
    transaction: &ConnectTransaction,
) -> Result<(), StageFailure> {
    // Only the selected VPS receives a physical endpoint permit. The residential
    // SOCKS5 hop is dialed through Tono-Exit, never through a second physical socket.
    let home_socks5 = routing.and_then(|routing| routing.home_socks5.as_ref());
    let legacy_home = routing.and_then(|routing| routing.home_proxy.as_deref());
    if legacy_home.is_some() {
        return Err(StageFailure::error("旧 homeProxy 家宽配置不受支持，请迁移到 homeSocks5"));
    }
    let proxy_endpoints = proxy_endpoints_for(node, transport).map_err(StageFailure::error)?;

    transaction.check("preparing service")?;
    set_stage(state, app, ConnectStage::PreparingService, generation, false, started).await?;
    // Home ISP, before WFP. Fail copy may suggest a city; the selected node stays put.
    spawn_isp_lookup(state, app, generation);

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
    // the runtime plan disagree with the WFP preflight that was actually performed.
    let traffic_policy = {
        let inner = state.lock().await;
        inner.traffic_policy.clone().map(|document| CapturedTrafficPolicy {
            revision: inner.policy_tracker.current_revision(),
            digest: inner.policy_tracker.current_digest().unwrap_or_default().to_owned(),
            document,
        })
    };
    let needs_physical_interface = WINDOWS_OPTIONAL_DIRECT_ENABLED
        && traffic_policy.as_ref().is_some_and(|policy| {
            !policy.document.domains.is_empty()
                || !policy.document.media_endpoints.is_empty()
                || !policy.document.web_domains.is_empty()
                || !policy.document.direct_suffixes.is_empty()
        });

    // The preparation probes are independent of each other and all read-only /
    // cancellation-safe (the two port binds are released immediately; the core-path query is a
    // read IPC), so they run concurrently under one transaction wait instead of paying their
    // worst cases back to back:
    //  - F1: compiled + Service-owned learned bootstrap pins, without an external
    //    resolver wait. Fresh API DNS is advisory after Connected, through the tunnel.
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
        core_path,
        bfe_preflight,
    ) = transaction
        .wait("preparing service", async {
            tokio::join!(
                transaction.wait("bootstrap pin adoption", async {
                    refresh_control_plane_pins_from_service(state).await;
                    bootstrap_hosts().await
                }),
                async {
                    if needs_physical_interface {
                        Some(detect_physical_interface().await)
                    } else {
                        None
                    }
                },
                allocate_runtime_ports(),
                transaction.wait("DNS listener ownership", admit_dns_listener(
                    preflight_dns_listener(), async { active_runtime_resume_status().await.is_some() },
                )),
                service::tono_core_binary_path(),
                preflight_bfe(),
            )
        })
        .await?;
    let bootstrap_api_hosts = bootstrap_api_hosts?;
    let runtime_ports = runtime_ports.map_err(StageFailure::error)?;
    bfe_preflight.map_err(StageFailure::error)?;
    let controller_port = runtime_ports.controller_port;
    let mixed_port = runtime_ports.mixed_port;
    if dns_preflight?.map_err(StageFailure::error)? {
        logging!(info, Type::Service, "Tono: protected owner retains DNS listener until fail-closed Core replacement");
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
    // §5: the owned runtime carries a fresh random controller secret; only
    // the redacted copy may touch disk.
    let secret = generate_controller_secret();
    let runtime = build_owned_runtime_with_transport(
        nodes,
        &node.name,
        &secret,
        None,
        None,
        home_socks5,
        runtime_ports,
        transport,
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
    set_stage(state, app, ConnectStage::StartingKillSwitch, generation, false, started).await?;
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
            // A disconnect/switch bumped us while the StartClash IPC was in
            // flight; it cannot be retracted. Patch the late arm (H-1).
            drop(inner);
            return Err(stale_after_arm(state, generation).await);
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
    set_stage(state, app, ConnectStage::StartingTunnel, generation, true, started).await?;
    set_stage(state, app, ConnectStage::LockingTraffic, generation, true, started).await?;
    let (controller_ready, lock_ready) = transaction
        .wait("controller readiness and lock", async {
            tokio::join!(
                transaction.wait("controller ready", wait_controller(&secret, controller_port)),
                transaction.wait("WFP lock and TUN permit", lock_kill_switch_with_retries(&service_session)),
            )
        })
        .await?;
    controller_ready?.map_err(StageFailure::error)?;
    lock_ready?.map_err(StageFailure::error)?;

    // Observation only: no await on the green-light path, no route mutation or verdict.
    // Evidence closes before failure cleanup, so a late native answer cannot rewrite history.
    let route_state = Arc::clone(state);
    let route_node = node.server;
    tokio::spawn(async move {
        let observation = crate::tono::route_diagnostics::observe(route_node, config::TUN_DEVICE_NAME).await;
        let mut inner = route_state.lock().await;
        if inner.connect_generation == generation {
            inner.attempt_evidence.routes(generation, commands::epoch_millis(), observation);
        }
    });

    // Advisory only: `/delay` is display RTT, never the Connected verdict.
    spawn_advisory_exit_delay(state, app, generation);

    // Optional DIRECT is applied only after Connected. The critical path stays full-tunnel.

    // Connected gate is Proton-shaped: WFP lock (no real-IP leak) + fake-ip DNS
    // (no resolver leak). Third-party TUN HTTPS (gstatic / Cloudflare / Apple)
    // is not on this clock — the user opening a site is the usability check.
    // Only an uncommitted first-admit failure may release. Committed sessions stay blocked.
    set_stage(state, app, ConnectStage::SecuringDns, generation, true, started).await?;
    let (dns_ready, before_fake_ip) = transaction.wait("DNS proof and Core identity", async {
        tokio::join!(
            transaction.wait("DNS live apply and readback", enable_dns_cancellation_safe(state, generation, service_session.clone())),
            transaction.wait("Core identity before fake-ip", service::tono_service_status_snapshot()),
        )
    }).await?;
    dns_ready??;
    let snapshot = before_fake_ip?.map_err(StageFailure::error)?;
    {
        let mut inner = state.lock().await;
        if inner.connect_generation == generation {
            inner.attempt_evidence.service(generation, commands::epoch_millis(), &snapshot);
        }
    }
    let expected = capture_admission_core(&snapshot, &service_session).map_err(StageFailure::error)?;
    ensure_fresh(state, generation).await?;
    transaction.wait("system fake-ip", verify_fake_ip_with_repair(|| {
        super::admission_repair::refresh_dns_once(state, generation, &service_session, &expected, routing, transaction)
    })).await??;
    ensure_fresh(state, generation).await?;
    let proof = transaction.wait("fresh WFP proof and protection commit",
        commit_protection_cancellation_safe(state, generation, service_session.clone(), expected),
    ).await??;
    {
        let mut inner = state.lock().await;
        if inner.connect_generation == generation {
            inner.attempt_evidence.proof(generation, commands::epoch_millis(), &proof);
        }
    }
    let kill_status = proof.kill_switch;

    // The Tono runtime owns a fresh HTTP controller port and secret on every connection. The
    // dashboard reuses the Mihomo plugin's traffic WebSocket, so point that plugin at this
    // generation before publishing Connected. Updating the protocol last prevents a subscriber
    // from observing a half-configured HTTP context.
    configure_owned_controller_for_ui(state, app, &secret, controller_port);

    // §6.10: only now Connected; monitors start.
    {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            drop(inner);
            return Err(stale_after_arm(state, generation).await);
        }
        inner.kill_switch = Some(kill_status);
        inner.controller_generation = inner.controller_generation.wrapping_add(1);
        inner.fsm.mark_protection_committed();
        // The Service commit has succeeded, so even a concurrent policy mismatch
        // must keep blocking. Never publish Connected for a superseded home route.
        if !super::same_residential_route(inner.routing.as_ref(), routing) {
            return Err(StageFailure::error("家宽分流配置在连接过程中变化，保持保护并重新应用"));
        }
        if inner.exit_transport != transport || !inner.nodes.iter().any(|current|
            node.same_transport_endpoint(current, transport)) {
            return Err(StageFailure::error("VPS 传输配置在连接过程中变化，保持保护并重新应用"));
        }
        inner.applied_routing = routing.cloned();
        inner.applied_exit_transport = Some(transport);
        inner.applied_nodes = nodes.iter().filter(|node| node.supports_transport(transport)).cloned().collect();
        // Protection is committed. Exit usability is advisory: third-party TUN
        // HTTPS must not be claimed verified here, or a later flap re-arms a
        // teardown veto on gstatic/Cloudflare/Apple.
        inner.last_admitted_node = Some(node.name.clone());
        inner.fsm.connect_succeeded().map_err(StageFailure::error)?;
        inner.unverified_since = None;
        inner.last_unverified_probe_delay = None;
        inner.exit_probe_pending = false;
        crate::tono::update_handoff::mark_committed();
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
        commands::emit_status(app, &commands::status_of(&inner));
    }
    state.audit().log(AuditEvent::ConnectOk {
        node: node.name.clone(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        outcome: "protectionReady",
    });
    let copy_state = Arc::clone(state);
    let redacted = runtime.redacted_yaml();
    crate::process::AsyncHandler::spawn(move || async move {
        if copy_state.lock().await.connect_generation == generation {
            write_redacted_copy(&copy_state, &redacted).await;
        }
    });
    spawn_network_monitor(state, app).await;
    spawn_exit_identity_lookup(state, app, generation);
    let residential_target = home_socks5.map(|_| config::HOME_SOCKS5_OUTBOUND_NAME.to_owned());
    spawn_control_plane_pin_refresh(state, app, generation, residential_target).await;
    spawn_optional_direct_after_connected(
        state,
        app,
        node.clone(),
        nodes.to_vec(),
        None,
        home_socks5.cloned(),
        transport,
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
