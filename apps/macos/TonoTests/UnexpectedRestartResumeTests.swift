import XCTest
@testable import Tono

/// A Mac that restarted while a session was up (a kernel panic, a power loss)
/// must not reconnect by itself at the next launch: if the session triggered
/// the restart, that reconnect repeats it at every login. A crash and relaunch
/// within the same boot keeps automatic recovery.
@MainActor
final class UnexpectedRestartResumeTests: XCTestCase {
    func testLaunchResumesAutomaticallyOnlyInTheBootThatStartedTheSession() {
        XCTAssertTrue(RuntimeCleanup.holdsAutomaticResume(
            recordedBootSession: "boot-before-restart",
            currentBootSession: "boot-after-restart"
        ), "A session started in an earlier boot must not auto-connect")
        XCTAssertTrue(RuntimeCleanup.holdsAutomaticResume(
            recordedBootSession: RuntimeCleanup.bootSessionRecord(current: nil),
            currentBootSession: "boot-after-restart"
        ), "A connect whose boot session could not be read must still hold")
        XCTAssertFalse(RuntimeCleanup.holdsAutomaticResume(
            recordedBootSession: "same-boot",
            currentBootSession: "same-boot"
        ), "A same-boot relaunch keeps automatic recovery")
    }

    /// Regression review a1d498c8 grok:F2: cfprefsd writes a preference to
    /// disk when it gets to it, so a panic seconds after connect could lose a
    /// record kept only there, and the next boot reconnected by itself again.
    func testConnectRecordSurvivesALostPreferencesWrite() {
        defer { RuntimeCleanup.clearConnectBootSession() }
        RuntimeCleanup.recordConnectBootSession()
        // The preference never reached disk before the restart.
        AppProfile.defaults.removeObject(forKey: SettingsKey.connectBootSession)
        XCTAssertEqual(
            RuntimeCleanup.recordedConnectBootSession,
            RuntimeCleanup.bootSessionRecord(current: RuntimeCleanup.currentBootSession())
        )
        RuntimeCleanup.clearConnectBootSession()
        XCTAssertNil(RuntimeCleanup.recordedConnectBootSession)
        // A record an earlier build kept only in preferences still holds.
        AppProfile.defaults.set("boot-before-upgrade", forKey: SettingsKey.connectBootSession)
        XCTAssertEqual(RuntimeCleanup.recordedConnectBootSession, "boot-before-upgrade")
    }

    /// Regression review a1d498c8 codex:F1: the restore callback carries the
    /// resume intent it read at launch. A confirmed release accepted since
    /// then (the root emergency disarm) supersedes it: no notice that Kill
    /// Switch is blocking traffic, and no pause that waits for the user.
    func testRestartHoldIgnoresAResumeThatAConfirmedReleaseSuperseded() throws {
        let storedIntent = KillSwitchService.isArmed
        let storedSelection = AppProfile.defaults.string(forKey: SettingsKey.selectedProxyTargetName)
        defer {
            KillSwitchService.isArmed = storedIntent
            AppProfile.defaults.set(storedSelection, forKey: SettingsKey.selectedProxyTargetName)
        }
        func heldLaunch() -> AppState {
            let app = AppState()
            app.proxyRegions = [ProxyRegion(
                id: AppState.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: [Fixture.realityNode()]
            )]
            app.automaticResumeHeldAfterRestart = true
            KillSwitchService.isArmed = true
            app.isProtectionBlocked = true
            return app
        }

        let armed = heldLaunch()
        try armed.acceptCloudOnlyTransport(resumeProtection: true)
        XCTAssertTrue(armed.protectedReconnectPausedForUserAction)
        XCTAssertNotNil(armed.errorMessage, "a confirmed barrier says why Tono did not reconnect")

        let released = heldLaunch()
        released.acceptConfirmedExternalProtectionRelease()
        try released.acceptCloudOnlyTransport(resumeProtection: true)
        XCTAssertFalse(released.protectedReconnectPausedForUserAction)
        XCTAssertNil(released.errorMessage)
        XCTAssertFalse(released.isProtectionBlocked)
        XCTAssertFalse(released.autoConnectRequested)
    }
}
