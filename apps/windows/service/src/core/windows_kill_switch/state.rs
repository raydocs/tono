//! Shared state: epochs, the intent record and armed types, process-wide statics and accessors.

use super::*;

/// Whether the live WFP engine is behind this build (real Windows service binary).
pub(super) const ENGINE_LIVE: bool = cfg!(all(windows, not(feature = "test")));

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

pub(super) fn note_explicit_release() {
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
pub(super) struct IntentRecord {
    pub(super) wanted: bool,
    pub(super) mode: KillSwitchStatusMode,
    /// `None` is a legacy record: Locked migrated as verified, earlier phases as stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) verified: Option<bool>,
    pub(super) tunnel_interface: String,
    /// Staged core binary path the `ALE_APP_ID` permit is resolved from.
    pub(super) app_path: String,
    pub(super) endpoints: Vec<ProxyEndpoint>,
    /// Resolved, validated, public-only API host IPs (bounded by the model).
    pub(super) api_host_ips: Vec<String>,
    pub(super) updated_at: u64,
    /// Who armed the protection: the same SHA256(SID) key `authenticate_owner` derives. The
    /// machine-wide WFP policy may only be released/restricted by that owner — the pipe
    /// authenticates *a* local user, but the armed state belongs to the user who armed it.
    /// `None` for legacy/emergency-restored intents, which own no one and can be released by
    /// any authenticated owner (see `authorize_write_for`).
    #[serde(default)]
    pub(super) owner_key: Option<String>,
    /// Explicit strict kill switch. Missing or false means a crash, hang, corrupt record,
    /// or an unproven restored wanted session releases general traffic. Only `true` keeps
    /// a block, and a bounded unhealthy streak still releases so that choice cannot brick
    /// the machine. Production never writes `true`. Absent on older records, which stay
    /// non-strict.
    #[serde(default)]
    pub(super) strict_kill_switch: bool,
    /// Crash-window tombstone only. A user disconnect leaves this false so startup still
    /// consumes the record. The app treats `wanted: false` plus this flag as "reconnect".
    #[serde(default)]
    pub(super) reconnect_after_release: bool,
    /// The owner whose session the crash window released: the only caller that is told to
    /// reconnect (#1291). Kept apart from `owner_key` so the tombstone itself stays ownerless.
    /// `None` with the flag set is a legacy or ownerless record that no App may honor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) reconnect_owner_key: Option<String>,
    /// Durable secondary-layer disposition for an automatic release. `None` is a legacy
    /// record whose existing hold is left alone; this never authorizes a broad WFP block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) apply_narrow_after_release: Option<bool>,
}

impl IntentRecord {
    pub(super) fn release_follow_up(&self) -> Option<bool> {
        self.apply_narrow_after_release
            .or_else(|| self.reconnect_after_release.then_some(true))
    }

    pub(super) fn is_verified(&self) -> bool {
        self.verified
            .unwrap_or(self.mode == KillSwitchStatusMode::Locked)
    }
}

/// The core process instance a tunnel permit was granted for.
///
/// A pid is not an identity — Windows recycles them — so the manager's monotonic publication
/// generation rides along: every ordinary start and watchdog respawn changes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CoreInstance {
    pub(super) pid: u32,
    pub(super) generation: u32,
}

/// The core running right now, or `None` when none is. The manager publishes PID + generation in
/// one atomic word, so this never queues behind lifecycle work and never combines two instances.
pub(super) async fn current_core_instance() -> Option<CoreInstance> {
    current_core_instance_for_direct_security()
}

/// A coherent, non-cached Core identity for DIRECT-permit decisions. A stop clears it before
/// teardown and a start publishes it only after commit; manager contention alone is therefore not
/// treated as process replacement.
pub(super) fn current_core_instance_for_direct_security() -> Option<CoreInstance> {
    crate::core::manager::security_core_instance_snapshot().map(|instance| CoreInstance {
        pid: instance.pid,
        generation: instance.generation,
    })
}

/// Authoritative core identity for a WFP mutation. Kept async to avoid churn at its call sites;
/// the coherent atomic publication itself never waits for the manager.
pub(super) async fn current_core_instance_authoritative() -> Option<CoreInstance> {
    current_core_instance_for_direct_security()
}

#[derive(Debug, Clone)]
pub(super) struct Armed {
    pub(super) intent: IntentRecord,
    pub(super) tun_luid: Option<u64>,
    /// The core instance `tun_luid` was resolved for, recorded by `lock`. `None` means no
    /// tunnel permit may be rendered at all — see [`tunnel_permit_luid`].
    pub(super) core_instance: Option<CoreInstance>,
    /// Cloud-approved DIRECT endpoints for this armed session. **omission = clear**: kept
    /// only in memory, never written to `kill-switch.json`, never restored on service start,
    /// never inherited by the next arm. The permits themselves are rendered only while
    /// `Locked` (rule G); keeping the approved set here across a mode change is what lets a
    /// re-lock re-render them without another round trip. Every restore path rebuilds with an
    /// empty set (fail-closed until the app's next connect transaction re-issues them).
    pub(super) direct_endpoints: Vec<ProxyEndpoint>,
    /// Ports the App declared it emitted process-scoped DIRECT rules for, already intersected
    /// with `REVIEWED_DIRECT_PORTS`. Same lifetime as `direct_endpoints`: memory only, cleared
    /// on omission, never restored.
    pub(super) reviewed_direct_ports: Vec<u16>,
    /// Volatile Service-owned reload bracket. Pending physical permits expire without relying on
    /// the GUI process to remain alive; committed permits keep only an idempotency receipt.
    pub(super) direct_reload: Option<DirectReloadLease>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DirectReloadPhase {
    Bracket,
    Pending,
    Committed,
    Retracting,
}

#[derive(Debug, Clone)]
pub(super) struct DirectReloadLease {
    pub(super) owner_generation: u64,
    pub(super) reload_id: u64,
    pub(super) phase: DirectReloadPhase,
    pub(super) endpoint_digest: String,
    pub(super) core_instance: Option<CoreInstance>,
    /// The exact TUN adapter identity proved when the physical endpoint set was installed.
    /// `None` is valid only for the pre-install Bracket phase.
    pub(super) tunnel_luid: Option<u64>,
    pub(super) expires_at: Option<std::time::Instant>,
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
pub(super) fn tunnel_permit_luid(armed: &Armed, current_core: Option<CoreInstance>) -> Option<u64> {
    let luid = armed.tun_luid?;
    // Fail closed on every ambiguity: an unidentified grant (`None` recorded) never matches,
    // so it can never be revived by a later tick that also cannot identify a core.
    if armed.core_instance.is_some() && armed.core_instance == current_core {
        Some(luid)
    } else {
        None
    }
}

pub(super) static ARMED: Lazy<Mutex<Option<Armed>>> = Lazy::new(|| Mutex::new(None));
pub(super) static LAST_ERROR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
pub(super) static WFP_OPERATION: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
#[cfg(test)]
pub(super) static TEST_INSTALL_FAILURE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
pub(super) static TEST_AMBIGUOUS_INSTALL_FAILURE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
pub(super) static TEST_PERSIST_FAILURE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
pub(super) static TEST_INSTALL_ATTEMPTS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
pub(super) static TEST_PERSIST_ATTEMPTS: AtomicU64 = AtomicU64::new(0);
/// Test stand-in for the Windows logon-session lookup: true means the recorded owner has signed
/// out. Defaults to "still signed in", the answer that refuses a takeover.
#[cfg(test)]
pub(super) static TEST_OWNER_SIGNED_OUT: AtomicBool = AtomicBool::new(false);
pub(super) static NEXT_DIRECT_RELOAD_ID: AtomicU64 = AtomicU64::new(1);
/// Longer than the App's absolute connect transaction: while this bracket expires the physical
/// DIRECT set is empty, but a stale request must still be invalidated eventually.
pub(super) const DIRECT_BRACKET_LEASE: std::time::Duration = std::time::Duration::from_secs(7 * 60);
/// Once physical permits exist, the App has only controller/WFP/data-plane read-back plus the
/// finalize IPC left. Expiry transitions the Service to exact Blocked without GUI cooperation.
pub(super) const DIRECT_PENDING_LEASE: std::time::Duration = std::time::Duration::from_secs(90);
/// A committed physical escape set is not permanent Service state. The owning App must renew it
/// through its authenticated owner session; process death, a hung UI runtime, or session
/// retirement therefore retracts the set without relying on App cleanup.
pub(super) const DIRECT_COMMITTED_LEASE: std::time::Duration = std::time::Duration::from_secs(60);
/// Startup recovery downgraded a `locked` intent to `blocked`; set so a successful core
/// restore can re-lock the tunnel instead of leaving the machine fail-closed until the GUI
/// returns (`relock_restored_tunnel`).
pub(super) static RESTORE_WAS_LOCKED: AtomicBool = AtomicBool::new(false);
/// Startup recovery published a *verified* intent carried over from before this Service start,
/// and no WFP install or live verify has proved its filters in this process yet (TW-R-boot).
/// A failed startup install keeps that intent published while the machine is open, so
/// `verified` alone no longer proves a live barrier and the Remote Desktop exception
/// (`connect_session_refused`) must wait. The watchdog releases general traffic unless this
/// record explicitly enabled the strict kill switch. Cleared by the first successful install
/// or verify.
pub(super) static RESTORED_BARRIER_UNPROVEN: AtomicBool = AtomicBool::new(false);
/// Startup restored an unverified barrier, which `retire_unverified_on_service_start` skips while
/// update evidence is pending (#1292). Cleared by a fresh arm or when that barrier is gone.
pub(super) static STARTUP_UNVERIFIED_BARRIER: AtomicBool = AtomicBool::new(false);
/// Startup reconciliation and desired-state replay have finished, so a previous Core is settled.
pub(super) static STARTUP_SETTLED: AtomicBool = AtomicBool::new(false);
/// The core window deadline was set by the update-held startup release, so each attempt
/// re-checks that the release is still owed before WFP removal.
pub(super) static UPDATE_RELEASE_LATCHED: AtomicBool = AtomicBool::new(false);
/// The watchdog's latest verify-by-key result. `/kill-switch/status` reuses it instead of
/// running a full WFP RPC sweep per request.
pub(super) static LAST_VERIFY: Lazy<Mutex<Option<(std::time::Instant, bool)>>> =
    Lazy::new(|| Mutex::new(None));

/// The watchdog's sleep between verify-after-write ticks. Named so the staleness budget below
/// can be derived from it instead of restating it.
pub(super) const WATCHDOG_PERIOD: std::time::Duration = std::time::Duration::from_secs(1);

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
pub(super) const VERIFY_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(5);

/// Calibration knob. Needs real-hardware calibration.
///
/// Used only when Core is already running or this boot will start it. Thirty seconds
/// matches the macOS helper's idle release (three checks, ten seconds apart). A Core
/// that is neither running nor starting does not wait: the block is released immediately.
pub(super) const WANTED_CORE_PROOF_WINDOW: std::time::Duration = std::time::Duration::from_secs(30);

/// A newly admitted Connect has a 310-second App deadline. Give it the same seven-minute
/// grace as a DIRECT bracket, then retire an attempt whose App never commits verification.
/// Unlike startup recovery, Core may not have been published yet when this window starts.
const FRESH_ARM_PROOF_WINDOW: std::time::Duration = std::time::Duration::from_secs(7 * 60);
pub(super) static FRESH_ARM_PROOF_PENDING: AtomicBool = AtomicBool::new(false);
/// Committed DIRECT expiry must retire its Service-owned Core before opening general traffic.
/// A late Lock/MarkVerified from the expired session cannot cancel that retirement.
pub(super) static DIRECT_EXPIRY_RETIREMENT_PENDING: AtomicBool = AtomicBool::new(false);
pub(super) static FRESH_ARM_EPOCH: AtomicU64 = AtomicU64::new(0);

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
pub(super) static CORE_REPLAY_EXPECTED: AtomicBool = AtomicBool::new(false);

/// Tests pretend a Core start is in flight without a process.
#[cfg(test)]
pub(super) static TEST_CORE_STARTING: AtomicBool = AtomicBool::new(false);

/// Expiry of the core-proof window for the verified wanted intent restored by this process.
/// `None` means the window is not running (strict opt-in, unverified recovery, a proven
/// tunnel, or an explicit release).
pub(super) static WANTED_CORE_DEADLINE: Lazy<Mutex<Option<std::time::Instant>>> = Lazy::new(|| Mutex::new(None));

/// In-memory copy of a crash-window tombstone's reconnect flag. Status reports it after
/// `ARMED` is cleared; the on-disk tombstone restores it across a Service restart.
pub(super) static RECONNECT_AFTER_RELEASE: AtomicBool = AtomicBool::new(false);

/// The owner the in-memory reconnect flag is owed to (#1291). Written together with
/// `RECONNECT_AFTER_RELEASE` under this lock by `publish_reconnect`.
static RECONNECT_OWNER: Mutex<Option<String>> = Mutex::new(None);

pub(super) fn reconnect_owner_guard() -> std::sync::MutexGuard<'static, Option<String>> {
    RECONNECT_OWNER
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Publish the crash-window reconnect flag and the owner it is owed to.
pub(super) fn publish_reconnect(reconnect: bool, owner: Option<String>) {
    let mut recorded = reconnect_owner_guard();
    *recorded = if reconnect { owner } else { None };
    RECONNECT_AFTER_RELEASE.store(reconnect, Ordering::Release);
}

/// Publish the reconnect disposition a released record carries.
pub(super) fn publish_reconnect_from(intent: &IntentRecord) {
    publish_reconnect(
        intent.reconnect_after_release,
        intent.reconnect_owner_key.clone(),
    );
}

/// WFP is already gone but the crash-window tombstone write failed. The watchdog retries
/// the write without reinstalling the block.
pub(super) static CRASH_TOMBSTONE_PENDING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WantedCoreWindow {
    /// Strict opt-in, or still inside the window: leave the restored block.
    Keep,
    /// Core is running, the session is verified and Locked, and the tunnel permit is up.
    Proven,
    /// The window elapsed without that proof, or Core is neither running nor starting.
    Release,
}

pub(super) fn restored_connection_proven(
    core_running: bool,
    verified: bool,
    mode: KillSwitchStatusMode,
    tunnel_permit_rendered: bool,
) -> bool {
    core_running && verified && mode == KillSwitchStatusMode::Locked && tunnel_permit_rendered
}

pub(super) fn wanted_core_window_action(
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

pub(super) fn core_is_running_or_starting(running: bool, replay_expected: bool) -> bool {
    if running || replay_expected {
        return true;
    }
    #[cfg(test)]
    if TEST_CORE_STARTING.load(Ordering::Relaxed) {
        return true;
    }
    false
}

pub(super) fn core_still_expected(running: bool) -> bool {
    core_is_running_or_starting(running, CORE_REPLAY_EXPECTED.load(Ordering::Relaxed))
}

pub(super) fn clear_wanted_core_window() {
    UPDATE_RELEASE_LATCHED.store(false, Ordering::Release);
    DIRECT_EXPIRY_RETIREMENT_PENDING.store(false, Ordering::Release);
    FRESH_ARM_PROOF_PENDING.store(false, Ordering::Release);
    *WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
}

pub(super) fn note_fresh_arm_core_window(intent: &IntentRecord) {
    clear_wanted_core_window();
    STARTUP_UNVERIFIED_BARRIER.store(false, Ordering::Release);
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
pub(in crate::core) fn expired_fresh_arm_owner(epoch: u64) -> Option<String> {
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

pub(in crate::core) async fn release_expired_fresh_arm(epoch: u64) -> Result<()> {
    let _operation = WFP_OPERATION.lock().await;
    if expired_fresh_arm_owner(epoch).is_none() {
        return Ok(());
    }
    release_unproven_wanted_session_unlocked().await
}

/// Reuse the epoch-fenced owner lifecycle cleanup after committed DIRECT expiry. Caller holds
/// WFP_OPERATION and has already proved exact Blocked. Core owns its own routes and strict-route
/// WFP session, so removing only Tono's filters cannot complete selective fallback.
pub(super) fn queue_direct_expiry_retirement() -> bool {
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

pub(super) fn note_wanted_core_window(intent: &IntentRecord) {
    let mut deadline = WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if intent.strict_kill_switch || !intent.wanted || !intent.is_verified() {
        *deadline = None;
        return;
    }
    *deadline = Some(std::time::Instant::now() + WANTED_CORE_PROOF_WINDOW);
}

pub(super) fn wanted_core_deadline_reached(now: std::time::Instant) -> bool {
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
pub(super) const DNS_RESTORE_STALLED_PREFIX: &str = "TONO_DNS_RESTORE_STALLED";

/// Budget for the cross-module DNS awaits taken on the WFP writer path (`bounded_dns_call`).
/// A DNS restore is two PowerShell batches (10 s each), a live read-back and a cache flush, so
/// the module's own worst case fits inside this and the bound only fires on a genuine stall. It
/// also stays under the IPC handler's 60 s budget, so the refusal still reaches the client.
pub(super) const DNS_RESTORE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(40);

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
pub(super) const UNINSTALL_DNS_RESTORE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(100);

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
pub(super) fn uninstall_ladder_requested() -> bool {
    std::env::var_os(UNINSTALL_LADDER_ENV).is_some_and(|value| value == "1")
}

pub(super) fn note_verify(ok: bool) {
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
pub(super) fn armed_guard() -> std::sync::MutexGuard<'static, Option<Armed>> {
    ARMED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(super) static STARTUP_RELEASE_RETRY_RUNNING: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
pub(super) static TEST_REMOVE_FAILURE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
pub(super) static TEST_REMOVE_ATTEMPTS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
pub(super) static TEST_HOLD_AT_LAST_REMOVAL: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
pub(super) static TEST_RESIDUAL_FILTER_KEYS: Lazy<Mutex<Vec<wfp_model::Guid>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

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

pub(super) fn last_error_guard() -> std::sync::MutexGuard<'static, Option<String>> {
    LAST_ERROR
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(super) fn last_verify_guard() -> std::sync::MutexGuard<'static, Option<(std::time::Instant, bool)>> {
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
pub(super) fn verify_reads_live(last_verify: Option<(std::time::Instant, bool)>) -> bool {
    last_verify.is_some_and(|(at, ok)| ok && at.elapsed() < VERIFY_CACHE_TTL)
}
