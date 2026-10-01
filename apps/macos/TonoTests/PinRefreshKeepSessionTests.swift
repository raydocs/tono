import XCTest
@testable import Tono

/// MAC-PIN-REFRESH-TEARDOWN: a pins-only refresh that fails before Mihomo
/// accepts the new pins used to take the owned-runtime teardown
/// (`disconnect(releaseKillSwitch: false)`), holding PF in bootstrap.
/// The old config is still in force. That path is a background pin update,
/// not an explicit strict kill switch.
final class PinRefreshKeepSessionTests: XCTestCase {

    func testFullReloadFailureRestoresInternetWithAIHoldBeforeRetry() async throws {
        let app = AppState()
        let node = Fixture.realityNode(name: "Los Angeles · Canyon")
        app.proxyRegions = [ProxyRegion(id: "custom", name: "Custom", nodes: [node])]
        app.selectedNodeId = node.id
        app.activeNode = node
        app.proxyService.activeNodeName = node.name
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.coreController = CoreControllerClient(port: 9)
        app.config.tunEnabled = true
        app.isConnected = true

        let configFile = app.coreRuntime.configFilePath
        let savedConfig = try? Data(contentsOf: configFile)
        let savedIPC = KillSwitchService.armIPC
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        KillSwitchService.isArmed = true
        KillSwitchService.armIPC.prepare = { _ in }
        KillSwitchService.armIPC.deliver = { _ in (true, true, true, false, false, 0) }
        defer {
            app.connectionCoordinator.cancelReconnectTasks()
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            if let savedConfig { try? savedConfig.write(to: configFile) }
            else { try? FileManager.default.removeItem(at: configFile) }
        }

        var restoredDNS = 0
        var explicitDisarms = 0
        var bootstrapRestrictions = 0
        var aiHold = false
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { restoredDNS += 1; return true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { explicitDisarms += 1; aiHold = false }
        runtime.releaseAfterFailure = { aiHold = true; KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = { bootstrapRestrictions += 1 }
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime
        app.unarmedTcpProof = { _ in false }
        var replacements = 0
        var operations = AppState.ConfigReloadOperations()
        operations.sync = { _, _ in
            replacements += 1
            throw CoreControllerError.protectionFailed("replacement failed")
        }

        app.reloadCoreConfig(operations: operations)
        await app.connectionCoordinator.configReloadTask?.value
        await app.finishPendingDisconnect()

        XCTAssertEqual(replacements, 1, "exercise failure after the runtime write and initial PF arm")
        XCTAssertEqual(restoredDNS, 1, "restore the resolver before retrying the failed replacement")
        XCTAssertTrue(aiHold, "automatic failure must retain AI-service blocking")
        XCTAssertEqual(explicitDisarms, 0)
        XCTAssertEqual(bootstrapRestrictions, 0, "ordinary internet must remain available during backoff")
        XCTAssertFalse(app.isConnected)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(KillSwitchService.isArmed)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertNotNil(app.connectionCoordinator.unarmedReconnectTask)
    }

    func testPinsCommittedByHelperRestoreDirectPermitsDespiteControllerReadinessFailure() async throws {
        let app = AppState()
        let node = Fixture.realityNode(name: "Los Angeles · Canyon")
        app.proxyRegions = [ProxyRegion(id: "custom", name: "Custom", nodes: [node])]
        app.selectedNodeId = node.id
        app.activeNode = node
        app.proxyService.activeNodeName = node.name
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.coreController = CoreControllerClient(port: 9)
        app.config.tunEnabled = true
        app.isConnected = true
        let live = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0", domainPins: [], mediaEndpoints: []
        )
        let pending = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en1", domainPins: [], mediaEndpoints: []
        )
        app.activeDirectPolicy = live

        let configFile = app.coreRuntime.configFilePath
        let savedConfig = try? Data(contentsOf: configFile)
        let savedIPC = KillSwitchService.armIPC
        let savedArmed = KillSwitchService.isArmed
        var armCount = 0
        KillSwitchService.armIPC.prepare = { _ in }
        KillSwitchService.armIPC.deliver = { _ in
            armCount += 1
            return (true, true, true, false, false, 0)
        }
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = savedArmed
            if let savedConfig { try? savedConfig.write(to: configFile) }
            else { try? FileManager.default.removeItem(at: configFile) }
        }

        var operations = AppState.ConfigReloadOperations()
        var replacementCount = 0
        operations.sync = { _, _ in
            replacementCount += 1
            return "/var/run/tono-core/runtime/config.json"
        }
        operations.reload = { _, _ in
            throw CoreControllerError.requestFailed("Owned core status temporarily unavailable")
        }
        operations.waitForTunnel = { true }
        var advisoryReadinessCount = 0
        operations.waitUntilReady = { _ in
            advisoryReadinessCount += 1
            throw CoreControllerError.requestFailed("Controller temporarily unavailable")
        }

        app.reloadCoreConfig(applyingDirectPolicy: pending, operations: operations)
        await app.connectionCoordinator.configReloadTask?.value

        XCTAssertEqual(replacementCount, 1)
        XCTAssertEqual(armCount, 2, "restore the DIRECT permit withheld by /core/sync")
        XCTAssertEqual(app.activeDirectPolicy, pending, "sync already installed these pins")
        XCTAssertEqual(advisoryReadinessCount, 1)
        XCTAssertTrue(app.isConnected)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
        XCTAssertNil(app.connectionCoordinator.configReloadTask)
    }

    func testPinsOnlyRefreshFailureBeforeCommitKeepsTheSession() async {
        let app = AppState()
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        XCTAssertTrue(app.isOwnedTonoMode)
        app.isConnected = true
        let live = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [],
            mediaEndpoints: []
        )
        let pending = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en1",
            domainPins: [],
            mediaEndpoints: []
        )
        app.activeDirectPolicy = live
        KillSwitchService.isArmed = true

        let savedIPC = KillSwitchService.armIPC
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = false
            app.connectionCoordinator.cancelReconnectTasks()
        }

        KillSwitchService.armIPC.prepare = { _ in
            throw HelperIPCError.connectFailed
        }
        KillSwitchService.armIPC.deliver = { _ in
            XCTFail("pin refresh must not deliver an arm after helper preparation fails")
            throw HelperIPCError.connectFailed
        }

        app.reloadCoreConfig(applyingDirectPolicy: pending)
        let mutation = app.connectionCoordinator.configReloadTask
        XCTAssertNotNil(mutation)
        await mutation?.value
        if let teardown = app.connectionCoordinator.disconnectSequence {
            await teardown.value
        }
        let loop = app.connectionCoordinator.protectedReconnectTask
        app.connectionCoordinator.cancelReconnectTasks()
        await loop?.value

        XCTAssertTrue(app.isConnected)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
        XCTAssertEqual(app.activeDirectPolicy, live)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
        XCTAssertNil(app.connectionCoordinator.configReloadTask)
        XCTAssertNil(app.errorMessage)
    }
}
