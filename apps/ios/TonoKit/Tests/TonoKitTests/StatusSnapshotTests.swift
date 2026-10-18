import XCTest
@testable import TonoKit

final class StatusSnapshotTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    func testNoSnapshotIsUnavailableNotOff() {
        XCTAssertEqual(StatusReading.read(nil, now: t0), .unavailable)
        XCTAssertFalse(StatusReading.unavailable.switchOn)
    }

    func testSnapshotTurnsStaleAfterFifteenMinutesAndStaleNeverReadsOn() {
        let s = StatusSnapshot(state: .on, exit: "Tokyo · Dawn", since: t0, updatedAt: t0, writer: .tunnel)
        XCTAssertEqual(StatusReading.read(s, now: t0.addingTimeInterval(14 * 60)), .fresh(s))
        let late = StatusReading.read(s, now: t0.addingTimeInterval(16 * 60))
        XCTAssertEqual(late, .stale(s))
        XCTAssertFalse(late.switchOn)
        XCTAssertEqual(StatusReading.staleAt(s), t0.addingTimeInterval(15 * 60))
    }

    func testSnapshotFromTheFutureIsNotFresh() {
        let s = StatusSnapshot(state: .on, since: t0, updatedAt: t0.addingTimeInterval(600), writer: .app)
        XCTAssertEqual(StatusReading.read(s, now: t0), .stale(s))
    }

    func testTunnelHeartbeatKeepsTheAppsDegradedStateForTheSameSession() {
        let app = StatusSnapshot.fromApp(.degraded, reason: "HOME_UNREACHABLE", exit: "Tokyo · Dawn", since: t0, now: t0)
        // The tunnel's own start time trails iOS's connectedDate by the start duration.
        let beat = StatusSnapshot.fromTunnel(running: true, since: t0.addingTimeInterval(-3), failure: nil, previous: app, now: t0.addingTimeInterval(300))
        XCTAssertEqual(beat.state, .degraded)
        XCTAssertEqual(beat.reason, "HOME_UNREACHABLE")
        XCTAssertEqual(beat.exit, "Tokyo · Dawn")
        XCTAssertEqual(beat.updatedAt, t0.addingTimeInterval(300))
        // A new session (another start time) does not inherit the old degraded state.
        let next = StatusSnapshot.fromTunnel(running: true, since: t0.addingTimeInterval(900), failure: nil, previous: app, now: t0.addingTimeInterval(901))
        XCTAssertEqual(next.state, .on)
        XCTAssertNil(next.reason)
    }

    func testTunnelStopWithAFailureIsFailedAndClearsSince() {
        let up = StatusSnapshot(state: .on, exit: "Tokyo · Dawn", since: t0, updatedAt: t0, writer: .tunnel)
        let stop = StatusSnapshot.fromTunnel(running: false, since: nil, failure: "CORE_STOPPED", previous: up, now: t0.addingTimeInterval(60))
        XCTAssertEqual(stop.state, .failed)
        XCTAssertEqual(stop.reason, "CORE_STOPPED")
        XCTAssertNil(stop.since)
    }

    func testAppDisconnectingIsOffAndPreparingIsConnecting() {
        XCTAssertEqual(StatusSnapshot.fromApp(.disconnecting, reason: nil, exit: nil, since: t0, now: t0).state, .off)
        XCTAssertEqual(StatusSnapshot.fromApp(.preparing, reason: nil, exit: nil, since: nil, now: t0).state, .connecting)
        XCTAssertNil(StatusSnapshot.fromApp(.idle, reason: nil, exit: nil, since: t0, now: t0).since)
    }

    func testRoundTripAndOtherVersionsAreUnreadable() {
        let s = StatusSnapshot(state: .degraded, exit: "Tokyo · Dawn", since: t0, reason: "HOME_UNREACHABLE", updatedAt: t0.addingTimeInterval(5), writer: .app)
        XCTAssertEqual(StatusSnapshot.decode(s.encoded()), s)
        XCTAssertNil(StatusSnapshot.decode(Data(#"{"version":2,"state":"on","updatedAt":1,"writer":"app"}"#.utf8)))
        XCTAssertNil(StatusSnapshot.decode(Data(#"{"version":1,"state":"maybe","updatedAt":1,"writer":"app"}"#.utf8)))
    }

    func testOutsideCommandsCannotStartWithoutAccountPermissionOrInputs() {
        XCTAssertEqual(TunnelCommandGate.checkStart(signedIn: false, configured: true, hasInputs: true), .signedOut)
        XCTAssertEqual(TunnelCommandGate.checkStart(signedIn: true, configured: false, hasInputs: true), .needsPermission)
        XCTAssertEqual(TunnelCommandGate.checkStart(signedIn: true, configured: true, hasInputs: false), .needsApp)
        XCTAssertNil(TunnelCommandGate.checkStart(signedIn: true, configured: true, hasInputs: true))
    }
}
