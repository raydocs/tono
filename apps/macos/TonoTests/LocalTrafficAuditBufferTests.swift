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

    func testRecordConnectionsEmitsConnectionClosedWithBytesAndStallFlag() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-audit-closed-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let audit = LocalTrafficAudit(logFileURL: directory.appendingPathComponent("audit.jsonl"))
        let wasEnabled = UserDefaults.standard.object(forKey: SettingsKey.localTrafficAuditEnabled)
        UserDefaults.standard.set(true, forKey: SettingsKey.localTrafficAuditEnabled)
        defer {
            if let wasEnabled {
                UserDefaults.standard.set(wasEnabled, forKey: SettingsKey.localTrafficAuditEnabled)
            } else {
                UserDefaults.standard.removeObject(forKey: SettingsKey.localTrafficAuditEnabled)
            }
        }

        let protection = TrafficAuditProtectionSnapshot(
            connected: true,
            connecting: false,
            protectionBlocked: false,
            killSwitchArmed: true,
            tunPresent: true,
            protectedDNSConfigured: true,
            selectedExit: "JP-Tokyo-01"
        )
        let oldStart = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-8))
        let fastConn = APIConnection(
            id: "c-fast",
            metadata: APIConnectionMetadata(
                network: "tcp",
                type: "TUN",
                process: "Chrome",
                processPath: nil,
                sourceIP: nil,
                destinationIP: "1.1.1.1",
                sourcePort: nil,
                destinationPort: "443",
                host: "www.example.com"
            ),
            upload: 512,
            download: 4_096,
            start: oldStart,
            chains: ["Tono-Exit"],
            rule: "MATCH",
            rulePayload: nil
        )
        let stalledConn = APIConnection(
            id: "c-stalled",
            metadata: APIConnectionMetadata(
                network: "tcp",
                type: "TUN",
                process: "todesk",
                processPath: nil,
                sourceIP: nil,
                destinationIP: "2.2.2.2",
                sourcePort: nil,
                destinationPort: "443",
                host: "down.todesk.com"
            ),
            upload: 256,
            download: 0,
            start: oldStart,
            chains: ["Tono-China-Web-Direct"],
            rule: "DOMAIN-SUFFIX",
            rulePayload: "todesk.com"
        )

        audit.recordConnections([fastConn, stalledConn], protection: protection, residentialContext: nil)
        audit.recordConnections([], protection: protection, residentialContext: nil)
        audit.queue.sync { audit.flushPending() }

        let lines = try String(contentsOf: audit.logFileURL, encoding: .utf8).split(separator: "\n")
        let rows = try lines.map { line in
            try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        }
        let closed = rows.filter { ($0["kind"] as? String) == "connection_closed" }
        XCTAssertEqual(closed.count, 2)
        let fastClosed = try XCTUnwrap(closed.first { ($0["connection_id"] as? String) == "c-fast" })
        XCTAssertEqual(fastClosed["bytes_up"] as? String, "512")
        XCTAssertEqual(fastClosed["bytes_down"] as? String, "4096")
        XCTAssertEqual(fastClosed["stalled"] as? String, "false")
        let stalledClosed = try XCTUnwrap(closed.first { ($0["connection_id"] as? String) == "c-stalled" })
        XCTAssertEqual(stalledClosed["bytes_down"] as? String, "0")
        XCTAssertEqual(stalledClosed["stalled"] as? String, "true")
        let durationMs = try XCTUnwrap((stalledClosed["duration_ms"] as? String).flatMap(Int64.init))
        XCTAssertGreaterThanOrEqual(durationMs, 3_000)
    }
}
