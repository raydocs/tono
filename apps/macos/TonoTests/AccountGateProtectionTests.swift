import Observation
import XCTest
@testable import Tono

/// The account gate's "Kill Switch is blocking" notice read a non-observable
/// static and a flag only its own button set, so a Restore internet finished
/// from the menu bar left the mounted gate claiming a block (internal review
/// H16-C-F2). Runs the real AccountSession -> AppState release; only helper
/// and system I/O is replaced.
@MainActor
final class AccountGateProtectionTests: XCTestCase {
    func testMenuBarRestoreRetiresTheMountedGateNotice() async {
        let storedIntent = KillSwitchService.isArmed
        defer { KillSwitchService.isArmed = storedIntent }

        let app = AppState()
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        let session = AccountSession(
            sidecar: TonoSidecarService(),
            descriptorConsumer: { _ in },
            killSwitchDisarmConsumer: {
                await app.disconnectAndWait(releaseKillSwitch: true)
            }
        )

        // Relaunch into a blocked account with the helper holding the barrier.
        _ = RuntimeCleanup.adoptLaunchObservation(
            .confirmed(requiresProtectionRecovery: true),
            localIntent: true
        )
        session.state = .suspended
        // Already loaded, so the release never reloads the sign-in methods
        // through the default client, which would reach the production API.
        session.authMethods = TonoAuthMethodsResponse(
            email: TonoAuthMethod(enabled: false, clientId: nil),
            apple: TonoAuthMethod(enabled: false, clientId: nil),
            google: TonoAuthMethod(enabled: false, clientId: nil)
        )
        XCTAssertEqual(app.gateProtectionNotice, .blocking)

        // What the mounted gate reads; SwiftUI re-evaluates it only on a change here.
        let invalidated = ObservationFlag()
        withObservationTracking {
            _ = app.gateProtectionNotice
        } onChange: {
            invalidated.fired = true
        }

        // The menu bar's Restore internet for an account that is not ready.
        await session.restoreDirectInternet()

        XCTAssertFalse(KillSwitchService.isArmed)
        XCTAssertTrue(invalidated.fired, "the mounted gate was not told the barrier was released")
        XCTAssertNil(app.gateProtectionNotice)
        XCTAssertEqual(session.state, .suspended)
    }
}

nonisolated private final class ObservationFlag: @unchecked Sendable {
    var fired = false
}
