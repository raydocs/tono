//! Protected-DNS apply only. Restore/DHCP remains in `engine::apply_snapshot`.
//!
//! ABI/flags: https://learn.microsoft.com/windows/win32/api/netioapi/nf-netioapi-setinterfacednssettings
//! https://learn.microsoft.com/windows/win32/api/netioapi/ns-netioapi-dns_interface_settings
//! Like WireGuard's tunnel/winipcfg SetDNS, resolve the optional system export instead of
//! guessing an OS version. Unlike a setter-only check, require effective IP Helper read-back.
//! An empty IPv6 string is NOT evidence of DHCP reset or static-empty semantics: only an
//! observed empty IPv6 resolver list confirms this protected apply, never a restore.

use super::{ActiveAdapter, ApplyMode, LiveApplyEntry};
use anyhow::{Context as _, Result, bail, ensure};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use windows_sys::Win32::Foundation::{FreeLibrary, HMODULE};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    DNS_INTERFACE_SETTINGS, DNS_INTERFACE_SETTINGS_VERSION1, DNS_SETTING_IPV6,
    DNS_SETTING_NAMESERVER, IP_ADAPTER_DNS_SERVER_ADDRESS_XP,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6, SOCKADDR_IN, SOCKADDR_IN6};
use windows_sys::Win32::System::LibraryLoader::{
    GetProcAddress, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW,
};
use windows_sys::core::GUID;

// The GUID is BY VALUE; WIN32_ERROR is u32 (not an HRESULT or a pointer-sized return).
type SetInterfaceDnsSettings =
    unsafe extern "system" fn(GUID, *const DNS_INTERFACE_SETTINGS) -> u32;

struct NativeApi {
    module: HMODULE,
    set: SetInterfaceDnsSettings,
}

impl NativeApi {
    fn load() -> Result<Self> {
        let name = super::super_wide("iphlpapi.dll");
        // SAFETY: NUL-terminated literal and restricted system DLL search, no App path.
        let module = unsafe {
            LoadLibraryExW(
                name.as_ptr(),
                std::ptr::null_mut(),
                LOAD_LIBRARY_SEARCH_SYSTEM32,
            )
        };
        ensure!(
            !module.is_null(),
            "load system iphlpapi.dll: {}",
            std::io::Error::last_os_error()
        );
        // SAFETY: live module and NUL-terminated export name.
        let proc = unsafe { GetProcAddress(module, c"SetInterfaceDnsSettings".as_ptr().cast()) };
        let Some(proc) = proc else {
            // SAFETY: this function owns the reference, and no function pointer escaped.
            unsafe { FreeLibrary(module) };
            bail!("SetInterfaceDnsSettings export unavailable");
        };
        // SAFETY: exact documented system ABI; the module lives through all calls.
        let set: SetInterfaceDnsSettings = unsafe { std::mem::transmute(proc) };
        Ok(Self { module, set })
    }

    fn apply(&self, entry: &LiveApplyEntry) -> Result<()> {
        apply_native(entry, |guid, settings| {
            // SAFETY: apply_native owns the V1 struct and its borrowed UTF-16 buffer
            // for the entire synchronous call. No pointer is retained by this module.
            unsafe { (self.set)(guid, settings) }
        })
    }
}

impl Drop for NativeApi {
    fn drop(&mut self) {
        // SAFETY: our loader reference is released only after synchronous calls finish.
        unsafe { FreeLibrary(self.module) };
    }
}

fn interface_guid(value: &str) -> Result<GUID> {
    let value = value
        .strip_prefix('{')
        .and_then(|s| s.strip_suffix('}'))
        .unwrap_or(value);
    ensure!(
        value.len() == 36
            && value.bytes().enumerate().all(|(i, b)| {
                if matches!(i, 8 | 13 | 18 | 23) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            }),
        "invalid adapter GUID {value}"
    );
    Ok(GUID::from_u128(u128::from_str_radix(
        &value.replace('-', ""),
        16,
    )?))
}

/// The injected call is exactly the native ABI boundary, not a replacement state machine.
fn apply_native(
    entry: &LiveApplyEntry,
    mut set: impl FnMut(GUID, &DNS_INTERFACE_SETTINGS) -> u32,
) -> Result<()> {
    // No caller can accidentally use an empty native string as the DHCP restore mechanism.
    ensure!(
        matches!(entry.ipv4_servers.as_deref(), Some([server]) if server == super::super::PROTECTED_DNS_V4)
            && entry.ipv6_servers.as_ref().is_some_and(Vec::is_empty),
        "native DNS is protected-apply only"
    );
    let guid = interface_guid(&entry.guid)?;
    for (index, ipv6, servers) in [
        (entry.ipv4_index, false, &entry.ipv4_servers),
        (entry.ipv6_index, true, &entry.ipv6_servers),
    ] {
        if index == 0 {
            continue;
        }
        let mut names =
            super::super_wide(&servers.as_ref().context("no static DNS list")?.join(","));
        let settings = DNS_INTERFACE_SETTINGS {
            Version: DNS_INTERFACE_SETTINGS_VERSION1,
            Flags: u64::from(DNS_SETTING_NAMESERVER | if ipv6 { DNS_SETTING_IPV6 } else { 0 }),
            NameServer: names.as_mut_ptr(),
            ..Default::default()
        };
        let status = set(guid, &settings);
        if status != 0 {
            return Err(std::io::Error::from_raw_os_error(status as i32)).with_context(|| {
                format!(
                    "SetInterfaceDnsSettings {} IPv{}",
                    entry.guid,
                    if ipv6 { 6 } else { 4 }
                )
            });
        }
    }
    Ok(())
}

/// Copy effective resolver addresses while the successful GetAdaptersAddresses buffer lives.
///
/// # Safety
/// Each record/socket pointer must refer to a live IP Helper result (or equivalent test
/// allocation). Bad family/length is an error, never an omitted resolver that could fake empty.
pub(super) unsafe fn read_dns_servers(
    mut current: *mut IP_ADAPTER_DNS_SERVER_ADDRESS_XP,
) -> Result<Vec<IpAddr>> {
    let mut servers = Vec::new();
    while !current.is_null() {
        // SAFETY: caller owns the linked records and socket backing storage.
        let record = unsafe { &*current };
        let socket = record.Address;
        ensure!(
            !socket.lpSockaddr.is_null() && socket.iSockaddrLength >= 2,
            "invalid DNS socket address"
        );
        // SAFETY: at least the family field is readable; do not assume struct alignment.
        let family = unsafe { socket.lpSockaddr.cast::<u16>().read_unaligned() };
        let server = match family {
            AF_INET => {
                ensure!(
                    socket.iSockaddrLength as usize >= std::mem::size_of::<SOCKADDR_IN>(),
                    "short IPv4 DNS address"
                );
                // SAFETY: family and length checked; union bytes are in network order.
                let bytes = unsafe {
                    socket
                        .lpSockaddr
                        .cast::<SOCKADDR_IN>()
                        .read_unaligned()
                        .sin_addr
                        .S_un
                        .S_un_b
                };
                IpAddr::V4(Ipv4Addr::new(
                    bytes.s_b1, bytes.s_b2, bytes.s_b3, bytes.s_b4,
                ))
            }
            AF_INET6 => {
                ensure!(
                    socket.iSockaddrLength as usize >= std::mem::size_of::<SOCKADDR_IN6>(),
                    "short IPv6 DNS address"
                );
                // SAFETY: family and length checked. Any scoped IPv6 resolver still counts
                // as nonempty; protected apply must not leave even a link-local DNS server.
                let bytes = unsafe {
                    socket
                        .lpSockaddr
                        .cast::<SOCKADDR_IN6>()
                        .read_unaligned()
                        .sin6_addr
                        .u
                        .Byte
                };
                IpAddr::V6(Ipv6Addr::from(bytes))
            }
            _ => bail!("unknown DNS address family {family}"),
        };
        servers.push(server);
        current = record.Next;
    }
    Ok(servers)
}

fn confirms(entry: &LiveApplyEntry, adapter: &ActiveAdapter) -> bool {
    if !entry.guid.eq_ignore_ascii_case(&adapter.guid)
        || entry.luid != adapter.luid
        || entry.ipv4_index != adapter.ipv4_index
        || entry.ipv6_index != adapter.ipv6_index
    {
        return false;
    }
    let Some(servers) = &adapter.dns_servers else {
        return false;
    };
    [
        (entry.ipv4_index, false, &entry.ipv4_servers),
        (entry.ipv6_index, true, &entry.ipv6_servers),
    ]
    .into_iter()
    .all(|(index, ipv6, wanted)| {
        let have: Vec<IpAddr> = servers
            .iter()
            .copied()
            .filter(|ip| ip.is_ipv6() == ipv6)
            .collect();
        if index == 0 {
            return have.is_empty();
        }
        let Some(wanted) = wanted else {
            return false;
        };
        let Ok(wanted) = wanted
            .iter()
            .map(|s| s.parse::<IpAddr>())
            .collect::<Result<Vec<_>, _>>()
        else {
            return false;
        };
        have == wanted
    })
}

fn verify(
    entries: &[LiveApplyEntry],
    applied: Vec<bool>,
    readback: Result<Vec<ActiveAdapter>>,
    path: &str,
) -> Vec<bool> {
    let adapters = match readback {
        Ok(adapters) => adapters,
        Err(error) => {
            tracing::warn!("dns: {path} effective read-back unavailable: {error:#}");
            return vec![false; entries.len()];
        }
    };
    entries
        .iter()
        .zip(applied)
        .map(|(entry, applied)| {
            if !applied {
                return false;
            }
            let verified = adapters.iter().any(|adapter| confirms(entry, adapter));
            if !verified {
                tracing::warn!(
                    "dns: {path} effective read-back contradicted/unavailable for {}",
                    entry.guid
                );
            }
            verified
        })
        .collect()
}

/// Synchronous orchestration INSIDE the facade's bounded_dns_call claim. Nothing spawns a
/// competing writer or starts fallback on a timeout. If a native call hangs, this function
/// cannot reach read-back/fallback until it returns; the claim outlives its waiting caller.
fn apply_with(
    entries: &[LiveApplyEntry],
    native: Option<impl FnMut(&LiveApplyEntry) -> Result<()>>,
    mut readback: impl FnMut() -> Result<Vec<ActiveAdapter>>,
    legacy: impl FnOnce(&[LiveApplyEntry]) -> Vec<(String, bool)>,
) -> Vec<(String, bool)> {
    let started = std::time::Instant::now();
    let applied = match native {
        Some(mut native) => entries
            .iter()
            .map(|entry| match native(entry) {
                Ok(()) => true,
                Err(error) => {
                    tracing::warn!("dns: native protected apply completed with error: {error:#}");
                    false
                }
            })
            .collect::<Vec<_>>(),
        None => vec![false; entries.len()],
    };
    let mut verified = if applied.iter().any(|ok| *ok) {
        verify(entries, applied, readback(), "native")
    } else {
        applied
    };
    let fallback_entries: Vec<_> = entries
        .iter()
        .zip(&verified)
        .filter(|(_, ok)| !**ok)
        .map(|(entry, _)| entry.clone())
        .collect();
    if !fallback_entries.is_empty() {
        tracing::warn!(
            "dns: protected apply bounded compatibility batch for {} adapter(s) after native unavailable/error/unproven; native_elapsed_ms={}",
            fallback_entries.len(),
            started.elapsed().as_millis()
        );
        // Exactly one existing bounded PowerShell/CIM/netsh batch, not its retry wrapper.
        let legacy_results = legacy(&fallback_entries);
        let applied = entries
            .iter()
            .zip(&verified)
            .map(|(entry, native_verified)| {
                *native_verified
                    || legacy_results
                        .iter()
                        .any(|(guid, ok)| *ok && *guid == entry.guid)
            })
            .collect();
        // Re-read ALL adapters after the last mutation. A previously verified native
        // result cannot mask an adapter replacement/change during the compatibility batch.
        verified = verify(entries, applied, readback(), "compatibility");
    }
    tracing::info!(
        "dns: protected apply path={} adapters={} compatibility_adapters={} unverified={} elapsed_ms={}",
        if fallback_entries.is_empty() {
            "native"
        } else {
            "compatibility"
        },
        entries.len(),
        fallback_entries.len(),
        verified.iter().filter(|ok| !**ok).count(),
        started.elapsed().as_millis()
    );
    entries
        .iter()
        .zip(verified)
        .map(|(entry, ok)| (entry.guid.clone(), ok))
        .collect()
}

pub(super) fn apply(entries: &[LiveApplyEntry]) -> Vec<(String, bool)> {
    if entries.is_empty() {
        return Vec::new();
    }
    let api = match NativeApi::load() {
        Ok(api) => Some(api),
        Err(error) => {
            tracing::warn!(
                "dns: native protected apply unavailable; bounded compatibility required: {error:#}"
            );
            None
        }
    };
    apply_with(
        entries,
        api.as_ref()
            .map(|api| move |entry: &LiveApplyEntry| api.apply(entry)),
        || super::active_adapters_read(true),
        |entries| super::live_apply_batch(entries, ApplyMode::Protect),
    )
}

#[cfg(test)]
#[path = "native_apply_tests.rs"]
mod tests;
