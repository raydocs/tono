//! Cancellation and exclusive ownership boundary for a protected recovery mutation.

use std::future::Future;

/// Run recovery after acquiring the same exclusive guard used by release. The recovery
/// future must check its captured generation before performing any side effects.
pub async fn reconcile_recovery<G: Send + 'static>(
    guard: impl Future<Output = G> + Send + 'static,
    recovery: impl Future<Output = bool> + Send + 'static,
) -> Result<bool, tokio::task::JoinError> {
    tokio::spawn(async move {
        let _guard = guard.await;
        recovery.await
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
    use std::time::Duration;
    use tokio::sync::{RwLock, oneshot};

    #[tokio::test]
    async fn recovery_retains_exclusive_ownership_after_caller_cancellation() {
        let barrier = Arc::new(RwLock::new(()));
        let session = Arc::new(AtomicU64::new(7));
        let stopped = Arc::new(AtomicU64::new(0));
        let (entered, entering) = oneshot::channel();
        let (resume, resumed) = oneshot::channel();
        let caller = tokio::spawn(reconcile_recovery(
            Arc::clone(&barrier).write_owned(),
            {
                let session = Arc::clone(&session);
                let stopped = Arc::clone(&stopped);
                async move {
                    entered.send(()).unwrap();
                    resumed.await.unwrap();
                    stopped.store(session.load(Ordering::SeqCst), Ordering::SeqCst);
                    true
                }
            },
        ));
        entering.await.unwrap();
        assert!(barrier.try_write().is_err(), "release must not overtake admitted recovery");
        assert!(barrier.try_read().is_err(), "replacement Core startup must wait too");
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        assert!(barrier.try_write().is_err(), "caller cancellation must not expose a live mutation");
        resume.send(()).unwrap();
        let release = tokio::time::timeout(Duration::from_secs(2), barrier.write()).await.unwrap();
        assert_eq!(stopped.load(Ordering::SeqCst), 7);

        // Admission happens after the guard: a queued old generation cannot stop session 8.
        let queued = tokio::spawn(reconcile_recovery(Arc::clone(&barrier).write_owned(), {
            let session = Arc::clone(&session);
            let stopped = Arc::clone(&stopped);
            async move {
                if session.load(Ordering::SeqCst) != 7 { return false; }
                stopped.store(8, Ordering::SeqCst);
                true
            }
        }));
        tokio::task::yield_now().await;
        assert!(!queued.is_finished());
        session.store(8, Ordering::SeqCst);
        drop(release);
        let admitted = queued.await.unwrap().unwrap();
        assert!(!admitted);
        assert_eq!(stopped.load(Ordering::SeqCst), 7);
    }
}
