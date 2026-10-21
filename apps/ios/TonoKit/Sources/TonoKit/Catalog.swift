import Foundation

/// One admitted cloud exit (VLESS + Reality over TCP), mirroring desktop `node::admit_node`.
public struct VlessNode: Equatable, Sendable, CustomStringConvertible {
    public let name: String
    public let server: String
    public let port: Int
    public let uuid: String
    public let serverName: String
    public let flow: String?
    public let fingerprint: String
    public let realityPublicKey: String
    public let realityShortID: String

    /// "Tokyo · Dawn" → "Tokyo"; presentation only.
    public var city: String {
        guard let r = name.range(of: " · ") else { return name.trimmingCharacters(in: .whitespaces) }
        return String(name[..<r.lowerBound]).trimmingCharacters(in: .whitespaces)
    }

    /// "Tokyo · Dawn" → "Dawn"; a name without a label is its own label.
    public var label: String {
        guard let r = name.range(of: " · ") else { return name.trimmingCharacters(in: .whitespaces) }
        return String(name[r.upperBound...]).trimmingCharacters(in: .whitespaces)
    }

    public var description: String { "VlessNode(\(name))" }
}

public struct HomeSocks5: Equatable, Sendable, CustomStringConvertible {
    public let host: String
    public let port: Int
    public let username: String
    public let password: String
    public var description: String { "HomeSocks5(redacted)" }
}

/// Per-account routing document served beside the catalog.
public struct CatalogRouting: Equatable, Sendable {
    public var homeProxy: String?
    public var defaultProxy: String?
    public var homeSocks5: HomeSocks5?

    public init(homeProxy: String? = nil, defaultProxy: String? = nil, homeSocks5: HomeSocks5? = nil) {
        self.homeProxy = homeProxy
        self.defaultProxy = defaultProxy
        self.homeSocks5 = homeSocks5
    }
}

public enum HomeTarget: Equatable, Sendable {
    /// Residential SOCKS5 reached through the cloud exit (`Tono-Home-Residential`, detour `Tono-Exit`).
    case socks5(HomeSocks5)
    /// A catalog node reserved for this account as its Home exit.
    case catalogNode(VlessNode)
}

public struct ExitCatalog: Equatable, Sendable {
    public let revision: Int
    public let sha256: String
    public let routingSHA256: String?
    public let cloudNodes: [VlessNode]
    public let home: HomeTarget?
    public let defaultCloudNode: String?

    /// Freshness key (revision, sha256, routingSha256), the same triple the desktop clients keep.
    public var key: String { "\(revision)/\(sha256)/\(routingSHA256 ?? "-")" }

    public var homeNodeName: String? {
        if case .catalogNode(let n) = home { return n.name }
        return nil
    }
}

public struct CatalogRejected: Error, Equatable, CustomStringConvertible {
    public let code: String
    public let message: String
    public init(_ code: String, _ message: String) {
        self.code = code
        self.message = message
    }
    public var description: String { "\(code): \(message)" }
}

/// Admission of `GET /api/v1/exit-catalog`, identical to the Android client and desktop `admit_node`:
/// public IPv4 servers only, Reality required, `skip-cert-verify` refused, hy2 blocks stripped,
/// digests verified, the assigned Home resolved or the whole catalog refused.
public enum CatalogAdmission {
    public static let maxNodes = 200
    public static let hy2Suffix = " · hy2"
    static let requiredFlow = "xtls-rprx-vision"
    static let reserved: Set<String> = [
        "Tono-Exit", "Tono-Direct", "Tono-Web-Direct", "Tono-Claude-Home", SingBoxConfig.homeSocksTag,
        "DIRECT", "REJECT", "Tono-TUN", "Tono-DNS", "Tono-Mixed", "Tono-FakeIP", "Tono-DoH", "Tono-DoH-Backup",
        "Tono-Hosts", SingBoxConfig.directTag, SingBoxConfig.blockTag,
    ]

    /// `routingSha256` recipe from control-plane `catalog.ts`.
    public static func routingDigest(_ routing: CatalogRouting?) -> String {
        let socks = routing?.homeSocks5.map { [$0.host, String($0.port), $0.username, $0.password].joined(separator: "\n") } ?? ""
        return SHA256.base64URL([routing?.homeProxy ?? "", routing?.defaultProxy ?? "", socks].joined(separator: "\n"))
    }

    /// Admits a parsed `GET /api/v1/exit-catalog` body.
    public static func admit(_ body: JSON) throws -> ExitCatalog {
        guard let yaml = body["yaml"]?.string else { throw CatalogRejected("CATALOG_SHAPE", "missing yaml") }
        guard let sha = body["sha256"]?.string else { throw CatalogRejected("CATALOG_SHAPE", "missing sha256") }
        guard let revision = body["revision"]?.int else { throw CatalogRejected("CATALOG_SHAPE", "missing revision") }
        guard revision >= 0 else { throw CatalogRejected("CATALOG_SHAPE", "negative revision") }
        guard SHA256.base64URL(yaml) == sha else { throw CatalogRejected("CATALOG_DIGEST", "catalog digest mismatch") }
        let routing: CatalogRouting?
        if let raw = body["routing"], !raw.isNull {
            guard let object = raw.object else { throw CatalogRejected("CATALOG_SHAPE", "routing is not an object") }
            routing = try parseRouting(object)
        } else {
            routing = nil
        }
        let routingSHA = body["routingSha256"]?.string
        if let routingSHA, routingDigest(routing) != routingSHA {
            throw CatalogRejected("ROUTING_DIGEST", "routing digest mismatch")
        }
        if routing != nil && routingSHA == nil { throw CatalogRejected("ROUTING_DIGEST", "routing without digest") }
        let nodes = try admitYAML(yaml)
        var home: HomeTarget?
        if let socks = routing?.homeSocks5 {
            home = .socks5(socks)
        } else if let homeName = routing?.homeProxy {
            guard let node = nodes.first(where: { $0.name == homeName }) else {
                throw CatalogRejected("HOME_UNAVAILABLE", "assigned home exit is not in the catalog")
            }
            home = .catalogNode(node)
        }
        let homeName: String? = { if case .catalogNode(let n) = home { return n.name }; return nil }()
        let cloud = nodes.filter { $0.name != homeName }
        guard !cloud.isEmpty else { throw CatalogRejected("CATALOG_EMPTY", "no cloud exit is available for this account") }
        let defaultNode = routing?.defaultProxy.flatMap { name in cloud.contains { $0.name == name } ? name : nil }
        return ExitCatalog(revision: revision, sha256: sha, routingSHA256: routingSHA, cloudNodes: cloud, home: home, defaultCloudNode: defaultNode)
    }

    public static func admitYAML(_ yaml: String) throws -> [VlessNode] {
        let root: YAML
        do {
            root = try CatalogYAML.parse(yaml)
        } catch let e as CatalogYAML.Failure {
            throw CatalogRejected("CATALOG_YAML", e.message)
        }
        guard case .sequence(let proxies)? = root["proxies"] else {
            throw CatalogRejected("CATALOG_YAML", "catalog has no proxies list")
        }
        var nodes: [VlessNode] = []
        for item in proxies {
            guard case .mapping = item else { throw CatalogRejected("CATALOG_YAML", "proxy entry is not a mapping") }
            let name = item["name"]?.scalar?.trimmingCharacters(in: .whitespaces) ?? ""
            if item["type"]?.scalar == "hysteria2" || name.hasSuffix(hy2Suffix) { continue }
            nodes.append(try admitNode(item))
        }
        guard nodes.count <= maxNodes else { throw CatalogRejected("CATALOG_SIZE", "too many nodes") }
        var names = Set<String>()
        for node in nodes where reserved.contains(node.name) || !names.insert(node.name).inserted {
            throw CatalogRejected("NODE_NAME", "duplicate or reserved node name")
        }
        return nodes
    }

    public static func admitNode(_ map: YAML) throws -> VlessNode {
        func s(_ key: String) -> String? {
            guard let v = map[key]?.scalar?.trimmingCharacters(in: .whitespaces), !v.isEmpty else { return nil }
            return v
        }
        guard let name = s("name") else { throw CatalogRejected("NODE_NAME", "missing name") }
        guard name.utf16.count <= 128, !name.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) else {
            throw CatalogRejected("NODE_NAME", "bad name")
        }
        guard s("type") == "vless" else { throw CatalogRejected("NODE_TYPE", "only VLESS Reality nodes are supported") }
        guard s("tls") == "true" else { throw CatalogRejected("NODE_TLS", "TLS must be enabled") }
        guard s("skip-cert-verify") != "true" else { throw CatalogRejected("NODE_TLS", "skip-cert-verify is forbidden") }
        guard let uuid = s("uuid"), isUUID(uuid) else { throw CatalogRejected("NODE_UUID", "bad uuid") }
        guard let reality = map["reality-opts"], case .mapping = reality else {
            throw CatalogRejected("NODE_REALITY", "missing reality-opts")
        }
        guard let publicKey = reality["public-key"]?.scalar?.trimmingCharacters(in: .whitespaces), isBase64URLKey(publicKey) else {
            throw CatalogRejected("NODE_REALITY", "bad reality public key")
        }
        guard let shortID = reality["short-id"]?.scalar?.trimmingCharacters(in: .whitespaces),
              !shortID.isEmpty, shortID.count <= 16, shortID.count % 2 == 0, shortID.allSatisfy(\.isHexDigit) else {
            throw CatalogRejected("NODE_REALITY", "bad reality short id")
        }
        guard let serverName = normalizeSNI(s("servername") ?? s("sni")) else { throw CatalogRejected("NODE_SNI", "bad servername") }
        var flow: String?
        if let f = s("flow") {
            guard f == requiredFlow else { throw CatalogRejected("NODE_FLOW", "unsupported flow \(f)") }
            flow = f
        }
        if let network = s("network"), network.lowercased() != "tcp" { throw CatalogRejected("NODE_NETWORK", "unsupported network") }
        guard let portText = s("port"), let port = Int(portText), (1...65535).contains(port) else {
            throw CatalogRejected("NODE_PORT", "bad port")
        }
        guard let server = s("server"), Net.isPublicIPv4(server) else {
            throw CatalogRejected("NODE_SERVER", "server must be a public IPv4 literal")
        }
        var fingerprint = "chrome"
        if let fp = s("client-fingerprint"), fp.count <= 64, !fp.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) {
            fingerprint = fp
        }
        return VlessNode(name: name, server: server, port: port, uuid: uuid.lowercased(), serverName: serverName, flow: flow,
                         fingerprint: fingerprint, realityPublicKey: publicKey, realityShortID: shortID.lowercased())
    }

    static func parseRouting(_ map: JSONObject) throws -> CatalogRouting {
        var socks: HomeSocks5?
        if let raw = map["homeSocks5"], !raw.isNull {
            let host = raw["host"]?.string?.trimmingCharacters(in: .whitespaces)
            let port = raw["port"]?.int
            let user = raw["username"]?.string
            let pass = raw["password"]?.string
            guard let host, Net.isPublicIPv4(host) || Net.isPublicHostname(host), let port, (1...65535).contains(port),
                  let user, !user.isEmpty, user.count <= 255, let pass, !pass.isEmpty, pass.count <= 255 else {
                throw CatalogRejected("HOME_SOCKS", "assigned home exit is malformed")
            }
            socks = HomeSocks5(host: host, port: port, username: user, password: pass)
        }
        func name(_ key: String) -> String? {
            guard let v = map[key]?.string, !v.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return v
        }
        return CatalogRouting(homeProxy: name("homeProxy"), defaultProxy: name("defaultProxy"), homeSocks5: socks)
    }

    static func isUUID(_ s: String) -> Bool {
        let parts = s.split(separator: "-", omittingEmptySubsequences: false)
        return parts.map(\.count) == [8, 4, 4, 4, 12] && parts.allSatisfy { $0.allSatisfy(\.isHexDigit) }
    }

    static func isBase64URLKey(_ s: String) -> Bool {
        s.count == 43 && s.unicodeScalars.allSatisfy { ("A"..."Z").contains($0) || ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" || $0 == "_" }
    }

    static func normalizeSNI(_ raw: String?) -> String? {
        guard var host = raw?.trimmingCharacters(in: .whitespaces).lowercased() else { return nil }
        while host.hasPrefix(".") { host.removeFirst() }
        while host.hasSuffix(".") { host.removeLast() }
        guard !host.isEmpty, host.count <= 253, !host.contains("%"),
              host.unicodeScalars.allSatisfy({ (0x21...0x7e).contains($0.value) }) else { return nil }
        if Net.parseIPv4(host) != nil { return host }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2 else { return nil }
        let ok = labels.allSatisfy { l in
            (1...63).contains(l.count) && !l.hasPrefix("-") && !l.hasSuffix("-") &&
                l.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" }
        }
        return ok ? host : nil
    }
}

public enum Net {
    public static func parseIPv4(_ text: String) -> [Int]? {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var out: [Int] = []
        for p in parts {
            guard !p.isEmpty, p.count <= 3, p.allSatisfy({ $0.isASCII && $0.isNumber }), !(p.count > 1 && p.first == "0"),
                  let v = Int(p), v <= 255 else { return nil }
            out.append(v)
        }
        return out
    }

    /// Desktop `node::is_public_ipv4`: no private, loopback, CGNAT, link-local, benchmark, documentation or multicast.
    public static func isPublicIPv4(_ text: String) -> Bool {
        guard let b = parseIPv4(text) else { return false }
        return !(b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224 ||
            (b[0] == 100 && (64...127).contains(b[1])) || (b[0] == 169 && b[1] == 254) ||
            (b[0] == 172 && (16...31).contains(b[1])) || (b[0] == 192 && b[1] == 168) ||
            (b[0] == 192 && b[1] == 0 && b[2] == 0) || (b[0] == 192 && b[1] == 0 && b[2] == 2) ||
            (b[0] == 198 && (b[1] == 18 || b[1] == 19)) || (b[0] == 198 && b[1] == 51 && b[2] == 100) ||
            (b[0] == 203 && b[1] == 0 && b[2] == 113) ||
            (b[0] == 192 && b[1] == 31 && b[2] == 196) || (b[0] == 192 && b[1] == 52 && b[2] == 193) ||
            (b[0] == 192 && b[1] == 88 && b[2] == 99) || (b[0] == 192 && b[1] == 175 && b[2] == 48))
    }

    /// Desktop `publicHostname`: Home lines are usually a provider gateway name (`isp.decodo.com`), dialled
    /// through `Tono-Exit`, so the cloud node resolves it. Only an ordinary lowercase DNS name, never a
    /// special-use suffix or an all-numeric form that inet_aton reads as an IP (`127.0.0.0x1`).
    public static func isPublicHostname(_ text: String) -> Bool {
        let labels = text.split(separator: ".", omittingEmptySubsequences: false)
        guard text.utf8.count <= 253, labels.count >= 2,
              labels.allSatisfy({ label in
                  !label.isEmpty && label.utf8.count <= 63 && label.first != "-" && label.last != "-"
                      && label.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" }
              }),
              let top = labels.last, top.unicodeScalars.contains(where: { ("a"..."z").contains($0) })
        else { return false }
        let numeric = labels.allSatisfy { label in
            let hex = label.hasPrefix("0x")
            return (hex ? label.dropFirst(2) : label[...]).unicodeScalars.allSatisfy {
                ("0"..."9").contains($0) || (hex && ("a"..."f").contains($0))
            }
        }
        let reserved = ["localhost", "local", "internal", "arpa", "invalid", "onion", "alt", "test", "example",
                        "example.com", "example.net", "example.org"]
        return !numeric && !reserved.contains { text == $0 || text.hasSuffix("." + $0) } && labels.first != "localhost"
    }

    public static func ipv4InCIDR(_ ip: String, _ cidr: String) -> Bool {
        let parts = cidr.split(separator: "/")
        guard let a = parseIPv4(ip), let b = parseIPv4(String(parts[0])) else { return false }
        let bits = parts.count > 1 ? Int(parts[1]) ?? 32 : 32
        let av = a.reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
        let bv = b.reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
        let mask: UInt32 = bits == 0 ? 0 : ~UInt32(0) << UInt32(32 - bits)
        return av & mask == bv & mask
    }

    /// RFC 4291 text → 16 bytes (accepts `::` compression and an embedded IPv4 tail).
    public static func parseIPv6(_ text: String) -> [UInt8]? {
        var s = text
        if let zone = s.firstIndex(of: "%") { s = String(s[..<zone]) }
        guard s.contains(":") else { return nil }
        var tail: [UInt8] = []
        if let lastColon = s.lastIndex(of: ":"), s[s.index(after: lastColon)...].contains(".") {
            guard let v4 = parseIPv4(String(s[s.index(after: lastColon)...])) else { return nil }
            tail = v4.map(UInt8.init)
            s = String(s[...lastColon]) + "0:0"
        }
        let halves = s.components(separatedBy: "::")
        guard halves.count <= 2 else { return nil }
        func groups(_ part: String) -> [UInt16]? {
            if part.isEmpty { return [] }
            var out: [UInt16] = []
            for g in part.split(separator: ":", omittingEmptySubsequences: false) {
                guard (1...4).contains(g.count), let v = UInt16(g, radix: 16) else { return nil }
                out.append(v)
            }
            return out
        }
        guard let head = groups(halves[0]) else { return nil }
        var all: [UInt16]
        if halves.count == 2 {
            guard let back = groups(halves[1]), head.count + back.count < 8 else { return nil }
            all = head + Array(repeating: 0, count: 8 - head.count - back.count) + back
        } else {
            guard head.count == 8 else { return nil }
            all = head
        }
        var bytes = all.flatMap { [UInt8($0 >> 8), UInt8($0 & 0xff)] }
        if !tail.isEmpty { bytes.replaceSubrange(12..<16, with: tail) }
        return bytes
    }

    public static func ipv6InCIDR(_ ip: String, _ cidr: String) -> Bool {
        let parts = cidr.split(separator: "/")
        guard parts.count == 2, let bits = Int(parts[1]), let a = parseIPv6(ip), let b = parseIPv6(String(parts[0])) else { return false }
        for i in 0..<bits where (a[i / 8] ^ b[i / 8]) & (0x80 >> UInt8(i % 8)) != 0 { return false }
        return true
    }
}

/// How a line is named on Home, widgets and the Live Activity: its city, plus the line's own label
/// only when another admitted line is in the same city (Dawn and Dusk in Tokyo). A name without a
/// label never repeats itself ("Tokyo · Tokyo"). The Lines sheet still lists every label.
public enum LineNaming {
    public static func city(_ name: String) -> String {
        guard let r = name.range(of: " · ") else { return name.trimmingCharacters(in: .whitespaces) }
        return String(name[..<r.lowerBound]).trimmingCharacters(in: .whitespaces)
    }

    public static func showsLabel(_ name: String, among names: [String]) -> Bool {
        guard name.contains(" · ") else { return false }
        let own = city(name).lowercased()
        return names.contains { $0 != name && city($0).lowercased() == own }
    }
}
