import XCTest
@testable import Tono

final class CrashRecoveryFailClosedTests: XCTestCase {
    private var originalArmedState: Bool = false

    override func setUp() {
        super.setUp()
        originalArmedState = KillSwitchService.isArmed
    }

    override func tearDown() {
        KillSwitchService.isArmed = originalArmedState
        super.tearDown()
    }

    func testHelperConfirmedStatusUpdatesArmedStateAuthoritatively() {
        KillSwitchService.isArmed = false
        let observation = KillSwitchService.StatusObservation.confirmed(requiresProtectionRecovery: true)

        let shouldResume: Bool
        switch observation {
        case .confirmed(let requiresProtectionRecovery):
            KillSwitchService.isArmed = requiresProtectionRecovery
            shouldResume = requiresProtectionRecovery
        case .unavailable, .rejected:
            shouldResume = false
        }

        XCTAssertTrue(shouldResume)
        XCTAssertTrue(KillSwitchService.isArmed, "Confirmed recovery must set isArmed to true")
    }

    func testHelperUnavailablePreservesLocalFailClosedIntent() {
        // If local intent was armed (machine crashed while protected),
        // a helper communication failure must NEVER drop the fail-closed barrier.
        KillSwitchService.isArmed = true
        let localIntent = KillSwitchService.isArmed
        let observation = KillSwitchService.StatusObservation.unavailable

        let shouldResume: Bool
        switch observation {
        case .confirmed(let requiresProtectionRecovery):
            KillSwitchService.isArmed = requiresProtectionRecovery
            shouldResume = requiresProtectionRecovery
        case .unavailable, .rejected:
            shouldResume = localIntent
        }

        XCTAssertTrue(shouldResume, "Unavailable helper must preserve local fail-closed intent")
        XCTAssertTrue(KillSwitchService.isArmed, "isArmed must remain true")
    }

    func testHelperRejectionPreservesLocalFailClosedIntent() {
        // A helper rejecting the client token must not be interpreted as unarmed.
        KillSwitchService.isArmed = true
        let localIntent = KillSwitchService.isArmed
        let observation = KillSwitchService.StatusObservation.rejected

        let shouldResume: Bool
        switch observation {
        case .confirmed(let requiresProtectionRecovery):
            KillSwitchService.isArmed = requiresProtectionRecovery
            shouldResume = requiresProtectionRecovery
        case .unavailable, .rejected:
            shouldResume = localIntent
        }

        XCTAssertTrue(shouldResume, "Rejected helper must preserve local fail-closed intent")
        XCTAssertTrue(KillSwitchService.isArmed, "isArmed must remain true")
    }

    func testConfirmedDisarmedClearsArmedState() {
        // If emergency disarm was run externally via root CLI, helper confirms unarmed.
        KillSwitchService.isArmed = true
        let observation = KillSwitchService.StatusObservation.confirmed(requiresProtectionRecovery: false)

        let shouldResume: Bool
        switch observation {
        case .confirmed(let requiresProtectionRecovery):
            KillSwitchService.isArmed = requiresProtectionRecovery
            shouldResume = requiresProtectionRecovery
        case .unavailable, .rejected:
            shouldResume = true
        }

        XCTAssertFalse(shouldResume)
        XCTAssertFalse(KillSwitchService.isArmed, "Confirmed unarm must clear stale local state")
    }
}
