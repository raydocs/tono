//! Service start: restore, startup release retry, replacement and unverified retirement.

use super::*;

pub(super) fn spawn_startup_release_retry() {
    if STARTUP_RELEASE_RETRY_RUNNING.swap(true, Ordering::AcqRel) {
        return;
    }
    struct RetryRunningGuard;
    impl Drop for RetryRunningGuard {
        fn drop(&mut self) {
            STARTUP_RELEASE_RETRY_RUNNING.store(false, Ordering::Release);
        }
    }
    let running = RetryRunningGuard;
    tokio::spawn(async move {
        let mut delay = std::time::Duration::from_millis(if cfg!(test) { 10 } else { 1000 });
        let mut last_error_log: Option<std::time::Instant> = None;
        loop {
            tokio::time::sleep(delay).await;
            let _operation = WFP_OPERATION.lock().await;
            if armed_guard().is_some() {
                drop(running);
                return;
            }
            let intent = tokio::fs::read(intent_path())
                .await
                .ok()
                .and_then(|bytes| serde_json::from_slice::<IntentRecord>(&bytes).ok());
            if intent.as_ref().is_some_and(|intent| {
                intent.wanted && (intent_is_valid(intent) || intent.strict_kill_switch)
            }) {
                drop(running);
                return;
            }
            // Cleared before the attempt so a success keeps its AI-hold report.
            *last_error_guard() = None;
            let release: Result<()> = async {
                if intent.as_ref().is_none_or(|intent| intent.wanted) {
                    // Incomplete non-strict evidence needs its startup AI hold and retention.
                    // A newer valid or explicitly strict record was gated above.
                    return release_general_traffic_unlocked(
                        "startup incomplete-intent release retry", false,
                    )
                    .await;
                }
                let follow_up = intent.as_ref().and_then(IntentRecord::release_follow_up);
                hold_ai_before_release(follow_up == Some(true)).await;
                remove_all_filters_unlocked().await?;
                sweep_legacy_sublayers_unlocked().await;
                let reconnect = intent.as_ref().is_some_and(|intent| intent.reconnect_after_release);
                if let Some(intent) = intent.as_ref().filter(|_| reconnect) {
                    // A retry must retain the same crash-reconnect intent as normal startup.
                    publish_reconnect_from(intent);
                }
                if !reconnect && follow_up != Some(true) {
                    match tokio::fs::remove_file(intent_path()).await {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                *armed_guard() = None;
                TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
                if let Err(error) = bounded_dns_call(
                    "service start (unwanted intent)",
                    crate::core::dns::ensure_restored(),
                )
                .await
                {
                    tracing::warn!(
                        "service start: leftover DNS snapshot could not be restored: {error:#}"
                    );
                }
                if let Some(apply_narrow) = follow_up {
                    finish_release_follow_up(apply_narrow).await;
                }
                Ok(())
            }
            .await;
            match release {
                Ok(()) => {
                    // Retire under the writer lock so a later startup cannot lose its retry.
                    drop(running);
                    return;
                }
                Err(error) => {
                    *last_error_guard() =
                        Some(format!("startup stale-filter release pending: {error:#}"));
                    if last_error_log
                        .is_none_or(|at| at.elapsed() >= std::time::Duration::from_secs(60))
                    {
                        tracing::error!("Windows stale-filter release retry failed: {error:#}");
                        last_error_log = Some(std::time::Instant::now());
                    } else {
                        tracing::debug!(
                            "Windows stale-filter release retry still failing: {error:#}"
                        );
                    }
                }
            }
            delay = (delay * 2).min(std::time::Duration::from_secs(30));
        }
    });
}

/// Ownerless block used only when the on-disk record explicitly enabled the strict kill
/// switch and its details are unusable. Any authenticated owner may still release it.
fn emergency_armed() -> Armed {
    Armed {
        intent: IntentRecord {
            wanted: true,
            mode: KillSwitchStatusMode::Blocked,
            verified: Some(true),
            tunnel_interface: String::new(),
            app_path: String::new(),
            endpoints: Vec::new(),
            api_host_ips: Vec::new(),
            updated_at: now_unix(),
            owner_key: None,
            strict_kill_switch: true,
            reconnect_after_release: false,
            reconnect_owner_key: None,
            apply_narrow_after_release: None,
        },
        tun_luid: None,
        core_instance: None,
        direct_endpoints: Vec::new(),
        reviewed_direct_ports: Vec::new(),
        direct_reload: None,
    }
}

/// Service-start recovery (design doc §3): read the intent record and reconcile.
///
/// Ordering invariant: the intent is reconciled and the current expected filter set is
/// installed *before* the legacy-sublayer upgrade sweep runs. Across an upgrade reboot an
/// older build's PERSISTENT block-all pair may be the only protection on the machine;
/// sweeping it away before the replacement floor is committed would open a zero-filter
/// window at boot — and leave the machine open for good if the reconcile then failed.
/// `install` itself swaps legacy filters for the current set in a single transaction, so
/// the sweep afterwards only clears the emptied legacy sublayer objects.
pub async fn restore_on_service_start() -> Result<()> {
    if !SUPPORTED {
        return Ok(());
    }
    // Read before the WFP lock. Desired-state I/O must not nest under it.
    let replay_expected = crate::core::desired::core_replay_expected_this_boot().await;
    let _operation = WFP_OPERATION.lock().await;
    RESTORE_WAS_LOCKED.store(false, Ordering::Release);
    clear_wanted_core_window();
    publish_reconnect(false, None);
    STARTUP_UNVERIFIED_BARRIER.store(false, Ordering::Release);
    STARTUP_SETTLED.store(false, Ordering::Release);
    match tokio::fs::read(intent_path()).await {
        Ok(bytes) => match serde_json::from_slice::<IntentRecord>(&bytes) {
            Ok(intent) if intent_is_valid(&intent) => {
                if !intent.is_verified() {
                    // Do not open the machine yet. Startup reconciliation runs immediately after
                    // this function and must first prove that any previous Core is gone. It then
                    // calls `retire_unverified_on_service_start`, which durably retires the desired
                    // owner, proves DNS restoration, and only then removes WFP. Keeping a strict
                    // Blocked snapshot here closes the old Core/WFP ordering window. If that
                    // retirement fails, a non-strict intent still releases with the AI hold.
                    let mut intent = intent;
                    apply_learned_bootstrap_pins(&mut intent);
                    let mut armed = Armed {
                        intent,
                        tun_luid: None,
                        core_instance: None,
                        direct_endpoints: Vec::new(),
                        reviewed_direct_ports: Vec::new(),
                        direct_reload: None,
                    };
                    armed.intent.mode = KillSwitchStatusMode::Blocked;
                    armed.intent.updated_at = now_unix();
                    STARTUP_UNVERIFIED_BARRIER.store(true, Ordering::Release);
                    *armed_guard() = Some(armed.clone());
                    let persist = match serde_json::to_vec_pretty(&armed.intent) {
                        Ok(encoded) => atomic_write(&intent_path(), &encoded).await,
                        Err(error) => Err(error.into()),
                    };
                    let install = install_unlocked(&armed).await;
                    let wfp_live = install.is_ok();
                    let reconciled = record_startup_reconciliation(persist, install);
                    if wfp_live {
                        sweep_legacy_sublayers_unlocked().await;
                    }
                    return reconciled;
                }
                let mut intent = intent;
                apply_learned_bootstrap_pins(&mut intent);
                let mut armed = Armed {
                    intent,
                    tun_luid: None,
                    // A restored intent never inherits a tunnel grant: the adapter, and the core
                    // that created it, belong to a process that is gone.
                    core_instance: None,
                    // omission = clear: a restore never brings DIRECT endpoints back. The
                    // recovered session stays fail-closed for them until the app's next
                    // connect transaction re-issues the approved tuples.
                    direct_endpoints: Vec::new(),
                    reviewed_direct_ports: Vec::new(),
                    direct_reload: None,
                };
                // A persisted Locked mode is not proof this boot's tunnel exists: downgrade to
                // Blocked (fail-closed, API recovery channel open) until the tunnel is
                // re-locked — by `relock_restored_tunnel` after a core restore, or by the GUI.
                let restored_was_locked = armed.intent.mode == KillSwitchStatusMode::Locked;
                if restored_was_locked {
                    // Materialize the legacy Locked => verified migration before changing mode.
                    // Otherwise a second service restart would reinterpret the now-Blocked
                    // field-less record as stale and incorrectly open an established session.
                    armed.intent.verified = Some(true);
                    armed.intent.mode = KillSwitchStatusMode::Blocked;
                    armed.intent.updated_at = now_unix();
                    RESTORE_WAS_LOCKED.store(true, Ordering::Release);
                }
                // Published before the install so the watchdog keeps retrying a failed one, but
                // not yet proof of a live barrier for the Remote Desktop exception.
                RESTORED_BARRIER_UNPROVEN.store(true, Ordering::Release);
                *armed_guard() = Some(armed.clone());
                let persist = if restored_was_locked {
                    match serde_json::to_vec_pretty(&armed.intent) {
                        Ok(encoded) => atomic_write(&intent_path(), &encoded).await,
                        Err(error) => Err(error.into()),
                    }
                } else {
                    Ok(())
                };
                let install = install_unlocked(&armed).await;
                let wfp_live = install.is_ok();
                let reconciled = record_startup_reconciliation(persist, install);
                if wfp_live {
                    sweep_legacy_sublayers_unlocked().await;
                }
                // Strict keeps the block. Otherwise the block stays only while Core is
                // running or this boot will start it, and only until the calibrated cap.
                // A Core that is neither running nor starting is released here.
                if armed.intent.strict_kill_switch {
                    clear_wanted_core_window();
                    CORE_REPLAY_EXPECTED.store(false, Ordering::Release);
                    reconciled
                } else {
                    let running = current_core_instance().await.is_some();
                    let starting = core_is_running_or_starting(running, replay_expected);
                    note_wanted_core_window(&armed.intent);
                    if starting {
                        CORE_REPLAY_EXPECTED.store(!running, Ordering::Release);
                        reconciled
                    } else {
                        CORE_REPLAY_EXPECTED.store(false, Ordering::Release);
                        *WANTED_CORE_DEADLINE
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner) =
                            Some(std::time::Instant::now());
                        match release_unproven_wanted_session_unlocked().await {
                            Ok(()) => Ok(()),
                            Err(release_error) => Err(release_error),
                        }
                    }
                }
            }
            // `wanted == false` still disarms. A wanted record that no longer validates is not
            // an explicit strict kill switch unless `strict_kill_switch` is true. Corrupt and
            // unreadable bytes cannot prove that opt-in, so those paths release as well.
            Ok(intent) if !intent.wanted => {
                // Unwanted-but-parseable, with possible residual objects: clean up, exactly the
                // design's third recovery rule. A leftover DNS snapshot (e.g. from an emergency
                // disarm whose restore could not be proven) is swept here too — protection is
                // off, so the machine must not stay on loopback DNS.
                //
                // Replay a recorded secondary disposition only after broad cleanup. Automatic
                // tombstones stay for future recovery; explicit Restore supersedes them. Legacy
                // records without a disposition preserve their existing hold. The rules name
                // only the allowlisted suffixes and the two
                // Anthropic prefixes, so leaving them cannot block general traffic.
                // `remove_all_filters` is provider-scoped, so filters in legacy sublayers go
                // with it; the sweep afterwards only clears the emptied sublayer objects.
                let follow_up = intent.release_follow_up();
                hold_ai_before_release(follow_up == Some(true)).await;
                if let Err(error) = remove_all_filters_unlocked().await {
                    *last_error_guard() =
                        Some(format!("startup stale-filter release pending: {error:#}"));
                    spawn_startup_release_retry();
                    return Err(error);
                }
                sweep_legacy_sublayers_unlocked().await;
                if intent.reconnect_after_release {
                    // Keep the crash-window tombstone so a later Service start still tells the
                    // app to reconnect. A user-disconnect tombstone is consumed as before.
                    publish_reconnect_from(&intent);
                }
                if !intent.reconnect_after_release && follow_up != Some(true) {
                    match tokio::fs::remove_file(intent_path()).await {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.into()),
                    }
                }
                *armed_guard() = None;
                TUNNEL_PERMIT_RENDERED.store(false, Ordering::Relaxed);
                if let Err(error) = bounded_dns_call(
                    "service start (unwanted intent)",
                    crate::core::dns::ensure_restored(),
                )
                .await
                {
                    tracing::warn!(
                        "service start: leftover DNS snapshot could not be restored: {error:#}"
                    );
                }
                if let Some(apply_narrow) = follow_up {
                    finish_release_follow_up(apply_narrow).await;
                }
                Ok(())
            }
            Ok(intent) => {
                // Details are unusable. Keep the file. Install a block only when this record
                // itself says the strict kill switch is on.
                if crash_recovery_releases_network(intent.strict_kill_switch) {
                    tracing::warn!(
                        "unusable kill-switch intent; releasing general traffic and keeping the file"
                    );
                    return release_general_traffic_on_startup_unlocked("unusable kill-switch intent").await;
                }
                let emergency = emergency_armed();
                *armed_guard() = Some(emergency.clone());
                let installed = install_unlocked(&emergency).await.context(
                    "unusable strict kill-switch intent: failed to install emergency block",
                );
                if installed.is_ok() {
                    sweep_legacy_sublayers_unlocked().await;
                }
                installed
            }
            Err(_) => {
                // The bytes do not parse, so they cannot prove an explicit strict opt-in.
                // Leave them on disk and release general traffic.
                tracing::warn!(
                    "corrupt kill-switch intent; releasing general traffic and keeping the file"
                );
                release_general_traffic_on_startup_unlocked("corrupt kill-switch intent").await
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // No record can name an explicit strict kill switch. Residual filters are released.
            #[cfg(all(windows, not(feature = "test")))]
            if engine_call("residual filter check", crate::core::wfp::any_filters_exist)
                .await
                .unwrap_or(true)
            {
                return release_general_traffic_on_startup_unlocked(
                    "residual WFP without a kill-switch intent",
                )
                .await;
            }
            // Not armed and no filters anywhere (the residual check is provider-scoped, legacy
            // sublayers included): sweeping empty leftover sublayer objects cannot remove
            // protection, and on a fresh install the sweep is a read-only no-op because the
            // Tono provider does not exist.
            sweep_legacy_sublayers_unlocked().await;
            // Not armed and nothing residual: still sweep a leftover DNS snapshot (see above).
            if let Err(error) = bounded_dns_call(
                "service start (no intent)",
                crate::core::dns::ensure_restored(),
            )
            .await
            {
                tracing::warn!(
                    "service start: leftover DNS snapshot could not be restored: {error:#}"
                );
            }
            Ok(())
        }
        Err(error) => {
            // Unreadable (ACL damage, a directory, transient I/O) cannot prove a strict
            // opt-in. Release general traffic. A clean NotFound never reaches here.
            tracing::warn!(
                "kill-switch intent could not be read: {error:#}; releasing general traffic"
            );
            release_general_traffic_on_startup_unlocked("unreadable kill-switch intent").await
        }
    }
}

/// Read-only WFP proof for the uninstaller's "nothing to clean" fast path.
///
/// State files are not the source of truth for persistent WFP objects: an interrupted or older
/// uninstall can leave provider-scoped filters behind after deleting `kill-switch.json` and the
/// SCM record. Service start releases that combination unless a readable record explicitly
/// enabled the strict kill switch. An uninstaller may still skip the real disarm only when
/// this probe also proves that no Tono filter exists.
///
/// **Provider-absent is not an error:** `FwpmProviderGetByKey0` returning `0x80320005`
/// (`FWP_E_PROVIDER_NOT_FOUND`) means there is no Tono provider and therefore no residual
/// filters. Reporting that as `Err` made Chinese clean-machine installs fail with result 3.
#[cfg(all(windows, not(feature = "test")))]
pub async fn residual_filters_present() -> Result<bool> {
    let _operation = WFP_OPERATION.lock().await;
    match engine_call(
        "uninstall residual filter check",
        crate::core::wfp::any_filters_exist,
    )
    .await
    {
        Ok(present) => Ok(present),
        Err(error) if crate::core::wfp::error_text_means_provider_absent(&format!("{error:#}")) => {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

#[cfg(not(all(windows, not(feature = "test"))))]
pub async fn residual_filters_present() -> Result<bool> {
    Ok(false)
}

/// Prepare an in-place Service replacement without opening an active protected session.
///
/// The elevated installer calls this only after SCM reports the old Service stopped and while it
/// holds the singleton Service-owner lock. A valid wanted intent or any active owner is durable
/// evidence that protection must survive the replacement, so those cases are untouched. A
/// disconnected pre-fix build, however, has neither record: synthesize the same `wanted:false`
/// tombstone a fixed release leaves so startup removes late-visible WFP debris instead of
/// converting it into an ownerless emergency block.
///
/// Corrupt intent bytes are left untouched here. They are not an explicit strict opt-in;
/// the next Service start releases general traffic and keeps the file.
pub async fn prepare_for_service_replacement() -> Result<bool> {
    ensure_supported()?;

    // Do not use `load_active_owner` here: its normal runtime contract quarantines malformed
    // owner JSON and reports `None`, which is useful for an owner-gated release but too
    // permissive for an installer deciding whether it may synthesize an open marker. During a
    // replacement, unreadable or malformed owner evidence is ambiguity and ambiguity preserves
    // protection.
    let active_owner_path = crate::service_paths().active_owner_path();
    match tokio::fs::read(&active_owner_path).await {
        Ok(bytes) => {
            if serde_json::from_slice::<crate::core::desired::ActiveOwnerState>(&bytes).is_err() {
                tracing::warn!(
                    "Service replacement found corrupt active-owner evidence; preserving protection fail-closed"
                );
            }
            return Ok(false);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| {
                format!(
                    "failed to inspect active-owner evidence {active_owner_path:?} before Service replacement; refusing to change protection"
                )
            });
        }
    }

    match tokio::fs::read(intent_path()).await {
        Ok(bytes) => match serde_json::from_slice::<IntentRecord>(&bytes) {
            Ok(intent) if intent.wanted => Ok(false),
            Ok(intent) => {
                atomic_write(&intent_path(), &serde_json::to_vec_pretty(&intent)?).await?;
                Ok(true)
            }
            Err(error) => {
                tracing::warn!(
                    "Service replacement found a corrupt kill-switch intent; preserving it fail-closed: {error}"
                );
                Ok(false)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            persist_disarmed_tombstone().await?;
            Ok(true)
        }
        Err(error) => Err(error).context(
            "failed to inspect kill-switch intent before Service replacement; refusing to change protection",
        ),
    }
}

/// Finish startup recovery for an initial attempt that never crossed the durable verification
/// barrier. This runs *after* `reconcile_service_startup` has stopped and identified any surviving
/// Core, or after that reconciliation failed its bounded startup retries: then the decision-031
/// release (AI hold kept) replaces a Blocked machine nothing would retire. The order is
/// deliberately irreversible-safe:
///
/// 1. retire the matching owner's desired run state;
/// 2. prove DNS restoration;
/// 3. remove WFP and its intent record.
///
/// When owner retirement or the DNS proof fails, a non-strict intent still releases general
/// traffic with the AI hold (decision 031) and the error is returned so callers skip desired-Core
/// restore. Strict intents are never retired here.
/// Returns `true` when an unverified intent was retired, `false` when there was none.
pub async fn retire_unverified_on_service_start() -> Result<bool> {
    if !SUPPORTED {
        return Ok(false);
    }
    #[cfg(windows)]
    if crate::core::update::pending() { return Ok(false); }
    let _operation = WFP_OPERATION.lock().await;
    let Some(armed) = armed_guard().clone() else {
        return Ok(false);
    };
    if armed.intent.is_verified() || armed.intent.strict_kill_switch {
        return Ok(false);
    }

    let result = async {
        if let Some(owner_key) = armed.intent.owner_key.as_deref() {
            if !crate::core::desired::retire_owner_if_active(owner_key)
                .await
                .context("failed to retire stale unverified owner")?
            {
                bail!(
                    "stale unverified protection owner {owner_key:?} does not match the active Core owner"
                );
            }
        } else {
            crate::core::desired::retire_legacy_active_owner()
                .await
                .context("failed to retire active owner paired with legacy unowned protection")?;
        }
        // This is recovery from an interrupted connection, not an explicit Restore.
        // Open general traffic and retain the same AI hold as other crash releases.
        disarm_unlocked(true).await
    }
    .await;

    match result {
        Ok(()) => Ok(true),
        Err(error) => {
            // Decision 031: only strict mode (returned above) may stay fully Blocked. Retirement
            // or DNS proof failed, so open general traffic with the AI hold and best-effort DNS.
            // The error still reaches the caller, which then skips desired-Core restore.
            let reason = "stale unverified startup protection could not be retired cleanly";
            if let Err(release_error) = release_general_traffic_unlocked(reason, true).await {
                // WFP is still armed: the watchdog's core window retries the release each tick.
                *WANTED_CORE_DEADLINE
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner) =
                    Some(std::time::Instant::now());
                *last_error_guard() = Some(format!(
                    "stale unverified session could not release general traffic yet; retrying: {release_error:#}"
                ));
                return Err(error.context("general traffic release is pending a watchdog retry"));
            }
            let ai = release_ai_hold_note().map_or_else(
                || " with the AI hold".to_owned(),
                |note| format!("; {note}"),
            );
            *last_error_guard() = Some(format!(
                "stale unverified session released general traffic{ai}: {error:#}"
            ));
            Err(error.context(format!("general traffic was released{ai}")))
        }
    }
}

/// Windows counterpart of the macOS helper's `add_restored_kill_switch_tunnel`: the service
/// restored a core from desired state and the recovered intent had been `locked` (startup
/// downgraded it to `blocked` because the adapter could not be proven yet). Re-run the
/// normal lock path — including the Wintun validation chain — for the recorded interface.
/// A failure keeps the stricter Blocked mode and is recorded in `last_error`.
pub async fn relock_restored_tunnel() -> Result<()> {
    if !SUPPORTED {
        return Ok(());
    }
    if !RESTORE_WAS_LOCKED.swap(false, Ordering::Acquire) {
        return Ok(());
    }
    if armed_guard().is_none() {
        return Ok(());
    }
    lock(None).await.map_err(|error| {
        let message = format!("restored core could not be re-locked: {error:#}");
        *last_error_guard() = Some(message.clone());
        error.context(message)
    })
}
