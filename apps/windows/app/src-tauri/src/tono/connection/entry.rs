//! Connect entry points and the self-heal follow-up after a failed attempt.

use super::*;

pub(super) fn seed_autostart_after_connect() {
    AsyncHandler::spawn(|| async {
        autostart::enable_on_first_connect().await;
    });
}

/// `tono_connect`: guard, then the full §6 transaction; any failure after
/// arm keeps blocking and schedules the protected reconnect.
pub async fn connect(state: Arc<TonoState>, app: AppHandle) -> Result<(), String> {
    connect_for_generation(state, app, None).await
}

/// [`connect`] that refuses to start once the connection generation is no longer
/// `expected_generation`, re-checked under the lock that admits the attempt. Update recovery
/// passes the generation its restore captured, so a Restore internet in between wins.
pub(crate) async fn connect_for_generation(
    state: Arc<TonoState>, app: AppHandle, expected_generation: Option<u64>,
) -> Result<(), String> {
    connect_for_generation_tracked(state, app, expected_generation).await.map_err(|failure| failure.error)
}

/// The reconciled failure owner, including timeout's extra retirement. An unarmed recovery
/// caller must not infer ownership from a numeric generation delta.
pub(super) struct ConnectFailure {
    error: String,
    pub(super) retry_generation: Option<u64>,
}

pub(super) async fn connect_for_generation_tracked(
    state: Arc<TonoState>, app: AppHandle, expected_generation: Option<u64>,
) -> Result<(), ConnectFailure> {
    let refused = |error: String| ConnectFailure { error, retry_generation: expected_generation };
    {
        let mut inner = state.lock().await;
        match &inner.account_state {
            AccountState::Ready => {}
            AccountState::Suspended => return Err(refused("account is suspended".to_string())),
            _ => return Err(refused("not signed in".to_string())),
        }
        if let Some(refusal) = crate::tono::offline_grant::connect_refusal(&inner) {
            return Err(refused(refusal.to_string()));
        }
        if inner.fsm.status().is_connected {
            return Err(refused("already connected".to_string()));
        }
        if inner.fsm.status().is_connecting {
            return Err(refused("already connecting".to_string()));
        }
        if let Some(replacement) = catalog_sync::ensure_usable_selection(&mut inner) {
            logging!(
                info,
                Type::Service,
                "Tono: connect retargeted leftover selection onto catalog exit {replacement}"
            );
        }
    }
    match attempt_for_generation(&state, &app, expected_generation).await {
        Attempt::Connected => {
            {
                let mut inner = state.lock().await;
                heal::note_connected(&mut inner);
            }
            seed_autostart_after_connect();
            Ok(())
        }
        Attempt::GuardRejected(err) => Err(refused(err)),
        Attempt::Stale => Err(ConnectFailure {
            error: "connection superseded by a newer transition".to_string(), retry_generation: None,
        }),
        Attempt::Failed { generation, error, account_owner } => {
            let effect = {
                let mut inner = state.lock().await;
                heal::on_failure(&mut inner, &error)
            };
            let current = fail_connect(&state, &app, generation, error.clone(), account_owner).await;
            if current {
                match effect {
                    tono_core::heal::NetworkEffect::FailOpen { .. } => {
                        // `fail_connect` already owns the ordinary release. Releasing again
                        // here could tear down a successor admitted after it returned.
                        logging!(
                            warn,
                            Type::Service,
                            "Tono: self-heal stopped; restoring the original network without another tunnel"
                        );
                        // `fail_connect` already ran `release_explicit_applying_narrow_with_guard`
                        // for this FailOpen plan. A second release can tear down a successor
                        // admitted after it returned. The unarmed probe still belongs to that
                        // release: general traffic is back, and it must not open another tunnel.
                        unarmed_probe::spawn_after_release(&state, &app, generation);
                    }
                    tono_core::heal::NetworkEffect::SelectiveAiHold { .. } => {
                        logging!(
                            warn,
                            Type::Service,
                            "Tono: self-heal kept AI-service destinations blocked and did not restore the whole network"
                        );
                    }
                    tono_core::heal::NetworkEffect::HoldClosed => {
                        reconnect::schedule_reconnect_for_generation(&state, &app, generation).await;
                    }
                    _ => {}
                }
            }
            Err(ConnectFailure { error, retry_generation: current.then_some(generation) })
        }
    }
}
