//! Which rules may send traffic to a DIRECT (physical-interface) outbound.
//!
//! While a DIRECT plan is live, WFP lets the core out on the reviewed ports
//! without a destination bound, so the rules decide what leaves the tunnel.
//! A rule that names a DIRECT outbound is admitted only in a shape the product
//! compilers emit (`tono-core` `config::build_owned_runtime_with_ports` and
//! `sing_box::build_runtime`): an exact host + /32 pin, a signed-app path
//! regex on the reviewed ports, a /32 media pin for a reviewed process, or a
//! reviewed China web suffix. None may name a protected host or Anthropic's
//! range. A suffix with a protected child, and a process rule with no
//! destination at all, need earlier rules that pin those hosts to a
//! non-DIRECT outbound. The lists come from `tono-core` by path.

use std::net::Ipv4Addr;

use serde_json::{Map, Value};

use crate::direct_domains::{
    CLAUDE_HOME_DOMAINS, CLAUDE_HOME_IPV4_CIDRS, direct_suffix_overlaps_protected,
    is_address_free_web_suffix, is_protected_from_direct,
};

const DIRECT_GROUP_NAME: &str = "Tono-China-Direct";
const WEB_DIRECT_GROUP_NAME: &str = "Tono-China-Web-Direct";
/// sing-box's compiler takes these; the WFP permit takes `REVIEWED_DIRECT_PORTS`.
/// A port in only one of them is still bounded by WFP.
const SING_BOX_PROCESS_PORTS: [u16; 4] = [80, 443, 8080, 8443];
const MEDIA_PORTS: [u16; 2] = [443, 8000];
const WEB_SUFFIX_PORTS: [u16; 2] = [80, 443];
const MIHOMO_LOOPBACK_RULES: [&str; 2] = [
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR6,::1/128,DIRECT,no-resolve",
];

/// sing-box: `outbounds` and `route.rules` of an admitted-so-far document.
pub fn admit_sing_box_direct_rules(outbounds: &[Value], rules: &[Value]) -> Result<(), String> {
    let mut direct = Vec::new();
    for outbound in outbounds {
        if outbound.get("type").and_then(Value::as_str) == Some("direct") {
            let tag = outbound.get("tag").and_then(Value::as_str).unwrap_or("");
            if tag != DIRECT_GROUP_NAME {
                return Err(format!("a direct outbound must be `{DIRECT_GROUP_NAME}`"));
            }
            direct.push(tag);
        }
    }
    for (index, rule) in rules.iter().enumerate() {
        if json_names(rule, &direct) && !sing_box_direct_shape(rule, &rules[..index], &direct) {
            return Err(format!(
                "a rule to `{DIRECT_GROUP_NAME}` is not a compiler shape"
            ));
        }
    }
    Ok(())
}

/// mihomo: the rule strings, every proxy as (name, type), every group as (name, members).
pub fn admit_mihomo_direct_rules(
    rules: &[&str],
    proxies: &[(&str, &str)],
    groups: &[(&str, Vec<&str>)],
) -> Result<(), String> {
    let mut direct = vec!["DIRECT"];
    for (name, kind) in proxies {
        if *kind == "direct" {
            if *name != DIRECT_GROUP_NAME && *name != WEB_DIRECT_GROUP_NAME {
                return Err(format!("direct proxy `{name}` is not owned"));
            }
            direct.push(*name);
        }
    }
    // A group that can choose a DIRECT proxy makes every rule to it a DIRECT rule.
    for (group, members) in groups {
        let exit = |member: &&str| {
            proxies.iter().any(|(name, kind)| {
                name == member && matches!(*kind, "vless" | "hysteria2" | "socks5")
            })
        };
        if !members.iter().all(exit) {
            return Err(format!("group `{group}` may choose only exits"));
        }
    }
    for (index, rule) in rules.iter().enumerate() {
        let names_direct = rule.split([',', '(', ')']).any(|token| {
            direct
                .iter()
                .any(|name| token.trim().eq_ignore_ascii_case(name))
        });
        if names_direct
            && !MIHOMO_LOOPBACK_RULES.contains(rule)
            && !mihomo_direct_shape(rule, &rules[..index], &direct)
        {
            return Err(format!("DIRECT rule `{rule}` is not a compiler shape"));
        }
    }
    Ok(())
}

fn sing_box_direct_shape(rule: &Value, earlier: &[Value], direct: &[&str]) -> bool {
    let Some(rule) = rule.as_object() else {
        return false;
    };
    if str_of(rule, "action") != Some("route")
        || str_of(rule, "outbound") != Some(DIRECT_GROUP_NAME)
    {
        return false;
    }
    if str_of(rule, "type") == Some("logical") {
        let Some([destination, address]) = rule
            .get("rules")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .and_then(|items| <&[Value; 2]>::try_from(items).ok())
        else {
            return false;
        };
        let (Some(destination), Some(address)) = (destination.as_object(), address.as_object())
        else {
            return false;
        };
        return keys_are(rule, &["type", "mode", "rules", "action", "outbound"])
            && str_of(rule, "mode") == Some("and")
            && keys_are(destination, &["network", "port", "domain"])
            && str_of(destination, "network") == Some("tcp")
            && port_of(destination).is_some_and(|port| port != 0 && port != 53)
            && one_str(destination, "domain").is_some_and(host_ok)
            && keys_are(address, &["ip_cidr"])
            && one_str(address, "ip_cidr").is_some_and(pin_ok);
    }
    match str_of(rule, "network") {
        Some("tcp") if rule.contains_key("process_path_regex") => {
            keys_are(
                rule,
                &[
                    "network",
                    "port",
                    "process_path_regex",
                    "action",
                    "outbound",
                ],
            ) && rule
                .get("port")
                .and_then(Value::as_array)
                .filter(|ports| !ports.is_empty())
                .is_some_and(|ports| {
                    ports.iter().all(|port| {
                        as_port(port).is_some_and(|port| {
                            SING_BOX_PROCESS_PORTS.contains(&port)
                                || crate::REVIEWED_DIRECT_PORTS.contains(&port)
                        })
                    })
                })
                && strs(rule, "process_path_regex")
                    .is_some_and(|all| all.iter().all(|r| regex_ok(r)))
                && assistants_pinned(
                    |domain| sing_box_pins(earlier, direct, "domain_suffix", domain),
                    |cidr| sing_box_pins(earlier, direct, "ip_cidr", cidr),
                )
        }
        Some("tcp") => {
            keys_are(
                rule,
                &["network", "port", "domain_suffix", "action", "outbound"],
            ) && port_of(rule).is_some_and(|port| WEB_SUFFIX_PORTS.contains(&port))
                && one_str(rule, "domain_suffix").is_some_and(|suffix| {
                    suffix_ok(suffix, |child| {
                        sing_box_pins(earlier, direct, "domain_suffix", child)
                    })
                })
        }
        Some("udp") => {
            let process = match (
                rule.contains_key("process_name"),
                rule.contains_key("process_path_regex"),
            ) {
                (true, false) => strs(rule, "process_name")
                    .is_some_and(|names| names.iter().all(|name| payload_safe(name))),
                (false, true) => strs(rule, "process_path_regex")
                    .is_some_and(|all| all.iter().all(|r| regex_ok(r))),
                _ => false,
            };
            let process_key = if rule.contains_key("process_name") {
                "process_name"
            } else {
                "process_path_regex"
            };
            process
                && keys_are(
                    rule,
                    &[
                        "network",
                        "ip_cidr",
                        "port",
                        process_key,
                        "action",
                        "outbound",
                    ],
                )
                && one_str(rule, "ip_cidr").is_some_and(pin_ok)
                && port_of(rule).is_some_and(|port| MEDIA_PORTS.contains(&port))
        }
        _ => false,
    }
}

/// An earlier `{network: tcp, <key>: [.., value, ..], action: route}` to a non-DIRECT outbound.
fn sing_box_pins(earlier: &[Value], direct: &[&str], key: &str, value: &str) -> bool {
    earlier.iter().filter_map(Value::as_object).any(|pin| {
        keys_are(pin, &["network", key, "action", "outbound"])
            && str_of(pin, "network") == Some("tcp")
            && str_of(pin, "action") == Some("route")
            && str_of(pin, "outbound").is_some_and(|target| !names(direct, target))
            && strs(pin, key).is_some_and(|values| values.contains(&value))
    })
}

fn mihomo_direct_shape(rule: &str, earlier: &[&str], direct: &[&str]) -> bool {
    let Some((conditions, target)) = rule
        .strip_prefix("AND,((")
        .and_then(|rest| rest.rsplit_once(")),"))
    else {
        return false;
    };
    let conditions: Vec<(&str, &str)> = conditions
        .split("),(")
        .filter_map(|condition| condition.split_once(','))
        .collect();
    // Rebuilding the compiler's exact spelling refuses anything parsed loosely above.
    let rebuilt = format!(
        "AND,(({})),{target}",
        conditions
            .iter()
            .map(|(key, value)| format!("{key},{value}"))
            .collect::<Vec<_>>()
            .join("),(")
    );
    if rebuilt != rule {
        return false;
    }
    let port = |value: &str| {
        value
            .parse::<u16>()
            .ok()
            .filter(|port| port.to_string() == value)
    };
    let pin = |value: &str| value.strip_suffix(",no-resolve").is_some_and(pin_ok);
    match conditions.as_slice() {
        [
            ("NETWORK", "TCP"),
            ("DST-PORT", p),
            ("DOMAIN", host),
            ("IP-CIDR", address),
        ] => {
            (target == DIRECT_GROUP_NAME || target == WEB_DIRECT_GROUP_NAME)
                && port(*p).is_some_and(|port| port != 0 && port != 53)
                && host_ok(*host)
                && pin(*address)
        }
        [
            ("NETWORK", "TCP"),
            ("DST-PORT", p),
            ("PROCESS-PATH-REGEX", regex),
        ] => {
            target == DIRECT_GROUP_NAME
                && port(*p).is_some_and(|port| crate::REVIEWED_DIRECT_PORTS.contains(&port))
                && regex_ok(*regex)
                && assistants_pinned(
                    |domain| mihomo_pins(earlier, direct, &format!("DOMAIN-SUFFIX,{domain}")),
                    |cidr| mihomo_pins(earlier, direct, &format!("IP-CIDR,{cidr},no-resolve")),
                )
        }
        [
            ("NETWORK", "UDP"),
            ("DST-PORT", p),
            ("IP-CIDR", address),
            (kind, process),
        ] => {
            target == DIRECT_GROUP_NAME
                && port(*p).is_some_and(|port| MEDIA_PORTS.contains(&port))
                && pin(*address)
                && match *kind {
                    "PROCESS-NAME" => payload_safe(process),
                    "PROCESS-PATH-REGEX" => regex_ok(process),
                    _ => false,
                }
        }
        [
            ("NETWORK", "TCP"),
            ("DST-PORT", p),
            ("DOMAIN-SUFFIX", suffix),
        ] => {
            target == WEB_DIRECT_GROUP_NAME
                && port(*p).is_some_and(|port| WEB_SUFFIX_PORTS.contains(&port))
                && suffix_ok(*suffix, |child| {
                    mihomo_pins(earlier, direct, &format!("DOMAIN-SUFFIX,{child}"))
                })
        }
        _ => false,
    }
}

/// An earlier `AND,((NETWORK,TCP),(<condition>)),<target>` whose target is not DIRECT.
fn mihomo_pins(earlier: &[&str], direct: &[&str], condition: &str) -> bool {
    let prefix = format!("AND,((NETWORK,TCP),({condition})),");
    earlier.iter().any(|rule| {
        rule.strip_prefix(&prefix)
            .is_some_and(|target| payload_safe(target) && !names(direct, target))
    })
}

/// A rule with no destination bound needs every assistant host and range pinned first.
fn assistants_pinned(domain: impl Fn(&str) -> bool, cidr: impl Fn(&str) -> bool) -> bool {
    CLAUDE_HOME_DOMAINS.iter().all(|host| domain(*host))
        && CLAUDE_HOME_IPV4_CIDRS.iter().all(|range| cidr(*range))
}

/// A reviewed China suffix that is not protected; a protected child must be pinned first.
fn suffix_ok(suffix: &str, child_pinned: impl Fn(&str) -> bool) -> bool {
    is_address_free_web_suffix(suffix)
        && !direct_suffix_overlaps_protected(suffix)
        && CLAUDE_HOME_DOMAINS
            .iter()
            .filter(|child| child.ends_with(&format!(".{suffix}")))
            .all(|child| child_pinned(*child))
}

fn host_ok(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
        && !is_protected_from_direct(&host.to_ascii_lowercase())
}

/// One /32 that is not a pinned DoH resolver or in Anthropic's range.
fn pin_ok(cidr: &str) -> bool {
    let Some(address) = cidr
        .strip_suffix("/32")
        .and_then(|address| address.parse::<Ipv4Addr>().ok())
        .filter(|address| format!("{address}/32") == cidr)
    else {
        return false;
    };
    address != Ipv4Addr::new(1, 1, 1, 1)
        && address != Ipv4Addr::new(8, 8, 8, 8)
        && !CLAUDE_HOME_IPV4_CIDRS
            .iter()
            .any(|range| in_range(address, range))
}

fn in_range(address: Ipv4Addr, range: &str) -> bool {
    let Some((network, bits)) = range.split_once('/') else {
        return true;
    };
    let (Ok(network), Ok(bits)) = (network.parse::<Ipv4Addr>(), bits.parse::<u32>()) else {
        return true;
    };
    let mask = u32::MAX.checked_shl(32 - bits.min(32)).unwrap_or(0);
    u32::from(address) & mask == u32::from(network) & mask
}

fn regex_ok(regex: &str) -> bool {
    regex.starts_with('^') && payload_safe(regex)
}

/// `tono-core` `config::is_rule_payload_safe`: no separators mihomo would re-split.
fn payload_safe(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 2_048
        && !value.contains([',', '(', ')'])
        && value.chars().all(|character| {
            let value = character as u32;
            value >= 0x20 && value != 0x7F && value != 0x85 && value != 0x2028 && value != 0x2029
        })
}

fn names(direct: &[&str], value: &str) -> bool {
    direct
        .iter()
        .any(|name| value.trim().eq_ignore_ascii_case(name))
}

fn json_names(value: &Value, direct: &[&str]) -> bool {
    match value {
        Value::String(text) => names(direct, text),
        Value::Array(items) => items.iter().any(|item| json_names(item, direct)),
        Value::Object(map) => map.values().any(|item| json_names(item, direct)),
        _ => false,
    }
}

fn keys_are(map: &Map<String, Value>, keys: &[&str]) -> bool {
    map.len() == keys.len() && keys.iter().all(|key| map.contains_key(*key))
}

fn str_of<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    map.get(key).and_then(Value::as_str)
}

fn strs<'a>(map: &'a Map<String, Value>, key: &str) -> Option<Vec<&'a str>> {
    let items = map.get(key)?.as_array()?;
    let values: Option<Vec<&str>> = items.iter().map(Value::as_str).collect();
    values.filter(|values| !values.is_empty())
}

fn one_str<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    match strs(map, key)?.as_slice() {
        [only] => Some(only),
        _ => None,
    }
}

fn as_port(value: &Value) -> Option<u16> {
    value.as_u64().and_then(|port| u16::try_from(port).ok())
}

fn port_of(map: &Map<String, Value>) -> Option<u16> {
    map.get("port").and_then(as_port)
}
