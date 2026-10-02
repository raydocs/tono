import XCTest
@testable import Tono

@MainActor
final class CoreWebSocketFrameSizeTests: XCTestCase {
    /// `/connections` sends every open connection in one frame. A receive
    /// fails for good on a frame over the task's limit, and the reconnect gets
    /// the same snapshot again: with URLSession's 1 MiB default a busy session
    /// (a few thousand connections) lost the feed until connections closed.
    func testAConnectionsSnapshotOfABusySessionFitsOneFrame() {
        let socket = CoreWebSocket(host: "127.0.0.1", port: 9)
        defer { socket.stopAll() }
        let task = socket.createTask(url: URL(string: "ws://127.0.0.1:9/connections")!)
        defer { task.cancel() }
        XCTAssertGreaterThanOrEqual(task.maximumMessageSize, 16 * 1024 * 1024)
    }
}
