#[cfg(target_os = "windows")]
use crate::utils::schtasks;
use crate::{config::Config, core::handle::Handle};
use anyhow::Result;
#[cfg(not(target_os = "windows"))]
use tono_logging::logging_error;
use tono_logging::{Type, logging};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_autostart::ManagerExt as _;
#[cfg(target_os = "windows")]
use tauri_plugin_tono_sysinfo::is_current_app_handle_admin;

pub async fn update_launch() -> Result<()> {
    let enable_auto_launch = { Config::verge().await.latest_arc().enable_auto_launch };
    let is_enable = enable_auto_launch.unwrap_or(false);
    logging!(info, Type::System, "Setting auto-launch enabled state to: {is_enable}");

    #[cfg(target_os = "windows")]
    {
        let is_admin = is_current_app_handle_admin(Handle::app_handle());
        schtasks::set_auto_launch(is_enable, is_admin).await?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let app_handle = Handle::app_handle();
        let autostart_manager = app_handle.autolaunch();
        if is_enable {
            logging_error!(Type::System, "{:?}", autostart_manager.enable());
        } else {
            logging_error!(Type::System, "{:?}", autostart_manager.disable());
        }
    }

    Ok(())
}

/// First successful connect turns launch-at-startup on unless the user already
/// chose in Settings. Later connects do nothing.
pub async fn enable_on_first_connect() {
    let verge = Config::verge().await;
    if verge.latest_arc().auto_launch_seeded.unwrap_or(false) {
        return;
    }
    verge.edit_draft(|draft| {
        draft.enable_auto_launch = Some(true);
        draft.auto_launch_seeded = Some(true);
    });
    if let Err(error) = update_launch().await {
        verge.discard();
        logging!(
            warn,
            Type::System,
            "first-connect autostart task skipped: {error}"
        );
        return;
    }
    verge.apply();
    if let Err(error) = verge.data_arc().save_file().await {
        logging!(
            warn,
            Type::System,
            "first-connect autostart persist skipped: {error}"
        );
        return;
    }
    Handle::refresh_verge();
    logging!(
        info,
        Type::System,
        "enabled launch-at-startup after first connect"
    );
}

pub fn get_launch_status() -> Result<bool> {
    #[cfg(target_os = "windows")]
    {
        let enabled = schtasks::is_auto_launch_enabled();
        if let Ok(status) = enabled {
            logging!(info, Type::System, "Auto-launch status (scheduled task): {status}");
        }
        enabled
    }

    #[cfg(not(target_os = "windows"))]
    {
        let app_handle = Handle::app_handle();
        let autostart_manager = app_handle.autolaunch();
        match autostart_manager.is_enabled() {
            Ok(status) => {
                logging!(info, Type::System, "Auto-launch status: {status}");
                Ok(status)
            }
            Err(e) => {
                logging!(error, Type::System, "Failed to get auto-launch status: {e}");
                Err(anyhow::anyhow!("Failed to get auto-launch status: {}", e))
            }
        }
    }
}
