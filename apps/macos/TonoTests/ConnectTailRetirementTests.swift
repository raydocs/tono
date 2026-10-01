import XCTest
@testable import Tono

/// X1-9 regression: the connect tail asks the helper whether an adopted
/// native update is pending, a blocking IPC that cancellation cannot
/// interrupt. A Disconnect or native-update suspend that retires the attempt
/// meanwhile (generation bump + task cancel) must win: the retired tail may
/// not commit the update or register monitors that no teardown waits for.
final class ConnectTailRetirementTests: XCTestCase {

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

    func testRetiredAttemptDoesNotCommitUpdateAfterStatusQuery() async {
        let app = AppState()
        app.isConnecting = true
        // Tono always connects with TUN; keeps the tail off the system proxy.
        app.config.tunEnabled = true
        let reached = Gate()
        let answer = Gate()
        var commits = 0
        app.nativeUpdateResume.pending = {
            reached.open()
            await answer.wait()
            return HelperManager.UpdateStatus(
                pending: true,
                receipt: nil,
                execution: nil,
                disconnectVerified: nil,
                diagnostic: nil
            )
        }
        app.nativeUpdateResume.commit = { commits += 1 }

        let tail = Task { await app.onCoreStarted(api: CoreControllerClient()) }
        await reached.wait()
        // The first steps of suspendForNativeUpdate / executeDisconnect.
        app.connectionCoordinator.bumpGeneration()
        tail.cancel()
        answer.open()
        let committed = await tail.value

        XCTAssertFalse(committed)
        XCTAssertEqual(commits, 0, "a retired attempt must not commit the update")
        XCTAssertNil(
            app.connectionCoordinator.coreMonitorTask,
            "a retired attempt must not register a monitor"
        )
    }
}
