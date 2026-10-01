//! Admission for a sing-box document the Service is about to run as LocalSystem.
//!
//! This is the JSON counterpart of the mihomo YAML whitelist, and the Windows
//! port of the macOS helper's `ownedRuntimeConfigIsSafe`. It does not compile a
//! runtime. It admits only the shape the product compiler emits: the six
//! top-level sections, loopback-only inbounds, the `Tono` TUN, encrypted DNS,
//! `route.final` on `Tono-Exit`, DIRECT rules only in compiler shapes
//! (`direct_admission`), and no file paths, remote rule sets, socket marks or
//! `insecure` TLS. Keys are compared as sing-box's Go decoder folds
//! them, and a document whose keys collide after folding is refused.

use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};

const TOP_LEVEL_KEYS: &[&str] = &[
    "log",
    "dns",
    "inbounds",
    "outbounds",
    "route",
    "experimental",
];
const EXPERIMENTAL_KEYS: &[&str] = &["clash_api", "cache_file"];
const OUTBOUND_TYPES: &[&str] = &["vless", "hysteria2", "socks", "direct", "selector"];
const DNS_SERVER_TYPES: &[&str] = &["fakeip", "https", "hosts"];
/// Keys refused anywhere: files the SYSTEM core would read or write, a web UI,
/// remote rule sets, disabled certificate verification, and socket marks.
const FORBIDDEN_KEYS: &[&str] = &[
    "certificate_path",
    "client_certificate_path",
    "client_key_path",
    "key_path",
    "external_ui",
    "external_ui_download_url",
    "output",
    "rule_set",
    "insecure",
    "default_mark",
    "routing_mark",
];
const TUN_INTERFACE_NAME: &str = "Tono";
const TUN_ADDRESS: &str = "198.18.0.1/30";

pub fn admit_owned_runtime(text: &str) -> Result<(), String> {
    let FoldedJson(value) = serde_json::from_str(text)
        .map_err(|_| "runtime is not JSON with unambiguous keys".to_string())?;
    let root = value
        .as_object()
        .ok_or_else(|| "runtime is not a JSON object".to_string())?;
    only_keys(root, TOP_LEVEL_KEYS, "top level")?;
    no_forbidden_keys(&value)?;

    let inbounds = root
        .get("inbounds")
        .and_then(Value::as_array)
        .ok_or_else(|| "runtime has no inbounds".to_string())?;
    if inbounds.is_empty() {
        return Err("runtime has no inbounds".to_string());
    }
    for inbound in inbounds {
        admit_inbound(inbound)?;
    }
    if !inbounds.iter().any(|inbound| {
        inbound.get("type").and_then(Value::as_str) == Some("direct")
            && inbound.get("tag").and_then(Value::as_str) == Some("Tono-DNS")
            && inbound.get("listen").and_then(Value::as_str) == Some("127.0.0.1")
            && inbound.get("listen_port").and_then(Value::as_u64) == Some(53)
    }) {
        return Err("the Tono-DNS loopback inbound is missing".to_string());
    }

    let outbounds = root
        .get("outbounds")
        .and_then(Value::as_array)
        .ok_or_else(|| "runtime has no outbounds".to_string())?;
    for outbound in outbounds {
        let kind = outbound.get("type").and_then(Value::as_str).unwrap_or("");
        if !OUTBOUND_TYPES.contains(&kind) {
            return Err(format!("outbound type `{kind}` is not owned"));
        }
        // The home SOCKS hop rides the selected exit; on its own it would dial
        // a caller-chosen server from the physical interface.
        if kind == "socks" && outbound.get("detour").and_then(Value::as_str) != Some("Tono-Exit") {
            return Err("a socks outbound must detour through Tono-Exit".to_string());
        }
    }
    admit_exit_selector(outbounds)?;

    let route = root
        .get("route")
        .and_then(Value::as_object)
        .ok_or_else(|| "runtime has no route".to_string())?;
    if route.get("final").and_then(Value::as_str) != Some("Tono-Exit") {
        return Err("route.final must be Tono-Exit".to_string());
    }
    let rules = match route.get("rules") {
        None => &[][..],
        Some(rules) => rules
            .as_array()
            .ok_or_else(|| "route.rules is not a list".to_string())?
            .as_slice(),
    };
    crate::core::direct_admission::admit_sing_box_direct_rules(outbounds, rules)?;

    let dns = root
        .get("dns")
        .and_then(Value::as_object)
        .ok_or_else(|| "runtime has no dns".to_string())?;
    if dns.get("strategy").and_then(Value::as_str) != Some("ipv4_only") {
        return Err("dns.strategy must be ipv4_only".to_string());
    }
    let servers = dns
        .get("servers")
        .and_then(Value::as_array)
        .ok_or_else(|| "runtime has no dns servers".to_string())?;
    for server in servers {
        let kind = server.get("type").and_then(Value::as_str).unwrap_or("");
        if !DNS_SERVER_TYPES.contains(&kind) {
            return Err("plaintext or unknown DNS server is not allowed".to_string());
        }
        if kind != "https" && server.get("path").is_some() {
            return Err("only an https DNS server may carry a path".to_string());
        }
        if kind == "https" && server.get("detour").and_then(Value::as_str) != Some("Tono-Exit") {
            return Err("an https DNS server must detour through Tono-Exit".to_string());
        }
    }

    let experimental = root
        .get("experimental")
        .and_then(Value::as_object)
        .ok_or_else(|| "runtime has no experimental section".to_string())?;
    only_keys(experimental, EXPERIMENTAL_KEYS, "experimental")?;
    if experimental
        .get("cache_file")
        .and_then(|cache| cache.get("enabled"))
        .and_then(Value::as_bool)
        != Some(false)
    {
        return Err("cache_file must be disabled".to_string());
    }
    let clash = experimental
        .get("clash_api")
        .ok_or_else(|| "runtime has no clash_api".to_string())?;
    let controller = clash
        .get("external_controller")
        .and_then(Value::as_str)
        .ok_or_else(|| "clash_api controller is missing".to_string())?;
    let port = loopback_port(controller)?;
    if port == 0 || port == 53 {
        return Err("clash_api controller port is not usable".to_string());
    }
    let secret = clash
        .get("secret")
        .and_then(Value::as_str)
        .ok_or_else(|| "clash_api secret is missing".to_string())?;
    if !secret_ok(secret) {
        return Err("clash_api secret is not a 32-byte compiler secret".to_string());
    }
    if clash.get("default_mode").and_then(Value::as_str) != Some("rule") {
        return Err("clash_api default_mode must be rule".to_string());
    }
    Ok(())
}

/// `route.final` names `Tono-Exit`, so that tag must be the one selector the
/// compiler emits, choosing only among VLESS and Hysteria2 exits. A selector
/// that offers a direct outbound, or a direct outbound named `Tono-Exit`,
/// would send default traffic out of the physical interface.
fn admit_exit_selector(outbounds: &[Value]) -> Result<(), String> {
    fn tag(outbound: &Value) -> Option<&str> {
        outbound.get("tag").and_then(Value::as_str)
    }
    // A name must resolve to one outbound, or a choice could name an exit here
    // and a direct outbound in the core.
    let mut tags = std::collections::HashSet::new();
    for outbound in outbounds {
        if !tag(outbound).is_some_and(|name| tags.insert(name)) {
            return Err("every outbound needs a unique tag".to_string());
        }
    }
    let selector = outbounds
        .iter()
        .find(|outbound| tag(outbound) == Some("Tono-Exit"))
        .ok_or_else(|| "runtime has no Tono-Exit outbound".to_string())?;
    if selector.get("type").and_then(Value::as_str) != Some("selector") {
        return Err("Tono-Exit must be a selector".to_string());
    }
    let is_exit = |name: &str| {
        outbounds.iter().any(|outbound| {
            tag(outbound) == Some(name)
                && matches!(
                    outbound.get("type").and_then(Value::as_str),
                    Some("vless" | "hysteria2")
                )
        })
    };
    let choices = selector
        .get("outbounds")
        .and_then(Value::as_array)
        .filter(|choices| !choices.is_empty())
        .ok_or_else(|| "Tono-Exit has no exits".to_string())?;
    if !choices
        .iter()
        .all(|choice| choice.as_str().is_some_and(is_exit))
    {
        return Err("Tono-Exit may choose only VLESS or Hysteria2 exits".to_string());
    }
    if !selector
        .get("default")
        .is_some_and(|default| choices.contains(default))
    {
        return Err("Tono-Exit default must be one of its exits".to_string());
    }
    Ok(())
}

fn admit_inbound(inbound: &Value) -> Result<(), String> {
    if inbound.get("tcp_fast_open") == Some(&Value::Bool(true)) {
        return Err("tcp_fast_open is not allowed".to_string());
    }
    match inbound.get("type").and_then(Value::as_str) {
        Some("tun") => {
            if inbound.get("stack").is_some() {
                return Err("sing-box TUN stack must stay omitted".to_string());
            }
            let address_ok = inbound
                .get("address")
                .and_then(Value::as_array)
                .is_some_and(|address| {
                    address.len() == 1 && address[0].as_str() == Some(TUN_ADDRESS)
                });
            if inbound.get("interface_name").and_then(Value::as_str) != Some(TUN_INTERFACE_NAME)
                || inbound.get("dns_mode").and_then(Value::as_str) != Some("disabled")
                || !address_ok
                || inbound.get("auto_route") != Some(&Value::Bool(true))
                || inbound.get("strict_route") != Some(&Value::Bool(false))
            {
                return Err("the TUN inbound is not the owned Tono TUN".to_string());
            }
            Ok(())
        }
        Some("direct" | "mixed") => {
            if inbound.get("listen").and_then(Value::as_str) != Some("127.0.0.1") {
                return Err("a direct or mixed inbound must listen on 127.0.0.1".to_string());
            }
            Ok(())
        }
        _ => Err("inbound type is not owned".to_string()),
    }
}

fn only_keys(map: &Map<String, Value>, allowed: &[&str], section: &str) -> Result<(), String> {
    match map.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => Err(format!("`{key}` is not allowed at {section}")),
        None => Ok(()),
    }
}

fn no_forbidden_keys(value: &Value) -> Result<(), String> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if FORBIDDEN_KEYS.contains(&key.as_str()) {
                    return Err(format!("`{key}` is not allowed in the owned runtime"));
                }
                // Hosts `predefined` is keyed by domain names, not options: a
                // host called `output` is data. Its values are address lists.
                if key == "predefined" && map.get("type").and_then(Value::as_str) == Some("hosts") {
                    continue;
                }
                no_forbidden_keys(child)?;
            }
            Ok(())
        }
        Value::Array(items) => items.iter().try_for_each(no_forbidden_keys),
        _ => Ok(()),
    }
}

/// The spelling sing-box's Go JSON decoder matches a key against: ASCII case is
/// ignored, and U+017F and U+212A fold to `s` and `k` (`bytes.EqualFold`).
fn go_folded_key(key: &str) -> String {
    key.chars()
        .map(|c| match c {
            '\u{017F}' => 's',
            '\u{212A}' => 'k',
            c => c.to_ascii_lowercase(),
        })
        .collect()
}

/// A JSON value whose object keys are folded as Go folds them. Two keys in one
/// object that fold to the same name are a decode error: serde_json would keep
/// one and Go another, so the checked document and the run one could differ.
struct FoldedJson(Value);

impl<'de> Deserialize<'de> for FoldedJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(FoldedVisitor).map(FoldedJson)
    }
}

struct FoldedVisitor;

impl<'de> Visitor<'de> for FoldedVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_str<E>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_unit<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let mut items = Vec::new();
        while let Some(FoldedJson(item)) = seq.next_element()? {
            items.push(item);
        }
        Ok(Value::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut object = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            let FoldedJson(child) = map.next_value()?;
            if object.insert(go_folded_key(&key), child).is_some() {
                return Err(de::Error::custom("duplicate key after Go case folding"));
            }
        }
        Ok(Value::Object(object))
    }
}

fn loopback_port(controller: &str) -> Result<u16, String> {
    let Some(port) = controller.strip_prefix("127.0.0.1:") else {
        return Err("clash_api controller must be 127.0.0.1".to_string());
    };
    port.parse::<u16>()
        .map_err(|_| "clash_api controller port is not a number".to_string())
}

fn secret_ok(secret: &str) -> bool {
    if secret.len() == 64 && secret.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return true;
    }
    decode_standard_base64(secret).is_some_and(|raw| raw.len() == 32)
}

fn decode_standard_base64(value: &str) -> Option<Vec<u8>> {
    fn val(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes = value.as_bytes();
    if bytes.is_empty() || !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().rev().take_while(|byte| **byte == b'=').count();
        if pad > 2 {
            return None;
        }
        let mut acc = 0u32;
        for (index, byte) in chunk.iter().enumerate() {
            if *byte == b'=' {
                if index < 2 {
                    return None;
                }
                continue;
            }
            acc = (acc << 6) | u32::from(val(*byte)?);
        }
        acc <<= 6 * pad as u32;
        let produce = 3 - pad;
        for index in 0..produce {
            out.push(((acc >> (8 * (2 - index))) & 0xff) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::admit_owned_runtime;
    use serde_json::{Value, json};

    const SECRET: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

    /// The product compiler's template, filled the way `build_runtime` fills it on Windows.
    fn compiled() -> Value {
        let mut runtime: Value = serde_json::from_str(include_str!(
            "../../../../../tooling/scripts/sing-box/runtime-template.json"
        ))
        .unwrap();
        runtime["inbounds"][0]["interface_name"] = json!("Tono");
        runtime["inbounds"][0]["route_exclude_address"] = json!(["203.0.113.7/32"]);
        runtime["inbounds"].as_array_mut().unwrap().push(
            json!({"type":"mixed","tag":"Tono-Mixed","listen":"127.0.0.1","listen_port":7897}),
        );
        runtime["experimental"]["clash_api"]["external_controller"] = json!("127.0.0.1:9097");
        runtime["experimental"]["clash_api"]["secret"] = json!(SECRET);
        runtime["outbounds"] = json!([
            {"type":"vless","tag":"Fixture Alpha","server":"203.0.113.7","server_port":443,
             "uuid":"00000000-0000-4000-8000-000000000000",
             "tls":{"enabled":true,"server_name":"example.com","utls":{"enabled":true,"fingerprint":"chrome"},
                    "reality":{"enabled":true,"public_key":"key","short_id":"ab"}}},
            {"type":"selector","tag":"Tono-Exit","outbounds":["Fixture Alpha"],"default":"Fixture Alpha"}
        ]);
        runtime
    }

    #[test]
    fn compiler_secret_is_admitted_and_exposed_controllers_are_not() {
        let document = compiled().to_string();
        assert!(admit_owned_runtime(&document).is_ok());
        let mut hex = compiled();
        hex["experimental"]["clash_api"]["secret"] = json!("ab".repeat(32));
        assert!(admit_owned_runtime(&hex.to_string()).is_ok());
        assert!(admit_owned_runtime(&document.replace("127.0.0.1:9097", "0.0.0.0:9097")).is_err());
        let stacked = document.replace("\"type\":\"tun\"", "\"type\":\"tun\",\"stack\":\"gvisor\"");
        assert!(admit_owned_runtime(&stacked).is_err());
        let raced = document.replace("\"type\":\"https\"", "\"type\":\"udp\"");
        assert!(admit_owned_runtime(&raced).is_err());
    }

    /// The Service runs this document as LocalSystem. A caller that can reach the
    /// control pipe must not get a SYSTEM file write, a LAN-facing proxy, or a
    /// non-tunnel default route out of it, in any spelling Go's decoder accepts.
    #[test]
    fn privileged_files_lan_listeners_and_folded_keys_are_refused() {
        let mut logged = compiled();
        logged["log"]["output"] = json!(r"C:\ProgramData\tono.log");
        assert!(admit_owned_runtime(&logged.to_string()).is_err());

        let mut exposed = compiled();
        exposed["inbounds"][2]["listen"] = json!("0.0.0.0");
        assert!(admit_owned_runtime(&exposed.to_string()).is_err());

        let mut bypass = compiled();
        bypass["route"]["final"] = json!("direct");
        assert!(admit_owned_runtime(&bypass.to_string()).is_err());

        let folded =
            compiled()
                .to_string()
                .replacen("\"log\":{", "\"log\":{\"Output\":\"C:\\\\x.log\",", 1);
        assert!(admit_owned_runtime(&folded).is_err());

        let duplicated = compiled().to_string().replacen(
            "\"final\":\"Tono-Exit\"",
            "\"final\":\"Tono-Exit\",\"FINAL\":\"direct\"",
            1,
        );
        assert!(admit_owned_runtime(&duplicated).is_err());
    }

    /// `route.final` alone does not keep default traffic and DNS on the tunnel:
    /// the `Tono-Exit` selector and every DoH server must stay on an exit.
    #[test]
    fn exit_selector_and_doh_must_stay_on_an_exit() {
        let mut hosts = compiled();
        hosts["dns"]["servers"]
            .as_array_mut()
            .unwrap()
            .push(json!({"type":"hosts","tag":"Tono-Hosts","predefined":{"output":["192.0.2.1"]}}));
        assert!(admit_owned_runtime(&hosts.to_string()).is_ok());

        let mut direct_choice = compiled();
        direct_choice["outbounds"]
            .as_array_mut()
            .unwrap()
            .push(json!({"type":"direct","tag":"Tono-China-Direct","bind_interface":"Ethernet"}));
        assert!(admit_owned_runtime(&direct_choice.to_string()).is_ok());
        direct_choice["outbounds"][1]["outbounds"] = json!(["Fixture Alpha", "Tono-China-Direct"]);
        assert!(admit_owned_runtime(&direct_choice.to_string()).is_err());

        let mut renamed = compiled();
        renamed["outbounds"][1] = json!({"type":"direct","tag":"Tono-Exit"});
        assert!(admit_owned_runtime(&renamed.to_string()).is_err());

        let mut shadowed = compiled();
        shadowed["outbounds"]
            .as_array_mut()
            .unwrap()
            .push(json!({"type":"direct","tag":"Fixture Alpha"}));
        assert!(admit_owned_runtime(&shadowed.to_string()).is_err());

        let mut doh = compiled();
        doh["dns"]["servers"][1]["detour"] = json!("Tono-China-Direct");
        assert!(admit_owned_runtime(&doh.to_string()).is_err());
    }

    /// While a DIRECT plan is live, WFP does not bound the destination, so a rule to
    /// `Tono-China-Direct` is admitted only as the compiler writes it, never for an
    /// assistant host or with no destination ahead of the assistant pins.
    #[test]
    fn direct_rules_outside_compiler_shapes_are_refused() {
        let with_rule = |rule: Value| {
            let mut runtime = compiled();
            runtime["outbounds"].as_array_mut().unwrap().push(
                json!({"type":"direct","tag":"Tono-China-Direct","bind_interface":"Ethernet"}),
            );
            runtime["route"]["rules"].as_array_mut().unwrap().push(rule);
            admit_owned_runtime(&runtime.to_string())
        };
        let exact = json!({"type":"logical","mode":"and","rules":[
            {"network":"tcp","port":443,"domain":["qq.com"]},{"ip_cidr":["101.1.2.3/32"]}],
            "action":"route","outbound":"Tono-China-Direct"});
        assert_eq!(with_rule(exact), Ok(()));
        let assistant = json!({"network":"tcp","port":443,"domain_suffix":["claude.ai"],
            "action":"route","outbound":"Tono-China-Direct"});
        assert!(with_rule(assistant).is_err());
        let unpinned_process = json!({"network":"tcp","port":[443],"process_path_regex":["^"],
            "action":"route","outbound":"Tono-China-Direct"});
        assert!(with_rule(unpinned_process).is_err());
    }

    /// A selector whose member is `Tono-China-Direct` is DIRECT too, so an
    /// assistant host routed to it is refused like a rule to the direct outbound.
    #[test]
    fn assistant_rule_to_a_selector_reaching_direct_is_refused() {
        let mut runtime = compiled();
        runtime["outbounds"].as_array_mut().unwrap().extend([
            json!({"type":"direct","tag":"Tono-China-Direct","bind_interface":"Ethernet"}),
            json!({"type":"selector","tag":"AI-Bypass","outbounds":["Tono-China-Direct"]}),
        ]);
        runtime["route"]["rules"].as_array_mut().unwrap().push(json!({
            "network":"tcp","domain_suffix":["claude.ai"],"action":"route","outbound":"AI-Bypass"}));
        assert!(admit_owned_runtime(&runtime.to_string()).is_err());
    }
}
