import CryptoKit
import XCTest
@testable import Tono

/// A background policy apply that throws must not leave a whole-machine
/// block. Non-strict macOS has no `permanent` switch and the selective AI
/// hook is not registered, so the catch restores the original network and
/// does not schedule a protected reconnect. XCTest cannot drive the resolver,
/// the privileged helper, or sing-box; `optionalPolicyRuntimeMutation` stands
/// in for that replacement.
final class OptionalPolicyTests: XCTestCase {

    func testBackgroundPolicyFailureRestoresTheOriginalNetwork() async {
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

        XCTAssertFalse(app.isConnected)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertEqual(
            app.errorMessage,
            String(localized: "Secure app routing could not be applied. This Mac is back on its normal internet.")
        )
        app.connectionCoordinator.cancelReconnectTasks()
    }

    func testConnectedPolicyUpdateKeepsTheSession() async throws {
        let storage = ConfigStorage.shared
        let url = storage.appSupportDirectory.appendingPathComponent(
            "managed-traffic-policy.json"
        )
        let saved = try? Data(contentsOf: url)
        defer {
            if let saved { try? storage.writeSensitive(saved, to: url) }
            else { try? FileManager.default.removeItem(at: url) }
        }
        try? FileManager.default.removeItem(at: url)

        let app = AppState()
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        app.isConnected = true
        app.coreController = nil

        let json = #"{"version":2,"domains":[],"mediaEndpoints":[]}"#
        let digest = Data(SHA256.hash(data: Data(json.utf8))).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
        try await app.installManagedTrafficPolicy(
            ManagedTrafficPolicyCache(
                revision: 2,
                json: json,
                sha256: digest,
                updatedAt: nil
            ),
            persistCache: false,
            allowRuntimeTransition: true
        )

        XCTAssertTrue(app.isConnected)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
        XCTAssertEqual(app.managedTrafficPolicy.version, 2)
        XCTAssertEqual(
            app.errorMessage,
            String(localized: "Secure app routing was updated. Tono is applying it on this connection.")
        )
    }
}
