//! WFP rule configuration rendered from the armed state.

use super::*;

/// The rule model's view of an armed session, given who the running core is. Pure, so the
/// tunnel-permit lifetime rule is testable without a core.
pub(super) fn rule_config_for(armed: &Armed, current_core: Option<CoreInstance>) -> RuleConfig {
    let tun_luid = tunnel_permit_luid(armed, current_core);
    RuleConfig {
        mode: armed.intent.mode,
        endpoints: armed.intent.endpoints.clone(),
        api_host_ips: armed
            .intent
            .api_host_ips
            .iter()
            .filter_map(|ip| ip.parse::<IpAddr>().ok())
            .collect(),
        tun_luid,
        app_path: armed.intent.app_path.clone(),
        tono_app_path: installed_tono_app_path(),
        // DIRECT is a bypass of a live tunnel, never an independent escape hatch. A missing or
        // changed core identity retracts both grants in the same expected-set transaction.
        direct_endpoints: if armed.intent.mode == KillSwitchStatusMode::Locked && tun_luid.is_some()
        {
            armed.direct_endpoints.clone()
        } else {
            Vec::new()
        },
        reviewed_direct_ports: if armed.intent.mode == KillSwitchStatusMode::Locked
            && tun_luid.is_some()
        {
            armed.reviewed_direct_ports.clone()
        } else {
            Vec::new()
        },
    }
}

/// Whether the last render had to drop an orphaned tunnel permit. Only the transitions are
/// logged: the watchdog renders once a second, and a silently blocked tunnel is the one
/// outcome of this rule that needs evidence in the service log.
static TUNNEL_PERMIT_ORPHANED: AtomicBool = AtomicBool::new(false);

/// Whether the **last successful exact install/verify** proved the tunnel permit in the live set.
///
/// Reported as `KillSwitchStatus::tunnel_permit_rendered`. `mode: Locked` alone cannot say
/// this: a locked session whose permit was retracted (a core respawn, or a `core_instance` that
/// could not be identified at lock time) is byte-for-byte identical on the wire to a locked
/// session that is carrying traffic, while every application on the machine has its traffic
/// dropped leaving the TUN. This is what makes the two distinguishable to the app.
pub(super) static TUNNEL_PERMIT_RENDERED: AtomicBool = AtomicBool::new(false);

/// The rule model's view of an armed session for a core identity the caller has **already
/// read**.
///
/// Threading the value in is the point: `lock` records `armed.core_instance` and then renders
/// from it in the same breath, and the two must be the same read. `current_core_instance` goes
/// through `status_snapshot_nonblocking`, which falls back to a cache whenever the core manager
/// is busy, so two reads a few microseconds apart can legitimately disagree. When they did, the
/// recorded instance was the stale one (typically `None`) and the rendered one was the truth:
/// `tunnel_permit_luid` then refused the permit for ever — an unidentified grant is
/// unrevivable by design — and the machine sat at `mode: Locked, live: true, verified: true`
/// with no tunnel permit at all, dropping every application's traffic while every health check
/// passed. One read, threaded through, cannot disagree with itself.
pub(super) fn rule_config_rendering(armed: &Armed, current_core: Option<CoreInstance>) -> RuleConfig {
    let config = rule_config_for(armed, current_core);
    let orphaned = armed.tun_luid.is_some() && config.tun_luid.is_none();
    if orphaned != TUNNEL_PERMIT_ORPHANED.swap(orphaned, Ordering::Relaxed) {
        if orphaned {
            tracing::warn!(
                "wfp: the tunnel permit was granted for a core instance that is no longer \
                 running; falling back to the pre-lock policy, so tunnel traffic stays blocked \
                 until the app locks again"
            );
        } else {
            tracing::info!("wfp: the tunnel permit matches the running core again");
        }
    }
    config
}
