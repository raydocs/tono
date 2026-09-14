use super::*;
use crate::core::runstate::{OwnerRecoveryReason, RunStateEnv, RunStateStore, ServiceHealth};


#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct OwnerRecoveryPolicy {
    pub(super) reset_system_proxy: bool,
}

pub(super) const fn owner_recovery_policy(_reason: OwnerRecoveryReason, is_macos: bool) -> OwnerRecoveryPolicy {
    OwnerRecoveryPolicy {
        reset_system_proxy: !is_macos,
    }
}

pub(super) fn mark_service_unavailable_after_owner_loss<E: RunStateEnv>(store: &RunStateStore<E>, reason: OwnerRecoveryReason) {
    if matches!(reason, OwnerRecoveryReason::TransportFailure) {
        store.observe(ServiceHealth::Unavailable(
            "service control IPC unavailable after sustained transport failure".to_owned(),
        ));
    }
}

/// How often the owner monitor samples Service status.
pub(super) const OWNER_MONITOR_INTERVAL: Duration = Duration::from_secs(2);
/// Mirrors `OwnerWatch`'s tolerance, for the log line only.
pub(super) const SUSTAINED_OWNER_SAMPLES: u8 = 3;

pub(super) fn start_owner_monitor() {
    let generation = OWNER_MONITOR_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    AsyncHandler::spawn(move || async move {
        let mut watch = OwnerWatch::new();
        loop {
            tokio::time::sleep(OWNER_MONITOR_INTERVAL).await;
            if OWNER_MONITOR_GENERATION.load(Ordering::Acquire) != generation {
                break;
            }
            if !matches!(*CoreManager::global().get_running_mode(), RunningMode::Service) {
                break;
            }

            let sample = read_owner_sample().await;
            let mut step = watch.observe(sample);
            if matches!(step, OwnerStep::VerifyTransport) {
                if watch.just_became_sustained() {
                    logging!(
                        warn,
                        Type::Service,
                        "service owner status unavailable for {SUSTAINED_OWNER_SAMPLES} samples; \
                         preserving local proxy state while the core endpoint still answers"
                    );
                }
                let owner_endpoint_available = Handle::mihomo().get_version().await.is_ok();
                step = watch.resolve_transport(owner_endpoint_available);
            }

            if let OwnerStep::Recover(reason) = step {
                recover_after_owner_loss(generation, reason).await;
                break;
            }
        }
    });
}

/// Ask the Service who owns it, flattening every unusable answer into one sample.
///
/// A transport error, an error code and an empty payload are the same thing to the watch:
/// we did not learn anything. Only the log line distinguishes them.
pub(super) async fn read_owner_sample() -> OwnerSample {
    let response = match current_owner_credentials() {
        Ok(credentials) => tono_service_protocol::get_status(&credentials).await,
        Err(error) => Err(error),
    };

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            logging!(debug, Type::Service, "service owner status was unreadable: {error:#}");
            return OwnerSample::Unreadable;
        }
    };

    if response.code == tono_service_protocol::ServiceErrorCode::NotActive as u16 {
        return OwnerSample::NotActive;
    }
    if response.code != 0 {
        logging!(
            debug,
            Type::Service,
            "service owner status returned error {}: {}",
            response.code,
            response.message
        );
        return OwnerSample::Unreadable;
    }
    let Some(status) = response.data else {
        logging!(debug, Type::Service, "service owner status omitted data");
        return OwnerSample::Unreadable;
    };

    // A session that no longer matches is another owner's, whatever the flags say.
    if !session_matches_active_status(status.is_active, status.active_generation) {
        return OwnerSample::NotActive;
    }

    OwnerSample::Status {
        is_active: status.is_active,
        desired_core_should_be_running: status.desired_core_should_be_running,
        desired_state_unknown: status.desired_state_unknown,
        service_state: status.service_state,
        core_pid: status.core_pid,
    }
}

pub(super) fn session_matches_active_status(is_active: bool, active_generation: Option<u64>) -> bool {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .is_some_and(|session| session_matches_status(&session.proof, is_active, active_generation))
}

pub(super) fn cancel_owner_monitors() {
    OWNER_MONITOR_GENERATION.fetch_add(1, Ordering::AcqRel);
}

#[allow(dead_code)]
pub(crate) fn owner_monitor_generation() -> u64 {
    OWNER_MONITOR_GENERATION.load(Ordering::Acquire)
}

pub(super) async fn recover_after_owner_loss(generation: u64, reason: OwnerRecoveryReason) {
    let manager = CoreManager::global();
    if !matches!(*manager.get_running_mode(), RunningMode::Service) {
        return;
    }
    let Some(recovery_generation) = claim_owner_recovery_generation(&OWNER_MONITOR_GENERATION, generation) else {
        return;
    };
    manager.invalidate_core_readiness();
    let _lifecycle = manager.lifecycle_lock.lock().await;
    if OWNER_MONITOR_GENERATION.load(Ordering::Acquire) != recovery_generation
        || !matches!(*manager.get_running_mode(), RunningMode::Service)
    {
        return;
    }
    recover_after_owner_loss_while_locked(reason).await;
}

pub(super) fn claim_owner_recovery_generation(generation: &AtomicU64, captured_generation: u64) -> Option<u64> {
    let recovery_generation = captured_generation.wrapping_add(1);
    generation
        .compare_exchange(
            captured_generation,
            recovery_generation,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .ok()
        .map(|_| recovery_generation)
}

pub(super) async fn recover_after_owner_loss_while_locked(reason: OwnerRecoveryReason) {
    logging!(
        warn,
        Type::Service,
        "service owner recovery ({reason:?}); clearing local proxy and PAC state"
    );
    mark_service_unavailable_after_owner_loss(&RUN_STATE, reason);
    proxy_control::stop_guard().await;
    clear_active_service_session();
    CoreManager::global().core_stopped();

    if !owner_recovery_policy(reason, cfg!(target_os = "macos")).reset_system_proxy {
        return;
    }

    let mut last_error = None;
    for _ in 0..3 {
        match proxy_control::clear().await {
            Ok(()) => return,
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
    if let Some(error) = last_error {
        logging!(
            error,
            Type::Service,
            "failed to clear local proxy after owner loss: {error}"
        );
    }
}

/// Wait for a freshly installed or repaired Service to answer.
///
/// Silence for the whole budget *is* an observation here — the Service had its window and
/// never spoke — unlike a single failed probe. A readable but rejected reply already recorded
/// its own verdict, which must not be flattened into "unavailable".
pub(super) async fn wait_for_service_ipc() -> Result<()> {
    const CONTEXT: &str = "service IPC did not become available";
    let config = ServiceManager::config();

    match RUN_STATE.await_ready(config.max_retries, config.retry_delay).await {
        Ok(_) => Ok(()),
        Err(ReadyWaitError::Unreachable(error)) => {
            RUN_STATE.observe(ServiceHealth::Unavailable(format!("{CONTEXT}: {error:#}")));
            Err(error).context(CONTEXT)
        }
        Err(ReadyWaitError::Rejected(error)) => Err(error).context(CONTEXT),
    }
}
