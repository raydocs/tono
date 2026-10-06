import XCTest
@testable import Tono

@MainActor
final class SeaMenuPresentationTests: XCTestCase {
    func testRecommendedQuickRouteCapturesItsProposalAndRejectsAChangedCatalog() throws {
        let suite = "tono-sea-menu-review-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); ManagedExitCatalogOwnership.purge() }
        let owner = "sea-menu-review-owner"
        ManagedExitCatalogOwnership.adopt(owner)
        let app = AppState()
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        let current = Fixture.realityNode(name: "Seattle", id: "current")
        let recommended = Fixture.realityNode(name: "Osaka", id: "recommended", flag: "🇯🇵")
        let catalog = [current, recommended]
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: catalog)]
        app.managedCatalogDigest = String(repeating: "a", count: 64)
        app.selectedNodeId = current.id
        app.activeNode = current
        app.proxyService.activeNodeName = current.name
        let now = Date()
        app.routePreferences.recordSuccess(recommended.name, owner: owner, catalog: catalog,
                                          digest: try XCTUnwrap(app.managedCatalogDigest), now: now)
        let proposal = try XCTUnwrap(app.routeRecommendation(owner: owner, now: now))
        guard case .reviewRecommendation(let captured) = SeaMenuPresentation.action(for: recommended, recommendation: proposal) else {
            return XCTFail("a recommended quick route must open review, not select/connect directly")
        }
        XCTAssertEqual(captured.id, proposal.id)
        XCTAssertEqual(captured.owner, owner)
        XCTAssertEqual(captured.generation, proposal.generation)
        XCTAssertEqual(captured.catalogDigest, proposal.catalogDigest)
        XCTAssertEqual(captured.preferredRegion, proposal.preferredRegion)
        XCTAssertEqual(captured.name, recommended.name)
        XCTAssertNotNil(captured.successfulAt)
        XCTAssertEqual(captured.successfulAt, proposal.successfulAt)
        app.managedCatalogDigest = String(repeating: "b", count: 64)
        XCTAssertFalse(app.confirmRouteRecommendation(captured, now: now))
        XCTAssertEqual(app.selectedNodeId, current.id)
        XCTAssertNil(app.connectionCoordinator.connectTask)
    }

    func testQuickRoutesAreBoundedCatalogIdentitiesWithoutTheCurrentRoute() {
        let current = Fixture.realityNode(name: "Seattle", id: "current")
        let recommended = Fixture.realityNode(name: "Osaka", id: "recommended")
        let sibling = Fixture.realityNode(name: "Osaka · hy2", id: "sibling")
        let favorite = Fixture.realityNode(name: "Paris", id: "favorite")
        let extra = Fixture.realityNode(name: "Toronto", id: "extra")
        let routes = SeaMenuPresentation.quickRoutes(catalog: [current, recommended, sibling, favorite, extra],
            recommended: recommended.name, favorites: [current.name, recommended.name, favorite.name, extra.name], selected: current.name)
        XCTAssertEqual(routes.map(\.id), [recommended.id, favorite.id])
    }
}
