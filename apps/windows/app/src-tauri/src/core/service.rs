#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::utils::dirs;
use crate::{
    config::Config,
    core::{
        CoreManager,
        handle::Handle,
        manager::RunningMode,
        owner_identity::current_owner_credentials,
        proxy_control,
        runstate::{
            OwnerRecoveryReason, OwnerSample, OwnerStep, OwnerWatch, PendingAction, RUN_STATE, ReadyWaitError,
            RunState, RunStateEnv, RunStateStore, ServiceHealth,
        },
        tray::Tray,
    },
    process::AsyncHandler,
};
use anyhow::{Context as _, Result, bail};
use tono_logging::{Type, logging};
#[cfg(target_os = "macos")]
use tono_service_protocol::MacosKillSwitchMode;
use tono_service_protocol::{
    DirectRuntimeReloadResult, DnsProtectionStatus, FinalizeDirectRuntimeReloadRequest, KillSwitchConfig,
    KillSwitchLockRequest, KillSwitchStatus, KillSwitchStatusMode, MacosProxyConfig, OwnerCredentials,
    OwnerSessionProof, ProxyApplyOutcome, RenewDirectRuntimeReloadRequest, ReplaceDirectEndpointsRequest,
    RuntimeBundle, ServiceStatusSnapshot, StageRuntimeOutcome, StartClashRequest, StopClashOptions, WriterConfig,
};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
#[cfg(any(target_os = "macos", test))]
use std::path::Path;
use std::{
    borrow::Cow,
    env::current_exe,
    future::Future,
    path::PathBuf,
    process::Command as StdCommand,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

static OWNER_MONITOR_GENERATION: AtomicU64 = AtomicU64::new(0);
static ACTIVE_SERVICE_SESSION: Lazy<Mutex<Option<ActiveServiceSession>>> = Lazy::new(|| Mutex::new(None));

/// `mark verified` is session-gated but idempotent. A distant/loaded Windows machine can lose
/// one named-pipe response immediately after the Service committed it, so reconcile and retry
/// this one mutation explicitly instead of destroying an otherwise fully verified tunnel.
const MARK_VERIFIED_ATTEMPTS: u32 = 3;
const MARK_VERIFIED_RETRY_DELAY: Duration = Duration::from_millis(500);
/// Rev-10 DIRECT bracket mutations are idempotent. Replay once only when the transport response
/// is ambiguous; a Service refusal is authoritative and is never retried.
const DIRECT_MUTATION_ATTEMPTS: u32 = 2;
const DIRECT_MUTATION_RETRY_DELAY: Duration = Duration::from_millis(350);

/// The Service session that owns the running Core, and what that Service can do.
///
/// The capability is learned once, when the Core is started, and discarded with the session
/// rather than cached globally — it describes *the Service instance that owns this Core*, which
/// is the only scope where it is safe to act on. A Service upgraded underneath a running Core
/// does not silently gain abilities the Core it owns was not started under.
#[derive(Clone)]
struct ActiveServiceSession {
    proof: OwnerSessionProof,
    supports_runtime_staging: bool,
    supports_macos_kill_switch: bool,
    supports_direct_runtime_reload: bool,
}

fn generate_service_session_token() -> Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).context("failed to generate service owner session")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub(crate) fn active_service_session() -> Result<OwnerSessionProof> {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .map(|session| session.proof.clone())
        .context("service owner session is not active")
}

/// Capture the exact owner session that will own every operation in the rev-10 reload bracket.
/// Callers retain this proof rather than consulting the mutable global again after a node switch.
pub(crate) fn active_direct_runtime_reload_session() -> Result<OwnerSessionProof> {
    let sessions = ACTIVE_SERVICE_SESSION.lock();
    let session = sessions.as_ref().context("service owner session is not active")?;
    if !session.supports_direct_runtime_reload {
        bail!("active Tono Service session does not support fail-closed DIRECT runtime reload");
    }
    Ok(session.proof.clone())
}

fn active_service_supports_macos_kill_switch() -> bool {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .is_some_and(|session| session.supports_macos_kill_switch)
}

pub(crate) fn clear_active_service_session() {
    ACTIVE_SERVICE_SESSION.lock().take();
}

/// Ask the Service whether it speaks the staging half of the protocol.
///
/// A failure here is not a failure to start: it only costs the fast path, so it is reported as
/// "no" and logged rather than propagated.
async fn probe_runtime_staging_support() -> bool {
    match tono_service_protocol::get_version().await {
        Ok(response) if response.code == 0 => response
            .data
            .as_ref()
            .is_some_and(tono_service_protocol::ProtocolInfo::supports_runtime_staging),
        Ok(response) => {
            logging!(
                warn,
                Type::Service,
                "服务协议查询返回 {}: {}；配置变更将走重启路径",
                response.code,
                response.message
            );
            false
        }
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "无法查询服务协议版本: {error:#}；配置变更将走重启路径"
            );
            false
        }
    }
}

async fn probe_direct_runtime_reload_support() -> bool {
    matches!(
        tono_service_protocol::get_version().await,
        Ok(response)
            if response.code == 0
                && response
                    .data
                    .as_ref()
                    .is_some_and(tono_service_protocol::ProtocolInfo::supports_direct_runtime_reload)
    )
}

#[cfg(target_os = "macos")]
pub(crate) async fn preflight_macos_kill_switch() -> Result<()> {
    let version = tono_service_protocol::get_version()
        .await
        .context("无法查询 Tono Service 协议版本")?;
    let supported = version.code == 0
        && version
            .data
            .as_ref()
            .is_some_and(tono_service_protocol::ProtocolInfo::supports_macos_kill_switch_preflight);
    if !supported {
        bail!("当前 Tono Service 不支持 Kill Switch 预检，请先重新安装服务");
    }

    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::preflight_macos_kill_switch(&credentials)
        .await
        .context("无法连接到 Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

fn session_matches_status(proof: &OwnerSessionProof, is_active: bool, active_generation: Option<u64>) -> bool {
    is_active && active_generation == Some(proof.generation)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceStatus {
    Checking,
    Ready,
    NotInstalled,
    NeedsReinstall,
    InstallRequired,
    UninstallRequired,
    ReinstallRequired,
    ForceReinstallRequired,
    SidecarAllowed,
    Unavailable(String),
}

impl ServiceStatus {
    /// Flatten a Run State snapshot into the legacy single-slot status.
    ///
    /// Precedence mirrors what the single slot used to hold: a requested action shadows an
    /// accepted Sidecar, which shadows the last observation. Kept until the frontend seam
    /// moves to `RunState` wholesale.
    fn from_run_state(state: &RunState) -> Self {
        if let Some(action) = state.pending {
            return match action {
                PendingAction::Install => Self::InstallRequired,
                PendingAction::Uninstall => Self::UninstallRequired,
                PendingAction::Reinstall => Self::ReinstallRequired,
                PendingAction::ForceReinstall => Self::ForceReinstallRequired,
            };
        }
        if state.sidecar_allowed {
            return Self::SidecarAllowed;
        }
        match &state.health {
            ServiceHealth::Unknown => Self::Checking,
            ServiceHealth::Ready => Self::Ready,
            ServiceHealth::NotInstalled => Self::NotInstalled,
            ServiceHealth::VersionMismatch => Self::NeedsReinstall,
            ServiceHealth::Unavailable(reason) => Self::Unavailable(reason.clone()),
        }
    }
}

#[cfg(target_os = "macos")]
fn path_entry_exists_without_follow(path: &Path) -> std::io::Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
fn macos_service_install_markers() -> Vec<String> {
    vec![
        format!(
            "/Library/LaunchDaemons/{}.plist",
            tono_service_protocol::MACOS_SERVICE_ID
        ),
        format!(
            "/Library/PrivilegedHelperTools/{}.bundle",
            tono_service_protocol::MACOS_SERVICE_ID
        ),
        #[cfg(not(feature = "verge-dev"))]
        "/Library/LaunchDaemons/io.github.clashverge.helper.plist".to_owned(),
        #[cfg(not(feature = "verge-dev"))]
        "/Library/PrivilegedHelperTools/io.github.clashverge.helper".to_owned(),
    ]
}

#[cfg(target_os = "macos")]
fn macos_service_install_marker_exists() -> std::io::Result<bool> {
    for marker in macos_service_install_markers() {
        if path_entry_exists_without_follow(Path::new(&marker))? {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(windows)]
pub(crate) fn trusted_service_evidence() -> Result<bool> {
    use windows_service::{
        Error as WindowsServiceError,
        service::ServiceAccess,
        service_manager::{ServiceManager as WindowsServiceManager, ServiceManagerAccess},
    };

    const ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;
    let manager = WindowsServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    match manager.open_service(
        tono_service_protocol::WINDOWS_SERVICE_NAME,
        ServiceAccess::QUERY_STATUS,
    ) {
        Ok(service) => {
            drop(service);
            Ok(true)
        }
        Err(WindowsServiceError::Winapi(error)) if error.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST) => {
            Ok(false)
        }
        Err(error) => Err(error).context("failed to inspect Windows service registration"),
    }
}

/// Ask the Service to stop itself via IPC (`POST /lifecycle/owner-goodbye`) — the App's
/// unprotected-quit path. A plain user cannot STOP a SYSTEM-owned service through the SCM (the
/// direct `OpenService(STOP)` attempt fails with `os error 5`), so the App asks the Service to
/// stop itself instead. The route is only accepted when the machine no longer needs the daemon:
/// kill switch unarmed and the durable desired state proven "core should not be running" — the
/// Service re-checks both server-side and refuses with 409 (`StillProtected`) otherwise, so the
/// client-side snapshot pre-check is a fast path, not the enforcement.
#[cfg(windows)]
pub(crate) async fn tono_request_service_owner_goodbye() -> Result<()> {
    let credentials = current_owner_credentials().context("无法读取 owner 凭证")?;
    let response = tono_service_protocol::owner_goodbye(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!("Tono Service 拒绝了自停请求: {}", response.message);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub(crate) fn trusted_service_evidence() -> Result<bool> {
    let unit = format!("{}.service", tono_service_protocol::SERVICE_SLUG);
    let output = StdCommand::new("systemctl")
        .args(["show", "--property=LoadState", "--value", &unit])
        .output()
        .context("failed to inspect systemd service registration")?;
    if !output.status.success() {
        bail!(
            "systemd service registration probe failed with status {}",
            output.status
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() != "not-found")
}

#[cfg(target_os = "macos")]
pub(crate) fn trusted_service_evidence() -> Result<bool> {
    macos_service_install_marker_exists().context("failed to inspect launchd service registration")
}

/// Legacy façade over [`RUN_STATE`].
///
/// Holds no state of its own: Service Health, the requested action and the privileged-operation
/// lock all live in `core::runstate`. This type survives only so that existing call sites keep
/// compiling while the seam moves; it is retired once they read `RunState` directly.
pub struct ServiceManager;

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
static SERVICE_CORE_STAGING_GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
fn create_service_core_staging_file(directory: &Path, core_name: &std::ffi::OsStr) -> Result<(PathBuf, std::fs::File)> {
    for _ in 0..32 {
        let generation = SERVICE_CORE_STAGING_GENERATION.fetch_add(1, Ordering::Relaxed);
        let temporary_name = format!(
            ".{}.{}.{generation}.tmp",
            core_name.to_string_lossy(),
            std::process::id()
        );
        let temporary_path = directory.join(temporary_name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => return Ok((temporary_path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to create temporary development Service core {}",
                        temporary_path.display()
                    )
                });
            }
        }
    }

    bail!(
        "failed to create a unique temporary development Service core in {}",
        directory.display()
    )
}

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
fn service_core_path_for(source: &Path, home: Option<&Path>, stage_for_macos_dev: bool) -> Result<PathBuf> {
    service_core_path_for_with_publisher(
        source,
        home,
        stage_for_macos_dev,
        "service-core",
        |temporary_path, final_path| {
            std::fs::rename(temporary_path, final_path).with_context(|| {
                format!(
                    "failed to publish development Service core {} over {}",
                    temporary_path.display(),
                    final_path.display()
                )
            })
        },
    )
}

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), all(test, unix)))]
fn service_tool_path_for(source: &Path, home: Option<&Path>, stage_for_macos_dev: bool) -> Result<PathBuf> {
    service_core_path_for_with_publisher(
        source,
        home,
        stage_for_macos_dev,
        "service-tools",
        |temporary_path, final_path| {
            std::fs::rename(temporary_path, final_path).with_context(|| {
                format!(
                    "failed to publish development Service tool {} over {}",
                    temporary_path.display(),
                    final_path.display()
                )
            })
        },
    )
}

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
#[cfg_attr(not(unix), allow(unreachable_code, unused_assignments, unused_variables))]
fn service_core_path_for_with_publisher<F>(
    source: &Path,
    home: Option<&Path>,
    stage_for_macos_dev: bool,
    staging_directory_name: &str,
    publisher: F,
) -> Result<PathBuf>
where
    F: FnOnce(&Path, &Path) -> Result<()>,
{
    if !stage_for_macos_dev {
        return Ok(source.to_path_buf());
    }

    let home = home
        .filter(|path| !path.as_os_str().is_empty())
        .context("HOME is unavailable for development Service core staging")?;
    let core_name = source
        .file_name()
        .filter(|name| !name.is_empty())
        .with_context(|| format!("development Service core source has no file name: {}", source.display()))?;
    let source_metadata = std::fs::symlink_metadata(source)
        .with_context(|| format!("failed to inspect development Service core source {}", source.display()))?;
    if !source_metadata.file_type().is_file() {
        bail!(
            "development Service core source is not an ordinary file: {}",
            source.display()
        );
    }
    let mut source_file = std::fs::File::open(source)
        .with_context(|| format!("failed to open development Service core source {}", source.display()))?;

    let staging_directory = home
        .join("Applications/.tono-dev")
        .join(staging_directory_name);
    std::fs::create_dir_all(&staging_directory).with_context(|| {
        format!(
            "failed to create development Service core staging directory {}",
            staging_directory.display()
        )
    })?;
    let final_path = staging_directory.join(core_name);
    let (temporary_path, mut temporary_file) = create_service_core_staging_file(&staging_directory, core_name)?;

    let publish_result = (|| -> Result<()> {
        std::io::copy(&mut source_file, &mut temporary_file).with_context(|| {
            format!(
                "failed to copy development Service core from {} to {}",
                source.display(),
                temporary_path.display()
            )
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;

            let mut permissions = temporary_file
                .metadata()
                .with_context(|| format!("failed to inspect temporary Service core {}", temporary_path.display()))?
                .permissions();
            permissions.set_mode(0o755);
            temporary_file.set_permissions(permissions).with_context(|| {
                format!(
                    "failed to set executable permissions on temporary Service core {}",
                    temporary_path.display()
                )
            })?;
        }
        #[cfg(not(unix))]
        bail!("development Service core staging requires Unix executable permissions");

        temporary_file
            .sync_all()
            .with_context(|| format!("failed to sync temporary Service core {}", temporary_path.display()))?;
        drop(temporary_file);
        publisher(&temporary_path, &final_path)?;
        Ok(())
    })();

    if let Err(error) = publish_result {
        match std::fs::remove_file(&temporary_path) {
            Ok(()) => return Err(error),
            Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => return Err(error),
            Err(cleanup_error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to clean temporary development Service core {}: {cleanup_error}",
                        temporary_path.display()
                    )
                });
            }
        }
    }

    Ok(final_path)
}

#[cfg(target_os = "macos")]
#[cfg_attr(not(feature = "verge-dev"), allow(clippy::unnecessary_wraps))]
fn macos_service_tool_path(source: &Path) -> Result<PathBuf> {
    #[cfg(feature = "verge-dev")]
    {
        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        service_tool_path_for(source, home.as_deref(), true)
    }

    #[cfg(not(feature = "verge-dev"))]
    Ok(source.to_path_buf())
}

fn service_core_path(clash_core: &str, bin_ext: &str) -> Result<PathBuf> {
    let sibling = current_exe()?.with_file_name(format!("{clash_core}{bin_ext}"));

    // A locally built App normally sits outside Program Files, while the production Service
    // deliberately accepts cores only from the installed allowlist and with the build-injected
    // SHA-256. Keep those two Service-side checks intact and expose only a feature-gated test
    // pointer to an *already installed* core. This is the seam used by real-Windows integration
    // tests; it grants no new path or hash to the Service.
    #[cfg(all(target_os = "windows", feature = "windows-integration-test"))]
    if let Some(value) = std::env::var_os("TONO_WINDOWS_INTEGRATION_CORE_PATH") {
        let path = PathBuf::from(value);
        if !path.is_absolute() {
            bail!("TONO_WINDOWS_INTEGRATION_CORE_PATH must be absolute");
        }
        if !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("tono-core.exe"))
        {
            bail!("TONO_WINDOWS_INTEGRATION_CORE_PATH must name tono-core.exe");
        }
        return Ok(path);
    }

    #[cfg(all(target_os = "macos", feature = "verge-dev"))]
    {
        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        service_core_path_for(&sibling, home.as_deref(), true)
    }

    #[cfg(not(all(target_os = "macos", feature = "verge-dev")))]
    Ok(sibling)
}

/// 卸载服务前以 root 清理残留 core 和 IPC 套接字。
#[cfg(target_os = "macos")]
fn macos_force_stop_core_shell() -> String {
    use crate::config::IVerge;

    // 只清理 root 拥有的服务内核。
    let mut parts: Vec<String> = IVerge::VALID_CLASH_CORES
        .iter()
        .map(|core| format!("/usr/bin/pkill -U root -x {core} 2>/dev/null || true"))
        .collect();

    if let Ok(ipc) = dirs::ipc_path()
        && let Ok(ipc_str) = dirs::path_to_str(&ipc)
    {
        // 转义单引号,避免破坏 shell 参数。
        let escaped = ipc_str.replace('\'', r"'\''");
        parts.push(format!("/bin/rm -f '{escaped}' 2>/dev/null || true"));
    }

    parts.join("; ")
}

#[cfg(target_os = "macos")]
fn escape_osascript_double_quoted_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(any(target_os = "macos", test))]
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(any(target_os = "macos", test))]
fn macos_install_shell(install_path: &Path, gid: u32) -> String {
    let install_quoted = shell_single_quote(&install_path.to_string_lossy());
    format!("cd /; TONO_SERVICE_GID={gid} {install_quoted}")
}

fn packaged_service_tool_path(file_name: &str, packaged_path: impl FnOnce() -> Result<PathBuf>) -> Result<PathBuf> {
    #[cfg(feature = "verge-dev")]
    {
        drop(packaged_path);
        let directory = std::env::var_os("TONO_DEV_SERVICE_DIR")
            .or_else(|| std::env::var_os("CLASH_VERGE_DEV_SERVICE_DIR"))
            .context("TONO_DEV_SERVICE_DIR is missing from the development session")?;
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            bail!("TONO_DEV_SERVICE_DIR must be an absolute path");
        }
        Ok(directory.join(file_name))
    }

    #[cfg(not(feature = "verge-dev"))]
    {
        let _ = file_name;
        packaged_path()
    }
}

#[cfg(target_os = "windows")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt as _;

    let uninstall_path = packaged_service_tool_path("tono-service-uninstall.exe", || {
        Ok(dirs::service_path()?.with_file_name("tono-service-uninstall.exe"))
    })?;

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;
    let status = match level {
        PrivilegeLevel::NotPrivileged => RunasCommand::new(uninstall_path).show(false).status()?,
        _ => StdCommand::new(uninstall_path).creation_flags(0x08000000).status()?,
    };

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn install_service() -> Result<()> {
    use std::process::Output;
    logging!(info, Type::Service, "install service");

    use deelevate::{PrivilegeLevel, Token};
    use runas::Command as RunasCommand;
    use std::os::windows::process::CommandExt as _;

    let install_path = packaged_service_tool_path("tono-service-install.exe", || {
        Ok(dirs::service_path()?.with_file_name("tono-service-install.exe"))
    })?;

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let token = Token::with_current_process()?;
    let level = token.privilege_level()?;
    let output = match level {
        PrivilegeLevel::NotPrivileged => {
            let status = RunasCommand::new(&install_path).show(false).status()?;
            Output {
                status,
                stdout: Vec::new(),
                stderr: Vec::new(),
            }
        }
        _ => {
            // `.status()`, never `.output()`: output collection waits for
            // *every* handle inherited from the pipe to close, so any
            // survivor in the installer child chain deadlocks the install
            // forever (the real-machine "operation_running" hang). The cost
            // is losing the installer's stderr detail; the exit code and
            // this log line are what remain, plus the 150 s privileged-op
            // timeout in the Run State above us.
            let status = StdCommand::new(&install_path).creation_flags(0x08000000).status()?;
            Output {
                status,
                stdout: Vec::new(),
                stderr: Vec::new(),
            }
        }
    };

    // Windows Installer's 3010 means the old Service was restarted successfully and the staged
    // binary will replace it at reboot. Treating it as an ordinary failure leaves Run State on
    // the repair path even though the Service is usable right now.
    if output.status.code() == Some(3010) {
        logging!(
            warn,
            Type::Service,
            "service repair completed with a pending binary replacement; restart Windows to finish the update"
        );
        return Ok(());
    }

    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("failed to install service code: {}, details: {}", code, err);
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    let uninstall_path = packaged_service_tool_path("tono-service-uninstall", || {
        Ok(tauri::utils::platform::current_exe()?.with_file_name("tono-service-uninstall"))
    })?;

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let elevator = crate::utils::help::linux_elevator();
    let status = if linux_running_as_root() {
        StdCommand::new(&uninstall_path).status()?
    } else {
        let result = StdCommand::new(&elevator).arg(&uninstall_path).status()?;

        // 如果 pkexec 执行失败，回退到 sudo
        if !result.success() && elevator.contains("pkexec") {
            logging!(
                warn,
                Type::Service,
                "pkexec failed with code {}, falling back to sudo",
                result.code().unwrap_or(-1)
            );
            StdCommand::new("sudo").arg(&uninstall_path).status()?
        } else {
            result
        }
    };
    logging!(
        info,
        Type::Service,
        "uninstall status code:{}",
        status.code().unwrap_or(-1)
    );

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn install_service() -> Result<()> {
    logging!(info, Type::Service, "install service");

    let install_path = packaged_service_tool_path("tono-service-install", || {
        Ok(tauri::utils::platform::current_exe()?.with_file_name("tono-service-install"))
    })?;

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    let elevator = crate::utils::help::linux_elevator();
    let output = if linux_running_as_root() {
        StdCommand::new(&install_path).output()?
    } else {
        let result = StdCommand::new(&elevator).arg(&install_path).output()?;

        // 如果 pkexec 执行失败，回退到 sudo
        if !result.status.success() && elevator.contains("pkexec") {
            logging!(
                warn,
                Type::Service,
                "pkexec failed with code {}, falling back to sudo",
                result.status.code().unwrap_or(-1)
            );
            StdCommand::new("sudo").arg(&install_path).output()?
        } else {
            result
        }
    };

    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("failed to install service code: {}, details: {}", code, err);
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_running_as_root() -> bool {
    use crate::core::handle;
    use tauri_plugin_tono_sysinfo::is_current_app_handle_admin;
    let app_handle = handle::Handle::app_handle();
    is_current_app_handle_admin(app_handle)
}

#[cfg(target_os = "macos")]
fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    let uninstall_path = packaged_service_tool_path("tono-service-uninstall", || {
        Ok(dirs::service_path()?.with_file_name("tono-service-uninstall"))
    })?;

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_path = macos_service_tool_path(&uninstall_path)?;
    let uninstall_shell: String = uninstall_path.to_string_lossy().into_owned();

    // tono_i18n::sync_locale(Config::verge().await.latest_arc().language.as_deref());

    let prompt = tono_i18n::t!("service.adminUninstallPrompt");
    // 先清理服务残留,再执行卸载器。
    let uninstall_quoted = shell_single_quote(&uninstall_shell);
    let shell = format!("cd /; {}; {uninstall_quoted}", macos_force_stop_core_shell());
    let shell = escape_osascript_double_quoted_string(&shell);
    let command = format!(r#"do shell script "{shell}" with administrator privileges with prompt "{prompt}""#);

    // logging!(debug, Type::Service, "uninstall command: {}", command);

    let status = StdCommand::new("osascript").args(vec!["-e", &command]).status()?;

    if !status.success() {
        bail!(
            "failed to uninstall service with status {}",
            status.code().unwrap_or(-1)
        );
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn install_service() -> Result<()> {
    logging!(info, Type::Service, "install service");

    let binary_path = packaged_service_tool_path("tono-service", dirs::service_path)?;
    let install_path = packaged_service_tool_path("tono-service-install", || {
        Ok(dirs::service_path()?.with_file_name("tono-service-install"))
    })?;

    if !install_path.exists() {
        bail!(format!("installer not found: {install_path:?}"));
    }

    macos_service_tool_path(&binary_path)?;
    let install_path = macos_service_tool_path(&install_path)?;

    // tono_i18n::sync_locale(Config::verge().await.latest_arc().language.as_deref());

    let gid = tauri_plugin_tono_sysinfo::current_gid();
    let prompt = tono_i18n::t!("service.adminInstallPrompt");
    let shell = macos_install_shell(&install_path, gid);
    let shell = escape_osascript_double_quoted_string(&shell);
    let command = format!(r#"do shell script "{shell}" with administrator privileges with prompt "{prompt}""#);

    let output = StdCommand::new("osascript").args(vec!["-e", &command]).output()?;
    if let Some((code, err)) = check_output_error(&output) {
        logging!(
            error,
            Type::Service,
            "failed to install service code: {}, details: {}",
            code,
            err
        );
        bail!("failed to install service code: {}, details: {}", code, err);
    }

    Ok(())
}

fn check_output_error(output: &std::process::Output) -> Option<(i32, Cow<'_, str>)> {
    if output.status.success() {
        return None;
    }
    let code = output.status.code().unwrap_or(-1);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.is_empty() {
        return Some((code, stderr));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.is_empty() {
        return Some((code, stdout));
    }
    Some((code, Cow::Borrowed("Unknown error")))
}

fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, "reinstall service");
    install_service()
}

/// 强制重装服务（UI修复按钮）
fn force_reinstall_service() -> Result<()> {
    logging!(info, Type::Service, "用户请求强制重装服务");
    install_service().map_err(|err| {
        logging!(error, Type::Service, "强制重装服务失败: {}", err);
        err
    })
}

/// Dispatch a privileged operation to the platform implementation.
///
/// Blocking work, so it is handed to a blocking thread: the caller is async.
pub(crate) fn run_privileged_service_action(action: PendingAction) -> Result<()> {
    let (operation, label): (fn() -> Result<()>, &'static str) = match action {
        PendingAction::Install => (install_service, "install service"),
        PendingAction::Uninstall => (uninstall_service, "uninstall service"),
        PendingAction::Reinstall => (reinstall_service, "reinstall service"),
        PendingAction::ForceReinstall => (force_reinstall_service, "force reinstall service"),
    };
    tokio::task::block_in_place(operation).with_context(|| format!("{label} failed"))
}

/// Stage the exact in-memory Tono runtime for a rev-10 DIRECT hot reload. Unlike the generic
/// configuration path, this function never interprets `RestartRequired` as permission to replace
/// the Core. The connection transaction owns that fail-closed decision.
pub(crate) async fn tono_stage_runtime_for_direct_reload(
    session: &OwnerSessionProof,
    runtime: &RuntimeBundle,
) -> Result<StageRuntimeOutcome> {
    let credentials = current_owner_credentials()?;
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::stage_runtime(&credentials, session, runtime).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(outcome) = response.data {
                    return Ok(outcome);
                }
                last_ambiguous = Some("Tono Service omitted the runtime staging result".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT runtime staging remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

async fn capture_generation_before<F, Fut, T>(generation: &AtomicU64, operation: F) -> (u64, T)
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    let captured = generation.load(Ordering::Acquire);
    (captured, operation().await)
}

pub(crate) async fn get_clash_log_snapshot_by_service() -> Result<String> {
    let credentials = current_owner_credentials()?;
    let (generation, response) = capture_generation_before(&OWNER_MONITOR_GENERATION, || {
        tono_service_protocol::get_clash_log_snapshot(&credentials)
    })
    .await;
    let response = response.context("无法连接到Tono Service")?;
    if response.code > 0 {
        if response.code == tono_service_protocol::ServiceErrorCode::NotActive as u16 {
            recover_after_owner_loss(generation, OwnerRecoveryReason::Displaced).await;
        }
        bail!(response.message);
    }
    let encoded = response.data.context("服务未返回核心日志快照")?;
    if encoded.len() % 2 != 0 {
        bail!("服务返回了无效的核心日志快照");
    }
    let mut content = Vec::with_capacity(encoded.len() / 2);
    for offset in (0..encoded.len()).step_by(2) {
        content.push(u8::from_str_radix(&encoded[offset..offset + 2], 16).context("服务返回了无效的核心日志快照")?);
    }
    Ok(String::from_utf8_lossy(&content).into_owned())
}

/// 通过服务停止core
pub(super) async fn stop_core_by_service(release_kill_switch: bool) -> Result<()> {
    logging!(info, Type::Service, "通过服务停止核心 (IPC)");
    cancel_owner_monitors();

    let credentials = match current_owner_credentials() {
        Ok(credentials) => credentials,
        Err(error) => {
            start_owner_monitor();
            return Err(error);
        }
    };
    let session = match active_service_session() {
        Ok(session) => session,
        Err(error) => {
            start_owner_monitor();
            return Err(error);
        }
    };
    let response = match if active_service_supports_macos_kill_switch() {
        tono_service_protocol::stop_clash_with_options(
            &credentials,
            &session,
            StopClashOptions { release_kill_switch },
        )
        .await
    } else {
        tono_service_protocol::stop_clash(&credentials, &session).await
    } {
        Ok(response) => response,
        Err(error) => {
            start_owner_monitor();
            return Err(error).context("无法连接到Tono Service");
        }
    };

    if response.code > 0 {
        if matches!(
            response.code,
            code if code == tono_service_protocol::ServiceErrorCode::NotActive as u16
                || code == tono_service_protocol::ServiceErrorCode::StaleOwnerSession as u16
        ) {
            recover_after_owner_loss_while_locked(OwnerRecoveryReason::Displaced).await;
        } else {
            start_owner_monitor();
        }
        let err_msg = response.message;
        logging!(error, Type::Service, "停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    clear_active_service_session();
    logging!(info, Type::Service, "服务成功停止核心");
    Ok(())
}

// ---- Tono product layer (crate::tono) ----
//
// The Tono connect orchestration drives the Service through the same owner/session machinery as
// the legacy flows above; these wrappers only differ in the payload they carry (owned runtime +
// Windows kill switch) and in always speaking the protocol rev 5 options.

/// Reconcile stale copies of Tono's installed Core before the App binds loopback DNS as an
/// availability proof. The privileged Service preserves only a fully verified protected runtime;
/// it stops weaker supervised/recorded instances and validates canonical image paths for the
/// orphan sweep. The App never enumerates or terminates processes itself.
pub(crate) async fn tono_prepare_core_start() -> Result<u32> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::prepare_core_start(&credentials)
        .await
        .context("无法连接到 Tono Service 以准备核心")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回核心准备结果")
}

/// Core binary path for the Tono owned runtime: the same mihomo build the Service runs.
pub(crate) async fn tono_core_binary_path() -> Result<PathBuf> {
    let bin_ext = if cfg!(windows) { ".exe" } else { "" };
    // The managed Tono product has one audited data-plane binary. A legacy Verge setting must not
    // silently select the alpha sidecar, which would also force every installer to ship two cores.
    service_core_path("tono-core", bin_ext)
}

/// Whether the Tono Service is installed, running, and protocol-compatible.
///
/// Tono has no sidecar fallback: anything but `Ready` is a hard error for the connect flow.
pub(crate) async fn tono_service_ready() -> Result<()> {
    SERVICE_MANAGER.refresh().await?;
    match SERVICE_MANAGER.current().await {
        ServiceStatus::Ready => Ok(()),
        status => bail!("Tono Service 不可用: {status:?}"),
    }
}

/// Ready check for the connect flow, with one recovery attempt.
///
/// Since an unprotected App quit now stops the SCM service, a registered-but-unavailable Service
/// is the expected state on the next connect, not a broken install. Revive it through the
/// established elevated install/repair entry (`PendingAction::Install` → `tono-service-install`
/// stops/reconfigures/starts the service idempotently), then re-check readiness. Every other
/// failure is returned untouched.
pub(crate) async fn tono_service_ready_or_repair() -> Result<()> {
    match tono_service_ready().await {
        Ok(()) => Ok(()),
        Err(error) => {
            if repair_registered_stopped_service().await {
                return tono_service_ready().await;
            }
            Err(error)
        }
    }
}

/// One attempt to revive a Service that is registered with the SCM but not answering, via the
/// established privileged install/repair path. `false` means the caller stays on its original
/// error path: the Service is not registered (install is a separate, user-authorised decision),
/// or the repair itself failed (e.g. the elevation prompt was declined).
#[cfg(windows)]
async fn repair_registered_stopped_service() -> bool {
    if !trusted_service_evidence().unwrap_or(false) {
        return false;
    }
    logging!(
        info,
        Type::Service,
        "Tono: 服务已注册但未运行（上次未连接退出时所停），经 install/repair 入口拉起"
    );
    match SERVICE_MANAGER
        .handle_service_status(ServiceStatus::InstallRequired)
        .await
    {
        Ok(()) => true,
        Err(error) => {
            logging!(
                warn,
                Type::Service,
                "Tono: 停止状态服务的修复拉起失败: {error:#}"
            );
            false
        }
    }
}

#[cfg(not(windows))]
async fn repair_registered_stopped_service() -> bool {
    false
}

/// Whether the installed Service has the complete Windows protection contract: WFP + DNS,
/// owner-gated release, the durable verified-session marker, **and** the current system-safety
/// floor (`MIN_REQUIRED_SERVICE_REVISION`). Feature-only checks (rev ≥ 5/6/8) are not enough —
/// a Test 5 Service already had those bits but still freezes status behind the lifecycle lock
/// and uses the old DNS restore semantics. Pairing a new App with that Service after a failed
/// installer replacement must fail closed here, not during a half-armed connect.
/// Whether the installed Service speaks the kill-switch protocol this client needs.
///
/// Returns `None` when it does, and the *reason* when it does not. `supports_client` is false in
/// both directions — an epoch newer than ours fails it exactly like an older one — so a caller
/// holding only a bool can do nothing but guess, and guessing "too old" tells a user with a
/// newer Service to reinstall the thing that is already ahead. The detail comes from
/// `classify_service_version_reply`, which prints both sides' numbers.
pub(crate) async fn tono_probe_kill_switch_release_support() -> Result<Option<String>> {
    let response = tono_service_protocol::get_version()
        .await
        .context("无法连接到 Tono Service")?;
    let supported = response.code == 0
        && response.data.as_ref().is_some_and(|info| {
            info.supports_client(
                tono_service_protocol::ProtocolVersion::current(),
                tono_service_protocol::MIN_REQUIRED_SERVICE_REVISION,
            ) && tono_service_protocol::ProtocolInfo::supports_windows_kill_switch(info)
                && tono_service_protocol::ProtocolInfo::supports_kill_switch_release(info)
                && tono_service_protocol::ProtocolInfo::supports_kill_switch_verification(info)
                && tono_service_protocol::ProtocolInfo::supports_direct_runtime_reload(info)
        });
    if supported {
        return Ok(None);
    }
    // Reuse Run State's classifier so the App has exactly one wording for a protocol mismatch.
    let reply = crate::core::runstate::ServiceVersionReply {
        code: response.code,
        message: response.message,
        protocol: response.data,
    };
    let detail = match crate::core::runstate::classify_service_version_reply(&reply) {
        crate::core::runstate::ServiceVersionCheck::NeedsReinstall(detail) => detail,
        // The version handshake is acceptable, so what failed is one of the kill-switch
        // capability bits: an in-epoch Service that predates them.
        crate::core::runstate::ServiceVersionCheck::Ready => {
            "Service does not expose the Windows kill-switch arm/lock/release/verify/DIRECT-reload operations"
                .to_owned()
        }
    };
    Ok(Some(detail))
}

/// Start the core with the Tono owned runtime and the WFP bootstrap kill switch.
///
/// The Service persists intent, arms the bootstrap policy (block all + Mihomo endpoint permit +
/// bounded API channel), writes the runtime copy, and starts the verified core; a failure
/// anywhere in that sequence is fail-closed on the Service side. Mirrors
/// `start_with_existing_service` so the owner session, the owner monitor, and the Run State all
/// observe the Tono core exactly like a legacy one.
pub(crate) async fn tono_start_core_with_kill_switch(
    runtime: RuntimeBundle,
    kill_switch: KillSwitchConfig,
) -> Result<()> {
    logging!(info, Type::Service, "Tono: 通过服务启动核心并 arm Kill Switch");
    // Cancel the previous start's owner monitor before the session is cleared, exactly as
    // `tono_stop_core` does. Between this line and `adopt_tono_service_session` the Service
    // truthfully answers "not your session", and a monitor still ticking in that window reads
    // its own successor's handoff as displacement and runs the full owner-loss recovery —
    // stopping the proxy guard and resetting the system proxy — while this StartClash is in
    // flight. A connect with a cloud policy passes through this window twice.
    cancel_owner_monitors();
    clear_active_service_session();

    let credentials = current_owner_credentials()?;
    // A lost StartClash response is ambiguous: the Service may already have committed the new
    // owner session. Capture the prior generation so a fresh post-error generation can be safely
    // adopted with the proposed token instead of leaving a running Core that this App cannot stop.
    let generation_before = tono_active_generation(&credentials).await.ok();
    let proposed_session_token = generate_service_session_token()?;
    let request = StartClashRequest {
        runtime,
        proposed_session_token: proposed_session_token.clone(),
        macos_proxy: None,
        kill_switch: None,
        windows_kill_switch: Some(kill_switch),
    };

    let response = match tono_service_protocol::start_clash(&credentials, &request).await {
        Ok(response) => response,
        Err(error) => {
            if let Some(generation) = reconcile_lost_tono_start(&credentials, generation_before).await {
                adopt_tono_service_session(generation, proposed_session_token).await;
                logging!(
                    warn,
                    Type::Service,
                    "Tono: StartClash response was lost, but Service generation {generation} proves the start committed"
                );
                return Ok(());
            }
            start_owner_monitor();
            return Err(error).context("无法连接到Tono Service");
        }
    };

    if response.code > 0 {
        let err_msg = response.message;
        logging!(error, Type::Service, "Tono: 启动核心失败: {}", err_msg);
        start_owner_monitor();
        bail!(err_msg);
    }

    let Some(result) = response.data else {
        if let Some(generation) = reconcile_lost_tono_start(&credentials, generation_before).await {
            adopt_tono_service_session(generation, proposed_session_token).await;
            logging!(
                warn,
                Type::Service,
                "Tono: StartClash omitted its response body, but Service generation {generation} proves the start committed"
            );
            return Ok(());
        }
        start_owner_monitor();
        bail!("Tono Service 未返回会话信息");
    };
    adopt_tono_service_session(result.session.generation, proposed_session_token).await;
    logging!(info, Type::Service, "Tono: 服务成功启动核心");
    Ok(())
}

async fn tono_active_generation(credentials: &OwnerCredentials) -> Result<Option<u64>> {
    let response = tono_service_protocol::get_status(credentials)
        .await
        .context("无法查询 Tono Service 状态")?;
    if response.code > 0 {
        bail!(response.message);
    }
    let status = response.data.context("Tono Service 未返回状态快照")?;
    Ok(status.is_active.then_some(status.active_generation).flatten())
}

/// Prove that an ambiguous StartClash advanced the owner generation. `None` means no proof: an
/// already-active prior generation must never be paired with the new request's session token.
async fn reconcile_lost_tono_start(
    credentials: &OwnerCredentials,
    generation_before: Option<Option<u64>>,
) -> Option<u64> {
    let after = tono_active_generation(credentials).await.ok()??;
    advanced_tono_generation(generation_before, Some(after))
}

fn advanced_tono_generation(generation_before: Option<Option<u64>>, generation_after: Option<u64>) -> Option<u64> {
    let before = generation_before?;
    let after = generation_after?;
    (Some(after) != before).then_some(after)
}

async fn adopt_tono_service_session(generation: u64, proposed_session_token: String) {
    let supports_runtime_staging = probe_runtime_staging_support().await;
    let supports_direct_runtime_reload = probe_direct_runtime_reload_support().await;
    *ACTIVE_SERVICE_SESSION.lock() = Some(ActiveServiceSession {
        proof: OwnerSessionProof {
            generation,
            token: proposed_session_token,
        },
        supports_runtime_staging,
        supports_macos_kill_switch: false,
        supports_direct_runtime_reload,
    });

    start_owner_monitor();
    CoreManager::global().core_started(RunningMode::Service);
}

/// Stop the Tono core, always speaking the rev 5 stop options.
///
/// `release_kill_switch = false` keeps the WFP policy armed (fail-closed reconnect path);
/// `true` is one of the three releasing causes (Disconnect / Sign Out / Quit).
pub(crate) async fn tono_stop_core(release_kill_switch: bool) -> Result<()> {
    logging!(
        info,
        Type::Service,
        "Tono: 通过服务停止核心 (release_kill_switch={release_kill_switch})"
    );
    cancel_owner_monitors();

    let credentials = current_owner_credentials()?;
    let session = active_service_session()?;
    let response = tono_service_protocol::stop_clash_with_options(
        &credentials,
        &session,
        StopClashOptions { release_kill_switch },
    )
    .await
    .context("无法连接到Tono Service")?;

    if response.code > 0 {
        if matches!(
            response.code,
            code if code == tono_service_protocol::ServiceErrorCode::NotActive as u16
                || code == tono_service_protocol::ServiceErrorCode::StaleOwnerSession as u16
        ) {
            recover_after_owner_loss_while_locked(OwnerRecoveryReason::Displaced).await;
        } else {
            start_owner_monitor();
        }
        let err_msg = response.message;
        logging!(error, Type::Service, "Tono: 停止核心失败: {}", err_msg);
        bail!(err_msg);
    }

    clear_active_service_session();
    CoreManager::global().core_stopped();
    logging!(info, Type::Service, "Tono: 服务成功停止核心");
    Ok(())
}

/// `GET /kill-switch/status` (session owner required): which arm phase is live.
pub(crate) async fn tono_kill_switch_status() -> Result<KillSwitchStatus> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::get_kill_switch_status(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回 Kill Switch 状态")
}

/// Enter the fail-closed half of the rev-10 reload bracket with one captured owner session.
pub(crate) async fn tono_begin_direct_runtime_reload(session: &OwnerSessionProof) -> Result<DirectRuntimeReloadResult> {
    let credentials = current_owner_credentials()?;
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::begin_direct_runtime_reload(&credentials, session).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(result) = response.data {
                    return Ok(result);
                }
                last_ambiguous = Some("Tono Service omitted the DIRECT begin proof".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT begin remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

/// Atomically commit the complete exact DIRECT endpoint set with one captured owner session.
pub(crate) async fn tono_replace_direct_endpoints(
    session: &OwnerSessionProof,
    reload_id: u64,
    direct_endpoints: Vec<tono_service_protocol::ProxyEndpoint>,
    reviewed_direct_ports: Vec<u16>,
) -> Result<DirectRuntimeReloadResult> {
    let credentials = current_owner_credentials()?;
    let request = ReplaceDirectEndpointsRequest {
        reload_id,
        direct_endpoints,
        // Declared only when this plan actually emitted process-scoped rules. An empty
        // declaration means the Service renders no reviewed-port permit, which is the correct
        // answer for a plan whose every route is an exact pin.
        reviewed_direct_ports,
    };
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::replace_direct_endpoints(&credentials, session, request.clone()).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(result) = response.data {
                    return Ok(result);
                }
                last_ambiguous = Some("Tono Service omitted the DIRECT endpoint commit proof".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT endpoint commit remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

/// Finalize the Service-owned pending DIRECT lease after all post-install proofs. Replaying the
/// same bracket/digest is idempotent, which closes the lost-response window without authorizing a
/// stale App transaction to modify a newer bracket.
pub(crate) async fn tono_finalize_direct_runtime_reload(
    session: &OwnerSessionProof,
    reload_id: u64,
    endpoint_digest: &str,
) -> Result<DirectRuntimeReloadResult> {
    let credentials = current_owner_credentials()?;
    let request = FinalizeDirectRuntimeReloadRequest {
        reload_id,
        endpoint_digest: endpoint_digest.to_owned(),
    };
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::finalize_direct_runtime_reload(&credentials, session, request.clone()).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(result) = response.data {
                    return Ok(result);
                }
                last_ambiguous = Some("Tono Service omitted the DIRECT finalize proof".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT finalize remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

/// Renew an already-finalized DIRECT lease. The Service accepts only the captured owner session,
/// reload id, and endpoint digest; replay is idempotent and no endpoint set is widened here.
pub(crate) async fn tono_renew_direct_runtime_reload(
    session: &OwnerSessionProof,
    reload_id: u64,
    endpoint_digest: &str,
) -> Result<DirectRuntimeReloadResult> {
    let credentials = current_owner_credentials()?;
    let request = RenewDirectRuntimeReloadRequest {
        reload_id,
        endpoint_digest: endpoint_digest.to_owned(),
    };
    let mut last_ambiguous = None;
    for attempt in 1..=DIRECT_MUTATION_ATTEMPTS {
        match tono_service_protocol::renew_direct_runtime_reload(&credentials, session, request.clone()).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                if let Some(result) = response.data {
                    return Ok(result);
                }
                last_ambiguous = Some("Tono Service omitted the DIRECT renewal proof".to_owned());
            }
            Err(error) => {
                last_ambiguous = Some(format!("无法连接到Tono Service: {error:#}"));
            }
        }
        if attempt < DIRECT_MUTATION_ATTEMPTS {
            tokio::time::sleep(DIRECT_MUTATION_RETRY_DELAY).await;
        }
    }
    bail!(
        "DIRECT renewal remained ambiguous after replay: {}",
        last_ambiguous.unwrap_or_else(|| "no response".to_owned())
    )
}

/// `POST /kill-switch/lock`: permit the tunnel interface and retract the API bootstrap channel.
/// Idempotent on the Service side; doubles as the TUN adapter existence check.
pub(crate) async fn tono_lock_kill_switch_for_session(session: &OwnerSessionProof) -> Result<()> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::lock_kill_switch(
        &credentials,
        session,
        KillSwitchLockRequest { tunnel_interface: None },
    )
    .await
    .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

pub(crate) async fn tono_mark_kill_switch_verified_for_session(session: &OwnerSessionProof) -> Result<()> {
    let credentials = current_owner_credentials()?;
    let mut last_transport_error = None;
    for attempt in 1..=MARK_VERIFIED_ATTEMPTS {
        match tono_service_protocol::mark_kill_switch_verified(&credentials, session).await {
            Ok(response) => {
                if response.code > 0 {
                    bail!(response.message);
                }
                return Ok(());
            }
            Err(error) => {
                last_transport_error = Some(error);

                // The response may be the only thing that was lost. A fully locked, live,
                // verified read-back proves the idempotent mutation committed and is stronger
                // evidence than replaying it blindly.
                if let Ok(status_response) = tono_service_protocol::get_kill_switch_status(&credentials).await
                    && status_response.code == 0
                    && status_response.data.as_ref().is_some_and(mark_verified_committed)
                {
                    logging!(
                        warn,
                        Type::Service,
                        "Tono: MarkVerified response was lost, but Service status proves it committed"
                    );
                    return Ok(());
                }
            }
        }

        if attempt < MARK_VERIFIED_ATTEMPTS {
            tokio::time::sleep(MARK_VERIFIED_RETRY_DELAY).await;
        }
    }

    match last_transport_error {
        Some(error) => Err(error).context("无法连接到Tono Service"),
        None => bail!("MarkVerified retry loop completed without a response"),
    }
}

fn mark_verified_committed(status: &KillSwitchStatus) -> bool {
    status.wanted
        && status.verified
        && status.live
        && status.mode == KillSwitchStatusMode::Locked
        && status.tunnel_permit_rendered
}

/// `POST /kill-switch/restrict-bootstrap`: keep blocking, reopen only the API recovery channel.
pub(crate) async fn tono_restrict_bootstrap() -> Result<()> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::restrict_kill_switch_bootstrap(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

/// `POST /dns/enable`: snapshot adapter DNS and point resolvers at loopback.
pub(crate) async fn tono_enable_protected_dns_for_session(session: &OwnerSessionProof) -> Result<DnsProtectionStatus> {
    let credentials = current_owner_credentials()?;
    let response = match tono_service_protocol::enable_protected_dns(&credentials, session).await {
        Ok(response) => response,
        Err(error) => {
            // A write can commit even when its response is lost. This operation is idempotent,
            // but the IPC layer deliberately does not retry writes; instead prove the complete
            // postcondition with a read before reporting failure to the connection transaction.
            if let Ok(status_response) = tono_service_protocol::get_protected_dns_status(&credentials).await
                && status_response.code == 0
                && let Some(status) = status_response.data
                && status.enabled
                && status.snapshot_present
                && status.adapters > 0
                && status.last_error.is_none()
            {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: DNS enable response was lost, but the Service status proves protection completed"
                );
                return Ok(status);
            }
            return Err(error).context("无法连接到Tono Service");
        }
    };
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回 DNS 保护状态")
}

/// `GET /dns/status`: independent proof used by the Connected health monitor. In particular,
/// this detects a newly added adapter even if its first netmon event happened while the monitor
/// was seeding its event counter.
pub(crate) async fn tono_protected_dns_status() -> Result<DnsProtectionStatus> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::get_protected_dns_status(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回 DNS 保护状态")
}

/// `POST /dns/restore`: restore the snapshotted adapter DNS. Always runs before the kill
/// switch is disarmed; a failure here keeps the system armed (product contract §6).
pub(crate) async fn tono_restore_protected_dns() -> Result<DnsProtectionStatus> {
    let credentials = current_owner_credentials()?;
    let response = match tono_service_protocol::restore_protected_dns(&credentials).await {
        Ok(response) => response,
        Err(error) => {
            // A transport error may mean only the response was lost. Prove the idempotent
            // postcondition before telling Disconnect that protection must remain armed.
            if let Ok(status_response) = tono_service_protocol::get_protected_dns_status(&credentials).await
                && status_response.code == 0
                && let Some(status) = status_response.data
                && !status.snapshot_present
                && !status.enabled
            {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: DNS restore response was lost, but the Service status proves restore completed"
                );
                return Ok(status);
            }
            return Err(error).context("无法连接到Tono Service");
        }
    };
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回 DNS 保护状态")
}

/// `GET /status`: the full Service snapshot (kill switch aggregate + network event feed).
pub(crate) async fn tono_service_status_snapshot() -> Result<ServiceStatusSnapshot> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::get_status(&credentials)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回状态快照")
}

/// `POST /kill-switch/release` (owner-gated, protocol rev 6): the explicit
/// user disarm. Works without a session — by the time Protected Offline is
/// released, the session that armed the switch is long gone. Idempotent on
/// the Service side and itself enforces DNS-before-disarm.
pub(crate) async fn tono_release_kill_switch() -> Result<KillSwitchStatus> {
    let credentials = current_owner_credentials()?;
    let response = match tono_service_protocol::release_kill_switch(&credentials).await {
        Ok(response) => response,
        Err(error) => {
            // Release is idempotent. If only its response was lost, a read-back prevents the UI
            // from falsely claiming protection remains on after WFP was already disarmed.
            if let Ok(status_response) = tono_service_protocol::get_kill_switch_status(&credentials).await
                && status_response.code == 0
                && let Some(status) = status_response.data
                && !status.wanted
                && !status.live
            {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: kill-switch release response was lost, but status proves disarm completed"
                );
                cancel_owner_monitors();
                clear_active_service_session();
                CoreManager::global().core_stopped();
                return Ok(status);
            }
            return Err(error).context("无法连接到Tono Service");
        }
    };
    if response.code > 0 {
        bail!(response.message);
    }
    let status = response.data.context("Tono Service 未返回 Kill Switch 状态")?;
    if !status.wanted && !status.live {
        // The owner-gated Service release is a complete last-resort disconnect and may have
        // stopped a Core after our session-gated best-effort stop failed. Mirror that committed
        // reality locally so Quit and the next Connect never reuse a stale session/running mode.
        cancel_owner_monitors();
        clear_active_service_session();
        CoreManager::global().core_stopped();
    }
    Ok(status)
}

/// Whether a live owner session exists for session-gated routes (stop-core
/// among them). False in Protected Offline after an app restart — which is
/// exactly why the release path is owner-gated instead (C1).
#[cfg(not(windows))]
pub(crate) fn tono_session_live() -> bool {
    ACTIVE_SERVICE_SESSION.lock().is_some()
}

pub(crate) async fn update_writer_by_service(writer: &WriterConfig) -> Result<()> {
    let credentials = current_owner_credentials()?;
    let session = active_service_session()?;
    let response = tono_service_protocol::update_writer(&credentials, &session, writer)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    Ok(())
}

pub(super) async fn set_system_proxy_by_service(proxy: &MacosProxyConfig) -> Result<ProxyApplyOutcome> {
    let session = active_service_session()?;
    set_system_proxy_by_service_with_session(proxy, &session).await
}

pub(super) async fn set_system_proxy_by_service_with_session(
    proxy: &MacosProxyConfig,
    session: &OwnerSessionProof,
) -> Result<ProxyApplyOutcome> {
    let credentials = current_owner_credentials()?;
    let response = tono_service_protocol::set_system_proxy(&credentials, session, proxy)
        .await
        .context("无法连接到Tono Service")?;
    if response.code > 0 {
        bail!(response.message);
    }
    response.data.context("Tono Service 未返回系统代理结果")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OwnerRecoveryPolicy {
    reset_system_proxy: bool,
}

const fn owner_recovery_policy(_reason: OwnerRecoveryReason, is_macos: bool) -> OwnerRecoveryPolicy {
    OwnerRecoveryPolicy {
        reset_system_proxy: !is_macos,
    }
}

fn mark_service_unavailable_after_owner_loss<E: RunStateEnv>(store: &RunStateStore<E>, reason: OwnerRecoveryReason) {
    if matches!(reason, OwnerRecoveryReason::TransportFailure) {
        store.observe(ServiceHealth::Unavailable(
            "service control IPC unavailable after sustained transport failure".to_owned(),
        ));
    }
}

/// How often the owner monitor samples Service status.
const OWNER_MONITOR_INTERVAL: Duration = Duration::from_secs(2);
/// Mirrors `OwnerWatch`'s tolerance, for the log line only.
const SUSTAINED_OWNER_SAMPLES: u8 = 3;

fn start_owner_monitor() {
    let generation = OWNER_MONITOR_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    AsyncHandler::spawn(move || async move {
        let mut watch = OwnerWatch::new();
        loop {
            tokio::time::sleep(OWNER_MONITOR_INTERVAL).await;
            if OWNER_MONITOR_GENERATION.load(Ordering::Acquire) != generation {
                break;
            }
            if !matches!(*CoreManager::global().get_running_mode(), RunningMode::Service) {
                break;
            }

            let sample = read_owner_sample().await;
            let mut step = watch.observe(sample);
            if matches!(step, OwnerStep::VerifyTransport) {
                if watch.just_became_sustained() {
                    logging!(
                        warn,
                        Type::Service,
                        "service owner status unavailable for {SUSTAINED_OWNER_SAMPLES} samples; \
                         preserving local proxy state while the core endpoint still answers"
                    );
                }
                let owner_endpoint_available = Handle::mihomo().get_version().await.is_ok();
                step = watch.resolve_transport(owner_endpoint_available);
            }

            if let OwnerStep::Recover(reason) = step {
                recover_after_owner_loss(generation, reason).await;
                break;
            }
        }
    });
}

/// Ask the Service who owns it, flattening every unusable answer into one sample.
///
/// A transport error, an error code and an empty payload are the same thing to the watch:
/// we did not learn anything. Only the log line distinguishes them.
async fn read_owner_sample() -> OwnerSample {
    let response = match current_owner_credentials() {
        Ok(credentials) => tono_service_protocol::get_status(&credentials).await,
        Err(error) => Err(error),
    };

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            logging!(debug, Type::Service, "service owner status was unreadable: {error:#}");
            return OwnerSample::Unreadable;
        }
    };

    if response.code == tono_service_protocol::ServiceErrorCode::NotActive as u16 {
        return OwnerSample::NotActive;
    }
    if response.code != 0 {
        logging!(
            debug,
            Type::Service,
            "service owner status returned error {}: {}",
            response.code,
            response.message
        );
        return OwnerSample::Unreadable;
    }
    let Some(status) = response.data else {
        logging!(debug, Type::Service, "service owner status omitted data");
        return OwnerSample::Unreadable;
    };

    // A session that no longer matches is another owner's, whatever the flags say.
    if !session_matches_active_status(status.is_active, status.active_generation) {
        return OwnerSample::NotActive;
    }

    OwnerSample::Status {
        is_active: status.is_active,
        desired_core_should_be_running: status.desired_core_should_be_running,
        service_state: status.service_state,
        core_pid: status.core_pid,
    }
}

fn session_matches_active_status(is_active: bool, active_generation: Option<u64>) -> bool {
    ACTIVE_SERVICE_SESSION
        .lock()
        .as_ref()
        .is_some_and(|session| session_matches_status(&session.proof, is_active, active_generation))
}

fn cancel_owner_monitors() {
    OWNER_MONITOR_GENERATION.fetch_add(1, Ordering::AcqRel);
}

#[allow(dead_code)]
pub(crate) fn owner_monitor_generation() -> u64 {
    OWNER_MONITOR_GENERATION.load(Ordering::Acquire)
}

async fn recover_after_owner_loss(generation: u64, reason: OwnerRecoveryReason) {
    let manager = CoreManager::global();
    if !matches!(*manager.get_running_mode(), RunningMode::Service) {
        return;
    }
    let Some(recovery_generation) = claim_owner_recovery_generation(&OWNER_MONITOR_GENERATION, generation) else {
        return;
    };
    manager.invalidate_core_readiness();
    let _lifecycle = manager.lifecycle_lock.lock().await;
    if OWNER_MONITOR_GENERATION.load(Ordering::Acquire) != recovery_generation
        || !matches!(*manager.get_running_mode(), RunningMode::Service)
    {
        return;
    }
    recover_after_owner_loss_while_locked(reason).await;
}

fn claim_owner_recovery_generation(generation: &AtomicU64, captured_generation: u64) -> Option<u64> {
    let recovery_generation = captured_generation.wrapping_add(1);
    generation
        .compare_exchange(
            captured_generation,
            recovery_generation,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .ok()
        .map(|_| recovery_generation)
}

async fn recover_after_owner_loss_while_locked(reason: OwnerRecoveryReason) {
    logging!(
        warn,
        Type::Service,
        "service owner recovery ({reason:?}); clearing local proxy and PAC state"
    );
    mark_service_unavailable_after_owner_loss(&RUN_STATE, reason);
    proxy_control::stop_guard().await;
    clear_active_service_session();
    CoreManager::global().core_stopped();

    if !owner_recovery_policy(reason, cfg!(target_os = "macos")).reset_system_proxy {
        return;
    }

    let mut last_error = None;
    for _ in 0..3 {
        match proxy_control::clear().await {
            Ok(()) => return,
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
    if let Some(error) = last_error {
        logging!(
            error,
            Type::Service,
            "failed to clear local proxy after owner loss: {error}"
        );
    }
}

/// Wait for a freshly installed or repaired Service to answer.
///
/// Silence for the whole budget *is* an observation here — the Service had its window and
/// never spoke — unlike a single failed probe. A readable but rejected reply already recorded
/// its own verdict, which must not be flattened into "unavailable".
async fn wait_for_service_ipc() -> Result<()> {
    const CONTEXT: &str = "service IPC did not become available";
    let config = ServiceManager::config();

    match RUN_STATE.await_ready(config.max_retries, config.retry_delay).await {
        Ok(_) => Ok(()),
        Err(ReadyWaitError::Unreachable(error)) => {
            RUN_STATE.observe(ServiceHealth::Unavailable(format!("{CONTEXT}: {error:#}")));
            Err(error).context(CONTEXT)
        }
        Err(ReadyWaitError::Rejected(error)) => Err(error).context(CONTEXT),
    }
}

impl ServiceManager {
    pub const fn config() -> tono_service_protocol::IpcConfig {
        tono_service_protocol::IpcConfig {
            default_timeout: Duration::from_millis(150),
            retry_delay: Duration::from_millis(250),
            max_retries: 20,
        }
    }

    pub async fn confirm_ready(&self) -> Result<()> {
        RUN_STATE.probe().await.map(|_| ())
    }

    pub async fn current(&self) -> ServiceStatus {
        ServiceStatus::from_run_state(&RUN_STATE.settled().await)
    }

    #[allow(dead_code)]
    pub fn allow_sidecar_for_session(&self) -> Result<()> {
        RUN_STATE.allow_sidecar_for_session()
    }

    pub fn require_install_for_session(&self) -> Result<()> {
        RUN_STATE.require_install_for_session()
    }

    #[allow(dead_code)]
    pub(crate) fn withdraw_sidecar_allowance(&self) -> bool {
        RUN_STATE.withdraw_sidecar_allowance()
    }

    pub async fn detect_startup_status(&self) {
        if cfg!(feature = "dev-sidecar") {
            RUN_STATE.accept_sidecar();
            return;
        }
        RUN_STATE.observe_current_health().await;
    }

    fn set_status(&self, status: ServiceStatus) {
        record_status(&RUN_STATE, status);
    }

    async fn run_operation(&self, operation: impl Future<Output = Result<()>>) -> Result<()> {
        run_operation_and_then(&RUN_STATE, operation, || async {
            if let Err(error) = Tray::global().update_menu().await {
                logging!(
                    warn,
                    Type::Service,
                    "failed to refresh tray after service operation: {error:#}"
                );
            }
            Ok(())
        })
        .await
    }

    pub async fn refresh(&self) -> Result<()> {
        self.run_operation(async { self.confirm_ready().await }).await
    }

    pub async fn handle_service_status(&self, status: ServiceStatus) -> Result<()> {
        // Box the large operation future once instead of carrying it in every calling command.
        self.run_operation(Box::pin(self.apply_service_status(status))).await
    }

    async fn apply_service_status(&self, status: ServiceStatus) -> Result<()> {
        // Derived from the caller's own argument, not read back out of the store: an
        // observation racing in between would clear the pending action and silently turn a
        // user-authorised install into a no-op.
        let Some(action) = requested_action(&status) else {
            self.set_status(status.clone());
            return report_non_actionable_status(status);
        };
        // Atomically record the request and capture the Sidecar allowance it clears.
        let sidecar_allowed_before = RUN_STATE.request_action(action);

        logging!(info, Type::Service, "running privileged service action {action:?}");
        run_action_restoring_sidecar(&RUN_STATE, sidecar_allowed_before, async move {
            RUN_STATE.perform(action).await?;
            if !matches!(action, PendingAction::Uninstall) {
                wait_for_service_ipc().await?;
                Config::restore_tun_for_session().await;
            }
            Ok(())
        })
        .await
    }
}

/// Run the full action workflow and restore the session's previous Sidecar allowance on failure.
///
/// This includes the readiness wait: an action has not landed until the Service responds.
async fn run_action_restoring_sidecar<E: RunStateEnv>(
    store: &RunStateStore<E>,
    was_allowed: bool,
    action: impl Future<Output = Result<()>>,
) -> Result<()> {
    let outcome = action.await;
    if outcome.is_err() && was_allowed && store.restore_sidecar_allowance() {
        logging!(
            info,
            Type::Service,
            "restored the Sidecar this session had already settled on"
        );
    }
    outcome
}

/// Explain a status that asks for no privileged action, refusing the ones we cannot act on.
fn report_non_actionable_status(status: ServiceStatus) -> Result<()> {
    match status {
        ServiceStatus::Checking => bail!("service status is still being checked"),
        ServiceStatus::Ready => logging!(info, Type::Service, "服务就绪，直接启动"),
        ServiceStatus::NotInstalled => {
            logging!(info, Type::Service, "service is not installed; Sidecar is available");
        }
        ServiceStatus::NeedsReinstall => {
            bail!("service needs reinstall; explicit authorization is required");
        }
        ServiceStatus::Unavailable(reason) => {
            logging!(info, Type::Service, "服务不可用: {}，将使用Sidecar模式", reason);
            bail!("服务不可用: {}", reason);
        }
        ServiceStatus::SidecarAllowed => {
            logging!(
                info,
                Type::Service,
                "Sidecar was explicitly allowed for this app session"
            );
        }
        ServiceStatus::InstallRequired
        | ServiceStatus::UninstallRequired
        | ServiceStatus::ReinstallRequired
        | ServiceStatus::ForceReinstallRequired => {
            bail!("a requested action should have been handled as a privileged operation")
        }
    }
    Ok(())
}

/// Run a privileged operation while holding the Run State operation slot.
///
/// The slot is released — and `settled` waiters woken — before `post_operation` runs, so a
/// post-operation refresh such as the tray menu observes the final state rather than a
/// state still flagged as in-flight.
async fn run_operation_and_then<E, Post, PostFuture>(
    store: &RunStateStore<E>,
    operation: impl Future<Output = Result<()>>,
    post_operation: Post,
) -> Result<()>
where
    E: RunStateEnv,
    Post: FnOnce() -> PostFuture,
    PostFuture: Future<Output = Result<()>>,
{
    let result = {
        let _operation = store.begin_operation()?;
        operation.await
    };
    result?;
    post_operation().await
}

/// Apply a legacy single-slot status to a Run State, splitting it back into observation and
/// request. The inverse of [`ServiceStatus::from_run_state`].
/// The privileged operation a status is asking for, if any.
///
/// A pure function of the status so that a caller can decide what to run without reading the
/// store back and racing an observation.
const fn requested_action(status: &ServiceStatus) -> Option<PendingAction> {
    match status {
        ServiceStatus::InstallRequired => Some(PendingAction::Install),
        ServiceStatus::UninstallRequired => Some(PendingAction::Uninstall),
        ServiceStatus::ReinstallRequired => Some(PendingAction::Reinstall),
        ServiceStatus::ForceReinstallRequired => Some(PendingAction::ForceReinstall),
        ServiceStatus::Checking
        | ServiceStatus::Ready
        | ServiceStatus::NotInstalled
        | ServiceStatus::NeedsReinstall
        | ServiceStatus::SidecarAllowed
        | ServiceStatus::Unavailable(_) => None,
    }
}

fn record_status<E: RunStateEnv>(store: &RunStateStore<E>, status: ServiceStatus) {
    if let Some(action) = requested_action(&status) {
        store.request_action(action);
        return;
    }

    match status {
        ServiceStatus::SidecarAllowed => store.accept_sidecar(),
        ServiceStatus::Checking => store.observe(ServiceHealth::Unknown),
        ServiceStatus::Ready => store.observe(ServiceHealth::Ready),
        ServiceStatus::NotInstalled => store.observe(ServiceHealth::NotInstalled),
        ServiceStatus::NeedsReinstall => store.observe(ServiceHealth::VersionMismatch),
        ServiceStatus::Unavailable(reason) => store.observe(ServiceHealth::Unavailable(reason)),
        ServiceStatus::InstallRequired
        | ServiceStatus::UninstallRequired
        | ServiceStatus::ReinstallRequired
        | ServiceStatus::ForceReinstallRequired => {
            // Recorded by the early return above; listed so a new variant still fails to
            // compile here rather than falling through a catch-all.
        }
    }
}

pub static SERVICE_MANAGER: ServiceManager = ServiceManager;

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, reason = "tests assert by panicking")]
mod tests {
    use super::{
        MARK_VERIFIED_ATTEMPTS, ServiceHealth, ServiceStatus, advanced_tono_generation, capture_generation_before,
        claim_owner_recovery_generation, generate_service_session_token, macos_install_shell,
        mark_service_unavailable_after_owner_loss, mark_verified_committed, owner_recovery_policy,
        service_core_path_for, session_matches_status,
    };
    #[cfg(unix)]
    use super::{service_core_path_for_with_publisher, service_tool_path_for};
    use crate::core::runstate::{FakeEnv, OwnerRecoveryReason, PendingAction, RunStateStore};
    use anyhow::bail;
    use tono_service_protocol::{
        KillSwitchStatus, KillSwitchStatusMode, OwnerSessionProof, ProxyEndpoint, ProxyProtocol,
    };
    #[cfg(unix)]
    use std::cell::Cell;
    use std::{
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    /// A Run State backed by a scripted environment, so these tests never touch the global.
    fn fake_store() -> RunStateStore<FakeEnv> {
        RunStateStore::new(FakeEnv::new())
    }

    #[test]
    #[allow(
        clippy::assertions_on_constants,
        reason = "this test pins the real-machine retry contract"
    )]
    fn mark_verified_reconciliation_is_bounded_and_requires_full_proof() {
        assert!(MARK_VERIFIED_ATTEMPTS >= 3);
        let mut status = KillSwitchStatus {
            wanted: true,
            verified: true,
            live: true,
            mode: KillSwitchStatusMode::Locked,
            endpoints: vec![ProxyEndpoint {
                ip: "203.0.113.7".to_string(),
                port: 443,
                protocol: ProxyProtocol::Tcp,
            }],
            tunnel_permit_rendered: true,
            direct_endpoint_digest: tono_service_protocol::direct_endpoint_digest(&[]).unwrap(),
            last_error: None,
        };
        assert!(mark_verified_committed(&status));

        status.verified = false;
        assert!(!mark_verified_committed(&status));
        status.verified = true;
        status.live = false;
        assert!(!mark_verified_committed(&status));
        status.live = true;
        status.mode = KillSwitchStatusMode::Blocked;
        assert!(!mark_verified_committed(&status));
        status.mode = KillSwitchStatusMode::Locked;
        status.tunnel_permit_rendered = false;
        assert!(!mark_verified_committed(&status));
    }

    #[test]
    fn lost_tono_start_is_adopted_only_after_a_proven_generation_advance() {
        assert_eq!(advanced_tono_generation(Some(None), Some(4)), Some(4));
        assert_eq!(advanced_tono_generation(Some(Some(4)), Some(5)), Some(5));
        assert_eq!(advanced_tono_generation(Some(Some(4)), Some(4)), None);
        assert_eq!(advanced_tono_generation(None, Some(5)), None);
        assert_eq!(advanced_tono_generation(Some(Some(4)), None), None);
    }

    /// The legacy single-slot view of a store, for assertions carried over from before the split.
    fn status_of(store: &RunStateStore<FakeEnv>) -> ServiceStatus {
        ServiceStatus::from_run_state(&store.state())
    }

    async fn status_of_settled(store: &RunStateStore<FakeEnv>) -> ServiceStatus {
        ServiceStatus::from_run_state(&store.settled().await)
    }

    static TEST_DIRECTORY_GENERATION: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> anyhow::Result<Self> {
            let generation = TEST_DIRECTORY_GENERATION.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "tono-service-{label}-{}-{generation}",
                std::process::id()
            ));
            std::fs::create_dir(&path)?;
            Ok(Self(path))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn staging_directory(home: &Path) -> PathBuf {
        home.join("Applications/.tono-dev/service-core")
    }

    #[cfg(unix)]
    fn service_tools_staging_directory(home: &Path) -> PathBuf {
        home.join("Applications/.tono-dev/service-tools")
    }

    #[cfg(unix)]
    fn staging_temporary_entries(home: &Path, core_name: &str) -> anyhow::Result<Vec<PathBuf>> {
        let directory = staging_directory(home);
        if !directory.exists() {
            return Ok(Vec::new());
        }
        Ok(std::fs::read_dir(directory)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&format!(".{core_name}.")) && name.ends_with(".tmp"))
            })
            .collect())
    }

    #[test]
    fn nondevelopment_service_core_selection_preserves_sibling_without_staging() -> anyhow::Result<()> {
        let root = TestDirectory::new("release-path")?;
        let home = root.path().join("home");
        let source = root.path().join("target/debug/tono-core");

        let selected = service_core_path_for(&source, Some(&home), false)?;

        assert_eq!(selected, source);
        assert!(!staging_directory(&home).exists());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn development_service_core_uses_exact_layout_and_executable_bytes() -> anyhow::Result<()> {
        use std::os::unix::fs::PermissionsExt as _;

        let root = TestDirectory::new("development-path")?;
        let home = root.path().join("home");
        let source = root.path().join("tono-core");
        std::fs::write(&source, b"development core")?;

        let selected = service_core_path_for(&source, Some(&home), true)?;

        assert_eq!(
            selected,
            home.join("Applications/.tono-dev/service-core/tono-core")
        );
        assert_eq!(std::fs::read(&selected)?, b"development core");
        let metadata = std::fs::symlink_metadata(&selected)?;
        assert!(metadata.file_type().is_file());
        assert_ne!(metadata.permissions().mode() & 0o111, 0);
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn development_service_tool_uses_safe_layout_and_executable_bytes() -> anyhow::Result<()> {
        use std::os::unix::fs::PermissionsExt as _;

        let root = TestDirectory::new("development-service-tool")?;
        let home = root.path().join("home");
        let source = root.path().join("tono-service-install");
        std::fs::write(&source, b"development installer")?;

        let selected = service_tool_path_for(&source, Some(&home), true)?;

        assert_eq!(
            selected,
            service_tools_staging_directory(&home).join("tono-service-install")
        );
        assert_eq!(std::fs::read(&selected)?, b"development installer");
        assert_ne!(std::fs::metadata(&selected)?.permissions().mode() & 0o111, 0);
        Ok(())
    }

    #[test]
    fn macos_install_shell_starts_from_root_without_nested_sudo() {
        let shell = macos_install_shell(Path::new("/safe/service-tools/tono-service-install"), 20);

        assert_eq!(
            shell,
            "cd /; TONO_SERVICE_GID=20 '/safe/service-tools/tono-service-install'"
        );
        assert!(!shell.contains("sudo"));
    }

    #[cfg(unix)]
    #[test]
    fn development_service_core_refresh_atomically_replaces_bytes() -> anyhow::Result<()> {
        let root = TestDirectory::new("refresh")?;
        let home = root.path().join("home");
        let source = root.path().join("tono-core");
        std::fs::write(&source, b"first core")?;
        let selected = service_core_path_for(&source, Some(&home), true)?;
        assert_eq!(
            selected,
            home.join("Applications/.tono-dev/service-core/tono-core")
        );

        std::fs::write(&source, b"second core")?;
        let refreshed = service_core_path_for(&source, Some(&home), true)?;

        assert_eq!(refreshed, selected);
        assert_eq!(std::fs::read(&refreshed)?, b"second core");
        assert!(staging_temporary_entries(&home, "tono-core")?.is_empty());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn failed_development_refresh_preserves_good_core_and_cleans_temporary_entry() -> anyhow::Result<()> {
        let root = TestDirectory::new("failed-refresh")?;
        let home = root.path().join("home");
        let source = root.path().join("tono-core");
        std::fs::write(&source, b"known good core")?;
        let selected = service_core_path_for(&source, Some(&home), true)?;

        std::fs::write(&source, b"replacement core")?;
        let publish_attempted = Cell::new(false);
        let result = service_core_path_for_with_publisher(
            &source,
            Some(&home),
            true,
            "service-core",
            |temporary, final_path| {
                publish_attempted.set(true);
                assert_ne!(temporary, final_path, "publisher must receive the temporary path");
                assert!(std::fs::symlink_metadata(temporary)?.file_type().is_file());
                assert_eq!(std::fs::read(temporary)?, b"replacement core");
                anyhow::bail!("injected post-creation publish failure")
            },
        );
        let error = match result {
            Ok(path) => anyhow::bail!("failed publication selected {}", path.display()),
            Err(error) => error.to_string(),
        };

        assert!(publish_attempted.get());
        assert!(error.contains("injected post-creation publish failure"));
        assert_eq!(std::fs::read(&selected)?, b"known good core");
        assert!(staging_temporary_entries(&home, "tono-core")?.is_empty());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn development_service_core_replaces_final_symlink_without_following_it() -> anyhow::Result<()> {
        use std::os::unix::fs::symlink;

        let root = TestDirectory::new("symlink")?;
        let home = root.path().join("home");
        let source = root.path().join("tono-core");
        std::fs::write(&source, b"selected core")?;
        let final_path = home.join("Applications/.tono-dev/service-core/tono-core");
        std::fs::create_dir_all(final_path.parent().unwrap_or_else(|| Path::new(".")))?;
        let symlink_target = root.path().join("must-not-change");
        std::fs::write(&symlink_target, b"target bytes")?;
        symlink(&symlink_target, &final_path)?;

        let selected = service_core_path_for(&source, Some(&home), true)?;

        assert_eq!(selected, final_path);
        assert!(std::fs::symlink_metadata(&selected)?.file_type().is_file());
        assert_eq!(std::fs::read(&selected)?, b"selected core");
        assert_eq!(std::fs::read(&symlink_target)?, b"target bytes");
        Ok(())
    }

    #[test]
    fn mismatched_active_generation_displaces_local_session() {
        let proof = OwnerSessionProof {
            generation: 7,
            token: "11".repeat(32),
        };
        assert!(session_matches_status(&proof, true, Some(7)));
        assert!(!session_matches_status(&proof, true, Some(8)));
        assert!(!session_matches_status(&proof, false, Some(7)));
    }

    #[test]
    fn a_stale_monitor_cannot_displace_a_newer_session() {
        // Sample classification now lives in `core::runstate::owner`; what stays here is the
        // guard that stops a monitor from a previous Core from tearing down the current one.
        let generation = AtomicU64::new(8);
        let newer_proof = OwnerSessionProof {
            generation: 8,
            token: "22".repeat(32),
        };
        let session = parking_lot::Mutex::new(Some(newer_proof.clone()));

        // A monitor started at generation 7 decides it has been displaced and tries to recover.
        if claim_owner_recovery_generation(&generation, 7).is_some() {
            session.lock().take();
        }

        assert_eq!(generation.load(Ordering::Acquire), 8, "the newer generation stands");
        assert_eq!(session.lock().as_ref(), Some(&newer_proof));
    }

    #[test]
    fn generated_service_session_token_is_lower_hex() -> anyhow::Result<()> {
        let token = generate_service_session_token()?;
        assert_eq!(token.len(), 64);
        assert!(
            token
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        );
        Ok(())
    }

    #[test]
    fn macos_recovery_never_resets_machine_wide_proxy() {
        for reason in [
            OwnerRecoveryReason::Displaced,
            OwnerRecoveryReason::SameOwnerFailure,
            OwnerRecoveryReason::TransportFailure,
        ] {
            assert!(!owner_recovery_policy(reason, true).reset_system_proxy);
            assert!(owner_recovery_policy(reason, false).reset_system_proxy);
        }

        let generation = AtomicU64::new(7);
        assert_eq!(claim_owner_recovery_generation(&generation, 7), Some(8));
        assert_eq!(generation.load(Ordering::Acquire), 8);
        assert_eq!(claim_owner_recovery_generation(&generation, 7), None);
    }

    #[test]
    fn cached_readiness_reflects_confirmed_state_without_mutating_it() {
        let store = fake_store();
        store.observe(ServiceHealth::Ready);
        let generation = store.generation_count();

        assert!(store.state().service_usable());
        assert_eq!(status_of(&store), ServiceStatus::Ready);
        assert_eq!(store.generation_count(), generation, "reading must not change state");

        store.observe(ServiceHealth::NotInstalled);
        assert!(!store.state().service_usable());
        assert_eq!(status_of(&store), ServiceStatus::NotInstalled);
        assert_eq!(store.generation_count(), generation + 1);
    }

    #[test]
    fn cached_readiness_is_false_while_a_service_operation_is_running() {
        let store = fake_store();
        store.observe(ServiceHealth::Ready);
        let _operation = store.begin_operation().expect("slot should be free");

        assert!(!store.state().service_usable());
        // The confirmed observation survives — only usability is withheld.
        assert_eq!(status_of(&store), ServiceStatus::Ready);
    }

    #[tokio::test]
    async fn service_operation_finishes_before_post_operation_refresh() {
        let store = fake_store();

        let result = super::run_operation_and_then(
            &store,
            async {
                store.observe(ServiceHealth::Ready);
                Ok(())
            },
            || async {
                assert!(!store.operation_in_flight());
                assert_eq!(status_of_settled(&store).await, ServiceStatus::Ready);
                Ok(())
            },
        )
        .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn owner_generation_is_captured_before_async_request_runs() {
        let generation = AtomicU64::new(7);
        let (captured, response) = capture_generation_before(&generation, || async {
            generation.store(8, Ordering::Release);
            "not-active"
        })
        .await;

        assert_eq!(captured, 7);
        assert_eq!(response, "not-active");
        assert_eq!(generation.load(Ordering::Acquire), 8);
    }

    #[test]
    fn only_transport_owner_loss_marks_cached_readiness_unavailable() {
        for reason in [OwnerRecoveryReason::Displaced, OwnerRecoveryReason::SameOwnerFailure] {
            let store = fake_store();
            store.observe(ServiceHealth::Ready);
            let generation = store.generation_count();

            mark_service_unavailable_after_owner_loss(&store, reason);

            assert!(store.state().service_usable(), "{reason:?} must not affect readiness");
            assert_eq!(status_of(&store), ServiceStatus::Ready);
            assert_eq!(store.generation_count(), generation);
        }

        let store = fake_store();
        store.observe(ServiceHealth::Ready);

        mark_service_unavailable_after_owner_loss(&store, OwnerRecoveryReason::TransportFailure);

        assert!(!store.state().service_usable());
        assert!(matches!(
            status_of(&store),
            ServiceStatus::Unavailable(reason) if reason.contains("service control IPC unavailable")
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn legacy_socket_alone_is_not_install_evidence() {
        assert!(
            !super::macos_service_install_markers()
                .iter()
                .any(|marker| marker == "/tmp/verge/clash-verge-service.sock")
        );
    }

    #[test]
    fn failed_install_status_can_be_replaced_with_sidecar_allowance() {
        let store = fake_store();
        store.request_action(super::PendingAction::Install);
        assert_eq!(status_of(&store), ServiceStatus::InstallRequired);
        let generation = store.generation_count();

        assert!(store.allow_sidecar_for_session().is_ok());

        assert_eq!(status_of(&store), ServiceStatus::SidecarAllowed);
        assert_eq!(store.generation_count(), generation + 1);
    }

    #[test]
    fn only_explicit_action_states_ask_for_a_privileged_operation() {
        for status in [
            ServiceStatus::Checking,
            ServiceStatus::Ready,
            ServiceStatus::NotInstalled,
            ServiceStatus::NeedsReinstall,
            ServiceStatus::SidecarAllowed,
            ServiceStatus::Unavailable("offline".into()),
        ] {
            let store = fake_store();
            super::record_status(&store, status.clone());
            assert_eq!(
                store.state().pending,
                None,
                "{status:?} is an observation, not a request"
            );
        }

        for (status, expected) in [
            (ServiceStatus::InstallRequired, PendingAction::Install),
            (ServiceStatus::UninstallRequired, PendingAction::Uninstall),
            (ServiceStatus::ReinstallRequired, PendingAction::Reinstall),
            (ServiceStatus::ForceReinstallRequired, PendingAction::ForceReinstall),
        ] {
            let store = fake_store();
            super::record_status(&store, status.clone());
            assert_eq!(store.state().pending, Some(expected), "{status:?}");
        }
    }

    #[tokio::test]
    async fn a_failed_uninstall_asks_the_machine_rather_than_condemning_the_service() {
        // A cancelled uninstall may leave the Service healthy; use the fresh probe result.
        let store = RunStateStore::new(
            FakeEnv::new()
                .service_ready()
                .privileged_operations_fail("no authorization"),
        );
        store.observe(ServiceHealth::Ready);

        let error = store
            .perform(PendingAction::Uninstall)
            .await
            .expect_err("an unauthorized uninstall should fail");

        assert!(error.to_string().contains("no authorization"));
        assert_eq!(status_of(&store), ServiceStatus::Ready);
        assert!(!store.state().service_needs_attention());
    }

    #[tokio::test]
    async fn a_failed_uninstall_still_reports_a_service_the_uninstaller_broke() {
        // A failed uninstaller can still leave the Service registered but unreachable.
        let store = RunStateStore::new(
            FakeEnv::new()
                .service_unreachable()
                .privileged_operations_fail("uninstaller exited with 1"),
        );
        store.observe(ServiceHealth::Ready);

        store
            .perform(PendingAction::Uninstall)
            .await
            .expect_err("a broken uninstall should fail");

        assert!(matches!(status_of(&store), ServiceStatus::Unavailable(_)));
        assert!(store.state().service_needs_attention());
    }

    #[tokio::test]
    async fn a_successful_uninstall_records_an_absent_service() {
        let store = fake_store();
        store.observe(ServiceHealth::Ready);

        store
            .perform(PendingAction::Uninstall)
            .await
            .expect("uninstall should succeed");

        assert_eq!(status_of(&store), ServiceStatus::NotInstalled);
        assert_eq!(store.env().privileged_actions(), vec![PendingAction::Uninstall]);
    }

    #[tokio::test]
    async fn a_cancelled_install_leaves_no_question_for_the_user() {
        // A cancelled action must retire its request or the attention dialog reopens.
        let store = RunStateStore::new(FakeEnv::new().privileged_operations_fail("User canceled. (-128)"));
        store.observe(ServiceHealth::NotInstalled);
        super::record_status(&store, ServiceStatus::InstallRequired);

        store
            .perform(PendingAction::Install)
            .await
            .expect_err("a cancelled install should fail");

        assert_eq!(status_of(&store), ServiceStatus::NotInstalled);
        assert!(
            !store.state().service_needs_attention(),
            "a service that is merely absent asks the user nothing"
        );
    }

    #[tokio::test]
    async fn a_failed_install_still_reports_a_service_that_really_is_broken() {
        // A fresh probe must preserve a real fault left by a failed installer.
        let store = RunStateStore::new(
            FakeEnv::new()
                .service_unreachable()
                .privileged_operations_fail("installer exited with 1"),
        );
        super::record_status(&store, ServiceStatus::ForceReinstallRequired);

        store
            .perform(PendingAction::ForceReinstall)
            .await
            .expect_err("a broken repair should fail");

        assert!(matches!(status_of(&store), ServiceStatus::Unavailable(_)));
        assert!(store.state().service_needs_attention());
    }

    /// Build a session where the user already accepted Sidecar for an unhealthy Service.
    fn store_settled_on_sidecar(env: FakeEnv) -> RunStateStore<FakeEnv> {
        let store = RunStateStore::new(env);
        store.observe(ServiceHealth::VersionMismatch);
        store.accept_sidecar();
        assert!(!store.state().service_needs_attention(), "the question was answered");
        store
    }

    #[tokio::test]
    async fn a_cancelled_action_gives_back_the_sidecar_the_session_had_settled_on() {
        // A failed action must restore the Sidecar decision displaced by its request.
        let store = store_settled_on_sidecar(
            FakeEnv::new()
                .service_version_mismatch()
                .privileged_operations_fail("User canceled. (-128)"),
        );
        // Recording the request returns the allowance it displaced.
        let was_allowed = store.request_action(PendingAction::Install);
        assert!(was_allowed, "the request displaced the session's answer");
        assert!(!store.state().sidecar_allowed);

        let outcome = super::run_action_restoring_sidecar(&store, was_allowed, async {
            store.perform(PendingAction::Install).await
        })
        .await;

        assert!(outcome.is_err(), "the failure is still reported to the caller");
        assert!(store.state().sidecar_allowed);
        assert!(!store.state().service_needs_attention());
    }

    #[tokio::test]
    async fn an_authorised_action_that_never_became_ready_also_gives_the_sidecar_back() {
        // Roll back the full workflow, including readiness failures after the action succeeds.
        let store = store_settled_on_sidecar(FakeEnv::new().service_version_mismatch());
        let was_allowed = store.request_action(PendingAction::Install);

        let outcome = super::run_action_restoring_sidecar(&store, was_allowed, async {
            store.perform(PendingAction::Install).await?;
            // Simulate `wait_for_service_ipc` recording health before it fails.
            store.observe(ServiceHealth::Unavailable("service never answered".to_owned()));
            bail!("service IPC did not become available")
        })
        .await;

        assert!(outcome.is_err());
        assert!(store.state().sidecar_allowed);
        assert!(!store.state().service_needs_attention());
    }

    #[tokio::test]
    async fn an_action_that_lands_keeps_the_session_on_the_service() {
        let store = RunStateStore::new(FakeEnv::new().service_ready());
        store.observe(ServiceHealth::NotInstalled);
        store.request_action(PendingAction::Install);

        super::run_action_restoring_sidecar(&store, true, async {
            store.perform(PendingAction::Install).await?;
            store.observe(ServiceHealth::Ready);
            Ok(())
        })
        .await
        .expect("the install landed");

        assert!(
            !store.state().sidecar_allowed,
            "no fallback is owed to a working Service"
        );
        assert_eq!(status_of(&store), ServiceStatus::Ready);
    }

    #[tokio::test]
    async fn a_session_that_never_chose_sidecar_is_not_given_one() {
        let store = RunStateStore::new(FakeEnv::new().service_version_mismatch());
        store.observe(ServiceHealth::VersionMismatch);

        super::run_action_restoring_sidecar(&store, false, async { bail!("refused") })
            .await
            .expect_err("the failure is reported");

        assert!(!store.state().sidecar_allowed);
        assert!(store.state().service_needs_attention());
    }

    #[test]
    fn a_service_that_came_back_ready_is_never_shadowed_by_a_restored_sidecar() {
        // The atomic ready check prevents Sidecar from shadowing a ready Service.
        let store = RunStateStore::new(FakeEnv::new().service_ready());
        store.observe(ServiceHealth::Ready);

        assert!(!store.restore_sidecar_allowance());
        assert!(!store.state().sidecar_allowed);
        assert_eq!(status_of(&store), ServiceStatus::Ready);
    }
}
