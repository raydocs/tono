import XCTest
@testable import Tono

@MainActor
final class SeaStatusWordsTests: XCTestCase {
    func testSequentialHeaderNeverShowsOutgoingAndIncomingWordsTogether() {
        for frame in 0...240 {
            let progress = Double(frame) / 240
            let incoming = SeaHomeHeaderTransition.opacity(at: progress)
            let outgoing = SeaHomeHeaderTransition.opacity(at: 1 - progress)
            XCTAssertEqual(incoming * outgoing, 0,
                           "title and subtitle groups must not cross-fade readable words")
        }
        XCTAssertEqual(SeaHomeHeaderTransition.opacity(at: 0), 0)
        XCTAssertEqual(SeaHomeHeaderTransition.opacity(at: 1), 1)
    }

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
