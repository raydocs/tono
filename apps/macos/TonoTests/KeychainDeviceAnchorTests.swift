import XCTest
@testable import Tono

final class KeychainDeviceAnchorTests: XCTestCase {
    func testASessionCarriedToAnotherMacIsDroppedAndGetsANewDeviceIdentity() throws {
        let keychain = KeychainStore(service: "app.tono.tests.device-anchor.\(UUID().uuidString)")
        defer {
            try? keychain.remove(.refreshToken)
            try? keychain.remove(.installationId)
            try? keychain.remove(.deviceAnchor)
        }
        try keychain.set("r0", for: .refreshToken)
        let original = try keychain.installationId()
        XCTAssertFalse(try keychain.discardSessionCopiedFromAnotherMac(currentAnchor: "mac-a"))
        XCTAssertFalse(try keychain.discardSessionCopiedFromAnotherMac(currentAnchor: "mac-a"))
        XCTAssertEqual(try keychain.string(for: .refreshToken), "r0", "the Mac that created the session keeps it")

        XCTAssertTrue(try keychain.discardSessionCopiedFromAnotherMac(currentAnchor: "mac-b"))
        XCTAssertNil(try keychain.string(for: .refreshToken), "a migrated copy must not replay the original Mac's token")
        XCTAssertNotEqual(try keychain.installationId(), original, "a migrated Mac must register as its own device")
    }
}
