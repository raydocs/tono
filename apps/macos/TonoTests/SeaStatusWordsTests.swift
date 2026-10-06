import XCTest
@testable import Tono

@MainActor
final class SeaStatusWordsTests: XCTestCase {
    func testUnknownProtectionPreemptsAnApparentlyConnectedDisplayWord() {
        XCTAssertEqual(SeaStatusWords.title(kind: .connected, connected: true, protectionBlocked: false, unknown: true, disconnecting: false),
                       String(localized: "Protection status unconfirmed"))
    }

    func testADegradedFlagWithoutAConnectionNeverShowsConnected() {
        XCTAssertEqual(SeaStatusWords.title(kind: .degraded, connected: false, protectionBlocked: false, unknown: false, disconnecting: false),
                       String(localized: "Not connected"))
    }

    func testARetryDisplayKindWithoutABarrierNeverClaimsProtected() {
        XCTAssertEqual(SeaStatusWords.title(kind: .blocked, connected: false, protectionBlocked: false,
                                            unknown: false, disconnecting: false),
                       String(localized: "Not connected"))
    }
}
