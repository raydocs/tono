//! Install and remove the secondary AI hold. Best-effort. Automatic releases
//! install it while the general block is still armed (#1271), then again after
//! the release at the durable boundary. A failure is logged and reported, and
//! never keeps or restores the general block.
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
    succeeded: bool,
    completed: tokio::sync::watch::Sender<u64>,
}

static WORKER: Lazy<Mutex<WorkerState>> = Lazy::new(|| {
    let (completed, _) = tokio::sync::watch::channel(0);
    Mutex::new(WorkerState {
        revision: 0,
        apply_narrow: false,
        running: false,
        succeeded: true,
        completed,
    })
});

fn worker_guard() -> MutexGuard<'static, WorkerState> {
    WORKER
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// #1145: the advisory verdict of the installed hold, and the bookkeeping that keeps a slow
/// observation from ever touching the hold itself.
struct NrptObservation {
    /// Bumped by every install and every removal; a read result only lands if it is still current.
    generation: u64,
    /// True from an install until the hold is removed or its install failed.
    wanted: bool,
    /// At most one observer thread exists, so a hung registry read cannot pile up threads.
    running: bool,
    /// `Some` while the hold is installed but Windows is not applying Tono's local per-suffix
    /// NRPT rules, because domain (Group Policy) NRPT policy exists.
    verdict: Option<String>,
}

static NRPT_OBSERVATION: Mutex<NrptObservation> = Mutex::new(NrptObservation {
    generation: 0,
    wanted: false,
    running: false,
    verdict: None,
});

fn nrpt_observation() -> MutexGuard<'static, NrptObservation> {
    NRPT_OBSERVATION
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The degraded reason of the installed hold, for the DNS status: `Some` when the DNS Client
/// ignores Tono's suffix rules. The firewall prefixes stay in force; the AI DNS hold for names
/// outside them does not.
pub(crate) fn nrpt_suppression() -> Option<String> {
    nrpt_observation().verdict.clone()
}

/// The hold is gone or was not installed: no degraded reason, and any read still in flight is stale.
fn clear_nrpt_observation() {
    let mut state = nrpt_observation();
    state.generation += 1;
    state.wanted = false;
    state.verdict = None;
}

/// An install pass ended: only a fully applied hold gets an observation. Any failed pass drops
/// the verdict and every read in flight, so a warning is never published for a hold whose
/// install was reported as failed.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn conclude_install(applied: bool, read: EffectiveNrptRead) -> bool {
    if applied {
        begin_nrpt_observation(read);
    } else {
        clear_nrpt_observation();
    }
    applied
}

type EffectiveNrptRead = fn() -> Result<Vec<super::dns::EffectiveNrptRule>, String>;

/// Judge the effective NRPT after the suffix rules were written, on a thread of its own. Written
/// is not in force: domain NRPT policy makes the DNS Client ignore the local store. The read is
/// advisory, so it never runs inside the hold worker's completion path: a slow or hung registry
/// read cannot fail an install that succeeded or delay a later removal. Reports only; Tono never
/// edits or removes enterprise policy and writes no catch-all to compensate.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn begin_nrpt_observation(read: EffectiveNrptRead) {
    {
        let mut state = nrpt_observation();
        state.generation += 1;
        state.wanted = true;
        state.verdict = None;
        if state.running {
            // The observer in flight sees the newer generation and reads again.
            return;
        }
        state.running = true;
    }
    if let Err(error) = std::thread::Builder::new()
        .name("tono-nrpt-observer".to_owned())
        .spawn(move || observe_nrpt(read))
    {
        tracing::warn!("selective fail-open: NRPT observer could not start: {error}");
        nrpt_observation().running = false;
    }
}

#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn observe_nrpt(read: EffectiveNrptRead) {
    loop {
        #[cfg(test)]
        let _before_snapshot = tests::pause(&tests::NRPT_OBSERVER_START_PAUSE);
        // Snapshot and check `wanted` under one lock: a hold removed (or whose install failed)
        // before this thread got going is not read at all.
        let generation = {
            let mut state = nrpt_observation();
            if !state.wanted {
                state.running = false;
                return;
            }
            state.generation
        };
        let effective = std::panic::catch_unwind(read)
            .unwrap_or_else(|_| Err("effective NRPT read panicked".to_owned()));
        let verdict =
            super::dns::selective_hold_suppression(effective.as_deref().map_err(String::as_str));
        let mut state = nrpt_observation();
        if !state.wanted {
            // Removed or failed meanwhile: the result describes a hold that no longer exists.
            state.running = false;
            return;
        }
        if state.generation == generation {
            if let Some(reason) = &verdict {
                tracing::warn!("selective fail-open: {reason}");
            }
            state.verdict = verdict;
            state.running = false;
            return;
        }
        // A newer install while this read was in flight: read again for it.
    }
}

/// True only when the requested state was reached natively within the wait budget.
async fn request(apply_narrow: bool) -> bool {
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
    let finished = tokio::time::timeout(budget, async {
        loop {
            if *completed.borrow_and_update() >= revision {
                return true;
            }
            if completed.changed().await.is_err() {
                return false;
            }
        }
    })
    .await;
    matches!(finished, Ok(true)) && worker_guard().succeeded
}

fn reconcile_blocking() {
    loop {
        let (revision, apply_narrow) = {
            let worker = worker_guard();
            (worker.revision, worker.apply_narrow)
        };
        // No state lock is held during native commands. In unwind builds, a panic must not
        // strand the running flag and prevent subsequent best-effort recovery attempts.
        let succeeded = std::panic::catch_unwind(|| {
            if apply_narrow {
                // Reconcile in place: an existing hold must never be deleted by another
                // request for that same hold, including recovery after Service restart.
                worker_guard().revision != revision || apply_blocking()
            } else {
                remove_blocking();
                true
            }
        })
        .unwrap_or_else(|_| {
            tracing::warn!("selective fail-open: native reconciliation panicked");
            false
        });
        let mut worker = worker_guard();
        if worker.revision == revision {
            // Retire and publish completion under the same lock as new-request admission.
            worker.running = false;
            worker.succeeded = succeeded;
            worker.completed.send_replace(revision);
            return;
        }
        // A later Restore/arm supersedes even an application that was already in flight.
    }
}

#[cfg(test)]
static TEST_HOLD_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// What the effective-NRPT read returns right after the stubbed install; `None` is an ordinary
/// machine whose local store carries Tono's suffix rules.
#[cfg(test)]
static TEST_EFFECTIVE_NRPT: Mutex<Option<Vec<super::dns::EffectiveNrptRule>>> = Mutex::new(None);

#[cfg(test)]
#[allow(dead_code)]
fn test_effective_nrpt_read() -> Result<Vec<super::dns::EffectiveNrptRule>, String> {
    // A hung registry read: the observer blocks here until the test releases it.
    let pause = tests::pause(&tests::NRPT_READ_PAUSE);
    let rules = TEST_EFFECTIVE_NRPT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
        .unwrap_or_else(|| {
            // The ordinary machine: only the local store, so the suffix rules are in force.
            vec![super::dns::EffectiveNrptRule {
                namespaces: vec!["anthropic.example".to_owned()],
                generic_dns_servers: vec![selective_fail_open::SINKHOLE_DNS.to_owned()],
                tono_owned: false,
            }]
        });
    drop(pause);
    Ok(rules)
}

/// Makes the stubbed install report failure, as a failed firewall rule does on a machine.
#[cfg(test)]
static TEST_APPLY_FAILS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(test)]
static TEST_ACTIVE_HOLD_REMOVALS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
pub(super) fn test_hold_active() -> bool {
    TEST_HOLD_ACTIVE.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(test)]
pub(super) fn test_active_hold_removals() -> usize {
    TEST_ACTIVE_HOLD_REMOVALS.load(std::sync::atomic::Ordering::SeqCst)
}

pub async fn remove() {
    request(false).await;
}

/// True when the resulting disposition is in place: the hold is installed, or none is wanted.
pub async fn finish_release(apply_narrow: bool) -> bool {
    let apply_narrow = apply_narrow
        && selective_fail_open::follow_up(selective_fail_open::ReleaseKind::CrashOrHang)
            == selective_fail_open::FollowUp::Apply;
    request(apply_narrow).await
}

#[cfg(any(windows, test))]
fn firewall_command(
    system_directory: &std::path::Path,
    args: &[&str],
) -> Option<std::process::Command> {
    if !selective_fail_open::command_may_run(args) {
        return None;
    }
    let (_, rest) = args.split_first()?;
    // The policy's fixed executable marker validates the template. Bind the
    // actual binary to the OS directory, without consulting PATH or SystemRoot.
    let mut command = std::process::Command::new(system_directory.join("netsh.exe"));
    command.args(rest);
    Some(command)
}

#[cfg(all(windows, not(feature = "test")))]
fn remove_blocking() {
    clear_nrpt_observation();
    run_commands(&selective_fail_open::firewall_delete_commands());
    if let Err(error) = super::dns::remove_selective_nrpt() {
        tracing::warn!("selective fail-open: NRPT sinkhole could not be removed: {error:#}");
    }
}

#[cfg(all(windows, not(feature = "test")))]
fn apply_blocking() -> bool {
    let mut applied = true;
    for (update, add) in selective_fail_open::firewall_set_commands()
        .iter()
        .zip(selective_fail_open::firewall_add_commands())
    {
        // Set preserves existing rules and updates all same-name copies. A missing rule
        // needs an add; only that rule falls back, so the other prefix is never duplicated.
        if !run_command(update, false) && !run_command(&add, true) {
            applied = false;
        }
    }
    if let Err(error) = super::dns::install_selective_nrpt() {
        tracing::warn!("selective fail-open: NRPT sinkhole was not installed: {error:#}");
        applied = false;
    }
    // Written is not in force: domain NRPT policy makes the DNS Client ignore the local store.
    conclude_install(applied, super::dns::effective_nrpt_rules_now)
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn remove_blocking() {
    clear_nrpt_observation();
    #[cfg(test)]
    {
        let pause = tests::pause(&tests::REMOVE_PAUSE);
        if TEST_HOLD_ACTIVE.swap(false, std::sync::atomic::Ordering::SeqCst) {
            TEST_ACTIVE_HOLD_REMOVALS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        if let Some(pause) = pause {
            pause.completed.notify_one();
        }
    }
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn apply_blocking() -> bool {
    #[allow(unused_mut)]
    let mut applied = true;
    #[cfg(test)]
    {
        let pause = tests::pause(&tests::APPLY_PAUSE);
        TEST_HOLD_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
        applied = conclude_install(
            !TEST_APPLY_FAILS.load(std::sync::atomic::Ordering::SeqCst),
            test_effective_nrpt_read,
        );
        if let Some(pause) = pause {
            pause.completed.notify_one();
        }
    }
    applied
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use serial_test::serial;
    use std::sync::{Arc, Condvar, Mutex};

    #[test]
    fn firewall_command_uses_the_os_system_directory_on_non_c_windows() {
        let system = std::path::Path::new(r"D:\Windows\System32");
        let args = selective_fail_open::firewall_add_commands().remove(0);
        let command = firewall_command(system, &args).unwrap();
        assert_eq!(command.get_program(), system.join("netsh.exe").as_os_str());
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            args[1..].iter().map(std::ffi::OsStr::new).collect::<Vec<_>>()
        );
    }

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
    pub(super) static NRPT_READ_PAUSE: Lazy<Mutex<Option<Arc<PausedStep>>>> =
        Lazy::new(|| Mutex::new(None));
    pub(super) static NRPT_OBSERVER_START_PAUSE: Lazy<Mutex<Option<Arc<PausedStep>>>> =
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
    async fn repeated_application_never_removes_the_existing_ai_hold() {
        remove().await;
        finish_release(true).await;
        let before = test_active_hold_removals();
        finish_release(true).await;
        let held = test_hold_active();
        let after = test_active_hold_removals();
        remove().await;

        assert!(held, "the requested AI hold must remain installed");
        assert_eq!(after, before, "reapplying the same hold must never delete it first");
    }

    /// The observer runs on its own thread. It marks itself idle in the same critical section
    /// that publishes (or discards) its verdict, and `begin_nrpt_observation` marks it running
    /// before the install returns, so idle after an install means that observation is settled.
    async fn observer_idle() {
        tokio::time::timeout(Duration::from_secs(5), async {
            while nrpt_observation().running {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("the advisory observer settled");
    }

    async fn warning() -> Option<String> {
        crate::core::dns::status().await.resolver_policy_warning
    }

    /// #1145: any domain NRPT policy, even for an unrelated namespace, makes the DNS Client ignore
    /// the local store the hold writes to. The hold must say so in the DNS status instead of
    /// reporting an install that has no effect, and must still change nothing else.
    #[tokio::test]
    #[serial]
    async fn domain_nrpt_policy_over_the_ai_hold_is_reported_in_the_dns_status() {
        remove().await;
        observer_idle().await; // settle observers left by earlier tests
        *TEST_EFFECTIVE_NRPT.lock().unwrap() = Some(vec![crate::core::dns::EffectiveNrptRule {
            namespaces: vec![".corp.example".to_owned()],
            generic_dns_servers: vec!["10.0.0.53".to_owned()],
            tono_owned: false,
        }]);
        finish_release(true).await;
        observer_idle().await;
        let held = test_hold_active();
        let suppressed = warning().await;
        remove().await;
        let after_remove = warning().await;
        *TEST_EFFECTIVE_NRPT.lock().unwrap() = None;
        finish_release(true).await;
        observer_idle().await;
        let ordinary = warning().await;
        remove().await;

        assert!(
            held,
            "the hold stays installed; the policy is reported, never fought"
        );
        assert!(
            suppressed.is_some_and(
                |text| text.contains(crate::core::dns::DNS_SELECTIVE_POLICY_SUPPRESSED_PREFIX)
            ),
            "an unrelated domain namespace suppresses the local suffix rules"
        );
        assert_eq!(after_remove, None, "no hold, no degraded reason");
        assert_eq!(ordinary, None, "an ordinary machine reports nothing");
    }

    /// The advisory read must not be able to fail an install that succeeded, hold up the removal,
    /// or bring a stale warning back after the hold is gone.
    #[tokio::test]
    #[serial]
    async fn a_hung_nrpt_read_cannot_fail_the_install_block_the_removal_or_revive_a_warning() {
        remove().await;
        observer_idle().await; // settle observers left by earlier tests
        *TEST_EFFECTIVE_NRPT.lock().unwrap() = Some(vec![crate::core::dns::EffectiveNrptRule {
            namespaces: vec![".corp.example".to_owned()],
            generic_dns_servers: vec!["10.0.0.53".to_owned()],
            tono_owned: false,
        }]);
        let hung = pause_next(&NRPT_READ_PAUSE);

        let installed = tokio::time::timeout(STEP_BUDGET * 2, finish_release(true))
            .await
            .expect("the install completes while the advisory read hangs");
        tokio::time::timeout(Duration::from_secs(1), hung.0.entered.notified())
            .await
            .expect("the observer is blocked in the read");
        let held = test_hold_active();
        let removed = tokio::time::timeout(STEP_BUDGET * 2, async {
            remove().await;
        })
        .await;
        let held_after_remove = test_hold_active();

        // The read finally returns the suppressing answer for the hold that no longer exists.
        hung.0.release();
        observer_idle().await;
        let revived = warning().await;
        *TEST_EFFECTIVE_NRPT.lock().unwrap() = None;

        assert!(installed, "a successful install is not reported as failed");
        assert!(held, "the hold is in place while the read hangs");
        assert!(removed.is_ok(), "a hung read does not block the removal");
        assert!(!held_after_remove, "the removal took effect");
        assert_eq!(revived, None, "a late result cannot revive a warning after remove()");
    }

    /// A later install pass that fails (a firewall rule that cannot be set) reports failure, so
    /// the observation of the earlier pass must not publish a warning for it either.
    #[tokio::test]
    #[serial]
    async fn a_failed_reinstall_drops_the_observation_of_the_earlier_install() {
        remove().await;
        observer_idle().await; // settle observers left by earlier tests
        *TEST_EFFECTIVE_NRPT.lock().unwrap() = Some(vec![crate::core::dns::EffectiveNrptRule {
            namespaces: vec![".corp.example".to_owned()],
            generic_dns_servers: vec!["10.0.0.53".to_owned()],
            tono_owned: false,
        }]);
        let hung = pause_next(&NRPT_READ_PAUSE);

        assert!(finish_release(true).await, "the first install succeeds");
        tokio::time::timeout(Duration::from_secs(1), hung.0.entered.notified())
            .await
            .expect("the observer is blocked in the read");
        TEST_APPLY_FAILS.store(true, std::sync::atomic::Ordering::SeqCst);
        let reinstalled = finish_release(true).await;
        TEST_APPLY_FAILS.store(false, std::sync::atomic::Ordering::SeqCst);
        hung.0.release();
        observer_idle().await;
        let published = warning().await;
        *TEST_EFFECTIVE_NRPT.lock().unwrap() = None;
        remove().await;

        assert!(!reinstalled, "the failed pass is reported as failed");
        assert_eq!(published, None, "a failed install has no degraded reason");
    }

    /// The observer may not even have started when the hold is removed: it must then read nothing
    /// and publish nothing, instead of judging the policy against a hold that is already gone.
    #[tokio::test]
    #[serial]
    async fn an_observer_that_starts_after_the_removal_publishes_nothing() {
        remove().await;
        observer_idle().await; // settle observers left by earlier tests
        *TEST_EFFECTIVE_NRPT.lock().unwrap() = Some(vec![crate::core::dns::EffectiveNrptRule {
            namespaces: vec![".corp.example".to_owned()],
            generic_dns_servers: vec!["10.0.0.53".to_owned()],
            tono_owned: false,
        }]);
        let not_started = pause_next(&NRPT_OBSERVER_START_PAUSE);

        assert!(finish_release(true).await, "the install does not wait for the observer");
        tokio::time::timeout(Duration::from_secs(1), not_started.0.entered.notified())
            .await
            .expect("the observer is parked before its first snapshot");
        remove().await;
        not_started.0.release();
        observer_idle().await;
        let late = warning().await;
        *TEST_EFFECTIVE_NRPT.lock().unwrap() = None;

        assert_eq!(late, None, "an observer that starts after remove() must not warn");
    }

    #[tokio::test]
    #[serial]
    async fn timed_out_cleanup_cannot_erase_the_replacement_ai_hold() {
        remove().await;
        let pause = pause_next(&REMOVE_PAUSE);
        let cleanup = tokio::spawn(remove());
        tokio::time::timeout(Duration::from_secs(1), pause.0.entered.notified())
            .await
            .unwrap();
        tokio::time::timeout(STEP_BUDGET * 2, cleanup)
            .await
            .unwrap()
            .unwrap();
        let release = tokio::spawn(finish_release(true));
        tokio::time::timeout(Duration::from_secs(1), async {
            while !worker_guard().apply_narrow {
                tokio::task::yield_now().await;
            }
        }).await.unwrap();

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
        release.await.unwrap();
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
        run_command(args, true);
    }
}

#[cfg(all(windows, not(feature = "test")))]
fn run_command(args: &[&str], report_failure: bool) -> bool {
    let system = match super::update::security::system_directory() {
        Ok(system) => system,
        Err(error) => {
            tracing::warn!("selective fail-open: system directory unavailable: {error:#}");
            return false;
        }
    };
    let Some(mut command) = firewall_command(&system, args) else {
        tracing::error!("selective fail-open: refused a command that was not prefix-only");
        return false;
    };
    match command.status() {
        Ok(status) if status.success() => true,
        Ok(status) => {
            if report_failure {
                tracing::warn!("selective fail-open: command exited {status}");
            }
            false
        }
        Err(error) => {
            if report_failure {
                tracing::warn!("selective fail-open: command did not start: {error}");
            }
            false
        }
    }
}
