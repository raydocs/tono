import XCTest
@testable import Tono

final class HelperUpgradePreflightTests: XCTestCase {
    /// An older helper that cannot read its own DNS snapshot answers every
    /// restore with the same failure. Its replacement must still proceed as
    /// long as the core stops and PF stays live, or the host has no way out.
    func testUnreadableDNSStateOnPreviousHelperDoesNotBlockItsReplacement() {
        var coreStopped = false
        XCTAssertNoThrow(
            try HelperManager.prepareAuthenticatedHelperForReplacement(
                restoreDNS: {
                    throw HelperIPCError.commandFailed(
                        "Protected DNS status is unavailable."
                    )
                },
                stopCore: { coreStopped = true },
                killSwitchStatus: {
                    (armed: true, wanted: true, live: true, healed: false)
                }
            )
        )
        XCTAssertTrue(coreStopped)
    }
}
