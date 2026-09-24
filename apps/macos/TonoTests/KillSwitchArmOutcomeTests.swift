import XCTest
@testable import Tono

/// X1-7 regression: the helper persists armed intent and loads PF before it
/// replies. If that reply is lost and the follow-up status probe cannot answer
/// either (the helper is restarting), the arm outcome is unknown. Local intent
/// must stay fail-closed; a false here let connect failure cleanup choose the
/// release teardown and disarm PF the helper had already committed.
final class KillSwitchArmOutcomeTests: XCTestCase {

    func testLostArmReplyWithUnavailableStatusKeepsFailClosedIntent() {
        let savedIPC = KillSwitchService.armIPC
        KillSwitchService.isArmed = false
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = false
        }
        // The request was delivered; the receive timed out after the commit.
        KillSwitchService.armIPC.deliver = { _ in throw HelperIPCError.emptyResponse }
        KillSwitchService.armIPC.status = { throw HelperIPCError.connectFailed }

        XCTAssertThrowsError(
            try KillSwitchService.arm(
                apiHosts: [],
                tunnelInterfaces: [],
                proxyEndpoints: [],
                sessionDirectEndpoints: [],
                helperPrepared: true,
                reviewedBundleDirect: false
            )
        )
        XCTAssertTrue(
            KillSwitchService.isArmed,
            "an arm with an unknown outcome must keep fail-closed intent"
        )
    }
}
