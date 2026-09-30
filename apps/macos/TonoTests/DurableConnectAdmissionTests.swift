import XCTest
@testable import Tono

@MainActor
final class DurableConnectAdmissionTests: XCTestCase {
    func testBootRecordWriteFailureIsReturnedToConnectAdmission() throws {
        let preference = AppProfile.defaults.object(forKey: SettingsKey.connectBootSession)
        defer { AppProfile.defaults.set(preference, forKey: SettingsKey.connectBootSession) }
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-boot-write-failure-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("connect-boot-session")
        var writes = 0

        XCTAssertThrowsError(try RuntimeCleanup.recordConnectBootSession(in: file, writer: { _, path in
            writes += 1
            XCTAssertEqual(path, file)
            throw POSIXError(.ENOSPC)
        })) { error in
            XCTAssertEqual((error as? POSIXError)?.code, .ENOSPC)
        }

        XCTAssertEqual(writes, 1)
        AppProfile.defaults.removeObject(forKey: SettingsKey.connectBootSession)
        XCTAssertNil(RuntimeCleanup.recordedConnectBootSession(in: file),
                     "missing durable evidence is why this connect must not be admitted")
    }

    func testConnectRefusesUnsyncedBootRecordWithoutRetiringHeldProtection() {
        let armed = KillSwitchService.isArmed
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        defer {
            KillSwitchService.isArmed = armed
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
        }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        KillSwitchService.isArmed = true
        let app = AppState()
        defer { app.connectionCoordinator.cancelConnectionTasks() }
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID,
            name: "TONO CLOUD", nodes: [Fixture.realityNode()])]
        app.isProtectionBlocked = true
        app.automaticResumeHeldAfterRestart = true
        let generation = app.connectionCoordinator.protectionOperationGeneration
        var records = 0
        app.recordConnectBootSession = {
            records += 1
            throw POSIXError(.ENOSPC)
        }

        app.connect()

        XCTAssertEqual(records, 1)
        XCTAssertFalse(app.isConnecting)
        XCTAssertFalse(app.isConnected)
        XCTAssertNil(app.connectionCoordinator.connectTask)
        XCTAssertNil(app.connectionCoordinator.connectWatchdogTask)
        XCTAssertEqual(app.connectionCoordinator.protectionOperationGeneration, generation)
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertTrue(KillSwitchService.isArmed)
        XCTAssertTrue(app.automaticResumeHeldAfterRestart)
        XCTAssertNotNil(app.errorMessage)
    }

    func testSuccessfulDurableRecordAllowsExplicitRetryToLiftRestartHold() {
        let blocksConnect = RuntimeCleanup.nativeUpdateBlocksConnect
        let selection = AppProfile.defaults.object(forKey: SettingsKey.selectedProxyTargetName)
        defer {
            RuntimeCleanup.nativeUpdateBlocksConnect = blocksConnect
            AppProfile.defaults.set(selection, forKey: SettingsKey.selectedProxyTargetName)
        }
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        let app = AppState()
        defer { app.connectionCoordinator.cancelConnectionTasks() }
        app.proxyRegions = [ProxyRegion(id: AppState.managedCatalogRegionID,
            name: "TONO CLOUD", nodes: [Fixture.realityNode()])]
        app.automaticResumeHeldAfterRestart = true
        var records = 0
        app.recordConnectBootSession = { records += 1 }

        app.connect()

        XCTAssertEqual(records, 1)
        XCTAssertTrue(app.isConnecting)
        XCTAssertNotNil(app.connectionCoordinator.connectTask)
        XCTAssertFalse(app.automaticResumeHeldAfterRestart)
    }
}
