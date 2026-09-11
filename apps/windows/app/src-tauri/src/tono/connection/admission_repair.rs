//! Narrow first-admission DNS propagation repair. No Core start/stop, WFP release or selector change.

use std::sync::Arc;
use tono_service_protocol::{KillSwitchStatusMode, OwnerSessionProof, ProtectionCommitRequest, ServiceStatusSnapshot};

use super::{
    cleanup::{enable_dns_cancellation_safe, ensure_fresh},
    failure::StageFailure,
    probes::capture_admission_core,
    transaction::ConnectTransaction,
};
use crate::{
    core::service,
    tono::{commands, state::TonoState},
};

fn require_same_protected_core(
    snapshot: &ServiceStatusSnapshot,
    session: &OwnerSessionProof,
    expected: &ProtectionCommitRequest,
) -> Result<bool, StageFailure> {
    if snapshot
        .active_generation
        .is_some_and(|value| value != session.generation)
        || snapshot.core_pid.is_some_and(|value| value != expected.core_pid)
        || snapshot.core_generation != expected.core_generation
    {
        return Err(StageFailure::error("Core identity changed before admission DNS repair"));
    }
    // Missing/unsettled read-only evidence is not permission to mutate, nor a new veto on the
    // remaining original fake-ip queries. A positively different identity must never be adopted.
    if capture_admission_core(snapshot, session).ok().as_ref() != Some(expected) {
        return Ok(false);
    }
    // A cached Locked screen is only permission to attempt local repair, never green proof.
    // The original fake-ip + fresh Service commit still follow this operation.
    // An optional refresh must not create a new failure gate from a busy/stale cache. Skip
    // mutation in that case; remaining original DNS reads and the final fresh WFP proof decide.
    Ok(super::direct::prove_service_reload_mode(snapshot, session, KillSwitchStatusMode::Locked).is_ok())
}

pub(super) async fn refresh_dns_once(
    state: &Arc<TonoState>,
    generation: u64,
    session: &OwnerSessionProof,
    expected: &ProtectionCommitRequest,
    routing: Option<&tono_core::CatalogRouting>,
    transaction: &ConnectTransaction,
) -> Result<(), StageFailure> {
    transaction.check("admission DNS repair")?;
    ensure_fresh(state, generation).await?;
    if !state.try_begin_recovery() {
        // Someone already owns local repair. Do not add a new failure or a second mutation.
        return Ok(());
    }
    let state = Arc::clone(state);
    let session = session.clone();
    let expected = expected.clone();
    let routing = routing.cloned();
    let transaction = transaction.clone(); // Never reset the original deadline/cancellation.
    let task = tokio::spawn(async move {
        struct RecoveryGuard(Arc<TonoState>);
        impl Drop for RecoveryGuard {
            fn drop(&mut self) {
                self.0.end_recovery();
            }
        }
        // Keep single-flight until the mutation's cancellation-safe child has actually settled.
        let _recovery = RecoveryGuard(Arc::clone(&state));
        transaction.check("admission DNS repair")?;
        let snapshot = match transaction
            .wait(
                "admission repair Core identity",
                service::tono_service_status_snapshot(),
            )
            .await?
        {
            Ok(snapshot) => snapshot,
            Err(_) => {
                // Read failure is no authority to mutate; keep the original remaining queries.
                ensure_fresh(&state, generation).await?;
                return Ok(());
            }
        };
        {
            let mut inner = state.lock().await;
            if inner.connect_generation != generation {
                return Err(StageFailure::Stale);
            }
            inner
                .attempt_evidence
                .service(generation, commands::epoch_millis(), &snapshot);
            if !super::same_residential_route(inner.routing.as_ref(), routing.as_ref()) {
                return Err(StageFailure::error("home routing changed before admission DNS repair"));
            }
        }
        if !require_same_protected_core(&snapshot, &session, &expected)? {
            return Ok(());
        }
        // This helper holds the existing mutation guard through late native completion. Do not
        // cancel its JoinHandle via a nested transaction timeout: the outer caller can stop
        // waiting, while this task keeps the recovery claim until reconciliation completes.
        transaction.check("admission native DNS refresh")?;
        let started = std::time::Instant::now();
        let refreshed = enable_dns_cancellation_safe(&state, generation, session).await;
        state.audit().log(crate::tono::audit::AuditEvent::LocalStep {
            generation,
            step: "admission native DNS refresh",
            elapsed_ms: started.elapsed().as_millis() as u64,
            outcome: match &refreshed {
                Ok(()) => "completed",
                Err(StageFailure::Stale) => "cancelled",
                Err(_) => "failed",
            },
        });
        refreshed?;
        transaction.check("admission native DNS refresh")?;
        ensure_fresh(&state, generation).await
    });
    task.await
        .map_err(|_| StageFailure::error("admission DNS repair task failed"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> ServiceStatusSnapshot {
        ServiceStatusSnapshot {
            is_active: true,
            active_generation: Some(4),
            core_pid: Some(42),
            core_generation: 9,
            service_state: tono_service_protocol::ServiceLifecycleState::Running,
            desired_core_should_be_running: true,
            desired_state_unknown: false,
            kill_switch: Some(tono_service_protocol::KillSwitchStatus {
                wanted: true,
                live: true,
                tunnel_permit_rendered: true,
                mode: KillSwitchStatusMode::Locked,
                verified: false,
                endpoints: Vec::new(),
                direct_endpoint_digest: String::new(),
                last_error: None,
            }),
            snapshot_generation: 0,
            active_operation: None,
            core_started_at: None,
            last_core_exit_reason: None,
            restart_count: 0,
            last_recovery_at: None,
            desired_generation: 1,
            desired_updated_at: 0,
            macos_kill_switch_wanted: false,
            macos_kill_switch_live: false,
            macos_kill_switch_mode: Default::default(),
            network_events: Default::default(),
        }
    }

    #[test]
    fn only_same_owner_core_and_locked_permit_may_repair_initial_dns() {
        let session = OwnerSessionProof {
            generation: 4,
            token: "test-session".into(),
        };
        let expected = ProtectionCommitRequest {
            core_pid: 42,
            core_generation: 9,
        };
        assert!(require_same_protected_core(&snapshot(), &session, &expected).unwrap());
        for mutate in [
            |s: &mut ServiceStatusSnapshot| s.core_generation += 1,
            |s: &mut ServiceStatusSnapshot| s.core_pid = Some(43),
            |s: &mut ServiceStatusSnapshot| s.active_generation = Some(5),
        ] {
            let mut changed = snapshot();
            mutate(&mut changed);
            assert!(require_same_protected_core(&changed, &session, &expected).is_err());
        }
    }

    #[test]
    fn uncertain_optional_observation_skips_mutation_not_remaining_dns_queries() {
        let session = OwnerSessionProof {
            generation: 4,
            token: "test-session".into(),
        };
        let expected = ProtectionCommitRequest {
            core_pid: 42,
            core_generation: 9,
        };
        for mutate in [
            |s: &mut ServiceStatusSnapshot| s.core_pid = None,
            |s: &mut ServiceStatusSnapshot| s.active_generation = None,
            |s: &mut ServiceStatusSnapshot| s.desired_state_unknown = true,
            |s: &mut ServiceStatusSnapshot| s.kill_switch = None,
            |s: &mut ServiceStatusSnapshot| s.kill_switch.as_mut().unwrap().live = false,
            |s: &mut ServiceStatusSnapshot| s.kill_switch.as_mut().unwrap().tunnel_permit_rendered = false,
        ] {
            let mut changed = snapshot();
            mutate(&mut changed);
            assert!(!require_same_protected_core(&changed, &session, &expected).unwrap());
        }
    }

    #[test]
    fn repair_is_detached_same_deadline_and_never_restarts_or_releases() {
        let source = include_str!("admission_repair.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap();
        assert!(source.contains("transaction.clone()"));
        assert!(!source.contains("ConnectTransaction::new"));
        assert!(source.contains("tokio::spawn(async move"));
        assert!(source.contains("let _recovery = RecoveryGuard"));
        assert!(source.contains("enable_dns_cancellation_safe(&state, generation, session).await"));
        for forbidden in [
            "tono_stop_core(",
            "tono_start_core",
            "tono_release_kill_switch(",
            "rebuild_owned_runtime",
            "timeout(",
            "timeout_at(",
        ] {
            assert!(!source.contains(forbidden), "{forbidden}");
        }
    }
}
