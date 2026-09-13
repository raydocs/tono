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
                routingChanged: false
            )
        )
    }
}
