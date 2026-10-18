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

    func testRefusedReloadReportsTheGraphTheExtensionStillRuns() async {
        var file: RouteSettings?
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { file = $0 },
                                           reload: { ReloadReply.refused(code: "CORE_START", running: self.threeTier).encoded },
                                           status: { nil }).outcome
        XCTAssertEqual(outcome, .notApplied(code: "CORE_START", inEffect: threeTier))
        XCTAssertEqual(file, threeTier)
    }

    func testRefusedReloadWithNoGraphLeftIsFailedWhileTheTunnelIsUp() async {
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { _ in },
                                           reload: { ReloadReply.refused(code: "CORE_START", running: nil).encoded },
                                           status: { nil }).outcome
        XCTAssertEqual(outcome, .notApplied(code: "CORE_START", inEffect: nil))
        let facts = ConnectionFacts(signedIn: true, tunnel: .connected, cloudProbe: ExitProbe(state: .ok), homeProbe: ExitProbe(state: .ok),
                                    routesStopped: true)
        XCTAssertEqual(ConnectionState.derive(facts).phase, .failed)
    }

    func testConfirmedReloadIsTheOnlyWayARunningTunnelReportsTheNewMode() async {
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { _ in },
                                           reload: { ReloadReply.applied(self.stable).encoded },
                                           status: { nil }).outcome
        XCTAssertEqual(outcome, .applied(stable))
    }
}
