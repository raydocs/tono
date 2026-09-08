//! Controller connection sampling: DIRECT overlay and residential-route evidence.

use tono_core::config;

pub(crate) const MAX_DIRECT_SAMPLES: usize = 512;
/// Independent privacy/size cap for protected connection IDs observed in one session. IDs are
/// hashed and retained in memory only; the audit event contains cumulative enum/count evidence.
pub(crate) const MAX_PROTECTED_ROUTE_SAMPLES: usize = 512;

/// The subset of `/connections` this sampler reads. Deliberately not the full shape: every
/// field here is one the audit record needs, and anything the controller adds later is
/// ignored rather than a parse failure.
#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct SampledConnection {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) metadata: SampledMetadata,
    #[serde(default)]
    pub(crate) chains: Vec<String>,
    #[serde(default)]
    pub(crate) rule: String,
    #[serde(default, rename = "rulePayload")]
    pub(crate) rule_payload: String,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub(crate) struct SampledMetadata {
    #[serde(default, rename = "destinationIP")]
    pub(crate) destination_ip: String,
    #[serde(default)]
    pub(crate) host: String,
    #[serde(default, rename = "destinationPort")]
    pub(crate) destination_port: String,
    #[serde(default)]
    pub(crate) network: String,
    #[serde(default)]
    pub(crate) process: String,
    #[serde(default, rename = "processPath")]
    pub(crate) process_path: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct SampledConnections {
    #[serde(default)]
    pub(crate) connections: Vec<SampledConnection>,
}

/// One destination worth recording, already deduplicated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DirectSample {
    /// The resolved address, when the flow carried one. Empty for a domain-routed flow under
    /// fake-ip, where the controller reports the name and not an address the prefix set could
    /// be computed from.
    pub(crate) address: String,
    /// The destination name, when the flow carried one.
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) udp: bool,
    pub(crate) process: String,
    pub(crate) chain: String,
    pub(crate) rule: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProtectedDestination {
    Anthropic,
    Turnstile,
    Payment,
    Update,
    Telemetry,
}

impl ProtectedDestination {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "ANTHROPIC",
            Self::Turnstile => "TURNSTILE",
            Self::Payment => "PAYMENT",
            Self::Update => "UPDATE",
            Self::Telemetry => "TELEMETRY",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProtectedRoute {
    Residential,
    Direct,
    Proxied,
    Blocked,
    Unknown,
}

impl ProtectedRoute {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Residential => "RESIDENTIAL",
            Self::Direct => "DIRECT",
            Self::Proxied => "PROXIED",
            Self::Blocked => "BLOCKED",
            Self::Unknown => "UNKNOWN",
        }
    }

    pub(crate) fn violates_residential_route(self) -> bool {
        matches!(self, Self::Direct | Self::Proxied)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProtectedRouteAggregate {
    pub(crate) residential: u32,
    pub(crate) direct: u32,
    pub(crate) proxied: u32,
    pub(crate) blocked: u32,
    pub(crate) unknown: u32,
    pub(crate) latest: Option<(ProtectedRoute, ProtectedDestination)>,
}

impl ProtectedRouteAggregate {
    fn observe(&mut self, route: ProtectedRoute, destination: ProtectedDestination) {
        match route {
            ProtectedRoute::Residential => self.residential = self.residential.saturating_add(1),
            ProtectedRoute::Direct => self.direct = self.direct.saturating_add(1),
            ProtectedRoute::Proxied => self.proxied = self.proxied.saturating_add(1),
            ProtectedRoute::Blocked => self.blocked = self.blocked.saturating_add(1),
            ProtectedRoute::Unknown => self.unknown = self.unknown.saturating_add(1),
        }
        self.latest = Some((route, destination));
    }

    pub(crate) fn invariant_violations(self) -> u32 {
        self.direct.saturating_add(self.proxied)
    }
}

pub(crate) const ANTHROPIC_DESTINATIONS: &[&str] = &[
    "anthropic.com",
    "claude.ai",
    "claude.com",
    "claude.app",
    "claude.site",
    "clau.de",
    "anthropic.ai",
    "claudestudio.com",
    "claudemcpclient.com",
    "claudemcpcontent.com",
    "claudeusercontent.com",
    "servd-anthropic-website.b-cdn.net",
];
pub(crate) const TURNSTILE_DESTINATIONS: &[&str] = &["challenges.cloudflare.com", "cf-assets.www.cloudflare.com"];
// Stripe's published browser/API/CDN/challenge set plus Link; these are
// routing dependencies, not evidence that every matching request is Claude.
pub(crate) const PAYMENT_DESTINATIONS: &[&str] = &[
    "stripe.com",
    "stripecdn.com",
    "stripe.network",
    "link.com",
    "hcaptcha.com",
];
pub(crate) const UPDATE_DESTINATIONS: &[&str] = &[
    "storage.googleapis.com",
    "registry.npmjs.org",
    "raw.githubusercontent.com",
    "formulae.brew.sh",
];
pub(crate) const TELEMETRY_DESTINATIONS: &[&str] = &[
    "cloudflareinsights.com",
    "browser-intake-datadoghq.com",
    "browser-intake-us5-datadoghq.com",
    "browser-intake-us3-datadoghq.com",
    "browser-intake-ap1-datadoghq.com",
    "browser-intake-ap2-datadoghq.com",
    "browser-intake-datadoghq.eu",
    "browser-intake-ddog-gov.com",
    "datadoghq.com",
    "statsig.com",
    "statsigapi.net",
    "featuregates.org",
    "growthbook.io",
    "sentry.io",
];

pub(crate) fn host_matches_suffix(host: &str, suffix: &str) -> bool {
    host == suffix || host.strip_suffix(suffix).is_some_and(|prefix| prefix.ends_with('.'))
}

pub(crate) fn protected_destination(connection: &SampledConnection) -> Option<ProtectedDestination> {
    let host = connection
        .metadata
        .host
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    for (category, suffixes) in [
        (ProtectedDestination::Anthropic, ANTHROPIC_DESTINATIONS),
        (ProtectedDestination::Turnstile, TURNSTILE_DESTINATIONS),
        (ProtectedDestination::Payment, PAYMENT_DESTINATIONS),
        (ProtectedDestination::Update, UPDATE_DESTINATIONS),
        (ProtectedDestination::Telemetry, TELEMETRY_DESTINATIONS),
    ] {
        if suffixes.iter().any(|suffix| host_matches_suffix(&host, suffix)) {
            return Some(category);
        }
    }

    let address = connection.metadata.destination_ip.trim();
    config::CLAUDE_HOME_IPV4_CIDRS
        .iter()
        .any(|cidr| ipv4_in_cidr(address, cidr))
        .then_some(ProtectedDestination::Anthropic)
}

pub(crate) fn ipv4_in_cidr(address: &str, cidr: &str) -> bool {
    let Ok(address) = address.parse::<std::net::Ipv4Addr>() else {
        return false;
    };
    let Some((network, prefix)) = cidr.split_once('/') else {
        return false;
    };
    let (Ok(network), Ok(prefix)) = (network.parse::<std::net::Ipv4Addr>(), prefix.parse::<u32>()) else {
        return false;
    };
    if prefix > 32 {
        return false;
    }
    let mask = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix) };
    u32::from(address) & mask == u32::from(network) & mask
}

/// Mihomo lists the terminal outbound first and selector groups after it. The terminal is the
/// authority: a residential SOCKS hop can legitimately be followed by `Tono-Exit` because that
/// is its dialer transport, while `Tono-Exit` as the terminal means protected traffic missed the
/// residential route. Every outcome is mutually exclusive.
pub(crate) fn classify_protected_route(connection: &SampledConnection, residential_target: &str) -> ProtectedRoute {
    let blocked = |value: &str| {
        matches!(
            value.trim().to_ascii_uppercase().as_str(),
            "REJECT" | "REJECT-DROP" | "DROP" | "BLOCK"
        )
    };
    if connection.chains.iter().any(|hop| blocked(hop))
        || blocked(&connection.rule)
        || blocked(&connection.rule_payload)
    {
        return ProtectedRoute::Blocked;
    }
    let Some(terminal) = connection
        .chains
        .first()
        .map(|hop| hop.trim())
        .filter(|hop| !hop.is_empty())
    else {
        return ProtectedRoute::Unknown;
    };
    if terminal == residential_target {
        return ProtectedRoute::Residential;
    }
    if terminal.eq_ignore_ascii_case("DIRECT")
        || terminal == config::DIRECT_GROUP_NAME
        || terminal == config::WEB_DIRECT_GROUP_NAME
    {
        return ProtectedRoute::Direct;
    }
    ProtectedRoute::Proxied
}

pub(crate) fn protected_connection_key(connection: &SampledConnection) -> u64 {
    use std::hash::{Hash as _, Hasher as _};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    if connection.id.is_empty() {
        connection.metadata.host.hash(&mut hasher);
        connection.metadata.destination_ip.hash(&mut hasher);
        connection.metadata.destination_port.hash(&mut hasher);
        connection.metadata.network.hash(&mut hasher);
        connection.metadata.process_path.hash(&mut hasher);
        connection.chains.hash(&mut hasher);
    } else {
        connection.id.hash(&mut hasher);
    }
    hasher.finish()
}

pub(crate) fn observe_protected_routes(
    payload: &SampledConnections,
    residential_target: &str,
    seen: &mut std::collections::HashSet<u64>,
    aggregate: &mut ProtectedRouteAggregate,
) -> bool {
    let mut changed = false;
    for connection in &payload.connections {
        if seen.len() >= MAX_PROTECTED_ROUTE_SAMPLES {
            break;
        }
        let Some(destination) = protected_destination(connection) else {
            continue;
        };
        if !seen.insert(protected_connection_key(connection)) {
            continue;
        }
        let route = classify_protected_route(connection, residential_target);
        aggregate.observe(route, destination);
        changed = true;
    }
    changed
}

/// Which connections went out the physical interface, and which of those are new this session.
///
/// A connection counts as DIRECT when its proxy chain names one of the interface-bound direct
/// outbounds. The chain is the authority, not the rule: a rule names a *group*, and a group
/// that failed over is exactly the case where the rule and the actual path disagree — the same
/// distinction the macOS route classifier had to make.
pub(crate) fn new_direct_samples(
    payload: &SampledConnections,
    seen: &mut std::collections::HashSet<(String, u16, bool, String)>,
) -> Vec<DirectSample> {
    let mut fresh = Vec::new();
    for connection in &payload.connections {
        // Enforce the bound inside the batch, not only before the controller read.
        if seen.len() >= MAX_DIRECT_SAMPLES {
            break;
        }
        let direct = connection
            .chains
            .iter()
            .any(|hop| hop == config::DIRECT_GROUP_NAME || hop == config::WEB_DIRECT_GROUP_NAME);
        if !direct {
            continue;
        }
        // Both shapes occur and both matter. A raw-IP dial — WeChat's HTTPDNS path, the one
        // rule H exists for — reports an address and no name. A domain-routed flow under
        // fake-ip reports the name, and its `destinationIP` is either absent or a fake-ip
        // placeholder that no prefix set could be computed from. Recording only the address
        // would therefore miss exactly the traffic this instrumentation is for on half the
        // flows, so keep whichever the controller gave.
        let address = connection.metadata.destination_ip.trim();
        let host = connection.metadata.host.trim();
        if address.is_empty() && host.is_empty() {
            continue;
        }
        let Ok(port) = connection.metadata.destination_port.trim().parse::<u16>() else {
            continue;
        };
        let udp = connection.metadata.network.eq_ignore_ascii_case("udp");
        let process_source = if connection.metadata.process_path.trim().is_empty() {
            &connection.metadata.process
        } else {
            &connection.metadata.process_path
        };
        let process = process_source.rsplit(['\\', '/']).next().unwrap_or_default().to_owned();
        // The process belongs in the key. Without it, the second process to reach an address
        // some other process already reached is silently dropped — and "a process that is not
        // WeChat went direct" is an alarm, not a statistic, so suppressing it is the one
        // deduplication this must not do.
        let key = (
            if address.is_empty() {
                host.to_owned()
            } else {
                address.to_owned()
            },
            port,
            udp,
        );
        if !seen.insert((key.0.clone(), key.1, key.2, process.clone())) {
            continue;
        }
        fresh.push(DirectSample {
            address: address.to_owned(),
            host: host.to_owned(),
            port,
            udp,
            process,
            chain: connection.chains.join(" <- "),
            rule: if connection.rule_payload.is_empty() {
                connection.rule.clone()
            } else {
                format!("{} {}", connection.rule, connection.rule_payload)
            },
        });
    }
    fresh
}

#[cfg(test)]
mod observation_regressions {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn payment_dependencies_are_observed_without_guessing_the_application() {
        for host in [
            "js.stripe.com",
            "m.stripe.network",
            "a.stripecdn.com",
            "checkout.link.com",
            "newassets.hcaptcha.com",
            "API.STRIPE.COM.",
        ] {
            let payload: SampledConnections = serde_json::from_value(serde_json::json!({
                "connections":[{"metadata":{"host":host, "process":"any-browser.exe"}}]
            }))
            .unwrap();
            assert_eq!(
                protected_destination(&payload.connections[0]),
                Some(ProtectedDestination::Payment),
                "{host}"
            );
        }
        for host in ["notstripe.com", "stripe.com.example.org", "hcaptcha.com.example.org"] {
            let payload: SampledConnections = serde_json::from_value(serde_json::json!({
                "connections":[{"metadata":{"host":host}}]
            }))
            .unwrap();
            assert_eq!(protected_destination(&payload.connections[0]), None, "{host}");
        }
    }

    #[test]
    fn direct_sample_uses_process_name_when_core_has_no_process_path() {
        let payload: SampledConnections = serde_json::from_value(serde_json::json!({
            "connections": [
                {"id":"one", "metadata":{"host":"example.com", "destinationPort":"443", "process":"first.exe"}, "chains":[config::WEB_DIRECT_GROUP_NAME]},
                {"id":"two", "metadata":{"host":"example.com", "destinationPort":"443", "process":"second.exe"}, "chains":[config::WEB_DIRECT_GROUP_NAME]}
            ]
        })).unwrap();
        let samples = new_direct_samples(&payload, &mut HashSet::new());
        assert_eq!(
            samples.len(),
            2,
            "different owners must not collapse into one unknown owner"
        );
        assert_eq!(samples[0].process, "first.exe");
        assert_eq!(samples[1].process, "second.exe");
    }

    #[test]
    fn a_single_large_controller_snapshot_cannot_overrun_direct_sample_cap() {
        let connections: Vec<_> = (0..MAX_DIRECT_SAMPLES + 20)
            .map(|i| {
                serde_json::json!({
                    "id":i.to_string(), "metadata":{"host":format!("{i}.example.com"), "destinationPort":"443"},
                    "chains":[config::WEB_DIRECT_GROUP_NAME]
                })
            })
            .collect();
        let payload: SampledConnections =
            serde_json::from_value(serde_json::json!({"connections":connections})).unwrap();
        let mut seen = HashSet::new();
        assert_eq!(new_direct_samples(&payload, &mut seen).len(), MAX_DIRECT_SAMPLES);
        assert_eq!(seen.len(), MAX_DIRECT_SAMPLES);
        assert!(new_direct_samples(&payload, &mut seen).is_empty());
    }
}
