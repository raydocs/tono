import Foundation

/// Decision 093: what the sign-in screen may say about recovery. Each
/// sign-in request is one bounded operation: the control-plane walk
/// (`TonoAPIClient.exchangeOverPaths`, the relays alone without a tunnel,
/// decision 091) inside the client's own two-attempt retry. While it runs,
/// Tono is still trying by itself; once it has ended in a failure listed
/// here, nothing of it is scheduled any more and only the user's actions are
/// left (retry, another network, support). Derived from the request's own
/// end, never from copy, a timer or a retry count, and bound to the request
/// that started it. Protection is not part of it: nothing here reads or
/// changes the kill switch, and the background protection recovery never
/// writes it.
nonisolated struct SignInRecovery: Equatable, Sendable {
    /// The request the outcome belongs to.
    enum Step: String, Sendable {
        /// Asking for the code. A sent code is success; waiting for the
        /// email is not a failure.
        case sendCode
        /// Verifying the code (or a provider token), through adopting the
        /// session.
        case verifyCode
    }

    enum Phase: String, Sendable {
        /// The request is in flight; its own walk and retry may still run.
        case automatic
        /// The request ended in `cause`, and no attempt of it is scheduled:
        /// only the user can act now. Says nothing about later network
        /// changes.
        case userAction
    }

    /// Why the request ended, by allowlisted class only: no address, host
    /// or account value.
    enum Cause: String, Sendable {
        /// The walk tried every route it had, Tono's relays included, and
        /// none answered.
        case relaysUnreachable
        /// Any other way the request did not get an answer, including a
        /// request stopped early so that one which may have arrived is not
        /// sent twice.
        case network
        case clock
        case interception
        /// Tono answered with a server error or an answer the app cannot use.
        case service
    }

    /// This process's count of sign-in requests (and dismissals): a later
    /// request, a dismissal or a success replaces or clears the outcome.
    let operation: UInt64
    let step: Step
    let phase: Phase
    let cause: Cause?

    /// The class of a sign-in request's failure, after the client's bounded
    /// retry has run. nil for a success-like end or an answer the user acts
    /// on directly (a wrong code, a rate limit, a device limit, a refused or
    /// suspended account, a cancellation, a local Keychain failure with its
    /// own copy).
    static func cause(of error: any Error) -> Cause? {
        guard let error = error as? TonoAPIClient.APIError else { return nil }
        switch error {
        case let .unreachable(paths):
            return !paths.stoppedEarly && paths.attempts.contains { $0.path == "relay" }
                ? .relaysUnreachable : .network
        case .transport: return .network
        case .clockSkew: return .clock
        case .tlsIntercepted: return .interception
        case let .server(status, _): return status >= 500 ? .service : nil
        case .invalidResponse, .notFound, .exitIdentityPropagating, .invalidConfiguration,
             .identityProviderUnavailable:
            return .service
        case .unauthorized, .forbidden, .deviceLimit, .entitlementBlocked, .rateLimited,
             .invalidOrExpiredCode, .credentialPersistence, .credentialRecoveryRecord,
             .providerMailboxUnverified, .identityVerificationFailed:
            return nil
        }
    }
}

/// The current sign-in request's outcome, bound to the request.
nonisolated struct SignInRecoveryLedger: Equatable, Sendable {
    private(set) var operation: UInt64 = 0
    private(set) var current: SignInRecovery?

    /// A new sign-in request: any earlier outcome is gone, and a late end of
    /// an earlier request no longer lands. Returns the token its end must
    /// present.
    mutating func begin(_ step: SignInRecovery.Step) -> UInt64 {
        operation &+= 1
        current = SignInRecovery(operation: operation, step: step, phase: .automatic, cause: nil)
        return operation
    }

    /// The request `operation` ended: `cause` when it failed in a
    /// recovery-relevant way, nil otherwise. Only the current,
    /// still-automatic request lands; returns whether it did.
    @discardableResult
    mutating func finish(_ operation: UInt64, cause: SignInRecovery.Cause?) -> Bool {
        guard let current, current.operation == operation, current.phase == .automatic else {
            return false
        }
        self.current = cause.map {
            SignInRecovery(operation: operation, step: current.step, phase: .userAction, cause: $0)
        }
        return true
    }

    /// The user left this sign-in (another email, sign-out): clear, and
    /// retire any request still in flight so its end cannot bring the
    /// outcome back.
    mutating func dismiss() {
        operation &+= 1
        current = nil
    }
}
