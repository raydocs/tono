#![cfg(feature = "client")]

use anyhow::Context as _;
#[cfg(feature = "test")]
use clash_verge_service_ipc::test_owner_credentials;
use clash_verge_service_ipc::{
    IpcConfig, MIN_REQUIRED_SERVICE_REVISION, OwnerSessionProof, ProtocolVersion, RuntimeBundle,
    StartClashRequest, get_clash_logs, get_kill_switch_status, get_protected_dns_status,
    get_status, get_version, set_config, start_clash, stop_clash,
};
#[cfg(not(feature = "test"))]
use clash_verge_service_ipc::{OWNER_TOKEN_FILE_NAME, OwnerCredentials, OwnerIdentity};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tokio::time::sleep;

const IPC_READY_TIMEOUT: Duration = Duration::from_secs(20);
const IPC_PROBE_INTERVAL: Duration = Duration::from_millis(250);
const QA_PROTOCOL_VERSION: u32 = 1;

fn usage() {
    eprintln!(
        "usage: tono-service-integration-driver <qa-build-info|probe|ready|ping|diagnose|logs|watch-logs|start|stop>"
    );
}

fn qa_build_info() -> anyhow::Result<()> {
    let credential_source = if cfg!(feature = "test") {
        "synthetic-test"
    } else if cfg!(windows) {
        "installed-token-file"
    } else {
        "unsupported-platform"
    };
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "qa_protocol_version": QA_PROTOCOL_VERSION,
            "credential_source": credential_source,
        }))?
    );
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        usage();
        std::process::exit(1);
    }

    match args[1].as_str() {
        "qa-build-info" => qa_build_info()?,
        "probe" => probe_protocol().await?,
        "ready" => wait_protocol_ready().await?,
        "ping" => wait_ipc_ready().await?,
        "diagnose" => diagnose_flow().await?,
        "logs" => logs_flow().await?,
        "watch-logs" => watch_logs_flow().await?,
        "start" => start_flow().await?,
        "stop" => stop_flow().await?,
        _ => {
            usage();
            std::process::exit(1);
        }
    }

    Ok(())
}

/// Print the bounded in-memory core log maintained by the Service. This stays behind the same
/// owner authentication as every other diagnostic request and avoids weakening the protected
/// ProgramData ACL merely to debug a failed real-machine connect.
async fn logs_flow() -> anyhow::Result<()> {
    wait_protocol_ready().await?;
    let response = get_clash_logs(&owner_credentials()?).await?;
    if response.code != 0 {
        anyhow::bail!(
            "service rejected core log request: {} ({})",
            response.message,
            response.code
        );
    }
    for line in response.data.unwrap_or_default() {
        println!("{line}");
    }
    Ok(())
}

/// Wait for the next real owner session and capture its in-memory core log before rollback makes
/// the authenticated session unavailable. This is intentionally a test-driver primitive: a
/// sub-second startup failure otherwise disappears before a human can issue a second command.
async fn watch_logs_flow() -> anyhow::Result<()> {
    wait_protocol_ready().await?;
    let credentials = owner_credentials()?;
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut active_seen = false;
    let mut last_len = 0;

    while Instant::now() < deadline {
        match get_clash_logs(&credentials).await {
            Ok(response) if response.code == 0 => {
                active_seen = true;
                let logs = response.data.unwrap_or_default();
                if logs.len() < last_len {
                    last_len = 0;
                }
                for line in logs.iter().skip(last_len) {
                    println!("{line}");
                }
                last_len = logs.len();
            }
            _ if active_seen => return Ok(()),
            _ => {}
        }
        sleep(Duration::from_millis(25)).await;
    }

    if active_seen {
        Ok(())
    } else {
        anyhow::bail!("no active owner session appeared within 20 seconds")
    }
}

/// Print the live service state needed for Windows triage without exposing endpoint addresses or
/// owner/session secrets. This is intentionally read-only: it issues only protocol/status GETs.
async fn diagnose_flow() -> anyhow::Result<()> {
    wait_protocol_ready().await?;
    let credentials = owner_credentials()?;
    let version = get_version().await?;
    let service = get_status(&credentials).await?;
    let dns = get_protected_dns_status(&credentials).await?;
    let kill_switch = get_kill_switch_status(&credentials).await?;

    let service_data = service.data.as_ref().map(|status| {
        serde_json::json!({
            "snapshot_generation": status.snapshot_generation,
            "active_operation": status.active_operation,
            "is_active": status.is_active,
            "active_generation": status.active_generation,
            "service_state": status.service_state,
            "core_pid": status.core_pid,
            "core_started_at": status.core_started_at,
            "last_core_exit_reason": status.last_core_exit_reason,
            "restart_count": status.restart_count,
            "last_recovery_at": status.last_recovery_at,
            "desired_core_should_be_running": status.desired_core_should_be_running,
            "desired_generation": status.desired_generation,
            "desired_updated_at": status.desired_updated_at,
            "desired_state_unknown": status.desired_state_unknown,
            "network_events": status.network_events,
        })
    });
    let kill_switch_data = kill_switch.data.as_ref().map(|status| {
        serde_json::json!({
            "wanted": status.wanted,
            "verified": status.verified,
            "live": status.live,
            "mode": status.mode,
            "tunnel_permit_rendered": status.tunnel_permit_rendered,
            "endpoint_count": status.endpoints.len(),
            "last_error": status.last_error,
        })
    });

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "version": {
                "code": version.code,
                "message": version.message,
                "data": version.data,
            },
            "service": {
                "code": service.code,
                "message": service.message,
                "data": service_data,
            },
            "dns": {
                "code": dns.code,
                "message": dns.message,
                "data": dns.data,
            },
            "kill_switch": {
                "code": kill_switch.code,
                "message": kill_switch.message,
                "data": kill_switch_data,
            },
        }))?
    );
    Ok(())
}

async fn probe_protocol() -> anyhow::Result<()> {
    set_config(Some(IpcConfig {
        default_timeout: Duration::from_millis(250),
        max_retries: 1,
        retry_delay: Duration::from_millis(25),
    }))
    .await;
    let result = async {
        let response = get_version().await?;
        let info = response
            .data
            .ok_or_else(|| anyhow::anyhow!("service omitted protocol information"))?;
        if response.code != 0
            || !info.supports_client(ProtocolVersion::current(), MIN_REQUIRED_SERVICE_REVISION)
        {
            anyhow::bail!("service protocol is not compatible");
        }
        Ok(())
    }
    .await;
    set_config(None).await;
    result
}

async fn wait_protocol_ready() -> anyhow::Result<()> {
    set_config(Some(IpcConfig {
        default_timeout: Duration::from_millis(250),
        max_retries: 1,
        retry_delay: Duration::from_millis(25),
    }))
    .await;

    let result: anyhow::Result<()> = async {
        let deadline = Instant::now() + IPC_READY_TIMEOUT;
        let mut last_error = None;
        while Instant::now() < deadline {
            match probe_protocol().await {
                Ok(()) => return Ok(()),
                Err(error) => last_error = Some(error),
            }
            sleep(IPC_PROBE_INTERVAL).await;
        }
        if let Some(error) = last_error {
            anyhow::bail!(
                "service protocol did not become ready within {IPC_READY_TIMEOUT:?}; last failure: {error:#}"
            );
        }
        anyhow::bail!("service protocol did not become ready within {IPC_READY_TIMEOUT:?}");
    }
    .await;

    set_config(None).await;
    result
}

async fn start_flow() -> anyhow::Result<()> {
    wait_ipc_ready().await?;
    let config = RuntimeBundle {
        yaml: "mode: rule\n".to_string(),
        assets: vec![],
        remote_providers: Vec::new(),
        core_path: mock_binary_path()?,
    };
    let response = start_clash(
        &owner_credentials()?,
        &StartClashRequest {
            runtime: config,
            proposed_session_token: session_token()?,
            macos_proxy: None,
            kill_switch: None,
            windows_kill_switch: None,
        },
    )
    .await?;
    if response.code != 0 {
        anyhow::bail!(
            "service rejected Start: {} ({})",
            response.message,
            response.code
        );
    }
    let generation = response
        .data
        .ok_or_else(|| anyhow::anyhow!("service Start response omitted session"))?
        .session
        .generation;
    println!("{generation}");
    Ok(())
}

async fn stop_flow() -> anyhow::Result<()> {
    let response = stop_clash(&owner_credentials()?, &session_proof()?).await?;
    if response.code != 0 {
        anyhow::bail!(
            "service rejected Stop: {} ({})",
            response.message,
            response.code
        );
    }
    Ok(())
}

fn session_token() -> anyhow::Result<String> {
    std::env::var("CLASH_VERGE_TEST_SESSION_TOKEN")
        .context("CLASH_VERGE_TEST_SESSION_TOKEN is required")
}

fn session_proof() -> anyhow::Result<OwnerSessionProof> {
    let generation = std::env::var("CLASH_VERGE_TEST_SESSION_GENERATION")
        .context("CLASH_VERGE_TEST_SESSION_GENERATION is required")?;
    Ok(OwnerSessionProof {
        generation: generation
            .parse()
            .context("CLASH_VERGE_TEST_SESSION_GENERATION must be an unsigned integer")?,
        token: session_token()?,
    })
}

async fn wait_ipc_ready() -> anyhow::Result<()> {
    set_config(Some(IpcConfig {
        default_timeout: Duration::from_millis(250),
        max_retries: 1,
        retry_delay: Duration::from_millis(25),
    }))
    .await;

    let result: anyhow::Result<()> = async {
        let deadline = Instant::now() + IPC_READY_TIMEOUT;
        while Instant::now() < deadline {
            if let Ok(response) = get_status(&owner_credentials()?).await
                && response.code == 0
                && response.data.is_some()
            {
                return Ok(());
            }
            sleep(IPC_PROBE_INTERVAL).await;
        }
        anyhow::bail!("IPC server not reachable within {:?}", IPC_READY_TIMEOUT)
    }
    .await;

    set_config(None).await;
    result
}

#[cfg(feature = "test")]
fn owner_credentials() -> anyhow::Result<clash_verge_service_ipc::OwnerCredentials> {
    test_owner_credentials(&std::env::current_dir()?)
}

#[cfg(not(feature = "test"))]
fn owner_credentials() -> anyhow::Result<OwnerCredentials> {
    #[cfg(unix)]
    {
        let app_data_dir = std::env::current_dir()?;
        return Ok(OwnerCredentials {
            identity: OwnerIdentity::Unix {
                uid: unsafe { platform_lib::geteuid() },
                gid: unsafe { platform_lib::getegid() },
            },
            app_data_dir: app_data_dir.to_string_lossy().into_owned(),
            token: std::env::var("CLASH_VERGE_TEST_OWNER_TOKEN").ok(),
        });
    }
    #[cfg(windows)]
    {
        windows_owner_credentials()
    }
}

#[cfg(all(not(feature = "test"), windows))]
fn open_owner_token_relative(root: &std::fs::File) -> anyhow::Result<std::fs::File> {
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _};
    use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
    use windows_sys::Wdk::Storage::FileSystem::{
        FILE_NON_DIRECTORY_FILE, FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT, NtOpenFile,
    };
    use windows_sys::Win32::Foundation::{
        INVALID_HANDLE_VALUE, OBJ_CASE_INSENSITIVE, UNICODE_STRING,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_GENERIC_READ, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

    if OWNER_TOKEN_FILE_NAME.contains(['/', '\\']) || OWNER_TOKEN_FILE_NAME.contains('\0') {
        anyhow::bail!("owner token leaf name is invalid");
    }
    let mut leaf: Vec<u16> = std::ffi::OsStr::new(OWNER_TOKEN_FILE_NAME)
        .encode_wide()
        .collect();
    let byte_len = leaf
        .len()
        .checked_mul(std::mem::size_of::<u16>())
        .and_then(|length| u16::try_from(length).ok())
        .ok_or_else(|| anyhow::anyhow!("owner token leaf name is invalid"))?;
    if leaf.is_empty() || leaf.contains(&0) {
        anyhow::bail!("owner token leaf name is invalid");
    }
    let name = UNICODE_STRING {
        Length: byte_len,
        MaximumLength: byte_len,
        Buffer: leaf.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: std::mem::size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: root.as_raw_handle(),
        ObjectName: &name,
        Attributes: OBJ_CASE_INSENSITIVE,
        ..Default::default()
    };
    let mut handle = INVALID_HANDLE_VALUE;
    let mut io_status = IO_STATUS_BLOCK::default();
    let status = unsafe {
        NtOpenFile(
            &mut handle,
            FILE_GENERIC_READ,
            &attributes,
            &mut io_status,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN_REPARSE_POINT | FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT,
        )
    };
    if status < 0 || handle.is_null() || handle == INVALID_HANDLE_VALUE {
        anyhow::bail!("owner token file could not be opened");
    }
    Ok(unsafe { std::fs::File::from_raw_handle(handle) })
}

#[cfg(all(not(feature = "test"), windows))]
fn windows_owner_credentials() -> anyhow::Result<OwnerCredentials> {
    use std::io::Read as _;
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _};
    use std::path::{Component, Path, Prefix};
    use windows_sys::Win32::Foundation::{GENERIC_READ, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_DISK,
        GetFileInformationByHandle, GetFileType, GetFinalPathNameByHandleW, OPEN_EXISTING,
        VOLUME_NAME_DOS,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }
    fn open(path: &Path, directory: bool, access: u32) -> anyhow::Result<std::fs::File> {
        let handle = unsafe {
            CreateFileW(
                wide(path).as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT
                    | if directory {
                        FILE_FLAG_BACKUP_SEMANTICS
                    } else {
                        FILE_ATTRIBUTE_NORMAL
                    },
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            anyhow::bail!("owner credential path could not be opened");
        }
        Ok(unsafe { std::fs::File::from_raw_handle(handle) })
    }
    fn info(file: &std::fs::File, directory: bool) -> anyhow::Result<BY_HANDLE_FILE_INFORMATION> {
        let mut value = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut value) } == 0 {
            anyhow::bail!("owner credential metadata is unavailable");
        }
        if unsafe { GetFileType(file.as_raw_handle()) } != FILE_TYPE_DISK
            || value.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (value.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
        {
            anyhow::bail!("owner credential path has an invalid file type");
        }
        Ok(value)
    }
    fn final_path(file: &std::fs::File) -> anyhow::Result<std::path::PathBuf> {
        let needed = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                std::ptr::null_mut(),
                0,
                VOLUME_NAME_DOS,
            )
        };
        if needed == 0 {
            anyhow::bail!("owner credential final path is unavailable");
        }
        let mut buffer = vec![0u16; needed as usize + 1];
        let written = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                VOLUME_NAME_DOS,
            )
        };
        if written == 0 || written as usize >= buffer.len() {
            anyhow::bail!("owner credential final path is unavailable");
        }
        buffer.truncate(written as usize);
        Ok(std::path::PathBuf::from(
            String::from_utf16(&buffer)
                .map_err(|_| anyhow::anyhow!("owner credential final path is invalid"))?,
        ))
    }
    fn local_disk(path: &Path) -> bool {
        path.is_absolute()
            && matches!(path.components().next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
    }
    let supplied = std::env::var_os("CLASH_VERGE_TEST_OWNER_APP_DATA_DIR")
        .ok_or_else(|| anyhow::anyhow!("CLASH_VERGE_TEST_OWNER_APP_DATA_DIR is required"))?;
    let supplied = Path::new(&supplied);
    if !local_disk(supplied) {
        anyhow::bail!("owner app-data root must be an absolute local drive path");
    }
    let root_handle = open(supplied, true, GENERIC_READ)?;
    info(&root_handle, true)?;
    let root = final_path(&root_handle)?;
    if !local_disk(&root) {
        anyhow::bail!("owner app-data root must resolve to a local drive path");
    }
    let mut token_handle = open_owner_token_relative(&root_handle)?;
    let token_info = info(&token_handle, false)?;
    if token_info.nFileSizeHigh != 0 || token_info.nFileSizeLow != 32 {
        anyhow::bail!("owner token file must be exactly 32 bytes");
    }
    let mut bytes = [0u8; 32];
    token_handle
        .read_exact(&mut bytes)
        .context("could not read owner token file")?;
    let token = bytes.iter().map(|byte| format!("{byte:02x}")).collect();

    Ok(OwnerCredentials {
        identity: OwnerIdentity::Windows {
            sid: std::env::var("CLASH_VERGE_TEST_OWNER_SID")
                .context("CLASH_VERGE_TEST_OWNER_SID is required")?,
        },
        app_data_dir: root.to_string_lossy().into_owned(),
        token: Some(token),
    })
}

fn mock_binary_path() -> anyhow::Result<String> {
    let current_exe = std::env::current_exe()?;
    let mut path = current_exe;
    path.pop();
    #[cfg(windows)]
    path.push("mock_binary.exe");
    #[cfg(not(windows))]
    path.push("mock_binary");
    if path.exists() {
        return Ok(path.to_string_lossy().to_string());
    }

    let status = Command::new("cargo")
        .args(["build", "--features", "test"])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()?;
    if !status.success() {
        anyhow::bail!("failed to build mock_binary");
    }
    if path.exists() {
        return Ok(path.to_string_lossy().to_string());
    }
    anyhow::bail!("mock_binary not found after build");
}

#[cfg(all(test, not(feature = "test"), windows))]
mod windows_owner_tests {
    use super::*;
    use serial_test::serial;
    use std::io::Read as _;
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::FromRawHandle as _;
    use std::path::{Path, PathBuf};

    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "tono-driver-owner-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        path
    }

    fn invoke(root: &Path) -> anyhow::Result<OwnerCredentials> {
        unsafe {
            std::env::set_var("CLASH_VERGE_TEST_OWNER_APP_DATA_DIR", root);
            std::env::set_var("CLASH_VERGE_TEST_OWNER_SID", "S-1-5-21-123");
            std::env::set_var("CLASH_VERGE_TEST_OWNER_TOKEN", "must-be-ignored");
        }
        windows_owner_credentials()
    }

    fn retain_root(root: &Path) -> std::fs::File {
        use windows_sys::Win32::Foundation::{GENERIC_READ, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::Storage::FileSystem::{
            CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        };

        let wide: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                std::ptr::null_mut(),
            )
        };
        assert_ne!(handle, INVALID_HANDLE_VALUE);
        unsafe { std::fs::File::from_raw_handle(handle) }
    }

    #[test]
    #[serial]
    fn reads_exact_token_without_mutating_it_or_using_inherited_token() {
        let root = root();
        let token_path = root.join(OWNER_TOKEN_FILE_NAME);
        let bytes = [0xa5; 32];
        std::fs::write(&token_path, bytes).unwrap();
        let credentials = invoke(&root).unwrap();
        let expected = "a5".repeat(32);
        assert_eq!(credentials.token.as_deref(), Some(expected.as_str()));
        assert_eq!(std::fs::read(&token_path).unwrap(), bytes);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[serial]
    fn retained_root_handle_cannot_be_redirected_to_replacement_path() {
        let parent = root();
        let root_a = parent.join("A");
        let root_b = parent.join("B");
        std::fs::create_dir(&root_a).unwrap();
        let original = [0x11; 32];
        let replacement = [0x22; 32];
        std::fs::write(root_a.join(OWNER_TOKEN_FILE_NAME), original).unwrap();
        let retained = retain_root(&root_a);

        match std::fs::rename(&root_a, &root_b) {
            Ok(()) => {
                std::fs::create_dir(&root_a).unwrap();
                std::fs::write(root_a.join(OWNER_TOKEN_FILE_NAME), replacement).unwrap();
                let mut token = open_owner_token_relative(&retained).unwrap();
                let mut bytes = [0; 32];
                token.read_exact(&mut bytes).unwrap();
                assert_eq!(bytes, original);
                assert_ne!(bytes, replacement);
                drop(token);
                drop(retained);
                std::fs::remove_dir_all(parent).unwrap();
            }
            Err(error) => {
                assert!(
                    root_a.is_dir(),
                    "rename failed but original root disappeared: {error}"
                );
                drop(retained);
                std::fs::remove_dir_all(parent).unwrap();
                eprintln!("SAFE: retained root handle blocked rename: {error}");
            }
        }
    }

    #[test]
    #[serial]
    fn rejects_missing_wrong_sized_and_directory_tokens_without_secret_errors() {
        let root = root();
        for size in [31, 33] {
            std::fs::write(root.join(OWNER_TOKEN_FILE_NAME), vec![0x7b; size]).unwrap();
            let error = format!("{:#}", invoke(&root).unwrap_err());
            assert!(!error.contains(&"7b".repeat(8)));
        }
        std::fs::remove_file(root.join(OWNER_TOKEN_FILE_NAME)).unwrap();
        assert!(invoke(&root).is_err());
        std::fs::create_dir(root.join(OWNER_TOKEN_FILE_NAME)).unwrap();
        assert!(invoke(&root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[serial]
    fn rejects_relative_unc_device_and_nonexistent_roots() {
        for path in [
            PathBuf::from("relative"),
            PathBuf::from(r"\\server\share"),
            PathBuf::from(r"\\.\C:\temp"),
            PathBuf::from(r"C:\this-path-must-not-exist-tono-qa"),
        ] {
            assert!(invoke(&path).is_err(), "accepted {}", path.display());
        }
    }

    #[test]
    #[serial]
    fn rejects_token_reparse_point_when_symlinks_are_available() {
        use std::os::windows::fs::symlink_file;
        let root = root();
        let target = root.join("target");
        std::fs::write(&target, [1; 32]).unwrap();
        let link = root.join(OWNER_TOKEN_FILE_NAME);
        if symlink_file(&target, &link).is_ok() {
            assert!(invoke(&root).is_err());
        } else {
            eprintln!("SKIP: token symlink creation privilege is unavailable");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[serial]
    fn rejects_root_reparse_point_when_symlinks_are_available() {
        use std::os::windows::fs::symlink_dir;
        let parent = root();
        let target = parent.join("target-root");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join(OWNER_TOKEN_FILE_NAME), [2; 32]).unwrap();
        let link = parent.join("linked-root");
        if symlink_dir(&target, &link).is_ok() {
            assert!(invoke(&link).is_err());
        } else {
            eprintln!("SKIP: root symlink creation privilege is unavailable");
        }
        std::fs::remove_dir_all(parent).unwrap();
    }
}
