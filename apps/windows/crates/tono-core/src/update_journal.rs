//! Atomic update handoff journal shared by the Windows updater and first launch.

use serde::{Deserialize, Serialize};

mod store;
#[cfg(test)]
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateHandoffPhase {
    Idle,
    UpdatePrepared,
    ConnectionQuiescing,
    CleanShutdownCompleted,
    ProtectedHandoffRecorded,
    InstallStarted,
    FirstLaunchMigration,
    ProtectionResuming,
    Verified,
    Committed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHandoffJournal {
    pub schema_version: u32,
    pub phase: UpdateHandoffPhase,
    pub previous_app_version: String,
    pub next_app_version: String,
    pub core_version: String,
    pub core_sha256: String,
    pub build_commit: String,
    pub helper_protocol_version: String,
    pub was_connected: bool,
    pub keep_kill_switch_armed: bool,
    pub selected_node_anonymous_id: Option<String>,
    pub catalog_revision: Option<i64>,
    pub connection_generation: u64,
    pub created_at_unix: u64,
    pub updated_at_unix: u64,
    pub expires_at_unix: u64,
    pub allow_cached_resume: bool,
    pub last_error_code: Option<String>,
    pub last_error_stage: Option<String>,
}

impl UpdateHandoffJournal {
    pub const SCHEMA_VERSION: u32 = 1;

    pub fn new(
        previous_app_version: impl Into<String>,
        next_app_version: impl Into<String>,
        connection_generation: u64,
        was_connected: bool,
        keep_kill_switch_armed: bool,
    ) -> Self {
        let now = unix_now();
        Self {
            schema_version: Self::SCHEMA_VERSION,
            phase: UpdateHandoffPhase::UpdatePrepared,
            previous_app_version: previous_app_version.into(),
            next_app_version: next_app_version.into(),
            core_version: String::new(),
            core_sha256: String::new(),
            build_commit: String::new(),
            helper_protocol_version: String::new(),
            was_connected,
            keep_kill_switch_armed,
            selected_node_anonymous_id: None,
            catalog_revision: None,
            connection_generation,
            created_at_unix: now,
            updated_at_unix: now,
            expires_at_unix: now + 48 * 60 * 60,
            allow_cached_resume: true,
            last_error_code: None,
            last_error_stage: None,
        }
    }

    pub fn allowed_next(from: UpdateHandoffPhase, to: UpdateHandoffPhase) -> bool {
        use UpdateHandoffPhase::*;
        from == to
            || matches!(
                (from, to),
                (Idle, UpdatePrepared)
                    | (UpdatePrepared, ConnectionQuiescing)
                    | (ConnectionQuiescing, CleanShutdownCompleted)
                    | (CleanShutdownCompleted, ProtectedHandoffRecorded)
                    // A machine that was not protected has no WFP handoff to record.
                    | (CleanShutdownCompleted, InstallStarted)
                    | (ProtectedHandoffRecorded, InstallStarted)
                    | (InstallStarted, FirstLaunchMigration)
                    | (FirstLaunchMigration, ProtectionResuming)
                    // Nothing to resume when the previous process was not protected.
                    | (FirstLaunchMigration, Verified)
                    | (ProtectionResuming, Verified)
                    | (Verified, Committed)
                    | (_, Failed)
            )
    }

    pub fn advance(&mut self, phase: UpdateHandoffPhase) {
        // These two edges exist only for an update that has no matching
        // protection obligation. Phase topology alone cannot authorize them.
        let protection_allows = match (self.phase, phase) {
            (UpdateHandoffPhase::CleanShutdownCompleted, UpdateHandoffPhase::InstallStarted) => {
                !self.keep_kill_switch_armed
            }
            (UpdateHandoffPhase::FirstLaunchMigration, UpdateHandoffPhase::Verified) => {
                !self.was_connected && !self.keep_kill_switch_armed
            }
            _ => true,
        };
        if !Self::allowed_next(self.phase, phase) || !protection_allows {
            self.last_error_code = Some("TONO_JOURNAL_ILLEGAL_PHASE".into());
            self.last_error_stage = Some(format!("{:?}->{:?}", self.phase, phase));
            self.phase = UpdateHandoffPhase::Failed;
        } else {
            self.phase = phase;
        }
        self.updated_at_unix = unix_now();
    }

    pub fn is_expired(&self) -> bool {
        unix_now() > self.expires_at_unix
    }
}

pub fn journal_path(app_support: &Path) -> PathBuf {
    app_support.join("update-handoff.json")
}

/// Start a new attempt without destroying the previous attempt's evidence.
/// Archive raw bytes, not a parsed journal: even corrupt/expired state matters.
/// If archiving or writing fails, preparation fails and the current file stays.
pub fn write_prepared(path: &Path, journal: &UpdateHandoffJournal) -> io::Result<()> {
    let _transaction = store::transaction()?;
    store::write_prepared(path, journal)
}

pub fn write_atomic(path: &Path, journal: &UpdateHandoffJournal) -> io::Result<()> {
    let _transaction = store::transaction()?;
    store::write_atomic(path, journal)
}

pub fn load(path: &Path) -> io::Result<Option<UpdateHandoffJournal>> {
    let _transaction = store::transaction()?;
    store::load(path)
}

/// Persist a real owner's observed transition. An illegal transition records
/// failure, never success; failed evidence is immutable on subsequent attempts.
/// Only a durably saved successful commit permits removal.
pub fn advance_pending(path: &Path, phase: UpdateHandoffPhase) -> io::Result<()> {
    let _transaction = store::transaction()?;
    store::advance_pending(path, phase)
}

/// Record a real failure without pretending a later success happened.
/// An already-failed journal is left byte-for-byte; there is no journal to
/// invent when the file is missing.
pub fn fail_pending(path: &Path, code: &str, stage: &str) -> io::Result<()> {
    let _transaction = store::transaction()?;
    store::fail_pending(path, code, stage)
}

/// Failed journals stay on disk. The customer UI uses this so a later
/// connect cannot treat the update as finished.
pub fn incomplete_from_phase(phase: Option<UpdateHandoffPhase>) -> bool {
    phase == Some(UpdateHandoffPhase::Failed)
}

/// New process after a successful install. Only the binary whose version is
/// the journal's `next_app_version` may enter `FirstLaunchMigration`. An old
/// binary that is still running after `InstallStarted` (installer killed,
/// user cancelled, rollback) records `Failed` and keeps the file.
pub fn record_first_launch_migration(
    path: &Path,
    current_app_version: &str,
) -> io::Result<Option<UpdateHandoffJournal>> {
    let _transaction = store::transaction()?;
    store::record_first_launch_migration(path, current_app_version)
}

/// Installer process entry. Legal from a completed quiesce, a recorded
/// protected handoff, or a retry that is already at `InstallStarted`.
/// Missing file is not an update; do not invent a journal.
pub fn record_install_started(path: &Path) -> io::Result<bool> {
    let _transaction = store::transaction()?;
    store::record_install_started(path)
}

/// Persist Verified then Committed, and only then remove the file.
/// Returns `Ok(false)` when there is no journal, the version does not match,
/// or this process is not the owner of a verified recovery. Persistence
/// failure leaves the file; it never reports commit.
pub fn commit_verified_recovery(path: &Path, current_app_version: &str) -> io::Result<bool> {
    let _transaction = store::transaction()?;
    store::commit_verified_recovery(path, current_app_version)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn protected_update_cannot_take_unprotected_phase_shortcuts() {
        let dir = env::temp_dir().join(format!("tono-protected-phase-{}", uuid::Uuid::new_v4()));
        let path = journal_path(&dir);
        // Protected Offline is not Connected, but still owns a barrier.
        let mut journal = UpdateHandoffJournal::new("0.0.72", "0.0.73", 3, false, true);
        journal.phase = UpdateHandoffPhase::CleanShutdownCompleted;
        write_atomic(&path, &journal).unwrap();
        assert!(record_install_started(&path).is_err(), "a protected install needs the handoff phase");
        assert_eq!(load(&path).unwrap().unwrap().phase, UpdateHandoffPhase::Failed);

        journal.phase = UpdateHandoffPhase::FirstLaunchMigration;
        write_atomic(&path, &journal).unwrap();
        assert!(advance_pending(&path, UpdateHandoffPhase::Verified).is_err(), "protected recovery cannot be skipped");
        let failed = fs::read(&path).unwrap();
        assert!(!commit_verified_recovery(&path, "0.0.73").unwrap());
        assert_eq!(fs::read(&path).unwrap(), failed, "a refused shortcut must retain failure evidence");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn every_phase_round_trips() {
        let mut journal = UpdateHandoffJournal::new("0.0.34", "0.0.35", 3, true, true);
        for phase in [
            UpdateHandoffPhase::UpdatePrepared,
            UpdateHandoffPhase::ConnectionQuiescing,
            UpdateHandoffPhase::CleanShutdownCompleted,
            UpdateHandoffPhase::ProtectedHandoffRecorded,
            UpdateHandoffPhase::InstallStarted,
            UpdateHandoffPhase::FirstLaunchMigration,
            UpdateHandoffPhase::ProtectionResuming,
            UpdateHandoffPhase::Verified,
            UpdateHandoffPhase::Failed,
        ] {
            journal.advance(phase);
            let encoded = serde_json::to_vec(&journal).unwrap();
            let decoded: UpdateHandoffJournal = serde_json::from_slice(&encoded).unwrap();
            assert_eq!(decoded.phase, phase);
            assert_eq!(decoded.previous_app_version, "0.0.34");
            assert_eq!(decoded.next_app_version, "0.0.35");
        }
    }

    #[test]
    fn failed_journal_is_the_only_incomplete_update() {
        assert!(incomplete_from_phase(Some(UpdateHandoffPhase::Failed)));
        assert!(!incomplete_from_phase(None));
        assert!(!incomplete_from_phase(Some(
            UpdateHandoffPhase::InstallStarted
        )));
        assert!(!incomplete_from_phase(Some(
            UpdateHandoffPhase::UpdatePrepared
        )));
    }

    #[test]
    fn atomic_write_and_load() {
        let dir = env::temp_dir().join(format!("tono-journal-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = journal_path(&dir);
        let mut journal = UpdateHandoffJournal::new("0.0.34", "0.0.35", 1, true, true);
        journal.advance(UpdateHandoffPhase::ConnectionQuiescing);
        journal.advance(UpdateHandoffPhase::CleanShutdownCompleted);
        journal.advance(UpdateHandoffPhase::ProtectedHandoffRecorded);
        write_atomic(&path, &journal).unwrap();
        let loaded = load(&path).unwrap().unwrap();
        assert_eq!(loaded.phase, UpdateHandoffPhase::ProtectedHandoffRecorded);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn expired_journal_cannot_resume_and_is_retained() {
        let dir = env::temp_dir().join(format!("tono-journal-exp-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = journal_path(&dir);
        let mut journal = UpdateHandoffJournal::new("0.0.34", "0.0.35", 1, true, true);
        journal.expires_at_unix = 1;
        write_atomic(&path, &journal).unwrap();
        let original = fs::read(&path).unwrap();
        assert_eq!(load(&path).unwrap_err().kind(), io::ErrorKind::InvalidData);
        assert_eq!(fs::read(&path).unwrap(), original);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn skipped_lifecycle_and_repeated_commit_retain_first_failure() {
        let dir = env::temp_dir().join(format!("tono-journal-failed-{}", std::process::id()));
        let path = journal_path(&dir);
        let mut journal = UpdateHandoffJournal::new("old", "new", 1, true, true);
        journal.advance(UpdateHandoffPhase::ConnectionQuiescing);
        write_atomic(&path, &journal).unwrap();
        assert!(advance_pending(&path, UpdateHandoffPhase::FirstLaunchMigration).is_err());
        let failed = load(&path).unwrap().unwrap();
        assert_eq!(failed.phase, UpdateHandoffPhase::Failed);
        assert_eq!(
            failed.last_error_stage.as_deref(),
            Some("ConnectionQuiescing->FirstLaunchMigration")
        );
        let original = fs::read(&path).unwrap();
        for phase in [
            UpdateHandoffPhase::Committed,
            UpdateHandoffPhase::FirstLaunchMigration,
        ] {
            assert!(advance_pending(&path, phase).is_err());
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_verified_commit_can_remove_journal() {
        let dir = env::temp_dir().join(format!("tono-journal-commit-{}", std::process::id()));
        let path = journal_path(&dir);
        let journal = UpdateHandoffJournal::new("old", "new", 1, false, false);
        write_atomic(&path, &journal).unwrap();
        for phase in [
            UpdateHandoffPhase::ConnectionQuiescing,
            UpdateHandoffPhase::CleanShutdownCompleted,
            UpdateHandoffPhase::ProtectedHandoffRecorded,
            UpdateHandoffPhase::InstallStarted,
            UpdateHandoffPhase::FirstLaunchMigration,
            UpdateHandoffPhase::ProtectionResuming,
            UpdateHandoffPhase::Verified,
        ] {
            // At every owner boundary a refused write must retain the previous
            // durable evidence byte-for-byte. Retrying then advances exactly once.
            // This exercises the journal store, not real Service/installer ownership.
            let previous = fs::read(&path).unwrap();
            let refused = store::advance_pending_with(&path, phase, |_, _| {
                Err(io::Error::from(io::ErrorKind::StorageFull))
            });
            assert_eq!(refused.unwrap_err().kind(), io::ErrorKind::StorageFull);
            assert_eq!(fs::read(&path).unwrap(), previous);
            advance_pending(&path, phase).unwrap();
            assert_eq!(load(&path).unwrap().unwrap().phase, phase);
        }
        // Inject the failed save, not a particular scratch filename. Writers
        // now own unique scratch paths, and chmod is not reliable under root.
        assert!(store::advance_pending_with(
            &path,
            UpdateHandoffPhase::Committed,
            |_, _| Err(io::Error::from(io::ErrorKind::StorageFull)),
        ).is_err());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::Verified
        );
        advance_pending(&path, UpdateHandoffPhase::Committed).unwrap();
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unverified_commit_and_unreadable_journals_never_disappear() {
        let dir = env::temp_dir().join(format!("tono-journal-invalid-{}", std::process::id()));
        let path = journal_path(&dir);
        let journal = UpdateHandoffJournal::new("old", "new", 1, false, false);
        write_atomic(&path, &journal).unwrap();
        assert!(advance_pending(&path, UpdateHandoffPhase::Committed).is_err());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::Failed
        );
        for payload in [b"not JSON".as_slice(), b"{\"schemaVersion\":99}"] {
            fs::write(&path, payload).unwrap();
            assert!(advance_pending(&path, UpdateHandoffPhase::Committed).is_err());
            assert_eq!(fs::read(&path).unwrap(), payload);
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn new_attempt_preserves_failed_expired_and_corrupt_history() {
        let dir = env::temp_dir().join(format!("tono-journal-history-{}", std::process::id()));
        let path = journal_path(&dir);
        let mut journal = UpdateHandoffJournal::new("old", "new", 1, true, true);
        write_prepared(&path, &journal).unwrap();
        assert!(!path.with_extension("history").exists());
        journal.phase = UpdateHandoffPhase::Failed;
        journal.last_error_code = Some("original failure".into());
        journal.expires_at_unix = 1;
        write_atomic(&path, &journal).unwrap();
        let failed = fs::read(&path).unwrap();
        let next = UpdateHandoffJournal::new("new", "next", 2, false, false);
        write_prepared(&path, &next).unwrap();
        assert_eq!(load(&path).unwrap().unwrap(), next);
        fs::write(&path, b"corrupt evidence").unwrap();
        write_prepared(&path, &next).unwrap();
        let archives: Vec<_> = fs::read_dir(path.with_extension("history"))
            .unwrap()
            .map(|entry| fs::read(entry.unwrap().path()).unwrap())
            .collect();
        assert_eq!(archives.len(), 2);
        assert!(archives.contains(&failed));
        assert!(archives.contains(&b"corrupt evidence".to_vec()));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn preparation_failure_never_overwrites_current_evidence() {
        let dir = env::temp_dir().join(format!("tono-journal-history-fail-{}", std::process::id()));
        let path = journal_path(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, b"original evidence").unwrap();
        let next = UpdateHandoffJournal::new("new", "next", 2, false, false);
        // Occupy the archive-directory name to force archiving to fail.
        fs::write(path.with_extension("history"), b"not a directory").unwrap();
        assert!(write_prepared(&path, &next).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original evidence");
        fs::remove_file(path.with_extension("history")).unwrap();
        // Archiving succeeds but saving the new current attempt fails.
        assert!(store::write_prepared_with(
            &path,
            &next,
            |_, _| Err(io::Error::from(io::ErrorKind::StorageFull)),
        ).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original evidence");
        let archive = fs::read_dir(path.with_extension("history"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap();
        assert_eq!(fs::read(archive.path()).unwrap(), b"original evidence");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn illegal_phase_becomes_failed() {
        let mut journal = UpdateHandoffJournal::new("0.0.34", "0.0.35", 1, true, true);
        journal.advance(UpdateHandoffPhase::Verified);
        assert_eq!(journal.phase, UpdateHandoffPhase::Failed);
        assert_eq!(
            journal.last_error_code.as_deref(),
            Some("TONO_JOURNAL_ILLEGAL_PHASE")
        );
    }

    #[test]
    fn first_launch_reentry_preserves_durable_recovery_progress() {
        let dir = env::temp_dir().join(format!("tono-journal-reentry-{}", std::process::id()));
        let path = journal_path(&dir);
        let mut journal = UpdateHandoffJournal::new("0.0.72", "0.0.73", 7, true, true);
        journal.phase = UpdateHandoffPhase::InstallStarted;
        write_atomic(&path, &journal).unwrap();
        record_first_launch_migration(&path, "0.0.73").unwrap();
        advance_pending(&path, UpdateHandoffPhase::ProtectionResuming).unwrap();

        // Account restore can be retried, or the new process can crash before
        // verifying its connection. Re-entry is not a backwards transition.
        let resuming = fs::read(&path).unwrap();
        let resumed = record_first_launch_migration(&path, "0.0.73")
            .unwrap()
            .unwrap();
        assert_eq!(resumed.phase, UpdateHandoffPhase::ProtectionResuming);
        assert_eq!(fs::read(&path).unwrap(), resuming);
        assert!(resumed.keep_kill_switch_armed);

        // A crash after the verifier's durable write must also retain evidence;
        // only the separate commit owner can remove it.
        advance_pending(&path, UpdateHandoffPhase::Verified).unwrap();
        let verified = fs::read(&path).unwrap();
        assert_eq!(
            record_first_launch_migration(&path, "0.0.73")
                .unwrap()
                .unwrap()
                .phase,
            UpdateHandoffPhase::Verified
        );
        assert_eq!(fs::read(&path).unwrap(), verified);

        // Preserving progress must never authorize the predecessor binary.
        let wrong = record_first_launch_migration(&path, "0.0.72")
            .unwrap()
            .unwrap();
        assert_eq!(wrong.phase, UpdateHandoffPhase::Failed);
        assert_eq!(
            wrong.last_error_code.as_deref(),
            Some("TONO_UPDATE_INSTALL_ABORTED")
        );
        assert!(!commit_verified_recovery(&path, "0.0.73").unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    const PROTECTED_OWNERS: [UpdateHandoffPhase; 7] = [
        UpdateHandoffPhase::ConnectionQuiescing,
        UpdateHandoffPhase::CleanShutdownCompleted,
        UpdateHandoffPhase::ProtectedHandoffRecorded,
        UpdateHandoffPhase::InstallStarted,
        UpdateHandoffPhase::FirstLaunchMigration,
        UpdateHandoffPhase::ProtectionResuming,
        UpdateHandoffPhase::Verified,
    ];

    #[test]
    fn owner_replay_advances_in_order_and_crash_at_each_phase_never_commits() {
        for (crash_after, stopped_at) in PROTECTED_OWNERS.iter().copied().enumerate() {
            let dir = env::temp_dir().join(format!(
                "tono-journal-crash-{}-{}",
                std::process::id(),
                crash_after
            ));
            let path = journal_path(&dir);
            write_atomic(
                &path,
                &UpdateHandoffJournal::new("0.0.72", "0.0.73", 4, true, true),
            )
            .unwrap();
            for phase in PROTECTED_OWNERS.iter().copied().take(crash_after + 1) {
                advance_pending(&path, phase).unwrap();
            }
            assert_eq!(load(&path).unwrap().unwrap().phase, stopped_at);
            assert!(path.exists());
            if stopped_at != UpdateHandoffPhase::Verified {
                // A crashed owner must not let a later commit skip Verified.
                assert!(advance_pending(&path, UpdateHandoffPhase::Committed).is_err());
                assert_eq!(
                    load(&path).unwrap().unwrap().phase,
                    UpdateHandoffPhase::Failed
                );
                assert!(path.exists());
            }
            fs::remove_dir_all(&dir).unwrap();
        }
        let dir = env::temp_dir().join(format!("tono-journal-owners-ok-{}", std::process::id()));
        let path = journal_path(&dir);
        write_atomic(
            &path,
            &UpdateHandoffJournal::new("0.0.72", "0.0.73", 4, true, true),
        )
        .unwrap();
        for phase in PROTECTED_OWNERS {
            advance_pending(&path, phase).unwrap();
            assert_eq!(load(&path).unwrap().unwrap().phase, phase);
        }
        assert!(commit_verified_recovery(&path, "0.0.73").unwrap());
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unprotected_first_launch_commits_only_after_verified() {
        let dir = env::temp_dir().join(format!("tono-journal-unprot-{}", std::process::id()));
        let path = journal_path(&dir);
        write_atomic(
            &path,
            &UpdateHandoffJournal::new("0.0.72", "0.0.73", 1, false, false),
        )
        .unwrap();
        for phase in [
            UpdateHandoffPhase::ConnectionQuiescing,
            UpdateHandoffPhase::CleanShutdownCompleted,
            UpdateHandoffPhase::InstallStarted,
            UpdateHandoffPhase::FirstLaunchMigration,
        ] {
            advance_pending(&path, phase).unwrap();
            assert!(!commit_verified_recovery(&path, "0.0.72").unwrap());
            assert_eq!(load(&path).unwrap().unwrap().phase, phase);
        }
        assert!(commit_verified_recovery(&path, "0.0.73").unwrap());
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn commit_verified_recovery_rejects_wrong_version_and_failed_journal() {
        let dir = env::temp_dir().join(format!("tono-journal-cvr-{}", std::process::id()));
        let path = journal_path(&dir);
        let mut journal = UpdateHandoffJournal::new("0.0.72", "0.0.73", 1, true, true);
        journal.advance(UpdateHandoffPhase::ConnectionQuiescing);
        journal.advance(UpdateHandoffPhase::CleanShutdownCompleted);
        journal.advance(UpdateHandoffPhase::ProtectedHandoffRecorded);
        journal.advance(UpdateHandoffPhase::InstallStarted);
        journal.advance(UpdateHandoffPhase::FirstLaunchMigration);
        journal.advance(UpdateHandoffPhase::ProtectionResuming);
        write_atomic(&path, &journal).unwrap();
        assert!(!commit_verified_recovery(&path, "0.0.72").unwrap());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::ProtectionResuming
        );
        journal.advance(UpdateHandoffPhase::Failed);
        write_atomic(&path, &journal).unwrap();
        assert!(!commit_verified_recovery(&path, "0.0.73").unwrap());
        assert_eq!(load(&path).unwrap().unwrap().phase, UpdateHandoffPhase::Failed);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn old_binary_after_install_started_fails_and_keeps_the_file() {
        let dir = env::temp_dir().join(format!("tono-journal-oldbin-{}", std::process::id()));
        let path = journal_path(&dir);
        let mut journal = UpdateHandoffJournal::new("0.0.72", "0.0.73", 1, true, true);
        journal.advance(UpdateHandoffPhase::ConnectionQuiescing);
        journal.advance(UpdateHandoffPhase::CleanShutdownCompleted);
        journal.advance(UpdateHandoffPhase::ProtectedHandoffRecorded);
        write_atomic(&path, &journal).unwrap();
        assert!(record_install_started(&path).unwrap());
        let loaded = record_first_launch_migration(&path, "0.0.72").unwrap().unwrap();
        assert_eq!(loaded.phase, UpdateHandoffPhase::Failed);
        assert_eq!(
            loaded.last_error_code.as_deref(),
            Some("TONO_UPDATE_INSTALL_ABORTED")
        );
        assert!(path.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn new_binary_records_first_launch_only_from_install_started() {
        let dir = env::temp_dir().join(format!("tono-journal-newbin-{}", std::process::id()));
        let path = journal_path(&dir);
        write_atomic(
            &path,
            &UpdateHandoffJournal::new("0.0.72", "0.0.73", 1, true, true),
        )
        .unwrap();
        assert!(!record_install_started(&path).unwrap());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::Failed
        );
        fs::remove_dir_all(&dir).unwrap();

        let path = journal_path(&dir);
        let mut journal = UpdateHandoffJournal::new("0.0.72", "0.0.73", 1, true, true);
        journal.advance(UpdateHandoffPhase::ConnectionQuiescing);
        journal.advance(UpdateHandoffPhase::CleanShutdownCompleted);
        journal.advance(UpdateHandoffPhase::ProtectedHandoffRecorded);
        write_atomic(&path, &journal).unwrap();
        assert!(record_install_started(&path).unwrap());
        assert!(record_install_started(&path).unwrap());
        let launched = record_first_launch_migration(&path, "0.0.73")
            .unwrap()
            .unwrap();
        assert_eq!(launched.phase, UpdateHandoffPhase::FirstLaunchMigration);
        fs::remove_dir_all(dir).unwrap();
    }

    /// G3.1: App prepare → installer `--replace-runtime` → new process →
    /// verified, using the owner APIs those processes call. A crash after
    /// any earlier owner must not let `commit_verified_recovery` delete the file.
    #[test]
    fn prepare_installer_new_process_verified_crash_between_owners_never_commits() {
        let dir = env::temp_dir().join(format!(
            "tono-journal-owners-api-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        let path = journal_path(&dir);
        write_prepared(
            &path,
            &UpdateHandoffJournal::new("0.0.72", "0.0.73", 4, true, true),
        )
        .unwrap();
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::UpdatePrepared
        );
        assert!(!commit_verified_recovery(&path, "0.0.73").unwrap());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::UpdatePrepared
        );

        for phase in [
            UpdateHandoffPhase::ConnectionQuiescing,
            UpdateHandoffPhase::CleanShutdownCompleted,
            UpdateHandoffPhase::ProtectedHandoffRecorded,
        ] {
            advance_pending(&path, phase).unwrap();
            assert_eq!(load(&path).unwrap().unwrap().phase, phase);
            assert!(!commit_verified_recovery(&path, "0.0.73").unwrap());
            assert_eq!(load(&path).unwrap().unwrap().phase, phase);
            assert!(path.exists());
        }

        assert!(record_install_started(&path).unwrap());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::InstallStarted
        );
        assert!(!commit_verified_recovery(&path, "0.0.73").unwrap());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::InstallStarted
        );

        let launched = record_first_launch_migration(&path, "0.0.73")
            .unwrap()
            .unwrap();
        assert_eq!(launched.phase, UpdateHandoffPhase::FirstLaunchMigration);
        assert!(!commit_verified_recovery(&path, "0.0.73").unwrap());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::FirstLaunchMigration
        );

        advance_pending(&path, UpdateHandoffPhase::ProtectionResuming).unwrap();
        assert!(commit_verified_recovery(&path, "0.0.73").unwrap());
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
