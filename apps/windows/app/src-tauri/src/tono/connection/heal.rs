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
///
/// A17: when the healer is on the selected Reality node and the control plane
/// permits it, the same node's ` · hy2` block replaces it after
/// [`tono_core::hy2_switch::TCP_FAILURES_BEFORE_HY2`] TCP failures or while a
/// hy2 success is remembered. Under an armed barrier it never moves the dial;
/// it only keeps an automatic hy2 session on the exact endpoint the barrier
/// already permits. If the grant was withdrawn or that block changed, the
/// selected Reality block is rebuilt with the barrier kept (fail-closed).
pub fn dial_name(inner: &TonoInner) -> String {
    let selected = inner.selected_node.clone().unwrap_or_default();
    if inner.fsm.kill_switch_armed() {
        return inner
            .hy2_switch
            .live_dial(&selected, &inner.nodes, now_ms())
            .unwrap_or(selected);
    }
    let dial = if inner.nodes.iter().any(|node| node.name == inner.heal.dial) {
        inner.heal.dial.clone()
    } else {
        selected.clone()
    };
    if dial == selected
        && let Some(hy2) = inner.hy2_switch.dial(&selected, &inner.nodes, now_ms())
    {
        logging!(
            info,
            Type::Service,
            "Tono: hy2 auto-switch: dialing the selected node's hy2 block (same node, same identity)"
        );
        return hy2;
    }
    dial
}

pub fn on_failure(inner: &mut TonoInner, error: &str) -> NetworkEffect {
    prepare(inner);
    let on_selected = inner.heal.dial == inner.heal.preferred;
    let nodes = candidates(&inner.nodes, &inner.heal);
    let effect = heal::observe(
        &mut inner.heal,
        Some(heal::classify_failure(error)),
        &nodes,
        KillSwitchStance::Ordinary,
        now_ms(),
    );
    // A17: while the same-node hy2 switch owns the selected node, the next
    // dial stays on that node (TCP until the count is reached, then its hy2
    // block). The protection effect above is unchanged; only the dial target
    // is kept. Once the switch stops holding (flag off, no hy2 block, or the
    // backoff after a failed hy2 attempt), the healer moves on as before.
    if on_selected && inner.hy2_switch.holds(&inner.heal.preferred, &inner.nodes, now_ms()) {
        inner.heal.dial = inner.heal.preferred.clone();
        inner.heal.pending_dial = None;
        inner.heal.tried.clear();
        inner.heal.backup_since_ms = None;
    }
    effect
}

/// A17: settle one finished attempt. `preferred` is the selection captured
/// when the attempt was admitted and `dialed` the node it actually dialed.
/// `owner` is (sign-in generation, admitted connection generation). A
/// superseded attempt (`Stale`, or a connection generation that moved) or one
/// from another sign-in counts nothing.
pub(super) async fn note_hy2_outcome(
    state: &Arc<TonoState>,
    preferred: Option<&str>,
    dialed: &str,
    owner: (u64, u64),
    outcome: &super::Attempt,
) {
    let Some(preferred) = preferred else {
        return;
    };
    let mut inner = state.lock().await;
    let attempt_generation = match outcome {
        super::Attempt::Connected => owner.1,
        super::Attempt::Failed { generation, .. } => *generation,
        super::Attempt::GuardRejected(_) | super::Attempt::Stale => return,
    };
    if inner.sign_in_generation != owner.0 || inner.connect_generation != attempt_generation {
        return;
    }
    let now = now_ms();
    let changed = match outcome {
        super::Attempt::Failed { error, .. } => {
            inner.hy2_switch.note_failure(preferred, dialed, error, now)
        }
        _ => inner.hy2_switch.note_connected(preferred, dialed, now),
    };
    if changed {
        persist_hy2_choices(&inner);
    }
}

/// A17: right before the tunnel starts, re-check an automatic hy2 hop against
/// the live grant and the current catalog. `Ok(None)`: not an automatic hop,
/// or still permitted. `Ok(Some(reality))`: withdrawn; dial the selected
/// Reality block instead (recorded as the admitted exit under the lock).
/// `Err`: withdrawn and the Reality block is gone too.
pub(super) async fn recheck_auto_hop(
    state: &Arc<TonoState>,
    preferred: Option<&str>,
    node: &ValidatedNode,
) -> Result<Option<ValidatedNode>, String> {
    let Some(preferred) = preferred else {
        return Ok(None);
    };
    if tono_core::is_hy2_catalog_name(preferred)
        || tono_core::catalog_base_name(&node.name) != preferred
        || !node.is_hysteria2()
    {
        return Ok(None);
    }
    let mut inner = state.lock().await;
    if inner.hy2_switch.auto_hop_permitted(preferred, node, &inner.nodes) {
        return Ok(None);
    }
    let reality = inner
        .nodes
        .iter()
        .find(|candidate| candidate.name == preferred && !candidate.is_hysteria2())
        .cloned()
        .ok_or_else(|| "the selected server is not in the catalog".to_string())?;
    inner.hy2_switch.note_admitted(&reality);
    logging!(
        info,
        Type::Service,
        "Tono: hy2 auto-switch withdrawn before the tunnel started; dialing the selected Reality block"
    );
    Ok(Some(reality))
}

/// A17: apply `hy2AutoSwitch` from a catalog 200 (installed or unchanged).
pub(crate) fn note_hy2_catalog(inner: &mut TonoInner, permitted: bool) {
    if inner.hy2_switch.on_catalog(permitted, &inner.nodes) {
        persist_hy2_choices(inner);
    }
}

/// A17: the user picked either block of `name` by hand. That node starts
/// from its Reality block again with no remembered hy2 choice.
pub(crate) fn note_manual_selection(inner: &mut TonoInner, name: &str) {
    if inner.hy2_switch.forget_node(name) {
        persist_hy2_choices(inner);
    }
}

/// Load the remembered choices that belong with the restored catalog cache.
/// The permission itself is not restored: it waits for a live catalog 200.
pub(crate) fn restore_hy2_choices(inner: &mut TonoInner) {
    let path = inner.catalog_dir.join(tono_core::hy2_switch::STATE_FILE_NAME);
    let Ok(file) = std::fs::File::open(&path) else {
        return;
    };
    let mut body = String::new();
    let limit = tono_core::hy2_switch::MAX_STATE_FILE_BYTES;
    if std::io::Read::read_to_string(&mut std::io::Read::take(file, limit + 1), &mut body).is_err()
        || body.len() as u64 > limit
    {
        return;
    }
    if let Ok(persisted) = serde_json::from_str(&body) {
        inner.hy2_switch.restore(persisted, now_ms());
    }
}

/// Sign-out or another account: the remembered choices go with its catalog.
pub(crate) fn forget_hy2_choices(inner: &mut TonoInner) {
    inner.hy2_switch = Default::default();
    let path = inner.catalog_dir.join(tono_core::hy2_switch::STATE_FILE_NAME);
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => logging!(
            warn,
            Type::Service,
            "Tono: could not delete the hy2 auto-switch choices: {error}"
        ),
    }
}

fn persist_hy2_choices(inner: &TonoInner) {
    let path = inner.catalog_dir.join(tono_core::hy2_switch::STATE_FILE_NAME);
    let result = match serde_json::to_vec(&inner.hy2_switch.snapshot()) {
        Ok(body) => crate::tono::state::write_private_file(&path, &body).map_err(|error| format!("{error:#}")),
        Err(error) => Err(error.to_string()),
    };
    if let Err(error) = result {
        logging!(
            warn,
            Type::Service,
            "Tono: could not save the hy2 auto-switch choices: {error}"
        );
    }
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
    let nodes = candidates(&inner.nodes, &inner.heal);
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

/// The healer never hops onto a hy2 block by itself: that is the A17 switch,
/// gated by the control plane. A hy2 row stays a candidate only when it is
/// the user's own selection or the current dial, so a manual hy2 choice can
/// still fall back to TCP as before.
fn candidates(nodes: &[ValidatedNode], session: &heal::Session) -> Vec<Candidate> {
    nodes
        .iter()
        .filter(|node| {
            !node.is_hysteria2() || node.name == session.preferred || node.name == session.dial
        })
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
