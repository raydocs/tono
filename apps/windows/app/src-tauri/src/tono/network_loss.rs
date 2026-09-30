//! Events that leave the user without a working network.
//!
//! Each one is queued on disk and posted to `telemetry/diagnostics` on a later
//! pass, including after the machine is back online. The control plane treats
//! these codes as severity `p0` and alerts on the first event of the cluster.
//! Spike growth is not required. See `failure-clusters.ts`.

use std::path::Path;

use crate::tono::audit::AuditEvent;
use crate::tono::telemetry_outbox;

pub const NETWORK_LOSS: &str = "TONO_NETWORK_LOSS";
pub const FAIL_OPEN: &str = "TONO_FAIL_OPEN";
pub const WATCHDOG_RESTORE: &str = "TONO_WATCHDOG_RESTORE";
pub const KILL_SWITCH_STUCK: &str = "TONO_KILL_SWITCH_STUCK";
pub const RESTORE_NETWORK: &str = "TONO_RESTORE_NETWORK";
pub const CRASH_WHILE_PROTECTED: &str = "TONO_CRASH_WHILE_PROTECTED";

pub fn is_p0(code: &str) -> bool {
    matches!(
        code,
        NETWORK_LOSS | FAIL_OPEN | WATCHDOG_RESTORE | KILL_SWITCH_STUCK | RESTORE_NETWORK | CRASH_WHILE_PROTECTED
    )
}

/// Map an audit event onto a P0 code. Other events stay on the normal timeline.
pub fn code_for_audit(event: &AuditEvent) -> Option<&'static str> {
    match event {
        AuditEvent::ProtectedOffline { reason: "networkChange" } => Some(NETWORK_LOSS),
        AuditEvent::ProtectedOffline { reason: "failOpen" } => Some(FAIL_OPEN),
        AuditEvent::ProtectedOffline { reason: "watchdogRestore" } => Some(WATCHDOG_RESTORE),
        AuditEvent::ProtectedOffline { reason: "reconnectBudgetExhausted" } => Some(KILL_SWITCH_STUCK),
        AuditEvent::ReleaseFail { .. } => Some(KILL_SWITCH_STUCK),
        AuditEvent::DisconnectBegin { cause: "user" } => Some(RESTORE_NETWORK),
        AuditEvent::CoreRestart { .. } => Some(CRASH_WHILE_PROTECTED),
        _ => None,
    }
}

fn event_kind(code: &str) -> &'static str {
    match code {
        CRASH_WHILE_PROTECTED => "appCrash",
        KILL_SWITCH_STUCK => "killSwitchFail",
        _ => "connectFail",
    }
}

pub fn enqueue_p0(dir: &Path, code: &str, node: &str) {
    if !is_p0(code) {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0);
    let node = if node.trim().is_empty() { "unselected" } else { node };
    let channel = if crate::tono::audit::internal_build() { "beta" } else { "release" };
    let body = serde_json::json!({
        "schemaVersion": 1,
        "aiServicesConsent": false,
        "client": {
            "appVersion": env!("CARGO_PKG_VERSION"),
            "platform": "windows",
            "osVersion": "unknown",
            "channel": channel,
        },
        "events": [{
            "ts": now,
            "kind": event_kind(code),
            "stage": "protection",
            "code": code,
            "node": node,
        }]
    });
    if let Ok(text) = serde_json::to_string(&body) {
        telemetry_outbox::enqueue(dir, "p0", &text, now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Temp {
        path: std::path::PathBuf,
    }

    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "tono-p0-{}-{}",
                std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn network_loss_events_are_p0_and_a_normal_failure_is_not() {
        assert_eq!(
            code_for_audit(&AuditEvent::ProtectedOffline { reason: "networkChange" }),
            Some(NETWORK_LOSS)
        );
        assert_eq!(
            code_for_audit(&AuditEvent::ProtectedOffline { reason: "failOpen" }),
            Some(FAIL_OPEN)
        );
        assert_eq!(
            code_for_audit(&AuditEvent::DisconnectBegin { cause: "user" }),
            Some(RESTORE_NETWORK)
        );
        assert_eq!(
            code_for_audit(&AuditEvent::ReleaseFail { error: "still armed".into() }),
            Some(KILL_SWITCH_STUCK)
        );
        assert_eq!(
            code_for_audit(&AuditEvent::CoreRestart { old_pid: None, new_pid: Some(1), restart_count: 1 }),
            Some(CRASH_WHILE_PROTECTED)
        );
        assert_eq!(code_for_audit(&AuditEvent::SignOut), None);
    }

    #[test]
    fn a_p0_event_is_queued_on_disk_for_the_next_connection() {
        let dir = Temp::new();
        enqueue_p0(&dir.path, NETWORK_LOSS, "");
        let due = telemetry_outbox::due(&dir.path, i64::MAX);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].kind, "p0");
        assert!(due[0].body.contains("TONO_NETWORK_LOSS"));
        assert!(due[0].body.contains("\"stage\":\"protection\""));
        assert!(due[0].body.contains("unselected"));
        enqueue_p0(&dir.path, "TONO_NODE_TIMEOUT", "Tokyo");
        assert_eq!(telemetry_outbox::due(&dir.path, i64::MAX).len(), 1);
    }
}
