import XCTest
@testable import Tono

final class RuntimeConfigTests: XCTestCase {
    @MainActor
    func testRuntimeWriterKeepsCapturedStrictModeWhenPreferenceChanges() async throws {
        let defaults = AppProfile.defaults
        let previous = defaults.object(forKey: SettingsKey.desktopRoutingMode)
        let previousSession = defaults.object(forKey: SettingsKey.routingSession)
        defer {
            if let previous { defaults.set(previous, forKey: SettingsKey.desktopRoutingMode) }
            else { defaults.removeObject(forKey: SettingsKey.desktopRoutingMode) }
            if let previousSession { defaults.set(previousSession, forKey: SettingsKey.routingSession) }
            else { defaults.removeObject(forKey: SettingsKey.routingSession) }
        }
        defaults.removeObject(forKey: SettingsKey.desktopRoutingMode)
        XCTAssertEqual(try DesktopRoutingModeAdmission.capture(defaults.object(forKey: SettingsKey.desktopRoutingMode)), "ai-home")
        XCTAssertEqual(SettingsKey.desktopRoutingModeOptions, ["stable", "three-tier", "ai-home"])
        let runtime = CoreRuntimeManager()
        defaults.set("three-tier", forKey: SettingsKey.desktopRoutingMode)
        let mode = try DesktopRoutingModeAdmission.capture(defaults.object(forKey: SettingsKey.desktopRoutingMode))
        try runtime.captureRoutingMode(mode, physicalInterface: nil)
        defaults.set("stable", forKey: SettingsKey.desktopRoutingMode)
        XCTAssertEqual(defaults.string(forKey: SettingsKey.desktopRoutingMode), "stable")
        XCTAssertEqual(try DesktopRoutingModeAdmission.capture(defaults.object(forKey: SettingsKey.desktopRoutingMode)), "stable",
                       "Settings saves the next connection's intent without changing the captured writer")
        do {
            _ = try await runtime.writeRuntimeConfig(overlay: .init())
            XCTFail("A strict writer without an interface must not compile stable after a preference change")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("No physical interface for strict routing"))
        }
        XCTAssertNil(runtime.runtimeConfigSHA256)
        XCTAssertEqual(runtime.routingMode, "three-tier")
        XCTAssertThrowsError(try DesktopRoutingModeAdmission.capture("Three-Tier"))
        XCTAssertNoThrow(try DesktopRoutingModeAdmission.requireAvailable(nil))
        XCTAssertNoThrow(try DesktopRoutingModeAdmission.requireAvailable("stable"))
    }

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

    @MainActor
    func testCloudOnlyStartupDiscardsLegacyPIDReusedByAnotherProcess() async throws {
        let support = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-stale-sidecar-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: support) }
        let root = support.appendingPathComponent("Tono/Sidecar", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let pidFile = root.appendingPathComponent("tailscaled.pid")

        // A live process from this account stands in for a reused legacy PID.
        let unrelated = Process()
        unrelated.executableURL = URL(fileURLWithPath: "/bin/sleep")
        unrelated.arguments = ["60"]
        try unrelated.run()
        defer {
            if unrelated.isRunning { unrelated.terminate() }
            unrelated.waitUntilExit()
        }
        try String(unrelated.processIdentifier).write(to: pidFile, atomically: true, encoding: .utf8)
        let sidecar = TonoSidecarService(applicationSupport: support)

        try await sidecar.prepareCloudOnly()

        XCTAssertFalse(FileManager.default.fileExists(atPath: pidFile.path))
        XCTAssertTrue(unrelated.isRunning, "a reused PID must not be signaled")
    }
}
