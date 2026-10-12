import XCTest
@testable import Tono

@MainActor
final class NativeUpdateWakeRetirementTests: XCTestCase {
    func testUpdateDisconnectCancelsAndDrainsTheWakeOwnerBeforeReleasing() async throws {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        let didStartCore = AppProfile.defaults.object(forKey: SettingsKey.didStartCore)
        let lastTunEnabled = AppProfile.defaults.object(forKey: SettingsKey.lastTunEnabled)
        let app = AppState()
        let reassertEntered = Gate()
        let reassertReply = Gate()
        let suspensionEntered = Gate()
        var releaseStarted = false
        KillSwitchService.isArmed = true
        app.networkProtection.reassertKillSwitch = {
            reassertEntered.open()
            // Helper IPC cannot be interrupted by Task cancellation.
            await reassertReply.wait()
            return true
        }
        app.nativeUpdateDisconnect = {
            releaseStarted = true
            return .init(pending: true, receipt: nil, execution: "staged",
                         disconnectVerified: true, diagnostic: nil)
        }
        defer {
            app.connectionCoordinator.cancelReconnectTasks()
            reassertReply.open()
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
            AppProfile.defaults.set(didStartCore, forKey: SettingsKey.didStartCore)
            AppProfile.defaults.set(lastTunEnabled, forKey: SettingsKey.lastTunEnabled)
        }

        app.resumeAfterSystemWake()
        await reassertEntered.wait()
        let wake = try XCTUnwrap(app.connectionCoordinator.wakeRecoveryTask)
        // This task confirms that suspension has cancelled its captured work;
        // no sleep or scheduling assumption controls the assertions below.
        app.connectionCoordinator.coreMonitorTask = Task {
            do { try await Task.sleep(for: .seconds(60)) }
            catch { suspensionEntered.open() }
        }
        app.disconnectPendingNativeUpdate()
        let disconnect = try XCTUnwrap(app.nativeUpdateDisconnectTask)
        await suspensionEntered.wait()

        XCTAssertTrue(wake.isCancelled, "the update must retire the old wake intent")
        XCTAssertFalse(releaseStarted, "release must wait for the in-flight wake IPC")
        XCTAssertNotNil(app.connectionCoordinator.wakeRecoveryTask,
                        "retain the captured owner until its work drains")
        // Also clean up on the baseline, where suspension failed to cancel it.
        wake.cancel()
        reassertReply.open()
        await disconnect.value
        await wake.value

        XCTAssertTrue(releaseStarted)
        XCTAssertNil(app.connectionCoordinator.wakeRecoveryTask)
        XCTAssertNil(app.connectionCoordinator.sleepRestrictTask)
        XCTAssertFalse(app.resumeProtectionAfterWake)
        XCTAssertFalse(app.isConnecting, "the retired wake cannot start another connection")
    }

    /// Decision 092 case: an update failed and the user chose Restore
    /// internet, but a cancelled connect mutation never returns. At the
    /// UI deadline the UI publishes unknown with the recovery text,
    /// nothing is released early and the armed intent stays; once the drain
    /// ends, exactly one `/update/disconnect` runs and replaces the result.
    func testOverdueUpdateReleaseDrainPublishesUnknownThenOneDisconnect() async throws {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        let didStartCore = AppProfile.defaults.object(forKey: SettingsKey.didStartCore)
        let lastTunEnabled = AppProfile.defaults.object(forKey: SettingsKey.lastTunEnabled)
        let drain = Gate()
        defer {
            drain.open()
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
            AppProfile.defaults.set(didStartCore, forKey: SettingsKey.didStartCore)
            AppProfile.defaults.set(lastTunEnabled, forKey: SettingsKey.lastTunEnabled)
        }
        KillSwitchService.isArmed = true
        let app = AppState()
        app.connectionCoordinator.explicitReleaseDeadline = .milliseconds(50)
        var disconnects = 0
        app.nativeUpdateDisconnect = {
            disconnects += 1
            return .init(pending: true, receipt: nil, execution: "staged",
                         disconnectVerified: true, diagnostic: nil)
        }
        app.connectionCoordinator.connectTask = Task { await drain.wait() }

        app.disconnectPendingNativeUpdate()
        let release = try XCTUnwrap(app.nativeUpdateDisconnectTask)
        for _ in 0..<500 where app.errorMessage == nil {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertEqual(app.errorMessage, AppState.releaseStillFinishingMessage)
        XCTAssertTrue(app.isProtectionUnconfirmed, "the interim result is unknown")
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertEqual(disconnects, 0, "nothing is released while the drain is pending")
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertTrue(app.teardownInFlight, "automatic work still waits")

        drain.open()
        await release.value

        XCTAssertEqual(disconnects, 1, "the same release runs once after the drain")
        XCTAssertFalse(app.isProtectionUnconfirmed)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(KillSwitchService.isArmed)
        XCTAssertNil(app.errorMessage)
        XCTAssertFalse(app.teardownInFlight)
    }

    /// Late-completion race: the deadline published unknown while
    /// `/update/disconnect` was still in flight, then a newer protection
    /// generation settled its own state. The old reply arrives verified, but
    /// its generation is retired, so it must not overwrite the newer state or
    /// clear the armed intent.
    func testLateUpdateReleaseFromRetiredGenerationDoesNotOverwriteNewerState() async throws {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        let didStartCore = AppProfile.defaults.object(forKey: SettingsKey.didStartCore)
        let lastTunEnabled = AppProfile.defaults.object(forKey: SettingsKey.lastTunEnabled)
        let reply = Gate()
        defer {
            reply.open()
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
            AppProfile.defaults.set(didStartCore, forKey: SettingsKey.didStartCore)
            AppProfile.defaults.set(lastTunEnabled, forKey: SettingsKey.lastTunEnabled)
        }
        KillSwitchService.isArmed = true
        let app = AppState()
        app.connectionCoordinator.explicitReleaseDeadline = .milliseconds(50)
        var disconnects = 0
        app.nativeUpdateDisconnect = {
            disconnects += 1
            // Helper IPC cannot be interrupted by Task cancellation.
            await reply.wait()
            return .init(pending: true, receipt: nil, execution: "staged",
                         disconnectVerified: true, diagnostic: nil)
        }

        app.disconnectPendingNativeUpdate()
        let release = try XCTUnwrap(app.nativeUpdateDisconnectTask)
        for _ in 0..<500 where app.errorMessage == nil {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(app.errorMessage, AppState.releaseStillFinishingMessage)
        XCTAssertEqual(disconnects, 1)

        // A newer owner settles: protection held, with its own message.
        app.connectionCoordinator.bumpGeneration()
        let newer = app.connectionCoordinator.protectionOperationGeneration
        app.isProtectionBlocked = true
        app.errorMessage = "newer owner"
        reply.open()
        await release.value

        XCTAssertEqual(app.connectionCoordinator.protectionOperationGeneration, newer)
        XCTAssertTrue(app.isProtectionBlocked, "the retired reply cannot publish released")
        XCTAssertEqual(app.errorMessage, "newer owner")
        XCTAssertTrue(KillSwitchService.isArmed, "the retired reply cannot clear the intent")
        XCTAssertFalse(app.teardownInFlight)
    }

    private final class Gate {
        private var isOpen = false
        private var waiter: CheckedContinuation<Void, Never>?

        func wait() async {
            guard !isOpen else { return }
            await withCheckedContinuation { waiter = $0 }
        }

        func open() {
            guard !isOpen else { return }
            isOpen = true
            waiter?.resume()
            waiter = nil
        }
    }

    /// One-click release during a pending native update: suspension retires
    /// the unarmed reconnect too, so a late retry cannot reconnect (and
    /// re-block) after the update's explicit Disconnect.
    func testUpdateSuspensionCancelsTheUnarmedReconnect() async {
        let app = AppState()
        let retry = Task<Void, Never> { try? await Task.sleep(nanoseconds: 60_000_000_000) }
        app.connectionCoordinator.unarmedReconnectTask = retry
        defer { retry.cancel() }

        await app.suspendForNativeUpdate()

        XCTAssertTrue(retry.isCancelled, "the unarmed reconnect survived the update suspension")
    }
}
