//! Atomic update handoff journal shared by the Windows updater and first launch.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
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
                    | (ProtectedHandoffRecorded, InstallStarted)
                    | (InstallStarted, FirstLaunchMigration)
                    | (FirstLaunchMigration, ProtectionResuming)
                    | (ProtectionResuming, Verified)
                    | (Verified, Committed)
                    | (_, Failed)
            )
    }

    pub fn advance(&mut self, phase: UpdateHandoffPhase) {
        if !Self::allowed_next(self.phase, phase) {
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
    match fs::File::open(path) {
        Ok(mut previous) => {
            let history = path.with_extension("history");
            fs::create_dir_all(&history)?;
            let archive_path = history.join(format!("{}.json", uuid::Uuid::new_v4()));
            let mut archive = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(archive_path)?;
            io::copy(&mut previous, &mut archive)?;
            archive.sync_all()?;
            if let Ok(directory) = fs::File::open(&history) {
                let _ = directory.sync_all();
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    write_atomic(path, journal)
}

pub fn write_atomic(path: &Path, journal: &UpdateHandoffJournal) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = serde_json::to_vec_pretty(journal)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let temp = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(&payload)?;
        file.sync_all()?;
    }
    fs::rename(&temp, path)?;
    // Best-effort directory fsync so the rename itself is durable after a crash
    // during update handoff. Failure here must not undo a successful write.
    if let Some(parent) = path.parent() {
        if let Ok(dir_handle) = fs::File::open(parent) {
            let _ = dir_handle.sync_all();
        }
    }
    Ok(())
}

pub fn load(path: &Path) -> io::Result<Option<UpdateHandoffJournal>> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let journal: UpdateHandoffJournal = serde_json::from_slice(&data)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if journal.schema_version != UpdateHandoffJournal::SCHEMA_VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unsupported update journal schema",
        ));
    }
    if matches!(
        journal.phase,
        UpdateHandoffPhase::Committed | UpdateHandoffPhase::Idle
    ) {
        fs::remove_file(path)?;
        return Ok(None);
    }
    if journal.is_expired() {
        // Expiry forbids resume, but does not prove that recovery succeeded.
        // Keep the original bytes available for diagnosis, including Failed.
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "update journal expired",
        ));
    }
    Ok(Some(journal))
}

/// Persist a real owner's observed transition. An illegal transition records
/// failure, never success; failed evidence is immutable on subsequent attempts.
/// Only a durably saved successful commit permits removal.
pub fn advance_pending(path: &Path, phase: UpdateHandoffPhase) -> io::Result<()> {
    let Some(mut journal) = load(path)? else {
        return Ok(());
    };
    if journal.phase == UpdateHandoffPhase::Failed {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "update journal failed",
        ));
    }
    journal.advance(phase);
    write_atomic(path, &journal)?;
    if journal.phase == UpdateHandoffPhase::Failed {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "illegal update journal phase",
        ));
    }
    if journal.phase == UpdateHandoffPhase::Committed {
        fs::remove_file(path)?;
    }
    Ok(())
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
            advance_pending(&path, phase).unwrap();
            assert_eq!(load(&path).unwrap().unwrap().phase, phase);
        }
        // Inject a persistence failure without relying on root-sensitive chmod.
        fs::create_dir(path.with_extension("json.tmp")).unwrap();
        assert!(advance_pending(&path, UpdateHandoffPhase::Committed).is_err());
        assert_eq!(
            load(&path).unwrap().unwrap().phase,
            UpdateHandoffPhase::Verified
        );
        fs::remove_dir(path.with_extension("json.tmp")).unwrap();
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
        fs::create_dir(path.with_extension("json.tmp")).unwrap();
        assert!(write_prepared(&path, &next).is_err());
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
}
