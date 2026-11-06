//! One finite inline graph shared by the compiler and privileged Service.
//! It is not permission to launch it: session protection/grants are separate.
use crate::direct_domains::{
    CLAUDE_HOME_DOMAINS, CLAUDE_HOME_IPV4_CIDRS, CLOUD_IPV4_CIDRS, CLOUD_IPV6_CIDRS,
    CLOUD_VIDEO_DOMAINS, ENCRYPTED_DNS_PORTS, MOBILE_HOME_AUX_SUFFIXES, OVERSEAS_CLOUD_SUFFIXES,
    OVERSEAS_UDP_REJECT_IPV4_CIDRS, OVERSEAS_UDP_REJECT_IPV6_CIDRS, PUBLIC_STUN_SUFFIXES,
    STUN_UDP_PORTS, X_CLOUD_SUFFIXES, LAN_IPV4_CIDRS, LAN_IPV6_CIDRS,
};
use serde_json::{Value, json};

pub const DIRECT: &str = "Tono-ThreeTier-Direct";
pub const HOME_DNS: &str = "Tono-ThreeTier-Home-DNS";
pub const CHINA_DNS: &str = "Tono-ThreeTier-China-DNS";
pub const AI_HOME_DIRECT: &str = "Tono-AIHome-Direct";
pub const AI_HOME_HOME_DNS: &str = "Tono-AIHome-Home-DNS";
pub const AI_HOME_CHINA_DNS: &str = "Tono-AIHome-China-DNS";
const TEMPLATE: &str = include_str!("../../../../../tooling/scripts/sing-box/three-tier-template.json");
const AI_HOME_TEMPLATE: &str = include_str!("../../../../../tooling/scripts/sing-box/ai-home-template.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    ThreeTier,
    AiHome,
}

impl Variant {
    pub const fn direct_tag(self) -> &'static str {
        match self {
            Self::ThreeTier => DIRECT,
            Self::AiHome => AI_HOME_DIRECT,
        }
    }

    const fn mode_name(self) -> &'static str {
        match self {
            Self::ThreeTier => "three-tier",
            Self::AiHome => "ai-home",
        }
    }
}

fn carries(runtime: &Value, home_dns: &str, direct: &str) -> bool {
    runtime["dns"]["servers"].as_array().is_some_and(|servers| {
        servers.iter().any(|server| server["tag"] == home_dns)
    }) || runtime["outbounds"].as_array().is_some_and(|outbounds| {
        outbounds.iter().any(|outbound| outbound["tag"] == direct)
    })
}

pub fn is_three_tier_runtime(runtime: &Value) -> bool {
    carries(runtime, HOME_DNS, DIRECT)
}

pub fn is_ai_home_runtime(runtime: &Value) -> bool {
    carries(runtime, AI_HOME_HOME_DNS, AI_HOME_DIRECT)
}

/// `"three-tier"`, `"ai-home"`, or `"stable"` by the graph's own tags; `None`
/// when a document carries tags from both graphs, which no owned builder emits.
pub fn routing_mode(runtime: &Value) -> Option<&'static str> {
    match (is_three_tier_runtime(runtime), is_ai_home_runtime(runtime)) {
        (true, false) => Some("three-tier"),
        (false, true) => Some("ai-home"),
        (false, false) => Some("stable"),
        (true, true) => None,
    }
}

pub fn cloud_exit_suffixes() -> Vec<&'static str> {
    X_CLOUD_SUFFIXES
        .iter()
        .chain(OVERSEAS_CLOUD_SUFFIXES.iter())
        .chain(PUBLIC_STUN_SUFFIXES.iter())
        .copied()
        .collect()
}

fn physical_interface_ok(interface: &str) -> bool {
    !interface.is_empty() && interface.len() <= 128
        && !interface.to_ascii_lowercase().starts_with("utun")
        && !interface.to_ascii_lowercase().contains("tono")
        && !interface.to_ascii_lowercase().contains("loopback")
        && interface.chars().all(|c| c.is_ascii_alphanumeric() || " -_.{}".contains(c))
}

pub fn graph(home: &str, interface: &str, fake_range: &str) -> Result<Value, String> {
    graph_for_variant(home, interface, fake_range, Variant::ThreeTier)
}

pub fn ai_home_graph(home: &str, interface: &str, fake_range: &str) -> Result<Value, String> {
    graph_for_variant(home, interface, fake_range, Variant::AiHome)
}

pub fn graph_for_variant(
    home: &str,
    interface: &str,
    fake_range: &str,
    variant: Variant,
) -> Result<Value, String> {
    if home.is_empty()
        || home == DIRECT
        || home == AI_HOME_DIRECT
        || home == "Tono-Exit"
        || !physical_interface_ok(interface)
        || !(0..8).any(|slot| fake_range == format!("198.18.{}.0/20", 128 + 16 * slot))
    {
        return Err(format!("invalid {} binding", variant.mode_name()));
    }
    let snapshot: Value = serde_json::from_str(TEMPLATE).map_err(|_| "invalid bundled classification")?;
    let template_graph = match variant {
        Variant::ThreeTier => snapshot["graph"].clone(),
        Variant::AiHome => {
            let ai_home: Value = serde_json::from_str(AI_HOME_TEMPLATE)
                .map_err(|_| "invalid bundled ai-home template")?;
            ai_home["graph"].clone()
        }
    };
    let replacements = json!({
        "$home_target": home, "$physical_interface": interface, "$fake_ipv4_range": fake_range,
        "$home_suffixes": CLAUDE_HOME_DOMAINS.as_slice(), "$home_cidrs": CLAUDE_HOME_IPV4_CIDRS.as_slice(),
        "$video_suffixes": CLOUD_VIDEO_DOMAINS.as_slice(),
        "$domestic_full": snapshot["domestic_full"], "$overseas_full": snapshot["overseas_full"],
        "$encrypted_dns_ports": ENCRYPTED_DNS_PORTS.as_slice(),
        "$lan_ipv4": LAN_IPV4_CIDRS.as_slice(), "$lan_ipv6": LAN_IPV6_CIDRS.as_slice(),
        "$lan_protected_suffixes": ([CLAUDE_HOME_DOMAINS.as_slice(), CLOUD_VIDEO_DOMAINS.as_slice(),
            MOBILE_HOME_AUX_SUFFIXES.as_slice(), cloud_exit_suffixes().as_slice()].concat()),
        "$stun_udp_ports": STUN_UDP_PORTS.as_slice(),
        "$public_stun_suffixes": PUBLIC_STUN_SUFFIXES.as_slice(),
        "$overseas_udp_reject_ipv4": OVERSEAS_UDP_REJECT_IPV4_CIDRS.as_slice(),
        "$overseas_udp_reject_ipv6": OVERSEAS_UDP_REJECT_IPV6_CIDRS.as_slice(),
        "$mobile_home_aux": MOBILE_HOME_AUX_SUFFIXES.as_slice(),
        "$cloud_exit_suffixes": cloud_exit_suffixes(),
        "$cloud_ipv4": CLOUD_IPV4_CIDRS.as_slice(),
        "$cloud_ipv6": CLOUD_IPV6_CIDRS.as_slice(),
    });
    fn render(value: &Value, replacements: &Value) -> Result<Value, String> {
        match value {
            Value::String(key) if key.starts_with('$') => replacements
                .get(key)
                .cloned()
                .ok_or_else(|| format!("unbound template placeholder `{key}`")),
            Value::Array(items) => items
                .iter()
                .map(|item| render(item, replacements))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            Value::Object(items) => items
                .iter()
                .map(|(key, item)| render(item, replacements).map(|rendered| (key.clone(), rendered)))
                .collect::<Result<serde_json::Map<_, _>, _>>()
                .map(Value::Object),
            _ => Ok(value.clone()),
        }
    }
    // Anti-leak ports, overseas UDP/STUN, Home aux, and X/cloud suffixes live in the
    // shared templates as `$…` bindings. Rendering them here keeps macOS (generated
    // from the same templates) and Windows on one contract.
    render(&template_graph, &replacements)
}

/// The IPv4 prefixes AI Home sends Home, read from its own graph, so the
/// Service's AI-scoped WFP block holds exactly what the graph protects.
pub fn ai_home_held_ipv4_cidrs() -> Result<Vec<String>, String> {
    let rendered = ai_home_graph("Tono-Home-Residential", "Ethernet", "198.18.128.0/20")?;
    let rules = rendered["route"]["rules"]
        .as_array()
        .ok_or_else(|| "ai-home graph has no route rules".to_owned())?;
    let mut cidrs = Vec::new();
    for rule in rules {
        if rule["outbound"] == "Tono-Home-Residential"
            && let Some(items) = rule["ip_cidr"].as_array()
        {
            for item in items {
                let cidr = item
                    .as_str()
                    .ok_or_else(|| "ai-home Home ip_cidr entry is not a string".to_owned())?;
                if !cidrs.iter().any(|existing| existing == cidr) {
                    cidrs.push(cidr.to_owned());
                }
            }
        }
    }
    if cidrs.is_empty() {
        return Err("ai-home graph carries no held Home IPv4 prefixes".into());
    }
    Ok(cidrs)
}

/// Exact comparison, not a second permissive routing parser. The privileged
/// legacy checks still validate listeners, files, keys, TLS and exit selectors.
/// No caller policy, raw IP or process rule can extend this compiled snapshot.
pub fn admit_runtime(runtime: &Value) -> Result<bool, String> {
    admit_variant(runtime, Variant::ThreeTier)
}

pub fn admit_ai_home_runtime(runtime: &Value) -> Result<bool, String> {
    admit_variant(runtime, Variant::AiHome)
}

fn admit_variant(runtime: &Value, variant: Variant) -> Result<bool, String> {
    let fail = || format!("{} graph/DNS/outbound binding is not the compiled contract", variant.mode_name());
    let Some(mode) = routing_mode(runtime) else {
        return Err("runtime mixes three-tier and ai-home graph tags".into());
    };
    if mode != variant.mode_name() {
        return Ok(false);
    }
    let outbounds = runtime["outbounds"].as_array().ok_or_else(fail)?;
    let home = outbounds.iter().find(|outbound| outbound["type"] == "socks").ok_or_else(fail)?;
    let home_tag = home["tag"].as_str().ok_or_else(fail)?;
    let host = home["server"].as_str().ok_or_else(fail)?;
    let public = public_ipv4(host) || public_hostname(host);
    let credential = |key: &str| home[key].as_str().is_some_and(|value| !value.is_empty() && value.len() <= 4096);
    let expected_home = json!({"type":"socks", "tag":home_tag, "server":home["server"],
        "server_port":home["server_port"], "version":"5", "username":home["username"],
        "password":home["password"], "network":"tcp", "detour":"Tono-Exit"});
    if !public || home_tag != "Tono-Home-Residential" || home != &expected_home
        || !credential("username") || !credential("password")
        || !home["server_port"].as_u64().is_some_and(|port| (1..=65535).contains(&port))
        || outbounds.iter().filter(|outbound| outbound["type"] == "socks").count() != 1 {
        return Err(fail());
    }
    let direct_tag = variant.direct_tag();
    let direct = outbounds.iter().find(|outbound| outbound["tag"] == direct_tag).ok_or_else(fail)?;
    let interface = direct["bind_interface"].as_str().ok_or_else(fail)?;
    let fake = runtime["dns"]["servers"][0]["inet4_range"].as_str().ok_or_else(fail)?;
    let expected = graph_for_variant(home_tag, interface, fake, variant)?;
    let mut tags = std::collections::BTreeSet::new();
    let exit = outbounds.iter().find(|outbound| outbound["tag"] == "Tono-Exit").ok_or_else(fail)?;
    let choices = exit["outbounds"].as_array().filter(|choices| !choices.is_empty()).ok_or_else(fail)?;
    if exit["type"] != "selector" || !choices.contains(&exit["default"])
        || !choices.iter().all(|choice| outbounds.iter().any(|outbound| &outbound["tag"] == choice
            && matches!(outbound["type"].as_str(), Some("vless" | "hysteria2")))) {
        return Err(fail());
    }
    if runtime["route"] != expected["route"] || runtime["dns"] != expected["dns"]
        || direct != &expected["direct_outbound"]
        || outbounds.iter().filter(|outbound| outbound["type"] == "direct").count() != 1
        || outbounds.iter().filter(|outbound| outbound["type"] == "selector").count() != 1
        || !outbounds.iter().all(|outbound| outbound["tag"].as_str().is_some_and(|tag| tags.insert(tag)))
        || !outbounds.iter().all(|outbound| matches!(outbound["type"].as_str(), Some("vless" | "hysteria2" | "socks" | "selector" | "direct"))) {
        return Err(fail());
    }
    Ok(true)
}

/// Home lines are usually a provider gateway name (`isp.decodo.com`), not an
/// address. The hop is dialled through `Tono-Exit`, so the cloud node resolves
/// it; still admit only an ordinary lowercase DNS name, never a special-use
/// suffix or an all-numeric/hex form that could stand for an IP.
fn public_hostname(value: &str) -> bool {
    if value.is_empty() || value.len() > 253 {
        return false;
    }
    let labels: Vec<&str> = value.split('.').collect();
    if labels.len() < 2
        || !labels.iter().all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        || !labels
            .last()
            .is_some_and(|top| top.bytes().any(|b| b.is_ascii_lowercase()))
    {
        return false;
    }
    let numeric = labels.iter().all(|label| {
        let (hex, digits) = match label.strip_prefix("0x") {
            Some(rest) => (true, rest),
            None => (false, *label),
        };
        !digits.is_empty()
            && digits
                .bytes()
                .all(|b| b.is_ascii_digit() || (hex && (b'a'..=b'f').contains(&b)))
    });
    const RESERVED: &[&str] = &[
        "localhost",
        "local",
        "internal",
        "arpa",
        "invalid",
        "onion",
        "alt",
        "test",
        "example",
        "example.com",
        "example.net",
        "example.org",
    ];
    !numeric
        && labels.first() != Some(&"localhost")
        && !RESERVED.iter().any(|suffix| {
            value == *suffix
                || value
                    .strip_suffix(suffix)
                    .is_some_and(|prefix| prefix.ends_with('.'))
        })
}

fn public_ipv4(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    let Ok(bytes): Result<Vec<u8>, _> = parts.iter().map(|part| part.parse::<u8>()).collect() else {
        return false;
    };
    if bytes.iter().zip(parts.iter()).any(|(byte, part)| byte.to_string() != *part) {
        return false;
    }
    bytes[0] != 0
        && bytes[0] != 10
        && bytes[0] != 127
        && bytes[0] < 224
        && !(bytes[0] == 100 && (64..=127).contains(&bytes[1]))
        && !(bytes[0] == 169 && bytes[1] == 254)
        && !(bytes[0] == 172 && (16..=31).contains(&bytes[1]))
        && !(bytes[0] == 192 && bytes[1] == 168)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rendered_graph_blocks_dot_stun_https_svcb_and_keeps_grok_on_home() {
        let graph = graph("Tono-Home-Residential", "en0", "198.18.128.0/20").unwrap();
        let rules = graph["route"]["rules"].as_array().unwrap();
        assert!(rules.contains(&json!({"port": ENCRYPTED_DNS_PORTS.as_slice(), "action": "reject"})));
        assert!(rules.contains(&json!({"network": ["udp", "icmp"], "port": STUN_UDP_PORTS.as_slice(), "action": "reject"})));
        assert!(rules.contains(&json!({"ip_version": 6, "network": ["udp", "icmp"], "ip_cidr": OVERSEAS_UDP_REJECT_IPV6_CIDRS.as_slice(), "action": "reject"})));
        let home_aux = rules.iter().find(|rule| {
            rule["domain_suffix"] == json!(MOBILE_HOME_AUX_SUFFIXES.as_slice()) && rule["action"] == "route"
        }).unwrap();
        assert_eq!(home_aux["outbound"], "Tono-Home-Residential");
        let x_rule = rules.iter().find(|rule| {
            rule["action"] == "route"
                && rule["domain_suffix"].as_array().is_some_and(|suffixes| suffixes.contains(&json!("x.com")))
        }).unwrap();
        assert_eq!(x_rule["outbound"], "Tono-Exit");
        let home = rules.iter().find(|rule| {
            rule["action"] == "route"
                && rule["domain_suffix"].as_array().is_some_and(|suffixes| suffixes.contains(&json!("grok.x.com")))
        }).unwrap();
        assert_eq!(home["outbound"], "Tono-Home-Residential");
        assert!(home_before_x(rules, "grok.x.com", "x.com"));
        let blanket = rules.iter().position(|rule| rule == &json!({"ip_version": 6, "action": "reject", "no_drop": true})).unwrap();
        let cloud_v6 = rules.iter().position(|rule| {
            rule.get("ip_version") == Some(&json!(6)) && rule["outbound"] == "Tono-Exit"
        }).unwrap();
        let ipv6_udp = rules.iter().position(|rule| {
            rule.get("ip_version") == Some(&json!(6)) && rule["network"] == json!(["udp", "icmp"])
        }).unwrap();
        assert!(ipv6_udp < blanket && cloud_v6 < blanket);
        let dns = graph["dns"]["rules"].as_array().unwrap();
        assert!(dns.iter().any(|rule| rule["query_type"] == json!(["HTTPS", "SVCB"])
            && rule["action"] == "predefined"
            && rule["rcode"] == "NOERROR"
            && rule["domain_suffix"].as_array().is_some_and(|suffixes| suffixes.contains(&json!("claude.ai")))));
    }

    #[test]
    fn public_hostname_admits_provider_gateways_and_refuses_reserved_or_numeric_hosts() {
        assert!(public_hostname("isp.decodo.com"));
        assert!(public_hostname("gate-01.residential.provider-example.io"));
        assert!(!public_hostname("ISP.decodo.com"));
        assert!(!public_hostname("localhost"));
        assert!(!public_hostname("localhost.decodo.com"));
        assert!(!public_hostname("proxy.local"));
        assert!(!public_hostname("gw.internal"));
        assert!(!public_hostname("home.example.com"));
        assert!(!public_hostname("127.0.0.1"));
        assert!(!public_hostname("127.0.0.0x1"));
        assert!(!public_hostname("0x7f.0.0.1"));
        assert!(!public_ipv4("010.1.2.3"));
        assert!(!public_ipv4("100.64.0.1"));
        assert!(public_ipv4("203.0.113.60"));
    }

    #[test]
    fn ai_home_graph_defaults_to_direct_allows_lan_and_keeps_ai_on_home() {
        let rendered = ai_home_graph("Tono-Home-Residential", "Ethernet 7", "198.18.128.0/20").unwrap();
        assert_eq!(rendered["route"]["final"], AI_HOME_DIRECT);
        assert_eq!(rendered["direct_outbound"]["tag"], AI_HOME_DIRECT);
        assert_eq!(rendered["direct_outbound"]["bind_interface"], "Ethernet 7");
        assert_eq!(ai_home_held_ipv4_cidrs().unwrap(), vec!["160.79.104.0/21".to_owned()]);
        let rules = rendered["route"]["rules"].as_array().unwrap();
        for cidrs in [LAN_IPV4_CIDRS.as_slice(), LAN_IPV6_CIDRS.as_slice()] {
            assert!(rules.iter().any(|rule| {
                rule["type"] == "logical"
                    && rule["mode"] == "and"
                    && rule["action"] == "route"
                    && rule["outbound"] == AI_HOME_DIRECT
                    && rule["rules"].as_array().is_some_and(|subrules| {
                        subrules.contains(&json!({"ip_cidr": cidrs}))
                            && subrules.iter().any(|sub| sub["invert"] == true)
                    })
            }));
        }
        assert!(!rules.contains(&json!({"port": ENCRYPTED_DNS_PORTS.as_slice(), "action": "reject"})));
        assert!(!rules.contains(&json!({"network": ["udp", "icmp"], "port": STUN_UDP_PORTS.as_slice(), "action": "reject"})));
    }

    fn home_before_x(rules: &[Value], home_host: &str, cloud_host: &str) -> bool {
        let home_at = rules.iter().position(|rule| {
            rule["domain_suffix"].as_array().is_some_and(|suffixes| suffixes.iter().any(|suffix| suffix == home_host))
        });
        let cloud_at = rules.iter().position(|rule| {
            rule["domain_suffix"].as_array().is_some_and(|suffixes| suffixes.iter().any(|suffix| suffix == cloud_host))
                && rule["outbound"] == "Tono-Exit"
        });
        home_at.zip(cloud_at).is_some_and(|(home, cloud)| home < cloud)
    }
}
