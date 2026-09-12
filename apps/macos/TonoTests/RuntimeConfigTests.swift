import XCTest
@testable import Tono

final class RuntimeConfigTests: XCTestCase {
    func testPersistedJSONStillUsesClashYAMLKeysAfterTheTypeRename() throws {
        let data = try JSONEncoder().encode(RuntimeConfig())
        let decoded = try JSONDecoder().decode(RuntimeConfig.self, from: data)
        XCTAssertEqual(decoded.mixedPort, 28990)
        XCTAssertEqual(decoded.socksPort, 28991)
        XCTAssertEqual(decoded.mode, "rule")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["socks-port"] as? Int, 28991)
        XCTAssertEqual(object["mixed-port"] as? Int, 28990)
        XCTAssertEqual(object["allow-lan"] as? Bool, false)
        XCTAssertNil(object["socksPort"])
    }
}
