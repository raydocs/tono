import XCTest
@testable import Tono

final class ByteFormatTests: XCTestCase {
    func testRateIsOneTokenAndNeverSpellsOutTheWordBytes() {
        XCTAssertEqual(TonoByteFormat.rate(0), "0 B/s")
        XCTAssertFalse(TonoByteFormat.rate(0).contains(" /s"))
        XCTAssertFalse(TonoByteFormat.rate(0).contains("字节"))
        XCTAssertFalse(TonoByteFormat.rate(0).localizedCaseInsensitiveContains("bytes"))
    }

    func testDashboardAndActivityAgreeOnTheSameReading() {
        // 8.7 KB/s on the Dashboard used to read "8908 字节 /s" on Activity.
        let reading: Int64 = 8_908
        XCTAssertEqual(TonoByteFormat.rate(reading), "8.7 KB/s")
        XCTAssertEqual(TonoByteFormat.bytes(reading), "8.7 KB")
    }

    func testSmallCountsKeepByteResolutionInsteadOfRoundingToZeroKB() {
        XCTAssertEqual(TonoByteFormat.bytes(0), "0 B")
        XCTAssertEqual(TonoByteFormat.bytes(512), "512 B")
        XCTAssertEqual(TonoByteFormat.bytes(1_023), "1023 B")
        XCTAssertEqual(TonoByteFormat.bytes(1_024), "1.0 KB")
    }

    func testLargeCountsDropTheNoisyDecimal() {
        XCTAssertEqual(TonoByteFormat.bytes(356_352), "348 KB")
        XCTAssertEqual(TonoByteFormat.bytes(12_163_481), "11.6 MB")
    }

    func testNegativeReadingsDoNotProduceNonsense() {
        XCTAssertEqual(TonoByteFormat.bytes(-1), "0 B")
    }
}

final class RouteNamingTests: XCTestCase {
    func testMihomoVocabularyNeverReachesTheRulesTable() {
        for raw in ["DIRECT", "REJECT", "REJECT-DROP"] {
            XCTAssertFalse(
                ruleTargetTitle(raw).contains(raw),
                "\(raw) reached the UI verbatim"
            )
        }
    }

    func testInternalGroupNamesReadAsTheRoutesUsersAlreadyKnow() {
        XCTAssertEqual(
            ruleTargetTitle(ConfigPipeline.exitGroupName),
            String(localized: "Proxied")
        )
        XCTAssertEqual(
            ruleTargetTitle(ConfigPipeline.homeResidentialProxyName),
            String(localized: "Home")
        )
        XCTAssertEqual(
            ruleTargetTitle(ConfigPipeline.directProxyName),
            String(localized: "Direct")
        )
    }

    func testACatalogNodeKeepsItsCityTitle() {
        XCTAssertEqual(ruleTargetTitle("JP-VLESS-Reality"), nodeCityTitle("Tokyo · Dawn"))
    }
}
