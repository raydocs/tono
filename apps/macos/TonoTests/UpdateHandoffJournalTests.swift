import XCTest
@testable import Tono

final class UpdateHandoffJournalTests: XCTestCase {
    func testEveryPhaseCanAdvanceAndRemainDecodable() throws {
        var journal = UpdateHandoffJournal(
            phase: .idle,
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
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        for phase in UpdateHandoffPhase.allCases {
            journal = journal.advancing(
                to: phase,
                errorCode: phase == .failed ? "UPDATE_RECOVERY_FAILED" : nil,
                errorStage: phase == .failed ? "protectionResuming" : nil
            )
            let data = try encoder.encode(journal)
            let decoded = try decoder.decode(UpdateHandoffJournal.self, from: data)
            XCTAssertEqual(decoded.phase, phase)
            XCTAssertEqual(decoded.previousAppVersion, "0.0.67")
            XCTAssertEqual(decoded.nextAppVersion, "0.0.68")
            XCTAssertEqual(decoded.connectionGeneration, 7)
            XCTAssertTrue(decoded.keepKillSwitchArmed)
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
