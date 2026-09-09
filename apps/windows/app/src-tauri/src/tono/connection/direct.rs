//! Optional DIRECT overlay: resolve, reload, prove, lease heartbeat. Not the connect stage owner.

use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tono_core::{
    EXIT_GROUP_NAME,
    config::{self, RuntimePorts, build_owned_runtime_with_ports},
    node::ValidatedNode,
};
use tono_logging::{Type, logging};
use tono_service_protocol::{
    DirectRuntimeReloadResult, KillSwitchStatus, KillSwitchStatusMode, OwnerSessionProof, ProxyEndpoint,
    ProxyProtocol, RuntimeBundle, ServiceLifecycleState, ServiceStatusSnapshot, StageRuntimeOutcome,
};
use crate::core::service;
use crate::process::AsyncHandler;
use crate::tono::{
    audit::{self, AuditEvent},
    commands, signed_apps,
    state::TonoState,
};
use super::BoxedTask;
use super::cleanup::ensure_fresh;
use super::controller::{
    CONTROLLER_HTTP_TIMEOUT, controller_client, controller_url, lock_kill_switch_with_retries, wait_controller,
};
use super::controller_error_detail;
use super::failure::StageFailure;
use super::platform::write_redacted_copy;
use super::probes::verify_tun_data_plane;

/// The WFP model has a hard endpoint budget. The runtime DIRECT plan and its permits must be
/// generated from the same complete set; silently truncating only the permits creates selective
/// blackholes that look like random application hangs.
pub(super) const MAX_DIRECT_ENDPOINTS: usize = 256;

pub(super) async fn spawn_direct_lease_heartbeat(state: &Arc<TonoState>, generation: u64, heartbeat: DirectLeaseHeartbeat) {
    let task_state = Arc::clone(state);
    let handle = AsyncHandler::spawn(move || {
        Box::pin(direct_lease_heartbeat_loop(task_state, generation, heartbeat)) as BoxedTask
    });
    let mut inner = state.lock().await;
    if inner.connect_generation != generation || !inner.fsm.status().is_connected {
        handle.abort();
        return;
    }
    inner.tasks.abort_direct_lease_heartbeat();
    inner.tasks.direct_lease_heartbeat = Some(handle);
}

pub(super) async fn direct_lease_heartbeat_loop(state: Arc<TonoState>, generation: u64, heartbeat: DirectLeaseHeartbeat) {
    let mut interval = tokio::time::interval(DIRECT_LEASE_HEARTBEAT_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        // Tokio's first tick is immediate, closing the finalize-to-monitor handoff window.
        interval.tick().await;
        {
            let inner = state.lock().await;
            if inner.connect_generation != generation || !inner.fsm.status().is_connected {
                return;
            }
        }
        let renewal = match service::tono_renew_direct_runtime_reload(
            &heartbeat.session,
            heartbeat.reload_id,
            &heartbeat.endpoint_digest,
        )
        .await
        {
            Ok(result) => validate_direct_reload_result(
                &result,
                &heartbeat.session,
                Some(heartbeat.reload_id),
                &heartbeat.endpoint_digest,
            )
            .map(|_| ()),
            Err(error) => Err(format!("{error:#}")),
        };
        if let Err(error) = renewal {
            let redacted = audit::redact(&error);
            logging!(
                error,
                Type::Service,
                "Tono: authenticated DIRECT lease renewal failed; restricting traffic to fail-closed Blocked: {redacted}"
            );
            state.audit().log(AuditEvent::HealthProbeFail {
                probe: "directLeaseHeartbeat",
                error: redacted,
            });
            // Do not reconnect from inside the heartbeat task: a successful fresh attempt would
            // replace this task and abort its own caller mid-commit. Restrict immediately; the
            // independent health monitor observes Blocked and owns the normal reconnect path.
            if let Err(restrict_error) = service::tono_restrict_bootstrap().await {
                logging!(
                    error,
                    Type::Service,
                    "Tono: DIRECT renewal failure could not immediately restrict WFP; the Service lease watchdog remains authoritative: {}",
                    audit::redact(&format!("{restrict_error:#}"))
                );
            }
            return;
        }
    }
}

// ---- WeChat-DIRECT cloud policy (Build 28) ----

/// Product priority: **Claude first**. Hard invariants any optional DIRECT path must preserve:
/// 1. Claude / Anthropic traffic always egresses via `Tono-Exit` (US/JP node), never via
///    `Tono-China-Direct` / the physical China path.
/// 2. System DNS / DoH for non-pinned names always uses `#Tono-Exit` (`1.1.1.1` / `8.8.8.8`
///    through the tunnel) — Claude must never resolve on a mainland recursive resolver.
/// 3. Health failure (WFP / protected DNS / core / data-plane) stays fail-closed: block and
///    reconnect; never fall open to the real NIC for Claude.
///
/// Release gate for the rev-10 fail-closed hot-reload path below. Enabled since 0.0.24: the
/// generation-mismatch defect that made `applyingCloudPolicy` fail deterministically is fixed in
/// `prove_service_reload_mode` (the desired-state proof binds the owner session generation, not
/// the unrelated per-owner write counter). On-device packet capture still gates any further
/// widening of the DIRECT set.
pub(super) const WINDOWS_OPTIONAL_DIRECT_ENABLED: bool = true;

/// Maximum resolved addresses kept per policy domain (Mac parity).
pub(super) const MAX_ADDRESSES_PER_DOMAIN: usize = 8;

/// A cloud policy can currently carry dozens of names. Launching all DoH
/// lookups at once overloaded otherwise healthy distant Reality exits on
/// real mainland-like links, so keep a small, deterministic in-flight cap.
pub(super) const CLOUD_DNS_QUERY_CONCURRENCY: usize = 8;

/// One transient controller/DoH failure must not tear down a protected
/// connection. Permanent controller errors still fail immediately.
pub(super) const CLOUD_DNS_QUERY_ATTEMPTS: u32 = 2;

pub(super) const CLOUD_DNS_QUERY_RETRY_DELAY: Duration = Duration::from_millis(200);

/// Both WeChat and web-domain sets share this one deadline. The enclosing
/// connect transaction remains the final fail-closed ceiling.
pub(super) const CLOUD_POLICY_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(20);

pub(super) const DIRECT_CONFIG_RELOAD_ATTEMPTS: u32 = 2;

pub(super) const DIRECT_CONFIG_RELOAD_RETRY_DELAY: Duration = Duration::from_millis(350);

pub(super) const DIRECT_CONFIG_RELOAD_TIMEOUT: Duration = Duration::from_secs(60);

/// Must stay comfortably below the Service's 60-second committed lease. A dedicated task keeps
/// renewal independent of the health monitor's potentially slow public data-plane probes.
pub(super) const DIRECT_LEASE_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub(super) struct CapturedTrafficPolicy {
    pub(super) revision: i64,
    pub(super) digest: String,
    pub(super) document: tono_core::policy::TonoTrafficPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ServiceCoreIdentity {
    pub(super) pid: u32,
    pub(super) generation: u32,
}

/// Exact proof retained only for the Connected lifetime. The owner-session token is memory-only,
/// and this type deliberately has no `Debug` implementation.
#[derive(Clone)]
pub(super) struct DirectLeaseHeartbeat {
    session: OwnerSessionProof,
    reload_id: u64,
    endpoint_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ControllerDirectRuleProof {
    pub(super) proxy: String,
    pub(super) payload: String,
}

/// Mihomo v1.19.29 `/rules` AND child type for `PROCESS-PATH-REGEX`.
///
/// The packaged sidecar's `/rules` payload uses `RuleType.String()`. The
/// captured PROCESS-NAME rows are `(ProcessName,…)`; this is the same table's
/// `ProcessPathRegex` entry, not a guessed alias.
pub(super) const MIHOMO_PROCESS_PATH_REGEX_TYPE: &str = "ProcessPathRegex";

/// Exact v1.19.29 `/rules` serialization for the trusted `DirectPlan` handed to the runtime
/// builder. Mihomo preserves top-level rule order and one API row per AND rule; `no-resolve` is an
/// internal child option and intentionally does not appear in `Payload()`.
pub(super) fn expected_controller_direct_rules(plan: &tono_core::config::DirectPlan) -> Vec<ControllerDirectRuleProof> {
    let mut expected = Vec::new();
    // Pinned per resolved endpoint, then process-scoped and bounded to the reviewed ports —
    // mirroring `runtime_value` exactly. A rule the runtime carries and this proof does not
    // expect fails the graph check and the connect with it, so the two must move together.
    for (host, address, port) in &plan.tcp_wechat_rules {
        expected.push(ControllerDirectRuleProof {
            proxy: config::DIRECT_GROUP_NAME.to_owned(),
            payload: format!(
                "((Network,tcp) && (DstPort,{port}) && (Domain,{}) && (IPCIDR,{address}/32))",
                host.to_ascii_lowercase()
            ),
        });
    }
    if plan.wechat_process_direct_enabled() {
        for port in &plan.reviewed_direct_ports {
            // Path regexes only: a `PROCESS-NAME` rule matches any binary with that filename,
            // which is not an identity worth pairing with an address-free port permit. See the
            // emitting side in tono-core/src/config.rs.
            for regex in &plan.wechat_process_path_regexes {
                expected.push(ControllerDirectRuleProof {
                    proxy: config::DIRECT_GROUP_NAME.to_owned(),
                    payload: format!(
                        "((Network,tcp) && (DstPort,{port}) && ({MIHOMO_PROCESS_PATH_REGEX_TYPE},{regex}))"
                    ),
                });
            }
        }
    }
    for (address, port) in &plan.udp_wechat_rules {
        for process in tono_core::config::REVIEWED_DIRECT_PROCESS_NAMES {
            expected.push(ControllerDirectRuleProof {
                proxy: config::DIRECT_GROUP_NAME.to_owned(),
                payload: format!(
                    "((Network,udp) && (DstPort,{port}) && (IPCIDR,{address}/32) && (ProcessName,{process}))"
                ),
            });
        }
        for regex in &plan.wechat_process_path_regexes {
            expected.push(ControllerDirectRuleProof {
                proxy: config::DIRECT_GROUP_NAME.to_owned(),
                payload: format!(
                    "((Network,udp) && (DstPort,{port}) && (IPCIDR,{address}/32) && ({MIHOMO_PROCESS_PATH_REGEX_TYPE},{regex}))"
                ),
            });
        }
    }
    for (host, address, port) in &plan.tcp_web_rules {
        expected.push(ControllerDirectRuleProof {
            proxy: config::WEB_DIRECT_GROUP_NAME.to_owned(),
            payload: format!(
                "((Network,tcp) && (DstPort,{port}) && (Domain,{}) && (IPCIDR,{address}/32))",
                host.to_ascii_lowercase()
            ),
        });
    }
    // Address-free web suffixes are emitted only when the signed native-app
    // path permit is present; that is the WFP port boundary they share.
    if plan.wechat_process_direct_enabled() {
        for (suffix, port) in &plan.web_suffix_rules {
            if !tono_core::config::is_address_free_web_suffix(suffix) {
                continue;
            }
            expected.push(ControllerDirectRuleProof {
                proxy: config::WEB_DIRECT_GROUP_NAME.to_owned(),
                payload: format!(
                    "((Network,tcp) && (DstPort,{port}) && (DomainSuffix,{suffix}))"
                ),
            });
        }
    }
    expected
}

pub(super) struct PendingDirectCommit {
    /// Held from the final policy snapshot check through exact endpoint commit, preventing a
    /// policy sync from revoking/replacing the set underneath this transaction.
    _policy_guard: tokio::sync::OwnedRwLockReadGuard<()>,
    policy: CapturedTrafficPolicy,
    selected_node: String,
    session: OwnerSessionProof,
    reload_id: u64,
    endpoints: Vec<ProxyEndpoint>,
    /// Declared to the Service so it renders the reviewed-port permit for exactly the ports
    /// this plan emitted process-scoped rules on — empty when it emitted none.
    reviewed_direct_ports: Vec<u16>,
    endpoint_digest: String,
    core_identity: ServiceCoreIdentity,
    controller_secret: String,
    controller_port: u16,
    expected_controller_rules: Vec<ControllerDirectRuleProof>,
    direct_interface: String,
    require_wechat_direct: bool,
    require_web_direct: bool,
    claude_home: bool,
    wechat_tcp: usize,
    web_tcp: usize,
    udp: usize,
    wechat_process_path_regexes: Vec<String>,
}

/// The applyingCloudPolicy stage. Discovery is optional and occurs while the proven full-tunnel
/// runtime remains untouched. Once the Service's begin operation retracts the TUN/DIRECT grants,
/// every later failure is fail-closed: no second StartClash and no fallback-to-restart path exist.
/// The returned commit keeps the policy read guard and exact endpoints until DNS plus the existing
/// post-lock barrier pass; only then may WFP install the physical-interface permits.
pub(super) fn spawn_optional_direct_after_connected(
    state: &Arc<TonoState>,
    app: &AppHandle,
    node: ValidatedNode,
    nodes: Vec<ValidatedNode>,
    home_node: Option<ValidatedNode>,
    home_socks5: Option<tono_core::CatalogHomeSocks5>,
    secret: String,
    controller_port: u16,
    mixed_port: u16,
    generation: u64,
    traffic_policy: Option<CapturedTrafficPolicy>,
    physical_interface: Option<String>,
    service_session: OwnerSessionProof,
) {
    let state = Arc::clone(state);
    let app = app.clone();
    AsyncHandler::spawn(move || async move {
        if state.lock().await.connect_generation != generation {
            return;
        }
        let pending = match apply_cloud_policy(
            &state,
            &node,
            &nodes,
            home_node.as_ref(),
            home_socks5.as_ref(),
            generation,
            &secret,
            controller_port,
            mixed_port,
            traffic_policy,
            physical_interface,
            &service_session,
        )
        .await
        {
            Ok(pending) => pending,
            Err(error) => {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: optional DIRECT after Connected skipped: {error:?}"
                );
                return;
            }
        };
        let Some(pending) = pending else {
            return;
        };
        if state.lock().await.connect_generation != generation {
            return;
        }
        let wechat_paths = pending.wechat_process_path_regexes.clone();
        match commit_direct_policy_cancellation_safe(&state, generation, pending).await {
            Ok((status, heartbeat)) => {
                let mut inner = state.lock().await;
                if inner.connect_generation != generation || !inner.fsm.status().is_connected {
                    return;
                }
                inner.kill_switch = Some(status);
                inner.applied_wechat_path_regexes = Some(wechat_paths);
                inner.optional_direct_active = true;
                inner.optional_direct_skip = None;
                commands::emit_status(&app, &commands::status_of(&inner));
                drop(inner);
                spawn_direct_lease_heartbeat(&state, generation, heartbeat).await;
            }
            Err(error) => {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: optional DIRECT commit rolled back to full tunnel: {error:?}"
                );
            }
        }
    });
}

pub(super) async fn apply_cloud_policy(
    state: &Arc<TonoState>,
    node: &ValidatedNode,
    nodes: &[ValidatedNode],
    home_node: Option<&ValidatedNode>,
    home_socks5: Option<&tono_core::CatalogHomeSocks5>,
    generation: u64,
    original_secret: &str,
    controller_port: u16,
    mixed_port: u16,
    policy: Option<CapturedTrafficPolicy>,
    physical_interface: Option<String>,
    service_session: &OwnerSessionProof,
) -> Result<Option<PendingDirectCommit>, StageFailure> {
    let Some(policy) = policy else {
        return Ok(None);
    };
    if policy.document.domains.is_empty()
        && policy.document.media_endpoints.is_empty()
        && policy.document.web_domains.is_empty()
        && policy.document.direct_suffixes.is_empty()
    {
        return Ok(None);
    }
    if !WINDOWS_OPTIONAL_DIRECT_ENABLED {
        skip_optional_direct_policy(
            state,
            "optional Windows DIRECT policy is disabled; retaining the proven full-tunnel runtime".to_string(),
        )
        .await;
        return Ok(None);
    }

    let Some(interface) = physical_interface else {
        skip_optional_direct_policy(
            state,
            "cloud DIRECT policy has no pre-TUN physical interface snapshot".to_string(),
        ).await;
        return Ok(None);
    };

    // Resolve through a small bounded pool. WeChat and web sets run in
    // sequence so their separate batches cannot double the global cap.
    // Signed-app discovery is local and independent of controller DNS, so
    // it overlaps the resolution budget instead of adding a serial wait.
    let wechat_path_regexes = tokio::task::spawn_blocking(
        signed_apps::discover_signed_reviewed_direct_path_regexes,
    );
    let resolution = tokio::time::timeout(CLOUD_POLICY_RESOLUTION_TIMEOUT, async {
        let wechat = resolve_direct_domains(original_secret, controller_port, &policy.document.domains, node).await?;
        let web = resolve_direct_domains(original_secret, controller_port, &policy.document.web_domains, node).await?;
        Ok::<_, String>((wechat, web))
    })
    .await
    .map_err(|_| {
        format!(
            "cloud DIRECT DNS resolution exceeded {}s",
            CLOUD_POLICY_RESOLUTION_TIMEOUT.as_secs()
        )
    })
    .and_then(|result| result);
    let (wechat_pins, web_pins) = match classify_optional_direct_resolution(resolution) {
        OptionalDirectResolution::Ready(pins) => pins,
        OptionalDirectResolution::Skip(reason) => {
            // Controller DNS for these pins rides DoH through the exit. An unverified
            // exit times that out; skipping the whole overlay then leaves WeChat on
            // the kill-switch floor. Signed-app path permits do not need those pins.
            logging!(
                warn,
                Type::Service,
                "Tono: cloud DIRECT DNS did not resolve through the exit; continuing with signed-app path permits: {}",
                audit::redact(&reason)
            );
            (Vec::new(), Vec::new())
        }
    };
    let wechat_path_regexes = wechat_path_regexes.await.unwrap_or_default();
    let (plan, direct_endpoints) = match build_direct_plan(
        interface,
        &wechat_pins,
        &web_pins,
        &policy.document.media_endpoints,
        &policy.document.direct_suffixes,
        node,
        wechat_path_regexes,
    ) {
        Ok(plan) => plan,
        Err(reason) => {
            skip_optional_direct_policy(state, reason).await;
            return Ok(None);
        }
    };
    if plan.hosts.is_empty()
        && plan.tcp_wechat_rules.is_empty()
        && plan.tcp_web_rules.is_empty()
        && plan.web_suffix_rules.is_empty()
        && plan.udp_wechat_rules.is_empty()
        && plan.wechat_process_path_regexes.is_empty()
    {
        return Ok(None);
    }
    let expected_controller_rules = expected_controller_direct_rules(&plan);
    // Declared to the Service exactly when `runtime_value` emits process-scoped rules, and with
    // the same condition it uses. A pin existing is not the same as process routing existing:
    // `direct_endpoints` is the union of the WeChat, web and media pins and the Service cannot
    // tell them apart, so left to infer it would widen the boundary for a web-only or
    // media-only policy that routes nothing there.
    let reviewed_direct_ports = if plan.wechat_process_direct_enabled() {
        plan.reviewed_direct_ports.clone()
    } else {
        Vec::new()
    };
    let direct_interface = plan.physical_interface.clone();

    // Build the staged bundle before the irreversible bracket. The controller secret and ports
    // stay byte-identical: this is an in-place reload, not a replacement Core generation.
    ensure_fresh(state, generation).await?;
    let runtime = match build_owned_runtime_with_ports(
        nodes,
        &node.name,
        original_secret,
        Some(&plan),
        home_node.map(|home| home.name.as_str()),
        home_socks5,
        RuntimePorts {
            mixed_port,
            controller_port,
        },
    ) {
        Ok(runtime) => runtime,
        Err(error) => {
            // The full-tunnel runtime is already proven. A bad optional overlay
            // must not tear that tunnel down.
            skip_optional_direct_policy(
                state,
                format!("optional DIRECT runtime could not be built: {error}"),
            ).await;
            return Ok(None);
        }
    };
    write_redacted_copy(state, &runtime.redacted_yaml()).await;
    ensure_fresh(state, generation).await?;
    let core_path = match service::tono_core_binary_path().await {
        Ok(path) => path,
        Err(error) => {
            skip_optional_direct_policy(
                state,
                format!("optional DIRECT staging could not resolve the core path: {error}"),
            ).await;
            return Ok(None);
        }
    };
    let bundle = RuntimeBundle {
        yaml: runtime.yaml().to_string(),
        assets: Vec::new(),
        remote_providers: Vec::new(),
        core_path: core_path.to_string_lossy().into_owned(),
    };
    let endpoint_digest = match tono_service_protocol::direct_endpoint_digest(&direct_endpoints) {
        Ok(digest) => digest,
        Err(error) => {
            skip_optional_direct_policy(
                state,
                format!("optional DIRECT endpoint digest could not be calculated: {error}"),
            ).await;
            return Ok(None);
        }
    };

    // Serialize the final snapshot check against policy sync, then retain the owned read guard in
    // `PendingDirectCommit` until exact endpoint commit finishes.
    let policy_guard = state.begin_policy_activation().await;
    if !direct_context_is_current(state, generation, &node.name, &policy).await {
        drop(policy_guard);
        skip_optional_direct_policy(
            state,
            "cloud DIRECT policy changed before activation; retaining the full-tunnel runtime".to_owned(),
        )
        .await;
        return Ok(None);
    }
    let active_session = service::active_direct_runtime_reload_session().map_err(StageFailure::error)?;
    if active_session != *service_session {
        return Err(StageFailure::error(
            "service owner session changed before DIRECT runtime reload",
        ));
    }

    activate_direct_runtime_cancellation_safe(
        state,
        generation,
        node.name.clone(),
        policy,
        policy_guard,
        service_session.clone(),
        bundle,
        direct_endpoints,
        endpoint_digest,
        original_secret.to_owned(),
        controller_port,
        expected_controller_rules,
        reviewed_direct_ports,
        direct_interface,
        !plan.tcp_wechat_rules.is_empty()
            || !plan.udp_wechat_rules.is_empty()
            || plan.wechat_process_direct_enabled(),
        // Suffix routes share the signed native-app WFP port permit; without
        // that permit they remain accepted policy but are intentionally
        // tunnelled.
        !plan.tcp_web_rules.is_empty()
            || (plan.wechat_process_direct_enabled()
                && plan
                    .web_suffix_rules
                    .iter()
                    .any(|(suffix, _)| tono_core::config::is_address_free_web_suffix(suffix))),
        home_node.is_some() || home_socks5.is_some(),
        plan.tcp_wechat_rules.len(),
        plan.tcp_web_rules.len(),
        plan.udp_wechat_rules.len(),
        plan.wechat_process_path_regexes.clone(),
    )
    .await
}

pub(super) async fn direct_context_is_current(
    state: &Arc<TonoState>,
    generation: u64,
    selected_node: &str,
    policy: &CapturedTrafficPolicy,
) -> bool {
    let inner = state.lock().await;
    inner.connect_generation == generation
        && inner.selected_node.as_deref() == Some(selected_node)
        && inner.policy_tracker.current_revision() == policy.revision
        && inner.policy_tracker.current_digest() == Some(policy.digest.as_str())
        && inner.traffic_policy.as_ref() == Some(&policy.document)
}

pub(super) fn validate_direct_reload_result(
    result: &tono_service_protocol::DirectRuntimeReloadResult,
    session: &OwnerSessionProof,
    expected_reload_id: Option<u64>,
    expected_digest: &str,
) -> Result<u64, String> {
    if result.owner_generation != session.generation {
        return Err(format!(
            "DIRECT commit proof belongs to Service generation {}, expected {}",
            result.owner_generation, session.generation
        ));
    }
    if result.reload_id == 0 {
        return Err("DIRECT commit proof omitted its Service reload identity".to_owned());
    }
    if let Some(expected) = expected_reload_id
        && result.reload_id != expected
    {
        return Err(format!(
            "DIRECT commit proof belongs to reload {}, expected {}",
            result.reload_id, expected
        ));
    }
    if result.endpoint_digest != expected_digest {
        return Err("DIRECT commit proof endpoint digest did not match the requested set".to_owned());
    }
    Ok(result.reload_id)
}

pub(super) fn prove_service_reload_mode(
    snapshot: &ServiceStatusSnapshot,
    session: &OwnerSessionProof,
    expected_mode: KillSwitchStatusMode,
) -> Result<(ServiceCoreIdentity, KillSwitchStatus), String> {
    if snapshot.active_operation.is_some() {
        return Err("Tono Service still reports an active lifecycle mutation".to_owned());
    }
    if !snapshot.is_active || snapshot.active_generation != Some(session.generation) {
        return Err(format!(
            "Tono Service active generation {:?} did not match the captured DIRECT session {}",
            snapshot.active_generation, session.generation
        ));
    }
    // `desired_generation` is the per-owner desired-state *write* counter: the Service bumps it
    // on every persist (start, stop, writer update — `update_owner_desired_state`), so after the
    // first release it permanently runs ahead of the owner *session* generation this proof
    // carries. The session binding is the `active_generation` check above; the desired-state
    // proof is the persisted value itself — this owner's file must say the Core should be
    // running and must have been readable. Comparing the two counters rejected every settled
    // runtime on any machine that had ever disconnected once.
    if snapshot.service_state != ServiceLifecycleState::Running
        || !snapshot.desired_core_should_be_running
        || snapshot.desired_state_unknown
    {
        return Err(format!(
            "Tono Service/Core lifecycle is not settled (state={:?}, desired={}, desired_generation={}, unknown={})",
            snapshot.service_state,
            snapshot.desired_core_should_be_running,
            snapshot.desired_generation,
            snapshot.desired_state_unknown
        ));
    }
    let pid = snapshot
        .core_pid
        .ok_or_else(|| "Tono Service has no running Core for DIRECT reload".to_owned())?;
    let kill_switch = snapshot
        .kill_switch
        .clone()
        .ok_or_else(|| "Tono Service omitted the Windows kill-switch snapshot".to_owned())?;
    let tunnel_expected = expected_mode == KillSwitchStatusMode::Locked;
    if !kill_switch.wanted
        || !kill_switch.live
        || kill_switch.mode != expected_mode
        || kill_switch.tunnel_permit_rendered != tunnel_expected
        || kill_switch.last_error.is_some()
    {
        return Err(format!(
            "DIRECT reload WFP proof failed (wanted={}, live={}, mode={:?}, tunnel={}, error={})",
            kill_switch.wanted,
            kill_switch.live,
            kill_switch.mode,
            kill_switch.tunnel_permit_rendered,
            kill_switch.last_error.is_some()
        ));
    }
    Ok((
        ServiceCoreIdentity {
            pid,
            generation: snapshot.core_generation,
        },
        kill_switch,
    ))
}

pub(super) fn prove_service_endpoint_digest(status: &KillSwitchStatus, expected_digest: &str) -> Result<(), String> {
    let observed = &status.direct_endpoint_digest;
    if observed.len() != 64
        || !observed
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Service returned an invalid DIRECT endpoint digest".to_owned());
    }
    if observed != expected_digest {
        return Err("Service WFP snapshot did not contain the expected exact DIRECT set".to_owned());
    }
    Ok(())
}

pub(super) async fn controller_json(
    client: &reqwest::Client,
    secret: &str,
    controller_port: u16,
    path: &str,
) -> Result<serde_json::Value, String> {
    let response = client
        .get(controller_url(controller_port, path))
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|error| format!("controller {path} request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let detail = response
            .text()
            .await
            .ok()
            .and_then(|body| controller_error_detail(&body));
        return Err(match detail {
            Some(detail) => format!("controller {path} answered {status}: {detail}"),
            None => format!("controller {path} answered {status}"),
        });
    }
    response
        .json()
        .await
        .map_err(|error| format!("controller {path} returned invalid JSON: {error}"))
}

pub(super) async fn reload_controller_config(secret: &str, controller_port: u16, config_path: &str) -> Result<(), String> {
    let client = controller_client(DIRECT_CONFIG_RELOAD_TIMEOUT)?;
    let mut last = String::from("no response");
    for attempt in 1..=DIRECT_CONFIG_RELOAD_ATTEMPTS {
        match client
            .put(controller_url(controller_port, "/configs"))
            .bearer_auth(secret)
            .query(&[("force", true)])
            .json(&serde_json::json!({ "path": config_path }))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => {
                let status = response.status();
                let detail = response
                    .text()
                    .await
                    .ok()
                    .and_then(|body| controller_error_detail(&body));
                last = match detail {
                    Some(detail) => format!("config reload answered {status}: {detail}"),
                    None => format!("config reload answered {status}"),
                };
                if !status.is_server_error() && status != reqwest::StatusCode::TOO_MANY_REQUESTS {
                    return Err(last);
                }
            }
            Err(error) => last = format!("config reload request failed: {error}"),
        }
        if attempt < DIRECT_CONFIG_RELOAD_ATTEMPTS {
            tokio::time::sleep(DIRECT_CONFIG_RELOAD_RETRY_DELAY).await;
        }
    }
    Err(format!("mihomo config reload remained ambiguous after replay: {last}"))
}

pub(super) fn controller_direct_graph_is_active(
    rules: &serde_json::Value,
    proxies: &serde_json::Value,
    expected_direct_rules: &[ControllerDirectRuleProof],
    direct_interface: &str,
    require_wechat_direct: bool,
    require_web_direct: bool,
    claude_home: bool,
) -> Result<(), String> {
    if expected_direct_rules.is_empty() {
        return Err("controller proof was asked to accept an empty DIRECT graph".to_owned());
    }
    let expected_wechat = expected_direct_rules
        .iter()
        .any(|rule| rule.proxy == config::DIRECT_GROUP_NAME);
    let expected_web = expected_direct_rules
        .iter()
        .any(|rule| rule.proxy == config::WEB_DIRECT_GROUP_NAME);
    if expected_wechat != require_wechat_direct || expected_web != require_web_direct {
        return Err("controller proof inputs disagree about the expected DIRECT graph".to_owned());
    }

    let proxy_map = proxies
        .get("proxies")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "controller /proxies omitted its proxy map".to_owned())?;
    if !proxy_map.contains_key(EXIT_GROUP_NAME) {
        return Err(format!("controller runtime omitted proxy {EXIT_GROUP_NAME}"));
    }
    fn prove_direct_outbound(
        proxy_map: &serde_json::Map<String, serde_json::Value>,
        name: &str,
        expected_interface: &str,
        required: bool,
    ) -> Result<(), String> {
        let proxy = proxy_map.get(name);
        if proxy.is_some() != required {
            return Err(format!(
                "controller DIRECT proxy {name} presence was {}, expected {required}",
                proxy.is_some()
            ));
        }
        let Some(proxy) = proxy else { return Ok(()) };
        if proxy.get("type").and_then(serde_json::Value::as_str) != Some("Direct")
            || proxy.get("interface").and_then(serde_json::Value::as_str) != Some(expected_interface)
        {
            return Err(format!(
                "controller DIRECT proxy {name} was not the exact staged physical-interface outbound"
            ));
        }
        Ok(())
    }

    let has_wechat_proxy = proxy_map.contains_key(config::DIRECT_GROUP_NAME);
    if has_wechat_proxy != require_wechat_direct {
        return Err(format!(
            "controller WeChat DIRECT proxy presence was {has_wechat_proxy}, expected {require_wechat_direct}"
        ));
    }
    let has_web_proxy = proxy_map.contains_key(config::WEB_DIRECT_GROUP_NAME);
    if has_web_proxy != require_web_direct {
        return Err(format!(
            "controller web DIRECT proxy presence was {has_web_proxy}, expected {require_web_direct}"
        ));
    }
    prove_direct_outbound(
        proxy_map,
        config::DIRECT_GROUP_NAME,
        direct_interface,
        require_wechat_direct,
    )?;
    prove_direct_outbound(
        proxy_map,
        config::WEB_DIRECT_GROUP_NAME,
        direct_interface,
        require_web_direct,
    )?;

    let rules = rules
        .get("rules")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "controller /rules omitted its ordered rule list".to_owned())?;

    fn expect_rule(
        rule: Option<&serde_json::Value>,
        index: usize,
        expected_type: &str,
        expected_payload: &str,
        expected_proxy: &str,
    ) -> Result<(), String> {
        let rule = rule.ok_or_else(|| format!("controller runtime omitted rule {index}"))?;
        let observed_type = rule.get("type").and_then(serde_json::Value::as_str);
        let observed_payload = rule.get("payload").and_then(serde_json::Value::as_str);
        let observed_proxy = rule.get("proxy").and_then(serde_json::Value::as_str);
        if observed_type != Some(expected_type)
            || observed_payload != Some(expected_payload)
            || observed_proxy != Some(expected_proxy)
        {
            return Err(format!(
                "controller rule {index} did not match the exact staged runtime graph"
            ));
        }
        Ok(())
    }

    // The owned runtime has no user-supplied rules: two loopback exceptions, the
    // exact home pins (domains/IPs first, then process names/path fragments), one row per staged
    // AND selector, and a single final MATCH. Requiring the complete
    // cardinality/order rejects broad, missing, duplicated, or stale DIRECT
    // selectors. With home-broadband split routing the home block also carries
    // CLAUDE_HOME_DOMAINS pointing at Tono-Claude-Home.
    let claude_target = if claude_home {
        config::CLAUDE_HOME_GROUP_NAME
    } else {
        EXIT_GROUP_NAME
    };
    if claude_home && !proxy_map.contains_key(config::CLAUDE_HOME_GROUP_NAME) {
        return Err(format!(
            "controller runtime omitted proxy {}",
            config::CLAUDE_HOME_GROUP_NAME
        ));
    }
    let home_path_regexes = config::home_process_path_regexes();
    let mut home_rows = config::HOME_PROCESS_NAMES.len() + home_path_regexes.len();
    if claude_home {
        home_rows += config::CLAUDE_HOME_DOMAINS.len() + config::CLAUDE_HOME_IPV4_CIDRS.len();
    }
    // + 4 = two loopback rows, the UDP REJECT row, and the final MATCH.
    let expected_len = expected_direct_rules.len() + 3 + home_rows + 1;
    if rules.len() != expected_len {
        return Err(format!(
            "controller runtime returned {} rules, expected the exact {expected_len}-rule graph",
            rules.len()
        ));
    }
    expect_rule(rules.first(), 0, "IPCIDR", "127.0.0.0/8", "DIRECT")?;
    expect_rule(rules.get(1), 1, "IPCIDR", "::1/128", "DIRECT")?;
    // Home pins are TCP-scoped ANDs so assistant UDP falls through to the REJECT
    // row instead of matching a group that cannot carry it and leaking DIRECT.
    let mut index = 2;
    if claude_home {
        for domain in config::CLAUDE_HOME_DOMAINS {
            expect_rule(
                rules.get(index),
                index,
                "AND",
                &format!("((Network,tcp) && (DomainSuffix,{domain}))"),
                config::CLAUDE_HOME_GROUP_NAME,
            )?;
            index += 1;
        }
        for cidr in config::CLAUDE_HOME_IPV4_CIDRS {
            expect_rule(
                rules.get(index),
                index,
                "AND",
                &format!("((Network,tcp) && (IPCIDR,{cidr}))"),
                config::CLAUDE_HOME_GROUP_NAME,
            )?;
            index += 1;
        }
    }
    for process in config::HOME_PROCESS_NAMES {
        expect_rule(
            rules.get(index),
            index,
            "AND",
            &format!("((Network,tcp) && (ProcessName,{process}))"),
            claude_target,
        )?;
        index += 1;
    }
    for regex in &home_path_regexes {
        expect_rule(
            rules.get(index),
            index,
            "AND",
            &format!("((Network,tcp) && ({MIHOMO_PROCESS_PATH_REGEX_TYPE},{regex}))"),
            claude_target,
        )?;
        index += 1;
    }
    for (offset, expected) in expected_direct_rules.iter().enumerate() {
        let rule_index = index + offset;
        expect_rule(rules.get(rule_index), rule_index, "AND", &expected.payload, &expected.proxy)?;
    }
    // Vision cannot carry UDP; unpinned UDP must die here, never fall through to a
    // ruleless DIRECT dial.
    let udp_reject = index + expected_direct_rules.len();
    expect_rule(
        rules.get(udp_reject),
        udp_reject,
        "AND",
        "((Network,udp))",
        "REJECT",
    )?;
    let fallback = expected_len - 1;
    expect_rule(rules.get(fallback), fallback, "Match", "", EXIT_GROUP_NAME)?;
    Ok(())
}

pub(super) async fn verify_controller_direct_runtime(
    secret: &str,
    controller_port: u16,
    expected_controller_rules: &[ControllerDirectRuleProof],
    direct_interface: &str,
    require_wechat_direct: bool,
    require_web_direct: bool,
    claude_home: bool,
) -> Result<(), String> {
    let client = controller_client(CONTROLLER_HTTP_TIMEOUT)?;
    // `/configs` must remain readable from the same authenticated controller after reload. TUN
    // identity itself is proven by the Service lock/WFP snapshot below.
    let _ = controller_json(&client, secret, controller_port, "/configs").await?;
    let (rules, proxies) = tokio::join!(
        controller_json(&client, secret, controller_port, "/rules"),
        controller_json(&client, secret, controller_port, "/proxies"),
    );
    controller_direct_graph_is_active(
        &rules?,
        &proxies?,
        expected_controller_rules,
        direct_interface,
        require_wechat_direct,
        require_web_direct,
        claude_home,
    )
}

pub(super) async fn reconcile_direct_reload_failure(session: &OwnerSessionProof) -> Result<(), String> {
    let snapshot_before = service::tono_service_status_snapshot()
        .await
        .map_err(|error| format!("cannot inspect DIRECT reload ownership: {error:#}"))?;
    if snapshot_before.active_generation != Some(session.generation) {
        // A replacement StartClash owns the machine and its arm operation clears the volatile
        // DIRECT set. Never present a stale transaction's token to the new generation.
        return Ok(());
    }
    let result = service::tono_begin_direct_runtime_reload(session)
        .await
        .map_err(|error| format!("cannot restore the fail-closed DIRECT bracket: {error:#}"))?;
    let empty_digest = tono_service_protocol::direct_endpoint_digest(&[])
        .map_err(|error| format!("cannot calculate empty DIRECT digest: {error}"))?;
    validate_direct_reload_result(&result, session, None, &empty_digest)?;
    let snapshot = service::tono_service_status_snapshot()
        .await
        .map_err(|error| format!("cannot verify fail-closed DIRECT reconciliation: {error:#}"))?;
    let (_, status) = prove_service_reload_mode(&snapshot, session, KillSwitchStatusMode::Blocked)?;
    prove_service_endpoint_digest(&status, &empty_digest)?;
    Ok(())
}

#[allow(clippy::too_many_arguments, reason = "captures one immutable reload transaction")]
pub(super) async fn activate_direct_runtime_cancellation_safe(
    state: &Arc<TonoState>,
    generation: u64,
    selected_node: String,
    policy: CapturedTrafficPolicy,
    policy_guard: tokio::sync::OwnedRwLockReadGuard<()>,
    session: OwnerSessionProof,
    bundle: RuntimeBundle,
    endpoints: Vec<ProxyEndpoint>,
    endpoint_digest: String,
    controller_secret: String,
    controller_port: u16,
    expected_controller_rules: Vec<ControllerDirectRuleProof>,
    // Ports the Service should render the reviewed-port permit for. Non-empty only when this
    // plan emitted process-scoped rules, so the permit and the routing are one surface rather
    // than the Service inferring one from whichever pins happen to exist.
    reviewed_direct_ports: Vec<u16>,
    direct_interface: String,
    require_wechat_direct: bool,
    require_web_direct: bool,
    claude_home: bool,
    wechat_tcp: usize,
    web_tcp: usize,
    udp: usize,
    wechat_process_path_regexes: Vec<String>,
) -> Result<Option<PendingDirectCommit>, StageFailure> {
    let mutation_guard = state.begin_connect_mutation().await;
    if !direct_context_is_current(state, generation, &selected_node, &policy).await {
        drop(mutation_guard);
        return Err(StageFailure::Stale);
    }
    let task_state = Arc::clone(state);
    let task = tokio::spawn(async move {
        let _mutation_guard = mutation_guard;
        let empty_digest = tono_service_protocol::direct_endpoint_digest(&[]).map_err(StageFailure::error)?;
        let reconcile_session = session.clone();
        let mut begin_attempted = false;
        let activation = async {
            let initial = service::tono_service_status_snapshot()
                .await
                .map_err(StageFailure::error)?;
            let (initial_identity, initial_kill_switch) = prove_service_reload_mode(
                &initial,
                &session,
                KillSwitchStatusMode::Locked,
            )
            .map_err(StageFailure::error)?;
            prove_service_endpoint_digest(&initial_kill_switch, &empty_digest)
                .map_err(StageFailure::error)?;

            // From the moment this request is sent its response may be the only thing lost. Every
            // later exit must therefore reconcile to an exact Blocked set; failures above this
            // line have not touched the proven full-tunnel runtime and must not tear it down here.
            begin_attempted = true;
            let begin = service::tono_begin_direct_runtime_reload(&session)
                .await
                .map_err(StageFailure::error)?;
            let reload_id = validate_direct_reload_result(&begin, &session, None, &empty_digest)
                .map_err(StageFailure::error)?;
            ensure_fresh(&task_state, generation).await?;

            let blocked = service::tono_service_status_snapshot()
                .await
                .map_err(StageFailure::error)?;
            let (blocked_identity, blocked_kill_switch) = prove_service_reload_mode(
                &blocked,
                &session,
                KillSwitchStatusMode::Blocked,
            )
            .map_err(StageFailure::error)?;
            if blocked_identity != initial_identity {
                return Err(StageFailure::error(
                    "Core identity changed while the DIRECT fail-closed bracket was opened",
                ));
            }
            prove_service_endpoint_digest(&blocked_kill_switch, &empty_digest)
                .map_err(StageFailure::error)?;

            let config_path = match service::tono_stage_runtime_for_direct_reload(&session, &bundle)
                .await
                .map_err(StageFailure::error)?
            {
                StageRuntimeOutcome::Staged { config_path } if !config_path.trim().is_empty() => {
                    config_path
                }
                StageRuntimeOutcome::Staged { .. } => {
                    return Err(StageFailure::error(
                        "Tono Service staged DIRECT runtime without a config path",
                    ));
                }
                StageRuntimeOutcome::RestartRequired { reason } => {
                    return Err(StageFailure::error(format!(
                        "Tono Service declined in-place DIRECT staging ({reason:?}); unsafe restart fallback is disabled"
                    )));
                }
            };
            ensure_fresh(&task_state, generation).await?;
            reload_controller_config(&controller_secret, controller_port, &config_path)
                .await
                .map_err(StageFailure::error)?;
            wait_controller(&controller_secret, controller_port)
                .await
                .map_err(StageFailure::error)?;
            verify_controller_direct_runtime(
                &controller_secret,
                controller_port,
                &expected_controller_rules,
                &direct_interface,
                require_wechat_direct,
                require_web_direct,
                claude_home,
            )
            .await
            .map_err(StageFailure::error)?;
            ensure_fresh(&task_state, generation).await?;

            lock_kill_switch_with_retries(&session)
                .await
                .map_err(StageFailure::error)?;
            wait_controller(&controller_secret, controller_port)
                .await
                .map_err(StageFailure::error)?;
            let locked = service::tono_service_status_snapshot()
                .await
                .map_err(StageFailure::error)?;
            let (core_identity, locked_kill_switch) =
                prove_service_reload_mode(&locked, &session, KillSwitchStatusMode::Locked)
                    .map_err(StageFailure::error)?;
            if core_identity != initial_identity {
                return Err(StageFailure::error(
                    "Core identity changed during in-place DIRECT runtime reload",
                ));
            }
            prove_service_endpoint_digest(&locked_kill_switch, &empty_digest)
                .map_err(StageFailure::error)?;
            // Do not run the ordinary App HTTPS probe in this bracket. WFP is already locked,
            // while the next connect stage has not yet moved Windows DNS to the protected TUN
            // resolver; a fresh reqwest client would therefore depend on the physical DNS path
            // that the fail-closed policy intentionally blocks. The authoritative TUN proof
            // runs in the Connected-lifetime monitor after protected DNS. Until that check
            // passes, exact physical permits remain absent.
            ensure_fresh(&task_state, generation).await?;

            Ok(PendingDirectCommit {
                _policy_guard: policy_guard,
                policy,
                selected_node,
                session,
                reload_id,
                endpoints,
                reviewed_direct_ports,
                endpoint_digest,
                core_identity,
                controller_secret,
                controller_port,
                expected_controller_rules,
                direct_interface,
                require_wechat_direct,
                require_web_direct,
                claude_home,
                wechat_tcp,
                web_tcp,
                udp,
                wechat_process_path_regexes,
            })
        }
        .await;

        if activation.is_err() && begin_attempted {
            if let Err(reconcile) = reconcile_direct_reload_failure(&reconcile_session).await {
                logging!(
                    error,
                    Type::Service,
                    "Tono: DIRECT reload failed and fail-closed reconciliation also failed: {reconcile}"
                );
            }
        }
        activation.map(Some)
    });
    task.await
        .map_err(|error| StageFailure::error(format!("DIRECT reload reconciliation task failed: {error}")))?
}

pub(super) async fn commit_direct_policy_cancellation_safe(
    state: &Arc<TonoState>,
    generation: u64,
    pending: PendingDirectCommit,
) -> Result<(KillSwitchStatus, DirectLeaseHeartbeat), StageFailure> {
    let mutation_guard = state.begin_connect_mutation().await;
    if !direct_context_is_current(state, generation, &pending.selected_node, &pending.policy).await {
        drop(mutation_guard);
        return Err(StageFailure::Stale);
    }
    let task_state = Arc::clone(state);
    let task = tokio::spawn(async move {
        let _mutation_guard = mutation_guard;
        let reconcile_session = pending.session.clone();
        let result = async {
            let empty_digest = tono_service_protocol::direct_endpoint_digest(&[]).map_err(StageFailure::error)?;
            let before = service::tono_service_status_snapshot()
                .await
                .map_err(StageFailure::error)?;
            let (identity_before, kill_before) =
                prove_service_reload_mode(&before, &pending.session, KillSwitchStatusMode::Locked)
                    .map_err(StageFailure::error)?;
            if identity_before != pending.core_identity {
                return Err(StageFailure::error(
                    "Core identity changed between DIRECT reload verification and endpoint commit",
                ));
            }
            prove_service_endpoint_digest(&kill_before, &empty_digest).map_err(StageFailure::error)?;

            let committed =
                service::tono_replace_direct_endpoints(
                    &pending.session,
                    pending.reload_id,
                    pending.endpoints.clone(),
                    pending.reviewed_direct_ports.clone(),
                )
                    .await
                    .map_err(StageFailure::error)?;
            validate_direct_reload_result(
                &committed,
                &pending.session,
                Some(pending.reload_id),
                &pending.endpoint_digest,
            )
            .map_err(StageFailure::error)?;
            ensure_fresh(&task_state, generation).await?;
            if !direct_context_is_current(&task_state, generation, &pending.selected_node, &pending.policy).await {
                return Err(StageFailure::Stale);
            }

            let after = service::tono_service_status_snapshot()
                .await
                .map_err(StageFailure::error)?;
            let (identity_after, kill_status) =
                prove_service_reload_mode(&after, &pending.session, KillSwitchStatusMode::Locked)
                    .map_err(StageFailure::error)?;
            if identity_after != pending.core_identity {
                return Err(StageFailure::error(
                    "Core identity changed while exact DIRECT endpoints were committed",
                ));
            }
            prove_service_endpoint_digest(&kill_status, &pending.endpoint_digest).map_err(StageFailure::error)?;
            wait_controller(&pending.controller_secret, pending.controller_port)
                .await
                .map_err(StageFailure::error)?;
            verify_controller_direct_runtime(
                &pending.controller_secret,
                pending.controller_port,
                &pending.expected_controller_rules,
                &pending.direct_interface,
                pending.require_wechat_direct,
                pending.require_web_direct,
                pending.claude_home,
            )
            .await
            .map_err(StageFailure::error)?;
            verify_tun_data_plane().await.map_err(StageFailure::error)?;
            ensure_fresh(&task_state, generation).await?;

            let finalized = service::tono_finalize_direct_runtime_reload(
                &pending.session,
                pending.reload_id,
                &pending.endpoint_digest,
            )
            .await
            .map_err(StageFailure::error)?;
            validate_direct_reload_result(
                &finalized,
                &pending.session,
                Some(pending.reload_id),
                &pending.endpoint_digest,
            )
            .map_err(StageFailure::error)?;
            ensure_fresh(&task_state, generation).await?;
            if !direct_context_is_current(&task_state, generation, &pending.selected_node, &pending.policy).await {
                return Err(StageFailure::Stale);
            }
            let finalized_snapshot = service::tono_service_status_snapshot()
                .await
                .map_err(StageFailure::error)?;
            let (finalized_identity, finalized_status) =
                prove_service_reload_mode(&finalized_snapshot, &pending.session, KillSwitchStatusMode::Locked)
                    .map_err(StageFailure::error)?;
            if finalized_identity != pending.core_identity {
                return Err(StageFailure::error(
                    "Core identity changed while the DIRECT lease was finalized",
                ));
            }
            prove_service_endpoint_digest(&finalized_status, &pending.endpoint_digest).map_err(StageFailure::error)?;

            task_state.audit().log(AuditEvent::PolicyActivated {
                wechat_tcp: pending.wechat_tcp,
                web_tcp: pending.web_tcp,
                udp: pending.udp,
            });
            Ok((
                finalized_status,
                DirectLeaseHeartbeat {
                    session: pending.session.clone(),
                    reload_id: pending.reload_id,
                    endpoint_digest: pending.endpoint_digest.clone(),
                },
            ))
        }
        .await;

        if result.is_err() {
            if let Err(reconcile) = reconcile_direct_reload_failure(&reconcile_session).await {
                logging!(
                    error,
                    Type::Service,
                    "Tono: DIRECT endpoint commit failed and exact-permit retraction also failed: {reconcile}"
                );
            }
        }
        result
    });
    task.await
        .map_err(|error| StageFailure::error(format!("DIRECT endpoint reconciliation task failed: {error}")))?
}

/// Resolution failures only disable the optional DIRECT optimization. Keeping
/// the original runtime and its zero-DIRECT WFP policy is the fail-closed
/// outcome: every packet still has to traverse the protected tunnel.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum OptionalDirectResolution<T> {
    Ready(T),
    Skip(String),
}

pub(super) fn classify_optional_direct_resolution<T>(result: Result<T, String>) -> OptionalDirectResolution<T> {
    match result {
        Ok(value) => OptionalDirectResolution::Ready(value),
        Err(reason) => OptionalDirectResolution::Skip(reason),
    }
}

pub(super) async fn skip_optional_direct_policy(state: &Arc<TonoState>, reason: String) {
    let reason = audit::redact(&reason);
    logging!(
        warn,
        Type::Service,
        "Tono: optional cloud DIRECT policy skipped; all traffic remains tunneled: {reason}"
    );
    state.audit().log(AuditEvent::PolicyActivationSkipped {
        reason: reason.clone(),
    });
    let mut inner = state.lock().await;
    inner.optional_direct_active = false;
    inner.optional_direct_skip = Some(reason);
}

/// One (host, usable addresses, ports) pin per policy domain, resolved via
/// the mihomo controller's `/dns/query`. An error rejects the entire DIRECT
/// plan; the caller then continues with zero DIRECT permits.
pub(super) async fn resolve_direct_domains(
    secret: &str,
    controller_port: u16,
    domains: &[tono_core::policy::PolicyDomain],
    node: &ValidatedNode,
) -> Result<Vec<(String, Vec<std::net::Ipv4Addr>, Vec<u16>)>, String> {
    let client = controller_client(CONTROLLER_HTTP_TIMEOUT)?;
    let mut pins = Vec::with_capacity(domains.len());
    for batch in domains.chunks(CLOUD_DNS_QUERY_CONCURRENCY) {
        let queries = batch.iter().map(|domain| {
            let host = domain.host.clone();
            let ports = domain.ports.clone();
            let server = node.server;
            let secret = secret.to_string();
            let client = client.clone();
            async move {
                let addresses = dns_query_a_with_retry(&client, &secret, controller_port, &host).await?;
                let usable: Vec<std::net::Ipv4Addr> = addresses
                    .into_iter()
                    .filter(|ip| tono_core::node::is_public_ipv4(*ip))
                    .filter(|ip| *ip != server)
                    .filter(|ip| !tono_core::policy::is_permanently_protected(*ip))
                    .take(MAX_ADDRESSES_PER_DOMAIN)
                    .collect();
                Ok::<_, String>((host, usable, ports))
            }
        });
        for result in futures::future::join_all(queries).await {
            pins.push(result?);
        }
    }
    Ok(pins)
}

#[derive(Debug)]
pub(super) struct ControllerDnsFailure {
    message: String,
    retryable: bool,
}

pub(super) fn controller_dns_status_is_retryable(status: reqwest::StatusCode) -> bool {
    status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

pub(super) async fn dns_query_a_with_retry(
    client: &reqwest::Client,
    secret: &str,
    controller_port: u16,
    host: &str,
) -> Result<Vec<std::net::Ipv4Addr>, String> {
    let mut last = String::from("no response");
    for attempt in 1..=CLOUD_DNS_QUERY_ATTEMPTS {
        match dns_query_a(client, secret, controller_port, host).await {
            Ok(addresses) => return Ok(addresses),
            Err(error) => {
                last = error.message;
                if !error.retryable {
                    return Err(last);
                }
            }
        }
        if attempt < CLOUD_DNS_QUERY_ATTEMPTS {
            tokio::time::sleep(CLOUD_DNS_QUERY_RETRY_DELAY).await;
        }
    }
    Err(format!(
        "dns query for {host} failed after {CLOUD_DNS_QUERY_ATTEMPTS} attempts: {last}"
    ))
}

/// `GET /dns/query?name=<host>&type=A` through the controller; the response
/// shape is tolerated by collecting every IPv4 literal in the JSON tree.
pub(super) async fn dns_query_a(
    client: &reqwest::Client,
    secret: &str,
    controller_port: u16,
    host: &str,
) -> Result<Vec<std::net::Ipv4Addr>, ControllerDnsFailure> {
    let mut url =
        reqwest::Url::parse(&controller_url(controller_port, "/dns/query")).map_err(|err| ControllerDnsFailure {
            message: err.to_string(),
            retryable: false,
        })?;
    url.query_pairs_mut().append_pair("name", host).append_pair("type", "A");
    crate::tono::integration_profile::delay_remote_operation().await;
    let response = client
        .get(url)
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|err| ControllerDnsFailure {
            message: err.to_string(),
            retryable: true,
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let retryable = controller_dns_status_is_retryable(status);
        let detail = response
            .text()
            .await
            .ok()
            .and_then(|body| controller_error_detail(&body));
        let message = match detail {
            Some(detail) => format!("dns query for {host} answered {status}: {detail}"),
            None => format!("dns query for {host} answered {status}"),
        };
        return Err(ControllerDnsFailure { message, retryable });
    }
    let value: serde_json::Value = response.json().await.map_err(|err| ControllerDnsFailure {
        message: format!("dns query for {host} returned invalid JSON: {err}"),
        retryable: false,
    })?;
    Ok(collect_ipv4_literals(&value))
}

/// Collect every IPv4 literal from a JSON tree (mihomo's dns.Msg JSON nests
/// answers under Header/A fields; shape drift must not break resolution).
pub fn collect_ipv4_literals(value: &serde_json::Value) -> Vec<std::net::Ipv4Addr> {
    fn walk(value: &serde_json::Value, out: &mut Vec<std::net::Ipv4Addr>) {
        match value {
            serde_json::Value::String(text) => {
                if let Ok(ip) = text.parse::<std::net::Ipv4Addr>() {
                    out.push(ip);
                }
            }
            serde_json::Value::Array(items) => items.iter().for_each(|item| walk(item, out)),
            serde_json::Value::Object(map) => map.values().for_each(|item| walk(item, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(value, &mut out);
    out.sort_unstable();
    out.dedup();
    out
}

/// Assemble the runtime plan and the WFP permit tuples. Media addresses are
/// re-checked against the node IP and the permanently protected resolvers
/// (defense in depth on top of sync-time validation). Suffix-level web rules
/// pin no IP: they need no DNS resolution and never join the WFP endpoint
/// set — only the exact (host, IP, port) tuples do.
pub fn build_direct_plan(
    interface: String,
    wechat_pins: &[(String, Vec<std::net::Ipv4Addr>, Vec<u16>)],
    web_pins: &[(String, Vec<std::net::Ipv4Addr>, Vec<u16>)],
    media: &[tono_core::policy::PolicyMedia],
    suffixes: &[tono_core::policy::PolicyDomain],
    node: &ValidatedNode,
    wechat_process_path_regexes: Vec<String>,
) -> Result<(tono_core::config::DirectPlan, Vec<ProxyEndpoint>), String> {
    let mut hosts: Vec<(String, String)> = Vec::new();
    let mut wechat_tcp = Vec::new();
    let mut web_tcp = Vec::new();
    for (is_web, pins) in [(false, wechat_pins), (true, web_pins)] {
        for (host, addresses, ports) in pins {
            for ip in addresses {
                // The selected node's own IP must never become a DIRECT target
                // (resolution already filters it; the plan builder re-checks).
                if *ip == node.server || tono_core::policy::is_permanently_protected(*ip) {
                    continue;
                }
                hosts.push((host.clone(), ip.to_string()));
                for port in ports {
                    if is_web {
                        web_tcp.push((host.clone(), *ip, *port));
                    } else {
                        wechat_tcp.push((host.clone(), *ip, *port));
                    }
                }
            }
        }
    }
    let mut udp: Vec<(std::net::Ipv4Addr, u16)> = Vec::new();
    for entry in media {
        let Ok(ip) = entry.address.parse::<std::net::Ipv4Addr>() else {
            continue;
        };
        if ip == node.server || tono_core::policy::is_permanently_protected(ip) {
            continue;
        }
        for port in &entry.ports {
            udp.push((ip, *port));
        }
    }
    wechat_tcp.sort_unstable();
    wechat_tcp.dedup();
    web_tcp.sort_unstable();
    web_tcp.dedup();
    udp.sort_unstable();
    udp.dedup();
    let mut wechat_process_path_regexes: Vec<String> = wechat_process_path_regexes
        .into_iter()
        .filter(|pattern| pattern.starts_with('^') && config::is_rule_payload_safe(pattern))
        .collect();
    wechat_process_path_regexes.sort();
    wechat_process_path_regexes.dedup();
    wechat_process_path_regexes.truncate(config::MAX_WECHAT_PROCESS_PATH_REGEXES);
    // One (suffix, port) row per entry port; validated ports are already a
    // [80, 443] subset, so this only normalizes order and duplicates.
    let mut web_suffix_rules: Vec<(String, u16)> = Vec::new();
    for entry in suffixes {
        // Address-free WFP path: Bilibili family plus product China suffixes.
        if !tono_core::config::is_address_free_web_suffix(&entry.host) {
            continue;
        }
        for port in &entry.ports {
            web_suffix_rules.push((entry.host.clone(), *port));
        }
    }
    // Product China suffixes whenever the signed native-app WFP port permit
    // will be installed. Domain pins are not required for that permit.
    if !wechat_tcp.is_empty() || !wechat_process_path_regexes.is_empty() {
        for suffix in tono_core::config::ALWAYS_ADDRESS_FREE_WEB_SUFFIXES {
            for port in [80_u16, 443] {
                web_suffix_rules.push((suffix.to_string(), port));
            }
        }
    }
    web_suffix_rules.sort_unstable();
    web_suffix_rules.dedup();

    let mut endpoint_keys: std::collections::BTreeSet<(std::net::Ipv4Addr, u16, bool)> = wechat_tcp
        .iter()
        .chain(web_tcp.iter())
        .map(|(_, ip, port)| (*ip, *port, false))
        .collect();
    endpoint_keys.extend(udp.iter().map(|(ip, port)| (*ip, *port, true)));
    if endpoint_keys.len() > MAX_DIRECT_ENDPOINTS {
        return Err(format!(
            "cloud DIRECT policy resolved to {} unique endpoints; maximum is {MAX_DIRECT_ENDPOINTS}",
            endpoint_keys.len()
        ));
    }
    let endpoints = endpoint_keys
        .into_iter()
        .map(|(ip, port, is_udp)| ProxyEndpoint {
            ip: ip.to_string(),
            port,
            protocol: if is_udp { ProxyProtocol::Udp } else { ProxyProtocol::Tcp },
        })
        .collect();

    let plan = tono_core::config::DirectPlan {
        physical_interface: interface,
        hosts,
        tcp_wechat_rules: wechat_tcp,
        tcp_web_rules: web_tcp,
        web_suffix_rules,
        udp_wechat_rules: udp,
        wechat_process_path_regexes,
        // Straight from the Service crate, not a second copy of the numbers: the rules emitted
        // from this plan and the WFP permit the Service renders are then the same surface by
        // construction. That is the whole reason the constant lives in
        // `tono_service_protocol` rather than once in each crate that needs it.
        reviewed_direct_ports: tono_service_protocol::REVIEWED_DIRECT_PORTS.to_vec(),
    };
    Ok((plan, endpoints))
}
