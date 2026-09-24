import XCTest
@testable import Tono

/// X3-1 follow-up: when the network service that owned the protected DNS
/// snapshot was deleted, the helper archives the recorded servers, sweeps
/// loopback DNS to automatic, and answers `/dns/restore` with success plus
/// `originalDNSRestored: false`. The app used to accept that as a plain
/// success. The reply must map to a user notice; a restored reply, or one
/// from a helper that predates the field, must not.
final class ProtectedDNSRestoreNoticeTests: XCTestCase {

    func testRestoreReplyWithoutOriginalDNSMapsToUserNotice() {
        func reply(_ extra: String) -> Data {
            Data(
                #"{"ok":true,"configured":false,"snapshotPresent":false,"service":"Wi-Fi"\#(extra)}"#
                    .utf8
            )
        }

        XCTAssertEqual(
            HelperManager.protectedDNSRestoreNotice(
                restoreReply: reply(#","originalDNSRestored":false"#)
            ),
            String(
                localized: "The network service whose DNS settings Tono saved has been deleted, so those DNS servers could not be put back. DNS is now obtained automatically. If your network needs manual DNS servers, set them again in System Settings > Network."
            )
        )
        XCTAssertNil(
            HelperManager.protectedDNSRestoreNotice(
                restoreReply: reply(#","originalDNSRestored":true"#)
            )
        )
        XCTAssertNil(
            HelperManager.protectedDNSRestoreNotice(restoreReply: reply("")),
            "a helper that predates the field reports no lost original"
        )
    }
}
