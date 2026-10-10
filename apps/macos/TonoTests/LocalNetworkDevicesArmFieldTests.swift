import XCTest
@testable import Tono

/// D7 (A29): the arm request carries `allowLocalNetworkDevices` only when the
/// setting is on. A helper older than the field rejects any arm that carries
/// it, so the default (off, or never set) must send nothing; the helper reads
/// absence as off and renders no LAN pass.
final class LocalNetworkDevicesArmFieldTests: XCTestCase {

    func testArmRequestCarriesLocalNetworkDevicesOnlyWhenTheSettingIsOn() throws {
        let suite = "LocalNetworkDevicesArmFieldTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertTrue(
            HelperManager.localNetworkDevicesArmFields(defaults: defaults).isEmpty,
            "never set must send no field"
        )
        defaults.set(false, forKey: SettingsKey.allowLocalNetworkDevices)
        XCTAssertTrue(
            HelperManager.localNetworkDevicesArmFields(defaults: defaults).isEmpty,
            "off must send no field"
        )
        defaults.set(true, forKey: SettingsKey.allowLocalNetworkDevices)
        let fields = HelperManager.localNetworkDevicesArmFields(defaults: defaults)
        XCTAssertEqual(fields.count, 1)
        XCTAssertEqual(fields["allowLocalNetworkDevices"] as? Bool, true)
    }
}
