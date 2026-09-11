//! Local physical-uplink observations. No packets, DNS, controller calls or WFP mutations.
//! Metrics choose the route; only LUID/gateway/source changes invalidate its identity.

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct RouteKey {
    luid: u64,
    gateway: [u8; 4],
    source: [u8; 4],
}

#[derive(Clone, Debug)]
struct Candidate {
    key: RouteKey,
    metric: u64,
}

fn choose(candidates: &[Candidate], previous: Option<RouteKey>) -> Option<RouteKey> {
    let minimum = candidates.iter().map(|route| route.metric).min()?;
    // Windows may enumerate equal-cost rows in a different order after a notification.
    // Keep the previous viable uplink on a tie; do not synthesize a network change.
    if let Some(previous) = previous
        && candidates
            .iter()
            .any(|route| route.metric == minimum && route.key == previous)
    {
        return Some(previous);
    }
    candidates
        .iter()
        .filter(|route| route.metric == minimum)
        .map(|route| route.key)
        .min()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RouteEvent {
    Seeded,
    Unchanged,
    Pending,
    Changed,
    Missing,
    Unknown,
}

#[derive(Default)]
pub(super) struct RouteTracker {
    observed: Option<RouteKey>,
    candidate: Option<RouteKey>,
    missing: bool,
}

impl RouteTracker {
    pub(super) fn current(&self) -> Option<RouteKey> {
        self.observed
    }
    pub(super) fn pending(&self) -> bool {
        self.candidate.is_some() || self.missing
    }
    pub(super) fn observe(&mut self, observation: Result<Option<RouteKey>, ()>) -> RouteEvent {
        let route = match observation {
            Err(()) => return RouteEvent::Unknown, // failed observation never erases evidence
            Ok(None) => {
                self.candidate = None;
                self.missing = true;
                return RouteEvent::Missing;
            }
            Ok(Some(route)) => route,
        };
        if self.observed.is_none() && !self.missing {
            self.observed = Some(route);
            return RouteEvent::Seeded;
        }
        if self.observed == Some(route) && !self.missing {
            self.candidate = None;
            return RouteEvent::Unchanged;
        }
        // Two distinct monitor ticks confirm a real change, including wake on the
        // same NIC/gateway. Unlike a counter debounce, the pending change is retained.
        if self.candidate != Some(route) {
            self.candidate = Some(route);
            return RouteEvent::Pending;
        }
        self.observed = Some(route);
        self.candidate = None;
        self.missing = false;
        RouteEvent::Changed
    }
}

#[cfg(any(windows, test))]
struct RouteReadClaim(std::sync::Arc<std::sync::atomic::AtomicBool>);
#[cfg(any(windows, test))]
impl RouteReadClaim {
    fn acquire(flag: &std::sync::Arc<std::sync::atomic::AtomicBool>) -> Option<Self> {
        use std::sync::atomic::Ordering;
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(std::sync::Arc::clone(flag)))
    }
}
#[cfg(any(windows, test))]
impl Drop for RouteReadClaim {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

pub(super) async fn observe_route(previous: Option<RouteKey>) -> Result<Option<RouteKey>, ()> {
    #[cfg(windows)]
    {
        // No external handshake and not part of initial Connected admission.
        // A wedged native call must not strand health monitoring or spawn more
        // blocked threads: only the worker, not the timeout waiter, releases this slot.
        static ACTIVE: std::sync::LazyLock<std::sync::Arc<std::sync::atomic::AtomicBool>> =
            std::sync::LazyLock::new(|| std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)));
        let claim = RouteReadClaim::acquire(&ACTIVE).ok_or(())?;
        let worker = tokio::task::spawn_blocking(move || {
            let _claim = claim;
            read_windows(previous)
        });
        tokio::time::timeout(std::time::Duration::from_secs(2), worker)
            .await
            .map_err(|_| ())?
            .map_err(|_| ())?
    }
    #[cfg(not(windows))]
    {
        let _ = previous;
        Err(()) // never inspect or change the developer Mac's networking
    }
}

#[cfg(windows)]
fn read_windows(previous: Option<RouteKey>) -> Result<Option<RouteKey>, ()> {
    use windows_sys::Win32::{
        NetworkManagement::{
            IpHelper::{
                FreeMibTable, GetBestRoute2, GetIfEntry2, GetIpForwardTable2, GetIpInterfaceEntry,
                IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211, IF_TYPE_PROP_VIRTUAL, IF_TYPE_TUNNEL, MIB_IF_ROW2,
                MIB_IF_TYPE_LOOPBACK, MIB_IPFORWARD_ROW2, MIB_IPFORWARD_TABLE2, MIB_IPINTERFACE_ROW,
            },
            Ndis::{IfOperStatusUp, NET_LUID_LH},
        },
        Networking::WinSock::{AF_INET, SOCKADDR_INET},
    };
    let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    // SAFETY: IP Helper returns an allocated trailing-array table; copied before freeing.
    if unsafe { GetIpForwardTable2(AF_INET, &mut table) } != 0 || table.is_null() {
        return Err(());
    }
    let rows = unsafe { std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize) }.to_vec();
    unsafe { FreeMibTable(table.cast()) };
    let mut candidates = Vec::new();
    let mut uncertain = false;
    for row in rows
        .iter()
        .filter(|row| row.DestinationPrefix.PrefixLength == 0 && !row.Loopback && row.ValidLifetime != 0)
    {
        let luid = unsafe { row.InterfaceLuid.Value };
        let mut interface = MIB_IF_ROW2 {
            InterfaceLuid: NET_LUID_LH { Value: luid },
            ..Default::default()
        };
        if unsafe { GetIfEntry2(&mut interface) } != 0 {
            uncertain = true;
            continue;
        }
        if interface.OperStatus != IfOperStatusUp {
            continue;
        }
        let description = String::from_utf16_lossy(
            &interface.Description[..interface
                .Description
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(interface.Description.len())],
        );
        if is_virtual_uplink_description(&description)
            || matches!(
                interface.Type,
                MIB_IF_TYPE_LOOPBACK | IF_TYPE_PROP_VIRTUAL | IF_TYPE_TUNNEL
            )
            || (interface.InterfaceAndOperStatusFlags._bitfield & 1 == 0
                && !matches!(interface.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211))
        {
            continue;
        }
        let mut ip = MIB_IPINTERFACE_ROW {
            Family: AF_INET,
            InterfaceLuid: NET_LUID_LH { Value: luid },
            ..Default::default()
        };
        if unsafe { GetIpInterfaceEntry(&mut ip) } != 0 {
            uncertain = true;
            continue;
        }
        if ip.DisableDefaultRoutes || !ip.Connected {
            continue;
        }
        // A constrained local route lookup also detects DHCP/source changes. The
        // destination is only input to IP Helper; GetBestRoute2 sends NO packet.
        let mut destination = SOCKADDR_INET::default();
        destination.Ipv4.sin_family = AF_INET;
        destination.Ipv4.sin_addr.S_un.S_addr = u32::from_ne_bytes([1, 0, 0, 1]);
        let mut best = MIB_IPFORWARD_ROW2::default();
        let mut source = SOCKADDR_INET::default();
        let mut net_luid = NET_LUID_LH { Value: luid };
        if unsafe {
            GetBestRoute2(
                &mut net_luid,
                0,
                std::ptr::null(),
                &destination,
                0,
                &mut best,
                &mut source,
            )
        } != 0
        {
            uncertain = true;
            continue;
        }
        // SAFETY: table/lookup requested AF_INET, so these are IPv4 union members.
        let key = unsafe {
            RouteKey {
                luid,
                gateway: row.NextHop.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes(),
                source: source.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes(),
            }
        };
        candidates.push(Candidate {
            key,
            metric: u64::from(row.Metric) + u64::from(ip.Metric),
        });
    }
    // An unreadable candidate may have been the best path. Do not manufacture a
    // switch to a worse route merely because one native read failed.
    if uncertain {
        return Err(());
    }
    Ok(choose(&candidates, previous))
}

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
        "tuntap",
    ];
    let description = description.to_ascii_lowercase();
    MARKERS.iter().any(|marker| description.contains(marker))
}

/// Bounded mutation rate, not a license to keep green without evidence. After
/// the initial quick repairs a standing failure retries at most once per 30 seconds,
/// still observing native health on every tick. No permanent three-try dead end.
#[derive(Default)]
pub(super) struct RepairBudget {
    attempts: u32,
    next: Option<std::time::Instant>,
}
impl RepairBudget {
    pub(super) fn ready(&self, now: std::time::Instant) -> bool {
        self.next.is_none_or(|next| now >= next)
    }
    pub(super) fn attempted(&mut self, now: std::time::Instant) {
        self.attempts = self.attempts.saturating_add(1);
        let delay = match self.attempts {
            1 => 2,
            2 => 5,
            3 => 10,
            _ => 30,
        };
        self.next = Some(now + std::time::Duration::from_secs(delay));
    }
    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn route(luid: u64, gateway: u8, source: u8) -> RouteKey {
        RouteKey {
            luid,
            gateway: [192, 0, 2, gateway],
            source: [192, 0, 2, source],
        }
    }
    #[test]
    fn a_late_native_worker_keeps_its_single_flight_claim() {
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let worker_claim = RouteReadClaim::acquire(&flag).unwrap();
        // A caller giving up does not own this claim and cannot clear it.
        assert!(RouteReadClaim::acquire(&flag).is_none());
        drop(worker_claim);
        assert!(RouteReadClaim::acquire(&flag).is_some());
    }
    #[test]
    fn standing_failure_is_rate_limited_but_not_permanently_abandoned() {
        let mut budget = RepairBudget::default();
        let mut now = std::time::Instant::now();
        for delay in [2, 5, 10, 30, 30, 30] {
            assert!(budget.ready(now));
            budget.attempted(now);
            assert!(!budget.ready(now));
            assert!(!budget.ready(now + std::time::Duration::from_secs(delay - 1)));
            now += std::time::Duration::from_secs(delay);
            assert!(budget.ready(now));
        }
        budget.attempted(now);
        budget.reset();
        assert!(budget.ready(now));
    }
    #[test]
    fn equal_cost_reordering_retains_the_existing_uplink() {
        let a = route(1, 1, 2);
        let b = route(2, 1, 2);
        let candidates = [Candidate { key: a, metric: 10 }, Candidate { key: b, metric: 10 }];
        assert_eq!(choose(&candidates, Some(b)), Some(b));
        assert_eq!(
            choose(&[candidates[1].clone(), candidates[0].clone()], Some(b)),
            Some(b)
        );
        assert_eq!(choose(&candidates, None), Some(a));
    }
    #[test]
    fn effective_metric_wins_and_changes_to_metric_alone_do_not_change_identity() {
        let a = route(1, 1, 2);
        let b = route(2, 1, 2);
        assert_eq!(
            choose(
                &[Candidate { key: a, metric: 110 }, Candidate { key: b, metric: 25 }],
                Some(a)
            ),
            Some(b)
        );
        let mut tracker = RouteTracker::default();
        assert_eq!(tracker.observe(Ok(Some(a))), RouteEvent::Seeded);
        for _ in 0..20 {
            assert_eq!(tracker.observe(Ok(Some(a))), RouteEvent::Unchanged);
        }
    }
    #[test]
    fn gateway_source_and_luid_changes_are_confirmed_not_lost_in_debounce() {
        let a = route(1, 1, 2);
        for b in [route(2, 1, 2), route(1, 3, 2), route(1, 1, 4)] {
            let mut tracker = RouteTracker::default();
            tracker.observe(Ok(Some(a)));
            assert_eq!(tracker.observe(Ok(Some(b))), RouteEvent::Pending);
            assert!(tracker.pending());
            assert_eq!(tracker.observe(Err(())), RouteEvent::Unknown);
            assert_eq!(tracker.current(), Some(a));
            assert_eq!(tracker.observe(Ok(Some(b))), RouteEvent::Changed);
            assert!(!tracker.pending());
            assert_eq!(tracker.observe(Ok(Some(b))), RouteEvent::Unchanged);
        }
    }
    #[test]
    fn wake_on_same_uplink_reconciles_once_but_a_counter_flap_does_not() {
        let a = route(1, 1, 2);
        let b = route(2, 1, 2);
        let mut tracker = RouteTracker::default();
        tracker.observe(Ok(Some(a)));
        assert_eq!(tracker.observe(Ok(Some(b))), RouteEvent::Pending);
        assert_eq!(tracker.observe(Ok(Some(a))), RouteEvent::Unchanged);
        assert_eq!(tracker.observe(Ok(None)), RouteEvent::Missing);
        assert_eq!(tracker.observe(Ok(Some(a))), RouteEvent::Pending);
        assert_eq!(tracker.observe(Ok(Some(a))), RouteEvent::Changed);
        assert_eq!(tracker.observe(Ok(Some(a))), RouteEvent::Unchanged);
    }
}
