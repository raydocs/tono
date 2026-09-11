import XCTest
@testable import Tono

final class UpdateHandoffJournalTests: XCTestCase {
    /// The sequence a protected update actually walks, written out rather than
    /// derived from `UpdateHandoffPhase.allCases`. Iterating the enum walked
    /// its declaration order, which happens to be the one legal chain, so the
    /// guard could not fail for the reason it was written — and it passed while
    /// production advanced out of order on its very first step.
    private static let protectedUpdateSequence: [UpdateHandoffPhase] = [
        .updatePrepared,
        .connectionQuiescing,
        .cleanShutdownCompleted,
        .protectedHandoffRecorded,
        .installStarted,
        .firstLaunchMigration,
        .protectionResuming,
        .verified,
        .committed,
    ]

    /// A Mac that was not protected when the install began records no protected
    /// handoff and has no protection to resume on the other side.
    private static let unprotectedUpdateSequence: [UpdateHandoffPhase] = [
        .updatePrepared,
        .connectionQuiescing,
        .cleanShutdownCompleted,
        .installStarted,
        .firstLaunchMigration,
        .verified,
        .committed,
    ]

    private func fixture(phase: UpdateHandoffPhase) -> UpdateHandoffJournal {
        UpdateHandoffJournal(
            phase: phase,
            previousAppVersion: "0.0.67",
            nextAppVersion: "0.0.68",
            coreVersion: "v1.19.30-tono-gvisor-adaptive.1",
            coreSHA256: String(repeating: "a", count: 64),
            buildCommit: "abc123",
            helperProtocolVersion: "12",
            wasConnected: true,
            keepKillSwitchArmed: true,
            selectedNodeAnonymousId: "node-1",
            catalogRevision: 44,
            connectionGeneration: 7
        )
    }

    private func assertSequenceAdvances(
        _ sequence: [UpdateHandoffPhase],
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        var journal = fixture(phase: .idle)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        for phase in sequence {
            XCTAssertTrue(
                journal.canAdvance(to: phase),
                "\(journal.phase.rawValue)->\(phase.rawValue) is a step production takes",
                file: file,
                line: line
            )
            journal = journal.advancing(to: phase)
            let data = try encoder.encode(journal)
            let decoded = try decoder.decode(UpdateHandoffJournal.self, from: data)
            XCTAssertEqual(decoded.phase, phase, file: file, line: line)
            XCTAssertNil(decoded.lastErrorCode, file: file, line: line)
            XCTAssertEqual(decoded.previousAppVersion, "0.0.67", file: file, line: line)
            XCTAssertEqual(decoded.nextAppVersion, "0.0.68", file: file, line: line)
            XCTAssertEqual(decoded.connectionGeneration, 7, file: file, line: line)
            XCTAssertTrue(decoded.keepKillSwitchArmed, file: file, line: line)
        }
    }

    func testProtectedUpdateSequenceAdvancesAndRemainsDecodable() throws {
        try assertSequenceAdvances(Self.protectedUpdateSequence)
    }

    func testUnprotectedUpdateSequenceAdvancesAndRemainsDecodable() throws {
        try assertSequenceAdvances(Self.unprotectedUpdateSequence)
    }

    /// Refusing a transition used to rewrite the phase to `failed`, which made
    /// every later transition illegal too and persisted a state the update had
    /// never reached. The refusal has to be visible without costing the journal.
    func testIllegalTransitionIsRefusedWithoutCorruptingThePhase() {
        let journal = fixture(phase: .installStarted)
        XCTAssertFalse(journal.canAdvance(to: .committed))

        let refused = journal.advancing(to: .committed)
        XCTAssertEqual(refused.phase, .installStarted)
        XCTAssertTrue(refused.refusedIllegalTransition)
        XCTAssertEqual(refused.lastErrorCode, UpdateHandoffJournal.illegalPhaseErrorCode)
        XCTAssertEqual(refused.lastErrorStage, "installStarted->committed")

        // The journal is still usable: the step production does take next still
        // lands, and clears the refusal it recorded.
        let resumed = refused.advancing(to: .firstLaunchMigration)
        XCTAssertEqual(resumed.phase, .firstLaunchMigration)
        XCTAssertNil(resumed.lastErrorCode)
        XCTAssertFalse(resumed.refusedIllegalTransition)
    }

    func testFailureIsRecordableFromEveryPhaseAndKeepsItsOwnCode() {
        for phase in UpdateHandoffPhase.allCases {
            let failed = fixture(phase: phase).advancing(
                to: .failed,
                errorCode: ProtectedFailureCode.updateRecoveryFailed.rawValue,
                errorStage: "cleanupStaleRuntime"
            )
            XCTAssertEqual(failed.phase, .failed)
            XCTAssertEqual(failed.lastErrorCode, "UPDATE_RECOVERY_FAILED")
            XCTAssertFalse(failed.refusedIllegalTransition)
        }
    }

    func testAtomicWriteRoundTrip() throws {
        try withStore { url in
            let journal = fixture(phase: .protectedHandoffRecorded)
            try UpdateHandoffStore.write(journal, at: url)
            let decoded = try XCTUnwrap(UpdateHandoffStore.load(at: url))
            XCTAssertEqual(decoded.phase, .protectedHandoffRecorded)
            XCTAssertEqual(decoded.wasConnected, true)
            XCTAssertEqual(decoded.coreSHA256, journal.coreSHA256)
            XCTAssertEqual(decoded.connectionGeneration, journal.connectionGeneration)
            let leftovers = try FileManager.default.contentsOfDirectory(
                at: url.deletingLastPathComponent(), includingPropertiesForKeys: nil)
            XCTAssertEqual(leftovers.map(\.lastPathComponent), ["update-handoff.json"])
        }
    }

    func testSkippedPhaseIsRefusedAndJournalFileRemains() throws {
        try withStore { url in
            try UpdateHandoffStore.write(fixture(phase: .connectionQuiescing), at: url)
            let journal = try XCTUnwrap(UpdateHandoffStore.load(at: url))
            let refused = journal.advancing(to: .firstLaunchMigration)
            XCTAssertEqual(refused.phase, .connectionQuiescing)
            XCTAssertTrue(refused.refusedIllegalTransition)
            try UpdateHandoffStore.write(refused, at: url)
            let loaded = try XCTUnwrap(UpdateHandoffStore.load(at: url))
            XCTAssertEqual(loaded.phase, .connectionQuiescing)
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
            XCTAssertEqual(loaded.lastErrorCode, UpdateHandoffJournal.illegalPhaseErrorCode)
        }
    }

    func testExpiredJournalIsNotResumedAsSuccess() {
        let journal = UpdateHandoffJournal(
            phase: .protectionResuming,
            previousAppVersion: "0.0.67",
            nextAppVersion: "0.0.68",
            coreVersion: "core",
            coreSHA256: "ab",
            buildCommit: "cd",
            helperProtocolVersion: "12",
            wasConnected: true,
            keepKillSwitchArmed: true,
            selectedNodeAnonymousId: nil,
            catalogRevision: nil,
            connectionGeneration: 1,
            expiresAt: Date().addingTimeInterval(-60)
        )
        XCTAssertTrue(journal.isExpired)
    }
    private func withStore(_ body: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-journal-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory.appendingPathComponent("update-handoff.json"))
    }

    func testExpiredJournalRetainsExactEvidence() throws {
        try withStore { url in
            var journal = fixture(phase: .failed)
            journal.expiresAt = Date().addingTimeInterval(-60)
            try UpdateHandoffStore.write(journal, at: url)
            let before = try Data(contentsOf: url)
            XCTAssertNil(UpdateHandoffStore.load(at: url))
            XCTAssertEqual(try Data(contentsOf: url), before)
        }
    }

    func testFailedOrIncompleteRecoveryCannotCommitOrEraseEvidence() throws {
        for phase: UpdateHandoffPhase in [.failed, .updatePrepared, .connectionQuiescing,
                                         .cleanShutdownCompleted, .protectedHandoffRecorded,
                                         .installStarted, .firstLaunchMigration] {
            try withStore { url in
                try UpdateHandoffStore.write(fixture(phase: phase), at: url)
                let before = try Data(contentsOf: url)
                XCTAssertFalse(try UpdateHandoffStore.commitVerifiedRecovery(
                    currentAppVersion: "0.0.68", at: url), phase.rawValue)
                XCTAssertEqual(try Data(contentsOf: url), before, phase.rawValue)
            }
        }
    }

    func testOldProcessCannotCommitNewVersionRecovery() throws {
        try withStore { url in
            try UpdateHandoffStore.write(fixture(phase: .protectionResuming), at: url)
            let before = try Data(contentsOf: url)
            XCTAssertFalse(try UpdateHandoffStore.commitVerifiedRecovery(
                currentAppVersion: "0.0.67", at: url))
            XCTAssertEqual(try Data(contentsOf: url), before)
        }
    }

    func testVerifiedRecoveryPersistsEachPhaseBeforeRemoval() throws {
        try withStore { url in
            try UpdateHandoffStore.write(fixture(phase: .protectionResuming), at: url)
            var phases: [UpdateHandoffPhase] = []
            XCTAssertTrue(try UpdateHandoffStore.commitVerifiedRecovery(
                currentAppVersion: "0.0.68", at: url,
                persist: { journal, path in
                    phases.append(journal.phase)
                    try UpdateHandoffStore.write(journal, at: path)
                }))
            XCTAssertEqual(phases, [.verified, .committed])
            XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        }
    }

    func testPersistenceFailureNeverClaimsCommitOrRemovesJournal() throws {
        struct InjectedWriteFailure: Error {}
        for failingPhase: UpdateHandoffPhase in [.verified, .committed] {
            try withStore { url in
                try UpdateHandoffStore.write(fixture(phase: .protectionResuming), at: url)
                XCTAssertThrowsError(try UpdateHandoffStore.commitVerifiedRecovery(
                    currentAppVersion: "0.0.68", at: url,
                    persist: { journal, path in
                        if journal.phase == failingPhase { throw InjectedWriteFailure() }
                        try UpdateHandoffStore.write(journal, at: path)
                    }))
                let retained = try XCTUnwrap(UpdateHandoffStore.load(at: url))
                XCTAssertEqual(retained.phase, failingPhase == .verified ? .protectionResuming : .verified)
            }
        }
    }

    func testUnprotectedFirstLaunchCanCommitAfterActualConnectionVerification() throws {
        try withStore { url in
            var journal = fixture(phase: .firstLaunchMigration)
            journal.wasConnected = false
            journal.keepKillSwitchArmed = false
            try UpdateHandoffStore.write(journal, at: url)
            XCTAssertTrue(try UpdateHandoffStore.commitVerifiedRecovery(
                currentAppVersion: "0.0.68", at: url))
            XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        }
    }

    func testVerifiedPhaseRetriesOnlyCommitPersistence() throws {
        try withStore { url in
            try UpdateHandoffStore.write(fixture(phase: .verified), at: url)
            var phases: [UpdateHandoffPhase] = []
            XCTAssertTrue(try UpdateHandoffStore.commitVerifiedRecovery(
                currentAppVersion: "0.0.68", at: url,
                persist: { journal, path in
                    phases.append(journal.phase)
                    try UpdateHandoffStore.write(journal, at: path)
                }))
            XCTAssertEqual(phases, [.committed])
        }
    }

    func testCorruptJournalIsNotErasedOrReplacedByConnectionSuccess() throws {
        try withStore { url in
            let bytes = Data("{corrupt handoff evidence".utf8)
            try bytes.write(to: url)
            XCTAssertFalse(try UpdateHandoffStore.commitVerifiedRecovery(
                currentAppVersion: "0.0.68", at: url))
            XCTAssertEqual(try Data(contentsOf: url), bytes)
        }
    }

    func testFailedJournalSurfacesIncompleteUpdateCopyAndKeepsTheFile() throws {
        try withStore { url in
            try UpdateHandoffStore.write(fixture(phase: .failed), at: url)
            XCTAssertTrue(UpdateHandoffStore.showsIncompleteUpdate(at: url))
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
            XCTAssertEqual(
                UpdateHandoffStore.incompleteUpdateCopy,
                String(localized: "The update did not finish. Disconnect, then reinstall Tono.")
            )
        }
        XCTAssertFalse(UpdateHandoffStore.showsIncompleteUpdate(at: FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-missing-update-handoff.json")))
    }

    func testNoJournalDoesNotReportUpdateRecovery() throws {
        try withStore { url in
            XCTAssertFalse(try UpdateHandoffStore.commitVerifiedRecovery(
                currentAppVersion: "0.0.68", at: url))
            XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        }
    }

    func testOldBinaryAfterInstallStartedFailsAndKeepsTheFile() throws {
        try withStore { url in
            try UpdateHandoffStore.write(fixture(phase: .installStarted), at: url)
            let loaded = try XCTUnwrap(try UpdateHandoffStore.recordFirstLaunchMigration(
                currentAppVersion: "0.0.67", at: url))
            XCTAssertEqual(loaded.phase, .failed)
            XCTAssertEqual(loaded.lastErrorCode, "TONO_UPDATE_INSTALL_ABORTED")
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        }
    }

    func testNewBinaryRecordsFirstLaunchFromInstallStarted() throws {
        try withStore { url in
            try UpdateHandoffStore.write(fixture(phase: .installStarted), at: url)
            let loaded = try XCTUnwrap(try UpdateHandoffStore.recordFirstLaunchMigration(
                currentAppVersion: "0.0.68", at: url))
            XCTAssertEqual(loaded.phase, .firstLaunchMigration)
        }
    }

}
