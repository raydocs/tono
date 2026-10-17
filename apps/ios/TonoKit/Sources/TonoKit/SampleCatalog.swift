import Foundation

/// Fictional catalog for tests, `tono-config` and SwiftUI previews only. The same two nodes as the
/// Android fixtures (`android/routing/src/test/.../Fixtures.kt`), so both clients' generated
/// graphs can be compared. Never used by the running app: real nodes come only from the API.
public enum SampleCatalog {
    public static let yaml = """
    # fixture with documentation-free public addresses
    proxies:
      - name: Tokyo · Dawn
        type: vless
        server: 8.8.4.4
        port: 443
        uuid: 11111111-1111-4111-8111-111111111111
        network: tcp
        tls: true
        udp: true
        servername: alpha.example
        client-fingerprint: chrome
        flow: xtls-rprx-vision
        reality-opts:
          public-key: 3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08
          short-id: a1b2
      - {name: "Los Angeles · Grove", type: vless, server: 9.9.9.9, port: 8443, uuid: 22222222-2222-4222-8222-222222222222, tls: true, servername: beta.example, reality-opts: {public-key: 3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08, short-id: c3d4e5}}

    """

    public static let socks = HomeSocks5(host: "1.0.0.1", port: 1080, username: "home-user", password: "home-pass")

    public static func body(yaml: String = SampleCatalog.yaml, routing: CatalogRouting? = CatalogRouting(homeSocks5: socks),
                            includeRoutingDigest: Bool = true, revision: Int = 7) -> JSON {
        var o = JSONObject()
        o["revision"] = .int(revision)
        o["yaml"] = .string(yaml)
        o["sha256"] = .string(SHA256.base64URL(yaml))
        if includeRoutingDigest { o["routingSha256"] = .string(CatalogAdmission.routingDigest(routing)) }
        if let routing {
            var r = JSONObject()
            if let h = routing.homeProxy { r["homeProxy"] = .string(h) }
            if let d = routing.defaultProxy { r["defaultProxy"] = .string(d) }
            if let s = routing.homeSocks5 {
                r["homeSocks5"] = .obj(("host", .string(s.host)), ("port", .int(s.port)), ("username", .string(s.username)), ("password", .string(s.password)))
            }
            o["routing"] = .object(r)
        }
        return .object(o)
    }

    public static func catalog(routing: CatalogRouting? = CatalogRouting(homeSocks5: socks)) -> ExitCatalog {
        // The fixture is constant and admissible; a failure here is a programming error.
        try! CatalogAdmission.admit(body(routing: routing))
    }

    public static func config(mode: RoutingMode = .threeTier, routing: CatalogRouting? = CatalogRouting(homeSocks5: socks),
                              ipv6: Bool = true) -> JSON {
        SingBoxConfig.build(ConfigInput(catalog: catalog(routing: routing), selectedCloudNode: nil, mode: mode,
                                        underlyingIPv6: ipv6, cacheFilePath: "/private/var/mobile/cache.db"))
    }

    /// The four graphs `apps/ios/tools/check-singbox.sh` validates with the pinned sing-box CLI.
    public static var snapshotCases: [(String, JSON)] {
        [
            ("three-tier-socks-home", config()),
            ("three-tier-node-home", config(routing: CatalogRouting(homeProxy: "Los Angeles · Grove"))),
            ("three-tier-no-home-no-v6", config(routing: nil, ipv6: false)),
            ("stable-socks-home", config(mode: .stable)),
        ]
    }
}
