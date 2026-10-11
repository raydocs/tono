import XCTest
@testable import Tono

/// X1-8 regression: a disarm reply can be lost after a complete disarm. The
/// release teardown used to treat any disarm error as "Kill Switch still
/// holds this host" and publish Protected Offline over an open host. It must
/// read the helper back and publish what PF actually is. (If the helper had
/// instead failed to delete its persisted state, its status call reinstalls
/// PF and the read-back reports armed; that case stays blocked.)
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
        // The helper completed the disarm (PF and state gone), but the reply
        // was lost, so the App sees an error.
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

    /// Helper effects for the one-click release, each counted.
    private final class ReleaseLog {
        var disarms = 0
        var automaticReleases = 0
    }

    private func releaseRuntime(_ log: ReleaseLog) -> NetworkProtectionOperations {
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { log.disarms += 1 }
        runtime.releaseAfterFailure = { log.automaticReleases += 1 }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        runtime.selectiveAIRecoveryPending = { false }
        return runtime
    }

    /// One-click release, status unreadable: the disarm reply is lost and the
    /// readback cannot be made. That is neither released nor known to hold:
    /// the result is published as unknown, never as Protected Offline and
    /// never as released.
    func testUnreadableReadbackAfterDisarmErrorPublishesUnknown() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        runtime.disarm = { throw KillSwitchService.Error.commandFailed("reply lost") }
        runtime.refreshKillSwitchStatus = { .unavailable }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertTrue(app.isProtectionUnconfirmed, "an unreadable release result is unknown")
        XCTAssertTrue(KillSwitchService.isArmed, "an unknown result never clears the armed intent")
        XCTAssertNotNil(app.errorMessage)
    }

    /// One-click release restores AI too: a confirmed release reads the AI
    /// layer back, and a removal the helper still has pending shows instead
    /// of a plain "released" while AI services stay blocked.
    func testConfirmedReleaseShowsAIRemovalStillPending() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        runtime.selectiveAIRecoveryPending = { true }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertEqual(log.disarms, 1)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.selectiveAIRecoveryPending, "AI still blocked must show after the release")
    }

    /// One-click release against a helper that must be repaired first (an
    /// older protocol, or one that rejects this app): the repair runs before
    /// any release call; when it fails nothing is disarmed or released
    /// (no blind call to an endpoint the old helper may not have), protection
    /// stays, and the message points to the local recovery command.
    func testUnrepairableHelperKeepsProtectionAndPointsToTheRecoveryCommand() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        runtime.repairForRelease = { throw HelperIPCError.forbidden }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertEqual(log.disarms, 0)
        XCTAssertEqual(log.automaticReleases, 0)
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertTrue(app.errorMessage?.contains("Support page") == true,
                      "the failure must name the local recovery path: \(app.errorMessage ?? "nil")")
    }
}
