//! Apply the pure self-heal decision without writing PF or WFP.
//!
//! A new dial name is used only while the barrier is down. An ordinary failure
//! under a verified barrier asks for one explicit release (the same path as
//! Disconnect) and does not start another tunnel. Windows has no explicit
//! strict kill switch, so this path never holds the machine offline to rotate
//! nodes.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use tono_core::ValidatedNode;
use tono_core::heal::{self, Candidate, KillSwitchStance, NetworkEffect, Transport};
use tono_logging::{Type, logging};

use crate::tono::state::{TonoInner, TonoState};

pub fn residential_id(routing: Option<&tono_core::CatalogRouting>) -> String {
    if let Some(socks) = routing.and_then(|routing| routing.home_socks5.as_ref()) {
        return format!("socks5:{}:{}", socks.host, socks.port);
    }
    if let Some(name) = routing.and_then(|routing| routing.home_proxy.as_deref()) {
        return format!("home:{name}");
    }
    "none".to_string()
}

pub fn prepare(inner: &mut TonoInner) {
    let preferred = inner.selected_node.clone().unwrap_or_default();
    let residential = residential_id(inner.routing.as_ref());
    if inner.heal.preferred.is_empty() && !preferred.is_empty() {
        inner.heal = heal::Session::for_preferred(preferred.clone(), residential.clone());
    }
    inner.heal.stick_to_preferred(preferred, residential);
    let armed_and_verified = inner.fsm.kill_switch_armed() && inner.fsm.session_verified();
    heal::note_protection(&mut inner.heal, armed_and_verified, now_ms());
}

/// Dial target for a connect that has not armed protection. While the barrier
/// is up, the saved server is the only name we will dial.
pub fn dial_name(inner: &TonoInner) -> String {
    let selected = inner.selected_node.clone().unwrap_or_default();
    if inner.fsm.kill_switch_armed() {
        return selected;
    }
    if inner.nodes.iter().any(|node| node.name == inner.heal.dial) {
        return inner.heal.dial.clone();
    }
    selected
}

pub fn on_failure(inner: &mut TonoInner, error: &str) -> NetworkEffect {
    prepare(inner);
    let nodes = candidates(&inner.nodes);
    heal::observe(
        &mut inner.heal,
        Some(heal::classify_failure(error)),
        &nodes,
        KillSwitchStance::Ordinary,
        now_ms(),
    )
}

pub fn note_connected(inner: &mut TonoInner) {
    if inner.heal.dial == inner.heal.preferred {
        inner.heal.tried.clear();
        inner.heal.pending_dial = None;
        inner.heal.backup_since_ms = None;
    } else if !inner.heal.dial.is_empty() {
        inner.heal.backup_since_ms.get_or_insert(now_ms());
    }
}

/// Before the barrier exists, a recovery connect may spend one TCP fail-fast
/// budget to avoid installing a tunnel on a node that just refused. The first
/// connect does not wait. A hysteria2 node is not probed with TCP.
pub async fn refine_before_arm(state: &Arc<TonoState>, node: ValidatedNode) -> ValidatedNode {
    let recovery = {
        let inner = state.lock().await;
        !inner.fsm.kill_switch_armed()
            && !node.is_hysteria2()
            && (inner.heal.dial != inner.heal.preferred || !inner.heal.tried.is_empty())
    };
    if !recovery {
        return node;
    }
    let address = SocketAddr::new(IpAddr::V4(node.server), node.port);
    let reachable = tokio::time::timeout(
        Duration::from_millis(heal::TCP_FAIL_FAST_MS),
        tokio::net::TcpStream::connect(address),
    )
    .await
    .ok()
    .and_then(|result| result.ok())
    .is_some();
    if reachable {
        // The pre-tunnel proof dials this same endpoint next; this answer stands in for it.
        state.unarmed_proofs.lock().remember(&address.to_string(), now_ms());
    }
    let mut inner = state.lock().await;
    heal::note_health(&mut inner.heal, &node.name, reachable, now_ms());
    if reachable {
        return node;
    }
    let nodes = candidates(&inner.nodes);
    let effect = heal::observe(
        &mut inner.heal,
        Some(heal::FailureClass::Tcp),
        &nodes,
        KillSwitchStance::Ordinary,
        now_ms(),
    );
    let NetworkEffect::DialBeforeArm {
        name, dialer_changed, ..
    } = effect
    else {
        return node;
    };
    logging!(
        info,
        Type::Service,
        "Tono: recovery preflight moved the dial target before protection; residential identity unchanged (dialer changed: {dialer_changed})"
    );
    inner
        .nodes
        .iter()
        .find(|item| item.name == name)
        .cloned()
        .unwrap_or(node)
}

fn candidates(nodes: &[ValidatedNode]) -> Vec<Candidate> {
    nodes
        .iter()
        .map(|node| Candidate {
            name: node.name.clone(),
            region: heal::region_key(&node.name),
            server: node.server.to_string(),
            port: node.port,
            sni: node.servername.clone(),
            transport: if node.is_hysteria2() {
                Transport::Hy2
            } else {
                Transport::Tcp
            },
            udp_vendor_blocked: heal::udp_vendor_blocked(&node.name),
            rtt_ms: None,
        })
        .collect()
}

fn now_ms() -> u64 {
    crate::tono::commands::epoch_millis().max(0) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    /// WIN-REFINE-PROOF-UNSHARED: a recovery refine proved the endpoint with TCP but did not
    /// record it, so the pre-tunnel proof dialed the same endpoint again.
    #[tokio::test]
    async fn successful_refine_populates_endpoint_proof() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let node = ValidatedNode {
            name: "US Reality fixture".into(),
            server: std::net::Ipv4Addr::LOCALHOST,
            port: listener.local_addr().unwrap().port(),
            uuid: "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d".into(),
            servername: "www.microsoft.com".into(),
            flow: None,
            client_fingerprint: None,
            reality_public_key: "0123456789abcdef0123456789abcdef0123456789a".into(),
            reality_short_id: "0123456789abcdef".into(),
            protocol: tono_core::node::NodeProtocol::VlessReality,
            tls_fingerprint: None,
            certificate_public_key_sha256: None,
        };
        let state = Arc::new(TonoState::for_test());
        {
            let mut inner = state.lock().await;
            inner.heal = heal::Session::for_preferred(node.name.clone(), "none");
            inner.heal.tried.insert("Tokyo · Fuji".into());
        }
        assert_eq!(refine_before_arm(&state, node.clone()).await.name, node.name);
        // Closed: a second dial to this endpoint can no longer succeed.
        drop(listener);
        super::super::unarmed_probe::tcp_proof_before_tunnel(&state, &node)
            .await
            .expect("the refine's answer stands in for the pre-tunnel dial");
    }
}
