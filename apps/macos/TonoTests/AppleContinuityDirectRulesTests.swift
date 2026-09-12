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
}
