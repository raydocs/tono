//! DNS changes handed to the WMI provider host (Sol R-F1 and R2-F1 on PR #1569).
//!
//! The compatibility batch sets IPv4 DNS through `Win32_NetworkAdapterConfiguration.
//! SetDNSServerSearchOrder`, which runs inside WmiPrvSE, outside every Job this Service holds.
//! Windows offers no way to watch such a call finish, so every batch is recorded here, durably
//! and under a name that is never reused, before its process is created. The entry is removed
//! only when the batch's own script reached its last line with every CIM call answered; any
//! other ending (a timeout, a spawn that missed its deadline, a wait error, a killed or crashed
//! caller) leaves it, because a call may still land.
//!
//! A reboot ends the provider host, so an entry from an earlier boot can no longer write. It
//! still is not retired by the reboot: what it may have written is checked by the next release,
//! which removes it only after reading DNS back settled in the new boot (Sol R2-F3). An entry
//! whose boot cannot be told apart from this one counts as this boot's.
//!
//! Versions before this ledger kept no record. The first time this ledger is used it records
//! one entry for them in the current boot, so a release in the boot of an upgrade does not read
//! an empty ledger as proof that an older version's call is not still pending.

#![cfg_attr(not(all(windows, not(feature = "test"))), allow(dead_code))]

use crate::core::release::{BootRelation, BootStamp};
use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const PREFIX: &str = "dns-broker-";
/// Written once, after the entry for versions that kept no ledger.
const GENESIS: &str = "dns-broker-ledger.genesis";
/// The line a batch prints before its result when every CIM call in it answered.
pub(crate) const SETTLED_MARKER: &str = "TONO-WMI-SETTLED";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    pid: u32,
    boot: BootStamp,
    /// The caller stopped waiting while the call may still be running.
    abandoned: bool,
    /// Stands for the batches of a version that kept no ledger.
    #[serde(default)]
    legacy: bool,
}

static SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// One recorded batch. Dropping it without [`InFlight::returned`] leaves the entry in place.
pub(crate) struct InFlight {
    path: PathBuf,
    entry: Entry,
}

impl InFlight {
    /// The batch's script reached its end with every CIM call answered: nothing it handed to
    /// WmiPrvSE is still running. Only that removes the entry.
    pub(crate) fn returned(self) {
        let _ = std::fs::remove_file(&self.path);
    }

    /// Anything else: the calls may still run. The entry stays, marked.
    pub(crate) fn abandoned(mut self) {
        self.entry.abandoned = true;
        let _ = rewrite(&self.path, &self.entry);
    }
}

/// Create `path` with `entry`, failing if it exists, and flush it to disk before returning.
fn create(path: &Path, entry: &Entry) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(entry).map_err(std::io::Error::other)?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    #[cfg(all(windows, not(feature = "test")))]
    crate::core::windows_security::secure_private_service_file_if_exists(path).map_err(std::io::Error::other)?;
    Ok(())
}

/// Replace an existing entry in place. A torn write reads back as unreadable, which counts as
/// pending, never as finished.
fn rewrite(path: &Path, entry: &Entry) -> Result<()> {
    let bytes = serde_json::to_vec(entry)?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .with_context(|| format!("failed to open {path:?}"))?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

/// A name no earlier entry had: the process, the time and a counter, created exclusively, so an
/// existing entry is never overwritten even when a PID comes back.
fn create_unique(directory: &Path, entry: &Entry) -> Result<PathBuf> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    for _ in 0..16 {
        let path = directory.join(format!(
            "{PREFIX}{}-{nanos:x}-{}.json",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        match create(&path, entry) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error).with_context(|| format!("failed to write {path:?}")),
        }
    }
    anyhow::bail!("no unused WMI DNS ledger name in {directory:?}")
}

/// The first use of the ledger records one pending entry for versions that kept none.
fn ensure_genesis(directory: &Path) -> Result<()> {
    std::fs::create_dir_all(directory).with_context(|| format!("failed to create {directory:?}"))?;
    let genesis = directory.join(GENESIS);
    if genesis.exists() {
        return Ok(());
    }
    let entry = Entry {
        pid: 0,
        boot: crate::core::release::current_boot(),
        abandoned: true,
        legacy: true,
    };
    create_unique(directory, &entry)?;
    match create(&genesis, &entry) {
        Ok(()) => Ok(()),
        // Another process made it first; its legacy entry and ours stand for the same thing.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to write {genesis:?}")),
    }
}

/// Record a batch before its process is created. A batch that cannot be recorded must not run:
/// its absence here would later read as proof that nothing is pending.
pub(crate) fn begin_in(directory: &Path) -> Result<InFlight> {
    ensure_genesis(directory)?;
    let entry = Entry {
        pid: std::process::id(),
        boot: crate::core::release::current_boot(),
        abandoned: false,
        legacy: false,
    };
    let path = create_unique(directory, &entry)?;
    Ok(InFlight { path, entry })
}

pub(crate) fn begin() -> Result<InFlight> {
    begin_in(crate::core::paths::service_paths().persistent_state_dir())
}

/// A batch not known to have finished.
#[derive(Debug, Clone)]
pub(crate) struct Pending {
    pub(crate) path: PathBuf,
    pub(crate) description: String,
    /// `None` when the entry could not be read.
    boot: Option<BootStamp>,
}

impl Pending {
    /// Only a provably earlier boot ended this batch's call. Unreadable and undecidable entries
    /// are this boot's.
    pub(crate) fn from_earlier_boot(&self, now: &BootStamp) -> bool {
        self.boot
            .as_ref()
            .is_some_and(|boot| boot.relation_to(now) == BootRelation::Earlier)
    }
}

/// Every batch not known to have finished, from any boot.
pub(crate) fn outstanding_in(directory: &Path) -> Result<Vec<Pending>> {
    ensure_genesis(directory)?;
    let mut pending = Vec::new();
    let entries = std::fs::read_dir(directory).with_context(|| format!("failed to list {directory:?}"))?;
    for item in entries {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        if !name.starts_with(PREFIX) || name == GENESIS {
            continue;
        }
        let entry = std::fs::read(item.path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Entry>(&bytes).ok());
        let description = match &entry {
            Some(entry) if entry.legacy => "a DNS change an earlier Tono version may have handed to Windows".to_owned(),
            Some(entry) => format!(
                "WMI DNS batch from process {}{}",
                entry.pid,
                if entry.abandoned { " (not seen to finish)" } else { "" }
            ),
            None => format!("unreadable WMI DNS batch record {name}"),
        };
        pending.push(Pending {
            path: item.path(),
            description,
            boot: entry.map(|entry| entry.boot),
        });
    }
    Ok(pending)
}

pub(crate) fn outstanding() -> Result<Vec<Pending>> {
    outstanding_in(crate::core::paths::service_paths().persistent_state_dir())
}

/// Remove entries a release proved can no longer change DNS: from an earlier boot, with DNS read
/// back settled in this one.
pub(crate) fn retire(pending: &[Pending]) -> Result<()> {
    for entry in pending {
        match std::fs::remove_file(&entry.path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error).with_context(|| format!("failed to remove {:?}", entry.path)),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "tono-broker-ledger-test-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&directory);
        directory
    }

    #[test]
    fn a_batch_that_did_not_return_stays_pending() {
        let directory = scratch();
        // The first use stands in for versions without a ledger.
        assert_eq!(outstanding_in(&directory).unwrap().len(), 1);
        let finished = begin_in(&directory).unwrap();
        finished.returned();
        let _killed_with_its_caller = begin_in(&directory).unwrap();
        begin_in(&directory).unwrap().abandoned();
        assert_eq!(outstanding_in(&directory).unwrap().len(), 3);
    }

    #[test]
    fn an_entry_from_an_earlier_boot_stays_until_a_release_retires_it() {
        let directory = scratch();
        let earlier = Entry {
            pid: 7,
            boot: BootStamp {
                marker: Some("earlier boot".into()),
                booted_at: Some(1_000),
                uptime_ms: Some(50_000),
            },
            abandoned: true,
            legacy: false,
        };
        std::fs::create_dir_all(&directory).unwrap();
        let path = create_unique(&directory, &earlier).unwrap();
        let now = BootStamp {
            marker: Some("this boot".into()),
            booted_at: Some(9_000),
            uptime_ms: Some(10_000),
        };
        let pending = outstanding_in(&directory).unwrap();
        let entry: Vec<_> = pending.iter().filter(|entry| entry.path == path).cloned().collect();
        assert!(entry.len() == 1 && entry[0].from_earlier_boot(&now));
        // Still outstanding: only a release that read DNS back settled retires it.
        assert!(outstanding_in(&directory).unwrap().iter().any(|entry| entry.path == path));
        retire(&entry).unwrap();
        assert!(outstanding_in(&directory).unwrap().iter().all(|entry| entry.path != path));
    }
}
