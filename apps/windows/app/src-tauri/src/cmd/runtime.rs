use super::CmdResult;
use crate::config::Config;
use smartstring::alias::String;
use std::collections::HashSet;

/// 获取运行时存在的键
#[tauri::command]
pub async fn get_runtime_exists() -> CmdResult<HashSet<String>> {
    Ok(Config::runtime().await.latest_arc().exists_keys.clone())
}

/// 更新运行时链式代理配置
#[tauri::command]
pub async fn update_proxy_chain_config_in_runtime(proxy_chain_config: Option<serde_yaml_ng::Value>) -> CmdResult<()> {
    let _ = proxy_chain_config;
    Err("disabled by Tono".into())
}
