import XCTest
@testable import Tono

/// R1-F1 regression: node switches, config reloads and the post-connect
/// background optional policy all restart sing-box through helper `/core/sync`
/// (stop + start), so the owned utun is legitimately absent for a fraction of
/// a second while PF stays armed. The core monitor's owned-TUN verdict must
/// hold through that window instead of failing closed on a healthy session
/// ("connected, then drops and reconnects seconds later"). XCTest cannot drive
/// the privileged helper; the `tunInterfaceExists` seam stands in for the
/// interface syscall and `runCoreMonitorTick(state:)` for one loop iteration.
final class AppStateCoreMonitorTests: XCTestCase {

    /// Explicit suspension instead of sleeps, mirroring the coordinator test
    /// gates: the reload task is genuinely in flight, not a stubbed flag.
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
    func testCompletedNodeSwitchDiscardsHealthFailureFromPreviousRoute() async {
        let armed = KillSwitchService.isArmed
        let needsReassert = KillSwitchService.needsSessionExceptionReassert
        defer {
            KillSwitchService.isArmed = armed
            KillSwitchService.needsSessionExceptionReassert = needsReassert
        }
        KillSwitchService.isArmed = false
        KillSwitchService.needsSessionExceptionReassert = false
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.config.tunEnabled = true
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.tunInterfaceExists = { _ in true }
        app.coreController = CoreControllerClient()
        app.proxyRegions = []
        app.activeNode = nil
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime

        let probe = ReloadGate()
        let started = expectation(description: "old route health probe held")
        app.raceHealthTrafficProbes = { _, _ in
            started.fulfill()
            await probe.wait()
            return .lost([])
        }
        var state = AppState.CoreMonitorState()
        state.healthCycle = 1
        state.consecutiveHealthFailures = 1
        let tick = Task { await app.runCoreMonitorTick(state: &state) }
        await fulfillment(of: [started], timeout: 2)
        let protectionGeneration = app.connectionCoordinator.protectionOperationGeneration
        app.switchingNodeId = "replacement-exit"
        let switchTask = Task {}
        app.connectionCoordinator.nodeSwitchTask = switchTask
        await switchTask.value
        app.switchingNodeId = nil
        app.connectionCoordinator.nodeSwitchTask = nil
        probe.open()

        let outcome = await tick.value
        XCTAssertEqual(outcome, .continueMonitoring)
        XCTAssertEqual(app.connectionCoordinator.protectionOperationGeneration, protectionGeneration)
        XCTAssertEqual(state.consecutiveHealthFailures, 0)
        XCTAssertTrue(app.isConnected)
        XCTAssertNil(app.errorMessage)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        app.connectionCoordinator.protectedReconnectTask?.cancel()
        await app.finishPendingDisconnect()
    }

    func testMonitorHoldsMissingTUNVerdictWhileRuntimeReplacementIsInFlight() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        // The owned runtime always runs with TUN; connect() sets this before
        // the monitor ever starts.
        app.config.tunEnabled = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        app.tunInterfaceExists = { _ in false }

        let gate = ReloadGate()
        app.connectionCoordinator.configReloadTask = Task { await gate.wait() }
        var state = AppState.CoreMonitorState()

        // Tick inside the replacement window: /core/sync has stopped the old
        // core, the new one has not recreated utun yet, and the reload task
        // still holds the shared runtime-mutation handle. This must not be a
        // verdict.
        let heldOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(heldOutcome, .continueMonitoring)
        XCTAssertTrue(
            app.isConnected,
            "a runtime replacement's no-TUN window must not disconnect the session"
        )
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertNil(app.errorMessage)

        // The replacement finishes and its task handle clears, but the
        // interface is still absent. The tick inside the window banked
        // nothing, so the first sighting after it is not a verdict yet; the
        // next one completes the persistence requirement and the fail-closed
        // verdict arrives — a real TUN death is still a disconnect, never a skip.
        app.connectionCoordinator.configReloadTask?.cancel()
        gate.open()
        app.connectionCoordinator.configReloadTask = nil
        let settleOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(settleOutcome, .continueMonitoring)
        XCTAssertTrue(
            app.isConnected,
            "one missing sighting right after the replacement window is not a verdict"
        )
        XCTAssertNil(app.errorMessage)
        let verdictOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(verdictOutcome, .stopMonitoring)
        XCTAssertFalse(
            app.isConnected,
            "a TUN still absent after the replacement window must fail closed"
        )
        XCTAssertEqual(
            app.errorMessage,
            String(localized: "The connection didn't complete. Support code TONO_CONNECT_TUN.")
        )

        // Settle the queued teardown through the replaced seams; no real
        // helper I/O runs. The reconnect loop is cancelled before its first
        // backoff sleep can fire.
        app.connectionCoordinator.protectedReconnectTask?.cancel()
        app.connectionCoordinator.protectedReconnectTask = nil
        await app.connectionCoordinator.disconnectSequence?.value
    }

    /// TM-OpenAI-1 regression: the one-minute tick runs the Protected DNS
    /// audit and the PF health check together. A DNS read the helper could
    /// not answer withholds only the DNS verdict; the PF check on the same
    /// tick must still act on a supervisor repair, which reinstalled PF
    /// without this session's direct permits.
    func testUnverifiableDNSAuditStillRunsPFHealthCheck() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.config.tunEnabled = true
        // The PF check runs only for the Tono-owned runtime.
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.protectedDNSService = "Wi-Fi"
        let originalArmedState = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        // isArmed is UserDefaults-backed; do not leak it into other tests.
        defer { KillSwitchService.isArmed = originalArmedState }
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        app.tunInterfaceExists = { _ in true }
        var audits = ProtectionAuditOperations()
        let stableUplink = NetworkUplinkSnapshot(
            primaryService: "Wi-Fi",
            primaryInterface: "en0",
            ipv4Address: "192.168.1.20",
            ipv4Gateway: "192.168.1.1",
            ipv6Gateway: nil
        )
        app.lastUplinkSnapshot = stableUplink
        audits.primaryNetworkService = { "Wi-Fi" }
        audits.uplinkSnapshot = { stableUplink }
        audits.protectedDNSIntegrity = { _ in .unverifiable }
        audits.killSwitchHealth = { (wanted: true, live: true, repairedSinceArm: true) }
        app.protectionAudits = audits
        var state = AppState.CoreMonitorState()
        // This tick is the twelfth, so both one-minute audits are due.
        state.healthCycle = 11

        let outcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(
            outcome, .stopMonitoring,
            "an unverifiable DNS read must not skip the PF health check"
        )
        XCTAssertEqual(app.consecutiveProtectionRepairCount, 1)
        XCTAssertFalse(app.isConnected)
        XCTAssertEqual(
            app.errorMessage,
            String(localized: "Network protection was interrupted by another program. The original network is back while Tono looks for a reachable exit.")
        )

        // Settle the queued teardown through the replaced seams, as above.
        app.connectionCoordinator.protectedReconnectTask?.cancel()
        app.connectionCoordinator.protectedReconnectTask = nil
        await app.connectionCoordinator.disconnectSequence?.value
    }

    /// MAC-BROWSER-DOH-FAIL-CLOSED regression: a browser Secure DNS conflict
    /// the one-minute audit finds mid-session (the user turned Chrome's
    /// Secure DNS on after connect) used to take the preserve teardown — core
    /// stopped, PF held bootstrap-only, system DNS still pointed at the dead
    /// resolver — with no reconnect scheduled, because only the user can
    /// clear that conflict. The host sat offline until the helper's core-down
    /// watchdog released PF ~30 s later. The automatic teardown must restore
    /// ordinary traffic immediately while retaining the secondary AI hold.
    func testBrowserSecureDNSHealthFailureReleasesTheNetwork() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.config.tunEnabled = true
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        // The browser audit only runs for a residential-configured account.
        app.managedCatalogRouting = TonoExitCatalogRouting(
            homeProxy: "residential.example.invalid:1080"
        )
        let originalArmedState = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = originalArmedState }
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        // Automatic health cleanup must use the selective release. Explicit
        // disarm would also remove the secondary AI hold.
        var protectionOperations: [String] = []
        runtime.disarm = { protectionOperations.append("disarm") }
        runtime.releaseAfterFailure = { protectionOperations.append("releaseAfterFailure") }
        runtime.restrictToBootstrap = { protectionOperations.append("restrictToBootstrap") }
        app.networkProtection = runtime
        app.tunInterfaceExists = { _ in true }
        var audits = ProtectionAuditOperations()
        // Healthy PF on the same tick, so the release below is provably the
        // browser verdict's, not the supervisor-repair branch's.
        audits.killSwitchHealth = { (wanted: true, live: true, repairedSinceArm: false) }
        app.protectionAudits = audits
        let conflictReport = BrowserDNSDiagnostics.Report(
            chrome: BrowserDNSDiagnostics.BrowserResult(
                outcome: .blocking, source: .localState, preferenceStoreCount: 1
            ),
            edge: BrowserDNSDiagnostics.BrowserResult(
                outcome: .clear, source: .none, preferenceStoreCount: 0
            )
        )
        app.scanBrowserProtectedDNS = { conflictReport }
        var state = AppState.CoreMonitorState()
        // This tick is the twelfth, so the browser audit is due; the PF
        // health check runs with it and finds nothing.
        state.healthCycle = 11

        let outcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(outcome, .stopMonitoring)
        XCTAssertFalse(app.isConnected)

        // Settle the queued teardown through the replaced seams, as above.
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(
            protectionOperations, ["releaseAfterFailure"],
            "a browser Secure DNS conflict must restore ordinary traffic with the secondary AI hold"
        )
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertEqual(app.errorMessage, conflictReport.failureMessage)
        XCTAssertEqual(app.lastClassifiedFailure?.code, .protectedDnsNotReady)
        XCTAssertNil(
            app.connectionCoordinator.protectedReconnectTask,
            "a timed retry cannot clear a browser Secure DNS conflict; no reconnect may be scheduled"
        )
    }

    /// MAC-PROTECTED-AFTER-PF-RELEASE regression: when the helper fails open
    /// under a connected session (a re-arm it could not commit released the
    /// block and deleted its intent), /killswitch/health answers
    /// wanted=false/live=false and only the app's armed latch still claimed
    /// PF held the host — Connected forever, wanted=false ignored. The tick
    /// must notice the released barrier, drop the latch, and re-arm in place
    /// through the session-exception reassert instead of tearing down a
    /// session that is still online through the tunnel.
    func testHelperFailOpenUnderSessionRearmsInPlaceWithoutTearDown() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.config.tunEnabled = true
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        let originalArmedState = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        let originalReassert = KillSwitchService.needsSessionExceptionReassert
        KillSwitchService.needsSessionExceptionReassert = false
        let savedIPC = KillSwitchService.armIPC
        defer {
            KillSwitchService.isArmed = originalArmedState
            KillSwitchService.needsSessionExceptionReassert = originalReassert
            KillSwitchService.armIPC = savedIPC
        }
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        app.tunInterfaceExists = { _ in true }
        var audits = ProtectionAuditOperations()
        // The helper answered: it neither wants nor holds PF.
        audits.killSwitchHealth = { (wanted: false, live: false, repairedSinceArm: false) }
        app.protectionAudits = audits
        // The reassert goes through the production KillSwitchService.arm; only
        // the helper IPC is replaced. The latch is read at arm time to prove
        // the released barrier was noticed before the re-arm fired.
        var armedIntentAtRearm: [Bool] = []
        KillSwitchService.armIPC.deliver = { _ in
            armedIntentAtRearm.append(KillSwitchService.isArmed)
            return (
                armed: true, wanted: true, live: true,
                healed: false, flushedStates: false, killedHosts: 0,
                localNetworkDevices: LocalNetworkDevicesSync.desired.allow
            )
        }
        var state = AppState.CoreMonitorState()
        // This tick is the twelfth, so the one-minute PF audit is due.
        state.healthCycle = 11

        let outcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(
            outcome, .continueMonitoring,
            "an online session must not be torn down over a barrier that is already gone"
        )
        XCTAssertTrue(app.isConnected)
        XCTAssertNil(app.errorMessage)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertEqual(
            armedIntentAtRearm, [false],
            "the stale armed latch must be dropped before the in-place re-arm"
        )
        XCTAssertFalse(
            KillSwitchService.needsSessionExceptionReassert,
            "only a successful re-arm consumes the intent"
        )
        XCTAssertTrue(
            KillSwitchService.isArmed,
            "the successful re-arm restores the armed latch"
        )
    }

    /// MAC-HEALTH-AUTO-CITY-SWITCH regression: SHIP_PLAN G2 turned the
    /// `CORE_EXIT_UNREACHABLE` city hop off and the connect path honours
    /// `CatalogCityFailover`, but the health monitor still switched to, and
    /// persisted, the next catalog city after two failed ticks. A dead exit
    /// must take the ordinary release on the city the user chose.
    func testUnreachableExitDuringHealthKeepsTheChosenCity() async {
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let originalArmedState = KillSwitchService.isArmed
        let originalReassert = KillSwitchService.needsSessionExceptionReassert
        let delayWasProven = SingBoxDelayGate.isProven
        let savedIPC = KillSwitchService.armIPC
        let app = AppState()
        defer {
            app.connectionCoordinator.cancelReconnectTasks()
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            KillSwitchService.isArmed = originalArmedState
            KillSwitchService.needsSessionExceptionReassert = originalReassert
            KillSwitchService.armIPC = savedIPC
            if delayWasProven { SingBoxDelayGate.prove() } else { SingBoxDelayGate.suspend() }
        }
        let chosen = Fixture.realityNode(name: "Los Angeles · Canyon", id: "chosen")
        let other = Fixture.realityNode(name: "Seattle · Rain", id: "other", server: "203.0.114.9")
        app.proxyRegions = [
            ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [chosen, other]),
        ]
        _ = app.applyProxySelection(chosen.name)
        AppProfile.defaults.set(chosen.name, forKey: SettingsKey.selectedProxyTargetName)
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.config.tunEnabled = true
        app.tunInterfaceExists = { _ in true }
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        // Nothing listens on the discard port, so the controller's exit check
        // fails the way a dead exit does; the TUN race loses with it.
        app.coreController = CoreControllerClient(port: 9)
        app.raceHealthTrafficProbes = { _, _ in .lost([]) }
        SingBoxDelayGate.prove()
        KillSwitchService.isArmed = true
        KillSwitchService.needsSessionExceptionReassert = false
        var switchArms = 0
        KillSwitchService.armIPC.prepare = { _ in
            switchArms += 1
            throw HelperIPCError.connectFailed
        }
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        var releases = 0
        runtime.releaseAfterFailure = {
            releases += 1
            KillSwitchService.isArmed = false
        }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime
        var state = AppState.CoreMonitorState()
        state.healthCycle = 1

        let first = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(first, .continueMonitoring)
        let verdict = await app.runCoreMonitorTick(state: &state)
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(verdict, .stopMonitoring)
        XCTAssertEqual(app.lastClassifiedFailure?.code, .coreExitUnreachable)
        XCTAssertEqual(switchArms, 0, "a dead exit must not start a city switch")
        XCTAssertEqual(
            AppProfile.defaults.string(forKey: SettingsKey.selectedProxyTargetName), chosen.name,
            "the user's city must stay the saved choice"
        )
        XCTAssertEqual(app.selectedExitNode()?.id, chosen.id)
        XCTAssertEqual(releases, 1, "the exhausted failure releases ordinary traffic once")
    }
}
