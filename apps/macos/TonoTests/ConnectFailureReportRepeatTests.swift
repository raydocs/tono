import XCTest
@testable import Tono

/// A retry loop that repeated one failure sent it every time, spent the
/// account's twelve-an-hour failure budget in minutes, and turned every later
/// report into HTTP 429. The same failure is sent once per ten minutes.
@MainActor
final class ConnectFailureReportRepeatTests: XCTestCase {
    private func notice(code: String, error: String?) -> ConnectFailureNotice {
        ConnectFailureNotice(
            ts: 0, stage: "startingTunnel", code: code, error: error,
            node: nil, coreErrors: [], transport: nil
        )
    }

    func testTheSameFailureIsSentOncePerSpacing() {
        let account = AccountSession(sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {})
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let exited = AccountSession.connectFailureSignature(
            notice(code: "UNKNOWN_CLASSIFIED_FAILURE", error: "sing-box exited (status 1)."), node: "LA"
        )
        let port = AccountSession.connectFailureSignature(
            notice(code: "LOCAL_PORT_IN_USE", error: nil), node: "LA"
        )

        XCTAssertTrue(account.admitConnectFailureReport(exited, now: start))
        XCTAssertFalse(account.admitConnectFailureReport(exited, now: start.addingTimeInterval(30)))
        XCTAssertFalse(account.admitConnectFailureReport(exited, now: start.addingTimeInterval(9 * 60)))
        XCTAssertTrue(account.admitConnectFailureReport(port, now: start.addingTimeInterval(9 * 60)),
                      "a different failure is news")
        XCTAssertTrue(account.admitConnectFailureReport(exited, now: start.addingTimeInterval(9 * 60 + 1)),
                      "only the last failure sent is held back")
        XCTAssertFalse(account.admitConnectFailureReport(exited, now: start.addingTimeInterval(18 * 60)))
        XCTAssertTrue(account.admitConnectFailureReport(exited, now: start.addingTimeInterval(20 * 60)))
    }

    func testTheSignatureSeparatesNodesAndErrors() {
        let a = AccountSession.connectFailureSignature(notice(code: "X", error: "e1"), node: "LA")
        XCTAssertNotEqual(a, AccountSession.connectFailureSignature(notice(code: "X", error: "e2"), node: "LA"))
        XCTAssertNotEqual(a, AccountSession.connectFailureSignature(notice(code: "X", error: "e1"), node: "Tokyo"))
    }
}
