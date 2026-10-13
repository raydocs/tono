//! Status reporting.

use super::*;

pub(crate) async fn status() -> KillSwitchStatus {
    // Never join the WFP writer queue. The watchdog refreshes `LAST_VERIFY`; mutations publish
    // `ARMED` only at their commit boundary, so a concurrent read gets the previous committed
    // state rather than blocking behind an RPC that may itself be the thing under diagnosis.
    status_from(armed_guard().clone())
}

/// [`status`] of an already-copied `ARMED`, so one reading can feed more than one answer.
fn status_from(armed: Option<Armed>) -> KillSwitchStatus {
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

/// `status()` as `caller_key` may see it. A crash-window reconnect is reported only to the
/// owner whose session was released (#1291): another signed-in user's App must not
/// auto-connect from it and take the machine's protection over.
pub(crate) async fn status_for(caller_key: &str) -> KillSwitchStatus {
    let mut status = status().await;
    if status.reconnect_after_release && !reconnect_owed_to(caller_key) {
        status.reconnect_after_release = false;
    }
    status
}

/// Whether the barrier in `armed` belongs to another user than `caller_key` (#1290). The rule is
/// `authorize_write_for`'s: only a wanted barrier with a recorded owner who is not the caller
/// counts, so an intent whose owner record was lost (WIN-OWNER-RELEASE-NONE) stays the caller's
/// to see and release. It is taken from the copy of `ARMED` the status was built from: reading
/// `ARMED` again for the flag let a release and a re-arm by the other user land between the two
/// reads, so the caller saw A's new barrier as its own (Codex re-review of #1623).
fn held_by_another_user_in(armed: Option<&Armed>, caller_key: &str) -> bool {
    armed.is_some_and(|armed| {
        armed.intent.wanted
            && armed
                .intent
                .owner_key
                .as_deref()
                .is_some_and(|recorded| recorded != caller_key)
    })
}

/// One reading of `ARMED` for both the caller's [`status_for`] view and whether that barrier is
/// another user's. The flag is true only for a barrier the returned status reports as wanted.
pub(super) fn status_for_with_holder_from(armed: Option<Armed>, caller_key: &str) -> (KillSwitchStatus, bool) {
    let held = held_by_another_user_in(armed.as_ref(), caller_key);
    let mut status = status_from(armed);
    if status.reconnect_after_release && !reconnect_owed_to(caller_key) {
        status.reconnect_after_release = false;
    }
    (status, held)
}

/// Whether the reported reconnect flag is owed to `caller_key`. An ownerless flag (a legacy
/// tombstone, or the release of an intent that recorded no owner) is owed to nobody: the first
/// caller it would have been reported to clears it, and the clear is logged.
fn reconnect_owed_to(caller_key: &str) -> bool {
    let armed_owner = { armed_guard().clone() }
        .filter(|armed| !armed.intent.wanted && armed.intent.reconnect_after_release)
        .map(|armed| armed.intent.reconnect_owner_key);
    if let Some(owner) = armed_owner {
        return owner.as_deref() == Some(caller_key);
    }
    let recorded = reconnect_owner_guard();
    match recorded.as_deref() {
        Some(owner) => owner == caller_key,
        None => {
            if RECONNECT_AFTER_RELEASE.swap(false, Ordering::AcqRel) {
                tracing::warn!(
                    "Windows kill switch: cleared a crash-window reconnect flag that names no \
                     owner; no App reconnects from it (#1291)"
                );
            }
            false
        }
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
/// source of truth there. Also whether the barrier it reports is another user's (#1290), both
/// from one reading of `ARMED`.
pub(crate) async fn status_snapshot_with_holder(
    caller_key: &str,
) -> Option<(KillSwitchStatus, bool)> {
    if cfg!(windows) {
        let armed = { armed_guard().clone() };
        Some(status_for_with_holder_from(armed, caller_key))
    } else {
        None
    }
}
