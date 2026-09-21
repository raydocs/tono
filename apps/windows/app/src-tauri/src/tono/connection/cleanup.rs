//! Generation retirement and late StartClash/DNS compensation live here together.
//! Do not split these owners: a stale arm and a timed-out generation must reconcile
//! through the same release-intent check.

use std::sync::Arc;

use tono_logging::{Type, logging};
use tono_service_protocol::{KillSwitchConfig, OwnerSessionProof, RuntimeBundle};

use crate::core::service;
use crate::tono::connection_plan::stale_exit_needs_release;
use crate::tono::state::TonoState;

use super::failure::StageFailure;

/// Own the asynchronous failure tail independently of its original connect/reconnect caller.
/// The status future and continuation are injectable so ownership can be tested without Service IPC.
pub(super) async fn reconcile_failure<S, F, C>(
    state: Arc<TonoState>,
    generation: u64,
    status: S,
    cleanup: C,
) -> Result<bool, tokio::task::JoinError>
where
    S: std::future::Future<Output = Option<tono_service_protocol::KillSwitchStatus>> + Send + 'static,
    F: std::future::Future<Output = bool> + Send + 'static,
    C: FnOnce(Option<tono_service_protocol::KillSwitchStatus>, tokio::sync::OwnedRwLockWriteGuard<()>) -> F
        + Send + 'static,
{
    tokio::spawn(async move {
        let guard = state.begin_privileged_release().await;
        if state.lock().await.connect_generation != generation {
            return false;
        }
        let observed = status.await;
        // Disconnect may retire the attempt while status is awaiting IPC. It cannot release or
        // admit a replacement through our writer, but its intent still supersedes this failure.
        if state.lock().await.connect_generation != generation {
            return false;
        }
        cleanup(observed, guard).await
    }).await
}

pub(super) async fn retire_timed_out_generation(state: &Arc<TonoState>, generation: u64) -> Option<u64> {
    let mut inner = state.lock().await;
    if inner.connect_generation != generation {
        return None;
    }
    // A first attempt may release a late unverified arm. A previously verified protected
    // reconnect keeps the barrier, matching the normal failure decision table.
    let release_late_commit = !inner.fsm.session_verified();
    // The abort-free variant: this handler frequently runs *inside* a registered connection
    // task (reconnect loop / monitor re-entry / switch), and aborting the registry here would
    // kill the caller before `fail_connect` + `schedule_reconnect` run, stranding Connecting.
    inner.retire_connection_generation(release_late_commit);
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;
    use tokio::time::{Duration, timeout};

    #[tokio::test]
    async fn idle_retry_admission_retires_failure_tails_before_they_publish() {
        let state = Arc::new(TonoState::for_test());
        let mut inner = state.lock().await;
        let (first, first_token) = super::super::begin_attempt(&mut inner, 0).unwrap();
        assert_eq!(first, 1);
        inner.fsm.connect_failed();
        let (second, second_token) = super::super::begin_attempt(&mut inner, first).unwrap();
        assert_eq!(second, 2, "an idle retry must not reuse the failed attempt's epoch");
        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());
        assert!(super::super::begin_attempt(&mut inner, first).is_none());
        inner.next_retry_at_ms = Some(12345);
        drop(inner);
        super::super::reconnect::publish_next_retry(&state, first, None).await;
        let inner = state.lock().await;
        assert_eq!(inner.next_retry_at_ms, Some(12345), "a stale tail cannot clear B's deadline");
        assert!(inner.fsm.status().is_connecting);
    }

    #[tokio::test]
    async fn timeout_returns_only_its_own_successor_and_external_retirement_is_stale() {
        use super::super::{Attempt, attempt_from_stage_failure};
        let state = Arc::new(TonoState::for_test());
        let (record, cancelled) = {
            let mut inner = state.lock().await;
            inner.connect_generation = 41;
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.tasks.reconnect = Some(tauri::async_runtime::spawn(std::future::pending()));
            (inner.attempt_history.begin(1, "exit-A".into(), "vless", 3), inner.connect_cancellation.clone())
        };
        let own = attempt_from_stage_failure(&state, 41, &record, StageFailure::TimedOut("deadline".into())).await;
        assert!(cancelled.is_cancelled());
        {
            let mut inner = state.lock().await;
            assert_eq!(inner.connect_generation, 42);
            assert!(inner.release_intent_for(41));
            assert!(!inner.tasks.reconnect.as_ref().unwrap().inner().is_finished(),
                "self-timeout must not abort its registered failure consumer");
            inner.invalidate_connection(true);
            inner.fsm.sign_out_or_quit();
            inner.controller_secret = Some("new-owner".into());
        }
        // Inspect the returned outcome AFTER an unrelated retirement: it must still contain 42,
        // not whatever generation the failure consumer happens to observe later.
        assert!(matches!(own, Attempt::Failed { generation: 42, error } if error == "deadline"));
        let external = attempt_from_stage_failure(&state, 42, &record, StageFailure::TimedOut("late".into())).await;
        assert!(matches!(external, Attempt::Stale));
        let inner = state.lock().await;
        assert_eq!(inner.connect_generation, 43);
        assert_eq!(inner.controller_secret.as_deref(), Some("new-owner"));
        assert!(inner.connect_error.is_none());
        assert!(inner.next_retry_at_ms.is_none());
    }

    #[tokio::test]
    async fn failure_ownership_spans_status_cleanup_and_caller_abort() {
        let state = Arc::new(TonoState::for_test());
        let generation = state.lock().await.connect_generation;
        let (status_entered, at_status) = oneshot::channel();
        let (resume_status, status_resumed) = oneshot::channel();
        let (cleanup_entered, at_cleanup) = oneshot::channel();
        let (resume_cleanup, cleanup_resumed) = oneshot::channel();
        let (finished, finish) = oneshot::channel();
        let caller = tokio::spawn(reconcile_failure(
            Arc::clone(&state), generation,
            async move {
                status_entered.send(()).unwrap();
                status_resumed.await.unwrap();
                None
            },
            move |_, guard| async move {
                cleanup_entered.send(()).unwrap();
                cleanup_resumed.await.unwrap();
                drop(guard);
                finished.send(()).unwrap();
                true
            },
        ));
        timeout(Duration::from_secs(5), at_status).await.unwrap().unwrap();
        let replacement = state.begin_connect_mutation();
        tokio::pin!(replacement);
        assert!(futures::poll!(&mut replacement).is_pending(),
            "replacement admission must not overtake failure's status wait");
        let disconnect = state.begin_privileged_release();
        tokio::pin!(disconnect);
        assert!(futures::poll!(&mut disconnect).is_pending(),
            "Disconnect must join ownership, not release beneath failure status");
        resume_status.send(()).unwrap();
        timeout(Duration::from_secs(5), at_cleanup).await.unwrap().unwrap();
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        assert!(futures::poll!(&mut replacement).is_pending(),
            "post-status/pre-stop ownership must survive the parent abort");
        assert!(futures::poll!(&mut disconnect).is_pending());
        resume_cleanup.send(()).unwrap();
        timeout(Duration::from_secs(5), finish).await.unwrap().unwrap();
        drop(timeout(Duration::from_secs(5), replacement).await.unwrap());
        drop(timeout(Duration::from_secs(5), disconnect).await.unwrap());

        // Disconnect can retire A during status, but cannot complete privileged release before
        // A relinquishes ownership. The resumed status must never enter its failure continuation.
        let (entered, at_status) = oneshot::channel();
        let (resume, resumed) = oneshot::channel();
        let retired = tokio::spawn(reconcile_failure(Arc::clone(&state), generation,
            async move {
                entered.send(()).unwrap();
                resumed.await.unwrap();
                None
            },
            |_, _| async { panic!("status returned for a retired attempt") },
        ));
        timeout(Duration::from_secs(5), at_status).await.unwrap().unwrap();
        state.lock().await.invalidate_connection(true);
        let disconnect = state.begin_privileged_release();
        tokio::pin!(disconnect);
        assert!(futures::poll!(&mut disconnect).is_pending());
        resume.send(()).unwrap();
        assert!(!timeout(Duration::from_secs(5), retired).await.unwrap().unwrap().unwrap());
        drop(timeout(Duration::from_secs(5), disconnect).await.unwrap());

        // A completion already retired by Disconnect must not adopt successful B.
        {
            let mut inner = state.lock().await;
            let current = inner.connect_generation;
            super::super::begin_attempt(&mut inner, current).unwrap();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            inner.controller_secret = Some("session-B".into());
            inner.controller_port = Some(19091);
        }
        let stale_state = Arc::clone(&state);
        let applied = reconcile_failure(Arc::clone(&state), generation, async { None },
            move |_, _guard| async move {
                let mut inner = stale_state.lock().await;
                inner.fsm.connect_failed();
                inner.controller_secret = None;
                inner.connect_error = Some("late A".into());
                inner.next_retry_at_ms = Some(1);
                true
            }).await.unwrap();
        assert!(!applied, "retired failure must never execute its continuation");
        let inner = state.lock().await;
        assert!(inner.fsm.status().is_connected);
        assert!(inner.fsm.kill_switch_armed());
        assert!(inner.fsm.session_verified());
        assert_eq!(inner.controller_secret.as_deref(), Some("session-B"));
        assert_eq!(inner.controller_port, Some(19091));
        assert!(inner.connect_error.is_none());
        assert!(inner.next_retry_at_ms.is_none());
    }
}
