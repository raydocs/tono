import Foundation
import XCTest
@testable import Tono

final class TonoAccountRulesTests: XCTestCase {
    func testNormalizedEmailTrimsAndLowercases() {
        XCTAssertEqual(TonoAccountRules.normalizedEmail("  Foo@Example.COM \n"), "foo@example.com")
        XCTAssertEqual(TonoAccountRules.normalizedEmail(""), "")
    }

    func testValidEmailRequiresOneAtAndADottedDomain() {
        XCTAssertTrue(TonoAccountRules.validEmail("a@b.co"))
        XCTAssertTrue(TonoAccountRules.validEmail("  A@B.CO  "))
        XCTAssertFalse(TonoAccountRules.validEmail(""))
        XCTAssertFalse(TonoAccountRules.validEmail("a@b"))
        XCTAssertFalse(TonoAccountRules.validEmail("@b.co"))
        XCTAssertFalse(TonoAccountRules.validEmail("a@@b.co"))
        XCTAssertFalse(TonoAccountRules.validEmail("ab.co"))
    }

    func testNormalizedDeviceNameFallsBackToMac() {
        XCTAssertEqual(TonoAccountRules.normalizedDeviceName(""), "Mac")
        XCTAssertEqual(TonoAccountRules.normalizedDeviceName("   \n "), "Mac")
        XCTAssertEqual(TonoAccountRules.normalizedDeviceName("  MacBook Pro  "), "MacBook Pro")
    }

    func testNormalizedDeviceNameIsBoundedToEightyCharacters() {
        let name = TonoAccountRules.normalizedDeviceName(String(repeating: "x", count: 200))
        XCTAssertEqual(name.count, 80)
    }

    func testQuotaTextRendersUsedOverLimit() {
        // The strings are localized now, so build the expectation through the
        // same catalog lookup: the assertion checks the numbers land in the
        // format regardless of the runner's language.
        XCTAssertEqual(
            TonoAccountRules.quotaText(used: 1, limit: 2),
            String(localized: "\(1) / \(2) devices")
        )
        XCTAssertEqual(
            TonoAccountRules.quotaText(used: 0, limit: TonoAccountRules.maximumDevices),
            String(localized: "\(0) / \(TonoAccountRules.maximumDevices) devices")
        )
    }

    func testExpiryTextWithoutDateReportsNoExpiration() {
        XCTAssertEqual(TonoAccountRules.expiryText(nil), String(localized: "No expiration"))
    }

    func testExpiryTextFormatsCalendarDateForLocale() {
        // Midday UTC keeps the rendered day stable across the runner's zone.
        let date = Date(timeIntervalSince1970: 1_786_363_200)
        let text = TonoAccountRules.expiryText(date, locale: Locale(identifier: "en_US"))
        XCTAssertTrue(text.contains("2026"), text)
        XCTAssertTrue(text.contains("10"), text)
        XCTAssertNotEqual(text, "No expiration")
    }
}
