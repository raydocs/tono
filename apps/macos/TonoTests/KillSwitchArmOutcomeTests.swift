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
    /// with the administrator prompt allowed — a helper rejecting this app
    /// then raised a prompt nobody asked for. The restriction still prepares
    /// the helper (version check, silent upgrade), only without the prompt;
    /// a helper that needs it fails the restriction before any arm request,
    /// and the armed intent stands.
    func testBootstrapRestrictionNeverPromptsForTheHelper() {
        let savedIPC = KillSwitchService.armIPC
        KillSwitchService.isArmed = true
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = false
        }
        var preparations: [Bool] = []
        KillSwitchService.armIPC.prepare = { administratorPrompt in
            preparations.append(administratorPrompt)
            // What a rejecting helper answers once the prompt is withheld.
            throw HelperIPCError.forbidden
        }
        KillSwitchService.armIPC.deliver = { _ in
            XCTFail("a helper that needs repair must not be sent the restriction")
            throw HelperIPCError.connectFailed
        }

        XCTAssertThrowsError(try KillSwitchService.restrictToBootstrap()) { error in
            guard case KillSwitchService.Error.helperRejected = error else {
                return XCTFail("expected the helper's rejection: \(error)")
            }
        }
        XCTAssertEqual(preparations, [false], "the restriction prepares the helper, never with the administrator prompt")
        XCTAssertTrue(KillSwitchService.isArmed)
    }
}
