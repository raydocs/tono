import XCTest
@testable import Tono

/// The twenty-minute protection snapshot and remote controllability are
/// separate consents.
///
/// The snapshot used to have no switch at all: it uploaded UI state, the
/// selected exit, catalog revision, kill-switch and DNS state, path latencies
/// and the connection event ring for every signed-in Mac, while the only
/// Settings row that mentioned sharing protection status —
/// `remoteDiagnosticsEnabled` — is off by default and governs the device-action
/// poll. A customer reading that screen concluded the snapshot was not sent.
final class PeriodicTelemetryConsentTests: XCTestCase {
    private var defaults: UserDefaults { AppProfile.defaults }

    override func tearDown() {
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        super.tearDown()
    }

    func testTheSnapshotDefaultsOff() {
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        XCTAssertFalse(
            AccountSession.isPeriodicTelemetryEnabled,
            "an unset key must not opt a new installation into periodic uploads"
        )
        XCTAssertTrue(defaults.bool(forKey: SettingsKey.periodicTelemetryDefaultV2Applied))
    }

    func testLegacyTrueIsResetOnceAndALaterExplicitOptInSurvives() {
        defaults.set(true, forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        XCTAssertFalse(
            AccountSession.isPeriodicTelemetryEnabled,
            "the v2 migration must reset the former default-on value"
        )
        XCTAssertTrue(defaults.bool(forKey: SettingsKey.periodicTelemetryDefaultV2Applied))

        defaults.set(true, forKey: SettingsKey.periodicTelemetryEnabled)
        XCTAssertTrue(AccountSession.isPeriodicTelemetryEnabled)
        XCTAssertTrue(
            AccountSession.isPeriodicTelemetryEnabled,
            "the migration marker must preserve a later user opt-in"
        )
    }

    func testTheSnapshotDoesNotRideOnAnotherConsent() {
        XCTAssertNotEqual(
            SettingsKey.periodicTelemetryEnabled,
            SettingsKey.remoteDiagnosticsEnabled,
            "the device-action poll's consent never described a periodic upload"
        )
        XCTAssertNotEqual(
            SettingsKey.periodicTelemetryEnabled,
            SettingsKey.networkLogUploadEnabled,
            "the raw-log upload is a materially larger disclosure"
        )
        XCTAssertNotEqual(
            SettingsKey.periodicTelemetryEnabled,
            SettingsKey.crashReportingEnabled
        )
    }
}
