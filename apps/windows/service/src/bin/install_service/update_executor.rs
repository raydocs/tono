//! Independent SYSTEM executor copied before quiescence. It never trusts an
//! App journal, an installer-supplied path, or version-string adoption.
use super::*;
use anyhow::ensure;
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

pub(super) fn dispatch() -> Result<bool, Error> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.as_slice() {
        [mode, package] if mode == "--update-unpack-gate" => {
            native::unpack_gate(Path::new(package))?;
            Ok(true)
        }
        [mode] if mode == "--manual-update-gate" => {
            if let Err(error) = tokio::runtime::Runtime::new()?.block_on(native::begin_manual()) {
                if error.is::<native::ProtectionActive>() {
                    eprintln!("Error: {error:#}");
                    std::process::exit(native::MANUAL_GATE_PROTECTION_ACTIVE_EXIT);
                }
                if error.is::<native::OrphanedProtection>() {
                    eprintln!("Error: {error:#}");
                    std::process::exit(native::MANUAL_GATE_ORPHANED_PROTECTION_EXIT);
                }
                return Err(error);
            }
            Ok(true)
        }
        [mode] if mode == "--manual-orphan-gate" => {
            native::begin_manual_orphan()?;
            Ok(true)
        }
        [mode] if mode == "--retire-orphaned-owner" => {
            tokio::runtime::Runtime::new()?.block_on(native::retire_orphaned_owner())?;
            Ok(true)
        }
        [mode] if mode == "--manual-uninstall-gate" => {
            native::begin_manual_uninstall()?;
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
    } else {
        ensure!(
            target.is_file(),
            "new installation member requires a separate bootstrap install"
        );
        members.push(CoordinatedBinaryReplacement::prepare(
            source,
            target,
            sha256(source)?,
        )?);
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
        // A dead executor must not re-execute a live publication below. The
        // installed identity — not successor liveness — then classifies the
        // interruption: only an incomplete publication rolls back.
        if a.successor_image
            .as_ref()
            .is_some_and(|e| native::image(e.pid).ok().as_ref() == Some(e))
        {
            return Ok(()); // Only the specifically launched successor can recover forward.
        }
        if !matches!(
            a.execution,
            tx::Execution::Consumed | tx::Execution::Replaced | tx::Execution::Uncertain
        ) {
            return Ok(());
        }
        // Classify before touching the Service: a complete publication keeps
        // the running Service and only records the Replaced marker.
        let publication = classify_before_stop(&mut store, || classify_installed(&a, &plan_path))?;
        if !publication.requires_service_stop() {
            if a.execution != tx::Execution::Replaced {
                store.execution(tx::Execution::Replaced)?;
            }
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
        None
    } else {
        Some(native::UserLaunch::capture(&a.initiating_image)?)
    };
    if !recovery {
        store.consume(&self_image, tx::now()?)?;
    }
    // From here every live/repair mutation has a durable consumed high-water.
    if recovery {
        // Classification and rollback do not run through the ONSTART task; it only re-arms the
        // net for this run. An unavailable Task Scheduler must not strand the attempt (#484).
        if let Err(error) = native::register_consumed_recovery(&store) {
            eprintln!(
                "update recovery task could not be registered; recovering without it: {error:#}"
            );
        }
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
        })?;
    }
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    let service = manager.open_service(
        tono_service_protocol::WINDOWS_SERVICE_NAME,
        ServiceAccess::ALL_ACCESS,
    )?;
    suppress_windows_service_recovery(&service)?;
    stop_windows_service(&service)?;
    let runtime = tokio::runtime::Runtime::new()?;
    let outcome = (|| -> Result<_, Error> {
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
                    if a.execution != tx::Execution::Replaced {
                        store.execution(tx::Execution::Replaced)?;
                    }
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
    if outcome.is_err() {
        // This marker cannot turn uncertain execution into another install grant.
        let _ = store.execution(tx::Execution::Uncertain);
    }
    // Even a failed plan/rollback must leave the IPC recovery Service available.
    configure_windows_service_recovery(&service)?;
    drop(store);
    drop(repair);
    // Resume the durable successor even when the restarted Service is slow or
    // failed to become ready: a suspended child dropped at this point would
    // terminate the registered successor of a complete, verified installation
    // and leave the next recovery a state it would otherwise roll back.
    let restart = (|| -> Result<(), Error> {
        service.start(&Vec::<&std::ffi::OsStr>::new())?;
        wait_for_service_ready()
    })();
    let successor = match outcome {
        Ok(child) => child,
        Err(error) => {
            restart?;
            return Err(error);
        }
    };
    if let Some(child) = successor {
        child.resume()?;
    }
    restart?;
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
            if bound
                && sha256(&m.publish_scratch).ok() == Some(m.new_digest)
                && sha256(&m.target).ok() == Some(m.old_digest)
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
        member.cleanup();
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

    #[test]
    fn update_recovery_classifies_publication_by_installed_identity_not_successor_liveness() {
        let target = Components {
            app_sha256: "t".into(),
            core_sha256: "tc".into(),
            privileged_sha256: "tp".into(),
        };
        let old = Components {
            app_sha256: "o".into(),
            core_sha256: "oc".into(),
            privileged_sha256: "op".into(),
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
        };
        let old = Components {
            app_sha256: "o".into(),
            core_sha256: "oc".into(),
            privileged_sha256: "op".into(),
        };
        // Replaced, successor closed before commit: nothing to restore, so the
        // Service is not stopped (a stop/start would spawn recovery again).
        assert!(!classify_recovery(true, true, &target, &target).requires_service_stop());
        // Rollback and the no-plan identity check still run with the Service stopped.
        assert!(classify_recovery(true, false, &target, &target).requires_service_stop());
        assert!(classify_recovery(false, false, &old, &target).requires_service_stop());
    }
}
