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

        // --- 5. incomplete rotated tail is retried, not abandoned ----------------
        let extraComplete = (111...115).map(line).joined()
        let extraPartial = "{\"kind\":\"partial-rotate\",\"n\":116,\"no\":\"newline yet"
        let appendHandle = try FileHandle(forWritingTo: logURL)
        try appendHandle.seekToEnd()
        try appendHandle.write(contentsOf: Data((extraComplete + extraPartial).utf8))
        try appendHandle.close()
        try FileManager.default.removeItem(
            at: root.appendingPathComponent("traffic-audit.jsonl.1")
        )
        try FileManager.default.moveItem(
            at: logURL, to: root.appendingPathComponent("traffic-audit.jsonl.1")
        )
        try (300...305).map(line).joined().write(to: logURL, atomically: true, encoding: .utf8)
        await uploader.sweep()
        captured = await MainActor.run { Captured.segments }
        let afterIncomplete = captured.map(\.text).joined()
        check(
            "incomplete backup does not skip to live file",
            afterIncomplete.contains("\"n\":300,") == false,
            "segments=\(captured.count)"
        )
        let backup = root.appendingPathComponent("traffic-audit.jsonl.1")
        if let handle = try? FileHandle(forWritingTo: backup) {
            try handle.seekToEnd()
            try handle.write(contentsOf: Data("\"}\n".utf8))
            try handle.close()
        }
        await uploader.sweep()
        captured = await MainActor.run { Captured.segments }
        let afterRetry = captured.map(\.text).joined()
        check("retried backup recovered new complete lines", afterRetry.contains("\"n\":115,"))
        check("live file picked up after backup retry", afterRetry.contains("\"n\":305,"))

        // --- 6. account switch does not upload leftover JSONL --------------------
        let beforeAbandon = captured.count
        let leftoverHandle = try FileHandle(forWritingTo: logURL)
        try leftoverHandle.seekToEnd()
        try leftoverHandle.write(contentsOf: Data((400...405).map(line).joined().utf8))
        try leftoverHandle.close()
        await uploader.abandonUnsentForAccountSwitch()
        let switched = makeUploader(logURL)
        await switched.sweep()
        captured = await MainActor.run { Captured.segments }
        check(
            "abandoned tail is not uploaded under the next session",
            captured.count == beforeAbandon
                && captured.map(\.text).joined().contains("\"n\":400,") == false,
            "segments=\(captured.count)"
        )

        // --- 6b. the file grew while we were reading it --------------------------
        // `size` is measured before the read and the cursor is known only after
        // it, with `LocalTrafficAudit` appending in between from this same
        // process. A read that returns bytes newer than the measurement puts the
        // cursor past `size`, and on UInt64 that subtraction is a trap, not a
        // negative number. It crashed the shipped 0.0.64 build twice on one Mac
        // inside two hours, byte-identical stacks, SIGTRAP on a background
        // cooperative thread.
        check(
            "cursor past the measured size reports nothing left, not a trap",
            DiagnosticsLogUploader.remainingBytes(size: 100, consumedThrough: 140) == 0,
            "got \(DiagnosticsLogUploader.remainingBytes(size: 100, consumedThrough: 140))"
        )
        check(
            "an exhausted file reports nothing left",
            DiagnosticsLogUploader.remainingBytes(size: 100, consumedThrough: 100) == 0
        )
        check(
            "an ordinary partial read still reports the tail",
            DiagnosticsLogUploader.remainingBytes(size: 100, consumedThrough: 40) == 60
        )

        // --- 7. a rotated tail that never completes must not stall uploads -------
        // The retry in case 5 is for the flush that was in flight when the
        // rename happened. Nothing else ever writes a rotated file, so a tail
        // that stays unreadable has to be given up: the cursor cannot leave a
        // backup by itself, and while it points at one the live file is never
        // read, so "retry forever" is the upload stopping for good.
        let stallRoot = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("dlu-stall-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: stallRoot, withIntermediateDirectories: true
        )
        let stallLog = stallRoot.appendingPathComponent("traffic-audit.jsonl")
        try (1...5).map(line).joined().write(to: stallLog, atomically: true, encoding: .utf8)
        await MainActor.run { Captured.segments.removeAll() }
        let stalled = makeUploader(stallLog)
        await stalled.sweep()                                   // cursor now on this inode
        // Append a line with no terminator at all, then rotate: the backup's
        // unsent tail can never be completed by anyone.
        let stallHandle = try FileHandle(forWritingTo: stallLog)
        try stallHandle.seekToEnd()
        try stallHandle.write(contentsOf: Data("{\"kind\":\"never-terminated\"".utf8))
        try stallHandle.close()
        try FileManager.default.moveItem(
            at: stallLog, to: stallRoot.appendingPathComponent("traffic-audit.jsonl.1")
        )
        try (900...905).map(line).joined().write(to: stallLog, atomically: true, encoding: .utf8)
        var stallSweeps = 0
        var recovered = false
        while stallSweeps < 12 {
            await stalled.sweep()
            stallSweeps += 1
            let text = await MainActor.run { Captured.segments.map(\.text).joined() }
            if text.contains("\"n\":905,") {
                recovered = true
                break
            }
        }
        check(
            "unreadable rotated tail is abandoned so the live file resumes",
            recovered,
            "still stalled after \(stallSweeps) sweeps"
        )
        try? FileManager.default.removeItem(at: stallRoot)

        try? FileManager.default.removeItem(at: root)
        print(failures == 0 ? "\nall cursor/rotation checks passed" : "\n\(failures) FAILED")
        exit(failures == 0 ? 0 : 1)

    }
}
