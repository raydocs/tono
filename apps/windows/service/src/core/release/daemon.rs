//! The release service (`TonoRelease`): owns the release pipe and one worker at a time.
//!
//! A request starts a worker, or joins the one already running, and is answered when the
//! worker finishes or at [`RELEASE_ANSWER_SECONDS`], whichever comes first. The worker runs in
//! a kill-on-close Job Object this service holds; at [`RELEASE_HARD_CAP_SECONDS`] the Job is
//! terminated and everything in it ends. After every run, and when the service starts, a main
//! Service left quarantined by a worker that died is put back.
//!
//! A worker's exit proves nothing about the children it started (Sol R-F2 on PR #1569). Each
//! worker records `jobs_unproven` before its first effect; this service clears it, under C,
//! only once every Job it holds has been terminated and reports no active process. A Job that
//! still has a process is kept and checked again, never dropped and forgotten. If this service
//! ends first, nothing clears it: admission keeps refusing (Sol R2-F2).
//!
//! The worker's own final line is not the answer either: a run is answered as finished only
//! after its Job was retired and [`finalize`] read every component back again, and only then
//! does the record say `completed`.

use super::{Authority, Incarnation, Processes, WorkerInput};
use crate::release_wire::{
    RELEASE_ANSWER_SECONDS, RELEASE_HARD_CAP_SECONDS, ReleaseReport, ReleaseRequest, ReleaseStatus,
};
use std::io::{BufRead as _, BufReader, Write as _};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

struct Run {
    request_id: String,
    started: Instant,
    state: Mutex<RunState>,
    changed: Condvar,
    /// The worker's kill-on-close Job; dropping it ends the worker and everything it started.
    job: Mutex<Option<std::os::windows::io::OwnedHandle>>,
}

#[derive(Default)]
struct RunState {
    latest: Option<ReleaseReport>,
    done: bool,
}

impl Run {
    fn publish(&self, report: ReleaseReport) {
        let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.latest = Some(report);
        self.changed.notify_all();
    }

    fn finish(&self) {
        let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        state.done = true;
        self.changed.notify_all();
    }

    /// End everything in the Job. The handle is kept so that emptiness can be proven.
    fn end_job(&self) {
        if let Some(job) = self
            .job
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            && let Err(error) = terminate_job(job)
        {
            tracing::warn!("release: {error:#}");
        }
    }

    /// The Job once the worker is gone: dropped when proven empty, otherwise kept pending.
    fn retire_job(&self) {
        let Some(job) = self
            .job
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        else {
            return;
        };
        if let Err(error) = terminate_job(&job) {
            tracing::warn!("release: {error:#}");
        }
        let deadline = Instant::now() + JOB_EMPTY_WAIT;
        loop {
            match active_processes(&job) {
                Ok(0) => return,
                Ok(_) | Err(_) if Instant::now() >= deadline => break,
                _ => std::thread::sleep(Duration::from_millis(100)),
            }
        }
        tracing::warn!("release: a worker Job still has processes; keeping it until it is empty");
        PENDING_JOBS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(job);
    }

    fn is_done(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .done
    }

    fn latest(&self) -> Option<ReleaseReport> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .latest
            .clone()
    }

    /// The report as it stands when the run is done or at the deadline. The worker's final line
    /// is not the answer (Sol R2-F2): a run is done only after its Job was retired and
    /// [`finalize`] checked the result, so an answer given before that is never finished.
    fn answer(&self, deadline: Instant) -> ReleaseReport {
        let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        loop {
            if state.done {
                break;
            }
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            state = self
                .changed
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
        let mut report = state.latest.clone().unwrap_or_else(|| {
            let mut report = ReleaseReport::without_components(
                &self.request_id,
                "unknown",
                Some("the release worker has not reported yet".into()),
            );
            report.finished = false;
            report
        });
        if !state.done {
            // The Job is not yet proven empty: keep what was read, but nothing read so far is
            // known to stay that way (Sol R3-M2).
            report.finished = false;
            super::mark_risk_unproven(&mut report);
        }
        if !report.finished && !matches!(report.outcome.as_str(), "busy" | "superseded" | "refused") {
            report.outcome =
                ReleaseReport::outcome_of(&report.components, &report.stuck, false).to_owned();
        }
        report
    }
}

static CURRENT: Mutex<Option<Arc<Run>>> = Mutex::new(None);
/// Terminated worker Jobs that still reported a process. Held, so kill-on-close still covers
/// them, until they are proven empty.
static PENDING_JOBS: Mutex<Vec<std::os::windows::io::OwnedHandle>> = Mutex::new(Vec::new());
/// How long a terminated Job gets to empty before it is kept pending.
const JOB_EMPTY_WAIT: Duration = Duration::from_secs(10);
const PENDING_JOB_RECHECK: Duration = Duration::from_secs(5);

fn terminate_job(job: &std::os::windows::io::OwnedHandle) -> anyhow::Result<()> {
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::TerminateJobObject;

    // SAFETY: the handle is owned by `job` and stays open across the call.
    if unsafe { TerminateJobObject(job.as_raw_handle() as HANDLE, 1) } == 0 {
        return Err(anyhow::Error::from(std::io::Error::last_os_error())
            .context("failed to terminate a release worker Job Object"));
    }
    Ok(())
}

/// How many processes are still in the Job.
fn active_processes(job: &std::os::windows::io::OwnedHandle) -> anyhow::Result<u32> {
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JobObjectBasicAccountingInformation,
        QueryInformationJobObject,
    };

    let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
    // SAFETY: `info` is a writable buffer of the size passed, and the handle stays open.
    if unsafe {
        QueryInformationJobObject(
            job.as_raw_handle() as HANDLE,
            JobObjectBasicAccountingInformation,
            (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
            std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(anyhow::Error::from(std::io::Error::last_os_error())
            .context("failed to query a release worker Job Object"));
    }
    Ok(info.ActiveProcesses)
}

/// Drop the pending Jobs that have emptied; `true` when none is left.
fn prune_pending_jobs() -> bool {
    let mut pending = PENDING_JOBS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    pending.retain(|job| {
        let _ = terminate_job(job);
        !matches!(active_processes(job), Ok(0))
    });
    pending.is_empty()
}

fn own_incarnation() -> anyhow::Result<Incarnation> {
    let pid = std::process::id();
    let started_at = crate::core::process::process_started_at(pid)?
        .ok_or_else(|| anyhow::anyhow!("the release service cannot read its own start time"))?;
    Ok(Incarnation { pid, started_at })
}

/// The worker's verdict, checked by the service that holds its Job (Sol R2-F2). `restored`
/// stands, and the record says `completed`, only when every Job this service holds is proven
/// empty and a read-back taken after that agrees with the worker's final one. Otherwise the
/// read-back is reported with unknown risk. Runs once the worker has exited and its Job was
/// retired, before the run is done.
fn finalize(run: &Run) {
    let Some(mut report) = run.latest() else {
        return;
    };
    if !report.finished || matches!(report.outcome.as_str(), "busy" | "superseded" | "refused") {
        return;
    }
    if let Some(Incomplete { reason, readings }) = complete(run, &report) {
        tracing::warn!("release: not completed: {reason}");
        // What the service read last is the state now; the worker's earlier read is not
        // (Sol R3-M2). Either way, no component is known to stay as read.
        if let Some(readings) = &readings {
            super::fold_final_readings(&mut report, readings);
        }
        super::mark_risk_unproven(&mut report);
        report.outcome = ReleaseReport::outcome_of(&report.components, &report.stuck, true).to_owned();
        report.detail = Some(match report.detail.take() {
            Some(detail) => format!("{detail}; {reason}"),
            None => reason,
        });
        run.publish(report);
    }
}

/// Why a run was not completed, with the service's own final read-back when it took one.
struct Incomplete {
    reason: String,
    readings: Option<Vec<super::worker::Reading>>,
}

impl From<String> for Incomplete {
    fn from(reason: String) -> Self {
        Self { reason, readings: None }
    }
}

/// `None` when the run completed, or when it never claimed to (nothing to take back). Under C,
/// so no worker or admission moves the record in between.
fn complete(run: &Run, report: &ReleaseReport) -> Option<Incomplete> {
    let claims_settled = !report.components.is_empty()
        && report.stuck.is_empty()
        && report.components.iter().all(|component| component.risk == "settled");
    let own = match own_incarnation() {
        Ok(own) => own,
        Err(error) => return Some(format!("{error:#}").into()),
    };
    let authority = Authority::live();
    let _held = match authority.lock(Duration::from_secs(5)) {
        Ok(Some(held)) => held,
        Ok(None) => {
            return Some(String::from("the release lock could not be taken to record the restore as complete").into());
        }
        Err(error) => return Some(format!("{error:#}").into()),
    };
    if !prune_pending_jobs() {
        return Some(String::from("a process the restore started is still running").into());
    }
    let mut record = match authority.load() {
        Ok(record) => record,
        Err(error) => return Some(format!("{error:#}").into()),
    };
    if record.request_id.as_deref() != Some(run.request_id.as_str())
        || record.job_owner != Some(own)
        || !record.worker_finished
    {
        return Some(String::from("the restore record changed before the restore could be completed").into());
    }
    record.jobs_unproven = false;
    let mut incomplete = None;
    if claims_settled {
        match read_back_now() {
            Ok(after) => {
                for component in &report.components {
                    let now = after.iter().find(|(name, _, _)| *name == component.name);
                    if now.is_none_or(|(_, readback, _)| *readback != component.readback || readback == "unreadable") {
                        incomplete = Some(Incomplete {
                            reason: format!(
                                "{} read back differently after the restore's processes ended",
                                component.name
                            ),
                            readings: None,
                        });
                        break;
                    }
                }
                if let Some(incomplete) = &mut incomplete {
                    incomplete.readings = Some(after);
                }
            }
            Err(error) => incomplete = Some(format!("the final read-back failed: {error:#}").into()),
        }
        record.completed = incomplete.is_none();
    }
    if let Err(error) = authority.save(&record) {
        let reason = format!("the completed restore could not be recorded: {error:#}");
        return Some(match incomplete {
            Some(incomplete) => Incomplete { reason: format!("{}; {reason}", incomplete.reason), ..incomplete },
            None => reason.into(),
        });
    }
    if claims_settled { incomplete } else { None }
}

/// The worker's read-back, taken by this service on a runtime of its own.
fn read_back_now() -> anyhow::Result<Vec<super::worker::Reading>> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let readings = runtime.block_on(super::worker::read_components());
    runtime.shutdown_background();
    Ok(readings)
}

/// Clear `jobs_unproven` once every Job this service holds is proven empty and no run is in
/// progress. Under C, so a worker starting now cannot have its own mark cleared. It never marks
/// a release completed: only [`finalize`] does, with a read-back.
fn settle_jobs() {
    if !prune_pending_jobs() {
        return;
    }
    let Ok(own) = own_incarnation() else {
        return;
    };
    let authority = Authority::live();
    let Ok(Some(_held)) = authority.lock(Duration::from_secs(5)) else {
        return;
    };
    let running = CURRENT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .is_some_and(|run| !run.is_done());
    if running || !prune_pending_jobs() {
        return;
    }
    let Ok(mut record) = authority.load() else {
        return;
    };
    if !record.jobs_unproven || record.job_owner != Some(own) {
        return;
    }
    record.jobs_unproven = false;
    if let Err(error) = authority.save(&record) {
        tracing::warn!("release: proven worker Jobs not recorded: {error:#}");
    }
}

/// Start a release, or join the one running, and answer by the deadline. `owner_key` is the
/// authenticated caller; the worker checks it against the protection owner under C.
pub(crate) async fn start_or_join(request: ReleaseRequest, owner_key: String) -> ReleaseReport {
    let run = {
        let mut current = CURRENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        match current.as_ref() {
            Some(run) if !run.is_done() => Arc::clone(run),
            _ => match own_incarnation().and_then(|job_owner| {
                spawn_run(WorkerInput {
                    request: request.clone(),
                    owner_key,
                    job_owner,
                })
            }) {
                Ok(run) => {
                    *current = Some(Arc::clone(&run));
                    run
                }
                Err(error) => {
                    return ReleaseReport::without_components(
                        &request.request_id,
                        "unknown",
                        Some(format!("the release worker could not be started: {error:#}")),
                    );
                }
            },
        }
    };
    let deadline = run.started + Duration::from_secs(RELEASE_ANSWER_SECONDS);
    let joined = Arc::clone(&run);
    match tokio::task::spawn_blocking(move || joined.answer(deadline)).await {
        Ok(report) => report,
        Err(error) => ReleaseReport::without_components(&run.request_id, "unknown", Some(error.to_string())),
    }
}

pub(crate) fn status() -> ReleaseStatus {
    let current = CURRENT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    let running = current.as_ref().is_some_and(|run| !run.is_done());
    // The first answer is given at `RELEASE_ANSWER_SECONDS` and the worker may still be working
    // (a floored reset leg can run past its budget). What it reports after that, including the
    // note that the cleanup overran and the final per-component read-back, is only visible here:
    // the report as it stands now, marked unfinished and unproven while the run is not done.
    let report = current.map(|run| run.answer(Instant::now()));
    // An unreadable record is not reported as secured: the App treats anything but `secured`
    // as a restore it cannot vouch for.
    let (mode, generation) = match Authority::live().load() {
        Ok(record) => (
            match record.mode {
                super::Mode::Secured => "secured",
                super::Mode::Released => "released",
            },
            record.generation,
        ),
        Err(_) => ("unreadable", 0),
    };
    ReleaseStatus {
        mode: mode.to_owned(),
        generation,
        running,
        report,
    }
}

fn spawn_run(input: WorkerInput) -> anyhow::Result<Arc<Run>> {
    let job = crate::core::process::kill_on_close_job()?;
    let executable = std::env::current_exe()?;
    let mut command = Command::new(executable);
    command
        .arg("--release-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = crate::core::process::spawn_in_job(&job, &mut command)?;
    let line = serde_json::to_string(&input)?;
    if let Some(mut stdin) = child.stdin.take() {
        writeln!(stdin, "{line}")?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("the release worker has no output pipe"))?;
    let run = Arc::new(Run {
        request_id: input.request.request_id.clone(),
        started: Instant::now(),
        state: Mutex::new(RunState::default()),
        changed: Condvar::new(),
        job: Mutex::new(Some(job)),
    });

    // The hard cap: closing the Job ends the worker and everything it started.
    {
        let run = Arc::clone(&run);
        std::thread::Builder::new()
            .name("tono-release-cap".into())
            .spawn(move || {
                let cap = run.started + Duration::from_secs(RELEASE_HARD_CAP_SECONDS);
                while Instant::now() < cap {
                    if run.is_done() {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                tracing::warn!("release worker reached the hard cap; terminating its Job Object");
                run.end_job();
            })?;
    }

    {
        let run = Arc::clone(&run);
        std::thread::Builder::new()
            .name("tono-release-reader".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    if let Ok(report) = serde_json::from_str::<ReleaseReport>(&line) {
                        run.publish(report);
                    }
                }
                let _ = child.wait();
                // Anything the worker left in the Job ends with it, and is proven gone or kept.
                run.retire_job();
                finalize(&run);
                run.finish();
                recover_quarantine();
                settle_jobs();
                while !prune_pending_jobs() {
                    std::thread::sleep(PENDING_JOB_RECHECK);
                }
                settle_jobs();
            })?;
    }
    Ok(run)
}

/// The release service is stopping (SCM Stop or Preshutdown): end a running worker through
/// its Job, then put the main Service back rather than leave it Disabled until the next boot.
pub fn shutdown() {
    let current = CURRENT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    if let Some(run) = current
        && !run.is_done()
    {
        tracing::warn!("release service stopping; ending the running release worker");
        run.end_job();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !run.is_done() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    recover_quarantine();
}

/// Put back a main Service that a dead worker left Disabled. Only under C, and only once the
/// recorded worker is gone; a worker still running owns that step. Workers only run inside
/// this service's Job, so an unreadable record cannot name a live one: the Service comes back
/// and the record is left for the next restore to replace (admission refuses it meanwhile).
pub fn recover_quarantine() {
    let authority = Authority::live();
    let Ok(Some(_held)) = authority.lock(Duration::from_secs(5)) else {
        return;
    };
    let mut record = match authority.load() {
        Ok(record) => record,
        Err(error) => {
            tracing::warn!("release: record unreadable: {error:#}");
            // Only a Service a release left Disabled; a Service the owner stopped stays stopped.
            if super::worker::main_service_disabled().unwrap_or(false)
                && let Err(error) = super::worker::restore_main_service(true)
            {
                tracing::warn!("release: main Service could not be put back: {error:#}");
            }
            return;
        }
    };
    if !record.service_quarantined {
        return;
    }
    let processes = Processes::live();
    if let Some(worker) = record.worker
        && (processes.alive)(&worker) != Some(false)
    {
        return;
    }
    match super::worker::restore_main_service(true) {
        Ok(()) => {
            record.service_quarantined = false;
            if let Err(error) = authority.save(&record) {
                tracing::warn!("release: restored main Service not recorded: {error:#}");
            }
        }
        Err(error) => tracing::warn!("release: main Service could not be put back: {error:#}"),
    }
}
