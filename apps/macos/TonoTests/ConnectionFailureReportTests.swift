import Foundation
import XCTest
@testable import Tono

final class ConnectionFailureReportTests: XCTestCase {
    func testReportNamesEachPathAndClassWithoutAddressesOrErrorText() {
        let leaky = NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut, userInfo: [
            NSLocalizedDescriptionKey: "relay 203.0.113.9:443 for user@example.com timed out",
        ])
        let attempts = [
            ConnectionFailureReport.attempt(path: "system_dns", error: URLError(.dnsLookupFailed)),
            ConnectionFailureReport.attempt(path: "relay 203.0.113.9:443", error: leaky),
            ConnectionFailureReport.attempt(path: "evil.example.com", error: URLError(.cannotConnectToHost)),
        ]
        XCTAssertEqual(ConnectionFailureReport.summary(attempts), "system_dns:dns, relay:timeout, other:connect")

        let report = ConnectionFailureReport(persist: { _, _ in })
        let start = Date(timeIntervalSince1970: 1_000)
        report.record(.controlPlane, attempts: attempts, stoppedEarly: true, at: start)
        let lines = report.lines(protection: "armed, no tunnel", osVersion: "26.3.1",
                                 now: start.addingTimeInterval(190))
        XCTAssertEqual(lines, [
            "macOS: 26.3.1",
            "Protection: armed, no tunnel",
            "Control plane: system_dns:dns, relay:timeout, other:connect (not sent again) (3 min ago)",
        ])
        let text = lines.joined(separator: "\n")
        XCTAssertFalse(text.contains("203.0.113.9"))
        XCTAssertFalse(text.contains("@"))
        XCTAssertFalse(text.contains("example.com"))
    }

    func testSkippedDirectAttemptIsReportedAsSkippedNotAsAFailure() {
        let skipped = NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet,
                              userInfo: [ConnectionFailureReport.skippedKey: true])
        XCTAssertEqual(ConnectionFailureReport.attempt(path: "direct", error: skipped).failure, "skipped")
        XCTAssertEqual(ConnectionFailureReport.attempt(path: "direct", error: URLError(.notConnectedToInternet)).failure,
                       "connect")
    }

    func testUpdateFailureAlertAndReportCarryTheSamePathList() {
        let attempts = [
            ConnectionFailureReport.attempt(path: "system_dns", error: URLError(.timedOut)),
            ConnectionFailureReport.attempt(path: "relay", error: URLError(.cannotConnectToHost)),
        ]
        let error = NativeUpdateDownload.userFacing(
            NativeUpdateDownload.Copy.metadataUnreadable, diagnostic: "raw 203.0.113.9 detail",
            report: (.updateMetadata, attempts)
        )
        XCTAssertTrue(error.localizedDescription.hasPrefix(NativeUpdateDownload.Copy.metadataUnreadable))
        XCTAssertTrue(error.localizedDescription.hasSuffix("\nPaths: system_dns:timeout, relay:connect"))
        XCTAssertFalse(error.localizedDescription.contains("203.0.113.9"))
        XCTAssertTrue(ConnectionFailureReport.shared.currentLines()
            .contains { $0.hasPrefix("Update metadata: system_dns:timeout, relay:connect") })
    }

    func testPendingUpdateLineNamesTheStateAndNeverFreeText() {
        let report = ConnectionFailureReport(persist: { _, _ in })
        report.recordPendingUpdate(execution: "consumed", phase: "installationAuthorized",
                                   blocked: false, disconnectRequested: nil)
        XCTAssertEqual(report.lines(protection: "armed, no tunnel", osVersion: "26.3.1").last,
                       "Pending update: execution consumed, phase installationAuthorized")
        report.recordPendingUpdate(execution: "/Users/someone/secret", phase: "bad phase!",
                                   blocked: true, disconnectRequested: true)
        XCTAssertEqual(report.lines(protection: "not armed", osVersion: "26.3.1").last,
                       "Pending update: execution unknown, blocked, disconnect requested")
    }

    func testEveryRecordIsAlsoWrittenToThePersistentLogWithClosedFields() {
        final class Sink: @unchecked Sendable {
            let lock = NSLock()
            var events: [(String, [String: String])] = []
            func add(_ event: String, _ details: [String: String]) {
                lock.lock(); events.append((event, details)); lock.unlock()
            }
        }
        let sink = Sink()
        let report = ConnectionFailureReport(persist: { sink.add($0, $1) })
        report.record(.updatePackage, attempts: [
            ConnectionFailureReport.attempt(path: "direct", error: URLError(.timedOut)),
            ConnectionFailureReport.attempt(path: "relay 203.0.113.9:443", error: URLError(.cannotConnectToHost)),
        ])
        report.recordPendingUpdate(execution: "consumed", phase: "installationAuthorized",
                                   blocked: true, disconnectRequested: nil)
        XCTAssertEqual(sink.events.map(\.0), ["connection_failure_report", "pending_update_unresumable"])
        XCTAssertEqual(sink.events[0].1, ["area": "update_package", "paths": "direct:timeout, relay:connect",
                                          "stopped_early": "false"])
        XCTAssertEqual(sink.events[1].1, ["state": "consumed", "phase": "installationAuthorized",
                                          "blocked": "true", "disconnect_requested": "false"])
        XCTAssertFalse(sink.events.flatMap { $0.1.values }.contains { $0.contains("203.0.113.9") })
    }
}
