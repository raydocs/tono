use super::*;

/// Reconciliation delay after `failures` consecutive failed repairs, or `None` once repair is
/// suspended.
///
/// The watchdog used to call `enable()` every `DNS_WATCHDOG_INTERVAL` for as long as the
/// protection looked drifted, with no backoff and no cap — one permanently unconfigurable
/// adapter was enough to spawn PowerShell processes and rewrite the snapshot file forever.
/// Suspending relaxes nothing: the snapshot, the status error, and the armed kill switch all
/// stay exactly as they are, and an explicit connect still calls `enable()` directly.
pub(super) fn reconcile_backoff(failures: u32) -> Option<std::time::Duration> {
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

/// Last committed/live-verified DNS observation. IPC reads clone this synchronously instead of
/// waiting behind a CIM mutation. The background reconciler refreshes it and repairs drift.
pub(super) static DNS_STATUS_CACHE: Lazy<Mutex<DnsProtectionStatus>> =
    Lazy::new(|| Mutex::new(DnsProtectionStatus::default()));
pub(super) const DNS_WATCHDOG_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
/// Consecutive failed repairs after which the watchdog stops re-running `enable()`. Five
/// attempts (≈ 1 minute with the backoff) is enough for anything transient — a hot-plugged
/// adapter, a service still starting — and anything that survives it is a machine condition
/// that retrying cannot fix.
pub(super) const DNS_RECONCILE_MAX_FAILURES: u32 = 5;
/// Ceiling for the reconciliation backoff, so even a long-lived failure costs at most one
/// repair attempt per minute instead of one every two seconds.
pub(super) const DNS_RECONCILE_MAX_BACKOFF: std::time::Duration = std::time::Duration::from_secs(60);

pub(crate) async fn status() -> DnsProtectionStatus {
    // Status is the recovery/diagnosis path: do not turn a past panic into permanent silence.
    DNS_STATUS_CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

pub(super) fn publish_status(status: &DnsProtectionStatus) {
    *DNS_STATUS_CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = status.clone();
}

pub(super) fn publish_status_error(error: &anyhow::Error) {
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
            let retired = match tokio::fs::read(snapshot_path()).await {
                Ok(bytes) => snapshot_was_restored(&bytes).await,
                Err(_) => false,
            };
            let protection_wanted = status.snapshot_present && barrier_wanted && !retired;
            if status.snapshot_present && (!barrier_wanted || retired) {
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
        let mut last_policy_check: Option<std::time::Instant> = None;
        loop {
            tokio::time::sleep(DNS_WATCHDOG_INTERVAL).await;
            // X2-2: before taking the operation lock, never under it.
            if !PROTECTION_WANTED.load(Ordering::Acquire) {
                last_policy_check = None;
                refresh_resolver_policy_observation().await;
            } else if last_policy_check.is_none_or(|at| at.elapsed() >= RESOLVER_POLICY_CHECK_INTERVAL) {
                last_policy_check = Some(std::time::Instant::now());
                refresh_resolver_policy_observation().await;
            }
            // One acquisition covers the observation *and* the repair. Reading the state, then
            // dropping the lock, then acting on what was read is how a concurrent release used
            // to turn a repair into an initial enable: the snapshot could be deleted in between,
            // and the repair would then capture the freshly restored resolvers as "originals"
            // and point the machine at a loopback core that is no longer running. This mirrors
            // the WFP watchdog, which reads `armed_guard()` while holding `WFP_OPERATION`.
            let _operation = DNS_OPERATION.lock().await;
            let (status, active_pending) = match observe_status_unlocked().await {
                Ok(observation) => observation,
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
                active_pending || status_is_unverified(&status),
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

pub(super) async fn status_unlocked() -> Result<DnsProtectionStatus> {
    observe_status_unlocked().await.map(|(status, _)| status)
}

/// The wire status retains its configuration/advisory semantics. The watchdog also needs the
/// active durable obligation: neither an ordinary error string nor a restart may hide it.
pub(super) async fn observe_status_unlocked() -> Result<(DnsProtectionStatus, bool)> {
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
    let snapshot = snapshot
        .map(|snapshot| with_live_failures(&snapshot, &LIVE_APPLY_FAILURES.lock().unwrap()));
    let (enabled, active_pending, active_count) = match snapshot.as_ref() {
        Some(snapshot) if ENGINE_LIVE => {
            // Include adapters that appeared since the last enable. Checking only saved GUIDs can
            // report a false healthy state while a fresh adapter still uses an external resolver.
            let current = collect_dns_adapters().await?;
            let pending = active_snapshot_adapters(snapshot, &current)
                .into_iter()
                .filter(|adapter| adapter.live_apply_failed)
                .map(|adapter| adapter.interface_guid)
                .collect::<Vec<_>>();
            (engine_all_loopback(&current).await?, pending, current.len())
        }
        Some(snapshot) => (
            engine_all_loopback(&snapshot.adapters).await?,
            Vec::new(),
            snapshot.adapters.len(),
        ),
        None => (false, Vec::new(), 0),
    };
    let mut last_error = DNS_LAST_ERROR.lock().unwrap().clone();
    if !active_pending.is_empty() {
        let read_back = if enabled {
            LoopbackReadBack::Verified
        } else {
            LoopbackReadBack::Contradicted
        };
        if let Some(note) = unverified_note(&active_pending, active_count, read_back) {
            // Keep hard errors hard for the App. Adding an advisory marker to a registry error
            // would make its existing health predicate classify that error as a warning.
            if last_error.as_deref().is_none_or(|error| error.contains(DNS_PROTECTION_UNVERIFIED_PREFIX)) {
                last_error = Some(note);
            }
        }
    } else if enabled
        && last_error.as_deref().is_some_and(|error| error.contains(DNS_PROTECTION_UNVERIFIED_PREFIX))
    {
        // Absence does not erase pending bits, but a note about inactive adapters must not
        // keep a healthy active set in a perpetual repair loop.
        last_error = None;
    }
    // X2-2: adapter registry health is not the resolver policy Windows applies. Report the
    // watchdog's last policy verdict as an advisory beside `last_error`, never inside it.
    let resolver_policy_warning = if enabled && snapshot.is_some() && PROTECTION_WANTED.load(Ordering::Acquire) {
        RESOLVER_POLICY_CONFLICT
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    } else {
        None
    };
    let status = DnsProtectionStatus {
        enabled,
        snapshot_present: snapshot.is_some(),
        adapters: snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.adapters.len() as u32),
        last_error,
        resolver_policy_warning,
    };
    publish_status(&status);
    Ok((status, !active_pending.is_empty()))
}
