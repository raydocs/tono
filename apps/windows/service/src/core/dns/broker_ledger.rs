//! DNS changes handed to the WMI provider host (Sol R-F1 on PR #1569).
//!
//! The compatibility batch sets IPv4 DNS through `Win32_NetworkAdapterConfiguration.
//! SetDNSServerSearchOrder`, which runs inside WmiPrvSE, outside every Job this Service holds.
//! A call whose PowerShell returned has finished. One whose caller was ended, or gave up at the
//! deadline, may still land later, and Windows offers no way to watch it finish. So every batch
//! is recorded here before it starts and removed only when its PowerShell returned. An entry
//! that remains from this boot means a late DNS write cannot be ruled out until the boot ends.

#![cfg_attr(not(all(windows, not(feature = "test"))), allow(dead_code))]

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const PREFIX: &str = "dns-broker-";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    pid: u32,
    boot: crate::core::release::BootStamp,
    /// The caller stopped waiting while the call may still be running.
    abandoned: bool,
}

static SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// One recorded batch. Dropping it without [`InFlight::returned`] leaves the entry in place.
pub(crate) struct InFlight {
    path: PathBuf,
    entry: Entry,
}

impl InFlight {
    /// The batch's PowerShell returned, so every WMI call in it finished.
    pub(crate) fn returned(self) {
        let _ = std::fs::remove_file(&self.path);
    }

    /// The batch was killed at its deadline: its calls may still run.
    pub(crate) fn abandoned(mut self) {
        self.entry.abandoned = true;
        let _ = write(&self.path, &self.entry);
    }
}

fn write(path: &Path, entry: &Entry) -> Result<()> {
    let bytes = serde_json::to_vec(entry)?;
    std::fs::write(path, bytes).with_context(|| format!("failed to write {path:?}"))?;
    #[cfg(all(windows, not(feature = "test")))]
    crate::core::windows_security::secure_private_service_file_if_exists(path)?;
    Ok(())
}

/// Record a batch before it starts. A batch that cannot be recorded must not run: its absence
/// here would later read as proof that nothing is pending.
pub(crate) fn begin_in(directory: &Path) -> Result<InFlight> {
    std::fs::create_dir_all(directory).with_context(|| format!("failed to create {directory:?}"))?;
    let path = directory.join(format!(
        "{PREFIX}{}-{}.json",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let entry = Entry {
        pid: std::process::id(),
        boot: crate::core::release::current_boot(),
        abandoned: false,
    };
    write(&path, &entry)?;
    Ok(InFlight { path, entry })
}

pub(crate) fn begin() -> Result<InFlight> {
    begin_in(crate::core::paths::service_paths().persistent_state_dir())
}

/// The batches from this boot that are not known to have finished, as one line each. Entries
/// from an earlier boot ended with it and are removed. An unreadable entry counts as pending.
pub(crate) fn outstanding_in(directory: &Path) -> Result<Vec<String>> {
    let this_boot = crate::core::release::current_boot();
    let mut pending = Vec::new();
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(pending),
        Err(error) => return Err(error).with_context(|| format!("failed to list {directory:?}")),
    };
    for item in entries {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        if !name.starts_with(PREFIX) {
            continue;
        }
        match std::fs::read(item.path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Entry>(&bytes).ok())
        {
            Some(entry) if !entry.boot.same_boot_as(&this_boot) => {
                let _ = std::fs::remove_file(item.path());
            }
            Some(entry) => pending.push(format!(
                "WMI DNS batch from process {}{}",
                entry.pid,
                if entry.abandoned { " (abandoned at its deadline)" } else { "" }
            )),
            None => pending.push(format!("unreadable WMI DNS batch record {name}")),
        }
    }
    Ok(pending)
}

pub(crate) fn outstanding() -> Result<Vec<String>> {
    outstanding_in(crate::core::paths::service_paths().persistent_state_dir())
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
        let finished = begin_in(&directory).unwrap();
        finished.returned();
        let _killed_with_its_caller = begin_in(&directory).unwrap();
        assert_eq!(outstanding_in(&directory).unwrap().len(), 1);
    }
}
