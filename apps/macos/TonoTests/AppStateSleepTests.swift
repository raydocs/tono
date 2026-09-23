import XCTest
@testable import Tono

/// R1-F2 regression: an explicit Restore internet whose privileged release
/// was still draining — parked on the administrator repair prompt for up to
/// 180 s — when the lid closed. The sleep path judged only aggregate state,
/// so it armed `resumeProtectionAfterWake`, enqueued a preserve teardown
/// behind the release, and wake recovery enqueued another; the release's own
/// completion was then dropped as a stale request (its
/// `isProtectionBlocked = false` never published) while the preserve
/// teardown's idle `restrictToBootstrap` success published Protected Offline
/// over the disarmed host and wake recovery reconnected. Sleep must keep the
/// user's release intent across the sleep: no resume flag, no preserve
/// teardown, no wake recovery, and the release alone settles the state.
/// XCTest cannot drive NSWorkspace sleep notifications or the privileged
/// helper; `prepareForSystemSleep` / `resumeAfterSystemWake` are driven
/// directly and every disconnect-path privileged call runs through the
/// `networkProtection` seam, exactly as the disconnect-owner tests do.
final class AppStateSleepTests: XCTestCase {

    /// Explicit suspension instead of sleeps, mirroring the coordinator test
    /// gates: the release teardown is genuinely in flight at the prompt, not
    /// a stubbed flag.
    private final class ReleaseGate: @unchecked Sendable {
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

    func testSleepDuringExplicitReleaseDoesNotConvertItIntoWakeReconnect() async {
        let app = AppState()
        // Connected through an armed session, so Restore internet has real
        // privileged work to undo: core stop, DNS restore, PF disarm.
        app.isConnected = true
        app.coreRuntime.isRunning = true
        KillSwitchService.isArmed = true
        let prompt = ReleaseGate()
        let promptShown = ReleaseGate()
        var runtime = NetworkProtectionOperations()
        // The administrator repair prompt: the release teardown parks here
        // while the machine sleeps and only continues once answered.
        runtime.repairForRelease = {
            promptShown.open()
            await prompt.wait()
        }
        runtime.stopCore = { coreRuntime in
            coreRuntime.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {
            // The release must finish as a disarm, never degrade into a
            // preserve that re-arms PF over the user's open-host request.
            guard KillSwitchService.isArmed else { return }
            XCTFail("a preserved PF must not be re-armed over the explicit release")
        }
        app.networkProtection = runtime
        // isArmed is UserDefaults-backed; never leak the fixture's armed
        // state into other tests, and never leave the teardown parked.
        defer {
            KillSwitchService.isArmed = false
            prompt.open()
        }

        // The user chooses Restore internet; teardown A blocks at the prompt.
        app.disconnect(releaseKillSwitch: true)
        await promptShown.wait()
        XCTAssertTrue(app.isDisconnecting)
        XCTAssertTrue(
            app.isProtectionBlocked,
            "the release keeps the UI protected until it commits"
        )

        // Lid closed, then opened again, while the prompt is still unanswered
        // (it could only be answered after wake). Pre-fix this armed
        // resumeProtectionAfterWake, enqueued a preserve teardown behind A,
        // and started wake recovery.
        app.prepareForSystemSleep()
        app.resumeAfterSystemWake()
        XCTAssertFalse(
            app.resumeProtectionAfterWake,
            "sleep must not arm wake recovery over an in-flight explicit release"
        )
        XCTAssertNil(
            app.connectionCoordinator.wakeRecoveryTask,
            "wake must not start recovery while the release still owns the teardown queue"
        )

        // The prompt is answered after wake: the release finishes alone and
        // its own completion publishes the released state — nothing superseded
        // it, so the request is not stale.
        prompt.open()
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertFalse(
            app.isProtectionBlocked,
            "a completed explicit release must not leave the UI claiming Kill Switch protection"
        )
        XCTAssertFalse(
            KillSwitchService.isArmed,
            "the release must complete its disarm across the sleep"
        )
        XCTAssertFalse(app.isDisconnecting)
    }
}
