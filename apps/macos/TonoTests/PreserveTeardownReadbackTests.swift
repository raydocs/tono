import XCTest
@testable import Tono

/// A preserve teardown (health failure, policy update, sleep) whose
/// `restrictToBootstrap` no-ops because the app believes PF was never armed.
/// The app's `KillSwitchService.isArmed` is a local record: an arm whose
/// reply was lost after the helper persisted PF leaves it false while the
/// helper still blocks the host. Publishing "not protected" on that local
/// record alone showed Not connected over a host PF was holding, and
/// `reconcileExternalProtectionState()` then skipped it. Only a helper that
/// confirms it holds no kill-switch state may open the UI; an unreachable or
/// rejecting helper keeps Protected Offline. XCTest cannot drive the
/// privileged helper; the `networkProtection` seams stand in for its I/O.
final class PreserveTeardownReadbackTests: XCTestCase {

    func testNeverArmedPreserveTeardownOpensUIOnlyWhenHelperConfirmsNoKillSwitch() async {
        let app = AppState()
        var observation: KillSwitchService.StatusObservation = .unavailable
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { XCTFail("a preserve teardown must never disarm") }
        // Idle no-op, as the helper answers while PF is not armed.
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { observation }
        app.networkProtection = runtime
        defer { KillSwitchService.isArmed = false }

        // Mid-connect, before the app recorded an arm. The helper cannot be
        // read back, so it may still hold PF from a lost arm reply.
        app.isConnecting = true
        KillSwitchService.isArmed = false
        app.disconnect(releaseKillSwitch: false)
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertTrue(
            app.isProtectionBlocked,
            "an unconfirmed helper state must keep Protected Offline"
        )

        // The helper answers with no persisted kill-switch state: the host is
        // open and the UI must say so.
        observation = .confirmed(requiresProtectionRecovery: false)
        app.isConnecting = true
        app.disconnect(releaseKillSwitch: false)
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertFalse(
            app.isProtectionBlocked,
            "a helper-confirmed idle kill switch must not publish Protected Offline"
        )
        XCTAssertFalse(app.isDisconnecting)
    }
}
