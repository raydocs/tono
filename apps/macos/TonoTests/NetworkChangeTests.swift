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
}
