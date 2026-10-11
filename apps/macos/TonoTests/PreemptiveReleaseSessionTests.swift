import XCTest
@testable import Tono

/// Preemptive Restore internet (PROPOSAL §10 v5): work an earlier session
/// issues after a Restore must not reach the helper as if it were current.
final class PreemptiveReleaseSessionTests: XCTestCase {

    /// A session retired by Restore that was never admitted cannot admit
    /// itself late: its arm and its teardown are both refused before any IPC.
    func testRetiredUnadmittedSessionIsRefusedBeforeTheHelper() {
        let retired = HelperSessionGeneration()
        retired.retire()
        HelperSessionGeneration.$current.withValue(retired) {
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
}
