import XCTest
@testable import Tono

@MainActor
final class SeaServerPresentationTests: XCTestCase {
    func testFavoritesKeepBothTransportBlocksOfTheSameCatalogIdentity() {
        let node = Fixture.realityNode(name: "Osaka", id: "tcp")
        let backup = Fixture.realityNode(name: "Osaka · hy2", id: "udp")
        let other = Fixture.realityNode(name: "Seattle", id: "other")
        let visible = SeaServerPresentation.favorites(in: [node, backup, other], names: ["Osaka"])
        XCTAssertEqual(visible.map(\.id), [node.id, backup.id])
    }
}
