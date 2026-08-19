import XCTest
@testable import Tono

final class ConnectionTelemetryBufferTests: XCTestCase {
    func testRingDropsOldestAndNeverStoresEmail() {
        let buffer = ConnectionTelemetryBuffer()
        buffer.record("connectBegin", node: "anon-1", generation: 2)
        buffer.record("probeResult", probe: "Google", reason: "ok")
        let drained = buffer.drain()
        XCTAssertEqual(drained.events.count, 2)
        XCTAssertEqual(drained.events[0].kind, "connectBegin")
        XCTAssertEqual(drained.events[1].probe, "Google")
        XCTAssertNil(drained.events[0].error)
        let empty = buffer.drain()
        XCTAssertTrue(empty.events.isEmpty)
    }
}
