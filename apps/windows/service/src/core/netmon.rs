//! Network and power change monitoring for the Windows kill switch.
//!
//! `NotifyIpInterfaceChange` / `NotifyRouteChange2` callbacks and `SERVICE_CONTROL_POWEREVENT`
//! all funnel into one debounced (750 ms) event note. The service-side contract per
//! The kill-switch failure matrix is deliberately narrow: **the barrier stays** —
//! every event is recorded for `/status` reporting and the log, an armed kill switch stays
//! armed, and "Connected invalidated → reconnect behind the barrier" is the product layer's
//! job (it owns the UI `Connected` state; the service merely guarantees the fail-closed link
//! in the chain: event → invalidation signal → still blocking).
//!
//! **What this feed is not.** It answers "the machine's networking changed underneath us", so a
//! change *we* made is out of scope by definition. Writing an adapter's DNS servers is an
//! IP-interface parameter change, and this service writes them on every connect, every restore
//! and every DNS reconcile tick; publishing those callbacks made the product layer tear down
//! and rebuild a perfectly healthy tunnel every few seconds for ever. `raw_notify` therefore
//! defers notifications arriving in the DNS-write window to a bounded topology read. A DNS
//! echo has no interface/route change; a real overlapping change must still reach the App.
//! Pre-window notifications retain their unconditional invalidation semantics.

mod topology;

use once_cell::sync::Lazy;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

const MAX_RECORDED_EVENTS: usize = 32;
#[cfg_attr(feature = "test", allow(dead_code))]
const DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(750);
/// Max-latency bound: sustained churn with gaps < `DEBOUNCE` must still surface an event.
#[cfg_attr(feature = "test", allow(dead_code))]
const DEBOUNCE_MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

static EVENTS: Lazy<Mutex<VecDeque<String>>> = Lazy::new(|| Mutex::new(VecDeque::new()));
static LAST_KIND: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
static LAST_AT: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static CHANGE_COUNT: AtomicU64 = AtomicU64::new(0);
#[cfg_attr(feature = "test", allow(dead_code))]
static STARTED: AtomicBool = AtomicBool::new(false);
static PENDING_RAW: AtomicBool = AtomicBool::new(false);
static PENDING_EXTERNAL: AtomicBool = AtomicBool::new(false);
static LAST_RAW_MILLIS: AtomicU64 = AtomicU64::new(0);
static FIRST_RAW_MILLIS: AtomicU64 = AtomicU64::new(0);

/// One observation per debounced batch; no queue of callbacks or unbounded read retries.
struct Reconciler {
    baseline: Option<topology::Topology>,
    unknown_reported: bool,
}

impl Reconciler {
    fn observe(&mut self, observed: Result<topology::Topology, String>, external: bool) -> Option<&'static str> {
        match observed {
            Ok(current) => {
                let changed = self.baseline.as_ref().is_none_or(|old| *old != current);
                self.baseline = Some(current);
                self.unknown_reported = false;
                (external || changed).then_some("network-change (ip-interface/route)")
            }
            Err(error) => {
                // Unknown is never "unchanged", but do not create a reconnect loop merely
                // because repeated DNS echoes meet one persistently unreadable IP Helper.
                let report = external || !self.unknown_reported;
                if report { tracing::warn!("netmon: topology observation unavailable: {error}"); }
                self.unknown_reported = true;
                report.then_some("network-observation-unknown")
            }
        }
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Record an event. Never disarms anything — see the module doc.
pub(crate) fn note_event(kind: &str) {
    CHANGE_COUNT.fetch_add(1, Ordering::Relaxed);
    *LAST_KIND.lock().unwrap() = Some(kind.to_owned());
    LAST_AT.store(now_unix() as i64, Ordering::Relaxed);
    let event = format!("{kind} @{}", now_unix());
    tracing::info!("netmon: {event}");
    let mut events = EVENTS.lock().unwrap();
    events.push_back(event);
    while events.len() > MAX_RECORDED_EVENTS {
        events.pop_front();
    }
}

/// `SERVICE_CONTROL_POWEREVENT` from the SCM control handler: sleep/wake invalidates
/// `Connected`; the WFP barrier is untouched.
pub fn note_power_event() {
    note_event("power-event");
}

/// The pollable counter + latest-event summary the product layer watches via `/status`.
pub fn status() -> crate::core::structure::NetworkEventsStatus {
    crate::core::structure::NetworkEventsStatus {
        counter: CHANGE_COUNT.load(Ordering::Relaxed),
        last_kind: LAST_KIND.lock().unwrap().clone(),
        last_at: match LAST_AT.load(Ordering::Relaxed) {
            0 => None,
            value => Some(value),
        },
    }
}

/// Total events seen since service start (test/diagnostic hook).
#[cfg(test)]
pub fn change_count() -> u64 {
    CHANGE_COUNT.load(Ordering::Relaxed)
}

/// Debounce decision: fire after `DEBOUNCE` of raw-notification silence, or once the first
/// still-pending raw event is `DEBOUNCE_MAX_WAIT` old — otherwise sustained churn (gaps all
/// under `DEBOUNCE`) would starve `note_event` forever and freeze the `/status` counter.
#[cfg_attr(feature = "test", allow(dead_code))]
fn debounce_should_fire(quiet_millis: u64, pending_for_millis: u64) -> bool {
    quiet_millis >= DEBOUNCE.as_millis() as u64
        || pending_for_millis >= DEBOUNCE_MAX_WAIT.as_millis() as u64
}

/// Whether a raw notification arriving *now* belongs to the product-facing feed.
///
/// `false` means defer to topology reconciliation, NOT proof that this callback is a DNS echo.
/// The decision is a load-only atomic read in `dns`, which matters: this runs on an
/// IPHelper callback thread that must never block and is not a tokio context, so it cannot take
/// the `DNS_OPERATION` lock that the apply itself holds.
#[cfg_attr(feature = "test", allow(dead_code))]
fn raw_should_publish() -> bool {
    !crate::core::dns::in_self_write_window()
}

fn anchor() -> std::time::Instant {
    static ANCHOR: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    *ANCHOR.get_or_init(std::time::Instant::now)
}

/// Callback bookkeeping is shared by native registration and deterministic tests. No I/O or
/// async lock is allowed on the IPHelper callback thread.
fn raw_notify(kind: &str, notification_type: windows_sys::Win32::NetworkManagement::IpHelper::MIB_NOTIFICATION_TYPE) {
    if !raw_should_publish() {
        let total = crate::core::dns::note_suppressed_self_write();
        tracing::debug!(
            "netmon: raw notification {kind} (type {notification_type}) overlaps a DNS write; \
             deferred to topology reconciliation ({total} deferred since start)"
        );
    } else {
        PENDING_EXTERNAL.store(true, Ordering::Release);
    }
    let now = anchor().elapsed().as_millis() as u64;
    LAST_RAW_MILLIS.store(now, Ordering::Relaxed);
    if !PENDING_RAW.load(Ordering::Relaxed) {
        FIRST_RAW_MILLIS.store(now, Ordering::Relaxed);
    }
    PENDING_RAW.store(true, Ordering::Release);
    tracing::debug!("netmon raw notification: {kind} (type {notification_type})");
}

/// Register the IP-interface and route change notifications plus the debounce task.
/// Idempotent; the registrations live for the service's lifetime by design.
pub fn start() {
    #[cfg(not(feature = "test"))]
    imp::start();
}

#[cfg(not(feature = "test"))]
mod imp {
    use super::{FIRST_RAW_MILLIS, LAST_RAW_MILLIS, PENDING_RAW, PENDING_EXTERNAL, STARTED, Reconciler, anchor, note_event, raw_notify, topology};
    use std::sync::atomic::Ordering;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        MIB_IPFORWARD_ROW2, MIB_IPINTERFACE_ROW, MIB_NOTIFICATION_TYPE, NotifyIpInterfaceChange,
        NotifyRouteChange2,
    };
    use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;

    /// SAFETY: registered with `NotifyIpInterfaceChange`; called on an IPHelper thread with a
    /// valid (possibly null) row pointer we never dereference.
    unsafe extern "system" fn on_ip_interface_change(
        _context: *const core::ffi::c_void,
        _row: *const MIB_IPINTERFACE_ROW,
        notification_type: MIB_NOTIFICATION_TYPE,
    ) {
        raw_notify("ip-interface", notification_type);
    }

    /// SAFETY: registered with `NotifyRouteChange2`; same contract as above.
    unsafe extern "system" fn on_route_change(
        _context: *const core::ffi::c_void,
        _row: *const MIB_IPFORWARD_ROW2,
        notification_type: MIB_NOTIFICATION_TYPE,
    ) {
        raw_notify("route", notification_type);
    }

    pub(super) fn start() {
        if STARTED.swap(true, Ordering::AcqRel) {
            return;
        }
        anchor();
        // Seed before registering: the first deferred callback must compare against the
        // pre-change state, not seed itself and silently lose the change.
        let baseline = topology::read().ok();
        // Leaked out-handle slots: registrations are process-lifetime by design, so the slots
        // must never be freed or reused (also keeps edition-2024 `static_mut_refs` out).
        let interface_handle: &'static mut windows_sys::Win32::Foundation::HANDLE =
            Box::leak(Box::new(std::ptr::null_mut()));
        let route_handle: &'static mut windows_sys::Win32::Foundation::HANDLE =
            Box::leak(Box::new(std::ptr::null_mut()));
        // SAFETY: the out-handles live for the process lifetime; callbacks are valid
        // `extern "system"` fns with a null context.
        let mut registered = false;
        unsafe {
            let status = NotifyIpInterfaceChange(
                AF_UNSPEC,
                Some(on_ip_interface_change),
                std::ptr::null(),
                false,
                interface_handle,
            );
            if status != 0 {
                tracing::warn!("NotifyIpInterfaceChange failed: Windows error {status}");
            } else {
                registered = true;
            }
            let status = NotifyRouteChange2(
                AF_UNSPEC,
                Some(on_route_change),
                std::ptr::null(),
                false,
                route_handle,
            );
            if status != 0 {
                tracing::warn!("NotifyRouteChange2 failed: Windows error {status}");
            } else {
                registered = true;
            }
        }
        if !registered {
            // Neither notification registered: release the latch so a later `start()` can
            // retry instead of leaving the monitor permanently dead but marked started.
            // (A partial success keeps the latch — retrying would double-register.)
            STARTED.store(false, Ordering::Release);
            return;
        }

        tokio::spawn(async move {
            let mut reconciler = Reconciler { baseline, unknown_reported: false };
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
            loop {
                interval.tick().await;
                if !PENDING_RAW.load(Ordering::Acquire) {
                    continue;
                }
                let elapsed = anchor().elapsed().as_millis() as u64;
                let quiet = elapsed.saturating_sub(LAST_RAW_MILLIS.load(Ordering::Relaxed));
                let pending_for = elapsed.saturating_sub(FIRST_RAW_MILLIS.load(Ordering::Relaxed));
                // Let the normal write/tail settle, with the existing 3-second maximum wait
                // even during continuous DNS churn. The comparison contains no DNS fields.
                if !super::raw_should_publish() && pending_for < super::DEBOUNCE_MAX_WAIT.as_millis() as u64 {
                    continue;
                }
                if super::debounce_should_fire(quiet, pending_for)
                    && PENDING_RAW.swap(false, Ordering::AcqRel)
                {
                    // Re-anchor the cap alongside the cleared flag so a callback racing the
                    // swap can't leave a stale first-pending stamp (worst case: one early
                    // extra event — benign).
                    FIRST_RAW_MILLIS.store(elapsed, Ordering::Relaxed);
                    let external = PENDING_EXTERNAL.swap(false, Ordering::AcqRel);
                    // At most one read worker, never one per callback. No DNS_OPERATION lock,
                    // mutation, or blocking native read on an IPHelper callback thread.
                    let observed = tokio::task::spawn_blocking(topology::read).await
                        .unwrap_or_else(|_| Err("topology read task failed".into()));
                    if let Some(kind) = reconciler.observe(observed, external) {
                        note_event(kind);
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    #[test]
    #[serial]
    fn events_are_recorded_and_bounded() {
        for index in 0..(super::MAX_RECORDED_EVENTS + 8) {
            super::note_event(&format!("test-event-{index}"));
        }
        assert!(super::change_count() >= super::MAX_RECORDED_EVENTS as u64);
    }

    #[test]
    #[serial]
    fn a_real_network_change_during_dns_write_is_deferred_not_discarded() {
        use std::sync::atomic::Ordering;
        super::PENDING_RAW.store(false, Ordering::Release);
        let before = super::change_count();
        let window = crate::core::dns::open_self_write_window_for_tests();
        super::raw_notify("route", 1);
        super::raw_notify("ip-interface", 1);
        let retained = super::PENDING_RAW.swap(false, Ordering::AcqRel);
        drop(window);
        assert_eq!(super::change_count(), before, "the callback must not publish a DNS echo");
        assert!(retained, "the worker must reconcile physical changes that overlap a DNS write");
        let baseline = super::topology::Topology {
            interfaces: vec![(17, 3, 25, 1500, true)],
            routes: vec![(17, 0, 0, 0x0100000a, 10)],
        };
        let mut reconciler = super::Reconciler { baseline: Some(baseline.clone()), unknown_reported: false };
        assert!(reconciler.observe(Ok(baseline.clone()), false).is_none(), "DNS-only echoes stay quiet");
        let mut moved = baseline;
        moved.routes[0].3 = 0x0200000a;
        assert!(reconciler.observe(Ok(moved.clone()), false).is_some(), "same adapter, changed gateway is real");
        assert!(reconciler.observe(Ok(moved), false).is_none(), "one batch must not repeat forever");
        assert_eq!(reconciler.observe(Err("synthetic read refusal".into()), false), Some("network-observation-unknown"));
        assert!(reconciler.observe(Err("still unreadable".into()), false).is_none());
    }

    /// The P0: a DNS write of ours must not reach the product-facing feed, and dropping the
    /// guard must give the write depth back. The short asynchronous tail is covered by the
    /// pure decision test in `dns`.
    #[test]
    #[serial]
    fn our_own_dns_writes_are_not_published_as_network_changes() {
        assert_eq!(
            crate::core::dns::self_write_depth_for_tests(),
            0,
            "the test must start without a DNS write in flight"
        );
        {
            let _window = crate::core::dns::open_self_write_window_for_tests();
            assert!(
                !super::raw_should_publish(),
                "a notification raised by our own DNS write must not be published"
            );
        }
        // The tail keeps suppressing for a moment after the guard drops (the callback is
        // asynchronous), but the guard itself never leaves a window open.
        assert_eq!(crate::core::dns::self_write_depth_for_tests(), 0);
    }

    #[test]
    fn debounce_fires_on_quiet_or_max_wait() {
        let debounce = super::DEBOUNCE.as_millis() as u64;
        let max_wait = super::DEBOUNCE_MAX_WAIT.as_millis() as u64;
        // Quiet gap reached: fires regardless of burst age.
        assert!(super::debounce_should_fire(debounce, 0));
        // Sustained churn (gaps under the debounce) must still fire once the first
        // pending raw event hits the max-latency cap.
        assert!(super::debounce_should_fire(0, max_wait));
        // Neither threshold reached: keep waiting.
        assert!(!super::debounce_should_fire(debounce - 1, max_wait - 1));
    }
}
