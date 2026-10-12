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

    /// H18-G-F1: the same failure three times paused automatic retries, and
    /// the lid closed on Protected Offline. The strike count survived the
    /// sleep, so the first identical failure after wake paused again with
    /// nothing scheduled. Sleep ends the network those strikes were earned
    /// on, so wake's connect gets a fresh budget, as a network change would.
    func testSleepGivesWakeAFreshRepeatedFailureBudget() async {
        let app = AppState()
        app.isProtectionBlocked = true
        app.lastProtectedFailureSignature = "handshake|The exit did not answer."
        app.consecutiveProtectedFailureCount = 3
        app.protectedReconnectPausedForUserAction = true
        app.protectedReconnectPauseLiftsOnNetworkChange = true
        // Unarmed, so the bootstrap restriction that sleep schedules for a
        // blocked host returns before it reaches the privileged helper.
        KillSwitchService.isArmed = false

        app.prepareForSystemSleep()
        _ = await app.connectionCoordinator.sleepRestrictTask?.value

        XCTAssertTrue(app.resumeProtectionAfterWake)
        XCTAssertEqual(app.consecutiveProtectedFailureCount, 0)
        XCTAssertNil(app.lastProtectedFailureSignature)
        XCTAssertFalse(app.protectedReconnectPausedForUserAction)
        XCTAssertFalse(app.protectedReconnectPauseLiftsOnNetworkChange)
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

    /// X1-2: the lid closes before the release reaches its disarm, and the
    /// helper's sleep gate refuses it. The release ends with PF still armed
    /// and Protected Offline — before wake. Wake must not read that armed PF
    /// as a session to recover and reconnect over the user's Restore internet.
    func testSleepGateRefusedReleaseDoesNotReconnectOnWake() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        KillSwitchService.isArmed = true
        // A ready catalog, so the network-change branch below reaches its
        // reconnect decision instead of stopping at readiness.
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [Fixture.realityNode()]
            )
        ]
        let lidClosed = ReleaseGate()
        let dnsReached = ReleaseGate()
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { coreRuntime in
            coreRuntime.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = {
            dnsReached.open()
            await lidClosed.wait()
            return true
        }
        runtime.disableSystemProxy = {}
        var disarms = 0
        runtime.disarm = {
            disarms += 1
            throw HelperIPCError.commandFailed(
                "The system is entering sleep; network protection remains fail-closed."
            )
        }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: true)
        }
        app.networkProtection = runtime
        defer {
            app.connectionCoordinator.cancelReconnectTasks()
            KillSwitchService.isArmed = false
            lidClosed.open()
        }

        app.disconnect(releaseKillSwitch: true)
        await dnsReached.wait()
        app.prepareForSystemSleep()
        lidClosed.open()
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertTrue(app.isProtectionBlocked)

        app.resumeAfterSystemWake()
        XCTAssertNil(
            app.connectionCoordinator.wakeRecoveryTask,
            "a release the sleep gate refused must not become a wake reconnect"
        )
        // Nor may the network change that follows every wake.
        app.handleSystemNetworkChange()
        XCTAssertNil(
            app.connectionCoordinator.protectedReconnectTask,
            "a network change must not reconnect over the refused release"
        )
        // Nor may either of them retry the user's release on their behalf.
        XCTAssertNil(app.automaticReleaseRetryTask)
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertEqual(disarms, 1, "the user's release is not re-run by wake or a network change")
    }

    // MARK: MAC-AUTO-RELEASE-FAIL-NO-RETRY
    //
    // The exhausted protected reconnect's automatic release failed and left
    // PF armed. Unlike the user's own Restore internet above, that is not an
    // intent to keep: the next network change or wake runs the same release
    // again instead of leaving the Mac offline until the user clicks.

    private final class ReleaseProbe: @unchecked Sendable {
        var repairs = 0
        var dnsRestores = 0
        var releases = 0
        var bootstraps = 0
        /// `releaseAfterFailure` throws until this call number.
        var releaseSucceedsOn = Int.max
        /// `restoreDNS` throws from this call number on.
        var dnsFailsFrom = Int.max
        var repairError: Error?
    }

    private func hostWithFailedAutomaticRelease(
        _ probe: ReleaseProbe,
        viaExhaustedFailure: Bool = true
    ) async -> AppState {
        let app = AppState()
        KillSwitchService.isArmed = true
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [Fixture.realityNode()]
            )
        ]
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {
            probe.repairs += 1
            if let error = probe.repairError { throw error }
        }
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = {
            probe.dnsRestores += 1
            if probe.dnsRestores >= probe.dnsFailsFrom {
                throw HelperIPCError.commandFailed("Protected DNS could not be restored.")
            }
            return true
        }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = {
            probe.releases += 1
            guard probe.releases >= probe.releaseSucceedsOn else {
                throw HelperIPCError.commandFailed("The helper could not release the Kill Switch.")
            }
            KillSwitchService.isArmed = false
        }
        runtime.restrictToBootstrap = { probe.bootstraps += 1 }
        runtime.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: KillSwitchService.isArmed)
        }
        app.networkProtection = runtime
        if viaExhaustedFailure {
            await app.applyExhaustedArmedFailure(
                message: "The exit did not answer.",
                resumeWhenReachable: true
            )
        } else {
            app.disconnect(releaseKillSwitch: true, automaticFailureRelease: true)
        }
        await app.connectionCoordinator.disconnectSequence?.value
        // The first attempt's own unarmed loop is not what these tests observe.
        app.connectionCoordinator.unarmedReconnectTask?.cancel()
        app.connectionCoordinator.unarmedReconnectTask = nil
        app.connectionCoordinator.unarmedReconnectOwner = nil
        return app
    }

    private func finish(_ app: AppState) async {
        app.connectionCoordinator.cancelReconnectTasks()
        await app.connectionCoordinator.disconnectSequence?.value
        KillSwitchService.isArmed = false
    }

    func testFailedAutomaticReleaseIsRetriedByTheNextNetworkChange() async {
        let probe = ReleaseProbe()
        probe.dnsFailsFrom = 2
        let app = await hostWithFailedAutomaticRelease(probe)
        XCTAssertEqual(probe.releases, 1)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertTrue(app.isProtectionBlocked)

        app.handleSystemNetworkChange()
        await app.automaticReleaseRetryTask?.value
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(
            probe.dnsRestores, 2,
            "a network change must re-run the automatic release that left PF armed"
        )
        XCTAssertEqual(
            probe.releases, 1,
            "a retry whose DNS restore failed must not release PF"
        )
        XCTAssertEqual(probe.bootstraps, 1, "the failed retry keeps the fail-closed bootstrap rules")
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertTrue(app.isProtectionBlocked)
        await finish(app)
    }

    func testNetworkChangeBurstRetriesTheAutomaticReleaseOnce() async {
        let probe = ReleaseProbe()
        probe.dnsFailsFrom = 2
        let app = await hostWithFailedAutomaticRelease(probe)

        app.handleSystemNetworkChange()
        await app.automaticReleaseRetryTask?.value
        await app.connectionCoordinator.disconnectSequence?.value
        app.handleSystemNetworkChange()
        await app.automaticReleaseRetryTask?.value
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(
            probe.dnsRestores, 2,
            "notifications of one transition must not re-run a release that just failed"
        )
        await finish(app)
    }

    func testFailedAutomaticReleaseIsRetriedByWake() async {
        let probe = ReleaseProbe()
        probe.dnsFailsFrom = 2
        let app = await hostWithFailedAutomaticRelease(probe)

        app.resumeAfterSystemWake()
        await app.automaticReleaseRetryTask?.value
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(probe.dnsRestores, 2, "wake must re-run the automatic release that left PF armed")
        XCTAssertNil(
            app.connectionCoordinator.wakeRecoveryTask,
            "the retry replaces wake's reconnect; it does not add one"
        )
        XCTAssertTrue(KillSwitchService.isArmed)
        await finish(app)
    }

    func testUpdateStartingBeforeTheQueuedRetryRetiresIt() async {
        let blocks = RuntimeCleanup.nativeUpdateBlocksConnect
        let pending = RuntimeCleanup.nativeUpdatePending
        defer {
            RuntimeCleanup.nativeUpdateBlocksConnect = blocks
            RuntimeCleanup.nativeUpdatePending = pending
        }
        let probe = ReleaseProbe()
        let app = await hostWithFailedAutomaticRelease(probe)
        var updateReleases = 0
        app.nativeUpdateReleaseAfterFailure = {
            updateReleases += 1
            return .init(pending: true, receipt: nil, execution: nil,
                         disconnectVerified: true, diagnostic: nil)
        }

        // The retry is queued but has not run; then the update begins.
        app.handleSystemNetworkChange()
        app.nativeUpdatePending = true
        await app.automaticReleaseRetryTask?.value
        while let task = app.nativeUpdateDisconnectTask { await task.value }
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(updateReleases, 0, "a queued retry must not start the update's release")
        XCTAssertEqual(probe.dnsRestores, 1, "the retry must not run once an update owns the host")
        app.nativeUpdatePending = false
        await finish(app)
    }

    func testDeniedAdministratorRepairIsNotRetriedByTheNextNetworkChange() async {
        let probe = ReleaseProbe()
        probe.repairError = HelperInstallError.userDenied
        let app = await hostWithFailedAutomaticRelease(probe)
        XCTAssertEqual(probe.repairs, 1)

        app.handleSystemNetworkChange()
        await app.automaticReleaseRetryTask?.value
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(
            probe.repairs, 1,
            "a refused administrator prompt waits for the user; a notification must not prompt again"
        )
        XCTAssertTrue(KillSwitchService.isArmed)
        await finish(app)
    }

    func testReleaseHeldForTheUserIsRetriedAsReleaseOnly() async {
        let probe = ReleaseProbe()
        probe.releaseSucceedsOn = 2
        // The paused / restart-held releases carry no reconnect with them.
        let app = await hostWithFailedAutomaticRelease(probe, viaExhaustedFailure: false)
        XCTAssertTrue(KillSwitchService.isArmed)

        app.handleSystemNetworkChange()
        await app.automaticReleaseRetryTask?.value
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(probe.releases, 2)
        XCTAssertFalse(KillSwitchService.isArmed, "the retry releases the host")
        XCTAssertNil(
            app.connectionCoordinator.unarmedReconnectTask,
            "a release that never reconnected must not gain a reconnect by being retried"
        )
        await finish(app)
    }

    func testUnconfirmedRetryDoesNotScheduleTheUnarmedReconnect() async {
        let probe = ReleaseProbe()
        probe.dnsFailsFrom = 2
        let app = await hostWithFailedAutomaticRelease(probe)

        app.handleSystemNetworkChange()
        await app.automaticReleaseRetryTask?.value
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertNil(
            app.connectionCoordinator.unarmedReconnectTask,
            "the unarmed reconnect follows a confirmed release, not a failed one"
        )
        await finish(app)
    }

    /// MAC-WAKE-NO-SERVICE-RELEASE regression: wake connected as soon as PF
    /// was reasserted, before macOS named a primary service. That connect
    /// failed on "no network service" and the armed failure released.
    func testWakeHoldsTheBarrierWhileNoPrimaryServiceIsNamed() async {
        let savedConsumer = RuntimeCleanup.launchProtectionConsumer
        let savedArmed = KillSwitchService.isArmed
        let app = AppState()
        app.automaticResumeHeldAfterRestart = false
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [Fixture.realityNode()]
            )
        ]
        KillSwitchService.isArmed = true
        var releases = 0
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { releases += 1 }
        runtime.releaseAfterFailure = { releases += 1 }
        runtime.restrictToBootstrap = {}
        runtime.reassertKillSwitch = { true }
        app.networkProtection = runtime
        let polledAgain = expectation(description: "wake reads the primary service again")
        var reads = 0
        var audits = ProtectionAuditOperations()
        audits.primaryNetworkService = {
            reads += 1
            if reads == 2 { polledAgain.fulfill() }
            return nil
        }
        app.protectionAudits = audits
        defer {
            app.connectionCoordinator.cancelReconnectTasks()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.launchProtectionConsumer = savedConsumer
        }

        app.resumeAfterSystemWake()
        await fulfillment(of: [polledAgain], timeout: 5)

        XCTAssertFalse(app.isConnecting, "no connect before macOS names a network service")
        XCTAssertEqual(releases, 0)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertNotNil(app.connectionCoordinator.wakeRecoveryTask, "wake still owns the retry")
    }
}
