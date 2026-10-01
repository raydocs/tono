//! Windows update handoff journal. Compatible with the macOS contract.
//!
//! Each phase is advanced only by the owner that completed the matching
//! operation. `prepare` writes `UpdatePrepared` and nothing later; jumping
//! to `ConnectionQuiescing` or `Committed` from here is an illegal skip.
//!
//! ```text
//! phase × process (who may write the file)
//! ────────────────────────────────────────────────────────────────
//! UpdatePrepared              App `tono_prepare_update`
//! ConnectionQuiescing         App, after it starts silent disconnect
//! CleanShutdownCompleted      App, after Core/TUN stop + DNS restore
//! ProtectedHandoffRecorded    App, only if kill switch stays armed
//! InstallStarted              `tono-service-install.exe --replace-runtime`
//!                             (NSIS); missing file is not an update
//! FirstLaunchMigration        new App process, version == next
//! ProtectionResuming         new App, if the previous process was protected
//! Verified then Committed     new App `commit_verified_recovery` only
//! Failed                      any owner on skip/persist failure; file stays
//! ```
//!
//! macOS Sparkle has no NSIS helper, so `installHandler` still writes
//! `InstallStarted` in-process after the quiesce hops.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use once_cell::sync::Lazy;

use tono_core::update_journal::{
    self, UpdateHandoffJournal, UpdateHandoffPhase, advance_pending, commit_verified_recovery,
    incomplete_from_phase, journal_path, load, record_first_launch_migration, write_prepared,
};
use tono_logging::{Type, logging};

const JOURNAL_REFRESH_INTERVAL: Duration = Duration::from_secs(2);
// Longer than the UI's five-second safety-net poll: normal refreshes can
// serve recent evidence, but a stuck reader cannot retain a clear result forever.
const JOURNAL_MAX_AGE: Duration = Duration::from_secs(10);
static PROJECTION: Lazy<Arc<JournalProjection>> =
    Lazy::new(|| Arc::new(JournalProjection::default()));

#[derive(Default)]
struct JournalProjection {
    state: Mutex<ProjectionState>,
}

#[derive(Default)]
struct ProjectionState {
    generation: u64,
    writers: usize,
    refreshing: bool,
    refreshed_at: Option<Instant>,
    incomplete: bool,
}

impl JournalProjection {
    fn incomplete_with(self: &Arc<Self>, read: impl FnOnce() -> bool + Send + 'static) -> bool {
        // This lock never covers I/O. Even contention on the projection must
        // not delay a caller holding the connection state mutex.
        let Ok(mut state) = self.state.try_lock() else {
            return true;
        };
        let age = state.refreshed_at.map(|at| at.elapsed());
        let warning = state.writers != 0
            || age.is_none_or(|age| age >= JOURNAL_MAX_AGE)
            || state.incomplete;
        if state.writers != 0
            || state.refreshing
            || age.is_some_and(|age| age < JOURNAL_REFRESH_INTERVAL)
        {
            return warning;
        }
        state.refreshing = true;
        let generation = state.generation;
        drop(state);
        let projection = self.clone();
        crate::process::AsyncHandler::spawn_blocking(move || {
            let incomplete = read();
            let mut state = projection.state.lock().unwrap();
            state.refreshing = false;
            // A read started before a local write cannot clear its warning.
            if state.generation == generation {
                state.incomplete = incomplete;
                state.refreshed_at = Some(Instant::now());
            }
        });
        warning
    }

    fn with_write<T>(&self, write: impl FnOnce() -> T) -> T {
        {
            let mut state = self.state.lock().unwrap();
            state.generation += 1;
            state.writers += 1;
            state.refreshed_at = None;
        }
        let _invalidate = scopeguard::guard((), |_| {
            let mut state = self.state.lock().unwrap();
            state.generation += 1;
            state.writers -= 1;
            state.refreshed_at = None;
        });
        write()
    }
}

pub fn support_dir() -> PathBuf {
    crate::utils::dirs::app_home_dir().unwrap_or_else(|_| std::env::temp_dir().join("Tono"))
}

pub fn current_path() -> PathBuf {
    journal_path(&support_dir())
}

pub fn load_pending() -> Option<UpdateHandoffJournal> {
    match load(&current_path()) {
        Ok(journal) => journal,
        Err(error) => {
            logging!(
                warn,
                Type::System,
                "Tono: update journal unavailable; evidence retained: {error}"
            );
            None
        }
    }
}

/// Failed or unreadable/expired evidence must stay visible. Failure to load a
/// journal is not proof that no update is pending; it must not clear the warning.
/// Path resolution, journal locking, disk I/O and parsing run off the caller.
/// Status polls refresh external changes, with at most one read in flight.
pub fn incomplete() -> bool {
    PROJECTION.incomplete_with(|| incomplete_at(&current_path()))
}

fn incomplete_at(path: &Path) -> bool {
    match load(path) {
        Ok(journal) => incomplete_from_phase(journal.map(|journal| journal.phase)),
        Err(_) => true,
    }
}

/// Startup: archive a 0.0.72 journal whose upgrade this build completed.
pub fn retire_completed_legacy_journal(current_app_version: &str) {
    match PROJECTION.with_write(|| update_journal::retire_completed_legacy(&current_path(), current_app_version)) {
        Ok(true) => logging!(info, Type::System, "Tono: completed legacy update journal archived"),
        Ok(false) => {}
        Err(error) => logging!(
            warn,
            Type::System,
            "Tono: legacy update journal not archived; evidence retained: {error}"
        ),
    }
}

pub fn save_prepared(journal: &UpdateHandoffJournal) -> std::io::Result<()> {
    PROJECTION.with_write(|| write_prepared(&current_path(), journal))
}

pub fn record_owner_phase(phase: UpdateHandoffPhase) -> std::io::Result<()> {
    PROJECTION.with_write(|| advance_pending(&current_path(), phase))
}

pub fn begin_first_launch_migration(current_app_version: &str) -> Option<UpdateHandoffJournal> {
    match PROJECTION.with_write(|| record_first_launch_migration(&current_path(), current_app_version)) {
        Ok(Some(journal))
            if journal.phase == UpdateHandoffPhase::FirstLaunchMigration =>
        {
            Some(journal)
        }
        Ok(_) => None,
        Err(error) => {
            logging!(
                warn,
                Type::System,
                "Tono: update migration not recorded; evidence retained: {error}"
            );
            None
        }
    }
}

/// New process: only a verified recovery (or an unprotected first launch that
/// has already migrated) may commit. Persistence failure leaves the file.
pub fn commit_if_verified(current_app_version: &str) -> bool {
    report_commit(PROJECTION.with_write(|| {
        commit_verified_recovery(&current_path(), current_app_version)
    }))
}

/// Account/catalog restoration does not verify a tunnel. It may finish only
/// an update that never required protection, with an affirmative Service
/// observation that no barrier remains. Protected recovery commits in stages.
pub fn commit_after_account_restore(
    current_app_version: &str,
    protection_proven_absent: bool,
) -> bool {
    report_commit(PROJECTION.with_write(|| commit_after_account_restore_at(
        &current_path(),
        current_app_version,
        protection_proven_absent,
    )))
}

fn commit_after_account_restore_at(
    path: &Path,
    current_app_version: &str,
    protection_proven_absent: bool,
) -> std::io::Result<bool> {
    let Some(journal) = load(path)? else {
        return Ok(false);
    };
    if journal.was_connected || journal.keep_kill_switch_armed || !protection_proven_absent {
        return Ok(false);
    }
    commit_verified_recovery(path, current_app_version)
}

fn report_commit(result: std::io::Result<bool>) -> bool {
    match result {
        Ok(committed) => committed,
        Err(error) => {
            logging!(
                warn,
                Type::System,
                "Tono: update commit refused; evidence retained: {error}"
            );
            false
        }
    }
}

pub fn prepare(
    previous: &str,
    next: &str,
    generation: u64,
    was_connected: bool,
    keep_kill_switch: bool,
) -> UpdateHandoffJournal {
    UpdateHandoffJournal::new(previous, next, generation, was_connected, keep_kill_switch)
}

pub use update_journal::{UpdateHandoffJournal as Journal, UpdateHandoffPhase as Phase};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stalled_projection_releases_state_and_never_clears_unknown_evidence() {
        use std::sync::{Arc, Mutex, mpsc};
        use std::time::{Duration, Instant};

        let dir = scopeguard::guard(
            std::env::temp_dir().join(format!("tono-update-projection-{}", nanoid::nanoid!())),
            |path| { let _ = std::fs::remove_dir_all(path); },
        );
        std::fs::create_dir_all(&*dir).unwrap();
        let path = journal_path(&dir);
        let projection = Arc::new(JournalProjection::default());
        let state = Arc::new(Mutex::new(()));
        let (reading, started) = mpsc::channel();
        let (release, stalled) = mpsc::channel();
        let (returned, result) = mpsc::channel();
        let caller = {
            let projection = projection.clone();
            let state = state.clone();
            let path = path.clone();
            std::thread::spawn(move || {
                let _state = state.lock().unwrap();
                let warning = projection.incomplete_with(move || {
                    reading.send(()).unwrap();
                    stalled.recv().unwrap();
                    incomplete_at(&path)
                });
                returned.send(warning).unwrap();
            })
        };
        let budget = Duration::from_secs(10);
        started.recv_timeout(budget).unwrap();
        assert!(result.recv_timeout(budget).unwrap(), "unknown evidence must warn");
        caller.join().unwrap();
        assert!(state.try_lock().is_ok(), "disk I/O must not retain connection state");
        for _ in 0..100 {
            assert!(projection.incomplete_with(|| panic!("duplicate refresh")));
        }

        // A local write must fence the pre-write read, even when it returns clear.
        projection.with_write(|| ());
        release.send(()).unwrap();
        let wait_for_refresh = || {
            let deadline = Instant::now() + budget;
            while projection.state.lock().unwrap().refreshing {
                assert!(Instant::now() < deadline, "refresh did not finish");
                std::thread::yield_now();
            }
        };
        wait_for_refresh();
        assert!(projection.state.lock().unwrap().refreshed_at.is_none());
        assert!(projection.incomplete_with(|| false));
        wait_for_refresh();
        assert!(!projection.incomplete_with(|| panic!("fresh evidence was reread")));

        // External changes are reread even while recent evidence is usable.
        // If that read stalls past the age limit, the old clear result expires.
        std::fs::write(&path, b"corrupt external replacement").unwrap();
        projection.state.lock().unwrap().refreshed_at =
            Some(Instant::now() - JOURNAL_REFRESH_INTERVAL);
        let (release, stalled) = mpsc::channel();
        let external_path = path.clone();
        assert!(!projection.incomplete_with(move || {
            stalled.recv().unwrap();
            incomplete_at(&external_path)
        }));
        projection.state.lock().unwrap().refreshed_at =
            Some(Instant::now() - JOURNAL_MAX_AGE);
        assert!(projection.incomplete_with(|| panic!("duplicate external refresh")));
        release.send(()).unwrap();
        wait_for_refresh();
        assert!(projection.incomplete_with(|| panic!("unreadable evidence was reread")));
        projection.with_write(|| {
            assert!(projection.incomplete_with(|| panic!("read during local write")));
            std::fs::remove_file(&path).unwrap();
        });
        assert!(projection.incomplete_with(move || incomplete_at(&path)));
        wait_for_refresh();
        assert!(!projection.incomplete_with(|| panic!("fresh committed evidence was reread")));
    }

    #[test]
    fn prepare_stays_at_update_prepared() {
        let journal = prepare("0.0.72", "0.0.73", 9, true, true);
        assert_eq!(journal.phase, UpdateHandoffPhase::UpdatePrepared);
        assert_eq!(journal.previous_app_version, "0.0.72");
        assert_eq!(journal.next_app_version, "0.0.73");
        assert!(journal.was_connected);
        assert!(journal.keep_kill_switch_armed);
    }

    #[test]
    fn account_restore_cannot_verify_a_previously_armed_update() {
        let dir = scopeguard::guard(
            std::env::temp_dir().join(format!("tono-update-restore-{}", nanoid::nanoid!())),
            |path| { let _ = std::fs::remove_dir_all(path); },
        );
        let path = journal_path(&dir);
        // Updating from Protected Offline is not Connected, but still needs
        // a freshly verified protected connection before the journal can commit.
        let mut journal = prepare("0.0.72", "0.0.73", 9, false, true);
        journal.phase = UpdateHandoffPhase::ProtectionResuming;
        update_journal::write_atomic(&path, &journal).unwrap();
        let protected = std::fs::read(&path).unwrap();
        assert!(!commit_after_account_restore_at(&path, "0.0.73", true).unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), protected);
        assert!(commit_verified_recovery(&path, "0.0.73").unwrap());
        assert!(!path.exists());

        journal = prepare("0.0.72", "0.0.73", 10, false, false);
        journal.phase = UpdateHandoffPhase::FirstLaunchMigration;
        update_journal::write_atomic(&path, &journal).unwrap();
        let unprotected = std::fs::read(&path).unwrap();
        assert!(!commit_after_account_restore_at(&path, "0.0.73", false).unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), unprotected);
        assert!(commit_after_account_restore_at(&path, "0.0.73", true).unwrap());
        assert!(!path.exists());
    }

    #[test]
    fn unreadable_or_expired_update_evidence_remains_visible_without_being_erased() {
        let dir = scopeguard::guard(
            std::env::temp_dir().join(format!("tono-update-evidence-{}", nanoid::nanoid!())),
            |path| { let _ = std::fs::remove_dir_all(path); },
        );
        std::fs::create_dir_all(&*dir).unwrap();
        let path = journal_path(&dir);
        assert!(!incomplete_at(&path));
        let corrupt = br#"{"phase":"installStarted","truncated": "#;
        std::fs::write(&path, corrupt).unwrap();
        assert!(incomplete_at(&path), "corruption is not proof of no pending update");
        assert_eq!(std::fs::read(&path).unwrap(), corrupt);
        let mut journal = prepare("0.0.72", "0.0.73", 9, true, true);
        journal.phase = UpdateHandoffPhase::InstallStarted;
        journal.expires_at_unix = 1;
        update_journal::write_atomic(&path, &journal).unwrap();
        let expired = std::fs::read(&path).unwrap();
        assert!(incomplete_at(&path));
        assert_eq!(std::fs::read(&path).unwrap(), expired);
        update_journal::write_atomic(&path, &prepare("0.0.72", "0.0.73", 9, true, true)).unwrap();
        assert!(!incomplete_at(&path), "an active valid update is not a failed update");
    }
}
