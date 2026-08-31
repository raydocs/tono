import XCTest
@testable import Tono

/// The classifier's offline verdict is only as good as what feeds it, and the
/// two signals that look convenient are both wrong: the primary-service lookup
/// stays non-nil for a configured-but-disconnected service, and the physical
/// probes are leak detectors that a correctly armed session is supposed to fail.
/// What is left is the link itself, and the answer has to stay one-sided —
/// reporting offline on a working Mac would suppress every real diagnosis.
final class PhysicalNetworkReachabilityTests: XCTestCase {
    func testOnlyLinkKindsThatCanCarryTrafficAreEnumerated() {
        // A tunnel reports `.other`; counting it would answer "is anything
        // reachable" with "yes, through the thing being diagnosed".
        XCTAssertEqual(
            PhysicalLinkKind.allCases.map(\.rawValue),
            ["wifi", "wiredEthernet", "cellular"]
        )
    }

    func testAnIncompleteObservationNeverReportsOffline() {
        let reachability = PhysicalNetworkReachability()
        XCTAssertFalse(reachability.isPhysicallyOffline, "no observation is not an offline verdict")
        reachability.record(.wifi, satisfied: false)
        XCTAssertFalse(
            reachability.isPhysicallyOffline,
            "one unsatisfied kind is not evidence the Mac has no link"
        )
    }

    func testOfflineNeedsEveryPhysicalKindToBeUnsatisfied() {
        let reachability = PhysicalNetworkReachability()
        for kind in PhysicalLinkKind.allCases {
            reachability.record(kind, satisfied: false)
        }
        XCTAssertTrue(reachability.isPhysicallyOffline)

        reachability.record(.wiredEthernet, satisfied: true)
        XCTAssertFalse(reachability.isPhysicallyOffline, "one live link is enough to be online")
    }

    /// The armed session is the case this exists for: the tunnel owns the
    /// default route while Wi-Fi still carries it, and that must not read as
    /// offline just because the TUN probes failed.
    func testALiveLinkUnderAnArmedTunnelIsNotOffline() {
        let reachability = PhysicalNetworkReachability()
        reachability.record(.wifi, satisfied: true)
        reachability.record(.wiredEthernet, satisfied: false)
        reachability.record(.cellular, satisfied: false)
        XCTAssertFalse(reachability.isPhysicallyOffline)

        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .failed("timeout"),
            tun: .failed([]),
            mixed: .failed("timeout"),
            networkOffline: reachability.isPhysicallyOffline
        )
        guard case .retry(let failure) = decision else {
            return XCTFail("a failed TUN is never Connected")
        }
        XCTAssertEqual(failure.code, .coreExitUnreachable)
    }

    func testAnOfflineMacIsClassifiedOfflineRatherThanAsAnUnreachableExit() {
        let reachability = PhysicalNetworkReachability()
        for kind in PhysicalLinkKind.allCases {
            reachability.record(kind, satisfied: false)
        }
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .failed("timeout"),
            tun: .failed([]),
            mixed: .failed("timeout"),
            networkOffline: reachability.isPhysicallyOffline
        )
        guard case .retry(let failure) = decision else {
            return XCTFail("offline must still be classified")
        }
        // Diagnosing this as an unreachable exit is what rotated the catalog on
        // connect and failed over in the health loop, on a Mac with no network.
        XCTAssertEqual(failure.code, .networkEnvironmentOffline)
    }
}
