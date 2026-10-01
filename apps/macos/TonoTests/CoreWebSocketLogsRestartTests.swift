import XCTest
@testable import Tono

/// A residential route commit (`commitResidentialRouteAuditContext`) used to
/// invalidate only the connections stream. The logs stream kept both its
/// 250 ms coalescing buffer and the receive in flight on the old runtime,
/// and `recordCoreLogs` has no generation guard — so a route line from
/// before the commit flushed afterwards and was classified against the new
/// assistant first-member, which is exactly how a false
/// `managed_direct_group_failed_over` audit event is born.
///
/// Deterministic by construction: the buffer is filled through `enqueueLog`
/// and invalidated on the same MainActor turn, so the flush task — which
/// sleeps 250 ms before delivering — never runs in between. The closed port
/// means no server exists to inject a frame the assertions did not.
@MainActor
final class CoreWebSocketLogsRestartTests: XCTestCase {
    func testRestartDropsBufferedOldRuntimeLinesAndKeepsADisabledStreamOff() async throws {
        let socket = CoreWebSocket(host: "127.0.0.1", port: 9)
        defer { socket.stopAll() }
        var delivered: [(level: String, message: String)] = []
        socket.onLogs = { batch in
            delivered.append(contentsOf: batch)
        }

        socket.startLogsStream(level: "info")
        socket.enqueueLog(level: "info", message: "old-runtime route line")
        // Same MainActor turn as the enqueue, exactly like the commit in
        // commitResidentialRouteAuditContext: the flush task has not run and,
        // its buffer dropped, never will.
        socket.restartLogsStreamAfterRuntimeChange()
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertFalse(
            delivered.contains { $0.message == "old-runtime route line" },
            "a buffered old-runtime line must not flush under the new context"
        )

        socket.stopLogsStream()
        socket.restartLogsStreamAfterRuntimeChange()
        socket.enqueueLog(level: "info", message: "post-disable line")
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertTrue(
            delivered.isEmpty,
            "a disabled logs stream must stay disabled across the restart"
        )
    }
}
