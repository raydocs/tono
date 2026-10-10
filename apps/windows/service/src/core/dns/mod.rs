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
//! and native effective read-back or the PowerShell/CIM/netsh compatibility path can fail
//! independently of whether DNS works: pseudo-adapters, constrained language mode, EDR hooks,
//! a damaged WMI repository. Gating `enable` on that weak proof killed connects
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
//! record of the round could not be persisted). Such an error can follow partial mutation:
//! original values AND the unfinished per-adapter obligation are persisted before applying.
//! Only effective verification retires that obligation; an absent adapter keeps it until
//! reappearance, but does not drive repair while absent.
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
//! **The live apply is per address family.** Protected apply prefers the dynamically resolved
//! `SetInterfaceDnsSettings` and confirms both families with `GetAdaptersAddresses`. Native
//! success without effective read-back (including zero IPv6 resolvers) is not a proven apply.
//! Missing API, completed failure or contradictory read-back gets one bounded compatibility
//! batch, still inside the same single-writer claim. Compatibility and restore use CIM
//! (`SetDNSServerSearchOrder`, an IPv4-only method) and `netsh interface ipv6 set dnsservers`.
//! Restore/DHCP never uses the native empty string: the exact saved snapshot remains authority.
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
//! the user's original DNS (`DNS_SNAPSHOT_MISSING_PREFIX`). The two Encrypted-DNS sidecars get
//! the same discipline: they are written atomically like the snapshot, and an unreadable
//! capture is quarantined while the in-place values stand as the restore result — surfaced
//! through `DNS_CAPTURE_QUARANTINED_PREFIX`, never as a permanent refusal of Disconnect and
//! never as positive evidence that the user's encrypted-DNS choice was restored.
//!
//! The pure snapshot/merge/restore-decision logic in this file is platform-independent and
//! unit-tested on any host; the native/registry/CIM/netsh engine is compiled only on Windows.

use crate::core::structure::DnsProtectionStatus;
use anyhow::{Context as _, Result, bail};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

mod enable;
mod enable_decisions;
mod engine_ops;
mod markers;
mod name_servers;
mod orphaned;
mod recovery;
mod resolver_policy;
mod restore;
mod restore_proof;
mod self_write;
mod snapshot;
mod status_cache;
mod uninstall;

pub(crate) use enable::*;
use enable_decisions::*;
use engine_ops::*;
pub(crate) use markers::*;
use name_servers::*;
use orphaned::*;
use recovery::*;
pub use resolver_policy::*;
pub(crate) use restore::*;
use restore_proof::*;
pub(crate) use self_write::*;
pub(crate) use snapshot::*;
pub use status_cache::*;
pub(crate) use uninstall::*;

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
pub(crate) const TUN_ADAPTER_NAME: &str = "Tono";

static DNS_OPERATION: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

static DNS_LAST_ERROR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

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

/// Test-only control over the engine answers that are unobservable off Windows.
#[cfg(any(not(all(windows, not(feature = "test"))), test))]
pub(crate) mod test_hooks {
    use super::AdapterDnsSnapshot;
    use std::sync::{
        Condvar, LazyLock, Mutex,
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

    static ENCRYPTED_RESTORE_FAILS: AtomicBool = AtomicBool::new(false);

    pub(crate) fn encrypted_restore_fails() -> bool {
        ENCRYPTED_RESTORE_FAILS.load(Ordering::Relaxed)
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_encrypted_restore_fails(fails: bool) {
        ENCRYPTED_RESTORE_FAILS.store(fails, Ordering::Relaxed);
    }

    static NRPT_SWEEP_HANGS: AtomicBool = AtomicBool::new(false);

    /// While set, the stubbed NRPT removal does not return: a registry call behind a filter
    /// driver or a wedged Dnscache.
    pub(crate) fn nrpt_sweep_hangs() -> bool {
        NRPT_SWEEP_HANGS.load(Ordering::Relaxed)
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_nrpt_sweep_hangs(hangs: bool) {
        NRPT_SWEEP_HANGS.store(hangs, Ordering::Relaxed);
    }

    static SNAPSHOT_DELETE_FAILS: AtomicBool = AtomicBool::new(false);

    /// While set, the snapshot delete after a proven restore fails every round: an antivirus
    /// or backup handle on the file that outlives the retry budget.
    #[cfg(any(not(windows), feature = "test"))]
    pub(crate) fn snapshot_delete_fails() -> bool {
        SNAPSHOT_DELETE_FAILS.load(Ordering::Relaxed)
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_snapshot_delete_fails(fails: bool) {
        SNAPSHOT_DELETE_FAILS.store(fails, Ordering::Relaxed);
    }

    static SNAPSHOT_DELETE_PAUSED: Mutex<bool> = Mutex::new(false);
    static SNAPSHOT_DELETE_RESUMED: Condvar = Condvar::new();
    static SNAPSHOT_DELETE_REACHED_PAUSE: AtomicBool = AtomicBool::new(false);
    static SNAPSHOT_SETTLE_WAITED: AtomicBool = AtomicBool::new(false);
    static SNAPSHOT_DELETE_RETURNED: AtomicBool = AtomicBool::new(false);

    /// While paused, the snapshot delete stops on its blocking thread before the file is
    /// touched, until the test resumes it: an unlink stalled behind a filter driver.
    #[cfg(any(not(windows), feature = "test"))]
    pub(crate) fn pause_snapshot_delete() {
        let mut paused = SNAPSHOT_DELETE_PAUSED
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if *paused {
            SNAPSHOT_DELETE_REACHED_PAUSE.store(true, Ordering::Release);
        }
        while *paused {
            paused = SNAPSHOT_DELETE_RESUMED
                .wait(paused)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
    }

    /// Arming or resuming the pause also clears what the last run observed.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn set_snapshot_delete_paused(paused: bool) {
        SNAPSHOT_DELETE_REACHED_PAUSE.store(false, Ordering::Release);
        SNAPSHOT_SETTLE_WAITED.store(false, Ordering::Release);
        SNAPSHOT_DELETE_RETURNED.store(false, Ordering::Release);
        *SNAPSHOT_DELETE_PAUSED
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = paused;
        SNAPSHOT_DELETE_RESUMED.notify_all();
    }

    /// Whether a delete has stopped at the pause since it was armed.
    #[cfg(test)]
    pub(crate) fn snapshot_delete_reached_pause() -> bool {
        SNAPSHOT_DELETE_REACHED_PAUSE.load(Ordering::Acquire)
    }

    /// Record a DNS operation that found a snapshot delete still in flight and waits for it.
    #[cfg(test)]
    pub(crate) fn note_snapshot_settle(delete: &tokio::sync::Mutex<()>) {
        if delete.try_lock().is_err() {
            SNAPSHOT_SETTLE_WAITED.store(true, Ordering::Release);
        }
    }

    /// Whether a DNS operation has waited for an in-flight delete since the pause was armed.
    #[cfg(test)]
    pub(crate) fn snapshot_settle_waited() -> bool {
        SNAPSHOT_SETTLE_WAITED.load(Ordering::Acquire)
    }

    /// Record that a snapshot delete's unlink has returned, independently of the guard it holds.
    #[cfg(test)]
    pub(crate) fn note_snapshot_delete_returned() {
        SNAPSHOT_DELETE_RETURNED.store(true, Ordering::Release);
    }

    /// Whether a snapshot delete's unlink has returned since the pause was armed or resumed.
    #[cfg(test)]
    pub(crate) fn snapshot_delete_returned() -> bool {
        SNAPSHOT_DELETE_RETURNED.load(Ordering::Acquire)
    }

    #[cfg(test)]
    static AUTOMATIC_RESETS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    #[cfg(test)]
    pub(crate) fn note_automatic_reset() {
        AUTOMATIC_RESETS.fetch_add(1, Ordering::Relaxed);
    }

    #[cfg(test)]
    pub(crate) fn take_automatic_resets() -> usize {
        AUTOMATIC_RESETS.swap(0, Ordering::Relaxed)
    }

    /// Machine-wide resolver-policy restores (NRPT removal, DoH re-enable) the stub was asked
    /// for, so a test can prove a path left that policy armed rather than merely logged it.
    #[cfg(test)]
    static ENCRYPTED_RESTORES: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);

    #[cfg(test)]
    pub(crate) fn note_encrypted_restore() {
        ENCRYPTED_RESTORES.fetch_add(1, Ordering::Relaxed);
    }

    #[cfg(test)]
    pub(crate) fn take_encrypted_restores() -> usize {
        ENCRYPTED_RESTORES.swap(0, Ordering::Relaxed)
    }
}

// --- Facade ---

/// Whether the state machine runs on this build (real service on Windows; stubbed engine
/// under test builds, which is what the unit tests drive).
const SUPPORTED: bool = cfg!(any(windows, test));

static LIVE_APPLY_FAILURES: Lazy<std::sync::Mutex<std::collections::BTreeSet<String>>> =
    Lazy::new(|| std::sync::Mutex::new(std::collections::BTreeSet::new()));

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

/// Put a warning-grade note back into `DNS_LAST_ERROR` after a successful `record_outcome`
/// cleared it: a success-with-a-note (degraded restore, quarantined capture) must reach the
/// status payload — `status_unlocked` reads `DNS_LAST_ERROR` — and the service log, never
/// silently.
fn surface_success_note(note: &str) {
    tracing::error!("dns: {note}");
    *DNS_LAST_ERROR
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(note.to_owned());
}

/// A capture-loss note a committed restore surfaced after retiring its on-disk evidence. Every
/// Disconnect runs two restores — the release handler's, then the disarm gate's (snapshot-less)
/// one — and the second, finding the evidence already retired, would otherwise clear
/// `last_error` and publish a clean result over the loss. The note is handed to exactly one
/// following restore that has no loss of its own; after that it follows the other success notes
/// (degraded restore): the next successful DNS operation clears it. The next explicit `enable`
/// drops it.
static CAPTURE_LOSS_NOTE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Settle a *committed* restore's capture-loss note: remember it, then retire the on-disk
/// evidence (quarantine the unreadable capture, drop the lost-originals records). Call it only
/// after every step that can still fail the restore, so a failed or abandoned attempt keeps the
/// evidence for its retry. With no note of its own, a restore takes over the one the previous
/// restore surfaced (see [`CAPTURE_LOSS_NOTE`]). Returns the note to surface.
async fn settle_capture_loss(note: Option<String>) -> Option<String> {
    let Some(note) = note else {
        return CAPTURE_LOSS_NOTE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
    };
    // Remember first: once the evidence is retired, this is what keeps the loss visible.
    *CAPTURE_LOSS_NOTE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(note.clone());
    if let Err(error) = engine_retire_lost_captures().await {
        tracing::warn!(
            "dns: the capture-loss evidence could not be retired ({error:#}); the next restore \
             reports the loss again"
        );
    }
    Some(note)
}

/// Join the notes of one successful restore: each names a different loss (the degraded-restore
/// trade on adapter DNS, the unrecoverable Encrypted DNS setting), so neither may hide the other.
fn join_notes(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(mut first), Some(second)) => {
            first.push(' ');
            first.push_str(&second);
            Some(first)
        }
        (first, second) => first.or(second),
    }
}

/// Record per-adapter outcomes or reserve an unfinished apply before mutation. Omitted adapters
/// keep their evidence; in particular the protect engine must not report absence as success.
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

/// Transaction proof reads actual adapter state under the DNS writer lock.
/// The diagnostic cache is deliberately not proof of update recovery.
///
/// A missing snapshot is healed only when the barrier is already down. Healing
/// while it is wanted resets adapters to DHCP and, on the no-session path,
/// removes the NRPT catch-all, while WFP is still denying physical DNS.
#[cfg(windows)]
pub(crate) async fn observe_for_update() -> Result<DnsProtectionStatus> {
    let barrier_wanted = crate::core::windows_kill_switch::status().await.wanted;
    observe_for_update_with(barrier_wanted).await
}

#[cfg(any(windows, test))]
async fn observe_for_update_with(barrier_wanted: bool) -> Result<DnsProtectionStatus> {
    let _operation = DNS_OPERATION.lock().await;
    if !snapshot_path().exists() && !barrier_wanted {
        ensure_snapshotless_dns_is_safe().await?;
    }
    status_unlocked().await
}

// --- Windows engine: registry snapshot/set + native apply, legacy compatibility/restore ---

#[cfg(all(windows, not(feature = "test")))]
mod engine;



#[cfg(test)]
mod tests;
