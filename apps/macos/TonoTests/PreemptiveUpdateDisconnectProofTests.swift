import XCTest
@testable import Tono

final class PreemptiveUpdateDisconnectProofTests: XCTestCase {
    func testPartialReleaseWithResidualAIIsNotVerifiedDisconnect() {
        let components: [PreemptiveUpdateDisconnectProof.Component] = [
            .init(name: "pf", readback: "restored", risk: "settled"),
            .init(name: "core", readback: "restored", risk: "settled"),
            .init(name: "dns", readback: "restored", risk: "settled"),
            .init(name: "ai", readback: "residual", risk: "settled"),
        ]
        XCTAssertFalse(PreemptiveUpdateDisconnectProof.permits(outcome: "partial", components: components),
                       "partial Restore must not certify update disconnect")
    }
    func testFullyRestoredTerminalReportAllowsVerifiedDisconnect() {
        let components = ["pf", "core", "dns", "ai"].map {
            PreemptiveUpdateDisconnectProof.Component(name: $0, readback: "restored", risk: "settled")
        }
        XCTAssertTrue(PreemptiveUpdateDisconnectProof.permits(outcome: "restored", components: components))
    }

    func testUnknownTerminalReportDoesNotVerifyCleanComponentSnapshot() {
        let components = ["pf", "core", "dns", "ai"].map {
            PreemptiveUpdateDisconnectProof.Component(name: $0, readback: "restored", risk: "settled")
        }
        XCTAssertFalse(PreemptiveUpdateDisconnectProof.permits(outcome: "unknown", components: components))
    }

}
