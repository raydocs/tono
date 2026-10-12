use super::*;

pub(super) fn same_adapter_guid(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// Registry-only comparison of one adapter: the four saved values against the read-back
/// (deliberately excluding the `live_apply_failed` bookkeeping flag).
pub(super) fn registry_values_match(saved: &AdapterDnsSnapshot, current: &AdapterDnsSnapshot) -> bool {
    same_adapter_guid(&saved.interface_guid, &current.interface_guid)
        && saved.ipv4_name_server == current.ipv4_name_server
        && saved.ipv4_profile_name_server == current.ipv4_profile_name_server
        && saved.ipv6_name_server == current.ipv6_name_server
        && saved.ipv6_profile_name_server == current.ipv6_profile_name_server
}

/// Whether the registry alone looks restored: the *degraded* leg of the proof, accepted only
/// under the rules in [`accepts_degraded_restore`].
pub(super) fn registry_restore_matches(snapshot: &DnsSnapshot, current: &[AdapterDnsSnapshot]) -> bool {
    snapshot.adapters.iter().all(|saved| {
        current
            .iter()
            .find(|adapter| same_adapter_guid(&adapter.interface_guid, &saved.interface_guid))
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
pub(super) fn restore_is_proven(
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
            .find(|adapter| same_adapter_guid(&adapter.interface_guid, &saved.interface_guid))
            .is_none_or(|adapter| registry_values_match(saved, adapter))
    })
}

/// Whether the values saved for this adapter were *themselves* a loopback resolver.
pub(super) fn saved_dns_was_loopback(saved: &AdapterDnsSnapshot) -> bool {
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
pub(super) fn adapters_owing_live_proof(
    snapshot: &DnsSnapshot,
    current: &[AdapterDnsSnapshot],
) -> Vec<AdapterDnsSnapshot> {
    current
        .iter()
        .filter(|adapter| {
            !snapshot.adapters.iter().any(|saved| {
                same_adapter_guid(&saved.interface_guid, &adapter.interface_guid)
                    && saved_dns_was_loopback(saved)
            })
        })
        .cloned()
        .collect()
}

/// How the live loopback evidence reads in an operator-facing message. `unknown` is its own
/// state on purpose: "we could not look" must never be reported as "nothing was found".
pub(super) fn live_loopback_label(live_loopback: Option<bool>) -> &'static str {
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
pub(super) const DEGRADED_RESTORE_STREAK: u32 = 3;

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
pub(super) fn accepts_degraded_restore(consecutive_live_failures: u32, registry_matches: bool) -> bool {
    registry_matches && consecutive_live_failures >= DEGRADED_RESTORE_STREAK
}
