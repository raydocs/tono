use super::*;
use anyhow::{Context as _, Result, bail};
use std::path::{Path, PathBuf};
use std::borrow::Cow;
use std::process::Command as StdCommand;
use tono_logging::{Type, logging};

#[cfg(target_os = "macos")]
pub(super) fn path_entry_exists_without_follow(path: &Path) -> std::io::Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
pub(super) fn macos_service_install_markers() -> Vec<String> {
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
pub(super) fn macos_service_install_marker_exists() -> std::io::Result<bool> {
    for marker in macos_service_install_markers() {
        if path_entry_exists_without_follow(Path::new(&marker))? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// What the App can learn about its own prerequisites without elevation.
///
/// Both queries are read-only and open with QUERY_STATUS only, which authenticated users hold on
/// these services, so this runs at startup without an admin prompt. It exists because the state
/// it reports was previously unknowable from inside the product: a customer whose BFE had been
/// switched off saw only "protected, not connected", every diagnostic field reading unknown, and
/// no way to tell that TonoService had never started.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePrerequisites {
    /// `false` also when the service is not registered at all.
    pub service_running: bool,
    pub service_registered: bool,
    pub bfe_running: bool,
}

#[cfg(windows)]
pub(crate) fn service_prerequisites() -> ServicePrerequisites {
    use windows_service::service::{ServiceAccess, ServiceState};
    use windows_service::service_manager::{ServiceManager as WinManager, ServiceManagerAccess};

    let mut report = ServicePrerequisites {
        service_running: false,
        service_registered: false,
        bfe_running: false,
    };
    let Ok(manager) = WinManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT) else {
        return report;
    };
    let running = |name: &str| -> Option<bool> {
        let service = manager.open_service(name, ServiceAccess::QUERY_STATUS).ok()?;
        let status = service.query_status().ok()?;
        Some(status.current_state == ServiceState::Running)
    };
    if let Some(state) = running(tono_service_protocol::WINDOWS_SERVICE_NAME) {
        report.service_registered = true;
        report.service_running = state;
    }
    report.bfe_running = running("BFE").unwrap_or(false);
    report
}

#[cfg(not(windows))]
pub(crate) fn service_prerequisites() -> ServicePrerequisites {
    ServicePrerequisites {
        service_running: true,
        service_registered: true,
        bfe_running: true,
    }
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
pub(super) static SERVICE_CORE_STAGING_GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg(any(all(target_os = "macos", feature = "verge-dev"), test))]
pub(super) fn create_service_core_staging_file(directory: &Path, core_name: &std::ffi::OsStr) -> Result<(PathBuf, std::fs::File)> {
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
pub(super) fn service_core_path_for(source: &Path, home: Option<&Path>, stage_for_macos_dev: bool) -> Result<PathBuf> {
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
pub(super) fn service_tool_path_for(source: &Path, home: Option<&Path>, stage_for_macos_dev: bool) -> Result<PathBuf> {
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
pub(super) fn service_core_path_for_with_publisher<F>(
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
pub(super) fn macos_service_tool_path(source: &Path) -> Result<PathBuf> {
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

pub(super) fn service_core_path(clash_core: &str, bin_ext: &str) -> Result<PathBuf> {
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
pub(super) fn macos_force_stop_core_shell() -> String {
    use crate::config::TonoPreferences;

    // 只清理 root 拥有的服务内核。
    let mut parts: Vec<String> = TonoPreferences::VALID_CLASH_CORES
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
pub(super) fn escape_osascript_double_quoted_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(any(target_os = "macos", test))]
pub(super) fn macos_install_shell(install_path: &Path, gid: u32) -> String {
    let install_quoted = shell_single_quote(&install_path.to_string_lossy());
    format!("cd /; TONO_SERVICE_GID={gid} {install_quoted}")
}

pub(super) fn packaged_service_tool_path(file_name: &str, packaged_path: impl FnOnce() -> Result<PathBuf>) -> Result<PathBuf> {
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
pub(super) fn uninstall_service() -> Result<()> {
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
pub(super) fn install_service() -> Result<()> {
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
pub(super) fn uninstall_service() -> Result<()> {
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
pub(super) fn install_service() -> Result<()> {
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
pub(super) fn linux_running_as_root() -> bool {
    use crate::core::handle;
    use tauri_plugin_tono_sysinfo::is_current_app_handle_admin;
    let app_handle = handle::Handle::app_handle();
    is_current_app_handle_admin(app_handle)
}

#[cfg(target_os = "macos")]
pub(super) fn uninstall_service() -> Result<()> {
    logging!(info, Type::Service, "uninstall service");

    let uninstall_path = packaged_service_tool_path("tono-service-uninstall", || {
        Ok(dirs::service_path()?.with_file_name("tono-service-uninstall"))
    })?;

    if !uninstall_path.exists() {
        bail!(format!("uninstaller not found: {uninstall_path:?}"));
    }

    let uninstall_path = macos_service_tool_path(&uninstall_path)?;
    let uninstall_shell: String = uninstall_path.to_string_lossy().into_owned();

    // tono_i18n::sync_locale(Config::preferences().await.latest_arc().language.as_deref());

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
pub(super) fn install_service() -> Result<()> {
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

    // tono_i18n::sync_locale(Config::preferences().await.latest_arc().language.as_deref());

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

pub(super) fn check_output_error(output: &std::process::Output) -> Option<(i32, Cow<'_, str>)> {
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

pub(super) fn reinstall_service() -> Result<()> {
    logging!(info, Type::Service, "reinstall service");
    install_service()
}

/// 强制重装服务（UI修复按钮）
pub(super) fn force_reinstall_service() -> Result<()> {
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
