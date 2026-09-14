//! Product JSON compiler. Callers retain snapshot admission and native leases.
use super::{MAX_BYTES, SingBoxError};
use crate::{
    catalog::CatalogRouting,
    config::{self, DirectPlan, RuntimePorts},
    node::{self, NodeProtocol, ValidatedNode},
};
use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    net::Ipv4Addr,
};

/// All fields are required at the API boundary; there is no inferred policy.
pub struct RuntimeInput<'a> {
    pub nodes: &'a [ValidatedNode],
    pub selected: &'a str,
    pub controller_secret: &'a str,
    pub direct_plan: Option<&'a DirectPlan>,
    pub routing: &'a CatalogRouting,
    pub platform: &'a str,
    pub ports: RuntimePorts,
    pub required_capabilities: &'a [String],
    pub home_process_names: &'a [String],
    pub home_process_path_regexes: &'a [String],
    pub direct_process_names: &'a [String],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DialEndpoint {
    pub host: Ipv4Addr,
    pub port: u16,
    pub transport: Transport,
}

pub struct OwnedSingBoxRuntime {
    runtime_json: String,
    runtime_sha256: String,
    dial_endpoints: Vec<DialEndpoint>,
    direct_endpoints: Vec<DialEndpoint>,
    unavailable_nodes: Vec<usize>,
}

impl fmt::Debug for OwnedSingBoxRuntime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OwnedSingBoxRuntime")
            .field("runtime_sha256", &self.runtime_sha256)
            .finish_non_exhaustive()
    }
}

impl OwnedSingBoxRuntime {
    pub fn runtime_json(&self) -> &str {
        &self.runtime_json
    }
    pub fn runtime_sha256(&self) -> &str {
        &self.runtime_sha256
    }
    pub fn dial_endpoints(&self) -> &[DialEndpoint] {
        &self.dial_endpoints
    }
    pub fn direct_endpoints(&self) -> &[DialEndpoint] {
        &self.direct_endpoints
    }
    /// Full-catalog indices unavailable because stock TLS cannot enforce DER pin.
    /// Callers must surface these, not silently hide them or select an alternate.
    pub fn unavailable_nodes(&self) -> &[usize] {
        &self.unavailable_nodes
    }
    /// Allowlisted metadata, never a runnable configuration or credential dump.
    pub fn redacted_json(&self) -> String {
        json!({"engine":"sing-box", "contract_version":2, "runtime_sha256":self.runtime_sha256,
            "scope":"redacted-not-runnable"})
        .to_string()
    }
}

fn endpoint(node: &ValidatedNode) -> DialEndpoint {
    DialEndpoint {
        host: node.server,
        port: node.port,
        transport: if node.is_hysteria2() {
            Transport::Udp
        } else {
            Transport::Tcp
        },
    }
}

/// Compile only owner-admitted complete requirements. This is not a trust or
/// lifecycle API. A returned config must still pass fixed-core check and native
/// protected-start verification. No fallback, reload or HTTP operations occur.
pub fn build_runtime(input: RuntimeInput<'_>) -> Result<OwnedSingBoxRuntime, SingBoxError> {
    use SingBoxError::*;
    let interface = match input.platform {
        "macos-arm64" => "utun199",
        "windows-amd64-v2" => "Tono",
        _ => return Err(InvalidControl),
    };
    for capability in input.required_capabilities {
        match capability.as_str() {
            "reality-tcp" | "hy2" | "dns-proxied" | "tun" | "clash-api" => (),
            "direct" if input.direct_plan.is_some() => (),
            "home" if input.routing.home_proxy.is_some() || input.routing.home_socks5.is_some() => {
                ()
            }
            _ => return Err(UnsupportedPolicy),
        }
    }
    let ports = input.ports;
    let hex_secret = input.controller_secret.len() == 64
        && input
            .controller_secret
            .bytes()
            .all(|b| b.is_ascii_hexdigit());
    if ports.controller_port == 0
        || ports.controller_port == 53
        || ports.mixed_port == 53
        || ports.controller_port == ports.mixed_port
        || (!hex_secret
            && STANDARD
                .decode(input.controller_secret)
                .map_or(true, |s| s.len() != 32))
    {
        return Err(InvalidControl);
    }
    node::validate_node_set(input.nodes).map_err(|_| InvalidNode)?;
    let selected = input
        .nodes
        .iter()
        .find(|n| n.name == input.selected)
        .ok_or(InvalidNode)?;
    crate::catalog::validate_residential_routing(input.routing, input.nodes)
        .map_err(|_| UnsupportedHomeRoute)?;
    let home = if input.routing.home_socks5.is_some() {
        None
    } else {
        input
            .routing
            .home_proxy
            .as_ref()
            .and_then(|name| input.nodes.iter().find(|n| &n.name == name))
    };
    let mut outbounds = Vec::new();
    let mut unavailable_nodes = Vec::new();
    for (index, node) in input.nodes.iter().enumerate() {
        let checked = node::admit_node(&serde_yaml_ng::Value::Mapping(node.to_runtime_mapping()))
            .map_err(|_| InvalidNode)?;
        if checked != *node
            || [
                "Tono-TUN",
                "Tono-DNS",
                "Tono-Mixed",
                "Tono-FakeIP",
                "Tono-DoH",
                "Tono-Hosts",
            ]
            .contains(&node.name.as_str())
        {
            return Err(InvalidNode);
        }
        let outbound = match node.protocol {
            NodeProtocol::Hysteria2 => {
                // Existing admission requires DER pin for EVERY HY2 node.
                // Do not weaken it to manufacture a CA-only product path.
                if node.name == selected.name
                    || home.is_some_and(|h| h.name == node.name)
                    || input.required_capabilities.iter().any(|r| r == "hy2")
                {
                    return Err(UnsupportedCertificatePin);
                }
                unavailable_nodes.push(index);
                continue;
            }
            NodeProtocol::VlessReality => {
                if node.client_fingerprint.as_deref() != Some("chrome") {
                    return Err(UnsupportedFingerprint);
                }
                if URL_SAFE_NO_PAD
                    .decode(&node.reality_public_key)
                    .map_or(true, |v| v.len() != 32)
                {
                    return Err(InvalidNode);
                }
                let mut value = json!({"type":"vless", "tag":node.name, "server":node.server, "server_port":node.port,
                    "uuid":node.uuid, "tls":{"enabled":true,"server_name":node.servername,
                    "utls":{"enabled":true,"fingerprint":"chrome"},
                    "reality":{"enabled":true,"public_key":node.reality_public_key,"short_id":node.reality_short_id}}});
                if let Some(flow) = &node.flow {
                    value["flow"] = json!(flow);
                }
                value
            }
        };
        outbounds.push(outbound);
    }
    let choices: Vec<_> = std::iter::once(input.selected)
        .chain(
            input
                .nodes
                .iter()
                .enumerate()
                .filter(|(i, n)| n.name != input.selected && !unavailable_nodes.contains(i))
                .map(|(_, n)| n.name.as_str()),
        )
        .collect();
    outbounds.push(json!({"type":"selector","tag":"Tono-Exit","outbounds":choices,"default":input.selected,"interrupt_exist_connections":true}));
    let mut dial_endpoints = vec![endpoint(selected)];
    if let Some(home) = home {
        dial_endpoints.push(endpoint(home));
    }
    dial_endpoints.sort();
    dial_endpoints.dedup();
    let exclusions: BTreeSet<_> = dial_endpoints
        .iter()
        .map(|e| format!("{}/32", e.host))
        .collect();
    let mut runtime: Value = serde_json::from_str(include_str!(
        "../../../../../../tooling/scripts/sing-box/runtime-template.json"
    ))
    .map_err(|_| UnsupportedPolicy)?;
    runtime["inbounds"][0]["interface_name"] = json!(interface);
    runtime["inbounds"][0]["route_exclude_address"] = json!(exclusions);
    if ports.mixed_port != 0 {
        runtime["inbounds"].as_array_mut().unwrap().push(json!({"type":"mixed","tag":"Tono-Mixed","listen":"127.0.0.1","listen_port":ports.mixed_port}));
    }
    runtime["experimental"]["clash_api"]["external_controller"] =
        json!(format!("127.0.0.1:{}", ports.controller_port));
    runtime["experimental"]["clash_api"]["secret"] = json!(input.controller_secret);
    let rules = runtime["route"]["rules"].as_array_mut().unwrap();
    let home_target = if let Some(socks) = &input.routing.home_socks5 {
        outbounds.push(json!({"type":"socks","tag":config::HOME_SOCKS5_OUTBOUND_NAME,"server":socks.host,"server_port":socks.port,
            "version":"5","username":socks.username,"password":socks.password,"detour":"Tono-Exit"}));
        Some(config::HOME_SOCKS5_OUTBOUND_NAME)
    } else {
        home.map(|n| n.name.as_str())
    };
    if let Some(target) = home_target {
        rules.push(json!({"network":"tcp","domain_suffix":config::CLAUDE_HOME_DOMAINS.to_vec(),"action":"route","outbound":target}));
        rules.push(json!({"network":"tcp","ip_cidr":config::CLAUDE_HOME_IPV4_CIDRS.to_vec(),"action":"route","outbound":target}));
    }
    if home_target.is_some() || input.direct_plan.is_some() {
        for (field, values) in [
            ("process_name", input.home_process_names),
            ("process_path_regex", input.home_process_path_regexes),
        ] {
            if !values.is_empty() {
                let mut rule = json!({"network":"tcp","action":"route","outbound":home_target.unwrap_or("Tono-Exit")});
                rule[field] = json!(values);
                rules.push(rule);
            }
        }
    }
    let mut direct_endpoints = BTreeSet::new();
    let mut hosts: BTreeMap<String, BTreeSet<Ipv4Addr>> = BTreeMap::new();
    if let Some(plan) = input.direct_plan {
        DirectPlan::validate_physical_interface(&plan.physical_interface)
            .map_err(|_| UnsupportedPolicy)?;
        if plan.physical_interface.starts_with("utun")
            || plan.wechat_process_path_regexes.len() > config::MAX_WECHAT_PROCESS_PATH_REGEXES
            || plan
                .wechat_process_path_regexes
                .iter()
                .any(|p| !p.starts_with('^') || p.chars().any(char::is_control))
        {
            return Err(UnsupportedPolicy);
        }
        for (host, address) in &plan.hosts {
            let ip: Ipv4Addr = address.parse().map_err(|_| UnsupportedPolicy)?;
            if !node::is_public_ipv4(ip) || !valid_domain(host) {
                return Err(UnsupportedPolicy);
            }
            hosts.entry(host.clone()).or_default().insert(ip);
        }
        outbounds.push(json!({"type":"direct","tag":config::DIRECT_GROUP_NAME,"bind_interface":plan.physical_interface}));
        for (host, ip, port) in plan.tcp_wechat_rules.iter().chain(&plan.tcp_web_rules) {
            if !valid_domain(host) || !hosts.get(host).is_some_and(|ips| ips.contains(ip)) {
                return Err(UnsupportedPolicy);
            }
            validate_direct(*ip, *port, &dial_endpoints)?;
            direct_endpoints.insert(DialEndpoint {
                host: *ip,
                port: *port,
                transport: Transport::Tcp,
            });
            // Default sing-box rules OR domain/IP destination items. Explicit
            // logical AND is mandatory to preserve the exact endpoint boundary.
            rules.push(json!({"type":"logical","mode":"and","rules":[
                {"network":"tcp","port":port,"domain":[host]}, {"ip_cidr":[format!("{ip}/32")]}],
                "action":"route","outbound":config::DIRECT_GROUP_NAME}));
        }
        if !plan.wechat_process_path_regexes.is_empty() {
            if plan.tcp_wechat_rules.is_empty()
                || plan.reviewed_direct_ports.is_empty()
                || plan
                    .reviewed_direct_ports
                    .iter()
                    .any(|p| ![80, 443, 8080, 8443].contains(p))
            {
                return Err(UnsupportedPolicy);
            }
            rules.push(json!({"network":"tcp","port":plan.reviewed_direct_ports,"process_path_regex":plan.wechat_process_path_regexes,
                "action":"route","outbound":config::DIRECT_GROUP_NAME}));
        }
        for (suffix, port) in &plan.web_suffix_rules {
            if !config::is_address_free_web_suffix(suffix)
                || ![80, 443].contains(port)
                || plan.wechat_process_path_regexes.is_empty()
                || !plan.reviewed_direct_ports.contains(port)
            {
                return Err(UnsupportedPolicy);
            }
            rules.push(json!({"network":"tcp","port":port,"domain_suffix":[suffix],"action":"route","outbound":config::DIRECT_GROUP_NAME}));
        }
        for (ip, port) in &plan.udp_wechat_rules {
            validate_direct(*ip, *port, &dial_endpoints)?;
            if ![443, 8000].contains(port)
                || (input.direct_process_names.is_empty()
                    && plan.wechat_process_path_regexes.is_empty())
            {
                return Err(UnsupportedPolicy);
            }
            direct_endpoints.insert(DialEndpoint {
                host: *ip,
                port: *port,
                transport: Transport::Udp,
            });
            for (field, values) in [
                ("process_name", input.direct_process_names),
                (
                    "process_path_regex",
                    plan.wechat_process_path_regexes.as_slice(),
                ),
            ] {
                if values.is_empty() {
                    continue;
                }
                let mut rule = json!({"network":"udp","ip_cidr":[format!("{ip}/32")],"port":port,"action":"route","outbound":config::DIRECT_GROUP_NAME});
                rule[field] = json!(values);
                rules.push(rule);
            }
        }
    }
    rules.push(if selected.is_hysteria2() {
        json!({"network":"icmp","action":"reject"})
    } else {
        json!({"network":["udp","icmp"],"action":"reject"})
    });
    if !hosts.is_empty() {
        runtime["dns"]["servers"]
            .as_array_mut()
            .unwrap()
            .push(json!({"type":"hosts","tag":"Tono-Hosts","predefined":hosts}));
        runtime["dns"]["rules"].as_array_mut().unwrap().insert(1, json!({"inbound":["Tono-TUN","Tono-DNS","Tono-Mixed"],"query_type":["A"],"domain":hosts.keys().collect::<Vec<_>>(),"action":"route","server":"Tono-Hosts"}));
    }
    runtime["outbounds"] = json!(outbounds);
    let runtime_json = runtime.to_string();
    if runtime_json.len() > MAX_BYTES {
        return Err(UnsupportedPolicy);
    }
    let runtime_sha256 = Sha256::digest(runtime_json.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok(OwnedSingBoxRuntime {
        runtime_json,
        runtime_sha256,
        dial_endpoints,
        direct_endpoints: direct_endpoints.into_iter().collect(),
        unavailable_nodes,
    })
}

fn valid_domain(host: &str) -> bool {
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
}

fn validate_direct(ip: Ipv4Addr, port: u16, dial: &[DialEndpoint]) -> Result<(), SingBoxError> {
    if !node::is_public_ipv4(ip)
        || crate::policy::is_permanently_protected(ip)
        || port == 0
        || port == 53
        || dial.iter().any(|e| e.host == ip)
    {
        return Err(SingBoxError::UnsupportedPolicy);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nodes() -> Vec<ValidatedNode> {
        let reference: Value = serde_json::from_str(include_str!(
            "../../../../../../docs/reports/sing-box-evaluation/migration-m0/reference.json"
        ))
        .unwrap();
        reference["input"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| node::admit_node(&serde_yaml_ng::to_value(n).unwrap()).unwrap())
            .collect()
    }

    fn input<'a>(nodes: &'a [ValidatedNode], routing: &'a CatalogRouting) -> RuntimeInput<'a> {
        RuntimeInput {
            nodes,
            selected: "Fixture Beta",
            controller_secret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
            direct_plan: None,
            routing,
            platform: "windows-amd64-v2",
            ports: RuntimePorts {
                mixed_port: 29190,
                controller_port: 29191,
            },
            required_capabilities: &[],
            home_process_names: &[],
            home_process_path_regexes: &[],
            direct_process_names: &[],
        }
    }

    #[test]
    fn json_boundary_keeps_second_selection_and_scopes_fake_dns_without_stack() {
        let nodes = nodes();
        let routing = CatalogRouting::default();
        let mut request = input(&nodes, &routing);
        request.platform = "macos-arm64";
        request.ports.mixed_port = 0;
        request.controller_secret =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let runtime = build_runtime(request).unwrap();
        let value: Value = serde_json::from_str(runtime.runtime_json()).unwrap();
        assert_eq!(value["inbounds"][0]["interface_name"], "utun199");
        assert!(value["inbounds"][0].get("stack").is_none());
        assert_eq!(value["inbounds"].as_array().unwrap().len(), 2);
        assert_eq!(
            value["dns"]["rules"][1]["inbound"],
            json!(["Tono-TUN", "Tono-DNS", "Tono-Mixed"])
        );
        assert_eq!(value["dns"]["final"], "Tono-DoH");
        assert_eq!(
            value["outbounds"][2]["outbounds"],
            json!(["Fixture Beta", "Fixture Alpha"])
        );
        assert_eq!(
            runtime.dial_endpoints(),
            &[DialEndpoint {
                host: "9.9.9.9".parse().unwrap(),
                port: 8443,
                transport: Transport::Tcp
            }]
        );
        assert!(!format!("{runtime:?}").contains("Fixture"));
        assert!(!runtime.redacted_json().contains("0123456789abcdef"));
        let requirements = ["future-capability".to_string()];
        let mut request = input(&nodes, &routing);
        request.required_capabilities = &requirements;
        assert_eq!(
            build_runtime(request).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
    }

    #[test]
    fn direct_domain_and_ip_are_conjunctive_and_dns_pins_do_not_capture_api_refresh() {
        let nodes = nodes();
        let routing = CatalogRouting::default();
        let mut plan = DirectPlan {
            physical_interface: "Ethernet".into(),
            hosts: vec![("qq.com".into(), "101.1.2.3".into())],
            tcp_wechat_rules: vec![("qq.com".into(), "101.1.2.3".parse().unwrap(), 443)],
            tcp_web_rules: vec![],
            web_suffix_rules: vec![],
            udp_wechat_rules: vec![],
            wechat_process_path_regexes: vec![],
            reviewed_direct_ports: vec![],
        };
        let mut request = input(&nodes, &routing);
        request.direct_plan = Some(&plan);
        let runtime = build_runtime(request).unwrap();
        let value: Value = serde_json::from_str(runtime.runtime_json()).unwrap();
        assert_eq!(
            value["route"]["rules"][3],
            json!({"type":"logical","mode":"and","rules":[
            {"network":"tcp","port":443,"domain":["qq.com"]},{"ip_cidr":["101.1.2.3/32"]}],
            "action":"route","outbound":"Tono-China-Direct"})
        );
        assert_eq!(
            value["dns"]["servers"][2]["predefined"]["qq.com"],
            json!(["101.1.2.3"])
        );
        assert_eq!(
            value["dns"]["rules"][1]["inbound"],
            json!(["Tono-TUN", "Tono-DNS", "Tono-Mixed"])
        );
        assert_eq!(runtime.direct_endpoints()[0].port, 443);
        plan.tcp_wechat_rules[0].1 = "101.1.2.4".parse().unwrap();
        let mut request = input(&nodes, &routing);
        request.direct_plan = Some(&plan);
        assert_eq!(
            build_runtime(request).unwrap_err(),
            SingBoxError::UnsupportedPolicy
        );
    }

    #[test]
    fn home_socks_detours_through_selected_exit_without_a_physical_home_permit() {
        let nodes = nodes();
        let routing = CatalogRouting {
            home_proxy: Some("Fixture Alpha".into()),
            default_proxy: None,
            home_socks5: Some(crate::catalog::CatalogHomeSocks5 {
                host: "home.example".into(),
                port: 1080,
                username: "user".into(),
                password: "sensitive-home-secret".into(),
            }),
        };
        let runtime = build_runtime(input(&nodes, &routing)).unwrap();
        let value: Value = serde_json::from_str(runtime.runtime_json()).unwrap();
        assert_eq!(value["outbounds"][3]["detour"], "Tono-Exit");
        assert_eq!(
            value["route"]["rules"][3]["outbound"],
            "Tono-Home-Residential"
        );
        assert_eq!(runtime.dial_endpoints().len(), 1);
        assert!(!runtime.redacted_json().contains("sensitive-home-secret"));
        let routing = CatalogRouting {
            home_socks5: None,
            ..routing
        };
        assert_eq!(
            build_runtime(input(&nodes, &routing))
                .unwrap()
                .dial_endpoints()
                .len(),
            2
        );
    }

    #[test]
    fn hy2_der_pin_never_becomes_spki_or_disappears_silently() {
        let mut nodes = nodes();
        let hy2 = node::admit_node(&serde_yaml_ng::to_value(json!({"name":"Fixture Alpha · hy2","type":"hysteria2",
            "server":"8.8.4.4","port":8444,"password":"11111111-1111-4111-8111-111111111111","sni":"hy2.example","fingerprint":"ab".repeat(32)})).unwrap()).unwrap();
        nodes.push(hy2);
        let routing = CatalogRouting::default();
        let mut request = input(&nodes, &routing);
        request.selected = "Fixture Alpha · hy2";
        assert_eq!(
            build_runtime(request).unwrap_err(),
            SingBoxError::UnsupportedCertificatePin
        );
        let runtime = build_runtime(input(&nodes, &routing)).unwrap();
        assert_eq!(runtime.unavailable_nodes(), &[2]);
        assert!(!runtime.runtime_json().contains("Fixture Alpha · hy2"));
        let required = ["hy2".into()];
        let mut request = input(&nodes, &routing);
        request.required_capabilities = &required;
        assert_eq!(
            build_runtime(request).unwrap_err(),
            SingBoxError::UnsupportedCertificatePin
        );
        nodes[2].tls_fingerprint = None;
        assert_eq!(
            build_runtime(input(&nodes, &routing)).unwrap_err(),
            SingBoxError::InvalidNode
        );
    }
}
