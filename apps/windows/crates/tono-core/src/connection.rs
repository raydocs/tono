//! Connect state machine (product-contract.md §6/§7).
//!
//! Pure logic only: stages, UI state derivation, reconnect backoff, and the
//! failure decision table. An initial, not-yet-verified attempt is released
//! on failure; after a tunnel has been fully verified the logical session
//! remains fail-closed until explicit Disconnect, Sign Out, or Quit.

use std::time::Duration;

/// The connect-transaction stages, in order (§6). `PreparingService` is
/// the Windows rename of macOS `preparingHelper` (the privileged steps are
/// performed by the Windows service); `ApplyingCloudPolicy` applies the
/// cloud WeChat-DIRECT policy after the tunnel is locked (Mac Build 28
/// parity).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ConnectStage {
    Preparing,
    PreparingService,
    StartingKillSwitch,
    StartingTunnel,
    LockingTraffic,
    ApplyingCloudPolicy,
    SecuringDns,
    CheckingExit,
    VerifyingTraffic,
}

impl ConnectStage {
    /// All stages in transaction order.
    pub const ALL: [ConnectStage; 9] = [
        ConnectStage::Preparing,
        ConnectStage::PreparingService,
        ConnectStage::StartingKillSwitch,
        ConnectStage::StartingTunnel,
        ConnectStage::LockingTraffic,
        ConnectStage::ApplyingCloudPolicy,
        ConnectStage::SecuringDns,
        ConnectStage::CheckingExit,
        ConnectStage::VerifyingTraffic,
    ];

    /// UI text, mirroring the macOS strings (§7).
    pub fn label(self) -> &'static str {
        match self {
            ConnectStage::Preparing => "Preparing protection…",
            ConnectStage::PreparingService => "Preparing secure service…",
            ConnectStage::StartingKillSwitch => {
                "Enabling protection and installing the tunnel adapter…"
            }
            ConnectStage::StartingTunnel => "Starting the protected tunnel…",
            ConnectStage::LockingTraffic => "Locking traffic to tunnel…",
            ConnectStage::ApplyingCloudPolicy => "Applying cloud routing policy…",
            ConnectStage::SecuringDns => "Securing DNS…",
            ConnectStage::CheckingExit => "Checking secure exit…",
            ConnectStage::VerifyingTraffic => "Verifying traffic protection…",
        }
    }
}

/// Observable connection state (§7). Flag layout mirrors the macOS
/// AppState so UI bindings stay a mechanical port.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConnectionStatus {
    pub is_connected: bool,
    pub is_connecting: bool,
    pub is_disconnecting: bool,
    /// Kill switch armed while not connected: the fail-closed "blocked"
    /// state the UI shows as Protected Offline.
    pub is_protection_blocked: bool,
    pub stage: Option<ConnectStage>,
}

/// Top-level UI states (§7). "Recovering" is ProtectedOffline plus an
/// active backoff, not a separate state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiState {
    NotConnected,
    Connecting(ConnectStage),
    Connected,
    ProtectedOffline,
    Disconnecting,
}

impl ConnectionStatus {
    pub fn ui_state(&self) -> UiState {
        if self.is_disconnecting {
            UiState::Disconnecting
        } else if self.is_connecting {
            UiState::Connecting(self.stage.unwrap_or(ConnectStage::Preparing))
        } else if self.is_connected {
            UiState::Connected
        } else if self.is_protection_blocked {
            UiState::ProtectedOffline
        } else {
            UiState::NotConnected
        }
    }
}

/// Auto-reconnect backoff behind an armed kill switch: 2/5/10/20/30 s,
/// capped at 30 s and bounded by [`Self::BUDGET`] (§6).
#[derive(Debug, Clone, Default)]
pub struct ReconnectBackoff {
    step: usize,
    /// Everything the ladder has already handed out for this outage.
    scheduled: Duration,
}

impl ReconnectBackoff {
    pub const DELAYS_SECS: [u64; 5] = [2, 5, 10, 20, 30];

    /// How long the ladder retries on its own before it hands the machine back to the user.
    ///
    /// `DELAYS_SECS` caps the *interval*, not the ladder. A deterministic failure — a broken
    /// install, a Service that cannot start — never stops failing, so a capped-only ladder
    /// repeated the identical attempt every 30 s for as long as the app ran, and every rung
    /// re-entered the elevated repair path with an administrator prompt of its own. Automatic
    /// recovery is untouched inside the budget: a transient failure still reconnects with no
    /// user action, a success resets the ladder, and an explicit retry starts a fresh one.
    pub const BUDGET: Duration = Duration::from_secs(30 * 60);

    pub fn new() -> Self {
        Self::default()
    }

    /// The next rung, or `None` once the budget is spent.
    pub fn next_delay(&mut self) -> Option<Duration> {
        if self.exhausted() {
            return None;
        }
        let seconds = Self::DELAYS_SECS[self.step.min(Self::DELAYS_SECS.len() - 1)];
        self.step += 1;
        let delay = Duration::from_secs(seconds);
        self.scheduled += delay;
        Some(delay)
    }

    /// Whether the ladder has spent [`Self::BUDGET`] and stopped retrying by itself.
    pub fn exhausted(&self) -> bool {
        self.scheduled >= Self::BUDGET
    }

    pub fn reset(&mut self) {
        self.step = 0;
        self.scheduled = Duration::ZERO;
    }
}

/// What a connect failure does to the kill switch (§6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureAction {
    /// Failure after the WFP policy exists: stop the core, keep blocking,
    /// enter Protected Offline, auto-reconnect with backoff.
    KeepBlockingAndReconnect,
    /// Failure before the WFP policy exists (e.g. elevation refused):
    /// full release.
    FullRelease,
}

/// Initial attempts release on failure; only a verified armed session reconnects fail-closed.
pub fn on_connect_failure(kill_switch_armed: bool, session_verified: bool) -> FailureAction {
    if kill_switch_armed && session_verified {
        FailureAction::KeepBlockingAndReconnect
    } else {
        FailureAction::FullRelease
    }
}

/// Everything that can end a session. Only Disconnect, SignOut, and Quit
/// may release the kill switch (§6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShutdownCause {
    Disconnect,
    SignOut,
    Quit,
    Crash,
    Kill,
    Sleep,
    NetworkChange,
    CatalogFailure,
    ApiOutage,
}

impl ShutdownCause {
    pub fn releases_kill_switch(self) -> bool {
        matches!(
            self,
            ShutdownCause::Disconnect | ShutdownCause::SignOut | ShutdownCause::Quit
        )
    }
}

/// Refused state-machine transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectTransitionError {
    /// `Connected` requires an in-flight transaction and an armed kill
    /// switch; an unarmed Connected state is the one combination the
    /// fail-closed promise forbids (M2).
    InvalidSuccessPrecondition,
}

impl std::fmt::Display for ConnectTransitionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectTransitionError::InvalidSuccessPrecondition => f.write_str(
                "connect can only succeed while connecting with a verified armed kill switch",
            ),
        }
    }
}

impl std::error::Error for ConnectTransitionError {}

/// Pure connect-transaction state machine. Owns the flags, the armed
/// latch, and the backoff so every transition in §6 is testable without
/// I/O.
#[derive(Debug, Clone, Default)]
pub struct ConnectionFsm {
    status: ConnectionStatus,
    kill_switch_armed: bool,
    session_verified: bool,
    backoff: ReconnectBackoff,
}

impl ConnectionFsm {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn status(&self) -> &ConnectionStatus {
        &self.status
    }

    pub fn kill_switch_armed(&self) -> bool {
        self.kill_switch_armed
    }

    pub fn session_verified(&self) -> bool {
        self.session_verified
    }

    /// Record (or restore) that this logical protection session completed all checks.
    pub fn mark_session_verified(&mut self) {
        self.session_verified = true;
    }

    /// Step 1: begin a connect transaction.
    pub fn begin_connect(&mut self) {
        self.status.is_connecting = true;
        self.status.is_disconnecting = false;
        self.status.stage = Some(ConnectStage::Preparing);
    }

    /// Advance to `stage` (must be connecting; stages only move forward).
    pub fn advance_stage(&mut self, stage: ConnectStage) {
        debug_assert!(self.status.is_connecting);
        if let Some(current) = self.status.stage {
            debug_assert!(stage >= current);
        }
        self.status.stage = Some(stage);
    }

    /// Step 3 completes: the WFP bootstrap policy exists. From here on the
    /// machine is fail-closed.
    pub fn mark_kill_switch_armed(&mut self) {
        self.kill_switch_armed = true;
        self.status.is_protection_blocked = true;
    }

    /// Step 10: all checks passed. A transaction must be in flight, the kill
    /// switch armed, and the Service verification commit durable — an
    /// unverified or unarmed `Connected` must never exist.
    pub fn connect_succeeded(&mut self) -> Result<(), ConnectTransitionError> {
        if !self.status.is_connecting || !self.kill_switch_armed || !self.session_verified {
            return Err(ConnectTransitionError::InvalidSuccessPrecondition);
        }
        self.status.is_connected = true;
        self.status.is_connecting = false;
        self.status.is_disconnecting = false;
        self.status.is_protection_blocked = false;
        self.status.stage = None;
        self.backoff.reset();
        Ok(())
    }

    /// Connect transaction failed. A verified armed session stays blocked
    /// and reconnects; an initial attempt receives a full release.
    pub fn connect_failed(&mut self) -> FailureAction {
        match on_connect_failure(self.kill_switch_armed, self.session_verified) {
            FailureAction::KeepBlockingAndReconnect => {
                self.status.is_connected = false;
                self.status.is_connecting = false;
                self.status.is_disconnecting = false;
                self.status.is_protection_blocked = true;
                self.status.stage = None;
                FailureAction::KeepBlockingAndReconnect
            }
            FailureAction::FullRelease => {
                self.release();
                FailureAction::FullRelease
            }
        }
    }

    /// A required initial full release failed. Keep the real armed state visible and do not
    /// claim either network restoration or a reconnectable established session.
    pub fn initial_release_failed(&mut self) {
        self.status.is_connected = false;
        self.status.is_connecting = false;
        self.status.is_disconnecting = false;
        self.status.is_protection_blocked = self.kill_switch_armed;
        self.status.stage = None;
    }

    /// Mihomo crash or TUN disappearance at runtime: identical to a
    /// connect failure after arm (§6) — keep blocking, reconnect behind
    /// the barrier.
    pub fn tunnel_died(&mut self) -> FailureAction {
        debug_assert!(
            self.kill_switch_armed,
            "a live tunnel implies an armed kill switch"
        );
        debug_assert!(
            self.session_verified,
            "a live tunnel implies a verified session"
        );
        self.status.is_connected = false;
        self.status.is_connecting = false;
        self.status.stage = None;
        self.status.is_protection_blocked = self.kill_switch_armed;
        // Runtime tunnel loss is always fail-closed. Preserve (rather than manufacture) the
        // logical verification latch across the reconnect attempt.
        FailureAction::KeepBlockingAndReconnect
    }

    /// Whether a protected reconnect may run at all right now: idle in Protected
    /// Offline, never while connected, disconnecting, or mid-transaction (M1).
    ///
    /// Split out from [`Self::next_reconnect_delay`] because that method answers
    /// this same question and charges a backoff step for asking. An explicit
    /// "Retry now" must not be charged: it aborts the attempt that was already
    /// scheduled, so consuming a step replaced an imminent retry with a longer
    /// wait — the control that promises "sooner" made the outage strictly
    /// longer, and holding the button down held the machine in Protected
    /// Offline for as long as the user kept pressing it.
    pub fn reconnect_permitted_now(&self) -> bool {
        self.status.is_protection_blocked
            && self.session_verified
            && !self.status.is_connected
            && !self.status.is_disconnecting
            && !self.status.is_connecting
    }

    /// Delay before the next protected reconnect attempt, consuming one step of
    /// the ladder. Handed out only while [`Self::reconnect_permitted_now`], and
    /// only while the ladder still has budget.
    pub fn next_reconnect_delay(&mut self) -> Option<Duration> {
        if self.reconnect_permitted_now() {
            self.backoff.next_delay()
        } else {
            None
        }
    }

    /// Whether the ladder spent [`ReconnectBackoff::BUDGET`] on this outage without
    /// reconnecting. [`Self::reconnect_permitted_now`] deliberately stays true: the machine
    /// keeps its explicit Retry, it only stops asking by itself.
    pub fn reconnect_budget_exhausted(&self) -> bool {
        self.backoff.exhausted()
    }

    /// Give the ladder its budget back, for an explicit user retry: the user acting on the
    /// failure is the evidence that the machine may have changed, and one click is worth a
    /// full automatic recovery run again.
    pub fn reset_reconnect_backoff(&mut self) {
        self.backoff.reset();
    }

    /// Explicit disconnect is allowed from Connected or Protected Offline
    /// and is one of the three causes that release the kill switch (§6).
    ///
    /// Clears `is_connected` as well as setting `is_disconnecting`. Leaving it
    /// set meant every "is a tunnel up?" predicate read an in-flight release as
    /// a live tunnel, and the Windows release runs for seconds — its DNS leg
    /// alone budgets forty. Two handlers admitted themselves in that window,
    /// captured the disconnect's *own* generation, queued behind the release on
    /// the service's locks, and then passed their exit guards because the
    /// release had already cleared `is_disconnecting` on its way out. Both went
    /// on to run a full connect: WFP re-armed and the core restarted after
    /// `disconnect()` had returned and the UI said Not Connected.
    ///
    /// Nothing needs the old value. `ui_state` tests `is_disconnecting` first,
    /// `disconnect()` reads the status before calling this, the release
    /// sequence never consults it, and every other predicate either carries its
    /// own `is_disconnecting` term or becomes more conservative.
    pub fn begin_disconnect(&mut self) {
        self.status.is_disconnecting = true;
        self.status.is_connecting = false;
        self.status.is_connected = false;
        self.status.stage = None;
    }

    /// Disconnect finished (DNS restored *before* the kill switch was
    /// disarmed by the service — ordering enforced there, §6). Idempotent:
    /// a duplicate call (e.g. a raced disconnect and a failing connect
    /// transaction both converging the machine) is a no-op, never a panic.
    pub fn finish_disconnect(&mut self) {
        if !self.status.is_disconnecting {
            return;
        }
        self.release();
    }

    /// Sign out or quit: the other two releasing causes.
    pub fn sign_out_or_quit(&mut self) {
        self.release();
    }

    fn release(&mut self) {
        self.kill_switch_armed = false;
        self.session_verified = false;
        self.backoff.reset();
        self.status = ConnectionStatus::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stages_are_ordered_and_labelled() {
        assert_eq!(ConnectStage::ALL.len(), 9);
        assert!(ConnectStage::Preparing < ConnectStage::VerifyingTraffic);
        assert!(ConnectStage::LockingTraffic < ConnectStage::ApplyingCloudPolicy);
        assert!(ConnectStage::ApplyingCloudPolicy < ConnectStage::SecuringDns);
        let labels: Vec<&str> = ConnectStage::ALL
            .iter()
            .map(|stage| stage.label())
            .collect();
        assert_eq!(
            labels,
            [
                "Preparing protection…",
                "Preparing secure service…",
                "Enabling protection and installing the tunnel adapter…",
                "Starting the protected tunnel…",
                "Locking traffic to tunnel…",
                "Applying cloud routing policy…",
                "Securing DNS…",
                "Checking secure exit…",
                "Verifying traffic protection…",
            ]
        );
    }

    #[test]
    fn backoff_produces_capped_sequence() {
        let mut backoff = ReconnectBackoff::new();
        let delays: Vec<Duration> = (0..8).map(|_| backoff.next_delay().unwrap()).collect();
        assert_eq!(
            delays,
            [2, 5, 10, 20, 30, 30, 30, 30]
                .map(Duration::from_secs)
                .to_vec()
        );
        backoff.reset();
        assert_eq!(backoff.next_delay(), Some(Duration::from_secs(2)));
    }

    /// The ladder has an end.
    ///
    /// The 30 s cap bounds one wait, not the sequence, so a failure that never clears — a
    /// broken install, a Service that cannot start — used to be retried every 30 s for the
    /// life of the app, and each retry re-entered the elevated repair path and asked the user
    /// to approve an administrator prompt.
    #[test]
    fn backoff_stops_after_its_budget() {
        let mut backoff = ReconnectBackoff::new();
        let mut scheduled = Duration::ZERO;
        let mut rungs = 0_u32;
        while let Some(delay) = backoff.next_delay() {
            scheduled += delay;
            rungs += 1;
            assert!(rungs < 1_000, "the ladder must not run forever");
        }
        assert!(backoff.exhausted());
        assert!(scheduled >= ReconnectBackoff::BUDGET);
        // The early rungs are the transient-failure path and are unchanged, so the budget must
        // be worth far more than the handful of retries a Wi-Fi flap needs.
        assert!(rungs > ReconnectBackoff::DELAYS_SECS.len() as u32 * 2);
        // Spent means spent: it keeps saying no until something resets it.
        assert_eq!(backoff.next_delay(), None);
        backoff.reset();
        assert!(!backoff.exhausted());
        assert_eq!(backoff.next_delay(), Some(Duration::from_secs(2)));
    }

    /// A user who acts on the failed state gets a whole recovery run again, so the bound
    /// above can never strand a machine whose problem has since been fixed.
    #[test]
    fn an_explicit_retry_restores_the_ladder() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_failed();
        while fsm.next_reconnect_delay().is_some() {}
        assert!(fsm.reconnect_budget_exhausted());
        // Still Protected Offline, and the explicit path still allowed: only the automatic
        // ladder gave up.
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        assert!(fsm.reconnect_permitted_now());

        fsm.reset_reconnect_backoff();
        assert!(!fsm.reconnect_budget_exhausted());
        assert_eq!(fsm.next_reconnect_delay(), Some(Duration::from_secs(2)));
    }

    #[test]
    fn ui_state_derivation() {
        let mut status = ConnectionStatus::default();
        assert_eq!(status.ui_state(), UiState::NotConnected);
        status.is_connecting = true;
        status.stage = Some(ConnectStage::SecuringDns);
        assert_eq!(
            status.ui_state(),
            UiState::Connecting(ConnectStage::SecuringDns)
        );
        // Missing stage falls back to the first stage label.
        status.stage = None;
        assert_eq!(
            status.ui_state(),
            UiState::Connecting(ConnectStage::Preparing)
        );
        status.is_connecting = false;
        status.is_connected = true;
        assert_eq!(status.ui_state(), UiState::Connected);
        status.is_connected = false;
        status.is_protection_blocked = true;
        assert_eq!(status.ui_state(), UiState::ProtectedOffline);
        status.is_disconnecting = true;
        assert_eq!(status.ui_state(), UiState::Disconnecting);
    }

    #[test]
    fn failure_decision_table() {
        assert_eq!(on_connect_failure(false, false), FailureAction::FullRelease);
        assert_eq!(on_connect_failure(true, false), FailureAction::FullRelease);
        assert_eq!(
            on_connect_failure(true, true),
            FailureAction::KeepBlockingAndReconnect
        );
    }

    #[test]
    fn only_disconnect_signout_quit_release() {
        for (cause, releases) in [
            (ShutdownCause::Disconnect, true),
            (ShutdownCause::SignOut, true),
            (ShutdownCause::Quit, true),
            (ShutdownCause::Crash, false),
            (ShutdownCause::Kill, false),
            (ShutdownCause::Sleep, false),
            (ShutdownCause::NetworkChange, false),
            (ShutdownCause::CatalogFailure, false),
            (ShutdownCause::ApiOutage, false),
        ] {
            assert_eq!(cause.releases_kill_switch(), releases, "{cause:?}");
        }
    }

    #[test]
    fn happy_path_connect_then_disconnect() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        assert_eq!(
            fsm.status().ui_state(),
            UiState::Connecting(ConnectStage::Preparing)
        );
        for stage in &ConnectStage::ALL[1..] {
            fsm.advance_stage(*stage);
            if *stage == ConnectStage::StartingTunnel {
                fsm.mark_kill_switch_armed();
            }
        }
        assert!(fsm.kill_switch_armed());
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        assert_eq!(fsm.status().ui_state(), UiState::Connected);
        assert!(
            fsm.kill_switch_armed(),
            "kill switch stays armed while connected"
        );
        fsm.begin_disconnect();
        assert_eq!(fsm.status().ui_state(), UiState::Disconnecting);
        fsm.finish_disconnect();
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);
        assert!(!fsm.kill_switch_armed());
    }

    #[test]
    fn failure_before_arm_fully_releases() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.advance_stage(ConnectStage::PreparingService);
        // Elevation refused: no WFP policy exists yet.
        assert_eq!(fsm.connect_failed(), FailureAction::FullRelease);
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);
        assert!(!fsm.kill_switch_armed());
        assert_eq!(
            fsm.next_reconnect_delay(),
            None,
            "no protected reconnect after release"
        );
    }

    #[test]
    fn failure_after_verified_session_keeps_blocking_and_backs_off() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.advance_stage(ConnectStage::StartingKillSwitch);
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.advance_stage(ConnectStage::StartingTunnel);
        assert_eq!(
            fsm.connect_failed(),
            FailureAction::KeepBlockingAndReconnect
        );
        assert!(fsm.kill_switch_armed());
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        // Protected Offline + active backoff == "Recovering" (§7).
        assert_eq!(fsm.next_reconnect_delay(), Some(Duration::from_secs(2)));
        assert_eq!(fsm.next_reconnect_delay(), Some(Duration::from_secs(5)));
    }

    #[test]
    fn tunnel_death_at_runtime_keeps_blocking() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        assert_eq!(fsm.tunnel_died(), FailureAction::KeepBlockingAndReconnect);
        assert!(fsm.kill_switch_armed());
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        assert!(!fsm.status().is_connected);
    }

    /// An in-flight release must not read as a live tunnel.
    ///
    /// The Windows release runs for seconds — its DNS leg alone budgets forty —
    /// and while `begin_disconnect` left `is_connected` set, two handlers
    /// admitted themselves in that window on exactly this predicate, captured
    /// the disconnect's own generation, queued behind the release, and then
    /// passed their exit guards because the release had already cleared
    /// `is_disconnecting` on its way out. Both went on to run a full connect:
    /// the barrier re-armed and the core restarted after the user's Disconnect
    /// had returned and the UI said Not Connected.
    #[test]
    fn a_release_in_flight_does_not_read_as_a_live_tunnel() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        assert!(fsm.status().is_connected);

        fsm.begin_disconnect();
        assert!(
            !fsm.status().is_connected,
            "every \"is a tunnel up?\" predicate reads this field"
        );
        assert!(fsm.status().is_disconnecting);
        // The state the user is shown is unchanged: `ui_state` tests
        // `is_disconnecting` first, so clearing the other flag is invisible.
        assert_eq!(fsm.status().ui_state(), UiState::Disconnecting);
        // And nothing may start a reconnect underneath the release.
        assert!(!fsm.reconnect_permitted_now());
        assert_eq!(fsm.next_reconnect_delay(), None);
    }

    /// Asking whether a reconnect may run must not cost a rung of the ladder.
    ///
    /// "Retry now" aborts the attempt that was already scheduled and then asks for
    /// one. While the only way to ask was `next_reconnect_delay`, that question
    /// consumed a step, so each press traded an imminent retry for a longer wait
    /// and pushed the ladder up: after a few failures the user was replacing a
    /// one-second countdown with a thirty-second one every time they pressed the
    /// button, and could hold the machine in Protected Offline indefinitely by
    /// pressing it.
    #[test]
    fn asking_whether_a_reconnect_may_run_does_not_consume_a_backoff_step() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_failed();

        // However many times it is asked, the ladder has not moved.
        for _ in 0..10 {
            assert!(fsm.reconnect_permitted_now());
        }
        assert_eq!(fsm.next_reconnect_delay(), Some(Duration::from_secs(2)));
        for _ in 0..10 {
            assert!(fsm.reconnect_permitted_now());
        }
        assert_eq!(fsm.next_reconnect_delay(), Some(Duration::from_secs(5)));
    }

    /// The cheap predicate and the charging one must agree about *when*, or the
    /// immediate path could run in a state the scheduled path refuses.
    #[test]
    fn the_two_reconnect_predicates_agree_about_when() {
        let mut fsm = ConnectionFsm::new();
        assert!(!fsm.reconnect_permitted_now());
        assert_eq!(fsm.next_reconnect_delay(), None);

        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        // Mid-connect: neither may run.
        assert!(!fsm.reconnect_permitted_now());
        assert_eq!(fsm.next_reconnect_delay(), None);

        fsm.connect_failed();
        assert!(fsm.reconnect_permitted_now());
        assert!(fsm.next_reconnect_delay().is_some());

        // Once a disconnect starts, both refuse again.
        fsm.begin_disconnect();
        assert!(!fsm.reconnect_permitted_now());
        assert_eq!(fsm.next_reconnect_delay(), None);
    }

    #[test]
    fn reconnect_after_failure_resets_backoff_on_success() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_failed();
        assert_eq!(fsm.next_reconnect_delay(), Some(Duration::from_secs(2)));
        // The protected reconnect run succeeds.
        fsm.begin_connect();
        fsm.connect_succeeded().unwrap();
        assert_eq!(fsm.next_reconnect_delay(), None);
        // A later failure starts the backoff from the top again.
        fsm.tunnel_died();
        assert_eq!(fsm.next_reconnect_delay(), Some(Duration::from_secs(2)));
    }

    #[test]
    fn disconnect_from_protected_offline_releases() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_failed();
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        fsm.begin_disconnect();
        fsm.finish_disconnect();
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);
        assert!(!fsm.kill_switch_armed());
    }

    #[test]
    fn finish_disconnect_is_idempotent() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        fsm.begin_disconnect();
        fsm.finish_disconnect();
        // A raced second convergence must be a no-op, not a panic.
        fsm.finish_disconnect();
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);
        assert!(!fsm.kill_switch_armed());
        // Calling it on a fresh machine is equally inert.
        let mut fresh = ConnectionFsm::new();
        fresh.finish_disconnect();
        assert_eq!(fresh.status().ui_state(), UiState::NotConnected);
    }

    #[test]
    fn sign_out_releases_from_any_state() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        fsm.sign_out_or_quit();
        assert_eq!(fsm.status().ui_state(), UiState::NotConnected);
        assert!(!fsm.kill_switch_armed());
        assert_eq!(fsm.next_reconnect_delay(), None);
    }

    #[test]
    fn reconnect_predicate_stops_once_disconnect_begins() {
        // M1: explicit disconnect from Protected Offline is allowed (§6)
        // and must stop any further protected reconnects.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_failed();
        assert_eq!(fsm.status().ui_state(), UiState::ProtectedOffline);
        assert!(fsm.next_reconnect_delay().is_some());
        fsm.begin_disconnect();
        assert_eq!(fsm.next_reconnect_delay(), None);
        fsm.finish_disconnect();
        assert_eq!(fsm.next_reconnect_delay(), None);
    }

    #[test]
    fn reconnect_predicate_pauses_during_reconnect_attempt() {
        // M1: while the reconnect transaction runs, no delay is handed out.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_failed();
        assert!(fsm.next_reconnect_delay().is_some());
        fsm.begin_connect();
        assert_eq!(fsm.next_reconnect_delay(), None);
        fsm.advance_stage(ConnectStage::StartingKillSwitch);
        fsm.connect_succeeded().unwrap();
        assert_eq!(fsm.next_reconnect_delay(), None);
    }

    #[test]
    fn connect_succeeded_requires_verified_armed_connect_transaction() {
        // M2: fresh machine — no transaction, no arm. Success must be
        // refused, never producing an unarmed Connected state.
        let mut fsm = ConnectionFsm::new();
        assert_eq!(
            fsm.connect_succeeded(),
            Err(ConnectTransitionError::InvalidSuccessPrecondition)
        );
        assert!(!fsm.status().is_connected);
        // Armed but not connecting is still not a valid success.
        let mut fsm = ConnectionFsm::new();
        fsm.mark_kill_switch_armed();
        assert_eq!(
            fsm.connect_succeeded(),
            Err(ConnectTransitionError::InvalidSuccessPrecondition)
        );
        assert!(!fsm.status().is_connected);
        // Connecting but not yet armed (pre-WFP failure path) likewise.
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        assert_eq!(
            fsm.connect_succeeded(),
            Err(ConnectTransitionError::InvalidSuccessPrecondition)
        );
        assert!(!fsm.status().is_connected);
        // Connecting and armed is still insufficient until the durable
        // verification commit succeeds.
        fsm.mark_kill_switch_armed();
        assert_eq!(
            fsm.connect_succeeded(),
            Err(ConnectTransitionError::InvalidSuccessPrecondition)
        );
        assert!(!fsm.status().is_connected);
    }
}
