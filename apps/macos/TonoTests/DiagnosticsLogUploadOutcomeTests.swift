import XCTest
@testable import Tono

/// The Support page's "Upload now" button reports what the sweep did.
///
/// It used to discard the outcome entirely, so a refused POST, a switch that is
/// off and a successful send all rendered the same "the run finished" line —
/// and a customer told support the log had been sent when nothing had left the
/// Mac. That is only recoverable if the sweep says which of the three happened.
final class DiagnosticsLogUploadOutcomeTests: XCTestCase {
    private struct UploadRefused: LocalizedError {
        var errorDescription: String? { "The control plane refused the segment." }
    }

    private func makeDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-log-upload-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory
    }

    func testTheSwitchBeingOffIsNotReportedAsNothingToSend() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        try "{\"a\":1}\n".write(to: log, atomically: true, encoding: .utf8)

        let uploader = DiagnosticsLogUploader(
            auditLogURL: log,
            isEnabled: { false },
            upload: { _, _, _, _, _, _ in
                XCTFail("a disabled uploader must not touch the network")
            }
        )
        let outcome = await uploader.sweep()
        guard case .disabled = outcome else {
            return XCTFail("expected .disabled, got \(outcome)")
        }
    }

    func testAnEmptyLogIsIdleRatherThanDisabled() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        try Data().write(to: log)

        let uploader = DiagnosticsLogUploader(
            auditLogURL: log,
            isEnabled: { true },
            upload: { _, _, _, _, _, _ in
                XCTFail("there are no complete lines to send")
            }
        )
        let outcome = await uploader.sweep()
        guard case .idle = outcome else {
            return XCTFail("expected .idle, got \(outcome)")
        }
    }

    func testARefusedSegmentCarriesTheReasonBack() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        try "{\"a\":1}\n{\"a\":2}\n".write(to: log, atomically: true, encoding: .utf8)

        let uploader = DiagnosticsLogUploader(
            auditLogURL: log,
            isEnabled: { true },
            upload: { _, _, _, _, _, _ in throw UploadRefused() }
        )
        let outcome = await uploader.sweep()
        guard case let .failed(reason) = outcome else {
            return XCTFail("expected .failed, got \(outcome)")
        }
        XCTAssertEqual(reason, UploadRefused().errorDescription)
    }

    func testAnAcceptedSegmentIsReportedAsUploaded() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        try "{\"a\":1}\n".write(to: log, atomically: true, encoding: .utf8)

        let uploader = DiagnosticsLogUploader(
            auditLogURL: log,
            isEnabled: { true },
            upload: { _, _, _, _, _, _ in }
        )
        let outcome = await uploader.sweep()
        guard case .uploaded = outcome else {
            return XCTFail("expected .uploaded, got \(outcome)")
        }
    }
}
