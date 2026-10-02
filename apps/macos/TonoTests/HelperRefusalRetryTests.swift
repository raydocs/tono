import XCTest
@testable import Tono

/// #1239: the helper refuses a DNS restore instead of waiting for the network
/// preferences lock. A single refusal used to fail the restore, so the Kill
/// Switch release that follows it was never sent and a non-strict Mac stayed
/// blocked. The caller now retries the refusal.
final class HelperRefusalRetryTests: XCTestCase {

    func testHelperRefusalIsRetriedUntilTheRestoreSucceeds() throws {
        var calls = 0
        var pauses = 0
        let restored = try HelperManager.retryingHelperRefusal(pause: { pauses += 1 }) { () -> Bool in
            calls += 1
            if calls == 1 {
                throw HelperIPCError.commandFailed("Could not lock network preferences.")
            }
            return true
        }
        XCTAssertTrue(restored)
        XCTAssertEqual(calls, 2, "one lost lock race must not fail the restore")
        XCTAssertEqual(pauses, 1)
    }
}
