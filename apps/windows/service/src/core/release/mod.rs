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

/// What the release service hands its worker on stdin: the App's request and the owner the
/// release pipe authenticated, which the worker checks again under C.
#[cfg(all(windows, not(feature = "test")))]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct WorkerInput {
    pub(crate) request: crate::release_wire::ReleaseRequest,
    pub(crate) owner_key: String,
    /// The release service holding the worker's Job.
    pub(crate) job_owner: Incarnation,
}

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

/// Which boot something happened in: the release's volatile boot marker (a key no installer
/// touches), the machine's boot time and the uptime counter when the stamp was taken.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub(crate) struct BootStamp {
    #[serde(default)]
    pub(crate) marker: Option<String>,
    #[serde(default)]
    pub(crate) booted_at: Option<u64>,
    #[serde(default)]
    pub(crate) uptime_ms: Option<u64>,
}

/// Boot times read from the uptime counter wander with clock changes; closer than this is
/// one boot.
const BOOT_TIME_TOLERANCE_SECONDS: u64 = 120;

/// How a recorded boot relates to the current one (Sol R2-F3 on PR #1569).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BootRelation {
    Same,
    /// Provably an earlier boot: every process of it has ended.
    Earlier,
    /// Cannot be told apart. Callers treat it as the same boot.
    Unknown,
}

impl BootStamp {
    /// An earlier boot needs both markers known and different, and on top of that either the
    /// uptime counter running backwards or boot times further apart than the clock can wander.
    /// A missing part, or a marker change alone, proves nothing.
    pub(crate) fn relation_to(&self, now: &BootStamp) -> BootRelation {
        let (Some(then), Some(current)) = (&self.marker, &now.marker) else {
            return BootRelation::Unknown;
        };
        if then == current {
            return BootRelation::Same;
        }
        let uptime_went_back = matches!((self.uptime_ms, now.uptime_ms), (Some(a), Some(b)) if b < a);
        let boot_time_moved = matches!(
            (self.booted_at, now.booted_at),
            (Some(a), Some(b)) if a.abs_diff(b) > BOOT_TIME_TOLERANCE_SECONDS
        );
        if uptime_went_back || boot_time_moved {
            BootRelation::Earlier
        } else {
            BootRelation::Unknown
        }
    }
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
    /// The boot the worker ran in.
    #[serde(default)]
    pub(crate) worker_boot: Option<BootStamp>,
    #[serde(default)]
    pub(crate) worker_finished: bool,
    /// Set by the release service, under C, only after the worker finished with every component
    /// settled, every worker Job was proven empty and a read-back taken after that agreed. Until
    /// then the release has not proven that old work cannot act, in this boot or any later one.
    #[serde(default)]
    pub(crate) completed: bool,
    #[serde(default)]
    pub(crate) stuck: Vec<Incarnation>,
    /// The update recovery task stays disabled until the next admitted Connect.
    #[serde(default)]
    pub(crate) executor_quarantined: bool,
    /// The main Service is Disabled with no failure actions while this is set; whoever
    /// clears it puts the configuration back first.
    #[serde(default)]
    pub(crate) service_quarantined: bool,
    /// The release service process that holds the workers' Job Objects.
    #[serde(default)]
    pub(crate) job_owner: Option<Incarnation>,
    /// Set by each worker before any effect; cleared by the release service only once every
    /// worker Job it holds has been terminated and reported no active process. While set, PID
    /// death of the worker proves nothing about the children it started.
    #[serde(default)]
    pub(crate) jobs_unproven: bool,
    /// The boot in which an earlier record could not be read, so whatever it named was lost.
    /// Nothing can show that work retired before that boot ends, and after it only a completed
    /// release clears it.
    #[serde(default)]
    pub(crate) history_lost_boot: Option<BootStamp>,
    /// The boot in which a release service ended while it still held worker Jobs it had not
    /// proven empty. Kill-on-close ended them, but nothing observed it (Sol R2-F2), so this
    /// clears the same way as `history_lost_boot`.
    #[serde(default)]
    pub(crate) orphaned_jobs_boot: Option<BootStamp>,
}

impl Default for Record {
    fn default() -> Self {
        Self {
            schema: RECORD_SCHEMA,
            mode: Mode::Secured,
            generation: 0,
            request_id: None,
            worker: None,
            worker_boot: None,
            worker_finished: false,
            completed: false,
            stuck: Vec::new(),
            executor_quarantined: false,
            service_quarantined: false,
            job_owner: None,
            jobs_unproven: false,
            history_lost_boot: None,
            orphaned_jobs_boot: None,
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

/// What the admission needs to know about processes, the boot and the WMI DNS ledger.
/// Injectable so the decision is tested without a live process table.
pub(crate) struct Processes {
    /// `Some(true)` alive, `Some(false)` gone, `None` could not tell (treated as alive).
    pub(crate) alive: Box<dyn Fn(&Incarnation) -> Option<bool> + Send + Sync>,
    pub(crate) boot: Box<dyn Fn() -> BootStamp + Send + Sync>,
    /// The WMI DNS batches not known to have finished, read under C (Sol R2-F1).
    pub(crate) broker: Box<dyn Fn() -> Result<Vec<crate::core::dns::broker_ledger::Pending>> + Send + Sync>,
}

/// This boot, as the release records it.
pub(crate) fn current_boot() -> BootStamp {
    BootStamp {
        marker: crate::core::boot_session::release_marker(),
        booted_at: booted_at(),
        uptime_ms: uptime_ms(),
    }
}

#[cfg(windows)]
fn uptime_ms() -> Option<u64> {
    // SAFETY: no arguments; reads the system uptime counter.
    Some(unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() })
}

#[cfg(not(windows))]
fn uptime_ms() -> Option<u64> {
    None
}

#[cfg(windows)]
fn booted_at() -> Option<u64> {
    let uptime = Duration::from_millis(uptime_ms()?);
    SystemTime::now()
        .checked_sub(uptime)?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|since| since.as_secs())
}

#[cfg(not(windows))]
fn booted_at() -> Option<u64> {
    None
}

/// A boot-scoped blocker: in its own boot (or one that cannot be told apart) only a restart
/// helps; after a restart, only a completed release clears it.
fn boot_blocker(recorded: &BootStamp, now: &BootStamp, what: &str) -> String {
    if recorded.relation_to(now) == BootRelation::Earlier {
        format!("{what}; choose Restore internet again")
    } else {
        format!("{what}; restart Windows, then choose Restore internet")
    }
}

impl Processes {
    pub(crate) fn live() -> Self {
        Self {
            alive: Box::new(|incarnation| live_incarnation_alive(incarnation)),
            boot: Box::new(current_boot),
            broker: Box::new(crate::core::dns::broker_ledger::outstanding),
        }
    }

    /// The incarnations in `record` that are not proven gone, so a later release keeps them.
    /// A PID with its creation time names one process in one boot, so no boot check is needed.
    pub(crate) fn unretired_incarnations(&self, record: &Record) -> Vec<Incarnation> {
        if record.mode != Mode::Released {
            return Vec::new();
        }
        let mut kept: Vec<Incarnation> = Vec::new();
        for incarnation in record.worker.iter().chain(record.stuck.iter()) {
            if (self.alive)(incarnation) != Some(false) && !kept.contains(incarnation) {
                kept.push(*incarnation);
            }
        }
        kept
    }

    /// `None` when nothing from the last release can still change the network. Retired by proof
    /// only (Sol R2-F2, R2-F3): the worker and every survivor gone, the release completed (its
    /// Jobs proven empty and read back after), no WMI DNS batch outstanding from any boot, and no
    /// lost history or orphaned Jobs. A restart ends processes, but it does not complete a
    /// release: whatever a restart retires still waits for the next release to read it back.
    pub(crate) fn unretired_reason(&self, record: &Record) -> Option<String> {
        let now = (self.boot)();
        match (self.broker)() {
            Err(error) => {
                return Some(format!("the record of DNS changes handed to Windows cannot be read: {error:#}"));
            }
            Ok(pending) => {
                if let Some(entry) = pending.iter().find(|entry| !entry.from_earlier_boot(&now)) {
                    return Some(format!(
                        "{} may still take effect; restart Windows, then choose Restore internet",
                        entry.description
                    ));
                }
                if !pending.is_empty() {
                    return Some(
                        "a DNS change from before the restart has not been checked; choose Restore internet again".into(),
                    );
                }
            }
        }
        if let Some(lost) = &record.history_lost_boot {
            return Some(boot_blocker(lost, &now, "an earlier restore record could not be read"));
        }
        if let Some(orphaned) = &record.orphaned_jobs_boot {
            return Some(boot_blocker(
                orphaned,
                &now,
                "an earlier restore's child processes were never proven ended",
            ));
        }
        if record.mode != Mode::Released {
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
        if record.jobs_unproven {
            let owner_gone = record
                .job_owner
                .is_none_or(|owner| (self.alive)(&owner) == Some(false));
            return Some(if owner_gone {
                "the restore's child processes were never proven ended; restart Windows, then choose Restore internet"
                    .into()
            } else {
                "the restore's child processes are not yet proven ended".into()
            });
        }
        if !record.completed {
            return Some(
                "the last restore did not prove that every old task has stopped; choose Restore internet again".into(),
            );
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
/// saw (`None` from an App that predates generations or has seen none yet). After a release only
/// the released generation is admitted: a Connect without one was prepared without having seen
/// the release, so it may be a retry from before it (the App asks the release service for the
/// generation when the user clicks Connect).
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
        // Without a generation only a machine that never released or admitted is secured at a
        // generation the caller cannot have missed. After that the App always has one (Sol
        // R-F3): a start without it may be a retry from before a restore and a newer Connect.
        (Mode::Secured, None) if record.generation == 0 => StartVerdict::Allowed(record.generation),
        (Mode::Secured, Some(generation)) if generation == record.generation => {
            StartVerdict::Allowed(record.generation)
        }
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
        record.completed = false;
        record.stuck.clear();
        record.jobs_unproven = false;
        record.job_owner = None;
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

/// Whether a release-direction request (`ReleaseKillSwitch`, `RestoreProtectedDns`) for the
/// session admitted at `supplied` may act (Sol R-F4 on PR #1569). Refused once a restore or a
/// later admission has moved the generation on, so an old teardown cannot reach a newer session
/// of the same owner. A released machine has no session to reach, so any teardown may run (a
/// Disconnect after Restore internet). Otherwise `None` is accepted only on a machine that never
/// released or admitted, where no session can be newer than the caller knows.
pub(crate) fn release_generation_verdict(record: &Record, supplied: Option<u64>) -> bool {
    record.mode == Mode::Released
        || supplied.map_or(record.generation == 0, |generation| generation == record.generation)
}

/// Whether a narrow (AI-preserving) release may install the hold. A machine in `Released` mode
/// was released by an explicit Restore internet and has admitted no Connect since, so no session
/// is left for a Quit or a replacement sign-in to keep a hold for: a narrow request that was queued
/// before the Restore must not reinstall what the Restore removed, whatever generation it carries
/// (decision 125: Restore internet is always the full release). `None`: refused as stale, as
/// [`release_generation_verdict`] decides; `Some(false)`: release in full.
pub(crate) fn narrow_release_verdict(record: &Record, supplied: Option<u64>) -> Option<bool> {
    release_generation_verdict(record, supplied).then_some(record.mode != Mode::Released)
}

/// [`release_generation_verdict`] under C. The caller holds the main Service's lifecycle lock
/// across the check and its effect, and StartClash admits under that same lock, so nothing is
/// admitted between the two.
pub(crate) async fn check_release_generation(supplied: Option<u64>) -> std::result::Result<(), AdmissionRefusal> {
    check_narrow_release(supplied).await.map(|_| ())
}

/// [`check_release_generation`] that also answers whether a narrow release may install the AI
/// hold ([`narrow_release_verdict`]), read under the same C as the generation.
pub(crate) async fn check_narrow_release(supplied: Option<u64>) -> std::result::Result<bool, AdmissionRefusal> {
    tokio::task::spawn_blocking(move || {
        let authority = Authority::live();
        let held = authority
            .lock(ADMISSION_LOCK_TIMEOUT)
            .map_err(|error| AdmissionRefusal::Corrupt(format!("{error:#}")))?;
        let Some(_held) = held else {
            return Err(AdmissionRefusal::InProgress);
        };
        let record = authority
            .load()
            .map_err(|error| AdmissionRefusal::Corrupt(format!("{error:#}")))?;
        narrow_release_verdict(&record, supplied).ok_or(AdmissionRefusal::Stale)
    })
    .await
    .unwrap_or_else(|error| Err(AdmissionRefusal::Corrupt(format!("generation check failed: {error}"))))
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

/// Whether the main Service's startup must not replay a Core: the machine was released and no
/// Connect has been admitted since. Unreadable state holds the replay too.
pub(crate) fn replay_held() -> bool {
    Authority::live()
        .load()
        .map(|record| record.mode == Mode::Released)
        .unwrap_or(true)
}

/// Whether the update executor must stay down: the release quarantined it and no Connect has
/// been admitted since. Unreadable state keeps it down.
pub(crate) fn executor_quarantined() -> bool {
    Authority::live()
        .load()
        .map(|record| record.executor_quarantined)
        .unwrap_or(true)
}

/// A report that is not backed by terminal proof: every component keeps what was read, but none
/// is known to stay that way (Sol R3-M2 on PR #1569). Current state and future stability are
/// separate facts; only the second is withdrawn here.
pub(crate) fn mark_risk_unproven(report: &mut crate::release_wire::ReleaseReport) {
    for component in &mut report.components {
        component.risk = "unknown".into();
    }
}

/// Put the service's own final read-back into `report`, replacing the worker's earlier one: a
/// component that now reads residual or unreadable must not stay described as restored (Sol
/// R3-M2). A component the final read did not cover becomes unreadable.
pub(crate) fn fold_final_readings(
    report: &mut crate::release_wire::ReleaseReport,
    readings: &[(&'static str, String, Option<String>)],
) {
    for component in &mut report.components {
        match readings.iter().find(|(name, _, _)| *name == component.name) {
            Some((_, readback, detail)) => {
                component.readback = readback.clone();
                if detail.is_some() {
                    component.detail = detail.clone();
                }
            }
            None => {
                component.readback = "unreadable".into();
                component.detail = Some("not covered by the final read-back".into());
            }
        }
    }
}

#[cfg(test)]
mod tests;
