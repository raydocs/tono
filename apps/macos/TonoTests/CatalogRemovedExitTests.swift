import CryptoKit
import XCTest
@testable import Tono

/// MAC-CATALOG-NODE-REMOVED-BLOCK: removing the selected exit must not leave
/// a whole-machine block. A survivor keeps the session. No survivor restores
/// the original network. Strict `permanent` is the only hold, and macOS does
/// not store it.
final class CatalogRemovedExitTests: XCTestCase {

    func testBusyCatalogRemovalDrainsTheLatestSurvivorAfterOldRuntimeCompletion() async throws {
        let storage = ConfigStorage.shared
        let savedFiles = ["regions.json", "rules.json", "config.json"].map { name in
            let url = storage.appSupportDirectory.appendingPathComponent(name)
            return (url, try? Data(contentsOf: url))
        }
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        defer {
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            for (url, data) in savedFiles {
                if let data { try? storage.writeSensitive(data, to: url) }
                else { try? FileManager.default.removeItem(at: url) }
            }
            ManagedExitCatalogOwnership.purge()
        }
        ManagedExitCatalogOwnership.adopt("removal-owner")
        let app = await makeApp()
        let removed = Fixture.realityNode(name: "US-Removed", id: "us-removed")
        let obsolete = Fixture.realityNode(name: "GB-Obsolete", id: "gb-obsolete", server: "203.0.114.8")
        let firstSurvivor = Fixture.realityNode(name: "JP-Survivor", id: "jp-survivor", server: "203.0.114.9")
        let newestSurvivor = Fixture.realityNode(name: "DE-Survivor", id: "de-survivor", server: "203.0.114.10")
        try await app.installManagedExitCatalog(
            try catalog([removed, obsolete, firstSurvivor], revision: 90),
            persistCache: false, allowRuntimeTransition: false
        )
        XCTAssertTrue(app.applyProxySelection(removed.name))
        app.isConnected = true
        app.coreController = CoreControllerClient()
        app.activeDirectPolicy = try app.initialDirectPolicy(
            physicalInterface: "en0",
            policy: TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
                directSuffixes: [.init(host: "example.net", ports: [443])], trusted: true)
        )
        app.managedTrafficPolicy = TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
            directSuffixes: [.init(host: "example.org", ports: [443])], trusted: true)
        let entered = expectation(description: "runtime owner is suspended")
        var resume: CheckedContinuation<Void, Never>?
        defer { resume?.resume() }
        app.optionalPolicyPreparedRuntimeMutation = { _ in
            await withCheckedContinuation { continuation in
                resume = continuation
                entered.fulfill()
            }
            // Model the old owner's authoritative completion. The controller
            // boundary is then absent so catalog drain uses the existing local
            // settlement path; no helper, PF, DNS or Core operation runs.
            app.activeNode = obsolete
            app.selectedNodeId = obsolete.id
            app.proxyService.activeNodeName = obsolete.name
            app.coreController = nil
        }
        app.scheduleBackgroundOptionalPolicy()
        let owner = app.connectionCoordinator.configReloadTask
        await fulfillment(of: [entered], timeout: 2)
        guard resume != nil, app.connectionCoordinator.configReloadTask != nil else {
            XCTFail("the fixture must hold runtime ownership before catalog installation")
            return
        }
        try await app.installManagedExitCatalog(
            try catalog([firstSurvivor], revision: 91),
            persistCache: false, allowRuntimeTransition: true
        )
        try await app.installManagedExitCatalog(
            try catalog([newestSurvivor], revision: 92),
            persistCache: false, allowRuntimeTransition: true
        )
        let continuation = resume
        resume = nil
        continuation?.resume()
        await owner?.value
        XCTAssertEqual(app.proxyService.activeNodeName, newestSurvivor.name,
                       "an old completion must drain removal against the newest catalog")
        XCTAssertEqual(app.activeNode?.name, newestSurvivor.name)
        XCTAssertTrue(app.isConnected)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
        app.optionalPolicyPreparedRuntimeMutation = nil
        ManagedExitCatalogOwnership.purge()
        await app.finishPendingPersistence()
    }

    func testOldSwitchFailureDuringCatalogRemovalReleasesWithAIHold() async {
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let armed = KillSwitchService.isArmed
        let delayWasProven = SingBoxDelayGate.isProven
        let savedIPC = KillSwitchService.armIPC
        let updateBlocked = RuntimeCleanup.nativeUpdateBlocksConnect
        let updatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        let app = await makeApp()
        let previous = Fixture.realityNode(name: "US-Removed", id: "us-removed")
        let obsolete = Fixture.realityNode(name: "GB-Obsolete", id: "gb-obsolete", server: "203.0.114.8")
        let survivor = Fixture.realityNode(name: "JP-Survivor", id: "jp-survivor", server: "203.0.114.9")
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [previous, obsolete, survivor])]
        _ = app.applyProxySelection(previous.name)
        app.isConnected = true
        app.coreController = CoreControllerClient()
        var aiHold = false
        var explicitDisarms = 0
        app.networkProtection.disarm = { explicitDisarms += 1; aiHold = false }
        app.networkProtection.releaseAfterFailure = { aiHold = true; KillSwitchService.isArmed = false }
        KillSwitchService.armIPC.prepare = { _ in throw HelperIPCError.connectFailed }
        KillSwitchService.armIPC.deliver = { _ in
            XCTFail("a refused preparation must never deliver a privileged arm")
            throw HelperIPCError.connectFailed
        }
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = armed
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            RuntimeCleanup.nativeUpdateBlocksConnect = updateBlocked
            RuntimeCleanup.nativeUpdatePending = updatePending
            app.connectionCoordinator.cancelReconnectTasks()
            if delayWasProven { SingBoxDelayGate.prove() }
            else { SingBoxDelayGate.suspend() }
        }
        KillSwitchService.isArmed = true
        app.selectNode(obsolete.name)
        let owner = app.connectionCoordinator.nodeSwitchTask
        // Model the accepted catalog state before the scheduled switch starts:
        // its captured target remains obsolete, and removal must win on error.
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [survivor])]
        app.pendingRemovedCatalogExit = true
        await owner?.value
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertTrue(aiHold)
        XCTAssertEqual(explicitDisarms, 0)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertEqual(app.proxyService.activeNodeName, survivor.name)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }

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

    func testRemovedLastExitRestoresNetworkWithAIHold() async throws {
        try await assertRemovalReleaseKeepsAIHold(connectingWithSurvivor: false)
    }

    func testRemovedConnectingExitKeepsAIHoldUntilSurvivorConnects() async throws {
        try await assertRemovalReleaseKeepsAIHold(connectingWithSurvivor: true)
    }

    private func assertRemovalReleaseKeepsAIHold(connectingWithSurvivor: Bool) async throws {
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
        let app = await makeApp()
        let updateBlocked = RuntimeCleanup.nativeUpdateBlocksConnect
        let updatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        defer {
            RuntimeCleanup.nativeUpdateBlocksConnect = updateBlocked
            RuntimeCleanup.nativeUpdatePending = updatePending
        }
        var aiHold = false
        var explicitDisarms = 0
        app.networkProtection.disarm = { explicitDisarms += 1; aiHold = false }
        app.networkProtection.releaseAfterFailure = { aiHold = true; KillSwitchService.isArmed = false }
        let removed = Fixture.realityNode(name: "US-Removed", id: "us-removed")
        let survivor = Fixture.realityNode(name: "JP-Survivor", id: "jp-survivor", server: "203.0.114.9")
        let remaining = connectingWithSurvivor ? [survivor] : []
        try await app.installManagedExitCatalog(
            try catalog([removed] + remaining, revision: 84),
            persistCache: false, allowRuntimeTransition: false
        )
        XCTAssertTrue(app.applyProxySelection(removed.name))
        app.isConnected = !connectingWithSurvivor
        app.isConnecting = connectingWithSurvivor
        app.coreController = nil
        // Keep automatic admission gated so this test only exercises the real release.
        app.initialDataLoaded = false
        KillSwitchService.isArmed = true
        try await app.installManagedExitCatalog(
            try catalog(remaining, revision: 85),
            persistCache: false, allowRuntimeTransition: true
        )
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertTrue(aiHold, "catalog cleanup must restore ordinary internet without a full user disarm")
        XCTAssertEqual(explicitDisarms, 0)
        XCTAssertFalse(app.isProtectionBlocked)
        app.connectionCoordinator.cancelReconnectTasks()
        await app.finishPendingPersistence()
    }

    /// MAC-CATALOG-REMOVED-RETRY-STUCK: Protected Offline was retrying the
    /// selected exit when the catalog removed it. Asking for a choice ended
    /// the retry loop with the barrier held and nothing scheduled.
    func testRemovedExitDuringProtectedRetryKeepsRetryingOnTheSurvivor() async throws {
        try await withRemovalWhileRetrying(survivor: true) { app in
            XCTAssertFalse(app.catalogSelectionRequiresChoice)
            XCTAssertEqual(app.proxyService.activeNodeName, "JP-Survivor")
            XCTAssertNotNil(app.connectionCoordinator.protectedReconnectTask, "the retry loop must keep its barrier's recovery")
        }
    }

    func testRemovedLastExitDuringProtectedRetryRestoresNetwork() async throws {
        try await withRemovalWhileRetrying(survivor: false) { app in
            await app.connectionCoordinator.disconnectSequence?.value
            XCTAssertTrue(app.catalogSelectionRequiresChoice)
            XCTAssertFalse(app.isProtectionBlocked)
            XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        }
    }

    private func withRemovalWhileRetrying(
        survivor keepSurvivor: Bool,
        _ verify: (AppState) async -> Void
    ) async throws {
        let storage = ConfigStorage.shared
        let savedFiles = ["regions.json", "rules.json", "config.json"].map { name in
            let url = storage.appSupportDirectory.appendingPathComponent(name)
            return (url, try? Data(contentsOf: url))
        }
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let armed = KillSwitchService.isArmed
        let updateBlocked = RuntimeCleanup.nativeUpdateBlocksConnect
        let updatePending = RuntimeCleanup.nativeUpdatePending
        // The release teardown clears these.
        let sessionDefaults = [
            SettingsKey.didStartCore, SettingsKey.lastTunEnabled, SettingsKey.connectBootSession,
        ].map { ($0, AppProfile.defaults.object(forKey: $0)) }
        let bootFiles = [
            RuntimeCleanup.connectBootSessionFile,
            RuntimeCleanup.connectBootSessionFile.appendingPathExtension("pending"),
        ].map { ($0, try? Data(contentsOf: $0)) }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        ManagedExitCatalogOwnership.adopt("removal-owner")
        let app = await makeApp()
        app.networkProtection.releaseAfterFailure = { KillSwitchService.isArmed = false }
        let removed = Fixture.realityNode(name: "US-Removed", id: "us-removed")
        let survivor = Fixture.realityNode(name: "JP-Survivor", id: "jp-survivor", server: "203.0.114.9")
        let remaining = keepSurvivor ? [survivor] : []
        let outcome: Result<Void, Error>
        do {
            try await app.installManagedExitCatalog(
                try catalog([removed] + remaining, revision: 86),
                persistCache: false, allowRuntimeTransition: false
            )
            XCTAssertTrue(app.applyProxySelection(removed.name))
            KillSwitchService.isArmed = true
            app.isProtectionBlocked = true
            // The loop sleeps in its first backoff while the catalog arrives.
            app.scheduleProtectedReconnect()
            XCTAssertNotNil(app.connectionCoordinator.protectedReconnectTask)
            try await app.installManagedExitCatalog(
                try catalog(remaining, revision: 87),
                persistCache: false, allowRuntimeTransition: true
            )
            await verify(app)
            outcome = .success(())
        } catch {
            outcome = .failure(error)
        }
        app.connectionCoordinator.cancelReconnectTasks()
        await app.connectionCoordinator.disconnectSequence?.value
        // Purging queues a save of the emptied catalog; let it land before
        // the saved files go back.
        ManagedExitCatalogOwnership.purge()
        await app.finishPendingPersistence()
        for (key, value) in sessionDefaults { AppProfile.defaults.set(value, forKey: key) }
        for (file, data) in bootFiles {
            if let data { try? data.write(to: file) }
            else { try? FileManager.default.removeItem(at: file) }
        }
        KillSwitchService.isArmed = armed
        AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
        RuntimeCleanup.nativeUpdateBlocksConnect = updateBlocked
        RuntimeCleanup.nativeUpdatePending = updatePending
        for (url, data) in savedFiles {
            if let data { try? storage.writeSensitive(data, to: url) }
            else { try? FileManager.default.removeItem(at: url) }
        }
        try outcome.get()
    }

    func testFailedAutomaticCatalogSwitchRetainsAIHold() async {
        let armed = KillSwitchService.isArmed
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let delayWasProven = SingBoxDelayGate.isProven
        let updateBlocked = RuntimeCleanup.nativeUpdateBlocksConnect
        let updatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        let app = await makeApp()
        let previous = Fixture.realityNode(name: "US-Removed", id: "us-removed")
        // Refuse config validation before privileged arm; drive the real failure owner.
        let survivor = Fixture.realityNode(name: "JP-Survivor", id: "jp-survivor", port: 0)
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [previous, survivor])]
        _ = app.applyProxySelection(previous.name)
        app.isConnected = true
        app.isRecoveringProtectedConnection = true
        app.coreController = CoreControllerClient()
        var aiHold = false
        var explicitDisarms = 0
        app.networkProtection.disarm = { explicitDisarms += 1; aiHold = false }
        app.networkProtection.releaseAfterFailure = { aiHold = true; KillSwitchService.isArmed = false }
        defer {
            KillSwitchService.isArmed = armed
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            app.connectionCoordinator.cancelReconnectTasks()
            RuntimeCleanup.nativeUpdateBlocksConnect = updateBlocked
            RuntimeCleanup.nativeUpdatePending = updatePending
            if delayWasProven { SingBoxDelayGate.prove() }
            else { SingBoxDelayGate.suspend() }
        }
        KillSwitchService.isArmed = true
        app.selectNode(survivor.name, releaseNetworkIfSwitchFails: true)
        let failedSwitch = app.connectionCoordinator.nodeSwitchTask
        await failedSwitch?.value
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertTrue(aiHold, "automatic catalog switch failure must retain the AI floor")
        XCTAssertEqual(explicitDisarms, 0)
        XCTAssertFalse(app.isProtectionBlocked)
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
        runtime.releaseAfterFailure = {}
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
