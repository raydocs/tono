import XCTest
@testable import Tono

@MainActor
final class CoreWebSocketQuietLogsTests: XCTestCase {
    func testQuietLogsDoNotStallWithoutAnUnsupportedPong() {
        let socket = CoreWebSocket(host: "127.0.0.1", port: 9)
        defer { socket.stopAll() }
        var stalled: [String] = []
        socket.onStreamStalled = { stalled.append($0) }
        socket.startLogsStream(level: "warning")

        // No suspension: receive/ping completion callbacks cannot run on the
        // MainActor between these checks. The closed loopback port supplies no
        // pong, just like the pinned sing-box logs handler, which never reads
        // WebSocket control frames. Silence alone must not force a reconnect.
        let now = Date()
        socket.checkStreamLiveness(now: now)
        socket.checkStreamLiveness(now: now.addingTimeInterval(25))

        XCTAssertFalse(stalled.contains("logs"))
    }
}
