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
}
