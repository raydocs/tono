//! Cross-platform facade for the Windows WFP kill switch.
//!
//! Layering mirrors `macos_kill_switch.rs`: this module owns the state machine, the persisted
//! intent record (`kill-switch.json`, normally written atomically before widening WFP; the
//! DIRECT retraction narrows live WFP first), the
//! verify-after-write watchdog, startup recovery (corrupt or unhealthy state releases
//! general traffic unless the user explicitly enabled the strict kill switch), and the emergency
//! disarm. The rule set itself comes from the pure model (`wfp_model.rs`); the `Fwpm*` FFI is
//! confined to `wfp.rs` and compiled only on Windows, so everything here builds and is
//! unit-exercised on any host — off Windows every mutating entry point refuses with
//! "unsupported" and status reports a never-armed switch.

use crate::core::structure::{
    KillSwitchConfig, KillSwitchStatus, KillSwitchStatusMode, ProxyEndpoint,
};
use crate::core::wfp_model::{self, RuleConfig};
use anyhow::{Context as _, Result, bail};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Whether the live WFP engine is behind this build (real Windows service binary).
const ENGINE_LIVE: bool = cfg!(all(windows, not(feature = "test")));

/// Bumped after a successful explicit release. A StartClash that began before
/// this release must not leave the machine armed once the user has disconnected.
static RELEASE_EPOCH: AtomicU64 = AtomicU64::new(0);

/// Snapshot before waiting for the StartClash lifecycle lock.
pub(crate) fn release_epoch() -> u64 {
    RELEASE_EPOCH.load(Ordering::SeqCst)
}

/// True when an explicit release completed after `captured`.
pub(crate) fn release_superseded(captured: u64) -> bool {
    RELEASE_EPOCH.load(Ordering::SeqCst) != captured
}

fn note_explicit_release() {
    RELEASE_EPOCH.fetch_add(1, Ordering::SeqCst);
    note_attempt_superseded();
}

/// The `PrepareCoreStart` freshness epoch (what `GET /version` reports as `release_epoch`).
/// Bumped by every explicit release and by an admitted native update takeover: the App
/// invalidates its in-flight connect attempt before it sends `UpdateRequest::Prepare`, and from
/// then on the user can start a successor connection without a Disconnect. StartClash keeps
/// comparing `RELEASE_EPOCH` only — an update is not a Disconnect and must not make a late arm
/// retract.
static ATTEMPT_EPOCH: AtomicU64 = AtomicU64::new(0);

/// Snapshot copied by clients into `PrepareCoreStart` (via `GET /version`).
pub(crate) fn attempt_epoch() -> u64 {
    ATTEMPT_EPOCH.load(Ordering::SeqCst)
}

/// True when an explicit release or an update takeover happened after `captured`.
pub(crate) fn attempt_superseded(captured: u64) -> bool {
    ATTEMPT_EPOCH.load(Ordering::SeqCst) != captured
}

/// Supersede every connect attempt already in flight without touching protection.
pub(crate) fn note_attempt_superseded() {
    ATTEMPT_EPOCH.fetch_add(1, Ordering::SeqCst);
}

/// The fail-closed intent record in the service state directory. Written atomically before
/// any WFP mutation, exactly like the macOS helper's `macos-kill-switch.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct IntentRecord {
    wanted: bool,
    mode: KillSwitchStatusMode,
    /// `None` is a legacy record: Locked migrated as verified, earlier phases as stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    verified: Option<bool>,
    tunnel_interface: String,
    /// Staged core binary path the `ALE_APP_ID` permit is resolved from.
    app_path: String,
    endpoints: Vec<ProxyEndpoint>,
    /// Resolved, validated, public-only API host IPs (bounded by the model).
    api_host_ips: Vec<String>,
    updated_at: u64,
    /// Who armed the protection: the same SHA256(SID) key `authenticate_owner` derives. The
    /// machine-wide WFP policy may only be released/restricted by that owner — the pipe
    /// authenticates *a* local user, but the armed state belongs to the user who armed it.
    /// `None` for legacy/emergency-restored intents, which own no one and can be released by
    /// any authenticated owner (see `authorize_write_for`).
    #[serde(default)]
    owner_key: Option<String>,
    /// Explicit strict kill switch. Missing or false means a crash, hang, corrupt record,
    /// or an unproven restored wanted session releases general traffic. Only `true` keeps
    /// a block, and a bounded unhealthy streak still releases so that choice cannot brick
    /// the machine. Production never writes `true`. Absent on older records, which stay
    /// non-strict.
    #[serde(default)]
    strict_kill_switch: bool,
    /// Crash-window tombstone only. A user disconnect leaves this false so startup still
    /// consumes the record. The app treats `wanted: false` plus this flag as "reconnect".
    #[serde(default)]
    reconnect_after_release: bool,
    /// Durable secondary-layer disposition for an automatic release. `None` is a legacy
    /// record whose existing hold is left alone; this never authorizes a broad WFP block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    apply_narrow_after_release: Option<bool>,
}

impl IntentRecord {
    fn release_follow_up(&self) -> Option<bool> {
        self.apply_narrow_after_release
            .or_else(|| self.reconnect_after_release.then_some(true))
    }

    fn is_verified(&self) -> bool {
        self.verified
            .unwrap_or(self.mode == KillSwitchStatusMode::Locked)
    }
}

/// The core process instance a tunnel permit was granted for.
///
/// A pid is not an identity — Windows recycles them — so the manager's monotonic publication
/// generation rides along: every ordinary start and watchdog respawn changes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CoreInstance {
    pid: u32,
    generation: u32,
}

/// The core running right now, or `None` when none is. The manager publishes PID + generation in
/// one atomic word, so this never queues behind lifecycle work and never combines two instances.
async fn current_core_instance() -> Option<CoreInstance> {
    current_core_instance_for_direct_security()
}

/// A coherent, non-cached Core identity for DIRECT-permit decisions. A stop clears it before
/// teardown and a start publishes it only after commit; manager contention alone is therefore not
/// treated as process replacement.
fn current_core_instance_for_direct_security() -> Option<CoreInstance> {
    crate::core::manager::security_core_instance_snapshot().map(|instance| CoreInstance {
        pid: instance.pid,
        generation: instance.generation,
    })
}

/// Authoritative core identity for a WFP mutation. Kept async to avoid churn at its call sites;
/// the coherent atomic publication itself never waits for the manager.
async fn current_core_instance_authoritative() -> Option<CoreInstance> {
    current_core_instance_for_direct_security()
}

#[derive(Debug, Clone)]
struct Armed {
    intent: IntentRecord,
    tun_luid: Option<u64>,
    /// The core instance `tun_luid` was resolved for, recorded by `lock`. `None` means no
    /// tunnel permit may be rendered at all — see [`tunnel_permit_luid`].
    core_instance: Option<CoreInstance>,
    /// Cloud-approved DIRECT endpoints for this armed session. **omission = clear**: kept
    /// only in memory, never written to `kill-switch.json`, never restored on service start,
    /// never inherited by the next arm. The permits themselves are rendered only while
    /// `Locked` (rule G); keeping the approved set here across a mode change is what lets a
    /// re-lock re-render them without another round trip. Every restore path rebuilds with an
    /// empty set (fail-closed until the app's next connect transaction re-issues them).
    direct_endpoints: Vec<ProxyEndpoint>,
    /// Ports the App declared it emitted process-scoped DIRECT rules for, already intersected
    /// with `REVIEWED_DIRECT_PORTS`. Same lifetime as `direct_endpoints`: memory only, cleared
    /// on omission, never restored.
    reviewed_direct_ports: Vec<u16>,
    /// Volatile Service-owned reload bracket. Pending physical permits expire without relying on
    /// the GUI process to remain alive; committed permits keep only an idempotency receipt.
    direct_reload: Option<DirectReloadLease>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirectReloadPhase {
    Bracket,
    Pending,
    Committed,
    Retracting,
}

#[derive(Debug, Clone)]
struct DirectReloadLease {
    owner_generation: u64,
    reload_id: u64,
    phase: DirectReloadPhase,
    endpoint_digest: String,
    core_instance: Option<CoreInstance>,
    /// The exact TUN adapter identity proved when the physical endpoint set was installed.
    /// `None` is valid only for the pre-install Bracket phase.
    tunnel_luid: Option<u64>,
    expires_at: Option<std::time::Instant>,
}

/// The LUID the tunnel permit may name this tick, or `None` for the pre-lock policy (no tunnel
/// permit at all — exactly the fail-closed set `lock` replaces).
///
/// The tunnel permit is the widest rule the service ever installs: weight-8, matching only
/// `IP_LOCAL_INTERFACE == luid`, with no protocol, port, or app condition. It is safe only
/// because that LUID belongs to the Wintun adapter of the core this session locked. Nothing in
/// WFP notices when that adapter goes away: a `NET_LUID` is `{NetLuidIndex, IfType}` and
/// `NetLuidIndex` is *reused*, so once the core it was granted for is gone, the next device
/// handed that index would inherit an unconditional permit for everything it carries — and the
/// verify-after-write watchdog would faithfully keep reinstalling it. So the permit lives
/// exactly as long as that core instance: a watchdog respawn, an app-driven restart, or no core
/// at all all fall back to the pre-lock policy and block tunnel traffic until the app locks
/// again, which re-resolves the LUID against the live adapter.
fn tunnel_permit_luid(armed: &Armed, current_core: Option<CoreInstance>) -> Option<u64> {
    let luid = armed.tun_luid?;
    // Fail closed on every ambiguity: an unidentified grant (`None` recorded) never matches,
    // so it can never be revived by a later tick that also cannot identify a core.
    if armed.core_instance.is_some() && armed.core_instance == current_core {
        Some(luid)
    } else {
        None
    }
}

static ARMED: Lazy<Mutex<Option<Armed>>> = Lazy::new(|| Mutex::new(None));
static LAST_ERROR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
static WFP_OPERATION: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
#[cfg(test)]
static TEST_INSTALL_FAILURE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static TEST_AMBIGUOUS_INSTALL_FAILURE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static TEST_PERSIST_FAILURE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static TEST_INSTALL_ATTEMPTS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_PERSIST_ATTEMPTS: AtomicU64 = AtomicU64::new(0);
/// Test stand-in for the Windows logon-session lookup: true means the recorded owner has signed
/// out. Defaults to "still signed in", the answer that refuses a takeover.
#[cfg(test)]
static TEST_OWNER_SIGNED_OUT: AtomicBool = AtomicBool::new(false);
static NEXT_DIRECT_RELOAD_ID: AtomicU64 = AtomicU64::new(1);
/// Longer than the App's absolute connect transaction: while this bracket expires the physical
/// DIRECT set is empty, but a stale request must still be invalidated eventually.
const DIRECT_BRACKET_LEASE: std::time::Duration = std::time::Duration::from_secs(7 * 60);
/// Once physical permits exist, the App has only controller/WFP/data-plane read-back plus the
/// finalize IPC left. Expiry transitions the Service to exact Blocked without GUI cooperation.
const DIRECT_PENDING_LEASE: std::time::Duration = std::time::Duration::from_secs(90);
/// A committed physical escape set is not permanent Service state. The owning App must renew it
/// through its authenticated owner session; process death, a hung UI runtime, or session
/// retirement therefore retracts the set without relying on App cleanup.
const DIRECT_COMMITTED_LEASE: std::time::Duration = std::time::Duration::from_secs(60);
/// Startup recovery downgraded a `locked` intent to `blocked`; set so a successful core
/// restore can re-lock the tunnel instead of leaving the machine fail-closed until the GUI
/// returns (`relock_restored_tunnel`).
static RESTORE_WAS_LOCKED: AtomicBool = AtomicBool::new(false);
/// Startup recovery published a *verified* intent carried over from before this Service start,
/// and no WFP install or live verify has proved its filters in this process yet (TW-R-boot).
/// A failed startup install keeps that intent published while the machine is open, so
/// `verified` alone no longer proves a live barrier and the Remote Desktop exception
/// (`connect_session_refused`) must wait. The watchdog releases general traffic unless this
/// record explicitly enabled the strict kill switch. Cleared by the first successful install
/// or verify.
static RESTORED_BARRIER_UNPROVEN: AtomicBool = AtomicBool::new(false);
/// The watchdog's latest verify-by-key result. `/kill-switch/status` reuses it instead of
/// running a full WFP RPC sweep per request.
static LAST_VERIFY: Lazy<Mutex<Option<(std::time::Instant, bool)>>> =
    Lazy::new(|| Mutex::new(None));

/// The watchdog's sleep between verify-after-write ticks. Named so the staleness budget below
/// can be derived from it instead of restating it.
const WATCHDOG_PERIOD: std::time::Duration = std::time::Duration::from_secs(1);

/// How long a status read may trust the cached verify.
///
/// This is a *staleness* budget, not an optimism budget: a verify that actually fails writes
/// `note_verify(false)` and `live` goes false on the next read regardless of the TTL. What the
/// TTL decides is only whether "no fresh answer yet" reads as dead — and that has to allow for
/// how long a **successful** tick can legitimately take.
///
/// One refresh interval is `WATCHDOG_PERIOD` (1 s) plus the verify itself, which is one
/// `FwpmFilterGetByKey0` RPC to BFE per expected filter — 30-60 round trips. This module
/// already declares how slow that is allowed to get while still being a success:
/// `WFP_SLOW_CALL` (2 s) is "pathological but reportable", not "failed"; the failure budget is
/// `WFP_CALL_TIMEOUT` (25 s). At the old 1.5 s the cache expired *before* a merely slow tick
/// could refresh it, so a healthy machine reported `live: false` — which the app reads as
/// unhealthy — purely because BFE was busy.
///
/// So the floor is `WATCHDOG_PERIOD + WFP_SLOW_CALL` = 3 s, and the budget is that plus one
/// more period-and-slow-call of headroom for a tick that also had to queue behind another
/// writer on `WFP_OPERATION`: **5 s**. It stays far below `WFP_CALL_TIMEOUT`, so an engine that
/// is genuinely wedged — the case where no answer ever arrives — still reads dead within five
/// seconds, well inside the app's own reconnect budget.
const VERIFY_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(5);

/// Calibration knob. Needs real-hardware calibration.
///
/// Used only when Core is already running or this boot will start it. Thirty seconds
/// matches the macOS helper's idle release (three checks, ten seconds apart). A Core
/// that is neither running nor starting does not wait: the block is released immediately.
const WANTED_CORE_PROOF_WINDOW: std::time::Duration = std::time::Duration::from_secs(30);

/// A newly admitted Connect has a 310-second App deadline. Give it the same seven-minute
/// grace as a DIRECT bracket, then retire an attempt whose App never commits verification.
/// Unlike startup recovery, Core may not have been published yet when this window starts.
const FRESH_ARM_PROOF_WINDOW: std::time::Duration = std::time::Duration::from_secs(7 * 60);
static FRESH_ARM_PROOF_PENDING: AtomicBool = AtomicBool::new(false);
/// Committed DIRECT expiry must retire its Service-owned Core before opening general traffic.
/// A late Lock/MarkVerified from the expired session cannot cancel that retirement.
static DIRECT_EXPIRY_RETIREMENT_PENDING: AtomicBool = AtomicBool::new(false);
static FRESH_ARM_EPOCH: AtomicU64 = AtomicU64::new(0);

/// Bind a Core watchdog to the arm that admitted it. A successor arms before joining the
/// previous watchdog, so neither an owner key nor the absence of a Core fences old cleanup.
pub(crate) fn core_arm_epoch() -> u64 {
    FRESH_ARM_EPOCH.load(Ordering::Acquire)
}

/// Queue exhausted recovery for the independent WFP watchdog. The Core watchdog must finish
/// without taking owner lifecycle: a Start/Stop can hold it while joining that same task.
pub(crate) async fn note_core_recovery_exhausted(epoch: u64) {
    if !SUPPORTED {
        return;
    }
    let _operation = WFP_OPERATION.lock().await;
    if core_arm_epoch() != epoch || current_core_instance_for_direct_security().is_some() {
        return;
    }
    if !armed_guard().as_ref().is_some_and(|armed| {
        armed.intent.wanted && !armed.intent.strict_kill_switch && armed.intent.owner_key.is_some()
    }) {
        return;
    }
    // Reuse the epoch-fenced lifecycle cleanup, including desired-owner retirement, installer
    // and update admission, and the secondary AI hold. Failed cleanup remains retryable.
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
    FRESH_ARM_PROOF_PENDING.store(true, Ordering::Release);
}

/// This boot's desired state will start Core, and that start has not settled yet.
/// The watchdog treats it as "starting" so a same-boot replay is not released before
/// `start_core` runs. Cleared when desired-state restore finishes.
static CORE_REPLAY_EXPECTED: AtomicBool = AtomicBool::new(false);

/// Tests pretend a Core start is in flight without a process.
#[cfg(test)]
static TEST_CORE_STARTING: AtomicBool = AtomicBool::new(false);

/// Expiry of the core-proof window for the verified wanted intent restored by this process.
/// `None` means the window is not running (strict opt-in, unverified recovery, a proven
/// tunnel, or an explicit release).
static WANTED_CORE_DEADLINE: Lazy<Mutex<Option<std::time::Instant>>> = Lazy::new(|| Mutex::new(None));

/// In-memory copy of a crash-window tombstone's reconnect flag. Status reports it after
/// `ARMED` is cleared; the on-disk tombstone restores it across a Service restart.
static RECONNECT_AFTER_RELEASE: AtomicBool = AtomicBool::new(false);

/// WFP is already gone but the crash-window tombstone write failed. The watchdog retries
/// the write without reinstalling the block.
static CRASH_TOMBSTONE_PENDING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WantedCoreWindow {
    /// Strict opt-in, or still inside the window: leave the restored block.
    Keep,
    /// Core is running, the session is verified and Locked, and the tunnel permit is up.
    Proven,
    /// The window elapsed without that proof, or Core is neither running nor starting.
    Release,
}

fn restored_connection_proven(
    core_running: bool,
    verified: bool,
    mode: KillSwitchStatusMode,
    tunnel_permit_rendered: bool,
) -> bool {
    core_running && verified && mode == KillSwitchStatusMode::Locked && tunnel_permit_rendered
}

fn wanted_core_window_action(
    strict_kill_switch: bool,
    core_running_or_starting: bool,
    deadline_reached: bool,
    connection_proven: bool,
) -> WantedCoreWindow {
    if strict_kill_switch {
        return WantedCoreWindow::Keep;
    }
    if connection_proven {
        return WantedCoreWindow::Proven;
    }
    // No process and nothing about to start one: do not wait out the cap.
    if !core_running_or_starting || deadline_reached {
        return WantedCoreWindow::Release;
    }
    WantedCoreWindow::Keep
}

fn core_is_running_or_starting(running: bool, replay_expected: bool) -> bool {
    if running || replay_expected {
        return true;
    }
    #[cfg(test)]
    if TEST_CORE_STARTING.load(Ordering::Relaxed) {
        return true;
    }
    false
}

fn core_still_expected(running: bool) -> bool {
    core_is_running_or_starting(running, CORE_REPLAY_EXPECTED.load(Ordering::Relaxed))
}

fn clear_wanted_core_window() {
    DIRECT_EXPIRY_RETIREMENT_PENDING.store(false, Ordering::Release);
    FRESH_ARM_PROOF_PENDING.store(false, Ordering::Release);
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
}

fn note_fresh_arm_core_window(intent: &IntentRecord) {
    clear_wanted_core_window();
    FRESH_ARM_EPOCH.fetch_add(1, Ordering::AcqRel);
    if !intent.strict_kill_switch {
        *WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some(std::time::Instant::now() + FRESH_ARM_PROOF_WINDOW);
        FRESH_ARM_PROOF_PENDING.store(true, Ordering::Release);
    }
}

/// Called after acquiring the owner lifecycle lock. An expired or exhausted worker may only
/// retire the exact arm it observed; verification, release, or a successor arm revokes it.
pub(super) fn expired_fresh_arm_owner(epoch: u64) -> Option<String> {
    if !FRESH_ARM_PROOF_PENDING.load(Ordering::Acquire)
        || FRESH_ARM_EPOCH.load(Ordering::Acquire) != epoch
        || !wanted_core_deadline_reached(std::time::Instant::now())
    {
        return None;
    }
    armed_guard()
        .as_ref()
        .filter(|armed| armed.intent.wanted && !armed.intent.strict_kill_switch)
        .and_then(|armed| armed.intent.owner_key.clone())
}

pub(super) async fn release_expired_fresh_arm(epoch: u64) -> Result<()> {
    let _operation = WFP_OPERATION.lock().await;
    if expired_fresh_arm_owner(epoch).is_none() {
        return Ok(());
    }
    release_unproven_wanted_session_unlocked().await
}

/// Reuse the epoch-fenced owner lifecycle cleanup after committed DIRECT expiry. Caller holds
/// WFP_OPERATION and has already proved exact Blocked. Core owns its own routes and strict-route
/// WFP session, so removing only Tono's filters cannot complete selective fallback.
fn queue_direct_expiry_retirement() -> bool {
    if !armed_guard().as_ref().is_some_and(|armed| {
        armed.intent.wanted && !armed.intent.strict_kill_switch && armed.intent.owner_key.is_some()
    }) {
        return false;
    }
    DIRECT_EXPIRY_RETIREMENT_PENDING.store(true, Ordering::Release);
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
    FRESH_ARM_PROOF_PENDING.store(true, Ordering::Release);
    true
}

fn note_wanted_core_window(intent: &IntentRecord) {
    let mut deadline = WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if intent.strict_kill_switch || !intent.wanted || !intent.is_verified() {
        *deadline = None;
        return;
    }
    *deadline = Some(std::time::Instant::now() + WANTED_CORE_PROOF_WINDOW);
}

fn wanted_core_deadline_reached(now: std::time::Instant) -> bool {
    WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_some_and(|deadline| now >= deadline)
}

/// Stable, App-mappable marker for "the WFP engine stopped answering". The App keys its i18n
/// off prefixes like `TONO_SERVICE_BUSY` by substring, and every handler wraps this message in
/// its own context ("Failed to arm Windows kill switch: …"), so the marker has to survive
/// anywhere inside the string rather than only at its start.
#[cfg_attr(not(any(all(windows, not(feature = "test")), test)), allow(dead_code))]
pub(crate) const WFP_ENGINE_WEDGED_PREFIX: &str = "TONO_WFP_ENGINE_WEDGED";
/// Stable, App-mappable marker for "the Base Filtering Engine is not running". Separate from
/// the wedge marker because the user action differs: start BFE versus reboot the machine.
#[cfg_attr(not(all(windows, not(feature = "test"))), allow(dead_code))]
pub(crate) const BFE_NOT_RUNNING_PREFIX: &str = "TONO_BFE_NOT_RUNNING";
/// Stable marker for "the DNS module did not come back", so a stalled resolver restore is
/// distinguishable in the log and in `last_error` from a DNS restore that ran and failed.
const DNS_RESTORE_STALLED_PREFIX: &str = "TONO_DNS_RESTORE_STALLED";

/// Budget for the cross-module DNS awaits taken on the WFP writer path (`bounded_dns_call`).
/// A DNS restore is two PowerShell batches (10 s each), a live read-back and a cache flush, so
/// the module's own worst case fits inside this and the bound only fires on a genuine stall. It
/// also stays under the IPC handler's 60 s budget, so the refusal still reaches the client.
const DNS_RESTORE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(40);

/// SCM `StopPending` hint posted by the service. Stop is accepted before startup
/// finishes, and startup can still be inside this DNS budget — twice, when an
/// unverified barrier is retired. One post of the hint does not cover that.
/// The service refreshes the checkpoint on [`SCM_STOP_HINT_REFRESH`], which has
/// to land inside one DNS budget and inside the posted hint or SCM kills the
/// process mid-restore.
pub const SCM_STOP_WAIT_HINT: std::time::Duration = std::time::Duration::from_secs(65);
pub const SCM_STOP_HINT_REFRESH: std::time::Duration = std::time::Duration::from_secs(15);

pub fn stop_pending_refresh_due(elapsed_since_last_post: std::time::Duration) -> bool {
    elapsed_since_last_post >= SCM_STOP_HINT_REFRESH
}

/// Budget for the uninstall-only DNS escalation ladder (`dns::restore_for_uninstall`), which is
/// up to two full restore rounds back to back — the exact restore, then the automatic (DHCP)
/// fallback — plus their read-backs. Reusing [`DNS_RESTORE_TIMEOUT`] would cut the ladder off
/// somewhere inside rung 2 on a merely slow machine and report "no evidence" for work that was
/// still making progress, which is the one input that lands on the blocking rung. It stays well
/// under the installer's `/TIMEOUT=180000` for the whole helper (`installer.nsi`,
/// `RemoveVergeService`), which also has to cover stopping the service.
const UNINSTALL_DNS_RESTORE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(100);

/// Environment variable by which the uninstaller opts *its own process* into the DNS escalation
/// ladder (`dns::restore_for_uninstall`).
///
/// The ladder trades exact DNS fidelity for a machine that can actually be uninstalled. That
/// trade is only correct when the product is being removed, so it must not be reachable from
/// anything else that calls this entry point — in particular not from
/// `tono-service.exe --emergency-disarm`, the Start-Menu "Restore Network" recovery, whose job
/// is to put the user's *own* servers back on a machine that is staying installed.
///
/// An in-process environment variable rather than a parameter because the uninstaller is a
/// separate binary linking this library and this is the exported entry point it has; the
/// variable is set by `uninstall_service.rs` in its own process image immediately before the
/// call, so it can never leak into a service or App process.
pub(crate) const UNINSTALL_LADDER_ENV: &str = "TONO_UNINSTALL_DNS_LADDER";

/// Whether the calling process asked for the uninstall ladder. Absent, empty or anything other
/// than `1` means no: an unrecognised value must fall back to the strict path.
fn uninstall_ladder_requested() -> bool {
    std::env::var_os(UNINSTALL_LADDER_ENV).is_some_and(|value| value == "1")
}

fn note_verify(ok: bool) {
    *LAST_VERIFY
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some((std::time::Instant::now(), ok));
}

/// Poison must never turn a past panic into a permanent Service freeze. These three accessors
/// recover the guard contents so status, startup restore, every mutation *and the watchdog*
/// keep working while `WFP_OPERATION` re-serializes the next write.
///
/// They are the only way this module takes these locks. A bare `.lock().unwrap()` on the
/// watchdog path would be the worst of the lot: the tick would panic inside `tokio::spawn`,
/// the task would die with its `JoinHandle` — nothing restarts it — and the verify-after-write
/// reconciliation plus the `LAST_VERIFY` refresh that `status()` reports liveness from would be
/// silently gone for the life of the process.
fn armed_guard() -> std::sync::MutexGuard<'static, Option<Armed>> {
    ARMED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

static STARTUP_RELEASE_RETRY_RUNNING: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static TEST_REMOVE_FAILURE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static TEST_REMOVE_ATTEMPTS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_RESIDUAL_FILTER_KEYS: Lazy<Mutex<Vec<wfp_model::Guid>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

fn spawn_startup_release_retry() {
    if STARTUP_RELEASE_RETRY_RUNNING.swap(true, Ordering::AcqRel) {
        return;
    }
    struct RetryRunningGuard;
    impl Drop for RetryRunningGuard {
        fn drop(&mut self) {
            STARTUP_RELEASE_RETRY_RUNNING.store(false, Ordering::Release);
        }
    }
    let running = RetryRunningGuard;
    tokio::spawn(async move {
        let mut delay = std::time::Duration::from_millis(if cfg!(test) { 10 } else { 1000 });
        let mut last_error_log: Option<std::time::Instant> = None;
        loop {
            tokio::time::sleep(delay).await;
            let _operation = WFP_OPERATION.lock().await;
            if armed_guard().is_some() {
                drop(running);
                return;
            }
            let intent = tokio::fs::read(intent_path())
                .await
                .ok()
                .and_then(|bytes| serde_json::from_slice::<IntentRecord>(&bytes).ok());
            if intent.as_ref().is_some_and(|intent| {
                intent.wanted && (intent_is_valid(intent) || intent.strict_kill_switch)
            }) {
                drop(running);
                return;
            }
            let release: Result<()> = async {
                if intent.as_ref().is_none_or(|intent| intent.wanted) {
                    // Incomplete non-strict evidence needs its startup AI hold and retention.
                    // A newer valid or explicitly strict record was gated above.
                    return release_general_traffic_unlocked(
                        "startup incomplete-intent release retry", false,
                    )
                    .await;
                }
                remove_all_filters_unlocked().await?;
                sweep_legacy_sublayers_unlocked().await;
                let follow_up = intent.as_ref().and_then(IntentRecord::release_follow_up);
                let reconnect = intent.as_ref().is_some_and(|intent| intent.reconnect_after_release);
                if reconnect {
                    // A retry must retain the same crash-reconnect intent as normal startup.
                    RECONNECT_AFTER_RELEASE.store(true, Ordering::Release);
                }
                if !reconnect && follow_up != Some(true) {
                    match tokio::fs::remove_file(intent_path()).await {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                *armed_guard() = None;
                TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
                if let Err(error) = bounded_dns_call(
                    "service start (unwanted intent)",
                    crate::core::dns::ensure_restored(),
                )
                .await
                {
                    tracing::warn!(
                        "service start: leftover DNS snapshot could not be restored: {error:#}"
                    );
                }
                if let Some(apply_narrow) = follow_up {
                    finish_release_follow_up(apply_narrow).await;
                }
                Ok(())
            }
            .await;
            match release {
                Ok(()) => {
                    *last_error_guard() = None;
                    // Retire under the writer lock so a later startup cannot lose its retry.
                    drop(running);
                    return;
                }
                Err(error) => {
                    *last_error_guard() =
                        Some(format!("startup stale-filter release pending: {error:#}"));
                    if last_error_log
                        .is_none_or(|at| at.elapsed() >= std::time::Duration::from_secs(60))
                    {
                        tracing::error!("Windows stale-filter release retry failed: {error:#}");
                        last_error_log = Some(std::time::Instant::now());
                    } else {
                        tracing::debug!(
                            "Windows stale-filter release retry still failing: {error:#}"
                        );
                    }
                }
            }
            delay = (delay * 2).min(std::time::Duration::from_secs(30));
        }
    });
}

/// Return the live tunnel identity that the current core instance is actually permitted to use.
/// DNS recovery uses this to ignore Tono's own WinTUN adapter while still treating the same
/// protected resolver on every physical adapter as an orphaned, fail-closed state. Re-validating
/// the recorded LUID against the running core is essential because Windows can reuse LUID indices.
pub(crate) async fn protected_tunnel_luid() -> Option<u64> {
    let current_core = current_core_instance().await;
    armed_guard()
        .as_ref()
        .and_then(|armed| tunnel_permit_luid(armed, current_core))
}

fn last_error_guard() -> std::sync::MutexGuard<'static, Option<String>> {
    LAST_ERROR
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn last_verify_guard() -> std::sync::MutexGuard<'static, Option<(std::time::Instant, bool)>> {
    LAST_VERIFY
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// How `status()` turns the cached verify into `live`, as a pure function of the cache.
///
/// Two things it deliberately does *not* do: it never reports a verify that actually failed as
/// live (`ok` is a conjunct, not a fallback), and it never reports "no verify has ever run" as
/// live. The only thing [`VERIFY_CACHE_TTL`] buys is that a **successful but slow** tick does
/// not read as dead in the gap before it lands.
fn verify_reads_live(last_verify: Option<(std::time::Instant, bool)>) -> bool {
    last_verify.is_some_and(|(at, ok)| ok && at.elapsed() < VERIFY_CACHE_TTL)
}

fn intent_path() -> PathBuf {
    crate::service_paths()
        .persistent_state_dir()
        .join("kill-switch.json")
}

/// Independent update recovery has no in-memory armed state. Like startup,
/// only a readable wanted record with an explicit strict flag keeps it blocked.
#[cfg(windows)]
pub fn strict_kill_switch_intent_on_disk() -> bool {
    std::fs::read(intent_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<IntentRecord>(&bytes).ok())
        .is_some_and(|intent| intent.wanted && intent.strict_kill_switch)
}

/// Per-write sequence for intent temporaries (BRICK-W11). A shared
/// `kill-switch.tmp` let a later writer delete or overwrite an earlier
/// writer's in-flight bytes, and a `replace` that reported a timeout can
/// still commit afterwards and silently cover a successor's newer intent.
static INTENT_WRITE_SEQ: AtomicU64 = AtomicU64::new(1);
#[cfg(test)]
static TEST_INTENT_VERIFY_CORRUPT: AtomicBool = AtomicBool::new(false);

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    #[cfg(test)]
    {
        TEST_PERSIST_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
        if TEST_PERSIST_FAILURE.load(Ordering::Relaxed) {
            bail!("simulated persistent-state write failure");
        }
    }
    crate::core::paths::ensure_persistent_state_layout()?;
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    // One temporary per write: no writer removes or reuses another's
    // in-flight file. A timed-out rename's source is left alone rather
    // than unlinked under it (cf. staging's reclaim rule).
    let temporary = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        INTENT_WRITE_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    tokio::fs::write(&temporary, bytes).await?;
    crate::core::platform_security::secure_private_service_file_if_exists(&temporary)?;
    crate::core::atomic_file::replace(&temporary, path)
        .await
        .with_context(|| format!("failed to move state into {path:?}"))?;
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    #[cfg(test)]
    if TEST_INTENT_VERIFY_CORRUPT.swap(false, Ordering::Relaxed) {
        // Deterministic stand-in for a stale rename landing between the
        // replace above and the read-back below.
        std::fs::write(path, b"stale-intent")?;
    }
    // A stale commit that landed before this read is a loud error the
    // caller already treats as "not proven" — never a quiet older intent.
    // (A rename landing after this read is still uncovered; it needs the
    // kernel rename to stall past a whole successor write. See BRICK-W11.)
    let committed = tokio::fs::read(path)
        .await
        .with_context(|| format!("failed to verify state at {path:?}"))?;
    if committed != bytes {
        anyhow::bail!("intent write did not commit: destination differs after replace");
    }
    Ok(())
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// A durable record that means an explicit release won and startup must finish removing any
/// provider-scoped WFP debris before it exposes IPC.
///
/// Keeping this record until the next Service start closes a subtle replacement race. A normal
/// release used to delete `kill-switch.json` after proving the filters absent. On this machine,
/// stopping that otherwise-clean Service during an in-place update made persistent filters
/// visible again. The replacement then saw "missing intent + filters" and correctly (but
/// disastrously for a disconnected user) installed the ownerless emergency block. `wanted:false`
/// is the existing, fail-open recovery contract; the next arm atomically replaces it with a
/// wanted record before touching WFP, and startup consumes it only after cleanup.
fn disarmed_tombstone() -> IntentRecord {
    IntentRecord {
        wanted: false,
        mode: KillSwitchStatusMode::Blocked,
        verified: Some(false),
        tunnel_interface: String::new(),
        app_path: String::new(),
        endpoints: Vec::new(),
        api_host_ips: Vec::new(),
        updated_at: now_unix(),
        owner_key: None,
        strict_kill_switch: false,
        reconnect_after_release: false,
        apply_narrow_after_release: Some(false),
    }
}

fn crash_recovery_tombstone() -> IntentRecord {
    let mut tombstone = disarmed_tombstone();
    tombstone.reconnect_after_release = true;
    tombstone.apply_narrow_after_release = Some(true);
    tombstone
}

async fn persist_disarmed_tombstone() -> Result<()> {
    atomic_write(
        &intent_path(),
        &serde_json::to_vec_pretty(&disarmed_tombstone())?,
    )
    .await
}

async fn release_tombstone(apply_narrow: Option<bool>) -> IntentRecord {
    if apply_narrow.is_none() {
        // Idle SCM Stop preserves the automatic release/reconnect disposition on disk.
        if let Ok(bytes) = tokio::fs::read(intent_path()).await {
            if let Ok(intent) = serde_json::from_slice::<IntentRecord>(&bytes) {
                if !intent.wanted {
                    return intent;
                }
            }
        }
    }
    let mut tombstone = disarmed_tombstone();
    tombstone.apply_narrow_after_release = apply_narrow;
    tombstone
}

async fn persist_automatic_release_tombstone() -> Result<()> {
    let tombstone = release_tombstone(Some(true)).await;
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await
}

/// Whether the facade's state machine runs on this build: the real service on Windows, plus
/// test builds everywhere (the engine is stubbed there, the state machine is what is tested).
const SUPPORTED: bool = cfg!(any(windows, test));

fn ensure_supported() -> Result<()> {
    if SUPPORTED {
        Ok(())
    } else {
        bail!("Windows kill switch is unsupported on this platform")
    }
}

const MAX_PROXY_ENDPOINTS: usize = 256;

fn validate_config(config: &KillSwitchConfig) -> Result<()> {
    if config.tunnel_interface.trim().is_empty() {
        bail!("enabled kill switch requires tunnel_interface");
    }
    if config.tunnel_interface.chars().count() > 64 {
        bail!("tunnel_interface is not a plausible interface alias");
    }
    if config.proxy_endpoints.is_empty() {
        bail!("enabled kill switch requires at least one proxy endpoint");
    }
    // Bounded like every other list that feeds the same WFP install (`direct_endpoints`
    // below, API hosts in `wfp_model::sanitize_api_host_ips`, `proxyEndpoints` in the Mac
    // helper). Each entry becomes one ALE filter in a single transaction, and the intent is
    // persisted before that transaction runs, so an unbounded list arms the machine
    // fail-closed with an install that cannot finish and is replayed at every service start.
    // A session carries the selected node plus at most the home route; 256 is the sibling
    // bound and the Mac ceiling (8 hosts x 32 pinned addresses) alike.
    if config.proxy_endpoints.len() > MAX_PROXY_ENDPOINTS {
        bail!("proxy_endpoints exceeds the {MAX_PROXY_ENDPOINTS}-entry bound");
    }
    for endpoint in &config.proxy_endpoints {
        if wfp_model::parse_endpoint(endpoint).is_none() {
            bail!("invalid proxy endpoint {}:{}", endpoint.ip, endpoint.port);
        }
    }
    validate_direct_endpoints(config)
}

/// Cloud-approved DIRECT endpoints (WeChat acceleration), mirroring the Mac helper's
/// `validateSessionDirectEndpoints`: a bounded list of exact public `IP:port` tuples on an
/// approved port — and never one of the permanently protected addresses.
fn validate_direct_endpoints(config: &KillSwitchConfig) -> Result<()> {
    const MAX_DIRECT_ENDPOINTS: usize = 256;
    if config.direct_endpoints.len() > MAX_DIRECT_ENDPOINTS {
        bail!("direct_endpoints exceeds the {MAX_DIRECT_ENDPOINTS}-entry bound");
    }
    // permanentlyProtected: a selected node address or the well-known DNS resolvers must
    // never go DIRECT.
    let node_ips = config
        .proxy_endpoints
        .iter()
        .filter_map(|endpoint| wfp_model::parse_endpoint(endpoint).map(|(ip, _, _)| ip))
        .collect::<Vec<_>>();
    for endpoint in &config.direct_endpoints {
        let Some((ip, port, protocol)) = wfp_model::parse_endpoint(endpoint) else {
            bail!("invalid direct endpoint {}:{}", endpoint.ip, endpoint.port);
        };
        let port_ok = match protocol {
            wfp_model::IpProtocol::Tcp => matches!(port, 80 | 443),
            wfp_model::IpProtocol::Udp => matches!(port, 443 | 8000),
            // parse_endpoint only yields Tcp/Udp; anything else is not an approved DIRECT port.
            _ => false,
        };
        if !port_ok {
            bail!("direct endpoint {ip}:{port}/{protocol:?} is not an approved WeChat port");
        }
        let IpAddr::V4(ipv4) = ip else {
            bail!("direct endpoint {ip} must be an IPv4 public-unicast address");
        };
        if !is_public_direct_ipv4(ipv4) {
            bail!("direct endpoint {ip} is not a public-unicast address");
        }
        if ip == IpAddr::from([1, 1, 1, 1]) || ip == IpAddr::from([8, 8, 8, 8]) {
            bail!("direct endpoint {ip} is a permanently protected resolver");
        }
        if node_ips.contains(&ip) {
            bail!("direct endpoint {ip} duplicates a selected node address");
        }
    }
    Ok(())
}

/// A conservative IPv4-only public-unicast gate for physical-interface DIRECT grants.
///
/// The generated outbound is explicitly `ip-version: ipv4`; rejecting every special-use range here
/// keeps loopback, LAN, link-local, carrier-NAT, benchmark, documentation, multicast, and
/// reserved destinations out of WFP even if a malformed cloud document reaches the Service.
fn is_public_direct_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !matches!(
        (a, b, c),
        (0, _, _)
            | (10, _, _)
            | (100, 64..=127, _)
            | (127, _, _)
            | (169, 254, _)
            | (172, 16..=31, _)
            | (192, 0, 0)
            | (192, 0, 2)
            | (192, 88, 99)
            | (192, 168, _)
            | (198, 18..=19, _)
            | (198, 51, 100)
            | (203, 0, 113)
            | (224..=255, _, _)
    )
}

fn intent_is_valid(intent: &IntentRecord) -> bool {
    intent.wanted
        && !intent.tunnel_interface.is_empty()
        // The app-scoped permit is resolved from this path, and the model emits an app-id rule
        // whenever an endpoint permit exists. An empty path would therefore make every install
        // from this record fall back to "block installed, endpoint permit missing" forever; a
        // truncated record is instead an unusable *wanted* intent (emergency block below).
        && !intent.app_path.is_empty()
        && !intent.endpoints.is_empty()
        && intent
            .endpoints
            .iter()
            .all(|endpoint| wfp_model::parse_endpoint(endpoint).is_some())
}

/// The installed Tono app, the only process that calls the control plane (the Service has no
/// HTTP client). Rule C is scoped to this image's app id; Program Files is writable only by
/// administrators, the same trust the core-path allowlist rests on. Empty when the app is not
/// installed there: the bootstrap API channel is then not rendered, which fails closed.
fn installed_tono_app_path() -> String {
    #[cfg(all(windows, not(feature = "test")))]
    {
        crate::core::update::program_files()
            .map(|root| root.join("Tono").join("Tono.exe"))
            .ok()
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        String::new()
    }
}

/// The rule model's view of an armed session, given who the running core is. Pure, so the
/// tunnel-permit lifetime rule is testable without a core.
fn rule_config_for(armed: &Armed, current_core: Option<CoreInstance>) -> RuleConfig {
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
static TUNNEL_PERMIT_RENDERED: AtomicBool = AtomicBool::new(false);

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
fn rule_config_rendering(armed: &Armed, current_core: Option<CoreInstance>) -> RuleConfig {
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

/// Budget for one WFP call. A healthy transaction is milliseconds and the surrounding IPC
/// handler budget is `IPC_HANDLER_TIMEOUT` = 60 s, so 25 s is three orders of magnitude beyond
/// "slow but alive" while still leaving the handler more than half its budget to answer the
/// client. Because the first expiry latches the in-flight claim (see below), every later call
/// in the same handler fails immediately — one handler can therefore stall for at most one
/// budget, no matter how many engine calls its path makes.
#[cfg(all(windows, not(feature = "test")))]
const WFP_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);
/// Anything slower than this is already pathological: report it even for the once-a-second
/// verify, so the log carries evidence of a degrading BFE before it wedges completely.
#[cfg(any(all(windows, not(feature = "test")), test))]
const WFP_SLOW_CALL: std::time::Duration = std::time::Duration::from_secs(2);
/// The BFE probe is an SCM query, not a WFP RPC: it exists only to name the cause, so it gets
/// a short budget and never delays an engine call for long.
#[cfg(all(windows, not(feature = "test")))]
const BFE_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// A WFP call that was handed to a blocking thread and has not come back yet.
///
/// Registered *before* the thread is spawned and released *only* by that thread — never by the
/// caller. That asymmetry is the whole single-writer argument: a caller that hits its deadline
/// gives up on the *answer*, not on the *ownership*.
#[cfg(any(all(windows, not(feature = "test")), test))]
#[derive(Debug, Clone, Copy)]
struct EngineCallInFlight {
    operation: &'static str,
    started_at: std::time::Instant,
    /// Epoch of this call. The releasing guard only clears its own epoch, so a call that
    /// returns very late can never erase the claim of a call that started after it.
    epoch: u64,
    /// Its caller already timed out and reported failure; the result is discarded on arrival.
    abandoned: bool,
}

#[cfg(any(all(windows, not(feature = "test")), test))]
static ENGINE_CALL_IN_FLIGHT: Lazy<Mutex<Option<EngineCallInFlight>>> =
    Lazy::new(|| Mutex::new(None));
#[cfg(any(all(windows, not(feature = "test")), test))]
static ENGINE_CALL_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(any(all(windows, not(feature = "test")), test))]
fn engine_call_slot() -> std::sync::MutexGuard<'static, Option<EngineCallInFlight>> {
    ENGINE_CALL_IN_FLIGHT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(any(all(windows, not(feature = "test")), test))]
fn engine_call_in_flight() -> Option<EngineCallInFlight> {
    *engine_call_slot()
}

/// Refusal for a caller that wants to start an engine call while an earlier one is still
/// inside the kernel. Honest and fail-closed: nothing is installed, nothing is removed, and
/// the machine keeps whatever policy the last completed call left behind.
#[cfg(any(all(windows, not(feature = "test")), test))]
fn wedged_engine_error(operation: &str, wedged: EngineCallInFlight) -> anyhow::Error {
    anyhow::anyhow!(
        "{WFP_ENGINE_WEDGED_PREFIX}: the WFP engine has been inside {} for {:?} without \
         returning, so {operation} is refused rather than started as a second concurrent \
         writer. The Base Filtering Engine (BFE) is likely wedged or hooked by third-party \
         security software; protection stays in its last known state until that call returns \
         or the machine is restarted.",
        wedged.operation,
        wedged.started_at.elapsed(),
    )
}

/// Dropped on the blocking thread the instant the kernel call returns — on time, or hours
/// late. This is the *only* place an in-flight claim is released, and it releases only its own
/// epoch.
#[cfg(any(all(windows, not(feature = "test")), test))]
struct EngineCallClaim(u64);

#[cfg(any(all(windows, not(feature = "test")), test))]
impl Drop for EngineCallClaim {
    fn drop(&mut self) {
        let mut slot = engine_call_slot();
        let Some(current) = *slot else { return };
        if current.epoch != self.0 {
            return;
        }
        *slot = None;
        if current.abandoned {
            // The caller reported failure long ago; this is the log line that says the engine
            // is alive again. The call's own result was dropped with its `JoinHandle`, so it
            // cannot contradict what was already reported.
            tracing::error!(
                "wfp: {} finally returned after {:?}; its caller had already given up, the \
                 result is discarded, and WFP operations are accepted again",
                current.operation,
                current.started_at.elapsed(),
            );
        }
    }
}

/// The watchdog verifies once a second: only the rare, mutating operations may announce
/// themselves at info, or the service log would carry a line per second forever.
#[cfg(any(all(windows, not(feature = "test")), test))]
fn engine_call_is_periodic(operation: &str) -> bool {
    operation == "verify"
}

/// Run one engine operation on a blocking thread under a hard deadline, holding the
/// single-writer claim described on [`EngineCallInFlight`].
///
/// Engine calls are synchronous WFP RPCs, so they run off the (possibly single-threaded) IPC
/// runtime — a slow BFE must not freeze request handling (the DNS engine does the same). They
/// are also bounded, because on a real machine a wedged or hooked Base Filtering Engine can
/// make an `Fwpm*` call block forever and `spawn_blocking` cannot be cancelled: the thread
/// keeps running whatever the caller does.
///
/// Single-writer argument for the timeout path:
/// * the claim is registered *before* the thread is spawned and released only by that thread,
///   in `EngineCallClaim::drop`, when the kernel call actually returns;
/// * a caller that hits its deadline returns an error and leaves the claim standing, so every
///   later engine call — this handler's, the next handler's, the watchdog's — fails fast here
///   instead of opening a concurrent WFP transaction;
/// * the abandoned task can publish nothing: it only calls pure `wfp::*` FFI, its return value
///   dies with the `JoinHandle` the deadline dropped, and its claim release is keyed to its own
///   epoch, so it cannot clear a claim taken by a later call.
///
/// The machinery is compiled off Windows too, so those ownership rules stay unit-testable;
/// only the `Fwpm*` closures handed to it are Windows-only.
#[cfg(any(all(windows, not(feature = "test")), test))]
async fn bounded_engine_call<T: Send + 'static>(
    budget: std::time::Duration,
    operation: &'static str,
    call: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    let epoch = {
        let mut slot = engine_call_slot();
        if let Some(wedged) = *slot {
            return Err(wedged_engine_error(operation, wedged));
        }
        let epoch = ENGINE_CALL_EPOCH.fetch_add(1, Ordering::AcqRel);
        *slot = Some(EngineCallInFlight {
            operation,
            started_at: std::time::Instant::now(),
            epoch,
            abandoned: false,
        });
        epoch
    };
    let announce = !engine_call_is_periodic(operation);
    if announce {
        tracing::info!("wfp: {operation} starting");
    } else {
        tracing::debug!("wfp: {operation} starting");
    }
    let started_at = std::time::Instant::now();
    let task = tokio::task::spawn_blocking(move || {
        // Local, so it drops (releasing the claim) after `call` returns and before the result
        // reaches the awaiting caller.
        let _claim = EngineCallClaim(epoch);
        call()
    });
    match tokio::time::timeout(budget, task).await {
        Ok(joined) => {
            let elapsed = started_at.elapsed();
            if elapsed >= WFP_SLOW_CALL {
                tracing::warn!(
                    "wfp: {operation} finished in {}ms — the engine is answering, but far slower \
                     than a healthy transaction",
                    elapsed.as_millis()
                );
            } else if announce {
                tracing::info!("wfp: {operation} finished in {}ms", elapsed.as_millis());
            } else {
                tracing::debug!("wfp: {operation} finished in {}ms", elapsed.as_millis());
            }
            joined.context("WFP engine task failed")?
        }
        Err(_) => {
            // Claim the abandonment by epoch instead of writing the slot: the call may have
            // returned in the instant between the deadline and this line, in which case its
            // guard already cleared the slot and nothing is wedged.
            let still_running = {
                let mut slot = engine_call_slot();
                match slot.as_mut() {
                    Some(current) if current.epoch == epoch => {
                        current.abandoned = true;
                        true
                    }
                    _ => false,
                }
            };
            if still_running {
                tracing::error!(
                    "wfp: {operation} did not return within {budget:?} and is still inside the \
                     kernel; every further WFP operation fails fast until it returns"
                );
            } else {
                tracing::error!(
                    "wfp: {operation} returned just after its {budget:?} deadline; its result was \
                     discarded and the caller was told it failed"
                );
            }
            bail!(
                "{WFP_ENGINE_WEDGED_PREFIX}: WFP engine did not answer within {budget:?} during \
                 {operation}; the Base Filtering Engine (BFE) may be wedged or blocked by \
                 third-party security software. Protection was left in its last known state and \
                 no further WFP operation starts until the pending call returns."
            )
        }
    }
}

/// Whether the BFE probe still has anything to say. Set once it answered "Running" or proved
/// unanswerable; a conclusive "not Running" leaves it clear so the next attempt re-probes.
#[cfg(all(windows, not(feature = "test")))]
static BFE_PROBE_SETTLED: AtomicBool = AtomicBool::new(false);

/// Every `Fwpm*` call is an RPC to the Base Filtering Engine, which this service already
/// declares as a start dependency (`install_service.rs`). Probe it once before the first
/// engine open: a stopped BFE is the difference between "WFP is slow" and "WFP will never
/// answer", and naming it turns an indefinite block into an actionable error.
///
/// Only a conclusive "not Running" is fatal, and that answer is deliberately not cached, so a
/// BFE that starts late recovers on the watchdog's next tick. Everything inconclusive (SCM
/// unreachable, probe itself too slow) is diagnostics we do not have: warn once, settle, and
/// let the now-bounded engine call speak for itself.
#[cfg(all(windows, not(feature = "test")))]
async fn ensure_bfe_running() -> Result<()> {
    if BFE_PROBE_SETTLED.load(Ordering::Acquire) {
        return Ok(());
    }
    let probe = tokio::time::timeout(
        BFE_PROBE_TIMEOUT,
        tokio::task::spawn_blocking(crate::core::wfp::bfe_service_state),
    )
    .await;
    let inconclusive = match probe {
        Ok(Ok(Ok((true, state)))) => {
            tracing::info!("wfp: Base Filtering Engine reports {state}");
            BFE_PROBE_SETTLED.store(true, Ordering::Release);
            return Ok(());
        }
        Ok(Ok(Ok((false, state)))) => {
            bail!(
                "{BFE_NOT_RUNNING_PREFIX}: the Base Filtering Engine (BFE) service is {state}, \
                 not Running, so no WFP rule can be installed or removed. Start it from an \
                 elevated prompt (`sc start BFE`) or restart the machine, then retry; \
                 third-party security software is the usual reason it is stopped."
            );
        }
        Ok(Ok(Err(error))) => format!("{error:#}"),
        Ok(Err(error)) => format!("probe task failed: {error}"),
        Err(_) => format!("probe exceeded {BFE_PROBE_TIMEOUT:?}"),
    };
    tracing::warn!(
        "wfp: could not read the Base Filtering Engine service state ({inconclusive}); \
         continuing with bounded engine calls"
    );
    BFE_PROBE_SETTLED.store(true, Ordering::Release);
    Ok(())
}

/// The single door to the WFP engine: BFE diagnostics, then a bounded, single-writer call.
#[cfg(all(windows, not(feature = "test")))]
async fn engine_call<T: Send + 'static>(
    operation: &'static str,
    call: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    // The wedge check comes first: while an earlier call is still inside the kernel, nothing
    // BFE reports about itself changes the answer, and the refusal must stay instant.
    if let Some(wedged) = engine_call_in_flight() {
        return Err(wedged_engine_error(operation, wedged));
    }
    ensure_bfe_running().await?;
    bounded_engine_call(WFP_CALL_TIMEOUT, operation, call).await
}

async fn install_unlocked(armed: &Armed) -> Result<()> {
    install_unlocked_for(armed, current_core_instance().await).await
}

/// [`install_unlocked`] for a caller that has already read the core identity and must render
/// from *that* read — see [`rule_config_rendering`]. `lock` is the only such caller, and it is
/// the one where a second, disagreeing read is terminal.
async fn install_unlocked_for(armed: &Armed, current_core: Option<CoreInstance>) -> Result<()> {
    let config = rule_config_rendering(armed, current_core);
    let tunnel_permit_expected = config.tun_luid.is_some();
    let expected = wfp_model::expected_filters(&config);
    #[cfg(all(windows, not(feature = "test")))]
    {
        let app_path = armed.intent.app_path.clone();
        let tono_app_path = config.tono_app_path.clone();
        let result = engine_call("install", move || {
            crate::core::wfp::install(&expected, &app_path, &tono_app_path)
        })
        .await;
        // `install` ends with exact provider-set verification, so only a successful transaction
        // may publish that a tunnel permit was actually rendered.
        TUNNEL_PERMIT_RENDERED.store(result.is_ok() && tunnel_permit_expected, Ordering::Relaxed);
        note_verify(result.is_ok());
        if result.is_ok() {
            RESTORED_BARRIER_UNPROVEN.store(false, Ordering::Release);
            // Retire the crash-time AI hold only after its replacement is proven.
            crate::core::selective_layer::remove().await;
        }
        result
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let _ = expected;
        #[cfg(test)]
        {
            TEST_INSTALL_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
            if TEST_INSTALL_FAILURE.load(Ordering::Relaxed) {
                TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
                note_verify(false);
                bail!("simulated WFP install failure");
            }
            if TEST_AMBIGUOUS_INSTALL_FAILURE.load(Ordering::Relaxed) {
                // Model `wfp::install` committing before exact verification fails, or a bounded
                // caller timing out while its kernel worker remains in flight. The caller must
                // treat the candidate as possibly live despite this `Err`.
                TUNNEL_PERMIT_RENDERED.store(tunnel_permit_expected, Ordering::Relaxed);
                note_verify(false);
                bail!("simulated ambiguous WFP install failure after possible commit");
            }
        }
        TUNNEL_PERMIT_RENDERED.store(tunnel_permit_expected, Ordering::Relaxed);
        RESTORED_BARRIER_UNPROVEN.store(false, Ordering::Release);
        crate::core::selective_layer::remove().await;
        Ok(())
    }
}

async fn verify_live_unlocked_for(armed: &Armed, current_core: Option<CoreInstance>) -> Result<()> {
    let config = rule_config_rendering(armed, current_core);
    let tunnel_permit_expected = config.tun_luid.is_some();
    let expected = wfp_model::expected_filters(&config);
    #[cfg(all(windows, not(feature = "test")))]
    {
        let result = engine_call("verify", move || crate::core::wfp::verify(&expected)).await;
        TUNNEL_PERMIT_RENDERED.store(result.is_ok() && tunnel_permit_expected, Ordering::Relaxed);
        if result.is_ok() {
            RESTORED_BARRIER_UNPROVEN.store(false, Ordering::Release);
        }
        result
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let _ = expected;
        TUNNEL_PERMIT_RENDERED.store(tunnel_permit_expected, Ordering::Relaxed);
        Ok(())
    }
}

/// Update proof must query WFP now, never elevate the diagnostic cache to proof.
#[cfg(windows)]
pub(crate) async fn observe_for_update() -> Result<KillSwitchStatus> {
    let _operation = WFP_OPERATION.lock().await;
    let armed = armed_guard().clone();
    if let Some(armed) = armed {
        let current = current_core_instance_authoritative().await;
        verify_live_unlocked_for(&armed, current).await?;
        note_verify(true);
        if current.is_none() {
            // A successful Core stop is not proof that its adapter disappeared.
            crate::core::update::tunnel_absent(&armed.intent.tunnel_interface)?;
        }
    }
    Ok(status().await)
}

async fn remove_all_filters_unlocked() -> Result<()> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        engine_call("remove all filters", crate::core::wfp::remove_all_filters).await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        #[cfg(test)]
        {
            TEST_REMOVE_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
            if TEST_REMOVE_FAILURE.load(Ordering::Relaxed) {
                bail!("simulated WFP removal failure");
            }
            TEST_RESIDUAL_FILTER_KEYS
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clear();
        }
        Ok(())
    }
}

/// Upgrade/migration sweep: remove sublayers left by older builds (filters included). Must
/// run strictly *after* the current expected set is committed (or all filters were removed
/// on purpose): an older build's PERSISTENT block-all pair may be the only protection at
/// boot after an upgrade reboot, and deleting it before the replacement floor is live would
/// open a zero-filter window. Best-effort — a failed sweep leaves extra blocking, never less.
async fn sweep_legacy_sublayers_unlocked() {
    #[cfg(all(windows, not(feature = "test")))]
    if let Err(error) = engine_call(
        "legacy sublayer sweep",
        crate::core::wfp::remove_legacy_sublayers,
    )
    .await
    {
        tracing::warn!("legacy WFP sublayer cleanup failed: {error:#}");
    }
}

fn record_outcome(result: Result<()>) -> Result<()> {
    match result {
        Ok(()) => {
            *last_error_guard() = None;
            Ok(())
        }
        Err(error) => {
            *last_error_guard() = Some(format!("{error:#}"));
            Err(error)
        }
    }
}

/// Join startup's durable and live fail-closed proofs without allowing either failure to skip the
/// other attempt. `ARMED` is published before both calls, so any error still leaves the watchdog a
/// conservative model to reconcile.
fn record_startup_reconciliation(persist: Result<()>, install: Result<()>) -> Result<()> {
    match (persist, install) {
        (Ok(()), Ok(())) => {
            *last_error_guard() = None;
            Ok(())
        }
        (Err(error), Ok(())) => {
            let message = format!(
                "startup installed exact Blocked WFP but could not persist the conservative intent: {error:#}"
            );
            *last_error_guard() = Some(message.clone());
            Err(error.context(message))
        }
        (Ok(()), Err(error)) => {
            let message = format!(
                "startup persisted the conservative intent but could not install exact Blocked WFP: {error:#}"
            );
            *last_error_guard() = Some(message.clone());
            Err(error.context(message))
        }
        (Err(persist), Err(install)) => {
            let message = format!(
                "startup could neither persist the conservative intent ({persist:#}) nor install exact Blocked WFP ({install:#})"
            );
            *last_error_guard() = Some(message.clone());
            bail!(message)
        }
    }
}

/// The bootstrap API channel's destinations, admitted from what the client supplied.
///
/// **Literal IPs only — the service never resolves a name here.** Resolving one would mean the
/// answer picks the permit: the app looks the API host up through the system resolver *before*
/// the barrier arms, so a hostile DHCP resolver, a captive portal or an on-path spoofer would
/// choose up to [`wfp_model::MAX_API_HOST_IPS`] of the destinations this service then punches
/// through its own block — and "public and unreserved" is the only thing that check could ever
/// prove about the answer, because nothing here binds it to an expected host or a pin. The
/// client already pins literals for exactly this reason (its own recovery path must survive a
/// poisoned resolver), so nothing is lost: a non-literal entry is dropped, never looked up.
///
/// Order is the caller's, so the sanitizer's first-wins dedup and cap keep favouring earlier
/// hosts; everything is funnelled through the model's public-only, bounded sanitizer.
/// Union persisted learned control-plane addresses into a restored intent.
///
/// The last StartClash may predate this session's protected learn. On reboot the
/// WFP recovery channel should still include those ProgramData pins, or a
/// rotated anycast edge is unreachable until the App connects again.
fn apply_learned_bootstrap_pins(intent: &mut IntentRecord) {
    let learned = crate::core::bootstrap_pins::load();
    if learned.addresses.is_empty() {
        return;
    }
    intent.api_host_ips = union_api_hosts(&intent.api_host_ips, &learned.addresses);
}

fn union_api_hosts(existing: &[String], learned: &[String]) -> Vec<String> {
    let mut hosts = existing.to_vec();
    hosts.extend(learned.iter().cloned());
    admit_api_host_ips(&hosts)
        .into_iter()
        .map(|ip| ip.to_string())
        .collect()
}

fn admit_api_host_ips(hosts: &[String]) -> Vec<IpAddr> {
    let mut literals = Vec::new();
    for host in hosts.iter().take(16) {
        let host = host.trim();
        if host.is_empty() {
            continue;
        }
        match host.parse::<IpAddr>() {
            Ok(ip) => literals.push(ip),
            Err(_) => tracing::warn!(
                "kill-switch API host {host:?} is not a literal IP and is dropped; the service \
                 does not resolve names into WFP permits"
            ),
        }
    }
    wfp_model::sanitize_api_host_ips(literals)
}

/// First phase of the two-phase arm: floor + session rules up, API channel open, tunnel not
/// yet permitted. Called from `StartClash` before the core is started. `owner_key` is the
/// authenticated owner's key (SHA256(SID)), recorded so only that owner can later release or
/// restrict the machine-wide policy.
pub(crate) async fn arm_bootstrap(
    config: &KillSwitchConfig,
    app_path: &str,
    owner_key: &str,
) -> Result<()> {
    ensure_supported()?;
    validate_config(config)?;
    if app_path.trim().is_empty() {
        bail!("enabled kill switch requires the staged core path");
    }
    if owner_key.is_empty() {
        bail!("enabled kill switch requires the authenticated owner key");
    }
    if !config.direct_endpoints.is_empty() {
        bail!(
            "initial arm cannot grant DIRECT endpoints; use the authenticated runtime-reload transaction"
        );
    }
    let api_host_ips = admit_api_host_ips(&config.bootstrap_api_hosts);
    let _operation = WFP_OPERATION.lock().await;
    // Re-checked under the WFP lock: this is the write that records the new owner.
    authorize_takeover_for(owner_key).map_err(anyhow::Error::new)?;
    let inherited_verified = armed_guard().as_ref().is_some_and(|armed| {
        armed.intent.owner_key.as_deref() == Some(owner_key) && armed.intent.is_verified()
    });
    let armed = Armed {
        intent: IntentRecord {
            wanted: true,
            mode: KillSwitchStatusMode::Bootstrap,
            verified: Some(inherited_verified),
            tunnel_interface: config.tunnel_interface.trim().to_owned(),
            app_path: app_path.to_owned(),
            endpoints: config.proxy_endpoints.clone(),
            api_host_ips: api_host_ips.iter().map(ToString::to_string).collect(),
            updated_at: now_unix(),
            owner_key: Some(owner_key.to_owned()),
            strict_kill_switch: false,
            reconnect_after_release: false,
            apply_narrow_after_release: None,
        },
        tun_luid: None,
        core_instance: None,
        // In memory only — populated exclusively by the lease-backed reload transaction.
        direct_endpoints: Vec::new(),
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    };
    // Persist fail-closed intent before touching WFP: a daemon restart installs at least the
    // floor if this process dies during the following transaction.
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await?;
    CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
    RECONNECT_AFTER_RELEASE.store(false, Ordering::Release);
    *armed_guard() = Some(armed.clone());
    note_fresh_arm_core_window(&armed.intent);
    record_outcome(install_unlocked(&armed).await)
}

/// Commit the full app verification barrier for the active logical session.
pub(crate) async fn mark_verified(owner_key: &str) -> Result<()> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let mut armed = armed_guard().clone().context("kill switch is not armed")?;
    if DIRECT_EXPIRY_RETIREMENT_PENDING.load(Ordering::Acquire) {
        bail!("expired DIRECT session is retiring Core; a fresh Connect is required");
    }
    if armed.intent.owner_key.as_deref() != Some(owner_key) {
        bail!("kill switch belongs to a different owner");
    }
    if armed.intent.mode != KillSwitchStatusMode::Locked {
        bail!("kill switch must be locked before verification");
    }
    if armed.intent.is_verified() && armed.intent.verified == Some(true) {
        clear_wanted_core_window();
        return Ok(());
    }
    armed.intent.verified = Some(true);
    armed.intent.updated_at = now_unix();
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await?;
    *armed_guard() = Some(armed);
    clear_wanted_core_window();
    Ok(())
}

/// Replace the live Reality destination permits without stopping the core.
///
/// Used by a connected node switch: the App first sends old ∪ new, then after
/// the selector and data-plane proof succeed, sends new-only. Install failure
/// restores the previous permit set. Restore failure goes Blocked — never open.
pub(crate) async fn replace_proxy_endpoints(endpoints: &[ProxyEndpoint]) -> Result<()> {
    ensure_supported()?;
    if endpoints.is_empty() {
        bail!("enabled kill switch requires at least one proxy endpoint");
    }
    if endpoints.len() > MAX_PROXY_ENDPOINTS {
        bail!("proxy_endpoints exceeds the {MAX_PROXY_ENDPOINTS}-entry bound");
    }
    for endpoint in endpoints {
        if wfp_model::parse_endpoint(endpoint).is_none() {
            bail!("invalid proxy endpoint {}:{}", endpoint.ip, endpoint.port);
        }
    }
    let _operation = WFP_OPERATION.lock().await;
    let mut armed = armed_guard().clone().context("kill switch is not armed")?;
    if armed.intent.mode != KillSwitchStatusMode::Locked {
        bail!("kill switch must be locked before replacing proxy endpoints");
    }
    let Some(core) = current_core_instance_authoritative().await else {
        bail!("proxy endpoint replace has no running Core");
    };
    if armed.core_instance.is_some() && armed.core_instance != Some(core) {
        bail!("core identity changed; a fresh lock is required");
    }
    let previous = armed.intent.endpoints.clone();
    armed.intent.endpoints = endpoints.to_vec();
    armed.intent.updated_at = now_unix();
    atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await?;
    *armed_guard() = Some(armed.clone());
    if let Err(error) = install_unlocked_for(&armed, Some(core)).await {
        armed.intent.endpoints = previous;
        armed.intent.updated_at = now_unix();
        let _ = atomic_write(&intent_path(), &serde_json::to_vec_pretty(&armed.intent)?).await;
        *armed_guard() = Some(armed.clone());
        if let Err(restore) = install_unlocked_for(&armed, Some(core)).await {
            let current = current_core_instance_authoritative().await;
            let _ = transition_direct_to_blocked_unlocked(armed, current, None).await;
            return Err(restore.context(format!(
                "proxy endpoint install failed ({error:#}) and previous permit could not be restored"
            )));
        }
        return Err(error.context("proxy endpoint install failed; previous permit restored"));
    }
    Ok(())
}

/// Whether `caller_key` may mutate the armed protection (release / restrict / DNS restore).
///
/// The pipe authenticates *a* local user; the armed WFP policy is machine-global and belongs
/// to the owner who armed it. A different local user must not release it. Intents without an
/// `owner_key` (emergency/corrupt restores, or files predating this field) own no one: they
/// can be released by any authenticated owner — that is the documented escape hatch, and it
/// cannot be abused to steal another user's protection because there is nothing to steal
/// beyond a block anybody would want gone anyway.
pub(crate) fn authorize_write_for(
    caller_key: &str,
) -> std::result::Result<(), crate::core::auth::ServiceError> {
    let recorded = { armed_guard().clone() }.and_then(|armed| armed.intent.owner_key);
    let Some(recorded) = recorded else {
        return Ok(());
    };
    if recorded == caller_key {
        Ok(())
    } else {
        Err(crate::core::auth::ServiceError::not_active())
    }
}

/// Whether `caller_key` may make itself the owner of the armed protection (StartClash /
/// PrepareCoreStart).
///
/// `authorize_write_for` stops a different local user from releasing the armed policy, but a
/// start rewrites the recorded owner and stops the running Core, after which that user's
/// release would pass. So a start is refused on the same terms while the recorded owner still
/// has a Windows logon session (active or disconnected). Once that user has signed out nobody
/// is left to protect and the next user may take over. Ownerless intents stay open to anyone,
/// exactly as in `authorize_write_for`.
pub(crate) fn authorize_takeover_for(
    caller_key: &str,
) -> std::result::Result<(), crate::core::auth::ServiceError> {
    let recorded = { armed_guard().clone() }
        .filter(|armed| armed.intent.wanted)
        .and_then(|armed| armed.intent.owner_key);
    match recorded {
        Some(recorded) if recorded != caller_key && owner_signed_in(&recorded) => {
            Err(crate::core::auth::ServiceError::protection_held_by_another_user())
        }
        _ => Ok(()),
    }
}

/// The kind of Windows session the authenticated caller's process runs in.
#[cfg_attr(not(any(all(windows, not(feature = "test")), test)), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CallerSession {
    /// The physical console session.
    Console,
    /// A Remote Desktop (or other remoting protocol) session. It reaches this PC over the
    /// physical interface that armed protection blocks, with no inbound exception.
    Remote,
    /// The session could not be read.
    Unknown,
}

/// Whether a user-initiated connect (`StartClash` / `PrepareCoreStart`) must be refused because
/// of the caller's session (TW-anthropic-1).
///
/// Arming protection from a Remote Desktop session cuts that session, and once the intent is
/// verified the block is reinstalled at every boot; the emergency release refuses while the
/// Service answers, and a disconnected owner still counts as signed in. A PC managed only over
/// RDP could not be recovered. So a caller that is not provably on the console may not be the one
/// that first arms protection. An unreadable session is refused like a remote one: the refusal
/// leaves the network exactly as it was, while a wrong "console" answer could strand the machine.
///
/// The one exception is a caller whose own protection is already *verified* (`armed` is the
/// published intent). Verification is committed only after a successful lock, so it proves the
/// barrier was actually installed for this owner; that reconnect path stays fail-closed and
/// unchanged. A verified intent carried over by startup recovery is withheld from `armed` until
/// this start has proved its filters (`connect_session_refused`, TW-R-boot).
/// A bare `wanted` intent proves nothing: `ARMED` is published before the WFP install
/// and survives a failed one, so a local first arm that failed before committing filters must not
/// let a Remote Desktop retry arm for the first time.
fn remote_session_connect_refused(
    session: CallerSession,
    armed: Option<&IntentRecord>,
    caller_key: &str,
) -> bool {
    let caller_holds_verified_protection = armed.is_some_and(|intent| {
        intent.wanted && intent.is_verified() && intent.owner_key.as_deref() == Some(caller_key)
    });
    session != CallerSession::Console && !caller_holds_verified_protection
}

/// [`remote_session_connect_refused`] against the Service's published protection. A verified
/// intent carried over by startup recovery counts only once this start has proved its filters
/// ([`RESTORED_BARRIER_UNPROVEN`]); until then the caller holds no proven protection.
fn connect_session_refused(session: CallerSession, caller_key: &str) -> bool {
    let armed = armed_guard();
    let proven = armed
        .as_ref()
        .filter(|_| !RESTORED_BARRIER_UNPROVEN.load(Ordering::Acquire));
    remote_session_connect_refused(session, proven.map(|armed| &armed.intent), caller_key)
}

/// Refuse a connect from a non-console session unless the caller already holds verified
/// protection. `caller_session_id` is `AuthenticatedOwner::peer_session_id`: read from the token of
/// the very pipe-peer process whose SID authentication verified, while that process handle was
/// open, so it names the calling App's session (not this Service's Session 0) and cannot be
/// redirected by a PID reused while the request waited for the lifecycle lock.
pub(crate) fn authorize_connect_session_for(
    caller_key: &str,
    caller_session_id: Option<u32>,
) -> std::result::Result<(), crate::core::auth::ServiceError> {
    let session = caller_session(caller_session_id);
    if !connect_session_refused(session, caller_key) {
        return Ok(());
    }
    tracing::warn!("connect refused: caller session is {session:?}, not the local console");
    let message = if session == CallerSession::Remote {
        "Connect is not allowed from a Remote Desktop session because protection would block this \
         remote connection; connect from the local console"
    } else {
        "Connect is not allowed because this Windows session could not be confirmed as the local \
         console, and protection would block a remote connection; connect from the local console"
    };
    Err(crate::core::auth::ServiceError::remote_session_connect_refused(message))
}

/// The current `WTSClientProtocolType` of Windows session `session_id` (0 = console; 1 = legacy
/// ICA and 2 = RDP are both remote). Read at the gate, not at authentication, so a console session
/// taken over by Remote Desktop while the request waited is seen as remote. Any failure, including
/// a peer whose session was never read, answers `Unknown`.
#[cfg(all(windows, not(feature = "test")))]
fn caller_session(session_id: Option<u32>) -> CallerSession {
    use windows_sys::Win32::System::RemoteDesktop::{
        WTS_CURRENT_SERVER_HANDLE, WTSClientProtocolType, WTSFreeMemory,
        WTSQuerySessionInformationW,
    };

    let Some(session_id) = session_id else {
        return CallerSession::Unknown;
    };
    let mut buffer: windows_sys::core::PWSTR = std::ptr::null_mut();
    let mut returned = 0_u32;
    if unsafe {
        WTSQuerySessionInformationW(
            WTS_CURRENT_SERVER_HANDLE,
            session_id,
            WTSClientProtocolType,
            &mut buffer,
            &mut returned,
        )
    } == 0
        || buffer.is_null()
    {
        return CallerSession::Unknown;
    }
    // A USHORT; read unaligned because the buffer is typed as a wide string.
    let protocol = (returned as usize >= std::mem::size_of::<u16>())
        .then(|| unsafe { buffer.read_unaligned() });
    unsafe { WTSFreeMemory(buffer.cast()) };
    match protocol {
        Some(0) => CallerSession::Console,
        Some(_) => CallerSession::Remote,
        None => CallerSession::Unknown,
    }
}

/// Off Windows and in the lifecycle `test` build there is no WTS: every caller is on the console,
/// so the gate never changes those builds' behavior.
#[cfg(not(all(windows, not(feature = "test"))))]
fn caller_session(_session_id: Option<u32>) -> CallerSession {
    CallerSession::Console
}

/// True unless every Windows session a user can be signed in to was inspected and none belongs to
/// the user whose owner key is `owner_key`. Only sessions in the Active, Connected or
/// Disconnected state can hold a signed-in user; listener, idle, reset, down and init sessions
/// are skipped, so a Remote Desktop listener cannot keep a takeover refused forever. Within
/// those sessions, only an explicit "no user" (`ERROR_NO_TOKEN`) or "session gone"
/// (`ERROR_CTX_WINSTATION_NOT_FOUND`) counts as not signed in; any other failure, and any
/// failure to enumerate, answers true: not knowing must keep the other user's protection in
/// place.
#[cfg(all(windows, not(feature = "test")))]
fn owner_signed_in(owner_key: &str) -> bool {
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        ERROR_CTX_WINSTATION_NOT_FOUND, ERROR_NO_TOKEN, GetLastError, LocalFree,
    };
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_USER, TokenUser};
    use windows_sys::Win32::System::RemoteDesktop::{
        WTS_CURRENT_SERVER_HANDLE, WTS_SESSION_INFOW, WTSActive, WTSConnected, WTSDisconnected,
        WTSEnumerateSessionsW, WTSFreeMemory, WTSQueryUserToken,
    };

    fn session_user_key(token: &OwnedHandle) -> Option<String> {
        let mut required = 0_u32;
        unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                std::ptr::null_mut(),
                0,
                &mut required,
            )
        };
        if required == 0 {
            return None;
        }
        let words = (required as usize).div_ceil(std::mem::size_of::<usize>());
        let mut buffer = vec![0_usize; words];
        if unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                buffer.as_mut_ptr().cast(),
                required,
                &mut required,
            )
        } == 0
        {
            return None;
        }
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        let mut text = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 || text.is_null() {
            return None;
        }
        let length = (0..)
            .take_while(|index| unsafe { *text.add(*index) } != 0)
            .count();
        let sid = String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) });
        unsafe { LocalFree(text.cast()) };
        Some(crate::core::structure::owner_key(
            &crate::OwnerIdentity::Windows { sid: sid.ok()? },
        ))
    }

    let mut sessions: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
    let mut count = 0_u32;
    if unsafe { WTSEnumerateSessionsW(WTS_CURRENT_SERVER_HANDLE, 0, 1, &mut sessions, &mut count) }
        == 0
    {
        tracing::warn!("logon sessions could not be enumerated; treating the owner as signed in");
        return true;
    }
    let listed = unsafe { std::slice::from_raw_parts(sessions, count as usize) }
        .iter()
        .filter(|session| matches!(session.State, WTSActive | WTSConnected | WTSDisconnected))
        .map(|session| session.SessionId)
        .collect::<Vec<_>>();
    unsafe { WTSFreeMemory(sessions.cast()) };
    for session_id in listed {
        let mut token = std::ptr::null_mut();
        if unsafe { WTSQueryUserToken(session_id, &mut token) } == 0 {
            if matches!(
                unsafe { GetLastError() },
                ERROR_NO_TOKEN | ERROR_CTX_WINSTATION_NOT_FOUND
            ) {
                // No user on this session (e.g. an empty logon screen), or it ended after the
                // enumeration.
                continue;
            }
            tracing::warn!(
                "session {session_id} user could not be read; treating the owner as signed in"
            );
            return true;
        }
        let token = unsafe { OwnedHandle::from_raw_handle(token) };
        match session_user_key(&token) {
            Some(key) if key == owner_key => return true,
            Some(_) => {}
            None => return true,
        }
    }
    false
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn owner_signed_in(_owner_key: &str) -> bool {
    #[cfg(test)]
    {
        !TEST_OWNER_SIGNED_OUT.load(Ordering::Relaxed)
    }
    #[cfg(not(test))]
    {
        true
    }
}

async fn resolve_luid(name: &str) -> Result<u64> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        let name = name.to_owned();
        engine_call("tunnel LUID lookup", move || {
            crate::core::wfp::luid_for_interface(&name)
        })
        .await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let _ = name;
        Ok(0)
    }
}

/// Re-resolve the recorded tunnel alias and prove that Windows still maps it to the LUID locked
/// for this Core. Same-PID Mihomo hot reload can recreate WinTUN without changing Core identity;
/// a cached LUID must never keep either the tunnel grant or physical DIRECT grants alive then.
async fn prove_current_tunnel_luid(armed: &Armed) -> Result<()> {
    let recorded = armed
        .tun_luid
        .context("DIRECT transaction has no recorded tunnel LUID")?;
    let current = resolve_luid(&armed.intent.tunnel_interface)
        .await
        .context("cannot re-resolve the DIRECT transaction tunnel interface")?;
    if current != recorded {
        bail!(
            "DIRECT transaction tunnel LUID changed from {recorded} to {current}; a fresh lock is required"
        );
    }
    Ok(())
}

/// Second phase: permit the tunnel interface (by LUID) and retract the bootstrap API
/// channel. Runs only once the WinTUN adapter exists — until then tunnel traffic is blocked
/// too (fail-closed).
///
/// The interface name is NOT negotiable: it must equal the one recorded at arm time. A
/// client-supplied name like "Ethernet" would otherwise install a weight-8 permit for a
/// physical adapter — a fail-open primitive for every process on the machine. Rejecting a
/// mismatch has zero side effects; it guards against client bugs and same-user process abuse.
///
/// The grant is recorded against the core instance running when it is made: a LUID names an
/// adapter that belongs to that core, and [`tunnel_permit_luid`] retracts the permit the moment
/// that core is replaced or gone. Locking again — the app's job — is what re-grants it.
pub(crate) async fn lock(tunnel_interface: Option<&str>) -> Result<()> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let result = lock_unlocked(tunnel_interface).await;
    let Err(error) = result else {
        return Ok(());
    };

    // A failed lock must never leave a previously committed physical escape set behind. `ARMED`
    // always tracks the last WFP set that may be live: `lock_unlocked` publishes its candidate
    // immediately after a successful transaction, while a failed transaction leaves the prior
    // state untouched. This therefore retracts the right endpoint set for validation, Core/TUN
    // races, install, persistence, and publication failures alike.
    let Some(possibly_live) = armed_guard().clone() else {
        return Err(error);
    };
    if !direct_state_may_be_live(&possibly_live) {
        return Err(error);
    }
    let current_core = current_core_instance_for_direct_security();
    match transition_direct_to_blocked_unlocked(possibly_live, current_core, None).await {
        Ok(()) => {
            let error = error.context(
                "tunnel lock failed; exact DIRECT permits were retracted and traffic is Blocked",
            );
            *last_error_guard() = Some(format!("{error:#}"));
            Err(error)
        }
        Err(retraction) => {
            let endpoints_may_remain_live =
                armed_guard().as_ref().is_some_and(direct_state_may_be_live);
            let message = if endpoints_may_remain_live {
                format!(
                    "tunnel lock failed ({error:#}); exact DIRECT Blocked reconciliation also \
                     failed ({retraction:#}); the possibly-live endpoint set remains published \
                     with an expired lease for watchdog retry"
                )
            } else {
                format!(
                    "tunnel lock failed ({error:#}); live WFP was narrowed and Blocked was \
                     published, but durable Blocked persistence failed ({retraction:#})"
                )
            };
            *last_error_guard() = Some(message.clone());
            bail!(message)
        }
    }
}

/// Perform the tunnel lock while [`WFP_OPERATION`] is held. Once an install succeeds, publish its
/// candidate immediately so every later error can reconcile the set that may actually be live.
async fn lock_unlocked(tunnel_interface: Option<&str>) -> Result<()> {
    if DIRECT_EXPIRY_RETIREMENT_PENDING.load(Ordering::Acquire) {
        bail!("expired DIRECT session is retiring Core; a fresh Connect is required");
    }
    // Same poison contract as every other mutation: a prior panic while `ARMED` was held must
    // not make the next tunnel lock panic the IPC task. `mark_verified` is the sibling path.
    let mut armed = armed_guard()
        .clone()
        .context("kill switch is not armed")?;
    let recorded = armed.intent.tunnel_interface.clone();
    if recorded.is_empty() {
        bail!("armed kill switch has no tunnel interface");
    }
    if let Some(supplied) = tunnel_interface
        .map(str::trim)
        .filter(|supplied| !supplied.is_empty())
        && supplied != recorded
    {
        bail!(
            "lock interface {supplied:?} does not match the interface recorded at arm time {recorded:?}"
        );
    }
    // Read the authoritative core identity *before* resolving the LUID: a core replaced in between makes the
    // recorded instance stale rather than falsely current, so the next render retracts the
    // permit instead of handing it to an adapter the new core did not create.
    //
    // Read it exactly **once**. This value is both persisted into `armed.core_instance` and
    // handed to the render below; a second read for the render could disagree with it (the
    // snapshot behind `current_core_instance` falls back to a cache while the core manager is
    // busy), and a disagreement here is terminal — see `rule_config_rendering`.
    let core_instance = current_core_instance_authoritative()
        .await
        .context("cannot lock a tunnel without a running core")?;
    let luid = resolve_luid(&recorded).await?;
    armed.tun_luid = Some(luid);
    armed.core_instance = Some(core_instance);
    armed.intent.mode = KillSwitchStatusMode::Locked;
    armed.intent.updated_at = now_unix();

    // Retain a same-Core reload bracket or endpoint set only if its complete Service-owned proof
    // is still valid for the newly resolved adapter. A recycled PID, expired heartbeat, missing
    // lease, or same-PID WinTUN recreation becomes full-tunnel-only before any render.
    if direct_reload_invalidation_reason(
        &armed,
        Some(core_instance),
        Some(luid),
        std::time::Instant::now(),
    )
    .is_some()
    {
        armed.direct_endpoints.clear();
        armed.reviewed_direct_ports.clear();
        armed.direct_reload = None;
    }

    if current_core_instance_authoritative().await != Some(core_instance) {
        bail!("core changed before tunnel lock install; a fresh lock is required");
    }
    let encoded = serde_json::to_vec_pretty(&armed.intent)?;
    // Update live WFP first (the macOS helper's add_tunnel ordering): if this fails, the
    // previous bootstrap rules remain effective and the persisted intent restores them after
    // a crash. Rendered from the same `core_instance` that was just recorded, never a re-read.
    install_unlocked_for(&armed, Some(core_instance)).await?;
    // The transaction succeeded, so this is now the conservative description of what may be
    // live. Publishing before the post-install proofs closes the old memory/live divergence on
    // persistence and Core/TUN race failures.
    *armed_guard() = Some(armed.clone());

    let core_after = current_core_instance_authoritative().await;
    let luid_after = if core_after == Some(core_instance) {
        resolve_luid(&recorded).await
    } else {
        Err(anyhow::anyhow!("Core identity changed during tunnel lock"))
    };
    let post_install_failure = match luid_after {
        Ok(current_luid) if current_luid != luid => Some(format!(
            "tunnel LUID changed from {luid} to {current_luid} during tunnel lock"
        )),
        Err(error) => Some(format!(
            "cannot prove the tunnel LUID after tunnel lock install: {error:#}"
        )),
        Ok(current_luid) => direct_reload_invalidation_reason(
            &armed,
            core_after,
            Some(current_luid),
            std::time::Instant::now(),
        )
        .map(str::to_owned),
    };
    if let Some(reason) = post_install_failure {
        transition_direct_to_blocked_unlocked(armed, core_after, None)
            .await
            .with_context(|| {
                format!("{reason}; exact Blocked reconciliation after tunnel lock install failed")
            })?;
        bail!("{reason}; traffic remains blocked until a fresh lock");
    }
    atomic_write(&intent_path(), &encoded)
        .await
        .context("locked tunnel intent could not be persisted")?;
    *last_error_guard() = None;
    Ok(())
}

fn canonical_direct_endpoints(
    armed: &Armed,
    endpoints: &[ProxyEndpoint],
) -> Result<Vec<ProxyEndpoint>> {
    let validation = KillSwitchConfig {
        tunnel_interface: armed.intent.tunnel_interface.clone(),
        proxy_endpoints: armed.intent.endpoints.clone(),
        bootstrap_api_hosts: Vec::new(),
        direct_endpoints: endpoints.to_vec(),
    };
    validate_direct_endpoints(&validation)?;
    crate::canonical_direct_endpoints(endpoints).map_err(anyhow::Error::msg)
}

fn reload_result(
    owner_generation: u64,
    reload_id: u64,
    endpoints: &[ProxyEndpoint],
) -> Result<crate::DirectRuntimeReloadResult> {
    Ok(crate::DirectRuntimeReloadResult {
        owner_generation,
        reload_id,
        endpoint_digest: crate::direct_endpoint_digest(endpoints).map_err(anyhow::Error::msg)?,
    })
}

fn next_direct_reload_id() -> u64 {
    loop {
        let id = NEXT_DIRECT_RELOAD_ID.fetch_add(1, Ordering::Relaxed);
        if id != 0 {
            return id;
        }
    }
}

fn direct_reload_matches(
    armed: &Armed,
    owner_generation: u64,
    reload_id: u64,
) -> Result<DirectReloadLease> {
    let lease = armed
        .direct_reload
        .clone()
        .context("no DIRECT runtime reload bracket is active")?;
    if lease.owner_generation != owner_generation || lease.reload_id != reload_id {
        bail!("DIRECT runtime reload bracket is stale");
    }
    Ok(lease)
}

#[derive(Debug, thiserror::Error)]
#[error("live WFP is Blocked but the DIRECT intent could not be persisted")]
struct DirectBlockedIntentPersistenceFailure;

/// Reconcile to exact Blocked without publishing a state stricter than live WFP proved.
///
/// The Blocked intent is attempted first so a Service restart cannot revive volatile DIRECT
/// grants. The in-memory state is committed only after the WFP transaction succeeds. If BFE is
/// unavailable, the prior endpoint set remains published (because it may still be live), `live`
/// is false, and its invalid/expired lease makes the watchdog retry this exact narrowing on every
/// tick. This avoids the dangerous split-brain state "memory says empty while WFP still permits".
async fn transition_direct_to_blocked_unlocked(
    armed: Armed,
    current_core: Option<CoreInstance>,
    next_lease: Option<DirectReloadLease>,
) -> Result<()> {
    let mut retry_state = armed.clone();
    let mut blocked = armed;
    // Protected Offline's recovery channel must include addresses learned
    // after StartClash. The HTTP client already pins them; without this
    // union WFP would still only permit the connect-time set.
    apply_learned_bootstrap_pins(&mut blocked.intent);
    blocked.direct_endpoints.clear();
    blocked.direct_reload = next_lease;
    blocked.tun_luid = None;
    blocked.core_instance = None;
    blocked.intent.mode = KillSwitchStatusMode::Blocked;
    blocked.intent.updated_at = now_unix();

    // DIRECT grants are volatile and never restored from the intent file, so narrowing live WFP
    // first is crash-safe: an older Locked intent also restores as exact Blocked. More
    // importantly, a damaged state directory must not delay the attempt to retract physical
    // permits. Serialization is captured separately for the same reason — both proofs are always
    // attempted.
    let encoded = serde_json::to_vec_pretty(&blocked.intent);
    let install = install_unlocked_for(&blocked, current_core).await;
    let persist = match encoded {
        Ok(encoded) => atomic_write(&intent_path(), &encoded).await,
        Err(error) => Err(error.into()),
    };
    if install.is_ok() {
        *armed_guard() = Some(blocked);
    } else {
        // Keep publishing the endpoint set that may still be live, but poison its lease so the
        // watchdog cannot treat the old committed deadline as authorization to retain it.
        if let Some(lease) = retry_state.direct_reload.as_mut() {
            lease.expires_at = Some(std::time::Instant::now());
        }
        *armed_guard() = Some(retry_state);
        note_verify(false);
    }
    match (install, persist) {
        (Ok(()), Ok(())) => {
            *last_error_guard() = None;
            Ok(())
        }
        (Err(error), Ok(())) => {
            *last_error_guard() = Some(format!("{error:#}"));
            Err(error
                .context("DIRECT Blocked intent was persisted but live WFP narrowing failed; prior permits remain published until retry"))
        }
        (Ok(()), Err(error)) => {
            *last_error_guard() = Some(format!("{error:#}"));
            Err(error.context(DirectBlockedIntentPersistenceFailure))
        }
        (Err(install), Err(persist)) => {
            let message = format!(
                "DIRECT transition could not prove live Blocked WFP ({install:#}) or persist Blocked intent ({persist:#})"
            );
            *last_error_guard() = Some(message.clone());
            bail!(message)
        }
    }
}

fn direct_state_may_be_live(armed: &Armed) -> bool {
    !armed.direct_endpoints.is_empty() || armed.direct_reload.is_some()
}

/// The connected sing-box session is a locked tunnel with no physical DIRECT set.
pub(crate) fn sing_box_full_tunnel_is_locked() -> Result<()> {
    ensure_supported()?;
    let armed = armed_guard().clone().context("kill switch is not armed")?;
    if armed.intent.mode != KillSwitchStatusMode::Locked {
        bail!("sing-box replacement requires a locked tunnel");
    }
    if let Some(lease) = &armed.direct_reload
        && lease.phase != DirectReloadPhase::Committed
    {
        bail!("sing-box replacement will not interrupt an in-progress DIRECT bracket");
    }
    Ok(())
}

/// Install reviewed-app permits without opening the mihomo bracket.
///
/// The lease starts Committed so the watchdog treats it as a heartbeat, not as
/// a bracket that expires into Blocked. A failed install puts the previous
/// full-tunnel set back. If that cannot be proved, the caller stops Core and
/// releases general traffic while the AI hold stays. This function does not
/// call [`transition_direct_to_blocked_unlocked`].
pub(crate) async fn commit_sing_box_direct_while_locked(
    endpoints: &[ProxyEndpoint],
    reviewed_ports: &[u16],
    owner_generation: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let failed = {
        let _operation = WFP_OPERATION.lock().await;
        match commit_sing_box_direct_unlocked(endpoints, reviewed_ports, owner_generation).await {
            Ok(result) => return Ok(result),
            Err(error) => error,
        }
    };
    if format!("{failed:#}").contains("general traffic was released") {
        // TUN auto_route would keep capturing packets after WFP is gone.
        let _ = crate::core::manager::CORE_MANAGER.lock().await.stop_core().await;
    }
    Err(failed)
}

async fn commit_sing_box_direct_unlocked(
    endpoints: &[ProxyEndpoint],
    reviewed_ports: &[u16],
    owner_generation: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    let previous = armed_guard().clone().context("kill switch is not armed")?;
    if previous.intent.mode != KillSwitchStatusMode::Locked
        || !previous.direct_endpoints.is_empty()
        || previous.direct_reload.is_some()
    {
        bail!("sing-box DIRECT permits require a locked full tunnel");
    }
    let core = current_core_instance_authoritative()
        .await
        .context("sing-box DIRECT permits have no running core")?;
    if tunnel_permit_luid(&previous, Some(core)).is_none() {
        bail!("sing-box DIRECT permits require the current core's tunnel grant");
    }
    prove_current_tunnel_luid(&previous).await.context(
        "sing-box DIRECT permits lost the locked tunnel; the full tunnel was left in place",
    )?;
    let canonical = canonical_direct_endpoints(&previous, endpoints)?;
    let endpoint_digest = crate::direct_endpoint_digest(&canonical).map_err(anyhow::Error::msg)?;
    let reload_id = next_direct_reload_id();
    let tunnel_luid = previous
        .tun_luid
        .context("locked sing-box tunnel has no LUID")?;
    let mut candidate = previous.clone();
    candidate.direct_endpoints = canonical.clone();
    candidate.reviewed_direct_ports = reviewed_ports
        .iter()
        .copied()
        .filter(|port| crate::REVIEWED_DIRECT_PORTS.contains(port))
        .collect();
    candidate.reviewed_direct_ports.sort_unstable();
    candidate.reviewed_direct_ports.dedup();
    candidate.intent.mode = KillSwitchStatusMode::Locked;
    candidate.direct_reload = Some(DirectReloadLease {
        owner_generation,
        reload_id,
        phase: DirectReloadPhase::Committed,
        endpoint_digest,
        core_instance: Some(core),
        tunnel_luid: Some(tunnel_luid),
        expires_at: Some(std::time::Instant::now() + DIRECT_COMMITTED_LEASE),
    });
    if let Err(error) = install_unlocked_for(&candidate, Some(core)).await {
        return restore_sing_box_full_tunnel(previous, core, error).await;
    }
    let core_after = current_core_instance_authoritative().await;
    if core_after != Some(core) {
        return restore_sing_box_full_tunnel(
            previous,
            core,
            anyhow::anyhow!("core changed during sing-box DIRECT permit install"),
        )
        .await;
    }
    if let Err(error) = prove_current_tunnel_luid(&candidate).await {
        return restore_sing_box_full_tunnel(previous, core, error).await;
    }
    *armed_guard() = Some(candidate);
    *last_error_guard() = None;
    reload_result(owner_generation, reload_id, &canonical)
}

async fn restore_sing_box_full_tunnel(
    full_tunnel: Armed,
    core: CoreInstance,
    error: anyhow::Error,
) -> Result<crate::DirectRuntimeReloadResult> {
    match install_unlocked_for(&full_tunnel, Some(core)).await {
        Ok(()) => {
            *armed_guard() = Some(full_tunnel);
            *last_error_guard() = Some(format!(
                "sing-box DIRECT permits were not installed; the full tunnel remains: {error:#}"
            ));
            Err(error.context(
                "sing-box DIRECT permits were not installed; the full tunnel remains",
            ))
        }
        Err(restore) => {
            // The WFP lock is already held. Disarm here; the caller stops Core
            // after this function returns the lock. Do not publish Blocked.
            if let Err(release) = disarm_unlocked(true).await {
                *last_error_guard() = Some(format!(
                    "sing-box DIRECT permit install failed ({error:#}); full tunnel restore failed ({restore:#}); release failed ({release:#})"
                ));
                return Err(release.context(
                    "sing-box DIRECT permits failed and the full tunnel could not be restored or released",
                ));
            }
            *last_error_guard() = Some(format!(
                "sing-box DIRECT permit install failed ({error:#}); full tunnel restore failed ({restore:#}); general traffic was released and AI destinations stay blocked"
            ));
            Err(error.context(
                "sing-box full tunnel could not be restored; general traffic was released and AI destinations stay blocked",
            ))
        }
    }
}

/// Retract every tunnel/DIRECT grant before a TUN-affecting core reload. Every invocation creates
/// a fresh volatile id, so an ambiguous replay invalidates delayed endpoint requests from the
/// previous invocation rather than accidentally authorizing them in the new bracket.
pub(crate) async fn begin_direct_runtime_reload(
    owner_generation: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let previous = armed_guard().clone().context("kill switch is not armed")?;
    if !matches!(
        previous.intent.mode,
        KillSwitchStatusMode::Locked | KillSwitchStatusMode::Blocked
    ) {
        bail!("DIRECT runtime reload requires a locked kill switch");
    }
    let current_core = current_core_instance_authoritative().await;
    let reload_id = next_direct_reload_id();
    let empty_digest = crate::direct_endpoint_digest(&[]).map_err(anyhow::Error::msg)?;
    let lease = DirectReloadLease {
        owner_generation,
        reload_id,
        phase: DirectReloadPhase::Bracket,
        endpoint_digest: empty_digest,
        core_instance: current_core,
        tunnel_luid: None,
        expires_at: Some(std::time::Instant::now() + DIRECT_BRACKET_LEASE),
    };
    transition_direct_to_blocked_unlocked(previous, current_core, Some(lease)).await?;
    reload_result(owner_generation, reload_id, &[])
}

/// Install the complete volatile DIRECT set as a short Service-owned pending lease. The caller
/// must finalize after its post-install proofs; App death, Core change, or lease expiry retracts
/// the permits and moves the machine to exact Blocked.
pub(crate) async fn replace_direct_endpoints(
    endpoints: &[ProxyEndpoint],
    reviewed_ports: &[u16],
    owner_generation: u64,
    reload_id: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let previous = armed_guard().clone().context("kill switch is not armed")?;
    let current_core = current_core_instance_authoritative().await;
    let lease = match direct_reload_matches(&previous, owner_generation, reload_id) {
        Ok(lease) => lease,
        Err(error) => {
            transition_direct_to_blocked_unlocked(previous, current_core, None)
                .await
                .context("stale DIRECT replacement could not be reconciled to Blocked")?;
            return Err(error.context("DIRECT replacement was rejected; traffic is Blocked"));
        }
    };
    let canonical = match canonical_direct_endpoints(&previous, endpoints) {
        Ok(canonical) => canonical,
        Err(error) => {
            transition_direct_to_blocked_unlocked(previous, current_core, None)
                .await
                .context("invalid DIRECT endpoint set could not be reconciled to Blocked")?;
            return Err(error.context("DIRECT endpoint validation failed; traffic is Blocked"));
        }
    };
    let endpoint_digest = crate::direct_endpoint_digest(&canonical).map_err(anyhow::Error::msg)?;
    if previous.intent.mode != KillSwitchStatusMode::Locked
        || tunnel_permit_luid(&previous, current_core).is_none()
    {
        transition_direct_to_blocked_unlocked(previous, current_core, None)
            .await
            .context("invalid DIRECT replacement state could not be reconciled to Blocked")?;
        bail!(
            "replacing DIRECT endpoints requires a locked tunnel grant owned by the current core"
        );
    }
    let core = current_core.context("DIRECT endpoint replacement has no running Core")?;
    if lease.core_instance != Some(core) {
        transition_direct_to_blocked_unlocked(previous, Some(core), None)
            .await
            .context("stale DIRECT Core bracket could not be reconciled to Blocked")?;
        bail!("Core identity changed after the DIRECT reload bracket opened");
    }

    if lease
        .expires_at
        .is_some_and(|deadline| std::time::Instant::now() >= deadline)
    {
        let reconcile = transition_direct_to_blocked_unlocked(previous, Some(core), None).await;
        reconcile.context("expired DIRECT bracket could not be reconciled to Blocked")?;
        bail!("DIRECT runtime reload bracket expired");
    }
    if let Err(error) = prove_current_tunnel_luid(&previous).await {
        transition_direct_to_blocked_unlocked(previous, Some(core), None)
            .await
            .context("stale DIRECT tunnel LUID could not be reconciled to Blocked")?;
        return Err(error.context("DIRECT endpoint replacement lost its locked tunnel identity"));
    }
    if lease.phase != DirectReloadPhase::Bracket {
        let actual_digest = crate::direct_endpoint_digest(&previous.direct_endpoints)
            .map_err(anyhow::Error::msg)?;
        if lease.endpoint_digest != endpoint_digest || actual_digest != endpoint_digest {
            let reconcile = transition_direct_to_blocked_unlocked(previous, Some(core), None).await;
            reconcile.context("conflicting DIRECT replay could not be reconciled to Blocked")?;
            bail!("DIRECT endpoint replay did not match the pending/committed set");
        }
        // Lost-response replay after either pending install or finalization. Re-run exact install
        // and identity proof, but never extend the pending lease.
        if let Err(error) = install_unlocked_for(&previous, Some(core)).await {
            transition_direct_to_blocked_unlocked(previous, Some(core), None)
                .await
                .context("DIRECT replay failed and exact-permit retraction also failed")?;
            return Err(error.context("DIRECT replay failed; traffic is Blocked"));
        }
        let core_after = current_core_instance_authoritative().await;
        if core_after != Some(core) {
            transition_direct_to_blocked_unlocked(previous, core_after, None)
                .await
                .context("Core changed during DIRECT replay and Blocked reconciliation failed")?;
            bail!("Core changed during DIRECT endpoint replay");
        }
        if let Err(error) = prove_current_tunnel_luid(&previous).await {
            transition_direct_to_blocked_unlocked(previous, Some(core), None)
                .await
                .context("tunnel changed during DIRECT replay and Blocked reconciliation failed")?;
            return Err(error.context("tunnel identity changed during DIRECT endpoint replay"));
        }
        return reload_result(owner_generation, reload_id, &previous.direct_endpoints);
    }
    if !previous.direct_endpoints.is_empty()
        || lease.endpoint_digest
            != crate::direct_endpoint_digest(&[]).map_err(anyhow::Error::msg)?
    {
        transition_direct_to_blocked_unlocked(previous, Some(core), None)
            .await
            .context("non-empty DIRECT bracket could not be reconciled to Blocked")?;
        bail!("DIRECT bracket was not empty before endpoint installation");
    }

    let mut candidate = previous.clone();
    candidate.direct_endpoints = canonical.clone();
    // The App proposes; this keeps only what the Service itself sanctions, so a client asking
    // for port 22 gets nothing rather than an argument.
    candidate.reviewed_direct_ports = reviewed_ports
        .iter()
        .copied()
        .filter(|port| crate::REVIEWED_DIRECT_PORTS.contains(port))
        .collect();
    candidate.reviewed_direct_ports.sort_unstable();
    candidate.reviewed_direct_ports.dedup();
    let tunnel_luid = previous
        .tun_luid
        .context("locked DIRECT replacement lost its tunnel LUID")?;
    candidate.direct_reload = Some(DirectReloadLease {
        owner_generation,
        reload_id,
        phase: DirectReloadPhase::Pending,
        endpoint_digest: endpoint_digest.clone(),
        core_instance: Some(core),
        tunnel_luid: Some(tunnel_luid),
        expires_at: Some(std::time::Instant::now() + DIRECT_PENDING_LEASE),
    });
    if let Err(error) = install_unlocked_for(&candidate, Some(core)).await {
        // `install` may have committed before its exact verification failed, and a timed-out WFP
        // worker continues running after this caller receives an error. The candidate is therefore
        // the conservative possibly-live set, not the empty Bracket snapshot. If Blocked cannot be
        // proved immediately, publishing candidate with its poisoned Pending lease makes the
        // watchdog retry without ever claiming the physical permits are absent.
        transition_direct_to_blocked_unlocked(candidate, Some(core), None)
            .await
            .context("DIRECT install failed and exact-permit retraction also failed")?;
        return Err(error.context("DIRECT endpoint set was not installed; traffic is Blocked"));
    }
    let core_after = current_core_instance_authoritative().await;
    if core_after != Some(core) {
        transition_direct_to_blocked_unlocked(candidate, core_after, None)
            .await
            .context("Core changed during DIRECT install and exact-permit retraction failed")?;
        bail!("Core changed during DIRECT endpoint installation; traffic is Blocked");
    }
    if let Err(error) = prove_current_tunnel_luid(&candidate).await {
        transition_direct_to_blocked_unlocked(candidate, Some(core), None)
            .await
            .context("tunnel changed during DIRECT install and exact-permit retraction failed")?;
        return Err(error.context("tunnel identity changed during DIRECT endpoint installation"));
    }
    *armed_guard() = Some(candidate);
    *last_error_guard() = None;
    reload_result(owner_generation, reload_id, &canonical)
}

/// Commit a pending DIRECT lease only after the App proves the reloaded controller, WFP snapshot,
/// DNS, and ordinary tunnel data plane. Idempotent for a lost response from the same bracket.
pub(crate) async fn finalize_direct_runtime_reload(
    expected_digest: &str,
    owner_generation: u64,
    reload_id: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let mut armed = armed_guard().clone().context("kill switch is not armed")?;
    let lease = match direct_reload_matches(&armed, owner_generation, reload_id) {
        Ok(lease) => lease,
        Err(error) => {
            let current_core = current_core_instance_authoritative().await;
            transition_direct_to_blocked_unlocked(armed, current_core, None)
                .await
                .context("stale DIRECT finalize could not be reconciled to Blocked")?;
            return Err(error.context("DIRECT finalize was rejected; traffic is Blocked"));
        }
    };
    if lease.endpoint_digest != expected_digest {
        let current_core = current_core_instance_authoritative().await;
        transition_direct_to_blocked_unlocked(armed, current_core, None)
            .await
            .context("DIRECT finalize digest mismatch could not be reconciled to Blocked")?;
        bail!("DIRECT finalize digest did not match the Service pending set");
    }
    if lease.phase == DirectReloadPhase::Bracket {
        let current_core = current_core_instance_authoritative().await;
        transition_direct_to_blocked_unlocked(armed, current_core, None)
            .await
            .context("premature DIRECT finalize could not be reconciled to Blocked")?;
        bail!("DIRECT endpoints have not been installed for this bracket");
    }
    if lease
        .expires_at
        .is_none_or(|deadline| std::time::Instant::now() >= deadline)
    {
        let current_core = current_core_instance_authoritative().await;
        transition_direct_to_blocked_unlocked(armed, current_core, None)
            .await
            .context("expired pending DIRECT set could not be reconciled to Blocked")?;
        bail!("pending DIRECT endpoint lease expired");
    }

    let current_core = current_core_instance_authoritative().await;
    let Some(core) = current_core else {
        transition_direct_to_blocked_unlocked(armed, None, None)
            .await
            .context("missing finalize Core could not be reconciled to Blocked")?;
        bail!("DIRECT finalize has no running Core");
    };
    if armed.intent.mode != KillSwitchStatusMode::Locked
        || tunnel_permit_luid(&armed, Some(core)).is_none()
        || lease.core_instance != Some(core)
        || lease.tunnel_luid != armed.tun_luid
    {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("invalid DIRECT finalize state could not be reconciled to Blocked")?;
        bail!("DIRECT finalize lost its locked Core/TUN identity");
    }
    if let Err(error) = prove_current_tunnel_luid(&armed).await {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("stale finalize tunnel LUID could not be reconciled to Blocked")?;
        return Err(error.context("DIRECT finalize lost its current tunnel identity"));
    }
    let actual_digest =
        crate::direct_endpoint_digest(&armed.direct_endpoints).map_err(anyhow::Error::msg)?;
    if actual_digest != expected_digest {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("DIRECT finalize set mismatch could not be reconciled to Blocked")?;
        bail!("DIRECT finalize endpoint set did not match its receipt");
    }

    if let Err(error) = install_unlocked_for(&armed, Some(core)).await {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("DIRECT finalize proof failed and exact-permit retraction also failed")?;
        return Err(error.context("DIRECT finalize WFP proof failed; traffic is Blocked"));
    }
    let core_after = current_core_instance_authoritative().await;
    if core_after != Some(core) {
        transition_direct_to_blocked_unlocked(armed, core_after, None)
            .await
            .context("Core changed during DIRECT finalize and exact-permit retraction failed")?;
        bail!("Core changed during DIRECT finalize; traffic is Blocked");
    }
    if let Err(error) = prove_current_tunnel_luid(&armed).await {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context("tunnel changed during DIRECT finalize and exact-permit retraction failed")?;
        return Err(error.context("tunnel identity changed during DIRECT finalize"));
    }
    if lease
        .expires_at
        .is_none_or(|deadline| std::time::Instant::now() >= deadline)
    {
        transition_direct_to_blocked_unlocked(armed, Some(core), None)
            .await
            .context(
                "DIRECT lease expired during finalize and could not be reconciled to Blocked",
            )?;
        bail!("DIRECT endpoint lease expired during finalize; traffic is Blocked");
    }
    if lease.phase == DirectReloadPhase::Pending {
        armed.direct_reload = Some(DirectReloadLease {
            phase: DirectReloadPhase::Committed,
            expires_at: Some(std::time::Instant::now() + DIRECT_COMMITTED_LEASE),
            ..lease
        });
        *armed_guard() = Some(armed.clone());
    }
    *last_error_guard() = None;
    reload_result(owner_generation, reload_id, &armed.direct_endpoints)
}

/// Marker the App matches. A non-strict renewal failure must not say the machine is Blocked:
/// WFP is left as it was so the caller can release general traffic and keep AI destinations blocked.
pub(crate) const DIRECT_RENEW_FAILED_PREFIX: &str = "TONO_DIRECT_RENEW_FAILED";
/// An explicit strict kill switch is the one renewal failure that stays Blocked.
pub(crate) const DIRECT_RENEW_STRICT_BLOCKED_PREFIX: &str = "TONO_DIRECT_RENEW_STRICT_BLOCKED";

/// A lost committed DIRECT lease is a renewal failure. Non-strict sessions release general
/// traffic. An in-flight reload bracket and an explicit strict kill switch still narrow to Blocked.
fn committed_direct_lease_failure_releases(reason: &str, strict_kill_switch: bool) -> bool {
    !strict_kill_switch && reason.starts_with("committed DIRECT heartbeat lease expired")
}

/// Non-strict renewal failures do not install Blocked. The App's selective release is what
/// opens the original network and keeps the secondary AI hold. Strict mode still narrows.
async fn reject_direct_renewal_unlocked(
    armed: Armed,
    current_core: Option<CoreInstance>,
    detail: &str,
) -> anyhow::Error {
    if !armed.intent.strict_kill_switch {
        return anyhow::anyhow!(
            "{DIRECT_RENEW_FAILED_PREFIX}: {detail}; WFP was left unchanged so general traffic can be released while AI-service destinations stay blocked"
        );
    }
    match transition_direct_to_blocked_unlocked(armed, current_core, None).await {
        Ok(()) => anyhow::anyhow!(
            "{DIRECT_RENEW_STRICT_BLOCKED_PREFIX}: {detail}; strict kill switch kept traffic Blocked"
        ),
        Err(error) => error.context(format!(
            "{DIRECT_RENEW_STRICT_BLOCKED_PREFIX}: {detail}; strict Blocked reconciliation failed"
        )),
    }
}

/// Extend a committed DIRECT lease only for the authenticated owner session and the exact
/// Core/TUN/endpoint proof finalized by that session. This performs no widening WFP mutation: it
/// merely moves the Service-owned deadline after every identity check passes. A malformed,
/// stale, expired, or mismatched heartbeat does not cut the network: unless the armed record
/// has an explicit strict kill switch, WFP is left unchanged and the caller selective-releases.
pub(crate) async fn renew_direct_runtime_reload(
    expected_digest: &str,
    owner_generation: u64,
    reload_id: u64,
) -> Result<crate::DirectRuntimeReloadResult> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let mut armed = armed_guard().clone().context("kill switch is not armed")?;
    let current_core = current_core_instance_authoritative().await;
    let lease = match direct_reload_matches(&armed, owner_generation, reload_id) {
        Ok(lease) => lease,
        Err(error) => {
            return Err(reject_direct_renewal_unlocked(
                armed,
                current_core,
                &format!("{error:#}"),
            )
            .await);
        }
    };

    let now = std::time::Instant::now();
    let actual_digest =
        crate::direct_endpoint_digest(&armed.direct_endpoints).map_err(anyhow::Error::msg)?;
    let identity_valid = lease.phase == DirectReloadPhase::Committed
        && lease.endpoint_digest == expected_digest
        && actual_digest == expected_digest
        && lease.expires_at.is_some_and(|deadline| now < deadline)
        && armed.intent.mode == KillSwitchStatusMode::Locked
        && tunnel_permit_luid(&armed, current_core).is_some()
        && lease.core_instance == current_core
        && lease.tunnel_luid.is_some()
        && lease.tunnel_luid == armed.tun_luid;
    if !identity_valid {
        return Err(reject_direct_renewal_unlocked(
            armed,
            current_core,
            "DIRECT renewal proof was stale, expired, or mismatched",
        )
        .await);
    }
    if let Err(error) = prove_current_tunnel_luid(&armed).await {
        return Err(reject_direct_renewal_unlocked(
            armed,
            current_core,
            &format!("DIRECT renewal lost its tunnel identity: {error:#}"),
        )
        .await);
    }

    let core_after = current_core_instance_authoritative().await;
    let final_now = std::time::Instant::now();
    if core_after != current_core
        || lease
            .expires_at
            .is_none_or(|deadline| final_now >= deadline)
    {
        return Err(reject_direct_renewal_unlocked(
            armed,
            core_after,
            "DIRECT renewal expired or changed Core identity while being proven",
        )
        .await);
    }

    let mut renewed = lease;
    renewed.expires_at = Some(final_now + DIRECT_COMMITTED_LEASE);
    armed.direct_reload = Some(renewed);
    *armed_guard() = Some(armed.clone());
    *last_error_guard() = None;
    reload_result(owner_generation, reload_id, &armed.direct_endpoints)
}

/// Synchronous security barrier for every Core stop or replacement. An ALE App-ID permit names a
/// binary path, not a PID/generation, so a newly spawned Mihomo at that same path could inherit an
/// old DIRECT tuple. Packed identity revocation happens *inside* the WFP writer lock: a widening
/// that entered first must finish before this exact Blocked transaction, while one queued behind
/// it observes `None` and cannot authorize anything. The manager calls this before terminating an
/// ordinary Core and, after a crash, before every respawn attempt. Failure must prevent launch.
pub(crate) async fn retract_direct_before_core_replacement() -> Result<()> {
    if !SUPPORTED {
        crate::core::manager::revoke_core_security_identity_under_wfp_barrier();
        return Ok(());
    }
    let _operation = WFP_OPERATION.lock().await;
    crate::core::manager::revoke_core_security_identity_under_wfp_barrier();
    let Some(armed) = armed_guard().clone() else {
        return Ok(());
    };
    // Even an empty volatile receipt is not proof that live WFP is empty: session filters survive
    // a Service-process restart while BFE remains running, and startup's first exact install may
    // have failed. Always overwrite the provider set before allowing the same App-ID path to run.
    match transition_direct_to_blocked_unlocked(armed, None, None).await {
        // Volatile DIRECT grants cannot be restored by an older intent. Once live WFP is
        // exact Blocked, a full disk or state-directory ACL must not prevent Disconnect.
        Err(error) if error.is::<DirectBlockedIntentPersistenceFailure>() => {
            tracing::warn!(
                "wfp: exact Blocked WFP was proved before replacing Core; continuing despite intent persistence failure: {error:#}"
            );
            Ok(())
        }
        result => result.context(
            "could not prove exact Blocked WFP before replacing Core; replacement is refused",
        ),
    }
}

/// Disconnected-but-armed ("Protected Offline"): floor + endpoint/DNS rules stay, the API
/// recovery channel re-opens, the tunnel permit is gone.
async fn restrict_bootstrap_unlocked() -> Result<()> {
    let armed = armed_guard().clone().context("kill switch is not armed")?;
    let current_core = current_core_instance().await;
    transition_direct_to_blocked_unlocked(armed, current_core, None).await
}

pub(crate) async fn restrict_bootstrap() -> Result<()> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    restrict_bootstrap_unlocked().await
}

/// Bound a cross-module DNS await taken while `WFP_OPERATION` is held.
///
/// `dns::ensure_restored` / `dns::restore_protected` are the only awaits on the WFP writer path
/// that leave this module, and the operation lock is held across them. Without a bound here a
/// stalled DNS engine holds `WFP_OPERATION` forever, so *every* WFP operation — arm, lock,
/// restrict, verify, release, emergency disarm — queues behind it and the machine stays
/// fail-closed with no way to open it short of a reboot. `dns.rs` bounds itself as well; this is
/// the defensive half, because the liveness of this module's writer lock must not depend on
/// another module's discipline.
///
/// The bound may only convert an infinite hang into a clean failure; it is never a way to skip
/// the DNS proof. Callers treat the timeout exactly like any other unprovable restore, so on the
/// disarm/release path the filters stay installed and the barrier stays armed — a timeout can
/// never open the network while DNS may still point at a dead loopback resolver. Cancelling the
/// restore (the timeout drops the future) leaves the snapshot in place, because
/// `restore_protected` deletes it only *after* the restore is proven. The abandoned registry
/// write keeps its own self-write window until that write returns, so the notification is not
/// published as a network change.
async fn bounded_dns_call<T>(
    operation: &str,
    call: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    bounded_dns_call_within(DNS_RESTORE_TIMEOUT, operation, call).await
}

/// The budget is a parameter for the same reason `bounded_engine_call` takes one: the ownership
/// and refusal rules are what matter and they must stay unit-testable without waiting out the
/// production budget.
async fn bounded_dns_call_within<T>(
    budget: std::time::Duration,
    operation: &str,
    call: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    match tokio::time::timeout(budget, call).await {
        Ok(result) => result,
        Err(_) => {
            tracing::error!(
                "dns: restore did not return within {budget:?} during {operation} while the WFP \
                 operation lock was held; the attempt is dropped so the lock is released, and \
                 {operation} is refused"
            );
            bail!(
                "{DNS_RESTORE_STALLED_PREFIX}: DNS restore did not answer within {budget:?} \
                 during {operation}, so it could not be proven. Protection stays in its last \
                 known state; retry once the resolver settles."
            )
        }
    }
}

#[cfg(test)]
static TEST_INTERRUPT_RELEASE_FOLLOW_UP: AtomicBool = AtomicBool::new(false);

async fn finish_release_follow_up(apply_narrow: bool) {
    #[cfg(test)]
    if TEST_INTERRUPT_RELEASE_FOLLOW_UP.swap(false, Ordering::SeqCst) {
        // Model process death at the durable boundary, before native selective work starts.
        return;
    }
    crate::core::selective_layer::finish_release(apply_narrow).await;
}

/// Normal release — only on explicit user request. See the DNS-before-disarm invariant.
async fn disarm_unlocked(apply_narrow: bool) -> Result<()> {
    disarm_unlocked_with_narrow(Some(apply_narrow)).await
}

/// `None` preserves the existing AI disposition during an already-idle Service stop.
async fn disarm_unlocked_with_narrow(apply_narrow: Option<bool>) -> Result<()> {
    let tombstone = release_tombstone(apply_narrow).await;
    let previous = armed_guard().clone();
    let Some(previous) = previous else {
        // Not armed: still sweep possible residuals so a half-failed earlier run cannot
        // linger. Persist the explicit-release tombstone *after* proving the sweep so a Service
        // replacement cannot reinterpret late-visible persistent filters as a wanted session.
        remove_all_filters_unlocked().await?;
        // Idle Stop has no new disposition: keep existing bytes, including corrupt evidence
        // that startup needs to resume its automatic AI hold. Synthesize only if absent.
        if apply_narrow.is_some()
            || matches!(tokio::fs::try_exists(intent_path()).await, Ok(false))
        {
            atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await?;
        }
        // A leftover DNS snapshot must not be skipped just because nothing is armed: the
        // filters are already gone, so refusing would buy no blocking — but the resolver
        // must not stay on a dead loopback. Best-effort, surfaced via last_error.
        if let Err(error) = bounded_dns_call(
            "release without an armed switch",
            crate::core::dns::ensure_restored(),
        )
        .await
        {
            *last_error_guard() = Some(format!(
                "leftover DNS snapshot could not be restored: {error:#}"
            ));
        }
        // Filters are already gone. The secondary layer must not be able to
        // fail this release or put a general block back.
        if let Some(apply_narrow) = apply_narrow {
            finish_release_follow_up(apply_narrow).await;
        }
        clear_wanted_core_window();
        // This successful release supersedes any older crash-record retry.
        CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
        RECONNECT_AFTER_RELEASE.store(tombstone.reconnect_after_release, Ordering::Release);
        return Ok(());
    };
    // DNS-before-disarm invariant (identical to the macOS helper): the network may open only
    // after the snapshotted per-adapter DNS is restored and verified. If restore cannot be
    // proven, the disarm is refused and the block stays armed — opening the network while DNS
    // still points at a dead loopback resolver would blackhole the user, and restoring after
    // opening would race leaked traffic.
    //
    // The bound below does not weaken that: a timeout is an *unproven* restore, and `?` fails
    // the disarm on it exactly like a restore that ran and failed, so the filters below are
    // never reached and the barrier stays armed. It only stops another module's stall from
    // holding `WFP_OPERATION` — and therefore every future arm/lock/release — forever.
    bounded_dns_call("disarm", crate::core::dns::ensure_restored()).await?;
    if let Err(error) = remove_all_filters_unlocked().await {
        let _ = install_unlocked(&previous).await;
        return Err(error.context("failed to remove kill-switch filters; protection restored"));
    }
    // The tombstone tells a later Service start this release won (see `disarmed_tombstone`).
    // When it cannot be written the release is still final: the filters are proven gone and
    // DNS is proven restored, and putting the previous policy back would re-block the machine
    // on every Disconnect for as long as the write keeps failing — a fail-open violation with
    // no strict kill switch to justify it. The next-best durable state is no wanted intent at
    // all (the contract `restore_on_service_start` already understands); only if even that
    // removal fails does a stale wanted record survive, and a later Service start may then
    // restore it — reported through `last_error`, never by reinstalling the block.
    let tombstone_note = match atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await {
        Ok(()) => None,
        Err(error) => {
            tracing::error!(
                "Windows kill switch: the disarmed tombstone could not be written ({error:#}); \
                 staying released and removing the wanted intent instead"
            );
            let intent_removed = match tokio::fs::remove_file(intent_path()).await {
                Ok(()) => true,
                Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => true,
                Err(remove_error) => {
                    tracing::error!(
                        "Windows kill switch: the wanted intent could not be removed either \
                         ({remove_error}); a later Service start may re-arm it"
                    );
                    false
                }
            };
            Some(if intent_removed {
                format!(
                    "network was released, but recording the release failed ({error:#}); the \
                     wanted kill-switch intent was removed instead of replaced by a tombstone"
                )
            } else {
                format!(
                    "network was released, but recording the release failed ({error:#}) and the \
                     wanted intent survived: the next Service start may re-arm it — disconnect \
                     again once the Service has restarted"
                )
            })
        }
    };
    *armed_guard() = None;
    *last_error_guard() = tombstone_note;
    TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
    if let Some(apply_narrow) = apply_narrow {
        finish_release_follow_up(apply_narrow).await;
    }
    clear_wanted_core_window();
    CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
    RECONNECT_AFTER_RELEASE.store(tombstone.reconnect_after_release, Ordering::Release);
    Ok(())
}

/// Open the network after the core-proof window. DNS is best-effort: a restore that cannot
/// be proven must not keep the block, because Core is not coming back to answer loopback.
/// Filter removal failure leaves `ARMED` set so the next tick retries. A tombstone failure
/// after the filters are gone does not reinstall them.
async fn release_unproven_wanted_session_unlocked() -> Result<()> {
    if let Err(error) = bounded_dns_call(
        "wanted session core window",
        crate::core::dns::ensure_restored(),
    )
    .await
    {
        tracing::warn!(
            "wanted-session core window: DNS restore could not be proven; still removing WFP: {error:#}"
        );
        *last_error_guard() = Some(format!(
            "wanted-session core window opened the network but DNS restore could not be proven: {error:#}"
        ));
    }
    remove_all_filters_unlocked().await.context(
        "wanted-session core window could not remove WFP; the block stays until the next tick",
    )?;
    clear_wanted_core_window();
    *armed_guard() = None;
    TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
    RECONNECT_AFTER_RELEASE.store(true, Ordering::Release);
    // WFP is already gone. Recovery keeps only the existing narrow AI hold;
    // its best-effort installation cannot refuse or undo the general release.
    let tombstone = crash_recovery_tombstone();
    let result = match atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await {
        Ok(()) => {
            CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
            Ok(())
        }
        Err(error) => {
            CRASH_TOMBSTONE_PENDING.store(true, Ordering::Release);
            // The old wanted record would put the barrier back on a same-boot restart, and
            // `restore_desired_state` would replay its Core behind it. No record is the
            // next-best durable state (startup then restores no barrier); the pending retry
            // still writes the tombstone once the store is writable.
            match tokio::fs::remove_file(intent_path()).await {
                Ok(()) => {}
                Err(remove) if remove.kind() == std::io::ErrorKind::NotFound => {}
                Err(remove) => tracing::warn!(
                    "wanted-session core window: the stale wanted intent could not be removed either: {remove}"
                ),
            }
            Err(error).context(
                "WFP was removed but the crash-recovery tombstone could not be written",
            )
        }
    };
    finish_release_follow_up(true).await;
    result
}

async fn retry_crash_tombstone_unlocked() {
    if !CRASH_TOMBSTONE_PENDING.load(Ordering::Acquire) {
        return;
    }
    if armed_guard().is_some() {
        CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
        return;
    }
    let tombstone = crash_recovery_tombstone();
    match serde_json::to_vec_pretty(&tombstone) {
        Ok(encoded) => match atomic_write(&intent_path(), &encoded).await {
            Ok(()) => CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release),
            Err(error) => tracing::warn!(
                "wanted-session core window: crash-recovery tombstone still unwritten: {error:#}"
            ),
        },
        Err(error) => tracing::warn!(
            "wanted-session core window: crash-recovery tombstone could not be encoded: {error:#}"
        ),
    }
}

/// One watchdog step for a restored verified wanted session. Caller holds `WFP_OPERATION`.
async fn reconcile_wanted_core_window_unlocked() -> Result<WantedCoreWindow> {
    retry_crash_tombstone_unlocked().await;
    let Some(armed) = armed_guard().clone() else {
        return Ok(WantedCoreWindow::Keep);
    };
    let watching = WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_some();
    if !watching {
        return Ok(WantedCoreWindow::Keep);
    }
    let running = current_core_instance().await.is_some();
    let fresh_arm = FRESH_ARM_PROOF_PENDING.load(Ordering::Acquire);
    let proven = !fresh_arm
        && restored_connection_proven(
            running,
            armed.intent.is_verified(),
            armed.intent.mode,
            TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed),
        );
    let action = wanted_core_window_action(
        armed.intent.strict_kill_switch,
        fresh_arm || core_still_expected(running),
        wanted_core_deadline_reached(std::time::Instant::now()),
        proven,
    );
    match action {
        WantedCoreWindow::Proven => clear_wanted_core_window(),
        // A fresh arm can own a live, unverified TUN Core. Its lifecycle worker must stop
        // that Core and retire the run intent outside WFP_OPERATION before opening WFP.
        WantedCoreWindow::Release if !fresh_arm => {
            release_unproven_wanted_session_unlocked().await?
        }
        WantedCoreWindow::Release => {}
        WantedCoreWindow::Keep => {}
    }
    Ok(action)
}

/// Desired-state restore has finished, or was skipped. A Core that is still
/// neither running nor starting is released on this call instead of waiting
/// out [`WANTED_CORE_PROOF_WINDOW`].
pub async fn note_core_replay_finished() -> Result<()> {
    if !SUPPORTED {
        return Ok(());
    }
    CORE_REPLAY_EXPECTED.store(false, Ordering::Release);
    let _operation = WFP_OPERATION.lock().await;
    reconcile_wanted_core_window_unlocked().await.map(|_| ())
}

/// `POST /kill-switch/release`: the explicit user-requested disarm. Idempotent — not armed
/// is a successful no-op that still sweeps residuals — and shares the DNS-before-disarm
/// invariant via `disarm_unlocked`: when DNS restore cannot be proven the release is refused
/// and the block stays armed. StartClash also rolls a bootstrap arm it just made back through
/// here when the start itself fails, so the arm can never outlive its start.
#[cfg_attr(not(windows), allow(dead_code))] // the route helper is cfg(windows); tests use it
pub(crate) async fn release() -> Result<KillSwitchStatus> {
    release_with(false).await
}

/// Same full release as [`release`], then the secondary AI hold. Restore and
/// disconnect use [`release`] and do not pass true.
pub(crate) async fn release_applying_narrow() -> Result<KillSwitchStatus> {
    release_with(true).await
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) async fn release_after_service_stop() -> Result<()> {
    ensure_supported()?;
    let _operation = WFP_OPERATION.lock().await;
    let apply_narrow = {
        let armed = armed_guard();
        if armed
            .as_ref()
            .is_some_and(|armed| armed.intent.strict_kill_switch)
        {
            return Ok(());
        }
        // An armed session stopped automatically keeps the AI hold. Idle Stop preserves
        // either the previous crash hold or an explicit Restore's absent hold.
        armed
            .as_ref()
            .is_some_and(|armed| armed.intent.wanted)
            .then_some(true)
    };
    disarm_unlocked_with_narrow(apply_narrow).await?;
    note_explicit_release();
    Ok(())
}

async fn release_with(apply_narrow: bool) -> Result<KillSwitchStatus> {
    ensure_supported()?;
    {
        let _operation = WFP_OPERATION.lock().await;
        disarm_unlocked(apply_narrow).await?;
        note_explicit_release();
    }
    Ok(status().await)
}

/// `StopClash` counterpart of the macOS helper: keep blocking (recovery channel open) unless
/// an explicit disconnect requested release.
pub(crate) async fn transition_after_stop(release_requested: bool) -> Result<()> {
    if !SUPPORTED {
        return Ok(());
    }
    let _operation = WFP_OPERATION.lock().await;
    if armed_guard().is_none() {
        return Ok(());
    }
    if release_requested {
        return disarm_unlocked(false).await;
    }
    restrict_bootstrap_unlocked().await
}

#[cfg(any(windows, test))]
pub(crate) fn strict_kill_switch_enabled() -> bool {
    armed_guard()
        .as_ref()
        .is_some_and(|armed| armed.intent.strict_kill_switch)
}

/// Crash, hang, and unreadable state release general traffic unless the user explicitly
/// enabled the strict kill switch. A missing flag is not that opt-in.
fn crash_recovery_releases_network(strict_kill_switch_enabled: bool) -> bool {
    !strict_kill_switch_enabled
}

/// Non-strict unhealthy ticks wait, then release. They do not reinstall a block.
const UNHEALTHY_RELEASE_TICKS: u32 = 3;
/// Strict mode keeps repairing, then releases so a wedged engine cannot stay closed forever.
const STRICT_UNHEALTHY_RELEASE_TICKS: u32 = 30;

#[cfg_attr(not(windows), allow(dead_code))]
fn release_on_service_stop(strict_kill_switch_enabled: bool, lifecycle_owned: bool) -> bool {
    !strict_kill_switch_enabled && !lifecycle_owned
}

/// Called under the owner lifecycle and repair gates; an update/installer stop must leave the
/// recorded protection for its successor. Ordinary SCM Stop releases unless strict is on.
#[cfg(windows)]
pub(crate) fn service_stop_release_allowed(lifecycle_owned: bool) -> bool {
    release_on_service_stop(strict_kill_switch_enabled(), lifecycle_owned)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UnhealthyWatchdogAction {
    Wait,
    Reinstall,
    Release,
}

fn unhealthy_watchdog_action(
    strict_kill_switch_enabled: bool,
    consecutive_unhealthy: u32,
) -> UnhealthyWatchdogAction {
    if consecutive_unhealthy == 0 {
        return UnhealthyWatchdogAction::Wait;
    }
    if crash_recovery_releases_network(strict_kill_switch_enabled) {
        if consecutive_unhealthy >= UNHEALTHY_RELEASE_TICKS {
            UnhealthyWatchdogAction::Release
        } else {
            UnhealthyWatchdogAction::Wait
        }
    } else if consecutive_unhealthy >= STRICT_UNHEALTHY_RELEASE_TICKS {
        UnhealthyWatchdogAction::Release
    } else {
        UnhealthyWatchdogAction::Reinstall
    }
}

/// Remove provider-scoped WFP and restore DNS. DNS failure does not keep the block.
/// The caller decides whether the on-disk intent bytes stay (corrupt evidence) or are
/// replaced by a disarmed tombstone (a live session the watchdog gave up on).
async fn release_general_traffic_unlocked(reason: &str, replace_intent: bool) -> Result<()> {
    tracing::warn!("wfp: {reason}; releasing general traffic and restoring DNS");
    if let Err(error) = bounded_dns_call(reason, crate::core::dns::ensure_restored()).await {
        tracing::warn!("wfp: DNS restore during {reason} failed; still releasing WFP: {error:#}");
        *last_error_guard() = Some(format!("{error:#}"));
    } else {
        *last_error_guard() = None;
    }
    if let Err(error) = remove_all_filters_unlocked().await {
        let message =
            format!("wfp: {reason}; WFP removal failed after deciding to release: {error:#}");
        *last_error_guard() = Some(message.clone());
        return Err(error.context(message));
    }
    sweep_legacy_sublayers_unlocked().await;
    *armed_guard() = None;
    TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
    RESTORED_BARRIER_UNPROVEN.store(false, Ordering::Release);
    note_verify(false);
    // Keep corrupt/unreadable bytes as evidence. A live-session or missing-record release
    // needs its own durable narrow disposition before detached native work begins.
    if replace_intent || tokio::fs::read(intent_path()).await.is_err_and(|error| {
        error.kind() == std::io::ErrorKind::NotFound
    }) {
        if let Err(error) = persist_automatic_release_tombstone().await {
            tracing::warn!("wfp: automatic release disposition could not be written: {error:#}");
        }
    }
    // Crash/corrupt-state recovery must retain the secondary AI floor just like
    // other non-strict failure releases, after the general block is removed.
    finish_release_follow_up(true).await;
    Ok(())
}

async fn release_general_traffic_on_startup_unlocked(reason: &str) -> Result<()> {
    let result = release_general_traffic_unlocked(reason, false).await;
    if result.is_err() && armed_guard().is_none() {
        // No in-memory intent exists for the watchdog to reconcile after this startup failure.
        spawn_startup_release_retry();
    }
    result
}

async fn release_unhealthy_session_unlocked(reason: &str) -> Result<()> {
    release_general_traffic_unlocked(reason, true).await
}

/// Ownerless block used only when the on-disk record explicitly enabled the strict kill
/// switch and its details are unusable. Any authenticated owner may still release it.
fn emergency_armed() -> Armed {
    Armed {
        intent: IntentRecord {
            wanted: true,
            mode: KillSwitchStatusMode::Blocked,
            verified: Some(true),
            tunnel_interface: String::new(),
            app_path: String::new(),
            endpoints: Vec::new(),
            api_host_ips: Vec::new(),
            updated_at: now_unix(),
            owner_key: None,
            strict_kill_switch: true,
            reconnect_after_release: false,
            apply_narrow_after_release: None,
        },
        tun_luid: None,
        core_instance: None,
        direct_endpoints: Vec::new(),
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    }
}

/// Service-start recovery (design doc §3): read the intent record and reconcile.
///
/// Ordering invariant: the intent is reconciled and the current expected filter set is
/// installed *before* the legacy-sublayer upgrade sweep runs. Across an upgrade reboot an
/// older build's PERSISTENT block-all pair may be the only protection on the machine;
/// sweeping it away before the replacement floor is committed would open a zero-filter
/// window at boot — and leave the machine open for good if the reconcile then failed.
/// `install` itself swaps legacy filters for the current set in a single transaction, so
/// the sweep afterwards only clears the emptied legacy sublayer objects.
pub async fn restore_on_service_start() -> Result<()> {
    if !SUPPORTED {
        return Ok(());
    }
    // Read before the WFP lock. Desired-state I/O must not nest under it.
    let replay_expected = crate::core::desired::core_replay_expected_this_boot().await;
    let _operation = WFP_OPERATION.lock().await;
    RESTORE_WAS_LOCKED.store(false, Ordering::Release);
    clear_wanted_core_window();
    RECONNECT_AFTER_RELEASE.store(false, Ordering::Release);
    match tokio::fs::read(intent_path()).await {
        Ok(bytes) => match serde_json::from_slice::<IntentRecord>(&bytes) {
            Ok(intent) if intent_is_valid(&intent) => {
                if !intent.is_verified() {
                    // Do not open the machine yet. Startup reconciliation runs immediately after
                    // this function and must first prove that any previous Core is gone. It then
                    // calls `retire_unverified_on_service_start`, which durably retires the desired
                    // owner, proves DNS restoration, and only then removes WFP. Keeping a strict
                    // Blocked snapshot here closes the old Core/WFP ordering window. If that
                    // retirement fails, a non-strict intent still releases with the AI hold.
                    let mut intent = intent;
                    apply_learned_bootstrap_pins(&mut intent);
                    let mut armed = Armed {
                        intent,
                        tun_luid: None,
                        core_instance: None,
                        direct_endpoints: Vec::new(),
                        reviewed_direct_ports: Vec::new(),
                        direct_reload: None,
                    };
                    armed.intent.mode = KillSwitchStatusMode::Blocked;
                    armed.intent.updated_at = now_unix();
                    *armed_guard() = Some(armed.clone());
                    let persist = match serde_json::to_vec_pretty(&armed.intent) {
                        Ok(encoded) => atomic_write(&intent_path(), &encoded).await,
                        Err(error) => Err(error.into()),
                    };
                    let install = install_unlocked(&armed).await;
                    let wfp_live = install.is_ok();
                    let reconciled = record_startup_reconciliation(persist, install);
                    if wfp_live {
                        sweep_legacy_sublayers_unlocked().await;
                    }
                    return reconciled;
                }
                let mut intent = intent;
                apply_learned_bootstrap_pins(&mut intent);
                let mut armed = Armed {
                    intent,
                    tun_luid: None,
                    // A restored intent never inherits a tunnel grant: the adapter, and the core
                    // that created it, belong to a process that is gone.
                    core_instance: None,
                    // omission = clear: a restore never brings DIRECT endpoints back. The
                    // recovered session stays fail-closed for them until the app's next
                    // connect transaction re-issues the approved tuples.
                    direct_endpoints: Vec::new(),
                    reviewed_direct_ports: Vec::new(),
                    direct_reload: None,
                };
                // A persisted Locked mode is not proof this boot's tunnel exists: downgrade to
                // Blocked (fail-closed, API recovery channel open) until the tunnel is
                // re-locked — by `relock_restored_tunnel` after a core restore, or by the GUI.
                let restored_was_locked = armed.intent.mode == KillSwitchStatusMode::Locked;
                if restored_was_locked {
                    // Materialize the legacy Locked => verified migration before changing mode.
                    // Otherwise a second service restart would reinterpret the now-Blocked
                    // field-less record as stale and incorrectly open an established session.
                    armed.intent.verified = Some(true);
                    armed.intent.mode = KillSwitchStatusMode::Blocked;
                    armed.intent.updated_at = now_unix();
                    RESTORE_WAS_LOCKED.store(true, Ordering::Release);
                }
                // Published before the install so the watchdog keeps retrying a failed one, but
                // not yet proof of a live barrier for the Remote Desktop exception.
                RESTORED_BARRIER_UNPROVEN.store(true, Ordering::Release);
                *armed_guard() = Some(armed.clone());
                let persist = if restored_was_locked {
                    match serde_json::to_vec_pretty(&armed.intent) {
                        Ok(encoded) => atomic_write(&intent_path(), &encoded).await,
                        Err(error) => Err(error.into()),
                    }
                } else {
                    Ok(())
                };
                let install = install_unlocked(&armed).await;
                let wfp_live = install.is_ok();
                let reconciled = record_startup_reconciliation(persist, install);
                if wfp_live {
                    sweep_legacy_sublayers_unlocked().await;
                }
                // Strict keeps the block. Otherwise the block stays only while Core is
                // running or this boot will start it, and only until the calibrated cap.
                // A Core that is neither running nor starting is released here.
                if armed.intent.strict_kill_switch {
                    clear_wanted_core_window();
                    CORE_REPLAY_EXPECTED.store(false, Ordering::Release);
                    reconciled
                } else {
                    let running = current_core_instance().await.is_some();
                    let starting = core_is_running_or_starting(running, replay_expected);
                    note_wanted_core_window(&armed.intent);
                    if starting {
                        CORE_REPLAY_EXPECTED.store(!running, Ordering::Release);
                        reconciled
                    } else {
                        CORE_REPLAY_EXPECTED.store(false, Ordering::Release);
                        *WANTED_CORE_DEADLINE
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner) =
                            Some(std::time::Instant::now());
                        match release_unproven_wanted_session_unlocked().await {
                            Ok(()) => Ok(()),
                            Err(release_error) => Err(release_error),
                        }
                    }
                }
            }
            // `wanted == false` still disarms. A wanted record that no longer validates is not
            // an explicit strict kill switch unless `strict_kill_switch` is true. Corrupt and
            // unreadable bytes cannot prove that opt-in, so those paths release as well.
            Ok(intent) if !intent.wanted => {
                // Unwanted-but-parseable, with possible residual objects: clean up, exactly the
                // design's third recovery rule. A leftover DNS snapshot (e.g. from an emergency
                // disarm whose restore could not be proven) is swept here too — protection is
                // off, so the machine must not stay on loopback DNS.
                //
                // Replay a recorded secondary disposition only after broad cleanup. Automatic
                // tombstones stay for future recovery; explicit Restore supersedes them. Legacy
                // records without a disposition preserve their existing hold. The rules name
                // only the allowlisted suffixes and the two
                // Anthropic prefixes, so leaving them cannot block general traffic.
                // `remove_all_filters` is provider-scoped, so filters in legacy sublayers go
                // with it; the sweep afterwards only clears the emptied sublayer objects.
                if let Err(error) = remove_all_filters_unlocked().await {
                    *last_error_guard() =
                        Some(format!("startup stale-filter release pending: {error:#}"));
                    spawn_startup_release_retry();
                    return Err(error);
                }
                sweep_legacy_sublayers_unlocked().await;
                let follow_up = intent.release_follow_up();
                if intent.reconnect_after_release {
                    // Keep the crash-window tombstone so a later Service start still tells the
                    // app to reconnect. A user-disconnect tombstone is consumed as before.
                    RECONNECT_AFTER_RELEASE.store(true, Ordering::Release);
                }
                if !intent.reconnect_after_release && follow_up != Some(true) {
                    match tokio::fs::remove_file(intent_path()).await {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                *armed_guard() = None;
                TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
                if let Err(error) = bounded_dns_call(
                    "service start (unwanted intent)",
                    crate::core::dns::ensure_restored(),
                )
                .await
                {
                    tracing::warn!(
                        "service start: leftover DNS snapshot could not be restored: {error:#}"
                    );
                }
                if let Some(apply_narrow) = follow_up {
                    finish_release_follow_up(apply_narrow).await;
                }
                Ok(())
            }
            Ok(intent) => {
                // Details are unusable. Keep the file. Install a block only when this record
                // itself says the strict kill switch is on.
                if crash_recovery_releases_network(intent.strict_kill_switch) {
                    tracing::warn!(
                        "unusable kill-switch intent; releasing general traffic and keeping the file"
                    );
                    return release_general_traffic_on_startup_unlocked("unusable kill-switch intent").await;
                }
                let emergency = emergency_armed();
                *armed_guard() = Some(emergency.clone());
                let installed = install_unlocked(&emergency).await.context(
                    "unusable strict kill-switch intent: failed to install emergency block",
                );
                if installed.is_ok() {
                    sweep_legacy_sublayers_unlocked().await;
                }
                installed
            }
            Err(_) => {
                // The bytes do not parse, so they cannot prove an explicit strict opt-in.
                // Leave them on disk and release general traffic.
                tracing::warn!(
                    "corrupt kill-switch intent; releasing general traffic and keeping the file"
                );
                release_general_traffic_on_startup_unlocked("corrupt kill-switch intent").await
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // No record can name an explicit strict kill switch. Residual filters are released.
            #[cfg(all(windows, not(feature = "test")))]
            if engine_call("residual filter check", crate::core::wfp::any_filters_exist)
                .await
                .unwrap_or(true)
            {
                return release_general_traffic_on_startup_unlocked(
                    "residual WFP without a kill-switch intent",
                )
                .await;
            }
            // Not armed and no filters anywhere (the residual check is provider-scoped, legacy
            // sublayers included): sweeping empty leftover sublayer objects cannot remove
            // protection, and on a fresh install the sweep is a read-only no-op because the
            // Tono provider does not exist.
            sweep_legacy_sublayers_unlocked().await;
            // Not armed and nothing residual: still sweep a leftover DNS snapshot (see above).
            if let Err(error) = bounded_dns_call(
                "service start (no intent)",
                crate::core::dns::ensure_restored(),
            )
            .await
            {
                tracing::warn!(
                    "service start: leftover DNS snapshot could not be restored: {error:#}"
                );
            }
            Ok(())
        }
        Err(error) => {
            // Unreadable (ACL damage, a directory, transient I/O) cannot prove a strict
            // opt-in. Release general traffic. A clean NotFound never reaches here.
            tracing::warn!(
                "kill-switch intent could not be read: {error:#}; releasing general traffic"
            );
            release_general_traffic_on_startup_unlocked("unreadable kill-switch intent").await
        }
    }
}

/// Read-only WFP proof for the uninstaller's "nothing to clean" fast path.
///
/// State files are not the source of truth for persistent WFP objects: an interrupted or older
/// uninstall can leave provider-scoped filters behind after deleting `kill-switch.json` and the
/// SCM record. Service start releases that combination unless a readable record explicitly
/// enabled the strict kill switch. An uninstaller may still skip the real disarm only when
/// this probe also proves that no Tono filter exists.
///
/// **Provider-absent is not an error:** `FwpmProviderGetByKey0` returning `0x80320005`
/// (`FWP_E_PROVIDER_NOT_FOUND`) means there is no Tono provider and therefore no residual
/// filters. Reporting that as `Err` made Chinese clean-machine installs fail with result 3.
#[cfg(all(windows, not(feature = "test")))]
pub async fn residual_filters_present() -> Result<bool> {
    let _operation = WFP_OPERATION.lock().await;
    match engine_call(
        "uninstall residual filter check",
        crate::core::wfp::any_filters_exist,
    )
    .await
    {
        Ok(present) => Ok(present),
        Err(error) if crate::core::wfp::error_text_means_provider_absent(&format!("{error:#}")) => {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

#[cfg(not(all(windows, not(feature = "test"))))]
pub async fn residual_filters_present() -> Result<bool> {
    Ok(false)
}

/// Prepare an in-place Service replacement without opening an active protected session.
///
/// The elevated installer calls this only after SCM reports the old Service stopped and while it
/// holds the singleton Service-owner lock. A valid wanted intent or any active owner is durable
/// evidence that protection must survive the replacement, so those cases are untouched. A
/// disconnected pre-fix build, however, has neither record: synthesize the same `wanted:false`
/// tombstone a fixed release leaves so startup removes late-visible WFP debris instead of
/// converting it into an ownerless emergency block.
///
/// Corrupt intent bytes are left untouched here. They are not an explicit strict opt-in;
/// the next Service start releases general traffic and keeps the file.
pub async fn prepare_for_service_replacement() -> Result<bool> {
    ensure_supported()?;

    // Do not use `load_active_owner` here: its normal runtime contract quarantines malformed
    // owner JSON and reports `None`, which is useful for an owner-gated release but too
    // permissive for an installer deciding whether it may synthesize an open marker. During a
    // replacement, unreadable or malformed owner evidence is ambiguity and ambiguity preserves
    // protection.
    let active_owner_path = crate::service_paths().active_owner_path();
    match tokio::fs::read(&active_owner_path).await {
        Ok(bytes) => {
            if serde_json::from_slice::<crate::core::desired::ActiveOwnerState>(&bytes).is_err() {
                tracing::warn!(
                    "Service replacement found corrupt active-owner evidence; preserving protection fail-closed"
                );
            }
            return Ok(false);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "failed to inspect active-owner evidence {active_owner_path:?} before Service replacement; refusing to change protection"
                )
            });
        }
    }

    match tokio::fs::read(intent_path()).await {
        Ok(bytes) => match serde_json::from_slice::<IntentRecord>(&bytes) {
            Ok(intent) if intent.wanted => Ok(false),
            Ok(intent) => {
                atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
                Ok(true)
            }
            Err(error) => {
                tracing::warn!(
                    "Service replacement found a corrupt kill-switch intent; preserving it fail-closed: {error}"
                );
                Ok(false)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            persist_disarmed_tombstone().await?;
            Ok(true)
        }
        Err(error) => Err(error).context(
            "failed to inspect kill-switch intent before Service replacement; refusing to change protection",
        ),
    }
}

/// Finish startup recovery for an initial attempt that never crossed the durable verification
/// barrier. This runs *after* `reconcile_service_startup` has stopped and identified any surviving
/// Core, or after that reconciliation failed its bounded startup retries: then the decision-031
/// release (AI hold kept) replaces a Blocked machine nothing would retire. The order is
/// deliberately irreversible-safe:
///
/// 1. retire the matching owner's desired run state;
/// 2. prove DNS restoration;
/// 3. remove WFP and its intent record.
///
/// When owner retirement or the DNS proof fails, a non-strict intent still releases general
/// traffic with the AI hold (decision 031) and the error is returned so callers skip desired-Core
/// restore. Strict intents are never retired here.
/// Returns `true` when an unverified intent was retired, `false` when there was none.
pub async fn retire_unverified_on_service_start() -> Result<bool> {
    if !SUPPORTED {
        return Ok(false);
    }
    #[cfg(windows)]
    if crate::core::update::pending() { return Ok(false); }
    let _operation = WFP_OPERATION.lock().await;
    let Some(armed) = armed_guard().clone() else {
        return Ok(false);
    };
    if armed.intent.is_verified() || armed.intent.strict_kill_switch {
        return Ok(false);
    }

    let result = async {
        if let Some(owner_key) = armed.intent.owner_key.as_deref() {
            if !crate::core::desired::retire_owner_if_active(owner_key)
                .await
                .context("failed to retire stale unverified owner")?
            {
                bail!(
                    "stale unverified protection owner {owner_key:?} does not match the active Core owner"
                );
            }
        } else {
            crate::core::desired::retire_legacy_active_owner()
                .await
                .context("failed to retire active owner paired with legacy unowned protection")?;
        }
        // This is recovery from an interrupted connection, not an explicit Restore.
        // Open general traffic and retain the same AI hold as other crash releases.
        disarm_unlocked(true).await
    }
    .await;

    match result {
        Ok(()) => Ok(true),
        Err(error) => {
            // Decision 031: only strict mode (returned above) may stay fully Blocked. Retirement
            // or DNS proof failed, so open general traffic with the AI hold and best-effort DNS.
            // The error still reaches the caller, which then skips desired-Core restore.
            let reason = "stale unverified startup protection could not be retired cleanly";
            if let Err(release_error) = release_general_traffic_unlocked(reason, true).await {
                // WFP is still armed: the watchdog's core window retries the release each tick.
                *WANTED_CORE_DEADLINE
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) =
                    Some(std::time::Instant::now());
                *last_error_guard() = Some(format!(
                    "stale unverified session could not release general traffic yet; retrying: {release_error:#}"
                ));
                return Err(error.context("general traffic release is pending a watchdog retry"));
            }
            *last_error_guard() = Some(format!(
                "stale unverified session released general traffic with the AI hold: {error:#}"
            ));
            Err(error.context("general traffic was released with the AI hold"))
        }
    }
}

/// Windows counterpart of the macOS helper's `add_restored_kill_switch_tunnel`: the service
/// restored a core from desired state and the recovered intent had been `locked` (startup
/// downgraded it to `blocked` because the adapter could not be proven yet). Re-run the
/// normal lock path — including the Wintun validation chain — for the recorded interface.
/// A failure keeps the stricter Blocked mode and is recorded in `last_error`.
pub async fn relock_restored_tunnel() -> Result<()> {
    if !SUPPORTED {
        return Ok(());
    }
    if !RESTORE_WAS_LOCKED.swap(false, Ordering::Acquire) {
        return Ok(());
    }
    if armed_guard().is_none() {
        return Ok(());
    }
    lock(None).await.map_err(|error| {
        let message = format!("restored core could not be re-locked: {error:#}");
        *last_error_guard() = Some(message.clone());
        error.context(message)
    })
}

fn direct_reload_invalidation_reason(
    armed: &Armed,
    current_core: Option<CoreInstance>,
    current_tunnel_luid: Option<u64>,
    now: std::time::Instant,
) -> Option<&'static str> {
    let Some(lease) = armed.direct_reload.as_ref() else {
        return (!armed.direct_endpoints.is_empty())
            .then_some("DIRECT endpoints exist without a Service-owned lease");
    };
    if lease.expires_at.is_none_or(|deadline| now >= deadline) {
        return Some(match lease.phase {
            DirectReloadPhase::Bracket => "DIRECT runtime reload bracket expired before install",
            DirectReloadPhase::Pending => {
                "pending DIRECT endpoints expired before App finalization"
            }
            DirectReloadPhase::Committed => {
                "committed DIRECT heartbeat lease expired after App/session liveness was lost"
            }
            DirectReloadPhase::Retracting => "DIRECT permits await exact Blocked retraction",
        });
    }
    if lease.phase != DirectReloadPhase::Bracket
        && (armed.intent.mode != KillSwitchStatusMode::Locked
            || tunnel_permit_luid(armed, current_core).is_none()
            || lease.core_instance != current_core
            || armed.tun_luid.is_none()
            || armed.tun_luid != current_tunnel_luid
            || lease.tunnel_luid != armed.tun_luid)
    {
        return Some("DIRECT endpoint Core/TUN/LUID ownership changed");
    }
    None
}

async fn reconcile_direct_watchdog_invalidation_unlocked(
    mut armed: Armed,
    current_core: Option<CoreInstance>,
    now: std::time::Instant,
    reason: &str,
) -> Result<()> {
    // Only a lost committed heartbeat releases. Pending finalization and an
    // explicit strict kill switch stay Blocked. The structural lease check is
    // what authorizes the release; the reason prefix is the same contract the
    // App matches, so a pending-expiry string cannot open the network.
    let release = committed_direct_lease_failure_releases(reason, armed.intent.strict_kill_switch)
        && armed.direct_reload.as_ref().is_some_and(|lease| {
            lease.phase == DirectReloadPhase::Committed
                && lease.expires_at.is_none_or(|deadline| now >= deadline)
        });
    // Narrowing failure poisons the deadline. Keep ownership-change retries distinct from
    // App death, even if the heartbeat deadline passes while the failed install is awaited.
    if !release {
        if let Some(lease) = armed.direct_reload.as_mut() {
            if lease.phase == DirectReloadPhase::Committed {
                lease.phase = DirectReloadPhase::Retracting;
                lease.expires_at = Some(now);
            }
        }
    }
    // App death must release a non-strict session after exact DIRECT retraction. Keep only
    // its expired receipt until release succeeds so a failed WFP removal retries next tick.
    let next_lease = if release {
        armed.direct_reload.clone()
    } else {
        None
    };
    let transition = transition_direct_to_blocked_unlocked(armed, current_core, next_lease).await;
    note_verify(transition.is_ok());
    if let Err(error) = transition {
        if !release || !error.is::<DirectBlockedIntentPersistenceFailure>() {
            return Err(error);
        }
        tracing::warn!(
            "wfp: {reason}; exact Blocked WFP was proved; releasing despite intent persistence failure: {error:#}"
        );
    }
    if release {
        if queue_direct_expiry_retirement() {
            tracing::warn!("wfp: {reason}; retiring the expired session's Core before selective fallback");
            return Ok(());
        }
        let message = format!("{reason}; exact DIRECT permits were retracted; non-strict session");
        release_unhealthy_session_unlocked(&message).await?;
        Ok(())
    } else {
        let message =
            format!("{reason}; exact DIRECT permits were retracted and traffic is Blocked");
        *last_error_guard() = Some(message.clone());
        tracing::warn!("{message}");
        Ok(())
    }
}

/// One-second verify-after-write watchdog (the macOS helper does the same for PF).
///
/// A restored verified wanted session releases immediately when Core is neither running
/// nor about to start. While Core is running or this boot will start it, a bounded
/// core-proof window applies: if Core is not running with a Locked, verified tunnel
/// permit when that window ends, the tick releases WFP and restores DNS instead of
/// reinstalling the block. An explicit strict kill switch does not start the window.
/// An unhealthy tick does not reinstall unless that opt-in is set. Without it, general
/// traffic is released after [`UNHEALTHY_RELEASE_TICKS`]. Strict mode repairs until
/// [`STRICT_UNHEALTHY_RELEASE_TICKS`], then releases too. Persistent failures are
/// log-throttled — one error per minute, the rest at debug — so a broken engine cannot
/// flood the service log.
pub fn spawn_windows_kill_switch_watchdog() {
    /// One error line per minute; the rest at debug.
    const ERROR_LOG_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
    tokio::spawn(async {
        // `None` = "never logged yet", *not* `Instant::now() - an hour`: `Instant` is
        // boot-relative on Windows and this service is AutoStart, so subtracting an hour
        // underflows and panics on a machine that has been up for less than that — killing the
        // watchdog task on its first statement at every boot, which would silently disable both
        // the verify-after-write reconciliation and the `LAST_VERIFY` refresh that `status()`
        // reports liveness from.
        let mut last_error_log: Option<std::time::Instant> = None;
        let mut consecutive_unhealthy: u32 = 0;
        loop {
            tokio::time::sleep(WATCHDOG_PERIOD).await;
            let _operation = WFP_OPERATION.lock().await;
            if let Err(error) = reconcile_wanted_core_window_unlocked().await {
                tracing::warn!(
                    "wanted-session core window could not open the network yet: {error:#}"
                );
            }
            let fresh_epoch = FRESH_ARM_EPOCH.load(Ordering::Acquire);
            if expired_fresh_arm_owner(fresh_epoch).is_some() {
                // Lifecycle handlers take owner lifecycle before WFP. Never invert that order;
                // stop_core also reacquires WFP to retract permits before terminating Core.
                drop(_operation);
                if let Err(error) = crate::core::server::retire_expired_fresh_arm(fresh_epoch).await {
                    if last_error_log.is_none_or(|at| at.elapsed() >= ERROR_LOG_INTERVAL) {
                        tracing::error!("abandoned Connect could not be retired: {error:#}");
                        last_error_log = Some(std::time::Instant::now());
                    }
                }
                continue;
            }
            let armed = { armed_guard().clone() };
            if let Some(armed) = armed {
                let direct_transaction_active = armed.direct_reload.is_some();
                let current_core = if direct_transaction_active {
                    current_core_instance_for_direct_security()
                } else {
                    current_core_instance().await
                };
                let current_tunnel_luid = if armed
                    .direct_reload
                    .as_ref()
                    .is_some_and(|lease| lease.phase != DirectReloadPhase::Bracket)
                {
                    resolve_luid(&armed.intent.tunnel_interface).await.ok()
                } else {
                    None
                };
                let now = std::time::Instant::now();
                if let Some(reason) = direct_reload_invalidation_reason(
                    &armed,
                    current_core,
                    current_tunnel_luid,
                    now,
                ) {
                    match reconcile_direct_watchdog_invalidation_unlocked(
                        armed,
                        current_core,
                        now,
                        reason,
                    )
                    .await
                    {
                        Ok(()) => {}
                        Err(error) => {
                            if last_error_log.is_none_or(|at| at.elapsed() >= ERROR_LOG_INTERVAL) {
                                tracing::error!(
                                    "{reason}; fail-closed DIRECT reconciliation failed: {error:#}"
                                );
                                last_error_log = Some(std::time::Instant::now());
                            } else {
                                tracing::debug!(
                                    "{reason}; fail-closed DIRECT reconciliation still failing: {error:#}"
                                );
                            }
                        }
                    }
                    consecutive_unhealthy = 0;
                    continue;
                }
                let healthy = if ENGINE_LIVE {
                    let healthy = verify_live_unlocked_for(&armed, current_core).await.is_ok();
                    note_verify(healthy);
                    healthy
                } else {
                    true
                };
                if healthy {
                    consecutive_unhealthy = 0;
                    continue;
                }
                consecutive_unhealthy = consecutive_unhealthy.saturating_add(1);
                match unhealthy_watchdog_action(
                    armed.intent.strict_kill_switch,
                    consecutive_unhealthy,
                ) {
                    UnhealthyWatchdogAction::Wait => {
                        tracing::debug!(
                            "Windows kill-switch unhealthy ({consecutive_unhealthy}); not reinstalling"
                        );
                    }
                    UnhealthyWatchdogAction::Reinstall => {
                        if let Err(error) = install_unlocked_for(&armed, current_core).await {
                            *last_error_guard() = Some(format!("{error:#}"));
                            if last_error_log.is_none_or(|at| at.elapsed() >= ERROR_LOG_INTERVAL) {
                                tracing::error!(
                                    "Windows kill-switch strict reconciliation failed: {error:#}"
                                );
                                last_error_log = Some(std::time::Instant::now());
                            } else {
                                tracing::debug!(
                                    "Windows kill-switch strict reconciliation still failing: {error:#}"
                                );
                            }
                        }
                    }
                    UnhealthyWatchdogAction::Release => {
                        if let Err(error) = release_unhealthy_session_unlocked(
                            "unhealthy Windows kill-switch watchdog",
                        )
                        .await
                        {
                            if last_error_log.is_none_or(|at| at.elapsed() >= ERROR_LOG_INTERVAL) {
                                tracing::error!(
                                    "Windows kill-switch unhealthy release failed: {error:#}"
                                );
                                last_error_log = Some(std::time::Instant::now());
                            }
                        }
                        consecutive_unhealthy = 0;
                    }
                }
            } else {
                consecutive_unhealthy = 0;
            }
        }
    });
}

/// `tono-service.exe --emergency-disarm`: restore snapshotted DNS, then delete every WFP
/// object whose provider key is Tono's (filters → legacy sublayers → sublayer → provider),
/// and remove the intent record. It touches no other provider, sublayer, or Windows Defender
/// Firewall setting.
///
/// **The invariant this function exists to hold, and the one the uninstall exit codes rest on:**
/// the WFP objects are removed before any DNS outcome is reported, and every `?` above the
/// removal fails *without* claiming the barrier is gone. Once WFP is deleted, every DNS outcome
/// is tagged with a continue marker (`DNS_RESTORED_AUTOMATIC_PREFIX`,
/// `DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX`, or `WFP_REMOVED_CONTINUE_PREFIX`) so the
/// uninstaller can never treat "filters gone, DNS messy" as result 3. An NRPT catch-all that
/// could not be removed puts `DNS_RESOLVER_POLICY_REMAINS_PREFIX` in front of that DNS outcome,
/// so both markers appear. Two end states must still block: WFP still armed, and the NRPT rule
/// still present, which the uninstall helper's own sweep (`with_resolver_rule_proof`) checks
/// again and blocks on with result 3.
pub async fn emergency_disarm_windows_kill_switch() -> Result<()> {
    emergency_disarm_with(false).await
}

/// Automatic failed-update recovery uses the same WFP/DNS proof and reporting,
/// but retains the secondary AI hold. The caller must first exclude strict mode
/// and stop the Service while holding the repair and singleton owner gates.
pub async fn emergency_disarm_windows_kill_switch_applying_narrow() -> Result<()> {
    emergency_disarm_with(true).await
}

async fn emergency_disarm_with(apply_narrow: bool) -> Result<()> {
    let _operation = WFP_OPERATION.lock().await;
    // This is still the fail-open escape hatch: WFP objects are removed even if protected DNS
    // cannot be restored. The DNS failure is nevertheless returned *after* WFP and intent
    // cleanup so an uninstaller cannot report success and delete the remaining recovery files.
    // `restore_protected` preserves its snapshot on failure, making a repair + retry possible.
    //
    // Bounded like every other cross-module await on this path, and here the bound cannot even
    // touch the ordering invariant: this path is the documented fail-open escape hatch that
    // removes WFP whether or not DNS could be restored, so a timeout only changes *how* the
    // uninstaller reports an unrestored resolver — never whether it proved one before opening.
    // An unbounded hang here would instead wedge the uninstaller while holding `WFP_OPERATION`.
    //
    // Two DNS strategies, chosen by the *calling process*, never by the machine's condition:
    //
    // * The uninstaller opts into `dns::restore_for_uninstall`, the escalation ladder. Its
    //   rung 2 resets the adapters Tono redirected to automatic (DHCP) rather than refusing —
    //   because the alternative, which is what this code used to do, was an application the
    //   user could not remove. See the block comment above `dns::uninstall_restore_rung`.
    // * Everyone else — `tono-service.exe --emergency-disarm`, the Start-Menu "Restore Network"
    //   entry — keeps `dns::restore_protected` verbatim. That path's promise is to put the
    //   user's *own* servers back on a machine that is staying installed, and a machine that is
    //   staying installed can retry. Nothing about it is made more permissive here.
    let dns_restore = if uninstall_ladder_requested() {
        bounded_dns_call_within(
            UNINSTALL_DNS_RESTORE_TIMEOUT,
            "uninstall disarm",
            crate::core::dns::restore_for_uninstall(),
        )
        .await
    } else {
        bounded_dns_call("emergency disarm", crate::core::dns::restore_protected())
            .await
            .map(|_| crate::core::dns::UninstallDnsRestore::Exact)
    };

    // Persist fail-open intent *before* removing WFP when we can. Service-start recovery sees
    // the tombstone and finishes cleanup instead of re-arming a stale wanted policy.
    //
    // **Uninstall ladder exception:** Chinese customer machines repeatedly hit
    // `ensure_private_service_directory` / ProgramData ACL failures on this write, which used to
    // return *before* WFP removal and brick install/uninstall as result 3 forever — with the
    // barrier still armed. When this process opted into the uninstall ladder, a tombstone
    // failure is logged and we still delete provider-scoped WFP objects: the alternative is an
    // application that cannot be removed. Non-uninstall callers keep the old refuse path.
    let mut tombstone = match tokio::fs::read(intent_path()).await {
        Ok(bytes) => serde_json::from_slice::<IntentRecord>(&bytes).ok(),
        Err(_) => None,
    }
    .unwrap_or(IntentRecord {
        wanted: false,
        mode: KillSwitchStatusMode::Blocked,
        verified: Some(false),
        tunnel_interface: String::new(),
        app_path: String::new(),
        endpoints: Vec::new(),
        api_host_ips: Vec::new(),
        updated_at: now_unix(),
        owner_key: None,
        strict_kill_switch: false,
        reconnect_after_release: false,
        apply_narrow_after_release: None,
    });
    tombstone.wanted = false;
    tombstone.reconnect_after_release = false;
    tombstone.apply_narrow_after_release = Some(apply_narrow);
    tombstone.updated_at = now_unix();
    let tombstone_error =
        match atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await {
            Ok(()) => None,
            Err(error) if uninstall_ladder_requested() => {
                tracing::error!(
                    "uninstall disarm: kill-switch tombstone could not be written ({error:#}); \
                 still removing WFP so install/uninstall cannot dead-end as result 3"
                );
                Some(error)
            }
            Err(error) => return Err(error),
        };

    // Bounded like every other engine call: an uninstaller that hangs forever on a wedged BFE
    // is worse than one that reports why it could not finish. When the tombstone is on disk the
    // next service start completes cleanup either way; when it is not (uninstall ladder only)
    // the WFP delete itself is the safety proof the uninstaller needs.
    //
    // Ordering: prefer tombstone *before* the engine call (a crash mid-removal must still
    // complete cleanup at the next service start), but the in-memory disarmed state is
    // published *after* it. Publishing first would make `status()` report an unprotected
    // machine while the filters are demonstrably still installed — the exact inversion of what
    // the product promises. On engine failure the reported state therefore stays "armed".
    #[cfg(all(windows, not(feature = "test")))]
    engine_call("emergency disarm", crate::core::wfp::emergency_disarm).await?;
    // WFP is gone. Explicit Restore removes the secondary hold; automatic
    // failure recovery applies it. Neither may undo or refuse this release.
    finish_release_follow_up(apply_narrow).await;
    *armed_guard() = None;
    *last_verify_guard() = None;
    TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
    // Best-effort tombstone after a skipped pre-write so a later Service start still prefers
    // cleanup over emergency re-arm when ProgramData becomes writable again.
    if tombstone_error.is_some() {
        if let Err(error) =
            atomic_write(&intent_path(), &serde_json::to_vec_pretty(&tombstone)?).await
        {
            tracing::warn!("uninstall disarm: post-WFP tombstone write still failed: {error:#}");
        }
    }
    // Automatic recovery retains its narrow disposition for future Service starts.
    // Explicit intent deletion is best-effort once WFP is gone. The tombstone is already
    // on disk, so a leftover file cannot re-arm a block; refusing uninstall here recreated the
    // "result 3 forever" deadlock for Chinese test machines whose ProgramData ACLs deny the
    // final unlink under the elevated installer token.
    if !apply_narrow {
        match tokio::fs::remove_file(intent_path()).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                tracing::warn!(
                    "kill-switch intent could not be deleted after WFP removal (continuing): {error:#}"
                );
            }
        }
    }
    // BRICK-W4: Tono's NRPT catch-all sends every lookup to 198.18.0.2, which nothing answers
    // once the Core is gone, and a restart does not remove it. It must be proven gone before any
    // DNS outcome below is reported as continuable. A rule that remains puts its own blocking
    // marker in front of that outcome (see the end of this function). Only this entry point
    // (the uninstall helper and the elevated recovery CLI) runs the sweep; the Service never does.
    const NRPT_SWEEP_BUDGET: std::time::Duration = std::time::Duration::from_secs(10);
    let resolver_rule = crate::core::dns::remove_tono_resolver_rule_within(NRPT_SWEEP_BUDGET);
    // Everything below runs only once the WFP objects are provably gone: the engine_call `?`
    // above returns before it. Every imperfect DNS outcome is therefore tagged so the
    // uninstaller continues — the barrier that could leave a brick is already down.
    let dns_outcome = match dns_restore {
        // Rung 1: the snapshot was restored and proven. Nothing to report.
        Ok(crate::core::dns::UninstallDnsRestore::Exact) => Ok(()),
        // Rung 2: reported through the error channel on purpose. This entry point's contract has
        // always been "return the DNS deviation *after* the WFP cleanup so a caller cannot
        // report unqualified success", and rung 2 is a deviation — the user's own servers were
        // not restored. The marker is what turns it into a *continue*-with-warning at the
        // uninstaller instead of a refusal; a caller that does not know the marker keeps the old,
        // conservative reading, which is the correct default for anything that is not an
        // uninstall. Reachable only when this process opted into the ladder.
        Ok(crate::core::dns::UninstallDnsRestore::Automatic { adapters }) => {
            let snapshot = crate::service_paths()
                .persistent_state_dir()
                .join("protected-dns.json");
            Err(anyhow::anyhow!(
                "{}: WFP was removed and {} adapter(s) were set back to automatic (DHCP) DNS \
                 because the saved servers could not be proven restored. The machine resolves \
                 through the network's own DNS again; this is not the exact previous \
                 configuration. The saved servers were kept next to {snapshot:?} under a \
                 `protected-dns.superseded-*.json` name if they are needed. Uninstall may \
                 continue: nothing of Tono's is left blocking or redirecting this machine.",
                crate::core::dns::DNS_RESTORED_AUTOMATIC_PREFIX,
                adapters.len(),
            ))
        }
        // Rung 3 or any other post-removal DNS failure: WFP is already gone. Tag with the
        // continue marker so install/uninstall never dead-end as result 3. The inner error
        // still names STILL_ON_LOOPBACK / snapshot paths so the detail log can tell the user
        // how to fix DNS in Windows Settings.
        Err(error) => {
            let snapshot = crate::service_paths()
                .persistent_state_dir()
                .join("protected-dns.json");
            Err(anyhow::anyhow!(
                "{}: WFP was removed, but DNS restore could not be proven: {error:#}. \
                 Recovery snapshot: {snapshot:?}. The network barrier is gone so install and \
                 uninstall may continue. If name resolution is still wrong, open Settings → \
                 Network & Internet → your adapter → DNS server assignment → Automatic (DHCP) \
                 for both IPv4 and IPv6.",
                crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX,
            ))
        }
    };
    // The blocking marker leads, and the DNS outcome follows it unchanged. The recovery CLI
    // checks this marker first, so it still blocks there. The uninstall helper sweeps again and
    // blocks if the rule remains; when that sweep proves the rule gone, it reports what the DNS
    // restore really did (an exact restore is exit 0, not a DHCP reset).
    if let Err(error) = resolver_rule {
        let dns = match &dns_outcome {
            Ok(()) => String::new(),
            Err(dns_error) => format!(" The DNS restore reported: {dns_error:#}"),
        };
        return Err(anyhow::anyhow!(
            "{}: WFP was removed, but Tono's DNS rule (the NRPT catch-all that sends every lookup \
             to 198.18.0.2) could not be removed: {error:#}. Name lookups keep going to the \
             stopped Tono resolver until it is gone. Run the Start-Menu shortcut \
             \"Tono — 恢复网络 (Restore Network)\" as administrator again, or run the uninstaller \
             again.{dns}",
            crate::core::dns::DNS_RESOLVER_POLICY_REMAINS_PREFIX,
        ));
    }
    dns_outcome
}

pub(crate) async fn status() -> KillSwitchStatus {
    // Never join the WFP writer queue. The watchdog refreshes `LAST_VERIFY`; mutations publish
    // `ARMED` only at their commit boundary, so a concurrent read gets the previous committed
    // state rather than blocking behind an RPC that may itself be the thing under diagnosis.
    let armed = { armed_guard().clone() };
    let Some(armed) = armed else {
        return KillSwitchStatus {
            wanted: false,
            verified: false,
            live: false,
            mode: KillSwitchStatusMode::Blocked,
            tunnel_permit_rendered: false,
            endpoints: Vec::new(),
            direct_endpoint_digest: crate::direct_endpoint_digest(&[]).unwrap_or_default(),
            last_error: last_error_guard().clone(),
            reconnect_after_release: RECONNECT_AFTER_RELEASE.load(Ordering::Relaxed),
        };
    };
    let live = if ENGINE_LIVE {
        verify_reads_live(*last_verify_guard())
    } else {
        // No engine behind this build: report the recorded intent without claiming liveness.
        false
    };
    KillSwitchStatus {
        wanted: armed.intent.wanted,
        // Durable predecessor proof permits crash recovery, but cannot acknowledge this
        // arm's MarkVerified request while its independent Connect deadline is pending.
        verified: armed.intent.is_verified() && !FRESH_ARM_PROOF_PENDING.load(Ordering::Acquire),
        live,
        mode: armed.intent.mode,
        // What the last render decided, not what a render right now would decide: this is a
        // report on the policy that is installed, and it must not run a fresh core-manager read
        // on the status path.
        tunnel_permit_rendered: TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed),
        endpoints: armed.intent.endpoints.clone(),
        direct_endpoint_digest: crate::direct_endpoint_digest(&armed.direct_endpoints)
            .unwrap_or_default(),
        last_error: last_error_guard().clone(),
        reconnect_after_release: !armed.intent.wanted
            && (armed.intent.reconnect_after_release
                || RECONNECT_AFTER_RELEASE.load(Ordering::Relaxed)),
    }
}

/// Pending-update recovery has the same selective disposition as ordinary automatic cleanup.
#[cfg(any(windows, test))]
pub(crate) async fn release_for_update_disconnect(apply_narrow: bool) -> Result<KillSwitchStatus> {
    if apply_narrow {
        anyhow::ensure!(!strict_kill_switch_enabled(), "automatic update cleanup cannot release explicit strict protection");
        release_applying_narrow().await
    } else {
        release().await
    }
}

/// `/status` aggregate: present only where the WFP backend exists; the macOS fields stay the
/// source of truth there.
pub(crate) async fn status_snapshot() -> Option<KillSwitchStatus> {
    if cfg!(windows) {
        Some(status().await)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::structure::{KillSwitchConfig, ProxyEndpoint, ProxyProtocol};
    use serial_test::serial;

    #[test]
    fn a_lost_committed_direct_lease_releases_unless_the_kill_switch_is_strict() {
        let expired = "committed DIRECT heartbeat lease expired after App/session liveness was lost";
        assert!(committed_direct_lease_failure_releases(expired, false));
        assert!(!committed_direct_lease_failure_releases(expired, true));
        assert!(!committed_direct_lease_failure_releases(
            "pending DIRECT endpoints expired before App finalization",
            false,
        ));
    }

    /// Stop is accepted while startup can still be inside DNS restore, and an
    /// unverified retirement can run that restore again. The posted hint is
    /// shorter than those two budgets, so the checkpoint has to be refreshed
    /// inside a single budget.
    #[test]
    fn scm_stop_hint_refreshes_before_a_dns_restore_can_outlive_it() {
        assert!(
            SCM_STOP_WAIT_HINT < DNS_RESTORE_TIMEOUT.saturating_mul(2),
            "one wait hint cannot cover startup restore plus unverified retirement"
        );
        assert!(SCM_STOP_HINT_REFRESH < DNS_RESTORE_TIMEOUT);
        assert!(SCM_STOP_HINT_REFRESH < SCM_STOP_WAIT_HINT);
        assert!(stop_pending_refresh_due(SCM_STOP_HINT_REFRESH));
        assert!(!stop_pending_refresh_due(
            SCM_STOP_HINT_REFRESH - std::time::Duration::from_secs(1)
        ));
    }

    /// Scoped failure seams: reset even when an assertion panics so the serial suite cannot be
    /// poisoned for every later WFP/persistence test.
    struct SimulatedStateFailures;

    impl SimulatedStateFailures {
        fn arm_removal() -> Self {
            TEST_REMOVE_FAILURE.store(true, Ordering::Relaxed);
            Self
        }

        fn arm(persist: bool, install: bool) -> Self {
            TEST_PERSIST_ATTEMPTS.store(0, Ordering::Relaxed);
            TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);
            TEST_PERSIST_FAILURE.store(persist, Ordering::Relaxed);
            TEST_INSTALL_FAILURE.store(install, Ordering::Relaxed);
            TEST_AMBIGUOUS_INSTALL_FAILURE.store(false, Ordering::Relaxed);
            Self
        }

        fn arm_ambiguous_install() -> Self {
            TEST_PERSIST_ATTEMPTS.store(0, Ordering::Relaxed);
            TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);
            TEST_PERSIST_FAILURE.store(false, Ordering::Relaxed);
            TEST_INSTALL_FAILURE.store(false, Ordering::Relaxed);
            TEST_AMBIGUOUS_INSTALL_FAILURE.store(true, Ordering::Relaxed);
            Self
        }
    }

    impl Drop for SimulatedStateFailures {
        fn drop(&mut self) {
            TEST_REMOVE_FAILURE.store(false, Ordering::Relaxed);
            TEST_PERSIST_FAILURE.store(false, Ordering::Relaxed);
            TEST_INSTALL_FAILURE.store(false, Ordering::Relaxed);
            TEST_AMBIGUOUS_INSTALL_FAILURE.store(false, Ordering::Relaxed);
        }
    }

    fn test_config() -> KillSwitchConfig {
        KillSwitchConfig {
            tunnel_interface: "Tono".to_owned(),
            proxy_endpoints: vec![ProxyEndpoint {
                ip: "8.8.8.8".to_owned(),
                port: 443,
                protocol: ProxyProtocol::Tcp,
            }],
            bootstrap_api_hosts: vec!["1.1.1.1".to_owned()],
            direct_endpoints: Vec::new(),
        }
    }

    fn test_config_with_direct() -> KillSwitchConfig {
        KillSwitchConfig {
            direct_endpoints: vec![
                ProxyEndpoint {
                    ip: "9.0.0.9".to_owned(),
                    port: 443,
                    protocol: ProxyProtocol::Tcp,
                },
                ProxyEndpoint {
                    ip: "9.0.0.10".to_owned(),
                    port: 8000,
                    protocol: ProxyProtocol::Udp,
                },
            ],
            ..test_config()
        }
    }

    /// What a watchdog tick renders for this session right now.
    async fn render(armed: &Armed) -> RuleConfig {
        rule_config_rendering(armed, current_core_instance().await)
    }

    fn dns_snapshot_path() -> PathBuf {
        crate::service_paths()
            .persistent_state_dir()
            .join("protected-dns.json")
    }

    fn valid_intent(mode: KillSwitchStatusMode, wanted: bool) -> IntentRecord {
        IntentRecord {
            wanted,
            mode,
            // Existing tests use this as an established-session fixture; migration behavior is
            // covered separately with JSON that omits the field.
            verified: Some(true),
            tunnel_interface: "Tono".to_owned(),
            app_path: "/opt/tono/mihomo".to_owned(),
            endpoints: test_config().proxy_endpoints,
            api_host_ips: vec!["1.1.1.1".to_owned()],
            updated_at: 1,
            owner_key: None,
            strict_kill_switch: false,
            reconnect_after_release: false,
            apply_narrow_after_release: None,
        }
    }

    #[test]
    fn legacy_verification_migration_depends_on_mode() {
        for (mode, expected) in [
            (KillSwitchStatusMode::Locked, true),
            (KillSwitchStatusMode::Blocked, false),
            (KillSwitchStatusMode::Bootstrap, false),
        ] {
            let mut value = serde_json::to_value(valid_intent(mode, true)).unwrap();
            value.as_object_mut().unwrap().remove("verified");
            let intent: IntentRecord = serde_json::from_value(value).unwrap();
            assert_eq!(intent.verified, None);
            assert_eq!(intent.is_verified(), expected, "{mode:?}");
        }
    }

    #[tokio::test]
    #[serial]
    async fn a_failed_arm_keeps_the_existing_secondary_ai_hold() -> Result<()> {
        cleanup().await;
        crate::core::selective_layer::finish_release(true).await;
        let failures = SimulatedStateFailures::arm(false, true);

        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice")
            .await
            .expect_err("the live WFP installation fails");
        assert!(
            crate::core::selective_layer::test_hold_active(),
            "a failed replacement barrier must not remove the existing AI hold"
        );

        drop(failures);
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        assert!(status().await.wanted);
        assert!(
            !crate::core::selective_layer::test_hold_active(),
            "a successful replacement removes the sinkhole so tunnel DNS can work"
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn fresh_arm_releases_after_app_verification_never_arrives() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        assert_eq!(
            reconcile_wanted_core_window_unlocked().await?,
            WantedCoreWindow::Keep,
            "StartClash must have time to publish Core after arming"
        );
        let deadline = *WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let deadline = deadline.expect("a fresh arm must bound an interrupted Connect");
        assert!(
            deadline > std::time::Instant::now() + std::time::Duration::from_secs(310),
            "the service must allow the App's complete cold-connect budget"
        );
        // StartClash completed, but the App died before the separate Lock/MarkVerified IPCs.
        let owner = crate::core::auth::AuthenticatedOwner {
            key: "owner-alice".to_owned(),
            identity: crate::OwnerIdentity::Unix { uid: 97005, gid: 20 },
            app_data_root: std::env::temp_dir(),
            peer_pid: None,
            peer_session_id: None,
        };
        crate::core::desired::persist_owner_core_started(&owner, &crate::ClashConfig::default())
            .await?;
        crate::core::desired::persist_active_owner(&owner).await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;
        assert_eq!(
            reconcile_wanted_core_window_unlocked().await?,
            WantedCoreWindow::Keep
        );
        *WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
        spawn_windows_kill_switch_watchdog();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let intent = tokio::fs::read(intent_path()).await.ok()
                    .and_then(|bytes| serde_json::from_slice::<IntentRecord>(&bytes).ok());
                if !status().await.wanted
                    && crate::core::selective_layer::test_hold_active()
                    && intent.is_some_and(|intent| !intent.wanted && intent.reconnect_after_release)
                {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the watchdog must retire an abandoned Connect");
        assert!(current_core_instance().await.is_none(), "Core must stop before WFP opens");
        assert!(!crate::core::desired::load_owner_desired_state(&owner.key).await?.core_should_be_running);
        assert!(crate::core::desired::load_active_owner().await?.is_none());
        assert!(crate::core::selective_layer::test_hold_active());
        let intent: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert!(!intent.wanted);
        assert!(intent.reconnect_after_release);
        assert!(lock(None).await.is_err(), "a late Lock cannot revive the expired arm");
        tokio::fs::remove_file(crate::service_paths().for_owner_key(&owner.key).desired_state_path()).await?;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn automatic_pending_update_disconnect_retains_the_ai_hold() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        let request = crate::update_wire::UpdateRequest::disconnect(true);
        let wire = serde_json::to_vec(&request)?;
        let received: crate::update_wire::UpdateRequest = serde_json::from_slice(&wire)?;
        let released = release_for_update_disconnect(received.applies_narrow_on_disconnect()).await?;
        let ai_held = crate::core::selective_layer::test_hold_active();
        cleanup().await;
        assert!(!released.wanted, "automatic failed-update cleanup must release general traffic");
        assert!(ai_held, "pending-update dispatch must not lose automatic cleanup's AI hold");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn automatic_pending_update_disconnect_preserves_strict_protection() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        armed_guard().as_mut().unwrap().intent.strict_kill_switch = true;
        let result = release_for_update_disconnect(true).await;
        let wanted = status().await.wanted;
        cleanup().await;
        assert!(result.is_err(), "automatic cleanup cannot release strict protection");
        assert!(wanted);
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn fresh_arm_verification_retires_the_connect_deadline() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;
        lock(None).await?;
        assert!(WANTED_CORE_DEADLINE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_some());
        mark_verified("owner-alice").await?;
        assert!(WANTED_CORE_DEADLINE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_none());
        // A reconnect inherits verified=true, but still needs its own App proof.
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        lock(None).await?;
        assert!(WANTED_CORE_DEADLINE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_some());
        mark_verified("owner-alice").await?;
        assert!(WANTED_CORE_DEADLINE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_none());
        assert!(status().await.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn inherited_verification_cannot_acknowledge_a_fresh_arm() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;
        lock(None).await?;
        mark_verified("owner-alice").await?;
        assert!(status().await.verified);

        // The new arm retains durable reconnect evidence, but no new MarkVerified arrived.
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        lock(None).await?;
        assert!(armed_guard().as_ref().unwrap().intent.is_verified());
        let readback = status().await;
        assert!(readback.wanted && readback.tunnel_permit_rendered);
        assert_eq!(readback.mode, KillSwitchStatusMode::Locked);
        assert!(!readback.verified, "a lost request cannot be acknowledged by its predecessor's proof");
        assert!(FRESH_ARM_PROOF_PENDING.load(Ordering::Acquire));

        mark_verified("owner-alice").await?;
        assert!(status().await.verified, "a lost reply can still be acknowledged by fresh proof");
        assert!(!FRESH_ARM_PROOF_PENDING.load(Ordering::Acquire));
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn fresh_arm_expiry_cannot_retire_a_successor_connect() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        let expired_epoch = FRESH_ARM_EPOCH.load(Ordering::Acquire);
        *WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
        assert!(expired_fresh_arm_owner(expired_epoch).is_some());
        // The old expiry queued for lifecycle while a successor Connect acquired it first.
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4243, 2)))
            .await;
        crate::core::server::retire_expired_fresh_arm(expired_epoch).await?;
        assert!(status().await.wanted);
        assert_eq!(current_core_instance().await, Some(CoreInstance { pid: 4243, generation: 2 }));
        assert!(!crate::core::selective_layer::test_hold_active());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn fresh_arm_expiry_releases_when_another_owner_holds_the_core_record() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        let bob = crate::core::auth::AuthenticatedOwner {
            key: "owner-bob".to_owned(),
            identity: crate::OwnerIdentity::Unix { uid: 97_011, gid: 20 },
            app_data_root: std::env::temp_dir(),
            peer_pid: None,
            peer_session_id: None,
        };
        crate::core::desired::persist_active_owner(&bob).await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4251, 1)))
            .await;
        *WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());

        let retired = crate::core::server::retire_expired_fresh_arm(FRESH_ARM_EPOCH.load(Ordering::Acquire)).await;
        let wanted = status().await.wanted;
        let held = crate::core::selective_layer::test_hold_active();
        let core = current_core_instance().await;
        let active = crate::core::desired::load_active_owner().await?;
        crate::core::desired::clear_active_owner().await?;
        cleanup().await;

        retired?;
        assert!(!wanted, "an expired arm must not stay Blocked over a foreign owner record");
        assert!(held, "the release keeps AI blocked");
        assert_eq!(core, Some(CoreInstance { pid: 4251, generation: 1 }), "another owner's Core is not stopped");
        assert_eq!(active.map(|owner| owner.owner_key).as_deref(), Some("owner-bob"));
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn fresh_arm_expiry_releases_when_the_run_intent_cannot_be_retired() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        // A directory where the desired-state file belongs: every read and write of it fails,
        // like a persistent ProgramData ACL or AV-handle failure.
        let desired = crate::core::paths::service_paths()
            .for_owner_key("owner-alice")
            .desired_state_path();
        tokio::fs::create_dir_all(&desired).await?;
        let alice = crate::core::auth::AuthenticatedOwner {
            key: "owner-alice".to_owned(),
            identity: crate::OwnerIdentity::Unix {
                uid: 97_013,
                gid: 20,
            },
            app_data_root: std::env::temp_dir(),
            peer_pid: None,
            peer_session_id: None,
        };
        crate::core::desired::persist_active_owner(&alice).await?;
        *WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());

        // The intent store fails too, so the release cannot write its tombstone.
        let failures = SimulatedStateFailures::arm(true, false);
        let retired =
            crate::core::server::retire_expired_fresh_arm(FRESH_ARM_EPOCH.load(Ordering::Acquire))
                .await;
        let wanted = status().await.wanted;
        let held = crate::core::selective_layer::test_hold_active();
        drop(failures);
        // The fault clears and the Service restarts in the same boot.
        let restarted = restore_on_service_start().await;
        let wanted_after_restart = status().await.wanted;
        let active = crate::core::desired::load_active_owner().await;
        let _ = crate::core::desired::clear_active_owner().await;
        tokio::fs::remove_dir_all(&desired).await?;
        cleanup().await;

        assert!(
            retired.is_err(),
            "the unwritten tombstone is still reported: {retired:?}"
        );
        assert!(
            !wanted,
            "a stopped abandoned Connect must not stay Blocked on a run-intent write failure"
        );
        assert!(held, "the release keeps AI blocked");
        restarted?;
        assert!(
            !wanted_after_restart,
            "a same-boot restart must not restore the retired session's barrier"
        );
        assert!(
            active?.is_none(),
            "the active owner is cleared even though the run intent could not be written"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn fresh_arm_deadline_preserves_explicit_strict_protection() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        armed_guard().as_mut().unwrap().intent.strict_kill_switch = true;
        *WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(std::time::Instant::now());
        assert_eq!(
            reconcile_wanted_core_window_unlocked().await?,
            WantedCoreWindow::Keep
        );
        assert!(status().await.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn exhausted_core_notification_cannot_expire_a_successor_arm() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        let exhausted_epoch = core_arm_epoch();
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        let successor_deadline = *WANTED_CORE_DEADLINE.lock().unwrap();
        note_core_recovery_exhausted(exhausted_epoch).await;
        assert_eq!(*WANTED_CORE_DEADLINE.lock().unwrap(), successor_deadline);
        assert!(expired_fresh_arm_owner(core_arm_epoch()).is_none());
        assert!(status().await.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn exhausted_core_notification_preserves_explicit_strict_protection() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        armed_guard().as_mut().unwrap().intent.strict_kill_switch = true;
        clear_wanted_core_window();
        note_core_recovery_exhausted(core_arm_epoch()).await;
        assert!(WANTED_CORE_DEADLINE.lock().unwrap().is_none());
        assert!(status().await.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn arm_inherits_verification_only_for_same_owner() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        mark_verified("owner-alice").await?;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        assert!(ARMED.lock().unwrap().as_ref().unwrap().intent.is_verified());
        TEST_OWNER_SIGNED_OUT.store(true, Ordering::Relaxed);
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-bob").await?;
        assert!(!ARMED.lock().unwrap().as_ref().unwrap().intent.is_verified());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn mark_verified_requires_locked_matching_owner_and_is_idempotent() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        assert!(mark_verified("owner-alice").await.is_err());
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;
        lock(None).await?;
        assert!(mark_verified("owner-bob").await.is_err());
        mark_verified("owner-alice").await?;
        mark_verified("owner-alice").await?;
        assert!(ARMED.lock().unwrap().as_ref().unwrap().intent.is_verified());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn mark_verified_recovers_a_poisoned_armed_lock() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;
        lock(None).await?;

        struct ClearPoison;
        impl Drop for ClearPoison {
            fn drop(&mut self) {
                ARMED.clear_poison();
            }
        }
        let poison = ClearPoison;
        assert!(
            std::thread::spawn(|| {
                let _armed = ARMED.lock().unwrap();
                panic!("simulate a panic while holding ARMED");
            })
            .join()
            .is_err()
        );
        assert!(ARMED.is_poisoned());

        mark_verified("owner-alice").await?;

        assert!(armed_guard().as_ref().unwrap().intent.is_verified());
        let persisted: IntentRecord =
            serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert_eq!(persisted.verified, Some(true));
        assert_eq!(persisted.owner_key.as_deref(), Some("owner-alice"));
        drop(poison);
        cleanup().await;
        Ok(())
    }

    /// A corrupt snapshot only refuses a restore while the machine is still resolving through
    /// the loopback core; off Windows that answer comes from a test hook, so tests that mean
    /// "restore is unprovable" must say so explicitly.
    fn simulate_machine_still_on_loopback_dns() {
        crate::core::dns::test_hooks::set_live_dns_on_loopback(true);
    }

    async fn assert_disarmed_tombstone_present() -> Result<()> {
        let intent: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert!(
            !intent.wanted,
            "explicit release must leave wanted=false evidence"
        );
        assert!(intent.owner_key.is_none());
        assert!(intent.endpoints.is_empty());
        Ok(())
    }

    async fn cleanup() {
        crate::core::selective_layer::remove().await;
        TEST_INTERRUPT_RELEASE_FOLLOW_UP.store(false, Ordering::SeqCst);
        TEST_REMOVE_FAILURE.store(false, Ordering::Relaxed);
        TEST_REMOVE_ATTEMPTS.store(0, Ordering::Relaxed);
        TEST_RESIDUAL_FILTER_KEYS.lock().unwrap().clear();
        TEST_PERSIST_FAILURE.store(false, Ordering::Relaxed);
        TEST_INSTALL_FAILURE.store(false, Ordering::Relaxed);
        TEST_AMBIGUOUS_INSTALL_FAILURE.store(false, Ordering::Relaxed);
        TEST_INTENT_VERIFY_CORRUPT.store(false, Ordering::Relaxed);
        TEST_PERSIST_ATTEMPTS.store(0, Ordering::Relaxed);
        TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);
        TEST_OWNER_SIGNED_OUT.store(false, Ordering::Relaxed);
        crate::core::dns::test_hooks::set_live_dns_on_loopback(false);
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(None).await;
        *ARMED.lock().unwrap() = None;
        *LAST_ERROR.lock().unwrap() = None;
        *LAST_VERIFY.lock().unwrap() = None;
        RESTORE_WAS_LOCKED.store(false, Ordering::Release);
        RESTORED_BARRIER_UNPROVEN.store(false, Ordering::Release);
        clear_wanted_core_window();
        RECONNECT_AFTER_RELEASE.store(false, Ordering::Release);
        CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
        CORE_REPLAY_EXPECTED.store(false, Ordering::Release);
        #[cfg(test)]
        TEST_CORE_STARTING.store(false, Ordering::Release);
        for path in [
            intent_path(),
            dns_snapshot_path(),
            crate::service_paths().active_owner_path(),
        ] {
            match tokio::fs::remove_file(path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => panic!("test cleanup failed: {error}"),
            }
        }
    }

    #[tokio::test]
    #[serial]
    async fn restore_with_valid_wanted_intent_rearms_and_downgrades_locked() -> Result<()> {
        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        let intent = valid_intent(KillSwitchStatusMode::Locked, true);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        restore_on_service_start().await?;

        let armed = ARMED.lock().unwrap().clone().expect("must be re-armed");
        assert_eq!(
            armed.intent.mode,
            KillSwitchStatusMode::Blocked,
            "a persisted Locked mode downgrades to Blocked until lock runs again"
        );
        assert!(armed.tun_luid.is_none());
        // The downgrade is persisted too.
        let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert_eq!(on_disk.mode, KillSwitchStatusMode::Blocked);
        assert_eq!(on_disk.verified, Some(true));
        assert!(status().await.wanted);
        cleanup().await;
        Ok(())
    }

    /// A restored verified wanted block is released at once when Core is neither
    /// running nor starting. While Core is starting, it stays up only until
    /// [`WANTED_CORE_PROOF_WINDOW`]. Needs real-hardware calibration of that cap.
    #[tokio::test]
    #[serial]
    async fn wanted_session_releases_when_core_is_not_proven_in_time() -> Result<()> {
        assert_eq!(WANTED_CORE_PROOF_WINDOW, std::time::Duration::from_secs(30));
        assert_eq!(
            wanted_core_window_action(true, false, true, false),
            WantedCoreWindow::Keep,
            "an explicit strict kill switch keeps the restored block"
        );
        assert_eq!(
            wanted_core_window_action(false, false, false, false),
            WantedCoreWindow::Release,
            "a Core that is neither running nor starting is released immediately"
        );
        assert_eq!(
            wanted_core_window_action(false, true, false, false),
            WantedCoreWindow::Keep,
            "a starting Core keeps the block until the cap"
        );
        assert_eq!(
            wanted_core_window_action(false, true, true, false),
            WantedCoreWindow::Release
        );
        assert_eq!(
            wanted_core_window_action(false, true, true, true),
            WantedCoreWindow::Proven
        );
        assert!(!restored_connection_proven(
            false,
            true,
            KillSwitchStatusMode::Locked,
            true
        ));
        assert!(restored_connection_proven(
            true,
            true,
            KillSwitchStatusMode::Locked,
            true
        ));

        cleanup().await;
        let intent = valid_intent(KillSwitchStatusMode::Locked, true);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
        restore_on_service_start().await?;
        let released = status().await;
        assert!(
            !released.wanted,
            "no Core process and no replay releases before the cap"
        );
        assert!(released.reconnect_after_release);
        assert!(
            crate::core::selective_layer::test_hold_active(),
            "an unproven Core must leave AI destinations blocked after general traffic is released"
        );
        let on_disk: IntentRecord =
            serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert!(!on_disk.wanted);
        assert!(on_disk.reconnect_after_release);

        *ARMED.lock().unwrap() = None;
        RECONNECT_AFTER_RELEASE.store(false, Ordering::Release);
        restore_on_service_start().await?;
        assert!(!status().await.wanted);
        assert!(status().await.reconnect_after_release);
        assert!(
            tokio::fs::metadata(intent_path()).await.is_ok(),
            "the crash tombstone survives the next Service start"
        );

        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
        restore_on_service_start().await?;
        assert!(status().await.wanted, "a starting Core keeps the block");
        let deadline = WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .expect("a starting restore arms the core-proof window");
        assert!(deadline > std::time::Instant::now());
        assert_eq!(
            reconcile_wanted_core_window_unlocked().await?,
            WantedCoreWindow::Keep
        );
        TEST_CORE_STARTING.store(false, Ordering::Relaxed);
        note_core_replay_finished().await?;
        assert!(
            !status().await.wanted,
            "replay that settled with no process releases before the cap"
        );
        assert!(status().await.reconnect_after_release);

        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
        restore_on_service_start().await?;
        *WANTED_CORE_DEADLINE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some(std::time::Instant::now() - std::time::Duration::from_secs(1));
        assert_eq!(
            reconcile_wanted_core_window_unlocked().await?,
            WantedCoreWindow::Release
        );
        assert!(!status().await.wanted);

        cleanup().await;
        let mut strict = valid_intent(KillSwitchStatusMode::Locked, true);
        strict.strict_kill_switch = true;
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&strict)?).await?;
        restore_on_service_start().await?;
        assert!(
            WANTED_CORE_DEADLINE
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .is_none()
        );
        assert_eq!(
            reconcile_wanted_core_window_unlocked().await?,
            WantedCoreWindow::Keep
        );
        assert!(status().await.wanted, "strict keeps the block with no window");
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn startup_persist_failure_still_installs_and_publishes_blocked() -> Result<()> {
        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        let intent = valid_intent(KillSwitchStatusMode::Locked, true);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        let failures = SimulatedStateFailures::arm(true, false);
        let error = restore_on_service_start()
            .await
            .expect_err("the caller must still learn that durable reconciliation failed");
        assert!(
            format!("{error:#}").contains("persistent-state write failure"),
            "{error:#}"
        );
        assert_eq!(TEST_PERSIST_ATTEMPTS.load(Ordering::Relaxed), 1);
        assert_eq!(
            TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
            1,
            "a persistence failure must not skip the live Blocked install"
        );
        let blocked = armed_guard()
            .clone()
            .expect("watchdog must retain conservative startup state");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());

        drop(failures);
        // The same published snapshot is sufficient for the watchdog's next healthy repair.
        install_unlocked(&blocked).await?;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn startup_install_failure_still_persists_and_arms_watchdog_state() -> Result<()> {
        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        let intent = valid_intent(KillSwitchStatusMode::Locked, true);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        let failures = SimulatedStateFailures::arm(false, true);
        let error = restore_on_service_start()
            .await
            .expect_err("an unproved live Blocked set must be reported");
        assert!(
            format!("{error:#}").contains("WFP install failure"),
            "{error:#}"
        );
        assert_eq!(TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed), 1);
        assert_eq!(
            TEST_PERSIST_ATTEMPTS.load(Ordering::Relaxed),
            1,
            "a live install failure must not skip durable Blocked persistence"
        );
        let blocked = armed_guard()
            .clone()
            .expect("failed startup install must leave watchdog state armed");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert_eq!(on_disk.mode, KillSwitchStatusMode::Blocked);

        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 99)))
            .await;
        retract_direct_before_core_replacement()
            .await
            .expect_err("replacement spawn must remain refused until exact Blocked succeeds");
        assert_eq!(
            TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
            2,
            "the pre-spawn barrier must retry despite an empty restored DIRECT receipt"
        );
        assert!(
            crate::core::manager::security_core_instance_snapshot().is_none(),
            "failed narrowing still freezes Core identity before returning"
        );

        drop(failures);
        install_unlocked(&blocked).await?;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn startup_double_failure_reports_both_and_keeps_conservative_state() -> Result<()> {
        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        let intent = valid_intent(KillSwitchStatusMode::Locked, true);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        let failures = SimulatedStateFailures::arm(true, true);
        let error = restore_on_service_start()
            .await
            .expect_err("neither failed proof may be hidden");
        let message = format!("{error:#}");
        assert!(
            message.contains("persistent-state write failure"),
            "{message}"
        );
        assert!(message.contains("WFP install failure"), "{message}");
        assert_eq!(TEST_PERSIST_ATTEMPTS.load(Ordering::Relaxed), 1);
        assert_eq!(TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed), 1);
        let blocked = armed_guard()
            .clone()
            .expect("even a double failure must arm watchdog reconciliation");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());

        drop(failures);
        install_unlocked(&blocked).await?;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn legacy_locked_migration_stays_verified_across_a_second_restart() -> Result<()> {
        cleanup().await;
        // The migration is about a session Core may still return to, not the idle release.
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        let mut value = serde_json::to_value(valid_intent(KillSwitchStatusMode::Locked, true))?;
        value.as_object_mut().unwrap().remove("verified");
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&value)?).await?;

        restore_on_service_start().await?;
        *ARMED.lock().unwrap() = None;
        restore_on_service_start().await?;

        let armed = ARMED
            .lock()
            .unwrap()
            .clone()
            .expect("must remain fail-closed");
        assert!(armed.intent.is_verified());
        assert_eq!(armed.intent.mode, KillSwitchStatusMode::Blocked);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn intent_write_isolated_tmps_and_verified_commit() -> Result<()> {
        cleanup().await;
        let dir = crate::service_paths()
            .persistent_state_dir()
            .join("intent-write-test");
        tokio::fs::create_dir_all(&dir).await?;
        let path = dir.join("probe.json");

        // Sequential writes commit exactly what was asked, with no shared
        // temporary left behind for a later writer to delete or reuse.
        atomic_write(&path, b"{\"wanted\":true}").await?;
        atomic_write(&path, b"{\"wanted\":false}").await?;
        assert_eq!(tokio::fs::read(&path).await?, b"{\"wanted\":false}");
        let mut entries = tokio::fs::read_dir(&dir).await?;
        let mut names = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
        assert_eq!(
            names,
            vec!["probe.json".to_owned()],
            "unique tmps must be renamed away; a shared tmp must never exist"
        );

        // Concurrent writers never tear: the destination always holds one
        // complete write, and at least the last writer verifies its own
        // commit (a stale commit landing first is reported, not kept).
        let (first, second) = tokio::join!(
            atomic_write(&path, b"first-writer"),
            atomic_write(&path, b"second-writer")
        );
        assert!(
            first.is_ok() || second.is_ok(),
            "at least the last writer verifies its own commit"
        );
        let committed = tokio::fs::read(&path).await?;
        assert!(
            committed.as_slice() == b"first-writer"
                || committed.as_slice() == b"second-writer",
            "concurrent intent writes must never tear"
        );

        // A stale rename landing between replace and read-back is a loud
        // error, never a quiet older intent.
        TEST_INTENT_VERIFY_CORRUPT.store(true, Ordering::Relaxed);
        let error = atomic_write(&path, b"third-writer")
            .await
            .expect_err("a stale destination after replace must fail verification");
        assert!(format!("{error:#}").contains("did not commit"));

        tokio::fs::remove_dir_all(&dir).await?;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn interrupted_automatic_release_replays_the_ai_hold_on_service_start() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        TEST_INTERRUPT_RELEASE_FOLLOW_UP.store(true, Ordering::SeqCst);
        release_after_service_stop().await?;
        assert!(!status().await.wanted);
        assert!(!crate::core::selective_layer::test_hold_active());

        // A fresh Service has only the persisted disposition; no native hold was installed.
        RECONNECT_AFTER_RELEASE.store(false, Ordering::Release);
        restore_on_service_start().await?;
        let held = crate::core::selective_layer::test_hold_active();
        let wanted = status().await.wanted;
        cleanup().await;
        assert!(held, "automatic AI-hold intent must survive interruption before native installation");
        assert!(!wanted, "replaying a narrow hold must not restore a general block");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn idle_stop_preserves_automatic_ai_recovery_across_service_death() -> Result<()> {
        cleanup().await;
        release_applying_narrow().await?;
        release_after_service_stop().await?;
        crate::core::selective_layer::remove().await; // Native hold was lost during replacement.
        restore_on_service_start().await?;
        let held = crate::core::selective_layer::test_hold_active();
        cleanup().await;
        assert!(held, "idle Stop must keep the durable automatic AI disposition");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn replacement_preserves_automatic_ai_recovery_disposition() -> Result<()> {
        cleanup().await;
        release_applying_narrow().await?;
        assert!(prepare_for_service_replacement().await?);
        crate::core::selective_layer::remove().await;
        restore_on_service_start().await?;
        let held = crate::core::selective_layer::test_hold_active();
        cleanup().await;
        assert!(held, "Service replacement must retain automatic AI intent");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn interrupted_update_emergency_release_replays_the_ai_hold() -> Result<()> {
        cleanup().await;
        TEST_INTERRUPT_RELEASE_FOLLOW_UP.store(true, Ordering::SeqCst);
        emergency_disarm_windows_kill_switch_applying_narrow().await?;
        assert!(!crate::core::selective_layer::test_hold_active());
        restore_on_service_start().await?;
        let held = crate::core::selective_layer::test_hold_active();
        let wanted = status().await.wanted;
        cleanup().await;
        assert!(held, "automatic emergency release must retain the replay record");
        assert!(!wanted, "replay cannot re-arm broad WFP");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn interrupted_explicit_restore_cancels_the_durable_ai_hold() -> Result<()> {
        cleanup().await;
        release_applying_narrow().await?;
        TEST_INTERRUPT_RELEASE_FOLLOW_UP.store(true, Ordering::SeqCst);
        release().await?;
        assert!(crate::core::selective_layer::test_hold_active());
        restore_on_service_start().await?;
        let held = crate::core::selective_layer::test_hold_active();
        cleanup().await;
        assert!(!held, "explicit Restore must supersede persisted automatic AI intent");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn idle_stop_keeps_corrupt_automatic_recovery_evidence() -> Result<()> {
        cleanup().await;
        atomic_write(&intent_path(), b"corrupt-auto-recovery").await?;
        restore_on_service_start().await?;
        release_after_service_stop().await?;
        let evidence = tokio::fs::read(intent_path()).await?;
        crate::core::selective_layer::remove().await;
        restore_on_service_start().await?;
        let held = crate::core::selective_layer::test_hold_active();
        cleanup().await;
        assert_eq!(evidence, b"corrupt-auto-recovery");
        assert!(held, "corrupt evidence must still request automatic recovery on restart");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn legacy_crash_reconnect_tombstone_replays_the_ai_hold() -> Result<()> {
        cleanup().await;
        let mut legacy = serde_json::to_value(crash_recovery_tombstone())?;
        legacy.as_object_mut().unwrap().remove("apply_narrow_after_release");
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&legacy)?).await?;
        restore_on_service_start().await?;
        let held = crate::core::selective_layer::test_hold_active();
        let reconnect = status().await.reconnect_after_release;
        cleanup().await;
        assert!(held, "legacy crash reconnect intent still requests the automatic AI hold");
        assert!(reconnect);
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn service_stop_release_keeps_the_ai_hold_for_an_armed_session() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

        release_after_service_stop().await?;
        let released = !status().await.wanted && armed_guard().is_none();
        let ai_held = crate::core::selective_layer::test_hold_active();
        cleanup().await;

        assert!(released, "ordinary Service stop must release general traffic");
        assert!(ai_held, "automatic Service stop must apply the AI hold");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn service_stop_release_does_not_reapply_ai_hold_after_explicit_restore() -> Result<()> {
        cleanup().await;
        crate::core::selective_layer::finish_release(true).await;
        release().await?;

        release_after_service_stop().await?;
        let ai_held = crate::core::selective_layer::test_hold_active();
        cleanup().await;

        assert!(
            !ai_held,
            "idle Stop after explicit Restore must stay unprotected"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn service_stop_release_preserves_an_existing_idle_ai_hold() -> Result<()> {
        cleanup().await;
        crate::core::selective_layer::finish_release(true).await;

        release_after_service_stop().await?;
        let ai_held = crate::core::selective_layer::test_hold_active();
        cleanup().await;

        assert!(
            ai_held,
            "idle Stop cannot remove a previous crash recovery hold"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn service_stop_release_preserves_an_explicit_strict_intent() -> Result<()> {
        cleanup().await;
        let mut intent = valid_intent(KillSwitchStatusMode::Blocked, true);
        intent.strict_kill_switch = true;
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
        restore_on_service_start().await?;

        release_after_service_stop().await?;
        let wanted = status().await.wanted;
        cleanup().await;

        assert!(
            wanted,
            "automatic Stop cannot retire explicit strict protection"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn unverified_startup_intent_releases_with_ai_hold_when_dns_cannot_be_proven()
    -> Result<()> {
        cleanup().await;
        let mut intent = valid_intent(KillSwitchStatusMode::Blocked, true);
        intent.verified = Some(false);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
        simulate_machine_still_on_loopback_dns();
        atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

        restore_on_service_start().await?;

        assert!(ARMED.lock().unwrap().is_some());
        assert!(status().await.wanted);

        // Decision 031 (#1259): a non-strict machine must not stay Blocked because retirement
        // could not prove DNS. The error still reaches the caller so no desired Core is restored.
        let error = retire_unverified_on_service_start()
            .await
            .expect_err("an unclean retirement is still reported to the caller");
        let released = ARMED.lock().unwrap().is_none() && !status().await.wanted;
        let ai_held = crate::core::selective_layer::test_hold_active();
        let dns_evidence_kept = tokio::fs::metadata(dns_snapshot_path()).await.is_ok();
        let tombstone = assert_disarmed_tombstone_present().await;
        cleanup().await;

        assert!(format!("{error:#}").contains("corrupt"), "{error:#}");
        assert!(
            released,
            "non-strict startup recovery must release general traffic"
        );
        assert!(ai_held, "the release must keep the secondary AI hold");
        assert!(
            dns_evidence_kept,
            "failed DNS evidence must remain available for recovery"
        );
        tombstone
    }

    #[tokio::test]
    #[serial]
    async fn unverified_startup_recovery_keeps_ai_hold_after_releasing_general_traffic() -> Result<()> {
        cleanup().await;
        crate::core::desired::clear_active_owner().await?;
        let mut intent = valid_intent(KillSwitchStatusMode::Bootstrap, true);
        intent.verified = Some(false);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        restore_on_service_start().await?;
        assert!(retire_unverified_on_service_start().await?);
        let released = !status().await.wanted && armed_guard().is_none();
        let ai_held = crate::core::selective_layer::test_hold_active();
        cleanup().await;

        assert!(
            released,
            "interrupted initial connection must release general traffic"
        );
        assert!(
            ai_held,
            "automatic startup recovery must keep the secondary AI hold"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn unverified_startup_recovery_preserves_an_explicit_strict_intent() -> Result<()> {
        cleanup().await;
        let mut intent = valid_intent(KillSwitchStatusMode::Bootstrap, true);
        intent.verified = Some(false);
        intent.strict_kill_switch = true;
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        restore_on_service_start().await?;
        let retired = retire_unverified_on_service_start().await?;
        let wanted = status().await.wanted;
        cleanup().await;

        assert!(
            !retired,
            "automatic recovery cannot retire an explicit strict intent"
        );
        assert!(wanted, "the strict barrier must remain armed");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn verified_startup_intent_is_never_retired_by_initial_attempt_cleanup() -> Result<()> {
        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        let intent = valid_intent(KillSwitchStatusMode::Locked, true);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        restore_on_service_start().await?;

        assert!(!retire_unverified_on_service_start().await?);
        assert!(ARMED.lock().unwrap().is_some());
        assert!(tokio::fs::metadata(intent_path()).await.is_ok());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn legacy_unowned_unverified_cleanup_cannot_resurrect_desired_core() -> Result<()> {
        use crate::core::auth::AuthenticatedOwner;
        use crate::{ClashConfig, CoreConfig, OwnerIdentity};

        cleanup().await;
        crate::core::desired::clear_active_owner().await?;
        let owner = AuthenticatedOwner {
            key: "legacy-unowned-wfp-owner".to_owned(),
            identity: OwnerIdentity::Unix {
                uid: 91_001,
                gid: 20,
            },
            app_data_root: std::env::temp_dir(),
            peer_pid: None,
            peer_session_id: None,
        };
        let config = ClashConfig {
            core_config: CoreConfig {
                core_path: "/tmp/legacy-unowned-core".to_owned(),
                ..Default::default()
            },
            log_config: Default::default(),
        };
        crate::core::desired::persist_owner_core_started(&owner, &config).await?;
        crate::core::desired::persist_active_owner(&owner).await?;

        let mut intent = valid_intent(KillSwitchStatusMode::Blocked, true);
        intent.verified = Some(false);
        intent.owner_key = None;
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
        restore_on_service_start().await?;

        assert!(retire_unverified_on_service_start().await?);
        assert!(crate::core::desired::load_active_owner().await?.is_none());
        assert!(
            !crate::core::desired::load_owner_desired_state(&owner.key)
                .await?
                .core_should_be_running
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn restore_with_unwanted_intent_cleans_residual_state() -> Result<()> {
        cleanup().await;
        let intent = valid_intent(KillSwitchStatusMode::Blocked, false);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        restore_on_service_start().await?;

        assert!(ARMED.lock().unwrap().is_none());
        assert!(
            tokio::fs::metadata(intent_path()).await.is_err(),
            "an unwanted intent record must be removed"
        );
        assert!(!status().await.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn unwanted_startup_removal_failure_retries_until_residual_filters_are_gone() -> Result<()>
    {
        cleanup().await;
        let mut intent = valid_intent(KillSwitchStatusMode::Blocked, false);
        intent.endpoints.clear();
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
        let residual = wfp_model::intent_floor()
            .iter()
            .map(|filter| filter.key)
            .collect::<Vec<_>>();
        *TEST_RESIDUAL_FILTER_KEYS.lock().unwrap() = residual.clone();
        let failures = SimulatedStateFailures::arm_removal();

        let error = restore_on_service_start()
            .await
            .expect_err("the initial WFP removal fails");

        assert!(format!("{error:#}").contains("simulated WFP removal failure"));
        assert!(armed_guard().is_none());
        assert!(STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire));
        assert!(
            status()
                .await
                .last_error
                .unwrap()
                .contains("release pending")
        );
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while TEST_REMOVE_ATTEMPTS.load(Ordering::Relaxed) < 2 {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await?;
        assert_eq!(*TEST_RESIDUAL_FILTER_KEYS.lock().unwrap(), residual);
        assert_disarmed_tombstone_present().await?;
        drop(failures);

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire) {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await?;

        assert!(TEST_RESIDUAL_FILTER_KEYS.lock().unwrap().is_empty());
        assert_eq!(
            tokio::fs::metadata(intent_path()).await.unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
        assert!(armed_guard().is_none());
        assert!(!TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed));
        assert!(status().await.last_error.is_none());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn startup_release_retry_preserves_the_crash_reconnect_marker() -> Result<()> {
        cleanup().await;
        let intent = crash_recovery_tombstone();
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
        let failures = SimulatedStateFailures::arm_removal();

        restore_on_service_start()
            .await
            .expect_err("the initial WFP removal fails");
        drop(failures);
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire) {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await?;

        assert!(
            status().await.reconnect_after_release,
            "successful retry must still tell the app to reconnect"
        );
        let persisted: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert!(crate::core::selective_layer::test_hold_active(), "startup retry must replay the durable AI hold");
        assert!(persisted.reconnect_after_release);
        assert!(!persisted.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn explicit_release_tombstone_survives_until_replacement_start_consumes_it() -> Result<()>
    {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

        release().await?;
        assert_disarmed_tombstone_present().await?;

        // The in-place replacement is a fresh process; only the on-disk tombstone crosses it.
        *ARMED.lock().unwrap() = None;
        restore_on_service_start().await?;

        assert!(ARMED.lock().unwrap().is_none());
        assert!(
            tokio::fs::metadata(intent_path()).await.is_err(),
            "startup consumes the tombstone only after the residual-filter cleanup"
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn replacement_marks_a_pre_fix_disconnected_install_but_preserves_wanted_intent()
    -> Result<()> {
        cleanup().await;

        assert!(prepare_for_service_replacement().await?);
        assert_disarmed_tombstone_present().await?;

        let wanted = valid_intent(KillSwitchStatusMode::Locked, true);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&wanted)?).await?;
        assert!(
            !prepare_for_service_replacement().await?,
            "a valid wanted session must stay fail-closed across replacement"
        );
        let preserved: IntentRecord =
            serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert!(preserved.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn replacement_never_synthesizes_an_open_marker_for_an_active_owner() -> Result<()> {
        cleanup().await;
        let active = crate::core::desired::ActiveOwnerState {
            owner_key: "owner-active".to_owned(),
            identity: crate::OwnerIdentity::Windows {
                sid: "S-1-5-21-test-owner".to_owned(),
            },
            app_data_root: std::env::temp_dir().to_string_lossy().into_owned(),
            generation: 7,
            session_token_hash: "session-hash".to_owned(),
        };
        atomic_write(
            &crate::service_paths().active_owner_path(),
            &serde_json::to_vec_pretty(&active)?,
        )
        .await?;

        assert!(!prepare_for_service_replacement().await?);
        assert!(
            tokio::fs::metadata(intent_path()).await.is_err(),
            "an active owner with missing WFP evidence is ambiguous and must not be opened"
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn replacement_preserves_corrupt_active_owner_evidence_fail_closed() -> Result<()> {
        cleanup().await;
        atomic_write(
            &crate::service_paths().active_owner_path(),
            b"{ corrupt active owner evidence",
        )
        .await?;

        assert!(!prepare_for_service_replacement().await?);
        assert!(
            tokio::fs::metadata(intent_path()).await.is_err(),
            "damaged owner evidence is ambiguity, never permission to synthesize wanted=false"
        );
        assert_eq!(
            tokio::fs::read(crate::service_paths().active_owner_path()).await?,
            b"{ corrupt active owner evidence",
            "replacement preparation must retain evidence for diagnosis"
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn replacement_preserves_corrupt_intent_fail_closed() -> Result<()> {
        cleanup().await;
        atomic_write(&intent_path(), b"{ corrupt wanted evidence").await?;

        assert!(!prepare_for_service_replacement().await?);
        assert_eq!(
            tokio::fs::read(intent_path()).await?,
            b"{ corrupt wanted evidence"
        );
        cleanup().await;
        Ok(())
    }

    /// An unusable wanted record is not an explicit strict opt-in. Startup releases and
    /// leaves the file in place.
    #[tokio::test]
    #[serial]
    async fn an_unusable_wanted_intent_releases_unless_strict() -> Result<()> {
        cleanup().await;
        let mut intent = valid_intent(KillSwitchStatusMode::Locked, true);
        intent.endpoints = vec![ProxyEndpoint {
            ip: "not-an-ip".to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        }];
        let bytes = serde_json::to_vec_pretty(&intent)?;
        atomic_write(&intent_path(), &bytes).await?;

        restore_on_service_start().await?;

        assert!(armed_guard().is_none());
        assert!(!status().await.wanted);
        assert_eq!(tokio::fs::read(intent_path()).await?, bytes);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn an_unusable_strict_intent_keeps_the_emergency_block() -> Result<()> {
        cleanup().await;
        let mut intent = valid_intent(KillSwitchStatusMode::Locked, true);
        intent.strict_kill_switch = true;
        intent.endpoints = vec![ProxyEndpoint {
            ip: "not-an-ip".to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        }];
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        restore_on_service_start().await?;

        let armed = armed_guard().clone().expect("strict opt-in keeps a block");
        assert!(armed.intent.strict_kill_switch);
        assert!(armed.intent.wanted);
        assert!(armed.intent.endpoints.is_empty());
        assert!(status().await.wanted);
        assert!(tokio::fs::metadata(intent_path()).await.is_ok());
        cleanup().await;
        Ok(())
    }

    /// S2 in miniature: a DNS restore that never returns must not hold `WFP_OPERATION` — and
    /// the refusal must keep the disarm on the fail-closed side, never skip the proof.
    #[tokio::test]
    #[serial]
    async fn a_stalled_dns_restore_is_bounded_and_refuses_the_operation() -> Result<()> {
        let error = bounded_dns_call_within(
            std::time::Duration::from_millis(50),
            "disarm",
            std::future::pending::<Result<()>>(),
        )
        .await
        .expect_err("a DNS restore that never returns must not be awaited forever");
        let message = format!("{error:#}");
        assert!(message.contains(DNS_RESTORE_STALLED_PREFIX), "{message}");
        assert!(message.contains("disarm"), "{message}");

        // A healthy call is transparent in both directions: the bound adds no behavior of its
        // own, so every caller keeps treating a DNS failure exactly as it did before.
        let value = bounded_dns_call_within(std::time::Duration::from_secs(5), "disarm", async {
            Result::<u8>::Ok(7)
        })
        .await?;
        assert_eq!(value, 7);
        let error = bounded_dns_call_within(std::time::Duration::from_secs(5), "disarm", async {
            Result::<()>::Err(anyhow::anyhow!("snapshot is corrupt"))
        })
        .await
        .expect_err("DNS errors still propagate");
        assert!(format!("{error:#}").contains("corrupt"));
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn explicit_release_supersedes_a_pending_crash_tombstone() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        let failures = SimulatedStateFailures::arm(true, false);
        release_unproven_wanted_session_unlocked().await
            .expect_err("the crash tombstone write fails after WFP is released");
        assert!(CRASH_TOMBSTONE_PENDING.load(Ordering::Acquire));
        drop(failures);

        release().await?;
        assert!(!status().await.reconnect_after_release);
        // The watchdog retries its old failed write after the successful Disconnect.
        retry_crash_tombstone_unlocked().await;
        // A later Service restart must recover the user's Disconnect, not the older crash.
        restore_on_service_start().await?;
        assert!(
            !status().await.reconnect_after_release,
            "a pending crash write must not resurrect reconnect intent after Disconnect"
        );
        assert!(!status().await.wanted);
        assert!(!crate::core::selective_layer::test_hold_active());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn restore_with_corrupt_intent_releases_and_keeps_evidence() -> Result<()> {
        cleanup().await;
        atomic_write(&intent_path(), b"{ not json").await?;

        restore_on_service_start().await?;

        assert!(
            armed_guard().is_none(),
            "corrupt bytes are not an explicit strict opt-in"
        );
        assert!(!status().await.wanted);
        assert_eq!(tokio::fs::read(intent_path()).await?, b"{ not json");
        assert!(
            crate::core::selective_layer::test_hold_active(),
            "crash recovery must retain the narrow AI hold after opening general traffic"
        );
        release().await?;
        assert!(!crate::core::selective_layer::test_hold_active());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn corrupt_startup_removal_failure_retries_and_keeps_evidence_and_ai_hold() -> Result<()>
    {
        cleanup().await;
        let evidence = b"{ incomplete intent";
        atomic_write(&intent_path(), evidence).await?;
        let residual = wfp_model::intent_floor()
            .iter()
            .map(|filter| filter.key)
            .collect::<Vec<_>>();
        *TEST_RESIDUAL_FILTER_KEYS.lock().unwrap() = residual.clone();
        let failures = SimulatedStateFailures::arm_removal();

        let error = restore_on_service_start()
            .await
            .expect_err("the initial native removal fails");
        assert!(format!("{error:#}").contains("simulated WFP removal failure"));
        assert!(armed_guard().is_none());
        assert_eq!(*TEST_RESIDUAL_FILTER_KEYS.lock().unwrap(), residual);
        drop(failures);

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !TEST_RESIDUAL_FILTER_KEYS.lock().unwrap().is_empty()
                || STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire)
            {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("recovery must retry after the transient removal error clears");

        assert!(TEST_REMOVE_ATTEMPTS.load(Ordering::Relaxed) >= 2);
        assert_eq!(tokio::fs::read(intent_path()).await?, evidence);
        assert!(crate::core::selective_layer::test_hold_active());
        assert!(!status().await.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn corrupt_startup_release_retry_preserves_a_new_unusable_strict_record() -> Result<()> {
        cleanup().await;
        atomic_write(&intent_path(), b"{ incomplete intent").await?;
        let residual = wfp_model::intent_floor()
            .iter()
            .map(|filter| filter.key)
            .collect::<Vec<_>>();
        *TEST_RESIDUAL_FILTER_KEYS.lock().unwrap() = residual.clone();
        let failures = SimulatedStateFailures::arm_removal();
        restore_on_service_start()
            .await
            .expect_err("the initial removal fails");

        let operation = WFP_OPERATION.lock().await;
        let mut strict = valid_intent(KillSwitchStatusMode::Blocked, true);
        strict.strict_kill_switch = true;
        strict.endpoints.clear();
        assert!(!intent_is_valid(&strict));
        let strict_bytes = serde_json::to_vec_pretty(&strict)?;
        atomic_write(&intent_path(), &strict_bytes).await?;
        let attempts = TEST_REMOVE_ATTEMPTS.load(Ordering::Relaxed);
        drop(failures);
        drop(operation);

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while STARTUP_RELEASE_RETRY_RUNNING.load(Ordering::Acquire) {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await?;

        assert_eq!(TEST_REMOVE_ATTEMPTS.load(Ordering::Relaxed), attempts);
        assert_eq!(*TEST_RESIDUAL_FILTER_KEYS.lock().unwrap(), residual);
        assert_eq!(tokio::fs::read(intent_path()).await?, strict_bytes);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn restore_with_unreadable_intent_releases() -> Result<()> {
        cleanup().await;
        // A directory at the intent path makes the read fail with a non-NotFound error on
        // every platform — the stand-in for ACL damage or transient I/O on a real service.
        tokio::fs::create_dir_all(intent_path()).await?;

        restore_on_service_start().await?;

        assert!(armed_guard().is_none());
        assert!(!status().await.wanted);

        tokio::fs::remove_dir(intent_path()).await?;
        cleanup().await;
        Ok(())
    }

    #[test]
    fn service_stop_releases_only_without_strict_or_lifecycle_ownership() {
        assert!(release_on_service_stop(false, false));
        assert!(!release_on_service_stop(true, false));
        assert!(!release_on_service_stop(false, true));
        assert!(!release_on_service_stop(true, true));
    }

    #[test]
    fn unhealthy_watchdog_releases_without_a_strict_opt_in() {
        assert!(crash_recovery_releases_network(false));
        assert_eq!(
            unhealthy_watchdog_action(false, UNHEALTHY_RELEASE_TICKS - 1),
            UnhealthyWatchdogAction::Wait
        );
        assert_eq!(
            unhealthy_watchdog_action(false, UNHEALTHY_RELEASE_TICKS),
            UnhealthyWatchdogAction::Release
        );
    }

    #[test]
    fn strict_kill_switch_repairs_then_releases() {
        assert!(!crash_recovery_releases_network(true));
        assert_eq!(
            unhealthy_watchdog_action(true, 1),
            UnhealthyWatchdogAction::Reinstall
        );
        assert_eq!(
            unhealthy_watchdog_action(true, STRICT_UNHEALTHY_RELEASE_TICKS),
            UnhealthyWatchdogAction::Release
        );
    }

    #[tokio::test]
    #[serial]
    async fn restore_with_missing_intent_is_a_noop() -> Result<()> {
        cleanup().await;

        restore_on_service_start().await?;

        assert!(ARMED.lock().unwrap().is_none());
        assert!(!status().await.wanted);
        cleanup().await;
        Ok(())
    }

    #[test]
    fn a_release_supersedes_a_startclash_that_began_before_it() {
        let captured = release_epoch();
        assert!(!release_superseded(captured));
        note_explicit_release();
        assert!(release_superseded(captured));
        let later = release_epoch();
        assert!(!release_superseded(later));
    }

    #[test]
    fn restore_unions_learned_public_pins_after_existing_hosts() {
        let merged = union_api_hosts(
            &["104.20.26.170".to_owned(), "10.0.0.1".to_owned()],
            &[
                "9.9.9.9".to_owned(),
                "198.18.0.2".to_owned(),
                "104.20.26.170".to_owned(),
            ],
        );
        assert_eq!(merged[0], "104.20.26.170");
        assert!(merged.contains(&"9.9.9.9".to_owned()));
        assert!(!merged.iter().any(|ip| ip == "10.0.0.1"));
        assert!(!merged.iter().any(|ip| ip == "198.18.0.2"));
        assert!(merged.len() <= wfp_model::MAX_API_HOST_IPS);
    }

    #[test]
    #[serial]
    fn apply_learned_bootstrap_pins_reads_the_programdata_file() {
        let dir = crate::service_paths().install_dir();
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("control-plane-pins.json");
        std::fs::write(
            &path,
            r#"{"host":"api.afk.ccwu.cc","addresses":["9.9.9.9","198.18.0.1"]}"#,
        )
        .expect("write learned pins");
        let mut intent = IntentRecord {
            wanted: true,
            mode: KillSwitchStatusMode::Locked,
            verified: Some(true),
            tunnel_interface: "Tono".to_owned(),
            app_path: r"C:\Program Files\Tono\verge-mihomo.exe".to_owned(),
            endpoints: Vec::new(),
            api_host_ips: vec!["104.20.26.170".to_owned()],
            updated_at: 0,
            owner_key: None,
            strict_kill_switch: false,
            reconnect_after_release: false,
            apply_narrow_after_release: None,
        };
        apply_learned_bootstrap_pins(&mut intent);
        let _ = std::fs::remove_file(&path);
        assert_eq!(intent.api_host_ips[0], "104.20.26.170");
        assert!(intent.api_host_ips.contains(&"9.9.9.9".to_owned()));
        assert!(!intent.api_host_ips.iter().any(|ip| ip == "198.18.0.1"));
    }

    /// The bootstrap channel's destinations are whatever the *client* pinned, never whatever a
    /// resolver answered: a hostname is dropped, not looked up, so no DHCP resolver, captive
    /// portal or on-path spoofer can nominate a destination this service permits through its
    /// own block. Order, dedup, the public-only table and the cap are unchanged.
    #[test]
    fn api_hosts_admit_public_literals_only_and_never_resolve_a_name() {
        let ips = admit_api_host_ips(&[
            " 1.1.1.1 ".to_owned(),
            "api.example.invalid".to_owned(),
            "localhost".to_owned(),
            String::new(),
            "8.8.8.8".to_owned(),
            "1.1.1.1".to_owned(),
            "10.0.0.1".to_owned(),
            "127.0.0.1".to_owned(),
        ]);
        assert_eq!(
            ips,
            vec![
                "1.1.1.1".parse::<IpAddr>().unwrap(),
                "8.8.8.8".parse::<IpAddr>().unwrap(),
            ]
        );

        // The count cap still bounds what a client can ask for, hostnames or not.
        let many = (0..32)
            .map(|index| format!("8.8.{}.{}", index / 256, index % 256 + 1))
            .collect::<Vec<_>>();
        assert!(admit_api_host_ips(&many).len() <= wfp_model::MAX_API_HOST_IPS);
        assert!(
            admit_api_host_ips(&["api.example.invalid".to_owned()]).is_empty(),
            "a hostname must yield no permit at all"
        );
    }

    #[tokio::test]
    #[serial]
    async fn transition_after_stop_without_release_restricts_to_bootstrap() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

        transition_after_stop(false).await?;

        let armed = ARMED.lock().unwrap().clone().expect("must stay armed");
        assert_eq!(armed.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(armed.tun_luid.is_none());
        let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert_eq!(on_disk.mode, KillSwitchStatusMode::Blocked);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn disarm_is_refused_until_dns_restore_is_proven() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        // A corrupt DNS snapshot makes the restore unprovable: the disarm must be refused and
        // the block must stay armed (the macOS DNS-before-disarm invariant).
        simulate_machine_still_on_loopback_dns();
        atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

        let error = transition_after_stop(true)
            .await
            .expect_err("disarm must be refused while DNS restore is unproven");
        assert!(format!("{error:#}").contains("corrupt"));
        assert!(
            ARMED.lock().unwrap().is_some(),
            "a refused disarm keeps the block armed"
        );
        assert!(tokio::fs::metadata(intent_path()).await.is_ok());

        // With the snapshot gone there is nothing left to restore, so the same release
        // succeeds and tears everything down.
        tokio::fs::remove_file(dns_snapshot_path()).await?;
        transition_after_stop(true).await?;
        assert!(ARMED.lock().unwrap().is_none());
        assert_disarmed_tombstone_present().await?;
        assert!(!status().await.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn disarm_succeeds_after_a_proven_dns_restore() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        // A valid, empty snapshot restores trivially (the stubbed engine is a no-op).
        let snapshot = crate::core::dns::DnsSnapshot {
            version: 1,
            taken_at: 1,
            adapters: Vec::new(),
        };
        atomic_write(&dns_snapshot_path(), &serde_json::to_vec_pretty(&snapshot)?).await?;

        transition_after_stop(true).await?;

        assert!(ARMED.lock().unwrap().is_none());
        assert!(tokio::fs::metadata(dns_snapshot_path()).await.is_err());
        assert_disarmed_tombstone_present().await?;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn failed_update_emergency_release_keeps_the_secondary_ai_hold() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        simulate_machine_still_on_loopback_dns();
        atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

        let error = emergency_disarm_windows_kill_switch_applying_narrow()
            .await
            .expect_err("DNS restore failure must still be reported after WFP removal");
        assert!(
            format!("{error:#}").contains(crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX)
        );
        assert!(!status().await.wanted);
        assert!(
            crate::core::selective_layer::test_hold_active(),
            "automatic update failure must retain the narrow AI hold after opening general traffic"
        );

        emergency_disarm_windows_kill_switch().await.unwrap_err();
        assert!(!crate::core::selective_layer::test_hold_active());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn emergency_disarm_removes_wfp_intent_but_reports_unrestored_dns() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        simulate_machine_still_on_loopback_dns();
        atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

        let error = emergency_disarm_windows_kill_switch()
            .await
            .expect_err("unproven DNS restore must fail the uninstall contract");

        let message = format!("{error:#}");
        assert!(message.contains("WFP was removed"), "{message}");
        assert!(message.contains("protected-dns.json"), "{message}");
        assert!(
            message.contains(crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX),
            "post-WFP DNS failure must be tagged so uninstall cannot brick as result 3: {message}"
        );
        assert!(ARMED.lock().unwrap().is_none());
        assert!(
            tokio::fs::metadata(intent_path()).await.is_err(),
            "removed WFP must not be re-armed from a stale intent on reboot"
        );
        assert!(
            tokio::fs::metadata(dns_snapshot_path()).await.is_ok(),
            "failed DNS proof must remain available for retry"
        );
        assert!(
            !message.contains(crate::core::dns::DNS_RESTORED_AUTOMATIC_PREFIX),
            "without the uninstaller's opt-in the DNS ladder must not run — the Start-Menu \
             \"Restore Network\" entry exists to put the user's own servers back on a machine \
             that is staying installed, and must not silently flatten them to DHCP: {message}"
        );
        cleanup().await;
        Ok(())
    }

    // --- The uninstall-only escalation ladder ---

    /// Opts the *process* into `dns::restore_for_uninstall`, exactly as `uninstall_service.rs`
    /// does, and takes it back out again so no other test inherits it.
    struct UninstallLadderOptIn;

    impl UninstallLadderOptIn {
        fn enter() -> Self {
            // SAFETY: every test that uses this is `#[serial]`, so no other thread in this
            // binary is reading or writing the environment while it is set.
            unsafe { std::env::set_var(UNINSTALL_LADDER_ENV, "1") };
            Self
        }
    }

    impl Drop for UninstallLadderOptIn {
        fn drop(&mut self) {
            // SAFETY: as above.
            unsafe { std::env::remove_var(UNINSTALL_LADDER_ENV) };
        }
    }

    /// A snapshot whose originals are ordinary public resolvers, so every adapter in it is one
    /// Tono redirected and is therefore a legitimate target for the DHCP reset.
    fn redirected_snapshot() -> crate::core::dns::DnsSnapshot {
        crate::core::dns::DnsSnapshot {
            version: 1,
            taken_at: 1,
            adapters: vec![
                crate::core::dns::AdapterDnsSnapshot {
                    interface_guid: "{ETHERNET}".to_owned(),
                    ipv4_name_server: Some("1.1.1.1".to_owned()),
                    ..Default::default()
                },
                crate::core::dns::AdapterDnsSnapshot {
                    interface_guid: "{WIFI}".to_owned(),
                    ipv4_name_server: Some("8.8.8.8".to_owned()),
                    ..Default::default()
                },
            ],
        }
    }

    /// Whether the ladder set the live snapshot aside under its `superseded` name instead of
    /// deleting the user's only record of their original resolvers.
    async fn superseded_snapshot_exists() -> bool {
        let paths = crate::service_paths();
        let directory = paths.persistent_state_dir();
        let Ok(mut entries) = tokio::fs::read_dir(&directory).await else {
            return false;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("protected-dns.superseded-") {
                return true;
            }
        }
        false
    }

    async fn remove_superseded_snapshots() {
        let paths = crate::service_paths();
        let directory = paths.persistent_state_dir();
        let Ok(mut entries) = tokio::fs::read_dir(&directory).await else {
            return;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("protected-dns.superseded-") {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }

    /// Rung 1: nothing changes for a machine whose exact restore is provable. The ladder is an
    /// escalation, not a shortcut — it must never reach for DHCP while the saved servers can be
    /// put back.
    #[tokio::test]
    #[serial]
    async fn uninstall_ladder_prefers_the_exact_restore() -> Result<()> {
        cleanup().await;
        remove_superseded_snapshots().await;
        let _opt_in = UninstallLadderOptIn::enter();
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        atomic_write(
            &dns_snapshot_path(),
            &serde_json::to_vec_pretty(&crate::core::dns::DnsSnapshot {
                version: 1,
                taken_at: 1,
                adapters: Vec::new(),
            })?,
        )
        .await?;

        emergency_disarm_windows_kill_switch()
            .await
            .expect("a provable restore reports plain success");

        assert!(ARMED.lock().unwrap().is_none());
        assert!(tokio::fs::metadata(dns_snapshot_path()).await.is_err());
        assert!(
            !superseded_snapshot_exists().await,
            "rung 1 must not leave a superseded snapshot behind"
        );
        cleanup().await;
        Ok(())
    }

    /// Rung 2 — the regression this ladder exists for. The machine is still resolving through
    /// the loopback core when the exact restore is attempted, so the old code returned an
    /// unqualified failure, `uninstall_service.rs` exited 3 and `installer.nsi` aborted: the
    /// application could not be uninstalled at all. Now the adapters are reset to automatic
    /// (DHCP), verified off the loopback resolver, and the failure carries the marker that lets
    /// the uninstall continue.
    #[tokio::test]
    #[serial]
    async fn uninstall_ladder_falls_back_to_automatic_dns_instead_of_becoming_unremovable()
    -> Result<()> {
        cleanup().await;
        remove_superseded_snapshots().await;
        let _opt_in = UninstallLadderOptIn::enter();
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        atomic_write(
            &dns_snapshot_path(),
            &serde_json::to_vec_pretty(&redirected_snapshot())?,
        )
        .await?;
        // The reported machine: the exact restore cannot be proven because adapters still read
        // as the loopback redirect. The DHCP reset is what clears that.
        simulate_machine_still_on_loopback_dns();

        let error = emergency_disarm_windows_kill_switch()
            .await
            .expect_err("an inexact restore is still reported, but as a continuable one");
        let message = format!("{error:#}");

        assert!(
            message.contains(crate::core::dns::DNS_RESTORED_AUTOMATIC_PREFIX),
            "the fallback must be reported with the marker the uninstaller keys its \
             continue-with-warning exit code off: {message}"
        );
        assert!(
            !message.contains(crate::core::dns::DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX),
            "{message}"
        );
        // The invariant: the marker may only ever be produced once the barrier is gone.
        assert!(
            ARMED.lock().unwrap().is_none(),
            "the continuing outcome must never be reported while the kill switch is armed"
        );
        assert!(
            tokio::fs::metadata(intent_path()).await.is_err(),
            "a continuing uninstall must not leave an intent record that re-arms on reboot"
        );
        assert!(
            tokio::fs::metadata(dns_snapshot_path()).await.is_err(),
            "the redirect is gone, so the live snapshot must not survive to be replayed"
        );
        assert!(
            superseded_snapshot_exists().await,
            "the user's original servers must be retained under the superseded name, not deleted"
        );

        remove_superseded_snapshots().await;
        cleanup().await;
        Ok(())
    }

    /// Rung 3: DNS may still be stuck on Tono's resolver, but WFP is already gone. The error is
    /// still reported (so the detail log can tell the user to flip DNS to Automatic), and it is
    /// tagged with the continue marker so install/uninstall never dead-end as result 3.
    #[tokio::test]
    #[serial]
    async fn uninstall_ladder_reports_stuck_dns_but_lets_uninstall_continue_after_wfp_is_gone()
    -> Result<()> {
        cleanup().await;
        remove_superseded_snapshots().await;
        let _opt_in = UninstallLadderOptIn::enter();
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        atomic_write(
            &dns_snapshot_path(),
            &serde_json::to_vec_pretty(&redirected_snapshot())?,
        )
        .await?;
        simulate_machine_still_on_loopback_dns();
        // Neither the exact restore nor the DHCP reset lands, so nothing takes the machine off
        // the loopback resolver.
        crate::core::dns::test_hooks::set_live_apply_fails(true);

        let error = emergency_disarm_windows_kill_switch()
            .await
            .expect_err("stuck DNS is still reported, but as a continuable outcome");
        let message = format!("{error:#}");

        assert!(
            message.contains(crate::core::dns::DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX),
            "{message}"
        );
        assert!(
            message.contains(crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX),
            "post-WFP DNS failure must carry the continue marker so result 3 cannot fire: \
             {message}"
        );
        assert!(
            message.contains("Automatic (DHCP)"),
            "the report has to tell the user what to do about DNS: {message}"
        );
        // The barrier is removed: being unable to remove the app *and* being blocked offline is
        // the worse end state, and the barrier is the half that makes them offline.
        assert!(ARMED.lock().unwrap().is_none());
        assert!(tokio::fs::metadata(intent_path()).await.is_err());
        assert!(
            tokio::fs::metadata(dns_snapshot_path()).await.is_ok(),
            "imperfect DNS restore preserves the snapshot so the user can recover originals"
        );
        assert!(!superseded_snapshot_exists().await);

        crate::core::dns::test_hooks::set_live_apply_fails(false);
        remove_superseded_snapshots().await;
        cleanup().await;
        Ok(())
    }

    /// BRICK-W4: once WFP was gone every DNS outcome carried `TONO_WFP_REMOVED`, so the
    /// uninstall finished while Tono's NRPT catch-all still sent every lookup to 198.18.0.2. A
    /// rule that cannot be removed has its own marker now, and that marker blocks.
    #[tokio::test]
    #[serial]
    async fn emergency_disarm_blocks_uninstall_while_the_nrpt_rule_remains() -> Result<()> {
        cleanup().await;
        remove_superseded_snapshots().await;
        let _opt_in = UninstallLadderOptIn::enter();
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        atomic_write(
            &dns_snapshot_path(),
            &serde_json::to_vec_pretty(&redirected_snapshot())?,
        )
        .await?;
        crate::core::dns::test_hooks::set_encrypted_restore_fails(true);

        let result = emergency_disarm_windows_kill_switch().await;
        crate::core::dns::test_hooks::set_encrypted_restore_fails(false);
        let message = format!(
            "{:#}",
            result.expect_err("a remaining NRPT rule must not read as a finished disarm")
        );

        assert!(message.starts_with("TONO_DNS_POLICY_REMAINS"), "{message}");
        assert!(
            message.contains(crate::core::dns::WFP_REMOVED_CONTINUE_PREFIX),
            "the DNS outcome follows the blocking marker, for the helper's final call: {message}"
        );
        assert!(ARMED.lock().unwrap().is_none(), "the barrier is removed");
        remove_superseded_snapshots().await;
        cleanup().await;
        Ok(())
    }

    /// The opt-in is the whole boundary between the two behaviours: an unset or unrecognised
    /// value must leave the strict path in force, because everything that is not an uninstall
    /// still wants the user's exact servers back.
    #[test]
    #[serial]
    fn only_an_explicit_opt_in_enables_the_uninstall_ladder() {
        // SAFETY: `#[serial]` peers; this test touches the variable alone.
        unsafe { std::env::remove_var(UNINSTALL_LADDER_ENV) };
        assert!(!uninstall_ladder_requested());
        for value in ["", "0", "true", "yes", "2"] {
            unsafe { std::env::set_var(UNINSTALL_LADDER_ENV, value) };
            assert!(
                !uninstall_ladder_requested(),
                "{value:?} must not be read as an opt-in"
            );
        }
        unsafe { std::env::set_var(UNINSTALL_LADDER_ENV, "1") };
        assert!(uninstall_ladder_requested());
        unsafe { std::env::remove_var(UNINSTALL_LADDER_ENV) };
    }

    #[tokio::test]
    #[serial]
    async fn release_when_armed_disarms_and_reports_status() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        assert!(status().await.wanted);

        let status = release().await?;

        assert!(!status.wanted, "released status reports wanted=false");
        assert!(ARMED.lock().unwrap().is_none());
        assert_disarmed_tombstone_present().await?;
        cleanup().await;
        Ok(())
    }

    /// WIN-TOMBSTONE-REBLOCK: the tombstone write failing after the filters are proven gone
    /// must not walk the release back. Reinstalling the previous policy re-blocked the machine
    /// on every Disconnect for as long as the write kept failing (ACL damage, an AV lock); the
    /// release now stands, no wanted intent survives, and the residual is surfaced through
    /// `last_error` instead.
    #[tokio::test]
    #[serial]
    async fn a_failed_tombstone_write_after_removal_stays_released() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        // Every persistent write fails from here on (the arm above already committed).
        let failures = SimulatedStateFailures::arm(true, false);

        let status = release().await?;

        assert!(!status.wanted, "the release is final once the filters are gone");
        assert!(ARMED.lock().unwrap().is_none());
        assert_eq!(
            TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
            0,
            "the previous policy must not be reinstalled over a failed tombstone write"
        );
        assert!(
            tokio::fs::metadata(intent_path()).await.is_err(),
            "no wanted intent may survive a failed tombstone write"
        );
        let last_error = status
            .last_error
            .expect("the failed release recording must be reported");
        assert!(
            last_error.contains("recording the release failed"),
            "unexpected last_error: {last_error}"
        );

        drop(failures);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn release_when_not_armed_is_an_idempotent_success() -> Result<()> {
        cleanup().await;

        // The whole point of the route: after a stop the session is gone and possibly the
        // switch was never armed — the explicit release must still succeed.
        let status = release().await?;
        assert!(!status.wanted);
        assert_disarmed_tombstone_present().await?;
        let again = release().await?;
        assert!(!again.wanted);
        assert_disarmed_tombstone_present().await?;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn release_when_not_armed_still_attempts_dns_restore_best_effort() -> Result<()> {
        cleanup().await;
        // Nothing armed, but a previous emergency left a corrupt DNS snapshot behind: the
        // release succeeds (the filters are already gone, refusing buys nothing) and the
        // failed restore is surfaced through last_error.
        simulate_machine_still_on_loopback_dns();
        atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

        let status = release().await?;

        assert!(!status.wanted);
        let last_error = status
            .last_error
            .expect("an unrestorable snapshot must be reported");
        assert!(
            last_error.contains("could not be restored"),
            "unexpected last_error: {last_error}"
        );
        cleanup().await;
        Ok(())
    }

    /// H2-F2: a start by a different local user must not rewrite the recorded owner of armed
    /// protection while that user is still signed in; otherwise the takeover makes the refused
    /// release pass.
    #[tokio::test]
    #[serial]
    async fn another_signed_in_user_cannot_take_over_armed_protection() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

        let error = arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-bob")
            .await
            .expect_err("a second signed-in user must not take over armed protection");

        assert_eq!(
            error
                .downcast_ref::<crate::core::auth::ServiceError>()
                .map(|refusal| refusal.code),
            Some(crate::ServiceErrorCode::ProtectionHeldByAnotherUser)
        );
        let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert_eq!(on_disk.owner_key.as_deref(), Some("owner-alice"));
        cleanup().await;
        Ok(())
    }

    /// TW-anthropic-1: a first connect from a Remote Desktop (or unreadable) session would arm a
    /// block that cuts that session and cannot be released remotely, so it is refused. The
    /// console may connect, and only the caller's own *verified* protection keeps its reconnect
    /// path: an intent left by a failed first install proves no barrier was ever committed.
    #[test]
    fn a_remote_session_cannot_be_the_first_to_arm_protection() {
        use CallerSession::{Console, Remote, Unknown};
        fn refused(session: CallerSession, armed: Option<&IntentRecord>) -> bool {
            remote_session_connect_refused(session, armed, "owner-alice")
        }
        let owned = |verified: bool, owner: &str| IntentRecord {
            verified: Some(verified),
            owner_key: Some(owner.to_owned()),
            ..valid_intent(KillSwitchStatusMode::Bootstrap, true)
        };
        let verified = owned(true, "owner-alice");
        let intent_only = owned(false, "owner-alice");
        let other_users = owned(true, "owner-bob");

        assert!(!refused(Console, None));
        assert!(refused(Remote, None));
        assert!(refused(Unknown, None));

        assert!(!refused(Console, Some(&verified)));
        assert!(!refused(Remote, Some(&verified)));
        assert!(!refused(Unknown, Some(&verified)));

        assert!(!refused(Console, Some(&intent_only)));
        assert!(refused(Remote, Some(&intent_only)));
        assert!(refused(Unknown, Some(&intent_only)));

        assert!(refused(Remote, Some(&other_users)));
    }

    /// TW-R-boot: startup restore keeps a verified intent published (fail-closed, the watchdog
    /// retries) even when this start could not install its filters. That carried-over flag then
    /// proves no live barrier, so the owner's Remote Desktop exception waits for an install that
    /// succeeds.
    #[tokio::test]
    #[serial]
    async fn a_failed_startup_install_withholds_the_remote_reconnect_exception() -> Result<()> {
        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        let intent = IntentRecord {
            owner_key: Some("owner-alice".to_owned()),
            ..valid_intent(KillSwitchStatusMode::Locked, true)
        };
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        let failures = SimulatedStateFailures::arm(false, true);
        restore_on_service_start()
            .await
            .expect_err("the failed startup install must be reported");
        let restored = armed_guard().clone().expect("startup stays fail-closed");
        assert!(restored.intent.is_verified());
        assert!(
            connect_session_refused(CallerSession::Remote, "owner-alice"),
            "a verified intent whose filters this start never installed must not admit a remote connect"
        );

        drop(failures);
        // The watchdog's repair installs the same published snapshot.
        install_unlocked(&restored).await?;
        assert!(!connect_session_refused(
            CallerSession::Remote,
            "owner-alice"
        ));
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn write_authorization_follows_the_recorded_owner() -> Result<()> {
        cleanup().await;
        // Nothing armed: any authenticated owner may release (it is a no-op).
        authorize_write_for("owner-alice")?;

        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        authorize_write_for("owner-alice")?;
        let error = authorize_write_for("owner-bob")
            .expect_err("another local user must not release somebody else's protection");
        assert_eq!(error.code, crate::ServiceErrorCode::NotActive);
        // The intent file itself carries the owner key.
        let on_disk: IntentRecord = serde_json::from_slice(&tokio::fs::read(intent_path()).await?)?;
        assert_eq!(on_disk.owner_key.as_deref(), Some("owner-alice"));

        // A legacy/emergency intent without owner_key releases for any authenticated owner.
        *ARMED.lock().unwrap() = Some(Armed {
            intent: valid_intent(KillSwitchStatusMode::Blocked, true),
            tun_luid: None,
            core_instance: None,
            direct_endpoints: Vec::new(),
            reviewed_direct_ports: Vec::new(),
            direct_reload: None,
        });
        authorize_write_for("owner-bob")?;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn lock_rejects_an_interface_that_was_not_recorded_at_arm_time() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;

        let error = lock(Some("Ethernet"))
            .await
            .expect_err("locking a physical adapter must be refused");
        assert!(format!("{error:#}").contains("does not match"));
        // Zero side effects: still bootstrap, no LUID recorded.
        let armed = ARMED.lock().unwrap().clone().expect("still armed");
        assert_eq!(armed.intent.mode, KillSwitchStatusMode::Bootstrap);
        assert!(armed.tun_luid.is_none());

        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;
        lock(Some("Tono")).await?;
        let armed = ARMED.lock().unwrap().clone().expect("still armed");
        assert_eq!(armed.intent.mode, KillSwitchStatusMode::Locked);
        assert_eq!(armed.tun_luid, Some(0));
        cleanup().await;
        Ok(())
    }

    /// A panic while `ARMED` is held poisons the mutex. The next tunnel lock must recover the
    /// guard and still install the permit; `ARMED.lock().unwrap()` would panic the IPC task
    /// and leave the session unable to lock until the Service process restarts.
    #[tokio::test]
    #[serial]
    async fn lock_recovers_a_poisoned_armed_lock() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;

        struct ClearPoison;
        impl Drop for ClearPoison {
            fn drop(&mut self) {
                ARMED.clear_poison();
            }
        }
        let poison = ClearPoison;
        assert!(
            std::thread::spawn(|| {
                let _armed = ARMED.lock().unwrap();
                panic!("simulate a panic while holding ARMED");
            })
            .join()
            .is_err()
        );
        assert!(ARMED.is_poisoned());

        lock(Some("Tono")).await?;

        let armed = armed_guard()
            .clone()
            .expect("lock must proceed on a poisoned ARMED mutex");
        assert_eq!(armed.intent.mode, KillSwitchStatusMode::Locked);
        assert_eq!(armed.tun_luid, Some(0));
        assert_eq!(
            armed.core_instance,
            Some(CoreInstance {
                pid: 4242,
                generation: 1,
            })
        );
        drop(poison);
        cleanup().await;
        Ok(())
    }

    /// The tunnel permit is the widest rule this service installs: weight 8, `LocalInterface`
    /// only — no protocol, port, or app condition. WFP does not notice when the adapter behind
    /// that LUID dies, and `NetLuidIndex` is reused, so a permit that outlives the core it was
    /// granted for can end up naming whatever device receives that index next. It therefore
    /// expires with that core instance, and expiring must fail closed.
    #[test]
    fn a_tunnel_permit_expires_with_the_core_instance_it_was_granted_for() {
        let granted = CoreInstance {
            pid: 4242,
            generation: 0,
        };
        let mut armed = Armed {
            intent: valid_intent(KillSwitchStatusMode::Locked, true),
            tun_luid: Some(0x1234_5678),
            core_instance: Some(granted),
            direct_endpoints: vec![ProxyEndpoint {
                ip: "203.0.113.9".to_owned(),
                port: 443,
                protocol: ProxyProtocol::Tcp,
            }],
            reviewed_direct_ports: Vec::new(),
            direct_reload: None,
        };

        assert_eq!(
            rule_config_for(&armed, Some(granted)).tun_luid,
            Some(0x1234_5678),
            "the core that locked is still running"
        );

        for (label, current) in [
            (
                "watchdog respawn onto a recycled pid",
                Some(CoreInstance {
                    pid: 4242,
                    generation: 1,
                }),
            ),
            (
                "watchdog respawn onto a new pid",
                Some(CoreInstance {
                    pid: 5150,
                    generation: 1,
                }),
            ),
            (
                "the core was replaced without the watchdog",
                Some(CoreInstance {
                    pid: 5150,
                    generation: 0,
                }),
            ),
            ("no core at all", None),
        ] {
            let config = rule_config_for(&armed, current);
            assert_eq!(config.tun_luid, None, "{label}");
            assert!(
                config.direct_endpoints.is_empty(),
                "{label}: DIRECT must expire with tunnel ownership"
            );
            // Closed, not open: the fallback is exactly the pre-lock policy. The mode, the
            // app-scoped endpoint permit and the DNS block are untouched — only the tunnel
            // permit is gone — so losing the grant widens nothing.
            assert_eq!(config.mode, KillSwitchStatusMode::Locked, "{label}");
            let filters = wfp_model::expected_filters(&config);
            assert!(
                !filters
                    .iter()
                    .flat_map(|filter| filter.conditions.iter())
                    .any(|condition| matches!(condition, wfp_model::Condition::LocalInterface(_))),
                "{label}: a stale LUID must not stay installed"
            );
            assert!(
                filters
                    .iter()
                    .any(|filter| filter.conditions.contains(&wfp_model::Condition::AleAppId)),
                "{label}: the rest of the locked policy still stands"
            );
        }

        // An unidentified grant is never revived by a tick that also cannot identify a core.
        armed.core_instance = None;
        let config = rule_config_for(&armed, None);
        assert_eq!(config.tun_luid, None);
        assert!(config.direct_endpoints.is_empty());
    }

    #[test]
    fn direct_endpoint_canonicalization_deduplicates_and_has_order_independent_digest() {
        let armed = Armed {
            intent: valid_intent(KillSwitchStatusMode::Locked, true),
            tun_luid: Some(7),
            core_instance: Some(CoreInstance {
                pid: 1,
                generation: 0,
            }),
            direct_endpoints: Vec::new(),
            reviewed_direct_ports: Vec::new(),
            direct_reload: None,
        };
        let a = ProxyEndpoint {
            ip: "9.0.0.9".into(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        };
        let b = ProxyEndpoint {
            ip: "9.0.0.10".into(),
            port: 8000,
            protocol: ProxyProtocol::Udp,
        };
        let first = canonical_direct_endpoints(&armed, &[a.clone(), b.clone(), a.clone()]).unwrap();
        let second = canonical_direct_endpoints(&armed, &[b, a]).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 2);
        assert_eq!(
            crate::direct_endpoint_digest(&first).unwrap(),
            crate::direct_endpoint_digest(&second).unwrap()
        );
        assert_eq!(crate::direct_endpoint_digest(&first).unwrap().len(), 64);
    }

    #[test]
    fn direct_public_gate_rejects_special_use_and_accepts_public_unicast() {
        for blocked in [
            Ipv4Addr::new(0, 0, 0, 0),
            Ipv4Addr::new(10, 1, 2, 3),
            Ipv4Addr::new(100, 64, 0, 1),
            Ipv4Addr::LOCALHOST,
            Ipv4Addr::new(169, 254, 1, 1),
            Ipv4Addr::new(172, 31, 1, 1),
            Ipv4Addr::new(192, 168, 1, 1),
            Ipv4Addr::new(198, 18, 0, 1),
            Ipv4Addr::new(203, 0, 113, 9),
            Ipv4Addr::new(224, 0, 0, 1),
            Ipv4Addr::BROADCAST,
        ] {
            assert!(!is_public_direct_ipv4(blocked), "accepted {blocked}");
        }
        for public in [Ipv4Addr::new(9, 0, 0, 9), Ipv4Addr::new(101, 32, 0, 1)] {
            assert!(is_public_direct_ipv4(public), "rejected {public}");
        }
    }

    async fn locked_direct_test_session() -> Result<CoreInstance> {
        let core = CoreInstance {
            pid: 4242,
            generation: 7,
        };
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((
            core.pid,
            core.generation,
        )))
        .await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        lock(None).await?;
        Ok(core)
    }

    async fn committed_direct_test_session(
        owner_generation: u64,
    ) -> Result<(CoreInstance, String)> {
        let core = locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(owner_generation).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        let digest = crate::direct_endpoint_digest(&endpoints).map_err(anyhow::Error::msg)?;
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, owner_generation, begin.reload_id).await?;
        finalize_direct_runtime_reload(&digest, owner_generation, begin.reload_id).await?;
        Ok((core, digest))
    }

    #[tokio::test]
    #[serial]
    async fn a_proven_same_core_relock_retains_committed_direct() -> Result<()> {
        cleanup().await;
        let (_, digest) = committed_direct_test_session(70).await?;

        lock(None).await?;

        let armed = armed_guard().clone().expect("still locked");
        assert_eq!(armed.intent.mode, KillSwitchStatusMode::Locked);
        assert_eq!(
            crate::direct_endpoint_digest(&armed.direct_endpoints).map_err(anyhow::Error::msg)?,
            digest
        );
        assert_eq!(
            armed.direct_reload.as_ref().map(|lease| lease.phase),
            Some(DirectReloadPhase::Committed)
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn lock_validation_failure_retracts_committed_direct() -> Result<()> {
        cleanup().await;
        committed_direct_test_session(71).await?;

        let error = lock(Some("Ethernet"))
            .await
            .expect_err("a physical interface name must never be accepted as the tunnel");
        assert!(format!("{error:#}").contains("does not match"), "{error:#}");
        let blocked = armed_guard()
            .clone()
            .expect("fail-closed state remains armed");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn lock_without_current_core_retracts_committed_direct() -> Result<()> {
        cleanup().await;
        committed_direct_test_session(72).await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(None).await;

        let error = lock(None)
            .await
            .expect_err("a vanished Core cannot retain or receive DIRECT permits");
        assert!(format!("{error:#}").contains("running core"), "{error:#}");
        let blocked = armed_guard()
            .clone()
            .expect("fail-closed state remains armed");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn lock_persist_failure_narrows_live_direct_before_returning() -> Result<()> {
        cleanup().await;
        committed_direct_test_session(73).await?;

        let failures = SimulatedStateFailures::arm(true, false);
        let error = lock(None)
            .await
            .expect_err("a failed locked-intent write must still remove physical permits");
        let message = format!("{error:#}");
        assert!(message.contains("could not be persisted"), "{message}");
        assert!(message.contains("live WFP was narrowed"), "{message}");
        assert_eq!(
            TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
            2,
            "the candidate install must be followed by an exact Blocked install"
        );
        let blocked = armed_guard()
            .clone()
            .expect("live Blocked state is published");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());

        drop(failures);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn lock_install_failure_keeps_possible_direct_published_and_poisoned() -> Result<()> {
        cleanup().await;
        let (core, digest) = committed_direct_test_session(74).await?;

        let failures = SimulatedStateFailures::arm(false, true);
        let error = lock(None)
            .await
            .expect_err("an unavailable WFP engine cannot prove a narrowing");
        assert!(
            format!("{error:#}").contains("WFP install failure"),
            "{error:#}"
        );
        let retry = armed_guard()
            .clone()
            .expect("the possibly-live set must remain visible for retry");
        assert_eq!(retry.intent.mode, KillSwitchStatusMode::Locked);
        assert_eq!(
            crate::direct_endpoint_digest(&retry.direct_endpoints).map_err(anyhow::Error::msg)?,
            digest
        );
        assert!(
            retry
                .direct_reload
                .as_ref()
                .and_then(|lease| lease.expires_at)
                .is_some_and(|deadline| deadline <= std::time::Instant::now()),
            "a retained endpoint receipt must force watchdog retraction, never renewal"
        );

        drop(failures);
        transition_direct_to_blocked_unlocked(retry, Some(core), None).await?;
        assert!(armed_guard().as_ref().unwrap().direct_endpoints.is_empty());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn core_replacement_barrier_revokes_identity_and_always_revalidates_armed_wfp()
    -> Result<()> {
        cleanup().await;
        committed_direct_test_session(75).await?;
        TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);

        retract_direct_before_core_replacement().await?;

        assert_eq!(TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed), 1);
        let blocked = armed_guard()
            .clone()
            .expect("replacement remains protected");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        assert!(
            crate::core::manager::security_core_instance_snapshot().is_none(),
            "packed Core identity must be revoked inside the WFP writer barrier"
        );

        TEST_INSTALL_ATTEMPTS.store(0, Ordering::Relaxed);
        retract_direct_before_core_replacement().await?;
        assert_eq!(
            TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed),
            1,
            "empty memory is not proof after a Service restart; ARMED must overwrite live WFP"
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn core_replacement_barrier_accepts_only_persist_failure_after_live_blocked() -> Result<()>
    {
        cleanup().await;
        committed_direct_test_session(78).await?;
        let failures = SimulatedStateFailures::arm(true, false);

        retract_direct_before_core_replacement().await?;

        assert_eq!(TEST_INSTALL_ATTEMPTS.load(Ordering::Relaxed), 1);
        assert_eq!(TEST_PERSIST_ATTEMPTS.load(Ordering::Relaxed), 1);
        let blocked = armed_guard().clone().expect("live Blocked remains published");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        assert!(blocked.tun_luid.is_none());
        assert!(blocked.core_instance.is_none());
        assert!(crate::core::manager::security_core_instance_snapshot().is_none());
        assert!(
            status()
                .await
                .last_error
                .expect("persistence error remains visible")
                .contains("simulated persistent-state write failure")
        );
        drop(failures);

        // A previously Blocked record is not proof that a new live installation succeeded.
        let failures = SimulatedStateFailures::arm(false, true);
        let error = retract_direct_before_core_replacement()
            .await
            .expect_err("live WFP failure must still refuse Core replacement");
        assert!(format!("{error:#}").contains("simulated WFP install failure"));
        drop(failures);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn ambiguous_first_direct_install_publishes_candidate_for_retry() -> Result<()> {
        cleanup().await;
        let core = locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(76).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        let digest = crate::direct_endpoint_digest(&endpoints).map_err(anyhow::Error::msg)?;

        let failures = SimulatedStateFailures::arm_ambiguous_install();
        let error = replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 76, begin.reload_id)
            .await
            .expect_err("commit-before-verify must be treated as a possibly-live candidate");
        assert!(
            format!("{error:#}").contains("ambiguous WFP install failure"),
            "{error:#}"
        );
        let retry = armed_guard()
            .clone()
            .expect("candidate must remain published after ambiguous install");
        assert_eq!(retry.intent.mode, KillSwitchStatusMode::Locked);
        assert_eq!(
            crate::direct_endpoint_digest(&retry.direct_endpoints).map_err(anyhow::Error::msg)?,
            digest
        );
        assert_eq!(
            retry.direct_reload.as_ref().map(|lease| lease.phase),
            Some(DirectReloadPhase::Pending)
        );
        assert!(
            retry
                .direct_reload
                .as_ref()
                .and_then(|lease| lease.expires_at)
                .is_some_and(|deadline| deadline <= std::time::Instant::now()),
            "the ambiguous candidate must be poisoned for watchdog retraction"
        );

        drop(failures);
        transition_direct_to_blocked_unlocked(retry, Some(core), None).await?;
        assert!(armed_guard().as_ref().unwrap().direct_endpoints.is_empty());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn every_direct_begin_invalidates_the_previous_reload_identity() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        let first = begin_direct_runtime_reload(77).await?;
        let second = begin_direct_runtime_reload(77).await?;
        assert_ne!(first.reload_id, second.reload_id);
        assert_ne!(first.reload_id, 0);
        assert_ne!(second.reload_id, 0);

        let error = replace_direct_endpoints(
            &test_config_with_direct().direct_endpoints,
            &crate::REVIEWED_DIRECT_PORTS,
            77,
            first.reload_id,
        )
        .await
        .expect_err("a delayed request from the old bracket must be rejected");
        assert!(format!("{error:#}").contains("stale"));
        let armed = armed_guard().clone().expect("still armed");
        assert_eq!(armed.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(armed.direct_reload.is_none());
        assert!(armed.direct_endpoints.is_empty());

        // Selected proxy endpoints are deliberately non-empty. The status proof must hash the
        // volatile DIRECT set instead, or an empty DIRECT bracket is reported as non-empty.
        let status = status().await;
        assert!(!status.endpoints.is_empty());
        assert_eq!(
            status.direct_endpoint_digest,
            crate::direct_endpoint_digest(&[]).unwrap()
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn direct_replace_is_pending_replayable_and_finalize_is_idempotent() -> Result<()> {
        cleanup().await;
        let core = locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(91).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        let expected_digest = crate::direct_endpoint_digest(&endpoints).unwrap();
        let replaced = replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 91, begin.reload_id).await?;
        assert_eq!(replaced.reload_id, begin.reload_id);
        assert_eq!(replaced.endpoint_digest, expected_digest);

        let first_deadline = armed_guard()
            .as_ref()
            .and_then(|armed| armed.direct_reload.as_ref())
            .and_then(|lease| lease.expires_at)
            .expect("pending lease has a deadline");
        let replay = replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 91, begin.reload_id).await?;
        assert_eq!(replay, replaced);
        let replayed_lease = armed_guard()
            .as_ref()
            .and_then(|armed| armed.direct_reload.clone())
            .expect("pending lease remains present");
        assert_eq!(replayed_lease.phase, DirectReloadPhase::Pending);
        assert_eq!(replayed_lease.expires_at, Some(first_deadline));

        let finalized =
            finalize_direct_runtime_reload(&expected_digest, 91, begin.reload_id).await?;
        assert_eq!(finalized, replaced);
        let finalized_replay =
            finalize_direct_runtime_reload(&expected_digest, 91, begin.reload_id).await?;
        assert_eq!(finalized_replay, finalized);
        let armed = armed_guard().clone().expect("still armed");
        let lease = armed
            .direct_reload
            .as_ref()
            .expect("committed lease retained");
        assert_eq!(lease.phase, DirectReloadPhase::Committed);
        let committed_deadline = lease
            .expires_at
            .expect("committed lease must expire without heartbeats");
        assert!(
            direct_reload_invalidation_reason(
                &armed,
                Some(core),
                armed.tun_luid,
                std::time::Instant::now(),
            )
            .is_none()
        );
        assert!(
            direct_reload_invalidation_reason(
                &armed,
                Some(core),
                armed.tun_luid,
                committed_deadline + WATCHDOG_PERIOD,
            )
            .is_some_and(|reason| reason.contains("heartbeat lease expired"))
        );
        assert_eq!(status().await.direct_endpoint_digest, expected_digest);

        restrict_bootstrap().await?;
        let blocked = armed_guard().clone().expect("still armed and blocked");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn committed_direct_expiry_retires_core_before_selective_fallback() -> Result<()> {
        cleanup().await;
        committed_direct_test_session(126).await?;
        mark_verified("owner-alice").await?;
        let owner = crate::core::auth::AuthenticatedOwner {
            key: "owner-alice".to_owned(),
            identity: crate::OwnerIdentity::Unix { uid: 97006, gid: 20 },
            app_data_root: std::env::temp_dir(),
            peer_pid: None,
            peer_session_id: None,
        };
        crate::core::desired::persist_owner_core_started(&owner, &crate::ClashConfig::default())
            .await?;
        crate::core::desired::persist_active_owner(&owner).await?;
        armed_guard().as_mut().unwrap().direct_reload.as_mut().unwrap().expires_at =
            Some(std::time::Instant::now());

        spawn_windows_kill_switch_watchdog();
        let retired = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if !status().await.wanted && current_core_instance().await.is_none()
                    && crate::core::selective_layer::test_hold_active()
                {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }).await.is_ok();
        let wanted_core = crate::core::desired::load_owner_desired_state(&owner.key)
            .await?.core_should_be_running;
        let active = crate::core::desired::load_active_owner().await?;
        tokio::fs::remove_file(crate::service_paths().for_owner_key(&owner.key).desired_state_path())
            .await?;
        cleanup().await;

        assert!(retired, "fallback must retire Core and its TUN before applying the AI hold");
        assert!(!wanted_core, "fallback must not replay the retired Core");
        assert!(active.is_none(), "the retired session must no longer own Core");
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn committed_direct_expiry_does_not_interrupt_its_new_ai_hold() -> Result<()> {
        cleanup().await;
        let (core, _) = committed_direct_test_session(125).await?;
        let removals_before = crate::core::selective_layer::test_active_hold_removals();
        let mut armed = armed_guard().clone().expect("committed session");
        let now = std::time::Instant::now();
        armed.direct_reload.as_mut().unwrap().expires_at = Some(now);
        let reason = direct_reload_invalidation_reason(&armed, Some(core), armed.tun_luid, now)
            .expect("committed heartbeat expiry must invalidate DIRECT");

        reconcile_direct_watchdog_invalidation_unlocked(armed, Some(core), now, reason).await?;
        crate::core::server::retire_expired_fresh_arm(core_arm_epoch()).await?;
        let wanted = status().await.wanted;
        let held = crate::core::selective_layer::test_hold_active();
        let removals_after = crate::core::selective_layer::test_active_hold_removals();
        cleanup().await;

        assert!(!wanted, "ordinary internet must be released on App death");
        assert!(held, "AI services must remain blocked after release");
        assert_eq!(
            removals_after, removals_before,
            "expiry must not delete the AI hold it has just installed"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn committed_direct_lease_expiry_releases_only_non_strict_sessions() -> Result<()> {
        cleanup().await;
        let (core, _) = committed_direct_test_session(122).await?;
        let mut armed = armed_guard().clone().expect("committed session");
        let now = std::time::Instant::now();
        armed.direct_reload.as_mut().unwrap().expires_at = Some(now);
        let reason = direct_reload_invalidation_reason(&armed, Some(core), armed.tun_luid, now)
            .expect("committed heartbeat expiry must invalidate DIRECT");
        assert!(reason.contains("heartbeat lease expired"));

        let failures = SimulatedStateFailures::arm(false, true);
        reconcile_direct_watchdog_invalidation_unlocked(armed, Some(core), now, reason)
            .await
            .expect_err("failed live retraction must retry before releasing");
        let retry = armed_guard().clone().expect("failed retraction stays armed");
        assert_eq!(retry.intent.mode, KillSwitchStatusMode::Locked);
        assert!(!retry.direct_endpoints.is_empty());
        assert!(retry.direct_reload.is_some());
        drop(failures);

        let now = std::time::Instant::now();
        let reason = direct_reload_invalidation_reason(&retry, Some(core), retry.tun_luid, now)
            .expect("expired committed receipt must retry release on the next tick");
        reconcile_direct_watchdog_invalidation_unlocked(retry, Some(core), now, reason).await?;
        assert!(lock(None).await.is_err(), "the expired session cannot cancel retirement");
        assert!(mark_verified("owner-alice").await.is_err());
        crate::core::server::retire_expired_fresh_arm(core_arm_epoch()).await?;
        assert!(
            armed_guard().is_none(),
            "non-strict expiry must release the session"
        );
        assert!(!status().await.wanted);
        assert!(!TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed));
        assert!(
            crate::core::selective_layer::test_hold_active(),
            "non-strict expiry opens general traffic and puts the AI hold back"
        );
        assert_disarmed_tombstone_present().await?;

        committed_direct_test_session(123).await?;
        let armed = armed_guard().clone().expect("committed session before Core loss");
        let now = std::time::Instant::now();
        let reason = direct_reload_invalidation_reason(&armed, None, armed.tun_luid, now)
            .expect("Core ownership loss must retract DIRECT");
        assert!(reason.contains("ownership changed"));
        let failures = SimulatedStateFailures::arm(false, true);
        reconcile_direct_watchdog_invalidation_unlocked(armed, None, now, reason)
            .await
            .expect_err("ownership retraction failure must retry Blocked");
        let retry = armed_guard().clone().expect("ownership retraction retry");
        let now = std::time::Instant::now();
        let reason = direct_reload_invalidation_reason(&retry, None, retry.tun_luid, now)
            .expect("poisoned ownership receipt must still retract");
        drop(failures);
        reconcile_direct_watchdog_invalidation_unlocked(retry, None, now, reason).await?;
        assert_eq!(
            armed_guard().as_ref().unwrap().intent.mode,
            KillSwitchStatusMode::Blocked
        );

        let (core, _) = committed_direct_test_session(124).await?;
        let mut strict = armed_guard().clone().expect("strict committed session");
        strict.intent.strict_kill_switch = true;
        let now = std::time::Instant::now();
        strict.direct_reload.as_mut().unwrap().expires_at = Some(now);
        let reason = direct_reload_invalidation_reason(&strict, Some(core), strict.tun_luid, now)
            .expect("strict heartbeat expiry must still retract DIRECT");
        reconcile_direct_watchdog_invalidation_unlocked(strict, Some(core), now, reason).await?;
        let blocked = armed_guard().clone().expect("strict session stays armed");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        assert!(blocked.tun_luid.is_none());
        assert!(blocked.core_instance.is_none());
        crate::core::selective_layer::remove().await;
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn pending_direct_lease_expiry_reconciles_to_exact_blocked() -> Result<()> {
        cleanup().await;
        let core = locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(123).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 123, begin.reload_id).await?;

        {
            let mut guard = armed_guard();
            let lease = guard
                .as_mut()
                .and_then(|armed| armed.direct_reload.as_mut())
                .expect("pending lease");
            lease.expires_at = Some(std::time::Instant::now());
        }
        let pending = armed_guard().clone().expect("pending state");
        let reason = direct_reload_invalidation_reason(
            &pending,
            Some(core),
            pending.tun_luid,
            std::time::Instant::now(),
        )
        .expect("watchdog must recognize the expired pending set");
        assert!(reason.contains("expired"));
        transition_direct_to_blocked_unlocked(pending, Some(core), None).await?;

        let blocked = armed_guard().clone().expect("blocked state");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        let rendered = rule_config_for(&blocked, Some(core));
        assert!(rendered.direct_endpoints.is_empty());
        assert!(rendered.tun_luid.is_none());
        assert_eq!(
            status().await.direct_endpoint_digest,
            crate::direct_endpoint_digest(&[]).unwrap()
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn finalize_mismatch_revokes_the_pending_direct_set() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(144).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 144, begin.reload_id).await?;

        let error = finalize_direct_runtime_reload(&"0".repeat(64), 144, begin.reload_id)
            .await
            .expect_err("a digest mismatch cannot commit physical permits");
        assert!(format!("{error:#}").contains("digest"));
        let blocked = armed_guard().clone().expect("blocked state");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn authenticated_renewal_extends_only_the_exact_committed_lease() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(145).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 145, begin.reload_id).await?;
        finalize_direct_runtime_reload(&digest, 145, begin.reload_id).await?;
        let first_deadline = armed_guard()
            .as_ref()
            .and_then(|armed| armed.direct_reload.as_ref())
            .and_then(|lease| lease.expires_at)
            .expect("committed deadline");

        let renewed = renew_direct_runtime_reload(&digest, 145, begin.reload_id).await?;
        assert_eq!(renewed.endpoint_digest, digest);
        let second_deadline = armed_guard()
            .as_ref()
            .and_then(|armed| armed.direct_reload.as_ref())
            .and_then(|lease| lease.expires_at)
            .expect("renewed deadline");
        assert!(second_deadline > first_deadline);
        assert_eq!(
            armed_guard()
                .as_ref()
                .and_then(|armed| armed.direct_reload.as_ref())
                .map(|lease| lease.phase),
            Some(DirectReloadPhase::Committed)
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn mismatched_renewal_does_not_block_the_network() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(146).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 146, begin.reload_id).await?;
        finalize_direct_runtime_reload(&digest, 146, begin.reload_id).await?;

        let error = renew_direct_runtime_reload(&"0".repeat(64), 146, begin.reload_id)
            .await
            .expect_err("a heartbeat for another endpoint set must not renew");
        let message = format!("{error:#}");
        assert!(
            message.contains(DIRECT_RENEW_FAILED_PREFIX),
            "{message}"
        );
        assert!(!message.contains("traffic is Blocked"), "{message}");
        let still = armed_guard().clone().expect("renewal failure must not disarm by itself");
        assert_eq!(still.intent.mode, KillSwitchStatusMode::Locked);
        assert!(!still.direct_endpoints.is_empty());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn failed_blocked_render_never_publishes_an_empty_direct_set() -> Result<()> {
        cleanup().await;
        let core = locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(147).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 147, begin.reload_id).await?;
        finalize_direct_runtime_reload(&digest, 147, begin.reload_id).await?;

        let committed = armed_guard().clone().expect("committed state");
        let failures = SimulatedStateFailures::arm(false, true);
        let result = transition_direct_to_blocked_unlocked(committed, Some(core), None).await;
        result.expect_err("the simulated WFP narrowing must fail");

        let retry = armed_guard()
            .clone()
            .expect("prior live state remains published");
        assert_eq!(retry.intent.mode, KillSwitchStatusMode::Locked);
        assert_eq!(
            crate::direct_endpoint_digest(&retry.direct_endpoints).unwrap(),
            digest
        );
        assert!(
            retry
                .direct_reload
                .as_ref()
                .and_then(|lease| lease.expires_at)
                .is_some_and(|deadline| deadline <= std::time::Instant::now()),
            "the retained receipt must be poisoned so the watchdog retries Blocked"
        );
        assert_eq!(status().await.direct_endpoint_digest, digest);

        drop(failures);
        transition_direct_to_blocked_unlocked(retry, Some(core), None).await?;
        let blocked = armed_guard().clone().expect("retry committed Blocked");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn core_replacement_during_pending_direct_commit_fails_closed() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(155).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 155, begin.reload_id).await?;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 8)))
            .await;

        let error = replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 155, begin.reload_id)
            .await
            .expect_err("a recycled PID with a new restart count is a different Core");
        assert!(format!("{error:#}").contains("locked tunnel grant"));
        let blocked = armed_guard().clone().expect("blocked state");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn same_pid_tunnel_luid_recreation_revokes_the_pending_direct_set() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(166).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 166, begin.reload_id).await?;

        // The test engine resolves the live alias to LUID 0. Changing only the recorded LUID
        // models same-PID Mihomo recreating WinTUN between replacement and finalize.
        armed_guard().as_mut().expect("pending state").tun_luid = Some(77);
        let error = finalize_direct_runtime_reload(&digest, 166, begin.reload_id)
            .await
            .expect_err("a same-PID tunnel replacement must invalidate physical permits");
        assert!(format!("{error:#}").contains("TUN"));
        let blocked = armed_guard().clone().expect("blocked state");
        assert_eq!(blocked.intent.mode, KillSwitchStatusMode::Blocked);
        assert!(blocked.direct_endpoints.is_empty());
        assert!(blocked.direct_reload.is_none());
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn direct_security_identity_stays_coherent_during_harmless_manager_contention() {
        cleanup().await;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((5151, 4)))
            .await;
        assert_eq!(
            current_core_instance_for_direct_security(),
            Some(CoreInstance {
                pid: 5151,
                generation: 4,
            })
        );

        let manager = crate::core::manager::CORE_MANAGER.lock().await;
        assert_eq!(
            current_core_instance_for_direct_security(),
            Some(CoreInstance {
                pid: 5151,
                generation: 4,
            }),
            "one packed atomic read must not convert harmless lock contention into owner loss"
        );
        drop(manager);
        cleanup().await;
    }

    #[tokio::test]
    #[serial]
    async fn initial_arm_refuses_direct_endpoints_outside_a_reload_lease() {
        cleanup().await;
        let error = arm_bootstrap(
            &test_config_with_direct(),
            "/opt/tono/mihomo",
            "owner-alice",
        )
        .await
        .expect_err("StartClash must not bypass the lease-backed DIRECT transaction");
        assert!(format!("{error:#}").contains("runtime-reload transaction"));
        assert!(armed_guard().is_none());
        cleanup().await;
    }

    /// P2: `lock` records the core instance and renders the permit from it. Reading the core
    /// twice let the two disagree — `status_snapshot_nonblocking` serves a cache whenever the
    /// core manager is busy — and a disagreement is permanent, because `tunnel_permit_luid`
    /// refuses to revive an unidentified grant. One read, threaded through, cannot disagree.
    #[test]
    fn locking_renders_the_permit_from_the_very_instance_it_recorded() {
        let running = CoreInstance {
            pid: 4242,
            generation: 3,
        };
        for recorded in [
            None,
            Some(running),
            Some(CoreInstance {
                pid: 1,
                generation: 0,
            }),
        ] {
            let armed = Armed {
                intent: valid_intent(KillSwitchStatusMode::Locked, true),
                tun_luid: Some(0x7777),
                core_instance: recorded,
                direct_endpoints: Vec::new(),
                reviewed_direct_ports: Vec::new(),
                direct_reload: None,
            };
            // This is exactly what `lock` now does: `armed.core_instance` and the render's
            // `current_core` are the same value.
            assert_eq!(
                rule_config_for(&armed, armed.core_instance).tun_luid,
                recorded.map(|_| 0x7777),
                "a render from the recorded instance agrees with it by construction"
            );
        }

        // The defect this replaces: read #1 missed the core, read #2 saw it. The permit is
        // retracted at the instant it is granted — and `None` can never match again, so the
        // machine stays Locked, verified and live with every application's traffic dropped
        // leaving the TUN.
        let stale = Armed {
            intent: valid_intent(KillSwitchStatusMode::Locked, true),
            tun_luid: Some(0x7777),
            core_instance: None,
            direct_endpoints: Vec::new(),
            reviewed_direct_ports: Vec::new(),
            direct_reload: None,
        };
        assert_eq!(rule_config_for(&stale, Some(running)).tun_luid, None);
        assert_eq!(
            rule_config_for(&stale, None).tun_luid,
            None,
            "and no later tick can revive it"
        );
    }

    /// The observability half: `mode` alone cannot tell "Locked and carrying traffic" from
    /// "Locked with the permit retracted". `tunnel_permit_rendered` changes only after the exact
    /// install/verify operation succeeds, never while merely constructing an expected model.
    #[tokio::test]
    #[serial]
    async fn the_status_flag_tracks_what_the_last_exact_install_proved() {
        let running = CoreInstance {
            pid: 90,
            generation: 0,
        };
        let armed = Armed {
            intent: valid_intent(KillSwitchStatusMode::Locked, true),
            tun_luid: Some(0x99),
            core_instance: Some(running),
            direct_endpoints: Vec::new(),
            reviewed_direct_ports: Vec::new(),
            direct_reload: None,
        };

        install_unlocked_for(&armed, Some(running)).await.unwrap();
        assert!(TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed));

        // Same mode, same `wanted`/`verified`/`live` — only this flag changes.
        install_unlocked_for(&armed, None).await.unwrap();
        assert!(!TUNNEL_PERMIT_RENDERED.load(Ordering::Relaxed));
    }

    /// P1: `live` is a staleness cache, and its budget has to cover a **successful** but slow
    /// watchdog tick. At 1.5 s it did not: one sleep (1 s) plus a verify that this module
    /// itself calls merely "pathological but reportable" at `WFP_SLOW_CALL` (2 s) already
    /// exceeds it, so a healthy machine reported `live: false` and the app read it as unhealthy.
    #[test]
    fn the_verify_cache_survives_a_slow_but_successful_watchdog_tick() {
        assert!(
            VERIFY_CACHE_TTL > WATCHDOG_PERIOD + WFP_SLOW_CALL,
            "the budget must cover a whole slow-but-successful refresh interval"
        );
        assert!(
            VERIFY_CACHE_TTL <= std::time::Duration::from_secs(10),
            "and stay far below the 25 s call timeout, so a wedged engine still reads dead"
        );

        let slow_tick = std::time::Instant::now()
            .checked_sub(WATCHDOG_PERIOD + WFP_SLOW_CALL)
            .expect("the test host has been up for more than three seconds");
        assert!(
            verify_reads_live(Some((slow_tick, true))),
            "a successful verify that merely took a long time is still alive"
        );

        // What the TTL must never soften.
        assert!(
            !verify_reads_live(Some((std::time::Instant::now(), false))),
            "a verify that actually failed is dead immediately, TTL or no TTL"
        );
        assert!(!verify_reads_live(None), "no verify has ever run");
        let expired = std::time::Instant::now()
            .checked_sub(VERIFY_CACHE_TTL + std::time::Duration::from_millis(1))
            .expect("the test host has been up for more than the TTL");
        assert!(
            !verify_reads_live(Some((expired, true))),
            "an answer older than the budget is stale, not live"
        );
    }

    #[tokio::test]
    #[serial]
    async fn lock_grants_the_tunnel_permit_against_the_running_core_and_restrict_revokes_it()
    -> Result<()> {
        cleanup().await;
        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        assert!(armed_guard().as_ref().unwrap().core_instance.is_none());

        lock(None).await?;
        let armed = armed_guard().clone().expect("armed");
        assert_eq!(armed.tun_luid, Some(0));
        assert_eq!(
            armed.core_instance,
            current_core_instance().await,
            "the grant names the core that was running when lock ran"
        );
        assert!(armed.core_instance.is_some());
        assert_eq!(render(&armed).await.tun_luid, Some(0));

        restrict_bootstrap().await?;
        let armed = armed_guard().clone().expect("still armed");
        assert!(armed.tun_luid.is_none());
        assert!(
            armed.core_instance.is_none(),
            "the grant is given back with the LUID"
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn release_is_refused_until_dns_restore_is_proven() -> Result<()> {
        cleanup().await;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        simulate_machine_still_on_loopback_dns();
        atomic_write(&dns_snapshot_path(), b"{ corrupt").await?;

        let error = release()
            .await
            .expect_err("release must be refused while DNS restore is unproven");
        assert!(format!("{error:#}").contains("corrupt"));
        assert!(
            ARMED.lock().unwrap().is_some(),
            "a refused release keeps the block armed"
        );
        assert!(tokio::fs::metadata(intent_path()).await.is_ok());

        tokio::fs::remove_file(dns_snapshot_path()).await?;
        let status = release().await?;
        assert!(!status.wanted);
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn restored_locked_intent_relocks_after_core_restore() -> Result<()> {
        cleanup().await;
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        let intent = valid_intent(KillSwitchStatusMode::Locked, true);
        atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;

        restore_on_service_start().await?;
        // Downgraded for safety — and marked for re-lock once the core is back.
        assert_eq!(
            ARMED.lock().unwrap().as_ref().unwrap().intent.mode,
            KillSwitchStatusMode::Blocked
        );

        crate::core::manager::set_running_core_identity_for_kill_switch_tests(Some((4242, 1)))
            .await;
        relock_restored_tunnel().await?;
        let armed = ARMED.lock().unwrap().clone().expect("still armed");
        assert_eq!(armed.intent.mode, KillSwitchStatusMode::Locked);
        assert_eq!(armed.tun_luid, Some(0));

        // The marker is consumed: a second call is a no-op and cannot re-lock a
        // restrict-bootstrap that happened in between.
        restrict_bootstrap().await?;
        relock_restored_tunnel().await?;
        assert_eq!(
            ARMED.lock().unwrap().as_ref().unwrap().intent.mode,
            KillSwitchStatusMode::Blocked
        );
        cleanup().await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn direct_endpoints_are_validated_against_the_wechat_contract() -> Result<()> {
        cleanup().await;
        let base = test_config();

        // Port contract: tcp only 80/443, udp only 443/8000.
        for (port, protocol) in [(22_u16, ProxyProtocol::Tcp), (53, ProxyProtocol::Udp)] {
            let mut config = base.clone();
            config.direct_endpoints = vec![ProxyEndpoint {
                ip: "203.0.113.9".to_owned(),
                port,
                protocol,
            }];
            assert!(
                validate_direct_endpoints(&config).is_err(),
                "accepted port {port}/{protocol:?}"
            );
        }
        // Permanently protected resolvers, private space, and the selected node address
        // itself must never go DIRECT.
        for ip in [
            "1.1.1.1",
            "8.8.8.8",
            "10.0.0.9",
            "127.0.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "198.18.0.1",
            "203.0.113.9",
            "224.0.0.1",
            "2001:4860:4860::8888",
        ] {
            let mut config = base.clone();
            config.direct_endpoints = vec![ProxyEndpoint {
                ip: ip.to_owned(),
                port: 443,
                protocol: ProxyProtocol::Tcp,
            }];
            assert!(validate_direct_endpoints(&config).is_err(), "accepted {ip}");
        }
        let mut config = base.clone();
        config.proxy_endpoints = vec![ProxyEndpoint {
            ip: "9.9.9.9".to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        }];
        config.direct_endpoints = vec![ProxyEndpoint {
            ip: "9.9.9.9".to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        }];
        assert!(
            validate_direct_endpoints(&config).is_err(),
            "accepted the selected node address as DIRECT"
        );

        let mut config = base.clone();
        config.direct_endpoints = vec![ProxyEndpoint {
            ip: "9.0.0.9".to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        }];
        validate_direct_endpoints(&config)
            .expect("a public exact WeChat endpoint should be accepted");

        // The 256-entry bound.
        let mut config = base.clone();
        config.direct_endpoints = (0..257_u32)
            .map(|index| ProxyEndpoint {
                ip: format!("203.0.{}.{}", 113 + index / 256, index % 256),
                port: 443,
                protocol: ProxyProtocol::Tcp,
            })
            .collect();
        assert!(
            validate_direct_endpoints(&config).is_err(),
            "accepted more than 256 direct endpoints"
        );
        cleanup().await;
        Ok(())
    }

    /// `proxy_endpoints` is the list every ALE session filter is emitted from, and the
    /// intent carrying it is persisted with `wanted: true` *before* the WFP transaction
    /// runs. An unbounded list therefore arms the machine fail-closed with an install too
    /// large to finish, replayed at every service start. Every sibling list is bounded;
    /// this one must be too.
    #[tokio::test]
    async fn replace_proxy_endpoints_rejects_empty() {
        assert!(replace_proxy_endpoints(&[]).await.is_err());
    }

    #[test]
    fn proxy_endpoints_are_bounded_like_every_sibling_list() {
        let mut config = test_config();
        config.proxy_endpoints = (0..MAX_PROXY_ENDPOINTS as u32)
            .map(|index| ProxyEndpoint {
                ip: format!("198.51.{}.{}", index / 256, index % 256),
                port: 443,
                protocol: ProxyProtocol::Tcp,
            })
            .collect();
        validate_config(&config).expect("the bound itself must still be accepted");

        config.proxy_endpoints.push(ProxyEndpoint {
            ip: "198.51.101.1".to_owned(),
            port: 443,
            protocol: ProxyProtocol::Tcp,
        });
        let err = validate_config(&config)
            .expect_err("accepted an unbounded proxy_endpoints list")
            .to_string();
        assert!(
            err.contains("proxy_endpoints"),
            "the refusal must name the list that was too long, got {err}"
        );

        // A real session carries the selected node plus at most the home route.
        assert!(validate_config(&test_config()).is_ok());
    }

    /// The S1 residual risk in miniature: a WFP call that never returns must produce a
    /// mappable error, and the abandoned blocking thread must keep the single-writer claim
    /// until the kernel call really comes back. The FFI is mock-gated off Windows, so the
    /// closure stands in for a wedged `Fwpm*` call — the ownership rules under test are the
    /// engine-independent part.
    #[tokio::test]
    #[serial]
    async fn a_wedged_engine_call_times_out_and_blocks_a_second_wfp_writer() -> Result<()> {
        let (release, blocked) = std::sync::mpsc::channel::<()>();
        let wedged = move || -> Result<()> {
            // Returns only when the test says so — the stand-in for a BFE that never answers.
            let _ = blocked.recv_timeout(std::time::Duration::from_secs(30));
            Ok(())
        };

        let timed_out =
            bounded_engine_call(std::time::Duration::from_millis(50), "install", wedged)
                .await
                .expect_err("a call that never returns must not be awaited forever");
        let message = format!("{timed_out:#}");
        assert!(message.contains(WFP_ENGINE_WEDGED_PREFIX), "{message}");
        assert!(message.contains("install"), "{message}");

        // The claim is still held by the running thread, so nothing may start a second WFP
        // transaction — the refusal names the operation that is stuck.
        let refused = bounded_engine_call(std::time::Duration::from_secs(5), "verify", || Ok(()))
            .await
            .expect_err("a second writer must be refused while the first is inside the kernel");
        let message = format!("{refused:#}");
        assert!(message.contains(WFP_ENGINE_WEDGED_PREFIX), "{message}");
        assert!(message.contains("install"), "{message}");

        // Only the abandoned call itself releases the claim, and it does so on its own thread.
        release.send(()).expect("the wedged call is still running");
        for _ in 0..300 {
            if engine_call_in_flight().is_none() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(
            engine_call_in_flight().is_none(),
            "the blocking thread must release the claim when the call finally returns"
        );
        bounded_engine_call(std::time::Duration::from_secs(5), "install", || Ok(())).await?;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn a_healthy_engine_call_leaves_no_claim_behind() -> Result<()> {
        bounded_engine_call(std::time::Duration::from_secs(5), "install", || Ok(())).await?;
        assert!(
            engine_call_in_flight().is_none(),
            "a completed call must not keep the next operation out"
        );
        let error = bounded_engine_call(
            std::time::Duration::from_secs(5),
            "verify",
            || -> Result<()> { bail!("engine said no") },
        )
        .await
        .expect_err("engine errors still propagate");
        assert!(format!("{error:#}").contains("engine said no"));
        assert!(engine_call_in_flight().is_none());
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn direct_endpoints_live_only_in_the_armed_session_memory() -> Result<()> {
        cleanup().await;
        locked_direct_test_session().await?;
        let begin = begin_direct_runtime_reload(199).await?;
        lock(None).await?;
        let endpoints = test_config_with_direct().direct_endpoints;
        let digest = crate::direct_endpoint_digest(&endpoints).unwrap();
        replace_direct_endpoints(&endpoints, &crate::REVIEWED_DIRECT_PORTS, 199, begin.reload_id).await?;
        finalize_direct_runtime_reload(&digest, 199, begin.reload_id).await?;
        assert_eq!(
            ARMED
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .direct_endpoints
                .len(),
            2
        );

        let armed = armed_guard().clone().expect("still armed");
        // Two exact-tuple permits (rule G), plus the reviewed-port class (rule H): one filter
        // per port per protocol per address family. Derived from the constant rather than
        // written as a literal, so adding a reviewed port cannot quietly change the count.
        // One filter per declared port, TCP only — the UDP half was withdrawn because nothing
        // routes unpinned UDP to the physical interface for it to cover.
        let reviewed = crate::REVIEWED_DIRECT_PORTS.len();
        assert_eq!(
            wfp_model::expected_filters(&render(&armed).await)
                .iter()
                .filter(|filter| filter.name.contains("DIRECT"))
                .count(),
            2 + reviewed,
            "each approved tuple must be one ALE permit carrying both Mihomo identity and the exact tuple"
        );
        let persisted = tokio::fs::read_to_string(intent_path()).await?;
        assert!(
            !persisted.contains("direct_endpoints") && !persisted.contains("reload_id"),
            "volatile DIRECT endpoints and leases must never enter startup intent"
        );

        restrict_bootstrap().await?;
        let armed = armed_guard().clone().expect("still armed");
        assert!(armed.direct_endpoints.is_empty());
        assert!(armed.direct_reload.is_none());
        assert!(
            !wfp_model::expected_filters(&render(&armed).await)
                .iter()
                .any(|filter| filter.name.contains("DIRECT")),
            "Protected Offline must not keep DIRECT permits installed"
        );

        // Startup recovery also rebuilds with an empty set (fail-closed until the App's next
        // authenticated lease transaction). Core is treated as starting so this observes the
        // rebuilt session rather than the idle release.
        TEST_CORE_STARTING.store(true, Ordering::Relaxed);
        restore_on_service_start().await?;
        assert!(
            ARMED
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .direct_endpoints
                .is_empty()
        );

        // And a later arm that omits them inherits nothing from the previous session.
        release().await?;
        arm_bootstrap(&test_config(), "/opt/tono/mihomo", "owner-alice").await?;
        assert!(
            ARMED
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .direct_endpoints
                .is_empty()
        );
        cleanup().await;
        Ok(())
    }
}
