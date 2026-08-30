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
            coreVersion: "v1.19.29-tono-gvisor-adaptive.1",
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
        let original = UpdateHandoffStore.fileURL
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-journal-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let journal = UpdateHandoffJournal(
            phase: .protectedHandoffRecorded,
            previousAppVersion: "0.0.67",
            nextAppVersion: "0.0.68",
            coreVersion: "core",
            coreSHA256: "deadbeef",
            buildCommit: "c0ffee",
            helperProtocolVersion: "12",
            wasConnected: true,
            keepKillSwitchArmed: true,
            selectedNodeAnonymousId: "n1",
            catalogRevision: 1,
            connectionGeneration: 3
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(journal)
        let url = directory.appendingPathComponent("update-handoff.json")
        let temp = directory.appendingPathComponent("tmp")
        try data.write(to: temp, options: .atomic)
        try FileManager.default.moveItem(at: temp, to: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(UpdateHandoffJournal.self, from: Data(contentsOf: url))
        XCTAssertEqual(decoded.phase, .protectedHandoffRecorded)
        XCTAssertEqual(decoded.wasConnected, true)
        _ = original
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
}
