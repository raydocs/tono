import XCTest
@testable import Tono

@MainActor
final class QuitAIHoldTests: XCTestCase {
    private enum Failure: Error { case dns }

    private func runtime() -> NetworkProtectionOperations {
        var result = NetworkProtectionOperations()
        result.repairForRelease = {}
        result.pendingNativeUpdate = { false }
        result.stopCore = { _ in true }
        result.coreStatus = { (false, true) }
        result.restoreDNS = { true }
        result.disableSystemProxy = {}
        result.restrictToBootstrap = {}
        result.selectiveAIRecoveryPending = { false }
        return result
    }

    func testRestoreDuringQuitDNSWaitWinsTheLiveReleaseChoice() async {
        let armed = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = armed }
        KillSwitchService.isArmed = true
        let app = AppState()
        let entered = expectation(description: "Quit reached DNS restoration")
        var resume: CheckedContinuation<Void, Never>?
        var dnsReads = 0
        var releases: [String] = []
        var io = runtime()
        io.restoreDNS = {
            dnsReads += 1
            if dnsReads == 1 {
                await withCheckedContinuation { continuation in
                    resume = continuation
                    entered.fulfill()
                }
            }
            return true
        }
        io.disarm = { releases.append("explicit"); KillSwitchService.isArmed = false }
        io.releaseForQuit = { releases.append("quit"); KillSwitchService.isArmed = false }
        io.releaseAfterFailure = { releases.append("automatic") }
        app.networkProtection = io
        app.disconnect(releaseKillSwitch: true, ordinaryQuit: true)
        await fulfillment(of: [entered], timeout: 2)
        app.restoreInternet()
        resume?.resume()
        await app.finishPendingDisconnect()
        XCTAssertEqual(releases, ["explicit", "explicit"])
        XCTAssertFalse(app.isProtectionBlocked)
        // A later Quit, including its initial preserve teardown, cannot undo
        // the already completed explicit release without a new Connect.
        app.disconnect(releaseKillSwitch: false)
        app.disconnect(releaseKillSwitch: true, ordinaryQuit: true)
        await app.finishPendingDisconnect()
        XCTAssertEqual(releases.last, "explicit")
        XCTAssertFalse(app.connectionCoordinator.disconnectQueueRequestsRelease)
    }

    func testQuitWaitsForRestoreQueuedAfterItsHelperRequestStarted() async {
        let armed = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = armed }
        KillSwitchService.isArmed = true
        let app = AppState()
        let quitEntered = expectation(description: "Quit helper release entered")
        let restoreEntered = expectation(description: "explicit helper release entered")
        var resumeQuit: CheckedContinuation<Void, Never>?
        var resumeRestore: CheckedContinuation<Void, Never>?
        var quitFinished = false
        var io = runtime()
        io.releaseForQuit = {
            await withCheckedContinuation { resumeQuit = $0; quitEntered.fulfill() }
            KillSwitchService.isArmed = false
        }
        io.disarm = {
            await withCheckedContinuation { resumeRestore = $0; restoreEntered.fulfill() }
        }
        app.networkProtection = io
        let quit = Task {
            await app.disconnectAndWait(releaseKillSwitch: true, ordinaryQuit: true)
            quitFinished = true
        }
        await fulfillment(of: [quitEntered], timeout: 2)
        app.restoreInternet()
        resumeQuit?.resume()
        await fulfillment(of: [restoreEntered], timeout: 2)
        XCTAssertFalse(quitFinished, "Quit must drain the explicit release queued during its IPC")
        resumeRestore?.resume()
        await quit.value
        XCTAssertTrue(quitFinished)
        XCTAssertFalse(app.isDisconnecting)
    }

    func testQuitWithoutDNSProofDoesNotReleaseTheBarrier() async {
        let armed = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = armed }
        KillSwitchService.isArmed = true
        let app = AppState()
        var releases = 0
        var io = runtime()
        io.restoreDNS = { throw Failure.dns }
        io.disarm = { releases += 1 }
        io.releaseForQuit = { releases += 1 }
        io.releaseAfterFailure = { releases += 1 }
        app.networkProtection = io
        await app.disconnectAndWait(releaseKillSwitch: true, ordinaryQuit: true)
        XCTAssertEqual(releases, 0)
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertNotNil(app.errorMessage)
    }

    func testQuitClearsStaleUpdateGatesOnlyAfterAuthenticatedNoPendingStatus() async {
        let armed = KillSwitchService.isArmed
        let pending = RuntimeCleanup.nativeUpdatePending
        let blocked = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdatePending = pending
            RuntimeCleanup.nativeUpdateBlocksConnect = blocked
        }
        KillSwitchService.isArmed = true
        RuntimeCleanup.nativeUpdatePending = true
        RuntimeCleanup.nativeUpdateBlocksConnect = true
        let app = AppState()
        app.nativeUpdatePending = true
        var order: [String] = []
        var io = runtime()
        io.pendingNativeUpdate = { order.append("no pending"); return false }
        io.restoreDNS = { order.append("DNS"); return true }
        io.releaseForQuit = { order.append("Quit"); KillSwitchService.isArmed = false }
        app.networkProtection = io
        await app.disconnectForOrdinaryQuit()
        XCTAssertEqual(order, ["no pending", "DNS", "Quit"])
        XCTAssertFalse(app.nativeUpdatePending)
        XCTAssertFalse(RuntimeCleanup.nativeUpdatePending)
        XCTAssertFalse(RuntimeCleanup.nativeUpdateBlocksConnect)
        XCTAssertFalse(app.isProtectionBlocked)
    }

    func testQuitDoesNotCompeteWithAPendingUpdateOwner() async {
        let pending = RuntimeCleanup.nativeUpdatePending
        defer { RuntimeCleanup.nativeUpdatePending = pending }
        RuntimeCleanup.nativeUpdatePending = true
        let app = AppState()
        app.nativeUpdatePending = true
        var operations = 0
        var io = runtime()
        io.pendingNativeUpdate = { true }
        io.restoreDNS = { operations += 1; return true }
        io.releaseForQuit = { operations += 1 }
        app.networkProtection = io
        await app.disconnectForOrdinaryQuit()
        XCTAssertEqual(operations, 0)
        XCTAssertTrue(app.nativeUpdatePending)
        XCTAssertTrue(RuntimeCleanup.nativeUpdatePending)
    }

    func testLaunchCanObserveAndExplicitlyRemoveTheNarrowFloor() async {
        let armed = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = armed }
        KillSwitchService.isArmed = false
        let app = AppState()
        var retained = true
        var io = runtime()
        io.selectiveAIRecoveryPending = { retained }
        io.disarm = { retained = false }
        app.networkProtection = io
        await app.refreshSelectiveAIRecovery()
        XCTAssertTrue(app.selectiveAIRecoveryPending)
        XCTAssertEqual(app.gateProtectionNotice, .selectiveRecovery)
        XCTAssertFalse(app.isProtectionBlocked, "the narrow floor is not Protected Offline")
        app.restoreInternet()
        await app.finishPendingDisconnect()
        XCTAssertFalse(retained)
        XCTAssertFalse(app.selectiveAIRecoveryPending)
        XCTAssertNil(app.gateProtectionNotice)
    }

    func testHelperQuitPolicyRetainsOnlyArmedOrRetainedIntent() throws {
        let helper = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("tono-core-helper")
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: helper.path))
        let process = Process()
        process.executableURL = helper
        process.arguments = ["--quit-ai-hold-self-test"]
        let output = Pipe()
        process.standardOutput = output
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)
        XCTAssertEqual(String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8),
                       "PASS ordinary Quit selective AI disposition\n")
    }
}
