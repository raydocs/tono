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

    /// MAC3-ADD-F1: a suspension or Check again stops Core through the
    /// preserve teardown, whose bootstrap restriction prepared the helper
    /// first — a helper rejecting this app then raised an administrator
    /// prompt nobody asked for. The restriction goes straight to the helper
    /// that holds PF; a rejection fails it and the armed intent stands.
    func testBootstrapRestrictionNeverPreparesTheHelper() {
        let savedIPC = KillSwitchService.armIPC
        KillSwitchService.isArmed = true
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = false
        }
        // The helper answers the arm request itself with a rejection. Only
        // that request can surface `.helperRejected`; a helper preparation
        // fails as an install error (or prompts) before any request is sent.
        KillSwitchService.armIPC.deliver = { _ in throw HelperIPCError.forbidden }

        XCTAssertThrowsError(try KillSwitchService.restrictToBootstrap()) { error in
            guard case KillSwitchService.Error.helperRejected = error else {
                return XCTFail("the restriction must reach the helper without preparing it: \(error)")
            }
        }
        XCTAssertTrue(KillSwitchService.isArmed)
    }
}
