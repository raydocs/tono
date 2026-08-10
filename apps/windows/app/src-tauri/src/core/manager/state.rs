use super::CoreManager;
use crate::{core::service, logging};
use anyhow::Result;
use clash_verge_logging::Type;
use scopeguard::defer;

impl CoreManager {
    pub(super) async fn stop_core_by_service(&self, release_kill_switch: bool) -> Result<()> {
        logging!(info, Type::Core, "Stopping service");
        service::stop_core_by_service(release_kill_switch).await?;
        self.core_stopped();
        Ok(())
    }

    /// Terminates the sidecar after its caller has successfully cleared the
    /// system proxy.
    pub(super) fn stop_core_by_sidecar_unprepared(&self) {
        logging!(info, Type::Core, "Stopping sidecar");
        defer! {
            self.core_stopped();
        }
        if let Some(child) = self.take_child_sidecar() {
            let pid = child.pid();

            #[cfg(target_os = "windows")]
            {
                // Setting the job handle to None clears the stored handle and
                // closes the previous Windows job handle in `set_job_handle`.
                self.set_job_handle(None);
                logging!(
                    trace,
                    Type::Core,
                    "Closed job handle for sidecar process (PID: {})",
                    pid
                );
            }

            let result = child.kill();
            logging!(
                trace,
                Type::Core,
                "Sidecar stopped (PID: {:?}, Result: {:?})",
                pid,
                result
            );
        }
    }
}

#[cfg(test)]
mod readiness_tests {
    use crate::core::manager::{CoreManager, RunningMode, claim_core_readiness_generation};
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn core_readiness_generation_can_only_be_claimed_once() {
        let generation = AtomicU64::new(7);

        assert!(claim_core_readiness_generation(&generation, 7));
        assert_eq!(generation.load(Ordering::Acquire), 8);
        assert!(!claim_core_readiness_generation(&generation, 7));
    }

    #[test]
    fn invalidated_core_readiness_cannot_be_recaptured_from_stale_mode() {
        let manager = CoreManager::isolated();
        manager.mark_core_ready();
        manager.core_started(RunningMode::Service);

        manager.invalidate_core_readiness();

        assert_eq!(*manager.get_running_mode(), RunningMode::Service);
        assert_eq!(manager.current_core_readiness_generation(), None);
    }
}
