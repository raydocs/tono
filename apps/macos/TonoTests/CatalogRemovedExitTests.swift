import CryptoKit
import XCTest
@testable import Tono

/// MAC-CATALOG-NODE-REMOVED-BLOCK: removing the selected exit must not leave
/// a whole-machine block. A survivor keeps the session. No survivor restores
/// the original network. Strict `permanent` is the only hold, and macOS does
/// not store it.
final class CatalogRemovedExitTests: XCTestCase {

    func testRemovedExitKeepsASurvivorOrRestoresTheOriginalNetwork() async throws {
        XCTAssertEqual(
            CatalogRemovedExitAction.decide(
                replacementName: "JP-Survivor",
                strictKillSwitchExplicit: true,
                selectiveAiBlockReady: true
            ),
            .keepSession(switchTo: "JP-Survivor")
        )
        XCTAssertEqual(
            CatalogRemovedExitAction.decide(
                replacementName: nil,
                strictKillSwitchExplicit: true,
                selectiveAiBlockReady: true
            ),
            .keepStrictBlock
        )
        XCTAssertEqual(
            CatalogRemovedExitAction.decide(
                replacementName: nil,
                strictKillSwitchExplicit: false,
                selectiveAiBlockReady: true
            ),
            .selectiveRelease
        )
        XCTAssertEqual(
            CatalogRemovedExitAction.decide(
                replacementName: nil,
                strictKillSwitchExplicit: false,
                selectiveAiBlockReady: false
            ),
            .releaseOriginalNetwork
        )

        let storage = ConfigStorage.shared
        let savedFiles = ["regions.json", "rules.json", "config.json"].map { name in
            let url = storage.appSupportDirectory.appendingPathComponent(name)
            return (url, try? Data(contentsOf: url))
        }
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let armed = KillSwitchService.isArmed
        defer {
            KillSwitchService.isArmed = armed
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            for (url, data) in savedFiles {
                if let data { try? storage.writeSensitive(data, to: url) }
                else { try? FileManager.default.removeItem(at: url) }
            }
            ManagedExitCatalogOwnership.purge()
        }
        ManagedExitCatalogOwnership.adopt("removal-owner")
        KillSwitchService.isArmed = true

        let kept = try await makeApp()
        let removed = Fixture.realityNode(name: "US-Removed", id: "us-removed")
        let survivor = Fixture.realityNode(
            name: "JP-Survivor", id: "jp-survivor", server: "203.0.114.9"
        )
        try await kept.installManagedExitCatalog(
            try catalog([removed, survivor], revision: 80),
            persistCache: false,
            allowRuntimeTransition: false
        )
        XCTAssertTrue(kept.applyProxySelection(removed.name))
        kept.isConnected = true
        kept.coreController = nil
        try await kept.installManagedExitCatalog(
            try catalog([survivor], revision: 81),
            persistCache: false,
            allowRuntimeTransition: true
        )
        XCTAssertTrue(kept.isConnected)
        XCTAssertFalse(kept.catalogSelectionRequiresChoice)
        XCTAssertEqual(kept.proxyService.activeNodeName, survivor.name)
        XCTAssertNil(kept.connectionCoordinator.disconnectSequence)
        XCTAssertEqual(
            kept.errorMessage,
            String(localized: "The selected cloud server was removed. Tono switched to another cloud server and kept this connection.")
        )
        await kept.finishPendingPersistence()

        let released = try await makeApp()
        try await released.installManagedExitCatalog(
            try catalog([removed], revision: 82),
            persistCache: false,
            allowRuntimeTransition: false
        )
        XCTAssertTrue(released.applyProxySelection(removed.name))
        released.isConnected = true
        released.coreController = nil
        try await released.installManagedExitCatalog(
            try catalog([], revision: 83),
            persistCache: false,
            allowRuntimeTransition: true
        )
        let teardown = released.connectionCoordinator.disconnectSequence
        await teardown?.value
        XCTAssertFalse(released.isConnected)
        XCTAssertFalse(released.isProtectionBlocked)
        XCTAssertTrue(released.catalogSelectionRequiresChoice)
        XCTAssertFalse(released.isProtectedReconnectScheduled)
        XCTAssertEqual(
            released.errorMessage,
            String(localized: "The selected cloud server was removed. This Mac is back on its normal internet. Choose another cloud server.")
        )
        released.connectionCoordinator.cancelReconnectTasks()
        await released.finishPendingPersistence()
    }

    private func makeApp() async -> AppState {
        let app = AppState()
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: false)
        }
        app.networkProtection = runtime
        return app
    }

    private func catalog(
        _ nodes: [ProxyNode],
        revision: Int
    ) throws -> ManagedExitCatalogCache {
        let body = try nodes.map { try ConfigPipeline.ownedNodeYAML($0) }.joined()
        let yaml = nodes.isEmpty ? "proxies: []" : "proxies:\n" + body
        let digest = Data(SHA256.hash(data: Data(yaml.utf8))).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
        return .init(
            revision: revision,
            yaml: yaml,
            sha256: digest,
            updatedAt: nil,
            routing: nil,
            owner: "removal-owner"
        )
    }
}
