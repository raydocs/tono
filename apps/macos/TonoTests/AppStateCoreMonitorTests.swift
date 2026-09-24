import XCTest
@testable import Tono

/// R1-F1 regression: node switches, config reloads and the post-connect
/// background optional policy all restart sing-box through helper `/core/sync`
/// (stop + start), so the owned utun is legitimately absent for a fraction of
/// a second while PF stays armed. The core monitor's owned-TUN verdict must
/// hold through that window instead of failing closed on a healthy session
/// ("connected, then drops and reconnects seconds later"). XCTest cannot drive
/// the privileged helper; the `tunInterfaceExists` seam stands in for the
/// interface syscall and `runCoreMonitorTick(state:)` for one loop iteration.
final class AppStateCoreMonitorTests: XCTestCase {

    /// Explicit suspension instead of sleeps, mirroring the coordinator test
    /// gates: the reload task is genuinely in flight, not a stubbed flag.
    private final class ReloadGate: @unchecked Sendable {
        private let lock = NSLock()
        private var isOpen = false
        private var waiter: CheckedContinuation<Void, Never>?

        func wait() async {
            lock.lock()
            if isOpen {
                lock.unlock()
                return
            }
            await withCheckedContinuation { continuation in
                waiter = continuation
                lock.unlock()
            }
        }

        func open() {
            lock.lock()
            isOpen = true
            let pending = waiter
            waiter = nil
            lock.unlock()
            pending?.resume()
        }
    }

    func testMonitorHoldsMissingTUNVerdictWhileRuntimeReplacementIsInFlight() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        // The owned runtime always runs with TUN; connect() sets this before
        // the monitor ever starts.
        app.config.tunEnabled = true
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        app.tunInterfaceExists = { _ in false }

        let gate = ReloadGate()
        app.connectionCoordinator.configReloadTask = Task { await gate.wait() }
        var state = AppState.CoreMonitorState()

        // Tick inside the replacement window: /core/sync has stopped the old
        // core, the new one has not recreated utun yet, and the reload task
        // still holds the shared runtime-mutation handle. This must not be a
        // verdict.
        let heldOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(heldOutcome, .continueMonitoring)
        XCTAssertTrue(
            app.isConnected,
            "a runtime replacement's no-TUN window must not disconnect the session"
        )
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertNil(app.errorMessage)

        // The replacement finishes and its task handle clears, but the
        // interface is still absent. The tick inside the window already banked
        // one missing sighting, so this sighting completes the persistence
        // requirement and the fail-closed verdict arrives — a real TUN death
        // is still a disconnect, never a skip.
        app.connectionCoordinator.configReloadTask?.cancel()
        gate.open()
        app.connectionCoordinator.configReloadTask = nil
        let verdictOutcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(verdictOutcome, .stopMonitoring)
        XCTAssertFalse(
            app.isConnected,
            "a TUN still absent after the replacement window must fail closed"
        )
        XCTAssertEqual(
            app.errorMessage,
            String(localized: "Protected TUN stopped; Kill Switch is blocking traffic while Tono retries.")
        )

        // Settle the queued teardown through the replaced seams; no real
        // helper I/O runs. The reconnect loop is cancelled before its first
        // backoff sleep can fire.
        app.connectionCoordinator.protectedReconnectTask?.cancel()
        app.connectionCoordinator.protectedReconnectTask = nil
        await app.connectionCoordinator.disconnectSequence?.value
    }

    /// TM-OpenAI-1 regression: the one-minute tick runs the Protected DNS
    /// audit and the PF health check together. A DNS read the helper could
    /// not answer withholds only the DNS verdict; the PF check on the same
    /// tick must still act on a supervisor repair, which reinstalled PF
    /// without this session's direct permits.
    func testUnverifiableDNSAuditStillRunsPFHealthCheck() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        app.config.tunEnabled = true
        // The PF check runs only for the Tono-owned runtime.
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.protectedDNSService = "Wi-Fi"
        let originalArmedState = KillSwitchService.isArmed
        KillSwitchService.isArmed = true
        // isArmed is UserDefaults-backed; do not leak it into other tests.
        defer { KillSwitchService.isArmed = originalArmedState }
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in true }
        runtime.coreStatus = { (false, true) }
        runtime.restoreDNS = { true }
        runtime.disableSystemProxy = {}
        runtime.disarm = {}
        runtime.restrictToBootstrap = {}
        app.networkProtection = runtime
        app.tunInterfaceExists = { _ in true }
        var audits = ProtectionAuditOperations()
        audits.primaryNetworkService = { "Wi-Fi" }
        audits.protectedDNSIntegrity = { _ in .unverifiable }
        audits.killSwitchHealth = { (wanted: true, live: true, repairedSinceArm: true) }
        app.protectionAudits = audits
        var state = AppState.CoreMonitorState()
        // This tick is the twelfth, so both one-minute audits are due.
        state.healthCycle = 11

        let outcome = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(
            outcome, .stopMonitoring,
            "an unverifiable DNS read must not skip the PF health check"
        )
        XCTAssertEqual(app.consecutiveProtectionRepairCount, 1)
        XCTAssertFalse(app.isConnected)
        XCTAssertEqual(
            app.errorMessage,
            String(localized: "Network protection was interrupted by another program; Kill Switch is blocking traffic while Tono reconnects.")
        )

        // Settle the queued teardown through the replaced seams, as above.
        app.connectionCoordinator.protectedReconnectTask?.cancel()
        app.connectionCoordinator.protectedReconnectTask = nil
        await app.connectionCoordinator.disconnectSequence?.value
    }
}
