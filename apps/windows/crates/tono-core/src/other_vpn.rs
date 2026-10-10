//! H21-O-F7: recognise VPN/TUN adapters that Tono does not own.
//!
//! Pure classification of an adapter list the caller enumerates (the App reads
//! it unprivileged through IP Helper). Nothing here changes a route, a WFP
//! filter, the Service protocol, or the connect decision. It only names the
//! likely cause of a failed connect and adds one class token to diagnostics.

use std::borrow::Cow;

use crate::config::TUN_DEVICE_NAME;
use crate::customer_failure::{CustomerFailureCode, classify_connect_text};

/// Appended to an attributed connect error. The error's first token (its
/// telemetry code) is unchanged; the dashboard keys its sentence off this one.
pub const SUPPORT_CODE: &str = "TONO_OTHER_VPN_PRESENT";

/// Class token for `DiagnosticsReport::virtual_adapters`. Never an adapter name.
pub const DIAGNOSTICS_CLASS: &str = "otherVpn";

/// `IF_TYPE_PROP_VIRTUAL`: Wintun adapters (WireGuard, Tailscale, Clash-family
/// and sing-box clients) report this type.
pub const IF_TYPE_PROP_VIRTUAL: u32 = 53;

/// One row of the system adapter table, as read. `alias` is the user-visible
/// connection name ("Ethernet", "Tono"); `description` is the driver's name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkAdapter {
    pub alias: String,
    pub description: String,
    pub if_type: u32,
    pub up: bool,
}

/// Driver-description markers of VPN/TUN adapters, matched lowercase.
const VPN_MARKERS: &[&str] = &[
    "wintun",
    "wireguard",
    "tap-windows",
    "tap-win32",
    "openvpn",
    "vpn",
    "tailscale",
    "zerotier",
    "anyconnect",
    "globalprotect",
    "pangp",
    "fortinet",
    "forticlient",
    "sonicwall",
    "juniper",
    "pulse secure",
    "nordlynx",
    "mullvad",
    "softether",
    "hamachi",
    "sing-tun",
    "clash",
    "mihomo",
];

/// Virtual adapters that are not VPNs (hypervisors, containers, capture
/// drivers). They are already reported under their own class tokens.
const NOT_VPN_MARKERS: &[&str] = &[
    "vmware",
    "virtualbox",
    "vboxnet",
    "hyper-v",
    "vethernet",
    "wsl",
    "docker",
    "loopback",
    "npcap",
    "bluetooth",
];

/// Failure codes another VPN can plausibly cause: the node, the data plane,
/// or the TUN path did not work. Service, BFE/WFP, account, clock and policy
/// failures have their own, more specific cause and are never re-attributed.
const ATTRIBUTABLE_CODES: &[&str] = &[
    "TONO_CONNECT_DNS",
    "TONO_CONNECT_TCP",
    "TONO_CONNECT_TLS",
    "TONO_CONNECT_QUIC",
    "TONO_CONNECT_TIMEOUT",
    "TONO_CONNECT_TUN",
    "TONO_CONNECT_LOCAL_CONFLICT",
    "TONO_TUN_DATA_PLANE_BROKEN",
    "TONO_TUN_INGRESS_BROKEN",
    "TONO_TUN_ROUTE_UNAVAILABLE",
    "TONO_NODE_OR_CORE_UNREACHABLE",
    "CORE_EXIT_UNREACHABLE",
];

/// An operationally up VPN/TUN adapter that is not Tono's own `Tono` adapter.
/// Microsoft's built-in tunnels (Teredo, IP-HTTPS, 6to4) and WAN miniports
/// are not counted.
pub fn is_foreign_vpn(adapter: &NetworkAdapter) -> bool {
    if !adapter.up || adapter.alias.trim().eq_ignore_ascii_case(TUN_DEVICE_NAME) {
        return false;
    }
    let description = adapter.description.to_lowercase();
    if description.starts_with("microsoft") || description.starts_with("wan miniport") {
        return false;
    }
    if VPN_MARKERS.iter().any(|marker| description.contains(marker)) {
        return true;
    }
    adapter.if_type == IF_TYPE_PROP_VIRTUAL
        && !NOT_VPN_MARKERS.iter().any(|marker| description.contains(marker))
}

/// How many adapters in `adapters` are [`is_foreign_vpn`].
pub fn foreign_vpn_count(adapters: &[NetworkAdapter]) -> usize {
    adapters.iter().filter(|adapter| is_foreign_vpn(adapter)).count()
}

fn first_wire_token(text: &str) -> Option<&str> {
    text.split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
        .find(|token| {
            ((token.starts_with("TONO_") || token.starts_with("CORE_")) && token.len() > 5)
                || *token == "UNKNOWN_CLASSIFIED_FAILURE"
        })
}

fn attributable(message: &str) -> bool {
    if message.contains("TONO_CLOCK_SKEW") {
        return false;
    }
    match first_wire_token(message) {
        Some(token) => ATTRIBUTABLE_CODES.contains(&token),
        None => matches!(
            classify_connect_text(message),
            CustomerFailureCode::ConnectDns
                | CustomerFailureCode::ConnectTcp
                | CustomerFailureCode::ConnectTls
                | CustomerFailureCode::ConnectQuic
                | CustomerFailureCode::ConnectTimeout
                | CustomerFailureCode::ConnectTun
                | CustomerFailureCode::ConnectLocalConflict
        ),
    }
}

/// Append [`SUPPORT_CODE`] to a network/TUN-class connect error when another
/// VPN adapter is up. Every other error, and an error already carrying the
/// code, is returned unchanged. No adapter name is written into the text: the
/// error reaches telemetry and the diagnostics upload.
pub fn annotate<'a>(message: &'a str, adapters: &[NetworkAdapter]) -> Cow<'a, str> {
    let count = foreign_vpn_count(adapters);
    if count == 0 || message.contains(SUPPORT_CODE) || !attributable(message) {
        return Cow::Borrowed(message);
    }
    Cow::Owned(format!(
        "{message} [{SUPPORT_CODE}: {count} VPN/TUN adapter(s) not owned by Tono are up]"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter(alias: &str, description: &str, if_type: u32, up: bool) -> NetworkAdapter {
        NetworkAdapter {
            alias: alias.to_string(),
            description: description.to_string(),
            if_type,
            up,
        }
    }

    #[test]
    fn an_up_foreign_vpn_adapter_is_named_on_a_tunnel_failure_only() {
        let ordinary = vec![
            adapter("Tono", "Wintun Userspace Tunnel", IF_TYPE_PROP_VIRTUAL, true),
            adapter("Ethernet", "Intel(R) Ethernet Connection I219-V", 6, true),
            adapter("vEthernet (WSL)", "Hyper-V Virtual Ethernet Adapter", 6, true),
            adapter("Teredo", "Microsoft Teredo Tunneling Adapter", 131, true),
            adapter("Local Area Connection", "TAP-Windows Adapter V9", 6, false),
        ];
        let failure = "TONO_TUN_INGRESS_BROKEN: real TUN probe failed";
        assert_eq!(annotate(failure, &ordinary), failure);

        let mut with_vpn = ordinary;
        with_vpn.push(adapter("wg0", "WireGuard Tunnel", IF_TYPE_PROP_VIRTUAL, true));
        let attributed = annotate(failure, &with_vpn);
        assert!(attributed.starts_with(failure), "{attributed}");
        assert!(attributed.contains(&format!("{SUPPORT_CODE}:")), "{attributed}");
        assert!(!attributed.contains("wg0") && !attributed.contains("WireGuard"));
        assert_eq!(annotate(&attributed, &with_vpn), attributed);

        let service = "TONO_SERVICE_NOT_RUNNING: Tono Service is not ready";
        assert_eq!(annotate(service, &with_vpn), service);
    }
}
