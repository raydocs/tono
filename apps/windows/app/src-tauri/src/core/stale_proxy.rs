//! Stale WinINet loopback proxy.
//!
//! Tono on Windows does not enable the system proxy (P0-9). This module only
//! notices a manual proxy that is already on, points only at loopback, and has
//! no listener. A marker Tono would have written is restored automatically.
//! Anything else is left in the registry; the control-plane client already
//! uses `no_proxy`, and the UI offers a one-click disable of `ProxyEnable`.
//! A port that accepts a TCP connection is never changed.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const STALE_PROXY_CODE: &str = "TONO_STALE_SYSTEM_PROXY";
const MARKER_FILE: &str = "system-proxy-owner.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProxySnapshot {
    pub proxy_enable: bool,
    pub proxy_server: String,
    pub proxy_override: String,
    pub auto_config_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnershipMarker {
    /// `ProxyServer` value this install wrote. A later reading must match it.
    pub proxy_server: String,
    pub saved: SystemProxySnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StaleProxyAction {
    /// Not a dead loopback proxy. `alive_loopback` means a listener answered.
    Leave { alive_loopback: bool },
    /// The marker matches: put `saved` back.
    Restore(SystemProxySnapshot),
    /// Foreign dead loopback. Do not change the registry here.
    Bypass { server: String },
}

pub fn marker_path(dir: &Path) -> PathBuf {
    dir.join(MARKER_FILE)
}

pub fn load_marker(dir: &Path) -> Option<OwnershipMarker> {
    let bytes = std::fs::read(marker_path(dir)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// `port_open` reports whether that loopback port accepts a TCP connection.
pub fn classify_stale_proxy(
    snap: &SystemProxySnapshot,
    port_open: impl Fn(u16) -> bool,
    marker: Option<&OwnershipMarker>,
) -> StaleProxyAction {
    // PAC alone is not a manual proxy. A disabled ProxyEnable is not ours to clear.
    if !snap.proxy_enable {
        return StaleProxyAction::Leave { alive_loopback: false };
    }
    let Some(endpoints) = loopback_endpoints(&snap.proxy_server) else {
        return StaleProxyAction::Leave { alive_loopback: false };
    };
    if endpoints.iter().any(|port| port_open(*port)) {
        return StaleProxyAction::Leave { alive_loopback: true };
    }
    if let Some(owned) = marker {
        if owned.proxy_server.trim().eq_ignore_ascii_case(snap.proxy_server.trim()) {
            return StaleProxyAction::Restore(owned.saved.clone());
        }
    }
    StaleProxyAction::Bypass {
        server: snap.proxy_server.trim().to_string(),
    }
}

/// Every endpoint in `server`, when each one is loopback. `None` when any
/// endpoint is missing, unparseable, or not loopback — those stay untouched.
fn loopback_endpoints(server: &str) -> Option<Vec<u16>> {
    let server = server.trim();
    if server.is_empty() {
        return None;
    }
    let raw: Vec<&str> = if server.contains('=') {
        server
            .split(';')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect()
    } else {
        vec![server]
    };
    if raw.is_empty() {
        return None;
    }
    let mut ports = Vec::with_capacity(raw.len());
    for part in raw {
        let address = part.split_once('=').map(|(_, value)| value.trim()).unwrap_or(part);
        let (host, port) = parse_host_port(address)?;
        if !is_loopback(&host) {
            return None;
        }
        ports.push(port);
    }
    Some(ports)
}

fn parse_host_port(address: &str) -> Option<(String, u16)> {
    let address = address.trim();
    if let Some(rest) = address.strip_prefix('[') {
        let (host, port) = rest.rsplit_once("]:")?;
        return Some((host.to_string(), port.parse().ok()?));
    }
    let (host, port) = address.rsplit_once(':')?;
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), port.parse().ok()?))
}

fn is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "::1"
        || host.eq_ignore_ascii_case("0:0:0:0:0:0:0:1")
}

#[cfg(windows)]
fn read_snapshot() -> Result<SystemProxySnapshot, String> {
    use winreg::{
        RegKey,
        enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE},
    };
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            KEY_QUERY_VALUE,
        )
        .map_err(|error| error.to_string())?;
    Ok(SystemProxySnapshot {
        proxy_enable: key.get_value::<u32, _>("ProxyEnable").unwrap_or(0) != 0,
        proxy_server: key.get_value("ProxyServer").unwrap_or_default(),
        proxy_override: key.get_value("ProxyOverride").unwrap_or_default(),
        auto_config_url: key.get_value("AutoConfigURL").unwrap_or_default(),
    })
}

#[cfg(windows)]
fn loopback_port_open(port: u16) -> bool {
    use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
    use std::time::Duration;
    let timeout = Duration::from_millis(200);
    let v4 = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let v6 = SocketAddr::from((Ipv6Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&v4, timeout).is_ok() || TcpStream::connect_timeout(&v6, timeout).is_ok()
}

#[cfg(windows)]
async fn apply_action(
    state: &std::sync::Arc<crate::tono::state::TonoState>,
    dir: &Path,
    action: StaleProxyAction,
) {
    match action {
        StaleProxyAction::Leave { .. } => {
            state.lock().await.stale_system_proxy = None;
        }
        StaleProxyAction::Restore(saved) => {
            let saved_for_write = saved.clone();
            let wrote = tokio::task::spawn_blocking(move || {
                sysproxy::restore_internet_proxy_settings(
                    saved_for_write.proxy_enable,
                    &saved_for_write.proxy_server,
                    &saved_for_write.proxy_override,
                    &saved_for_write.auto_config_url,
                )
            })
            .await;
            if matches!(wrote, Ok(Ok(()))) {
                let _ = std::fs::remove_file(marker_path(dir));
                state.lock().await.stale_system_proxy = None;
            }
        }
        StaleProxyAction::Bypass { server } => {
            state.lock().await.stale_system_proxy = Some(format!("{STALE_PROXY_CODE}: {server}"));
        }
    }
}

/// Read the current user's proxy and record a bypass notice, or restore a
/// matching ownership marker. A read failure changes nothing.
pub async fn inspect(state: &std::sync::Arc<crate::tono::state::TonoState>) {
    #[cfg(windows)]
    {
        let dir = state.lock().await.catalog_dir.clone();
        let snap = match tokio::task::spawn_blocking(read_snapshot).await {
            Ok(Ok(snap)) => snap,
            _ => return,
        };
        let marker = load_marker(&dir);
        let action = classify_stale_proxy(&snap, loopback_port_open, marker.as_ref());
        apply_action(state, &dir, action).await;
    }
    #[cfg(not(windows))]
    {
        let _ = state;
    }
}

/// Re-check, then disable `ProxyEnable` only while the proxy is still a dead
/// loopback. An open port is left alone.
#[cfg(windows)]
pub async fn disable_if_still_stale(state: &std::sync::Arc<crate::tono::state::TonoState>) -> Result<(), String> {
    let dir = state.lock().await.catalog_dir.clone();
    let snap = tokio::task::spawn_blocking(read_snapshot)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error)?;
    let marker = load_marker(&dir);
    match classify_stale_proxy(&snap, loopback_port_open, marker.as_ref()) {
        StaleProxyAction::Leave { alive_loopback: true } => {
            Err("that loopback proxy is accepting connections".to_string())
        }
        StaleProxyAction::Leave { alive_loopback: false } => {
            state.lock().await.stale_system_proxy = None;
            Ok(())
        }
        StaleProxyAction::Restore(saved) => {
            let saved_for_write = saved.clone();
            tokio::task::spawn_blocking(move || {
                sysproxy::restore_internet_proxy_settings(
                    saved_for_write.proxy_enable,
                    &saved_for_write.proxy_server,
                    &saved_for_write.proxy_override,
                    &saved_for_write.auto_config_url,
                )
            })
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?;
            let _ = std::fs::remove_file(marker_path(&dir));
            state.lock().await.stale_system_proxy = None;
            Ok(())
        }
        StaleProxyAction::Bypass { .. } => {
            tokio::task::spawn_blocking(sysproxy::disable_proxy_enable_and_notify)
                .await
                .map_err(|error| error.to_string())?
                .map_err(|error| error.to_string())?;
            state.lock().await.stale_system_proxy = None;
            Ok(())
        }
    }
}

#[cfg(not(windows))]
pub async fn disable_if_still_stale(state: &std::sync::Arc<crate::tono::state::TonoState>) -> Result<(), String> {
    state.lock().await.stale_system_proxy = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{OwnershipMarker, StaleProxyAction, SystemProxySnapshot, classify_stale_proxy};

    fn snap(enable: bool, server: &str, pac: &str) -> SystemProxySnapshot {
        SystemProxySnapshot {
            proxy_enable: enable,
            proxy_server: server.to_string(),
            proxy_override: String::new(),
            auto_config_url: pac.to_string(),
        }
    }

    #[test]
    fn dead_loopback_proxy_is_a_bypass() {
        let closed = |_port| false;
        assert!(matches!(
            classify_stale_proxy(&snap(true, "127.0.0.1:10090", ""), closed, None),
            StaleProxyAction::Bypass { server } if server == "127.0.0.1:10090"
        ));
        assert!(matches!(
            classify_stale_proxy(&snap(true, "localhost:10090", ""), closed, None),
            StaleProxyAction::Bypass { .. }
        ));
        assert!(matches!(
            classify_stale_proxy(&snap(true, "[::1]:10090", ""), closed, None),
            StaleProxyAction::Bypass { server } if server == "[::1]:10090"
        ));
        assert!(matches!(
            classify_stale_proxy(
                &snap(true, "http=127.0.0.1:10090;https=127.0.0.1:10090", ""),
                closed,
                None,
            ),
            StaleProxyAction::Bypass { .. }
        ));
    }

    #[test]
    fn open_loopback_port_is_left_alone() {
        let action = classify_stale_proxy(&snap(true, "127.0.0.1:10090", ""), |port| port == 10090, None);
        assert_eq!(action, StaleProxyAction::Leave { alive_loopback: true });
    }

    #[test]
    fn non_loopback_proxy_is_left_alone() {
        let action = classify_stale_proxy(&snap(true, "10.1.2.3:8080", ""), |_| false, None);
        assert_eq!(action, StaleProxyAction::Leave { alive_loopback: false });
        let mixed = classify_stale_proxy(
            &snap(true, "http=127.0.0.1:10090;https=10.1.2.3:8080", ""),
            |_| false,
            None,
        );
        assert_eq!(mixed, StaleProxyAction::Leave { alive_loopback: false });
    }

    #[test]
    fn pac_url_without_a_manual_proxy_is_left_alone() {
        let action = classify_stale_proxy(
            &snap(false, "", "http://127.0.0.1:10090/proxy.pac"),
            |_| false,
            None,
        );
        assert_eq!(action, StaleProxyAction::Leave { alive_loopback: false });
    }

    #[test]
    fn matching_ownership_marker_restores_the_saved_proxy() {
        let saved = snap(false, "", "");
        let marker = OwnershipMarker {
            proxy_server: "127.0.0.1:10090".to_string(),
            saved: saved.clone(),
        };
        assert_eq!(
            classify_stale_proxy(&snap(true, "127.0.0.1:10090", ""), |_| false, Some(&marker)),
            StaleProxyAction::Restore(saved),
        );
        let other = OwnershipMarker {
            proxy_server: "127.0.0.1:7897".to_string(),
            saved: snap(false, "", ""),
        };
        assert!(matches!(
            classify_stale_proxy(&snap(true, "127.0.0.1:10090", ""), |_| false, Some(&other)),
            StaleProxyAction::Bypass { .. }
        ));
    }
}
