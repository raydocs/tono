//! Automatic, opt-out, enum-only Windows connection diagnostics. No public-site probes, FSM
//! decisions, retries of the Core, WFP exceptions, raw-log upload or secret-bearing disk queue.
//! Unknown is an observation result, NOT a statement that protection or Internet access works.
mod model;
mod outbox;

use crate::{
    core::service,
    tono::{
        route_diagnostics::{RouteClass, RouteObservation},
        state::TonoState,
    },
};
use model::{Code, Key, Phase, Snapshot};
use outbox::Outbox;
use std::{
    net::Ipv4Addr,
    path::PathBuf,
    sync::{
        Arc, LazyLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tono_core::{auth::ApiError, connection::UiState};

static STARTED: AtomicBool = AtomicBool::new(false);
static WAKE: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);
static PURGE_REQUESTED: AtomicBool = AtomicBool::new(false);
const SAMPLE_INTERVAL: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(3);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_UPLOAD_BYTES: usize = 48 * 1024;

pub(crate) fn wake() {
    WAKE.notify_one();
}

pub(crate) fn request_purge() {
    PURGE_REQUESTED.store(true, Ordering::Release);
    wake();
}

pub(crate) fn spawn_once(state: &Arc<TonoState>) {
    if !cfg!(windows) || STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    let state = Arc::clone(state);
    tokio::spawn(async move {
        run(state).await;
    });
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn phase(ui: UiState) -> Phase {
    match ui {
        UiState::NotConnected => Phase::Disconnected,
        UiState::Connecting(_) => Phase::Connecting,
        UiState::Connected => Phase::Connected,
        UiState::ProtectedOffline => Phase::ProtectedOffline,
        UiState::Disconnecting => Phase::Disconnecting,
    }
}

/// Secrets/address inputs live only in this transient local context. It cannot be serialized.
struct Context {
    diagnostics_epoch: u64,
    auth_generation: u64,
    account_id: String,
    base: PathBuf,
    generation: u64,
    phase: Phase,
    node: Option<String>,
    vps: Option<Ipv4Addr>,
    controller: Option<(u16, String)>,
    home_configured: bool,
    home_matches: bool,
    requested_transport: tono_core::node::ExitTransport,
    applied_transport: Option<tono_core::node::ExitTransport>,
    failure: bool,
    failure_class: Option<model::FailureClass>,
    steps: Vec<model::Step>,
    elapsed_ms: Option<u64>,
    retry_attempt: u32,
}

async fn context(state: &TonoState) -> Option<Context> {
    let inner = tokio::time::timeout(Duration::from_millis(100), state.lock())
        .await
        .ok()?;
    if inner.account_state != crate::tono::state::AccountState::Ready {
        return None;
    }
    let account = inner.account.as_ref()?;
    Some(Context {
        diagnostics_epoch: state.audit().automatic_diagnostics_epoch(),
        auth_generation: inner.sign_in_generation,
        account_id: account.id.clone(),
        base: inner.catalog_dir.clone(),
        generation: inner.connect_generation,
        phase: phase(inner.fsm.status().ui_state()),
        node: inner.selected_node.clone(),
        vps: inner
            .nodes
            .iter()
            .find(|n| Some(&n.name) == inner.selected_node.as_ref())
            .map(|n| n.server),
        controller: inner.controller_port.zip(inner.controller_secret.clone()),
        home_configured: inner.routing.as_ref().is_some_and(|r| r.home_socks5.is_some()),
        requested_transport: inner.exit_transport,
        applied_transport: inner.applied_exit_transport,
        home_matches: crate::tono::connection::same_residential_route(
            inner.routing.as_ref(),
            inner.applied_routing.as_ref(),
        ),
        failure: inner.connect_error.is_some(),
        failure_class: inner.connect_error.as_deref().map(model::FailureClass::from_error),
        steps: inner
            .connect_steps
            .iter()
            .filter_map(model::Step::from_record)
            .collect(),
        elapsed_ms: crate::tono::steps::total_elapsed_ms(&inner.connect_steps),
        retry_attempt: inner.retry_attempt,
    })
}

async fn still_owned(state: &TonoState, expected: &Context) -> bool {
    context(state).await.is_some_and(|current| {
        current.auth_generation == expected.auth_generation
            && current.diagnostics_epoch == expected.diagnostics_epoch
            && current.account_id == expected.account_id
            && !matches!(current.phase, Phase::Connecting | Phase::Disconnecting)
    }) && !state.audit().is_closed()
        && state.audit().enabled()
        && state.audit().automatic_diagnostics_enabled()
        && !PURGE_REQUESTED.load(Ordering::Acquire)
}

async fn bounded<T>(future: impl std::future::Future<Output = anyhow::Result<T>>) -> Option<T> {
    tokio::time::timeout(READ_TIMEOUT, future)
        .await
        .ok()
        .and_then(Result::ok)
}

async fn while_owned<T>(
    state: &TonoState,
    ctx: &Context,
    future: impl std::future::Future<Output = Result<T, ApiError>>,
) -> Option<Result<T, ApiError>> {
    tokio::pin!(future);
    let deadline = tokio::time::sleep(UPLOAD_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            result = &mut future => return Some(result),
            _ = &mut deadline => return None,
            _ = tokio::time::sleep(Duration::from_millis(250)) => {
                if !still_owned(state, ctx).await { return None; }
            }
        }
    }
}

async fn controller_json(client: &reqwest::Client, port: u16, secret: &str, path: &str) -> Option<serde_json::Value> {
    let mut response = client
        .get(format!("http://127.0.0.1:{port}{path}"))
        .bearer_auth(secret)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > 64 * 1024) {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len().saturating_add(chunk.len()) > 64 * 1024 {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).ok()
}

async fn controller_facts(ctx: &Context) -> Vec<model::Fact> {
    let Some((port, secret)) = &ctx.controller else {
        return Vec::new();
    };
    let Ok(client) = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .pool_max_idle_per_host(0)
        .build()
    else {
        return Vec::new();
    };
    let (selector, connections) = tokio::join!(
        controller_json(&client, *port, secret, "/proxies/Tono-Exit"),
        controller_json(&client, *port, secret, "/connections"),
    );
    let mut facts = vec![model::Fact {
        key: Key::ControllerReadable,
        value: model::Value::Flag(selector.is_some() || connections.is_some()),
    }];
    if let Some(actual) = selector.as_ref().and_then(|v| v.get("now")).and_then(|v| v.as_str()) {
        facts.push(model::Fact {
            key: Key::SelectorMatches,
            value: model::Value::Flag(ctx.node.as_deref() == Some(actual)),
        });
    }
    if let Some(connections) = connections {
        // No connection metadata, process, destination, rule, chain or URL may leave this scope.
        for (field, key) in [("uploadTotal", Key::UploadTotal), ("downloadTotal", Key::DownloadTotal)] {
            if let Some(n) = connections.get(field).and_then(|v| v.as_u64()) {
                facts.push(model::Fact {
                    key,
                    value: model::Value::Count(n.min(u32::MAX as u64) as u32),
                });
            }
        }
        if let Some(flows) = connections.get("connections").and_then(|v| v.as_array()) {
            facts.push(model::Fact {
                key: Key::ActiveConnections,
                value: model::Value::Count(flows.len().min(u32::MAX as usize) as u32),
            });
        }
    }
    facts
}

fn route_code(route: RouteClass) -> Code {
    match route {
        RouteClass::TonoTunnel => Code::Tunnel,
        RouteClass::Physical => Code::Physical,
        RouteClass::OtherInterface => Code::OtherInterface,
        RouteClass::Unknown => Code::Unknown,
    }
}

async fn routes(ctx: &Context) -> Option<RouteObservation> {
    Some(crate::tono::route_diagnostics::observe(ctx.vps?, tono_core::config::TUN_DEVICE_NAME).await)
}

fn app_snapshot(ctx: &Context) -> Snapshot {
    let mut snapshot = Snapshot {
        at_ms: now_ms(),
        generation: ctx.generation,
        phase: ctx.phase,
        node: ctx.node.clone().and_then(|s| s.try_into().ok()),
        app_source: crate::tono::diagnostic_contract::APP_SOURCE.to_owned().try_into().ok(),
        service_source: None,
        facts: Vec::new(),
        errors: Vec::new(),
        steps: ctx.steps.clone(),
        failure_class: ctx.failure_class,
    };
    snapshot.class(
        Key::AppFailure,
        if ctx.failure {
            Code::ReportedFailure
        } else {
            Code::NoReportedFailure
        },
    );
    snapshot.class(Key::RemoteReachability, Code::NotObserved);
    snapshot.flag(Key::HomeConfigured, ctx.home_configured);
    snapshot.flag(Key::HomeAppliedMatches, ctx.home_matches);
    let transport_code = |transport| match transport {
        tono_core::node::ExitTransport::RealityTcp => Code::RealityTcp,
        tono_core::node::ExitTransport::Hysteria2Udp => Code::Hysteria2Udp,
    };
    snapshot.class(Key::RequestedTransport, transport_code(ctx.requested_transport));
    snapshot.class(Key::AppliedTransport, ctx.applied_transport.map(transport_code).unwrap_or(Code::NotObserved));
    snapshot.flag(
        Key::OptionalDirectEnabled,
        crate::tono::connection::optional_direct_enabled(),
    );
    snapshot.count(Key::RetryAttempt, ctx.retry_attempt as u64);
    if let Some(elapsed) = ctx.elapsed_ms {
        snapshot.count(Key::AttemptElapsedMs, elapsed);
    }
    snapshot
}

async fn capture(state: &TonoState, ctx: &Context) -> Option<Snapshot> {
    // Do not add any of these reads to admission, teardown, node switch or recovery's clock.
    if matches!(ctx.phase, Phase::Connecting | Phase::Disconnecting) {
        return None;
    }
    let before = bounded(service::tono_service_status_snapshot()).await;
    let (dns, logs, protocol, route, controller) = tokio::join!(
        bounded(service::tono_protected_dns_status()),
        async {
            if before.as_ref().is_some_and(|s| s.is_active && s.core_pid.is_some()) {
                bounded(service::tono_core_log_ring_readonly()).await
            } else {
                None
            }
        },
        tokio::time::timeout(READ_TIMEOUT, tono_service_protocol::get_version()),
        routes(ctx),
        controller_facts(ctx),
    );
    let after = bounded(service::tono_service_status_snapshot()).await;
    let current = context(state).await?;
    if current.auth_generation != ctx.auth_generation
        || current.account_id != ctx.account_id
        || current.generation != ctx.generation
        || current.phase != ctx.phase
    {
        return None;
    }
    let consistent = match (&before, &after) {
        (Some(a), Some(b)) => {
            a.core_pid == b.core_pid
                && a.core_generation == b.core_generation
                && a.active_generation == b.active_generation
                && a.is_active == b.is_active
                && a.kill_switch == b.kill_switch
        }
        _ => false,
    };
    let mut snapshot = app_snapshot(ctx);
    if let Some(protocol) = protocol
        .ok()
        .and_then(Result::ok)
        .filter(|r| r.code == 0)
        .and_then(|r| r.data)
    {
        snapshot.service_source = protocol.connection_source_fingerprint.and_then(|s| s.try_into().ok());
        snapshot.count(Key::ServiceProtocolEpoch, protocol.protocol.epoch as u64);
        snapshot.count(Key::ServiceProtocolRevision, protocol.protocol.revision as u64);
        snapshot.flag(Key::ServiceFreshProofCapable, protocol.fresh_protection_proof);
    }
    snapshot.flag(Key::CaptureTimedOut, false);
    snapshot.flag(Key::CaptureConsistent, consistent);
    snapshot.flag(Key::ServiceReadable, before.is_some() && after.is_some());
    if !consistent {
        return Some(snapshot);
    }
    if let Some(service) = after {
        snapshot.flag(Key::CoreActive, service.is_active);
        if let Some(pid) = service.core_pid {
            snapshot.count(Key::CorePid, pid as u64);
        }
        snapshot.count(Key::CoreGeneration, service.core_generation as u64);
        if let Some(generation) = service.active_generation {
            snapshot.count(Key::ServiceSession, generation);
        }
        if let Some(wfp) = service.kill_switch {
            snapshot.class(
                Key::WfpMode,
                match wfp.mode {
                    tono_service_protocol::KillSwitchStatusMode::Bootstrap => Code::Bootstrap,
                    tono_service_protocol::KillSwitchStatusMode::Locked => Code::Locked,
                    tono_service_protocol::KillSwitchStatusMode::Blocked => Code::Blocked,
                },
            );
            snapshot.flag(Key::WfpWanted, wfp.wanted);
            snapshot.flag(Key::WfpLive, wfp.live);
            snapshot.flag(Key::WfpVerified, wfp.verified);
            snapshot.flag(Key::TunnelPermit, wfp.tunnel_permit_rendered);
            snapshot.flag(Key::WfpHasError, wfp.last_error.is_some());
        }
    }
    snapshot.flag(Key::DnsReadable, dns.is_some());
    if let Some(dns) = dns {
        snapshot.flag(Key::DnsEnabled, dns.enabled);
        snapshot.count(Key::DnsAdapters, dns.adapters as u64);
        snapshot.flag(Key::DnsHasError, dns.last_error.is_some());
    }
    snapshot.facts.extend(controller);
    if let Some(route) = route {
        snapshot.flag(Key::TunnelAliasKnown, route.tunnel_luid.is_some());
        snapshot.class(Key::FakeIpRoute, route_code(route.fake_ip_sample));
        snapshot.class(Key::VpsRoute, route_code(route.selected_vps));
    }
    snapshot.flag(Key::CoreLogsReadable, logs.is_some());
    if let Some((logs, skipped)) = logs {
        snapshot.count(Key::CoreLogRows, logs.len() as u64);
        snapshot.count(Key::CoreLogSkipped, skipped as u64);
        for line in logs {
            if let Some(code) = model::classify(&line) {
                if let Some((_, count)) = snapshot.errors.iter_mut().find(|(existing, _)| *existing == code) {
                    *count += 1;
                } else {
                    snapshot.errors.push((code, 1));
                }
            }
        }
        snapshot.count(
            Key::CoreLogErrors,
            snapshot.errors.iter().map(|(_, count)| *count as u64).sum(),
        );
    }
    Some(snapshot)
}

async fn persist(box_path: &PathBuf, queue: &Outbox) -> bool {
    // Serialize before dispatch so this one background writer retains exclusive queue ownership.
    let Ok(body) = serde_json::to_vec(queue) else {
        return false;
    };
    let path = box_path.clone();
    tokio::task::spawn_blocking(move || {
        serde_json::from_slice::<Outbox>(&body)
            .ok()
            .is_some_and(|q| q.save(&path).is_ok())
    })
    .await
    .unwrap_or(false)
}

fn batch(queue: &Outbox) -> (tono_core::auth::TelemetryWindowReport, usize) {
    let first = &queue.records[0];
    let mut report = first.wire(queue.dropped);
    let mut count = 1;
    for snapshot in queue.records.iter().skip(1).take(2) {
        if snapshot.at_ms < first.at_ms || snapshot.at_ms - first.at_ms > 6 * 60 * 60 * 1000 {
            break;
        }
        let next = snapshot.wire(0);
        if report.events.len() + next.events.len() > 200 {
            break;
        }
        // Oversized batches split; never strand otherwise valid snapshots behind a batch that
        // can never be sent. Count a small header margin before mutating the current batch.
        let current_bytes = serde_json::to_vec(&report).map_or(usize::MAX, |bytes| bytes.len());
        let additional_bytes = serde_json::to_vec(&next.events).map_or(usize::MAX, |bytes| bytes.len());
        if current_bytes.saturating_add(additional_bytes).saturating_add(256) > MAX_UPLOAD_BYTES {
            break;
        }
        report.window_end_ms = snapshot.at_ms;
        report.ui_state = next.ui_state;
        report.selected_server = next.selected_server;
        report.events.extend(next.events);
        report.event_count = report.events.len() as u32;
        count += 1;
    }
    (report, count)
}

async fn send(state: &TonoState, ctx: &Context, queue: &mut Outbox, box_path: &PathBuf) {
    let now = now_ms();
    queue.expire(now);
    if !queue.can_send(now) || !still_owned(state, ctx).await {
        return;
    }
    // An explicit legacy timeline opt-in shares this backend's 6/hour, 80/day account budget.
    // Leave room for its 3/hour cadence instead of allowing two independent uploaders to flood it.
    if state.audit().periodic_telemetry_enabled()
        && (queue.attempts.len() >= 8
            || queue
                .attempts
                .iter()
                .filter(|at| now.saturating_sub(**at) < 60 * 60 * 1000)
                .count()
                >= 2)
    {
        return;
    }
    let (report, count) = batch(queue);
    if serde_json::to_vec(&report).map_or(true, |body| body.len() > MAX_UPLOAD_BYTES) {
        return;
    }
    // Do not send a record that has not first made it to the private durable queue.
    // The reservation also throttles failed token refresh, not just the final HTTP POST.
    queue.reserve_send(now);
    if !persist(box_path, queue).await || !still_owned(state, ctx).await {
        return;
    }
    let client = { state.lock().await.client.clone() };
    let prepared = while_owned(state, ctx, client.prepare_telemetry_window_upload(&report)).await;
    let prepared = match prepared {
        Some(Ok(prepared)) => prepared,
        _ => {
            // No telemetry POST was started. Keep the one-minute refresh backoff, but don't
            // exhaust ingestion quota while the user's ordinary protected path is unavailable.
            queue.attempts.pop();
            let _ = persist(box_path, queue).await;
            return;
        }
    };
    // Preparation may refresh a token. Recheck after it; the prepared request cannot adopt a
    // different account even if sign-out/sign-in happens immediately after this check.
    if !still_owned(state, ctx).await {
        return;
    }
    let result = while_owned(state, ctx, client.send_prepared_telemetry_window(prepared)).await;
    match result {
        Some(Ok(_)) => {
            queue.records.drain(..count);
            queue.dropped = 0;
        }
        Some(Err(ApiError::Transport {
            kind: tono_core::auth::TransportKind::Dns | tono_core::auth::TransportKind::Connect,
            ..
        })) => {
            // Proven non-delivery does not spend the server-ingest quota. Still retry at most
            // once per minute; ambiguous POST failures retain their reserved quota slot.
            queue.attempts.pop();
        }
        Some(Err(ApiError::RateLimited)) => {
            queue.next_send_ms = now.saturating_add(30 * 60 * 1000);
        }
        Some(Err(ApiError::NotFound | ApiError::Forbidden | ApiError::Unauthorized)) => {
            queue.next_send_ms = now.saturating_add(15 * 60 * 1000);
        }
        _ => {}
    }
    let _ = persist(box_path, queue).await;
}

async fn run(state: Arc<TonoState>) {
    let mut active_partition: Option<PathBuf> = None;
    let mut queue = Outbox::default();
    let mut last_signature = String::new();
    let mut last_capture = tokio::time::Instant::now() - SAMPLE_INTERVAL;
    let mut last_state = None;
    let mut was_enabled = true;
    let mut last_maintenance = tokio::time::Instant::now() - Duration::from_secs(3600);
    loop {
        tokio::select! { _ = tokio::time::sleep(Duration::from_secs(2)) => {}, _ = WAKE.notified() => {} }
        if state.audit().is_closed() {
            break;
        } // Quit preserves the durable queue; it is not opt-out.
        // Remember even a quick off/on toggle. It must not resurrect old account backlogs just
        // because the observer was awaiting an IPC/read/upload when the user opted out.
        if PURGE_REQUESTED.load(Ordering::Acquire) {
            let base = state.lock().await.catalog_dir.clone();
            let _ = tokio::task::spawn_blocking(move || outbox::maintenance(&base, now_ms(), true)).await;
            active_partition = None;
            queue = Outbox::default();
            last_signature.clear();
            last_state = None;
            PURGE_REQUESTED.store(false, Ordering::Release);
        }
        if !state.audit().enabled() || !state.audit().automatic_diagnostics_enabled() {
            if was_enabled {
                let base = state.lock().await.catalog_dir.clone();
                let _ = tokio::task::spawn_blocking(move || outbox::maintenance(&base, now_ms(), true)).await;
            }
            was_enabled = false;
            active_partition = None;
            queue = Outbox::default();
            last_signature.clear();
            last_state = None;
            continue;
        }
        was_enabled = true;
        let Some(ctx) = context(&state).await else {
            continue;
        };
        if last_maintenance.elapsed() >= Duration::from_secs(3600) {
            let base = ctx.base.clone();
            let _ = tokio::task::spawn_blocking(move || outbox::maintenance(&base, now_ms(), false)).await;
            last_maintenance = tokio::time::Instant::now();
        }
        let box_path = outbox::path(&ctx.base, &ctx.account_id);
        if active_partition.as_ref() != Some(&box_path) || queue.epoch != ctx.diagnostics_epoch {
            let read_path = box_path.clone();
            let loaded = tokio::task::spawn_blocking(move || Outbox::load(&read_path, now_ms())).await;
            let loaded = match loaded {
                Ok(Ok(loaded)) => loaded,
                // Strict replay rejected a damaged payload; don't upload it or permanently
                // disable future diagnostics. Replacement still uses the safe private writer.
                Ok(Err("queueInvalid")) => Outbox {
                    dropped: 1,
                    ..Outbox::default()
                },
                _ => continue,
            };
            queue = loaded;
            queue.apply_privacy_epoch(ctx.diagnostics_epoch);
            active_partition = Some(box_path.clone());
            last_signature.clear();
            last_state = None;
        }
        if matches!(ctx.phase, Phase::Connecting | Phase::Disconnecting) {
            continue;
        }
        let state_key = (ctx.auth_generation, ctx.generation, ctx.phase, ctx.failure);
        let incident =
            ctx.phase != Phase::Disconnected || ctx.failure || last_state.is_some_and(|previous| previous != state_key);
        if incident && (last_state != Some(state_key) || last_capture.elapsed() >= SAMPLE_INTERVAL) {
            last_state = Some(state_key);
            last_capture = tokio::time::Instant::now();
            let snapshot = match tokio::time::timeout(Duration::from_secs(8), capture(&state, &ctx)).await {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    // A hung local observer must not erase the App's already-recorded failure.
                    // Unknown Service/DNS data are absent, never fabricated as healthy/inactive.
                    let mut snapshot = app_snapshot(&ctx);
                    snapshot.flag(Key::CaptureTimedOut, true);
                    snapshot.flag(Key::CaptureConsistent, false);
                    Some(snapshot)
                }
            };
            if let Some(snapshot) = snapshot {
                let signature = snapshot.signature();
                if signature != last_signature && still_owned(&state, &ctx).await {
                    queue.push(snapshot);
                    if persist(&box_path, &queue).await {
                        last_signature = signature;
                    }
                }
            }
        }
        // Uses the ordinary protected API transport, including when replaying after recovery.
        // This task never opens a direct API endpoint exception under a committed lock.
        send(&state, &ctx, &mut queue, &box_path).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn automatic_channel_never_controls_connection_or_uploads_the_log_blob() {
        let source = include_str!("automatic_diagnostics.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap();
        for forbidden in [
            "stop_core(",
            "tunnel_died(",
            "verify_tun_data_plane",
            "mark_verified(",
            "release_kill_switch(",
            "get_clash_log_snapshot_by_service(",
            "upload_diagnostics_log_segment(",
            "set_endpoints(",
        ] {
            assert!(!source.contains(forbidden), "{forbidden}");
        }
        assert!(source.contains(".no_proxy()"));
        assert!(source.contains("reqwest::redirect::Policy::none()"));
        assert!(source.contains("still_owned(state, ctx).await"));
    }

    #[test]
    fn batch_uses_the_deployed_schema_and_preserves_each_snapshots_time_and_id() {
        let mut queue = Outbox::default();
        for at in [100, 200] {
            let mut s = Snapshot {
                at_ms: at,
                generation: 1,
                phase: Phase::Connected,
                node: "Los Angeles · Mesa".to_owned().try_into().ok(),
                app_source: None,
                service_source: None,
                facts: vec![],
                errors: vec![(Code::Closed, 2)],
                steps: vec![],
                failure_class: None,
            };
            s.class(Key::RemoteReachability, Code::NotObserved);
            queue.push(s);
        }
        let (report, count) = batch(&queue);
        assert_eq!(count, 2);
        assert_eq!((report.window_start_ms, report.window_end_ms), (100, 200));
        assert_eq!(report.events.len(), report.event_count as usize);
        assert!(report.events.iter().any(|e| e.ts == 100));
        assert!(report.events.iter().any(|e| e.ts == 200));
        let value = serde_json::to_value(&report).unwrap();
        for event in value["events"].as_array().unwrap() {
            for (key, value) in event.as_object().unwrap() {
                assert!(
                    [
                        "ts",
                        "kind",
                        "generation",
                        "reference",
                        "node",
                        "code",
                        "counter",
                        "live",
                        "outcome",
                        "action",
                        "mode",
                        "stage",
                        "elapsedMs"
                    ]
                    .contains(&key.as_str())
                );
                if let Some(text) = value.as_str() {
                    assert!(text.len() <= 500);
                }
            }
        }
        let text = serde_json::to_string(&report).unwrap();
        assert!(!text.contains("http"));
        assert!(text.contains("notObserved"));
        assert!(text.len() < 48 * 1024);
    }

    #[test]
    fn app_failure_keeps_typed_stage_timings_without_serializing_context_secrets() {
        let mut records = crate::tono::steps::initial_steps();
        crate::tono::steps::advance(&mut records, tono_core::connection::ConnectStage::PreparingService, 100);
        crate::tono::steps::fail_current(&mut records, 1234);
        let ctx = Context {
            diagnostics_epoch: 0,
            auth_generation: 1,
            account_id: "private-account".into(),
            base: PathBuf::from("private-directory"),
            generation: 2,
            phase: Phase::Disconnected,
            node: Some("Los Angeles · Mesa".into()),
            vps: Some(Ipv4Addr::new(192, 0, 2, 1)),
            controller: Some((1234, "private-credential".into())),
            home_configured: false,
            home_matches: true,
            requested_transport: tono_core::node::ExitTransport::Hysteria2Udp,
            applied_transport: Some(tono_core::node::ExitTransport::RealityTcp),
            failure: true,
            failure_class: Some(model::FailureClass::from_error(
                "TONO_SERVICE_NOT_RUNNING private-credential",
            )),
            steps: records.iter().filter_map(model::Step::from_record).collect(),
            elapsed_ms: Some(1334),
            retry_attempt: 1,
        };
        let mut snapshot = app_snapshot(&ctx);
        snapshot.at_ms = 1_789_063_800_000;
        snapshot.flag(Key::CaptureTimedOut, true);
        snapshot.flag(Key::CaptureConsistent, false);
        assert!(snapshot.valid());
        let report = snapshot.wire(0);
        let text = serde_json::to_string(&report).unwrap();
        for private in [
            "private-account",
            "private-directory",
            "private-credential",
            "192.0.2.1",
        ] {
            assert!(!text.contains(private));
        }
        assert!(text.contains("serviceUnavailable"));
        assert!(report.events.iter().any(|e| e.code.as_deref() == Some("requestedTransport") && e.outcome.as_deref() == Some("hysteria2Udp")));
        assert!(report.events.iter().any(|e| e.code.as_deref() == Some("appliedTransport") && e.outcome.as_deref() == Some("realityTcp")));
        assert!(text.contains("1334"));
        assert!(
            report
                .events
                .iter()
                .any(|e| e.stage.as_deref() == Some("preparingService")
                    && e.outcome.as_deref() == Some("failed")
                    && e.elapsed_ms == Some(1234))
        );
        // Synthetic contract fixture for the local backend's actual validator; never real data.
        if let Some(path) = std::env::var_os("TONO_AUTOMATIC_DIAGNOSTICS_TEST_FIXTURE") {
            std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        }
    }

    #[tokio::test]
    async fn controller_observation_uses_only_loopback_and_discards_flow_metadata() {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 4096];
                let n = socket.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request[..n]);
                assert!(request.contains("Bearer test-controller-secret"));
                let body = if request.starts_with("GET /proxies/") {
                    r#"{"now":"different node"}"#
                } else {
                    r#"{"uploadTotal":12,"downloadTotal":0,"connections":[{"metadata":{"host":"private.example","process":"private-process"}}]}"#
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let ctx = Context {
            diagnostics_epoch: 0,
            auth_generation: 1,
            account_id: "test-account".into(),
            base: PathBuf::new(),
            generation: 1,
            phase: Phase::Connected,
            node: Some("Los Angeles · Mesa".into()),
            vps: None,
            controller: Some((port, "test-controller-secret".into())),
            home_configured: false,
            home_matches: true,
            requested_transport: tono_core::node::ExitTransport::RealityTcp,
            applied_transport: None,
            failure: false,
            failure_class: None,
            steps: vec![],
            elapsed_ms: None,
            retry_attempt: 0,
        };
        let facts = controller_facts(&ctx).await;
        server.await.unwrap();
        assert!(
            facts
                .iter()
                .any(|f| f.key == Key::SelectorMatches && f.value == model::Value::Flag(false))
        );
        let text = serde_json::to_string(&facts).unwrap();
        for private in ["private.example", "private-process", "test-controller-secret"] {
            assert!(!text.contains(private));
        }
    }
}
