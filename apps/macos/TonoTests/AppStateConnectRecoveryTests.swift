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
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        return app
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
