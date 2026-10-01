import XCTest
@testable import Tono

@MainActor
final class NativeUpdateReleaseArbitrationTests: XCTestCase {
    private enum Failure: Error { case committed }

    private final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var isOpen = false
        private var waiter: CheckedContinuation<Void, Never>?

        func wait() async {
            lock.lock()
            if isOpen {
                lock.unlock()
                return
            }
            await withCheckedContinuation { continuation in
                waiter = continuation
                lock.unlock()
            }
        }

        func open() {
            lock.lock()
            isOpen = true
            let pending = waiter
            waiter = nil
            lock.unlock()
            pending?.resume()
        }
    }

    /// #1132: an explicit Restore that joins a running automatic release still
    /// removes the AI hold once that release settles.
    func testExplicitRestoreJoiningAutomaticReleaseRemovesAIHold() async {
        let armed = KillSwitchService.isArmed
        let pending = RuntimeCleanup.nativeUpdatePending
        let blocked = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdatePending = pending
            RuntimeCleanup.nativeUpdateBlocksConnect = blocked
        }
        KillSwitchService.isArmed = true
        RuntimeCleanup.nativeUpdatePending = true
        let app = AppState()
        var calls: [String] = []
        var aiHold = false
        let entered = Gate()
        let answer = Gate()
        app.nativeUpdateReleaseAfterFailure = {
            calls.append("automatic")
            entered.open()
            await answer.wait()
            aiHold = true
            return .init(pending: true, receipt: nil, execution: nil,
                         disconnectVerified: true, diagnostic: nil)
        }
        app.nativeUpdateDisconnect = {
            calls.append("explicit")
            aiHold = false
            return .init(pending: true, receipt: nil, execution: nil,
                         disconnectVerified: true, diagnostic: nil)
        }

        app.disconnect(releaseKillSwitch: true, automaticFailureRelease: true)
        await entered.wait()
        app.disconnect(releaseKillSwitch: true) // menu Restore while the helper works
        answer.open()
        while let task = app.nativeUpdateDisconnectTask { await task.value }

        XCTAssertEqual(calls, ["automatic", "explicit"])
        XCTAssertFalse(aiHold, "the user's Restore removes the AI hold")
        XCTAssertFalse(KillSwitchService.isArmed)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.nativeUpdatePending, "release retains update evidence")
        XCTAssertTrue(RuntimeCleanup.nativeUpdateBlocksConnect)
    }

    /// #1151: Commit finished while the connect drained, so the helper refuses
    /// the pending-only Disconnect. Authoritative status hands release to the
    /// ordinary teardown and retires the stale local gates.
    func testRestoreAfterCommitDuringDrainRunsOrdinaryRelease() async {
        let armed = KillSwitchService.isArmed
        let pending = RuntimeCleanup.nativeUpdatePending
        let blocked = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdatePending = pending
            RuntimeCleanup.nativeUpdateBlocksConnect = blocked
        }
        KillSwitchService.isArmed = true
        RuntimeCleanup.nativeUpdatePending = true
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        let app = AppState()
        app.isConnected = true
        app.nativeUpdateDisconnect = { throw Failure.committed }
        app.nativeUpdateStatus = {
            .init(pending: false, receipt: nil, execution: nil,
                  disconnectVerified: nil, diagnostic: nil)
        }
        var disarms = 0
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { disarms += 1 }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertEqual(disarms, 1, "ordinary explicit release ran")
        XCTAssertFalse(app.nativeUpdatePending)
        XCTAssertFalse(RuntimeCleanup.nativeUpdatePending)
        XCTAssertFalse(RuntimeCleanup.nativeUpdateBlocksConnect)
        XCTAssertNil(app.errorMessage, "the refused pending-only Disconnect is not surfaced")
    }
}
