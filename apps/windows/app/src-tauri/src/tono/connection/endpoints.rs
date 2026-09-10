//! Proxy endpoint construction for WFP permits.

use tono_core::node::ValidatedNode;
use tono_service_protocol::{ProxyEndpoint, ProxyProtocol};

/// §6.2 endpoint derivation: VLESS is TCP; hy2 is that same IPv4/port over UDP.
/// Selecting a VLESS node does not pre-permit a sibling hy2 block.
pub fn proxy_endpoint_of(node: &ValidatedNode) -> ProxyEndpoint {
    ProxyEndpoint {
        ip: node.server.to_string(),
        port: node.port,
        protocol: if node.is_hysteria2() {
            ProxyProtocol::Udp
        } else {
            ProxyProtocol::Tcp
        },
    }
}

pub(super) fn proxy_endpoints_for(
    node: &ValidatedNode,
    nodes: &[ValidatedNode],
    routing: Option<&tono_core::CatalogRouting>,
) -> Vec<ProxyEndpoint> {
    let home_socks5 = routing.and_then(|routing| routing.home_socks5.as_ref());
    let home_node = if home_socks5.is_some() {
        None
    } else {
        routing
            .and_then(|routing| routing.home_proxy.as_deref())
            .and_then(|name| nodes.iter().find(|entry| entry.name == name))
    };
    let mut endpoints = vec![proxy_endpoint_of(node)];
    if let Some(home) = home_node
        && (home.server != node.server || home.port != node.port)
    {
        endpoints.push(proxy_endpoint_of(home));
    }
    endpoints
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
