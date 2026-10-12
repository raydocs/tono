import XCTest
@testable import Tono

/// X1-4 regression: a connect attempt that fails before its first PF arm
/// cleans up through a release teardown. That cleanup must not run the
/// explicit-release helper repair (a second administrator prompt the user did
/// not ask for), and a helper that still cannot be repaired must not turn a
/// host PF never held into Protected Offline with "traffic stays protected".
final class UnarmedConnectFailureTests: XCTestCase {

    func testUnarmedConnectFailureDoesNotRunExplicitReleaseRepair() async {
        let app = AppState()
        KillSwitchService.isArmed = false
        // A catalog exit that passes selection but has no uuid: connect fails
        // deterministically before any helper preparation or PF arm.
        var catalogNode = Fixture.realityNode()
        catalogNode.uuid = nil
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [catalogNode]
            )
        ]
        var repairs = 0
        var runtime = NetworkProtectionOperations()
        // The helper that failed preparation still fails repair: the user
        // cancels the administrator prompt again.
        runtime.repairForRelease = {
            repairs += 1
            throw KillSwitchService.Error.userDenied
        }
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        // An earlier session left its core marker and loopback DNS behind,
        // and restoring that DNS fails: a real failure with no PF behind it.
        AppProfile.defaults.set(true, forKey: SettingsKey.didStartCore)
        runtime.restoreDNS = { throw KillSwitchService.Error.notInstalled }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        defer {
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
            AppProfile.defaults.removeObject(forKey: SettingsKey.didStartCore)
        }

        app.connect()
        let attempt = app.connectionCoordinator.connectTask
        await attempt?.value
        await app.finishPendingDisconnect()

        XCTAssertEqual(repairs, 0, "an unarmed failure must not prompt for the explicit-release repair")
        XCTAssertFalse(app.isProtectionBlocked, "PF never armed, so the host is not Protected Offline")
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNotNil(app.lastConnectionFailure, "the connect failure stays on the record")
        let message = app.errorMessage ?? ""
        XCTAssertTrue(message.hasPrefix("Protected DNS restore failed"), "a real DNS restore failure stays visible")
        XCTAssertFalse(message.contains("Kill Switch"), "no Kill Switch holds this host")
    }

    /// Simulated drop recovery: after a released session, the unarmed loop
    /// proves TCP and starts a connect that fails before PF arms. The loop
    /// had ended when it started that connect; recovery goes back to it, so
    /// the Mac is not left disconnected with nothing scheduled, and a later
    /// network change still restarts it.
    @MainActor
    func testAnAutomaticConnectThatFailsBeforeArmingHandsRecoveryBackToTheUnarmedLoop() async {
        let app = AppState()
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        KillSwitchService.isArmed = false
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        // Passes selection and the TCP proof, then cannot be dialled: the
        // connect fails before helper preparation or any PF arm.
        var catalogNode = Fixture.realityNode()
        catalogNode.uuid = nil
        app.proxyRegions = [
            ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [catalogNode])
        ]
        app.applyProxySelection(catalogNode.name)
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.recordConnectBootSession = {}
        app.unarmedTcpProof = { _ in true }
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            app.connectionCoordinator.cancelConnectionTasks()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
        }

        app.scheduleUnarmedReconnect(sleep: { _ in })
        await app.connectionCoordinator.unarmedReconnectTask?.value
        await app.connectionCoordinator.connectTask?.value
        await app.finishPendingDisconnect()

        XCTAssertFalse(app.isConnected)
        XCTAssertNotNil(app.lastConnectionFailure, "the automatic connect did fail")
        XCTAssertFalse(KillSwitchService.isArmed, "PF never armed")
        XCTAssertTrue(
            app.unarmedReconnectAwaitsNetwork,
            "a loop owns recovery again, so its next rung or a network change reconnects"
        )
    }
}
