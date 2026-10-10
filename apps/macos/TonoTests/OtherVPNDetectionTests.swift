import XCTest
@testable import Tono

/// H21-O-F7: another VPN's tunnel is named on a tunnel-class connect failure.
final class OtherVPNDetectionTests: XCTestCase {
    func testAnUpForeignTunnelNamesTheOtherVPNOnATunnelFailureOnly() {
        typealias Interface = OtherVPNDetection.Interface
        let ordinary = [
            Interface(name: "en0", isUp: true, hasRoutableAddress: true),
            Interface(name: "utun199", isUp: true, hasRoutableAddress: true),
            Interface(name: "utun0", isUp: true, hasRoutableAddress: false),
            Interface(name: "utun3", isUp: false, hasRoutableAddress: true),
            Interface(name: "ppp0", isUp: true, hasRoutableAddress: true),
        ]
        let tunnelFailure = ProtectedConnectivity.failure(
            .tunRouteUnavailable, stage: "verifyingTraffic", attempt: 1, generation: 1,
            detail: "controller succeeded; real TUN failed"
        )
        XCTAssertNil(OtherVPNDetection.attributedMessage(for: tunnelFailure, interfaces: ordinary))

        let withVPN = ordinary + [Interface(name: "utun4", isUp: true, hasRoutableAddress: true)]
        XCTAssertEqual(
            OtherVPNDetection.attributedMessage(for: tunnelFailure, interfaces: withVPN),
            OtherVPNDetection.userMessage
        )

        let helperFailure = ProtectedConnectivity.failure(
            .helperProtocolMismatch, stage: "preparingHelper", attempt: 1, generation: 1, detail: "helper"
        )
        XCTAssertNil(OtherVPNDetection.attributedMessage(for: helperFailure, interfaces: withVPN))
    }
}
