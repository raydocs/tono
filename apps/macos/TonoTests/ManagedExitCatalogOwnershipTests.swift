import XCTest
@testable import Tono

/// The managed catalog's body is issued per account — the control plane writes
/// each user's own client identity into the exits it publishes — while its
/// revision is a fleet-wide counter. Ownership, not the revision, is therefore
/// the only thing keeping one account's exits out of the next account's
/// session, which is what a shared Mac depends on.
///
/// The binding is process-global and `adopt`/`purge` reach `ConfigStorage`, so
/// every test here ends signed out — the one resting state that refuses
/// everything — and running them removes this machine's cached catalog file
/// and runtime config.
/// Nothing else in this target installs a catalog, and the app refetches on the
/// next signed-in launch.
@MainActor
final class ManagedExitCatalogOwnershipTests: XCTestCase {
    private func cache(owner: String?) -> ManagedExitCatalogCache {
        ManagedExitCatalogCache(
            revision: 7,
            yaml: "proxies: []",
            sha256: "digest",
            updatedAt: nil,
            routing: nil,
            owner: owner
        )
    }

    func testACacheWrittenBeforeOwnersWereRecordedStillDecodes() throws {
        let legacy = Data(#"{"revision":7,"yaml":"proxies: []","sha256":"digest"}"#.utf8)
        let decoded = try JSONDecoder().decode(
            ManagedExitCatalogCache.self,
            from: legacy
        )
        XCTAssertEqual(decoded.revision, 7)
        XCTAssertNil(decoded.owner, "an absent owner must load, not fail to decode")
    }

    func testTheOwnerSurvivesAnEncodeDecodeRound() throws {
        let data = try JSONEncoder().encode(cache(owner: "user-a"))
        let decoded = try JSONDecoder().decode(
            ManagedExitCatalogCache.self,
            from: data
        )
        XCTAssertEqual(decoded.owner, "user-a")
    }

    func testSignInDiscardsACatalogIssuedToAnotherAccount() {
        var discarded = 0
        ManagedExitCatalogOwnership.recordInstalled(owner: "user-a") {
            discarded += 1
        }
        ManagedExitCatalogOwnership.adopt("user-b")
        XCTAssertEqual(
            discarded, 1,
            "user-a's exits must not still be selectable in user-b's session"
        )
        XCTAssertFalse(
            ManagedExitCatalogOwnership.accepts("user-a"),
            "user-a's catalog must not install once user-b is signed in"
        )
        XCTAssertTrue(ManagedExitCatalogOwnership.accepts("user-b"))
        XCTAssertEqual(ManagedExitCatalogOwnership.currentAccount, "user-b")
        ManagedExitCatalogOwnership.purge()
    }

    func testSignInKeepsTheSameAccountsCachedCatalog() {
        var discarded = 0
        ManagedExitCatalogOwnership.recordInstalled(owner: "user-a") {
            discarded += 1
        }
        ManagedExitCatalogOwnership.adopt("user-a")
        XCTAssertEqual(
            discarded, 0,
            "a fail-closed launch must keep its own last verified cache"
        )
        ManagedExitCatalogOwnership.purge()
    }

    func testACatalogWithNoRecordedOwnerIsDiscardedOnSignIn() {
        var discarded = 0
        ManagedExitCatalogOwnership.recordInstalled(owner: nil) {
            discarded += 1
        }
        ManagedExitCatalogOwnership.adopt("user-a")
        XCTAssertEqual(
            discarded, 1,
            "a cache whose account cannot be established belongs to nobody"
        )
        ManagedExitCatalogOwnership.purge()
    }

    func testSignOutRefusesEveryCatalogUntilAnAccountIsKnown() {
        var discarded = 0
        ManagedExitCatalogOwnership.recordInstalled(owner: "user-a") {
            discarded += 1
        }
        ManagedExitCatalogOwnership.purge()
        XCTAssertEqual(discarded, 1)
        XCTAssertNil(ManagedExitCatalogOwnership.currentAccount)
        // A refresh already in flight when the user signed out must not land.
        XCTAssertFalse(ManagedExitCatalogOwnership.accepts("user-a"))
        XCTAssertFalse(ManagedExitCatalogOwnership.accepts(nil))
    }

    func testSignOutRemovesTheRuntimeBuiltFromTheAccountsCatalog() throws {
        let runtime = ConfigStorage.shared.runtimeConfigPath
        try FileManager.default.createDirectory(
            at: runtime.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data(#"{"outbounds":[{"type":"socks","password":"account-a-secret"}]}"#.utf8)
            .write(to: runtime)
        ManagedExitCatalogOwnership.purge()
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: runtime.path),
            "the signed-out account's residential credentials must not stay on disk"
        )
    }

    /// #582 M3: Ready on an offline grant that matches the catalog in memory,
    /// then the server refuses a request of this session: Connect is refused
    /// at once, before any connect state changes.
    func testOfflineConnectIsRefusedAsSoonAsTheServerRevokesTheSession() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-offline-m3-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let gate = OfflineGrantGate(directory: directory)
        let installed = InstalledCatalogDigests(catalogSha256: "catalog-a", routingSha256: "routing-a")
        XCTAssertTrue(gate.writeGrant(OfflineGrant(
            accountId: "user-a",
            tokenSha256: OfflineGrantGate.tokenDigest("session-a"),
            catalogSha256: installed.catalogSha256,
            routingSha256: installed.routingSha256,
            verifiedAt: 1_000
        )))
        let app = AppState()
        KillSwitchService.isArmed = false
        // Were Connect admitted, this exit (no uuid) fails before any helper
        // preparation or PF arm, and the teardown below meets only stubs.
        var catalogNode = Fixture.realityNode()
        catalogNode.uuid = nil
        app.proxyRegions = [
            ProxyRegion(id: AppState.managedCatalogRegionID, name: "TONO CLOUD", nodes: [catalogNode])
        ]
        app.managedCatalogDigest = installed.catalogSha256
        app.managedCatalogRoutingToken = installed.routingSha256
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        app.accountConnectRefusal = { gate.connectRefusal(catalogDigest: $0, routingToken: $1) }
        defer {
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
            try? FileManager.default.removeItem(at: directory)
        }
        let admission = gate.admit(tokenSha256: OfflineGrantGate.tokenDigest("session-a"), installed: installed)
        let generation = app.connectionCoordinator.protectionOperationGeneration

        gate.report(.forbidden, readScope: 0)
        app.connect()

        XCTAssertFalse(app.isConnecting, "a server refusal must block Connect before the UI catches up")
        XCTAssertNotNil(app.errorMessage)
        XCTAssertEqual(
            app.errorMessage,
            gate.connectRefusal(catalogDigest: installed.catalogSha256, routingToken: installed.routingSha256),
            "the account gate refused it, not a missing exit"
        )
        XCTAssertEqual(app.connectionCoordinator.protectionOperationGeneration, generation, "refused before any connect state changed")
        // Checked last so that old code fails on the refusal itself.
        XCTAssertEqual(admission, .admitted(verifiedAt: Date(timeIntervalSince1970: 1)))
        await app.connectionCoordinator.connectTask?.value
        await app.finishPendingDisconnect()
    }

    func testAnEntitlementFailureIsNotReportedAsAnExpiredSession() {
        let blocked = TonoAPIClient.APIError.entitlementBlocked(
            code: "ACCOUNT_EXPIRED",
            message: "Session is no longer active"
        )
        XCTAssertNotEqual(blocked, .unauthorized)
        XCTAssertNotEqual(
            blocked.errorDescription,
            TonoAPIClient.APIError.unauthorized.errorDescription,
            "expiry must not be presented as an expired sign-in session"
        )
        XCTAssertNotEqual(
            blocked.errorDescription,
            TonoAPIClient.APIError.entitlementBlocked(
                code: "QUOTA_EXCEEDED", message: nil
            ).errorDescription,
            "expiry and an exhausted allowance are different answers"
        )
    }
}
