import XCTest
@testable import Tono

/// R1-F4 regression: every connect parks a background optional-policy runtime
/// replacement behind the shared config-reload handle (arm → writeRuntimeConfig
/// → helper /core/sync → reload → TUN verify). When any step throws, the catch
/// tears the session down fail-closed via disconnect(releaseKillSwitch: false)
/// — and then stopped: PF stayed armed bootstrap-only, protection stayed
/// blocked, and no protected reconnect was scheduled. On a stable network no
/// kick ever follows, so the host sat in Protected Offline indefinitely, the
/// stranded state the wake path explicitly avoids. Every sibling fail-closed
/// failure branch (reloadCoreConfig, recoverFailedNodeSwitch, the monitor and
/// wake paths) schedules the loop. XCTest cannot drive the resolver, the
/// privileged helper, or sing-box; the `optionalPolicyRuntimeMutation` seam
/// stands in for that whole runtime replacement, exactly as the monitor tests
/// replace `tunInterfaceExists` and the disconnect-owner tests replace
/// `NetworkProtectionOperations`.
final class OptionalPolicyTests: XCTestCase {

    func testBackgroundPolicyFailureSchedulesProtectedReconnect() async {
        let app = AppState()
        // Post-connect: onCoreStarted has already published connected and the
        // session's PF arm is live — the state the catch's preserve teardown
        // and the scheduling snapshot in scheduleProtectedReconnect inherit.
        app.isConnected = true
        KillSwitchService.isArmed = true
        // Admission requires a core controller handle and a policy with at
        // least one managed domain.
        app.coreController = CoreControllerClient()
        app.managedTrafficPolicy = TonoTrafficPolicy(
            version: 1,
            domains: [TonoTrafficPolicyDomain(host: "example.com", ports: [443])],
            mediaEndpoints: []
        )
        // The failure under test: any step of the runtime replacement throws
        // (helper /core/sync timeout, config check failure, TUN probe lost).
        app.optionalPolicyRuntimeMutation = {
            throw CoreControllerError.protectionFailed(
                "sing-box replacement failed TUN verification"
            )
        }
        // The catch's disconnect tears the session down through the same
        // serialized teardown the disconnect-owner tests drive; replace the
        // privileged helper I/O so it completes without the helper.
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        defer {
            KillSwitchService.isArmed = false
        }

        app.scheduleBackgroundOptionalPolicy()
        let mutation = app.connectionCoordinator.configReloadTask
        await mutation?.value
        await app.connectionCoordinator.disconnectSequence?.value

        // The host is parked fail-closed, exactly as before the fix…
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertNotNil(app.errorMessage)
        // …but the persistent reconnect loop now owns the recovery instead of
        // waiting for a network-change kick a stable network never sends.
        // Before the fix both assertions failed: no loop was ever scheduled.
        XCTAssertTrue(app.isProtectedReconnectScheduled)
        XCTAssertNotNil(app.connectionCoordinator.protectedReconnectTask)

        // Leave no sleeping loop behind for later tests. The loop never
        // disarms, so cancelling it here cannot loosen protection.
        let loop = app.connectionCoordinator.protectedReconnectTask
        app.connectionCoordinator.cancelReconnectTasks()
        await loop?.value
    }
}
