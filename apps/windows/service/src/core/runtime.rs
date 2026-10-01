use crate::core::paths::service_paths;
use crate::core::process::ProcessIdentity;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::warn;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct CoreRuntimeRecord {
    pub(super) pid: u32,
    pub(super) ipc_path: String,
    pub(super) identity: ProcessIdentity,
}

/// Per-write sequence for runtime-record temporaries. A shared `json.tmp` let a `start_core`
/// and a watchdog restart truncate each other's in-flight bytes, and the mixed file then failed
/// to parse on every later read (same shape as BRICK-W11's shared intent temporary).
static CORE_RUNTIME_WRITE_SEQ: AtomicU64 = AtomicU64::new(1);

pub(super) async fn write_core_runtime_record(record: &CoreRuntimeRecord) -> Result<()> {
    let paths = service_paths();
    if let Some(parent) = paths.core_runtime_path().parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("failed to create core runtime directory {:?}", parent))?;
    }

    let destination = paths.core_runtime_path();
    // One temporary per write, so no writer can truncate or commit another writer's bytes.
    let temporary = destination.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        CORE_RUNTIME_WRITE_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let json = serde_json::to_vec_pretty(record)?;
    let write = async {
        let mut file = tokio::fs::File::create(&temporary).await.with_context(|| {
            format!(
                "failed to create temporary core runtime record {:?}",
                temporary
            )
        })?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &json).await?;
        tokio::io::AsyncWriteExt::flush(&mut file).await?;
        file.sync_all().await?;
        drop(file);
        crate::core::atomic_file::replace(&temporary, destination)
            .await
            .with_context(|| format!("failed to replace core runtime record {destination:?}"))
    }
    .await;
    if let Err(error) = write {
        // The temporary is unique to this write, so a failed attempt can always clean its own
        // up instead of leaving one stale file behind per retry.
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error);
    }
    #[cfg(unix)]
    if let Some(parent) = destination.parent() {
        std::fs::File::open(parent)?.sync_all()?;
    }

    Ok(())
}

#[cfg(feature = "test")]
pub async fn write_core_runtime_record_for_tests(pid: u32, ipc_path: String) -> Result<()> {
    let identity = crate::core::process::process_identity(pid)?
        .with_context(|| format!("test core process {pid} is not running"))?;
    write_core_runtime_record(&CoreRuntimeRecord {
        pid,
        ipc_path,
        identity,
    })
    .await
}

pub(super) async fn read_core_runtime_record() -> Result<Option<CoreRuntimeRecord>> {
    let paths = service_paths();
    let content = match tokio::fs::read(paths.core_runtime_path()).await {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "failed to read core runtime record {:?}",
                    paths.core_runtime_path()
                )
            });
        }
    };

    match serde_json::from_slice(&content) {
        Ok(record) => Ok(Some(record)),
        Err(error) => {
            // A record that cannot be parsed never will, and startup reconciliation propagates a
            // read error: left in place it refused every Core start until someone hand-deleted
            // the file. Same recovery as the desired-state files — keep the bytes for diagnosis
            // and continue as if there were none; the orphan sweep still runs without a record.
            quarantine_unreadable_record(
                paths.core_runtime_path(),
                &format!("could not be parsed: {error}"),
            )
            .await;
            Ok(None)
        }
    }
}

/// Move a core runtime record that can never be read again out of the way, best-effort.
///
/// Only permanent damage gets here — bytes that do not parse. A transient read failure is still
/// the caller's error, because destroying a record that names a live core on a passing sharing
/// violation would orphan it. Failure to quarantine is not fatal: the caller has already decided
/// to continue without the record, and the next successful start replaces the file anyway.
async fn quarantine_unreadable_record(path: &std::path::Path, reason: &str) {
    let quarantined = path.with_extension(format!("json.corrupt.{}", unix_timestamp_secs()));
    match tokio::fs::rename(path, &quarantined).await {
        Ok(()) => warn!(
            "Core runtime record {path:?} {reason}; quarantined as {quarantined:?} and treated as absent"
        ),
        Err(error) => {
            // A rename can be refused where a delete is not; without either, the unparseable
            // file stays and wedges the next read exactly like this one.
            match tokio::fs::remove_file(path).await {
                Ok(()) => warn!(
                    "Core runtime record {path:?} {reason}; could not be quarantined ({error}), removed and treated as absent"
                ),
                Err(remove_error) => warn!(
                    "Core runtime record {path:?} {reason} and could neither be quarantined ({error}) nor removed ({remove_error}); treated as absent"
                ),
            }
        }
    }
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

pub(super) async fn remove_core_runtime_record() {
    let paths = service_paths();
    let _ = tokio::fs::remove_file(paths.core_runtime_path()).await;
}

pub(super) async fn is_core_socket_reachable(path: &str) -> bool {
    #[cfg(unix)]
    {
        tokio::time::timeout(
            Duration::from_millis(300),
            tokio::net::UnixStream::connect(path),
        )
        .await
        .is_ok_and(|result| result.is_ok())
    }

    #[cfg(windows)]
    {
        tokio::time::timeout(Duration::from_millis(300), async {
            tokio::net::windows::named_pipe::ClientOptions::new().open(path)
        })
        .await
        .is_ok_and(|result| result.is_ok())
    }
}

pub(super) async fn cleanup_core_socket(path: &str) {
    #[cfg(unix)]
    {
        let path = std::path::Path::new(path);
        if path.exists() {
            let _ = tokio::fs::remove_file(path).await;
        }
    }

    #[cfg(windows)]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::{read_core_runtime_record, remove_core_runtime_record};
    use serial_test::serial;

    /// An unparseable record failed every read deterministically, so startup reconciliation
    /// refused each Core start until the file was deleted by hand. It must instead be
    /// quarantined and read as absent, exactly like a corrupt desired-state file.
    #[tokio::test]
    #[serial]
    async fn a_corrupt_core_runtime_record_is_quarantined_rather_than_refusing_forever()
    -> anyhow::Result<()> {
        remove_core_runtime_record().await;
        let paths = crate::service_paths();
        let path = paths.core_runtime_path();
        std::fs::create_dir_all(path.parent().expect("core runtime path has a parent"))?;
        tokio::fs::write(path, b"{ not json at all").await?;

        // No record, rather than an error every retry reproduces.
        assert!(read_core_runtime_record().await?.is_none());
        assert!(!path.exists());

        let directory = path.parent().expect("core runtime path has a parent");
        let prefix = format!(
            "{}.corrupt.",
            path.file_name()
                .expect("core runtime path has a file name")
                .to_string_lossy()
        );
        let mut quarantined = Vec::new();
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                quarantined.push(entry.path());
            }
        }
        assert_eq!(quarantined.len(), 1, "the bytes must be kept for diagnosis");
        for path in quarantined {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }
}
