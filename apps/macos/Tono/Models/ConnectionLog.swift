import Foundation

// MARK: - Connection Type

nonisolated enum ConnectionType: String, Codable {
    case proxied  = "Proxied"
    case home     = "Home"
    case direct   = "Direct"
    case rejected = "Rejected"
}

/// How Activity presents `/connections`. Clash.md's Connections view keeps
/// every live tunnel flow and virtualizes the list; a 50-row `VStack` is
/// why Tono used to look empty on a busy Mac.
enum ConnectionActivityPresentation {
    static let maxDisplayed = 2_000

    static func isLoopback(_ connection: APIConnection) -> Bool {
        loopbackAddress(connection.metadata.host)
            || loopbackAddress(connection.metadata.destinationIP ?? "")
    }

    static func type(for connection: APIConnection) -> ConnectionType {
        switch AppTrafficLedger.routeClass(for: connection) {
        case .blocked: return .rejected
        case .direct: return .direct
        case .residential: return .home
        case .tunnel: return .proxied
        }
    }

    private static func loopbackAddress(_ value: String) -> Bool {
        let host = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if host.isEmpty { return false }
        if host == "localhost" || host == "::1" || host.hasPrefix("[::1]") {
            return true
        }
        return host.hasPrefix("127.")
    }
}

// MARK: - Connection Entry

nonisolated struct ConnectionEntry: Identifiable, Codable {
    var id: String = UUID().uuidString
    var domain: String
    var protocolName: String
    var rule: String
    var nodeFlag: String
    var nodeName: String
    var latency: Int?
    var dataSize: String
    var dataLabel: String
    var timestamp: String
    var type: ConnectionType
    var network: String = ""
    var destination: String = ""
    var processName: String? = nil
    var route: String = ""
    /// Split direction counters. `dataSize` keeps the combined total for the
    /// menu bar and compact surfaces; the connection list shows the two
    /// directions separately, which is what makes a stalled upload or a
    /// runaway download visible at a glance.
    var uploadText: String = ""
    var downloadText: String = ""
}
