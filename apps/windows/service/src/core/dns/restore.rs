use super::*;

/// Held by a snapshot delete until its blocking call returns, even after the restore that
/// started it was dropped by its budget. `enable` and `restore_protected` wait for it under
/// `DNS_OPERATION` before they touch the snapshot, so a late delete cannot remove a newer
/// snapshot written to the same path (WIN-DNS-SNAPSHOT-LATE-DELETE).
pub(super) static SNAPSHOT_DELETE: Lazy<std::sync::Arc<tokio::sync::Mutex<()>>> =
    Lazy::new(|| std::sync::Arc::new(tokio::sync::Mutex::new(())));

/// Retries for the snapshot delete after a proven restore: an AV or backup handle on the
/// file is typically transient, and the delete is housekeeping — it must never outvote the
/// proof above it.
pub(super) const SNAPSHOT_DELETE_ATTEMPTS: usize = 3;
pub(super) const SNAPSHOT_DELETE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(100);
pub(super) const SNAPSHOT_RETIREMENT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);
/// How long `enable` and `restore_protected` wait for a snapshot delete that a dropped restore
/// left running. An unlink takes milliseconds; one stalled past this is treated as wedged, and
/// the operation fails closed instead of writing a snapshot the late delete could remove.
pub(super) const SNAPSHOT_DELETE_SETTLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// The committed restore's last housekeeping step: delete the snapshot. Test builds can
/// inject a persistent failure here (the AV/backup-handle scenario), so the retry-and-note
/// behavior in [`restore_protected`] stays exercisable off Windows.
pub(super) async fn remove_restored_snapshot() -> std::io::Result<()> {
    #[cfg(any(not(windows), feature = "test"))]
    if test_hooks::snapshot_delete_fails() {
        return Err(std::io::Error::other("simulated snapshot delete failure"));
    }
    let path = snapshot_path();
    let held = std::sync::Arc::clone(&*SNAPSHOT_DELETE).lock_owned().await;
    // The guard moves into the blocking call and is released only when the delete returns,
    // even if the restore's budget drops this future first (see `settle_snapshot_delete`).
    tokio::task::spawn_blocking(move || {
        let _held = held;
        #[cfg(any(not(windows), feature = "test"))]
        test_hooks::pause_snapshot_delete();
        let removed = std::fs::remove_file(path);
        #[cfg(test)]
        test_hooks::note_snapshot_delete_returned();
        removed
    })
    .await
    .unwrap_or_else(|error| Err(std::io::Error::other(error)))
}

/// Wait, bounded, for a snapshot delete that an earlier restore left running when its budget
/// dropped it. Callers hold `DNS_OPERATION`, so once this returns no new delete can start until
/// they release it, and every snapshot read and write they make lands after the late delete.
pub(super) async fn settle_snapshot_delete() -> Result<()> {
    #[cfg(test)]
    test_hooks::note_snapshot_settle(&SNAPSHOT_DELETE);
    match tokio::time::timeout(SNAPSHOT_DELETE_SETTLE_TIMEOUT, SNAPSHOT_DELETE.lock()).await {
        Ok(_settled) => Ok(()),
        Err(_) => bail!(
            "an earlier DNS snapshot delete has not returned within \
             {SNAPSHOT_DELETE_SETTLE_TIMEOUT:?}; protected-dns.json is left untouched and this \
             DNS operation is refused. Retry once the file system settles."
        ),
    }
}

/// Restore adapters and resolver policies before dropping their recovery snapshot. A failed
/// proof keeps the snapshot and, via the disarm invariant, the block armed.
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
    // A failed wait leaves the snapshot and, through the disarm gate, protection as they are.
    settle_snapshot_delete().await?;
    let bytes = match tokio::fs::read(snapshot_path()).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Absence alone is not proof of a clean state: the file and the adapter registry are
            // separate writes. Refuse to stop the core/disarm if the current TUN DNS endpoint
            // survived while its recovery record did not.
            record_outcome(ensure_snapshotless_dns_is_safe().await)?;
            // Older builds could delete this snapshot before NRPT cleanup succeeded.
            // Reconcile the independently owned rule and DoH captures on every retry.
            let capture_note = record_outcome(restore_resolver_policy().await)?;
            if let Some(note) = settle_capture_loss(capture_note).await {
                surface_success_note(&note);
            }
            if let Err(error) = engine_flush_cache().await {
                tracing::warn!("DNS cache flush after snapshotless restore failed: {error:#}");
            }
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
            let capture_note = record_outcome(recover_unreadable_snapshot(&reason).await)?;
            if let Some(note) = settle_capture_loss(capture_note).await {
                surface_success_note(&note);
            }
            // Same reasoning as the proven path below: answers collected while DNS pointed at
            // the loopback core must not outlive the disconnect.
            if let Err(error) = engine_flush_cache().await {
                tracing::warn!("DNS cache flush after snapshot recovery failed: {error:#}");
            }
            return status_unlocked().await;
        }
    };
    let already_restored = snapshot_was_restored(&bytes).await;
    let mut snapshot = with_live_failures(&snapshot, &LIVE_APPLY_FAILURES.lock().unwrap());
    // `Some(note)` = the restore was accepted on the documented degraded path and the note must
    // reach `last_error`; `None` = fully proven.
    let outcome: Result<Option<String>> = async {
        if already_restored {
            // Do not overwrite DNS the user changed after the previous successful restore.
            // Tono-owned residue still needs the existing snapshotless safety proof/repair.
            ensure_snapshotless_dns_is_safe().await?;
            return Ok(None);
        }
        // The engine applies all adapters in one PowerShell batch and retries the failures
        // once in a second batch, reporting final per-adapter results.
        let live = engine_apply_snapshot(&snapshot).await?;
        let streak = note_apply_round(live.iter().any(|(_, ok)| !ok));
        note_live_results(&mut snapshot, &live);
        // Prove restoration before refreshing bookkeeping. A successful restore retires
        // the snapshot, so rewriting it would only add a fallible write and a possible late
        // replacement racing that retirement. Failed proofs save their flags below.
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
    if outcome.is_err() {
        // The originals have not changed. Keep current failure flags in memory and refresh
        // their durable record when possible, without replacing the machine-proof error.
        if let Err(error) = atomic_write(&snapshot_path(), &serde_json::to_vec_pretty(&snapshot)?).await {
            tracing::warn!("dns: failed restore outcome could not be saved: {error:#}");
        }
    }
    let degraded = record_outcome(outcome)?;
    // Required resolver cleanup belongs to the disarm proof, not best-effort housekeeping.
    // A failed NRPT/DoH restore retains the adapter snapshot and its independent captures.
    let capture_note = record_outcome(restore_resolver_policy().await)?;
    // The restore is proven by here; deleting the snapshot is housekeeping. A delete that
    // fails on something other than absence (typically a transient AV sharing violation)
    // used to fail the whole restore and, through the disarm gate, refuse the WFP release —
    // the machine stayed blocked over a file that no longer describes a redirect. Retry
    // briefly, then record its retirement so later restores do not replay it and the next
    // enable captures the user's current originals. Failure to record is a second I/O fault;
    // it must still not undo a proven restore or re-block the machine.
    let mut leftover: Option<std::io::Error> = None;
    for attempt in 0..SNAPSHOT_DELETE_ATTEMPTS {
        match remove_restored_snapshot().await {
            Ok(()) => {
                leftover = None;
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                leftover = None;
                break;
            }
            Err(error) => {
                if attempt + 1 < SNAPSHOT_DELETE_ATTEMPTS {
                    tokio::time::sleep(SNAPSHOT_DELETE_RETRY_DELAY).await;
                }
                leftover = Some(error);
            }
        }
    }
    let retirement_error = if leftover.is_some() {
        let record = async {
            // Apply bookkeeping may have rewritten flags since entry; hash the retained bytes.
            let retained = tokio::fs::read(snapshot_path()).await?;
            atomic_write(&snapshot_retirement_path(), &snapshot_fingerprint(&retained)).await
        };
        match tokio::time::timeout(SNAPSHOT_RETIREMENT_TIMEOUT, record).await {
            Ok(recorded) => recorded.err(),
            Err(_) => Some(anyhow::anyhow!("DNS snapshot retirement record timed out")),
        }
    } else {
        if let Err(error) = clear_snapshot_retirement().await {
            tracing::warn!("dns: obsolete snapshot retirement record could not be removed: {error:#}");
        }
        None
    };
    let leftover_note = leftover.map(|error| {
        tracing::warn!(
            "dns: the restored protected-dns snapshot could not be deleted ({error}); it will \
             be retried on the next restore"
        );
        let disposition = match retirement_error {
            Some(error) => format!("its retirement could not be recorded ({error:#}); a later retry may replay the saved originals"),
            None => "its retirement was recorded; later sessions capture fresh originals".to_owned(),
        };
        format!(
            "{DNS_RESTORE_DEGRADED_PREFIX}: the original DNS servers were restored and \
             verified, but the recovery snapshot file could not be deleted ({error}); the \
             next disconnect retries the deletion; {disposition}"
        )
    });
    // Committed as far as the machine is concerned. The degraded-restore note (adapter
    // DNS), the leftover-snapshot note and the capture note (Encrypted DNS) describe
    // different losses, so all reach `last_error`.
    if let Some(note) = join_notes(
        degraded,
        join_notes(leftover_note, settle_capture_loss(capture_note).await),
    ) {
        surface_success_note(&note);
    }
    if let Err(error) = engine_flush_cache().await {
        tracing::warn!("DNS cache flush after restore failed: {error:#}");
    }
    status_unlocked().await
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
