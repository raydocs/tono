//! The machine-wide release authority (PROPOSAL §10 v5, Windows half).
//!
//! `release.lock` is the coordinator C: the release worker holds it from before its first
//! effect until it has read everything back, and a Connect is admitted only under it. The
//! lock file is never renamed or deleted, so every holder locks the same file. Next to it,
//! `release-state.json` records which mode the machine is in, the generation sessions are
//! admitted with, and the worker that released it, so a worker that died can be told from one
//! that is still running.

use anyhow::{Context as _, Result, bail};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(all(windows, not(feature = "test")))]
pub(crate) mod daemon;
#[cfg(all(windows, not(feature = "test")))]
pub(crate) mod install;
#[cfg(all(windows, not(feature = "test")))]
pub(crate) mod worker;

pub(crate) const LOCK_FILE_NAME: &str = "release.lock";
pub(crate) const RECORD_FILE_NAME: &str = "release-state.json";
pub(crate) const RECORD_SCHEMA: u32 = 1;
/// How long a Connect waits for C before it says a release is in progress.
pub(crate) const ADMISSION_LOCK_TIMEOUT: Duration = Duration::from_millis(1_500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Mode {
    #[default]
    Secured,
    Released,
}

/// One process instance: a PID plus its creation time, so a reused PID never matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Incarnation {
    pub(crate) pid: u32,
    pub(crate) started_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Record {
    pub(crate) schema: u32,
    pub(crate) mode: Mode,
    pub(crate) generation: u64,
    #[serde(default)]
    pub(crate) request_id: Option<String>,
    #[serde(default)]
    pub(crate) worker: Option<Incarnation>,
    #[serde(default)]
    pub(crate) worker_boot_session: Option<String>,
    #[serde(default)]
    pub(crate) worker_finished: bool,
    #[serde(default)]
    pub(crate) stuck: Vec<Incarnation>,
    /// The update recovery task stays disabled until the next admitted Connect.
    #[serde(default)]
    pub(crate) executor_quarantined: bool,
    /// The main Service is Disabled with no failure actions while this is set; whoever
    /// clears it puts the configuration back first.
    #[serde(default)]
    pub(crate) service_quarantined: bool,
}

impl Default for Record {
    fn default() -> Self {
        Self {
            schema: RECORD_SCHEMA,
            mode: Mode::Secured,
            generation: 0,
            request_id: None,
            worker: None,
            worker_boot_session: None,
            worker_finished: false,
            stuck: Vec::new(),
            executor_quarantined: false,
            service_quarantined: false,
        }
    }
}

/// Why a Connect was not admitted. Each one leaves the record untouched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AdmissionRefusal {
    /// C is held: a release is running right now.
    InProgress,
    /// The last release has a live worker or a writer that survived termination.
    Unfinished(String),
    /// The record cannot be read; it is never retired automatically.
    Corrupt(String),
    /// The request was prepared for a generation the machine has left.
    Stale,
}

impl std::fmt::Display for AdmissionRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InProgress => write!(f, "a network restore is still running"),
            Self::Unfinished(reason) => write!(f, "the last network restore has not finished: {reason}"),
            Self::Corrupt(reason) => write!(f, "the network restore record cannot be read: {reason}"),
            Self::Stale => write!(f, "this request belongs to a session a network restore ended"),
        }
    }
}

/// What the admission needs to know about processes. Injectable so the decision is tested
/// without a live process table.
pub(crate) struct Processes {
    /// `Some(true)` alive, `Some(false)` gone, `None` could not tell (treated as alive).
    pub(crate) alive: Box<dyn Fn(&Incarnation) -> Option<bool> + Send + Sync>,
    pub(crate) boot_session: Box<dyn Fn() -> Option<String> + Send + Sync>,
}

impl Processes {
    pub(crate) fn live() -> Self {
        Self {
            alive: Box::new(|incarnation| live_incarnation_alive(incarnation)),
            boot_session: Box::new(crate::core::boot_session::current),
        }
    }

    /// `None` when nothing from the last release can still change the network.
    pub(crate) fn unretired_reason(&self, record: &Record) -> Option<String> {
        if record.mode != Mode::Released {
            return None;
        }
        let this_boot = (self.boot_session)();
        // A record from an earlier boot ended with that boot. An unknown boot is not proof.
        let same_boot = match (&record.worker_boot_session, &this_boot) {
            (Some(recorded), Some(current)) => recorded == current,
            _ => true,
        };
        if !same_boot {
            return None;
        }
        if let Some(worker) = record.worker
            && (self.alive)(&worker) != Some(false)
        {
            return Some(format!("release worker {} is still running", worker.pid));
        }
        for stuck in &record.stuck {
            if (self.alive)(stuck) != Some(false) {
                return Some(format!("process {} survived termination", stuck.pid));
            }
        }
        None
    }
}

#[cfg(windows)]
fn live_incarnation_alive(incarnation: &Incarnation) -> Option<bool> {
    match crate::core::process::process_started_at(incarnation.pid) {
        Ok(Some(started_at)) => Some(started_at == incarnation.started_at),
        Ok(None) => Some(false),
        Err(_) => None,
    }
}

#[cfg(not(windows))]
fn live_incarnation_alive(incarnation: &Incarnation) -> Option<bool> {
    match crate::core::process::process_identity(incarnation.pid) {
        Ok(Some(identity)) => Some(identity.started_at == incarnation.started_at),
        Ok(None) => Some(false),
        Err(_) => None,
    }
}

/// The generation after `previous`: larger than every earlier one even when the record was
/// lost, because it is at least the wall clock in milliseconds.
pub(crate) fn next_generation(previous: u64) -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);
    previous.saturating_add(1).max(now)
}

/// The admission decision for a Connect that carries `supplied`, the generation its App last
/// saw (`None` from an App that predates generations or has seen none yet).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StartVerdict {
    /// The machine is secured at this generation; nothing to write.
    Allowed(u64),
    /// The machine is released; admitting moves it to a new generation.
    NeedsAdmission,
    Stale,
}

pub(crate) fn start_verdict(record: &Record, supplied: Option<u64>) -> StartVerdict {
    match (record.mode, supplied) {
        (Mode::Secured, None) => StartVerdict::Allowed(record.generation),
        (Mode::Secured, Some(generation)) if generation == record.generation => {
            StartVerdict::Allowed(record.generation)
        }
        (Mode::Released, None) => StartVerdict::NeedsAdmission,
        (Mode::Released, Some(generation)) if generation == record.generation => {
            StartVerdict::NeedsAdmission
        }
        _ => StartVerdict::Stale,
    }
}

pub(crate) struct Authority {
    directory: PathBuf,
}

/// C, held until dropped. Closing the handle releases the lock.
pub(crate) struct Held {
    _file: File,
}

impl Authority {
    pub(crate) fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    pub(crate) fn live() -> Self {
        Self::new(crate::core::paths::service_paths().persistent_state_dir())
    }

    pub(crate) fn lock_path(&self) -> PathBuf {
        self.directory.join(LOCK_FILE_NAME)
    }

    pub(crate) fn record_path(&self) -> PathBuf {
        self.directory.join(RECORD_FILE_NAME)
    }

    /// Take C, polling until `timeout`. `Ok(None)` means another holder kept it.
    pub(crate) fn lock(&self, timeout: Duration) -> Result<Option<Held>> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.lock_path())
            .with_context(|| format!("failed to open {:?}", self.lock_path()))?;
        #[cfg(windows)]
        crate::core::windows_security::secure_private_service_file_if_exists(&self.lock_path())?;
        let deadline = Instant::now() + timeout;
        loop {
            if try_lock(&file)? {
                return Ok(Some(Held { _file: file }));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// A missing record is a machine that never released: secured at generation 0.
    pub(crate) fn load(&self) -> Result<Record> {
        let bytes = match std::fs::read(self.record_path()) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Record::default());
            }
            Err(error) => {
                return Err(error).with_context(|| format!("failed to read {:?}", self.record_path()));
            }
        };
        let record: Record = serde_json::from_slice(&bytes).context("release record is not valid JSON")?;
        if record.schema != RECORD_SCHEMA {
            bail!("release record schema {} is not {RECORD_SCHEMA}", record.schema);
        }
        Ok(record)
    }

    /// Write-through replace, so a crash leaves either the old or the new record.
    pub(crate) fn save(&self, record: &Record) -> Result<()> {
        use std::io::Write as _;

        let bytes = serde_json::to_vec_pretty(record)?;
        let temporary = self
            .directory
            .join(format!("release-state.tmp-{}", std::process::id()));
        {
            let mut file = File::create(&temporary)
                .with_context(|| format!("failed to create {temporary:?}"))?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        #[cfg(windows)]
        crate::core::windows_security::secure_private_service_file_if_exists(&temporary)?;
        replace_file(&temporary, &self.record_path())
            .with_context(|| format!("failed to commit {:?}", self.record_path()))?;
        Ok(())
    }

    /// Admit a Connect (PROPOSAL §10 v5): only under C, only when nothing from the last
    /// release can still act, and only for a request prepared for the current generation.
    /// Returns the generation the session runs under. `restore_executor` puts the update
    /// recovery task back; it runs once, before the record says it is back.
    pub(crate) fn admit_start(
        &self,
        supplied: Option<u64>,
        lock_timeout: Duration,
        processes: &Processes,
        restore_executor: impl FnOnce() -> Result<()>,
    ) -> std::result::Result<u64, AdmissionRefusal> {
        let held = self
            .lock(lock_timeout)
            .map_err(|error| AdmissionRefusal::Corrupt(format!("{error:#}")))?;
        let Some(_held) = held else {
            return Err(AdmissionRefusal::InProgress);
        };
        let mut record = self
            .load()
            .map_err(|error| AdmissionRefusal::Corrupt(format!("{error:#}")))?;
        match start_verdict(&record, supplied) {
            StartVerdict::Allowed(generation) => return Ok(generation),
            StartVerdict::Stale => return Err(AdmissionRefusal::Stale),
            StartVerdict::NeedsAdmission => {}
        }
        if let Some(reason) = processes.unretired_reason(&record) {
            return Err(AdmissionRefusal::Unfinished(reason));
        }
        if record.executor_quarantined {
            restore_executor().map_err(|error| {
                AdmissionRefusal::Unfinished(format!("the update recovery task could not be put back: {error:#}"))
            })?;
        }
        record.mode = Mode::Secured;
        record.generation = next_generation(record.generation);
        record.worker = None;
        record.worker_finished = false;
        record.stuck.clear();
        record.executor_quarantined = false;
        // The main Service is answering this Connect, so its configuration is back.
        record.service_quarantined = false;
        self.save(&record)
            .map_err(|error| AdmissionRefusal::Corrupt(format!("{error:#}")))?;
        Ok(record.generation)
    }
}

#[cfg(windows)]
fn try_lock(file: &File) -> Result<bool> {
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Foundation::{ERROR_LOCK_VIOLATION, GetLastError};
    use windows_sys::Win32::Storage::FileSystem::{
        LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, LockFileEx,
    };
    use windows_sys::Win32::System::IO::OVERLAPPED;

    let mut overlapped = OVERLAPPED::default();
    // SAFETY: the handle is owned by `file`, and `overlapped` lives across the call.
    let locked = unsafe {
        LockFileEx(
            file.as_raw_handle() as _,
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    };
    if locked != 0 {
        return Ok(true);
    }
    // SAFETY: reads the calling thread's last error.
    if unsafe { GetLastError() } == ERROR_LOCK_VIOLATION {
        return Ok(false);
    }
    Err(std::io::Error::last_os_error()).context("LockFileEx failed on the release lock")
}

#[cfg(unix)]
fn try_lock(file: &File) -> Result<bool> {
    use std::os::fd::AsRawFd as _;

    // SAFETY: the descriptor is owned by `file`.
    let result = unsafe { platform_lib::flock(file.as_raw_fd(), platform_lib::LOCK_EX | platform_lib::LOCK_NB) };
    if result == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        return Ok(false);
    }
    Err(error).context("flock failed on the release lock")
}

#[cfg(all(windows, not(feature = "test")))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    crate::core::atomic_file::replace_blocking(source, destination)
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

/// Admission for the main Service's StartClash: runs the blocking lock wait off the runtime.
pub(crate) async fn admit_start(supplied: Option<u64>) -> std::result::Result<u64, AdmissionRefusal> {
    tokio::task::spawn_blocking(move || {
        Authority::live().admit_start(
            supplied,
            ADMISSION_LOCK_TIMEOUT,
            &Processes::live(),
            restore_update_recovery_task,
        )
    })
    .await
    .unwrap_or_else(|error| Err(AdmissionRefusal::Corrupt(format!("admission worker failed: {error}"))))
}

/// Re-enable the update recovery task the release disabled. A task that is not registered
/// is already as it should be.
#[cfg(all(windows, not(feature = "test")))]
pub(crate) fn restore_update_recovery_task() -> Result<()> {
    worker::set_recovery_task_enabled(true)
}

#[cfg(not(all(windows, not(feature = "test"))))]
pub(crate) fn restore_update_recovery_task() -> Result<()> {
    Ok(())
}

/// Whether the update executor must stay down: the release quarantined it and no Connect has
/// been admitted since. Unreadable state keeps it down.
pub(crate) fn executor_quarantined() -> bool {
    Authority::live()
        .load()
        .map(|record| record.executor_quarantined)
        .unwrap_or(true)
}

#[cfg(test)]
mod tests;
