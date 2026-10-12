//! The connect failure decision table and its recorded evidence.

use super::*;

/// The failure decision table, executing [`plan_failure`]. A verified barrier
/// with an explicit strict kill switch keeps blocking. A ready selective
/// AI-block hook releases general traffic and must not full-release. Every
/// other exhausted attempt full-releases. A raced disconnect does nothing.
pub(super) async fn fail_connect(
    state: &Arc<TonoState>, app: &AppHandle, generation: u64, err: String, account_owner: (u64, u64),
) -> bool {
    // H21-O-F7: name another VPN when one is up and the failure is network/TUN class. A read-only
    // adapter read with no lock held; it changes nothing the failure plan below decides. The hy2
    // idle code goes on first so that more specific cause keeps its own sentence.
    let err = {
        let adapters = crate::tono::other_vpn::adapters().await;
        tono_core::other_vpn::annotate(&tono_core::hy2_idle::annotate(&err), &adapters).into_owned()
    };
    {
        let inner = state.lock().await;
        inner.client.transport().set_auth_tunnel_port(0);
    }
    let task_state = Arc::clone(state);
    let task_app = app.clone();
    match cleanup::reconcile_failure(
        Arc::clone(state),
        generation,
        async { service::tono_kill_switch_status().await.ok() },
        move |observed, guard| async move {
            fail_connect_observed(&task_state, &task_app, generation, err, observed, guard, account_owner).await
        },
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
        // No Windows preference on this path means the user did not explicitly
        // enable a strict kill switch, so an exhausted attempt releases.
        let strict_kill_switch = tono_core::strict_kill_switch_explicit(None);
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
