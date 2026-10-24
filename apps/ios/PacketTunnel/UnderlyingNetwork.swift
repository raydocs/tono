import Foundation
import Libbox
import Network
import TonoKit
#if os(iOS)
import notify
#endif

/// Watches the phone's own network from inside the extension (whose sockets bypass the tunnel).
/// Only global IPv6 matters to the graph: without it, DIRECT names answer IPv4 only.
final class UnderlyingNetwork: @unchecked Sendable {
    /// A cancelled NWPathMonitor never starts again: each start gets a new one.
    private var monitor: NWPathMonitor?
    private let queue = DispatchQueue(label: "tono.tunnel.underlying")
    private let lock = NSLock()
    private var ipv6 = false
    private var text = "unknown"
    var onIPv6Change: ((Bool) -> Void)?

    var hasGlobalIPv6: Bool { lock.lock(); defer { lock.unlock() }; return ipv6 }
    var summary: String { lock.lock(); defer { lock.unlock() }; return text }

    private var seenFirstPath = false

    func start() {
        monitor?.cancel()
        lock.lock()
        seenFirstPath = false
        lock.unlock()
        let monitor = NWPathMonitor(prohibitedInterfaceTypes: [.other, .loopback])
        self.monitor = monitor
        let first = DispatchSemaphore(value: 0)
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            self.lock.lock()
            let before = self.ipv6
            self.ipv6 = path.status == .satisfied && path.supportsIPv6
            self.text = Self.describe(path)
            let changed = before != self.ipv6
            let isFirst = !self.seenFirstPath
            self.seenFirstPath = true
            self.lock.unlock()
            if isFirst {
                first.signal()
            } else if changed {
                self.onIPv6Change?(path.supportsIPv6)
            }
        }
        monitor.start(queue: queue)
        _ = first.wait(timeout: .now() + 3)
    }

    func stop() {
        monitor?.cancel()
        monitor = nil
    }

    static func describe(_ path: NWPath) -> String {
        var parts: [String] = []
        switch path.status {
        case .satisfied: parts.append("satisfied")
        case .unsatisfied: parts.append("unsatisfied")
        case .requiresConnection: parts.append("requiresConnection")
        @unknown default: parts.append("unknown")
        }
        if !path.availableInterfaces.isEmpty {
            parts.append("interfaces=" + path.availableInterfaces.map { "\($0.name)#\($0.index)" }.joined(separator: ","))
        }
        if path.supportsIPv4 { parts.append("ipv4") }
        if path.supportsIPv6 { parts.append("ipv6") }
        if path.supportsDNS { parts.append("dns") }
        if path.isExpensive { parts.append("expensive") }
        if path.isConstrained { parts.append("constrained") }
        return parts.joined(separator: " ")
    }
}

#if os(iOS)
/// iOS wakes the extension for every push and background task, so sing-box ignores `wake()` there
/// and leaves its paused state on the display turning on (upstream Apple client behaviour).
final class ScreenStateObserver {
    private let queue = DispatchQueue(label: "tono.tunnel.screen")
    private var token: Int32 = -1

    init(commandServer: LibboxCommandServer) {
        _ = notify_register_dispatch("com.apple.iokit.hid.displayStatus", &token, queue) { token in
            var state: UInt64 = 0
            _ = notify_get_state(token, &state)
            commandServer.recordScreenState(state == 1)
            if state == 1 { commandServer.wakeNow() }
        }
    }

    func cancel() { _ = notify_cancel(token) }
}
#endif
