//! Residential NAT keepalive for the same-node Hysteria2 hop.
//!
//! sing-box 1.15.0-alpha.9 (`132b38e9`) accepts `keep_alive_period` on a
//! hysteria2 outbound. Leaving it unset uses sing-quic's 10s default.
//! Chrome parrot (on unless `disable_chrome_parrot`) forces the idle timeout
//! to 30s and ignores a longer `idle_timeout`. quic-go also clips a keepalive
//! to at most half of that idle timeout, so 5s is sent and 10s can lose a
//! race with a short residential UDP mapping. This module only stamps an
//! outbound that already exists. It does not add a hysteria2 proxy, and it
//! does not set `idle_timeout` or `disable_chrome_parrot`.
//!
//! Pinned mihomo v1.19.30 has no keepalive field on `Hysteria2Option`.
//! metacubex sing-quic `38b0e9295f51` applies `DefaultKeepAlivePeriod` (10s)
//! and `DefaultMaxIdleTimeout` (30s) when those values are left at 0. The
//! YAML decoder ignores unknown proxy keys, so a invented `keep-alive-period`
//! would not change the core. Mihomo emitters must not write one, and must
//! not write `handshake-timeout` or `skip-cert-verify`.

use serde_json::Value;
use std::borrow::Cow;

/// Explicit sing-box QUIC keepalive. Under the 15s half-of-30s cap.
pub const SING_BOX_KEEP_ALIVE_PERIOD: &str = "5s";

/// What the pinned mihomo core already does, with no YAML knob to shorten it.
pub const MIHOMO_PINNED_KEEP_ALIVE: &str = "10s";
pub const MIHOMO_PINNED_IDLE_TIMEOUT: &str = "30s";

/// Stable support token for a QUIC idle drop on this hop. VLESS is TCP, so
/// quic-go's idle text is specific enough to this UDP path.
pub const SUPPORT_CODE: &str = "TONO_CONNECT_HY2_IDLE";

/// Stamp `keep_alive_period` on every hysteria2 object. Other outbound types
/// are left untouched. A missing or non-array value is a no-op.
pub fn apply_sing_box_keep_alive(outbounds: &mut Value) {
    let Some(items) = outbounds.as_array_mut() else {
        return;
    };
    for item in items {
        if item.get("type").and_then(Value::as_str) != Some("hysteria2") {
            continue;
        }
        let Some(object) = item.as_object_mut() else {
            continue;
        };
        object.insert(
            "keep_alive_period".to_string(),
            Value::String(SING_BOX_KEEP_ALIVE_PERIOD.to_string()),
        );
        let _ = object.remove("idle_timeout");
        let _ = object.remove("disable_chrome_parrot");
    }
}

/// quic-go idle error: "timeout: no recent network activity".
pub fn is_quic_idle(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("no recent network activity")
        || lower.contains("idletimeout")
        || lower.contains("idle timeout")
}

/// Prefix [`SUPPORT_CODE`] so `stable_error_code` and the dashboard can see it.
/// Unrelated errors, including a generic timeout, are returned unchanged.
pub fn annotate(message: &str) -> Cow<'_, str> {
    if !is_quic_idle(message) || message.contains(SUPPORT_CODE) {
        return Cow::Borrowed(message);
    }
    Cow::Owned(format!("{SUPPORT_CODE}: {message}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sing_box_keep_alive_is_five_seconds_on_hysteria2_only() {
        let mut outbounds = json!([
            {"type": "vless", "tag": "tcp", "keep_alive_period": "should-stay"},
            {
                "type": "hysteria2",
                "tag": "udp",
                "idle_timeout": "60s",
                "disable_chrome_parrot": true
            },
            {"type": "direct", "tag": "DIRECT"}
        ]);
        apply_sing_box_keep_alive(&mut outbounds);
        assert_eq!(outbounds[0]["keep_alive_period"], "should-stay");
        assert!(outbounds[0].get("idle_timeout").is_none());
        assert_eq!(
            outbounds[1]["keep_alive_period"],
            SING_BOX_KEEP_ALIVE_PERIOD
        );
        assert!(outbounds[1].get("idle_timeout").is_none());
        assert!(outbounds[1].get("disable_chrome_parrot").is_none());
        assert!(outbounds[2].get("keep_alive_period").is_none());
        let mut empty = json!(null);
        apply_sing_box_keep_alive(&mut empty);
        assert!(empty.is_null());
    }

    #[test]
    fn quic_idle_text_gains_the_hy2_support_code_once() {
        let raw = "timeout: no recent network activity";
        let annotated = annotate(raw);
        assert_eq!(annotated, format!("{SUPPORT_CODE}: {raw}"));
        assert_eq!(annotate(&annotated), annotated);
        let idle_word = annotate("IdleTimeout: no recent network activity");
        assert!(idle_word.starts_with(SUPPORT_CODE));
        assert_eq!(annotate("dial tcp: i/o timeout"), "dial tcp: i/o timeout");
        assert!(!is_quic_idle("tls handshake eof"));
        assert_eq!(MIHOMO_PINNED_KEEP_ALIVE, "10s");
        assert_eq!(MIHOMO_PINNED_IDLE_TIMEOUT, "30s");
    }
}
