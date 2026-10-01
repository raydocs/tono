//! Connected-lifetime health classification for the Windows connect monitor.

use std::time::Duration;

use tono_service_protocol::{
    DnsProtectionStatus, KillSwitchStatus, KillSwitchStatusMode, ServiceStatusSnapshot,
};

/// H4: consecutive *quiet* missing-core samples before a core change is believed. The Service's
/// `/status` reports `core_pid: None, restart_count: 0` on a non-error path — whenever its
/// per-poll `is_active` check reads `Ok(None)` it considers the session inactive — so a single
/// such sample must not be able to tear a healthy tunnel down. Same treatment as `core_is_gone`
/// in `core/runstate/owner.rs`.
pub const CORE_MISSING_SUSTAINED_SAMPLES: u32 = 2;
/// P0-13: bursts of network events inside this window merge into a single
/// invalidation (interface-level filtering — GetBestRoute2 — is the
/// documented follow-up; the debounce covers the common route-flap storm).
pub const NETWORK_EVENT_DEBOUNCE: Duration = Duration::from_secs(2);
/// F2: consecutive failures before the tunnel is declared dead.
///
/// H7 — the threshold's premise ("two consecutive failures ≈ 4 s of sustained failure") holds
/// only because the monitor's interval uses [`MissedTickBehavior::Delay`]. Under the default
/// `Burst`, a tick that overran (each tick makes two named-pipe round trips, and the Windows pipe
/// connect is synchronous and bounded only by a 30 s guard) is followed by the next tick ~0 ms
/// later, so two samples milliseconds apart could read the *same* stale value and tear down a
/// healthy tunnel. Never build the monitor's interval anywhere but [`monitor_interval`].
pub const HEALTH_FAILURE_THRESHOLD: u32 = 2;

/// The independent health legs of the connected-lifetime monitor (F2).
///
/// H8 — a failing `tono_service_status_snapshot()` used to increment *both* the kill-switch and
/// the protected-DNS counters against an `||` threshold test, so a single failed observation
/// counted as two failures and two failing polls guaranteed a teardown (with H7, two polls 0 ms
/// apart). It now has its own leg: one failed observation is one failure, on one counter.
/// Fail-closed is preserved — a dead Service still reaches `HEALTH_FAILURE_THRESHOLD` on that
/// leg and invalidates Connected — but at the honest rate of one failure per tick, and the
/// unobserved legs are never *reset* by a failed poll either.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct HealthLegs {
    /// Consecutive unhealthy kill-switch snapshots.
    pub kill_switch: u32,
    /// Consecutive unhealthy protected-DNS snapshots.
    pub protected_dns: u32,
    /// Consecutive failed periodic exit probes.
    pub probe: u32,
    /// Consecutive failed Service status IPCs.
    pub service: u32,
}

impl HealthLegs {
    /// One failed Service observation: exactly one failure, on the Service leg. The other legs
    /// were not observed at all, so they are neither incremented nor cleared.
    pub const fn observe_service_failure(&mut self) {
        self.service = self.service.saturating_add(1);
    }

    /// A Service snapshot arrived; the Service leg is healthy again.
    pub const fn observe_service_ok(&mut self) {
        self.service = 0;
    }

    pub const fn observe_kill_switch(&mut self, unhealthy: bool) {
        self.kill_switch = if unhealthy {
            self.kill_switch.saturating_add(1)
        } else {
            0
        };
    }

    pub const fn observe_protected_dns(&mut self, unhealthy: bool) {
        self.protected_dns = if unhealthy {
            self.protected_dns.saturating_add(1)
        } else {
            0
        };
    }

    pub const fn observe_probe(&mut self, failed: bool) {
        self.probe = if failed { self.probe.saturating_add(1) } else { 0 };
    }

    /// Any leg that reached the threshold invalidates Connected.
    pub const fn invalid(&self) -> bool {
        health_threshold_reached(self.kill_switch)
            || health_threshold_reached(self.protected_dns)
            || health_threshold_reached(self.probe)
            || health_threshold_reached(self.service)
    }

    /// A sustained failure of the fail-closed boundary itself. A working HTTPS
    /// request cannot overrule this: traffic may flow now while the missing WFP
    /// barrier would leak it the moment the tunnel dies, and unprotected DNS is
    /// already outside the tunnel contract.
    pub const fn protection_invalid(&self) -> bool {
        health_threshold_reached(self.kill_switch)
            || health_threshold_reached(self.protected_dns)
    }
}

/// One core-identity observation against the recorded baseline (H4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreSample {
    /// Same pid, no restart-counter bump.
    Unchanged,
    /// The Service reports no core while we recorded one. This is the *quiet* path — a
    /// `core_pid: None, restart_count: 0` payload the Service emits whenever its per-poll
    /// `is_active` check reads `Ok(None)`, with no error anywhere — so it must be sustained
    /// before it counts as a change.
    Missing,
    /// A different live pid, or a strictly increased restart counter: the Service is explicitly
    /// reporting a crash/restart, which still fires on the first sample.
    Restarted,
}

/// Classify one `/status` core-identity sample (M4/H4). `restart_count` counts only as an
/// *increase*: the quiet inactive payload resets it to 0, and a decrease is that artefact, never
/// a restart.
pub fn classify_core_sample(
    last_pid: Option<u32>,
    last_restart_count: Option<u32>,
    observed_pid: Option<u32>,
    observed_restart_count: u32,
) -> CoreSample {
    if observed_pid.is_none() && last_pid.is_some() {
        return CoreSample::Missing;
    }
    if last_pid != observed_pid {
        return CoreSample::Restarted;
    }
    match last_restart_count {
        Some(previous) if observed_restart_count > previous => CoreSample::Restarted,
        _ => CoreSample::Unchanged,
    }
}

/// Whether a classified sample invalidates Connected, given how many consecutive `Missing`
/// samples (this one included) have been seen. `Missing` needs
/// [`CORE_MISSING_SUSTAINED_SAMPLES`]; an explicit restart report does not.
pub const fn core_change_fires(sample: CoreSample, missing_samples: u32) -> bool {
    match sample {
        CoreSample::Unchanged => false,
        CoreSample::Restarted => true,
        CoreSample::Missing => missing_samples >= CORE_MISSING_SUSTAINED_SAMPLES,
    }
}

/// P0-13 debounce: only the first change inside the window invalidates Connected.
///
/// H5 — `last_network_event_at` must be cleared on connect success along with the other monitor
/// seeds. It was not, so a reconnect completing in under [`NETWORK_EVENT_DEBOUNCE`] silently
/// *discarded* its first genuine event (the counter seed still advanced, so the event was lost,
/// not deferred). `None` — the post-reset state — always fires.
pub fn network_event_fires(changed: bool, since_last_event: Option<Duration>) -> bool {
    changed && since_last_event.is_none_or(|elapsed| elapsed >= NETWORK_EVENT_DEBOUNCE)
}

/// Keep a counter the debounce did not accept. Advancing it anyway makes the
/// next tick look quiet, so the change is lost instead of retried when
/// [`NETWORK_EVENT_DEBOUNCE`] elapses. That is the loss H5 already named for
/// the post-connect seed.
pub fn next_network_events_counter(
    stored: Option<u64>,
    observed: u64,
    first_sample: bool,
    invalidated: bool,
) -> Option<u64> {
    let changed = !first_sample && stored != Some(observed);
    if first_sample || !changed || invalidated {
        Some(observed)
    } else {
        stored
    }
}

/// A core-identity change inside the debounce window must stay visible.
/// Committing the new pid while the event is suppressed makes the next
/// sample look unchanged.
pub const fn commit_core_baseline(first_sample: bool, core_changed: bool, invalidated: bool) -> bool {
    first_sample || !core_changed || invalidated
}

/// A Windows route/interface notification is only a hint: WinTUN creation, protected-DNS
/// reconciliation, and their delayed IP Helper callbacks can all arrive after Connect has
/// already committed. Keep the fail-closed response for a changed Core identity or a failed
/// health leg, but require a fresh locked data-plane failure before a notification by itself
/// tears down a tunnel that is still carrying authenticated HTTPS traffic.
pub fn monitor_requires_reconnect(
    event_invalidated: bool,
    core_changed: bool,
    health_invalid: bool,
    event_probe_failed: bool,
    owned_direct_reload: bool,
) -> bool {
    health_invalid || (event_invalidated && (core_changed || (event_probe_failed && !owned_direct_reload)))
}

/// X2-1: whether a session whose network changed may stay in place.
///
/// The TUN proof covers only the tunnel: Mihomo re-detects the tunnel's own uplink, but the
/// optional DIRECT outbound is bound by name (`interface-name`) to the adapter captured before
/// the first Core start, and nothing re-binds it afterwards. A proven tunnel therefore keeps the
/// session only while that adapter is still one of the usable hardware uplinks. Otherwise — the
/// adapter is gone, or the uplinks could not be read (`None`) — the caller must run the same
/// protected teardown + reconnect as any other invalidation, which rediscovers the adapter before
/// the next Core start. A session without a committed DIRECT overlay has no such binding.
pub fn may_recover_in_place(
    tunnel_proven: bool,
    committed_direct_interface: Option<&str>,
    usable_uplinks: Option<&[String]>,
) -> bool {
    tunnel_proven
        && committed_direct_interface.is_none_or(|committed| {
            usable_uplinks.is_some_and(|uplinks| uplinks.iter().any(|uplink| uplink == committed))
        })
}

/// What one [`handle_network_change`] call did to the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkChangeOutcome {
    /// The locked TUN still carried traffic, so the core was never stopped and this session —
    /// generation, tasks and all — is the same one that was Connected before the event.
    RecoveredInPlace,
    /// The session was torn down, handed to a newer generation, or was never this caller's to
    /// act on. Nothing connection-scoped survives it.
    Handled,
}

/// Whether a connection-scoped loop keeps running after one [`handle_network_change`] call.
///
/// Only the recovered-in-place verdict leaves the loop's own session alive, and its callers
/// used to treat every call as terminal. One such event — roughly four seconds of Service IPC
/// unavailability while mihomo and WFP are untouched, which an SCM recovery restart or the
/// updater's replace-runtime step produces — therefore ended the connection-phase health
/// monitor for the rest of the session, and nothing restarts it before the next connect. With
/// it went the 120 s exit probe, the one leg that notices a dead exit behind a live tunnel.
pub const fn connection_loop_continues(outcome: NetworkChangeOutcome) -> bool {
    matches!(outcome, NetworkChangeOutcome::RecoveredInPlace)
}

/// F2: while Connected, the barrier must be wanted, live, fully locked, and actually
/// carrying the tunnel; anything else (or no answer) is unhealthy.
///
/// `tunnel_permit_rendered` is here because the other three cannot answer the question. The
/// Service's own doc on the field says it: a `Locked` session whose permit was retracted —
/// the core was respawned, or the core instance could not be identified when the lock was
/// taken — looks exactly like a `Locked` session that is carrying traffic, while every
/// application's traffic is in fact dropped leaving the TUN, and `wanted`/`verified`/`live`
/// all keep reporting health. `is_protected_startup_replacement_candidate` and
/// `mark_verified_committed` already require the field; the continuous leg did not, so the
/// one state that reads as Connected while nothing gets out was the one it scored healthy.
///
/// No version gate is needed: the field arrived in protocol revision 12 and
/// `MIN_REQUIRED_SERVICE_REVISION` is now 14, so every Service this App will pair
/// with sets it. The floor only ever rises, which is what keeps this true without
/// a check here.
pub fn kill_switch_unhealthy(status: Option<&KillSwitchStatus>) -> bool {
    match status {
        Some(status) => !(status.wanted
            && status.live
            && status.mode == KillSwitchStatusMode::Locked
            && status.tunnel_permit_rendered),
        None => true,
    }
}

/// This session's own DIRECT fail-closed bracket retracts the TUN permit and sets Blocked.
/// That is expected until the reload deadline; it is not an external failure.
pub fn owned_direct_reload_in_flight(
    reload_until: Option<(u64, std::time::Instant)>,
    connect_generation: u64,
    now: std::time::Instant,
) -> bool {
    reload_until.is_some_and(|(generation, until)| generation == connect_generation && now < until)
}

/// #1228: whether a Core identity change seen on this tick belongs to this session's own DIRECT
/// reload. The sing-box path replaces the process, so the pid moves on purpose. A marker set,
/// cleared or replaced since the tick began counts too: the snapshot may straddle the
/// replacement, and the reload re-baselines the proved pid only while its marker is set.
pub fn core_identity_change_owned(
    owned_at_tick_start: bool,
    marker_at_tick_start: Option<(u64, std::time::Instant)>,
    marker_now: Option<(u64, std::time::Instant)>,
    connect_generation: u64,
    now: std::time::Instant,
) -> bool {
    owned_at_tick_start
        || marker_now != marker_at_tick_start
        || owned_direct_reload_in_flight(marker_now, connect_generation, now)
}

/// While this session owns a DIRECT reload, a retracted tunnel permit is expected whether the
/// Service has already published Blocked or still reports Locked: the sing-box replacement's
/// retraction renders the permit away before it publishes Blocked, and that render waits on
/// the selective-layer cleanup (up to its 3 s step budget), so two 2 s ticks can both read
/// Locked without a permit. The owned marker's deadline still bounds the exemption.
pub fn kill_switch_unhealthy_for_monitor(
    status: Option<&KillSwitchStatus>,
    owned_direct_reload: bool,
) -> bool {
    if owned_direct_reload
        && let Some(status) = status
        && status.wanted
        && status.live
        && (status.mode == KillSwitchStatusMode::Blocked
            || (status.mode == KillSwitchStatusMode::Locked && !status.tunnel_permit_rendered))
    {
        return false;
    }
    kill_switch_unhealthy(status)
}

/// Stable Service markers that ride in `last_error` on an operation that SUCCEEDED. They are
/// warnings about what could not be proven, not reports of a broken tunnel, and the health
/// monitor must not tear a live connection down for them.
///
/// `TONO_DNS_UNVERIFIED`: DNS was applied but the read-back could not confirm every adapter.
/// `TONO_DNS_RESTORE_DEGRADED`: a restore was accepted on registry evidence alone.
/// `TONO_DNS_CAPTURE_QUARANTINED`: a restore succeeded, but an unreadable Encrypted DNS capture
/// was quarantined, so the user's previous Encrypted DNS setting could not be put back.
///
/// Treating these as unhealthy is not a cosmetic mistake: two consecutive samples invalidate
/// Connected, and a machine that can never verify would then reconnect forever.
const DNS_WARNING_MARKERS: [&str; 3] = [
    "TONO_DNS_UNVERIFIED",
    "TONO_DNS_RESTORE_DEGRADED",
    "TONO_DNS_CAPTURE_QUARANTINED",
];

/// Whether a `last_error` string reports an actual failure rather than an unproven-but-applied
/// state. Substring, not prefix: the Service nests these markers inside its own context.
fn dns_error_is_a_failure(last_error: Option<&str>) -> bool {
    match last_error {
        None => false,
        Some(text) => !DNS_WARNING_MARKERS.iter().any(|marker| text.contains(marker)),
    }
}

/// Connected is not healthy unless every currently known adapter is proven to use Tono's
/// protected DNS endpoint.
/// The Service status deliberately includes adapters that appeared after the original snapshot,
/// closing the first-netmon-sample race and covering a failed Windows notification registration.
pub fn protected_dns_unhealthy(status: Option<&DnsProtectionStatus>) -> bool {
    match status {
        Some(status) => {
            !(status.enabled
                && status.snapshot_present
                && status.adapters > 0
                && !dns_error_is_a_failure(status.last_error.as_deref()))
        }
        None => true,
    }
}

/// A fresh GUI may find a Core that the same authenticated owner left running across an
/// installer repair or process restart. This is deliberately stronger than the Connected health
/// predicate: it authorizes only a fail-closed *replacement attempt*, never a direct transition to
/// Connected. The new process still has to create a fresh Service session/controller secret and
/// pass every ordinary DNS, WFP, exit, and real-data-plane verification stage.
pub fn startup_runtime_is_resume_candidate(snapshot: &ServiceStatusSnapshot, dns: &DnsProtectionStatus) -> bool {
    tono_service_protocol::is_protected_startup_replacement_candidate(snapshot, dns)
}

/// Pure final-admission gate for a startup replacement. Keeping both generations explicit is a
/// regression guard: auth replacement and connection release are independent cancellation axes,
/// and either one must make an asynchronously obtained Service proof unusable.
pub const fn startup_resume_guards_hold(
    auth_generation_current: bool,
    connection_generation_current: bool,
    account_ready: bool,
    selected_is_valid: bool,
    session_verified: bool,
    reconnectable: bool,
) -> bool {
    auth_generation_current
        && connection_generation_current
        && account_ready
        && selected_is_valid
        && session_verified
        && reconnectable
}

/// F2: threshold test shared by the kill-switch and exit-probe legs.
pub const fn health_threshold_reached(consecutive_failures: u32) -> bool {
    consecutive_failures >= HEALTH_FAILURE_THRESHOLD
}

/// Consecutive failed network-event proofs before the tunnel is rebuilt.
///
/// One failure is a blip: packet loss, a DHCP flicker, a route notification
/// while the exit is still carrying traffic. Stopping the core there opens a
/// kill-switch window longer than the blip. The next monitor tick probes
/// again without waiting for another OS notification. Core identity and the
/// protection legs are not debounced by this count.
pub const EVENT_PROBE_REBUILD_AFTER: u32 = 2;

pub const fn event_probe_failure_rebuilds(consecutive_failures: u32) -> bool {
    consecutive_failures >= EVENT_PROBE_REBUILD_AFTER
}

/// Whether this monitor tick should ask the tunnel about a network event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkEventProbePlan {
    /// Nothing to prove. Core identity, a broken barrier, and our own DIRECT
    /// reload are handled by their own legs.
    Idle,
    /// A success inside the cooldown still covers this notification.
    ReuseRecentProof,
    /// Run one data-plane proof. A pending failure from the previous tick
    /// must run even when this tick has no new OS notification.
    Probe,
}

/// What that proof did to the session. `Hold` keeps the core and the barrier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkEventProbeEffect {
    Unchanged,
    Proven,
    Hold,
    Rebuild,
}

pub const fn plan_network_event_probe(
    event_invalidated: bool,
    network_changed: bool,
    core_changed: bool,
    health_invalid: bool,
    owned_direct_reload: bool,
    pending_failures: u32,
    recent_proof: bool,
) -> NetworkEventProbePlan {
    if core_changed || health_invalid || owned_direct_reload {
        return NetworkEventProbePlan::Idle;
    }
    let corroboration_due = event_invalidated && network_changed;
    let reconfirm = pending_failures > 0;
    if !corroboration_due && !reconfirm {
        return NetworkEventProbePlan::Idle;
    }
    if corroboration_due && pending_failures == 0 && recent_proof {
        return NetworkEventProbePlan::ReuseRecentProof;
    }
    NetworkEventProbePlan::Probe
}

pub const fn apply_network_event_probe(
    plan: NetworkEventProbePlan,
    probe_failed: bool,
    pending_failures: u32,
) -> (NetworkEventProbeEffect, u32) {
    match plan {
        NetworkEventProbePlan::Idle => (NetworkEventProbeEffect::Unchanged, pending_failures),
        NetworkEventProbePlan::ReuseRecentProof => (NetworkEventProbeEffect::Proven, 0),
        NetworkEventProbePlan::Probe => {
            if !probe_failed {
                (NetworkEventProbeEffect::Proven, 0)
            } else {
                let next = pending_failures.saturating_add(1);
                if event_probe_failure_rebuilds(next) {
                    (NetworkEventProbeEffect::Rebuild, 0)
                } else {
                    (NetworkEventProbeEffect::Hold, next)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        NetworkEventProbeEffect, NetworkEventProbePlan, apply_network_event_probe, may_recover_in_place,
        plan_network_event_probe,
    };

    #[test]
    fn sing_box_direct_replacement_pid_change_is_owned_not_a_crash() {
        use super::core_identity_change_owned;
        let now = std::time::Instant::now();
        let marker = Some((7, now + std::time::Duration::from_secs(60)));
        assert!(
            core_identity_change_owned(false, None, marker, 7, now),
            "a replacement that began after the tick started must not read as a Core crash"
        );
        assert!(
            core_identity_change_owned(true, marker, None, 7, now),
            "a replacement that finished during the tick is still owned"
        );
        assert!(
            !core_identity_change_owned(false, None, None, 7, now),
            "an unexplained pid change still fires"
        );
    }

    #[test]
    fn an_owned_sing_box_replacement_reporting_locked_without_permit_is_not_unhealthy() {
        use super::kill_switch_unhealthy_for_monitor;
        use tono_service_protocol::{KillSwitchStatus, KillSwitchStatusMode};
        let retracted = KillSwitchStatus {
            wanted: true,
            verified: true,
            live: true,
            mode: KillSwitchStatusMode::Locked,
            tunnel_permit_rendered: false,
            endpoints: Vec::new(),
            direct_endpoint_digest: String::new(),
            last_error: None,
            reconnect_after_release: false,
        };
        assert!(
            !kill_switch_unhealthy_for_monitor(Some(&retracted), true),
            "the session's own replacement retracts the permit before the Service publishes Blocked"
        );
        assert!(
            kill_switch_unhealthy_for_monitor(Some(&retracted), false),
            "outside an owned reload a Locked session without its permit is still unhealthy"
        );
    }

    #[test]
    fn a_debounced_sample_stays_visible_until_the_window_elapses() {
        use super::{commit_core_baseline, next_network_events_counter};
        let pending = next_network_events_counter(Some(4), 5, false, false);
        assert_eq!(pending, Some(4), "a suppressed tick must keep the old counter");
        assert_eq!(next_network_events_counter(pending, 5, false, true), Some(5));
        assert!(!commit_core_baseline(false, true, false));
        assert!(commit_core_baseline(false, true, true));
    }

    #[test]
    fn a_direct_overlay_bound_to_a_lost_adapter_cannot_recover_in_place() {
        let uplinks = vec!["Wi-Fi".to_string()];
        assert!(
            !may_recover_in_place(true, Some("Ethernet"), Some(&uplinks)),
            "DIRECT bound to Ethernet while only Wi-Fi carries a default route must be rebuilt, even though the tunnel probe succeeded"
        );
    }

    /// Simulated network-change harness. The monitor tick is not run; these
    /// are the decisions it asks before it is allowed to stop the core.

    #[test]
    fn one_failed_network_event_probe_holds_the_tunnel() {
        let plan = plan_network_event_probe(true, true, false, false, false, 0, false);
        assert_eq!(plan, NetworkEventProbePlan::Probe);
        assert_eq!(
            apply_network_event_probe(plan, true, 0),
            (NetworkEventProbeEffect::Hold, 1)
        );
    }

    #[test]
    fn a_second_failed_network_event_probe_rebuilds() {
        let plan = plan_network_event_probe(false, false, false, false, false, 1, false);
        assert_eq!(
            plan,
            NetworkEventProbePlan::Probe,
            "the confirmation tick must probe without waiting for another OS event"
        );
        assert_eq!(
            apply_network_event_probe(plan, true, 1),
            (NetworkEventProbeEffect::Rebuild, 0)
        );
    }

    #[test]
    fn a_probe_that_recovers_clears_the_pending_failure() {
        let plan = plan_network_event_probe(false, false, false, false, false, 1, false);
        assert_eq!(
            apply_network_event_probe(plan, false, 1),
            (NetworkEventProbeEffect::Proven, 0)
        );
    }

    #[test]
    fn a_recent_proof_is_reused_instead_of_probing_again() {
        assert_eq!(
            plan_network_event_probe(true, true, false, false, false, 0, true),
            NetworkEventProbePlan::ReuseRecentProof
        );
        assert_eq!(
            apply_network_event_probe(NetworkEventProbePlan::ReuseRecentProof, true, 0),
            (NetworkEventProbeEffect::Proven, 0),
            "reuse does not consult the probe_failed flag"
        );
    }

    #[test]
    fn a_core_change_is_not_deferred_as_a_network_blip() {
        assert_eq!(
            plan_network_event_probe(true, true, true, false, false, 1, false),
            NetworkEventProbePlan::Idle
        );
    }

    #[test]
    fn a_protection_failure_is_not_deferred_as_a_network_blip() {
        assert_eq!(
            plan_network_event_probe(true, true, false, true, false, 0, false),
            NetworkEventProbePlan::Idle
        );
    }

    #[test]
    fn an_owned_direct_reload_does_not_probe() {
        assert_eq!(
            plan_network_event_probe(true, true, false, false, true, 0, false),
            NetworkEventProbePlan::Idle
        );
    }
}
