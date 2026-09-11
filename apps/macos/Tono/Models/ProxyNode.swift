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

    /// Same-city hy2 sibling the user can pick by hand. Nil when the
    /// selection is already hy2 or the catalog has no ` · hy2` row.
    /// G2.8 auto-switch stays off; the failure card only names this row.
    static func backupChannelName(
        selected: String,
        catalogNames: Set<String>
    ) -> String? {
        guard !isHy2CatalogName(selected) else { return nil }
        let hy2 = catalogBaseName(for: selected) + hy2NameSuffix
        return catalogNames.contains(hy2) ? hy2 : nil
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
    var ping: Int { latency }

    var latencyColor: LatencyLevel { LatencyLevel.level(for: latency, kind: .exit) }

    enum CodingKeys: String, CodingKey {
        case id, flag, name, type, server, port, relay, latency, isActive, subscriptionId
        case username, password, uuid, cipher, udp
        case sni, skipCertVerify, network, wsPath, wsHost, grpcServiceName, tls, alterId
        case flow, clientFingerprint, tlsFingerprint, realityPublicKey, realityShortId
    }
}
