import XCTest
@testable import Tono

/// R1-F6 regression: an exit picked while a connect was still in flight was
/// persisted by `selectNode`'s not-connected branch, then silently
/// overwritten when the connect completed. The epilogue's writeback adopted
/// the running core's authoritative selector `now` — the exit captured
/// *before* the pick — so both the UI state and the persisted selection
/// returned to the old exit, and the newer pick vanished without a queued
/// switch. The pick must instead be held pending (`pendingExitSelection`)
/// and, when the core landed on a different exit, consumed by starting the
/// ordinary protected node switch to it. XCTest cannot run a real core; the
/// completion writeback is driven directly and only the preserved selection
/// and the initiated switch request are asserted.
final class NodeSelectionTests: XCTestCase {

    func testExitPickedWhileConnectingSurvivesConnectCompletion() {
        let app = AppState()
        let savedTargetKey = SettingsKey.selectedProxyTargetName
        let priorSavedTarget = AppProfile.defaults.string(forKey: savedTargetKey)
        defer {
            AppProfile.defaults.set(priorSavedTarget, forKey: savedTargetKey)
        }

        let exitX = Fixture.realityNode(name: "Los Angeles · Canyon", id: "la-canyon")
        let exitY = Fixture.realityNode(
            name: "Salt Lake · Harbor",
            id: "slc-harbor",
            server: "203.0.115.9",
            uuid: "00000000-0000-4000-8000-000000000002"
        )
        app.proxyRegions = [
            ProxyRegion(id: "tono-managed", name: "TONO CLOUD", nodes: [exitX, exitY])
        ]

        // Mid-connect to X: perform captured X, onCoreStarted has not run.
        app.isConnecting = true
        app.proxyService.activeNodeName = exitX.name

        // The user picks Y. A second connect is refused mid-flight
        // (shouldConnect(connecting:) is false), so this only persists the
        // pick — and must record it as pending instead of leaving it to be
        // overwritten by the epilogue's readback of X.
        app.selectNode(exitY.name)
        XCTAssertEqual(
            app.pendingExitSelection, exitY.name,
            "an exit picked mid-connect must be held pending, not just persisted"
        )

        // The connect completes on X: refresh() copied the core's
        // authoritative `now` back over the pick, then the epilogue's
        // writeback runs.
        app.isConnecting = false
        app.isConnected = true
        app.proxyService.activeNodeName = exitX.name
        app.reconcileProxySelectionAfterCoreStart()

        // The pick survives: the UI selection and the persisted selection
        // were not overwritten back to X…
        XCTAssertEqual(app.selectedNodeId, exitY.id)
        XCTAssertEqual(app.activeNode?.id, exitY.id)
        XCTAssertEqual(
            AppProfile.defaults.string(forKey: savedTargetKey), exitY.name,
            "the completion writeback must not persist the pre-pick exit over the pick"
        )
        XCTAssertNil(app.pendingExitSelection, "the pending pick is consumed exactly once")
        // …and the ordinary protected switch to it was started through the
        // existing `selectNode` path (this fixture has no core, so the
        // switch task only records the request).
        XCTAssertNotNil(
            app.connectionCoordinator.nodeSwitchTask,
            "consuming a differing pending pick must start the existing node switch to it"
        )
    }
}
