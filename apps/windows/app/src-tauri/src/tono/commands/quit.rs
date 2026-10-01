//! Domain Tauri commands. Wire names stay unchanged.

use std::{net::SocketAddr, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager as _};
use tono_logging::{Type, logging};
use tono_service_protocol::KillSwitchStatus;
#[cfg(any(windows, test))]
use tono_service_protocol::ServiceStatusSnapshot;
use tono_core::{
    auth::{ApiError, DEFAULT_DEVICE_LIMIT, User, normalize_installation_id},
    connection::{ConnectStage, ConnectionFsm, UiState},
    credentials::{CredentialKey, CredentialStore as _},
};
use crate::{
    core::service,
    process::AsyncHandler,
    tono::{
        audit::AuditEvent,
        catalog_sync, connection,
        credentials::{SessionCredentialStore, TonoCredentialStore},
        state::{AccountState, TonoInner, TonoState},
    },
};
use super::*;

/// The protected-state predicate of the quit path: the machine is protected while the kill
/// switch is armed or a (dis)connection is in flight. Shared by `quit_release` and
/// `quit_protection_active` so "protected" can never drift between the release decision and the
/// service-stop decision.
fn fsm_reports_protection(fsm: &ConnectionFsm) -> bool {
    fsm.kill_switch_armed()
        || fsm.status().is_connected
        || fsm.status().is_connecting
        || fsm.status().is_protection_blocked
}

/// A relaunched App may quit before discovery folds the surviving owner's Core/WFP into its
/// FSM. An unreadable Service snapshot proves nothing; keep the local decision in that case.
#[cfg(any(windows, test))]
fn quit_needs_service_release(local_protected: bool, service: Option<&ServiceStatusSnapshot>) -> bool {
    // Only this owner's session: the kill-switch aggregate is machine-wide, and an owner-gated
    // release against another user's barrier would just refuse this Quit.
    local_protected || service.is_some_and(|snapshot| {
        snapshot.is_active
            && (snapshot.kill_switch.as_ref().is_some_and(|status| status.wanted) || snapshot.core_pid.is_some())
    })
}

#[cfg(windows)]
async fn quit_needs_release(local_protected: bool) -> bool {
    let snapshot = if local_protected {
        None
    } else {
        // Leave room to dispatch release inside even the 2.5 s session-ending Quit budget.
        tokio::time::timeout(Duration::from_secs(1), service::tono_service_status_snapshot())
            .await
            .ok()
            .and_then(Result::ok)
    };
    quit_needs_service_release(local_protected, snapshot.as_ref())
}


pub async fn quit_protection_active(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return false;
    };
    let inner = state.lock().await;
    fsm_reports_protection(&inner.fsm)
}

/// Whether asking the Service to stop itself on an unprotected quit is permitted. The durable
/// desired state must be proven "core should not be running": stopping the Windows service does
/// not rewrite the desired-state file, so stopping it while `core_should_be_running` is true (or
/// unreadable) would let the next service start resurrect a core the user already stopped. The
/// Service enforces the same check server-side (`owner_goodbye_verdict`); this client-side
/// pre-check is the fast path that keeps the quit log truthful.
#[cfg(any(windows, test))]
pub(super) fn service_stop_permitted_on_quit(
    desired_state_unknown: bool,
    desired_core_should_be_running: bool,
) -> bool {
    !desired_state_unknown && !desired_core_should_be_running
}

/// Unprotected interactive quit on Windows: ask TonoService to stop ITSELF over IPC
/// (`POST /lifecycle/owner-goodbye`), so no daemon lingers after the App exits. The direct SCM
/// stop this replaced cannot work — the App runs as a plain user and `OpenService(STOP)` on a
/// SYSTEM-owned service is `os error 5` — while the Service can always stop itself. The route
/// refuses (409) whenever the kill switch is armed or the desired state wants the core, so
/// connected/protected state is safe even if the local pre-check raced. Best-effort: the exit
/// is already committed, so every refusal or transport failure is logged, never propagated.
pub async fn stop_service_on_unprotected_quit() {
    #[cfg(windows)]
    {
        match service::tono_service_status_snapshot().await {
            Ok(snapshot)
                if service_stop_permitted_on_quit(
                    snapshot.desired_state_unknown,
                    snapshot.desired_core_should_be_running,
                ) => {}
            Ok(snapshot) => {
                logging!(
                    info,
                    Type::Service,
                    "Tono: 退出时保留 TonoService 运行：desired state 未证明 core 已停 \
                     (desired_core_should_be_running={}, desired_state_unknown={})",
                    snapshot.desired_core_should_be_running,
                    snapshot.desired_state_unknown
                );
                return;
            }
            Err(error) => {
                // IPC unanswered: the Service is either already stopped (goodbye would be a
                // no-op anyway) or wedged with an unprovable desired state. Skip rather than
                // strand a stale `core_should_be_running = true`.
                logging!(
                    info,
                    Type::Service,
                    "Tono: 服务未应答 IPC，退出时跳过服务自停（服务已停止或状态不可证明）: {error:#}"
                );
                return;
            }
        }
        match service::tono_request_service_owner_goodbye().await {
            Ok(()) => logging!(
                info,
                Type::Service,
                "Tono: 未连接状态退出，已通过 IPC 请求 TonoService 自停（下次连接会按需修复并拉起）"
            ),
            Err(error) => logging!(
                warn,
                Type::Service,
                "Tono: 退出时请求服务自停失败（退出继续进行）: {error:#}"
            ),
        }
    }
}

#[tauri::command]
pub async fn tono_prepare_update(
    app: AppHandle,
    state: tauri::State<'_, Arc<TonoState>>,
    next_version: String,
) -> Result<(), String> {
    if next_version.trim().is_empty() {
        return Err("TONO_UPDATE_VERSION_REQUIRED".into());
    }
    let previous = env!("CARGO_PKG_VERSION");
    let (mut journal, connected, keep_kill_switch, cleanup_required) = {
        let inner = state.lock().await;
        let journal = crate::tono::update_handoff::prepare(
            previous,
            next_version.trim(),
            inner.connect_generation,
            inner.fsm.status().is_connected,
            inner.fsm.kill_switch_armed(),
        );
        (
            journal,
            inner.fsm.status().is_connected || inner.fsm.status().is_connecting,
            inner.fsm.kill_switch_armed(),
            fsm_reports_protection(&inner.fsm),
        )
    };
    journal.selected_node_anonymous_id = {
        let inner = state.lock().await;
        inner.selected_node.clone()
    };
    {
        let inner = state.lock().await;
        journal.catalog_revision = Some(inner.catalog_tracker.current_revision());
        journal.helper_protocol_version = tono_service_protocol::PROTOCOL_REVISION.to_string();
        journal.build_commit = option_env!("VERGEN_GIT_SHA")
            .or(option_env!("GITHUB_SHA"))
            .unwrap_or("")
            .to_string();
        journal.was_connected = connected;
        journal.keep_kill_switch_armed = keep_kill_switch;
    }
    crate::tono::update_handoff::save_prepared(&journal)
        .map_err(|error| format!("TONO_UPDATE_JOURNAL: {error}"))?;

    fn record(phase: crate::tono::update_handoff::Phase) -> Result<(), String> {
        crate::tono::update_handoff::record_owner_phase(phase)
            .map_err(|error| format!("TONO_UPDATE_JOURNAL: {error}"))
    }

    record(crate::tono::update_handoff::Phase::ConnectionQuiescing)?;
    {
        let mut inner = state.lock().await;
        // Keep WFP armed across the install; this is not a user Disconnect.
        inner.invalidate_connection(false);
        inner.tasks.abort_catalog_sync();
    }
    // Protected Offline is not proof that privileged cleanup succeeded. In
    // particular, a retry after DNS failure must not bypass the same cleanup.
    let dns_restored = if cleanup_required {
        if let Err(error) = service::tono_stop_core(false).await {
            let _ = record(crate::tono::update_handoff::Phase::Failed);
            return Err(format!(
                "TONO_UPDATE_JOURNAL: core did not stop before install: {error}"
            ));
        }
        let dns_restored = service::tono_restore_protected_dns().await
            .map(|_| ())
            .map_err(|error| {
                logging!(warn, Type::System,
                    "Tono: update refused because DNS restore failed (barrier stays armed): {error}");
                format!("TONO_UPDATE_DNS_RESTORE: {error}")
            });
        // Core already stopped even when DNS restoration failed. Reflect that
        // before refusing installation; never disarm to make an update pass.
        let mut inner = state.lock().await;
        inner.controller_secret = None;
        inner.controller_port = None;
        if inner.fsm.status().is_connected {
            let _ = inner.fsm.tunnel_died();
        } else if keep_kill_switch {
            inner.fsm.initial_release_failed();
        }
        super::emit_status(&app, &super::status_of(&inner));
        dns_restored
    } else {
        Ok(())
    };

    record_update_cleanup(dns_restored, keep_kill_switch, record)?;
    // InstallStarted is recorded by tono-service-install.exe --replace-runtime,
    // not by guessing that the frontend is about to call install().
    Ok(())
}

/// This is the journal commit point for cleanup, not a best-effort diagnostic.
/// An explicit DNS restore failure must never become a clean/protected handoff.
fn record_update_cleanup(
    dns_restored: Result<(), String>,
    keep_kill_switch: bool,
    mut record: impl FnMut(crate::tono::update_handoff::Phase) -> Result<(), String>,
) -> Result<(), String> {
    use crate::tono::update_handoff::Phase;
    if let Err(error) = dns_restored {
        record(Phase::Failed).map_err(|journal_error| format!("{error}; {journal_error}"))?;
        return Err(error);
    }
    record(Phase::CleanShutdownCompleted)?;
    if keep_kill_switch {
        record(Phase::ProtectedHandoffRecorded)?;
    }
    Ok(())
}

#[cfg(test)]
mod update_cleanup_tests {
    #[test]
    fn protected_offline_update_retry_still_requires_privileged_cleanup() {
        let mut fsm = super::ConnectionFsm::new();
        fsm.begin_connect();
        fsm.mark_kill_switch_armed();
        fsm.mark_session_verified();
        fsm.connect_succeeded().unwrap();
        // prepare_update stopped Core, failed DNS restoration, then reflected
        // the stopped tunnel. A second attempt must still call the Service.
        fsm.tunnel_died();
        assert_eq!(fsm.status().ui_state(), super::UiState::ProtectedOffline);
        assert!(!fsm.status().is_connected && !fsm.status().is_connecting);
        assert!(super::fsm_reports_protection(&fsm));
        fsm.sign_out_or_quit();
        assert!(!super::fsm_reports_protection(&fsm));
    }

    #[test]
    fn dns_restore_failure_cannot_record_a_clean_update_handoff() {
        use tono_core::update_journal::{UpdateHandoffJournal, UpdateHandoffPhase as Phase};
        let mut journal = UpdateHandoffJournal::new("0.0.72", "0.0.73", 7, true, true);
        journal.advance(Phase::ConnectionQuiescing);
        let mut recorded = Vec::new();
        let result = super::record_update_cleanup(
            Err("TONO_UPDATE_DNS_RESTORE: injected service failure".into()),
            true,
            |phase| {
                recorded.push(phase);
                journal.advance(phase);
                Ok(())
            },
        );
        assert!(result.unwrap_err().contains("injected service failure"));
        assert_eq!(recorded, vec![Phase::Failed]);
        assert_eq!(journal.phase, Phase::Failed);
        assert!(journal.keep_kill_switch_armed);
    }
}

/// Explicit Quit/restart release (§6, L1): bump the generation, abort every task, then join the
/// single-flight explicit-release sequence. A preventable interactive exit is cancelled when
/// release cannot be proven; the unpreventable WM_ENDSESSION path applies its own short outer
/// budget in the run-event handler.
pub async fn quit_release(app: AppHandle) -> Result<(), String> {
    if super::update::incomplete() {
        return Err("A Service-owned update is pending; Quit/Disconnect cannot cancel its recovery obligation".into());
    }
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        #[cfg(windows)]
        if quit_needs_release(false).await {
            // State creation can fail while the previous App's Core survives. This route needs
            // only owner credentials; keep release and owned proxy cleanup running even if the
            // interactive Quit waiter expires.
            return tauri::async_runtime::spawn(async {
                let status = service::tono_release_kill_switch().await
                    .map_err(|error| format!("Quit release without product state failed: {error:#}"))?;
                if status.wanted || status.live {
                    return Err("Quit release without product state returned an armed kill switch".into());
                }
                let _ = crate::core::sysopt::Sysopt::global().clear_owned_sysproxy().await;
                Ok::<(), String>(())
            })
            .await
            .map_err(|error| format!("Quit release without product state task failed: {error}"))?;
        }
        return Ok(());
    };
    let (protected, offline) = {
        let mut inner = state.lock().await;
        inner.invalidate_connection(true);
        inner.tasks.abort_catalog_sync();
        (fsm_reports_protection(&inner.fsm), Arc::clone(&inner.offline))
    };
    #[cfg(windows)]
    let protected = quit_needs_release(protected).await;
    let result = if protected {
        connection::release_explicit(&state, &app).await
    } else {
        Ok(())
    };
    // #582: a revocation still waiting for the disk must land before exit, or the next offline
    // launch reads the grant it revoked. The wait wakes the writer out of its retry backoff for an
    // immediate attempt. Bounded: Quit never hangs on a failing disk.
    if result.is_ok() && !offline.wait_durable(crate::tono::offline_grant::QUIT_DURABILITY_BUDGET).await {
        logging!(warn, Type::Service, "Tono: the offline revocation did not reach the disk before quit");
    }
    result
}

async fn flush_session_for_exit(
    credentials: impl std::future::Future<Output = Arc<SessionCredentialStore>>,
) -> bool {
    matches!(tokio::time::timeout(AUDIT_FLUSH_BUDGET, async {
        credentials.await.flush().await
    }).await, Ok(Ok(())))
}

#[cfg(test)]
mod credential_exit_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tono_core::credentials::{CredentialError, CredentialStore, MemoryCredentialStore};

    #[tokio::test]
    async fn committed_exit_retries_a_failed_refresh_write_before_relaunch() {
        struct Vault {
            durable: MemoryCredentialStore,
            attempts: AtomicUsize,
            failed: tokio::sync::Notify,
        }
        impl CredentialStore for Vault {
            fn get(&self, key: CredentialKey) -> Result<Option<String>, CredentialError> {
                self.durable.get(key)
            }
            fn set(&self, key: CredentialKey, value: &str) -> Result<(), CredentialError> {
                if self.attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                    self.failed.notify_one();
                    return Err(CredentialError::Store("temporary vault write failure".into()));
                }
                self.durable.set(key, value)
            }
            fn delete(&self, key: CredentialKey) -> Result<(), CredentialError> {
                self.durable.delete(key)
            }
        }
        let vault = Arc::new(Vault {
            durable: MemoryCredentialStore::new(),
            attempts: AtomicUsize::new(0),
            failed: tokio::sync::Notify::new(),
        });
        vault.durable.set_refresh_token("previous-session").unwrap();
        let credentials = Arc::new(SessionCredentialStore::with_test_vault(vault.clone()));
        credentials.set_local(CredentialKey::RefreshToken, "previous-session").unwrap();
        credentials.set_refresh_token("rotated-session").unwrap();
        tokio::time::timeout(AUDIT_FLUSH_BUDGET, vault.failed.notified()).await.unwrap();

        assert!(flush_session_for_exit(async { credentials.clone() }).await);
        assert_eq!(vault.durable.refresh_token().unwrap().as_deref(), Some("rotated-session"));
        assert_eq!(vault.attempts.load(Ordering::SeqCst), 2);
    }
}

/// M3: exit is *committed* (RunEvent::Exit) — drain the audit and session
/// writers in parallel within the existing exit budget. Kept strictly apart
/// from `quit_release`: a cancelled quit must not kill the audit trail.
pub async fn flush_audit_for_exit(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return;
    };
    state.audit().close_sender();
    let session = flush_session_for_exit(async {
        Arc::clone(&state.lock().await.credentials)
    });
    let audit = async {
        if let Some(writer) = state.audit().take_writer() {
            let _ = tokio::time::timeout(AUDIT_FLUSH_BUDGET, writer).await;
        }
    };
    let (session_saved, ()) = tokio::join!(session, audit);
    if !session_saved {
        logging!(warn, Type::Service,
            "Tono: the session credential writer did not acknowledge before exit");
    }
}

/// M3: the quit path was cancelled after `quit_release` already ran — the
/// barrier may really be gone while the FSM still claims protection.
/// Re-sync from the Service so the UI shows the truth.
pub async fn resync_after_cancelled_quit(app: AppHandle) {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return;
    };
    let mut inner = resync_cancelled_quit_from(&state, async {
        service::tono_service_status_snapshot().await.ok().and_then(|snapshot| snapshot.kill_switch)
    }).await;
    // The quit was cancelled into (or out of) an armed state: whatever idle Protected Offline
    // remains must keep polling the Service's own verdict (R2-F2) — a Service restart can
    // retire an unverified barrier and nothing else would ever re-read that here. A
    // Service-proven disarm is a no-op (nothing left to watch).
    connection::ensure_protection_resync_locked(&mut inner, || {
        connection::spawn_protection_resync(&state, &app)
    });
    emit_status(&app, &status_of(&inner));
    // Quit retired catalog/policy refresh, but a cancelled exit keeps this account alive.
    // The spawn rechecks the auth generation; it must run after releasing the state lock.
    let generation = (inner.account_state == AccountState::Ready
        && inner.account.is_some()
        && inner.account_close.is_none())
        .then_some(inner.sign_in_generation);
    drop(inner);
    if let Some(generation) = generation {
        catalog_sync::spawn_periodic_for_auth_generation(&state, &app, generation).await;
    }
}

async fn resync_cancelled_quit_from<'a>(
    state: &'a TonoState,
    reading: impl std::future::Future<Output = Option<KillSwitchStatus>>,
) -> tokio::sync::MutexGuard<'a, TonoInner> {
    let generation = state.lock().await.connect_generation;
    let kill_switch = reading.await;
    let mut inner = state.lock().await;
    if inner.connect_generation == generation {
        if matches!(&kill_switch, Some(status) if status.wanted) {
            // Quit-specific side effect of a retained barrier: no read-only probing should keep
            // running over it while the user decides their next move.
            inner.cancel_server_tests();
        }
        apply_service_kill_switch(&mut inner, kill_switch);
    }
    inner
}

#[cfg(test)]
mod quit_tests {
    use super::*;
    use tono_service_protocol::{KillSwitchStatusMode, ServiceLifecycleState};

    #[tokio::test]
    async fn cancelled_quit_resync_cannot_apply_an_old_disarm_to_a_successor() {
        let state = Arc::new(TonoState::for_test());
        let disarmed = KillSwitchStatus {
            wanted: false, verified: false, live: false, mode: KillSwitchStatusMode::Blocked,
            tunnel_permit_rendered: false, endpoints: Vec::new(),
            direct_endpoint_digest: String::new(), last_error: None, reconnect_after_release: false,
        };
        let (entered, sampled) = tokio::sync::oneshot::channel();
        let (release, deliver) = tokio::sync::oneshot::channel();
        let resync_state = state.clone();
        let resync = tokio::spawn(async move {
            let inner = resync_cancelled_quit_from(&resync_state, async move {
                entered.send(()).unwrap();
                deliver.await.unwrap();
                Some(disarmed)
            }).await;
            (inner.fsm.status().is_connected, inner.fsm.kill_switch_armed(),
                inner.kill_switch.as_ref().is_some_and(|status| status.wanted))
        });
        sampled.await.unwrap();
        {
            let mut inner = state.lock().await;
            inner.connect_generation = inner.connect_generation.wrapping_add(1);
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            inner.kill_switch = Some(KillSwitchStatus {
                wanted: true, verified: true, live: true, mode: KillSwitchStatusMode::Locked,
                tunnel_permit_rendered: true, endpoints: Vec::new(),
                direct_endpoint_digest: String::new(), last_error: None, reconnect_after_release: false,
            });
        }
        release.send(()).unwrap();
        assert_eq!(resync.await.unwrap(), (true, true, true),
            "an old Quit reading must not erase successor protection or stop its monitoring");
    }

    #[test]
    fn quit_before_discovery_releases_service_protection_or_own_running_core() {
        assert!(!quit_needs_service_release(false, None));
        assert!(quit_needs_service_release(true, None));
        let mut snapshot = ServiceStatusSnapshot {
            snapshot_generation: 0,
            active_operation: None,
            is_active: false,
            active_generation: None,
            service_state: ServiceLifecycleState::Running,
            core_pid: None,
            core_generation: 0,
            core_started_at: None,
            last_core_exit_reason: None,
            restart_count: 0,
            last_recovery_at: None,
            desired_core_should_be_running: false,
            desired_generation: 0,
            desired_updated_at: 0,
            desired_state_unknown: false,
            macos_kill_switch_wanted: false,
            macos_kill_switch_live: false,
            macos_kill_switch_mode: Default::default(),
            kill_switch: Some(KillSwitchStatus {
                wanted: true,
                verified: false,
                live: false,
                mode: KillSwitchStatusMode::Blocked,
                tunnel_permit_rendered: false,
                endpoints: Vec::new(),
                direct_endpoint_digest: String::new(),
                last_error: None,
                reconnect_after_release: false,
            }),
            network_events: Default::default(),
        };
        assert!(
            !quit_needs_service_release(false, Some(&snapshot)),
            "another user's barrier is not ours to release"
        );
        snapshot.is_active = true;
        assert!(quit_needs_service_release(false, Some(&snapshot)));
        snapshot.is_active = false;
        snapshot.kill_switch = None;
        assert!(!quit_needs_service_release(false, Some(&snapshot)));
        snapshot.is_active = true;
        snapshot.core_pid = Some(1234);
        assert!(quit_needs_service_release(false, Some(&snapshot)));
        snapshot.is_active = false;
        assert!(!quit_needs_service_release(false, Some(&snapshot)), "another user's Core is not ours to release");
    }
}

/// Fold a Service kill-switch reading into the product state. Extracted from the
/// cancelled-quit resync above so the Protected Offline Service-truth poll
/// (`connection`'s `protection_resync_loop`, R2-F2) applies the exact same semantics:
/// `Some(wanted=true)` re-asserts the armed (and, when the Service says so, verified)
/// latches; `Some(wanted=false)` — the Service's own proof the barrier is gone — converges
/// the FSM to released; `None` (other platform, Service down, IPC unanswered) keeps every
/// local claim, because an unreadable barrier is never proof of an absent one. Protection is
/// only ever loosened by the Service's explicit answer, never by the absence of one.
pub(crate) fn apply_service_kill_switch(inner: &mut TonoInner, kill_switch: Option<KillSwitchStatus>) {
    match kill_switch {
        Some(status) if status.wanted => {
            // Still armed (the release failed or never ran): reflect it.
            if status.verified {
                inner.fsm.mark_session_verified();
            }
            if !inner.fsm.kill_switch_armed() {
                inner.fsm.mark_kill_switch_armed();
            }
            inner.kill_switch = Some(status);
        }
        Some(_) => {
            // Verifiably disarmed: converge the FSM to released.
            inner.kill_switch = None;
            if inner.fsm.kill_switch_armed()
                || inner.fsm.status().is_connected
                || inner.fsm.status().is_protection_blocked
            {
                inner.fsm.sign_out_or_quit();
            }
        }
        None => {
            // No WFP answer (other platform or IPC down): keep the local view.
        }
    }
}
