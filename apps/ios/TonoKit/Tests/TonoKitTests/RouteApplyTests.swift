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
                                           reload: { reloads += 1; return ReloadReply.applied(self.threeTier).encoded })
        XCTAssertEqual(outcome, .notApplied(code: "SAVE_FAILED", inEffect: threeTier))
        XCTAssertEqual(reloads, 0)
    }

    func testNoReplyFromTheTunnelIsNotSuccessAndRestoresTheFile() async {
        var file: RouteSettings?
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true,
                                           save: { file = $0 }, reload: { nil })
        XCTAssertEqual(outcome, .notApplied(code: "NO_REPLY", inEffect: threeTier))
        XCTAssertEqual(file, threeTier)
    }

    func testRefusedReloadReportsTheGraphTheExtensionStillRuns() async {
        var file: RouteSettings?
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { file = $0 },
                                           reload: { ReloadReply.refused(code: "CORE_START", running: self.threeTier).encoded })
        XCTAssertEqual(outcome, .notApplied(code: "CORE_START", inEffect: threeTier))
        XCTAssertEqual(file, threeTier)
    }

    func testRefusedReloadWithNoGraphLeftIsFailedWhileTheTunnelIsUp() async {
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { _ in },
                                           reload: { ReloadReply.refused(code: "CORE_START", running: nil).encoded })
        XCTAssertEqual(outcome, .notApplied(code: "CORE_START", inEffect: nil))
        let facts = ConnectionFacts(signedIn: true, tunnel: .connected, cloudProbe: ExitProbe(state: .ok), homeProbe: ExitProbe(state: .ok),
                                    routesStopped: true)
        XCTAssertEqual(ConnectionState.derive(facts).phase, .failed)
    }

    func testConfirmedReloadIsTheOnlyWayARunningTunnelReportsTheNewMode() async {
        let outcome = await RouteApply.run(stable, previous: threeTier, tunnelUp: true, save: { _ in },
                                           reload: { ReloadReply.applied(self.stable).encoded })
        XCTAssertEqual(outcome, .applied(stable))
    }
}
