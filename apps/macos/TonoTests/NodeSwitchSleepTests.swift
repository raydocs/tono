import XCTest
@testable import Tono

/// X1-5 regression: a connected node switch commits its target only when the
/// switch finishes. Sleep bumps the protection generation and tears the
/// session down with a preserve teardown, which retires the switch before it
/// commits; wake then reconnected to the exit the user was leaving. XCTest
/// cannot drive NSWorkspace sleep or the privileged helper, so
/// `prepareForSystemSleep` is driven directly and the teardown's privileged
/// calls run through the `networkProtection` seam.
final class NodeSwitchSleepTests: XCTestCase {

    func testSleepDuringNodeSwitchKeepsTheSwitchTargetForWake() async {
        let app = AppState()
        let current = Fixture.realityNode(name: "Tokyo", id: "tokyo")
        let target = Fixture.realityNode(
            name: "Singapore", id: "singapore", server: "203.0.114.8"
        )
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [current, target]
            )
        ]
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.selectedNodeId = current.id
        app.proxyService.activeNodeName = current.name
        var runtime = NetworkProtectionOperations()
        runtime.stopCore = { coreRuntime in
            coreRuntime.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.disableSystemProxy = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        defer {
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
        }

        app.selectNode(target.name)
        XCTAssertEqual(app.switchingNodeId, target.id)

        // The lid closes before the switch commits.
        app.prepareForSystemSleep()
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(
            app.preferManagedCatalogExitForConnect()?.id,
            target.id,
            "wake must reconnect to the exit the switch was going to"
        )
    }
}
