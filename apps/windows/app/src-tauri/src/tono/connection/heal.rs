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
    let mut inner = state.lock().await;
    heal::note_health(&mut inner.heal, &node.name, reachable, now_ms());
    if reachable {
        return node;
    }
    let effect = heal::observe(
        &mut inner.heal,
        Some(heal::FailureClass::Tcp),
        &candidates(&inner.nodes),
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
