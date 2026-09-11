//! Single-writer, account-partitioned, owner-private and bounded. Never persist raw Core logs.
use super::model::Snapshot;
use serde::{Deserialize, Serialize};
use std::{
    io::Read as _,
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 256 * 1024;
const MAX_RECORDS: usize = 24;
const MAX_AGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Outbox {
    #[serde(default)]
    pub epoch: u64,
    pub records: Vec<Snapshot>,
    pub dropped: u32,
    /// Persist the send budget, including across App restarts and failed HTTP attempts.
    pub next_send_ms: i64,
    #[serde(default)]
    pub attempts: Vec<i64>,
}

pub(super) fn path(base: &Path, account_id: &str) -> PathBuf {
    base.join(format!(
        "automatic-diagnostics-{}.json",
        tono_core::catalog::catalog_digest(account_id)
    ))
}

fn plain(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}

fn safe_parent(path: &Path) -> bool {
    path.parent()
        .and_then(|parent| std::fs::symlink_metadata(parent).ok())
        .is_some_and(|metadata| plain(&metadata) && metadata.is_dir())
}

/// Only files owned by this feature's fixed naming convention are eligible. Opt-out also
/// clears older account partitions, so re-enabling cannot resurrect a pre-opt-out backlog.
pub(super) fn maintenance(base: &Path, now: i64, disabled: bool) {
    if !std::fs::symlink_metadata(base).is_ok_and(|metadata| plain(&metadata) && metadata.is_dir()) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for entry in entries.filter_map(Result::ok).take(512) {
        let name = entry.file_name();
        let Some(name) = name.to_str().and_then(|n| n.strip_prefix("automatic-diagnostics-")) else {
            continue;
        };
        // catalog_digest is SHA-256 encoded as unpadded base64url (43 ASCII bytes), not hex.
        if name.len() < 48
            || !name.as_bytes()[..43]
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(b))
        {
            continue;
        }
        let suffix = &name[43..];
        if suffix != ".json" && !suffix.starts_with(".tmp-") {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !plain(&metadata) || !metadata.is_file() {
            continue;
        }
        if disabled {
            let _ = std::fs::remove_file(path);
            continue;
        }
        if suffix == ".json" {
            if let Ok(queue) = Outbox::load(&path, now) {
                if queue.records.is_empty() && queue.attempts.is_empty() {
                    let _ = std::fs::remove_file(path);
                } else {
                    let _ = queue.save(&path);
                }
            }
        } else if metadata
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age.as_secs() > 86400)
        {
            let _ = std::fs::remove_file(path);
        }
    }
}

impl Outbox {
    pub fn apply_privacy_epoch(&mut self, epoch: u64) {
        if self.epoch != epoch {
            self.records.clear();
            self.dropped = 0;
            self.epoch = epoch;
        }
    }
    pub fn load(path: &Path, now: i64) -> Result<Self, &'static str> {
        if !safe_parent(path) {
            return Err("unsafeParent");
        }
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("queueUnavailable"),
        };
        if !plain(&metadata) || !metadata.is_file() || metadata.len() > MAX_BYTES {
            return Err("unsafeQueue");
        }
        let file = std::fs::File::open(path).map_err(|_| "queueUnavailable")?;
        let opened = file.metadata().map_err(|_| "queueUnavailable")?;
        if !plain(&opened) || !opened.is_file() {
            return Err("unsafeQueue");
        }
        let mut body = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(|_| "queueUnavailable")?;
        if body.len() as u64 > MAX_BYTES {
            return Err("queueTooLarge");
        }
        let mut out: Self = serde_json::from_slice(&body).map_err(|_| "queueInvalid")?;
        if out.records.len() > MAX_RECORDS
            || !out.records.iter().all(Snapshot::valid)
            || !(0..=4_102_444_800_000).contains(&out.next_send_ms)
            || out.attempts.len() > 48
            || out.attempts.iter().any(|t| !(0..=4_102_444_800_000).contains(t))
        {
            return Err("queueInvalid");
        }
        out.expire(now);
        Ok(out)
    }
    pub fn expire(&mut self, now: i64) {
        let before = self.records.len();
        self.records
            .retain(|snapshot| now.saturating_sub(snapshot.at_ms) <= MAX_AGE_MS);
        self.dropped = self.dropped.saturating_add((before - self.records.len()) as u32);
        self.attempts.retain(|at| now.saturating_sub(*at) < 24 * 60 * 60 * 1000);
    }
    pub fn can_send(&self, now: i64) -> bool {
        !self.records.is_empty()
            && now >= self.next_send_ms
            && now.saturating_sub(self.records[0].at_ms) >= 15_000
            && self.attempts.len() < 48
            && self
                .attempts
                .iter()
                .filter(|at| now.saturating_sub(**at) < 60 * 60 * 1000)
                .count()
                < 4
    }
    pub fn reserve_send(&mut self, now: i64) {
        self.attempts.push(now);
        self.next_send_ms = now.saturating_add(60_000);
    }
    pub fn push(&mut self, snapshot: Snapshot) {
        if !snapshot.valid() {
            self.dropped = self.dropped.saturating_add(1);
            return;
        }
        self.expire(snapshot.at_ms);
        if self.records.len() == MAX_RECORDS {
            self.records.remove(0);
            self.dropped = self.dropped.saturating_add(1);
        }
        self.records.push(snapshot);
    }
    pub fn save(&self, path: &Path) -> Result<(), &'static str> {
        if !safe_parent(path) {
            return Err("unsafeParent");
        }
        if let Ok(metadata) = std::fs::symlink_metadata(path) {
            if !plain(&metadata) || !metadata.is_file() {
                return Err("unsafeQueue");
            }
        }
        let body = serde_json::to_vec(self).map_err(|_| "queueInvalid")?;
        if body.len() as u64 > MAX_BYTES {
            return Err("queueTooLarge");
        }
        // The existing private writer enforces the Windows user DACL / Unix 0600. Publish only
        // after its fsync succeeds; failure leaves the previous acknowledged queue intact.
        static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let serial = SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let temp = path.with_extension(format!("tmp-{}-{serial}", std::process::id()));
        if std::fs::symlink_metadata(&temp).is_ok() {
            return Err("queueTempExists");
        }
        let result = crate::tono::state::write_private_file(&temp, &body)
            .map_err(|_| "queueWriteFailed")
            .and_then(|()| std::fs::rename(&temp, path).map_err(|_| "queuePublishFailed"));
        if result.is_err() {
            let _ = std::fs::remove_file(temp);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::Phase;
    use super::*;
    fn sample(at_ms: i64) -> Snapshot {
        Snapshot {
            at_ms,
            generation: 1,
            phase: Phase::Connected,
            node: None,
            app_source: None,
            service_source: None,
            facts: vec![],
            errors: vec![],
            steps: vec![],
            failure_class: None,
        }
    }
    #[test]
    fn queue_is_bounded_and_loss_is_counted_not_silent() {
        let mut out = Outbox::default();
        for t in 0..30 {
            out.push(sample(t));
        }
        assert_eq!(out.records.len(), 24);
        assert_eq!(out.dropped, 6);
        out.expire(MAX_AGE_MS + 30);
        assert!(out.records.is_empty());
        assert_eq!(out.dropped, 30);
    }
    #[test]
    fn account_partition_and_strict_replay_do_not_accept_arbitrary_payloads() {
        assert_ne!(
            path(Path::new("cache"), "account-a"),
            path(Path::new("cache"), "account-b")
        );
        assert!(
            !path(Path::new("cache"), "private@example.com")
                .to_string_lossy()
                .contains("private")
        );
        assert!(
            serde_json::from_str::<Outbox>(r#"{"records":[],"dropped":0,"next_send_ms":0,"rawLogs":"private"}"#)
                .is_err()
        );
    }

    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Self {
            static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "tono-auto-diag-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
            Self(path)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn pending_report_and_send_budget_survive_restart_and_opt_out_clears_all_partitions() {
        let dir = Dir::new();
        let a = path(&dir.0, "account-a");
        let b = path(&dir.0, "account-b");
        let mut queue = Outbox::default();
        queue.push(sample(1));
        assert!(queue.can_send(20_000));
        queue.reserve_send(20_000);
        queue.save(&a).unwrap();
        queue.save(&b).unwrap();
        let loaded = Outbox::load(&a, 20_001).unwrap();
        assert_eq!(loaded.records.len(), 1);
        assert!(!loaded.can_send(20_001));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(std::fs::metadata(&a).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::write(dir.0.join("unrelated.json"), "keep").unwrap();
        maintenance(&dir.0, 21_000, true);
        assert!(!a.exists() && !b.exists());
        assert!(dir.0.join("unrelated.json").exists());
    }

    #[test]
    fn repeated_incidents_cannot_flood_the_existing_intake() {
        let mut queue = Outbox::default();
        queue.push(sample(1));
        for at in [20_000, 90_000, 160_000, 230_000] {
            assert!(queue.can_send(at));
            queue.reserve_send(at);
        }
        assert!(!queue.can_send(300_000));
        queue.expire(3_620_001);
        assert!(queue.can_send(3_620_001));
    }

    #[test]
    fn durable_opt_out_prevents_old_replay_even_if_deletion_was_interrupted() {
        let dir = Dir::new();
        let file = path(&dir.0, "account-a");
        let mut old = Outbox::default();
        old.push(sample(1));
        old.reserve_send(20_000);
        old.save(&file).unwrap();
        let mut restarted = Outbox::load(&file, 25_000).unwrap();
        restarted.apply_privacy_epoch(1);
        assert!(restarted.records.is_empty());
        assert_eq!(restarted.epoch, 1);
        assert_eq!(restarted.attempts, vec![20_000]);
        restarted.push(sample(30_000));
        restarted.save(&file).unwrap();
        let mut same_epoch = Outbox::load(&file, 31_000).unwrap();
        same_epoch.apply_privacy_epoch(1);
        assert_eq!(same_epoch.records.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn queue_symlink_is_not_read_or_overwritten() {
        let dir = Dir::new();
        let file = dir.0.join("private-target");
        std::fs::write(&file, "private").unwrap();
        let linked = path(&dir.0, "account-a");
        std::os::unix::fs::symlink(&file, &linked).unwrap();
        assert!(Outbox::load(&linked, 1).is_err());
        assert!(Outbox::default().save(&linked).is_err());
        assert_eq!(std::fs::read_to_string(file).unwrap(), "private");
    }
}
