import XCTest
@testable import Tono

/// Each branch here was written in response to a production fault, and until
/// this file none of them could be exercised without running the app and
/// waiting — the incident that produced the deferral logic took about
/// twenty-one minutes of connected time to reproduce once.
final class ManagedDirectRefreshPolicyTests: XCTestCase {
    private func inputs(
        loadBearing: Bool = true,
        recent: Bool = true,
        inFlight: Bool = false,
        deferrals: Int = 0,
        maximum: Int = 3
    ) -> ManagedDirectRefreshPolicy.Inputs {
        .init(
            pinsAreLoadBearing: loadBearing,
            routeUsedRecently: recent,
            hasInFlightProxiedStream: inFlight,
            deferralsSoFar: deferrals,
            maximumDeferrals: maximum
        )
    }

    /// The fix for the customer-visible incident. With suffix routes present,
    /// nothing reads a pinned address — routing matches on names, and answers
    /// come from China DoH — so applying a revision buys nothing and costs a
    /// reload plus a re-arm that flushes every PF state on the machine.
    func testPinsThatNothingReadsAreNotWorthAReload() {
        XCTAssertEqual(
            ManagedDirectRefreshPolicy.decide(inputs(loadBearing: false)),
            .skipPinsNotLoadBearing
        )
    }

    /// Precedence matters: this must win over every other reason, including a
    /// stream in flight, or a policy whose pins are decorative still schedules
    /// reloads forever.
    func testNotLoadBearingWinsOverEveryOtherReason() {
        XCTAssertEqual(
            ManagedDirectRefreshPolicy.decide(
                inputs(loadBearing: false, recent: true, inFlight: true, deferrals: 3)
            ),
            .skipPinsNotLoadBearing
        )
    }

    func testIdleRouteIsNotRefreshed() {
        XCTAssertEqual(
            ManagedDirectRefreshPolicy.decide(inputs(recent: false)),
            .skipRouteIdle
        )
    }

    func testInFlightStreamDefersRatherThanSevering() {
        XCTAssertEqual(
            ManagedDirectRefreshPolicy.decide(inputs(inFlight: true)),
            .deferForInFlightStream(deferral: 1)
        )
    }

    /// Deferral is bounded on purpose: a session that always has a stream in
    /// flight would otherwise never converge on current addresses.
    func testDeferralBudgetEventuallyForcesTheApply() {
        XCTAssertEqual(
            ManagedDirectRefreshPolicy.decide(inputs(inFlight: true, deferrals: 3)),
            .apply(forcedAfterDeferrals: 3)
        )
    }

    func testQuietSessionAppliesWithoutBeingForced() {
        XCTAssertEqual(
            ManagedDirectRefreshPolicy.decide(inputs()),
            .apply(forcedAfterDeferrals: 0)
        )
    }

    /// The counter must clear on the idle path too. Parked at the cap through an
    /// idle stretch, the first refresh after the route wakes up skips its
    /// deferral and reloads straight through a stream — the exact fault the
    /// deferral exists to prevent, delivered by the code preventing it.
    func testIdleSkipClearsTheDeferralCounter() {
        let decision = ManagedDirectRefreshPolicy.decide(
            inputs(recent: false, deferrals: 3)
        )
        XCTAssertEqual(ManagedDirectRefreshPolicy.deferralCount(after: decision), 0)
    }

    func testDeferralCarriesItsCountForward() {
        var deferrals = 0
        for expected in 1...3 {
            let decision = ManagedDirectRefreshPolicy.decide(
                inputs(inFlight: true, deferrals: deferrals)
            )
            XCTAssertEqual(decision, .deferForInFlightStream(deferral: expected))
            deferrals = ManagedDirectRefreshPolicy.deferralCount(after: decision)
        }
        // Budget spent: the next evaluation must proceed, and must record that
        // it interrupted something.
        let forced = ManagedDirectRefreshPolicy.decide(
            inputs(inFlight: true, deferrals: deferrals)
        )
        XCTAssertEqual(forced, .apply(forcedAfterDeferrals: 3))
        XCTAssertEqual(ManagedDirectRefreshPolicy.deferralCount(after: forced), 0)
    }

    /// A zero budget means the deferral is disabled, not that it defers forever.
    func testZeroBudgetAppliesImmediately() {
        XCTAssertEqual(
            ManagedDirectRefreshPolicy.decide(inputs(inFlight: true, maximum: 0)),
            .apply(forcedAfterDeferrals: 0)
        )
    }
}
