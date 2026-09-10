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
    let _ = crate::tono::update_handoff::begin_first_launch_migration(env!("CARGO_PKG_VERSION"));
    let restore_deadline = tokio::time::Instant::now() + RESTORE_TRANSACTION_TIMEOUT;
    let generation = {
        let mut inner = state.lock().await;
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
            if matches!(protection, StoredProtection::Armed(_)) {
                {
                    let mut inner = state.lock().await;
                    if inner.sign_in_generation != generation {
                        return;
                    }
                    apply_stored_protection(&mut inner, &protection);
                }
                if let Err(error) = connection::release_explicit(&state, &app).await {
                    let mut inner = state.lock().await;
                    if inner.sign_in_generation != generation {
                        return;
                    }
                    inner.account_state = AccountState::Error(format!(
                        "stored protection could not be released while signed out: {error}"
                    ));
                    emit_status(&app, &status_of(&inner));
                    return;
                }
                let mut inner = state.lock().await;
                // Generation first, like every sibling block: a user who signed in while the
                // startup release reconciled may already own a fresh connect transaction, and
                // `sign_out_or_quit` here would wipe its FSM mid-flight.
                if inner.sign_in_generation != generation {
                    return;
                }
                inner.fsm.sign_out_or_quit();
                inner.kill_switch = None;
            }
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return;
            }
            inner.account_state = AccountState::SignedOut;
            emit_status(&app, &status_of(&inner));
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
                if crate::tono::update_handoff::load_pending()
                    .is_some_and(|journal| journal.keep_kill_switch_armed)
                {
                    let _ = crate::tono::update_handoff::record_owner_phase(
                        crate::tono::update_handoff::Phase::ProtectionResuming,
                    );
                }
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
                connection::schedule_startup_resume_if_proven(&state, &app, generation).await;
                if crate::tono::update_handoff::load_pending()
                    .is_some_and(|journal| !journal.was_connected)
                {
                    crate::tono::update_handoff::commit_if_verified(env!("CARGO_PKG_VERSION"));
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
            // Dead session (§2): logout, disarm the kill switch, clear. The
            // release goes through the owner-gated route (C1); a failed
            // release keeps the system visibly armed and is logged loudly,
            // but the account is dead regardless and still clears.
            if state.lock().await.sign_in_generation != generation {
                return;
            }
            let release_error = connection::release_explicit(&state, &app).await.err();
            if let Some(err) = &release_error {
                logging!(
                    error,
                    Type::Service,
                    "Tono: 401 恢复时释放 Kill Switch 失败，系统仍受保护: {err}"
                );
            }
            if state.lock().await.sign_in_generation != generation {
                return;
            }
            client.logout().await;
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return;
            }
            inner.fsm.sign_out_or_quit();
            inner.account = None;
            inner.account_state = AccountState::SignedOut;
            if release_error.is_some() {
                inner.fsm.mark_kill_switch_armed();
            } else {
                inner.kill_switch = None;
            }
            emit_status(&app, &status_of(&inner));
            drop(inner);
            state.audit().log(AuditEvent::SignOut);
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

/// L2: retry entry for the `error` account state — re-runs the startup
/// restore flow (token probe → `me()` → catalog sync).
#[tauri::command]
pub async fn tono_retry_restore(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    state.audit().log(AuditEvent::RetryRestore);
    load_credentials(state.inner()).await;
    restore_session(app, state.inner().clone()).await;
    Ok(())
}

/// L7: the spawned restore must never die silently in `restoring` — a
/// panic lands the account in `error` (retryable) instead. The vault
/// hydrate runs first (bounded), so restore never touches the keyring
/// itself.
pub async fn restore_session_guarded(app: AppHandle, state: Arc<TonoState>) {
    use futures::FutureExt as _;

    load_credentials(&state).await;
    crate::tono::bootstrap::hydrate_learned_pins_from_service().await;
    {
        let inner = state.lock().await;
        let _ = inner.client.transport().refresh_control_plane_pins().await;
    }
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
}
