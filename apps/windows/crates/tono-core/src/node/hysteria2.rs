//! Closed, additive catalog extension. Older clients still see a VLESS node.
//! Server/IP comes only from its admitted parent; no hopping, STUN, raw YAML,
//! alternate dialer or insecure TLS knobs can expand the WFP destination set.

use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value};

use super::{NodeRejection, ValidatedNode, is_forbidden_scalar_char, normalize_sni_host};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExitTransport {
    #[default]
    RealityTcp,
    Hysteria2Udp,
}

#[derive(Clone, PartialEq, Eq)]
pub struct Hysteria2Endpoint {
    port: u16,
    password: String,
    sni: String,
    obfs_password: Option<String>,
}

impl std::fmt::Debug for Hysteria2Endpoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hysteria2Endpoint")
            .field("credentials", &"[redacted]")
            .finish_non_exhaustive()
    }
}

impl Hysteria2Endpoint {
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Subtraction-only input to the diagnostic scrubber; never serialize it.
    pub fn diagnostic_secrets(&self) -> impl Iterator<Item = &str> {
        std::iter::once(self.password.as_str()).chain(self.obfs_password.as_deref())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawEndpoint {
    port: u16,
    password: String,
    sni: String,
    #[serde(default, rename = "obfs-password")]
    obfs_password: Option<String>,
}

pub(super) fn admit(value: Option<&Value>) -> Result<Option<Hysteria2Endpoint>, NodeRejection> {
    let Some(value) = value else {
        return Ok(None);
    };
    // Serde errors can echo a supplied password or unknown key. Never propagate them.
    let raw: RawEndpoint =
        serde_yaml_ng::from_value(value.clone()).map_err(|_| NodeRejection::BadHysteria2)?;
    let safe_credential = |text: &str| {
        !text.trim().is_empty() && text.len() <= 1024 && !text.chars().any(is_forbidden_scalar_char)
    };
    let sni = normalize_sni_host(&raw.sni).ok_or(NodeRejection::BadHysteria2)?;
    if raw.port == 0
        || !safe_credential(&raw.password)
        || raw
            .obfs_password
            .as_deref()
            .is_some_and(|text| !safe_credential(text))
    {
        return Err(NodeRejection::BadHysteria2);
    }
    Ok(Some(Hysteria2Endpoint {
        port: raw.port,
        password: raw.password,
        sni,
        obfs_password: raw.obfs_password,
    }))
}

impl ValidatedNode {
    /// Compare only the carrier actually in use; rotating an unused backup must
    /// not tear down a healthy TCP session (and vice versa).
    pub fn same_transport_endpoint(&self, other: &Self, transport: ExitTransport) -> bool {
        if self.name != other.name || self.server != other.server {
            return false;
        }
        match transport {
            ExitTransport::Hysteria2Udp => {
                self.hysteria2.is_some() && self.hysteria2 == other.hysteria2
            }
            ExitTransport::RealityTcp => {
                self.port == other.port
                    && self.uuid == other.uuid
                    && self.servername == other.servername
                    && self.flow == other.flow
                    && self.client_fingerprint == other.client_fingerprint
                    && self.reality_public_key == other.reality_public_key
                    && self.reality_short_id == other.reality_short_id
            }
        }
    }

    pub fn supports_transport(&self, transport: ExitTransport) -> bool {
        transport == ExitTransport::RealityTcp || self.hysteria2.is_some()
    }

    pub fn transport_port(&self, transport: ExitTransport) -> Result<u16, NodeRejection> {
        match transport {
            ExitTransport::RealityTcp => Ok(self.port),
            ExitTransport::Hysteria2Udp => self
                .hysteria2
                .as_ref()
                .map(Hysteria2Endpoint::port)
                .ok_or(NodeRejection::TransportUnavailable),
        }
    }

    pub fn to_runtime_mapping_for(
        &self,
        transport: ExitTransport,
    ) -> Result<Mapping, NodeRejection> {
        if transport == ExitTransport::RealityTcp {
            return Ok(self.to_runtime_mapping());
        }
        let endpoint = self
            .hysteria2
            .as_ref()
            .ok_or(NodeRejection::TransportUnavailable)?;
        let mut map = Mapping::new();
        for (key, value) in [
            ("name", Value::String(self.name.clone())),
            ("type", Value::String("hysteria2".into())),
            ("server", Value::String(self.server.to_string())),
            ("port", Value::Number(endpoint.port.into())),
            ("password", Value::String(endpoint.password.clone())),
            ("sni", Value::String(endpoint.sni.clone())),
            // CA chain + SNI validation, including for QUIC/TLS. Fingerprint and
            // skip verification overrides are intentionally absent from admission.
            ("skip-cert-verify", Value::Bool(false)),
        ] {
            map.insert(Value::String(key.into()), value);
        }
        if let Some(password) = &endpoint.obfs_password {
            map.insert(
                Value::String("obfs".into()),
                Value::String("salamander".into()),
            );
            map.insert(
                Value::String("obfs-password".into()),
                Value::String(password.clone()),
            );
        }
        Ok(map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> Value {
        serde_yaml_ng::from_str("port: 8443\npassword: synthetic-auth\nsni: udp.example.com\n")
            .unwrap()
    }

    #[test]
    fn extension_absent_is_legacy_tcp_but_declared_invalid_is_not_absent() {
        assert!(admit(None).unwrap().is_none());
        for value in [
            Value::Null,
            Value::Bool(false),
            Value::Mapping(Mapping::new()),
        ] {
            assert_eq!(admit(Some(&value)), Err(NodeRejection::BadHysteria2));
        }
    }

    #[test]
    fn extension_admits_only_fixed_same_server_verified_tls() {
        let result = admit(Some(&valid())).unwrap().unwrap();
        assert_eq!(result.port(), 8443);
        assert!(!format!("{result:?}").contains("synthetic-auth"));
        for forbidden in [
            "server",
            "ports",
            "hop-interval",
            "skip-cert-verify",
            "fingerprint",
            "dialer-proxy",
            "realm",
            "alpn",
            "up",
            "down",
            "certificate",
            "private-key",
        ] {
            let mut value = valid();
            value[forbidden] = Value::String("synthetic-private-value".into());
            let error = admit(Some(&value)).unwrap_err();
            assert_eq!(error, NodeRejection::BadHysteria2);
            assert!(!error.to_string().contains("synthetic-private-value"));
        }
    }

    #[test]
    fn credentials_and_port_are_bounded_and_never_echoed_on_type_errors() {
        for (key, bad) in [
            ("port", Value::Number(0.into())),
            ("port", Value::Number(65536_u32.into())),
            ("password", Value::String(" ".into())),
            ("password", Value::String("a".repeat(1025))),
            ("password", Value::String("synthetic\nsecret".into())),
            (
                "password",
                Value::Sequence(vec![Value::String("synthetic-private-value".into())]),
            ),
            ("sni", Value::String("not a host".into())),
            ("obfs-password", Value::String(String::new())),
        ] {
            let mut value = valid();
            value[key] = bad;
            assert_eq!(admit(Some(&value)), Err(NodeRejection::BadHysteria2));
        }
    }
}
