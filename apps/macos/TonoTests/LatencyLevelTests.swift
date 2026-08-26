import XCTest
@testable import Tono

final class LatencyLevelTests: XCTestCase {
    func testExitBandsDoNotPaintAHealthyJapanHandshakeAsDead() {
        XCTAssertEqual(LatencyLevel.level(for: 80, kind: .exit), .low)
        XCTAssertEqual(LatencyLevel.level(for: 500, kind: .exit), .low)
        XCTAssertEqual(LatencyLevel.level(for: 816, kind: .exit), .low)
        XCTAssertEqual(LatencyLevel.level(for: 920, kind: .exit), .low)
        XCTAssertEqual(LatencyLevel.level(for: 1200, kind: .exit), .mid)
        XCTAssertEqual(LatencyLevel.level(for: 1499, kind: .exit), .mid)
        XCTAssertEqual(LatencyLevel.level(for: 1500, kind: .exit), .high)
    }

    func testSpokenTitleUsesSecondsNotAMillisecondStamp() {
        XCTAssertEqual(LatencyLevel.spokenSeconds(for: 816), "0.8")
        XCTAssertTrue(LatencyLevel.spokenTitle(for: 816, kind: .exit).contains("0.8"))
        XCTAssertFalse(LatencyLevel.spokenTitle(for: 816, kind: .exit).contains("816"))
        XCTAssertFalse(LatencyLevel.spokenTitle(for: 816, kind: .exit).localizedCaseInsensitiveContains("about"))
    }

    func testTcpBandsStayTighterThanExit() {
        XCTAssertEqual(LatencyLevel.level(for: 100, kind: .tcp), .low)
        XCTAssertEqual(LatencyLevel.level(for: 300, kind: .tcp), .mid)
        XCTAssertEqual(LatencyLevel.level(for: 500, kind: .tcp), .high)
    }
}
