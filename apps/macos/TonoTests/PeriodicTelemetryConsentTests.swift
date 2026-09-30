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
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV3Applied)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryUserChosen)
        defaults.removeObject(forKey: SettingsKey.internalFailureReportsOptedOut)
        super.tearDown()
    }

    func testTheSnapshotDefaultsOn() {
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV3Applied)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryUserChosen)
        XCTAssertTrue(
            AccountSession.isPeriodicTelemetryEnabled,
            "an unset key must upload the privacy-safe timeline"
        )
        XCTAssertTrue(defaults.bool(forKey: SettingsKey.periodicTelemetryDefaultV2Applied))
        XCTAssertTrue(defaults.bool(forKey: SettingsKey.periodicTelemetryDefaultV3Applied))
    }

    func testAForcedOffWithoutAChoiceComesBackAndAnExplicitOptOutSticks() {
        defaults.set(false, forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.set(true, forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV3Applied)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryUserChosen)
        XCTAssertTrue(
            AccountSession.isPeriodicTelemetryEnabled,
            "v3 undoes the v2 force-off when the person has not chosen"
        )

        defaults.set(true, forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV3Applied)
        XCTAssertTrue(
            AccountSession.isPeriodicTelemetryEnabled,
            "a legacy on value must stay on"
        )

        defaults.set(false, forKey: SettingsKey.periodicTelemetryEnabled)
        AccountSession.notePeriodicTelemetryChoice()
        XCTAssertFalse(AccountSession.isPeriodicTelemetryEnabled)
        XCTAssertFalse(
            AccountSession.isPeriodicTelemetryEnabled,
            "an explicit opt-out must survive the next read"
        )
    }

    /// Owner decision 2026-09-24: internal candidate builds report classified
    /// connect failures by default, and an upgrade's snapshot reset must not
    /// turn that off. Release builds keep the opt-in.
    func testInternalBuildsKeepClassifiedFailureReportsThroughTheUpgradeReset() {
        defaults.set(true, forKey: SettingsKey.periodicTelemetryEnabled)
        defaults.removeObject(forKey: SettingsKey.periodicTelemetryDefaultV2Applied)
        let snapshot = AccountSession.isPeriodicTelemetryEnabled
        XCTAssertTrue(snapshot, "the upgrade keeps the privacy-safe snapshot on")
        XCTAssertTrue(AccountSession.isInternalBuild(["TonoBuildChannel": "internal"]))
        XCTAssertFalse(
            AccountSession.isInternalBuild(["TonoBuildChannel": ""]),
            "a release build's unset build setting expands to an empty string"
        )
        XCTAssertEqual(
            AccountSession.failureReportScope(internalBuild: true, snapshotOptedIn: snapshot, internalOptedOut: false),
            .full
        )
        XCTAssertEqual(
            AccountSession.failureReportScope(internalBuild: false, snapshotOptedIn: snapshot, internalOptedOut: false),
            .full,
            "release builds report failures while the snapshot stays on"
        )
        XCTAssertNil(
            AccountSession.failureReportScope(internalBuild: false, snapshotOptedIn: false, internalOptedOut: false),
            "the snapshot opt-out stops release failure reports"
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

    func testAFailedPostWaitsOnDiskAndATimeoutDoesNot() {
        defaults.removeObject(forKey: TelemetryOutbox.key)
        XCTAssertFalse(AccountSession.shouldQueueTelemetry(URLError(.timedOut)))
        XCTAssertTrue(AccountSession.shouldQueueTelemetry(URLError(.notConnectedToInternet)))
        TelemetryOutbox.enqueue(kind: "failure", body: Data("{\"ok\":true}".utf8), defaults: defaults)
        XCTAssertEqual(TelemetryOutbox.pending(defaults: defaults).count, 1)
        defaults.removeObject(forKey: TelemetryOutbox.key)
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
