import Foundation

/// No control-plane path answered: which paths a request tried, how each one
/// failed, and what the user can do about it. Built from the walk's own
/// errors (`TonoAPIClient.exchangeOverPaths`), never from their localized
/// text, so the copy is the same whatever language the system speaks.
/// Labels and failure classes only: no address, host or account value.
nonisolated struct ControlPlaneUnreachable: Equatable, Sendable {
    nonisolated struct Attempt: Equatable, Sendable {
        /// The path label (`system_dns`, `pinned`, `relay`).
        let path: String
        /// `ControlPlanePathTimeline.failureClass`: `dns`, `connect`, `tls`,
        /// `timeout` or `other`.
        let failure: String
    }

    /// The paths that ran, in order.
    let attempts: [Attempt]
    /// Paths left untried because the request may already have arrived and
    /// is never sent twice.
    let stoppedEarly: Bool
    /// Every path's own failure text (`system_dns[...]; pinned[...]`), for
    /// the audit log and support.
    let detail: String

    /// `userInfo` keys the walk sets on the error it throws.
    static let attemptsKey = "TonoControlPlaneAttempts"
    static let stoppedEarlyKey = "TonoControlPlaneStoppedEarly"

    /// The walk's evidence on `error`, or nil when it carries none (a client
    /// with one path, or a failure that is not the walk's).
    init?(_ error: any Error) {
        let failure = error as NSError
        guard let attempts = failure.userInfo[Self.attemptsKey] as? [Attempt], !attempts.isEmpty else {
            return nil
        }
        self.attempts = attempts
        stoppedEarly = failure.userInfo[Self.stoppedEarlyKey] as? Bool ?? false
        detail = failure.localizedDescription
    }

    init(attempts: [Attempt], stoppedEarly: Bool, detail: String) {
        self.attempts = attempts
        self.stoppedEarly = stoppedEarly
        self.detail = detail
    }

    /// What the sign-in screen and the account error say: where it failed
    /// first, then each route as tried, then what to do.
    var userMessage: String { message(protection: .none) }

    /// What the account gate knows about a fail-closed barrier without a
    /// tunnel: none, one a verdict or live session holds, or a stored intent
    /// no helper answer has confirmed.
    nonisolated enum ProtectionHold: Sendable, Equatable {
        case none, blocking, unconfirmed
    }

    /// `userMessage`, or, while a fail-closed barrier without a tunnel holds
    /// this Mac (the account gate offers Restore internet), the same failure
    /// with what that barrier means for signing in: PF lets only Tono's
    /// fixed addresses through, so the relays and every other route are
    /// blocked, and signing in on this network needs protection off. Tono
    /// never turns it off by itself; the user chooses Restore internet. An
    /// unconfirmed barrier is worded as one that may still be on.
    func message(protection: ProtectionHold) -> String {
        let closing: String
        switch protection {
        case .none: closing = hint
        case .blocking: closing = Self.protectedHint
        case .unconfirmed: closing = Self.unconfirmedProtectedHint
        }
        return [headline, triedSentence, closing].joined(separator: " ")
    }

    static var unconfirmedProtectedHint: String {
        String(localized: "Protection may still be on from an earlier session. If it is, it lets only Tono's fixed addresses through, so Tono's relays and every other route are blocked on this Mac. To sign in on this network, turn protection off with Restore internet: this Mac then uses its normal internet, unprotected, until you connect again. Tono does not turn protection off by itself.")
    }

    static var protectedHint: String {
        String(localized: "Protection is on and lets only Tono's fixed addresses through, so Tono's relays and every other route are blocked on this Mac. To sign in on this network, turn protection off with Restore internet: this Mac then uses its normal internet, unprotected, until you connect again. Tono does not turn protection off by itself.")
    }

    var headline: String {
        if stoppedEarly {
            // Only a timeout may mean the request arrived and its answer is
            // late; any other early stop broke the exchange off.
            if attempts.last?.failure == "timeout" {
                return String(localized: "Tono's service did not answer in time. This request was not sent again on another route, in case it already arrived.")
            }
            return String(localized: "The connection was interrupted before Tono got an answer. This request was not sent again on another route, in case it already arrived.")
        }
        if attempts.contains(where: { $0.path == "relay" }) {
            return String(localized: "Tono could not reach its service on any route, Tono's relays included.")
        }
        return String(localized: "Tono could not reach its service on any route.")
    }

    var triedSentence: String {
        let routes = attempts.map { attempt in
            let route = Self.routeName(attempt.path)
            let failure = Self.failureName(attempt.failure)
            return String(localized: "\(route) (\(failure))")
        }
        let list = ListFormatter.localizedString(byJoining: routes)
        return String(localized: "Tried: \(list).")
    }

    var hint: String {
        if stoppedEarly {
            return String(localized: "Retry in a moment. If it keeps failing, try another network, for example a phone hotspot.")
        }
        if attempts.first(where: { $0.path == "system_dns" })?.failure == "dns" {
            return String(localized: "This network's DNS did not return Tono's address. Try another network, for example a phone hotspot, then retry. For help, select this text and send it to Tono support.")
        }
        return String(localized: "Try another network, for example a phone hotspot, then retry. For help, select this text and send it to Tono support.")
    }

    static func routeName(_ path: String) -> String {
        switch path {
        case "system_dns": String(localized: "direct connection")
        case "pinned": String(localized: "Tono's fixed addresses")
        case "relay": String(localized: "Tono's relays")
        default: path
        }
    }

    static func failureName(_ failure: String) -> String {
        switch failure {
        case "dns": String(localized: "name lookup failed")
        case "connect": String(localized: "no connection")
        case "tls": String(localized: "secure connection failed")
        case "timeout": String(localized: "timed out")
        default: String(localized: "failed")
        }
    }
}
