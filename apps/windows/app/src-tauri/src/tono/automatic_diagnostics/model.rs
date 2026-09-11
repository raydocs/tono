//! The automatic channel has no raw-text error/log/URL fields. Disk replays deserialize this
//! same closed vocabulary before constructing the already-deployed telemetry wire format.
use serde::{Deserialize, Serialize};
use tono_core::auth::{
    TELEMETRY_KIND_PERIODIC_WINDOW, TELEMETRY_SCHEMA_VERSION, TelemetryEvent, TelemetryWindowReport,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Phase {
    Disconnected,
    Connecting,
    Connected,
    ProtectedOffline,
    Disconnecting,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Code {
    Unknown,
    Unavailable,
    Observed,
    NotObserved,
    Superseded,
    Tunnel,
    Physical,
    OtherInterface,
    Timeout,
    Closed,
    Reset,
    Refused,
    Tls,
    Authentication,
    Dns,
    OtherError,
    ReportedFailure,
    NoReportedFailure,
    Bootstrap,
    Locked,
    Blocked,
    RealityTcp,
    Hysteria2Udp,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Key {
    CaptureConsistent,
    ServiceReadable,
    CoreActive,
    CorePid,
    CoreGeneration,
    ServiceSession,
    WfpWanted,
    WfpLive,
    WfpVerified,
    TunnelPermit,
    WfpHasError,
    DnsReadable,
    DnsEnabled,
    DnsAdapters,
    DnsHasError,
    ControllerReadable,
    SelectorMatches,
    ActiveConnections,
    UploadTotal,
    DownloadTotal,
    FakeIpRoute,
    VpsRoute,
    TunnelAliasKnown,
    HomeConfigured,
    HomeAppliedMatches,
    RequestedTransport,
    AppliedTransport,
    OptionalDirectEnabled,
    CoreLogsReadable,
    CoreLogRows,
    CoreLogErrors,
    CoreLogSkipped,
    RemoteReachability,
    AppFailure,
    QueueDropped,
    CaptureTimedOut,
    RetryAttempt,
    AttemptElapsedMs,
    WfpMode,
    ServiceProtocolEpoch,
    ServiceProtocolRevision,
    ServiceFreshProofCapable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum FailureClass {
    Unknown,
    ServiceIdentity,
    ServiceCompatibility,
    ServiceBusy,
    WfpUnavailable,
    WfpTimeout,
    ProtectionCommitUncertain,
    TunNotReady,
    DnsNativeUnproven,
    DnsFakeIpUnproven,
    RuntimeIdentityChanged,
    HomeRoutingChanged,
    ExitConfigurationChanged,
    TransportUnavailable,
    LegacyHomeUnsupported,
    LegacyExternalProbeGate,
    TransactionTimeout,
    ServiceUnavailable,
    DnsListenerConflict,
}

impl FailureClass {
    pub fn from_error(error: &str) -> Self {
        serde_json::from_value(serde_json::json!(crate::tono::diagnostic_contract::failure_class(
            error
        )))
        .unwrap_or(Self::Unknown)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Stage {
    Preparing,
    PreparingService,
    StartingKillSwitch,
    StartingTunnel,
    LockingTraffic,
    ApplyingCloudPolicy,
    #[serde(rename = "securingDNS")]
    SecuringDns,
    CheckingExit,
    VerifyingTraffic,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum StepState {
    Pending,
    Current,
    Completed,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Step {
    stage: Stage,
    state: StepState,
    elapsed_ms: Option<u32>,
}

impl Step {
    pub fn from_record(record: &crate::tono::steps::StepRecord) -> Option<Self> {
        Some(Self {
            stage: serde_json::from_value(serde_json::json!(record.key)).ok()?,
            state: serde_json::from_value(serde_json::json!(crate::tono::steps::state_key(record.state))).ok()?,
            elapsed_ms: record.elapsed_ms.map(|n| n.min(u32::MAX as u64) as u32),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum Value {
    Flag(bool),
    Count(u32),
    Class(Code),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Fact {
    pub key: Key,
    pub value: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub(super) struct SourceId(String);
impl TryFrom<String> for SourceId {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() == 16 && value.bytes().all(|b| b.is_ascii_hexdigit()) {
            Ok(Self(value))
        } else {
            Err("invalid source fingerprint")
        }
    }
}
impl From<SourceId> for String {
    fn from(value: SourceId) -> Self {
        value.0
    }
}

/// Node display labels only. Reject addresses, paths, email/URL shapes and opaque material.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub(super) struct NodeLabel(String);
impl TryFrom<String> for NodeLabel {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if !value.trim().is_empty()
            && value.len() <= 100
            && value
                .chars()
                .all(|c| c.is_alphabetic() || c.is_ascii_digit() || " ·-()".contains(c))
            && !value.split_whitespace().any(|word| word.len() >= 20)
        {
            Ok(Self(value))
        } else {
            Err("invalid node display label")
        }
    }
}
impl From<NodeLabel> for String {
    fn from(value: NodeLabel) -> Self {
        value.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Snapshot {
    pub at_ms: i64,
    pub generation: u64,
    pub phase: Phase,
    pub node: Option<NodeLabel>,
    pub app_source: Option<SourceId>,
    pub service_source: Option<SourceId>,
    pub facts: Vec<Fact>,
    pub errors: Vec<(Code, u32)>,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub failure_class: Option<FailureClass>,
}

fn token<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".into())
}

impl Snapshot {
    pub fn valid(&self) -> bool {
        (0..=4_102_444_800_000).contains(&self.at_ms)
            && self.generation <= 9_007_199_254_740_991
            && self.facts.len() <= 44
            && self.errors.len() <= 8
            && self.steps.len() <= 9
            && self.errors.iter().all(|(code, count)| {
                matches!(
                    code,
                    Code::Timeout
                        | Code::Closed
                        | Code::Reset
                        | Code::Refused
                        | Code::Tls
                        | Code::Authentication
                        | Code::Dns
                        | Code::OtherError
                ) && *count <= 100
            })
    }
    pub fn fact(&mut self, key: Key, value: Value) {
        self.facts.push(Fact { key, value });
    }
    pub fn flag(&mut self, key: Key, value: bool) {
        self.fact(key, Value::Flag(value));
    }
    pub fn count(&mut self, key: Key, value: u64) {
        self.fact(key, Value::Count(value.min(u32::MAX as u64) as u32));
    }
    pub fn class(&mut self, key: Key, code: Code) {
        self.fact(key, Value::Class(code));
    }
    pub fn signature(&self) -> String {
        // Byte counters/active flows change during healthy use; they must not become upload triggers.
        let stable: Vec<_> = self
            .facts
            .iter()
            .filter(|f| {
                !matches!(
                    f.key,
                    Key::ActiveConnections
                        | Key::UploadTotal
                        | Key::DownloadTotal
                        | Key::CoreLogRows
                        | Key::CoreLogErrors
                )
            })
            .collect();
        // More lines of the same failure class are not separate incidents. Keep their counts
        // in a captured report, but don't burn the hourly intake budget on 1, 2, 3… timeouts.
        let mut errors: Vec<_> = self.errors.iter().map(|(code, _)| *code).collect();
        errors.sort_unstable();
        tono_core::catalog::catalog_digest(
            &serde_json::to_string(&(
                self.generation,
                self.phase,
                &self.node,
                stable,
                &errors,
                &self.steps,
                &self.failure_class,
                &self.app_source,
                &self.service_source,
            ))
            .unwrap_or_default(),
        )
    }
    pub fn wire(&self, dropped: u32) -> TelemetryWindowReport {
        let mut events = Vec::new();
        let identity = tono_core::catalog::catalog_digest(&serde_json::to_string(self).unwrap_or_default());
        let base = |kind: &str| {
            serde_json::json!({
                "ts": self.at_ms, "kind": kind, "generation": self.generation,
                "reference": &identity[..16],
                "node": self.node.clone().map(String::from),
                "mode": self.phase_key(),
            })
        };
        let mut push = |value| {
            if let Ok(event) = serde_json::from_value::<TelemetryEvent>(value) {
                events.push(event);
            }
        };
        let mut sources = base("autoConnectionSources");
        sources["action"] = serde_json::json!(
            self.app_source
                .clone()
                .map(String::from)
                .unwrap_or_else(|| "unknown".into())
        );
        sources["outcome"] = serde_json::json!(
            self.service_source
                .clone()
                .map(String::from)
                .unwrap_or_else(|| "unknown".into())
        );
        push(sources);
        for fact in &self.facts {
            let mut event = base("autoConnectionFact");
            event["code"] = serde_json::json!(token(&fact.key));
            match &fact.value {
                Value::Flag(value) => event["live"] = serde_json::json!(value),
                Value::Count(value) => event["counter"] = serde_json::json!(value),
                Value::Class(value) => event["outcome"] = serde_json::json!(token(value)),
            }
            push(event);
        }
        for (code, count) in &self.errors {
            let mut event = base("autoCoreErrorClass");
            event["code"] = serde_json::json!(token(code));
            event["counter"] = serde_json::json!(count);
            event["outcome"] = serde_json::json!("observedInCurrentCoreRingNotRootCause");
            push(event);
        }
        for step in &self.steps {
            let mut event = base("autoConnectionStep");
            event["stage"] = serde_json::json!(token(&step.stage));
            event["outcome"] = serde_json::json!(token(&step.state));
            event["elapsedMs"] = serde_json::json!(step.elapsed_ms);
            push(event);
        }
        if let Some(class) = &self.failure_class {
            let mut event = base("autoConnectionFailure");
            event["code"] = serde_json::json!(token(class));
            push(event);
        }
        TelemetryWindowReport {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            kind: TELEMETRY_KIND_PERIODIC_WINDOW.into(),
            window_start_ms: self.at_ms,
            window_end_ms: self.at_ms,
            app_version: env!("CARGO_PKG_VERSION").into(),
            os_version: "Windows".into(),
            os_arch: std::env::consts::ARCH.into(),
            ui_state: self.phase_key(),
            account_state: "ready".into(),
            selected_server: self.node.clone().map(String::from),
            catalog_revision: None,
            kill_switch_mode: None,
            kill_switch_wanted: None,
            kill_switch_live: None,
            dns_enabled: None,
            exit_delay_ms: None,
            exit_delay_at_ms: None,
            tcp_delay_ms: None,
            tcp_delay_at_ms: None,
            event_count: events.len() as u32,
            events_dropped: dropped.min(1_000_000),
            events,
        }
    }
    fn phase_key(&self) -> String {
        if self.phase == Phase::Disconnected {
            "notConnected".into()
        } else {
            token(&self.phase)
        }
    }
}

/// Classify locally, discard the line. In particular TLS errors are NOT renamed "REALITY".
pub(super) fn classify(line: &str) -> Option<Code> {
    if line.len() > 4096 {
        return None;
    }
    let s = line.to_ascii_lowercase();
    if !["level=error", "level=warning", "level=warn", "[error]", "[warn]"]
        .iter()
        .any(|marker| s.contains(marker))
    {
        return None;
    }
    Some(
        if s.contains("authentication failed") || s.contains("auth failed") || s.contains("invalid user") {
            Code::Authentication
        } else if s.contains("connection refused") {
            Code::Refused
        } else if s.contains("connection reset") {
            Code::Reset
        } else if s.contains("timeout") || s.contains("timed out") || s.contains("deadline exceeded") {
            Code::Timeout
        } else if s.contains("tls:") || s.contains("tls handshake") || s.contains("reality") {
            Code::Tls
        } else if s.contains("dns") || s.contains("resolve") || s.contains("lookup") {
            Code::Dns
        } else if s.contains("eof") || s.contains("connection closed") {
            Code::Closed
        } else {
            Code::OtherError
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_lines_only_produce_fixed_classes_not_addresses_credentials_or_urls() {
        assert_eq!(
            classify(
                "level=warning msg=\"[TCP] dial secret.example:443 with password=example-secret error: i/o timeout\""
            ),
            Some(Code::Timeout)
        );
        assert_eq!(classify("level=warning msg=\"tls: access denied\""), Some(Code::Tls));
        assert_eq!(classify("level=info msg=\"normal request to tls.example\""), None);
        assert_eq!(
            classify("level=warning msg=\"server returned 403\""),
            Some(Code::OtherError)
        );
        assert_eq!(classify(&"x".repeat(4097)), None);
    }
    #[test]
    fn replay_cannot_smuggle_free_text_through_facts_or_source_ids() {
        assert!(
            serde_json::from_str::<Fact>(r#"{"key":"coreActive","value":{"type":"class","value":"secret.example"}}"#)
                .is_err()
        );
        assert!(SourceId::try_from("private credentials".to_owned()).is_err());
        for text in [
            "127.0.0.1",
            "name@example.com",
            "https://example.com",
            "C:\\private",
            "aaaaaaaaaaaaaaaaaaaaaaa",
        ] {
            assert!(NodeLabel::try_from(text.to_owned()).is_err());
        }
        assert!(NodeLabel::try_from("Los Angeles · Mesa".to_owned()).is_ok());
    }

    #[test]
    fn routine_flow_counters_and_ring_order_do_not_flood_but_new_evidence_does() {
        let mut a = Snapshot {
            at_ms: 100,
            generation: 1,
            phase: Phase::Connected,
            node: None,
            app_source: None,
            service_source: None,
            facts: vec![],
            errors: vec![(Code::Closed, 2), (Code::Timeout, 1)],
            steps: vec![],
            failure_class: None,
        };
        a.count(Key::DownloadTotal, 0);
        a.flag(Key::WfpLive, true);
        let mut b = a.clone();
        b.at_ms = 200;
        b.errors.reverse();
        b.errors[0].1 = 99;
        b.facts[0].value = Value::Count(1234);
        assert_eq!(a.signature(), b.signature());
        b.flag(Key::SelectorMatches, false);
        assert_ne!(a.signature(), b.signature());
        let mut changed_source = a.clone();
        changed_source.service_source = "0000000000000001".to_owned().try_into().ok();
        assert_ne!(a.signature(), changed_source.signature());
        a.generation = 9_007_199_254_740_992;
        assert!(!a.valid());
    }
}
