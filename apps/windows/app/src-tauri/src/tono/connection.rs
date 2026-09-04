//! Connect orchestration (product-contract.md §6).
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

use std::{error::Error as _, future::Future, net::IpAddr, sync::Arc, time::Duration};

use tono_logging::{Type, logging};
use tono_service_protocol::{
    DnsProtectionStatus, KillSwitchConfig, KillSwitchStatus, KillSwitchStatusMode, OwnerSessionProof, ProxyEndpoint,
    ProxyProtocol, RuntimeBundle, ServiceLifecycleState, ServiceStatusSnapshot, StageRuntimeOutcome,
};
use futures::{StreamExt as _, stream::FuturesUnordered};
use tauri::AppHandle;
use tono_plugin_core::{MihomoExt as _, models::Protocol};
use tokio_util::sync::CancellationToken;
use tono_core::{
    EXIT_GROUP_NAME,
    config::{self, RuntimePorts, build_owned_runtime_with_ports, generate_controller_secret},
    connection::{ConnectStage, ConnectionStatus, ReconnectBackoff},
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

/// §6.8 exit probe target.
const EXIT_PROBE_URL: &str = "https://www.gstatic.com/generate_204";
/// §6.8: the probe also proves fake-ip DNS via this lookup.
const FAKE_IP_LOOKUP_HOST: &str = "www.gstatic.com";
/// §6.4: controller readiness poll budget. Mihomo's controller is usually up within a few
/// hundred milliseconds, so the first polls run on a tight 50 ms grid before falling back to
/// the coarse 250 ms interval — the fixed grid alone overshot a typical readiness by ~200 ms.
/// The attempt count is sized so the 15 s deadline, not the counter, is the effective budget.
const VERSION_POLL_ATTEMPTS: u32 = 64;
const VERSION_POLL_FAST_ATTEMPTS: u32 = 8;
const VERSION_POLL_FAST_INTERVAL: Duration = Duration::from_millis(50);
const VERSION_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// A localhost controller poll must never inherit the general 6 s HTTP timeout. Forty such
/// timeouts would turn the documented ~10 s readiness window into a multi-minute apparent hang.
const CONTROLLER_POLL_TIMEOUT: Duration = Duration::from_millis(750);
const CONTROLLER_READY_TIMEOUT: Duration = Duration::from_secs(15);
/// §6.5: TUN adapter / lock retry budget. The first WinTUN driver install
/// plus interface-alias propagation is slow (~10 s on real hardware, P0-12).
const LOCK_ATTEMPTS: u32 = 50;
const LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(200);
/// §6.7 DNS verification retry count.
const VERIFY_ATTEMPTS: u32 = 3;
const VERIFY_RETRY_INTERVAL: Duration = Duration::from_millis(500);
/// C2 — §6.8 exit-probe budgets. `unified-delay` is on, so `/delay` reports the
/// second sample (warm RTT) and is UI/advisory only. Completing both samples on a
/// distant Reality exit is typically 1.5–3.5 s; 8 s still covers it.
const EXIT_PROBE_CORE_TIMEOUT_MS: u64 = 8_000;
/// The HTTP client must always outlast the core budget by a real margin, so the *core* decides
/// the verdict of an exit probe. 3 s over the core budget covers the loopback round trip, the
/// core's scheduling, and the JSON reply.
const EXIT_PROBE_CLIENT_TIMEOUT: Duration = Duration::from_secs(11);
/// The controller delay request is advisory during Connect. Its reqwest timeout plus the
/// integration profile's maximum synthetic delay bounds the single attempt; retrying a doubled
/// `unified-delay` request made a harmless 504 consume 38 seconds before the authoritative real
/// App data-plane check was even allowed to run.
#[cfg(test)]
const EXIT_PROBE_ADVISORY_BUDGET: Duration = Duration::from_secs(16);
/// Every other controller call keeps the original general budget: `/version` polls are bounded
/// far tighter by `CONTROLLER_POLL_TIMEOUT`, and a cloud-policy `/dns/query` must not be able to
/// spend an exit-probe-sized slice of the transaction.
const CONTROLLER_HTTP_TIMEOUT: Duration = Duration::from_secs(6);
/// Stable frontend mapping for the strict browser-owned DNS proof required by a residential
/// Claude route. Detail after the prefix is deliberately limited to controlled enum text.
#[cfg(windows)]
const BROWSER_DNS_PREFLIGHT_PREFIX: &str = "TONO_BROWSER_DNS_PREFLIGHT";
/// One attempt through the Windows DNS Client. The Windows path uses cancellable `DnsQueryEx`,
/// so a slow adapter transition can consume this budget without leaving stale `getaddrinfo`
/// workers behind; all bounded attempts remain available on high-latency machines.
const FAKE_IP_LOOKUP_TIMEOUT: Duration = Duration::from_secs(5);
/// §6.9 must prove traffic from the App itself, not merely ask Mihomo whether Mihomo can reach
/// the Internet. The client is fresh, ignores all explicit proxy settings, resolves through the
/// protected system DNS, and therefore has only one permitted path while WFP is locked: WinTUN.
// A 4 s connect ceiling passed the local 1 s synthetic-latency profile but failed on real
// mainland-to-US paths: that profile delays *before* the request and therefore does not consume
// reqwest's DNS + proxy handshake + TLS connect budget. The Buffalo reports show the independent
// controller request completing in 2.5 s while every real App request exhausts exactly this 4 s
// connect ceiling. Twelve seconds covers several cross-border handshakes without weakening the
// verdict; the whole request remains absolutely bounded and still has to return the exact TLS
// origin status.
const TUN_DATA_PLANE_CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const TUN_DATA_PLANE_TIMEOUT: Duration = Duration::from_secs(18);
/// Happy-eyeballs spacing between the three TLS origins. Starting them in the
/// same millisecond on a cold Reality path made the first verification round
/// lose to self-congestion even when the node was healthy.
const TUN_PROBE_STAGGER: Duration = Duration::from_millis(100);
/// A single public origin is not a data plane. The controller probe and 0.0.7's App probe both
/// targeted Google, so one node-to-Google failure made two nominally independent checks fail
/// together on a mainland tester. Race independent TLS origins and accept the first exact,
/// authenticated response. Because WFP is already verified Locked, any such fresh App flow can
/// only leave through WinTUN; an ordinary physical-interface fallback remains impossible.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TunDataPlaneProbe {
    label: &'static str,
    url: &'static str,
    expected_status: u16,
}

const TUN_DATA_PLANE_PROBES: [TunDataPlaneProbe; 3] = [
    TunDataPlaneProbe {
        label: "Google",
        url: EXIT_PROBE_URL,
        expected_status: 204,
    },
    TunDataPlaneProbe {
        label: "Cloudflare",
        url: "https://cp.cloudflare.com/generate_204",
        expected_status: 204,
    },
    TunDataPlaneProbe {
        label: "Apple",
        url: "https://www.apple.com/library/test/success.html",
        expected_status: 200,
    },
];
/// Controller failures are useful only when they remain bounded and safe to persist in the
/// connect progress/audit trail. Mihomo's local API normally returns a tiny JSON error; cap the
/// extracted message in case that shape changes.
const CONTROLLER_ERROR_DETAIL_LIMIT: usize = 384;
/// V1/H1 — §6.9 kill-switch verification retries. `KillSwitchStatus.live` on Windows is not a
/// live query: it is a ~1.5 s-decaying cache refreshed by a 1 s loop, so one slow-but-successful
/// verify reads `live: false` and fails a healthy tunnel. Every other stage retries (`lock` 50×,
/// `verify_fake_ip` 3×, `wait_controller` 64×); the only stage reading a
/// time-decayed field retried zero times. The window deliberately spans more than one full
/// refresh period, so the verdict is never decided by a single sample of a decaying value.
const VERIFY_LOCK_ATTEMPTS: u32 = 4;
const VERIFY_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(700);
/// C3 — `checkingExit` + `verifyingTraffic` form one retryable *verification* group.
///
/// At that point the barrier is locked and the tunnel is proven up, but `session_verified` is
/// still false (it is committed only after both stages pass), so `plan_failure(armed = true,
/// session_verified = false, ..)` resolves to `FullRelease` — and `next_reconnect_delay()`
/// then requires `is_protection_blocked && session_verified`, both false, so nothing retries.
/// A controller delay result is only advisory; the real App data-plane request below owns the
/// verdict. A transient failure of that authoritative check still gets one full in-place retry.
///
/// The retry therefore belongs **before** the full release, inside the still-live transaction:
/// the decision table, the verification latch, and the release rules are untouched, and an
/// exhausted group still falls through to exactly the old `FullRelease`.
const POST_LOCK_VERIFY_ROUNDS: u32 = 2;
const POST_LOCK_VERIFY_ROUND_DELAY: Duration = Duration::from_millis(500);
/// `lookup_host` delegates to the OS resolver and has no Tokio timeout of its own. Bound every
/// lookup so a broken adapter/resolver cannot strand Connecting forever.
const DNS_LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);
/// One absolute budget covers service readiness, the cold Core start, controller/DNS
/// verification, fail-closed cloud-policy hot reload, locking, and the post-lock verification
/// group. Per-stage retries never reset this clock.
///
/// C4 — 120 s did not cover a real cold first connect. It was sized while the DNS stage still
/// failed fast; once DNS starts *succeeding* (10–30 s of PowerShell) the sum crosses 120 s right
/// at the exit check, and a timeout there lands on the same no-retry path C3 describes. The
/// accounting below is per-leg worst case, machine-checked by `CONNECT_BUDGET_LEGS`:
///
/// | leg                                                    | worst |
/// |--------------------------------------------------------|-------|
/// | service readiness probe                                  |   3 s |
/// | StartClash #1 — cold WinTUN install + WFP arm             |  60 s | Service handler budget
/// | controller readiness (`CONTROLLER_READY_TIMEOUT`)         |  15 s |
/// | lock ladder (`LOCK_ATTEMPTS` × `LOCK_RETRY_INTERVAL`)     |  10 s |
/// | securingDNS — PowerShell batches + read-back              |  30 s |
/// | fake-ip verification (3 × (5 s + 0.5 s), cancellable)     |  16 s |
/// | checkingExit (one advisory controller delay request)      |  16 s |
/// | verifyingTraffic (WFP status + mainland App HTTP over TUN) |  26 s |
/// | C3 second TUN round + concurrent proxy check + delay       |  27 s |
/// | MarkVerified commit IPC                                   |   5 s |
/// | **total**                                                 | 208 s |
///
/// Optional DIRECT resolution runs after Connected and no longer sits on this clock.
/// 240 s leaves margin over the remaining critical-path sum.
const CONNECT_TRANSACTION_TIMEOUT: Duration = Duration::from_secs(240);
/// The accounting table above, machine-checked by `connect_budget_covers_a_cold_first_connect`.
#[cfg(test)]
const CONNECT_BUDGET_LEGS: [(&str, u64); 10] = [
    ("service readiness", 3),
    ("StartClash #1 (cold WinTUN + WFP arm)", 60),
    ("controller readiness", 15),
    ("lock ladder", 10),
    ("securingDNS", 30),
    ("fake-ip verification", 16),
    ("checkingExit", 16),
    ("verifyingTraffic", 26),
    ("C3 second verification round", 27),
    ("MarkVerified commit", 5),
];
/// The redacted runtime copy is a diagnostics convenience, but it lands under `%APPDATA%`,
/// which enterprise policy can redirect to a UNC share or a sync-provider placeholder folder.
/// `OpenOptions::open`/`write_all` then have no timeout of their own, so an offline share can
/// park the write for minutes. Bound it well under the transaction budget: a diagnostics file
/// must never be the reason a connect spends its clock.
const REDACTED_COPY_WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// UI budget for an explicit release. The ordered DNS → Core → WFP sequence runs in a detached
/// reconciliation task, so reaching this budget stops waiting but never cancels a safety step.
///
/// D1 — 30 s was below the Service's own reality, so the user was told the disconnect had failed
/// while the detached worker completed fine seconds later. One Service-side release runs a DNS
/// restore (two 10 s PowerShell batches plus two 25 s-budgeted engine reads, Service-side leg
/// budget 40 s — `service/src/core/dns.rs` / `windows_kill_switch::DNS_RESTORE_TIMEOUT`), a core
/// stop (≤ 3 s plus a watchdog join) and a WFP transaction. 40 + 3 + ~12 of stop/WFP/IPC
/// overhead ⇒ 55 s, which must stay strictly under the IPC client's own 65 s
/// (`service/src/client/mod.rs` `LIFECYCLE_TIMEOUT`) so a genuine hang is reported by the client
/// with its real cause rather than by this UI deadline.
const EXPLICIT_RELEASE_TIMEOUT: Duration = Duration::from_secs(55);
/// The IPC client's own lifecycle budget. Mirrored here only so the invariant
/// `EXPLICIT_RELEASE_TIMEOUT < LIFECYCLE_TIMEOUT` is asserted rather than assumed.
#[cfg(test)]
const SERVICE_LIFECYCLE_TIMEOUT: Duration = Duration::from_secs(65);
/// The WFP model has a hard endpoint budget. The runtime DIRECT plan and its permits must be
/// generated from the same complete set; silently truncating only the permits creates selective
/// blackholes that look like random application hangs.
const MAX_DIRECT_ENDPOINTS: usize = 256;
/// network_events poll cadence while Connected.
const NETWORK_MONITOR_INTERVAL: Duration = Duration::from_secs(2);
/// H4: consecutive *quiet* missing-core samples before a core change is believed. The Service's
/// `/status` reports `core_pid: None, restart_count: 0` on a non-error path — whenever its
/// per-poll `is_active` check reads `Ok(None)` it considers the session inactive — so a single
/// such sample must not be able to tear a healthy tunnel down. Same treatment as `core_is_gone`
/// in `core/runstate/owner.rs`.
const CORE_MISSING_SUSTAINED_SAMPLES: u32 = 2;
/// P0-13: bursts of network events inside this window merge into a single
/// invalidation (interface-level filtering — GetBestRoute2 — is the
/// documented follow-up; the debounce covers the common route-flap storm).
const NETWORK_EVENT_DEBOUNCE: Duration = Duration::from_secs(2);
/// F2: exit-probe cadence while Connected (the Mac "9.17 h fake-green"
/// lesson — a silent tunnel must be caught by probing, not by watching).
const EXIT_PROBE_INTERVAL: Duration = Duration::from_secs(120);
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
const NETWORK_EVENT_PROBE_COOLDOWN: Duration = Duration::from_secs(15);
/// How long a recovered-in-place verdict stands before the same standing failure may fire the
/// monitor again.
///
/// A leg that stays unhealthy while the tunnel keeps carrying traffic — a Service that never
/// answers again, a wedged WFP — reaches [`HEALTH_FAILURE_THRESHOLD`] two ticks after every
/// re-seed, and every firing costs a warn line, an audit record and a three-origin HTTPS proof.
/// Unbounded that runs for the life of the session and rotates the audit file, erasing the record
/// of the very failure it is reporting. Inside this window the last proof still stands; a core
/// restart or a failed data-plane proof is fresh evidence and is never held back by it.
const IN_PLACE_RECOVERY_COOLDOWN: Duration = Duration::from_secs(120);
/// F2: consecutive failures before the tunnel is declared dead.
///
/// H7 — the threshold's premise ("two consecutive failures ≈ 4 s of sustained failure") holds
/// only because the monitor's interval uses [`MissedTickBehavior::Delay`]. Under the default
/// `Burst`, a tick that overran (each tick makes two named-pipe round trips, and the Windows pipe
/// connect is synchronous and bounded only by a 30 s guard) is followed by the next tick ~0 ms
/// later, so two samples milliseconds apart could read the *same* stale value and tear down a
/// healthy tunnel. Never build the monitor's interval anywhere but [`monitor_interval`].
pub const HEALTH_FAILURE_THRESHOLD: u32 = 2;

/// The connected-lifetime monitor's tick source (H7). `Delay` re-bases the schedule after a slow
/// tick, so every threshold in [`HealthLegs`] counts genuinely *separate* observations spaced by
/// at least [`NETWORK_MONITOR_INTERVAL`]. `app/src-tauri/src/lib.rs` sets the same behaviour on
/// the main-thread pump watchdog for the same reason.
fn monitor_interval() -> tokio::time::Interval {
    let mut interval = tokio::time::interval(NETWORK_MONITOR_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    interval
}

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

/// Re-prove the complete current-owner runtime immediately before either scheduling or admitting
/// the DNS-listener exception. No cached installer hint or old UI snapshot is authority here.
async fn active_runtime_resume_status() -> Option<KillSwitchStatus> {
    let (snapshot, dns) = tokio::join!(
        service::tono_service_status_snapshot(),
        service::tono_protected_dns_status(),
    );
    let (Ok(snapshot), Ok(dns)) = (snapshot, dns) else {
        return None;
    };
    startup_runtime_is_resume_candidate(&snapshot, &dns)
        .then(|| snapshot.kill_switch)
        .flatten()
}

/// Pure final-admission gate for a startup replacement. Keeping both generations explicit is a
/// regression guard: auth replacement and connection release are independent cancellation axes,
/// and either one must make an asynchronously obtained Service proof unusable.
const fn startup_resume_guards_hold(
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

/// Why `run_stages` ended.
#[derive(Debug)]
enum StageFailure {
    /// Generation moved; see [`Attempt::Stale`].
    Stale,
    /// The shared transaction deadline elapsed. The generation is retired before failure
    /// handling so any detached privileged IPC completion performs the stale-commit repair.
    TimedOut(String),
    Error(String),
}

impl StageFailure {
    /// Every stage funnels its errors through here, so the Service's stable WFP markers are
    /// translated once — whichever stage (arm, lock, release) surfaced them.
    fn error(err: impl std::fmt::Display) -> Self {
        let text = err.to_string();
        StageFailure::Error(map_wfp_engine_error(&text).unwrap_or(text))
    }
}

#[derive(Clone)]
struct ConnectTransaction {
    deadline: tokio::time::Instant,
    cancellation: CancellationToken,
}

impl ConnectTransaction {
    fn new(cancellation: CancellationToken) -> Self {
        Self {
            deadline: tokio::time::Instant::now() + CONNECT_TRANSACTION_TIMEOUT,
            cancellation,
        }
    }

    fn check(&self, stage: &'static str) -> Result<(), StageFailure> {
        if self.cancellation.is_cancelled() {
            return Err(StageFailure::Stale);
        }
        if tokio::time::Instant::now() >= self.deadline {
            return Err(StageFailure::TimedOut(format!(
                "connection transaction exceeded {CONNECT_TRANSACTION_TIMEOUT:?} during {stage}"
            )));
        }
        Ok(())
    }

    async fn wait<T>(&self, stage: &'static str, future: impl Future<Output = T>) -> Result<T, StageFailure> {
        self.check(stage)?;
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(StageFailure::Stale),
            result = tokio::time::timeout_at(self.deadline, future) => result.map_err(|_| {
                StageFailure::TimedOut(format!(
                    "connection transaction exceeded {CONNECT_TRANSACTION_TIMEOUT:?} during {stage}"
                ))
            }),
        }
    }
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

async fn retire_timed_out_generation(state: &Arc<TonoState>, generation: u64) {
    let mut inner = state.lock().await;
    if inner.connect_generation != generation {
        return;
    }
    // A first attempt may release a late unverified arm. A previously verified protected
    // reconnect keeps the barrier, matching the normal failure decision table.
    let release_late_commit = !inner.fsm.session_verified();
    // The abort-free variant: this handler frequently runs *inside* a registered connection
    // task (reconnect loop / monitor re-entry / switch), and aborting the registry here would
    // kill the caller before `fail_connect` + `schedule_reconnect` run, stranding Connecting.
    inner.retire_connection_generation(release_late_commit);
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

/// Stable error-code prefix the frontend's i18n keys off: the Service has
/// a privileged operation in flight (install/repair pending, possibly a
/// UAC prompt nobody approved).
pub const SERVICE_BUSY_PREFIX: &str = "TONO_SERVICE_BUSY";
/// Disconnect/Sign-out/Quit release is still finishing. Connect must wait — racing would let
/// a late release tear down a fresh StartClash (the P0 fixed in the final review).
pub const RELEASE_RECONCILING_PREFIX: &str = "TONO_RELEASE_RECONCILING";
/// The two guard rejections that clear on their own; see [`guard_rejection_is_transient`].
/// Named so the classifier and the sites that produce them cannot drift apart.
const TRANSITION_IN_FLIGHT_REJECTION: &str = "a connection transition is already in flight";
const CATALOG_NOT_READY_REJECTION: &str = "the exit catalog is not available yet";
/// Installed Service is below protocol revision 9 (Test 5 or older).
pub const SERVICE_TOO_OLD_PREFIX: &str = "TONO_SERVICE_TOO_OLD";
/// The Service's WFP engine call did not return inside its budget — the Base Filtering Engine
/// is wedged, typically behind a third-party security product's filter hooks. Distinct from
/// [`BFE_NOT_RUNNING_PREFIX`] because the user action differs (reboot / remove the hook versus
/// simply starting the service). The Service nests these inside its own context string, so
/// they are matched by `contains`, not `starts_with`.
pub const WFP_ENGINE_WEDGED_PREFIX: &str = "TONO_WFP_ENGINE_WEDGED";
/// Windows' Base Filtering Engine service is not running, so no kill switch can be installed.
pub const BFE_NOT_RUNNING_PREFIX: &str = "TONO_BFE_NOT_RUNNING";
/// The Service could not be reached at all, so nothing about protection can be read.
///
/// Distinct from every marker above: those are answers *from* a running Service. This one
/// means TonoService itself is not up. It is AutoStart, and it declares a hard dependency on
/// BFE, so the overwhelmingly common cause is BFE having been turned off by a "network
/// optimiser" — Windows then refuses to start TonoService at boot and never retries. Without
/// this marker the App showed only "protected, not connected" with every diagnostic field
/// reading `(unknown)`, which is unactionable for the customer and for support.
pub const SERVICE_NOT_RUNNING_PREFIX: &str = "TONO_SERVICE_NOT_RUNNING";
/// Stable post-lock classifications. The loopback-proxy cross-check distinguishes a selected
/// node/Core path that works without WinTUN from a failure shared by every Mihomo ingress path.
/// None of these markers relaxes the real TUN proof required for Connected.
pub const TUN_DATA_PLANE_BROKEN_PREFIX: &str = "TONO_TUN_DATA_PLANE_BROKEN";
pub const TUN_INGRESS_BROKEN_PREFIX: &str = "TONO_TUN_INGRESS_BROKEN";
pub const NODE_OR_CORE_UNREACHABLE_PREFIX: &str = "TONO_NODE_OR_CORE_UNREACHABLE";

/// Translate the Service's stable WFP markers into an actionable message. Returns `None` for
/// every other error so callers keep the original diagnostic text.
pub fn map_wfp_engine_error(text: &str) -> Option<String> {
    if text.contains(BFE_NOT_RUNNING_PREFIX) {
        return Some(format!(
            "{BFE_NOT_RUNNING_PREFIX}: Windows 基础筛选引擎 (BFE) 未运行，无法安装网络保护；请以管理员身份运行 `sc start BFE` 后重试"
        ));
    }
    if text.contains(WFP_ENGINE_WEDGED_PREFIX) {
        return Some(format!(
            "{WFP_ENGINE_WEDGED_PREFIX}: Windows 防火墙引擎无响应（常见于第三方安全软件挂钩 WFP）；请重启电脑，若仍然如此请暂时退出杀毒/防火墙软件后重试"
        ));
    }
    None
}

/// Layer the Run State's raw English onto a stable, actionable message.
/// Everything else keeps the original detail for diagnostics.
pub fn map_service_ready_error(err: &anyhow::Error) -> String {
    let text = format!("{err:#}");
    if text.contains(crate::core::runstate::SERVICE_OPERATION_BUSY)
        || text.contains(crate::core::runstate::PRIVILEGED_OUTCOME_UNCERTAIN)
    {
        return format!(
            "{SERVICE_BUSY_PREFIX}: Tono Service 正在安装/修复中，请检查是否有待授权的管理员提示；若无反应请重启 Tono"
        );
    }
    // Everything that reaches here is "the Service did not answer", which the App used to
    // render as raw English with the internal error appended. The detail stays for
    // diagnostics, but the marker lets the UI say the one thing that actually fixes it.
    format!("{SERVICE_NOT_RUNNING_PREFIX}: Tono Service is not ready: {text}")
}

/// Whether a lock failure is the expected "WinTUN still coming up" class that must be
/// retried, versus a permanent failure that would only burn the connect budget if looped.
///
/// Permanent errors (owner mismatch, not armed, WFP engine failure, auth) must not be
/// retried: each attempt is a full Service lifecycle IPC (up to 65 s), and blind retries
/// after a transport timeout can also race a still-running lock on the Service side.
pub fn is_retryable_lock_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    // Primary: ConvertInterfaceAliasToLuid failed because the adapter is not registered yet.
    if lower.contains("did not resolve to a luid") {
        return true;
    }
    // validate_tunnel_luid refuses a non-tunnel LUID while WinTUN is still renaming/initializing.
    if lower.contains("is not a tunnel device") {
        return true;
    }
    // Transient service lifecycle contention while StartClash is still materializing.
    if lower.contains("service unavailable") || lower.contains("operation already") || lower.contains("busy") {
        return true;
    }
    false
}

/// Fail fast when BFE is known stopped. A query failure is not a refusal —
/// StartClash still diagnoses a wedged or missing engine. StartPending is
/// allowed through so a machine that is bringing BFE up is not rejected.
/// BFE's verdict for the service-readiness failure path, in the shape `map_wfp_engine_error`
/// already translates. `Ok(())` on any platform or condition where BFE is not the answer, so
/// the caller falls through to its own classification.
fn blocking_bfe_verdict() -> Result<(), String> {
    #[cfg(windows)]
    {
        match query_bfe_state() {
            Ok((running, state)) if !running && !state.eq_ignore_ascii_case("StartPending") => {
                Err(format!("{BFE_NOT_RUNNING_PREFIX}: state {state}"))
            }
            _ => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

async fn preflight_bfe() -> Result<(), String> {
    #[cfg(windows)]
    {
        match tokio::task::spawn_blocking(query_bfe_state).await {
            Ok(Ok((running, state))) => classify_bfe_state(running, &state),
            Ok(Err(_)) | Err(_) => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

fn classify_bfe_state(running: bool, state: &str) -> Result<(), String> {
    if running || state.eq_ignore_ascii_case("StartPending") {
        Ok(())
    } else {
        Err(format!("{BFE_NOT_RUNNING_PREFIX}: state {state}"))
    }
}

#[cfg(windows)]
fn query_bfe_state() -> Result<(bool, String), String> {
    use windows_service::service::{ServiceAccess, ServiceState};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|error| format!("cannot connect to the service control manager: {error}"))?;
    let service = manager
        .open_service("BFE", ServiceAccess::QUERY_STATUS)
        .map_err(|error| format!("cannot open the Base Filtering Engine: {error}"))?;
    let state = service
        .query_status()
        .map_err(|error| format!("cannot query the Base Filtering Engine: {error}"))?
        .current_state;
    Ok((state == ServiceState::Running, format!("{state:?}")))
}

/// Tono has no sidecar: the Service must be Ready and speak the kill switch
/// protocol (rev 5 arm/lock + rev 6 release, C1).
async fn ensure_service_ready() -> Result<(), String> {
    // `tono_service_ready_or_repair`: an unprotected App quit stops the SCM service, so the
    // first connect afterwards revives it through the established install/repair entry.
    service::tono_service_ready_or_repair()
        .await
        .map_err(|err| {
            // Ask BFE before answering. TonoService is AutoStart with a hard BFE dependency, so
            // when BFE is off the SCM refuses to start it and does not retry — a reboot does not
            // help either. `preflight_bfe` already knows how to say that, but it runs later in
            // the connect flow and this failure returns before it, so the customer used to get
            // "the Service is not ready" plus an internal error and no way forward.
            if let Err(bfe) = blocking_bfe_verdict() {
                return bfe;
            }
            map_service_ready_error(&err)
        })?;
    match service::tono_probe_kill_switch_release_support().await {
        Ok(None) => Ok(()),
        // The detail carries both sides' epoch/revision. The old wording asserted "too old",
        // which `supports_client` cannot actually distinguish — it rejects a *newer* Service
        // just as flatly — so a mismatched pair used to be told to reinstall the wrong half.
        Ok(Some(detail)) => Err(format!(
            "{SERVICE_TOO_OLD_PREFIX}: Tono Service protocol does not match this App ({detail}); reinstall/repair the Tono Service from this installer"
        )),
        Err(err) => Err(format!("cannot query the Tono Service protocol: {err}")),
    }
}

/// The §6 stage sequence, from endpoint computation to `Connected`. The
/// generation is re-checked at every stage boundary; a moved generation
/// ends the transaction with no side effects.
async fn run_stages(
    state: &Arc<TonoState>,
    app: &AppHandle,
    node: &ValidatedNode,
    nodes: &[ValidatedNode],
    routing: Option<&tono_core::CatalogRouting>,
    generation: u64,
    started: std::time::Instant,
    transaction: &ConnectTransaction,
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
    set_stage(state, app, ConnectStage::PreparingService, generation, false, started).await?;

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
    let (bootstrap_api_hosts, physical_interface_probe, runtime_ports, dns_preflight, active_runtime_resume, core_path, bfe_preflight) =
        transaction
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
    // §5: the owned runtime carries a fresh random controller secret; only
    // the redacted copy may touch disk.
    let secret = generate_controller_secret();
    let runtime =
        build_owned_runtime_with_ports(nodes, &node.name, &secret, None, home_node.map(|home| home.name.as_str()), home_socks5, runtime_ports).map_err(StageFailure::error)?;
    // Under the transaction like every other stage on this path. `apply_cloud_policy`'s copy is
    // already covered because that whole stage runs inside a `wait`; this one was the only
    // uncovered await in `run_stages`, and an %APPDATA% redirected to an offline share parks it
    // where the `CONNECT_TRANSACTION_TIMEOUT` budget cannot reach — Connecting forever, every retry then rejected as
    // "already connecting". The write itself never fails the connect (see `write_redacted_copy`),
    // so this wait only trips when the budget was already spent.
    transaction
        .wait(
            "writing redacted runtime copy",
            write_redacted_copy(state, &runtime.redacted_yaml()),
        )
        .await?;
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
    set_stage(state, app, ConnectStage::SecuringDns, generation, true, started).await?;
    transaction
        .wait(
            "enabling protected DNS",
            enable_dns_cancellation_safe(state, generation, service_session.clone()),
        )
        .await??;
    if state.lock().await.connect_generation != generation {
        return Err(stale_after_dns(state, generation).await);
    }
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
        inner.fsm.mark_session_verified();
        inner.fsm.connect_succeeded().map_err(StageFailure::error)?;
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
    });
    spawn_network_monitor(state, app).await;
    spawn_exit_identity_lookup(state, app, generation);
    let residential_target = if home_socks5.is_some() {
        Some(config::HOME_SOCKS5_OUTBOUND_NAME.to_owned())
    } else {
        home_node.map(|home| home.name.clone())
    };
    spawn_control_plane_pin_refresh(state, app, generation, residential_target).await;
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

/// Remember control-plane addresses only from the protected resolver.
///
/// `bootstrap_hosts` still uses the system resolver so a first connect can
/// widen WFP for this session, but those answers must not be persisted: a
/// poisoned physical DNS would otherwise become tomorrow's recovery pin.
///
/// Runs once immediately, then every 15 minutes while this generation stays
/// connected, so a rotated anycast edge is learned without waiting for the
/// next reconnect.
const CONTROL_PLANE_PIN_REFRESH_INTERVAL: Duration = Duration::from_secs(15 * 60);
/// WeChat path rediscovery. File identity (path/size/mtime) is cached, so a
/// miss only re-runs WinVerifyTrust when an install actually changes.
const WECHAT_PATH_REFRESH_INTERVAL: Duration = Duration::from_secs(2 * 60);
/// Browser Secure DNS may be changed after Connect. Re-prove the browser-wide
/// setting while a residential route is active so that Web traffic cannot
/// silently lose hostname visibility until the next manual reconnect.
const BROWSER_DNS_RECHECK_INTERVAL: Duration = Duration::from_secs(60);

/// How often the DIRECT overlay and protected residential routes are sampled while connected.
///
/// A sample, not a trace: each distinct `(address, port, protocol)` is recorded once per
/// session, so the cost is one controller read per minute and a handful of log lines on the
/// first minute of a session rather than one line per connection.
const DIRECT_SAMPLE_INTERVAL: Duration = Duration::from_secs(60);

/// Upper bound on distinct destinations recorded in one session. WeChat's CDN rotates, so a
/// long session on a busy account could otherwise write an unbounded number of lines into a
/// log that is uploaded. Reaching the cap is itself worth knowing — it means the destination
/// set is wider than a prefix list would comfortably cover — so it is recorded once and
/// sampling then stops for the session.
const MAX_DIRECT_SAMPLES: usize = 512;
/// Independent privacy/size cap for protected connection IDs observed in one session. IDs are
/// hashed and retained in memory only; the audit event contains cumulative enum/count evidence.
const MAX_PROTECTED_ROUTE_SAMPLES: usize = 512;

/// The subset of `/connections` this sampler reads. Deliberately not the full shape: every
/// field here is one the audit record needs, and anything the controller adds later is
/// ignored rather than a parse failure.
#[derive(Debug, Clone, serde::Deserialize)]
struct SampledConnection {
    #[serde(default)]
    id: String,
    #[serde(default)]
    metadata: SampledMetadata,
    #[serde(default)]
    chains: Vec<String>,
    #[serde(default)]
    rule: String,
    #[serde(default, rename = "rulePayload")]
    rule_payload: String,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
struct SampledMetadata {
    #[serde(default, rename = "destinationIP")]
    destination_ip: String,
    #[serde(default)]
    host: String,
    #[serde(default, rename = "destinationPort")]
    destination_port: String,
    #[serde(default)]
    network: String,
    #[serde(default, rename = "processPath")]
    process_path: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct SampledConnections {
    #[serde(default)]
    connections: Vec<SampledConnection>,
}

/// One destination worth recording, already deduplicated.
#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectSample {
    /// The resolved address, when the flow carried one. Empty for a domain-routed flow under
    /// fake-ip, where the controller reports the name and not an address the prefix set could
    /// be computed from.
    address: String,
    /// The destination name, when the flow carried one.
    host: String,
    port: u16,
    udp: bool,
    process: String,
    chain: String,
    rule: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProtectedDestination {
    Anthropic,
    Turnstile,
    Update,
    Telemetry,
}

impl ProtectedDestination {
    fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "ANTHROPIC",
            Self::Turnstile => "TURNSTILE",
            Self::Update => "UPDATE",
            Self::Telemetry => "TELEMETRY",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProtectedRoute {
    Residential,
    Direct,
    Proxied,
    Blocked,
    Unknown,
}

impl ProtectedRoute {
    fn as_str(self) -> &'static str {
        match self {
            Self::Residential => "RESIDENTIAL",
            Self::Direct => "DIRECT",
            Self::Proxied => "PROXIED",
            Self::Blocked => "BLOCKED",
            Self::Unknown => "UNKNOWN",
        }
    }

    fn violates_residential_route(self) -> bool {
        matches!(self, Self::Direct | Self::Proxied)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ProtectedRouteAggregate {
    residential: u32,
    direct: u32,
    proxied: u32,
    blocked: u32,
    unknown: u32,
    latest: Option<(ProtectedRoute, ProtectedDestination)>,
}

impl ProtectedRouteAggregate {
    fn observe(&mut self, route: ProtectedRoute, destination: ProtectedDestination) {
        match route {
            ProtectedRoute::Residential => self.residential = self.residential.saturating_add(1),
            ProtectedRoute::Direct => self.direct = self.direct.saturating_add(1),
            ProtectedRoute::Proxied => self.proxied = self.proxied.saturating_add(1),
            ProtectedRoute::Blocked => self.blocked = self.blocked.saturating_add(1),
            ProtectedRoute::Unknown => self.unknown = self.unknown.saturating_add(1),
        }
        self.latest = Some((route, destination));
    }

    fn invariant_violations(self) -> u32 {
        self.direct.saturating_add(self.proxied)
    }
}

const ANTHROPIC_DESTINATIONS: &[&str] = &[
    "anthropic.com",
    "claude.ai",
    "claude.com",
    "claude.app",
    "claude.site",
    "clau.de",
    "anthropic.ai",
    "claudestudio.com",
    "claudemcpclient.com",
    "claudemcpcontent.com",
    "claudeusercontent.com",
    "servd-anthropic-website.b-cdn.net",
];
const TURNSTILE_DESTINATIONS: &[&str] = &[
    "challenges.cloudflare.com",
    "cf-assets.www.cloudflare.com",
];
const UPDATE_DESTINATIONS: &[&str] = &[
    "storage.googleapis.com",
    "registry.npmjs.org",
    "raw.githubusercontent.com",
    "formulae.brew.sh",
];
const TELEMETRY_DESTINATIONS: &[&str] = &[
    "cloudflareinsights.com",
    "browser-intake-datadoghq.com",
    "browser-intake-us5-datadoghq.com",
    "browser-intake-us3-datadoghq.com",
    "browser-intake-ap1-datadoghq.com",
    "browser-intake-ap2-datadoghq.com",
    "browser-intake-datadoghq.eu",
    "browser-intake-ddog-gov.com",
    "datadoghq.com",
    "statsigapi.net",
    "featuregates.org",
    "growthbook.io",
    "stripe.network",
    "sentry.io",
];

fn host_matches_suffix(host: &str, suffix: &str) -> bool {
    host == suffix
        || host
            .strip_suffix(suffix)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn protected_destination(connection: &SampledConnection) -> Option<ProtectedDestination> {
    let host = connection
        .metadata
        .host
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    for (category, suffixes) in [
        (ProtectedDestination::Anthropic, ANTHROPIC_DESTINATIONS),
        (ProtectedDestination::Turnstile, TURNSTILE_DESTINATIONS),
        (ProtectedDestination::Update, UPDATE_DESTINATIONS),
        (ProtectedDestination::Telemetry, TELEMETRY_DESTINATIONS),
    ] {
        if suffixes.iter().any(|suffix| host_matches_suffix(&host, suffix)) {
            return Some(category);
        }
    }

    let address = connection.metadata.destination_ip.trim();
    config::CLAUDE_HOME_IPV4_CIDRS
        .iter()
        .any(|cidr| ipv4_in_cidr(address, cidr))
        .then_some(ProtectedDestination::Anthropic)
}

fn ipv4_in_cidr(address: &str, cidr: &str) -> bool {
    let Ok(address) = address.parse::<std::net::Ipv4Addr>() else {
        return false;
    };
    let Some((network, prefix)) = cidr.split_once('/') else {
        return false;
    };
    let (Ok(network), Ok(prefix)) = (network.parse::<std::net::Ipv4Addr>(), prefix.parse::<u32>()) else {
        return false;
    };
    if prefix > 32 {
        return false;
    }
    let mask = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix) };
    u32::from(address) & mask == u32::from(network) & mask
}

/// Mihomo lists the terminal outbound first and selector groups after it. The terminal is the
/// authority: a residential SOCKS hop can legitimately be followed by `Tono-Exit` because that
/// is its dialer transport, while `Tono-Exit` as the terminal means protected traffic missed the
/// residential route. Every outcome is mutually exclusive.
fn classify_protected_route(connection: &SampledConnection, residential_target: &str) -> ProtectedRoute {
    let blocked = |value: &str| {
        matches!(
            value.trim().to_ascii_uppercase().as_str(),
            "REJECT" | "REJECT-DROP" | "DROP" | "BLOCK"
        )
    };
    if connection.chains.iter().any(|hop| blocked(hop))
        || blocked(&connection.rule)
        || blocked(&connection.rule_payload)
    {
        return ProtectedRoute::Blocked;
    }
    let Some(terminal) = connection.chains.first().map(|hop| hop.trim()).filter(|hop| !hop.is_empty()) else {
        return ProtectedRoute::Unknown;
    };
    if terminal == residential_target {
        return ProtectedRoute::Residential;
    }
    if terminal.eq_ignore_ascii_case("DIRECT")
        || terminal == config::DIRECT_GROUP_NAME
        || terminal == config::WEB_DIRECT_GROUP_NAME
    {
        return ProtectedRoute::Direct;
    }
    ProtectedRoute::Proxied
}

fn protected_connection_key(connection: &SampledConnection) -> u64 {
    use std::hash::{Hash as _, Hasher as _};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    if connection.id.is_empty() {
        connection.metadata.host.hash(&mut hasher);
        connection.metadata.destination_ip.hash(&mut hasher);
        connection.metadata.destination_port.hash(&mut hasher);
        connection.metadata.network.hash(&mut hasher);
        connection.metadata.process_path.hash(&mut hasher);
        connection.chains.hash(&mut hasher);
    } else {
        connection.id.hash(&mut hasher);
    }
    hasher.finish()
}

fn observe_protected_routes(
    payload: &SampledConnections,
    residential_target: &str,
    seen: &mut std::collections::HashSet<u64>,
    aggregate: &mut ProtectedRouteAggregate,
) -> bool {
    let mut changed = false;
    for connection in &payload.connections {
        if seen.len() >= MAX_PROTECTED_ROUTE_SAMPLES {
            break;
        }
        let Some(destination) = protected_destination(connection) else {
            continue;
        };
        if !seen.insert(protected_connection_key(connection)) {
            continue;
        }
        let route = classify_protected_route(connection, residential_target);
        aggregate.observe(route, destination);
        changed = true;
    }
    changed
}

/// Which connections went out the physical interface, and which of those are new this session.
///
/// A connection counts as DIRECT when its proxy chain names one of the interface-bound direct
/// outbounds. The chain is the authority, not the rule: a rule names a *group*, and a group
/// that failed over is exactly the case where the rule and the actual path disagree — the same
/// distinction the macOS route classifier had to make.
fn new_direct_samples(
    payload: &SampledConnections,
    seen: &mut std::collections::HashSet<(String, u16, bool, String)>,
) -> Vec<DirectSample> {
    let mut fresh = Vec::new();
    for connection in &payload.connections {
        let direct = connection.chains.iter().any(|hop| {
            hop == config::DIRECT_GROUP_NAME || hop == config::WEB_DIRECT_GROUP_NAME
        });
        if !direct {
            continue;
        }
        // Both shapes occur and both matter. A raw-IP dial — WeChat's HTTPDNS path, the one
        // rule H exists for — reports an address and no name. A domain-routed flow under
        // fake-ip reports the name, and its `destinationIP` is either absent or a fake-ip
        // placeholder that no prefix set could be computed from. Recording only the address
        // would therefore miss exactly the traffic this instrumentation is for on half the
        // flows, so keep whichever the controller gave.
        let address = connection.metadata.destination_ip.trim();
        let host = connection.metadata.host.trim();
        if address.is_empty() && host.is_empty() {
            continue;
        }
        let Ok(port) = connection.metadata.destination_port.trim().parse::<u16>() else {
            continue;
        };
        let udp = connection.metadata.network.eq_ignore_ascii_case("udp");
        let process = connection
            .metadata
            .process_path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or_default()
            .to_owned();
        // The process belongs in the key. Without it, the second process to reach an address
        // some other process already reached is silently dropped — and "a process that is not
        // WeChat went direct" is an alarm, not a statistic, so suppressing it is the one
        // deduplication this must not do.
        let key = (
            if address.is_empty() { host.to_owned() } else { address.to_owned() },
            port,
            udp,
        );
        if !seen.insert((key.0.clone(), key.1, key.2, process.clone())) {
            continue;
        }
        fresh.push(DirectSample {
            address: address.to_owned(),
            host: host.to_owned(),
            port,
            udp,
            process,
            chain: connection.chains.join(" <- "),
            rule: if connection.rule_payload.is_empty() {
                connection.rule.clone()
            } else {
                format!("{} {}", connection.rule, connection.rule_payload)
            },
        });
    }
    fresh
}

/// Read the controller once, record DIRECT diagnostics, and update protected-route evidence.
///
/// Returns `false` when the caller should stop sampling — a superseded generation, or every
/// applicable cap reached. Every other failure is swallowed: this is instrumentation, and a
/// controller that is briefly unreachable must never disturb a working tunnel.
async fn sample_connections_once(
    state: &Arc<TonoState>,
    generation: u64,
    residential_target: Option<&str>,
    direct_seen: &mut std::collections::HashSet<(String, u16, bool, String)>,
    protected_seen: &mut std::collections::HashSet<u64>,
    protected_aggregate: &mut ProtectedRouteAggregate,
) -> bool {
    let direct_active = direct_seen.len() < MAX_DIRECT_SAMPLES;
    let protected_active = residential_target.is_some() && protected_seen.len() < MAX_PROTECTED_ROUTE_SAMPLES;
    if !direct_active && !protected_active {
        return false;
    }
    let (secret, port) = {
        let inner = state.lock().await;
        // `connect_generation`, matching the sibling arms of this task. The first version
        // compared `controller_generation` — a different counter, bumped per controller setup —
        // which never equalled the connect generation this task was spawned with, so the very
        // first tick disabled sampling and nothing was ever recorded.
        if inner.connect_generation != generation || !inner.fsm.status().is_connected {
            return false;
        }
        match inner.controller_secret.clone().zip(inner.controller_port) {
            Some(pair) => pair,
            None => return true,
        }
    };
    let Ok(client) = controller_client(Duration::from_secs(2)) else {
        return true;
    };
    let Ok(response) = client
        .get(controller_url(port, "/connections"))
        .bearer_auth(secret)
        .send()
        .await
    else {
        return true;
    };
    let Ok(payload) = response.json::<SampledConnections>().await else {
        return true;
    };

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

    direct_seen.len() < MAX_DIRECT_SAMPLES
        || residential_target.is_some() && protected_seen.len() < MAX_PROTECTED_ROUTE_SAMPLES
}

async fn spawn_control_plane_pin_refresh(
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
        let mut watching_wechat = true;
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
                            "Tono: browser Secure DNS changed during a residential session; restricting traffic and reconnecting: {redacted}"
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
                _ = wechat_interval.tick(), if watching_wechat => {
                    if skip_first_wechat {
                        skip_first_wechat = false;
                        continue;
                    }
                    if signed_wechat_paths_require_reconnect(&task_state, generation).await {
                        if !connection_loop_continues(handle_network_change(&task_state, &task_app).await) {
                            return;
                        }
                        // Recovered in place: no reconnect ran, so the applied path set cannot
                        // change for the rest of this session and this leg would report the same
                        // difference every two minutes. Retire the leg, not the task — the pin
                        // refresh and the direct sampling keep running.
                        watching_wechat = false;
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

async fn refresh_control_plane_pins_once(state: &Arc<TonoState>, generation: u64) -> bool {
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
    let inner = state.lock().await;
    if inner.connect_generation != generation {
        return false;
    }
    if let Err(error) = inner.client.transport().refresh_control_plane_pins().await {
        logging!(
            warn,
            Type::Service,
            "Tono: failed to refresh control-plane HTTP pins: {error:#}"
        );
    }
    true
}

fn wechat_paths_changed(applied: Option<&[String]>, discovered: &[String]) -> bool {
    let Some(applied) = applied else {
        return false;
    };
    applied != discovered
}

async fn signed_wechat_paths_require_reconnect(state: &Arc<TonoState>, generation: u64) -> bool {
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

fn spawn_exit_identity_lookup(state: &Arc<TonoState>, app: &AppHandle, generation: u64) {
    let state = Arc::clone(state);
    let app = app.clone();
    AsyncHandler::spawn(move || async move {
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
        inner.exit_ip = Some(ip.to_string());
        inner.exit_org = (!org.is_empty()).then(|| org.to_string());
        inner.exit_location = location;
        commands::emit_status(&app, &commands::status_of(&inner));
    });
}

/// C3 — the post-lock verification group: an advisory controller delay check followed by the
/// authoritative real App data-plane check, retried up to [`POST_LOCK_VERIFY_ROUNDS`] times
/// inside the still-live transaction.
///
/// Why here and not in the failure path: by this point WFP is armed *and* locked and the tunnel
/// is proven up, but `session_verified` is committed only after both stages pass. A failure
/// therefore reaches `plan_failure(armed = true, session_verified = false, ..)` → `FullRelease`,
/// which destroys the tunnel — and `next_reconnect_delay()` then requires
/// `is_protection_blocked && session_verified`, both false afterwards, so nothing retries. A
/// single transient 504 on the exit probe took a working tunnel to NotConnected with no recovery.
///
/// Fail-closed is untouched: a controller `/delay` 504 is tolerated only if a fresh HTTPS request
/// from this App succeeds while WFP is locked and system DNS points into WinTUN. That is stronger
/// proof of user traffic than Mihomo's doubled synthetic measurement. Nothing here marks a
/// session verified until that proof passes, releases or weakens the barrier, or shortens any
/// release; an exhausted real-data-plane check still reaches the same `FullRelease`.
#[allow(clippy::too_many_arguments, reason = "stage helper mirrors run_stages' own context")]
async fn verify_post_lock(
    state: &Arc<TonoState>,
    app: &AppHandle,
    secret: &str,
    controller_port: u16,
    mixed_port: u16,
    generation: u64,
    started: std::time::Instant,
    transaction: &ConnectTransaction,
) -> Result<KillSwitchStatus, StageFailure> {
    // §6.8 is deliberately one advisory measurement for the whole verification group. Repeating
    // Mihomo's doubled `unified-delay` request on every TUN retry used to spend another full
    // cross-border round without adding any connection proof.
    // CheckingExit is only a UI label. The real TUN race starts immediately;
    // controller /delay may finish later and is never required for Connected.
    set_stage(state, app, ConnectStage::CheckingExit, generation, true, started).await?;
    let controller_secret = secret.to_string();
    let mut controller_task = Some(tokio::spawn(async move {
        probe_exit_once(&controller_secret, controller_port).await
    }));
    set_stage(state, app, ConnectStage::VerifyingTraffic, generation, true, started).await?;
    let mut last = String::from("post-lock verification did not run");
    for round in 0..POST_LOCK_VERIFY_ROUNDS {
        if round > 0 && state.lock().await.connect_generation != generation {
            if let Some(task) = controller_task.take() {
                task.abort();
            }
            return Err(stale_after_arm(state, generation).await);
        }
        let final_round = round + 1 == POST_LOCK_VERIFY_ROUNDS;
        let (data_plane, proxy_cross_check) = if final_round {
            let (data_plane, proxy) = transaction
                .wait("real TUN verification with proxy cross-check", async {
                    tokio::join!(verify_locked_data_plane(), verify_mixed_proxy_data_plane(mixed_port))
                })
                .await?;
            (data_plane, Some(proxy))
        } else {
            (
                transaction
                    .wait("real TUN data-plane verification", verify_locked_data_plane())
                    .await?,
                None,
            )
        };
        let data_plane_error = data_plane.as_ref().err().cloned();
        let controller_probe = if data_plane.is_ok() {
            match controller_task.as_ref() {
                Some(task) if task.is_finished() => match controller_task.take().unwrap().await {
                    Ok(result) => match result {
                        Ok(delay) => {
                            if delay > 0 {
                                let mut inner = state.lock().await;
                                inner.record_exit_delay(delay);
                            }
                            Ok(())
                        }
                        Err(error) => Err(error),
                    },
                    Err(_) => Ok(()),
                },
                _ => Ok(()),
            }
        } else if final_round {
            let task = controller_task.take();
            transaction
                .wait("advisory exit measurement", async {
                    match task {
                        Some(task) => match task.await {
                            Ok(result) => match result {
                                Ok(delay) => {
                                    if delay > 0 {
                                        let mut inner = state.lock().await;
                                        inner.record_exit_delay(delay);
                                    }
                                    Ok(())
                                }
                                Err(error) => Err(error),
                            },
                            Err(_) => Err("controller probe cancelled".to_string()),
                        },
                        None => Ok(()),
                    }
                })
                .await?
        } else {
            Ok(())
        };

        match classify_post_lock_verification(controller_probe.clone(), data_plane) {
            PostLockVerification::Verified {
                status,
                controller_warning,
            } => {
                if let Some(error) = controller_warning {
                    let error = audit::redact(&error);
                    logging!(
                        warn,
                        Type::Service,
                        "Tono: controller exit measurement degraded; real TUN data plane passed: {error}"
                    );
                    state.audit().log(AuditEvent::HealthProbeFail {
                        probe: "controllerExitAdvisory",
                        error,
                    });
                }
                return Ok(status);
            }
            PostLockVerification::Retry { error } => {
                last = match (proxy_cross_check, data_plane_error) {
                    (Some(proxy), Some(data_plane)) => {
                        classify_exhausted_data_plane(controller_probe, data_plane, proxy)
                    }
                    _ => error,
                };
            }
        }
        if final_round {
            break;
        }
        logging!(
            warn,
            Type::Service,
            "Tono: 隧道已锁定但验证未通过，重试验证阶段 ({}/{}): {last}",
            round + 1,
            POST_LOCK_VERIFY_ROUNDS
        );
        transaction
            .wait(
                "post-lock verification retry",
                tokio::time::sleep(POST_LOCK_VERIFY_ROUND_DELAY),
            )
            .await?;
    }
    Err(StageFailure::error(last))
}

#[derive(Debug, PartialEq, Eq)]
enum PostLockVerification<T> {
    Verified {
        status: T,
        controller_warning: Option<String>,
    },
    Retry {
        error: String,
    },
}

fn classify_post_lock_verification<T>(
    controller_probe: Result<(), String>,
    data_plane: Result<T, String>,
) -> PostLockVerification<T> {
    match tono_core::classify_post_lock(controller_probe, data_plane) {
        tono_core::PostLockDecision::Connected {
            status,
            controller_advisory,
        } => PostLockVerification::Verified {
            status,
            controller_warning: controller_advisory,
        },
        tono_core::PostLockDecision::Retry { error, .. } => PostLockVerification::Retry { error },
    }
}

fn classify_exhausted_data_plane(
    controller_probe: Result<(), String>,
    data_plane: String,
    proxy_cross_check: Result<(), String>,
) -> String {
    let (code, _) = tono_core::classify_exhausted_data_plane(
        controller_probe.clone(),
        data_plane.clone(),
        proxy_cross_check.clone(),
        false,
    );
    let body = match (controller_probe, proxy_cross_check) {
        (Ok(()), Ok(())) => format!(
            "{TUN_DATA_PLANE_BROKEN_PREFIX}: selected node and Mihomo proxy egress passed, but the Windows TUN data plane failed: {data_plane}"
        ),
        (Err(controller), Ok(())) => format!(
            "{TUN_DATA_PLANE_BROKEN_PREFIX}: loopback proxy egress passed despite controller warning ({controller}), but the Windows TUN data plane failed: {data_plane}"
        ),
        (Ok(()), Err(proxy)) => format!(
            "{TUN_INGRESS_BROKEN_PREFIX}: controller node egress passed, but both App ingress paths failed; TUN: {data_plane}; loopback proxy: {proxy}"
        ),
        (Err(controller), Err(proxy)) => format!(
            "{NODE_OR_CORE_UNREACHABLE_PREFIX}: controller, Windows TUN, and loopback proxy checks all failed; controller: {controller}; TUN: {data_plane}; loopback proxy: {proxy}"
        ),
    };
    format!("{body} [{}]", code.as_str())
}

/// The generation guard used between the long I/O steps.
async fn ensure_fresh(state: &Arc<TonoState>, generation: u64) -> Result<(), StageFailure> {
    if state.lock().await.connect_generation != generation {
        return Err(StageFailure::Stale);
    }
    Ok(())
}

/// Keep a mutating StartClash request alive if its reconnect/switch parent is aborted. Dropping a
/// direct IPC future can discard the response while the Service still commits; this detached child
/// always reaches the generation check and patches a late arm for releasing transitions.
async fn start_core_cancellation_safe(
    state: &Arc<TonoState>,
    bundle: RuntimeBundle,
    kill_switch: KillSwitchConfig,
    generation: u64,
) -> Result<(), StageFailure> {
    let mutation_guard = state.begin_connect_mutation().await;
    if state.lock().await.connect_generation != generation {
        drop(mutation_guard);
        return Err(StageFailure::Stale);
    }
    let task_state = Arc::clone(state);
    let task = tokio::spawn(async move {
        let _mutation_guard = mutation_guard;
        service::tono_start_core_with_kill_switch(bundle, kill_switch)
            .await
            .map_err(StageFailure::error)?;
        if task_state.lock().await.connect_generation != generation {
            return Err(stale_after_arm(&task_state, generation).await);
        }
        Ok(())
    });
    task.await
        .map_err(|error| StageFailure::error(format!("StartClash reconciliation task failed: {error}")))?
}

/// Cancellation-safe counterpart for DNS enable. A disconnect may restore and release while an
/// old enable is still in flight; the detached child restores again after that late commit.
async fn enable_dns_cancellation_safe(
    state: &Arc<TonoState>,
    generation: u64,
    service_session: OwnerSessionProof,
) -> Result<(), StageFailure> {
    let mutation_guard = state.begin_connect_mutation().await;
    if state.lock().await.connect_generation != generation {
        drop(mutation_guard);
        return Err(StageFailure::Stale);
    }
    let task_state = Arc::clone(state);
    let task = tokio::spawn(async move {
        let _mutation_guard = mutation_guard;
        service::tono_enable_protected_dns_for_session(&service_session)
            .await
            .map_err(StageFailure::error)?;
        if task_state.lock().await.connect_generation != generation {
            return Err(stale_after_dns(&task_state, generation).await);
        }
        Ok(())
    });
    task.await
        .map_err(|error| StageFailure::error(format!("DNS reconciliation task failed: {error}")))?
}

/// H-1 decision: a stale exit only patches the late arm when the StartClash
/// IPC actually returned success (a failed IPC never armed anything) *and*
/// the generation bump came from a releasing flow (disconnect / sign-out /
/// quit) — a node switch or catalog teardown re-arms or keeps the barrier,
/// so releasing here would tear down their protection instead.
pub fn stale_exit_needs_release(start_clash_committed: bool, release_intent: bool) -> bool {
    start_clash_committed && release_intent
}

/// A stale exit past a committed StartClash (H-1): the IPC cannot be
/// retracted and the bumper's release may have run before the Service
/// committed, so patch the late arm with one best-effort owner-gated
/// release (idempotent, no session needed).
///
/// Chosen over join-waiting the in-flight attempt inside disconnect /
/// sign-out: the join would serialize the user's release behind a
/// StartClash lifecycle IPC of up to ~30 s, while this patch is bounded and
/// order-safe by construction — it runs strictly after the arm commit it
/// patches, and is idempotent against the bumper's own release.
async fn stale_after_arm(state: &Arc<TonoState>, generation: u64) -> StageFailure {
    // Asks for the intent of the bump that retired *this* generation, not the latest one: a
    // later non-releasing bump must not downgrade a pending release into "keep blocking".
    let release_intent = { state.lock().await.release_intent_for(generation) };
    if stale_exit_needs_release(true, release_intent) {
        logging!(
            warn,
            Type::Service,
            "Tono: 连接代际失效于 StartClash 之后，补一次 stop + owner-gated release 拆除迟到 core/arm"
        );
        // A late StartClash starts both WFP and the Core. The original releasing flow may have
        // completed before that commit, so releasing WFP alone would leave the TUN Core running.
        // Stop is best-effort, matching `release_explicit`; release remains owner-gated and
        // idempotent even if the session was already cleared.
        let _ = service::tono_stop_core(false).await;
        let _ = service::tono_release_kill_switch().await;
    }
    StageFailure::Stale
}

/// A stale DNS enable needs one extra rollback before WFP may be released. A disconnect can
/// restore DNS while the old enable IPC is still in flight; if that enable commits afterwards,
/// releasing WFP alone strands the machine on Tono's protected DNS with no answering core. Node-switch
/// invalidations deliberately keep DNS protected because their replacement transaction owns it.
async fn stale_after_dns(state: &Arc<TonoState>, generation: u64) -> StageFailure {
    let release_intent = { state.lock().await.release_intent_for(generation) };
    if release_intent {
        if let Err(error) = service::tono_restore_protected_dns().await {
            logging!(
                error,
                Type::Service,
                "Tono: 连接代际失效于 DNS 启用之后，但 DNS 恢复失败；保留 WFP 保护: {error:#}"
            );
            return StageFailure::Stale;
        }
        return stale_after_arm(state, generation).await;
    }
    StageFailure::Stale
}

/// What a connect failure does, decided purely (§6 decision table + the
/// raced-disconnect rule). Exhaustively unit-tested; `fail_connect` only
/// executes the plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FailurePlan {
    /// Latch the FSM armed flag before the decision table runs.
    pub mark_armed: bool,
    /// Stop the core: `Some(false)` keeps WFP armed, `Some(true)` releases,
    /// `None` leaves the core alone entirely.
    pub stop_core: Option<bool>,
    /// Restrict to the bootstrap recovery channel after the stop.
    pub restrict_bootstrap: bool,
}

pub fn plan_failure(armed: bool, session_verified: bool, was_disconnecting: bool) -> FailurePlan {
    if was_disconnecting {
        // A disconnect is in flight and owns the release sequence end to
        // end; the failing transaction must not double it.
        FailurePlan {
            mark_armed: false,
            stop_core: None,
            restrict_bootstrap: false,
        }
    } else if armed && session_verified {
        FailurePlan {
            mark_armed: true,
            stop_core: Some(false),
            restrict_bootstrap: true,
        }
    } else {
        // §6: failure before the WFP policy exists is a full release.
        FailurePlan {
            mark_armed: false,
            stop_core: Some(true),
            restrict_bootstrap: false,
        }
    }
}

/// Whether the explicit-release sequence may attempt a session-gated core
/// stop before the owner-gated release. Only a live session can stop; the
/// release itself never depends on one (C1: Protected Offline's session is
/// long gone).
#[cfg(any(not(windows), test))]
pub fn stop_core_before_release(core_active: bool, session_active: bool) -> bool {
    core_active && session_active
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

/// Explicit user release (Disconnect / Sign Out / Quit, §6; C1).
///
/// Windows executes DNS restore → matching Core stop/retire → WFP removal inside one owner-gated
/// Service handler, including from Protected Offline where the arming session is gone. Every
/// caller joins one App-side operation; its UI deadline never cancels the worker. A failed release
/// keeps the system armed and surfaces an error.
pub async fn release_explicit(state: &Arc<TonoState>, app: &AppHandle) -> Result<(), String> {
    let (operation, is_new) = state.begin_release().await;
    if is_new {
        let task_state = Arc::clone(state);
        let task_app = app.clone();
        let worker_state = Arc::clone(state);
        let worker_app = app.clone();
        let worker =
            tauri::async_runtime::spawn(async move { run_explicit_release_sequence(&worker_state, &worker_app).await });
        let supervised_operation = Arc::clone(&operation);
        AsyncHandler::spawn(move || async move {
            let result = worker
                .await
                .map_err(|error| format!("release reconciliation task failed: {error}"))
                .and_then(|result| result);
            if let Err(message) = &result {
                task_state
                    .audit()
                    .log(AuditEvent::ReleaseFail { error: message.clone() });
                logging!(error, Type::Service, "Tono: 安全释放对账失败: {message}");
            }
            supervised_operation.complete(result);
            task_state.finish_release(supervised_operation.id()).await;
            // A timed-out caller may no longer be present to repaint. Publish the final state (or
            // the still-protected failure state) after the coordinator has settled.
            let inner = task_state.lock().await;
            commands::emit_status(&task_app, &commands::status_of(&inner));
        });
    }

    match tokio::time::timeout(EXPLICIT_RELEASE_TIMEOUT, operation.wait()).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "release exceeded {EXPLICIT_RELEASE_TIMEOUT:?}; ordered background reconciliation continues and protection is assumed on until proven otherwise"
        )),
    }
}

/// The release worker is never owned by one UI call. On Windows the owner-gated Service route is
/// already the transaction boundary: under one lifecycle lock it proves DNS restoration, stops
/// and retires the matching Core, then removes WFP. Calling those as three App-owned IPCs would
/// recreate a cancellation window between the steps. Other platforms retain their existing
/// helper sequence until their Service route provides the same complete stop semantics.
async fn run_explicit_release_sequence(state: &Arc<TonoState>, app: &AppHandle) -> Result<(), String> {
    // Wait for detached StartClash/DNS commits that began before the release generation bump.
    // Keeping this guard through the Service call also prevents a stale mutation from starting
    // between the wait and the atomic DNS/Core/WFP transaction.
    let _release_guard = state.begin_privileged_release().await;

    #[cfg(windows)]
    // An unprotected quit may have stopped the Service after the last release. Revive the
    // registered Service before asking its owner-gated endpoint to remove protection. This is
    // the path that hands the machine its Internet back, so it always gets its prompt: a repair
    // the user declined during a connect must not leave them hard-blocked with no way out.
    service::tono_service_ready_or_repair_now()
        .await
        .map_err(|error| format!("kill switch release failed; protection stays on: {error}"))?;

    #[cfg(windows)]
    let status = service::tono_release_kill_switch()
        .await
        .map_err(|error| format!("kill switch release failed; protection stays on: {error}"))?;

    #[cfg(not(windows))]
    let status = {
        service::tono_restore_protected_dns()
            .await
            .map_err(|error| format!("DNS restore failed; protection stays on: {error}"))?;
        let core_active = matches!(*CoreManager::global().get_running_mode(), RunningMode::Service);
        if stop_core_before_release(core_active, service::tono_session_live()) {
            let _ = service::tono_stop_core(false).await;
        }
        service::tono_release_kill_switch()
            .await
            .map_err(|error| format!("kill switch release failed; protection stays on: {error}"))?
    };

    if status.wanted || status.live {
        return Err(format!(
            "kill switch release returned an armed state (wanted={}, live={})",
            status.wanted, status.live
        ));
    }

    #[cfg(windows)]
    {
        let _ = crate::core::sysopt::Sysopt::global().reset_sysproxy().await;
    }

    let mut inner = state.lock().await;
    inner.kill_switch = Some(status);
    inner.controller_secret = None;
    inner.controller_port = None;
    inner.network_events_counter = None;
    inner.last_core_pid = None;
    inner.last_restart_count = None;
    // Also closes a caller that reached its UI budget and temporarily surfaced Protected
    // Offline; this transition is allowed only after the Service proved WFP is gone. A new
    // connect cannot race this commit because `guard_snapshot` rejects while the coordinator is
    // populated.
    inner.fsm.sign_out_or_quit();
    commands::emit_status(app, &commands::status_of(&inner));
    Ok(())
}

/// Schedule the protected auto-reconnect (2/5/10/20/30 s, §6). The delay is
/// handed out only while idle in Protected Offline, and never when the
/// catalog is waiting for a fresh user choice.
pub async fn schedule_reconnect(state: &Arc<TonoState>, app: &AppHandle) {
    let mut inner = state.lock().await;
    schedule_reconnect_locked(&mut inner, state, app);
}

/// Run one protected reconnect **now**, for an explicit user action.
///
/// Deliberately not [`schedule_reconnect`]: that hands out the next rung of the
/// 2/5/10/20/30 s ladder and consumes it. "Retry now" aborts the attempt that was
/// already pending, so going through the ladder replaced an imminent retry with a
/// longer wait and advanced the ladder as well — every press pushed recovery
/// further away, and the countdown the user was watching jumped upward. The
/// safety predicate is unchanged: still only while idle in Protected Offline with
/// a verified session and no pending catalog choice.
pub async fn retry_reconnect_now(state: &Arc<TonoState>, app: &AppHandle) {
    let mut inner = state.lock().await;
    if !reconnect_allowed(
        inner.catalog_requires_choice,
        inner.fsm.status(),
        inner.fsm.kill_switch_armed(),
    ) || !inner.fsm.reconnect_permitted_now()
    {
        return;
    }
    let task_state = state.clone();
    let task_app = app.clone();
    inner.catalog_failover_tried.clear();
    // A press is the evidence the ladder cannot have: someone is at the machine and may have
    // just fixed what was wrong with it. Give the automatic retries their full budget back, so
    // the bound that stops an unattended loop can never strand a repaired install.
    inner.fsm.reset_reconnect_backoff();
    let handle =
        AsyncHandler::spawn(move || Box::pin(reconnect_loop(task_state, task_app, Duration::ZERO)) as BoxedTask);
    inner.tasks.reconnect = Some(handle);
    // The deadline is now, so the UI stops showing a countdown it is no longer
    // waiting for.
    inner.next_retry_at_ms = Some(commands::epoch_millis());
    state.audit().log(AuditEvent::ReconnectScheduled { delay_ms: 0 });
}

/// Say the ladder ended, at either of the two places it can end.
///
/// The ladder gave up, not the protection: WFP stays armed, the UI keeps showing Protected
/// Offline with the last failure, and "Retry now" still runs (and hands the ladder its budget
/// back). What stops is the unattended repetition of an attempt that has already failed the same
/// way for the whole budget — including the elevated repair it can reach, which is what turned a
/// broken install into an administrator prompt every thirty seconds for as long as the app was
/// open. [`schedule_reconnect_locked`] hands out the first rung and [`reconnect_loop`] owns every
/// one after it, so the unattended outage that actually spends the budget ends inside the loop:
/// without this, support could not tell "gave up" from "crashed".
fn note_reconnect_budget_exhausted(state: &Arc<TonoState>) {
    logging!(
        warn,
        Type::Service,
        "Tono: 自动重连已用尽 {:?} 的重试预算，保持 Protected Offline 等待用户操作",
        ReconnectBackoff::BUDGET
    );
    state.audit().log(AuditEvent::ProtectedOffline {
        reason: "reconnectBudgetExhausted",
    });
}

/// Lock-held half of [`schedule_reconnect`]. Spawning and registering are one critical section:
/// Disconnect/sign-out must never observe an empty task slot and then be followed by a reconnect
/// handle that escaped their abort.
fn schedule_reconnect_locked(inner: &mut TonoInner, state: &Arc<TonoState>, app: &AppHandle) {
    if !reconnect_allowed(
        inner.catalog_requires_choice,
        inner.fsm.status(),
        inner.fsm.kill_switch_armed(),
    ) {
        return;
    }
    if inner
        .tasks
        .reconnect
        .as_ref()
        .is_some_and(|handle| !handle.inner().is_finished())
    {
        return;
    }
    let Some(delay) = inner.fsm.next_reconnect_delay() else {
        if inner.fsm.reconnect_budget_exhausted() {
            note_reconnect_budget_exhausted(state);
        }
        return;
    };
    let task_state = state.clone();
    let task_app = app.clone();
    // The task future is boxed into a trait object so this function's opaque
    // type never embeds the reconnect loop's (which re-enters `attempt`).
    let handle = AsyncHandler::spawn(move || Box::pin(reconnect_loop(task_state, task_app, delay)) as BoxedTask);
    inner.tasks.reconnect = Some(handle);
    // F3: expose the scheduled deadline to the UI.
    inner.next_retry_at_ms = Some(commands::epoch_millis() + delay.as_millis() as i64);
    state.audit().log(AuditEvent::ReconnectScheduled {
        delay_ms: delay.as_millis() as u64,
    });
}

/// After account/catalog restore, take control of a strongly proven same-owner active runtime by
/// scheduling the normal protected reconnect. This never marks Connected directly. If any proof
/// disappeared, the GUI remains truthfully Protected Offline and waits for an explicit action.
pub async fn schedule_startup_resume_if_proven(state: &Arc<TonoState>, app: &AppHandle, restore_generation: u64) {
    // Capture both cancellation authorities before the IPC proof. Disconnect, sign-out, node
    // replacement, or a newer restore can then retire this probe while it is awaiting the
    // Service rather than letting a stale result resurrect protection afterwards.
    let (connect_generation, cancellation) = {
        let inner = state.lock().await;
        if inner.sign_in_generation != restore_generation {
            return;
        }
        (inner.connect_generation, inner.connect_cancellation.clone())
    };
    let proven = tokio::select! {
        biased;
        _ = cancellation.cancelled() => false,
        status = active_runtime_resume_status() => status.is_some(),
    };
    if !proven {
        return;
    }

    let mut inner = state.lock().await;
    let selected_is_valid = inner
        .selected_node
        .as_ref()
        .is_some_and(|selected| inner.nodes.iter().any(|node| node.name == *selected));
    // The Service proof authorizes only scheduling. It must not write its now-stale snapshot back
    // into local state or manufacture FSM latches: the startup restore already recorded the
    // durable protection it observed. Requiring those latches to remain current is what makes an
    // intervening Disconnect/release win.
    let reconnectable = reconnect_allowed(
        inner.catalog_requires_choice,
        inner.fsm.status(),
        inner.fsm.kill_switch_armed(),
    );
    if !startup_resume_guards_hold(
        inner.sign_in_generation == restore_generation,
        inner.connect_generation == connect_generation,
        matches!(inner.account_state, AccountState::Ready),
        selected_is_valid,
        inner.fsm.session_verified(),
        reconnectable,
    ) {
        return;
    }
    // Register under this same generation/admission lock. A later Disconnect/sign-out either
    // sees this handle and aborts it, or ran first and failed one of the checks above.
    schedule_reconnect_locked(&mut inner, state, app);
}

/// Whether a protected reconnect may run: the barrier is up, the machine is
/// idle in Protected Offline, and the catalog is not waiting for the user.
/// Guard rejections that describe a moment rather than a decision.
///
/// `guard_snapshot`'s first check is `release_in_progress`, which is transient by construction,
/// and its transition check clears as soon as the in-flight attempt ends. Treating either as a
/// verdict ends the reconnect chain for good, and the machine then sits blocked in Protected
/// Offline with no scheduled retry and nothing shown to the user. Everything else — suspended,
/// signed out, no selection, a vanished node — needs a person, so it correctly stops the chain.
pub fn guard_rejection_is_transient(reason: &str) -> bool {
    reason.contains(RELEASE_RECONCILING_PREFIX)
        || reason == TRANSITION_IN_FLIGHT_REJECTION
        || reason == CATALOG_NOT_READY_REJECTION
}

pub fn reconnect_allowed(requires_choice: bool, status: &ConnectionStatus, kill_switch_armed: bool) -> bool {
    kill_switch_armed
        && !requires_choice
        && status.is_protection_blocked
        && !status.is_connected
        && !status.is_connecting
        && !status.is_disconnecting
}

/// Whether sign-out must run the explicit-release sequence before clearing
/// account state (§2/§6): anything that could hold protection counts —
/// including an in-flight connect (M-1: disconnect's guard and quit_release
/// already include it; sign-out must not be the exception).
pub fn sign_out_needs_release(status: &ConnectionStatus, kill_switch_armed: bool) -> bool {
    kill_switch_armed
        || status.is_connected
        || status.is_connecting
        || status.is_protection_blocked
        || status.is_disconnecting
}

/// F3: `tono_retry_now` is a success-no-op in these states; anything else
/// falls through to the normal reconnect predicate (`reconnect_allowed`).
pub fn retry_now_is_noop(status: &ConnectionStatus) -> bool {
    status.is_connected || status.is_connecting
}

/// F5 single-flight predicate (called with the state lock already held):
/// begin the transaction only when the generation matches *and* no tunnel
/// or transaction exists. Two racing attempts calling this back-to-back
/// produce exactly one `true` — the observable proof that only one of them
/// enters `run_stages`.
pub fn single_flight_begin(
    fsm: &mut tono_core::connection::ConnectionFsm,
    current_generation: u64,
    captured_generation: u64,
) -> bool {
    if current_generation != captured_generation {
        return false;
    }
    if fsm.status().is_connecting || fsm.status().is_connected {
        return false;
    }
    fsm.begin_connect();
    true
}

/// What selecting a server does to the connection machinery (H1/M2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectAction {
    /// Same node, no pending catalog choice: the command is a pure no-op —
    /// generation, tasks, and the H-1 intent bit stay untouched.
    Noop,
    /// Selection state updates only (new pick while idle); no transaction,
    /// no generation bump, no intent write.
    UpdateOnly,
    /// Derive the §6 node-switch transaction.
    Switch,
    /// Schedule a protected reconnect (M5: also when a vanished node's
    /// replacement was just picked, i.e. `requires_choice` cleared).
    Reconnect,
}

pub fn select_action(
    changed: bool,
    requires_choice: bool,
    status: &ConnectionStatus,
    kill_switch_armed: bool,
) -> SelectAction {
    if !changed && !requires_choice {
        return SelectAction::Noop;
    }
    if changed && (status.is_connected || status.is_connecting) {
        return SelectAction::Switch;
    }
    if (changed || requires_choice) && reconnect_allowed(false, status, kill_switch_armed) {
        return SelectAction::Reconnect;
    }
    SelectAction::UpdateOnly
}

/// F3: publish (or withdraw) the deadline the Protected Offline card counts down to.
///
/// [`schedule_reconnect_locked`] and the immediate retry write it for the rung they hand out,
/// but every rung after the first belongs to [`reconnect_loop`], which only computed a delay and
/// slept. The card therefore showed Protected Offline and a stale error through the whole
/// 5/10/20/30 s wait with nothing saying a retry was queued.
async fn publish_next_retry(state: &Arc<TonoState>, delay: Option<Duration>) {
    let mut inner = state.lock().await;
    inner.next_retry_at_ms = delay.map(|delay| commands::epoch_millis() + delay.as_millis() as i64);
}

async fn reconnect_loop(state: Arc<TonoState>, app: AppHandle, first_delay: Duration) {
    let mut delay = first_delay;
    loop {
        tokio::time::sleep(delay).await;
        let allowed = {
            let inner = state.lock().await;
            reconnect_allowed(
                inner.catalog_requires_choice,
                inner.fsm.status(),
                inner.fsm.kill_switch_armed(),
            )
        };
        if !allowed {
            publish_next_retry(&state, None).await;
            return;
        }
        match attempt(&state, &app).await {
            Attempt::Connected => {
                seed_autostart_after_connect();
                return;
            }
            Attempt::Stale => {
                publish_next_retry(&state, None).await;
                return;
            }
            Attempt::GuardRejected(reason) => {
                if !guard_rejection_is_transient(&reason) {
                    publish_next_retry(&state, None).await;
                    return;
                }
                // The attempt never started, so this is not a connect failure: no `fail_connect`,
                // no error shown, no retry_attempt bump. It only earns the next delay, because
                // ending the loop here would strand the machine blocked with nothing scheduled.
                logging!(info, Type::Service, "Tono: 自动重连被暂态守卫拒绝，稍后重试: {reason}");
                let (next, spent) = {
                    let mut inner = state.lock().await;
                    let next = inner.fsm.next_reconnect_delay();
                    (next, inner.fsm.reconnect_budget_exhausted())
                };
                publish_next_retry(&state, next).await;
                match next {
                    Some(next_delay) => delay = next_delay,
                    None => {
                        if spent {
                            note_reconnect_budget_exhausted(&state);
                        }
                        return;
                    }
                }
            }
            Attempt::Failed(err) => {
                let err = fail_connect(&state, &app, err).await;
                let (next, spent) = {
                    let mut inner = state.lock().await;
                    let next = if inner.catalog_requires_choice {
                        None
                    } else {
                        inner.fsm.next_reconnect_delay()
                    };
                    (next, inner.fsm.reconnect_budget_exhausted())
                };
                publish_next_retry(&state, next).await;
                match next {
                    Some(next_delay) => delay = next_delay,
                    None => {
                        if spent {
                            note_reconnect_budget_exhausted(&state);
                        }
                        return;
                    }
                }
            }
        }
    }
}

/// `tono_disconnect`: cancel the reconnect, then the explicit-release
/// sequence (DNS restore → core stop → owner-gated release, §6/C1).
/// Idempotent while a disconnect is already in flight (L6).
pub async fn disconnect(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    {
        let mut inner = state.lock().await;
        if inner.fsm.status().is_disconnecting {
            return Ok(());
        }
        inner.invalidate_connection(true);
        let status = inner.fsm.status();
        if !status.is_connected && !status.is_connecting && !status.is_protection_blocked {
            return Ok(());
        }
        inner.fsm.begin_disconnect();
        commands::emit_status(&app, &commands::status_of(&inner));
    }
    state.audit().log(AuditEvent::DisconnectBegin { cause: "user" });

    if let Err(err) = release_explicit(&state, &app).await {
        stay_armed_after_failed_release(&state, &app).await;
        return Err(err);
    }

    let mut inner = state.lock().await;
    inner.fsm.finish_disconnect();
    inner.controller_secret = None;
    inner.controller_port = None;
    inner.kill_switch = None;
    inner.network_events_counter = None;
    inner.last_core_pid = None;
    inner.last_restart_count = None;
    // F3: a user disconnect supersedes the backoff state.
    inner.retry_attempt = 0;
    inner.next_retry_at_ms = None;
    commands::emit_status(&app, &commands::status_of(&inner));
    state.audit().log(AuditEvent::DisconnectOk);
    Ok(())
}

/// A releasing step failed mid-disconnect: fall back to Protected Offline
/// without ever disarming (§6). `initial_release_failed`, not
/// `connect_failed`: for an armed-but-unverified session the latter's
/// decision table resolves to FullRelease and clears the armed latch even
/// though the Service release just failed — the UI would show notConnected
/// over a still-blocking WFP barrier and `quit_release` would then skip the
/// release entirely. `initial_release_failed` keeps the real armed state
/// visible in every combination (and also clears a stuck `is_disconnecting`
/// when the release failed before any arm existed).
async fn stay_armed_after_failed_release(state: &Arc<TonoState>, app: &AppHandle) {
    let mut inner = state.lock().await;
    inner.fsm.initial_release_failed();
    commands::emit_status(app, &commands::status_of(&inner));
}

/// §3: the selected node vanished from a new catalog while a tunnel was up —
/// stop the core, keep the kill switch armed, and wait for the user to pick
/// a surviving node (no auto-reconnect).
pub async fn selected_node_vanished(state: Arc<TonoState>, app: AppHandle) {
    let generation = {
        let mut inner = state.lock().await;
        let active = inner.fsm.status().is_connected || inner.fsm.status().is_connecting;
        // M2: only touch the generation, the intent bit, and the tasks when
        // a teardown actually follows — an idle catalog shrink must not
        // stomp a releaser's intent.
        if active {
            // The teardown keeps blocking, so a stale attempt must not
            // release the barrier (H-1 intent).
            inner.invalidate_connection(false);
        }
        active.then_some(inner.connect_generation)
    };
    let Some(generation) = generation else {
        return;
    };
    logging!(warn, Type::Service, "Tono: 选中节点从新目录中消失，停止核心但保持封锁");
    let _ = service::tono_stop_core(false).await;
    let _ = service::tono_restrict_bootstrap().await;

    let mut inner = state.lock().await;
    // Two IPCs ran with the lock released. If a disconnect / sign-out / quit took ownership in
    // that window, its FSM state is the truth and must not be overwritten here: the
    // `connect_failed()` below runs the failure decision table, and for an armed-but-unverified
    // session — exactly what a *failed* release leaves behind — it resolves to FullRelease and
    // calls `release()`, clearing `kill_switch_armed` and showing NotConnected over a barrier
    // that is still blocking. `quit_release` would then compute `protected == false` and skip
    // the release entirely. Leaving `stay_armed_after_failed_release`'s state alone is the same
    // "keep the real armed state visible" treatment.
    if inner.connect_generation != generation {
        logging!(
            info,
            Type::Service,
            "Tono: 目录消失清理已被更新的连接代际取代，保留其可见状态"
        );
        return;
    }
    inner.controller_secret = None;
    inner.controller_port = None;
    let vanished_node = inner.selected_node.clone();
    if inner.fsm.status().is_connected {
        inner.fsm.tunnel_died();
    } else {
        // `initial_release_failed`, not `connect_failed`: this teardown deliberately keeps
        // blocking (stop_core(false) + restrict_bootstrap), but for an attempt that armed and
        // has not yet been verified the decision table resolves `connect_failed` to a full
        // release, which clears the armed latch while the Service is still blocking. The UI
        // would then read notConnected over a live barrier, and Disconnect / Sign out / Quit
        // would each compute "nothing to release" and skip it — a silent total blackout that
        // survives app exit.
        inner.fsm.initial_release_failed();
    }
    commands::emit_status(&app, &commands::status_of(&inner));
    drop(inner);
    if let Some(node) = vanished_node {
        state.audit().log(AuditEvent::SelectionVanished { node });
    }
    state.audit().log(AuditEvent::ProtectedOffline {
        reason: "catalogSelectionVanished",
    });
}

/// Connected node switch: keep the core and WinTUN, widen WFP to old ∪ new,
/// move the Mihomo selector, prove the new exit, then drop leftover sockets
/// on the previous destination and shrink WFP to new-only.
///
/// `generation` is the connect generation the switch was spawned under; a
/// newer bump (another switch, disconnect, sign-out) retires it silently.
/// Put the selection back and tell the UI about it.
///
/// `tono_select_server` writes `selected_node` and emits before this task even
/// starts, so every branch below that gives up on the switch has to undo that
/// claim. Without it the node card, the tray, and the dashboard all showed the
/// exit the user picked while every byte still left through the old one — and
/// nothing ever corrected it, because the stored selection was the new name.
async fn restore_selected_node(
    state: &Arc<TonoState>,
    app: &AppHandle,
    generation: u64,
    previous_name: &str,
) {
    if previous_name.is_empty() {
        return;
    }
    let mut inner = state.lock().await;
    // A newer operation owns the state; it will publish its own selection.
    if inner.connect_generation != generation {
        return;
    }
    if inner.selected_node.as_deref() == Some(previous_name) {
        return;
    }
    inner.selected_node = Some(previous_name.to_string());
    let status = commands::status_of(&inner);
    drop(inner);
    commands::emit_status(app, &status);
}

pub async fn switch_selected_node(
    state: Arc<TonoState>,
    app: AppHandle,
    generation: u64,
    previous_name: String,
    next_name: String,
) {
    let snapshot = {
        let inner = state.lock().await;
        if inner.connect_generation != generation {
            return;
        }
        if !inner.fsm.status().is_connected {
            // A connect already in flight is dialling the previous exit, but
            // the caller has published the new name — the UI would show a node
            // the attempt is not using. When fully disconnected the new name is
            // simply the choice for the next connect, so leave it alone.
            let connecting = inner.fsm.status().is_connecting;
            drop(inner);
            if connecting {
                restore_selected_node(&state, &app, generation, &previous_name).await;
            }
            return;
        }
        let previous = inner
            .nodes
            .iter()
            .find(|node| node.name == previous_name)
            .cloned();
        let next = inner.nodes.iter().find(|node| node.name == next_name).cloned();
        let routing = inner.routing.clone();
        let nodes = inner.nodes.clone();
        let secret = inner.controller_secret.clone();
        let port = inner.controller_port;
        (previous, next, routing, nodes, secret, port)
    };
    let (previous, next, routing, nodes, secret, port) = snapshot;
    let Some(next) = next else {
        restore_selected_node(&state, &app, generation, &previous_name).await;
        return;
    };
    let old_endpoints = previous
        .as_ref()
        .map(|node| proxy_endpoints_for(node, &nodes, routing.as_ref()))
        .unwrap_or_default();
    let new_endpoints = proxy_endpoints_for(&next, &nodes, routing.as_ref());
    let union = unique_proxy_endpoints([&old_endpoints[..], &new_endpoints[..]].concat());
    if union.is_empty() {
        restore_selected_node(&state, &app, generation, &previous_name).await;
        return;
    }

    let session = match service::active_service_session() {
        Ok(session) => session,
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "Tono: hot switch missing Service session ({error:#}); falling back to cold switch"
            );
            cold_switch_selected_node(state, app, generation).await;
            return;
        }
    };
    if let Err(error) = service::tono_replace_proxy_endpoints(&session, union).await {
        logging!(
            warn,
            Type::Service,
            "Tono: hot switch could not widen WFP ({error:#}); falling back to cold switch"
        );
        cold_switch_selected_node(state, app, generation).await;
        return;
    }
    if state.lock().await.connect_generation != generation {
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        return;
    }

    let Some((secret, port)) = secret.zip(port) else {
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        cold_switch_selected_node(state, app, generation).await;
        return;
    };
    if let Err(error) = select_exit_group(&secret, port, &next_name).await {
        logging!(warn, Type::Service, "Tono: selector switch failed: {error}");
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        restore_selected_node(&state, &app, generation, &previous_name).await;
        return;
    }
    if state.lock().await.connect_generation != generation {
        let _ = select_exit_group(&secret, port, &previous_name).await;
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        return;
    }

    if let Err(error) = verify_tun_data_plane().await {
        logging!(
            warn,
            Type::Service,
            "Tono: new exit failed protected probe ({error}); rolling back"
        );
        if !previous_name.is_empty() {
            let _ = select_exit_group(&secret, port, &previous_name).await;
        }
        let rollback_ok = verify_tun_data_plane().await.is_ok();
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints.clone()).await;
        restore_selected_node(&state, &app, generation, &previous_name).await;
        if !rollback_ok {
            let mut inner = state.lock().await;
            if inner.connect_generation != generation {
                return;
            }
            inner.fsm.tunnel_died();
            commands::emit_status(&app, &commands::status_of(&inner));
            drop(inner);
            schedule_reconnect(&state, &app).await;
        }
        return;
    }

    close_connections_bound_to(&state, generation, &previous_name).await;
    if let Err(error) = service::tono_replace_proxy_endpoints(&session, new_endpoints).await {
        logging!(
            warn,
            Type::Service,
            "Tono: could not shrink WFP to the new exit ({error:#}); leaving old∪new permits"
        );
    }
    let inner = state.lock().await;
    if inner.connect_generation == generation {
        commands::emit_status(&app, &commands::status_of(&inner));
    }
}

async fn cold_switch_selected_node(state: Arc<TonoState>, app: AppHandle, generation: u64) {
    {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            return;
        }
        if !inner.fsm.status().is_connected && !inner.fsm.status().is_connecting {
            return;
        }
        inner.controller_secret = None;
        inner.controller_port = None;
        if inner.fsm.status().is_connected {
            inner.fsm.tunnel_died();
        } else {
            inner.fsm.initial_release_failed();
        }
        commands::emit_status(&app, &commands::status_of(&inner));
    }
    let _ = service::tono_stop_core(false).await;
    if state.lock().await.connect_generation != generation {
        return;
    }
    match attempt(&state, &app).await {
        Attempt::Failed(err) => {
            let _ = fail_connect(&state, &app, err).await;
            schedule_reconnect(&state, &app).await;
        }
        Attempt::GuardRejected(reason) if guard_rejection_is_transient(&reason) => {
            logging!(info, Type::Service, "Tono: 节点切换被暂态守卫拒绝，稍后重试: {reason}");
            schedule_reconnect(&state, &app).await;
        }
        Attempt::Connected => seed_autostart_after_connect(),
        Attempt::GuardRejected(_) | Attempt::Stale => {}
    }
}

/// Poll the Service network-event feed while Connected. Any counter change
/// (adapter change, sleep/wake) or core identity change (crash / TUN
/// rebuild, M4) invalidates Connected and reruns the full transaction
/// behind the still-armed barrier (§6).
async fn spawn_network_monitor(state: &Arc<TonoState>, app: &AppHandle) {
    let task_state = state.clone();
    let task_app = app.clone();
    // Boxed trait object: the monitor loop re-enters `attempt`, so embedding
    // its opaque type here would make the async types infinitely recursive.
    let handle = AsyncHandler::spawn(move || Box::pin(network_monitor_loop(task_state, task_app)) as BoxedTask);
    let mut inner = state.lock().await;
    inner.tasks.abort_network_monitor();
    inner.tasks.network_monitor = Some(handle);
}

async fn spawn_direct_lease_heartbeat(state: &Arc<TonoState>, generation: u64, heartbeat: DirectLeaseHeartbeat) {
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

async fn direct_lease_heartbeat_loop(state: Arc<TonoState>, generation: u64, heartbeat: DirectLeaseHeartbeat) {
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

/// F2 leg 2: periodically repeat the same authoritative multi-origin real App request used at
/// Connect. The controller delay API is deliberately excluded: under `unified-delay` it is a
/// doubled measurement and persistent 504s on distant Reality exits do not prove user traffic is
/// dead. A single public origin is likewise insufficient: every independent TLS target must fail
/// before this leg reports failure.
async fn periodic_data_plane_probe_failed(state: &Arc<TonoState>) -> bool {
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
async fn in_place_hold_still_proven(
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

async fn network_monitor_loop(state: Arc<TonoState>, app: AppHandle) {
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
    // The last recovered-in-place verdict, so a leg that stays failed while the tunnel keeps
    // working re-proves the data plane at the exit-probe cadence rather than every two ticks.
    let mut last_in_place_recovery: Option<std::time::Instant> = None;
    loop {
        interval.tick().await;
        {
            let inner = state.lock().await;
            if !inner.fsm.status().is_connected {
                return;
            }
        }
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
        legs.observe_kill_switch(kill_switch_unhealthy(snapshot.kill_switch.as_ref()));

        // DNS health is checked independently of netmon. The first network event is used only
        // to seed the counter (to ignore our own connect-time interface churn), so an adapter
        // arriving in that narrow window would otherwise remain external-DNS until another event.
        let protected_dns = service::tono_protected_dns_status().await.ok();
        legs.observe_protected_dns(protected_dns_unhealthy(protected_dns.as_ref()));

        // F2 leg 2: periodic real App data-plane probe through the tunnel.
        if last_probe.elapsed() >= EXIT_PROBE_INTERVAL {
            last_probe = std::time::Instant::now();
            legs.observe_probe(periodic_data_plane_probe_failed(&state).await);
        }
        let health_invalid = legs.invalid();
        let protection_invalid = legs.protection_invalid();

        let (invalidate, network_changed, core_changed, kill_switch_snapshot, service_events) = {
            let mut inner = state.lock().await;

            // L3: surface kill switch changes as they are observed.
            let kill_switch_changed = snapshot.kill_switch.is_some() && inner.kill_switch != snapshot.kill_switch;
            if let Some(kill_switch) = &snapshot.kill_switch {
                inner.kill_switch = Some(kill_switch.clone());
            }

            // The first sample seeds every leg without firing (unchanged
            // first-seed semantics); afterwards the legs compare whole
            // Options so a seeded-None → Some transition is caught too (L-1).
            let first_sample = inner.network_events_counter.is_none();
            let counter = snapshot.network_events.counter;
            let network_changed = !first_sample && inner.network_events_counter != Some(counter);
            inner.network_events_counter = Some(counter);

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
            let core_changed = !first_sample && core_change_fires(sample, missing_core_samples);
            if sample != CoreSample::Missing || core_changed {
                inner.last_core_pid = snapshot.core_pid;
                inner.last_restart_count = Some(snapshot.restart_count);
            }

            // P0-13: merge event bursts — only the first change inside the
            // debounce window invalidates Connected.
            let invalidated = network_event_fires(
                network_changed || core_changed,
                inner.last_network_event_at.map(|at| at.elapsed()),
            );
            if invalidated {
                inner.last_network_event_at = Some(std::time::Instant::now());
            }

            let snapshot_for_emit = kill_switch_changed.then(|| commands::status_of(&inner));
            let mut events: Vec<AuditEvent> = Vec::new();
            if kill_switch_changed && let Some(kill_switch) = &snapshot.kill_switch {
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
            (invalidated, network_changed, core_changed, snapshot_for_emit, events)
        };
        for event in service_events {
            state.audit().log(event);
        }
        if let Some(status) = kill_switch_snapshot {
            commands::emit_status(&app, &status);
        }

        // IP Helper delivers Tono's own WinTUN/route and DNS-reconciliation callbacks
        // asynchronously. A callback can therefore land after the Service write window and
        // after this monitor seeded its counter, producing the old connectOk -> networkChange ->
        // reconnect loop. Do not trust the event either way: under the still-locked barrier,
        // repeat the same multi-origin HTTPS proof that admitted Connected. Success proves the
        // current tunnel still carries user traffic; failure corroborates the event and keeps the
        // existing fail-closed reconnect. Core identity and health failures remain unconditional.
        let event_probe_failed = if invalidate && network_changed && !core_changed && !health_invalid {
            let recently_proven = last_event_probe_ok
                .is_some_and(|at| at.elapsed() < NETWORK_EVENT_PROBE_COOLDOWN);
            if recently_proven {
                logging!(
                    info,
                    Type::Service,
                    "Tono: another Windows network change inside the proof window; reusing the last data-plane proof instead of probing again"
                );
                false
            } else {
                let failed = periodic_data_plane_probe_failed(&state).await;
                last_event_probe_ok = if failed {
                    None
                } else {
                    Some(std::time::Instant::now())
                };
                failed
            }
        } else {
            false
        };
        if invalidate && network_changed && !core_changed && !health_invalid && !event_probe_failed {
            logging!(
                info,
                Type::Service,
                "Tono: Windows reported a network change, but the locked TUN data plane remains healthy; keeping Connected"
            );
            legs.observe_probe(false);
            let generation = state.lock().await.connect_generation;
            let _ = refresh_control_plane_pins_once(&state, generation).await;
        }
        if monitor_requires_reconnect(invalidate, core_changed, health_invalid, event_probe_failed) {
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

async fn handle_network_change_inner(
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
    let generation = {
        let mut inner = state.lock().await;
        // `is_disconnecting` is redundant now that `begin_disconnect` clears
        // `is_connected`, and it is written out anyway: this guard is the one
        // that has to say "not while a release is in flight" out loud, because
        // the generation captured below is the disconnect's own once one has
        // started, and the exit guard then compares a value to itself.
        let status = inner.fsm.status();
        if !status.is_connected || status.is_disconnecting {
            return NetworkChangeOutcome::Handled;
        }
        inner.connect_generation
    };
    // Prefer an in-place proof while the core is still the same process.
    // Sleep/Wi-Fi flaps used to stop the core unconditionally, then burn the
    // first reconnect on "DNS 53 busy" because the just-killed listener was
    // the one we needed.
    if allow_in_place && verify_tun_data_plane().await.is_ok() {
        logging!(
            info,
            Type::Service,
            "Tono: network change recovered in place; core was not restarted"
        );
        return NetworkChangeOutcome::RecoveredInPlace;
    }
    {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation || inner.fsm.status().is_disconnecting {
            return NetworkChangeOutcome::Handled;
        }
        inner.fsm.tunnel_died();
        commands::emit_status(&app, &commands::status_of(&inner));
    }
    state.audit().log(AuditEvent::ProtectedOffline {
        reason: "networkChange",
    });
    let _ = service::tono_restrict_bootstrap().await;
    // Stop the core before re-attempting, like both sibling teardowns (`switch_selected_node`,
    // `selected_node_vanished`). `restrict_bootstrap` only rewrites WFP; it leaves mihomo
    // running, and mihomo owns loopback:53 for the whole session — the very port `run_stages`'
    // DNS preflight binds. Without this, every sleep/wake and Wi-Fi flap burned attempt #1 on a
    // guaranteed "DNS UDP 127.0.0.1:53 is unavailable", recorded a ConnectFail, bumped the retry
    // counter and showed a DNS error, and only then stopped the core on the way out.
    // `false` = keep blocking: the core goes down, the barrier stays armed.
    let _ = service::tono_stop_core(false).await;
    // Immediately before re-entering the transaction, and deliberately not earlier: a disconnect
    // bumps the generation as its very first act (`invalidate_connection(true)`, before any
    // IPC), so any release that will complete has already bumped by the time this reads. A moved
    // generation means someone else owns the machine — exit without touching the FSM, the core
    // or the UI, exactly like `StageFailure::Stale`.
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
    match attempt(state, app).await {
        Attempt::Failed(err) => {
            let _ = fail_connect(state, app, err).await;
            schedule_reconnect(state, app).await;
        }
        // A transient guard (a release still reconciling, a transition still finishing) is not a
        // verdict — without a reschedule the machine sits blocked with nothing left to retry.
        Attempt::GuardRejected(reason) if guard_rejection_is_transient(&reason) => {
            logging!(info, Type::Service, "Tono: 重连被暂态守卫拒绝，稍后重试: {reason}");
            schedule_reconnect(state, app).await;
        }
        Attempt::Connected => seed_autostart_after_connect(),
        Attempt::GuardRejected(_) | Attempt::Stale => {}
    }
    // Everything past the in-place proof stopped the core, so even a fresh `Attempt::Connected`
    // is a new session with its own monitor and tasks: no caller's loop survives it.
    NetworkChangeOutcome::Handled
}

/// §6.2 endpoint derivation: the selected node's public IPv4/port over TCP.
pub fn proxy_endpoint_of(node: &ValidatedNode) -> ProxyEndpoint {
    ProxyEndpoint {
        ip: node.server.to_string(),
        port: node.port,
        protocol: ProxyProtocol::Tcp,
    }
}

fn proxy_endpoints_for(
    node: &ValidatedNode,
    nodes: &[ValidatedNode],
    routing: Option<&tono_core::CatalogRouting>,
) -> Vec<ProxyEndpoint> {
    let home_socks5 = routing.and_then(|routing| routing.home_socks5.as_ref());
    let home_node = if home_socks5.is_some() {
        None
    } else {
        routing
            .and_then(|routing| routing.home_proxy.as_deref())
            .and_then(|name| nodes.iter().find(|entry| entry.name == name))
    };
    let mut endpoints = vec![proxy_endpoint_of(node)];
    if let Some(home) = home_node
        && (home.server != node.server || home.port != node.port)
    {
        endpoints.push(proxy_endpoint_of(home));
    }
    endpoints
}

pub fn unique_proxy_endpoints(endpoints: Vec<ProxyEndpoint>) -> Vec<ProxyEndpoint> {
    let mut unique = Vec::new();
    for endpoint in endpoints {
        if !unique.iter().any(|existing: &ProxyEndpoint| {
            existing.ip == endpoint.ip
                && existing.port == endpoint.port
                && existing.protocol == endpoint.protocol
        }) {
            unique.push(endpoint);
        }
    }
    unique
}

async fn select_exit_group(secret: &str, port: u16, name: &str) -> Result<(), String> {
    let client = controller_client(Duration::from_secs(3))?;
    let url = controller_url(port, &format!("/proxies/{EXIT_GROUP_NAME}"));
    let response = client
        .put(url)
        .bearer_auth(secret)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|error| format!("selector request failed: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("selector returned {}", response.status()))
    }
}

async fn close_connections_bound_to(state: &Arc<TonoState>, generation: u64, exit_name: &str) {
    if exit_name.is_empty() {
        return;
    }
    let (secret, port) = {
        let inner = state.lock().await;
        if inner.connect_generation != generation {
            return;
        }
        match inner.controller_secret.clone().zip(inner.controller_port) {
            Some(pair) => pair,
            None => return,
        }
    };
    let Ok(client) = controller_client(Duration::from_secs(2)) else {
        return;
    };
    let Ok(response) = client
        .get(controller_url(port, "/connections"))
        .bearer_auth(&secret)
        .send()
        .await
    else {
        return;
    };
    let Ok(payload) = response.json::<SampledConnections>().await else {
        return;
    };
    for connection in payload.connections {
        if !connection
            .chains
            .iter()
            .any(|hop| hop.eq_ignore_ascii_case(exit_name))
        {
            continue;
        }
        if connection.id.is_empty() {
            continue;
        }
        let Ok(mut url) = reqwest::Url::parse(&controller_url(port, "/connections")) else {
            continue;
        };
        if url.path_segments_mut().is_ok() {
            let _ = url.path_segments_mut().map(|mut segments| {
                segments.push(&connection.id);
            });
        }
        let _ = client
            .delete(url)
            .bearer_auth(&secret)
            .send()
            .await;
    }
}

async fn refresh_control_plane_pins_from_service(state: &TonoState) {
    bootstrap::hydrate_learned_pins_from_service().await;
    let inner = state.lock().await;
    if let Err(error) = inner.client.transport().refresh_control_plane_pins().await {
        logging!(
            warn,
            Type::Service,
            "Tono: failed to apply learned control-plane HTTP pins: {error:#}"
        );
    }
}

/// F1: merge the pinned bootstrap IPs with the live resolution of the API
/// host (best-effort — a failed lookup just yields the pins alone).
async fn bootstrap_hosts() -> Vec<String> {
    let dynamic: Vec<String> =
        match tokio::time::timeout(DNS_LOOKUP_TIMEOUT, tokio::net::lookup_host((bootstrap::API_HOST, 443))).await {
            Ok(Ok(addrs)) => addrs.map(|addr| addr.ip().to_string()).collect(),
            Ok(Err(_)) | Err(_) => Vec::new(),
        };
    bootstrap::merge_bootstrap_hosts(&dynamic)
}

/// Wire key for the kill switch mode in audit records.
fn kill_switch_mode_key(mode: KillSwitchStatusMode) -> &'static str {
    match mode {
        KillSwitchStatusMode::Bootstrap => "bootstrap",
        KillSwitchStatusMode::Locked => "locked",
        KillSwitchStatusMode::Blocked => "blocked",
    }
}

/// fake-ip range check (§5: 198.18.0.0/16).
pub fn is_fake_ip(addr: IpAddr) -> bool {
    match addr {
        IpAddr::V4(v4) => v4.octets()[0] == 198 && v4.octets()[1] == 18,
        IpAddr::V6(_) => false,
    }
}

async fn set_stage(
    state: &Arc<TonoState>,
    app: &AppHandle,
    stage: ConnectStage,
    generation: u64,
    armed: bool,
    started: std::time::Instant,
) -> Result<(), StageFailure> {
    let fresh = {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            false
        } else {
            if inner.fsm.status().is_connecting {
                inner.fsm.advance_stage(stage);
                // F3: complete the previous step with its wall time and
                // mark the new one current.
                let now = std::time::Instant::now();
                let elapsed = inner
                    .step_started_at
                    .map(|at| now.saturating_duration_since(at).as_millis() as u64)
                    .unwrap_or(0);
                crate::tono::steps::advance(&mut inner.connect_steps, stage, elapsed);
                inner.step_started_at = Some(now);
                commands::emit_status(app, &commands::status_of(&inner));
                state.audit().log(AuditEvent::Stage {
                    stage: commands::stage_key(stage),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                });
            }
            true
        }
    };
    if fresh {
        return Ok(());
    }
    // `armed` marks stage boundaries past a committed StartClash: a stale
    // exit there patches the late arm (H-1).
    if armed {
        Err(stale_after_arm(state, generation).await)
    } else {
        Err(StageFailure::Stale)
    }
}

/// The controller HTTP client. C2: the total timeout is per call site, because one of them (the
/// exit probe) hands the *core* a budget of its own and must always outlast it — a client that
/// times out first throws away mihomo's diagnosis and reports a transport error instead.
fn controller_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_millis(500))
        .timeout(timeout)
        .build()
        .map_err(|err| err.to_string())
}

fn controller_url(port: u16, path: &str) -> String {
    format!("http://127.0.0.1:{port}{path}")
}

/// Activity close mutations are generation-bound and use the copied endpoint credentials. If a
/// recovery replaces the controller after this check, the request still targets the old loopback
/// port and can never close a connection on the new generation.
pub async fn close_owned_controller_connection(
    state: &Arc<TonoState>,
    expected_generation: u64,
    id: Option<&str>,
) -> Result<(), String> {
    let (secret, port) = {
        let inner = state.lock().await;
        if inner.controller_generation != expected_generation || !inner.fsm.status().is_connected {
            return Err("TONO_ACTIVITY_STALE: controller generation changed".to_string());
        }
        inner
            .controller_secret
            .clone()
            .zip(inner.controller_port)
            .ok_or_else(|| "TONO_ACTIVITY_UNAVAILABLE: controller is not available".to_string())?
    };

    let client = controller_client(Duration::from_secs(2))?;
    let mut url = reqwest::Url::parse(&controller_url(port, "/connections"))
        .map_err(|error| format!("TONO_ACTIVITY_UNAVAILABLE: invalid controller URL: {error}"))?;
    if let Some(id) = id {
        url.path_segments_mut()
            .map_err(|_| "TONO_ACTIVITY_UNAVAILABLE: invalid controller URL".to_string())?
            .push(id);
    }
    let response = client
        .delete(url)
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|error| format!("TONO_ACTIVITY_UNAVAILABLE: close request failed: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "TONO_ACTIVITY_UNAVAILABLE: controller returned {}",
            response.status()
        ))
    }
}

fn configure_owned_controller_for_ui(
    state: &Arc<TonoState>,
    app: &AppHandle,
    secret: &str,
    controller_port: u16,
) {
    let mihomo = app.mihomo();
    mihomo.update_external_host(Some("127.0.0.1"));
    mihomo.update_external_port(Some(controller_port));
    mihomo.update_secret(Some(secret));
    if let Err(error) = mihomo.update_protocol(Protocol::Http) {
        // Telemetry must never turn a fully verified tunnel into a failed connection. Keep the
        // product online and make the missing dashboard data diagnosable instead.
        logging!(
            warn,
            Type::Frontend,
            "Tono: failed to configure dashboard traffic telemetry: {error:#}"
        );
        // The app log this warning lands in is not the file that uploads, so this failure
        // used to be invisible to support. Put it where it can be read remotely.
        state.audit().log(AuditEvent::TelemetryConfigFail {
            error: format!("{error:#}"),
        });
    }
}

/// Pick two distinct unused loopback ports for this connection generation. Both binds stay live
/// until both port numbers have been observed, so the OS cannot hand the same ephemeral port to
/// the controller and the diagnostic proxy. They are intentionally released before Mihomo starts;
/// another process can theoretically win that narrow race, but Mihomo then fails immediately and
/// the absolute connection deadline handles it. Keeping either listener open would prevent the
/// child from binding on Windows.
async fn allocate_runtime_ports() -> Result<RuntimePorts, String> {
    let controller = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| format!("cannot allocate loopback controller port: {error}"))?;
    let mixed = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| format!("cannot allocate loopback diagnostic proxy port: {error}"))?;
    let controller_port = controller
        .local_addr()
        .map_err(|error| format!("cannot inspect loopback controller port: {error}"))?
        .port();
    let mixed_port = mixed
        .local_addr()
        .map_err(|error| format!("cannot inspect loopback diagnostic proxy port: {error}"))?
        .port();
    drop((controller, mixed));
    if controller_port == 0 || mixed_port == 0 || controller_port == mixed_port {
        return Err("operating system returned an invalid runtime listener plan".to_string());
    }
    Ok(RuntimePorts {
        mixed_port,
        controller_port,
    })
}

/// Protected DNS requires Mihomo to own both TCP and UDP loopback:53. Fail before WFP is installed
/// when another resolver already owns either socket, avoiding a 45-second protected-offline mystery.
fn dns_listener_conflict_message(tcp_error: Option<&str>, udp_error: Option<&str>) -> String {
    let mut failures = Vec::with_capacity(2);
    if let Some(error) = tcp_error {
        failures.push(format!("TCP: {error}"));
    }
    if let Some(error) = udp_error {
        failures.push(format!("UDP: {error}"));
    }
    let detail = if failures.is_empty() {
        "socket ownership could not be proven".to_owned()
    } else {
        failures.join("; ")
    };
    format!(
        "DNS port 127.0.0.1:53 is unavailable ({detail}). Another DNS or proxy process is using it; close that process and retry"
    )
}

#[cfg(windows)]
async fn preflight_dns_listener() -> Result<(), String> {
    // A just-replaced core can hold 127.0.0.1:53 for a few hundred milliseconds
    // while its process exits (unclean app restart, stop-and-replace start), so
    // a one-shot bind test reports os error 10048 against a socket that is about
    // to be free. Wait it out briefly — still bounded so a genuinely squatted
    // port (another TUN proxy) fails fast with the same message.
    const ATTEMPTS: usize = 30;
    const INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);
    let mut last_error = dns_listener_conflict_message(None, None);
    for attempt in 0..ATTEMPTS {
        let tcp = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 53)).await;
        let udp = tokio::net::UdpSocket::bind((std::net::Ipv4Addr::LOCALHOST, 53)).await;
        match (tcp, udp) {
            (Ok(tcp), Ok(udp)) => {
                drop((tcp, udp));
                return Ok(());
            }
            (tcp, udp) => {
                let tcp_error = tcp.err().map(|error| error.to_string());
                let udp_error = udp.err().map(|error| error.to_string());
                last_error = dns_listener_conflict_message(
                    tcp_error.as_deref(),
                    udp_error.as_deref(),
                );
                if attempt + 1 < ATTEMPTS {
                    tokio::time::sleep(INTERVAL).await;
                }
            }
        }
    }
    Err(last_error)
}

#[cfg(not(windows))]
async fn preflight_dns_listener() -> Result<(), String> {
    Ok(())
}

/// §6.4: poll the mihomo controller `/version` for at most 15 seconds. Each localhost request is
/// independently bounded as well, so a half-open socket cannot multiply the whole-stage budget.
async fn wait_controller(secret: &str, controller_port: u16) -> Result<(), String> {
    let client = controller_client(CONTROLLER_HTTP_TIMEOUT)?;
    let url = controller_url(controller_port, "/version");
    let mut last = String::from("no response");
    let deadline = tokio::time::Instant::now() + CONTROLLER_READY_TIMEOUT;
    for attempt in 0..VERSION_POLL_ATTEMPTS {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(
            remaining.min(CONTROLLER_POLL_TIMEOUT),
            client.get(&url).bearer_auth(secret).send(),
        )
        .await
        {
            Ok(Ok(response)) if response.status().is_success() => return Ok(()),
            Ok(Ok(response)) => last = format!("controller answered {}", response.status()),
            Ok(Err(err)) => last = err.to_string(),
            Err(_) => last = format!("controller poll exceeded {CONTROLLER_POLL_TIMEOUT:?}"),
        }
        if attempt + 1 == VERSION_POLL_ATTEMPTS {
            break;
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let interval = if attempt < VERSION_POLL_FAST_ATTEMPTS {
            VERSION_POLL_FAST_INTERVAL
        } else {
            VERSION_POLL_INTERVAL
        };
        tokio::time::sleep(remaining.min(interval)).await;
    }
    Err(format!("mihomo controller not ready: {last}"))
}

/// §6.5+§6.6: lock, retrying only while the TUN adapter comes up (≤ 50 × 200 ms between
/// retryable failures). Permanent lock errors fail immediately so a bad owner/WFP state does
/// not burn the connect transaction budget on 50 full lifecycle IPCs.
async fn lock_kill_switch_with_retries(session: &OwnerSessionProof) -> Result<(), String> {
    let mut last = String::from("no response");
    for attempt in 0..LOCK_ATTEMPTS {
        match service::tono_lock_kill_switch_for_session(session).await {
            Ok(()) => return Ok(()),
            Err(err) => {
                last = err.to_string();
                if !is_retryable_lock_error(&last) {
                    return Err(format!("kill switch lock failed: {last}"));
                }
                if attempt + 1 == LOCK_ATTEMPTS {
                    break;
                }
                tokio::time::sleep(LOCK_RETRY_INTERVAL).await;
            }
        }
    }
    Err(format!("kill switch lock failed (TUN adapter not ready?): {last}"))
}

/// §6.7: an ordinary system lookup must return a fake-ip address. On Windows, use the DNS Client
/// API directly with cache bypass and true cancellation; this keeps all three propagation retries
/// useful instead of accumulating uncancellable `getaddrinfo` work.
async fn verify_fake_ip() -> Result<(), String> {
    let mut last = String::from("no answer");
    for attempt in 0..VERIFY_ATTEMPTS {
        let lookup_timeout = fake_ip_attempt_timeout(attempt);
        #[cfg(windows)]
        let lookup = crate::tono::windows_dns::query_a(FAKE_IP_LOOKUP_HOST, lookup_timeout)
            .await
            .map(|addrs| addrs.into_iter().map(IpAddr::V4).collect::<Vec<_>>());
        #[cfg(not(windows))]
        let lookup = tokio::time::timeout(
            lookup_timeout,
            tokio::net::lookup_host((FAKE_IP_LOOKUP_HOST, 443)),
        )
        .await
        .map_err(|_| format!("system DNS lookup exceeded {lookup_timeout:?}"))
        .and_then(|result| {
            result
                .map(|addrs| addrs.map(|addr| addr.ip()).collect::<Vec<_>>())
                .map_err(|e| e.to_string())
        });

        match lookup {
            Ok(addrs) => {
                if addrs.iter().copied().any(is_fake_ip) {
                    return Ok(());
                }
                last = format!("no fake-ip in {addrs:?}");
            }
            Err(err) => last = err,
        }
        if attempt + 1 < VERIFY_ATTEMPTS {
            tokio::time::sleep(VERIFY_RETRY_INTERVAL).await;
        }
    }
    Err(fake_ip_verification_error(&last))
}

fn fake_ip_verification_error(last: &str) -> String {
    if last.contains("no fake-ip in") {
        format!(
            "fake-ip verification failed: {last}. Windows Encrypted DNS (DNS over HTTPS) may still be overriding 127.0.0.1. Turn Encrypted DNS off in Settings → Network & internet → Ethernet/Wi-Fi → DNS, then reconnect."
        )
    } else {
        format!("fake-ip verification failed: {last}")
    }
}

fn connect_failure_is_dead_exit(error: &str) -> bool {
    error.contains(NODE_OR_CORE_UNREACHABLE_PREFIX)
        || error.contains(tono_core::ProtectedFailureCode::CoreExitUnreachable.as_str())
}

fn fake_ip_attempt_timeout(attempt: u32) -> Duration {
    if attempt == 0 {
        Duration::from_secs(2)
    } else {
        FAKE_IP_LOOKUP_TIMEOUT
    }
}

/// One exit probe: `GET /proxies/Tono-Exit/delay` against the generate_204 target with an
/// [`EXIT_PROBE_CORE_TIMEOUT_MS`] core-side budget; a positive delay proves egress. The client
/// budget ([`EXIT_PROBE_CLIENT_TIMEOUT`]) is strictly larger, so the verdict — including a
/// mihomo-reported failure — always comes from the core (C2).
///
/// Mihomo `unified-delay` already discards the cold handshake inside this one
/// call. A second `/delay` here would add another cross-border round to connect
/// without changing the number the UI shows. Japan→gstatic through Reality
/// commonly lands 400–900ms; that is not a dead node.
async fn probe_exit_once(secret: &str, controller_port: u16) -> Result<u64, String> {
    let client = controller_client(EXIT_PROBE_CLIENT_TIMEOUT)?;
    let mut url = reqwest::Url::parse(&controller_url(
        controller_port,
        &format!("/proxies/{EXIT_GROUP_NAME}/delay"),
    ))
    .map_err(|err| err.to_string())?;
    url.query_pairs_mut()
        .append_pair("url", EXIT_PROBE_URL)
        .append_pair("timeout", &EXIT_PROBE_CORE_TIMEOUT_MS.to_string());

    crate::tono::integration_profile::delay_remote_operation().await;
    match client.get(url).bearer_auth(secret).send().await {
        Ok(response) if response.status().is_success() => match response.json::<serde_json::Value>().await {
            Ok(value) => {
                let delay = value.get("delay").and_then(serde_json::Value::as_u64).unwrap_or(0);
                if delay > 0 {
                    Ok(delay)
                } else {
                    Err("exit delay was 0".to_string())
                }
            }
            Err(err) => Err(err.to_string()),
        },
        Ok(response) => Err(format!("delay probe answered {}", response.status())),
        Err(err) => Err(err.to_string()),
    }
}

/// Run one real, bounded egress measurement for the currently connected server. The authenticated
/// in-memory controller endpoint is never exposed to the WebView; only the measured milliseconds
/// cross the Tauri command boundary.
pub async fn test_current_server(state: &Arc<TonoState>, app: &AppHandle) -> Result<u64, String> {
    let (secret, controller_port) = {
        let inner = state.lock().await;
        if !inner.fsm.status().is_connected {
            return Err("connect before testing the current server".to_string());
        }
        inner
            .controller_secret
            .clone()
            .zip(inner.controller_port)
            .ok_or_else(|| "connected controller endpoint is unavailable".to_string())?
    };
    let delay = probe_exit_once(&secret, controller_port)
        .await
        .map_err(|error| format!("current server test failed: {error}"))?;
    {
        let mut inner = state.lock().await;
        inner.record_exit_delay(delay);
        crate::tono::commands::emit_status(app, &crate::tono::commands::status_of(&inner));
    }
    Ok(delay)
}

/// V1/H1 — the retry window `verify_locked` spends before it calls a tunnel unverified. Must
/// exceed the Service-side liveness cache TTL, or the verdict is one sample of a decaying value.
pub fn verify_lock_retry_window() -> Duration {
    VERIFY_LOCK_RETRY_INTERVAL * (VERIFY_LOCK_ATTEMPTS.saturating_sub(1))
}

/// §6.9: the kill switch must be wanted, verified live, and fully locked.
///
/// V1/H1: bounded retry, never a single shot. `live` is not a live query on Windows — it is a
/// ~1.5 s-decaying cache refreshed by a 1 s loop — so a slow-but-successful verify reads
/// `live: false`. Retrying only re-*reads*: nothing but a `wanted && live && Locked` answer
/// passes, so the fail-closed verdict is unchanged, it is merely no longer decided by one sample.
async fn verify_locked() -> Result<KillSwitchStatus, String> {
    let mut last = String::from("no answer");
    for attempt in 0..VERIFY_LOCK_ATTEMPTS {
        match service::tono_kill_switch_status().await {
            Ok(status) => {
                if status.wanted && status.live && status.mode == KillSwitchStatusMode::Locked {
                    return Ok(status);
                }
                last = format!(
                    "kill switch not locked (wanted={}, live={}, mode={:?})",
                    status.wanted, status.live, status.mode
                );
            }
            Err(err) => last = err.to_string(),
        }
        if attempt + 1 < VERIFY_LOCK_ATTEMPTS {
            tokio::time::sleep(VERIFY_LOCK_RETRY_INTERVAL).await;
        }
    }
    Err(format!(
        "{last} (after {VERIFY_LOCK_ATTEMPTS} samples over {:?})",
        verify_lock_retry_window()
    ))
}

/// The authoritative connection verdict: an ordinary fresh App flow must traverse the protected
/// Windows data plane. With WFP locked, a physical-interface fallback is blocked and only the
/// recorded WinTUN LUID is permitted, so a valid HTTPS 204 is positive evidence of tunnel traffic.
async fn verify_locked_data_plane() -> Result<KillSwitchStatus, String> {
    let status = verify_locked().await?;
    verify_tun_data_plane().await?;
    Ok(status)
}

async fn verify_tun_data_plane() -> Result<(), String> {
    crate::tono::integration_profile::delay_remote_operation().await;
    crate::tono::protected_probe::verify_protected_origins(
        TUN_DATA_PLANE_CONNECT_TIMEOUT,
        TUN_DATA_PLANE_TIMEOUT,
        TUN_PROBE_STAGGER,
    )
    .await
    .map(|_| ())
    .map_err(|failures| crate::tono::protected_probe::format_failures(&failures))
}

/// Diagnostic-only App ingress through Mihomo's ephemeral loopback mixed listener. This bypasses
/// WinTUN but still uses the exact owned runtime, selected exit group, staged core, WFP endpoint
/// permit, and remote node. A success therefore isolates a Windows TUN/route failure; it is never
/// returned as a successful connection verdict.
async fn verify_mixed_proxy_data_plane(mixed_port: u16) -> Result<(), String> {
    let proxy_url = format!("http://127.0.0.1:{mixed_port}");
    let proxy = reqwest::Proxy::all(&proxy_url)
        .map_err(|error| format!("cannot configure loopback diagnostic proxy: {error}"))?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(TUN_DATA_PLANE_CONNECT_TIMEOUT)
        .timeout(TUN_DATA_PLANE_TIMEOUT)
        .build()
        .map_err(|error| format!("cannot create loopback diagnostic proxy probe: {error}"))?;
    crate::tono::integration_profile::delay_remote_operation().await;

    race_data_plane_probes(&client).await.map_err(|failures| {
        format!(
            "all {} independent loopback-proxy probes failed: {}",
            TUN_DATA_PLANE_PROBES.len(),
            failures.join(" | ")
        )
    })
}

fn tun_probe_stagger(index: usize) -> Duration {
    TUN_PROBE_STAGGER * (index as u32)
}

async fn race_data_plane_probes(client: &reqwest::Client) -> Result<(), Vec<String>> {
    let mut in_flight = FuturesUnordered::new();
    for (index, probe) in TUN_DATA_PLANE_PROBES.into_iter().enumerate() {
        let client = client.clone();
        in_flight.push(async move {
            let delay = tun_probe_stagger(index);
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
            probe_tun_endpoint(&client, probe).await
        });
    }

    let mut failures = Vec::with_capacity(TUN_DATA_PLANE_PROBES.len());
    while let Some(result) = in_flight.next().await {
        match result {
            Ok(()) => return Ok(()),
            Err(error) => failures.push(error),
        }
    }
    Err(failures)
}

async fn probe_tun_endpoint(client: &reqwest::Client, probe: TunDataPlaneProbe) -> Result<(), String> {
    let response = client
        .get(probe.url)
        .send()
        .await
        .map_err(|error| format!("{} ({}): {}", probe.label, probe.url, describe_reqwest_error(&error)))?;
    let actual = response.status().as_u16();
    if actual == probe.expected_status {
        Ok(())
    } else {
        Err(format!(
            "{} ({}) answered {}, expected {}",
            probe.label, probe.url, actual, probe.expected_status
        ))
    }
}

fn describe_reqwest_error(error: &reqwest::Error) -> String {
    let category = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else {
        "request"
    };
    let mut parts = vec![format!("{category}: {error}")];
    let mut source = error.source();
    while let Some(cause) = source {
        let detail = cause.to_string();
        if !detail.is_empty() && parts.last().is_none_or(|last| last != &detail) {
            parts.push(detail);
        }
        if parts.len() == 5 {
            break;
        }
        source = cause.source();
    }
    let joined = parts.join(" -> ");
    controller_error_detail(&joined).unwrap_or_else(|| category.to_string())
}

fn format_tun_probe_failures(failures: &[String]) -> String {
    format!(
        "all {} independent real TUN data-plane probes failed: {}",
        TUN_DATA_PLANE_PROBES.len(),
        failures.join(" | ")
    )
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
const WINDOWS_OPTIONAL_DIRECT_ENABLED: bool = true;
/// Maximum resolved addresses kept per policy domain (Mac parity).
const MAX_ADDRESSES_PER_DOMAIN: usize = 8;
/// A cloud policy can currently carry dozens of names. Launching all DoH
/// lookups at once overloaded otherwise healthy distant Reality exits on
/// real mainland-like links, so keep a small, deterministic in-flight cap.
const CLOUD_DNS_QUERY_CONCURRENCY: usize = 8;
/// One transient controller/DoH failure must not tear down a protected
/// connection. Permanent controller errors still fail immediately.
const CLOUD_DNS_QUERY_ATTEMPTS: u32 = 2;
const CLOUD_DNS_QUERY_RETRY_DELAY: Duration = Duration::from_millis(200);
/// Both WeChat and web-domain sets share this one deadline. The enclosing
/// connect transaction remains the final fail-closed ceiling.
const CLOUD_POLICY_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(20);

const DIRECT_CONFIG_RELOAD_ATTEMPTS: u32 = 2;
const DIRECT_CONFIG_RELOAD_RETRY_DELAY: Duration = Duration::from_millis(350);
const DIRECT_CONFIG_RELOAD_TIMEOUT: Duration = Duration::from_secs(60);
/// Must stay comfortably below the Service's 60-second committed lease. A dedicated task keeps
/// renewal independent of the health monitor's potentially slow public data-plane probes.
const DIRECT_LEASE_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone)]
struct CapturedTrafficPolicy {
    revision: i64,
    digest: String,
    document: tono_core::policy::TonoTrafficPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ServiceCoreIdentity {
    pid: u32,
    generation: u32,
}

/// Exact proof retained only for the Connected lifetime. The owner-session token is memory-only,
/// and this type deliberately has no `Debug` implementation.
#[derive(Clone)]
struct DirectLeaseHeartbeat {
    session: OwnerSessionProof,
    reload_id: u64,
    endpoint_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ControllerDirectRuleProof {
    proxy: String,
    payload: String,
}

/// Mihomo v1.19.29 `/rules` AND child type for `PROCESS-PATH-REGEX`.
///
/// The packaged sidecar's `/rules` payload uses `RuleType.String()`. The
/// captured PROCESS-NAME rows are `(ProcessName,…)`; this is the same table's
/// `ProcessPathRegex` entry, not a guessed alias.
const MIHOMO_PROCESS_PATH_REGEX_TYPE: &str = "ProcessPathRegex";

/// Exact v1.19.29 `/rules` serialization for the trusted `DirectPlan` handed to the runtime
/// builder. Mihomo preserves top-level rule order and one API row per AND rule; `no-resolve` is an
/// internal child option and intentionally does not appear in `Payload()`.
fn expected_controller_direct_rules(plan: &tono_core::config::DirectPlan) -> Vec<ControllerDirectRuleProof> {
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
    if !plan.tcp_wechat_rules.is_empty() {
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
    if !plan.tcp_wechat_rules.is_empty() && !plan.wechat_process_path_regexes.is_empty() {
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

struct PendingDirectCommit {
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
fn spawn_optional_direct_after_connected(
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

async fn apply_cloud_policy(
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
            skip_optional_direct_policy(state, reason).await;
            return Ok(None);
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
    {
        return Ok(None);
    }
    let expected_controller_rules = expected_controller_direct_rules(&plan);
    // Declared to the Service exactly when `runtime_value` emits process-scoped rules, and with
    // the same condition it uses. A pin existing is not the same as process routing existing:
    // `direct_endpoints` is the union of the WeChat, web and media pins and the Service cannot
    // tell them apart, so left to infer it would widen the boundary for a web-only or
    // media-only policy that routes nothing there.
    let reviewed_direct_ports = if plan.tcp_wechat_rules.is_empty()
        || plan.wechat_process_path_regexes.is_empty()
    {
        Vec::new()
    } else {
        plan.reviewed_direct_ports.clone()
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
        !plan.tcp_wechat_rules.is_empty() || !plan.udp_wechat_rules.is_empty(),
        // Suffix routes share the signed native-app WFP port permit; without
        // that permit they remain accepted policy but are intentionally
        // tunnelled.
        !plan.tcp_web_rules.is_empty()
            || (!plan.tcp_wechat_rules.is_empty()
                && !plan.wechat_process_path_regexes.is_empty()
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

async fn direct_context_is_current(
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

fn validate_direct_reload_result(
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

fn prove_service_reload_mode(
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

fn prove_service_endpoint_digest(status: &KillSwitchStatus, expected_digest: &str) -> Result<(), String> {
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

async fn controller_json(
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

async fn reload_controller_config(secret: &str, controller_port: u16, config_path: &str) -> Result<(), String> {
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

fn controller_direct_graph_is_active(
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

async fn verify_controller_direct_runtime(
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

async fn reconcile_direct_reload_failure(session: &OwnerSessionProof) -> Result<(), String> {
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
async fn activate_direct_runtime_cancellation_safe(
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
            // runs in verify_post_lock after protected DNS and again before finalizing DIRECT
            // endpoints. Until those checks pass, exact physical permits remain absent.
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

async fn commit_direct_policy_cancellation_safe(
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
enum OptionalDirectResolution<T> {
    Ready(T),
    Skip(String),
}

fn classify_optional_direct_resolution<T>(result: Result<T, String>) -> OptionalDirectResolution<T> {
    match result {
        Ok(value) => OptionalDirectResolution::Ready(value),
        Err(reason) => OptionalDirectResolution::Skip(reason),
    }
}

async fn skip_optional_direct_policy(state: &Arc<TonoState>, reason: String) {
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
async fn resolve_direct_domains(
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
struct ControllerDnsFailure {
    message: String,
    retryable: bool,
}

fn controller_dns_status_is_retryable(status: reqwest::StatusCode) -> bool {
    status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

async fn dns_query_a_with_retry(
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
async fn dns_query_a(
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
    // Product China suffixes whenever native-app DIRECT pins exist. Without
    // those pins the WFP port permit is not installed and a suffix rule hangs.
    if !wechat_tcp.is_empty() {
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

    let mut wechat_process_path_regexes: Vec<String> = wechat_process_path_regexes
        .into_iter()
        .filter(|pattern| pattern.starts_with('^') && config::is_rule_payload_safe(pattern))
        .collect();
    wechat_process_path_regexes.sort();
    wechat_process_path_regexes.dedup();
    wechat_process_path_regexes.truncate(config::MAX_WECHAT_PROCESS_PATH_REGEXES);

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

/// The physical interface carrying the default route. Windows uses
/// `GetBestRoute2` (runtime-unverified here; covered by the xwin check and
/// on-device smoke); other dev machines parse `route get default`.
async fn detect_physical_interface() -> Result<String, String> {
    #[cfg(windows)]
    {
        // GetBestRoute2/GetIfEntry2 are synchronous OS calls. Keep them off the Tauri async
        // workers so a slow IP helper stack cannot starve UI / status / release tasks.
        tokio::task::spawn_blocking(detect_physical_interface_windows)
            .await
            .map_err(|error| format!("physical interface discovery worker failed: {error}"))?
    }
    #[cfg(not(windows))]
    {
        detect_physical_interface_route_command().await
    }
}

/// macOS/Linux dev path: parse `interface: en0` out of `route get default`.
#[cfg(not(windows))]
async fn detect_physical_interface_route_command() -> Result<String, String> {
    let output = tokio::process::Command::new("route")
        .args(["get", "default"])
        .output()
        .await
        .map_err(|err| format!("route get default failed: {err}"))?;
    if !output.status.success() {
        return Err("route get default returned an error".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(interface) = line.trim().strip_prefix("interface:") {
            let interface = interface.trim();
            if !interface.is_empty() {
                return Ok(interface.to_string());
            }
        }
    }
    Err("no default route interface found".to_string())
}

/// Windows path: `GetBestRoute2` for a public destination, then `GetIfEntry2` for the interface
/// alias (`"Ethernet 2"`, `"以太网"`, etc.). This runs before WinTUN starts, so the best route
/// cannot resolve back to Tono. The Service deliberately resolves aliases to LUIDs as well; using
/// `ConvertInterfaceLuidToNameW` here would produce the adapter's internal name and recreate the
/// alias/name mismatch behind Windows error 123. VMware/VirtualBox/Hyper-V host adapters are
/// deliberately not acceptable physical uplinks: they remain enabled for the customer's VMs,
/// but Tono's optional DIRECT outbounds must bind to a real hardware interface.
#[cfg(windows)]
fn detect_physical_interface_windows() -> Result<String, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetBestRoute2, GetIfEntry2, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211,
        IF_TYPE_PROP_VIRTUAL, IF_TYPE_TUNNEL, MIB_IF_ROW2, MIB_IF_TYPE_LOOPBACK,
        MIB_IPFORWARD_ROW2,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, IN_ADDR, SOCKADDR_INET};

    // 8.8.8.8 — byte-symmetric, so the S_addr value needs no byte swapping.
    let mut destination = SOCKADDR_INET::default();
    destination.Ipv4.sin_family = AF_INET;
    destination.Ipv4.sin_addr = IN_ADDR {
        S_un: windows_sys::Win32::Networking::WinSock::IN_ADDR_0 { S_addr: 0x0808_0808 },
    };

    let mut best_route = MIB_IPFORWARD_ROW2::default();
    let mut best_source = SOCKADDR_INET::default();
    let status = unsafe {
        GetBestRoute2(
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
            &destination,
            0,
            &mut best_route,
            &mut best_source,
        )
    };
    if status != 0 {
        return Err(format!("GetBestRoute2 failed: {status}"));
    }

    let best_luid = unsafe { best_route.InterfaceLuid.Value };
    let mut candidates = vec![best_luid];
    for luid in default_route_interface_luids()? {
        if !candidates.contains(&luid) {
            candidates.push(luid);
        }
    }

    let mut rejected = Vec::new();
    for luid in candidates {
        let mut interface = MIB_IF_ROW2 {
            InterfaceLuid: windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH {
                Value: luid,
            },
            ..Default::default()
        };
        // SAFETY: `interface` is initialized and the LUID came from IP Helper.
        let status = unsafe { GetIfEntry2(&mut interface) };
        if status != 0 {
            rejected.push(format!("LUID {luid}: GetIfEntry2 failed ({status})"));
            continue;
        }
        let description = utf16_field(&interface.Description);
        let alias = utf16_field(&interface.Alias);
        if alias.is_empty() {
            rejected.push(format!("LUID {luid}: empty interface alias"));
            continue;
        }
        let hardware = interface.InterfaceAndOperStatusFlags._bitfield & 0x01 != 0;
        let known_hardware_type = matches!(interface.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211);
        let virtual_description = is_virtual_uplink_description(&description);
        let forbidden_type = matches!(
            interface.Type,
            MIB_IF_TYPE_LOOPBACK | IF_TYPE_PROP_VIRTUAL | IF_TYPE_TUNNEL
        );
        if virtual_description || forbidden_type || (!hardware && !known_hardware_type) {
            rejected.push(format!(
                "{alias:?} ({description:?}, type {}, hardware={hardware})",
                interface.Type
            ));
            continue;
        }
        return Ok(alias);
    }

    Err(format!(
        "no usable hardware uplink found; rejected candidates: {}",
        if rejected.is_empty() {
            "none".to_string()
        } else {
            rejected.join("; ")
        }
    ))
}

/// The route chosen by Windows can point at a host-only/NAT adapter even while a real
/// Ethernet/Wi-Fi default route is available. Return all IPv4 default-route interfaces in
/// metric order so the caller can reject virtual adapters without disabling them.
#[cfg(windows)]
fn default_route_interface_luids() -> Result<Vec<u64>, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIpForwardTable2, MIB_IPFORWARD_TABLE2,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET;

    let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    // SAFETY: IP Helper allocates the table and writes its address to `table`.
    let status = unsafe { GetIpForwardTable2(AF_INET, &mut table) };
    if status != 0 {
        return Err(format!("GetIpForwardTable2 failed: {status}"));
    }
    if table.is_null() {
        return Err("GetIpForwardTable2 returned a null table".to_string());
    }

    // SAFETY: a successful table contains `NumEntries` rows in the trailing `Table` array;
    // the allocation remains alive until FreeMibTable below.
    let rows = unsafe { std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize) };
    let mut routes: Vec<(u32, u64)> = rows
        .iter()
        .filter(|row| row.DestinationPrefix.PrefixLength == 0 && !row.Loopback)
        .map(|row| (row.Metric, unsafe { row.InterfaceLuid.Value }))
        .collect();
    // SAFETY: `table` was returned by GetIpForwardTable2 and is released exactly once.
    unsafe { FreeMibTable(table.cast()) };
    routes.sort_unstable_by_key(|(metric, _)| *metric);
    let mut luids = Vec::with_capacity(routes.len());
    for (_, luid) in routes {
        if !luids.contains(&luid) {
            luids.push(luid);
        }
    }
    Ok(luids)
}

#[cfg(windows)]
fn utf16_field(field: &[u16]) -> String {
    let end = field.iter().position(|ch| *ch == 0).unwrap_or(field.len());
    String::from_utf16_lossy(&field[..end])
}

/// Adapter descriptions are diagnostic input, not a security identity. This filter is only
/// used to choose a physical interface for optional DIRECT outbounds; it never disables or
/// removes the matching adapter. Tono's Wintun adapter is included so it cannot become the
/// physical DIRECT interface during a race with route installation.
fn is_virtual_uplink_description(description: &str) -> bool {
    const MARKERS: &[&str] = &[
        "vmware",
        "vmnet",
        "virtualbox",
        "vboxnet",
        "hyper-v",
        "hyperv",
        "vethernet",
        "wintun",
        "tono",
        "wsl",
        "docker",
        "loopback",
        "tap-windows",
    ];
    let lowered = description.to_lowercase();
    MARKERS.iter().any(|marker| lowered.contains(marker))
}

/// Open the redacted copy with the per-user DACL the rest of Tono's private files get.
///
/// It was the one file in the set written through plain `OpenOptions`, so it inherited whatever
/// the parent directory grants while `selection.json` and the owner token did not — and it is
/// the file that describes the selected node. A copy left by an earlier build fails the
/// private-file validation on its inherited ACL; replacing it once is how those converge.
#[cfg(windows)]
fn open_private_redacted_copy(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let open = || crate::core::owner_identity::open_or_create_private_current_user_file(path);
    let file = match open() {
        Ok(file) => file,
        Err(error) => {
            if !path.exists() {
                // Nothing to converge — the create itself failed, so report that.
                return Err(std::io::Error::other(error));
            }
            std::fs::remove_file(path)?;
            open().map_err(std::io::Error::other)?
        }
    };
    // The helper opens without truncating; this file is always rewritten whole.
    file.set_len(0)?;
    Ok(file)
}

/// Persist the redacted runtime copy (§5: the secret never touches disk).
///
/// Never fails the connect. The copy is a diagnostics convenience — the runtime the core
/// actually receives travels over IPC and never through this file — so refusing an otherwise
/// healthy connect because a support artefact could not be written trades availability for
/// nothing. Skipping is also the safe direction for §5: not writing cannot leak. It is loud in
/// the log instead, and the timeout is reported separately from a write error so a stalled
/// redirected AppData is diagnosable rather than looking like a permissions problem.
async fn write_redacted_copy(state: &Arc<TonoState>, redacted: &str) {
    let path = { state.lock().await.catalog_dir.join("owned-runtime.redacted.yaml") };
    let write = tokio::task::spawn_blocking({
        let redacted = redacted.to_string();
        move || -> std::io::Result<()> {
            #[cfg(windows)]
            let mut file = open_private_redacted_copy(&path)?;
            #[cfg(not(windows))]
            let mut file = {
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create(true).truncate(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt as _;
                    options.mode(0o600);
                }
                options.open(&path)?
            };
            use std::io::Write as _;
            file.write_all(redacted.as_bytes())
        }
    });
    // Abandoning the JoinHandle cannot stop the blocking thread — a thread parked inside a UNC
    // `open` stays parked until the redirector gives up. It commits nothing the connect depends
    // on, so leaving it behind is safe; what matters is that this future returns.
    match tokio::time::timeout(REDACTED_COPY_WRITE_TIMEOUT, write).await {
        Ok(Ok(Ok(()))) => {}
        // Previously dropped on the floor: only the JoinError was reported, so a failed write
        // was silent.
        Ok(Ok(Err(err))) => logging!(warn, Type::Service, "Tono: 写入 redacted 运行时副本失败: {err}"),
        Ok(Err(err)) => logging!(warn, Type::Service, "Tono: 写入 redacted 运行时副本失败: {err}"),
        Err(_elapsed) => logging!(
            warn,
            Type::Service,
            "Tono: 写入 redacted 运行时副本超时 ({REDACTED_COPY_WRITE_TIMEOUT:?})，跳过；连接继续"
        ),
    }
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
