import XCTest
@testable import Tono

/// Launch recovery learns from the helper whether an earlier session's PF
/// barrier is still held, but never told AppState: the menu bar said Standby
/// over a blocking PF (internal review H16-O-F5 / H16-C-F1). Drives the
/// production launch fold; only the helper's answers are supplied.
@MainActor
final class LaunchProtectionPresentationTests: XCTestCase {
    func testLaunchShowsTheHelperAnswerInsteadOfStandby() async {
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

        // A later launch pass (Retry on the gate) hears that nothing is held:
        // the earlier Protected Offline must not survive the helper's answer.
        XCTAssertFalse(RuntimeCleanup.adoptLaunchObservation(
            .confirmed(requiresProtectionRecovery: false),
            localIntent: true
        ))
        XCTAssertFalse(held.isProtectionBlocked)
        XCTAssertEqual(MenuBarProtectionStatus(held).kind, .standby)

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

        // The helper answers later (app activation): the unknown resolves.
        unanswered.networkProtection.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: true)
        }
        await unanswered.resolveUnconfirmedProtection()
        XCTAssertTrue(unanswered.isProtectionBlocked)
        XCTAssertEqual(MenuBarProtectionStatus(unanswered).kind, .blocked)
    }
}
