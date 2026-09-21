import Sparkle
import XCTest
@testable import Tono

@MainActor
final class UpdatePreparationTests: XCTestCase {
    private enum DNSRestoreFailure: Error { case injected }

    private func prepared() -> UpdateHandoffJournal {
        UpdateHandoffJournal(
            phase: .updatePrepared,
            previousAppVersion: "0.0.72", nextAppVersion: "0.0.73",
            coreVersion: "test", coreSHA256: "", buildCommit: "test",
            helperProtocolVersion: HelperProtocolVersion.current,
            wasConnected: false, keepKillSwitchArmed: true,
            selectedNodeAnonymousId: nil, catalogRevision: nil,
            connectionGeneration: 9
        )
    }

    func testUpdateSnapshotDoesNotInventRuntimeIdentityAndPreservesKnownCatalog() {
        let app = AppState()
        app.managedCatalogVersion = 73
        app.isProtectionBlocked = true
        let journal = app.softwareUpdateJournal(nextVersion: "0.0.74")
        XCTAssertEqual(journal.coreVersion, "unknown", "no live Core version was read")
        XCTAssertEqual(journal.coreSHA256, "", "a packaged input digest is not running-binary evidence")
        XCTAssertEqual(journal.buildCommit, "", "CFBundleVersion is not a source commit")
        XCTAssertEqual(journal.catalogRevision, 73)
        XCTAssertEqual(journal.nextAppVersion, "0.0.74")
        XCTAssertTrue(journal.keepKillSwitchArmed)
        XCTAssertEqual(journal.helperProtocolVersion, HelperProtocolVersion.current)
    }

    func testProtectedHandoffRequiresALiveBarrierNotOnlyIntent() {
        XCTAssertFalse(UpdatePreparation.protectionMatches(
            keepKillSwitchArmed: true, armed: false, wanted: true, live: false
        ))
        XCTAssertTrue(UpdatePreparation.protectionMatches(
            keepKillSwitchArmed: true, armed: true, wanted: true, live: true
        ))
        XCTAssertFalse(UpdatePreparation.protectionMatches(
            keepKillSwitchArmed: false, armed: false, wanted: true, live: false
        ))
        XCTAssertTrue(UpdatePreparation.protectionMatches(
            keepKillSwitchArmed: false, armed: false, wanted: false, live: false
        ))
    }

    func testDNSRestoreFailureRecordsFailureAndVetoesSparkleContinuation() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-update-preparation-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("update-handoff.json")
        let delegate = TonoSparkleDelegate()
        // No update checking, helper, PF, DNS or real user journal is used.
        let controller = SPUStandardUpdaterController(
            startingUpdater: false, updaterDelegate: delegate, userDriverDelegate: nil
        )
        XCTAssertTrue(delegate.responds(to: NSSelectorFromString("updaterShouldRelaunchApplication:")))
        XCTAssertTrue(delegate.responds(to: NSSelectorFromString("updater:didFinishUpdateCycleForUpdateCheck:error:")))
        var continued = false
        var installationPermitted = false
        await delegate.prepareInstallation(prepare: {
            _ = try await UpdatePreparation.run(self.prepared(), at: url) {
                throw DNSRestoreFailure.injected
            }
        }, installHandler: {
            continued = true
            // Pinned Sparkle rechecks this veto before installing; continuation
            // on failure must finish the cycle through abort, not hang it.
            installationPermitted = delegate.updaterShouldRelaunchApplication(controller.updater)
        })
        XCTAssertTrue(continued)
        XCTAssertFalse(installationPermitted)
        let failed = try XCTUnwrap(UpdateHandoffStore.load(at: url))
        XCTAssertEqual(failed.phase, .failed)
        XCTAssertEqual(failed.lastErrorStage, "runtimeQuiescence")
        XCTAssertTrue(failed.keepKillSwitchArmed)

        delegate.updater(controller.updater, didFinishUpdateCycleFor: .updates, error: nil)
        await delegate.prepareInstallation(prepare: {
            let journal = try await UpdatePreparation.run(self.prepared(), at: url, quiesce: {})
            try UpdateHandoffStore.write(journal.advancing(to: .installStarted), at: url)
        }, installHandler: {
            installationPermitted = delegate.updaterShouldRelaunchApplication(controller.updater)
        })
        XCTAssertTrue(installationPermitted, "a failed cycle must not permanently veto a later retry")
        XCTAssertEqual(UpdateHandoffStore.load(at: url)?.phase, .installStarted)
    }

    func testPreparationArchivesRawEvidenceAndRefusesAnArchiveFailure() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-update-history-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("update-handoff.json")
        let previous = Data("corrupt previous update evidence".utf8)
        try previous.write(to: url)
        let completed = try await UpdatePreparation.run(prepared(), at: url, quiesce: {})
        XCTAssertEqual(completed.phase, .protectedHandoffRecorded)
        let history = url.deletingPathExtension().appendingPathExtension("history")
        let archives = try FileManager.default.contentsOfDirectory(at: history, includingPropertiesForKeys: nil)
        XCTAssertEqual(archives.count, 1)
        XCTAssertEqual(try Data(contentsOf: archives[0]), previous)

        // Occupy the archive directory with a file: persistence must fail
        // before cleanup, without overwriting the current journal.
        let current = try Data(contentsOf: url)
        try FileManager.default.removeItem(at: history)
        try Data("not a directory".utf8).write(to: history)
        var quiesced = false
        do {
            _ = try await UpdatePreparation.run(prepared(), at: url) { quiesced = true }
            XCTFail("an archive failure must refuse preparation")
        } catch {}
        XCTAssertFalse(quiesced)
        XCTAssertEqual(try Data(contentsOf: url), current)
    }
}
