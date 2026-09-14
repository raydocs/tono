//! Filesystem operations for one process's update journal transactions.
//!
//! Every public entry in the parent acquires TRANSACTION once; calls between
//! these private helpers are already inside it. Never acquire another lock or
//! await Service/App state here. This is NOT an authenticated cross-process
//! handoff: the install helper and old/new processes still need #26's owner
//! and package binding. Unique scratch files also isolate those processes'
//! byte publication, but do not authorize their phase ordering.

use super::{UpdateHandoffJournal, UpdateHandoffPhase, unix_now};
use std::{
    fs,
    io::{self, Write},
    path::Path,
    sync::{Mutex, MutexGuard},
};

// There is one production journal. A process-local lock also covers reads
// that remove Committed/Idle evidence and complete read/advance/write/remove
// transactions, rather than merely serializing the final rename.
static TRANSACTION: Mutex<()> = Mutex::new(());

pub(super) fn transaction() -> io::Result<MutexGuard<'static, ()>> {
    TRANSACTION
        .lock()
        .map_err(|_| io::Error::other("update journal transaction poisoned"))
}

pub(super) fn write_prepared(path: &Path, journal: &UpdateHandoffJournal) -> io::Result<()> {
    write_prepared_with(path, journal, write_atomic)
}

pub(super) fn write_prepared_with(
    path: &Path,
    journal: &UpdateHandoffJournal,
    write: impl FnOnce(&Path, &UpdateHandoffJournal) -> io::Result<()>,
) -> io::Result<()> {
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
    write(path, journal)
}

pub(super) fn write_atomic(path: &Path, journal: &UpdateHandoffJournal) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = serde_json::to_vec_pretty(journal)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    // Each writer owns a different inode, including another process which
    // cannot share TRANSACTION. An old scratch path may be evidence or a link
    // to an unrelated file: never open/truncate or clean it up by convention.
    let temp = path.with_extension(format!("json.tmp-{}", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp)?;
    let written = file.write_all(&payload).and_then(|()| file.sync_all());
    // In particular, release the Windows file handle before replacement.
    drop(file);
    let published = written.and_then(|()| fs::rename(&temp, path));
    if published.is_err() {
        // Remove only the scratch file this call exclusively created. The
        // previous durable journal is never deleted to make replacement work.
        let _ = fs::remove_file(&temp);
    }
    published?;
    // Best-effort directory fsync so the rename itself is durable after a crash
    // during update handoff. Failure here must not undo a successful write.
    if let Some(parent) = path.parent() {
        if let Ok(dir_handle) = fs::File::open(parent) {
            let _ = dir_handle.sync_all();
        }
    }
    Ok(())
}

pub(super) fn load(path: &Path) -> io::Result<Option<UpdateHandoffJournal>> {
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

pub(super) fn advance_pending(path: &Path, phase: UpdateHandoffPhase) -> io::Result<()> {
    advance_pending_with(path, phase, write_atomic)
}

pub(super) fn advance_pending_with(
    path: &Path,
    phase: UpdateHandoffPhase,
    write: impl FnOnce(&Path, &UpdateHandoffJournal) -> io::Result<()>,
) -> io::Result<()> {
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
    write(path, &journal)?;
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

pub(super) fn fail_pending(path: &Path, code: &str, stage: &str) -> io::Result<()> {
    let Some(mut journal) = load(path)? else {
        return Ok(());
    };
    if journal.phase == UpdateHandoffPhase::Failed {
        return Ok(());
    }
    journal.last_error_code = Some(code.into());
    journal.last_error_stage = Some(stage.into());
    journal.phase = UpdateHandoffPhase::Failed;
    journal.updated_at_unix = unix_now();
    write_atomic(path, &journal)
}

pub(super) fn record_first_launch_migration(
    path: &Path,
    current_app_version: &str,
) -> io::Result<Option<UpdateHandoffJournal>> {
    let Some(journal) = load(path)? else {
        return Ok(None);
    };
    if journal.phase == UpdateHandoffPhase::Failed {
        return Ok(Some(journal));
    }
    if journal.next_app_version != current_app_version {
        fail_pending(
            path,
            "TONO_UPDATE_INSTALL_ABORTED",
            &format!("{:?}->FirstLaunchMigration", journal.phase),
        )?;
        return load(path);
    }
    // Startup/account restore may re-enter after a crash or retry. These phases
    // already contain first-launch evidence; retain it rather than requesting
    // an illegal backwards hop. Version validation above still applies, and
    // this read-only path neither verifies a connection nor commits the update.
    if matches!(
        journal.phase,
        UpdateHandoffPhase::FirstLaunchMigration
            | UpdateHandoffPhase::ProtectionResuming
            | UpdateHandoffPhase::Verified
    ) {
        return Ok(Some(journal));
    }
    advance_pending(path, UpdateHandoffPhase::FirstLaunchMigration)?;
    load(path)
}

pub(super) fn record_install_started(path: &Path) -> io::Result<bool> {
    let Some(journal) = load(path)? else {
        return Ok(false);
    };
    match journal.phase {
        UpdateHandoffPhase::InstallStarted => Ok(true),
        UpdateHandoffPhase::CleanShutdownCompleted
        | UpdateHandoffPhase::ProtectedHandoffRecorded => {
            advance_pending(path, UpdateHandoffPhase::InstallStarted)?;
            Ok(true)
        }
        UpdateHandoffPhase::Failed => Ok(false),
        other => {
            fail_pending(
                path,
                "TONO_JOURNAL_ILLEGAL_PHASE",
                &format!("{other:?}->InstallStarted"),
            )?;
            Ok(false)
        }
    }
}

pub(super) fn commit_verified_recovery(path: &Path, current_app_version: &str) -> io::Result<bool> {
    let Some(journal) = load(path)? else {
        return Ok(false);
    };
    if journal.next_app_version != current_app_version {
        return Ok(false);
    }
    let unprotected_first_launch = journal.phase == UpdateHandoffPhase::FirstLaunchMigration
        && !journal.was_connected
        && !journal.keep_kill_switch_armed;
    let can_commit = matches!(
        journal.phase,
        UpdateHandoffPhase::ProtectionResuming | UpdateHandoffPhase::Verified
    ) || unprotected_first_launch;
    if !can_commit {
        return Ok(false);
    }
    if journal.phase != UpdateHandoffPhase::Verified {
        advance_pending(path, UpdateHandoffPhase::Verified)?;
    }
    advance_pending(path, UpdateHandoffPhase::Committed)?;
    Ok(true)
}
