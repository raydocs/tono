import XCTest
@testable import Tono

@MainActor
final class AppStateConnectRecoveryTests: XCTestCase {
    private enum Failure: Error { case proxyDisable, dnsRestore }

    private struct RuntimeState {
        let armed = KillSwitchService.isArmed
        let needsReassert = KillSwitchService.needsSessionExceptionReassert
        let didStartCore = AppProfile.defaults.object(forKey: SettingsKey.didStartCore)
        let lastTunEnabled = AppProfile.defaults.object(forKey: SettingsKey.lastTunEnabled)
        let connectBootSession = AppProfile.defaults.object(forKey: SettingsKey.connectBootSession)

        func restore() {
            KillSwitchService.isArmed = armed
            KillSwitchService.needsSessionExceptionReassert = needsReassert
            AppProfile.defaults.set(didStartCore, forKey: SettingsKey.didStartCore)
            AppProfile.defaults.set(lastTunEnabled, forKey: SettingsKey.lastTunEnabled)
            AppProfile.defaults.set(connectBootSession, forKey: SettingsKey.connectBootSession)
        }
    }

    private func makeApp() -> AppState {
        let app = AppState()
        app.config.tunEnabled = true
        app.tunInterfaceExists = { _ in true }
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        return app
    }

    func testAutomaticRecoveryKeepsAdmittedModeUntilExplicitSessionEnd() async {
        let saved = RuntimeState()
        let defaults = AppProfile.defaults
        let mode = defaults.object(forKey: SettingsKey.desktopRoutingMode)
        let strictIntent = defaults.object(forKey: "strictRoutingSessionIntent")
        let session = defaults.object(forKey: SettingsKey.routingSession)
        let selection = defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            saved.restore()
            defaults.set(mode, forKey: SettingsKey.desktopRoutingMode)
            defaults.set(strictIntent, forKey: "strictRoutingSessionIntent")
            defaults.set(session, forKey: SettingsKey.routingSession)
            defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        KillSwitchService.isArmed = false
        defaults.removeObject(forKey: "strictRoutingSessionIntent")
        defaults.removeObject(forKey: SettingsKey.routingSession)
        defaults.set("stable", forKey: SettingsKey.desktopRoutingMode)
        let app = makeApp()
        defer {
            app.connectionCoordinator.cancelConnectionTasks()
            app.connectionCoordinator.cancelReconnectTasks()
        }
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID,
            name: "TONO CLOUD", nodes: [Fixture.realityNode()])]
        app.recordConnectBootSession = {}

        // Exercise production admission but cancel before privileged async IO.
        // This also covers failures before runtime construction captures mode.
        app.userConnect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertEqual(app.connectionCoordinator.capturedRoutingMode, "stable")
        app.connectionCoordinator.cancelConnectionTasks()
        app.isConnecting = false
        app.isConnected = true
        defaults.set("three-tier", forKey: SettingsKey.desktopRoutingMode)
        app.userConnect() // A stale click on a connected session cannot consume it.
        XCTAssertEqual(app.connectionCoordinator.capturedRoutingMode, "stable")

        app.disconnect(releaseKillSwitch: true, automaticFailureRelease: true)
        await app.finishPendingDisconnect()
        app.connect(preservingUnarmedBackoff: true)
        XCTAssertTrue(app.isConnecting)
        XCTAssertEqual(app.connectionCoordinator.capturedRoutingMode, "stable")
        app.connectionCoordinator.cancelConnectionTasks()

        app.disconnect(releaseKillSwitch: true)
        await app.finishPendingDisconnect()
        app.userConnect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertEqual(app.connectionCoordinator.capturedRoutingMode, "three-tier")
        app.connectionCoordinator.cancelConnectionTasks()
        app.isConnecting = false
        app.isConnected = true
        defaults.set("stable", forKey: SettingsKey.desktopRoutingMode)

        app.disconnect(releaseKillSwitch: true, automaticFailureRelease: true)
        await app.finishPendingDisconnect()
        app.connect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertEqual(app.connectionCoordinator.capturedRoutingMode, "three-tier")
        app.connectionCoordinator.cancelConnectionTasks()

        app.disconnect(releaseKillSwitch: true)
        await app.finishPendingDisconnect()
        app.userConnect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertEqual(app.connectionCoordinator.capturedRoutingMode, "stable")
    }

    func testMissingTUNDuringNodeSwitchDoesNotCountTowardPostSwitchVerdict() async {
        let saved = RuntimeState()
        defer { saved.restore() }
        KillSwitchService.isArmed = false
        let app = makeApp()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.switchingNodeId = "replacement-exit"
        app.tunInterfaceExists = { _ in false }
        var state = AppState.CoreMonitorState()

        let switchingOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(switchingOutcome, .continueMonitoring)
        XCTAssertEqual(state.consecutiveMissingTUNTicks, 0)

        app.switchingNodeId = nil
        let firstPostSwitchOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(firstPostSwitchOutcome, .continueMonitoring)
        XCTAssertEqual(state.consecutiveMissingTUNTicks, 1)
        XCTAssertTrue(app.isConnected)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertNil(app.errorMessage)

        app.connectionCoordinator.protectedReconnectTask?.cancel()
        app.connectionCoordinator.protectedReconnectTask = nil
        await app.finishPendingDisconnect()
    }

    func testExhaustedTunnelLossLeavesPendingNativeUpdateArmed() async {
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer { RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        let app = makeApp()
        app.isConnected = true
        app.nativeUpdatePending = true
        app.tunInterfaceExists = { _ in false }
        app.nativeUpdateDisconnect = {
            XCTFail("exhausted TUN loss must not release a pending update")
            return .init(pending: true, receipt: nil, execution: nil,
                          disconnectVerified: false, diagnostic: nil)
        }
        var state = AppState.CoreMonitorState()

        let first = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(first, .continueMonitoring)
        let verdict = await app.runCoreMonitorTick(state: &state)

        XCTAssertEqual(verdict, .stopMonitoring)
        XCTAssertNil(app.nativeUpdateDisconnectTask)
        XCTAssertFalse(RuntimeCleanup.nativeUpdateBlocksConnect)
        XCTAssertTrue(app.nativeUpdatePending)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }

    func testProtectionRepairsAreForgivenOnlyAfterAnUninterruptedHealthyAuditStreak() async {
        let saved = RuntimeState()
        defer { saved.restore() }
        KillSwitchService.isArmed = true
        KillSwitchService.needsSessionExceptionReassert = false
        let app = makeApp()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.consecutiveProtectionRepairCount = 2
        let healthyAudit: () async -> (wanted: Bool, live: Bool, repairedSinceArm: Bool)? = {
            (wanted: true, live: true, repairedSinceArm: false)
        }
        app.protectionAudits.killSwitchHealth = healthyAudit
        var state = AppState.CoreMonitorState()

        for _ in 0..<29 {
            state.healthCycle = 11
            let outcome = await app.runCoreMonitorTick(state: &state)
            XCTAssertEqual(outcome, .continueMonitoring)
        }
        XCTAssertEqual(state.consecutiveHealthyProtectionAudits, 29)
        XCTAssertEqual(app.consecutiveProtectionRepairCount, 2)

        app.protectionAudits.killSwitchHealth = { nil }
        state.healthCycle = 11
        let unavailableOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(unavailableOutcome, .continueMonitoring)
        XCTAssertEqual(state.consecutiveHealthyProtectionAudits, 0)
        XCTAssertEqual(app.consecutiveProtectionRepairCount, 2)

        app.protectionAudits.killSwitchHealth = healthyAudit
        for _ in 0..<29 {
            state.healthCycle = 11
            let outcome = await app.runCoreMonitorTick(state: &state)
            XCTAssertEqual(outcome, .continueMonitoring)
        }
        XCTAssertEqual(state.consecutiveHealthyProtectionAudits, 29)
        XCTAssertEqual(app.consecutiveProtectionRepairCount, 2)

        state.healthCycle = 11
        let forgivenOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(forgivenOutcome, .continueMonitoring)
        XCTAssertEqual(state.consecutiveHealthyProtectionAudits, 30)
        XCTAssertEqual(app.consecutiveProtectionRepairCount, 0)
        XCTAssertTrue(app.isConnected)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertFalse(app.protectedReconnectPausedForUserAction)
    }

    func testUnarmedFailureCleanupKeepsTheHelpersAIHold() async {
        let saved = RuntimeState()
        defer { saved.restore() }
        KillSwitchService.isArmed = false
        let app = makeApp()
        app.isConnecting = true
        let connectFailure = "PF arm failed after the helper released ordinary traffic."
        app.errorMessage = connectFailure
        // An unsuccessful native arm can already have installed the helper's
        // selective floor while the App's armed latch remains false.
        var aiHeld = true
        var releases: [String] = []
        app.networkProtection.repairForRelease = {
            XCTFail("Unarmed automatic cleanup must not repair the helper")
        }
        app.networkProtection.disarm = {
            releases.append("disarm")
            aiHeld = false
        }
        app.networkProtection.releaseAfterFailure = {
            releases.append("releaseAfterFailure")
        }

        app.disconnect(releaseKillSwitch: true, afterUnarmedConnectFailure: true)
        await app.finishPendingDisconnect()

        XCTAssertEqual(releases, ["releaseAfterFailure"])
        XCTAssertTrue(aiHeld, "automatic cleanup must not remove the helper's AI hold")
        XCTAssertFalse(app.isProtectionBlocked, "ordinary traffic must remain released")
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertEqual(app.errorMessage, connectFailure)
    }

    func testUnarmedCleanupKeepsProxyAndDNSFailuresWithoutUnverifiedCoreNoise() async {
        let saved = RuntimeState()
        defer { saved.restore() }
        KillSwitchService.isArmed = false
        AppProfile.defaults.set(true, forKey: SettingsKey.didStartCore)
        let app = makeApp()
        app.isConnecting = true
        app.errorMessage = "Connect failed before arming protection."
        app.networkProtection.repairForRelease = { XCTFail("Unarmed cleanup must not repair the helper") }
        app.networkProtection.stopCore = { _ in false }
        app.networkProtection.coreStatus = { (true, false) }
        app.networkProtection.restoreDNS = { throw Failure.dnsRestore }
        app.networkProtection.disableSystemProxy = { throw Failure.proxyDisable }
        // A later best-effort helper error must not hide the proxy failure either.
        app.networkProtection.restrictToBootstrap = { throw KillSwitchService.Error.notInstalled }

        app.disconnect(releaseKillSwitch: true, afterUnarmedConnectFailure: true)
        await app.finishPendingDisconnect()

        let proxyFailure = String(
            localized: "System proxy could not be turned off. Disable the proxy manually in System Settings > Network."
        )
        let dnsFailure = "Protected DNS restore failed, so this Mac may be unable to resolve names. The Support page has a recovery command. \(Failure.dnsRestore.localizedDescription)"
        XCTAssertEqual(app.errorMessage, proxyFailure + " " + dnsFailure)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertFalse(KillSwitchService.isArmed)
    }

    func testUnarmedCleanupKeepsVerifiedRunningCoreFailure() async {
        let saved = RuntimeState()
        defer { saved.restore() }
        KillSwitchService.isArmed = false
        let app = makeApp()
        app.isConnecting = true
        app.errorMessage = "Connect failed before arming protection."
        app.networkProtection.stopCore = { _ in false }
        app.networkProtection.coreStatus = { (true, true) }

        app.disconnect(releaseKillSwitch: true, afterUnarmedConnectFailure: true)
        await app.finishPendingDisconnect()

        XCTAssertEqual(app.errorMessage, "The protected core could not be stopped; retry disconnecting.")
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertFalse(KillSwitchService.isArmed)
    }

    func testUnarmedCleanupKeepsConnectFailureWhenCoreStatusIsUnverified() async {
        let saved = RuntimeState()
        defer { saved.restore() }
        KillSwitchService.isArmed = false
        let app = makeApp()
        app.isConnecting = true
        let connectFailure = "Connect failed before arming protection."
        app.errorMessage = connectFailure
        app.networkProtection.stopCore = { _ in false }
        app.networkProtection.coreStatus = { (true, false) }

        app.disconnect(releaseKillSwitch: true, afterUnarmedConnectFailure: true)
        await app.finishPendingDisconnect()

        XCTAssertEqual(app.errorMessage, connectFailure)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertFalse(KillSwitchService.isArmed)
    }

    func testExternalProtectionReleaseResetsStaleHelperSessionWhilePreservingRF3() {
        let saved = RuntimeState()
        let defaults = AppProfile.defaults
        let selection = defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            saved.restore()
            defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        KillSwitchService.isArmed = true

        let app = makeApp()
        defer {
            app.connectionCoordinator.cancelConnectionTasks()
            app.connectionCoordinator.cancelReconnectTasks()
        }
        app.proxyRegions = [ProxyRegion(
            id: AppState.managedCatalogRegionID,
            name: "TONO CLOUD",
            nodes: [Fixture.realityNode()]
        )]
        app.recordConnectBootSession = {}
        app.isProtectionBlocked = true

        // Simulate an already-admitted session that is later released externally.
        app.connectionCoordinator.beginUserConnect()
        let admittedSession = app.connectionCoordinator.helperSession
        XCTAssertTrue(admittedSession.adopt(41))

        app.acceptConfirmedExternalProtectionRelease()

        XCTAssertTrue(admittedSession.isRetired)
        let resetSession = app.connectionCoordinator.helperSession
        XCTAssertFalse(resetSession === admittedSession)
        XCTAssertNil(resetSession.value)
        XCTAssertFalse(resetSession.userInitiated)
        XCTAssertFalse(HelperManager.mayAdmit(
            .init(released: true, generation: 42),
            userInitiated: resetSession.userInitiated
        ), "R-F3: external release must still prevent automatic reconnects from admitting")

        // Automatic connect keeps userInitiated == false.
        app.connect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertFalse(app.connectionCoordinator.helperSession.userInitiated)
        app.connectionCoordinator.cancelConnectionTasks()
        app.isConnecting = false

        // Explicit user Connect mints a fresh user-initiated generation.
        app.userConnect()
        XCTAssertTrue(app.isConnecting)
        let userSession = app.connectionCoordinator.helperSession
        XCTAssertNil(userSession.value)
        XCTAssertTrue(userSession.userInitiated)
        XCTAssertTrue(HelperManager.mayAdmit(
            .init(released: true, generation: 42),
            userInitiated: userSession.userInitiated
        ))

        // A stale userConnect() while connected must not retire the active session.
        app.connectionCoordinator.cancelConnectionTasks()
        app.isConnecting = false
        app.isConnected = true
        XCTAssertTrue(userSession.adopt(43))
        app.userConnect()
        XCTAssertTrue(app.connectionCoordinator.helperSession === userSession)
        XCTAssertFalse(userSession.isRetired)
        XCTAssertEqual(userSession.value, 43)
    }

    func testRestoreInternetPreemptivelyIsAwaitedByFinishPendingDisconnectAndConnect() async {
        let saved = RuntimeState()
        let defaults = AppProfile.defaults
        let selection = defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let strictIntent = defaults.object(forKey: "strictRoutingSessionIntent")
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            saved.restore()
            defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            defaults.set(strictIntent, forKey: "strictRoutingSessionIntent")
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        KillSwitchService.isArmed = true

        let app = makeApp()
        defer {
            app.connectionCoordinator.cancelConnectionTasks()
            app.connectionCoordinator.cancelReconnectTasks()
        }
        app.proxyRegions = [ProxyRegion(
            id: AppState.managedCatalogRegionID,
            name: "TONO CLOUD",
            nodes: [Fixture.realityNode()]
        )]
        app.recordConnectBootSession = {}
        app.isConnected = true
        app.initialDataLoaded = true

        final class Gate: @unchecked Sendable {
            private let lock = NSLock()
            private var openFlag = false
            private var continuations: [CheckedContinuation<Void, Never>] = []
            func wait() async {
                await withCheckedContinuation { cont in
                    lock.lock()
                    if openFlag {
                        lock.unlock()
                        cont.resume()
                    } else {
                        continuations.append(cont)
                        lock.unlock()
                    }
                }
            }
            func open() {
                lock.lock()
                openFlag = true
                let pending = continuations
                continuations.removeAll()
                lock.unlock()
                for cont in pending { cont.resume() }
            }
        }

        let gate = Gate()
        let releaseEntered = expectation(description: "preemptive release entered")
        let restored = HelperManager.ReleaseOutcome(
            outcome: "restored",
            generation: 12,
            components: [
                .init(name: "pf", readback: "restored", risk: "settled", detail: nil),
                .init(name: "ai", readback: "restored", risk: "settled", detail: nil),
                .init(name: "dns", readback: "restored", risk: "settled", detail: nil),
                .init(name: "core", readback: "restored", risk: "settled", detail: nil),
            ],
            stuck: [],
            finished: true,
            detail: nil
        )
        app.preemptiveReleaseOperation = { _, _, _ in
            releaseEntered.fulfill()
            await gate.wait()
            return (.success(restored), false)
        }

        app.restoreInternetPreemptively()
        await fulfillment(of: [releaseEntered], timeout: 1)
        XCTAssertTrue(app.isDisconnecting)
        XCTAssertNotNil(app.connectionCoordinator.preemptiveReleaseTask)

        // attemptAutomaticConnect() and finishPendingDisconnect() must wait rather than busy-loop.
        let finishDone = expectation(description: "finishPendingDisconnect waits for preemptive release")
        let finishTask = Task {
            await app.finishPendingDisconnect()
            finishDone.fulfill()
        }
        app.autoConnectRequested = true
        app.attemptAutomaticConnect()

        // User Connect clicked during in-flight preemptive release defers instead of dropping
        // and supersedes any pending automatic connect.
        app.userConnect()
        XCTAssertFalse(app.autoConnectRequested)
        XCTAssertTrue(app.connectionCoordinator.hasPendingDeferredConnect)
        // Even if an automatic connect wakeup races ahead of the deferred Connect task,
        // hasPendingDeferredConnect prevents it from stealing the attempt.
        app.autoConnectRequested = true
        app.attemptAutomaticConnect()
        await Task.yield()
        XCTAssertFalse(app.isConnecting)

        gate.open()
        await fulfillment(of: [finishDone], timeout: 1)
        await finishTask.value
        for _ in 0..<20 where !app.isConnecting {
            try? await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNil(app.connectionCoordinator.preemptiveReleaseTask)
        XCTAssertFalse(app.connectionCoordinator.hasPendingDeferredConnect)
        XCTAssertTrue(app.isConnecting)
        XCTAssertTrue(app.connectionCoordinator.helperSession.userInitiated)
    }

    func testOptionalPolicyAnsweredSyncRefusalKeepsWorkingSession() async throws {
        let saved = RuntimeState()
        let defaults = AppProfile.defaults
        let savedRoutingMode = defaults.object(forKey: SettingsKey.desktopRoutingMode)
        let savedRoutingSession = defaults.object(forKey: SettingsKey.routingSession)
        let savedSelection = defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let savedIPC = KillSwitchService.armIPC
        let updateBlocked = RuntimeCleanup.nativeUpdateBlocksConnect
        let updatePending = RuntimeCleanup.nativeUpdatePending

        let app = makeApp()
        let configURL = app.coreRuntime.configFilePath
        let savedConfigData = try? Data(contentsOf: configURL)
        defer {
            saved.restore()
            defaults.set(savedRoutingMode, forKey: SettingsKey.desktopRoutingMode)
            defaults.set(savedRoutingSession, forKey: SettingsKey.routingSession)
            defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
            KillSwitchService.armIPC = savedIPC
            RuntimeCleanup.nativeUpdateBlocksConnect = updateBlocked
            RuntimeCleanup.nativeUpdatePending = updatePending
            if let savedConfigData {
                try? savedConfigData.write(to: configURL)
            } else {
                try? FileManager.default.removeItem(at: configURL)
            }
            app.connectionCoordinator.cancelReconnectTasks()
        }

        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        KillSwitchService.isArmed = true
        KillSwitchService.armIPC.status = { (true, true, true, false) }
        KillSwitchService.armIPC.deliver = { _ in
            (true, true, true, false, false, 0, LocalNetworkDevicesSync.desired.allow, nil)
        }

        defaults.set("stable", forKey: SettingsKey.desktopRoutingMode)
        try app.coreRuntime.captureRoutingMode("stable", physicalInterface: "en0")
        let node = Fixture.realityNode()
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [node])]
        _ = app.applyProxySelection(node.name)
        app.config.mixedPort = 29190
        app.config.externalController = "127.0.0.1:29191"
        app.config.secret = String(repeating: "a", count: 64)
        app.isConnected = true
        app.coreController = CoreControllerClient()
        app.loadedRuntimeConfigDigest = "prior-installed-digest"
        app.activeDirectPolicy = try app.initialDirectPolicy(
            physicalInterface: "en0",
            policy: TonoTrafficPolicy(
                version: 3,
                domains: [],
                mediaEndpoints: [],
                directSuffixes: [.init(host: "example.net", ports: [443])],
                trusted: true
            )
        )
        app.managedTrafficPolicy = TonoTrafficPolicy(
            version: 3,
            domains: [],
            mediaEndpoints: [],
            directSuffixes: [.init(host: "example.org", ports: [443])],
            trusted: true
        )
        app.managedTrafficPolicyRevision = 55

        var syncCalls = 0
        app.optionalPolicySyncCoreConfig = { _, _ in
            syncCalls += 1
            throw HelperIPCError.commandFailed("Stop the running Core before binding strict routing.", code: nil)
        }

        app.scheduleBackgroundOptionalPolicy()
        while let owner = app.connectionCoordinator.configReloadTask {
            await owner.value
        }

        XCTAssertEqual(syncCalls, 3)
        XCTAssertTrue(app.isConnected, "an answered /core/sync refusal must keep the working session")
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
        XCTAssertEqual(app.loadedRuntimeConfigDigest, "prior-installed-digest")

        // A lost reply leaves the running Core unknown and must tear down.
        app.managedTrafficPolicyRevision = 56
        app.optionalPolicySyncCoreConfig = { _, _ in
            throw HelperIPCError.emptyResponse
        }
        app.scheduleBackgroundOptionalPolicy()
        while let owner = app.connectionCoordinator.configReloadTask {
            await owner.value
        }
        await app.finishPendingDisconnect()

        XCTAssertFalse(app.isConnected, "a lost /core/sync reply must tear down rather than leave unknown state")
        XCTAssertNil(app.loadedRuntimeConfigDigest)
    }

    func testStrictRoutingReconnectReusesBoundSessionPorts() async {
        let saved = RuntimeState()
        let defaults = AppProfile.defaults
        let savedRoutingMode = defaults.object(forKey: SettingsKey.desktopRoutingMode)
        let savedRoutingSession = defaults.object(forKey: SettingsKey.routingSession)
        let savedStrictIntent = defaults.object(forKey: "strictRoutingSessionIntent")
        let savedSelection = defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            saved.restore()
            defaults.set(savedRoutingMode, forKey: SettingsKey.desktopRoutingMode)
            defaults.set(savedRoutingSession, forKey: SettingsKey.routingSession)
            defaults.set(savedStrictIntent, forKey: "strictRoutingSessionIntent")
            defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        KillSwitchService.isArmed = true
        defaults.set("three-tier", forKey: SettingsKey.desktopRoutingMode)
        defaults.set("three-tier", forKey: SettingsKey.routingSession)
        defaults.set(true, forKey: "strictRoutingSessionIntent")

        let app = makeApp()
        defer {
            app.connectionCoordinator.cancelConnectionTasks()
            app.connectionCoordinator.cancelReconnectTasks()
        }
        app.proxyRegions = [ProxyRegion(
            id: AppState.managedCatalogRegionID,
            name: "TONO CLOUD",
            nodes: [Fixture.realityNode()]
        )]
        app.recordConnectBootSession = {}
        app.connectionCoordinator.capturedRoutingMode = "three-tier"

        // Reconnect with strictRoutingSessionIntent and active protection reuses bound ports.
        app.isProtectionBlocked = true
        app.config.mixedPort = 34_120
        app.config.externalController = "127.0.0.1:34121"
        app.connect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertEqual(app.config.mixedPort, 34_120)
        XCTAssertEqual(app.config.externalController, "127.0.0.1:34121")
        app.connectionCoordinator.cancelConnectionTasks()
        app.isConnecting = false

        // Default RuntimeConfig ports (28990 / 127.0.0.1:9090) must not be reused even under strict reconnect.
        app.config.mixedPort = 28_990
        app.config.externalController = "127.0.0.1:9090"
        app.connect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertFalse(app.config.mixedPort == 28_990 && app.config.externalController == "127.0.0.1:9090")
        app.connectionCoordinator.cancelConnectionTasks()
        app.isConnecting = false

        // Fresh unprotected strict connect (even with leftover intent) allocates ephemeral ports.
        KillSwitchService.isArmed = false
        app.isProtectionBlocked = false
        app.isProtectedReconnectScheduled = false
        app.config.mixedPort = 28_990
        app.config.externalController = "127.0.0.1:9090"
        app.connect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertFalse(app.config.mixedPort == 28_990 && app.config.externalController == "127.0.0.1:9090")
        app.connectionCoordinator.cancelConnectionTasks()
        app.isConnecting = false

        // Missing or invalid prior ports still fall back to allocating a valid pair.
        KillSwitchService.isArmed = true
        app.isProtectionBlocked = true
        app.config.mixedPort = 0
        app.config.externalController = ""
        app.connect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertGreaterThan(app.config.mixedPort, 0)
        XCTAssertFalse(app.config.externalController.isEmpty)
        app.connectionCoordinator.cancelConnectionTasks()
        app.isConnecting = false

        // Explicit release clears strictRoutingSessionIntent, so switching to stable rotates ports.
        app.preemptiveReleaseOperation = { _, _, _ in
            let restored = HelperManager.ReleaseOutcome(
                outcome: "restored",
                generation: 1,
                components: [
                    .init(name: "pf", readback: "restored", risk: "settled", detail: nil),
                    .init(name: "ai", readback: "restored", risk: "settled", detail: nil),
                    .init(name: "dns", readback: "restored", risk: "settled", detail: nil),
                    .init(name: "core", readback: "restored", risk: "settled", detail: nil),
                ],
                stuck: [],
                finished: true,
                detail: nil
            )
            return (.success(restored), false)
        }
        defaults.set(true, forKey: "strictRoutingSessionIntent")
        app.disconnect(releaseKillSwitch: true)
        await app.finishPendingDisconnect()
        XCTAssertFalse(defaults.bool(forKey: "strictRoutingSessionIntent"))

        defaults.set("stable", forKey: SettingsKey.desktopRoutingMode)
        app.config.mixedPort = 1
        app.config.externalController = "127.0.0.1:2"
        app.connect()
        XCTAssertTrue(app.isConnecting)
        XCTAssertNotEqual(app.config.mixedPort, 1)
        XCTAssertNotEqual(app.config.externalController, "127.0.0.1:2")
    }

    func testActivationDoesNotTreatNeverArmedProtectionAsAnExternalRelease() async {
        let saved = RuntimeState()
        defer { saved.restore() }
        KillSwitchService.isArmed = false
        let app = makeApp()
        app.isProtectionBlocked = true
        app.isProtectedReconnectScheduled = true
        app.errorMessage = "Connect recovery is pending."
        let reconnectID = UUID()
        app.connectionCoordinator.protectedReconnectID = reconnectID
        let (reconnectWait, releaseReconnect) = AsyncStream<Void>.makeStream()
        let reconnect = Task { for await _ in reconnectWait { break } }
        app.connectionCoordinator.protectedReconnectTask = reconnect
        defer {
            reconnect.cancel()
            releaseReconnect.finish()
            app.connectionCoordinator.protectedReconnectTask = nil
        }
        let unexpectedRead = expectation(description: "Never-armed activation must not query external release")
        unexpectedRead.isInverted = true
        app.networkProtection.refreshKillSwitchStatus = {
            unexpectedRead.fulfill()
            return .confirmed(requiresProtectionRecovery: false)
        }

        app.reconcileExternalProtectionState()
        await fulfillment(of: [unexpectedRead], timeout: 0.1)

        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertTrue(app.isProtectedReconnectScheduled)
        XCTAssertEqual(app.connectionCoordinator.protectedReconnectID, reconnectID)
        XCTAssertFalse(reconnect.isCancelled)
        XCTAssertEqual(app.errorMessage, "Connect recovery is pending.")
        releaseReconnect.finish()
        await reconnect.value
    }
}
