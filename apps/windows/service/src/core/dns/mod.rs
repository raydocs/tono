//! Per-adapter DNS protection for the Windows kill switch.
//!
//! Snapshot every adapter's IPv4/IPv6 `NameServer`/`ProfileNameServer` → point IPv4 at Mihomo's
//! TUN-side DNS endpoint (`198.18.0.2`) and leave IPv6 with **no servers at all** → read back what
//! can be read back (evidence on the way in, a *gate* only on the way out) → restore from the
//! snapshot on disconnect. The snapshot (`protected-dns.json`) is
//! written atomically to the service state directory *before* any value is changed — the same
//! discipline as the kill-switch intent record.
//!
//! **Why IPv4 uses the TUN endpoint instead of the loopback listener.** Mihomo listens on
//! `127.0.0.1:53`, but with `strict-route` and `dns-hijack` a Windows resolver query addressed
//! there is reclassified during the loopback/TUN transition and does not reach the listener on
//! real machines. The pinned core publishes `198.18.0.2` as the DNS endpoint on the Tono
//! adapter; a real-machine probe proved that endpoint returns fake IPs while an explicit query
//! to `127.0.0.1` times out. Pointing adapters at the TUN endpoint also makes the security path
//! unambiguous: the query must traverse the permitted Tono interface, while WFP default-deny
//! blocks physical DNS.
//!
//! **Why IPv6 gets an empty server list and not `::1`.** Nothing listens on `[::1]:53`. A build
//! that pointed the IPv6 family at `::1` therefore configured a resolver
//! that never answers, and every system lookup that Windows tried over IPv6 first waited out
//! its full timeout: the fake-ip readiness probe failed three attempts at 2 s each and connect
//! died in `securingDNS` on a machine whose DNS was otherwise fine. Nothing was bought for it —
//! IPv6 DNS to a physical resolver is already *blocked* by WFP (the weight-6 `block-dns` filter
//! on `CONNECT_V6` plus the condition-free v6 block-all), so `::1` prevented no leak. The
//! protected IPv6 state is an empty **static** list ([`NO_NAME_SERVERS`]) — deliberately not
//! DHCP, which would hand the ISP's resolvers straight back and *would* be a leak — so Windows
//! falls through to the IPv4 TUN resolver, which answers. `::1` is still *recognised* as a
//! protected/loopback value everywhere on the proof path, because adapters left that way by an
//! older build must not read as restored.
//!
//! **The enable-time read-back is evidence, not a gate.** Applying protected DNS is a *write*;
//! proving it from Windows is not reliably possible. The registry stores "static, no servers"
//! and "use DHCP" identically (which is why the IPv6 leg of the read-back was already removed),
//! and the live apply runs through PowerShell/CIM/netsh, which fails on real machines for
//! reasons that have nothing to do with whether DNS works: pseudo-adapters, constrained language
//! mode, EDR hooks, a damaged WMI repository. Gating `enable` on that weak proof killed connects
//! on machines whose DNS was fine — the last one bailed with "protected DNS could not be verified
//! on every active adapter" at 1.1 s, *before* the strong proof ever ran. So `enable` now
//! **records** what it could not verify (per-adapter live-apply failures in the snapshot and in
//! [`LIVE_APPLY_FAILURES`]; the whole round in `DNS_LAST_ERROR` and therefore in the status
//! payload, behind [`DNS_PROTECTION_UNVERIFIED_PREFIX`]) and returns success, so the connect
//! reaches the proof that is actually direct: `verify_fake_ip` in the App resolves a name through
//! the OS and demands an answer in `198.18/16`. Nothing is traded away by demoting the weak
//! proof, because WFP default-denies DNS on the physical interfaces while its verified-TUN
//! permit admits the `198.18.0.2` path: a machine whose DNS configuration cannot be verified
//! cannot leak, it can only fail to resolve — and failing to resolve is exactly what the
//! fake-ip probe catches, with the recorded note in the status payload to say why. What stays a
//! hard failure of `enable` is the case where **no per-adapter
//! outcome exists at all** (the adapter enumeration or the apply batch itself errored, or the
//! record of the round could not be persisted): then there is nothing to restore, nothing to
//! reconcile, and nothing truthful to report.
//!
//! **Encrypted DNS is pinned off for the session.** Win10/11 Encrypted DNS and per-adapter
//! DoH templates send lookups over HTTPS to a public resolver. WFP then default-denies that
//! path, so the App's `DnsQueryEx` waits out 5 s and connect dies in `securingDNS` even though
//! TUN DNS at `198.18.0.2` answers in milliseconds. While protected we snapshot
//! `EnableAutoDoh`, set it to 0, zero per-adapter `DohFlags` under
//! `InterfaceSpecificParameters\{guid}\DohInterfaceSettings\Doh{,6}\{server}`
//! (the Settings UI "Encrypted only / preferred" path), and install a catch-all NRPT
//! rule to the TUN resolver; disconnect restores all three. That does not widen WFP:
//! queries still have to traverse the permitted TUN interface.
//!
//! **DNS-before-disarm invariant (identical to the macOS helper):** the kill switch may only
//! disarm after DNS restore is *proven*; if restore cannot be proven, the disarm is refused
//! and the block stays armed. See `windows_kill_switch::disarm_unlocked`.
//!
//! **The one place that invariant is deliberately traded away is *uninstall*.** Refusing to
//! release while the product stays installed costs the user a retry; refusing at uninstall time
//! costs them an application they cannot remove, which is not an acceptable outcome for
//! consumer software. [`restore_for_uninstall`] is the escalation ladder that replaces the
//! single refusal there — exact restore, then automatic (DHCP), then refusal — and it is
//! reached only from the uninstaller. Read the block comment above `uninstall_restore_rung`
//! before changing it; nothing on the Disconnect / release / quit path goes through it.
//!
//! **Proof is read off the machine as it is now, never off history:** a restore is proven when
//! the registry read-back matches the snapshot exactly *and* a live read says that nothing on
//! the machine still resolves through a Tono-owned protected target. Per-adapter live-apply results are
//! still recorded (in memory and in the snapshot file) and a failed live-apply is still retried
//! once during restore, but a `live_apply_failed` bit from an earlier round is a reason to
//! *demand* that live evidence — never a veto over evidence that is already in. It used to be
//! a veto, and that is exactly how a machine whose resolvers were provably the user's own again
//! (`registry_match=true`) was refused release on a single stale failure while the degraded
//! exit below needs a streak of three that one click on Disconnect can never reach. Evidence
//! that cannot be obtained is *unproven*, never proven — fail-closed for the normal disarm,
//! while the emergency path stays the documented escape hatch (it logs and proceeds).
//!
//! **The live apply is per address family.** IPv4 goes through CIM
//! (`SetDNSServerSearchOrder`, an IPv4-only method), IPv6 through `netsh interface ipv6 set
//! dnsservers`, and each family is proven by its own live read-back. Merging both families into
//! one CIM call either fails on every adapter or silently drops the IPv6 address, which leaves
//! an IPv6 resolver leaking while the registry still reads "protected".
//!
//! **Degraded exit:** a registry-only match is not accepted as a
//! normal restore — but it *is* accepted, once, after the live apply has failed
//! `DEGRADED_RESTORE_STREAK` rounds in a row and the registry read-back matches the snapshot
//! exactly. On a machine where PowerShell/CIM is structurally unavailable (constrained-language
//! mode, AppLocker, a broken WMI repository, an EDR blocking
//! `Win32_NetworkAdapterConfiguration`) the live proof can never succeed, and without this exit
//! Disconnect, Sign Out and Quit are refused forever — the Protected-Offline deadlock this
//! design explicitly prevents. The acceptance is never silent: it carries
//! `DNS_RESTORE_DEGRADED_PREFIX` in `last_error` and in the status payload. Everything short
//! of that stays fail-closed, because automatically opening WFP while the live resolver may
//! still point at a dead loopback server strands the machine in an ambiguous and often
//! unrecoverable network state.
//!
//! **Nothing here may hang, and nothing here may become permanently unsatisfiable.** Every
//! engine call is bounded and holds a single-writer claim (`bounded_dns_call`), so an
//! unreturning Dnscache/registry/loader call fails the operation instead of parking the DNS
//! operation lock for the lifetime of the service. And a `protected-dns.json` this build cannot
//! read is recovered from live evidence (`recover_unreadable_snapshot`) rather than turning
//! the disarm gate into a permanent lockout — but only when nothing on the machine still
//! resolves through a Tono-owned target. A *missing* snapshot is also evidence-checked: if an
//! adapter still contains `198.18.0.2`, neither a new enable nor disarm may reinterpret it as
//! the user's original DNS (`DNS_SNAPSHOT_MISSING_PREFIX`).
//!
//! The pure snapshot/merge/restore-decision logic in this file is platform-independent and
//! unit-tested on any host; the registry/CIM/netsh engine is compiled only on Windows.

use crate::core::structure::DnsProtectionStatus;
use anyhow::{Context as _, Result, bail};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

const ENGINE_LIVE: bool = cfg!(all(windows, not(feature = "test")));

/// Mihomo's DNS endpoint inside the pinned WinTUN `/30`. This is deliberately distinct from
/// `DNS_LISTEN` (`127.0.0.1:53`): on real Windows, `strict-route` plus DNS hijacking makes the
/// TUN-side endpoint the only address that answers while WFP is locked.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(crate) const PROTECTED_DNS_V4: &str = "198.18.0.2";
/// Legacy protected value and a legitimate pre-existing local-resolver value. New protection
/// never writes it, but restore/recovery must still recognize it without confusing it with the
/// current TUN DNS endpoint.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(crate) const LOOPBACK_V4: &str = "127.0.0.1";
/// The IPv6 loopback address. **Recognised, never written.** Nothing listens on `[::1]:53`, so
/// the protect path uses [`NO_NAME_SERVERS`] instead (see the module docs); this constant stays
/// because an adapter left on `::1` by an older build must still be recognised as protected on
/// the restore-proof path, or an upgrade would mis-prove a restore that never happened.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(crate) const LOOPBACK_V6: &str = "::1";
/// The protected IPv6 state: a *static* server list with nothing in it, which the registry
/// stores as an empty `NameServer`. Distinct from deleting the value, which means DHCP and
/// would put the ISP's resolvers back.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(crate) const NO_NAME_SERVERS: &str = "";
/// Connection name of Tono's WinTUN adapter. Mirrors `tono_core::config::TUN_DEVICE_NAME`
/// (`apps/windows/crates/tono-core/src/config.rs`); this crate is self-contained and cannot
/// import it, so the two spellings are kept in sync by hand.
const TUN_ADAPTER_NAME: &str = "Tono";
const SNAPSHOT_VERSION: u32 = 1;
/// Sidecar next to `protected-dns.json`. Written *before* Encrypted DNS is
/// mutated so a crash still has the user's `EnableAutoDoh` value to put back.
const ENCRYPTED_DNS_CAPTURE_FILE: &str = "protected-secure-dns.json";
/// Sidecar for per-adapter DoH templates (Settings → DNS encryption). Separate
/// from the EnableAutoDoh file so a mid-session upgrade can still restore
/// a DWORD capture written by an older build.
#[cfg_attr(not(windows), allow(dead_code))]
const INTERFACE_DOH_CAPTURE_FILE: &str = "protected-interface-doh.json";
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
const INTERFACE_DOH_CAPTURE_VERSION: u32 = 1;
/// `DNS_DOH_SERVER_SETTINGS_ENABLE_AUTO`
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
const DNS_DOH_ENABLE_AUTO: u64 = 0x1;
/// `DNS_DOH_SERVER_SETTINGS_ENABLE` (manual template).
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
const DNS_DOH_ENABLE: u64 = 0x2;
/// `DNS_DOH_SERVER_SETTINGS_FALLBACK_TO_UDP`
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
const DNS_DOH_FALLBACK_TO_UDP: u64 = 0x4;
/// `EnableAutoDoh` off. 2 is opportunistic (Win11 default), 3 is required.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
const ENABLE_AUTO_DOH_OFF: u32 = 0;

#[cfg_attr(not(windows), allow(dead_code))]
fn encrypted_dns_capture_path() -> PathBuf {
    crate::service_paths()
        .persistent_state_dir()
        .join(ENCRYPTED_DNS_CAPTURE_FILE)
}

/// File body: a decimal DWORD, or `absent` when the value was not set.
fn format_encrypted_dns_capture(enable_auto_doh: Option<u32>) -> String {
    match enable_auto_doh {
        Some(value) => format!("{value}\n"),
        None => "absent\n".to_owned(),
    }
}

fn parse_encrypted_dns_capture(body: &str) -> Result<Option<u32>, String> {
    let trimmed = body.trim();
    if trimmed == "absent" {
        return Ok(None);
    }
    trimmed
        .parse::<u32>()
        .map(Some)
        .map_err(|error| format!("encrypted DNS capture is not a DWORD ({error})"))
}

/// Win10/11 Settings "Encrypted only" = DoH enabled and UDP fallback off.
/// Encrypted-preferred still tries HTTPS first (the 5 s `securingDNS` hang).
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn interface_doh_is_enabled(flags: u64) -> bool {
    flags & (DNS_DOH_ENABLE_AUTO | DNS_DOH_ENABLE) != 0
}

#[cfg_attr(not(test), allow(dead_code))]
fn interface_doh_is_encrypted_only(flags: u64) -> bool {
    interface_doh_is_enabled(flags) && flags & DNS_DOH_FALLBACK_TO_UDP == 0
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct InterfaceDohCapture {
    v: u32,
    entries: Vec<InterfaceDohEntry>,
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct InterfaceDohEntry {
    guid: String,
    family: String,
    server: String,
    flags: u64,
}

#[cfg_attr(not(windows), allow(dead_code))]
fn interface_doh_capture_path() -> PathBuf {
    crate::service_paths()
        .persistent_state_dir()
        .join(INTERFACE_DOH_CAPTURE_FILE)
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn format_interface_doh_capture(entries: &[InterfaceDohEntry]) -> Result<String, String> {
    serde_json::to_string(&InterfaceDohCapture {
        v: INTERFACE_DOH_CAPTURE_VERSION,
        entries: entries.to_vec(),
    })
    .map_err(|error| format!("interface DoH capture could not be written ({error})"))
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn parse_interface_doh_capture(body: &str) -> Result<Vec<InterfaceDohEntry>, String> {
    let parsed: InterfaceDohCapture = serde_json::from_str(body)
        .map_err(|error| format!("interface DoH capture is not JSON ({error})"))?;
    if parsed.v != INTERFACE_DOH_CAPTURE_VERSION {
        return Err(format!(
            "interface DoH capture version {} is not {}",
            parsed.v, INTERFACE_DOH_CAPTURE_VERSION
        ));
    }
    for entry in &parsed.entries {
        if entry.family != "Doh" && entry.family != "Doh6" {
            return Err(format!(
                "interface DoH capture family {} is not Doh or Doh6",
                entry.family
            ));
        }
        if entry.guid.is_empty() || entry.server.is_empty() {
            return Err("interface DoH capture is missing guid or server".to_owned());
        }
    }
    Ok(parsed.entries)
}

/// One adapter's original DNS values. `None` means the registry value was absent — the
/// typical DHCP state — and restore must delete rather than rewrite it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub(crate) struct AdapterDnsSnapshot {
    pub interface_guid: String,
    /// Runtime-only interface identity from IP Helper. This is used to distinguish the
    /// currently permitted Tono WinTUN adapter from a physical adapter that was accidentally
    /// left on our protected DNS endpoint. LUIDs are not stable across reboot/reinstall, so
    /// they must never become part of the durable recovery snapshot.
    #[serde(skip)]
    pub interface_luid: Option<u64>,
    /// Runtime-only connection name from the adapter's Network-class `Connection` key (e.g.
    /// "Ethernet" or "Tono"). Same persistence rule as the LUID: names are operator-controlled
    /// and must never become part of the durable recovery snapshot. This exists so the tunnel
    /// exclusion in [`without_current_tunnel`] keeps working after the core — and with it the
    /// WFP-validated LUID — is gone.
    #[serde(skip)]
    pub connection_name: Option<String>,
    pub ipv4_name_server: Option<String>,
    pub ipv4_profile_name_server: Option<String>,
    pub ipv6_name_server: Option<String>,
    pub ipv6_profile_name_server: Option<String>,
    /// The last CIM live-apply for this adapter failed, so the running resolver cannot be
    /// trusted to match the registry until a retry succeeds. Recorded in memory and in the
    /// snapshot file. It forces the protected-DNS write to be replayed on the next enable
    /// ([`needs_loopback_replay`]) and it is why the restore proof insists on live evidence —
    /// but it does **not** by itself refuse a restore whose live state is verifiably correct
    /// (see [`restore_is_proven`] and the module docs).
    #[serde(default)]
    pub live_apply_failed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct DnsSnapshot {
    pub version: u32,
    pub taken_at: u64,
    pub adapters: Vec<AdapterDnsSnapshot>,
}

fn snapshot_path() -> PathBuf {
    crate::service_paths()
        .persistent_state_dir()
        .join("protected-dns.json")
}

static DNS_OPERATION: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));
static DNS_LAST_ERROR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

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
// that lowers the depth, so a panic, an early `?`, a timed-out `bounded_dns_call` or a dropped
// (cancelled) future all close it. `SELF_WRITE_MAX_WINDOW` is the belt-and-braces half: past
// that age an open window stops suppressing even if the depth were somehow leaked.
//
// **It is harmless if DNS writes never raise the notification at all** (the one link in the
// audit that only a Windows machine can settle): with no notification there is nothing to
// suppress and the code is dead weight during a handful of milliseconds per connect.

/// How long after the last write window closes a raw notification is still attributed to it.
/// `NotifyIpInterfaceChange` is asynchronous — the callback arrives on an IPHelper thread some
/// time after the write returns — so the window needs a tail or it would suppress nothing.
/// 1.5 s is twice `netmon`'s 750 ms debounce, so a callback that arrives late enough to open a
/// fresh debounce burst is still inside the window that caused it.
const SELF_WRITE_TAIL: std::time::Duration = std::time::Duration::from_millis(1_500);

/// Hard age cap on a single open window, independent of the guard. `DNS_APPLY_TIMEOUT` bounds
/// the apply itself, so a window older than this cannot be an apply that is still running; it
/// could only be a leaked depth, and a leaked depth must not mute the machine's network events
/// for the life of the service.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
const SELF_WRITE_MAX_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

/// Number of currently-open write windows (`0` = none).
static SELF_WRITE_DEPTH: AtomicU32 = AtomicU32::new(0);
/// Monotonic millis at which the outermost currently-open window was opened.
static SELF_WRITE_OPENED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Monotonic millis until which the tail of the last closed window runs.
static SELF_WRITE_TAIL_UNTIL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Raw notifications `netmon` attributed to a window and did not publish. Diagnostic only.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
static SELF_WRITE_SUPPRESSED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Process-lifetime monotonic clock in milliseconds. `Instant` is boot-relative on Windows and
/// not `const`-constructible, so the anchor is lazy and everything else is a plain `u64`.
fn monotonic_millis() -> u64 {
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
fn self_write_window_is_open(
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

/// Count a notification `netmon` attributed to a window and dropped. Returns the running total
/// so the caller can put it in one log line.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
pub(crate) fn note_suppressed_self_write() -> u64 {
    SELF_WRITE_SUPPRESSED.fetch_add(1, Ordering::Relaxed) + 1
}

#[cfg(test)]
fn suppressed_self_writes() -> u64 {
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
/// Deliberately a guard and not a flag: the apply it wraps can fail, panic, time out inside
/// `bounded_dns_call`, or have its future dropped, and every one of those must close the
/// window. Nothing else in this module may set the state directly.
#[must_use = "the suppression window closes the moment the guard is dropped"]
pub(crate) struct SelfWriteWindow(());

impl SelfWriteWindow {
    fn open() -> Self {
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

// --- Pure logic (platform-independent, unit-tested below) ---

/// Registry `NameServer` values are comma-separated; tolerate spaces and empty segments.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn parse_name_server_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|server| !server.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

/// DNS servers the live apply should restore for **one address family**. `ProfileNameServer`
/// overrides `NameServer` when populated. `None` means "no saved value": restore DHCP for that
/// family.
///
/// The two families are deliberately never merged into one list. `SetDNSServerSearchOrder` on
/// `Win32_NetworkAdapterConfiguration` is documented for IPv4 addresses only, so a mixed
/// `["127.0.0.1", "::1"]` array is either rejected outright (every adapter fails forever) or —
/// worse — silently truncated to its IPv4 element, leaving the IPv6 resolver pointing at the
/// previous ISP/DHCP server while the registry read-back still reports "protected". Each
/// family now travels through its own mechanism and is proven separately (`engine`).
///
/// A saved value that is present but *empty* still maps to `None` (restore DHCP), even though
/// an empty static list is what the protect path now writes for IPv6. Windows leaves an empty
/// `NameServer` behind on perfectly ordinary DHCP adapters, so the registry cannot tell "the
/// user chose static-with-no-servers" from "this family is on DHCP"; guessing static there
/// would strand a DHCP machine with no resolvers at all. This never affects the protected
/// state, which is read from the *snapshot* — the values as they were before Tono touched
/// them — and the four exact registry values are written back verbatim regardless
/// (`engine::apply_snapshot`), which is what the restore proof compares.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn restored_family_servers(profile: Option<&str>, base: Option<&str>) -> Option<Vec<String>> {
    let profile = profile.map(parse_name_server_list).unwrap_or_default();
    let effective = if profile.is_empty() {
        base.map(parse_name_server_list).unwrap_or_default()
    } else {
        profile
    };
    let mut restored: Vec<String> = Vec::new();
    for server in effective {
        if !restored.contains(&server) {
            restored.push(server);
        }
    }
    (!restored.is_empty()).then_some(restored)
}

#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn restored_live_servers_v4(adapter: &AdapterDnsSnapshot) -> Option<Vec<String>> {
    restored_family_servers(
        adapter.ipv4_profile_name_server.as_deref(),
        adapter.ipv4_name_server.as_deref(),
    )
}

#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn restored_live_servers_v6(adapter: &AdapterDnsSnapshot) -> Option<Vec<String>> {
    restored_family_servers(
        adapter.ipv6_profile_name_server.as_deref(),
        adapter.ipv6_name_server.as_deref(),
    )
}

#[cfg_attr(not(test), allow(dead_code))]
fn format_name_server_list(servers: &[String]) -> String {
    servers.join(",")
}

/// Whether a saved/read-back value is made only of legacy loopback resolvers.
///
/// Deliberately does **not** include the current `198.18.0.2` target. This predicate distinguishes
/// a user's legitimate pre-existing local resolver (Acrylic/dnscrypt-proxy/Pi-hole) when deciding
/// which adapters owe live restore proof. The broader [`is_tono_dns_value`] predicate is what
/// recognises current plus legacy Tono-owned targets on the actual restore path.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn is_loopback_value(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let servers = parse_name_server_list(value);
    !servers.is_empty()
        && servers
            .iter()
            .all(|server| server == LOOPBACK_V4 || server == LOOPBACK_V6)
}

/// Whether IPv4 reads back exactly as the current protected DNS target. Requiring the complete
/// list to contain only the TUN endpoint prevents a mixed `198.18.0.2, ISP-DNS` configuration
/// from being reported as protected.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn is_protected_v4_value(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let servers = parse_name_server_list(value);
    !servers.is_empty() && servers.iter().all(|server| server == PROTECTED_DNS_V4)
}

/// Whether a registry value contains the current Tono-only DNS endpoint anywhere in its list.
///
/// This is intentionally broader than [`is_protected_v4_value`]. A half-restored value such as
/// `198.18.0.2, 1.1.1.1` is not a valid protected state, but it is still unsafe to capture as the
/// user's original DNS when the recovery snapshot is missing: after the core stops, the first
/// address is dead and Windows may wait on it before trying the next one.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn contains_current_protected_v4(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        parse_name_server_list(value)
            .iter()
            .any(|server| server == PROTECTED_DNS_V4)
    })
}

fn adapter_contains_current_protected_dns(adapter: &AdapterDnsSnapshot) -> bool {
    contains_current_protected_v4(adapter.ipv4_name_server.as_deref())
        || contains_current_protected_v4(adapter.ipv4_profile_name_server.as_deref())
}

/// Whether this adapter reads, right now, as pointed at a Tono-owned resolver — the current
/// `198.18.0.2` or a legacy `127.0.0.1` / `::1` left by an older build — in any of the four
/// values.
///
/// One predicate on purpose, shared by the two halves of the snapshot-less restore: the half
/// that *selects* which adapters to reset, and [`engine::any_loopback`], the half that *proves*
/// the reset worked. They were written separately and drifted: the proof was updated when the
/// redirect target moved from loopback to the TUN endpoint, and the selection was not. It kept
/// asking [`is_loopback_value`], which deliberately excludes `198.18.0.2`, so on every machine
/// protected by a current build it selected nothing — and an empty selection proved itself
/// trivially. Asking one question in one place is what stops that from recurring.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn adapter_reads_as_tono_dns(adapter: &AdapterDnsSnapshot) -> bool {
    is_tono_dns_value(adapter.ipv4_name_server.as_deref())
        || is_tono_dns_value(adapter.ipv4_profile_name_server.as_deref())
        || is_tono_dns_value(adapter.ipv6_name_server.as_deref())
        || is_tono_dns_value(adapter.ipv6_profile_name_server.as_deref())
}

fn is_current_tunnel_adapter(
    adapter: &AdapterDnsSnapshot,
    current_tunnel_luid: Option<u64>,
) -> bool {
    current_tunnel_luid.is_some() && adapter.interface_luid == current_tunnel_luid
}

/// Tono's WinTUN adapter is the route *to* the protected resolver, not a Windows resolver client
/// that needs to be redirected. Including it would snapshot our own `198.18.0.2` as a user value,
/// write DNS back onto the tunnel, and make snapshot-less safety checks reject a healthy connect.
///
/// Two identities, because neither alone covers the adapter's whole life. The WFP-validated
/// runtime LUID is the strong one, but it dies with the core: Disconnect stops the core *before*
/// the restore proof runs, so a stale WinTUN adapter left behind by an orphaned core would
/// re-enter the proof and its own `198.18.0.2` would read as "still on loopback" — refused,
/// every time. The connection name is the weaker but core-independent signal that still covers
/// that case. Excluding by name cannot mask a real leak: physical adapters keep their exact
/// per-value snapshot comparison, and a same-named *physical* adapter would require an
/// administrator renaming one to "Tono", which is outside the threat model.
fn without_current_tunnel(
    adapters: Vec<AdapterDnsSnapshot>,
    current_tunnel_luid: Option<u64>,
) -> Vec<AdapterDnsSnapshot> {
    adapters
        .into_iter()
        .filter(|adapter| {
            !is_current_tunnel_adapter(adapter, current_tunnel_luid)
                && adapter.connection_name.as_deref() != Some(TUN_ADAPTER_NAME)
        })
        .collect()
}

/// A missing snapshot plus the current TUN DNS endpoint is an orphaned protected state, never a
/// clean initial state. We cannot reconstruct the user's static/DHCP choice, so fail closed and
/// tell the operator to restore it instead of recording our own endpoint as the way back.
fn ensure_snapshotless_adapters_are_safe(adapters: &[AdapterDnsSnapshot]) -> Result<()> {
    if adapters.iter().any(adapter_contains_current_protected_dns) {
        bail!(
            "{DNS_SNAPSHOT_MISSING_PREFIX}: protected-dns.json is missing while an active adapter \
             still contains Tono's protected DNS target ({PROTECTED_DNS_V4}). Refusing to record \
             that target as the user's original DNS or to disarm over it. Use Restore Network to \
             remove the traffic barrier, then in Windows set the affected adapter's DNS server \
             assignment back to Automatic (DHCP) — or to the servers you use — and retry."
        );
    }
    Ok(())
}

/// After a failed connect, release can leave adapters on `198.18.0.2` while deleting
/// `protected-dns.json`. The next Connect then hits [`ensure_snapshotless_adapters_are_safe`] and
/// hard-fails. Heal by resetting those adapters to automatic (DHCP) — we have no better original
/// to restore — then re-collect so enable can take a clean snapshot.
async fn heal_orphaned_protected_dns_without_snapshot(
    adapters: &[AdapterDnsSnapshot],
) -> Result<Vec<AdapterDnsSnapshot>> {
    let orphaned: Vec<_> = adapters
        .iter()
        .filter(|adapter| adapter_contains_current_protected_dns(adapter))
        .cloned()
        .collect();
    if orphaned.is_empty() {
        return Ok(adapters.to_vec());
    }
    tracing::warn!(
        "dns: protected-dns.json is missing but {} adapter(s) still list {PROTECTED_DNS_V4}; \
         resetting them to automatic (DHCP) so Connect can proceed",
        orphaned.len()
    );
    let automatic = DnsSnapshot {
        version: SNAPSHOT_VERSION,
        taken_at: now_unix(),
        adapters: orphaned
            .iter()
            .map(|adapter| AdapterDnsSnapshot {
                interface_guid: adapter.interface_guid.clone(),
                ..Default::default()
            })
            .collect(),
    };
    match engine_apply_snapshot(&automatic).await {
        Ok(results) => {
            let failed = results.iter().filter(|(_, ok)| !*ok).count();
            if failed > 0 {
                tracing::warn!(
                    "dns: orphaned-DNS heal applied with {failed} adapter failure(s); re-reading"
                );
            }
        }
        Err(error) => {
            tracing::error!(
                "dns: orphaned-DNS heal apply failed ({error:#}); will re-check adapters"
            );
        }
    }
    if let Err(error) = engine_restore_encrypted_dns().await {
        tracing::warn!("dns: encrypted DNS restore after orphaned-DNS heal failed: {error:#}");
    }
    if let Err(error) = engine_flush_cache().await {
        tracing::warn!("dns: cache flush after orphaned-DNS heal failed: {error:#}");
    }
    collect_dns_adapters().await
}

async fn ensure_snapshotless_dns_is_safe() -> Result<()> {
    let current = collect_dns_adapters().await?;
    if ensure_snapshotless_adapters_are_safe(&current).is_ok() {
        return Ok(());
    }
    let healed = heal_orphaned_protected_dns_without_snapshot(&current).await?;
    ensure_snapshotless_adapters_are_safe(&healed)
}

/// Whether a value is still owned by Tono and may become unreachable when the core stops. This
/// includes the current TUN endpoint and the loopback values written by older builds. Restore
/// proof uses this broader predicate; snapshot logic still uses [`is_loopback_value`] to retain
/// a user's legitimate pre-existing local resolver.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
fn is_tono_dns_value(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let servers = parse_name_server_list(value);
    !servers.is_empty()
        && servers.iter().all(|server| {
            server == PROTECTED_DNS_V4 || server == LOOPBACK_V4 || server == LOOPBACK_V6
        })
}

/// Whether a read-back **IPv6** value is the protected state — the question "is this adapter
/// still protected?", which for IPv6 is not the same question as [`is_loopback_value`].
///
/// The protect path writes an empty static list, so an empty value is the protected state and
/// must *not* read as drift: otherwise the watchdog would see every adapter as unprotected on
/// every tick and rewrite the registry forever. A value absent altogether is DHCP — the ISP's
/// resolvers — and is genuinely unprotected. `::1` is accepted so that an upgrade over a build
/// that wrote it does not trigger a pointless machine-wide replay.
#[cfg_attr(any(not(windows), feature = "test"), allow(dead_code))]
/// Whether an IPv6 name-server value is one we consider protected: an empty list (what the
/// protect path writes) or the `::1` an older build wrote.
///
/// No longer a gate on the protect path — the registry stores "no servers" and "use DHCP"
/// identically, so this can never prove the state it names. Kept because it still documents
/// the intended shape and is asserted by tests; the enable-time verification requires only
/// IPv4 loopback (see `engine::all_loopback`).
#[cfg_attr(not(test), allow(dead_code))]
fn is_protected_v6_value(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    parse_name_server_list(value).is_empty() || is_loopback_value(Some(value))
}

/// Idempotent enable: preserve every original already recorded, but append adapters that appeared
/// after protection started. Replacing an existing record would snapshot our loopback values and
/// destroy the way back; ignoring fresh GUIDs would leave a hot-plugged adapter unprotected.
fn merge_snapshot(existing: Option<DnsSnapshot>, fresh: DnsSnapshot) -> DnsSnapshot {
    let Some(mut existing) = existing else {
        return fresh;
    };
    for adapter in fresh.adapters {
        if !existing
            .adapters
            .iter()
            .any(|saved| saved.interface_guid == adapter.interface_guid)
        {
            existing.adapters.push(adapter);
        }
    }
    existing
}

/// Short-circuiting `enable` is only safe when a snapshot exists, the adapters are actually on
/// loopback, AND no live-apply failure is recorded (memory or snapshot). With no snapshot this is
/// the initial enable, so it must capture the originals and apply loopback. Anything else replays
/// the write — which also retries the live-apply — against the *original* snapshot.
fn needs_loopback_replay(
    snapshot_present: bool,
    all_loopback: bool,
    live_apply_failed: bool,
) -> bool {
    !snapshot_present || !all_loopback || live_apply_failed
}

/// What the post-apply read-back was able to say about the protected state. Four states, not a
/// `bool`: "we could not look" and "this build has no engine to look with" are not the same as
/// "nothing was found", and reporting either as a failure is what used to kill connects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoopbackReadBack {
    /// Every active adapter reads back as protected.
    Verified,
    /// The read succeeded and at least one active adapter does not read as protected.
    Contradicted,
    /// The read itself failed (engine error, wedged call, timeout).
    Unavailable,
    /// No live engine in this build, so there was nothing to attempt. Carries no information and
    /// never contributes to the note.
    NotAttempted,
}

/// How the read-back reads in an operator-facing message.
fn read_back_label(read_back: LoopbackReadBack) -> &'static str {
    match read_back {
        LoopbackReadBack::Verified => "verified",
        LoopbackReadBack::Contradicted => "not-protected",
        LoopbackReadBack::Unavailable => "unreadable",
        LoopbackReadBack::NotAttempted => "not-attempted",
    }
}

/// Adapter GUIDs are long; name at most this many in the note and count the rest.
const UNVERIFIED_NAMED_ADAPTERS: usize = 4;

/// Compose the note for an `enable` round that applied protected DNS but could not prove it.
///
/// `None` means the round is clean — every adapter's live apply succeeded and the read-back
/// either confirmed the state or was never attempted (a build with no engine). Everything else
/// produces a note that is deliberately *not* an error: it rides in `DNS_LAST_ERROR` and
/// therefore in the status payload on an otherwise successful enable, so that when the connect
/// later dies in `verify_fake_ip` with "system DNS lookup exceeded 5s" the diagnostics report and
/// the service log already name the real cause. It also states why this is not a leak, because
/// the next person to read it will ask.
fn unverified_note(failed: &[String], total: usize, read_back: LoopbackReadBack) -> Option<String> {
    if failed.is_empty()
        && matches!(
            read_back,
            LoopbackReadBack::Verified | LoopbackReadBack::NotAttempted
        )
    {
        return None;
    }
    let named = failed
        .iter()
        .take(UNVERIFIED_NAMED_ADAPTERS)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    let adapters = match failed.len() {
        0 => "none — the apply reported success on every adapter".to_owned(),
        count if count > UNVERIFIED_NAMED_ADAPTERS => {
            format!("{named} (+{} more)", count - UNVERIFIED_NAMED_ADAPTERS)
        }
        _ => named,
    };
    Some(format!(
        "{DNS_PROTECTION_UNVERIFIED_PREFIX}: protected DNS ({PROTECTED_DNS_V4}) was applied but could not be verified \
         on {} of {total} adapter(s) — live apply failed on: {adapters}; read-back={}. \
         Protection was NOT abandoned and this is not a leak: WFP default-denies physical DNS \
         on both address families and permits the verified TUN interface, so an adapter whose \
         configuration cannot be verified can only fail to resolve, never bypass the tunnel. The connect \
         continues to the fake-ip probe, which resolves a name through the OS and proves the \
         answering resolver directly; if that probe fails (\"system DNS lookup exceeded\"), this \
         is the reason. Automatic reconciliation keeps retrying these adapters.",
        failed.len(),
        read_back_label(read_back)
    ))
}

/// Whether a status payload carries an unverified-enable note. The marker is the contract; the
/// text around it is free to change.
fn status_is_unverified(status: &DnsProtectionStatus) -> bool {
    status
        .last_error
        .as_deref()
        .is_some_and(|error| error.contains(DNS_PROTECTION_UNVERIFIED_PREFIX))
}

/// Drop a stale unverified note (and only that) from `DNS_LAST_ERROR`.
///
/// Called when protection is observed complete. Without it the note outlives the condition it
/// describes and [`needs_reconcile`] keeps the watchdog re-applying DNS for ever on a machine
/// that is already healthy — the demoted gate's version of the "permanently unsatisfiable"
/// failure this module keeps having to design out.
fn clear_unverified_note() {
    let mut last = DNS_LAST_ERROR
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if last
        .as_deref()
        .is_some_and(|error| error.contains(DNS_PROTECTION_UNVERIFIED_PREFIX))
    {
        *last = None;
    }
}

/// The watchdog's repair gate.
///
/// `!enabled` alone is no longer sufficient. Since `enable` stopped failing on an unverifiable
/// apply, a machine can sit at `enabled == true` — the registry read-back is happy — while the
/// *live* apply failed on an adapter and the running resolver never picked the change up. Those
/// recorded failures are precisely the work the reconciler exists to retry, and they are also
/// what [`needs_loopback_replay`] keys on, so the two agree on when there is something to do.
fn needs_reconcile(
    protection_wanted: bool,
    snapshot_present: bool,
    enabled: bool,
    unverified: bool,
) -> bool {
    protection_wanted && snapshot_present && (!enabled || unverified)
}

/// Registry-only comparison of one adapter: the four saved values against the read-back
/// (deliberately excluding the `live_apply_failed` bookkeeping flag).
fn registry_values_match(saved: &AdapterDnsSnapshot, current: &AdapterDnsSnapshot) -> bool {
    saved.interface_guid == current.interface_guid
        && saved.ipv4_name_server == current.ipv4_name_server
        && saved.ipv4_profile_name_server == current.ipv4_profile_name_server
        && saved.ipv6_name_server == current.ipv6_name_server
        && saved.ipv6_profile_name_server == current.ipv6_profile_name_server
}

/// Whether the registry alone looks restored: the *degraded* leg of the proof, accepted only
/// under the rules in [`accepts_degraded_restore`].
fn registry_restore_matches(snapshot: &DnsSnapshot, current: &[AdapterDnsSnapshot]) -> bool {
    snapshot.adapters.iter().all(|saved| {
        current
            .iter()
            .find(|adapter| adapter.interface_guid == saved.interface_guid)
            .is_none_or(|adapter| registry_values_match(saved, adapter))
    })
}

/// Restore is proven from the machine's **current** state, on two pieces of evidence together:
/// every snapshotted adapter that is still present in the live read reads back exactly its
/// saved values, *and* the live read says nothing on this machine still resolves through the
/// loopback core. A registry match alone does not prove the second half, which is why
/// `live_loopback` is a parameter and not an afterthought.
///
/// `live_loopback` carries that second half: `Some(false)` = nothing is on loopback (the only
/// answer that can prove a restore), `Some(true)` = something provably still is (refused,
/// unconditionally — this is the ordering invariant the disarm gate exists for), `None` = the
/// engine could not be asked. Unobtainable evidence is *unproven*, never proven: it falls
/// through to [`accepts_degraded_restore`], which still demands an exact registry match and a
/// sustained failure streak.
///
/// What is deliberately **not** consulted: `live_apply_failed`. It records what happened in an
/// earlier round, and using it as a veto is the defect this signature exists to fix — on a real
/// machine the registry held the user's own resolvers again and nothing was on loopback, yet
/// the release was refused because one adapter still carried the flag, and the degraded exit
/// that is supposed to prevent exactly that deadlock needs three consecutive failures, which a
/// user clicking Disconnect once never reaches. A historical failure is a reason to *demand*
/// live evidence (the caller always gathers it), never a reason to overrule it.
///
/// An adapter that has vanished from the live read (disabled, unplugged, or no longer holding a
/// bound IP stack) counts as proven: it has no running resolver left to leak through, and no
/// amount of retrying can configure hardware that is not there. Demanding proof from an absent
/// adapter would be an unrecoverable deadlock with no fail-closed benefit — the registry values
/// it left behind are restored regardless, and if it comes back it comes back restored.
fn restore_is_proven(
    snapshot: &DnsSnapshot,
    current: &[AdapterDnsSnapshot],
    live_loopback: Option<bool>,
) -> bool {
    if live_loopback != Some(false) {
        return false;
    }
    snapshot.adapters.iter().all(|saved| {
        current
            .iter()
            .find(|adapter| adapter.interface_guid == saved.interface_guid)
            .is_none_or(|adapter| registry_values_match(saved, adapter))
    })
}

/// Whether the values saved for this adapter were *themselves* a loopback resolver.
fn saved_dns_was_loopback(saved: &AdapterDnsSnapshot) -> bool {
    is_loopback_value(saved.ipv4_name_server.as_deref())
        || is_loopback_value(saved.ipv4_profile_name_server.as_deref())
        || is_loopback_value(saved.ipv6_name_server.as_deref())
        || is_loopback_value(saved.ipv6_profile_name_server.as_deref())
}

/// The adapters the live loopback read has to cover: everything present now, minus the ones
/// whose *originals* were already a loopback resolver.
///
/// A machine that ran its own local resolver before Tono started (Acrylic, dnscrypt-proxy, a
/// local Pi-hole) had `127.0.0.1` in the registry all along, and a correct restore puts it
/// straight back. Asking the blunt "is anything on loopback?" question over that adapter would
/// answer "yes" after every successful restore and refuse every disconnect for ever — the same
/// class of deadlock this module keeps having to design out. The evidence the disarm gate
/// actually needs is narrower: is anything on loopback that the snapshot says should not be?
fn adapters_owing_live_proof(
    snapshot: &DnsSnapshot,
    current: &[AdapterDnsSnapshot],
) -> Vec<AdapterDnsSnapshot> {
    current
        .iter()
        .filter(|adapter| {
            !snapshot.adapters.iter().any(|saved| {
                saved.interface_guid == adapter.interface_guid && saved_dns_was_loopback(saved)
            })
        })
        .cloned()
        .collect()
}

/// How the live loopback evidence reads in an operator-facing message. `unknown` is its own
/// state on purpose: "we could not look" must never be reported as "nothing was found".
fn live_loopback_label(live_loopback: Option<bool>) -> &'static str {
    match live_loopback {
        Some(true) => "yes",
        Some(false) => "no",
        None => "unknown",
    }
}

/// Consecutive failing live-apply rounds after which a registry-matching restore is accepted as
/// *degraded*. Three: one failure is noise, two is
/// bad luck, three in a row on the machine's own retry cadence means the live mechanism is
/// structurally unavailable (constrained-language mode, AppLocker, a broken WMI repository, an
/// EDR blocking `Win32_NetworkAdapterConfiguration`) and will not recover by being asked again.
const DEGRADED_RESTORE_STREAK: u32 = 3;

/// The documented degraded exit: accept a restore that the live mechanism could not confirm,
/// **only** when the registry read-back matches the snapshot exactly *and* the live apply has
/// failed `DEGRADED_RESTORE_STREAK` rounds in a row.
///
/// Why this is the right trade, and why it is not a hole in the DNS-before-disarm invariant:
/// the registry is what the DNS Client reads for the next lookup, so an exact registry match is
/// positive evidence that the machine's configured resolvers are the user's own again — what
/// the live apply adds is confirmation that the *currently running* resolver picked the change
/// up without waiting for an interface event. Without this exit, a machine whose CIM/PowerShell
/// path is permanently unavailable can never satisfy `restore_is_proven`, so Disconnect, Sign
/// Out and Quit are refused forever and the user is deadlocked in Protected Offline with no way
/// back to their network. A single failure never takes this path, a registry mismatch never
/// takes it, and every degraded acceptance is recorded in `last_error` and in the status
/// payload with its own marker — it is never silent.
fn accepts_degraded_restore(consecutive_live_failures: u32, registry_matches: bool) -> bool {
    registry_matches && consecutive_live_failures >= DEGRADED_RESTORE_STREAK
}

// --- Uninstall-only escalation ladder ---
//
// **The design error this ladder corrects.** Everywhere else in this module, "refuse unless the
// network is provably restored" is right: the product is staying installed, the user can retry,
// and the App still has a way to open the block. At *uninstall* time the same rule produced an
// **unremovable application** — the machine that reported this could not get past
// `RemoveVergeService` because the live CIM/netsh apply was failing on one adapter, so the exact
// restore could never be proven and the NSIS macro aborted the whole uninstall, every time.
// Unremovable consumer software is a worse outcome than an inexact DNS configuration, and it is
// not a trade the user ever agreed to.
//
// The danger the old refusal was aimed at is real, but the aim was wrong. What must never
// happen is *removing the app while leaving persistent WFP filters armed* — a blocked machine
// with no software left to unblock it. Refusing the uninstall is not the only way to prevent
// that, and it is the way that costs the most: it leaves the user blocked **and** stuck.
// `windows_kill_switch::emergency_disarm_windows_kill_switch` removes the WFP objects whether
// or not DNS could be restored, so the barrier is gone on every rung below; this ladder decides
// only what to do about the *resolver*.
//
// Rung 1 — exact restore, proven exactly as on the Disconnect path (`restore_protected`).
// Rung 2 — put the adapters Tono redirected back on **automatic (DHCP)**, both families, and
//          verify the machine is no longer resolving through the loopback core. DHCP is a
//          universally-correct resting state: the user gets working DNS from their network. It
//          is not their exact prior configuration, and at uninstall time — when the product is
//          being removed and connectivity matters more than fidelity — that is the right trade.
// Rung 3 — only when the machine is *provably* still on the loopback resolver, or when neither
//          the DHCP write nor the read-back produced any evidence at all. Then, and only then,
//          the refusal stands.
//
// None of this loosens the Disconnect / "Restore normal internet" path: `restore_protected`,
// `ensure_restored` and `disarm_unlocked` are untouched, and this ladder is reached only from
// the uninstaller's opt-in (`windows_kill_switch::uninstall_ladder_requested`).

/// Stable, App/installer-mappable marker for "the exact DNS restore could not be proven, so the
/// adapters were reset to automatic (DHCP) instead". Same substring contract as the wedge
/// markers. `uninstall_service.rs` matches this literal to pick its continue-with-warning exit
/// code, so the text is part of the exit-code contract and must not drift.
pub(crate) const DNS_RESTORED_AUTOMATIC_PREFIX: &str = "TONO_DNS_RESTORED_AUTOMATIC";

/// Stable marker for the last DNS rung: the machine could not be taken off Tono's protected DNS
/// target. Emitted only **after** WFP objects are already deleted. It must never by itself block
/// uninstall or reinstall — the user can fix DNS in Windows Settings, and cannot conjure back an
/// uninstaller that refuses to run. `uninstall_service.rs` treats this as continue-with-warning
/// (same exit family as [`DNS_RESTORED_AUTOMATIC_PREFIX`]).
pub(crate) const DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX: &str = "TONO_DNS_STILL_ON_LOOPBACK";

/// Stable marker that the WFP barrier is gone even though some DNS step is imperfect. The
/// emergency-disarm path attaches this to every post-removal DNS error so the uninstaller can
/// never re-classify "filters removed, DNS messy" as "machine still blocked" (result 3).
pub(crate) const WFP_REMOVED_CONTINUE_PREFIX: &str = "TONO_WFP_REMOVED";

/// Which rung of the uninstall ladder the evidence lands on. Pure, so the whole decision table
/// is unit-tested off Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UninstallRung {
    /// Rung 1: the snapshot was restored and proven.
    Exact,
    /// Rung 2: not exact, but the machine is off the loopback resolver (or its configured
    /// resolvers are now DHCP, which is what the DNS Client reads for the next lookup).
    Automatic,
    /// Rung 3: provably still redirected, or no evidence either way.
    StillOnLoopback,
}

/// The ladder's decision table.
///
/// * `automatic_apply_ok` — the DHCP reset was written for every targeted adapter. The registry
///   half of that write is what the DNS Client reads for the next lookup, so it is positive
///   evidence in exactly the sense [`accepts_degraded_restore`] already relies on.
/// * `live_loopback` — `Some(true)` the machine provably still resolves through our loopback
///   core, `Some(false)` provably does not, `None` the engine could not be asked.
///
/// The one asymmetry against the rest of this module: `None` (unobtainable evidence) does *not*
/// force a refusal here as long as the DHCP write succeeded. Everywhere else unobtainable
/// evidence is unproven and fails closed, because failing closed costs the user a retry. Here
/// failing closed costs them an application they cannot remove, while the thing that would
/// actually strand them — the WFP barrier — is already gone. `Some(true)` is still an
/// unconditional refusal: a machine we can *see* is still pointed at a resolver that has
/// stopped answering is not a machine we quietly walk away from.
fn uninstall_restore_rung(
    exact_proven: bool,
    automatic_apply_ok: bool,
    live_loopback: Option<bool>,
) -> UninstallRung {
    if exact_proven {
        return UninstallRung::Exact;
    }
    if live_loopback == Some(true) {
        return UninstallRung::StillOnLoopback;
    }
    if automatic_apply_ok || live_loopback == Some(false) {
        return UninstallRung::Automatic;
    }
    UninstallRung::StillOnLoopback
}

/// What the uninstall ladder achieved. `Ok` of either variant means the machine is not left
/// resolving through a loopback core that is about to stop answering; rung 3 is the `Err`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UninstallDnsRestore {
    /// Rung 1 — the snapshot was restored and proven, exactly as on every other path.
    Exact,
    /// Rung 2 — the adapters Tono redirected were reset to automatic (DHCP) for both families.
    /// Carries the adapters that were reset, so the uninstaller can name them.
    Automatic { adapters: Vec<String> },
}

/// Why `enable_unlocked` is running. The distinction is a safety boundary, not bookkeeping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EnableTrigger {
    /// An explicit request (connect, network change, IPC). May capture originals and start
    /// protection from nothing.
    Request,
    /// The watchdog repairing observed drift. May only re-apply a snapshot that already exists.
    Reconcile,
}

/// Whether DNS protection is still *wanted* in this process.
///
/// Set by an explicit enable, cleared the moment any restore is requested — including the
/// emergency path, which proceeds even when the restore cannot be proven. Without this gate the
/// watchdog is a second writer with no notion of intent: after an emergency disarm that leaves
/// the snapshot behind (a partially failed restore keeps it *by design*, while WFP is removed
/// anyway), the watchdog sees `snapshot_present && !enabled` forever and forces every adapter
/// back to `127.0.0.1` every two seconds with no core listening. No race is needed for that —
/// only a disarm that could not prove its restore.
///
/// It is process-local and starts `false`; `initialize_status_cache` seeds it from the snapshot
/// on disk, so a service restart that finds protection in force keeps repairing drift, while a
/// snapshot that survives a disarm does not resurrect the loopback redirect.
static PROTECTION_WANTED: AtomicBool = AtomicBool::new(false);

static CONSECUTIVE_LIVE_FAILURES: AtomicU32 = AtomicU32::new(0);

/// One enable/restore round's live-apply outcome; returns the current streak of failing rounds.
fn note_apply_round(any_live_failed: bool) -> u32 {
    if any_live_failed {
        CONSECUTIVE_LIVE_FAILURES.fetch_add(1, Ordering::Relaxed) + 1
    } else {
        CONSECUTIVE_LIVE_FAILURES.swap(0, Ordering::Relaxed)
    }
}

/// Fold in-memory live-apply failures into a snapshot (the file may predate this process).
fn with_live_failures(
    snapshot: &DnsSnapshot,
    failures: &std::collections::BTreeSet<String>,
) -> DnsSnapshot {
    let mut merged = snapshot.clone();
    for adapter in &mut merged.adapters {
        adapter.live_apply_failed |= failures.contains(&adapter.interface_guid);
    }
    merged
}

/// Parse and version-check `protected-dns.json`, returning the reason it is unusable rather
/// than an opaque error.
///
/// `version` exists so that a schema change is a *migration*, not a brick: a file written by a
/// newer build cannot be reinterpreted by this one — its `None`/`Some` distinction is what
/// decides between deleting a value and rewriting it — so it is reported unreadable and goes
/// through the same recovery path as a corrupt file. Older versions stay readable: every field
/// added since carries `#[serde(default)]`.
fn parse_snapshot(bytes: &[u8]) -> std::result::Result<DnsSnapshot, String> {
    let snapshot: DnsSnapshot =
        serde_json::from_slice(bytes).map_err(|error| format!("the file is corrupt ({error})"))?;
    if snapshot.version > SNAPSHOT_VERSION {
        return Err(format!(
            "the file was written by a newer build (version {}, this build understands up to \
             {SNAPSHOT_VERSION})",
            snapshot.version
        ));
    }
    Ok(snapshot)
}

/// Whether restoration can be established **without** the snapshot.
///
/// A snapshot we cannot read is not evidence that DNS is still redirected — it only means we
/// cannot say what the servers *were*. If nothing on the machine still points at the loopback
/// core, and no live-apply failure is on record, then "DNS is no longer redirected to a dead
/// resolver" is demonstrably true regardless of what the file said, which is exactly what the
/// disarm gate needs to know. Anything else stays fail-closed: the kill switch remains armed
/// and the unreadable file is kept.
fn restore_established_without_snapshot(any_loopback: bool, live_apply_failed: bool) -> bool {
    !any_loopback && !live_apply_failed
}

/// Reconciliation delay after `failures` consecutive failed repairs, or `None` once repair is
/// suspended.
///
/// The watchdog used to call `enable()` every `DNS_WATCHDOG_INTERVAL` for as long as the
/// protection looked drifted, with no backoff and no cap — one permanently unconfigurable
/// adapter was enough to spawn PowerShell processes and rewrite the snapshot file forever.
/// Suspending relaxes nothing: the snapshot, the status error, and the armed kill switch all
/// stay exactly as they are, and an explicit connect still calls `enable()` directly.
fn reconcile_backoff(failures: u32) -> Option<std::time::Duration> {
    if failures == 0 {
        return Some(std::time::Duration::ZERO);
    }
    if failures >= DNS_RECONCILE_MAX_FAILURES {
        return None;
    }
    let doubling = 1_u32 << (failures - 1).min(5);
    Some(std::cmp::min(
        DNS_WATCHDOG_INTERVAL * doubling,
        DNS_RECONCILE_MAX_BACKOFF,
    ))
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

async fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    crate::core::paths::ensure_persistent_state_layout()?;
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    let temporary = path.with_extension("tmp");
    if std::fs::symlink_metadata(&temporary).is_ok() {
        std::fs::remove_file(&temporary)?;
    }
    tokio::fs::write(&temporary, bytes).await?;
    crate::core::platform_security::secure_private_service_file_if_exists(&temporary)?;
    crate::core::atomic_file::replace(&temporary, path).await?;
    crate::core::platform_security::secure_private_service_file_if_exists(path)?;
    Ok(())
}

// --- Engine boundary (registry + CIM on Windows; stubs elsewhere) ---

/// Stable, App-mappable marker for "the DNS engine stopped answering". Same contract as
/// `windows_kill_switch::WFP_ENGINE_WEDGED_PREFIX`: the App matches by substring and every
/// handler wraps this message in its own context, so the marker must survive anywhere inside
/// the string. Separate from the WFP markers because the cause and the user action differ —
/// a wedged Dnscache/registry filter, not the Base Filtering Engine.
#[cfg_attr(not(any(all(windows, not(feature = "test")), test)), allow(dead_code))]
pub(crate) const DNS_ENGINE_WEDGED_PREFIX: &str = "TONO_DNS_ENGINE_WEDGED";

/// Stable, App-mappable marker for "`protected-dns.json` cannot be read *and* the machine is
/// still resolving through the loopback core". Same substring contract as the wedge markers.
/// Separate from them because the user action differs: this one is resolved by putting the
/// affected adapters back on automatic (DHCP) DNS, or by the elevated emergency disarm.
pub(crate) const DNS_SNAPSHOT_UNREADABLE_PREFIX: &str = "TONO_DNS_SNAPSHOT_UNREADABLE";
/// Stable marker for a deleted recovery snapshot while an adapter still carries the current
/// Tono-only DNS endpoint. The disarm gate must stay closed until Windows DNS is repaired.
pub(crate) const DNS_SNAPSHOT_MISSING_PREFIX: &str = "TONO_DNS_SNAPSHOT_MISSING";

/// Stable, App-mappable marker for "the restore was accepted on registry evidence alone after a
/// sustained live-apply failure" (see [`accepts_degraded_restore`]). It rides in `last_error` on
/// an otherwise *successful* restore, so the App must treat it as a warning to surface, not as a
/// failed operation.
pub(crate) const DNS_RESTORE_DEGRADED_PREFIX: &str = "TONO_DNS_RESTORE_DEGRADED";

/// Stable, App-mappable marker for "protected DNS was applied, but the apply or its read-back
/// could not be verified on every adapter". Like [`DNS_RESTORE_DEGRADED_PREFIX`] it rides in
/// `last_error` on an otherwise **successful** operation, so the App must treat it as a warning
/// to surface (and to put in the diagnostics report), never as a failed enable. It is the
/// explanation the user gets when the connect subsequently fails in the fake-ip probe.
pub(crate) const DNS_PROTECTION_UNVERIFIED_PREFIX: &str = "TONO_DNS_UNVERIFIED";

/// Budget for one *reading* DNS engine call (registry sweep + `GetAdaptersAddresses`). A
/// healthy enumeration is milliseconds; 25 s is the same clock `WFP_CALL_TIMEOUT` uses, so the
/// two modules give up on a wedged kernel/service at the same point, and it leaves the
/// surrounding `IPC_HANDLER_TIMEOUT` = 60 s more than half its budget to answer the client.
#[cfg(all(windows, not(feature = "test")))]
const DNS_CALL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);
/// Budget for a *mutating* call (protected-DNS apply / snapshot restore). Longer than the reading
/// budget on purpose: this path already contains two internally bounded PowerShell batches
/// (2 × `engine::POWERSHELL_TIMEOUT` = 20 s) plus the registry sweep, and an outer bound below
/// its own inner bound would report a merely slow machine as wedged and refuse a restore that
/// was still making progress. It stays below `windows_kill_switch::DNS_RESTORE_TIMEOUT` = 40 s
/// so that a wedged DNS engine is named by *this* module's marker instead of being swallowed by
/// the cross-module bound, and because the first expiry latches the in-flight claim, one handler
/// can stall for at most one budget no matter how many engine calls its path makes (`enable`
/// makes up to six).
#[cfg(all(windows, not(feature = "test")))]
const DNS_APPLY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// Budget for the best-effort cache flush: `LoadLibraryW("dnsapi.dll")` + a `DnsFlushResolver
/// Cache` RPC to the Dnscache service (no timeout parameter of its own) and, failing that, a
/// 5 s `ipconfig /flushdns`. Short, because a flush that never returns must not eat the
/// mutating budget — its failure is only logged, but the claim it leaves behind is what keeps
/// the next operation from piling a second thread onto a wedged Dnscache.
#[cfg(all(windows, not(feature = "test")))]
const DNS_FLUSH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
/// Anything slower than this is already pathological. Set above a PowerShell cold start
/// (~1 s), which the mutating path legitimately pays, so the warning means "degrading", not
/// "busy".
#[cfg(any(all(windows, not(feature = "test")), test))]
const DNS_SLOW_CALL: std::time::Duration = std::time::Duration::from_secs(5);

/// A DNS engine call that was handed to a blocking thread and has not come back yet.
///
/// Registered *before* the thread is spawned and released *only* by that thread — never by the
/// caller. Same asymmetry as `windows_kill_switch::EngineCallInFlight`: a caller that hits its
/// deadline gives up on the *answer*, not on the *ownership*.
#[cfg(any(all(windows, not(feature = "test")), test))]
#[derive(Debug, Clone, Copy)]
struct DnsCallInFlight {
    operation: &'static str,
    started_at: std::time::Instant,
    /// Epoch of this call. The releasing guard only clears its own epoch, so a call that
    /// returns very late can never erase the claim of a call that started after it.
    epoch: u64,
    /// Its caller already timed out and reported failure; the result is discarded on arrival.
    abandoned: bool,
}

#[cfg(any(all(windows, not(feature = "test")), test))]
static DNS_CALL_IN_FLIGHT: Lazy<Mutex<Option<DnsCallInFlight>>> = Lazy::new(|| Mutex::new(None));
#[cfg(any(all(windows, not(feature = "test")), test))]
static DNS_CALL_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(any(all(windows, not(feature = "test")), test))]
fn dns_call_slot() -> std::sync::MutexGuard<'static, Option<DnsCallInFlight>> {
    DNS_CALL_IN_FLIGHT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
fn dns_call_in_flight() -> Option<DnsCallInFlight> {
    *dns_call_slot()
}

/// Refusal for a caller that wants to start an engine call while an earlier one is still
/// inside the loader/registry/Dnscache. Fail-closed: nothing is applied, nothing is restored,
/// nothing is deleted, and the machine keeps whatever the last completed call left behind —
/// which for the restore path means the snapshot survives and the kill switch stays armed.
#[cfg(any(all(windows, not(feature = "test")), test))]
fn wedged_dns_error(operation: &str, wedged: DnsCallInFlight) -> anyhow::Error {
    anyhow::anyhow!(
        "{DNS_ENGINE_WEDGED_PREFIX}: the DNS engine has been inside {} for {:?} without \
         returning, so {operation} is refused rather than started as a second concurrent \
         writer. The DNS Client service (Dnscache), a registry filter driver or third-party \
         security software is likely wedged; protected DNS stays in its last known state — \
         including its snapshot — until that call returns or the machine is restarted.",
        wedged.operation,
        wedged.started_at.elapsed(),
    )
}

/// Dropped on the blocking thread the instant the engine call returns — on time, or hours
/// late. This is the *only* place an in-flight claim is released, and it releases only its own
/// epoch.
#[cfg(any(all(windows, not(feature = "test")), test))]
struct DnsCallClaim(u64);

#[cfg(any(all(windows, not(feature = "test")), test))]
impl Drop for DnsCallClaim {
    fn drop(&mut self) {
        let mut slot = dns_call_slot();
        let Some(current) = *slot else { return };
        if current.epoch != self.0 {
            return;
        }
        *slot = None;
        if current.abandoned {
            // The caller reported failure long ago; this is the log line that says the engine
            // is alive again. The call's own result was dropped with its `JoinHandle`, so it
            // cannot contradict what was already reported.
            tracing::error!(
                "dns: {} finally returned after {:?}; its caller had already given up, the \
                 result is discarded, and DNS operations are accepted again",
                current.operation,
                current.started_at.elapsed(),
            );
        }
    }
}

/// The status watchdog reads every `DNS_WATCHDOG_INTERVAL`: only the rare, mutating operations
/// may announce themselves at info, or the service log would carry two lines every two seconds
/// forever.
#[cfg(any(all(windows, not(feature = "test")), test))]
fn dns_call_is_periodic(operation: &str) -> bool {
    operation == "collect" || operation == "verify protected DNS"
}

/// Run one DNS engine operation on a blocking thread under a hard deadline, holding the
/// single-writer claim described on [`DnsCallInFlight`].
///
/// These calls are synchronous registry/IP-helper/CIM/Dnscache work, so they run off the IPC
/// runtime. They are also bounded, because on a real machine `DnsFlushResolverCache` (an RPC
/// to a wedged Dnscache), `LoadLibraryW` behind an AV image-load callback, or a registry sweep
/// behind a filter driver can block forever — and `spawn_blocking` cannot be cancelled: the
/// thread keeps running whatever the caller does.
///
/// Single-writer argument for the timeout path:
/// * the claim is registered *before* the thread is spawned and released only by that thread,
///   in `DnsCallClaim::drop`, when the blocking call actually returns;
/// * a caller that hits its deadline returns an error and leaves the claim standing, so every
///   later DNS engine call — this operation's, the next handler's, the watchdog's — fails fast
///   here instead of stacking a second writer on the same registry keys and adapters;
/// * the abandoned task can publish nothing: it only touches `engine::*`, its return value dies
///   with the `JoinHandle` the deadline dropped, and its claim release is keyed to its own
///   epoch, so it cannot clear a claim taken by a later call.
///
/// The facade's `DNS_OPERATION` lock alone cannot provide this: it is released as soon as the
/// timing-out caller returns, which is exactly when the abandoned thread is still working.
///
/// The machinery is compiled off Windows too, so those ownership rules stay unit-testable;
/// only the closures handed to it are Windows-only.
#[cfg(any(all(windows, not(feature = "test")), test))]
async fn bounded_dns_call<T: Send + 'static>(
    budget: std::time::Duration,
    operation: &'static str,
    call: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    let epoch = {
        let mut slot = dns_call_slot();
        if let Some(wedged) = *slot {
            return Err(wedged_dns_error(operation, wedged));
        }
        let epoch = DNS_CALL_EPOCH.fetch_add(1, Ordering::AcqRel);
        *slot = Some(DnsCallInFlight {
            operation,
            started_at: std::time::Instant::now(),
            epoch,
            abandoned: false,
        });
        epoch
    };
    let announce = !dns_call_is_periodic(operation);
    if announce {
        tracing::info!("dns: {operation} starting");
    } else {
        tracing::debug!("dns: {operation} starting");
    }
    let started_at = std::time::Instant::now();
    let task = tokio::task::spawn_blocking(move || {
        // Local, so it drops (releasing the claim) after `call` returns and before the result
        // reaches the awaiting caller.
        let _claim = DnsCallClaim(epoch);
        call()
    });
    match tokio::time::timeout(budget, task).await {
        Ok(joined) => {
            let elapsed = started_at.elapsed();
            if elapsed >= DNS_SLOW_CALL {
                tracing::warn!(
                    "dns: {operation} finished in {}ms — the engine is answering, but far slower \
                     than a healthy call",
                    elapsed.as_millis()
                );
            } else if announce {
                tracing::info!("dns: {operation} finished in {}ms", elapsed.as_millis());
            } else {
                tracing::debug!("dns: {operation} finished in {}ms", elapsed.as_millis());
            }
            joined.context("DNS engine task failed")?
        }
        Err(_) => {
            // Claim the abandonment by epoch instead of writing the slot: the call may have
            // returned in the instant between the deadline and this line, in which case its
            // guard already cleared the slot and nothing is wedged.
            let still_running = {
                let mut slot = dns_call_slot();
                match slot.as_mut() {
                    Some(current) if current.epoch == epoch => {
                        current.abandoned = true;
                        true
                    }
                    _ => false,
                }
            };
            if still_running {
                tracing::error!(
                    "dns: {operation} did not return within {budget:?} and is still running; \
                     every further DNS operation fails fast until it returns"
                );
            } else {
                tracing::error!(
                    "dns: {operation} returned just after its {budget:?} deadline; its result was \
                     discarded and the caller was told it failed"
                );
            }
            bail!(
                "{DNS_ENGINE_WEDGED_PREFIX}: the DNS engine did not answer within {budget:?} \
                 during {operation}; the DNS Client service (Dnscache), a registry filter driver \
                 or third-party security software may be wedged. Protected DNS was left in its \
                 last known state, its snapshot was kept, and no further DNS operation starts \
                 until the pending call returns."
            )
        }
    }
}

async fn engine_collect() -> Result<Vec<AdapterDnsSnapshot>> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        bounded_dns_call(DNS_CALL_TIMEOUT, "collect", engine::collect_adapters).await
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(test_hooks::collected_adapters())
    }
}

/// Collect only adapters whose Windows resolver configuration Tono owns. The tunnel exclusion
/// inside [`without_current_tunnel`] uses the WFP-validated runtime LUID while a core is alive
/// and the WinTUN connection name once it is not, so a stale tunnel adapter left by an orphaned
/// core can never re-enter a snapshot or a restore proof.
async fn collect_dns_adapters() -> Result<Vec<AdapterDnsSnapshot>> {
    let adapters = engine_collect().await?;
    let current_tunnel_luid = crate::core::windows_kill_switch::protected_tunnel_luid().await;
    Ok(without_current_tunnel(adapters, current_tunnel_luid))
}

async fn engine_apply_protected(adapters: &[AdapterDnsSnapshot]) -> Result<Vec<(String, bool)>> {
    // The only two writers of adapter DNS are this and `engine_apply_snapshot`; both mark the
    // window so `netmon` does not report our own writes as the machine's network changing.
    let _self_write = SelfWriteWindow::open();
    #[cfg(all(windows, not(feature = "test")))]
    {
        let guids = adapters
            .iter()
            .map(|adapter| adapter.interface_guid.clone())
            .collect::<Vec<_>>();
        return bounded_dns_call(DNS_APPLY_TIMEOUT, "apply protected DNS", move || {
            engine::apply_protected_set(&guids)
        })
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        // The stub models the two shapes the real engine fails in, because the difference is now
        // the difference between a hard failure and a recorded one:
        //   * the batch cannot be run at all — no adapter touched, no per-adapter outcome;
        //   * the batch runs and reports per-adapter live failures while the registry write
        //     underneath it landed (the real-machine case).
        if test_hooks::apply_batch_unavailable() {
            bail!("the DNS apply batch could not be run at all (test hook)");
        }
        let ok = !test_hooks::live_apply_fails();
        Ok(adapters
            .iter()
            .map(|adapter| (adapter.interface_guid.clone(), ok))
            .collect())
    }
}

async fn engine_apply_snapshot(snapshot: &DnsSnapshot) -> Result<Vec<(String, bool)>> {
    // Restore writes the same per-adapter registry values and runs the same CIM/netsh batch as
    // the loopback apply, so it raises the same notifications and gets the same window.
    let _self_write = SelfWriteWindow::open();
    #[cfg(all(windows, not(feature = "test")))]
    {
        let snapshot = snapshot.clone();
        return bounded_dns_call(DNS_APPLY_TIMEOUT, "restore snapshot", move || {
            engine::apply_snapshot(&snapshot)
        })
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        // The stub reports success unless a test asks for the machine condition that produced
        // the real-machine deadlock: a live apply that fails while the registry restore behind
        // it succeeds (`engine::apply_snapshot` writes the four registry values whatever the
        // PowerShell batch reported).
        let ok = !test_hooks::live_apply_fails();
        // A successful *automatic (DHCP)* reset takes the machine off the loopback resolver, so
        // the stubbed live read has to start answering that way — otherwise rung 2 of the
        // uninstall ladder is unreachable in every test build. The stub models "the reset lands
        // completely or not at all"; on a real machine the registry deletion is independent of
        // the PowerShell batch, which is precisely why rung 2 verifies on the reported machine
        // even though its live apply keeps failing.
        if ok && is_automatic_reset(snapshot) {
            test_hooks::set_live_dns_on_loopback(false);
        }
        Ok(snapshot
            .adapters
            .iter()
            .map(|adapter| (adapter.interface_guid.clone(), ok))
            .collect())
    }
}

/// Whether this snapshot is the uninstall ladder's automatic (DHCP) reset: a non-empty adapter
/// list in which every entry has all four values absent. "Absent" is what the engine turns into
/// a registry delete and a DHCP live apply, so this is a precise structural test rather than a
/// flag that could drift from what is actually applied.
#[cfg(any(test, not(all(windows, not(feature = "test")))))]
fn is_automatic_reset(snapshot: &DnsSnapshot) -> bool {
    !snapshot.adapters.is_empty()
        && snapshot.adapters.iter().all(|adapter| {
            adapter.ipv4_name_server.is_none()
                && adapter.ipv4_profile_name_server.is_none()
                && adapter.ipv6_name_server.is_none()
                && adapter.ipv6_profile_name_server.is_none()
        })
}

async fn engine_all_loopback(adapters: &[AdapterDnsSnapshot]) -> Result<bool> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        let guids = adapters
            .iter()
            .map(|adapter| adapter.interface_guid.clone())
            .collect::<Vec<_>>();
        return bounded_dns_call(DNS_CALL_TIMEOUT, "verify protected DNS", move || {
            engine::all_loopback(&guids)
        })
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let _ = adapters;
        Ok(false)
    }
}

/// Whether any adapter still resolves through a current or legacy Tono protected DNS target —
/// "is any of it left?", the mirror of `engine_all_loopback`'s "is protection complete?".
///
/// Two callers: the snapshot-less recovery, and the restore proof itself, which needs positive
/// live evidence that the machine is not being left pointed at a core that is about to stop
/// answering (see [`restore_is_proven`]). The restore proof narrows the adapter list first
/// ([`adapters_owing_live_proof`]).
async fn engine_any_loopback(adapters: &[AdapterDnsSnapshot]) -> Result<bool> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        let guids = adapters
            .iter()
            .map(|adapter| adapter.interface_guid.clone())
            .collect::<Vec<_>>();
        return bounded_dns_call(DNS_CALL_TIMEOUT, "detect Tono DNS", move || {
            engine::any_loopback(&guids)
        })
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        let _ = adapters;
        // Without this hook the stub would always answer "not on loopback", which makes the
        // unproven-restore branch — the fail-closed half of the corrupt-snapshot contract —
        // unreachable in every test build. A test that cannot fail is worse than none.
        Ok(test_hooks::live_dns_is_on_loopback())
    }
}

/// Test-only control over the engine answers that are unobservable off Windows.
#[cfg(any(not(all(windows, not(feature = "test"))), test))]
pub(crate) mod test_hooks {
    use super::AdapterDnsSnapshot;
    use std::sync::{
        LazyLock, Mutex,
        atomic::{AtomicBool, Ordering},
    };

    static COLLECTED_ADAPTERS: LazyLock<Mutex<Vec<AdapterDnsSnapshot>>> =
        LazyLock::new(|| Mutex::new(Vec::new()));

    pub(crate) fn collected_adapters() -> Vec<AdapterDnsSnapshot> {
        COLLECTED_ADAPTERS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_collected_adapters(adapters: Vec<AdapterDnsSnapshot>) {
        *COLLECTED_ADAPTERS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = adapters;
    }

    static LIVE_DNS_ON_LOOPBACK: AtomicBool = AtomicBool::new(false);

    pub(crate) fn live_dns_is_on_loopback() -> bool {
        LIVE_DNS_ON_LOOPBACK.load(Ordering::Relaxed)
    }

    /// Simulate a machine whose adapters still resolve through the loopback core, so a restore
    /// that cannot read its snapshot is genuinely unprovable.
    pub(crate) fn set_live_dns_on_loopback(on_loopback: bool) {
        LIVE_DNS_ON_LOOPBACK.store(on_loopback, Ordering::Relaxed);
    }

    static LIVE_APPLY_FAILS: AtomicBool = AtomicBool::new(false);

    pub(crate) fn live_apply_fails() -> bool {
        LIVE_APPLY_FAILS.load(Ordering::Relaxed)
    }

    /// Simulate the machine from the real regression: PowerShell/CIM reports the live apply as
    /// failed (which records `live_apply_failed` and starts the streak) while the registry
    /// restore underneath it succeeded.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_live_apply_fails(fails: bool) {
        LIVE_APPLY_FAILS.store(fails, Ordering::Relaxed);
    }

    static APPLY_BATCH_UNAVAILABLE: AtomicBool = AtomicBool::new(false);

    pub(crate) fn apply_batch_unavailable() -> bool {
        APPLY_BATCH_UNAVAILABLE.load(Ordering::Relaxed)
    }

    /// Simulate the one apply outcome that is still a hard failure of `enable`: the batch could
    /// not be run at all, so nothing was written to any adapter and there is no per-adapter
    /// result to record — adapter enumeration failed, or the engine call was wedged.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_apply_batch_unavailable(unavailable: bool) {
        APPLY_BATCH_UNAVAILABLE.store(unavailable, Ordering::Relaxed);
    }
}

async fn engine_flush_cache() -> Result<()> {
    #[cfg(all(windows, not(feature = "test")))]
    {
        return bounded_dns_call(DNS_FLUSH_TIMEOUT, "flush", engine::flush_resolver_cache).await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(())
    }
}

async fn engine_suppress_encrypted_dns() -> Result<()> {
    let _self_write = SelfWriteWindow::open();
    #[cfg(all(windows, not(feature = "test")))]
    {
        return bounded_dns_call(
            DNS_APPLY_TIMEOUT,
            "suppress encrypted DNS",
            engine::suppress_encrypted_dns,
        )
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(())
    }
}

async fn engine_restore_encrypted_dns() -> Result<()> {
    let _self_write = SelfWriteWindow::open();
    #[cfg(all(windows, not(feature = "test")))]
    {
        return bounded_dns_call(
            DNS_APPLY_TIMEOUT,
            "restore encrypted DNS",
            engine::restore_encrypted_dns,
        )
        .await;
    }
    #[cfg(not(all(windows, not(feature = "test"))))]
    {
        Ok(())
    }
}

// --- Facade ---

/// Whether the state machine runs on this build (real service on Windows; stubbed engine
/// under test builds, which is what the unit tests drive).
const SUPPORTED: bool = cfg!(any(windows, test));

static LIVE_APPLY_FAILURES: Lazy<std::sync::Mutex<std::collections::BTreeSet<String>>> =
    Lazy::new(|| std::sync::Mutex::new(std::collections::BTreeSet::new()));
/// Last committed/live-verified DNS observation. IPC reads clone this synchronously instead of
/// waiting behind a CIM mutation. The background reconciler refreshes it and repairs drift.
static DNS_STATUS_CACHE: Lazy<Mutex<DnsProtectionStatus>> =
    Lazy::new(|| Mutex::new(DnsProtectionStatus::default()));
const DNS_WATCHDOG_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
/// Consecutive failed repairs after which the watchdog stops re-running `enable()`. Five
/// attempts (≈ 1 minute with the backoff) is enough for anything transient — a hot-plugged
/// adapter, a service still starting — and anything that survives it is a machine condition
/// that retrying cannot fix.
const DNS_RECONCILE_MAX_FAILURES: u32 = 5;
/// Ceiling for the reconciliation backoff, so even a long-lived failure costs at most one
/// repair attempt per minute instead of one every two seconds.
const DNS_RECONCILE_MAX_BACKOFF: std::time::Duration = std::time::Duration::from_secs(60);

fn ensure_supported() -> Result<()> {
    if SUPPORTED {
        Ok(())
    } else {
        bail!("protected DNS is unsupported on this platform")
    }
}

fn record_outcome<T>(result: Result<T>) -> Result<T> {
    match result {
        Ok(value) => {
            *DNS_LAST_ERROR.lock().unwrap() = None;
            Ok(value)
        }
        Err(error) => {
            *DNS_LAST_ERROR.lock().unwrap() = Some(format!("{error:#}"));
            Err(error)
        }
    }
}

/// Record per-adapter live-apply results in memory and into the snapshot's per-adapter flags.
fn note_live_results(snapshot: &mut DnsSnapshot, results: &[(String, bool)]) {
    let mut failures = LIVE_APPLY_FAILURES.lock().unwrap();
    for (guid, ok) in results {
        if *ok {
            failures.remove(guid);
        } else {
            failures.insert(guid.clone());
        }
        if let Some(adapter) = snapshot
            .adapters
            .iter_mut()
            .find(|adapter| &adapter.interface_guid == guid)
        {
            adapter.live_apply_failed = !ok;
        }
    }
}

/// Move `protected-dns.json` aside instead of deleting it: it may still be the only record of
/// the original resolvers, and a support case can decode by hand what this build could not.
///
/// `label` names why (`corrupt` / `superseded`) and becomes part of the retained file name.
/// Called *only* once the machine is known not to be redirected any more — after
/// [`restore_established_without_snapshot`] on the recovery path, or after the uninstall
/// ladder's rung 2 has verified the same property — so the live snapshot is never removed while
/// the machine could still be pointed at the loopback core.
async fn quarantine_snapshot(label: &str, reason: &str) -> Result<()> {
    let path = snapshot_path();
    let quarantined = path.with_extension(format!("{label}-{}.json", now_unix()));
    if let Err(error) = tokio::fs::rename(&path, &quarantined).await {
        if error.kind() == std::io::ErrorKind::NotFound {
            return Ok(());
        }
        return Err(error).context("failed to quarantine the protected-dns snapshot");
    }
    crate::core::platform_security::secure_private_service_file_if_exists(&quarantined)?;
    tracing::error!(
        "dns: {reason} — the file was kept as {} rather than deleted, so the original resolvers \
         stay recoverable by hand",
        quarantined.display()
    );
    Ok(())
}

/// Recovery for a `protected-dns.json` this build cannot read (corrupt, or a newer schema).
///
/// Without this, an unreadable snapshot is terminal in both directions: `restore_protected`
/// can never prove a restore, `ensure_restored` therefore always fails, the WFP disarm is
/// refused, and because the file is only deleted *after* a proven restore it stays unreadable
/// across every retry and every reboot — a permanently blocked machine with no in-app way out.
///
/// The way out is evidence, not trust: read the live adapters and demand that *nothing* still
/// points at either Tono's current TUN DNS endpoint or a legacy protected loopback value (and
/// that no live-apply failure is on record). That establishes
/// the property the disarm gate actually protects — the machine is not left resolving through a
/// core that is no longer running — without knowing what the servers used to be. Only then is
/// the file quarantined.
///
/// Every other outcome (still on a Tono DNS target, a recorded live failure, or an engine call that
/// times out on the way to finding out) returns an error: nothing is deleted, nothing is
/// disarmed, and the message names the two documented ways forward.
async fn recover_unreadable_snapshot(reason: &str) -> Result<()> {
    let current = collect_dns_adapters().await?;
    let any_loopback = engine_any_loopback(&current).await?;
    let live_apply_failed = !LIVE_APPLY_FAILURES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_empty();
    if !restore_established_without_snapshot(any_loopback, live_apply_failed) {
        bail!(
            "{DNS_SNAPSHOT_UNREADABLE_PREFIX}: protected-dns.json cannot be read ({reason}) and \
             the machine still resolves through a Tono protected DNS target \
             (tono_dns={any_loopback}, live_apply_failed={live_apply_failed}), so the \
             original DNS servers cannot be proven restored and protection stays armed. Set the \
             affected adapters back to automatic (DHCP) DNS — or to the servers you use — and \
             retry the disconnect; the elevated `--emergency-disarm` remains the documented \
             escape hatch. The unreadable file is kept for diagnosis."
        );
    }
    quarantine_snapshot(
        "corrupt",
        &format!(
            "protected-dns.json cannot be read ({reason}); no adapter still resolves through a \
             Tono protected DNS target, so restoration holds without it and protection starts from a clean \
             snapshot"
        ),
    )
    .await?;
    if let Err(error) = engine_restore_encrypted_dns().await {
        tracing::warn!("dns: encrypted DNS restore after unreadable snapshot failed: {error:#}");
    }
    Ok(())
}

/// Snapshot → set protected DNS → verify. Idempotent: a second call while protected keeps the
/// original snapshot — but if the adapters are not actually on the protected endpoint (a
/// previous enable died mid-apply), the write is replayed first.
pub(crate) async fn enable() -> Result<DnsProtectionStatus> {
    ensure_supported()?;
    let _operation = DNS_OPERATION.lock().await;
    enable_unlocked(EnableTrigger::Request).await
}

/// The body of [`enable`], for callers that already hold `DNS_OPERATION`.
///
/// The watchdog must decide *and act* inside one acquisition (see [`spawn_status_watchdog`]),
/// which is only possible if the action itself does not re-acquire the lock.
async fn enable_unlocked(trigger: EnableTrigger) -> Result<DnsProtectionStatus> {
    if trigger == EnableTrigger::Request {
        // From here until an explicit restore, drift is worth repairing. Set before any work so
        // that a half-applied enable is still repaired by the watchdog.
        PROTECTION_WANTED.store(true, Ordering::Release);
    }
    let existing = match tokio::fs::read(snapshot_path()).await {
        Ok(bytes) => match parse_snapshot(&bytes) {
            Ok(snapshot) => Some(snapshot),
            // Quarantining an unreadable snapshot is a decision for an explicit request, never
            // for a background repair loop.
            Err(reason) if trigger == EnableTrigger::Reconcile => {
                bail!(
                    "{DNS_SNAPSHOT_UNREADABLE_PREFIX}: protected-dns.json cannot be read \
                     ({reason}); automatic reconciliation will not act on it — reconnect or \
                     disconnect to recover"
                );
            }
            // Quarantining first is what makes this safe: the recovery proves that no adapter
            // is on loopback, so the originals collected below are genuine. Enabling on top of
            // an unreadable snapshot without that proof would record our own loopback values as
            // the originals and destroy the way back.
            Err(reason) => {
                record_outcome(recover_unreadable_snapshot(&reason).await)?;
                None
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let existing = existing
        .map(|snapshot| with_live_failures(&snapshot, &LIVE_APPLY_FAILURES.lock().unwrap()));
    let snapshot_present = existing.is_some();
    if trigger == EnableTrigger::Reconcile && !snapshot_present {
        // Repair means "re-apply the snapshot that is in force", never "capture new originals".
        // With no snapshot this call would be an *initial* enable: it would record the machine's
        // current (correct, just-restored) resolvers as the originals and point every adapter at
        // a loopback core that is no longer running — a machine-wide DNS outage that reports
        // itself as healthy. The lock now spans the watchdog's read and this call, so the race
        // that could produce it is closed; this is the belt-and-braces half.
        tracing::debug!("dns: nothing to reconcile — the snapshot is gone, so protection ended");
        return status_unlocked().await;
    }
    // Always collect before the idempotence decision. Network-change reconnects call `enable`
    // again, and a newly installed/hot-plugged adapter must have its original DNS appended to the
    // durable snapshot before it is pointed at loopback.
    let mut fresh = DnsSnapshot {
        version: SNAPSHOT_VERSION,
        taken_at: now_unix(),
        adapters: collect_dns_adapters().await?,
    };
    if !snapshot_present {
        // A recovery file can be deleted independently of the registry (AV quarantine, manual
        // cleanup, disk corruption, failed-connect release). Never turn the TUN endpoint left
        // behind into the new "original". If adapters still list 198.18.0.2 with no snapshot,
        // heal them to DHCP first so Connect is not permanently bricked after a prior failure.
        if ensure_snapshotless_adapters_are_safe(&fresh.adapters).is_err() {
            fresh.adapters = heal_orphaned_protected_dns_without_snapshot(&fresh.adapters).await?;
        }
        record_outcome(ensure_snapshotless_adapters_are_safe(&fresh.adapters))?;
    }
    // Health and replay decisions cover adapters that are live now, not historical snapshot
    // entries that have since been disabled or unplugged. Their originals remain in `snapshot`
    // and are still restored in the registry on disconnect.
    let active_adapters = fresh.adapters.clone();
    let mut snapshot = merge_snapshot(existing, fresh);
    let all_loopback = snapshot_present && engine_all_loopback(&active_adapters).await?;
    let live_apply_failed = snapshot
        .adapters
        .iter()
        .any(|adapter| adapter.live_apply_failed);
    // Snapshot first, even on an otherwise idempotent replay: `snapshot` may now include adapters
    // that appeared after the first enable, and any later failure must retain their originals.
    atomic_write(&snapshot_path(), &serde_json::to_vec_pretty(&snapshot)?).await?;
    if !needs_loopback_replay(snapshot_present, all_loopback, live_apply_failed) {
        // Protection is complete and nothing is outstanding: retire any note from an earlier
        // round so the reconciler is not kept awake by evidence that no longer holds.
        clear_unverified_note();
        // Adapters may already be on 198.18.0.2 from an older build that did not pin
        // Encrypted DNS off. Do that here or Win10/11 DoH still times out fake-ip.
        if let Err(error) = engine_suppress_encrypted_dns().await {
            tracing::warn!("dns: encrypted DNS suppress on already-protected adapters failed: {error:#}");
        }
        return status_unlocked().await;
    }
    // `Some(note)` = applied, but at least one adapter could not be verified — a *success* that
    // must be recorded, not a failure (see the module docs). `Err` is reserved for the round
    // that produced no per-adapter outcome at all.
    let outcome: Result<Option<String>> = async {
        // Hard failure #1: the batch could not be run, so not one adapter was touched and there
        // is no result to record. `?` on purpose — with nothing applied there is nothing to
        // restore and nothing for the watchdog to reconcile, and a status that claimed
        // "protected" would be a lie. A wedged engine (`DNS_ENGINE_WEDGED_PREFIX`) surfaces here.
        let live = engine_apply_protected(&snapshot.adapters).await?;
        note_apply_round(live.iter().any(|(_, ok)| !ok));
        note_live_results(&mut snapshot, &live);
        // Hard failure #2: the record of the round could not be persisted. Persist both failures
        // and successful retries — otherwise a recovered adapter keeps its old
        // `live_apply_failed` bit on disk and every later enable unnecessarily replays DNS, and
        // (since the demotion) an unpersisted failure is a failure the restore proof and the
        // reconciler would never learn about.
        atomic_write(&snapshot_path(), &serde_json::to_vec_pretty(&snapshot)?).await?;
        let failed = live
            .iter()
            .filter(|(_, ok)| !ok)
            .map(|(guid, _)| guid.clone())
            .collect::<Vec<_>>();
        // Everything from here down is evidence, never a gate. The read-back is indirect (the
        // registry cannot even express the protected IPv6 state) and fails for environmental
        // reasons; the direct proof is the App's fake-ip probe, which runs seconds later in the
        // same connect transaction. Both outcomes — and a read that could not be performed at
        // all — are recorded and reported instead of aborting the connect.
        let read_back = if ENGINE_LIVE {
            match collect_dns_adapters().await {
                Ok(active_after_apply) => match engine_all_loopback(&active_after_apply).await {
                    Ok(true) => LoopbackReadBack::Verified,
                    Ok(false) => LoopbackReadBack::Contradicted,
                    Err(error) => {
                        tracing::warn!(
                            "dns: the protected-DNS read-back could not be run: {error:#}"
                        );
                        LoopbackReadBack::Unavailable
                    }
                },
                Err(error) => {
                    tracing::warn!("dns: adapters could not be re-read after the apply: {error:#}");
                    LoopbackReadBack::Unavailable
                }
            }
        } else {
            LoopbackReadBack::NotAttempted
        };
        Ok(unverified_note(&failed, live.len(), read_back))
    }
    .await;
    let unverified = record_outcome(outcome)?;
    if let Some(note) = unverified {
        // `record_outcome` cleared `last_error` on the way through: this round *succeeded* for
        // the caller, but it must never be silent — put the note back so it reaches the status
        // payload (`status_unlocked` reads `DNS_LAST_ERROR`), the App's diagnostics report and
        // the service log. It is also what `needs_reconcile` keys on.
        tracing::warn!("dns: {note}");
        *DNS_LAST_ERROR
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(note);
    }
    // Loopback is applied (verified or recorded as unverified): pin Encrypted DNS off so
    // the App's fake-ip probe (and Chrome using system DNS) hit 198.18.0.2 instead of a
    // DoH resolver that WFP then blocks. Then flush so cached public A records die.
    if let Err(error) = engine_suppress_encrypted_dns().await {
        tracing::warn!("dns: encrypted DNS suppress after enable failed: {error:#}");
    }
    if let Err(error) = engine_flush_cache().await {
        tracing::warn!("DNS cache flush after enable failed: {error:#}");
    }
    status_unlocked().await
}

/// Restore every adapter from the snapshot, prove it by registry read-back *and* by a live read
/// that finds nothing left on the loopback core, then drop the snapshot. Failing any of that
/// keeps the snapshot — and, via the disarm invariant, the block armed.
pub(crate) async fn restore_protected() -> Result<DnsProtectionStatus> {
    if !SUPPORTED {
        return status_unlocked().await;
    }
    let _operation = DNS_OPERATION.lock().await;
    // Intent first, before any outcome is known: from the moment a restore is *requested*, the
    // loopback redirect is no longer wanted. A restore that fails — or an emergency disarm that
    // proceeds on an unproven one — must never be undone by the reconciler putting loopback back
    // while no core is listening. An explicit `enable` sets it again.
    PROTECTION_WANTED.store(false, Ordering::Release);
    let bytes = match tokio::fs::read(snapshot_path()).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Absence alone is not proof of a clean state: the file and the adapter registry are
            // separate writes. Refuse to stop the core/disarm if the current TUN DNS endpoint
            // survived while its recovery record did not.
            record_outcome(ensure_snapshotless_dns_is_safe().await)?;
            return status_unlocked().await;
        }
        Err(error) => return Err(error.into()),
    };
    let snapshot = match parse_snapshot(&bytes) {
        Ok(snapshot) => snapshot,
        // The snapshot is unreadable: fall back to proving restoration from the live adapters
        // instead of leaving the disarm gate permanently unsatisfiable. This either establishes
        // that nothing resolves through loopback any more (and quarantines the file), or fails
        // closed with the marker and the two documented ways forward.
        Err(reason) => {
            record_outcome(recover_unreadable_snapshot(&reason).await)?;
            // Same reasoning as the proven path below: answers collected while DNS pointed at
            // the loopback core must not outlive the disconnect.
            if let Err(error) = engine_flush_cache().await {
                tracing::warn!("DNS cache flush after snapshot recovery failed: {error:#}");
            }
            return status_unlocked().await;
        }
    };
    let mut snapshot = with_live_failures(&snapshot, &LIVE_APPLY_FAILURES.lock().unwrap());
    // `Some(note)` = the restore was accepted on the documented degraded path and the note must
    // reach `last_error`; `None` = fully proven.
    let outcome: Result<Option<String>> = async {
        // The engine applies all adapters in one PowerShell batch and retries the failures
        // once in a second batch, reporting final per-adapter results.
        let live = engine_apply_snapshot(&snapshot).await?;
        let streak = note_apply_round(live.iter().any(|(_, ok)| !ok));
        note_live_results(&mut snapshot, &live);
        // Persist the refreshed flags either way; a refused disarm must keep accurate records.
        atomic_write(&snapshot_path(), &serde_json::to_vec_pretty(&snapshot)?).await?;
        // The registry half of the proof, read back off the machine. The stub engine reports no
        // adapters at all, which would make the comparison vacuous, so off Windows the
        // snapshot's own entries stand in and the live evidence below is what decides.
        let current = if ENGINE_LIVE {
            collect_dns_adapters().await?
        } else {
            snapshot.adapters.clone()
        };
        // The live half: is anything on this machine still pointed at a Tono DNS target? This is
        // the same evidence the corrupt-snapshot recovery runs on, and it is what replaced the
        // `live_apply_failed` veto — a stale flag from an earlier round now makes us insist on
        // this read, instead of overruling it.
        //
        // An engine that cannot answer leaves the restore *unproven*, never proven: the
        // question falls to the degraded exit below, which still demands an exact registry
        // match and a sustained streak.
        let owing_live_proof = adapters_owing_live_proof(&snapshot, &current);
        let live_loopback = match engine_any_loopback(&owing_live_proof).await {
            Ok(any_loopback) => Some(any_loopback),
            Err(error) => {
                tracing::warn!(
                    "dns: the live DNS state could not be read while proving the restore, so \
                     the restore stays unproven: {error:#}"
                );
                None
            }
        };
        if !restore_is_proven(&snapshot, &current, live_loopback) {
            let registry = registry_restore_matches(&snapshot, &current);
            let loopback = live_loopback_label(live_loopback);
            if live_loopback == Some(true) {
                // Provably still on a Tono DNS target: refused before the degraded exit is even
                // considered. No failure streak may release protection while the machine would
                // be left resolving through a core that is about to stop answering — that is
                // the ordering invariant the disarm gate exists to hold.
                bail!(
                    "DNS restore could not be proven: adapters on this machine still resolve \
                     through Tono's protected DNS target (registry_match={registry}, \
                     still_on_loopback={loopback}, \
                     consecutive_live_apply_failures={streak}), so protection stays armed rather \
                     than leaving DNS pointed at a resolver that is about to stop answering. \
                     Try Disconnect again; if it keeps failing, right-click the Start-Menu entry \
                     \"Tono — 恢复网络 (Restore Network)\" and choose \"Run as administrator\", \
                     or run `tono-service.exe --emergency-disarm` from an elevated prompt — \
                     either one releases the block and puts the saved DNS servers back."
                );
            }
            if !accepts_degraded_restore(streak, registry) {
                bail!(
                    "DNS restore could not be proven (registry_match={registry}, \
                     still_on_loopback={loopback}, \
                     consecutive_live_apply_failures={streak}); protection remains armed. Try \
                     Disconnect again; if it keeps failing, right-click the Start-Menu entry \
                     \"Tono — 恢复网络 (Restore Network)\" and choose \"Run as administrator\", \
                     or run `tono-service.exe --emergency-disarm` from an elevated prompt — \
                     either one releases the block and puts the saved DNS servers back."
                );
            }
            // The live mechanism is structurally unavailable on this machine, but the
            // registry — what the DNS Client reads for the next lookup — holds exactly the
            // saved values. Accept, and start the streak again so the next session must
            // earn this exit on its own.
            CONSECUTIVE_LIVE_FAILURES.store(0, Ordering::Relaxed);
            return Ok(Some(format!(
                "{DNS_RESTORE_DEGRADED_PREFIX}: the original DNS servers were restored in \
                 the registry and verified by read-back, but the live apply failed {streak} \
                 rounds in a row and the live DNS state could not be confirmed \
                 (still_on_loopback={loopback}). Disconnect was allowed rather than leaving \
                 the machine locked in Protected Offline. If name resolution misbehaves, \
                 disable and re-enable the network adapter (or reboot); PowerShell/WMI on this \
                 machine appears to be restricted."
            )));
        }
        Ok(None)
    }
    .await;
    let degraded = record_outcome(outcome)?;
    match tokio::fs::remove_file(snapshot_path()).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    if let Some(note) = degraded {
        // `record_outcome` cleared `last_error` on the way through: a degraded acceptance is a
        // success for the caller, but it must never be silent — put it back so it reaches the
        // status payload (`status_unlocked` reads `DNS_LAST_ERROR`) and the service log.
        tracing::error!("dns: {note}");
        *DNS_LAST_ERROR
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(note);
    }
    // The restore is proven (or degraded-accepted on registry evidence): put Encrypted DNS
    // back, drop our NRPT rule, then flush. NRPT left pointing at a stopped core is as
    // dead as adapter DNS left on 198.18.0.2; a failure here is logged and retried next
    // disconnect rather than undeleting the adapter snapshot.
    if let Err(error) = engine_restore_encrypted_dns().await {
        tracing::error!("dns: encrypted DNS restore after adapter restore failed: {error:#}");
    }
    if let Err(error) = engine_flush_cache().await {
        tracing::warn!("DNS cache flush after restore failed: {error:#}");
    }
    status_unlocked().await
}

/// The adapters rung 2 is allowed to reset to automatic (DHCP).
///
/// Only ever adapters Tono redirected. Resetting an adapter we never touched would destroy a
/// static DNS configuration the user chose, which is exactly the kind of collateral damage the
/// uninstall trade does *not* license.
///
/// * With a readable snapshot: its adapters, minus any whose *originals were themselves a
///   loopback resolver* (a machine that already ran Acrylic / dnscrypt-proxy / a local Pi-hole).
///   For those, loopback is the correct end state, so DHCP would be the wrong answer and their
///   loopback reading is not evidence of our redirect.
/// * Without a readable snapshot: the adapters that provably read as a loopback resolver right
///   now. We cannot say what they were, but we can say they are pointed at a core that is about
///   to stop existing.
async fn uninstall_reset_targets() -> Result<Vec<String>> {
    let snapshot = match tokio::fs::read(snapshot_path()).await {
        Ok(bytes) => parse_snapshot(&bytes).ok(),
        Err(_) => None,
    };
    if let Some(snapshot) = snapshot {
        return Ok(snapshot
            .adapters
            .iter()
            .filter(|saved| !saved_dns_was_loopback(saved))
            .map(|saved| saved.interface_guid.clone())
            .collect());
    }
    // The live read must use the predicate that recognises *Tono-owned* resolvers, not the
    // narrower "legacy loopback" one used for saved originals. `saved_dns_was_loopback` answers
    // "was this adapter's original configuration already a local resolver, so DHCP would be the
    // wrong answer for it" — a question about the past, deliberately blind to `198.18.0.2`.
    // Asked of a live read it selected nothing on every machine a current build had protected.
    Ok(collect_dns_adapters()
        .await?
        .iter()
        .filter(|adapter| adapter_reads_as_tono_dns(adapter))
        .map(|adapter| adapter.interface_guid.clone())
        .collect())
}

/// The uninstall-only escalation ladder (see the block comment above [`uninstall_restore_rung`]).
///
/// Rung 1 is [`restore_protected`], unchanged and unrelaxed. If it cannot prove itself, rung 2
/// writes automatic (DHCP) DNS for both families over the adapters Tono redirected and verifies
/// the machine is off the loopback core; rung 3 is the `Err` (still on protected DNS). Rung 3 is
/// reported to the detail log so the user can flip DNS in Windows Settings, but it no longer
/// blocks uninstall/reinstall: WFP is already gone by the time the uninstaller classifies it.
///
/// This function is never on the Disconnect / release / quit path. `restore_protected`,
/// `ensure_restored` and `windows_kill_switch::disarm_unlocked` keep the strict proof: while the
/// product stays installed, a refusal costs a retry, and the App can still open the block.
pub(crate) async fn restore_for_uninstall() -> Result<UninstallDnsRestore> {
    if !SUPPORTED {
        return Ok(UninstallDnsRestore::Exact);
    }

    // Rung 1. Also the path that clears `PROTECTION_WANTED`, deletes the snapshot on success and
    // handles the unreadable-snapshot recovery, so nothing below has to repeat any of it.
    let exact_error = match restore_protected().await {
        Ok(_) => return Ok(UninstallDnsRestore::Exact),
        Err(error) => error,
    };
    tracing::error!(
        "dns: the exact restore could not be proven while uninstalling ({exact_error:#}); \
         escalating to automatic (DHCP) DNS rather than leaving an application that cannot be \
         removed"
    );

    // Rung 2. `restore_protected` has released the operation lock by now; take it for the reset
    // so the watchdog and any concurrent caller stay serialized behind the same single writer.
    let _operation = DNS_OPERATION.lock().await;
    // An engine that cannot even enumerate must not produce a *vacuous* success below: an empty
    // target list would otherwise report "every targeted adapter was reset" while nothing was
    // looked at. "The snapshot says we redirected nothing" and "we could not find out" are
    // different answers, and only the first one is evidence.
    let (targets_listed, targets) = match uninstall_reset_targets().await {
        Ok(targets) => (true, targets),
        Err(error) => {
            tracing::error!("dns: the adapters to reset to DHCP could not be listed: {error:#}");
            (false, Vec::new())
        }
    };
    // An adapter record whose four values are all `None` *is* "automatic (DHCP)" — the engine
    // deletes the registry values and drives the live apply with CIM `$null` (IPv4) and
    // `netsh … source=dhcp` (IPv6). No new engine mechanism is introduced for the fallback: it
    // is the ordinary restore path applied to a deliberately empty original.
    let automatic = DnsSnapshot {
        version: SNAPSHOT_VERSION,
        taken_at: now_unix(),
        adapters: targets
            .iter()
            .map(|guid| AdapterDnsSnapshot {
                interface_guid: guid.clone(),
                ..Default::default()
            })
            .collect(),
    };
    let automatic_apply_ok = targets_listed
        && match engine_apply_snapshot(&automatic).await {
            Ok(results) => results.iter().all(|(_, ok)| *ok),
            Err(error) => {
                tracing::error!(
                    "dns: the automatic (DHCP) fallback could not be applied: {error:#}"
                );
                false
            }
        };
    // Ask only about the adapters we redirected. "Is *anything* on loopback?" would refuse for
    // ever on a machine running its own local resolver on an adapter we never touched.
    //
    // Except when we redirected nothing, where that scoping stops being a safeguard and becomes
    // the hole: `any_loopback` over an empty list answers `false` without reading a single
    // adapter, so a selection that wrongly came back empty proved itself. Fall back to the one
    // value that cannot belong to anybody else — the TUN endpoint — across every live adapter.
    // The broader predicate cannot be used here: a machine running its own Pi-hole reads as
    // `127.0.0.1` on an adapter Tono never touched, and would refuse uninstall for ever.
    let live_loopback = if automatic.adapters.is_empty() {
        match collect_dns_adapters().await {
            Ok(adapters) => Some(adapters.iter().any(adapter_contains_current_protected_dns)),
            Err(error) => {
                tracing::warn!(
                    "dns: nothing was selected for the automatic (DHCP) fallback and the live \
                     DNS state could not be read to confirm that is correct: {error:#}"
                );
                None
            }
        }
    } else {
        match engine_any_loopback(&automatic.adapters).await {
            Ok(any_loopback) => Some(any_loopback),
            Err(error) => {
                tracing::warn!(
                    "dns: the live DNS state could not be read after the automatic (DHCP) \
                     fallback: {error:#}"
                );
                None
            }
        }
    };

    match uninstall_restore_rung(false, automatic_apply_ok, live_loopback) {
        // Not reachable with `exact_proven = false`; treated as rung 1 rather than panicking,
        // because an uninstaller is the last place to turn a logic slip into a crash.
        UninstallRung::Exact => Ok(UninstallDnsRestore::Exact),
        UninstallRung::Automatic => {
            let note = format!(
                "{DNS_RESTORED_AUTOMATIC_PREFIX}: the saved DNS servers could not be proven \
                 restored ({exact_error:#}), so {} adapter(s) were set back to automatic (DHCP) \
                 for both IPv4 and IPv6 and verified off Tono's protected DNS target \
                 (dhcp_apply_ok={automatic_apply_ok}, still_on_loopback={}). The machine gets \
                 its DNS from the network again; this is not the exact previous configuration, \
                 which is the accepted trade at uninstall time.",
                automatic.adapters.len(),
                live_loopback_label(live_loopback),
            );
            tracing::error!("dns: {note}");
            *DNS_LAST_ERROR
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(note);
            // The redirect is gone, so the snapshot no longer describes anything in force — but
            // it is the only record of the user's original servers, so it is retained under a
            // new name instead of deleted. Retaining it under the *live* name would make a
            // second uninstall run replay this whole ladder for nothing.
            if let Err(error) = quarantine_snapshot(
                "superseded",
                "the saved DNS servers could not be proven restored, so the adapters were reset \
                 to automatic (DHCP) during uninstall",
            )
            .await
            {
                tracing::warn!("dns: the superseded snapshot could not be set aside: {error:#}");
            }
            if let Err(error) = engine_restore_encrypted_dns().await {
                tracing::warn!("dns: encrypted DNS restore after the DHCP fallback failed: {error:#}");
            }
            if let Err(error) = engine_flush_cache().await {
                tracing::warn!("DNS cache flush after the DHCP fallback failed: {error:#}");
            }
            Ok(UninstallDnsRestore::Automatic { adapters: targets })
        }
        UninstallRung::StillOnLoopback => {
            // The last rung, and the only one that still refuses. Everything the user needs to
            // get out of it is in the message: the barrier is already gone, so they are online,
            // and one change in Windows' own network settings makes the next run take rung 2.
            bail!(
                "{DNS_UNINSTALL_STILL_ON_LOOPBACK_PREFIX}: this machine could not be taken off \
                 Tono's protected DNS target. The exact restore failed ({exact_error:#}) and \
                 the automatic (DHCP) fallback did not verify either \
                 (dhcp_apply_ok={automatic_apply_ok}, still_on_loopback={}). The network barrier \
                 has already been removed, so the machine is no longer blocked — only name \
                 resolution is still pointed at Tono. Fix it in Windows: Settings → Network & \
                 Internet → your adapter → DNS server assignment → Edit → Automatic (DHCP), for \
                 both IPv4 and IPv6; a reboot also clears a wedged DNS Client service. Then run \
                 the uninstaller again and it will complete.",
                live_loopback_label(live_loopback),
            )
        }
    }
}

/// The disarm gate: succeed when no protection is active, or after a proven restore. An
/// error here must keep the kill switch armed (see the invariant at the top of this file).
pub(crate) async fn ensure_restored() -> Result<()> {
    if !SUPPORTED {
        return Ok(());
    }
    // `restore_protected` owns the operation lock and now proves the snapshot-less case too.
    // A metadata fast path here used to let a deleted file open the disarm gate even while an
    // adapter still pointed at 198.18.0.2.
    restore_protected().await.map(|_| ())
}

pub(crate) async fn status() -> DnsProtectionStatus {
    // Status is the recovery/diagnosis path: do not turn a past panic into permanent silence.
    DNS_STATUS_CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

fn publish_status(status: &DnsProtectionStatus) {
    *DNS_STATUS_CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = status.clone();
}

fn publish_status_error(error: &anyhow::Error) {
    let mut status = DNS_STATUS_CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    status.last_error = Some(format!("{error:#}"));
}

/// Populate the fast snapshot before IPC is opened. A corrupt recovery file is represented as a
/// status error rather than preventing the Service from starting; WFP remains independently
/// fail-closed and the GUI can still offer diagnostics/emergency recovery.
pub async fn initialize_status_cache() {
    let _operation = DNS_OPERATION.lock().await;
    match status_unlocked().await {
        Ok(status) => {
            // A snapshot on disk is *not* on its own evidence that protection is wanted.
            //
            // Every restore that cannot prove itself deliberately keeps the file — it is the only
            // record of the user's original resolvers — so a machine that was emergency-disarmed
            // still has one after the barrier is provably gone. Reading presence alone as intent
            // meant the next service start armed DNS reconciliation on it: the watchdog found the
            // adapters no longer on the protected resolver, called that drift, and wrote
            // 198.18.0.2 back onto every adapter with no core listening and no WFP armed. The
            // machine then looks online and resolves nothing, every two seconds, with no way out
            // inside the product — and the recovery CLI had just told the user to reboot, which is
            // what triggers it.
            //
            // Cross-check it against the barrier's own restored intent. Both start paths restore
            // the kill switch before this runs, so `wanted` is settled by now, and reading it is a
            // clone of an in-memory value: no IO, no queue, nothing that can deadlock under
            // `DNS_OPERATION`.
            let barrier_wanted = crate::core::windows_kill_switch::status().await.wanted;
            let protection_wanted = status.snapshot_present && barrier_wanted;
            if status.snapshot_present && !barrier_wanted {
                tracing::warn!(
                    "dns: a protected-DNS snapshot survived a disarm; leaving reconciliation off \
                     rather than re-pointing adapters at a resolver with no barrier behind it"
                );
            }
            PROTECTION_WANTED.store(protection_wanted, Ordering::Release);
            publish_status(&status);
        }
        Err(error) => publish_status_error(&error),
    }
}

/// Keep the cached snapshot fresh and repair a new/drifted adapter while protection is active.
/// The expensive live read runs here, never in a request handler. `enable` preserves the original
/// snapshot and only reapplies loopback after this probe finds drift.
///
/// This loop is a *writer* of machine state, so it is fenced three ways:
/// * it observes and repairs inside **one** `DNS_OPERATION` acquisition, so no other operation
///   can change the state between the decision and the action;
/// * it calls `enable_unlocked(EnableTrigger::Reconcile)`, which refuses to perform an initial
///   enable — repair can only ever re-apply a snapshot that already exists;
/// * it acts only while `PROTECTION_WANTED` holds, so a snapshot that outlived a disarm (an
///   emergency disarm proceeds on an unproven restore and keeps the file) can never be turned
///   back into a loopback redirect.
///
/// With no snapshot on disk the status read makes no engine calls at all, so a released
/// protection leaves the loop idle rather than busy.
pub fn spawn_status_watchdog() {
    if !SUPPORTED {
        return;
    }
    tokio::spawn(async {
        let mut failures: u32 = 0;
        // When the next repair may run. Backoff is expressed as a deadline rather than a sleep
        // so that no delay is ever awaited while holding `DNS_OPERATION`.
        let mut next_attempt = std::time::Instant::now();
        loop {
            tokio::time::sleep(DNS_WATCHDOG_INTERVAL).await;
            // One acquisition covers the observation *and* the repair. Reading the state, then
            // dropping the lock, then acting on what was read is how a concurrent release used
            // to turn a repair into an initial enable: the snapshot could be deleted in between,
            // and the repair would then capture the freshly restored resolvers as "originals"
            // and point the machine at a loopback core that is no longer running. This mirrors
            // the WFP watchdog, which reads `armed_guard()` while holding `WFP_OPERATION`.
            let _operation = DNS_OPERATION.lock().await;
            let status = match status_unlocked().await {
                Ok(status) => status,
                Err(error) => {
                    publish_status_error(&error);
                    continue;
                }
            };
            publish_status(&status);
            // `PROTECTION_WANTED` is the intent gate: a snapshot that outlived a disarm is
            // evidence to keep, not a reason to re-apply loopback. The recorded per-adapter
            // failures are the second trigger: since `enable` stopped failing on an unverifiable
            // apply, they are the only thing that tells this loop there is still work to do on a
            // machine whose registry read-back looks healthy.
            let repair = needs_reconcile(
                PROTECTION_WANTED.load(Ordering::Acquire),
                status.snapshot_present,
                status.enabled,
                status_is_unverified(&status),
            );
            if !repair {
                if failures > 0 {
                    // Nothing left to repair — protection is healthy again, was released, or is
                    // no longer wanted. The failure streak is spent: re-arm for the next drift.
                    tracing::info!(
                        "dns: nothing left to reconcile; automatic reconciliation re-armed"
                    );
                    failures = 0;
                    next_attempt = std::time::Instant::now();
                }
                continue;
            }
            if reconcile_backoff(failures).is_none() {
                continue; // suspended at the cap; the log line was written when it tripped
            }
            if std::time::Instant::now() < next_attempt {
                continue;
            }
            // A repair that *ran* but still could not verify every adapter is not a success for
            // this loop's purposes. `enable` no longer reports that as an error, so without
            // folding it in here the backoff and the cap would never engage on the machine they
            // exist for — one permanently unconfigurable adapter would spawn a PowerShell batch
            // every two seconds for ever.
            let incomplete = match enable_unlocked(EnableTrigger::Reconcile).await {
                Ok(status) if status_is_unverified(&status) => Some(
                    status
                        .last_error
                        .unwrap_or_else(|| "unverified adapters remain".to_owned()),
                ),
                Ok(_) => None,
                Err(error) => {
                    publish_status_error(&error);
                    Some(format!("{error:#}"))
                }
            };
            match incomplete {
                None => {
                    failures = 0;
                    next_attempt = std::time::Instant::now();
                }
                Some(reason) => {
                    failures += 1;
                    next_attempt = std::time::Instant::now()
                        + reconcile_backoff(failures).unwrap_or(DNS_RECONCILE_MAX_BACKOFF);
                    tracing::warn!(
                        "protected DNS reconciliation did not complete (attempt {failures}): \
                         {reason}"
                    );
                    if failures >= DNS_RECONCILE_MAX_FAILURES {
                        tracing::error!(
                            "dns: automatic reconciliation is suspended after {failures} \
                             consecutive failures; protection stays in its current state \
                             (snapshot kept, kill switch armed) and an explicit connect still \
                             retries it"
                        );
                    }
                }
            }
        }
    });
}

async fn status_unlocked() -> Result<DnsProtectionStatus> {
    let snapshot = match tokio::fs::read(snapshot_path()).await {
        // Status only reports; the recovery itself belongs to `enable`/`restore_protected`,
        // which hold the operation lock and may change the machine. Reporting the reason (with
        // the marker) keeps the App able to explain the state.
        Ok(bytes) => Some(parse_snapshot(&bytes).map_err(|reason| {
            anyhow::anyhow!("{DNS_SNAPSHOT_UNREADABLE_PREFIX}: protected-dns.json ({reason})")
        })?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let enabled = match snapshot.as_ref() {
        Some(_snapshot) if ENGINE_LIVE => {
            // Include adapters that appeared since the last enable. Checking only saved GUIDs can
            // report a false healthy state while a fresh adapter still uses an external resolver.
            let current = collect_dns_adapters().await?;
            engine_all_loopback(&current).await?
        }
        Some(snapshot) => engine_all_loopback(&snapshot.adapters).await?,
        None => false,
    };
    let status = DnsProtectionStatus {
        enabled,
        snapshot_present: snapshot.is_some(),
        adapters: snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.adapters.len() as u32),
        last_error: DNS_LAST_ERROR.lock().unwrap().clone(),
    };
    publish_status(&status);
    Ok(status)
}

/// Only an operational adapter with a **bound IP stack** has a live resolver that can leak DNS.
/// Registry interface keys outlive disabled and removed adapters, while the software loopback
/// has no configurable DNS instance; including either class makes one irrelevant apply failure
/// abort protection for every real adapter.
///
/// Link state alone is not that test: a Hyper-V internal vSwitch, `vEthernet (WSL)` before
/// configuration, a Bluetooth PAN, a TAP adapter with no bound IP stack, or our own WinTUN
/// adapter mid-initialisation are all `OperStatus == Up` with nothing to configure. They used
/// to land in the failure list on every round, which persisted a `live_apply_failed` flag,
/// pinned `needs_loopback_replay` on forever, and made both the watchdog's repair loop and the
/// restore proof permanently unsatisfiable. `has_bound_ip` is the IP-Helper equivalent of
/// `IPEnabled`: at least one unicast address *and* a non-zero interface index in at least one
/// family. Adapters that fail it are non-participants — they have no resolver to protect — not
/// failures.
#[cfg(any(all(windows, not(feature = "test")), test))]
fn is_active_dns_adapter(oper_status: i32, if_type: u32, has_bound_ip: bool) -> bool {
    const IF_OPER_STATUS_UP: i32 = 1;
    const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
    oper_status == IF_OPER_STATUS_UP && if_type != IF_TYPE_SOFTWARE_LOOPBACK && has_bound_ip
}

// --- Windows engine: registry snapshot/set + best-effort CIM live-apply ---

#[cfg(all(windows, not(feature = "test")))]
mod engine;



#[cfg(test)]
mod tests;
