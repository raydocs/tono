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

    func testLaunchRemovesThe0072MihomoRuntimeWithItsCredentials() throws {
        let support = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-legacy-runtime-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: support) }
        let config = support.appendingPathComponent("config", isDirectory: true)
        try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
        let legacy = config.appendingPathComponent("config.yaml")
        try Data("secret: \"controller\"\nproxies:\n  - password: \"account-a-socks5\"\n".utf8).write(to: legacy)
        let current = config.appendingPathComponent("config.json")
        try Data("{}".utf8).write(to: current)

        ConfigStorage.removeLegacyRuntimeConfig(in: support)

        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: current.path), "the sing-box runtime is not legacy")
    }
}
