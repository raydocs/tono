use super::{IClashTemp, IVerge};
use crate::{
    core::{handle::Handle, tray},
    process::AsyncHandler,
};
use anyhow::Result;
use clash_verge_draft::Draft;
use clash_verge_logging::{Type, logging, logging_error};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::OnceCell;

pub struct Config {
    clash_config: Draft<IClashTemp>,
    verge_config: Draft<IVerge>,
}

static TUN_SESSION_SUPPRESSED: AtomicBool = AtomicBool::new(false);

impl Config {
    pub async fn global() -> &'static Self {
        static CONFIG: OnceCell<Config> = OnceCell::const_new();
        CONFIG
            .get_or_init(|| async {
                Self {
                    clash_config: Draft::new(IClashTemp::new().await),
                    verge_config: Draft::new(IVerge::new().await),
                }
            })
            .await
    }

    pub async fn clash() -> Draft<IClashTemp> {
        Self::global().await.clash_config.clone()
    }

    pub async fn verge() -> Draft<IVerge> {
        Self::global().await.verge_config.clone()
    }

    pub async fn init_config_before_window() -> Result<()> {
        let verge = Self::verge().await.latest_arc();
        clash_verge_i18n::sync_locale(verge.language.as_deref());

        Ok(())
    }

    pub fn tun_suppressed_for_session() -> bool {
        TUN_SESSION_SUPPRESSED.load(Ordering::Acquire)
    }

    pub(crate) async fn restore_tun_for_session() {
        TUN_SESSION_SUPPRESSED.store(false, Ordering::Release);
        Handle::refresh_verge();
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

        let save_verge_task = AsyncHandler::spawn(|| async {
            let verge = Self::verge().await;
            verge.apply();
            logging_error!(Type::Config, verge.data_arc().save_file().await);
        });

        let _ = tokio::join!(save_clash_task, save_verge_task);
        logging!(info, Type::Config, "save all draft data finished");
    }
}
