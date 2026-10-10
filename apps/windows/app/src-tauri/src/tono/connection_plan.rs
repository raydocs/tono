//! Connect failure / node-select decision table (pure functions).

use tono_core::connection::{ConnectionFsm, ConnectionStatus};

// Local copies: this module must not import `crate::tono::connection`.
const RELEASE_RECONCILING_PREFIX: &str = "TONO_RELEASE_RECONCILING";
const TRANSITION_IN_FLIGHT_REJECTION: &str = "a connection transition is already in flight";
const CATALOG_NOT_READY_REJECTION: &str = "the exit catalog is not available yet";

/// H-1 decision: a stale exit only patches the late arm when the StartClash
/// IPC actually returned success (a failed IPC never armed anything) *and*
/// the generation bump came from a releasing flow (disconnect / sign-out /
/// quit / non-strict catalog teardown) — a node switch or strict catalog
/// teardown keeps the barrier, so releasing here would tear down their protection instead.
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
    /// The selective hook already rewrote filters. Do not full-release.
    pub selective_ai_hold: bool,
}

pub fn plan_failure(
    armed: bool,
    session_verified: bool,
    was_disconnecting: bool,
    strict_kill_switch: bool,
) -> FailurePlan {
    // The hook runs only for a verified barrier that is not a raced
    // disconnect and not an explicit strict kill switch. No barrier means
    // the AI rules are not engaged.
    let engage = if armed && session_verified && !was_disconnecting && !strict_kill_switch {
        tono_core::registered_selective_ai_block()
    } else {
        None
    };
    plan_failure_using(
        armed,
        session_verified,
        was_disconnecting,
        strict_kill_switch,
        engage,
    )
}

/// `engage` is ignored unless a verified barrier is up and this is not a
/// raced disconnect. The policy match itself lives in
/// `tono_core::exhausted_protection_using` (#706). #703 must call that
/// function rather than copy this table.
pub fn plan_failure_using(
    armed: bool,
    session_verified: bool,
    was_disconnecting: bool,
    strict_kill_switch: bool,
    engage: Option<fn() -> bool>,
) -> FailurePlan {
    if was_disconnecting {
        // A disconnect is in flight and owns the release sequence end to
        // end; the failing transaction must not double it.
        return FailurePlan {
            mark_armed: false,
            stop_core: None,
            restrict_bootstrap: false,
            selective_ai_hold: false,
        };
    }
    if !(armed && session_verified) {
        return FailurePlan {
            mark_armed: false,
            stop_core: Some(true),
            restrict_bootstrap: false,
            selective_ai_hold: false,
        };
    }
    match tono_core::exhausted_protection_using(strict_kill_switch, engage) {
        tono_core::ExhaustedProtection::KeepStrictBlock => FailurePlan {
            mark_armed: true,
            stop_core: Some(false),
            restrict_bootstrap: true,
            selective_ai_hold: false,
        },
        tono_core::ExhaustedProtection::ReleaseGeneralKeepAi => FailurePlan {
            mark_armed: true,
            stop_core: None,
            restrict_bootstrap: false,
            selective_ai_hold: true,
        },
        tono_core::ExhaustedProtection::ReleaseOriginalNetwork => FailurePlan {
            mark_armed: false,
            stop_core: Some(true),
            restrict_bootstrap: false,
            selective_ai_hold: false,
        },
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

/// Whether a failed protected reconnect left the original network released: no barrier, no
/// Protected Offline, nothing in flight.
///
/// The ladder runs only while the barrier holds ([`reconnect_allowed`]). On Windows an armed,
/// verified attempt that fails without an explicit strict kill switch releases the original
/// network ([`plan_failure`]), so after a startup resume, Retry now, a rebuild switch or a policy
/// rebuild failed once, nothing retried and the PC stayed disconnected. In this state the
/// unarmed probe is the recovery, as after a user connect's fail-open and a health release.
pub fn failure_released_the_network(status: &ConnectionStatus, kill_switch_armed: bool) -> bool {
    !kill_switch_armed
        && !status.is_protection_blocked
        && !status.is_connected
        && !status.is_connecting
        && !status.is_disconnecting
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
    /// Immediate protected reconnect, same as Retry now (M5: also when a
    /// vanished node's replacement was just picked, i.e. `requires_choice`
    /// cleared). Must not take the 2s first rung of `schedule_reconnect`.
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
