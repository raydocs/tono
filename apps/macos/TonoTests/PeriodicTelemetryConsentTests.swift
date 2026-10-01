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
        defaults.removeObject(forKey: SettingsKey.internalFailureReportsOptedOut)
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

    /// Owner decision 2026-09-24: internal candidate builds report classified
    /// connect failures by default, and an upgrade's snapshot reset must not
    /// turn that off. Release builds keep the opt-in.
    func testInternalBuildsKeepClassifiedFailureReportsThroughTheUpgradeReset() {
        defaults.set(true, forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        let snapshot = AccountSession.isPeriodicTelemetryEnabled
        XCTAssertFalse(snapshot, "the upgrade still resets the snapshot switch")
        XCTAssertTrue(AccountSession.isInternalBuild(["TonoBuildChannel": "internal"]))
        XCTAssertFalse(
            AccountSession.isInternalBuild(["TonoBuildChannel": ""]),
            "a release build's unset build setting expands to an empty string"
        )
        XCTAssertEqual(
            AccountSession.failureReportScope(internalBuild: true, snapshotOptedIn: snapshot, internalOptedOut: false),
            .classified
        )
        XCTAssertNil(
            AccountSession.failureReportScope(internalBuild: false, snapshotOptedIn: snapshot, internalOptedOut: false),
            "release builds keep today's opt-in"
        )
        XCTAssertEqual(
            AccountSession.failureReportScope(internalBuild: false, snapshotOptedIn: true, internalOptedOut: false),
            .full
        )
    }

    /// Internal builds report classified failures by default, but the user can
    /// save an opt-out; the snapshot switch cannot carry it because it is
    /// already off by default.
    func testAnInternalBuildsSavedOptOutStopsClassifiedFailureReports() {
        defaults.removeObject(forKey: SettingsKey.internalFailureReportsOptedOut)
        XCTAssertEqual(
            AccountSession.failureReportScope(
                internalBuild: true, snapshotOptedIn: false,
                internalOptedOut: AccountSession.isInternalFailureReportsOptedOut
            ),
            .classified,
            "an unset key keeps the internal default on"
        )
        defaults.set(true, forKey: SettingsKey.internalFailureReportsOptedOut)
        XCTAssertNil(
            AccountSession.failureReportScope(
                internalBuild: true, snapshotOptedIn: false,
                internalOptedOut: AccountSession.isInternalFailureReportsOptedOut
            ),
            "the saved opt-out must stop the classified report"
        )
    }

    /// A report that passed the consent check can still wait on a token
    /// refresh or a network retry. Opting out in that time must stop it.
    func testAPendingFailureReportStopsOnceTheUserOptsOut() {
        defaults.set(true, forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        defaults.set(false, forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.removeObject(forKey: SettingsKey.internalFailureReportsOptedOut)
        XCTAssertTrue(AccountSession.failureReportStillAllowed(builtAs: .classified, internalBuild: true))
        defaults.set(true, forKey: SettingsKey.internalFailureReportsOptedOut)
        XCTAssertFalse(
            AccountSession.failureReportStillAllowed(builtAs: .classified, internalBuild: true),
            "an opt-out saved while the report waited must stop its next send attempt"
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
