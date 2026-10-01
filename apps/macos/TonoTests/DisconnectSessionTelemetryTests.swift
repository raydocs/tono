import XCTest
@testable import Tono

/// #1174: a successful Connect clears its attempt timer, so teardown needs a
/// separate session start to report `disconnectOk`, and only once.
@MainActor
final class DisconnectSessionTelemetryTests: XCTestCase {
    func testConnectedSessionReportsOneDisconnectEvent() async {
        let armed = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = armed }
        KillSwitchService.isArmed = false
        _ = ConnectionTelemetryBuffer.shared.drain()
        let app = AppState()
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { core in
            core.isRunning = false
            return true
        }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime
        // The state a successful Connect commits.
        app.isConnected = true
        app.connectionStartedAt = nil
        app.connectedSessionStartedAt = Date().addingTimeInterval(-5)

        app.disconnect(releaseKillSwitch: true)
        app.isConnected = true // a duplicate Restore that still sees the session
        app.disconnect(releaseKillSwitch: true)
        await app.finishPendingDisconnect()

        let events = ConnectionTelemetryBuffer.shared.snapshot().events.filter { $0.kind == "disconnectOk" }
        XCTAssertEqual(events.count, 1)
        XCTAssertGreaterThanOrEqual(events.first?.elapsedMs ?? 0, 5_000)
    }
}
