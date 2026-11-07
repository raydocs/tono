//! Dispatch admission and the release worker's writer-stop boundary. D is independent of C.
//! Files live in the existing private state directory; neither the fixed lock nor a target's
//! one-way tombstone is ever replaced, removed, leased or reopened by this protocol.

use super::{BootRelation, BootStamp, InFlight, Incarnation, NORMAL_BATCH_BUDGET, RecordedEntry};
use anyhow::{Context as _, Result, ensure};
use serde::Serialize;
use std::fs::File;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const LOCK: &str = "wmi-dispatch.lock";
const LOCK_BUDGET: Duration = Duration::from_millis(250);
const POLL: Duration = Duration::from_millis(10);

struct HeldD {
    _file: File,
}

fn fence_path(directory: &Path, target: Incarnation) -> PathBuf {
    directory.join(format!(
        "wmi-dispatch-stop-{}-{:x}.json",
        target.pid, target.started_at
    ))
}

fn exists(path: &Path) -> Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true), // Existence, not readable/valid contents, closes admission.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("cannot inspect {path:?}")),
    }
}

fn lock(directory: &Path, budget: Duration) -> Result<HeldD> {
    let deadline = Instant::now() + budget.min(LOCK_BUDGET);
    std::fs::create_dir_all(directory)?;
    let path = directory.join(LOCK);
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)?;
    #[cfg(all(windows, not(feature = "test")))]
    crate::core::windows_security::secure_private_service_file_if_exists(&path)?;
    loop {
        if try_lock(&file)? {
            return Ok(HeldD { _file: file });
        }
        ensure!(Instant::now() < deadline, "WMI dispatch lock is busy");
        std::thread::sleep(POLL.min(deadline.saturating_duration_since(Instant::now())));
    }
}

#[cfg(windows)]
fn try_lock(file: &File) -> Result<bool> {
    use std::os::windows::io::AsRawHandle as _;
    use windows_sys::Win32::Foundation::ERROR_LOCK_VIOLATION;
    use windows_sys::Win32::Storage::FileSystem::{
        LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, LockFileEx,
    };
    use windows_sys::Win32::System::IO::OVERLAPPED;
    let mut overlapped = OVERLAPPED::default();
    // SAFETY: live owned file handle, synchronous call and valid OVERLAPPED.
    if unsafe {
        LockFileEx(
            file.as_raw_handle() as _,
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    } != 0
    {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(ERROR_LOCK_VIOLATION as i32) {
        return Ok(false);
    }
    Err(error).context("LockFileEx failed on WMI dispatch lock")
}

#[cfg(unix)]
fn try_lock(file: &File) -> Result<bool> {
    use std::os::fd::AsRawFd as _;
    // SAFETY: descriptor is owned by file. Close releases this independent D lock.
    if unsafe {
        platform_lib::flock(
            file.as_raw_fd(),
            platform_lib::LOCK_EX | platform_lib::LOCK_NB,
        )
    } == 0
    {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        return Ok(false);
    }
    Err(error).context("flock failed on WMI dispatch lock")
}

pub(super) fn admit(directory: &Path, own: Incarnation, boot: &BootStamp) -> Result<InFlight> {
    ensure!(
        own.pid != 0 && own.started_at != 0,
        "unknown WMI caller incarnation"
    );
    let _held = lock(directory, LOCK_BUDGET)?;
    ensure!(
        !exists(&fence_path(directory, own))?,
        "WMI caller incarnation is dispatch-fenced"
    );
    // No C/lifecycle/DNS/WFP lock, identity query, spawn, wait or kill under D.
    // The durable record is the admission point, including callers not yet spawned.
    super::record_admission(directory, own, boot)
}

#[derive(Serialize)]
struct Tombstone<'a> {
    dispatch_protocol: u32,
    target: Incarnation,
    boot: &'a BootStamp,
    worker: Incarnation,
    generation: u64,
}

fn fence(
    directory: &Path,
    target: Incarnation,
    boot: &BootStamp,
    worker: Incarnation,
    generation: u64,
) -> Result<()> {
    let path = fence_path(directory, target);
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(file) => file,
        // An existing partial/unreadable tombstone is also a fence. Never delete/repair it.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            ensure!(exists(&path)?, "target tombstone disappeared");
            return Ok(());
        }
        Err(error) => return Err(error).with_context(|| format!("cannot fence {target:?}")),
    };
    file.write_all(&serde_json::to_vec(&Tombstone {
        dispatch_protocol: 1,
        target,
        boot,
        worker,
        generation,
    })?)?;
    file.sync_all()?;
    #[cfg(all(windows, not(feature = "test")))]
    crate::core::windows_security::secure_private_service_file_if_exists(&path)?;
    Ok(())
}

#[derive(Clone)]
pub(crate) struct Target {
    pub(crate) incarnation: Incarnation,
    pub(in crate::core) identity: crate::core::process::ProcessIdentity,
}

pub(crate) struct Scan {
    pub(crate) targets: Vec<Target>,
    pub(crate) complete: bool,
    pub(crate) notes: Vec<String>,
}

/// Only OS/process, time and verified-termination boundaries are injected. Ledger/fence/lock
/// operations and marker handling remain real in both production and the staged regression.
pub(crate) trait Boundary {
    fn now(&self) -> Instant;
    fn scan(&mut self) -> Scan;
    fn alive(&self, target: Incarnation) -> Option<bool>;
    async fn pause(&mut self, duration: Duration);
    /// True only when this exact incarnation is proven gone, not just when a kill was sent.
    async fn terminate(&mut self, target: &Target) -> bool;
}

pub(crate) struct Outcome {
    pub(crate) stuck: Vec<Incarnation>,
    pub(crate) complete: bool,
    pub(crate) notes: Vec<String>,
}

/// The worker calls this after C, durable Released and quarantine, before cleanup/restart.
pub(crate) async fn fence_drain_then_terminate(
    directory: &Path,
    boot: &BootStamp,
    worker: Incarnation,
    generation: u64,
    boundary: &mut impl Boundary,
) -> Outcome {
    let deadline = boundary.now() + NORMAL_BATCH_BUDGET;
    let mut outcome = Outcome {
        stuck: Vec::new(),
        complete: true,
        notes: Vec::new(),
    };
    let mut attempted = Vec::new();
    // Initial scan, one normal rescan, then one conservative churn pass. No un-gated
    // broad writer kill follows this boundary. All passes share the first deadline.
    for pass in 0..3 {
        let scan = boundary.scan();
        outcome.complete &= scan.complete;
        outcome.notes.extend(scan.notes);
        let targets: Vec<_> = scan
            .targets
            .into_iter()
            .filter(|target| !attempted.contains(&target.incarnation))
            .collect();
        if targets.is_empty() {
            break;
        }
        if pass == 2 {
            outcome.complete = false;
            outcome.notes.push("writer incarnations changed during bounded rescans; final pass has no drain coverage".into());
        }
        let remaining = deadline.saturating_duration_since(boundary.now());
        let snapshot = fence_and_snapshot(directory, boot, worker, generation, &targets, remaining);
        let mut waiting = Vec::new();
        match snapshot {
            Ok(snapshot) => {
                outcome.notes.extend(snapshot.notes);
                for target in &targets {
                    let own = target.incarnation;
                    if !snapshot.fenced.contains(&own) {
                        outcome.notes.push(format!(
                            "writer {own:?} could not be fenced; no drain coverage"
                        ));
                        continue;
                    }
                    let mut eligible = 0;
                    for (path, entry) in &snapshot.records {
                        let Some(entry) = entry else {
                            // The corrupt record cannot be assigned to any particular caller.
                            continue;
                        };
                        if entry.batch.pid != own.pid {
                            continue;
                        }
                        if entry
                            .started_at
                            .is_some_and(|birth| birth != own.started_at)
                        {
                            continue;
                        }
                        if normal(entry, own, boot) && boundary.alive(own) == Some(true) {
                            eligible += 1;
                            waiting.push((path.clone(), own));
                        } else {
                            outcome.notes.push(format!("writer {own:?} has a legacy, abandoned, unknown or non-live batch; no drain coverage"));
                        }
                    }
                    if eligible == 0 {
                        // Empty is not a version handshake. It grants no safe-drain claim;
                        // only verified termination + the unchanged final ledger checks count.
                        tracing::info!(
                            "release: writer {own:?} has no provable normal batch to drain"
                        );
                    }
                }
            }
            Err(error) => {
                outcome.notes.push(format!(
                    "writer fence/snapshot unavailable; no drain coverage: {error:#}"
                ));
            }
        }
        if pass < 2 {
            drain(&mut waiting, boot, deadline, boundary, &mut outcome.notes).await;
        } else if !waiting.is_empty() {
            outcome.notes.push(
                "bounded writer churn: retained admitted batches without additional grace".into(),
            );
        }
        // D is gone before every time/liveness/runner/termination boundary.
        for target in targets {
            attempted.push(target.incarnation);
            if !boundary.terminate(&target).await && !outcome.stuck.contains(&target.incarnation) {
                outcome.stuck.push(target.incarnation);
            }
        }
    }
    outcome
}

struct Snapshot {
    fenced: Vec<Incarnation>,
    records: Vec<(PathBuf, Option<RecordedEntry>)>,
    notes: Vec<String>,
}

/// The only critical section used by the worker: close all known exact targets, THEN
/// snapshot admitted calls while D is still held. No OS process or clock callbacks here.
fn fence_and_snapshot(
    directory: &Path,
    boot: &BootStamp,
    worker: Incarnation,
    generation: u64,
    targets: &[Target],
    remaining: Duration,
) -> Result<Snapshot> {
    let _held = lock(directory, remaining)?;
    let mut snapshot = Snapshot {
        fenced: Vec::new(),
        records: Vec::new(),
        notes: Vec::new(),
    };
    for target in targets {
        match fence(directory, target.incarnation, boot, worker, generation) {
            Ok(()) => snapshot.fenced.push(target.incarnation),
            Err(error) => snapshot.notes.push(format!(
                "writer {:?} fence not proven: {error:#}",
                target.incarnation
            )),
        }
    }
    for item in std::fs::read_dir(directory)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        if !name.starts_with(super::PREFIX) || name == super::GENESIS {
            continue;
        }
        let path = item.path();
        let record = match read_record(&path) {
            Ok(Some(record)) => Some(record),
            Ok(None) => continue, // Own marker already removed this unique path.
            Err(error) => {
                snapshot.notes.push(format!(
                    "unknown WMI batch {path:?}; no drain coverage: {error:#}"
                ));
                None
            }
        };
        snapshot.records.push((path, record));
    }
    Ok(snapshot)
}

fn read_record(path: &Path) -> Result<Option<RecordedEntry>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !exists(path)? => Ok(None),
        Err(error) => Err(error).with_context(|| format!("cannot read {path:?}")),
    }
}

fn normal(entry: &RecordedEntry, own: Incarnation, boot: &BootStamp) -> bool {
    entry.dispatch_protocol == 1
        && entry.started_at == Some(own.started_at)
        && entry.batch.pid == own.pid
        && !entry.batch.legacy
        && !entry.batch.abandoned
        && entry.batch.boot.relation_to(boot) == BootRelation::Same
}

async fn drain(
    waiting: &mut Vec<(PathBuf, Incarnation)>,
    boot: &BootStamp,
    deadline: Instant,
    boundary: &mut impl Boundary,
    notes: &mut Vec<String>,
) {
    loop {
        waiting.retain(|(path, own)| {
            match read_record(path) {
                Ok(None) => false, // Only observe; never retire a record for its caller.
                Ok(Some(entry)) if normal(&entry, *own, boot) && boundary.alive(*own) == Some(true) => true,
                other => {
                    notes.push(format!("WMI batch {path:?} no longer provably normal/live; retained, no drain coverage: {other:?}"));
                    false
                }
            }
        });
        if waiting.is_empty() {
            return;
        }
        let remaining = deadline.saturating_duration_since(boundary.now());
        if remaining.is_zero() {
            notes.push(format!(
                "WMI grace deadline reached with {} admitted batch(es); records retained",
                waiting.len()
            ));
            return;
        }
        boundary.pause(POLL.min(remaining)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    };

    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).expect("remove staged ledger");
        }
    }

    /// Releases and checks the runner even when the kill assertion unwinds (the RED case).
    struct Runner {
        release: Option<mpsc::Sender<()>>,
        thread: Option<std::thread::JoinHandle<Result<String>>>,
        succeeds: bool,
    }
    impl Runner {
        fn join(&mut self) -> Result<()> {
            if let Some(release) = self.release.take() {
                // A disconnected receiver means the runner already returned; still join it.
                let _ = release.send(());
            }
            if let Some(thread) = self.thread.take() {
                let result = thread
                    .join()
                    .map_err(|_| anyhow::anyhow!("staged runner panicked"))?;
                ensure!(
                    result.is_ok() == self.succeeds,
                    "unexpected staged runner result: {result:?}"
                );
            }
            Ok(())
        }
    }
    impl Drop for Runner {
        fn drop(&mut self) {
            if let Err(error) = self.join() {
                if std::thread::panicking() {
                    eprintln!("runner cleanup failed during assertion unwind: {error:#}");
                } else {
                    panic!("runner cleanup: {error:#}");
                }
            }
        }
    }

    fn start_runner(
        directory: &Path,
        own: Incarnation,
        boot: &BootStamp,
        calls: Arc<AtomicUsize>,
        succeeds: bool,
    ) -> Runner {
        let directory = directory.to_owned();
        let boot = boot.clone();
        let (admitted, waiting) = mpsc::channel();
        let (release, resume) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            super::super::run_recorded_batch_in(&directory, own, &boot, || {
                calls.fetch_add(1, Ordering::SeqCst);
                admitted.send(()).context("announce admitted runner")?;
                resume.recv().context("release staged runner")?;
                if succeeds {
                    Ok(format!("{}\r\n|", super::super::SETTLED_MARKER))
                } else {
                    anyhow::bail!("staged runner deadline, no complete marker")
                }
            })
        });
        let runner = Runner {
            release: Some(release),
            thread: Some(thread),
            succeeds,
        };
        waiting
            .recv()
            .expect("recorded runner reached its admitted boundary");
        runner
    }

    fn normal_path(directory: &Path, own: Incarnation) -> PathBuf {
        super::super::outstanding_in(directory)
            .unwrap()
            .into_iter()
            .find(|pending| {
                std::fs::read(&pending.path)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<RecordedEntry>(&bytes).ok())
                    .is_some_and(|entry| {
                        entry.batch.pid == own.pid && entry.started_at == Some(own.started_at)
                    })
            })
            .expect("the real ledger contains the admitted batch")
            .path
    }

    struct Staged<'a> {
        directory: &'a Path,
        boot: &'a BootStamp,
        target: Target,
        normal_entry: PathBuf,
        calls: Arc<AtomicUsize>,
        runner: &'a mut Runner,
        now: Instant,
        killed: bool,
        normal_return: bool,
        paused: bool,
    }
    impl Boundary for Staged<'_> {
        fn now(&self) -> Instant {
            self.now
        }
        fn scan(&mut self) -> Scan {
            Scan {
                targets: if self.killed {
                    Vec::new()
                } else {
                    vec![self.target.clone()]
                },
                complete: true,
                notes: Vec::new(),
            }
        }
        fn alive(&self, _: Incarnation) -> Option<bool> {
            Some(!self.killed)
        }
        async fn pause(&mut self, duration: Duration) {
            assert!(
                fence_path(self.directory, self.target.incarnation).exists(),
                "pause follows durable fence"
            );
            if !self.paused {
                self.paused = true;
                let retry = super::super::run_recorded_batch_in(
                    self.directory,
                    self.target.incarnation,
                    self.boot,
                    || {
                        self.calls.fetch_add(1, Ordering::SeqCst);
                        Ok(format!("{}\n|", super::super::SETTLED_MARKER))
                    },
                );
                assert!(retry.is_err(), "the fenced caller's retry must be refused");
                assert_eq!(
                    self.calls.load(Ordering::SeqCst),
                    1,
                    "retry never invokes runner"
                );
                if self.normal_return {
                    self.runner.join().unwrap();
                }
            }
            self.now += if self.normal_return {
                duration
            } else {
                NORMAL_BATCH_BUDGET
            };
        }
        async fn terminate(&mut self, target: &Target) -> bool {
            if self.normal_return {
                assert!(
                    !self.normal_entry.exists(),
                    "must consume own settled marker before killing the WMI caller"
                );
                assert!(
                    self.paused,
                    "real production drain observed the admitted call"
                );
            } else {
                assert!(
                    self.normal_entry.exists(),
                    "deadline is not retirement evidence"
                );
            }
            assert_eq!(target.incarnation, self.target.incarnation);
            assert_eq!(self.calls.load(Ordering::SeqCst), 1);
            self.killed = true;
            true
        }
    }

    #[test]
    fn restore_fences_retry_and_observes_own_marker_before_terminating_caller() {
        let scratch = Scratch(std::env::temp_dir().join(format!(
            "tono-dispatch-staged-{}-{}",
            std::process::id(),
            super::super::SEQUENCE.fetch_add(1, Ordering::Relaxed)
        )));
        std::fs::create_dir_all(&scratch.0).unwrap();
        let directory = &scratch.0;
        let authority = crate::core::release::Authority::new(directory);
        let _c = authority
            .lock(Duration::ZERO)
            .unwrap()
            .expect("hold real C throughout cleanup/startup");
        let boot = BootStamp {
            marker: Some("staged current boot".into()),
            booted_at: Some(100),
            uptime_ms: Some(200),
        };
        let a = Incarnation {
            pid: 41,
            started_at: 1001,
        };
        let w = Incarnation {
            pid: 42,
            started_at: 1002,
        };
        let r = Incarnation {
            pid: a.pid,
            started_at: 1003,
        }; // deliberately reuse PID, not incarnation
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let mut runner = start_runner(directory, a, &boot, calls.clone(), true);
        let entry_path = normal_path(directory, a);
        let legacy_paths: Vec<_> = super::super::outstanding_in(directory)
            .unwrap()
            .into_iter()
            .filter(|pending| pending.path != entry_path)
            .map(|pending| pending.path)
            .collect();
        assert_eq!(
            legacy_paths.len(),
            1,
            "current-boot genesis obligation is real"
        );
        let target = Target {
            incarnation: a,
            identity: crate::core::process::ProcessIdentity {
                executable: "allowed-root/tono-service.exe".into(),
                started_at: a.started_at,
            },
        };
        let mut staged = Staged {
            directory,
            boot: &boot,
            target,
            normal_entry: entry_path.clone(),
            calls,
            runner: &mut runner,
            now: Instant::now(),
            killed: false,
            normal_return: true,
            paused: false,
        };
        let outcome = runtime.block_on(fence_drain_then_terminate(
            directory,
            &boot,
            w,
            7,
            &mut staged,
        ));
        assert!(staged.killed && outcome.stuck.is_empty() && outcome.complete);
        assert!(
            outcome.notes.is_empty(),
            "normal fenced call needs no fallback: {:?}",
            outcome.notes
        );
        runner.join().unwrap();
        assert!(!entry_path.exists());
        // C is still held: ordinary cleanup and restart have no mode bypass/C dependency.
        super::super::run_recorded_batch_in(directory, w, &boot, || {
            Ok(format!("{}\n|", super::super::SETTLED_MARKER))
        })
        .unwrap();
        super::super::run_recorded_batch_in(directory, r, &boot, || {
            Ok(format!("{}\n|", super::super::SETTLED_MARKER))
        })
        .unwrap();
        assert!(authority.lock(Duration::ZERO).unwrap().is_none());
        assert!(legacy_paths.iter().all(|path| path.exists()));
        assert!(directory.join(super::super::GENESIS).exists());
        // Same staged test, separate real admission: deadline/verified death never retire it.
        let t = Incarnation {
            pid: 43,
            started_at: 1004,
        };
        let timeout_calls = Arc::new(AtomicUsize::new(0));
        let mut timed_out = start_runner(directory, t, &boot, timeout_calls.clone(), false);
        let timeout_path = normal_path(directory, t);
        let mut timeout_stage = Staged {
            directory,
            boot: &boot,
            target: Target {
                incarnation: t,
                identity: crate::core::process::ProcessIdentity {
                    executable: "allowed-root/executor.exe".into(),
                    started_at: t.started_at,
                },
            },
            normal_entry: timeout_path.clone(),
            calls: timeout_calls,
            runner: &mut timed_out,
            now: Instant::now(),
            killed: false,
            normal_return: false,
            paused: false,
        };
        let deadline_outcome = runtime.block_on(fence_drain_then_terminate(
            directory,
            &boot,
            w,
            7,
            &mut timeout_stage,
        ));
        assert!(timeout_stage.paused && timeout_stage.killed);
        assert!(
            !deadline_outcome.notes.is_empty(),
            "timeout has no safe-drain coverage"
        );
        timed_out.join().unwrap();
        let retained: RecordedEntry =
            serde_json::from_slice(&std::fs::read(&timeout_path).unwrap()).unwrap();
        assert!(retained.batch.abandoned && retained.batch.boot == boot);
        assert!(legacy_paths.iter().all(|path| path.exists()));
        assert!(super::super::outstanding_in(directory).unwrap().len() >= 2);
    }
}
