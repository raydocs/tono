import XCTest
@testable import Tono

/// A Mac that restarted while a session was up (a kernel panic, a power loss)
/// must not reconnect by itself at the next launch: if the session triggered
/// the restart, that reconnect repeats it at every login. A crash and relaunch
/// within the same boot keeps automatic recovery.
@MainActor
final class UnexpectedRestartResumeTests: XCTestCase {
    func testLaunchResumesAutomaticallyOnlyInTheBootThatStartedTheSession() {
        XCTAssertTrue(RuntimeCleanup.holdsAutomaticResume(
            recordedBootSession: "boot-before-restart",
            currentBootSession: "boot-after-restart"
        ), "A session started in an earlier boot must not auto-connect")
        XCTAssertTrue(RuntimeCleanup.holdsAutomaticResume(
            recordedBootSession: RuntimeCleanup.bootSessionRecord(current: nil),
            currentBootSession: "boot-after-restart"
        ), "A connect whose boot session could not be read must still hold")
        XCTAssertFalse(RuntimeCleanup.holdsAutomaticResume(
            recordedBootSession: "same-boot",
            currentBootSession: "same-boot"
        ), "A same-boot relaunch keeps automatic recovery")
    }
}
