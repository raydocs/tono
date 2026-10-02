import XCTest
@testable import Tono

/// #1305 regression: a helper that answers 403 to this copy of Tono pauses
/// the protected reconnect and keeps `isProtectionBlocked`, so Repair and
/// reconnect stays the primary action. The Core is down, so the helper's
/// watchdog releases PF about 30 s later, and the app cannot read that.
/// The menu bar kept "Protected Offline · retries paused" over an open host.
@MainActor
final class HelperRejectionPauseStatusTests: XCTestCase {
    func testARejectedStatusReadDoesNotClaimProtectedOffline() async {
        let app = AppState()
        let originalArmedState = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = originalArmedState }
        app.isProtectionBlocked = true
        var runtime = NetworkProtectionOperations()
        runtime.refreshKillSwitchStatus = { .rejected }
        app.networkProtection = runtime

        app.reconcileExternalProtectionState()
        for _ in 0..<200 where !app.protectedReconnectPausedForUserAction {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertTrue(app.protectedReconnectPausedForUserAction)
        XCTAssertTrue(app.isProtectionBlocked, "Repair and reconnect stays the primary action")
        XCTAssertEqual(MenuBarProtectionStatus(app).kind, .unconfirmed)
    }
}
