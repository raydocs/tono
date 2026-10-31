import XCTest
@testable import TonoKit

final class ConnectionStateTests: XCTestCase {
    /// What the tunnel confirmed it runs; the probe tests below start from a confirmed graph.
    private let confirmed = RoutingConfirmation.graph(RouteSettings(mode: .threeTier, node: "tokyo-1"))

    func testTunnelUpWithChecksPendingStillReadsConnecting() {
        let f = ConnectionFacts(signedIn: true, tunnel: .connected, cloudProbe: ExitProbe(state: .checking), homeProbe: ExitProbe(state: .checking),
                                routing: confirmed)
        XCTAssertEqual(ConnectionState.derive(f).phase, .connecting)
    }

    func testCloudCheckFailureIsDegradedWithTheOtherLineAction() {
        let f = ConnectionFacts(signedIn: true, tunnel: .connected, cloudProbe: ExitProbe(state: .failed), homeProbe: ExitProbe(state: .ok),
                                routing: confirmed)
        let (phase, reason) = ConnectionState.derive(f)
        XCTAssertEqual(phase, .degraded)
        XCTAssertEqual(reason, "CLOUD_UNREACHABLE")
        XCTAssertEqual(BannerAction.forPhase(phase, reason: reason), .otherLine)
    }

    func testHomeCheckFailureIsDegradedNotDisconnected() {
        let f = ConnectionFacts(signedIn: true, tunnel: .connected, cloudProbe: ExitProbe(state: .ok, location: "JP"), homeProbe: ExitProbe(state: .failed),
                                routing: confirmed)
        XCTAssertEqual(ConnectionState.derive(f).phase, .degraded)
        XCTAssertEqual(ConnectionState.derive(f).reason, "HOME_UNREACHABLE")
        XCTAssertEqual(SkyState(.degraded), .duskWarning)
    }

    func testStoppedTunnelWithAFailureIsFailedWithRetry() {
        let f = ConnectionFacts(signedIn: true, tunnel: .disconnected, failure: "CORE_START")
        XCTAssertEqual(ConnectionState.derive(f).phase, .failed)
        XCTAssertEqual(BannerAction.forPhase(.failed, reason: "CORE_START"), .retry)
    }

    func testReassertingReadsAsConnectingNotConnected() {
        let (phase, reason) = ConnectionState.derive(ConnectionFacts(signedIn: true, tunnel: .reasserting))
        XCTAssertEqual(phase, .connecting)
        XCTAssertEqual(reason, "NETWORK_CHANGED")
    }

    func testNetworkChangeSunSitsBelowAPartlyWorkingTunnel() {
        let held = SkyState(.connecting, reason: "NETWORK_CHANGED")
        XCTAssertEqual(held, .reconnecting)
        // Nothing is confirmed while iOS reasserts: no brighter than a tunnel that is up but partly failing.
        XCTAssertLessThan(held.sunRise, SkyState(.degraded).sunRise)
        XCTAssertLessThan(held.sunRise, SkyState(.connected).sunRise)
    }

    func testConnectedStatusClaimsTheWholePhoneOnlyForARunningStableGraph() {
        XCTAssertEqual(ConnectedStatusKey.key(runningMode: .stable, home: false), "status_protected")
        XCTAssertEqual(ConnectedStatusKey.key(runningMode: .threeTier, home: false), "status_split")
        XCTAssertEqual(ConnectedStatusKey.key(runningMode: .threeTier, home: true), "status_split_home")
        XCTAssertEqual(ConnectedStatusKey.key(runningMode: nil, home: false), "status_split")
    }

    func testEndedSessionShowsSignInWithItsReason() {
        let (phase, reason) = ConnectionState.derive(ConnectionFacts(signedIn: false, tunnel: .disconnected, failure: "SESSION_ENDED"))
        XCTAssertEqual(phase, .signedOut)
        XCTAssertEqual(reason, "SESSION_ENDED")
    }

    func testTraceLocationAndFormatting() {
        XCTAssertEqual(Probes.location(fromTrace: "fl=1\nip=1.2.3.4\nloc=JP\ncolo=NRT\n"), "JP")
        XCTAssertNil(Probes.location(fromTrace: "loc=jp\n"))
        XCTAssertEqual(Format.rate(2_290_000), "2.29 MB/s")
        XCTAssertEqual(Format.rate(313_400), "313 KB/s")
        XCTAssertEqual(Format.city("Los Angeles", chinese: true), "洛杉矶")
        XCTAssertEqual(LatencyLevel(199), .good)
        XCTAssertEqual(LatencyLevel(400), .verySlow)
    }

    func testJWTExpiry() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertTrue(JWT.expiringSoon(jwt(exp: now.timeIntervalSince1970 + 299), now: now))
        XCTAssertFalse(JWT.expiringSoon(jwt(exp: now.timeIntervalSince1970 + 3_600), now: now))
        XCTAssertTrue(JWT.expiringSoon("garbage", now: now))
    }
}

final class TunnelStopTests: XCTestCase {
    /// A start the user asked for that dies before connecting must stop On Demand from looping;
    /// a running tunnel the system kills must keep On Demand so traffic stays held.
    func testUserStartFailureIsNotTreatedLikeASystemStop() {
        XCTAssertEqual(TunnelStop.classify(before: .connecting, userStarting: true, userStopping: false, recordedFailure: "NO_INPUTS"),
                       .startFailed("NO_INPUTS"))
        XCTAssertEqual(TunnelStop.classify(before: .connected, userStarting: false, userStopping: false, recordedFailure: nil),
                       .stoppedBySystem("CORE_STOPPED"))
        XCTAssertEqual(TunnelStop.classify(before: .connected, userStarting: false, userStopping: true, recordedFailure: "CORE_STOPPED"),
                       .expected)
    }
}

final class PrimaryActionTests: XCTestCase {
    /// While a start is in flight the capsule must cancel it (never offer "connect" twice), and a
    /// running tunnel offers only disconnect: one action per phase, as on Android and desktop.
    func testInFlightStartOffersCancelAndRunningTunnelOffersDisconnect() {
        XCTAssertEqual(PrimaryAction(.preparing), .cancel)
        XCTAssertEqual(PrimaryAction(.connecting).wantsTunnel, false)
        XCTAssertEqual(PrimaryAction(.degraded), .disconnect)
        XCTAssertNil(PrimaryAction(.disconnecting).wantsTunnel)
        XCTAssertEqual(PrimaryAction(.failed).wantsTunnel, true)
    }

    func testHapticsOnlyForAStartReachingConnectedOrFailing() {
        XCTAssertEqual(HapticCue.forChange(from: .connecting, to: .connected), .success)
        XCTAssertNil(HapticCue.forChange(from: .degraded, to: .connected))
        XCTAssertEqual(HapticCue.forChange(from: .connected, to: .failed), .error)
        XCTAssertNil(HapticCue.forChange(from: .connected, to: .degraded))
        XCTAssertNil(HapticCue.forChange(from: nil, to: .connected))
    }
}
