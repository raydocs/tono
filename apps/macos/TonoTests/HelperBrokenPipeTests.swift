import XCTest
import Darwin
@testable import Tono

final class HelperBrokenPipeTests: XCTestCase {
    func testPeerClosingBeforeSendReturnsTransportErrorWithoutSIGPIPE() throws {
        // Keep the unfixed implementation alive long enough to report the
        // missing socket option as an assertion failure, rather than kill XCTest.
        let previous = signal(SIGPIPE, SIG_IGN)
        defer { signal(SIGPIPE, previous) }
        let path = "/tmp/tono-pipe-\(UUID().uuidString).sock"
        let listener = socket(AF_UNIX, SOCK_STREAM, 0)
        XCTAssertGreaterThanOrEqual(listener, 0)
        defer { close(listener); unlink(path) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        path.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) { tuple in
                tuple.withMemoryRebound(to: CChar.self, capacity: 104) { _ = strlcpy($0, source, 104) }
            }
        }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        XCTAssertEqual(bound, 0)
        XCTAssertEqual(listen(listener, 1), 0)
        XCTAssertThrowsError(try HelperManager.sendRequest(method: "POST", path: "/release", socket: path) { fd in
            var protected: Int32 = 0
            var size = socklen_t(MemoryLayout<Int32>.size)
            XCTAssertEqual(getsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &protected, &size), 0)
            XCTAssertEqual(protected, 1, "every helper socket must suppress SIGPIPE independently of app startup")
            // Prove socket-level safety even without the app-wide fallback.
            // On the old implementation retain SIG_IGN to report the assertion.
            if protected == 1 { signal(SIGPIPE, SIG_DFL) }
            // The connect has completed; close its accepted peer before the
            // client writes. No scheduler race or sleeping is involved.
            let peer = accept(listener, nil, nil)
            XCTAssertGreaterThanOrEqual(peer, 0)
            XCTAssertEqual(shutdown(peer, SHUT_RDWR), 0)
            close(peer)
        }) { error in
            guard case HelperIPCError.socketFailed = error else {
                return XCTFail("expected a recoverable send error, got \(error)")
            }
            XCTAssertFalse(HelperManager.upgradeRequestMayHaveBeenDelivered(error))
        }
    }
}
