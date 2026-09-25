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

        // Stale-snapshot case: the same never-armed internal transition
        // schedules a loop (snapshot false), but by the time the loop's next
        // attempt runs, an earlier attempt of that loop has armed PF and then
        // failed — the app now holds armed protection. A root emergency
        // release during the backoff (helper answers wanted=false) must be
        // accepted, not overridden by connect re-arming PF.
        app.isConnecting = true
        KillSwitchService.isArmed = false
        app.disconnect(releaseKillSwitch: false)
        app.scheduleProtectedReconnect(immediate: true)
        KillSwitchService.isArmed = true
        let staleSnapshotLoop = app.connectionCoordinator.protectedReconnectTask
        // Bound the wait: a loop that ignores the release keeps retrying.
        let watchdog = Task {
            try? await Task.sleep(for: .seconds(10))
            staleSnapshotLoop?.cancel()
        }
        await staleSnapshotLoop?.value
        watchdog.cancel()

        XCTAssertFalse(
            KillSwitchService.isArmed,
            "a confirmed external release while armed must be accepted"
        )
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertNil(
            app.lastConnectionFailure,
            "accepting the release ends the loop before connect can re-arm PF"
        )
        XCTAssertNil(app.errorMessage)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }

    /// X1-3: a helper that answers 403 pauses automatic retries and asks the
    /// user to choose Repair and reconnect. That explicit loop must reach
    /// connect(), whose helper preparation is the administrator reinstall,
    /// instead of re-pausing on the same rejection before connect runs.
    func testRepairAndReconnectReachesConnectWhenHelperRejectsThisApp() async {
        let app = AppState()
        // Same fast, pre-helper connect failure as above: the attempt is on
        // the record without touching the privileged helper or core.
        var catalogNode = Fixture.realityNode()
        catalogNode.uuid = nil
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [catalogNode]
            )
        ]
        KillSwitchService.isArmed = true
        app.isProtectionBlocked = true
        app.protectedReconnectPausedForUserAction = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .rejected }
        app.networkProtection = runtime
        defer {
            KillSwitchService.isArmed = false
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
        }

        app.retryProtectedConnectionNow()
        let loop = app.connectionCoordinator.protectedReconnectTask
        let watchdog = Task {
            try? await Task.sleep(for: .seconds(15))
            loop?.cancel()
        }
        await loop?.value
        watchdog.cancel()

        XCTAssertNotNil(
            app.lastConnectionFailure,
            "Repair and reconnect must reach connect() despite the rejection"
        )
        XCTAssertTrue(
            app.protectedReconnectPausedForUserAction,
            "the automatic attempt after the repair still pauses on a rejection"
        )
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }

    /// #585: a saved pinned-certificate hy2 selection is refused in prepare
    /// (the bundled sing-box cannot authenticate the pin). That refusal must
    /// count toward the three-strike pause; before, Protected Offline retried
    /// it every 30 s forever. PF stays armed through the pause.
    func testProtectedReconnectPausesWhenPrepareKeepsRefusingTheSelectedExit() async {
        let app = AppState()
        app.proxyRegions = [
            ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [Fixture.realityNode(), Fixture.hy2Node()]
            )
        ]
        XCTAssertNotNil(ConfigPipeline.singBoxUnavailableReason(Fixture.hy2Node()))
        AppProfile.defaults.set(
            Fixture.hy2Node().name,
            forKey: SettingsKey.selectedProxyTargetName
        )
        KillSwitchService.isArmed = true
        app.isProtectionBlocked = true
        var runtime = NetworkProtectionOperations()
        runtime.refreshKillSwitchStatus = {
            .confirmed(requiresProtectionRecovery: true)
        }
        app.networkProtection = runtime
        defer {
            KillSwitchService.isArmed = false
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
        }

        app.retryProtectedConnectionNow()
        let loop = app.connectionCoordinator.protectedReconnectTask
        // Three attempts take 0 + 2 + 5 s; a loop that never pauses runs on.
        let watchdog = Task {
            try? await Task.sleep(for: .seconds(20))
            loop?.cancel()
        }
        await loop?.value
        watchdog.cancel()

        XCTAssertTrue(
            app.protectedReconnectPausedForUserAction,
            "a prepare refusal that repeats must pause the protected reconnect loop"
        )
        XCTAssertTrue(KillSwitchService.isArmed, "the pause keeps PF")
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertFalse(app.isConnecting)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
    }
}
