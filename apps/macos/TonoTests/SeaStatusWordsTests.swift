import XCTest
@testable import Tono

@MainActor
final class SeaStatusWordsTests: XCTestCase {
    func testUnknownProtectionPreemptsAnApparentlyConnectedDisplayWord() {
        XCTAssertEqual(SeaStatusWords.title(kind: .connected, unknown: true, disconnecting: false),
                       String(localized: "Protection status unconfirmed"))
    }
}
