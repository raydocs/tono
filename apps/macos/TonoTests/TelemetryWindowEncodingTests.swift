import XCTest
@testable import Tono

/// `telemetry/windows` rejects a window carrying any key it does not expect,
/// and the rejection drops the whole window — every event in it, not just the
/// offending field. The route split is the newest thing on that wire, so its
/// shape is pinned here rather than trusted to the encoder's synthesis.
final class TelemetryWindowEncodingTests: XCTestCase {
    private func window(
        bytesByRoute: TonoBytesByRoute? = nil
    ) -> TonoTelemetryWindowReport {
        TonoTelemetryWindowReport(
            schemaVersion: 1,
            kind: "periodic_window",
            windowStartMs: 1_725_000_000_000,
            windowEndMs: 1_725_000_120_000,
            appVersion: "1.9.0",
            osVersion: "macOS 15.1.0",
            osArch: "arm64",
            uiState: "connected",
            accountState: "ready",
            selectedServer: nil,
            catalogRevision: nil,
            killSwitchMode: nil,
            killSwitchWanted: nil,
            killSwitchLive: nil,
            dnsEnabled: nil,
            bytesByRoute: bytesByRoute,
            eventCount: 0,
            eventsDropped: 0,
            events: []
        )
    }

    private func encodedObject(
        _ report: TonoTelemetryWindowReport
    ) throws -> [String: Any] {
        let data = try TonoCoding.encoder().encode(report)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testTheRouteSplitEncodesExactlyTheThreeAcceptedKeys() throws {
        let report = window(
            bytesByRoute: TonoBytesByRoute(cloud: 4_000, residential: 300, direct: 20)
        )
        let object = try encodedObject(report)
        let split = try XCTUnwrap(object["bytesByRoute"] as? [String: Any])
        XCTAssertEqual(
            Set(split.keys),
            ["cloud", "residential", "direct"],
            "any other key is a 400 that loses the whole window"
        )
        XCTAssertEqual((split["cloud"] as? NSNumber)?.int64Value, 4_000)
        XCTAssertEqual((split["residential"] as? NSNumber)?.int64Value, 300)
        XCTAssertEqual((split["direct"] as? NSNumber)?.int64Value, 20)

        // A window without a split carries no key at all: a JSON null is not an
        // integer either, and would be refused the same way.
        XCTAssertNil(try encodedObject(window())["bytesByRoute"])
    }
}
