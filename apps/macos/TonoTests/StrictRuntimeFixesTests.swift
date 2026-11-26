import CryptoKit
import Foundation
import XCTest
@testable import Tono

@MainActor
final class StrictRuntimeFixesTests: XCTestCase {
    private enum TestError: Error {
        case failed
    }

    private func stubbedNetworkProtection() -> NetworkProtectionOperations {
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { KillSwitchService.isArmed = false }
        runtime.releaseAfterFailure = { KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        return runtime
    }

    private func exitCatalog(_ nodes: [ProxyNode], revision: Int, owner: String = "strict-test-owner") throws -> ManagedExitCatalogCache {
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
            owner: owner
        )
    }

    func testStrictRoutingSessionActiveReflectsAllFourSources() throws {
        let defaults = AppProfile.defaults
        let savedSession = defaults.object(forKey: SettingsKey.routingSession)
        let savedStrict = defaults.object(forKey: "strictRoutingSessionIntent")
        let savedArmed = KillSwitchService.isArmed
        defer {
            defaults.set(savedSession, forKey: SettingsKey.routingSession)
            defaults.set(savedStrict, forKey: "strictRoutingSessionIntent")
            KillSwitchService.isArmed = savedArmed
        }
        KillSwitchService.isArmed = false
        defaults.removeObject(forKey: SettingsKey.routingSession)
        defaults.removeObject(forKey: "strictRoutingSessionIntent")

        let clean = AppState()
        XCTAssertFalse(clean.strictRoutingSessionActive)
        XCTAssertEqual(clean.effectiveRoutingMode, "stable")

        clean.connectionCoordinator.capturedRoutingMode = "three-tier"
        XCTAssertTrue(clean.strictRoutingSessionActive)
        XCTAssertEqual(clean.effectiveRoutingMode, "three-tier")
        clean.connectionCoordinator.capturedRoutingMode = nil
        XCTAssertFalse(clean.strictRoutingSessionActive)

        defaults.set("three-tier", forKey: SettingsKey.routingSession)
        XCTAssertTrue(clean.strictRoutingSessionActive)
        defaults.removeObject(forKey: SettingsKey.routingSession)

        defaults.set(true, forKey: "strictRoutingSessionIntent")
        XCTAssertTrue(clean.strictRoutingSessionActive)
        defaults.removeObject(forKey: "strictRoutingSessionIntent")

        try clean.coreRuntime.captureRoutingMode("three-tier", physicalInterface: "en0")
        XCTAssertTrue(clean.strictRoutingSessionActive)
        clean.coreRuntime.retireRoutingMode()
        defaults.removeObject(forKey: SettingsKey.routingSession)
        XCTAssertFalse(clean.strictRoutingSessionActive)
    }

    func testFakeIPPoolPersistsInstalledSlotAcrossFreshInstanceAndClearsOnReset() throws {
        let suite = "tono-strict-fakeip-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        let pool1 = SingBoxFakeIPRotation(defaults: defaults)
        let doc1 = pool1.document(installed: nil, keeping: true) { slot in
            Data("{\"slot\":\(slot % ConfigPipeline.singBoxFakeIPSlots)}".utf8)
        }
        let digest1 = SHA256.hash(data: doc1).map { String(format: "%02x", $0) }.joined()

        let pool2 = SingBoxFakeIPRotation(defaults: defaults)
        let doc2 = pool2.document(installed: digest1, keeping: true) { slot in
            Data("{\"slot\":\(slot % ConfigPipeline.singBoxFakeIPSlots)}".utf8)
        }
        XCTAssertEqual(doc2, doc1, "a relaunched FakeIP pool must keep the installed slot when digest matches")

        pool2.clearRememberedInstalled()
        let pool3 = SingBoxFakeIPRotation(defaults: defaults)
        let doc3 = pool3.document(installed: digest1, keeping: true) { slot in
            Data("{\"slot\":\(slot % ConfigPipeline.singBoxFakeIPSlots)}".utf8)
        }
        XCTAssertNotEqual(doc3, doc1, "clearing remembered installed entries must rotate away from the old slot")
    }

    func testStrictSessionPersistenceRestoresOnRelaunchAndClearsOnRelease() {
        let defaults = AppProfile.defaults
        let savedStrict = defaults.object(forKey: "strictRoutingSessionIntent")
        let savedSession = defaults.object(forKey: SettingsKey.routingSession)
        let savedSecret = defaults.object(forKey: StrictSessionPersistence.secretKey)
        let savedMixed = defaults.object(forKey: StrictSessionPersistence.mixedPortKey)
        let savedController = defaults.object(forKey: StrictSessionPersistence.controllerPortKey)
        let savedDigest = defaults.object(forKey: StrictSessionPersistence.runtimeDigestKey)
        let savedFakeIP = defaults.object(forKey: SingBoxFakeIPRotation.rememberedDefaultsKey)
        defer {
            defaults.set(savedStrict, forKey: "strictRoutingSessionIntent")
            defaults.set(savedSession, forKey: SettingsKey.routingSession)
            defaults.set(savedSecret, forKey: StrictSessionPersistence.secretKey)
            defaults.set(savedMixed, forKey: StrictSessionPersistence.mixedPortKey)
            defaults.set(savedController, forKey: StrictSessionPersistence.controllerPortKey)
            defaults.set(savedDigest, forKey: StrictSessionPersistence.runtimeDigestKey)
            defaults.set(savedFakeIP, forKey: SingBoxFakeIPRotation.rememberedDefaultsKey)
        }

        let secret = Data(repeating: 9, count: 32).base64EncodedString()
        StrictSessionPersistence.save(
            secret: secret,
            mixedPort: 35_210,
            controllerPort: 35_211,
            runtimeDigest: "bound-digest-1"
        )
        defaults.set(true, forKey: "strictRoutingSessionIntent")
        defaults.set("three-tier", forKey: SettingsKey.routingSession)

        let relaunched = AppState()
        XCTAssertEqual(relaunched.config.secret, secret)
        XCTAssertEqual(relaunched.config.mixedPort, 35_210)
        XCTAssertEqual(relaunched.config.externalController, "127.0.0.1:35211")
        XCTAssertEqual(StrictSessionPersistence.load()?.runtimeDigest, "bound-digest-1")

        relaunched.connectionCoordinator.retireCapturedRoutingMode()
        XCTAssertNil(StrictSessionPersistence.load())

        StrictSessionPersistence.save(
            secret: secret,
            mixedPort: 35_212,
            controllerPort: 35_213,
            runtimeDigest: "bound-digest-2"
        )
        relaunched.resetReleasedSessionHistory()
        XCTAssertNil(StrictSessionPersistence.load())
    }

    func testBeginPreemptiveReleaseBumpsConfigReloadRequestIDAndSuppressesStalePinsFailure() async throws {
        let savedArmed = KillSwitchService.isArmed
        let savedIPC = KillSwitchService.armIPC
        let savedSlot = AppProfile.defaults.object(forKey: SingBoxFakeIPRotation.defaultsKey)
        let savedSelection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let savedSession = AppProfile.defaults.object(forKey: SettingsKey.routingSession)
        let savedStrict = AppProfile.defaults.object(forKey: "strictRoutingSessionIntent")
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        let app = AppState()
        app.networkProtection = stubbedNetworkProtection()
        let configFile = app.coreRuntime.configFilePath
        let savedConfig = try? Data(contentsOf: configFile)
        defer {
            app.connectionCoordinator.cancelReconnectTasks()
            KillSwitchService.isArmed = savedArmed
            KillSwitchService.armIPC = savedIPC
            AppProfile.defaults.set(savedSlot, forKey: SingBoxFakeIPRotation.defaultsKey)
            AppProfile.defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
            AppProfile.defaults.set(savedSession, forKey: SettingsKey.routingSession)
            AppProfile.defaults.set(savedStrict, forKey: "strictRoutingSessionIntent")
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            if let savedConfig { try? savedConfig.write(to: configFile) }
            else { try? FileManager.default.removeItem(at: configFile) }
        }

        let coordinator = ConnectionCoordinator()
        let initialID = coordinator.configReloadRequestID
        coordinator.configReloadTask = Task {}
        coordinator.beginPreemptiveRelease()
        XCTAssertGreaterThan(coordinator.configReloadRequestID, initialID)
        XCTAssertNil(coordinator.configReloadTask)

        try app.coreRuntime.captureRoutingMode("stable", physicalInterface: "en0")
        let node = Fixture.realityNode(name: "Los Angeles · Canyon")
        app.proxyRegions = [ProxyRegion(id: "custom", name: "Custom", nodes: [node])]
        _ = app.applyProxySelection(node.name)
        app.coreController = CoreControllerClient(port: 9)
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.config.tunEnabled = true
        app.isConnected = true
        KillSwitchService.isArmed = true
        KillSwitchService.armIPC.prepare = { _ in }
        KillSwitchService.armIPC.deliver = { _ in
            (true, true, true, false, false, 0, LocalNetworkDevicesSync.desired.allow, nil)
        }

        let waitingTunnel = expectation(description: "pins refresh waiting for tunnel")
        var tunnelContinuation: CheckedContinuation<Bool, Never>?
        defer { tunnelContinuation?.resume(returning: false) }
        var operations = AppState.ConfigReloadOperations()
        operations.sync = { _, _ in "/var/run/tono-core/runtime/config.json" }
        operations.waitForTunnel = {
            await withCheckedContinuation { cont in
                tunnelContinuation = cont
                waitingTunnel.fulfill()
            }
        }
        let pending = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0", domainPins: [], mediaEndpoints: []
        )
        app.reloadCoreConfig(applyingDirectPolicy: pending, operations: operations)
        let reloadTask = app.connectionCoordinator.configReloadTask
        await fulfillment(of: [waitingTunnel], timeout: 2)

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
        app.preemptiveReleaseOperation = { _, _, _ in
            (.success(restored), false)
        }
        app.restoreInternetPreemptively()
        await app.finishPendingDisconnect()

        tunnelContinuation?.resume(returning: false)
        tunnelContinuation = nil
        await reloadTask?.value

        XCTAssertFalse(app.isConnected)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertNil(app.connectionCoordinator.unarmedReconnectTask)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertNil(app.errorMessage)
    }

    func testAIHomeAndThreeTierSkipOptionalPolicyAndManagedDirectPinRefreshes() async throws {
        let defaults = AppProfile.defaults
        let savedSession = defaults.object(forKey: SettingsKey.routingSession)
        let savedStrict = defaults.object(forKey: "strictRoutingSessionIntent")
        defer {
            defaults.set(savedSession, forKey: SettingsKey.routingSession)
            defaults.set(savedStrict, forKey: "strictRoutingSessionIntent")
        }

        for mode in ["ai-home", "three-tier"] {
            defaults.removeObject(forKey: "strictRoutingSessionIntent")
            defaults.removeObject(forKey: SettingsKey.routingSession)
            let app = AppState()
            try app.coreRuntime.captureRoutingMode(mode, physicalInterface: "en0")
            app.isConnected = true
            app.tonoTransport = TonoTransportDescriptor(port: 1080)
            app.coreController = CoreControllerClient(port: 9)
            app.activeDirectPolicy = try app.initialDirectPolicy(
                physicalInterface: "en0",
                policy: TonoTrafficPolicy(
                    version: 3,
                    domains: [.init(host: "api.weixin.qq.com", ports: [443])],
                    mediaEndpoints: [],
                    webDomains: [.init(host: "www.qq.com", ports: [443])],
                    trusted: true
                )
            )
            app.managedTrafficPolicy = TonoTrafficPolicy(
                version: 4,
                domains: [.init(host: "api.weixin.qq.com", ports: [443])],
                mediaEndpoints: [],
                webDomains: [.init(host: "www.qq.com", ports: [443])],
                trusted: true
            )
            app.optionalPolicyRuntimeMutation = {
                XCTFail("\(mode) must skip optional policy replacement")
            }

            app.scheduleBackgroundOptionalPolicy()
            XCTAssertNil(app.connectionCoordinator.configReloadTask)
            XCTAssertFalse(app.pendingOptionalPolicyReload)

            await app.refreshManagedDirectPins(resolver: { _, _, _ in
                XCTFail("\(mode) must skip managed direct pin resolution")
                return nil
            })
            XCTAssertNil(app.connectionCoordinator.configReloadTask)

            app.reloadCoreConfig(applyingDirectPolicy: app.activeDirectPolicy)
            XCTAssertNil(app.connectionCoordinator.configReloadTask)
        }
    }

    func testStrictSettleRemovedCatalogExitPausesWithStrictBlockAndNoLiveSwitch() async throws {
        let storage = ConfigStorage.shared
        let savedFiles = ["regions.json", "rules.json", "config.json"].map { name in
            let url = storage.appSupportDirectory.appendingPathComponent(name)
            return (url, try? Data(contentsOf: url))
        }
        let defaults = AppProfile.defaults
        let savedSession = defaults.object(forKey: SettingsKey.routingSession)
        let savedStrict = defaults.object(forKey: "strictRoutingSessionIntent")
        let savedSelection = defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let savedArmed = KillSwitchService.isArmed
        defer {
            KillSwitchService.isArmed = savedArmed
            defaults.set(savedSession, forKey: SettingsKey.routingSession)
            defaults.set(savedStrict, forKey: "strictRoutingSessionIntent")
            defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
            for (url, data) in savedFiles {
                if let data { try? storage.writeSensitive(data, to: url) }
                else { try? FileManager.default.removeItem(at: url) }
            }
            ManagedExitCatalogOwnership.purge()
        }

        ManagedExitCatalogOwnership.adopt("strict-test-owner")
        KillSwitchService.isArmed = true
        defaults.set(true, forKey: "strictRoutingSessionIntent")

        let app = AppState()
        app.networkProtection = stubbedNetworkProtection()
        try app.coreRuntime.captureRoutingMode("three-tier", physicalInterface: "en0")
        let removed = Fixture.realityNode(name: "US-Removed", id: "us-removed", server: "203.0.114.8")
        let survivor = Fixture.realityNode(name: "JP-Survivor", id: "jp-survivor", server: "203.0.114.9")
        try await app.installManagedExitCatalog(
            try exitCatalog([removed, survivor], revision: 10),
            persistCache: false,
            allowRuntimeTransition: false
        )
        XCTAssertTrue(app.applyProxySelection(removed.name))
        app.isConnected = true
        app.coreController = CoreControllerClient(port: 9)

        // Switching while connected in Strict mode must refuse without mutating selection.
        app.selectNode(survivor.name)
        XCTAssertEqual(app.activeNode?.name, removed.name)
        XCTAssertEqual(app.proxyService.activeNodeName, removed.name)

        // Removing the selected exit in Strict mode must pause fail-closed without attempting selectNode(survivor).
        try await app.installManagedExitCatalog(
            try exitCatalog([survivor], revision: 11),
            persistCache: false,
            allowRuntimeTransition: true
        )
        await app.finishPendingDisconnect()

        XCTAssertFalse(app.isConnected)
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertTrue(app.protectedReconnectPausedForUserAction)
        XCTAssertFalse(app.protectedReconnectPauseLiftsOnNetworkChange)
        XCTAssertTrue(app.catalogSelectionRequiresChoice)
        XCTAssertNil(app.connectionCoordinator.nodeSwitchTask)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertEqual(app.proxyService.activeNodeName, removed.name)
        XCTAssertTrue(app.errorMessage?.contains("Restore internet") ?? false)
        XCTAssertFalse(app.errorMessage?.contains("back on its normal internet") ?? true)
    }

    func testStrictReleaseAfterPausedFailureKeepsStrictBlockWithoutNormalInternetCopy() async throws {
        let defaults = AppProfile.defaults
        let savedSession = defaults.object(forKey: SettingsKey.routingSession)
        let savedStrict = defaults.object(forKey: "strictRoutingSessionIntent")
        let savedArmed = KillSwitchService.isArmed
        defer {
            KillSwitchService.isArmed = savedArmed
            defaults.set(savedSession, forKey: SettingsKey.routingSession)
            defaults.set(savedStrict, forKey: "strictRoutingSessionIntent")
        }
        KillSwitchService.isArmed = true
        defaults.set(true, forKey: "strictRoutingSessionIntent")

        let app = AppState()
        var runtime = stubbedNetworkProtection()
        runtime.disarm = { XCTFail("Strict paused failure must never disarm") }
        runtime.releaseAfterFailure = { XCTFail("Strict paused failure must never fail-open release") }
        app.networkProtection = runtime
        try app.coreRuntime.captureRoutingMode("three-tier", physicalInterface: "en0")
        app.isConnected = true
        app.coreRuntime.isRunning = true

        app.releaseAfterPausedFailure(
            pending: "Tono is restoring this Mac's normal internet",
            released: "This Mac is back on its normal internet"
        )
        await app.finishPendingDisconnect()

        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertTrue(app.protectedReconnectPausedForUserAction)
        XCTAssertFalse(app.protectedReconnectPauseLiftsOnNetworkChange)
        XCTAssertTrue(app.errorMessage?.contains("Restore internet") ?? false)
        XCTAssertFalse(app.errorMessage?.contains("back on its normal internet") ?? true)
        XCTAssertFalse(app.errorMessage?.contains("restoring") ?? true)

        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.holdProtectedDNSSupplementalConflict([
            .init(source: "/etc/resolver/corp.example", domains: ["corp.example"], servers: ["10.0.0.53"]),
        ])
        await app.finishPendingDisconnect()
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertTrue(app.protectedReconnectPausedForUserAction)
        XCTAssertTrue(app.errorMessage?.contains("Restore internet") ?? false)
        XCTAssertFalse(app.errorMessage?.contains("back on its normal internet") ?? true)
    }

    func testMidSwitchCatalogRemovalOfSwitchTargetDoesNotCommitRemovedTarget() async throws {
        let storage = ConfigStorage.shared
        let savedFiles = ["regions.json", "rules.json", "config.json"].map { name in
            let url = storage.appSupportDirectory.appendingPathComponent(name)
            return (url, try? Data(contentsOf: url))
        }
        let defaults = AppProfile.defaults
        let savedSelection = defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let savedArmed = KillSwitchService.isArmed
        let delayWasProven = SingBoxDelayGate.isProven
        defer {
            KillSwitchService.isArmed = savedArmed
            defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
            for (url, data) in savedFiles {
                if let data { try? storage.writeSensitive(data, to: url) }
                else { try? FileManager.default.removeItem(at: url) }
            }
            ManagedExitCatalogOwnership.purge()
            if delayWasProven { SingBoxDelayGate.prove() }
            else { SingBoxDelayGate.suspend() }
        }

        ManagedExitCatalogOwnership.adopt("switch-owner")
        KillSwitchService.isArmed = true
        let app = AppState()
        let nodeA = Fixture.realityNode(name: "Tokyo-A", id: "tokyo-a", server: "203.0.114.10")
        let nodeB = Fixture.realityNode(name: "Singapore-B", id: "singapore-b", server: "203.0.114.20")
        try await app.installManagedExitCatalog(
            try exitCatalog([nodeA, nodeB], revision: 20, owner: "switch-owner"),
            persistCache: false,
            allowRuntimeTransition: false
        )
        XCTAssertTrue(app.applyProxySelection(nodeA.name))
        app.isConnected = true
        app.networkInfo = NetworkInfo(ip: "203.0.114.10", org: "AS64512", location: "JP")

        let verifyEntered = expectation(description: "switch verify suspended")
        var verifyContinuation: CheckedContinuation<ConnectivityVerdict, Never>?
        defer { verifyContinuation?.resume(returning: .connected(controllerAdvisory: nil)) }

        var remembered: [String] = []
        let ops = AppState.NodeSwitchOperations(
            armKillSwitch: { _ in },
            applyRuntimeConfig: { _ in },
            waitForTunnel: { true },
            verify: { _ in
                await withCheckedContinuation { cont in
                    verifyContinuation = cont
                    verifyEntered.fulfill()
                }
            },
            closeConnections: { _ in },
            rememberNode: { node, name in
                remembered.append(name)
                app.selectedNodeId = node?.id ?? ConfigPipeline.homeNodeName
                app.activeNode = node
                app.proxyService.activeNodeName = name
            },
            refreshProxy: {}
        )

        app.selectNode(nodeB.name, operations: ops)
        let switchTask = app.connectionCoordinator.nodeSwitchTask
        await fulfillment(of: [verifyEntered], timeout: 2)

        // Catalog removes switch target B while A stays available.
        try await app.installManagedExitCatalog(
            try exitCatalog([nodeA], revision: 21, owner: "switch-owner"),
            persistCache: false,
            allowRuntimeTransition: true
        )

        verifyContinuation?.resume(returning: .connected(controllerAdvisory: nil))
        verifyContinuation = nil
        await switchTask?.value
        await app.connectionCoordinator.configReloadTask?.value

        XCTAssertTrue(remembered.isEmpty, "removed target B must never be committed")
        XCTAssertEqual(app.proxyService.activeNodeName, nodeA.name)
        XCTAssertEqual(app.activeNode?.name, nodeA.name)
        XCTAssertNil(app.switchingNodeId)
        XCTAssertTrue(app.isConnected)
    }

    func testHy2AutoSwitchRestoresRealitySelectionOnCancelAndWatchdog() throws {
        let suite = "tono-hy2-restore-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let savedSelection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let savedSession = AppProfile.defaults.object(forKey: SettingsKey.routingSession)
        let savedMode = AppProfile.defaults.object(forKey: SettingsKey.desktopRoutingMode)
        let savedArmed = KillSwitchService.isArmed
        defer {
            defaults.removePersistentDomain(forName: suite)
            AppProfile.defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
            AppProfile.defaults.set(savedSession, forKey: SettingsKey.routingSession)
            AppProfile.defaults.set(savedMode, forKey: SettingsKey.desktopRoutingMode)
            KillSwitchService.isArmed = savedArmed
            ManagedExitCatalogOwnership.purge()
        }

        let owner = "hy2-restore-owner"
        ManagedExitCatalogOwnership.adopt(owner)
        let reality = Fixture.realityNode(name: "Buffalo · Niagara", id: "niagara")
        var hy2 = Fixture.hy2Node(name: "Buffalo · Niagara · hy2", id: "niagara-hy2")
        hy2.certificatePublicKeySHA256 = Data(repeating: 7, count: 32).base64EncodedString()

        let app = AppState()
        app.hy2AutoSwitch = Hy2AutoSwitch(defaults: defaults)
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [reality, hy2])]
        XCTAssertTrue(app.applyProxySelection(reality.name))
        app.persistProxySelection(reality.name)
        app.applyHy2AutoSwitchPermission(true, owner: owner)

        let now = Date(timeIntervalSinceReferenceDate: 800_000_000)
        for _ in 0..<Hy2AutoSwitch.tcpFailureThreshold {
            app.applyHy2AutoSwitchForConnect(now: now)
            app.lastClassifiedFailure = ProtectedConnectivity.failure(
                .coreExitUnreachable, stage: "verifyingTraffic", attempt: 1, generation: 1, detail: "eof"
            )
            app.noteHy2AutoSwitchConnectFailure(dialed: reality.name, now: now)
        }

        app.applyHy2AutoSwitchForConnect(now: now)
        XCTAssertEqual(app.currentProxySelectionTarget(), hy2.name)
        app.prepareTeardownState(releaseKillSwitch: false)
        XCTAssertEqual(app.currentProxySelectionTarget(), reality.name)
        app.isDisconnecting = false
        app.isProtectionBlocked = false

        // Trigger another automatic hy2 dial after cooldown, then simulate cancel/watchdog restore.
        let afterCooldown = now.addingTimeInterval(Hy2AutoSwitch.retryAfterHy2Failure + 1)
        for _ in 0..<Hy2AutoSwitch.tcpFailureThreshold {
            app.applyHy2AutoSwitchForConnect(now: afterCooldown)
            app.lastClassifiedFailure = ProtectedConnectivity.failure(
                .coreExitUnreachable, stage: "verifyingTraffic", attempt: 1, generation: 1, detail: "eof"
            )
            app.noteHy2AutoSwitchConnectFailure(dialed: reality.name, now: afterCooldown)
        }
        app.applyHy2AutoSwitchForConnect(now: afterCooldown)
        XCTAssertEqual(app.currentProxySelectionTarget(), hy2.name)
        app.restoreSelectionAfterHy2AutoDial()
        XCTAssertEqual(app.currentProxySelectionTarget(), reality.name)
    }

    func testStrictRuntimeImmutableErrorRequiresUserAction() {
        let err = HelperIPCError.commandFailed(
            "Strict runtime is immutable. Explicitly disconnect before changing it.",
            code: nil
        )
        XCTAssertTrue(AppState.isStrictRuntimeImmutableError(err))
        XCTAssertTrue(AppState.failureRequiresUserAction(err))
    }
}
