//! Proxy endpoint construction for WFP permits.

use tono_core::node::{ExitTransport, NodeRejection, ValidatedNode};
use tono_service_protocol::{ProxyEndpoint, ProxyProtocol};

/// §6.2 endpoint derivation: the selected node's public IPv4/port over TCP.
pub fn proxy_endpoint_of(node: &ValidatedNode) -> ProxyEndpoint {
    ProxyEndpoint {
        ip: node.server.to_string(),
        port: node.port,
        protocol: ProxyProtocol::Tcp,
    }
}

pub(super) fn proxy_endpoints_for(
    node: &ValidatedNode,
    transport: ExitTransport,
) -> Result<Vec<ProxyEndpoint>, NodeRejection> {
    // Home SOCKS5 is always dialed through this VPS, never a physical exception.
    // Legacy homeProxy is rejected by catalog/runtime admission, not permitted here.
    Ok(vec![ProxyEndpoint {
        ip: node.server.to_string(),
        port: node.transport_port(transport)?,
        protocol: match transport {
            ExitTransport::RealityTcp => ProxyProtocol::Tcp,
            ExitTransport::Hysteria2Udp => ProxyProtocol::Udp,
        },
    }])
}

pub fn unique_proxy_endpoints(endpoints: Vec<ProxyEndpoint>) -> Vec<ProxyEndpoint> {
    let mut unique = Vec::new();
    for endpoint in endpoints {
        if !unique.iter().any(|existing: &ProxyEndpoint| {
            existing.ip == endpoint.ip
                && existing.port == endpoint.port
                && existing.protocol == endpoint.protocol
        }) {
            unique.push(endpoint);
        }
    }
    unique
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carrier_and_wfp_share_exact_selected_vps_tuple_without_home_permit() {
        let value = serde_yaml_ng::from_str(r#"
name: Synthetic VPS
type: vless
server: 8.8.8.8
port: 443
uuid: 00000000-0000-4000-8000-000000000001
tls: true
servername: www.example.com
reality-opts:
  public-key: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  short-id: ab
tono-hysteria2:
  port: 8443
  password: synthetic-auth
  sni: udp.example.com
"#).unwrap();
        let mut node = tono_core::node::admit_node(&value).unwrap();
        for (transport, protocol, port) in [
            (ExitTransport::RealityTcp, ProxyProtocol::Tcp, 443),
            (ExitTransport::Hysteria2Udp, ProxyProtocol::Udp, 8443),
        ] {
            let endpoints = proxy_endpoints_for(&node, transport).unwrap();
            assert_eq!(endpoints.len(), 1);
            assert_eq!(endpoints[0].protocol, protocol);
            assert_eq!(endpoints[0].ip, node.server.to_string());
            assert_eq!(endpoints[0].port, port);
            let runtime = node.to_runtime_mapping_for(transport).unwrap();
            assert_eq!(runtime[serde_yaml_ng::Value::String("port".into())].as_u64(), Some(port as u64));
        }
        node.hysteria2 = None;
        assert_eq!(proxy_endpoints_for(&node, ExitTransport::Hysteria2Udp).unwrap_err(), NodeRejection::TransportUnavailable);
    }
}
