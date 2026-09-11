use super::{
    AdapterDnsSnapshot, DnsSnapshot, is_active_dns_adapter, is_protected_v4_value,
    is_tono_dns_value,
};
use anyhow::{Context as _, Result, bail};
use std::ffi::CStr;
use windows_sys::Win32::Foundation::{
    ERROR_BUFFER_OVERFLOW, ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_NO_DATA,
};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_FRIENDLY_NAME,
    GAA_FLAG_SKIP_MULTICAST, GetAdaptersAddresses, IP_ADAPTER_ADDRESSES_LH,
};
use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;
use windows_sys::Win32::System::Registry::{
    HKEY, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY, KEY_WRITE, REG_DWORD, REG_MULTI_SZ,
    REG_QWORD, REG_SZ, RegCloseKey, RegCreateKeyExW, RegDeleteKeyW, RegDeleteValueW, RegEnumKeyExW,
    RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
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

fn enum_subkeys(subkey: &str) -> Result<Vec<String>> {
    let Some(key) = RegKey::open(subkey, false)? else {
        return Ok(Vec::new());
    };
    let mut names = Vec::new();
    for index in 0_u32..64 {
        let mut buf = [0_u16; 256];
        let mut len = buf.len() as u32;
        // SAFETY: `buf` is the name out-buffer; `len` is its capacity in characters.
        let status = unsafe {
            RegEnumKeyExW(
                key.0,
                index,
                buf.as_mut_ptr(),
                &mut len,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if status != 0 {
            // ERROR_NO_MORE_ITEMS
            if status == 259 {
                break;
            }
            return Err(std::io::Error::from_raw_os_error(status as i32)).with_context(|| {
                format!("failed to enumerate registry subkeys of {subkey}")
            });
        }
        names.push(String::from_utf16_lossy(&buf[..len as usize]));
    }
    Ok(names)
}

fn read_flags(subkey: &str, value: &str) -> Result<Option<u64>> {
    let Some(key) = RegKey::open(subkey, false)? else {
        return Ok(None);
    };
    let value_wide = super_wide(value);
    let mut data = 0_u64;
    let mut size = 8_u32;
    let mut kind = 0_u32;
    // SAFETY: valid key handle; `data` is an 8-byte out-buffer covering QWORD and DWORD.
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            value_wide.as_ptr(),
            std::ptr::null(),
            &mut kind,
            std::ptr::from_mut(&mut data).cast(),
            &mut size,
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to read registry integer {subkey}\\{value}"));
    }
    match kind {
        REG_QWORD if size >= 8 => Ok(Some(data)),
        REG_DWORD if size >= 4 => Ok(Some(u64::from(data as u32))),
        _ => Ok(None),
    }
}

fn write_qword(subkey: &str, value: &str, data: u64) -> Result<()> {
    let Some(key) = RegKey::open(subkey, true)? else {
        return Ok(());
    };
    let value_wide = super_wide(value);
    let bytes = data.to_le_bytes();
    // SAFETY: `bytes` is a live 8-byte QWORD buffer.
    let status = unsafe {
        RegSetValueExW(
            key.0,
            value_wide.as_ptr(),
            0,
            REG_QWORD,
            bytes.as_ptr(),
            bytes.len() as u32,
        )
    };
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to write registry QWORD {subkey}\\{value}"));
    }
    Ok(())
}

fn interface_doh_key(guid: &str, family: &str, server: &str) -> String {
    format!(r"{INTERFACE_DOH_ROOT}\{guid}\DohInterfaceSettings\{family}\{server}")
}

fn collect_interface_doh() -> Result<Vec<super::InterfaceDohEntry>> {
    let mut entries = Vec::new();
    for guid in enum_subkeys(INTERFACE_DOH_ROOT)? {
        for family in ["Doh", "Doh6"] {
            let family_key =
                format!(r"{INTERFACE_DOH_ROOT}\{guid}\DohInterfaceSettings\{family}");
            for server in enum_subkeys(&family_key)? {
                let key = interface_doh_key(&guid, family, &server);
                let Some(flags) = read_flags(&key, DOH_FLAGS)? else {
                    continue;
                };
                if !super::interface_doh_is_enabled(flags) {
                    continue;
                }
                entries.push(super::InterfaceDohEntry {
                    guid: guid.clone(),
                    family: family.to_owned(),
                    server,
                    flags,
                });
            }
        }
    }
    Ok(entries)
}

fn write_interface_doh_capture(entries: &[super::InterfaceDohEntry]) -> Result<()> {
    let path = super::interface_doh_capture_path();
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let body = super::format_interface_doh_capture(entries).map_err(|error| anyhow::anyhow!(error))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, body).with_context(|| format!("failed to write {}", tmp.display()))?;
    std::fs::rename(&tmp, &path)
        .with_context(|| format!("failed to persist {}", path.display()))?;
    Ok(())
}

fn read_interface_doh_capture() -> Result<Option<Vec<super::InterfaceDohEntry>>> {
    let path = super::interface_doh_capture_path();
    match std::fs::read_to_string(&path) {
        Ok(body) => Ok(Some(
            super::parse_interface_doh_capture(&body).map_err(|error| anyhow::anyhow!(error))?,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
    }
}

fn delete_interface_doh_capture() -> Result<()> {
    let path = super::interface_doh_capture_path();
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to delete {}", path.display())),
    }
}

fn suppress_interface_doh() -> Result<()> {
    let current = collect_interface_doh()?;
    if read_interface_doh_capture()?.is_none() {
        write_interface_doh_capture(&current)?;
    }
    for entry in current {
        write_qword(
            &interface_doh_key(&entry.guid, &entry.family, &entry.server),
            DOH_FLAGS,
            0,
        )?;
    }
    Ok(())
}

fn restore_interface_doh() -> Result<()> {
    let Some(entries) = read_interface_doh_capture()? else {
        return Ok(());
    };
    for entry in entries {
        write_qword(
            &interface_doh_key(&entry.guid, &entry.family, &entry.server),
            DOH_FLAGS,
            entry.flags,
        )?;
    }
    delete_interface_doh_capture()?;
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

/// Live application, **per address family**, in ONE PowerShell process (cold start is the
/// dominant cost). The registry writes are the authoritative record this module verifies
/// against; the live apply is what makes the running resolver pick the change up without an
/// interface bounce.
///
/// * IPv4 goes through CIM
///   (`Win32_NetworkAdapterConfiguration.SetDNSServerSearchOrder`, the architecture doc's
///   primary mechanism: it handles static and DHCP adapters without touching leases) and
///   every `Invoke-CimMethod` checks its `ReturnValue` — piping to `Out-Null` would report
///   success for a rejected call.
/// * IPv6 goes through `netsh interface ipv6 set/add dnsservers`, keyed by the IPv6
///   interface index, in three shapes: `source=dhcp` (`$null`, restore a family that had no
///   saved value), `source=static address=none` (an empty list — the protected state, since
///   the core has no `[::1]:53` listener to point at), and `source=static` plus one `add`
///   per extra server when restoring saved ones. The CIM method is documented for IPv4
///   addresses only: handing it an IPv6 address is how an older version could either fail on
///   every adapter forever or, worse, have the address silently dropped and leave an IPv6
///   resolver pointing at the ISP while the registry read-back still said "protected".
/// * The script then *reads the live list back per family* (`Get-DnsClientServerAddress`)
///   and only reports success when what it reads matches what it applied — exactly the
///   TUN DNS address for IPv4 and exactly *nothing* for IPv6 when protecting, and "no
///   unsaved Tono-owned DNS address remains" when restoring
///   (a restored family's servers may legitimately come back from DHCP in another order).
///   A family with no live DNS instance, an interface index of 0, or a CIM `ReturnValue` of
///   84 ("IP not enabled on adapter") is a non-participant: there is no resolver on it to
///   leak, and recording it as a failure is what used to pin `live_apply_failed` on forever.
///
/// The script prints `fails|skips`; results are recorded per adapter and required for any
/// restore proof (see the module docs). An adapter that reports *no* configurable family at
/// all is a skip, not a failure — that is the difference between ignoring a Hyper-V/WSL
/// pseudo adapter and bricking the machine on it.
///
/// 注意:运行时尚未实测 — wrapped so any failure is logged, never fatal.
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

const POWERSHELL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

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

/// Only these characters ever reach the generated script. GUIDs come from registry subkey
/// names and server strings from our own snapshot writes; anything else fails closed.
fn script_safe(value: &str, extra: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || extra.contains(byte as char))
}

/// The per-family apply and the per-family live read-back, shared by every entry in the
/// batch. Kept as one prelude so the generated script stays one short line per adapter:
/// the `-Command` argument has a hard length limit and a machine can carry many adapters.
const PROTECTED_DNS_V4_TOKEN: &str = "__TONO_PROTECTED_DNS_V4__";
const SCRIPT_PRELUDE: &str = r#"$global:fails = @()
$global:skips = @()
function Test-Family($index, $family, $want, $restoring) {
  if ($index -eq 0) { return $true }
  $entry = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily $family -ErrorAction SilentlyContinue
  if ($null -eq $entry) { return $true }
  $have = @($entry.ServerAddresses)
  $owned = if ($family -eq 'IPv4') { @('__TONO_PROTECTED_DNS_V4__', '127.0.0.1') } else { @('::1') }
  if ($restoring) {
foreach ($s in $have) {
  if (($owned -contains $s) -and ($null -eq $want -or -not ($want -contains $s))) { return $false }
}
return $true
  }
  if ($null -eq $want) { return $true }
  if ($have.Count -ne $want.Count) { return $false }
  for ($k = 0; $k -lt $want.Count; $k++) { if ($have[$k] -ne $want[$k]) { return $false } }
  return $true
}
function Set-AdapterDns($g, $i4, $i6, $v4, $v6, $restoring) {
  $touched = $false
  if ($i4 -ne 0) {
$c = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "SettingID='$g'" -ErrorAction SilentlyContinue
if ($null -eq $c) { $global:fails += $g; return }
$r = Invoke-CimMethod -InputObject $c -MethodName SetDNSServerSearchOrder -Arguments @{ DNSServerSearchOrder = $v4 } -ErrorAction SilentlyContinue
if ($r -and $r.ReturnValue -eq 84) { $global:skips += $g; return }
if (-not $r -or $r.ReturnValue -ne 0) { $global:fails += $g; return }
$touched = $true
  }
  if ($i6 -ne 0) {
$e = 0
if ($null -eq $v6) {
  netsh interface ipv6 set dnsservers "name=$i6" source=dhcp | Out-Null
  $e = $e + $LASTEXITCODE
} elseif ($v6.Count -eq 0) {
  netsh interface ipv6 set dnsservers "name=$i6" source=static address=none | Out-Null
  $e = $e + $LASTEXITCODE
} else {
  netsh interface ipv6 set dnsservers "name=$i6" source=static "address=$($v6[0])" register=none validate=no | Out-Null
  $e = $e + $LASTEXITCODE
  for ($k = 1; $k -lt $v6.Count; $k++) {
    netsh interface ipv6 add dnsservers "name=$i6" "address=$($v6[$k])" "index=$($k + 1)" validate=no | Out-Null
    $e = $e + $LASTEXITCODE
  }
}
if ($e -ne 0) { $global:fails += $g; return }
$touched = $true
  }
  if (-not $touched) { $global:skips += $g; return }
  if (-not (Test-Family $i4 'IPv4' $v4 $restoring)) { $global:fails += $g; return }
  if (-not (Test-Family $i6 'IPv6' $v6 $restoring)) { $global:fails += $g; return }
}
"#;

/// The result marker the batch must print. Its presence is what distinguishes "the script
/// ran and found no failures" from "the script produced nothing useful"; without it the
/// batch is treated as a total failure.
const RESULT_SEPARATOR: char = '|';

fn powershell_list(servers: &Option<Vec<String>>) -> String {
    match servers {
        None => "$null".to_owned(),
        Some(servers) => format!(
            "@({})",
            servers
                .iter()
                .map(|server| format!("'{server}'"))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

fn parse_guid_list(value: &str) -> std::collections::BTreeSet<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|guid| !guid.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn live_apply_batch(entries: &[LiveApplyEntry], mode: ApplyMode) -> Vec<(String, bool)> {
    let restoring = mode == ApplyMode::Restore;
    let mut script = SCRIPT_PRELUDE.replace(PROTECTED_DNS_V4_TOKEN, super::PROTECTED_DNS_V4);
    let mut rejected: std::collections::BTreeSet<String> = Default::default();
    for entry in entries {
        let servers_ok =
            [&entry.ipv4_servers, &entry.ipv6_servers]
                .into_iter()
                .all(|servers| {
                    servers.as_ref().is_none_or(|servers| {
                        servers.iter().all(|server| script_safe(server, ".:"))
                    })
                });
        if !script_safe(&entry.guid, "{}-") || !servers_ok {
            rejected.insert(entry.guid.clone());
            continue;
        }
        script.push_str(&format!(
            "Set-AdapterDns '{}' {} {} {} {} ${restoring}\n",
            entry.guid,
            entry.ipv4_index,
            entry.ipv6_index,
            powershell_list(&entry.ipv4_servers),
            powershell_list(&entry.ipv6_servers),
        ));
    }
    script.push_str(
        "[Console]::Out.Write(($global:fails -join ',') + '|' + ($global:skips -join ','))",
    );
    let run = run_with_timeout(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", &script],
        POWERSHELL_TIMEOUT,
    );
    let reported = match run {
        Ok(stdout) => stdout
            .lines()
            .rev()
            .find_map(|line| line.split_once(RESULT_SEPARATOR))
            .map(|(failed, skipped)| (parse_guid_list(failed), parse_guid_list(skipped))),
        Err(error) => {
            tracing::warn!("dns: live batch apply failed: {error:#}");
            None
        }
    };
    // The whole batch failed (timeout, spawn error, non-zero exit, or output without the
    // result marker — a script that died half way through): every entry is a failure. The
    // proof path stays closed and the DNS lock is never held hostage.
    let Some((failed, skipped)) = reported else {
        tracing::warn!(
            "dns: live batch apply produced no result marker; all {} adapter(s) are recorded \
             as failed",
            entries.len()
        );
        return entries
            .iter()
            .map(|entry| (entry.guid.clone(), false))
            .collect();
    };
    if !skipped.is_empty() {
        // Not a failure: these adapters have no configurable resolver on either family, so
        // there is nothing on them that could leak.
        tracing::debug!("dns: adapters without a configurable live resolver: {skipped:?}");
    }
    entries
        .iter()
        .map(|entry| {
            let ok = !failed.contains(&entry.guid) && !rejected.contains(&entry.guid);
            (entry.guid.clone(), ok)
        })
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
    let entries = guids
        .iter()
        .filter_map(|guid| {
            active
                .get(&guid.to_ascii_uppercase())
                .map(|adapter| (guid, adapter))
        })
        .map(|(guid, adapter)| apply_protected(guid, adapter))
        .collect::<Result<Vec<_>>>()?;
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
pub(super) fn all_loopback(guids: &[String]) -> Result<bool> {
    for guid in guids {
        let adapter = read_adapter(guid, None)?;
        // Each present family must be fully protected — NameServer and, when set,
        // ProfileNameServer (which overrides NameServer for the active profile). An absent
        // family is skipped, matching the apply side.
        if key_exists(&v4_key(guid))?
            && (!is_protected_v4_value(adapter.ipv4_name_server.as_deref())
                || (adapter.ipv4_profile_name_server.is_some()
                    && !is_protected_v4_value(adapter.ipv4_profile_name_server.as_deref())))
        {
            return Ok(false);
        }
        // IPv6 is deliberately NOT a gate here. The protected v6 state is "no servers",
        // and Windows stores that the same way it stores "use DHCP" — an absent or empty
        // `NameServer` — so the registry cannot tell the two apart and a read-back can
        // never prove it. Making it a gate is what turned a machine with a perfectly good
        // v4 TUN resolver into `Failed to enable protected DNS`. It is also
        // unnecessary: v6 DNS to a physical resolver is blocked by the weight-6 v6 DNS
        // filter and the v6 block-all, so an unprovable v6 state is a resolution failure
        // at worst, never a leak, and the fake-ip probe proves the resolver that answers.
        // Clearing v6 stays best-effort on the apply side.
    }
    Ok(true)
}

const DNSCACHE_PARAMETERS: &str =
    r"SYSTEM\CurrentControlSet\Services\Dnscache\Parameters";
const ENABLE_AUTO_DOH: &str = "EnableAutoDoh";
/// Settings UI Encrypted DNS lives here, not on `EnableAutoDoh`.
const INTERFACE_DOH_ROOT: &str =
    r"SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters";
const DOH_FLAGS: &str = "DohFlags";
/// Catch-all NRPT rule owned by this session. Deleted on restore; never touches
/// anyone else's DnsPolicyConfig keys.
const NRPT_ROOT: &str =
    r"SYSTEM\CurrentControlSet\Services\Dnscache\Parameters\DnsPolicyConfig";
const NRPT_RULE_GUID: &str = "{8f3c2b91-4a6e-4d17-9c1a-198018000002}";
/// Generic DNS servers only (`DA_NRPT_CONFIG_DNS`).
const NRPT_CONFIG_DNS: u32 = 0x8;
const NRPT_VERSION: u32 = 2;

fn read_dword(subkey: &str, value: &str) -> Result<Option<u32>> {
    let Some(key) = RegKey::open(subkey, false)? else {
        return Ok(None);
    };
    let value_wide = super_wide(value);
    let mut data = 0_u32;
    let mut size = 4_u32;
    let mut kind = 0_u32;
    // SAFETY: valid key handle; `data` is a 4-byte DWORD out-buffer.
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            value_wide.as_ptr(),
            std::ptr::null(),
            &mut kind,
            std::ptr::from_mut(&mut data).cast(),
            &mut size,
        )
    };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to read registry DWORD {subkey}\\{value}"));
    }
    Ok(Some(data))
}

fn write_dword(subkey: &str, value: &str, data: u32) -> Result<()> {
    let Some(key) = RegKey::open(subkey, true)? else {
        bail!("registry key {subkey} does not exist");
    };
    let value_wide = super_wide(value);
    let bytes = data.to_le_bytes();
    // SAFETY: `bytes` is a live 4-byte DWORD buffer.
    let status = unsafe {
        RegSetValueExW(
            key.0,
            value_wide.as_ptr(),
            0,
            REG_DWORD,
            bytes.as_ptr(),
            bytes.len() as u32,
        )
    };
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to write registry DWORD {subkey}\\{value}"));
    }
    Ok(())
}

fn write_multi_sz(subkey: &str, value: &str, entries: &[&str]) -> Result<()> {
    let Some(key) = RegKey::open(subkey, true)? else {
        bail!("registry key {subkey} does not exist");
    };
    let value_wide = super_wide(value);
    let mut wide = Vec::new();
    for entry in entries {
        wide.extend(entry.encode_utf16());
        wide.push(0);
    }
    wide.push(0);
    // SAFETY: `wide` is a double-NUL-terminated MULTI_SZ buffer.
    let status = unsafe {
        RegSetValueExW(
            key.0,
            value_wide.as_ptr(),
            0,
            REG_MULTI_SZ,
            wide.as_ptr().cast(),
            (wide.len() * 2) as u32,
        )
    };
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to write registry MULTI_SZ {subkey}\\{value}"));
    }
    Ok(())
}

fn create_key(subkey: &str) -> Result<RegKey> {
    let wide = super_wide(subkey);
    let mut handle = std::ptr::null_mut();
    let mut disposition = 0_u32;
    // SAFETY: NUL-terminated key path; `handle` and `disposition` are valid out-pointers.
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            wide.as_ptr(),
            0,
            std::ptr::null(),
            0,
            KEY_WOW64_64KEY | KEY_WRITE | KEY_READ,
            std::ptr::null(),
            &mut handle,
            &mut disposition,
        )
    };
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to create registry key {subkey}"));
    }
    Ok(RegKey(handle))
}

fn delete_key(subkey: &str) -> Result<()> {
    let wide = super_wide(subkey);
    // SAFETY: NUL-terminated key path under HKLM.
    let status = unsafe { RegDeleteKeyW(HKEY_LOCAL_MACHINE, wide.as_ptr()) };
    if status != 0 && status != ERROR_FILE_NOT_FOUND {
        return Err(std::io::Error::from_raw_os_error(status as i32))
            .with_context(|| format!("failed to delete registry key {subkey}"));
    }
    Ok(())
}

fn write_capture_file(enable_auto_doh: Option<u32>) -> Result<()> {
    let path = super::encrypted_dns_capture_path();
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, super::format_encrypted_dns_capture(enable_auto_doh))
        .with_context(|| format!("failed to write {}", tmp.display()))?;
    std::fs::rename(&tmp, &path)
        .with_context(|| format!("failed to persist {}", path.display()))?;
    Ok(())
}

fn read_capture_file() -> Result<Option<Option<u32>>> {
    let path = super::encrypted_dns_capture_path();
    match std::fs::read_to_string(&path) {
        Ok(body) => Ok(Some(
            super::parse_encrypted_dns_capture(&body).map_err(|error| anyhow::anyhow!(error))?,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("failed to read {}", path.display())),
    }
}

fn delete_capture_file() -> Result<()> {
    let path = super::encrypted_dns_capture_path();
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to delete {}", path.display())),
    }
}

fn nrpt_rule_key() -> String {
    format!(r"{NRPT_ROOT}\{NRPT_RULE_GUID}")
}

fn install_nrpt() -> Result<()> {
    let _root = create_key(NRPT_ROOT)?;
    drop(_root);
    let key = nrpt_rule_key();
    let _rule = create_key(&key)?;
    drop(_rule);
    write_multi_sz(&key, "Name", &["."])?;
    write_dword(&key, "Version", NRPT_VERSION)?;
    write_dword(&key, "ConfigOptions", NRPT_CONFIG_DNS)?;
    write_sz(&key, "GenericDNSServers", super::PROTECTED_DNS_V4)?;
    Ok(())
}

/// Snapshot Encrypted DNS, turn DoH off, and force the DNS Client through TUN DNS.
pub(super) fn suppress_encrypted_dns() -> Result<()> {
    if read_capture_file()?.is_none() {
        write_capture_file(read_dword(DNSCACHE_PARAMETERS, ENABLE_AUTO_DOH)?)?;
    }
    write_dword(DNSCACHE_PARAMETERS, ENABLE_AUTO_DOH, super::ENABLE_AUTO_DOH_OFF)?;
    if let Err(error) = suppress_interface_doh() {
        tracing::warn!("dns: per-adapter Encrypted DNS pin failed: {error:#}");
    }
    install_nrpt().context("failed to install the Tono NRPT catch-all")?;
    Ok(())
}

/// Put `EnableAutoDoh` back, restore per-adapter DoH flags, and delete our NRPT rule.
/// Idempotent when no capture exists.
pub(super) fn restore_encrypted_dns() -> Result<()> {
    if let Err(error) = delete_key(&nrpt_rule_key()) {
        tracing::error!("dns: Tono NRPT rule could not be removed: {error:#}");
        return Err(error);
    }
    if let Some(saved) = read_capture_file()? {
        match saved {
            Some(value) => write_dword(DNSCACHE_PARAMETERS, ENABLE_AUTO_DOH, value)?,
            None => delete_value(DNSCACHE_PARAMETERS, ENABLE_AUTO_DOH)?,
        }
    }
    delete_capture_file()?;
    if let Err(error) = restore_interface_doh() {
        tracing::error!("dns: per-adapter Encrypted DNS restore failed: {error:#}");
        return Err(error);
    }
    Ok(())
}

