//! One deadline and cancellation token for the whole connect attempt.
//! This module never owns privileged cleanup; the generation owner reconciles it.

use std::{future::Future, time::Duration};
use tokio_util::sync::CancellationToken;

use super::failure::StageFailure;

/// C4 — 120 s did not cover a real cold first connect. It was sized while the DNS stage still
/// failed fast; once DNS starts *succeeding* (10–30 s of PowerShell) the sum crosses 120 s right
/// at the exit check, and a timeout there lands on the same no-retry path C3 describes. The
/// accounting below is per-leg worst case, machine-checked by `CONNECT_BUDGET_LEGS`:
///
/// | leg                                                    | worst |
/// |--------------------------------------------------------|-------|
/// | service readiness probe                                  |   3 s |
/// | StartClash #1 — cold WinTUN install + WFP arm             |  60 s | Service handler budget
/// | controller readiness (`CONTROLLER_READY_TIMEOUT`)         |  15 s |
/// | lock ladder (`LOCK_ATTEMPTS` × `LOCK_RETRY_INTERVAL`)     |  10 s |
/// | securingDNS — PowerShell/CIM live apply (shipped Service) |  30 s |
/// | fake-ip verification (3 × (5 s + 0.5 s), cancellable)     |  16 s |
/// | lock verify (4 samples of the decaying WFP cache)         |   3 s |
/// | MarkVerified commit IPC                                   |   5 s |
/// | **total**                                                 | 142 s |
///
/// Controller `/delay` and third-party TUN HTTPS (gstatic / Cloudflare / Apple)
/// are not on this clock. Optional DIRECT resolution runs after Connected.
pub(super) const CONNECT_TRANSACTION_TIMEOUT: Duration = Duration::from_secs(240);
/// The accounting table above, machine-checked by `connect_budget_covers_a_cold_first_connect`.
#[cfg(test)]
pub(super) const CONNECT_BUDGET_LEGS: [(&str, u64); 8] = [
    ("service readiness", 3),
    ("StartClash #1 (cold WinTUN + WFP arm)", 60),
    ("controller readiness", 15),
    ("lock ladder", 10),
    ("securingDNS", 30),
    ("fake-ip verification", 16),
    ("lock verify", 3),
    ("MarkVerified commit", 5),
];
#[derive(Clone)]
pub(super) struct ConnectTransaction {
    deadline: tokio::time::Instant,
    cancellation: CancellationToken,
}

impl ConnectTransaction {
    pub(super) fn new(cancellation: CancellationToken) -> Self {
        Self {
            deadline: tokio::time::Instant::now() + CONNECT_TRANSACTION_TIMEOUT,
            cancellation,
        }
    }

    pub(super) fn check(&self, stage: &'static str) -> Result<(), StageFailure> {
        if self.cancellation.is_cancelled() {
            return Err(StageFailure::Stale);
        }
        if tokio::time::Instant::now() >= self.deadline {
            return Err(StageFailure::TimedOut(format!(
                "connection transaction exceeded {CONNECT_TRANSACTION_TIMEOUT:?} during {stage}"
            )));
        }
        Ok(())
    }

    pub(super) async fn wait<T>(
        &self,
        stage: &'static str,
        future: impl Future<Output = T>,
    ) -> Result<T, StageFailure> {
        self.check(stage)?;
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(StageFailure::Stale),
            result = tokio::time::timeout_at(self.deadline, future) => result.map_err(|_| {
                StageFailure::TimedOut(format!(
                    "connection transaction exceeded {CONNECT_TRANSACTION_TIMEOUT:?} during {stage}"
                ))
            }),
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert transaction outcomes")]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    #[tokio::test(start_paused = true)]
    async fn completed_stage_preserves_its_own_result() {
        let transaction = ConnectTransaction::new(CancellationToken::new());
        let result = transaction.wait("probe", async { Err::<(), _>("probe failed") }).await;
        assert_eq!(result.expect("transaction itself is live"), Err("probe failed"));
    }

    #[tokio::test(start_paused = true)]
    async fn cancelled_before_entry_never_polls_the_stage() {
        let cancellation = CancellationToken::new();
        let transaction = ConnectTransaction::new(cancellation.clone());
        cancellation.cancel();
        let polled = AtomicBool::new(false);

        let result = transaction
            .wait("arm", async { polled.store(true, Ordering::SeqCst) })
            .await;

        assert!(matches!(result, Err(StageFailure::Stale)));
        assert!(!polled.load(Ordering::SeqCst));
    }

    #[tokio::test(start_paused = true)]
    async fn expired_before_entry_never_polls_the_stage() {
        let transaction = ConnectTransaction::new(CancellationToken::new());
        tokio::time::advance(CONNECT_TRANSACTION_TIMEOUT).await;
        let polled = AtomicBool::new(false);

        let result = transaction
            .wait("DNS", async { polled.store(true, Ordering::SeqCst) })
            .await;

        assert!(matches!(result, Err(StageFailure::TimedOut(message)) if message.ends_with("during DNS")));
        assert!(!polled.load(Ordering::SeqCst));
    }

    #[tokio::test(start_paused = true)]
    async fn later_stages_use_the_original_deadline() {
        let start = tokio::time::Instant::now();
        let transaction = ConnectTransaction::new(CancellationToken::new());
        transaction
            .wait("prepare", tokio::time::sleep(Duration::from_secs(200)))
            .await
            .expect("preparation fits the shared budget");

        let result = transaction.wait("verify", std::future::pending::<()>()).await;

        assert!(matches!(result, Err(StageFailure::TimedOut(message)) if message.ends_with("during verify")));
        assert_eq!(start.elapsed(), CONNECT_TRANSACTION_TIMEOUT);
    }

    #[tokio::test(start_paused = true)]
    async fn clones_do_not_reset_the_clock_or_detach_cancellation() {
        let cancellation = CancellationToken::new();
        let transaction = ConnectTransaction::new(cancellation.clone());
        tokio::time::advance(Duration::from_secs(10)).await;
        let cloned = transaction.clone();
        assert_eq!(cloned.deadline, transaction.deadline);

        cancellation.cancel();
        assert!(matches!(cloned.check("clone"), Err(StageFailure::Stale)));
        assert!(matches!(transaction.check("original"), Err(StageFailure::Stale)));
    }

    #[tokio::test(start_paused = true)]
    async fn cancellation_during_a_wait_drops_the_cancellation_safe_stage() {
        struct Dropped(Arc<AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let cancellation = CancellationToken::new();
        let transaction = ConnectTransaction::new(cancellation.clone());
        let entered = Arc::new(tokio::sync::Notify::new());
        let stage_entered = entered.clone();
        let dropped = Arc::new(AtomicBool::new(false));
        let stage_dropped = dropped.clone();
        let task = tokio::spawn(async move {
            transaction
                .wait("read-only probe", async move {
                    let _guard = Dropped(stage_dropped);
                    stage_entered.notify_one();
                    std::future::pending::<()>().await;
                })
                .await
        });
        entered.notified().await;
        cancellation.cancel();

        assert!(matches!(
            task.await.expect("wait task completed"),
            Err(StageFailure::Stale)
        ));
        assert!(dropped.load(Ordering::SeqCst));
    }
}
