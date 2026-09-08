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

pub mod terminal;
pub use terminal::{ProxyEnvEntry, TerminalEnvReport};

pub mod account;
pub mod catalog;
pub mod connection_cmd;
pub mod restore;
pub mod diagnostics;
pub mod quit;
pub use account::{
    load_credentials, tono_account, tono_devices, tono_repair_service, tono_revoke_device,
    tono_service_prerequisites, tono_sign_in_start, tono_sign_in_verify, tono_sign_out,
};
pub use catalog::{
    tono_cancel_server_tests, tono_catalog_status, tono_refresh_catalog, tono_select_server,
    tono_servers, tono_test_available_servers, tono_test_current_server,
};
pub use connection_cmd::{
    retry_now, tono_close_all_connections, tono_close_connection, tono_connect, tono_connect_progress,
    tono_disconnect, tono_retry_now, tono_status,
};
pub use restore::{restore_session, restore_session_guarded, tono_retry_restore};
pub use diagnostics::{
    tono_audit_enabled, tono_audit_log_path, tono_diagnostics_report, tono_network_log_upload_enabled,
    tono_periodic_telemetry_enabled, tono_set_audit_enabled, tono_set_network_log_upload_enabled,
    tono_set_periodic_telemetry_enabled, tono_upload_diagnostics,
};
pub use quit::{
    flush_audit_for_exit, quit_protection_active, quit_release, resync_after_cancelled_quit,
    stop_service_on_unprotected_quit, tono_prepare_update,
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
pub(super) static STATUS_SNAPSHOT: Lazy<ArcSwapOption<TonoStatus>> = Lazy::new(ArcSwapOption::empty);

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
#[cfg(test)]
mod tests {
    use super::{
        ProxyEnvEntry, TokenProbe, stage_key, token_probe, ui_state_key,
    };
    use super::catalog::test_server_endpoint;
    use super::quit::service_stop_permitted_on_quit;
    use super::restore::unknown_protection_message;
    use super::terminal::{
        append_proxy_entries, command_output_with_timeout, file_uri_path, proxy_assignments_in_json,
        proxy_assignments_in_text, scan_json_proxy_directory, scan_json_proxy_file,
        scan_powershell_profile_directories, scan_text_proxy_directory, vscode_profile_setting_paths,
        vscode_workspace_discovery,
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
