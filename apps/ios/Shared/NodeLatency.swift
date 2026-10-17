import Foundation
import Network
import TonoKit

/// TCP connect time to each cloud node: the phone → cloud hop, outside the tunnel. The extension
/// measures while the tunnel runs (its sockets bypass it); the app measures while it is off.
enum NodeLatency {
    static func measure(_ nodes: [VlessNode], timeout: TimeInterval = 3) async -> [String: Int?] {
        await withTaskGroup(of: (String, Int?).self) { group in
            for node in nodes.prefix(40) {
                group.addTask { (node.name, await connectTime(host: node.server, port: node.port, timeout: timeout)) }
            }
            var out: [String: Int?] = [:]
            for await (name, ms) in group { out[name] = ms }
            return out
        }
    }

    static func connectTime(host: String, port: Int, timeout: TimeInterval) async -> Int? {
        guard let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else { return nil }
        let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
        let started = Date()
        return await withCheckedContinuation { (continuation: CheckedContinuation<Int?, Never>) in
            let once = Once()
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    once.run { continuation.resume(returning: Int(Date().timeIntervalSince(started) * 1000)) }
                    connection.cancel()
                case .failed, .cancelled:
                    once.run { continuation.resume(returning: nil) }
                default:
                    break
                }
            }
            connection.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                once.run { continuation.resume(returning: nil) }
                connection.cancel()
            }
        }
    }
}

final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func run(_ body: () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        guard !done else { return }
        done = true
        body()
    }
}
