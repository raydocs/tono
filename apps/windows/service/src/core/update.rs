//! Native coordinator. All calls execute under the Service lifecycle writer;
//! the on-disk lock also serializes the independently running SYSTEM executor.
pub(crate) mod security;
use super::{
    auth::AuthenticatedOwner, desired, dns, manager, windows_kill_switch as wfp, windows_security,
};
use crate::update_contract::{
    Components, Observation, Phase, Protection, Receipt, ReleaseManifest, TargetId,
};
use crate::update_transaction::*;
use crate::update_wire::{UpdateRequest, UpdateStatus};
use anyhow::{Context as _, Result, ensure};
pub use security::{
    UserLaunch, app_image, image, install_root, parent_image, pin_path, tunnel_absent, verify_tree,
};
use std::{
    fs::OpenOptions,
    io::Read,
    path::{Path, PathBuf},
};

pub fn open_store() -> Result<Store> {
    let paths = crate::service_paths();
    windows_security::ensure_private_installer_directory(paths.persistent_state_dir())?;
    let root = paths.persistent_state_dir().join("updates-v1");
    windows_security::ensure_private_installer_directory(&root)?;
    let _pins = pin_path(&root, true)?;
    Store::open(&root)
}

pub fn pending() -> bool {
    // A locked/unreadable/corrupt store is uncertainty, not absence.
    open_store().map(|s| s.pending()).unwrap_or(true)
}

pub(crate) fn lifecycle_allowed(owner: &AuthenticatedOwner) -> Result<()> {
    let mut store = open_store()?;
    ensure!(
        store.state.manual_installer.is_none(),
        "manual installer owns the machine lifecycle"
    );
    if !store.pending() {
        return Ok(());
    }
    let a = store.live_attempt(now()?)?;
    ensure!(
        a.execution == Execution::Replaced
            && matches!(
                a.receipt.phase,
                Phase::InstalledIdentityVerified | Phase::RecoveryVerified
            )
            && a.receipt.required_recovery == Protection::Connected
            && a.receipt.owner == owner.key,
        "update pending; normal lifecycle is fenced, Disconnect is not update cancellation"
    );
    store.authenticate_successor(&app_image(owner.peer_pid.context("missing peer PID")?)?)?;
    Ok(())
}

pub(crate) fn release_allowed() -> Result<()> {
    let store = open_store()?;
    ensure!(
        !store.pending() && store.state.manual_installer.is_none(),
        "update pending; release/quit cannot cancel the recorded recovery obligation"
    );
    Ok(())
}

fn verify_manifest(bytes: &[u8], signature: &str) -> Result<ReleaseManifest> {
    let manifest = ReleaseManifest::decode(bytes)?;
    let key = security::decode_base64(
        option_env!("TONO_UPDATER_PUBLIC_KEY")
            .context("Service has no pinned updater public key")?,
    )?;
    verify_signature_text(bytes, &key, &security::decode_base64(signature)?)?;
    Ok(manifest)
}

fn verify_signature_text(bytes: &[u8], pinned_key: &str, signature: &str) -> Result<()> {
    let signature = minisign_verify::Signature::decode(signature)?;
    // Tauri's existing boxes support Ed and ED. This is algorithm compatibility,
    // not a runtime key or test-key exception.
    minisign_verify::PublicKey::decode(pinned_key)?.verify(bytes, &signature, true)?;
    Ok(())
}

pub fn copy_private(
    source: &Path,
    destination: &Path,
    expected_size: u64,
    expected_digest: &str,
) -> Result<()> {
    let held = pin_path(source, false)?;
    let input = held.last().context("no source handle")?;
    ensure!(
        input.metadata()?.is_file() && input.metadata()?.len() == expected_size,
        "package size changed"
    );
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let copied = std::io::copy(&mut input.take(expected_size + 1), &mut output)?;
    output.sync_all()?;
    drop(output);
    ensure!(
        copied == expected_size && file_digest(destination)? == expected_digest,
        "private package digest/size mismatch"
    );
    Ok(())
}

pub fn components(root: &Path, service: &Path) -> Result<Components> {
    verify_tree(root, 0)?;
    let _service = pin_path(service, true)?;
    for path in [
        root.join("Tono.exe"),
        root.join("tono-core.exe"),
        service.into(),
    ] {
        ensure!(
            !matches!(
                tono_authenticode::verify(&path),
                tono_authenticode::AuthenticodeVerdict::Invalid
            ),
            "invalid native image signature"
        );
    }
    Ok(Components {
        app_sha256: file_digest(&root.join("Tono.exe"))?,
        core_sha256: file_digest(&root.join("tono-core.exe"))?,
        privileged_sha256: file_digest(service)?,
    })
}

fn installed_components(root: &Path) -> Result<Components> {
    components(
        root,
        &crate::service_paths()
            .install_dir()
            .join("tono-service.exe"),
    )
}

async fn protection(owner: &AuthenticatedOwner) -> Result<Protection> {
    let wfp = wfp::observe_for_update().await?;
    let core = manager::CORE_MANAGER.lock().await.status().await;
    let record = super::runtime::read_core_runtime_record().await?;
    match (core.core_pid, record.as_ref()) {
        (Some(pid), Some(record)) => ensure!(
            pid == record.pid
                && super::process::process_identity(pid)?.as_ref() == Some(&record.identity),
            "Core kernel identity does not match its supervised runtime"
        ),
        (None, None) => tunnel_absent("Tono")?,
        _ => anyhow::bail!("Core bookkeeping and runtime evidence disagree"),
    }
    let dns = dns::observe_for_update().await?;
    ensure!(
        wfp.last_error.is_none() && dns.last_error.is_none(),
        "network protection is uncertain"
    );
    if wfp.wanted {
        wfp::authorize_write_for(&owner.key)?;
        ensure!(wfp.live, "WFP retention was not observed");
        if core.core_pid.is_some()
            && wfp.verified
            && wfp.tunnel_permit_rendered
            && wfp.mode == crate::KillSwitchStatusMode::Locked
            && dns.enabled
            && dns.snapshot_present
        {
            return Ok(Protection::Connected);
        }
        ensure!(
            core.core_pid.is_none()
                && !wfp.tunnel_permit_rendered
                && !dns.enabled
                && !dns.snapshot_present,
            "Core/WFP/DNS transition is not quiescent"
        );
        Ok(Protection::ProtectedOffline)
    } else {
        ensure!(
            core.core_pid.is_none() && !dns.enabled && !wfp::residual_filters_present().await?,
            "unprotected state not proven"
        );
        Ok(Protection::Unprotected)
    }
}

fn owner_proxy_absent(owner: &AuthenticatedOwner) -> Result<()> {
    let crate::OwnerIdentity::Windows { sid } = &owner.identity else {
        anyhow::bail!("not a Windows owner");
    };
    security::no_proxy(sid)
}

pub(crate) async fn request(
    owner: &AuthenticatedOwner,
    request: UpdateRequest,
) -> Result<UpdateStatus> {
    let peer = app_image(owner.peer_pid.context("pipe did not identify App")?)?;
    let mut store = open_store()?;
    ensure!(
        store.state.manual_installer.is_none(),
        "manual installation is pending"
    );
    let _repair =
        crate::acquire_service_repair_gate()?.context("repair/uninstall already running")?;
    if let Some(a) = &store.state.attempt
        && store.pending()
    {
        ensure!(
            a.receipt.owner == owner.key,
            "update belongs to another owner"
        );
    }
    match request {
        UpdateRequest::Status => {}
        UpdateRequest::Check {
            manifest,
            signature,
        } => {
            let manifest = verify_manifest(manifest.as_bytes(), &signature)?;
            let mut result = status(&store)?;
            ensure!(!store.pending(), "a prior update needs reconciliation");
            if manifest.release_sequence > installed_floor()?.max(store.state.consumed_sequence) {
                result.offer = Some(manifest);
            }
            return Ok(result);
        }
        UpdateRequest::Prepare {
            manifest,
            signature,
            package_path,
        } => {
            let manifest = verify_manifest(manifest.as_bytes(), &signature)?;
            if store.pending() {
                let a = store.attempt()?;
                ensure!(
                    a.initiating_image == peer && a.receipt.manifest_sha256 == manifest.sha256()?,
                    "different pending update"
                );
                return status(&store); // Lost ack is a query, never repeat preparation.
            }
            ensure!(
                manifest.release_sequence > installed_floor()?.max(store.state.consumed_sequence),
                "release replay/downgrade refused"
            );
            let root = install_root()?;
            let required = protection(owner).await?;
            owner_proxy_absent(owner)?;
            if let Some(active) = desired::load_active_owner().await? {
                ensure!(
                    active.owner_key == owner.key,
                    "active session belongs to another owner"
                );
            }
            let time = now()?;
            let generation = store
                .state
                .generation
                .checked_add(1)
                .context("generation overflow")?;
            let attempt_id = security::random_id()?;
            let receipt = Receipt {
                attempt_id,
                blocked_reason: None,
                created_at_unix: time,
                expires_at_unix: time + 172_800,
                initiating_generation: generation,
                installed_location_sha256: location_digest(&root),
                kind: "tonoUpdateReceipt".into(),
                manifest_sha256: manifest.sha256()?,
                owner: owner.key.clone(),
                phase: Phase::Preparing,
                protocol_version: 1,
                required_recovery: required,
                successor_generation: None,
                target_id: TargetId::WindowsX86_64,
                updated_at_unix: time,
            };
            let old_components = installed_components(&root)?;
            let mut next = store.state.clone();
            next.generation = generation;
            next.attempt = Some(Attempt {
                manifest,
                receipt,
                initiating_image: peer.clone(),
                successor_image: None,
                install_root: root.clone(),
                execution: Execution::Reserved,
                executor: None,
                old_components,
                disconnect: None,
            });
            store.save(next)?; // Before staging, quiescence, or ownership changes.
            let dir = store.attempt_dir()?;
            windows_security::ensure_private_installer_directory(&dir)?;
            windows_security::ensure_private_installer_directory(&dir.join("payload"))?;
            let target = target(&store.attempt()?.manifest).clone();
            let source = PathBuf::from(package_path);
            let _source_pins = pin_path(&source, false)?;
            ensure!(
                source.canonicalize()?.starts_with(&owner.app_data_root),
                "download is outside the authenticated App data root"
            );
            copy_private(
                &source,
                &dir.join("package.exe"),
                target.artifact_size_bytes,
                &target.artifact_sha256,
            )?;
            let helper = root.join("resources/tono-service-install.exe");
            copy_private(
                &helper,
                &dir.join("executor.exe"),
                std::fs::metadata(&helper)?.len(),
                &file_digest(&helper)?,
            )?;
            store.execution(Execution::Extracting)?;
            drop(store);
            // Verified package code only unpacks private files. Its NSIS entry
            // authenticates this exact private package before any Section runs.
            let exit = tokio::process::Command::new(dir.join("package.exe"))
                .args(["/S", "/TONO-PRIVATE-UNPACK"])
                .status()
                .await?;
            ensure!(
                exit.success(),
                "private package extraction failed; evidence retained"
            );
            store = open_store()?;
            ensure!(
                components(
                    &dir.join("payload"),
                    &dir.join("payload/resources/tono-service.exe")
                )? == target.components,
                "package components do not match signed target"
            );
            store.execution(Execution::Staged)?;
            let prior_core = super::runtime::read_core_runtime_record().await?;
            manager::CORE_MANAGER.lock().await.stop_core().await?;
            if let Some(prior) = prior_core {
                ensure!(
                    super::process::process_identity(prior.pid)?.as_ref() != Some(&prior.identity),
                    "stopped Core incarnation is still running"
                );
            }
            desired::persist_owner_core_stopped(owner).await?;
            wfp::transition_after_stop(false).await?;
            let restored = dns::restore_protected().await?;
            ensure!(
                !restored.enabled && restored.last_error.is_none(),
                "strict DNS cleanup not observed"
            );
            owner_proxy_absent(owner)?;
            ensure!(
                app_image(peer.pid)? == peer,
                "initiating image changed during preparation"
            );
            let observed = protection(owner).await?;
            store.observe(
                &owner.key,
                &peer,
                generation,
                now()?,
                Observation::PreparationVerified {
                    artifact_sha256: file_digest(&dir.join("package.exe"))?,
                    protection: observed,
                },
            )?;
        }
        UpdateRequest::Install { attempt_id } => {
            let a = store.live_attempt(now()?)?;
            ensure!(
                a.receipt.attempt_id == attempt_id && a.initiating_image == peer,
                "install peer/attempt mismatch"
            );
            // No second launch after an uncertain spawn/ack. Reconciliation owns it.
            if a.execution != Execution::Staged {
                return status(&store);
            }
            ensure!(
                a.receipt.phase == Phase::InstallationAuthorized,
                "preparation incomplete"
            );
            let dir = store.attempt_dir()?;
            store.execution(Execution::Launching)?;
            let child = std::process::Command::new(dir.join("executor.exe"))
                .arg("--update-execute")
                .spawn()?;
            let executor = image(child.id())?;
            let mut next = store.state.clone();
            next.attempt.as_mut().unwrap().executor = Some(executor);
            store.save(next)?;
            // Child waits for the persisted identity while this lock is held.
        }
        UpdateRequest::Disconnect => {
            if !store.pending() {
                return status(&store);
            }
            // Record the explicit authenticated request before any release.
            // The original recovery obligation is never rewritten as Unprotected.
            store.request_disconnect(&owner.key, &peer, now()?)?;
            wfp::authorize_write_for(&owner.key)?;
            if let Some(active) = desired::load_active_owner().await? {
                ensure!(
                    active.owner_key == owner.key,
                    "active Core belongs to another owner"
                );
            }
            owner_proxy_absent(owner)?;
            dns::ensure_restored().await?;
            let prior = super::runtime::read_core_runtime_record().await?;
            manager::CORE_MANAGER.lock().await.stop_core().await?;
            if let Some(prior) = prior {
                ensure!(
                    super::process::process_identity(prior.pid)?.as_ref() != Some(&prior.identity),
                    "Core survived explicit Disconnect"
                );
            }
            desired::persist_owner_core_stopped(owner).await?;
            desired::clear_active_owner().await?;
            tunnel_absent("Tono")?;
            wfp::release().await?;
            owner_proxy_absent(owner)?;
            let observed = protection(owner).await?;
            ensure!(
                app_image(peer.pid)? == peer,
                "Disconnect peer changed before readback"
            );
            store.verify_disconnect(&owner.key, &peer, now()?, observed)?;
            let a = store.attempt()?;
            let executor_gone = a
                .executor
                .as_ref()
                .is_none_or(|e| image(e.pid).ok().as_ref() != Some(e));
            if matches!(
                a.execution,
                Execution::Reserved | Execution::Extracting | Execution::Staged | Execution::Launching
            ) && executor_gone
            {
                ensure!(
                    installed_components(&a.install_root)? == a.old_components,
                    "original installed identity changed; evidence cannot be retired"
                );
                store.retire_unconsumed(&owner.key, &peer)?;
            } else if matches!(a.execution, Execution::RolledBack | Execution::Uncertain) {
                // A proven rollback reaches a terminal archive without
                // lowering the consumed high-water or rewriting the recorded
                // obligation; an unproven one stays pending below.
                ensure!(
                    installed_components(&a.install_root)? == a.old_components,
                    "rollback not proven complete; evidence cannot be retired"
                );
                store.retire_rolled_back(&owner.key, &peer)?;
            }
            // Records whose replacement is still in flight (Consumed/Replaced,
            // a live executor, or an unproven rollback) stay pending after
            // release. They cannot install, reconnect or commit by
            // fabricating recovery.
        }
        UpdateRequest::Adopt => {
            if !store.pending() {
                return status(&store);
            }
            store.authenticate_successor(&peer)?;
            let a = store.live_attempt(now()?)?;
            ensure!(
                a.execution == Execution::Replaced,
                "replacement not proved by executor"
            );
            ensure!(
                peer != a.initiating_image && peer.path == a.initiating_image.path,
                "not a successor process"
            );
            ensure!(
                installed_components(&a.install_root)? == target(&a.manifest).components,
                "installed target mismatch"
            );
            if store.attempt()?.receipt.phase == Phase::InstallationAuthorized {
                let generation = store
                    .state
                    .generation
                    .checked_add(1)
                    .context("generation overflow")?;
                let actual = installed_components(&store.attempt()?.install_root)?;
                store.observe(
                    &owner.key,
                    &peer,
                    generation,
                    now()?,
                    Observation::InstalledIdentityVerified { components: actual },
                )?;
            }
        }
        UpdateRequest::Commit => {
            if !store.pending() {
                return status(&store);
            }
            store.authenticate_successor(&peer)?;
            let a = store.live_attempt(now()?)?;
            ensure!(
                a.successor_image.as_ref() == Some(&peer) && a.execution == Execution::Replaced,
                "successor not adopted"
            );
            let generation = a
                .receipt
                .successor_generation
                .context("missing successor generation")?;
            owner_proxy_absent(owner)?;
            let actual = installed_components(&a.install_root)?;
            let observed = protection(owner).await?;
            if a.receipt.phase == Phase::InstalledIdentityVerified {
                store.observe(
                    &owner.key,
                    &peer,
                    generation,
                    now()?,
                    Observation::RecoveryVerified {
                        components: actual,
                        protection: observed,
                    },
                )?;
            }
            // Fresh native observations at commit, not the App's connection flag.
            ensure!(
                app_image(peer.pid)? == peer,
                "successor changed before commit"
            );
            let actual = installed_components(&store.attempt()?.install_root)?;
            let observed = protection(owner).await?;
            store.observe(
                &owner.key,
                &peer,
                generation,
                now()?,
                Observation::CommitVerified {
                    components: actual,
                    protection: observed,
                },
            )?;
            // Executor/recovery task owns deleting backups, only after this write.
        }
    }
    status(&store)
}

fn status(store: &Store) -> Result<UpdateStatus> {
    Ok(UpdateStatus {
        receipt: store.state.attempt.as_ref().map(|a| a.receipt.clone()),
        execution: store
            .state
            .attempt
            .as_ref()
            .map(|a| format!("{:?}", a.execution))
            .unwrap_or_else(|| "none".into()),
        offer: None,
    })
}

/// The scheduled task is a repair resource, so even its first registration is
/// behind durable consumption. Startup uses this same boundary after reopen.
pub fn register_consumed_recovery(store: &Store) -> Result<()> {
    register_recovery_with(store, |dir| {
        let command = format!(
            "\"{}\" --update-recover",
            dir.join("executor.exe").display()
        );
        let result = std::process::Command::new("C:\\Windows\\System32\\schtasks.exe")
            .args([
                "/Create",
                "/TN",
                "Tono Update Recovery v1",
                "/SC",
                "ONSTART",
                "/RU",
                "SYSTEM",
                "/RL",
                "HIGHEST",
                "/TR",
                &command,
                "/F",
            ])
            .output()?;
        ensure!(
            result.status.success(),
            "could not register independent SYSTEM recovery executor"
        );
        Ok(())
    })
}

fn register_recovery_with(store: &Store, register: impl FnOnce(&Path) -> Result<()>) -> Result<()> {
    store.consumed_attempt()?;
    register(&store.attempt_dir()?)
}

/// Called by NSIS before live or repair writes. Only the verified package in
/// this attempt's private directory can use extraction mode; no live permission.
pub fn unpack_gate(package: &Path) -> Result<()> {
    let store = open_store()?;
    let a = store.live_attempt(now()?)?;
    ensure!(
        a.execution == Execution::Extracting && a.receipt.phase == Phase::Preparing,
        "not extracting"
    );
    let package = package.canonicalize()?;
    ensure!(
        package == store.attempt_dir()?.join("package.exe").canonicalize()?,
        "different NSIS package"
    );
    let parent = parent_image()?;
    ensure!(
        parent.path == package && parent.sha256 == target(&a.manifest).artifact_sha256,
        "gate caller is not the private verified NSIS process"
    );
    ensure!(
        file_digest(&package)? == target(&a.manifest).artifact_sha256,
        "NSIS package changed"
    );
    Ok(())
}

/// Manual installation/repair has no protected transaction bridge. A missing,
/// corrupt or armed marker cannot be converted to permission by an installer.
pub fn maintenance_allowed() -> Result<()> {
    let store = open_store()?;
    ensure!(
        !store.pending(),
        "update evidence pending; manual replacement/uninstall refused"
    );
    if let Some(installer) = &store.state.manual_installer {
        ensure!(
            parent_image()? == *installer,
            "a different manual installer owns the machine"
        );
    }
    Ok(())
}

pub async fn manual_gate() -> Result<()> {
    maintenance_allowed()?;
    ensure!(
        !wfp::residual_filters_present().await?,
        "Disconnect before manual installation"
    );
    let paths = crate::service_paths();
    if let Ok(bytes) = std::fs::read(paths.active_owner_path()) {
        let active: crate::ActiveOwnerState = serde_json::from_slice(&bytes)?;
        ensure!(
            !desired::load_owner_desired_state(&active.owner_key)
                .await?
                .core_should_be_running,
            "Disconnect before manual installation"
        );
    } else {
        ensure!(
            !paths.active_owner_path().try_exists()?,
            "active owner is unreadable"
        );
    }
    let restored = dns::restore_protected().await?;
    ensure!(
        !restored.enabled && restored.last_error.is_none(),
        "manual install DNS cleanup is unproven"
    );
    manual_core_absent().await?;
    Ok(())
}

async fn manual_core_absent() -> Result<()> {
    if let Some(record) = super::runtime::read_core_runtime_record().await? {
        ensure!(
            super::process::process_identity(record.pid)?.as_ref() != Some(&record.identity),
            "Disconnect before manual installation: Core is still running"
        );
    }
    tunnel_absent("Tono")
}

/// The manual gate refused only because Tono protection is still active: no
/// update is pending and no other installer holds the lease. NSIS turns this
/// into its own exit code so the customer is told to Disconnect instead of
/// seeing the installer exit silently. It is never permission to proceed.
#[derive(Debug)]
pub struct ProtectionActive;

impl std::fmt::Display for ProtectionActive {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Disconnect before manual installation")
    }
}

impl std::error::Error for ProtectionActive {}

/// Exit code of `--manual-update-gate` for [`ProtectionActive`]; kept in sync with installer.nsi.
pub const MANUAL_GATE_PROTECTION_ACTIVE_EXIT: i32 = 77;

/// NSIS calls this before *any* live or repair-resource mutation. The durable
/// lease fences Service connect/restart even after the short-lived gate exits.
pub async fn begin_manual() -> Result<()> {
    let installer = parent_image()?;
    let _repair =
        crate::acquire_service_repair_gate()?.context("another lifecycle writer is active")?;
    let mut store = open_store()?;
    ensure!(!store.pending(), "update evidence pending");
    if let Some(previous) = &store.state.manual_installer {
        ensure!(
            security::process_matches(previous).is_err() || *previous == installer,
            "another manual installer is active"
        );
    }
    drop(store);
    // No stale manual lease may turn armed/unknown protection into permission.
    ensure!(!wfp::residual_filters_present().await?, ProtectionActive);
    let paths = crate::service_paths();
    if paths.active_owner_path().try_exists()? {
        let active: crate::ActiveOwnerState =
            serde_json::from_slice(&std::fs::read(paths.active_owner_path())?)?;
        ensure!(
            !desired::load_owner_desired_state(&active.owner_key)
                .await?
                .core_should_be_running,
            ProtectionActive
        );
    }
    let restored = dns::restore_protected().await?;
    ensure!(
        !restored.enabled && restored.last_error.is_none(),
        "DNS restoration is unproven"
    );
    manual_core_absent().await?;
    store = open_store()?;
    let mut next = store.state.clone();
    next.manual_installer = Some(installer);
    store.save(next)
}

/// Uninstall only, after the user confirmed releasing active protection. The
/// uninstaller's own ladder (`RemoveVergeService`) releases protection and
/// deletes nothing unless WFP removal is proven, so this takes the same
/// update/installer lease as [`begin_manual`] without requiring Disconnect.
pub fn begin_manual_uninstall() -> Result<()> {
    let installer = parent_image()?;
    let _repair =
        crate::acquire_service_repair_gate()?.context("another lifecycle writer is active")?;
    let mut store = open_store()?;
    ensure!(!store.pending(), "update evidence pending");
    if let Some(previous) = &store.state.manual_installer {
        ensure!(
            security::process_matches(previous).is_err() || *previous == installer,
            "another manual installer is active"
        );
    }
    let mut next = store.state.clone();
    next.manual_installer = Some(installer);
    store.save(next)
}

pub fn finish_manual() -> Result<()> {
    let mut store = open_store()?;
    ensure!(
        store.state.manual_installer.as_ref() == Some(&parent_image()?),
        "manual installer mismatch"
    );
    let mut next = store.state.clone();
    next.manual_installer = None;
    store.save(next)
}

/// Startup must not retire protection or restore desired Core while update
/// evidence exists. ONSTART recovery can repair binaries even if Service will
/// not load. A live Service also wakes that same independent executor.
pub fn reconcile_before_desired() -> Result<bool> {
    let mut store = open_store()?;
    if store.state.manual_installer.is_some() {
        return Ok(true);
    }
    if !store.pending() {
        return Ok(false);
    }
    // A Launching attempt whose recorded executor incarnation is gone can
    // never be consumed (consumption only accepts that exact incarnation)
    // and the durable high-water proves none was. Return it to Staged: the
    // same initiating App may launch again, and a Disconnect can retire it.
    // This is not a second execution grant — nothing was executed.
    if store.state.attempt.as_ref().is_some_and(|a| {
        a.execution == Execution::Launching
            && store.state.consumed_sequence < a.manifest.release_sequence
            && a.executor
                .as_ref()
                .is_none_or(|e| image(e.pid).ok().as_ref() != Some(e))
    }) {
        let mut next = store.state.clone();
        let attempt = next.attempt.as_mut().context("attempt checked above")?;
        attempt.execution = Execution::Staged;
        attempt.executor = None;
        store.save(next)?;
        return Ok(true);
    }
    let a = store.attempt()?;
    if matches!(
        a.execution,
        Execution::Consumed | Execution::Replaced | Execution::Uncertain
    ) {
        register_consumed_recovery(&store)?;
        if a.executor
            .as_ref()
            .is_none_or(|e| image(e.pid).ok().as_ref() != Some(e))
        {
            std::process::Command::new(store.attempt_dir()?.join("executor.exe"))
                .arg("--update-recover")
                .spawn()?;
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_recovery_registration_requires_durable_consumption() {
        use crate::update_transaction::tests::{authorize, reserved};
        let (root, mut store, peer, executor) = reserved();
        let task = root.join("recovery-task");
        assert!(register_recovery_with(&store, |_| panic!("pre-consume repair mutation")).is_err());
        authorize(&mut store, &peer);
        assert!(
            register_recovery_with(&store, |_| panic!("launching is not consumption")).is_err()
        );
        assert!(!task.exists());
        store.consume(&executor, 1_900_000_002).unwrap();
        // Replace only schtasks I/O. The actual production registration gate
        // checks the same durable state before handing control to the writer.
        register_recovery_with(&store, |dir| {
            let durable: State = serde_json::from_slice(&std::fs::read(root.join("state.json"))?)?;
            let a = durable.attempt.unwrap();
            assert_eq!(a.execution, Execution::Consumed);
            assert_eq!(durable.consumed_sequence, 74);
            assert_eq!(dir, root.join(a.receipt.attempt_id));
            atomic_write(&task, b"registered")
        })
        .unwrap();
        drop(store);
        let store = Store::open(&root).unwrap();
        register_recovery_with(&store, |_| atomic_write(&task, b"reconciled")).unwrap();
        assert_eq!(std::fs::read(task).unwrap(), b"reconciled");
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_signature_binds_exact_bytes_and_trusted_comment() {
        // Existing public minisign verification vector, also used by packaging.
        // No secret key, signing operation, or compiled-key bypass is introduced.
        let key = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let signature = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";
        verify_signature_text(b"test", key, signature).unwrap();
        assert!(verify_signature_text(b"teSt", key, signature).is_err());
        assert!(
            verify_signature_text(b"test", key, &signature.replace("file:test", "file:other"))
                .is_err()
        );
        assert!(verify_signature_text(b"test", "", signature).is_err());
    }

    #[test]
    fn update_private_copy_rejects_changed_size_digest_and_reparse_input() {
        let root = std::env::temp_dir().join(format!(
            "tono-private-copy-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let input = root.join("download.exe");
        std::fs::write(&input, b"test").unwrap();
        // Independently fixed SHA-256, not the output of the helper under test.
        let expected = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
        copy_private(&input, &root.join("private.exe"), 4, expected).unwrap();
        assert_eq!(std::fs::read(root.join("private.exe")).unwrap(), b"test");
        assert!(copy_private(&input, &root.join("private.exe"), 4, expected).is_err());
        assert!(copy_private(&input, &root.join("wrong-size.exe"), 5, expected).is_err());
        std::fs::write(&input, b"teSt").unwrap();
        assert!(copy_private(&input, &root.join("changed.exe"), 4, expected).is_err());
        assert_eq!(
            std::fs::read(root.join("changed.exe")).unwrap(),
            b"teSt",
            "failed evidence is retained, not promoted"
        );
        std::os::windows::fs::symlink_file(&input, root.join("linked.exe")).unwrap();
        assert!(
            copy_private(
                &root.join("linked.exe"),
                &root.join("linked-copy.exe"),
                4,
                expected
            )
            .is_err()
        );
        assert!(!root.join("linked-copy.exe").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
