import XCTest
@testable import Tono

/// X1-8 regression: a disarm reply can be lost after a complete disarm. The
/// release teardown used to treat any disarm error as "Kill Switch still
/// holds this host" and publish Protected Offline over an open host. It must
/// read the helper back and publish what PF actually is. (If the helper had
/// instead failed to delete its persisted state, its status call reinstalls
/// PF and the read-back reports armed; that case stays blocked.)
final class DisarmErrorReadbackTests: XCTestCase {

    func testDisarmErrorAfterBarrierRemovalDoesNotPublishProtectedOffline() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        var pfLive = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        // The helper completed the disarm (PF and state gone), but the reply
        // was lost, so the App sees an error.
        runtime.disarm = {
            pfLive = false
            throw KillSwitchService.Error.commandFailed("state cleanup failed")
        }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: pfLive)
        }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertFalse(pfLive)
        XCTAssertFalse(
            app.isProtectionBlocked,
            "PF is gone, so the UI must not claim Protected Offline"
        )
        XCTAssertFalse(KillSwitchService.isArmed)
    }

    /// Helper effects for the one-click release, each counted.
    private final class ReleaseLog {
        var disarms = 0
        var automaticReleases = 0
        var statusReads = 0
        var staleCommits = 0
    }

    private func releaseRuntime(_ log: ReleaseLog) -> NetworkProtectionOperations {
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { log.disarms += 1 }
        runtime.releaseAfterFailure = { log.automaticReleases += 1 }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = {
            log.statusReads += 1
            return .confirmed(requiresProtectionRecovery: false)
        }
        runtime.selectiveAIRecoveryPending = { false }
        return runtime
    }

    /// Decision 094 drain cap: a cancelled connect never returns. The
    /// release stops waiting for it at the cap, runs, and publishes its real
    /// readback (here released with the AI removal still pending), not an
    /// assumed success and not an interim "still finishing".
    func testDrainCapReleasesAtTheCapAndPublishesTheReadback() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer {
            KillSwitchService.isArmed = false
            RuntimeCleanup.clearConnectAwaitsUser()
        }
        app.isConnected = true
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        runtime.selectiveAIRecoveryPending = { true }
        app.networkProtection = runtime
        app.connectionCoordinator.explicitReleaseDrainCap = .milliseconds(50)
        app.connectionCoordinator.releaseFenceAvailable = { true }
        let drain = ReleaseDrainGate()
        defer { drain.open() }
        app.connectionCoordinator.connectTask = Task { await drain.wait() }

        app.disconnect(releaseKillSwitch: true)
        await app.finishPendingDisconnect()

        XCTAssertEqual(log.disarms, 1, "the release ran at the cap, with the stale connect still pending")
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectionUnconfirmed)
        XCTAssertTrue(app.selectiveAIRecoveryPending, "the published result is the readback's")
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNotEqual(app.errorMessage, AppState.releaseStillFinishingMessage)
    }

    /// Decision 094 capability gate: against a helper that does not fence
    /// on the user's release (unknown, older or newer than this build's), the
    /// cap does not apply: the release keeps waiting for the stale connect,
    /// whose later arms nothing there would refuse.
    func testDrainCapWaitsForStaleWorkWithoutAFencingHelper() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer {
            KillSwitchService.isArmed = false
            RuntimeCleanup.clearConnectAwaitsUser()
        }
        app.isConnected = true
        let log = ReleaseLog()
        app.networkProtection = releaseRuntime(log)
        app.connectionCoordinator.explicitReleaseDrainCap = .milliseconds(50)
        app.connectionCoordinator.releaseFenceAvailable = { false }
        let drain = ReleaseDrainGate()
        app.connectionCoordinator.connectTask = Task { await drain.wait() }

        app.disconnect(releaseKillSwitch: true)
        try? await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(log.disarms, 0, "no cap without the helper's fence")

        drain.open()
        await app.finishPendingDisconnect()
        XCTAssertEqual(log.disarms, 1)
        XCTAssertFalse(app.isProtectionBlocked)
    }

    /// Decision 094: the work the capped release stopped waiting for ends
    /// after the release. Its result belongs to a retired generation and
    /// cannot overwrite the release; the late readback publishes what the
    /// helper reports (released), never the stale work's claim.
    func testLateResultFromRetiredWorkDoesNotOverwriteTheRelease() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer {
            KillSwitchService.isArmed = false
            RuntimeCleanup.clearConnectAwaitsUser()
        }
        app.isConnected = true
        let log = ReleaseLog()
        app.networkProtection = releaseRuntime(log)
        app.connectionCoordinator.explicitReleaseDrainCap = .milliseconds(50)
        app.connectionCoordinator.releaseFenceAvailable = { true }
        let drain = ReleaseDrainGate()
        let staleGeneration = app.connectionCoordinator.protectionOperationGeneration
        app.connectionCoordinator.nodeSwitchTask = Task {
            await drain.wait()
            // The stale switch finishes and tries to publish its runtime.
            _ = await app.connectionCoordinator.finishNodeSwitch(
                generation: staleGeneration,
                converge: {},
                commit: { log.staleCommits += 1; app.isConnected = true },
                recover: { _ in log.staleCommits += 1; app.isProtectionBlocked = true }
            )
        }

        app.disconnect(releaseKillSwitch: true)
        await app.finishPendingDisconnect()
        XCTAssertEqual(log.disarms, 1)
        XCTAssertEqual(log.statusReads, 0)
        let releaseGeneration = app.connectionCoordinator.protectionOperationGeneration
        XCTAssertNotEqual(releaseGeneration, staleGeneration, "the release retired the switch's generation")

        drain.open()
        for _ in 0..<500 where log.statusReads == 0 {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertEqual(log.statusReads, 1, "the late drain is read back once")
        XCTAssertEqual(log.staleCommits, 0, "the retired switch publishes nothing")
        XCTAssertEqual(app.connectionCoordinator.protectionOperationGeneration, releaseGeneration)
        XCTAssertFalse(app.isConnected)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectionUnconfirmed)
        XCTAssertEqual(log.disarms, 1)
    }

    /// R10-F1: an older preserve teardown is still inside its Core stop when
    /// Restore internet caps its wait for it and completes. That teardown
    /// then goes on to turn the proxy off and restrict PF. The user's next
    /// Connect is admitted only after it (and the release's late readback)
    /// ended, so none of those effects can stop or restrict the new session.
    /// The admission point is `prepare`, where a session would begin; here
    /// it refuses for lack of a catalog, which marks the moment.
    func testConnectAfterACappedReleaseWaitsForTheOldTeardownToEnd() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer {
            KillSwitchService.isArmed = false
            RuntimeCleanup.clearConnectAwaitsUser()
        }
        app.isConnected = true
        app.proxyRegions = []
        XCTAssertFalse(app.isTonoReady, "prepare refuses, so no real session starts")
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        let oldStop = ReleaseDrainGate()
        defer { oldStop.open() }
        var stopCalls = 0
        var effects: [String] = []
        let admissionMarks = [
            String(localized: "No protected Tono cloud exit is ready."),
            String(localized: "Choose an available cloud server before reconnecting."),
        ]
        let connectAdmitted = { admissionMarks.contains(app.errorMessage ?? "") }
        let note = { (effect: String) in
            effects.append(connectAdmitted() ? "\(effect) after connect" : effect)
        }
        runtime.stopCore = { core in
            stopCalls += 1
            if stopCalls == 1 { await oldStop.wait() }
            note("stop core")
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { note("core status"); return (false, true) }
        runtime.restoreDNS = { note("restore dns"); return true }
        runtime.disableSystemProxy = { note("proxy off") }
        runtime.restrictToBootstrap = { note("restrict") }
        runtime.disarm = { log.disarms += 1; note("disarm") }
        runtime.refreshKillSwitchStatus = {
            log.statusReads += 1
            note("status")
            return .confirmed(requiresProtectionRecovery: false)
        }
        app.networkProtection = runtime
        app.connectionCoordinator.explicitReleaseDrainCap = .milliseconds(50)
        app.connectionCoordinator.releaseFenceAvailable = { true }

        app.disconnect()
        for _ in 0..<500 where stopCalls == 0 {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(stopCalls, 1, "the old preserve teardown is inside its Core stop")

        app.disconnect(releaseKillSwitch: true)
        await app.finishPendingDisconnect()
        XCTAssertEqual(log.disarms, 1, "Restore did not wait for the old teardown")
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertTrue(app.connectionCoordinator.cappedStaleWorkSettling)

        app.connectFromUser()
        try? await Task.sleep(for: .milliseconds(200))
        XCTAssertFalse(connectAdmitted(), "no Connect while the old teardown still owns effects")

        oldStop.open()
        for _ in 0..<500 where !connectAdmitted() {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(connectAdmitted(), "the Connect runs once the old teardown ended")
        try? await Task.sleep(for: .milliseconds(200))

        XCTAssertTrue(effects.contains("restrict"), "the old teardown went on after the release: \(effects)")
        XCTAssertTrue(effects.contains("proxy off"), "\(effects)")
        XCTAssertFalse(
            effects.contains { $0.hasSuffix("after connect") },
            "no old Core/PF/DNS/proxy effect after the new Connect: \(effects)"
        )
        XCTAssertFalse(app.connectionCoordinator.cappedStaleWorkSettling)
        XCTAssertEqual(log.disarms, 1)
    }

    /// R11-F1: repeated Restore with a preserve teardown between them, and
    /// the newer release's cap firing first. T1 (an old preserve teardown) is
    /// held in its Core stop; R2 Restore and R4 Restore both cap, R4 before
    /// R2, with the preserve teardown R3 queued between them. The capped work
    /// must form no cycle: once T1's effects really end, every wait ends, the
    /// user's Connect is admitted after every old effect and readback, and a
    /// later teardown (here Quit's) settles too.
    func testRepeatedCappedReleasesWithTheNewerCapFirstFormNoCycle() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer {
            KillSwitchService.isArmed = false
            RuntimeCleanup.clearConnectAwaitsUser()
        }
        app.isConnected = true
        app.proxyRegions = []
        XCTAssertFalse(app.isTonoReady, "prepare refuses, so no real session starts")
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        let oldStop = ReleaseDrainGate()
        defer { oldStop.open() }
        var stopCalls = 0
        var effects: [String] = []
        let admissionMarks = [
            String(localized: "No protected Tono cloud exit is ready."),
            String(localized: "Choose an available cloud server before reconnecting."),
        ]
        let connectAdmitted = { admissionMarks.contains(app.errorMessage ?? "") }
        let note = { (effect: String) in
            effects.append(connectAdmitted() ? "\(effect) after connect" : effect)
        }
        runtime.stopCore = { core in
            stopCalls += 1
            if stopCalls == 1 { await oldStop.wait() }
            note("stop core")
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { note("core status"); return (false, true) }
        runtime.restoreDNS = { note("restore dns"); return true }
        runtime.disableSystemProxy = { note("proxy off") }
        runtime.restrictToBootstrap = { note("restrict") }
        runtime.disarm = { log.disarms += 1; note("disarm") }
        runtime.releaseForQuit = { note("quit release") }
        runtime.refreshKillSwitchStatus = {
            log.statusReads += 1
            note("status")
            return .confirmed(requiresProtectionRecovery: false)
        }
        app.networkProtection = runtime
        let coordinator = app.connectionCoordinator
        coordinator.releaseFenceAvailable = { true }
        // Each release's cap fires only when the test says so.
        var capWaiters: [Int] = []
        var caps: [Int: ReleaseDrainGate] = [:]
        coordinator.waitForStaleWork = { _, _, requestID in
            let cap = ReleaseDrainGate()
            caps[requestID] = cap
            capWaiters.append(requestID)
            await cap.wait()
            return false
        }
        func eventually(_ condition: () -> Bool) async {
            for _ in 0..<500 where !condition() {
                try? await Task.sleep(for: .milliseconds(10))
            }
        }

        app.disconnect()                          // T1, held in its Core stop
        await eventually { stopCalls == 1 }
        XCTAssertEqual(stopCalls, 1)
        app.disconnect(releaseKillSwitch: true)   // R2
        app.disconnect()                          // R3, preserve
        app.disconnect(releaseKillSwitch: true)   // R4
        await eventually { capWaiters.count == 2 }
        XCTAssertEqual(capWaiters.count, 2, "both releases wait at their caps")
        guard capWaiters.count == 2, let r2 = capWaiters.min(), let r4 = capWaiters.max() else { return }

        // The newer release caps and registers first, then the older one.
        caps[r4]?.open()
        await eventually { log.disarms == 1 }
        caps[r2]?.open()
        await eventually { log.disarms == 2 }
        XCTAssertEqual(log.disarms, 2, "both releases ran at their caps, with T1 still held")
        XCTAssertTrue(coordinator.cappedStaleWorkSettling)

        app.connectFromUser()
        try? await Task.sleep(for: .milliseconds(200))
        XCTAssertFalse(connectAdmitted(), "no Connect while T1 still owns effects")

        // T1's real effects end; nothing else is holding anything.
        oldStop.open()
        await eventually { connectAdmitted() }
        XCTAssertTrue(connectAdmitted(), "every wait ended: no cycle")
        XCTAssertFalse(coordinator.cappedStaleWorkSettling, "every capped entry ended and was removed")
        try? await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(effects.contains("restrict"), "the old preserve teardowns ran: \(effects)")
        XCTAssertFalse(
            effects.contains { $0.hasSuffix("after connect") },
            "no old Core/PF/DNS/proxy effect or readback after the Connect: \(effects)"
        )

        // A later teardown (Quit's) settles as well.
        let effectsBeforeQuit = effects.count
        app.disconnect(releaseKillSwitch: true, ordinaryQuit: true)
        XCTAssertTrue(app.isDisconnecting)
        await eventually { !app.isDisconnecting }
        XCTAssertFalse(app.isDisconnecting, "Quit's teardown is not stuck behind capped work")
        XCTAssertGreaterThan(effects.count, effectsBeforeQuit, "Quit's teardown ran: \(effects)")
        XCTAssertFalse(coordinator.cappedStaleWorkSettling)
    }

    /// One-click release whose drain never finishes: a cancelled connect
    /// mutation has not returned. At the UI deadline the UI stops
    /// showing "Disconnecting…" and publishes unknown with the recovery text,
    /// with nothing released and the armed intent kept. The release still runs
    /// once the drain ends, and its result replaces the interim one.
    func testOverdueReleaseDrainPublishesUnknownThenTheLateResult() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        let log = ReleaseLog()
        app.networkProtection = releaseRuntime(log)
        app.connectionCoordinator.explicitReleaseDeadline = .milliseconds(50)
        let drain = ReleaseDrainGate()
        app.connectionCoordinator.connectTask = Task { await drain.wait() }

        app.disconnect(releaseKillSwitch: true)
        for _ in 0..<500 where app.isDisconnecting {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertFalse(app.isDisconnecting, "the UI stops waiting at the deadline")
        XCTAssertTrue(app.isProtectionUnconfirmed, "the interim result is unknown")
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertEqual(app.errorMessage, AppState.releaseStillFinishingMessage)
        XCTAssertEqual(log.disarms, 0, "nothing is released while the drain is pending")
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertTrue(app.teardownInFlight, "Connect and automatic work still wait")

        drain.open()
        await app.finishPendingDisconnect()

        XCTAssertEqual(log.disarms, 1, "the same release finishes after the drain")
        XCTAssertFalse(app.isProtectionUnconfirmed)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertNil(app.errorMessage)
        XCTAssertFalse(app.teardownInFlight)
    }

    /// One-click release, status unreadable: the disarm reply is lost and the
    /// readback cannot be made. That is neither released nor known to hold:
    /// the result is published as unknown, never as Protected Offline and
    /// never as released.
    func testUnreadableReadbackAfterDisarmErrorPublishesUnknown() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        runtime.disarm = { throw KillSwitchService.Error.commandFailed("reply lost") }
        runtime.refreshKillSwitchStatus = { .unavailable }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertTrue(app.isProtectionUnconfirmed, "an unreadable release result is unknown")
        XCTAssertFalse(app.isProtectionBlocked, "unknown is not Protected Offline")
        XCTAssertTrue(KillSwitchService.isArmed, "an unknown result never clears the armed intent")
        XCTAssertNotNil(app.errorMessage)
    }

    /// One-click release restores AI too: a confirmed release reads the AI
    /// layer back, and a removal the helper still has pending shows instead
    /// of a plain "released" while AI services stay blocked.
    func testConfirmedReleaseShowsAIRemovalStillPending() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        runtime.selectiveAIRecoveryPending = { true }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertEqual(log.disarms, 1)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.selectiveAIRecoveryPending, "AI still blocked must show after the release")
    }

    /// R8-F2: the disarm succeeded but the AI readback throws. Removal is not
    /// verified, so the result stays partial: the AI notice shows and an
    /// error names it, never a plain "released".
    func testThrowingAIReadbackKeepsTheReleasePartial() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        runtime.selectiveAIRecoveryPending = { throw HelperIPCError.invalidResponse }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertEqual(log.disarms, 1)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.selectiveAIRecoveryPending, "unverified AI removal must stay visible")
        XCTAssertNotNil(app.errorMessage)
    }

    /// One-click release against a helper that must be repaired first (an
    /// older protocol, or one that rejects this app): the repair runs before
    /// any release call; when it fails nothing is disarmed or released
    /// (no blind call to an endpoint the old helper may not have), protection
    /// stays, and the message points to the local recovery command.
    func testUnrepairableHelperKeepsProtectionAndPointsToTheRecoveryCommand() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.isConnected = true
        let log = ReleaseLog()
        var runtime = releaseRuntime(log)
        runtime.repairForRelease = { throw HelperIPCError.forbidden }
        app.networkProtection = runtime

        await app.disconnectAndWait(releaseKillSwitch: true)

        XCTAssertEqual(log.disarms, 0)
        XCTAssertEqual(log.automaticReleases, 0)
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertTrue(app.errorMessage?.contains("Support page") == true,
                      "the failure must name the local recovery path: \(app.errorMessage ?? "nil")")
    }
}

/// Holds a drained mutation open until the test releases it.
private final class ReleaseDrainGate {
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
