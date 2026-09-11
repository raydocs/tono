//! Support metadata only. No status/FSM/retry decisions and no runtime or secret-file reads.

use tono_service_protocol::ProtocolInfo;

pub(crate) const APP_SOURCE: &str = env!("TONO_APP_CONNECTION_SOURCE");

fn fingerprint(value: Option<&str>) -> &str {
    value
        .filter(|value| value.len() == 16 && value.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or("unknown")
}

/// Classify only explicit, already-produced failure markers. In particular, a later Service
/// version/capability read and the report's post-cleanup status must not invent the failure cause.
pub(crate) fn failure_class(error: &str) -> &'static str {
    let classes: &[(&str, &[&str])] = &[
        (
            "serviceIdentity",
            &[
                "Windows named-pipe server does not match the registered LocalSystem service process",
                "owner session is stale or invalid",
                "declared owner does not match",
                "unauthorized owner",
            ],
        ),
        (
            "serviceCompatibility",
            &["TONO_SERVICE_TOO_OLD", "service protocol version does not match"],
        ),
        ("serviceBusy", &["TONO_SERVICE_BUSY", "TONO_RELEASE_RECONCILING"]),
        ("wfpUnavailable", &["TONO_BFE_NOT_RUNNING"]),
        ("wfpTimeout", &["TONO_WFP_ENGINE_WEDGED"]),
        ("protectionCommitUncertain", &["TONO_PROTECTION_COMMIT_UNCERTAIN"]),
        ("tunNotReady", &["TONO_TUN_WAIT_EXHAUSTED", "did not resolve to a LUID"]),
        (
            "dnsNativeUnproven",
            &["TONO_DNS_UNVERIFIED", "Failed to enable protected DNS:"],
        ),
        ("dnsFakeIpUnproven", &["fake-ip verification failed:"]),
        (
            "runtimeIdentityChanged",
            &[
                "Core identity changed before admission DNS repair",
                "Service protection proof does not match this session/Core",
            ],
        ),
        (
            "homeRoutingChanged",
            &[
                "home routing changed before admission DNS repair",
                "家宽分流配置在连接过程中变化",
            ],
        ),
        ("legacyHomeUnsupported", &["旧 homeProxy 家宽配置不受支持"]),
        ("exitConfigurationChanged", &["VPS 传输配置在连接过程中变化"]),
        ("transportUnavailable", &["the selected server does not offer Hysteria2 UDP"]),
        (
            "legacyExternalProbeGate",
            &["all 3 independent protected TUN probes failed"],
        ),
        ("transactionTimeout", &["connection transaction exceeded"]),
        ("serviceUnavailable", &["TONO_SERVICE_NOT_RUNNING"]),
    ];
    for (class, markers) in classes {
        if markers.iter().any(|marker| error.contains(marker)) {
            return class;
        }
    }
    if error.contains("DNS port ") && error.contains(":53 is unavailable") {
        return "dnsListenerConflict";
    }
    "unknown"
}

pub(crate) fn render(error: &str, service: Option<&ProtocolInfo>) -> String {
    let installed = fingerprint(service.and_then(|info| info.connection_source_fingerprint.as_deref()));
    let capability = service
        .map(|info| {
            if info.fresh_protection_proof {
                "supported"
            } else {
                "missing"
            }
        })
        .unwrap_or("unknown");
    format!(
        "Failure class: {}\nConnection source IDs (diagnostic only, not signatures): App: {}; Service: {}\nLater Service fresh-proof capability: {}",
        failure_class(error),
        fingerprint(Some(APP_SOURCE)),
        installed,
        capability
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_ids_are_bounded_and_missing_or_arbitrary_service_text_is_not_copied() {
        assert_ne!(fingerprint(Some(APP_SOURCE)), "unknown");
        let mut info = ProtocolInfo::current();
        info.connection_source_fingerprint = Some("private arbitrary endpoint credential material".into());
        let text = render("unknown problem", Some(&info));
        assert!(text.contains("Service: unknown"));
        assert!(!text.contains("private arbitrary"));
        assert!(text.len() < 400);
        info.connection_source_fingerprint = None;
        info.fresh_protection_proof = false;
        assert!(render("unknown problem", Some(&info)).contains("Failure class: unknown"));
        assert!(render("unknown problem", Some(&info)).contains("capability: missing"));
        assert!(render("unknown problem", None).contains("capability: unknown"));
    }

    #[test]
    fn specific_local_failures_do_not_become_generic_node_or_timeout_failures() {
        for (error, expected) in [
            (
                "TONO_SERVICE_NOT_RUNNING: service protocol version does not match",
                "serviceCompatibility",
            ),
            (
                "TONO_SERVICE_NOT_RUNNING: Windows named-pipe server does not match the registered LocalSystem service process",
                "serviceIdentity",
            ),
            ("TONO_SERVICE_NOT_RUNNING: TONO_BFE_NOT_RUNNING", "wfpUnavailable"),
            ("TONO_TUN_WAIT_EXHAUSTED", "tunNotReady"),
            ("DNS port <ip>:53 is unavailable (TCP busy)", "dnsListenerConflict"),
            ("TONO_DNS_UNVERIFIED: active adapter", "dnsNativeUnproven"),
            ("fake-ip verification failed: no answer", "dnsFakeIpUnproven"),
            ("TONO_PROTECTION_COMMIT_UNCERTAIN", "protectionCommitUncertain"),
            ("home routing changed before admission DNS repair", "homeRoutingChanged"),
            (
                "all 3 independent protected TUN probes failed",
                "legacyExternalProbeGate",
            ),
            ("RPC timeout", "unknown"),
            ("error sending request", "unknown"),
            ("TLS access denied", "unknown"),
        ] {
            assert_eq!(failure_class(error), expected);
        }
    }

    #[test]
    fn diagnostic_ids_and_classes_are_not_admission_or_runtime_adoption_proofs() {
        for source in [
            include_str!("connection/stages.rs"),
            include_str!("connection/cleanup.rs"),
            include_str!("connection/monitor.rs"),
            include_str!("connection/reconnect.rs"),
        ] {
            assert!(!source.contains("connection_source_fingerprint"));
            assert!(!source.contains("diagnostic_contract::"));
        }
        let reconnect = include_str!("connection/reconnect.rs");
        let candidate = reconnect
            .split("async fn active_runtime_resume_status()")
            .nth(1)
            .unwrap()
            .split("/// Schedule")
            .next()
            .unwrap();
        assert!(!candidate.contains("connect_succeeded"));
        let stages = include_str!("connection/stages.rs");
        assert!(stages.contains("commit_protection_cancellation_safe(state, generation"));
        assert!(stages.contains("verify_fake_ip_with_repair(||"));
    }
}
