//! One connect attempt: admission, service checks, stages, and the failure evidence it keeps.

use super::*;

/// Stable frontend mapping for the strict browser-owned DNS proof required by a residential
/// Claude route. Detail after the prefix is deliberately limited to controlled enum text.
#[cfg(windows)]
const BROWSER_DNS_PREFLIGHT_PREFIX: &str = "TONO_BROWSER_DNS_PREFLIGHT";

/// `attempt` returns a boxed future rather than being an `async fn`: the
/// network monitor and the reconnect loop re-enter it, and a concrete return
/// type keeps the async opaque-type graph finite.
type BoxedAttempt<'a> = std::pin::Pin<Box<dyn std::future::Future<Output = Attempt> + Send + 'a>>;

/// Outcome of one connect attempt, distinguishing "never started" from
/// "started and failed" — only the latter runs the failure decision table.
pub(super) enum Attempt {
    Connected,
    /// Guards rejected the attempt before any state changed (busy, no
    /// selection, suspended). No failure handling applies.
    GuardRejected(String),
    /// The transaction ran (or reached the service checks) and failed.
    Failed { generation: u64, error: String, account_owner: (u64, u64) },
    /// The connect generation moved under us (disconnect / sign-out / node
    /// switch / catalog teardown), or selection changed before admission.
    /// Exit without touching the FSM, the core, or the UI: the superseding
    /// transition owns any required cleanup.
    Stale,
}

/// One full connect attempt: guards → service checks → begin → stages.
/// Returns a boxed future (see [`BoxedAttempt`]); call sites `await` it as
/// before.
pub(super) fn attempt_for_generation<'a>(state: &'a Arc<TonoState>, app: &'a AppHandle, expected_generation: Option<u64>) -> BoxedAttempt<'a> {
    Box::pin(attempt_inner(state, app, expected_generation))
}

/// A new attempt has not committed an overlay. `applied_wechat_path_regexes == None`
/// is the inactive latch: the two-minute path refresh must not reconnect a full tunnel.
pub(super) fn clear_uncommitted_direct_overlay(inner: &mut TonoInner) {
    inner.optional_direct_active = false;
    inner.applied_direct_interface = None;
    inner.optional_direct_skip = None;
    inner.direct_reload_until = None;
    inner.applied_wechat_path_regexes = None;
}

/// The caller holds lifecycle admission and the state mutex. Idle is not an ownership token:
/// every admitted retry gets a fresh epoch so a completed failure tail cannot act on its state.
pub(crate) async fn begin_attempt(
    inner: &mut TonoInner, generation: u64,
) -> Option<(u64, CancellationToken, (u64, u64))> {
    // Capture under the same account lock as adoption, before any admission mutation:
    // cancellation while awaiting the API mutex must not leave an orphan Connecting latch.
    // Replacement login need not retire Core; its identity must never relabel this attempt.
    let account_owner = (inner.sign_in_generation, inner.client.diagnostics_log_identity().await);
    if inner.account_close.is_some()
        || inner.fsm.status().is_disconnecting
        || !single_flight_begin(&mut inner.fsm, inner.connect_generation, generation)
    {
        return None;
    }
    // Abort-free: the registered reconnect/switch task may itself be admitting this attempt.
    inner.retire_connection_generation(false);
    Some((inner.connect_generation, inner.connect_cancellation.clone(), account_owner))
}

pub(super) fn selection_still_current(captured: Option<&str>, current: Option<&str>) -> bool {
    captured == current
}

async fn attempt_inner(state: &Arc<TonoState>, app: &AppHandle, expected_generation: Option<u64>) -> Attempt {
    // Admission is a lifecycle mutation too: failure may have made the FSM idle while its
    // detached cleanup still owns the Core. Do not reuse that idle window or its generation.
    let admission = state.begin_connect_mutation().await;
    let (node, nodes, routing, generation, _, selected_node) = match guard_snapshot(state).await {
        Ok(snapshot) => snapshot,
        Err(err) => return Attempt::GuardRejected(err),
    };
    // A recovery task cannot adopt a new generation between its final check and admission.
    // The existing single-flight check below covers a bump after this snapshot.
    if expected_generation.is_some_and(|expected| expected != generation) {
        return Attempt::Stale;
    }
    // Recovery only, and only while protection is down: one TCP fail-fast so
    // the next tunnel is not installed on a node that just refused. The first
    // connect does not wait here.
    let node = heal::refine_before_arm(state, node).await;
    // L5: the clock starts at the top of the attempt, so even a
    // service-readiness failure leaves no orphan ConnectFail.
    let started = std::time::Instant::now();
    // F5 single-flight, latched BEFORE any service I/O: rapid repeated
    // clicks admit exactly one attempt to the service probe; the rest exit
    // here with no side effects (the real-machine double-probe this kills).
    let (attempt_record, generation, cancellation, account_owner, route_owner) = {
        let mut inner = state.lock().await;
        // The recovery TCP wait leaves the FSM idle, so a new selection may not bump the
        // generation. Check the user's preference, not the healer's possible backup dial.
        if !selection_still_current(selected_node.as_deref(), inner.selected_node.as_deref()) {
            return Attempt::Stale;
        }
        let Some((admitted_generation, cancellation, account_owner)) = begin_attempt(&mut inner, generation).await else {
            if inner.connect_generation != generation {
                return Attempt::Stale;
            }
            return Attempt::GuardRejected(TRANSITION_IN_FLIGHT_REJECTION.to_string());
        };
        // A disconnected-only endpoint batch cannot overlap WFP/Core startup. Cancel it in the
        // same critical section that atomically moves the FSM to Connecting, leaving no new-test
        // admission window between the two operations.
        inner.cancel_server_tests();
        // F3: a fresh attempt resets the step record and clears the last
        // failure details (retry bookkeeping persists across attempts).
        inner.connect_steps = crate::tono::steps::initial_steps();
        inner.step_started_at = Some(started);
        // A new attempt has not reached ConnectOk. Drop the previous session
        // clock so disconnect-while-Connecting cannot report elapsedMs from a
        // dead session (connected → drop → failed reconnect → new connect).
        clear_connected_at(&mut inner.connected_at);
        inner.failed_stage = None;
        inner.connect_error = None;
        inner.connect_error_at_ms = None;
        inner.next_retry_at_ms = None;
        clear_uncommitted_direct_overlay(&mut inner);
        commands::emit_status(app, &commands::status_of(&inner));
        let revision = inner.catalog_tracker.current_revision();
        let name = crate::tono::diagnostics::scrub_text_with(
            &node.name,
            &[
                node.uuid.clone(),
                node.reality_public_key.clone(),
                node.reality_short_id.clone(),
                node.server.to_string(),
            ],
        );
        let record = inner.attempt_history.begin(
            commands::epoch_millis(),
            name,
            node.catalog_transport(),
            revision,
        );
        let route_owner = crate::tono::route_preferences::PreferenceContext::capture(&inner);
        // A17: under the admission lock, before this attempt can publish Connected.
        inner.hy2_switch.note_admitted(&node);
        (record, admitted_generation, cancellation, account_owner, route_owner)
    };
    drop(admission);
    let transaction = ConnectTransaction::new(cancellation);

    state.audit().log(AuditEvent::ConnectBegin {
        node: node.name.clone(),
        transport: node.catalog_transport(),
    });

    // A17: the node this attempt really dials; a withdrawn automatic hop falls back below.
    let mut dialed = node.name.clone();
    let outcome = async {
        // A residential Web guarantee requires Mihomo to see protected hostnames. Browser-owned DoH
        // (and ECH layered on it) can hide that identity, so prove Chrome/Edge's effective managed +
        // local configuration before starting the Service or changing WFP. Ordinary Tono protection
        // intentionally remains available when the catalog has no residential Claude route.
        #[cfg(windows)]
        if routing
            .as_ref()
            .is_some_and(|routing| routing.home_socks5.is_some() || routing.home_proxy.is_some())
        {
            match transaction
                .wait(
                    "browser Secure DNS preflight",
                    crate::tono::browser_dns::verify_residential_browser_dns(),
                )
                .await
            {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    return Attempt::Failed { generation, error: format!("{BROWSER_DNS_PREFLIGHT_PREFIX}: {error}"), account_owner };
                }
                Err(failure) => {
                    return attempt_from_stage_failure(state, generation, &attempt_record, failure, account_owner)
                        .await;
                }
            }
        }

        let proof = unarmed_probe::tcp_proof_before_tunnel(state, &node);
        let service = transaction.wait("service readiness", ready_service_and_prefetch(state));
        let (proof, service) = tokio::join!(proof, service);
        let prefetched = match service {
            Ok(Ok(prefetched)) => prefetched,
            Ok(Err(err)) => {
                // The kill switch may already be armed from a previous session, so this is a
                // transaction failure, not a guard rejection. `fail_connect` runs the decision
                // table and (pre-arm) releases the FSM cleanly.
                return Attempt::Failed { generation, error: err, account_owner };
            }
            Err(failure) => {
                return attempt_from_stage_failure(state, generation, &attempt_record, failure, account_owner)
                    .await;
            }
        };
        if let Err(error) = proof {
            return Attempt::Failed { generation, error, account_owner };
        }

        // A17: the grant may have been withdrawn while this attempt waited. Re-check an
        // automatic hy2 hop right before the tunnel starts; if it no longer holds, dial the
        // selected Reality block instead (with its own pre-tunnel TCP proof).
        let fallback = match heal::recheck_auto_hop(state, selected_node.as_deref(), &node).await {
            Ok(fallback) => fallback,
            Err(error) => return Attempt::Failed { generation, error, account_owner },
        };
        if let Some(reality) = &fallback {
            dialed = reality.name.clone();
            if let Err(error) = unarmed_probe::tcp_proof_before_tunnel(state, reality).await {
                return Attempt::Failed { generation, error, account_owner };
            }
        }
        let stage_node = fallback.as_ref().unwrap_or(&node);
        match run_stages(
            state,
            app,
            stage_node,
            &nodes,
            routing.as_ref(),
            generation,
            started,
            &transaction,
            route_owner.as_ref(),
            prefetched,
        )
        .await
        {
            Ok(()) => {
                // Only after the stages armed the barrier, and only a leftover
                // naming Tono's own listeners: another product's proxy stays.
                #[cfg(windows)]
                {
                    let _ = crate::core::sysopt::Sysopt::global().clear_owned_sysproxy().await;
                }
                Attempt::Connected
            }
            Err(failure) => {
                attempt_from_stage_failure(state, generation, &attempt_record, failure, account_owner).await
            }
        }
    }
    .await;
    // A17: count a TCP failure of the selected node, or settle its automatic hy2 hop.
    heal::note_hy2_outcome(state, selected_node.as_deref(), &dialed, (account_owner.0, generation), &outcome).await;
    if let Attempt::Failed { error, .. } = &outcome {
        retain_attempt_failure(state, generation, &attempt_record, error).await;
    }
    // Past connectBegin, Stale means a Disconnect, Quit, sign-out or update stopped this
    // attempt (or superseded a timed-out one). Record it as the deliberate stop it is; a
    // begin with no outcome row otherwise reads like a crash in connection_events.
    if matches!(outcome, Attempt::Stale) {
        state.audit().log(AuditEvent::ConnectCancel {
            stage: transaction.last_stage(),
            elapsed_ms: started.elapsed().as_millis() as u64,
            node: node.name.clone(),
            transport: node.catalog_transport(),
        });
    }
    outcome
}

pub(super) async fn retain_attempt_failure(
    state: &Arc<TonoState>,
    generation: u64,
    attempt_record: &crate::tono::local_evidence::ConnectionAttempt,
    error: &str,
) {
    let annotated = tono_core::hy2_idle::annotate(error);
    let error = annotated.as_ref();
    let mut inner = state.lock().await;
    // Timeouts capture before retiring their generation. Superseded attempts must
    // not read another transition's steps or overwrite its evidence.
    if inner.connect_generation == generation {
        let mut steps = inner.connect_steps.clone();
        let elapsed = inner
            .step_started_at
            .map(|at| at.elapsed().as_millis() as u64)
            .unwrap_or(0);
        crate::tono::steps::fail_current(&mut steps, elapsed);
        let failed = crate::tono::local_evidence::FailedAttempt {
            attempt: attempt_record.clone(),
            connection_generation: generation,
            failed_at_ms: commands::epoch_millis(),
            failed_stage: inner.fsm.status().stage.map(commands::stage_key),
            error_code: failure::stable_error_code(error).map(str::to_owned),
            error_detail: crate::tono::diagnostics::scrub_text_with(
                error, &crate::tono::diagnostics::known_secrets(&inner),
            ),
            probe_outcomes: attempt_record.probe_outcomes.lock().map(|outcomes| outcomes.clone()).unwrap_or_default(),
            steps: steps
                .iter()
                .map(|step| tono_core::auth::DiagnosticsStep {
                    key: step.key.to_owned(),
                    state: crate::tono::steps::state_key(step.state).to_owned(),
                    elapsed_ms: step.elapsed_ms,
                })
                .collect(),
        };
        inner.attempt_history.retain(failed);
    }
}

pub(super) async fn attempt_from_stage_failure(
    state: &Arc<TonoState>,
    generation: u64,
    attempt_record: &crate::tono::local_evidence::ConnectionAttempt,
    failure: StageFailure,
    account_owner: (u64, u64),
) -> Attempt {
    match failure {
        StageFailure::Stale => Attempt::Stale,
        StageFailure::TimedOut(error) => {
            retain_attempt_failure(state, generation, attempt_record, &error).await;
            match retire_timed_out_generation(state, generation).await {
                Some(generation) => Attempt::Failed { generation, error, account_owner },
                None => Attempt::Stale,
            }
        }
        StageFailure::Error(error) => Attempt::Failed { generation, error, account_owner },
    }
}
