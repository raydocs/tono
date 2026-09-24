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
}
