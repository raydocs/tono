import XCTest
@testable import Tono

/// R1-F3 regression: an internal transition that tears a session down before
/// the first PF arm (a managed traffic-policy update landing mid-connect, the
/// wake path handing a disarmed host to the persistent loop) still publishes
/// `isProtectionBlocked`, and a helper that was never asked to arm answers
/// status with no persisted state (armed=false / wanted=false). The protected
/// reconnect loop must not read that as a root emergency release: accepting it
/// cancelled the loop, cleared the error, and silently dropped the user's
/// Connect intent with a terminal idle state and no retry. XCTest cannot
/// drive the privileged helper; the `refreshKillSwitchStatus` seam stands in
/// for the status IPC, exactly as the disconnect-owner tests replace the rest
/// of `NetworkProtectionOperations`.
final class ProtectedReconnectTests: XCTestCase {

    func testInternalTransitionReconnectDoesNotTreatNeverArmedHelperAsExternalRelease() async {
        let app = AppState()
        // Mid-connect: the connect task sits before the first arm, so PF was
        // never armed and the preserve teardown's restrictToBootstrap no-ops.
        app.isConnecting = true
        KillSwitchService.isArmed = false
        // One catalog exit that passes selection but fails owned-node
        // validation (no uuid), so the loop's connect attempt fails fast and
        // deterministically — before any privileged helper or core work — and
        // its pre-arm release teardown ends the loop the same way a real
        // first-connect failure would.
        var catalogNode = Fixture.realityNode()
        catalogNode.uuid = nil
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [catalogNode]
            )
        ]
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        // The helper holds no persisted kill-switch state for this session:
        // an authenticated status answers armed=false / wanted=false. Reading
        // that as "root released our PF" is exactly the misjudgment.
        runtime.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: false)
        }
        app.networkProtection = runtime
        // connect() retargets to the catalog default and persists it.
        defer {
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
        }

        // The internal-transition sequence from installManagedTrafficPolicy:
        // preserve teardown, then an immediate protected reconnect.
        app.disconnect(releaseKillSwitch: false)
        app.scheduleProtectedReconnect(immediate: true)
        let loop = app.connectionCoordinator.protectedReconnectTask
        await loop?.value

        // The loop ended through its connect attempt failing pre-arm and
        // releasing — not through an external-release acceptance, which
        // leaves no failure record and no error message behind. A real
        // connect attempt ran and its user-facing outcome survived.
        XCTAssertNotNil(
            app.lastConnectionFailure,
            "the loop must attempt a connect, so its failure is on the record"
        )
        XCTAssertNotNil(
            app.errorMessage,
            "the attempt's failure message must survive instead of being cleared by a phantom external release"
        )
        XCTAssertFalse(app.isConnecting)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }
}
