//! Read-only IPv4 topology, excluding Tono's own interface and DNS configuration. Values stay
//! in memory; no adapter address, route or name is logged. IP Helper allocations are bounded
//! before traversing and freed on every path. The caller runs this off the callback thread.

#[derive(Clone, Default, PartialEq, Eq)]
pub(super) struct Topology {
    /// Interface LUID, index, metric, MTU, connected, operational status.
    pub interfaces: Vec<(u64, u32, u32, u32, bool, i32)>,
    pub routes: Vec<(u64, u32, u8, u32, u32)>,
    /// IPv4 unicast addresses: interface LUID, address, on-link prefix length,
    /// DAD state. A new source address behind the same gateway is a move.
    pub addresses: Vec<(u64, u32, u8, i32)>,
    /// IPv6 default routes only (`::/0`): interface LUID, next hop, metric.
    /// Temporary host addresses are not recorded; they churn without a roam.
    /// An unreadable IPv6 table leaves this empty rather than failing the
    /// whole observation, so a DNS echo is not reported as "unknown".
    pub ipv6_defaults: Vec<(u64, [u8; 16], u32)>,
    /// The IPv6 default routes could not be read in full. An external batch is then
    /// published even when everything else compares equal: an unread part proves nothing.
    pub ipv6_unreadable: bool,
}

#[cfg(not(feature = "test"))]
pub(super) fn read() -> Result<Topology, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetIfEntry2, GetIpForwardTable2, GetIpInterfaceTable, GetUnicastIpAddressTable, MIB_IF_ROW2,
        MIB_IPFORWARD_TABLE2, MIB_IPINTERFACE_TABLE, MIB_IF_TYPE_LOOPBACK, MIB_UNICASTIPADDRESS_TABLE,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET;

    let mut interfaces: *mut MIB_IPINTERFACE_TABLE = std::ptr::null_mut();
    // SAFETY: initialized out pointer, IPv4 family; successful allocation is held by Table.
    let status = unsafe { GetIpInterfaceTable(AF_INET, &mut interfaces) };
    if status != 0 || interfaces.is_null() {
        return Err(format!("GetIpInterfaceTable failed: {status}"));
    }
    let _interfaces = Table(interfaces.cast());
    let count = unsafe { (*interfaces).NumEntries } as usize;
    if count > 512 {
        return Err("interface observation exceeds 512 rows".into());
    }
    // SAFETY: SDK-defined trailing array, bounded above, owned allocation remains alive.
    let rows = unsafe { std::slice::from_raw_parts((*interfaces).Table.as_ptr(), count) };
    let mut topology = Topology::default();
    let mut included = std::collections::BTreeSet::new();
    for row in rows {
        let mut interface = MIB_IF_ROW2 { InterfaceLuid: row.InterfaceLuid, ..Default::default() };
        let status = unsafe { GetIfEntry2(&mut interface) };
        if status != 0 {
            return Err(format!("GetIfEntry2 failed: {status}"));
        }
        let end = interface.Alias.iter().position(|ch| *ch == 0).unwrap_or(interface.Alias.len());
        let alias = String::from_utf16_lossy(&interface.Alias[..end]);
        if interface.Type == MIB_IF_TYPE_LOOPBACK
            || alias.eq_ignore_ascii_case(crate::core::dns::TUN_ADAPTER_NAME)
        {
            continue;
        }
        let luid = unsafe { row.InterfaceLuid.Value };
        included.insert(luid);
        topology.interfaces.push((luid, row.InterfaceIndex, row.Metric, row.NlMtu, row.Connected, interface.OperStatus));
    }

    let mut routes: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    let status = unsafe { GetIpForwardTable2(AF_INET, &mut routes) };
    if status != 0 || routes.is_null() {
        return Err(format!("GetIpForwardTable2 failed: {status}"));
    }
    let _routes = Table(routes.cast());
    let count = unsafe { (*routes).NumEntries } as usize;
    if count > 4096 {
        return Err("route observation exceeds 4096 rows".into());
    }
    let rows = unsafe { std::slice::from_raw_parts((*routes).Table.as_ptr(), count) };
    for row in rows {
        let luid = unsafe { row.InterfaceLuid.Value };
        if !row.Loopback && included.contains(&luid) {
            // SAFETY: GetIpForwardTable2(AF_INET) returns IPv4 rows, not mixed union variants.
            let destination = unsafe { row.DestinationPrefix.Prefix.Ipv4.sin_addr.S_un.S_addr };
            let next_hop = unsafe { row.NextHop.Ipv4.sin_addr.S_un.S_addr };
            topology.routes.push((luid, destination, row.DestinationPrefix.PrefixLength, next_hop, row.Metric));
        }
    }

    let mut addresses: *mut MIB_UNICASTIPADDRESS_TABLE = std::ptr::null_mut();
    // SAFETY: initialized out pointer, IPv4 family; successful allocation is held by Table.
    let status = unsafe { GetUnicastIpAddressTable(AF_INET, &mut addresses) };
    if status != 0 || addresses.is_null() {
        return Err(format!("GetUnicastIpAddressTable failed: {status}"));
    }
    let _addresses = Table(addresses.cast());
    let count = unsafe { (*addresses).NumEntries } as usize;
    if count > 4096 {
        return Err("address observation exceeds 4096 rows".into());
    }
    // SAFETY: SDK-defined trailing array, bounded above, owned allocation remains alive.
    let rows = unsafe { std::slice::from_raw_parts((*addresses).Table.as_ptr(), count) };
    for row in rows {
        let luid = unsafe { row.InterfaceLuid.Value };
        if included.contains(&luid) {
            // SAFETY: GetUnicastIpAddressTable(AF_INET) returns IPv4 rows.
            let address = unsafe { row.Address.Ipv4.sin_addr.S_un.S_addr };
            topology.addresses.push((luid, address, row.OnLinkPrefixLength, row.DadState));
        }
    }
    topology.interfaces.sort_unstable();
    topology.routes.sort_unstable();
    topology.addresses.sort_unstable();
    topology.interfaces.dedup();
    topology.routes.dedup();
    topology.addresses.dedup();
    // IPv4 is the observation that must succeed. A missing IPv6 stack must not
    // turn every later DNS echo into an unknown topology.
    match read_ipv6_defaults() {
        Ok(defaults) => topology.ipv6_defaults = defaults,
        Err(_) => topology.ipv6_unreadable = true,
    }
    Ok(topology)
}

#[cfg(not(feature = "test"))]
fn read_ipv6_defaults() -> Result<Vec<(u64, [u8; 16], u32)>, String> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetIfEntry2, GetIpForwardTable2, MIB_IF_ROW2, MIB_IF_TYPE_LOOPBACK, MIB_IPFORWARD_TABLE2,
    };
    use windows_sys::Win32::Networking::WinSock::AF_INET6;

    let mut routes: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    // SAFETY: initialized out pointer, IPv6 family; successful allocation is held by Table.
    let status = unsafe { GetIpForwardTable2(AF_INET6, &mut routes) };
    if status != 0 || routes.is_null() {
        return Err(format!("GetIpForwardTable2(AF_INET6) failed: {status}"));
    }
    let _routes = Table(routes.cast());
    let count = unsafe { (*routes).NumEntries } as usize;
    if count > 4096 {
        return Err("IPv6 route observation exceeds 4096 rows".into());
    }
    let rows = unsafe { std::slice::from_raw_parts((*routes).Table.as_ptr(), count) };
    let mut defaults = Vec::new();
    for row in rows {
        if row.Loopback || row.DestinationPrefix.PrefixLength != 0 {
            continue;
        }
        let mut interface = MIB_IF_ROW2 { InterfaceLuid: row.InterfaceLuid, ..Default::default() };
        // SAFETY: InterfaceLuid is taken from the route row; GetIfEntry2 writes the rest.
        let status = unsafe { GetIfEntry2(&mut interface) };
        if status != 0 {
            return Err(format!("GetIfEntry2 failed for an IPv6 default route: {status}"));
        }
        if interface.Type == MIB_IF_TYPE_LOOPBACK {
            continue;
        }
        let end = interface.Alias.iter().position(|ch| *ch == 0).unwrap_or(interface.Alias.len());
        let alias = String::from_utf16_lossy(&interface.Alias[..end]);
        if alias.eq_ignore_ascii_case(crate::core::dns::TUN_ADAPTER_NAME) {
            continue;
        }
        // SAFETY: GetIpForwardTable2(AF_INET6) returns IPv6 rows.
        let next_hop = unsafe { row.NextHop.Ipv6.sin6_addr.u.Byte };
        let luid = unsafe { row.InterfaceLuid.Value };
        defaults.push((luid, next_hop, row.Metric));
    }
    defaults.sort_unstable();
    defaults.dedup();
    Ok(defaults)
}

#[cfg(not(feature = "test"))]
struct Table(*mut core::ffi::c_void);

#[cfg(not(feature = "test"))]
impl Drop for Table {
    fn drop(&mut self) {
        // SAFETY: Table is only constructed after a successful IP Helper allocation.
        unsafe { windows_sys::Win32::NetworkManagement::IpHelper::FreeMibTable(self.0) };
    }
}
