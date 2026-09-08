import XCTest
@testable import Tono

@MainActor
final class AccountLifecycleCoordinatorTests: XCTestCase {
    func testCleanupDrainsLateWorkAndRejectsNewSignIn() async {
        let coordinator = AccountLifecycleCoordinator()
        let entered = LifecycleGate()
        let release = LifecycleGate()
        var events: [String] = []
        let work = Task {
            await coordinator.run {
                entered.open()
                await release.wait() // a side effect that ignores cancellation
                XCTAssertTrue(Task.isCancelled)
                events.append("old-work-finished")
            }
        }
        await entered.wait()
        let cleanup = coordinator.enqueueCleanup(kind: .signOut) { events.append("logout") }
        XCTAssertTrue(coordinator.isBusy)
        await coordinator.run { events.append("must-not-sign-in") }
        XCTAssertEqual(events, [])
        release.open()
        await cleanup.value
        await work.value
        XCTAssertEqual(events, ["old-work-finished", "logout"])
        XCTAssertFalse(coordinator.isBusy)
        await coordinator.run { events.append("new-sign-in") }
        XCTAssertEqual(events.last, "new-sign-in")
    }

    func testRepeatedLogoutJoinsOneCleanup() async {
        let coordinator = AccountLifecycleCoordinator()
        var calls = 0
        let first = coordinator.enqueueCleanup(kind: .signOut) { calls += 1 }
        let second = coordinator.enqueueCleanup(kind: .signOut) { calls += 100 }
        await first.value
        await second.value
        XCTAssertEqual(calls, 1)
        XCTAssertFalse(coordinator.isBusy)
    }

    func testDifferentCleanupIntentsRemainOrderedAndKeepTheBarrier() async {
        let coordinator = AccountLifecycleCoordinator()
        let firstEntered = LifecycleGate()
        let firstRelease = LifecycleGate()
        let secondEntered = LifecycleGate()
        let secondRelease = LifecycleGate()
        var events: [String] = []
        let first = coordinator.enqueueCleanup(kind: .releaseProtection) {
            firstEntered.open()
            await firstRelease.wait()
            events.append("release")
        }
        await firstEntered.wait()
        let second = coordinator.enqueueCleanup(kind: .signOut) {
            secondEntered.open()
            await secondRelease.wait()
            events.append("logout")
        }
        firstRelease.open()
        await first.value
        await secondEntered.wait()
        XCTAssertTrue(coordinator.isBusy) // old cleanup cannot clear the new slot
        await coordinator.run { events.append("must-not-sign-in") }
        secondRelease.open()
        await second.value
        XCTAssertEqual(events, ["release", "logout"])
        XCTAssertFalse(coordinator.isBusy)
    }

    func testCancellingTheOwnerCancelsWorkButAllowsAFreshAttempt() async {
        let coordinator = AccountLifecycleCoordinator()
        let entered = LifecycleGate()
        let release = LifecycleGate()
        var cancelled = false
        let owner = Task {
            await coordinator.run {
                entered.open()
                await release.wait()
                cancelled = Task.isCancelled
            }
        }
        await entered.wait()
        owner.cancel()
        release.open()
        await owner.value
        XCTAssertTrue(cancelled)
        XCTAssertFalse(coordinator.isBusy)
        var restarted = false
        await coordinator.run { restarted = true }
        XCTAssertTrue(restarted)
    }

    func testCancellingACleanupWaiterDoesNotCancelPrivilegedCleanup() async {
        let coordinator = AccountLifecycleCoordinator()
        let entered = LifecycleGate()
        let release = LifecycleGate()
        var cleanupWasCancelled = false
        let waiter = Task {
            await coordinator.enqueueCleanup(kind: .signOut) {
                entered.open()
                await release.wait()
                cleanupWasCancelled = Task.isCancelled
            }.value
        }
        await entered.wait()
        waiter.cancel()
        release.open()
        await waiter.value
        XCTAssertFalse(cleanupWasCancelled)
        XCTAssertFalse(coordinator.isBusy)
    }

    func testAlreadyCancelledIntentDoesNotStartWork() async {
        let coordinator = AccountLifecycleCoordinator()
        var started = false
        let owner = Task { await coordinator.run { started = true } }
        owner.cancel()
        await owner.value
        XCTAssertFalse(started)
        XCTAssertFalse(coordinator.isBusy)
    }
}

@MainActor
private final class LifecycleGate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        guard !opened else { return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func open() {
        opened = true
        let pending = waiters
        waiters.removeAll()
        for waiter in pending { waiter.resume() }
    }
}
