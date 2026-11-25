//! The signed traffic policy a sing-box DIRECT replacement is bound to (#1280, decision 110).
//!
//! The App sends the policy exactly as the control plane served it. The Service verifies the
//! detached Ed25519 signature with the policy key compiled into it (the same `policy_signature.rs`
//! and signed-bytes format the clients use: `tono-traffic-policy-v1\n` + the JSON), and then
//! admits only the DIRECT entries the verified document lists. An unsigned, forged or relabelled
//! policy is refused, and a refusal only skips the optional overlay: the connection stays on its
//! exit. The App's own host allowlists are not repeated here; the signature is the authority.

use std::collections::{BTreeMap, BTreeSet};
use std::net::Ipv4Addr;

use serde_json::Value;

use crate::SignedTrafficPolicy;
use crate::direct_domains::ALWAYS_ADDRESS_FREE_WEB_SUFFIXES;
use crate::policy_signature::{
    SignatureVerdict, TRAFFIC_POLICY_LEGACY_PUBLIC_KEY, TRAFFIC_POLICY_PUBLIC_KEY, verdict_with_key,
};

// The limits `tono-core` `policy::validate_policy` applies, so a document the App accepted is
// never larger than what the Service reads.
const MAX_POLICY_JSON_BYTES: usize = 64 * 1024;
const MAX_POLICY_DOMAINS: usize = 32;
const MAX_POLICY_MEDIA: usize = 64;
const MAX_POLICY_WEB_DOMAINS: usize = 32;
const MAX_POLICY_DIRECT_SUFFIXES: usize = 64;
const MAX_POLICY_TCP_ENDPOINTS: usize = 64;
const MAX_POLICY_TCP_DIRECT_ADDRESSES: usize = 64;
const MAX_TCP_ENDPOINT_PORTS: usize = 16;
const POLICY_VERSION_V2: u64 = 2;
const POLICY_VERSION_V3: u64 = 3;
const POLICY_VERSION_V4: u64 = 4;
const POLICY_VERSION_V5: u64 = 5;

/// What a verified policy lists, by the kind of DIRECT rule the compilers derive from it.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct DirectPolicy {
    /// Native-app hosts (`domains`).
    native_hosts: BTreeMap<String, BTreeSet<u16>>,
    /// Exact web hosts (`webDomains`).
    web_hosts: BTreeMap<String, BTreeSet<u16>>,
    /// Address-free suffixes (`directSuffixes`).
    suffixes: BTreeMap<String, BTreeSet<u16>>,
    /// Exact media addresses (`mediaEndpoints`).
    media: BTreeMap<Ipv4Addr, BTreeSet<u16>>,
    /// Exact direct TCP endpoints (`tcpEndpoints`).
    tcp_endpoints: BTreeMap<Ipv4Addr, BTreeSet<u16>>,
    /// Exact direct IPv4 addresses permitted across all non-DNS TCP ports (`tcpDirectAddresses`).
    tcp_direct_addresses: BTreeSet<Ipv4Addr>,
}

impl DirectPolicy {
    /// Verify `signed` against the production policy key and read what it lists. Only the
    /// privileged Service calls it; the client build keeps the module for the compiler-compat tests.
    #[cfg_attr(not(feature = "standalone"), allow(dead_code))]
    pub(crate) fn verify(signed: &SignedTrafficPolicy) -> Result<Self, String> {
        match Self::verify_with_key(signed, TRAFFIC_POLICY_PUBLIC_KEY) {
            Ok(policy) => Ok(policy),
            Err(_) if !TRAFFIC_POLICY_LEGACY_PUBLIC_KEY.is_empty() => {
                Self::verify_with_key(signed, TRAFFIC_POLICY_LEGACY_PUBLIC_KEY)
            }
            Err(err) => Err(err),
        }
    }

    /// `verify` against an explicit key, so tests can sign with a throwaway pair.
    pub(crate) fn verify_with_key(
        signed: &SignedTrafficPolicy,
        public_key_base64: &str,
    ) -> Result<Self, String> {
        if signed.json.len() > MAX_POLICY_JSON_BYTES {
            return Err("the traffic policy is larger than the Service reads".to_string());
        }
        match verdict_with_key(&signed.json, Some(&signed.signature), public_key_base64) {
            SignatureVerdict::Trusted => Self::from_json(&signed.json, signed.revision),
            SignatureVerdict::Unsigned => Err("the traffic policy is unsigned".to_string()),
            SignatureVerdict::Untrustworthy => {
                Err("the traffic policy signature does not verify".to_string())
            }
        }
    }

    /// Read the lists of a document whose signature already verified. A revision inside the
    /// signed bytes is covered by the signature, the envelope's is not, so when both exist they
    /// must agree or the envelope was relabelled (`tono-core` `validate_policy`, #317).
    pub(crate) fn from_json(json: &str, envelope_revision: i64) -> Result<Self, String> {
        let document: Value = serde_json::from_str(json)
            .map_err(|_| "the traffic policy is not JSON".to_string())?;
        let object = document
            .as_object()
            .ok_or_else(|| "the traffic policy is not a JSON object".to_string())?;
        let version = object
            .get("version")
            .and_then(Value::as_u64)
            .filter(|version| *version >= 1)
            .ok_or_else(|| "the traffic policy has no version".to_string())?;
        if let Some(embedded) = object.get("revision")
            && embedded.as_i64() != Some(envelope_revision)
        {
            return Err("the traffic policy envelope revision was relabelled".to_string());
        }
        let mut policy = Self {
            native_hosts: hosts(object.get("domains"), MAX_POLICY_DOMAINS),
            ..Self::default()
        };
        policy.media = media(object.get("mediaEndpoints"), MAX_POLICY_MEDIA);
        if version >= POLICY_VERSION_V2 {
            policy.web_hosts = hosts(object.get("webDomains"), MAX_POLICY_WEB_DOMAINS);
        }
        if version >= POLICY_VERSION_V3 {
            policy.suffixes = hosts(object.get("directSuffixes"), MAX_POLICY_DIRECT_SUFFIXES);
        }
        if version >= POLICY_VERSION_V4 {
            policy.tcp_endpoints = tcp_endpoints(object.get("tcpEndpoints"), MAX_POLICY_TCP_ENDPOINTS);
        }
        if version >= POLICY_VERSION_V5 {
            policy.tcp_direct_addresses = tcp_direct_addresses(
                object.get("tcpDirectAddresses"),
                MAX_POLICY_TCP_DIRECT_ADDRESSES,
                &policy.tcp_endpoints,
            );
        }
        Ok(policy)
    }

    /// Native-app DIRECT is authorised at all: some `domains` entry exists. Process-path rules
    /// carry no destination of their own and the policy names no process, so this is the
    /// policy half of their admission; which executables qualify stays the App's signed-app
    /// discovery and the structural check on the regex.
    pub(crate) fn lists_native_apps(&self) -> bool {
        !self.native_hosts.is_empty()
    }

    /// An exact host on `port`, from either host list.
    pub(crate) fn lists_exact_host(&self, host: &str, port: u16) -> bool {
        [&self.native_hosts, &self.web_hosts]
            .iter()
            .any(|list| list.get(host).is_some_and(|ports| ports.contains(&port)))
    }

    /// A suffix on `port`: listed by the policy, or one of the product suffixes the App always
    /// adds beside native-app pins (so only while native apps are authorised), on 80 and 443.
    pub(crate) fn lists_suffix(&self, suffix: &str, port: u16) -> bool {
        self.suffixes
            .get(suffix)
            .is_some_and(|ports| ports.contains(&port))
            || (self.lists_native_apps()
                && matches!(port, 80 | 443)
                && ALWAYS_ADDRESS_FREE_WEB_SUFFIXES.contains(&suffix))
    }

    /// An exact media address on `port`.
    pub(crate) fn lists_media(&self, address: Ipv4Addr, port: u16) -> bool {
        self.media
            .get(&address)
            .is_some_and(|ports| ports.contains(&port))
    }

    /// An exact TCP endpoint (`address` + non-DNS `port`) from `tcpEndpoints`.
    pub(crate) fn lists_tcp_endpoint(&self, address: Ipv4Addr, port: u16) -> bool {
        self.tcp_endpoints
            .get(&address)
            .is_some_and(|ports| ports.contains(&port))
    }

    /// An exact public IPv4 address from `tcpDirectAddresses` (all non-DNS TCP ports).
    pub(crate) fn lists_tcp_direct_address(&self, address: Ipv4Addr) -> bool {
        self.tcp_direct_addresses.contains(&address)
    }
}

fn ports(value: Option<&Value>) -> BTreeSet<u16> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|port| port.as_u64().and_then(|port| u16::try_from(port).ok()))
        .collect()
}

/// `host` entries already in the form the App normalises to (lower case, no trailing dot).
fn hosts(list: Option<&Value>, limit: usize) -> BTreeMap<String, BTreeSet<u16>> {
    let mut map: BTreeMap<String, BTreeSet<u16>> = BTreeMap::new();
    for entry in list.and_then(Value::as_array).into_iter().flatten().take(limit) {
        let Some(host) = entry.get("host").and_then(Value::as_str) else {
            continue;
        };
        if host.is_empty() || host != host.trim().to_lowercase() || host.ends_with('.') {
            continue;
        }
        map.entry(host.to_string())
            .or_default()
            .extend(ports(entry.get("ports")));
    }
    map
}

fn is_public_non_protected_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    let special = matches!(
        (a, b, c),
        (0, _, _)
            | (10, _, _)
            | (100, 64..=127, _)
            | (127, _, _)
            | (169, 254, _)
            | (172, 16..=31, _)
            | (192, 0, 0)
            | (192, 0, 2)
            | (192, 88, 99)
            | (192, 168, _)
            | (198, 18..=19, _)
            | (198, 51, 100)
            | (203, 0, 113)
            | (224..=255, _, _)
    );
    !special
        && address != Ipv4Addr::new(1, 1, 1, 1)
        && address != Ipv4Addr::new(8, 8, 8, 8)
        && !crate::direct_domains::is_claude_home_ipv4(address)
        && !crate::direct_domains::is_cloud_exit_ipv4(address)
        && !crate::API_RELAYS.iter().any(|(relay, _)| *relay == address)
}

fn tcp_endpoints(list: Option<&Value>, limit: usize) -> BTreeMap<Ipv4Addr, BTreeSet<u16>> {
    let mut map: BTreeMap<Ipv4Addr, BTreeSet<u16>> = BTreeMap::new();
    for entry in list.and_then(Value::as_array).into_iter().flatten().take(limit) {
        let Some(raw) = entry.get("address").and_then(Value::as_str) else {
            continue;
        };
        let Ok(address) = raw.parse::<Ipv4Addr>() else {
            continue;
        };
        if raw != address.to_string()
            || !is_public_non_protected_ipv4(address)
            || map.contains_key(&address)
        {
            continue;
        }
        let valid_ports: BTreeSet<u16> = ports(entry.get("ports"))
            .into_iter()
            .filter(|port| *port != 0 && *port != 53 && *port != 853)
            .take(MAX_TCP_ENDPOINT_PORTS)
            .collect();
        if !valid_ports.is_empty() {
            map.insert(address, valid_ports);
        }
    }
    map
}

fn tcp_direct_addresses(
    list: Option<&Value>,
    limit: usize,
    tcp_endpoints: &BTreeMap<Ipv4Addr, BTreeSet<u16>>,
) -> BTreeSet<Ipv4Addr> {
    let mut set = BTreeSet::new();
    for entry in list.and_then(Value::as_array).into_iter().flatten().take(limit) {
        let Some(raw) = entry.as_str() else {
            continue;
        };
        let Ok(address) = raw.parse::<Ipv4Addr>() else {
            continue;
        };
        if raw != address.to_string()
            || !is_public_non_protected_ipv4(address)
            || tcp_endpoints.contains_key(&address)
        {
            continue;
        }
        set.insert(address);
    }
    set
}

fn media(list: Option<&Value>, limit: usize) -> BTreeMap<Ipv4Addr, BTreeSet<u16>> {
    let mut map: BTreeMap<Ipv4Addr, BTreeSet<u16>> = BTreeMap::new();
    for entry in list.and_then(Value::as_array).into_iter().flatten().take(limit) {
        let Some(address) = entry
            .get("address")
            .and_then(Value::as_str)
            .and_then(|address| address.parse::<Ipv4Addr>().ok())
        else {
            continue;
        };
        map.entry(address)
            .or_default()
            .extend(ports(entry.get("ports")));
    }
    map
}

#[cfg(test)]
pub(crate) mod tests {
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};

    use super::*;
    use crate::policy_signature::TRAFFIC_POLICY_SIGNATURE_CONTEXT;

    pub(crate) const POLICY_JSON: &str = r#"{"version":3,"revision":7,
        "domains":[{"host":"szextshort.weixin.qq.com","ports":[80,443]}],
        "mediaEndpoints":[{"address":"203.0.113.9","ports":[443,8000]}],
        "webDomains":[{"host":"res.wx.qq.com","ports":[443]}],
        "directSuffixes":[{"host":"bilibili.com","ports":[80,443]}]}"#;

    pub(crate) fn key(seed: u8) -> (SigningKey, String) {
        let signing = SigningKey::from_bytes(&[seed; 32]);
        let public = base64::engine::general_purpose::STANDARD
            .encode(signing.verifying_key().to_bytes());
        (signing, public)
    }

    pub(crate) fn sign(signing: &SigningKey, json: &str, revision: i64) -> SignedTrafficPolicy {
        let mut message = TRAFFIC_POLICY_SIGNATURE_CONTEXT.as_bytes().to_vec();
        message.extend_from_slice(json.as_bytes());
        SignedTrafficPolicy {
            revision,
            json: json.to_string(),
            signature: base64::engine::general_purpose::STANDARD
                .encode(signing.sign(&message).to_bytes()),
        }
    }

    #[test]
    fn a_policy_signed_by_another_key_is_refused() {
        let (_, trusted) = key(1);
        let (forger, _) = key(2);
        let forged = sign(&forger, POLICY_JSON, 7);
        assert!(DirectPolicy::verify_with_key(&forged, &trusted).is_err());
    }

    #[test]
    fn an_unsigned_or_edited_policy_is_refused() {
        let (signing, public) = key(1);
        let mut unsigned = sign(&signing, POLICY_JSON, 7);
        unsigned.signature.clear();
        assert!(DirectPolicy::verify_with_key(&unsigned, &public).is_err());

        let mut edited = sign(&signing, POLICY_JSON, 7);
        edited.json = POLICY_JSON.replace("szextshort.weixin.qq.com", "evil.example.com");
        assert!(DirectPolicy::verify_with_key(&edited, &public).is_err());
    }

    #[test]
    fn a_relabelled_envelope_revision_is_refused() {
        let (signing, public) = key(1);
        let relabelled = sign(&signing, POLICY_JSON, 8);
        assert!(DirectPolicy::verify_with_key(&relabelled, &public).is_err());
        let honest = sign(&signing, POLICY_JSON, 7);
        assert!(DirectPolicy::verify_with_key(&honest, &public).is_ok());
    }

    #[test]
    fn a_verified_policy_lists_exactly_its_entries() {
        let (signing, public) = key(1);
        let policy =
            DirectPolicy::verify_with_key(&sign(&signing, POLICY_JSON, 7), &public).unwrap();
        assert!(policy.lists_exact_host("szextshort.weixin.qq.com", 443));
        assert!(!policy.lists_exact_host("szextshort.weixin.qq.com", 8080));
        assert!(policy.lists_exact_host("res.wx.qq.com", 443));
        assert!(!policy.lists_exact_host("evil.example.com", 443));
        assert!(policy.lists_media("203.0.113.9".parse().unwrap(), 8000));
        assert!(!policy.lists_media("203.0.113.10".parse().unwrap(), 8000));
        assert!(policy.lists_suffix("bilibili.com", 80));
        assert!(policy.lists_suffix("baidu.com", 443), "an always-attached product suffix");
        assert!(!policy.lists_suffix("baidu.com", 8080));
        assert!(!policy.lists_suffix("example.org", 443));
    }

    #[test]
    fn v5_policy_lists_tcp_endpoints_and_direct_addresses_and_excludes_protected_and_dns_ports() {
        let (signing, public) = key(3);
        let json = r#"{
            "version": 5,
            "revision": 11,
            "domains": [],
            "mediaEndpoints": [],
            "webDomains": [],
            "directSuffixes": [],
            "tcpEndpoints": [
                {"address": "139.224.114.71", "ports": [53, 853, 55300]},
                {"address": "179.253.244.3", "ports": [443]},
                {"address": "160.79.104.10", "ports": [443]}
            ],
            "tcpDirectAddresses": [
                "103.253.207.41",
                "139.224.114.71",
                "1.1.1.1",
                "91.108.4.1"
            ]
        }"#;
        let policy = DirectPolicy::verify_with_key(&sign(&signing, json, 11), &public).unwrap();
        assert!(policy.lists_tcp_endpoint("139.224.114.71".parse().unwrap(), 55300));
        assert!(!policy.lists_tcp_endpoint("139.224.114.71".parse().unwrap(), 53));
        assert!(!policy.lists_tcp_endpoint("139.224.114.71".parse().unwrap(), 853));
        assert!(!policy.lists_tcp_endpoint("179.253.244.3".parse().unwrap(), 443));
        assert!(policy.lists_tcp_direct_address("103.253.207.41".parse().unwrap()));
        assert!(!policy.lists_tcp_direct_address("139.224.114.71".parse().unwrap()));
        assert!(!policy.lists_tcp_direct_address("1.1.1.1".parse().unwrap()));
        assert!(!policy.lists_tcp_direct_address("91.108.4.1".parse().unwrap()));
    }
}
