//! Customer failure codes for sign-in, verification, and connect.
//!
//! The existing telemetry poster copies the first `TONO_` / `CORE_` token.
//! This module only names that token and the stage. It does not upload.
//!
//! Auth recovery is a list of HTTP attempts. None of them install a filter,
//! change system DNS, or replace a route. After those attempts are exhausted,
//! [`crate::network_disposition`] decides: strict kill switch, selective AI
//! hold when that hook is ready, otherwise fail-open.

use std::{net::Ipv4Addr, time::Duration};

use crate::auth::{ApiError, TransportKind};
use crate::node::is_public_ipv4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureStage {
    Dns,
    Tcp,
    Tls,
    Quic,
    Auth,
    Api,
    Timeout,
    Clock,
    Captive,
    LocalConflict,
    Tunnel,
}

impl FailureStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dns => "dns",
            Self::Tcp => "tcp",
            Self::Tls => "tls",
            Self::Quic => "quic",
            Self::Auth => "auth",
            Self::Api => "api",
            Self::Timeout => "timeout",
            Self::Clock => "clock",
            Self::Captive => "captive",
            Self::LocalConflict => "local_conflict",
            Self::Tunnel => "tunnel",
        }
    }
}

/// Wire tokens. Keep these stable: support copy and telemetry match them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CustomerFailureCode {
    AuthDns,
    AuthTcp,
    AuthTls,
    AuthQuic,
    AuthTimeout,
    AuthClock,
    AuthCaptive,
    /// H21-O-F8: the system trust store refused the control plane's
    /// certificate for its issuer, signature or name.
    AuthTlsIntercepted,
    AuthApi,
    AuthRateLimited,
    AuthDeviceLimit,
    AuthInvalidCode,
    AuthUnauthorized,
    AuthForbidden,
    AuthLocalConflict,
    AuthUnreachable,
    AuthStore,
    ConnectDns,
    ConnectTcp,
    ConnectTls,
    ConnectQuic,
    ConnectTimeout,
    ConnectTun,
    ConnectCaptive,
    ConnectLocalConflict,
    UnknownClassified,
}

impl CustomerFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AuthDns => "TONO_AUTH_DNS",
            Self::AuthTcp => "TONO_AUTH_TCP",
            Self::AuthTls => "TONO_AUTH_TLS",
            Self::AuthQuic => "TONO_AUTH_QUIC",
            Self::AuthTimeout => "TONO_AUTH_TIMEOUT",
            Self::AuthClock => "TONO_CLOCK_SKEW",
            Self::AuthCaptive => "TONO_AUTH_CAPTIVE",
            Self::AuthTlsIntercepted => crate::network_interference::TLS_INTERCEPTED,
            Self::AuthApi => "TONO_AUTH_API",
            Self::AuthRateLimited => "TONO_AUTH_RATE_LIMITED",
            Self::AuthDeviceLimit => "TONO_AUTH_DEVICE_LIMIT",
            Self::AuthInvalidCode => "TONO_AUTH_INVALID_CODE",
            Self::AuthUnauthorized => "TONO_AUTH_UNAUTHORIZED",
            Self::AuthForbidden => "TONO_AUTH_FORBIDDEN",
            Self::AuthLocalConflict => "TONO_AUTH_LOCAL_CONFLICT",
            Self::AuthUnreachable => "TONO_AUTH_UNREACHABLE",
            Self::AuthStore => "TONO_AUTH_STORE",
            Self::ConnectDns => "TONO_CONNECT_DNS",
            Self::ConnectTcp => "TONO_CONNECT_TCP",
            Self::ConnectTls => "TONO_CONNECT_TLS",
            Self::ConnectQuic => "TONO_CONNECT_QUIC",
            Self::ConnectTimeout => "TONO_CONNECT_TIMEOUT",
            Self::ConnectTun => "TONO_CONNECT_TUN",
            Self::ConnectCaptive => "TONO_CONNECT_CAPTIVE",
            Self::ConnectLocalConflict => "TONO_CONNECT_LOCAL_CONFLICT",
            Self::UnknownClassified => "UNKNOWN_CLASSIFIED_FAILURE",
        }
    }

    pub fn stage(self) -> FailureStage {
        match self {
            Self::AuthDns | Self::ConnectDns => FailureStage::Dns,
            Self::AuthTcp | Self::ConnectTcp => FailureStage::Tcp,
            Self::AuthTls | Self::AuthTlsIntercepted | Self::ConnectTls => FailureStage::Tls,
            Self::AuthQuic | Self::ConnectQuic => FailureStage::Quic,
            Self::AuthTimeout | Self::ConnectTimeout => FailureStage::Timeout,
            Self::AuthClock => FailureStage::Clock,
            Self::AuthCaptive | Self::ConnectCaptive => FailureStage::Captive,
            Self::AuthApi => FailureStage::Api,
            Self::AuthRateLimited
            | Self::AuthDeviceLimit
            | Self::AuthInvalidCode
            | Self::AuthUnauthorized
            | Self::AuthForbidden => FailureStage::Auth,
            Self::AuthLocalConflict | Self::ConnectLocalConflict => FailureStage::LocalConflict,
            Self::AuthUnreachable | Self::AuthStore | Self::UnknownClassified => FailureStage::Auth,
            Self::ConnectTun => FailureStage::Tunnel,
        }
    }
}

/// Short sentence for a surface that has no locale table. The support code
/// is the only specific token. It does not tell the person to change network,
/// server, clock, or settings.
pub fn customer_message(code: CustomerFailureCode) -> String {
    format!(
        "That didn't complete. Support code {}.",
        code.as_str()
    )
}

pub fn auth_support_prefix(err: &ApiError) -> &'static str {
    match err {
        ApiError::Transport { message, .. } if message.contains("TONO_CLOCK_SKEW") => {
            CustomerFailureCode::AuthClock.as_str()
        }
        ApiError::Transport { kind, message } => classify_auth_transport(*kind, message).as_str(),
        ApiError::RateLimited => CustomerFailureCode::AuthRateLimited.as_str(),
        ApiError::DeviceLimit => CustomerFailureCode::AuthDeviceLimit.as_str(),
        ApiError::Unauthorized => CustomerFailureCode::AuthUnauthorized.as_str(),
        ApiError::InvalidOrExpiredCode => CustomerFailureCode::AuthInvalidCode.as_str(),
        ApiError::Forbidden => CustomerFailureCode::AuthForbidden.as_str(),
        ApiError::Credentials(_) => CustomerFailureCode::AuthStore.as_str(),
        ApiError::Server { status, message } if *status == 511 || is_captive(message) => {
            CustomerFailureCode::AuthCaptive.as_str()
        }
        ApiError::Server { .. }
        | ApiError::ExitIdentityPropagating
        | ApiError::NotFound
        | ApiError::InvalidResponse => {
            CustomerFailureCode::AuthApi.as_str()
        }
        ApiError::InvalidConfiguration | ApiError::InvalidInput(_) => {
            CustomerFailureCode::AuthUnreachable.as_str()
        }
    }
}

pub fn classify_auth_transport(kind: TransportKind, message: &str) -> CustomerFailureCode {
    if message.contains("TONO_CLOCK_SKEW") {
        return CustomerFailureCode::AuthClock;
    }
    if is_captive(message) {
        return CustomerFailureCode::AuthCaptive;
    }
    if message.contains(crate::network_interference::TLS_INTERCEPTED) {
        return CustomerFailureCode::AuthTlsIntercepted;
    }
    if is_local_conflict(message) {
        return CustomerFailureCode::AuthLocalConflict;
    }
    if is_quic(message) {
        return CustomerFailureCode::AuthQuic;
    }
    match kind {
        TransportKind::Dns => CustomerFailureCode::AuthDns,
        TransportKind::Connect => CustomerFailureCode::AuthTcp,
        TransportKind::Tls => CustomerFailureCode::AuthTls,
        TransportKind::Timeout => CustomerFailureCode::AuthTimeout,
        TransportKind::Other => CustomerFailureCode::AuthUnreachable,
    }
}

/// Prefix a connect error that does not already carry a telemetry token.
pub fn stamp_connect_failure(text: &str) -> String {
    if has_wire_token(text) {
        return text.to_string();
    }
    let code = classify_connect_text(text);
    format!("{}: {text}", code.as_str())
}

pub fn classify_connect_text(text: &str) -> CustomerFailureCode {
    let lower = text.to_lowercase();
    if is_captive(&lower) {
        return CustomerFailureCode::ConnectCaptive;
    }
    if is_local_conflict(&lower) {
        return CustomerFailureCode::ConnectLocalConflict;
    }
    if is_quic(&lower) {
        return CustomerFailureCode::ConnectQuic;
    }
    if lower.contains("certificate") || lower.contains("tls") || lower.contains("handshake") {
        return CustomerFailureCode::ConnectTls;
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return CustomerFailureCode::ConnectTimeout;
    }
    if lower.contains("dns") || lower.contains("no such host") || lower.contains("resolve") {
        return CustomerFailureCode::ConnectDns;
    }
    if lower.contains("tun") || lower.contains("wintun") {
        return CustomerFailureCode::ConnectTun;
    }
    if lower.contains("refused") || lower.contains("connect") || lower.contains("reset") {
        return CustomerFailureCode::ConnectTcp;
    }
    CustomerFailureCode::UnknownClassified
}

fn has_wire_token(text: &str) -> bool {
    text.split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
        .any(|token| {
            (token.starts_with("TONO_") || token.starts_with("CORE_")) && token.len() > 5
        })
}

fn is_captive(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("captive") || lower.contains("http 511") || lower.contains("status 511")
}

fn is_local_conflict(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("firewall")
        || lower.contains("another vpn")
        || lower.contains("other vpn")
        || lower.contains("wfp")
        || lower.contains("clash")
}

fn is_quic(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("quic") || lower.contains("hy2") || lower.contains("hysteria")
}

/// HTTP attempts only. `affects_system_network` is false for every step:
/// nothing here installs WFP/PF, writes system DNS, or replaces a route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthRecoveryStep {
    PinnedDirect,
    SystemDns,
    Doh,
    AlternatePort(u16),
    /// An already-running loopback mixed port. Creating the tunnel is not
    /// this step; a missing port omits it.
    ExistingLoopbackTunnel,
}

impl AuthRecoveryStep {
    pub fn affects_system_network(self) -> bool {
        false
    }
}

/// Order: pinned direct, system DNS, DoH, alternate ports, existing tunnel.
/// The tunnel is last and only when one is already up.
pub fn auth_recovery_plan(alternate_ports: &[u16], tunnel_available: bool) -> Vec<AuthRecoveryStep> {
    let mut steps = vec![
        AuthRecoveryStep::PinnedDirect,
        AuthRecoveryStep::SystemDns,
        AuthRecoveryStep::Doh,
    ];
    for port in alternate_ports {
        if *port != 443 {
            steps.push(AuthRecoveryStep::AlternatePort(*port));
        }
    }
    if tunnel_available {
        steps.push(AuthRecoveryStep::ExistingLoopbackTunnel);
    }
    steps
}

/// Delay before attempt `index`. The first attempt waits nothing.
pub fn backoff_before(index: usize) -> Duration {
    match index {
        0 => Duration::ZERO,
        1 => Duration::from_millis(200),
        2 => Duration::from_millis(400),
        _ => Duration::from_millis(800),
    }
}

/// Public A answers from a DNS-over-HTTPS JSON body. Private and reserved
/// addresses are dropped so a poisoned answer cannot retarget the client.
pub fn parse_doh_json_answers(body: &str) -> Vec<Ipv4Addr> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let Some(answers) = json.get("Answer").and_then(|value| value.as_array()) else {
        return Vec::new();
    };
    let mut addresses = Vec::new();
    for answer in answers {
        if answer.get("type").and_then(|value| value.as_u64()) != Some(1) {
            continue;
        }
        let Some(data) = answer.get("data").and_then(|value| value.as_str()) else {
            continue;
        };
        let Ok(ip) = data.parse::<Ipv4Addr>() else {
            continue;
        };
        if is_public_ipv4(ip) {
            addresses.push(ip);
        }
    }
    addresses
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DohResolver {
    pub name: &'static str,
    pub host: &'static str,
    /// Pinned addresses. The lookup does not ask the system resolver.
    pub ipv4: &'static [Ipv4Addr],
}

const ALIDNS_V4: [Ipv4Addr; 2] = [
    Ipv4Addr::new(223, 5, 5, 5),
    Ipv4Addr::new(223, 6, 6, 6),
];
const DNSPOD_V4: [Ipv4Addr; 2] = [
    Ipv4Addr::new(1, 12, 12, 12),
    Ipv4Addr::new(120, 53, 53, 53),
];
const CLOUDFLARE_V4: [Ipv4Addr; 2] = [
    Ipv4Addr::new(1, 1, 1, 1),
    Ipv4Addr::new(1, 0, 0, 1),
];
const GOOGLE_V4: [Ipv4Addr; 2] = [Ipv4Addr::new(8, 8, 8, 8), Ipv4Addr::new(8, 8, 4, 4)];

/// Resolvers raced by the auth DoH fallback. AliDNS and DNSPod are reachable
/// from mainland China; Cloudflare and Google cover networks where those are
/// not. Order is a label only: the first public answer wins.
pub fn doh_resolvers() -> &'static [DohResolver] {
    const RESOLVERS: &[DohResolver] = &[
        DohResolver {
            name: "alidns",
            host: "dns.alidns.com",
            ipv4: &ALIDNS_V4,
        },
        DohResolver {
            name: "dnspod",
            host: "doh.pub",
            ipv4: &DNSPOD_V4,
        },
        DohResolver {
            name: "cloudflare",
            host: "cloudflare-dns.com",
            ipv4: &CLOUDFLARE_V4,
        },
        DohResolver {
            name: "google",
            host: "dns.google",
            ipv4: &GOOGLE_V4,
        },
    ];
    RESOLVERS
}

/// First non-empty public A set, in completion order. Failed lookups and
/// private answers are skipped. This does not read or write system DNS.
pub fn first_public_doh_answer(
    results_in_completion_order: &[Option<Vec<Ipv4Addr>>],
) -> Option<Vec<Ipv4Addr>> {
    results_in_completion_order.iter().find_map(|result| {
        let ips = result.as_ref()?;
        let public: Vec<Ipv4Addr> = ips
            .iter()
            .copied()
            .filter(|ip| is_public_ipv4(*ip))
            .collect();
        if public.is_empty() { None } else { Some(public) }
    })
}

/// Extra HTTPS names on the API certificate. Empty until the backend
/// publishes a CDN front on that same certificate. Callers must not invent
/// a front: SNI has to match a name the server presents. Recovery stays on
/// the pinned API addresses and DoH answers for `api.afk.ccwu.cc`.
pub fn extra_api_front_hosts() -> &'static [&'static str] {
    &[]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkDisposition {
    /// Put the machine back on the network it had before this attempt.
    FailOpen,
    /// The user turned on a strict kill switch. Leave that block in place.
    KeepStrictBlock,
    /// General traffic released; AI-service traffic stays blocked.
    /// The hook already rewrote filters. Callers must not full-release.
    SelectiveFailOpen,
}

/// Wrapper around [`crate::network_disposition::exhausted_protection`].
/// That function is the only policy. Strict means the user chose `permanent`.
pub fn disposition_after_exhausted_failure(strict_kill_switch_explicit: bool) -> NetworkDisposition {
    match crate::network_disposition::exhausted_protection(strict_kill_switch_explicit) {
        crate::network_disposition::ExhaustedProtection::KeepStrictBlock => {
            NetworkDisposition::KeepStrictBlock
        }
        crate::network_disposition::ExhaustedProtection::ReleaseGeneralKeepAi => {
            NetworkDisposition::SelectiveFailOpen
        }
        crate::network_disposition::ExhaustedProtection::ReleaseOriginalNetwork => {
            NetworkDisposition::FailOpen
        }
    }
}

pub fn strict_kill_switch_explicit(mode: Option<&str>) -> bool {
    matches!(mode, Some(mode) if mode.eq_ignore_ascii_case("permanent"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message_has_no_self_help(text: &str) {
        let lower = text.to_lowercase();
        for phrase in [
            "try another network",
            "switch server",
            "check your connection",
            "hotspot",
            "choose another route",
            "换节点",
            "检查网络",
            "换可用网络",
        ] {
            assert!(!lower.contains(phrase), "{text} contains {phrase}");
        }
    }

    #[test]
    fn auth_dns_code_names_the_dns_stage() {
        let code = classify_auth_transport(TransportKind::Dns, "no such host");
        assert_eq!(code, CustomerFailureCode::AuthDns);
        assert_eq!(code.as_str(), "TONO_AUTH_DNS");
        assert_eq!(code.stage(), FailureStage::Dns);
        message_has_no_self_help(&customer_message(code));
    }

    #[test]
    fn auth_tcp_code_names_the_tcp_stage() {
        let code = classify_auth_transport(TransportKind::Connect, "connection refused");
        assert_eq!(code, CustomerFailureCode::AuthTcp);
        assert_eq!(code.stage(), FailureStage::Tcp);
        message_has_no_self_help(&customer_message(code));
    }

    #[test]
    fn auth_tls_code_names_the_tls_stage() {
        let code = classify_auth_transport(TransportKind::Tls, "certificate verify failed");
        assert_eq!(code, CustomerFailureCode::AuthTls);
        assert_eq!(code.stage(), FailureStage::Tls);
        message_has_no_self_help(&customer_message(code));
    }

    #[test]
    fn auth_timeout_code_names_the_timeout_stage() {
        let code = classify_auth_transport(TransportKind::Timeout, "request timed out");
        assert_eq!(code, CustomerFailureCode::AuthTimeout);
        assert_eq!(code.stage(), FailureStage::Timeout);
    }

    #[test]
    fn auth_clock_code_stays_the_existing_token() {
        let code = classify_auth_transport(TransportKind::Tls, "TONO_CLOCK_SKEW: certificate expired");
        assert_eq!(code.as_str(), "TONO_CLOCK_SKEW");
        assert_eq!(code.stage(), FailureStage::Clock);
    }

    #[test]
    fn auth_captive_code_names_the_captive_stage() {
        let code = classify_auth_transport(TransportKind::Other, "captive portal");
        assert_eq!(code, CustomerFailureCode::AuthCaptive);
        assert_eq!(code.stage(), FailureStage::Captive);
    }

    #[test]
    fn auth_quic_code_names_the_quic_stage() {
        let code = classify_auth_transport(TransportKind::Other, "quic handshake timeout");
        assert_eq!(code, CustomerFailureCode::AuthQuic);
        assert_eq!(code.stage(), FailureStage::Quic);
    }

    #[test]
    fn auth_local_conflict_code_names_that_stage() {
        let code = classify_auth_transport(TransportKind::Connect, "blocked by local firewall");
        assert_eq!(code, CustomerFailureCode::AuthLocalConflict);
        assert_eq!(code.stage(), FailureStage::LocalConflict);
    }

    #[test]
    fn auth_api_status_uses_the_api_stage() {
        let err = ApiError::Server {
            status: 503,
            message: "unavailable".into(),
        };
        assert_eq!(auth_support_prefix(&err), "TONO_AUTH_API");
        assert_eq!(CustomerFailureCode::AuthApi.stage(), FailureStage::Api);
    }

    #[test]
    fn auth_api_511_is_captive() {
        let err = ApiError::Server {
            status: 511,
            message: "network auth".into(),
        };
        assert_eq!(auth_support_prefix(&err), "TONO_AUTH_CAPTIVE");
    }

    #[test]
    fn auth_rate_limit_keeps_its_token() {
        assert_eq!(
            auth_support_prefix(&ApiError::RateLimited),
            "TONO_AUTH_RATE_LIMITED"
        );
        assert_eq!(CustomerFailureCode::AuthRateLimited.stage(), FailureStage::Auth);
    }

    #[test]
    fn auth_device_limit_keeps_its_token() {
        assert_eq!(
            auth_support_prefix(&ApiError::DeviceLimit),
            "TONO_AUTH_DEVICE_LIMIT"
        );
    }

    #[test]
    fn auth_invalid_code_keeps_its_token() {
        assert_eq!(
            auth_support_prefix(&ApiError::InvalidOrExpiredCode),
            "TONO_AUTH_INVALID_CODE"
        );
    }

    #[test]
    fn auth_unauthorized_keeps_its_token() {
        assert_eq!(
            auth_support_prefix(&ApiError::Unauthorized),
            "TONO_AUTH_UNAUTHORIZED"
        );
    }

    #[test]
    fn connect_codes_name_each_stage() {
        assert_eq!(
            classify_connect_text("dns lookup failed"),
            CustomerFailureCode::ConnectDns
        );
        assert_eq!(
            classify_connect_text("connection refused"),
            CustomerFailureCode::ConnectTcp
        );
        assert_eq!(
            classify_connect_text("tls handshake eof"),
            CustomerFailureCode::ConnectTls
        );
        assert_eq!(
            classify_connect_text("hy2 handshake failed"),
            CustomerFailureCode::ConnectQuic
        );
        assert_eq!(
            classify_connect_text("dial timed out"),
            CustomerFailureCode::ConnectTimeout
        );
        assert_eq!(
            classify_connect_text("captive portal"),
            CustomerFailureCode::ConnectCaptive
        );
        assert_eq!(
            classify_connect_text("another vpn holds the adapter"),
            CustomerFailureCode::ConnectLocalConflict
        );
        assert_eq!(
            classify_connect_text("wintun did not come up"),
            CustomerFailureCode::ConnectTun
        );
        let stamped = stamp_connect_failure("connection refused");
        assert!(stamped.starts_with("TONO_CONNECT_TCP: "));
        message_has_no_self_help(&customer_message(CustomerFailureCode::ConnectTcp));
    }

    #[test]
    fn existing_wire_tokens_are_not_stamped_again() {
        let raw = "CORE_EXIT_UNREACHABLE: dial timeout";
        assert_eq!(stamp_connect_failure(raw), raw);
    }

    #[test]
    fn recovery_order_is_direct_then_doh_then_ports_then_tunnel() {
        let ports = [443_u16, 2053, 2083];
        let steps = auth_recovery_plan(&ports, true);
        assert_eq!(
            steps,
            vec![
                AuthRecoveryStep::PinnedDirect,
                AuthRecoveryStep::SystemDns,
                AuthRecoveryStep::Doh,
                AuthRecoveryStep::AlternatePort(2053),
                AuthRecoveryStep::AlternatePort(2083),
                AuthRecoveryStep::ExistingLoopbackTunnel,
            ]
        );
        assert!(steps.iter().all(|step| !step.affects_system_network()));
        assert_eq!(backoff_before(0), Duration::ZERO);
        assert!(backoff_before(1) < backoff_before(2));
        assert!(backoff_before(2) <= backoff_before(3));
    }

    #[test]
    fn recovery_without_a_tunnel_does_not_invent_one() {
        let steps = auth_recovery_plan(&[443, 8443], false);
        assert!(!steps.contains(&AuthRecoveryStep::ExistingLoopbackTunnel));
        assert!(steps.contains(&AuthRecoveryStep::AlternatePort(8443)));
        assert!(!steps.contains(&AuthRecoveryStep::AlternatePort(443)));
    }

    #[test]
    fn doh_parser_keeps_public_answers_only() {
        let body = r#"{"Answer":[
            {"type":1,"data":"104.20.26.170"},
            {"type":1,"data":"10.1.2.3"},
            {"type":1,"data":"127.0.0.1"},
            {"type":28,"data":"2606:4700::1"},
            {"type":1,"data":"not-an-ip"}
        ]}"#;
        assert_eq!(
            parse_doh_json_answers(body),
            vec!["104.20.26.170".parse::<Ipv4Addr>().unwrap()]
        );
        assert!(parse_doh_json_answers("not json").is_empty());
    }

    #[test]
    fn doh_race_keeps_the_first_public_answer_and_invents_no_front() {
        let resolvers = doh_resolvers();
        assert_eq!(
            resolvers.iter().map(|resolver| resolver.name).collect::<Vec<_>>(),
            vec!["alidns", "dnspod", "cloudflare", "google"]
        );
        assert_eq!(resolvers[0].host, "dns.alidns.com");
        assert_eq!(resolvers[0].ipv4, &ALIDNS_V4);
        assert_eq!(resolvers[1].host, "doh.pub");
        assert_eq!(resolvers[1].ipv4, &DNSPOD_V4);
        assert_eq!(resolvers[2].ipv4, &CLOUDFLARE_V4);
        assert_eq!(resolvers[3].ipv4, &GOOGLE_V4);
        assert!(resolvers
            .iter()
            .all(|resolver| resolver.ipv4.iter().copied().all(is_public_ipv4)));
        assert!(extra_api_front_hosts().is_empty());
        let ali: Ipv4Addr = "223.5.5.5".parse().unwrap();
        let poisoned = Some(vec!["10.0.0.1".parse().unwrap()]);
        let good = Some(vec![ali]);
        assert_eq!(
            first_public_doh_answer(&[None, poisoned.clone(), good]).as_deref(),
            Some([ali].as_slice())
        );
        assert!(first_public_doh_answer(&[None, poisoned]).is_none());
    }

    #[test]
    fn exhausted_failure_fail_opens_unless_strict() {
        assert_eq!(
            disposition_after_exhausted_failure(false),
            NetworkDisposition::FailOpen
        );
        assert_eq!(
            disposition_after_exhausted_failure(true),
            NetworkDisposition::KeepStrictBlock
        );
        assert!(!strict_kill_switch_explicit(None));
        assert!(!strict_kill_switch_explicit(Some("standard")));
        assert!(!strict_kill_switch_explicit(Some("disabled")));
        assert!(strict_kill_switch_explicit(Some("permanent")));
        assert!(strict_kill_switch_explicit(Some("Permanent")));
    }
}
