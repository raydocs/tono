use super::*;
use crate::core::auth::ipc_request_context_to_auth_context;
use crate::core::macos_kill_switch;
use crate::core::status::service_status_snapshot;
use crate::core::windows_kill_switch;
use crate::core::structure::is_protected_startup_replacement_candidate;
use tracing::{info, trace, warn};

pub(super) fn create_ipc_router() -> Result<Router> {
    let router = Router::new()
        .get(IpcCommand::Magic.as_ref(), |ctx| async move {
            trace!("Received Magic command");
            ipc_request_context_to_auth_context(&ctx)?;
            Ok(HttpResponse::builder().text("Tunglies!").build())
        })
        .get(IpcCommand::GetVersion.as_ref(), |ctx| async move {
            ipc_request_context_to_auth_context(&ctx)?;
            ok_json(ProtocolInfo::current())
        })
        .get(IpcCommand::Status.as_ref(), |ctx| async move {
            trace!("Received Status command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // Authenticated diagnostics deliberately do not join the lifecycle writer queue.
            // The aggregate carries `active_operation` and uses committed/cached subsystem
            // snapshots when a mutation is in flight.
            match service_status_snapshot(&owner).await {
                Ok(status) => ok_json(status),
                Err(error) => {
                    service_unavailable(format!("Failed to collect service status: {}", error))
                }
            }
        })
        .get(IpcCommand::PreflightMacosKillSwitch.as_ref(), |ctx| async move {
            trace!("Received PreflightMacosKillSwitch command");
            let (_request, _owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            match macos_kill_switch::preflight().await {
                Ok(()) => ok_empty("macOS Kill Switch preflight passed"),
                Err(error) => service_unavailable(format!(
                    "macOS Kill Switch preflight failed: {error:#}"
                )),
            }
        })
        .get(IpcCommand::GetKillSwitchStatus.as_ref(), |ctx| async move {
            trace!("Received GetKillSwitchStatus command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // Status must remain readable while Start/Stop/DNS/WFP owns the lifecycle writer.
            let mut status = windows_kill_switch::status().await;
            // Whether the machine is protected is not a secret from the local users who share
            // it; which exit node it is protected *towards* is. The active-owner read is
            // deliberately lock-free, like the rest of this route, and mirrors what `/status`
            // already does with the core PID and uptime.
            if require_active_owner(&owner).await.is_err() {
                status.endpoints.clear();
            }
            ok_json(status)
        })
        .post(IpcCommand::LockKillSwitch.as_ref(), |ctx| local_timing::in_trace("lock_kill_switch", async move {
            trace!("Received LockKillSwitch command");
            let (request, owner) = match authenticate_request::<
                AuthenticatedSessionRequest<KillSwitchLockRequest>,
            >(&ctx)
            .await
            {
                ControlFlow::Continue(authenticated) => authenticated,
                ControlFlow::Break(response) => return response,
            };
            let _operation_guard =
                OperationGuard::begin(ServiceOperationKind::LockKillSwitch, IPC_HANDLER_TIMEOUT);
            let attempt = || async {
                // Release the lifecycle lock between checks: Disconnect can retire
                // the session while TUN is absent. Never reuse an earlier authorization.
                let _lifecycle_guard = local_timing::returned("lock.owner_lifecycle_queue", OWNER_LIFECYCLE_LOCK.lock()).await;
                require_active_session(&owner, &request.session).await?;
                local_timing::result("lock.native_attempt", windows_kill_switch::lock(request.payload.tunnel_interface.as_deref())).await
            };
            let result = if request.payload.wait_for_tun {
                local_timing::result("lock.tun_readiness_window", crate::core::readiness::lock_when_ready(attempt)).await
            } else { attempt().await };
            match result {
                Ok(()) => ok_empty("Kill switch locked"),
                Err(error) => service_unavailable(format!("Failed to lock kill switch: {error:#}")),
            }
        }))
        .post(IpcCommand::BeginDirectRuntimeReload.as_ref(), |ctx| async move {
            let (request, owner) =
                match authenticate_request::<AuthenticatedSessionRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let active = match require_active_session(&owner, &request.session).await {
                Ok(active) => active,
                Err(error) => return service_error(error),
            };
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::BeginDirectRuntimeReload,
                IPC_HANDLER_TIMEOUT,
            );
            match windows_kill_switch::begin_direct_runtime_reload(active.generation).await {
                Ok(result) => ok_json(result),
                Err(error) => service_unavailable(format!(
                    "Failed to begin DIRECT runtime reload: {error:#}"
                )),
            }
        })
        .post(IpcCommand::ReplaceDirectEndpoints.as_ref(), |ctx| async move {
            let (request, owner) = match authenticate_request::<
                AuthenticatedSessionRequest<ReplaceDirectEndpointsRequest>,
            >(&ctx)
            .await
            {
                ControlFlow::Continue(authenticated) => authenticated,
                ControlFlow::Break(response) => return response,
            };
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let active = match require_active_session(&owner, &request.session).await {
                Ok(active) => active,
                Err(error) => return service_error(error),
            };
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::ReplaceDirectEndpoints,
                IPC_HANDLER_TIMEOUT,
            );
            match windows_kill_switch::replace_direct_endpoints(
                &request.payload.direct_endpoints,
                &request.payload.reviewed_direct_ports,
                active.generation,
                request.payload.reload_id,
            )
            .await
            {
                Ok(result) => ok_json(result),
                Err(error) => service_unavailable(format!(
                    "Failed to replace DIRECT endpoints: {error:#}"
                )),
            }
        })
        .post(IpcCommand::ReplaceProxyEndpoints.as_ref(), |ctx| async move {
            let (request, owner) = match authenticate_request::<
                AuthenticatedSessionRequest<ReplaceProxyEndpointsRequest>,
            >(&ctx)
            .await
            {
                ControlFlow::Continue(authenticated) => authenticated,
                ControlFlow::Break(response) => return response,
            };
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let active = match require_active_session(&owner, &request.session).await {
                Ok(active) => active,
                Err(error) => return service_error(error),
            };
            let _ = active;
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::ReplaceProxyEndpoints,
                IPC_HANDLER_TIMEOUT,
            );
            match windows_kill_switch::replace_proxy_endpoints(&request.payload.proxy_endpoints)
                .await
            {
                Ok(()) => ok_json(()),
                Err(error) => service_unavailable(format!(
                    "Failed to replace proxy endpoints: {error:#}"
                )),
            }
        })
        .post(IpcCommand::FinalizeDirectRuntimeReload.as_ref(), |ctx| async move {
            let (request, owner) = match authenticate_request::<
                AuthenticatedSessionRequest<FinalizeDirectRuntimeReloadRequest>,
            >(&ctx)
            .await
            {
                ControlFlow::Continue(authenticated) => authenticated,
                ControlFlow::Break(response) => return response,
            };
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let active = match require_active_session(&owner, &request.session).await {
                Ok(active) => active,
                Err(error) => return service_error(error),
            };
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::FinalizeDirectRuntimeReload,
                IPC_HANDLER_TIMEOUT,
            );
            match windows_kill_switch::finalize_direct_runtime_reload(
                &request.payload.endpoint_digest,
                active.generation,
                request.payload.reload_id,
            )
            .await
            {
                Ok(result) => ok_json(result),
                Err(error) => service_unavailable(format!(
                    "Failed to finalize DIRECT runtime reload: {error:#}"
                )),
            }
        })
        .post(IpcCommand::RenewDirectRuntimeReload.as_ref(), |ctx| async move {
            let (request, owner) = match authenticate_request::<
                AuthenticatedSessionRequest<RenewDirectRuntimeReloadRequest>,
            >(&ctx)
            .await
            {
                ControlFlow::Continue(authenticated) => authenticated,
                ControlFlow::Break(response) => return response,
            };
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let active = match require_active_session(&owner, &request.session).await {
                Ok(active) => active,
                Err(error) => return service_error(error),
            };
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::RenewDirectRuntimeReload,
                IPC_HANDLER_TIMEOUT,
            );
            match windows_kill_switch::renew_direct_runtime_reload(
                &request.payload.endpoint_digest,
                active.generation,
                request.payload.reload_id,
            )
            .await
            {
                Ok(result) => ok_json(result),
                Err(error) => service_unavailable(format!(
                    "Failed to renew DIRECT runtime reload: {error:#}"
                )),
            }
        })
        .post(IpcCommand::MarkKillSwitchVerified.as_ref(), |ctx| async move {
            trace!("Received MarkKillSwitchVerified command");
            let (request, owner) =
                match authenticate_request::<AuthenticatedSessionRequest<Option<crate::ProtectionCommitRequest>>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::VerifyKillSwitch,
                IPC_HANDLER_TIMEOUT,
            );
            if let Some(expected) = request.payload.as_ref() {
                match windows_kill_switch::verify_and_commit(&owner.key, expected, request.session.generation).await {
                    Ok(proof) => ok_json(proof),
                    Err(error) => service_unavailable(format!("Fresh protection commit refused: {error:#}")),
                }
            } else {
                match windows_kill_switch::mark_verified(&owner.key).await {
                    Ok(()) => ok_empty("Kill switch session marked verified"),
                    Err(error) => service_unavailable(format!("Failed to mark kill switch session verified: {error:#}")),
                }
            }
        })
        .post(IpcCommand::RestrictKillSwitchBootstrap.as_ref(), |ctx| async move {
            trace!("Received RestrictKillSwitchBootstrap command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // Do not require the active-owner/session record: the disconnect path calls this
            // after a stop has already cleared that record. The separate armed-policy owner
            // gate still runs after taking the lifecycle lock; checking it before this await
            // would let a queued StartClash replace the owner in between.
            let _lifecycle_guard =
                match enter_owner_lifecycle(&owner, OwnerLifecycleGate::ArmedPolicyOwner).await {
                    ControlFlow::Continue(guard) => guard,
                    ControlFlow::Break(response) => return response,
                };
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::RestrictKillSwitch,
                IPC_HANDLER_TIMEOUT,
            );
            match windows_kill_switch::restrict_bootstrap().await {
                Ok(()) => ok_empty("Kill switch restricted to the bootstrap recovery channel"),
                Err(error) => {
                    service_unavailable(format!("Failed to restrict kill switch: {error:#}"))
                }
            }
        })
        .post(IpcCommand::ReleaseKillSwitch.as_ref(), |ctx| async move {
            trace!("Received ReleaseKillSwitch command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // Do not require the active-owner/session record: a successful stop clears the
            // record and invalidates the session, so that gate would make explicit Disconnect/
            // Sign-Out unreachable from Protected Offline. The separate armed-policy owner
            // gate runs under the lifecycle lock so it cannot go stale while queued.
            let _lifecycle_guard =
                match enter_owner_lifecycle(&owner, OwnerLifecycleGate::ArmedPolicyOwner).await {
                    ControlFlow::Continue(guard) => guard,
                    ControlFlow::Break(response) => return response,
                };
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::ReleaseKillSwitch,
                IPC_HANDLER_TIMEOUT,
            );
            #[cfg(windows)]
            {
                // Make the owner-gated release a complete last-resort Disconnect. The App may
                // have lost the StartClash response and therefore have no session proof with
                // which to stop a Core that did start. Restore DNS first; then stop and retire
                // this owner's Core before disarming WFP. Any uncertainty stays fail-closed: a
                // Core that survived (or whose durable desired state was not retired) could use
                // the physical route directly after WFP is removed.
                if let Err(error) = dns::ensure_restored().await {
                    return service_unavailable(format!(
                        "Kill switch release refused; DNS restore is unproven: {error:#}"
                    ));
                }
                match load_active_owner().await {
                    Ok(Some(active)) if active.owner_key == owner.key => {
                        if let Err(error) = rollback_started_owner(&owner).await {
                            return service_unavailable(format!(
                                "Kill switch release refused; the active Core could not be safely stopped and retired: {error:#}"
                            ));
                        }
                    }
                    Ok(Some(_)) => {
                        return service_unavailable(
                            "Kill switch release refused; active Core ownership does not match the protection owner",
                        );
                    }
                    Ok(None) => {}
                    Err(error) => {
                        // An unreadable ownership record proves nothing either way, and refusing
                        // on it is what leaves an armed machine with no way back: every retry
                        // reads the same broken file. The caller has already proved it owns the
                        // armed policy, so take the *stronger* of the two readable outcomes —
                        // stop and retire the Core unconditionally — and only then release. A
                        // record that is readable and names someone else is still refused above.
                        warn!(
                            "Active Core ownership is unreadable; stopping and retiring the running Core before release: {error:#}"
                        );
                        if let Err(error) = rollback_started_owner(&owner).await {
                            return service_unavailable(format!(
                                "Kill switch release refused; the active Core could not be safely stopped and retired: {error:#}"
                            ));
                        }
                    }
                }
            }
            release_kill_switch_for_platform().await
        })
        .post(IpcCommand::EnableProtectedDns.as_ref(), |ctx| local_timing::in_trace("enable_protected_dns", async move {
            trace!("Received EnableProtectedDns command");
            let (request, owner) =
                match authenticate_request::<AuthenticatedSessionRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let _operation_guard =
                OperationGuard::begin(ServiceOperationKind::EnableDns, IPC_HANDLER_TIMEOUT);
            match local_timing::result_with_verdict("dns.apply_and_native_readback", dns::enable(),
                |status| status.enabled && status.snapshot_present && status.adapters > 0 && status.last_error.is_none()).await {
                Ok(status) => ok_json(status),
                Err(error) => service_unavailable(format!("Failed to enable protected DNS: {error:#}")),
            }
        }))
        .post(IpcCommand::RestoreProtectedDns.as_ref(), |ctx| async move {
            trace!("Received RestoreProtectedDns command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // DNS restore must run after a stop cleared the active-owner/session record, so use
            // the armed-policy owner gate instead. It runs under the lifecycle lock to avoid
            // stale authorization.
            let _lifecycle_guard =
                match enter_owner_lifecycle(&owner, OwnerLifecycleGate::ArmedPolicyOwner).await {
                    ControlFlow::Continue(guard) => guard,
                    ControlFlow::Break(response) => return response,
                };
            let _operation_guard =
                OperationGuard::begin(ServiceOperationKind::RestoreDns, IPC_HANDLER_TIMEOUT);
            match dns::restore_protected().await {
                Ok(status) => ok_json(status),
                Err(error) => service_unavailable(format!("Failed to restore DNS: {error:#}")),
            }
        })
        .get(IpcCommand::GetProtectedDnsStatus.as_ref(), |ctx| async move {
            trace!("Received GetProtectedDnsStatus command");
            let (_request, _owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // Authenticated and lock-free: the DNS watchdog/mutations publish this snapshot.
            ok_json(dns::status().await)
        })
        .get(IpcCommand::BootstrapPins.as_ref(), |ctx| async move {
            trace!("Received GetBootstrapPins command");
            let (_request, _owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            ok_json(crate::core::bootstrap_pins::load())
        })
        .post(IpcCommand::BootstrapPins.as_ref(), |ctx| async move {
            trace!("Received SetBootstrapPins command");
            let (request, owner) = match authenticate_request::<
                AuthenticatedSessionRequest<BootstrapPins>,
            >(&ctx)
            .await
            {
                ControlFlow::Continue(authenticated) => authenticated,
                ControlFlow::Break(response) => return response,
            };
            // Session-gated so a same-user process cannot persist poisoned IPs without a live
            // Tono session. The file write does not mutate WFP, so it does not take the
            // lifecycle writer as a privileged network operation.
            if let Err(error) = require_active_session(&owner, &request.session).await {
                return service_error(error);
            }
            match crate::core::bootstrap_pins::remember(request.payload).await {
                Ok(pins) => ok_json(pins),
                Err(error) => service_unavailable(format!("Failed to persist bootstrap pins: {error:#}")),
            }
        })
        .post(IpcCommand::PrepareCoreStart.as_ref(), |ctx| local_timing::in_trace("prepare_core_start", async move {
            trace!("Received PrepareCoreStart command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // No active session exists on a first connection, so this uses the same authenticated
            // owner gate as StartClash. The lifecycle lock prevents reconciliation from racing a
            // start/stop. CoreManager preserves a supervised process only with complete protected
            // runtime proof; the fallback sweep admits only Tono's canonical installed image.
            let _lifecycle_guard =
                match enter_owner_lifecycle(&owner, OwnerLifecycleGate::Unchecked).await {
                    ControlFlow::Continue(guard) => guard,
                    ControlFlow::Break(response) => return response,
                };
            // Decide under the lifecycle lock but before publishing this route's own operation:
            // the shared proof requires a quiescent snapshot. A fully verified active runtime may
            // keep serving DNS until StartClash replaces it; every weaker supervised runtime must
            // be stopped now or it blocks the App's fixed-port bind before StartClash is reached.
            let snapshot = match local_timing::result("prepare.existing_runtime_snapshot", service_status_snapshot(&owner)).await {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    return service_unavailable(format!(
                        "Failed to prove existing Core state before DNS preflight: {error:#}"
                    ));
                }
            };
            let dns_status = local_timing::returned("prepare.existing_native_dns", dns::status()).await;
            let preserve_supervised_core =
                is_protected_startup_replacement_candidate(&snapshot, &dns_status);
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::PrepareCoreStart,
                IPC_HANDLER_TIMEOUT,
            );
            match local_timing::returned("prepare.core_manager_queue", CORE_MANAGER.lock()).await
                .prepare_start(preserve_supervised_core).await
            {
                Ok(terminated) => ok_json(terminated),
                Err(error) => service_unavailable(format!(
                    "Failed to reconcile Tono Core before DNS preflight: {error:#}"
                )),
            }
        }))
        .post(IpcCommand::StartClash.as_ref(), |ctx| local_timing::in_trace("start_clash", async move {
            trace!("Received StartClash command");
            let (request, owner) =
                match authenticate_request::<AuthenticatedRequest<StartClashRequest>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            let start_request = request.payload;
            if hash_session_token(&start_request.proposed_session_token).is_err() {
                return bad_request("Invalid proposed owner session token");
            }
            if let Some(proxy) = start_request.macos_proxy.as_ref()
                && let Err(error) = validate_proxy_config(proxy)
            {
                return service_error(ServiceError::invalid_proxy_config(error.to_string()));
            }
            if let Some(message) = start_clash_kill_switch_rejection(
                std::env::consts::OS,
                start_request
                    .kill_switch
                    .as_ref()
                    .is_some_and(|config| config.mode != crate::MacosKillSwitchMode::Disabled),
                start_request.windows_kill_switch.is_some(),
                cfg!(all(windows, not(feature = "test"))),
            ) {
                return bad_request(message);
            }
            // Snapshot before waiting for the lifecycle lock: a Disconnect that
            // wins the lock first must make this StartClash retract after it arms.
            let release_epoch = windows_kill_switch::release_epoch();
            #[cfg(feature = "test")]
            test_proxy_barrier_note_start_waiting();
            let _lifecycle_guard =
                match enter_owner_lifecycle(&owner, OwnerLifecycleGate::Unchecked).await {
                    ControlFlow::Continue(guard) => guard,
                    ControlFlow::Break(response) => return response,
                };
            let _operation_guard =
                OperationGuard::begin(ServiceOperationKind::StartCore, IPC_HANDLER_TIMEOUT);
            let previous_owner = match local_timing::result("start.load_previous_owner", load_active_owner()).await {
                Ok(owner) => owner,
                Err(error) => {
                    return service_unavailable(format!("Failed to load active owner: {error}"));
                }
            };
            let prepared_runtime = match local_timing::result("start.validate_runtime", prepare_runtime(&owner, &start_request.runtime)).await {
                Ok(prepared) => prepared,
                Err(error) => return service_error(error),
            };
            let disable_kill_switch = start_request
                .kill_switch
                .as_ref()
                .is_some_and(|config| config.mode == crate::MacosKillSwitchMode::Disabled);
            if let Some(kill_switch) = start_request.kill_switch.as_ref()
                && !disable_kill_switch
                && let Err(error) = macos_kill_switch::arm(kill_switch).await
            {
                return service_unavailable(format!("Failed to arm kill switch: {error:#}"));
            }
            // Windows: persist the fail-closed intent and arm WFP bootstrap before the core
            // starts (the "one connect" data flow in docs/architecture.md). The app-id permit
            // is resolved from the staged core path.
            if let Some(kill_switch) = start_request.windows_kill_switch.as_ref() {
                let core_path = prepared_runtime.clash_config().core_config.core_path.clone();
                if let Err(error) =
                    local_timing::result("start.wfp_bootstrap", windows_kill_switch::arm_bootstrap(kill_switch, &core_path, &owner.key)).await
                {
                    return service_unavailable(format!(
                        "Failed to arm Windows kill switch: {error:#}"
                    ));
                }
                if windows_kill_switch::release_superseded(release_epoch) {
                    if let Err(error) = windows_kill_switch::release().await {
                        return service_unavailable(format!(
                            "StartClash was superseded by Disconnect, but the late arm could not be released: {error:#}"
                        ));
                    }
                    return service_unavailable(
                        "StartClash was superseded by an explicit Disconnect",
                    );
                }
            }
            let mut transition = StartOwnerTransition {
                previous_owner,
                owner: &owner,
                prepared_runtime: Some(prepared_runtime),
                proposed_session_token: &start_request.proposed_session_token,
                macos_proxy: start_request.macos_proxy.as_ref(),
            };
            let (active, proxy_outcome) = match owner_proxy_transition(&mut transition).await {
                Ok(result) => result,
                Err(error) => return service_error(error),
            };
            if disable_kill_switch
                && let Err(error) = macos_kill_switch::release().await
            {
                // Keep the prior fail-closed policy if disarming fails. The new owner cannot
                // be returned as successfully started because the requested network policy
                // was not committed with it.
                let proxy_error = clear_service_proxy().await.err();
                let rollback_error = rollback_started_owner(&owner).await.err();
                return service_unavailable(format!(
                    "Core started but kill switch release failed; prior protection remains: {error:#}{}{}",
                    proxy_error
                        .map(|error| format!("; proxy cleanup failed: {error:#}"))
                        .unwrap_or_default(),
                    rollback_error
                        .map(|error| format!("; core rollback failed: {error:#}"))
                        .unwrap_or_default(),
                ));
            }
            if let Err(error) = macos_kill_switch::add_restored_kill_switch_tunnel().await
            {
                // Armed intent deliberately survives every post-arm failure. Do not leave a core
                // running after returning no session handle: the client would have no proof with
                // which to stop it. PF remains bootstrap-only throughout this rollback.
                let proxy_error = clear_service_proxy().await.err();
                let rollback_error = rollback_started_owner(&owner).await.err();
                let block_error = macos_kill_switch::keep_blocked_after_stop().await.err();
                return service_unavailable(format!(
                    "Core started but tunnel authorization failed; traffic remains blocked: {error:#}{}{}{}",
                    proxy_error
                        .map(|error| format!("; proxy cleanup failed: {error:#}"))
                        .unwrap_or_default(),
                    rollback_error
                        .map(|error| format!("; core rollback failed: {error:#}"))
                        .unwrap_or_default(),
                    block_error
                        .map(|error| format!("; PF restriction refresh failed: {error:#}"))
                        .unwrap_or_default(),
                ));
            }
            if let Err(error) = cleanup_legacy_owner_files(&owner).await {
                warn!(
                    "Core start committed, but legacy owner cleanup will be retried later: {error}"
                );
            }
            info!("Core started successfully");
            ok_json(StartClashResult {
                session: OwnerSessionHandle {
                    generation: active.generation,
                },
                proxy_outcome,
            })
        }))
        .get(IpcCommand::GetClashLogs.as_ref(), |ctx| async move {
            trace!("Received GetClashLogs command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            let _lifecycle_guard =
                match enter_owner_lifecycle(&owner, OwnerLifecycleGate::ActiveOwner).await {
                    ControlFlow::Continue(guard) => guard,
                    ControlFlow::Break(response) => return response,
                };
            ok_json(LOGGER_MANAGER.get_logs().await)
        })
        .get(IpcCommand::GetClashLogSnapshot.as_ref(), |ctx| async move {
            trace!("Received GetClashLogSnapshot command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            let _lifecycle_guard =
                match enter_owner_lifecycle(&owner, OwnerLifecycleGate::ActiveOwner).await {
                    ControlFlow::Continue(guard) => guard,
                    ControlFlow::Break(response) => return response,
                };
            let path = service_paths()
                .for_owner(&owner.identity)
                .logs_dir()
                .join("service_latest.log");
            match read_log_snapshot(&path).await {
                Ok(snapshot) => ok_json(snapshot),
                Err(error) => {
                    service_unavailable(format!("Failed to read core log snapshot: {error}"))
                }
            }
        })
        .delete(IpcCommand::StopClash.as_ref(), |ctx| async move {
            trace!("Received StopClash command");
            let (request, owner) =
                match authenticate_request::<AuthenticatedSessionRequest<StopClashPayload>>(&ctx)
                    .await
                {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let _operation_guard =
                OperationGuard::begin(ServiceOperationKind::StopCore, IPC_HANDLER_TIMEOUT);
            if let Err(error) = clear_proxy_with_direct_compensation().await {
                return service_error(error);
            }
            match CORE_MANAGER.lock().await.stop_core().await {
                Ok(_) => info!("Core stopped successfully"),
                Err(e) => {
                    return service_unavailable(format!("Failed to stop core: {}", e));
                }
            }
            // Persist the stopped intent before changing PF. If the daemon dies after this point,
            // startup must never restore a core into an opened network.
            if let Err(e) = persist_owner_core_stopped(&owner).await {
                set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                return service_unavailable(format!("Failed to persist desired state: {}", e));
            }
            if let Err(error) =
                macos_kill_switch::transition_after_stop(request.payload.release_kill_switch()).await
            {
                return service_unavailable(format!(
                    "Core stopped but kill-switch stop transition was incomplete: {error:#}"
                ));
            }
            // Windows WFP counterpart; a no-op off Windows.
            if let Err(error) =
                windows_kill_switch::transition_after_stop(request.payload.release_kill_switch())
                    .await
            {
                return service_unavailable(format!(
                    "Core stopped but Windows kill-switch stop transition was incomplete: {error:#}"
                ));
            }
            if let Err(e) = clear_active_owner().await {
                set_core_lifecycle_state(ServiceLifecycleState::Fatal);
                return service_unavailable(format!("Failed to clear active owner: {}", e));
            }
            ok_empty("Core stopped successfully")
        })
        .post(IpcCommand::StageRuntime.as_ref(), |ctx| async move {
            trace!("Received StageRuntime command");
            let (request, owner) =
                match authenticate_request::<AuthenticatedSessionRequest<RuntimeBundle>>(&ctx)
                    .await
                {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // The guard is held for the whole operation, and for the same reason `StartClash`
            // holds it: a core must not be stopped, started, or handed to another owner while its
            // generation is being rewritten underneath it. Staging writes into the directory the
            // *running* core reads from, which is why the gate is the session and not the owner.
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let _operation_guard =
                OperationGuard::begin(ServiceOperationKind::StageRuntime, IPC_HANDLER_TIMEOUT);
            match stage_runtime(&owner, &request.payload).await {
                Ok(outcome) => ok_json(outcome),
                Err(error) => service_error(error),
            }
        })
        .post(IpcCommand::UpdateWriter.as_ref(), |ctx| async move {
            trace!("Received UpdateWriter command");
            let (request, owner) =
                match authenticate_request::<AuthenticatedSessionRequest<WriterConfig>>(&ctx)
                    .await
                {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            let mut writer_config = request.payload;
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let _operation_guard =
                OperationGuard::begin(ServiceOperationKind::UpdateWriter, IPC_HANDLER_TIMEOUT);
            // The client does not get to choose where the service writes: whatever it sent is
            // replaced with the owner's own log directory. It does not get to choose how much it
            // writes either — the rotation numbers are clamped before they reach the writer or
            // the durable desired state.
            writer_config.directory = service_paths()
                .for_owner(&owner.identity)
                .logs_dir()
                .to_string_lossy()
                .into_owned();
            writer_config.max_log_size = writer_config
                .max_log_size
                .clamp(MIN_LOG_SIZE_BYTES, MAX_LOG_SIZE_BYTES);
            writer_config.max_log_files = writer_config.max_log_files.clamp(1, MAX_LOG_FILES);
            match set_or_update_writer(&writer_config).await {
                Ok(_) => info!("Update writer successfully"),
                Err(e) => {
                    return service_unavailable(format!("Failed to update writer: {}", e));
                }
            };
            if let Err(e) = persist_owner_writer_config(&owner, &writer_config).await {
                return service_unavailable(format!("Failed to persist writer config: {}", e));
            }
            ok_empty("Update Writer successfully")
        })
        .post(IpcCommand::SetSystemProxy.as_ref(), |ctx| async move {
            trace!("Received SetSystemProxy command");
            let (request, owner) =
                match authenticate_request::<AuthenticatedSessionRequest<MacosProxyConfig>>(&ctx)
                    .await
                {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // The proxy config is still validated here, after the gate, and not alongside
            // `StartClash`'s pre-lock validation: a stale session must keep winning over an
            // invalid payload.
            let _lifecycle_guard = match enter_owner_lifecycle(
                &owner,
                OwnerLifecycleGate::ActiveSession(&request.session),
            )
            .await
            {
                ControlFlow::Continue(guard) => guard,
                ControlFlow::Break(response) => return response,
            };
            let _operation_guard = OperationGuard::begin(
                ServiceOperationKind::SetSystemProxy,
                IPC_HANDLER_TIMEOUT,
            );
            if let Err(error) = validate_proxy_config(&request.payload) {
                return service_error(ServiceError::invalid_proxy_config(error.to_string()));
            }
            match apply_service_proxy_or_direct(Some(&request.payload)).await {
                Ok(outcome) => ok_json(outcome),
                Err(error) => service_error(ServiceError::proxy_apply_failed(error.to_string())),
            }
        })
        .post(IpcCommand::OwnerGoodbye.as_ref(), |ctx| async move {
            trace!("Received OwnerGoodbye command");
            let (_request, owner) =
                match authenticate_request::<AuthenticatedRequest<()>>(&ctx).await {
                    ControlFlow::Continue(authenticated) => authenticated,
                    ControlFlow::Break(response) => return response,
                };
            // Why the gate is the owner credential and NOT `require_active_session`: this route
            // exists for the App's unprotected-quit path, whose legitimate caller has no live
            // session — StopClash clears the session record, and a user who never connected
            // never had one. Security here does not rest on the session:
            //   1. `authenticate_request` already proved the caller can read the owner token
            //      from the ACL-protected per-user owner directory (constant-time compared);
            //      a process running as another user cannot produce it.
            //   2. Stopping is refused with 409 whenever the machine still needs the daemon:
            //      kill switch armed (`wanted`), durable desired state wants the core running,
            //      or that state is unreadable. The lifecycle lock makes those two reads atomic
            //      against a concurrent Start/Stop/Release.
            //   3. When neither holds the Service is idle — no barrier armed, no core desired —
            //      so stopping it changes no security posture. The worst a same-user process can
            //      do is stop a daemon the next connect revives via the install/repair entry.
            let _lifecycle_guard =
                match enter_owner_lifecycle(&owner, OwnerLifecycleGate::Unchecked).await {
                    ControlFlow::Continue(guard) => guard,
                    ControlFlow::Break(response) => return response,
                };
            let verdict = owner_goodbye_verdict(
                windows_kill_switch::status().await.wanted,
                load_owner_desired_state(&owner.key)
                    .await
                    .map(|desired| desired.core_should_be_running)
                    .ok(),
            );
            match verdict {
                Ok(()) => {
                    info!("Authenticated owner goodbye accepted; the service is stopping itself");
                    schedule_owner_goodbye_shutdown();
                    ok_empty("Service is stopping at the owner's request")
                }
                Err(error) => service_error(error),
            }
        });
    #[cfg(feature = "test")]
    let router = router
        .post("/__test/proxy-barrier/arm", |_ctx| async move {
            test_proxy_barrier_arm();
            ok_empty("Proxy barrier armed")
        })
        .get("/__test/proxy-barrier/proxy-entered", |_ctx| async move {
            test_proxy_barrier_wait(TEST_PROXY_ENTERED, &TEST_PROXY_ENTERED_NOTIFY).await;
            ok_empty("Proxy operation entered")
        })
        .get("/__test/proxy-barrier/start-waiting", |_ctx| async move {
            test_proxy_barrier_wait(TEST_START_WAITING, &TEST_START_WAITING_NOTIFY).await;
            ok_empty("Start is waiting")
        })
        .post("/__test/proxy-barrier/release", |_ctx| async move {
            test_proxy_barrier_release();
            ok_empty("Proxy barrier released")
        })
        .post("/__test/proxy-barrier/reset", |_ctx| async move {
            test_proxy_barrier_reset();
            ok_empty("Proxy barrier reset")
        });
    Ok(router)
}
