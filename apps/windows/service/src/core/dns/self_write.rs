use super::*;

// --- Self-inflicted network-change suppression ---
//
// Writing an adapter's DNS servers *is* an IP-interface parameter change, so every per-adapter
// write here can make Windows call back into `NotifyIpInterfaceChange` — the same notification
// `netmon` publishes to the product layer as "the machine's networking changed underneath us".
// The product layer answers that signal with a full teardown + reconnect, and a reconnect
// re-applies DNS: Connected → Protected Offline → Connecting → Connected, for ever, restarting
// the core and recreating WinTUN every few seconds. A change *we* just made is not a change to
// the machine's networking underneath us, so it must not be published as one.
//
// The window is opened by the functions that actually write ([`engine_apply_protected`],
// [`engine_apply_snapshot`], [`engine_suppress_encrypted_dns`] and
// [`engine_restore_encrypted_dns`]) and by nothing else. It deliberately does **not** cover the
// enumeration, the read-back or the cache flush, which are reads and are also the slowest part
// of an `enable` round: keeping them outside is what keeps the window narrow enough that a
// genuine change is very unlikely to land entirely inside it.
//
// **Concurrency.** No lock protects this state and none can: `netmon`'s reader runs on an
// IPHelper callback thread that must never block, and it is not a tokio context, so it cannot
// take `DNS_OPERATION` (the tokio mutex every apply already holds, which is what keeps the
// depth at one in practice). The state is therefore three atomics, read with a single pure
// decision function, and every race in it resolves toward *publishing* — never toward silence.
//
// **The window cannot stick on.** It is opened by an RAII guard whose `Drop` is the only writer
// that lowers the depth, so a panic or an early `?` closes the guard that the async caller
// holds. A timed-out `bounded_dns_call` or a dropped future does **not** finish the registry
// write: `spawn_blocking` keeps running. That write holds its own guard until it returns, so
// the notification it raises is still ours. `SELF_WRITE_MAX_WINDOW` is the belt-and-braces
// half: past that age an open window stops suppressing even if a depth were leaked.
//
// **It is harmless if DNS writes never raise the notification at all** (the one link in the
// audit that only a Windows machine can settle): with no notification there is nothing to
// suppress and the code is dead weight during a handful of milliseconds per connect.

/// How long after the last write window closes a raw notification is still attributed to it.
/// `NotifyIpInterfaceChange` is asynchronous — the callback arrives on an IPHelper thread some
/// time after the write returns — so the window needs a tail or it would suppress nothing.
/// 1.5 s is twice `netmon`'s 750 ms debounce, so a callback that arrives late enough to open a
/// fresh debounce burst is still inside the window that caused it.
pub(super) const SELF_WRITE_TAIL: std::time::Duration = std::time::Duration::from_millis(1_500);

/// Hard age cap on a single open window, independent of the guard. `DNS_APPLY_TIMEOUT` bounds
/// the apply itself, so a window older than this cannot be an apply that is still running; it
/// could only be a leaked depth, and a leaked depth must not mute the machine's network events
/// for the life of the service.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) const SELF_WRITE_MAX_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

/// Number of currently-open write windows (`0` = none).
pub(super) static SELF_WRITE_DEPTH: AtomicU32 = AtomicU32::new(0);
/// Monotonic millis at which the outermost currently-open window was opened.
pub(super) static SELF_WRITE_OPENED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Monotonic millis until which the tail of the last closed window runs.
pub(super) static SELF_WRITE_TAIL_UNTIL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Raw notifications deferred for topology reconciliation during a write window. Diagnostic only.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) static SELF_WRITE_SUPPRESSED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Process-lifetime monotonic clock in milliseconds. `Instant` is boot-relative on Windows and
/// not `const`-constructible, so the anchor is lazy and everything else is a plain `u64`.
pub(super) fn monotonic_millis() -> u64 {
    static ANCHOR: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    ANCHOR
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis() as u64
}

/// The whole suppression decision, as a pure function of the four observable values.
///
/// An open window suppresses only while it is younger than [`SELF_WRITE_MAX_WINDOW`]; once it
/// is older, the answer falls through to the tail of the last *closed* window, which is in the
/// past — so an aged-out window publishes again by itself.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(super) fn self_write_window_is_open(
    now_millis: u64,
    depth: u32,
    opened_at_millis: u64,
    tail_until_millis: u64,
) -> bool {
    if depth > 0
        && now_millis.saturating_sub(opened_at_millis) < SELF_WRITE_MAX_WINDOW.as_millis() as u64
    {
        return true;
    }
    now_millis < tail_until_millis
}

/// Whether a network notification observed *now* is attributable to a DNS write of ours.
/// Called from `netmon`'s notification callback: loads only, never blocks, never allocates.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(crate) fn in_self_write_window() -> bool {
    self_write_window_is_open(
        monotonic_millis(),
        SELF_WRITE_DEPTH.load(Ordering::Acquire),
        SELF_WRITE_OPENED_AT.load(Ordering::Relaxed),
        SELF_WRITE_TAIL_UNTIL.load(Ordering::Relaxed),
    )
}

/// Count a notification `netmon` deferred during a window. Returns the running total
/// so the caller can put it in one log line.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(crate) fn note_suppressed_self_write() -> u64 {
    SELF_WRITE_SUPPRESSED.fetch_add(1, Ordering::Relaxed) + 1
}

#[cfg(test)]
pub(super) fn suppressed_self_writes() -> u64 {
    SELF_WRITE_SUPPRESSED.load(Ordering::Relaxed)
}

/// Test hooks for `netmon`, whose own callback path is `cfg`-ed out of test builds — and whose
/// whole module is Windows-only, so they are dead on every other host.
#[cfg(test)]
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn open_self_write_window_for_tests() -> SelfWriteWindow {
    SelfWriteWindow::open()
}

#[cfg(test)]
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn self_write_depth_for_tests() -> u32 {
    SELF_WRITE_DEPTH.load(Ordering::Acquire)
}

/// RAII marker for "this service is writing adapter DNS right now".
///
/// Deliberately a guard and not a flag: the apply it wraps can fail or panic, and unwinding
/// closes the window. Nothing else in this module may set the state directly.
///
/// The guard the async function holds dies when `bounded_dns_call` times out or the future is
/// dropped. The registry write does not: it runs on a blocking thread. [`hold_self_write_across_the_write`]
/// is that thread's guard, and it is the one that must stay up until the write returns.
#[must_use = "the suppression window closes the moment the guard is dropped"]
pub(crate) struct SelfWriteWindow(());

impl SelfWriteWindow {
    pub(super) fn open() -> Self {
        let now = monotonic_millis();
        // Stamp the age anchor *before* the depth becomes observable, so a reader that sees
        // `depth > 0` can never pair it with a stale anchor from an earlier window and decide
        // the window has already aged out.
        if SELF_WRITE_DEPTH.load(Ordering::Acquire) == 0 {
            SELF_WRITE_OPENED_AT.store(now, Ordering::Relaxed);
        }
        SELF_WRITE_DEPTH.fetch_add(1, Ordering::AcqRel);
        SelfWriteWindow(())
    }
}

/// Hold the self-write window for the whole registry write, including after the async
/// caller has given up and dropped its own guard.
#[cfg_attr(
    not(any(test, all(windows, not(feature = "test")))),
    allow(dead_code)
)]
pub(super) fn hold_self_write_across_the_write<T>(work: impl FnOnce() -> T) -> T {
    let _window = SelfWriteWindow::open();
    work()
}

impl Drop for SelfWriteWindow {
    fn drop(&mut self) {
        // Extend the tail *before* lowering the depth: the reverse order leaves an instant in
        // which the window reads as closed and the tail has not started yet, and a callback
        // landing in it would publish the write we just made.
        let until = monotonic_millis().saturating_add(SELF_WRITE_TAIL.as_millis() as u64);
        SELF_WRITE_TAIL_UNTIL.fetch_max(until, Ordering::AcqRel);
        SELF_WRITE_DEPTH.fetch_sub(1, Ordering::AcqRel);
    }
}
