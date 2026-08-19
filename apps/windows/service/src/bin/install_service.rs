#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn main() {
    panic!("This program is not intended to run on this platform.");
}

mod shared;

use anyhow::Error;
use anyhow::{Context as _, bail};
use sha2::{Digest as _, Sha256};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use shared::run_command;
#[cfg(windows)]
use shared::stop_windows_service;
#[cfg(all(target_os = "macos", not(feature = "development-channel")))]
use shared::uninstall_old_service;
use shared::{enter_repair_gate, run_maintenance_if_requested};
use std::fs::{File, OpenOptions};
use std::io::Read as _;
#[cfg(unix)]
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn bundled_service_binary() -> Result<PathBuf, Error> {
    let source = std::env::current_exe()?.with_file_name(if cfg!(windows) {
        "tono-service.exe"
    } else {
        "tono-service"
    });
    let metadata = std::fs::symlink_metadata(&source)
        .with_context(|| format!("failed to inspect bundled service binary {source:?}"))?;
    if !metadata.file_type().is_file() {
        bail!("bundled service binary is not an ordinary file: {source:?}");
    }
    Ok(source)
}

fn sha256(path: &Path) -> Result<[u8; 32], Error> {
    let mut file = File::open(path).with_context(|| format!("failed to open {path:?}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .with_context(|| format!("failed to read {path:?}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

fn remove_ordinary_file_if_exists(path: &Path) -> Result<(), Error> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {path:?}"));
        }
    };
    if !metadata.file_type().is_file() {
        bail!("refusing to replace non-file service entry {path:?}");
    }
    std::fs::remove_file(path).with_context(|| format!("failed to remove {path:?}"))
}

fn stage_service_binary(source: &Path, target: &Path) -> Result<PathBuf, Error> {
    let parent = target
        .parent()
        .context("protected service target has no parent")?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create protected service directory {parent:?}"))?;
    let staged = target.with_extension(if cfg!(windows) { "exe.next" } else { "next" });
    remove_ordinary_file_if_exists(&staged)?;

    let mut source_file = File::open(source)
        .with_context(|| format!("failed to open service candidate {source:?}"))?;
    let mut staged_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged)
        .with_context(|| format!("failed to create staged service binary {staged:?}"))?;
    std::io::copy(&mut source_file, &mut staged_file)
        .with_context(|| format!("failed to stage service binary at {staged:?}"))?;
    staged_file
        .sync_all()
        .with_context(|| format!("failed to sync staged service binary {staged:?}"))?;
    drop(staged_file);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o550))
            .with_context(|| format!("failed to secure staged service binary {staged:?}"))?;
    }

    if sha256(source)? != sha256(&staged)? {
        let _ = std::fs::remove_file(&staged);
        bail!("staged service binary hash does not match its bundled source");
    }
    Ok(staged)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
enum PublishOutcome {
    Published,
    RebootRequired,
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt as _;

    let mut value: Vec<u16> = path.as_os_str().encode_wide().collect();
    value.push(0);
    value
}

/// Publish one staged executable immediately, without ever adding it to the reboot rename queue.
///
/// The ordinary Service-only repair may defer its one binary below. A coordinated
/// Service + core + App update may not: deferring one member would leave an incompatible protocol
/// generation or violate the Service's compiled core digest pin. This primitive is therefore
/// shared by the transaction and by the immediate first half of the legacy publication path, while
/// only the latter is allowed to fall back to a reboot.
#[cfg(windows)]
fn publish_staged_binary_immediately(staged: &Path, target: &Path) -> std::io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let staged_wide = wide_path(staged);
    let target_wide = wide_path(target);
    let backoffs = [
        std::time::Duration::from_millis(200),
        std::time::Duration::from_millis(500),
        std::time::Duration::from_millis(1000),
    ];
    let mut last_error = None;
    for attempt in 0..=backoffs.len() {
        // SAFETY: both paths are NUL-terminated UTF-16 buffers alive for the call.
        let moved = unsafe {
            MoveFileExW(
                staged_wide.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved != 0 {
            return Ok(());
        }
        last_error = Some(std::io::Error::last_os_error());
        if let Some(backoff) = backoffs.get(attempt) {
            std::thread::sleep(*backoff);
        }
    }
    Err(last_error.unwrap_or_else(std::io::Error::last_os_error))
}

fn publish_staged_binary(staged: &Path, target: &Path) -> Result<PublishOutcome, Error> {
    match std::fs::symlink_metadata(target) {
        Ok(metadata) if !metadata.file_type().is_file() => {
            bail!("refusing to replace non-file service entry {target:?}");
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {target:?}"));
        }
    }

    #[cfg(unix)]
    {
        std::fs::rename(staged, target).with_context(|| {
            format!("failed to publish service binary {staged:?} at {target:?}")
        })?;
        Ok(PublishOutcome::Published)
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_DELAY_UNTIL_REBOOT, MOVEFILE_REPLACE_EXISTING, MoveFileExW,
        };

        if publish_staged_binary_immediately(staged, target).is_ok() {
            return Ok(PublishOutcome::Published);
        }
        // A just-stopped service (or an AV scanner) may still hold the old binary. The
        // Service-only path can safely defer its one replacement; coordinated runtime updates
        // call the immediate primitive directly and roll both binaries back instead.
        let staged_wide = wide_path(staged);
        let target_wide = wide_path(target);
        // SAFETY: as above; DELAY_UNTIL_REBOOT queues the replace with the session manager.
        let scheduled = unsafe {
            MoveFileExW(
                staged_wide.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_DELAY_UNTIL_REBOOT,
            )
        };
        if scheduled == 0 {
            return Err(std::io::Error::last_os_error()).with_context(|| {
                format!("failed to publish service binary {staged:?} at {target:?}")
            });
        }
        println!(
            "service binary is in use; the update to {target:?} was scheduled for the next reboot — restart the machine to finish installation"
        );
        Ok(PublishOutcome::RebootRequired)
    }
}

fn wait_for_service_ready() -> Result<(), Error> {
    const READY_TIMEOUT: Duration = Duration::from_secs(20);
    const READY_INTERVAL: Duration = Duration::from_millis(250);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create service readiness runtime")?;
    runtime.block_on(async {
        tono_service_protocol::set_config(Some(tono_service_protocol::IpcConfig {
            default_timeout: Duration::from_millis(250),
            max_retries: 1,
            retry_delay: Duration::from_millis(25),
        }))
        .await;

        let deadline = Instant::now() + READY_TIMEOUT;
        let result = loop {
            if let Ok(response) = tono_service_protocol::get_version().await
                && response.code == 0
                && response.data.is_some_and(|info| {
                    info.supports_client(
                        tono_service_protocol::ProtocolVersion::current(),
                        tono_service_protocol::MIN_REQUIRED_SERVICE_REVISION,
                    )
                })
            {
                break Ok(());
            }
            if Instant::now() >= deadline {
                break Err(anyhow::anyhow!(
                    "service IPC did not become protocol-ready within {READY_TIMEOUT:?}"
                ));
            }
            tokio::time::sleep(READY_INTERVAL).await;
        };

        tono_service_protocol::set_config(None).await;
        result
    })
}

/// Rollback only needs proof that the restored predecessor is the live IPC owner. Requiring it to
/// satisfy the *new* helper's protocol floor would misclassify a healthy older Service as failed
/// recovery during a cross-version upgrade. Commit readiness above remains deliberately strict.
#[cfg(windows)]
fn wait_for_previous_service_liveness() -> Result<(), Error> {
    const LIVE_TIMEOUT: Duration = Duration::from_secs(20);
    const LIVE_INTERVAL: Duration = Duration::from_millis(250);

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create previous Service liveness runtime")?;
    runtime.block_on(async {
        tono_service_protocol::set_config(Some(tono_service_protocol::IpcConfig {
            default_timeout: Duration::from_millis(250),
            max_retries: 1,
            retry_delay: Duration::from_millis(25),
        }))
        .await;

        let deadline = Instant::now() + LIVE_TIMEOUT;
        let result = loop {
            if let Ok(response) = tono_service_protocol::get_version().await
                && response.code == 0
                && response.data.is_some()
            {
                break Ok(());
            }
            if Instant::now() >= deadline {
                break Err(anyhow::anyhow!(
                    "previous Service IPC did not become live within {LIVE_TIMEOUT:?}"
                ));
            }
            tokio::time::sleep(LIVE_INTERVAL).await;
        };

        tono_service_protocol::set_config(None).await;
        result
    })
}

/// Bridge pre-fix disconnected installs across an in-place Service restart.
///
/// `stop_windows_service` has already waited for SCM `Stopped`; taking the owner lock here proves
/// no standalone/stale daemon can race the state classification. The library then leaves active
/// or damaged protection untouched, but writes a one-boot `wanted:false` tombstone when there is
/// no active owner and no wanted intent. That is the missing evidence the replacement needs to
/// clean orphaned persistent filters instead of emergency-blocking a disconnected machine.
#[cfg(windows)]
fn prepare_windows_replacement_state_held()
-> Result<tono_service_protocol::ServiceOwnerGuard, Error> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create Service replacement preparation runtime")?;
    runtime.block_on(async {
        let owner = tono_service_protocol::acquire_service_owner()
            .await?
            .context(
                "another Service daemon still owns the replacement state; refusing to race it",
            )?;
        let marked_disconnected =
            tono_service_protocol::prepare_for_service_replacement().await?;
        if marked_disconnected {
            println!(
                "Prepared disconnected Service replacement state; startup will clean orphaned WFP filters."
            );
        } else {
            println!(
                "Preserving active or ambiguous fail-closed protection across Service replacement."
            );
        }
        Ok(owner)
    })
}

#[cfg(windows)]
fn acquire_windows_replacement_owner() -> Result<tono_service_protocol::ServiceOwnerGuard, Error>
{
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create Service replacement owner runtime")?;
    runtime.block_on(async {
        tono_service_protocol::acquire_service_owner()
            .await?
            .context("another Service daemon still owns the replacement state")
    })
}

#[cfg(windows)]
fn prepare_windows_replacement_state() -> Result<(), Error> {
    drop(prepare_windows_replacement_state_held()?);
    Ok(())
}

// Only launchd code calls this, and the tests below exercise the plan classifier rather than the
// target string — so widening the gate to `test` only made it dead code everywhere but macOS.
#[cfg(target_os = "macos")]
fn launchd_service_target() -> String {
    format!("system/{}", tono_service_protocol::MACOS_SERVICE_ID)
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, PartialEq, Eq)]
enum LaunchdInstallPlan {
    SkipBootout,
    Bootout,
}

#[cfg(any(target_os = "macos", test))]
fn classify_launchd_service_probe(
    exit_code: Option<i32>,
    diagnostic: &str,
) -> Result<LaunchdInstallPlan, Error> {
    match exit_code {
        Some(0) => Ok(LaunchdInstallPlan::Bootout),
        Some(113) => Ok(LaunchdInstallPlan::SkipBootout),
        _ => Err(anyhow::anyhow!(
            "Unexpected launchctl service probe result (exit code: {:?}): {}",
            exit_code,
            diagnostic
        )),
    }
}

#[cfg(target_os = "macos")]
fn probe_launchd_service(debug: bool) -> Result<LaunchdInstallPlan, Error> {
    if debug {
        println!("Executing: launchctl print {}", launchd_service_target());
    }

    let output = std::process::Command::new("launchctl")
        .args(["print", &launchd_service_target()])
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to probe launchd service: {}", e))?;
    let diagnostic = format!(
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    classify_launchd_service_probe(output.status.code(), &diagnostic)
}

#[cfg(unix)]
fn env_u32(key: &str) -> Option<u32> {
    std::env::var(key).ok()?.parse().ok()
}

#[cfg(unix)]
fn resolve_service_group_name() -> Result<String, Error> {
    use nix::unistd::{Gid, Group, Uid, User};

    if let Some(gid) = env_u32("TONO_SERVICE_GID").or_else(|| env_u32("CLASH_VERGE_SERVICE_GID"))
        && let Ok(Some(group)) = Group::from_gid(Gid::from_raw(gid))
    {
        return Ok(group.name);
    }

    if let Some(uid) = env_u32("SUDO_UID").or_else(|| env_u32("PKEXEC_UID"))
        && let Ok(Some(user)) = User::from_uid(Uid::from_raw(uid))
        && let Ok(Some(group)) = Group::from_gid(user.gid)
    {
        return Ok(group.name);
    }

    if let Some(gid) = env_u32("SUDO_GID")
        && let Ok(Some(group)) = Group::from_gid(Gid::from_raw(gid))
    {
        return Ok(group.name);
    }

    bail!("unable to resolve the invoking user's service group; use sudo or pkexec")
}

#[cfg(target_os = "macos")]
fn installed_mihomo_gid(plist: &std::path::Path) -> Result<Option<u32>, Error> {
    let contents = match std::fs::read_to_string(plist) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    for key in ["TONO_CORE_GID", "CLASH_VERGE_MIHOMO_GID"] {
        let Some(after_key) = contents
            .split_once(&format!("<key>{key}</key>"))
            .map(|(_, tail)| tail)
        else {
            continue;
        };
        let Some(after_open) = after_key.split_once("<string>").map(|(_, tail)| tail) else {
            continue;
        };
        let Some(raw) = after_open.split_once("</string>").map(|(value, _)| value) else {
            continue;
        };
        if let Ok(gid) = raw.trim().parse() {
            return Ok(Some(gid));
        }
    }
    Ok(None)
}

#[cfg(target_os = "macos")]
fn select_mihomo_gid(plist: &std::path::Path) -> Result<u32, Error> {
    use nix::unistd::{Gid, Group};
    if let Some(raw) = installed_mihomo_gid(plist)?
        && (60_000..=64_999).contains(&raw)
        && Group::from_gid(Gid::from_raw(raw))?.is_none()
    {
        return Ok(raw);
    }
    for raw in 60_000..=64_999 {
        if Group::from_gid(Gid::from_raw(raw))?.is_none() {
            return Ok(raw);
        }
    }
    bail!("no unregistered dedicated Mihomo GID is available")
}

#[cfg(target_os = "macos")]
fn main() -> Result<(), Error> {
    if run_maintenance_if_requested()? {
        return Ok(());
    }
    let _gate = enter_repair_gate()?;
    let debug = std::env::args().any(|arg| arg == "--debug");
    let launchd_install_plan = probe_launchd_service(debug)?;
    let service_binary_path = bundled_service_binary()?;

    // 定义 bundle 路径
    let bundle_path = PathBuf::from("/Library/PrivilegedHelperTools").join(format!(
        "{}.bundle",
        tono_service_protocol::MACOS_SERVICE_ID
    ));
    let contents_path = bundle_path.join("Contents");
    let macos_path = contents_path.join("MacOS");

    // 创建 bundle 目录结构
    std::fs::create_dir_all(&macos_path)
        .map_err(|e| anyhow::anyhow!("Failed to create bundle directories: {}", e))?;

    // 复制二进制文件到 bundle 的 MacOS 目录
    let target_binary_path = macos_path.join("tono-service");
    let staged = stage_service_binary(&service_binary_path, &target_binary_path)?;

    // 创建并写入 Info.plist
    let info_plist_path = contents_path.join("Info.plist");

    // 创建 LaunchDaemons 目录（如果不存在）
    let plist_dir = PathBuf::from("/Library/LaunchDaemons");
    if !plist_dir.exists() {
        std::fs::create_dir(&plist_dir)
            .map_err(|e| anyhow::anyhow!("Failed to create plist directory: {}", e))?;
    }

    // 创建并写入 launchd plist
    let plist_file = plist_dir.join(format!(
        "{}.plist",
        tono_service_protocol::MACOS_SERVICE_ID
    ));

    let launchd_plist_content = format!(
        include_str!("../../resources/launchd.plist.tmpl"),
        group_name = resolve_service_group_name()?,
        mihomo_gid = select_mihomo_gid(&plist_file)?,
        service_id = tono_service_protocol::MACOS_SERVICE_ID,
        app_bundle_id = tono_service_protocol::MACOS_APP_BUNDLE_ID,
        service_binary = target_binary_path.to_string_lossy(),
    );
    let info_plist_content = format!(
        include_str!("../../resources/info.plist.tmpl"),
        display_name = tono_service_protocol::SERVICE_DISPLAY_NAME,
        service_id = tono_service_protocol::MACOS_SERVICE_ID,
    );
    let plist_path = plist_file.to_string_lossy().into_owned();
    let target_path = target_binary_path.to_string_lossy().into_owned();
    let bundle_path_string = bundle_path.to_string_lossy().into_owned();

    if launchd_install_plan == LaunchdInstallPlan::Bootout {
        run_command("launchctl", &["bootout", "system", &plist_path], debug)?;
    }
    let _ = publish_staged_binary(&staged, &target_binary_path)?;
    std::fs::write(&info_plist_path, info_plist_content)
        .with_context(|| format!("failed to write Info.plist {info_plist_path:?}"))?;
    File::create(&plist_file)
        .and_then(|mut file| file.write_all(launchd_plist_content.as_bytes()))
        .map_err(|e| anyhow::anyhow!("Failed to write plist file: {}", e))?;

    // 设置权限
    // 设置 LaunchDaemons plist 权限
    run_command("chmod", &["644", &plist_path], debug)?;
    run_command("chown", &["root:wheel", &plist_path], debug)?;

    // 设置二进制文件权限
    run_command("chmod", &["544", &target_path], debug)?;
    run_command("chown", &["root:wheel", &target_path], debug)?;

    // 设置 bundle 目录及其内容的权限
    run_command("chmod", &["755", &bundle_path_string], debug)?;
    run_command("chown", &["-R", "root:wheel", &bundle_path_string], debug)?;

    // 加载和启动服务
    let launchd_target = launchd_service_target();
    run_command("launchctl", &["enable", &launchd_target], debug)?;
    run_command("launchctl", &["bootstrap", "system", &plist_path], debug)?;
    run_command(
        "launchctl",
        &["start", tono_service_protocol::MACOS_SERVICE_ID],
        debug,
    )?;
    wait_for_service_ready()?;
    #[cfg(not(feature = "development-channel"))]
    let _ = uninstall_old_service();

    Ok(())
}

#[cfg(target_os = "linux")]
fn main() -> Result<(), Error> {
    if run_maintenance_if_requested()? {
        return Ok(());
    }
    let _gate = enter_repair_gate()?;
    let debug = std::env::args().any(|arg| arg == "--debug");
    let source = bundled_service_binary()?;
    let install_dir = tono_service_protocol::prepare_service_install_directory()?;
    let target = install_dir.join("tono-service");
    let staged = stage_service_binary(&source, &target)?;
    let unit_name = format!("{}.service", tono_service_protocol::SERVICE_SLUG);
    let unit_path = PathBuf::from("/etc/systemd/system").join(&unit_name);

    let _ = run_command("systemctl", &["stop", &unit_name], debug);
    let _ = publish_staged_binary(&staged, &target)?;

    let unit_file_content = format!(
        include_str!("../../resources/systemd_service_unit.tmpl"),
        exec_start = target.to_string_lossy(),
        group = resolve_service_group_name()?,
        runtime_directory = tono_service_protocol::SERVICE_SLUG,
    );

    let mut unit_file = File::create(&unit_path)
        .with_context(|| format!("failed to create systemd unit {unit_path:?}"))?;
    unit_file
        .write_all(unit_file_content.as_bytes())
        .with_context(|| format!("failed to write systemd unit {unit_path:?}"))?;
    unit_file
        .sync_all()
        .with_context(|| format!("failed to sync systemd unit {unit_path:?}"))?;

    run_command("systemctl", &["daemon-reload"], debug)?;
    run_command("systemctl", &["enable", &unit_name], debug)?;
    run_command("systemctl", &["start", &unit_name], debug)?;
    wait_for_service_ready()?;

    Ok(())
}

/// Best-effort rollback for an update that already stopped a previously active Service.
#[cfg(windows)]
struct RestartServiceOnFailure<'a> {
    service: &'a platform_lib::service::Service,
    armed: bool,
}

#[cfg(windows)]
impl<'a> RestartServiceOnFailure<'a> {
    fn new(service: &'a platform_lib::service::Service, armed: bool) -> Self {
        Self { service, armed }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

#[cfg(windows)]
impl Drop for RestartServiceOnFailure<'_> {
    fn drop(&mut self) {
        use platform_lib::service::ServiceState;

        if !self.armed
            || matches!(
                self.service
                    .query_status()
                    .map(|status| status.current_state),
                Ok(ServiceState::Running | ServiceState::StartPending)
            )
        {
            return;
        }

        eprintln!(
            "service update failed after stopping the existing service; attempting to restart it"
        );
        if let Err(error) = self.service.start(&Vec::<&std::ffi::OsStr>::new()) {
            eprintln!("failed to restart the existing service during rollback: {error}");
        }
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowsInstallMode {
    ServiceOnly,
    ReplaceRuntime,
}

#[cfg(windows)]
fn parse_windows_install_mode(
    arguments: impl IntoIterator<Item = std::ffi::OsString>,
) -> Result<WindowsInstallMode, Error> {
    let arguments: Vec<_> = arguments.into_iter().collect();
    match arguments.as_slice() {
        [] => Ok(WindowsInstallMode::ServiceOnly),
        [argument] if argument == "--replace-runtime" => Ok(WindowsInstallMode::ReplaceRuntime),
        // `run_maintenance_if_requested` handles this mode before any install work. Keep it in the
        // strict parser so adding argument validation cannot break the existing recovery command.
        [argument] if argument == "--cleanup-stale-owners" => Ok(WindowsInstallMode::ServiceOnly),
        _ => bail!(
            "unsupported Tono Service installer arguments; expected no arguments, \
             --replace-runtime, or --cleanup-stale-owners"
        ),
    }
}

#[cfg(windows)]
const RUNTIME_BINARY_NAME: &str = "tono-core.exe";
#[cfg(windows)]
const APP_BINARY_NAME: &str = "Tono.exe";
#[cfg(windows)]
const RUNTIME_STAGED_SUFFIX: &str = ".next";
#[cfg(windows)]
const ROLLBACK_SUFFIX: &str = ".rollback";
#[cfg(windows)]
const RESTORE_SUFFIX: &str = ".restore";
#[cfg(windows)]
const PUBLISH_SUFFIX: &str = ".publish";
#[cfg(windows)]
const COMPILED_IN_CORE_SHA256: Option<&str> = option_env!("TONO_CORE_SHA256");
#[cfg(windows)]
const CORE_DIGEST_PIN_FILE_NAME: &str = "core-sha256.txt";

/// Persist the Mihomo digest next to the Service so a later build that forgot
/// `TONO_CORE_SHA256` still has a pin file to fail-closed against.
///
/// The compile-time pin wins. If it is absent, the installer copies a valid
/// `core-sha256.txt` from the same resources directory as this helper. A
/// placeholder (the committed file before prebuild) is ignored.
#[cfg(windows)]
fn publish_core_digest_pin(install_dir: &Path) -> Result<(), Error> {
    let normalized = if let Some(pin) = COMPILED_IN_CORE_SHA256 {
        let Some(normalized) = normalize_core_digest_pin(pin) else {
            bail!("the compiled Mihomo SHA-256 pin is missing or malformed");
        };
        normalized
    } else {
        let bundled = std::env::current_exe()
            .ok()
            .and_then(|helper| helper.parent().map(|dir| dir.join(CORE_DIGEST_PIN_FILE_NAME)))
            .and_then(|path| std::fs::read_to_string(path).ok());
        let Some(normalized) = bundled.as_deref().and_then(normalize_core_digest_pin) else {
            return Ok(());
        };
        normalized
    };
    let path = install_dir.join(CORE_DIGEST_PIN_FILE_NAME);
    let tmp = path.with_extension("txt.tmp");
    let _ = std::fs::remove_file(&tmp);
    std::fs::write(&tmp, format!("{normalized}\n"))
        .with_context(|| format!("failed to write core digest pin {tmp:?}"))?;
    std::fs::rename(&tmp, &path)
        .with_context(|| format!("failed to publish core digest pin {path:?}"))?;
    Ok(())
}

#[cfg(windows)]
fn normalize_core_digest_pin(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    (normalized.len() == 64 && normalized.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then_some(normalized)
}

#[cfg(windows)]
fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

#[cfg(windows)]
fn path_component_eq(path: &Path, expected: &str) -> bool {
    path.file_name()
        .is_some_and(|value| value.to_string_lossy().eq_ignore_ascii_case(expected))
}

#[cfg(windows)]
fn windows_program_files_directory() -> Result<PathBuf, Error> {
    use std::os::windows::ffi::OsStringExt as _;
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath};

    let mut raw = std::ptr::null_mut();
    // SAFETY: `raw` is an out pointer initialized to null. A successful call returns a
    // CoTaskMem-allocated, NUL-terminated UTF-16 path, which is freed below.
    let result =
        unsafe { SHGetKnownFolderPath(&FOLDERID_ProgramFiles, 0, std::ptr::null_mut(), &mut raw) };
    if result < 0 || raw.is_null() {
        bail!("failed to resolve Windows Program Files known folder (HRESULT {result:#010x})");
    }
    let mut len = 0;
    // SAFETY: SHGetKnownFolderPath returned a valid NUL-terminated buffer.
    while unsafe { *raw.add(len) } != 0 {
        len += 1;
    }
    // SAFETY: the scan above found the terminator within the API-owned string.
    let value = std::ffi::OsString::from_wide(unsafe { std::slice::from_raw_parts(raw, len) });
    // SAFETY: the pointer came from SHGetKnownFolderPath and has not been freed yet.
    unsafe { CoTaskMemFree(raw.cast()) };
    Ok(PathBuf::from(value))
}

#[cfg(windows)]
fn normalized_windows_path(path: &Path) -> String {
    let mut value = path.to_string_lossy().replace('/', "\\");
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        value = format!(r"\\{rest}");
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        value = rest.to_owned();
    }
    value.trim_end_matches('\\').to_ascii_lowercase()
}

#[cfg(windows)]
fn ensure_ordinary_windows_entry(path: &Path, directory: bool) -> Result<(), Error> {
    use std::os::windows::fs::MetadataExt as _;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    let metadata = std::fs::symlink_metadata(path)
        .with_context(|| format!("failed to inspect update path {path:?}"))?;
    let expected_kind = if directory {
        metadata.file_type().is_dir()
    } else {
        metadata.file_type().is_file()
    };
    if !expected_kind || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!(
            "refusing runtime replacement through a non-ordinary {} {path:?}",
            if directory { "directory" } else { "file" }
        );
    }
    Ok(())
}

/// Pre-flight variant of [`ensure_update_scratch_absent`] for the three discovery points that
/// run before any SCM call or file mutation.
///
/// A recovery copy is worth refusing an upgrade over only while it holds bytes that exist
/// nowhere else. Once the file it shadows carries the same bytes — which is exactly the state a
/// converged rollback leaves behind, and the state `cleanup()` failing to run leaves behind —
/// the copy is a duplicate of what is already installed and it carries no recovery information.
/// Refusing on it anyway is what made a single post-publish rollback failure permanent: every
/// later `--replace-runtime` run aborts here, and the installer's own error text tells the user
/// to do the one thing the code refuses.
///
/// Adoption is deliberately narrow. An unreadable target, an unreadable scratch file, or any
/// digest mismatch all fall through to the strict refusal, so a copy that really is the last
/// surviving image of the old generation is still preserved.
#[cfg(windows)]
fn adopt_or_refuse_update_scratch(target: &Path, scratch: &Path) -> Result<(), Error> {
    if std::fs::symlink_metadata(scratch).is_err() {
        return ensure_update_scratch_absent(scratch);
    }
    let redundant = match (sha256(target), sha256(scratch)) {
        (Ok(target_digest), Ok(scratch_digest)) => target_digest == scratch_digest,
        _ => false,
    };
    if !redundant {
        return ensure_update_scratch_absent(scratch);
    }
    remove_ordinary_file_if_exists(scratch)
        .with_context(|| format!("failed to clear the redundant recovery copy {scratch:?}"))
}

#[cfg(windows)]
fn ensure_update_scratch_absent(path: &Path) -> Result<(), Error> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => bail!(
            "a previous runtime replacement left recovery file {path:?}; refusing to overwrite it"
        ),
        Err(error) => Err(error).with_context(|| format!("failed to inspect {path:?}")),
    }
}

#[cfg(windows)]
fn decode_sha256(value: &str) -> Result<[u8; 32], Error> {
    let value = value.trim();
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("the compiled Mihomo SHA-256 pin is missing or malformed");
    }
    let mut digest = [0_u8; 32];
    for (index, slot) in digest.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .context("failed to decode the compiled Mihomo SHA-256 pin")?;
    }
    Ok(digest)
}

#[cfg(windows)]
#[derive(Debug)]
struct InstalledBinaryCandidate {
    staged: PathBuf,
    target: PathBuf,
    expected_digest: [u8; 32],
}

#[cfg(windows)]
fn runtime_replacement_candidate(helper: &Path) -> Result<InstalledBinaryCandidate, Error> {
    ensure_ordinary_windows_entry(helper, false)?;
    if !path_component_eq(helper, "tono-service-install.exe") {
        bail!("runtime replacement must run from tono-service-install.exe");
    }
    let resources = helper
        .parent()
        .context("Service installer has no resources directory")?;
    if !path_component_eq(resources, "resources") {
        bail!("runtime replacement helper is not inside Tono's resources directory");
    }
    ensure_ordinary_windows_entry(resources, true)?;
    let app_root = resources
        .parent()
        .context("Service installer resources directory has no application root")?;
    if !path_component_eq(app_root, "Tono") {
        bail!("runtime replacement helper is not inside the Tono application directory");
    }
    ensure_ordinary_windows_entry(app_root, true)?;
    let expected_helper = windows_program_files_directory()?
        .join("Tono")
        .join("resources")
        .join("tono-service-install.exe");
    let canonical_helper = std::fs::canonicalize(helper)
        .with_context(|| format!("failed to canonicalize Service installer {helper:?}"))?;
    let canonical_expected = std::fs::canonicalize(&expected_helper).with_context(|| {
        format!("expected Program Files Service installer is missing: {expected_helper:?}")
    })?;
    if normalized_windows_path(&canonical_helper) != normalized_windows_path(&canonical_expected) {
        bail!(
            "runtime replacement helper must be exactly the installed Program Files binary at {expected_helper:?}"
        );
    }

    let target = app_root.join(RUNTIME_BINARY_NAME);
    let staged = path_with_suffix(&target, RUNTIME_STAGED_SUFFIX);
    ensure_ordinary_windows_entry(&target, false)?;
    ensure_ordinary_windows_entry(&staged, false)?;
    adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, ROLLBACK_SUFFIX))?;
    adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, RESTORE_SUFFIX))?;
    adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, PUBLISH_SUFFIX))?;

    let expected_digest = decode_sha256(COMPILED_IN_CORE_SHA256.context(
        "this Service installer has no compiled Mihomo SHA-256 pin; use the release build script",
    )?)?;
    if sha256(&staged)? != expected_digest {
        bail!("staged Mihomo does not match the digest pinned into this Service installer");
    }
    Ok(InstalledBinaryCandidate {
        staged,
        target,
        expected_digest,
    })
}

#[cfg(windows)]
fn app_replacement_candidate(
    runtime: &InstalledBinaryCandidate,
) -> Result<InstalledBinaryCandidate, Error> {
    let app_root = runtime
        .target
        .parent()
        .context("installed Mihomo target has no application root")?;
    ensure_ordinary_windows_entry(app_root, true)?;
    let target = app_root.join(APP_BINARY_NAME);
    let staged = path_with_suffix(&target, RUNTIME_STAGED_SUFFIX);
    ensure_ordinary_windows_entry(&target, false)?;
    ensure_ordinary_windows_entry(&staged, false)?;
    adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, ROLLBACK_SUFFIX))?;
    adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, RESTORE_SUFFIX))?;
    adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, PUBLISH_SUFFIX))?;

    // Unlike Mihomo, the GUI hash is not compiled into the Service helper. Measure the candidate
    // only after the fixed Program Files authority checks above; `prepare` measures it again and
    // rejects any change between validation and transaction construction.
    let expected_digest = sha256(&staged)?;
    Ok(InstalledBinaryCandidate {
        staged,
        target,
        expected_digest,
    })
}

#[cfg(windows)]
fn copy_ordinary_file_exclusive(source: &Path, destination: &Path) -> Result<(), Error> {
    ensure_ordinary_windows_entry(source, false)?;
    ensure_update_scratch_absent(destination)?;
    let mut source_file = File::open(source)
        .with_context(|| format!("failed to open transaction source {source:?}"))?;
    let mut destination_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .with_context(|| format!("failed to create transaction file {destination:?}"))?;
    if let Err(error) = std::io::copy(&mut source_file, &mut destination_file)
        .with_context(|| format!("failed to copy {source:?} to {destination:?}"))
        .and_then(|_| {
            destination_file
                .sync_all()
                .with_context(|| format!("failed to sync transaction file {destination:?}"))
        })
    {
        drop(destination_file);
        let _ = std::fs::remove_file(destination);
        return Err(error);
    }
    Ok(())
}

/// One member of the Service/core/App generation, including a byte-for-byte rollback copy.
///
/// Backups are copies rather than renames: until `publish` succeeds the live path remains exactly
/// where the old Service expects it. Rollback also copies its backup through a fresh restore file,
/// so failure restoring the second member never consumes the first member's only recovery copy.
#[cfg(windows)]
struct CoordinatedBinaryReplacement {
    staged: PathBuf,
    target: PathBuf,
    backup: PathBuf,
    restore: PathBuf,
    publish_scratch: PathBuf,
    old_digest: [u8; 32],
    new_digest: [u8; 32],
    changed: bool,
    published: bool,
}

#[cfg(windows)]
impl CoordinatedBinaryReplacement {
    fn prepare(staged: &Path, target: &Path, expected_new_digest: [u8; 32]) -> Result<Self, Error> {
        ensure_ordinary_windows_entry(staged, false)?;
        ensure_ordinary_windows_entry(target, false)?;
        let measured_new_digest = sha256(staged)?;
        if measured_new_digest != expected_new_digest {
            bail!("staged executable {staged:?} changed after it was validated");
        }
        let old_digest = sha256(target)?;
        let backup = path_with_suffix(target, ROLLBACK_SUFFIX);
        let restore = path_with_suffix(target, RESTORE_SUFFIX);
        let publish_scratch = path_with_suffix(target, PUBLISH_SUFFIX);
        ensure_update_scratch_absent(&backup)?;
        ensure_update_scratch_absent(&restore)?;
        ensure_update_scratch_absent(&publish_scratch)?;
        let changed = old_digest != measured_new_digest;
        if changed {
            copy_ordinary_file_exclusive(target, &backup)?;
            match sha256(&backup) {
                Ok(backup_digest) if backup_digest == old_digest => {}
                result => {
                    let _ = std::fs::remove_file(&backup);
                    match result {
                        Ok(_) => bail!(
                            "rollback copy for {target:?} does not match the installed executable"
                        ),
                        Err(error) => {
                            return Err(error).with_context(|| {
                                format!("failed to verify rollback copy for {target:?}")
                            });
                        }
                    }
                }
            }
        }
        Ok(Self {
            staged: staged.to_owned(),
            target: target.to_owned(),
            backup,
            restore,
            publish_scratch,
            old_digest,
            new_digest: measured_new_digest,
            changed,
            published: false,
        })
    }

    fn publish(&mut self) -> Result<(), Error> {
        if !self.changed {
            return Ok(());
        }
        // Keep `.next` as the complete new candidate until commit. If restoring the old pair
        // encounters an ordinary I/O failure, both members can still converge to the matched new
        // pair (stopped and non-AutoStart) rather than remaining mixed on disk.
        copy_ordinary_file_exclusive(&self.staged, &self.publish_scratch)?;
        publish_staged_binary_immediately(&self.publish_scratch, &self.target).with_context(
            || {
                format!(
                    "failed to publish coordinated executable {:?} at {:?}",
                    self.publish_scratch, self.target
                )
            },
        )?;
        // The rename has committed even if the verification below fails, so arm rollback first.
        self.published = true;
        ensure_ordinary_windows_entry(&self.target, false)?;
        if sha256(&self.target)? != self.new_digest {
            bail!(
                "published executable {:?} failed hash verification",
                self.target
            );
        }
        Ok(())
    }

    fn rollback(&mut self) -> Result<(), Error> {
        if self.is_old() {
            self.published = false;
            return Ok(());
        }
        if !self.changed {
            bail!(
                "executable {:?} no longer matches its unchanged old/new digest",
                self.target
            );
        }
        remove_ordinary_file_if_exists(&self.restore)?;
        copy_ordinary_file_exclusive(&self.backup, &self.restore)?;
        publish_staged_binary_immediately(&self.restore, &self.target).with_context(|| {
            format!("failed to restore previous executable at {:?}", self.target)
        })?;
        ensure_ordinary_windows_entry(&self.target, false)?;
        if sha256(&self.target)? != self.old_digest {
            bail!(
                "restored executable {:?} failed hash verification",
                self.target
            );
        }
        self.published = false;
        Ok(())
    }

    fn converge_new(&mut self) -> Result<(), Error> {
        if sha256(&self.target).ok() == Some(self.new_digest) {
            self.published = true;
            return Ok(());
        }
        remove_ordinary_file_if_exists(&self.publish_scratch)?;
        copy_ordinary_file_exclusive(&self.staged, &self.publish_scratch)?;
        publish_staged_binary_immediately(&self.publish_scratch, &self.target)
            .with_context(|| format!("failed to converge {:?} to new bytes", self.target))?;
        ensure_ordinary_windows_entry(&self.target, false)?;
        if sha256(&self.target)? != self.new_digest {
            bail!(
                "new executable {:?} failed convergence hash verification",
                self.target
            );
        }
        self.published = true;
        Ok(())
    }

    fn is_old(&self) -> bool {
        sha256(&self.target).ok() == Some(self.old_digest)
    }

    fn is_new(&self) -> bool {
        sha256(&self.target).ok() == Some(self.new_digest)
    }

    fn cleanup(&self) {
        for path in [
            &self.staged,
            &self.backup,
            &self.restore,
            &self.publish_scratch,
        ] {
            if let Err(error) = remove_ordinary_file_if_exists(path) {
                eprintln!("could not remove completed replacement artifact {path:?}: {error:#}");
            }
        }
    }

    fn discard_unpublished(&self) {
        if !self.published {
            self.cleanup();
        }
    }
}

#[cfg(windows)]
fn collected_failures(context: &str, failures: Vec<String>) -> Result<(), Error> {
    if failures.is_empty() {
        Ok(())
    } else {
        bail!("{context}: {}", failures.join("; "))
    }
}

#[cfg(windows)]
fn recover_unpublished_previous_service(
    service: &platform_lib::service::Service,
    was_active: bool,
    replacement_owner: &mut Option<tono_service_protocol::ServiceOwnerGuard>,
) -> Result<(), Error> {
    use std::ffi::OsStr;

    let mut failures = Vec::new();
    if let Err(error) = configure_windows_service_recovery(service) {
        failures.push(format!(
            "could not restore Service recovery actions: {error}"
        ));
    }
    // The Service cannot acquire its owner lock until the installer releases this proof that the
    // old daemon is gone. Always release it even when recovery-action repair failed, then still
    // attempt the restart instead of short-circuiting into a guaranteed outage.
    drop(replacement_owner.take());
    if was_active {
        match service.start(&Vec::<&OsStr>::new()) {
            Ok(()) => {
                if let Err(error) = wait_for_previous_service_liveness() {
                    failures.push(format!("previous Service did not become live: {error:#}"));
                }
            }
            Err(error) => failures.push(format!("could not restart previous Service: {error}")),
        }
    }
    collected_failures("failed to recover the unchanged previous Service", failures)
}

#[cfg(windows)]
fn set_windows_service_on_demand(
    service: &platform_lib::service::Service,
    service_info: &platform_lib::service::ServiceInfo,
) -> Result<(), Error> {
    let mut stopped_info = service_info.clone();
    stopped_info.start_type = platform_lib::service::ServiceStartType::OnDemand;
    service
        .change_config(&stopped_info)
        .context("failed to disable automatic start for an unrecovered executable pair")
}

#[cfg(windows)]
fn replace_existing_service_and_runtime(
    service: &platform_lib::service::Service,
    service_info: &platform_lib::service::ServiceInfo,
    service_staged: &Path,
    service_target: &Path,
    runtime_candidate: InstalledBinaryCandidate,
    app_candidate: InstalledBinaryCandidate,
) -> Result<(), Error> {
    use std::ffi::OsStr;

    let was_active = stop_windows_service(service)?;
    let mut restart_on_failure = RestartServiceOnFailure::new(service, was_active);
    let mut replacement_owner = None;
    let mut runtime_replacement = None;
    let mut service_replacement = None;
    let mut app_replacement = None;
    let preparation_result = (|| -> Result<(), Error> {
        replacement_owner = Some(prepare_windows_replacement_state_held()?);
        service.change_config(service_info)?;
        // The candidate Service is a trial until its IPC generation is proven. Keep SCM recovery
        // from relaunching a crashed candidate in the middle of rollback; the successful path
        // restores the production recovery policy immediately before publishing the GUI, and
        // every old-generation recovery path restores it before restarting the predecessor.
        suppress_windows_service_recovery(service)?;
        runtime_replacement = Some(CoordinatedBinaryReplacement::prepare(
            &runtime_candidate.staged,
            &runtime_candidate.target,
            runtime_candidate.expected_digest,
        )?);
        let service_digest = sha256(service_staged)?;
        service_replacement = Some(CoordinatedBinaryReplacement::prepare(
            service_staged,
            service_target,
            service_digest,
        )?);
        app_replacement = Some(CoordinatedBinaryReplacement::prepare(
            &app_candidate.staged,
            &app_candidate.target,
            app_candidate.expected_digest,
        )?);
        Ok(())
    })();

    if let Err(preparation_error) = preparation_result {
        for replacement in [
            service_replacement.as_ref(),
            runtime_replacement.as_ref(),
            app_replacement.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            replacement.discard_unpublished();
        }
        let _ = remove_ordinary_file_if_exists(service_staged);
        let _ = remove_ordinary_file_if_exists(&runtime_candidate.staged);
        let _ = remove_ordinary_file_if_exists(&app_candidate.staged);
        restart_on_failure.disarm();
        return match recover_unpublished_previous_service(
            service,
            was_active,
            &mut replacement_owner,
        ) {
            Ok(()) => Err(anyhow::anyhow!(
                "Service/runtime/App update preparation failed and the unchanged previous generation was restored: {preparation_error:#}"
            )),
            Err(recovery_error) => Err(anyhow::anyhow!(
                "Service/runtime/App update preparation failed ({preparation_error:#}); recovery of the unchanged previous generation also failed ({recovery_error:#})"
            )),
        };
    }

    let mut runtime_replacement = runtime_replacement
        .take()
        .context("runtime replacement preparation completed without a transaction")?;
    let mut service_replacement = service_replacement
        .take()
        .context("Service replacement preparation completed without a transaction")?;
    let mut app_replacement = app_replacement
        .take()
        .context("App replacement preparation completed without a transaction")?;

    // Once any executable can change, a blind `service.start()` is no longer a rollback: it could
    // launch a mixed Service/core generation or leave the GUI on an incompatible IPC revision.
    // Every later error therefore follows the explicit stop + restore-all + restart path below.
    restart_on_failure.disarm();
    let update_result = (|| -> Result<(), Error> {
        runtime_replacement.publish()?;
        service_replacement.publish()?;
        drop(replacement_owner.take());
        service.start(&Vec::<&OsStr>::new())?;
        wait_for_service_ready()?;
        configure_windows_service_recovery(service)?;
        // Keep the old GUI on disk while the candidate Service is starting and being verified.
        // Publishing it earlier creates a 20-second window in which a user can launch and lock the
        // new executable; a readiness failure would then be unable to restore the old App. The App
        // is the final failable commit step, after its matching Service/core pair is protocol-ready.
        app_replacement.publish()?;
        Ok(())
    })();

    match update_result {
        Ok(()) => {
            service_replacement.cleanup();
            runtime_replacement.cleanup();
            app_replacement.cleanup();
            println!("Service, Mihomo and App replacement committed after IPC readiness.");
            Ok(())
        }
        Err(update_error) => {
            eprintln!(
                "coordinated Service/Mihomo/App replacement failed; restoring the previous generation: {update_error:#}"
            );
            let rollback_result = (|| -> Result<(), Error> {
                if replacement_owner.is_none() {
                    // The replacement may already have restored the desired core before its IPC
                    // readiness check failed. Stop it first or Mihomo is locked again.
                    if let Err(stop_error) = stop_windows_service(service) {
                        let demand_error =
                            set_windows_service_on_demand(service, service_info).err();
                        let mut failures = vec![format!(
                            "failed to stop replacement Service before rollback: {stop_error:#}"
                        )];
                        if let Some(error) = demand_error {
                            failures
                                .push(format!("could not disable Service AutoStart: {error:#}"));
                        }
                        return collected_failures(
                            "rollback could not safely acquire the executable files",
                            failures,
                        );
                    }
                    match acquire_windows_replacement_owner() {
                        Ok(owner) => replacement_owner = Some(owner),
                        Err(owner_error) => {
                            let demand_error =
                                set_windows_service_on_demand(service, service_info).err();
                            let mut failures = vec![format!(
                                "failed to acquire stopped-Service owner lock for rollback: {owner_error:#}"
                            )];
                            if let Some(error) = demand_error {
                                failures.push(format!(
                                    "could not disable Service AutoStart: {error:#}"
                                ));
                            }
                            return collected_failures(
                                "rollback could not prove exclusive ownership of the executable files",
                                failures,
                            );
                        }
                    }
                }
                let mut old_restore_failures = Vec::new();
                for (name, replacement) in [
                    ("Service", &mut service_replacement),
                    ("Mihomo", &mut runtime_replacement),
                    ("App", &mut app_replacement),
                ] {
                    if let Err(first_error) = replacement.rollback() {
                        old_restore_failures
                            .push(format!("{name} old-byte restore failed: {first_error:#}"));
                        if let Err(retry_error) = replacement.rollback() {
                            old_restore_failures.push(format!(
                                "{name} old-byte restore retry failed: {retry_error:#}"
                            ));
                        }
                    }
                }
                if service_replacement.is_old()
                    && runtime_replacement.is_old()
                    && app_replacement.is_old()
                {
                    let recovery_result = recover_unpublished_previous_service(
                        service,
                        was_active,
                        &mut replacement_owner,
                    );
                    // `is_old()` is a SHA-256 proof that all three targets already carry the
                    // old bytes, so the recovery copies are redundant whatever happens next:
                    // a failure here is about SCM and IPC liveness, not about disk contents.
                    // Leaving the scratch behind would be worse than useless — every later
                    // `--replace-runtime` run calls `ensure_update_scratch_absent` before any
                    // other work and refuses, so the "run the same installer again" remedy
                    // this function's own error prints would be permanently unavailable.
                    service_replacement.cleanup();
                    runtime_replacement.cleanup();
                    app_replacement.cleanup();
                    return recovery_result;
                }

                // Old-byte restoration did not converge. Attempt every member even after one
                // error, using the retained `.next` candidates, so the disk is never knowingly
                // left with mixed protocol generations configured for automatic start.
                let mut new_convergence_failures = Vec::new();
                for (name, replacement) in [
                    ("Service", &mut service_replacement),
                    ("Mihomo", &mut runtime_replacement),
                    ("App", &mut app_replacement),
                ] {
                    if let Err(error) = replacement.converge_new() {
                        new_convergence_failures
                            .push(format!("{name} new-byte convergence failed: {error:#}"));
                    }
                }
                let matched_new_generation = service_replacement.is_new()
                    && runtime_replacement.is_new()
                    && app_replacement.is_new();
                let demand_result = set_windows_service_on_demand(service, service_info);
                drop(replacement_owner.take());

                let mut failures = old_restore_failures;
                failures.extend(new_convergence_failures);
                if let Err(error) = demand_result {
                    failures.push(format!("could not disable Service AutoStart: {error:#}"));
                }
                if matched_new_generation {
                    failures.push(
                        "old generation could not be restored; converged to the matched new Service/Mihomo/App generation and left it stopped/non-AutoStart with recovery copies preserved"
                            .to_owned(),
                    );
                } else {
                    failures.push(
                        "neither old nor new Service/Mihomo/App generation converged; Service was left stopped and recovery copies were preserved"
                            .to_owned(),
                    );
                }
                collected_failures(
                    "coordinated executable rollback did not restore the old generation",
                    failures,
                )
            })();

            match rollback_result {
                Ok(()) => Err(anyhow::anyhow!(
                    "Service/Mihomo/App replacement failed and the previous protected generation was restored: {update_error:#}"
                )),
                Err(rollback_error) => Err(anyhow::anyhow!(
                    "Service/Mihomo/App replacement failed ({update_error:#}); rollback also failed \
                     ({rollback_error:#}). Recovery copies were preserved and the Service was left \
                     fail-closed; reboot Windows, then run the same installer again. If it reports \
                     that a previous runtime replacement left a recovery file, those copies are the \
                     only surviving image of a generation that is no longer installed: uninstall \
                     Tono, which clears them, and install it again"
                )),
            }
        }
    }
}

/// install and start the service
#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use platform_lib::{
        Error as WindowsServiceError,
        service::{
            ServiceAccess, ServiceDependency, ServiceErrorControl, ServiceInfo, ServiceStartType,
            ServiceType,
        },
        service_manager::{ServiceManager, ServiceManagerAccess},
    };
    use std::ffi::{OsStr, OsString};

    let install_mode = parse_windows_install_mode(std::env::args_os().skip(1))?;
    if run_maintenance_if_requested()? {
        return Ok(());
    }
    let mut replacement_candidates = if install_mode == WindowsInstallMode::ReplaceRuntime {
        let runtime = runtime_replacement_candidate(&std::env::current_exe()?)?;
        let app = app_replacement_candidate(&runtime)?;
        Some((runtime, app))
    } else {
        None
    };
    // Validate the fixed Program Files authority boundary before touching the ProgramData repair
    // gate. A copied helper in a user-writable lookalike directory must fail without mutating
    // privileged installer state.
    let _gate = enter_repair_gate()?;
    let source = bundled_service_binary()?;
    let install_dir = tono_service_protocol::prepare_service_install_directory()?;
    publish_core_digest_pin(&install_dir)?;
    let target = install_dir.join("tono-service.exe");
    if install_mode == WindowsInstallMode::ReplaceRuntime {
        // Discover stale recovery state before stopping a healthy Service. The coordinated
        // transaction never overwrites evidence from a prior interrupted rollback.
        adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, ROLLBACK_SUFFIX))?;
        adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, RESTORE_SUFFIX))?;
        adopt_or_refuse_update_scratch(&target, &path_with_suffix(&target, PUBLISH_SUFFIX))?;
    }
    let staged = stage_service_binary(&source, &target)?;

    let manager_access = ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE;
    let service_manager = ServiceManager::local_computer(None::<&str>, manager_access)?;
    let start_type = if cfg!(feature = "development-channel") {
        ServiceStartType::OnDemand
    } else {
        ServiceStartType::AutoStart
    };
    let service_info = ServiceInfo {
        name: OsString::from(tono_service_protocol::WINDOWS_SERVICE_NAME),
        display_name: OsString::from(tono_service_protocol::SERVICE_DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type,
        error_control: ServiceErrorControl::Normal,
        executable_path: target.clone(),
        launch_arguments: vec![],
        // Start after the Base Filtering Engine so the service never races the filtering
        // engine at boot (docs/wfp-kill-switch.md §1).
        dependencies: vec![ServiceDependency::Service(OsString::from("BFE"))],
        account_name: None,
        account_password: None,
    };

    const ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;
    const ERROR_SERVICE_MARKED_FOR_DELETE: i32 = 1072;
    const ERROR_SERVICE_EXISTS: i32 = 1073;

    fn raw_error_code(error: &WindowsServiceError) -> Option<i32> {
        match error {
            WindowsServiceError::Winapi(error) => error.raw_os_error(),
            _ => None,
        }
    }

    let service_access = ServiceAccess::QUERY_STATUS
        | ServiceAccess::START
        | ServiceAccess::STOP
        | ServiceAccess::CHANGE_CONFIG;
    match service_manager.open_service(
        tono_service_protocol::WINDOWS_SERVICE_NAME,
        service_access,
    ) {
        Ok(service) => {
            if let Some((runtime_candidate, app_candidate)) = replacement_candidates.take() {
                return replace_existing_service_and_runtime(
                    &service,
                    &service_info,
                    &staged,
                    &target,
                    runtime_candidate,
                    app_candidate,
                );
            }
            let was_active = stop_windows_service(&service)?;

            // From this point onward every `?` must leave a previously active Service usable.
            // UAC succeeded, but publishing/configuring/starting the replacement can still fail;
            // without this rollback a repair attempt turns that failure into a permanent outage.
            let mut restart_on_failure = RestartServiceOnFailure::new(&service, was_active);
            prepare_windows_replacement_state()?;
            // Reconfigure before the binary swap, which is the first irreversible step: a record
            // a previous uninstall only marked for deletion still opens and still stops, but
            // every write to it fails with 1072. Discovering that after `publish_staged_binary`
            // would abort the install on top of a half-swapped binary.
            match service.change_config(&service_info) {
                Ok(()) => {
                    let publish_outcome = publish_staged_binary(&staged, &target)?;
                    configure_windows_service_recovery(&service)?;
                    service.start(&Vec::<&OsStr>::new())?;
                    // The service is running on either path here — the old binary when the swap
                    // was deferred — so readiness stays provable, and a build that dies on start
                    // must not pass as a successful "reboot pending" install.
                    wait_for_service_ready()?;
                    restart_on_failure.disarm();
                    if publish_outcome == PublishOutcome::RebootRequired {
                        println!(
                            "Service restarted with the existing binary; reboot is required to publish the replacement."
                        );
                        std::process::exit(3010);
                    }
                    return Ok(());
                }
                Err(error) if raw_error_code(&error) == Some(ERROR_SERVICE_MARKED_FOR_DELETE) => {
                    // Nothing irreversible has run yet. SCM unregisters a deleted record only
                    // once the last handle to it closes, so release ours — and the rollback that
                    // borrows it, since a marked record cannot be restarted — before waiting.
                    restart_on_failure.disarm();
                    drop(restart_on_failure);
                    drop(service);
                    println!(
                        "The existing service record is marked for deletion; waiting for Windows to unregister it."
                    );
                    if !wait_for_service_record_removal(&service_manager) {
                        bail!(
                            "the existing {} record is still marked for deletion because another program holds it open (services.msc, an MMC snap-in, or a monitoring agent); close it or reboot Windows, then run this installer again — nothing was modified",
                            tono_service_protocol::WINDOWS_SERVICE_NAME
                        );
                    }
                }
                Err(error) => return Err(error.into()),
            }
        }
        Err(error) if raw_error_code(&error) == Some(ERROR_SERVICE_DOES_NOT_EXIST) => {
            if install_mode == WindowsInstallMode::ReplaceRuntime {
                let _ = remove_ordinary_file_if_exists(&staged);
                // Nothing has been changed yet, and the fresh-install path below is written to
                // handle exactly this ("repair/update runs whose old SCM record is already
                // gone") — but reaching it would install a Service beside an unreplaced
                // Mihomo, whose compiled digest pin the Service could then never match. So
                // this still stops, and now says which route out of it works: every
                // `--replace-runtime` re-run lands right back here, so "run the installer
                // again" is not it.
                bail!(
                    "the installed Tono Service record is gone, so there is nothing to replace; \
                     Mihomo was not changed. Re-running this installer stops at the same place. \
                     Uninstall Tono from Settings > Apps (or Add/Remove Programs), then install \
                     it again — that path does not need the missing Service record."
                );
            }
        }
        Err(error) => return Err(error.into()),
    }

    // Fresh installs normally have no Service and no WFP provider. This also covers repair/update
    // runs whose old SCM record is already gone: a pre-fix disconnected build may still have
    // persistent filters, so give the replacement the same explicit-release evidence as above.
    prepare_windows_replacement_state()?;
    let publish_outcome = publish_staged_binary(&staged, &target)?;
    let service = match service_manager.create_service(&service_info, service_access) {
        Ok(service) => service,
        // TOCTOU mirror of the probe above: the record was (re)registered between the two calls,
        // by a concurrent installer or by whatever recreated the deletion we just waited out.
        // Adopting it reaches the same end state instead of aborting after the binary swap.
        Err(error) if raw_error_code(&error) == Some(ERROR_SERVICE_EXISTS) => {
            let service = service_manager.open_service(
                tono_service_protocol::WINDOWS_SERVICE_NAME,
                service_access,
            )?;
            stop_windows_service(&service)?;
            service.change_config(&service_info)?;
            service
        }
        Err(error) => return Err(error.into()),
    };

    service.set_description("Tono Service helps to launch the Tono core")?;
    configure_windows_service_recovery(&service)?;
    if publish_outcome == PublishOutcome::RebootRequired {
        // The binary only exists as a rename queued with the session manager, so there is
        // nothing to start and nothing to verify. Say that instead of implying a live service.
        println!(
            "Service was registered, but its binary is queued for the next reboot: it was not started and its readiness could not be verified. Restart the machine to finish installation."
        );
        std::process::exit(3010);
    }
    service.start(&Vec::<&OsStr>::new())?;
    wait_for_service_ready()?;

    Ok(())
}

/// Wait out an SCM record that a previous `DeleteService` only marked for deletion. The record
/// survives until the last handle to it closes, so a services.msc window, an MMC snap-in or a
/// monitoring agent can keep it — and the 1072 every write to it returns — alive long past the
/// uninstall that deleted it. Reports whether the record is gone.
#[cfg(windows)]
fn wait_for_service_record_removal(
    service_manager: &platform_lib::service_manager::ServiceManager,
) -> bool {
    use platform_lib::{Error as WindowsServiceError, service::ServiceAccess};

    const ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;
    const REMOVAL_ATTEMPTS: usize = 50;
    const REMOVAL_INTERVAL: Duration = Duration::from_millis(100);

    for _ in 0..REMOVAL_ATTEMPTS {
        match service_manager.open_service(
            tono_service_protocol::WINDOWS_SERVICE_NAME,
            ServiceAccess::QUERY_STATUS,
        ) {
            Ok(service) => drop(service),
            Err(WindowsServiceError::Winapi(error))
                if error.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST) =>
            {
                return true;
            }
            // Any other failure says nothing about the record itself, so keep polling rather
            // than guessing; the caller reports the timeout as the actionable condition.
            Err(_) => {}
        }
        std::thread::sleep(REMOVAL_INTERVAL);
    }
    false
}

#[cfg(windows)]
fn suppress_windows_service_recovery(
    service: &platform_lib::service::Service,
) -> platform_lib::Result<()> {
    use platform_lib::service::{
        ServiceAction, ServiceActionType, ServiceFailureActions, ServiceFailureResetPeriod,
    };

    service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::Never,
        reboot_msg: None,
        command: None,
        actions: Some(vec![
            ServiceAction {
                action_type: ServiceActionType::None,
                delay: Duration::ZERO,
            };
            3
        ]),
    })?;
    service.set_failure_actions_on_non_crash_failures(false)?;
    Ok(())
}

#[cfg(windows)]
fn configure_windows_service_recovery(
    service: &platform_lib::service::Service,
) -> platform_lib::Result<()> {
    use platform_lib::service::{
        ServiceAction, ServiceActionType, ServiceFailureActions, ServiceFailureResetPeriod,
    };
    use std::time::Duration;

    let actions = [5, 10, 30]
        .into_iter()
        .map(|delay_secs| ServiceAction {
            action_type: ServiceActionType::Restart,
            delay: Duration::from_secs(delay_secs),
        })
        .collect();

    service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(24 * 60 * 60)),
        reboot_msg: None,
        command: None,
        actions: Some(actions),
    })?;
    service.set_failure_actions_on_non_crash_failures(true)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_launchd_service_skips_bootout() {
        let plan = classify_launchd_service_probe(
            Some(113),
            "Could not find service \"com.raydocs.tono.service\" in domain for system",
        )
        .unwrap();

        assert_eq!(plan, LaunchdInstallPlan::SkipBootout);
    }

    #[test]
    fn loaded_launchd_service_runs_bootout() {
        let plan = classify_launchd_service_probe(Some(0), "").unwrap();

        assert_eq!(plan, LaunchdInstallPlan::Bootout);
    }

    #[test]
    fn unexpected_launchd_exit_is_an_error() {
        let result = classify_launchd_service_probe(Some(5), "Could not find service");

        assert!(result.is_err());
    }

    #[test]
    fn absent_exit_does_not_depend_on_launchd_wording() {
        let result = classify_launchd_service_probe(Some(113), "Operation not permitted");

        assert_eq!(result.unwrap(), LaunchdInstallPlan::SkipBootout);
    }

    #[cfg(windows)]
    #[test]
    fn windows_runtime_mode_accepts_only_fixed_non_path_arguments() {
        use std::ffi::OsString;

        assert_eq!(
            parse_windows_install_mode(Vec::<OsString>::new()).unwrap(),
            WindowsInstallMode::ServiceOnly
        );
        assert_eq!(
            parse_windows_install_mode([OsString::from("--replace-runtime")]).unwrap(),
            WindowsInstallMode::ReplaceRuntime
        );
        assert!(
            parse_windows_install_mode([OsString::from("--replace-runtime=C:\\elsewhere")])
                .is_err()
        );
        assert!(
            parse_windows_install_mode([
                OsString::from("--replace-runtime"),
                OsString::from("C:\\elsewhere"),
            ])
            .is_err()
        );
    }

    #[cfg(windows)]
    struct TransactionTestDirectory(PathBuf);

    #[cfg(windows)]
    impl TransactionTestDirectory {
        fn new(label: &str) -> Self {
            use std::time::{SystemTime, UNIX_EPOCH};

            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "tono-install-service-{label}-{}-{unique}",
                std::process::id()
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    #[cfg(windows)]
    impl Drop for TransactionTestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(windows)]
    #[test]
    fn coordinated_binary_round_trip_restores_old_bytes_without_consuming_backup() {
        let directory = TransactionTestDirectory::new("round-trip");
        let target = directory.0.join("tono-core.exe");
        let staged = path_with_suffix(&target, RUNTIME_STAGED_SUFFIX);
        std::fs::write(&target, b"old-core").unwrap();
        std::fs::write(&staged, b"new-core").unwrap();
        let expected = sha256(&staged).unwrap();

        let mut replacement =
            CoordinatedBinaryReplacement::prepare(&staged, &target, expected).unwrap();
        assert!(replacement.backup.is_file());
        replacement.publish().unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new-core");

        replacement.rollback().unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"old-core");
        assert!(
            replacement.backup.is_file(),
            "rollback must retain its source until both members are restored"
        );
        replacement.cleanup();
        assert!(!replacement.backup.exists());
        assert!(!replacement.restore.exists());
    }

    #[cfg(windows)]
    #[test]
    fn coordinated_generation_round_trip_includes_service_mihomo_and_app() {
        let directory = TransactionTestDirectory::new("three-member-round-trip");
        let members: [(&str, &[u8], &[u8]); 3] = [
            ("tono-service.exe", b"old-service", b"new-service"),
            ("tono-core.exe", b"old-core", b"new-core"),
            ("Tono.exe", b"old-app", b"new-app"),
        ];
        let mut replacements = Vec::new();

        for (name, old_bytes, new_bytes) in members {
            let target = directory.0.join(name);
            let staged = path_with_suffix(&target, RUNTIME_STAGED_SUFFIX);
            std::fs::write(&target, old_bytes).unwrap();
            std::fs::write(&staged, new_bytes).unwrap();
            replacements.push(
                CoordinatedBinaryReplacement::prepare(&staged, &target, sha256(&staged).unwrap())
                    .unwrap(),
            );
        }

        for replacement in &mut replacements {
            replacement.publish().unwrap();
            assert!(replacement.is_new());
        }
        for replacement in &mut replacements {
            replacement.rollback().unwrap();
            assert!(replacement.is_old());
            assert!(replacement.backup.is_file());
        }
        for replacement in replacements {
            replacement.cleanup();
            assert!(!replacement.staged.exists());
            assert!(!replacement.backup.exists());
            assert!(!replacement.restore.exists());
            assert!(!replacement.publish_scratch.exists());
        }
    }

    #[cfg(windows)]
    #[test]
    fn unchanged_binary_is_never_renamed_while_service_is_stopped() {
        let directory = TransactionTestDirectory::new("unchanged");
        let target = directory.0.join("tono-core.exe");
        let staged = path_with_suffix(&target, RUNTIME_STAGED_SUFFIX);
        std::fs::write(&target, b"same-core").unwrap();
        std::fs::write(&staged, b"same-core").unwrap();
        let expected = sha256(&staged).unwrap();

        let mut replacement =
            CoordinatedBinaryReplacement::prepare(&staged, &target, expected).unwrap();
        assert!(!replacement.changed);
        replacement.publish().unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"same-core");
        assert!(
            staged.is_file(),
            "an unchanged candidate must not be published"
        );
        replacement.cleanup();
        assert!(!staged.exists());
    }

    #[cfg(windows)]
    #[test]
    fn stale_rollback_evidence_is_never_overwritten() {
        let directory = TransactionTestDirectory::new("stale-backup");
        let target = directory.0.join("tono-core.exe");
        let staged = path_with_suffix(&target, RUNTIME_STAGED_SUFFIX);
        let backup = path_with_suffix(&target, ROLLBACK_SUFFIX);
        std::fs::write(&target, b"old-core").unwrap();
        std::fs::write(&staged, b"new-core").unwrap();
        std::fs::write(&backup, b"recovery-evidence").unwrap();
        let expected = sha256(&staged).unwrap();

        let error = CoordinatedBinaryReplacement::prepare(&staged, &target, expected)
            .err()
            .expect("stale backup must block publication");
        assert!(format!("{error:#}").contains("previous runtime replacement"));
        assert_eq!(std::fs::read(&backup).unwrap(), b"recovery-evidence");
    }
}
