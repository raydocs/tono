//! Uploads the local audit log to the control plane in gzip segments while the
//! test programme runs.
//!
//! Windows parity for the macOS `DiagnosticsLogUploader`. This is the one path
//! that sends unredacted routing data — the hostnames a connection reached, the
//! process that opened it, the rule and route it matched — so it is gated on its
//! own setting rather than on the timeline toggle, whose payload carries no
//! hostnames at all.
//!
//! Cursors use the opened file's identity, not its length. Each receipt key
//! retains immutable bytes until acknowledged. Only records tagged by the
//! current authenticated account/consent scope are eligible for upload.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tono_core::auth::{ApiError, DiagnosticsLogSegment, MAX_DIAGNOSTICS_LOG_SEGMENT_BYTES};

use crate::process::AsyncHandler;
use crate::tono::audit::{AuditEvent, AUDIT_BACKUP_FILE_NAME};
use crate::tono::state::TonoState;

/// Spacing between sweeps. The server's per-account budget is 80 segments an
/// hour, so this leaves room for a backup tail and a retry without approaching
/// it.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(120);
/// Long enough for sign-in, the first catalog sync and a connect to settle, so
/// the first segment carries a whole startup rather than half of one.
pub const FIRST_DELAY: Duration = Duration::from_secs(90);
/// Raw bytes per segment. Real audit data compresses about eighteen to one, so
/// this lands far below the server's 2 MiB compressed cap; `gzip_within_limit`
/// is the check for the exception rather than the assumption.
const READ_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const CURSOR_FILE_NAME: &str = "traffic-audit.upload-cursor.json";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Cursor {
    #[serde(default)]
    scope: String,
    #[serde(default)]
    file_id: Option<String>,
    offset: u64,
}

impl Cursor {
    fn load(path: &Path) -> Self {
        std::fs::read_to_string(path).ok()
            .and_then(|body| serde_json::from_str(&body).ok()).unwrap_or_default()
    }

    fn save(&self, path: &Path) {
        if let Ok(body) = serde_json::to_string(self) {
            // A lost cursor may replay data under a fresh process session. Do
            // not claim server deduplication across different receipt keys.
            let _ = crate::tono::state::write_private_file(path, body.as_bytes());
        }
    }
}

struct Segment {
    gzip: Vec<u8>,
    line_count: u32,
    consumed: u64,
    remaining: u64,
}

struct PendingSegment {
    segment: Segment,
    next_cursor: Cursor,
}

/// Receipt identity and bytes live together across failed sweeps. Replacing a
/// scope creates a new queue/session, never reuses a key for a different body.
struct UploadQueue {
    log_path: PathBuf,
    cursor_path: PathBuf,
    cursor: Cursor,
    session_id: String,
    sequence: u32,
    pending: Option<PendingSegment>,
}

impl UploadQueue {
    fn new(log_path: PathBuf, scope: &str) -> Self {
        let cursor_path = log_path.with_file_name(CURSOR_FILE_NAME);
        let saved = Cursor::load(&cursor_path);
        let cursor = if saved.scope == scope { saved } else {
            Cursor { scope: scope.to_string(), ..Cursor::default() }
        };
        Self { log_path, cursor_path, cursor,
            session_id: tono_core::auth::new_installation_id(), sequence: 0, pending: None }
    }

    fn prepare(&mut self) -> Option<&PendingSegment> {
        if self.pending.is_none() {
            self.pending = self.read_next();
        }
        self.pending.as_ref()
    }

    fn read_next(&self) -> Option<PendingSegment> {
        let live = std::fs::File::open(&self.log_path).ok();
        let backup = std::fs::File::open(self.log_path.with_file_name(AUDIT_BACKUP_FILE_NAME)).ok();
        // Open before inspecting: rename/rotation cannot swap bytes between the
        // identity check and the read. Finish the matching backup before live.
        let matched = backup.as_ref().filter(|file| {
            file_identity(file).as_ref() == self.cursor.file_id.as_ref()
                && self.cursor.file_id.is_some()
        });
        let file = match matched {
            Some(file) if file.metadata().ok()?.len() > self.cursor.offset => file,
            _ => live.as_ref()?,
        };
        let id = file_identity(file)?;
        let size = file.metadata().ok()?.len();
        let offset = if self.cursor.file_id.as_ref() == Some(&id) && size >= self.cursor.offset {
            self.cursor.offset
        } else { 0 };
        let segment = read_open_segment(file, offset, Some(&self.cursor.scope))?;
        let next_cursor = Cursor { scope: self.cursor.scope.clone(), file_id: Some(id),
            offset: offset + segment.consumed };
        Some(PendingSegment { segment, next_cursor })
    }

    fn acknowledge(&mut self) {
        if let Some(pending) = self.pending.take() {
            if pending.segment.line_count > 0 {
                // Never wrap or saturate into a previously used receipt key.
                if let Some(next) = self.sequence.checked_add(1) { self.sequence = next; }
                else { self.session_id = tono_core::auth::new_installation_id(); self.sequence = 0; }
            }
            self.cursor = pending.next_cursor;
            self.cursor.save(&self.cursor_path);
        }
    }
}

#[cfg(unix)]
fn file_identity(file: &std::fs::File) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let meta = file.metadata().ok()?;
    Some(format!("{}:{}", meta.dev(), meta.ino()))
}

#[cfg(windows)]
fn file_identity(file: &std::fs::File) -> Option<String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandleEx, FileIdInfo, FILE_ID_INFO,
    };
    let mut info: FILE_ID_INFO = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        GetFileInformationByHandleEx(file.as_raw_handle(), FileIdInfo,
            (&mut info as *mut FILE_ID_INFO).cast(), std::mem::size_of::<FILE_ID_INFO>() as u32)
    };
    if ok == 0 { return None; }
    Some(format!("{}:{:02x?}", info.VolumeSerialNumber, info.FileId.Identifier))
}

fn gzip_within_limit(raw: &[u8]) -> Option<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(raw).ok()?;
    let bytes = encoder.finish().ok()?;
    (bytes.len() <= MAX_DIAGNOSTICS_LOG_SEGMENT_BYTES).then_some(bytes)
}

/// None is used only by the low-level unfiltered reader tests. Production must
/// supply an authenticated scope: legacy/unattributed records remain local.
fn read_open_segment(mut file: &std::fs::File, offset: u64, scope: Option<&str>) -> Option<Segment> {
    let size = file.metadata().ok()?.len();
    if size <= offset { return None; }
    let mut chunk = READ_CHUNK_BYTES;
    while chunk >= 64 * 1024 {
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut raw = vec![0_u8; chunk.min((size - offset) as usize)];
        let read = file.read(&mut raw).ok()?;
        raw.truncate(read);
        let end = raw.iter().rposition(|b| *b == b'\n')? + 1;
        raw.truncate(end);
        let selected = match scope {
            None => raw.clone(),
            Some(scope) => raw.split_inclusive(|b| *b == b'\n').filter(|line| {
                serde_json::from_slice::<serde_json::Value>(line).ok()
                    .is_some_and(|record| record.get("_uploadScope").and_then(|v| v.as_str()) == Some(scope))
            }).flatten().copied().collect::<Vec<_>>(),
        };
        if let Some(gzip) = gzip_within_limit(&selected) {
            return Some(Segment { gzip, line_count: selected.iter().filter(|b| **b == b'\n').count() as u32,
                consumed: end as u64, remaining: size - offset - end as u64 });
        }
        chunk /= 2;
    }
    None
}

#[cfg(test)]
fn read_segment(path: &Path, offset: u64) -> Option<Segment> {
    read_open_segment(&std::fs::File::open(path).ok()?, offset, None)
}

pub(crate) async fn spawn_periodic_for_auth_generation(
    state: &Arc<TonoState>, _app: &AppHandle, generation: u64,
) {
    let (client, identity, account) = {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation { return; }
        let Some(account) = inner.account.as_ref() else { return; };
        state.audit().activate_log_upload_owner(&account.id);
        (inner.client.clone(), inner.client.diagnostics_log_identity().await, account.id.clone())
    };
    let task_state = state.clone();
    let handle = AsyncHandler::spawn(move || async move {
        tokio::time::sleep(FIRST_DELAY).await;
        let mut queue: Option<UploadQueue> = None;
        let mut failures = 0_u32;
        loop {
            {
                let inner = task_state.lock().await;
                if inner.sign_in_generation != generation
                    || inner.account.as_ref().map(|user| &user.id) != Some(&account) { return; }
            }
            let result = match task_state.audit().log_upload_scope() {
                Some(scope) => {
                    if queue.as_ref().map(|q| &q.cursor.scope) != Some(&scope.id) {
                        queue = Some(UploadQueue::new(task_state.audit().log_path().to_path_buf(), &scope.id));
                    }
                    sweep(&task_state, generation, &client, identity, &scope, queue.as_mut().unwrap()).await
                }
                None => { queue = None; Ok(()) }
            };
            failures = if result.is_ok() { 0 } else { failures.saturating_add(1) };
            tokio::time::sleep(SWEEP_INTERVAL * 2_u32.pow(failures.min(3))).await;
        }
    });
    if state.lock().await.sign_in_generation != generation { handle.abort(); }
}

async fn sweep(
    state: &Arc<TonoState>, generation: u64,
    client: &crate::tono::state::TonoApiClient, identity: u64,
    scope: &crate::tono::audit::LogUploadScope, queue: &mut UploadQueue,
) -> Result<(), ApiError> {
    loop {
        {
            let inner = state.lock().await;
            if inner.sign_in_generation != generation
                || state.audit().with_log_upload_scope(scope, || ()).is_none() { return Ok(()); }
        }
        if queue.prepare().is_none() { return Ok(()); }
        let segment = &queue.pending.as_ref().unwrap().segment;
        if segment.line_count > 0 {
            let os_version = os_version_string();
            // A revoked consent/owner cancels catch-up, including the awaited
            // HTTP future; it cannot recall bytes already accepted by a server.
            let result = tokio::select! {
                biased;
                _ = scope.cancelled.cancelled() => return Ok(()),
                result = client.upload_diagnostics_log_segment_for_identity(DiagnosticsLogSegment {
                    session_id: &queue.session_id, sequence: queue.sequence,
                    line_count: segment.line_count, client_version: env!("CARGO_PKG_VERSION"),
                    os_version: &os_version, gzip: &segment.gzip,
                }, identity) => result,
            };
            if let Err(err) = result {
                state.audit().log(AuditEvent::NetworkLogSegmentUploadFail { error: err.to_string() });
                return Err(err);
            }
        }
        let event = (segment.line_count > 0).then(|| AuditEvent::NetworkLogSegmentUploaded {
            sequence: queue.sequence, line_count: segment.line_count, bytes: segment.gzip.len() as u32,
        });
        let drained = segment.remaining == 0;
        let is_live = queue.pending.as_ref().unwrap().next_cursor.file_id ==
            std::fs::File::open(&queue.log_path).ok().as_ref().and_then(file_identity);
        {
            let inner = state.lock().await;
            if inner.sign_in_generation != generation
                || state.audit().with_log_upload_scope(scope, || queue.acknowledge()).is_none() { return Ok(()); }
        }
        if let Some(event) = event { state.audit().log(event); }
        if drained && is_live { return Ok(()); }
        tokio::select! {
            biased;
            _ = scope.cancelled.cancelled() => return Ok(()),
            _ = tokio::time::sleep(Duration::from_millis(80)) => {}
        }
    }
}

/// The `os_version` header value, bounded so the server cannot reject the whole
/// segment over it.
///
/// This used to call `os_info::get()`, a crate that was never in `Cargo.toml`,
/// so the Tauri crate did not compile for Windows at all — the call sits behind
/// `#[cfg(windows)]`, and no CI job ever compiled this crate for Windows. The
/// same string is already produced for the telemetry window by
/// `tauri_plugin_tono_sysinfo::os_long_version`, which is a real
/// dependency and is cross-platform, so both paths now report the same thing
/// instead of two different guesses.
///
/// Trimmed to printable ASCII within the server's column bound: a localized
/// Windows edition string can carry characters that a header rejects, and losing
/// every log segment over the machine's display language is not a trade worth
/// making for a display-only field.
fn os_version_string() -> String {
    ascii_header(&tauri_plugin_tono_sysinfo::os_long_version(), 80)
}

fn ascii_header(value: &str, max_len: usize) -> String {
    let filtered: String = value
        .chars()
        .filter(|c| c.is_ascii() && !c.is_ascii_control())
        .collect();
    let trimmed = filtered.trim();
    let usable = if trimmed.is_empty() { "Unknown" } else { trimmed };
    usable.chars().take(max_len).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Dir(PathBuf);
    impl Dir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!("tono-log-upload-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn line(n: usize) -> String {
        format!(
            "{{\"kind\":\"connection_opened\",\"n\":{n},\"host\":\"h{n}.example.test\",\"process\":\"WeChat.exe\"}}\n"
        )
    }

    fn gunzip(bytes: &[u8]) -> String {
        use flate2::read::GzDecoder;
        let mut out = String::new();
        GzDecoder::new(bytes).read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn a_segment_never_ends_mid_line() {
        let dir = Dir::new("partial");
        let path = dir.join("traffic-audit.jsonl");
        let mut body: String = (1..=20).map(line).collect();
        body.push_str("{\"kind\":\"partial\",\"no\":\"newline yet");
        std::fs::write(&path, &body).unwrap();

        let segment = read_segment(&path, 0).expect("segment");
        let text = gunzip(&segment.gzip);
        assert!(text.ends_with("}\n"), "segment ended mid-line: {:?}", &text[text.len() - 20..]);
        assert!(!text.contains("newline yet"));
        assert_eq!(segment.line_count, 20);
        // The partial line is left for the next sweep, so it is still pending.
        assert_eq!(segment.remaining, (body.len() - segment.consumed as usize) as u64);
    }

    #[test]
    fn a_second_read_starts_where_the_first_stopped() {
        let dir = Dir::new("cursor");
        let path = dir.join("traffic-audit.jsonl");
        let first: String = (1..=10).map(line).collect();
        std::fs::write(&path, &first).unwrap();
        let a = read_segment(&path, 0).unwrap();
        let combined = format!("{first}{}", (11..=15).map(line).collect::<String>());
        std::fs::write(&path, &combined).unwrap();

        let b = read_segment(&path, a.consumed).unwrap();
        let text = gunzip(&b.gzip);
        assert!(!text.contains("\"n\":1,"), "re-sent an already-consumed line");
        assert!(text.contains("\"n\":15,"));
        assert_eq!(b.line_count, 5);
        assert!(read_segment(&path, a.consumed + b.consumed).is_none());
    }

    #[test]
    fn rotation_to_a_longer_live_file_still_drains_the_backup() {
        let dir = Dir::new("rotate");
        let live = dir.join("traffic-audit.jsonl");
        let backup = dir.join(AUDIT_BACKUP_FILE_NAME);
        let scoped = |n| format!("{{\"_uploadScope\":\"owner-a\",\"n\":{n}}}\n");
        std::fs::write(&live, scoped(1)).unwrap();
        let mut queue = UploadQueue::new(live.clone(), "owner-a");
        assert_eq!(queue.prepare().unwrap().segment.line_count, 1);
        queue.acknowledge();
        std::fs::OpenOptions::new().append(true).open(&live).unwrap().write_all(scoped(2).as_bytes()).unwrap();
        std::fs::rename(&live, &backup).unwrap();
        std::fs::write(&live, (100..=120).map(scoped).collect::<String>()).unwrap();
        assert!(std::fs::metadata(&live).unwrap().len() > queue.cursor.offset);
        assert!(gunzip(&queue.prepare().unwrap().segment.gzip).contains("\"n\":2}"));
        queue.acknowledge();
        let fresh = gunzip(&queue.prepare().unwrap().segment.gzip);
        assert!(fresh.contains("\"n\":100}"));
        assert!(!fresh.contains("\"n\":2}"));
    }

    #[test]
    fn lost_receipt_retries_immutable_bytes_after_log_growth() {
        let dir = Dir::new("retry");
        let live = dir.join("traffic-audit.jsonl");
        let first = "{\"_uploadScope\":\"a\",\"n\":1}\n";
        std::fs::write(&live, first).unwrap();
        let mut queue = UploadQueue::new(live.clone(), "a");
        let sent = queue.prepare().unwrap().segment.gzip.clone();
        let session = queue.session_id.clone();
        // The server stored these bytes but its response was lost: no ack.
        std::fs::OpenOptions::new().append(true).open(&live).unwrap()
            .write_all(b"{\"_uploadScope\":\"a\",\"n\":2}\n").unwrap();
        assert_eq!(queue.prepare().unwrap().segment.gzip, sent);
        assert_eq!(queue.sequence, 0);
        assert_eq!(queue.session_id, session);
        queue.acknowledge();
        assert_ne!(queue.prepare().unwrap().segment.gzip, sent);
        assert_eq!(queue.sequence, 1);
    }

    #[test]
    fn unowned_and_previous_account_records_are_not_uploaded() {
        let dir = Dir::new("scope");
        let live = dir.join("traffic-audit.jsonl");
        std::fs::write(&live, concat!(
            "{\"host\":\"legacy.example\"}\n",
            "{\"_uploadScope\":\"old\",\"host\":\"old.example\"}\n",
            "{\"_uploadScope\":\"new\",\"host\":\"new.example\"}\n",
        )).unwrap();
        let mut queue = UploadQueue::new(live.clone(), "new");
        let segment = &queue.prepare().unwrap().segment;
        assert_eq!(segment.line_count, 1);
        assert_eq!(gunzip(&segment.gzip), "{\"_uploadScope\":\"new\",\"host\":\"new.example\"}\n");
        queue.acknowledge();
        assert_eq!(queue.cursor.offset, std::fs::metadata(live).unwrap().len());
    }

    #[test]
    fn an_incompressible_window_shrinks_instead_of_exceeding_the_server_cap() {
        // Random bytes do not compress, so a 4 MiB read would gzip to over the
        // 2 MiB cap and must be halved rather than sent and refused.
        let dir = Dir::new("dense");
        let path = dir.join("traffic-audit.jsonl");
        let mut body = Vec::new();
        let mut seed = 0x2545F491_4F6CDD1D_u64;
        while body.len() < 6 * 1024 * 1024 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            body.extend_from_slice(&seed.to_le_bytes());
            if body.len() % 512 == 0 {
                body.push(b'\n');
            }
        }
        body.push(b'\n');
        std::fs::write(&path, &body).unwrap();

        let segment = read_segment(&path, 0).expect("segment");
        assert!(
            segment.gzip.len() <= MAX_DIAGNOSTICS_LOG_SEGMENT_BYTES,
            "segment would be refused: {} bytes",
            segment.gzip.len(),
        );
        assert!(segment.consumed < READ_CHUNK_BYTES as u64, "chunk was not reduced");
    }

    #[test]
    fn a_cursor_round_trips_and_a_corrupt_one_reads_as_the_beginning() {
        let dir = Dir::new("cursor-io");
        let path = dir.join(CURSOR_FILE_NAME);
        Cursor { offset: 4096, file_id: Some("file-a".into()), scope: "a".into() }.save(&path);
        let loaded = Cursor::load(&path);
        assert_eq!(loaded.offset, 4096);
        assert_eq!(loaded.file_id.as_deref(), Some("file-a"));

        std::fs::write(&path, b"{not json").unwrap();
        let recovered = Cursor::load(&path);
        assert_eq!(recovered.offset, 0);
        assert_eq!(recovered.file_id, None);
    }
}
