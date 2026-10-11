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

use crate::tono::{commands, state::TonoState};

/// Stable markers the UI maps to its own sentences.
pub(crate) const RESTORE_PARTIAL_PREFIX: &str = "TONO_RESTORE_PARTIAL";
pub(crate) const RESTORE_UNKNOWN_PREFIX: &str = "TONO_RESTORE_UNKNOWN";
pub(crate) const RESTORE_BUSY_PREFIX: &str = "TONO_RESTORE_BUSY";

/// `tono_restore_internet`.
pub async fn restore_internet(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use crate::core::service::{PreemptiveRelease, tono_restore_internet_preemptively};

        {
            let mut inner = state.lock().await;
            inner.client.transport().set_auth_tunnel_port(0);
            inner.invalidate_connection(true);
            inner.fsm.begin_disconnect();
            commands::emit_status(&app, &commands::status_of(&inner));
        }
        match tono_restore_internet_preemptively().await {
            PreemptiveRelease::Answered(report) => return settle(&state, &app, report).await,
            PreemptiveRelease::Unavailable(reason) => {
                logging!(
                    warn,
                    Type::Service,
                    "Tono: 解除服务不可用，改走普通释放: {reason}"
                );
            }
        }
    }
    super::disconnect(state, app).await
}

#[cfg(windows)]
async fn settle(
    state: &Arc<TonoState>,
    app: &AppHandle,
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
    commands::emit_status(app, &commands::status_of(&inner));
    drop(inner);
    if result.is_ok() {
        let _ = crate::core::sysopt::Sysopt::global().clear_owned_sysproxy().await;
    }
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
