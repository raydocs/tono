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
        XCTAssertEqual(
            app.errorMessage, String(localized: "Protected DNS did not take effect after repeated reconnects: macOS is still resolving through another DNS server. Tono is restoring this Mac's normal internet; AI services stay blocked."),
            "the release is only queued; PF may still hold the host"
        )
        await app.connectionCoordinator.disconnectSequence?.value
        await app.dnsFailureReleaseNoticeTask?.value

        XCTAssertEqual(operations, ["releaseAfterFailure"])
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertEqual(app.errorMessage, String(localized: "Protected DNS did not take effect after repeated reconnects: macOS is still resolving through another DNS server. This Mac is back on its normal internet and AI services stay blocked. Connect again when you are ready."))
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
        XCTAssertTrue(app.errorMessage?.hasPrefix(String(localized: "DNS conflict: a corporate VPN, profile or /etc/resolver rule sends some domains to a DNS server outside Tono's protection. Tono is restoring this Mac's normal internet; AI services stay blocked. Turn that rule off, then connect again.")) ?? false)
        await app.connectionCoordinator.disconnectSequence?.value
        await app.dnsFailureReleaseNoticeTask?.value

        XCTAssertEqual(operations, ["releaseAfterFailure"])
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.errorMessage?.hasPrefix(String(localized: "DNS conflict: a corporate VPN, profile or /etc/resolver rule sends some domains to a DNS server outside Tono's protection. This Mac is back on its normal internet and AI services stay blocked. Turn that rule off, then connect again.")) ?? false)
        XCTAssertNotEqual(MenuBarProtectionStatus(app).kind, .blocked)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }
}
