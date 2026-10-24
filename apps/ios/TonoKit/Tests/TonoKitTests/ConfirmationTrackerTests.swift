import XCTest
@testable import TonoKit

/// The app's confirmation of what the tunnel runs: only the tunnel's stamped answer for the session
/// the app sees counts, for `freshFor` by the tunnel's clock. Launch, reconnect, late and out-of-order
/// replies, silence and refusals, each with a fixed clock and no waiting.
final class ConfirmationTrackerTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let tokyo = RouteSettings(mode: .threeTier, node: "tokyo-1")
    private let stable = RouteSettings(mode: .stable, node: "tokyo-1")
    private let checksPass = (cloud: ExitProbe(state: .ok, location: "JP"), home: ExitProbe(state: .ok, location: "US"))

    private func answer(_ routing: RouteSettings?, session: String = "s1", generation: Int = 1, at: Date? = nil) -> TunnelAnswer {
        TunnelAnswer(session: session, generation: generation, routing: routing, since: t0, at: at ?? t0)
    }

    private struct Said: Equatable {
        let phase: Phase
        let reason: String?
    }

    private func said(_ tracker: ConfirmationTracker, now: Date) -> Said {
        let d = ConnectionState.derive(ConnectionFacts(signedIn: true, tunnel: .connected, cloudProbe: checksPass.cloud,
                                                       homeProbe: checksPass.home, routing: tracker.confirmation(now: now)))
        return Said(phase: d.phase, reason: d.reason)
    }

    /// Network Extension says connected and the exit checks pass, but the tunnel has not answered:
    /// nothing positive is claimed until it does.
    func testAppLaunchedIntoARunningTunnelClaimsNothingUntilItAnswers() {
        var tracker = ConfirmationTracker()
        XCTAssertEqual(said(tracker, now: t0), Said(phase: .connecting, reason: "UNCONFIRMED"))
        let ticket = tracker.ask()
        XCTAssertTrue(tracker.received(answer(tokyo), ticket: ticket))
        XCTAssertEqual(said(tracker, now: t0.addingTimeInterval(1)), Said(phase: .connected, reason: nil))
    }

    func testAReplyToAQuestionAskedBeforeAReconnectIsDropped() {
        var tracker = ConfirmationTracker()
        let ticket = tracker.ask()
        tracker.sessionEnded()
        XCTAssertFalse(tracker.received(answer(tokyo), ticket: ticket))
        XCTAssertEqual(tracker.confirmation(now: t0), .unknown)
    }

    /// A status question asked before a rebuild is answered after the rebuild's own reply: the older
    /// graph does not replace the newer one.
    func testALateReplyAboutAnOlderGraphIsDropped() {
        var tracker = ConfirmationTracker()
        let status = tracker.ask()
        let rebuild = tracker.ask()
        XCTAssertTrue(tracker.received(answer(stable, generation: 3, at: t0.addingTimeInterval(2)), ticket: rebuild))
        XCTAssertFalse(tracker.received(answer(tokyo, generation: 2, at: t0.addingTimeInterval(1)), ticket: status))
        XCTAssertEqual(tracker.confirmation(now: t0.addingTimeInterval(3)), .graph(stable))
    }

    /// Only the tunnel's `at` ages the confirmation; nothing the app does in between renews it.
    func testTheConfirmationExpiresByTheTunnelsClock() {
        var tracker = ConfirmationTracker()
        let ticket = tracker.ask()
        tracker.received(answer(tokyo), ticket: ticket)
        XCTAssertEqual(tracker.confirmation(now: t0.addingTimeInterval(14 * 60)), .graph(tokyo))
        XCTAssertEqual(tracker.confirmation(now: t0.addingTimeInterval(16 * 60)), .unknown)
        XCTAssertEqual(said(tracker, now: t0.addingTimeInterval(16 * 60)), Said(phase: .connecting, reason: "UNCONFIRMED"))
    }

    func testAnUnansweredLatestQuestionClearsTheConfirmation() {
        var tracker = ConfirmationTracker()
        let answered = tracker.ask()
        tracker.received(answer(tokyo), ticket: answered)
        let unanswered = tracker.ask()
        XCTAssertTrue(tracker.received(nil, ticket: unanswered))
        XCTAssertEqual(tracker.confirmation(now: t0), .unknown)
    }

    func testAnUnansweredEarlierQuestionDoesNotClearANewerAnswer() {
        var tracker = ConfirmationTracker()
        let earlier = tracker.ask()
        let later = tracker.ask()
        tracker.received(answer(tokyo), ticket: later)
        XCTAssertFalse(tracker.received(nil, ticket: earlier))
        XCTAssertEqual(tracker.confirmation(now: t0), .graph(tokyo))
    }

    /// The extension's refused rebuild whose restore succeeded, on the wire: the stamped reply names
    /// the graph that still runs, and that is what the app confirms (not the request).
    func testARefusedRebuildThatRestoredTheGraphConfirmsTheOldRoutes() throws {
        struct Refused: Error {}
        var graph = TunnelGraph(session: "s1", opened: t0)
        try graph.run(TunnelInputs(catalogBody: "c", mode: .threeTier, selectedNode: "tokyo-1"), build: { $0.mode.rawValue }, start: { _ in })
        var refuseNext = true
        let reply = graph.reload(load: { TunnelInputs(catalogBody: "c", mode: .stable, selectedNode: "tokyo-1") }, build: { $0.mode.rawValue },
                                 start: { _ in if refuseNext { refuseNext = false; throw Refused() } }, persist: { _ in })
        let wire = reply.encoded(answer: graph.answer(since: t0, now: t0.addingTimeInterval(1)))
        XCTAssertEqual(ReloadReply.decode(wire), .refused(code: "CORE_START", running: tokyo))
        var tracker = ConfirmationTracker()
        let ticket = tracker.ask()
        tracker.received(TunnelAnswer.decode(wire), ticket: ticket)
        XCTAssertEqual(tracker.confirmation(now: t0.addingTimeInterval(2)), .graph(tokyo))
        XCTAssertEqual(tracker.answer?.generation, graph.generation)
    }

    /// A reply without the tunnel's stamp (an older build, a garbled reply) is not an answer.
    func testAReplyWithoutTheTunnelsStampIsNoAnswer() {
        XCTAssertNil(TunnelAnswer.decode(ReloadReply.applied(tokyo).encoded))
        XCTAssertNil(TunnelAnswer.decode(Data(JSON.obj(("running", tokyo.json)).serialized().utf8)))
        XCTAssertNil(TunnelAnswer.decode(Data(#"{"tunnel":{"session":"s1","generation":1,"at":1,"routing":{"mode":"NOPE"}}}"#.utf8)))
        let stamped = answer(nil, generation: 7)
        XCTAssertEqual(TunnelAnswer.decode(Data(JSON.obj(("tunnel", stamped.json)).serialized().utf8)), stamped)
    }
    func testAnEarlierPositiveReplyCannotUndoALaterUnansweredQuestion() {
        var tracker = ConfirmationTracker()
        let earlier = tracker.ask()
        let later = tracker.ask()
        XCTAssertTrue(tracker.received(nil, ticket: later))
        XCTAssertFalse(tracker.received(answer(tokyo), ticket: earlier))
        XCTAssertEqual(tracker.confirmation(now: t0), .unknown)
    }

    /// A switch asked of a session that ended before its reply came: the reply (and the outcome,
    /// the pending change and any put-back it carries) changes nothing in the new session.
    func testASwitchReplyFromASessionThatEndedChangesNothing() {
        var tracker = ConfirmationTracker()
        tracker.received(answer(tokyo), ticket: tracker.ask())
        let ticket = tracker.ask()
        tracker.sessionEnded()
        let late = RouteApplyReport(.notApplied(code: "CORE_START", inEffect: tokyo), unsaved: tokyo,
                                    answer: answer(tokyo, generation: 2, at: t0.addingTimeInterval(5)))
        XCTAssertFalse(tracker.settle(late, ticket: ticket))
        XCTAssertEqual(tracker.confirmation(now: t0.addingTimeInterval(6)), .unknown)
    }

    /// The tunnel writes its report of a rebuild just after it computed the reply: when the app read
    /// that report first, the reply (same graph, earlier moment) still settles the switch.
    func testASwitchReplyAboutTheGraphTheTunnelsReportAlreadyNamedStillCounts() {
        var tracker = ConfirmationTracker()
        tracker.received(answer(tokyo), ticket: tracker.ask())
        let ticket = tracker.ask()
        tracker.observed(TunnelReport(session: "s1", opened: t0, generation: 2, running: true, routing: tokyo, since: t0,
                                      failure: nil, beatAt: t0.addingTimeInterval(3)))
        let refused = RouteApplyReport(.notApplied(code: "CORE_START", inEffect: tokyo), answer: answer(tokyo, generation: 2, at: t0.addingTimeInterval(2)))
        XCTAssertTrue(tracker.settle(refused, ticket: ticket))
        XCTAssertEqual(tracker.confirmation(now: t0.addingTimeInterval(4)), .graph(tokyo))
    }

    /// Exit checks that ran while graph 1 was confirmed do not make graph 2 connected; checks run
    /// against graph 2 do.
    func testExitChecksOfAnEarlierGraphDoNotCertifyTheOneConfirmedNow() {
        var tracker = ConfirmationTracker()
        tracker.received(answer(tokyo), ticket: tracker.ask())
        let earlier = ExitChecks(cloud: checksPass.cloud, home: checksPass.home, graph: tracker.stamp(now: t0))
        tracker.received(answer(stable, generation: 2, at: t0.addingTimeInterval(1)), ticket: tracker.ask())
        let facts = ConnectionFacts(signedIn: true, tunnel: .connected)
        let now = t0.addingTimeInterval(2)
        let stale = AppStatus.resolve(facts, checks: earlier, tracker: tracker, now: now)
        XCTAssertEqual(stale.phase, .connecting)
        XCTAssertEqual(stale.cloud, ExitProbe())
        let current = ExitChecks(cloud: checksPass.cloud, home: checksPass.home, graph: stale.graph)
        XCTAssertEqual(AppStatus.resolve(facts, checks: current, tracker: tracker, now: now).phase, .connected)
    }

    /// A question whose reply never comes keeps nothing alive: the answer before it still ends at
    /// its own expiry.
    func testAQuestionThatIsNeverAnsweredDoesNotHoldTheConfirmationPastItsExpiry() throws {
        var tracker = ConfirmationTracker()
        tracker.received(answer(tokyo), ticket: tracker.ask())
        _ = tracker.ask(at: t0.addingTimeInterval(14 * 60))
        let expiry = try XCTUnwrap(tracker.expiresAt)
        XCTAssertEqual(expiry, t0.addingTimeInterval(StatusSnapshot.freshFor))
        XCTAssertEqual(tracker.confirmation(now: expiry.addingTimeInterval(1)), .unknown)
    }
    func testSilenceDoesNotEraseTheLastKnownGraphGeneration() {
        var tracker = ConfirmationTracker()
        tracker.received(answer(nil, generation: 3), ticket: tracker.ask(at: t0))
        tracker.received(nil, ticket: tracker.ask(at: t0.addingTimeInterval(1)))
        let older = answer(tokyo, generation: 2, at: t0.addingTimeInterval(3))
        XCTAssertFalse(tracker.received(older, ticket: tracker.ask(at: t0.addingTimeInterval(2))))
        XCTAssertEqual(tracker.confirmation(now: t0.addingTimeInterval(4)), .unknown)
    }

}
