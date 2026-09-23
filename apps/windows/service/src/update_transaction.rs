//! Service-owned durable update authority. No App journal is read here.
//! Native effects live in `windows`; the same store/consumption boundary is
//! exercised with real files and substituted I/O in the focused tests.
use crate::update_contract::{
    Components, Context, Observation, Phase, Protection, Receipt, ReleaseManifest, Target,
    TargetId, canonical,
};
use anyhow::{Context as _, Result, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Image {
    pub pid: u32,
    pub started_at: u64,
    pub path: PathBuf,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Execution {
    Reserved,
    Extracting,
    Staged,
    Launching,
    Consumed,
    Replaced,
    RolledBack,
    Uncertain,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisconnectEvidence {
    pub requested_at_unix: u64,
    pub verified_at_unix: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attempt {
    pub manifest: ReleaseManifest,
    pub receipt: Receipt,
    pub initiating_image: Image,
    pub successor_image: Option<Image>,
    pub install_root: PathBuf,
    pub execution: Execution,
    pub executor: Option<Image>,
    pub old_components: Components,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disconnect: Option<DisconnectEvidence>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub consumed_sequence: u64,
    pub generation: u64,
    pub attempt: Option<Attempt>,
    pub manual_installer: Option<Image>,
}

impl State {
    fn validate(&self) -> Result<()> {
        ensure!(
            self.consumed_sequence <= 9_007_199_254_740_991
                && self.generation <= 9_007_199_254_740_991,
            "update high-water or generation exceeds protocol bounds"
        );
        if let Some(a) = &self.attempt {
            a.manifest.validate()?;
            Receipt::decode(&canonical(&a.receipt)?, &a.manifest)?;
            ensure!(
                a.receipt.target_id == TargetId::WindowsX86_64
                    && a.receipt.installed_location_sha256 == location_digest(&a.install_root)
                    && a.initiating_image.path == a.install_root.join("Tono.exe"),
                "update installation binding corrupted"
            );
            ensure!(
                self.generation
                    >= a.receipt
                        .successor_generation
                        .unwrap_or(a.receipt.initiating_generation),
                "update generation regressed"
            );
            if matches!(
                a.execution,
                Execution::Consumed
                    | Execution::Replaced
                    | Execution::RolledBack
                    | Execution::Uncertain
            ) {
                ensure!(
                    self.consumed_sequence >= a.manifest.release_sequence,
                    "consumed high-water evidence missing"
                );
            }
            if a.execution == Execution::Replaced {
                // An absent successor means recovery measured the verified
                // target on disk after the executor-launched successor was
                // never durably registered; the first authenticated
                // target-identity App re-proves it on adoption.
                ensure!(
                    a.successor_image.as_ref().is_none_or(|s| s.path == a.initiating_image.path
                        && s.sha256 == target(&a.manifest).components.app_sha256),
                    "successor evidence conflicts"
                );
            }
            if matches!(
                a.receipt.phase,
                Phase::InstalledIdentityVerified | Phase::RecoveryVerified | Phase::Committed
            ) {
                ensure!(
                    a.execution == Execution::Replaced
                        || (a.receipt.phase != Phase::Committed
                            && matches!(a.execution, Execution::RolledBack | Execution::Uncertain)),
                    "proof/execution evidence conflicts"
                );
            }
            ensure!(
                self.manual_installer.is_none() || a.receipt.phase == Phase::Committed,
                "manual lease conflicts with pending update"
            );
            if let Some(disconnect) = &a.disconnect {
                ensure!(
                    a.receipt.phase != Phase::Committed
                        && disconnect.requested_at_unix >= a.receipt.created_at_unix
                        && disconnect
                            .verified_at_unix
                            .is_none_or(|at| at >= disconnect.requested_at_unix),
                    "explicit Disconnect evidence conflicts with transaction"
                );
            }
        }
        Ok(())
    }
}

pub struct Store {
    root: PathBuf,
    _lock: File,
    write_failed: bool,
    pub state: State,
}

impl Store {
    /// The caller must establish a native private, non-reparse root first.
    pub fn open(root: &Path) -> Result<Self> {
        Self::open_with(root, atomic_write)
    }

    fn open_with(root: &Path, reaffirm: impl FnOnce(&Path, &[u8]) -> Result<()>) -> Result<Self> {
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("transaction.lock"))?;
        lock.try_lock()
            .context("another update operation owns the durable store")?;
        let state = match File::open(root.join("state.json")) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(65_537).read_to_end(&mut bytes)?;
                ensure!(
                    bytes.len() <= 65_536,
                    "update state exceeds limit; evidence retained"
                );
                let state: State =
                    serde_json::from_slice(&bytes).context("corrupt update evidence retained")?;
                state.validate()?;
                // A rename can become visible before a failed durability ack.
                // Do not promote mere visibility on query/restart to authority:
                // re-publish these exact bytes under the lock, with a fresh
                // successful sync + WRITE_THROUGH acknowledgement, first.
                reaffirm(&root.join("state.json"), &bytes)?;
                state
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                ensure!(
                    std::fs::read_dir(root)?
                        .all(|entry| entry.is_ok_and(|e| e.file_name() == "transaction.lock")),
                    "orphan update evidence without state; manual recovery required"
                );
                State::default()
            }
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            root: root.into(),
            _lock: lock,
            write_failed: false,
            state,
        })
    }

    pub fn save(&mut self, candidate: State) -> Result<()> {
        self.save_with(candidate, atomic_write)
    }

    fn save_with(
        &mut self,
        candidate: State,
        write: impl FnOnce(&Path, &[u8]) -> Result<()>,
    ) -> Result<()> {
        ensure!(
            !self.write_failed,
            "failed write requires reopening durable evidence"
        );
        candidate.validate()?;
        let bytes = serde_json::to_vec(&candidate)?;
        if let Err(error) = write(&self.root.join("state.json"), &bytes) {
            self.write_failed = true;
            return Err(error);
        }
        self.state = candidate; // Never acknowledge/publish a failed write.
        Ok(())
    }

    pub fn pending(&self) -> bool {
        self.state
            .attempt
            .as_ref()
            .is_some_and(|a| a.receipt.phase != Phase::Committed)
    }

    pub fn attempt_dir(&self) -> Result<PathBuf> {
        Ok(self.root.join(&self.attempt()?.receipt.attempt_id))
    }

    pub fn attempt(&self) -> Result<&Attempt> {
        self.state.attempt.as_ref().context("no update attempt")
    }

    pub fn live_attempt(&self, now: u64) -> Result<&Attempt> {
        ensure!(!self.write_failed, "disk acknowledgement is uncertain");
        let a = self.attempt()?;
        ensure!(
            a.receipt.blocked_reason.is_none()
                && a.receipt.phase != Phase::Committed
                && a.disconnect.is_none(),
            "attempt cannot grant further authority"
        );
        ensure!(
            now >= a.receipt.updated_at_unix && now < a.receipt.expires_at_unix,
            "expired/clock-uncertain evidence retained"
        );
        Ok(a)
    }

    /// All checks and the high-water/consumed write precede the effect. An exact
    /// retry observes `Consumed` and refuses: it is not another installation grant.
    pub fn consume(&mut self, executor: &Image, now: u64) -> Result<()> {
        self.consume_with(executor, now, atomic_write)
    }

    fn consume_with(
        &mut self,
        executor: &Image,
        now: u64,
        write: impl FnOnce(&Path, &[u8]) -> Result<()>,
    ) -> Result<()> {
        let a = self.live_attempt(now)?;
        ensure!(
            a.receipt.phase == Phase::InstallationAuthorized && a.execution == Execution::Launching,
            "installation already consumed or not authorized"
        );
        ensure!(
            a.executor.as_ref() == Some(executor),
            "installer process incarnation mismatch"
        );
        ensure!(
            a.manifest.release_sequence > self.state.consumed_sequence,
            "release sequence was consumed"
        );
        let mut next = self.state.clone();
        next.consumed_sequence = a.manifest.release_sequence;
        let attempt = next.attempt.as_mut().unwrap();
        attempt.execution = Execution::Consumed;
        attempt.receipt.updated_at_unix = now;
        self.save_with(next, write)
    }

    /// Shared gate for repair-resource mutation, including recovery registration.
    /// Store::open re-establishes durability before a restart can reach this gate.
    pub fn consumed_attempt(&self) -> Result<&Attempt> {
        ensure!(!self.write_failed, "consumption durability is uncertain");
        let a = self.attempt()?;
        ensure!(
            matches!(
                a.execution,
                Execution::Consumed
                    | Execution::Replaced
                    | Execution::RolledBack
                    | Execution::Uncertain
            ) && self.state.consumed_sequence >= a.manifest.release_sequence,
            "repair mutation requires durable consumption"
        );
        Ok(a)
    }

    fn disconnect_peer(&self, owner: &str, peer: &Image) -> Result<&Attempt> {
        ensure!(
            !self.write_failed && self.pending(),
            "no durable pending attempt"
        );
        let a = self.attempt()?;
        ensure!(a.receipt.owner == owner, "Disconnect owner mismatch");
        // Identity, not incarnation: the executor terminates the initiating
        // process and successors exit before commit, so requiring the exact
        // recorded pid+started_at strands the transaction with no provable
        // peer. The Service derives `peer` from the authenticated pipe, so a
        // passing process is the owner's live App at the registered install
        // root running known bytes (original or target).
        ensure!(
            peer.path == a.initiating_image.path
                && (peer.sha256 == a.initiating_image.sha256
                    || peer.sha256 == a.old_components.app_sha256
                    || peer.sha256 == target(&a.manifest).components.app_sha256),
            "Disconnect requires the registered App identity"
        );
        Ok(a)
    }

    /// Explicit release is not cancellation or successful recovery. Persist its
    /// request before touching protection and leave requiredRecovery unchanged.
    pub fn request_disconnect(&mut self, owner: &str, peer: &Image, now: u64) -> Result<()> {
        let a = self.disconnect_peer(owner, peer)?;
        ensure!(
            now >= a.receipt.updated_at_unix,
            "Disconnect clock is uncertain"
        );
        if a.disconnect.is_some() {
            return Ok(());
        }
        let mut next = self.state.clone();
        next.attempt.as_mut().unwrap().disconnect = Some(DisconnectEvidence {
            requested_at_unix: now,
            verified_at_unix: None,
        });
        self.save(next)
    }

    pub fn verify_disconnect(
        &mut self,
        owner: &str,
        peer: &Image,
        now: u64,
        observed: Protection,
    ) -> Result<()> {
        let a = self.disconnect_peer(owner, peer)?;
        let requested = a
            .disconnect
            .as_ref()
            .context("Disconnect was not requested")?;
        ensure!(
            observed == Protection::Unprotected && now >= requested.requested_at_unix,
            "fresh unprotected readback is required"
        );
        let mut next = self.state.clone();
        next.attempt
            .as_mut()
            .unwrap()
            .disconnect
            .as_mut()
            .unwrap()
            .verified_at_unix = Some(now);
        self.save(next)
    }

    /// Archive the full durable state and clear the live slot. The original
    /// obligation, private payload and sequence/generation high-water remain.
    fn archive_attempt(
        &mut self,
        attempt_id: &str,
        archive: impl FnOnce(&Path, &[u8]) -> Result<()>,
    ) -> Result<()> {
        let path = self
            .root
            .join(format!("retired-{attempt_id}.json"));
        if let Err(error) = archive(&path, &serde_json::to_vec(&self.state)?) {
            self.write_failed = true;
            return Err(error);
        }
        // Never lower sequence/generation or turn explicit release into commit.
        let mut next = self.state.clone();
        next.attempt = None;
        self.save(next)
    }

    pub fn retire_unconsumed(&mut self, owner: &str, peer: &Image) -> Result<()> {
        self.retire_unconsumed_with(owner, peer, atomic_write)
    }

    fn retire_unconsumed_with(
        &mut self,
        owner: &str,
        peer: &Image,
        archive: impl FnOnce(&Path, &[u8]) -> Result<()>,
    ) -> Result<()> {
        let a = self.disconnect_peer(owner, peer)?;
        // Consumption is impossible when the durable high-water still sits
        // below the release AND the recorded executor incarnation is gone
        // (never registered, or provably dead): `consume_with` only accepts
        // that exact executor incarnation.
        ensure!(
            a.executor
                .as_ref()
                .is_none_or(|e| !incarnation_live(e))
                && matches!(
                    a.execution,
                    Execution::Reserved | Execution::Extracting | Execution::Staged
                        | Execution::Launching
                )
                && self.state.consumed_sequence < a.manifest.release_sequence
                && a.disconnect
                    .as_ref()
                    .is_some_and(|d| d.verified_at_unix.is_some()),
            "consumed, live-executor or unverified evidence cannot be retired"
        );
        let attempt_id = a.receipt.attempt_id.clone();
        self.archive_attempt(&attempt_id, archive)
    }

    /// Terminal archive for an attempt whose physical replacement already
    /// undid itself (or never happened). Requires the same verified explicit
    /// Disconnect as unconsumed retirement; the caller separately proves the
    /// installed components equal the retained originals. The consumed
    /// high-water is never lowered and no recovery is fabricated.
    pub fn retire_rolled_back(&mut self, owner: &str, peer: &Image) -> Result<()> {
        let a = self.disconnect_peer(owner, peer)?;
        ensure!(
            matches!(a.execution, Execution::RolledBack | Execution::Uncertain)
                && a.disconnect
                    .as_ref()
                    .is_some_and(|d| d.verified_at_unix.is_some()),
            "only a verified Disconnect of a rolled-back attempt can be retired"
        );
        let attempt_id = a.receipt.attempt_id.clone();
        self.archive_attempt(&attempt_id, atomic_write)
    }

    /// Only a target-identity App at the registered installation can adopt:
    /// the executor-created successor directly, or — once that recorded
    /// incarnation is gone — a later process whose current bytes are the
    /// verified target. A path now naming new bytes says nothing about a
    /// second old mapped App image, so a rebinding peer must postdate the
    /// recorded successor and must not recycle its pid.
    pub fn authenticate_successor(&mut self, peer: &Image) -> Result<()> {
        let a = self.attempt()?;
        ensure!(
            a.execution == Execution::Replaced
                && peer.path == a.initiating_image.path
                && peer.sha256 == target(&a.manifest).components.app_sha256,
            "peer is not a target-identity App at the registered location"
        );
        match a.successor_image.as_ref() {
            Some(recorded) if recorded == peer => Ok(()),
            Some(recorded) => {
                ensure!(
                    peer.pid != recorded.pid
                        && peer.started_at > recorded.started_at
                        && !incarnation_live(recorded),
                    "recorded successor incarnation is live or not superseded"
                );
                let mut next = self.state.clone();
                next.attempt.as_mut().unwrap().successor_image = Some(peer.clone());
                self.save(next)
            }
            None => {
                // Recovery measured the verified target on disk after the
                // executor-launched successor was never durably registered.
                // Adoption is measured identity; the initiating incarnation
                // must be gone so it cannot re-enter as its own successor.
                ensure!(
                    peer != &a.initiating_image && !incarnation_live(&a.initiating_image),
                    "initiating incarnation is still live"
                );
                let mut next = self.state.clone();
                next.attempt.as_mut().unwrap().successor_image = Some(peer.clone());
                self.save(next)
            }
        }
    }

    pub fn execution(&mut self, execution: Execution) -> Result<()> {
        let mut next = self.state.clone();
        next.attempt.as_mut().context("no attempt")?.execution = execution;
        self.save(next)
    }

    pub fn observe(
        &mut self,
        owner: &str,
        image: &Image,
        generation: u64,
        now: u64,
        observation: Observation,
    ) -> Result<()> {
        let a = self.live_attempt(now)?;
        let context = Context {
            attempt_id: &a.receipt.attempt_id,
            owner,
            installed_location_sha256: &location_digest(
                image
                    .path
                    .parent()
                    .context("image has no installation root")?,
            ),
            target_id: TargetId::WindowsX86_64,
            generation,
            now_unix: now,
        };
        let receipt = a.receipt.propose(&a.manifest, &context, observation)?;
        let mut next = self.state.clone();
        next.generation = next.generation.max(generation);
        next.attempt.as_mut().unwrap().receipt = receipt;
        self.save(next)
    }
}

pub fn target(manifest: &ReleaseManifest) -> &Target {
    // Only used after ReleaseManifest::decode/validate.
    manifest
        .targets
        .iter()
        .find(|t| t.id == TargetId::WindowsX86_64)
        .unwrap()
}

/// Whether the recorded process incarnation still runs this exact image.
/// Windows re-derives pid + kernel creation time + image digest through the
/// native probe; the store contract also compiles off Windows, where tests
/// drive dead-incarnation branches through explicit store fields.
#[cfg(windows)]
fn incarnation_live(recorded: &Image) -> bool {
    crate::core::update::security::image(recorded.pid)
        .ok()
        .as_ref()
        == Some(recorded)
}

#[cfg(not(windows))]
fn incarnation_live(recorded: &Image) -> bool {
    let _ = recorded;
    false
}

pub fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn file_digest(path: &Path) -> Result<String> {
    let mut source = File::open(path)?;
    let mut hash = Sha256::new();
    let mut chunk = [0_u8; 65_536];
    loop {
        let n = source.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        hash.update(&chunk[..n]);
    }
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

pub fn location_digest(root: &Path) -> String {
    digest(root.to_string_lossy().to_ascii_lowercase().as_bytes())
}

pub fn now() -> Result<u64> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs())
}

pub fn installed_floor() -> Result<u64> {
    let floor: u64 = option_env!("TONO_UPDATE_RELEASE_SEQUENCE")
        .context("Service has no compiled update release sequence")?
        .parse()?;
    ensure!(
        (1..=9_007_199_254_740_991).contains(&floor),
        "invalid compiled release sequence"
    );
    Ok(floor)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let scratch = path.with_extension(format!("tmp-{}-{}", std::process::id(), now_nanos()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&scratch)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    replace(&scratch, path)?;
    #[cfg(unix)]
    File::open(path.parent().context("no parent")?)?.sync_all()?;
    Ok(())
}

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

pub fn replace(source: &Path, target: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let source: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<_> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        ensure!(
            unsafe {
                MoveFileExW(
                    source.as_ptr(),
                    target.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } != 0,
            "durable replacement failed: {}",
            std::io::Error::last_os_error()
        );
    }
    #[cfg(not(windows))]
    std::fs::rename(source, target)?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::update_contract::Protection;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);

    pub(crate) fn reserved() -> (PathBuf, Store, Image, Image) {
        // Windows clock ticks can be shared by parallel tests. Keep each real
        // private store isolated without serializing the transaction tests.
        let root = std::env::temp_dir().join(format!(
            "tono-update-{}-{}-{}",
            std::process::id(),
            now_nanos(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        let manifest = ReleaseManifest::decode(include_bytes!(
            "../../../../tooling/scripts/tests/fixtures/update-protocol-v1/manifest.json"
        ))
        .unwrap();
        let mut receipt = Receipt::decode(
            include_bytes!(
                "../../../../tooling/scripts/tests/fixtures/update-protocol-v1/windows-receipt.json"
            ),
            &manifest,
        )
        .unwrap();
        receipt.installed_location_sha256 = location_digest(&root);
        receipt.required_recovery = Protection::Connected;
        let peer = Image {
            pid: 10,
            started_at: 100,
            path: root.join("Tono.exe"),
            sha256: "0".repeat(64),
        };
        let executor = Image {
            pid: 20,
            started_at: 200,
            path: root.join("executor.exe"),
            sha256: "e".repeat(64),
        };
        let mut store = Store::open(&root).unwrap();
        store
            .save(State {
                consumed_sequence: 73,
                generation: 91,
                manual_installer: None,
                attempt: Some(Attempt {
                    old_components: target(&manifest).components.clone(),
                    manifest,
                    receipt,
                    initiating_image: peer.clone(),
                    successor_image: None,
                    install_root: root.clone(),
                    execution: Execution::Staged,
                    executor: Some(executor.clone()),
                    disconnect: None,
                }),
            })
            .unwrap();
        (root, store, peer, executor)
    }

    pub(crate) fn authorize(store: &mut Store, peer: &Image) {
        store
            .observe(
                "windows:fixture-owner",
                peer,
                91,
                1_900_000_001,
                Observation::PreparationVerified {
                    artifact_sha256: "b".repeat(64),
                    protection: Protection::ProtectedOffline,
                },
            )
            .unwrap();
        store.execution(Execution::Launching).unwrap();
    }

    #[test]
    fn update_consumption_is_bound_durable_and_single_use_after_lost_ack() {
        let (root, mut store, peer, executor) = reserved();
        assert!(
            Store::open(&root).is_err(),
            "second writer must not interleave"
        );
        assert!(
            store
                .observe(
                    "windows:fixture-owner",
                    &peer,
                    91,
                    1_900_000_001,
                    Observation::PreparationVerified {
                        artifact_sha256: "a".repeat(64),
                        protection: Protection::ProtectedOffline
                    }
                )
                .is_err()
        );
        assert_eq!(store.attempt().unwrap().receipt.phase, Phase::Preparing);
        authorize(&mut store, &peer);
        let mut recycled = executor.clone();
        recycled.started_at += 1;
        assert!(store.consume(&recycled, 1_900_000_002).is_err());
        let before = std::fs::read(root.join("state.json")).unwrap();
        assert!(
            store
                .consume_with(&executor, 1_900_000_002, |_, _| anyhow::bail!(
                    "injected disk full"
                ))
                .is_err()
        );
        assert_eq!(std::fs::read(root.join("state.json")).unwrap(), before);
        assert_eq!(store.state.consumed_sequence, 73);
        assert!(
            store.consume(&executor, 1_900_000_002).is_err(),
            "uncertain writer must not grant on stale memory"
        );
        drop(store);
        let mut store = Store::open(&root).unwrap();
        // Real atomic disk publication, substituted failed acknowledgement.
        assert!(
            store
                .consume_with(&executor, 1_900_000_002, |path, bytes| {
                    atomic_write(path, bytes)?;
                    let durable: State = serde_json::from_slice(&std::fs::read(path)?).unwrap();
                    assert_eq!(durable.consumed_sequence, 74);
                    assert_eq!(durable.attempt.unwrap().execution, Execution::Consumed);
                    anyhow::bail!("injected lost acknowledgement after durable write")
                })
                .is_err()
        );
        drop(store);
        assert!(
            Store::open_with(&root, |_, _| anyhow::bail!(
                "injected reload durability failure"
            ))
            .is_err()
        );
        let mut restarted = Store::open(&root).unwrap();
        assert_eq!(restarted.state.consumed_sequence, 74);
        assert!(restarted.consume(&executor, 1_900_000_003).is_err());
        restarted.execution(Execution::RolledBack).unwrap();
        assert_eq!(
            restarted.state.consumed_sequence, 74,
            "rollback must not make a consumed release installable again"
        );
        assert!(restarted.pending());
        drop(restarted);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_successor_requires_executor_incarnation_and_original_recovery() {
        let (root, mut store, peer, executor) = reserved();
        authorize(&mut store, &peer);
        store.consume(&executor, 1_900_000_002).unwrap();
        let successor = Image {
            pid: 30,
            started_at: 400,
            path: peer.path.clone(),
            sha256: "4".repeat(64),
        };
        let mut next = store.state.clone();
        next.attempt.as_mut().unwrap().execution = Execution::Replaced;
        next.attempt.as_mut().unwrap().successor_image = Some(successor.clone());
        assert!(
            store
                .save_with(next, |path, bytes| {
                    atomic_write(path, bytes)?;
                    anyhow::bail!("successor visible but acknowledgement lost")
                })
                .is_err()
        );
        assert!(store.authenticate_successor(&successor).is_err());
        drop(store);
        assert!(
            Store::open_with(&root, |_, _| anyhow::bail!(
                "reload cannot establish durability"
            ))
            .is_err()
        );
        let mut store = Store::open(&root).unwrap();
        // An old App started AFTER consumption but BEFORE replacement now
        // resolves to the same new file/hash. Only executor creation is proof.
        let mut second_old_app = successor.clone();
        second_old_app.pid = 29;
        second_old_app.started_at = 300;
        assert!(store.authenticate_successor(&second_old_app).is_err());
        let mut recycled = successor.clone();
        recycled.started_at += 1;
        assert!(store.authenticate_successor(&recycled).is_err());
        store.authenticate_successor(&successor).unwrap();
        let components = target(&store.attempt().unwrap().manifest)
            .components
            .clone();
        store
            .observe(
                "windows:fixture-owner",
                &successor,
                92,
                1_900_000_003,
                Observation::InstalledIdentityVerified {
                    components: components.clone(),
                },
            )
            .unwrap();
        let before = std::fs::read(root.join("state.json")).unwrap();
        assert!(
            store
                .observe(
                    "windows:fixture-owner",
                    &successor,
                    92,
                    1_900_000_004,
                    Observation::RecoveryVerified {
                        components: components.clone(),
                        protection: Protection::ProtectedOffline
                    }
                )
                .is_err()
        );
        assert_eq!(std::fs::read(root.join("state.json")).unwrap(), before);
        // Native components/protection are injected at this store boundary;
        // this deliberately makes no claim to execute WFP or a Windows device.
        store
            .observe(
                "windows:fixture-owner",
                &successor,
                92,
                1_900_000_004,
                Observation::RecoveryVerified {
                    components: components.clone(),
                    protection: Protection::Connected,
                },
            )
            .unwrap();
        store
            .observe(
                "windows:fixture-owner",
                &successor,
                92,
                1_900_000_005,
                Observation::CommitVerified {
                    components,
                    protection: Protection::Connected,
                },
            )
            .unwrap();
        drop(store);
        let store = Store::open(&root).unwrap();
        assert!(!store.pending());
        assert_eq!(store.state.generation, 92);
        assert_eq!(store.state.consumed_sequence, 74);
        assert_eq!(
            store.attempt().unwrap().receipt.successor_generation,
            Some(92)
        );
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_explicit_disconnect_archives_only_proven_unconsumed_attempts() {
        let (root, mut store, peer, _) = reserved();
        let owner = "windows:fixture-owner";
        let mut next = store.state.clone();
        next.attempt.as_mut().unwrap().executor = None;
        next.attempt.as_mut().unwrap().execution = Execution::Reserved;
        store.save(next).unwrap();
        let original = store.attempt().unwrap().receipt.clone();
        // Disconnect is bound to the registered installation identity, not to
        // one process incarnation: a relaunched App at the same install root
        // with known bytes passes, so the rejected peer below is one whose
        // image lives outside that registered identity.
        let mut foreign_peer = peer.clone();
        foreign_peer.path = root.join("elsewhere").join("Tono.exe");
        assert!(
            store
                .request_disconnect(owner, &foreign_peer, 1_900_000_001)
                .is_err()
        );
        assert!(
            store
                .request_disconnect("another-owner", &peer, 1_900_000_001)
                .is_err()
        );
        store
            .request_disconnect(owner, &peer, 1_900_000_001)
            .unwrap();
        assert!(
            store.live_attempt(1_900_000_001).is_err(),
            "explicit release fences installation and recovery"
        );
        assert!(store.retire_unconsumed(owner, &peer).is_err());
        assert!(
            store
                .verify_disconnect(owner, &peer, 1_900_000_002, Protection::ProtectedOffline)
                .is_err()
        );
        // Native readback is injected at this Store boundary, not a WFP test.
        store
            .verify_disconnect(owner, &peer, 1_900_000_002, Protection::Unprotected)
            .unwrap();
        assert_eq!(
            store.attempt().unwrap().receipt,
            original,
            "Disconnect must not rewrite requiredRecovery/phase"
        );
        assert!(
            store
                .retire_unconsumed_with(owner, &peer, |_, _| anyhow::bail!("archive disk full"))
                .is_err()
        );
        assert!(store.pending());
        drop(store);
        let mut store = Store::open(&root).unwrap();
        let archive_path = root.join(format!("retired-{}.json", original.attempt_id));
        store
            .retire_unconsumed_with(owner, &peer, |path, bytes| {
                let current: State =
                    serde_json::from_slice(&std::fs::read(root.join("state.json"))?)?;
                assert!(current.attempt.is_some(), "archive must precede retirement");
                atomic_write(path, bytes)
            })
            .unwrap();
        let archive: State = serde_json::from_slice(&std::fs::read(archive_path).unwrap()).unwrap();
        assert_eq!(archive.attempt.unwrap().receipt, original);
        drop(store);
        let store = Store::open(&root).unwrap();
        assert!(!store.pending());
        assert_eq!(
            (store.state.consumed_sequence, store.state.generation),
            (73, 91)
        );
        drop(store);
        std::fs::remove_dir_all(root).unwrap();

        let (root, mut store, peer, executor) = reserved();
        authorize(&mut store, &peer);
        store.consume(&executor, 1_900_000_002).unwrap();
        let original = store.attempt().unwrap().receipt.clone();
        store
            .request_disconnect(owner, &peer, 1_900_000_003)
            .unwrap();
        store
            .verify_disconnect(owner, &peer, 1_900_000_004, Protection::Unprotected)
            .unwrap();
        assert!(store.retire_unconsumed(owner, &peer).is_err());
        assert!(store.consume(&executor, 1_900_000_005).is_err());
        assert!(store.pending());
        assert_eq!(store.attempt().unwrap().receipt, original);
        assert_eq!(
            (store.state.consumed_sequence, store.state.generation),
            (74, 91)
        );
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_expired_corrupt_and_orphaned_evidence_stays_closed() {
        let (root, mut store, peer, executor) = reserved();
        authorize(&mut store, &peer);
        let before = std::fs::read(root.join("state.json")).unwrap();
        assert!(store.consume(&executor, 1_900_000_600).is_err());
        assert!(store.consume(&executor, 1_899_999_999).is_err());
        assert!(store.pending());
        assert_eq!(std::fs::read(root.join("state.json")).unwrap(), before);
        drop(store);
        std::fs::write(root.join("state.json"), b"{truncated").unwrap();
        assert!(Store::open(&root).is_err());
        assert_eq!(
            std::fs::read(root.join("state.json")).unwrap(),
            b"{truncated"
        );
        std::fs::rename(root.join("state.json"), root.join("retained-corrupt.json")).unwrap();
        assert!(
            Store::open(&root).is_err(),
            "absence cannot erase orphan evidence"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_fresh_registered_app_incarnation_can_disconnect_and_retire_unconsumed_attempt() {
        let (root, mut store, peer, _) = reserved();
        let mut next = store.state.clone();
        next.attempt.as_mut().unwrap().executor = None;
        store.save(next).unwrap();
        let owner = "windows:fixture-owner";
        // The initiating process exited (crash, user close, executor
        // termination); a relaunched App at the same registered path with the
        // same known bytes re-proves the installation identity.
        let relaunched = Image {
            pid: 77,
            started_at: 999,
            path: peer.path.clone(),
            sha256: peer.sha256.clone(),
        };
        store
            .request_disconnect(owner, &relaunched, 1_900_000_010)
            .unwrap();
        store
            .verify_disconnect(owner, &relaunched, 1_900_000_011, Protection::Unprotected)
            .unwrap();
        store.retire_unconsumed(owner, &relaunched).unwrap();
        assert!(!store.pending());
        assert_eq!(store.state.consumed_sequence, 73);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_app_started_after_replacement_with_target_identity_is_an_adoptable_successor() {
        let (root, mut store, peer, executor) = reserved();
        authorize(&mut store, &peer);
        store.consume(&executor, 1_900_000_002).unwrap();
        let launched = Image {
            pid: 30,
            started_at: 400,
            path: peer.path.clone(),
            sha256: target(&store.attempt().unwrap().manifest)
                .components
                .app_sha256
                .clone(),
        };
        let mut next = store.state.clone();
        next.attempt.as_mut().unwrap().execution = Execution::Replaced;
        next.attempt.as_mut().unwrap().successor_image = Some(launched.clone());
        store.save(next).unwrap();
        // The user exited the executor-launched successor before commit and
        // relaunched: a later incarnation at the registered path whose bytes
        // are the verified target re-binds as the provable successor.
        let relaunched = Image {
            pid: 31,
            started_at: 500,
            ..launched.clone()
        };
        store.authenticate_successor(&relaunched).unwrap();
        assert_eq!(
            store.attempt().unwrap().successor_image,
            Some(relaunched.clone())
        );
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn update_launching_without_live_executor_incarnation_is_retirable_after_verified_disconnect() {
        let (root, mut store, peer, _) = reserved();
        authorize(&mut store, &peer); // Launching with a registered executor
        let mut next = store.state.clone();
        next.attempt.as_mut().unwrap().executor = None; // spawn failed / mirror write lost
        store.save(next).unwrap();
        let owner = "windows:fixture-owner";
        store.request_disconnect(owner, &peer, 1_900_000_003).unwrap();
        store
            .verify_disconnect(owner, &peer, 1_900_000_004, Protection::Unprotected)
            .unwrap();
        store.retire_unconsumed(owner, &peer).unwrap();
        assert!(!store.pending());
        assert_eq!(store.state.consumed_sequence, 73);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
