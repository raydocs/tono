//! Connect-stage UI/FSM updates. Does not own generation retirement.

use std::sync::Arc;

use tauri::AppHandle;
use tono_core::connection::ConnectStage;

use crate::tono::{audit::AuditEvent, commands, state::TonoState};
use super::cleanup::stale_after_arm;
use super::failure::StageFailure;

pub(super) async fn set_stage(
    state: &Arc<TonoState>,
    app: &AppHandle,
    stage: ConnectStage,
    generation: u64,
    armed: bool,
    started: std::time::Instant,
) -> Result<(), StageFailure> {
    let fresh = {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            false
        } else {
            if inner.fsm.status().is_connecting {
                inner.fsm.advance_stage(stage);
                // F3: complete the previous step with its wall time and
                // mark the new one current.
                let now = std::time::Instant::now();
                let elapsed = inner
                    .step_started_at
                    .map(|at| now.saturating_duration_since(at).as_millis() as u64)
                    .unwrap_or(0);
                crate::tono::steps::advance(&mut inner.connect_steps, stage, elapsed);
                inner.step_started_at = Some(now);
                commands::emit_status(app, &commands::status_of(&inner));
                state.audit().log(AuditEvent::Stage {
                    stage: commands::stage_key(stage),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                });
            }
            true
        }
    };
    if fresh {
        return Ok(());
    }
    // `armed` marks stage boundaries past a committed StartClash: a stale
    // exit there patches the late arm (H-1).
    if armed {
        Err(stale_after_arm(state, generation).await)
    } else {
        Err(StageFailure::Stale)
    }
}
