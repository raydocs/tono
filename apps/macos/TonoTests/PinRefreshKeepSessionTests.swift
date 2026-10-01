import XCTest
@testable import Tono

/// MAC-PIN-REFRESH-TEARDOWN: a pins-only refresh that fails before Mihomo
/// accepts the new pins used to take the owned-runtime teardown
/// (`disconnect(releaseKillSwitch: false)`), holding PF in bootstrap.
/// The old config is still in force. That path is a background pin update,
/// not an explicit strict kill switch.
final class PinRefreshKeepSessionTests: XCTestCase {

    func testPinsOnlyRefreshFailureBeforeCommitKeepsTheSession() async {
        let app = AppState()
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        XCTAssertTrue(app.isOwnedTonoMode)
        app.isConnected = true
        let live = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [],
            mediaEndpoints: []
        )
        let pending = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en1",
            domainPins: [],
            mediaEndpoints: []
        )
        app.activeDirectPolicy = live
        KillSwitchService.isArmed = true

        let savedIPC = KillSwitchService.armIPC
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
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = false
            app.connectionCoordinator.cancelReconnectTasks()
        }

        KillSwitchService.armIPC.prepare = { _ in
            throw HelperIPCError.connectFailed
        }
        KillSwitchService.armIPC.deliver = { _ in
            XCTFail("pin refresh must not deliver an arm after helper preparation fails")
            throw HelperIPCError.connectFailed
        }

        app.reloadCoreConfig(applyingDirectPolicy: pending)
        let mutation = app.connectionCoordinator.configReloadTask
        XCTAssertNotNil(mutation)
        await mutation?.value
        if let teardown = app.connectionCoordinator.disconnectSequence {
            await teardown.value
        }
        let loop = app.connectionCoordinator.protectedReconnectTask
        app.connectionCoordinator.cancelReconnectTasks()
        await loop?.value

        XCTAssertTrue(app.isConnected)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
        XCTAssertEqual(app.activeDirectPolicy, live)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
        XCTAssertNil(app.connectionCoordinator.configReloadTask)
        XCTAssertNil(app.errorMessage)
    }
}
