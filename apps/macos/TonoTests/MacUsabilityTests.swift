import XCTest
@testable import Tono

@MainActor
final class MacUsabilityTests: XCTestCase {
    func testLocalHealthKeepsUnknownsAndDoesNotStartOrRetireConnectionWork() async throws {
        let app = AppState()
        app.isProtectionBlocked = true
        app.errorMessage = "secret-token https://private.example/path?token=secret"
        app.lastConnectionFailure = .init(stage: .securingDNS, message: app.errorMessage!, occurredAt: Date())
        let generation = app.connectionCoordinator.protectionOperationGeneration
        let observation = await app.collectLocalHealth(account: nil, probe: { .init() })
        let check = try XCTUnwrap(observation)
        XCTAssertTrue(check.snapshot.protectionBlocked)
        XCTAssertNil(check.runtime.coreRunning)
        XCTAssertNil(check.request.report.killSwitchLive)
        XCTAssertNil(check.request.report.dnsEnabled)
        XCTAssertEqual(check.findings.first { $0.id == "protection" }?.status, .unknown)
        XCTAssertEqual(app.connectionCoordinator.protectionOperationGeneration, generation)
        XCTAssertNil(app.connectionCoordinator.connectTask)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
        XCTAssertTrue(app.isProtectionBlocked)
        let preview = try check.request.preview()
        XCTAssertFalse(preview.contains("secret-token"))
        XCTAssertFalse(preview.contains("private.example"))
        XCTAssertEqual(check.request.report.error, "dns")

        let retired = await app.collectLocalHealth(account: nil, probe: {
            await MainActor.run { app.connectionCoordinator.bumpGeneration() }
            return .init(coreRunning: true)
        })
        XCTAssertNil(retired, "a late probe must not mix attempts")
    }

    func testBuildIdentityReadsBundledSourceWithoutClaimingReleaseAttestation() async throws {
        // Built by the production Xcode phase, not a test-only source constant.
        let source = try XCTUnwrap(AppBuildSource.read())
        XCTAssertTrue(["Debug", "Release"].contains(source.configuration))
        XCTAssertEqual(source.commit?.count, 40)
        XCTAssertNotNil(source.dirty)
        let app = AppState()
        let observation = await app.collectLocalHealth(account: nil, probe: {
            .init(helperInstalled: true, helperVersion: "3.0.1", coreRunning: true, corePID: 321, dnsConfigured: true)
        })
        let check = try XCTUnwrap(observation)
        XCTAssertTrue(check.localIdentity.contains("Helper observed protocol: 3.0.1"))
        XCTAssertTrue(check.localIdentity.contains("Core PID: 321; binary identity: unknown"))
        XCTAssertTrue(check.localIdentity.contains("Signing / notarization / release channel: unverified"))
        XCTAssertNil(check.request.report.serviceBuild)
    }

    func testFavoritesAreAccountScopedBoundedCatalogFilteredAndShareHy2Identity() throws {
        let suite = "tono-route-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); ManagedExitCatalogOwnership.purge() }
        defaults.set(Data("corrupt".utf8), forKey: LocalRoutePreferences.storageKey)
        let app = AppState()
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        let tcp = Fixture.realityNode()
        let hy2 = Fixture.hy2Node()
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: [tcp, hy2])]
        ManagedExitCatalogOwnership.adopt("account-a")
        app.toggleRouteFavorite(hy2.name, owner: "account-a")
        XCTAssertEqual(app.routePreferences.favorites(owner: "account-a", catalog: [tcp, hy2]), [tcp.name])
        XCTAssertTrue(app.routePreferences.favorites(owner: "account-b", catalog: [tcp]).isEmpty)
        XCTAssertTrue(app.routePreferences.favorites(owner: "account-a", catalog: []).isEmpty)
        XCTAssertNil(app.connectionCoordinator.connectTask, "a star must not connect")
        for index in 0..<40 {
            let node = Fixture.realityNode(name: "Route \(index)")
            app.proxyRegions[0].nodes.append(node)
            app.toggleRouteFavorite(node.name, owner: "account-a")
        }
        XCTAssertEqual(app.routePreferences.favorites(owner: "account-a", catalog: app.managedCatalogNodes).count, 32)
        let bytes = try XCTUnwrap(defaults.data(forKey: LocalRoutePreferences.storageKey))
        let saved = String(decoding: bytes, as: UTF8.self)
        XCTAssertFalse(saved.contains("account-a"))
        XCTAssertFalse(saved.contains(tcp.uuid!))
        XCTAssertFalse(saved.contains(tcp.server))
        XCTAssertEqual(LocalRoutePreferences(defaults: defaults).favorites(owner: "account-a", catalog: app.managedCatalogNodes).count, 32)
    }

    func testRecommendationRequiresVerifiedRecentSuccessAndConfirmationCannotSwitchHealthyExit() throws {
        let suite = "tono-recommendation-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let priorSelection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        defer {
            defaults.removePersistentDomain(forName: suite); ManagedExitCatalogOwnership.purge()
            AppProfile.defaults.set(priorSelection, forKey: SettingsKey.selectedProxyTargetName)
        }
        let app = AppState()
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        ManagedExitCatalogOwnership.adopt("account-a")
        var quick = Fixture.realityNode(name: "Fast but untested", id: "fast")
        quick.latency = 1
        var proven = Fixture.realityNode(name: "Previously successful", id: "proven")
        proven.latency = 4_000
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: [quick, proven])]
        app.managedCatalogDigest = String(repeating: "a", count: 64)
        app.selectedNodeId = quick.id
        app.activeNode = quick
        app.proxyService.activeNodeName = quick.name
        let now = Date()
        let generation = app.connectionCoordinator.protectionOperationGeneration
        app.recordVerifiedRouteSuccess(proven.name, owner: "account-a", generation: generation, now: now)
        XCTAssertTrue(app.routePreferences.recentSuccesses(owner: "account-a", catalog: app.managedCatalogNodes).isEmpty)
        app.isConnected = true
        app.proxyService.activeNodeName = proven.name
        app.recordVerifiedRouteSuccess(proven.name, owner: "account-a", generation: generation, now: now)
        app.proxyService.activeNodeName = quick.name
        app.isConnected = false
        let proposal = try XCTUnwrap(app.routeRecommendation(owner: "account-a", now: now))
        XCTAssertEqual(proposal.name, proven.name, "a 1ms untested candidate cannot win")
        XCTAssertEqual(app.selectedNodeId, quick.id, "recommendation is not selection")
        XCTAssertNil(app.connectionCoordinator.connectTask)
        app.isConnected = true
        XCTAssertFalse(app.confirmRouteRecommendation(proposal, now: now))
        XCTAssertEqual(app.proxyService.activeNodeName, quick.name)
        app.isConnected = false
        XCTAssertNil(app.routeRecommendation(owner: "account-a", now: now.addingTimeInterval(86_401))?.successfulAt)
        app.managedCatalogDigest = String(repeating: "b", count: 64)
        XCTAssertFalse(app.confirmRouteRecommendation(proposal, now: now))
        app.managedCatalogDigest = proposal.catalogDigest
        XCTAssertTrue(app.confirmRouteRecommendation(proposal, now: now))
        XCTAssertEqual(app.selectedExitNode()?.name, proven.name)
        XCTAssertTrue(app.isConnecting, "confirmation enters the existing connect owner")
        app.connectionCoordinator.cancelConnectionTasks()
        app.retireFailedRouteSuccess(proven.name, owner: "account-a", generation: generation)
        XCTAssertEqual(app.routePreferences.recentSuccesses(owner: "account-a", catalog: app.managedCatalogNodes).count, 1)
        app.retireFailedRouteSuccess(proven.name, owner: "account-a", generation: app.connectionCoordinator.protectionOperationGeneration)
        XCTAssertTrue(app.routePreferences.recentSuccesses(owner: "account-a", catalog: app.managedCatalogNodes).isEmpty)
    }

    func testFixedRegionNeverFallsBackToAnOutsideSuccessWhenRegionIsUnavailable() throws {
        let suite = "tono-fixed-region-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); ManagedExitCatalogOwnership.purge() }
        let app = AppState()
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        ManagedExitCatalogOwnership.adopt("account-a")
        let outside = Fixture.realityNode()
        let inside = Fixture.realityNode(name: "JP-VLESS-Reality", id: "jp", flag: "🇯🇵")
        let unknown = Fixture.realityNode(name: "Jade Passage", id: "unknown", flag: "")
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: [outside, inside, unknown])]
        app.managedCatalogDigest = String(repeating: "a", count: 64)
        app.selectedNodeId = outside.id
        app.activeNode = outside
        app.proxyService.activeNodeName = outside.name
        app.isConnected = true
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        app.recordVerifiedRouteSuccess(outside.name, owner: "account-a", generation: app.connectionCoordinator.protectionOperationGeneration, now: now)
        app.isConnected = false
        let unrestricted = try XCTUnwrap(app.routeRecommendation(owner: "account-a", now: now))
        XCTAssertEqual(unrestricted.name, outside.name)
        XCTAssertEqual(unrestricted.successfulAt, now)

        app.setPreferredRouteRegion("JP", owner: "account-a")
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        XCTAssertEqual(app.routePreferences.preferredRegion(owner: "account-a"), "JP")
        XCTAssertNil(app.routePreferences.preferredRegion(owner: "account-b"))
        XCTAssertEqual(app.routePreferenceRegions, ["JP", "US"])
        let inRegion = try XCTUnwrap(app.routeRecommendation(owner: "account-a", now: now))
        XCTAssertEqual(inRegion.name, inside.name)
        XCTAssertNil(inRegion.successfulAt, "outside success is not evidence for this untested route")
        XCTAssertFalse(app.confirmRouteRecommendation(unrestricted, now: now))
        XCTAssertEqual(app.selectedNodeId, outside.id)

        // The only actual in-region route is vendor-blocked; the unknown
        // location's display initials happen to be JP but are not geography.
        let blocked = Fixture.hy2Node(name: "JP-VLESS-Reality · hy2", id: "jp-hy2", flag: "🇯🇵")
        app.proxyRegions[0].nodes = [outside, blocked, unknown]
        XCTAssertTrue(ProxyNode.hy2UdpIsVendorBlocked(blocked.name))
        XCTAssertEqual(nodeRegionCode(flag: unknown.flag, name: unknown.name), "JP")
        XCTAssertNil(app.routeRecommendation(owner: "account-a", now: now))
        app.proxyRegions[0].nodes = [outside, unknown]
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        XCTAssertEqual(app.routePreferences.preferredRegion(owner: "account-a"), "JP")
        XCTAssertNil(app.routeRecommendation(owner: "account-a", now: now), "removed region must not silently clear")
        app.setPreferredRouteRegion("XX", owner: "account-a")
        app.setPreferredRouteRegion(nil, owner: "account-b")
        XCTAssertEqual(app.routePreferences.preferredRegion(owner: "account-a"), "JP")
        XCTAssertNil(app.connectionCoordinator.connectTask)
        XCTAssertFalse(app.isConnected)

        app.setPreferredRouteRegion(nil, owner: "account-a")
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        XCTAssertEqual(app.routeRecommendation(owner: "account-a", now: now)?.name, outside.name)
        // Even when the name/evidence are unchanged, changing the preference
        // retires the old confirmation instead of reusing its consent.
        app.setPreferredRouteRegion("US", owner: "account-a")
        XCTAssertFalse(app.confirmRouteRecommendation(unrestricted, now: now))
        XCTAssertNil(app.connectionCoordinator.connectTask)
    }

    func testRecoveryFeedbackUsesExistingOwnerAndReleaseClearsIt() async {
        let app = AppState()
        app.recoveryCause = .wake
        app.isProtectionBlocked = true
        app.protectedReconnectPausedForUserAction = true
        let initial = app.connectionCoordinator.protectionOperationGeneration
        XCTAssertNotNil(app.recoveryFeedback)
        XCTAssertEqual(app.connectionCoordinator.protectionOperationGeneration, initial)
        app.retryProtectedConnectionNow()
        XCTAssertFalse(app.protectedReconnectPausedForUserAction)
        XCTAssertNotNil(app.connectionCoordinator.protectedReconnectTask)
        app.connectionCoordinator.cancelReconnectTasks()
        app.networkProtection.repairForRelease = {}
        app.networkProtection.coreStatus = { (false, true) }
        app.networkProtection.stopCore = { _ in true }
        app.networkProtection.restoreDNS = { true }
        app.networkProtection.disableSystemProxy = {}
        app.networkProtection.disarm = {}
        app.networkProtection.restrictToBootstrap = {}
        await app.disconnectAndWait(releaseKillSwitch: true)
        XCTAssertNil(app.recoveryCause)
        XCTAssertNil(app.recoveryFeedback)
    }

    func testActivityExplanationUsesTerminalEvidenceNotTheSelectedNodeOrRule() throws {
        let app = AppState()
        let cloud = Fixture.realityNode(name: "Cloud")
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: [cloud])]
        app.residentialRouteAuditContext = .init(generation: 1, runtimeConfigDigest: "fixture", admittedTerminal: "Home terminal")
        let flow = APIConnection(id: "flow", metadata: .init(network: "tcp", type: "HTTPS", process: "Example", processPath: nil, sourceIP: "198.18.0.1", destinationIP: "203.0.113.1", sourcePort: "1000", destinationPort: "443", host: "example.test"), upload: 3, download: 12, start: "2026-09-22", chains: ["Cloud", "Home terminal", "Tono-Claude-Home"], rule: "DOMAIN-SUFFIX", rulePayload: "example.test")
        app.updateConnections(from: .init(downloadTotal: 12, uploadTotal: 3, connections: [flow]))
        let entry = try XCTUnwrap(app.connections.first)
        XCTAssertEqual(entry.routingExplanation?.path, .cloud)
        XCTAssertEqual(entry.routingExplanation?.chain, ["Cloud", "Home terminal", "Tono-Claude-Home"])
        let unknown = APIConnection(id: "unknown", metadata: flow.metadata, upload: 0, download: 0, start: flow.start, chains: [], rule: "DIRECT", rulePayload: nil)
        app.updateConnections(from: .init(downloadTotal: 0, uploadTotal: 0, connections: [unknown]))
        XCTAssertEqual(app.connections.first?.routingExplanation?.path, .unknown)
    }
}
