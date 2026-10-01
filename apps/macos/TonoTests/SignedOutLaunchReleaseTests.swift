import XCTest
@testable import Tono

/// #1117: a signed-out cold launch after automatic recovery must not send the
/// explicit disarm that removes the retained AI hold.
@MainActor
final class SignedOutLaunchReleaseTests: XCTestCase {
    func testReleasedHelperKeepsAIHoldAndUnknownHelperStillReleases() async throws {
        var disarms = 0
        var dnsRestores = 0

        try await AccountSession.releaseSignedOutLaunchProtection(
            status: { .confirmed(requiresProtectionRecovery: false) },
            restoreDNS: { dnsRestores += 1 },
            disarm: { disarms += 1 }
        )
        XCTAssertEqual(disarms, 0, "a full disarm would remove the retained AI hold")
        XCTAssertEqual(dnsRestores, 1)

        // An older or unreachable helper proves nothing: keep the full release.
        try await AccountSession.releaseSignedOutLaunchProtection(
            status: { .unavailable },
            restoreDNS: { dnsRestores += 1 },
            disarm: { disarms += 1 }
        )
        XCTAssertEqual(disarms, 1)
    }
}
