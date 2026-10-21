import XCTest
@testable import TonoKit

/// The latest tunnel switch wins over a start still waiting on the system. Each system wait is a
/// pause the test releases by hand; every handshake is bounded by main-actor turns, never by time.
final class TunnelStartCoordinatorTests: XCTestCase {
    @MainActor
    func testCancelDuringConfigurationDiscoveryCannotStartOrArmOnDemand() async throws {
        let lifecycle = TunnelStartCoordinator()
        let system = FakeConfiguration()
        let discovery = Pause()
        system.pauseRefresh = discovery
        let starting = Task { try await lifecycle.start(system) }
        let discovering = await turns(until: { discovery.reached })
        XCTAssertTrue(discovering)
        let cancelling = Task { await lifecycle.stop(system) }
        let queued = await turns(until: { lifecycle.waiting == 1 })
        XCTAssertTrue(queued)
        discovery.release()
        let outcome = try await starting.value
        await cancelling.value
        XCTAssertEqual(outcome, .superseded)
        XCTAssertEqual(system.saves, 0)
        XCTAssertEqual(system.starts, 0)
        XCTAssertFalse(system.onDemandEnabled)
    }

    @MainActor
    func testSynchronousInvalidationBeforeAnAccountWaitDisownsAPreparingStart() async throws {
        let lifecycle = TunnelStartCoordinator()
        let system = FakeConfiguration()
        let save = Pause()
        system.pauseSave = save
        let starting = Task { try await lifecycle.start(system) }
        let saving = await turns(until: { save.reached })
        XCTAssertTrue(saving)
        lifecycle.cancelPendingStart()
        save.release()
        let outcome = try await starting.value
        XCTAssertEqual(outcome, .superseded)
        XCTAssertEqual(system.starts, 0)
        XCTAssertFalse(system.onDemandEnabled)
    }

    /// The user cancels while iOS still saves the first configuration (the "Add VPN Configurations"
    /// prompt): the save lands after the Cancel, yet nothing starts and its On Demand is taken off.
    @MainActor
    func testCancelWhileTheFirstSaveAwaitsStartsNothingAndLeavesOnDemandOff() async throws {
        let lifecycle = TunnelStartCoordinator()
        let system = FakeConfiguration()
        let save = Pause()
        system.pauseSave = save
        let starting = Task { try await lifecycle.start(system) }
        let saving = await turns(until: { save.reached })
        XCTAssertTrue(saving)
        let before = lifecycle.generation
        let cancelling = Task { await lifecycle.stop(system) }
        let queued = await turns(until: { lifecycle.waiting == 1 })
        XCTAssertTrue(queued)
        XCTAssertEqual(lifecycle.generation, before + 1)
        save.release()
        let outcome = try await starting.value
        await cancelling.value
        XCTAssertEqual(outcome, .superseded)
        XCTAssertEqual(system.starts, 0)
        XCTAssertTrue(system.saved)
        XCTAssertFalse(system.onDemandEnabled)
        XCTAssertEqual(system.stops, 1)
    }

    /// The Cancel lands between the save and the reload Apple requires before a start.
    @MainActor
    func testCancelAfterTheSaveBeforeTheReloadStartsNothingAndLeavesOnDemandOff() async throws {
        let lifecycle = TunnelStartCoordinator()
        let system = FakeConfiguration()
        let reload = Pause()
        system.pauseReload = reload
        let starting = Task { try await lifecycle.start(system) }
        let reloading = await turns(until: { reload.reached })
        XCTAssertTrue(reloading)
        XCTAssertTrue(system.onDemandEnabled)
        let cancelling = Task { await lifecycle.stop(system) }
        let queued = await turns(until: { lifecycle.waiting == 1 })
        XCTAssertTrue(queued)
        reload.release()
        let outcome = try await starting.value
        await cancelling.value
        XCTAssertEqual(outcome, .superseded)
        XCTAssertEqual(system.starts, 0)
        XCTAssertFalse(system.onDemandEnabled)
        XCTAssertEqual(system.stops, 1)
    }

    /// Start, Cancel, start again while the first save still waits; the first attempt's failure
    /// clean-up arrives meanwhile. Only the newer start reaches the system, and its On Demand stays on.
    @MainActor
    func testAfterACancelOnlyTheNewerStartRunsAndTheOlderCleanupCannotDisarmIt() async throws {
        let lifecycle = TunnelStartCoordinator()
        let system = FakeConfiguration()
        let save = Pause()
        system.pauseSave = save
        let older = Task { try await lifecycle.start(system) }
        let saving = await turns(until: { save.reached })
        XCTAssertTrue(saving)
        let cancelling = Task { await lifecycle.stop(system) }
        let newer = Task { try await lifecycle.start(system) }
        let queued = await turns(until: { lifecycle.waiting == 2 })
        XCTAssertTrue(queued)
        let cleanup = Task { await lifecycle.disarmAfterFailedStart(system) }
        save.release()
        let olderOutcome = try await older.value
        await cancelling.value
        let newerOutcome = try await newer.value
        await cleanup.value
        XCTAssertEqual(olderOutcome, .superseded)
        XCTAssertEqual(newerOutcome, .started)
        XCTAssertEqual(system.starts, 1)
        XCTAssertTrue(system.onDemandEnabled)
    }

    /// Sign-out while a settings save holds the turn and a start waits behind it: the removal takes
    /// over at its entry, so the start never saves or starts once the settings save lets go.
    @MainActor
    func testRemoveInvalidatesAQueuedStartAtEntryWhileASettingsSaveHoldsTheTurn() async throws {
        let lifecycle = TunnelStartCoordinator()
        let system = FakeConfiguration()
        system.saved = true
        let settings = Pause()
        let applying = Task { try await lifecycle.exclusive { try await settings.hold() } }
        let held = await turns(until: { settings.reached })
        XCTAssertTrue(held)
        let starting = Task { try await lifecycle.start(system) }
        let startQueued = await turns(until: { lifecycle.waiting == 1 })
        XCTAssertTrue(startQueued)
        let before = lifecycle.generation
        let removing = Task { await lifecycle.remove(system) }
        let removeQueued = await turns(until: { lifecycle.waiting == 2 })
        XCTAssertTrue(removeQueued)
        XCTAssertEqual(lifecycle.generation, before + 1)
        settings.release()
        try await applying.value
        let outcome = try await starting.value
        await removing.value
        XCTAssertEqual(outcome, .superseded)
        XCTAssertEqual(system.saves, 0)
        XCTAssertEqual(system.starts, 0)
        XCTAssertFalse(system.saved)
    }

    /// Lets the other main-actor tasks run until `condition` holds, for at most `limit` turns.
    @MainActor
    private func turns(until condition: () -> Bool, limit: Int = 100) async -> Bool {
        for _ in 0..<limit {
            if condition() { return true }
            await Task.yield()
        }
        return condition()
    }
}

/// One system wait the test holds open until it calls `release`.
@MainActor
private final class Pause {
    private(set) var reached = false
    private var released = false
    private var waiter: CheckedContinuation<Void, Never>?

    func hold() async throws {
        reached = true
        if !released { await withCheckedContinuation { waiter = $0 } }
    }

    func release() {
        released = true
        waiter?.resume()
        waiter = nil
    }
}

/// Tono's configuration as the system keeps it: a save lands when its pause is released.
@MainActor
private final class FakeConfiguration: TunnelLifecycleSteps {
    var saved = false
    var onDemandEnabled = false
    var saves = 0
    var starts = 0
    var stops = 0
    var pauseRefresh: Pause?
    var pauseSave: Pause?
    var pauseReload: Pause?

    func refresh() async -> Bool {
        if let pause = pauseRefresh {
            pauseRefresh = nil
            try? await pause.hold()
        }
        return saved
    }

    func saveForStart() async throws {
        if let pause = pauseSave {
            pauseSave = nil
            try await pause.hold()
        }
        saves += 1
        saved = true
        onDemandEnabled = true
    }

    func reloadForStart() async throws {
        if let pause = pauseReload {
            pauseReload = nil
            try await pause.hold()
        }
    }

    func startTunnel() throws { starts += 1 }

    func disarmOnDemand() async { onDemandEnabled = false }

    func stopTunnel() async { stops += 1 }

    func removeConfiguration() async {
        saved = false
        onDemandEnabled = false
    }
}
