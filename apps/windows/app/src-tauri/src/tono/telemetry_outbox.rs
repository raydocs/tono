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

pub const OUTBOX_FILE: &str = "telemetry-outbox.json";
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

fn path_of(dir: &Path) -> std::path::PathBuf {
    dir.join(OUTBOX_FILE)
}

fn load(dir: &Path) -> OutboxFile {
    let Ok(body) = fs::read_to_string(path_of(dir)) else {
        return OutboxFile::default();
    };
    serde_json::from_str(&body).unwrap_or_default()
}

fn store(dir: &Path, file: &OutboxFile) -> std::io::Result<()> {
    let body = serde_json::to_string(file).unwrap_or_else(|_| "{\"items\":[]}".to_string());
    if body.len() > OUTBOX_MAX_BYTES {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "outbox too large"));
    }
    fs::write(path_of(dir), body)
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
    let mut file = load(dir);
    file.items.push(OutboxItem {
        kind: kind.to_string(),
        body: body.to_string(),
        attempts: 0,
        next_at_ms: now_ms,
    });
    while file.items.len() > OUTBOX_MAX_ITEMS {
        file.items.remove(0);
    }
    while serde_json::to_string(&file).map(|text| text.len()).unwrap_or(0) > OUTBOX_MAX_BYTES
        && !file.items.is_empty()
    {
        file.items.remove(0);
    }
    let _ = store(dir, &file);
}

pub fn due(dir: &Path, now_ms: i64) -> Vec<OutboxItem> {
    load(dir).items.into_iter().filter(|item| item.next_at_ms <= now_ms).collect()
}

pub fn complete(dir: &Path, body: &str) {
    let mut file = load(dir);
    if let Some(index) = file.items.iter().position(|item| item.body == body) {
        file.items.remove(index);
        let _ = store(dir, &file);
    }
}

/// Drops every item whose kind is not `kind`.
pub fn retain_kind(dir: &Path, kind: &str) {
    let mut file = load(dir);
    file.items.retain(|item| item.kind == kind);
    let _ = store(dir, &file);
}

pub fn postpone(dir: &Path, body: &str, now_ms: i64) {
    let mut file = load(dir);
    if let Some(item) = file.items.iter_mut().find(|item| item.body == body) {
        item.attempts = item.attempts.saturating_add(1);
        item.next_at_ms = now_ms.saturating_add(backoff(item.attempts).as_millis() as i64);
    }
    let _ = store(dir, &file);
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
            let path = path.join(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string());
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
    fn a_failed_post_is_retried_then_dropped_after_ack() {
        let dir = temp();
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
        enqueue(&dir.path, "failure", "{\"schemaVersion\":1}", now);
        assert_eq!(due(&dir.path, now).len(), 1);
        postpone(&dir.path, "{\"schemaVersion\":1}", now);
        assert!(due(&dir.path, now).is_empty(), "backoff hides the item until next_at");
        assert_eq!(due(&dir.path, now + 120_000).len(), 1);
        complete(&dir.path, "{\"schemaVersion\":1}");
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
