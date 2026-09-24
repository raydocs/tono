import XCTest
@testable import Tono

/// X1-8 regression: the helper removes PF before it deletes its persisted
/// state, and a disarm reply can also be lost after a complete disarm. The
/// release teardown used to treat any disarm error as "Kill Switch still
/// holds this host" and publish Protected Offline over an open host. It must
/// read the helper back and publish what PF actually is.
final class DisarmErrorReadbackTests: XCTestCase {

    func testDisarmErrorAfterBarrierRemovalDoesNotPublishProtectedOffline() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        var pfLive = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        // PF is flushed, then the state-file cleanup fails.
        runtime.disarm = {
            pfLive = false
            throw KillSwitchService.Error.commandFailed("state cleanup failed")
        }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: pfLive)
        }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertFalse(pfLive)
        XCTAssertFalse(
            app.isProtectionBlocked,
            "PF is gone, so the UI must not claim Protected Offline"
        )
        XCTAssertFalse(KillSwitchService.isArmed)
    }
}
