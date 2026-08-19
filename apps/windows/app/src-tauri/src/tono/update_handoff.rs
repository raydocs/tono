//! Windows update handoff journal. Compatible with the macOS contract.

use std::path::PathBuf;

use tono_core::update_journal::{
    self, UpdateHandoffJournal, UpdateHandoffPhase, journal_path, load, write_atomic,
};

pub fn support_dir() -> PathBuf {
    crate::utils::dirs::app_home_dir().unwrap_or_else(|_| std::env::temp_dir().join("Tono"))
}

pub fn current_path() -> PathBuf {
    journal_path(&support_dir())
}

pub fn load_pending() -> Option<UpdateHandoffJournal> {
    load(&current_path()).ok().flatten()
}

pub fn save(journal: &UpdateHandoffJournal) -> std::io::Result<()> {
    write_atomic(&current_path(), journal)
}

pub fn begin_first_launch_migration() -> Option<UpdateHandoffJournal> {
    let mut journal = load_pending()?;
    journal.advance(UpdateHandoffPhase::FirstLaunchMigration);
    let _ = save(&journal);
    Some(journal)
}

pub fn mark_committed() {
    if let Some(mut journal) = load_pending() {
        journal.advance(UpdateHandoffPhase::Committed);
        let _ = save(&journal);
        let _ = std::fs::remove_file(current_path());
    }
}

pub fn prepare(
    previous: &str,
    next: &str,
    generation: u64,
    was_connected: bool,
    keep_kill_switch: bool,
) -> UpdateHandoffJournal {
    let mut journal = UpdateHandoffJournal::new(
        previous,
        next,
        generation,
        was_connected,
        keep_kill_switch,
    );
    journal.advance(UpdateHandoffPhase::ConnectionQuiescing);
    let _ = save(&journal);
    journal
}

pub use update_journal::{UpdateHandoffJournal as Journal, UpdateHandoffPhase as Phase};
