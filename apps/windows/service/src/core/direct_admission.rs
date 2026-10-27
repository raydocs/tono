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

use crate::core::direct_policy::DirectPolicy;
use crate::direct_domains::{
    CLAUDE_HOME_DOMAINS, CLAUDE_HOME_IPV4_CIDRS, CLOUD_VIDEO_DOMAINS, direct_suffix_overlaps_protected,
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

/// What, beyond the compilers' shapes, a sing-box DIRECT rule must match (#1280).
#[derive(Clone, Copy)]
pub(crate) enum DirectBinding<'a> {
    /// Shape only: a document an earlier admission already approved (the watchdog respawn) and
    /// the mihomo runtime, whose binding is not part of this revision.
    ShapeOnly,
    /// The request carried no verified policy (an older App): no DIRECT rule is admitted.
    NoPolicy,
    /// Only the entries the verified signed policy lists.
    Policy(&'a DirectPolicy),
}

/// sing-box: `outbounds` and `route.rules` of an admitted-so-far document.
pub(crate) fn admit_sing_box_direct_rules(
    outbounds: &[Value],
    rules: &[Value],
    binding: DirectBinding<'_>,
) -> Result<(), String> {
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
    // A group that can choose a DIRECT outbound, itself or through another
    // group, makes every rule to it a DIRECT rule. Each pass adds a new tag or
    // stops, so a cycle ends.
    loop {
        let before = direct.len();
        for outbound in outbounds {
            let Some(tag) = outbound.get("tag").and_then(Value::as_str) else {
                continue;
            };
            let reaches = ["outbounds", "default"].iter().any(|key| {
                outbound
                    .get(*key)
                    .is_some_and(|members| json_names(members, &direct))
            });
            if reaches && !names(&direct, tag) {
                direct.push(tag);
            }
        }
        if direct.len() == before {
            break;
        }
    }
    for (index, rule) in rules.iter().enumerate() {
        if !json_names(rule, &direct) {
            continue;
        }
        if !sing_box_direct_shape(rule, &rules[..index], &direct) {
            return Err(format!(
                "a rule to `{DIRECT_GROUP_NAME}` is not a compiler shape: {}",
                shape_refusal(rule)
            ));
        }
        match binding {
            DirectBinding::ShapeOnly => {}
            DirectBinding::NoPolicy => {
                return Err(format!(
                    "a rule to `{DIRECT_GROUP_NAME}` needs the signed traffic policy"
                ));
            }
            DirectBinding::Policy(policy) => {
                if !listed_by_policy(rule, policy) {
                    return Err(format!(
                        "a rule to `{DIRECT_GROUP_NAME}` is not listed by the signed traffic policy"
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Whether the verified policy lists the entry an already shape-checked DIRECT rule routes.
/// Each shape maps to the policy list the compilers derive it from.
fn listed_by_policy(rule: &Value, policy: &DirectPolicy) -> bool {
    let Some(rule) = rule.as_object() else {
        return false;
    };
    if str_of(rule, "type") == Some("logical") {
        // Exact host + /32 pin: the host and port come from `domains` or `webDomains`.
        let Some(destination) = rule
            .get("rules")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(Value::as_object)
        else {
            return false;
        };
        return one_str(destination, "domain")
            .zip(port_of(destination))
            .is_some_and(|(host, port)| policy.lists_exact_host(&host.to_ascii_lowercase(), port));
    }
    match str_of(rule, "network") {
        // A signed-app process rule has no destination of its own; the policy authorises
        // native-app DIRECT by listing native hosts.
        Some("tcp") if rule.contains_key("process_path_regex") => policy.lists_native_apps(),
        Some("tcp") => one_str(rule, "domain_suffix")
            .zip(port_of(rule))
            .is_some_and(|(suffix, port)| policy.lists_suffix(suffix, port)),
        // A process-bound media pin: the /32 and the port come from `mediaEndpoints`.
        Some("udp") => one_str(rule, "ip_cidr")
            .and_then(|cidr| cidr.strip_suffix("/32"))
            .and_then(|address| address.parse::<Ipv4Addr>().ok())
            .zip(port_of(rule))
            .is_some_and(|(address, port)| policy.lists_media(address, port)),
        _ => false,
    }
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
                && protected_destinations_pinned(
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
                && protected_destinations_pinned(
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

/// A rule with no destination bound needs Home and cloud-video destinations pinned first.
/// This gate excludes DIRECT; the compilers/readback enforce the specific exit identity.
fn protected_destinations_pinned(domain: impl Fn(&str) -> bool, cidr: impl Fn(&str) -> bool) -> bool {
    CLAUDE_HOME_DOMAINS
        .iter()
        .chain(CLOUD_VIDEO_DOMAINS.iter())
        .all(|host| domain(*host))
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

/// A name with at least a registrable label and a TLD. A bare `com`, `cn` or an all-digit
/// last label (an address) is a catch-all, never one reviewed host.
fn host_ok(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.contains('.')
        && host
            .rsplit('.')
            .next()
            .is_some_and(|tld| !tld.bytes().all(|b| b.is_ascii_digit()))
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
    // A "this host", loopback, link-local, multicast or broadcast /32 is never one reviewed
    // destination, whatever the rest of the rule says (#1280).
    !address.is_unspecified()
        && !address.is_loopback()
        && !address.is_link_local()
        && !address.is_multicast()
        && !address.is_broadcast()
        && address != Ipv4Addr::new(1, 1, 1, 1)
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

/// Why an already refused sing-box DIRECT rule is not a compiler shape, for the audit log.
/// Diagnosis only: `sing_box_direct_shape` decides, this never admits anything.
fn shape_refusal(rule: &Value) -> &'static str {
    const OTHER: &str = "rule keys, ports, outbound or pins are not a compiler shape";
    let Some(rule) = rule.as_object() else {
        return OTHER;
    };
    if let Some(regexes) = strs(rule, "process_path_regex") {
        if regexes.iter().any(|regex| !has_literal_text(regex)) {
            return "process pattern has no literal text";
        }
        if regexes.iter().any(|regex| !regex_ok(regex)) {
            return "process pattern is not a compiler path regex";
        }
    }
    let (destination, address) = match rule.get("rules").and_then(Value::as_array).map(Vec::as_slice) {
        Some([destination, address]) => (destination.as_object(), address.as_object()),
        _ => (None, Some(rule)),
    };
    if let Some(host) = destination.and_then(|map| one_str(map, "domain")) {
        if !host_ok(host) {
            return "domain is a wildcard, empty label, single label or protected host";
        }
    }
    if let Some(cidr) = address.and_then(|map| one_str(map, "ip_cidr")) {
        if !pin_ok(cidr) {
            return "address is not one routable /32 (unspecified, loopback, link-local, multicast, broadcast, resolver or Anthropic range)";
        }
    }
    OTHER
}

/// Whether a process pattern, after its `^` anchor, names at least one literal character: one
/// outside the regex metacharacters `.*+?()[]{}|\^$`, where an escape such as `\.` counts as a
/// literal and a negated class (`[^...]`) contributes none.
fn has_literal_text(regex: &str) -> bool {
    let mut chars = regex.strip_prefix('^').unwrap_or(regex).chars().peekable();
    let mut class: Option<bool> = None; // Some(negated) while inside `[...]`
    while let Some(character) = chars.next() {
        match (character, class) {
            ('\\', negated) => {
                if chars.next().is_some() && negated != Some(true) {
                    return true;
                }
            }
            ('[', None) => {
                let negated = chars.peek() == Some(&'^');
                if negated {
                    chars.next();
                }
                class = Some(negated);
            }
            (']', Some(_)) => class = None,
            // `(?s)`, `(?i:`: flags are not text.
            ('(', None) if chars.peek() == Some(&'?') => {
                chars.next();
                while chars.next_if(|flag| flag.is_ascii_alphabetic() || *flag == '-').is_some() {}
            }
            ('.' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '^' | '$', _) => {}
            (_, Some(true)) => {}
            _ => return true,
        }
    }
    false
}

/// A process-path regex only in the form `tono-core` `config::windows_path_regex` writes:
/// `^`, then literal path characters (case classes `[Xx]`, the separator class `[\\/]`,
/// escaped specials), and at most a final `$`. The literal path must be a drive, a colon and a
/// separator, then at least one real path component below the drive root, closed either by a
/// directory separator (an install-directory prefix) or by the final `$` (one exact file). That
/// is what `is_windows_path_shape` plus the compiler's prefix/file normalisation guarantee for
/// every compiler input, whatever the length: `D:\A\` and `D:\Lark.exe` are admitted. A bare `^`,
/// `^.*`, a drive root, an open-ended name prefix (`^D:\A`) or any other metacharacter is a
/// catch-all for processes the signed-app discovery never named. The bound is the structure, not
/// a length that happens to fit today's products.
fn regex_ok(regex: &str) -> bool {
    regex
        .strip_prefix('^')
        .filter(|_| payload_safe(regex))
        .and_then(path_regex_chars)
        .is_some_and(|(path, exact_end)| match path.as_slice() {
            [drive, ':', '\\', below_root @ ..] => {
                drive.is_ascii_alphabetic()
                    && below_root.iter().any(|character| *character != '\\')
                    && (exact_end || below_root.last() == Some(&'\\'))
            }
            _ => false,
        })
}

/// The path characters `body` matches and whether it ends with `$`, or `None` for any
/// metacharacter the compiler never writes.
fn path_regex_chars(body: &str) -> Option<(Vec<char>, bool)> {
    let mut rest = body;
    let mut path = Vec::new();
    while !rest.is_empty() {
        if rest == "$" {
            return Some((path, true));
        }
        let bytes = rest.as_bytes();
        let (character, width) = if rest.starts_with(r"[\\/]") {
            ('\\', 5)
        } else if bytes.len() >= 4
            && bytes[0] == b'['
            && bytes[3] == b']'
            && bytes[1].is_ascii_uppercase()
            && bytes[2] == bytes[1].to_ascii_lowercase()
        {
            (char::from(bytes[1]), 4)
        } else if rest.starts_with("\\x2c") {
            (',', 4)
        } else if rest.starts_with("\\x28") {
            ('(', 4)
        } else if rest.starts_with("\\x29") {
            (')', 4)
        } else if rest.starts_with("\\\\") {
            ('\\', 2)
        } else if bytes[0] == b'\\' {
            match bytes.get(1) {
                Some(
                    b
                    @ (b'.' | b'^' | b'$' | b'*' | b'+' | b'?' | b'{' | b'}' | b'[' | b']' | b'|'),
                ) => (char::from(*b), 2),
                _ => return None,
            }
        } else {
            let character = rest.chars().next()?;
            if ".^$*+?{}[]|()".contains(character) {
                return None;
            }
            (character, character.len_utf8())
        };
        path.push(character);
        rest = &rest[width..];
    }
    Some((path, false))
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

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{
        CLAUDE_HOME_DOMAINS, CLAUDE_HOME_IPV4_CIDRS, CLOUD_VIDEO_DOMAINS, DirectBinding, DirectPolicy,
        admit_mihomo_direct_rules, admit_sing_box_direct_rules,
    };
    use crate::core::direct_policy::tests::{POLICY_JSON, key, sign};

    fn admitted(rule: Value) -> Result<(), String> {
        admitted_by(rule, DirectBinding::ShapeOnly)
    }

    fn admitted_by(rule: Value, binding: DirectBinding<'_>) -> Result<(), String> {
        let outbounds =
            [json!({"type":"direct","tag":"Tono-China-Direct","bind_interface":"Ethernet"})];
        let rules = [
            json!({"network":"tcp","domain_suffix":CLOUD_VIDEO_DOMAINS.as_slice(),"action":"route","outbound":"Tono-Exit"}),
            json!({"network":"tcp","domain_suffix":CLAUDE_HOME_DOMAINS.as_slice(),"action":"route","outbound":"Tono-Exit"}),
            json!({"network":"tcp","ip_cidr":CLAUDE_HOME_IPV4_CIDRS.as_slice(),"action":"route","outbound":"Tono-Exit"}),
            rule,
        ];
        admit_sing_box_direct_rules(&outbounds, &rules, binding)
    }

    /// The policy `direct_policy::tests::POLICY_JSON` signs, read after it verified.
    fn listed() -> DirectPolicy {
        let (signing, public) = key(1);
        DirectPolicy::verify_with_key(&sign(&signing, POLICY_JSON, 7), &public).unwrap()
    }

    fn exact_host_rule(host: &str, port: u16) -> Value {
        json!({"type":"logical","mode":"and","rules":[
            {"network":"tcp","port":port,"domain":[host]},{"ip_cidr":["203.0.113.50/32"]}],
            "action":"route","outbound":"Tono-China-Direct"})
    }

    fn media_rule(address: &str, port: u16) -> Value {
        json!({"network":"udp","ip_cidr":[format!("{address}/32")],"port":port,
            "process_name":["Lark.exe"],"action":"route","outbound":"Tono-China-Direct"})
    }

    fn suffix_rule(suffix: &str, port: u16) -> Value {
        json!({"network":"tcp","port":port,"domain_suffix":[suffix],
            "action":"route","outbound":"Tono-China-Direct"})
    }

    /// #1280: a request that passes the App identity gate could name any host the shape allows.
    /// With the signed policy bound, only the hosts and ports it lists leave the tunnel.
    #[test]
    fn a_direct_host_the_signed_policy_does_not_list_is_refused() {
        let policy = listed();
        let by = DirectBinding::Policy(&policy);
        assert_eq!(admitted_by(exact_host_rule("szextshort.weixin.qq.com", 443), by), Ok(()));
        assert_eq!(admitted_by(exact_host_rule("res.wx.qq.com", 443), by), Ok(()));
        assert!(admitted_by(exact_host_rule("evil.example.com", 443), by).is_err());
        assert!(
            admitted_by(exact_host_rule("szextshort.weixin.qq.com", 8080), by).is_err(),
            "a listed host on a port the policy does not list"
        );
    }

    /// An older App sends no policy: no DIRECT rule is admitted, but a document without one is.
    #[test]
    fn a_direct_rule_without_a_policy_is_refused_and_a_full_tunnel_needs_none() {
        let direct = exact_host_rule("szextshort.weixin.qq.com", 443);
        assert!(admitted_by(direct, DirectBinding::NoPolicy).is_err());
        let to_exit = json!({"network":"tcp","domain_suffix":["example.org"],
            "action":"route","outbound":"Tono-Exit"});
        assert_eq!(admitted_by(to_exit, DirectBinding::NoPolicy), Ok(()));
    }

    #[test]
    fn a_media_address_the_signed_policy_does_not_list_is_refused() {
        let policy = listed();
        let by = DirectBinding::Policy(&policy);
        assert_eq!(admitted_by(media_rule("203.0.113.9", 8000), by), Ok(()));
        assert!(admitted_by(media_rule("203.0.113.10", 8000), by).is_err());
        assert!(admitted_by(media_rule("203.0.113.9", 443), by).is_ok());
    }

    /// An unlisted suffix is refused; the product suffixes the App always adds ride on the policy
    /// authorising native apps.
    #[test]
    fn a_direct_suffix_follows_the_signed_policy() {
        let policy = listed();
        let by = DirectBinding::Policy(&policy);
        assert_eq!(admitted_by(suffix_rule("bilibili.com", 443), by), Ok(()));
        assert_eq!(admitted_by(suffix_rule("taobao.com", 80), by), Ok(()));
        let no_native = DirectPolicy::from_json(r#"{"version":3,"domains":[]}"#, 1).unwrap();
        assert!(admitted_by(suffix_rule("taobao.com", 80), DirectBinding::Policy(&no_native)).is_err());
    }

    #[test]
    fn a_process_rule_needs_native_app_entries_and_all_protected_pins() {
        let regex = r"^[Dd]:[\\/][Ll][Aa][Rr][Kk][\\/]";
        let policy = listed();
        let by = DirectBinding::Policy(&policy);
        let outbounds =
            [json!({"type":"direct","tag":"Tono-China-Direct","bind_interface":"Ethernet"})];
        let mut rules = vec![
            json!({"network":"tcp","domain_suffix":CLOUD_VIDEO_DOMAINS.as_slice(),"action":"route","outbound":"Tono-Exit"}),
            json!({"network":"tcp","domain_suffix":CLAUDE_HOME_DOMAINS.as_slice(),"action":"route","outbound":"Tono-Exit"}),
            json!({"network":"tcp","ip_cidr":CLAUDE_HOME_IPV4_CIDRS.as_slice(),"action":"route","outbound":"Tono-Exit"}),
            process_rule(regex),
        ];
        assert_eq!(admit_sing_box_direct_rules(&outbounds, &rules, by), Ok(()));
        // Keep all Home pins and native-app policy authority; one missing video is enough.
        let videos = rules[0]["domain_suffix"].as_array_mut().unwrap();
        let youtube = videos.iter().position(|host| host == "youtube.com").unwrap();
        let removed = videos.remove(youtube);
        assert!(admit_sing_box_direct_rules(&outbounds, &rules, by).is_err());
        rules[0]["domain_suffix"]
            .as_array_mut()
            .unwrap()
            .insert(youtube, removed);
        let videos = rules.remove(0);
        rules.push(videos);
        assert!(admit_sing_box_direct_rules(&outbounds, &rules, by).is_err());

        let mut mihomo: Vec<String> = CLOUD_VIDEO_DOMAINS
            .iter()
            .chain(CLAUDE_HOME_DOMAINS.iter())
            .map(|host| format!("AND,((NETWORK,TCP),(DOMAIN-SUFFIX,{host})),Tono-Exit"))
            .chain(CLAUDE_HOME_IPV4_CIDRS.iter().map(|cidr| {
                format!("AND,((NETWORK,TCP),(IP-CIDR,{cidr},no-resolve)),Tono-Exit")
            }))
            .collect();
        mihomo.push(format!(
            "AND,((NETWORK,TCP),(DST-PORT,443),(PROCESS-PATH-REGEX,{regex})),Tono-China-Direct"
        ));
        let proxies = [("Tono-China-Direct", "direct")];
        let admit_mihomo = |rules: &[String]| {
            admit_mihomo_direct_rules(
                &rules.iter().map(String::as_str).collect::<Vec<_>>(),
                &proxies,
                &[],
            )
        };
        assert_eq!(admit_mihomo(&mihomo), Ok(()));
        let youtube = mihomo
            .iter()
            .position(|rule| rule == "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,youtube.com)),Tono-Exit")
            .unwrap();
        let removed = mihomo.remove(youtube);
        assert!(admit_mihomo(&mihomo).is_err());
        mihomo.push(removed);
        assert!(admit_mihomo(&mihomo).is_err());

        let no_native = DirectPolicy::from_json(r#"{"version":3,"domains":[]}"#, 1).unwrap();
        assert!(admitted_by(process_rule(regex), DirectBinding::Policy(&no_native)).is_err());
    }

    fn process_rule(regex: &str) -> Value {
        json!({"network":"tcp","port":[443],"process_path_regex":[regex],
            "action":"route","outbound":"Tono-China-Direct"})
    }

    /// #1280: with the assistant pins in place a bare `^` or `^.*` used to pass, sending every
    /// process's reviewed-port traffic DIRECT. Only the compiler's path-regex form is admitted.
    #[test]
    fn a_catch_all_process_regex_is_not_a_compiler_shape() {
        // What `windows_path_regex` writes (pinned by `tono-core`'s
        // `windows_path_regex_for_short_installs_is_pinned`) for a long install, one-letter and
        // non-ASCII folders, and short files.
        for signed_install in [
            r"^[Cc]:[\\/][Pp]rogram [Ff]iles[\\/][Tt]encent[\\/][Ww][Ee][Cc][Hh][Aa][Tt][\\/]",
            r"^[Dd]:[\\/][Aa][\\/]",
            r"^[Dd]:[\\/]飞书[\\/]",
            r"^[Dd]:[\\/][Aa]$",
            r"^[Dd]:[\\/][Ll][Aa][Rr][Kk]\.[Ee][Xx][Ee]$",
        ] {
            assert_eq!(
                admitted(process_rule(signed_install)),
                Ok(()),
                "{signed_install}"
            );
        }
        for catch_all in [
            "^",
            "^.*",
            "^.+",
            r"^[Cc]:[\\/]",
            r"^[Dd]:[\\/][Aa]",
            r"^[Dd]:[\\/]$",
            "^[Cc]:",
            "^(?s).*",
            r"^C:\\.*",
        ] {
            assert!(admitted(process_rule(catch_all)).is_err(), "{catch_all}");
        }
    }

    /// #1280: a single-label name such as `com` is a catch-all domain, not one reviewed host.
    #[test]
    fn a_catch_all_domain_is_not_a_compiler_shape() {
        let exact = |host: &str| {
            json!({"type":"logical","mode":"and","rules":[
                {"network":"tcp","port":443,"domain":[host]},{"ip_cidr":["101.1.2.3/32"]}],
                "action":"route","outbound":"Tono-China-Direct"})
        };
        assert_eq!(admitted(exact("qq.com")), Ok(()));
        assert!(admitted(exact("com")).is_err());
        for shape in ["", "*", "*.qq.com", "qq..com", ".qq.com", "qq.com.", "qq.123"] {
            let error = admitted(exact(shape)).unwrap_err();
            assert!(error.contains("domain is a wildcard"), "{shape}: {error}");
        }
    }

    /// #1280: a /32 that is "this host", loopback, link-local, multicast or broadcast is no
    /// reviewed destination, in the exact-host pin and in the media pin.
    #[test]
    fn a_non_routable_pin_is_not_a_compiler_shape() {
        let pinned = |address: &str| {
            json!({"type":"logical","mode":"and","rules":[
                {"network":"tcp","port":443,"domain":["qq.com"]},{"ip_cidr":[format!("{address}/32")]}],
                "action":"route","outbound":"Tono-China-Direct"})
        };
        assert_eq!(admitted(pinned("101.1.2.3")), Ok(()));
        assert_eq!(admitted(media_rule("203.0.113.9", 8000)), Ok(()));
        for address in [
            "0.0.0.0",
            "127.0.0.1",
            "127.1.2.3",
            "169.254.1.1",
            "224.0.0.251",
            "239.255.255.250",
            "255.255.255.255",
        ] {
            let error = admitted(pinned(address)).unwrap_err();
            assert!(error.contains("address is not one routable /32"), "{address}: {error}");
            let error = admitted(media_rule(address, 8000)).unwrap_err();
            assert!(error.contains("address is not one routable /32"), "{address}: {error}");
        }
        // Not a /32 at all.
        assert!(admitted(json!({"type":"logical","mode":"and","rules":[
            {"network":"tcp","port":443,"domain":["qq.com"]},{"ip_cidr":["0.0.0.0/0"]}],
            "action":"route","outbound":"Tono-China-Direct"})).is_err());
    }

    /// #1280: the refusal says which rule refused the process pattern.
    #[test]
    fn a_process_pattern_refusal_names_its_rule() {
        for no_literal in ["^", "^.*", "^.+", "^(.*)", r"^[^\\]*", "^(?s).*", "^.*$"] {
            let error = admitted(process_rule(no_literal)).unwrap_err();
            assert!(
                error.contains("process pattern has no literal text"),
                "{no_literal}: {error}"
            );
        }
        // Literal text, but not the compiler's path form.
        for loose in [r"^C:\\.*", r"^[Dd]:[\\/][Aa]", r"^Lark", "^.*lark"] {
            let error = admitted(process_rule(loose)).unwrap_err();
            assert!(
                error.contains("process pattern is not a compiler path regex"),
                "{loose}: {error}"
            );
        }
        // The same gate on the media (UDP) shape.
        let media = json!({"network":"udp","ip_cidr":["203.0.113.9/32"],"port":8000,
            "process_path_regex":["^.*"],"action":"route","outbound":"Tono-China-Direct"});
        assert!(admitted(media).unwrap_err().contains("process pattern has no literal text"));
    }

    #[test]
    fn literal_text_is_counted_outside_metacharacters_and_negated_classes() {
        use super::has_literal_text;
        for none in ["^", "^.*", "^.+", "^(.*)", r"^[^\\]*", "^[^a]*", "^(?s).*", "^[]*"] {
            assert!(!has_literal_text(none), "{none}");
        }
        for some in ["^a", r"^\.", r"^\\", "^[Dd]:", "^.*x", r"^C:\\Lark\\"] {
            assert!(has_literal_text(some), "{some}");
        }
    }
}
