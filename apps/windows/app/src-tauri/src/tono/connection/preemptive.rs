//! Restore internet through the release service (PROPOSAL §10 v5).
//!
//! The ordinary release waits for this App's in-flight connect work and runs inside the main
//! Service. Restore internet does neither: it retires every connection task, then asks the
//! separate release service, which ends the main Service and everything else that could write
//! the network state before it cleans up and reads each component back. The UI shows
//! "restored" only for a clean, settled read-back; anything else keeps the blocked state, says
//! why and keeps Restore available.

use std::sync::Arc;
use tauri::AppHandle;
use tono_logging::{Type, logging};

use crate::tono::{commands, state::{TonoInner, TonoState}};

/// Stable markers the UI maps to its own sentences.
pub(crate) const RESTORE_PARTIAL_PREFIX: &str = "TONO_RESTORE_PARTIAL";
pub(crate) const RESTORE_UNKNOWN_PREFIX: &str = "TONO_RESTORE_UNKNOWN";
pub(crate) const RESTORE_BUSY_PREFIX: &str = "TONO_RESTORE_BUSY";

/// `tono_restore_internet`.
pub async fn restore_internet(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use crate::core::service::{PreemptiveRelease, tono_restore_internet_preemptively};

        // From here no connect or reconnect task starts the Core until the user clicks Connect.
        // The ticket is this click's, taken before the first wait (Sol R3-F1 on PR #1569).
        let ticket = crate::core::service::raise_release_fence();
        {
            let mut inner = state.lock().await;
            if !begin_restore(&mut inner, &ticket) {
                logging!(info, Type::Service, "Tono: 恢复网络在开始前已被更新的操作取代，不再改动状态");
                return Ok(());
            }
            commands::emit_status(&app, &commands::status_of(&inner));
        }
        match tono_restore_internet_preemptively(ticket).await {
            PreemptiveRelease::Answered(report) => settle(&state, &app, ticket, report).await,
            PreemptiveRelease::Superseded => {
                logging!(info, Type::Service, "Tono: 恢复网络已被更新的操作取代，不再改动状态");
                Ok(())
            }
            PreemptiveRelease::Unavailable(reason) => {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: 解除服务不可用，改走普通释放: {reason}"
                );
                // Still this Restore's: refused once a newer Connect or Restore has begun.
                super::disconnect_for_restore(state, app, ticket).await
            }
        }
    }
    #[cfg(not(windows))]
    {
        super::disconnect(state, app).await
    }
}

/// Restore's first change: retire every connection task and begin the disconnect, but only while
/// `ticket` still owns the release epoch, checked under the state lock that admits attempts and
/// orders the user's Connect claim (Sol R3-F1). A Restore that waited for the lock while a newer
/// Restore or Connect began cancels nothing and leaves the FSM alone. `false`: superseded.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn begin_restore(inner: &mut TonoInner, ticket: &crate::core::service::ReleaseTicket) -> bool {
    if !crate::core::service::release_ticket_current(ticket) {
        return false;
    }
    inner.client.transport().set_auth_tunnel_port(0);
    inner.invalidate_connection(true);
    inner.fsm.begin_disconnect();
    true
}

/// Publish the answer, but only for the Restore that still owns the release epoch, checked
/// under the state lock that admits attempts (Sol R2-F4). An older Restore's answer arriving
/// after the user clicked Connect or Restore again leaves the newer operation's runtime,
/// protection and UI untouched.
#[cfg(windows)]
async fn settle(
    state: &Arc<TonoState>,
    app: &AppHandle,
    ticket: crate::core::service::ReleaseTicket,
    report: tono_service_protocol::release_wire::ReleaseReport,
) -> Result<(), String> {
    logging!(
        info,
        Type::Service,
        "Tono: 恢复网络结果 {} (finished={}, components={:?}, stuck={:?}, detail={:?})",
        report.outcome,
        report.finished,
        report
            .components
            .iter()
            .map(|component| format!("{}={}/{}", component.name, component.readback, component.risk))
            .collect::<Vec<_>>(),
        report.stuck,
        report.detail
    );
    let mut inner = state.lock().await;
    if !crate::core::service::release_ticket_current(&ticket) {
        logging!(info, Type::Service, "Tono: 旧的恢复网络结果已被更新的操作取代，不再改动状态");
        return Ok(());
    }
    let result = if report.outcome == "restored" {
        inner.fsm.sign_out_or_quit();
        inner.kill_switch = None;
        inner.controller_secret = None;
        inner.controller_port = None;
        inner.network_events_counter = None;
        inner.last_core_pid = None;
        inner.last_restart_count = None;
        inner.connected_at = None;
        inner.retry_attempt = 0;
        inner.next_retry_at_ms = None;
        Ok(())
    } else {
        // Not proven restored: keep the blocked state so Restore stays offered, and drop the
        // cached reading — the main Service that produced it is gone.
        inner.kill_switch = None;
        inner.fsm.mark_kill_switch_armed();
        inner.fsm.initial_release_failed();
        Err(restore_failure(&report))
    };
    // Still under the state lock: a Connect begun after the check above cannot set its own proxy
    // before this clears the old one.
    if result.is_ok() {
        let _ = crate::core::sysopt::Sysopt::global().clear_owned_sysproxy().await;
    }
    commands::emit_status(app, &commands::status_of(&inner));
    drop(inner);
    result
}

/// The sentence behind each outcome that is not `restored`. The components named are the ones
/// whose read-back still shows Tono, or that could not be read or settled.
#[cfg(windows)]
fn restore_failure(report: &tono_service_protocol::release_wire::ReleaseReport) -> String {
    let open = report
        .components
        .iter()
        .filter(|component| component.readback != "restored" || component.risk != "settled")
        .map(|component| format!("{} {}/{}", component.name, component.readback, component.risk))
        .collect::<Vec<_>>()
        .join(", ");
    let prefix = match report.outcome.as_str() {
        "partial" => RESTORE_PARTIAL_PREFIX,
        "busy" => RESTORE_BUSY_PREFIX,
        "refused" => super::PROTECTION_HELD_BY_ANOTHER_USER_PREFIX,
        _ => RESTORE_UNKNOWN_PREFIX,
    };
    format!(
        "{prefix}: outcome {} (finished {}); open: [{open}]; stuck: {:?}; {}",
        report.outcome,
        report.finished,
        report.stuck,
        report.detail.as_deref().unwrap_or("")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sol R3-F1 (a) on PR #1569: Restore R1 takes its ticket and waits for the state lock; a
    /// newer Connect claims the epoch and is admitted first. When R1 resumes it must not cancel,
    /// retire or move anything the newer Connect owns.
    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn a_restore_overtaken_before_its_first_change_leaves_the_newer_connect_alone() {
        let _epoch = crate::core::service::RELEASE_EPOCH_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let state = Arc::new(TonoState::for_test());
        // R1's click: the ticket is taken before the state lock.
        let restore = crate::core::service::raise_release_fence();
        let mut inner = state.lock().await;
        // The newer Connect: claimed under the state lock, generation read, attempt admitted.
        let claim = super::super::entry::claim_user_connect(&inner).unwrap();
        assert!(crate::core::service::finish_user_connect(&claim, Some(0x5EED_0A01)));
        let current = inner.connect_generation;
        let (generation, cancellation, _) = super::super::begin_attempt(&mut inner, current).await.unwrap();
        let ticket = inner.release_ticket;
        // R1 resumes with the lock.
        assert!(!begin_restore(&mut inner, &restore));
        assert_eq!(inner.connect_generation, generation);
        assert!(!cancellation.is_cancelled());
        assert!(inner.fsm.status().is_connecting);
        assert!(!inner.fsm.status().is_disconnecting);
        assert_eq!(inner.release_ticket, ticket);
        assert!(crate::core::service::release_ticket_current(&ticket));
    }
}
