use crate::singleton;
use anyhow::Result;
use parking_lot::RwLock;
use scopeguard::defer;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use sysproxy::{Autoproxy, GuardMonitor, GuardType, Sysproxy};
use tokio::sync::Mutex as TokioMutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
enum ProxyApplyStep {
    Sysproxy,
    Autoproxy,
}

#[allow(dead_code)]
const fn proxy_apply_steps(sys_enabled: bool, auto_enabled: bool) -> [ProxyApplyStep; 2] {
    // Disabling PAC clears WinINET proxy flags on Windows, so pure global
    // proxy mode must clear PAC before enabling Sysproxy.
    if sys_enabled && !auto_enabled {
        [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
    } else {
        [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
    }
}

pub(crate) struct Sysopt {
    update_lock: TokioMutex<()>,
    guard_operation_lock: TokioMutex<()>,
    reset_sysproxy: AtomicBool,
    inner_proxy: Arc<RwLock<(Sysproxy, Autoproxy)>>,
    guard: Arc<RwLock<GuardMonitor>>,
}

impl Default for Sysopt {
    fn default() -> Self {
        Self {
            update_lock: TokioMutex::new(()),
            guard_operation_lock: TokioMutex::new(()),
            reset_sysproxy: AtomicBool::new(false),
            inner_proxy: Arc::new(RwLock::new((Sysproxy::default(), Autoproxy::default()))),
            guard: Arc::new(RwLock::new(GuardMonitor::new(GuardType::None, Duration::from_secs(30)))),
        }
    }
}

singleton!(Sysopt, SYSOPT);

impl Sysopt {
    fn new() -> Self {
        Self::default()
    }

    fn access_guard(&self) -> Arc<RwLock<GuardMonitor>> {
        Arc::clone(&self.guard)
    }

    async fn stop_proxy_guard_locked(&self) {
        loop {
            let state = self.access_guard().read().get_state();
            if state.is_pendding() {
                tokio::task::yield_now().await;
                continue;
            }
            self.access_guard().write().stop();
            return;
        }
    }

    pub(super) async fn stop_proxy_guard(&self) {
        let _operation = self.guard_operation_lock.lock().await;
        self.stop_proxy_guard_locked().await;
    }

    /// Wait for any in-progress `update_sysproxy` to finish, so that a
    /// subsequent read of OS-level sysproxy state sees a fully applied
    /// configuration instead of a partially-applied one (e.g. SOCKS already
    /// disabled but HTTP still enabled mid-transition).
    pub(crate) async fn wait_idle(&self) {
        let _ = self.update_lock.lock().await;
    }

    /// Turn the system proxy off whatever it names. Only the update transaction
    /// uses this: its Service refuses to stage while the user's proxy is on
    /// (`security::no_proxy`). Every other path goes through
    /// [`Self::clear_owned_sysproxy`].
    pub async fn reset_sysproxy(&self) -> Result<()> {
        self.reset_locked(false).await
    }

    /// Turn the system proxy off only when it is provably Tono's own leftover.
    ///
    /// Tono on Windows never writes the system proxy (P0-9). A proxy that names
    /// anything but this installation's loopback listeners belongs to another
    /// product or the user, and Tono holds no saved original to put back, so it
    /// is left exactly as found.
    pub async fn clear_owned_sysproxy(&self) -> Result<()> {
        self.reset_locked(true).await
    }

    async fn reset_locked(&self, only_owned: bool) -> Result<()> {
        if self
            .reset_sysproxy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }
        defer! {
            self.reset_sysproxy.store(false, Ordering::SeqCst);
        }
        let _lock = self.update_lock.lock().await;
        let _guard_operation = self.guard_operation_lock.lock().await;
        self.stop_proxy_guard_locked().await;

        if only_owned && !current_proxy_is_tono_owned().await {
            return Ok(());
        }

        // 直接关闭所有代理
        let (sys, auto) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.enable = false;
            auto.enable = false;
            (sys.clone(), auto.clone())
        };

        tokio::task::spawn_blocking(move || -> Result<()> {
            sys.set_system_proxy()?;
            auto.set_auto_proxy()?;
            Ok(())
        })
        .await??;

        Ok(())
    }
}

/// The WinINET proxy as the current user's Internet Settings record it.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
struct ProxyReading {
    /// `ProxyEnable`.
    manual: bool,
    /// `ProxyServer`, verbatim.
    server: String,
    /// `AutoConfigURL`, verbatim; empty when absent.
    pac_url: String,
}

/// Whether every live part of `reading` names this installation's own loopback
/// listeners: the Core's Mixed Port for a manual proxy, the embedded server's
/// PAC route for a PAC URL. Nothing live means nothing to clear.
#[cfg_attr(not(windows), allow(dead_code))]
fn tono_owns_proxy(reading: &ProxyReading, mixed_port: u16, pac_port: Option<u16>) -> bool {
    let pac_live = !reading.pac_url.trim().is_empty();
    if !reading.manual && !pac_live {
        return false;
    }
    let manual_owned = !reading.manual
        || (mixed_port != 0
            && ["127.0.0.1", "localhost"].iter().any(|host| {
                reading
                    .server
                    .trim()
                    .eq_ignore_ascii_case(&format!("{host}:{mixed_port}"))
            }));
    let pac_owned = !pac_live
        || pac_port.is_some_and(|port| reading.pac_url.trim() == format!("http://127.0.0.1:{port}/commands/pac"));
    manual_owned && pac_owned
}

#[cfg(windows)]
fn read_proxy() -> Result<ProxyReading> {
    use winreg::{
        RegKey,
        enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE},
    };
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        KEY_QUERY_VALUE,
    )?;
    Ok(ProxyReading {
        manual: key.get_value::<u32, _>("ProxyEnable").unwrap_or(0) != 0,
        server: key.get_value::<String, _>("ProxyServer").unwrap_or_default(),
        pac_url: key.get_value::<String, _>("AutoConfigURL").unwrap_or_default(),
    })
}

/// An unreadable setting proves nothing, so it is left alone too.
#[cfg(windows)]
async fn current_proxy_is_tono_owned() -> bool {
    let mixed_port = crate::config::MixedPort::desired().await;
    let pac_port = crate::utils::server::embedded_server_port().ok();
    match tokio::task::spawn_blocking(read_proxy).await {
        Ok(Ok(reading)) => tono_owns_proxy(&reading, mixed_port, pac_port),
        _ => false,
    }
}

/// Outside Windows this module keeps its earlier behaviour.
#[cfg(not(windows))]
async fn current_proxy_is_tono_owned() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{ProxyApplyStep, ProxyReading, proxy_apply_steps, tono_owns_proxy};

    #[test]
    fn pure_sysproxy_mode_clears_pac_before_enabling_global_proxy() {
        assert_eq!(
            proxy_apply_steps(true, false),
            [ProxyApplyStep::Autoproxy, ProxyApplyStep::Sysproxy]
        );
    }

    #[test]
    fn pac_mode_clears_global_proxy_before_enabling_pac() {
        assert_eq!(
            proxy_apply_steps(false, true),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }

    #[test]
    fn disabled_mode_clears_global_proxy_before_pac() {
        assert_eq!(
            proxy_apply_steps(false, false),
            [ProxyApplyStep::Sysproxy, ProxyApplyStep::Autoproxy]
        );
    }

    #[test]
    fn only_a_proxy_naming_tono_listeners_is_cleared() {
        let reading = |manual: bool, server: &str, pac_url: &str| ProxyReading {
            manual,
            server: server.to_owned(),
            pac_url: pac_url.to_owned(),
        };
        // Another product's or the user's proxy is never Tono's to turn off.
        assert!(!tono_owns_proxy(
            &reading(true, "10.0.0.5:8080", ""),
            17970,
            Some(33331)
        ));
        assert!(!tono_owns_proxy(
            &reading(true, "127.0.0.1:7897", ""),
            17970,
            Some(33331)
        ));
        assert!(!tono_owns_proxy(
            &reading(false, "", "http://wpad.corp/proxy.pac"),
            17970,
            Some(33331)
        ));
        assert!(!tono_owns_proxy(
            &reading(true, "127.0.0.1:17970", "http://wpad.corp/proxy.pac"),
            17970,
            Some(33331)
        ));
        // A leftover that names this installation's own listeners is.
        assert!(tono_owns_proxy(
            &reading(true, "127.0.0.1:17970", ""),
            17970,
            Some(33331)
        ));
        assert!(tono_owns_proxy(
            &reading(false, "", "http://127.0.0.1:33331/commands/pac"),
            17970,
            Some(33331)
        ));
    }
}
