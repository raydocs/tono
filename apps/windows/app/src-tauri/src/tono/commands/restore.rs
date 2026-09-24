//! Domain Tauri commands. Wire names stay unchanged.

use std::{net::SocketAddr, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager as _};
use tono_logging::{Type, logging};
use tono_service_protocol::KillSwitchStatus;
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

/// How many times restore asks the Service about the stored barrier before giving up.
const PROTECTION_PROBE_ATTEMPTS: usize = 5;
const PROTECTION_PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

#[derive(Debug, Clone)]
enum StoredProtection {
    /// The Service answered and wants the barrier.
    Armed(Box<KillSwitchStatus>),
    /// The Service answered and wants no barrier. The only reading that proves absence.
    ProvenAbsent,
    /// The Service did not answer. Never treated as absence.
    Unknown(String),
}

/// Ask the Service about the stored barrier, retrying inside the restore budget.
async fn probe_stored_protection(deadline: tokio::time::Instant) -> StoredProtection {
    let mut last_error = "the Tono Service did not answer".to_string();
    for attempt in 0..PROTECTION_PROBE_ATTEMPTS {
        match tokio::time::timeout_at(deadline, service::tono_service_status_snapshot()).await {
            Ok(Ok(snapshot)) => {
                return match snapshot.kill_switch {
                    Some(status) if status.wanted => StoredProtection::Armed(Box::new(status)),
                    _ => StoredProtection::ProvenAbsent,
                };
            }
            Ok(Err(error)) => last_error = error.to_string(),
            Err(_elapsed) => {
                last_error = format!("status probe exceeded the {RESTORE_TRANSACTION_TIMEOUT:?} restore budget");
                break;
            }
        }
        if attempt + 1 < PROTECTION_PROBE_ATTEMPTS
            && tokio::time::timeout_at(deadline, tokio::time::sleep(PROTECTION_PROBE_INTERVAL))
                .await
                .is_err()
        {
            break;
        }
    }
    logging!(
        warn,
        Type::Service,
        "Tono: 无法读取 Service 的保护状态，按“未知（仍可能已封锁）”处理: {last_error}"
    );
    StoredProtection::Unknown(last_error)
}

/// Fold a protection reading into the FSM.
///
/// `Unknown` is recorded as armed but *not* session-verified. Of the two possible mistakes,
/// believing in a barrier that is already gone costs the user one Disconnect that succeeds
/// immediately; believing a live barrier is gone costs them their network with no way back.
/// Withholding `mark_session_verified` keeps auto-reconnect out of it — an unknown must unlock
/// the release paths, not start driving the machine.
fn apply_stored_protection(inner: &mut TonoInner, protection: &StoredProtection) {
    match protection {
        StoredProtection::Armed(status) => {
            if status.verified {
                inner.fsm.mark_session_verified();
            }
            inner.kill_switch = Some((**status).clone());
            inner.fsm.mark_kill_switch_armed();
        }
        StoredProtection::Unknown(_) => inner.fsm.mark_kill_switch_armed(),
        StoredProtection::ProvenAbsent => {}
    }
}

/// The single wording for "we could not read the barrier". It has to name the consequence and
/// the escape hatch, because the user may be looking at a machine with no network.
pub(super) fn unknown_protection_message(reason: &str) -> String {
    format!(
        "protection state unknown — the Tono Service is not answering ({reason}). Network protection may still be blocking this machine: use Disconnect to release it, or run `tono-service.exe --emergency-disarm` as Administrator"
    )
}

/// Startup session restore (§2): load the persisted selection (L4), seed
/// the catalog from the verified cache, then refresh + `me()`. A 401 means
/// the session is dead (logout, disarm, clear); other errors keep the kill
/// switch armed and enter the error state. If the Service still wants the
/// kill switch, first surface Protected Offline. Once account/catalog restore finishes, a fresh
/// strongly proven same-owner active runtime is replaced behind the still-armed barrier so this
/// process obtains a new Service session/controller; weaker evidence continues to wait for the
/// user and is never promoted directly to Connected.
pub async fn restore_session(app: AppHandle, state: Arc<TonoState>) {
    let update_recovery = super::update::adopt().await;
    if let Err(error) = &update_recovery {
        logging!(warn, Type::Service, "Protected update adoption not established: {error:#}");
    }
    let restore_deadline = tokio::time::Instant::now() + RESTORE_TRANSACTION_TIMEOUT;
    let generation = {
        let mut inner = state.lock().await;
        if inner.account_close.is_some() {
            return;
        }
        // Restore is an authentication transaction too. A retry supersedes an older restore,
        // while sign-in/sign-out already bump the same generation.
        inner.sign_in_generation = inner.sign_in_generation.wrapping_add(1);
        if let Some(selected) = crate::tono::state::load_selection(&inner.catalog_dir) {
            inner.selected_node = Some(selected);
        }
        catalog_sync::seed_from_cache(&mut inner);
        crate::tono::policy_sync::seed_from_cache(&mut inner);
        emit_status(&app, &status_of(&inner));
        inner.sign_in_generation
    };

    // Three-valued on purpose: armed / proven absent / unknown. This used to be an
    // `Option<KillSwitchStatus>` where every failure mode became `None`, and `None` reads as
    // "there is no barrier" everywhere below.
    let protection = probe_stored_protection(restore_deadline).await;

    let (client, probe) = {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation {
            return;
        }
        let refresh = inner.credentials.refresh_token().ok().flatten();
        let probe = token_probe(inner.credential_error.as_ref(), refresh.as_ref());
        (inner.client.clone(), probe)
    };

    // M1: a credential-store *error* is not a missing token — it enters the
    // error state (protection preserved), never SignedOut.
    match probe {
        TokenProbe::StoreError => {
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return;
            }
            apply_stored_protection(&mut inner, &protection);
            let detail = inner
                .credential_error
                .clone()
                .unwrap_or_else(|| "unknown credential error".to_string());
            inner.account_state = match &protection {
                // Two unknowns at once (a slow vault and a Service that is not up yet) is the
                // common boot case; report both rather than only the one we noticed first.
                StoredProtection::Unknown(reason) => AccountState::Error(format!(
                    "credential store unreadable: {detail}; {}",
                    unknown_protection_message(reason)
                )),
                _ => AccountState::Error(format!("credential store unreadable: {detail}")),
            };
            emit_status(&app, &status_of(&inner));
            return;
        }
        TokenProbe::NoToken => {
            if let StoredProtection::Unknown(reason) = &protection {
                // Never the silent signed-out path. Unknown here was the worst of the lot: it
                // skipped the release entirely and reported SignedOut over a possibly-live WFP
                // block, after which Disconnect was a success no-op and Quit exited computing
                // `protected == false`. Record it as armed so every release path stays
                // reachable, and say plainly that we do not know.
                let mut inner = state.lock().await;
                if inner.sign_in_generation != generation {
                    return;
                }
                apply_stored_protection(&mut inner, &protection);
                inner.account_state = AccountState::Error(unknown_protection_message(reason));
                emit_status(&app, &status_of(&inner));
                return;
            }
            let release_needed = matches!(protection, StoredProtection::Armed(_));
            if release_needed {
                let mut inner = state.lock().await;
                if inner.sign_in_generation != generation {
                    return;
                }
                apply_stored_protection(&mut inner, &protection);
            }
            let release_app = app.clone();
            if let Err(error) = super::account::close_account_with(
                state, super::account::AccountCloseReason::Missing { generation },
                move |state| async move {
                    if release_needed { connection::release_for_account(&state, &release_app).await }
                    else { Ok(()) }
                },
                |client| async move { client.logout().await.map_err(|error| error.to_string()) },
                |_, _| async {},
                move |inner| emit_status(&app, &status_of(inner)),
            ).await {
                logging!(error, Type::Service, "Tono: signed-out recovery incomplete: {error}");
            }
            return;
        }
        TokenProbe::HasToken => {}
    }

    {
        let mut inner = state.lock().await;
        if inner.sign_in_generation != generation {
            return;
        }
        inner.account_state = AccountState::Restoring;
        emit_status(&app, &status_of(&inner));
    }

    let account_result = match tokio::time::timeout_at(restore_deadline, client.me()).await {
        Ok(result) => result,
        Err(_) => {
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return;
            }
            apply_stored_protection(&mut inner, &protection);
            inner.account_state =
                AccountState::Error(format!("session restore exceeded {RESTORE_TRANSACTION_TIMEOUT:?}"));
            emit_status(&app, &status_of(&inner));
            return;
        }
    };

    match account_result {
        Ok(me) => {
            let info = account_info_of(&me.user);
            {
                let mut inner = state.lock().await;
                if inner.sign_in_generation != generation {
                    return;
                }
                state.audit().activate_log_upload_owner(&me.user.id);
                inner.account = Some(me.user);
                inner.account_state = if info.suspended {
                    AccountState::Suspended
                } else {
                    AccountState::Ready
                };
                apply_stored_protection(&mut inner, &protection);
                emit_status(&app, &status_of(&inner));
            }
            if !info.suspended {
                match tokio::time::timeout_at(
                    restore_deadline,
                    catalog_sync::sync_with_retries_for_auth_generation(&state, &app, generation),
                )
                .await
                {
                    Ok(Ok(())) => {}
                    Ok(Err(err)) => logging!(warn, Type::Service, "Tono: 会话恢复后的目录同步失败: {err}"),
                    Err(_) => logging!(
                        warn,
                        Type::Service,
                        "Tono: 会话恢复目录同步达到 {RESTORE_TRANSACTION_TIMEOUT:?} 总预算；继续使用已验证缓存"
                    ),
                }
                if state.lock().await.sign_in_generation != generation {
                    return;
                }
                match tokio::time::timeout_at(
                    restore_deadline,
                    crate::tono::policy_sync::sync_with_retries_for_auth_generation(&state, &app, generation),
                )
                .await
                {
                    Ok(Ok(())) => {}
                    Ok(Err(err)) => logging!(warn, Type::Service, "Tono: 会话恢复后的策略同步失败: {err}"),
                    Err(_) => logging!(
                        warn,
                        Type::Service,
                        "Tono: 会话恢复策略同步达到 {RESTORE_TRANSACTION_TIMEOUT:?} 总预算；继续使用已验证缓存"
                    ),
                }
                if state.lock().await.sign_in_generation != generation {
                    return;
                }
                catalog_sync::spawn_periodic_for_auth_generation(&state, &app, generation).await;
                // A repair/restart deliberately preserves active intent, but this process no
                // longer has the old session token or controller secret. Re-prove the live
                // current-owner runtime, then schedule the ordinary fully verified replacement;
                // the restore task does not await that potentially long connection transaction.
                match update_recovery {
                    Ok(Some(tono_service_protocol::update_contract::Protection::Connected)) => {
                        let state = state.clone();
                        let app = app.clone();
                        AsyncHandler::spawn(move || async move {
                            if let Err(error) = connection::connect(state, app).await {
                                logging!(warn, Type::Service, "Update recovery remains incomplete: {error}");
                            }
                        });
                    }
                    Ok(None) => connection::schedule_startup_resume_if_proven(&state, &app, generation).await,
                    // An offline obligation must stay offline. Failed adoption
                    // cannot grant reconnect by falling through legacy restore.
                    _ => {}
                }
                crate::tono::telemetry::spawn_periodic_for_auth_generation(&state, &app, generation)
                    .await;
                crate::tono::log_upload::spawn_periodic_for_auth_generation(
                    &state, &app, generation,
                )
                .await;
            }
        }
        Err(ApiError::Unauthorized) => {
            let release_app = app.clone();
            close_dead_restore_with(state, generation,
                move |state| async move { connection::release_for_account(&state, &release_app).await },
                |client| async move { client.logout().await.map_err(|error| error.to_string()) },
                move |inner| emit_status(&app, &status_of(inner)),
            ).await;
        }
        Err(err) => {
            // Flaky network must never drop protection (§2).
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return;
            }
            apply_stored_protection(&mut inner, &protection);
            inner.account_state = match &protection {
                StoredProtection::Unknown(reason) => {
                    AccountState::Error(format!("{err}; {}", unknown_protection_message(reason)))
                }
                _ => AccountState::Error(err.to_string()),
            };
            emit_status(&app, &status_of(&inner));
        }
    }
}

/// The actual expired-session cleanup; only system I/O is injected by regressions.
async fn close_dead_restore_with<R, RF, L, LF, E>(
    state: Arc<TonoState>, generation: u64, release: R, logout: L, emit: E,
) where
    R: FnOnce(Arc<TonoState>) -> RF + Send + 'static,
    RF: std::future::Future<Output = Result<(), String>> + Send + 'static,
    L: FnOnce(Arc<crate::tono::state::TonoApiClient>) -> LF + Send + 'static,
    LF: std::future::Future<Output = Result<(), String>> + Send + 'static,
    E: Fn(&TonoInner) + Send + Sync + 'static,
{
    if let Err(error) = super::account::close_account_with(
        state, super::account::AccountCloseReason::Expired { generation },
        release, logout, |_, _| async {}, emit,
    ).await {
        logging!(error, Type::Service, "Tono: expired-session cleanup not complete: {error}");
    }
}

#[cfg(test)]
mod account_close_tests {
    use super::*;

    #[tokio::test]
    async fn expired_restore_reserves_account_ownership_before_its_first_side_effect() {
        let state = Arc::new(TonoState::for_test());
        state.lock().await.sign_in_generation = 7;
        let (entered, at_release) = tokio::sync::oneshot::channel();
        let (resume, resumed) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(close_dead_restore_with(Arc::clone(&state), 7,
            move |state| async move {
                entered.send(()).unwrap();
                resumed.await.unwrap();
                state.lock().await.fsm.sign_out_or_quit();
                Ok(())
            }, |_| async { Ok(()) }, |_| {},
        ));
        at_release.await.unwrap();
        let closed = state.lock().await.account_close.is_some();
        resume.send(()).unwrap();
        task.await.unwrap();
        assert!(closed, "restore cannot allow a replacement account before release/logout settles");
        assert_eq!(state.lock().await.account_state, AccountState::SignedOut);
        state.lock().await.sign_in_generation = 20;
        close_dead_restore_with(Arc::clone(&state), 7,
            |_| async { panic!("stale restore cannot release replacement resources") },
            |_| async { panic!("stale restore cannot revoke replacement credentials") }, |_| {},
        ).await;
        assert_eq!(state.lock().await.sign_in_generation, 20);
    }
}

/// L2: retry entry for the `error` account state — re-runs the startup
/// restore flow (token probe → `me()` → catalog sync).
#[tauri::command]
pub async fn tono_retry_restore(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    state.audit().log(AuditEvent::RetryRestore);
    load_credentials(state.inner()).await;
    restore_session(app.clone(), state.inner().clone()).await;
    // R2-F2: a retried restore can re-enter armed Protected Offline just like the startup
    // pass; keep the Service-truth poll registered for whatever state it settled on.
    connection::ensure_protection_resync(state.inner(), &app).await;
    Ok(())
}

/// L7: the spawned restore must never die silently in `restoring` — a
/// panic lands the account in `error` (retryable) instead. The vault
/// hydrate runs first (bounded), so restore never touches the keyring
/// itself.
pub async fn restore_session_guarded(app: AppHandle, state: Arc<TonoState>) {
    use futures::FutureExt as _;

    crate::tono::update_handoff::retire_completed_legacy_journal(env!("CARGO_PKG_VERSION"));
    load_credentials(&state).await;
    crate::tono::bootstrap::hydrate_learned_pins_from_service().await;
    let client = { Arc::clone(&state.lock().await.client) };
    let _ = client.transport().refresh_control_plane_pins().await;
    let outcome = std::panic::AssertUnwindSafe(restore_session(app.clone(), state.clone()))
        .catch_unwind()
        .await;
    if let Err(payload) = outcome {
        logging!(error, Type::Service, "Tono: 会话恢复任务 panic: {payload:?}");
        let mut inner = state.lock().await;
        // A superseding sign-in/sign-out owns any newer state. Only the restore state itself may
        // be converted into this error; a late panic must not overwrite an established session.
        if matches!(inner.account_state, AccountState::Restoring) {
            inner.account_state = AccountState::Error("session restore panicked".to_string());
            emit_status(&app, &status_of(&inner));
        }
    }
    // R2-F2: startup restore is the surviving-App entry into armed-unverified Protected
    // Offline (`apply_stored_protection` on an Armed/Unknown probe, an account error that
    // keeps protection, or a release the dead-session cleanup failed to prove). Whatever
    // idle blocked state restore settled on must hold its Service-truth poll: a later
    // Service restart retires an unverified barrier and nothing else would re-read that.
    connection::ensure_protection_resync(&state, &app).await;
}
