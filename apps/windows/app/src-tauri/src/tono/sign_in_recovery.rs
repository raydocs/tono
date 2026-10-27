//! Decision 093: what the sign-in screen may say about recovery. Each sign-in request is one
//! bounded operation: its path walk (the relays alone without a tunnel, decision 091) and the
//! client's single transport retry. While it runs, Tono is still trying by itself; once it has
//! ended in a failure listed here, nothing of it is scheduled any more and only the user's
//! actions are left (retry, another network, support). Derived from the request's own end,
//! never from copy, a timer or a retry count, and bound to the request that started it.
//!
//! Protection is not part of it: recording or clearing an outcome never touches the kill
//! switch, and the background protection recovery never writes here.

use serde::Serialize;
use tono_core::{
    auth::ApiError,
    customer_failure::{CustomerFailureCode, classify_auth_transport},
};

/// The request the outcome belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SignInStep {
    /// `auth/email/start`: asking for the code. A sent code is success; waiting for the email
    /// is not a failure.
    SendCode,
    /// `auth/email/verify`, through adopting the session.
    VerifyCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SignInRecoveryPhase {
    /// The request is in flight; its own walk and retry may still run.
    Automatic,
    /// The request ended in a failure below, and no attempt of it is scheduled: only the user
    /// can act now. Says nothing about later network changes.
    UserAction,
}

/// Why the request ended, by allowlisted class only: no address, host or account value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SignInFailureCause {
    /// Every relay the walk could use was tried and none answered.
    RelaysUnreachable,
    /// Any other way the request did not get an answer, including a request stopped early so
    /// that one which may have arrived is not sent twice.
    Network,
    Clock,
    Interception,
    Captive,
    LocalConflict,
    /// Tono answered with a server error or an answer the client cannot use.
    Service,
    /// The local credential store failed.
    LocalStore,
}

/// `TonoStatus.signInRecovery`. `operation` is this process's count of sign-in requests (and
/// dismissals): a later request, a dismissal or a success replaces or clears the outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInRecovery {
    pub operation: u64,
    pub step: SignInStep,
    pub phase: SignInRecoveryPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<SignInFailureCause>,
}

#[derive(Debug, Default)]
pub struct SignInRecoveryLedger {
    operation: u64,
    current: Option<SignInRecovery>,
}

impl SignInRecoveryLedger {
    /// A new sign-in request: any earlier outcome is gone, and a late end of an earlier request
    /// no longer lands. Returns the token its end must present.
    pub fn begin(&mut self, step: SignInStep) -> u64 {
        self.operation = self.operation.wrapping_add(1);
        self.current = Some(SignInRecovery {
            operation: self.operation,
            step,
            phase: SignInRecoveryPhase::Automatic,
            cause: None,
        });
        self.operation
    }

    /// The request `operation` ended: `cause` when it failed in a recovery-relevant way, `None`
    /// on success or an answer the user acts on directly (a wrong code, a rate limit, a device
    /// limit, a refused account). Only the current, still-automatic request may land; returns
    /// whether it did.
    pub fn finish(&mut self, operation: u64, cause: Option<SignInFailureCause>) -> bool {
        let Some(current) = self.current.filter(|current| {
            current.operation == operation && current.phase == SignInRecoveryPhase::Automatic
        }) else {
            return false;
        };
        self.current = cause.map(|cause| SignInRecovery {
            phase: SignInRecoveryPhase::UserAction,
            cause: Some(cause),
            ..current
        });
        true
    }

    /// The user left this sign-in (another email, sign-out): clear, and retire any request
    /// still in flight so its end cannot bring the outcome back.
    pub fn dismiss(&mut self) {
        self.operation = self.operation.wrapping_add(1);
        self.current = None;
    }

    pub fn current(&self) -> Option<SignInRecovery> {
        self.current
    }
}

/// The class of a sign-in request's failure, after the client's bounded retry has run.
pub fn cause_of(err: &ApiError) -> Option<SignInFailureCause> {
    match err {
        ApiError::Transport { kind, message } => Some(match classify_auth_transport(*kind, message) {
            CustomerFailureCode::AuthClock => SignInFailureCause::Clock,
            CustomerFailureCode::AuthCaptive => SignInFailureCause::Captive,
            CustomerFailureCode::AuthTlsIntercepted => SignInFailureCause::Interception,
            CustomerFailureCode::AuthLocalConflict => SignInFailureCause::LocalConflict,
            // The walk's own marker (decision 091): it starts the message, ahead of any path
            // a walk that began with a tunnel had already lost.
            _ if message.starts_with(crate::tono::transport::RELAYS_UNREACHABLE) => {
                SignInFailureCause::RelaysUnreachable
            }
            _ => SignInFailureCause::Network,
        }),
        ApiError::Server { .. }
            if tono_core::auth_support_prefix(err) == CustomerFailureCode::AuthCaptive.as_str() =>
        {
            Some(SignInFailureCause::Captive)
        }
        ApiError::Server { .. }
        | ApiError::InvalidResponse
        | ApiError::NotFound
        | ApiError::ExitIdentityPropagating
        | ApiError::InvalidConfiguration => Some(SignInFailureCause::Service),
        ApiError::Credentials(_) => Some(SignInFailureCause::LocalStore),
        ApiError::InvalidInput(_)
        | ApiError::Unauthorized
        | ApiError::InvalidOrExpiredCode
        | ApiError::Forbidden
        | ApiError::PlanInactive(_)
        | ApiError::DeviceLimit
        | ApiError::RateLimited { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tono_core::auth::TransportKind;

    fn relays_unreachable() -> ApiError {
        ApiError::Transport {
            kind: TransportKind::Timeout,
            message: format!(
                "{}: relay 1 (192.0.2.1:2053) timeout: t; relay 2 (192.0.2.2:2053) connect: c; relay 3 (192.0.2.3:2053) tls: x",
                crate::tono::transport::RELAYS_UNREACHABLE
            ),
        }
    }

    /// Every relay failed: the request ends with only user actions left, as relays-unreachable.
    #[test]
    fn a_request_whose_relays_all_failed_ends_for_the_user_to_act() {
        let mut ledger = SignInRecoveryLedger::default();
        let operation = ledger.begin(SignInStep::SendCode);
        assert_eq!(ledger.current().unwrap().phase, SignInRecoveryPhase::Automatic);
        assert!(ledger.finish(operation, cause_of(&relays_unreachable())));
        let outcome = ledger.current().unwrap();
        assert_eq!(outcome.phase, SignInRecoveryPhase::UserAction);
        assert_eq!(outcome.cause, Some(SignInFailureCause::RelaysUnreachable));
        assert_eq!(outcome.step, SignInStep::SendCode);
    }

    /// A retry that succeeds clears the earlier outcome: sending the code is not a failure,
    /// and waiting for the email is not exhaustion.
    #[test]
    fn a_successful_retry_clears_the_earlier_outcome() {
        let mut ledger = SignInRecoveryLedger::default();
        let failed = ledger.begin(SignInStep::SendCode);
        ledger.finish(failed, cause_of(&relays_unreachable()));
        let retry = ledger.begin(SignInStep::SendCode);
        assert_eq!(ledger.current().unwrap().phase, SignInRecoveryPhase::Automatic);
        assert!(ledger.finish(retry, None));
        assert_eq!(ledger.current(), None);
    }

    /// The end of a request a newer one or a dismissal replaced does not land.
    #[test]
    fn an_older_request_ending_late_does_not_land() {
        let mut ledger = SignInRecoveryLedger::default();
        let older = ledger.begin(SignInStep::SendCode);
        let newer = ledger.begin(SignInStep::SendCode);
        assert!(!ledger.finish(older, cause_of(&relays_unreachable())));
        assert_eq!(ledger.current().unwrap().operation, newer);
        assert_eq!(ledger.current().unwrap().phase, SignInRecoveryPhase::Automatic);

        ledger.dismiss();
        assert!(!ledger.finish(newer, cause_of(&relays_unreachable())));
        assert_eq!(ledger.current(), None);
    }
}
