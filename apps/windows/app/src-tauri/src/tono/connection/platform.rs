//! Physical interface detection and removal of the legacy runtime copy.

use tono_logging::{Type, logging};

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

/// X2-1: every hardware adapter that currently carries an IPv4 default route and is
/// operationally up, by alias. Unlike [`detect_physical_interface`] this is safe after WinTUN
/// starts: it never consults `GetBestRoute2` (which then resolves to Tono's own adapter), and the
/// same filter that keeps Wintun/virtual adapters out of the DIRECT choice applies to each row.
/// Used only to decide whether the committed DIRECT binding still names a live uplink.
pub(super) async fn usable_physical_uplinks() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(|| -> Result<Vec<String>, String> {
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
        .map_err(|error| format!("physical uplink enumeration worker failed: {error}"))?
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
    use super::first_up_hardware_alias;

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
