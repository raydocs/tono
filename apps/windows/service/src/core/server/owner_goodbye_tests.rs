use super::{owner_goodbye_verdict, service_error};
use crate::ServiceErrorCode;
use http::StatusCode;
use serial_test::serial;
use std::sync::atomic::Ordering;

/// The route literal is the contract the App's client posts to; a typo here silently breaks
/// the unprotected-quit stop.
#[test]
fn owner_goodbye_route_is_the_documented_literal() {
    assert_eq!(
        crate::IpcCommand::OwnerGoodbye.as_ref(),
        "/lifecycle/owner-goodbye"
    );
}

#[test]
fn bootstrap_pins_route_is_the_documented_literal() {
    assert_eq!(crate::IpcCommand::BootstrapPins.as_ref(), "/bootstrap-pins");
}

/// Goodbye is accepted only when the machine no longer needs the daemon: nothing armed and
/// the durable desired state proven "core should not be running".
#[test]
fn goodbye_is_accepted_only_when_the_daemon_is_idle() {
    assert!(owner_goodbye_verdict(false, Some(false), false).is_ok());
    for (wanted, desired) in [
        (true, Some(false)),
        (true, Some(true)),
        (true, None),
        (false, Some(true)),
        (false, None),
    ] {
        let error = owner_goodbye_verdict(wanted, desired, false)
            .expect_err("armed, desired-running, or desired-unreadable must refuse");
        assert_eq!(
            error.code,
            ServiceErrorCode::StillProtected,
            "wanted={wanted}, desired={desired:?}"
        );
    }
}

/// Every refusal maps to 409 Conflict, so the App can distinguish "the machine still needs
/// the daemon" from a transport failure and keep both best-effort at quit.
#[test]
fn goodbye_refusals_are_conflict() {
    let error =
        owner_goodbye_verdict(true, Some(false), false).expect_err("armed must refuse");
    let response = service_error(error).expect("refusals encode as responses");
    assert_eq!(response.status, StatusCode::CONFLICT);
}

/// #1293 item 2: one user's Quit must not stop the machine-wide Service while another user is
/// signed in; that user's idle App would need a UAC prompt to start it again.
#[test]
fn goodbye_is_refused_while_another_user_is_signed_in() {
    let error = owner_goodbye_verdict(false, Some(false), true)
        .expect_err("another signed-in user keeps the daemon alive");
    assert_eq!(error.code, ServiceErrorCode::StillProtected);
}

/// #1300: the stop that follows an accepted goodbye leaves the evidence the App needs to tell it
/// from a crash.
#[tokio::test]
#[serial]
async fn an_accepted_goodbye_leaves_the_clean_goodbye_record() {
    crate::clean_goodbye::clear().expect("clear");
    super::OWNER_GOODBYE_PENDING.store(true, Ordering::SeqCst);
    super::STOP_CLEANUP_COMPLETE.store(true, Ordering::SeqCst);
    super::note_clean_goodbye_if_accepted().await;
    let recorded = crate::clean_goodbye::recorded();
    super::OWNER_GOODBYE_PENDING.store(false, Ordering::SeqCst);
    super::STOP_CLEANUP_COMPLETE.store(false, Ordering::SeqCst);
    crate::clean_goodbye::clear().expect("clear");
    assert!(recorded, "a clean owner-goodbye stop must be provable to the next App launch");
}

/// Codex block on #1624: `stop_ipc_server` swallows a failed or timed-out cleanup, and `wanted`
/// and `live` read false when nothing is recorded in memory even while filters are installed. An
/// accepted goodbye whose teardown did not complete must leave no record.
#[tokio::test]
#[serial]
async fn an_accepted_goodbye_whose_teardown_did_not_complete_leaves_no_record() {
    crate::clean_goodbye::clear().expect("clear");
    super::OWNER_GOODBYE_PENDING.store(true, Ordering::SeqCst);
    super::STOP_CLEANUP_COMPLETE.store(false, Ordering::SeqCst);
    super::note_clean_goodbye_if_accepted().await;
    let recorded = crate::clean_goodbye::recorded();
    super::OWNER_GOODBYE_PENDING.store(false, Ordering::SeqCst);
    crate::clean_goodbye::clear().expect("clear");
    assert!(!recorded, "an unproven teardown is not a clean goodbye");
}

/// Codex re-review of #1624: the residual-filter query waits for the WFP lock, which a stuck
/// cleanup may still hold. An incomplete teardown or an armed kill switch already settles the
/// decision, so the query must not even start.
#[tokio::test]
#[serial]
async fn the_residual_query_does_not_start_when_the_decision_is_already_made() {
    use std::sync::atomic::AtomicBool;
    crate::clean_goodbye::clear().expect("clear");
    let idle = crate::core::windows_kill_switch::status().await;
    let mut wanted = idle.clone();
    wanted.wanted = true;
    for (complete, status) in [(false, idle), (true, wanted)] {
        let started = AtomicBool::new(false);
        super::note_clean_goodbye_with(
            complete,
            status,
            || async {
                started.store(true, Ordering::SeqCst);
                Ok(false)
            },
            std::time::Duration::from_secs(5),
        )
        .await;
        assert!(!started.load(Ordering::SeqCst), "the query must not start");
        assert!(!crate::clean_goodbye::recorded());
    }
}

/// A residual-filter query that never answers must not keep the stop from finishing, and a query
/// that did not answer in time is no evidence.
#[tokio::test]
#[serial]
async fn a_residual_query_that_never_answers_neither_hangs_the_stop_nor_records() {
    crate::clean_goodbye::clear().expect("clear");
    let idle = crate::core::windows_kill_switch::status().await;
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        super::note_clean_goodbye_with(
            true,
            idle,
            std::future::pending::<anyhow::Result<bool>>,
            std::time::Duration::from_millis(50),
        ),
    )
    .await
    .expect("the stop must not wait on a residual query beyond its budget");
    assert!(!crate::clean_goodbye::recorded());
}

#[test]
fn the_residual_query_spends_only_what_the_stop_budget_has_left() {
    use std::time::{Duration, Instant};
    let now = Instant::now();
    assert_eq!(super::residual_check_budget(Some(now + Duration::from_secs(40)), now), Duration::from_secs(40));
    assert_eq!(super::residual_check_budget(Some(now), now + Duration::from_secs(3)), Duration::ZERO);
    assert_eq!(super::residual_check_budget(None, now), Duration::from_secs(5));
}

/// The record needs every piece of evidence: a completed teardown, nothing wanted or live, and
/// the WFP engine itself reporting no Tono filter. An unanswered residual check is no evidence.
#[test]
fn the_clean_goodbye_record_needs_every_piece_of_evidence() {
    use super::clean_goodbye_evidence as evidence;
    assert!(evidence(true, false, false, Some(false)));
    assert!(!evidence(false, false, false, Some(false)), "teardown incomplete");
    assert!(!evidence(true, true, false, Some(false)), "kill switch wanted");
    assert!(!evidence(true, false, true, Some(false)), "filters live");
    assert!(!evidence(true, false, false, Some(true)), "residual filters present");
    assert!(!evidence(true, false, false, None), "residual check failed or could not run");
}

/// An SCM stop or a crash is not a goodbye: no record, so the App keeps treating the stopped
/// Service as possibly armed.
#[tokio::test]
#[serial]
async fn a_stop_without_an_accepted_goodbye_leaves_no_record() {
    crate::clean_goodbye::clear().expect("clear");
    super::OWNER_GOODBYE_PENDING.store(false, Ordering::SeqCst);
    super::note_clean_goodbye_if_accepted().await;
    let recorded = crate::clean_goodbye::recorded();
    assert!(!recorded, "only an accepted goodbye may write the record");
}
