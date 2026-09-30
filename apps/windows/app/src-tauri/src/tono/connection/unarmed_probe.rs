//! After the shared fail-open release, prove a node with TCP and only then connect.
//!
//! The loop does not call the Service kill-switch or start the tunnel. Disconnect
//! aborts it. A proof that fails leaves the original network in place and waits.

use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tokio::task_local;
use tono_core::unarmed_probe::{self, ProbeTarget, Schedule, Step};
use tono_core::ValidatedNode;
use tono_logging::{Type, logging};

use crate::process::AsyncHandler;
use crate::tono::state::{AccountState, TonoState};

task_local! {
    static IN_UNARMED_PROBE: ();
}

pub(super) fn in_unarmed_probe() -> bool {
    IN_UNARMED_PROBE.try_with(|_| ()).is_ok()
}

pub(super) async fn spawn_after_release(state: &Arc<TonoState>, app: &AppHandle) {
    if in_unarmed_probe() {
        return;
    }
    let ticket = state
        .unarmed_probe_ticket
        .fetch_add(1, Ordering::AcqRel)
        .wrapping_add(1);
    let generation = state.lock().await.connect_generation;
    let task_state = Arc::clone(state);
    let task_app = app.clone();
    let handle = AsyncHandler::spawn(move || async move {
        IN_UNARMED_PROBE
            .scope((), run(task_state, task_app, ticket, generation))
            .await;
    });
    let mut inner = state.lock().await;
    if let Some(previous) = inner.tasks.unarmed_probe.replace(handle) {
        previous.abort();
    }
}

async fn run(state: Arc<TonoState>, app: AppHandle, ticket: u64, mut generation: u64) {
    let mut schedule = Schedule::begin(now_ms());
    loop {
        if !still_owner(&state, ticket, generation).await {
            return;
        }
        let (preferred, region, targets) = {
            let inner = state.lock().await;
            let Some(preferred) = inner.selected_node.clone() else {
                return;
            };
            let region = unarmed_probe::region_of(&preferred);
            let targets = probe_targets(&inner.nodes);
            (preferred, region, targets)
        };
        match schedule.on_clock(&preferred, &region, &targets, now_ms()) {
            Step::Wait { until_ms } => {
                if !sleep_until(&state, ticket, generation, until_ms).await {
                    return;
                }
            }
            Step::Probe { names } => {
                let mut proven = None;
                for name in names {
                    if !still_owner(&state, ticket, generation).await {
                        return;
                    }
                    let node = {
                        let inner = state.lock().await;
                        inner.nodes.iter().find(|node| node.name == name).cloned()
                    };
                    let Some(node) = node else {
                        schedule.note_down(&name);
                        continue;
                    };
                    if tcp_open(&node).await {
                        let endpoint = format!("{}:{}", node.server, node.port);
                        state.unarmed_proofs.lock().remember(&endpoint, now_ms());
                        proven = Some(schedule.proven(&name));
                        break;
                    }
                    schedule.note_down(&name);
                }
                let Some(name) = proven else {
                    continue;
                };
                if !barrier_is_down(&state, ticket, generation).await {
                    return;
                }
                {
                    let mut inner = state.lock().await;
                    if inner.connect_generation != generation || inner.fsm.kill_switch_armed() {
                        return;
                    }
                    inner.selected_node = Some(name);
                }
                logging!(
                    info,
                    Type::Service,
                    "Tono: unarmed probe found a reachable exit; connecting without a filter already installed"
                );
                let before = generation;
                // Connect calls this function again after a failure. Name that future
                // as a trait object so the spawned task's type does not contain itself.
                let connect: std::pin::Pin<
                    Box<dyn std::future::Future<Output = Result<(), String>> + Send>,
                > = Box::pin(super::connect_for_generation(
                    Arc::clone(&state),
                    app.clone(),
                    Some(before),
                ));
                let result = connect.await;
                let after = state.lock().await.connect_generation;
                if result.is_ok() {
                    return;
                }
                if after == before.wrapping_add(1) {
                    generation = after;
                    schedule = Schedule::begin(now_ms());
                } else if after != before {
                    return;
                }
            }
        }
    }
}

fn probe_targets(nodes: &[ValidatedNode]) -> Vec<ProbeTarget> {
    nodes
        .iter()
        .map(|node| ProbeTarget {
            name: node.name.clone(),
            region: unarmed_probe::region_of(&node.name),
            endpoint: format!("{}:{}", node.server, node.port),
            tcp: !node.is_hysteria2(),
        })
        .collect()
}

async fn tcp_open(node: &ValidatedNode) -> bool {
    if node.is_hysteria2() {
        return false;
    }
    let address = SocketAddr::new(IpAddr::V4(node.server), node.port);
    tokio::time::timeout(
        Duration::from_millis(unarmed_probe::TCP_PROOF_MS),
        tokio::net::TcpStream::connect(address),
    )
    .await
    .ok()
    .and_then(|result| result.ok())
    .is_some()
}

async fn still_owner(state: &TonoState, ticket: u64, generation: u64) -> bool {
    if state.unarmed_probe_ticket.load(Ordering::Acquire) != ticket {
        return false;
    }
    let inner = state.lock().await;
    inner.connect_generation == generation && inner.account_state == AccountState::Ready
}

async fn barrier_is_down(state: &TonoState, ticket: u64, generation: u64) -> bool {
    if !still_owner(state, ticket, generation).await {
        return false;
    }
    let inner = state.lock().await;
    let status = inner.fsm.status();
    !inner.fsm.kill_switch_armed()
        && !status.is_protection_blocked
        && !status.is_connected
        && !status.is_connecting
        && !status.is_disconnecting
}

async fn sleep_until(state: &TonoState, ticket: u64, generation: u64, until_ms: u64) -> bool {
    loop {
        let now = now_ms();
        if now >= until_ms {
            return true;
        }
        if !still_owner(state, ticket, generation).await {
            return false;
        }
        let slice = (until_ms - now).min(1_000);
        tokio::time::sleep(Duration::from_millis(slice)).await;
    }
}

fn now_ms() -> u64 {
    crate::tono::commands::epoch_millis().max(0) as u64
}
