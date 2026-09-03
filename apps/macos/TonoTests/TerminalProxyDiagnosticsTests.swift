import XCTest
@testable import Tono

final class TerminalProxyDiagnosticsTests: XCTestCase {
    func testReportDoesNotExposeProxyCredentials() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        defer { try? FileManager.default.removeItem(at: root) }

        let report = TerminalProxyDiagnostics.scan(
            environment: [
                "HTTPS_PROXY": "http://alice:super-secret@proxy.example:8080",
            ],
            homeDirectory: root,
            applicationSupportDirectory: root,
            launchctlRead: { _ in "" }
        )

        XCTAssertEqual(report.issues.count, 1)
        XCTAssertEqual(report.issues.first?.value, "<configured>")
        XCTAssertFalse(String(describing: report.issues).contains("super-secret"))
    }
}
