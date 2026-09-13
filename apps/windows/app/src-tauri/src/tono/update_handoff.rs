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

use std::path::{Path, PathBuf};

use tono_core::update_journal::{
    self, UpdateHandoffJournal, UpdateHandoffPhase, advance_pending, commit_verified_recovery,
    incomplete_from_phase, journal_path, load, record_first_launch_migration, write_prepared,
};
use tono_logging::{Type, logging};

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
pub fn incomplete() -> bool {
    incomplete_at(&current_path())
}

fn incomplete_at(path: &Path) -> bool {
    match load(path) {
        Ok(journal) => incomplete_from_phase(journal.map(|journal| journal.phase)),
        Err(_) => true,
    }
}

pub fn save_prepared(journal: &UpdateHandoffJournal) -> std::io::Result<()> {
    write_prepared(&current_path(), journal)
}

pub fn record_owner_phase(phase: UpdateHandoffPhase) -> std::io::Result<()> {
    advance_pending(&current_path(), phase)
}

pub fn begin_first_launch_migration(current_app_version: &str) -> Option<UpdateHandoffJournal> {
    match record_first_launch_migration(&current_path(), current_app_version) {
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
    match commit_verified_recovery(&current_path(), current_app_version) {
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
    fn prepare_stays_at_update_prepared() {
        let journal = prepare("0.0.72", "0.0.73", 9, true, true);
        assert_eq!(journal.phase, UpdateHandoffPhase::UpdatePrepared);
        assert_eq!(journal.previous_app_version, "0.0.72");
        assert_eq!(journal.next_app_version, "0.0.73");
        assert!(journal.was_connected);
        assert!(journal.keep_kill_switch_armed);
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
