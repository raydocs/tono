import XCTest
@testable import Tono

@MainActor
final class TrafficTelemetryBoundaryTests: XCTestCase {
    func testConsentBoundaryRejectsAnOldUploadAcknowledgement() {
        var cursor = AppTrafficLedger.TelemetryCursor()
        cursor.setEnabled(true, current: .init(direct: 100))
        let oldEpoch = cursor.epoch
        cursor.setEnabled(false, current: .init(direct: 200))
        cursor.setEnabled(true, current: .init(direct: 300))
        cursor.acknowledge(.init(direct: 150), epoch: oldEpoch, interval: .init(startMs: 0, endMs: 1), intervalVersion: 1)
        XCTAssertEqual(AppTrafficLedger.windowDelta(
            from: cursor.baseline, to: .init(direct: 350)
        ).direct, 50)
        cursor.acknowledge(.init(direct: 350), epoch: cursor.epoch, interval: .init(startMs: 0, endMs: 1), intervalVersion: 1)
        XCTAssertEqual(AppTrafficLedger.windowDelta(
            from: cursor.baseline, to: .init(direct: 400)
        ).direct, 50)
    }

}
