import XCTest
@testable import Tono

/// Decision 130: AI Home on the app side. The mode is admitted and captured
/// like the others, and every arm of its session asks the helper for the AI
/// scope and requires the reply to confirm it.
final class AIHomeRoutingModeTests: XCTestCase {
    private var savedIPC = KillSwitchService.armIPC
    private var savedArmed = false
    private var savedSession = KillSwitchService.readAIHomeSession
    private var savedReader = LocalNetworkDevicesSync.readStoredSetting
    private var savedKey: Any?

    override func setUp() {
        super.setUp()
        savedIPC = KillSwitchService.armIPC
        savedArmed = KillSwitchService.isArmed
        savedSession = KillSwitchService.readAIHomeSession
        savedReader = LocalNetworkDevicesSync.readStoredSetting
        savedKey = AppProfile.defaults.object(forKey: SettingsKey.aiHomeRoutingSession)
        LocalNetworkDevicesSync.readStoredSetting = { false }
        LocalNetworkDevicesSync.resetForTesting()
    }

    override func tearDown() {
        KillSwitchService.armIPC = savedIPC
        KillSwitchService.isArmed = savedArmed
        KillSwitchService.readAIHomeSession = savedSession
        LocalNetworkDevicesSync.readStoredSetting = savedReader
        LocalNetworkDevicesSync.resetForTesting()
        if let savedKey { AppProfile.defaults.set(savedKey, forKey: SettingsKey.aiHomeRoutingSession) }
        else { AppProfile.defaults.removeObject(forKey: SettingsKey.aiHomeRoutingSession) }
        super.tearDown()
    }

    nonisolated private static func reply(aiHomeScoped: Bool?) -> KillSwitchService.ArmReply {
        (armed: true, wanted: true, live: true, healed: false,
         flushedStates: false, killedHosts: 0, localNetworkDevices: false, aiHomeScoped: aiHomeScoped)
    }

    private func arm() throws {
        try KillSwitchService.arm(
            apiHosts: [], tunnelInterfaces: [], proxyEndpoints: [], sessionDirectEndpoints: [],
            helperPrepared: true, reviewedBundleDirect: false
        )
    }

    func testAIHomeIsAnAdmittedModeAndSendsTheScopeFieldOnlyForItsSession() throws {
        XCTAssertEqual(try DesktopRoutingModeAdmission.capture("ai-home"), "ai-home")
        XCTAssertThrowsError(try DesktopRoutingModeAdmission.capture("AI-Home"))
        XCTAssertEqual(HelperManager.aiHomeArmFields(true) as NSDictionary, ["aiHomeScoped": true])
        XCTAssertTrue(HelperManager.aiHomeArmFields(false).isEmpty, "other sessions send nothing")
    }

    @MainActor
    func testCaptureRecordsTheSessionModeForEveryLaterArm() throws {
        let runtime = CoreRuntimeManager()
        try runtime.captureRoutingMode("ai-home", physicalInterface: "en0")
        XCTAssertTrue(AppProfile.defaults.bool(forKey: SettingsKey.aiHomeRoutingSession))
        XCTAssertTrue(KillSwitchService.readAIHomeSession())
        XCTAssertEqual(CoreRuntimeManager().routingMode, "ai-home", "a relaunch inside the session keeps it")
        try runtime.captureRoutingMode("stable", physicalInterface: nil)
        XCTAssertFalse(AppProfile.defaults.bool(forKey: SettingsKey.aiHomeRoutingSession))
        XCTAssertFalse(KillSwitchService.readAIHomeSession())
    }

    func testAIHomeArmFailsUnlessTheHelperConfirmsTheScope() throws {
        KillSwitchService.readAIHomeSession = { true }
        KillSwitchService.armIPC.deliver = { _ in Self.reply(aiHomeScoped: nil) }
        XCTAssertThrowsError(try arm()) { error in
            guard case KillSwitchService.Error.aiHomeScopeUnconfirmed = error else {
                return XCTFail("unexpected \(error)")
            }
        }
        KillSwitchService.armIPC.deliver = { _ in Self.reply(aiHomeScoped: false) }
        XCTAssertThrowsError(try arm(), "a whole-host ruleset would filter AI Home's DIRECT")
        KillSwitchService.armIPC.deliver = { _ in Self.reply(aiHomeScoped: true) }
        XCTAssertNoThrow(try arm())

        KillSwitchService.readAIHomeSession = { false }
        KillSwitchService.armIPC.deliver = { _ in Self.reply(aiHomeScoped: nil) }
        XCTAssertNoThrow(try arm(), "other sessions do not depend on the field")
    }

    @MainActor
    func testAIHomeWriterBuildsTheAIHomeGraph() async throws {
        XCTAssertEqual(DesktopRoutingModeAdmission.ownedGraph("ai-home"), .aiHome)
        XCTAssertEqual(DesktopRoutingModeAdmission.ownedGraph("three-tier"), .threeTier)
        XCTAssertNil(DesktopRoutingModeAdmission.ownedGraph("stable"))
        let runtime = CoreRuntimeManager()
        try runtime.captureRoutingMode("ai-home", physicalInterface: nil)
        do {
            _ = try await runtime.writeRuntimeConfig(overlay: .init())
            XCTFail("AI Home without an interface must not compile stable")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("No physical interface"))
        }
        XCTAssertNil(runtime.runtimeConfigSHA256)
    }
}
