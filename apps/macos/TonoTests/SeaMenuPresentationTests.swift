import XCTest
@testable import Tono

@MainActor
final class SeaMenuPresentationTests: XCTestCase {
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
