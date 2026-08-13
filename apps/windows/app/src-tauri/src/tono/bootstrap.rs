//! Pinned bootstrap addresses for the Tono control plane (F1).
//!
//! Source: `Tono/Info.plist` key `TonoAPIBootstrapAddresses` in the macOS
//! client (build 26+). The macOS incident that motivated them: with the
//! kill switch fully blocking, the API hostname could no longer be
//! resolved through system DNS, so the client could never arm or reconnect
//! — a control-plane self-lockout. Both the app's API client (DNS pinning
//! at the HTTP layer) and the Service's WFP bootstrap permit
//! (`bootstrap_api_hosts`) therefore carry literal IPs and depend on no
//! resolver while blocked.
//!
//! The addresses are Cloudflare anycast ranges for `api.afk.ccwu.cc`;
//! TLS/SNI still validates the *hostname*, so pinning changes only where
//! the TCP connection lands — a compromised resolver can no longer reroute
//! the control plane, and an attacker cannot forge Cloudflare's
//! certificate for the domain. They must be re-verified against the
//! macOS plist whenever it changes (check on every macOS release bump).

use std::net::Ipv4Addr;
use std::sync::{Mutex, PoisonError};

/// Pinned bootstrap IPs for `api.afk.ccwu.cc` (see module docs; keep in
/// sync with `Tono/Info.plist` `TonoAPIBootstrapAddresses`).
pub const API_BOOTSTRAP_IPS: [&str; 2] = ["104.20.26.170", "172.66.162.98"];

/// The API hostname these pins stand in for.
pub const API_HOST: &str = "api.afk.ccwu.cc";

/// Hard cap for `bootstrap_api_hosts` on the wire (F1).
pub const MAX_BOOTSTRAP_HOSTS: usize = 8;
/// Learned addresses kept per host. Bounded because the WFP permit is
/// itself capped, and a rotation that never repeats an address would
/// otherwise grow this until the next arm failed.
const MAXIMUM_LEARNED_PINS: usize = 6;

/// Learned addresses for this process. Persistence is the Service's ProgramData
/// file, reached over IPC — never user AppData.
static LEARNED_PINS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The pinned addresses, parsed once and validated as public IPv4
/// literals with the same admission predicate the catalog uses (§4).
pub fn pinned_bootstrap_ips() -> Vec<Ipv4Addr> {
    API_BOOTSTRAP_IPS
        .iter()
        .filter_map(|text| text.parse::<Ipv4Addr>().ok())
        .filter(|addr| tono_core::node::is_public_ipv4(*addr))
        .collect()
}

/// Compiled pins first, then addresses learned while connected, capped at
/// [`MAX_BOOTSTRAP_HOSTS`]. Used by the HTTP client so a Protected Offline
/// restart can still reach a rotated anycast edge.
pub fn control_plane_http_pins() -> Vec<Ipv4Addr> {
    let mut ips = pinned_bootstrap_ips();
    for learned in load_learned_ips() {
        if let Ok(ip) = learned.parse::<Ipv4Addr>()
            && tono_core::node::is_public_ipv4(ip)
            && !ips.contains(&ip)
        {
            ips.push(ip);
        }
        if ips.len() >= MAX_BOOTSTRAP_HOSTS {
            break;
        }
    }
    ips
}

/// Merge the pinned IPs with dynamically resolved ones for
/// `StartClashRequest.bootstrap_api_hosts`: public-literal only, first
/// occurrence wins, capped at [`MAX_BOOTSTRAP_HOSTS`]. The pinned IPs come
/// first — they are the recovery path that must survive a poisoned DNS.
pub fn merge_bootstrap_hosts(dynamic: &[String]) -> Vec<String> {
    merge_bootstrap_hosts_with(dynamic, &load_learned_ips())
}

fn merge_bootstrap_hosts_with(dynamic: &[String], learned: &[String]) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    let mut push = |host: String| {
        if hosts.len() < MAX_BOOTSTRAP_HOSTS && !hosts.contains(&host) {
            hosts.push(host);
        }
    };
    for addr in pinned_bootstrap_ips() {
        push(addr.to_string());
    }
    for host in learned.iter().chain(dynamic.iter()) {
        if let Ok(addr) = host.parse::<Ipv4Addr>()
            && tono_core::node::is_public_ipv4(addr)
        {
            push(addr.to_string());
        }
    }
    hosts
}

fn load_learned_ips() -> Vec<String> {
    LEARNED_PINS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

fn adopt_learned_ips(addresses: &[String]) {
    let cleaned: Vec<String> = addresses
        .iter()
        .filter_map(|host| {
            host.parse::<Ipv4Addr>()
                .ok()
                .filter(|addr| tono_core::node::is_public_ipv4(*addr))
                .map(|addr| addr.to_string())
        })
        .take(MAXIMUM_LEARNED_PINS)
        .collect();
    *LEARNED_PINS.lock().unwrap_or_else(PoisonError::into_inner) = cleaned;
}

/// Records addresses resolved through the protected resolver, newest first.
pub fn remember_control_plane_addresses(addresses: &[String]) {
    let cleaned: Vec<String> = addresses
        .iter()
        .filter_map(|host| {
            host.parse::<Ipv4Addr>()
                .ok()
                .filter(|addr| tono_core::node::is_public_ipv4(*addr))
                .map(|addr| addr.to_string())
        })
        .collect();
    if cleaned.is_empty() {
        return;
    }
    let mut guard = LEARNED_PINS.lock().unwrap_or_else(PoisonError::into_inner);
    *guard = merge_learned_addresses(&cleaned, &guard);
}

/// Load ProgramData pins from the Service. Missing or older Services leave
/// memory unchanged (compiled pins only).
pub async fn hydrate_learned_pins_from_service() {
    discard_untrusted_appdata_pin_cache();
    if !service_supports_bootstrap_pins().await {
        return;
    }
    let Ok(credentials) = crate::core::owner_identity::current_owner_credentials() else {
        return;
    };
    let Ok(response) = clash_verge_service_ipc::get_bootstrap_pins(&credentials).await else {
        return;
    };
    if response.code != 0 {
        return;
    }
    let Some(pins) = response.data else {
        return;
    };
    if !pins.host.is_empty() && pins.host != API_HOST {
        return;
    }
    adopt_learned_ips(&pins.addresses);
}

/// Persist the in-memory set through a live Service session.
pub async fn persist_learned_pins_to_service() {
    let addresses = load_learned_ips();
    if addresses.is_empty() || !service_supports_bootstrap_pins().await {
        return;
    }
    let Ok(credentials) = crate::core::owner_identity::current_owner_credentials() else {
        return;
    };
    let Ok(session) = crate::core::service::active_service_session() else {
        return;
    };
    let body = clash_verge_service_ipc::BootstrapPins {
        host: API_HOST.to_string(),
        addresses,
    };
    let Ok(response) =
        clash_verge_service_ipc::remember_bootstrap_pins(&credentials, &session, &body).await
    else {
        return;
    };
    if response.code == 0
        && let Some(stored) = response.data
    {
        adopt_learned_ips(&stored.addresses);
    }
}

static SERVICE_HAS_BOOTSTRAP_PINS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

async fn service_supports_bootstrap_pins() -> bool {
    use std::sync::atomic::Ordering;

    if SERVICE_HAS_BOOTSTRAP_PINS.load(Ordering::Relaxed) {
        return true;
    }
    let supported = clash_verge_service_ipc::get_version()
        .await
        .ok()
        .and_then(|response| response.data)
        .is_some_and(|info| info.supports_bootstrap_pins());
    if supported {
        SERVICE_HAS_BOOTSTRAP_PINS.store(true, Ordering::Relaxed);
    }
    supported
}

/// Previous builds wrote learned pins into user AppData. That file is not
/// trusted and must not be read; delete it so it cannot be reused by accident.
fn discard_untrusted_appdata_pin_cache() {
    for path in leftover_appdata_pin_paths() {
        let _ = std::fs::remove_file(path);
    }
}

fn leftover_appdata_pin_paths() -> Vec<std::path::PathBuf> {
    use tauri::Manager as _;

    let mut paths = Vec::new();
    if let Ok(home) = crate::utils::dirs::preinit_app_data_dir() {
        paths.push(home.join("tono").join("control-plane-pins.json"));
    }
    if let Some(dir) = crate::APP_HANDLE
        .get()
        .and_then(|handle| handle.path().data_dir().ok())
    {
        paths.push(
            dir.join(crate::utils::dirs::APP_ID)
                .join("tono")
                .join("control-plane-pins.json"),
        );
    }
    paths
}

/// Newest answers first so a rotation that never repeats an address still
/// keeps the currently working set under the ceiling.
fn merge_learned_addresses(incoming: &[String], existing: &[String]) -> Vec<String> {
    let mut merged = Vec::new();
    for address in incoming.iter().chain(existing.iter()) {
        if !merged.contains(address) {
            merged.push(address.clone());
        }
        if merged.len() == MAXIMUM_LEARNED_PINS {
            break;
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::{
        API_BOOTSTRAP_IPS, MAX_BOOTSTRAP_HOSTS, MAXIMUM_LEARNED_PINS, merge_bootstrap_hosts_with,
        merge_learned_addresses, pinned_bootstrap_ips,
    };

    #[test]
    fn pinned_ips_are_public_ipv4_literals() {
        let ips = pinned_bootstrap_ips();
        assert_eq!(
            ips.len(),
            API_BOOTSTRAP_IPS.len(),
            "every pinned entry must parse as public IPv4"
        );
        assert_eq!(ips[0].to_string(), "104.20.26.170");
        assert_eq!(ips[1].to_string(), "172.66.162.98");
    }

    #[test]
    fn merge_dedupes_and_keeps_pins_first() {
        let dynamic = vec![
            "172.66.162.98".to_string(), // duplicate of a pin
            "1.1.1.1".to_string(),
            "104.20.26.170".to_string(), // duplicate of a pin
        ];
        let merged = merge_bootstrap_hosts_with(&dynamic, &[]);
        assert_eq!(merged, vec!["104.20.26.170", "172.66.162.98", "1.1.1.1"]);
    }

    #[test]
    fn merge_drops_non_public_and_malformed_entries() {
        let dynamic = vec![
            "10.0.0.8".to_string(),   // private
            "198.18.0.1".to_string(), // fake-ip range, reserved
            "not-an-ip".to_string(),  // garbage
            "8.8.8.8".to_string(),
        ];
        let merged = merge_bootstrap_hosts_with(&dynamic, &[]);
        assert_eq!(merged, vec!["104.20.26.170", "172.66.162.98", "8.8.8.8"]);
    }

    #[test]
    fn merge_caps_at_eight_hosts() {
        let dynamic: Vec<String> = (1..=16).map(|last| format!("9.0.0.{last}")).collect();
        let merged = merge_bootstrap_hosts_with(&dynamic, &[]);
        assert_eq!(merged.len(), MAX_BOOTSTRAP_HOSTS);
        assert_eq!(merged[0], "104.20.26.170");
        assert_eq!(merged[1], "172.66.162.98");
    }

    #[test]
    fn learned_union_keeps_newest_first_and_stays_bounded() {
        let incoming: Vec<String> = (1..=4).map(|n| format!("9.0.0.{n}")).collect();
        let existing: Vec<String> = (1..=8).map(|n| format!("8.8.8.{n}")).collect();
        let merged = merge_learned_addresses(&incoming, &existing);
        assert_eq!(merged.len(), MAXIMUM_LEARNED_PINS);
        assert_eq!(
            &merged[..4],
            &[
                "9.0.0.1".to_string(),
                "9.0.0.2".to_string(),
                "9.0.0.3".to_string(),
                "9.0.0.4".to_string()
            ]
        );
        assert!(!merged.iter().any(|ip| ip == "8.8.8.8"));
    }

    #[test]
    fn leftover_appdata_pin_paths_are_user_tono_files() {
        let paths = super::leftover_appdata_pin_paths();
        for path in &paths {
            assert_eq!(
                path.file_name().and_then(|name| name.to_str()),
                Some("control-plane-pins.json")
            );
        }
    }

    #[test]
    fn learned_addresses_sit_after_compiled_pins() {
        let learned = vec!["9.9.9.9".to_string(), "1.1.1.1".to_string()];
        let merged = merge_bootstrap_hosts_with(&["8.8.8.8".to_string()], &learned);
        assert_eq!(
            merged,
            vec![
                "104.20.26.170",
                "172.66.162.98",
                "9.9.9.9",
                "1.1.1.1",
                "8.8.8.8"
            ]
        );
    }
}
