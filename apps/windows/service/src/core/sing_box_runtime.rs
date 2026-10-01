//! Admission for a sing-box document the Service is about to run as LocalSystem.
//!
//! This is the JSON counterpart of the mihomo YAML whitelist, and the Windows
//! port of the macOS helper's `ownedRuntimeConfigIsSafe`. It does not compile a
//! runtime. It admits only the shape the product compiler emits: the six
//! top-level sections, loopback-only inbounds, the `Tono` TUN, encrypted DNS,
//! `route.final` on `Tono-Exit`, and no file paths, remote rule sets, socket
//! marks or `insecure` TLS. Keys are compared as sing-box's Go decoder folds
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

pub(crate) fn admit_owned_runtime(text: &str) -> Result<(), String> {
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
    }

    let route = root
        .get("route")
        .and_then(Value::as_object)
        .ok_or_else(|| "runtime has no route".to_string())?;
    if route.get("final").and_then(Value::as_str) != Some("Tono-Exit") {
        return Err("route.final must be Tono-Exit".to_string());
    }

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
}
