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

        let report = ConnectionFailureReport()
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
}
