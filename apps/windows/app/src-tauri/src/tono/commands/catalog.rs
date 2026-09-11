//! Domain Tauri commands. Wire names stay unchanged.

use std::{net::SocketAddr, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager as _};
use tono_logging::{Type, logging};
use tono_core::{
    auth::{ApiError, DEFAULT_DEVICE_LIMIT, User, normalize_installation_id},
    connection::{ConnectStage, UiState},
    credentials::{CredentialKey, CredentialStore as _},
};
use crate::{
    core::service,
    process::AsyncHandler,
    tono::{
        audit::AuditEvent,
        catalog_sync, connection,
        credentials::TonoCredentialStore,
        state::{AccountState, TonoInner, TonoState},
    },
};
use super::*;

/// Servers from the validated catalog, US/JP first, with the selection flag.
#[tauri::command]
pub async fn tono_servers(state: tauri::State<'_, Arc<TonoState>>) -> Result<Vec<TonoServer>, String> {
    let inner = state.lock().await;
    let order = catalog_sync::sort_server_names(&inner.nodes);
    Ok(order
        .into_iter()
        .filter_map(|name| {
            inner
                .nodes
                .iter()
                .find(|node| node.name == name)
                .map(|node| TonoServer {
                    name: node.name.clone(),
                    server: node.server.to_string(),
                    port: node.port,
                    selected: inner.selected_node.as_deref() == Some(node.name.as_str()),
                    available: !catalog_sync::is_exit_blocked(&node.name),
                })
        })
        .collect())
}

fn catalog_status_of(inner: &TonoInner) -> TonoCatalogStatus {
    let revision = inner.catalog_tracker.current_revision();
    TonoCatalogStatus {
        revision: (revision >= 0).then_some(revision),
        node_count: inner.nodes.len(),
        last_synced_at_ms: inner.catalog_last_synced_at_ms,
        error: inner.catalog_sync_error.clone(),
    }
}

#[tauri::command]
pub async fn tono_catalog_status(state: tauri::State<'_, Arc<TonoState>>) -> Result<TonoCatalogStatus, String> {
    let inner = state.lock().await;
    Ok(catalog_status_of(&inner))
}

/// User-initiated account-scoped refresh. This deliberately reuses catalog_sync's verified
/// fetch/install path; the command cannot install unverified bytes or bypass rollback checks.
#[tauri::command]
pub async fn tono_refresh_catalog(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<TonoCatalogStatus, String> {
    let generation = {
        let inner = state.lock().await;
        if !matches!(inner.account_state, AccountState::Ready) {
            return Err("sign in before refreshing cloud servers".to_string());
        }
        inner.sign_in_generation
    };
    let result = catalog_sync::sync_with_retries_for_auth_generation(state.inner(), &app, generation).await;
    let inner = state.lock().await;
    if inner.sign_in_generation != generation {
        return Err("catalog refresh was superseded by an account change".to_string());
    }
    result?;
    Ok(catalog_status_of(&inner))
}

pub(super) async fn test_server_endpoint(
    name: String,
    address: SocketAddr,
    cancellation: tokio_util::sync::CancellationToken,
) -> TonoServerTestResult {
    let started = std::time::Instant::now();
    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err("cancelled".to_string()),
        result = tokio::time::timeout(SERVER_TEST_TIMEOUT, tokio::net::TcpStream::connect(address)) => {
            match result {
                Ok(Ok(stream)) => {
                    drop(stream);
                    Ok(started.elapsed().as_millis().max(1).min(u64::MAX as u128) as u64)
                }
                Ok(Err(error)) => Err(error.to_string()),
                Err(_) => Err("timeout".to_string()),
            }
        }
    };
    match result {
        Ok(latency_ms) => TonoServerTestResult {
            name,
            latency_ms: Some(latency_ms),
            error: None,
        },
        Err(error) => TonoServerTestResult {
            name,
            latency_ms: None,
            error: Some(error),
        },
    }
}

/// Measure each usable catalog endpoint without selecting it. This is allowed only while fully
/// disconnected and unarmed: connected WFP intentionally permits only the selected endpoint,
/// and widening that permit for a UI test would weaken the connection safety contract.
#[tauri::command]
pub async fn tono_test_available_servers(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<Vec<TonoServerTestResult>, String> {
    let (generation, auth_generation, catalog_revision, cancellation, nodes) = {
        let mut inner = state.lock().await;
        if !matches!(inner.account_state, AccountState::Ready) {
            return Err("sign in before testing servers".to_string());
        }
        if inner.exit_transport == tono_core::node::ExitTransport::Hysteria2Udp {
            return Err("TCP server tests do not measure UDP; connect and test the current server instead".to_string());
        }
        if inner.fsm.status().is_connected || inner.fsm.status().is_connecting || inner.fsm.kill_switch_armed() {
            return Err("disconnect before testing all servers".to_string());
        }
        if inner.server_test_cancellation.is_some() {
            return Err("a server test is already running".to_string());
        }
        let nodes = inner
            .nodes
            .iter()
            .filter(|node| !catalog_sync::is_exit_blocked(&node.name))
            .map(|node| (node.name.clone(), SocketAddr::new(node.server.into(), node.port)))
            .collect::<Vec<_>>();
        inner.server_test_generation = inner.server_test_generation.wrapping_add(1);
        let generation = inner.server_test_generation;
        let cancellation = tokio_util::sync::CancellationToken::new();
        inner.server_test_cancellation = Some(cancellation.clone());
        (
            generation,
            inner.sign_in_generation,
            inner.catalog_tracker.current_revision(),
            cancellation,
            nodes,
        )
    };

    let mut results = stream::iter(nodes)
        .map(|(name, address)| test_server_endpoint(name, address, cancellation.clone()))
        .buffer_unordered(SERVER_TEST_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
    results.sort_by(|left, right| left.name.cmp(&right.name));

    let mut inner = state.lock().await;
    let owns_slot = inner.server_test_generation == generation;
    let stale = cancellation.is_cancelled()
        || !owns_slot
        || inner.sign_in_generation != auth_generation
        || inner.catalog_tracker.current_revision() != catalog_revision;
    if owns_slot {
        inner.server_test_cancellation = None;
    }
    if stale {
        return Err("server test cancelled or superseded".to_string());
    }
    if let Some(selected) = inner.selected_node.clone() {
        if let Some(result) = results.iter().find(|result| result.name == selected) {
            if let Some(latency_ms) = result.latency_ms {
                inner.record_tcp_delay(&selected, latency_ms);
                emit_status(&app, &status_of(&inner));
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub async fn tono_cancel_server_tests(state: tauri::State<'_, Arc<TonoState>>) -> Result<(), String> {
    let mut inner = state.lock().await;
    inner.cancel_server_tests();
    Ok(())
}

/// Select a server. Persists the choice (L4). What happens next is decided
/// by `connection::select_action` (H1): a same-node reselect with no
/// pending choice is a pure no-op; a real change while a tunnel is up
/// derives the §6 node switch as a registered task; a fresh pick in armed
/// Protected Offline (including after a catalog choice loss, M5) schedules
/// the protected reconnect. Generation, tasks, and the H-1 intent bit are
/// touched only when a transaction actually derives (M2).
#[tauri::command]
pub async fn tono_select_server(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
    name: String,
) -> Result<(), String> {
    let action = {
        let mut inner = state.lock().await;
        if !inner.nodes.iter().any(|node| node.name == name) {
            return Err("unknown server".to_string());
        }
        if !inner.nodes.iter().any(|node| node.name == name && node.supports_transport(inner.exit_transport)) {
            return Err(tono_core::NodeRejection::TransportUnavailable.to_string());
        }
        if catalog_sync::is_exit_blocked(&name) {
            return Err("this server is currently unavailable (network blocked)".to_string());
        }
        let previous = inner.selected_node.clone();
        let changed = previous.as_deref() != Some(name.as_str());
        let cleared_choice = inner.catalog_requires_choice;
        let action = connection::select_action(
            changed,
            cleared_choice,
            inner.fsm.status(),
            inner.fsm.kill_switch_armed(),
        );
        if action == connection::SelectAction::Noop {
            return Ok(());
        }
        if action == connection::SelectAction::Switch {
            if inner
                .tasks
                .switch
                .as_ref()
                .is_some_and(|task| !task.inner().is_finished())
            {
                // A hot switch mutates the selector and WFP across several
                // awaits. Replacing its JoinHandle only detaches it; it does not
                // cancel it, so two rapid choices could roll each other back and
                // leave the UI, selector, and permitted endpoints disagreeing.
                // Refuse before publishing or persisting the second choice. The
                // first task remains the sole owner and the user can retry as
                // soon as it settles.
                return Err("a server switch is already in progress".to_string());
            }
            inner.tasks.switch.take();
        }
        inner.selected_node = Some(name.clone());
        // A fresh user choice re-arms auto-reconnect (§3).
        inner.catalog_requires_choice = false;
        if action == connection::SelectAction::Reconnect {
            // The reconnect re-arms rather than releases (H-1 intent).
            inner.invalidate_connection(false);
            // Picking a city is the same evidence "Retry now" carries: someone is at the
            // machine and has just chosen a different exit. A spent ladder left
            // `schedule_reconnect` below with no rung to hand out, so it logged and returned
            // while this command still persisted the selection and reported success — the UI
            // confirmed a switch nothing had attempted. The unattended `reconnect_loop` is
            // bounded by the budget it consumes, not by this reset.
            inner.fsm.reset_reconnect_backoff();
        }
        let generation = inner.connect_generation;
        if let Err(err) = crate::tono::state::save_selection(&inner.catalog_dir, &name) {
            logging!(warn, Type::Service, "Tono: 选中节点持久化失败: {err}");
        }
        emit_status(&app, &status_of(&inner));
        // Spawned *and* registered under one guard. Registering after `drop(inner)` left a
        // window in which a concurrent `disconnect()` ran `abort_connection_tasks()` against an
        // empty switch slot and this line then installed a task nothing could abort — a node
        // switch surviving the disconnect that was supposed to cancel it, re-arming WFP behind
        // a completed release. The task's first act is to lock this same mutex, so it cannot
        // make progress before the guard is dropped below.
        if action == connection::SelectAction::Switch {
            let task_state = state.inner().clone();
            let task_app = app.clone();
            let from = previous.clone().unwrap_or_default();
            let to = name.clone();
            inner.tasks.switch = Some(AsyncHandler::spawn(move || async move {
                connection::switch_selected_node(task_state, task_app, generation, from, to).await;
            }));
        }
        drop(inner);
        if cleared_choice {
            state.audit().log(AuditEvent::RequiresChoiceCleared);
        }
        if action == connection::SelectAction::Switch
            && let Some(from) = previous
        {
            state.audit().log(AuditEvent::NodeSwitch { from, to: name.clone() });
        }
        action
    };

    match action {
        // Already spawned and registered above, under the guard.
        connection::SelectAction::Switch => {}
        connection::SelectAction::Reconnect => {
            connection::schedule_reconnect(&state, &app).await;
        }
        connection::SelectAction::Noop | connection::SelectAction::UpdateOnly => {}
    }
    Ok(())
}

/// Execute a fresh controller delay probe through the selected exit. This is intentionally
/// available only while Connected; cached legacy delay history is not presented as a new test.
#[tauri::command]
pub async fn tono_test_current_server(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<u64, String> {
    connection::test_current_server(state.inner(), &app).await
}
