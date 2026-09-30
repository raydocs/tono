import Foundation
import Network

/// One TCP connect to a catalog address. Does not install PF, DNS, or a tunnel.
enum TcpEndpointProof {
    static func prove(
        name: String,
        nodes: [ProxyNode],
        override: (@MainActor @Sendable (String) async -> Bool)?,
        timeout: TimeInterval = 2.5
    ) async -> Bool {
        if let override {
            return await override(name)
        }
        guard let node = nodes.first(where: { $0.name == name }),
              !node.server.isEmpty,
              !node.name.hasSuffix(ExitHeal.hy2Suffix),
              let port = NWEndpoint.Port(rawValue: UInt16(clamping: node.port)) else {
            return false
        }
        return await reachable(host: node.server, port: port, timeout: timeout)
    }

    static func reachable(host: String, port: NWEndpoint.Port, timeout: TimeInterval) async -> Bool {
        await withCheckedContinuation { continuation in
            let connection = NWConnection(
                host: NWEndpoint.Host(host),
                port: port,
                using: .tcp
            )
            let box = ResumeOnce(continuation)
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    connection.cancel()
                    box.resume(true)
                case .failed, .cancelled:
                    box.resume(false)
                default:
                    break
                }
            }
            connection.start(queue: .global(qos: .utility))
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout) {
                connection.cancel()
                box.resume(false)
            }
        }
    }
}

/// Lock-protected continuation. Nonisolated so the socket callback can resume
/// it without hopping to the main actor. The lock is the only shared state.
nonisolated private final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Bool, Never>?

    init(_ continuation: CheckedContinuation<Bool, Never>) {
        self.continuation = continuation
    }

    func resume(_ value: Bool) {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(returning: value)
    }
}
