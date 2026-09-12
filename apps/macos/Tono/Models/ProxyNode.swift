import Foundation

// MARK: - Proxy Protocol Type

nonisolated enum ProxyType: String, Codable, CaseIterable, Hashable, Sendable {
    case trojan
    case vmess
    case shadowsocks = "ss"
    case socks5
    case http
    case hysteria2
    case vless

    var displayName: String {
        switch self {
        case .trojan: "Trojan"
        case .vmess: "VMess"
        case .shadowsocks: "SS"
        case .socks5: "SOCKS5"
        case .http: "HTTP"
        case .hysteria2: "Hysteria2"
        case .vless: "VLESS"
        }
    }
}

// MARK: - Latency Level

nonisolated enum LatencyKind {
    /// TCP connect to :443, no TLS.
    case tcp
    /// HTTPS generate_204 through Reality. A healthy Japan exit is often 400–900ms.
    case exit
}

nonisolated enum LatencyLevel {
    case low, mid, high

    /// Canonical banding. Keep aligned with Windows `pages/tono/node-latency.ts`.
    /// Exit uses wider bands so a normal Reality handshake is not painted as a
    /// dead node.
    static func level(for ms: Int, kind: LatencyKind = .exit) -> LatencyLevel {
        switch kind {
        case .tcp:
            if ms < 200 { return .low }
            if ms < 400 { return .mid }
            return .high
        case .exit:
            if ms < 1000 { return .low }
            if ms < 1500 { return .mid }
            return .high
        }
    }

    static func spokenSeconds(for ms: Int) -> String {
        String(format: "%.1f", Double(ms) / 1000.0)
    }

    static func spokenTitle(for ms: Int, kind: LatencyKind = .exit) -> String {
        switch kind {
        case .tcp:
            return String(localized: "\(ms)ms")
        case .exit:
            return String(localized: "\(spokenSeconds(for: ms))s")
        }
    }

    var color: String {
        switch self {
        case .low:  "30D158"
        case .mid:  "FF9F0A"
        case .high: "FF453A"
        }
    }

    var bgColor: String {
        switch self {
        case .low:  "30D158"
        case .mid:  "FFD60A"
        case .high: "FF453A"
        }
    }
}

// MARK: - Proxy Node

nonisolated struct ProxyNode: Identifiable, Codable, Hashable, Sendable {
    var id: String = UUID().uuidString
    var flag: String = ""
    var name: String
    var type: ProxyType = .trojan
    var server: String = ""
    var port: Int = 443
    var relay: String = ""
    var latency: Int = 0
    var isActive: Bool = false
    var subscriptionId: String?

    // Connection parameters
    var username: String?
    var password: String?
    var uuid: String?
    var cipher: String?
    var udp: Bool = true

    // TLS / transport parameters (critical for mihomo config generation)
    var sni: String?
    var skipCertVerify: Bool?
    var network: String?       // tcp, ws, grpc, h2
    var wsPath: String?
    var wsHost: String?
    var grpcServiceName: String?
    var tls: Bool?
    var alterId: Int?          // vmess
    var flow: String?           // vless, e.g. xtls-rprx-vision
    var clientFingerprint: String?
    /// SHA-256 of the hy2 leaf cert. Not `client-fingerprint` (uTLS).
    var tlsFingerprint: String?
    var realityPublicKey: String?
    var realityShortId: String?

    // Display helpers
    /// Wire names the catalog still ships without a city. Without an entry the
    /// card falls back to the raw name ("JP-VLESS-Reality"), which loses the
    /// localized city title and the city glyph.
    private static let cityNames: [String: String] = [
        // Matches node-meta.ts on Windows. macOS used to say "Sunset", which
        // both named the same server differently across platforms and collided
        // with the catalog's own 洛杉矶 · Sunset node.
        "US-VLESS-Reality": "Los Angeles · Grove",
        "JP-VLESS-Reality": "Tokyo · Dawn",
    ]

    private static let hy2NameSuffix = " · hy2"

    static func catalogBaseName(for rawName: String) -> String {
        guard rawName.hasSuffix(hy2NameSuffix) else { return rawName }
        return String(rawName.dropLast(hy2NameSuffix.count))
    }

    static func isHy2CatalogName(_ rawName: String) -> Bool {
        rawName.hasSuffix(hy2NameSuffix)
    }

    /// Panstar Tokyo inbound UDP is vendor-blocked. Same-city hy2 there is a
    /// dead click; another city's hy2 (Dedirock) is the working China backup.
    static func hy2UdpIsVendorBlocked(_ rawName: String) -> Bool {
        let clean = ConfigParser.extractFlag(from: rawName).cleanName
        guard isHy2CatalogName(clean) else { return false }
        let display = displayName(for: catalogBaseName(for: clean))
        let city = display.split(separator: "·", maxSplits: 1)
            .first?
            .trimmingCharacters(in: .whitespaces)
            .lowercased()
        return city == "tokyo"
    }

    private static func preferReachableHy2(_ rows: [String]) -> String? {
        let ordered = rows.sorted()
        return ordered.first { !hy2UdpIsVendorBlocked($0) } ?? ordered.first
    }

    /// Manual next hand when TCP is dead. Prefer the same-city ` · hy2`
    /// sibling unless that sibling's UDP is vendor-blocked; then another
    /// city's hy2. Already on hy2: offer a different city's hy2. Nil when
    /// nothing remains to try. G2.8 auto-switch stays off.
    static func backupChannelName(
        selected: String,
        catalogNames: Set<String>
    ) -> String? {
        let selectedClean = ConfigParser.extractFlag(from: selected).cleanName
        let selectedBase = catalogBaseName(for: selectedClean)
        let hy2Rows = catalogNames.filter { name in
            isHy2CatalogName(ConfigParser.extractFlag(from: name).cleanName)
        }
        guard !hy2Rows.isEmpty else { return nil }

        if !isHy2CatalogName(selectedClean) {
            if let sibling = hy2Rows.first(where: { name in
                catalogBaseName(for: ConfigParser.extractFlag(from: name).cleanName) == selectedBase
            }), !hy2UdpIsVendorBlocked(sibling) {
                return sibling
            }
            return preferReachableHy2(Array(hy2Rows))
        }

        return preferReachableHy2(hy2Rows.filter { name in
            catalogBaseName(for: ConfigParser.extractFlag(from: name).cleanName) != selectedBase
        })
    }

    /// Cities city-failover may land on. hy2 is a same-city backup, not
    /// another city, so a TCP failure must not auto-switch onto it.
    static func isCityFailoverCandidate(_ rawName: String, after current: String?) -> Bool {
        let clean = ConfigParser.extractFlag(from: rawName).cleanName
        guard !isHy2CatalogName(clean) else { return false }
        guard let current else { return true }
        let currentClean = ConfigParser.extractFlag(from: current).cleanName
        return catalogBaseName(for: clean) != catalogBaseName(for: currentClean)
    }

    static func displayName(for rawName: String) -> String {
        let base = catalogBaseName(for: rawName)
        return cityNames[base] ?? base
    }

    var displayName: String { Self.displayName(for: name) }
    var protocolType: String {
        type == .hysteria2
            ? String(localized: "Backup channel")
            : type.displayName
    }
    var catalogTransport: String { type == .hysteria2 ? "hy2" : "tcp" }
    static func catalogTransport(for rawName: String) -> String {
        rawName.hasSuffix(hy2NameSuffix) ? "hy2" : "tcp"
    }
    /// Dial identity of a live session. Catalog growth (a new city) must not
    /// match this; a dest/SNI/credential change on the connected node must.
    func liveSessionIdentity(matches other: ProxyNode) -> Bool {
        name == other.name
            && type == other.type
            && server == other.server
            && port == other.port
            && uuid == other.uuid
            && password == other.password
            && sni == other.sni
            && realityPublicKey == other.realityPublicKey
            && realityShortId == other.realityShortId
            && tlsFingerprint == other.tlsFingerprint
            && flow == other.flow
            && network == other.network
    }

    var ping: Int { latency }

    var latencyColor: LatencyLevel { LatencyLevel.level(for: latency, kind: .exit) }

    enum CodingKeys: String, CodingKey {
        case id, flag, name, type, server, port, relay, latency, isActive, subscriptionId
        case username, password, uuid, cipher, udp
        case sni, skipCertVerify, network, wsPath, wsHost, grpcServiceName, tls, alterId
        case flow, clientFingerprint, tlsFingerprint, realityPublicKey, realityShortId
    }
}

/// Whether a connected session must reload Mihomo after a catalog install.
enum CatalogLiveSession {
    /// Skip the reload when the selected exit's dial identity is unchanged
    /// and residential routing did not move. Adding or renaming other cities
    /// is not a reason to close every connection.
    static func shouldReload(
        previousSelected: ProxyNode?,
        nextSelected: ProxyNode?,
        routingChanged: Bool
    ) -> Bool {
        if routingChanged { return true }
        guard let previousSelected, let nextSelected else { return true }
        return !previousSelected.liveSessionIdentity(matches: nextSelected)
    }
}
