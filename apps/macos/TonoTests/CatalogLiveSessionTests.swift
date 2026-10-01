import XCTest
@testable import Tono

@MainActor
final class CatalogLiveSessionTests: XCTestCase {
    func testAddingAnotherCityDoesNotReloadTheLiveSession() {
        let canyon = Fixture.realityNode(name: "Los Angeles · Canyon")
        var westwood = canyon
        westwood.name = "Los Angeles · Westwood"
        westwood.server = "179.253.233.220"
        westwood.sni = "www.ucla.edu"
        XCTAssertFalse(
            CatalogLiveSession.shouldReload(
                previousSelected: canyon,
                nextSelected: canyon,
                previousHome: nil,
                nextHome: nil,
                routingChanged: false
            )
        )
        XCTAssertTrue(canyon.liveSessionIdentity(matches: canyon))
        XCTAssertFalse(canyon.liveSessionIdentity(matches: westwood))
    }

    func testChangingTheSelectedDestReloadsTheLiveSession() {
        let before = Fixture.realityNode(name: "Los Angeles · Canyon", sni: "www.bing.com")
        let after = Fixture.realityNode(name: "Los Angeles · Canyon", sni: "www.csudh.edu")
        XCTAssertTrue(
            CatalogLiveSession.shouldReload(
                previousSelected: before,
                nextSelected: after,
                previousHome: nil,
                nextHome: nil,
                routingChanged: false
            )
        )
    }

    func testRotatingHomeProxyCredentialsReloadsTheLiveSession() {
        let selected = Fixture.realityNode(name: "Los Angeles · Canyon")
        let before = Fixture.realityNode(name: "Home-US", id: "home-reality")
        var after = before
        after.uuid = "00000000-0000-4000-8000-000000000002"
        XCTAssertTrue(
            CatalogLiveSession.shouldReload(
                previousSelected: selected,
                nextSelected: selected,
                previousHome: before,
                nextHome: after,
                routingChanged: false
            )
        )
    }
}
