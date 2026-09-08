use super::{owner_goodbye_verdict, service_error};
use crate::ServiceErrorCode;
use http::StatusCode;

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
    assert!(owner_goodbye_verdict(false, Some(false)).is_ok());
    for (wanted, desired) in [
        (true, Some(false)),
        (true, Some(true)),
        (true, None),
        (false, Some(true)),
        (false, None),
    ] {
        let error = owner_goodbye_verdict(wanted, desired)
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
        owner_goodbye_verdict(true, Some(false)).expect_err("armed must refuse");
    let response = service_error(error).expect("refusals encode as responses");
    assert_eq!(response.status, StatusCode::CONFLICT);
}
