import XCTest
@testable import Tono

/// TUN_ROUTE_UNAVAILABLE names the check that failed, hints at another VPN
/// only when one is detected, and re-arms the PF rules a bounded number of
/// times per connect attempt.
final class TunRouteUnavailableEvidenceTests: XCTestCase {
    private func origin(_ label: String, _ category: ProbeFailureCategory) -> ProbeOriginResult {
        ProbeOriginResult(
            label: label, url: "https://example.invalid/", expectedStatus: 204,
            actualStatus: nil, category: category, elapsedMs: 6000, detail: "x"
        )
    }

    private func decide(
        controller: ProbeCheck, tun: TUNCheck, mixed: ProbeCheck?
    ) -> ProtectedFailure? {
        guard case .retry(let failure) = ProtectedConnectivity.classifyPostLock(
            controller: controller, tun: tun, mixed: mixed
        ) else { return nil }
        return failure
    }

    func testEvidenceNamesTheTimedOutOriginsWhenControllerAndMixedAreFine() {
        let failure = decide(
            controller: .ok,
            tun: .failed([origin("Google", .timeout), origin("Cloudflare", .timeout), origin("Apple", .timeout)]),
            mixed: .ok
        )
        XCTAssertEqual(failure?.code, .tunRouteUnavailable)
        XCTAssertEqual(failure?.code.rawValue, "TUN_ROUTE_UNAVAILABLE")
        XCTAssertTrue(failure?.detail.hasPrefix(
            "TUN route check failed: tun probe lost 3/3 origins "
                + "(Google=timeout, Cloudflare=timeout, Apple=timeout); controller ok; mixed ok"
        ) == true, failure?.detail ?? "nil")
    }

    func testEvidenceDiffersForADnsAndTcpFailureWithAFailedController() {
        let failure = decide(
            controller: .failed("no answer"),
            tun: .failed([origin("Google", .dns), origin("Apple", .tcp)]),
            mixed: .ok
        )
        XCTAssertEqual(failure?.code, .tunRouteUnavailable)
        XCTAssertTrue(failure?.detail.hasPrefix(
            "TUN route check failed: tun probe lost 2/2 origins (Google=dns, Apple=tcp); "
                + "controller failed; mixed ok"
        ) == true, failure?.detail ?? "nil")
    }

    func testEvidenceWithoutPerOriginResultsAndWithoutMixedProbe() {
        let failure = decide(controller: .ok, tun: .failed([]), mixed: nil)
        XCTAssertEqual(failure?.code, .tunRouteUnavailable)
        XCTAssertTrue(failure?.detail.hasPrefix(
            "TUN route check failed: tun probe returned no per-origin result; controller ok; mixed not probed"
        ) == true, failure?.detail ?? "nil")
    }

    func testOtherCodesCarryNoTunRouteEvidence() {
        let failure = decide(
            controller: .failed("x"), tun: .failed([origin("Google", .timeout)]), mixed: .failed("y")
        )
        XCTAssertEqual(failure?.code, .coreExitUnreachable)
        XCTAssertEqual(failure?.detail.contains("TUN route check failed"), false)
    }

    func testOtherVPNHintOnlyWhenDetectionIsPositive() throws {
        typealias Interface = OtherVPNDetection.Interface
        let failure = try XCTUnwrap(decide(
            controller: .ok, tun: .failed([origin("Google", .timeout)]), mixed: .ok
        ))
        let plain = [
            Interface(name: "en0", isUp: true, hasRoutableAddress: true),
            Interface(name: "utun199", isUp: true, hasRoutableAddress: true),
        ]
        XCTAssertNil(OtherVPNDetection.attributedMessage(for: failure, interfaces: plain))
        XCTAssertEqual(
            OtherVPNDetection.attributedMessage(
                for: failure,
                interfaces: plain + [Interface(name: "utun5", isUp: true, hasRoutableAddress: true)]
            ),
            OtherVPNDetection.userMessage
        )
        XCTAssertEqual(
            failure.userMessage,
            ProtectedFailureCode.tunRouteUnavailable.userMessage,
            "the base sentence is unchanged"
        )
    }

    func testRearmBoundAllowsThreeAndRefusesTheFourth() {
        XCTAssertEqual(TunRouteRearmBound.maxRearmsPerAttempt, 3)
        XCTAssertTrue(TunRouteRearmBound.allows(priorRearms: 0))
        XCTAssertTrue(TunRouteRearmBound.allows(priorRearms: 1))
        XCTAssertTrue(TunRouteRearmBound.allows(priorRearms: 2))
        XCTAssertFalse(TunRouteRearmBound.allows(priorRearms: 3))
        XCTAssertFalse(TunRouteRearmBound.allows(priorRearms: 4))
    }

    func testRearmCountStartsAtZeroForEachConnectAttempt() {
        var first = AppState.CoreMonitorState()
        first.tunRouteRearmsThisAttempt = TunRouteRearmBound.maxRearmsPerAttempt
        XCTAssertFalse(TunRouteRearmBound.allows(priorRearms: first.tunRouteRearmsThisAttempt))
        let second = AppState.CoreMonitorState()
        XCTAssertEqual(second.tunRouteRearmsThisAttempt, 0)
        XCTAssertTrue(TunRouteRearmBound.allows(priorRearms: second.tunRouteRearmsThisAttempt))
    }
}
