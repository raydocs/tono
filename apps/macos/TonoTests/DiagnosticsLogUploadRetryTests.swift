import XCTest
@testable import Tono

final class DiagnosticsLogUploadRetryTests: XCTestCase {
    private actor StoredButResponseLost {
        var requests: [(Data, String, Int)] = []
        func upload(_ data: Data, _ session: String, _ sequence: Int) throws {
            requests.append((data, session, sequence))
            if requests.count == 1 { throw URLError(.networkConnectionLost) }
        }
        func snapshot() -> [(Data, String, Int)] { requests }
    }

    func testLostReceiptRetriesTheSameBytesDespiteLogGrowth() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = directory.appendingPathComponent("audit.jsonl")
        try Data("{\"first\":1}\n".utf8).write(to: log)
        let server = StoredButResponseLost()
        let uploader = DiagnosticsLogUploader(auditLogURL: log, isEnabled: { true }) {
            data, session, sequence, _, _, _ in try await server.upload(data, session, sequence)
        }
        guard case .failed = await uploader.sweep() else { return XCTFail("receipt was lost") }
        let handle = try FileHandle(forWritingTo: log)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("{\"later\":2}\n".utf8))
        try handle.close()
        _ = await uploader.sweep()
        _ = await uploader.sweep()
        let requests = await server.snapshot()
        XCTAssertEqual(requests.count, 3)
        guard requests.count == 3 else { return }
        XCTAssertEqual(requests[0].0, requests[1].0)
        XCTAssertEqual(requests[0].1, requests[1].1)
        XCTAssertEqual(requests.map(\.2), [0, 0, 1])
        XCTAssertNotEqual(requests[1].0, requests[2].0)
    }
}
