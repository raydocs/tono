//! One finite inline graph shared by the compiler and privileged Service.
//! It is not permission to launch it: session protection/grants are separate.
use crate::direct_domains::{
    CLAUDE_HOME_DOMAINS, CLAUDE_HOME_IPV4_CIDRS, CLOUD_IPV4_CIDRS, CLOUD_IPV6_CIDRS,
    CLOUD_VIDEO_DOMAINS, ENCRYPTED_DNS_PORTS, MOBILE_HOME_AUX_SUFFIXES, OVERSEAS_CLOUD_SUFFIXES,
    OVERSEAS_UDP_REJECT_IPV4_CIDRS, OVERSEAS_UDP_REJECT_IPV6_CIDRS, PUBLIC_STUN_SUFFIXES,
    STUN_UDP_PORTS, X_CLOUD_SUFFIXES,
};
use serde_json::{Value, json};

pub const DIRECT: &str = "Tono-ThreeTier-Direct";
pub const HOME_DNS: &str = "Tono-ThreeTier-Home-DNS";
pub const CHINA_DNS: &str = "Tono-ThreeTier-China-DNS";
const TEMPLATE: &str = include_str!("../../../../../tooling/scripts/sing-box/three-tier-template.json");

pub fn is_three_tier_runtime(runtime: &Value) -> bool {
    runtime["dns"]["servers"].as_array().is_some_and(|servers| {
        servers.iter().any(|server| server["tag"] == HOME_DNS)
    }) || runtime["outbounds"].as_array().is_some_and(|outbounds| {
        outbounds.iter().any(|outbound| outbound["tag"] == DIRECT)
    })
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
    if home.is_empty() || home == DIRECT || home == "Tono-Exit" || !physical_interface_ok(interface)
        || !(0..8).any(|slot| fake_range == format!("198.18.{}.0/20", 128 + 16 * slot)) {
        return Err("invalid three-tier binding".into());
    }
    let snapshot: Value = serde_json::from_str(TEMPLATE).map_err(|_| "invalid bundled classification")?;
    let replacements = json!({
        "$home_target": home, "$physical_interface": interface, "$fake_ipv4_range": fake_range,
        "$home_suffixes": CLAUDE_HOME_DOMAINS.as_slice(), "$home_cidrs": CLAUDE_HOME_IPV4_CIDRS.as_slice(),
        "$video_suffixes": CLOUD_VIDEO_DOMAINS.as_slice(),
        "$domestic_full": snapshot["domestic_full"], "$overseas_full": snapshot["overseas_full"],
        "$encrypted_dns_ports": ENCRYPTED_DNS_PORTS.as_slice(),
        "$stun_udp_ports": STUN_UDP_PORTS.as_slice(),
        "$public_stun_suffixes": PUBLIC_STUN_SUFFIXES.as_slice(),
        "$overseas_udp_reject_ipv4": OVERSEAS_UDP_REJECT_IPV4_CIDRS.as_slice(),
        "$overseas_udp_reject_ipv6": OVERSEAS_UDP_REJECT_IPV6_CIDRS.as_slice(),
        "$mobile_home_aux": MOBILE_HOME_AUX_SUFFIXES.as_slice(),
        "$cloud_exit_suffixes": cloud_exit_suffixes(),
        "$cloud_ipv4": CLOUD_IPV4_CIDRS.as_slice(),
        "$cloud_ipv6": CLOUD_IPV6_CIDRS.as_slice(),
    });
    fn render(value: &Value, replacements: &Value) -> Value {
        match value {
            Value::String(key) if key.starts_with('$') => replacements[key].clone(),
            Value::Array(items) => Value::Array(items.iter().map(|item| render(item, replacements)).collect()),
            Value::Object(items) => Value::Object(items.iter().map(|(key, item)| (key.clone(), render(item, replacements))).collect()),
            _ => value.clone(),
        }
    }
    // Anti-leak ports, overseas UDP/STUN, Home aux, and X/cloud suffixes live in the
    // shared template as `$…` bindings. Rendering them here keeps macOS (generated
    // from the same template) and this graph on one contract.
    Ok(render(&snapshot["graph"], &replacements))
}

/// Exact comparison, not a second permissive routing parser. The privileged
/// legacy checks still validate listeners, files, keys, TLS and exit selectors.
/// No caller policy, raw IP or process rule can extend this compiled snapshot.
pub fn admit_runtime(runtime: &Value) -> Result<bool, String> {
    if !is_three_tier_runtime(runtime) { return Ok(false); }
    let fail = || "three-tier graph/DNS/outbound binding is not the compiled contract".to_owned();
    let outbounds = runtime["outbounds"].as_array().ok_or_else(fail)?;
    let home = outbounds.iter().find(|outbound| outbound["type"] == "socks").ok_or_else(fail)?;
    let home_tag = home["tag"].as_str().ok_or_else(fail)?;
    let host: std::net::Ipv4Addr = home["server"].as_str().ok_or_else(fail)?.parse().map_err(|_| fail())?;
    let public = !host.is_private() && !host.is_loopback() && !host.is_link_local()
        && !host.is_unspecified() && !host.is_multicast() && !host.is_broadcast()
        && host.octets()[0] != 0 && host.octets()[0] < 224
        && !(host.octets()[0] == 100 && (64..=127).contains(&host.octets()[1]));
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
    let direct = outbounds.iter().find(|outbound| outbound["tag"] == DIRECT).ok_or_else(fail)?;
    let interface = direct["bind_interface"].as_str().ok_or_else(fail)?;
    let fake = runtime["dns"]["servers"][0]["inet4_range"].as_str().ok_or_else(fail)?;
    let expected = graph(home_tag, interface, fake)?;
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
