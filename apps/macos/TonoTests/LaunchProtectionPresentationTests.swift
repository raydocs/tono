import XCTest
@testable import Tono

/// Launch recovery learns from the helper whether an earlier session's PF
/// barrier is still held, but never told AppState: the menu bar said Standby
/// over a blocking PF (internal review H16-O-F5 / H16-C-F1). Drives the
/// production launch fold; only the helper's answers are supplied.
@MainActor
final class LaunchProtectionPresentationTests: XCTestCase {
    func testUnknownProtectionTakesPrecedenceOverPausedRetries() {
        let state = AppState()
        state.protectedReconnectPausedForUserAction = true
        state.isProtectionUnconfirmed = true

        XCTAssertEqual(MenuBarProtectionStatus(state).kind, .unconfirmed)
    }

    func testCancelledWakeDoesNotPublishASuccessfulReassert() async {
        let storedIntent = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = storedIntent }
        KillSwitchService.isArmed = true
        let state = AppState()
        XCTAssertFalse(state.isTonoReady)
        state.isProtectionUnconfirmed = true
        var reasserted = false
        state.networkProtection.reassertKillSwitch = {
            reasserted = true
            // A successful helper reply does not imply the waiting wake
            // still owns recovery: cancellation need not throw here.
            withUnsafeCurrentTask { $0?.cancel() }
            return true
        }

        state.resumeAfterSystemWake()
        let recovery = state.connectionCoordinator.wakeRecoveryTask
        XCTAssertNotNil(recovery)
        await recovery?.value

        XCTAssertTrue(reasserted)
        XCTAssertFalse(state.isProtectionBlocked)
        XCTAssertTrue(state.isProtectionUnconfirmed)
        XCTAssertNil(state.errorMessage)
    }

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

    func testAnActivationAnswerOlderThanTheLatestLaunchVerdictIsDropped() async {
        let storedIntent = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = storedIntent }
        KillSwitchService.isArmed = true
        let state = AppState()
        XCTAssertTrue(RuntimeCleanup.adoptLaunchObservation(.unavailable, localIntent: true))
        XCTAssertTrue(state.isProtectionUnconfirmed)
        // Activation asks the helper. Before its answer lands, a launch pass
        // (Retry on the gate) publishes a newer verdict and goes on to
        // reassert the stored intent; the older answer must not retire it.
        state.networkProtection.refreshKillSwitchStatus = {
            await MainActor.run {
                _ = RuntimeCleanup.adoptLaunchObservation(.unavailable, localIntent: true)
            }
            return .confirmed(requiresProtectionRecovery: false)
        }
        await state.resolveUnconfirmedProtection()
        XCTAssertTrue(KillSwitchService.isArmed, "a stale answer must not retire the intent the launch is reasserting")
        XCTAssertTrue(state.isProtectionUnconfirmed)
    }

    /// INT610-F1: a wake that starts while the activation answer is in flight
    /// advances the protection generation, not the launch sequence. Accepting
    /// the older release cleared the armed intent under the wake's recovery,
    /// whose unarmed reassert then published Protected Offline over an open
    /// host. The answer is dropped and the wake owns the verdict — and a
    /// reassert that fails proves nothing about PF either: it shows the
    /// unknown state, not Protected Offline, while it keeps retrying.
    func testAnActivationAnswerAWakeOvertookIsDropped() async {
        let storedIntent = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = storedIntent }
        KillSwitchService.isArmed = true
        let state = AppState()
        defer { state.connectionCoordinator.wakeRecoveryTask?.cancel() }
        XCTAssertTrue(RuntimeCleanup.adoptLaunchObservation(.unavailable, localIntent: true))
        XCTAssertTrue(state.isProtectionUnconfirmed)
        // The helper cannot take the wake's reassert. The second attempt
        // comes only after the first failure was published.
        let (attempts, attempted) = AsyncStream<Int>.makeStream()
        var reasserts = 0
        state.networkProtection.reassertKillSwitch = {
            reasserts += 1
            attempted.yield(reasserts)
            throw HelperIPCError.connectFailed
        }
        state.networkProtection.refreshKillSwitchStatus = {
            await MainActor.run { state.resumeAfterSystemWake() }
            return .confirmed(requiresProtectionRecovery: false)
        }
        await state.resolveUnconfirmedProtection()
        XCTAssertTrue(KillSwitchService.isArmed, "an answer a wake overtook must not retire the intent the wake reasserts")

        for await attempt in attempts where attempt == 2 { break }
        XCTAssertFalse(state.isProtectionBlocked, "a failed wake reassert must not claim Protected Offline")
        XCTAssertTrue(state.isProtectionUnconfirmed)
        XCTAssertNotNil(state.connectionCoordinator.wakeRecoveryTask, "the wake keeps retrying")
    }
}
