//! Protected-offline reconnect loop and startup resume. Does not own late-arm compensation.

use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tono_core::connection::ReconnectBackoff;
use tono_logging::{Type, logging};
use tono_service_protocol::KillSwitchStatus;
use crate::core::service;
use crate::process::AsyncHandler;
use crate::tono::{
    audit::AuditEvent,
    commands,
    connection_health::{startup_resume_guards_hold, startup_runtime_is_resume_candidate},
    connection_plan::{guard_rejection_is_transient, reconnect_allowed, retry_now_is_noop},
    state::{AccountState, TonoInner, TonoState},
};
use super::{Attempt, BoxedTask, attempt, fail_connect, seed_autostart_after_connect};

/// Re-prove the complete current-owner runtime immediately before either scheduling or admitting
/// the DNS-listener exception. No cached installer hint or old UI snapshot is authority here.
pub(super) async fn active_runtime_resume_status() -> Option<KillSwitchStatus> {
    let (snapshot, dns) = tokio::join!(
        service::tono_service_status_snapshot(),
        service::tono_protected_dns_status(),
    );
    let (Ok(snapshot), Ok(dns)) = (snapshot, dns) else {
        return None;
    };
    startup_runtime_is_resume_candidate(&snapshot, &dns)
        .then(|| snapshot.kill_switch)
        .flatten()
}

/// Schedule the protected auto-reconnect (2/5/10/20/30 s, §6). The delay is
/// handed out only while idle in Protected Offline, and never when the
/// catalog is waiting for a fresh user choice.
pub async fn schedule_reconnect(state: &Arc<TonoState>, app: &AppHandle) {
    let mut inner = state.lock().await;
    schedule_reconnect_locked(&mut inner, state, app);
}

/// Run one protected reconnect **now**, for an explicit user action.
///
/// Deliberately not [`schedule_reconnect`]: that hands out the next rung of the
/// 2/5/10/20/30 s ladder and consumes it. "Retry now" aborts the attempt that was
/// already pending, so going through the ladder replaced an imminent retry with a
/// longer wait and advanced the ladder as well — every press pushed recovery
/// further away, and the countdown the user was watching jumped upward. The
/// safety predicate is unchanged: still only while idle in Protected Offline with
/// a verified session and no pending catalog choice.
pub async fn retry_reconnect_now(state: &Arc<TonoState>, app: &AppHandle) {
    let mut inner = state.lock().await;
    if !reconnect_allowed(
        inner.catalog_requires_choice,
        inner.fsm.status(),
        inner.fsm.kill_switch_armed(),
    ) || !inner.fsm.reconnect_permitted_now()
    {
        return;
    }
    let task_state = state.clone();
    let task_app = app.clone();
    inner.catalog_failover_tried.clear();
    // A press is the evidence the ladder cannot have: someone is at the machine and may have
    // just fixed what was wrong with it. Give the automatic retries their full budget back, so
    // the bound that stops an unattended loop can never strand a repaired install.
    inner.fsm.reset_reconnect_backoff();
    let handle =
        AsyncHandler::spawn(move || Box::pin(reconnect_loop(task_state, task_app, Duration::ZERO)) as BoxedTask);
    inner.tasks.reconnect = Some(handle);
    // The deadline is now, so the UI stops showing a countdown it is no longer
    // waiting for.
    inner.next_retry_at_ms = Some(commands::epoch_millis());
    state.audit().log(AuditEvent::ReconnectScheduled { delay_ms: 0 });
}

/// Say the ladder ended, at either of the two places it can end.
///
/// The ladder gave up, not the protection: WFP stays armed, the UI keeps showing Protected
/// Offline with the last failure, and "Retry now" still runs (and hands the ladder its budget
/// back). What stops is the unattended repetition of an attempt that has already failed the same
/// way for the whole budget — including the elevated repair it can reach, which is what turned a
/// broken install into an administrator prompt every thirty seconds for as long as the app was
/// open. [`schedule_reconnect_locked`] hands out the first rung and [`reconnect_loop`] owns every
/// one after it, so the unattended outage that actually spends the budget ends inside the loop:
/// without this, support could not tell "gave up" from "crashed".
pub(super) fn note_reconnect_budget_exhausted(state: &Arc<TonoState>) {
    logging!(
        warn,
        Type::Service,
        "Tono: 自动重连已用尽 {:?} 的重试预算，保持 Protected Offline 等待用户操作",
        ReconnectBackoff::BUDGET
    );
    state.audit().log(AuditEvent::ProtectedOffline {
        reason: "reconnectBudgetExhausted",
    });
}

/// Lock-held half of [`schedule_reconnect`]. Spawning and registering are one critical section:
/// Disconnect/sign-out must never observe an empty task slot and then be followed by a reconnect
/// handle that escaped their abort.
pub(super) fn schedule_reconnect_locked(inner: &mut TonoInner, state: &Arc<TonoState>, app: &AppHandle) {
    if !reconnect_allowed(
        inner.catalog_requires_choice,
        inner.fsm.status(),
        inner.fsm.kill_switch_armed(),
    ) {
        return;
    }
    if inner
        .tasks
        .reconnect
        .as_ref()
        .is_some_and(|handle| !handle.inner().is_finished())
    {
        return;
    }
    let Some(delay) = inner.fsm.next_reconnect_delay() else {
        if inner.fsm.reconnect_budget_exhausted() {
            note_reconnect_budget_exhausted(state);
        }
        return;
    };
    let task_state = state.clone();
    let task_app = app.clone();
    // The task future is boxed into a trait object so this function's opaque
    // type never embeds the reconnect loop's (which re-enters `attempt`).
    let handle = AsyncHandler::spawn(move || Box::pin(reconnect_loop(task_state, task_app, delay)) as BoxedTask);
    inner.tasks.reconnect = Some(handle);
    // F3: expose the scheduled deadline to the UI.
    inner.next_retry_at_ms = Some(commands::epoch_millis() + delay.as_millis() as i64);
    state.audit().log(AuditEvent::ReconnectScheduled {
        delay_ms: delay.as_millis() as u64,
    });
}

/// After account/catalog restore, take control of a strongly proven same-owner active runtime by
/// scheduling the normal protected reconnect. This never marks Connected directly. If any proof
/// disappeared, the GUI remains truthfully Protected Offline and waits for an explicit action.
pub async fn schedule_startup_resume_if_proven(state: &Arc<TonoState>, app: &AppHandle, restore_generation: u64) {
    // Capture both cancellation authorities before the IPC proof. Disconnect, sign-out, node
    // replacement, or a newer restore can then retire this probe while it is awaiting the
    // Service rather than letting a stale result resurrect protection afterwards.
    let (connect_generation, cancellation) = {
        let inner = state.lock().await;
        if inner.sign_in_generation != restore_generation {
            return;
        }
        (inner.connect_generation, inner.connect_cancellation.clone())
    };
    let proven = tokio::select! {
        biased;
        _ = cancellation.cancelled() => false,
        status = active_runtime_resume_status() => status.is_some(),
    };
    if !proven {
        return;
    }

    let mut inner = state.lock().await;
    let selected_is_valid = inner
        .selected_node
        .as_ref()
        .is_some_and(|selected| inner.nodes.iter().any(|node| node.name == *selected));
    // The Service proof authorizes only scheduling. It must not write its now-stale snapshot back
    // into local state or manufacture FSM latches: the startup restore already recorded the
    // durable protection it observed. Requiring those latches to remain current is what makes an
    // intervening Disconnect/release win.
    let reconnectable = reconnect_allowed(
        inner.catalog_requires_choice,
        inner.fsm.status(),
        inner.fsm.kill_switch_armed(),
    );
    if !startup_resume_guards_hold(
        inner.sign_in_generation == restore_generation,
        inner.connect_generation == connect_generation,
        matches!(inner.account_state, AccountState::Ready),
        selected_is_valid,
        inner.fsm.session_verified(),
        reconnectable,
    ) {
        return;
    }
    // Register under this same generation/admission lock. A later Disconnect/sign-out either
    // sees this handle and aborts it, or ran first and failed one of the checks above.
    schedule_reconnect_locked(&mut inner, state, app);
}

/// F3: publish (or withdraw) the deadline the Protected Offline card counts down to.
///
/// [`schedule_reconnect_locked`] and the immediate retry write it for the rung they hand out,
/// but every rung after the first belongs to [`reconnect_loop`], which only computed a delay and
/// slept. The card therefore showed Protected Offline and a stale error through the whole
/// 5/10/20/30 s wait with nothing saying a retry was queued.
pub(super) async fn publish_next_retry(state: &Arc<TonoState>, delay: Option<Duration>) {
    let mut inner = state.lock().await;
    inner.next_retry_at_ms = delay.map(|delay| commands::epoch_millis() + delay.as_millis() as i64);
}

pub(super) async fn reconnect_loop(state: Arc<TonoState>, app: AppHandle, first_delay: Duration) {
    let mut delay = first_delay;
    loop {
        tokio::time::sleep(delay).await;
        let allowed = {
            let inner = state.lock().await;
            reconnect_allowed(
                inner.catalog_requires_choice,
                inner.fsm.status(),
                inner.fsm.kill_switch_armed(),
            )
        };
        if !allowed {
            publish_next_retry(&state, None).await;
            return;
        }
        match attempt(&state, &app).await {
            Attempt::Connected => {
                seed_autostart_after_connect();
                return;
            }
            Attempt::Stale => {
                publish_next_retry(&state, None).await;
                return;
            }
            Attempt::GuardRejected(reason) => {
                if !guard_rejection_is_transient(&reason) {
                    publish_next_retry(&state, None).await;
                    return;
                }
                // The attempt never started, so this is not a connect failure: no `fail_connect`,
                // no error shown, no retry_attempt bump. It only earns the next delay, because
                // ending the loop here would strand the machine blocked with nothing scheduled.
                logging!(info, Type::Service, "Tono: 自动重连被暂态守卫拒绝，稍后重试: {reason}");
                let (next, spent) = {
                    let mut inner = state.lock().await;
                    let next = inner.fsm.next_reconnect_delay();
                    (next, inner.fsm.reconnect_budget_exhausted())
                };
                publish_next_retry(&state, next).await;
                match next {
                    Some(next_delay) => delay = next_delay,
                    None => {
                        if spent {
                            note_reconnect_budget_exhausted(&state);
                        }
                        return;
                    }
                }
            }
            Attempt::Failed(err) => {
                let err = fail_connect(&state, &app, err).await;
                let (next, spent) = {
                    let mut inner = state.lock().await;
                    let next = if inner.catalog_requires_choice {
                        None
                    } else {
                        inner.fsm.next_reconnect_delay()
                    };
                    (next, inner.fsm.reconnect_budget_exhausted())
                };
                publish_next_retry(&state, next).await;
                match next {
                    Some(next_delay) => delay = next_delay,
                    None => {
                        if spent {
                            note_reconnect_budget_exhausted(&state);
                        }
                        return;
                    }
                }
            }
        }
    }
}
