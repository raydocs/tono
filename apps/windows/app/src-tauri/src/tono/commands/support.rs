//! Local report preview; the existing schema-v1 upload endpoint is unchanged.

use crate::tono::state::{TonoInner, TonoState};
use serde::Serialize;
use std::{future::Future, sync::Arc, time::Instant};
use tauri::AppHandle;
use tono_core::auth::DiagnosticsReport;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSupportReport {
    pub preview_id: String,
    pub report: DiagnosticsReport,
}

fn context(inner: &TonoInner) -> (u64, u64, u64, i64, Option<String>) {
    (
        inner.sign_in_generation,
        inner.connect_generation,
        inner.controller_generation,
        inner.catalog_tracker.current_revision(),
        inner.selected_node.clone(),
    )
}

async fn prepare_with(
    state: &Arc<TonoState>,
    collect: impl Future<Output = DiagnosticsReport>,
) -> Result<PreparedSupportReport, String> {
    let (before, identity) = {
        let inner = state.lock().await;
        if inner.account_close.is_some() {
            return Err("TONO_DIAG_PREVIEW_EXPIRED".into());
        }
        (context(&inner), inner.client.diagnostics_log_identity().await)
    };
    let report = collect.await;
    let inner = state.lock().await;
    if inner.account_close.is_some()
        || context(&inner) != before
        || inner.client.diagnostics_log_identity().await != identity
    {
        return Err("TONO_DIAG_PREVIEW_EXPIRED".into());
    }
    let preview_id = state
        .support_reports
        .lock()
        .prepare((before.0, identity), report.clone(), Instant::now());
    Ok(PreparedSupportReport { preview_id, report })
}

#[tauri::command]
pub async fn tono_prepare_support_report(
    state: tauri::State<'_, Arc<TonoState>>,
    app: AppHandle,
) -> Result<PreparedSupportReport, String> {
    prepare_with(
        state.inner(),
        super::diagnostics::collect_diagnostics_report(state.inner(), &app),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn preview_rejects_account_replacement_during_collection_and_freezes_the_observed_payload() {
        let state = Arc::new(TonoState::for_test());
        let replacement = state.clone();
        let result = prepare_with(&state, async move {
            replacement.lock().await.sign_in_generation += 1;
            DiagnosticsReport {
                selected_server: Some("old route".into()),
                ..Default::default()
            }
        })
        .await;
        assert!(result.is_err());

        let report = DiagnosticsReport {
            selected_server: Some("reviewed route".into()),
            reported_at_ms: 19,
            ..Default::default()
        };
        let preview = prepare_with(&state, std::future::ready(report.clone())).await.unwrap();
        state.lock().await.selected_node = Some("new route after confirmation".into());
        let inner = state.lock().await;
        let owner = (inner.sign_in_generation, inner.client.diagnostics_log_identity().await);
        let frozen = state
            .support_reports
            .lock()
            .take(&preview.preview_id, owner, Instant::now())
            .unwrap();
        assert_eq!(frozen, report);
        assert_eq!(preview.report, report);
    }
}
