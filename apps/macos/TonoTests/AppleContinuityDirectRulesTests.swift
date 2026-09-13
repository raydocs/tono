import XCTest
@testable import Tono

final class AppleContinuityDirectRulesTests: XCTestCase {
    func testContinuityPrefixesAreDirectBeforeTheGlobalUDPReject() {
        let rules = ConfigPipeline.appleContinuityDirectRules
        XCTAssertTrue(rules.contains("IP-CIDR,224.0.0.0/4,DIRECT,no-resolve"))
        XCTAssertTrue(rules.contains("IP-CIDR,169.254.0.0/16,DIRECT,no-resolve"))
        XCTAssertTrue(rules.contains("IP-CIDR6,ff00::/8,DIRECT,no-resolve"))
        XCTAssertTrue(rules.contains("IP-CIDR6,fe80::/10,DIRECT,no-resolve"))
        XCTAssertTrue(rules.contains("DST-PORT,5353)),DIRECT"))
        XCTAssertFalse(rules.contains("GEOIP"))
        XCTAssertFalse(rules.contains("GEOSITE"))
    }

    func testOwnedRuntimePutsChinaSuffixesAndContinuityBeforeUDPReject() throws {
        let node = Fixture.realityNode()
        let yaml = try Fixture.ownedRuntime(
            overlay: Fixture.overlay(selectedNodeName: node.name),
            nodes: [node],
            directPolicy: Fixture.directPolicy()
        )
        XCTAssertTrue(yaml.contains("DOMAIN-SUFFIX,zhihu.com"))
        XCTAssertTrue(yaml.contains("DOMAIN-SUFFIX,taobao.com"))
        XCTAssertTrue(yaml.contains("DOMAIN-SUFFIX,goofish.com"))
        XCTAssertTrue(yaml.contains("DOMAIN-SUFFIX,kugou.com"))
        XCTAssertFalse(yaml.contains("GEOSITE"))
        XCTAssertFalse(yaml.contains("GEOIP,CN"))
        guard
            let continuity = yaml.range(of: "IP-CIDR,224.0.0.0/4,DIRECT"),
            let udpReject = yaml.range(of: "AND,((NETWORK,UDP)),REJECT"),
            let match = yaml.range(of: "MATCH,Tono-Exit")
        else {
            return XCTFail("missing continuity, UDP reject, or MATCH")
        }
        XCTAssertLessThan(continuity.lowerBound, udpReject.lowerBound)
        XCTAssertLessThan(udpReject.lowerBound, match.lowerBound)
    }
}
