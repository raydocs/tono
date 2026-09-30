import XCTest
@testable import Tono

final class ArmedFailureReleaseTests: XCTestCase {
    func testExhaustedArmedFailureRemovesPfAndDoesNotScheduleProtectedReconnect() async {
        let app = AppState()
        KillSwitchService.isArmed = true
        app.isConnecting = true
        var disarmed = 0
        var restricted = 0
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {
            disarmed += 1
            KillSwitchService.isArmed = false
        }
        runtime.restrictToBootstrap = { restricted += 1 }
        app.networkProtection = runtime
        app.unarmedTcpProof = { _ in false }
        defer { app.connectionCoordinator.unarmedReconnectTask?.cancel() }

        app.applyExhaustedArmedFailure(message: "tcp connect failed", resumeWhenReachable: true)
        await app.finishPendingDisconnect()

        XCTAssertEqual(disarmed, 1, "PF disarm runs")
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
