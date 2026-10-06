import XCTest
@testable import Tono

@MainActor
final class SeaStatusWordsTests: XCTestCase {
    func testSupportUnknownProtectionOverridesResidualSnapshotClaims() {
        let app = AppState()
        app.isConnected = true
        app.isProtectionBlocked = true
        let snapshot = app.compactRemoteDiagnosticSnapshot()
        XCTAssertTrue(snapshot.protectionBlocked)
        XCTAssertEqual(SupportView.protectionText(snapshot, unconfirmed: true, unreadable: false),
                       String(localized: "Protection status unconfirmed"))
        XCTAssertEqual(SupportView.protectionText(snapshot, unconfirmed: false, unreadable: true),
                       String(localized: "Protection status unconfirmed"))
    }

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
