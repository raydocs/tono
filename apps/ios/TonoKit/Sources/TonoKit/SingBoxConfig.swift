import Foundation

/// Mobile routing modes. Names follow the desktop "路由模式" setting and the Android client.
public enum RoutingMode: String, Codable, Sendable, CaseIterable {
    /// AI/Home → Home, video → cloud, everything else on the phone's own network (DIRECT).
    case threeTier = "THREE_TIER"
    /// Desktop "稳定": AI/Home → Home, video and every other public destination → cloud. LAN stays local.
    case stable = "STABLE"
}

public struct ConfigInput: Equatable, Sendable {
    public var catalog: ExitCatalog
    public var selectedCloudNode: String?
    public var mode: RoutingMode
    /// Whether the underlying (non-VPN) network currently has global IPv6.
    public var underlyingIPv6: Bool
    /// Absolute path for sing-box's cache file (fake-IP mappings survive a reload).
    public var cacheFilePath: String?
    public var logLevel: String

    public init(catalog: ExitCatalog, selectedCloudNode: String?, mode: RoutingMode, underlyingIPv6: Bool,
                cacheFilePath: String?, logLevel: String = "warn") {
        self.catalog = catalog
        self.selectedCloudNode = selectedCloudNode
        self.mode = mode
        self.underlyingIPv6 = underlyingIPv6
        self.cacheFilePath = cacheFilePath
        self.logLevel = logLevel
    }
}

/// Generates the sing-box 1.15 configuration for the iOS packet tunnel.
///
/// The rule graph is the Android one (same order, same tags, same DNS), so both phones route a
/// destination identically. iOS has no per-app identity: there are no `package_name` rules and
/// no per-app exclusions; AI apps are recognised by domain and Anthropic's CIDR only.
///
/// Priority (each matched rule is terminal; a failure never falls through to DIRECT):
///  1. DNS hijack; 2. cloud video (TCP → cloud, UDP/ICMP rejected), ahead of the broad Home parents;
///  3. Home suffixes and the Anthropic CIDR (TCP → Home, UDP/ICMP rejected so QUIC falls back to TCP);
///  4. protected Tono hosts and the explicit overseas list → cloud; 5. stale fake IPs rejected;
///  6. LAN/private → DIRECT; 7. final: DIRECT (three-tier) or cloud (stable, UDP rejected).
public enum SingBoxConfig {
    public static let exitTag = "Tono-Exit"
    public static let homeSocksTag = "Tono-Home-Residential"
    public static let directTag = "direct"
    public static let blockTag = "block"
    public static let dnsLocal = "local"
    public static let dnsFakeIP = "fakeip"
    public static let tunTag = "tun-in"

    public static let tunInet4 = "198.18.0.1/30"
    public static let tunInet6 = "fdfe:dcba:9876::1/126"
    public static let fakeIPInet4 = "198.18.128.0/17"
    public static let fakeIPInet6 = "fc00::/18"
    /// Network Extension utun throughput collapses above 4064 (4096 − UTUN_IF_HEADROOM_SIZE); sing-box
    /// uses the same value as its NE default. Written out so the graph is identical on every build.
    public static let tunMTU = 4064

    /// Destinations that never enter the tunnel (become NEIPv4/6Settings.excludedRoutes).
    public static let tunRouteExclude = [
        "10.0.0.0/8", "100.64.0.0/10", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16",
        "224.0.0.0/4", "255.255.255.255/32", "fe80::/10", "ff00::/8",
    ]

    /// Local names that must keep resolving on the phone's own network.
    static let localDNSSuffixes = ["local", "lan", "home.arpa", "in-addr.arpa", "ip6.arpa", "localhost"]

    /// Protected hosts not already covered by the Home or video lists (those rules come first).
    public static var protectedRemainder: [String] {
        let covered = DesktopRoutingContract.homeSuffixes + DesktopRoutingContract.mobileHomeAuxSuffixes + DesktopRoutingContract.cloudVideoSuffixes
        return DesktopRoutingContract.protectedDirectSuffixes.filter { suffix in
            !covered.contains { suffix == $0 || suffix.hasSuffix(".\($0)") }
        }
    }

    public static func homeTargetTag(_ catalog: ExitCatalog) -> String {
        switch catalog.home {
        case .socks5: return homeSocksTag
        case .catalogNode(let node): return node.name
        case nil: return exitTag
        }
    }

    public static func selectedNode(_ input: ConfigInput) -> VlessNode {
        let nodes = input.catalog.cloudNodes
        return nodes.first { $0.name == input.selectedCloudNode }
            ?? nodes.first { $0.name == input.catalog.defaultCloudNode }
            ?? nodes[0]
    }

    public static func build(_ input: ConfigInput) -> JSON {
        let catalog = input.catalog
        let selected = selectedNode(input)
        let home = homeTargetTag(catalog)
        let video = DesktopRoutingContract.cloudVideoSuffixes
        let homeSuffixes = DesktopRoutingContract.homeSuffixes + DesktopRoutingContract.mobileHomeAuxSuffixes
        let protected = protectedRemainder + DesktopRoutingContract.publicStunSuffixes
        let threeTier = input.mode == .threeTier
        let cloudOnlyExact = threeTier ? DesktopRoutingContract.overseasExact : []

        var outbounds: [JSON] = catalog.cloudNodes.map(vless)
        if case .catalogNode(let node) = catalog.home { outbounds.append(vless(node)) }
        outbounds.append(.obj(
            ("type", "selector"),
            ("tag", .string(exitTag)),
            ("outbounds", .strings(catalog.cloudNodes.map(\.name))),
            ("default", .string(selected.name)),
            ("interrupt_exist_connections", true)
        ))
        if case .socks5(let socks) = catalog.home {
            outbounds.append(.obj(
                ("type", "socks"),
                ("tag", .string(homeSocksTag)),
                ("server", .string(socks.host)),
                ("server_port", .int(socks.port)),
                ("version", "5"),
                ("username", .string(socks.username)),
                ("password", .string(socks.password)),
                ("network", "tcp"),
                ("detour", .string(exitTag))
            ))
        }
        outbounds.append(.obj(("type", "direct"), ("tag", .string(directTag))))

        let udpIcmp: JSON = ["udp", "icmp"]
        var rules: [JSON] = []
        rules.append(.obj(("inbound", .strings([tunTag])), ("action", "sniff")))
        rules.append(.obj(("protocol", ["dns"]), ("action", "hijack-dns")))
        rules.append(.obj(("port", [53]), ("action", "hijack-dns")))
        rules.append(reject([("port", .ints(DesktopRoutingContract.encryptedDNSPorts))]))
        // Cloud video wins over the broad Home parents (youtubei.googleapis.com vs googleapis.com).
        rules.append(route([("network", ["tcp"]), ("domain_suffix", .strings(video))], exitTag))
        rules.append(reject([("network", udpIcmp), ("domain_suffix", .strings(video))]))
        rules.append(route([("network", ["tcp"]), ("domain_suffix", .strings(homeSuffixes))], home))
        rules.append(reject([("network", udpIcmp), ("domain_suffix", .strings(homeSuffixes))]))
        rules.append(route([("network", ["tcp"]), ("ip_cidr", .strings(DesktopRoutingContract.homeIPv4CIDRs))], home))
        rules.append(reject([("network", udpIcmp), ("ip_cidr", .strings(DesktopRoutingContract.homeIPv4CIDRs))]))
        if !protected.isEmpty {
            rules.append(route([("network", ["tcp"]), ("domain_suffix", .strings(protected))], exitTag))
            rules.append(reject([("network", udpIcmp), ("domain_suffix", .strings(protected))]))
        }
        if !cloudOnlyExact.isEmpty {
            rules.append(route([("network", ["tcp"]), ("domain", .strings(cloudOnlyExact))], exitTag))
            rules.append(reject([("network", udpIcmp), ("domain", .strings(cloudOnlyExact))]))
        }
        // A fake address without a live mapping (e.g. cached across a restart) never leaves the phone.
        rules.append(reject([("ip_cidr", .strings([fakeIPInet4, fakeIPInet6]))]))
        rules.append(route([("ip_is_private", true)], directTag))
        // Overseas UDP and raw-IP STUN probes (e.g. 74.125.250.129:19302) are rejected in every mode
        // while domestic UDP (WeChat voice/video, Douyin QUIC, LAN cast) stays direct in Three-Tier.
        let overseasUDPCIDRs = DesktopRoutingContract.overseasUDPRejectIPv4CIDRs + DesktopRoutingContract.overseasUDPRejectIPv6CIDRs
        rules.append(reject([("network", udpIcmp), ("port", .ints(DesktopRoutingContract.stunUDPPorts))]))
        rules.append(reject([("network", udpIcmp), ("ip_cidr", .strings(overseasUDPCIDRs))]))
        if !threeTier { rules.append(reject([("network", udpIcmp)])) }

        let fakeIPSuffixes = video + homeSuffixes + protected
        var dnsRules: [JSON] = []
        dnsRules.append(.obj(("domain_suffix", .strings(localDNSSuffixes)), ("action", "route"), ("server", .string(dnsLocal))))
        dnsRules.append(.obj(
            ("query_type", ["A", "AAAA"]), ("domain_suffix", .strings(fakeIPSuffixes)),
            ("action", "route"), ("server", .string(dnsFakeIP))
        ))
        dnsRules.append(.obj(
            ("query_type", ["HTTPS", "SVCB"]), ("domain_suffix", .strings(fakeIPSuffixes)),
            ("action", "predefined"), ("rcode", "NOERROR")
        ))
        if !cloudOnlyExact.isEmpty {
            dnsRules.append(.obj(
                ("query_type", ["A", "AAAA"]), ("domain", .strings(cloudOnlyExact)),
                ("action", "route"), ("server", .string(dnsFakeIP))
            ))
            dnsRules.append(.obj(
                ("query_type", ["HTTPS", "SVCB"]), ("domain", .strings(cloudOnlyExact)),
                ("action", "predefined"), ("rcode", "NOERROR")
            ))
        }
        if !threeTier {
            // Stable: every public name leaves through the cloud, so the phone's resolver never sees it.
            dnsRules.append(.obj(("query_type", ["A", "AAAA"]), ("action", "route"), ("server", .string(dnsFakeIP))))
            dnsRules.append(.obj(("query_type", ["HTTPS", "SVCB"]), ("action", "predefined"), ("rcode", "NOERROR")))
        }
        if !input.underlyingIPv6 {
            // No global IPv6 on the phone's network: DIRECT names answer IPv4 only, so apps do not stall on v6.
            dnsRules.append(.obj(("query_type", ["AAAA"]), ("action", "predefined"), ("rcode", "NOERROR")))
        }

        var root = JSONObject()
        root["log"] = .obj(("level", .string(input.logLevel)), ("timestamp", false))
        root["dns"] = .obj(
            ("servers", [
                .obj(("type", "local"), ("tag", .string(dnsLocal))),
                .obj(("type", "fakeip"), ("tag", .string(dnsFakeIP)), ("inet4_range", .string(fakeIPInet4)), ("inet6_range", .string(fakeIPInet6))),
            ]),
            ("rules", .array(dnsRules)),
            ("final", .string(dnsLocal))
        )
        root["inbounds"] = [.obj(
            ("type", "tun"),
            ("tag", .string(tunTag)),
            ("address", .strings([tunInet4, tunInet6])),
            ("mtu", .int(tunMTU)),
            ("auto_route", true),
            ("route_exclude_address", .strings(tunRouteExclude))
        )]
        root["outbounds"] = .array(outbounds)
        root["route"] = .obj(
            ("rules", .array(rules)),
            ("final", .string(threeTier ? directTag : exitTag)),
            ("auto_detect_interface", true),
            ("default_domain_resolver", .obj(("server", .string(dnsLocal))))
        )
        if let path = input.cacheFilePath {
            root["experimental"] = .obj(("cache_file", .obj(("enabled", true), ("path", .string(path)), ("store_fakeip", true))))
        }
        return .object(root)
    }

    public static func buildJSON(_ input: ConfigInput) -> String { build(input).serialized() }

    static func vless(_ node: VlessNode) -> JSON {
        var o = JSONObject([
            ("type", "vless"),
            ("tag", .string(node.name)),
            ("server", .string(node.server)),
            ("server_port", .int(node.port)),
            ("uuid", .string(node.uuid)),
        ])
        if let flow = node.flow { o["flow"] = .string(flow) }
        o["tls"] = .obj(
            ("enabled", true),
            ("server_name", .string(node.serverName)),
            ("utls", .obj(("enabled", true), ("fingerprint", .string(node.fingerprint)))),
            ("reality", .obj(("enabled", true), ("public_key", .string(node.realityPublicKey)), ("short_id", .string(node.realityShortID))))
        )
        return .object(o)
    }

    static func route(_ match: [(String, JSON)], _ outbound: String) -> JSON {
        .object(JSONObject(match + [("action", "route"), ("outbound", .string(outbound))]))
    }

    static func reject(_ match: [(String, JSON)]) -> JSON {
        .object(JSONObject(match + [("action", "reject")]))
    }
}
