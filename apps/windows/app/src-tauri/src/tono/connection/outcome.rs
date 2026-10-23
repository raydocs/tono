//! The connect failure decision table and its recorded evidence.

use super::*;

/// The failure decision table, executing [`plan_failure`]. A verified barrier
/// with an explicit strict kill switch keeps blocking. A ready selective
/// AI-block hook releases general traffic and must not full-release. Every
/// other exhausted attempt full-releases. A raced disconnect does nothing.
pub(super) async fn fail_connect(
    state: &Arc<TonoState>, app: &AppHandle, generation: u64, err: String, account_owner: (u64, u64),
) -> bool {
    let task_state = Arc::clone(state);
    let task_app = app.clone();
    fail_connect_with(
        state, generation, err,
        crate::tono::other_vpn::adapters(),
        async { service::tono_kill_switch_status_as_caller().await.ok() },
        move |err, observed, guard| async move {
            fail_connect_observed(&task_state, &task_app, generation, err, observed, guard, account_owner).await
        },
    ).await
}

/// The real failure entry with only OS attribution and Service boundaries injected. The auth
/// port mutation and lifecycle reconciliation stay here, including in deterministic tests.
async fn fail_connect_with<A, S, F, C>(
    state: &Arc<TonoState>, generation: u64, err: String, adapters: A, status: S, cleanup: C,
) -> bool
where
    A: std::future::Future<Output = Vec<tono_core::other_vpn::NetworkAdapter>>,
    S: std::future::Future<Output = Option<KillSwitchStatus>> + Send + 'static,
    F: std::future::Future<Output = bool> + Send + 'static,
    C: FnOnce(String, Option<KillSwitchStatus>, tokio::sync::OwnedRwLockWriteGuard<()>) -> F
        + Send + 'static,
{
    // H21-O-F7: name another VPN when one is up and the failure is network/TUN class. A read-only
    // adapter read with no lock held; it changes nothing the failure plan below decides. The hy2
    // idle code goes on first so that more specific cause keeps its own sentence.
    let err = {
        let adapters = adapters.await;
        tono_core::other_vpn::annotate(&tono_core::hy2_idle::annotate(&err), &adapters).into_owned()
    };
    {
        let inner = state.lock().await;
        inner.client.transport().set_auth_tunnel_port(0);
    }
    match cleanup::reconcile_failure(
        Arc::clone(state), generation, status,
        move |observed, guard| cleanup(err, observed, guard),
    ).await {
        Ok(current) => current,
        Err(error) => {
            logging!(error, Type::Service, "Tono: failure reconciliation worker failed; keeping protection: {error}");
            false
        }
    }
}

async fn fail_connect_observed(
    state: &Arc<TonoState>, app: &AppHandle, generation: u64, err: String,
    observed: Option<KillSwitchStatus>, guard: tokio::sync::OwnedRwLockWriteGuard<()>,
    account_owner: (u64, u64),
) -> bool {
    let Some(RecordedFailure { plan, armed, report: _report }) =
        record_connect_failure(state, generation, &err, observed, account_owner).await
    else {
        return false;
    };
    let mut guard = Some(guard);
    let release_result = if plan.selective_ai_hold {
        // The hook already rewrote filters so general traffic flows and
        // AI-service destinations stay blocked. `release_explicit` would
        // remove that hold.
        None
    } else if plan.stop_core == Some(true) && armed {
        // Register the real release before transferring this writer. If Disconnect already
        // registered its worker, the coordinator drops our writer and joins that actual result.
        Some(disconnect::release_explicit_applying_narrow_with_guard(state, app, guard.take()).await)
    } else {
        if let Some(release) = plan.stop_core {
            let _ = service::tono_stop_core(release).await;
        }
        if plan.restrict_bootstrap {
            let _ = service::tono_restrict_bootstrap().await;
        }
        None
    };

    let mut inner = state.lock().await;
    if inner.connect_generation != generation {
        return false;
    }
    if let Some(result) = release_result {
        match result {
            Ok(()) => {
                inner.fsm.connect_failed();
                // Armed, and this release opened the network. That is fail-open:
                // protection had the host and then let go. The audit hook queues
                // TONO_FAIL_OPEN for the next upload.
                state.audit().log(AuditEvent::ProtectedOffline { reason: "failOpen" });
            }
            Err(release_error) => {
                inner.fsm.initial_release_failed();
                inner.connect_error = Some(crate::tono::audit::redact(&format!("{err}; {release_error}")));
            }
        }
    }
    commands::emit_status(app, &commands::status_of(&inner));
    // R2-F2: a failure outcome that keeps the machine armed now sits idle in Protected
    // Offline (verified or not). Register the Service-truth poll: the connected monitor only
    // runs while `is_connected`, and a Service restart can retire an unverified barrier with
    // nothing else ever re-reading that verdict.
    monitor::ensure_protection_resync_locked(&mut inner, || monitor::spawn_protection_resync(state, app));
    true
}

pub(super) struct RecordedFailure {
    pub(super) plan: FailurePlan,
    armed: bool,
    /// Detached in production; tests may join the actual HTTP boundary without timing sleeps.
    pub(super) report: Option<tauri::async_runtime::JoinHandle<()>>,
}

/// Commit the observed failure and its evidence before applying the privileged cleanup plan.
pub(super) async fn record_connect_failure(
    state: &Arc<TonoState>, generation: u64, err: &str, observed: Option<KillSwitchStatus>,
    account_owner: (u64, u64),
) -> Option<RecordedFailure> {
    let annotated = tono_core::hy2_idle::annotate(err);
    let err = annotated.as_ref();
    logging!(error, Type::Service, "Tono: 连接事务失败: {err}");
    let (plan, armed, report) = {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            return None;
        }
        if let Some(status) = &observed {
            inner.kill_switch = Some(status.clone());
        }
        let stage = inner.fsm.status().stage;
        let armed = observed
            .as_ref()
            .map(|status| status.wanted)
            .unwrap_or(inner.fsm.kill_switch_armed());
        let was_disconnecting = inner.fsm.status().is_disconnecting;
        let session_verified = observed
            .as_ref()
            .map(|status| status.verified)
            .unwrap_or(inner.fsm.session_verified());
        if session_verified {
            inner.fsm.mark_session_verified();
        }
        let strict_kill_switch = inner.three_tier_routing;
        let plan = plan_failure(armed, session_verified, was_disconnecting, strict_kill_switch);
        let action: &'static str = if was_disconnecting {
            "racedDisconnect"
        } else if plan.selective_ai_hold {
            "selectiveAiHold"
        } else if plan.stop_core == Some(false) {
            "keepBlockingAndReconnect"
        } else {
            "fullRelease"
        };
        if plan.mark_armed {
            inner.fsm.mark_kill_switch_armed();
        } else if armed && !session_verified && !was_disconnecting {
            // Keep reality visible until the required full release actually succeeds.
            inner.fsm.mark_kill_switch_armed();
            // ...and stop claiming Connecting while it runs. The predicate below deliberately
            // skips `connect_failed` in this case (it would resolve to FullRelease and disarm
            // before the release had actually run), which left `is_connecting` true alongside
            // `is_protection_blocked` for the whole of `release_explicit` — a full
            // `EXPLICIT_RELEASE_TIMEOUT` of a UI reading "Connecting" with no transaction in
            // flight, during which `guard_snapshot`
            // rejected every new connect. This is the state both exit branches below converge
            // on anyway, minus the release verdict.
            inner.fsm.initial_release_failed();
        }
        if !was_disconnecting && (session_verified || !armed) {
            // Drives the FSM to Protected Offline (armed) or releases it
            // (pre-arm), mirroring the plan.
            inner.fsm.connect_failed();
        }
        inner.controller_secret = None;
        inner.controller_port = None;
        // F3: the in-flight step is failed (never completed); the error is
        // sanitized before it is stored for the UI.
        let step_elapsed = inner
            .step_started_at
            .map(|at| at.elapsed().as_millis() as u64)
            .unwrap_or(0);
        crate::tono::steps::fail_current(&mut inner.connect_steps, step_elapsed);
        inner.failed_stage = stage.map(commands::stage_key);
        inner.connect_error = Some(crate::tono::audit::redact(&err));
        inner.connect_error_at_ms = Some(commands::epoch_millis());
        if plan.mark_armed {
            inner.retry_attempt += 1;
        }
        let node = inner.selected_node.clone();
        let transport = inner
            .selected_node
            .as_deref()
            .map(tono_core::catalog_transport_of_name);
        // Network cleanup still belongs to this connection generation. Account-scoped
        // evidence does not: a replacement sign-in must not inherit the old failure via
        // either immediate telemetry or the audit log. Keep this check and log enqueue
        // under the adoption lock; the detached HTTP task also retains the captured owner.
        let report = if inner.sign_in_generation == account_owner.0
            && inner.client.diagnostics_log_identity().await == account_owner.1
        {
            let code = failure::stable_error_code(err).map(str::to_owned);
            state.audit().log(AuditEvent::ConnectFail {
                stage: stage.map(commands::stage_key),
                error: err.to_owned(),
                action,
                transport,
                code: code.clone(),
                node: node.clone(),
            });
            let report = crate::tono::telemetry::spawn_connect_failure_report(
                state, account_owner, stage.map(commands::stage_key), err, node, transport, code.as_deref(),
            );
            if plan.mark_armed {
                state.audit().log(AuditEvent::ProtectedOffline { reason: "connectFail" });
            }
            report
        } else {
            None
        };
        (plan, armed, report)
    };
    Some(RecordedFailure { plan, armed, report })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tono::{state::TonoApiClient, transport::TonoTransport};
    use std::sync::atomic::{AtomicBool, Ordering};
    use tono_core::auth::{ApiRequest, HttpMethod, HttpTransport as _};
    use tokio::{io::{AsyncReadExt as _, AsyncWriteExt as _}, sync::oneshot, time::timeout};

    #[tokio::test]
    async fn late_failure_keeps_successor_auth_tunnel_port() {
        // Accept and drain each direct/alternate request, then send EOF without an HTTP
        // response. A GET retries this real transport error; no OS SYN/refusal timing, DNS,
        // public endpoint, TLS exception, or alternate successful response is involved.
        async fn reject_requests(listener: tokio::net::TcpListener, mut stopped: oneshot::Receiver<()>) {
            loop {
                let (mut stream, _) = tokio::select! {
                    accepted = listener.accept() => accepted.unwrap(),
                    _ = &mut stopped => return,
                };
                let mut header = Vec::new();
                while !header.ends_with(b"\r\n\r\n") {
                    header.push(stream.read_u8().await.unwrap());
                    assert!(header.len() < 8192);
                }
                stream.shutdown().await.unwrap();
            }
        }
        let direct = tokio::net::TcpListener::bind("127.0.0.2:0").await.unwrap();
        let address = direct.local_addr().unwrap();
        let mut endpoints = vec![direct];
        for port in tono_service_protocol::CONTROL_PLANE_PORTS {
            // The production alternate walk skips 443.
            if port != 443 {
                let alternate = std::net::SocketAddr::from(([127, 0, 0, 2], port));
                endpoints.push(tokio::net::TcpListener::bind(alternate).await.unwrap());
            }
        }
        let rejectors: Vec<_> = endpoints.into_iter().map(|listener| {
            let (stop, stopped) = oneshot::channel();
            (stop, tokio::spawn(reject_requests(listener, stopped)))
        }).collect();
        let proxy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mixed_port = proxy.local_addr().unwrap().port();
        let state = Arc::new(TonoState::for_test());
        let (generation_a, _, account_a) = {
            let mut inner = state.lock().await;
            inner.client = Arc::new(TonoApiClient::new(
                "https://127.0.0.2", TonoTransport::with_clients_and_relays(
                    "127.0.0.2", &[address], &[address], &[],
                ).unwrap(), inner.credentials.clone(),
            ).unwrap());
            super::super::begin_attempt(&mut inner, 0).await.unwrap()
        };
        let (entered, at_adapters) = oneshot::channel();
        let (resume, resumed) = oneshot::channel();
        let status_entered = Arc::new(AtomicBool::new(false));
        let cleanup_entered = Arc::new(AtomicBool::new(false));
        let status_observed = Arc::clone(&status_entered);
        let cleanup_observed = Arc::clone(&cleanup_entered);
        let task_state = Arc::clone(&state);
        let failure_a = tokio::spawn(async move {
            fail_connect_with(
                &task_state, generation_a, "CORE_EXIT_UNREACHABLE: attempt A".into(),
                async move {
                    entered.send(()).unwrap();
                    resumed.await.unwrap();
                    Vec::new()
                },
                async move {
                    status_observed.store(true, Ordering::SeqCst);
                    panic!("stale A must not query privileged Service status")
                },
                move |_, _, _| {
                    cleanup_observed.store(true, Ordering::SeqCst);
                    async { panic!("stale A must not enter privileged cleanup") }
                },
            ).await
        });
        timeout(Duration::from_secs(5), at_adapters).await.unwrap().unwrap();
        let (generation_b, account_b, client) = {
            // Retire A as Disconnect does, then admit and publish B under the same lifecycle
            // admission/state locks as production. A is held at the actual pre-reconcile await.
            let _admission = state.begin_connect_mutation().await;
            let mut inner = state.lock().await;
            inner.invalidate_connection(true);
            inner.fsm.sign_out_or_quit();
            let current = inner.connect_generation;
            let (generation, _, owner) = super::super::begin_attempt(&mut inner, current).await.unwrap();
            inner.client.transport().set_auth_tunnel_port(mixed_port);
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            // Keep the current-generation control on the strict failure branch, with no AI hook.
            inner.three_tier_routing = true;
            inner.controller_secret = Some("session-B".into());
            inner.controller_port = Some(19091);
            (generation, owner, Arc::clone(&inner.client))
        };
        assert_ne!(generation_a, generation_b);
        assert_eq!(account_a, account_b);
        resume.send(()).unwrap();
        assert!(!timeout(Duration::from_secs(5), failure_a).await.unwrap().unwrap(),
            "A must return stale without running privileged cleanup");
        // reconcile_failure's inner spawn maps panic to JoinError, then false. Observe entry
        // independently after it has joined, so a swallowed panic cannot satisfy this oracle.
        assert!(!status_entered.load(Ordering::SeqCst), "stale A entered Service status");
        assert!(!cleanup_entered.load(Ordering::SeqCst), "stale A entered privileged cleanup");
        {
            let inner = state.lock().await;
            assert_eq!(inner.connect_generation, generation_b);
            assert!(inner.fsm.status().is_connected);
            assert!(inner.fsm.kill_switch_armed());
            assert!(inner.fsm.session_verified());
            assert_eq!(inner.controller_secret.as_deref(), Some("session-B"));
            assert_eq!(inner.controller_port, Some(19091));
            assert!(inner.connect_error.is_none());
        }
        // Observe the actual shared port, not a parallel test counter: the production transport
        // must reach this exact loopback listener and send its authenticated Tunnel request.
        let server = tokio::spawn(async move {
            let (mut stream, _) = proxy.accept().await.unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                header.push(stream.read_u8().await.unwrap());
                assert!(header.len() < 8192);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\ntunnel-B").await.unwrap();
            (proxy, String::from_utf8(header).unwrap().to_ascii_lowercase())
        });
        let request = ApiRequest {
            method: HttpMethod::Get,
            url: format!("http://{address}/api/v1/me"),
            bearer: Some("fixture-access-B".into()),
            json_body: None, binary_body: None, headers: Vec::new(),
        };
        let response = timeout(Duration::from_secs(10), client.transport().send(request.clone())).await
            .expect("loopback rejection/fallback fixture must finish before the behavioral assertion");
        assert!(response.is_ok(), "stale A cleared B's authenticated tunnel fallback port: {response:?}");
        assert_eq!(response.unwrap().body, b"tunnel-B");
        let (proxy, header) = timeout(Duration::from_secs(5), server).await.unwrap().unwrap();
        assert!(header.contains("x-tono-path: tunnel\r\n"));
        assert!(header.contains("authorization: bearer fixture-access-b\r\n"));

        // A current failure must still clear the same real fallback port. Only its privileged
        // continuation is replaced; record_connect_failure performs the production owned commit.
        let control_state = Arc::clone(&state);
        assert!(fail_connect_with(
            &state, generation_b, "CORE_EXIT_UNREACHABLE: current B".into(),
            async { Vec::new() }, async { None },
            move |err, observed, _guard| async move {
                let recorded = record_connect_failure(&control_state, generation_b, &err, observed, account_b)
                    .await.unwrap();
                assert_eq!(recorded.plan.stop_core, Some(false));
                true
            },
        ).await);
        assert!(timeout(Duration::from_secs(10), client.transport().send(request)).await
            .expect("loopback rejection fixture must finish for the current-generation control").is_err(),
            "a current failure must retire its authenticated tunnel fallback port");
        let incoming = proxy.accept();
        tokio::pin!(incoming);
        assert!(futures::poll!(&mut incoming).is_pending(), "current failure left its tunnel port published");
        for (stop, task) in rejectors {
            stop.send(()).unwrap();
            timeout(Duration::from_secs(5), task).await.unwrap().unwrap();
        }
        let inner = state.lock().await;
        assert_eq!(inner.connect_generation, generation_b);
        assert!(!inner.fsm.status().is_connected);
        assert!(inner.fsm.kill_switch_armed());
    }
}
