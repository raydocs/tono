//! On-disk queue for privacy-safe telemetry that could not leave the device.
//!
//! The send itself uses the authorized control-plane client. While the kill
//! switch is up, that client's pinned API addresses stay allowed; this queue
//! is only for when that direct post still fails (offline, or the diagnostics
//! route is not deployed yet). It does not open a second network path.
//!
//! Agents: do not delete this queue or stop calling it from the periodic
//! uploader. See docs/diagnostics-upload-guard.md.

use std::{
    fs,
    path::Path,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tono_core::auth::{ApiError, TransportKind};

pub fn should_queue(err: &ApiError) -> bool {
    match err {
        // A timeout may have been delivered. Do not post it again.
        ApiError::Transport { kind: TransportKind::Timeout, .. } => false,
        ApiError::Transport { .. } | ApiError::NotFound | ApiError::RateLimited => true,
        ApiError::Server { status, .. } if *status == 404 || *status == 429 || *status >= 500 => true,
        _ => false,
    }
}

pub const OUTBOX_FILE: &str = "telemetry-outbox.json";
pub const P0_OUTBOX_FILE: &str = "telemetry-p0-outbox.json";
// All filesystem transactions are synchronous; never hold this across a network await.
static OUTBOX_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub const OUTBOX_MAX_ITEMS: usize = 32;
pub const OUTBOX_MAX_BYTES: usize = 256 * 1024;
const MAX_DELAY: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutboxItem {
    pub kind: String,
    pub body: String,
    pub attempts: u32,
    pub next_at_ms: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OutboxFile {
    items: Vec<OutboxItem>,
}

fn path_of(dir: &Path, kind: &str) -> std::path::PathBuf {
    dir.join(if kind == "p0" { P0_OUTBOX_FILE } else { OUTBOX_FILE })
}

fn load(dir: &Path, kind: &str) -> OutboxFile {
    let Ok(body) = fs::read_to_string(path_of(dir, kind)) else {
        return OutboxFile::default();
    };
    serde_json::from_str(&body).unwrap_or_default()
}

fn store(dir: &Path, kind: &str, file: &OutboxFile) -> std::io::Result<()> {
    let body = serde_json::to_string(file).unwrap_or_else(|_| "{\"items\":[]}".to_string());
    if body.len() > OUTBOX_MAX_BYTES {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "outbox too large"));
    }
    fs::write(path_of(dir, kind), body)
}

pub fn backoff(attempts: u32) -> Duration {
    let shift = attempts.min(8);
    let millis = 30_000_u64.saturating_mul(1_u64 << shift);
    Duration::from_millis(millis).min(MAX_DELAY)
}

/// Append one payload. Drops the oldest items until the file fits the cap.
pub fn enqueue(dir: &Path, kind: &str, body: &str, now_ms: i64) {
    if body.len() > OUTBOX_MAX_BYTES / 2 || body.is_empty() {
        return;
    }
    let _guard = OUTBOX_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut file = load(dir, kind);
    file.items.push(OutboxItem {
        kind: kind.to_string(),
        body: body.to_string(),
        attempts: 0,
        next_at_ms: now_ms,
    });
    while file.items.len() > OUTBOX_MAX_ITEMS {
        // Older versions stored P0 in the ordinary file. Keep those until acknowledgement;
        // new P0 reports have their own independent cap and file.
        let Some(index) = file.items.iter().position(|item| kind == "p0" || item.kind != "p0") else { break; };
        file.items.remove(index);
    }
    while serde_json::to_string(&file).map(|text| text.len()).unwrap_or(0) > OUTBOX_MAX_BYTES
        && !file.items.is_empty()
    {
        // Older versions stored P0 in the ordinary file. Keep those until acknowledgement;
        // new P0 reports have their own independent cap and file.
        let Some(index) = file.items.iter().position(|item| kind == "p0" || item.kind != "p0") else { break; };
        file.items.remove(index);
    }
    let _ = store(dir, kind, &file);
}

pub fn due(dir: &Path, now_ms: i64) -> Vec<OutboxItem> {
    let _guard = OUTBOX_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    // Critical reports drain first and are not delayed behind the ordinary backlog.
    let mut items = load(dir, "p0").items;
    items.extend(load(dir, "ordinary").items);
    items.retain(|item| item.next_at_ms <= now_ms);
    items.sort_by_key(|item| item.kind != "p0");
    items
}

pub fn complete(dir: &Path, kind: &str, body: &str) {
    let _guard = OUTBOX_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    for queue in ["p0", "ordinary"] {
        let mut file = load(dir, queue);
        // Include legacy P0 reports, but never acknowledge another kind with the same body.
        if let Some(index) = file.items.iter().position(|item| item.kind == kind && item.body == body) {
            file.items.remove(index);
            let _ = store(dir, queue, &file);
            return;
        }
    }
}

/// Drops every item whose kind is not `kind`, including from the legacy mixed queue.
pub fn retain_kind(dir: &Path, kind: &str) {
    let _guard = OUTBOX_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    for queue in ["ordinary", "p0"] {
        let mut file = load(dir, queue);
        file.items.retain(|item| item.kind == kind);
        let _ = store(dir, queue, &file);
    }
}

pub fn postpone(dir: &Path, kind: &str, body: &str, now_ms: i64) {
    let _guard = OUTBOX_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    for queue in ["p0", "ordinary"] {
        let mut file = load(dir, queue);
        if let Some(item) = file.items.iter_mut().find(|item| item.kind == kind && item.body == body) {
            item.attempts = item.attempts.saturating_add(1);
            item.next_at_ms = now_ms.saturating_add(backoff(item.attempts).as_millis() as i64);
            let _ = store(dir, queue, &file);
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Temp {
        path: std::path::PathBuf,
    }

    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("tono-outbox-{}", std::process::id()));
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = path.join(format!("{}-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn temp() -> Temp {
        Temp::new()
    }

    #[test]
    fn rate_limited_upload_is_retained_until_acknowledged() {
        let dir = temp();
        enqueue(&dir.path, "failure", "rate-limited-report", 1000);
        assert!(should_queue(&ApiError::RateLimited), "HTTP 429 is temporary, not an acknowledgement");
        postpone(&dir.path, "failure", "rate-limited-report", 1000);
        assert!(due(&dir.path, 1000).is_empty());
        assert!(due(&dir.path, 60_999).is_empty());
        assert_eq!(due(&dir.path, 61_000)[0].attempts, 1);
        complete(&dir.path, "failure", "rate-limited-report");
        assert!(due(&dir.path, i64::MAX).is_empty());
    }

    #[test]
    fn ordinary_backlog_cannot_evict_or_acknowledge_a_p0_report() {
        let dir = temp();
        enqueue(&dir.path, "p0", "critical", 0);
        for index in 0..OUTBOX_MAX_ITEMS + 1 {
            enqueue(&dir.path, "diagnostics", &format!("ordinary-{index}"), 0);
        }
        assert!(due(&dir.path, 0).iter().any(|item| item.kind == "p0" && item.body == "critical"));
        // Identical bodies in the two independent queues must not share acknowledgements.
        enqueue(&dir.path, "failure", "critical", 0);
        complete(&dir.path, "failure", "critical");
        assert!(due(&dir.path, 0).iter().any(|item| item.kind == "p0" && item.body == "critical"));
        postpone(&dir.path, "p0", "critical", 0);
        assert!(due(&dir.path, 0).iter().all(|item| item.kind != "p0"));
        assert!(due(&dir.path, 60_000).iter().any(|item| item.kind == "p0"));
    }

    #[test]
    fn legacy_p0_backlog_survives_upgrade_and_timeline_opt_out() {
        let dir = temp();
        fs::write(dir.path.join(OUTBOX_FILE), r#"{"items":[{"kind":"p0","body":"legacy","attempts":1,"next_at_ms":1000}]}"#).unwrap();
        for index in 0..OUTBOX_MAX_ITEMS + 1 {
            enqueue(&dir.path, "diagnostics", &format!("ordinary-{index}"), 0);
        }
        enqueue(&dir.path, "p0", "new-critical", 0);
        retain_kind(&dir.path, "p0");
        let items = due(&dir.path, 1000);
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|item| item.body == "legacy"));
        assert!(items.iter().any(|item| item.body == "new-critical"));
        complete(&dir.path, "p0", "legacy");
        assert_eq!(due(&dir.path, 1000).len(), 1);
        assert_eq!(due(&dir.path, 1000)[0].body, "new-critical");
    }

    #[test]
    fn simultaneous_producers_do_not_overwrite_each_others_reports() {
        let dir = temp();
        let gate = std::sync::Barrier::new(3);
        std::thread::scope(|scope| {
            for kind in ["failure", "diagnostics"] {
                let path = &dir.path;
                let gate = &gate;
                scope.spawn(move || {
                    gate.wait();
                    enqueue(path, kind, kind, 0);
                });
            }
            gate.wait();
        });
        let items = due(&dir.path, 0);
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|item| item.kind == "failure"));
        assert!(items.iter().any(|item| item.kind == "diagnostics"));
    }

    #[test]
    fn a_failed_post_is_retried_then_dropped_after_ack() {
        let dir = temp();
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
        enqueue(&dir.path, "failure", "{\"schemaVersion\":1}", now);
        assert_eq!(due(&dir.path, now).len(), 1);
        postpone(&dir.path, "failure", "{\"schemaVersion\":1}", now);
        assert!(due(&dir.path, now).is_empty(), "backoff hides the item until next_at");
        assert_eq!(due(&dir.path, now + 120_000).len(), 1);
        complete(&dir.path, "failure", "{\"schemaVersion\":1}");
        assert!(due(&dir.path, now + 86_400_000).is_empty());
    }

    /// The timeline switch went off: bodies that may carry error text go,
    /// the lost-protection reports stay (decision 051).
    #[test]
    fn turning_the_timeline_off_keeps_only_the_network_loss_items() {
        let dir = temp();
        enqueue(&dir.path, "failure", "{\"f\":1}", 1);
        enqueue(&dir.path, "p0", "{\"p\":1}", 2);
        enqueue(&dir.path, "diagnostics", "{\"d\":1}", 3);
        retain_kind(&dir.path, "p0");
        let items = due(&dir.path, i64::MAX);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].kind, "p0");
    }

    #[test]
    fn the_queue_drops_the_oldest_item_past_the_cap() {
        let dir = temp();
        for index in 0..(OUTBOX_MAX_ITEMS + 3) {
            enqueue(&dir.path, "window", &format!("{{\"n\":{index}}}"), index as i64);
        }
        let items = due(&dir.path, i64::MAX);
        assert_eq!(items.len(), OUTBOX_MAX_ITEMS);
        assert!(items.iter().all(|item| !item.body.contains("\"n\":0")));
    }
}
