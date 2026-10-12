//! Release, disarm and the bounded DNS calls on the WFP writer path.

use super::*;

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
/// restore (the timeout drops the future) never removes an unproven snapshot, because
/// `restore_protected` deletes it only *after* the restore is proven. A delete that had already
/// started finishes on its own thread, and the next DNS enable or restore waits for it (bounded)
/// before touching the snapshot. The abandoned registry
/// write keeps its own self-write window until that write returns, so the notification is not
/// published as a network change.
pub(super) async fn bounded_dns_call<T>(
    operation: &str,
    call: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    bounded_dns_call_within(DNS_RESTORE_TIMEOUT, operation, call).await
}

/// The budget is a parameter for the same reason `bounded_engine_call` takes one: the ownership
/// and refusal rules are what matter and they must stay unit-testable without waiting out the
/// production budget.
pub(super) async fn bounded_dns_call_within<T>(
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
pub(super) static TEST_INTERRUPT_RELEASE_FOLLOW_UP: AtomicBool = AtomicBool::new(false);

pub(super) async fn finish_release_follow_up(apply_narrow: bool) {
    #[cfg(test)]
    if TEST_INTERRUPT_RELEASE_FOLLOW_UP.swap(false, Ordering::SeqCst) {
        // Model process death at the durable boundary, before native selective work starts.
        return;
    }
    let held = crate::core::selective_layer::finish_release(apply_narrow).await;
    // Report last, after the release wrote its own outcome, so neither failure is overwritten.
    let unconfirmed_before = AI_HOLD_UNCONFIRMED_BEFORE_RELEASE.swap(false, Ordering::SeqCst);
    let mut notes = Vec::new();
    if apply_narrow && unconfirmed_before {
        notes.push("AI hold could not be confirmed before releasing general traffic");
    }
    if apply_narrow && !held {
        tracing::error!("selective fail-open: AI hold not confirmed after WFP release");
        notes.push("AI hold could not be confirmed after releasing general traffic");
    }
    let note = (!notes.is_empty()).then(|| notes.join("; "));
    if let Some(note) = &note {
        append_last_error(note);
    }
    *RELEASE_AI_HOLD_NOTE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = note;
}

fn append_last_error(note: &str) {
    let mut last_error = last_error_guard();
    *last_error = Some(match last_error.take() {
        Some(previous) => format!("{previous}; {note}"),
        None => note.to_owned(),
    });
}

/// The AI-hold failure of the latest release follow-up, for callers that rewrite `last_error`.
pub(super) fn release_ai_hold_note() -> Option<String> {
    RELEASE_AI_HOLD_NOTE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

pub(super) static AI_HOLD_UNCONFIRMED_BEFORE_RELEASE: AtomicBool = AtomicBool::new(false);
pub(super) static RELEASE_AI_HOLD_NOTE: Mutex<Option<String>> = Mutex::new(None);

/// Process-wide: once SCM Stop starts its countdown, every release consults it, including one
/// already running in another task that Stop is waiting behind.
pub(super) static RELEASE_DEADLINE: Mutex<Option<std::time::Instant>> = Mutex::new(None);

/// Time a release needs after the AI hold step: the bounded WFP removal (`WFP_CALL_TIMEOUT`,
/// 25 s) plus its bookkeeping.
const RELEASE_AFTER_HOLD_RESERVE: std::time::Duration = std::time::Duration::from_secs(30);

/// SCM Stop abandons the runtime at `deadline`. From now on the AI hold step never spends the
/// time WFP removal needs; the earliest deadline wins.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn note_release_deadline(deadline: std::time::Instant) {
    let mut current = RELEASE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    *current = Some(current.map_or(deadline, |current| current.min(deadline)));
}

/// Decision 031 (#1271): an automatic release installs the AI hold while WFP still blocks, so AI
/// traffic is never direct between filter removal and the hold landing. A hold that fails or
/// misses its budget never keeps the general block: the caller still removes WFP, and the
/// failure is logged and reported. The post-removal follow-up still runs at the durable boundary.
/// Once SCM Stop has noted its deadline, the wait leaves `RELEASE_AFTER_HOLD_RESERVE` for WFP
/// removal and is skipped when less remains, so the hold wait cannot outlast the runtime.
pub(super) async fn hold_ai_before_release(apply_narrow: bool) {
    if !apply_narrow {
        return;
    }
    let deadline = *RELEASE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let budget = deadline.map(|deadline| {
        deadline
            .saturating_duration_since(std::time::Instant::now())
            .saturating_sub(RELEASE_AFTER_HOLD_RESERVE)
    });
    let held = match budget {
        None => crate::core::selective_layer::finish_release(true).await,
        Some(budget) if budget.is_zero() => false,
        Some(budget) => {
            tokio::time::timeout(budget, crate::core::selective_layer::finish_release(true))
                .await
                .unwrap_or(false)
        }
    };
    AI_HOLD_UNCONFIRMED_BEFORE_RELEASE.store(!held, Ordering::SeqCst);
    if !held {
        tracing::error!(
            "selective fail-open: AI hold not confirmed before WFP release; releasing anyway"
        );
    }
}

/// Normal release — only on explicit user request. See the DNS-before-disarm invariant.
pub(super) async fn disarm_unlocked(apply_narrow: bool) -> Result<()> {
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
        hold_ai_before_release(apply_narrow == Some(true)).await;
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
        publish_reconnect_from(&tombstone);
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
    hold_ai_before_release(apply_narrow == Some(true)).await;
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
    publish_reconnect_from(&tombstone);
    Ok(())
}

/// Open the network after the core-proof window. DNS is best-effort: a restore that cannot
/// be proven must not keep the block, because Core is not coming back to answer loopback.
/// Filter removal failure leaves `ARMED` set so the next tick retries. A tombstone failure
/// after the filters are gone does not reinstall them.
pub(super) async fn release_unproven_wanted_session_unlocked() -> Result<()> {
    // Held until WFP removal commits: no update writer can start under this release (#1292).
    let update_fence = update_release_fence()?;
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
    hold_ai_before_release(true).await;
    remove_all_filters_holding(update_fence).await.context(
        "wanted-session core window could not remove WFP; the block stays until the next tick",
    )?;
    clear_wanted_core_window();
    // The reconnect is owed to the owner of the released session only (#1291).
    let released_owner = armed_guard()
        .take()
        .and_then(|armed| armed.intent.owner_key);
    TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
    publish_reconnect(true, released_owner.clone());
    // WFP is already gone. Recovery keeps only the narrow AI hold installed above;
    // its best-effort installation cannot refuse or undo the general release.
    let tombstone = crash_recovery_tombstone(released_owner);
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

pub(super) async fn retry_crash_tombstone_unlocked() {
    if !CRASH_TOMBSTONE_PENDING.load(Ordering::Acquire) {
        return;
    }
    if armed_guard().is_some() {
        CRASH_TOMBSTONE_PENDING.store(false, Ordering::Release);
        return;
    }
    let tombstone = crash_recovery_tombstone(reconnect_owner_guard().clone());
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
pub(super) async fn reconcile_wanted_core_window_unlocked() -> Result<WantedCoreWindow> {
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
    STARTUP_SETTLED.store(true, Ordering::Release);
    let _operation = WFP_OPERATION.lock().await;
    owe_update_held_startup_release_unlocked(update_holds_no_live_owner);
    reconcile_wanted_core_window_unlocked().await.map(|_| ())
}

/// Decision 031 for #1292: the unverified barrier restored at this Service start is held only
/// by pending update evidence once startup has settled. When `owed` says no live process still
/// owns that update, expire the core window: this call or the next watchdog tick then releases
/// general traffic with the AI hold, retrying each tick until WFP is gone. Each retry first asks
/// `owed` again and withdraws the expiry when a live owner appeared. Strict stays.
/// Caller holds `WFP_OPERATION`.
pub(super) fn owe_update_held_startup_release_unlocked(owed: impl FnOnce() -> bool) {
    if !STARTUP_UNVERIFIED_BARRIER.load(Ordering::Acquire)
        || !STARTUP_SETTLED.load(Ordering::Acquire)
    {
        return;
    }
    let held = armed_guard()
        .as_ref()
        .is_some_and(|armed| !armed.intent.strict_kill_switch && !armed.intent.is_verified());
    if !held {
        STARTUP_UNVERIFIED_BARRIER.store(false, Ordering::Release);
        return;
    }
    let mut deadline = WANTED_CORE_DEADLINE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if deadline.is_some() && !UPDATE_RELEASE_LATCHED.load(Ordering::Acquire) {
        return; // Another core window owns this deadline.
    }
    let owed = owed();
    UPDATE_RELEASE_LATCHED.store(owed, Ordering::Release);
    *deadline = owed.then(std::time::Instant::now);
}

/// For an update-held release, the store lock every update writer takes, after a final re-check
/// that the release is still owed. A busy store or a release no longer owed aborts this attempt;
/// the next watchdog tick asks again. Nothing in the release path opens the store itself.
fn update_release_fence() -> Result<Option<std::fs::File>> {
    if !UPDATE_RELEASE_LATCHED.load(Ordering::Acquire) {
        return Ok(None);
    }
    #[cfg(test)]
    if let Some(owed) = *TEST_UPDATE_FENCE_OWED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
    {
        anyhow::ensure!(owed, "the update-held barrier release is no longer owed");
        return Ok(None);
    }
    #[cfg(windows)]
    return crate::core::update::startup_release_fence();
    #[cfg(not(windows))]
    Ok(None)
}

#[cfg(test)]
pub(super) static TEST_UPDATE_FENCE_OWED: std::sync::Mutex<Option<bool>> = std::sync::Mutex::new(None);

pub(super) fn update_holds_no_live_owner() -> bool {
    #[cfg(windows)]
    return crate::core::update::startup_barrier_release_owed();
    #[cfg(not(windows))]
    false
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

/// Remove provider-scoped WFP and restore DNS. DNS failure does not keep the block.
/// The caller decides whether the on-disk intent bytes stay (corrupt evidence) or are
/// replaced by a disarmed tombstone (a live session the watchdog gave up on).
pub(super) async fn release_general_traffic_unlocked(reason: &str, replace_intent: bool) -> Result<()> {
    tracing::warn!("wfp: {reason}; releasing general traffic and restoring DNS");
    if let Err(error) = bounded_dns_call(reason, crate::core::dns::ensure_restored()).await {
        tracing::warn!("wfp: DNS restore during {reason} failed; still releasing WFP: {error:#}");
        *last_error_guard() = Some(format!("{error:#}"));
    } else {
        *last_error_guard() = None;
    }
    hold_ai_before_release(true).await;
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
    // other non-strict failure releases. Reapply it at the durable boundary.
    finish_release_follow_up(true).await;
    Ok(())
}

pub(super) async fn release_general_traffic_on_startup_unlocked(reason: &str) -> Result<()> {
    let result = release_general_traffic_unlocked(reason, false).await;
    if result.is_err() && armed_guard().is_none() {
        // No in-memory intent exists for the watchdog to reconcile after this startup failure.
        spawn_startup_release_retry();
    }
    result
}

pub(super) async fn release_unhealthy_session_unlocked(reason: &str) -> Result<()> {
    release_general_traffic_unlocked(reason, true).await
}
