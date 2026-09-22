//! One bounded, short-lived manual disclosure. The renderer gets a preview ID,
//! never authority to supply an upload body or to reuse another account's report.

use std::time::{Duration, Instant};
use tono_core::auth::DiagnosticsReport;

const PREVIEW_LIFETIME: Duration = Duration::from_secs(5 * 60);

struct PendingReport {
    id: String,
    owner: (u64, u64),
    prepared_at: Instant,
    report: DiagnosticsReport,
}

#[derive(Default)]
pub(crate) struct SupportReports {
    sequence: u64,
    pending: Option<PendingReport>,
}

impl SupportReports {
    pub fn prepare(&mut self, owner: (u64, u64), report: DiagnosticsReport, now: Instant) -> String {
        self.sequence = self.sequence.wrapping_add(1);
        let id = format!("preview-{}", self.sequence);
        self.pending = Some(PendingReport {
            id: id.clone(),
            owner,
            prepared_at: now,
            report,
        });
        id
    }

    pub fn take(&mut self, id: &str, owner: (u64, u64), now: Instant) -> Result<DiagnosticsReport, String> {
        let pending = self.pending.as_ref().ok_or("TONO_DIAG_PREVIEW_EXPIRED")?;
        if pending.id != id || pending.owner != owner || now.duration_since(pending.prepared_at) >= PREVIEW_LIFETIME {
            return Err("TONO_DIAG_PREVIEW_EXPIRED".to_string());
        }
        // Consume before dispatch: an ambiguous HTTP failure must not silently resend a report.
        Ok(self.pending.take().expect("validated pending report").report)
    }
}

pub(crate) fn build_provenance(workflow: Option<&str>, debug: bool) -> &'static str {
    match workflow {
        Some("Windows candidate installer") => "candidate",
        Some("Windows release") => "release-workflow",
        _ if debug => "development",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frozen_preview_is_single_use_bounded_and_never_borrows_a_replacement_owner() {
        let now = Instant::now();
        let mut previews = SupportReports::default();
        let original = DiagnosticsReport {
            selected_server: Some("A route".into()),
            reported_at_ms: 123,
            ..Default::default()
        };
        let id = previews.prepare((2, 7), original.clone(), now);
        assert!(previews.take(&id, (3, 9), now).is_err());
        assert_eq!(previews.take(&id, (2, 7), now).unwrap(), original);
        assert!(previews.take(&id, (2, 7), now).is_err());
        let old = previews.prepare((3, 9), original.clone(), now);
        let current = previews.prepare((3, 9), DiagnosticsReport::default(), now);
        assert!(previews.take(&old, (3, 9), now).is_err());
        assert!(previews.take(&current, (3, 9), now + PREVIEW_LIFETIME).is_err());
        let current = previews.prepare((3, 9), original.clone(), now);
        assert_eq!(
            previews
                .take(&current, (3, 9), now + PREVIEW_LIFETIME - Duration::from_millis(1))
                .unwrap(),
            original
        );
    }

    #[test]
    fn provenance_does_not_call_an_unknown_or_ci_build_a_customer_release() {
        assert_eq!(
            build_provenance(Some("Windows candidate installer"), false),
            "candidate"
        );
        assert_eq!(build_provenance(Some("Windows release"), false), "release-workflow");
        assert_eq!(build_provenance(Some("Windows CI"), false), "unknown");
        assert_eq!(build_provenance(None, false), "unknown");
        assert_eq!(build_provenance(None, true), "development");
    }
}
