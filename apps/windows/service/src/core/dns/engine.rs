use super::{
    AdapterDnsSnapshot, DnsSnapshot, is_active_dns_adapter, is_protected_v4_value,
    is_tono_dns_value,
};
use anyhow::{Context as _, Result, bail};
use std::ffi::CStr;
use windows_sys::Win32::Foundation::{
    ERROR_BUFFER_OVERFLOW, ERROR_FILE_NOT_FOUND, ERROR_INVALID_PARAMETER, ERROR_MORE_DATA,
    ERROR_NO_DATA, ERROR_NOT_FOUND, ERROR_NOT_SUPPORTED,
};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    DNS_INTERFACE_SETTINGS, DNS_INTERFACE_SETTINGS_VERSION1, DNS_SETTING_IPV6,
    DNS_SETTING_NAMESERVER, DNS_SETTING_PROFILE_NAMESERVER, FreeInterfaceDnsSettings,
    GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_FRIENDLY_NAME,
    GAA_FLAG_SKIP_MULTICAST, GetAdaptersAddresses, GetInterfaceDnsSettings,
    IP_ADAPTER_ADDRESSES_LH, SetInterfaceDnsSettings,
};
use windows_sys::core::GUID;
use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;
use windows_sys::Win32::System::Registry::{
    HKEY, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY, KEY_WRITE, REG_SZ, RegCloseKey,
    RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
};

const TCPIP4_INTERFACES: &str =
    r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces";
const TCPIP6_INTERFACES: &str =
    r"SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces";
/// The Network class key (fixed network-adapter class GUID) under which each interface's
/// `Connection` subkey holds the operator-visible connection `Name` — "Ethernet", "Tono".
const NETWORK_CONNECTIONS_CLASS: &str =
    r"SYSTEM\CurrentControlSet\Control\Network\{4D36E972-E325-11CE-BFC1-08002BE10318}";
const NAME_SERVER: &str = "NameServer";
const PROFILE_NAME_SERVER: &str = "ProfileNameServer";
const CONNECTION_NAME: &str = "Name";

struct RegKey(HKEY);

impl RegKey {
    fn open(subkey: &str, write: bool) -> Result<Option<Self>> {
        let wide = super_wide(subkey);
        let mut handle = std::ptr::null_mut();
        // SAFETY: valid NUL-terminated key path; `handle` is a valid out-pointer.
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                wide.as_ptr(),
                0,
                KEY_WOW64_64KEY | if write { KEY_WRITE } else { KEY_READ },
                &mut handle,
            )
        };
        match status {
            0 => Ok(Some(Self(handle))),
            ERROR_FILE_NOT_FOUND => Ok(None),
            _ => Err(std::io::Error::from_raw_os_error(status as i32))
                .with_context(|| format!("failed to open registry key {subkey}")),
        }
    }
}

impl Drop for RegKey {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful `RegOpenKeyExW` and closes once.
        unsafe { RegCloseKey(self.0) };
    }
}

fn super_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn read_sz(subkey: &str, value: &str) -> Result<Option<String>> {
    let Some(key) = RegKey::open(subkey, false)? else {
        return Ok(None);
    };
    let value_wide = super_wide(value);
    let mut size = 0_u32;
    // SAFETY: valid key handle and value name; null data pointer queries the size.
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            value_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if status != 0 && status != ERROR_MORE_DATA {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to size registry value {subkey}\\{value}"));
    }
    if size == 0 || size % 2 != 0 {
        return Ok(None);
    }
    let mut buffer = vec![0_u16; size as usize / 2];
    let mut actual = size;
    // SAFETY: `buffer` is `size` bytes of writable memory, as reported by the query.
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            value_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut actual,
        )
    };
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to read registry value {subkey}\\{value}"));
    }
    let used = actual as usize / 2;
    buffer.truncate(used);
    while buffer.last() == Some(&0) {
        buffer.pop();
    }
    Ok(Some(
        String::from_utf16(&buffer).context("registry DNS value is not valid UTF-16")?,
    ))
}

fn write_sz(subkey: &str, value: &str, data: &str) -> Result<()> {
    let Some(key) = RegKey::open(subkey, true)? else {
        bail!("registry key {subkey} does not exist");
    };
    let value_wide = super_wide(value);
    let wide = super_wide(data);
    // SAFETY: `wide` is a NUL-terminated UTF-16 buffer of `len * 2` bytes, alive here.
    let status = unsafe {
        RegSetValueExW(
            key.0,
            value_wide.as_ptr(),
            0,
            REG_SZ,
            wide.as_ptr().cast(),
            (wide.len() * 2) as u32,
        )
    };
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to write registry value {subkey}\\{value}"));
    }
    Ok(())
}

fn delete_value(subkey: &str, value: &str) -> Result<()> {
    let Some(key) = RegKey::open(subkey, true)? else {
        return Ok(());
    };
    let value_wide = super_wide(value);
    // SAFETY: valid key handle and value name.
    let status = unsafe { RegDeleteValueW(key.0, value_wide.as_ptr()) };
    if status != 0 && status != ERROR_FILE_NOT_FOUND {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to delete registry value {subkey}\\{value}"));
    }
    Ok(())
}

/// One adapter that can actually carry a resolver, with the interface indices its live
/// mechanisms are keyed by. The indices are re-read from IP Helper on every operation and
/// never persisted: they are not stable across reboots or adapter reinstalls.
#[derive(Debug, Clone)]
pub(super) struct ActiveAdapter {
    pub guid: String,
    /// Runtime interface identity. Unlike a GUID string or friendly name, this is the exact
    /// identity used by the WFP tunnel permit for the current core instance.
    pub luid: u64,
    /// IPv4 interface index, or 0 when IPv4 is not bound (nothing to apply or prove).
    pub ipv4_index: u32,
    /// IPv6 interface index, or 0 when IPv6 is not bound.
    pub ipv6_index: u32,
}

fn active_adapters() -> Result<Vec<ActiveAdapter>> {
    // `Parameters\Interfaces` is historical state, not a list of live adapters: it commonly
    // contains disabled, unplugged, removed, and pseudo interfaces. Those either have no
    // Win32_NetworkAdapterConfiguration object or return 84 (IP not enabled), which used to
    // make the whole DNS enable fail permanently. IP Helper gives the current cheap in-process
    // view and is also what the service's network-change monitor is built on.
    const INITIAL_BUFFER_BYTES: u32 = 15 * 1024;
    const MAX_BUFFER_ATTEMPTS: usize = 4;
    // Unicast addresses are *not* skipped any more: their presence is half of the
    // "IP is enabled on this adapter" test (`is_active_dns_adapter`), and the enumeration
    // stays a single cheap in-process call.
    let flags = GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER
        | GAA_FLAG_SKIP_FRIENDLY_NAME;
    let mut bytes = INITIAL_BUFFER_BYTES;
    for _ in 0..MAX_BUFFER_ATTEMPTS {
        let entries = (bytes as usize).div_ceil(std::mem::size_of::<IP_ADAPTER_ADDRESSES_LH>());
        // A vector of the actual structure gives the backing allocation the alignment required
        // by the linked records that `GetAdaptersAddresses` writes into the byte-sized buffer.
        let mut buffer = vec![IP_ADAPTER_ADDRESSES_LH::default(); entries.max(1)];
        // SAFETY: `buffer` is writable for at least `bytes` bytes and stays alive while the
        // returned linked list is traversed; the reserved pointer is required to be null.
        let status = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC as u32,
                flags,
                std::ptr::null(),
                buffer.as_mut_ptr(),
                &mut bytes,
            )
        };
        if status == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if status == ERROR_NO_DATA {
            return Ok(Vec::new());
        }
        if status != 0 {
            return Err(std::io::Error::from_raw_os_error(status as i32))
                .context("GetAdaptersAddresses failed while selecting DNS adapters");
        }

        let mut adapters: Vec<ActiveAdapter> = Vec::new();
        let mut current = buffer.as_ptr();
        while !current.is_null() {
            // SAFETY: `current` starts inside `buffer`; each `Next` pointer belongs to the same
            // successful `GetAdaptersAddresses` result and is valid until `buffer` is dropped.
            let adapter = unsafe { &*current };
            // SAFETY: the anonymous union's `IfIndex` member is always initialised by
            // `GetAdaptersAddresses`; reading a `u32` out of it is valid for any bit pattern.
            let ipv4_index = unsafe { adapter.Anonymous1.Anonymous.IfIndex };
            // SAFETY: `GetAdaptersAddresses` initializes the `NET_LUID_LH` union for every
            // returned adapter; reading its `u64` representation is valid for any bit pattern.
            let luid = unsafe { adapter.Luid.Value };
            let ipv6_index = adapter.Ipv6IfIndex;
            let has_bound_ip =
                !adapter.FirstUnicastAddress.is_null() && (ipv4_index != 0 || ipv6_index != 0);
            if is_active_dns_adapter(adapter.OperStatus, adapter.IfType, has_bound_ip)
                && !adapter.AdapterName.is_null()
            {
                // SAFETY: Windows documents AdapterName as a NUL-terminated ANSI adapter GUID.
                let guid = unsafe { CStr::from_ptr(adapter.AdapterName.cast()) }
                    .to_str()
                    .context("adapter GUID from GetAdaptersAddresses was not UTF-8")?;
                if !adapters
                    .iter()
                    .any(|saved| saved.guid.eq_ignore_ascii_case(guid))
                {
                    adapters.push(ActiveAdapter {
                        guid: guid.to_owned(),
                        luid,
                        ipv4_index,
                        ipv6_index,
                    });
                }
            }
            current = adapter.Next;
        }
        return Ok(adapters);
    }
    bail!("GetAdaptersAddresses size kept changing while selecting DNS adapters")
}

/// The active adapters keyed by upper-case GUID, the form every caller compares in.
fn active_adapter_map() -> Result<std::collections::BTreeMap<String, ActiveAdapter>> {
    Ok(active_adapters()?
        .into_iter()
        .map(|adapter| (adapter.guid.to_ascii_uppercase(), adapter))
        .collect())
}

fn v4_key(guid: &str) -> String {
    format!(r"{TCPIP4_INTERFACES}\{guid}")
}

fn v6_key(guid: &str) -> String {
    format!(r"{TCPIP6_INTERFACES}\{guid}")
}

/// The adapter's connection name from its Network-class `Connection` key. Best-effort: the
/// name is only the tunnel exclusion's core-independent fallback next to the WFP-validated
/// LUID, so an unreadable name must not fail the whole collect.
fn connection_name(guid: &str) -> Option<String> {
    match read_sz(
        &format!(r"{NETWORK_CONNECTIONS_CLASS}\{guid}\Connection"),
        CONNECTION_NAME,
    ) {
        Ok(name) => name,
        Err(error) => {
            tracing::warn!(
                "dns: failed to read the connection name for adapter {guid}: {error:#}"
            );
            None
        }
    }
}

fn read_adapter(guid: &str, interface_luid: Option<u64>) -> Result<AdapterDnsSnapshot> {
    Ok(AdapterDnsSnapshot {
        interface_guid: guid.to_owned(),
        interface_luid,
        connection_name: connection_name(guid),
        ipv4_name_server: read_sz(&v4_key(guid), NAME_SERVER)?,
        ipv4_profile_name_server: read_sz(&v4_key(guid), PROFILE_NAME_SERVER)?,
        ipv6_name_server: read_sz(&v6_key(guid), NAME_SERVER)?,
        ipv6_profile_name_server: read_sz(&v6_key(guid), PROFILE_NAME_SERVER)?,
        live_apply_failed: false,
    })
}

pub(super) fn collect_adapters() -> Result<Vec<AdapterDnsSnapshot>> {
    active_adapters()?
        .iter()
        .map(|adapter| read_adapter(&adapter.guid, Some(adapter.luid)))
        .collect()
}

/// Live application, **per address family**, through `iphlpapi` `SetInterfaceDnsSettings`.
/// The registry writes are the authoritative record this module verifies against; the live
/// apply is what makes the running resolver pick the change up without an interface bounce
/// and without spawning `powershell.exe` (AMSI/AV image-load is why protecting used to
/// take ~10 s or fail closed on Home/China machines).
///
/// Each family is a separate call (`DNS_SETTING_IPV6` for IPv6). A family with interface
/// index 0, or `ERROR_NOT_FOUND` / `ERROR_FILE_NOT_FOUND` / `ERROR_NOT_SUPPORTED`, is a
/// non-participant — there is no resolver on it to leak. Proof uses
/// [`super::live_family_matches`] against `GetInterfaceDnsSettings`.
struct LiveApplyEntry {
    guid: String,
    /// Live IPv4/IPv6 interface indices; 0 means the family is not bound here.
    ipv4_index: u32,
    ipv6_index: u32,
    /// `None` restores DHCP for that family (CIM `$null` / `netsh … source=dhcp`);
    /// `Some(empty)` is a *static* list with no servers at all (`netsh … source=static
    /// address=none`), which is the protected IPv6 state. The two are not interchangeable:
    /// DHCP would put the ISP's resolvers back.
    ipv4_servers: Option<Vec<String>>,
    ipv6_servers: Option<Vec<String>>,
}

/// What the live read-back has to prove.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ApplyMode {
    /// Protecting: the family's live list must be *exactly* what was applied — the TUN DNS
    /// address for IPv4, and nothing at all for IPv6.
    Protect,
    /// Restoring: the family's live list must no longer contain a Tono-owned address that
    /// was not itself part of the user's saved resolver list.
    /// Exact equality is the registry's job (`restore_is_proven`), and DHCP may legitimately
    /// return the saved servers in another order or with an extra suffix server.
    ///
    /// An IPv6 family that comes back *empty* is deliberately not a failure here: a network
    /// that supplies no DHCPv6 resolvers legitimately reads that way, and an empty list
    /// strands nobody — only an IPv4 resolver still pointed at a stopped core can do that.
    /// Exactness for IPv6 is enforced where it is unambiguous: the registry read-back.
    Restore,
}

fn remaining(deadline: std::time::Instant) -> std::time::Duration {
    deadline.saturating_duration_since(std::time::Instant::now())
}

/// Owns a child until it is proven gone. Every `?`/`bail!` in [`run_with_timeout`] passes
/// through this drop, so no error path can orphan a powershell.exe that nobody waits on.
struct ChildGuard(std::process::Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        // Both calls are no-ops on a child that already exited and was reaped.
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// `CreateProcess` is itself the most common hang on a locked-down machine: creating
/// powershell.exe traverses every minifilter and runs every AMSI/AV image-load callback,
/// none of which this process controls. So the spawn happens on a throwaway thread and is
/// handed over through a *rendezvous* channel: if the caller has already reached the
/// deadline, the hand-over finds no receiver, fails, and the worker kills the process it
/// just created instead of leaving it behind. A spawn that never returns leaks only that
/// thread — never the caller, and never a stray child.
fn spawn_before_deadline(
    program: &str,
    args: &[&str],
    deadline: std::time::Instant,
) -> Result<std::process::Child> {
    let spawn_program = program.to_owned();
    let spawn_args = args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>();
    let (sender, receiver) = std::sync::mpsc::sync_channel::<Result<std::process::Child>>(0);
    std::thread::spawn(move || {
        let spawned = std::process::Command::new(&spawn_program)
            .args(&spawn_args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .with_context(|| format!("failed to start {spawn_program}"));
        if let Err(std::sync::mpsc::SendError(Ok(mut child))) = sender.send(spawned) {
            let _ = child.kill();
            let _ = child.wait();
        }
    });
    match receiver.recv_timeout(remaining(deadline)) {
        Ok(spawned) => spawned,
        Err(_) => bail!(
            "{program} could not be started within the deadline; process creation is still \
             inside the loader (minifilter/AMSI/AV) and the process, if it ever appears, is \
             killed by the spawning thread"
        ),
    }
}

/// Read one pipe to EOF on its own thread. EOF is *not* the same event as process exit: a
/// grandchild (a WMI/CIM helper, an injected AV shim) that inherited the write handle keeps
/// the pipe open after the child is gone, so this read may never finish and must never be
/// awaited without a deadline. Draining both pipes from the start also removes the reverse
/// deadlock, where a child blocks writing into a full pipe while we wait for its exit.
fn read_pipe<R: std::io::Read + Send + 'static>(
    pipe: Option<R>,
) -> std::sync::mpsc::Receiver<Vec<u8>> {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut buffer);
        }
        let _ = sender.send(buffer);
    });
    receiver
}

/// Spawn a process and collect stdout under one hard deadline that covers *process
/// creation, the run, and the output read* — the three separate ways this can block.
/// A child that outlives the deadline is killed, and incomplete output is an error, never
/// an empty result: the batch script reports its failures *on stdout*, so treating an
/// unfinished read as "no failures" would report an unproven live-apply as proven.
/// Nothing here may ever park the facade's DNS operation lock on a hung PowerShell.
fn run_with_timeout(
    program: &str,
    args: &[&str],
    timeout: std::time::Duration,
) -> Result<String> {
    let deadline = std::time::Instant::now() + timeout;
    let mut child = ChildGuard(spawn_before_deadline(program, args, deadline)?);
    let stdout = read_pipe(child.0.stdout.take());
    let stderr = read_pipe(child.0.stderr.take());
    let status = loop {
        // A `?` here would drop the guard, which kills the child rather than orphaning it.
        let waited = child
            .0
            .try_wait()
            .with_context(|| format!("failed to wait for {program}"))?;
        match waited {
            Some(status) => break status,
            None if std::time::Instant::now() >= deadline => {
                bail!("{program} timed out after {timeout:?} and was killed");
            }
            None => std::thread::sleep(std::time::Duration::from_millis(25)),
        }
    };
    let Ok(stdout) = stdout.recv_timeout(remaining(deadline)) else {
        bail!(
            "{program} exited but its output pipe stayed open past the {timeout:?} deadline \
             (a grandchild still holds the write handle); the result is treated as failed"
        );
    };
    if !status.success() {
        let stderr = stderr.recv_timeout(remaining(deadline)).unwrap_or_default();
        bail!(
            "{program} exited {status}: {}",
            String::from_utf8_lossy(&stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&stdout).into_owned())
}

fn family_is_non_participant(status: u32) -> bool {
    matches!(
        status,
        ERROR_FILE_NOT_FOUND | ERROR_NOT_FOUND | ERROR_NOT_SUPPORTED | ERROR_INVALID_PARAMETER
    )
}

fn parse_interface_guid(guid: &str) -> Result<GUID> {
    let hex: String = guid.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 32 {
        bail!("adapter GUID {guid} is not a Windows GUID");
    }
    let n = u128::from_str_radix(&hex, 16)
        .with_context(|| format!("adapter GUID {guid} is not hex"))?;
    Ok(GUID::from_u128(n))
}

fn pwstr_list(ptr: windows_sys::core::PWSTR) -> Vec<String> {
    if ptr.is_null() {
        return Vec::new();
    }
    // SAFETY: `GetInterfaceDnsSettings` documents NameServer as a NUL-terminated
    // comma-separated UTF-16 list owned by the settings struct until Free.
    let wide = unsafe { std::slice::from_raw_parts(ptr, libc_wcslen(ptr)) };
    let raw = String::from_utf16_lossy(wide);
    super::parse_name_server_list(&raw)
}

fn libc_wcslen(ptr: windows_sys::core::PWSTR) -> usize {
    let mut n = 0;
    // SAFETY: caller guarantees a NUL-terminated PWSTR.
    unsafe {
        while *ptr.add(n) != 0 {
            n += 1;
        }
    }
    n
}

fn set_family_dns(interface: GUID, ipv6: bool, servers: &Option<Vec<String>>) -> Result<()> {
    let joined = servers
        .as_ref()
        .map(|list| list.join(","))
        .unwrap_or_default();
    let mut name = super_wide(&joined);
    let mut profile = name.clone();
    let settings = DNS_INTERFACE_SETTINGS {
        Version: DNS_INTERFACE_SETTINGS_VERSION1,
        Flags: u64::from(DNS_SETTING_NAMESERVER)
            | u64::from(DNS_SETTING_PROFILE_NAMESERVER)
            | if ipv6 { u64::from(DNS_SETTING_IPV6) } else { 0 },
        NameServer: name.as_mut_ptr(),
        ProfileNameServer: profile.as_mut_ptr(),
        ..Default::default()
    };
    // SAFETY: `settings` pointers alias live NUL-terminated buffers for the call.
    let status = unsafe { SetInterfaceDnsSettings(interface, &settings) };
    if status == 0 || family_is_non_participant(status) {
        return Ok(());
    }
    Err(std::io::Error::from_raw_os_error(status as i32))
        .with_context(|| format!("SetInterfaceDnsSettings failed (ipv6={ipv6})"))
}

fn get_family_dns(interface: GUID, ipv6: bool) -> Result<Option<Vec<String>>> {
    let mut settings = DNS_INTERFACE_SETTINGS {
        Version: DNS_INTERFACE_SETTINGS_VERSION1,
        Flags: u64::from(DNS_SETTING_NAMESERVER)
            | u64::from(DNS_SETTING_PROFILE_NAMESERVER)
            | if ipv6 { u64::from(DNS_SETTING_IPV6) } else { 0 },
        ..Default::default()
    };
    // SAFETY: Version is set; Windows fills and owns string pointers until Free.
    let status = unsafe { GetInterfaceDnsSettings(interface, &mut settings) };
    if family_is_non_participant(status) {
        return Ok(None);
    }
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .context("GetInterfaceDnsSettings failed");
    }
    let profile = pwstr_list(settings.ProfileNameServer);
    let servers = if profile.is_empty() { pwstr_list(settings.NameServer) } else { profile };
    // SAFETY: `settings` came from a successful GetInterfaceDnsSettings.
    unsafe { FreeInterfaceDnsSettings(&mut settings) };
    Ok(Some(servers))
}

fn apply_and_prove_family(
    interface: GUID,
    ipv6: bool,
    index: u32,
    want: &Option<Vec<String>>,
    mode: ApplyMode,
    owned: &[&str],
) -> Result<()> {
    if index == 0 {
        return Ok(());
    }
    set_family_dns(interface, ipv6, want)?;
    let have = get_family_dns(interface, ipv6)?;
    if super::live_family_matches(
        index,
        have.as_deref(),
        want.as_deref(),
        mode == ApplyMode::Restore,
        owned,
    ) {
        Ok(())
    } else {
        bail!(
            "live DNS read-back did not match the applied {} list",
            if ipv6 { "IPv6" } else { "IPv4" }
        )
    }
}

fn live_apply_entry(entry: &LiveApplyEntry, mode: ApplyMode) -> bool {
    let interface = match parse_interface_guid(&entry.guid) {
        Ok(guid) => guid,
        Err(error) => {
            tracing::warn!("dns: {error:#}");
            return false;
        }
    };
    let v4 = apply_and_prove_family(
        interface,
        false,
        entry.ipv4_index,
        &entry.ipv4_servers,
        mode,
        &[super::PROTECTED_DNS_V4, "127.0.0.1"],
    );
    let v6 = apply_and_prove_family(
        interface,
        true,
        entry.ipv6_index,
        &entry.ipv6_servers,
        mode,
        &["::1"],
    );
    match (v4, v6) {
        (Ok(()), Ok(())) => true,
        (Err(error), _) | (_, Err(error)) => {
            tracing::warn!("dns: live apply failed for {}: {error:#}", entry.guid);
            false
        }
    }
}

fn live_apply_batch(entries: &[LiveApplyEntry], mode: ApplyMode) -> Vec<(String, bool)> {
    entries
        .iter()
        .map(|entry| (entry.guid.clone(), live_apply_entry(entry, mode)))
        .collect()
}

/// One batch, then one batched retry for the failures (aligned with the previous
/// per-adapter retry semantics, without paying a PowerShell cold start per adapter).
fn live_apply_with_retry(entries: Vec<LiveApplyEntry>, mode: ApplyMode) -> Vec<(String, bool)> {
    let first = live_apply_batch(&entries, mode);
    let failed: std::collections::BTreeSet<String> = first
        .iter()
        .filter(|(_, ok)| !ok)
        .map(|(guid, _)| guid.clone())
        .collect();
    if failed.is_empty() {
        return first;
    }
    let retry_entries: Vec<LiveApplyEntry> = entries
        .into_iter()
        .filter(|entry| failed.contains(&entry.guid))
        .collect();
    let retried = live_apply_batch(&retry_entries, mode);
    first
        .into_iter()
        .map(|(guid, ok)| {
            let ok = ok
                || retried
                    .iter()
                    .any(|(retry_guid, retry_ok)| *retry_ok && *retry_guid == guid);
            (guid, ok)
        })
        .collect()
}

/// Flush the resolver cache after a restore. Fake-ip (198.18/16) answers and negative
/// cache entries served while DNS pointed at the loopback core are the classic post-
/// disconnect pollution; without a flush, restored resolvers keep them until TTL expiry.
pub(super) fn flush_resolver_cache() -> Result<()> {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    // DnsFlushResolverCache (Vista+) is exported by dnsapi.dll but is not in
    // any SDK import library — it must be resolved at runtime (the same
    // approach Mullvad's winfw takes).
    type FlushFn = unsafe extern "system" fn() -> i32;
    let module_name: Vec<u16> = "dnsapi.dll\0".encode_utf16().collect();
    // SAFETY: null-terminated wide literal; the handle is validity-checked
    // before use and the module stays loaded for the process lifetime.
    let module = unsafe { LoadLibraryW(module_name.as_ptr()) };
    if !module.is_null() {
        // SAFETY: live module handle; null-terminated ANSI name literal.
        let proc = unsafe { GetProcAddress(module, c"DnsFlushResolverCache".as_ptr() as _) };
        if let Some(proc) = proc {
            let flush: FlushFn = unsafe { std::mem::transmute(proc) };
            // SAFETY: no inputs; the signature matches the documented ABI.
            if unsafe { flush() } != 0 {
                return Ok(());
            }
        }
    }
    run_with_timeout(
        "ipconfig.exe",
        &["/flushdns"],
        std::time::Duration::from_secs(5),
    )
    .map(|_| ())
    .context("DnsFlushResolverCache failed and ipconfig /flushdns did not succeed either")
}

/// Whether the adapter's per-family registry subkey exists. Single-stack adapters lack one
/// family entirely; both apply and verify must skip the absent family instead of failing.
fn key_exists(subkey: &str) -> Result<bool> {
    Ok(RegKey::open(subkey, false)?.is_some())
}

/// `guid` is the caller's spelling — per-adapter results are matched back against the
/// snapshot by exact string — while `active` only supplies the live interface indices.
fn apply_protected(guid: &str, active: &ActiveAdapter) -> Result<LiveApplyEntry> {
    if key_exists(&v4_key(guid))? {
        write_sz(&v4_key(guid), NAME_SERVER, super::PROTECTED_DNS_V4)?;
        write_sz(&v4_key(guid), PROFILE_NAME_SERVER, super::PROTECTED_DNS_V4)?;
    }
    if key_exists(&v6_key(guid))? {
        // Empty, not `::1`: an adapter pointed at `::1` has a configured IPv6 resolver that
        // never answers and every system
        // lookup pays the full OS timeout before falling back — the `securingDNS` failure
        // this replaced. Empty is also not the same as *deleting* the value: deletion means
        // DHCP, which would hand the ISP's IPv6 resolvers back and would be a real leak.
        // With no IPv6 servers Windows uses the IPv4 TUN resolver, which answers.
        write_sz(&v6_key(guid), NAME_SERVER, super::NO_NAME_SERVERS)?;
        write_sz(&v6_key(guid), PROFILE_NAME_SERVER, super::NO_NAME_SERVERS)?;
    }
    Ok(LiveApplyEntry {
        guid: guid.to_owned(),
        ipv4_index: active.ipv4_index,
        ipv6_index: active.ipv6_index,
        // One family per list: the IPv4 mechanism never sees an IPv6 address and the IPv6
        // mechanism never sees the IPv4 TUN endpoint, and each is proven on its own family.
        ipv4_servers: Some(vec![super::PROTECTED_DNS_V4.to_owned()]),
        // `Some(empty)` = a static list with no servers; `None` would mean DHCP.
        ipv6_servers: Some(Vec::new()),
    })
}

pub(super) fn apply_protected_set(guids: &[String]) -> Result<Vec<(String, bool)>> {
    let active = active_adapter_map()?;
    // An adapter that is no longer active has no live resolver to point anywhere.
    let mut results = guids
        .iter()
        .filter(|guid| !active.contains_key(&guid.to_ascii_uppercase()))
        .map(|guid| (guid.clone(), true))
        .collect::<Vec<_>>();
    let mut entries = Vec::new();
    for guid in guids {
        let Some(adapter) = active.get(&guid.to_ascii_uppercase()) else { continue; };
        // A delta replay touches only changed/unproven adapters. Reuse requires
        // fresh native readback of BOTH families, never a saved success flag.
        if protected_adapter_is_live(guid, adapter).unwrap_or(false) {
            results.push((guid.clone(), true));
        } else {
            entries.push(apply_protected(guid, adapter)?);
        }
    }
    tracing::debug!(requested = guids.len(), rewritten = entries.len(), "dns: native-proof delta replay");
    results.extend(live_apply_with_retry(entries, ApplyMode::Protect));
    Ok(results)
}

fn restore_value(subkey: &str, value: &str, saved: &Option<String>) -> Result<()> {
    match saved {
        Some(data) => write_sz(subkey, value, data),
        None => delete_value(subkey, value),
    }
}

fn restore_entry(adapter: &AdapterDnsSnapshot, active: &ActiveAdapter) -> LiveApplyEntry {
    LiveApplyEntry {
        guid: adapter.interface_guid.clone(),
        ipv4_index: active.ipv4_index,
        ipv6_index: active.ipv6_index,
        ipv4_servers: super::restored_live_servers_v4(adapter),
        ipv6_servers: super::restored_live_servers_v6(adapter),
    }
}

pub(super) fn apply_snapshot(snapshot: &DnsSnapshot) -> Result<Vec<(String, bool)>> {
    let active = active_adapter_map()?;
    let mut live_results = snapshot
        .adapters
        .iter()
        .filter(|adapter| !active.contains_key(&adapter.interface_guid.to_ascii_uppercase()))
        .map(|adapter| (adapter.interface_guid.clone(), true))
        .collect::<Vec<_>>();
    let entries = snapshot
        .adapters
        .iter()
        .filter_map(|adapter| {
            active
                .get(&adapter.interface_guid.to_ascii_uppercase())
                .map(|live| restore_entry(adapter, live))
        })
        .collect::<Vec<_>>();
    // The live apply first makes the running resolver adopt the saved per-family list. Both
    // mechanisms rewrite `NameServer` while doing so, therefore restore all four exact
    // registry values afterwards; the facade's read-back proof then checks those originals
    // rather than the normalized representation CIM or netsh leaves behind.
    live_results.extend(live_apply_with_retry(entries, ApplyMode::Restore));
    for adapter in &snapshot.adapters {
        let guid = &adapter.interface_guid;
        if key_exists(&v4_key(guid))? {
            restore_value(&v4_key(guid), NAME_SERVER, &adapter.ipv4_name_server)?;
            restore_value(
                &v4_key(guid),
                PROFILE_NAME_SERVER,
                &adapter.ipv4_profile_name_server,
            )?;
        }
        if key_exists(&v6_key(guid))? {
            restore_value(&v6_key(guid), NAME_SERVER, &adapter.ipv6_name_server)?;
            restore_value(
                &v6_key(guid),
                PROFILE_NAME_SERVER,
                &adapter.ipv6_profile_name_server,
            )?;
        }
    }
    Ok(live_results)
}

/// Whether *any* adapter still points at a Tono-owned resolver — the mirror image of
/// [`all_loopback`], and the only evidence the snapshot-less recovery path has. Deliberately
/// checks every value of both families: one leftover `ProfileNameServer` is enough to leave
/// the machine resolving through a core that is no longer running.
pub(super) fn any_loopback(guids: &[String]) -> Result<bool> {
    for guid in guids {
        let adapter = read_adapter(guid, None)?;
        if super::adapter_reads_as_tono_dns(&adapter) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether every adapter is in the protected state. The two families do not answer the same
/// question: IPv4 must be on the TUN resolver, while IPv6 must have **no servers at
/// all** — that is what the protect path writes, and reading it as drift would have the
/// watchdog rewrite the registry every two seconds for ever.
fn protected_adapter_is_live(guid: &str, active: &ActiveAdapter) -> Result<bool> {
    let adapter = read_adapter(guid, None)?;
    if active.ipv4_index != 0
        && (!is_protected_v4_value(adapter.ipv4_name_server.as_deref())
            || (adapter.ipv4_profile_name_server.is_some()
                && !is_protected_v4_value(adapter.ipv4_profile_name_server.as_deref())))
    {
        return Ok(false);
    }
    let interface = parse_interface_guid(guid)?;
    let expected_v4 = vec![super::PROTECTED_DNS_V4.to_owned()];
    for (ipv6, index, want) in [
        (false, active.ipv4_index, expected_v4.as_slice()),
        (true, active.ipv6_index, &[][..]),
    ] {
        if index == 0 { continue; }
        let have = get_family_dns(interface, ipv6)?;
        if !super::live_family_matches(index, have.as_deref(), Some(want), false, &[]) {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn all_loopback(guids: &[String]) -> Result<bool> {
    let active = active_adapter_map()?;
    for guid in guids {
        if let Some(adapter) = active.get(&guid.to_ascii_uppercase())
            && !protected_adapter_is_live(guid, adapter)?
        {
            return Ok(false);
        }
    }
    Ok(true)
}
