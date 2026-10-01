//! Installer-side update evidence. This is validation, NOT authenticated handoff identity.
//! The initiating owner/package binding still needs a Service-owned receipt (#26).
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Deserialize;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

// NSIS must not automatically retry a refusal after Failed evidence was saved.
// Keep in sync with the installer template; the test checks both value and branch.
pub(super) const JOURNAL_GATE_REJECTED_EXIT_CODE: i32 = 76;

const MAX_JOURNAL_BYTES: u64 = 64 * 1024;
static SCRATCH_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

// Required wire fields mirror tono-core::update_journal without pulling its separate
// workspace into the privileged service. Deserializing checks even the unused fields;
// mutation uses the original JSON object so optional/future metadata is not discarded.
#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
    schema_version: u32,
    phase: Phase,
    previous_app_version: String,
    next_app_version: String,
    core_version: String,
    core_sha256: String,
    build_commit: String,
    helper_protocol_version: String,
    was_connected: bool,
    keep_kill_switch_armed: bool,
    selected_node_anonymous_id: Option<String>,
    catalog_revision: Option<i64>,
    connection_generation: u64,
    created_at_unix: u64,
    updated_at_unix: u64,
    expires_at_unix: u64,
    allow_cached_resume: bool,
    last_error_code: Option<String>,
    last_error_stage: Option<String>,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum Phase {
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

struct Pending {
    journal: Journal,
    value: Value,
}

fn read_pending(path: &Path, now: u64) -> io::Result<Option<Pending>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !metadata.file_type().is_file() {
        return Err(invalid("update journal is not an ordinary file"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(invalid("update journal is a reparse point"));
        }
    }
    let mut data = Vec::new();
    fs::File::open(path)?
        .take(MAX_JOURNAL_BYTES + 1)
        .read_to_end(&mut data)?;
    if data.len() as u64 > MAX_JOURNAL_BYTES {
        return Err(invalid("update journal exceeds the size limit"));
    }
    let journal: Journal =
        serde_json::from_slice(&data).map_err(|error| invalid(error.to_string()))?;
    if journal.schema_version != 1 {
        return Err(invalid("unsupported update journal schema"));
    }
    // A failed attempt is evidence, not authority to resume. Keep it (even when
    // old) without promoting it or preventing a manual repair with no pending update.
    if matches!(
        journal.phase,
        Phase::Idle | Phase::Committed | Phase::Failed
    ) {
        return Ok(None);
    }
    if journal.previous_app_version.trim().is_empty() || journal.next_app_version.trim().is_empty()
    {
        return Err(invalid("update journal has no source/target version"));
    }
    if now > journal.expires_at_unix {
        return Err(invalid("update journal expired"));
    }
    if journal.created_at_unix > journal.updated_at_unix
        || journal.updated_at_unix > now
        || journal.updated_at_unix > journal.expires_at_unix
    {
        return Err(invalid("update journal timestamps are inconsistent"));
    }
    let value = serde_json::from_slice(&data).map_err(|error| invalid(error.to_string()))?;
    Ok(Some(Pending { journal, value }))
}

pub(super) fn write_update_handoff_atomic(path: &Path, value: &Value) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = serde_json::to_vec_pretty(value).map_err(|error| invalid(error.to_string()))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    let temp = path.with_extension(format!(
        "json.tmp-{}-{stamp}-{}",
        std::process::id(),
        SCRATCH_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    // Exclusive creation is the security property, not the name's unpredictability.
    // Never truncate/follow an existing scratch file, hardlink or symlink. Failed
    // scratch files remain evidence; a later attempt uses a different name.
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(&payload)?;
        file.sync_all()?;
    }
    #[cfg(windows)]
    super::publish_staged_binary_immediately(&temp, path)?; // replace + WRITE_THROUGH, no reboot deferral
    #[cfg(not(windows))]
    {
        fs::rename(&temp, path)?;
        if let Some(parent) = path.parent() {
            fs::File::open(parent)?.sync_all()?;
        }
    }
    Ok(())
}

pub(super) fn record_install_started_for_paths(paths: &[PathBuf]) -> io::Result<()> {
    record_with_writer(paths, write_update_handoff_atomic).map(|_| ())
}

#[cfg(test)]
pub(super) fn record_install_started_on_journal(path: &Path) -> io::Result<bool> {
    record_with_writer(&[path.to_owned()], write_update_handoff_atomic)
}

fn record_with_writer(
    paths: &[PathBuf],
    save: impl FnOnce(&Path, &Value) -> io::Result<()>,
) -> io::Result<bool> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_secs();
    let mut pending = None;
    let mut seen = Vec::new();
    // Preflight all candidates before writing any. Discovery is still legacy, not
    // owner authentication: ambiguity/unreadable evidence must stop, not mark several
    // users as having begun this install. Missing/terminal files are not new attempts.
    for path in paths {
        let candidate = read_pending(path, now).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("update journal {}: {error}", path.display()),
            )
        })?;
        if let Some(candidate) = candidate {
            let canonical = fs::canonicalize(path)?;
            if seen.contains(&canonical) {
                continue;
            }
            seen.push(canonical);
            if pending.is_some() {
                return Err(invalid(
                    "multiple pending update journals; refusing an ambiguous installer handoff",
                ));
            }
            pending = Some((path, candidate));
        }
    }
    let Some((path, mut pending)) = pending else {
        return Ok(false);
    };
    // Validate schema/expiry even on the supposedly idempotent retry path.
    if pending.journal.phase == Phase::InstallStarted {
        return Ok(true);
    }
    let can_start = pending.journal.phase == Phase::ProtectedHandoffRecorded
        || (pending.journal.phase == Phase::CleanShutdownCompleted
            && !pending.journal.keep_kill_switch_armed);
    let previous = pending.value["phase"].as_str().unwrap_or("").to_owned();
    pending.value["updatedAtUnix"] = now.into();
    if can_start {
        pending.value["phase"] = "installStarted".into();
    } else {
        pending.value["phase"] = "failed".into();
        pending.value["lastErrorCode"] = "TONO_JOURNAL_ILLEGAL_PHASE".into();
        pending.value["lastErrorStage"] = format!("{previous}->installStarted").into();
    }
    save(path, &pending.value)?;
    if !can_start {
        return Err(invalid(
            "update journal cannot enter InstallStarted from this phase/protection state",
        ));
    }
    eprintln!(
        "tono-install: recorded update journal InstallStarted at {}",
        path.display()
    );
    Ok(true)
}

#[cfg(test)]
#[path = "update_journal_tests.rs"]
mod tests;
