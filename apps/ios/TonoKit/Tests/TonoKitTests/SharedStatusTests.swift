import XCTest
@testable import TonoKit

/// The one reading widgets, the Control Center switch and the Live Activity state, resolved from the
/// tunnel's report and the app's note. Only a fresh running report makes a connection claim; the
/// app's note can say less or decorate the same graph, never revive or renew one. Fixed clock.
final class SharedStatusTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let tokyo = RouteSettings(mode: .threeTier, node: "tokyo-1")

    private func report(_ session: String = "s1", opened: Date? = nil, generation: Int = 1, running: Bool = true,
                        routing: RouteSettings?? = nil, failure: String? = nil, at: Date) -> TunnelReport {
        TunnelReport(session: session, opened: opened ?? t0, generation: generation, running: running,
                     routing: running ? (routing ?? tokyo) : nil, since: t0, failure: failure, beatAt: at, catalog: "catalog-a")
    }

    private func note(_ state: AppNote.State, reason: String? = nil, session: String? = nil, generation: Int? = nil,
                      node: String? = nil, exit: String? = nil, at: Date) -> AppNote {
        AppNote(state: state, reason: reason, session: session, generation: generation, node: node, exit: exit, writtenAt: at, catalog: "catalog-a")
    }

    func testAnAppNoteAloneNeverReadsConnected() {
        for state in [AppNote.State.up, .degraded] {
            let shared = SharedStatus(app: note(state, reason: "HOME_UNREACHABLE", session: "s1", generation: 1, at: t0))
            XCTAssertEqual(shared.reading(now: t0), .unavailable, "\(state)")
        }
    }

    func testAnAppConnectedNoteCannotReviveAStoppedTunnel() throws {
        let stopped = SharedStatus(tunnel: report(running: false, at: t0))
        let written = try XCTUnwrap(stopped.writingApp(note(.up, session: "s1", generation: 1, node: "tokyo-1", exit: "Tokyo",
                                                            at: t0.addingTimeInterval(5))))
        let reading = written.reading(now: t0.addingTimeInterval(6))
        XCTAssertEqual(reading.snapshot?.state, .off)
        XCTAssertFalse(reading.switchOn)
    }

    /// The tunnel was killed without its stop write: the app keeps writing, the claim still ends
    /// `freshFor` after the tunnel's own last word.
    func testAppWritesDoNotRenewACrashedTunnelsReport() throws {
        var shared = SharedStatus(tunnel: report(at: t0))
        for minutes in [10.0, 14.0] {
            shared = try XCTUnwrap(shared.writingApp(note(.up, session: "s1", generation: 1, at: t0.addingTimeInterval(minutes * 60))))
        }
        XCTAssertEqual(shared.tunnel?.beatAt, t0)
        let reading = shared.reading(now: t0.addingTimeInterval(16 * 60))
        guard case .stale = reading else { return XCTFail("still current: \(reading)") }
        XCTAssertFalse(reading.switchOn)
    }

    func testDegradedFromAnEarlierSessionIsNotCarriedIntoAReconnect() {
        let shared = SharedStatus(tunnel: report("s2", opened: t0.addingTimeInterval(50), at: t0.addingTimeInterval(60)),
                                  app: note(.degraded, reason: "HOME_UNREACHABLE", session: "s1", generation: 1, at: t0.addingTimeInterval(30)))
        let s = shared.reading(now: t0.addingTimeInterval(61)).snapshot
        XCTAssertEqual(s?.state, .on)
        XCTAssertNil(s?.reason)
    }

    func testDegradedForTheSameGraphOutlivesLaterBeats() {
        let shared = SharedStatus(tunnel: report(at: t0.addingTimeInterval(300)),
                                  app: note(.degraded, reason: "HOME_UNREACHABLE", session: "s1", generation: 1, at: t0))
        let s = shared.reading(now: t0.addingTimeInterval(301)).snapshot
        XCTAssertEqual(s?.state, .degraded)
        XCTAssertEqual(s?.reason, "HOME_UNREACHABLE")
        XCTAssertEqual(s?.updatedAt, t0.addingTimeInterval(300))
    }

    /// The app learnt ROUTES_STOPPED about graph 2; the tunnel has since brought a graph back
    /// (graph 3). The app's later write from the old knowledge does not hide it.
    func testRoutesStoppedLearntAboutAnOlderGraphDoesNotHideARestoredOne() {
        let shared = SharedStatus(tunnel: report(generation: 3, at: t0.addingTimeInterval(300)),
                                  app: note(.failed, reason: "ROUTES_STOPPED", session: "s1", generation: 2, at: t0.addingTimeInterval(301)))
        XCTAssertEqual(shared.reading(now: t0.addingTimeInterval(302)).snapshot?.state, .on)
    }

    /// Negative news travels before the tunnel's file catches up: the app heard graph 4 has none.
    func testRoutesStoppedLearntAboutANewerGraphShowsAtOnce() {
        let shared = SharedStatus(tunnel: report(generation: 3, at: t0.addingTimeInterval(20)),
                                  app: note(.failed, reason: "ROUTES_STOPPED", session: "s1", generation: 4, at: t0.addingTimeInterval(10)))
        let reading = shared.reading(now: t0.addingTimeInterval(21))
        XCTAssertEqual(StatusWording(reading), StatusWording(titleKey: "state_routes_stopped", switchOn: false, action: .retry))
    }

    func testTheAppSeeingTheTunnelStopOverridesItsLastBeat() {
        let shared = SharedStatus(tunnel: report(at: t0), app: note(.failed, reason: "CORE_STOPPED", at: t0.addingTimeInterval(10)))
        let s = shared.reading(now: t0.addingTimeInterval(11)).snapshot
        XCTAssertEqual(s?.state, .failed)
        XCTAssertEqual(s?.reason, "CORE_STOPPED")
        XCTAssertNil(s?.since)
    }

    func testAnUnconfirmedNoteReadsNotConfirmedWithNoSwitchClaim() {
        let shared = SharedStatus(tunnel: report(at: t0), app: note(.connecting, reason: "UNCONFIRMED", at: t0.addingTimeInterval(10)))
        XCTAssertEqual(StatusWording(shared.reading(now: t0.addingTimeInterval(11))),
                       StatusWording(titleKey: "state_unconfirmed", switchOn: false, action: .openApp))
    }

    /// The tunnel owns the routing fact: the next beat of the start the app heard from confirms what
    /// the app's unanswered question could not (the app takes the same beat: `observed`).
    func testTheTunnelsNextBeatOutranksAnEarlierUnconfirmedNote() {
        let shared = SharedStatus(tunnel: report(at: t0.addingTimeInterval(5)),
                                  app: note(.connecting, reason: "UNCONFIRMED", session: "s1", generation: 1, at: t0))
        XCTAssertEqual(shared.reading(now: t0.addingTimeInterval(6)).snapshot?.state, .on)
    }

    func testTheExitIsNamedOnlyForTheNodeTheTunnelRuns() {
        let named = note(.up, session: "s1", generation: 1, node: "tokyo-1", exit: "Tokyo", at: t0)
        let osaka = SharedStatus(tunnel: report(routing: RouteSettings(mode: .threeTier, node: "osaka-1"), at: t0), app: named)
        XCTAssertEqual(osaka.reading(now: t0).snapshot?.state, .on)
        XCTAssertNil(osaka.reading(now: t0).snapshot?.exit)
        XCTAssertEqual(SharedStatus(tunnel: report(at: t0), app: named).reading(now: t0).snapshot?.exit, "Tokyo")
    }

    func testAStoppingProcessCannotOverwriteANewerStart() {
        let newer = SharedStatus(tunnel: report("s2", opened: t0.addingTimeInterval(100), at: t0.addingTimeInterval(105)))
        XCTAssertNil(newer.writingTunnel(report("s1", opened: t0, running: false, failure: "CORE_STOPPED", at: t0.addingTimeInterval(110))))
    }

    func testAnOlderGraphOfTheSameStartIsNotWritten() {
        let shared = SharedStatus(tunnel: report(generation: 3, at: t0))
        XCTAssertNil(shared.writingTunnel(report(generation: 2, at: t0.addingTimeInterval(1))))
    }

    func testAnUnchangedReportIsRewrittenOnlyOnceAMinuteOld() {
        let shared = SharedStatus(tunnel: report(at: t0))
        XCTAssertNil(shared.writingTunnel(report(at: t0.addingTimeInterval(30))))
        XCTAssertEqual(shared.writingTunnel(report(at: t0.addingTimeInterval(61)))?.tunnel?.beatAt, t0.addingTimeInterval(61))
    }

    func testATunnelStopWithAFailureIsFailedWithoutATimer() {
        let s = SharedStatus(tunnel: report(running: false, failure: "CORE_STOPPED", at: t0)).reading(now: t0).snapshot
        XCTAssertEqual(s?.state, .failed)
        XCTAssertEqual(s?.reason, "CORE_STOPPED")
        XCTAssertNil(s?.since)
    }

    func testAppPhasesMapToNotesThatMakeNoClaimOfTheirOwn() {
        XCTAssertEqual(AppNote.State(.disconnecting), .off)
        XCTAssertEqual(AppNote.State(.preparing), .connecting)
        let up = AppNote(.connected, reason: "x", answer: nil, line: nil, now: t0)
        XCTAssertEqual(up.state, .up)
        XCTAssertNil(up.reason)
        XCTAssertNil(up.session)
    }

    func testRoundTripAndOtherVersionsAreUnreadable() {
        let shared = SharedStatus(tunnel: report(generation: 4, at: t0),
                                  app: note(.degraded, reason: "HOME_UNREACHABLE", session: "s1", generation: 4, node: "tokyo-1",
                                            exit: "Tokyo · Dawn", at: t0.addingTimeInterval(5)))
        XCTAssertEqual(SharedStatus.decode(shared.encoded()), shared)
        // The version-1 snapshot a previous build wrote reads as unavailable, not as its state.
        XCTAssertNil(SharedStatus.decode(Data(#"{"version":1,"state":"on","updatedAt":1,"writer":"tunnel"}"#.utf8)))
        XCTAssertNil(SharedStatus.decode(Data(#"{"version":2,"app":{"state":"maybe","writtenAt":1}}"#.utf8)))
    }
    func testAnUnconfirmedReadingNeverHasAnOnSwitch() {
        let shared = SharedStatus(tunnel: report(at: t0), app: note(.connecting, reason: "UNCONFIRMED", at: t0.addingTimeInterval(10)))
        let reading = shared.reading(now: t0.addingTimeInterval(11))
        XCTAssertFalse(reading.switchOn)
        XCTAssertEqual(reading.switchOn, StatusWording(reading).switchOn)
    }

    func testALateBeatCannotMoveTheSameGraphConfirmationBackwards() {
        let shared = SharedStatus(tunnel: report(at: t0.addingTimeInterval(100)))
        XCTAssertNil(shared.writingTunnel(report(at: t0.addingTimeInterval(10))))
    }


    /// The tunnel beats every 5 min and widgets turn "last known" 15 min after the newest beat they
    /// read: a beat that only moves `beatAt` reloads every second beat, never later than that.
    func testBeatOnlyWritesReloadWidgetsEverySecondBeatAndChangesAtOnce() {
        let first = report(at: t0)
        XCTAssertTrue(SharedStatus.tunnelWriteNeedsReload(old: first, new: first, lastReloadedBeat: nil))
        let beat5 = report(at: t0.addingTimeInterval(300))
        XCTAssertFalse(SharedStatus.tunnelWriteNeedsReload(old: first, new: beat5, lastReloadedBeat: t0))
        let beat10 = report(at: t0.addingTimeInterval(600))
        XCTAssertTrue(SharedStatus.tunnelWriteNeedsReload(old: beat5, new: beat10, lastReloadedBeat: t0))
        let rebuilt = report(generation: 2, at: t0.addingTimeInterval(310))
        XCTAssertTrue(SharedStatus.tunnelWriteNeedsReload(old: beat5, new: rebuilt, lastReloadedBeat: t0.addingTimeInterval(300)))
    }
}
