//! Shared protected-connection verdict.
//!
//! Controller `/delay` is advisory. Real App HTTPS through system DNS and the
//! locked TUN owns Connected. Mixed-proxy success is diagnostic only.

use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedFailureCode {
    ProbeOriginDegraded,
    ProtectedDnsNotReady,
    TunRouteUnavailable,
    CoreControllerUnavailable,
    CoreExitUnreachable,
    NetworkEnvironmentOffline,
    HelperProtocolMismatch,
    UpdateRecoveryFailed,
    CatalogNodeRemoved,
    UnknownClassifiedFailure,
}

impl ProtectedFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProbeOriginDegraded => "PROBE_ORIGIN_DEGRADED",
            Self::ProtectedDnsNotReady => "PROTECTED_DNS_NOT_READY",
            Self::TunRouteUnavailable => "TUN_ROUTE_UNAVAILABLE",
            Self::CoreControllerUnavailable => "CORE_CONTROLLER_UNAVAILABLE",
            Self::CoreExitUnreachable => "CORE_EXIT_UNREACHABLE",
            Self::NetworkEnvironmentOffline => "NETWORK_ENVIRONMENT_OFFLINE",
            Self::HelperProtocolMismatch => "HELPER_PROTOCOL_MISMATCH",
            Self::UpdateRecoveryFailed => "UPDATE_RECOVERY_FAILED",
            Self::CatalogNodeRemoved => "CATALOG_NODE_REMOVED",
            Self::UnknownClassifiedFailure => "UNKNOWN_CLASSIFIED_FAILURE",
        }
    }

    pub fn user_message_zh(self) -> &'static str {
        match self {
            Self::ProbeOriginDegraded => "个别探测来源暂时失败，受保护连接仍然可用。",
            Self::ProtectedDnsNotReady => "系统 DNS 尚未进入受保护路径，连接未能完成。",
            Self::TunRouteUnavailable => "受保护隧道已建立，但系统流量未能进入隧道。",
            Self::CoreControllerUnavailable => {
                "核心控制器暂时不可用。若真实流量正常，连接会保持。"
            }
            Self::CoreExitUnreachable => "当前节点和核心均无法完成受保护验证。",
            Self::NetworkEnvironmentOffline => {
                "当前物理网络不可用。网络恢复后会自动继续保护。"
            }
            Self::HelperProtocolMismatch => "网络助手协议不匹配，需要先完成助手修复。",
            Self::UpdateRecoveryFailed => "更新后的受保护连接未能恢复。",
            Self::CatalogNodeRemoved => "所选节点已从目录移除，正在改用可用节点。",
            Self::UnknownClassifiedFailure => "受保护连接失败，已记录诊断信息。",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TunProbeOrigin {
    pub label: &'static str,
    pub url: &'static str,
    pub expected_status: u16,
}

pub const TUN_PROBE_ORIGINS: [TunProbeOrigin; 3] = [
    TunProbeOrigin {
        label: "Google",
        url: "https://www.gstatic.com/generate_204",
        expected_status: 204,
    },
    TunProbeOrigin {
        label: "Cloudflare",
        url: "https://cp.cloudflare.com/generate_204",
        expected_status: 204,
    },
    TunProbeOrigin {
        label: "Apple",
        url: "https://www.apple.com/library/test/success.html",
        expected_status: 200,
    },
];

/// How often a still-unverified session retries the exit probe after the
/// 120 s escalate window. Same cadence as the connected-lifetime monitor.
pub const EXIT_PROBE_INTERVAL: Duration = Duration::from_secs(120);
/// First *retry* after the Connected-time zero-delay probe fails.
pub const UNVERIFIED_PROBE_INITIAL: Duration = Duration::from_secs(5);
/// Cap of the pre-success doubling ladder.
pub const UNVERIFIED_PROBE_MAX: Duration = Duration::from_secs(30);
/// After this much time still unverified, fall back to [`EXIT_PROBE_INTERVAL`].
pub const UNVERIFIED_PROBE_ESCALATE_AFTER: Duration = Duration::from_secs(120);

/// Next wait before an unverified exit retest. `last_delay` is the delay that
/// just elapsed (`None` before the Connected-time probe). Ladder is 0, 5, 10,
/// 20, 30 s, then [`EXIT_PROBE_INTERVAL`] after [`UNVERIFIED_PROBE_ESCALATE_AFTER`].
/// There is never a second concurrent probe: the caller must not start one
/// while another is in flight.
pub fn next_unverified_probe_delay(
    unverified_for: Duration,
    last_delay: Option<Duration>,
) -> Duration {
    if unverified_for >= UNVERIFIED_PROBE_ESCALATE_AFTER {
        return EXIT_PROBE_INTERVAL;
    }
    match last_delay {
        None => Duration::ZERO,
        Some(previous) => previous
            .saturating_mul(2)
            .clamp(UNVERIFIED_PROBE_INITIAL, UNVERIFIED_PROBE_MAX),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PostLockDecision<T> {
    Connected {
        status: T,
        controller_advisory: Option<String>,
    },
    /// Lock is up; third-party exit probes did not prove egress.
    /// Callers must keep the barrier and must not `plan_failure`.
    ConnectedUnverified {
        code: ProtectedFailureCode,
        error: String,
    },
}

pub fn classify_post_lock<T>(
    controller: Result<(), String>,
    data_plane: Result<T, String>,
) -> PostLockDecision<T> {
    match (controller, data_plane) {
        (Ok(()), Ok(status)) => PostLockDecision::Connected {
            status,
            controller_advisory: None,
        },
        (Err(error), Ok(status)) => PostLockDecision::Connected {
            status,
            controller_advisory: Some(error),
        },
        (Ok(()), Err(error)) => PostLockDecision::ConnectedUnverified {
            code: ProtectedFailureCode::TunRouteUnavailable,
            error,
        },
        (Err(controller), Err(data_plane)) => PostLockDecision::ConnectedUnverified {
            code: ProtectedFailureCode::CoreExitUnreachable,
            error: format!(
                "controller exit measurement failed: {controller}; real TUN data plane failed: {data_plane}"
            ),
        },
    }
}

pub fn classify_exhausted_data_plane(
    controller: Result<(), String>,
    data_plane: String,
    mixed: Result<(), String>,
    network_offline: bool,
) -> (ProtectedFailureCode, String) {
    if network_offline {
        return (
            ProtectedFailureCode::NetworkEnvironmentOffline,
            format!("physical network unavailable; TUN={data_plane}"),
        );
    }
    match (controller, mixed) {
        (Ok(()), Ok(())) => (
            ProtectedFailureCode::TunRouteUnavailable,
            format!(
                "controller and mixed proxy succeeded; real TUN failed: {data_plane}"
            ),
        ),
        (Err(controller), Ok(())) => (
            ProtectedFailureCode::TunRouteUnavailable,
            format!(
                "mixed proxy succeeded; controller={controller}; TUN={data_plane}"
            ),
        ),
        (Ok(()), Err(proxy)) => (
            ProtectedFailureCode::TunRouteUnavailable,
            format!("controller succeeded; TUN={data_plane}; mixed={proxy}"),
        ),
        (Err(controller), Err(proxy)) => (
            ProtectedFailureCode::CoreExitUnreachable,
            format!("controller={controller}; TUN={data_plane}; mixed={proxy}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn controller_failure_with_real_tun_stays_connected() {
        let decision = classify_post_lock::<u8>(Err("504".into()), Ok(1));
        assert_eq!(
            decision,
            PostLockDecision::Connected {
                status: 1,
                controller_advisory: Some("504".into()),
            }
        );
    }

    #[test]
    fn controller_success_without_tun_is_connected_unverified() {
        let decision = classify_post_lock::<u8>(Ok(()), Err("all origins failed".into()));
        match decision {
            PostLockDecision::ConnectedUnverified { code, error } => {
                assert_eq!(code, ProtectedFailureCode::TunRouteUnavailable);
                assert!(error.contains("all origins failed"));
            }
            other => panic!("TUN failure after lock must stay connected unverified, got {other:?}"),
        }
    }

    #[test]
    fn controller_and_tun_failure_is_connected_unverified_core_exit() {
        let decision = classify_post_lock::<u8>(
            Err("delay 503".into()),
            Err("tls handshake eof".into()),
        );
        match decision {
            PostLockDecision::ConnectedUnverified { code, error } => {
                assert_eq!(code, ProtectedFailureCode::CoreExitUnreachable);
                assert!(error.contains("delay 503"));
                assert!(error.contains("tls handshake eof"));
            }
            other => panic!("expected ConnectedUnverified, got {other:?}"),
        }
    }

    #[test]
    fn unverified_probe_backoff_doubles_then_escalates() {
        assert_eq!(
            next_unverified_probe_delay(Duration::ZERO, None),
            Duration::ZERO
        );
        assert_eq!(
            next_unverified_probe_delay(Duration::ZERO, Some(Duration::ZERO)),
            UNVERIFIED_PROBE_INITIAL
        );
        assert_eq!(
            next_unverified_probe_delay(Duration::from_secs(5), Some(Duration::from_secs(5))),
            Duration::from_secs(10)
        );
        assert_eq!(
            next_unverified_probe_delay(Duration::from_secs(15), Some(Duration::from_secs(10))),
            Duration::from_secs(20)
        );
        assert_eq!(
            next_unverified_probe_delay(Duration::from_secs(40), Some(Duration::from_secs(20))),
            UNVERIFIED_PROBE_MAX
        );
        assert_eq!(
            next_unverified_probe_delay(Duration::from_secs(40), Some(Duration::from_secs(30))),
            UNVERIFIED_PROBE_MAX
        );
        assert_eq!(
            next_unverified_probe_delay(UNVERIFIED_PROBE_ESCALATE_AFTER, Some(Duration::from_secs(30))),
            EXIT_PROBE_INTERVAL
        );
        assert_eq!(
            next_unverified_probe_delay(
                UNVERIFIED_PROBE_ESCALATE_AFTER + Duration::from_secs(1),
                None
            ),
            EXIT_PROBE_INTERVAL
        );
    }

    #[test]
    fn mixed_proxy_cannot_replace_tun() {
        let (code, detail) = classify_exhausted_data_plane(
            Ok(()),
            "all 3 origins failed".into(),
            Ok(()),
            false,
        );
        assert_eq!(code, ProtectedFailureCode::TunRouteUnavailable);
        assert!(detail.contains("mixed proxy succeeded"));
    }

    #[test]
    fn three_independent_https_origins() {
        assert_eq!(TUN_PROBE_ORIGINS.len(), 3);
        let mut hosts = std::collections::BTreeSet::new();
        for origin in TUN_PROBE_ORIGINS {
            assert!(origin.url.starts_with("https://"));
            let host = origin.url.split('/').nth(2).unwrap();
            hosts.insert(host);
            assert!((200..300).contains(&origin.expected_status));
        }
        assert_eq!(hosts.len(), 3);
    }

    #[test]
    fn offline_is_classified_without_core_restart() {
        let (code, _) = classify_exhausted_data_plane(
            Err("timeout".into()),
            "timeout".into(),
            Err("timeout".into()),
            true,
        );
        assert_eq!(code, ProtectedFailureCode::NetworkEnvironmentOffline);
    }
}
