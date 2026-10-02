import XCTest
@testable import Tono

/// MAC-WITHDRAWN-TRANSPORT-STALE-BLOCK regression: a refused account (or a
/// sign-out on 401) withdraws the transport while connected. The Core stops
/// with PF kept and nothing reconnects, so the helper's core-down watchdog
/// releases PF about 30 s later. Only activation read that back: the account
/// gate and the menu bar kept claiming a block over an open host.
@MainActor
final class WithdrawnTransportReconcileTests: XCTestCase {
    func testWithdrawnTransportReadsTheHelperAfterTheWatchdogWindow() async {
        let originalArmed = KillSwitchService.isArmed
        let originalReassert = KillSwitchService.needsSessionExceptionReassert
        KillSwitchService.isArmed = true
        defer {
            KillSwitchService.isArmed = originalArmed
            KillSwitchService.needsSessionExceptionReassert = originalReassert
        }
        let app = AppState()
        app.isConnected = true
        var watchdogReleased = false
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: !watchdogReleased)
        }
        app.networkProtection = runtime
        app.withdrawnTransportReconcileDelay = .milliseconds(20)

        await app.acceptTonoTransport(nil)
        XCTAssertTrue(app.isProtectionBlocked, "the withdrawal itself keeps PF")
        XCTAssertFalse(app.isConnected)

        watchdogReleased = true
        await app.withdrawnTransportReconcileTask?.value
        for _ in 0..<200 where app.isProtectionBlocked {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertFalse(
            app.isProtectionBlocked,
            "the helper's confirmed release must be read without an activation"
        )
        XCTAssertFalse(KillSwitchService.isArmed)
    }
}
