//! Physical interface detection and removal of the legacy runtime copy.

#[cfg(windows)]
use std::time::Duration;
#[cfg(windows)]
use tono_core::config::TUN_DEVICE_NAME;
use tono_logging::{Type, logging};

/// The interface can be registered before the core has finished installing the routes that make
/// protected traffic enter WinTUN. Do not point system DNS at the tunnel or start data-plane
/// probes until Windows selects Tono for both a fake address and the protected DNS endpoint.
// Windows TUN setup can spend about 15 seconds in its first adapter attempt
// before it reports a failure and retries. Keep the route proof in place while
// giving that first attempt time to finish.
#[cfg(windows)]
const TUN_ROUTE_READY_TIMEOUT: Duration = Duration::from_secs(20);

#[cfg(windows)]
const TUN_INTERFACE_OPER_STATUS_UP: i32 = 1;
#[cfg(windows)]
const FAKE_IP_ROUTE_PROBE: [u8; 4] = [198, 18, 5, 25];
#[cfg(windows)]
const PROTECTED_DNS_ROUTE_PROBE: [u8; 4] = [198, 18, 0, 2];

#[cfg(windows)]
fn fake_ip_route_uses_ready_tun(alias: &str, oper_status: i32) -> bool {
    alias.eq_ignore_ascii_case(TUN_DEVICE_NAME) && oper_status == TUN_INTERFACE_OPER_STATUS_UP
}

#[cfg(windows)]
fn protected_routes_use_ready_tun(fake_ip_alias: &str, fake_ip_status: i32, dns_alias: &str, dns_status: i32) -> bool {
    fake_ip_route_uses_ready_tun(fake_ip_alias, fake_ip_status) && fake_ip_route_uses_ready_tun(dns_alias, dns_status)
}

/// Wait until Windows routes a non-local fake-IP through the Tono interface. The Service can
/// resolve the TUN LUID as soon as the adapter is registered, before the protected routes exist.
pub(super) async fn wait_for_tun_route_ready() -> Result<(), String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(wait_for_tun_route_ready_windows)
            .await
            .map_err(|error| format!("TUN route readiness worker failed: {error}"))?
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(windows)]
fn wait_for_tun_route_ready_windows() -> Result<(), String> {
    let deadline = std::time::Instant::now() + TUN_ROUTE_READY_TIMEOUT;
    loop {
        let fake_ip_route = best_ipv4_route_windows(FAKE_IP_ROUTE_PROBE, "fake-IP 198.18.5.25");
        let dns_route = best_ipv4_route_windows(PROTECTED_DNS_ROUTE_PROBE, "protected DNS 198.18.0.2");
        let fake_ip_ready = fake_ip_route
            .as_ref()
            .is_ok_and(|(alias, status)| fake_ip_route_uses_ready_tun(alias, *status));
        let dns_ready = dns_route
            .as_ref()
            .is_ok_and(|(alias, status)| fake_ip_route_uses_ready_tun(alias, *status));
        if let (Ok((fake_ip_alias, fake_ip_status)), Ok((dns_alias, dns_status))) = (&fake_ip_route, &dns_route)
            && protected_routes_use_ready_tun(fake_ip_alias, *fake_ip_status, dns_alias, *dns_status)
        {
            return Ok(());
        }
        let route_detail = |target: &str, route: &Result<(String, i32), String>, ready: bool| match route {
            Ok((alias, status)) if ready => {
                format!("{target} selects the ready {alias:?} tunnel (status {status})")
            }
            Ok((alias, status)) => {
                format!("{target} selects interface {alias:?} (operational status {status})")
            }
            Err(error) => format!("{target} route lookup failed: {error}"),
        };
        let last = format!(
            "{}; {}",
            route_detail("fake-IP 198.18.5.25", &fake_ip_route, fake_ip_ready),
            route_detail("protected DNS 198.18.0.2", &dns_route, dns_ready),
        );
        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "TONO_TUN_ROUTE_UNAVAILABLE: {last}; expected both protected routes to use the active {TUN_DEVICE_NAME:?} tunnel",
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(windows)]
fn best_ipv4_route_windows(destination_address: [u8; 4], target: &str) -> Result<(String, i32), String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetBestRoute2, GetIfEntry2, MIB_IF_ROW2, MIB_IPFORWARD_ROW2,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH;
    use windows_sys::Win32::Networking::WinSock::{AF_INET, IN_ADDR, SOCKADDR_INET};

    let mut destination = SOCKADDR_INET::default();
    destination.Ipv4.sin_family = AF_INET;
    destination.Ipv4.sin_addr = IN_ADDR {
        S_un: windows_sys::Win32::Networking::WinSock::IN_ADDR_0 {
            S_addr: u32::from_ne_bytes(destination_address),
        },
    };
    let mut route = MIB_IPFORWARD_ROW2::default();
    let mut source = SOCKADDR_INET::default();
    // SAFETY: the destination, route, and source buffers are valid for the duration of the call.
    let status = unsafe {
        GetBestRoute2(
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
            &destination,
            0,
            &mut route,
            &mut source,
        )
    };
    if status != 0 {
        return Err(format!("GetBestRoute2 for {target} failed: {status}"));
    }
    // SAFETY: `InterfaceLuid` was returned by IP Helper with a successful route lookup.
    let luid = unsafe { route.InterfaceLuid.Value };
    let mut interface = MIB_IF_ROW2 {
        InterfaceLuid: NET_LUID_LH { Value: luid },
        ..Default::default()
    };
    // SAFETY: `interface` is a valid output buffer and `luid` came from the selected route.
    let status = unsafe { GetIfEntry2(&mut interface) };
    if status != 0 {
        return Err(format!("GetIfEntry2 for {target} route failed: {status}"));
    }
    Ok((utf16_field(&interface.Alias), interface.OperStatus))
}

#[cfg(all(test, windows))]
mod tun_route_tests {
    use super::{fake_ip_route_uses_ready_tun, protected_routes_use_ready_tun};

    #[test]
    fn both_protected_routes_must_select_an_up_tono_interface() {
        assert!(protected_routes_use_ready_tun("Tono", 1, "Tono", 1));
        assert!(!protected_routes_use_ready_tun("Tono", 1, "以太网", 1));
        assert!(!protected_routes_use_ready_tun("以太网", 1, "Tono", 1));
        assert!(!fake_ip_route_uses_ready_tun("Tono", 2));
    }
}

/// The physical interface carrying the default route. Windows uses
/// `GetBestRoute2` (runtime-unverified here; covered by the xwin check and
/// on-device smoke); other dev machines parse `route get default`.
pub(super) async fn detect_physical_interface() -> Result<String, String> {
    #[cfg(windows)]
    {
        // GetBestRoute2/GetIfEntry2 are synchronous OS calls. Keep them off the Tauri async
        // workers so a slow IP helper stack cannot starve UI / status / release tasks.
        tokio::task::spawn_blocking(detect_physical_interface_windows)
            .await
            .map_err(|error| format!("physical interface discovery worker failed: {error}"))?
    }
    #[cfg(not(windows))]
    {
        detect_physical_interface_route_command().await
    }
}

/// macOS/Linux dev path: parse `interface: en0` out of `route get default`.
#[cfg(not(windows))]
pub(super) async fn detect_physical_interface_route_command() -> Result<String, String> {
    let output = tokio::process::Command::new("route")
        .args(["get", "default"])
        .output()
        .await
        .map_err(|err| format!("route get default failed: {err}"))?;
    if !output.status.success() {
        return Err("route get default returned an error".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(interface) = line.trim().strip_prefix("interface:") {
            let interface = interface.trim();
            if !interface.is_empty() {
                return Ok(interface.to_string());
            }
        }
    }
    Err("no default route interface found".to_string())
}

/// Windows path: `GetBestRoute2` for a public destination, then `GetIfEntry2` for the interface
/// alias (`"Ethernet 2"`, `"以太网"`, etc.). This runs before WinTUN starts, so the best route
/// cannot resolve back to Tono. The Service deliberately resolves aliases to LUIDs as well; using
/// `ConvertInterfaceLuidToNameW` here would produce the adapter's internal name and recreate the
/// alias/name mismatch behind Windows error 123. VMware/VirtualBox/Hyper-V host adapters are
/// deliberately not acceptable physical uplinks: they remain enabled for the customer's VMs,
/// but Tono's optional DIRECT outbounds must bind to a real hardware interface.
#[cfg(windows)]
pub(super) fn detect_physical_interface_windows() -> Result<String, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{GetBestRoute2, MIB_IPFORWARD_ROW2};
    use windows_sys::Win32::Networking::WinSock::{AF_INET, IN_ADDR, SOCKADDR_INET};

    // 8.8.8.8 — byte-symmetric, so the S_addr value needs no byte swapping.
    let mut destination = SOCKADDR_INET::default();
    destination.Ipv4.sin_family = AF_INET;
    destination.Ipv4.sin_addr = IN_ADDR {
        S_un: windows_sys::Win32::Networking::WinSock::IN_ADDR_0 { S_addr: 0x0808_0808 },
    };

    let mut best_route = MIB_IPFORWARD_ROW2::default();
    let mut best_source = SOCKADDR_INET::default();
    let status = unsafe {
        GetBestRoute2(
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
            &destination,
            0,
            &mut best_route,
            &mut best_source,
        )
    };
    if status != 0 {
        return Err(format!("GetBestRoute2 failed: {status}"));
    }

    let best_luid = unsafe { best_route.InterfaceLuid.Value };
    let mut candidates = vec![best_luid];
    for luid in default_route_interface_luids()? {
        if !candidates.contains(&luid) {
            candidates.push(luid);
        }
    }

    first_up_hardware_alias(candidates.into_iter().map(hardware_uplink_alias))
}

/// How long the health monitor waits for the uplink enumeration, well past a normal read of a few
/// milliseconds. A slower read counts as unknown, and an unknown read does not keep a committed
/// DIRECT binding in place.
#[cfg(windows)]
const UPLINK_READ_BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(windows)]
static UPLINK_READ_SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

/// One native read in flight at most, answered within `budget`. The permit lives in the blocking
/// worker: a read that never returns keeps the slot, so later reads answer unknown at once instead
/// of leaving one more hung worker behind on every monitor tick.
#[cfg(any(windows, test))]
async fn bounded_native_read<T: Send + 'static>(
    slot: &'static tokio::sync::Semaphore,
    budget: std::time::Duration,
    read: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let permit = slot
        .try_acquire()
        .map_err(|_| "an earlier physical uplink enumeration has not returned".to_owned())?;
    let worker = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        read()
    });
    match tokio::time::timeout(budget, worker).await {
        Ok(joined) => joined.map_err(|error| format!("physical uplink enumeration worker failed: {error}"))?,
        Err(_) => Err(format!("physical uplink enumeration did not return within {budget:?}")),
    }
}

/// X2-1: every hardware adapter that currently carries an IPv4 default route and is
/// operationally up, by alias. Unlike [`detect_physical_interface`] this is safe after WinTUN
/// starts: it never consults `GetBestRoute2` (which then resolves to Tono's own adapter), and the
/// same filter that keeps Wintun/virtual adapters out of the DIRECT choice applies to each row.
/// Used only to decide whether the committed DIRECT binding still names a live uplink.
pub(super) async fn usable_physical_uplinks() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        bounded_native_read(&UPLINK_READ_SLOT, UPLINK_READ_BUDGET, || -> Result<Vec<String>, String> {
            let mut uplinks = Vec::new();
            for luid in default_route_interface_luids()? {
                if let Ok((alias, true)) = hardware_uplink_alias(luid)
                    && !uplinks.contains(&alias)
                {
                    uplinks.push(alias);
                }
            }
            Ok(uplinks)
        })
        .await
    }
    #[cfg(not(windows))]
    {
        detect_physical_interface_route_command().await.map(|alias| vec![alias])
    }
}

/// Read-only recovery identity: physical LUID, source, gateway
/// and effective default-route metric. Values are never persisted or logged.
/// DNS writes and Tono's own TUN routes must not reset a failed-connect cooldown.
pub(super) type PhysicalNetworkSnapshot = Vec<(u64, u32, u32, u64)>;

#[cfg(windows)]
pub(super) fn physical_network_snapshot_windows() -> Result<PhysicalNetworkSnapshot, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetBestRoute2, GetIfEntry2, GetIpInterfaceEntry, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211,
        IF_TYPE_PROP_VIRTUAL, IF_TYPE_TUNNEL, MIB_IF_ROW2, MIB_IPFORWARD_ROW2,
        MIB_IF_TYPE_LOOPBACK, MIB_IPINTERFACE_ROW,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::{IfOperStatusUp, NET_LUID_LH};
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_INET};

    let mut destination = SOCKADDR_INET::default();
    destination.Ipv4.sin_family = AF_INET;
    destination.Ipv4.sin_addr.S_un.S_addr = 0x0808_0808;
    let mut snapshot = Vec::new();
    for luid in default_route_interface_luids()? {
        let mut interface = MIB_IF_ROW2 {
            InterfaceLuid: NET_LUID_LH { Value: luid },
            ..Default::default()
        };
        // SAFETY: initialized row; LUID comes from the OS route table.
        let status = unsafe { GetIfEntry2(&mut interface) };
        if status != 0 {
            return Err(format!("GetIfEntry2 failed: {status}"));
        }
        let hardware = interface.InterfaceAndOperStatusFlags._bitfield & 0x01 != 0;
        let known_hardware = matches!(interface.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211);
        if interface.OperStatus != IfOperStatusUp
            || matches!(interface.Type, MIB_IF_TYPE_LOOPBACK | IF_TYPE_PROP_VIRTUAL | IF_TYPE_TUNNEL)
            || (!hardware && !known_hardware)
            || is_virtual_uplink_description(&utf16_field(&interface.Description))
        {
            continue;
        }
        let mut route = MIB_IPFORWARD_ROW2::default();
        let mut source = SOCKADDR_INET::default();
        // SAFETY: initialized IPv4 destination and outputs. Constrain lookup to
        // the physical interface even if a TUN is concurrently being retired.
        let status = unsafe {
            GetBestRoute2(
                &interface.InterfaceLuid, 0, std::ptr::null(), &destination, 0,
                &mut route, &mut source,
            )
        };
        if status != 0 {
            return Err(format!("GetBestRoute2 failed: {status}"));
        }
        // SAFETY: validate both sockaddr unions before reading their IPv4 fields.
        if unsafe { source.si_family != AF_INET || route.NextHop.si_family != AF_INET } {
            return Err("physical route did not return IPv4 addresses".to_string());
        }
        let mut ip_interface = MIB_IPINTERFACE_ROW {
            Family: AF_INET,
            InterfaceLuid: interface.InterfaceLuid,
            ..Default::default()
        };
        // SAFETY: initialized IPv4 row identifies the same physical interface.
        let status = unsafe { GetIpInterfaceEntry(&mut ip_interface) };
        if status != 0 {
            return Err(format!("GetIpInterfaceEntry failed: {status}"));
        }
        snapshot.push((
            luid,
            unsafe { source.Ipv4.sin_addr.S_un.S_addr },
            unsafe { route.NextHop.Ipv4.sin_addr.S_un.S_addr },
            u64::from(route.Metric) + u64::from(ip_interface.Metric),
        ));
    }
    snapshot.sort_unstable();
    snapshot.dedup();
    // Empty is a successful observation: loss and restoration of the same
    // uplink are changes. Native read errors leave the old baseline intact.
    Ok(snapshot)
}

/// One default-route candidate: its alias and whether it is operationally up, or why it is not
/// an acceptable hardware uplink for DIRECT.
#[cfg(windows)]
fn hardware_uplink_alias(luid: u64) -> Result<(String, bool), String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetIfEntry2, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211, IF_TYPE_PROP_VIRTUAL, IF_TYPE_TUNNEL, MIB_IF_ROW2,
        MIB_IF_TYPE_LOOPBACK,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;

    let mut interface = MIB_IF_ROW2 {
        InterfaceLuid: windows_sys::Win32::NetworkManagement::Ndis::NET_LUID_LH {
            Value: luid,
        },
        ..Default::default()
    };
    // SAFETY: `interface` is initialized and the LUID came from IP Helper.
    let status = unsafe { GetIfEntry2(&mut interface) };
    if status != 0 {
        return Err(format!("LUID {luid}: GetIfEntry2 failed ({status})"));
    }
    let description = utf16_field(&interface.Description);
    let alias = utf16_field(&interface.Alias);
    if alias.is_empty() {
        return Err(format!("LUID {luid}: empty interface alias"));
    }
    let hardware = interface.InterfaceAndOperStatusFlags._bitfield & 0x01 != 0;
    let known_hardware_type = matches!(interface.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211);
    let virtual_description = is_virtual_uplink_description(&description);
    let forbidden_type = matches!(
        interface.Type,
        MIB_IF_TYPE_LOOPBACK | IF_TYPE_PROP_VIRTUAL | IF_TYPE_TUNNEL
    );
    if virtual_description || forbidden_type || (!hardware && !known_hardware_type) {
        return Err(format!(
            "{alias:?} ({description:?}, type {}, hardware={hardware})",
            interface.Type
        ));
    }
    Ok((alias, interface.OperStatus == IfOperStatusUp))
}

/// The route chosen by Windows can point at a host-only/NAT adapter even while a real
/// Ethernet/Wi-Fi default route is available. Return all IPv4 default-route interfaces in
/// metric order so the caller can reject virtual adapters without disabling them.
#[cfg(windows)]
pub(super) fn default_route_interface_luids() -> Result<Vec<u64>, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIpForwardTable2, MIB_IPFORWARD_TABLE2,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET;

    let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    // SAFETY: IP Helper allocates the table and writes its address to `table`.
    let status = unsafe { GetIpForwardTable2(AF_INET, &mut table) };
    if status != 0 {
        return Err(format!("GetIpForwardTable2 failed: {status}"));
    }
    if table.is_null() {
        return Err("GetIpForwardTable2 returned a null table".to_string());
    }

    // SAFETY: a successful table contains `NumEntries` rows in the trailing `Table` array;
    // the allocation remains alive until FreeMibTable below.
    let rows = unsafe { std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize) };
    let mut routes: Vec<(u32, u64)> = rows
        .iter()
        .filter(|row| row.DestinationPrefix.PrefixLength == 0 && !row.Loopback)
        .map(|row| (row.Metric, unsafe { row.InterfaceLuid.Value }))
        .collect();
    // SAFETY: `table` was returned by GetIpForwardTable2 and is released exactly once.
    unsafe { FreeMibTable(table.cast()) };
    routes.sort_unstable_by_key(|(metric, _)| *metric);
    let mut luids = Vec::with_capacity(routes.len());
    for (_, luid) in routes {
        if !luids.contains(&luid) {
            luids.push(luid);
        }
    }
    Ok(luids)
}

#[cfg(windows)]
pub(super) fn utf16_field(field: &[u16]) -> String {
    let end = field.iter().position(|ch| *ch == 0).unwrap_or(field.len());
    String::from_utf16_lossy(&field[..end])
}

/// First operationally-up hardware alias. A down NIC that still owns a
/// default-route row must not become the DIRECT bind: capture time is the
/// only choice, and the later "is this binding still up?" check does not
/// run until a network change.
pub(super) fn first_up_hardware_alias(
    candidates: impl IntoIterator<Item = Result<(String, bool), String>>,
) -> Result<String, String> {
    let mut rejected = Vec::new();
    for candidate in candidates {
        match candidate {
            Ok((alias, true)) => return Ok(alias),
            Ok((alias, false)) => rejected.push(format!("{alias:?} is not operationally up")),
            Err(reason) => rejected.push(reason),
        }
    }
    Err(format!(
        "no usable hardware uplink found; rejected candidates: {}",
        if rejected.is_empty() {
            "none".to_string()
        } else {
            rejected.join("; ")
        }
    ))
}

/// Adapter descriptions are diagnostic input, not a security identity. This filter is only
/// used to choose a physical interface for optional DIRECT outbounds; it never disables or
/// removes the matching adapter. Tono's Wintun adapter is included so it cannot become the
/// physical DIRECT interface during a race with route installation.
pub(super) fn is_virtual_uplink_description(description: &str) -> bool {
    const MARKERS: &[&str] = &[
        "vmware",
        "vmnet",
        "virtualbox",
        "vboxnet",
        "hyper-v",
        "hyperv",
        "vethernet",
        "wintun",
        "tono",
        "wsl",
        "docker",
        "loopback",
        "tap-windows",
    ];
    let lowered = description.to_lowercase();
    MARKERS.iter().any(|marker| lowered.contains(marker))
}

/// Earlier builds wrote each connect's runtime to this file in the Tono data directory. Only the
/// controller secret was blanked: exit UUIDs, Reality parameters and the residential SOCKS5
/// username and password stayed as issued to the account. Nothing read it (the runtime reaches
/// the Service over IPC), so it is no longer written.
const LEGACY_RUNTIME_COPY: &str = "owned-runtime.redacted.yaml";

/// Remove a runtime copy an earlier build left behind. Called at startup and when an account
/// closes, so the copy never outlives the account whose catalog it was built from. A failed
/// delete is logged; nothing recreates the file.
pub(crate) fn remove_legacy_runtime_copy(catalog_dir: &std::path::Path) {
    match std::fs::remove_file(catalog_dir.join(LEGACY_RUNTIME_COPY)) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => logging!(
            warn,
            Type::Service,
            "Tono: failed to delete the previous build's runtime copy: {error}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{bounded_native_read, first_up_hardware_alias};

    /// WIN-UPLINK-READER-HANG: the uplink read had no bound, so an IP Helper call that never
    /// returned stopped the health monitor of a session with DIRECT. It now answers unknown within
    /// its budget, and the hung worker keeps the only slot instead of a second worker starting.
    #[tokio::test]
    async fn hung_uplink_reader_is_bounded() {
        static SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
        let budget = std::time::Duration::from_millis(50);
        let (resume, resumed) = std::sync::mpsc::channel::<()>();
        let hung = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            bounded_native_read(&SLOT, budget, move || {
                let _ = resumed.recv();
                Ok(Vec::<String>::new())
            }),
        )
        .await;
        let second_ran = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let ran = std::sync::Arc::clone(&second_ran);
        let second = bounded_native_read(&SLOT, budget, move || {
            ran.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(Vec::<String>::new())
        })
        .await;
        drop(resume);
        assert!(matches!(hung, Ok(Err(_))), "a hung read must answer unknown within its budget");
        assert!(second.is_err(), "the hung read still holds the only slot");
        assert!(!second_ran.load(std::sync::atomic::Ordering::SeqCst), "no second native worker started");
    }

    #[test]
    fn direct_bind_skips_a_down_hardware_alias() {
        let picked = first_up_hardware_alias([
            Err("VMware Virtual Ethernet".to_string()),
            Ok(("Ethernet".to_string(), false)),
            Ok(("Wi-Fi".to_string(), true)),
        ]);
        assert_eq!(picked.unwrap(), "Wi-Fi");
    }
}
