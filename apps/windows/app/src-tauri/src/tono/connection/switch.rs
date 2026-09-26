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
    Attempt, BoxedTask, attempt_for_generation, fail_connect, seed_autostart_after_connect,
};
use super::controller::{controller_client, controller_url, fetch_connections, select_exit_group};
use super::endpoints::{proxy_endpoints_for, unique_proxy_endpoints};
use super::probes::verify_tun_data_plane;
use super::reconnect::schedule_reconnect_for_generation;

/// §3: the selected node vanished from a new catalog while a tunnel was up —
/// stop the core, keep the kill switch armed, and wait for the user to pick
/// a surviving node (no auto-reconnect).
pub async fn selected_node_vanished(state: Arc<TonoState>, app: AppHandle, expected_generation: u64) {
    let guard_state = Arc::clone(&state);
    let result = tono_core::recovery::reconcile_recovery(
        async move { guard_state.begin_privileged_release().await },
        async move {
            let generation = {
                let mut inner = state.lock().await;
                let active = inner.fsm.status().is_connected || inner.fsm.status().is_connecting;
                // A queued catalog decision cannot adopt a replacement runtime or undo
                // a newer user selection. Idle shrink must not stomp a releaser's intent.
                if inner.connect_generation != expected_generation || !inner.catalog_requires_choice || !active {
                    return false;
                }
                // Retire connection tasks without permitting them to release the barrier.
                inner.invalidate_connection(false);
                // Withdraw Connected before IPC so a new choice cannot hot-switch a
                // runtime being stopped. A retry must enter normal guarded startup.
                if inner.fsm.status().is_connected {
                    inner.fsm.tunnel_died();
                } else {
                    // Keep the armed latch for an unverified attempt; connect_failed
                    // could clear it while the Service still blocks traffic.
                    inner.fsm.initial_release_failed();
                }
                commands::emit_status(&app, &commands::status_of(&inner));
                // R2-F2: the unverified arm this leaves behind idles in Protected Offline
                // until the user picks a node — it must keep its Service-truth poll.
                super::monitor::ensure_protection_resync_locked(&mut inner, || {
                    super::monitor::spawn_protection_resync(&state, &app)
                });
                inner.connect_generation
            };
            logging!(warn, Type::Service, "Tono: 选中节点从新目录中消失，停止核心但保持封锁");
            // Stop(false) restricts WFP under the Service lifecycle lock. Keep exclusive
            // ownership through bookkeeping even if the account-scoped caller is aborted.
            if let Err(error) = service::tono_stop_core(false).await {
                logging!(warn, Type::Service, "Tono: catalog teardown requires reconciliation: {error:#}");
            }

            let mut inner = state.lock().await;
            // Disconnect may have retired us while waiting for the exclusive guard.
            // Its FSM state is authoritative, including an armed failed-release state.
            if inner.connect_generation != generation {
                return true;
            }
            inner.controller_secret = None;
            inner.controller_port = None;
            let vanished_node = inner.selected_node.clone();
            commands::emit_status(&app, &commands::status_of(&inner));
            drop(inner);
            if let Some(node) = vanished_node {
                state.audit().log(AuditEvent::SelectionVanished { node });
            }
            state.audit().log(AuditEvent::ProtectedOffline {
                reason: "catalogSelectionVanished",
            });
            true
        },
    ).await;
    if let Err(error) = result {
        logging!(error, Type::Service, "Tono: catalog teardown worker failed; keeping protection: {error}");
    }
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
    let catalog_dir = inner.catalog_dir.clone();
    if let Err(error) = restore_selection_value(&mut inner.selected_node, &catalog_dir, previous_name) {
        logging!(warn, Type::Service, "Tono: could not persist rolled-back selection: {error:#}");
    }
    // Under the lock, like every status publisher (H16-C-F3).
    commands::emit_status(app, &commands::status_of(&inner));
}

fn restore_selection_value(
    selected: &mut Option<String>,
    catalog_dir: &std::path::Path,
    previous_name: &str,
) -> anyhow::Result<()> {
    *selected = Some(previous_name.to_string());
    // The selection command persisted the requested node before dispatch. A proved rollback
    // must restore that file too, or next launch silently retries the rejected new node.
    crate::tono::state::save_selection(catalog_dir, previous_name)
}

pub async fn switch_selected_node(
    state: Arc<TonoState>,
    app: AppHandle,
    generation: u64,
    previous_name: String,
    next_name: String,
) {
    // The catalog owner keeps this worker detached and holds the policy writer. Own the Core
    // exclusively too, before reading its session: a retired switch must never adopt B's proof.
    let guard = state.begin_privileged_release().await;
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
            .nodes
            .iter()
            .find(|node| node.name == previous_name)
            .cloned();
        let next = inner.nodes.iter().find(|node| node.name == next_name).cloned();
        let routing = inner.routing.clone();
        let nodes = inner.nodes.clone();
        let secret = inner.controller_secret.clone();
        let port = inner.controller_port;
        (previous, next, routing, nodes, secret, port)
    };
    let (previous, next, routing, nodes, secret, port) = snapshot;
    let Some(next) = next else {
        restore_selected_node(&state, &app, generation, &previous_name).await;
        return;
    };
    let old_endpoints = previous
        .as_ref()
        .map(|node| proxy_endpoints_for(node, &nodes, routing.as_ref()))
        .unwrap_or_default();
    let new_endpoints = proxy_endpoints_for(&next, &nodes, routing.as_ref());
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
            cold_switch_selected_node(state, app, generation, guard).await;
            return;
        }
    };
    if let Err(error) = service::tono_replace_proxy_endpoints(&session, union).await {
        logging!(
            warn,
            Type::Service,
            "Tono: hot switch could not widen WFP ({error:#}); falling back to cold switch"
        );
        cold_switch_selected_node(state, app, generation, guard).await;
        return;
    }
    if state.lock().await.connect_generation != generation {
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        return;
    }

    let Some((secret, port)) = secret.zip(port) else {
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        cold_switch_selected_node(state, app, generation, guard).await;
        return;
    };
    if let Err(error) = select_exit_group(&secret, port, &next_name).await {
        logging!(
            warn,
            Type::Service,
            "Tono: selector switch failed ({error}); falling back to cold switch"
        );
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        // Keep the user's new selection. A catalog-grown node is missing from the live
        // controller; rebuilding the runtime with WFP still armed is the only way to admit it.
        cold_switch_selected_node(state, app, generation, guard).await;
        return;
    }
    if state.lock().await.connect_generation != generation {
        let _ = select_exit_group(&secret, port, &previous_name).await;
        let _ = service::tono_replace_proxy_endpoints(&session, old_endpoints).await;
        return;
    }

    if let Err(error) = verify_tun_data_plane().await {
        logging!(
            warn,
            Type::Service,
            "Tono: new exit failed protected probe ({error}); rolling back"
        );
        // A working probe alone cannot prove rollback: the selector and exact old-only
        // permissions must both have committed. Preserve the requested choice if either fails.
        let rollback = async {
            if previous_name.is_empty() {
                anyhow::bail!("previous exit is unavailable for rollback");
            }
            anyhow::ensure!(state.lock().await.connect_generation == generation, "switch retired");
            select_exit_group(&secret, port, &previous_name).await.map_err(anyhow::Error::msg)?;
            verify_tun_data_plane().await.map_err(anyhow::Error::msg)?;
            anyhow::ensure!(state.lock().await.connect_generation == generation, "switch retired");
            service::tono_replace_proxy_endpoints(&session, old_endpoints.clone()).await?;
            Ok(())
        };
        if converge_or_recover(
            rollback,
            cold_switch_selected_node(Arc::clone(&state), app.clone(), generation, guard),
        ).await {
            restore_selected_node(&state, &app, generation, &previous_name).await;
        }
        return;
    }

    close_connections_bound_to(&state, generation, &previous_name).await;
    if state.lock().await.connect_generation != generation {
        return;
    }
    if !converge_or_recover(
        service::tono_replace_proxy_endpoints(&session, new_endpoints),
        cold_switch_selected_node(Arc::clone(&state), app.clone(), generation, guard),
    ).await {
        return;
    }
    let inner = state.lock().await;
    if inner.connect_generation == generation {
        commands::emit_status(&app, &commands::status_of(&inner));
    }
}

/// The verified selector is not a completed switch until the exact endpoint set commits.
/// Both forward convergence and rollback use this boundary. The recovery future is lazy:
/// only failure enters the existing generation-checked, keep-armed cold-switch owner.
async fn converge_or_recover(
    convergence: impl std::future::Future<Output = anyhow::Result<()>>,
    recovery: impl std::future::Future<Output = ()>,
) -> bool {
    if let Err(error) = convergence.await {
        logging!(warn, Type::Service, "Tono: switch protection did not converge ({error:#}); recovering with WFP armed");
        recovery.await;
        return false;
    }
    true
}

pub(super) async fn cold_switch_selected_node(
    state: Arc<TonoState>, app: AppHandle, generation: u64,
    guard: tokio::sync::OwnedRwLockWriteGuard<()>,
) {
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
        // R2-F2: same armed idle state as the vanish path; the re-entry attempt below may
        // be guard-rejected, and the barrier's Service truth must not go unwatched then.
        super::monitor::ensure_protection_resync_locked(&mut inner, || {
            super::monitor::spawn_protection_resync(&state, &app)
        });
    }
    let _ = service::tono_stop_core(false).await;
    // Startup and failure reconciliation acquire their own lifecycle ownership. Transfer only
    // the generation into re-entry; holding this writer across either path would deadlock.
    drop(guard);
    if state.lock().await.connect_generation != generation {
        return;
    }
    match attempt_for_generation(&state, &app, Some(generation)).await {
        Attempt::Failed { generation, error, account_owner } => {
            if fail_connect(&state, &app, generation, error, account_owner).await {
                schedule_reconnect_for_generation(&state, &app, generation).await;
            }
        }
        Attempt::GuardRejected(reason) if guard_rejection_is_transient(&reason) => {
            logging!(info, Type::Service, "Tono: 节点切换被暂态守卫拒绝，稍后重试: {reason}");
            schedule_reconnect_for_generation(&state, &app, generation).await;
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
    let Some(payload) = fetch_connections(&secret, port).await else {
        return;
    };
    let Ok(client) = controller_client(Duration::from_secs(2)) else {
        return;
    };
    for connection in payload.connections {
        if !connection
            .chains
            .iter()
            .any(|hop| hop.eq_ignore_ascii_case(exit_name))
        {
            continue;
        }
        if connection.id.is_empty() {
            continue;
        }
        let Ok(mut url) = reqwest::Url::parse(&controller_url(port, "/connections")) else {
            continue;
        };
        if url.path_segments_mut().is_ok() {
            let _ = url.path_segments_mut().map(|mut segments| {
                segments.push(&connection.id);
            });
        }
        let _ = client
            .delete(url)
            .bearer_auth(&secret)
            .send()
            .await;
    }
}

#[cfg(test)]
mod convergence_tests {
    use super::converge_or_recover;
    use tono_core::connection::ConnectionFsm;

    #[test]
    fn verified_rollback_restores_the_selection_used_on_next_launch() {
        let directory = std::env::temp_dir().join(format!("tono-switch-selection-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&directory).unwrap();
        let _cleanup = scopeguard::guard(directory.clone(), |path| { let _ = std::fs::remove_dir_all(path); });
        crate::tono::state::save_selection(&directory, "new-exit").unwrap();
        let mut selected = Some("new-exit".to_string());
        super::restore_selection_value(&mut selected, &directory, "old-exit").unwrap();
        assert_eq!(selected.as_deref(), Some("old-exit"));
        assert_eq!(crate::tono::state::load_selection(&directory).as_deref(), Some("old-exit"));
    }

    #[tokio::test]
    async fn failed_exact_endpoint_commit_recovers_instead_of_completing_the_switch() {
        let mut fsm = ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        let mut recovery_ran = false;
        // Union/selector/probe have succeeded; only the final Service replacement fails.
        let completed = converge_or_recover(
            async { anyhow::bail!("injected final endpoint replacement failure") },
            async {
                recovery_ran = true;
                fsm.tunnel_died();
            },
        ).await;
        assert!(!completed, "no caller may publish switch completion");
        assert!(recovery_ran);
        assert!(!fsm.status().is_connected);
        assert!(fsm.status().is_protection_blocked);
        assert!(fsm.session_verified(), "retain the protected reconnect eligibility");
    }
}
