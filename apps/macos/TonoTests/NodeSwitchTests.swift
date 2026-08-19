import XCTest
@testable import Tono

final class NodeSwitchTests: XCTestCase {
    func testUniqueDialEndpointsKeepOldThenNewAndDropDuplicates() {
        let old = ConfigPipeline.DialEndpoint(host: "203.0.113.10", port: 443, transport: "tcp")
        let extra = ConfigPipeline.DialEndpoint(host: "203.0.113.11", port: 443, transport: "tcp")
        let next = ConfigPipeline.DialEndpoint(host: "198.51.100.20", port: 443, transport: "tcp")
        let union = ConfigPipeline.uniqueDialEndpoints([old, extra, next, old, extra])
        XCTAssertEqual(union, [old, extra, next])
    }

    func testDrainClosesOnlyConnectionsBoundToThePreviousExit() {
        let stale = fixtureConnection(
            id: "old-1",
            chains: ["Tono-Exit", "Los Angeles · Canyon"]
        )
        let alreadyMoved = fixtureConnection(
            id: "new-1",
            chains: ["Tono-Exit", "Salt Lake · Harbor"]
        )
        let chinaDirect = fixtureConnection(
            id: "direct-1",
            chains: ["Tono-China-App", "Tono-China-Direct"]
        )
        let bound = [stale, alreadyMoved, chinaDirect].filter {
            $0.isBoundToExit("Los Angeles · Canyon")
        }
        XCTAssertEqual(bound.map(\.id), ["old-1"])
        XCTAssertFalse(alreadyMoved.isBoundToExit("Los Angeles · Canyon"))
        XCTAssertFalse(chinaDirect.isBoundToExit("Los Angeles · Canyon"))
    }

    private func fixtureConnection(id: String, chains: [String]) -> APIConnection {
        APIConnection(
            id: id,
            metadata: APIConnectionMetadata(
                network: "tcp",
                type: "TCP",
                process: nil,
                processPath: nil,
                sourceIP: "198.18.0.1",
                destinationIP: "203.0.113.10",
                sourcePort: "1",
                destinationPort: "443",
                host: "example.com"
            ),
            upload: 0,
            download: 0,
            start: "0",
            chains: chains,
            rule: "Match",
            rulePayload: nil
        )
    }
}
