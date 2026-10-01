import XCTest
@testable import Tono

/// A cancel in the last poll interval used to fall out of the loop and
/// report utun199 present. Connect arms PF before it notices the cancel.
final class OwnedTunnelWaitTests: XCTestCase {

    private final class Probe: @unchecked Sendable {
        private let lock = NSLock()
        private var calls = 0
        private var continuation: CheckedContinuation<Void, Never>?

        func exists(_ name: String) -> Bool {
            lock.lock()
            calls += 1
            let seen = calls
            lock.unlock()
            return seen > 1
        }

        func park() async {
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                lock.lock()
                continuation = cont
                lock.unlock()
            }
        }

        func resume() {
            lock.lock()
            let pending = continuation
            continuation = nil
            lock.unlock()
            pending?.resume()
        }
    }

    func testCancelDuringTheLastSleepDoesNotReportTheInterface() async {
        let probe = Probe()
        let entered = expectation(description: "parked in the last sleep")
        let task = Task {
            await AppState.waitForOwnedTunnelInterface(
                attempts: 1,
                intervalMs: 60_000,
                interfaceExists: { probe.exists($0) },
                sleep: { _ in
                    entered.fulfill()
                    await probe.park()
                }
            )
        }
        await fulfillment(of: [entered], timeout: 5)
        task.cancel()
        probe.resume()
        let ready = await task.value
        XCTAssertFalse(
            ready,
            "a cancel in the last interval must not arm on an interface that appears as the wait ends"
        )
    }
}
