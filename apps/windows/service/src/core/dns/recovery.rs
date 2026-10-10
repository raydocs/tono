use super::*;

/// Whether restoration can be established **without** the snapshot.
///
/// A snapshot we cannot read is not evidence that DNS is still redirected — it only means we
/// cannot say what the servers *were*. If nothing on the machine still points at the loopback
/// core, and no live-apply failure is on record, then "DNS is no longer redirected to a dead
/// resolver" is demonstrably true regardless of what the file said, which is exactly what the
/// disarm gate needs to know. Anything else stays fail-closed: the kill switch remains armed
/// and the unreadable file is kept.
pub(super) fn restore_established_without_snapshot(any_loopback: bool, live_apply_failed: bool) -> bool {
    !any_loopback && !live_apply_failed
}

/// Move `protected-dns.json` aside instead of deleting it: it may still be the only record of
/// the original resolvers, and a support case can decode by hand what this build could not.
///
/// `label` names why (`corrupt` / `superseded`) and becomes part of the retained file name.
/// Called *only* once the machine is known not to be redirected any more — after
/// [`restore_established_without_snapshot`] on the recovery path, or after the uninstall
/// ladder's rung 2 has verified the same property — so the live snapshot is never removed while
/// the machine could still be pointed at the loopback core.
pub(super) async fn quarantine_snapshot(label: &str, reason: &str) -> Result<()> {
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
/// The way out is evidence, not trust: read the machine and demand that *nothing* still
/// points at either Tono's current TUN DNS endpoint or a legacy protected loopback value (and
/// that no live-apply failure is on record). That establishes
/// the property the disarm gate actually protects — the machine is not left resolving through a
/// core that is no longer running — without knowing what the servers used to be. Only then is
/// the file quarantined.
///
/// The evidence comes from the registry's own interface list, not the active set: an adapter
/// that was unplugged, disabled or removed when the file went unreadable keeps its last DNS
/// values in `Parameters\Interfaces`, and a leftover TUN endpoint parked there would ride the
/// adapter's return straight into the next merge as a poisoned "original" — so inactive
/// leftovers must refuse this recovery exactly like active ones.
///
/// Every other outcome (still on a Tono DNS target, a recorded live failure, or an engine call that
/// times out on the way to finding out) returns an error: nothing is deleted, nothing is
/// disarmed, and the message names the two documented ways forward.
///
/// On success, `Some(note)` propagates the capture-quarantine note from
/// [`restore_resolver_policy`] so the caller can surface it; the adapter recovery itself is
/// complete either way.
pub(super) async fn recover_unreadable_snapshot(reason: &str) -> Result<Option<String>> {
    let interfaces = collect_registry_interface_adapters().await?;
    let any_loopback = registry_interfaces_read_as_tono_dns(&interfaces);
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
    // Adapter evidence alone does not prove the resolver is restored: NRPT can still
    // route every namespace to the stopped TUN resolver. Keep the file on failure.
    let capture_note = restore_resolver_policy().await?;
    quarantine_snapshot(
        "corrupt",
        &format!(
            "protected-dns.json cannot be read ({reason}); no adapter still resolves through a \
             Tono protected DNS target, so restoration holds without it and protection starts from a clean \
             snapshot"
        ),
    )
    .await?;
    Ok(capture_note)
}
