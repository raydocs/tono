// Compiled and run by tooling/scripts/test-diagnostics-log-upload.sh.
//
// The upload itself is covered by the Worker suite; what has no coverage
// there is the client's cursor, which has to survive LocalTrafficAudit
// rotating the file out from under it. Getting that wrong is silent in
// both directions — a lost window or a re-uploaded one — so it is tested
import Foundation
// against real files on disk rather than a mocked file system.
// Minimal stand-ins so the real uploader source compiles standalone. Only the
// default-argument surface is needed; nothing here is exercised by the test.
final class LocalTrafficAudit {
    static let shared = LocalTrafficAudit()
    static let maximumBackups = 2
    let logFileURL = URL(fileURLWithPath: "/tmp/does-not-exist/traffic-audit.jsonl")
}
enum SettingsKey { static let networkLogUploadEnabled = "networkLogUploadEnabled" }
enum AppProfile { static let defaults = UserDefaults.standard }


@MainActor final class Captured {
    static var segments: [(seq: Int, lines: Int, text: String)] = []
}

func gunzipToText(_ data: Data) throws -> String {
    let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("seg-\(UUID().uuidString).gz")
    try data.write(to: tmp)
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/gunzip")
    p.arguments = ["-c", tmp.path]
    let pipe = Pipe(); p.standardOutput = pipe
    try p.run()
    let out = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    try? FileManager.default.removeItem(at: tmp)
    guard p.terminationStatus == 0 else { throw NSError(domain: "gunzip", code: 1) }
    return String(decoding: out, as: UTF8.self)
}

func line(_ n: Int) -> String {
    // ~120 bytes each, shaped like a real audit record.
    "{\"kind\":\"connection_opened\",\"n\":\(n),\"host\":\"h\(n).example.test\",\"process\":\"WeChat\",\"route\":\"Tono-China-Direct\",\"pad\":\"\(String(repeating: "x", count: 40))\"}\n"
}

func makeUploader(_ url: URL) -> DiagnosticsLogUploader {
    DiagnosticsLogUploader(
        auditLogURL: url,
        clientVersion: "0.0.63",
        osVersion: "macOS 26.3",
        isEnabled: { true },
        upload: { payload, _, sequence, lineCount, _, _ in
            let text = try gunzipToText(payload)
            await MainActor.run { Captured.segments.append((sequence, lineCount, text)) }
        }
    )
}

@main
struct DiagnosticsLogUploaderTests {
    static func main() async throws {
        var failures = 0
        func check(_ name: String, _ ok: Bool, _ detail: String = "") {
            print(ok ? "  ok   \(name)" : "  FAIL \(name) \(detail)")
            if !ok { failures += 1 }
        }

        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("dlu-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let logURL = root.appendingPathComponent("traffic-audit.jsonl")

        // --- 1. partial trailing line is never sent -------------------------------
        var body = (1...50).map(line).joined()
        body += "{\"kind\":\"partial\",\"no\":\"newline yet"          // writer mid-flush
        try body.write(to: logURL, atomically: true, encoding: .utf8)
        let uploader = makeUploader(logURL)
        await uploader.sweep()
        var captured = await MainActor.run { Captured.segments }
        check("one segment sent", captured.count == 1, "got \(captured.count)")
        check("segment ends on a newline", captured.first?.text.hasSuffix("}\n") == true)
        check("partial line withheld", captured.first?.text.contains("newline yet") == false)
        check("line count matches", captured.first?.lines == 50, "got \(captured.first?.lines ?? -1)")

        // --- 2. second sweep sends only what is new ------------------------------
        try (body + (51...60).map(line).joined()).write(to: logURL, atomically: false, encoding: .utf8)
        await uploader.sweep()
        captured = await MainActor.run { Captured.segments }
        check("cursor advanced, new segment", captured.count == 2, "got \(captured.count)")
        if captured.count == 2 {
            check("no re-send of line 1", captured[1].text.contains("\"n\":1,") == false)
            check("contains the new lines", captured[1].text.contains("\"n\":60,"))
            check("sequence incremented", captured[1].seq == 1, "got \(captured[1].seq)")
        }

        // --- 3. nothing new -> nothing sent -------------------------------------
        await uploader.sweep()
        captured = await MainActor.run { Captured.segments }
        check("idle sweep sends nothing", captured.count == 2, "got \(captured.count)")

        // --- 4. rotation: the unsent tail of the rotated file is not lost --------
        try (body + (51...60).map(line).joined() + (61...80).map(line).joined())
            .write(to: logURL, atomically: false, encoding: .utf8)          // 20 unsent lines
        try FileManager.default.moveItem(                                    // rotate
            at: logURL, to: root.appendingPathComponent("traffic-audit.jsonl.1"))
        try (100...110).map(line).joined().write(to: logURL, atomically: true, encoding: .utf8)
        await uploader.sweep()
        captured = await MainActor.run { Captured.segments }
        let joined = captured.dropFirst(2).map(\.text).joined()
        check("rotated tail recovered", joined.contains("\"n\":80,"), "segments=\(captured.count)")
        check("new file picked up", joined.contains("\"n\":110,"))
        check("no duplicate of already-sent", joined.contains("\"n\":1,") == false)

        try? FileManager.default.removeItem(at: root)
        print(failures == 0 ? "\nall cursor/rotation checks passed" : "\n\(failures) FAILED")
        exit(failures == 0 ? 0 : 1)

    }
}
