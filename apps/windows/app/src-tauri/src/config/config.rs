use super::{IRuntimeTemp, TonoPreferences};
use crate::{
    core::{handle::Handle, tray},
    process::AsyncHandler,
};
use anyhow::Result;
use tono_draft::Draft;
use tono_logging::{Type, logging, logging_error};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::OnceCell;

pub struct Config {
    runtime_config: Draft<IRuntimeTemp>,
    preferences: Draft<TonoPreferences>,
}

static TUN_SESSION_SUPPRESSED: AtomicBool = AtomicBool::new(false);

impl Config {
    pub async fn global() -> &'static Self {
        static CONFIG: OnceCell<Config> = OnceCell::const_new();
        CONFIG
            .get_or_init(|| async {
                Self {
                    runtime_config: Draft::new(IRuntimeTemp::new().await),
                    preferences: Draft::new(TonoPreferences::new().await),
                }
            })
            .await
    }

    pub async fn runtime() -> Draft<IRuntimeTemp> {
        Self::global().await.runtime_config.clone()
    }

    pub async fn preferences() -> Draft<TonoPreferences> {
        Self::global().await.preferences.clone()
    }

    pub async fn init_config_before_window() -> Result<()> {
        let prefs = Self::preferences().await.latest_arc();
        tono_i18n::sync_locale(prefs.language.as_deref());

        Ok(())
    }

    pub fn tun_suppressed_for_session() -> bool {
        TUN_SESSION_SUPPRESSED.load(Ordering::Acquire)
    }

    pub(crate) async fn restore_tun_for_session() {
        TUN_SESSION_SUPPRESSED.store(false, Ordering::Release);
        Handle::refresh_tono_preferences();
        let _ = tray::Tray::global().update_menu().await;
    }

    // 升级草稿为正式数据，并写入文件。避免用户行为丢失。
    // 仅在应用退出、重启、关机监听事件启用
    pub async fn apply_all_and_save_file() {
        logging!(info, Type::Config, "save all draft data");
        let save_clash_task = AsyncHandler::spawn(|| async {
            let clash = Self::clash().await;
            clash.apply();
            logging_error!(Type::Config, clash.data_arc().save_config().await);
        });

        let save_preferences_task = AsyncHandler::spawn(|| async {
            let prefs = Self::preferences().await;
            prefs.apply();
            logging_error!(Type::Config, prefs.data_arc().save_file().await);
        });

        let _ = tokio::join!(save_clash_task, save_preferences_task);
        logging!(info, Type::Config, "save all draft data finished");
    }
}
