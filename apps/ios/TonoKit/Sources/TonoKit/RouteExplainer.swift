import Foundation

/// Evaluates the generated route rules for one connection, first match wins, the way sing-box does.
/// Used by tests and by the in-app "where does this site go?" check. It understands exactly the
/// rule items `SingBoxConfig` emits; an unknown item is a programming error, not a guess.
public enum RouteExplainer {
    public struct Connection: Sendable {
        /// Name known from a fake-IP mapping or a sniffed TLS/HTTP/QUIC name; nil for raw-IP dials without SNI.
        public var domain: String?
        public var ip: String?
        public var port: Int = 443
        public var network: String = "tcp"
        public var dns: Bool = false

        public init(domain: String? = nil, ip: String? = nil, port: Int = 443, network: String = "tcp", dns: Bool = false) {
            self.domain = domain
            self.ip = ip
            self.port = port
            self.network = network
            self.dns = dns
        }
    }

    public enum Verdict: Equatable, Sendable {
        case route(outbound: String, ruleIndex: Int)
        case reject(ruleIndex: Int)
        case hijackDNS
    }

    public struct UnsupportedRule: Error { public let item: String }

    public static func explain(_ config: JSON, _ c: Connection) throws -> Verdict {
        guard let route = config["route"], let rules = route["rules"]?.array, let final = route["final"]?.string else {
            throw UnsupportedRule(item: "route")
        }
        for (index, rule) in rules.enumerated() {
            guard let object = rule.object, let action = object["action"]?.string else { throw UnsupportedRule(item: "rule") }
            if action == "sniff" { continue }
            if try matches(object, c) {
                switch action {
                case "hijack-dns": return .hijackDNS
                case "route":
                    guard let outbound = object["outbound"]?.string else { throw UnsupportedRule(item: "outbound") }
                    return .route(outbound: outbound, ruleIndex: index)
                case "reject": return .reject(ruleIndex: index)
                default: throw UnsupportedRule(item: action)
                }
            }
        }
        return .route(outbound: final, ruleIndex: -1)
    }

    /// Which DNS server answers an A/AAAA query, or "predefined" for a synthesized empty answer.
    public static func dnsServer(_ config: JSON, domain: String, queryType: String) throws -> String {
        guard let dns = config["dns"], let rules = dns["rules"]?.array, let final = dns["final"]?.string else {
            throw UnsupportedRule(item: "dns")
        }
        let known: Set<String> = ["query_type", "domain_suffix", "domain", "action", "server", "rcode"]
        for rule in rules {
            guard let object = rule.object else { throw UnsupportedRule(item: "dns rule") }
            if let unknown = object.keys.first(where: { !known.contains($0) }) { throw UnsupportedRule(item: unknown) }
            let types = object["query_type"]?.array?.compactMap(\.string)
            let typeOK = types == nil || types!.contains(queryType)
            let suffixOK = object["domain_suffix"].map { suffixMatch(domain, $0.array?.compactMap(\.string) ?? []) } ?? true
            let exactOK = object["domain"].map { ($0.array?.compactMap(\.string) ?? []).contains(normalize(domain)) } ?? true
            if typeOK && suffixOK && exactOK {
                return object["action"]?.string == "predefined" ? "predefined" : (object["server"]?.string ?? final)
            }
        }
        return final
    }

    static func matches(_ rule: JSONObject, _ c: Connection) throws -> Bool {
        for (key, value) in rule.pairs {
            let ok: Bool
            switch key {
            case "action", "outbound", "inbound": ok = true
            case "protocol": ok = c.dns && (value.array?.contains("dns") ?? false)
            case "port": ok = value.array?.contains(where: { $0.int == c.port }) ?? false
            case "network": ok = value.array?.contains(.string(c.network)) ?? false
            case "domain_suffix": ok = c.domain.map { suffixMatch($0, value.array?.compactMap(\.string) ?? []) } ?? false
            case "domain": ok = c.domain.map { (value.array?.compactMap(\.string) ?? []).contains(normalize($0)) } ?? false
            case "ip_cidr": ok = c.ip.map { ip in (value.array?.compactMap(\.string) ?? []).contains { cidrMatch(ip, $0) } } ?? false
            case "ip_is_private": ok = c.ip.map { isPrivate($0) == value.bool } ?? false
            default: throw UnsupportedRule(item: key)
            }
            if !ok { return false }
        }
        return true
    }

    static func normalize(_ domain: String) -> String {
        var host = domain.lowercased()
        while host.hasSuffix(".") { host.removeLast() }
        return host
    }

    public static func suffixMatch(_ domain: String, _ suffixes: [String]) -> Bool {
        let host = normalize(domain)
        return suffixes.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    static func cidrMatch(_ ip: String, _ cidr: String) -> Bool {
        if ip.contains(":") || cidr.contains(":") {
            return ip.contains(":") && cidr.contains(":") && Net.ipv6InCIDR(ip, cidr)
        }
        return Net.ipv4InCIDR(ip, cidr)
    }

    /// sing-box `ip_is_private`: RFC 1918, loopback, link-local, CGNAT, ULA.
    static func isPrivate(_ ip: String) -> Bool {
        if ip.contains(":") {
            return ["fc00::/7", "fe80::/10", "::1/128"].contains { Net.ipv6InCIDR(ip, $0) }
        }
        return ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10"]
            .contains { Net.ipv4InCIDR(ip, $0) }
    }
}

/// The user-facing answer to "where does this site go?".
public enum RouteLabel: String, Sendable {
    case home = "HOME", cloud = "CLOUD", direct = "DIRECT", blocked = "BLOCKED", dns = "DNS"
}

public struct RouteAnswer: Equatable, Sendable {
    public let host: String
    public let tcp: RouteLabel
    public let udp: RouteLabel
}

extension RouteExplainer {
    /// Cleans user input ("https://claude.ai/new" → "claude.ai") or returns nil when it is not a host.
    public static func cleanHost(_ input: String) -> String? {
        var s = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for scheme in ["https://", "http://"] where s.hasPrefix(scheme) { s.removeFirst(scheme.count) }
        if let slash = s.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) { s = String(s[..<slash]) }
        if s.hasPrefix("["), let close = s.firstIndex(of: "]") {
            s = String(s[s.index(after: s.startIndex)..<close])
        } else if s.filter({ $0 == ":" }).count == 1, let colon = s.firstIndex(of: ":") {
            s = String(s[..<colon])
        }
        while s.hasSuffix(".") { s.removeLast() }
        guard !s.isEmpty, s.count <= 253, !s.contains(" ") else { return nil }
        return s
    }

    public static func answer(config: JSON, catalog: ExitCatalog, host input: String) -> RouteAnswer? {
        guard let host = cleanHost(input) else { return nil }
        let isIP = Net.parseIPv4(host) != nil || Net.parseIPv6(host) != nil
        func label(_ network: String) -> RouteLabel {
            let c = Connection(domain: isIP ? nil : host, ip: isIP ? host : nil, network: network)
            guard let verdict = try? explain(config, c) else { return .blocked }
            switch verdict {
            case .route(let outbound, _):
                if outbound == SingBoxConfig.directTag { return .direct }
                if outbound == SingBoxConfig.exitTag { return .cloud }
                return catalog.home != nil && outbound == SingBoxConfig.homeTargetTag(catalog) ? .home : .cloud
            case .reject: return .blocked
            case .hijackDNS: return .dns
            }
        }
        return RouteAnswer(host: host, tcp: label("tcp"), udp: label("udp"))
    }
}
