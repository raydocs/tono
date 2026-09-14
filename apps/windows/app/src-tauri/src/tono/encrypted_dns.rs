//! Windows Encrypted DNS (DoH) can override the adapter DNS Tono just wrote
//! (`198.18.0.2`). Fake-ip verification uses `DnsQueryEx`, which may still hit
//! the TUN resolver, while Chrome / Win11 "Encrypted only" talks DoH to a
//! public resolver that WFP then blocks. Connect looks up; pages do not.
//!
//! This module is read-only. It never changes DNS policy. The Service turns
//! `EnableAutoDoh` off, zeros per-adapter `DohFlags` under
//! `InterfaceSpecificParameters`, and installs an NRPT catch-all for the
//! connected session; this detector is the UI banner if that pin has not taken.

/// `EnableAutoDoh`: 0 off, 2 opportunistic (Win11 default), 3 required.
const ENABLE_AUTO_DOH_REQUIRED: u32 = 3;
/// Group policy `DoHPolicy`: 3 = require encrypted DNS, no UDP fallback.
const DOH_POLICY_REQUIRED: u32 = 3;
/// `DNS_DOH_SERVER_SETTINGS_ENABLE_AUTO`
const DNS_DOH_ENABLE_AUTO: u64 = 0x1;
/// `DNS_DOH_SERVER_SETTINGS_ENABLE`
const DNS_DOH_ENABLE: u64 = 0x2;
/// `DNS_DOH_SERVER_SETTINGS_FALLBACK_TO_UDP`
const DNS_DOH_FALLBACK_TO_UDP: u64 = 0x4;

/// True when Encrypted DNS is in a mode that can ignore adapter DNS.
pub fn overrides_adapter_dns(
    enable_auto_doh: Option<u32>,
    doh_policy: Option<u32>,
    forced_interface_doh: bool,
) -> bool {
    enable_auto_doh == Some(ENABLE_AUTO_DOH_REQUIRED)
        || doh_policy == Some(DOH_POLICY_REQUIRED)
        || forced_interface_doh
}

/// Settings UI "Encrypted only": DoH on, no UDP fallback.
pub fn interface_doh_flags_override_adapter(flags: u64) -> bool {
    flags & (DNS_DOH_ENABLE_AUTO | DNS_DOH_ENABLE) != 0 && flags & DNS_DOH_FALLBACK_TO_UDP == 0
}

#[cfg(windows)]
pub fn encrypted_dns_overrides_adapter() -> bool {
    overrides_adapter_dns(enable_auto_doh(), doh_policy(), forced_interface_doh())
}

#[cfg(not(windows))]
pub fn encrypted_dns_overrides_adapter() -> bool {
    false
}

#[cfg(windows)]
fn enable_auto_doh() -> Option<u32> {
    dword(
        r"SYSTEM\CurrentControlSet\Services\Dnscache\Parameters",
        "EnableAutoDoh",
    )
}

#[cfg(windows)]
fn doh_policy() -> Option<u32> {
    dword(
        r"SOFTWARE\Policies\Microsoft\Windows NT\DNSClient",
        "DoHPolicy",
    )
}

#[cfg(windows)]
fn forced_interface_doh() -> bool {
    use winreg::RegKey;
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};

    let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(root) = machine.open_subkey_with_flags(
        r"SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters",
        KEY_READ,
    ) else {
        return false;
    };
    for guid in root.enum_keys().filter_map(Result::ok).take(32) {
        let Ok(iface) = root.open_subkey_with_flags(&guid, KEY_READ) else {
            continue;
        };
        for family in ["DohInterfaceSettings\\Doh", "DohInterfaceSettings\\Doh6"] {
            let Ok(family_key) = iface.open_subkey_with_flags(family, KEY_READ) else {
                continue;
            };
            for server in family_key.enum_keys().filter_map(Result::ok).take(16) {
                let Ok(server_key) = family_key.open_subkey_with_flags(&server, KEY_READ) else {
                    continue;
                };
                let flags = qword_or_dword(&server_key, "DohFlags").unwrap_or(0);
                if interface_doh_flags_override_adapter(flags) {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(windows)]
fn qword_or_dword(key: &winreg::RegKey, name: &str) -> Option<u64> {
    key.get_value::<u64, _>(name)
        .ok()
        .or_else(|| key.get_value::<u32, _>(name).ok().map(u64::from))
}

#[cfg(windows)]
fn dword(subkey: &str, name: &str) -> Option<u32> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};

    let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = machine.open_subkey_with_flags(subkey, KEY_READ).ok()?;
    key.get_value(name).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_encrypted_dns_overrides_the_adapter() {
        assert!(overrides_adapter_dns(Some(3), None, false));
        assert!(overrides_adapter_dns(None, Some(3), false));
        assert!(overrides_adapter_dns(Some(2), None, true));
        assert!(!overrides_adapter_dns(Some(2), None, false));
        assert!(!overrides_adapter_dns(Some(0), None, false));
        assert!(!overrides_adapter_dns(None, None, false));
    }

    #[test]
    fn settings_encrypted_only_overrides_adapter_dns() {
        assert!(interface_doh_flags_override_adapter(DNS_DOH_ENABLE));
        assert!(interface_doh_flags_override_adapter(DNS_DOH_ENABLE_AUTO));
        assert!(!interface_doh_flags_override_adapter(
            DNS_DOH_ENABLE | DNS_DOH_FALLBACK_TO_UDP
        ));
        assert!(!interface_doh_flags_override_adapter(0));
    }
}
