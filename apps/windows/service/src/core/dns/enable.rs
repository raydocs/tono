use super::*;

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
pub(super) async fn enable_unlocked(trigger: EnableTrigger) -> Result<DnsProtectionStatus> {
    if trigger == EnableTrigger::Request {
        // From here until an explicit restore, drift is worth repairing. Set before any work so
        // that a half-applied enable is still repaired by the watchdog.
        PROTECTION_WANTED.store(true, Ordering::Release);
        // A new session: the previous disconnected period's capture-loss note has been shown.
        *CAPTURE_LOSS_NOTE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }
    // A delete that a dropped restore left running must land before this reads or writes the
    // snapshot.
    settle_snapshot_delete().await?;
    let existing = match tokio::fs::read(snapshot_path()).await {
        Ok(bytes) if snapshot_was_restored(&bytes).await => None,
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
                // A capture-loss note cannot survive the rest of `enable` (every later
                // successful `record_outcome` clears `last_error`), so it is deliberately not
                // settled here: the evidence is only read by this recovery and stays on disk —
                // the suppress below turns an unreadable capture into a lost-originals record
                // before moving it aside — and the next restore reports it under the marker.
                let _ = record_outcome(recover_unreadable_snapshot(&reason).await)?;
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
    // A recovery file can be deleted independently of the registry (AV quarantine, manual
    // cleanup, disk corruption, failed-connect release). Never turn the TUN endpoint left
    // behind into the new "original". The same applies with a snapshot present to an adapter
    // whose original is not recorded yet — typically one that reappears carrying the endpoint a
    // corrupt-snapshot recovery could not see while it was inactive. Adapters already recorded
    // keep their saved originals, so the live protected values on them do not trip this guard.
    // If an unrecorded adapter still lists 198.18.0.2, heal it to DHCP first so Connect is not
    // permanently bricked after a prior failure; refuse only when the heal cannot be proven.
    // With a snapshot present the session's NRPT/DoH policy is protection in force, so that heal
    // resets the adapter only and a refusal below leaves the policy exactly as armed as before.
    let safety_check: fn(&[AdapterDnsSnapshot]) -> Result<()> = if snapshot_present {
        ensure_unrecorded_adapters_are_safe
    } else {
        ensure_snapshotless_adapters_are_safe
    };
    let heal_scope = if snapshot_present {
        OrphanHealScope::InSession
    } else {
        OrphanHealScope::NoSession
    };
    let mut unrecorded = unrecorded_adapters(existing.as_ref(), &fresh.adapters);
    if safety_check(&unrecorded).is_err() {
        fresh.adapters =
            heal_orphaned_protected_dns_without_snapshot(&unrecorded, heal_scope).await?;
        unrecorded = unrecorded_adapters(existing.as_ref(), &fresh.adapters);
    }
    record_outcome(safety_check(&unrecorded))?;
    // Health and replay decisions cover adapters that are live now, not historical snapshot
    // entries that have since been disabled or unplugged. Their originals remain in `snapshot`
    // and are still restored in the registry on disconnect.
    let active_adapters = fresh.adapters.clone();
    let mut snapshot = merge_snapshot(existing, fresh);
    let applying = active_snapshot_adapters(&snapshot, &active_adapters);
    let all_loopback = snapshot_present && engine_all_loopback(&active_adapters).await?;
    let live_apply_failed = applying.iter().any(|adapter| adapter.live_apply_failed);
    let replay = needs_loopback_replay(snapshot_present, all_loopback, live_apply_failed);
    if replay {
        // Registry writes can land before entry construction returns Err, and a bounded call
        // can outlive its waiter. Persist the obligation before either can mutate anything.
        let pending = applying
            .iter()
            .map(|adapter| (adapter.interface_guid.clone(), false))
            .collect::<Vec<_>>();
        note_live_results(&mut snapshot, &pending);
    }
    // Snapshot first, even on an otherwise idempotent replay: `snapshot` may now include adapters
    // that appeared after the first enable. Any error retains originals AND unfinished work.
    atomic_write(&snapshot_path(), &serde_json::to_vec_pretty(&snapshot)?).await?;
    // New originals are durable before retiring the old marker. Refuse before any protected
    // mutation if it cannot be cleared, including the otherwise-idempotent policy pin below.
    clear_snapshot_retirement().await?;
    if !replay {
        // No active adapter owes work. Do not let an absent historical adapter's note keep
        // the reconciler writing; its saved pending bit still applies when it returns.
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
        // Err is not proof of zero writes. Keep the pre-written pending flags on error or
        // timeout. Only the observed active set was reserved: never send historical adapters
        // that could reappear between collection and apply without a pending record.
        let live = engine_apply_protected(&applying).await?;
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
