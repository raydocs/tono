//! Shared sing-box JSON compiler and frozen M1 synthetic/offline emitter.
//!
//! [`build_runtime`] consumes owner-admitted product inputs under the v2 shared
//! contract. It grants no snapshot trust or lifecycle authority. The original
//! [`build_synthetic_offline_draft`] below retains its frozen M0 behavior.
//!
//! This is NOT a product snapshot admission API. Synthetic documents have no
//! authentication/freshness authority. No caller may turn this draft into a
//! verified snapshot, Service IPC, or a product start request. M2 must obtain
//! immutable, current catalog/policy authorization from the existing owner.
//!
//! Draft != bounded fixed-core check != Started != Connected. A successful
//! check only parses/constructs; HTTP 204 is never application evidence.
//! M2 must keep WFP armed, stop and confirm old PID/Job/TUN exit before starting
//! a replacement, then verify current generation, binary/PID/listener identity,
//! secret, TUN LUID, protected DNS/HTTPS and selected tuple before Connected.
//! Timeout/cancellation does not release resources. No PUT reload, fallback,
//! selector switching, POST replay or lifecycle implementation lives here.

use crate::catalog::{CatalogRouting, ExitCatalogResponse, catalog_digest};
use crate::config::{DirectPlan, RuntimePorts};
use crate::node::{NodeProtocol, ValidatedNode, admit_node, admit_nodes, validate_node_set};
use crate::policy::{TonoTrafficPolicy, TonoTrafficPolicyResponse};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fmt, net::SocketAddrV4};
use thiserror::Error;

mod runtime;
pub use runtime::{DialEndpoint, OwnedSingBoxRuntime, RuntimeInput, Transport, build_runtime};

pub const PROFILE: &str = "reality-tcp-no-special-routing-v1";
const MAX_BYTES: usize = 8 * 1024 * 1024;

/// Deliberately carries no arbitrary error detail or credential-bearing source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum SingBoxError {
    #[error("TONO_SINGBOX_UNTRUSTED_SNAPSHOT")]
    UntrustedSnapshot,
    #[error("TONO_SINGBOX_UNSUPPORTED_POLICY")]
    UnsupportedPolicy,
    #[error("TONO_SINGBOX_UNSUPPORTED_HOME_ROUTE")]
    UnsupportedHomeRoute,
    #[error("TONO_SINGBOX_UNSUPPORTED_TRANSPORT")]
    UnsupportedTransport,
    #[error("TONO_SINGBOX_INVALID_NODE")]
    InvalidNode,
    #[error("TONO_SINGBOX_UNSUPPORTED_FINGERPRINT")]
    UnsupportedFingerprint,
    #[error("TONO_SINGBOX_INVALID_CONTROL")]
    InvalidControl,
    #[error("TONO_SINGBOX_UNSUPPORTED_CERTIFICATE_PIN")]
    UnsupportedCertificatePin,
}

/// Explicitly synthetic data, not deserializable from a product/IPC request.
/// Borrowed immutable documents are retained alongside generation in the draft.
/// The raw routing object is mandatory: sanitized routing loses home/unknown keys.
/// Requirements must include product defaults, native/web DIRECT, leases, home,
/// DNS, IPv6, UDP, sniff and rule-set needs. None means unknown, not empty.
/// Every requirement is unsupported; no unknown string is silently dropped.
pub struct SyntheticOfflineInput<'a> {
    pub catalog: Option<&'a ExitCatalogResponse>,
    pub policy: Option<&'a TonoTrafficPolicyResponse>,
    pub nodes: &'a [ValidatedNode],
    pub selected: &'a str,
    pub raw_catalog_routing: &'a Value,
    pub direct_plan: Option<&'a DirectPlan>,
    pub derived_requirements: Option<&'a [String]>,
    pub platform: &'a str,
    pub ports: RuntimePorts,
    pub controller_secret: &'a str,
    pub generation: u64,
}

/// Non-serializable, immutable, synthetic draft. Debug is an allowlisted summary.
/// It cannot be promoted to checked/Started/Connected by this module.
pub struct SingBoxRuntimeDraft<'a> {
    runtime_json: String,
    runtime_sha256: String,
    dial_endpoints: [SocketAddrV4; 1],
    input: SyntheticOfflineInput<'a>,
}

impl fmt::Debug for SingBoxRuntimeDraft<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SingBoxRuntimeDraft")
            .field("profile", &PROFILE)
            .field("scope", &"SYNTHETIC_OFFLINE_ONLY_CHECK_NEVER_RUN")
            .field("node_count", &self.input.nodes.len())
            .field(
                "selected_index",
                &self
                    .input
                    .nodes
                    .iter()
                    .position(|n| n.name == self.input.selected),
            )
            .field("runtime_sha256", &self.runtime_sha256)
            .finish()
    }
}

impl SingBoxRuntimeDraft<'_> {
    /// Sensitive bytes, only for controlled offline check staging; never log.
    pub fn runtime_json(&self) -> &str {
        &self.runtime_json
    }
    pub fn runtime_sha256(&self) -> &str {
        &self.runtime_sha256
    }
    /// TCP only. std's native IPv4 tuple avoids a dependency on Service IPC.
    /// Not a WFP permit, not the route exclusion set, and not Connected proof.
    pub fn dial_endpoints(&self) -> &[SocketAddrV4; 1] {
        &self.dial_endpoints
    }
    pub fn generation(&self) -> u64 {
        self.input.generation
    }
}

/// Generate only an offline draft. There is intentionally no product entry point
/// that accepts a caller-provided `verified=true`, or an expired/revoked snapshot.
pub fn build_synthetic_offline_draft(
    input: SyntheticOfflineInput<'_>,
) -> Result<SingBoxRuntimeDraft<'_>, SingBoxError> {
    use SingBoxError::*;
    let catalog = input.catalog.ok_or(UntrustedSnapshot)?;
    let policy = input.policy.ok_or(UntrustedSnapshot)?;
    if catalog.revision < 0
        || policy.revision < 0
        || catalog.yaml.len() > MAX_BYTES
        || policy.json.len() > MAX_BYTES
        || catalog.sha256 != catalog_digest(&catalog.yaml)
        || policy.sha256 != catalog_digest(&policy.json)
    {
        return Err(UntrustedSnapshot);
    }

    let routing = input
        .raw_catalog_routing
        .as_object()
        .ok_or(UntrustedSnapshot)?;
    if routing.contains_key("homeProxy")
        || routing.contains_key("homeSocks5")
        || catalog
            .routing
            .as_ref()
            .is_some_and(|r| r.home_proxy.is_some() || r.home_socks5.is_some())
    {
        return Err(UnsupportedHomeRoute);
    }
    if routing.keys().any(|key| key != "defaultProxy") {
        return Err(UnsupportedPolicy);
    }
    let parsed_routing: CatalogRouting =
        serde_json::from_value(input.raw_catalog_routing.clone()).map_err(|_| UntrustedSnapshot)?;
    if parsed_routing != catalog.routing.clone().unwrap_or_default() {
        return Err(UntrustedSnapshot);
    }

    let document: Value = serde_json::from_str(&policy.json).map_err(|_| UnsupportedPolicy)?;
    let fields = document.as_object().ok_or(UnsupportedPolicy)?;
    // A signed document may name its own revision (#317). It must be the
    // envelope's; a different one means the envelope was relabelled.
    let embeds_revision = match fields.get("revision") {
        None => false,
        Some(embedded) if embedded.as_i64() == Some(policy.revision) => true,
        Some(_) => return Err(UntrustedSnapshot),
    };
    if fields.keys().any(|key| {
        ![
            "version",
            "domains",
            "mediaEndpoints",
            "webDomains",
            "directSuffixes",
            "revision",
        ]
        .contains(&key.as_str())
    }) || fields.len() != 5 + usize::from(embeds_revision)
    {
        return Err(UnsupportedPolicy);
    }
    // Parse the original bytes into the native struct as well: parsing the
    // intermediate Value would hide duplicate keys (e.g. a second domains: []).
    let policy: TonoTrafficPolicy =
        serde_json::from_str(&policy.json).map_err(|_| UnsupportedPolicy)?;
    if policy.version != 3
        || !policy.domains.is_empty()
        || !policy.media_endpoints.is_empty()
        || !policy.web_domains.is_empty()
        || !policy.direct_suffixes.is_empty()
        || input.direct_plan.is_some()
    {
        return Err(UnsupportedPolicy);
    }
    let requirements = input.derived_requirements.ok_or(UnsupportedPolicy)?;
    if requirements.iter().any(|r| r == "home") {
        return Err(UnsupportedHomeRoute);
    }
    if requirements.iter().any(|r| r == "tailnet" || r == "socks") {
        return Err(UnsupportedTransport);
    }
    if !requirements.is_empty() {
        return Err(UnsupportedPolicy);
    }

    // Re-admit the full document, not a filtered node list. Unknown top-level
    // requirements and node fields refuse rather than being lost by admission.
    let yaml: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(&catalog.yaml).map_err(|_| InvalidNode)?;
    let map = yaml.as_mapping().ok_or(InvalidNode)?;
    if map.len() != 1 {
        return Err(UnsupportedPolicy);
    }
    let entries = map
        .get("proxies")
        .and_then(|v| v.as_sequence())
        .ok_or(InvalidNode)?;
    for entry in entries {
        let fields = entry.as_mapping().ok_or(InvalidNode)?;
        if fields.get("type").and_then(|v| v.as_str()) != Some("vless")
            || fields
                .get("network")
                .is_some_and(|v| v.as_str() != Some("tcp"))
        {
            return Err(UnsupportedTransport);
        }
        if fields.keys().any(|k| {
            !matches!(
                k.as_str(),
                Some(
                    "name"
                        | "type"
                        | "server"
                        | "port"
                        | "uuid"
                        | "tls"
                        | "network"
                        | "servername"
                        | "sni"
                        | "client-fingerprint"
                        | "flow"
                        | "reality-opts"
                        | "skip-cert-verify"
                )
            )
        }) {
            return Err(UnsupportedPolicy);
        }
        let reality = fields
            .get("reality-opts")
            .and_then(|v| v.as_mapping())
            .ok_or(InvalidNode)?;
        if reality
            .keys()
            .any(|k| !matches!(k.as_str(), Some("public-key" | "short-id")))
        {
            return Err(InvalidNode);
        }
    }
    let admitted = admit_nodes(entries).map_err(|_| InvalidNode)?;
    if input.nodes.is_empty() {
        return Err(InvalidNode);
    }
    validate_node_set(input.nodes).map_err(|_| InvalidNode)?;
    for node in input.nodes {
        if node.protocol != NodeProtocol::VlessReality {
            return Err(UnsupportedTransport);
        }
        if node.client_fingerprint.as_deref() != Some("chrome") {
            return Err(UnsupportedFingerprint);
        }
        if [
            "Tono-TUN",
            "Tono-DNS",
            "Tono-Mixed",
            "Tono-FakeIP",
            "Tono-DoH",
        ]
        .contains(&node.name.as_str())
            || node.tls_fingerprint.is_some()
            || URL_SAFE_NO_PAD
                .decode(&node.reality_public_key)
                .map_or(true, |k| k.len() != 32)
        {
            return Err(InvalidNode);
        }
        let checked = admit_node(&serde_yaml_ng::Value::Mapping(node.to_runtime_mapping()))
            .map_err(|_| InvalidNode)?;
        if &checked != node {
            return Err(InvalidNode);
        }
    }
    if admitted != input.nodes {
        return Err(UntrustedSnapshot);
    }
    let selected = input
        .nodes
        .iter()
        .find(|n| n.name == input.selected)
        .ok_or(InvalidNode)?;
    let ports = &input.ports;
    if input.platform != "windows-amd64-v2"
        || ports.controller_port == 0
        || ports.controller_port == 53
        || ports.mixed_port == 53
        || ports.controller_port == ports.mixed_port
        || STANDARD
            .decode(input.controller_secret)
            .map_or(true, |s| s.len() != 32)
    {
        return Err(InvalidControl);
    }

    let exclusions: Vec<String> = input
        .nodes
        .iter()
        .map(|n| n.server)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|ip| format!("{ip}/32"))
        .collect();
    let mut inbounds = vec![
        json!({
            "type":"tun", "tag":"Tono-TUN", "interface_name":"Tono",
            "address":["198.18.0.1/30"], "dns_address":["198.18.0.2"], "dns_mode":"disabled",
            "auto_route":true, "strict_route":false, "mtu":1500, "multi_queue":false,
            "route_exclude_address":exclusions
        }),
        json!({"type":"direct", "tag":"Tono-DNS", "listen":"127.0.0.1", "listen_port":53}),
    ];
    if ports.mixed_port != 0 {
        inbounds.push(json!({"type":"mixed", "tag":"Tono-Mixed", "listen":"127.0.0.1", "listen_port":ports.mixed_port}));
    }
    let mut outbounds = Vec::new();
    for node in input.nodes {
        let mut outbound = json!({
            "type":"vless", "tag":node.name, "server":node.server.to_string(), "server_port":node.port,
            "uuid":node.uuid, "tls":{
                "enabled":true, "server_name":node.servername,
                "utls":{"enabled":true,"fingerprint":"chrome"},
                "reality":{"enabled":true,"public_key":node.reality_public_key,"short_id":node.reality_short_id}
            }
        });
        if let Some(flow) = &node.flow {
            outbound["flow"] = json!(flow);
        }
        outbounds.push(outbound);
    }
    let choices: Vec<&str> = std::iter::once(input.selected)
        .chain(
            input
                .nodes
                .iter()
                .filter(|n| n.name != input.selected)
                .map(|n| n.name.as_str()),
        )
        .collect();
    outbounds.push(
        json!({"type":"selector", "tag":"Tono-Exit", "outbounds":choices,
        "default":input.selected, "interrupt_exist_connections":true}),
    );
    let runtime = json!({
        "log":{"level":"warn"},
        "dns":{
            "servers":[{"type":"fakeip","tag":"Tono-FakeIP","inet4_range":"198.19.0.0/16"},
                {"type":"https","tag":"Tono-DoH","server":"1.1.1.1","server_port":443,
                "path":"/dns-query","tls":{"enabled":true,"server_name":"1.1.1.1"},"detour":"Tono-Exit"}],
            "rules":[{"query_type":["AAAA"],"action":"predefined","rcode":"NOERROR"},
                {"query_type":["A"],"action":"route","server":"Tono-FakeIP"}],
            "final":"Tono-DoH","strategy":"ipv4_only"
        },
        "inbounds":inbounds, "outbounds":outbounds,
        "route":{"auto_detect_interface":true,"rules":[
            {"ip_version":6,"action":"reject"},
            {"inbound":["Tono-DNS"],"action":"hijack-dns"},
            {"port":[53],"action":"hijack-dns"},
            {"network":["udp","icmp"],"action":"reject"}],"final":"Tono-Exit"},
        "experimental":{"cache_file":{"enabled":false},"clash_api":{
            "external_controller":format!("127.0.0.1:{}", ports.controller_port),
            "secret":input.controller_secret, "default_mode":"rule",
            "access_control_allow_origin":["tauri://localhost"],"access_control_allow_private_network":false}}
    });
    let runtime_json = serde_json::to_string(&runtime).map_err(|_| InvalidNode)?;
    if runtime_json.len() > MAX_BYTES {
        return Err(InvalidNode);
    }
    let runtime_sha256 = Sha256::digest(runtime_json.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(SingBoxRuntimeDraft {
        runtime_json,
        runtime_sha256,
        dial_endpoints: [SocketAddrV4::new(selected.server, selected.port)],
        input,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        reference: Value,
        catalog: ExitCatalogResponse,
        policy: TonoTrafficPolicyResponse,
        nodes: Vec<ValidatedNode>,
    }

    impl Fixture {
        fn new() -> Self {
            let reference: Value = serde_json::from_str(include_str!(
                "../../../../../docs/reports/sing-box-evaluation/migration-m0/reference.json"
            ))
            .unwrap();
            let yaml =
                serde_yaml_ng::to_string(&json!({"proxies":reference["input"]["nodes"]})).unwrap();
            let json = reference["input"]["policy_document"].to_string();
            let catalog = ExitCatalogResponse {
                revision: 17,
                sha256: catalog_digest(&yaml),
                yaml,
                updated_at: None,
                routing: None,
                routing_sha256: None,
            };
            let policy = TonoTrafficPolicyResponse {
                revision: 29,
                sha256: catalog_digest(&json),
                json,
                updated_at: None,
                signature: None,
            };
            let nodes = crate::catalog::validate_catalog(&catalog).unwrap();
            Self {
                reference,
                catalog,
                policy,
                nodes,
            }
        }

        fn input(&self) -> SyntheticOfflineInput<'_> {
            SyntheticOfflineInput {
                catalog: Some(&self.catalog),
                policy: Some(&self.policy),
                nodes: &self.nodes,
                selected: self.reference["input"]["selected"].as_str().unwrap(),
                raw_catalog_routing: &self.reference["input"]["catalog_routing"],
                direct_plan: None,
                derived_requirements: Some(&[]),
                platform: "windows-amd64-v2",
                ports: RuntimePorts {
                    controller_port: 29191,
                    mixed_port: 29190,
                },
                controller_secret: self.reference["input"]["controller_secret"]
                    .as_str()
                    .unwrap(),
                generation: u64::MAX,
            }
        }

        fn set_policy(&mut self, document: Value) {
            self.policy.json = document.to_string();
            self.policy.sha256 = catalog_digest(&self.policy.json);
        }
    }

    #[test]
    fn reference_second_node_and_actual_byte_digest() {
        let fixture = Fixture::new();
        let draft = build_synthetic_offline_draft(fixture.input()).unwrap();
        let actual: Value = serde_json::from_str(draft.runtime_json()).unwrap();
        assert_eq!(actual, fixture.reference["windows_runtime"]);
        assert_eq!(
            draft.dial_endpoints(),
            &["9.9.9.9:8443".parse::<SocketAddrV4>().unwrap()]
        );
        assert_eq!(draft.generation(), u64::MAX);
        // Bind the exact offline-check bytes, not just structural equivalence.
        // Independently computed with Python hashlib from the frozen handwritten
        // reference (sorted keys, compact separators, UTF-8, no trailing newline).
        assert_eq!(
            draft.runtime_json(),
            fixture.reference["windows_runtime"].to_string()
        );
        assert_eq!(
            draft.runtime_sha256(),
            "2228ce18d533dabee7937bdd65ad1d92268c5b666082cbc9c5e8104e3fb0bc0b"
        );
        assert!(!draft.runtime_json().starts_with('\u{feff}'));
    }

    #[test]
    fn debug_is_an_allowlisted_non_runnable_summary() {
        let fixture = Fixture::new();
        let draft = build_synthetic_offline_draft(fixture.input()).unwrap();
        let debug = format!("{draft:?}");
        assert!(debug.contains("selected_index: Some(1)"));
        assert!(debug.contains(PROFILE));
        assert!(!debug.contains(fixture.input().controller_secret));
        assert!(!debug.contains(&fixture.nodes[1].uuid));
        assert!(!debug.contains(&fixture.nodes[1].name));
        assert!(!debug.contains(&fixture.nodes[1].servername));
        assert!(!debug.contains(&fixture.nodes[1].reality_public_key));
        assert!(!debug.contains(&fixture.nodes[1].reality_short_id));
        assert!(!debug.contains("9.9.9.9"));
    }

    #[test]
    fn missing_or_mismatched_snapshot_refuses() {
        let mut fixture = Fixture::new();
        let mut input = fixture.input();
        input.policy = None;
        assert_eq!(
            build_synthetic_offline_draft(input).unwrap_err(),
            SingBoxError::UntrustedSnapshot
        );
        fixture.catalog.sha256 = "not-the-raw-document-digest".into();
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UntrustedSnapshot
        );
    }

    #[test]
    fn raw_home_presence_survives_sanitized_empty_routing() {
        let mut fixture = Fixture::new();
        fixture.reference["input"]["catalog_routing"] = json!({"homeProxy":""});
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedHomeRoute
        );
        fixture.reference["input"]["catalog_routing"] = json!({"homeSocks5":null});
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedHomeRoute
        );
    }

    #[test]
    fn nonempty_and_unknown_policy_refuse() {
        let mut fixture = Fixture::new();
        let mut policy = fixture.reference["input"]["policy_document"].clone();
        policy["webDomains"] = json!([{"host":"example.com","ports":[443]}]);
        fixture.set_policy(policy);
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
        let mut policy = fixture.reference["input"]["policy_document"].clone();
        policy["newRequiredCapability"] = json!(true);
        fixture.set_policy(policy);
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
        let mut policy = fixture.reference["input"]["policy_document"].clone();
        policy["version"] = json!(2);
        fixture.set_policy(policy);
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
    }

    #[test]
    fn empty_policy_does_not_erase_derived_direct_or_unknown_requirements() {
        let fixture = Fixture::new();
        let requirements = vec!["nativeAppDirect".to_owned()];
        let mut input = fixture.input();
        input.derived_requirements = Some(&requirements);
        assert_eq!(
            build_synthetic_offline_draft(input).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
        let requirements = vec!["future-required-capability".to_owned()];
        let mut input = fixture.input();
        input.derived_requirements = Some(&requirements);
        assert_eq!(
            build_synthetic_offline_draft(input).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
        let mut input = fixture.input();
        input.derived_requirements = None;
        assert_eq!(
            build_synthetic_offline_draft(input).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
    }

    #[test]
    fn signed_policy_revision_key_is_bound_to_the_envelope() {
        // #317: the Worker will embed `revision` inside the signed json. The
        // matching key is admitted; a different one means the envelope was
        // relabelled and the snapshot is refused.
        let mut fixture = Fixture::new();
        let mut policy = fixture.reference["input"]["policy_document"].clone();
        policy["revision"] = json!(fixture.policy.revision);
        fixture.set_policy(policy.clone());
        assert!(build_synthetic_offline_draft(fixture.input()).is_ok());
        policy["revision"] = json!(fixture.policy.revision + 1);
        fixture.set_policy(policy);
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UntrustedSnapshot
        );
    }

    #[test]
    fn duplicate_policy_key_cannot_hide_a_requirement() {
        let mut fixture = Fixture::new();
        fixture.policy.json = r#"{"version":3,"domains":[{"host":"example.com","ports":[443]}],"domains":[],"mediaEndpoints":[],"webDomains":[],"directSuffixes":[]}"#.into();
        fixture.policy.sha256 = catalog_digest(&fixture.policy.json);
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
    }

    #[test]
    fn even_an_empty_direct_plan_refuses() {
        let fixture = Fixture::new();
        let plan = DirectPlan {
            physical_interface: "Ethernet".into(),
            hosts: vec![],
            tcp_wechat_rules: vec![],
            tcp_web_rules: vec![],
            web_suffix_rules: vec![],
            udp_wechat_rules: vec![],
            wechat_process_path_regexes: vec![],
            reviewed_direct_ports: vec![],
        };
        let mut input = fixture.input();
        input.direct_plan = Some(&plan);
        assert_eq!(
            build_synthetic_offline_draft(input).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
    }

    #[test]
    fn filtered_out_hy2_in_complete_catalog_refuses() {
        let mut fixture = Fixture::new();
        fixture.catalog.yaml = fixture
            .catalog
            .yaml
            .replacen("type: vless", "type: hysteria2", 1);
        fixture.catalog.sha256 = catalog_digest(&fixture.catalog.yaml);
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedTransport
        );
    }

    #[test]
    fn forged_validated_node_is_readmitted() {
        let mut fixture = Fixture::new();
        fixture.nodes[1].server = "127.0.0.1".parse().unwrap();
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::InvalidNode
        );
        fixture.nodes[1].server = "9.9.9.9".parse().unwrap();
        fixture.nodes[1].name = "Tono-DNS".into();
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::InvalidNode
        );
    }

    #[test]
    fn fingerprint_must_be_explicit_chrome() {
        let mut fixture = Fixture::new();
        fixture.nodes[1].client_fingerprint = None;
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedFingerprint
        );
        fixture.nodes[1].client_fingerprint = Some("firefox".into());
        assert_eq!(
            build_synthetic_offline_draft(fixture.input()).unwrap_err(),
            SingBoxError::UnsupportedFingerprint
        );
    }

    #[test]
    fn listener_controls_refuse_conflicts_and_bad_secret() {
        let fixture = Fixture::new();
        let mut input = fixture.input();
        input.ports.controller_port = input.ports.mixed_port;
        assert_eq!(
            build_synthetic_offline_draft(input).unwrap_err(),
            SingBoxError::InvalidControl
        );
        let mut input = fixture.input();
        input.controller_secret = "not-a-32-byte-standard-base64-secret";
        let error = build_synthetic_offline_draft(input).unwrap_err();
        assert_eq!(error.to_string(), "TONO_SINGBOX_INVALID_CONTROL");
    }

    #[test]
    fn zero_mixed_omits_only_mixed_inbound() {
        let fixture = Fixture::new();
        let mut input = fixture.input();
        input.ports.mixed_port = 0;
        let draft = build_synthetic_offline_draft(input).unwrap();
        let actual: Value = serde_json::from_str(draft.runtime_json()).unwrap();
        let mut expected = fixture.reference["windows_runtime"].clone();
        expected["inbounds"].as_array_mut().unwrap().remove(2);
        assert_eq!(actual, expected);
        assert_eq!(draft.runtime_json(), expected.to_string());
        assert_eq!(
            draft.runtime_sha256(),
            "3eb3e31df8a9006d93c5fbbdb3910276391563640449f793a3e0503e08458cfa"
        );
    }
}
