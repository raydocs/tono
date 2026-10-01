import XCTest
@testable import Tono

/// MAC-DNS-PAUSE-HOLDS-PF regression: the third broken Protected DNS audit
/// and a split-DNS conflict both ended the session with the preserve
/// teardown and scheduled nothing. The Core stopped, PF stayed armed and
/// system DNS still pointed at the dead loopback resolver, so a Mac without
/// a strict kill switch sat offline until the helper's core-down watchdog
/// released PF about 30 s later, while the UI kept claiming a block. Both
/// must take the automatic release (AI hold kept) at once.
@MainActor
final class ProtectedDNSPauseReleaseTests: XCTestCase {
    private func connectedApp(recording operations: @escaping (String) -> Void) -> AppState {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { operations("disarm") }
        runtime.releaseAfterFailure = {
            operations("releaseAfterFailure")
            KillSwitchService.isArmed = false
        }
        runtime.restrictToBootstrap = { operations("restrictToBootstrap") }
        app.networkProtection = runtime
        return app
    }

    func testRepeatedBrokenProtectedDNSReleasesWithAIHold() async {
        let originalArmed = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = originalArmed }
        var operations: [String] = []
        let app = connectedApp { operations.append($0) }
        app.consecutiveProtectedDNSBrokenAudits = AppState.protectedDNSBrokenAuditLimit - 1

        XCTAssertTrue(app.pauseIfProtectedDNSKeepsFailing())
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(operations, ["releaseAfterFailure"])
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertNotEqual(MenuBarProtectionStatus(app).kind, .blocked)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }

    func testSplitDNSConflictReleasesWithAIHold() async {
        let originalArmed = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = originalArmed }
        var operations: [String] = []
        let app = connectedApp { operations.append($0) }

        app.holdProtectedDNSSupplementalConflict([
            .init(source: "/etc/resolver/corp.example", domains: ["corp.example"], servers: ["10.0.0.53"]),
        ])
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(operations, ["releaseAfterFailure"])
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertNotEqual(MenuBarProtectionStatus(app).kind, .blocked)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }
}
