//! Selected-exit switch and vanish. Generation bump stays with the parent connect owner.

use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tono_core::EXIT_GROUP_NAME;
use tono_logging::{Type, logging};
use tono_plugin_core::{MihomoExt as _, models::Protocol};
use crate::core::service;
use crate::process::AsyncHandler;
use crate::tono::{
    audit::AuditEvent, catalog_sync, commands, connection_plan::guard_rejection_is_transient, state::TonoState,
};
use super::{
    Attempt, BoxedTask, SampledConnections, attempt, fail_connect, seed_autostart_after_connect,
};
use super::controller::{controller_client, controller_url, select_exit_group};
use super::endpoints::{proxy_endpoints_for, unique_proxy_endpoints};
use super::reconnect::schedule_reconnect;

/// §3: the selected node vanished from a new catalog while a tunnel was up —
/// stop the core, keep the kill switch armed, and wait for the user to pick
/// a surviving node (no auto-reconnect).
pub async fn selected_node_vanished(state: Arc<TonoState>, app: AppHandle) {
    let generation = {
        let mut inner = state.lock().await;
        let active = inner.fsm.status().is_connected || inner.fsm.status().is_connecting;
        // M2: only touch the generation, the intent bit, and the tasks when
        // a teardown actually follows — an idle catalog shrink must not
        // stomp a releaser's intent.
        if active {
            // The teardown keeps blocking, so a stale attempt must not
            // release the barrier (H-1 intent).
            inner.invalidate_connection(false);
        }
        active.then_some(inner.connect_generation)
    };
    let Some(generation) = generation else {
        return;
    };
    logging!(warn, Type::Service, "Tono: 选中节点从新目录中消失，停止核心但保持封锁");
    let _ = service::tono_stop_core(false).await;
    let _ = service::tono_restrict_bootstrap().await;

    let mut inner = state.lock().await;
    // Two IPCs ran with the lock released. If a disconnect / sign-out / quit took ownership in
    // that window, its FSM state is the truth and must not be overwritten here: the
    // `connect_failed()` below runs the failure decision table, and for an armed-but-unverified
    // session — exactly what a *failed* release leaves behind — it resolves to FullRelease and
    // calls `release()`, clearing `kill_switch_armed` and showing NotConnected over a barrier
    // that is still blocking. `quit_release` would then compute `protected == false` and skip
    // the release entirely. Leaving `stay_armed_after_failed_release`'s state alone is the same
    // "keep the real armed state visible" treatment.
    if inner.connect_generation != generation {
        logging!(
            info,
            Type::Service,
            "Tono: 目录消失清理已被更新的连接代际取代，保留其可见状态"
        );
        return;
    }
    inner.controller_secret = None;
    inner.controller_port = None;
    let vanished_node = inner.selected_node.clone();
    if inner.fsm.status().is_connected {
        inner.fsm.tunnel_died();
    } else {
        // `initial_release_failed`, not `connect_failed`: this teardown deliberately keeps
        // blocking (stop_core(false) + restrict_bootstrap), but for an attempt that armed and
        // has not yet been verified the decision table resolves `connect_failed` to a full
        // release, which clears the armed latch while the Service is still blocking. The UI
        // would then read notConnected over a live barrier, and Disconnect / Sign out / Quit
        // would each compute "nothing to release" and skip it — a silent total blackout that
        // survives app exit.
        inner.fsm.initial_release_failed();
    }
    commands::emit_status(&app, &commands::status_of(&inner));
    drop(inner);
    if let Some(node) = vanished_node {
        state.audit().log(AuditEvent::SelectionVanished { node });
    }
    state.audit().log(AuditEvent::ProtectedOffline {
        reason: "catalogSelectionVanished",
    });
}

/// Connected node switch: keep the core and WinTUN, widen WFP to old ∪ new,
/// move the Mihomo selector, prove the new exit, then drop leftover sockets
/// on the previous destination and shrink WFP to new-only.
///
/// `generation` is the connect generation the switch was spawned under; a
/// newer bump (another switch, disconnect, sign-out) retires it silently.
/// Put the selection back and tell the UI about it.
///
/// `tono_select_server` writes `selected_node` and emits before this task even
/// starts, so every branch below that gives up on the switch has to undo that
/// claim. Without it the node card, the tray, and the dashboard all showed the
/// exit the user picked while every byte still left through the old one — and
/// nothing ever corrected it, because the stored selection was the new name.
pub(super) async fn restore_selected_node(
    state: &Arc<TonoState>,
    app: &AppHandle,
    generation: u64,
    previous_name: &str,
) {
    if previous_name.is_empty() {
        return;
    }
    let mut inner = state.lock().await;
    // A newer operation owns the state; it will publish its own selection.
    if inner.connect_generation != generation {
        return;
    }
    if inner.selected_node.as_deref() == Some(previous_name) {
        return;
    }
    inner.selected_node = Some(previous_name.to_string());
    let status = commands::status_of(&inner);
    drop(inner);
    commands::emit_status(app, &status);
}

pub async fn switch_selected_node(
    state: Arc<TonoState>,
    app: AppHandle,
    generation: u64,
    previous_name: String,
    next_name: String,
) {
    let snapshot = {
        let inner = state.lock().await;
        if inner.connect_generation != generation {
            return;
        }
        if !inner.fsm.status().is_connected {
            // A connect already in flight is dialling the previous exit, but
            // the caller has published the new name — the UI would show a node
            // the attempt is not using. When fully disconnected the new name is
            // simply the choice for the next connect, so leave it alone.
            let connecting = inner.fsm.status().is_connecting;
            drop(inner);
            if connecting {
                restore_selected_node(&state, &app, generation, &previous_name).await;
            }
            return;
        }
        let previous = inner
            .applied_nodes
            .iter()
            .find(|node| node.name == previous_name)
            .cloned();
        let next = inner.nodes.iter().find(|node| node.name == next_name).cloned();
        let transport = inner.applied_exit_transport;
        let target_loaded = next.as_ref().zip(transport).is_some_and(|(next, transport)|
            inner.applied_nodes.iter().any(|loaded| loaded.same_transport_endpoint(next, transport)));
        let secret = inner.controller_secret.clone();
        let port = inner.controller_port;
        (previous, next, transport, target_loaded, secret, port)
    };
    let (previous, next, transport, target_loaded, secret, port) = snapshot;
    let Some(next) = next else {
        restore_selected_node(&state, &app, generation, &previous_name).await;
        return;
    };
    if !target_loaded {
        // A downloaded descriptor is not yet in the live selector graph.
        // Reuse the existing protected replacement instead of granting its UDP
        // tuple while the Core still dials old TCP/credentials.
        cold_switch_selected_node(state, app, generation).await;
        return;
    }
    let Some(transport) = transport else {
        cold_switch_selected_node(state, app, generation).await;
        return;
    };
    let old_endpoints = previous.as_ref().map(|node| proxy_endpoints_for(node, transport))
        .transpose();
    let (Ok(Some(old_endpoints)), Ok(new_endpoints)) = (old_endpoints, proxy_endpoints_for(&next, transport)) else {
        restore_selected_node(&state, &app, generation, &previous_name).await;
        return;
    };
    let union = unique_proxy_endpoints([&old_endpoints[..], &new_endpoints[..]].concat());
    if union.is_empty() {
        restore_selected_node(&state, &app, generation, &previous_name).await;
        return;
    }

    let session = match service::active_service_session() {
        Ok(session) => session,
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "Tono: hot switch missing Service session ({error:#}); falling back to cold switch"
            );
            cold_switch_selected_node(state, app, generation).await;
            return;
        }
    };
    if let Err(error) = service::tono_replace_proxy_endpoints(&session, union).await {
        logging!(
            warn,
            Type::Service,
            "Tono: hot switch could not widen WFP ({error:#}); falling back to cold switch"
        );
        cold_switch_selected_node(state, app, generation).await;
        return;
    }
    if state.lock().await.connect_generation != generation {
        return;
    }

    let Some((secret, port)) = secret.zip(port) else {
        if state.lock().await.connect_generation != generation {
            return;
        }
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        cold_switch_selected_node(state, app, generation).await;
        return;
    };
    if let Err(error) = select_exit_group(&secret, port, &next_name).await {
        logging!(warn, Type::Service, "Tono: selector switch failed: {error}");
        if state.lock().await.connect_generation != generation {
            return;
        }
        if previous_name.is_empty() {
            cold_switch_selected_node(state, app, generation).await;
            return;
        }
        match select_exit_group(&secret, port, &previous_name).await {
            Ok(()) => {
                if state.lock().await.connect_generation != generation { return; }
                let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
                restore_selected_node(&state, &app, generation, &previous_name).await;
            }
            Err(rollback) => {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: selector rollback unconfirmed ({rollback}); falling back to cold switch"
                );
                cold_switch_selected_node(state, app, generation).await;
            }
        }
        return;
    }
    if state.lock().await.connect_generation != generation {
        // A newer connect/disconnect/switch owns the machine. Do not roll the
        // selector or WFP back to this task's previous node.
        return;
    }

    close_connections_bound_to(&state, generation, &previous_name).await;
    if state.lock().await.connect_generation != generation { return; }
    if let Err(error) = service::tono_replace_proxy_endpoints(&session, new_endpoints).await {
        logging!(
            warn,
            Type::Service,
            "Tono: could not shrink WFP to the new exit ({error:#}); leaving old∪new permits"
        );
    }
    let mut inner = state.lock().await;
    if inner.connect_generation == generation && inner.fsm.status().is_connected {
        inner.last_admitted_node = Some(next_name);
        inner.last_exit_delay_ms = None;
        inner.last_exit_delay_at_ms = None;
        inner.last_exit_delay_node = None;
        inner.exit_ip = None;
        inner.exit_org = None;
        inner.exit_location = None;
        commands::emit_status(&app, &commands::status_of(&inner));
    }
}

pub(super) async fn cold_switch_selected_node(state: Arc<TonoState>, app: AppHandle, generation: u64) {
    {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            return;
        }
        if !inner.fsm.status().is_connected && !inner.fsm.status().is_connecting {
            return;
        }
        inner.controller_secret = None;
        inner.controller_port = None;
        if inner.fsm.status().is_connected {
            inner.fsm.tunnel_died();
        } else {
            inner.fsm.initial_release_failed();
        }
        commands::emit_status(&app, &commands::status_of(&inner));
    }
    let _ = service::tono_stop_core(false).await;
    if state.lock().await.connect_generation != generation {
        return;
    }
    match attempt(&state, &app).await {
        Attempt::Failed { error, generation } => {
            if fail_connect(&state, &app, error, generation).await.is_some() {
                schedule_reconnect(&state, &app).await;
            }
        }
        Attempt::GuardRejected(reason) if guard_rejection_is_transient(&reason) => {
            logging!(info, Type::Service, "Tono: 节点切换被暂态守卫拒绝，稍后重试: {reason}");
            schedule_reconnect(&state, &app).await;
        }
        Attempt::Connected => seed_autostart_after_connect(),
        Attempt::GuardRejected(_) | Attempt::Stale => {}
    }
}

pub(super) async fn close_connections_bound_to(state: &Arc<TonoState>, generation: u64, exit_name: &str) {
    if exit_name.is_empty() {
        return;
    }
    let (secret, port) = {
        let inner = state.lock().await;
        if inner.connect_generation != generation {
            return;
        }
        match inner.controller_secret.clone().zip(inner.controller_port) {
            Some(pair) => pair,
            None => return,
        }
    };
    let Ok(client) = controller_client(Duration::from_secs(2)) else {
        return;
    };
    let Ok(response) = client
        .get(controller_url(port, "/connections"))
        .bearer_auth(&secret)
        .send()
        .await
    else {
        return;
    };
    let Ok(payload) = response.json::<SampledConnections>().await else {
        return;
    };
    let ids: Vec<_> = payload.connections.into_iter()
        .filter(|connection| connection.chains.iter().any(|hop| hop.eq_ignore_ascii_case(exit_name)))
        .map(|connection| connection.id).filter(|id| !id.is_empty()).collect();
    close_in_batches(&ids,
        || async { state.lock().await.connect_generation == generation },
        |id| {
            let client = &client;
            let secret = &secret;
            async move {
                let Ok(mut url) = reqwest::Url::parse(&controller_url(port, "/connections")) else { return; };
                let Ok(mut path) = url.path_segments_mut() else { return; };
                path.push(id);
                drop(path);
                let _ = client.delete(url).bearer_auth(secret).send().await;
            }
        },
    ).await;
}

const CLOSE_CONNECTION_CONCURRENCY: usize = 4;

/// Batches bound in-flight mutations and re-check ownership before scheduling more.
/// Dropping the caller cancels its HTTP futures; no detached global close survives it.
async fn close_in_batches<'a, Check, CF, Close, F>(ids: &'a [String], mut current: Check, mut close: Close)
where Check: FnMut() -> CF, CF: std::future::Future<Output = bool>,
      Close: FnMut(&'a str) -> F, F: std::future::Future<Output = ()>,
{
    for batch in ids.chunks(CLOSE_CONNECTION_CONCURRENCY) {
        if !current().await { return; }
        futures::future::join_all(batch.iter().map(|id| close(id))).await;
    }
}

#[cfg(test)]
mod close_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[tokio::test]
    async fn closes_are_parallel_bounded_and_stop_at_generation_boundary() {
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let done = AtomicUsize::new(0);
        let ids: Vec<_> = (0..10).map(|n| n.to_string()).collect();
        close_in_batches(&ids, || async { done.load(Ordering::SeqCst) < 4 }, |_| async {
            let count = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(count, Ordering::SeqCst);
            tokio::task::yield_now().await;
            active.fetch_sub(1, Ordering::SeqCst);
            done.fetch_add(1, Ordering::SeqCst);
        }).await;
        assert_eq!(peak.load(Ordering::SeqCst), CLOSE_CONNECTION_CONCURRENCY);
        assert_eq!(done.load(Ordering::SeqCst), 4);
    }
}
