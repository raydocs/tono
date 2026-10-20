import XCTest
@testable import Tono

/// Docker's resolver on 127.0.0.1:53 made the core exit with a bare status, so
/// the card said "the protected connection failed" and Tono retried a start
/// that could never succeed. The helper now refuses the start with
/// `CORE_PORT_IN_USE` and names the program; the app shows that and stops.
final class CorePortConflictTests: XCTestCase {
    private let dockerMessage =
        "Port 53 (UDP) on 127.0.0.1 is already in use by com.docker.backend (PID 812)."

    func testTheHelperMessageIsReadBackIntoPortAndProgram() {
        XCTAssertEqual(
            CorePortConflict(helperMessage: dockerMessage),
            CorePortConflict(port: 53, transport: "UDP", program: "com.docker.backend", pid: 812)
        )
        XCTAssertEqual(
            CorePortConflict(helperMessage: "Port 28990 (TCP) on 127.0.0.1 is already in use by another program (PID 77)."),
            CorePortConflict(port: 28990, transport: "TCP", program: nil, pid: 77)
        )
        XCTAssertEqual(
            CorePortConflict(helperMessage: "Port 53 (TCP) on 127.0.0.1 is already in use by another program."),
            CorePortConflict(port: 53, transport: "TCP", program: nil, pid: nil)
        )
        XCTAssertNil(CorePortConflict(helperMessage: "sing-box exited (status 1)."))
    }

    func testTheCardNamesTheProgramAndTonoDoesNotRetry() {
        let error = HelperIPCError.commandFailed(dockerMessage, code: "CORE_PORT_IN_USE")
        let shown = error.localizedDescription
        XCTAssertNotEqual(shown, dockerMessage)
        XCTAssertTrue(shown.contains("53"), shown)
        XCTAssertTrue(shown.contains("com.docker.backend"), shown)
        XCTAssertTrue(shown.contains("812"), shown)
        XCTAssertTrue(AppState.failureRequiresUserAction(error))

        let failure = AppState.corePortConflictFailure(error, generation: 3)
        XCTAssertEqual(failure.code.rawValue, "LOCAL_PORT_IN_USE")
        XCTAssertEqual(failure.userMessage, shown)
    }

    /// Strict keeps the barrier, so the failure cannot be answered by
    /// releasing. Its reconnect loop must wait for Retry now rather than dial
    /// a start that fails the same way every time.
    @MainActor
    func testStrictModeKeepsTheBarrierAndWaitsForRetryNow() async {
        let savedArmed = KillSwitchService.isArmed
        let savedStrict = AppProfile.defaults.object(forKey: "strictRoutingSessionIntent")
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        let app = AppState()
        defer {
            app.connectionCoordinator.cancelConnectionTasks()
            app.connectionCoordinator.protectedReconnectTask?.cancel()
            KillSwitchService.isArmed = savedArmed
            AppProfile.defaults.set(savedStrict, forKey: "strictRoutingSessionIntent")
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
            AppProfile.defaults.removeObject(forKey: TelemetryOutbox.key)
        }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        AppProfile.defaults.set(true, forKey: "strictRoutingSessionIntent")
        KillSwitchService.isArmed = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = {}
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime
        let error = HelperIPCError.commandFailed(dockerMessage, code: "CORE_PORT_IN_USE")

        await app.applyExhaustedArmedFailure(
            message: error.localizedDescription,
            resumeWhenReachable: !AppState.failureRequiresUserAction(error)
        )
        await app.finishPendingDisconnect()

        XCTAssertTrue(app.protectedReconnectPausedForUserAction)
        XCTAssertFalse(app.protectedReconnectPauseLiftsOnNetworkChange)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
    }

    func testAnUncodedCoreFailureStaysRetryable() {
        let error = HelperIPCError.commandFailed("sing-box exited (status 1).", code: nil)
        XCTAssertFalse(CorePortConflict.matches(error))
        XCTAssertFalse(AppState.failureRequiresUserAction(error))
    }
}
