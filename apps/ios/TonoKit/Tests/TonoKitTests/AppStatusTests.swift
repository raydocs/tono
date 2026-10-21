import XCTest
@testable import TonoKit

/// Home and the shared surfaces (widgets, the Control Center switch, the Live Activity) resolved
/// from the same facts: the tunnel's report on file, what the app heard and Network Extension's
/// status. The app takes the report (`ConfirmationTracker.observed`), resolves (`AppStatus`), writes
/// its note; the surfaces read the note beside the same report. Fixed clock.
final class AppStatusTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let tokyo = RouteSettings(mode: .threeTier, node: "tokyo-1")
    private let ok = ExitProbe(state: .ok, location: "JP")

    private struct Claims: Equatable {
        let home: StatusWording
        let widgets: StatusWording
    }

    private func report(_ session: String = "s1", opened: Date? = nil, generation: Int = 1, routing: RouteSettings?, at: Date) -> TunnelReport {
        TunnelReport(session: session, opened: opened ?? t0, generation: generation, running: true, routing: routing,
                     since: t0, failure: nil, beatAt: at)
    }

    /// The tracker after the tunnel's start s1 answered with graph 1 at t0.
    private func heardTokyo() -> ConfirmationTracker {
        var tracker = ConfirmationTracker()
        tracker.received(TunnelAnswer(session: "s1", generation: 1, routing: tokyo, since: t0, at: t0), ticket: tracker.ask(at: t0))
        return tracker
    }

    /// The app reads `file`, resolves, writes its note; the surfaces read note and file. Exit checks
    /// have passed for whatever graph is confirmed.
    private func claims(_ tracker: inout ConfirmationTracker, file: TunnelReport, now: Date) -> Claims {
        tracker.observed(file)
        let checks = ExitChecks(cloud: ok, home: ok, graph: tracker.stamp(now: now))
        let app = AppStatus.resolve(ConnectionFacts(signedIn: true, tunnel: .connected), checks: checks, tracker: tracker, now: now)
        let home = StatusWording(.fresh(StatusSnapshot(state: StatusSnapshot.State(app.phase), reason: app.reason, updatedAt: now, writer: .app)))
        let shared = SharedStatus(tunnel: file, app: app.note(line: nil, now: now))
        return Claims(home: home, widgets: StatusWording(shared.reading(now: now)))
    }

    private func both(_ wording: StatusWording) -> Claims { Claims(home: wording, widgets: wording) }

    private let connected = StatusWording(titleKey: "state_connected", switchOn: true, action: .disconnect)
    private let unconfirmed = StatusWording(titleKey: "state_unconfirmed", switchOn: false, action: .openApp)

    /// The tunnel wrote that graph 2 of the same start has no routes; the app had graph 1.
    func testANewerRoutesStoppedReportReadsTheSameOnHomeAndWidgets() {
        var tracker = heardTokyo()
        let stopped = report(generation: 2, routing: nil, at: t0.addingTimeInterval(60))
        XCTAssertEqual(claims(&tracker, file: stopped, now: t0.addingTimeInterval(61)),
                       both(StatusWording(titleKey: "state_routes_stopped", switchOn: false, action: .retry)))
    }

    /// The app's latest question went unanswered; the tunnel's last beat on file is older than it.
    func testAnUnansweredQuestionReadsUnconfirmedOnHomeAndWidgets() {
        var tracker = heardTokyo()
        tracker.received(nil, ticket: tracker.ask(at: t0.addingTimeInterval(10)))
        XCTAssertEqual(claims(&tracker, file: report(routing: tokyo, at: t0), now: t0.addingTimeInterval(15)), both(unconfirmed))
    }

    /// After the unanswered question, the same start beats again: its word is newer than the silence.
    func testANewerBeatAfterAnUnansweredQuestionReadsConnectedOnHomeAndWidgets() {
        var tracker = heardTokyo()
        tracker.received(nil, ticket: tracker.ask(at: t0.addingTimeInterval(10)))
        XCTAssertEqual(claims(&tracker, file: report(routing: tokyo, at: t0.addingTimeInterval(300)), now: t0.addingTimeInterval(301)),
                       both(connected))
    }

    /// Network Extension reconnected; the file still holds the earlier start's fresh beat and the
    /// new start has not answered. Neither Home nor the widgets state the earlier graph.
    func testAfterAReconnectNeitherHomeNorWidgetsUseTheEarlierStartsReport() {
        var tracker = heardTokyo()
        tracker.sessionEnded()
        XCTAssertEqual(claims(&tracker, file: report(routing: tokyo, at: t0.addingTimeInterval(90)), now: t0.addingTimeInterval(100)),
                       both(unconfirmed))
    }
}
