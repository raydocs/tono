import CryptoKit
import XCTest
@testable import Tono

/// A background policy apply that throws must not leave a whole-machine
/// block. Non-strict recovery restores ordinary internet with the existing
/// selective AI release and does not schedule a protected reconnect. XCTest cannot drive the resolver,
/// the privileged helper, or sing-box; `optionalPolicyRuntimeMutation` stands
/// in for that replacement.
final class OptionalPolicyTests: XCTestCase {

    func testBusyPolicyReplacementCoalescesTheLatestAcceptedRevocation() async throws {
        let storage = ConfigStorage.shared
        let url = storage.appSupportDirectory.appendingPathComponent("managed-traffic-policy.json")
        let saved = try? Data(contentsOf: url)
        defer {
            if let saved { try? storage.writeSensitive(saved, to: url) }
            else { try? FileManager.default.removeItem(at: url) }
        }
        try? FileManager.default.removeItem(at: url)
        let app = AppState()
        app.isConnected = true
        app.coreController = CoreControllerClient()
        app.activeDirectPolicy = try app.initialDirectPolicy(
            physicalInterface: "en0",
            policy: TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
                directSuffixes: [.init(host: "example.net", ports: [443])], trusted: true)
        )
        app.managedTrafficPolicy = TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
            directSuffixes: [.init(host: "example.org", ports: [443])], trusted: true)
        let entered = expectation(description: "first policy owns runtime replacement")
        var resume: CheckedContinuation<Void, Never>?
        defer { resume?.resume() }
        var replacements: [ConfigPipeline.ManagedDirectRuntimePolicy?] = []
        app.optionalPolicyPreparedRuntimeMutation = { desired in
            replacements.append(desired)
            if replacements.count == 1 {
                await withCheckedContinuation { continuation in
                    resume = continuation
                    entered.fulfill()
                }
            }
        }
        app.scheduleBackgroundOptionalPolicy()
        let first = app.connectionCoordinator.configReloadTask
        await fulfillment(of: [entered], timeout: 2)
        // A pin refresh derived from the old authorization must not run after
        // the accepted full-policy replacement.
        app.pendingDirectPolicyReload = app.activeDirectPolicy
        for (revision, json) in [
            (40, #"{"version":3,"domains":[{"host":"qq.com","ports":[443]}],"mediaEndpoints":[]}"#),
            (41, #"{"version":3,"domains":[],"mediaEndpoints":[]}"#),
        ] {
            let digest = Data(SHA256.hash(data: Data(json.utf8))).base64EncodedString()
                .replacingOccurrences(of: "=", with: "")
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
            try await app.installManagedTrafficPolicy(
                ManagedTrafficPolicyCache(revision: revision, json: json, sha256: digest, updatedAt: nil),
                persistCache: false, allowRuntimeTransition: true
            )
        }
        // Always release the real owner before assertions, including on the
        // original implementation, so a failing test cannot strand its task.
        let stalePinsRetained = app.pendingDirectPolicyReload != nil
        app.pendingDirectPolicyReload = nil
        let continuation = resume
        resume = nil
        continuation?.resume()
        await first?.value
        await app.connectionCoordinator.configReloadTask?.value
        XCTAssertEqual(replacements.count, 2, "the latest accepted document must drain after the busy owner")
        XCTAssertNil(replacements.last ?? nil, "coalescing must skip the intermediate policy and apply the revocation")
        XCTAssertNil(app.activeDirectPolicy)
        XCTAssertFalse(stalePinsRetained, "an accepted document must retire older queued pins")
        XCTAssertTrue(app.isConnected)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
    }

    /// MAC-OPTIONAL-POLICY-FAIL-CLOSED: a failure before /core/sync (resolver
    /// arm, writeRuntimeConfig on a full disk) has not touched the running
    /// Core, so the optional overlay must not tear the working session down.
    /// The runtime-mutation seam replaces the whole operation (it models a
    /// failure after replacement started), so check the production decision
    /// at the writeRuntimeConfig → /core/sync boundary directly.
    func testOptionalPolicyFailureBeforeReplacementKeepsSession() {
        XCTAssertEqual(
            AppState.optionalPolicyFailureAction(replacementStarted: false),
            .keepSession
        )
        XCTAssertEqual(
            AppState.optionalPolicyFailureAction(replacementStarted: true),
            .teardown
        )
    }

    func testBackgroundPolicyFailureRestoresTheOriginalNetwork() async {
        let savedArmed = KillSwitchService.isArmed
        let savedUpdateBlock = RuntimeCleanup.nativeUpdateBlocksConnect
        let savedUpdatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        let app = AppState()
        // Post-connect: onCoreStarted has already published connected and the
        // session's PF arm is live. The mutation seam marks replacement as
        // started, so this failure releases the original network.
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
        var aiHold = false
        var explicitDisarms = 0
        runtime.disarm = { explicitDisarms += 1; aiHold = false }
        runtime.releaseAfterFailure = { aiHold = true; KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        defer {
            KillSwitchService.isArmed = savedArmed
            RuntimeCleanup.nativeUpdateBlocksConnect = savedUpdateBlock
            RuntimeCleanup.nativeUpdatePending = savedUpdatePending
        }

        app.scheduleBackgroundOptionalPolicy()
        let mutation = app.connectionCoordinator.configReloadTask
        await mutation?.value
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertFalse(app.isConnected)
        XCTAssertTrue(aiHold, "optional replacement failure must retain the AI floor")
        XCTAssertEqual(explicitDisarms, 0)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertFalse(app.isProtectedReconnectScheduled)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertEqual(
            app.errorMessage,
            String(localized: "Secure app routing could not be applied. This Mac is back on its normal internet.")
        )
        app.connectionCoordinator.cancelReconnectTasks()
    }

    /// #1238: a catalog that removed the selected exit queues its switch
    /// behind a busy optional-policy owner. The removed exit has no endpoint
    /// left to arm and the Core still dials it, so that owner must leave PF
    /// alone and let the switch go first.
    func testOptionalPolicyOwnerLeavesPFAloneWhileTheSelectedExitIsRemoved() async throws {
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        let armed = KillSwitchService.isArmed
        let delayWasProven = SingBoxDelayGate.isProven
        let savedIPC = KillSwitchService.armIPC
        let updateBlocked = RuntimeCleanup.nativeUpdateBlocksConnect
        let updatePending = RuntimeCleanup.nativeUpdatePending
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdatePending = false
        let app = AppState()
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.releaseAfterFailure = { KillSwitchService.isArmed = false }
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        let removed = Fixture.realityNode(name: "US-Removed", id: "us-removed")
        let survivor = Fixture.realityNode(name: "JP-Survivor", id: "jp-survivor", server: "203.0.114.9")
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [removed, survivor])]
        _ = app.applyProxySelection(removed.name)
        app.isConnected = true
        app.coreController = CoreControllerClient()
        app.activeDirectPolicy = try app.initialDirectPolicy(
            physicalInterface: "en0",
            policy: TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
                directSuffixes: [.init(host: "example.net", ports: [443])], trusted: true)
        )
        app.managedTrafficPolicy = TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
            directSuffixes: [.init(host: "example.org", ports: [443])], trusted: true)
        var arms = 0
        // The owner arms with a prepared helper; the survivor switch behind it
        // prepares first, so refusing preparation ends this test at the switch.
        KillSwitchService.armIPC.prepare = { _ in throw HelperIPCError.connectFailed }
        KillSwitchService.armIPC.deliver = { _ in
            arms += 1
            return (true, true, true, false, false, 0)
        }
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = armed
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
            RuntimeCleanup.nativeUpdateBlocksConnect = updateBlocked
            RuntimeCleanup.nativeUpdatePending = updatePending
            app.connectionCoordinator.cancelReconnectTasks()
            if delayWasProven { SingBoxDelayGate.prove() }
            else { SingBoxDelayGate.suspend() }
        }
        KillSwitchService.isArmed = true
        app.scheduleBackgroundOptionalPolicy()
        let owner = app.connectionCoordinator.configReloadTask
        // Model the accepted catalog before the scheduled owner starts: it
        // found the owner busy and queued the removal.
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [survivor])]
        app.pendingRemovedCatalogExit = true
        await owner?.value
        await app.connectionCoordinator.nodeSwitchTask?.value
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertEqual(arms, 0, "the owner must not arm PF without the exit the Core still dials")
    }

    /// #1238: an apply that fails before /core/sync keeps the session, but the
    /// accepted document is still not the one in force. It is tried again,
    /// twice, so a revoked grant does not outlive a transient failure.
    func testOptionalPolicyFailureBeforeReplacementIsTriedAgain() async throws {
        let armed = KillSwitchService.isArmed
        let savedIPC = KillSwitchService.armIPC
        let app = AppState()
        app.isConnected = true
        app.coreController = CoreControllerClient()
        app.activeDirectPolicy = try app.initialDirectPolicy(
            physicalInterface: "en0",
            policy: TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
                directSuffixes: [.init(host: "example.net", ports: [443])], trusted: true)
        )
        app.managedTrafficPolicy = TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
            directSuffixes: [.init(host: "example.org", ports: [443])], trusted: true)
        var arms = 0
        // Every apply's first arm fails; the arm that restores the session's
        // own exceptions after it succeeds.
        KillSwitchService.armIPC.status = { (true, true, true, false) }
        KillSwitchService.armIPC.deliver = { _ in
            arms += 1
            guard arms.isMultiple(of: 2) else { throw HelperIPCError.connectFailed }
            return (true, true, true, false, false, 0)
        }
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.isArmed = armed
        }
        KillSwitchService.isArmed = true
        app.scheduleBackgroundOptionalPolicy()
        while let owner = app.connectionCoordinator.configReloadTask {
            await owner.value
        }
        XCTAssertEqual(arms, 6, "one apply and two retries, each restoring the session's exceptions")
        XCTAssertTrue(app.isConnected)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
    }

    func testAcceptedEmptyPolicyClearsTheLiveDirectPlanWithoutDisconnect() async throws {
        let storage = ConfigStorage.shared
        let url = storage.appSupportDirectory.appendingPathComponent("managed-traffic-policy.json")
        let saved = try? Data(contentsOf: url)
        defer {
            if let saved { try? storage.writeSensitive(saved, to: url) }
            else { try? FileManager.default.removeItem(at: url) }
        }
        try? FileManager.default.removeItem(at: url)
        let app = AppState()
        app.isConnected = true
        app.coreController = CoreControllerClient()
        app.activeDirectPolicy = try app.initialDirectPolicy(
            physicalInterface: "en0",
            policy: TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
                directSuffixes: [.init(host: "example.net", ports: [443])], trusted: true)
        )
        XCTAssertNotNil(app.activeDirectPolicy)
        var replacements = 0
        app.optionalPolicyPreparedRuntimeMutation = { desired in
            replacements += 1
            XCTAssertNil(desired, "an empty accepted policy must replace the old plan with no DIRECT grants")
        }
        let json = #"{"version":3,"domains":[],"mediaEndpoints":[]}"#
        let digest = Data(SHA256.hash(data: Data(json.utf8))).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
        try await app.installManagedTrafficPolicy(
            ManagedTrafficPolicyCache(revision: 3, json: json, sha256: digest, updatedAt: nil),
            persistCache: false, allowRuntimeTransition: true
        )
        await app.connectionCoordinator.configReloadTask?.value
        XCTAssertEqual(replacements, 1)
        XCTAssertNil(app.activeDirectPolicy)
        XCTAssertTrue(app.isConnected)
        XCTAssertNil(app.connectionCoordinator.disconnectSequence)
    }

    func testOptionalPolicyPreparationReplacesSuffixAndNativeAuthority() async throws {
        let app = AppState()
        let old = try XCTUnwrap(app.initialDirectPolicy(
            physicalInterface: "en0",
            policy: TonoTrafficPolicy(version: 3,
                domains: [.init(host: "example.com", ports: [443])], mediaEndpoints: [],
                directSuffixes: [.init(host: "example.net", ports: [443])], trusted: true)
        ))
        let next = TonoTrafficPolicy(version: 3, domains: [], mediaEndpoints: [],
            directSuffixes: [.init(host: "example.org", ports: [443])], trusted: true)
        let prepared = try await app.prepareOptionalDirectPolicy(
            policy: next, base: old, api: CoreControllerClient()
        )
        let desired = try XCTUnwrap(prepared)
        XCTAssertEqual(desired.physicalInterface, "en0")
        XCTAssertEqual(desired.webDomainSuffixes.map(\.host), ["example.org"])
        XCTAssertFalse(desired.nativeAppDirect)
        let node = Fixture.realityNode()
        var overlay = Fixture.overlay(selectedNodeName: node.name, tunEnabled: true,
            externalController: "127.0.0.1:29191")
        overlay.secret = String(repeating: "a", count: 64)
        let runtime = try ConfigPipeline.buildSingBoxRuntime(overlay: overlay, nodes: [node], directPlan: desired)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: runtime.runtimeJSON) as? [String: Any])
        let rules = try XCTUnwrap((json["route"] as? [String: Any])?["rules"] as? [[String: Any]])
        XCTAssertFalse(rules.contains { ($0["domain_suffix"] as? [String])?.contains("example.net") == true })
        XCTAssertFalse(rules.contains { $0["outbound"] as? String == ConfigPipeline.appDirectGroupName })
        XCTAssertTrue(rules.contains { ($0["domain_suffix"] as? [String])?.contains("example.org") == true })
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
