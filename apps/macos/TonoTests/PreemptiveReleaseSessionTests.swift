import XCTest
@testable import Tono

/// Preemptive Restore internet (PROPOSAL §10 v5): work an earlier session
/// issues after a Restore must not reach the helper as if it were current.
final class PreemptiveReleaseSessionTests: XCTestCase {

    /// A session retired by Restore that was never admitted cannot admit
    /// itself late: its arm and its teardown are both refused before any IPC.
    func testRetiredUnadmittedSessionIsRefusedBeforeTheHelper() throws {
        let retired = HelperSessionGeneration()
        retired.retire()
        try HelperSessionGeneration.$current.withValue(retired) {
            for (method, path) in [("POST", "/killswitch/arm"), ("POST", "/killswitch/disarm")] {
                XCTAssertThrowsError(try HelperManager.sessionGenerationHeader(method: method, path: path)) { error in
                    guard case HelperIPCError.commandFailed(_, let code) = error else {
                        return XCTFail("unexpected error \(error)")
                    }
                    XCTAssertEqual(code, "STALE_GENERATION")
                }
            }
        }
    }

    /// R-F3: an admission that finishes after Restore retired its box is
    /// not adopted, so the old session cannot carry the new generation.
    func testAdmissionFinishingAfterRetirementIsNotAdopted() {
        let box = HelperSessionGeneration()
        let admitted = box.admitIfNeeded {
            box.retire()
            return 42
        }
        XCTAssertFalse(admitted)
        XCTAssertNil(box.value)
    }

    /// R-F3: a wake or reconnect connect cannot admit a Mac that Restore
    /// released; only the user's own Connect can.
    func testOnlyTheUsersConnectAdmitsAReleasedMac() {
        let released = HelperManager.SessionStatus(released: true, generation: 7)
        XCTAssertFalse(HelperManager.mayAdmit(released, userInitiated: false))
        XCTAssertTrue(HelperManager.mayAdmit(released, userInitiated: true))
    }

    /// R-M1: a Tono system proxy still in place keeps Restore from reporting
    /// the internet as restored.
    func testRemainingTonoProxyMakesRestoredPartial() {
        let restored = HelperManager.ReleaseOutcome(
            outcome: "restored", generation: 9,
            components: [.init(name: "pf", readback: "restored", risk: "settled", detail: nil)],
            stuck: [], finished: true, detail: nil
        )
        let combined = restored.includingSystemProxy(tonoProxyRemains: true)
        XCTAssertEqual(combined.outcome, "partial")
        XCTAssertTrue(combined.components.contains { $0.name == "proxy" && $0.readback == "residual" })
    }
}
