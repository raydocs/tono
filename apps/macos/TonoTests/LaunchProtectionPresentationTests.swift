import XCTest
@testable import Tono

/// Launch recovery learns from the helper whether an earlier session's PF
/// barrier is still held, but never told AppState: the menu bar said Standby
/// over a blocking PF (internal review H16-O-F5 / H16-C-F1). Drives the
/// production launch fold; only the helper's answer is supplied.
@MainActor
final class LaunchProtectionPresentationTests: XCTestCase {
    func testLaunchShowsTheHelperAnswerInsteadOfStandby() {
        let storedIntent = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = storedIntent }

        // The helper confirms a held barrier: an update that must resume in
        // Protected Offline, or a relaunch into a gate with PF armed.
        let held = AppState()
        KillSwitchService.isArmed = false
        XCTAssertTrue(RuntimeCleanup.adoptLaunchObservation(
            .confirmed(requiresProtectionRecovery: true),
            localIntent: false
        ))
        XCTAssertTrue(held.isProtectionBlocked)
        XCTAssertEqual(MenuBarProtectionStatus(held).kind, .blocked)

        // No authenticated answer: the stored intent proves neither a barrier
        // nor an open host.
        let unanswered = AppState()
        XCTAssertTrue(RuntimeCleanup.adoptLaunchObservation(
            .unavailable,
            localIntent: true
        ))
        XCTAssertFalse(unanswered.isProtectionBlocked)
        XCTAssertNotEqual(MenuBarProtectionStatus(unanswered).kind, .standby)
        XCTAssertNotEqual(MenuBarProtectionStatus(unanswered).kind, .blocked)
    }
}
