//! The release service (`TonoRelease`): owns the release pipe and one worker at a time.
//!
//! A request starts a worker, or joins the one already running, and is answered when the
//! worker finishes or at [`RELEASE_ANSWER_SECONDS`], whichever comes first. The worker runs in
//! a kill-on-close Job Object this service holds; at [`RELEASE_HARD_CAP_SECONDS`] the Job is
//! closed and everything in it ends. After every run, and when the service starts, a main
//! Service left quarantined by a worker that died is put back.

use super::{Authority, Processes};
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

    fn is_done(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .done
    }

    /// The report as it stands when the worker finishes or at the deadline. A run that ended
    /// without a final line (the worker died or was killed) is never reported as finished.
    fn answer(&self, deadline: Instant) -> ReleaseReport {
        let mut state = self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        loop {
            let finished_line = state.latest.as_ref().is_some_and(|report| report.finished);
            if state.done || finished_line {
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
        if !report.finished && report.outcome != "busy" && report.outcome != "superseded" {
            report.outcome =
                ReleaseReport::outcome_of(&report.components, &report.stuck, false).to_owned();
        }
        report
    }
}

static CURRENT: Mutex<Option<Arc<Run>>> = Mutex::new(None);

/// Start a release, or join the one running, and answer by the deadline.
pub(crate) async fn start_or_join(request: ReleaseRequest) -> ReleaseReport {
    let run = {
        let mut current = CURRENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        match current.as_ref() {
            Some(run) if !run.is_done() => Arc::clone(run),
            _ => match spawn_run(&request) {
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
    let running = CURRENT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .is_some_and(|run| !run.is_done());
    let record = Authority::live().load().unwrap_or_default();
    ReleaseStatus {
        mode: match record.mode {
            super::Mode::Secured => "secured",
            super::Mode::Released => "released",
        }
        .to_owned(),
        generation: record.generation,
        running,
    }
}

fn spawn_run(request: &ReleaseRequest) -> anyhow::Result<Arc<Run>> {
    let job = crate::core::process::kill_on_close_job()?;
    let executable = std::env::current_exe()?;
    let mut command = Command::new(executable);
    command
        .arg("--release-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = crate::core::process::spawn_in_job(&job, &mut command)?;
    let line = serde_json::to_string(request)?;
    if let Some(mut stdin) = child.stdin.take() {
        writeln!(stdin, "{line}")?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("the release worker has no output pipe"))?;
    let run = Arc::new(Run {
        request_id: request.request_id.clone(),
        started: Instant::now(),
        state: Mutex::new(RunState::default()),
        changed: Condvar::new(),
    });
    let job = Arc::new(Mutex::new(Some(job)));

    // The hard cap: closing the Job ends the worker and everything it started.
    {
        let job = Arc::clone(&job);
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
                tracing::warn!("release worker reached the hard cap; closing its Job Object");
                drop(job.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take());
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
                // Anything the worker left in the Job ends with it.
                drop(job.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take());
                run.finish();
                recover_quarantine();
            })?;
    }
    Ok(run)
}

/// Put back a main Service that a dead worker left Disabled. Only under C, and only once the
/// recorded worker is gone; a worker still running owns that step.
pub fn recover_quarantine() {
    let authority = Authority::live();
    let Ok(Some(_held)) = authority.lock(Duration::from_secs(5)) else {
        return;
    };
    let Ok(mut record) = authority.load() else {
        return;
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
