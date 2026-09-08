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
) -> bool {
    health_invalid || (event_invalidated && (core_changed || event_probe_failed))
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

/// Stable Service markers that ride in `last_error` on an operation that SUCCEEDED. They are
/// warnings about what could not be proven, not reports of a broken tunnel, and the health
/// monitor must not tear a live connection down for them.
///
/// `TONO_DNS_UNVERIFIED`: DNS was applied but the read-back could not confirm every adapter.
/// `TONO_DNS_RESTORE_DEGRADED`: a restore was accepted on registry evidence alone.
///
/// Treating these as unhealthy is not a cosmetic mistake: two consecutive samples invalidate
/// Connected, and a machine that can never verify would then reconnect forever.
const DNS_WARNING_MARKERS: [&str; 2] = ["TONO_DNS_UNVERIFIED", "TONO_DNS_RESTORE_DEGRADED"];

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
