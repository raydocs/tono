import Foundation

/// Whether a freshly resolved policy revision may be applied to a live session,
/// and if not, why.
///
/// This decision used to exist only as a chain of guards inside a 5,500-line
/// `@MainActor` type, reachable solely by running the app and waiting. Every
/// branch in it was written in response to a production fault, and none of them
/// could be exercised by a test: the customer-visible incident of 2026-08-11
/// took roughly twenty-one minutes of connected time to reproduce once.
///
/// Extracted as values rather than as an extension, deliberately. An extension
/// in another file would have needed `configReloadTask` and `activeDirectPolicy`
/// widened to module-internal, and those are exactly the properties whose
/// ordering invariants that incident turned on. Passing the decision its inputs
/// costs one call site and keeps that state private.
nonisolated enum ManagedDirectRefreshPolicy {
    /// Applying a revision reloads the runtime and re-arms PF. Re-arming flushes
    /// every state on the machine when it withdraws a pass rule, so "apply" is
    /// never free, and the reasons to decline are as load-bearing as the reason
    /// to proceed.
    enum Decision: Equatable {
        /// Routing does not read pinned addresses, so a stale pin costs a
        /// redundant rule rather than a route.
        case skipPinsNotLoadBearing
        /// Nothing has used the direct path recently, so freshness buys nothing.
        case skipRouteIdle
        /// A proxied stream is in flight and would be severed. Deferrable only a
        /// bounded number of times, or a busy session would never converge.
        case deferForInFlightStream(deferral: Int)
        /// Proceed. `forcedAfterDeferrals` is non-zero when the deferral budget
        /// ran out, which is worth recording: it is the one path that knowingly
        /// interrupts a stream.
        case apply(forcedAfterDeferrals: Int)
    }

    struct Inputs: Equatable {
        /// True only when no suffix route covers these hosts. With suffix routes
        /// present, routing matches on names and resolves through China DoH, and
        /// neither reads a pin — so refreshing addresses changes nothing a packet
        /// can observe while still costing a reload.
        var pinsAreLoadBearing: Bool
        var routeUsedRecently: Bool
        var hasInFlightProxiedStream: Bool
        var deferralsSoFar: Int
        var maximumDeferrals: Int
    }

    static func decide(_ inputs: Inputs) -> Decision {
        guard inputs.pinsAreLoadBearing else { return .skipPinsNotLoadBearing }
        guard inputs.routeUsedRecently else { return .skipRouteIdle }
        if inputs.hasInFlightProxiedStream,
           inputs.deferralsSoFar < inputs.maximumDeferrals {
            return .deferForInFlightStream(deferral: inputs.deferralsSoFar + 1)
        }
        return .apply(forcedAfterDeferrals: inputs.deferralsSoFar)
    }

    /// The counter must be cleared on every outcome except a deferral, including
    /// the idle one. Left parked at the cap through an idle stretch, the first
    /// refresh after the route wakes up skips its deferral and reloads straight
    /// through a stream — which is the shape of the fault the deferral exists to
    /// prevent, arriving by way of the code that was supposed to prevent it.
    static func deferralCount(after decision: Decision) -> Int {
        switch decision {
        case .deferForInFlightStream(let deferral): return deferral
        case .skipPinsNotLoadBearing, .skipRouteIdle, .apply: return 0
        }
    }
}
