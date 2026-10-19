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
    private var savedStrict: Any?

    override func setUp() {
        super.setUp()
        savedIPC = KillSwitchService.armIPC
        savedArmed = KillSwitchService.isArmed
        savedSession = KillSwitchService.readAIHomeSession
        savedReader = LocalNetworkDevicesSync.readStoredSetting
        savedKey = AppProfile.defaults.object(forKey: SettingsKey.aiHomeRoutingSession)
        savedStrict = AppProfile.defaults.object(forKey: "strictRoutingSessionIntent")
        AppProfile.defaults.removeObject(forKey: "strictRoutingSessionIntent")
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
        if let savedStrict { AppProfile.defaults.set(savedStrict, forKey: "strictRoutingSessionIntent") }
        else { AppProfile.defaults.removeObject(forKey: "strictRoutingSessionIntent") }
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
        // Decision 131: never chosen means AI Home, and without a Home line
        // the session runs Stable. Every saved choice is kept.
        XCTAssertEqual(try DesktopRoutingModeAdmission.capture(nil), "ai-home")
        XCTAssertEqual(try DesktopRoutingModeAdmission.capture("stable"), "stable")
        XCTAssertEqual(DesktopRoutingModeAdmission.effective("ai-home", homeAvailable: true), "ai-home")
        XCTAssertEqual(DesktopRoutingModeAdmission.effective("ai-home", homeAvailable: false), "stable")
        XCTAssertEqual(DesktopRoutingModeAdmission.effective("three-tier", homeAvailable: false), "three-tier")
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

    func testAIHomeProtectedFaultIsNotALocalNetworkFault() throws {
        KillSwitchService.readAIHomeSession = { true }
        KillSwitchService.isArmed = false
        KillSwitchService.armIPC.deliver = { _ in
            throw HelperIPCError.commandFailed("block-all installed", code: "KILLSWITCH_LOCAL_NETWORK_FAULT")
        }
        XCTAssertThrowsError(try arm()) { error in
            guard case KillSwitchService.Error.aiHomeProtectionFault = error else {
                return XCTFail("unexpected \(error)")
            }
        }
        XCTAssertTrue(KillSwitchService.isArmed, "the helper still holds protection")
        XCTAssertEqual(LocalNetworkDevicesSync.fault, .aiHomeProtection("block-all installed"))
        XCTAssertTrue(LocalNetworkDevicesSync.holdsProtectedFault)
        XCTAssertTrue(LocalNetworkDevicesSync.faultIsAIHomeProtection)
        XCTAssertFalse(LocalNetworkDevicesSync.faultMessage?.contains("local network") ?? true)

        LocalNetworkDevicesSync.resetForTesting()
        KillSwitchService.readAIHomeSession = { false }
        XCTAssertThrowsError(try arm()) { error in
            guard case KillSwitchService.Error.localNetworkFault = error else {
                return XCTFail("unexpected \(error)")
            }
        }
        XCTAssertEqual(LocalNetworkDevicesSync.fault, .helper("block-all installed"))
        XCTAssertFalse(LocalNetworkDevicesSync.faultIsAIHomeProtection)
    }

    @MainActor
    func testRelaunchRestoresOneSessionModeEverywhereAndStrictWins() {
        let production = savedSession
        AppProfile.defaults.set(true, forKey: SettingsKey.aiHomeRoutingSession)
        XCTAssertEqual(DesktopRoutingModeAdmission.persistedSession(), "ai-home")
        XCTAssertEqual(ConnectionCoordinator().capturedRoutingMode, "ai-home",
                       "reconnect admission keeps the AI Home session, not the next preference")
        XCTAssertEqual(CoreRuntimeManager().routingMode, "ai-home")
        XCTAssertTrue(production())

        // A leftover AI Home record under strict intent: three-tier everywhere,
        // and the arm does not ask for a scope the helper would refuse.
        AppProfile.defaults.set(true, forKey: "strictRoutingSessionIntent")
        XCTAssertEqual(DesktopRoutingModeAdmission.persistedSession(), "three-tier")
        XCTAssertEqual(ConnectionCoordinator().capturedRoutingMode, "three-tier")
        XCTAssertEqual(CoreRuntimeManager().routingMode, "three-tier")
        XCTAssertFalse(production())
        AppProfile.defaults.removeObject(forKey: "strictRoutingSessionIntent")

        let coordinator = ConnectionCoordinator()
        coordinator.retireCapturedRoutingMode()
        XCTAssertNil(coordinator.capturedRoutingMode)
        XCTAssertNil(DesktopRoutingModeAdmission.persistedSession(), "an explicit release ends the AI Home record")
        XCTAssertFalse(production())
    }

    func testHelperReportedFaultKeepsTheAIHomeClassification() {
        LocalNetworkDevicesSync.recordHelperReportedFault(aiHomeSession: true)
        XCTAssertEqual(LocalNetworkDevicesSync.fault, .aiHomeProtection("reported by the helper"))
        LocalNetworkDevicesSync.recordFault(.aiHomeProtection("block-all installed"))
        LocalNetworkDevicesSync.recordHelperReportedFault(aiHomeSession: false)
        XCTAssertEqual(LocalNetworkDevicesSync.fault, .aiHomeProtection("block-all installed"),
                       "a status poll does not turn the AI Home fault back into a LAN fault")
        LocalNetworkDevicesSync.resetForTesting()
        LocalNetworkDevicesSync.recordHelperReportedFault(aiHomeSession: false)
        XCTAssertEqual(LocalNetworkDevicesSync.fault, .helper("reported by the helper"))
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
