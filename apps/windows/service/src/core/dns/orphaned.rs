use super::*;

/// A missing snapshot plus the current TUN DNS endpoint is an orphaned protected state, never a
/// clean initial state. We cannot reconstruct the user's static/DHCP choice, so fail closed and
/// tell the operator to restore it instead of recording our own endpoint as the way back.
pub(super) fn ensure_snapshotless_adapters_are_safe(adapters: &[AdapterDnsSnapshot]) -> Result<()> {
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

/// The merge-time face of the same rule: a snapshot may exist and still meet an adapter whose
/// original has never been recorded — one that appeared (or reappeared) while its registry key
/// already carried a leftover protected endpoint, exactly the state a corrupt-snapshot recovery
/// misses when the adapter is inactive while it runs. Recording that endpoint as the "original"
/// would make every later disconnect write it back and be refused for proving against it, so
/// the adapter is refused (or healed first) instead. Saved originals are not at stake here.
pub(super) fn ensure_unrecorded_adapters_are_safe(adapters: &[AdapterDnsSnapshot]) -> Result<()> {
    if adapters.iter().any(adapter_contains_current_protected_dns) {
        bail!(
            "{DNS_ORPHANED_ADAPTER_PREFIX}: a newly seen adapter still contains Tono's protected \
             DNS target ({PROTECTED_DNS_V4}), so enable refuses to append it to protected-dns.json \
             with that target recorded as its original DNS. In Windows set the affected adapter's \
             DNS server assignment back to Automatic (DHCP) — or to the servers you use — and \
             retry; the saved originals of the already recorded adapters are kept."
        );
    }
    Ok(())
}

/// The adapters `fresh` would contribute anew this round: those not already recorded in
/// `existing`. GUID comparison is case-insensitive like everywhere else that matches adapter
/// identity; an exact match here used to append a duplicate record that carried the live
/// protected values as an "original".
pub(super) fn unrecorded_adapters(
    existing: Option<&DnsSnapshot>,
    fresh: &[AdapterDnsSnapshot],
) -> Vec<AdapterDnsSnapshot> {
    fresh
        .iter()
        .filter(|adapter| {
            existing.is_none_or(|snapshot| {
                !snapshot
                    .adapters
                    .iter()
                    .any(|saved| same_adapter_guid(&saved.interface_guid, &adapter.interface_guid))
            })
        })
        .cloned()
        .collect()
}

/// What an orphan heal may touch beyond the adapters it is handed.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum OrphanHealScope {
    /// No snapshot, so no protected session is in force: the machine-wide encrypted-DNS policy
    /// a failed connect left behind (the Tono NRPT catch-all, suppressed DoH) is a leftover too
    /// and is restored with the adapters.
    NoSession,
    /// A snapshot is in force, so that policy is live protection, not a leftover. Only the
    /// handed adapters are reset; NRPT and DoH are never touched, whatever the heal's outcome,
    /// so a heal that cannot be proven leaves the session exactly as armed as it found it.
    InSession,
}

/// After a failed connect, release can leave adapters on `198.18.0.2` while deleting
/// `protected-dns.json`. The next Connect then hits [`ensure_snapshotless_adapters_are_safe`] and
/// hard-fails. Heal by resetting those adapters to automatic (DHCP) — we have no better original
/// to restore — then re-collect so enable can take a clean snapshot. The same heal serves a
/// snapshot-present enable whose fresh (unrecorded) adapter carries a leftover endpoint, with
/// [`OrphanHealScope::InSession`]: adapter writes only ever reach adapters from the slice it is
/// handed, and only the no-session scope restores machine-wide resolver policy.
pub(super) async fn heal_orphaned_protected_dns_without_snapshot(
    adapters: &[AdapterDnsSnapshot],
    scope: OrphanHealScope,
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
        "dns: {} adapter(s) with no recorded original still list {PROTECTED_DNS_V4}; \
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
    if scope == OrphanHealScope::NoSession {
        if let Err(error) = engine_restore_encrypted_dns().await {
            tracing::warn!("dns: encrypted DNS restore after orphaned-DNS heal failed: {error:#}");
        }
    }
    if let Err(error) = engine_flush_cache().await {
        tracing::warn!("dns: cache flush after orphaned-DNS heal failed: {error:#}");
    }
    collect_dns_adapters().await
}

pub(super) async fn ensure_snapshotless_dns_is_safe() -> Result<()> {
    let current = collect_dns_adapters().await?;
    if ensure_snapshotless_adapters_are_safe(&current).is_ok() {
        return Ok(());
    }
    let healed =
        heal_orphaned_protected_dns_without_snapshot(&current, OrphanHealScope::NoSession).await?;
    ensure_snapshotless_adapters_are_safe(&healed)
}
