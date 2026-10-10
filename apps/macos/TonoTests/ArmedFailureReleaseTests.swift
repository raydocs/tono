import XCTest
@testable import Tono

final class ArmedFailureReleaseTests: XCTestCase {
    func testExplicitReleaseRetiresUnarmedRetryWhileTcpProofIsPending() async {
        let app = AppState()
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        KillSwitchService.isArmed = false
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        let node = Fixture.realityNode()
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [node])]
        app.applyProxySelection(node.name)
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { KillSwitchService.isArmed = false }
        runtime.releaseAfterFailure = { KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        var admissions = 0
        app.recordConnectBootSession = {
            admissions += 1
            throw POSIXError(.ENOSPC) // Contain the old code's unintended connect.
        }
        let proofEntered = expectation(description: "unarmed TCP proof entered")
        var proofReply: CheckedContinuation<Bool, Never>?
        app.unarmedTcpProof = { _ in
            await withCheckedContinuation { reply in
                proofReply = reply
                proofEntered.fulfill()
            }
        }
        app.scheduleUnarmedReconnect(sleep: { _ in })
        let retry = app.connectionCoordinator.unarmedReconnectTask
        defer {
            retry?.cancel()
            app.connectionCoordinator.cancelConnectionTasks()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
        }
        await fulfillment(of: [proofEntered], timeout: 5)
        guard let proofReply else { return }

        await app.disconnectAndWait(releaseKillSwitch: true)
        let wasCancelled = retry?.isCancelled
        let ownerWasRetired = app.connectionCoordinator.unarmedReconnectTask == nil
        proofReply.resume(returning: true)
        await retry?.value

        XCTAssertEqual(wasCancelled, true)
        XCTAssertTrue(ownerWasRetired)
        XCTAssertEqual(admissions, 0, "a late successful proof cannot undo Restore internet")
        XCTAssertFalse(app.isConnected)
        XCTAssertFalse(app.isProtectionBlocked)
    }

    func testNewerExplicitReleasePreventsRetryFromStaleFailureStatus() async {
        let app = AppState()
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        KillSwitchService.isArmed = true
        app.isConnecting = true
        let statusEntered = expectation(description: "failure status read entered")
        var statusReply: CheckedContinuation<KillSwitchService.StatusObservation, Never>?
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { KillSwitchService.isArmed = false }
        runtime.releaseAfterFailure = { KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = {
            await withCheckedContinuation { reply in
                statusReply = reply
                statusEntered.fulfill()
            }
        }
        app.networkProtection = runtime
        AppProfile.defaults.removeObject(forKey: TelemetryOutbox.key)
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            app.connectionCoordinator.cancelConnectionTasks()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            AppProfile.defaults.removeObject(forKey: TelemetryOutbox.key)
        }
        let failure = Task {
            await app.applyExhaustedArmedFailure(message: "TCP failed", resumeWhenReachable: true)
        }
        await fulfillment(of: [statusEntered], timeout: 5)
        guard let statusReply else { failure.cancel(); return }

        await app.disconnectAndWait(releaseKillSwitch: true)
        statusReply.resume(returning: .confirmed(requiresProtectionRecovery: false))
        await failure.value

        XCTAssertNil(app.connectionCoordinator.unarmedReconnectTask)
        XCTAssertFalse(app.isProtectionBlocked)
    }

    func testExhaustedArmedFailureReleasesGeneralTrafficAndKeepsAIHold() async throws {
        let app = AppState()
        let originalArmed = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        defer { KillSwitchService.isArmed = originalArmed }
        app.isConnecting = true
        var disarmed = 0
        var releasedAfterFailure = 0
        var aiHold = false
        var restricted = 0
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {
            disarmed += 1
            aiHold = false
            KillSwitchService.isArmed = false
        }
        runtime.releaseAfterFailure = {
            releasedAfterFailure += 1
            aiHold = true
            KillSwitchService.isArmed = false
        }
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        runtime.restrictToBootstrap = { restricted += 1 }
        app.networkProtection = runtime
        app.unarmedTcpProof = { _ in false }
        AppProfile.defaults.removeObject(forKey: TelemetryOutbox.key)
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            AppProfile.defaults.removeObject(forKey: TelemetryOutbox.key)
        }

        await app.applyExhaustedArmedFailure(message: "tcp connect failed", resumeWhenReachable: true)
        await app.finishPendingDisconnect()

        XCTAssertEqual(releasedAfterFailure, 1, "automatic recovery retains the AI hold")
        XCTAssertEqual(disarmed, 0, "failure must not use explicit Disconnect")
        XCTAssertTrue(aiHold)
        XCTAssertEqual(restricted, 0, "the failure does not keep a bootstrap block")
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
        XCTAssertFalse(KillSwitchService.isArmed)
        let queued = TelemetryOutbox.pending()
        XCTAssertEqual(queued.count, 1)
        XCTAssertEqual(queued.first?["kind"], "p0")
        let body = try XCTUnwrap(queued.first?["body"].flatMap { Data(base64Encoded: $0) })
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let event = try XCTUnwrap((json["events"] as? [[String: Any]])?.first)
        XCTAssertEqual(event["code"] as? String, NetworkLossReport.failOpen)
    }

    func testUnarmedReconnectWaitsForAProofWhileProtectionIsDown() {
        XCTAssertFalse(UnarmedReconnect.shouldConnect(tcpReachable: false, protectionArmed: false))
        XCTAssertFalse(UnarmedReconnect.shouldConnect(tcpReachable: true, protectionArmed: true))
        XCTAssertTrue(UnarmedReconnect.shouldConnect(tcpReachable: true, protectionArmed: false))
        XCTAssertEqual(UnarmedReconnect.delaySeconds(attempt: 0), 2)
        XCTAssertEqual(UnarmedReconnect.delaySeconds(attempt: 99), 120)
    }

    func testRememberedHy2DoesNotHideReachableTcpCandidates() {
        let preferred = "Los Angeles · Canyon"
        let app = AppState()
        app.proxyRegions = [ProxyRegion(
            id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [
                Fixture.realityNode(name: preferred),
                Fixture.hy2Node(name: preferred + ExitHeal.hy2Suffix),
                Fixture.realityNode(name: "Seattle · Rain", id: "backup"),
            ]
        )]
        let names = UnarmedReconnect.tcpCandidateNames(
            preferred: preferred, remembered: preferred + ExitHeal.hy2Suffix,
            candidates: app.exitHealCandidates()
        )
        XCTAssertEqual(names, [preferred, "Seattle · Rain"],
            "a UDP-only remembered candidate must not suppress the preferred TCP node or its fallback")
    }

    func testUnarmedReconnectDialsTheTcpCandidateItProved() async {
        let app = AppState()
        let preferred = Fixture.realityNode(name: "Los Angeles · Canyon")
        let backup = Fixture.realityNode(name: "Seattle · Rain", id: "backup", server: "203.0.114.8")
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [preferred, backup])]
        app.applyProxySelection(preferred.name)
        app.unarmedDialName = backup.name
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        let savedSelection = AppProfile.defaults.string(forKey: SettingsKey.selectedProxyTargetName)
        KillSwitchService.isArmed = false
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        var admittedName: String?
        app.recordConnectBootSession = {
            admittedName = app.selectedExitNode()?.name
            throw POSIXError(.ENOSPC) // Contain admission before any privileged runtime work.
        }
        app.unarmedTcpProof = { name in name == backup.name }
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            app.connectionCoordinator.cancelConnectionTasks()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            AppProfile.defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
        }
        app.scheduleUnarmedReconnect(sleep: { _ in })
        await app.connectionCoordinator.unarmedReconnectTask?.value
        XCTAssertEqual(admittedName, backup.name, "a proof of the backup cannot authorize another dial of the failed preferred node")
        XCTAssertEqual(AppProfile.defaults.string(forKey: SettingsKey.selectedProxyTargetName), backup.name)
    }

    /// Simulated UDP fully unavailable: the user's own choice is a node's
    /// hy2 block, hy2 is dead, and the armed failure released protection.
    /// The unarmed loop never proves or dials the hy2 block (a TCP proof
    /// says nothing about UDP); it proves the same node's Reality TCP block
    /// first and dials that. No other transport, no other node first.
    func testADeadHy2SelectionReconnectsOnTheSameNodesRealityBlock() async {
        let app = AppState()
        let reality = Fixture.realityNode(name: "Los Angeles · Canyon")
        let hy2 = Fixture.hy2Node(name: reality.name + ExitHeal.hy2Suffix, id: "canyon-hy2")
        let sibling = Fixture.realityNode(name: "Los Angeles · Mesa", id: "mesa", server: "203.0.114.9")
        app.proxyRegions = [ProxyRegion(
            id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [reality, hy2, sibling]
        )]
        app.applyProxySelection(hy2.name)
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        let savedSelection = AppProfile.defaults.string(forKey: SettingsKey.selectedProxyTargetName)
        KillSwitchService.isArmed = false
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        let proved = ProvedNames()
        app.unarmedTcpProof = { name in
            proved.names.append(name)
            return true
        }
        var admittedName: String?
        app.recordConnectBootSession = {
            admittedName = app.selectedExitNode()?.name
            throw POSIXError(.ENOSPC) // Contain admission before any privileged runtime work.
        }
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            app.connectionCoordinator.cancelConnectionTasks()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            AppProfile.defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
        }

        app.scheduleUnarmedReconnect(sleep: { _ in })
        await app.connectionCoordinator.unarmedReconnectTask?.value

        XCTAssertEqual(proved.names.first, reality.name, "the same node's Reality block is proved first")
        XCTAssertFalse(proved.names.contains(hy2.name), "a TCP proof is never asked of the hy2 block")
        XCTAssertEqual(admittedName, reality.name, "the reconnect dials the node's Reality TCP block")
    }

    func testUnarmedReconnectWaitsForSlowReleaseCompletion() async {
        let app = AppState()
        let node = Fixture.realityNode()
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [node])]
        app.applyProxySelection(node.name)
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        KillSwitchService.isArmed = false
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        app.isDisconnecting = true
        let releaseEntered = expectation(description: "release entered")
        app.connectionCoordinator.enqueueDisconnect { _ in
            releaseEntered.fulfill()
            try? await Task.sleep(for: .seconds(3))
            app.isDisconnecting = false
        }
        await fulfillment(of: [releaseEntered], timeout: 5)
        var proved = false
        let proofEntered = expectation(description: "proof after completed release")
        app.unarmedTcpProof = { _ in
            proved = true
            proofEntered.fulfill()
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            return false
        }
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
        }
        app.scheduleUnarmedReconnect(sleep: { _ in })
        let retry = app.connectionCoordinator.unarmedReconnectTask
        // The injected clock reaches the first probe while the three-second teardown is live.
        // The old owner returned permanently; the fixed owner waits for the queue first.
        await app.finishPendingDisconnect()
        await fulfillment(of: [proofEntered], timeout: 5)
        await retry?.value
        XCTAssertTrue(proved, "a slow successful release must retain its automatic recovery owner")
    }

    func testFailedAutomaticAdmissionKeepsTheNextUnarmedBackoff() async {
        let app = AppState()
        let node = Fixture.realityNode()
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [node])]
        app.applyProxySelection(node.name)
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        let savedSelection = AppProfile.defaults.string(forKey: SettingsKey.selectedProxyTargetName)
        KillSwitchService.isArmed = false
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        app.recordConnectBootSession = { throw POSIXError(.ENOSPC) }
        app.unarmedTcpProof = { _ in true }
        var delays: [TimeInterval] = []
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            app.connectionCoordinator.cancelConnectionTasks()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            AppProfile.defaults.set(savedSelection, forKey: SettingsKey.selectedProxyTargetName)
        }
        app.scheduleUnarmedReconnect(sleep: { delays.append($0) })
        await app.connectionCoordinator.unarmedReconnectTask?.value
        app.scheduleUnarmedReconnect(sleep: { delays.append($0) })
        await app.connectionCoordinator.unarmedReconnectTask?.value
        XCTAssertEqual(delays, [2, 5], "a failed automatic dial must not reset recovery to the first two-second rung")
    }

    @MainActor
    func testPendingUpdateAutomaticFailurePreservesAIHold() async {
        let armed = KillSwitchService.isArmed
        let pending = RuntimeCleanup.nativeUpdatePending
        let blocked = RuntimeCleanup.nativeUpdateBlocksConnect
        let didStart = AppProfile.defaults.object(forKey: SettingsKey.didStartCore)
        let lastTun = AppProfile.defaults.object(forKey: SettingsKey.lastTunEnabled)
        let app = AppState()
        defer {
            app.connectionCoordinator.cancelConnectionTasks()
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdatePending = pending
            RuntimeCleanup.nativeUpdateBlocksConnect = blocked
            AppProfile.defaults.set(didStart, forKey: SettingsKey.didStartCore)
            AppProfile.defaults.set(lastTun, forKey: SettingsKey.lastTunEnabled)
        }
        KillSwitchService.isArmed = true
        RuntimeCleanup.nativeUpdatePending = true
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        app.isConnecting = true
        XCTAssertFalse(app.nativeUpdatePending, "the successor's pending receipt is launch-owned")
        var explicitReleases = 0
        var automaticReleases = 0
        var aiHold = false
        app.nativeUpdateDisconnect = {
            explicitReleases += 1
            aiHold = false
            return .init(pending: true, receipt: nil, execution: nil,
                         disconnectVerified: true, diagnostic: nil)
        }
        app.nativeUpdateReleaseAfterFailure = {
            automaticReleases += 1
            aiHold = true
            return .init(pending: true, receipt: nil, execution: nil,
                         disconnectVerified: true, diagnostic: nil)
        }
        var runtime = NetworkProtectionOperations()
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime

        await app.applyExhaustedArmedFailure(message: "successor Core failed", resumeWhenReachable: false)
        await app.nativeUpdateDisconnectTask?.value

        XCTAssertEqual(automaticReleases, 1)
        XCTAssertEqual(explicitReleases, 0)
        XCTAssertTrue(aiHold)
        XCTAssertFalse(KillSwitchService.isArmed)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.nativeUpdatePending, "release retains update evidence")
        XCTAssertTrue(RuntimeCleanup.nativeUpdateBlocksConnect)
    }

}

/// The names a test TCP proof was asked about, in order.
@MainActor
private final class ProvedNames {
    var names: [String] = []
}
