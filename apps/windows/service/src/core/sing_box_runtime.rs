//! Admission for a sing-box document the Service is about to run as LocalSystem.
//!
//! This is the JSON counterpart of the mihomo YAML whitelist. It does not
//! compile a runtime. It refuses a controller that is not loopback, a secret
//! the product compiler would not emit, a gVisor `stack`, plaintext DNS, and
//! `insecure` TLS.

use serde_json::Value;

pub(crate) fn admit_owned_runtime(text: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "runtime is not JSON".to_string())?;
    let inbounds = value
        .get("inbounds")
        .and_then(Value::as_array)
        .ok_or_else(|| "runtime has no inbounds".to_string())?;
    if inbounds.is_empty() {
        return Err("runtime has no inbounds".to_string());
    }
    for inbound in inbounds {
        if inbound.get("stack").is_some() {
            return Err("sing-box TUN stack must stay omitted".to_string());
        }
        if inbound.get("tcp_fast_open") == Some(&Value::Bool(true)) {
            return Err("tcp_fast_open is not allowed".to_string());
        }
    }
    let clash = value
        .pointer("/experimental/clash_api")
        .ok_or_else(|| "runtime has no clash_api".to_string())?;
    if clash.get("external_ui").is_some() {
        return Err("external_ui is not allowed".to_string());
    }
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
    let servers = value
        .pointer("/dns/servers")
        .and_then(Value::as_array)
        .ok_or_else(|| "runtime has no dns servers".to_string())?;
    for server in servers {
        match server.get("type").and_then(Value::as_str) {
            Some("fakeip" | "https" | "hosts") => {}
            _ => return Err("plaintext or unknown DNS server is not allowed".to_string()),
        }
    }
    if contains_insecure(&value) {
        return Err("insecure TLS is not allowed".to_string());
    }
    Ok(())
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

fn contains_insecure(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            if map.get("insecure") == Some(&Value::Bool(true)) {
                return true;
            }
            map.values().any(contains_insecure)
        }
        Value::Array(items) => items.iter().any(contains_insecure),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::admit_owned_runtime;

    fn document(secret: &str, extra: &str) -> String {
        format!(
            r#"{{"inbounds":[{{"type":"tun","tag":"Tono-TUN"}}],"dns":{{"servers":[{{"type":"https","tag":"Tono-DoH"}}]}},"experimental":{{"clash_api":{{"external_controller":"127.0.0.1:9090","secret":"{secret}"}}}}}}{extra}"#
        )
    }

    #[test]
    fn compiler_secret_is_admitted_and_exposed_controllers_are_not() {
        let secret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
        assert!(admit_owned_runtime(&document(secret, "")).is_ok());
        assert!(admit_owned_runtime(&document(&"ab".repeat(32), "")).is_ok());
        assert!(admit_owned_runtime(&document(secret, "").replace("127.0.0.1:9090", "0.0.0.0:9090")).is_err());
        let stacked = document(secret, "").replace("\"type\":\"tun\"", "\"type\":\"tun\",\"stack\":\"gvisor\"");
        assert!(admit_owned_runtime(&stacked).is_err());
        let raced = document(secret, "").replace("\"type\":\"https\"", "\"type\":\"udp\"");
        assert!(admit_owned_runtime(&raced).is_err());
        let insecure = document(secret, "").replace(
            "\"type\":\"tun\"",
            "\"type\":\"tun\",\"tls\":{\"insecure\":true}",
        );
        assert!(admit_owned_runtime(&insecure).is_err());
    }
}
