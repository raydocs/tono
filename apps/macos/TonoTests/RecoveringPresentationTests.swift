import XCTest
@testable import Tono

/// X1-6 regression: the core monitor sets `isRecoveringProtectedConnection`
/// while it recovers a connected session in place. A teardown ends that
/// session, so the flag must go with it; left set, the dashboard kept showing
/// "Recovering protected connection…" with a spinner over Protected Offline
/// and, after Restore internet, over a host that was no longer protected.
final class RecoveringPresentationTests: XCTestCase {

    func testReleaseClearsRecoveringPresentation() async {
        let app = AppState()
        KillSwitchService.isArmed = false
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        // The monitor's state after repeated health failures.
        app.isRecoveringProtectedConnection = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isRecoveringProtectedConnection)
    }
}
