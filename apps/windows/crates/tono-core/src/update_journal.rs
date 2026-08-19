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

    pub fn advance(&mut self, phase: UpdateHandoffPhase) {
        self.phase = phase;
        self.updated_at_unix = unix_now();
    }

    pub fn is_expired(&self) -> bool {
        unix_now() > self.expires_at_unix
    }
}

pub fn journal_path(app_support: &Path) -> PathBuf {
    app_support.join("update-handoff.json")
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
    fs::rename(temp, path)
}

pub fn load(path: &Path) -> io::Result<Option<UpdateHandoffJournal>> {
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read(path)?;
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
        let _ = fs::remove_file(path);
        return Ok(None);
    }
    Ok(Some(journal))
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
        journal.advance(UpdateHandoffPhase::ProtectedHandoffRecorded);
        write_atomic(&path, &journal).unwrap();
        let loaded = load(&path).unwrap().unwrap();
        assert_eq!(loaded.phase, UpdateHandoffPhase::ProtectedHandoffRecorded);
        let _ = fs::remove_dir_all(dir);
    }
}
