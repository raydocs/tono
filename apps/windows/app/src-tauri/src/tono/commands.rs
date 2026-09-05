//! Tauri commands for the Tono product layer. All errors are plain strings
//! for the frontend; status changes are pushed via the `tono://status`
//! event (Tauri Emitter).

use std::{net::SocketAddr, sync::Arc, time::Duration};

use arc_swap::ArcSwapOption;
use tono_logging::{Type, logging};
use tono_service_protocol::KillSwitchStatus;
use futures::{StreamExt as _, stream};
use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Manager as _};
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

/// L2: only the unpreventable WM_ENDSESSION path uses this short outer budget. Interactive Quit
/// joins the ordinary release operation and cancels the exit when disarm cannot be proven.
pub(crate) const QUIT_RELEASE_BUDGET: std::time::Duration = std::time::Duration::from_millis(2500);
/// M3: bounded wait for the audit writer to drain once exit is committed. Named for the same
/// reason as `QUIT_RELEASE_BUDGET`: the committed-exit budget in `lib.rs` covers it.
pub(crate) const AUDIT_FLUSH_BUDGET: std::time::Duration = std::time::Duration::from_secs(2);
/// Absolute budget for startup authentication restore and its two cloud refreshes. Credential
/// hydration has its own three-second budget before this function starts. Read-only API work can
/// be cancelled safely; protection release keeps its separate reconciliation semantics.
const RESTORE_TRANSACTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Emitted on `tono://status` after every state change.
///
/// TS: `interface TonoStatus { accountState: string; uiState: string; stage: string | null; stageLabel: string | null; selectedServer: string | null; protectionBlocked: boolean; killSwitch: KillSwitchStatus | null; catalogRevision: number | null; catalogRequiresChoice: boolean; controllerGeneration: number }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoStatus {
    /// "restoring" | "signedOut" | "authenticating" | "ready" | "suspended" | "error"
    pub account_state: String,
    /// "notConnected" | "connecting" | "connected" | "protectedOffline" | "disconnecting"
    pub ui_state: String,
    /// ConnectStage key (e.g. "startingKillSwitch") while connecting.
    pub stage: Option<String>,
    /// Backend stage text shown on the connect pill.
    pub stage_label: Option<String>,
    pub selected_server: Option<String>,
    pub protection_blocked: bool,
    pub kill_switch: Option<KillSwitchStatus>,
    pub catalog_revision: Option<i64>,
    pub catalog_requires_choice: bool,
    /// Monotonic owner token for controller/WebSocket data. Never expose the controller secret.
    pub controller_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_org: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_location: Option<String>,
    /// `off` | `on` | `skipped` — whether the optional WeChat/web DIRECT overlay
    /// is live. `skipped` means the tunnel is up but China-direct was not installed.
    pub direct_overlay: String,
    /// HTTP generate_204 through the selected exit. Not TCP to the node.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_delay_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_delay_at_ms: Option<i64>,
    /// TCP connect to the selected node's :443. Independent of exit_delay_ms.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tcp_delay_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tcp_delay_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_home_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_home_host: Option<String>,
}

/// Last published immutable UI snapshot. The status command reads this without joining the large
/// product-state mutex, so a slow credential-store or transition commit cannot make the WebView
/// lose all progress/diagnostics. Writers still publish only fully assembled states.
static STATUS_SNAPSHOT: Lazy<ArcSwapOption<TonoStatus>> = Lazy::new(ArcSwapOption::empty);

/// Proof-of-life for the *WebView side* of the app, used by the main-thread pump watchdog.
///
/// `tono_status` is the one command the running UI calls on a fixed schedule whenever the window
/// is visible (`useTonoStatus`, 5 s safety-net poll plus every status push). A window that is
/// visible and has not invoked it for far longer than that has stopped executing JavaScript —
/// which is the one thing a "(Not Responding)" screenshot cannot tell us apart from a blocked
/// native main thread. Recording it costs one relaxed store per status read.
static PROCESS_START: Lazy<std::time::Instant> = Lazy::new(std::time::Instant::now);
static LAST_FRONTEND_IPC_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn note_frontend_ipc() {
    // +1 so "never called" stays distinguishable from "called in the first millisecond".
    let stamp = PROCESS_START.elapsed().as_millis().saturating_add(1) as u64;
    LAST_FRONTEND_IPC_MS.store(stamp, std::sync::atomic::Ordering::Relaxed);
}

/// How long since the WebView last invoked `tono_status`, or `None` if it never has.
pub(crate) fn frontend_ipc_silence() -> Option<std::time::Duration> {
    let last = LAST_FRONTEND_IPC_MS.load(std::sync::atomic::Ordering::Relaxed);
    if last == 0 {
        return None;
    }
    Some(
        PROCESS_START
            .elapsed()
            .saturating_sub(std::time::Duration::from_millis(last)),
    )
}

/// TS: `interface TonoSignInChallenge { challengeId: string; expiresIn: number; message: string }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoSignInChallenge {
    pub challenge_id: String,
    pub expires_in: i64,
    pub message: String,
}

/// TS: `interface TonoAccountInfo { email: string; suspended: boolean; deviceLimit: number }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoAccountInfo {
    pub email: String,
    pub suspended: bool,
    pub device_limit: i64,
}

/// TS: `interface TonoDevice { id: string; name: string; createdAt: number | null; current: boolean }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoDevice {
    pub id: String,
    pub name: String,
    pub created_at: Option<i64>,
    pub current: bool,
}

/// TS: `interface TonoServer { name: string; server: string; port: number; selected: boolean; available: boolean }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoServer {
    pub name: String,
    pub server: String,
    pub port: u16,
    pub selected: bool,
    /// False when the exit is known blocked (e.g. GFW); still listed so users see status.
    pub available: bool,
}

/// Account-scoped catalog metadata. A refresh failure never clears the verified revision/nodes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoCatalogStatus {
    pub revision: Option<i64>,
    pub node_count: usize,
    pub last_synced_at_ms: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoServerTestResult {
    pub name: String,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

const SERVER_TEST_CONCURRENCY: usize = 4;
const SERVER_TEST_TIMEOUT: Duration = Duration::from_secs(4);

/// Stable wire key for a connect stage (`TonoStatus.stage`).
pub fn stage_key(stage: ConnectStage) -> &'static str {
    match stage {
        ConnectStage::Preparing => "preparing",
        ConnectStage::PreparingService => "preparingService",
        ConnectStage::StartingKillSwitch => "startingKillSwitch",
        ConnectStage::StartingTunnel => "startingTunnel",
        ConnectStage::LockingTraffic => "lockingTraffic",
        ConnectStage::ApplyingCloudPolicy => "applyingCloudPolicy",
        ConnectStage::SecuringDns => "securingDNS",
        ConnectStage::CheckingExit => "checkingExit",
        ConnectStage::VerifyingTraffic => "verifyingTraffic",
    }
}

/// Stable wire key for the top-level UI state (`TonoStatus.uiState`).
pub fn ui_state_key(ui_state: UiState) -> &'static str {
    match ui_state {
        UiState::NotConnected => "notConnected",
        UiState::Connecting(_) => "connecting",
        UiState::Connected => "connected",
        UiState::ProtectedOffline => "protectedOffline",
        UiState::Disconnecting => "disconnecting",
    }
}

/// Snapshot the product state for the status command and the status event.
pub(crate) fn status_of(inner: &TonoInner) -> TonoStatus {
    let status = inner.fsm.status();
    let stage = status.stage;
    let revision = inner.catalog_tracker.current_revision();
    TonoStatus {
        account_state: inner.account_state.key().to_string(),
        ui_state: ui_state_key(status.ui_state()).to_string(),
        stage: stage.map(stage_key).map(str::to_string),
        stage_label: stage.map(|stage| stage.label().to_string()),
        selected_server: inner.selected_node.clone(),
        protection_blocked: status.is_protection_blocked,
        kill_switch: inner.kill_switch.clone(),
        catalog_revision: (revision >= 0).then_some(revision),
        catalog_requires_choice: inner.catalog_requires_choice,
        controller_generation: inner.controller_generation,
        exit_ip: inner.exit_ip.clone(),
        exit_org: inner.exit_org.clone(),
        exit_location: inner.exit_location.clone(),
        direct_overlay: if inner.optional_direct_active {
            "on".to_string()
        } else if inner.optional_direct_skip.is_some() {
            "skipped".to_string()
        } else {
            "off".to_string()
        },
        exit_delay_ms: inner.selected_exit_delay_ms(),
        exit_delay_at_ms: inner.selected_exit_delay_at_ms(),
        tcp_delay_ms: inner.selected_tcp_delay_ms(),
        tcp_delay_at_ms: inner.selected_tcp_delay_at_ms(),
        claude_home_active: if status.is_connected {
            Some(inner.routing.as_ref().map_or(false, |r| r.home_socks5.is_some() || r.home_proxy.is_some()))
        } else {
            None
        },
        claude_home_host: if status.is_connected {
            inner.routing.as_ref().and_then(|r| {
                r.home_socks5.as_ref().map(|s| s.host.clone())
                    .or_else(|| r.home_proxy.clone())
            })
        } else {
            None
        },
    }
}

pub(crate) fn emit_status(app: &AppHandle, status: &TonoStatus) {
    STATUS_SNAPSHOT.store(Some(Arc::new(status.clone())));
    if let Err(err) = app.emit("tono://status", status) {
        logging!(warn, Type::Service, "Tono: 状态事件发送失败: {err}");
    }
    // The tray is another projection of this same product state. Rebuild it asynchronously so
    // callers may continue publishing while holding the state mutex; the tray snapshot will run
    // after that guard is released and therefore cannot deadlock the connection transaction.
    AsyncHandler::spawn(|| async {
        if let Err(err) = crate::core::tray::Tray::global().update_menu().await {
            logging!(warn, Type::Tray, "Tono: failed to refresh tray status: {err:#}");
        }
        if let Err(err) = crate::core::tray::Tray::global().update_tooltip().await {
            logging!(warn, Type::Tray, "Tono: failed to refresh tray tooltip: {err:#}");
        }
    });
}

/// Epoch milliseconds now (F3 retry deadlines / failure timestamps).
pub fn epoch_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn account_info_of(user: &User) -> TonoAccountInfo {
    TonoAccountInfo {
        email: user.email.clone(),
        suspended: user.suspended.unwrap_or(false),
        device_limit: user.device_limit.unwrap_or(i64::from(DEFAULT_DEVICE_LIMIT)),
    }
}

/// Startup credential hydration budget: a prompting vault must never stall
/// the session restore (the macOS securityd deadlock this fixes).
const CREDENTIAL_LOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Restore-time token decision (M1): a vault error is not a missing token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenProbe {
    HasToken,
    NoToken,
    StoreError,
}

pub fn token_probe(credential_error: Option<&String>, refresh_token: Option<&String>) -> TokenProbe {
    if credential_error.is_some() {
        return TokenProbe::StoreError;
    }
    if refresh_token.is_some() {
        TokenProbe::HasToken
    } else {
        TokenProbe::NoToken
    }
}

/// Read the vault OFF the executor (one shared 3 s timeout for both keys),
/// hydrate the memory-first store, and record the outcome. Timeout reads as
/// "no credentials" — startup never blocks; store/join errors are recorded
/// for the M1 error branch. Idempotent: restore and sign-in both await it.
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
pub fn tono_service_prerequisites() -> crate::core::service::ServicePrerequisites {
    crate::core::service::service_prerequisites()
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
    let (client, generation) = {
        let mut inner = state.lock().await;
        inner.invalidate_connection(true);
        inner.sign_in_generation = inner.sign_in_generation.wrapping_add(1);
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
        if let Err(err) = connection::release_explicit(&state, &app).await {
            let mut inner = state.lock().await;
            if inner.sign_in_generation != generation {
                return Err("sign-out was superseded by a newer authentication action".to_string());
            }
            // `initial_release_failed`, not `connect_failed`: for an armed-but-unverified
            // session the latter resolves to FullRelease and clears the armed latch even
            // though the Service release just failed (mirrors
            // `stay_armed_after_failed_release`).
            inner.fsm.initial_release_failed();
            emit_status(&app, &status_of(&inner));
            drop(inner);
            // L4: the user is still signed in — restart the catalog sync
            // that `abort_catalog_sync` just stopped.
            catalog_sync::spawn_periodic_for_auth_generation(&state, &app, generation).await;
            crate::tono::telemetry::spawn_periodic_for_auth_generation(&state, &app, generation)
                .await;
            crate::tono::log_upload::spawn_periodic_for_auth_generation(&state, &app, generation)
                .await;
            return Err(err);
        }
    }
    // Best-effort server logout, then local token wipe (§2; logout itself
    // is deliberately infallible).
    if state.lock().await.sign_in_generation != generation {
        return Err("sign-out was superseded by a newer authentication action".to_string());
    }
    client.logout().await;

    let mut inner = state.lock().await;
    if inner.sign_in_generation != generation {
        return Err("sign-out was superseded by a newer authentication action".to_string());
    }
    inner.fsm.sign_out_or_quit();
    inner.account = None;
    inner.account_state = AccountState::SignedOut;
    inner.challenge_id = None;
    inner.controller_secret = None;
    inner.controller_port = None;
    inner.kill_switch = None;
    inner.network_events_counter = None;
    inner.catalog_last_synced_at_ms = None;
    inner.catalog_sync_error = None;
    emit_status(&app, &status_of(&inner));
    drop(inner);
    state.audit().log(AuditEvent::SignOut);
    Ok(())
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

/// Servers from the validated catalog, US/JP first, with the selection flag.
#[tauri::command]
pub async fn tono_servers(state: tauri::State<'_, Arc<TonoState>>) -> Result<Vec<TonoServer>, String> {
    let inner = state.lock().await;
    let order = catalog_sync::sort_server_names(&inner.nodes);
    Ok(order
        .into_iter()
        .filter_map(|name| {
            inner
                .nodes
                .iter()
                .find(|node| node.name == name)
                .map(|node| TonoServer {
                    name: node.name.clone(),
                    server: node.server.to_string(),
                    port: node.port,
                    selected: inner.selected_node.as_deref() == Some(node.name.as_str()),
                    available: !catalog_sync::is_exit_blocked(&node.name),
                })
        })
        .collect())
}

fn catalog_status_of(inner: &TonoInner) -> TonoCatalogStatus {
    let revision = inner.catalog_tracker.current_revision();
    TonoCatalogStatus {
        revision: (revision >= 0).then_some(revision),
        node_count: inner.nodes.len(),
        last_synced_at_ms: inner.catalog_last_synced_at_ms,
        error: inner.catalog_sync_error.clone(),
    }
}

#[tauri::command]
pub async fn tono_catalog_status(state: tauri::State<'_, Arc<TonoState>>) -> Result<TonoCatalogStatus, String> {
    let inner = state.lock().await;
    Ok(catalog_status_of(&inner))
}

/// User-initiated account-scoped refresh. This deliberately reuses catalog_sync's verified
/// fetch/install path; the command cannot install unverified bytes or bypass rollback checks.
#[tauri::command]
pub async fn tono_refresh_catalog(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<TonoCatalogStatus, String> {
    let generation = {
        let inner = state.lock().await;
        if !matches!(inner.account_state, AccountState::Ready) {
            return Err("sign in before refreshing cloud servers".to_string());
        }
        inner.sign_in_generation
    };
    let result = catalog_sync::sync_with_retries_for_auth_generation(state.inner(), &app, generation).await;
    let inner = state.lock().await;
    if inner.sign_in_generation != generation {
        return Err("catalog refresh was superseded by an account change".to_string());
    }
    result?;
    Ok(catalog_status_of(&inner))
}

async fn test_server_endpoint(
    name: String,
    address: SocketAddr,
    cancellation: tokio_util::sync::CancellationToken,
) -> TonoServerTestResult {
    let started = std::time::Instant::now();
    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err("cancelled".to_string()),
        result = tokio::time::timeout(SERVER_TEST_TIMEOUT, tokio::net::TcpStream::connect(address)) => {
            match result {
                Ok(Ok(stream)) => {
                    drop(stream);
                    Ok(started.elapsed().as_millis().max(1).min(u64::MAX as u128) as u64)
                }
                Ok(Err(error)) => Err(error.to_string()),
                Err(_) => Err("timeout".to_string()),
            }
        }
    };
    match result {
        Ok(latency_ms) => TonoServerTestResult {
            name,
            latency_ms: Some(latency_ms),
            error: None,
        },
        Err(error) => TonoServerTestResult {
            name,
            latency_ms: None,
            error: Some(error),
        },
    }
}

/// Measure each usable catalog endpoint without selecting it. This is allowed only while fully
/// disconnected and unarmed: connected WFP intentionally permits only the selected endpoint,
/// and widening that permit for a UI test would weaken the connection safety contract.
#[tauri::command]
pub async fn tono_test_available_servers(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<Vec<TonoServerTestResult>, String> {
    let (generation, auth_generation, catalog_revision, cancellation, nodes) = {
        let mut inner = state.lock().await;
        if !matches!(inner.account_state, AccountState::Ready) {
            return Err("sign in before testing servers".to_string());
        }
        if inner.fsm.status().is_connected || inner.fsm.status().is_connecting || inner.fsm.kill_switch_armed() {
            return Err("disconnect before testing all servers".to_string());
        }
        if inner.server_test_cancellation.is_some() {
            return Err("a server test is already running".to_string());
        }
        let nodes = inner
            .nodes
            .iter()
            .filter(|node| !catalog_sync::is_exit_blocked(&node.name))
            .map(|node| (node.name.clone(), SocketAddr::new(node.server.into(), node.port)))
            .collect::<Vec<_>>();
        inner.server_test_generation = inner.server_test_generation.wrapping_add(1);
        let generation = inner.server_test_generation;
        let cancellation = tokio_util::sync::CancellationToken::new();
        inner.server_test_cancellation = Some(cancellation.clone());
        (
            generation,
            inner.sign_in_generation,
            inner.catalog_tracker.current_revision(),
            cancellation,
            nodes,
        )
    };

    let mut results = stream::iter(nodes)
        .map(|(name, address)| test_server_endpoint(name, address, cancellation.clone()))
        .buffer_unordered(SERVER_TEST_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
    results.sort_by(|left, right| left.name.cmp(&right.name));

    let mut inner = state.lock().await;
    let owns_slot = inner.server_test_generation == generation;
    let stale = cancellation.is_cancelled()
        || !owns_slot
        || inner.sign_in_generation != auth_generation
        || inner.catalog_tracker.current_revision() != catalog_revision;
    if owns_slot {
        inner.server_test_cancellation = None;
    }
    if stale {
        return Err("server test cancelled or superseded".to_string());
    }
    if let Some(selected) = inner.selected_node.clone() {
        if let Some(result) = results.iter().find(|result| result.name == selected) {
            if let Some(latency_ms) = result.latency_ms {
                inner.record_tcp_delay(&selected, latency_ms);
                emit_status(&app, &status_of(&inner));
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub async fn tono_cancel_server_tests(state: tauri::State<'_, Arc<TonoState>>) -> Result<(), String> {
    let mut inner = state.lock().await;
    inner.cancel_server_tests();
    Ok(())
}

/// Select a server. Persists the choice (L4). What happens next is decided
/// by `connection::select_action` (H1): a same-node reselect with no
/// pending choice is a pure no-op; a real change while a tunnel is up
/// derives the §6 node switch as a registered task; a fresh pick in armed
/// Protected Offline (including after a catalog choice loss, M5) schedules
/// the protected reconnect. Generation, tasks, and the H-1 intent bit are
/// touched only when a transaction actually derives (M2).
#[tauri::command]
pub async fn tono_select_server(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
    name: String,
) -> Result<(), String> {
    let action = {
        let mut inner = state.lock().await;
        if !inner.nodes.iter().any(|node| node.name == name) {
            return Err("unknown server".to_string());
        }
        if catalog_sync::is_exit_blocked(&name) {
            return Err("this server is currently unavailable (network blocked)".to_string());
        }
        let previous = inner.selected_node.clone();
        let changed = previous.as_deref() != Some(name.as_str());
        let cleared_choice = inner.catalog_requires_choice;
        let action = connection::select_action(
            changed,
            cleared_choice,
            inner.fsm.status(),
            inner.fsm.kill_switch_armed(),
        );
        if action == connection::SelectAction::Noop {
            return Ok(());
        }
        if action == connection::SelectAction::Switch {
            if inner
                .tasks
                .switch
                .as_ref()
                .is_some_and(|task| !task.inner().is_finished())
            {
                // A hot switch mutates the selector and WFP across several
                // awaits. Replacing its JoinHandle only detaches it; it does not
                // cancel it, so two rapid choices could roll each other back and
                // leave the UI, selector, and permitted endpoints disagreeing.
                // Refuse before publishing or persisting the second choice. The
                // first task remains the sole owner and the user can retry as
                // soon as it settles.
                return Err("a server switch is already in progress".to_string());
            }
            inner.tasks.switch.take();
        }
        inner.selected_node = Some(name.clone());
        // A fresh user choice re-arms auto-reconnect (§3).
        inner.catalog_requires_choice = false;
        if action == connection::SelectAction::Reconnect {
            // The reconnect re-arms rather than releases (H-1 intent).
            inner.invalidate_connection(false);
            // Picking a city is the same evidence "Retry now" carries: someone is at the
            // machine and has just chosen a different exit. A spent ladder left
            // `schedule_reconnect` below with no rung to hand out, so it logged and returned
            // while this command still persisted the selection and reported success — the UI
            // confirmed a switch nothing had attempted. The unattended `reconnect_loop` is
            // bounded by the budget it consumes, not by this reset.
            inner.fsm.reset_reconnect_backoff();
        }
        let generation = inner.connect_generation;
        if let Err(err) = crate::tono::state::save_selection(&inner.catalog_dir, &name) {
            logging!(warn, Type::Service, "Tono: 选中节点持久化失败: {err}");
        }
        emit_status(&app, &status_of(&inner));
        // Spawned *and* registered under one guard. Registering after `drop(inner)` left a
        // window in which a concurrent `disconnect()` ran `abort_connection_tasks()` against an
        // empty switch slot and this line then installed a task nothing could abort — a node
        // switch surviving the disconnect that was supposed to cancel it, re-arming WFP behind
        // a completed release. The task's first act is to lock this same mutex, so it cannot
        // make progress before the guard is dropped below.
        if action == connection::SelectAction::Switch {
            let task_state = state.inner().clone();
            let task_app = app.clone();
            let from = previous.clone().unwrap_or_default();
            let to = name.clone();
            inner.tasks.switch = Some(AsyncHandler::spawn(move || async move {
                connection::switch_selected_node(task_state, task_app, generation, from, to).await;
            }));
        }
        drop(inner);
        if cleared_choice {
            state.audit().log(AuditEvent::RequiresChoiceCleared);
        }
        if action == connection::SelectAction::Switch
            && let Some(from) = previous
        {
            state.audit().log(AuditEvent::NodeSwitch { from, to: name.clone() });
        }
        action
    };

    match action {
        // Already spawned and registered above, under the guard.
        connection::SelectAction::Switch => {}
        connection::SelectAction::Reconnect => {
            connection::schedule_reconnect(&state, &app).await;
        }
        connection::SelectAction::Noop | connection::SelectAction::UpdateOnly => {}
    }
    Ok(())
}

/// Execute a fresh controller delay probe through the selected exit. This is intentionally
/// available only while Connected; cached legacy delay history is not presented as a new test.
#[tauri::command]
pub async fn tono_test_current_server(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<u64, String> {
    connection::test_current_server(state.inner(), &app).await
}

/// Run the §6 connect transaction.
#[tauri::command]
pub async fn tono_connect(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    connection::connect(state.inner().clone(), app).await
}

/// Explicit disconnect: restores DNS, then releases the kill switch (§6).
#[tauri::command]
pub async fn tono_disconnect(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    connection::disconnect(state.inner().clone(), app).await
}

/// F3 connect progress for the steps UI. Semantics: the *latest*
/// transaction's record — during an attempt it shows live step state; after
/// success all steps read completed; after a failure the failed step and
/// the sanitized error persist until the next attempt resets them; before
/// the first attempt all steps read pending.
///
/// TS: `interface TonoConnectStep { key: string; label: string; state: "pending" | "current" | "completed" | "failed"; elapsedMs: number | null }`
/// TS: `interface TonoConnectProgress { steps: TonoConnectStep[]; totalElapsedMs: number | null; failedStage: string | null; error: string | null; retryAttempt: number; nextRetryAtMs: number | null }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoConnectProgress {
    pub steps: Vec<crate::tono::steps::StepRecord>,
    pub total_elapsed_ms: Option<u64>,
    pub failed_stage: Option<String>,
    pub error: Option<String>,
    pub retry_attempt: u32,
    pub next_retry_at_ms: Option<i64>,
}

/// Connect progress (F3).
#[tauri::command]
pub async fn tono_connect_progress(state: tauri::State<'_, Arc<TonoState>>) -> Result<TonoConnectProgress, String> {
    let inner = state.lock().await;
    let current_elapsed_ms = inner
        .step_started_at
        .map(|started| started.elapsed().as_millis() as u64);
    let steps = crate::tono::steps::snapshot_with_current_elapsed(&inner.connect_steps, current_elapsed_ms);
    Ok(TonoConnectProgress {
        total_elapsed_ms: crate::tono::steps::total_elapsed_ms(&steps),
        steps,
        failed_stage: inner.failed_stage.map(str::to_string),
        error: inner.connect_error.clone(),
        retry_attempt: inner.retry_attempt,
        next_retry_at_ms: inner.next_retry_at_ms,
    })
}

/// F3: abort any scheduled reconnect and run one immediately (the normal
/// predicate still applies — armed + idle Protected Offline + no pending
/// catalog choice). Connected/Connecting is a success no-op.
#[tauri::command]
pub async fn tono_retry_now(state: tauri::State<'_, Arc<TonoState>>, app: AppHandle) -> Result<(), String> {
    retry_now(state.inner().clone(), app).await
}

/// Shared Protected Offline retry entry for IPC and native surfaces such as the tray. Keeping
/// this beside the command prevents either caller from bypassing the reconnect predicate.
pub async fn retry_now(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    {
        let mut inner = state.lock().await;
        if connection::retry_now_is_noop(inner.fsm.status()) {
            return Ok(());
        }
        inner.tasks.abort_reconnect();
    }
    // Not `schedule_reconnect`: that consumes a rung of the backoff ladder, so
    // aborting the pending attempt and then asking for the *next* delay made this
    // button strictly delay recovery.
    connection::retry_reconnect_now(&state, &app).await;
    Ok(())
}

/// Current product status (also pushed on `tono://status`).
#[tauri::command]
pub async fn tono_status(state: tauri::State<'_, Arc<TonoState>>) -> Result<TonoStatus, String> {
    note_frontend_ipc();
    if let Some(status) = STATUS_SNAPSHOT.load_full() {
        return Ok((*status).clone());
    }
    let inner = state.lock().await;
    Ok(status_of(&inner))
}

/// Close one connection only on the controller generation that supplied its row.
#[tauri::command]
pub async fn tono_close_connection(
    state: tauri::State<'_, Arc<TonoState>>,
    id: String,
    controller_generation: u64,
) -> Result<(), String> {
    connection::close_owned_controller_connection(&state, controller_generation, Some(&id)).await
}

/// Close all connections only on the controller generation represented by the Activity page.
#[tauri::command]
pub async fn tono_close_all_connections(
    state: tauri::State<'_, Arc<TonoState>>,
    controller_generation: u64,
) -> Result<(), String> {
    connection::close_owned_controller_connection(&state, controller_generation, None).await
}

/// How many times restore asks the Service about the stored barrier before giving up.
///
/// The Service restores WFP and reconciles its startup state *before* it begins serving IPC, so
/// on a BFE-dependent auto-start the pipe simply does not exist yet — and the app spawns restore
/// immediately at launch. One failed probe therefore means "not yet", not "no barrier".
const PROTECTION_PROBE_ATTEMPTS: usize = 5;
const PROTECTION_PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

/// What the Service could tell restore about a stored kill switch.
///
/// The third case is the whole point. Collapsing an IPC failure into "no barrier" makes every
/// downstream branch treat it as *proven disarmed*: the signed-out path skipped the release and
/// reported SignedOut + `killSwitch: null` + `protectionBlocked: false` over a live WFP block,
/// Disconnect then became a silent success no-op, and Quit computed `protected == false` and
/// exited — leaving the machine blocked with no owner and a UI insisting all was well.
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
fn unknown_protection_message(reason: &str) -> String {
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
    let _ = crate::tono::update_handoff::begin_first_launch_migration();
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
                    crate::tono::update_handoff::mark_committed();
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

/// §8: whether the local traffic audit is enabled (default on).
#[tauri::command]
pub async fn tono_audit_enabled(state: tauri::State<'_, Arc<TonoState>>) -> Result<bool, String> {
    Ok(state.audit().enabled())
}

/// §8: toggle the local traffic audit; persisted atomically to
/// `tono/settings.json` (L3: a persistence failure surfaces as an error and
/// leaves the switch as it was).
#[tauri::command]
pub async fn tono_set_audit_enabled(state: tauri::State<'_, Arc<TonoState>>, enabled: bool) -> Result<(), String> {
    state.audit().set_enabled(enabled)
}

/// Whether periodic cloud diagnostic timeline upload is enabled (default OFF).
#[tauri::command]
pub async fn tono_periodic_telemetry_enabled(
    state: tauri::State<'_, Arc<TonoState>>,
) -> Result<bool, String> {
    Ok(state.audit().periodic_telemetry_enabled())
}

/// Toggle periodic cloud diagnostic timeline upload (user can disable anytime).
#[tauri::command]
pub async fn tono_set_periodic_telemetry_enabled(
    state: tauri::State<'_, Arc<TonoState>>,
    enabled: bool,
) -> Result<(), String> {
    state.audit().set_periodic_telemetry_enabled(enabled)
}

/// Whether the raw audit log is uploaded.
#[tauri::command]
pub async fn tono_network_log_upload_enabled(
    state: tauri::State<'_, Arc<TonoState>>,
) -> Result<bool, String> {
    Ok(state.audit().network_log_upload_enabled())
}

/// Toggle uploading the raw audit log. Separate from the telemetry switch on
/// purpose: this one sends the log itself, and one consent must not stand in for
/// a materially larger disclosure.
#[tauri::command]
pub async fn tono_set_network_log_upload_enabled(
    state: tauri::State<'_, Arc<TonoState>>,
    enabled: bool,
) -> Result<(), String> {
    state.audit().set_network_log_upload_enabled(enabled)
}

/// §8: the JSONL audit file info (for the settings page / support bundle).
///
/// TS: `interface TonoAuditLogInfo { path: string; droppedCount: number }`
/// NOTE: this replaces the previous plain-string return of this command
/// (L2: the drop count is now observable); the frontend consumer must be
/// updated in step.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoAuditLogInfo {
    pub path: String,
    pub dropped_count: u64,
}

/// §8: the JSONL audit file path plus the dropped-event counter.
#[tauri::command]
pub async fn tono_audit_log_path(state: tauri::State<'_, Arc<TonoState>>) -> Result<TonoAuditLogInfo, String> {
    Ok(TonoAuditLogInfo {
        path: state.audit().log_path().to_string_lossy().into_owned(),
        dropped_count: state.audit().dropped_count(),
    })
}

// ---- Diagnostics (user-initiated upload) ----

/// How long a single environment probe (Service protocol, DNS status) may
/// take before the report simply records "unknown" for it. Assembling
/// diagnostics must never hang the very UI the user reached for when
/// everything else is already broken.
const DIAGNOSTICS_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The receipt the intake returns.
///
/// TS: `interface TonoDiagnosticsReceipt { referenceCode: string; receivedAt: number | null }`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TonoDiagnosticsReceipt {
    pub reference_code: String,
    pub received_at: Option<i64>,
}

/// Assemble the whitelisted report (see `tono::diagnostics` for the privacy
/// contract). Shared by the preview command and the upload command so the
/// text the user is shown and the payload that is sent cannot drift.
async fn collect_diagnostics_report(
    state: &Arc<TonoState>,
    app: &AppHandle,
) -> crate::tono::diagnostics::DiagnosticsReport {
    // Probes first, with no product lock held: they talk to the Service.
    let protocol = tokio::time::timeout(DIAGNOSTICS_PROBE_TIMEOUT, tono_service_protocol::get_version())
        .await
        .ok()
        .and_then(Result::ok)
        .filter(|response| response.code == 0)
        .and_then(|response| response.data);
    let dns = tokio::time::timeout(DIAGNOSTICS_PROBE_TIMEOUT, service::tono_protected_dns_status())
        .await
        .ok()
        .and_then(Result::ok);
    // sysinfo's adapter walk and OS query are blocking syscalls.
    let (os_version, adapters) = AsyncHandler::spawn_blocking(|| {
        (
            tauri_plugin_tono_sysinfo::os_long_version(),
            tauri_plugin_tono_sysinfo::list_network_interfaces(),
        )
    })
    .await
    .unwrap_or_else(|_| ("Unknown".to_string(), Vec::new()));

    let audit_log_path = state.audit().log_path().to_path_buf();
    let service_log_path = crate::tono::diagnostics::service_log_path();
    let home = crate::tono::diagnostics::home_dir();
    let app_version = app.package_info().version.to_string();

    let inner = state.lock().await;
    let status = inner.fsm.status();
    let current_elapsed_ms = inner
        .step_started_at
        .map(|started| started.elapsed().as_millis() as u64);
    let steps = crate::tono::steps::snapshot_with_current_elapsed(&inner.connect_steps, current_elapsed_ms);
    let revision = inner.catalog_tracker.current_revision();
    // The live secret values, handed to the scrubber to be *subtracted* from
    // free text (never emitted). Structural rules cover what is not here.
    let mut known_secrets: Vec<String> = Vec::new();
    if let Some(secret) = &inner.controller_secret {
        known_secrets.push(secret.clone());
    }
    for node in &inner.nodes {
        known_secrets.push(node.uuid.clone());
        known_secrets.push(node.reality_public_key.clone());
        known_secrets.push(node.reality_short_id.clone());
        known_secrets.push(node.server.to_string());
    }
    if let Ok(Some(token)) = inner.credentials.refresh_token() {
        known_secrets.push(token);
    }
    crate::tono::diagnostics::build_report(&crate::tono::diagnostics::DiagnosticsSources {
        app_version: &app_version,
        os_version: &os_version,
        os_arch: std::env::consts::ARCH,
        service_protocol: protocol.as_ref(),
        ui_state: ui_state_key(status.ui_state()),
        account_state: inner.account_state.key(),
        selected_server: inner.selected_node.as_deref(),
        catalog_revision: (revision >= 0).then_some(revision),
        kill_switch: inner.kill_switch.as_ref(),
        dns: dns.as_ref(),
        failed_stage: inner.failed_stage,
        connect_error: inner.connect_error.as_deref(),
        retry_attempt: inner.retry_attempt,
        steps: &steps,
        adapter_names: &adapters,
        known_secrets: &known_secrets,
        audit_log_path: &audit_log_path,
        service_log_path: &service_log_path,
        home_dir: home.as_deref(),
        reported_at_ms: epoch_millis(),
    })
}

/// The exact payload an upload would send, for the "what will be sent"
/// disclosure and for Copy details. Purely local — nothing leaves the
/// machine on this command.
///
/// TS: see `TonoDiagnosticsReport` in `services/tono.ts`; the field list is
/// `tono_core::auth::DiagnosticsReport`.
#[tauri::command]
pub async fn tono_diagnostics_report(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<crate::tono::diagnostics::DiagnosticsReport, String> {
    Ok(collect_diagnostics_report(state.inner(), &app).await)
}

/// Upload one diagnostics report and return its support reference code.
///
/// **User-initiated only.** This is the sole upload path and it exists
/// behind an explicit confirmation in the UI; nothing in the app calls it on
/// a timer, on a crash, or on a failed connect.
///
/// The report is rebuilt here rather than accepted from the WebView: the
/// whitelist has to be enforced where the payload is constructed, or a
/// compromised renderer could post whatever it liked to the account's
/// diagnostics stream.
#[tauri::command]
pub async fn tono_upload_diagnostics(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<TonoDiagnosticsReceipt, String> {
    let client = {
        let inner = state.lock().await;
        inner.client.clone()
    };
    let report = collect_diagnostics_report(state.inner(), &app).await;
    match client.upload_diagnostics_report(&report).await {
        Ok(receipt) => {
            state.audit().log(AuditEvent::DiagnosticsUploaded {
                reference: receipt.reference_code.clone(),
            });
            Ok(TonoDiagnosticsReceipt {
                reference_code: receipt.reference_code,
                received_at: receipt.received_at,
            })
        }
        Err(err) => {
            let message = diagnostics_upload_error(&err);
            state
                .audit()
                .log(AuditEvent::DiagnosticsUploadFail { error: err.to_string() });
            Err(message)
        }
    }
}

/// Classify a sign-in failure into a stable prefix the frontend turns into actionable text.
///
/// Without this the raw error reached the login screen verbatim: a user in China saw
/// `could not reach Tono: pinned[connect: error sending request for url (...) <- client error
/// (Connect) <- 远程主机强迫关闭了一个现有的连接。 (os error 10054)]; system-dns[...]`, which
/// tells them nothing they can act on and looks like the product is broken rather than the
/// network being in the way.
///
/// `TONO_AUTH_UNREACHABLE` is the one worth separating. Both transport paths carry the same
/// hostname and therefore the same TLS SNI, so when both fail the same way the failure is
/// about reaching the control plane at all — not about the account, the code, or the app. The
/// actionable part is that sign-in only has to succeed once: the session persists afterwards
/// and the tunnel provides its own reachability, so one attempt from a working network is
/// enough. That is what the mapped message says.
fn auth_error(err: &ApiError) -> String {
    let prefix = match err {
        ApiError::Transport { .. } => "TONO_AUTH_UNREACHABLE",
        ApiError::RateLimited => "TONO_AUTH_RATE_LIMITED",
        ApiError::DeviceLimit => "TONO_AUTH_DEVICE_LIMIT",
        ApiError::Unauthorized => "TONO_AUTH_UNAUTHORIZED",
        _ => return err.to_string(),
    };
    format!("{prefix}: {err}")
}

/// Classify an upload failure into a stable `TONO_DIAG_*` prefix the
/// frontend turns into actionable text (the same convention the connect
/// errors use, see `STABLE_ERROR_KEYS` in `services/tono.ts`).
fn diagnostics_upload_error(err: &ApiError) -> String {
    let prefix = match err {
        ApiError::Unauthorized => "TONO_DIAG_SIGNED_OUT",
        ApiError::RateLimited => "TONO_DIAG_RATE_LIMITED",
        ApiError::Transport { .. } => "TONO_DIAG_UNREACHABLE",
        // The intake is not deployed (or was withdrawn) — distinct from a
        // server fault, and there is nothing the user can do but copy the
        // details instead.
        ApiError::NotFound => "TONO_DIAG_UNAVAILABLE",
        _ => "TONO_DIAG_FAILED",
    };
    format!("{prefix}: {err}")
}

/// The protected-state predicate of the quit path: the machine is protected while the kill
/// switch is armed or a (dis)connection is in flight. Shared by `quit_release` and
/// `quit_protection_active` so "protected" can never drift between the release decision and the
/// service-stop decision.
fn fsm_reports_protection(inner: &TonoInner) -> bool {
    inner.fsm.kill_switch_armed()
        || inner.fsm.status().is_connected
        || inner.fsm.status().is_connecting
        || inner.fsm.status().is_protection_blocked
}

/// Whether the machine is protected *right now*, as the quit path defines it. Must be called
/// **before** `quit_release`: a successful release converges the FSM to "unprotected", and the
/// connected-quit contract is that the Service keeps running even after its barrier is released.
pub async fn quit_protection_active(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return false;
    };
    let inner = state.lock().await;
    fsm_reports_protection(&inner)
}

/// Whether asking the Service to stop itself on an unprotected quit is permitted. The durable
/// desired state must be proven "core should not be running": stopping the Windows service does
/// not rewrite the desired-state file, so stopping it while `core_should_be_running` is true (or
/// unreadable) would let the next service start resurrect a core the user already stopped. The
/// Service enforces the same check server-side (`owner_goodbye_verdict`); this client-side
/// pre-check is the fast path that keeps the quit log truthful.
#[cfg(any(windows, test))]
fn service_stop_permitted_on_quit(
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
    state: tauri::State<'_, Arc<TonoState>>,
    next_version: String,
) -> Result<(), String> {
    let inner = state.lock().await;
    if next_version.trim().is_empty() {
        return Err("TONO_UPDATE_VERSION_REQUIRED".into());
    }
    let previous = env!("CARGO_PKG_VERSION");
    let mut journal = crate::tono::update_handoff::prepare(
        previous,
        next_version.trim(),
        inner.connect_generation,
        inner.fsm.status().is_connected,
        inner.fsm.kill_switch_armed(),
    );
    journal.selected_node_anonymous_id = inner.selected_node.clone();
    journal.catalog_revision = Some(inner.catalog_tracker.current_revision());
    journal.helper_protocol_version = tono_service_protocol::PROTOCOL_REVISION.to_string();
    journal.build_commit = option_env!("VERGEN_GIT_SHA")
        .or(option_env!("GITHUB_SHA"))
        .unwrap_or("")
        .to_string();
    crate::tono::update_handoff::save(&journal)
        .map_err(|error| format!("TONO_UPDATE_JOURNAL: {error}"))?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyEnvEntry {
    pub key: String,
    pub value: String,
    pub source: String,
    pub guidance: String,
    pub auto_clearable: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEnvReport {
    pub has_conflict: bool,
    pub entries: Vec<ProxyEnvEntry>,
    pub claude_code_ready: bool,
    pub can_auto_clear: bool,
}

const TERMINAL_PROXY_KEYS: [&str; 6] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
];
const CONFIGURED_PROXY_VALUE: &str = "<configured>";
// Windows environment-variable and registry names are case-insensitive. Query
// one spelling so a lowercase value is detected once rather than duplicated;
// text/JSON profiles still use all six case-sensitive spellings above.
#[cfg(windows)]
const WINDOWS_TERMINAL_PROXY_KEYS: [&str; 3] = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];
const MAX_TERMINAL_SETTINGS_BYTES: u64 = 1024 * 1024;

fn is_terminal_proxy_key(key: &str) -> bool {
    TERMINAL_PROXY_KEYS
        .iter()
        .any(|candidate| key.eq_ignore_ascii_case(candidate))
}

fn unquote_proxy_value(value: &str) -> Option<String> {
    let mut value = value.trim().trim_end_matches(';').trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value = &value[1..value.len() - 1];
    }
    let value = value.trim();
    if value.is_empty()
        || value.eq_ignore_ascii_case("$null")
        || value.eq_ignore_ascii_case("null")
        || value.eq_ignore_ascii_case("nil")
    {
        None
    } else {
        Some(value.to_string())
    }
}

/// Finds active proxy assignments in shell, PowerShell and CMD startup text.
/// It deliberately does not rewrite these files: profiles often contain
/// conditionals and unrelated commands, so a textual delete is not safe.
fn proxy_assignments_in_text(contents: &str) -> std::collections::BTreeMap<String, String> {
    static SH_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r"(?i)^(?:export\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.+)$",
        )
        .expect("valid shell proxy regex")
    });
    static POWERSHELL_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r"(?i)^\$env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.+)$",
        )
        .expect("valid PowerShell proxy regex")
    });
    static CMD_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)^@?set\s+"?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.*?)"?$"#,
        )
        .expect("valid CMD proxy regex")
    });
    static POWERSHELL_ITEM_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;{]\s*)(?:set-item|new-item)\s+(?:(?:-path|-literalpath)\s+)?env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s+(?:-value\s+)?("[^"]*"|'[^']*'|[^\s;)}]+)"#,
        )
        .expect("valid PowerShell item proxy regex")
    });
    static POWERSHELL_PERSISTENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;{]\s*)\[(?:System\.)?Environment\]::SetEnvironmentVariable\(\s*['"](HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)['"]\s*,\s*([^,)]+)"#,
        )
        .expect("valid persistent PowerShell proxy regex")
    });
    static INLINE_SH_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;{(]\s*|\bthen\s+|\bdo\s+)(?:env\s+)?(?:export\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^\s;)}]+)"#,
        )
        .expect("valid inline shell proxy regex")
    });
    static SHELL_ALIAS_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)^alias\s+\S+\s*=\s*['"][^'"]*(?:env\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^\s;'"}]+)"#,
        )
        .expect("valid shell alias proxy regex")
    });
    static INLINE_POWERSHELL_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;{]\s*)\$env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^;)}]+)"#,
        )
        .expect("valid inline PowerShell proxy regex")
    });
    static PERSISTENT_PROXY_COMMAND: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;&|]\s*)(?:launchctl\s+setenv|setx(?:\.exe)?)\s+['"]?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)['"]?\s+("[^"]+"|'[^']+'|[^\s;&|]+)"#,
        )
        .expect("valid persistent proxy command regex")
    });
    static INLINE_CMD_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;&|]\s*|\bdo\s+|cmd(?:\.exe)?\s+/[ck]\s+["']?)@?set\s+"?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]*"|'[^']*'|[^\s;&|"]+)"#,
        )
        .expect("valid inline CMD proxy regex")
    });
    static FISH_UNIVERSAL_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r"(?i)^SETUVAR(?:\s+--[A-Za-z-]+)*\s+(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY):(.+)$",
        )
        .expect("valid fish universal proxy regex")
    });

    let mut assignments = std::collections::BTreeMap::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with("//")
            || line.starts_with("::")
            || line
                .split_ascii_whitespace()
                .next()
                .is_some_and(|word| word.eq_ignore_ascii_case("rem"))
        {
            continue;
        }

        let captures = SH_ASSIGNMENT
            .captures(line)
            .or_else(|| POWERSHELL_ASSIGNMENT.captures(line))
            .or_else(|| CMD_ASSIGNMENT.captures(line))
            .or_else(|| POWERSHELL_ITEM_ASSIGNMENT.captures(line))
            .or_else(|| POWERSHELL_PERSISTENT.captures(line))
            .or_else(|| SHELL_ALIAS_ASSIGNMENT.captures(line))
            .or_else(|| INLINE_SH_ASSIGNMENT.captures(line))
            .or_else(|| INLINE_POWERSHELL_ASSIGNMENT.captures(line))
            .or_else(|| PERSISTENT_PROXY_COMMAND.captures(line))
            .or_else(|| INLINE_CMD_ASSIGNMENT.captures(line))
            .or_else(|| FISH_UNIVERSAL_ASSIGNMENT.captures(line));
        if let Some(captures) = captures {
            if let Some(value) = unquote_proxy_value(&captures[2]) {
                assignments.insert(captures[1].to_string(), value);
            }
            continue;
        }

        // CMD AutoRun commonly chains setup with `&` or `|`. We only need to
        // identify an assignment and deliberately leave the complete value for
        // the user's manual edit; splitting a URL query is still a positive hit.
        for statement in line.split(['&', '|']).skip(1).map(str::trim) {
            if let Some(captures) = CMD_ASSIGNMENT.captures(statement)
                && let Some(value) = unquote_proxy_value(&captures[2])
            {
                assignments.insert(captures[1].to_string(), value);
            }
        }

        // fish: `set -gx HTTP_PROXY value`. Erase/query forms are not
        // assignments and must not turn a clean profile into a conflict.
        let words: Vec<&str> = line.split_whitespace().collect();
        if words.first().is_some_and(|word| word.eq_ignore_ascii_case("set")) {
            let mut index = 1;
            let mut removes = false;
            while let Some(flag) = words.get(index).filter(|word| word.starts_with('-')) {
                removes |= flag.eq_ignore_ascii_case("--erase")
                    || (!flag.starts_with("--") && flag[1..].contains('e'));
                index += 1;
            }
            if !removes
                && let (Some(key), Some(value)) = (words.get(index), words.get(index + 1))
                && is_terminal_proxy_key(key)
                && let Some(value) = unquote_proxy_value(value)
            {
                assignments.insert((*key).to_string(), value);
            }
        }
    }
    assignments
}

fn strip_jsonc(contents: &str) -> String {
    let characters: Vec<char> = contents.chars().collect();
    let mut stripped = String::with_capacity(contents.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < characters.len() {
        let character = characters[index];
        if in_string {
            stripped.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if character == '"' {
            in_string = true;
            stripped.push('"');
            index += 1;
        } else if character == '/' && characters.get(index + 1) == Some(&'/') {
            index += 2;
            while index < characters.len() && characters[index] != '\n' {
                index += 1;
            }
        } else if character == '/' && characters.get(index + 1) == Some(&'*') {
            index += 2;
            while index + 1 < characters.len()
                && !(characters[index] == '*' && characters[index + 1] == '/')
            {
                index += 1;
            }
            if index + 1 < characters.len() {
                index += 2;
            } else {
                // Keep malformed JSONC malformed. Silently consuming an
                // unfinished comment could turn an unreadable persistent
                // proxy source into a false Ready report.
                stripped.push('\0');
                index = characters.len();
            }
        } else {
            stripped.push(character);
            index += 1;
        }
    }

    // serde_json rejects JSONC trailing commas. Remove only a comma followed
    // by whitespace and a closing bracket, never one inside a string.
    let characters: Vec<char> = stripped.chars().collect();
    let mut normalized = String::with_capacity(stripped.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < characters.len() {
        let character = characters[index];
        if in_string {
            normalized.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if character == '"' {
            in_string = true;
        }
        if character == ',' {
            let mut lookahead = index + 1;
            while characters.get(lookahead).is_some_and(|ch| ch.is_whitespace()) {
                lookahead += 1;
            }
            if matches!(characters.get(lookahead), Some('}' | ']')) {
                index += 1;
                continue;
            }
        }
        normalized.push(character);
        index += 1;
    }
    normalized
}

fn proxy_assignments_in_json(
    contents: &str,
    container_path: &[&str],
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let root: serde_json::Value = serde_json::from_str(&strip_jsonc(contents))
        .map_err(|error| format!("invalid proxy settings JSON: {error}"))?;
    let mut container = &root;
    for component in container_path {
        let Some(next) = container.get(component) else {
            return Ok(std::collections::BTreeMap::new());
        };
        container = next;
    }
    let Some(object) = container.as_object() else {
        return Ok(std::collections::BTreeMap::new());
    };
    let mut assignments = std::collections::BTreeMap::new();
    for (key, value) in object {
        if !is_terminal_proxy_key(key) {
            continue;
        }
        if let Some(value) = value.as_str().and_then(unquote_proxy_value) {
            assignments.insert(key.clone(), value);
        }
    }
    Ok(assignments)
}

fn read_bounded_terminal_settings(path: &std::path::Path) -> Result<Option<String>, String> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to inspect {}: {error}", path.display())),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > MAX_TERMINAL_SETTINGS_BYTES {
        return Err(format!("Proxy settings file is unexpectedly large: {}", path.display()));
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))
}

fn file_uri_path(uri: &str) -> Option<std::path::PathBuf> {
    let uri = reqwest::Url::parse(uri).ok()?;
    // Diagnostic discovery is local-only. Do not turn a remote authority into
    // a relative path, or newly probe stale/unreachable network shares here.
    if uri.scheme() != "file"
        || uri.host_str().is_some_and(|host| host != "localhost")
        || uri.query().is_some()
        || uri.fragment().is_some()
    {
        return None;
    }
    let path = uri.to_file_path().ok()?;
    (path.is_absolute() && !path.to_string_lossy().contains('\0')).then_some(path)
}

#[derive(Debug, PartialEq, Eq)]
struct VscodeWorkspaceDiscovery {
    settings: Vec<std::path::PathBuf>,
    roots: Vec<std::path::PathBuf>,
}

fn vscode_workspace_roots(
    path: &std::path::Path,
) -> Result<Vec<std::path::PathBuf>, String> {
    let Some(contents) = read_bounded_terminal_settings(path)? else {
        return Ok(Vec::new());
    };
    let workspace = serde_json::from_str::<serde_json::Value>(&strip_jsonc(&contents))
        .map_err(|error| format!("Invalid {}: {error}", path.display()))?;
    let Some(folders) = workspace.get("folders") else {
        return Ok(Vec::new());
    };
    let folders = folders
        .as_array()
        .filter(|folders| folders.len() <= 256)
        .ok_or_else(|| format!("Invalid VS Code workspace folders in {}", path.display()))?;
    let mut roots = Vec::new();
    for folder in folders {
        let folder = folder
            .as_object()
            .ok_or_else(|| format!("Invalid VS Code workspace folder in {}", path.display()))?;
        if let Some(uri) = folder.get("uri").and_then(serde_json::Value::as_str) {
            if let Some(root) = file_uri_path(uri) {
                roots.push(root);
            }
            continue;
        }
        let relative = folder
            .get("path")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty() && !value.contains('\0'))
            .ok_or_else(|| format!("Invalid VS Code workspace folder in {}", path.display()))?;
        let root = std::path::PathBuf::from(relative);
        roots.push(if root.is_absolute() {
            root
        } else {
            path.parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join(root)
        });
    }
    Ok(roots)
}

fn vscode_workspace_discovery(
    user_dir: &std::path::Path,
) -> Result<VscodeWorkspaceDiscovery, String> {
    let storage = user_dir.join("workspaceStorage");
    let directories = match std::fs::read_dir(&storage) {
        Ok(directories) => directories,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(VscodeWorkspaceDiscovery {
                settings: Vec::new(),
                roots: Vec::new(),
            });
        }
        Err(error) => return Err(format!("Failed to inspect {}: {error}", storage.display())),
    };
    let mut discovery = VscodeWorkspaceDiscovery {
        settings: Vec::new(),
        roots: Vec::new(),
    };
    for directory in directories {
        let directory = directory.map_err(|error| {
            format!("Failed to inspect VS Code workspace metadata: {error}")
        })?;
        let metadata_path = directory.path().join("workspace.json");
        let Some(contents) = read_bounded_terminal_settings(&metadata_path)? else {
            continue;
        };
        let metadata = serde_json::from_str::<serde_json::Value>(&strip_jsonc(&contents))
            .map_err(|error| format!("Invalid {}: {error}", metadata_path.display()))?;
        if let Some(folder) = metadata
            .get("folder")
            .and_then(serde_json::Value::as_str)
            .and_then(file_uri_path)
        {
            discovery.roots.push(folder.clone());
            let settings = folder.join(".vscode").join("settings.json");
            if settings.is_file() {
                discovery.settings.push(settings);
            }
        }
        if let Some(workspace) = metadata
            .get("workspace")
            .and_then(serde_json::Value::as_str)
            .and_then(file_uri_path)
            .filter(|path| path.is_file())
        {
            discovery.roots.extend(vscode_workspace_roots(&workspace)?);
            discovery.settings.push(workspace);
        }
    }
    discovery.settings.sort();
    discovery.settings.dedup();
    discovery.roots.sort();
    discovery.roots.dedup();
    Ok(discovery)
}

fn vscode_profile_setting_paths(
    user_dir: &std::path::Path,
) -> Result<Vec<std::path::PathBuf>, String> {
    let profiles = user_dir.join("profiles");
    let directories = match std::fs::read_dir(&profiles) {
        Ok(directories) => directories,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Failed to inspect {}: {error}", profiles.display())),
    };
    let mut settings = Vec::new();
    for (index, directory) in directories.enumerate() {
        if index >= 128 {
            return Err(format!(
                "VS Code profiles directory has too many entries: {}",
                profiles.display()
            ));
        }
        let directory = directory
            .map_err(|error| format!("Failed to inspect VS Code profile metadata: {error}"))?;
        if !directory
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", directory.path().display()))?
            .is_dir()
        {
            continue;
        }
        let path = directory.path().join("settings.json");
        if path.is_file() {
            settings.push(path);
        }
    }
    settings.sort();
    Ok(settings)
}

fn append_proxy_entries(
    entries: &mut Vec<ProxyEnvEntry>,
    assignments: std::collections::BTreeMap<String, String>,
    source: String,
    guidance: String,
    auto_clearable: bool,
) {
    entries.extend(assignments.into_keys().map(|key| ProxyEnvEntry {
        key,
        value: CONFIGURED_PROXY_VALUE.to_string(),
        source: source.clone(),
        guidance: guidance.clone(),
        auto_clearable,
    }));
}

fn scan_text_proxy_file(
    entries: &mut Vec<ProxyEnvEntry>,
    path: &std::path::Path,
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    if let Some(contents) = read_bounded_terminal_settings(path)? {
        append_proxy_entries(
            entries,
            proxy_assignments_in_text(&contents),
            format!("{label}: {}", path.display()),
            guidance.to_string(),
            false,
        );
    }
    Ok(())
}

fn scan_text_proxy_directory(
    entries: &mut Vec<ProxyEnvEntry>,
    directory: &std::path::Path,
    extension: &str,
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    let listing = match std::fs::read_dir(directory) {
        Ok(listing) => listing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect profile directory {}: {error}",
                directory.display()
            ));
        }
    };
    let mut paths = Vec::new();
    for entry in listing {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to inspect profile directory {}: {error}",
                directory.display()
            )
        })?;
        let file_type = entry.file_type().map_err(|error| {
            format!("Failed to inspect {}: {error}", entry.path().display())
        })?;
        if file_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case(extension))
        {
            paths.push(entry.path());
        }
        if paths.len() > 256 {
            return Err(format!(
                "Profile directory contains too many files to inspect safely: {}",
                directory.display()
            ));
        }
    }
    paths.sort();
    for path in paths {
        scan_text_proxy_file(entries, &path, label, guidance)?;
    }
    Ok(())
}

fn scan_json_proxy_file(
    entries: &mut Vec<ProxyEnvEntry>,
    path: &std::path::Path,
    container_path: &[&str],
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    if let Some(contents) = read_bounded_terminal_settings(path)? {
        let assignments = proxy_assignments_in_json(&contents, container_path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        append_proxy_entries(
            entries,
            assignments,
            format!("{label}: {}", path.display()),
            guidance.to_string(),
            false,
        );
    }
    Ok(())
}

fn scan_json_proxy_directory(
    entries: &mut Vec<ProxyEnvEntry>,
    directory: &std::path::Path,
    container_path: &[&str],
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    let listing = match std::fs::read_dir(directory) {
        Ok(listing) => listing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect settings directory {}: {error}",
                directory.display()
            ));
        }
    };
    let mut paths = Vec::new();
    for entry in listing {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to inspect settings directory {}: {error}",
                directory.display()
            )
        })?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if file_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case("json"))
        {
            paths.push(entry.path());
        }
        if paths.len() > 256 {
            return Err(format!(
                "Settings directory contains too many files to inspect safely: {}",
                directory.display()
            ));
        }
    }
    paths.sort();
    for path in paths {
        scan_json_proxy_file(entries, &path, container_path, label, guidance)?;
    }
    Ok(())
}

fn command_output_with_timeout(
    command: &mut std::process::Command,
    timeout: std::time::Duration,
    maximum_bytes: usize,
) -> std::io::Result<std::process::Output> {
    use std::io::Read as _;
    use std::process::Stdio;

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("piped stdout is present");
    let stderr = child.stderr.take().expect("piped stderr is present");
    let read_pipe = move |pipe: Box<dyn std::io::Read + Send>| {
        let mut bytes = Vec::new();
        pipe.take(maximum_bytes as u64 + 1).read_to_end(&mut bytes)?;
        Ok::<Vec<u8>, std::io::Error>(bytes)
    };
    let stdout_reader = std::thread::spawn(move || read_pipe(Box::new(stdout)));
    let stderr_reader = std::thread::spawn(move || read_pipe(Box::new(stderr)));
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            // Do not join here: a descendant can inherit the pipe handles and
            // keep reader threads alive after the direct child is gone. The
            // detached bounded readers close when that process tree exits,
            // while diagnostics returns fail-closed on the deadline.
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "command timed out",
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    };
    let join = |reader: std::thread::JoinHandle<std::io::Result<Vec<u8>>>| {
        reader.join().map_err(|_| {
            std::io::Error::other("command output reader terminated unexpectedly")
        })?
    };
    Ok(std::process::Output {
        status,
        stdout: join(stdout_reader)?,
        stderr: join(stderr_reader)?,
    })
}

#[cfg(windows)]
fn decode_windows_command_output(bytes: &[u8]) -> String {
    if bytes.chunks_exact(2).any(|pair| pair[1] == 0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(windows)]
fn scan_wsl_profiles(entries: &mut Vec<ProxyEnvEntry>) -> Result<(), String> {
    let mut list_command = std::process::Command::new("wsl.exe");
    list_command.args(["--list", "--quiet"]);
    let list = match command_output_with_timeout(
        &mut list_command,
        std::time::Duration::from_secs(10),
        64 * 1024,
    ) {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let registered = match hkcu.open_subkey(
                r"Software\Microsoft\Windows\CurrentVersion\Lxss",
            ) {
                Ok(key) => match key.enum_keys().next() {
                    Some(Ok(_)) => true,
                    Some(Err(error)) => {
                        return Err(format!("Failed to inspect registered WSL distributions: {error}"));
                    }
                    None => false,
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                Err(error) => {
                    return Err(format!("Failed to inspect registered WSL distributions: {error}"));
                }
            };
            if !registered {
                return Ok(());
            }
            return Err(format!(
                "Failed to list registered WSL distributions (status {})",
                output.status
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Failed to start WSL profile inspection: {error}")),
    };
    let distributions = decode_windows_command_output(&list.stdout);
    const SCRIPT: &str = r#"total=0; for f in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.zlogin" "$HOME/.config/fish/config.fish" "$HOME/.config/fish/fish_variables" "$HOME"/.config/fish/conf.d/*.fish "$HOME"/.config/powershell/*.ps1 "$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json" "$HOME/.vscode-server/data/Machine/settings.json" "$HOME/.vscode-server-insiders/data/Machine/settings.json" /etc/environment /etc/profile /etc/bash.bashrc /etc/zsh/zshenv /etc/zsh/zprofile /etc/zsh/zshrc /etc/profile.d/*.sh /etc/fish/config.fish /etc/fish/fish_variables /etc/fish/conf.d/*.fish /opt/microsoft/powershell/7/*.ps1 /etc/claude-code/managed-settings.json /etc/claude-code/managed-settings.d/*.json; do [ -f "$f" ] || continue; n=$(wc -c < "$f") || exit 1; total=$((total+n)); [ "$total" -le 4194304 ] || exit 2; printf '\036%s\037%s\037' "$f" "$n"; if [ "$n" -le 1048576 ]; then cat -- "$f"; fi; done"#;
    for distribution in distributions.lines().map(str::trim).filter(|name| !name.is_empty()) {
        let mut command = std::process::Command::new("wsl.exe");
        command.args(["--distribution", distribution, "--", "sh", "-lc", SCRIPT]);
        let output = command_output_with_timeout(
            &mut command,
            std::time::Duration::from_secs(15),
            4 * MAX_TERMINAL_SETTINGS_BYTES as usize,
        ).map_err(|error| format!("Failed to inspect WSL distribution {distribution}: {error}"))?;
        if !output.status.success() {
            return Err(format!("Failed to inspect WSL distribution {distribution}"));
        }
        if output.stdout.len() > 4 * MAX_TERMINAL_SETTINGS_BYTES as usize {
            return Err(format!("WSL proxy profiles are unexpectedly large: {distribution}"));
        }
        let output = String::from_utf8_lossy(&output.stdout);
        for section in output.split('\u{1e}').filter(|section| !section.is_empty()) {
            let mut fields = section.splitn(3, '\u{1f}');
            let (Some(path), Some(size), Some(contents)) =
                (fields.next(), fields.next(), fields.next())
            else {
                return Err(format!("Invalid WSL profile response from {distribution}"));
            };
            let size = size
                .parse::<u64>()
                .map_err(|_| format!("Invalid WSL profile size for {distribution}:{path}"))?;
            if size > MAX_TERMINAL_SETTINGS_BYTES {
                return Err(format!("WSL proxy profile is unexpectedly large: {distribution}:{path}"));
            }
            let assignments = if path.ends_with(".json") {
                let container: &[&str] = if path.contains("/.vscode-server") {
                    &["terminal.integrated.env.linux"]
                } else {
                    &["env"]
                };
                proxy_assignments_in_json(contents, container)
                    .map_err(|error| format!("WSL {distribution}:{path}: {error}"))?
            } else {
                proxy_assignments_in_text(contents)
            };
            append_proxy_entries(
                entries,
                assignments,
                format!("WSL {distribution}: {path}"),
                format!(
                    "Remove the proxy assignment from {path} inside WSL, then restart that WSL terminal (or run wsl --shutdown)."
                ),
                false,
            );
        }
    }
    Ok(())
}

fn powershell_profile_roots(home: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut roots = vec![home.join("Documents")];
    for variable in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(root) = std::env::var_os(variable).filter(|value| !value.is_empty()) {
            roots.push(std::path::PathBuf::from(root).join("Documents"));
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

fn scan_powershell_profile_directories(
    entries: &mut Vec<ProxyEnvEntry>,
    roots: impl IntoIterator<Item = std::path::PathBuf>,
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    for root in roots {
        for file in [
            "profile.ps1",
            "Microsoft.PowerShell_profile.ps1",
            "Microsoft.VSCode_profile.ps1",
        ] {
            scan_text_proxy_file(entries, &root.join(file), label, guidance)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn powershell_all_users_profile_roots() -> Result<Vec<std::path::PathBuf>, String> {
    let mut roots = Vec::new();
    if let Some(windows) = std::env::var_os("WINDIR").map(std::path::PathBuf::from) {
        for system in ["System32", "SysWOW64", "Sysnative"] {
            roots.push(windows.join(system).join("WindowsPowerShell").join("v1.0"));
        }
    }
    for variable in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        let Some(program_files) = std::env::var_os(variable).map(std::path::PathBuf::from) else {
            continue;
        };
        let parent = program_files.join("PowerShell");
        let versions = match std::fs::read_dir(&parent) {
            Ok(versions) => versions,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Failed to inspect {}: {error}", parent.display())),
        };
        for (index, version) in versions.enumerate() {
            if index >= 32 {
                return Err(format!(
                    "PowerShell installation directory has too many entries: {}",
                    parent.display()
                ));
            }
            let version = version
                .map_err(|error| format!("Failed to inspect {}: {error}", parent.display()))?;
            if version
                .file_type()
                .map_err(|error| format!("Failed to inspect {}: {error}", version.path().display()))?
                .is_dir()
            {
                roots.push(version.path());
            }
        }
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}

fn scan_terminal_proxy_files(entries: &mut Vec<ProxyEnvEntry>) -> Result<(), String> {
    let home = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from);
    if let Some(home) = home.as_deref() {
        let shell_guidance =
            "Remove only the proxy assignment shown from this profile; keep all unrelated profile content. Then restart the terminal and Claude supervisor.";
        for relative in [
            ".profile",
            ".bashrc",
            ".bash_profile",
            ".bash_login",
            ".zshenv",
            ".zshrc",
            ".zprofile",
            ".zlogin",
            ".config/fish/config.fish",
            ".config/fish/fish_variables",
        ] {
            scan_text_proxy_file(
                entries,
                &home.join(relative),
                "Shell/PowerShell profile",
                shell_guidance,
            )?;
        }
        scan_text_proxy_directory(
            entries,
            &home.join(".config/fish/conf.d"),
            "fish",
            "Shell/PowerShell profile",
            shell_guidance,
        )?;
        // OneDrive commonly redirects Documents, where PowerShell stores its
        // current-user profiles. Inspect both local and known OneDrive roots.
        for documents in powershell_profile_roots(home) {
            scan_powershell_profile_directories(
                entries,
                [documents.join("PowerShell"), documents.join("WindowsPowerShell")],
                "PowerShell profile",
                shell_guidance,
            )?;
        }
        for file in ["settings.json", "settings.local.json"] {
            scan_json_proxy_file(
                entries,
                &home.join(".claude").join(file),
                &["env"],
                "Claude settings",
                "Remove the proxy key from the env object in Claude settings, then fully restart Claude Code and its supervisor.",
            )?;
        }
    }

    if let Some(config_home) = std::env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        let config_home = std::path::PathBuf::from(config_home);
        if !config_home.is_absolute() {
            return Err("XDG_CONFIG_HOME is relative and cannot be inspected safely".to_string());
        }
        let fish = config_home.join("fish");
        let guidance = "Remove only the proxy assignment shown from this profile; keep all unrelated profile content. Then restart the terminal and Claude supervisor.";
        scan_text_proxy_file(
            entries,
            &fish.join("config.fish"),
            "Shell/PowerShell profile",
            guidance,
        )?;
        scan_text_proxy_file(
            entries,
            &fish.join("fish_variables"),
            "Shell/PowerShell profile",
            guidance,
        )?;
        scan_text_proxy_directory(
            entries,
            &fish.join("conf.d"),
            "fish",
            "Shell/PowerShell profile",
            guidance,
        )?;
    }
    if let Some(zdotdir) = std::env::var_os("ZDOTDIR").filter(|value| !value.is_empty()) {
        let zdotdir = std::path::PathBuf::from(zdotdir);
        if !zdotdir.is_absolute() {
            return Err("ZDOTDIR is relative and cannot be inspected safely".to_string());
        }
        let guidance = "Remove only the proxy assignment shown from this profile; keep all unrelated profile content. Then restart the terminal and Claude supervisor.";
        for file in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
            scan_text_proxy_file(
                entries,
                &zdotdir.join(file),
                "Shell/PowerShell profile",
                guidance,
            )?;
        }
    }

    #[cfg(windows)]
    {
        let mut managed_settings_roots = Vec::new();
        for variable in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(variable).filter(|value| !value.is_empty()) {
                managed_settings_roots.push(std::path::PathBuf::from(root).join("ClaudeCode"));
            }
        }
        managed_settings_roots.sort();
        managed_settings_roots.dedup();
        let guidance = "Remove the proxy key from the administrator-managed Claude settings source, then fully restart Claude Code and its supervisor.";
        for root in managed_settings_roots {
            scan_json_proxy_file(
                entries,
                &root.join("managed-settings.json"),
                &["env"],
                "Claude managed settings",
                guidance,
            )?;
            scan_json_proxy_directory(
                entries,
                &root.join("managed-settings.d"),
                &["env"],
                "Claude managed settings",
                guidance,
            )?;
        }
    }

    #[cfg(windows)]
    scan_powershell_profile_directories(
        entries,
        powershell_all_users_profile_roots()?,
        "PowerShell all-users profile",
        "Remove only the proxy assignment shown from this administrator-managed profile; keep all unrelated content. Then restart PowerShell, VS Code, and the Claude supervisor.",
    )?;

    if let Some(appdata) = std::env::var_os("APPDATA").map(std::path::PathBuf::from) {
        for product in ["Code", "Code - Insiders"] {
            let user_dir = appdata.join(product).join("User");
            let guidance = "Remove the proxy key from terminal.integrated.env.windows, then fully restart VS Code and all integrated terminals.";
            scan_json_proxy_file(
                entries,
                &user_dir.join("settings.json"),
                &["terminal.integrated.env.windows"],
                "VS Code user settings",
                guidance,
            )?;
            for settings in vscode_profile_setting_paths(&user_dir)? {
                scan_json_proxy_file(
                    entries,
                    &settings,
                    &["terminal.integrated.env.windows"],
                    "VS Code profile settings",
                    guidance,
                )?;
            }
            let workspaces = vscode_workspace_discovery(&user_dir)?;
            for workspace in workspaces.settings {
                let is_code_workspace = workspace.extension().is_some_and(|extension| {
                    extension
                        .to_string_lossy()
                        .eq_ignore_ascii_case("code-workspace")
                });
                let path: &[&str] = if is_code_workspace {
                    &["settings", "terminal.integrated.env.windows"]
                } else {
                    &["terminal.integrated.env.windows"]
                };
                scan_json_proxy_file(
                    entries,
                    &workspace,
                    path,
                    "VS Code workspace settings",
                    guidance,
                )?;
            }
            for root in workspaces.roots {
                for file in ["settings.json", "settings.local.json"] {
                    scan_json_proxy_file(
                        entries,
                        &root.join(".claude").join(file),
                        &["env"],
                        "Claude project settings",
                        "Remove the proxy key from the project env object, then fully restart Claude Code and its supervisor.",
                    )?;
                }
            }
        }
    }

    #[cfg(windows)]
    scan_wsl_profiles(entries)?;
    Ok(())
}

#[tauri::command]
pub async fn tono_check_terminal_env() -> Result<TerminalEnvReport, String> {
    tokio::task::spawn_blocking(|| {
        let mut entries: Vec<ProxyEnvEntry> = Vec::new();

        #[cfg(windows)]
        {
            use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
            use winreg::RegKey;
            let registry_sources = [
                (
                    RegKey::predef(HKEY_CURRENT_USER),
                    "Environment",
                    "Windows user environment",
                    "Use the safe clear button below, then restart VS Code, every terminal, and the Claude supervisor.",
                    true,
                ),
                (
                    RegKey::predef(HKEY_LOCAL_MACHINE),
                    r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
                    "Windows machine environment (HKLM)",
                    "Remove this variable from an elevated System Properties or administrator shell. Tono will not silently modify HKLM. Then restart VS Code, every terminal, and the Claude supervisor.",
                    false,
                ),
            ];
            for (root, path, source, guidance, auto_clearable) in registry_sources {
                match root.open_subkey(path) {
                    Ok(env_key) => {
                        for key in &WINDOWS_TERMINAL_PROXY_KEYS {
                            match env_key.get_value::<String, _>(key) {
                                Ok(val) => {
                                    let trimmed = val.trim();
                                    if !trimmed.is_empty() {
                                        entries.push(ProxyEnvEntry {
                                            key: (*key).to_string(),
                                            value: CONFIGURED_PROXY_VALUE.to_string(),
                                            source: source.to_string(),
                                            guidance: guidance.to_string(),
                                            auto_clearable,
                                        });
                                    }
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                                Err(e) => {
                                    return Err(format!(
                                        "Failed to read registry env var {key}: {e}"
                                    ));
                                }
                            }
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        return Err(format!("Failed to open {source}: {e}"));
                    }
                }
            }

            for (root, source) in [
                (RegKey::predef(HKEY_CURRENT_USER), "Claude managed policy (HKCU)"),
                (RegKey::predef(HKEY_LOCAL_MACHINE), "Claude managed policy (HKLM)"),
            ] {
                match root.open_subkey(r"SOFTWARE\Policies\ClaudeCode") {
                    Ok(key) => match key.get_value::<String, _>("Settings") {
                        Ok(settings) => append_proxy_entries(
                            &mut entries,
                            proxy_assignments_in_json(&settings, &["env"])
                                .map_err(|error| format!("Invalid {source}: {error}"))?,
                            source.to_string(),
                            "Remove the proxy key from the administrator-managed Claude policy, then fully restart Claude Code and its supervisor.".to_string(),
                            false,
                        ),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(format!("Failed to read {source}: {error}")),
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(format!("Failed to open {source}: {error}")),
                }
            }

            let command_processor = r"Software\Microsoft\Command Processor";
            for (root, source) in [
                (RegKey::predef(HKEY_CURRENT_USER), "CMD AutoRun (HKCU)"),
                (RegKey::predef(HKEY_LOCAL_MACHINE), "CMD AutoRun (HKLM)"),
            ] {
                match root.open_subkey(command_processor) {
                    Ok(key) => match key.get_value::<String, _>("AutoRun") {
                        Ok(value) => append_proxy_entries(
                            &mut entries,
                            proxy_assignments_in_text(&value),
                            source.to_string(),
                            "Edit the CMD AutoRun value and remove only the proxy SET command; preserve every unrelated command. Restart CMD, VS Code, and the Claude supervisor.".to_string(),
                            false,
                        ),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(format!("Failed to read {source}: {error}")),
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(format!("Failed to open {source}: {error}")),
                }
            }
        }

        for (key, val) in std::env::vars().filter(|(key, _)| is_terminal_proxy_key(key)) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                entries.push(ProxyEnvEntry {
                    key,
                    value: CONFIGURED_PROXY_VALUE.to_string(),
                    source: "Current Tono process environment".to_string(),
                    guidance: "Remove the variable from the parent source, including lowercase names, then fully restart Tono, VS Code, every terminal, and the Claude supervisor. Clearing only this child process would produce a false Ready result.".to_string(),
                    auto_clearable: false,
                });
            }
        }
        scan_terminal_proxy_files(&mut entries)?;

        let has_conflict = !entries.is_empty();
        let claude_code_ready = !has_conflict;
        let can_auto_clear = entries.iter().any(|entry| entry.auto_clearable);

        Ok(TerminalEnvReport {
            has_conflict,
            entries,
            claude_code_ready,
            can_auto_clear,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tono_clear_terminal_proxy_env() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            match hkcu.open_subkey_with_flags("Environment", KEY_SET_VALUE) {
                Ok(env_key) => {
                    for key in &WINDOWS_TERMINAL_PROXY_KEYS {
                        if let Err(e) = env_key.delete_value(key) {
                            if e.kind() != std::io::ErrorKind::NotFound {
                                return Err(format!("Failed to delete registry env var {key}: {e}"));
                            }
                        }
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!("Failed to open HKCU\\Environment: {e}"));
                    }
                }
            }

            // Verify keys were removed from registry
            match hkcu.open_subkey("Environment") {
                Ok(env_key) => {
                    let mut remaining = Vec::new();
                    for key in &WINDOWS_TERMINAL_PROXY_KEYS {
                        if let Ok(val) = env_key.get_value::<String, _>(key) {
                            if !val.trim().is_empty() {
                                remaining.push((*key).to_string());
                            }
                        }
                    }
                    if !remaining.is_empty() {
                        return Err(format!("Could not remove registry proxy variables: {}", remaining.join(", ")));
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!("Failed to verify HKCU\\Environment: {e}"));
                    }
                }
            }

            unsafe {
                use std::os::windows::ffi::OsStrExt;
                use windows::Win32::Foundation::{LPARAM, WPARAM};
                use windows::Win32::UI::WindowsAndMessaging::{
                    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
                };
                let param: Vec<u16> = std::ffi::OsStr::new("Environment")
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect();
                let mut result = 0usize;
                let _ = SendMessageTimeoutW(
                    HWND_BROADCAST,
                    WM_SETTINGCHANGE,
                    WPARAM(0),
                    LPARAM(param.as_ptr() as isize),
                    SMTO_ABORTIFHUNG,
                    1000,
                    Some(&mut result),
                );
            }
        }

        // Do not remove this process's inherited variables. That would make a
        // recheck look clean while already-running terminals and Claude still
        // retain the same parent environment. Restart guidance remains visible
        // until Tono itself is relaunched from a corrected parent source.
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Explicit Quit/restart release (§6, L1): bump the generation, abort every task, then join the
/// single-flight explicit-release sequence. A preventable interactive exit is cancelled when
/// release cannot be proven; the unpreventable WM_ENDSESSION path applies its own short outer
/// budget in the run-event handler.
pub async fn quit_release(app: AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return Ok(());
    };
    let protected = {
        let mut inner = state.lock().await;
        inner.invalidate_connection(true);
        inner.tasks.abort_catalog_sync();
        fsm_reports_protection(&inner)
    };
    if protected {
        connection::release_explicit(&state, &app).await
    } else {
        Ok(())
    }
}

/// M3: exit is *committed* (RunEvent::Exit) — close the audit channel so
/// the writer drains, then wait for it (bounded). Kept strictly apart from
/// `quit_release`: a cancelled quit must not kill the audit trail.
pub async fn flush_audit_for_exit(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return;
    };
    state.audit().close_sender();
    if let Some(writer) = state.audit().take_writer() {
        let _ = tokio::time::timeout(AUDIT_FLUSH_BUDGET, writer).await;
    }
}

/// M3: the quit path was cancelled after `quit_release` already ran — the
/// barrier may really be gone while the FSM still claims protection.
/// Re-sync from the Service so the UI shows the truth.
pub async fn resync_after_cancelled_quit(app: AppHandle) {
    let Some(state) = app.try_state::<Arc<TonoState>>().map(|state| state.inner().clone()) else {
        return;
    };
    let kill_switch = service::tono_service_status_snapshot()
        .await
        .ok()
        .and_then(|snapshot| snapshot.kill_switch);
    let mut inner = state.lock().await;
    match kill_switch {
        Some(status) if status.wanted => {
            inner.cancel_server_tests();
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
            // No WFP answer (other platform or IPC down): keep the local
            // view and just re-emit below.
        }
    }
    emit_status(&app, &status_of(&inner));
}

#[cfg(test)]
mod tests {
    use super::{
        ProxyEnvEntry, TokenProbe, append_proxy_entries, command_output_with_timeout,
        file_uri_path,
        proxy_assignments_in_json, proxy_assignments_in_text,
        scan_json_proxy_directory, scan_json_proxy_file, scan_powershell_profile_directories,
        scan_text_proxy_directory,
        service_stop_permitted_on_quit, stage_key, test_server_endpoint, token_probe, ui_state_key,
        unknown_protection_message, vscode_profile_setting_paths, vscode_workspace_discovery,
    };
    use tono_core::connection::{ConnectStage, UiState};

    #[cfg(unix)]
    #[test]
    fn terminal_proxy_subprocess_timeout_is_bounded() {
        let mut command = std::process::Command::new("sleep");
        command.arg("1");
        let started = std::time::Instant::now();
        let error = command_output_with_timeout(
            &mut command,
            std::time::Duration::from_millis(20),
            4_096,
        ).unwrap_err();

        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
    }

    #[test]
    fn terminal_proxy_text_scanner_finds_active_shell_cmd_and_powershell_assignments() {
        let assignments = proxy_assignments_in_text(
            r#"
                # export HTTP_PROXY=http://comment.example
                export HTTP_PROXY=http://127.0.0.1:7890
                $env:https_proxy = 'http://localhost:8080'
                set -gx ALL_PROXY socks5://127.0.0.1:1080
                set "http_proxy=http://127.0.0.1:3128"
                set --export HTTPS_PROXY http://代理.example:8080
                echo preparing & @set ALL_PROXY=socks5://127.0.0.1:1081
                unset HTTPS_PROXY
                Remove-Item Env:ALL_PROXY
                $env:all_proxy = $null
            "#,
        );

        assert_eq!(assignments.get("HTTP_PROXY").map(String::as_str), Some("http://127.0.0.1:7890"));
        assert_eq!(assignments.get("https_proxy").map(String::as_str), Some("http://localhost:8080"));
        assert_eq!(assignments.get("ALL_PROXY").map(String::as_str), Some("socks5://127.0.0.1:1081"));
        assert_eq!(assignments.get("http_proxy").map(String::as_str), Some("http://127.0.0.1:3128"));
        assert_eq!(assignments.get("HTTPS_PROXY").map(String::as_str), Some("http://代理.example:8080"));
        assert_eq!(assignments.len(), 5, "comments and explicit removals are not residue");
    }

    #[test]
    fn terminal_proxy_text_scanner_finds_conditional_and_reinfecting_commands() {
        let assignments = proxy_assignments_in_text(
            r#"
                if command -v claude >/dev/null; then export HTTP_PROXY=http://conditional.example:8080; fi
                function Invoke-Claude { $env:HTTPS_PROXY = 'http://powershell-function.example:8080'; claude }
                launchctl setenv all_proxy socks5://launchd.example:1080
                setx http_proxy http://future-shells.example:3128
                alias claude='env https_proxy=http://alias.example:8080 claude'
                SETUVAR --export ALL_PROXY:socks5\x3a//fish-universal.example\x3a1080
            "#,
        );

        assert_eq!(
            assignments.get("HTTP_PROXY").map(String::as_str),
            Some("http://conditional.example:8080")
        );
        assert_eq!(
            assignments.get("HTTPS_PROXY").map(String::as_str),
            Some("http://powershell-function.example:8080")
        );
        assert_eq!(
            assignments.get("all_proxy").map(String::as_str),
            Some("socks5://launchd.example:1080")
        );
        assert_eq!(
            assignments.get("http_proxy").map(String::as_str),
            Some("http://future-shells.example:3128")
        );
        assert_eq!(
            assignments.get("https_proxy").map(String::as_str),
            Some("http://alias.example:8080")
        );
        assert_eq!(
            assignments.get("ALL_PROXY").map(String::as_str),
            Some("socks5\\x3a//fish-universal.example\\x3a1080")
        );
    }

    #[test]
    fn terminal_proxy_text_scanner_finds_nested_cmd_and_powershell_item_commands() {
        let assignments = proxy_assignments_in_text(
            r#"
                cmd /c "set HTTP_PROXY=http://cmd-wrapper.example:8080"
                for %A in (1) do @set HTTPS_PROXY=http://cmd-loop.example:8080
                function Set-ClaudeProxy { New-Item -LiteralPath Env:ALL_PROXY -Value 'socks5://powershell-item.example:1080' }
            "#,
        );

        assert_eq!(
            assignments.get("HTTP_PROXY").map(String::as_str),
            Some("http://cmd-wrapper.example:8080"),
        );
        assert_eq!(
            assignments.get("HTTPS_PROXY").map(String::as_str),
            Some("http://cmd-loop.example:8080"),
        );
        assert_eq!(
            assignments.get("ALL_PROXY").map(String::as_str),
            Some("socks5://powershell-item.example:1080"),
        );
    }

    #[test]
    fn terminal_proxy_json_scanner_handles_jsonc_and_exact_env_containers() {
        let vscode = proxy_assignments_in_json(
            r#"{
                // VS Code settings are JSONC.
                "terminal.integrated.env.windows": {
                    "HTTP_PROXY": "http://代理.example:7890",
                    "https_proxy": null,
                },
                "unrelated": { "ALL_PROXY": "must-not-match" }
            }"#,
            &["terminal.integrated.env.windows"],
        )
        .unwrap();
        assert_eq!(vscode.len(), 1);
        assert_eq!(vscode.get("HTTP_PROXY").map(String::as_str), Some("http://代理.example:7890"));

        let claude = proxy_assignments_in_json(
            r#"{"env":{"all_proxy":"socks5://localhost:1080"}}"#,
            &["env"],
        )
        .unwrap();
        assert_eq!(claude.get("all_proxy").map(String::as_str), Some("socks5://localhost:1080"));

        assert!(
            proxy_assignments_in_json(
                r#"{"env":{"HTTP_PROXY":"http://127.0.0.1:7890",}} trailing"#,
                &["env"],
            )
            .is_err(),
            "a proxy-bearing malformed settings file must not produce a false Ready"
        );
        assert!(
            proxy_assignments_in_json(
                r#"{"env":{"HTTP_PROXY":"http://127.0.0.1:7890"}} /* unfinished"#,
                &["env"],
            )
            .is_err(),
            "an unfinished JSONC comment must not be silently discarded"
        );
    }

    #[test]
    fn terminal_proxy_scanner_covers_all_users_powershell_profiles() {
        let root = std::env::temp_dir().join(format!(
            "tono-powershell-profiles-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("Microsoft.VSCode_profile.ps1"),
            "$env:HTTPS_PROXY = 'http://all-users.example:8080'",
        )
        .unwrap();
        let mut entries = Vec::new();
        scan_powershell_profile_directories(
            &mut entries,
            [root.clone()],
            "PowerShell all-users profile",
            "manual cleanup",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "HTTPS_PROXY");
        assert_eq!(entries[0].value, "<configured>");
        assert!(!entries[0].auto_clearable);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn terminal_proxy_scanner_covers_fish_conf_d_fragments() {
        let root = std::env::temp_dir().join(format!(
            "tono-fish-conf-d-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("claude-proxy.fish"),
            "set -gx HTTPS_PROXY http://fish-fragment.example:8080",
        )
        .unwrap();
        std::fs::write(root.join("ignored.txt"), "export HTTP_PROXY=http://ignored").unwrap();
        let mut entries = Vec::new();
        scan_text_proxy_directory(
            &mut entries,
            &root,
            "fish",
            "Fish conf.d profile",
            "manual cleanup",
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "HTTPS_PROXY");
        assert_eq!(entries[0].value, "<configured>");
        assert!(!entries[0].auto_clearable);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn terminal_proxy_scanner_covers_claude_managed_settings_dropins() {
        let root = std::env::temp_dir().join(format!(
            "tono-managed-settings-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let dropins = root.join("managed-settings.d");
        std::fs::create_dir_all(&dropins).unwrap();
        std::fs::write(
            root.join("managed-settings.json"),
            r#"{"env":{"HTTPS_PROXY":"http://managed.example"}}"#,
        )
        .unwrap();
        std::fs::write(
            dropins.join("20-network.json"),
            r#"{"env":{"http_proxy":"http://dropin.example"}}"#,
        )
        .unwrap();

        let mut entries = Vec::new();
        scan_json_proxy_file(
            &mut entries,
            &root.join("managed-settings.json"),
            &["env"],
            "Claude managed settings",
            "manual cleanup",
        )
        .unwrap();
        scan_json_proxy_directory(
            &mut entries,
            &dropins,
            &["env"],
            "Claude managed settings",
            "manual cleanup",
        )
        .unwrap();

        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|entry| entry.value == "<configured>"));
        assert!(entries.iter().all(|entry| !entry.auto_clearable));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn terminal_proxy_report_does_not_expose_credentials() {
        let mut entries: Vec<ProxyEnvEntry> = Vec::new();
        append_proxy_entries(
            &mut entries,
            std::collections::BTreeMap::from([(
                "HTTPS_PROXY".to_string(),
                "http://alice:super-secret@proxy.example:8080".to_string(),
            )]),
            "test source".to_string(),
            "test guidance".to_string(),
            false,
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].value, "<configured>");
        assert!(!format!("{entries:?}").contains("super-secret"));
    }

    #[test]
    fn vscode_file_uri_localhost_resolves_to_the_absolute_workspace() {
        let path = std::env::temp_dir().join("project #settings 雪");
        let uri = reqwest::Url::from_file_path(&path).unwrap().to_string();
        let localhost = uri.replacen("file:///", "file://localhost/", 1);
        assert_eq!(file_uri_path(&uri), Some(path.clone()));
        assert_eq!(file_uri_path(&localhost), Some(path));
    }

    #[test]
    fn vscode_file_uri_does_not_scan_remote_or_decorated_paths() {
        for uri in [
            "file://fileserver/team/project",
            "file:///C:/project?query",
            "file:///C:/project#fragment",
            "file:///C:/project%00",
            "https://example.com/project",
            "vscode-remote://ssh-remote+host/project",
        ] {
            assert_eq!(file_uri_path(uri), None, "unsupported URI: {uri}");
        }
    }

    #[test]
    fn vscode_workspace_discovery_follows_recent_folder_metadata() {
        let root = std::env::temp_dir().join(format!(
            "tono-terminal-env-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let user_dir = root.join("Code").join("User");
        let storage = user_dir.join("workspaceStorage").join("workspace-1");
        let workspace = root.join("project with spaces");
        std::fs::create_dir_all(&storage).unwrap();
        std::fs::create_dir_all(workspace.join(".vscode")).unwrap();
        std::fs::write(workspace.join(".vscode").join("settings.json"), "{}").unwrap();
        let workspace_uri = reqwest::Url::from_file_path(&workspace).unwrap();
        std::fs::write(
            storage.join("workspace.json"),
            serde_json::json!({ "folder": workspace_uri.as_str() }).to_string(),
        )
        .unwrap();

        let discovered = vscode_workspace_discovery(&user_dir).unwrap();
        assert_eq!(
            discovered.settings,
            vec![workspace.join(".vscode").join("settings.json")]
        );
        assert_eq!(discovered.roots, vec![workspace.clone()]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vscode_profile_settings_are_discovered() {
        let root = std::env::temp_dir().join(format!(
            "tono-vscode-profiles-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let profile = root.join("profiles").join("work");
        std::fs::create_dir_all(&profile).unwrap();
        std::fs::write(
            profile.join("settings.json"),
            r#"{"terminal.integrated.env.windows":{"HTTP_PROXY":"http://profile.example"}}"#,
        )
        .unwrap();

        let paths = vscode_profile_setting_paths(&root).unwrap();
        assert_eq!(paths, vec![profile.join("settings.json")]);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// The SCM service may only be stopped on an unprotected quit when the durable desired state
    /// is proven "core should not be running"; an armed or transiently unreadable desired state
    /// must keep the daemon, or the next service start would resurrect a stopped core.
    #[test]
    fn service_stop_on_quit_requires_a_proven_stopped_desired_state() {
        assert!(service_stop_permitted_on_quit(false, false));
        for (unknown, desired) in [(true, false), (false, true), (true, true)] {
            assert!(
                !service_stop_permitted_on_quit(unknown, desired),
                "desired_state_unknown={unknown}, core_should_be_running={desired} must keep the service"
            );
        }
    }

    #[test]
    fn stage_keys_cover_all_stages_in_order() {
        let keys: Vec<&str> = ConnectStage::ALL.iter().map(|stage| stage_key(*stage)).collect();
        assert_eq!(
            keys,
            [
                "preparing",
                "preparingService",
                "startingKillSwitch",
                "startingTunnel",
                "lockingTraffic",
                "applyingCloudPolicy",
                "securingDNS",
                "checkingExit",
                "verifyingTraffic",
            ]
        );
    }

    #[test]
    fn ui_state_keys_are_stable() {
        assert_eq!(ui_state_key(UiState::NotConnected), "notConnected");
        assert_eq!(ui_state_key(UiState::Connecting(ConnectStage::Preparing)), "connecting");
        assert_eq!(ui_state_key(UiState::Connected), "connected");
        assert_eq!(ui_state_key(UiState::ProtectedOffline), "protectedOffline");
        assert_eq!(ui_state_key(UiState::Disconnecting), "disconnecting");
    }

    #[test]
    fn an_unreadable_protection_state_is_reported_as_unknown_with_a_way_out() {
        let message = unknown_protection_message("pipe not found");
        // It must not read as "not protected", and it must carry both the cause and the
        // elevated command that restores connectivity if the app cannot release it.
        assert!(message.contains("unknown"), "{message}");
        assert!(message.contains("pipe not found"), "{message}");
        assert!(message.contains("emergency-disarm"), "{message}");
    }

    #[test]
    fn token_probe_decision_order() {
        let error = "keychain locked".to_string();
        let token = "rt-1".to_string();
        // A vault error wins over everything — it is the M1 error state,
        // never a mistaken signed-out.
        assert_eq!(token_probe(Some(&error), Some(&token)), TokenProbe::StoreError);
        assert_eq!(token_probe(Some(&error), None), TokenProbe::StoreError);
        assert_eq!(token_probe(None, Some(&token)), TokenProbe::HasToken);
        assert_eq!(token_probe(None, None), TokenProbe::NoToken);
    }

    #[tokio::test]
    async fn server_endpoint_test_reports_a_real_tcp_handshake() {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let accept = tokio::spawn(async move { listener.accept().await.unwrap() });

        let result = test_server_endpoint(
            "US Test".to_string(),
            address,
            tokio_util::sync::CancellationToken::new(),
        )
        .await;

        assert_eq!(result.name, "US Test");
        assert!(result.latency_ms.is_some());
        assert!(result.error.is_none());
        accept.await.unwrap();
    }

    #[tokio::test]
    async fn server_endpoint_test_honors_cancellation() {
        let cancellation = tokio_util::sync::CancellationToken::new();
        cancellation.cancel();
        let result = test_server_endpoint("JP Test".to_string(), "192.0.2.1:443".parse().unwrap(), cancellation).await;

        assert_eq!(result.latency_ms, None);
        assert_eq!(result.error.as_deref(), Some("cancelled"));
    }
}
