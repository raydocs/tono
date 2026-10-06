import XCTest
@testable import Tono

@MainActor
final class SeaStatusWordsTests: XCTestCase {
    func testUnknownProtectionPreemptsAnApparentlyConnectedDisplayWord() {
        XCTAssertEqual(SeaStatusWords.key(kind: .connected, connected: true, protectionBlocked: false, unknown: true, disconnecting: false),
                       "Protection status unconfirmed")
    }

    func testADegradedFlagWithoutAConnectionNeverShowsConnected() {
        XCTAssertEqual(SeaStatusWords.key(kind: .degraded, connected: false, protectionBlocked: false, unknown: false, disconnecting: false),
                       "Not connected")
    }

    func testARetryDisplayKindWithoutABarrierNeverClaimsProtected() {
        XCTAssertEqual(SeaStatusWords.key(kind: .blocked, connected: false, protectionBlocked: false,
                                            unknown: false, disconnecting: false),
                       "Not connected")
    }

    func testBusyStateKeysUseTheSeaWordTableWithoutChangingLegacyKeys() {
        XCTAssertEqual(SeaStatusWords.key(kind: .connecting, connected: false, protectionBlocked: false,
                                          unknown: false, disconnecting: false), "sea.status.connecting")
        XCTAssertEqual(SeaStatusWords.key(kind: .connecting, connected: false, protectionBlocked: false,
                                          unknown: false, disconnecting: true), "sea.status.disconnecting")
    }
}
