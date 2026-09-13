import XCTest
@testable import Tono

/// The network-log upload switch and the one thing that must outlive any
/// change to its default: a person's own answer.
///
/// Legacy clients never wrote a user-chosen marker. A stored false must survive.
///
/// Each test runs against its own `UserDefaults` suite: the migration writes as
/// it reads, and pointing that at the test host's real defaults would leave the
/// machine running the tests opted into an upload.
final class NetworkLogUploadDefaultTests: XCTestCase {
    private func freshDefaults() throws -> UserDefaults {
        let name = "NetworkLogUploadDefaultTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        addTeardownBlock {
            UserDefaults.standard.removePersistentDomain(forName: name)
        }
        return defaults
    }

    func testDefaultOnPreservesLegacyOptOutWithoutANewMarker() throws {
        XCTAssertTrue(SettingsKey.isNetworkLogUploadEnabled(defaults: try freshDefaults()))
        let defaults = try freshDefaults()
        defaults.set(false, forKey: SettingsKey.networkLogUploadEnabled)
        defaults.set(true, forKey: SettingsKey.networkLogDefaultV2Applied)

        XCTAssertFalse(SettingsKey.isNetworkLogUploadEnabled(defaults: defaults))
        XCTAssertTrue(defaults.bool(forKey: SettingsKey.networkLogDefaultV3Applied))
        XCTAssertFalse(defaults.bool(forKey: SettingsKey.networkLogUploadUserChosen))

        SettingsKey.setNetworkLogUploadEnabled(false, defaults: defaults)
        for _ in 0..<3 {
            XCTAssertFalse(SettingsKey.isNetworkLogUploadEnabled(defaults: defaults))
        }
        XCTAssertFalse(
            defaults.bool(forKey: SettingsKey.periodicTelemetryEnabled),
            "the snapshot consent keeps its own default"
        )
    }
}
