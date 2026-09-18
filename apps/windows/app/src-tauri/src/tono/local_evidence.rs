//! Local-only support evidence. Never serialize raw Core logs into diagnostics uploads.
//! A recent log tail is not attempt-bound: observations are clues, not a diagnosis.

use serde::Serialize;

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
