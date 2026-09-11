//! Connected-lifetime health classification for the Windows connect monitor.

use std::sync::atomic::{AtomicBool, Ordering};
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

    /// Any protection or Service leg that reached the threshold invalidates Connected.
    /// Exit-probe failures mark exit health only; they do not tear the tunnel down.
    pub const fn invalid(&self) -> bool {
        health_threshold_reached(self.kill_switch)
            || health_threshold_reached(self.protected_dns)
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
/// already committed. Adapter noise alone must not rebuild. Core identity change or a
/// failed KS/DNS/Service health leg still rebuilds. Third-party TUN HTTPS is not an input.
pub fn monitor_requires_reconnect(
    _event_invalidated: bool,
    core_changed: bool,
    health_invalid: bool,
) -> bool {
    health_invalid || core_changed
}

/// Windows reported a network-event counter bump, but the core identity and
/// KS/DNS/Service legs are unchanged. Keep the current session.
pub const fn adapter_noise_keeps_session(
    event_invalidated: bool,
    network_changed: bool,
    core_changed: bool,
    health_invalid: bool,
) -> bool {
    event_invalidated && network_changed && !core_changed && !health_invalid
}

/// Why a connected-lifetime path is asking to recover. Callers must not share
/// one "network change reconnect" label: a policy apply is not a NIC flap,
/// and a dead Service is not proof that the tunnel should be torn down by HTTPS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryReason {
    /// Core pid/restart or TUN identity changed. Keep the lock; rebuild under it.
    CoreOrTunIdentity,
    /// WFP or protected DNS is explicitly unhealthy. Repair immediately.
    ProtectionFailed,
    /// Service IPC stayed unreachable after the in-place hold. Repair; do not
    /// release the lock; HTTPS success is not a substitute for a live snapshot.
    ServiceUnreachable,
    /// Cloud routing policy actually changed. Apply and read back; do not skip
    /// because the old tunnel can still fetch a website.
    RoutingPolicyChanged,
    /// Residential assignment changed; downloaded does not mean applied.
    HomeRoutingChanged,
    /// The applied selected first-hop endpoint differs from the signed catalog.
    ExitConfigurationChanged,
    /// Signed WeChat / reviewed-app path set changed.
    DirectAppPathsChanged,
    /// Residential browser Secure DNS proof failed.
    BrowserDnsFailed,
}

impl RecoveryReason {
    pub const fn audit_reason(self) -> &'static str {
        match self {
            Self::CoreOrTunIdentity => "coreOrTunIdentity",
            Self::ProtectionFailed => "protectionFailed",
            Self::ServiceUnreachable => "serviceUnreachable",
            Self::RoutingPolicyChanged => "routingPolicyChanged",
            Self::HomeRoutingChanged => "homeRoutingChanged",
            Self::ExitConfigurationChanged => "exitConfigurationChanged",
            Self::DirectAppPathsChanged => "directAppPathsChanged",
            Self::BrowserDnsFailed => "browserDnsFailed",
        }
    }

    pub const fn log_line(self) -> &'static str {
        match self {
            Self::CoreOrTunIdentity => "Tono: 核心或 TUN 身份变化，保持封锁并受控重建",
            Self::ProtectionFailed => "Tono: WFP 或 DNS 保护失效，立即进入保护修复",
            Self::ServiceUnreachable => "Tono: Service 无法观测，进入修复且不释放封锁",
            Self::RoutingPolicyChanged => "Tono: 路由策略已变化，应用并读回新配置",
            Self::HomeRoutingChanged => "Tono: 家宽分流配置变化，保持封锁并应用新配置",
            Self::ExitConfigurationChanged => "Tono: VPS 传输配置变化，保持封锁并应用新配置",
            Self::DirectAppPathsChanged => "Tono: 直连应用路径变化，受控重建",
            Self::BrowserDnsFailed => "Tono: 家宽浏览器 DNS 校验失败，限制流量并重建",
        }
    }
}

/// One recovery task at a time. A second caller that loses the CAS merges
/// into the in-flight recovery (NIC bursts, overlapping policy ticks).
pub fn recovery_try_begin(flag: &AtomicBool) -> bool {
    flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
}

pub fn recovery_end(flag: &AtomicBool) {
    flag.store(false, Ordering::Release)
}

/// What one [`handle_network_change`] call did to the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkChangeOutcome {
    /// The locked TUN still carried traffic, so the core was never stopped and this session —
    /// generation, tasks and all — is the same one that was Connected before the event.
    RecoveredInPlace,
    /// Another recovery owns mutation; keep observing dirty state rather than lose the loop.
    Deferred,
    /// The session was torn down, handed to a newer generation, or was never this caller's to
    /// act on. Nothing connection-scoped survives it.
    Handled,
}

/// A merged event does not retire this observer. Generation/FSM checks decide
/// whether a newer session owns it on the next tick.
pub const fn connection_loop_continues(outcome: NetworkChangeOutcome) -> bool {
    matches!(outcome, NetworkChangeOutcome::RecoveredInPlace | NetworkChangeOutcome::Deferred)
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
/// Win11 Home often has one adapter. If that unique adapter's live apply
/// failed, a system fake-ip query through another resolver path can still pass
/// while Chrome/WeChat cannot resolve. That is not a usable connect.
pub fn unique_adapter_dns_apply_failed(status: &DnsProtectionStatus) -> bool {
    status.adapters == 1
        && status
            .last_error
            .as_deref()
            .is_some_and(|error| error.contains("TONO_DNS_UNVERIFIED"))
}

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
