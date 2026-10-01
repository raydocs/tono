import CryptoKit
import XCTest
@testable import Tono

/// Every change these tests allow costs a Mihomo config reload, and a reload
/// severs every long-lived connection in the session — the customer-visible
/// "connection closed mid-response". So the contract under test is not "pins
/// are fresh", it is "pins change only when they must".
final class ManagedDirectPinStabilityTests: XCTestCase {
    func testOldPinResolutionCannotRestoreSuccessfullyRevokedPolicy() async throws {
        let storage = ConfigStorage.shared
        let cacheURL = storage.appSupportDirectory.appendingPathComponent("managed-traffic-policy.json")
        let savedCache = try? Data(contentsOf: cacheURL)
        let savedIPC = KillSwitchService.armIPC
        defer {
            KillSwitchService.armIPC = savedIPC
            if let savedCache { try? storage.writeSensitive(savedCache, to: cacheURL) }
            else { try? FileManager.default.removeItem(at: cacheURL) }
        }
        try? FileManager.default.removeItem(at: cacheURL)
        let app = AppState()
        app.isConnected = true
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.coreController = CoreControllerClient(port: 9)
        app.lastManagedDirectActivity = Date()
        app.managedTrafficPolicy = TonoTrafficPolicy(
            version: 3, domains: [.init(host: "api.weixin.qq.com", ports: [443])], mediaEndpoints: [],
            webDomains: [.init(host: "www.qq.com", ports: [443])]
        )
        let oldPlan = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0", domainPins: [],
            webDomainPins: [pin("www.qq.com", ["101.32.104.4"])],
            mediaEndpoints: [], nativeAppDirect: true
        )
        app.activeDirectPolicy = oldPlan
        let stalePlan = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0", domainPins: [],
            webDomainPins: [pin("www.qq.com", ["101.32.104.5"])],
            mediaEndpoints: [], nativeAppDirect: true
        )
        var pfArms = 0
        KillSwitchService.armIPC.prepare = { _ in
            pfArms += 1
            throw HelperIPCError.connectFailed // Contain an incorrectly scheduled stale reload.
        }
        let resolving = expectation(description: "old pin resolution suspended")
        var reply: CheckedContinuation<ConfigPipeline.ManagedDirectRuntimePolicy?, Never>?
        let refresh = Task {
            await app.refreshManagedDirectPins(resolver: { _, _, _ in
                await withCheckedContinuation { continuation in
                    reply = continuation
                    resolving.fulfill()
                }
            })
        }
        await fulfillment(of: [resolving], timeout: 5)
        let pendingReply = try XCTUnwrap(reply)
        // Complete the accepted revocation while the old DNS response is pending.
        var replacements = 0
        app.optionalPolicyPreparedRuntimeMutation = { desired in
            replacements += 1
            XCTAssertNil(desired)
        }
        let json = #"{"version":3,"domains":[],"mediaEndpoints":[]}"#
        let digest = Data(SHA256.hash(data: Data(json.utf8))).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
        do {
            try await app.installManagedTrafficPolicy(
                ManagedTrafficPolicyCache(revision: 3, json: json, sha256: digest, updatedAt: nil),
                persistCache: false, allowRuntimeTransition: true
            )
        } catch {
            pendingReply.resume(returning: nil)
            await refresh.value
            throw error
        }
        await app.connectionCoordinator.configReloadTask?.value
        XCTAssertEqual(replacements, 1)
        XCTAssertNil(app.activeDirectPolicy)

        pendingReply.resume(returning: stalePlan)
        await refresh.value
        let staleReload = app.connectionCoordinator.configReloadTask
        await staleReload?.value

        XCTAssertNil(staleReload, "old DNS answers cannot authorize another runtime replacement")
        XCTAssertEqual(pfArms, 0, "revoked DIRECT grants must never be re-armed")
        XCTAssertNil(app.activeDirectPolicy)
        XCTAssertTrue(app.isConnected)
    }

    private func policy(
        _ pins: [ConfigPipeline.DirectDomainPin]
    ) -> ConfigPipeline.ManagedDirectRuntimePolicy {
        ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: pins,
            webDomainPins: [],
            webDomainSuffixes: [],
            mediaEndpoints: [],
            tcpEndpoints: [],
            directResolverHosts: []
        )
    }

    private func pin(
        _ host: String,
        _ addresses: [String]
    ) -> ConfigPipeline.DirectDomainPin {
        .init(host: host, addresses: addresses, ports: [443])
    }

    /// The regression that made this necessary: a CDN answer overlapping the
    /// committed set by exactly one address counted as stale under the previous
    /// "fewer than two survivors" rule, so most pins were rewritten every cycle
    /// and the session reloaded every few minutes with nothing actually broken.
    func testSingleSurvivingAddressKeepsPinUnchanged() {
        let current = policy([pin("cdn.example.com", ["1.1.1.1", "2.2.2.2", "3.3.3.3"])])
        let resolved = policy([pin("cdn.example.com", ["3.3.3.3", "9.9.9.9", "8.8.8.8"])])
        XCTAssertNil(
            AppState.mergedManagedDirectPolicy(current: current, resolved: resolved),
            "one live address must be enough to leave a pin alone"
        )
    }

    func testFullyRotatedPinIsReplaced() {
        let current = policy([pin("cdn.example.com", ["1.1.1.1", "2.2.2.2"])])
        let resolved = policy([pin("cdn.example.com", ["9.9.9.9", "8.8.8.8"])])
        let merged = AppState.mergedManagedDirectPolicy(
            current: current,
            resolved: resolved
        )
        XCTAssertEqual(
            merged?.domainPins.first?.addresses,
            ["8.8.8.8", "9.9.9.9"],
            "a pin with nothing left alive is the case that genuinely needs replacing"
        )
    }

    func testUnresolvedHostKeepsItsLastKnownGoodPins() {
        let current = policy([pin("dead.example.com", ["1.1.1.1"])])
        XCTAssertNil(
            AppState.mergedManagedDirectPolicy(current: current, resolved: policy([])),
            "a host that failed to resolve must not lose its committed pins"
        )
    }

    func testNewHostIsAdopted() {
        let merged = AppState.mergedManagedDirectPolicy(
            current: policy([]),
            resolved: policy([pin("new.example.com", ["1.1.1.1"])])
        )
        XCTAssertEqual(merged?.domainPins.map(\.host), ["new.example.com"])
    }

    /// Stability must not be bought by ignoring answers forever: once a pin is
    /// replaced it adopts the fresh addresses, so a genuinely moved host still
    /// converges within one cycle.
    func testReplacementIsIdempotent() {
        let current = policy([pin("cdn.example.com", ["1.1.1.1"])])
        let resolved = policy([pin("cdn.example.com", ["9.9.9.9"])])
        guard let once = AppState.mergedManagedDirectPolicy(
            current: current,
            resolved: resolved
        ) else { return XCTFail("expected the fully rotated pin to be replaced") }
        XCTAssertNil(
            AppState.mergedManagedDirectPolicy(current: once, resolved: resolved),
            "a second identical answer must not produce another reload"
        )
    }
}
