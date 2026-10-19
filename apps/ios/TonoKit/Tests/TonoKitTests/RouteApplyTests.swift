import XCTest
@testable import TonoKit

/// Fault injection for a mode or line change on a running tunnel: whatever fails, the routes the
/// screens show must be the ones the tunnel runs, and the inputs file must match them.
final class RouteApplyTests: XCTestCase {
    private let threeTier = RouteSettings(mode: .threeTier, node: "tokyo-1")
    private let stable = RouteSettings(mode: .stable, node: "tokyo-1")

    private struct WriteFailed: Error {}

    func testSaveRejectedKeepsThePreviousModeInEffectAndNeverReloads() async {
        var reloads = 0
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true,
                                           save: { _ in throw WriteFailed() },
                                           reload: { reloads += 1; return ReloadReply.applied(self.threeTier).encoded },
                                           status: { nil }).outcome
        XCTAssertEqual(outcome, .notApplied(code: "SAVE_FAILED", inEffect: threeTier))
        XCTAssertEqual(reloads, 0)
    }

    func testNoReplyAndNoStatusIsUnconfirmedNotThePreviousModeInEffect() async {
        var file: RouteSettings?
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true,
                                           save: { file = $0 }, reload: { nil }, status: { nil }).outcome
        // The rebuild may have run: claiming Three-tier would be as unfounded as claiming Stable.
        XCTAssertEqual(outcome, .unconfirmed(stable))
        XCTAssertEqual(file, stable)
    }

    func testNoReplyIsSettledByWhatTheTunnelSaysItRuns() async {
        var file: RouteSettings?
        let report = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { file = $0 }, reload: { nil },
                                          status: { Data(JSON.obj(("running", self.threeTier.json)).serialized().utf8) })
        XCTAssertEqual(report.outcome, .notApplied(code: "NO_REPLY", inEffect: threeTier))
        XCTAssertEqual(file, threeTier)
    }

    func testAFailedPutBackOfTheFileIsReportedNotSwallowed() async {
        var writes = 0
        let report = await RouteApply.run(stable, previous: threeTier, tunnelUp: true,
                                          save: { _ in writes += 1; if writes > 1 { throw WriteFailed() } },
                                          reload: { ReloadReply.refused(code: "CORE_START", running: self.threeTier).encoded },
                                          status: { nil })
        XCTAssertEqual(report.outcome, .notApplied(code: "CORE_START", inEffect: threeTier))
        XCTAssertEqual(report.unsaved, threeTier)
    }

    /// Round 11 (GPT F3): the put-back failed, its retry failed, then the next request's save
    /// failed too. The file still holds the refused routes, so the put-back is still owed.
    func testAPutBackStaysOwedWhenTheNextRequestCannotWriteTheFileEither() async {
        var file = stable
        var writable = true
        let first = await RouteApply.run(stable, previous: threeTier, tunnelUp: true,
                                         save: { if !writable { throw WriteFailed() }; file = $0; writable = false },
                                         reload: { ReloadReply.refused(code: "CORE_START", running: self.threeTier).encoded },
                                         status: { nil })
        var owed = first.owed(before: nil)
        XCTAssertEqual(owed, threeTier)
        let second = await RouteApply.run(RouteSettings(mode: .threeTier, node: "osaka-1"), previous: threeTier, tunnelUp: true,
                                          save: { _ in throw WriteFailed() }, reload: { nil }, status: { nil })
        owed = second.owed(before: owed)
        XCTAssertEqual(file, stable, "the file still holds the refused routes")
        XCTAssertEqual(owed, threeTier, "the unfinished put-back was dropped")
    }

    func testRefusedReloadReportsTheGraphTheExtensionStillRuns() async {
        var file: RouteSettings?
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { file = $0 },
                                           reload: { ReloadReply.refused(code: "CORE_START", running: self.threeTier).encoded },
                                           status: { nil }).outcome
        XCTAssertEqual(outcome, .notApplied(code: "CORE_START", inEffect: threeTier))
        XCTAssertEqual(file, threeTier)
    }

    /// The refusal reaches the phase through the tunnel's stamped answer, not through the outcome:
    /// the reply as the extension sends it, the report, the app's tracker, the phase.
    func testRefusedReloadWithNoGraphLeftIsFailedWhileTheTunnelIsUp() async {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let stamp = TunnelAnswer(session: "s1", generation: 3, routing: nil, since: t0, at: t0)
        var tracker = ConfirmationTracker()
        let ticket = tracker.ask()
        let report = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { _ in },
                                          reload: { ReloadReply.refused(code: "CORE_START", running: nil).encoded(answer: stamp) },
                                          status: { nil })
        XCTAssertEqual(report.outcome, .notApplied(code: "CORE_START", inEffect: nil))
        XCTAssertTrue(tracker.received(report.answer, ticket: ticket))
        let facts = ConnectionFacts(signedIn: true, tunnel: .connected, cloudProbe: ExitProbe(state: .ok), homeProbe: ExitProbe(state: .ok),
                                    routing: tracker.confirmation(now: t0.addingTimeInterval(1)))
        let derived = ConnectionState.derive(facts)
        XCTAssertEqual(derived.phase, .failed)
        XCTAssertEqual(derived.reason, "ROUTES_STOPPED")
    }

    func testConfirmedReloadIsTheOnlyWayARunningTunnelReportsTheNewMode() async {
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { _ in },
                                           reload: { ReloadReply.applied(self.stable).encoded },
                                           status: { nil }).outcome
        XCTAssertEqual(outcome, .applied(stable))
    }
    func testAReplyAfterTheSessionEndedCannotPutOldInputsBack() async {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        var tracker = ConfirmationTracker()
        let ticket = tracker.ask(at: t0)
        var writes: [RouteSettings] = []
        let oldAnswer = TunnelAnswer(session: "old-session", generation: 2, routing: threeTier, since: t0, at: t0)
        let report = await RouteApply.run(stable, previous: threeTier, tunnelUp: true,
            save: { writes.append($0) },
            reload: {
                tracker.sessionEnded()
                return ReloadReply.refused(code: "CORE_START", running: self.threeTier).encoded(answer: oldAnswer)
            }, status: { XCTFail("stale reload must not query the new session"); return nil },
            acceptReply: { tracker.permits(RouteApplyReport(.unconfirmed(self.stable), answer: $0), ticket: ticket) })
        XCTAssertEqual(writes, [stable], "an obsolete response must not roll the new session's inputs back")
        XCTAssertFalse(tracker.settle(report, ticket: ticket))
    }

}
