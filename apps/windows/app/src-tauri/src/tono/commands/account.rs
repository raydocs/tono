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
        credentials::{TonoCredentialStore, VaultSessionOwnership},
        state::{AccountState, TonoInner, TonoState},
    },
};
use super::*;
use super::diagnostics::auth_error;

pub async fn load_credentials(state: &Arc<TonoState>) {
    let rebind = load_credentials_from(state, || async {
        let refresh = TonoCredentialStore::get_session_async().await;
        let id = TonoCredentialStore::get_async(CredentialKey::InstallationId).await;
        (refresh, id)
    })
    .await;
    if rebind {
        // The marker now vouches for a session an earlier build stored roaming: bind it to this
        // machine off the load path. A failure leaves it roaming for the next load.
        tokio::spawn(TonoCredentialStore::bind_session_to_machine_async());
    }
}

type VaultRead = Result<Option<String>, tono_core::credentials::CredentialError>;
type SessionRead = Result<Option<crate::tono::credentials::StoredSession>, tono_core::credentials::CredentialError>;

/// Returns whether the adopted session was stored roaming by an earlier build and should now be
/// bound to this machine ([`VaultSessionOwnership::Owned`]).
async fn load_credentials_from<F, Fut>(state: &Arc<TonoState>, read: F) -> bool
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = (SessionRead, VaultRead)>,
{
    let generation = {
        let inner = state.lock().await;
        if inner.credentials_loaded || inner.account_close.is_some() {
            return false;
        }
        inner.sign_in_generation
    };
    let outcome = tokio::time::timeout(CREDENTIAL_LOAD_TIMEOUT, read()).await;

    let mut inner = state.lock().await;
    // Another hydration may have won while this vault read was in flight. More importantly,
    // sign-out or a newer login generation must not let a late startup read resurrect the old
    // refresh token in the memory-first credential store.
    if inner.credentials_loaded || inner.account_close.is_some() {
        return false;
    }
    if inner.sign_in_generation != generation {
        inner.credentials_loaded = true;
        return false;
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
        return false;
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
    let mut rebind = false;
    match refresh {
        Ok(Some(stored)) => {
            // Credential Manager outlives an uninstall that deletes the data directory, so a
            // token this directory never adopted is a previous installation's session — possibly
            // another person's account. Leave it unhydrated: restore then takes the signed-out
            // path, whose local logout wipe deletes it from the vault.
            // Written only for a signed-in account: the catalog and policy caches (sync), the
            // node selection, and the privacy settings (the settings page, or the account's log
            // upload scope). None is written by a signed-out first launch.
            let account_traces = [
                inner.catalog_cache().path().to_path_buf(),
                inner.policy_cache().path().to_path_buf(),
                crate::tono::state::selection_path(&inner.catalog_dir),
                inner.catalog_dir.join(crate::tono::audit::SETTINGS_FILE_NAME),
            ];
            match crate::tono::credentials::data_dir_owns_vault_session(
                &inner.catalog_dir, &account_traces, stored.legacy_roaming,
            ) {
                VaultSessionOwnership::Owned { rebind: roaming } => {
                    // Hydrate memory only — writing the same bytes back would
                    // risk another prompting vault call.
                    let _ = inner.credentials.set_local(CredentialKey::RefreshToken, &stored.token);
                    rebind = roaming;
                }
                VaultSessionOwnership::NotOwned => {
                    logging!(warn, Type::Service,
                        "Tono: ignoring a stored session this installation did not create; sign in again");
                }
                VaultSessionOwnership::Unrecorded => {
                    // Neither adopt (the token rotation would rewrite the roaming credential, the
                    // upgrade's only evidence) nor sign out: the M1 branch keeps protection and
                    // offers Retry, which re-reads with the gate still closed.
                    inner.credential_error =
                        Some("could not record this installation's stored session".to_string());
                    return false;
                }
            }
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
            return false;
        }
    }
    // The vault answered — including "there is nothing stored", which is a real answer. The
    // gate opens only here; startup was never blocked, because the read itself is bounded.
    inner.credentials_loaded = true;
    rebind
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
    let (client, installation_id, generation) = begin_sign_in(state.inner()).await?;
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
        if inner.account_close.is_some() {
            return Err("account sign-out is still reconciling".to_string());
        }
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

    let release_app = app.clone();
    let info = adopt_replacing_with(state.inner(), &client, generation, &challenge_id, &auth,
        move |state| async move { connection::release_for_account(&state, &release_app).await },
        |inner| emit_status(&app, &status_of(inner)),
    ).await?;
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

/// Account admission and adoption remain shared with the command path; only server/UI I/O
/// lives outside these boundaries. A replacement sign-in retires the previous account's runtime
/// in [`adopt_replacing_with`], after the new session is verified, not here.
pub(crate) async fn begin_sign_in(
    state: &Arc<TonoState>,
) -> Result<(Arc<crate::tono::state::TonoApiClient>, String, u64), String> {
    let mut inner = state.lock().await;
    if inner.account_close.is_some() {
        return Err("account sign-out is still reconciling".to_string());
    }
    inner.sign_in_generation = inner.sign_in_generation.wrapping_add(1);
    state.audit().abandon_log_upload_owner();
    Ok((inner.client.clone(), inner.installation_id.clone(), inner.sign_in_generation))
}

/// The caller has already written this sign-in's session marker pending, and commits it once the
/// session is durable ([`adopt_replacing_with`]). An error here means no session was stored.
pub(crate) async fn adopt_sign_in_response(
    state: &Arc<TonoState>, client: &Arc<crate::tono::state::TonoApiClient>,
    generation: u64, challenge_id: &str, auth: &tono_core::auth::AuthResponse,
    emit: impl FnOnce(&TonoInner),
) -> Result<TonoAccountInfo, String> {
    let info = account_info_of(&auth.user);
    let mut inner = state.lock().await;
    if inner.sign_in_generation != generation || inner.challenge_id.as_deref() != Some(challenge_id) {
        return Err("sign-in verification was superseded by a newer attempt".to_string());
    }
    // This sign-in may replace an account that never signed out ("use another email" from the
    // Suspended or Error screen), or follow a restore that seeded the previous account's cache.
    // That catalog carries the previous account's client UUIDs and residential SOCKS5
    // credentials: drop it as sign-out does, so Connect has no exits until this account's own
    // first sync installs them.
    catalog_sync::discard_account_catalog(&mut inner);
    connection::remove_legacy_runtime_copy(&inner.catalog_dir);
    // The retained connect failure belongs to the previous account too: diagnostics fall back to
    // it (#594), so clear it as sign-out does, or this account's report carries that account's
    // failure.
    inner.attempt_history = Default::default();
    // Keep the Tono state lock through adoption: a resend/sign-out cannot invalidate this
    // generation between the last check and the token write.
    // The refresh token is in memory and its vault write is only queued: the caller commits the
    // marker once that write is durable.
    client.adopt(auth).await.map_err(|err| err.to_string())?;
    // tono-core has retired the previous identity: its verdicts no longer apply (#582).
    inner.offline.adopt_new_identity();
    inner.challenge_id = None;
    inner.account = Some(auth.user.clone());
    // Attribute the first catalog/connect failures too, not only records
    // produced after the periodic uploader eventually starts.
    state.audit().activate_log_upload_owner(&auth.user.id);
    inner.catalog_last_synced_at_ms = None;
    inner.catalog_sync_error = None;
    inner.account_state = if info.suspended { AccountState::Suspended } else { AccountState::Ready };
    emit(&inner);
    Ok(info)
}

/// How long a sign-in waits for its refresh token to reach the vault before it reports the sign-in
/// as not saved ([`adopt_replacing_with`]).
const SIGN_IN_SAVE_TIMEOUT: Duration = Duration::from_secs(5);

/// Adopt a verified sign-in that may replace an account which never signed out. A tunnel still
/// running (or starting, or releasing) the previous account's runtime is retired first with
/// sign-out semantics: the connection generation is invalidated and `release` runs the ordered
/// DNS → Core → WFP release. A failed release refuses the adoption and keeps that protection
/// armed. An idle armed barrier (Protected Offline) has no runtime to retire and stays up.
pub(crate) async fn adopt_replacing_with<R, RF>(
    state: &Arc<TonoState>, client: &Arc<crate::tono::state::TonoApiClient>,
    generation: u64, challenge_id: &str, auth: &tono_core::auth::AuthResponse,
    release: R, emit: impl FnOnce(&TonoInner),
) -> Result<TonoAccountInfo, String>
where
    R: FnOnce(Arc<TonoState>) -> RF,
    RF: std::future::Future<Output = Result<(), String>>,
{
    let retire = {
        let mut inner = state.lock().await;
        if inner.sign_in_generation != generation || inner.challenge_id.as_deref() != Some(challenge_id) {
            return Err("sign-in verification was superseded by a newer attempt".to_string());
        }
        // The session marker before anything this sign-in cannot undo (retiring the previous
        // account's connection, dropping its catalog): a marker that cannot be written refuses
        // the sign-in with protection and the previous account untouched.
        let pending = inner.sign_in_marker_pending.is_some();
        let marker = crate::tono::credentials::record_sign_in_marker(&inner.catalog_dir, generation, pending).map_err(|error| {
            logging!(warn, Type::Service, "Tono: {error}");
            error
        })?;
        if marker == crate::tono::credentials::SignInMarker::Created {
            // Until this sign-in commits the marker behind a durable session or removes it, the
            // marker is its own.
            inner.sign_in_marker_pending = Some(generation);
        }
        let status = inner.fsm.status();
        let live = status.is_connected || status.is_connecting || status.is_disconnecting;
        if live {
            inner.invalidate_connection(true);
            inner.cancel_server_tests();
        }
        live
    };
    let released = if retire {
        release(Arc::clone(state)).await.map_err(|error| {
            format!("the previous account's connection was not released, so this sign-in was not adopted: {error}")
        })
    } else {
        Ok(())
    };
    let adopted = match released {
        Ok(()) => adopt_sign_in_response(state, client, generation, challenge_id, auth, emit).await,
        Err(error) => Err(error),
    };
    let info = match adopted {
        Ok(info) => info,
        Err(error) => {
            // No session was stored, so a marker this sign-in created must not vouch for what the
            // vault already held, even when a newer sign-in or restore superseded it. Kept only
            // when a newer sign-in took the marker over: that one commits or removes it.
            let mut inner = state.lock().await;
            if inner.sign_in_marker_pending == Some(generation)
                && crate::tono::credentials::undo_sign_in_marker(&inner.catalog_dir)
            {
                inner.sign_in_marker_pending = None;
            }
            return Err(error);
        }
    };
    // `client.adopt` only queued the refresh token's vault write. The marker vouches for the
    // session only once that write is durable; awaited without the state lock, as account close
    // awaits it.
    let credentials = Arc::clone(&state.lock().await.credentials);
    let durable = match tokio::time::timeout(SIGN_IN_SAVE_TIMEOUT, credentials.flush()).await {
        Ok(flushed) => flushed.map_err(|error| error.to_string()),
        Err(_) => Err(format!("the credential store did not answer within {SIGN_IN_SAVE_TIMEOUT:?}")),
    };
    let mut inner = state.lock().await;
    let saved = match durable {
        Ok(()) if inner.sign_in_marker_pending == Some(generation) => {
            let marker_dir = inner.catalog_dir.clone();
            let committed = crate::tono::credentials::commit_sign_in_marker(&marker_dir)
                .or_else(|_| crate::tono::credentials::commit_sign_in_marker(&marker_dir));
            if committed.is_ok() {
                inner.sign_in_marker_pending = None;
            }
            committed.map_err(|error| format!("the session marker was not committed: {error}"))
        }
        // A committed marker this machine already held vouches as it is (`Existing`); one a newer
        // sign-in took over is that sign-in's to commit or remove.
        Ok(()) => Ok(()),
        Err(error) => Err(error),
    };
    drop(inner);
    // Not saved: the marker stays pending, so the next launch asks for a sign-in instead of
    // vouching for whatever the vault holds. This process keeps the adopted session; nothing is
    // signed out or released here.
    saved.map(|()| info).map_err(|error| {
        let error = format!("TONO_SIGN_IN_NOT_SAVED: this sign-in was not saved on this PC, so the next launch asks to sign in again: {error}");
        logging!(warn, Type::Service, "Tono: {error}");
        error
    })
}

/// Sign out: bump the connect generation and abort every background task
/// first (H1/H2b), then release with disconnect semantics — DNS restore
/// must be proven and the release is owner-gated, never best-effort (M3,
/// C1). A failed release keeps the system armed and aborts the sign-out.
#[tauri::command]
pub async fn tono_sign_out(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    let release_app = app.clone();
    let resume_app = app.clone();
    close_account_with(state.inner().clone(), AccountCloseReason::User,
        move |state| async move { connection::release_for_account(&state, &release_app).await },
        |client| async move { client.logout().await.map_err(|error| error.to_string()) },
        move |state, generation| async move {
            catalog_sync::spawn_periodic_for_auth_generation(&state, &resume_app, generation).await;
            crate::tono::telemetry::spawn_periodic_for_auth_generation(&state, &resume_app, generation).await;
            crate::tono::log_upload::spawn_periodic_for_auth_generation(&state, &resume_app, generation).await;
        },
        move |inner| emit_status(&app, &status_of(inner)),
    ).await
}

/// System boundaries only: admission, task retirement, and account/FSM commits remain here.
#[derive(Clone, Copy)]
pub(super) enum AccountCloseReason {
    User,
    /// No token was loaded. Failed stored-protection release remains a retryable restore error.
    Missing { generation: u64 },
}

pub(super) async fn close_account_with<R, RF, L, LF, S, SF, E>(
    state: Arc<TonoState>, reason: AccountCloseReason, release: R, logout: L, resume: S, emit: E,
) -> Result<(), String>
where
    R: FnOnce(Arc<TonoState>) -> RF + Send + 'static,
    RF: std::future::Future<Output = Result<(), String>> + Send + 'static,
    L: FnOnce(Arc<crate::tono::state::TonoApiClient>) -> LF + Send + 'static,
    LF: std::future::Future<Output = Result<(), String>> + Send + 'static,
    S: FnOnce(Arc<TonoState>, u64) -> SF + Send + 'static,
    SF: std::future::Future<Output = ()> + Send + 'static,
    E: Fn(&TonoInner) + Send + Sync + 'static,
{
    use futures::FutureExt as _;
    let (client, credentials, generation, protected, operation) = {
        let mut inner = state.lock().await;
        if let AccountCloseReason::Missing { generation } = reason {
            if inner.sign_in_generation != generation {
                return Ok(());
            }
        }
        if let Some(operation) = inner.account_close.clone() {
            drop(inner);
            return wait_account_close(&operation).await;
        }
        inner.invalidate_connection(true);
        inner.sign_in_generation = inner.sign_in_generation.wrapping_add(1);
        state.audit().abandon_log_upload_owner();
        inner.tasks.abort_catalog_sync();
        inner.cancel_server_tests();
        let operation = Arc::new(crate::tono::state::LifecycleOperation::new(inner.sign_in_generation));
        inner.account_close = Some(Arc::clone(&operation));
        let protected = !matches!(reason, AccountCloseReason::User)
            || connection::sign_out_needs_release(inner.fsm.status(), inner.fsm.kill_switch_armed());
        (inner.client.clone(), inner.credentials.clone(), inner.sign_in_generation, protected, operation)
    };
    let completion = Arc::clone(&operation);
    // Spawn before the next await: no admitted close can be abandoned with its UI command.
    // The separate close slot outlives the shorter DNS/Core/WFP release operation.
    tokio::spawn(async move {
        let mut resume_account = false;
        let mut finalized = false;
        let result = std::panic::AssertUnwindSafe(async {
            let release_result = if protected { release(Arc::clone(&state)).await } else { Ok(()) };
            if release_result.is_err() {
                resume_account = matches!(reason, AccountCloseReason::User);
                // The Service refused the release, so the barrier is still up even when this
                // attempt never latched armed locally (the sign-out raced an in-flight
                // StartClash). Mark from the refusal so the closing `initial_release_failed`
                // keeps protection visible instead of reporting Not Connected over a
                // still-blocking WFP filter.
                state.lock().await.fsm.mark_kill_switch_armed();
                return release_result;
            }
            logout(client).await?;
            credentials.flush().await.map_err(|_| "local credential deletion was not acknowledged; retry sign-out".to_string())?;
            let mut inner = state.lock().await;
            inner.fsm.sign_out_or_quit();
            inner.account = None;
            inner.account_state = AccountState::SignedOut;
            inner.attempt_history = Default::default();
            inner.challenge_id = None;
            inner.controller_secret = None;
            inner.controller_port = None;
            connection::remove_legacy_runtime_copy(&inner.catalog_dir);
            if release_result.is_err() {
                inner.fsm.mark_kill_switch_armed();
            } else {
                inner.kill_switch = None;
            }
            inner.network_events_counter = None;
            inner.catalog_last_synced_at_ms = None;
            inner.catalog_sync_error = None;
            catalog_sync::discard_account_catalog(&mut inner);
            finalized = true;
            state.audit().log(AuditEvent::SignOut);
            release_result
        }).catch_unwind().await.unwrap_or_else(|_| Err("account close task failed; retry sign-out".to_string()));
        {
            let mut inner = state.lock().await;
            if result.is_err() {
                // Release not proven: retain the account and the armed latch, never hide it.
                inner.fsm.initial_release_failed();
                if !resume_account && !finalized {
                    inner.account_state = AccountState::Error("account close incomplete; retry restore or sign-out".to_string());
                }
            }
            inner.account_close = None;
            emit(&inner);
        }
        if resume_account {
            resume(Arc::clone(&state), generation).await;
        }
        completion.complete(result);
    });
    wait_account_close(&operation).await
}

async fn wait_account_close(operation: &crate::tono::state::LifecycleOperation) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(55), operation.wait()).await
        .unwrap_or_else(|_| Err("account close is still reconciling release or local credentials; login remains blocked until it settles".to_string()))
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use tokio::sync::oneshot;

    #[tokio::test]
    async fn fresh_data_dir_does_not_adopt_a_vault_refresh_token() {
        let state = Arc::new(TonoState::for_test());
        let vault = |legacy_roaming: bool| move || async move {
            let refresh: SessionRead = Ok(Some(crate::tono::credentials::StoredSession {
                token: "previous-install-session".to_string(),
                legacy_roaming,
            }));
            let id: VaultRead = Ok(Some("9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d".to_string()));
            (refresh, id)
        };
        load_credentials_from(&state, vault(false)).await;
        {
            let mut inner = state.lock().await;
            assert!(inner.credentials_loaded);
            assert_eq!(inner.credentials.refresh_token().unwrap(), None,
                "a session left in Credential Manager by an earlier installation must not sign this one in");
            // This installation's own sign-in marks the directory; its token is then restored.
            crate::tono::credentials::mark_vault_session_owned(&inner.catalog_dir).unwrap();
            inner.credentials_loaded = false;
        }
        load_credentials_from(&state, vault(false)).await;
        {
            let inner = state.lock().await;
            assert_eq!(inner.credentials.refresh_token().unwrap().as_deref(), Some("previous-install-session"));
            let _ = std::fs::remove_dir_all(&inner.catalog_dir);
        }

        // An earlier build signed in without a marker, storing the session roaming, and its catalog
        // sync never succeeded (offline, or 503 EXIT_IDENTITY_PROPAGATING), so there is no catalog
        // cache. Another account trace, here the policy cache, still makes the session this
        // installation's.
        let upgraded = Arc::new(TonoState::for_test());
        {
            let inner = upgraded.lock().await;
            std::fs::create_dir_all(&inner.catalog_dir).unwrap();
            assert!(!inner.catalog_cache().path().exists());
            std::fs::write(inner.policy_cache().path(), b"{}").unwrap();
        }
        load_credentials_from(&upgraded, vault(true)).await;
        let inner = upgraded.lock().await;
        assert_eq!(inner.credentials.refresh_token().unwrap().as_deref(), Some("previous-install-session"),
            "an upgrade must not sign out, and release the protection of, an account that never cached a catalog");
        let _ = std::fs::remove_dir_all(&inner.catalog_dir);
    }

    #[tokio::test]
    async fn account_close_waits_for_durable_deletion_and_reports_a_failed_acknowledgement() {
        use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
        use tono_core::credentials::{CredentialError, CredentialStore, MemoryCredentialStore};
        struct Vault {
            durable: MemoryCredentialStore,
            entered: tokio::sync::Notify,
            first: AtomicBool,
            gate: Mutex<std::sync::mpsc::Receiver<()>>,
        }
        impl CredentialStore for Vault {
            fn get(&self, key: CredentialKey) -> Result<Option<String>, CredentialError> { self.durable.get(key) }
            fn set(&self, key: CredentialKey, value: &str) -> Result<(), CredentialError> { self.durable.set(key, value) }
            fn delete(&self, key: CredentialKey) -> Result<(), CredentialError> {
                if self.first.swap(false, Ordering::SeqCst) {
                    self.entered.notify_one();
                    self.gate.lock().unwrap().recv_timeout(Duration::from_secs(5)).unwrap();
                    return Err(CredentialError::Store("injected delete refusal".into()));
                }
                self.durable.delete(key)
            }
        }
        let (release, gate) = std::sync::mpsc::channel();
        let vault = Arc::new(Vault {
            durable: MemoryCredentialStore::new(), entered: Default::default(),
            first: AtomicBool::new(true), gate: Mutex::new(gate),
        });
        vault.durable.set_refresh_token("persisted-old-session").unwrap();
        let state = Arc::new(TonoState::for_test());
        {
            let mut inner = state.lock().await;
            inner.credentials = Arc::new(crate::tono::credentials::SessionCredentialStore::with_test_vault(vault.clone()));
            inner.client = Arc::new(crate::tono::state::TonoApiClient::new(
                "https://api.example.test", crate::tono::transport::TonoTransport::new().unwrap(), inner.credentials.clone(),
            ).unwrap());
            // No live token: real ApiClient logout performs only its local wipe, with no HTTP.
            inner.account_state = AccountState::Ready;
        }
        let caller = tokio::spawn(close_account_with(Arc::clone(&state), AccountCloseReason::User,
            |_| async { Ok(()) },
            |client| async move { client.logout().await.map_err(|error| error.to_string()) },
            |_, _| async {}, |_| {},
        ));
        tokio::time::timeout(Duration::from_secs(2), vault.entered.notified()).await.unwrap();
        let close = state.lock().await.account_close.clone().expect("vault deletion still owns admission");
        assert!(!caller.is_finished(), "enqueue is not durable acknowledgement");
        caller.abort();
        let _ = caller.await;
        release.send(()).unwrap();
        assert!(tokio::time::timeout(Duration::from_secs(2), close.wait()).await.unwrap().is_err());
        assert!(matches!(state.lock().await.account_state, AccountState::Error(_)));
        assert_eq!(vault.durable.refresh_token().unwrap().as_deref(), Some("persisted-old-session"));
        close_account_with(Arc::clone(&state), AccountCloseReason::User,
            |_| async { Ok(()) },
            |client| async move { client.logout().await.map_err(|error| error.to_string()) },
            |_, _| async {}, |_| {},
        ).await.unwrap();
        assert_eq!(state.lock().await.account_state, AccountState::SignedOut);
        assert_eq!(vault.durable.refresh_token().unwrap(), None);
    }

    #[tokio::test]
    async fn sign_out_discards_the_account_issued_catalog() {
        let state = Arc::new(TonoState::for_test());
        let cache_path = {
            let mut inner = state.lock().await;
            inner.account_state = AccountState::Ready;
            inner.catalog_tracker = tono_core::CatalogTracker::from_installed(7, "account-a".into());
            inner.nodes = vec![tono_core::node::ValidatedNode {
                name: "Tokyo · Sakura".into(),
                server: std::net::Ipv4Addr::new(8, 8, 8, 8),
                port: 443,
                uuid: "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d".into(),
                servername: "www.microsoft.com".into(),
                flow: None,
                client_fingerprint: None,
                reality_public_key: "0123456789abcdef0123456789abcdef0123456789a".into(),
                reality_short_id: "0123456789abcdef".into(),
                protocol: tono_core::node::NodeProtocol::VlessReality,
                tls_fingerprint: None,
            }];
            inner.routing = Some(tono_core::CatalogRouting {
                home_socks5: Some(tono_core::CatalogHomeSocks5 {
                    host: "203.0.113.9".into(), port: 1080,
                    username: "account-a".into(), password: "account-a-secret".into(),
                }),
                ..Default::default()
            });
            let path = inner.catalog_cache().path().to_path_buf();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"{}").unwrap();
            path
        };
        close_account_with(Arc::clone(&state), AccountCloseReason::User,
            |_| async { Ok(()) }, |_| async { Ok(()) }, |_, _| async {}, |_| {},
        ).await.unwrap();
        let inner = state.lock().await;
        assert_eq!(inner.account_state, AccountState::SignedOut);
        assert!(inner.nodes.is_empty(), "the next account must not dial this account's exits");
        assert!(inner.routing.is_none(), "residential credentials must not survive sign-out");
        assert_eq!(inner.catalog_tracker.current_revision(), -1);
        assert!(!cache_path.exists(), "restart must not reseed the signed-out account's catalog");
        let _ = std::fs::remove_dir_all(&inner.catalog_dir);
    }

    #[tokio::test(start_paused = true)]
    async fn account_close_joins_release_past_the_ui_budget_before_reopening_admission() {
        let state = Arc::new(TonoState::for_test());
        {
            let mut inner = state.lock().await;
            inner.account_state = AccountState::Ready;
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
        }
        let (entered, at_release) = oneshot::channel();
        let (resume, resumed) = oneshot::channel();
        let operation = connection::coordinate_release(&state, None,
            move |_guard| async move {
                entered.send(()).unwrap();
                resumed.await.unwrap();
                Ok(())
            }, || async {},
        ).await;
        at_release.await.unwrap();
        let (joined, joining) = oneshot::channel();
        let caller = tokio::spawn(close_account_with(Arc::clone(&state), AccountCloseReason::User,
            move |_| async move {
                joined.send(()).unwrap();
                connection::complete_account_release(&operation).await
            },
            |_| async { Ok(()) }, |_, _| async {}, |_| {},
        ));
        joining.await.unwrap();
        let close = state.lock().await.account_close.clone().unwrap();
        tokio::time::advance(Duration::from_secs(56)).await;
        tokio::task::yield_now().await;
        let admission_closed = state.lock().await.account_close.is_some();
        caller.abort();
        let _ = caller.await;
        resume.send(()).unwrap();
        let result = close.wait().await;
        assert!(admission_closed, "a UI deadline cannot complete the detached account owner");
        assert_eq!(result, Ok(()), "late successful release must still finish sign-out");
        let inner = state.lock().await;
        assert_eq!(inner.account_state, AccountState::SignedOut);
        assert!(!inner.fsm.kill_switch_armed());
    }

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
        let caller = tokio::spawn(close_account_with(Arc::clone(&state), AccountCloseReason::User,
            |state| async move {
                state.lock().await.fsm.sign_out_or_quit(); // Service proved the release.
                Ok(())
            },
            move |_| async move {
                entered.send(()).unwrap();
                let _ = resumed.await;
                Ok(())
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
            connection::begin_attempt(&mut inner, generation).await.is_some()
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
        let result = close_account_with(Arc::clone(&state), AccountCloseReason::User,
            |_| async { Err("DNS restore failed".into()) },
            |_| async { panic!("logout must not run after a failed explicit release") },
            |_, _| async {}, |_| {},
        ).await;
        assert_eq!(result, Err("DNS restore failed".into()));
        let inner = state.lock().await;
        assert_eq!(inner.account_state, AccountState::Ready);
        assert!(inner.fsm.kill_switch_armed());
    }

    #[tokio::test]
    async fn sign_out_removes_the_runtime_copy_that_holds_the_account_exit_credentials() {
        let state = Arc::new(TonoState::for_test());
        let copy = {
            let mut inner = state.lock().await;
            inner.account_state = AccountState::Ready;
            std::fs::create_dir_all(&inner.catalog_dir).unwrap();
            let copy = inner.catalog_dir.join("owned-runtime.redacted.yaml");
            std::fs::write(&copy, b"proxies:\n- name: Tono-Claude-Home\n  username: account-a\n  password: account-a-secret\n").unwrap();
            copy
        };
        close_account_with(Arc::clone(&state), AccountCloseReason::User,
            |_| async { Ok(()) }, |_| async { Ok(()) }, |_, _| async {}, |_| {},
        ).await.unwrap();
        let inner = state.lock().await;
        assert_eq!(inner.account_state, AccountState::SignedOut);
        assert!(!copy.exists(), "the signed-out account's residential credentials must not stay on disk");
        let _ = std::fs::remove_dir_all(&inner.catalog_dir);
    }

    #[tokio::test]
    async fn replacement_sign_in_retires_the_previous_account_before_adopting() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let state = Arc::new(TonoState::for_test());
        let (cache_path, copy) = {
            let mut inner = state.lock().await;
            // Account A was suspended while its tunnel was up; the user signs in as B from the
            // paused-account screen without signing out.
            inner.account = Some(serde_json::from_value(serde_json::json!({
                "id": "account-a", "email": "a@example.test",
            })).unwrap());
            inner.account_state = AccountState::Suspended;
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            inner.catalog_tracker = tono_core::CatalogTracker::from_installed(7, "account-a".into());
            inner.nodes = vec![tono_core::node::ValidatedNode {
                name: "Tokyo · Sakura".into(),
                server: std::net::Ipv4Addr::new(8, 8, 8, 8),
                port: 443,
                uuid: "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d".into(),
                servername: "www.microsoft.com".into(),
                flow: None,
                client_fingerprint: None,
                reality_public_key: "0123456789abcdef0123456789abcdef0123456789a".into(),
                reality_short_id: "0123456789abcdef".into(),
                protocol: tono_core::node::NodeProtocol::VlessReality,
                tls_fingerprint: None,
            }];
            inner.routing = Some(tono_core::CatalogRouting {
                home_socks5: Some(tono_core::CatalogHomeSocks5 {
                    host: "203.0.113.9".into(), port: 1080,
                    username: "account-a".into(), password: "account-a-secret".into(),
                }),
                ..Default::default()
            });
            let cache_path = inner.catalog_cache().path().to_path_buf();
            std::fs::create_dir_all(cache_path.parent().unwrap()).unwrap();
            std::fs::write(&cache_path, b"{}").unwrap();
            let copy = inner.catalog_dir.join("owned-runtime.redacted.yaml");
            std::fs::write(&copy, b"proxies:\n- username: account-a\n  password: account-a-secret\n").unwrap();
            (cache_path, copy)
        };
        let (client, _, generation) = begin_sign_in(&state).await.unwrap();
        state.lock().await.challenge_id = Some("challenge-b".into());
        let auth: tono_core::auth::AuthResponse = serde_json::from_value(serde_json::json!({
            "accessToken": "fixture-access-b",
            "user": { "id": "account-b", "email": "b@example.test" },
        })).unwrap();
        let released = Arc::new(AtomicBool::new(false));
        let release_seen = Arc::clone(&released);
        adopt_replacing_with(&state, &client, generation, "challenge-b", &auth,
            move |state| async move {
                release_seen.store(true, Ordering::SeqCst);
                state.lock().await.fsm.sign_out_or_quit(); // Service proved the release.
                Ok(())
            },
            |_| {},
        ).await.unwrap();
        let inner = state.lock().await;
        assert!(released.load(Ordering::SeqCst), "A's running Core must be released before B is adopted");
        assert_eq!(inner.account.as_ref().unwrap().id, "account-b");
        assert!(!inner.fsm.status().is_connected, "B must not show A's tunnel as its own");
        assert!(inner.nodes.is_empty(), "B's Connect must not dial A's exits before B's first sync");
        assert!(inner.routing.is_none(), "A's residential credentials must not reach B");
        assert_eq!(inner.catalog_tracker.current_revision(), -1);
        assert!(!cache_path.exists(), "a restart must not reseed A's catalog under B");
        assert!(!copy.exists(), "A's runtime copy must not outlive the replacement sign-in");
        let _ = std::fs::remove_dir_all(&inner.catalog_dir);
    }

    #[tokio::test]
    async fn a_superseded_sign_in_leaves_no_marker_vouching_for_the_vault() {
        let state = Arc::new(TonoState::for_test());
        let directory = {
            let mut inner = state.lock().await;
            // A tunnel is starting, so adoption awaits its release: the gap in which a newer
            // sign-in or a restore retry bumps the sign-in generation.
            inner.fsm.begin_connect();
            inner.catalog_dir.clone()
        };
        let (client, _, generation) = begin_sign_in(&state).await.unwrap();
        state.lock().await.challenge_id = Some("challenge-a".into());
        let auth: tono_core::auth::AuthResponse = serde_json::from_value(serde_json::json!({
            "accessToken": "fixture-access-a",
            "user": { "id": "account-a", "email": "a@example.test" },
        })).unwrap();
        let adopted = adopt_replacing_with(&state, &client, generation, "challenge-a", &auth,
            |state| async move { begin_sign_in(&state).await.map(|_| ()) },
            |_| {},
        ).await;
        assert!(adopted.is_err(), "a superseded sign-in stores no session");
        // No newer sign-in stands on the marker A wrote: the next launch must not own whatever the
        // vault holds (a previous installation's session) on its word.
        let ownership = crate::tono::credentials::data_dir_owns_vault_session(&directory, &[], false);
        let _ = std::fs::remove_dir_all(&directory);
        assert_eq!(ownership, VaultSessionOwnership::NotOwned);
    }

    #[tokio::test]
    async fn a_sign_in_cut_off_before_storing_its_session_leaves_no_marker_vouching_for_the_vault() {
        let state = Arc::new(TonoState::for_test());
        let directory = {
            let mut inner = state.lock().await;
            inner.fsm.begin_connect();
            inner.catalog_dir.clone()
        };
        let (client, _, generation) = begin_sign_in(&state).await.unwrap();
        state.lock().await.challenge_id = Some("challenge-a".into());
        let auth: tono_core::auth::AuthResponse = serde_json::from_value(serde_json::json!({
            "accessToken": "fixture-access-a",
            "user": { "id": "account-a", "email": "a@example.test" },
        })).unwrap();
        // The process ends while the previous tunnel is released: nothing after that point runs,
        // so neither the session nor any undo of the marker happens.
        let cut_off = tokio::time::timeout(Duration::from_millis(100), adopt_replacing_with(
            &state, &client, generation, "challenge-a", &auth,
            |_| std::future::pending::<Result<(), String>>(),
            |_| {},
        )).await;
        assert!(cut_off.is_err(), "the release never finishes");
        // The next launch must not own whatever the vault holds (a previous installation's session)
        // on the word of a marker whose sign-in never stored its own.
        let ownership = crate::tono::credentials::data_dir_owns_vault_session(&directory, &[], false);
        let _ = std::fs::remove_dir_all(&directory);
        assert_eq!(ownership, VaultSessionOwnership::NotOwned);
    }

    #[tokio::test]
    async fn a_sign_in_whose_session_never_lands_in_the_vault_leaves_its_marker_pending() {
        use crate::tono::{credentials::SessionCredentialStore, state::TonoApiClient, transport::TonoTransport};
        use tono_core::credentials::CredentialError;
        // Credential Manager refuses the write: the refresh token the sign-in queued never lands.
        struct RefusingVault;
        impl tono_core::credentials::CredentialStore for RefusingVault {
            fn get(&self, _: CredentialKey) -> Result<Option<String>, CredentialError> { Ok(None) }
            fn set(&self, _: CredentialKey, _: &str) -> Result<(), CredentialError> {
                Err(CredentialError::Store("the vault refused the write".into()))
            }
            fn delete(&self, _: CredentialKey) -> Result<(), CredentialError> { Ok(()) }
        }
        let state = Arc::new(TonoState::for_test());
        let directory = {
            let mut inner = state.lock().await;
            inner.credentials = Arc::new(SessionCredentialStore::with_test_vault(Arc::new(RefusingVault)));
            inner.client = Arc::new(TonoApiClient::new(
                tono_core::auth::DEFAULT_BASE_URL, TonoTransport::new().unwrap(), inner.credentials.clone(),
            ).unwrap());
            // Account A signed in here before, so a committed marker vouches for A's session.
            crate::tono::credentials::mark_vault_session_owned(&inner.catalog_dir).unwrap();
            inner.catalog_dir.clone()
        };
        let (client, _, generation) = begin_sign_in(&state).await.unwrap();
        state.lock().await.challenge_id = Some("challenge-b".into());
        let auth: tono_core::auth::AuthResponse = serde_json::from_value(serde_json::json!({
            "accessToken": "fixture-access-b",
            "refreshToken": "fixture-refresh-b",
            "user": { "id": "account-b", "email": "b@example.test" },
        })).unwrap();
        let adopted = adopt_replacing_with(&state, &client, generation, "challenge-b", &auth,
            |_| async { Ok::<(), String>(()) },
            |_| {},
        ).await;
        let ownership = crate::tono::credentials::data_dir_owns_vault_session(&directory, &[], false);
        let _ = std::fs::remove_dir_all(&directory);
        assert!(adopted.is_ok(), "B is signed in for this run: {:?}", adopted.err());
        // The vault still holds A's refresh token: the next launch must neither restore A nor own
        // anything else on the word of a marker whose sign-in never reached the vault.
        assert_eq!(ownership, VaultSessionOwnership::NotOwned,
            "the next launch must ask for a sign-in, not restore a session B never stored");
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
