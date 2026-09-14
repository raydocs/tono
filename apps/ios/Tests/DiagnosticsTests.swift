import XCTest
@testable import Tono

final class DiagnosticsTests: XCTestCase {
    func testProductionCeilingOverridesTestFlightPreference() {
        XCTAssertEqual(DiagnosticPolicy.resolve(nil, distribution: "testflight"), .comprehensive)
        XCTAssertEqual(DiagnosticPolicy.resolve(.comprehensive, distribution: "production"), .minimal)
        XCTAssertEqual(DiagnosticPolicy.resolve(.comprehensive, distribution: nil), .minimal)
        XCTAssertEqual(DiagnosticPolicy.resolve(.off, distribution: "production"), .off)
    }

    func testBoundedDiagnosticsMinimizeAndDoNotForwardUnknownText() throws {
        var buffer = DiagnosticBuffer()
        for _ in 0..<129 { buffer.append(.init(kind: .stateChanged, state: .connecting), policy: .comprehensive) }
        buffer.append(.init(kind: .admissionRefused, state: .actionRequired, blocker: .unsupportedPolicy,
                            elapsedSeconds: 302), policy: .comprehensive)
        XCTAssertEqual(buffer.events.count, 128)
        XCTAssertEqual(buffer.dropped, 2)
        let minimal = buffer.report(policy: .minimal)
        XCTAssertEqual(minimal.events.count, 1)
        XCTAssertEqual(minimal.events.first?.elapsedBucket, 300)
        XCTAssertTrue(buffer.report(policy: .off).events.isEmpty)
        let injected = Data(#"{"kind":"stateChanged","state":"ready","elapsedBucket":0,"observedAtMs":120000,"password":"CANARY-secret","url":"https://private.invalid"}"#.utf8)
        let event = try JSONDecoder().decode(DiagnosticEvent.self, from: injected)
        let encoded = try JSONEncoder().encode(event)
        let keys = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(Set(keys.keys), ["kind", "state", "elapsedBucket", "observedAtMs"])
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("CANARY"))
    }

    func testTelemetryUsesExistingContractWithoutAccountOrRouteIdentity() throws {
        var buffer = DiagnosticBuffer()
        buffer.append(.init(kind: .admissionRefused, state: .actionRequired, blocker: .coreUnavailable,
                            now: Date(timeIntervalSince1970: 70)), policy: .comprehensive)
        let data = try TelemetryPayload.encode(buffer.report(policy: .comprehensive), state: .actionRequired,
                                               now: Date(timeIntervalSince1970: 125))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let window = try XCTUnwrap(root["window"] as? [String: Any])
        XCTAssertEqual(window["windowEndMs"] as? Int, 120000)
        XCTAssertEqual(window["windowStartMs"] as? Int, 60000)
        XCTAssertEqual(window["platform"] as? String, "ios")
        XCTAssertEqual(window["eventCount"] as? Int, 1)
        XCTAssertNil(window["selectedServer"])
        XCTAssertNil(window["email"])
        XCTAssertNil(window["killSwitchLive"])
    }
}
