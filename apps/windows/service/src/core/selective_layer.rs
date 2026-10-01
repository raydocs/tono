//! Install and remove the secondary AI hold. Best-effort, and only after a
//! full release has already opened the network. A failure here is logged and
//! does not restore the general block.
//!
//! The firewall rules are Windows Firewall entries with a fixed remote prefix,
//! not filters in the kill-switch provider. Residual kill-switch filters are
//! what service start treats as "still armed". Putting this hold in that
//! provider would make the next start install an emergency block-all.

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use once_cell::sync::Lazy;

use super::selective_fail_open;

const STEP_BUDGET: Duration = Duration::from_secs(3);

struct WorkerState {
    revision: u64,
    apply_narrow: bool,
    running: bool,
    completed: tokio::sync::watch::Sender<u64>,
}

static WORKER: Lazy<Mutex<WorkerState>> = Lazy::new(|| {
    let (completed, _) = tokio::sync::watch::channel(0);
    Mutex::new(WorkerState {
        revision: 0,
        apply_narrow: false,
        running: false,
        completed,
    })
});

fn worker_guard() -> MutexGuard<'static, WorkerState> {
    WORKER
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

async fn request(apply_narrow: bool) {
    let (revision, mut completed, start) = {
        let mut worker = worker_guard();
        worker.revision += 1;
        worker.apply_narrow = apply_narrow;
        let start = !worker.running;
        worker.running = true;
        (worker.revision, worker.completed.subscribe(), start)
    };
    if start {
        tokio::task::spawn_blocking(reconcile_blocking);
    }
    // Timeout stops only this wait. One worker keeps ownership of the native mutations,
    // coalescing newer requests rather than letting their deletes/adds race abandoned work.
    let budget = if apply_narrow {
        STEP_BUDGET * 2
    } else {
        STEP_BUDGET
    };
    let _ = tokio::time::timeout(budget, async {
        loop {
            if *completed.borrow_and_update() >= revision {
                break;
            }
            if completed.changed().await.is_err() {
                break;
            }
        }
    })
    .await;
}

fn reconcile_blocking() {
    loop {
        let (revision, apply_narrow) = {
            let worker = worker_guard();
            (worker.revision, worker.apply_narrow)
        };
        // No state lock is held during native commands. In unwind builds, a panic must not
        // strand the running flag and prevent subsequent best-effort recovery attempts.
        if std::panic::catch_unwind(|| {
            remove_blocking();
            if apply_narrow && worker_guard().revision == revision {
                apply_blocking();
            }
        })
        .is_err()
        {
            tracing::warn!("selective fail-open: native reconciliation panicked");
        }
        let mut worker = worker_guard();
        if worker.revision == revision {
            // Retire and publish completion under the same lock as new-request admission.
            worker.running = false;
            worker.completed.send_replace(revision);
            return;
        }
        // A later Restore/arm supersedes even an application that was already in flight.
    }
}

#[cfg(test)]
static TEST_HOLD_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(test)]
pub(super) fn test_hold_active() -> bool {
    TEST_HOLD_ACTIVE.load(std::sync::atomic::Ordering::SeqCst)
}

pub async fn remove() {
    request(false).await;
}

pub async fn finish_release(apply_narrow: bool) {
    let apply_narrow = apply_narrow
        && selective_fail_open::follow_up(selective_fail_open::ReleaseKind::CrashOrHang)
            == selective_fail_open::FollowUp::Apply;
    request(apply_narrow).await;
}

#[cfg(all(windows, not(feature = "test")))]
fn remove_blocking() {
    run_commands(&selective_fail_open::firewall_delete_commands());
    if let Err(error) = super::dns::remove_selective_nrpt() {
        tracing::warn!("selective fail-open: NRPT sinkhole could not be removed: {error:#}");
    }
}

#[cfg(all(windows, not(feature = "test")))]
fn apply_blocking() {
    run_commands(&selective_fail_open::firewall_add_commands());
    if let Err(error) = super::dns::install_selective_nrpt() {
        tracing::warn!("selective fail-open: NRPT sinkhole was not installed: {error:#}");
    }
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn remove_blocking() {
    #[cfg(test)]
    {
        let pause = tests::pause(&tests::REMOVE_PAUSE);
        TEST_HOLD_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Some(pause) = pause {
            pause.completed.notify_one();
        }
    }
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn apply_blocking() {
    #[cfg(test)]
    {
        let pause = tests::pause(&tests::APPLY_PAUSE);
        TEST_HOLD_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(pause) = pause {
            pause.completed.notify_one();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use serial_test::serial;
    use std::sync::{Arc, Condvar, Mutex};

    #[derive(Default)]
    pub(super) struct PausedStep {
        entered: tokio::sync::Notify,
        pub(super) completed: tokio::sync::Notify,
        released: Mutex<bool>,
        resume: Condvar,
    }

    impl PausedStep {
        fn release(&self) {
            *self.released.lock().unwrap() = true;
            self.resume.notify_all();
        }
    }

    // Release the native worker even when a regression assertion fails.
    struct PauseGuard(Arc<PausedStep>);
    impl Drop for PauseGuard {
        fn drop(&mut self) {
            self.0.release();
        }
    }

    pub(super) static REMOVE_PAUSE: Lazy<Mutex<Option<Arc<PausedStep>>>> =
        Lazy::new(|| Mutex::new(None));
    pub(super) static APPLY_PAUSE: Lazy<Mutex<Option<Arc<PausedStep>>>> =
        Lazy::new(|| Mutex::new(None));

    fn pause_next(slot: &Mutex<Option<Arc<PausedStep>>>) -> PauseGuard {
        let step = Arc::new(PausedStep::default());
        *slot.lock().unwrap() = Some(step.clone());
        PauseGuard(step)
    }

    pub(super) fn pause(slot: &Mutex<Option<Arc<PausedStep>>>) -> Option<Arc<PausedStep>> {
        let step = slot.lock().unwrap().take()?;
        step.entered.notify_one();
        let released = step.released.lock().unwrap();
        drop(
            step.resume
                .wait_while(released, |released| !*released)
                .unwrap(),
        );
        Some(step)
    }

    #[tokio::test]
    #[serial]
    async fn timed_out_cleanup_cannot_erase_the_replacement_ai_hold() {
        remove().await;
        let pause = pause_next(&REMOVE_PAUSE);
        let release = tokio::spawn(finish_release(true));
        tokio::time::timeout(Duration::from_secs(1), pause.0.entered.notified())
            .await
            .unwrap();
        tokio::time::timeout(STEP_BUDGET * 3, release)
            .await
            .unwrap()
            .unwrap();

        pause.0.release();
        tokio::time::timeout(Duration::from_secs(1), pause.0.completed.notified())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while !test_hold_active() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("late cleanup must leave the requested AI hold installed");
        remove().await;
    }

    #[tokio::test]
    #[serial]
    async fn late_apply_yields_to_a_newer_restore_request() {
        remove().await;
        let pause = pause_next(&APPLY_PAUSE);
        let release = tokio::spawn(finish_release(true));
        tokio::time::timeout(Duration::from_secs(1), pause.0.entered.notified())
            .await
            .unwrap();
        remove().await;
        pause.0.release();
        tokio::time::timeout(STEP_BUDGET * 3, release)
            .await
            .unwrap()
            .unwrap();

        assert!(
            !test_hold_active(),
            "a newer Restore must remain final after old application completes"
        );
        remove().await;
    }
}

#[cfg(all(windows, not(feature = "test")))]
fn run_commands(commands: &[Vec<&str>]) {
    for args in commands {
        if !selective_fail_open::command_may_run(args) {
            tracing::error!("selective fail-open: refused a command that was not prefix-only");
            continue;
        }
        let Some((executable, rest)) = args.split_first() else {
            continue;
        };
        match std::process::Command::new(executable).args(rest).status() {
            Ok(status) if status.success() => {}
            Ok(status) => tracing::warn!("selective fail-open: command exited {status}"),
            Err(error) => tracing::warn!("selective fail-open: command did not start: {error}"),
        }
    }
}
