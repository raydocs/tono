//! Read-only local route observations. No packets, state transitions, route writes or repair.
//! A representative fake-ip sample is NOT proof of every destination or remote reachability.

use std::net::Ipv4Addr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RouteClass {
    TonoTunnel,
    Physical,
    OtherInterface,
    Unknown,
}

#[derive(Clone, Debug)]
pub(crate) struct RouteObservation {
    pub tunnel_luid: Option<u64>,
    pub fake_ip_sample: RouteClass,
    pub selected_vps: RouteClass,
    pub tunnel_error: Option<u32>,
    pub fake_ip_error: Option<u32>,
    pub vps_error: Option<u32>,
    pub unavailable: Option<&'static str>,
}

impl RouteObservation {
    fn unavailable(reason: &'static str) -> Self {
        Self {
            tunnel_luid: None,
            fake_ip_sample: RouteClass::Unknown,
            selected_vps: RouteClass::Unknown,
            tunnel_error: None,
            fake_ip_error: None,
            vps_error: None,
            unavailable: Some(reason),
        }
    }

    pub(crate) fn render(&self) -> String {
        format!(
            "aliasTunLuid={:?} fakeIpSample={:?} selectedVps={:?} nativeCodes={:?}/{:?}/{:?} unavailable={:?}",
            self.tunnel_luid,
            self.fake_ip_sample,
            self.selected_vps,
            self.tunnel_error,
            self.fake_ip_error,
            self.vps_error,
            self.unavailable
        )
    }
}

#[cfg(any(windows, test))]
fn classify_route(tunnel_luid: Option<u64>, route_luid: u64, physical: Option<bool>) -> RouteClass {
    if route_luid == 0 {
        return RouteClass::Unknown;
    }
    if tunnel_luid == Some(route_luid) {
        return RouteClass::TonoTunnel;
    }
    match physical {
        Some(true) => RouteClass::Physical,
        Some(false) => RouteClass::OtherInterface,
        None => RouteClass::Unknown,
    }
}

#[cfg(any(windows, test))]
struct ReadClaim(std::sync::Arc<std::sync::atomic::AtomicBool>);
#[cfg(any(windows, test))]
impl ReadClaim {
    fn acquire(flag: &std::sync::Arc<std::sync::atomic::AtomicBool>) -> Option<Self> {
        use std::sync::atomic::Ordering;
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(std::sync::Arc::clone(flag)))
    }
}
#[cfg(any(windows, test))]
impl Drop for ReadClaim {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[cfg(windows)]
pub(crate) async fn observe(selected_vps: Ipv4Addr, tunnel_alias: &'static str) -> RouteObservation {
    use std::sync::{Arc, LazyLock, atomic::AtomicBool};
    static IN_FLIGHT: LazyLock<Arc<AtomicBool>> = LazyLock::new(|| Arc::new(AtomicBool::new(false)));
    let Some(claim) = ReadClaim::acquire(&IN_FLIGHT) else {
        return RouteObservation::unavailable("readAlreadyRunning");
    };
    let task = tokio::task::spawn_blocking(move || {
        // A timed-out native read keeps this claim until its worker exits. No unbounded workers.
        let _claim = claim;
        native_observe(selected_vps, tunnel_alias)
    });
    match tokio::time::timeout(std::time::Duration::from_secs(2), task).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => RouteObservation::unavailable("workerFailed"),
        Err(_) => RouteObservation::unavailable("readTimedOut"),
    }
}

#[cfg(not(windows))]
pub(crate) async fn observe(_selected_vps: Ipv4Addr, _tunnel_alias: &'static str) -> RouteObservation {
    RouteObservation::unavailable("notWindows")
}

#[cfg(windows)]
fn native_observe(selected_vps: Ipv4Addr, tunnel_alias: &str) -> RouteObservation {
    use windows_sys::Win32::NetworkManagement::{
        IpHelper::{
            ConvertInterfaceAliasToLuid, GetBestRoute2, GetIfEntry2, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211,
            MIB_IF_ROW2, MIB_IPFORWARD_ROW2,
        },
        Ndis::NET_LUID_LH,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_INET};

    let alias = tunnel_alias
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut tunnel = NET_LUID_LH::default();
    // SAFETY: terminated alias and valid output; no network or machine mutation.
    let tunnel_status = unsafe { ConvertInterfaceAliasToLuid(alias.as_ptr(), &mut tunnel) };
    let tunnel_luid = (tunnel_status == 0)
        .then(|| unsafe { tunnel.Value })
        .filter(|luid| *luid != 0);
    let read = |address: Ipv4Addr| -> (RouteClass, Option<u32>) {
        let mut destination = SOCKADDR_INET::default();
        destination.Ipv4.sin_family = AF_INET;
        destination.Ipv4.sin_addr.S_un.S_addr = u32::from_ne_bytes(address.octets());
        let mut best = MIB_IPFORWARD_ROW2::default();
        let mut source = SOCKADDR_INET::default();
        // Unconstrained lookup: forcing InterfaceLuid=Tono here would "prove" our own input.
        // GetBestRoute2 reads local selection, not an HTTP/TCP probe; inputs are never logged.
        // https://learn.microsoft.com/windows/win32/api/netioapi/nf-netioapi-getbestroute2
        let status = unsafe {
            GetBestRoute2(
                std::ptr::null(),
                0,
                std::ptr::null(),
                &destination,
                0,
                &mut best,
                &mut source,
            )
        };
        if status != 0 {
            return (RouteClass::Unknown, Some(status));
        }
        let luid = unsafe { best.InterfaceLuid.Value };
        let mut row = MIB_IF_ROW2 {
            InterfaceLuid: best.InterfaceLuid,
            ..Default::default()
        };
        // SAFETY: valid output initialized with the selected route's interface identity.
        let interface_status = unsafe { GetIfEntry2(&mut row) };
        let physical = (interface_status == 0).then(|| {
            matches!(row.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211)
                && row.InterfaceAndOperStatusFlags._bitfield & 1 != 0
        });
        (
            classify_route(tunnel_luid, luid, physical),
            (interface_status != 0).then_some(interface_status),
        )
    };
    // Sample outside the tunnel's /30 resolver addresses; distinguish sample coverage from
    // real per-destination forwarding. It never authorizes a physical permit or a green light.
    let (fake_ip_sample, fake_ip_error) = read(Ipv4Addr::new(198, 18, 1, 1));
    let (selected_vps, vps_error) = read(selected_vps);
    RouteObservation {
        tunnel_luid,
        fake_ip_sample,
        selected_vps,
        tunnel_error: (tunnel_status != 0).then_some(tunnel_status),
        fake_ip_error,
        vps_error,
        unavailable: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_or_other_virtual_interface_does_not_become_physical_or_tono() {
        assert_eq!(classify_route(Some(7), 7, None), RouteClass::TonoTunnel);
        assert_eq!(classify_route(Some(7), 8, Some(true)), RouteClass::Physical);
        assert_eq!(classify_route(Some(7), 8, Some(false)), RouteClass::OtherInterface);
        assert_eq!(classify_route(None, 8, None), RouteClass::Unknown);
        assert_eq!(classify_route(None, 0, Some(true)), RouteClass::Unknown);
    }

    #[test]
    fn native_worker_owns_single_flight_until_it_finishes() {
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let claim = ReadClaim::acquire(&flag).unwrap();
        assert!(ReadClaim::acquire(&flag).is_none());
        drop(claim);
        assert!(ReadClaim::acquire(&flag).is_some());
    }

    #[test]
    fn report_carries_only_classes_and_native_codes_not_destinations() {
        let report = RouteObservation::unavailable("readTimedOut").render();
        assert!(report.contains("Unknown"));
        assert!(!report.contains("198.18."));
    }
}
