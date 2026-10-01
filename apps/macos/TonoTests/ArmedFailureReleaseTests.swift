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
        defer {
            app.connectionCoordinator.unarmedReconnectTask?.cancel()
            app.connectionCoordinator.cancelConnectionTasks()
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
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

    func testExhaustedArmedFailureReleasesGeneralTrafficAndKeepsAIHold() async {
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
        defer { app.connectionCoordinator.unarmedReconnectTask?.cancel() }

        await app.applyExhaustedArmedFailure(message: "tcp connect failed", resumeWhenReachable: true)
        await app.finishPendingDisconnect()

        XCTAssertEqual(releasedAfterFailure, 1, "automatic recovery retains the AI hold")
        XCTAssertEqual(disarmed, 0, "failure must not use explicit Disconnect")
        XCTAssertTrue(aiHold)
        XCTAssertEqual(restricted, 0, "the failure does not keep a bootstrap block")
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
        XCTAssertFalse(KillSwitchService.isArmed)
    }

    func testUnarmedReconnectWaitsForAProofWhileProtectionIsDown() {
        XCTAssertFalse(UnarmedReconnect.shouldConnect(tcpReachable: false, protectionArmed: false))
        XCTAssertFalse(UnarmedReconnect.shouldConnect(tcpReachable: true, protectionArmed: true))
        XCTAssertTrue(UnarmedReconnect.shouldConnect(tcpReachable: true, protectionArmed: false))
        XCTAssertEqual(UnarmedReconnect.delaySeconds(attempt: 0), 2)
        XCTAssertEqual(UnarmedReconnect.delaySeconds(attempt: 99), 120)
    }
}
