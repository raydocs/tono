import XCTest
@testable import Tono

/// A17: same-node hy2 after repeated Reality connect failures, only when the
/// exit catalog's `hy2AutoSwitch` permits it.
@MainActor
final class Hy2AutoSwitchTests: XCTestCase {
    private let owner = "account-a"

    private func usableHy2(_ name: String, id: String) -> ProxyNode {
        var node = Fixture.hy2Node(name: name, id: id)
        node.certificatePublicKeySHA256 = Data(repeating: 7, count: 32).base64EncodedString()
        return node
    }

    /// Reality block first. Another node's hy2 sorts before this node's twin.
    private func catalog() -> [ProxyNode] {
        [
            Fixture.realityNode(name: "Buffalo · Niagara", id: "niagara"),
            usableHy2("Albany · Pine · hy2", id: "pine-hy2"),
            usableHy2("Buffalo · Niagara · hy2", id: "niagara-hy2"),
        ]
    }

    private func isolatedDefaults() throws -> (UserDefaults, String) {
        let suite = "tono-hy2-auto-\(UUID().uuidString)"
        return (try XCTUnwrap(UserDefaults(suiteName: suite)), suite)
    }

    private func failReality(_ policy: Hy2AutoSwitch, _ nodes: [ProxyNode], now: Date) {
        for _ in 0..<Hy2AutoSwitch.tcpFailureThreshold {
            XCTAssertNil(policy.beginAttempt(selected: nodes[0], catalog: nodes, owner: owner, now: now))
            policy.noteConnectFailure(dialed: nodes[0].name, code: .coreExitUnreachable, now: now)
        }
    }

    func testThreeRealityFailuresDialTheSameNodesHy2OnlyWhenTheCatalogPermits() throws {
        let nodes = catalog()
        let now = Date(timeIntervalSinceReferenceDate: 800_000_000)

        let (permittedDefaults, permittedSuite) = try isolatedDefaults()
        let (refusedDefaults, refusedSuite) = try isolatedDefaults()
        defer {
            permittedDefaults.removePersistentDomain(forName: permittedSuite)
            refusedDefaults.removePersistentDomain(forName: refusedSuite)
        }
        let permitted = Hy2AutoSwitch(defaults: permittedDefaults)
        permitted.applyCatalogPermission(true, owner: owner, catalog: nodes)
        failReality(permitted, nodes, now: now)
        let dial = try XCTUnwrap(permitted.beginAttempt(selected: nodes[0], catalog: nodes, owner: owner, now: now))
        XCTAssertEqual(dial.tcp, "Buffalo · Niagara")
        XCTAssertEqual(dial.hy2, "Buffalo · Niagara · hy2", "same node and identity, never another node's hy2")
        XCTAssertEqual(permitted.persistedTarget(for: dial.hy2), "Buffalo · Niagara", "the saved choice stays Reality")
        permitted.noteConnectFailure(dialed: dial.hy2, code: .coreExitUnreachable, now: now)
        permitted.noteConnected(dialed: dial.tcp, now: now)
        failReality(permitted, nodes, now: now)
        XCTAssertNil(
            permitted.beginAttempt(selected: nodes[0], catalog: nodes, owner: owner, now: now.addingTimeInterval(60)),
            "the block after a failed automatic hy2 attempt survives a Reality success"
        )

        let refused = Hy2AutoSwitch(defaults: refusedDefaults)
        refused.applyCatalogPermission(false, owner: owner, catalog: nodes)
        failReality(refused, nodes, now: now)
        XCTAssertNil(
            refused.beginAttempt(selected: nodes[0], catalog: nodes, owner: owner, now: now),
            "hy2AutoSwitch false (or missing) stays on Reality"
        )
    }

    func testRememberedHy2NeedsAFreshPermissionExpiresAndClearsWithItsBlock() throws {
        let (defaults, suite) = try isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let nodes = catalog()
        let now = Date(timeIntervalSinceReferenceDate: 800_000_000)
        let first = Hy2AutoSwitch(defaults: defaults)
        first.applyCatalogPermission(true, owner: owner, catalog: nodes)
        failReality(first, nodes, now: now)
        let dial = try XCTUnwrap(first.beginAttempt(selected: nodes[0], catalog: nodes, owner: owner, now: now))
        first.noteConnected(dialed: dial.hy2, now: now)

        let relaunched = Hy2AutoSwitch(defaults: defaults)
        let later = now.addingTimeInterval(60)
        XCTAssertNil(
            relaunched.beginAttempt(selected: nodes[0], catalog: nodes, owner: owner, now: later),
            "persisted memory is not a permission; a fresh exit-catalog 200 is"
        )
        relaunched.applyCatalogPermission(true, owner: owner, catalog: nodes)
        let again = try XCTUnwrap(relaunched.beginAttempt(selected: nodes[0], catalog: nodes, owner: owner, now: later))
        XCTAssertTrue(again.remembered)
        relaunched.noteConnected(dialed: again.hy2, now: later)
        XCTAssertEqual(
            try XCTUnwrap(relaunched.rememberedUntil(dial.tcp)).timeIntervalSinceReferenceDate,
            now.addingTimeInterval(Hy2AutoSwitch.rememberFor).timeIntervalSinceReferenceDate,
            accuracy: 0.001,
            "a remembered success does not extend the window"
        )
        XCTAssertNil(
            relaunched.beginAttempt(
                selected: nodes[0], catalog: nodes, owner: owner,
                now: now.addingTimeInterval(Hy2AutoSwitch.rememberFor + 1)
            ),
            "after expiry Reality is tried again"
        )
        XCTAssertNotNil(relaunched.rememberedUntil(dial.tcp))
        relaunched.applyCatalogPermission(true, owner: owner, catalog: nodes.filter { $0.name != dial.hy2 })
        XCTAssertNil(relaunched.rememberedUntil(dial.tcp), "the hy2 block left the catalog")
    }

    func testARejectedCatalogAndAnAccountChangeDropAutoSwitchState() throws {
        let (defaults, suite) = try isolatedDefaults()
        defer {
            defaults.removePersistentDomain(forName: suite)
            ManagedExitCatalogOwnership.purge()
        }
        let nodes = catalog()
        let now = Date(timeIntervalSinceReferenceDate: 800_000_000)
        let app = AppState()
        app.hy2AutoSwitch = Hy2AutoSwitch(defaults: defaults)
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: nodes)]
        ManagedExitCatalogOwnership.adopt(owner)

        app.applyHy2AutoSwitchPermission(true, owner: owner)
        failReality(app.hy2AutoSwitch, nodes, now: now)
        app.revokeHy2AutoSwitchForRejectedCatalog()
        XCTAssertFalse(app.hy2AutoSwitch.permitted, "a refused or undecodable 200 grants nothing")
        XCTAssertEqual(app.hy2AutoSwitch.consecutiveTcpFailures(nodes[0].name), 0)

        app.applyHy2AutoSwitchPermission(true, owner: owner)
        failReality(app.hy2AutoSwitch, nodes, now: now)
        let dial = try XCTUnwrap(app.hy2AutoSwitch.beginAttempt(selected: nodes[0], catalog: nodes, owner: owner, now: now))
        app.hy2AutoSwitch.noteConnected(dialed: dial.hy2, now: now)
        XCTAssertNotNil(app.hy2AutoSwitch.rememberedUntil(dial.tcp))
        ManagedExitCatalogOwnership.adopt("account-b")
        XCTAssertFalse(app.hy2AutoSwitch.permitted, "another account inherits nothing")
        XCTAssertNil(app.hy2AutoSwitch.rememberedUntil(dial.tcp))
        XCTAssertNil(defaults.data(forKey: Hy2AutoSwitch.storageKey))
    }
}
