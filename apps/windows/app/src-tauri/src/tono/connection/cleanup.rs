//! Generation retirement and late StartClash/DNS compensation live here together.
//! Do not split these owners: a stale arm and a timed-out generation must reconcile
//! through the same release-intent check.

use std::sync::Arc;

use tono_logging::{Type, logging};
use tono_service_protocol::{KillSwitchConfig, OwnerSessionProof, RuntimeBundle};

use crate::core::service;
use crate::tono::connection_health::{unique_adapter_dns_apply_failed, protected_dns_unhealthy};
use crate::tono::connection_plan::stale_exit_needs_release;
use crate::tono::state::TonoState;

use super::failure::StageFailure;

pub(super) async fn retire_timed_out_generation(state: &Arc<TonoState>, generation: u64) -> Option<u64> {
    let mut inner = state.lock().await;
    if inner.connect_generation != generation {
        return None;
    }
    // Freeze before cancelling the old generation: late mutation compensation may itself
    // restore DNS/release while the failure handler is still waiting on its status read.
    super::freeze_attempt_failure(&mut inner);
    // A first attempt may release a late unverified arm. A previously verified protected
    // reconnect keeps the barrier, matching the normal failure decision table.
    let release_late_commit = !inner.fsm.session_verified();
    // The abort-free variant: this handler frequently runs *inside* a registered connection
    // task (reconnect loop / monitor re-entry / switch), and aborting the registry here would
    // kill the caller before `fail_connect` + `schedule_reconnect` run, stranding Connecting.
    inner.retire_connection_generation(release_late_commit);
    // Only this retirement transfers failure cleanup to the newly issued generation. If an
    // explicit transition won first, the caller must return Stale rather than adopt its owner.
    Some(inner.connect_generation)
}

/// The generation guard used between the long I/O steps.
pub(super) async fn ensure_fresh(state: &Arc<TonoState>, generation: u64) -> Result<(), StageFailure> {
    if state.lock().await.connect_generation != generation {
        return Err(StageFailure::Stale);
    }
    Ok(())
}

/// Keep a mutating StartClash request alive if its reconnect/switch parent is aborted. Dropping a
/// direct IPC future can discard the response while the Service still commits; this detached child
/// always reaches the generation check and patches a late arm for releasing transitions.
pub(super) async fn start_core_cancellation_safe(
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
pub(super) async fn enable_dns_cancellation_safe(
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
        let status = service::tono_enable_protected_dns_for_session(&service_session)
            .await
            .map_err(StageFailure::error)?;
        {
            let mut inner = task_state.lock().await;
            if inner.connect_generation == generation {
                inner.attempt_evidence.dns(generation, crate::tono::commands::epoch_millis(), &status);
            }
        }
        if unique_adapter_dns_apply_failed(&status) || protected_dns_unhealthy(Some(&status)) {
            return Err(StageFailure::error(
                status
                    .last_error
                    .unwrap_or_else(|| "TONO_DNS_UNVERIFIED: active adapter DNS protection is not proven".into()),
            ));
        }
        if task_state.lock().await.connect_generation != generation {
            return Err(stale_after_dns(&task_state, generation).await);
        }
        Ok(())
    });
    task.await
        .map_err(|error| StageFailure::error(format!("DNS reconciliation task failed: {error}")))?
}

/// Cross the possible durable-commit boundary conservatively. No green state is
/// published here. A cancelled/lost reply must not schedule FullRelease while the
/// Service may be committing; explicit Disconnect still owns release normally.
pub(super) async fn commit_protection_cancellation_safe(
    state: &Arc<TonoState>, generation: u64, session: OwnerSessionProof,
    expected: tono_service_protocol::ProtectionCommitRequest,
) -> Result<tono_service_protocol::ProtectionProof, StageFailure> {
    let mutation_guard = state.begin_connect_mutation().await;
    let cancellation = {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation { return Err(StageFailure::Stale); }
        // Called only after native DNS + system fake-ip and the lock operation.
        // Commitment is conservative before dispatch; Connected still requires the receipt.
        inner.fsm.mark_protection_committed();
        inner.connect_cancellation.clone()
    };
    let task_state = Arc::clone(state);
    let task = tokio::spawn(async move {
        let _mutation_guard = mutation_guard;
        let proof = service::tono_verify_and_commit_protection(&session, expected.core_pid, expected.core_generation, &cancellation)
            .await.map_err(StageFailure::error)?;
        if task_state.lock().await.connect_generation != generation { return Err(StageFailure::Stale); }
        Ok(proof)
    });
    task.await.map_err(|error| StageFailure::error(format!("protection commit task failed: {error}")))?
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
pub(super) async fn stale_after_arm(state: &Arc<TonoState>, generation: u64) -> StageFailure {
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
pub(super) async fn stale_after_dns(state: &Arc<TonoState>, generation: u64) -> StageFailure {
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
