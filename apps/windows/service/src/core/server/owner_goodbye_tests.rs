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
