import XCTest
@testable import Tono

final class HelperSilentUpgradeTimeoutTests: XCTestCase {
    func testHelperUpgradeReceivesDedicatedThirtySecondTimeout() {
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/helper/upgrade"),
            30,
            "/helper/upgrade requires 30s receive timeout to complete binary copy and codesign verification"
        )
    }

    func testKillSwitchArmRetainsThirtySecondTimeout() {
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/killswitch/arm"),
            30
        )
    }

    func testStatusAndVersionProbesMaintainFastFailTwoSecondTimeout() {
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/version"),
            2
        )
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/core/status"),
            2
        )
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/killswitch/status"),
            2
        )
    }

    func testCoreLifecycleRoutesRetainEstablishedTimeouts() {
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/core/stop"),
            6
        )
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/core/start"),
            20
        )
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/core/sync"),
            20
        )
    }

    func testDefaultRoutesRetainSixSecondTimeout() {
        XCTAssertEqual(
            HelperManager.receiveTimeout(for: "/dns/status"),
            6
        )
    }

    func testSilentUpgradePollTimeoutMatchesPrivilegedScriptTimeoutOfFortyFiveSeconds() {
        XCTAssertEqual(
            HelperManager.silentUpgradePollTimeout,
            45,
            "silent upgrade poll window must allow 45s for helper restart and version reconciliation"
        )
    }

    /// Cancelling or failing a replacement after Core stopped must release
    /// the old helper's PF; success and a never-stopped Core keep protection.
    func testAbandonedUpgradeReleasesOnlyAfterPreviousCoreStopped() {
        XCTAssertTrue(
            HelperManager.shouldReleaseAfterAbandonedUpgrade(
                coreStopped: true, succeeded: false
            )
        )
        XCTAssertFalse(
            HelperManager.shouldReleaseAfterAbandonedUpgrade(
                coreStopped: true, succeeded: true
            )
        )
        XCTAssertFalse(
            HelperManager.shouldReleaseAfterAbandonedUpgrade(
                coreStopped: false, succeeded: false
            )
        )
        XCTAssertFalse(
            HelperManager.shouldReleaseAfterAbandonedUpgrade(
                coreStopped: false, succeeded: true
            )
        )
    }
}
