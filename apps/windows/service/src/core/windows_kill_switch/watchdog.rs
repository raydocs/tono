//! The verify-after-write watchdog and DIRECT invalidation.

use super::*;

pub(super) fn direct_reload_invalidation_reason(
    armed: &Armed,
    current_core: Option<CoreInstance>,
    current_tunnel_luid: Option<u64>,
    now: std::time::Instant,
) -> Option<&'static str> {
    let Some(lease) = armed.direct_reload.as_ref() else {
        return (!armed.direct_endpoints.is_empty())
            .then_some("DIRECT endpoints exist without a Service-owned lease");
    };
    if lease.expires_at.is_none_or(|deadline| now >= deadline) {
        return Some(match lease.phase {
            DirectReloadPhase::Bracket => "DIRECT runtime reload bracket expired before install",
            DirectReloadPhase::Pending => {
                "pending DIRECT endpoints expired before App finalization"
            }
            DirectReloadPhase::Committed => {
                "committed DIRECT heartbeat lease expired after App/session liveness was lost"
            }
            DirectReloadPhase::Retracting => "DIRECT permits await exact Blocked retraction",
        });
    }
    if lease.phase != DirectReloadPhase::Bracket
        && (armed.intent.mode != KillSwitchStatusMode::Locked
            || tunnel_permit_luid(armed, current_core).is_none()
            || lease.core_instance != current_core
            || armed.tun_luid.is_none()
            || armed.tun_luid != current_tunnel_luid
            || lease.tunnel_luid != armed.tun_luid)
    {
        return Some("DIRECT endpoint Core/TUN/LUID ownership changed");
    }
    None
}

pub(super) async fn reconcile_direct_watchdog_invalidation_unlocked(
    mut armed: Armed,
    current_core: Option<CoreInstance>,
    now: std::time::Instant,
    reason: &str,
) -> Result<()> {
    // Only a lost committed heartbeat releases. Pending finalization and an
    // explicit strict kill switch stay Blocked. The structural lease check is
    // what authorizes the release; the reason prefix is the same contract the
    // App matches, so a pending-expiry string cannot open the network.
    let release = committed_direct_lease_failure_releases(reason, armed.intent.strict_kill_switch)
        && armed.direct_reload.as_ref().is_some_and(|lease| {
            lease.phase == DirectReloadPhase::Committed
                && lease.expires_at.is_none_or(|deadline| now >= deadline)
        });
    // Narrowing failure poisons the deadline. Keep ownership-change retries distinct from
    // App death, even if the heartbeat deadline passes while the failed install is awaited.
    if !release {
        if let Some(lease) = armed.direct_reload.as_mut() {
            if lease.phase == DirectReloadPhase::Committed {
                lease.phase = DirectReloadPhase::Retracting;
                lease.expires_at = Some(now);
            }
        }
    }
    // App death must release a non-strict session after exact DIRECT retraction. Keep only
    // its expired receipt until release succeeds so a failed WFP removal retries next tick.
    let next_lease = if release {
        armed.direct_reload.clone()
    } else {
        None
    };
    let transition = transition_direct_to_blocked_unlocked(armed, current_core, next_lease).await;
    note_verify(transition.is_ok());
    if let Err(error) = transition {
        if !release || !error.is::<DirectBlockedIntentPersistenceFailure>() {
            return Err(error);
        }
        tracing::warn!(
            "wfp: {reason}; exact Blocked WFP was proved; releasing despite intent persistence failure: {error:#}"
        );
    }
    if release {
        if queue_direct_expiry_retirement() {
            tracing::warn!("wfp: {reason}; retiring the expired session's Core before selective fallback");
            return Ok(());
        }
        let message = format!("{reason}; exact DIRECT permits were retracted; non-strict session");
        release_unhealthy_session_unlocked(&message).await?;
        Ok(())
    } else {
        let message =
            format!("{reason}; exact DIRECT permits were retracted and traffic is Blocked");
        *last_error_guard() = Some(message.clone());
        tracing::warn!("{message}");
        Ok(())
    }
}

/// One-second verify-after-write watchdog (the macOS helper does the same for PF).
///
/// A restored verified wanted session releases immediately when Core is neither running
/// nor about to start. While Core is running or this boot will start it, a bounded
/// core-proof window applies: if Core is not running with a Locked, verified tunnel
/// permit when that window ends, the tick releases WFP and restores DNS instead of
/// reinstalling the block. An explicit strict kill switch does not start the window.
/// An unhealthy tick does not reinstall unless that opt-in is set. Without it, general
/// traffic is released after [`UNHEALTHY_RELEASE_TICKS`]. Strict mode repairs until
/// [`STRICT_UNHEALTHY_RELEASE_TICKS`], then releases too. Persistent failures are
/// log-throttled — one error per minute, the rest at debug — so a broken engine cannot
/// flood the service log.
pub fn spawn_windows_kill_switch_watchdog() {
    /// One error line per minute; the rest at debug.
    const ERROR_LOG_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
    tokio::spawn(async {
        // `None` = "never logged yet", *not* `Instant::now() - an hour`: `Instant` is
        // boot-relative on Windows and this service is AutoStart, so subtracting an hour
        // underflows and panics on a machine that has been up for less than that — killing the
        // watchdog task on its first statement at every boot, which would silently disable both
        // the verify-after-write reconciliation and the `LAST_VERIFY` refresh that `status()`
        // reports liveness from.
        let mut last_error_log: Option<std::time::Instant> = None;
        let mut consecutive_unhealthy: u32 = 0;
        loop {
            tokio::time::sleep(WATCHDOG_PERIOD).await;
            let _operation = WFP_OPERATION.lock().await;
            owe_update_held_startup_release_unlocked(update_holds_no_live_owner);
            if let Err(error) = reconcile_wanted_core_window_unlocked().await {
                tracing::warn!(
                    "wanted-session core window could not open the network yet: {error:#}"
                );
            }
            let fresh_epoch = FRESH_ARM_EPOCH.load(Ordering::Acquire);
            if expired_fresh_arm_owner(fresh_epoch).is_some() {
                // Lifecycle handlers take owner lifecycle before WFP. Never invert that order;
                // stop_core also reacquires WFP to retract permits before terminating Core.
                drop(_operation);
                if let Err(error) = crate::core::server::retire_expired_fresh_arm(fresh_epoch).await {
                    if last_error_log.is_none_or(|at| at.elapsed() >= ERROR_LOG_INTERVAL) {
                        tracing::error!("abandoned Connect could not be retired: {error:#}");
                        last_error_log = Some(std::time::Instant::now());
                    }
                }
                continue;
            }
            let armed = { armed_guard().clone() };
            if let Some(armed) = armed {
                let direct_transaction_active = armed.direct_reload.is_some();
                let current_core = if direct_transaction_active {
                    current_core_instance_for_direct_security()
                } else {
                    current_core_instance().await
                };
                let current_tunnel_luid = if armed
                    .direct_reload
                    .as_ref()
                    .is_some_and(|lease| lease.phase != DirectReloadPhase::Bracket)
                {
                    resolve_luid(&armed.intent.tunnel_interface).await.ok()
                } else {
                    None
                };
                let now = std::time::Instant::now();
                if let Some(reason) = direct_reload_invalidation_reason(
                    &armed,
                    current_core,
                    current_tunnel_luid,
                    now,
                ) {
                    match reconcile_direct_watchdog_invalidation_unlocked(
                        armed,
                        current_core,
                        now,
                        reason,
                    )
                    .await
                    {
                        Ok(()) => {}
                        Err(error) => {
                            if last_error_log.is_none_or(|at| at.elapsed() >= ERROR_LOG_INTERVAL) {
                                tracing::error!(
                                    "{reason}; fail-closed DIRECT reconciliation failed: {error:#}"
                                );
                                last_error_log = Some(std::time::Instant::now());
                            } else {
                                tracing::debug!(
                                    "{reason}; fail-closed DIRECT reconciliation still failing: {error:#}"
                                );
                            }
                        }
                    }
                    consecutive_unhealthy = 0;
                    continue;
                }
                let healthy = if ENGINE_LIVE {
                    let healthy = verify_live_unlocked_for(&armed, current_core).await.is_ok();
                    note_verify(healthy);
                    healthy
                } else {
                    true
                };
                if healthy {
                    consecutive_unhealthy = 0;
                    continue;
                }
                consecutive_unhealthy = consecutive_unhealthy.saturating_add(1);
                match unhealthy_watchdog_action(
                    armed.intent.strict_kill_switch,
                    consecutive_unhealthy,
                ) {
                    UnhealthyWatchdogAction::Wait => {
                        tracing::debug!(
                            "Windows kill-switch unhealthy ({consecutive_unhealthy}); not reinstalling"
                        );
                    }
                    UnhealthyWatchdogAction::Reinstall => {
                        if let Err(error) = install_unlocked_for(&armed, current_core).await {
                            *last_error_guard() = Some(format!("{error:#}"));
                            if last_error_log.is_none_or(|at| at.elapsed() >= ERROR_LOG_INTERVAL) {
                                tracing::error!(
                                    "Windows kill-switch strict reconciliation failed: {error:#}"
                                );
                                last_error_log = Some(std::time::Instant::now());
                            } else {
                                tracing::debug!(
                                    "Windows kill-switch strict reconciliation still failing: {error:#}"
                                );
                            }
                        }
                    }
                    UnhealthyWatchdogAction::Release => {
                        if let Err(error) = release_unhealthy_session_unlocked(
                            "unhealthy Windows kill-switch watchdog",
                        )
                        .await
                        {
                            if last_error_log.is_none_or(|at| at.elapsed() >= ERROR_LOG_INTERVAL) {
                                tracing::error!(
                                    "Windows kill-switch unhealthy release failed: {error:#}"
                                );
                                last_error_log = Some(std::time::Instant::now());
                            }
                        }
                        consecutive_unhealthy = 0;
                    }
                }
            } else {
                consecutive_unhealthy = 0;
            }
        }
    });
}
