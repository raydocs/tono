import XCTest
@testable import Tono

/// After a restart only the helper enables PF. When its binary is installed but
/// nothing answers the socket, the launch-time native-update query threw a
/// generic "helper unavailable" before any notice or repair could run, and
/// Retry repeated it forever (H12-F2, H15-F1). Drives the production query.
final class HelperUnprotectedNoticeTests: XCTestCase {
    func testAHelperLaunchdDoesNotRunSaysThisMacIsNotProtected() async throws {
        // Turned off under Allow in the Background: no repair can start it.
        var repairs = 0
        do {
            _ = try await RuntimeCleanup.queryPendingNativeUpdate(
                query: { throw HelperIPCError.connectFailed },
                launchState: { .backgroundDisabled },
                repairHelper: { repairs += 1 }
            )
            XCTFail("An unreachable, disabled helper must stop the launch with a notice")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("not protected right now"))
            XCTAssertTrue(error.localizedDescription.contains("Allow in the Background"))
        }
        XCTAssertEqual(repairs, 0)

        // Not loaded by launchd: repair through the administrator install,
        // then ask the repaired helper again.
        var repaired = false
        let status = try await RuntimeCleanup.queryPendingNativeUpdate(
            query: {
                guard repaired else { throw HelperIPCError.connectFailed }
                return nil
            },
            launchState: { .notLoaded },
            repairHelper: { repaired = true }
        )
        XCTAssertTrue(repaired)
        XCTAssertNil(status)
    }

    /// TM-claude-2: a current helper whose startup keeps failing exits, and
    /// launchd restarts it every ten seconds forever. Installation saw a
    /// current, registered binary and returned, so no repair ever ran.
    /// launchd's run count is the evidence: two restarts inside the window
    /// while the socket never answers is a crash loop; one is a restart.
    func testLaunchdRestartingTheHelperTwiceIsACrashLoop() {
        func printed(runs: Int) -> String {
            """
            system/com.raydocs.tono.core-helper = {
            \tactive count = 0
            \tstate = not running
            \truns = \(runs)
            \tlast exit code = 1
            \tresource coalition = {
            \t\tstate = active
            \t}
            }
            """
        }
        XCTAssertTrue(
            HelperManager.launchdShowsCrashLoop(before: printed(runs: 7), after: printed(runs: 9))
        )
        XCTAssertFalse(
            HelperManager.launchdShowsCrashLoop(before: printed(runs: 7), after: printed(runs: 8))
        )
        XCTAssertFalse(
            HelperManager.launchdShowsCrashLoop(before: "", after: printed(runs: 9)),
            "no run count is no evidence"
        )
    }
}
