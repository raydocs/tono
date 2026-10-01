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
}
