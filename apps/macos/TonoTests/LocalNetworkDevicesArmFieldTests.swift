import XCTest
@testable import Tono

/// D7 (A29): "Allow local network devices" on the app side of the helper
/// boundary: the arm field, generation bookkeeping for PF and the Core, the
/// bounded automatic convergence, the explicit faults, and the toggle's
/// reload.
final class LocalNetworkDevicesArmFieldTests: XCTestCase {
    private var savedIPC = KillSwitchService.armIPC
    private var savedArmed = false
    private var savedReader = LocalNetworkDevicesSync.readStoredSetting

    override func setUp() {
        super.setUp()
        savedIPC = KillSwitchService.armIPC
        savedArmed = KillSwitchService.isArmed
        savedReader = LocalNetworkDevicesSync.readStoredSetting
        LocalNetworkDevicesSync.readStoredSetting = { false }
        LocalNetworkDevicesSync.resetForTesting()
    }

    override func tearDown() {
        KillSwitchService.armIPC = savedIPC
        KillSwitchService.isArmed = savedArmed
        LocalNetworkDevicesSync.readStoredSetting = savedReader
        LocalNetworkDevicesSync.resetForTesting()
        super.tearDown()
    }

    nonisolated private static func reply(echo: Bool?) -> KillSwitchService.ArmReply {
        (armed: true, wanted: true, live: true, healed: false,
         flushedStates: false, killedHosts: 0, localNetworkDevices: echo)
    }

    private func armSession() throws {
        try KillSwitchService.arm(
            apiHosts: [],
            tunnelInterfaces: [],
            proxyEndpoints: [],
            sessionDirectEndpoints: [],
            helperPrepared: true,
            reviewedBundleDirect: false
        )
    }

    /// The Core installs a document built from `setting`.
    private func installCore(_ setting: LocalNetworkDevicesSync.Setting, digest: String) {
        LocalNetworkDevicesSync.documentWritten(digest: digest, setting: setting)
        LocalNetworkDevicesSync.documentInstalled(digest: digest)
    }

    /// The arm request carries `allowLocalNetworkDevices` only when the
    /// setting is on. A helper older than the field rejects any arm that
    /// carries it, so the default (off, or never set) must send nothing; the
    /// helper reads absence as off and renders no LAN pass.
    func testArmRequestCarriesLocalNetworkDevicesOnlyWhenTheSettingIsOn() throws {
        let suite = "LocalNetworkDevicesArmFieldTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        func fields() -> [String: Any] {
            HelperManager.localNetworkDevicesArmFields(
                SettingsKey.allowsLocalNetworkDevices(defaults: defaults)
            )
        }
        XCTAssertTrue(fields().isEmpty, "never set must send no field")
        defaults.set(false, forKey: SettingsKey.allowLocalNetworkDevices)
        XCTAssertTrue(fields().isEmpty, "off must send no field")
        defaults.set(true, forKey: SettingsKey.allowLocalNetworkDevices)
        XCTAssertEqual(fields().count, 1)
        XCTAssertEqual(fields()["allowLocalNetworkDevices"] as? Bool, true)
    }

    /// Rapid toggles in both directions, with the user changing the setting
    /// twice while an arm is in flight: the in-flight arm records only what it
    /// sent, the session is not converged until an arm and a Core document of
    /// the newest generation are both applied, and it ends on the last choice.
    func testRapidTogglesConvergeOnTheLastChoiceInBothDirections() throws {
        // off → on, then on → off → on while the first arm is in flight.
        let firstOn = LocalNetworkDevicesSync.settingChanged(true)
        var echo: Bool? = firstOn.allow
        KillSwitchService.armIPC.deliver = { _ in
            LocalNetworkDevicesSync.settingChanged(false)
            LocalNetworkDevicesSync.settingChanged(true)
            return Self.reply(echo: echo)
        }
        try armSession()
        installCore(firstOn, digest: "doc-1")
        XCTAssertEqual(LocalNetworkDevicesSync.pfApplied, .known(firstOn))
        XCTAssertFalse(LocalNetworkDevicesSync.converged, "a newer generation is pending")

        // The next arm sends the newest generation (on).
        let lastOn = LocalNetworkDevicesSync.desired
        XCTAssertEqual(lastOn.generation, firstOn.generation + 2)
        echo = lastOn.allow
        KillSwitchService.armIPC.deliver = { _ in Self.reply(echo: echo) }
        try armSession()
        XCTAssertFalse(LocalNetworkDevicesSync.converged, "the Core still runs the older document")
        installCore(lastOn, digest: "doc-3")
        XCTAssertTrue(LocalNetworkDevicesSync.converged)

        // on → off.
        let off = LocalNetworkDevicesSync.settingChanged(false)
        XCTAssertFalse(LocalNetworkDevicesSync.converged)
        echo = off.allow
        try armSession()
        installCore(off, digest: "doc-4")
        XCTAssertEqual(LocalNetworkDevicesSync.pfApplied, .known(off))
        XCTAssertEqual(LocalNetworkDevicesSync.coreApplied, .known(off))
        XCTAssertTrue(LocalNetworkDevicesSync.converged)
    }

    /// A result from an older generation (a late reply, a late document)
    /// never overwrites a newer one, known or unknown.
    func testStaleGenerationNeverOverwritesANewerResult() {
        let old = LocalNetworkDevicesSync.settingChanged(true)
        let new = LocalNetworkDevicesSync.settingChanged(false)
        LocalNetworkDevicesSync.recordPF(.known(new))
        LocalNetworkDevicesSync.recordPF(.known(old))
        LocalNetworkDevicesSync.recordPF(.unknown(generation: old.generation))
        XCTAssertEqual(LocalNetworkDevicesSync.pfApplied, .known(new))
        installCore(new, digest: "doc-new")
        installCore(old, digest: "doc-old")
        XCTAssertEqual(LocalNetworkDevicesSync.coreApplied, .known(new))
        XCTAssertTrue(LocalNetworkDevicesSync.converged)
    }

    /// Toggling while connected reloads the Core with PF: with a reload
    /// already running, the toggle queues a full reload behind it (and the
    /// health check's automatic step waits for it).
    func testToggleWhileConnectedQueuesAFullCoreAndPFReload() {
        let app = AppState()
        app.isConnected = true
        let running = Task<Void, Never> {}
        app.connectionCoordinator.configReloadTask = running
        defer { app.connectionCoordinator.configReloadTask = nil }
        app.pendingFullConfigReload = false

        app.localNetworkDevicesSettingChanged(true)

        XCTAssertTrue(app.pendingFullConfigReload, "the toggle must reload the Core, not only re-arm PF")
        XCTAssertEqual(LocalNetworkDevicesSync.desired.allow, true)
        app.pendingFullConfigReload = false
        app.convergeLocalNetworkDevices()
        XCTAssertFalse(app.pendingFullConfigReload, "no automatic attempt while a reload is running")
    }

    /// Automatic convergence is bounded: after the budget the session holds
    /// an explicit fault with a message, and the user's toggle retries.
    func testAutomaticAttemptsStopAtTheBudgetAndTheTogglesRetry() {
        // A connected session: an arm and a Core install of generation 0.
        let initial = LocalNetworkDevicesSync.desired
        LocalNetworkDevicesSync.recordPF(.known(initial))
        installCore(initial, digest: "doc-0")
        XCTAssertFalse(LocalNetworkDevicesSync.takeAutomaticAttempt(), "converged: nothing to do")
        LocalNetworkDevicesSync.settingChanged(true)
        for _ in 0..<LocalNetworkDevicesSync.automaticAttemptLimit {
            XCTAssertTrue(LocalNetworkDevicesSync.takeAutomaticAttempt())
        }
        XCTAssertFalse(LocalNetworkDevicesSync.takeAutomaticAttempt())
        XCTAssertEqual(LocalNetworkDevicesSync.fault, .attemptsExhausted)
        XCTAssertNotNil(LocalNetworkDevicesSync.faultMessage)
        XCTAssertFalse(LocalNetworkDevicesSync.takeAutomaticAttempt(), "no retry loop after the fault")

        LocalNetworkDevicesSync.settingChanged(false)
        XCTAssertNil(LocalNetworkDevicesSync.fault)
        XCTAssertTrue(LocalNetworkDevicesSync.takeAutomaticAttempt())
    }

    /// A helper that does not say what it enforces is older than the
    /// setting. The arm must not report off as applied on it: an explicit
    /// error, protection intent kept, PF unknown, and the fault recorded.
    func testOldHelperWithoutTheEchoIsAnExplicitError() {
        KillSwitchService.isArmed = false
        KillSwitchService.armIPC.deliver = { _ in Self.reply(echo: nil) }
        XCTAssertThrowsError(try armSession()) { error in
            guard case KillSwitchService.Error.localNetworkHelperTooOld = error else {
                return XCTFail("expected the old-helper error: \(error)")
            }
        }
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertEqual(LocalNetworkDevicesSync.pfApplied, .unknown(generation: 0))
        XCTAssertEqual(LocalNetworkDevicesSync.fault, .helperTooOld)
    }

    /// The helper's protected fault (an off re-arm it could not apply) is an
    /// explicit error with intent kept, and stops automatic attempts.
    func testHelperProtectedFaultIsAnExplicitErrorWithoutRetryLoop() {
        let off = LocalNetworkDevicesSync.settingChanged(false)
        installCore(off, digest: "doc-off")
        KillSwitchService.isArmed = false
        KillSwitchService.armIPC.deliver = { _ in
            throw HelperIPCError.commandFailed("block-all installed", code: "KILLSWITCH_LOCAL_NETWORK_FAULT")
        }
        XCTAssertThrowsError(try armSession()) { error in
            guard case KillSwitchService.Error.localNetworkFault = error else {
                return XCTFail("expected the protected fault: \(error)")
            }
        }
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertEqual(LocalNetworkDevicesSync.fault, .helper("block-all installed"))
        XCTAssertFalse(LocalNetworkDevicesSync.takeAutomaticAttempt())
    }
    /// An app whose helper I/O is replaced, so a disconnect runs its whole
    /// sequence without touching the machine.
    private func makeApp(releases: @escaping () -> Void) -> AppState {
        let app = AppState()
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { releases() }
        runtime.releaseAfterFailure = { releases() }
        runtime.restrictToBootstrap = {}
        runtime.refreshKillSwitchStatus = { .confirmed(requiresProtectionRecovery: false) }
        app.networkProtection = runtime
        return app
    }

    /// Review F1: while the helper's protected fault holds, no automatic path
    /// releases PF, tears the session down or reconnects: not the exhausted
    /// failure, not an automatic release, not a scheduled reconnect. The
    /// session keeps protection armed and shows the fault.
    func testProtectedFaultHoldsWithoutAutomaticReleaseOrReconnect() async {
        var releases = 0
        let app = makeApp { releases += 1 }
        app.isConnected = true
        KillSwitchService.isArmed = true
        LocalNetworkDevicesSync.recordFault(.helper("block-all installed"))
        defer { app.connectionCoordinator.cancelReconnectTasks() }

        await app.applyExhaustedArmedFailure(message: "generic failure", resumeWhenReachable: true)
        app.disconnect(releaseKillSwitch: true, automaticFailureRelease: true)
        app.scheduleProtectedReconnect()
        app.scheduleUnarmedReconnect()
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertEqual(releases, 0, "no automatic release while the fault holds")
        XCTAssertNil(app.connectionCoordinator.disconnectSequence, "no teardown")
        XCTAssertTrue(app.isConnected)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask, "no automatic reconnect")
        XCTAssertTrue(app.protectedReconnectPausedForUserAction)
        XCTAssertEqual(app.errorMessage, LocalNetworkDevicesSync.faultMessage)
        XCTAssertNotNil(app.localNetworkDevicesFaultMessage)
    }

    /// No permanent offline: the user's Disconnect from a held fault ends the
    /// fault and releases protection the normal way.
    func testUserDisconnectEndsTheProtectedFaultAndReleases() async {
        var releases = 0
        let app = makeApp { releases += 1 }
        app.isConnected = true
        KillSwitchService.isArmed = true
        LocalNetworkDevicesSync.recordFault(.reArmFailed("re-arm failed"))
        app.showLocalNetworkDevicesFault()
        XCTAssertTrue(app.protectedReconnectPausedForUserAction)

        app.disconnect(releaseKillSwitch: true)
        await app.connectionCoordinator.disconnectSequence?.value

        XCTAssertNil(LocalNetworkDevicesSync.fault)
        XCTAssertNil(app.localNetworkDevicesFaultMessage)
        XCTAssertFalse(app.protectedReconnectPausedForUserAction, "the fault's pause is lifted with it")
        XCTAssertEqual(releases, 1, "the user's Disconnect releases")
        XCTAssertFalse(app.isConnected)
    }
    /// Prompt-free replacement effects whose silent upgrade fails. The status
    /// read optionally rediscovers the helper's protected fault, as
    /// `HelperManager.killSwitchStatus` records it from `protectedFault`.
    private func abandonedReplacement(
        statusReportsFault: Bool,
        stoppedCore: @escaping () -> Void,
        disarm: @escaping () -> Void
    ) -> HelperManager.ReplacementOperations {
        HelperManager.ReplacementOperations(
            restoreDNS: {},
            stopCore: { stoppedCore() },
            killSwitchStatus: {
                if statusReportsFault {
                    LocalNetworkDevicesSync.recordFault(.helper("reported by the helper"))
                }
                return (armed: true, wanted: true, live: true, healed: false)
            },
            checkResources: {},
            silentUpgrade: { false },
            release: HelperManager.AbandonedUpgradeRelease(
                disarm: { disarm() },
                refreshStatus: { .confirmed(requiresProtectionRecovery: false) }
            )
        )
    }

    /// Review F-new (29a81b87): an automatic, prompt-free helper preparation
    /// (the bootstrap restriction of a preserve teardown) stops the previous
    /// Core, the helper's status reports the held protected fault, the silent
    /// upgrade fails and the prompt is withheld. The abandoned-upgrade
    /// cleanup must not disarm: the fault stays held and the install error
    /// surfaces.
    func testAbandonedPromptFreeUpgradeKeepsAHeldProtectedFault() {
        var stopped = 0
        var disarms = 0
        let operations = abandonedReplacement(
            statusReportsFault: true,
            stoppedCore: { stopped += 1 },
            disarm: { disarms += 1 }
        )
        XCTAssertThrowsError(try HelperManager.prepareReplacementBeforePrompt(
            installedVersion: "4.52.47",
            daemonRejected: false,
            administratorPrompt: false,
            operations: operations
        )) { error in
            guard case HelperInstallError.installFailed = error else {
                return XCTFail("the withheld prompt must surface as an install error: \(error)")
            }
        }
        XCTAssertEqual(stopped, 1, "the previous Core was stopped for the replacement")
        XCTAssertEqual(disarms, 0, "an abandoned automatic upgrade must not disarm a held fault")
        XCTAssertTrue(LocalNetworkDevicesSync.holdsProtectedFault)
    }

    /// Controls for the test above: without a fault the same abandoned
    /// upgrade still releases as before, and with the fault held the user's
    /// explicit Disconnect still releases.
    func testAbandonedUpgradeReleasesWithoutAFaultAndUserDisconnectReleasesAHeldOne() async {
        var disarms = 0
        XCTAssertThrowsError(try HelperManager.prepareReplacementBeforePrompt(
            installedVersion: "4.52.47",
            daemonRejected: false,
            administratorPrompt: false,
            operations: abandonedReplacement(
                statusReportsFault: false, stoppedCore: {}, disarm: { disarms += 1 }
            )
        ))
        XCTAssertEqual(disarms, 1, "no fault: the abandoned upgrade releases as before")

        var releases = 0
        let app = makeApp { releases += 1 }
        app.isConnected = true
        KillSwitchService.isArmed = true
        LocalNetworkDevicesSync.recordFault(.helper("reported by the helper"))
        app.showLocalNetworkDevicesFault()
        app.disconnect(releaseKillSwitch: true)
        await app.connectionCoordinator.disconnectSequence?.value
        XCTAssertEqual(releases, 1, "the user's Disconnect releases a held fault")
        XCTAssertFalse(LocalNetworkDevicesSync.holdsProtectedFault)
    }
}
