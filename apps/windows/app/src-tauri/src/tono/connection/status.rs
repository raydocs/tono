//! Connect-stage UI/FSM updates. Does not own generation retirement.

use std::sync::Arc;

use tauri::AppHandle;
use tono_core::connection::ConnectStage;

use crate::tono::{audit::AuditEvent, commands, state::TonoState};
use super::failure::StageFailure;

pub(super) async fn set_stage(
    state: &Arc<TonoState>,
    app: &AppHandle,
    stage: ConnectStage,
    generation: u64,
    started: std::time::Instant,
) -> Result<(), StageFailure> {
    let fresh = {
        let mut inner = state.lock().await;
        if inner.connect_generation != generation {
            false
        } else {
            if inner.fsm.status().is_connecting {
                let completed = inner.fsm.status().stage.map(commands::stage_key);
                inner.fsm.advance_stage(stage);
                // F3: complete the previous step with its wall time and
                // mark the new one current. The uploaded stage is the one
                // that just finished; `delay_ms` is that step alone.
                let now = std::time::Instant::now();
                let elapsed = inner
                    .step_started_at
                    .map(|at| now.saturating_duration_since(at).as_millis() as u64)
                    .unwrap_or(0);
                crate::tono::steps::advance(&mut inner.connect_steps, stage, elapsed);
                inner.step_started_at = Some(now);
                commands::emit_status(app, &commands::status_of(&inner));
                if let Some(completed) = completed {
                    state.audit().log(AuditEvent::Stage {
                        stage: completed,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                        delay_ms: elapsed,
                    });
                }
            }
            true
        }
    };
    if fresh {
        return Ok(());
    }
    // Read/UI-only boundaries have no cleanup authority. Compensation belongs solely to the
    // detached mutation holding the lifecycle reader, before a replacement can be admitted.
    Err(StageFailure::Stale)
}

/// Upload the step that is current right now. `set_stage` only records a
/// step when the next one begins, so the last step (traffic verification)
/// would otherwise never appear.
pub(super) async fn log_current_stage_duration(
    state: &Arc<TonoState>,
    generation: u64,
    started: std::time::Instant,
) {
    let inner = state.lock().await;
    if inner.connect_generation != generation || !inner.fsm.status().is_connecting {
        return;
    }
    let Some(stage) = inner.fsm.status().stage else {
        return;
    };
    let delay_ms = inner
        .step_started_at
        .map(|at| at.elapsed().as_millis() as u64)
        .unwrap_or(0);
    state.audit().log(AuditEvent::Stage {
        stage: commands::stage_key(stage),
        elapsed_ms: started.elapsed().as_millis() as u64,
        delay_ms,
    });
}
