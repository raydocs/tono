use super::CmdResult;
use crate::{
    cmd::{StringifyErr as _, blocking},
    feat,
    utils::dirs,
};
use std::ffi::OsString;

/// Hand a path or URL to the system handler without waiting for the handler to finish.
///
/// `open::that` waits for the launcher to exit, and on Windows that launcher is
/// `powershell.exe -NoProfile ... Start-Process` (falling back to `explorer.exe`). PowerShell
/// cold start is routinely 0.5–3 s and far worse while AV scans the image load, so waiting for
/// it froze the window on every external link. `that_detached` returns once the process exists;
/// the hop off-thread covers the process creation itself, which a sync command would otherwise
/// perform on the Tauri main thread.
async fn open_detached(target: OsString) -> CmdResult<()> {
    blocking(move || open::that_detached(target).stringify_err()).await
}

/// 打开应用程序所在目录
#[tauri::command]
pub async fn open_app_dir() -> CmdResult<()> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    open_detached(app_dir.into_os_string()).await
}

/// 打开核心所在目录
#[tauri::command]
pub async fn open_core_dir() -> CmdResult<()> {
    let core_dir = tauri::utils::platform::current_exe().stringify_err()?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    open_detached(core_dir.as_os_str().to_owned()).await
}

/// Open Windows Network & internet so Encrypted DNS can be turned off.
#[tauri::command]
pub async fn open_windows_dns_settings() -> CmdResult<()> {
    #[cfg(windows)]
    {
        open_detached(OsString::from("ms-settings:network-and-internet")).await
    }
    #[cfg(not(windows))]
    {
        Err("Windows DNS settings are only available on Windows".into())
    }
}

/// 打开日志目录
#[tauri::command]
pub async fn open_logs_dir() -> CmdResult<()> {
    let log_dir = dirs::app_logs_dir().stringify_err()?;
    open_detached(log_dir.into_os_string()).await
}

/// 重启应用
#[tauri::command]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app().await;
    Ok(())
}

#[tauri::command]
pub async fn restart_for_update() -> CmdResult<()> {
    feat::restart_for_update().await;
    Ok(())
}
