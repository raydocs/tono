import XCTest
@testable import Tono

/// MAC-PAUSED-OPEN-STATUS regression: the third supervisor repair releases
/// ordinary traffic (AI hold kept) and then sets the user-action pause so the
/// unarmed retry stops. The menu bar read the pause alone and showed
/// "Protected Offline · retries paused" over that open host.
@MainActor
final class PausedAfterReleaseStatusTests: XCTestCase {
    func testThirdSupervisorRepairDoesNotClaimProtectedOfflineAfterRelease() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.config.tunEnabled = true
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        let originalArmedState = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = originalArmedState }
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = { KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime
        app.tunInterfaceExists = { _ in true }
        var audits = ProtectionAuditOperations()
        audits.killSwitchHealth = { (wanted: true, live: true, repairedSinceArm: true) }
        app.protectionAudits = audits
        app.consecutiveProtectionRepairCount = 2
        var state = AppState.CoreMonitorState()
        state.healthCycle = 11

        let outcome = await app.runCoreMonitorTick(state: &state)
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(outcome, .stopMonitoring)
        XCTAssertTrue(app.protectedReconnectPausedForUserAction, "the unarmed retry stays paused")
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertNotEqual(MenuBarProtectionStatus(app).kind, .blocked)
    }
}
