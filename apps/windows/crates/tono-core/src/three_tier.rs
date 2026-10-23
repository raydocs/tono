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
        "$domestic_full": snapshot["domestic_full"], "$overseas_full": snapshot["overseas_full"]
    });
    fn render(value: &Value, replacements: &Value) -> Value {
        match value {
            Value::String(key) if key.starts_with('$') => replacements[key].clone(),
            Value::Array(items) => Value::Array(items.iter().map(|item| render(item, replacements)).collect()),
            Value::Object(items) => Value::Object(items.iter().map(|(key, item)| (key.clone(), render(item, replacements))).collect()),
            _ => value.clone(),
        }
    }
    let mut rendered = render(&snapshot["graph"], &replacements);
    let cloud_suffixes = cloud_exit_suffixes();

    if let Some(rules) = rendered
        .pointer_mut("/route/rules")
        .and_then(Value::as_array_mut)
    {
        // Insert DoT 853, STUN UDP, public STUN UDP, and overseas UDP CIDR reject rules
        // right before the first $video_suffixes resolve rule.
        if let Some(video_idx) = rules.iter().position(|rule| {
            rule.get("domain_suffix")
                .and_then(Value::as_array)
                .is_some_and(|hosts| hosts.contains(&json!("youtube.com")))
        }) {
            let anti_leak = [
                json!({"port": ENCRYPTED_DNS_PORTS.as_slice(), "action": "reject"}),
                json!({"network": ["udp", "icmp"], "port": STUN_UDP_PORTS.as_slice(), "action": "reject"}),
                json!({"network": ["udp", "icmp"], "domain_suffix": PUBLIC_STUN_SUFFIXES.as_slice(), "action": "reject"}),
                json!({"network": ["udp", "icmp"], "ip_cidr": OVERSEAS_UDP_REJECT_IPV4_CIDRS.as_slice(), "action": "reject"}),
                json!({"ip_version": 6, "network": ["udp", "icmp"], "ip_cidr": OVERSEAS_UDP_REJECT_IPV6_CIDRS.as_slice(), "action": "reject"}),
            ];
            rules.splice(video_idx..video_idx, anti_leak);
        }

        // Insert MOBILE_HOME_AUX_SUFFIXES right after the first $home_cidrs rule.
        if let Some(home_cidr_idx) = rules.iter().position(|rule| {
            rule.get("outbound").and_then(Value::as_str) == Some(home)
                && rule.get("ip_cidr").is_some()
        }) {
            let home_aux = [
                json!({"network": "tcp", "domain_suffix": MOBILE_HOME_AUX_SUFFIXES.as_slice(), "action": "resolve", "server": HOME_DNS, "strategy": "ipv4_only"}),
                json!({"network": "tcp", "domain_suffix": MOBILE_HOME_AUX_SUFFIXES.as_slice(), "action": "route", "outbound": home}),
            ];
            rules.splice(home_cidr_idx + 1..home_cidr_idx + 1, home_aux);
        }

        // Insert X_CLOUD_SUFFIXES + OVERSEAS_CLOUD_SUFFIXES + PUBLIC_STUN_SUFFIXES + CLOUD_IPV4/IPV6_CIDRS
        // right after the $overseas_full route rule and before the ordinary China-DNS resolve rule.
        if let Some(overseas_idx) = rules.iter().position(|rule| {
            rule.get("outbound").and_then(Value::as_str) == Some("Tono-Exit")
                && rule.get("domain").is_some()
        }) {
            let cloud_rules = [
                json!({"network": "tcp", "domain_suffix": cloud_suffixes, "action": "resolve", "server": "Tono-DoH", "strategy": "ipv4_only"}),
                json!({"network": "tcp", "domain_suffix": cloud_suffixes, "action": "route", "outbound": "Tono-Exit"}),
                json!({"network": "tcp", "ip_cidr": CLOUD_IPV4_CIDRS.as_slice(), "action": "route", "outbound": "Tono-Exit"}),
                json!({"ip_version": 6, "network": "tcp", "ip_cidr": CLOUD_IPV6_CIDRS.as_slice(), "action": "route", "outbound": "Tono-Exit"}),
            ];
            rules.splice(overseas_idx + 1..overseas_idx + 1, cloud_rules);
        }
    }

    if let Some(dns_rules) = rendered
        .pointer_mut("/dns/rules")
        .and_then(Value::as_array_mut)
    {
        let insert_at = dns_rules.len().saturating_sub(1);
        let extra_dns = [
            json!({"inbound": ["Tono-TUN", "Tono-DNS", "Tono-Mixed"], "query_type": ["A"], "domain_suffix": MOBILE_HOME_AUX_SUFFIXES.as_slice(), "action": "route", "server": "Tono-FakeIP", "rewrite_ttl": 30}),
            json!({"domain_suffix": MOBILE_HOME_AUX_SUFFIXES.as_slice(), "action": "route", "server": HOME_DNS}),
            json!({"inbound": ["Tono-TUN", "Tono-DNS", "Tono-Mixed"], "query_type": ["A"], "domain_suffix": cloud_suffixes, "action": "route", "server": "Tono-FakeIP", "rewrite_ttl": 30}),
            json!({"domain_suffix": cloud_suffixes, "action": "route", "server": "Tono-DoH"}),
        ];
        dns_rules.splice(insert_at..insert_at, extra_dns);
    }

    Ok(rendered)
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
