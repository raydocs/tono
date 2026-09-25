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
/// the catalog from the verified cache, then refresh + `me()`. A 401 suspends
/// the account and other errors enter the error state; neither releases the
/// kill switch or signs out. If the Service still wants the
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
        connection::remove_legacy_runtime_copy(&inner.catalog_dir);
        emit_status(&app, &status_of(&inner));
        inner.sign_in_generation
    };

    // Three-valued on purpose: armed / proven absent / unknown. This used to be an
    // `Option<KillSwitchStatus>` where every failure mode became `None`, and `None` reads as
    // "there is no barrier" everywhere below.
    let protection = probe_stored_protection(restore_deadline).await;

    let release_app = app.clone();
    let emit_app = app.clone();
    let Some((info, offline)) = restore_account_with(
        &state, generation, &protection, restore_deadline,
        |client| async move { client.me().await },
        move |state| async move { connection::release_for_account(&state, &release_app).await },
        |client| async move { client.logout().await.map_err(|error| error.to_string()) },
        move |inner| emit_status(&emit_app, &status_of(inner)),
    )
    .await
    else {
        return;
    };
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
        // An offline launch has no account to upload for yet. The account read that follows the
        // server accepting the session starts it (#582), so it is never started twice.
        if !offline {
            crate::tono::log_upload::spawn_periodic_for_auth_generation(
                &state, &app, generation,
            )
            .await;
        }
    }
}

/// Commit a `me()` answer as this session's account: its log-upload owner, the payload, and
/// Suspended when the payload says so.
fn commit_account(state: &TonoState, inner: &mut TonoInner, user: User, suspended: bool) {
    state.audit().activate_log_upload_owner(&user.id);
    inner.account = Some(user);
    inner.account_state = if suspended {
        AccountState::Suspended
    } else {
        AccountState::Ready
    };
}

/// How often a session that has left offline mode retries reading its account.
const OFFLINE_ACCOUNT_RETRY: Duration = Duration::from_secs(60);

/// Whether the account read of an offline admission is still owed to `generation`: the Ready
/// session it admitted, with no account. A refusal, a sign-out or a new sign-in ends it.
fn offline_account_owed(inner: &TonoInner, generation: u64) -> bool {
    inner.sign_in_generation == generation && inner.account.is_none() && inner.account_state == AccountState::Ready
}

/// #582: an offline admission has no account (`offline_account_info`). Once the server accepts
/// the session, finish what restore's `me()` would have: commit the account, publish it, and
/// start the log upload restore could not start without it, for this sign-in generation only.
async fn complete_offline_account(state: Arc<TonoState>, app: AppHandle, generation: u64) {
    let me = loop {
        let client = {
            let inner = state.lock().await;
            if !offline_account_owed(&inner, generation) {
                return;
            }
            inner.client.clone()
        };
        match client.me().await {
            Ok(me) => break me,
            // Unreachable again, or refused: a refusal suspends the account through the verdict
            // sink, which ends this loop at its next check.
            Err(error) => {
                logging!(warn, Type::Service, "Tono: the account was not read after leaving offline mode: {error}");
                tokio::time::sleep(OFFLINE_ACCOUNT_RETRY).await;
            }
        }
    };
    let info = account_info_of(&me.user);
    {
        let mut inner = state.lock().await;
        if !offline_account_owed(&inner, generation) {
            return;
        }
        commit_account(&state, &mut inner, me.user, info.suspended);
        emit_status(&app, &status_of(&inner));
    }
    if !info.suspended {
        crate::tono::log_upload::spawn_periodic_for_auth_generation(&state, &app, generation).await;
    }
}

/// Restore from the protection probe to the committed account state: the token probe, `me()`
/// inside the restore budget, and the dispatch of its result. Returns the restored account when
/// restore goes on to sync it, and whether it was admitted offline (no account read yet). Only
/// system I/O is injected: `me()`, the ordered barrier release, the server logout and the UI
/// emit.
#[allow(clippy::too_many_arguments, reason = "restore's system I/O is injected one boundary at a time")]
async fn restore_account_with<M, MF, R, RF, L, LF, E>(
    state: &Arc<TonoState>, generation: u64, protection: &StoredProtection,
    deadline: tokio::time::Instant, fetch_me: M, release: R, logout: L, emit: E,
) -> Option<(TonoAccountInfo, bool)>
where
    M: FnOnce(Arc<crate::tono::state::TonoApiClient>) -> MF,
    MF: std::future::Future<Output = Result<tono_core::auth::MeResponse, ApiError>>,
    R: FnOnce(Arc<TonoState>) -> RF + Send + 'static,
    RF: std::future::Future<Output = Result<(), String>> + Send + 'static,
    L: FnOnce(Arc<crate::tono::state::TonoApiClient>) -> LF + Send + 'static,
    LF: std::future::Future<Output = Result<(), String>> + Send + 'static,
    E: Fn(&TonoInner) + Send + Sync + 'static,
{
    let (client, probe) = {
        let inner = state.lock().await;
        if inner.sign_in_generation != generation {
            return None;
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
                return None;
            }
            apply_stored_protection(&mut inner, protection);
            let detail = inner
                .credential_error
                .clone()
                .unwrap_or_else(|| "unknown credential error".to_string());
            inner.account_state = match protection {
                // Two unknowns at once (a slow vault and a Service that is not up yet) is the
                // common boot case; report both rather than only the one we noticed first.
                StoredProtection::Unknown(reason) => AccountState::Error(format!(
                    "credential store unreadable: {detail}; {}",
                    unknown_protection_message(reason)
                )),
                _ => AccountState::Error(format!("credential store unreadable: {detail}")),
            };
            emit(&inner);
            return None;
        }
        TokenProbe::NoToken => {
            if let StoredProtection::Unknown(reason) = protection {
                // Never the silent signed-out path. Unknown here was the worst of the lot: it
                // skipped the release entirely and reported SignedOut over a possibly-live WFP
                // block, after which Disconnect was a success no-op and Quit exited computing
                // `protected == false`. Record it as armed so every release path stays
                // reachable, and say plainly that we do not know.
                let mut inner = state.lock().await;
                if inner.sign_in_generation != generation {
                    return None;
                }
                apply_stored_protection(&mut inner, protection);
                inner.account_state = AccountState::Error(unknown_protection_message(reason));
                emit(&inner);
                return None;
            }
            let release_needed = matches!(protection, StoredProtection::Armed(_));
            if release_needed {
                let mut inner = state.lock().await;
                if inner.sign_in_generation != generation {
                    return None;
                }
                apply_stored_protection(&mut inner, protection);
            }
            if let Err(error) = super::account::close_account_with(
                Arc::clone(state), super::account::AccountCloseReason::Missing { generation },
                move |state| async move {
                    if release_needed { release(state).await }
                    else { Ok(()) }
                },
                logout,
                |_, _| async {},
                emit,
            ).await {
                logging!(error, Type::Service, "Tono: signed-out recovery incomplete: {error}");
            }
            return None;
        }
        TokenProbe::HasToken => {}
    }

    {
        let mut inner = state.lock().await;
        if inner.sign_in_generation != generation {
            return None;
        }
        inner.account_state = AccountState::Restoring;
        // A new restore decides afresh whether this launch runs offline.
        inner.offline.leave_offline();
        emit(&inner);
    }

    let account_result = match tokio::time::timeout_at(deadline, fetch_me(client)).await {
        Ok(result) => result,
        Err(_) => {
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return None;
            }
            apply_stored_protection(&mut inner, protection);
            // #582: the budget elapsed without any server answer, so the control plane is unreachable.
            if let Some(admitted) = settle_unreachable_restore(&mut inner, protection) {
                emit(&inner);
                return admitted.then(|| (offline_account_info(), true));
            }
            inner.account_state =
                AccountState::Error(format!("session restore exceeded {RESTORE_TRANSACTION_TIMEOUT:?}"));
            emit(&inner);
            return None;
        }
    };

    match account_result {
        Ok(me) => {
            let info = account_info_of(&me.user);
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return None;
            }
            commit_account(state, &mut inner, me.user, info.suspended);
            apply_stored_protection(&mut inner, protection);
            emit(&inner);
            Some((info, false))
        }
        Err(error) => {
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return None;
            }
            let admitted = settle_failed_restore(&mut inner, protection, &error);
            emit(&inner);
            admitted.then(|| (offline_account_info(), true))
        }
    }
}

/// Restore's answer when `me()` fails; true when the account was admitted offline (#582).
/// Nothing here releases protection, signs out or deletes the stored session: the barrier stays
/// exactly as the Service holds it, with Disconnect ("Restore internet") still offered while it
/// blocks.
fn settle_failed_restore(inner: &mut TonoInner, protection: &StoredProtection, error: &ApiError) -> bool {
    apply_stored_protection(inner, protection);
    // #582: only an unreachable control plane may fall back to the offline grant. Any server
    // answer (401, 403, 5xx, an invalid body) keeps its own meaning below.
    if matches!(error, ApiError::Transport { .. })
        && let Some(admitted) = settle_unreachable_restore(inner, protection)
    {
        return admitted;
    }
    inner.account_state = match (error, protection) {
        // tono-core reports `Unauthorized` only after its own refresh was refused too. The Worker
        // answers that way for an expired plan, a used-up allowance, a disabled account and a
        // revoked device or session alike, so it is not proof the user wants protection gone.
        // The stored session is kept on purpose: without it the next launch would take the
        // no-token path, which releases the stored barrier.
        (ApiError::Unauthorized, _) => {
            logging!(warn, Type::Service, "Tono: the control plane refused the restored session; account suspended, protection kept");
            AccountState::Suspended
        }
        // Flaky network must never drop protection (§2).
        (_, StoredProtection::Unknown(reason)) => {
            AccountState::Error(format!("{error}; {}", unknown_protection_message(reason)))
        }
        _ => AccountState::Error(error.to_string()),
    };
    false
}

/// #582: the control plane could not be reached. `Some(true)`: Ready on a grant that matches
/// memory (offline verification). `Some(false)`: the grant records a revocation (Suspended).
/// `None`: no positive grant, so restore keeps its ordinary error. An unknown protection state
/// keeps that error too: it carries the only way out of a possibly live barrier.
fn settle_unreachable_restore(inner: &mut TonoInner, protection: &StoredProtection) -> Option<bool> {
    use crate::tono::offline_grant::OfflineAdmission;

    if matches!(protection, StoredProtection::Unknown(_)) {
        return None;
    }
    let token = inner.credentials.refresh_token().ok().flatten();
    let admission = inner.offline.admit(token.as_deref(), &inner.catalog_tracker, !inner.nodes.is_empty());
    match admission {
        OfflineAdmission::Admitted => {
            logging!(warn, Type::Service, "Tono: the control plane is unreachable; ready on the offline grant, protection kept");
            inner.account_state = AccountState::Ready;
            Some(true)
        }
        OfflineAdmission::Revoked(reason) => {
            logging!(warn, Type::Service, "Tono: the offline grant was revoked ({reason}); account suspended, protection kept");
            inner.account_state = AccountState::Suspended;
            Some(false)
        }
        OfflineAdmission::Refused(reason) => {
            logging!(info, Type::Service, "Tono: offline admission refused: {reason}");
            None
        }
    }
}

/// Offline there is no `me()`. Restore goes on as for a Ready account, so the periodic sync runs
/// and the first server answer ends offline mode; nothing downstream reads the email.
fn offline_account_info() -> TonoAccountInfo {
    TonoAccountInfo {
        email: String::new(),
        suspended: false,
        device_limit: i64::from(DEFAULT_DEVICE_LIMIT),
    }
}

#[cfg(test)]
mod rejected_session_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tono_core::auth::{ApiClient, ApiRequest, ApiResponse, AuthResponse, HttpTransport};
    use tono_core::credentials::CredentialStore as _;

    /// Answers every request as the Worker answers an ineligible account: 401.
    struct Rejecting(std::sync::Mutex<Vec<String>>);

    #[async_trait::async_trait]
    impl HttpTransport for Rejecting {
        async fn send(&self, request: ApiRequest) -> Result<ApiResponse, ApiError> {
            self.0.lock().unwrap().push(request.url);
            Ok(ApiResponse { status: 401, body: br#"{"error":{"message":"Session is no longer active","code":"UNAUTHORIZED"}}"#.to_vec() })
        }
    }

    /// H17-O-F2: the Worker answers 401 on `me` and on the refresh behind it for an expired
    /// plan, a used-up allowance, a disabled account and a revoked device alike. Restore must
    /// keep the barrier and the stored session, not run the release/logout it holds for the
    /// no-token path.
    #[tokio::test]
    async fn rejected_restore_suspends_and_keeps_protection() {
        let state = Arc::new(TonoState::for_test());
        let credentials = Arc::clone(&state.lock().await.credentials);
        let rejecting = ApiClient::new("https://api.example.test", Rejecting(Default::default()), credentials).unwrap();
        let auth: AuthResponse = serde_json::from_value(serde_json::json!({
            "accessToken": "fixture-access", "refreshToken": "persisted-session",
            "user": { "id": "fixture-owner", "email": "fixture@example.test" },
        })).unwrap();
        rejecting.adopt(&auth).await.unwrap();
        let barrier: KillSwitchStatus = serde_json::from_value(serde_json::json!({
            "wanted": true, "verified": true, "live": true, "mode": "blocked",
        })).unwrap();
        let generation = state.lock().await.sign_in_generation;
        let (released, logged_out) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
        let (release_seen, logout_seen) = (Arc::clone(&released), Arc::clone(&logged_out));

        let restored = restore_account_with(
            &state, generation, &StoredProtection::Armed(Box::new(barrier.clone())),
            tokio::time::Instant::now() + Duration::from_secs(10),
            |_| rejecting.me(),
            move |_| async move { release_seen.store(true, Ordering::SeqCst); Ok(()) },
            move |_| async move { logout_seen.store(true, Ordering::SeqCst); Ok(()) },
            |_| {},
        ).await;

        let requests = rejecting.transport().0.lock().unwrap().clone();
        assert!(matches!(requests.as_slice(), [me, refresh] if me.ends_with("/me") && refresh.ends_with("/auth/refresh")),
            "{requests:?}");
        assert!(restored.is_none());
        assert!(!released.load(Ordering::SeqCst), "a refused session must not release WFP");
        assert!(!logged_out.load(Ordering::SeqCst), "a refused session must not sign out");
        let inner = state.lock().await;
        assert_eq!(inner.account_state, AccountState::Suspended);
        assert!(inner.fsm.kill_switch_armed());
        assert!(inner.fsm.status().is_protection_blocked, "Restore internet stays offered");
        assert_eq!(inner.kill_switch.as_ref(), Some(&barrier));
        assert!(inner.account_close.is_none());
        assert_eq!(inner.credentials.refresh_token().unwrap().as_deref(), Some("persisted-session"),
            "the next launch must re-check this session, not take the no-token release path");
    }
}

#[cfg(test)]
mod offline_admission_tests {
    use super::*;
    use crate::tono::offline_grant::{
        GRANT_FILE_NAME,
        test_support::{ACCOUNT_A_UUID, ACCOUNT_B_UUID, account_catalog, data_dir, leave_verified_session, store_catalog},
        token_digest,
    };

    /// One launch over `dir` with the control plane unreachable: hydrate `refresh_token`, seed the
    /// catalog from disk, optionally rewrite the disk after seeding, then restore while `me()`
    /// fails in transport.
    async fn restore_unreachable(
        dir: &std::path::Path, refresh_token: &str, protection: StoredProtection,
        disk_after_seed: Option<&tono_core::ExitCatalogResponse>,
    ) -> (AccountState, Option<i64>) {
        let state = Arc::new(TonoState::for_test_in(dir.to_path_buf()));
        let generation = {
            let mut inner = state.lock().await;
            inner.credentials.set_local(CredentialKey::RefreshToken, refresh_token).unwrap();
            catalog_sync::seed_from_cache(&mut inner);
            inner.sign_in_generation
        };
        if let Some(catalog) = disk_after_seed {
            store_catalog(dir, catalog).await;
        }
        let restored = restore_account_with(
            &state, generation, &protection, tokio::time::Instant::now() + Duration::from_secs(10),
            |_| async {
                Err(ApiError::Transport {
                    kind: tono_core::auth::TransportKind::Connect,
                    message: "control plane blackholed".to_string(),
                })
            },
            |_| async { Ok(()) },
            |_| async { Ok(()) },
            |_| {},
        ).await;
        let inner = state.lock().await;
        assert_eq!(restored.is_some(), inner.account_state == AccountState::Ready,
            "only an admitted launch goes on to sync");
        (inner.account_state.clone(), status_of(&inner).offline_verified_at_ms)
    }

    /// #582 T3: with the control plane unreachable, restore is Ready (offline) only on a positive
    /// grant bound to the session token in memory and to the catalog seeded into memory.
    #[tokio::test]
    async fn unreachable_restore_is_ready_offline_only_on_a_grant_matching_memory() {
        let dir = data_dir("t3");
        let (catalog_a, catalog_b) = (account_catalog(ACCOUNT_A_UUID), account_catalog(ACCOUNT_B_UUID));
        leave_verified_session(&dir, &catalog_a, "session-a").await;
        let grant_path = dir.join(GRANT_FILE_NAME);
        let saved_grant = std::fs::read(&grant_path).unwrap();
        let known = || StoredProtection::ProvenAbsent;

        assert_eq!(restore_unreachable(&dir, "session-a", known(), None).await, (AccountState::Ready, Some(1_000)),
            "a matching grant admits offline, verified when the online session confirmed the catalog");

        std::fs::remove_file(&grant_path).unwrap();
        let (account, offline) = restore_unreachable(&dir, "session-a", known(), None).await;
        assert!(account != AccountState::Ready && offline.is_none(), "no grant: {account:?}");
        crate::tono::state::write_private_file(&grant_path, &saved_grant).unwrap();

        let (account, offline) = restore_unreachable(&dir, "session-b", known(), None).await;
        assert!(account != AccountState::Ready && offline.is_none(), "another session's token: {account:?}");

        // The disk catalog was replaced by account B's before this launch seeded it.
        store_catalog(&dir, &catalog_b).await;
        let (account, offline) = restore_unreachable(&dir, "session-a", known(), None).await;
        assert!(account != AccountState::Ready && offline.is_none(), "B's catalog under A's grant: {account:?}");

        // B's catalog was seeded, then the disk went back to A's: memory is what Connect dials.
        let (account, offline) = restore_unreachable(&dir, "session-a", known(), Some(&catalog_a)).await;
        assert!(account != AccountState::Ready && offline.is_none(), "disk re-read after seeding: {account:?}");

        let revoked_a = format!(
            r#"{{"verdict":"revoked","reason":"refused","at":2000,"token_sha256":"{}"}}"#,
            token_digest("session-a")
        );
        crate::tono::state::write_private_file(&grant_path, revoked_a.as_bytes()).unwrap();
        assert_eq!(restore_unreachable(&dir, "session-a", known(), None).await.0, AccountState::Suspended,
            "a revoked grant suspends");
        crate::tono::state::write_private_file(&grant_path, &saved_grant).unwrap();

        let (account, offline) =
            restore_unreachable(&dir, "session-a", StoredProtection::Unknown("pipe not found".to_string()), None).await;
        assert!(matches!(&account, AccountState::Error(message) if message.contains("emergency-disarm")) && offline.is_none(),
            "an unknown barrier keeps its way-out error: {account:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// #582 O3: a revocation binds the session it revoked. Session B launching offline over the
    /// tombstone of session A is neither suspended nor admitted: it keeps the ordinary error.
    #[tokio::test]
    async fn unreachable_restore_is_not_suspended_by_another_sessions_revocation() {
        let dir = data_dir("o3");
        store_catalog(&dir, &account_catalog(ACCOUNT_A_UUID)).await;
        let revoked_a = format!(
            r#"{{"verdict":"revoked","reason":"refused","at":2000,"token_sha256":"{}"}}"#,
            token_digest("session-a")
        );
        crate::tono::state::write_private_file(&dir.join(GRANT_FILE_NAME), revoked_a.as_bytes()).unwrap();

        let (account, offline) = restore_unreachable(&dir, "session-b", StoredProtection::ProvenAbsent, None).await;
        assert!(
            account != AccountState::Suspended && account != AccountState::Ready && offline.is_none(),
            "A's revocation must not decide B's launch: {account:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
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

    // #582: carries the tono-core verdict sink's refusals into the account state for the life of
    // this `TonoState` (this function runs once per state).
    let applier_app = app.clone();
    let applier_state = Arc::clone(&state);
    let (account_app, account_state) = (app.clone(), Arc::clone(&state));
    AsyncHandler::spawn(move || {
        crate::tono::offline_grant::apply_verdicts(
            applier_state,
            move |inner| emit_status(&applier_app, &status_of(inner)),
            move |generation| {
                let (state, app) = (Arc::clone(&account_state), account_app.clone());
                AsyncHandler::spawn(move || complete_offline_account(state, app, generation));
            },
        )
    });
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
    // keeps protection, or a release the signed-out recovery failed to prove). Whatever
    // idle blocked state restore settled on must hold its Service-truth poll: a later
    // Service restart retires an unverified barrier and nothing else would re-read that.
    connection::ensure_protection_resync(&state, &app).await;
}
