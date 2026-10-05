//! After the shared fail-open release, prove a node with TCP and only then connect.
//!
//! The loop does not call the Service kill-switch or start the tunnel. Disconnect
//! aborts it. A proof that fails leaves the original network in place and waits.

use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::task_local;
use tono_core::unarmed_probe::{self, ProbeTarget, Schedule, Step};
use tono_core::ValidatedNode;
use tono_logging::{Type, logging};

use crate::process::AsyncHandler;
use crate::tono::state::{AccountState, TonoState};

use super::platform::PhysicalNetworkSnapshot;

task_local! {
    static IN_UNARMED_PROBE: ();
}

pub(super) fn in_unarmed_probe() -> bool {
    IN_UNARMED_PROBE.try_with(|_| ()).is_ok()
}

/// Synchronous on purpose. `connect_for_generation` calls this after a
/// failure, and `run` awaits `connect_for_generation`. An async starter makes
/// those two opaque futures a type cycle (`E0391`).
pub(super) fn spawn_after_release(state: &Arc<TonoState>, app: &AppHandle, generation: u64) {
    if in_unarmed_probe() {
        return;
    }
    let ticket = state
        .unarmed_probe_ticket
        .fetch_add(1, Ordering::AcqRel)
        .wrapping_add(1);
    let task_state = Arc::clone(state);
    let task_app = app.clone();
    let handle = AsyncHandler::spawn(move || async move {
        IN_UNARMED_PROBE
            .scope((), run(task_state, task_app, ticket, generation))
            .await;
    });
    install_handle(state, ticket, handle);
}

fn install_handle(state: &Arc<TonoState>, ticket: u64, handle: tauri::async_runtime::JoinHandle<()>) {
    if let Ok(mut inner) = state.try_lock() {
        store_handle(&state, &mut inner, ticket, handle);
        return;
    }
    let state = Arc::clone(state);
    AsyncHandler::spawn(move || async move {
        let mut inner = state.lock().await;
        store_handle(&state, &mut inner, ticket, handle);
    });
}

fn store_handle(
    state: &TonoState,
    inner: &mut crate::tono::state::TonoInner,
    ticket: u64,
    handle: tauri::async_runtime::JoinHandle<()>,
) {
    // A newer starter already replaced this ticket. Abort this task instead of
    // overwriting the newer handle.
    if state.unarmed_probe_ticket.load(Ordering::Acquire) != ticket {
        handle.abort();
        return;
    }
    if let Some(previous) = inner.tasks.unarmed_probe.replace(handle) {
        previous.abort();
    }
}

async fn run(state: Arc<TonoState>, app: AppHandle, ticket: u64, mut generation: u64) {
    let clock = Instant::now();
    let mut schedule = Schedule::begin(0);
    let mut network = NetworkWatch::default();
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
        match schedule.on_clock(&preferred, &region, &targets, elapsed_ms(clock)) {
            Step::Wait { until_ms } => {
                match sleep_until(
                    &state, ticket, generation, &preferred, clock, until_ms, &mut network,
                ).await {
                    WaitOutcome::Retired => return,
                    WaitOutcome::Changed => schedule = Schedule::begin(elapsed_ms(clock)),
                    WaitOutcome::NetworkChanged => schedule.network_changed(elapsed_ms(clock)),
                    WaitOutcome::Due => {}
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
                    if !apply_proven_selection(&mut inner, &preferred, name) {
                        // An idle user selection does not change the connection generation.
                        // Retire this proof and start a fresh round for the new choice.
                        schedule = Schedule::begin(elapsed_ms(clock));
                        continue;
                    }
                }
                logging!(
                    info,
                    Type::Service,
                    "Tono: unarmed probe found a reachable exit; connecting without a filter already installed"
                );
                let before = generation;
                let started = elapsed_ms(clock);
                // The starter is synchronous, so this await does not name
                // `run` again. The trait object keeps the spawned task Send
                // without embedding connect's concrete future.
                let connect: std::pin::Pin<
                    Box<dyn std::future::Future<Output = Result<(), super::ConnectFailure>> + Send>,
                > = Box::pin(super::connect_for_generation_tracked(
                    Arc::clone(&state),
                    app.clone(),
                    Some(before),
                ));
                let Err(failure) = connect.await else { return; };
                let Some(owned) = adopt_failed_connect(&state, ticket, failure.retry_generation).await
                else { return; };
                generation = owned;
                // TCP success is not a successful tunnel. Retain the ladder
                // across our own failure generation and same-generation refusals.
                // `fail_connect` has finished the release by the time this returns.
                let ended = elapsed_ms(clock);
                schedule.full_connect_failed(ended, ended.saturating_sub(started));
            }
        }
    }
}

/// Called under the post-proof state lock: a proof cannot replace newer selection intent.
fn apply_proven_selection(
    inner: &mut crate::tono::state::TonoInner,
    preferred: &str,
    proven: String,
) -> bool {
    if inner.selected_node.as_deref() != Some(preferred) {
        return false;
    }
    inner.selected_node = Some(proven);
    true
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

async fn adopt_failed_connect(
    state: &TonoState, ticket: u64, retry_generation: Option<u64>,
) -> Option<u64> {
    let generation = retry_generation?;
    let inner = state.lock().await;
    if state.unarmed_probe_ticket.load(Ordering::Acquire) == ticket
        && inner.account_state == AccountState::Ready
        && inner.connect_generation == generation
    {
        Some(generation)
    } else {
        None
    }
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

#[derive(Debug, PartialEq, Eq)]
enum WaitOutcome {
    Due,
    /// The user's selection changed: a new choice starts a fresh ladder.
    Changed,
    /// The preferred physical uplink changed.
    NetworkChanged,
    Retired,
}

#[cfg(any(windows, test))]
static NATIVE_OBSERVATION_SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

#[cfg(any(windows, test))]
fn start_native_observation(
    slot: &'static tokio::sync::Semaphore,
    observe: impl FnOnce() -> Result<PhysicalNetworkSnapshot, String> + Send + 'static,
) -> Option<tokio::task::JoinHandle<Result<PhysicalNetworkSnapshot, String>>> {
    // A dropped owner detaches a started blocking worker. Keep the permit in
    // that worker, so replacement owners cannot accumulate hung native reads.
    let permit = slot.try_acquire().ok()?;
    Some(tokio::task::spawn_blocking(move || {
        let _permit = permit;
        observe()
    }))
}

/// The uplink Windows routes through: lowest effective metric, ties by LUID. Its
/// metric is left out: Wi-Fi link-rate changes move the automatic metric with no
/// move of the network, and each such wake used to restart the ladder.
fn preferred_uplink(snapshot: &PhysicalNetworkSnapshot) -> Option<(u64, u32, u32)> {
    snapshot
        .iter()
        .min_by_key(|(luid, source, gateway, metric)| (*metric, *luid, *source, *gateway))
        .map(|(luid, source, gateway, _)| (*luid, *source, *gateway))
}

/// One pending native read per process at most, even across owner replacement.
/// An unresponsive IP Helper call holds neither async workers nor lifecycle
/// locks, and cannot spawn a worker on every tick. Samples remain memory-only.
#[derive(Default)]
struct NetworkWatch {
    uplink: Option<Option<(u64, u32, u32)>>,
    pending: Option<tokio::task::JoinHandle<Result<PhysicalNetworkSnapshot, String>>>,
}

impl NetworkWatch {
    fn observe(&mut self, snapshot: PhysicalNetworkSnapshot) -> bool {
        let uplink = preferred_uplink(&snapshot);
        let changed = self.uplink.as_ref().is_some_and(|previous| previous != &uplink);
        self.uplink = Some(uplink);
        changed
    }

    async fn changed(&mut self) -> bool {
        let mut changed = false;
        if self.pending.as_ref().is_some_and(|pending| pending.is_finished())
            && let Ok(Ok(snapshot)) = self.pending.take().unwrap().await
        {
            changed = self.observe(snapshot);
        }
        #[cfg(windows)]
        if self.pending.is_none() {
            self.pending = start_native_observation(
                &NATIVE_OBSERVATION_SLOT,
                super::platform::physical_network_snapshot_windows,
            );
        }
        changed
    }
}

async fn sleep_until(
    state: &TonoState,
    ticket: u64,
    generation: u64,
    preferred: &str,
    clock: Instant,
    until_ms: u64,
    network: &mut NetworkWatch,
) -> WaitOutcome {
    loop {
        if !still_owner(state, ticket, generation).await {
            return WaitOutcome::Retired;
        }
        if state.lock().await.selected_node.as_deref() != Some(preferred) {
            return WaitOutcome::Changed;
        }
        if barrier_is_down(state, ticket, generation).await && network.changed().await {
            return WaitOutcome::NetworkChanged;
        }
        let now = elapsed_ms(clock);
        if now >= until_ms {
            return WaitOutcome::Due;
        }
        let slice = (until_ms - now).min(1_000);
        tokio::time::sleep(Duration::from_millis(slice)).await;
    }
}

fn elapsed_ms(clock: Instant) -> u64 {
    clock.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn now_ms() -> u64 {
    crate::tono::commands::epoch_millis().max(0) as u64
}

/// Prove a VLESS exit before `run_stages` installs the tunnel.
///
/// Runs beside Service startup. A fresh proof skips the wait. Hysteria2 has no
/// TCP proof; refusing to install a tunnel for it would block a working UDP exit.
/// Protected re-entry retains WFP, whose endpoint permits belong to Core rather
/// than the App. The normal protected transaction proves that path after startup.
pub(super) async fn tcp_proof_before_tunnel(
    state: &Arc<TonoState>,
    node: &ValidatedNode,
) -> Result<(), String> {
    if state.lock().await.fsm.kill_switch_armed() || node.is_hysteria2() {
        return Ok(());
    }
    let endpoint = format!("{}:{}", node.server, node.port);
    if state.unarmed_proofs.lock().fresh(&endpoint, now_ms()) {
        return Ok(());
    }
    if tcp_open(node).await {
        state.unarmed_proofs.lock().remember(&endpoint, now_ms());
        return Ok(());
    }
    Err(
        "tcp connect to the selected exit did not complete before a tunnel was installed"
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn unarmed_owner_adopts_its_timeout_retirement_but_not_user_cancellation() {
        let state = Arc::new(TonoState::for_test());
        let ticket = state.unarmed_probe_ticket.load(Ordering::Acquire);
        let (before, admitted, cancellation, account_owner, record) = {
            let mut inner = state.lock().await;
            inner.account_state = AccountState::Ready;
            let before = inner.connect_generation;
            let (admitted, cancellation, account_owner) =
                super::super::begin_attempt(&mut inner, before).await.unwrap();
            let record = inner.attempt_history.begin(0, "US A".into(), "vless", 0);
            (before, admitted, cancellation, account_owner, record)
        };
        let transaction = super::super::transaction::ConnectTransaction::new(cancellation);
        tokio::time::advance(super::super::transaction::CONNECT_TRANSACTION_TIMEOUT).await;
        let failure = transaction.wait("wake after sleep", std::future::pending::<()>())
            .await.unwrap_err();
        let super::super::Attempt::Failed { generation, .. } =
            super::super::attempt_from_stage_failure(&state, admitted, &record, failure, account_owner).await
        else { panic!("timeout must return its own retired generation"); };
        assert_eq!(generation, before.wrapping_add(2));
        let cleanup_state = Arc::clone(&state);
        let current = super::super::cleanup::reconcile_failure(
            Arc::clone(&state), generation, async { None },
            move |_, _guard| async move {
                // Pre-arm timeout: the real failure FSM returns to idle without native IPC.
                cleanup_state.lock().await.fsm.connect_failed();
                true
            },
        ).await.unwrap();
        assert!(current);
        assert_eq!(adopt_failed_connect(&state, ticket, Some(generation)).await, Some(generation),
            "the sole recovery owner must survive its own second retirement");
        let mut schedule = Schedule::begin(0);
        schedule.connect_failed(0);
        let targets = [ProbeTarget {
            name: "US A".into(), region: "US".into(), endpoint: "192.0.2.1:443".into(), tcp: true,
        }];
        assert_eq!(schedule.on_clock("US A", "US", &targets, 1999), Step::Wait { until_ms: 2000 });
        assert!(matches!(schedule.on_clock("US A", "US", &targets, 2000), Step::Probe { .. }));
        state.lock().await.invalidate_connection(true);
        assert_eq!(adopt_failed_connect(&state, ticket, Some(generation)).await, None,
            "a saved failure token cannot adopt the user's later cancellation");

        let (before, admitted, cancellation, account_owner, record) = {
            let mut inner = state.lock().await;
            let before = inner.connect_generation;
            let (admitted, cancellation, account_owner) =
                super::super::begin_attempt(&mut inner, before).await.unwrap();
            let record = inner.attempt_history.begin(0, "US A".into(), "vless", 0);
            (before, admitted, cancellation, account_owner, record)
        };
        let transaction = super::super::transaction::ConnectTransaction::new(cancellation);
        tokio::time::advance(super::super::transaction::CONNECT_TRANSACTION_TIMEOUT).await;
        let failure = transaction.wait("late timeout", std::future::pending::<()>()).await.unwrap_err();
        state.lock().await.invalidate_connection(true);
        assert_eq!(state.lock().await.connect_generation, before.wrapping_add(2));
        assert!(matches!(
            super::super::attempt_from_stage_failure(&state, admitted, &record, failure, account_owner).await,
            super::super::Attempt::Stale
        ), "the same numeric +2 caused by user cancellation has no failure ownership token");
        assert_eq!(adopt_failed_connect(&state, ticket, None).await, None);
    }

    #[tokio::test]
    async fn replacing_an_observer_cannot_accumulate_hung_native_reads() {
        static SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
        let (entered, entry) = tokio::sync::oneshot::channel();
        let (resume, resumed) = std::sync::mpsc::channel();
        let worker = start_native_observation(&SLOT, move || {
            entered.send(()).unwrap();
            resumed.recv().unwrap();
            Ok(vec![])
        }).unwrap();
        entry.await.unwrap();
        drop(worker); // Dropping the retired owner cannot cancel a started native read.
        assert!(start_native_observation(&SLOT, || Ok(vec![])).is_none(),
            "the old native read must exclude every replacement owner");
        resume.send(()).unwrap();
        let replacement = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(worker) = start_native_observation(&SLOT, || Ok(vec![])) {
                    break worker;
                }
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        assert!(replacement.await.unwrap().unwrap().is_empty());
    }

    #[tokio::test]
    async fn late_unarmed_proof_preserves_a_newer_idle_selection() {
        let state = TonoState::for_test();
        let mut inner = state.lock().await;
        inner.account_state = AccountState::Ready;
        inner.selected_node = Some("Tokyo · Kite".into());
        let preferred = inner.selected_node.clone().unwrap();
        let generation = inner.connect_generation;
        // Model the real idle selection command while A's TCP proof is outstanding.
        inner.selected_node = Some("Tokyo · Fuji".into());
        assert_eq!(inner.connect_generation, generation);
        assert!(!apply_proven_selection(&mut inner, &preferred, preferred.clone()));
        assert_eq!(inner.selected_node.as_deref(), Some("Tokyo · Fuji"));
    }

    #[tokio::test]
    async fn protected_reconnect_does_not_open_an_app_tcp_probe() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let node = ValidatedNode {
            name: "US Reality fixture".into(),
            server: std::net::Ipv4Addr::LOCALHOST,
            port: address.port(),
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
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            inner.fsm.tunnel_died();
            inner.fsm.begin_connect();
            assert!(inner.fsm.kill_switch_armed());
        }
        let endpoint = format!("{}:{}", node.server, node.port);
        tcp_proof_before_tunnel(&state, &node).await.unwrap();
        assert!(!state.unarmed_proofs.lock().fresh(&endpoint, now_ms()),
            "protected re-entry must leave App TCP proof to the unarmed path; WFP permits only Core to dial the exit");
    }

    #[test]
    fn only_changed_physical_network_samples_wake_recovery() {
        let mut network = NetworkWatch::default();
        let wifi = vec![(17, 0x0100000a, 0x0100000a, 25)];
        assert!(!network.observe(wifi.clone()), "first observation only seeds");
        assert!(!network.observe(wifi.clone()), "unchanged DNS/TUN activity must not reset backoff");
        assert!(network.observe(vec![]), "physical route loss is a change");
        assert!(!network.observe(vec![]));
        assert!(network.observe(wifi), "restoring the same route wakes recovery");
        let moved = vec![(17, 0x0200000a, 0x0100000a, 25)];
        assert!(network.observe(moved.clone()), "same-adapter address change wakes recovery");
        assert!(!network.observe(moved));
        assert!(!network.observe(vec![(17, 0x0200000a, 0x0100000a, 30)]),
            "a metric-only change of the same uplink is not a move");
    }

    /// WIN-UNARMED-METRIC-WAKE: a metric-only change of the same uplink restarted the
    /// ladder at once, so a 52 s attempt behind the barrier could repeat seconds after
    /// its release. The metric no longer wakes, and a real move still waits three times
    /// the failed attempt from its release.
    #[test]
    fn metric_wake_preserves_attempt_floor() {
        let targets = [ProbeTarget {
            name: "US A".into(), region: "us".into(), endpoint: "192.0.2.1:443".into(), tcp: true,
        }];
        let mut network = NetworkWatch::default();
        assert!(!network.observe(vec![(17, 0x0200000a, 0x0100000a, 25)]));
        let mut schedule = Schedule::begin(0);
        schedule.full_connect_failed(60_000, 52_000);
        assert!(!network.observe(vec![(17, 0x0200000a, 0x0100000a, 35)]));
        assert!(network.observe(vec![(18, 0x0300000a, 0x0100000a, 25)]), "a new uplink is a move");
        schedule.network_changed(61_000);
        assert_eq!(schedule.on_clock("US A", "us", &targets, 61_000), Step::Wait { until_ms: 216_000 });
        assert!(matches!(schedule.on_clock("US A", "us", &targets, 216_000), Step::Probe { .. }));
    }
}
