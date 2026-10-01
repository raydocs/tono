import XCTest
@testable import Tono

/// MAC-PAUSE-WATCHDOG-STALE-BLOCK regression: launch after an unexpected
/// restart held automatic resume with PF armed, the Core down and nothing
/// scheduled. The helper's core-down watchdog released PF about 30 s later
/// while the UI kept saying Kill Switch was blocking traffic. Without a
/// strict kill switch the hold must take the automatic release (AI hold
/// kept) at once.
@MainActor
final class PausedFailureReleaseTests: XCTestCase {
    func testRestartHoldReleasesWithAIHold() async {
        let originalArmed = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = originalArmed }
        var operations: [String] = []
        let app = AppState()
        app.isProtectionBlocked = true
        app.automaticResumeHeldAfterRestart = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { operations.append("disarm") }
        runtime.releaseAfterFailure = {
            operations.append("releaseAfterFailure")
            KillSwitchService.isArmed = false
        }
        runtime.restrictToBootstrap = { operations.append("restrictToBootstrap") }
        app.networkProtection = runtime

        app.holdAutomaticResumeAfterUnexpectedRestart()
        let reason = String(localized: "This Mac restarted unexpectedly while Tono was connected, so Tono did not reconnect automatically.")
        XCTAssertEqual(
            app.errorMessage,
            reason + " " + String(localized: "Tono is restoring this Mac's normal internet; AI services stay blocked."),
            "the release is only queued; PF may still hold the host"
        )
        await app.connectionCoordinator.disconnectSequence?.value
        await app.failureReleaseNoticeTask?.value

        XCTAssertEqual(operations, ["releaseAfterFailure"])
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.protectedReconnectPausedForUserAction)
        XCTAssertEqual(
            app.errorMessage,
            reason + " " + String(localized: "This Mac is back on its normal internet and AI services stay blocked. Connect again when you are ready.")
        )
        XCTAssertNotEqual(MenuBarProtectionStatus(app).kind, .blocked)
    }
}
