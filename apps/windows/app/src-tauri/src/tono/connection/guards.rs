//! §6.1 connect guards.

use super::*;

/// §6.1 guards: forced values live in the owned runtime; here we check the
/// account is ready (H2a — the reconnect path's only account gate), the
/// catalog is usable, the selection exists and passed admission, and no
/// transaction is in flight. The only write is the in-memory heal dial, and
/// only while protection is down.
pub(super) async fn guard_snapshot(
    state: &Arc<TonoState>,
) -> Result<(ValidatedNode, Vec<ValidatedNode>, Option<tono_core::CatalogRouting>, u64, CancellationToken, Option<String>), String> {
    if state.release_in_progress().await {
        return Err(format!(
            "{RELEASE_RECONCILING_PREFIX}: network protection release is still reconciling; wait before reconnecting"
        ));
    }
    let mut inner = state.lock().await;
    if inner.account_close.is_some() {
        return Err("account sign-out is still reconciling".to_string());
    }
    match &inner.account_state {
        AccountState::Ready => {}
        AccountState::Suspended => return Err("account is suspended".to_string()),
        _ => return Err("not signed in".to_string()),
    }
    // #582: a server refusal blocks Connect (and reconnect) before the UI catches up.
    if let Some(refusal) = crate::tono::offline_grant::connect_refusal(&inner) {
        return Err(refusal.to_string());
    }
    let status = inner.fsm.status();
    if status.is_connecting || status.is_connected || status.is_disconnecting {
        return Err(TRANSITION_IN_FLIGHT_REJECTION.to_string());
    }
    if inner.catalog_requires_choice {
        return Err("the selected node left the catalog; pick a server again".to_string());
    }
    if inner.nodes.is_empty() {
        return Err(CATALOG_NOT_READY_REJECTION.to_string());
    }
    heal::prepare(&mut inner);
    let selected = heal::dial_name(&inner);
    if selected.is_empty() {
        return Err("select a server first".to_string());
    }
    let node = inner
        .nodes
        .iter()
        .find(|node| node.name == selected)
        .cloned()
        .ok_or_else(|| "the selected server is not in the catalog".to_string())?;
    Ok((
        node,
        inner.nodes.clone(),
        inner.routing.clone(),
        inner.connect_generation,
        inner.connect_cancellation.clone(),
        inner.selected_node.clone(),
    ))
}
