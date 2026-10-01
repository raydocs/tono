//! Independent SYSTEM executor copied before quiescence. It never trusts an
//! App journal, an installer-supplied path, or version-string adoption.
use super::*;
use anyhow::{bail, ensure};
use tono_service_protocol::update_contract::{Components, Phase};
use tono_service_protocol::{update_native as native, update_transaction as tx};

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    attempt_id: String,
    members: Vec<CoordinatedBinaryReplacement>,
}

/// What recovery may conclude about an interrupted installation once the
/// recorded executor incarnation is gone. Successor process liveness is
/// deliberately not an input: a user closing the new App before commit, or a
/// reboot, is not an interrupted publication.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecoveryPublication {
    /// No durable replacement plan exists, so no publication can have started.
    NoPlan,
    /// The installed identity equals the signed target and every durable
    /// plan member is at its new digest: the publication completed and was
    /// verified before. Recovery re-establishes the successor path; it must
    /// not revert a complete installation.
    TargetVerified,
    /// The installed identity is not the signed target: the publication is
    /// genuinely interrupted (or a previous rollback already restored the
    /// retained originals). Restore from the retained backups.
    Interrupted,
}

fn classify_recovery(
    plan_present: bool,
    plan_members_new: bool,
    installed: &Components,
    target: &Components,
) -> RecoveryPublication {
    if !plan_present {
        RecoveryPublication::NoPlan
    } else if plan_members_new && installed == target {
        RecoveryPublication::TargetVerified
    } else {
        RecoveryPublication::Interrupted
    }
}

impl RecoveryPublication {
    /// Only a recovery that restores retained originals or records the old
    /// identity needs the Service stopped. A complete, verified publication
    /// whose successor is simply not running changes no file; stopping the
    /// Service there restarted it, and every Service start spawns recovery
    /// again for the still-pending attempt.
    fn requires_service_stop(self) -> bool {
        !matches!(self, Self::TargetVerified)
    }
}

/// Read-only: the installed identity and the durable plan members decide
/// what recovery may conclude. Nothing here stops the Service or writes.
fn classify_installed(
    a: &tx::Attempt,
    plan_path: &Path,
) -> Result<(Components, RecoveryPublication), Error> {
    let service_path = tono_service_protocol::service_paths()
        .install_dir()
        .join("tono-service.exe");
    let installed = native::components(&a.install_root, &service_path)?;
    let plan_present = plan_path.exists();
    // Three binaries at the target do not prove later members (the
    // payload tree, `core-sha256.txt`) were published too. Only a
    // member read as different is an interruption; an unreadable
    // member (sharing violation, AV lock) exits like an unreadable
    // component, before any rollback touches a file.
    let plan_members_new = plan_present
        && native::plan_members_at(
            plan_path,
            &a.receipt.attempt_id,
            &[
                a.install_root.as_path(),
                tono_service_protocol::service_paths()
                    .install_dir()
                    .as_path(),
            ],
            native::PlanSide::New,
        )?;
    let publication = classify_recovery(
        plan_present,
        plan_members_new,
        &installed,
        &tx::target(&a.manifest).components,
    );
    Ok((installed, publication))
}

/// Recovery's first read, before the Service is stopped. When it cannot
/// classify the installation at all (an unreadable component or plan member),
/// nothing is stopped or changed and the next recovery retries. A `Consumed`
/// marker becomes `Uncertain`, the only in-flight state a verified Disconnect
/// can retire once the retained originals are proven; `Replaced` keeps its
/// registered successor and `Uncertain` stays as it is.
fn classify_before_stop(
    store: &mut tx::Store,
    classify: impl FnOnce() -> Result<(Components, RecoveryPublication), Error>,
) -> Result<RecoveryPublication, Error> {
    let error = match classify() {
        Ok((_, publication)) => return Ok(publication),
        Err(error) => error,
    };
    if store.attempt()?.execution == tx::Execution::Consumed {
        store
            .execution(tx::Execution::Uncertain)
            .with_context(|| format!("unclassified recovery ({error:#}) was not recorded"))?;
    }
    Err(error)
}

/// The executor can die during Service readiness with its recorded successor
/// still CREATE_SUSPENDED. Liveness alone is not completed forward recovery.
fn recover_live_successor(
    successor: Option<&tx::Image>,
    resume: impl FnOnce(&tx::Image) -> Result<(), Error>,
) -> Result<bool, Error> {
    let Some(successor) = successor else {
        return Ok(false);
    };
    resume(successor)?;
    Ok(true)
}

/// A failed Service restart leaves no IPC path to release the retained update
/// block. Non-strict recovery tries the standard release without hiding that error.
fn release_after_failed_restart(
    restart: Result<(), Error>,
    strict: bool,
    release: impl FnOnce() -> Result<(), Error>,
) -> Result<(), Error> {
    if restart.is_err() && !strict {
        if let Err(error) = release() {
            eprintln!("update restart failed; network release also failed: {error:#}");
        }
    }
    restart
}

/// A rollback or failed executor outcome has no successful successor recovery.
/// Release ordinary traffic with the AI hold while the Service is still stopped,
/// then restart even if cleanup failed. Strict and successful updates retain protection.
fn restart_after_publication<T>(
    rolled_back: bool,
    publication: &Result<T, Error>,
    strict: bool,
    release: impl FnOnce() -> Result<(), Error>,
    restart: impl FnOnce() -> Result<(), Error>,
) -> (Result<(), Error>, Result<(), Error>) {
    let released = if (rolled_back || publication.is_err()) && !strict {
        release()
    } else {
        Ok(())
    };
    let restarted = restart();
    (released, restarted)
}

/// `--manual-update-gate`: every refusal in `begin_manual` starts with a WFP read, an RPC to BFE,
/// so BFE comes up first. Reading first refused a merely stopped BFE as an unconfirmable network
/// state, before the install could ever repair it (H22-O-F1).
fn manual_update_gate<T>(
    bfe_up: impl FnOnce() -> Result<(), Error>,
    begin: impl FnOnce() -> Result<T, Error>,
) -> Result<T, Error> {
    bfe_up()?;
    begin()
}

/// The gates whose refusal NSIS shows as a dialog. Each may name a reason file for it.
const GATE_MODES: [&str; 3] = [
    "--manual-update-gate",
    "--manual-orphan-gate",
    "--manual-uninstall-gate",
];
const REASON_FILE_ARG: &str = "--reason-file";

/// `(mode, reason file)` when these arguments ask for one of [`GATE_MODES`].
fn gate_invocation(args: &[std::ffi::OsString]) -> Option<(String, Option<PathBuf>)> {
    let (mode, reason_file) = match args {
        [mode] => (mode, None),
        [mode, flag, path] if flag == REASON_FILE_ARG => (mode, Some(PathBuf::from(path))),
        _ => return None,
    };
    let mode = mode.to_str()?;
    GATE_MODES
        .contains(&mode)
        .then(|| (mode.to_owned(), reason_file))
}

/// The exit status and stable code for a gate error (WIN-GATE-OPAQUE). 77–79 keep their own
/// types; every other refusal names a [`native::GateReason`], or is `TONO_INSTALL_UNEXPECTED`.
fn gate_exit(error: &Error) -> (i32, &'static str) {
    if error.is::<native::ProtectionActive>() {
        (
            native::MANUAL_GATE_PROTECTION_ACTIVE_EXIT,
            "TONO_INSTALL_PROTECTION_ACTIVE",
        )
    } else if error.is::<native::OrphanedProtection>() {
        (
            native::MANUAL_GATE_ORPHANED_PROTECTION_EXIT,
            "TONO_INSTALL_ORPHANED_PROTECTION",
        )
    } else if error.is::<BfeUnavailable>() {
        (MANUAL_GATE_BFE_UNAVAILABLE_EXIT, "TONO_BFE_NOT_RUNNING")
    } else {
        let reason = native::reason_of(error);
        (reason.exit_code(), reason.code())
    }
}

/// How a manual gate run ends: the exit status NSIS maps to its dialog, one entry in the
/// install-gate log, and the reason file carrying the refusal's first line and that log's path.
/// A passing gate's note, if any, goes on its OK line.
fn finish_gate(
    mode: &str,
    report: &native::GateReport,
    outcome: Result<Option<String>, Error>,
) -> i32 {
    let error = match outcome {
        Ok(note) => {
            report.record(mode, 0, "OK", note.as_deref().unwrap_or(""));
            return 0;
        }
        Err(error) => error,
    };
    let (exit, code) = gate_exit(&error);
    let chain = format!("{error:#}");
    // A named refusal's chain starts with its code; the dialog shows the code on its own line.
    let detail = chain
        .strip_prefix(code)
        .and_then(|rest| rest.strip_prefix(": "))
        .unwrap_or(&chain);
    eprintln!("Error: {code}: {detail}");
    let log = report.record(mode, exit, code, detail);
    report.write_reason(detail, log.as_deref());
    exit
}

/// A panic is a refusal too: its message reaches the log and the dialog before the process ends
/// (with `panic = "abort"` its exit status is not 101, which NSIS shows as unexpected anyway).
fn report_gate_panics(mode: &str, reason_file: Option<PathBuf>) {
    let mode = mode.to_owned();
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default_hook(info);
        let report = native::GateReport::for_machine(reason_file.clone());
        let chain = format!("panic: {info}");
        let log = report.record(&mode, 101, native::GateReason::Unexpected.code(), &chain);
        report.write_reason(&chain, log.as_deref());
    }));
}

pub(super) fn dispatch() -> Result<bool, Error> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let Some((mode, reason_file)) = gate_invocation(&args) {
        report_gate_panics(&mode, reason_file.clone());
        let outcome = match mode.as_str() {
            "--manual-update-gate" => manual_update_gate(bring_scm_bfe_up, || {
                super::shared::block_on_abandoning(native::begin_manual())?
            }),
            "--manual-orphan-gate" => native::begin_manual_orphan().map(|()| None),
            _ => native::begin_manual_uninstall().map(|()| None),
        };
        let report = native::GateReport::for_machine(reason_file);
        std::process::exit(finish_gate(&mode, &report, outcome));
    }
    match args.as_slice() {
        [mode, package] if mode == "--update-unpack-gate" => {
            native::unpack_gate(Path::new(package))?;
            Ok(true)
        }
        [mode] if mode == "--retire-orphaned-owner" => {
            super::shared::block_on_abandoning(native::retire_orphaned_owner())??;
            Ok(true)
        }
        [mode] if mode == "--manual-update-finish" => {
            native::finish_manual()?;
            Ok(true)
        }
        [mode] if mode == "--update-execute" || mode == "--update-recover" => {
            execute(mode == "--update-recover")?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn open_waiting() -> Result<tx::Store, Error> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match native::open_store() {
            Ok(store) => return Ok(store),
            Err(error) if Instant::now() >= deadline => return Err(error),
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn new_member_is_sing_box(target: &Path) -> bool {
    target.file_name().is_some_and(|name| {
        name.eq_ignore_ascii_case("sing-box.exe")
            || name.eq_ignore_ascii_case("sing-box-sha256.txt")
    })
}

fn collect_candidates(
    source: &Path,
    target: &Path,
    members: &mut Vec<CoordinatedBinaryReplacement>,
) -> Result<(), Error> {
    native::verify_tree(source, 0)?;
    if source.is_dir() {
        ensure!(
            target.is_dir(),
            "new installation directory requires a separate bootstrap install"
        );
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            collect_candidates(&entry.path(), &target.join(entry.file_name()), members)?;
        }
    } else if target.is_file() {
        members.push(CoordinatedBinaryReplacement::prepare(
            source,
            target,
            sha256(source)?,
        )?);
    } else if new_member_is_sing_box(target) {
        // The first package that carries sing-box.exe has no previous file to
        // restore. Rollback deletes the introduction; it does not invent bytes.
        members.push(CoordinatedBinaryReplacement::prepare_introduced(
            source,
            target,
            sha256(source)?,
        )?);
    } else {
        bail!("new installation member requires a separate bootstrap install");
    }
    Ok(())
}

fn execute(recovery: bool) -> Result<(), Error> {
    use platform_lib::{
        service::ServiceAccess,
        service_manager::{ServiceManager, ServiceManagerAccess},
    };
    // Both launchers (Service and ONSTART task) are SYSTEM. Elevation alone is
    // not an update grant: the durable exact executor binding is checked below.
    let self_image = native::image(std::process::id())?;
    let mut store = open_waiting()?;
    let a = store.attempt()?.clone();
    let dir = store.attempt_dir()?;
    ensure!(
        self_image.path == dir.join("executor.exe").canonicalize()?,
        "executor is outside private attempt"
    );
    let repair =
        tono_service_protocol::acquire_service_repair_gate()?.context("repair already running")?;
    let plan_path = dir.join("replacement.json");
    ensure!(
        a.executor
            .as_ref()
            .is_some_and(|e| e.sha256 == self_image.sha256),
        "executor image binding changed"
    );
    if a.receipt.phase == Phase::Committed {
        finish_committed(
            &plan_path,
            || record_committed_version(&a),
            native::retire_recovery_task,
        )?;
        return Ok(());
    }
    if recovery {
        if a.executor
            .as_ref()
            .is_some_and(|e| native::image(e.pid).ok().as_ref() == Some(e))
        {
            return Ok(()); // Live original executor, not an interrupted install.
        }
        if a.execution == tx::Execution::RolledBack {
            if !store.independent_recovery_pending()? {
                return Ok(());
            }
            let service_path = tono_service_protocol::service_paths()
                .install_dir()
                .join("tono-service.exe");
            ensure!(
                native::components(&a.install_root, &service_path)? == a.old_components,
                "resolved rollback no longer has its retained original identity"
            );
            // Service startup must see this live replay owner while readiness drops our locks.
            let mut next = store.state.clone();
            next.attempt
                .as_mut()
                .context("attempt checked above")?
                .executor = Some(self_image.clone());
            store.save(next)?;
            let finalizer = store.rollback_finalizer()?;
            let manager =
                ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
            let service = manager.open_service(
                tono_service_protocol::WINDOWS_SERVICE_NAME,
                ServiceAccess::ALL_ACCESS,
            )?;
            let (settled, restored) = finalizer.finish(
                false,
                || {
                    suppress_windows_service_recovery(&service)?;
                    stop_windows_service(&service)?;
                    shared::block_on_abandoning(async {
                        let _owner = tono_service_protocol::acquire_service_owner()
                            .await?
                            .context("Service still owns rollback finalization")?;
                        if native::strict_kill_switch_intent_on_disk() {
                            return Ok(());
                        }
                        tono_service_protocol::emergency_disarm_windows_kill_switch_applying_narrow(
                        )
                        .await
                    })?
                },
                || {
                    configure_windows_service_recovery(&service)?;
                    drop(store);
                    drop(repair);
                    start_service_if_stopped(&service)?;
                    wait_for_service_ready()
                },
            );
            restored?;
            settled?;
            return Ok(());
        }
        // A dead executor must not re-execute a live publication below. The
        // installed identity — not successor liveness — then classifies the
        // interruption: only an incomplete publication rolls back.
        if recover_live_successor(
            a.successor_image
                .as_ref()
                .filter(|e| native::image(e.pid).ok().as_ref() == Some(*e)),
            native::resume_successor,
        )? {
            return Ok(()); // Only the specifically launched successor can recover forward.
        }
        if !store.independent_recovery_pending()? {
            return Ok(());
        }
        // Classify before touching Service: complete publication keeps it running and
        // records the publication floor before its Replaced marker.
        let publication = classify_before_stop(&mut store, || classify_installed(&a, &plan_path))?;
        if !publication.requires_service_stop() {
            store.record_complete_publication_recovery(native::process_clock_now())?;
            return Ok(());
        }
    } else {
        ensure!(
            tx::file_digest(&dir.join("package.exe"))? == tx::target(&a.manifest).artifact_sha256,
            "private package changed before consume"
        );
        ensure!(
            native::components(
                &dir.join("payload"),
                &dir.join("payload/resources/tono-service.exe")
            )? == tx::target(&a.manifest).components,
            "staged components changed before consume"
        );
    }
    let launch = if recovery {
        Ok(None)
    } else {
        store.capture_before_consuming(&self_image, tx::now, || {
            native::UserLaunch::capture(&a.initiating_image).map(Some)
        })?
    };
    // Capture or consume-write refusal has no proven consumed authority. Skip repair
    // registration and defer its error until the stopped-Service finalizer restores the network.
    let registration = if launch.is_err() {
        Ok(())
    } else if recovery {
        // Classification and rollback do not run through the ONSTART task; it only re-arms the
        // net for this run. An unavailable Task Scheduler must not strand the attempt (#484).
        if let Err(error) = native::register_consumed_recovery(&store) {
            eprintln!(
                "update recovery task could not be registered; recovering without it: {error:#}"
            );
        }
        Ok(())
    } else {
        // No publication without the net: nothing is replaced yet, so the attempt ends
        // RolledBack against the retained original identity instead of staying Consumed.
        native::register_recovery_before_publication(&mut store, || {
            native::components(
                &a.install_root,
                &tono_service_protocol::service_paths()
                    .install_dir()
                    .join("tono-service.exe"),
            )
        })
    };
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(
        tono_service_protocol::WINDOWS_SERVICE_NAME,
        ServiceAccess::ALL_ACCESS,
    )?;
    suppress_windows_service_recovery(&service)?;
    stop_windows_service(&service)?;
    let runtime = tokio::runtime::Runtime::new()?;
    let outcome = (|| -> Result<_, Error> {
        let launch = launch?;
        // Registration still precedes Service stop and every publication. Its
        // refusal must reach the same selective failure finalizer as rollback.
        registration?;
        let _owner = runtime
            .block_on(tono_service_protocol::acquire_service_owner())?
            .context("Service replacement ownership unavailable")?;
        // No process-name sweep: terminate only the captured initiating incarnation.
        if native::image(a.initiating_image.pid).ok().as_ref() == Some(&a.initiating_image) {
            shared::terminate_process_by_pid(a.initiating_image.pid)?;
        }
        let service_path = tono_service_protocol::service_paths()
            .install_dir()
            .join("tono-service.exe");
        if recovery {
            // The installed identity — not successor liveness — classifies the
            // interruption. A user closing the new App before commit or a
            // reboot must not revert a complete, verified publication.
            let (installed, publication) = classify_installed(&a, &plan_path)?;
            match publication {
                RecoveryPublication::NoPlan => {
                    // There cannot have been a publication without the durable plan.
                    ensure!(
                        installed == a.old_components,
                        "no replacement plan and old identity is not intact"
                    );
                    store.execution(tx::Execution::RolledBack)?;
                    return Ok(None);
                }
                RecoveryPublication::TargetVerified => {
                    // Keep the complete installation. When the successor launch
                    // never durably registered (consumed/uncertain marker), a
                    // measured target on disk is the publication proof: the
                    // first authenticated target-identity App adopts on next
                    // start. An already registered successor is re-proved the
                    // same way after its recorded incarnation exited.
                    // Sample only when the publishing run did not. Do not move
                    // a floor that was saved before the successor could start.
                    store.record_complete_publication_recovery(native::process_clock_now())?;
                    return Ok(None);
                }
                RecoveryPublication::Interrupted => {}
            }
        }
        let mut plan = if recovery {
            serde_json::from_slice::<Plan>(&std::fs::read(&plan_path)?)?
        } else {
            let mut members = Vec::new();
            clear_retired_publish_scratch(dir.parent().context("attempt has no store root")?)?;
            collect_candidates(&dir.join("payload"), &a.install_root, &mut members)?;
            for name in ["tono-service.exe", "core-sha256.txt"] {
                let source = dir.join("payload/resources").join(name);
                members.push(CoordinatedBinaryReplacement::prepare(
                    &source,
                    &tono_service_protocol::service_paths()
                        .install_dir()
                        .join(name),
                    sha256(&source)?,
                )?);
            }
            Plan {
                attempt_id: a.receipt.attempt_id.clone(),
                members,
            }
        };
        ensure!(
            plan.attempt_id == a.receipt.attempt_id,
            "replacement plan belongs to a different attempt"
        );
        let publication = if recovery {
            Err(anyhow::anyhow!("interrupted installation"))
        } else {
            publish_plan(
                &store,
                &mut plan,
                &plan_path,
                CoordinatedBinaryReplacement::publish,
            )
            .and_then(|()| {
                ensure!(
                    native::components(&a.install_root, &service_path)?
                        == tx::target(&a.manifest).components,
                    "installed component verification failed"
                );
                Ok(())
            })
        };
        if let Err(error) = publication {
            rollback_plan(&mut plan).with_context(|| format!("replacement failed: {error:#}"))?;
            ensure!(
                native::components(&a.install_root, &service_path)? == a.old_components,
                "rollback identity mismatch"
            );
            store.execution(tx::Execution::RolledBack)?;
            return Ok(None);
        }
        // The new bytes are durable. Record the process-start clock before
        // creating a successor, so an App that was already mapped to the old
        // file cannot adopt by hashing the new bytes on disk.
        store.note_publication_clock(native::process_clock_now())?;
        // Create after every replacement, while target handles deny write/delete.
        // Persist PID + kernel creation time + image digest before running any
        // user code. An old App mapped at the same path can never satisfy this.
        let child = launch
            .as_ref()
            .context("no successor token")?
            .suspended(&a.install_root.join("Tono.exe"))?;
        let peer = native::image(child.pid)?;
        ensure!(
            peer.sha256 == tx::target(&a.manifest).components.app_sha256,
            "launched target mismatch"
        );
        let mut next = store.state.clone();
        let attempt = next.attempt.as_mut().unwrap();
        attempt.execution = tx::Execution::Replaced;
        attempt.successor_image = Some(peer);
        store.save(next)?;
        Ok(Some(child))
    })();
    if outcome.is_err()
        && matches!(
            store.attempt()?.execution,
            tx::Execution::Consumed | tx::Execution::Replaced | tx::Execution::Uncertain
        )
    {
        // This marker cannot turn uncertain execution into another install grant.
        let _ = store.execution(tx::Execution::Uncertain);
    }
    // Resume the durable successor even when the restarted Service is slow or
    // failed to become ready: a suspended child dropped at this point would
    // terminate the registered successor of a complete, verified installation
    // and leave the next recovery a state it would otherwise roll back.
    let rolled_back = store.attempt()?.execution == tx::Execution::RolledBack;
    let finalizer = if rolled_back {
        Some(store.rollback_finalizer()?)
    } else {
        None
    };
    let release = || {
        // The original repair/store guards still fence lifecycle writers. The
        // publication outcome has released its owner, and SCM remains stopped.
        shared::block_on_abandoning(async {
            let _owner = tono_service_protocol::acquire_service_owner()
                .await?
                .context("Service still owns rolled-back update recovery")?;
            if native::strict_kill_switch_intent_on_disk() {
                return Ok(());
            }
            tono_service_protocol::emergency_disarm_windows_kill_switch_applying_narrow().await
        })?
    };
    let restart = || {
        // Even a failed plan/rollback must leave the IPC recovery Service available.
        configure_windows_service_recovery(&service)?;
        drop(store);
        drop(repair);
        service.start(&Vec::<&std::ffi::OsStr>::new())?;
        wait_for_service_ready()
    };
    let (rollback_release, restart) = match finalizer {
        Some(finalizer) => finalizer.finish(false, release, restart),
        None => restart_after_publication(
            false,
            &outcome,
            native::strict_kill_switch_intent_on_disk(),
            release,
            restart,
        ),
    };

    let strict = restart.is_err() && native::strict_kill_switch_intent_on_disk();
    let restart = release_after_failed_restart(restart, strict, || {
        let _repair = tono_service_protocol::acquire_service_repair_gate()?
            .context("repair already running during failed restart release")?;
        // A readiness timeout can leave a live DNS watchdog. Stop it and
        // SCM retries before restoring DNS so they cannot reapply the block.
        let release = (|| -> Result<(), Error> {
            suppress_windows_service_recovery(&service)?;
            stop_windows_service(&service)?;
            shared::block_on_abandoning(async {
                let _owner = tono_service_protocol::acquire_service_owner()
                    .await?
                    .context("Service still owns failed restart recovery")?;
                // Recheck after the stopped daemon's final intent write.
                if native::strict_kill_switch_intent_on_disk() {
                    return Ok(());
                }
                tono_service_protocol::emergency_disarm_windows_kill_switch_applying_narrow().await
            })?
        })();
        // Restore supervision even if stop or release failed; configuring
        // actions does not itself start the Service.
        if let Err(error) = configure_windows_service_recovery(&service) {
            eprintln!("failed to restore Service recovery after network release: {error}");
        }
        release
    });
    let successor = match outcome {
        Ok(child) => child,
        Err(error) => {
            restart?;
            return Err(error);
        }
    };
    let resume = match successor {
        Some(child) => child.resume(),
        None => Ok(()),
    };
    restart?;
    resume?;
    rollback_release?;
    if rolled_back {
        // Retain receipt/high-water/backups for verified retirement. No successor
        // exists to commit this failed publication, so do not wait for one.
        return Ok(());
    }
    // Backups are not freed on IPC readiness. Only durable recovery commit
    // permits cleanup; the boot task handles a later commit after this wait.
    for _ in 0..120 {
        std::thread::sleep(Duration::from_secs(1));
        let store = open_waiting()?;
        if store.attempt()?.receipt.phase == Phase::Committed {
            finish_committed(
                &plan_path,
                || record_committed_version(&a),
                native::retire_recovery_task,
            )?;
            return Ok(());
        }
    }
    Ok(())
}

fn start_service_if_stopped(service: &platform_lib::service::Service) -> Result<(), Error> {
    use platform_lib::{Error as ServiceError, service::ServiceState};
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    while service.query_status()?.current_state == ServiceState::StopPending {
        ensure!(
            std::time::Instant::now() < deadline,
            "Service stop did not settle for rollback recovery"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    if service.query_status()?.current_state == ServiceState::Stopped {
        match service.start(&Vec::<&std::ffi::OsStr>::new()) {
            Ok(()) => {}
            Err(ServiceError::Winapi(error)) if error.raw_os_error() == Some(1056) => {} // SCM beat us.
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// The physical publication boundary. Durable consume must already have won,
/// and the rollback plan must reach disk before even the first live rename.
fn publish_plan(
    store: &tx::Store,
    plan: &mut Plan,
    path: &Path,
    publish: impl FnMut(&mut CoordinatedBinaryReplacement) -> Result<(), Error>,
) -> Result<(), Error> {
    let a = store.attempt()?;
    ensure!(
        a.execution == tx::Execution::Consumed
            && a.receipt.phase == Phase::InstallationAuthorized
            && a.receipt.attempt_id == plan.attempt_id
            && store.state.consumed_sequence >= a.manifest.release_sequence,
        "physical publication has no consumed bound attempt"
    );
    ensure!(
        !path.try_exists()?,
        "a retained replacement plan forbids reinstallation"
    );
    tx::atomic_write(path, &serde_json::to_vec(plan)?)?;
    plan.members.iter_mut().try_for_each(publish)
}

/// A `.publish` file is `publish`'s staging output, never a recovery copy. When its rename failed
/// and the attempt rolled back and was retired, nothing else removes it, and the next `prepare`
/// refuses it. Remove one only when a retired rolled-back attempt's durable plan binds it: the
/// archive records RolledBack/Uncertain, its retained plan names this member inside the
/// installation, the file holds that member's new digest, and the target is back at its old
/// digest. Anything unproven is left for `prepare` to refuse.
fn clear_retired_publish_scratch(store_root: &Path) -> Result<(), Error> {
    let service_dir = tono_service_protocol::service_paths().install_dir();
    for entry in std::fs::read_dir(store_root)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(id) = name
            .to_str()
            .and_then(|n| n.strip_prefix("retired-"))
            .and_then(|n| n.strip_suffix(".json"))
        else {
            continue;
        };
        let Some(a) = std::fs::read(entry.path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<tx::State>(&bytes).ok())
            .and_then(|archived| archived.attempt)
        else {
            continue;
        };
        if a.receipt.attempt_id != id
            || !matches!(
                a.execution,
                tx::Execution::RolledBack | tx::Execution::Uncertain
            )
        {
            continue;
        }
        let Some(plan) = std::fs::read(store_root.join(id).join("replacement.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Plan>(&bytes).ok())
        else {
            continue;
        };
        if plan.attempt_id != id {
            continue;
        }
        for m in plan.members {
            let bound = [a.install_root.as_path(), service_dir.as_path()]
                .iter()
                .any(|root| m.target.starts_with(root))
                && m.target
                    .components()
                    .all(|c| !matches!(c, std::path::Component::ParentDir))
                && m.publish_scratch == path_with_suffix(&m.target, PUBLISH_SUFFIX);
            let target_is_previous = if m.introduced {
                matches!(
                    std::fs::symlink_metadata(&m.target),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound
                )
            } else {
                sha256(&m.target).ok() == Some(m.old_digest)
            };
            if bound
                && sha256(&m.publish_scratch).ok() == Some(m.new_digest)
                && target_is_previous
            {
                remove_ordinary_file_if_exists(&m.publish_scratch)?;
            }
        }
    }
    Ok(())
}

fn rollback_plan(plan: &mut Plan) -> Result<(), Error> {
    // is_old/rollback remeasure target bytes. Serialized `published` is not
    // crash evidence: a process can die immediately after the actual rename.
    let mut failures = Vec::new();
    for member in &mut plan.members {
        if let Err(e) = member.rollback() {
            failures.push(format!("{e:#}"));
        }
    }
    ensure!(
        failures.is_empty(),
        "rollback incomplete: {}",
        failures.join("; ")
    );
    Ok(())
}

/// Commit ends the boot task's job: once the committed cleanup ran there is
/// nothing left for `--update-recover` to do, so the SYSTEM ONSTART task is
/// retired, as macOS retires its launchd job. A failed retirement leaves the
/// task for the next boot, which lands here again and retries.
///
/// The committed target is also named in Add/Remove Programs first: the
/// manual installer's downgrade check reads that version, and no NSIS section
/// ran for a native update. The Service writes it at commit; this is the retry
/// for a write that failed there, so a failed write keeps the task.
fn finish_committed(
    plan_path: &Path,
    record_version: impl FnOnce() -> Result<(), Error>,
    retire: impl FnOnce() -> Result<(), Error>,
) -> Result<(), Error> {
    cleanup_committed(plan_path)?;
    record_version()?;
    if let Err(error) = retire() {
        eprintln!(
            "committed update cleaned up; the recovery task stays until the next boot: {error:#}"
        );
    }
    Ok(())
}

/// Only while the committed target is still what is installed: a manual
/// install after the commit wrote its own version, and a boot-time retry must
/// not name an older one over it.
fn record_committed_version(a: &tx::Attempt) -> Result<(), Error> {
    let service_path = tono_service_protocol::service_paths()
        .install_dir()
        .join("tono-service.exe");
    if native::components(&a.install_root, &service_path)? == tx::target(&a.manifest).components {
        native::record_installed_version(&a.manifest.app_version)?;
    }
    Ok(())
}

fn cleanup_committed(plan_path: &Path) -> Result<(), Error> {
    let plan: Plan = serde_json::from_slice(&std::fs::read(plan_path)?)?;
    for member in plan.members {
        // A sharing violation must leave the boot task available to retry.
        for path in [
            &member.staged,
            &member.backup,
            &member.restore,
            &member.publish_scratch,
        ] {
            remove_ordinary_file_if_exists(path)?;
        }
    }
    // Keep state.json, manifest, consumed sequence, plan and executor as evidence.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tono_service_protocol::update_contract::{
        Observation, Protection, Receipt, ReleaseManifest,
    };

    #[test]
    fn update_rollback_releases_non_strict_protection_before_restarting_the_service() {
        let events = std::cell::RefCell::new(Vec::new());
        let (released, restarted) = restart_after_publication(
            true,
            &Ok::<_, Error>(()),
            false,
            || {
                events.borrow_mut().push("release with AI hold");
                Ok(())
            },
            || {
                events.borrow_mut().push("restart");
                Ok(())
            },
        );
        released.unwrap();
        restarted.unwrap();
        assert_eq!(*events.borrow(), ["release with AI hold", "restart"]);
        let (released, restarted) = restart_after_publication(
            true,
            &Ok::<_, Error>(()),
            true,
            || panic!("strict rollback releases"),
            || Ok(()),
        );
        released.unwrap();
        restarted.unwrap();
        let (released, restarted) = restart_after_publication(
            false,
            &Ok::<_, Error>(()),
            false,
            || panic!("successful update releases"),
            || Ok(()),
        );
        released.unwrap();
        restarted.unwrap();

        let restarted = std::cell::Cell::new(false);
        let (released, restart) = restart_after_publication(
            true,
            &Ok::<_, Error>(()),
            false,
            || Err(anyhow::anyhow!("release failed")),
            || {
                restarted.set(true);
                Ok(())
            },
        );
        let error = released.unwrap_err();
        assert!(restart.is_ok(), "release error is not a restart failure");
        assert!(restarted.get(), "release failure must still restart the Service");
        assert_eq!(error.to_string(), "release failed");
    }

    #[test]
    fn update_executor_error_releases_non_strict_protection_before_service_restart() {
        let publication = Err::<(), _>(anyhow::anyhow!("successor creation failed"));
        let events = std::cell::RefCell::new(Vec::new());
        let (released, restarted) = restart_after_publication(
            false,
            &publication,
            false,
            || {
                events.borrow_mut().push("release with AI hold");
                Ok(())
            },
            || {
                events.borrow_mut().push("restart");
                Ok(())
            },
        );
        released.unwrap();
        restarted.unwrap();
        assert_eq!(*events.borrow(), ["release with AI hold", "restart"]);
        assert_eq!(
            publication.unwrap_err().to_string(),
            "successor creation failed"
        );
        let failed = Err::<(), _>(anyhow::anyhow!("recovery task registration failed"));
        let (released, restarted) = restart_after_publication(
            false,
            &failed,
            true,
            || panic!("strict failed update releases"),
            || Ok(()),
        );
        released.unwrap();
        restarted.unwrap();
    }

    #[test]
    fn update_commit_keeps_the_recovery_task_until_locked_artifacts_are_removed() {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

        let root = std::env::temp_dir().join(format!(
            "tono-update-commit-locked-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let target = root.join("Tono.exe");
        let staged = root.join("Tono.exe.next");
        std::fs::write(&target, b"old-app").unwrap();
        std::fs::write(&staged, b"new-app").unwrap();
        let mut member =
            CoordinatedBinaryReplacement::prepare(&staged, &target, sha256(&staged).unwrap())
                .unwrap();
        member.publish().unwrap();
        let backup = member.backup.clone();
        let plan_path = root.join("replacement.json");
        tx::atomic_write(
            &plan_path,
            &serde_json::to_vec(&Plan {
                attempt_id: "attempt".into(),
                members: vec![member],
            })
            .unwrap(),
        )
        .unwrap();
        // AV and other readers can temporarily hold a completed rollback
        // copy without granting delete sharing.
        let held = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&backup)
            .unwrap();
        let mut recorded_while_locked = false;
        let mut retired_while_locked = false;
        let locked_result = finish_committed(
            &plan_path,
            || {
                recorded_while_locked = true;
                Ok(())
            },
            || {
                retired_while_locked = true;
                Ok(())
            },
        );
        let backup_remained = backup.exists();
        drop(held);

        // Retry also tolerates artifacts removed before the first failure.
        let mut retired_on_retry = false;
        let retry = finish_committed(
            &plan_path,
            || Ok(()),
            || {
                retired_on_retry = true;
                Ok(())
            },
        );
        let backup_removed = !backup.exists();
        let installed = std::fs::read(&target).unwrap();
        std::fs::remove_dir_all(root).unwrap();

        assert!(locked_result.is_err(), "locked cleanup must remain retryable");
        assert!(!recorded_while_locked && !retired_while_locked);
        assert!(backup_remained);
        assert!(retry.is_ok() && retired_on_retry && backup_removed);
        assert_eq!(installed, b"new-app");
    }

    #[test]
    fn update_commit_retires_the_recovery_task_after_cleanup() {
        let root = std::env::temp_dir().join(format!(
            "tono-update-commit-retire-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let plan_path = root.join("replacement.json");
        // Without the committed cleanup the boot task still has work left.
        assert!(
            finish_committed(
                &plan_path,
                || Ok(()),
                || panic!("retired before the committed cleanup")
            )
            .is_err()
        );
        tx::atomic_write(
            &plan_path,
            &serde_json::to_vec(&Plan {
                attempt_id: "attempt".into(),
                members: Vec::new(),
            })
            .unwrap(),
        )
        .unwrap();
        let mut retired = false;
        finish_committed(
            &plan_path,
            || Ok(()),
            || {
                retired = true;
                Ok(())
            },
        )
        .unwrap();
        assert!(
            retired,
            "a committed update must not leave its SYSTEM boot task"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    /// TW-anthropic-5: the manual installer's downgrade check reads the Add/Remove Programs
    /// version, and a native update never ran the NSIS sections that write it. The committed
    /// cleanup records the target version, and a failed write keeps the boot task that retries it.
    #[test]
    fn update_commit_records_the_installed_version_before_retiring_the_task() {
        let root = std::env::temp_dir().join(format!(
            "tono-update-commit-version-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let plan_path = root.join("replacement.json");
        tx::atomic_write(
            &plan_path,
            &serde_json::to_vec(&Plan {
                attempt_id: "attempt".into(),
                members: Vec::new(),
            })
            .unwrap(),
        )
        .unwrap();
        let mut retired = false;
        let unrecorded = finish_committed(
            &plan_path,
            || Err(anyhow::anyhow!("installed version not written")),
            || {
                retired = true;
                Ok(())
            },
        );
        assert!(
            unrecorded.is_err() && !retired,
            "the boot task must stay until the committed version is recorded"
        );
        let mut recorded = false;
        finish_committed(
            &plan_path,
            || {
                recorded = true;
                Ok(())
            },
            || Ok(()),
        )
        .unwrap();
        assert!(
            recorded,
            "a committed update must record its installed version"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    /// TW-OpenAI-2: a recovery that cannot classify the installation (an unreadable component
    /// or plan member) exits before the Service stop. Only `Uncertain` can later be retired by a
    /// verified Disconnect, so a `Consumed` marker must not be left as it was; a registered
    /// successor's `Replaced` marker is kept.
    #[test]
    fn update_recovery_marks_a_consumed_attempt_uncertain_when_it_cannot_classify() {
        let root = std::env::temp_dir().join(format!(
            "tono-update-classify-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let mut store = tx::Store::open(&root).unwrap();
        let manifest = ReleaseManifest::decode(include_bytes!(
            "../../../../../../tooling/scripts/tests/fixtures/update-protocol-v1/manifest.json"
        ))
        .unwrap();
        let mut receipt = Receipt::decode(include_bytes!("../../../../../../tooling/scripts/tests/fixtures/update-protocol-v1/windows-receipt.json"), &manifest).unwrap();
        receipt.installed_location_sha256 = tx::location_digest(&root);
        let peer = tx::Image {
            pid: 11,
            started_at: 10,
            path: root.join("Tono.exe"),
            sha256: "0".repeat(64),
        };
        let executor = tx::Image {
            pid: 22,
            started_at: 20,
            path: root.join("executor.exe"),
            sha256: "e".repeat(64),
        };
        store
            .save(tx::State {
                consumed_sequence: 73,
                generation: 91,
                manual_installer: None,
                attempt: Some(tx::Attempt {
                    old_components: tx::target(&manifest).components.clone(),
                    manifest,
                    receipt,
                    initiating_image: peer.clone(),
                    successor_image: None,
                    install_root: root.clone(),
                    execution: tx::Execution::Staged,
                    executor: Some(executor.clone()),
                    disconnect: None,
                    publication_clock: None,
                }),
            })
            .unwrap();
        store
            .observe(
                "windows:fixture-owner",
                &peer,
                91,
                1_900_000_001,
                Observation::PreparationVerified {
                    artifact_sha256: "b".repeat(64),
                    protection: Protection::Unprotected,
                },
            )
            .unwrap();
        store.execution(tx::Execution::Launching).unwrap();
        store.consume(&executor, 1_900_000_002).unwrap();
        let unreadable = || -> Result<(Components, RecoveryPublication), Error> {
            Err(anyhow::anyhow!("installed component is locked"))
        };

        assert!(classify_before_stop(&mut store, unreadable).is_err());
        let durable: tx::State =
            serde_json::from_slice(&std::fs::read(root.join("state.json")).unwrap()).unwrap();
        assert_eq!(
            durable.attempt.unwrap().execution,
            tx::Execution::Uncertain,
            "an unclassifiable Consumed attempt must become retirable"
        );

        store.execution(tx::Execution::Replaced).unwrap();
        assert!(classify_before_stop(&mut store, unreadable).is_err());
        assert_eq!(store.attempt().unwrap().execution, tx::Execution::Replaced);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_executor_consumes_before_publication_and_reloads_interrupted_rollback() {
        let root = std::env::temp_dir().join(format!(
            "tono-update-executor-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let mut store = tx::Store::open(&root).unwrap();
        let manifest = ReleaseManifest::decode(include_bytes!(
            "../../../../../../tooling/scripts/tests/fixtures/update-protocol-v1/manifest.json"
        ))
        .unwrap();
        let mut receipt = Receipt::decode(include_bytes!("../../../../../../tooling/scripts/tests/fixtures/update-protocol-v1/windows-receipt.json"), &manifest).unwrap();
        receipt.installed_location_sha256 = tx::location_digest(&root);
        let peer = tx::Image {
            pid: 11,
            started_at: 10,
            path: root.join("Tono.exe"),
            sha256: "0".repeat(64),
        };
        let executor = tx::Image {
            pid: 22,
            started_at: 20,
            path: root.join("executor.exe"),
            sha256: "e".repeat(64),
        };
        let attempt_id = receipt.attempt_id.clone();
        store
            .save(tx::State {
                consumed_sequence: 73,
                generation: 91,
                manual_installer: None,
                attempt: Some(tx::Attempt {
                    old_components: tx::target(&manifest).components.clone(),
                    manifest,
                    receipt,
                    initiating_image: peer.clone(),
                    successor_image: None,
                    install_root: root.clone(),
                    execution: tx::Execution::Staged,
                    executor: Some(executor.clone()),
                    disconnect: None,
                    publication_clock: None,
                }),
            })
            .unwrap();
        let mut members = Vec::new();
        // Three real asymmetric payloads; no SCM, process-launch or WFP stub is
        // called success here. This is the production file-publication boundary.
        for (name, old, new) in [
            ("Tono.exe", "old-app", "target-app"),
            ("tono-core.exe", "old-core", "target-core"),
            ("tono-service.exe", "old-service", "target-service"),
        ] {
            let installed = root.join(name);
            let staged = root.join(format!("{name}.next"));
            std::fs::write(&installed, old).unwrap();
            std::fs::write(&staged, new).unwrap();
            members.push(
                CoordinatedBinaryReplacement::prepare(
                    &staged,
                    &installed,
                    sha256(&staged).unwrap(),
                )
                .unwrap(),
            );
        }
        let mut plan = Plan {
            attempt_id,
            members,
        };
        let plan_path = root.join("replacement.json");
        assert!(
            publish_plan(&store, &mut plan, &plan_path, |_| panic!(
                "unconsumed effect"
            ))
            .is_err()
        );
        assert!(!plan_path.exists());
        assert_eq!(std::fs::read(root.join("Tono.exe")).unwrap(), b"old-app");
        store
            .observe(
                "windows:fixture-owner",
                &peer,
                91,
                1_900_000_001,
                Observation::PreparationVerified {
                    artifact_sha256: "b".repeat(64),
                    protection: Protection::Unprotected,
                },
            )
            .unwrap();
        store.execution(tx::Execution::Launching).unwrap();
        store.consume(&executor, 1_900_000_002).unwrap();
        assert!(
            publish_plan(&store, &mut plan, &plan_path, |member| {
                let durable: tx::State =
                    serde_json::from_slice(&std::fs::read(root.join("state.json"))?).unwrap();
                assert_eq!(durable.consumed_sequence, 74);
                assert_eq!(durable.attempt.unwrap().execution, tx::Execution::Consumed);
                assert!(plan_path.is_file());
                member.publish()?;
                anyhow::bail!("injected interruption immediately after first rename")
            })
            .is_err()
        );
        assert_eq!(std::fs::read(root.join("Tono.exe")).unwrap(), b"target-app");
        assert_eq!(
            std::fs::read(root.join("tono-core.exe")).unwrap(),
            b"old-core"
        );
        drop(store);
        let store = tx::Store::open(&root).unwrap();
        let mut recovered: Plan =
            serde_json::from_slice(&std::fs::read(&plan_path).unwrap()).unwrap();
        assert!(
            !recovered.members[0].published,
            "saved flags precede the interrupted rename"
        );
        assert!(
            publish_plan(&store, &mut recovered, &plan_path, |_| panic!(
                "reinstalled"
            ))
            .is_err()
        );
        rollback_plan(&mut recovered).unwrap();
        assert_eq!(std::fs::read(root.join("Tono.exe")).unwrap(), b"old-app");
        assert_eq!(
            std::fs::read(root.join("tono-core.exe")).unwrap(),
            b"old-core"
        );
        assert_eq!(
            std::fs::read(root.join("tono-service.exe")).unwrap(),
            b"old-service"
        );
        assert!(recovered.members.iter().all(|m| m.backup.is_file()));
        assert_eq!(store.state.consumed_sequence, 74);
        assert!(
            store.pending(),
            "restoring bytes must not invent successor/recovery commit"
        );
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// G3 failure-then-success on one device: a failed publication rolls back, the verified
    /// Disconnect retires it, and the next update must be able to prepare its members after its
    /// own consume. Rollback keeps each `.rollback` copy (it now equals the restored bytes) and
    /// retirement archives the record without touching files, so the next `prepare` met them.
    #[test]
    fn update_after_a_retired_rollback_prepares_past_the_retained_copies() {
        let root = std::env::temp_dir().join(format!(
            "tono-update-after-rollback-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let mut store = tx::Store::open(&root).unwrap();
        let manifest = ReleaseManifest::decode(include_bytes!(
            "../../../../../../tooling/scripts/tests/fixtures/update-protocol-v1/manifest.json"
        ))
        .unwrap();
        let mut receipt = Receipt::decode(include_bytes!("../../../../../../tooling/scripts/tests/fixtures/update-protocol-v1/windows-receipt.json"), &manifest).unwrap();
        receipt.installed_location_sha256 = tx::location_digest(&root);
        let owner = "windows:fixture-owner";
        let peer = tx::Image {
            pid: 11,
            started_at: 10,
            path: root.join("Tono.exe"),
            sha256: "0".repeat(64),
        };
        let executor = tx::Image {
            pid: 22,
            started_at: 20,
            path: root.join("executor.exe"),
            sha256: "e".repeat(64),
        };
        let attempt_id = receipt.attempt_id.clone();
        store
            .save(tx::State {
                consumed_sequence: 73,
                generation: 91,
                manual_installer: None,
                attempt: Some(tx::Attempt {
                    old_components: tx::target(&manifest).components.clone(),
                    manifest,
                    receipt,
                    initiating_image: peer.clone(),
                    successor_image: None,
                    install_root: root.clone(),
                    execution: tx::Execution::Staged,
                    executor: Some(executor.clone()),
                    disconnect: None,
                    publication_clock: None,
                }),
            })
            .unwrap();
        let names = ["Tono.exe", "tono-core.exe", "tono-service.exe"];
        let mut members = Vec::new();
        for name in names {
            let installed = root.join(name);
            let staged = root.join(format!("{name}.next"));
            std::fs::write(&installed, format!("old-{name}")).unwrap();
            std::fs::write(&staged, format!("first-{name}")).unwrap();
            members.push(
                CoordinatedBinaryReplacement::prepare(
                    &staged,
                    &installed,
                    sha256(&staged).unwrap(),
                )
                .unwrap(),
            );
        }
        let mut plan = Plan {
            attempt_id,
            members,
        };
        store
            .observe(
                owner,
                &peer,
                91,
                1_900_000_001,
                Observation::PreparationVerified {
                    artifact_sha256: "b".repeat(64),
                    protection: Protection::Unprotected,
                },
            )
            .unwrap();
        store.execution(tx::Execution::Launching).unwrap();
        store.consume(&executor, 1_900_000_002).unwrap();
        // First update: the publication fails after the first live rename and rolls back.
        let plan_path = root.join("replacement.json");
        assert!(
            publish_plan(&store, &mut plan, &plan_path, |member| {
                member.publish()?;
                anyhow::bail!("injected publication failure")
            })
            .is_err()
        );
        rollback_plan(&mut plan).unwrap();
        for name in names {
            assert_eq!(
                std::fs::read(root.join(name)).unwrap(),
                format!("old-{name}").into_bytes()
            );
        }
        store.execution(tx::Execution::RolledBack).unwrap();
        // Verified explicit Disconnect retires the rolled-back attempt.
        store.request_disconnect(owner, &peer, 1_900_000_003).unwrap();
        store
            .verify_disconnect(owner, &peer, 1_900_000_004, Protection::Unprotected)
            .unwrap();
        store.retire_rolled_back(owner, &peer).unwrap();
        assert!(!store.pending(), "the rolled-back attempt must be retired");
        drop(store);

        // Second update, past its consume: every member must prepare.
        for name in names {
            let installed = root.join(name);
            let staged = root.join(format!("{name}.next"));
            std::fs::write(&staged, format!("second-{name}")).unwrap();
            let prepared = CoordinatedBinaryReplacement::prepare(
                &staged,
                &installed,
                sha256(&staged).unwrap(),
            );
            assert!(
                prepared.is_ok(),
                "second update refused {name} after a retired rollback: {:#}",
                prepared.err().unwrap()
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    /// #657 review opus:F1, the owner's G3 injection: a handle that denies delete on
    /// `tono-service.exe` makes that member's publish rename fail, so `.publish` keeps the
    /// attempt's new bytes (never a recovery copy) while rollback returns the target to its old
    /// bytes. After the verified Disconnect retires the attempt, the next update must prepare.
    #[test]
    fn update_after_a_retired_failed_publish_rename_prepares_past_its_staging_file() {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;

        let root = std::env::temp_dir().join(format!(
            "tono-update-after-publish-rename-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let mut store = tx::Store::open(&root).unwrap();
        let manifest = ReleaseManifest::decode(include_bytes!(
            "../../../../../../tooling/scripts/tests/fixtures/update-protocol-v1/manifest.json"
        ))
        .unwrap();
        let mut receipt = Receipt::decode(include_bytes!("../../../../../../tooling/scripts/tests/fixtures/update-protocol-v1/windows-receipt.json"), &manifest).unwrap();
        receipt.installed_location_sha256 = tx::location_digest(&root);
        let owner = "windows:fixture-owner";
        let peer = tx::Image {
            pid: 11,
            started_at: 10,
            path: root.join("Tono.exe"),
            sha256: "0".repeat(64),
        };
        let executor = tx::Image {
            pid: 22,
            started_at: 20,
            path: root.join("executor.exe"),
            sha256: "e".repeat(64),
        };
        let attempt_id = receipt.attempt_id.clone();
        store
            .save(tx::State {
                consumed_sequence: 73,
                generation: 91,
                manual_installer: None,
                attempt: Some(tx::Attempt {
                    old_components: tx::target(&manifest).components.clone(),
                    manifest,
                    receipt,
                    initiating_image: peer.clone(),
                    successor_image: None,
                    install_root: root.clone(),
                    execution: tx::Execution::Staged,
                    executor: Some(executor.clone()),
                    disconnect: None,
                    publication_clock: None,
                }),
            })
            .unwrap();
        let names = ["Tono.exe", "tono-core.exe", "tono-service.exe"];
        let mut members = Vec::new();
        for name in names {
            let installed = root.join(name);
            let staged = root.join(format!("{name}.next"));
            std::fs::write(&installed, format!("old-{name}")).unwrap();
            std::fs::write(&staged, format!("first-{name}")).unwrap();
            members.push(
                CoordinatedBinaryReplacement::prepare(
                    &staged,
                    &installed,
                    sha256(&staged).unwrap(),
                )
                .unwrap(),
            );
        }
        let mut plan = Plan {
            attempt_id: attempt_id.clone(),
            members,
        };
        store
            .observe(
                owner,
                &peer,
                91,
                1_900_000_001,
                Observation::PreparationVerified {
                    artifact_sha256: "b".repeat(64),
                    protection: Protection::Unprotected,
                },
            )
            .unwrap();
        store.execution(tx::Execution::Launching).unwrap();
        store.consume(&executor, 1_900_000_002).unwrap();
        // First update: the production plan location, and a read-only handle that denies delete.
        std::fs::create_dir(root.join(&attempt_id)).unwrap();
        let plan_path = root.join(&attempt_id).join("replacement.json");
        let pinned = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(root.join("tono-service.exe"))
            .unwrap();
        assert!(
            publish_plan(
                &store,
                &mut plan,
                &plan_path,
                CoordinatedBinaryReplacement::publish
            )
            .is_err(),
            "precondition: the pinned member's publish rename must fail"
        );
        assert_eq!(
            std::fs::read(root.join("tono-service.exe.publish")).unwrap(),
            b"first-tono-service.exe",
            "precondition: the failed rename leaves the staging file"
        );
        rollback_plan(&mut plan).unwrap();
        drop(pinned);
        for name in names {
            assert_eq!(
                std::fs::read(root.join(name)).unwrap(),
                format!("old-{name}").into_bytes()
            );
        }
        store.execution(tx::Execution::RolledBack).unwrap();
        store.request_disconnect(owner, &peer, 1_900_000_003).unwrap();
        store
            .verify_disconnect(owner, &peer, 1_900_000_004, Protection::Unprotected)
            .unwrap();
        store.retire_rolled_back(owner, &peer).unwrap();
        assert!(!store.pending(), "the rolled-back attempt must be retired");
        drop(store);

        // Second update, past its consume: the executor's pre-pass, then every member prepares.
        clear_retired_publish_scratch(&root).unwrap();
        for name in names {
            let installed = root.join(name);
            let staged = root.join(format!("{name}.next"));
            std::fs::write(&staged, format!("second-{name}")).unwrap();
            let prepared = CoordinatedBinaryReplacement::prepare(
                &staged,
                &installed,
                sha256(&staged).unwrap(),
            );
            assert!(
                prepared.is_ok(),
                "second update refused {name} after a retired failed publish: {:#}",
                prepared.err().unwrap()
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    /// WIN-UPDATE-SUSPENDED-SUCCESSOR: abrupt executor death skips SuspendedApp's
    /// destructor, so recovery must resume the exact live successor before returning.
    #[test]
    fn update_recovery_resumes_a_live_successor_before_returning() {
        let successor = tx::Image {
            pid: 42,
            started_at: 7,
            path: PathBuf::from(r"C:\Program Files\Tono\Tono.exe"),
            sha256: "target".into(),
        };
        let mut resumed = false;
        let recovered = recover_live_successor(Some(&successor), |peer| {
            assert_eq!(peer, &successor);
            resumed = true;
            Ok(())
        })
        .unwrap();
        assert!(
            recovered && resumed,
            "a live successor must run before recovery returns"
        );
        assert!(
            recover_live_successor(Some(&successor), |_| {
                Err(anyhow::anyhow!("successor resume failed"))
            })
            .is_err(),
            "failed resume must not count as completed recovery"
        );
        assert!(
            !recover_live_successor(None, |_| panic!("no matched successor to resume")).unwrap()
        );
    }

    /// WIN-UPDATE-RESTART-FAIL-OPEN: without a ready Service the App cannot release
    /// the update block; only non-strict failure releases, preserving the restart error.
    #[test]
    fn update_restart_failure_releases_only_non_strict_protection_and_keeps_the_error() {
        assert!(
            release_after_failed_restart(Ok(()), false, || panic!("healthy restart releases"))
                .is_ok()
        );
        let strict = release_after_failed_restart(
            Err(anyhow::anyhow!("Service start failed")),
            true,
            || panic!("strict protection releases"),
        );
        assert_eq!(strict.unwrap_err().to_string(), "Service start failed");
        let mut released = false;
        let failed = release_after_failed_restart(
            Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "IPC not ready").into()),
            false,
            || {
                released = true;
                Err(anyhow::anyhow!("DNS/WFP release failed"))
            },
        );
        assert!(released, "non-strict restart failure must attempt release");
        let error = failed.unwrap_err();
        assert_eq!(error.to_string(), "IPC not ready");
        assert_eq!(
            error.downcast_ref::<std::io::Error>().unwrap().kind(),
            std::io::ErrorKind::TimedOut,
            "cleanup failure must preserve the original restart error"
        );
    }

    #[test]
    fn update_recovery_classifies_publication_by_installed_identity_not_successor_liveness() {
        let target = Components {
            app_sha256: "t".into(),
            core_sha256: "tc".into(),
            privileged_sha256: "tp".into(),
            sing_box_sha256: String::new(),
        };
        let old = Components {
            app_sha256: "o".into(),
            core_sha256: "oc".into(),
            privileged_sha256: "op".into(),
            sing_box_sha256: String::new(),
        };
        // A complete verified installation survives its successor exiting first.
        assert_eq!(
            classify_recovery(true, true, &target, &target),
            RecoveryPublication::TargetVerified
        );
        // A mid-flight publication (neither target nor fully restored) rolls back.
        let mixed = Components {
            app_sha256: "t".into(),
            core_sha256: "oc".into(),
            privileged_sha256: "op".into(),
            sing_box_sha256: String::new(),
        };
        assert_eq!(
            classify_recovery(true, false, &mixed, &target),
            RecoveryPublication::Interrupted
        );
        // An already-restored rollback re-runs the idempotent restore.
        assert_eq!(
            classify_recovery(true, false, &old, &target),
            RecoveryPublication::Interrupted
        );
        // No durable plan means no publication can have started.
        assert_eq!(
            classify_recovery(false, false, &old, &target),
            RecoveryPublication::NoPlan
        );
    }

    #[test]
    fn update_recovery_keeps_the_service_running_for_a_complete_publication() {
        let target = Components {
            app_sha256: "t".into(),
            core_sha256: "tc".into(),
            privileged_sha256: "tp".into(),
            sing_box_sha256: String::new(),
        };
        let old = Components {
            app_sha256: "o".into(),
            core_sha256: "oc".into(),
            privileged_sha256: "op".into(),
            sing_box_sha256: String::new(),
        };
        // Replaced, successor closed before commit: nothing to restore, so the
        // Service is not stopped (a stop/start would spawn recovery again).
        assert!(!classify_recovery(true, true, &target, &target).requires_service_stop());
        // Rollback and the no-plan identity check still run with the Service stopped.
        assert!(classify_recovery(true, false, &target, &target).requires_service_stop());
        assert!(classify_recovery(false, false, &old, &target).requires_service_stop());
    }

    /// WIN-GATE-OPAQUE: a customer's 0.0.74 installer refused with the catch-all dialog, and
    /// the cause went only to a stderr nobody sees from `.onInit`. A refusal must exit with its
    /// own code, append its cause to the install-gate log, and hand NSIS the first line and the
    /// log path for the dialog.
    #[test]
    fn update_manual_gate_refusal_names_its_cause_in_the_log_and_the_dialog() {
        let root = std::env::temp_dir().join(format!(
            "tono-gate-report-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let log = root.join("logs").join("install-gate.log");
        let report = native::GateReport {
            log: Some(log.clone()),
            reason_file: Some(root.join("reason.txt")),
        };
        let refused = Err(native::refusal(
            native::GateReason::InstallerLeaseHeld,
            "another manual installer is active: Un_A.exe (pid 4242) holds the lease",
        ));
        assert_eq!(finish_gate("--manual-update-gate", &report, refused), 81);
        let written = std::fs::read_to_string(&log).unwrap_or_default();
        assert!(
            written.contains("--manual-update-gate exit=81 TONO_INSTALL_INSTALLER_LEASE_HELD"),
            "{written}"
        );
        assert!(
            written.contains("Un_A.exe (pid 4242) holds the lease"),
            "{written}"
        );
        let reason = std::fs::read(root.join("reason.txt")).unwrap();
        let reason = String::from_utf16(
            &reason
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let mut lines = reason.split("\r\n");
        assert_eq!(
            lines.next(),
            Some("another manual installer is active: Un_A.exe (pid 4242) holds the lease")
        );
        assert_eq!(lines.next(), Some(log.display().to_string().as_str()));
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// Regression review a1d498c8 opus:F1: when the protected log could not be written, the
    /// elevated gate created and rotated `install-gate.log` under the user's TEMP, a directory
    /// that user's unelevated processes control. It writes no other log; the dialog's log line
    /// says the log was not written.
    #[test]
    fn update_manual_gate_skips_the_log_it_cannot_write_in_the_protected_root() {
        let root = std::env::temp_dir().join(format!(
            "tono-gate-report-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // A file where `logs` should be: the protected log cannot be created.
        std::fs::write(root.join("logs"), b"").unwrap();
        let report = native::GateReport {
            log: Some(root.join("logs").join("install-gate.log")),
            reason_file: Some(root.join("reason.txt")),
        };
        let refused = Err(native::refusal(
            native::GateReason::InstallerLeaseHeld,
            "another manual installer is active",
        ));
        assert_eq!(finish_gate("--manual-update-gate", &report, refused), 81);
        let mut written: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        written.sort();
        assert_eq!(written, ["logs", "reason.txt"]);
        let reason = std::fs::read(root.join("reason.txt")).unwrap();
        let reason = String::from_utf16(
            &reason
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert_eq!(
            reason.split("\r\n").nth(1),
            Some("(the install-gate log could not be written)")
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// H22-O-F1: every refusal of the manual gate starts with a WFP read, an RPC to BFE. A
    /// stopped BFE must be started, and its StartPending waited out, before that read; reading
    /// first refused a merely stopped BFE as an unconfirmable network state and aborted install.
    #[test]
    fn update_manual_gate_brings_bfe_up_before_reading_wfp() {
        struct Scripted<'a> {
            states: std::vec::IntoIter<BfeState>,
            log: &'a std::cell::RefCell<Vec<String>>,
        }
        impl BfeControl for Scripted<'_> {
            fn state(&mut self) -> Result<BfeState, Error> {
                let state = self.states.next().expect("BFE polled after it was Running");
                self.log.borrow_mut().push(format!("{state:?}"));
                Ok(state)
            }
            fn start(&mut self) -> Result<(), Error> {
                self.log.borrow_mut().push("start".into());
                Ok(())
            }
            fn wait(&mut self) -> bool {
                self.log.borrow_mut().push("wait".into());
                true
            }
        }
        let log = std::cell::RefCell::new(Vec::new());
        let mut bfe = Scripted {
            states: vec![BfeState::Stopped, BfeState::Pending, BfeState::Running].into_iter(),
            log: &log,
        };
        manual_update_gate(
            || bring_bfe_up(&mut bfe),
            || {
                log.borrow_mut().push("wfp".into());
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(
            *log.borrow(),
            [
                "Stopped", "start", "wait", "Pending", "wait", "Running", "wfp"
            ]
        );
    }
}
