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

    func testOutsideCommandsCannotStartWithoutAccountPermissionOrInputs() {
        XCTAssertEqual(TunnelCommandGate.checkStart(signedIn: false, configured: true, hasInputs: true), .signedOut)
        XCTAssertEqual(TunnelCommandGate.checkStart(signedIn: true, configured: false, hasInputs: true), .needsPermission)
        XCTAssertEqual(TunnelCommandGate.checkStart(signedIn: true, configured: true, hasInputs: false), .needsApp)
        XCTAssertNil(TunnelCommandGate.checkStart(signedIn: true, configured: true, hasInputs: true))
    }
}
