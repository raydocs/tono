//! Bounded WFP engine calls: install, verify, remove, outcome recording.

use super::*;

/// Budget for one WFP call. A healthy transaction is milliseconds and the surrounding IPC
/// handler budget is `IPC_HANDLER_TIMEOUT` = 60 s, so 25 s is three orders of magnitude beyond
/// "slow but alive" while still leaving the handler more than half its budget to answer the
/// client. Because the first expiry latches the in-flight claim (see below), every later call
/// in the same handler fails immediately — one handler can therefore stall for at most one
/// budget, no matter how many engine calls its path makes.
#[cfg(all(windows, not(feature = "test")))]
pub(super) const WFP_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);
/// Anything slower than this is already pathological: report it even for the once-a-second
/// verify, so the log carries evidence of a degrading BFE before it wedges completely.
#[cfg(any(all(windows, not(feature = "test")), test))]
pub(super) const WFP_SLOW_CALL: std::time::Duration = std::time::Duration::from_secs(2);
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
pub(super) struct EngineCallInFlight {
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
pub(super) fn engine_call_in_flight() -> Option<EngineCallInFlight> {
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
pub(super) async fn bounded_engine_call<T: Send + 'static>(
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
pub(super) async fn engine_call<T: Send + 'static>(
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

pub(super) async fn install_unlocked(armed: &Armed) -> Result<()> {
    install_unlocked_for(armed, current_core_instance().await).await
}

/// [`install_unlocked`] for a caller that has already read the core identity and must render
/// from *that* read — see [`rule_config_rendering`]. `lock` is the only such caller, and it is
/// the one where a second, disagreeing read is terminal.
pub(super) async fn install_unlocked_for(armed: &Armed, current_core: Option<CoreInstance>) -> Result<()> {
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

pub(super) async fn verify_live_unlocked_for(armed: &Armed, current_core: Option<CoreInstance>) -> Result<()> {
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

pub(super) async fn remove_all_filters_unlocked() -> Result<()> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        engine_call("remove all filters", crate::core::wfp::remove_all_filters).await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        #[cfg(test)]
        {
            TEST_REMOVE_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
            TEST_HOLD_AT_LAST_REMOVAL.store(
                crate::core::selective_layer::test_hold_active(),
                Ordering::SeqCst,
            );
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

/// [`remove_all_filters_unlocked`] with the update release fence moved into the engine call: the
/// store lock is released only when the blocking removal itself returns (commit or abort), not
/// when the bounded wait for it gives up (#1292).
pub(super) async fn remove_all_filters_holding(fence: Option<std::fs::File>) -> Result<()> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        engine_call("remove all filters", move || {
            let _fence = fence;
            crate::core::wfp::remove_all_filters()
        })
        .await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let removed = remove_all_filters_unlocked().await;
        drop(fence);
        removed
    }
}

/// Upgrade/migration sweep: remove sublayers left by older builds (filters included). Must
/// run strictly *after* the current expected set is committed (or all filters were removed
/// on purpose): an older build's PERSISTENT block-all pair may be the only protection at
/// boot after an upgrade reboot, and deleting it before the replacement floor is live would
/// open a zero-filter window. Best-effort — a failed sweep leaves extra blocking, never less.
pub(super) async fn sweep_legacy_sublayers_unlocked() {
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

pub(super) fn record_outcome(result: Result<()>) -> Result<()> {
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
pub(super) fn record_startup_reconciliation(persist: Result<()>, install: Result<()>) -> Result<()> {
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
