import XCTest
@testable import Tono

final class DiagnosticsLogOwnershipTests: XCTestCase {
    func testAccountReplacementInvalidatesPendingScopeAndKeepsSameOwnerRestart() throws {
        let name = "log-ownership-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let ownership = DiagnosticsLogOwnership(defaults: defaults, enabled: { true })
        let first = try XCTUnwrap(ownership.activate(owner: "a"))
        let restarted = DiagnosticsLogOwnership(defaults: defaults, enabled: { true })
        XCTAssertNil(restarted.currentScope(), "startup is not an authenticated owner")
        XCTAssertEqual(restarted.activate(owner: "a"), first)
        let second = try XCTUnwrap(ownership.activate(owner: "b"))
        XCTAssertNotEqual(first, second)
        XCTAssertFalse(ownership.isCurrent(first))
        XCTAssertNil(ownership.withCurrent(first) { XCTFail("late cursor acknowledgement") })
    }

    func testConsentRevocationNeverRevivesThePreviousScope() throws {
        final class Consent: @unchecked Sendable {
            private let lock = NSLock()
            private var value = true
            nonisolated func get() -> Bool { lock.lock(); defer { lock.unlock() }; return value }
            nonisolated func set(_ value: Bool) { lock.lock(); defer { lock.unlock() }; self.value = value }
        }
        let name = "log-consent-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let consent = Consent()
        let ownership = DiagnosticsLogOwnership(defaults: defaults, enabled: { consent.get() })
        let first = try XCTUnwrap(ownership.activate(owner: "a"))
        consent.set(false)
        ownership.consentChanged()
        XCTAssertFalse(ownership.isCurrent(first))
        consent.set(true)
        ownership.consentChanged()
        XCTAssertNotEqual(ownership.currentScope(), first)
    }

    func testLegacyAndOtherAccountRecordsStayLocalWhileOwnedRecordsUpload() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        let owned = "{\"_uploadScope\":\"new\",\"host\":\"new.example\"}\n"
        let body = "{\"host\":\"legacy.example\"}\n{\"_uploadScope\":\"old\",\"host\":\"old.example\"}\n" + owned
        try Data(body.utf8).write(to: log)
        let expected = try XCTUnwrap(DiagnosticsLogUploader.gzip(Data(owned.utf8)))
        let uploader = DiagnosticsLogUploader(auditLogURL: log, scopeID: "new", isEnabled: { true }) {
            data, _, _, lines, _, _ in
            XCTAssertEqual(lines, 1)
            XCTAssertEqual(data, expected)
        }
        guard case .uploaded = await uploader.sweep() else { return XCTFail("owned record not uploaded") }
        guard case .idle = await uploader.sweep() else { return XCTFail("cursor did not consume excluded lines") }
    }

    /// A prefix that fills one read chunk and contains no line for this scope
    /// used to look like a failed gzip. The cursor stayed put, so the owned
    /// line after that chunk never uploaded.
    func testOwnedLinesAfterAFullForeignChunkStillUpload() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        let foreign = Data("{\"_uploadScope\":\"old\",\"host\":\"old.example\"}\n".utf8)
        var body = Data()
        body.reserveCapacity(DiagnosticsLogUploader.readChunkBytes + foreign.count + 64)
        while body.count < DiagnosticsLogUploader.readChunkBytes {
            body.append(foreign)
        }
        let ownedLine = "{\"_uploadScope\":\"new\",\"host\":\"new.example\"}\n"
        body.append(Data(ownedLine.utf8))
        try body.write(to: log)
        let expected = try XCTUnwrap(DiagnosticsLogUploader.gzip(Data(ownedLine.utf8)))
        let uploader = DiagnosticsLogUploader(auditLogURL: log, scopeID: "new", isEnabled: { true }) {
            data, _, _, lines, _, _ in
            XCTAssertEqual(lines, 1)
            XCTAssertEqual(data, expected)
        }
        guard case .uploaded = await uploader.sweep() else {
            return XCTFail("owned line after a foreign chunk was not uploaded")
        }
        guard case .idle = await uploader.sweep() else {
            return XCTFail("cursor did not advance past the foreign chunk")
        }
    }
}
