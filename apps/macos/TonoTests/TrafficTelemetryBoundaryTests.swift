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
        cursor.acknowledge(.init(direct: 150), epoch: oldEpoch)
        XCTAssertEqual(AppTrafficLedger.windowDelta(
            from: cursor.baseline, to: .init(direct: 350)
        ).direct, 50)
        cursor.acknowledge(.init(direct: 350), epoch: cursor.epoch)
        XCTAssertEqual(AppTrafficLedger.windowDelta(
            from: cursor.baseline, to: .init(direct: 400)
        ).direct, 50)
    }

    func testDisconnectTotalsKeepBytesFromClosedFlows() throws {
        let data = Data(#"{"id":"closed","metadata":{"network":"tcp","type":"Tun","host":"example.test"},"upload":7,"download":11,"start":"","chains":["Tono-Exit"],"rule":"Match"}"#.utf8)
        let connection = try JSONDecoder().decode(APIConnection.self, from: data)
        let ledger = AppTrafficLedger()
        ledger.ingest([connection])
        ledger.ingest([])
        XCTAssertEqual(ledger.sessionBytes.upload, 7)
        XCTAssertEqual(ledger.sessionBytes.download, 11)
        ledger.reset()
        XCTAssertEqual(ledger.sessionBytes.upload, 0)
    }
}
