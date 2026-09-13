import XCTest
@testable import Tono

@MainActor
final class ConnectionCoordinatorTests: XCTestCase {
    func testReconnectBackoffDelaysStayTwoFiveTenTwentyThirty() {
        XCTAssertEqual(ProtectedReconnectSchedule.delaysSeconds, [2, 5, 10, 20, 30])
        XCTAssertEqual(ProtectedReconnectSchedule.networkChangeKickCooldown, 30)
    }

    func testFinalEndpointFailureRecoversWithoutCommittingOrOverridingANewerOwner() async {
        enum ArmFailure: Error { case injected }
        let coordinator = ConnectionCoordinator()
        var events: [String] = ["union", "selector", "probe"]
        let completed = await coordinator.finishNodeSwitch(generation: coordinator.protectionOperationGeneration, converge: {
            events.append("new-only")
            throw ArmFailure.injected
        }, commit: {
            events.append("connected")
        }, recover: { _ in
            events.append("protected-recovery")
        })
        XCTAssertFalse(completed)
        XCTAssertEqual(events, ["union", "selector", "probe", "new-only", "protected-recovery"])

        // A completed IPC from an older generation must not repaint or restart after release.
        let retired = await coordinator.finishNodeSwitch(generation: coordinator.protectionOperationGeneration, converge: {
            coordinator.bumpGeneration()
            throw ArmFailure.injected
        }, commit: { XCTFail("retired switch cannot commit") },
           recover: { _ in XCTFail("newer owner controls recovery") })
        XCTAssertFalse(retired)
    }

    func testRetiredNodeSwitchCannotAdoptTheGenerationBumpedBeforeFinalization() async {
        let coordinator = ConnectionCoordinator()
        let switchGeneration = coordinator.protectionOperationGeneration
        // Wake invalidates the owner before its queued disconnect cancels the old task.
        coordinator.bumpGeneration()
        let completed = await coordinator.finishNodeSwitch(generation: switchGeneration, converge: {
            XCTFail("retired switch must not start another privileged operation")
        }, commit: {
            XCTFail("retired switch must not adopt the wake generation")
        }, recover: { _ in
            XCTFail("retired switch must not replace the wake recovery intent")
        })
        XCTAssertFalse(completed)
    }

    func testCoordinatorOwnsGenerationAndStartsAtZero() {
        let coordinator = ConnectionCoordinator()
        XCTAssertEqual(coordinator.protectionOperationGeneration, 0)
        XCTAssertNil(coordinator.connectAttemptID)
        XCTAssertNil(coordinator.connectTask)
        coordinator.bumpGeneration()
        XCTAssertEqual(coordinator.protectionOperationGeneration, 1)
        coordinator.bumpGeneration()
        XCTAssertEqual(coordinator.protectionOperationGeneration, 2)
    }

    func testDeferredConnectWaitsForDisconnectToFinish() async {
        let coordinator = ConnectionCoordinator()
        let gate = DisconnectGate()
        var disconnected = false
        coordinator.enqueueDisconnect { _ in
            await gate.wait()
            disconnected = true
        }
        var connected = false
        let request = coordinator.connectAfterDisconnect {
            XCTAssertTrue(disconnected)
            connected = true
        }
        XCTAssertFalse(connected)
        gate.open()
        await request.value
        XCTAssertTrue(connected)
    }

    func testExplicitReleaseInvalidatesQueuedConnectWithoutCancellingTeardown() async {
        let coordinator = ConnectionCoordinator()
        let gate = DisconnectGate()
        var teardownWasCancelled = false
        coordinator.enqueueDisconnect { _ in
            await gate.wait()
            teardownWasCancelled = Task.isCancelled
        }
        var connected = false
        let request = coordinator.connectAfterDisconnect { connected = true }
        // Disconnect, Sign Out and explicit release invalidate the generation.
        coordinator.bumpGeneration()
        gate.open()
        await request.value
        XCTAssertFalse(connected)
        XCTAssertFalse(teardownWasCancelled)
    }

    func testRepeatedConnectClicksKeepOnlyLatestRequest() async {
        let coordinator = ConnectionCoordinator()
        let gate = DisconnectGate()
        coordinator.enqueueDisconnect { _ in await gate.wait() }
        var calls: [String] = []
        let first = coordinator.connectAfterDisconnect { calls.append("first") }
        let second = coordinator.connectAfterDisconnect { calls.append("second") }
        gate.open()
        await first.value
        await second.value
        XCTAssertEqual(calls, ["second"])
    }

    func testRetiredRequestCannotClearNewGenerationRequest() async {
        let coordinator = ConnectionCoordinator()
        let gate = DisconnectGate()
        coordinator.enqueueDisconnect { _ in await gate.wait() }
        var calls: [String] = []
        let old = coordinator.connectAfterDisconnect { calls.append("old") }
        coordinator.bumpGeneration()
        let current = coordinator.connectAfterDisconnect { calls.append("current") }
        gate.open()
        await old.value
        await current.value
        XCTAssertEqual(calls, ["current"])
    }

    func testNewDisconnectInvalidatesQueuedConnectEvenWithoutAnotherGenerationBump() async {
        let coordinator = ConnectionCoordinator()
        let gate = DisconnectGate()
        coordinator.enqueueDisconnect { _ in await gate.wait() }
        var connected = false
        let request = coordinator.connectAfterDisconnect { connected = true }
        coordinator.enqueueDisconnect { _ in }
        gate.open()
        await request.value
        await coordinator.disconnectSequence?.value
        XCTAssertFalse(connected)
    }

    func testDeferredConnectMayBeginItsOwnGeneration() async {
        let coordinator = ConnectionCoordinator()
        var calls = 0
        let request = coordinator.connectAfterDisconnect {
            coordinator.bumpGeneration()
            XCTAssertFalse(Task.isCancelled)
            calls += 1
        }
        await request.value
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(coordinator.protectionOperationGeneration, 1)
    }

    func testDisconnectDrainsCancelledMutationBeforeAnyReleaseStep() async {
        let coordinator = ConnectionCoordinator()
        let gate = DisconnectGate()
        var events: [String] = []
        let mutation = Task {
            await gate.wait()
            // A non-cancellable helper call may commit after cancellation.
            events.append("late-arm")
        }
        mutation.cancel()
        coordinator.enqueueDisconnect(waitingFor: [mutation]) { _ in
            events.append(contentsOf: ["stop-core", "restore-dns", "release-pf"])
        }
        gate.open()
        await coordinator.disconnectSequence?.value
        XCTAssertEqual(events, ["late-arm", "stop-core", "restore-dns", "release-pf"])
    }

    func testDisconnectRequestsStaySerializedButOnlyLatestPublishesState() async {
        let coordinator = ConnectionCoordinator()
        let gate = DisconnectGate()
        var operations: [String] = []
        var published: [String] = []
        coordinator.enqueueDisconnect { id in
            await gate.wait()
            operations.append("preserve-protection")
            coordinator.completeDisconnect(id) { published.append("stale-offline") }
        }
        coordinator.enqueueDisconnect { id in
            operations.append("explicit-release")
            coordinator.completeDisconnect(id) { published.append("released") }
        }
        gate.open()
        await coordinator.disconnectSequence?.value
        XCTAssertEqual(operations, ["preserve-protection", "explicit-release"])
        XCTAssertEqual(published, ["released"])
    }
}

/// Explicit suspension instead of sleeps: teardown may complete before or after
/// the queued request starts, but neither scheduling order can bypass the gate.
@MainActor
private final class DisconnectGate {
    private var isOpen = false
    private var waiter: CheckedContinuation<Void, Never>?

    func wait() async {
        guard !isOpen else { return }
        await withCheckedContinuation { waiter = $0 }
    }

    func open() {
        isOpen = true
        waiter?.resume()
        waiter = nil
    }
}
