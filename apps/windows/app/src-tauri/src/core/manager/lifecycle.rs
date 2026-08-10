use super::{CoreManager, RunningMode};
use crate::core::manager::CLASH_LOGGER;
use crate::core::proxy_control;
use anyhow::Result;

async fn run_controlled_stop_transition<StopGuard, StopGuardFuture, Clear, ClearFuture, Stop, StopFuture>(
    is_macos: bool,
    running_mode: RunningMode,
    stop_guard: StopGuard,
    clear_proxy: Clear,
    stop_core: Stop,
) -> Result<()>
where
    StopGuard: FnOnce() -> StopGuardFuture,
    StopGuardFuture: std::future::Future<Output = ()>,
    Clear: FnOnce() -> ClearFuture,
    ClearFuture: std::future::Future<Output = Result<()>>,
    Stop: FnOnce() -> StopFuture,
    StopFuture: std::future::Future<Output = Result<()>>,
{
    match running_mode {
        RunningMode::NotRunning => {}
        RunningMode::Service if is_macos => stop_guard().await,
        RunningMode::Service | RunningMode::Sidecar => clear_proxy().await?,
    }
    stop_core().await
}

impl CoreManager {
    pub(crate) async fn apply_proxy_after_start(&self) -> Result<()> {
        // Tono: the app never writes the system proxy (P0-9) — the tunnel is
        // the only traffic path, so "apply after start" is a no-op.
        Ok(())
    }

    pub async fn stop_core(&self) -> Result<()> {
        let _life = self.lifecycle_lock.lock().await;
        self.controlled_stop_core_inner().await
    }

    /// 调用者须已持有 `lifecycle_lock`。
    async fn controlled_stop_core_inner(&self) -> Result<()> {
        let running_mode = *self.get_running_mode();
        run_controlled_stop_transition(
            cfg!(target_os = "macos"),
            running_mode,
            proxy_control::stop_guard,
            proxy_control::clear,
            || self.stop_core_unprepared_inner(true),
        )
        .await
    }

    /// 调用者须已持有 `lifecycle_lock`,且已完成受控代理清理。
    async fn stop_core_unprepared_inner(&self, release_kill_switch: bool) -> Result<()> {
        CLASH_LOGGER.clear_logs().await;
        match *self.get_running_mode() {
            RunningMode::Service => self.stop_core_by_service(release_kill_switch).await,
            RunningMode::Sidecar => {
                self.stop_core_by_sidecar_unprepared();
                Ok(())
            }
            RunningMode::NotRunning => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::run_controlled_stop_transition;
    use crate::core::manager::RunningMode;
    use parking_lot::Mutex;
    use std::{
        future,
        sync::{
            Arc,
            atomic::{AtomicBool, AtomicU64, Ordering},
        },
        task::Poll,
    };
    use tokio::sync::{Barrier, Mutex as AsyncMutex};

    struct FakeGuardCoordinator {
        generation: AtomicU64,
        operation_lock: AsyncMutex<()>,
    }

    impl FakeGuardCoordinator {
        const fn new() -> Self {
            Self {
                generation: AtomicU64::new(1),
                operation_lock: AsyncMutex::const_new(()),
            }
        }

        async fn run_guard_request(&self, captured_generation: u64, calls: &Mutex<Vec<&'static str>>) -> bool {
            let _operation = self.operation_lock.lock().await;
            if self.generation.load(Ordering::Acquire) != captured_generation {
                return false;
            }
            calls.lock().push("guard-reapply");
            true
        }

        async fn stop_guard(&self, calls: &Mutex<Vec<&'static str>>) {
            self.generation.fetch_add(1, Ordering::AcqRel);
            let _operation = self.operation_lock.lock().await;
            calls.lock().push("guard-stopped");
        }
    }

    fn transition_step(
        calls: &Arc<Mutex<Vec<&'static str>>>,
        step: &'static str,
        fail_at: Option<&'static str>,
    ) -> future::Ready<anyhow::Result<()>> {
        calls.lock().push(step);
        future::ready(if fail_at == Some(step) {
            Err(anyhow::anyhow!("{step} failed"))
        } else {
            Ok(())
        })
    }

    #[tokio::test]
    async fn controlled_sidecar_stop_clears_proxy_before_stopping() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_controlled_stop_transition(
            true,
            RunningMode::Sidecar,
            || future::ready(()),
            || transition_step(&calls, "proxy_clear", None),
            || transition_step(&calls, "core_stop", None),
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(&*calls.lock(), &["proxy_clear", "core_stop"]);
    }

    #[tokio::test]
    async fn controlled_macos_service_stop_drains_guard_before_one_helper_transaction() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_controlled_stop_transition(
            true,
            RunningMode::Service,
            || {
                calls.lock().push("guard-stopped");
                future::ready(())
            },
            || transition_step(&calls, "unexpected-proxy-clear", None),
            || transition_step(&calls, "service_stop_with_proxy_clear", None),
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(&*calls.lock(), &["guard-stopped", "service_stop_with_proxy_clear"]);
    }

    #[tokio::test]
    async fn failed_macos_service_stop_cannot_be_followed_by_a_stale_guard_write() {
        let coordinator = Arc::new(FakeGuardCoordinator::new());
        let calls = Arc::new(Mutex::new(Vec::new()));
        let guard_started = Arc::new(Barrier::new(2));
        let release_guard = Arc::new(Barrier::new(2));
        let captured_generation = coordinator.generation.load(Ordering::Acquire);

        let in_flight_guard = {
            let coordinator = Arc::clone(&coordinator);
            let calls = Arc::clone(&calls);
            let guard_started = Arc::clone(&guard_started);
            let release_guard = Arc::clone(&release_guard);
            tokio::spawn(async move {
                let _operation = coordinator.operation_lock.lock().await;
                calls.lock().push("guard-started");
                guard_started.wait().await;
                release_guard.wait().await;
                calls.lock().push("guard-finished");
            })
        };
        guard_started.wait().await;

        let mut stop = Box::pin(run_controlled_stop_transition(
            true,
            RunningMode::Service,
            || async {
                coordinator.stop_guard(&calls).await;
            },
            || transition_step(&calls, "unexpected-proxy-clear", None),
            || transition_step(&calls, "service-stop-failed", Some("service-stop-failed")),
        ));
        assert!(matches!(futures::poll!(stop.as_mut()), Poll::Pending));
        release_guard.wait().await;

        assert!(in_flight_guard.await.is_ok());
        assert!(stop.await.is_err());
        assert!(!coordinator.run_guard_request(captured_generation, &calls).await);
        assert_eq!(
            &*calls.lock(),
            &[
                "guard-started",
                "guard-finished",
                "guard-stopped",
                "service-stop-failed"
            ]
        );
    }

    #[tokio::test]
    async fn controlled_sidecar_stop_aborts_when_proxy_clear_fails() {
        let calls = Arc::new(Mutex::new(Vec::new()));

        let result = run_controlled_stop_transition(
            true,
            RunningMode::Sidecar,
            || future::ready(()),
            || transition_step(&calls, "proxy_clear", Some("proxy_clear")),
            || transition_step(&calls, "core_stop", None),
        )
        .await;

        assert!(result.is_err());
        assert_eq!(&*calls.lock(), &["proxy_clear"]);
    }

    #[tokio::test]
    async fn handoff_cleanup_failure_aborts_fallback_and_leaves_service_alive() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let service_alive = AtomicBool::new(true);

        let result = run_controlled_stop_transition(
            false,
            RunningMode::Service,
            || future::ready(()),
            || transition_step(&calls, "service-proxy-clear", Some("service-proxy-clear")),
            || {
                service_alive.store(false, Ordering::Release);
                transition_step(&calls, "service-stop", None)
            },
        )
        .await;

        assert!(result.is_err());
        assert!(service_alive.load(Ordering::Acquire));
        assert_eq!(&*calls.lock(), &["service-proxy-clear"]);
    }
}
