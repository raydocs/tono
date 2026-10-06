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

    /// MAC-DNS-ENABLE-LOCK-RETRY: `/dns/enable` meets the same refusal on
    /// connect, and a single one failed the connect.
    func testProtectedDNSEnableRetriesTheLockRefusal() throws {
        var sends = 0
        try HelperManager.enableProtectedDNS(service: "Wi-Fi") { object in
            sends += 1
            XCTAssertEqual(object, ["service": "Wi-Fi"])
            if sends == 1 {
                return (400, Data(#"{"ok":false,"error":"Could not lock network preferences."}"#.utf8))
            }
            return (200, Data(#"{"ok":true,"configured":true,"snapshotPresent":true,"service":"Wi-Fi"}"#.utf8))
        }
        XCTAssertEqual(sends, 2, "one lost lock race must not fail the connect")
    }
}
