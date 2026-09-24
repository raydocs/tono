import XCTest
import Darwin
@testable import Tono

/// A second macOS account that opened Tono met a helper bound to the first
/// account. The daemon hands its socket to that one account (mode 0600), so the
/// connect failed with a bare "helper unavailable", and a repair from the
/// second account could rebind the helper to itself and drop the first
/// account's barrier (H19-O-F3). The refusal must name the owning account, and
/// root must refuse to rebind while that account exists.
final class HelperBoundAccountTests: XCTestCase {
    func testAnotherAccountsHelperIsRefusedByNameAndNotRebound() throws {
        let me = getuid()
        let myName = try XCTUnwrap(getpwuid(me).map { String(cString: $0.pointee.pw_name) })
        let directory = "/tmp/tono-bound-\(getpid())"
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: directory) }

        // A live socket owned by this account, seen from another uid.
        let socketPath = directory + "/service.sock"
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        XCTAssertGreaterThanOrEqual(fd, 0)
        defer { close(fd) }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        _ = socketPath.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) {
                $0.withMemoryRebound(to: CChar.self, capacity: 104) { strlcpy($0, source, 104) }
            }
        }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        XCTAssertEqual(bound, 0)
        guard case .boundToAnotherUser(let account) =
            HelperManager.connectFailure(socketPath: socketPath, currentUID: me &+ 1) else {
            return XCTFail("a helper serving another account must be refused by that account's name")
        }
        XCTAssertEqual(account, myName)
        guard case .connectFailed =
            HelperManager.connectFailure(socketPath: socketPath, currentUID: me) else {
            return XCTFail("the owning account's own failed connect is not another account's helper")
        }

        // Root's install guard, run against a scratch record: refuse while the
        // record names another existing account; allow the same account, or an
        // account that no longer exists.
        func runGuard(recorded: String, caller: uid_t) throws -> (status: Int32, stderr: String) {
            let record = directory + "/allowed-uid"
            try recorded.write(toFile: record, atomically: true, encoding: .utf8)
            let shell = Process()
            shell.executableURL = URL(fileURLWithPath: "/bin/sh")
            shell.arguments = [
                "-c", "set -e\n" + HelperManager.boundAccountGuard(uid: caller, allowedUIDPath: record),
            ]
            let errors = Pipe()
            shell.standardError = errors
            try shell.run()
            shell.waitUntilExit()
            let text = String(
                data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8
            ) ?? ""
            return (shell.terminationStatus, text)
        }
        let refused = try runGuard(recorded: "\(me)\n", caller: me &+ 1)
        XCTAssertNotEqual(refused.status, 0, "root rebound the helper away from an existing account")
        XCTAssertEqual(HelperManager.boundAccount(inInstallerMessage: refused.stderr), myName)
        XCTAssertEqual(try runGuard(recorded: "\(me)\n", caller: me).status, 0)
        let deleted = try XCTUnwrap(
            (uid_t(2_000_000_000)...uid_t(2_000_000_100)).first { getpwuid($0) == nil }
        )
        XCTAssertEqual(try runGuard(recorded: "\(deleted)\n", caller: me).status, 0)
    }
}
