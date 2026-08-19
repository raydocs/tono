//! Uploads the local audit log to the control plane in gzip segments while the
//! test programme runs.
//!
//! Windows parity for the macOS `DiagnosticsLogUploader`. This is the one path
//! that sends unredacted routing data — the hostnames a connection reached, the
//! process that opened it, the rule and route it matched — so it is gated on its
//! own setting rather than on the timeline toggle, whose payload carries no
//! hostnames at all.
//!
//! The hard part is the cursor, not the upload. `audit::RotatingWriter` rotates
//! at 10 MiB into `traffic-audit.1.jsonl`, so a byte offset alone is wrong in
//! both directions: after a rotation it either re-uploads a whole file (the new
//! one is shorter than the stored offset) or silently abandons the tail that was
//! never sent. Rotation is detected by the live file being *shorter* than the
//! cursor, and the missed tail is then read from the backup.
//!
//! That test is sound rather than merely convenient: a rotation makes the live
//! file start at zero, and it would have to grow past the old offset — up to
//! 10 MiB — inside one sweep interval for the check to miss. The log writes a
//! few megabytes an hour, so that margin is three orders of magnitude.

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
    /// Byte offset into the live log that has been accepted by the server.
    offset: u64,
    /// Offset within the backup file still to send, set when a rotation is
    /// observed and cleared once the tail has gone.
    #[serde(default)]
    backup_offset: Option<u64>,
}

impl Cursor {
    fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|body| serde_json::from_str(&body).ok())
            .unwrap_or_default()
    }

    fn save(&self, path: &Path) {
        if let Ok(body) = serde_json::to_string(self) {
            // Best effort: a lost cursor costs one replayed segment, which the
            // server answers from its index rather than storing twice.
            let _ = crate::tono::state::write_private_file(path, body.as_bytes());
        }
    }
}

/// One segment ready to send.
struct Segment {
    gzip: Vec<u8>,
    line_count: u32,
    consumed: u64,
    remaining: u64,
}

/// Compresses `raw`, refusing rather than truncating if it exceeds the server's
/// cap so the caller can retry with a smaller read.
fn gzip_within_limit(raw: &[u8]) -> Option<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(raw).ok()?;
    let bytes = encoder.finish().ok()?;
    if bytes.len() > MAX_DIAGNOSTICS_LOG_SEGMENT_BYTES {
        return None;
    }
    Some(bytes)
}

/// Reads up to a chunk from `offset`, trimmed to the last complete line so a
/// segment is always whole JSONL records.
fn read_segment(path: &Path, offset: u64) -> Option<Segment> {
    let size = std::fs::metadata(path).ok()?.len();
    if size <= offset {
        return None;
    }
    let mut chunk = READ_CHUNK_BYTES;
    while chunk >= 64 * 1024 {
        let mut file = std::fs::File::open(path).ok()?;
        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut raw = vec![0_u8; chunk.min((size - offset) as usize)];
        let read = file.read(&mut raw).ok()?;
        raw.truncate(read);
        if raw.is_empty() {
            return None;
        }
        // A partial trailing line means the writer is mid-append. Send only what
        // is complete; the remainder arrives on the next sweep.
        let end = raw.iter().rposition(|b| *b == b'\n')? + 1;
        raw.truncate(end);
        if let Some(gzip) = gzip_within_limit(&raw) {
            let consumed = raw.len() as u64;
            return Some(Segment {
                gzip,
                line_count: raw.iter().filter(|b| **b == b'\n').count() as u32,
                consumed,
                remaining: size - (offset + consumed),
            });
        }
        // Unusually dense window: halve and retry rather than sending something
        // the server will refuse with 413.
        chunk /= 2;
    }
    None
}

/// Starts the sweep loop for one sign-in generation.
pub(crate) async fn spawn_periodic_for_auth_generation(
    state: &Arc<TonoState>,
    _app: &AppHandle,
    generation: u64,
) {
    let task_state = state.clone();
    let handle = AsyncHandler::spawn(move || async move {
        tokio::time::sleep(FIRST_DELAY).await;
        // Fresh per loop, so a relaunch starting again at sequence 0 under a new
        // session identifier can never collide with the previous run: the server
        // keys uniqueness on (account, session, sequence).
        // Reuses the installation-id generator rather than adding a uuid
        // dependency for one line; it produces the same shape and is already
        // screened against the grammar the server accepts.
        let session_id = tono_core::auth::new_installation_id();
        let mut sequence = 0_u32;
        let mut failures = 0_u32;
        loop {
            {
                let inner = task_state.lock().await;
                if inner.sign_in_generation != generation {
                    return;
                }
                if matches!(
                    inner.account_state,
                    crate::tono::state::AccountState::SignedOut
                        | crate::tono::state::AccountState::Restoring
                ) {
                    return;
                }
            }
            match sweep(&task_state, generation, &session_id, &mut sequence).await {
                Ok(()) => failures = 0,
                Err(_) => failures = failures.saturating_add(1),
            }
            // Backoff that tops out: a device offline for a day should still
            // upload promptly on return, and the log keeps rotating whether or
            // not the server is reachable.
            let delay = SWEEP_INTERVAL * 2_u32.pow(failures.min(3));
            tokio::time::sleep(delay.min(SWEEP_INTERVAL * 8)).await;
        }
    });
    // Same disposal as the telemetry loop: a generation that was superseded
    // while this task was being spawned must not leave a second uploader running
    // against a session that no longer owns the cursor.
    let inner = state.lock().await;
    if inner.sign_in_generation != generation {
        handle.abort();
    }
}

/// One pass: the rotated tail first, then every complete line still on the live
/// file. Returns on the first failure so the cursor never advances past bytes
/// the server has not accepted.
async fn sweep(
    state: &Arc<TonoState>,
    generation: u64,
    session_id: &str,
    sequence: &mut u32,
) -> Result<(), ApiError> {
    if !state.audit().enabled() || !state.audit().network_log_upload_enabled() {
        return Ok(());
    }
    let log_path = state.audit().log_path().to_path_buf();
    let cursor_path = log_path.with_file_name(CURSOR_FILE_NAME);
    let backup_path = log_path.with_file_name(AUDIT_BACKUP_FILE_NAME);
    let mut cursor = Cursor::load(&cursor_path);

    // Rotation: the live file is shorter than what has already been accepted, so
    // the bytes between the cursor and the old end now live in the backup.
    let live_size = std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
    if live_size < cursor.offset {
        cursor.backup_offset = Some(cursor.offset);
        cursor.offset = 0;
        cursor.save(&cursor_path);
    }

    let client = {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation {
            return Ok(());
        }
        inner.client.clone()
    };
    let client_version = env!("CARGO_PKG_VERSION");
    let os_version = os_version_string();

    if let Some(backup_offset) = cursor.backup_offset {
        match read_segment(&backup_path, backup_offset) {
            Some(segment) => {
                send(state, &client, session_id, sequence, &segment, client_version, &os_version)
                    .await?;
                cursor.backup_offset = if segment.remaining == 0 {
                    None
                } else {
                    Some(backup_offset + segment.consumed)
                };
                cursor.save(&cursor_path);
            }
            // Nothing readable there: the backup is gone or already drained.
            // Give up on it rather than blocking the live file behind it.
            None => {
                cursor.backup_offset = None;
                cursor.save(&cursor_path);
            }
        }
    }

    loop {
        let Some(segment) = read_segment(&log_path, cursor.offset) else {
            return Ok(());
        };
        send(state, &client, session_id, sequence, &segment, client_version, &os_version).await?;
        cursor.offset += segment.consumed;
        cursor.save(&cursor_path);
        if segment.remaining == 0 {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(80)).await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn send(
    state: &Arc<TonoState>,
    client: &crate::tono::state::TonoApiClient,
    session_id: &str,
    sequence: &mut u32,
    segment: &Segment,
    client_version: &str,
    os_version: &str,
) -> Result<(), ApiError> {
    let result = client
        .upload_diagnostics_log_segment(DiagnosticsLogSegment {
            session_id,
            sequence: *sequence,
            line_count: segment.line_count,
            client_version,
            os_version,
            gzip: &segment.gzip,
        })
        .await;
    match result {
        Ok(_) => {
            state.audit().log(AuditEvent::NetworkLogSegmentUploaded {
                sequence: *sequence,
                line_count: segment.line_count,
                bytes: segment.gzip.len() as u32,
            });
            *sequence = sequence.saturating_add(1);
            Ok(())
        }
        Err(err) => {
            state.audit().log(AuditEvent::NetworkLogSegmentUploadFail {
                error: err.to_string(),
            });
            Err(err)
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
    fn rotation_is_detected_by_the_live_file_being_shorter_than_the_cursor() {
        let dir = Dir::new("rotate");
        let live = dir.join("traffic-audit.jsonl");
        let backup = dir.join(AUDIT_BACKUP_FILE_NAME);
        let old: String = (1..=30).map(line).collect();
        std::fs::write(&backup, &old).unwrap();
        std::fs::write(&live, (100..=104).map(line).collect::<String>()).unwrap();

        // Cursor recorded ten lines of the file that has since become the backup.
        let consumed_before_rotation = (1..=10).map(line).collect::<String>().len() as u64;
        let live_size = std::fs::metadata(&live).unwrap().len();
        assert!(
            live_size < old.len() as u64,
            "test premise: the rotated file must be longer than the fresh one",
        );

        // The unsent tail of the backup is recoverable from that offset...
        let tail = read_segment(&backup, consumed_before_rotation).expect("backup tail");
        let tail_text = gunzip(&tail.gzip);
        assert!(tail_text.contains("\"n\":30,"), "lost the rotated tail");
        assert!(!tail_text.contains("\"n\":1,"), "re-sent pre-rotation lines");
        // ...and the live file is read from zero, not from the stale offset.
        let fresh = read_segment(&live, 0).expect("live segment");
        assert!(gunzip(&fresh.gzip).contains("\"n\":104,"));
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
        Cursor { offset: 4096, backup_offset: Some(17) }.save(&path);
        let loaded = Cursor::load(&path);
        assert_eq!(loaded.offset, 4096);
        assert_eq!(loaded.backup_offset, Some(17));

        std::fs::write(&path, b"{not json").unwrap();
        let recovered = Cursor::load(&path);
        assert_eq!(recovered.offset, 0);
        assert_eq!(recovered.backup_offset, None);
    }
}
