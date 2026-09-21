//! Domain Tauri commands. Wire names stay unchanged.

use std::{net::SocketAddr, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager as _};
use tono_logging::{Type, logging};
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
use super::diagnostics::auth_error;

pub async fn load_credentials(state: &Arc<TonoState>) {
    let generation = {
        let inner = state.lock().await;
        if inner.credentials_loaded {
            return;
        }
        inner.sign_in_generation
    };
    let outcome = tokio::time::timeout(CREDENTIAL_LOAD_TIMEOUT, async {
        let refresh = TonoCredentialStore::get_async(CredentialKey::RefreshToken).await;
        let id = TonoCredentialStore::get_async(CredentialKey::InstallationId).await;
        (refresh, id)
    })
    .await;

    let mut inner = state.lock().await;
    // Another hydration may have won while this vault read was in flight. More importantly,
    // sign-out or a newer login generation must not let a late startup read resurrect the old
    // refresh token in the memory-first credential store.
    if inner.credentials_loaded {
        return;
    }
    if inner.sign_in_generation != generation {
        inner.credentials_loaded = true;
        return;
    }
    // A fresh attempt must not inherit the previous verdict. Retry re-enters
    // here, and a stale error would outlive the condition that produced it.
    inner.credential_error = None;
    let Ok((refresh, id)) = outcome else {
        // A timeout is not an answer. Reading it as "no credentials" turned a slow Credential
        // Manager into a signed-out user, and latching the gate made that verdict stick until
        // the process restarted — including through `tono_retry_restore`, which re-enters here
        // and used to return immediately. Record it as a store error (the M1 branch, which
        // preserves protection and offers Retry) and leave the gate closed so a retry re-reads.
        inner.credential_error = Some(format!(
            "credential store did not answer within {CREDENTIAL_LOAD_TIMEOUT:?}"
        ));
        return;
    };
    // The installation id is independent of the refresh token and is handled
    // first, so the early return below cannot cost a persisted id — losing it
    // means the next sign-in presents a new device.
    match id {
        Ok(Some(persisted)) => {
            if let Ok(persisted) = normalize_installation_id(&persisted) {
                inner.installation_id = persisted;
            }
        }
        Ok(None) => {
            // First run: persist the in-memory id off-thread (§2).
            let installation_id = inner.installation_id.clone();
            tokio::spawn(async move {
                let _ = TonoCredentialStore::set_async(CredentialKey::InstallationId, &installation_id).await;
            });
        }
        Err(_) => {
            // The id is not auth-critical: keep the ephemeral one.
        }
    }
    match refresh {
        Ok(Some(token)) => {
            // Hydrate memory only — writing the same bytes back would
            // risk another prompting vault call.
            let _ = inner.credentials.set_local(CredentialKey::RefreshToken, &token);
        }
        Ok(None) => {}
        Err(err) => {
            // The same reasoning as the timeout branch above, which this one was
            // not updated to match. A store error is not an answer about whether
            // credentials exist, and opening the gate on it made the verdict
            // stick for the life of the process: `tono_retry_restore` re-enters
            // here, returns immediately on `credentials_loaded`, and re-emits the
            // identical error — so the Retry button the account-error screen
            // offers provably could not succeed, even after the vault recovered.
            inner.credential_error = Some(err.to_string());
            return;
        }
    }
    // The vault answered — including "there is nothing stored", which is a real answer. The
    // gate opens only here; startup was never blocked, because the read itself is bounded.
    inner.credentials_loaded = true;
}

/// Start email sign-in (`POST auth/email/start`, §1/§2).
/// Read-only prerequisite check, safe to call before and without connecting.
///
/// The App used to have no way to say why nothing worked when TonoService was not running; this
/// lets the UI name the cause — usually BFE having been switched off — instead of showing
/// "protected, not connected" with every field unknown.
/// Run the established elevated install/repair entry to get the Service running again.
///
/// This is the same path a connect takes when it finds the Service stopped, exposed so the shell
/// can offer it before the user has tried to connect and been told nothing useful. The installer
/// it runs also restores BFE, which is the dependency that most often blocks the start, so one
/// authorisation covers both.
#[tauri::command]
pub async fn tono_repair_service() -> Result<(), String> {
    crate::core::service::tono_service_ready_or_repair_now()
        .await
        .map_err(|error| super::connection::map_service_ready_error(&error))
}

#[tauri::command]
pub async fn tono_service_prerequisites() -> Result<crate::core::service::ServicePrerequisites, String> {
    query_service_prerequisites(crate::core::service::service_prerequisites).await
}

async fn query_service_prerequisites(
    provider: impl FnOnce() -> crate::core::service::ServicePrerequisites + Send + 'static,
) -> Result<crate::core::service::ServicePrerequisites, String> {
    // SCM calls are synchronous: async alone would still block the executor.
    tokio::task::spawn_blocking(provider)
        .await
        .map_err(|error| format!("service prerequisite query failed: {error}"))
}

#[cfg(test)]
mod prerequisite_tests {
    #[tokio::test(flavor = "current_thread")]
    async fn stalled_prerequisite_provider_does_not_block_control_work() {
        let control_thread = std::thread::current().id();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let query = tokio::spawn(super::query_service_prerequisites(move || {
            started.send(std::thread::current().id()).unwrap();
            // A bounded wait makes an accidental inline call fail instead of hanging CI.
            wait.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
            crate::core::service::ServicePrerequisites {
                service_running: false,
                service_registered: true,
                bfe_running: false,
            }
        }));
        let provider_thread = ready.await.unwrap();
        // This control work must run while the provider is still blocked.
        release.send(()).unwrap();
        assert_ne!(provider_thread, control_thread);
        let report = query.await.unwrap().unwrap();
        assert!(!report.service_running);
        assert!(report.service_registered);
        assert!(!report.bfe_running);
    }
}

#[tauri::command]
pub async fn tono_sign_in_start(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
    email: String,
) -> Result<TonoSignInChallenge, String> {
    // The installation id hydrates from the vault off-thread at startup;
    // wait for it so sign-in registers the stable device id.
    load_credentials(state.inner()).await;
    let (client, installation_id, generation) = {
        let mut inner = state.lock().await;
        inner.sign_in_generation = inner.sign_in_generation.wrapping_add(1);
        state.audit().abandon_log_upload_owner();
        (
            inner.client.clone(),
            inner.installation_id.clone(),
            inner.sign_in_generation,
        )
    };
    // Empty device name → the platform default ("Windows PC", §2).
    let challenge = client
        .start_email_sign_in(&email, "", &installation_id)
        .await
        .map_err(|err| {
            state.audit().log(crate::tono::audit::AuditEvent::SignInFail {
                stage: "requestCode",
                error: err.to_string(),
            });
            auth_error(&err)
        })?;

    let mut inner = state.lock().await;
    if inner.sign_in_generation != generation {
        return Err("sign-in request was superseded by a newer attempt".to_string());
    }
    inner.account_state = AccountState::Authenticating;
    inner.challenge_id = Some(challenge.challenge_id.clone());
    emit_status(&app, &status_of(&inner));
    drop(inner);
    // Local log only; the email is recorded verbatim, never the code.
    state.audit().log(AuditEvent::SignInStart { email });

    Ok(TonoSignInChallenge {
        challenge_id: challenge.challenge_id,
        expires_in: challenge.expires_in,
        message: challenge.message,
    })
}

/// Complete email sign-in (`POST auth/email/verify`); adopts the tokens and
/// kicks off the catalog sync (§2/§3).
#[tauri::command]
pub async fn tono_sign_in_verify(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
    email: String,
    code: String,
) -> Result<TonoAccountInfo, String> {
    let _ = email; // the challenge, not the address, identifies the attempt
    let (client, challenge_id, generation) = {
        let inner = state.lock().await;
        let challenge_id = inner
            .challenge_id
            .clone()
            .ok_or_else(|| "no sign-in is in progress".to_string())?;
        (inner.client.clone(), challenge_id, inner.sign_in_generation)
    };
    let auth = client
        .verify_email_sign_in(&challenge_id, &code)
        .await
        .map_err(|err| {
            state.audit().log(crate::tono::audit::AuditEvent::SignInFail {
                stage: "verifyCode",
                error: err.to_string(),
            });
            auth_error(&err)
        })?;

    let info = account_info_of(&auth.user);
    {
        let mut inner = state.lock().await;
        if inner.sign_in_generation != generation || inner.challenge_id.as_deref() != Some(challenge_id.as_str()) {
            return Err("sign-in verification was superseded by a newer attempt".to_string());
        }
        // Keep the Tono state lock through adoption: a resend/sign-out cannot invalidate this
        // generation between the last check and the token write.
        client.adopt(&auth).await.map_err(|err| err.to_string())?;
        inner.challenge_id = None;
        inner.account = Some(auth.user.clone());
        // Attribute the first catalog/connect failures too, not only records
        // produced after the periodic uploader eventually starts.
        state.audit().activate_log_upload_owner(&auth.user.id);
        inner.catalog_last_synced_at_ms = None;
        inner.catalog_sync_error = None;
        inner.account_state = if info.suspended {
            AccountState::Suspended
        } else {
            AccountState::Ready
        };
        emit_status(&app, &status_of(&inner));
    }
    state.audit().log(AuditEvent::SignInOk {
        email: auth.user.email.clone(),
    });

    if !info.suspended {
        let state = state.inner().clone();
        // §3: sync immediately on login; a failure here never fails sign-in.
        if let Err(err) = catalog_sync::sync_with_retries_for_auth_generation(&state, &app, generation).await {
            logging!(warn, Type::Service, "Tono: 登录后的目录同步失败: {err}");
        }
        if state.lock().await.sign_in_generation != generation {
            return Err("sign-in was superseded while syncing account data".to_string());
        }
        if let Err(err) =
            crate::tono::policy_sync::sync_with_retries_for_auth_generation(&state, &app, generation).await
        {
            logging!(warn, Type::Service, "Tono: 登录后的策略同步失败: {err}");
        }
        if state.lock().await.sign_in_generation != generation {
            return Err("sign-in was superseded while syncing account data".to_string());
        }
        catalog_sync::spawn_periodic_for_auth_generation(&state, &app, generation).await;
        crate::tono::telemetry::spawn_periodic_for_auth_generation(&state, &app, generation).await;
        crate::tono::log_upload::spawn_periodic_for_auth_generation(&state, &app, generation)
            .await;
    }
    Ok(info)
}

/// Sign out: bump the connect generation and abort every background task
/// first (H1/H2b), then release with disconnect semantics — DNS restore
/// must be proven and the release is owner-gated, never best-effort (M3,
/// C1). A failed release keeps the system armed and aborts the sign-out.
#[tauri::command]
pub async fn tono_sign_out(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    let release_app = app.clone();
    let resume_app = app.clone();
    sign_out_with(state.inner().clone(),
        move |state| async move { connection::release_explicit(&state, &release_app).await },
        |client| async move { client.logout().await },
        move |state, generation| async move {
            catalog_sync::spawn_periodic_for_auth_generation(&state, &resume_app, generation).await;
            crate::tono::telemetry::spawn_periodic_for_auth_generation(&state, &resume_app, generation).await;
            crate::tono::log_upload::spawn_periodic_for_auth_generation(&state, &resume_app, generation).await;
        },
        move |inner| emit_status(&app, &status_of(inner)),
    ).await
}

/// System boundaries only: admission, task retirement, and account/FSM commits remain here.
async fn sign_out_with<R, RF, L, LF, S, SF, E>(
    state: Arc<TonoState>, release: R, logout: L, resume: S, emit: E,
) -> Result<(), String>
where
    R: FnOnce(Arc<TonoState>) -> RF + Send + 'static,
    RF: std::future::Future<Output = Result<(), String>> + Send,
    L: FnOnce(Arc<crate::tono::state::TonoApiClient>) -> LF + Send + 'static,
    LF: std::future::Future<Output = ()> + Send,
    S: FnOnce(Arc<TonoState>, u64) -> SF + Send + 'static,
    SF: std::future::Future<Output = ()> + Send,
    E: Fn(&TonoInner) + Send + 'static,
{
    let (client, generation) = {
        let mut inner = state.lock().await;
        inner.invalidate_connection(true);
        inner.sign_in_generation = inner.sign_in_generation.wrapping_add(1);
        state.audit().abandon_log_upload_owner();
        inner.tasks.abort_catalog_sync();
        inner.cancel_server_tests();
        (inner.client.clone(), inner.sign_in_generation)
    };

    // M-1: the predicate covers an in-flight connect too, matching the
    // disconnect and quit paths.
    let protected = {
        let inner = state.lock().await;
        connection::sign_out_needs_release(inner.fsm.status(), inner.fsm.kill_switch_armed())
    };
    if protected {
        // Same sequence and same failure semantics as disconnect (M3): if
        // the release cannot be proven, stay armed and do not sign out.
        if let Err(err) = release(Arc::clone(&state)).await {
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return Err("sign-out was superseded by a newer authentication action".to_string());
            }
            // `initial_release_failed`, not `connect_failed`: for an armed-but-unverified
            // session the latter resolves to FullRelease and clears the armed latch even
            // though the Service release just failed (mirrors
            // `stay_armed_after_failed_release`).
            inner.fsm.initial_release_failed();
            emit(&inner);
            drop(inner);
            // L4: the user is still signed in — restart the catalog sync
            // that `abort_catalog_sync` just stopped.
            resume(Arc::clone(&state), generation).await;
            return Err(err);
        }
    }
    // Best-effort server logout, then local token wipe (§2; logout itself
    // is deliberately infallible).
    if state.lock().await.sign_in_generation != generation {
        return Err("sign-out was superseded by a newer authentication action".to_string());
    }
    logout(client).await;

    let mut inner = state.lock().await;
    if inner.sign_in_generation != generation {
        return Err("sign-out was superseded by a newer authentication action".to_string());
    }
    inner.fsm.sign_out_or_quit();
    inner.account = None;
    inner.account_state = AccountState::SignedOut;
    inner.attempt_history = Default::default();
    inner.challenge_id = None;
    inner.controller_secret = None;
    inner.controller_port = None;
    inner.kill_switch = None;
    inner.network_events_counter = None;
    inner.catalog_last_synced_at_ms = None;
    inner.catalog_sync_error = None;
    emit(&inner);
    drop(inner);
    state.audit().log(AuditEvent::SignOut);
    Ok(())
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use tokio::sync::oneshot;

    #[tokio::test]
    async fn sign_out_owns_admission_until_logout_finishes_even_without_its_caller() {
        let state = Arc::new(TonoState::for_test());
        {
            let mut inner = state.lock().await;
            inner.account_state = AccountState::Ready;
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
        }
        let (entered, at_logout) = oneshot::channel();
        let (release, resumed) = oneshot::channel();
        let (done, finished) = oneshot::channel();
        let done = std::sync::Mutex::new(Some(done));
        let caller = tokio::spawn(sign_out_with(Arc::clone(&state),
            |state| async move {
                state.lock().await.fsm.sign_out_or_quit(); // Service proved the release.
                Ok(())
            },
            move |_| async move {
                entered.send(()).unwrap();
                let _ = resumed.await;
            },
            |_, _| async {},
            move |inner| {
                if inner.account_state == AccountState::SignedOut {
                    if let Some(done) = done.lock().unwrap().take() { let _ = done.send(()); }
                }
            },
        ));
        at_logout.await.unwrap();
        let admitted = {
            let mut inner = state.lock().await;
            let generation = inner.connect_generation;
            connection::begin_attempt(&mut inner, generation).is_some()
        };
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        let _ = release.send(());
        let completion = tokio::time::timeout(Duration::from_secs(2), finished).await;
        assert!(!admitted, "release completion must not reopen Connect during server logout");
        assert!(matches!(completion, Ok(Ok(()))), "account close must outlive its UI waiter");
        let inner = state.lock().await;
        assert_eq!(inner.account_state, AccountState::SignedOut);
        assert!(!inner.fsm.status().is_connecting);
        assert!(!inner.fsm.kill_switch_armed());
        drop(inner);

        // Failure is the opposite contract: do not wipe the account or weaken protection.
        state.lock().await.account_state = AccountState::Ready;
        state.lock().await.fsm.mark_kill_switch_armed();
        let result = sign_out_with(Arc::clone(&state),
            |_| async { Err("DNS restore failed".into()) },
            |_| async { panic!("logout must not run after a failed explicit release") },
            |_, _| async {}, |_| {},
        ).await;
        assert_eq!(result, Err("DNS restore failed".into()));
        let inner = state.lock().await;
        assert_eq!(inner.account_state, AccountState::Ready);
        assert!(inner.fsm.kill_switch_armed());
    }
}

/// The current account, if signed in.
#[tauri::command]
pub async fn tono_account(state: tauri::State<'_, Arc<TonoState>>) -> Result<Option<TonoAccountInfo>, String> {
    let inner = state.lock().await;
    Ok(inner.account.as_ref().map(account_info_of))
}

/// Account devices across platforms (§2); any device except the current one
/// may be revoked.
#[tauri::command]
pub async fn tono_devices(state: tauri::State<'_, Arc<TonoState>>) -> Result<Vec<TonoDevice>, String> {
    let client = { state.lock().await.client.clone() };
    let devices = client.devices().await.map_err(|err| err.to_string())?;
    Ok(devices
        .devices
        .into_iter()
        .map(|device| TonoDevice {
            id: device.id,
            name: device.name,
            created_at: device.created_at,
            current: device.current.unwrap_or(false),
        })
        .collect())
}

/// Revoke a device by UUID (§2).
#[tauri::command]
pub async fn tono_revoke_device(state: tauri::State<'_, Arc<TonoState>>, id: String) -> Result<(), String> {
    let client = { state.lock().await.client.clone() };
    client.revoke_device(&id).await.map_err(|err| err.to_string())?;
    state.audit().log(AuditEvent::RevokeDevice { id });
    Ok(())
}
