//! Event-assisted TUN readiness. Hints wake a recheck; they never prove protection.
use anyhow::Result;
use std::{future::Future, time::Duration};
use tokio::sync::Notify;

static TUN_HINT: Notify = Notify::const_new();
pub(super) fn note_interface_hint() {
    TUN_HINT.notify_waiters();
}

fn is_tun_pending(error: &anyhow::Error) -> bool {
    let text = format!("{error:#}").to_lowercase();
    text.contains("did not resolve to a luid") || text.contains("is not a tunnel device")
}

/// Preserve the old 49 x 200 ms fallback waits, with additional event wakeups.
/// The attempt closure owns lifecycle/WFP guards ONLY while checking/mutating,
/// never while this function waits; every retry must authenticate the session again.
pub(super) async fn lock_when_ready<F, Fut>(attempt: F) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<()>>,
{
    retry(&TUN_HINT, 49, Duration::from_millis(200), attempt).await
}

async fn retry<F, Fut>(
    hints: &Notify,
    mut waits: usize,
    interval: Duration,
    mut attempt: F,
) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<()>>,
{
    let mut next_fallback = None;
    loop {
        // Register BEFORE checking, so a notification during the native lookup
        // cannot be lost in the gap between a failed lookup and going to sleep.
        let notified = hints.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let error = match attempt().await {
            Ok(()) => return Ok(()),
            Err(error) => error,
        };
        if !is_tun_pending(&error) {
            return Err(error);
        }
        if waits == 0 {
            return Err(error.context("TONO_TUN_WAIT_EXHAUSTED"));
        }
        let deadline = *next_fallback.get_or_insert_with(|| tokio::time::Instant::now() + interval);
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(deadline) => {
                waits -= 1;
                next_fallback = Some(tokio::time::Instant::now() + interval);
            }
            _ = &mut notified => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[tokio::test]
    async fn event_during_lookup_is_not_lost_or_spent_as_a_retry_tick() {
        let hints = Notify::new();
        let calls = AtomicUsize::new(0);
        tokio::time::timeout(
            Duration::from_millis(100),
            retry(&hints, 1, Duration::from_secs(10), || async {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    hints.notify_waiters();
                    anyhow::bail!("did not resolve to a LUID");
                }
                Ok(())
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
    #[tokio::test]
    async fn notification_churn_cannot_reset_the_fallback_budget() {
        let hints = Notify::new();
        let error = tokio::time::timeout(
            Duration::from_secs(1),
            retry(&hints, 2, Duration::from_millis(2), || async {
                hints.notify_waiters();
                tokio::task::yield_now().await;
                anyhow::bail!("did not resolve to a LUID")
            }),
        )
        .await
        .expect("notifications must not starve the timer")
        .unwrap_err();
        assert!(format!("{error:#}").contains("TONO_TUN_WAIT_EXHAUSTED"));
    }

    #[tokio::test]
    async fn missing_notifications_have_bounded_fallback_and_permanent_errors_do_not_retry() {
        let calls = AtomicUsize::new(0);
        let error = retry(&Notify::new(), 2, Duration::from_millis(1), || async {
            calls.fetch_add(1, Ordering::SeqCst);
            anyhow::bail!("is not a tunnel device")
        })
        .await
        .unwrap_err();
        assert!(format!("{error:#}").contains("TONO_TUN_WAIT_EXHAUSTED"));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        let error = retry(&Notify::new(), 2, Duration::from_secs(10), || async {
            anyhow::bail!("session changed")
        })
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "session changed");
    }
}
