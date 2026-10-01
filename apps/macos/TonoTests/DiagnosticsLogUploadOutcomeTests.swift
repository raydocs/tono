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

    private actor SentLineCounts {
        var values: [Int] = []
        func append(_ value: Int) { values.append(value) }
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

    /// Upload is on by default and the server stores nothing unless ops opened
    /// a collection window, so "not stored" is the everyday answer. It used to
    /// be treated as a failed send: the same full segment went out again every
    /// 16 minutes, forever, through the exit node.
    func testANotStoredReceiptStandsDownToASmallProbe() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        let line = "{\"host\":\"example.com\",\"pad\":\"" + String(repeating: "x", count: 200) + "\"}\n"
        try String(repeating: line, count: 1_200).write(to: log, atomically: true, encoding: .utf8)

        let sent = SentLineCounts()
        let uploader = DiagnosticsLogUploader(
            auditLogURL: log,
            isEnabled: { true },
            upload: { _, _, _, lineCount, _, _ in
                await sent.append(lineCount)
                throw DiagnosticsLogNotStoredError()
            }
        )
        let first = await uploader.sweep()
        guard case .failed = first else {
            return XCTFail("expected .failed, got \(first)")
        }
        let interval = await uploader.sleepInterval(after: first)
        XCTAssertEqual(interval, DiagnosticsLogUploader.declinedIntervalSeconds)
        _ = await uploader.sweep()

        let counts = await sent.values
        guard counts.count == 2 else {
            return XCTFail("expected one full segment and one probe, got \(counts)")
        }
        XCTAssertEqual(counts[0], 1_200)
        XCTAssertLessThanOrEqual(counts[1] * line.utf8.count, DiagnosticsLogUploader.declinedProbeBytes)
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
