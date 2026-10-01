import XCTest
@testable import Tono

/// A second main window runs `loadInitialData` from its own scene task while
/// the first apply is still in `installManagedExitCatalog`. The disk read was
/// already shared; the apply was not. The second apply has to join the first.
final class InitialDataApplyTests: XCTestCase {

    private final class ReloadGate: @unchecked Sendable {
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

    @MainActor
    func testSecondLoadInitialDataJoinsTheInFlightApply() async {
        let app = AppState()
        let gate = ReloadGate()
        let entered = expectation(description: "apply parked before disk")
        let joined = expectation(description: "second caller joined the apply")
        app.initialDataSnapshotOverride = InitialDiskSnapshot(
            proxyRegions: [],
            rules: [],
            cachedCatalog: nil,
            cachedTrafficPolicy: nil,
            config: nil
        )
        app.initialDataApplySuspension = {
            entered.fulfill()
            await gate.wait()
        }
        app.initialDataApplyJoined = {
            joined.fulfill()
        }

        let first = Task { @MainActor in
            await app.loadInitialData()
        }
        await fulfillment(of: [entered], timeout: 5)

        let second = Task { @MainActor in
            await app.loadInitialData()
        }
        await fulfillment(of: [joined], timeout: 5)
        XCTAssertEqual(app.initialDataApplyCount, 1)
        XCTAssertEqual(app.initialDataApplyJoinCount, 1)
        XCTAssertFalse(app.initialDataLoaded)

        gate.open()
        await first.value
        await second.value
        XCTAssertEqual(app.initialDataApplyCount, 1)
        XCTAssertTrue(app.initialDataLoaded)
    }
}
