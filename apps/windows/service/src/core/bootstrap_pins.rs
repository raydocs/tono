//! Learned control-plane addresses, stored next to the Service binary.
//!
//! The App must not keep this set in user AppData: a same-user writer could
//! punch WFP holes for tomorrow's recovery pins. The file lives in the
//! installer directory (SYSTEM + Administrators) and is only rewritten by
//! an authenticated session after a protected resolve.

use crate::BootstrapPins;
use anyhow::{Context as _, Result};
use std::net::Ipv4Addr;
use std::path::PathBuf;
use tokio::sync::Mutex;

/// Same host the App pins in `tono::bootstrap`.
const API_HOST: &str = "api.afk.ccwu.cc";
const PIN_FILE_NAME: &str = "control-plane-pins.json";
const MAXIMUM_LEARNED_PINS: usize = 6;

static PIN_FILE_LOCK: Mutex<()> = Mutex::const_new(());

pub(crate) fn load() -> BootstrapPins {
    read_pin_file().unwrap_or_default()
}

pub(crate) async fn remember(incoming: BootstrapPins) -> Result<BootstrapPins> {
    let _guard = PIN_FILE_LOCK.lock().await;
    let existing = read_pin_file().unwrap_or_default();
    let merged = merge_pins(&incoming, &existing);
    write_pin_file(&merged)?;
    Ok(merged)
}

fn merge_pins(incoming: &BootstrapPins, existing: &BootstrapPins) -> BootstrapPins {
    let incoming = admitted_addresses(incoming);
    let existing = admitted_addresses(existing);
    let mut addresses = Vec::new();
    for address in incoming.into_iter().chain(existing) {
        if !addresses.contains(&address) {
            addresses.push(address);
        }
        if addresses.len() == MAXIMUM_LEARNED_PINS {
            break;
        }
    }
    BootstrapPins {
        host: API_HOST.to_owned(),
        addresses,
    }
}

fn admitted_addresses(pins: &BootstrapPins) -> Vec<String> {
    if !pins.host.is_empty() && pins.host != API_HOST {
        return Vec::new();
    }
    pins.addresses
        .iter()
        .filter_map(|host| admit_public_ipv4(host))
        .collect()
}

/// Same admission predicate as `tono_core::node::is_public_ipv4`.
fn admit_public_ipv4(host: &str) -> Option<String> {
    let address = host.parse::<Ipv4Addr>().ok()?;
    let b = address.octets();
    let public = b[0] != 0
        && b[0] != 10
        && b[0] != 127
        && !(b[0] == 100 && (64..=127).contains(&b[1]))
        && !(b[0] == 169 && b[1] == 254)
        && !(b[0] == 172 && (16..=31).contains(&b[1]))
        && !(b[0] == 192 && b[1] == 0 && b[2] == 0)
        && !(b[0] == 192 && b[1] == 0 && b[2] == 2)
        && !(b[0] == 192 && b[1] == 168)
        && !(b[0] == 198 && (18..=19).contains(&b[1]))
        && !(b[0] == 198 && b[1] == 51 && b[2] == 100)
        && !(b[0] == 203 && b[1] == 0 && b[2] == 113)
        && !(b[0] == 192 && b[1] == 31 && b[2] == 196)
        && !(b[0] == 192 && b[1] == 52 && b[2] == 193)
        && !(b[0] == 192 && b[1] == 88 && b[2] == 99)
        && !(b[0] == 192 && b[1] == 175 && b[2] == 48)
        && b[0] < 224;
    public.then(|| address.to_string())
}

fn pin_path() -> PathBuf {
    crate::service_paths()
        .install_dir()
        .join(PIN_FILE_NAME)
}

fn read_pin_file() -> Option<BootstrapPins> {
    let body = std::fs::read_to_string(pin_path()).ok()?;
    serde_json::from_str(&body).ok()
}

fn write_pin_file(pins: &BootstrapPins) -> Result<()> {
    let path = pin_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create bootstrap-pin directory {parent:?}"))?;
    }
    let body = serde_json::to_string(pins).context("failed to encode bootstrap pins")?;
    let tmp = path.with_extension("json.tmp");
    let _ = std::fs::remove_file(&tmp);
    std::fs::write(&tmp, body)
        .with_context(|| format!("failed to write bootstrap pins {tmp:?}"))?;
    if let Err(error) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error).with_context(|| format!("failed to publish bootstrap pins {path:?}"));
    }
    #[cfg(all(windows, feature = "standalone"))]
    {
        let _ = crate::core::platform_security::secure_private_service_file_if_exists(&path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{API_HOST, MAXIMUM_LEARNED_PINS, admit_public_ipv4, merge_pins};
    use crate::BootstrapPins;

    #[test]
    fn merge_keeps_newest_public_addresses_and_the_api_host() {
        let incoming = BootstrapPins {
            host: API_HOST.to_owned(),
            addresses: vec![
                "9.9.9.9".to_owned(),
                "10.0.0.1".to_owned(),
                "198.18.0.2".to_owned(),
                "1.1.1.1".to_owned(),
            ],
        };
        let existing = BootstrapPins {
            host: API_HOST.to_owned(),
            addresses: (1..=8).map(|n| format!("8.8.8.{n}")).collect(),
        };
        let merged = merge_pins(&incoming, &existing);
        assert_eq!(merged.host, API_HOST);
        assert_eq!(merged.addresses.len(), MAXIMUM_LEARNED_PINS);
        assert_eq!(
            &merged.addresses[..2],
            &["9.9.9.9".to_owned(), "1.1.1.1".to_owned()]
        );
        assert!(!merged.addresses.iter().any(|ip| ip == "10.0.0.1"));
        assert!(!merged.addresses.iter().any(|ip| ip == "198.18.0.2"));
        assert!(!merged.addresses.iter().any(|ip| ip == "8.8.8.8"));
    }

    #[test]
    fn a_foreign_host_never_contributes_addresses() {
        let incoming = BootstrapPins {
            host: "evil.example".to_owned(),
            addresses: vec!["9.9.9.9".to_owned()],
        };
        let merged = merge_pins(&incoming, &BootstrapPins::default());
        assert!(merged.addresses.is_empty());
        assert_eq!(merged.host, API_HOST);
    }

    #[test]
    fn fake_ip_and_private_literals_are_dropped() {
        assert!(admit_public_ipv4("198.18.0.1").is_none());
        assert!(admit_public_ipv4("10.1.2.3").is_none());
        assert!(admit_public_ipv4("not-an-ip").is_none());
        assert_eq!(admit_public_ipv4("1.1.1.1").as_deref(), Some("1.1.1.1"));
    }
}
