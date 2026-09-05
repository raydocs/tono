//! Windows update handoff journal. Compatible with the macOS contract.

use std::path::PathBuf;

use tono_core::update_journal::{
    self, UpdateHandoffJournal, UpdateHandoffPhase, advance_pending, journal_path, load, write_prepared,
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

pub fn save_prepared(journal: &UpdateHandoffJournal) -> std::io::Result<()> {
    write_prepared(&current_path(), journal)
}

pub fn begin_first_launch_migration() -> Option<UpdateHandoffJournal> {
    if let Err(error) = advance_pending(&current_path(), UpdateHandoffPhase::FirstLaunchMigration) {
        logging!(
            warn,
            Type::System,
            "Tono: update migration not recorded; evidence retained: {error}"
        );
        return None;
    }
    load_pending()
}

pub fn mark_committed() {
    if let Err(error) = advance_pending(&current_path(), UpdateHandoffPhase::Committed) {
        logging!(
            warn,
            Type::System,
            "Tono: update commit refused; evidence retained: {error}"
        );
    }
}

pub fn prepare(
    previous: &str,
    next: &str,
    generation: u64,
    was_connected: bool,
    keep_kill_switch: bool,
) -> UpdateHandoffJournal {
    let mut journal = UpdateHandoffJournal::new(previous, next, generation, was_connected, keep_kill_switch);
    journal.advance(UpdateHandoffPhase::ConnectionQuiescing);
    // The command fills in metadata before the single fallible save_prepared.
    journal
}

pub use update_journal::{UpdateHandoffJournal as Journal, UpdateHandoffPhase as Phase};
