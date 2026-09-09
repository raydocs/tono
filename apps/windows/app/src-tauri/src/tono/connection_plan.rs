//! Connect failure / node-select decision table (pure functions).

use tono_core::connection::{ConnectionFsm, ConnectionStatus};

// Local copies: this module must not import `crate::tono::connection`.
const RELEASE_RECONCILING_PREFIX: &str = "TONO_RELEASE_RECONCILING";
const TRANSITION_IN_FLIGHT_REJECTION: &str = "a connection transition is already in flight";
const CATALOG_NOT_READY_REJECTION: &str = "the exit catalog is not available yet";

/// H-1 decision: a stale exit only patches the late arm when the StartClash
/// IPC actually returned success (a failed IPC never armed anything) *and*
/// the generation bump came from a releasing flow (disconnect / sign-out /
/// quit) — a node switch or catalog teardown re-arms or keeps the barrier,
/// so releasing here would tear down their protection instead.
pub fn stale_exit_needs_release(start_clash_committed: bool, release_intent: bool) -> bool {
    start_clash_committed && release_intent
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

/// Reconnect latch for `fail_connect`. The Service `verified` bit can still
/// be true from a previous node or an inherited arm; it must not invent an
/// admit. Only the App FSM commit counts.
pub fn session_verified_for_failure(protection_committed: bool, service_verified: bool) -> bool {
    let _ = service_verified;
    protection_committed
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

/// Whether a protected reconnect may run: the barrier is up, the machine is
/// idle in Protected Offline, and the catalog is not waiting for the user.
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
    fsm: &mut ConnectionFsm,
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
