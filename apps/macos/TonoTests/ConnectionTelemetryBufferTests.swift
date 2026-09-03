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

    /// A classified failure is only useful if the code travels with it. Without
    /// this event the uploader saw that a connect stopped and nothing about why.
    func testConnectFailureCarriesStageCodeAndElapsedTime() {
        let buffer = ConnectionTelemetryBuffer()
        buffer.recordConnectFailure(
            stage: "verifyingTraffic",
            code: .networkEnvironmentOffline,
            elapsedMs: 4_200,
            node: "anon-1",
            generation: 9
        )
        let drained = buffer.drain()
        XCTAssertEqual(drained.events.count, 1)
        let event = drained.events[0]
        XCTAssertEqual(event.kind, "connectFail")
        XCTAssertEqual(event.stage, "verifyingTraffic")
        XCTAssertEqual(event.code, "NETWORK_ENVIRONMENT_OFFLINE")
        XCTAssertEqual(event.elapsedMs, 4_200)
        XCTAssertEqual(event.node, "anon-1")
        XCTAssertNil(event.error)
    }
}
