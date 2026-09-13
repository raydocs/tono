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
        XCTAssertEqual(event.transport, "tcp")
    }

    /// The immediate report is only as useful as its bounds are honest: a core
    /// that logged a thousand lines must still produce a notice the Worker
    /// accepts (at most twenty lines of two hundred characters).
    func testConnectFailureNoticeReachesTheSinkWithinTheWorkerBounds() {
        let buffer = ConnectionTelemetryBuffer()
        let received = expectation(description: "notice")
        let box = NoticeBox()
        buffer.setFailureSink { notice in
            box.store(notice)
            received.fulfill()
        }
        let longLine = String(repeating: "x", count: 400)
        buffer.recordConnectFailure(
            stage: "checkingExit",
            code: .coreExitUnreachable,
            elapsedMs: 900,
            node: "anon-2",
            error: String(repeating: "e", count: 300),
            coreErrors: Array(repeating: longLine, count: 25) + [""]
        )
        wait(for: [received], timeout: 1)
        let notice = try! XCTUnwrap(box.notice)
        XCTAssertEqual(notice.stage, "checkingExit")
        XCTAssertEqual(notice.code, "CORE_EXIT_UNREACHABLE")
        XCTAssertEqual(notice.node, "anon-2")
        XCTAssertEqual(notice.error?.count, 200)
        XCTAssertEqual(notice.coreErrors.count, ConnectFailureNotice.maxCoreErrors)
        XCTAssertTrue(notice.coreErrors.allSatisfy { $0.count == ConnectFailureNotice.maxCoreErrorChars })
        XCTAssertGreaterThan(notice.ts, 1_700_000_000_000)
        // The ring still has the typed event, now with the error text on it.
        let drained = buffer.drain()
        XCTAssertEqual(drained.events.count, 1)
        XCTAssertEqual(drained.events[0].error?.count, 200)
    }

    /// The Worker rejects unknown keys outright, so the report's wire shape is
    /// pinned to the exact set `telemetry/failures` accepts, and optionals that
    /// were not set stay off the wire rather than arriving as null.
    func testConnectFailureReportEncodesOnlyTheAcceptedKeys() throws {
        let accepted: Set<String> = [
            "ts", "stage", "code", "error", "node", "appVersion", "osVersion", "osArch",
            "platform", "coreErrors", "tcpDelayMs", "exitDelayMs", "transport",
        ]
        let report = TonoConnectFailureReport(
            ts: 1_725_000_000_000,
            stage: "handshake",
            code: "CORE_EXIT_UNREACHABLE",
            node: "anon-3",
            appVersion: "1.9.0",
            osVersion: "macOS 15.1.0",
            osArch: "arm64",
            coreErrors: ["dial tcp: i/o timeout"]
        )
        let data = try TonoCoding.encoder().encode(report)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(Set(object.keys).isSubset(of: accepted), "\(object.keys)")
        XCTAssertEqual(object["platform"] as? String, "macos")
        XCTAssertNil(object["error"])
        XCTAssertNil(object["tcpDelayMs"])
        XCTAssertEqual(object["coreErrors"] as? [String], ["dial tcp: i/o timeout"])
    }

    /// A connect that succeeded carries the exit delay it was measured at.
    func testConnectOkCarriesTheDelayItWasMeasuredAt() {
        let buffer = ConnectionTelemetryBuffer()
        buffer.record("connectOk", stage: "verifyingTraffic", delayMs: 183, node: "anon-1")
        let drained = buffer.drain()
        XCTAssertEqual(drained.events[0].delayMs, 183)
    }

    func testConnectHy2EventCarriesBackupTransport() {
        let buffer = ConnectionTelemetryBuffer()
        let hy2 = "Tokyo · Sakura · hy2"
        buffer.record("connectBegin", node: hy2, transport: ProxyNode.catalogTransport(for: hy2))
        buffer.recordConnectFailure(
            stage: "handshake",
            code: .coreExitUnreachable,
            node: hy2
        )
        let drained = buffer.drain()
        XCTAssertEqual(drained.events[0].transport, "hy2")
        XCTAssertEqual(drained.events[1].kind, "connectFail")
        XCTAssertEqual(drained.events[1].transport, "hy2")
    }
}

/// XCTest expectations run the sink on the caller's thread; the box just
/// carries the value across the `Sendable` boundary without a data race.
private final class NoticeBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: ConnectFailureNotice?
    var notice: ConnectFailureNotice? {
        lock.lock(); defer { lock.unlock() }
        return stored
    }
    func store(_ value: ConnectFailureNotice) {
        lock.lock(); stored = value; lock.unlock()
    }
}
