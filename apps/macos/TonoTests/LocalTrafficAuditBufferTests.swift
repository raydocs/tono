import XCTest
@testable import Tono

final class LocalTrafficAuditBufferTests: XCTestCase {
    func testFailedWritesRetainABoundedRecentTailAndReportLossAfterRecovery() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-audit-buffer-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let blocked = directory.appendingPathComponent("blocked")
        try Data("not a directory".utf8).write(to: blocked)
        let audit = LocalTrafficAudit(logFileURL: blocked.appendingPathComponent("audit.jsonl"))

        try audit.queue.sync {
            // Real serialization, rotation and write-failure handling; only the
            // destination changes. No user log or upload ownership is involved.
            for index in 0..<512 {
                audit.enqueue(kind: "fixture", fields: ["index": String(index)], force: true)
            }
            XCTAssertEqual(audit.pending.count, 256, "repeated write refusal must not grow the entry queue")
            for index in 512..<672 {
                audit.enqueue(kind: "fixture", fields: [
                    "index": String(index),
                    // Multi-byte text distinguishes a byte cap from a character cap.
                    "detail": String(repeating: "é", count: 3_000),
                ], force: true)
            }
            XCTAssertLessThanOrEqual(audit.pendingBytes, 256 * 1_024)
            XCTAssertGreaterThanOrEqual(audit.pending.count, 40, "keep the recent evidence that fits, not an empty queue")
            XCTAssertFalse(FileManager.default.fileExists(atPath: audit.logFileURL.path))

            try FileManager.default.removeItem(at: blocked)
            try FileManager.default.createDirectory(at: blocked, withIntermediateDirectories: true)
            audit.flushPending()
            XCTAssertTrue(audit.pending.isEmpty)
            XCTAssertEqual(audit.pendingBytes, 0)
        }

        let lines = try String(contentsOf: audit.logFileURL, encoding: .utf8).split(separator: "\n")
        let rows = try lines.map { line in
            try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        }
        let loss = try XCTUnwrap(rows.first)
        XCTAssertEqual(loss["kind"] as? String, "audit_dropped")
        XCTAssertNil(loss["_uploadScope"], "loss across account boundaries stays local")
        let retained = rows.dropFirst().compactMap { ($0["index"] as? String).flatMap(Int.init) }
        XCTAssertEqual(retained, Array((672 - retained.count)..<672))
        XCTAssertEqual(loss["dropped_entries"] as? Int, 672 - retained.count)
        XCTAssertLessThanOrEqual(try Data(contentsOf: audit.logFileURL).count, 257 * 1_024)
    }
}
