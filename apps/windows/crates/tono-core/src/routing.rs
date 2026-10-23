//! Desktop route explainer and hardened selective sing-box routing builder.
//!
//! Aligns desktop Three-Tier, Selective, and Global routing decisions and
//! anti-leak rules with `direct_domains.rs` (`MOBILE_HOME_AUX_SUFFIXES`,
//! `X_CLOUD_SUFFIXES`, `OVERSEAS_CLOUD_SUFFIXES`, `CLOUD_IPV4_CIDRS`,
//! `CLOUD_IPV6_CIDRS`, `STUN_UDP_PORTS`, `PUBLIC_STUN_SUFFIXES`,
//! `OVERSEAS_UDP_REJECT_IPV4_CIDRS`, `OVERSEAS_UDP_REJECT_IPV6_CIDRS`,
//! `ENCRYPTED_DNS_PORTS`).

use std::net::IpAddr;

use serde_json::{Value, json};

use crate::config::{self, ADDRESS_FREE_WEB_SUFFIXES};
use crate::direct_domains::{
    CLAUDE_HOME_DOMAINS, CLAUDE_HOME_IPV4_CIDRS, CLOUD_IPV4_CIDRS, CLOUD_IPV6_CIDRS,
    CLOUD_VIDEO_DOMAINS, DEDICATED_MODEL_API_SUFFIXES, ENCRYPTED_DNS_PORTS,
    MOBILE_HOME_AUX_SUFFIXES, OVERSEAS_CLOUD_SUFFIXES, OVERSEAS_UDP_REJECT_IPV4_CIDRS,
    OVERSEAS_UDP_REJECT_IPV6_CIDRS, PUBLIC_STUN_SUFFIXES, STUN_UDP_PORTS, X_CLOUD_SUFFIXES,
    cidr_contains_ipv4, is_claude_home_ipv4, is_cloud_exit_ipv4, is_cloud_exit_ipv6,
    is_overseas_udp_reject_ipv4, is_overseas_udp_reject_ipv6,
};
use crate::sing_box::{OwnedSingBoxRuntime, RuntimeInput, SingBoxError, build_runtime};
use crate::three_tier::{
    CHINA_DNS, DIRECT as THREE_TIER_DIRECT, HOME_DNS, cloud_exit_suffixes,
};

pub const THREE_TIER_DOMESTIC_EXACT: [&str; 10] = [
    "www.12306.cn",
    "kyfw.12306.cn",
    "www.bilibili.com",
    "api.bilibili.com",
    "www.jd.com",
    "www.taobao.com",
    "www.tmall.com",
    "www.meituan.com",
    "www.dianping.com",
    "www.amap.com",
];

pub const THREE_TIER_OVERSEAS_EXACT: [&str; 26] = [
    "www.wikipedia.org",
    "en.wikipedia.org",
    "www.mozilla.org",
    "www.kernel.org",
    "www.gnu.org",
    "www.debian.org",
    "www.microsoft.com",
    "www.cloudflare.com",
    "www.gstatic.com",
    "cp.cloudflare.com",
    "www.apple.com",
    "x.com",
    "www.x.com",
    "mobile.x.com",
    "api.x.com",
    "twitter.com",
    "www.twitter.com",
    "mobile.twitter.com",
    "api.twitter.com",
    "upload.twitter.com",
    "abs.twimg.com",
    "pbs.twimg.com",
    "video.twimg.com",
    "ton.twimg.com",
    "cdn.syndication.twimg.com",
    "t.co",
];

pub const PRIVATE_IPV4_CIDRS: [&str; 6] = [
    "127.0.0.0/8",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "100.64.0.0/10",
    "169.254.0.0/16",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopRoutingMode {
    ThreeTier,
    Selective,
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteTier {
    AiHome,
    CloudExit,
    DomesticDirect,
    PrivateDirect,
    DnsHijack,
    AntiLeakReject,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteConnection<'a> {
    pub network: &'a str,
    pub domain: Option<&'a str>,
    pub ip: Option<IpAddr>,
    pub port: u16,
    pub inbound: Option<&'a str>,
}

impl<'a> RouteConnection<'a> {
    pub fn tcp_domain(domain: &'a str, port: u16) -> Self {
        Self {
            network: "tcp",
            domain: Some(domain),
            ip: None,
            port,
            inbound: None,
        }
    }

    pub fn udp_domain(domain: &'a str, port: u16) -> Self {
        Self {
            network: "udp",
            domain: Some(domain),
            ip: None,
            port,
            inbound: None,
        }
    }

    pub fn tcp_ip(ip: IpAddr, port: u16) -> Self {
        Self {
            network: "tcp",
            domain: None,
            ip: Some(ip),
            port,
            inbound: None,
        }
    }

    pub fn udp_ip(ip: IpAddr, port: u16) -> Self {
        Self {
            network: "udp",
            domain: None,
            ip: Some(ip),
            port,
            inbound: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteVerdict {
    pub tier: RouteTier,
    pub action: &'static str,
    pub outbound: Option<&'static str>,
    pub dns_server: Option<&'static str>,
    pub reason: &'static str,
}

pub struct RouteExplainer;

impl RouteExplainer {
    pub fn explain(
        mode: DesktopRoutingMode,
        has_home_hop: bool,
        conn: &RouteConnection<'_>,
    ) -> RouteVerdict {
        let net = conn.network.trim().to_ascii_lowercase();
        let is_tcp = net.is_empty() || net == "tcp";
        let is_udp_or_icmp = net == "udp" || net == "icmp";
        let host = conn
            .domain
            .map(|d| d.trim().trim_end_matches('.').to_ascii_lowercase())
            .filter(|d| !d.is_empty());

        let direct_outbound = match mode {
            DesktopRoutingMode::ThreeTier => THREE_TIER_DIRECT,
            DesktopRoutingMode::Selective | DesktopRoutingMode::Global => config::DIRECT_GROUP_NAME,
        };
        let home_outbound = if has_home_hop {
            config::HOME_SOCKS5_OUTBOUND_NAME
        } else {
            "Tono-Exit"
        };
        let home_dns = match mode {
            DesktopRoutingMode::ThreeTier if has_home_hop => HOME_DNS,
            _ => "Tono-DoH",
        };

        // 1. IPv6 traffic on IPv4-only desktop TUN is rejected, and IPv6 overseas UDP/Cloud CIDRs
        // are explicitly classified for dual-stack inspection.
        if let Some(IpAddr::V6(v6)) = conn.ip {
            if is_udp_or_icmp && is_overseas_udp_reject_ipv6(v6) {
                return RouteVerdict {
                    tier: RouteTier::AntiLeakReject,
                    action: "reject",
                    outbound: None,
                    dns_server: None,
                    reason: "overseas-udp-ipv6-cidr-reject",
                };
            }
            if is_tcp && mode != DesktopRoutingMode::Global && is_cloud_exit_ipv6(v6) {
                return RouteVerdict {
                    tier: RouteTier::CloudExit,
                    action: "route",
                    outbound: Some("Tono-Exit"),
                    dns_server: Some("Tono-DoH"),
                    reason: "cloud-ipv6-cidr",
                };
            }
            return RouteVerdict {
                tier: RouteTier::AntiLeakReject,
                action: "reject",
                outbound: None,
                dns_server: None,
                reason: "ipv6-reject",
            };
        }

        // 2. DNS hijack (Tono-DNS inbound or port 53).
        if conn.inbound == Some("Tono-DNS") || conn.port == 53 {
            return RouteVerdict {
                tier: RouteTier::DnsHijack,
                action: "hijack-dns",
                outbound: None,
                dns_server: Some("Tono-DoH"),
                reason: "dns-hijack",
            };
        }

        // 3. Encrypted DNS (DoT/DoQ port 853) anti-leak reject.
        if ENCRYPTED_DNS_PORTS.contains(&conn.port) {
            return RouteVerdict {
                tier: RouteTier::AntiLeakReject,
                action: "reject",
                outbound: None,
                dns_server: None,
                reason: "encrypted-dns-port-reject",
            };
        }

        // 4. Google WebRTC STUN UDP port reject (19302..=19309).
        if is_udp_or_icmp && STUN_UDP_PORTS.contains(&conn.port) {
            return RouteVerdict {
                tier: RouteTier::AntiLeakReject,
                action: "reject",
                outbound: None,
                dns_server: None,
                reason: "stun-udp-port-reject",
            };
        }

        // 5. Public STUN/TURN suffix UDP/ICMP reject.
        if is_udp_or_icmp
            && let Some(ref h) = host
            && matches_suffix_slice(h, &PUBLIC_STUN_SUFFIXES)
        {
            return RouteVerdict {
                tier: RouteTier::AntiLeakReject,
                action: "reject",
                outbound: None,
                dns_server: None,
                reason: "public-stun-udp-reject",
            };
        }

        // 6. Overseas UDP/ICMP IPv4 CIDR reject (QUIC/HTTP3/STUN/voice leak prevention).
        if is_udp_or_icmp
            && let Some(IpAddr::V4(v4)) = conn.ip
            && is_overseas_udp_reject_ipv4(v4)
        {
            return RouteVerdict {
                tier: RouteTier::AntiLeakReject,
                action: "reject",
                outbound: None,
                dns_server: None,
                reason: "overseas-udp-ipv4-cidr-reject",
            };
        }

        // 7. Private/LAN IPv4 CIDRs in Three-Tier mode.
        if mode == DesktopRoutingMode::ThreeTier
            && let Some(IpAddr::V4(v4)) = conn.ip
            && PRIVATE_IPV4_CIDRS.iter().any(|cidr| cidr_contains_ipv4(cidr, v4))
        {
            return RouteVerdict {
                tier: RouteTier::PrivateDirect,
                action: "route",
                outbound: Some(direct_outbound),
                dns_server: None,
                reason: "private-cidr",
            };
        }

        // 8. Global mode: reject UDP/ICMP, route all TCP to Tono-Exit.
        if mode == DesktopRoutingMode::Global {
            if !is_tcp {
                return RouteVerdict {
                    tier: RouteTier::AntiLeakReject,
                    action: "reject",
                    outbound: None,
                    dns_server: None,
                    reason: "udp-icmp-reject",
                };
            }
            return RouteVerdict {
                tier: RouteTier::CloudExit,
                action: "route",
                outbound: Some("Tono-Exit"),
                dns_server: Some("Tono-DoH"),
                reason: "global-default",
            };
        }

        // 9. Dedicated Model Studio API namespaces precede Alibaba direct rules in Selective mode.
        if mode == DesktopRoutingMode::Selective
            && let Some(ref h) = host
            && matches_suffix_slice(h, &DEDICATED_MODEL_API_SUFFIXES)
        {
            if !is_tcp {
                return RouteVerdict {
                    tier: RouteTier::AntiLeakReject,
                    action: "reject",
                    outbound: None,
                    dns_server: None,
                    reason: "ai-home-udp-reject",
                };
            }
            return RouteVerdict {
                tier: RouteTier::CloudExit,
                action: "route",
                outbound: Some("Tono-Exit"),
                dns_server: Some("Tono-DoH"),
                reason: "dedicated-model-api",
            };
        }

        // 10. Cloud Video domains precede broad Home suffixes (e.g. googleapis.com).
        if let Some(ref h) = host
            && matches_suffix_slice(h, &CLOUD_VIDEO_DOMAINS)
        {
            if !is_tcp {
                return RouteVerdict {
                    tier: RouteTier::AntiLeakReject,
                    action: "reject",
                    outbound: None,
                    dns_server: None,
                    reason: "cloud-video-udp-reject",
                };
            }
            return RouteVerdict {
                tier: RouteTier::CloudExit,
                action: "route",
                outbound: Some("Tono-Exit"),
                dns_server: Some("Tono-DoH"),
                reason: "cloud-video-override",
            };
        }

        // 11. AI Home domains (CLAUDE_HOME_DOMAINS + MOBILE_HOME_AUX_SUFFIXES) and CLAUDE_HOME_IPV4_CIDRS.
        if let Some(ref h) = host
            && (matches_suffix_slice(h, &CLAUDE_HOME_DOMAINS)
                || matches_suffix_slice(h, &MOBILE_HOME_AUX_SUFFIXES))
        {
            if !is_tcp {
                return RouteVerdict {
                    tier: RouteTier::AntiLeakReject,
                    action: "reject",
                    outbound: None,
                    dns_server: None,
                    reason: "ai-home-udp-reject",
                };
            }
            let reason = if matches_suffix_slice(h, &CLAUDE_HOME_DOMAINS) {
                "ai-home-domain"
            } else {
                "ai-home-aux-domain"
            };
            return RouteVerdict {
                tier: RouteTier::AiHome,
                action: "route",
                outbound: Some(home_outbound),
                dns_server: Some(home_dns),
                reason,
            };
        }

        if let Some(IpAddr::V4(v4)) = conn.ip
            && is_claude_home_ipv4(v4)
        {
            if !is_tcp {
                return RouteVerdict {
                    tier: RouteTier::AntiLeakReject,
                    action: "reject",
                    outbound: None,
                    dns_server: None,
                    reason: "ai-home-cidr-udp-reject",
                };
            }
            return RouteVerdict {
                tier: RouteTier::AiHome,
                action: "route",
                outbound: Some(home_outbound),
                dns_server: Some(home_dns),
                reason: "ai-home-cidr",
            };
        }

        // 12. Overseas exact domains, X Cloud suffixes, Overseas Cloud suffixes, Public STUN suffixes,
        // and Telegram/Cloud IPv4 CIDRs -> Cloud Exit (Tono-Exit) on TCP, reject on UDP/ICMP.
        if let Some(ref h) = host {
            let is_overseas_exact = THREE_TIER_OVERSEAS_EXACT.contains(&h.as_str());
            let is_x_cloud = matches_suffix_slice(h, &X_CLOUD_SUFFIXES);
            let is_overseas_cloud = matches_suffix_slice(h, &OVERSEAS_CLOUD_SUFFIXES);
            let is_public_stun = matches_suffix_slice(h, &PUBLIC_STUN_SUFFIXES);
            if is_overseas_exact || is_x_cloud || is_overseas_cloud || is_public_stun {
                if !is_tcp {
                    return RouteVerdict {
                        tier: RouteTier::AntiLeakReject,
                        action: "reject",
                        outbound: None,
                        dns_server: None,
                        reason: "cloud-domain-udp-reject",
                    };
                }
                let reason = if is_x_cloud {
                    "x-cloud-domain"
                } else if is_overseas_cloud {
                    "overseas-cloud-domain"
                } else if is_public_stun {
                    "public-stun-tcp-cloud"
                } else {
                    "overseas-exact-domain"
                };
                return RouteVerdict {
                    tier: RouteTier::CloudExit,
                    action: "route",
                    outbound: Some("Tono-Exit"),
                    dns_server: Some("Tono-DoH"),
                    reason,
                };
            }
        }

        if let Some(IpAddr::V4(v4)) = conn.ip
            && is_cloud_exit_ipv4(v4)
        {
            if !is_tcp {
                return RouteVerdict {
                    tier: RouteTier::AntiLeakReject,
                    action: "reject",
                    outbound: None,
                    dns_server: None,
                    reason: "cloud-cidr-udp-reject",
                };
            }
            return RouteVerdict {
                tier: RouteTier::CloudExit,
                action: "route",
                outbound: Some("Tono-Exit"),
                dns_server: Some("Tono-DoH"),
                reason: "cloud-ipv4-cidr",
            };
        }

        // 13. Domestic direct domains and CIDRs.
        if let Some(ref h) = host {
            let is_domestic = match mode {
                DesktopRoutingMode::ThreeTier => {
                    THREE_TIER_DOMESTIC_EXACT.contains(&h.as_str())
                        || matches_suffix_slice(h, &ADDRESS_FREE_WEB_SUFFIXES)
                }
                DesktopRoutingMode::Selective => matches_suffix_slice(h, &ADDRESS_FREE_WEB_SUFFIXES),
                DesktopRoutingMode::Global => false,
            };
            if is_domestic {
                if !is_tcp {
                    return RouteVerdict {
                        tier: RouteTier::AntiLeakReject,
                        action: "reject",
                        outbound: None,
                        dns_server: None,
                        reason: "domestic-udp-reject",
                    };
                }
                return RouteVerdict {
                    tier: RouteTier::DomesticDirect,
                    action: "route",
                    outbound: Some(direct_outbound),
                    dns_server: Some(match mode {
                        DesktopRoutingMode::ThreeTier => CHINA_DNS,
                        _ => "Tono-Direct-DNS",
                    }),
                    reason: "domestic-domain",
                };
            }
        }



        // 14. Default fallback: reject UDP/ICMP, route TCP to Tono-Exit.
        if !is_tcp {
            return RouteVerdict {
                tier: RouteTier::AntiLeakReject,
                action: "reject",
                outbound: None,
                dns_server: None,
                reason: "udp-icmp-reject",
            };
        }
        RouteVerdict {
            tier: RouteTier::CloudExit,
            action: "route",
            outbound: Some("Tono-Exit"),
            dns_server: Some("Tono-DoH"),
            reason: "cloud-default",
        }
    }
}

fn matches_suffix_slice(host: &str, suffixes: &[&str]) -> bool {
    suffixes
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// Enriches a Selective-mode sing-box runtime JSON object with the anti-leak
/// and routing constants from `direct_domains.rs` (`ENCRYPTED_DNS_PORTS`,
/// `STUN_UDP_PORTS`, `PUBLIC_STUN_SUFFIXES`, `OVERSEAS_UDP_REJECT_IPV4_CIDRS`,
/// `OVERSEAS_UDP_REJECT_IPV6_CIDRS`, `MOBILE_HOME_AUX_SUFFIXES`,
/// `X_CLOUD_SUFFIXES`, `OVERSEAS_CLOUD_SUFFIXES`, `CLOUD_IPV4_CIDRS`,
/// `CLOUD_IPV6_CIDRS`).
pub fn apply_selective_anti_leak_and_routing(runtime: &mut Value, has_home_hop: bool) {
    let home_target = if has_home_hop {
        config::HOME_SOCKS5_OUTBOUND_NAME
    } else {
        "Tono-Exit"
    };
    let cloud_suffixes = cloud_exit_suffixes();

    if let Some(rules) = runtime
        .pointer_mut("/route/rules")
        .and_then(Value::as_array_mut)
    {
        // Insert DoT 853, STUN UDP, public STUN UDP, and overseas UDP CIDR reject rules
        // right after the port 53 hijack-dns rule.
        if let Some(dns_idx) = rules
            .iter()
            .position(|rule| rule.get("port").and_then(Value::as_u64) == Some(53))
        {
            let anti_leak = [
                json!({"port": ENCRYPTED_DNS_PORTS.as_slice(), "action": "reject"}),
                json!({"network": ["udp", "icmp"], "port": STUN_UDP_PORTS.as_slice(), "action": "reject"}),
                json!({"network": ["udp", "icmp"], "domain_suffix": PUBLIC_STUN_SUFFIXES.as_slice(), "action": "reject"}),
                json!({"network": ["udp", "icmp"], "ip_cidr": OVERSEAS_UDP_REJECT_IPV4_CIDRS.as_slice(), "action": "reject"}),
                json!({"ip_version": 6, "network": ["udp", "icmp"], "ip_cidr": OVERSEAS_UDP_REJECT_IPV6_CIDRS.as_slice(), "action": "reject"}),
            ];
            rules.splice(dns_idx + 1..dns_idx + 1, anti_leak);
        }

        // Insert MOBILE_HOME_AUX_SUFFIXES and Cloud exit rules right after CLAUDE_HOME_IPV4_CIDRS.
        if let Some(home_cidr_idx) = rules.iter().position(|rule| {
            rule.get("network").and_then(Value::as_str) == Some("tcp")
                && rule.get("ip_cidr") == Some(&json!(CLAUDE_HOME_IPV4_CIDRS.to_vec()))
        }) {
            let extra_tcp = [
                json!({"network": "tcp", "domain_suffix": MOBILE_HOME_AUX_SUFFIXES.as_slice(), "action": "route", "outbound": home_target}),
                json!({"network": "tcp", "domain_suffix": cloud_suffixes, "action": "route", "outbound": "Tono-Exit"}),
                json!({"network": "tcp", "ip_cidr": CLOUD_IPV4_CIDRS.as_slice(), "action": "route", "outbound": "Tono-Exit"}),
                json!({"ip_version": 6, "network": "tcp", "ip_cidr": CLOUD_IPV6_CIDRS.as_slice(), "action": "route", "outbound": "Tono-Exit"}),
            ];
            rules.splice(home_cidr_idx + 1..home_cidr_idx + 1, extra_tcp);
        }

        // Also reject UDP to MOBILE_HOME_AUX_SUFFIXES, cloud_suffixes, and CLOUD_IPV4_CIDRS
        // before process/direct UDP rules.
        if let Some(udp_home_idx) = rules.iter().position(|rule| {
            rule.get("network").and_then(Value::as_str) == Some("udp")
                && rule.get("ip_cidr") == Some(&json!(CLAUDE_HOME_IPV4_CIDRS.to_vec()))
        }) {
            let extra_udp = [
                json!({"network": "udp", "domain_suffix": MOBILE_HOME_AUX_SUFFIXES.as_slice(), "action": "reject"}),
                json!({"network": "udp", "domain_suffix": cloud_suffixes, "action": "reject"}),
                json!({"network": "udp", "ip_cidr": CLOUD_IPV4_CIDRS.as_slice(), "action": "reject"}),
            ];
            rules.splice(udp_home_idx + 1..udp_home_idx + 1, extra_udp);
        }
    }
}

pub fn build_hardened_selective_runtime(
    input: RuntimeInput<'_>,
) -> Result<Value, SingBoxError> {
    let has_home = input.routing.home_socks5.is_some();
    let base: OwnedSingBoxRuntime = build_runtime(input)?;
    let mut value: Value =
        serde_json::from_str(base.runtime_json()).map_err(|_| SingBoxError::UnsupportedPolicy)?;
    apply_selective_anti_leak_and_routing(&mut value, has_home);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn route_explainer_covers_home_aux_x_cloud_overseas_cloud_and_anti_leak_rules() {
        // 1. MOBILE_HOME_AUX_SUFFIXES -> AiHome on TCP, AntiLeakReject on UDP
        for host in [
            "workos.com",
            "auth.workos.com",
            "arkoselabs.com",
            "intercom.io",
            "fpjs.io",
            "appleid.apple.com",
            "segment.io",
            "auth0.com",
            "okta.com",
            "modelcontextprotocol.io",
            "gstatic.com",
            "whatsapp.com",
            "livekit.cloud",
        ] {
            let tcp = RouteExplainer::explain(
                DesktopRoutingMode::ThreeTier,
                true,
                &RouteConnection::tcp_domain(host, 443),
            );
            assert_eq!(tcp.tier, RouteTier::AiHome, "{host} TCP tier");
            assert_eq!(tcp.outbound, Some(config::HOME_SOCKS5_OUTBOUND_NAME));
            assert_eq!(tcp.dns_server, Some(HOME_DNS));

            let selective = RouteExplainer::explain(
                DesktopRoutingMode::Selective,
                false,
                &RouteConnection::tcp_domain(host, 443),
            );
            assert_eq!(selective.tier, RouteTier::AiHome);
            assert_eq!(selective.outbound, Some("Tono-Exit"));

            let udp = RouteExplainer::explain(
                DesktopRoutingMode::ThreeTier,
                true,
                &RouteConnection::udp_domain(host, 443),
            );
            assert_eq!(udp.tier, RouteTier::AntiLeakReject, "{host} UDP must reject");
            assert_eq!(udp.action, "reject");
        }

        // 2. grok.x.com stays on AiHome while x.com / twitter.com / twimg.com route to CloudExit
        let grok = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::tcp_domain("grok.x.com", 443),
        );
        assert_eq!(grok.tier, RouteTier::AiHome);
        assert_eq!(grok.outbound, Some(config::HOME_SOCKS5_OUTBOUND_NAME));

        for x_host in ["x.com", "api.x.com", "twitter.com", "pbs.twimg.com", "t.co"] {
            let verdict = RouteExplainer::explain(
                DesktopRoutingMode::ThreeTier,
                true,
                &RouteConnection::tcp_domain(x_host, 443),
            );
            assert_eq!(verdict.tier, RouteTier::CloudExit, "{x_host} must route to CloudExit");
            assert_eq!(verdict.outbound, Some("Tono-Exit"));
        }

        // 3. gateway.ai.cloudflare.com stays on AiHome while cloudflare.com and OVERSEAS_CLOUD_SUFFIXES route to CloudExit
        let cf_ai = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::tcp_domain("gateway.ai.cloudflare.com", 443),
        );
        assert_eq!(cf_ai.tier, RouteTier::AiHome);

        for cloud_host in [
            "cloudflare.com",
            "telegram.org",
            "discord.com",
            "signal.org",
            "wikipedia.org",
            "netflix.com",
            "spotify.com",
            "huggingface.co",
            "pypi.org",
            "docker.io",
        ] {
            let verdict = RouteExplainer::explain(
                DesktopRoutingMode::ThreeTier,
                true,
                &RouteConnection::tcp_domain(cloud_host, 443),
            );
            assert_eq!(verdict.tier, RouteTier::CloudExit, "{cloud_host}");
            assert_eq!(verdict.outbound, Some("Tono-Exit"));
        }

        // 4. CLOUD_IPV4_CIDRS and CLOUD_IPV6_CIDRS (Telegram DC1-DC5) -> CloudExit on TCP, reject on UDP
        let tg_v4 = IpAddr::V4("149.154.167.91".parse().unwrap());
        let tg_tcp = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::tcp_ip(tg_v4, 443),
        );
        assert_eq!(tg_tcp.tier, RouteTier::CloudExit);
        assert_eq!(tg_tcp.outbound, Some("Tono-Exit"));
        assert_eq!(tg_tcp.reason, "cloud-ipv4-cidr");

        let tg_udp = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::udp_ip(tg_v4, 443),
        );
        assert_eq!(tg_udp.tier, RouteTier::AntiLeakReject);

        let tg_v6 = IpAddr::V6("2001:b28:f23d::1".parse().unwrap());
        let tg_v6_tcp = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::tcp_ip(tg_v6, 443),
        );
        assert_eq!(tg_v6_tcp.tier, RouteTier::CloudExit);
        assert_eq!(tg_v6_tcp.reason, "cloud-ipv6-cidr");

        // 5. Anti-leak rejects: DoT 853, STUN UDP 19302..19309, PUBLIC_STUN_SUFFIXES, OVERSEAS_UDP_REJECT_IPV4/IPV6_CIDRS
        let dot = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::tcp_ip(IpAddr::V4(Ipv4Addr::new(223, 5, 5, 5)), 853),
        );
        assert_eq!(dot.tier, RouteTier::AntiLeakReject);
        assert_eq!(dot.reason, "encrypted-dns-port-reject");

        let stun_port = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::udp_ip(IpAddr::V4(Ipv4Addr::new(223, 5, 5, 5)), 19302),
        );
        assert_eq!(stun_port.tier, RouteTier::AntiLeakReject);
        assert_eq!(stun_port.reason, "stun-udp-port-reject");

        let public_stun_udp = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::udp_domain("stun.cloudflare.com", 3478),
        );
        assert_eq!(public_stun_udp.tier, RouteTier::AntiLeakReject);
        assert_eq!(public_stun_udp.reason, "public-stun-udp-reject");

        let public_stun_tcp = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::tcp_domain("turn.cloudflare.com", 443),
        );
        assert_eq!(public_stun_tcp.tier, RouteTier::CloudExit);

        let overseas_udp_v4 = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::udp_ip(IpAddr::V4("74.125.250.129".parse().unwrap()), 443),
        );
        assert_eq!(overseas_udp_v4.tier, RouteTier::AntiLeakReject);
        assert_eq!(overseas_udp_v4.reason, "overseas-udp-ipv4-cidr-reject");

        let overseas_udp_v6 = RouteExplainer::explain(
            DesktopRoutingMode::ThreeTier,
            true,
            &RouteConnection::udp_ip(IpAddr::V6("2606:4700:4700::1111".parse().unwrap()), 443),
        );
        assert_eq!(overseas_udp_v6.tier, RouteTier::AntiLeakReject);
        assert_eq!(overseas_udp_v6.reason, "overseas-udp-ipv6-cidr-reject");
    }

    #[test]
    fn selective_runtime_hardening_injects_anti_leak_and_home_aux_and_cloud_rules() {
        let mut runtime = json!({
            "route": {
                "rules": [
                    {"ip_version": 6, "action": "reject"},
                    {"inbound": "Tono-DNS", "action": "hijack-dns"},
                    {"port": 53, "action": "hijack-dns"},
                    {"network": "tcp", "domain_suffix": CLAUDE_HOME_DOMAINS.to_vec(), "action": "route", "outbound": config::HOME_SOCKS5_OUTBOUND_NAME},
                    {"network": "tcp", "ip_cidr": CLAUDE_HOME_IPV4_CIDRS.to_vec(), "action": "route", "outbound": config::HOME_SOCKS5_OUTBOUND_NAME},
                    {"network": "udp", "domain_suffix": CLAUDE_HOME_DOMAINS.to_vec(), "action": "reject"},
                    {"network": "udp", "ip_cidr": CLAUDE_HOME_IPV4_CIDRS.to_vec(), "action": "reject"},
                    {"network": ["udp", "icmp"], "action": "reject"}
                ]
            }
        });
        apply_selective_anti_leak_and_routing(&mut runtime, true);
        let rules = runtime["route"]["rules"].as_array().unwrap();
        assert!(rules.contains(&json!({"port": ENCRYPTED_DNS_PORTS.as_slice(), "action": "reject"})));
        assert!(rules.contains(&json!({"network": ["udp", "icmp"], "port": STUN_UDP_PORTS.as_slice(), "action": "reject"})));
        assert!(rules.contains(&json!({"network": "tcp", "domain_suffix": MOBILE_HOME_AUX_SUFFIXES.as_slice(), "action": "route", "outbound": config::HOME_SOCKS5_OUTBOUND_NAME})));
        assert!(rules.contains(&json!({"network": "tcp", "ip_cidr": CLOUD_IPV4_CIDRS.as_slice(), "action": "route", "outbound": "Tono-Exit"})));
        assert!(rules.contains(&json!({"ip_version": 6, "network": "tcp", "ip_cidr": CLOUD_IPV6_CIDRS.as_slice(), "action": "route", "outbound": "Tono-Exit"})));
    }
}
