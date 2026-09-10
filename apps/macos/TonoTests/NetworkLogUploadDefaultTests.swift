import XCTest
@testable import Tono

/// The network-log upload switch and the one thing that must outlive any
/// change to its default: a person's own answer.
///
/// The v2 migration wrote an explicit `false` into every install, so the stored
/// value can no longer tell "was migrated" apart from "said no". Only the
/// `networkLogUploadUserChosen` marker can, and only the Settings switch writes
/// it — which is why a default flip has to key off that marker and never off
/// the value it is about to overwrite.
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

    /// One regression check for the whole default flip: a v2-migrated install
    /// (stored `false` nobody typed) is flipped to the programme default once,
    /// a person turning it off afterwards is never overridden again, and the
    /// protection-snapshot consent is not touched by any of it.
    func testTheV3FlipHappensOnceAndAChoiceOutlivesIt() throws {
        XCTAssertTrue(SettingsKey.networkLogUploadDefault, "flipping this constant is the one-line revert")
        let defaults = try freshDefaults()
        defaults.set(false, forKey: SettingsKey.networkLogUploadEnabled)
        defaults.set(true, forKey: SettingsKey.networkLogDefaultV2Applied)

        XCTAssertTrue(SettingsKey.isNetworkLogUploadEnabled(defaults: defaults), "a value written by v2 is not an opt-out")
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
