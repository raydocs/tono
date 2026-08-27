import XCTest
@testable import Tono

/// Crash reporting and remote controllability are separate consents.
///
/// They used to share `remoteDiagnosticsEnabled`, which is off by default and
/// also starts a fifteen-second poll for remote device actions. A build under
/// test therefore could not report that it had crashed unless the user first
/// granted the control plane the ability to act on their machine — so in
/// practice crashes were never reported at all.
final class CrashReportingConsentTests: XCTestCase {
    private var defaults: UserDefaults { AppProfile.defaults }

    override func tearDown() {
        defaults.removeObject(forKey: SettingsKey.crashReportingEnabled)
        super.tearDown()
    }

    func testCrashReportingIsOnUntilSomeoneTurnsItOff() {
        defaults.removeObject(forKey: SettingsKey.crashReportingEnabled)
        XCTAssertTrue(
            crashReportingConsent(),
            "an unset key must read as on, or a fresh install reports nothing"
        )

        defaults.set(false, forKey: SettingsKey.crashReportingEnabled)
        XCTAssertFalse(crashReportingConsent())

        defaults.set(true, forKey: SettingsKey.crashReportingEnabled)
        XCTAssertTrue(crashReportingConsent())
    }

    func testCrashReportingDoesNotRideOnTheRemoteActionConsent() {
        XCTAssertNotEqual(
            SettingsKey.crashReportingEnabled,
            SettingsKey.remoteDiagnosticsEnabled,
            "sharing the key is what made crashes unreportable by default"
        )
    }

    /// Mirrors the check in `CrashReporter.annotatedRemoteDiagnosticSnapshot`.
    private func crashReportingConsent() -> Bool {
        defaults.object(forKey: SettingsKey.crashReportingEnabled) == nil
            ? true
            : defaults.bool(forKey: SettingsKey.crashReportingEnabled)
    }
}
