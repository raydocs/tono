import XCTest
@testable import Tono

final class DiagnosticsLogUploadBoundaryTests: XCTestCase {
    private actor UploadGate {
        var entered = false
        var enteredWaiter: CheckedContinuation<Void, Never>?
        var response: CheckedContinuation<Void, Never>?

        func upload() async {
            entered = true
            enteredWaiter?.resume()
            enteredWaiter = nil
            await withCheckedContinuation { response = $0 }
        }

        func waitUntilEntered() async {
            if !entered {
                await withCheckedContinuation { enteredWaiter = $0 }
            }
        }

        func accept() { response?.resume(); response = nil }
    }

    func testManualSweepDoesNotReenterAnInFlightUpload() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        try Data("{\"a\":1}\n".utf8).write(to: log)
        let gate = UploadGate()
        let uploader = DiagnosticsLogUploader(auditLogURL: log, isEnabled: { true }) {
            _, _, _, _, _, _ in await gate.upload()
        }
        let first = Task { await uploader.sweep() }
        await gate.waitUntilEntered()
        let overlapping = await uploader.sweep()
        await gate.accept()
        _ = await first.value
        guard case .busy = overlapping else { return XCTFail("overlapping sweep was not refused") }
    }

    func testLateAcknowledgementCannotRewindAnAccountSwitchBoundary() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-log-boundary-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        try Data("{\"old\":1}\n".utf8).write(to: log)
        let gate = UploadGate()
        let uploader = DiagnosticsLogUploader(
            auditLogURL: log, isEnabled: { true },
            upload: { _, _, _, _, _, _ in await gate.upload() }
        )
        let pending = Task { await uploader.sweep() }
        await gate.waitUntilEntered()
        let handle = try FileHandle(forWritingTo: log)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("{\"old\":2}\n".utf8))
        try handle.close()
        await uploader.abandonUnsentForAccountSwitch()
        await gate.accept()
        _ = await pending.value

        let nextAccount = DiagnosticsLogUploader(
            auditLogURL: log, isEnabled: { true },
            upload: { _, _, _, _, _, _ in XCTFail("previous account's tail was uploaded") }
        )
        let outcome = await nextAccount.sweep()
        guard case .idle = outcome else { return XCTFail("old account boundary was rewound") }
    }
}
