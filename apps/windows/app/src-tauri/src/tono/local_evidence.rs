//! Local-only support evidence. Never serialize raw Core logs into diagnostics uploads.
//! A recent log tail is not attempt-bound: observations are clues, not a diagnosis.

use serde::Serialize;
use std::sync::{Arc, Mutex};

/// Whitelisted App observations, not a transport-handshake verdict. No raw errors/URLs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOutcome {
    pub round: u32,
    pub path: &'static str,
    pub origin: &'static str,
    pub passed: bool,
    pub category: &'static str,
    pub actual_status: Option<u16>,
    pub elapsed_ms: u64,
}

#[derive(Clone)]
pub struct ProbeRecorder {
    pub round: u32,
    pub path: &'static str,
    pub outcomes: Arc<Mutex<Vec<ProbeOutcome>>>,
}

impl ProbeRecorder {
    pub fn record(
        &self,
        origin: &str,
        passed: bool,
        category: &'static str,
        actual_status: Option<u16>,
        elapsed_ms: u64,
    ) {
        let origin = match origin {
            "Google" => "Google",
            "Cloudflare" => "Cloudflare",
            "Apple" => "Apple",
            "WFP" => "WFP",
            _ => "unknown",
        };
        if let Ok(mut outcomes) = self.outcomes.lock() {
            // At most 2 x 3 TUN origins + 3 loopback origins + controller/WFP.
            if outcomes.len() < 16 {
                outcomes.push(ProbeOutcome {
                    round: self.round,
                    path: self.path,
                    origin,
                    passed,
                    category,
                    actual_status,
                    elapsed_ms,
                });
            }
        }
    }
}

/// Memory-only attempt identity. No account identifiers, runtime YAML or credentials.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionAttempt {
    pub id: String,
    pub started_at_ms: i64,
    pub selected_server: String,
    pub transport: &'static str,
    pub catalog_revision: Option<i64>,
    #[serde(skip)]
    pub probe_outcomes: Arc<Mutex<Vec<ProbeOutcome>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedAttempt {
    #[serde(flatten)]
    pub attempt: ConnectionAttempt,
    pub failed_at_ms: i64,
    pub failed_stage: Option<&'static str>,
    pub error_code: Option<String>,
    pub steps: Vec<tono_core::auth::DiagnosticsStep>,
    pub probe_outcomes: Vec<ProbeOutcome>,
}

#[derive(Default)]
pub struct AttemptHistory {
    pub current: Option<ConnectionAttempt>,
    pub last_failure: Option<FailedAttempt>,
}

impl AttemptHistory {
    pub fn begin(
        &mut self,
        started_at_ms: i64,
        selected_server: String,
        transport: &'static str,
        catalog_revision: i64,
    ) -> ConnectionAttempt {
        let attempt = ConnectionAttempt {
            id: tono_core::auth::new_installation_id(),
            started_at_ms,
            selected_server,
            transport,
            catalog_revision: (catalog_revision >= 0).then_some(catalog_revision),
            probe_outcomes: Arc::new(Mutex::new(Vec::new())),
        };
        self.current = Some(attempt.clone());
        attempt
    }

    pub fn retain(&mut self, failure: FailedAttempt) {
        if self
            .current
            .as_ref()
            .is_some_and(|current| current.id == failure.attempt.id)
        {
            self.last_failure = Some(failure);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreLogEvidence {
    pub status: &'static str,
    pub inspected_lines: usize,
    pub truncated: bool,
    pub observations: Vec<CoreLogObservation>,
}

#[derive(Debug, Serialize)]
pub struct CoreLogObservation {
    code: &'static str,
    count: usize,
}

impl CoreLogEvidence {
    pub fn unavailable(status: &'static str) -> Self {
        Self {
            status,
            inspected_lines: 0,
            truncated: false,
            observations: Vec::new(),
        }
    }
}

/// Only fixed observation labels and counts cross into the WebView. Neither unknown
/// errors nor matched source lines are copied: they can contain browsing destinations,
/// credentials and paths that the ordinary diagnostics redactor does not promise to cover.
pub fn summarize_core_log(raw: &str) -> CoreLogEvidence {
    const MAX_BYTES: usize = 64 * 1024;
    const MAX_LINES: usize = 200;
    const MARKERS: &[(&str, &str)] = &[
        ("tls handshake eof", "tls_handshake_eof"),
        ("connection refused", "connection_refused"),
        ("connection reset", "connection_reset"),
        ("i/o timeout", "io_timeout"),
        ("no such host", "dns_no_such_host"),
        ("certificate", "certificate_mentioned"),
        ("reality", "reality_mentioned"),
    ];
    let mut start = raw.len().saturating_sub(MAX_BYTES);
    if start > 0 {
        // Discard a partial leading line, including any partial UTF-8 character.
        start = raw.as_bytes()[start..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(raw.len(), |offset| start + offset + 1);
    }
    let tail = &raw[start..];
    let mut lines = tail.lines().rev();
    let mut counts = vec![0; MARKERS.len()];
    let mut inspected_lines = 0;
    for line in lines.by_ref().take(MAX_LINES) {
        inspected_lines += 1;
        let lower = line.to_ascii_lowercase();
        for (index, (marker, _)) in MARKERS.iter().enumerate() {
            if lower.contains(marker) {
                counts[index] += 1;
            }
        }
    }
    CoreLogEvidence {
        status: if raw.is_empty() { "empty" } else { "available" },
        inspected_lines,
        truncated: start > 0 || lines.next().is_some(),
        observations: MARKERS
            .iter()
            .zip(counts)
            .filter_map(|((_, code), count)| (count > 0).then_some(CoreLogObservation { code, count }))
            .collect(),
    }
}

/// Read-only IPC: unlike the UI log opener, a failed owner lookup must not trigger
/// owner recovery or change the connection being diagnosed. Never persist the raw log.
pub async fn collect_core_log() -> CoreLogEvidence {
    let Ok(credentials) = crate::core::owner_identity::current_owner_credentials() else {
        return CoreLogEvidence::unavailable("owner_unavailable");
    };
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        tono_service_protocol::get_clash_log_snapshot(&credentials),
    )
    .await;
    let encoded = match response {
        Err(_) => return CoreLogEvidence::unavailable("timeout"),
        Ok(Ok(response)) if response.code == 0 => match response.data {
            Some(data) => data,
            None => return CoreLogEvidence::unavailable("unavailable"),
        },
        _ => return CoreLogEvidence::unavailable("unavailable"),
    };
    if encoded.len() > 8 * 1024 * 1024 || encoded.len() % 2 != 0 || !encoded.is_ascii() {
        return CoreLogEvidence::unavailable("invalid_snapshot");
    }
    let decoded: Result<Vec<u8>, _> = (0..encoded.len())
        .step_by(2)
        .map(|offset| u8::from_str_radix(&encoded[offset..offset + 2], 16))
        .collect();
    match decoded {
        Ok(bytes) => summarize_core_log(&String::from_utf8_lossy(&bytes)),
        Err(_) => CoreLogEvidence::unavailable("invalid_snapshot"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_preserves_failure_identity_and_rejects_a_superseded_writer() {
        let mut history = AttemptHistory::default();
        let first = history.begin(1000, "Original city".into(), "tcp", 54);
        let recorder = ProbeRecorder {
            round: 1,
            path: "tun",
            outcomes: first.probe_outcomes.clone(),
        };
        recorder.record("Google", false, "dns", None, 173);
        let failed = FailedAttempt {
            attempt: first.clone(),
            failed_at_ms: 2000,
            failed_stage: Some("verifyingTraffic"),
            error_code: Some("CORE_EXIT_UNREACHABLE".into()),
            steps: vec![],
            probe_outcomes: first.probe_outcomes.lock().unwrap().clone(),
        };
        history.retain(failed.clone());
        let second = history.begin(3000, "Retry city".into(), "hy2", 55);
        assert_ne!(first.id, second.id);
        recorder.record("Apple", false, "tls", None, 891);
        assert!(second.probe_outcomes.lock().unwrap().is_empty());
        let saved = history.last_failure.as_ref().unwrap();
        assert_eq!(saved.probe_outcomes.len(), 1);
        assert_eq!(saved.probe_outcomes[0].origin, "Google");
        assert_eq!(saved.probe_outcomes[0].elapsed_ms, 173);
        assert_eq!(saved.attempt.selected_server, "Original city");
        assert_eq!(saved.attempt.catalog_revision, Some(54));
        assert_eq!(saved.failed_at_ms, 2000);
        history.retain(FailedAttempt {
            attempt: second,
            failed_at_ms: 4000,
            ..failed.clone()
        });
        history.retain(failed);
        assert_eq!(history.last_failure.as_ref().unwrap().failed_at_ms, 4000);
        history = AttemptHistory::default();
        assert!(history.current.is_none() && history.last_failure.is_none());
    }

    #[test]
    fn core_observations_are_bounded_whitelisted_counts_not_raw_logs() {
        let private = "uuid=customer-secret server=203.0.113.8 host=private.example/path";
        let log = format!(
            "connection refused OLD\n{}",
            (0..201)
                .map(|n| match n {
                    199 => format!("tls handshake eof {private}"),
                    200 => format!("TLS HANDSHAKE EOF {private}"),
                    _ => "unrecognized detail".to_string(),
                })
                .collect::<Vec<_>>()
                .join("\n")
        );
        let evidence = summarize_core_log(&log);
        assert_eq!(evidence.inspected_lines, 200);
        assert!(evidence.truncated);
        assert_eq!(
            serde_json::to_value(&evidence.observations).unwrap(),
            serde_json::json!([{ "code": "tls_handshake_eof", "count": 2 }])
        );
        let json = serde_json::to_string(&evidence).unwrap();
        for secret in ["customer-secret", "203.0.113.8", "private.example", "OLD"] {
            assert!(!json.contains(secret));
        }
        let large = format!("{}\ntls handshake eof", "界".repeat(30_000));
        assert!(summarize_core_log(&large).truncated);
        assert_eq!(summarize_core_log("").status, "empty");
        assert!(summarize_core_log("unknown failure").observations.is_empty());
        assert_eq!(CoreLogEvidence::unavailable("timeout").status, "timeout");
    }
}
