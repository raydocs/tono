use crate::core::ClashConfig;
use crate::core::logger::{get_writer, set_or_update_writer};
use crate::core::process::{
    ProcessIdentity, process_identity, terminate_process_if_identity_matches,
};
use crate::core::reconcile::ensure_startup_reconciled;
use crate::core::runtime::{
    CoreRuntimeRecord, remove_core_runtime_record, write_core_runtime_record,
};
use crate::core::state::set_core_lifecycle_state;
use crate::core::structure::ServiceLifecycleState;
use crate::{OwnerIdentity, WriterConfig};
use anyhow::{Context as _, Result, anyhow};
use tono_logger::AsyncLogger;
use compact_str::CompactString;
use flexi_logger::writers::LogWriter;
use flexi_logger::{DeferredNow, Record};
use once_cell::sync::Lazy;
use std::process::Stdio;
#[cfg(feature = "test")]
use std::sync::Mutex as StdMutex;
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicU32, AtomicU64, Ordering},
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncBufReadExt;
use tokio::{io::BufReader, process::Command};
use tokio::{
    process::Child,
    sync::{Mutex, oneshot},
    task::JoinHandle,
};
use tracing::{error, info, warn};

/// Core teardown must not hold the owner lifecycle lock indefinitely. On Windows the Job Object
/// terminates the whole tree; this bound is only the confirmation wait for the direct child.
const CORE_TERMINATION_TIMEOUT: Duration = Duration::from_secs(3);
/// A watchdog normally exits immediately after its shutdown signal. This catches a task stuck in
/// restart preparation or an OS wait, then falls back to PID-based termination and reconciliation.
const WATCHDOG_JOIN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub struct CoreExitInfo {
    pub exit_code: Option<i32>,
    #[cfg(unix)]
    pub signal: Option<i32>,
    pub uptime: Duration,
}

impl CoreExitInfo {
    pub fn diagnosis(&self) -> &'static str {
        #[cfg(unix)]
        {
            if let Some(sig) = self.signal {
                return match sig {
                    9 => "Killed by OOM killer or admin (SIGKILL)",
                    11 => "Segmentation fault (SIGSEGV)",
                    15 => "Graceful shutdown (SIGTERM)",
                    6 => "Aborted (SIGABRT)",
                    _ => "Terminated by signal",
                };
            }
        }
        match self.exit_code {
            Some(0) => "Normal exit",
            Some(_) => "Abnormal exit",
            None => "Unknown exit reason",
        }
    }
}

pub struct ChildGuard {
    child: Option<Child>,
    readers: Vec<JoinHandle<()>>,
    #[cfg(windows)]
    job: Option<WindowsCoreJob>,
}

/// Every Windows core belongs to a private kill-on-close Job Object. Closing the Service, aborting
/// the watchdog, or dropping a partially initialized guard therefore terminates Mihomo and any
/// descendants without shelling out to localized `taskkill` output.
#[cfg(windows)]
struct WindowsCoreJob(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl WindowsCoreJob {
    fn attach(pid: u32) -> Result<Self> {
        use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        let raw_job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw_job.is_null() {
            return Err(std::io::Error::last_os_error())
                .context("failed to create core Job Object");
        }
        // SAFETY: `CreateJobObjectW` returned a new owned handle.
        let job = unsafe { OwnedHandle::from_raw_handle(raw_job.cast()) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                job.as_raw_handle() as HANDLE,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error())
                .context("failed to configure kill-on-close core Job Object");
        }

        let raw_process = unsafe {
            OpenProcess(
                PROCESS_SET_QUOTA
                    | PROCESS_TERMINATE
                    | PROCESS_QUERY_LIMITED_INFORMATION
                    | windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE,
                0,
                pid,
            )
        };
        if raw_process.is_null() {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("failed to open core process {pid} for Job assignment"));
        }
        // SAFETY: `OpenProcess` returned a new owned handle.
        let process = unsafe { OwnedHandle::from_raw_handle(raw_process.cast()) };
        if unsafe {
            AssignProcessToJobObject(
                job.as_raw_handle() as HANDLE,
                process.as_raw_handle() as HANDLE,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("failed to assign core process {pid} to Job Object"));
        }
        Ok(Self(job))
    }

    fn terminate(&self) -> Result<()> {
        use std::os::windows::io::AsRawHandle as _;
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        if unsafe { TerminateJobObject(self.0.as_raw_handle() as HANDLE, 1) } == 0 {
            return Err(std::io::Error::last_os_error())
                .context("failed to terminate core Job Object");
        }
        Ok(())
    }
}

impl ChildGuard {
    fn inner(&mut self) -> Option<&mut Child> {
        self.child.as_mut()
    }

    fn id(&self) -> Option<u32> {
        self.child.as_ref().and_then(Child::id)
    }

    fn take(mut self) -> Option<Child> {
        self.child.take()
    }

    async fn kill_now(&mut self) -> Result<()> {
        // An unconfirmed kill cannot be produced with a real child off Windows: SIGKILL always
        // lands, and tokio answers `start_kill` on an already-reaped child with `Ok`. Without a
        // seam the retry's fail-closed branch — the one that keeps a possibly-live core tracked
        // and tells the caller the stop did not happen — would be untestable, and an untestable
        // branch is how the self-deadlock this retry now avoids survived in the first place.
        #[cfg(all(test, unix))]
        if tests::kill_failure_is_simulated() {
            anyhow::bail!("simulated: core termination could not be confirmed");
        }

        for reader in self.readers.drain(..) {
            reader.abort();
        }

        if let Some(child) = self.child.as_mut() {
            let child_id = child.id();
            #[cfg(windows)]
            if let Some(job) = self.job.as_ref() {
                if let Err(error) = job.terminate() {
                    warn!(
                        "Job Object termination failed; falling back to direct core kill: {error:#}"
                    );
                    child
                        .start_kill()
                        .with_context(|| format!("failed to kill child {child_id:?}"))?;
                }
            } else {
                child
                    .start_kill()
                    .with_context(|| format!("failed to kill child {child_id:?}"))?;
            }
            #[cfg(not(windows))]
            child
                .start_kill()
                .with_context(|| format!("failed to kill child {child_id:?}"))?;

            tokio::time::timeout(CORE_TERMINATION_TIMEOUT, child.wait())
                .await
                .with_context(|| {
                    format!(
                        "child {child_id:?} did not terminate within {CORE_TERMINATION_TIMEOUT:?}"
                    )
                })?
                .with_context(|| format!("failed to wait for child {child_id:?}"))?;
            self.child.take();
            #[cfg(windows)]
            self.job.take();
            info!("Successfully killed child ({:?})", child_id);
        } else {
            info!("No running core process found");
        }
        Ok(())
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        for reader in self.readers.drain(..) {
            reader.abort();
        }
        if let Some(mut child) = self.child.take() {
            tokio::spawn(async move {
                if let Err(e) = child.kill().await {
                    warn!("Failed to kill child ({:?}): {e}", child.id());
                } else {
                    info!("Successfully killed child ({:?})", child.id());
                }
            });
        } else {
            info!("No running core process found");
        }
    }
}

#[derive(Clone, Copy)]
struct WatchdogConfig {
    max_restarts: u32,
    restart_window: Duration,
    max_backoff: Duration,
}

impl Default for WatchdogConfig {
    fn default() -> Self {
        Self {
            max_restarts: 10,
            restart_window: Duration::from_secs(600),
            max_backoff: Duration::from_secs(30),
        }
    }
}

#[cfg(feature = "test")]
#[derive(Clone, Copy)]
pub struct CoreWatchdogTestConfig {
    pub max_restarts: u32,
    pub restart_window: Duration,
    pub max_backoff: Duration,
}

#[cfg(feature = "test")]
static WATCHDOG_CONFIG_OVERRIDE: Lazy<StdMutex<Option<WatchdogConfig>>> =
    Lazy::new(|| StdMutex::new(None));

#[cfg(feature = "test")]
pub fn set_core_watchdog_config_for_tests(config: Option<CoreWatchdogTestConfig>) {
    let mut guard = WATCHDOG_CONFIG_OVERRIDE.lock().unwrap();
    *guard = config.map(|config| WatchdogConfig {
        max_restarts: config.max_restarts,
        restart_window: config.restart_window,
        max_backoff: config.max_backoff,
    });
}

fn watchdog_config() -> WatchdogConfig {
    #[cfg(feature = "test")]
    if let Some(config) = *WATCHDOG_CONFIG_OVERRIDE.lock().unwrap() {
        return config;
    }

    WatchdogConfig::default()
}

fn backoff_delay(attempt: u32, max: Duration) -> Duration {
    if attempt == 0 {
        return Duration::ZERO;
    }

    let base = Duration::from_secs(1u64 << (attempt - 1).min(5));
    base.min(max)
}

fn core_args(config: &ClashConfig) -> Vec<String> {
    crate::core::structure::core_launch_args(
        &config.core_config.core_path,
        &config.core_config.config_dir,
        &config.core_config.config_path,
        &config.core_config.core_ipc_path,
    )
}

fn log_core_exit(status: &std::process::ExitStatus, uptime: Duration) -> String {
    let exit_info = CoreExitInfo {
        exit_code: status.code(),
        #[cfg(unix)]
        signal: {
            use std::os::unix::process::ExitStatusExt;
            status.signal()
        },
        uptime,
    };

    error!(
        "Core exited unexpectedly - code: {:?}, diagnosis: {}, uptime: {:.1}s",
        exit_info.exit_code,
        exit_info.diagnosis(),
        exit_info.uptime.as_secs_f64()
    );

    #[cfg(unix)]
    if let Some(sig) = exit_info.signal {
        error!("Core terminated by signal: {}", sig);
    }

    format!(
        "{} (code: {:?})",
        exit_info.diagnosis(),
        exit_info.exit_code
    )
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn non_zero_u64(value: u64) -> Option<u64> {
    (value != 0).then_some(value)
}

async fn write_runtime_record_for_config(
    pid: Option<u32>,
    config: &ClashConfig,
    identity_cache: &RwLock<Option<(u32, ProcessIdentity)>>,
    context: &'static str,
) -> Result<()> {
    // Every caller still owns the original, unreaped Child handle. Reuse is impossible during
    // this existing query. Cache before disk IO so a failed record write cannot lose identity.
    *identity_cache.write().unwrap() = None;
    let pid = pid.context("spawned core did not expose a process ID")?;
    let identity = process_identity(pid)?
        .with_context(|| format!("core process {pid} exited before runtime record {context}"))?;
    *identity_cache.write().unwrap() = Some((pid, identity.clone()));
    write_core_runtime_record(&CoreRuntimeRecord {
        pid,
        ipc_path: config.core_config.core_ipc_path.clone(),
        identity,
    })
    .await
    .with_context(|| format!("failed to write core runtime record {context}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PrepareStartCoreAction {
    NoCore,
    Preserve(u32),
    Stop(u32),
}

const fn prepare_start_core_action(
    running_pid: u32,
    preserve_supervised_core: bool,
) -> PrepareStartCoreAction {
    if running_pid == 0 {
        PrepareStartCoreAction::NoCore
    } else if preserve_supervised_core {
        PrepareStartCoreAction::Preserve(running_pid)
    } else {
        PrepareStartCoreAction::Stop(running_pid)
    }
}

pub struct CoreManager {
    running_pid: Arc<AtomicU32>,
    running_process_identity: Arc<RwLock<Option<(u32, ProcessIdentity)>>>,
    running_config: Mutex<Option<ClashConfig>>,
    core_start_time: Arc<Mutex<Option<Instant>>>,
    core_started_at: Arc<AtomicU64>,
    last_core_exit_reason: Arc<Mutex<Option<String>>>,
    restart_count: Arc<AtomicU32>,
    last_recovery_at: Arc<AtomicU64>,
    watchdog_shutdown: Mutex<Option<oneshot::Sender<()>>>,
    watchdog_handle: Mutex<Option<JoinHandle<Result<()>>>>,
    failed_child: Arc<Mutex<Option<ChildGuard>>>,
}

/// Identifies one core process instance, for callers that must notice a core replaced underneath
/// them.
///
/// The pid alone is not an identity. Windows hands pids out of a free list, so a core that died
/// and was replaced inside one staging window can come back wearing the pid its caller sampled.
/// `generation` changes for every publication, including ordinary starts and watchdog recovery,
/// so the pair still differs when Windows recycles the pid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CoreInstanceId {
    pub(super) pid: u32,
    pub(super) generation: u32,
}

#[derive(Debug, Clone, Default)]
pub(super) struct CoreStatusSnapshot {
    pub(super) core_pid: Option<u32>,
    pub(super) core_generation: u32,
    pub(super) core_started_at: Option<u64>,
    pub(super) last_core_exit_reason: Option<String>,
    pub(super) restart_count: u32,
    pub(super) last_recovery_at: Option<u64>,
}

/// One coherent security identity for the currently published Core. The upper half is a
/// monotonically changing instance generation and the lower half is the PID. A single Acquire
/// load can therefore never combine a recycled PID with another process generation.
///
/// This is intentionally independent of `CORE_MANAGER`'s mutex. Holding that mutex is not, by
/// itself, evidence that the child is changing: status collection and harmless lifecycle work
/// also hold it. Stop/replacement paths clear this value *before* terminating the child, while
/// start/recovery paths publish it only after the child, runtime record, IPC ACL, and running
/// configuration are committed. WFP may consequently trust one atomic read without either a
/// stale cache or a contention-triggered false revocation.
static CORE_SECURITY_IDENTITY: AtomicU64 = AtomicU64::new(0);
static NEXT_CORE_INSTANCE_GENERATION: AtomicU32 = AtomicU32::new(1);

fn next_core_instance_generation() -> u32 {
    loop {
        let generation = NEXT_CORE_INSTANCE_GENERATION.fetch_add(1, Ordering::Relaxed);
        if generation != 0 {
            return generation;
        }
    }
}

const fn pack_core_identity(pid: u32, generation: u32) -> u64 {
    ((generation as u64) << 32) | pid as u64
}

fn unpack_core_identity(identity: u64) -> Option<CoreInstanceId> {
    let pid = identity as u32;
    let generation = (identity >> 32) as u32;
    (pid != 0).then_some(CoreInstanceId { pid, generation })
}

fn publish_core_identity(running_pid: &AtomicU32, pid: u32) -> CoreInstanceId {
    debug_assert_ne!(pid, 0);
    let generation = next_core_instance_generation();
    // `running_pid` remains for process-reconciliation code. Security readers gate exclusively
    // on the packed Release publication below, so they cannot see this preparatory write alone.
    running_pid.store(pid, Ordering::Relaxed);
    CORE_SECURITY_IDENTITY.store(pack_core_identity(pid, generation), Ordering::Release);
    CoreInstanceId { pid, generation }
}

fn clear_core_identity(running_pid: &AtomicU32) {
    // Revoke the security identity first. A child that takes time to terminate is conservatively
    // treated as untrusted by WFP for that entire interval.
    CORE_SECURITY_IDENTITY.store(0, Ordering::Release);
    running_pid.store(0, Ordering::Relaxed);
}

/// Revoke the packed identity while the Windows kill-switch owns `WFP_OPERATION`.
///
/// This is atomic-only by design: it must never acquire `CORE_MANAGER` or any child/config lock,
/// because stop/start callers already own lifecycle state while the kill-switch serializes this
/// store against every DIRECT widening. Keep `running_pid` available for watchdog timeout and
/// PID-based termination fallback; process bookkeeping is cleared only after teardown.
pub(crate) fn revoke_core_security_identity_under_wfp_barrier() {
    CORE_SECURITY_IDENTITY.store(0, Ordering::Release);
}

/// Last fully collected core state. `/status` uses this when a Start/Stop handler currently owns
/// the outer manager lock, so a diagnostic read never joins a potentially long process teardown.
static LAST_CORE_STATUS: Lazy<RwLock<CoreStatusSnapshot>> =
    Lazy::new(|| RwLock::new(CoreStatusSnapshot::default()));

pub(super) async fn status_snapshot_nonblocking() -> CoreStatusSnapshot {
    let Ok(manager) = CORE_MANAGER.try_lock() else {
        let mut snapshot = LAST_CORE_STATUS.read().unwrap().clone();
        let identity = security_core_instance_snapshot();
        snapshot.core_pid = identity.map(|instance| instance.pid);
        snapshot.core_generation = identity.map_or(0, |instance| instance.generation);
        return snapshot;
    };
    let snapshot = manager.status().await;
    *LAST_CORE_STATUS.write().unwrap() = snapshot.clone();
    snapshot
}

/// Current Core identity for security decisions. One Acquire load is coherent and never waits for
/// the manager; see [`CORE_SECURITY_IDENTITY`] for the publication contract.
pub(super) fn security_core_instance_snapshot() -> Option<CoreInstanceId> {
    unpack_core_identity(CORE_SECURITY_IDENTITY.load(Ordering::Acquire))
}

impl CoreManager {
    fn new() -> Self {
        CoreManager {
            running_pid: Arc::new(AtomicU32::new(0)),
            running_process_identity: Arc::new(RwLock::new(None)),
            running_config: Mutex::new(None),
            core_start_time: Arc::new(Mutex::new(None)),
            core_started_at: Arc::new(AtomicU64::new(0)),
            last_core_exit_reason: Arc::new(Mutex::new(None)),
            restart_count: Arc::new(AtomicU32::new(0)),
            last_recovery_at: Arc::new(AtomicU64::new(0)),
            watchdog_shutdown: Mutex::new(None),
            watchdog_handle: Mutex::new(None),
            failed_child: Arc::new(Mutex::new(None)),
        }
    }

    /// The identity and configuration of the core currently running, if one is.
    ///
    /// Staging is defined relative to a live core: it writes into the generation that core was
    /// started in and reasons about the binary it was started from. Both facts live only here,
    /// which is why the decision to stage or to restart cannot be made by the client.
    ///
    /// The pid is read *after* the configuration guard is held, and the identity is returned
    /// alongside the configuration rather than merely checked. The watchdog clears it from a task
    /// that holds no lock, so reading it first would let this hand back the configuration of a core
    /// that had already died; and the caller needs the value itself in order to notice a core
    /// replaced underneath it later on.
    pub(super) async fn running_core_config(&self) -> Option<(CoreInstanceId, ClashConfig)> {
        let config = self.running_config.lock().await;
        let identity = security_core_instance_snapshot()?;
        config.clone().map(|config| (identity, config))
    }

    /// Reconcile only Tono-owned Core processes before the unprivileged App tests the fixed DNS
    /// listener. This is intentionally exposed separately from `start_core`: if an interrupted
    /// upgrade leaves an installed leftover `verge-mihomo.exe` holding loopback port 53, the App's DNS
    /// preflight otherwise fails before `start_core` can reach this same safe process sweep.
    ///
    /// A supervised Core is preserved only when the caller has just proved the complete active,
    /// fail-closed runtime. Otherwise it is stopped here, before the DNS bind test. This matters
    /// when a failed connection left the child/watchdog alive after WFP and protected DNS were
    /// released: `start_core` would replace that child, but the fixed-port preflight prevented the
    /// request from ever reaching `start_core`.
    ///
    /// Candidate identity in the fallback sweep is the canonical installed image path, never the
    /// process name alone, so a third-party DNS server or user-installed Mihomo is still reported
    /// to the App and never killed.
    pub async fn prepare_start(&self, preserve_supervised_core: bool) -> Result<u32> {
        ensure_startup_reconciled().await?;
        let action = prepare_start_core_action(
            self.running_pid.load(Ordering::Acquire),
            !cfg!(windows) || preserve_supervised_core,
        );
        let preserve_existing = matches!(action, PrepareStartCoreAction::Preserve(_));
        let mut reconciled = 0_u32;

        match action {
            PrepareStartCoreAction::Stop(pid) => {
                warn!(
                    "Stopping supervised Core {pid} before DNS preflight because no fully protected runtime vouches for it"
                );
                self.stop_core()
                    .await
                    .with_context(|| format!("failed to stop stale supervised core {pid}"))?;
                reconciled = 1;
            }
            PrepareStartCoreAction::NoCore | PrepareStartCoreAction::Preserve(_) => {}
        }

        let exempt = match action {
            PrepareStartCoreAction::Preserve(pid) => vec![pid],
            PrepareStartCoreAction::NoCore | PrepareStartCoreAction::Stop(_) => Vec::new(),
        };
        let swept = crate::core::process::sweep_orphan_core_processes(&exempt, preserve_existing)
            .await
            .context("orphaned core sweep failed before core start")?;
        Ok(reconciled.saturating_add(swept))
    }

    pub async fn start_core(&self, config: ClashConfig, owner: OwnerIdentity) -> Result<()> {
        // Keep the final start gate even though revision-11 Apps call `prepare_start` before
        // their DNS preflight. The process table can change between IPC calls, and non-App
        // clients must receive the same ownership-safe cleanup.
        // The next block replaces the supervised child under this same manager lock, so preserve
        // it across this final process-table sweep. The earlier PrepareCoreStart route already
        // stopped an unprotected child before the App's DNS bind proof.
        self.prepare_start(true).await?;
        set_core_lifecycle_state(ServiceLifecycleState::Starting);
        if self.running_pid.load(Ordering::Relaxed) != 0 {
            info!("Core is already running, stopping existing instance");
            if let Err(error) = self.stop_core().await {
                // The previous core could not be confirmed stopped, so it may still be alive
                // and unsupervised; report that as Fatal rather than parking the state at
                // Starting, which readers treat as an operation still settling.
                set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                return Err(error);
            }
            // A successful stop reports Running; re-assert Starting for the spawn below.
            set_core_lifecycle_state(ServiceLifecycleState::Starting);
        }

        info!("Starting core with config: {:?}", config);

        // This is the final gate in front of every ordinary spawn, including a start racing a
        // watchdog that just observed the previous process exit. ALE App-ID filters match the
        // executable path rather than PID/generation, so no new process may exist at that path
        // until live WFP has synchronously retracted every volatile DIRECT tuple. A failure rolls
        // the lifecycle back and, crucially, returns before `Command::spawn`.
        #[cfg(windows)]
        if let Err(error) =
            crate::core::windows_kill_switch::retract_direct_before_core_replacement().await
        {
            set_core_lifecycle_state(ServiceLifecycleState::Running);
            return Err(error.context("refusing to spawn Core while DIRECT retraction is unproven"));
        }

        // Failures below that leave no live core roll the lifecycle back to Running, the same
        // settled state a stop reports: a start that has already failed must not keep
        // reporting Starting forever.
        if let Err(error) = prepare_core_ipc_socket(&config.core_config.core_ipc_path, &owner) {
            set_core_lifecycle_state(ServiceLifecycleState::Running);
            return Err(error);
        }
        let args = core_args(&config);

        let mut child_guard = match run_with_logging(
            &config.core_config.core_path,
            &args,
            &config.log_config,
            &owner,
        )
        .await
        {
            Ok(child_guard) => child_guard,
            Err(error) => {
                set_core_lifecycle_state(ServiceLifecycleState::Running);
                return Err(error);
            }
        };
        let child_pid = child_guard.id();

        if let Err(error) = secure_core_ipc_for(&config, &owner, child_pid).await {
            if let Err(kill_error) = child_guard.kill_now().await {
                let now_secs = unix_timestamp_secs();
                *self.running_config.lock().await = Some(config.clone());
                *self.core_start_time.lock().await = Some(Instant::now());
                self.core_started_at.store(now_secs, Ordering::Relaxed);
                if let Err(record_error) = write_runtime_record_for_config(
                    child_pid,
                    &config,
                    &self.running_process_identity,
                    "after failed initial cleanup",
                )
                .await
                {
                    warn!("Failed to record unconfirmed core cleanup: {record_error:#}");
                }
                if let Some(pid) = child_pid {
                    publish_core_identity(&self.running_pid, pid);
                }
                *self.failed_child.lock().await = Some(child_guard);
                set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                return Err(anyhow!(
                    "failed to secure core IPC: {error:#}; failed to terminate spawned core: {kill_error:#}"
                ));
            }
            set_core_lifecycle_state(ServiceLifecycleState::Running);
            return Err(error);
        }

        if let Err(record_error) = write_runtime_record_for_config(
            child_pid,
            &config,
            &self.running_process_identity,
            "after start",
        )
        .await
        {
            if let Err(kill_error) = child_guard.kill_now().await {
                let now_secs = unix_timestamp_secs();
                *self.running_config.lock().await = Some(config.clone());
                *self.core_start_time.lock().await = Some(Instant::now());
                self.core_started_at.store(now_secs, Ordering::Relaxed);
                if let Some(pid) = child_pid {
                    publish_core_identity(&self.running_pid, pid);
                }
                *self.failed_child.lock().await = Some(child_guard);
                set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                return Err(anyhow!(
                    "{record_error:#}; failed to terminate unrecorded core: {kill_error:#}"
                ));
            }
            set_core_lifecycle_state(ServiceLifecycleState::Running);
            return Err(record_error);
        }

        *self.core_start_time.lock().await = Some(Instant::now());
        self.core_started_at
            .store(unix_timestamp_secs(), Ordering::Relaxed);
        *self.running_config.lock().await = Some(config.clone());
        let pid = child_pid.context("spawned core did not expose a process ID after start")?;
        publish_core_identity(&self.running_pid, pid);

        self.start_watchdog(child_guard, config, owner).await;
        set_core_lifecycle_state(ServiceLifecycleState::Running);

        Ok(())
    }

    pub async fn stop_core(&self) -> Result<()> {
        info!("Stopping core");
        LOGGER_MANAGER.clear_logs().await;

        // ALE App-ID filters identify the executable path, so another Mihomo generation at that
        // path would inherit any live DIRECT tuples. This one barrier serializes packed identity
        // revocation with exact Blocked WFP, so no App request can re-grant in between. On failure
        // leave the current process supervised (but security-revoked) and refuse replacement.
        crate::core::windows_kill_switch::retract_direct_before_core_replacement()
            .await
            .context("failed to retract DIRECT permits before stopping Core")?;

        let watchdog_result = self.stop_watchdog().await;
        let mut recovered_failed_child = false;
        // One guard for the whole retry, mutated in place. `failed_child` is a `tokio::sync::Mutex`
        // and tokio mutexes are not reentrant, so this must never take the child out under one
        // guard and put it back under another: written as
        // `if let Some(g) = self.failed_child.lock().await.take()`, the scrutinee's guard stays
        // alive for the entire then-block under edition 2024 (only the `else` block sees it
        // dropped early), so re-locking inside that block parks the task on a guard it is itself
        // holding. `stop_core` runs with CORE_MANAGER and OWNER_LIFECYCLE_LOCK held, so that park
        // is permanent and takes every mutating route down with it — ReleaseKillSwitch included,
        // which is the difference between a failed stop and an undisarmable machine.
        //
        // Holding the guard across `kill_now` is safe in a way re-locking is not: nothing is
        // acquired underneath it, so it is a leaf and cannot join a cycle, the wait is bounded by
        // `CORE_TERMINATION_TIMEOUT`, and the only other writers of this slot (`start_core` and the
        // watchdog, already joined above) are excluded by CORE_MANAGER — which also means the
        // child can no longer be lost to a concurrent store while it is out of the slot.
        let mut failed_child = self.failed_child.lock().await;
        if let Some(child_guard) = failed_child.as_mut() {
            if let Err(error) = child_guard.kill_now().await {
                // Unconfirmed dead, so it stays tracked for a later attempt, and the caller is
                // told the stop did not happen.
                return Err(error.context("failed to retry termination of tracked core"));
            }
            // Proven dead: drop the guard rather than keep retrying a process that is gone.
            *failed_child = None;
            recovered_failed_child = true;
        }
        drop(failed_child);
        if !recovered_failed_child {
            watchdog_result?;
        }

        clear_core_identity(&self.running_pid);
        *self.core_start_time.lock().await = None;
        self.core_started_at.store(0, Ordering::Relaxed);

        let start_clash = self.running_config.lock().await.take();
        let core_ipc_path = start_clash
            .as_ref()
            .map(|config| config.core_config.core_ipc_path.clone());
        if let Some(config) = start_clash {
            info!("Clearing running config: {:?}", config);
        } else {
            info!("No running config to clear");
        }

        remove_core_runtime_record().await;
        self.after_stop(core_ipc_path).await;
        set_core_lifecycle_state(ServiceLifecycleState::Running);

        Ok(())
    }

    async fn start_watchdog(
        &self,
        child_guard: ChildGuard,
        config: ClashConfig,
        owner: OwnerIdentity,
    ) {
        let running_pid_arc = Arc::clone(&self.running_pid);
        let process_identity_arc = Arc::clone(&self.running_process_identity);
        let start_time_arc = Arc::clone(&self.core_start_time);
        let started_at_arc = Arc::clone(&self.core_started_at);
        let last_exit_reason_arc = Arc::clone(&self.last_core_exit_reason);
        let restart_count_arc = Arc::clone(&self.restart_count);
        let last_recovery_at_arc = Arc::clone(&self.last_recovery_at);
        let failed_child_arc = Arc::clone(&self.failed_child);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let watchdog_config = watchdog_config();
        let arm_epoch = crate::core::windows_kill_switch::core_arm_epoch();
        // The sing-box document the current process runs (#1258).
        let mut running_document = crate::core::sing_box_fake_ip::started_document(&config).await;

        let handle = tokio::spawn(async move {
            let mut recovery_exhausted = false;
            let mut child_guard = Some(child_guard);
            let mut shutdown_rx = shutdown_rx;
            let mut restart_timestamps: Vec<Instant> = Vec::new();
            let mut consecutive_attempt = 0u32;

            'watchdog: loop {
                let Some(mut current_guard) = child_guard.take() else {
                    break;
                };

                let wait_result = {
                    let Some(child) = current_guard.inner() else {
                        break;
                    };

                    tokio::select! {
                        _ = &mut shutdown_rx => {
                            info!("Core watchdog received shutdown signal");
                            if let Err(error) = current_guard.kill_now().await {
                                *failed_child_arc.lock().await = Some(current_guard);
                                set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                                return Err(error.context(
                                    "failed to terminate core during watchdog shutdown",
                                ));
                            }
                            // Death is confirmed. Retire the PID before final WFP cleanup can
                            // stall and the join timeout can reopen this recycled number.
                            running_pid_arc.store(0, Ordering::Release);
                            break 'watchdog;
                        }
                        wait_result = child.wait() => wait_result,
                    }
                };

                let status = match wait_result {
                    Ok(status) => {
                        // wait() has reaped the child and released its process handle. Process
                        // bookkeeping must stop naming it before any metadata or WFP await.
                        // Packed security identity is still revoked under the WFP barrier below.
                        running_pid_arc.store(0, Ordering::Release);
                        status
                    }
                    Err(error) => {
                        warn!("Failed to wait for core process: {}", error);
                        if let Err(kill_error) = current_guard.kill_now().await {
                            *failed_child_arc.lock().await = Some(current_guard);
                            set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                            return Err(kill_error
                                .context("failed to terminate core after its wait failed"));
                        }
                        running_pid_arc.store(0, Ordering::Release);
                        recovery_exhausted = true;
                        break;
                    }
                };

                let uptime = start_time_arc
                    .lock()
                    .await
                    .map(|t| t.elapsed())
                    .unwrap_or_default();
                let exit_reason = log_core_exit(&status, uptime);
                *last_exit_reason_arc.lock().await = Some(exit_reason);
                set_core_lifecycle_state(ServiceLifecycleState::RecoveringCore);

                let _ = current_guard.take();
                if let Err(error) =
                    crate::core::windows_kill_switch::retract_direct_before_core_replacement().await
                {
                    // No replacement may start while a same-path ALE permit may still exist. The
                    // kill-switch watchdog independently retries the poisoned lease; the recovery
                    // loop below also proves this barrier again before every spawn attempt.
                    error!("DIRECT permits could not be retracted after Core exit: {error:#}");
                }
                // The barrier revoked packed identity while holding WFP_OPERATION. Clear process
                // tracking only afterwards; re-storing zero cannot open a widening window.
                clear_core_identity(&running_pid_arc);
                started_at_arc.store(0, Ordering::Relaxed);
                remove_core_runtime_record().await;

                let now = Instant::now();
                restart_timestamps
                    .retain(|t| now.duration_since(*t) < watchdog_config.restart_window);
                if restart_timestamps.is_empty() {
                    consecutive_attempt = 0;
                }
                restart_timestamps.push(now);

                loop {
                    if restart_timestamps.len() as u32 > watchdog_config.max_restarts {
                        error!(
                            "Core restarted {} times in {}s, giving up",
                            restart_timestamps.len(),
                            watchdog_config.restart_window.as_secs()
                        );
                        recovery_exhausted = true;
                        break 'watchdog;
                    }

                    let delay = backoff_delay(consecutive_attempt, watchdog_config.max_backoff);
                    info!(
                        "Restart attempt #{} after {}ms backoff",
                        consecutive_attempt + 1,
                        delay.as_millis()
                    );

                    if !delay.is_zero() {
                        tokio::select! {
                            _ = &mut shutdown_rx => break 'watchdog,
                            _ = tokio::time::sleep(delay) => {}
                        }
                    }

                    if let Err(error) =
                        crate::core::windows_kill_switch::retract_direct_before_core_replacement()
                            .await
                    {
                        error!(
                            "Refusing Core respawn until DIRECT permits are proven retracted: {error:#}"
                        );
                        consecutive_attempt += 1;
                        let now = Instant::now();
                        restart_timestamps.retain(|timestamp| {
                            now.duration_since(*timestamp) < watchdog_config.restart_window
                        });
                        restart_timestamps.push(now);
                        continue;
                    }

                    if let Err(error) =
                        prepare_core_ipc_socket(&config.core_config.core_ipc_path, &owner)
                    {
                        error!("Failed to prepare core IPC before restart: {error:#}");
                        consecutive_attempt += 1;
                        let now = Instant::now();
                        restart_timestamps.retain(|timestamp| {
                            now.duration_since(*timestamp) < watchdog_config.restart_window
                        });
                        restart_timestamps.push(now);
                        continue;
                    }
                    #[cfg(windows)]
                    if crate::core::update::pending() {
                        // The coordinator stopped or is replacing this generation.
                        // Watchdog restart is not successor recovery authority.
                        break 'watchdog;
                    }
                    // #1258: sing-box's fake-IP table died with the process. Restarting on the
                    // same range would hand addresses apps still cache to other names.
                    let respawn = match crate::core::sing_box_fake_ip::respawn_config(
                        &config,
                        &mut running_document,
                    )
                    .await
                    {
                        Ok(respawn) => respawn,
                        Err(error) => {
                            error!(
                                "Refusing Core respawn on the exited process's fake-IP slot: {error:#}"
                            );
                            consecutive_attempt += 1;
                            let now = Instant::now();
                            restart_timestamps.retain(|timestamp| {
                                now.duration_since(*timestamp) < watchdog_config.restart_window
                            });
                            restart_timestamps.push(now);
                            continue;
                        }
                    };
                    let args = core_args(&respawn);
                    match run_with_logging(
                        &respawn.core_config.core_path,
                        &args,
                        &respawn.log_config,
                        &owner,
                    )
                    .await
                    {
                        Ok(mut new_guard) => {
                            let new_pid = new_guard.id();
                            if let Err(error) = secure_core_ipc_for(&config, &owner, new_pid).await
                            {
                                error!("Failed to secure restarted core IPC: {error:#}");
                                if let Err(kill_error) = new_guard.kill_now().await {
                                    error!(
                                        "Failed to terminate core after IPC hardening failure: {kill_error:#}"
                                    );
                                    let now_secs = unix_timestamp_secs();
                                    *start_time_arc.lock().await = Some(Instant::now());
                                    started_at_arc.store(now_secs, Ordering::Relaxed);
                                    if let Err(record_error) = write_runtime_record_for_config(
                                        new_pid,
                                        &config,
                                        &process_identity_arc,
                                        "after failed restart cleanup",
                                    )
                                    .await
                                    {
                                        warn!(
                                            "Failed to record unconfirmed restarted core cleanup: {record_error:#}"
                                        );
                                    }
                                    if let Some(pid) = new_pid {
                                        publish_core_identity(&running_pid_arc, pid);
                                    }
                                    *failed_child_arc.lock().await = Some(new_guard);
                                    set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                                    return Err(kill_error.context(
                                        "failed to terminate restarted core after IPC hardening failure",
                                    ));
                                }
                                consecutive_attempt += 1;
                                let now = Instant::now();
                                restart_timestamps.retain(|timestamp| {
                                    now.duration_since(*timestamp) < watchdog_config.restart_window
                                });
                                restart_timestamps.push(now);
                                continue;
                            }
                            if let Err(record_error) = write_runtime_record_for_config(
                                new_pid,
                                &config,
                                &process_identity_arc,
                                "after restart",
                            )
                            .await
                            {
                                error!("Failed to commit restarted core runtime: {record_error:#}");
                                if let Err(kill_error) = new_guard.kill_now().await {
                                    let now_secs = unix_timestamp_secs();
                                    *start_time_arc.lock().await = Some(Instant::now());
                                    started_at_arc.store(now_secs, Ordering::Relaxed);
                                    if let Some(pid) = new_pid {
                                        publish_core_identity(&running_pid_arc, pid);
                                    }
                                    *failed_child_arc.lock().await = Some(new_guard);
                                    set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                                    return Err(anyhow!(
                                        "{record_error:#}; failed to terminate unrecorded restarted core: {kill_error:#}"
                                    ));
                                }
                                recovery_exhausted = true;
                                break 'watchdog;
                            }
                            // The pid is published last, and with Release, because it is what
                            // `running_core_config` gates on: everything written above is then
                            // visible to any reader that observed this instance's pid. Bumping the
                            // restart count afterwards would let a caller sample a recycled pid
                            // beside the previous instance's count and conclude nothing had
                            // changed. Until the store lands, readers see the zero written when
                            // the old core died, which they already treat as "no core".
                            let now_secs = unix_timestamp_secs();
                            *start_time_arc.lock().await = Some(Instant::now());
                            started_at_arc.store(now_secs, Ordering::Relaxed);
                            restart_count_arc.fetch_add(1, Ordering::Relaxed);
                            last_recovery_at_arc.store(now_secs, Ordering::Relaxed);
                            let Some(pid) = new_pid else {
                                recovery_exhausted = true;
                                break 'watchdog;
                            };
                            publish_core_identity(&running_pid_arc, pid);
                            consecutive_attempt += 1;
                            info!(
                                "Core restarted successfully (attempt #{})",
                                consecutive_attempt
                            );
                            set_core_lifecycle_state(ServiceLifecycleState::Running);
                            child_guard = Some(new_guard);
                            continue 'watchdog;
                        }
                        Err(error) => {
                            error!("Failed to restart core: {}", error);
                            consecutive_attempt += 1;
                            let now = Instant::now();
                            restart_timestamps.retain(|t| {
                                now.duration_since(*t) < watchdog_config.restart_window
                            });
                            restart_timestamps.push(now);
                        }
                    }
                }
            }

            if let Err(error) =
                crate::core::windows_kill_switch::retract_direct_before_core_replacement().await
            {
                // Covers wait/teardown failures that leave the loop without passing through the
                // observed-exit branch above. There is no successor spawn here, but identity must
                // still be revoked under the same writer barrier before final bookkeeping clears.
                error!("Final Core watchdog DIRECT retraction failed: {error:#}");
            }
            clear_core_identity(&running_pid_arc);
            *start_time_arc.lock().await = None;
            started_at_arc.store(0, Ordering::Relaxed);
            remove_core_runtime_record().await;
            if recovery_exhausted {
                set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                crate::core::windows_kill_switch::note_core_recovery_exhausted(arm_epoch).await;
            }
            Ok(())
        });

        *self.watchdog_shutdown.lock().await = Some(shutdown_tx);
        *self.watchdog_handle.lock().await = Some(handle);
    }

    async fn stop_watchdog(&self) -> Result<()> {
        // Both slots are emptied in their own statement, so the guard dies with the statement
        // rather than living on inside the block below it. Under edition 2024 an `if let` keeps its
        // scrutinee's temporary alive for the whole then-block, and the second block below waits
        // on a join, a task abort and a process termination — none of which may run while a
        // non-reentrant lock this task holds is still standing.
        let shutdown_tx = self.watchdog_shutdown.lock().await.take();
        if let Some(shutdown_tx) = shutdown_tx {
            let _ = shutdown_tx.send(());
        }

        let watchdog_handle = self.watchdog_handle.lock().await.take();
        if let Some(mut handle) = watchdog_handle {
            match tokio::time::timeout(WATCHDOG_JOIN_TIMEOUT, &mut handle).await {
                Ok(joined) => {
                    joined.context("watchdog task failed to join")??;
                    info!("Watchdog stopped");
                }
                Err(_) => {
                    warn!(
                        "Core watchdog did not stop within {WATCHDOG_JOIN_TIMEOUT:?}; aborting and reconciling the process"
                    );
                    handle.abort();
                    let _ = handle.await;
                    let pid = self.running_pid.load(Ordering::Acquire);
                    if pid != 0 {
                        // The original Job/Child handles may have closed during abort. Do not
                        // authorize the reopened PID using a fresh query or a disk record.
                        let (cached_pid, expected) = self
                            .running_process_identity
                            .read()
                            .unwrap()
                            .clone()
                            .context("core identity is unavailable after watchdog timeout")?;
                        if cached_pid != pid {
                            anyhow::bail!("core identity changed before watchdog timeout cleanup");
                        }
                        terminate_process_if_identity_matches(pid, &expected)
                            .await
                            .with_context(|| {
                                format!("failed to terminate core {pid} after watchdog timeout")
                            })?;
                    }
                    info!("Watchdog aborted and core process reconciled");
                }
            }
        }

        Ok(())
    }

    pub(super) async fn status(&self) -> CoreStatusSnapshot {
        let identity = security_core_instance_snapshot();
        CoreStatusSnapshot {
            core_pid: identity.map(|instance| instance.pid),
            core_generation: identity.map_or(0, |instance| instance.generation),
            core_started_at: non_zero_u64(self.core_started_at.load(Ordering::Relaxed)),
            last_core_exit_reason: self.last_core_exit_reason.lock().await.clone(),
            restart_count: self.restart_count.load(Ordering::Relaxed),
            last_recovery_at: non_zero_u64(self.last_recovery_at.load(Ordering::Relaxed)),
        }
    }

    async fn after_stop(&self, core_ipc_path: Option<String>) {
        #[cfg(unix)]
        {
            use std::path::Path;
            use tokio::fs;

            if let Some(core_ipc_path) = core_ipc_path {
                let target = Path::new(&core_ipc_path);
                info!("Removing socket file {:?}", target);
                if !target.exists() {
                    info!("{:?} does not exist, no need to remove", target);
                } else {
                    match fs::remove_file(target).await {
                        Ok(_) => info!("Successfully removed {:?}", target),
                        Err(e) => warn!("Failed to remove {:?}: {}", target, e),
                    }
                }
            }
        }
        #[cfg(not(unix))]
        {
            let _ = core_ipc_path;
        }
        LOGGER_MANAGER.clear_logs().await;
    }
}

pub async fn run_with_logging(
    bin_path: &str,
    args: &[String],
    writer_config: &WriterConfig,
    owner: &OwnerIdentity,
) -> Result<ChildGuard> {
    set_or_update_writer(writer_config).await?;

    #[cfg(windows)]
    let child = {
        let OwnerIdentity::Windows { sid } = owner else {
            return Err(anyhow!("Windows core requires a Windows owner identity"));
        };
        Command::new(bin_path)
            .args(args)
            .env("LISTEN_NAMEDPIPE_SDDL", windows_owner_pipe_sddl(sid))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?
    };

    #[cfg(unix)]
    let child = unsafe {
        let _ = owner;
        let mut command = Command::new(bin_path);
        command
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Resolve and validate the identity before fork. `CommandExt::gid` leaves only the raw
        // credential syscall in the child, avoiding environment/NSS/allocator locks in pre_exec.
        #[cfg(all(target_os = "macos", not(feature = "test")))]
        command.gid(crate::core::macos_kill_switch::dedicated_gid()?);
        command
            .pre_exec(|| {
                platform_lib::umask(0o007);
                Ok(())
            })
            .spawn()?
    };

    let mut child_guard = ChildGuard {
        child: Some(child),
        readers: Vec::new(),
        #[cfg(windows)]
        job: None,
    };

    #[cfg(windows)]
    {
        let pid = child_guard
            .id()
            .context("spawned Windows core did not expose a PID")?;
        match WindowsCoreJob::attach(pid) {
            Ok(job) => child_guard.job = Some(job),
            Err(error) => {
                let cleanup = child_guard.kill_now().await;
                return Err(match cleanup {
                    Ok(()) => error.context("failed to contain Windows core in a Job Object"),
                    Err(cleanup) => anyhow!(
                        "failed to contain Windows core in a Job Object: {error:#}; cleanup also failed: {cleanup:#}"
                    ),
                });
            }
        }
    }

    let (Some(stdout), Some(stderr)) = (
        child_guard.inner().and_then(|c| c.stdout.take()),
        child_guard.inner().and_then(|c| c.stderr.take()),
    ) else {
        return Err(anyhow!("Failed to capture child output"));
    };

    let stdout_handle = tokio::spawn(async move {
        let mut stdout_reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            let message = CompactString::from(line.as_str());
            {
                if let Some(shared_writer) = get_writer() {
                    let w = shared_writer.lock().await;
                    let mut now = DeferredNow::default();
                    let arg = format_args!("{}", line);
                    let record = Record::builder()
                        .args(arg)
                        .level(log::Level::Info)
                        .target("service")
                        .build();
                    let _ = w.write(&mut now, &record);
                }
            }
            LOGGER_MANAGER.append_log(message).await;
        }
    });

    let stderr_handle = tokio::spawn(async move {
        let mut stderr_reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            let message = CompactString::from(line.as_str());
            {
                if let Some(shared_writer) = get_writer() {
                    let w = shared_writer.lock().await;
                    let mut now = DeferredNow::default();
                    let arg = format_args!("{}", line);
                    let record = Record::builder()
                        .args(arg)
                        .level(log::Level::Error)
                        .target("service")
                        .build();
                    let _ = w.write(&mut now, &record);
                }
            }
            LOGGER_MANAGER.append_log(message).await;
        }
    });

    child_guard.readers.push(stdout_handle);
    child_guard.readers.push(stderr_handle);

    Ok(child_guard)
}

fn prepare_core_ipc_socket(core_ipc_path: &str, owner: &OwnerIdentity) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt as _;

        let OwnerIdentity::Unix { uid, .. } = owner else {
            anyhow::bail!("Unix core IPC path received a non-Unix owner");
        };
        let target = std::path::Path::new(core_ipc_path);
        let directory = target
            .parent()
            .context("core IPC path has no parent directory")?;
        let directory_c = std::ffi::CString::new(directory.as_os_str().as_bytes())
            .map_err(|_| anyhow::anyhow!("core IPC directory contains NUL"))?;
        let fd = unsafe {
            platform_lib::open(
                directory_c.as_ptr(),
                platform_lib::O_RDONLY
                    | platform_lib::O_DIRECTORY
                    | platform_lib::O_NOFOLLOW
                    | platform_lib::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("failed to open core IPC directory {directory:?}"));
        }

        let result = (|| -> Result<()> {
            let mut stat = unsafe { std::mem::zeroed::<platform_lib::stat>() };
            if unsafe { platform_lib::fstat(fd, &mut stat) } != 0 {
                return Err(std::io::Error::last_os_error())
                    .context("failed to inspect core IPC directory");
            }
            let effective_uid = unsafe { platform_lib::geteuid() };
            if stat.st_mode & platform_lib::S_IFMT != platform_lib::S_IFDIR
                || (stat.st_uid != 0 && stat.st_uid != *uid && stat.st_uid != effective_uid)
            {
                anyhow::bail!("core IPC directory has an unexpected owner or file type");
            }
            if unsafe { platform_lib::fchmod(fd, 0o700 as platform_lib::mode_t) } != 0 {
                return Err(std::io::Error::last_os_error())
                    .context("failed to make core IPC directory private");
            }
            if effective_uid == 0 && unsafe { platform_lib::fchown(fd, 0, 0) } != 0 {
                return Err(std::io::Error::last_os_error())
                    .context("failed to take ownership of core IPC directory");
            }

            let file_name = target
                .file_name()
                .context("core IPC path has no file name")?;
            let file_name_c = std::ffi::CString::new(file_name.as_bytes())
                .map_err(|_| anyhow::anyhow!("core IPC file name contains NUL"))?;
            if unsafe { platform_lib::unlinkat(fd, file_name_c.as_ptr(), 0) } != 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(error).context("failed to clear stale core IPC entry");
                }
            }
            Ok(())
        })();
        unsafe { platform_lib::close(fd) };
        result
    }

    #[cfg(windows)]
    {
        let _ = (core_ipc_path, owner);
        Ok(())
    }
}

#[cfg(unix)]
fn grant_core_ipc_directory_to_owner(target: &std::path::Path, uid: u32, gid: u32) -> Result<()> {
    use std::os::unix::ffi::OsStrExt as _;

    let directory = target
        .parent()
        .context("core IPC path has no parent directory")?;
    let directory_c = std::ffi::CString::new(directory.as_os_str().as_bytes())
        .map_err(|_| anyhow::anyhow!("core IPC directory contains NUL"))?;
    let fd = unsafe {
        platform_lib::open(
            directory_c.as_ptr(),
            platform_lib::O_RDONLY
                | platform_lib::O_DIRECTORY
                | platform_lib::O_NOFOLLOW
                | platform_lib::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error()).context("failed to reopen core IPC directory");
    }
    let result = if unsafe { platform_lib::geteuid() } == 0
        && unsafe { platform_lib::fchown(fd, uid, gid) } != 0
    {
        Err(std::io::Error::last_os_error()).context("failed to grant core IPC directory to owner")
    } else if unsafe { platform_lib::fchmod(fd, 0o700 as platform_lib::mode_t) } != 0 {
        Err(std::io::Error::last_os_error()).context("failed to secure granted core IPC directory")
    } else {
        Ok(())
    };
    unsafe { platform_lib::close(fd) };
    result
}

/// Only Mihomo serves the owner-scoped controller pipe (`-ext-ctl-pipe`). sing-box is launched
/// with `run -c` and its controller is the loopback `clash_api` behind a 32-byte compiler secret,
/// so it never creates that pipe. Waiting for it refused every sing-box start after two seconds.
fn core_serves_ipc_pipe(core_path: &str) -> bool {
    !crate::core::structure::is_sing_box_core_path(core_path)
}

async fn secure_core_ipc_for(
    config: &ClashConfig,
    owner: &OwnerIdentity,
    expected_pid: Option<u32>,
) -> Result<()> {
    if !core_serves_ipc_pipe(&config.core_config.core_path) {
        return Ok(());
    }
    secure_core_ipc_socket(
        config.core_config.core_ipc_path.clone(),
        owner.clone(),
        expected_pid,
    )
    .await
}

async fn secure_core_ipc_socket(
    core_ipc_path: String,
    owner: OwnerIdentity,
    expected_pid: Option<u32>,
) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::FileTypeExt as _;

        let _ = expected_pid;
        let OwnerIdentity::Unix { uid, gid } = owner else {
            anyhow::bail!("Unix core IPC path received a non-Unix owner");
        };
        let target = std::path::PathBuf::from(core_ipc_path);
        let mut found = false;
        for _ in 0..40 {
            match tokio::fs::symlink_metadata(&target).await {
                Ok(metadata) if metadata.file_type().is_socket() => {
                    found = true;
                    break;
                }
                Ok(_) => {
                    anyhow::bail!("core IPC path {target:?} is not a socket");
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(error) => {
                    return Err(error.into());
                }
            }
        }
        if !found {
            anyhow::bail!("core IPC socket did not appear at {target:?}");
        }
        let path = std::ffi::CString::new(target.as_os_str().as_bytes())
            .map_err(|_| anyhow::anyhow!("core IPC socket path contains NUL"))?;
        let chown_ok = unsafe { platform_lib::geteuid() } != 0
            || unsafe { platform_lib::lchown(path.as_ptr(), uid, gid) } == 0;
        let chmod_ok = unsafe {
            platform_lib::fchmodat(
                platform_lib::AT_FDCWD,
                path.as_ptr(),
                0o600 as platform_lib::mode_t,
                platform_lib::AT_SYMLINK_NOFOLLOW,
            )
        } == 0;
        let os_error = (!chown_ok || !chmod_ok).then(std::io::Error::last_os_error);
        if !chown_ok || !chmod_ok {
            return Err(os_error
                .unwrap_or_else(std::io::Error::last_os_error)
                .into());
        }
        grant_core_ipc_directory_to_owner(&target, uid, gid)?;
        info!("Secured core IPC socket {:?} for uid {}", target, uid);
        Ok(())
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt as _;
        use std::os::windows::io::FromRawHandle as _;
        use windows_sys::Win32::Foundation::{INVALID_HANDLE_VALUE, LocalFree};
        use windows_sys::Win32::Security::Authorization::{
            ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
            SE_KERNEL_OBJECT, SetSecurityInfo,
        };
        use windows_sys::Win32::Security::{
            DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl,
            PROTECTED_DACL_SECURITY_INFORMATION,
        };
        use windows_sys::Win32::Storage::FileSystem::{
            CreateFileW, FILE_ATTRIBUTE_NORMAL, OPEN_EXISTING, READ_CONTROL, WRITE_DAC,
        };
        use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;

        let OwnerIdentity::Windows { sid } = owner else {
            anyhow::bail!("Windows core IPC path received a non-Windows owner");
        };
        let mut pipe: Vec<u16> = std::ffi::OsStr::new(&core_ipc_path).encode_wide().collect();
        pipe.push(0);
        let mut handle_value = INVALID_HANDLE_VALUE as isize;
        // The pipe usually appears well inside the first 50ms tick; poll fast early, then fall
        // back to the coarse grid. The overall budget stays 2s (10 x 20ms + 36 x 50ms).
        for attempt in 0..46 {
            handle_value = unsafe {
                CreateFileW(
                    pipe.as_ptr(),
                    READ_CONTROL | WRITE_DAC,
                    0,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    std::ptr::null_mut(),
                )
            } as isize;
            if handle_value != INVALID_HANDLE_VALUE as isize {
                break;
            }
            let poll_ms = if attempt < 10 { 20 } else { 50 };
            tokio::time::sleep(Duration::from_millis(poll_ms)).await;
        }
        if handle_value == INVALID_HANDLE_VALUE as isize {
            return Err(std::io::Error::last_os_error().into());
        }
        let handle = handle_value as *mut std::ffi::c_void;
        let _pipe = unsafe { std::fs::File::from_raw_handle(handle) };
        let mut server_pid = 0u32;
        if unsafe { GetNamedPipeServerProcessId(handle_value as _, &mut server_pid) } == 0 {
            return Err(std::io::Error::last_os_error())
                .context("failed to identify core IPC pipe server");
        }
        if Some(server_pid) != expected_pid {
            anyhow::bail!(
                "core IPC pipe server PID {server_pid} did not match spawned core PID {expected_pid:?}"
            );
        }

        let sddl = windows_owner_pipe_sddl(&sid);
        let mut wide: Vec<u16> = sddl.encode_utf16().collect();
        wide.push(0);
        let mut descriptor = std::ptr::null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        } == 0
            || descriptor.is_null()
        {
            return Err(std::io::Error::last_os_error().into());
        }
        struct LocalDescriptor(*mut std::ffi::c_void);
        impl Drop for LocalDescriptor {
            fn drop(&mut self) {
                unsafe { LocalFree(self.0) };
            }
        }
        let descriptor_guard = LocalDescriptor(descriptor);
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl = std::ptr::null_mut();
        if unsafe {
            GetSecurityDescriptorDacl(descriptor_guard.0, &mut present, &mut dacl, &mut defaulted)
        } == 0
            || present == 0
            || dacl.is_null()
        {
            anyhow::bail!("failed to read owner core IPC DACL");
        }
        let status = unsafe {
            SetSecurityInfo(
                handle,
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                dacl,
                std::ptr::null(),
            )
        };
        if status != 0 {
            anyhow::bail!("failed to secure core IPC pipe: Windows error {status}");
        }
        info!("Secured core IPC pipe for owner SID");
        Ok(())
    }
}

#[cfg(any(windows, test))]
fn windows_owner_pipe_sddl(sid: &str) -> String {
    format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)(A;;GA;;;BA)")
}

pub static CORE_MANAGER: Lazy<Arc<Mutex<CoreManager>>> =
    Lazy::new(|| Arc::new(Mutex::new(CoreManager::new())));

/// Seed only the identity/config fields read by kill-switch unit tests. No child or watchdog is
/// created, and clearing publishes PID zero before dropping the synthetic config just like the
/// real watchdog teardown path.
#[cfg(test)]
pub(super) async fn set_running_core_identity_for_kill_switch_tests(identity: Option<(u32, u32)>) {
    let manager = CORE_MANAGER.lock().await;
    match identity {
        Some((pid, generation)) => {
            *manager.running_config.lock().await = Some(ClashConfig {
                core_config: crate::CoreConfig {
                    core_path: "test-mihomo".to_owned(),
                    core_ipc_path: "test-controller".to_owned(),
                    config_path: "test-config".to_owned(),
                    config_dir: "test-runtime".to_owned(),
                },
                log_config: WriterConfig {
                    directory: "test-logs".to_owned(),
                    max_log_size: 1,
                    max_log_files: 1,
                },
            });
            manager.restart_count.store(generation, Ordering::Relaxed);
            manager.running_pid.store(pid, Ordering::Relaxed);
            CORE_SECURITY_IDENTITY.store(pack_core_identity(pid, generation), Ordering::Release);
        }
        None => {
            clear_core_identity(&manager.running_pid);
            *manager.running_config.lock().await = None;
            manager.restart_count.store(0, Ordering::Relaxed);
        }
    }
}

pub static LOGGER_MANAGER: Lazy<Arc<AsyncLogger>> = Lazy::new(|| Arc::new(AsyncLogger::new()));

#[cfg(test)]
mod prepare_start_action_tests {
    use super::{PrepareStartCoreAction, prepare_start_core_action};

    #[test]
    fn inactive_supervised_dns_owner_is_stopped_before_preflight() {
        assert_eq!(
            prepare_start_core_action(4860, false),
            PrepareStartCoreAction::Stop(4860)
        );
        assert_eq!(
            prepare_start_core_action(4860, true),
            PrepareStartCoreAction::Preserve(4860)
        );
        assert_eq!(
            prepare_start_core_action(0, false),
            PrepareStartCoreAction::NoCore
        );
    }
}

#[cfg(test)]
mod sing_box_ipc_tests {
    use super::secure_core_ipc_for;
    use crate::core::structure::{ClashConfig, CoreConfig};
    use crate::{OwnerIdentity, WriterConfig};

    fn config(core_path: &str) -> ClashConfig {
        ClashConfig {
            core_config: CoreConfig {
                core_path: core_path.into(),
                core_ipc_path: if cfg!(windows) {
                    r"\\.\pipe\tono-core-absent-test".into()
                } else {
                    "/tmp/tono-core-absent-test.sock".into()
                },
                config_path: "unused-config".into(),
                config_dir: "unused-runtime".into(),
            },
            log_config: WriterConfig {
                directory: "unused-logs".into(),
                max_log_size: 1,
                max_log_files: 1,
            },
        }
    }

    fn owner() -> OwnerIdentity {
        #[cfg(windows)]
        {
            OwnerIdentity::Windows {
                sid: "S-1-5-21-1-2-3-1001".into(),
            }
        }
        #[cfg(not(windows))]
        {
            OwnerIdentity::Unix { uid: 501, gid: 20 }
        }
    }

    #[tokio::test]
    async fn a_sing_box_start_does_not_wait_for_the_mihomo_controller_pipe() {
        assert!(
            secure_core_ipc_for(&config("sing-box.exe"), &owner(), Some(4242))
                .await
                .is_ok()
        );
        assert!(
            secure_core_ipc_for(&config("tono-core.exe"), &owner(), Some(4242))
                .await
                .is_err()
        );
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{ChildGuard, CoreManager, prepare_core_ipc_socket, secure_core_ipc_socket};
    use crate::core::state::core_lifecycle_state;
    use crate::core::structure::{ClashConfig, CoreConfig, ServiceLifecycleState};
    use crate::{OwnerIdentity, WriterConfig};
    use serial_test::serial;
    use std::os::unix::fs::PermissionsExt as _;
    use std::process::Stdio;
    use std::time::Duration;

    /// A guard whose `kill_now` is guaranteed to fail, without needing a process that ignores
    /// termination. Tokio refuses to kill a child it has already reaped, which is the same shape of
    /// failure as the real one: a kill the service cannot confirm.
    static SIMULATE_KILL_FAILURE: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);

    /// Whether `kill_now` should report an unconfirmed kill; see the seam in `kill_now`.
    pub(super) fn kill_failure_is_simulated() -> bool {
        SIMULATE_KILL_FAILURE.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Guard that resets the seam even if the test panics, so one failure cannot cascade.
    struct SimulatedKillFailure;

    impl SimulatedKillFailure {
        fn arm() -> Self {
            SIMULATE_KILL_FAILURE.store(true, std::sync::atomic::Ordering::Relaxed);
            Self
        }
    }

    impl Drop for SimulatedKillFailure {
        fn drop(&mut self) {
            SIMULATE_KILL_FAILURE.store(false, std::sync::atomic::Ordering::Relaxed);
        }
    }

    /// A child that is already reaped. Note this does NOT make `kill_now` fail — tokio answers
    /// `start_kill` on a finished child with `Ok` — so the failure itself comes from the seam.
    async fn reaped_guard() -> anyhow::Result<ChildGuard> {
        let mut child = tokio::process::Command::new("/bin/sh")
            .arg("-c")
            .arg("exit 0")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        child.wait().await?;
        Ok(ChildGuard {
            child: Some(child),
            readers: Vec::new(),
        })
    }

    #[tokio::test]
    #[serial]
    async fn an_exited_core_pid_is_retired_before_watchdog_cleanup_waits() -> anyhow::Result<()> {
        let manager = CoreManager::new();
        let child = tokio::process::Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let pid = child.id().expect("the unreaped child exposes its PID");
        manager
            .running_pid
            .store(pid, std::sync::atomic::Ordering::Release);
        // The actual watchdog must process the exit, then wait here before final teardown.
        let reason_guard = manager.last_core_exit_reason.lock().await;
        manager
            .start_watchdog(
                ChildGuard {
                    child: Some(child),
                    readers: Vec::new(),
                },
                ClashConfig {
                    core_config: CoreConfig {
                        core_path: "unused-core".into(),
                        core_ipc_path: "unused-controller".into(),
                        config_path: "unused-config".into(),
                        config_dir: "unused-runtime".into(),
                    },
                    log_config: WriterConfig {
                        directory: "unused-logs".into(),
                        max_log_size: 1,
                        max_log_files: 1,
                    },
                },
                OwnerIdentity::Unix {
                    uid: unsafe { platform_lib::geteuid() },
                    gid: unsafe { platform_lib::getegid() },
                },
            )
            .await;
        let retired = tokio::time::timeout(Duration::from_secs(2), async {
            while manager
                .running_pid
                .load(std::sync::atomic::Ordering::Acquire)
                != 0
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .is_ok();
        // Abort directly: the baseline's PID fallback is the behavior under review and must
        // never be allowed to signal an unrelated process in a failing test.
        let handle = manager
            .watchdog_handle
            .lock()
            .await
            .take()
            .expect("watchdog is installed");
        handle.abort();
        let _ = handle.await;
        drop(reason_guard);
        assert!(
            retired,
            "confirmed exit must retire the PID before cleanup can block"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn watchdog_timeout_does_not_kill_a_reused_pid() -> anyhow::Result<()> {
        let manager = CoreManager::new();
        let mut child = tokio::process::Command::new("/bin/sleep")
            .arg("30")
            .kill_on_drop(true)
            .spawn()?;
        let pid = child.id().expect("the child exposes its PID");
        let mut expected = super::process_identity(pid)?.expect("the child has an identity");
        expected.started_at += 1;
        manager
            .running_pid
            .store(pid, std::sync::atomic::Ordering::Release);
        *manager.running_process_identity.write().unwrap() = Some((pid, expected));
        // Represent the stalled watchdog after its original guard has been dropped. The live
        // child models another process now using the recorded PID; only creation time differs.
        *manager.watchdog_handle.lock().await = Some(tokio::spawn(async {
            std::future::pending::<anyhow::Result<()>>().await
        }));
        let result = manager.stop_watchdog().await;
        let survived = child.try_wait()?.is_none();
        // Clean up before assertions, including when the original fallback killed the fixture.
        let _ = child.kill().await;
        let _ = child.wait().await;
        result?;
        assert!(
            survived,
            "watchdog timeout must not terminate a different process incarnation"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn owner_core_socket_is_private() -> anyhow::Result<()> {
        let directory = std::env::temp_dir().join(format!("cvs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir(&directory)?;
        let path = directory.join("tono-core.sock");
        let listener = tokio::net::UnixListener::bind(&path)?;
        let owner = OwnerIdentity::Unix {
            uid: unsafe { platform_lib::geteuid() },
            gid: unsafe { platform_lib::getegid() },
        };

        prepare_core_ipc_socket(&path.to_string_lossy(), &owner)?;
        drop(listener);
        let listener = tokio::net::UnixListener::bind(&path)?;
        secure_core_ipc_socket(path.to_string_lossy().into_owned(), owner, None).await?;

        let mut mode = 0;
        for _ in 0..40 {
            mode = std::fs::metadata(&path)?.permissions().mode() & 0o777;
            if mode == 0o600 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(mode, 0o600);
        drop(listener);
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn failed_core_spawn_rolls_lifecycle_back_to_settled() -> anyhow::Result<()> {
        let directory = std::env::temp_dir().join(format!("cvs-start-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir(&directory)?;
        let path_of = |name: &str| directory.join(name).to_string_lossy().into_owned();
        let config = ClashConfig {
            core_config: CoreConfig {
                core_path: path_of("missing-core"),
                core_ipc_path: path_of("tono-core.sock"),
                config_path: path_of("config.yaml"),
                config_dir: directory.to_string_lossy().into_owned(),
            },
            log_config: WriterConfig {
                directory: directory.to_string_lossy().into_owned(),
                max_log_size: 1024 * 1024,
                max_log_files: 1,
            },
        };
        let owner = OwnerIdentity::Unix {
            uid: unsafe { platform_lib::geteuid() },
            gid: unsafe { platform_lib::getegid() },
        };

        let manager = CoreManager::new();
        assert!(manager.start_core(config, owner).await.is_err());

        // A start that failed without leaving a core must not stay parked at Starting.
        assert_eq!(core_lifecycle_state(), ServiceLifecycleState::Running);
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn a_failed_retry_termination_returns_instead_of_waiting_on_its_own_guard()
    -> anyhow::Result<()> {
        let manager = CoreManager::new();
        let _simulated = SimulatedKillFailure::arm();
        *manager.failed_child.lock().await = Some(reaped_guard().await?);

        // The timeout is the assertion. `stop_core` runs under CORE_MANAGER and the owner
        // lifecycle lock, so a self-deadlock here does not merely hang this call: it wedges every
        // mutating route, kill-switch release included, for the life of the service.
        let result = tokio::time::timeout(Duration::from_secs(5), manager.stop_core())
            .await
            .expect("stop_core must return rather than re-lock a mutex this task already holds");

        let error = result.expect_err("a kill that could not be confirmed is not a stop");
        assert!(
            format!("{error:#}").contains("failed to retry termination of tracked core"),
            "{error:#}"
        );
        assert!(
            manager.failed_child.lock().await.is_some(),
            "a core that may still be alive stays tracked for a later attempt"
        );
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn a_confirmed_kill_stops_tracking_the_child() -> anyhow::Result<()> {
        let manager = CoreManager::new();
        // No process left to kill, so `kill_now` succeeds — the other half of the retry's
        // contract, which the deadlock fix must not have turned into a permanent retry.
        *manager.failed_child.lock().await = Some(ChildGuard {
            child: None,
            readers: Vec::new(),
        });

        manager.stop_core().await?;

        assert!(manager.failed_child.lock().await.is_none());
        Ok(())
    }
}

#[cfg(test)]
mod windows_pipe_tests {
    use super::windows_owner_pipe_sddl;

    #[test]
    fn windows_owner_pipe_dacl_excludes_everyone_and_authenticated_users() {
        let sddl = windows_owner_pipe_sddl("S-1-5-21-1-2-3-1001");

        assert!(sddl.contains(";;;S-1-5-21-1-2-3-1001)"));
        assert!(sddl.contains(";;;SY)"));
        assert!(sddl.contains(";;;BA)"));
        assert!(!sddl.contains(";;;WD)"));
        assert!(!sddl.contains(";;;AU)"));
    }
}

#[cfg(all(test, unix))]
mod exhaustion_tests {
    use super::*;
    use serial_test::serial;
    #[tokio::test]
    #[serial]
    async fn exhausted_core_recovery_releases_non_strict_general_traffic() -> Result<()> {
        let manager = CoreManager::new();
        set_core_watchdog_config_for_tests(Some(CoreWatchdogTestConfig {
            max_restarts: 0,
            restart_window: Duration::from_secs(10),
            max_backoff: Duration::ZERO,
        }));
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                set_core_watchdog_config_for_tests(None);
            }
        }
        let _reset = Reset;
        let child = Command::new("/bin/sh")
            .args(["-c", "exit 1"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let pid = child.id().unwrap();
        publish_core_identity(&manager.running_pid, pid);
        let owner = OwnerIdentity::Unix {
            uid: unsafe { platform_lib::geteuid() },
            gid: unsafe { platform_lib::getegid() },
        };
        let kill_switch = crate::core::structure::KillSwitchConfig {
            tunnel_interface: "Tono".into(),
            proxy_endpoints: vec![crate::ProxyEndpoint {
                ip: "11.22.33.44".into(),
                port: 443,
                protocol: crate::ProxyProtocol::Tcp,
            }],
            bootstrap_api_hosts: vec!["1.1.1.1".into()],
            direct_endpoints: vec![],
        };
        crate::core::windows_kill_switch::arm_bootstrap(
            &kill_switch,
            "/opt/tono/mihomo",
            "owner-alice",
        )
        .await?;
        crate::core::windows_kill_switch::lock(None).await?;
        crate::core::windows_kill_switch::mark_verified("owner-alice").await?;
        let config = ClashConfig {
            core_config: crate::CoreConfig {
                core_path: "unused".into(),
                core_ipc_path: "unused".into(),
                config_path: "unused".into(),
                config_dir: "unused".into(),
            },
            log_config: WriterConfig {
                directory: "unused".into(),
                max_log_size: 1,
                max_log_files: 1,
            },
        };
        manager
            .start_watchdog(
                ChildGuard {
                    child: Some(child),
                    readers: vec![],
                },
                config,
                owner,
            )
            .await;
        let handle = manager.watchdog_handle.lock().await.take().unwrap();
        tokio::time::timeout(Duration::from_secs(3), handle).await???;
        crate::core::windows_kill_switch::spawn_windows_kill_switch_watchdog();
        let released = tokio::time::timeout(Duration::from_secs(3), async {
            while crate::core::windows_kill_switch::status().await.wanted {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .is_ok();
        let status = crate::core::windows_kill_switch::status().await;
        let ai_hold = crate::core::selective_layer::test_hold_active();
        let core_missing = security_core_instance_snapshot().is_none();
        eprintln!(
            "exhausted Core: missing={core_missing}, wanted={}, verified={}, mode={:?}, tun={}",
            status.wanted, status.verified, status.mode, status.tunnel_permit_rendered
        );
        crate::core::windows_kill_switch::release().await?;
        assert!(core_missing);
        assert!(
            released && !status.wanted,
            "exhausted non-strict recovery must release ordinary internet even when the App monitor is absent"
        );
        assert!(
            ai_hold,
            "automatic exhaustion release must retain the secondary AI hold"
        );
        Ok(())
    }
}
