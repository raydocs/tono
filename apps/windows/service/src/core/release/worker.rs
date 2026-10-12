//! The release worker: `tono-release.exe --release-worker`, one process per Restore internet,
//! started by the release service inside a kill-on-close Job Object.
//!
//! Order (PROPOSAL §10 v5): take C, record this worker as the releaser before any effect,
//! quarantine and terminate everything that could write the network state again (the main
//! Service, the update executor, Tono cores), clean up, then read every component back twice,
//! a second apart. Only then is the release finished and the main Service put back. Each step
//! reports a JSON line on stdout so the release service can answer at its deadline with
//! whatever is known by then.

use super::{Authority, Incarnation, Mode, Processes, Record, RECORD_SCHEMA, WorkerInput, next_generation};
use crate::release_wire::{ReleaseComponent, ReleaseReport, ReleaseRequest};
use anyhow::{Context as _, Result, ensure};
use std::ffi::{OsStr, OsString};
use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// A worker that cannot take C reports busy and does nothing: whoever holds C is either a
/// release already running or an admission that is about to give it back.
const WORKER_LOCK_TIMEOUT: Duration = Duration::from_secs(3);
/// The whole cleanup step, so a wedged WFP or DNS call still leaves time to read back.
const CLEANUP_TIMEOUT: Duration = crate::core::windows_kill_switch::EMERGENCY_DISARM_OUTER_BUDGET;
const SETTLE_INTERVAL: Duration = Duration::from_secs(1);
const TOOL_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the restarted main Service gets to report Running, and then to finish its startup
/// restore and open its pipe, before the second read-back looks for anything it re-armed.
const SERVICE_START_TIMEOUT: Duration = Duration::from_secs(10);
const SERVICE_ANSWER_TIMEOUT: Duration = Duration::from_secs(20);

/// Images that can write the network state again. Matched by file name, then kept only when
/// the canonical path is under the Service's own state directory.
const WRITER_IMAGE_NAMES: &[&str] = &["tono-service.exe", "executor.exe"];

pub fn run() -> i32 {
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_line(&mut input) {
        emit(&ReleaseReport::without_components(
            "",
            "unknown",
            Some(format!("the release request could not be read: {error}")),
        ));
        return 2;
    }
    let input: WorkerInput = match serde_json::from_str(input.trim()) {
        Ok(input) => input,
        Err(error) => {
            emit(&ReleaseReport::without_components(
                "",
                "unknown",
                Some(format!("the release request is not valid: {error}")),
            ));
            return 2;
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("tono-release-worker")
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            emit(&ReleaseReport::without_components(
                &input.request.request_id,
                "unknown",
                Some(format!("the release worker could not start: {error}")),
            ));
            return 2;
        }
    };
    let request = input.request;
    let report = runtime.block_on(release(&request, &input.owner_key, input.job_owner));
    emit(&report);
    // A timed-out DNS or WFP call can leave blocking work behind; never wait for it.
    runtime.shutdown_background();
    0
}

fn emit(report: &ReleaseReport) {
    if let Ok(line) = serde_json::to_string(report) {
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{line}");
        let _ = stdout.flush();
    }
}

/// Why `caller_key` may not release: the armed protection or the running Core belongs to another
/// Windows user. The same owner rule `ReleaseKillSwitch` applies in the main Service, read from
/// disk because this process has none of its in-memory state. Unreadable state refuses.
pub(crate) async fn owner_refusal(caller_key: &str) -> Option<String> {
    match crate::core::windows_kill_switch::persisted_intent_owner() {
        Ok(Some(owner)) if owner != caller_key => {
            return Some("the protection belongs to another Windows user".into());
        }
        Ok(_) => {}
        Err(error) => return Some(format!("the protection owner could not be read: {error}")),
    }
    match crate::core::desired::load_active_owner().await {
        Ok(Some(active)) if active.owner_key != caller_key => {
            Some("the running connection belongs to another Windows user".into())
        }
        Ok(_) => None,
        Err(error) => Some(format!("the connection owner could not be read: {error:#}")),
    }
}

async fn release(request: &ReleaseRequest, owner_key: &str, job_owner: Incarnation) -> ReleaseReport {
    let request_id = request.request_id.clone();
    let held = match tokio::task::spawn_blocking(|| Authority::live().lock(WORKER_LOCK_TIMEOUT)).await {
        Ok(Ok(Some(held))) => held,
        Ok(Ok(None)) => {
            return ReleaseReport::without_components(
                &request_id,
                "busy",
                Some("another network restore or a Connect admission holds the release lock".into()),
            );
        }
        Ok(Err(error)) => {
            return ReleaseReport::without_components(&request_id, "unknown", Some(format!("{error:#}")));
        }
        Err(error) => {
            return ReleaseReport::without_components(&request_id, "unknown", Some(error.to_string()));
        }
    };
    // Checked again under C: a Connect admitted since the pipe checked may have made another
    // user the owner.
    if let Some(reason) = owner_refusal(owner_key).await {
        return ReleaseReport::without_components(&request_id, "refused", Some(reason));
    }
    let authority = Authority::live();
    let processes = Processes::live();
    // An unreadable record must not stop a restore: it is replaced by this release, whose
    // generation is still larger than any earlier one (`next_generation` uses the clock). What
    // it named is lost, so this boot keeps refusing Connect (`history_lost_boot`). Only a
    // readable secured record can show that a newer Connect superseded the request.
    let loaded = authority.load();
    let previous = loaded.as_ref().cloned().unwrap_or_default();
    if let Some(expected) = request.expected_generation
        && loaded.is_ok()
        && previous.mode == Mode::Secured
        && previous.generation != expected
    {
        let mut report = ReleaseReport::without_components(
            &request_id,
            "superseded",
            Some("a newer Connect was admitted after this restore was requested".into()),
        );
        report.generation = Some(previous.generation);
        return report;
    }
    let worker = match own_incarnation() {
        Ok(worker) => worker,
        Err(error) => {
            return ReleaseReport::without_components(&request_id, "unknown", Some(format!("{error:#}")));
        }
    };
    let boot = super::current_boot();
    // A retry inherits whatever the previous release left unretired; replacing the record
    // must never forget a worker or a survivor that may still act.
    let carried = processes.unretired_incarnations(&previous);
    // Jobs another release service held and never proved empty: kill-on-close ended them with
    // that service, but nothing observed it (Sol R2-F2). That boot keeps refusing Connect, and a
    // later one needs a completed release. Jobs this service still holds it proves itself.
    let orphaned_jobs_boot = previous.orphaned_jobs_boot.clone().or_else(|| {
        (previous.jobs_unproven && previous.job_owner != Some(job_owner))
            .then(|| previous.worker_boot.clone().unwrap_or_else(|| boot.clone()))
    });
    let mut record = Record {
        schema: RECORD_SCHEMA,
        mode: Mode::Released,
        generation: next_generation(previous.generation),
        request_id: Some(request_id.clone()),
        worker: Some(worker),
        worker_boot: Some(boot.clone()),
        worker_finished: false,
        completed: false,
        stuck: carried.clone(),
        executor_quarantined: true,
        service_quarantined: true,
        job_owner: Some(job_owner),
        jobs_unproven: true,
        history_lost_boot: if loaded.is_err() {
            Some(boot.clone())
        } else {
            previous.history_lost_boot.clone()
        },
        orphaned_jobs_boot,
    };
    // No effect happens before the record names this worker: a crash from here on is found
    // by admission, which refuses Connect until this process and its Job are gone.
    if let Err(error) = authority.save(&record) {
        return ReleaseReport::without_components(
            &request_id,
            "unknown",
            Some(format!("the release could not be recorded, so nothing was changed: {error:#}")),
        );
    }
    let mut report = ReleaseReport {
        request_id: request_id.clone(),
        outcome: "unknown".into(),
        generation: Some(record.generation),
        finished: false,
        components: Vec::new(),
        stuck: Vec::new(),
        detail: None,
    };
    emit(&report);

    // Every note is a step that did not prove itself. Any note at all keeps the outcome from
    // `restored`, whatever the read-back shows.
    let mut notes = Vec::new();
    let service_quarantined = match quarantine_main_service().and_then(|()| main_service_disabled()) {
        Ok(true) => true,
        Ok(false) => {
            notes.push("main Service quarantine did not take: it is not Disabled".into());
            false
        }
        Err(error) => {
            notes.push(format!("main Service quarantine: {error:#}"));
            false
        }
    };
    let task_quarantined = match set_recovery_task_enabled(false) {
        Ok(()) => true,
        Err(error) => {
            notes.push(format!("update recovery task: {error:#}"));
            false
        }
    };
    let (ended, scan_complete) = terminate_writers().await;
    if !scan_complete {
        notes.push("the writer scan was incomplete".into());
    }
    let mut stuck = carried;
    for incarnation in ended {
        if !stuck.contains(&incarnation) {
            stuck.push(incarnation);
        }
    }
    record.stuck = stuck.clone();
    if let Err(error) = authority.save(&record) {
        notes.push(format!("stuck writers not recorded: {error:#}"));
    }
    report.stuck = stuck.iter().map(|incarnation| incarnation.pid).collect();
    report.detail = joined(&notes);
    emit(&report);

    if let Some(error) = clean_up().await {
        notes.push(error);
    }
    let mut first = read_components().await;
    if first.iter().any(|(_, readback, _)| readback == "residual") {
        if let Some(error) = clean_up().await {
            notes.push(format!("second cleanup: {error}"));
        }
        first = read_components().await;
    }
    report.components = components(&first, None, &Settlement::default());
    report.detail = joined(&notes);
    emit(&report);

    // The main Service comes back before the second read and the read waits for its pipe,
    // which it opens only after its startup restore: anything that startup re-arms is seen
    // here rather than after "restored". It replays no Core while the record is released, and
    // the update executor stays quarantined until a Connect is admitted.
    let restarted = tokio::task::spawn_blocking(|| {
        restore_main_service(true)
            .and_then(|()| wait_main_service_running())
            .and_then(|()| wait_main_service_answering())
    })
    .await
    .unwrap_or_else(|error| Err(anyhow::anyhow!("the restart task failed: {error}")));
    match restarted {
        Ok(()) => {
            record.service_quarantined = false;
            if let Err(error) = authority.save(&record) {
                notes.push(format!("service restore not recorded: {error:#}"));
            }
        }
        Err(error) => notes.push(format!("main Service not restored: {error:#}")),
    }
    tokio::time::sleep(SETTLE_INTERVAL).await;
    let second = read_components().await;

    // Terminal evidence, not quiet samples (Sol R-F1). WFP changes die with their session:
    // BFE aborts the transaction of an ended client (FwpmEngineClose0). The NRPT rule, DoH
    // values and the Core are written in-process. So once every writer is proven ended and
    // could not be restarted, only the adapter DNS can still change: the IPv4 half of a
    // compatibility batch runs in WmiPrvSE, beyond any Job. It is final only when no batch
    // of this boot is left unaccounted for in the broker ledger.
    let survivors: Vec<Incarnation> = stuck
        .iter()
        .filter(|incarnation| (processes.alive)(incarnation) != Some(false))
        .copied()
        .collect();
    // A WMI batch from this boot (or one that cannot be told apart) may still land. One from an
    // earlier boot ended with it; what it wrote is in this read, and it is retired below once
    // DNS reads back settled (Sol R2-F3).
    let (broker_clear, earlier_batches) = match crate::core::dns::broker_ledger::outstanding() {
        Ok(pending) => {
            let (earlier, current): (Vec<_>, Vec<_>) =
                pending.into_iter().partition(|entry| entry.from_earlier_boot(&boot));
            if !current.is_empty() {
                notes.push(format!(
                    "a DNS change handed to Windows may still land: {}",
                    current.iter().map(|entry| entry.description.as_str()).collect::<Vec<_>>().join(", ")
                ));
            }
            (current.is_empty(), earlier)
        }
        Err(error) => {
            notes.push(format!("the WMI DNS ledger could not be read: {error:#}"));
            (false, Vec::new())
        }
    };
    // Lost history or orphaned Jobs from this boot may name work that can still act.
    let boot_clear = [&record.history_lost_boot, &record.orphaned_jobs_boot]
        .into_iter()
        .flatten()
        .all(|recorded| recorded.relation_to(&boot) == super::BootRelation::Earlier);
    if !boot_clear {
        notes.push("work from an earlier restore in this Windows session cannot be ruled out".into());
    }
    let settlement = Settlement {
        writers_ended: survivors.is_empty()
            && scan_complete
            && service_quarantined
            && task_quarantined
            && boot_clear,
        broker_clear,
    };
    report.components = components(&second, Some(&first), &settlement);
    record.stuck = survivors.clone();
    report.stuck = survivors.iter().map(|incarnation| incarnation.pid).collect();
    let all_settled = report.components.iter().all(|component| component.risk == "settled");
    if all_settled {
        // DNS read back settled in this boot, so batches an earlier boot ended are checked.
        if let Err(error) = crate::core::dns::broker_ledger::retire(&earlier_batches) {
            notes.push(format!("checked DNS changes from before the restart not recorded: {error:#}"));
        }
        // Reached only when these name an earlier boot (`boot_clear`).
        record.history_lost_boot = None;
        record.orphaned_jobs_boot = None;
    }

    record.worker_finished = true;
    if let Err(error) = authority.save(&record) {
        notes.push(format!("finish not recorded: {error:#}"));
    }
    drop(held);

    report.finished = true;
    let outcome = ReleaseReport::outcome_of(&report.components, &report.stuck, true);
    report.outcome = (if outcome == "restored" && !notes.is_empty() { "unknown" } else { outcome }).into();
    report.detail = joined(&notes);
    report
}

/// The pipe the main Service opens once its startup restore has finished.
fn wait_main_service_answering() -> Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::System::Pipes::WaitNamedPipeW;

    let name: Vec<u16> = crate::core::paths::service_paths()
        .ipc_path()
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let deadline = Instant::now() + SERVICE_ANSWER_TIMEOUT;
    loop {
        // SAFETY: `name` is a NUL-terminated wide string that outlives the call.
        if unsafe { WaitNamedPipeW(name.as_ptr(), 200) } != 0 {
            return Ok(());
        }
        ensure!(
            Instant::now() < deadline,
            "the main Service did not open its pipe within {}s",
            SERVICE_ANSWER_TIMEOUT.as_secs()
        );
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn wait_main_service_running() -> Result<()> {
    use platform_lib::service::ServiceState;

    let service = open_main_service()?;
    let deadline = Instant::now() + SERVICE_START_TIMEOUT;
    loop {
        if service.query_status()?.current_state == ServiceState::Running {
            return Ok(());
        }
        ensure!(
            Instant::now() < deadline,
            "the main Service did not report Running within {}s",
            SERVICE_START_TIMEOUT.as_secs()
        );
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn joined(notes: &[String]) -> Option<String> {
    (!notes.is_empty()).then(|| notes.join("; "))
}

fn own_incarnation() -> Result<Incarnation> {
    let pid = std::process::id();
    let started_at = crate::core::process::process_started_at(pid)?
        .context("the release worker cannot read its own start time")?;
    Ok(Incarnation { pid, started_at })
}

/// Desired state first, so nothing replays a Core; then the emergency disarm, which tombstones
/// the kill-switch intent, restores DNS and removes every Tono WFP object.
async fn clean_up() -> Option<String> {
    let mut notes = Vec::new();
    match crate::core::desired::load_active_owner().await {
        Ok(Some(active)) => {
            if let Err(error) =
                crate::core::desired::persist_owner_core_stopped_by_key(&active.owner_key).await
            {
                notes.push(format!("desired state not retired: {error:#}"));
            }
        }
        Ok(None) => {}
        Err(error) => notes.push(format!("active owner unreadable: {error:#}")),
    }
    let started = Instant::now();
    let deadline = started + CLEANUP_TIMEOUT;
    match tokio::time::timeout(
        CLEANUP_TIMEOUT,
        crate::core::windows_kill_switch::emergency_disarm_windows_kill_switch_until(deadline),
    )
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(error)) => notes.push(format!("{error:#}")),
        Err(_) => notes.push(format!(
            "the emergency disarm did not finish within {}s",
            CLEANUP_TIMEOUT.as_secs()
        )),
    }
    if let Some(note) = cleanup_overrun_note(started.elapsed()) {
        notes.push(note);
    }
    joined(&notes)
}

/// A cleanup that ran past its budget (the adapter reset leg is never skipped once WFP is gone,
/// so it may) did not prove itself inside it: the note keeps the outcome from `restored`.
pub(crate) fn cleanup_overrun_note(_elapsed: Duration) -> Option<String> {
    None
}

pub(crate) type Reading = (&'static str, String, Option<String>);

fn reading(name: &'static str, result: std::result::Result<bool, String>) -> Reading {
    match result {
        Ok(false) => (name, "restored".into(), None),
        Ok(true) => (name, "residual".into(), None),
        Err(error) => (name, "unreadable".into(), Some(error)),
    }
}

pub(crate) async fn read_components() -> Vec<Reading> {
    let wfp = crate::core::windows_kill_switch::residual_filters_present()
        .await
        .map_err(|error| format!("{error:#}"));
    let dns = crate::core::dns::release_readback().await;
    let core = tokio::task::spawn_blocking(tono_core_running)
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result.map_err(|error| format!("{error:#}")));
    vec![
        reading("wfp", wfp),
        reading("dns", dns.adapters_on_tono.map_err(|error| format!("{error:#}"))),
        reading("dns-policy", dns.tono_rule_effective),
        reading("core", core),
    ]
}

/// What the worker proved about everything that could still change a component.
#[derive(Default)]
struct Settlement {
    /// Every writer process is proven ended and none can be restarted by SCM or the task.
    writers_ended: bool,
    /// No WMI DNS batch of this boot is left unaccounted for.
    broker_clear: bool,
}

/// The second read decides the read-back. The risk is settled only on terminal evidence that
/// nothing can still change the component (see [`Settlement`]); agreement of the two reads is
/// required too, but it is never enough on its own.
fn components(latest: &[Reading], earlier: Option<&[Reading]>, settlement: &Settlement) -> Vec<ReleaseComponent> {
    latest
        .iter()
        .map(|(name, readback, detail)| {
            let agreed = earlier.is_some_and(|earlier| {
                earlier
                    .iter()
                    .any(|(other, value, _)| other == name && value == readback)
            });
            let settled = agreed
                && settlement.writers_ended
                && (*name != "dns" || settlement.broker_clear)
                && readback != "unreadable";
            ReleaseComponent {
                name: (*name).to_owned(),
                readback: readback.clone(),
                risk: if settled { "settled" } else { "unknown" }.to_owned(),
                detail: detail.clone(),
            }
        })
        .collect()
}

fn tono_core_running() -> Result<bool> {
    let candidates =
        crate::core::process::image_candidates(&["tono-core.exe", "verge-mihomo.exe", "sing-box.exe"])?;
    Ok(candidates.iter().any(|(_, identity)| {
        crate::core::runtime_generation::is_installed_core_image_path(Path::new(&identity.executable))
    }))
}

/// Terminate every process that could write the network state again and return the ones that
/// survived, and whether the scan saw every candidate. Each is matched by its inspected
/// identity, so a reused PID is left alone. A failed scan is never read as "none left".
async fn terminate_writers() -> (Vec<Incarnation>, bool) {
    let mut stuck = Vec::new();
    let mut complete = true;
    let own = std::process::id();
    let roots = writer_roots();
    let candidates = match crate::core::process::image_candidates(WRITER_IMAGE_NAMES) {
        Ok(candidates) => candidates,
        Err(error) => {
            tracing::warn!("release: writer scan failed: {error:#}");
            complete = false;
            Vec::new()
        }
    };
    for (pid, identity) in candidates {
        if pid == own || !under_any(&identity.executable, &roots) {
            continue;
        }
        let ended = crate::core::process::terminate_process_if_identity_matches(pid, &identity).await;
        let alive = crate::core::process::process_started_at(pid)
            .map(|started| started == Some(identity.started_at))
            .unwrap_or(true);
        if alive {
            tracing::warn!("release: writer {pid} survived termination: {ended:?}");
            stuck.push(Incarnation {
                pid,
                started_at: identity.started_at,
            });
        }
    }
    if let Err(error) = crate::core::process::sweep_orphan_core_processes(&[], false).await {
        tracing::warn!("release: core sweep failed: {error:#}");
        complete = false;
    }
    match crate::core::process::image_candidates(&["tono-core.exe", "verge-mihomo.exe", "sing-box.exe"]) {
        Ok(cores) => {
            for (pid, identity) in cores {
                if crate::core::runtime_generation::is_installed_core_image_path(Path::new(&identity.executable)) {
                    stuck.push(Incarnation {
                        pid,
                        started_at: identity.started_at,
                    });
                }
            }
        }
        Err(error) => {
            tracing::warn!("release: core scan failed: {error:#}");
            complete = false;
        }
    }
    (stuck, complete)
}

fn writer_roots() -> Vec<String> {
    let paths = crate::core::paths::service_paths();
    [paths.install_dir(), paths.persistent_state_dir().join("updates-v1")]
        .into_iter()
        .filter_map(|root| root.canonicalize().ok())
        .map(|root| root.to_string_lossy().to_ascii_lowercase())
        .collect()
}

fn under_any(executable: &str, roots: &[String]) -> bool {
    let executable = executable.to_ascii_lowercase();
    roots.iter().any(|root| {
        executable
            .strip_prefix(root.as_str())
            .is_some_and(|rest| rest.starts_with('\\'))
    })
}

fn main_service_info(start_type: platform_lib::service::ServiceStartType) -> platform_lib::service::ServiceInfo {
    use platform_lib::service::{ServiceDependency, ServiceErrorControl, ServiceInfo, ServiceType};

    // The same configuration `tono-service-install` registers.
    ServiceInfo {
        name: OsString::from(crate::WINDOWS_SERVICE_NAME),
        display_name: OsString::from(crate::SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type,
        error_control: ServiceErrorControl::Normal,
        executable_path: crate::core::paths::service_paths().install_dir().join("tono-service.exe"),
        launch_arguments: vec![],
        dependencies: vec![ServiceDependency::Service(OsString::from("BFE"))],
        account_name: None,
        account_password: None,
    }
}

fn open_main_service() -> Result<platform_lib::service::Service> {
    use platform_lib::service::ServiceAccess;
    use platform_lib::service_manager::{ServiceManager, ServiceManagerAccess};

    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .context("failed to connect to the Service Control Manager")?;
    manager
        .open_service(
            crate::WINDOWS_SERVICE_NAME,
            ServiceAccess::QUERY_STATUS
                | ServiceAccess::QUERY_CONFIG
                | ServiceAccess::CHANGE_CONFIG
                | ServiceAccess::START,
        )
        .context("failed to open the Tono Service")
}

/// Disabled, with no failure actions: nothing restarts the main Service while it is being
/// terminated, neither SCM recovery nor an App asking for a start.
pub(crate) fn quarantine_main_service() -> Result<()> {
    use platform_lib::service::{
        ServiceAction, ServiceActionType, ServiceFailureActions, ServiceFailureResetPeriod,
        ServiceStartType,
    };

    let service = open_main_service()?;
    service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::Never,
        reboot_msg: None,
        command: None,
        actions: Some(vec![
            ServiceAction {
                action_type: ServiceActionType::None,
                delay: Duration::ZERO,
            };
            3
        ]),
    })?;
    service.set_failure_actions_on_non_crash_failures(false)?;
    service.change_config(&main_service_info(ServiceStartType::Disabled))?;
    Ok(())
}

pub(crate) fn main_service_disabled() -> Result<bool> {
    Ok(open_main_service()?.query_config()?.start_type == platform_lib::service::ServiceStartType::Disabled)
}

/// Put back the installer's configuration and failure actions, then start the Service.
pub(crate) fn restore_main_service(start: bool) -> Result<()> {
    use platform_lib::service::{
        ServiceAction, ServiceActionType, ServiceFailureActions, ServiceFailureResetPeriod,
        ServiceStartType, ServiceState,
    };

    let service = open_main_service()?;
    let start_type = if cfg!(feature = "development-channel") {
        ServiceStartType::OnDemand
    } else {
        ServiceStartType::AutoStart
    };
    service.change_config(&main_service_info(start_type))?;
    service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(24 * 60 * 60)),
        reboot_msg: None,
        command: None,
        actions: Some(
            [5, 10, 30]
                .into_iter()
                .map(|seconds| ServiceAction {
                    action_type: ServiceActionType::Restart,
                    delay: Duration::from_secs(seconds),
                })
                .collect(),
        ),
    })?;
    service.set_failure_actions_on_non_crash_failures(true)?;
    if start && service.query_status()?.current_state == ServiceState::Stopped {
        service.start(&Vec::<&OsStr>::new())?;
    }
    Ok(())
}

/// Enable or disable the update recovery task, then read its state back (Sol R-F5). A task that
/// is not registered is already as it should be, but only a missing task file proves that: a
/// failed query proves nothing.
pub(crate) fn set_recovery_task_enabled(enabled: bool) -> Result<()> {
    let system = crate::core::update::security::system_directory()?;
    let name = crate::core::update::RECOVERY_TASK_NAME;
    let task_file = system.join("Tasks").join(name);
    match std::fs::metadata(&task_file) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error).with_context(|| format!("the update recovery task could not be inspected at {task_file:?}"));
        }
    }
    let schtasks = system.join("schtasks.exe");
    let switch = if enabled { "/ENABLE" } else { "/DISABLE" };
    ensure!(
        run_bounded(Command::new(&schtasks).args(["/Change", "/TN", name, switch]))?,
        "schtasks {switch} failed for the update recovery task"
    );
    let (queried, xml) = run_bounded_output(
        Command::new(&schtasks)
            .args(["/Query", "/TN", name, "/XML"])
            .stdout(Stdio::piped()),
    )?;
    ensure!(queried, "the update recovery task could not be read back");
    let disabled = decode_tool_output(&xml).contains("<Enabled>false</Enabled>");
    ensure!(
        disabled != enabled,
        "the update recovery task reads back {} after schtasks {switch}",
        if disabled { "disabled" } else { "enabled" }
    );
    Ok(())
}

/// schtasks writes its XML as UTF-16 when its output is a pipe on some Windows builds.
fn decode_tool_output(bytes: &[u8]) -> String {
    if bytes.contains(&0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// Run a system tool with a hard deadline; `Ok(success)`.
fn run_bounded(command: &mut Command) -> Result<bool> {
    Ok(run_bounded_output(command.stdout(Stdio::null()))?.0)
}

/// [`run_bounded`] that keeps stdout; `Ok((success, stdout))`. Stdout is drained on its own
/// thread so a full pipe cannot stall the tool past its deadline.
fn run_bounded_output(command: &mut Command) -> Result<(bool, Vec<u8>)> {
    use std::io::Read as _;
    use std::os::windows::process::CommandExt as _;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let program = command.get_program().to_owned();
    let mut child = command
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;
    let reader = child.stdout.take().map(|mut stdout| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.read_to_end(&mut bytes);
            bytes
        })
    });
    let deadline = Instant::now() + TOOL_TIMEOUT;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            anyhow::bail!("{program:?} did not finish within {}s", TOOL_TIMEOUT.as_secs());
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let output = reader
        .map(|reader| reader.join().unwrap_or_default())
        .unwrap_or_default();
    Ok((status.success(), output))
}
