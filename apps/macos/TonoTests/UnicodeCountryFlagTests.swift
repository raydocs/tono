import XCTest
@testable import Tono

final class UnicodeCountryFlagTests: XCTestCase {
    func testKnownCountries() {
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "US"), "🇺🇸")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "JP"), "🇯🇵")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "HK"), "🇭🇰")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "SG"), "🇸🇬")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "DE"), "🇩🇪")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "GB"), "🇬🇧")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "TW"), "🇹🇼")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "KR"), "🇰🇷")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "CA"), "🇨🇦")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "FR"), "🇫🇷")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "AU"), "🇦🇺")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "NL"), "🇳🇱")
    }

    func testLowercaseInputNormalization() {
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "us"), "🇺🇸")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "jp"), "🇯🇵")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "hk"), "🇭🇰")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "sg"), "🇸🇬")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "de"), "🇩🇪")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "gb"), "🇬🇧")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "Us"), "🇺🇸")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "uS"), "🇺🇸")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "jP"), "🇯🇵")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "hK"), "🇭🇰")
    }

    func testWhitespaceNormalization() {
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: " US "), "🇺🇸")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "\tjp\n"), "🇯🇵")
        XCTAssertEqual(UnicodeCountryFlag.emoji(for: "  hk  "), "🇭🇰")
    }

    func testNilAndEmptyEdgeCases() {
        XCTAssertNil(UnicodeCountryFlag.emoji(for: nil))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: ""))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: " "))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "   "))
    }

    func testWrongLengthEdgeCases() {
        // Single character
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "U"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "J"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "H"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "a"))

        // Three characters
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "USA"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "JPN"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "HKG"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "SGP"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "DEU"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "GBR"))

        // Four or more characters
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "USAA"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "UNITED"))
    }

    func testNumbersAndMixedAlphanumericEdgeCases() {
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "12"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "00"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "99"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "U1"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "1U"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "J8"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "2P"))
    }

    func testSymbolsAndNonAsciiEdgeCases() {
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "U!"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "??"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "--"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "中国"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "日本"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "ÉU"))
        XCTAssertNil(UnicodeCountryFlag.emoji(for: "🇺🇸"))
    }
}
