import XCTest
@testable import Tono

@MainActor
final class NativeUpdateDisconnectReadbackTests: XCTestCase {
    private enum Failure: Error { case lostAcknowledgement }

    func testLostDisconnectReplyWithReleasedPFDoesNotClaimProtectionOrRetireUpdate() async {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        let didStartCore = AppProfile.defaults.object(forKey: SettingsKey.didStartCore)
        let lastTunEnabled = AppProfile.defaults.object(forKey: SettingsKey.lastTunEnabled)
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
            AppProfile.defaults.set(didStartCore, forKey: SettingsKey.didStartCore)
            AppProfile.defaults.set(lastTunEnabled, forKey: SettingsKey.lastTunEnabled)
        }
        KillSwitchService.isArmed = true
        RuntimeCleanup.markCoreStarted(tunEnabled: true)
        let app = AppState()
        app.isConnected = true
        app.isProtectionBlocked = true
        var reads = 0
        app.nativeUpdateDisconnect = { throw Failure.lostAcknowledgement }
        app.protectionAudits.killSwitchHealth = {
            reads += 1
            return (wanted: false, live: false, repairedSinceArm: false)
        }

        app.disconnectPendingNativeUpdate()
        await app.nativeUpdateDisconnectTask?.value

        XCTAssertEqual(reads, 1)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectionUnconfirmed)
        XCTAssertFalse(KillSwitchService.isArmed)
        XCTAssertEqual(MenuBarProtectionStatus(app).kind, .standby)
        XCTAssertTrue(app.nativeUpdatePending, "PF readback cannot retire update evidence")
        XCTAssertTrue(RuntimeCleanup.nativeUpdateBlocksConnect)
        XCTAssertTrue(AppProfile.defaults.bool(forKey: SettingsKey.didStartCore),
                      "PF-only readback cannot certify Core/DNS teardown")
        XCTAssertNotNil(app.errorMessage, "the lost update result remains actionable")
    }

    func testLostDisconnectReplyWithoutPFReadbackShowsUnknownInsteadOfProtected() async {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        KillSwitchService.isArmed = true
        let app = AppState()
        app.isProtectionBlocked = true
        app.nativeUpdateDisconnect = { throw Failure.lostAcknowledgement }
        app.protectionAudits.killSwitchHealth = { nil }

        app.disconnectPendingNativeUpdate()
        await app.nativeUpdateDisconnectTask?.value

        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.isProtectionUnconfirmed)
        XCTAssertTrue(KillSwitchService.isArmed, "unknown does not clear stored intent")
        XCTAssertEqual(MenuBarProtectionStatus(app).kind, .unconfirmed)
        XCTAssertTrue(app.nativeUpdatePending)
        XCTAssertTrue(RuntimeCleanup.nativeUpdateBlocksConnect)
    }

    func testWantedButNotLiveReadbackDoesNotClaimProtectedOffline() async {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        KillSwitchService.isArmed = true
        let app = AppState()
        app.nativeUpdateDisconnect = { throw Failure.lostAcknowledgement }
        app.protectionAudits.killSwitchHealth = {
            (wanted: true, live: false, repairedSinceArm: false)
        }

        app.disconnectPendingNativeUpdate()
        await app.nativeUpdateDisconnectTask?.value

        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.isProtectionUnconfirmed)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertEqual(MenuBarProtectionStatus(app).kind, .unconfirmed)
    }

    func testLiveReadbackKeepsProtectedOfflineAndPendingUpdate() async {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        KillSwitchService.isArmed = true
        let app = AppState()
        app.nativeUpdateDisconnect = { throw Failure.lostAcknowledgement }
        var reads = 0
        app.protectionAudits.killSwitchHealth = {
            reads += 1
            return (wanted: true, live: true, repairedSinceArm: false)
        }

        app.disconnectPendingNativeUpdate()
        await app.nativeUpdateDisconnectTask?.value

        XCTAssertEqual(reads, 1)
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectionUnconfirmed)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertEqual(MenuBarProtectionStatus(app).kind, .blocked)
        XCTAssertTrue(app.nativeUpdatePending)
        XCTAssertTrue(RuntimeCleanup.nativeUpdateBlocksConnect)
    }

    func testReadbackOvertakenByNewProtectionGenerationCannotReplaceNewVerdict() async {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        KillSwitchService.isArmed = true
        let app = AppState()
        app.nativeUpdateDisconnect = { throw Failure.lostAcknowledgement }
        app.protectionAudits.killSwitchHealth = {
            app.connectionCoordinator.bumpGeneration()
            app.isProtectionBlocked = false
            app.isProtectionUnconfirmed = true
            return (wanted: false, live: false, repairedSinceArm: false)
        }

        app.disconnectPendingNativeUpdate()
        await app.nativeUpdateDisconnectTask?.value

        XCTAssertTrue(KillSwitchService.isArmed, "a stale release cannot clear newer intent")
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.isProtectionUnconfirmed)
        XCTAssertNil(app.errorMessage, "a retired result cannot overwrite newer presentation")
    }

    func testActivationOfPendingUpdateUsesLivePFInsteadOfDesiredIntent() async {
        let armed = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = armed }
        KillSwitchService.isArmed = true
        let app = AppState()
        app.nativeUpdatePending = true
        app.isProtectionUnconfirmed = true
        var reads = 0
        app.protectionAudits.killSwitchHealth = {
            reads += 1
            return (wanted: true, live: false, repairedSinceArm: false)
        }
        app.networkProtection.refreshKillSwitchStatus = {
            XCTFail("Desired intent alone must not resolve native-update live protection")
            return .confirmed(requiresProtectionRecovery: true)
        }

        await app.resolveUnconfirmedProtection()

        XCTAssertEqual(reads, 1)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.isProtectionUnconfirmed)
        XCTAssertEqual(MenuBarProtectionStatus(app).kind, .unconfirmed)
        XCTAssertTrue(KillSwitchService.isArmed)
    }

    func testVerifiedDisconnectClearsPreviousUnknownWithoutExtraReadback() async {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        let didStartCore = AppProfile.defaults.object(forKey: SettingsKey.didStartCore)
        let lastTunEnabled = AppProfile.defaults.object(forKey: SettingsKey.lastTunEnabled)
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
            AppProfile.defaults.set(didStartCore, forKey: SettingsKey.didStartCore)
            AppProfile.defaults.set(lastTunEnabled, forKey: SettingsKey.lastTunEnabled)
        }
        KillSwitchService.isArmed = true
        RuntimeCleanup.markCoreStarted(tunEnabled: true)
        let app = AppState()
        app.isProtectionUnconfirmed = true
        app.nativeUpdateDisconnect = {
            .init(pending: true, receipt: nil, execution: nil,
                  disconnectVerified: true, diagnostic: nil)
        }
        app.protectionAudits.killSwitchHealth = {
            XCTFail("A verified complete disconnect already proves release")
            return nil
        }

        app.disconnectPendingNativeUpdate()
        await app.nativeUpdateDisconnectTask?.value

        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectionUnconfirmed)
        XCTAssertFalse(KillSwitchService.isArmed)
        XCTAssertFalse(AppProfile.defaults.bool(forKey: SettingsKey.didStartCore))
        XCTAssertTrue(app.nativeUpdatePending)
        XCTAssertTrue(RuntimeCleanup.nativeUpdateBlocksConnect)
    }
}
