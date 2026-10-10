use super::*;

/// Idempotent enable: preserve every original already recorded, but append adapters that appeared
/// after protection started. Replacing an existing record would snapshot our loopback values and
/// destroy the way back; ignoring fresh GUIDs would leave a hot-plugged adapter unprotected.
/// GUID identity is compared case-insensitively, like [`active_snapshot_adapters`] and the engine:
/// GetAdaptersAddresses spelling is not guaranteed to repeat, and an exact match here used to
/// append a duplicate record carrying the live protected values as the "original".
pub(super) fn merge_snapshot(existing: Option<DnsSnapshot>, fresh: DnsSnapshot) -> DnsSnapshot {
    let Some(mut existing) = existing else {
        return fresh;
    };
    for adapter in fresh.adapters {
        if !existing
            .adapters
            .iter()
            .any(|saved| same_adapter_guid(&saved.interface_guid, &adapter.interface_guid))
        {
            existing.adapters.push(adapter);
        }
    }
    existing
}

/// Use the original records (including their GUID spelling), but only for adapters observed
/// active this round. Historical originals and pending bits remain in the full snapshot.
pub(super) fn active_snapshot_adapters(
    snapshot: &DnsSnapshot,
    current: &[AdapterDnsSnapshot],
) -> Vec<AdapterDnsSnapshot> {
    snapshot
        .adapters
        .iter()
        .filter(|saved| {
            current
                .iter()
                .any(|adapter| same_adapter_guid(&adapter.interface_guid, &saved.interface_guid))
        })
        .cloned()
        .collect()
}

/// Short-circuiting `enable` is only safe when a snapshot exists, the adapters are actually on
/// loopback, AND no active apply is pending (memory or snapshot). With no snapshot this is
/// the initial enable, so it must capture the originals and apply loopback. Anything else replays
/// the write — which also retries the live-apply — against the *original* snapshot.
pub(super) fn needs_loopback_replay(
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
pub(super) enum LoopbackReadBack {
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
pub(super) fn read_back_label(read_back: LoopbackReadBack) -> &'static str {
    match read_back {
        LoopbackReadBack::Verified => "verified",
        LoopbackReadBack::Contradicted => "not-protected",
        LoopbackReadBack::Unavailable => "unreadable",
        LoopbackReadBack::NotAttempted => "not-attempted",
    }
}

/// Adapter GUIDs are long; name at most this many in the note and count the rest.
pub(super) const UNVERIFIED_NAMED_ADAPTERS: usize = 4;

/// Compose the note for an `enable` round that applied protected DNS but could not prove it.
///
/// `None` means the round is clean — every adapter's live apply succeeded and the read-back
/// either confirmed the state or was never attempted (a build with no engine). Everything else
/// produces a note that is deliberately *not* an error: it rides in `DNS_LAST_ERROR` and
/// therefore in the status payload on an otherwise successful enable, so that when the connect
/// later dies in `verify_fake_ip` with "system DNS lookup exceeded 5s" the diagnostics report and
/// the service log already name the real cause. It also states why this is not a leak, because
/// the next person to read it will ask.
pub(super) fn unverified_note(failed: &[String], total: usize, read_back: LoopbackReadBack) -> Option<String> {
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
        "{DNS_PROTECTION_UNVERIFIED_PREFIX}: protected DNS ({PROTECTED_DNS_V4}) application is unfinished or unverified \
         on {} of {total} adapter(s) — pending live apply: {adapters}; read-back={}. \
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
pub(super) fn status_is_unverified(status: &DnsProtectionStatus) -> bool {
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
pub(super) fn clear_unverified_note() {
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
pub(super) fn needs_reconcile(
    protection_wanted: bool,
    snapshot_present: bool,
    enabled: bool,
    unverified: bool,
) -> bool {
    protection_wanted && snapshot_present && (!enabled || unverified)
}
