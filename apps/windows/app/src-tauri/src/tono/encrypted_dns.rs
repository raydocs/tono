//! Windows Encrypted DNS (DoH) can override the adapter DNS Tono just wrote
//! (`198.18.0.2`). Fake-ip verification uses `DnsQueryEx`, which may still hit
//! the TUN resolver, while Chrome / Win11 "Encrypted only" talks DoH to a
//! public resolver that WFP then blocks. Connect looks up; pages do not.
//!
//! This module is read-only. It never changes DNS policy.

/// `EnableAutoDoh`: 0 off, 2 opportunistic (Win11 default), 3 required.
const ENABLE_AUTO_DOH_REQUIRED: u32 = 3;
/// Group policy `DoHPolicy`: 3 = require encrypted DNS, no UDP fallback.
const DOH_POLICY_REQUIRED: u32 = 3;

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
        r"SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecific",
        KEY_READ,
    ) else {
        return false;
    };
    for name in root.enum_keys().filter_map(Result::ok).take(32) {
        let Ok(iface) = root.open_subkey_with_flags(&name, KEY_READ) else {
            continue;
        };
        // Non-zero DohFlags means this adapter has Encrypted DNS configured.
        // Opportunistic (fallback to UDP) still answers fake-ip; "encrypted
        // only" does not, and that is the connected-but-no-pages case.
        let flags: u32 = iface.get_value("DohFlags").unwrap_or(0);
        if flags & 0x2 != 0 {
            return true;
        }
    }
    false
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
}
