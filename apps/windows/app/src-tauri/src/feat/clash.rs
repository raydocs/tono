use crate::{config::Config, core::handle, feat::clean_async, utils};
use clash_verge_logging::{Type, logging};

/// Restart the application
pub async fn restart_app() {
    logging!(debug, Type::System, "启动重启应用流程");
    // 设置退出标志
    handle::Handle::global().set_is_exiting();

    // Tono: restart releases the kill switch like quit does (§6, P0-8).
    if let Err(error) = crate::tono::commands::quit_release(handle::Handle::app_handle().clone()).await {
        logging!(
            error,
            Type::Service,
            "Tono: 无法证明重启前已恢复网络保护，取消重启: {error}"
        );
        handle::Handle::global().clear_is_exiting();
        handle::Handle::notice_message("app_restart::core_stop_failed", "");
        return;
    }

    Config::apply_all_and_save_file().await;

    logging!(info, Type::System, "开始异步清理资源");
    let cleanup_result = clean_async().await;

    logging!(
        info,
        Type::System,
        "资源清理完成，退出代码: {}",
        if cleanup_result.all_success { 0 } else { 1 }
    );

    if !cleanup_result.core_stopped {
        handle::Handle::global().clear_is_exiting();
        handle::Handle::notice_message("app_restart::core_stop_failed", "");
        return;
    }

    utils::server::shutdown_embedded_server();
    let app_handle = handle::Handle::app_handle();
    app_handle.restart();
}
