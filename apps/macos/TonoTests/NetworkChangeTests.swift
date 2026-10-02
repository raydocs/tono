import XCTest
@testable import Tono

/// R1-F5 regression (W8/#259's macOS platform gap): a system network change
/// that arrived while a connect was in flight was dropped outright — no
/// pending marker, no reconciliation. `onCoreStarted` then adopted the new
/// topology as its fingerprint baseline, the switched-to ISP resolver stayed
/// blocked by PF on port 53, and the change only surfaced through the ~60 s
/// command audit in the core monitor. The observation must instead be held
/// pending and, once the connect settles, reconciled by the same debounced
/// environment comparison a live connected notification gets. XCTest cannot
/// drive SCDynamicStore or the privileged helper; `handleSystemNetworkChange`
/// is driven directly and only the scheduling of the reconciliation task is
/// asserted — its 750 ms debounce and helper probes never run here.
final class NetworkChangeTests: XCTestCase {

    func testNetworkChangeObservedWhileConnectingIsReconciledOnceConnected() {
        let app = AppState()
        // Mid-connect: `connect()` has captured its protected DNS service,
        // `onCoreStarted` has not published connected yet.
        app.isConnecting = true
        app.protectedDNSService = "Wi-Fi"

        // The observation must not vanish (pre-fix this was a bare return)
        // and must not create a coordinator task against a baseline that
        // does not exist yet.
        app.handleSystemNetworkChange()
        XCTAssertTrue(
            app.pendingNetworkChangeCheck,
            "a network change observed mid-connect must be held pending, not dropped"
        )
        XCTAssertNil(app.connectionCoordinator.networkEnvironmentTask)

        // The connect settles: onCoreStarted captured its baseline and the
        // perform epilogue cleared isConnecting. Consuming the pending
        // observation must schedule the connected reconciliation.
        app.isConnecting = false
        app.isConnected = true
        app.consumePendingNetworkChange()
        XCTAssertFalse(app.pendingNetworkChangeCheck)
        XCTAssertNotNil(
            app.connectionCoordinator.networkEnvironmentTask,
            "consuming the pending change must schedule the environment reconciliation"
        )

        // Leave no debounced helper probe behind for later tests.
        app.connectionCoordinator.networkEnvironmentTask?.cancel()
        app.connectionCoordinator.networkEnvironmentTask = nil

        // Disconnect window: the held observation is typically Tono's own
        // restoreDNS / enableProtectedDNS write. A settled teardown on an
        // armed, ready host must only clear the marker — replaying it as an
        // immediate kick lifted the repeated-failure pause, reset the backoff
        // and auto-reconnected an explicit release whose disarm failed.
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = false }
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [Fixture.realityNode()]
            )
        ]
        app.isConnected = false
        app.isDisconnecting = true
        app.handleSystemNetworkChange()
        XCTAssertTrue(app.pendingNetworkChangeCheck)
        app.isDisconnecting = false
        app.consumePendingNetworkChange()
        XCTAssertFalse(app.pendingNetworkChangeCheck)
        XCTAssertNil(
            app.connectionCoordinator.protectedReconnectTask,
            "a settled disconnect must not replay the held change as a reconnect kick"
        )
        app.connectionCoordinator.cancelReconnectTasks()
    }

    /// MAC-RECONCILE-DNS-COPY (#861): Protected DNS read broken on the uplink
    /// the session was captured on, and the reconnect notice said the active
    /// network had changed. The helper and SCDynamicStore are replaced by the
    /// audit seams; the debounce and the broken re-read run for real.
    func testBrokenDNSOnTheSameUplinkDoesNotSayTheNetworkChanged() async {
        let app = AppState()
        app.isConnected = true
        app.protectedDNSService = "Wi-Fi"
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
        let uplink = NetworkUplinkSnapshot(
            primaryService: "Wi-Fi",
            primaryInterface: "en0",
            ipv4Address: "192.168.1.20",
            ipv4Gateway: "192.168.1.1",
            ipv6Gateway: nil
        )
        app.lastUplinkSnapshot = uplink
        var audits = ProtectionAuditOperations()
        audits.uplinkSnapshot = { uplink }
        audits.protectedDNSIntegrity = { _ in .broken }
        app.protectionAudits = audits

        app.handleSystemNetworkChange()
        await app.connectionCoordinator.networkEnvironmentTask?.value

        XCTAssertFalse(app.isConnected)
        XCTAssertEqual(
            app.errorMessage,
            String(localized: "Protected DNS stopped; Kill Switch is blocking traffic while Tono retries.")
        )

        app.connectionCoordinator.cancelReconnectTasks()
        await app.connectionCoordinator.disconnectSequence?.value
    }

    /// After an automatic release the unarmed loop backs off to a two-minute
    /// wait. A network change is what ends most of those outages, so it
    /// restarts the loop at its first delay instead of leaving the wait to run.
    func testNetworkChangeRestartsAWaitingUnarmedReconnect() async {
        let savedConsumer = RuntimeCleanup.launchProtectionConsumer
        let app = AppState()
        app.automaticResumeHeldAfterRestart = false
        let node = Fixture.realityNode()
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [node])]
        app.applyProxySelection(node.name)
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        KillSwitchService.isArmed = false
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        let proofEntered = expectation(description: "proof after the network change")
        app.unarmedTcpProof = { _ in
            proofEntered.fulfill()
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            return false
        }
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            RuntimeCleanup.launchProtectionConsumer = savedConsumer
        }
        // The loop is parked in its longest wait.
        app.unarmedReconnectAttempt = 5
        app.scheduleUnarmedReconnect(sleep: { _ in try await Task.sleep(for: .seconds(600)) })

        app.handleSystemNetworkChange()

        await fulfillment(of: [proofEntered], timeout: 10)
        XCTAssertEqual(app.unarmedReconnectAttempt, 0)
    }
}
