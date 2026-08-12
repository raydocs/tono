import CryptoKit
import Foundation

// ConfigPipeline only needs this value contract; the product definition lives
// in TonoSidecarService.swift.
nonisolated struct TonoTransportDescriptor: Sendable, Equatable {
    let host: String
    let port: UInt16
    let username: String?
    let password: String?
    let udp: Bool

    init(
        host: String = "127.0.0.1",
        port: UInt16,
        username: String? = nil,
        password: String? = nil,
        udp: Bool = true
    ) {
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.udp = udp
    }
}

@main
struct MultiExitPolicyTests {
    static func main() throws {
        guard CommandLine.arguments.count >= 3 else {
            throw TestFailure("expected one or more YAML fixtures and a sanitized runtime path")
        }
        var nodes: [ProxyNode] = []
        for path in CommandLine.arguments.dropFirst().dropLast() {
            let url = URL(fileURLWithPath: path)
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values.isRegularFile == true,
                  let size = values.fileSize,
                  size > 0, size <= 1_048_576 else {
                throw TestFailure("fixture must be a bounded regular file")
            }
            let content = try String(contentsOf: url, encoding: .utf8)
            let parsed = ConfigParser.parseSubscription(content)
            guard !parsed.isEmpty else { throw TestFailure("fixture has no supported nodes") }
            nodes.append(contentsOf: parsed)
        }
        let validated = try ConfigPipeline.validatedOwnedNodes(nodes)
        guard validated.count == nodes.count else {
            throw TestFailure("node validation count changed")
        }
        let v3PolicyJSON = """
        {
          "version": 3,
          "domains": [],
          "mediaEndpoints": [],
          "webDomains": [],
          "directSuffixes": [{"host": "edu.cn", "ports": [80, 443]}]
        }
        """
        let decodedV3Policy = try JSONDecoder().decode(
            TonoTrafficPolicy.self,
            from: Data(v3PolicyJSON.utf8)
        )
        guard decodedV3Policy.version == 3,
              decodedV3Policy.directSuffixes == [
                  .init(host: "edu.cn", ports: [80, 443]),
              ] else {
            throw TestFailure("traffic-policy v3 directSuffixes did not decode")
        }

        var japanNamed = validated[0]
        japanNamed.id = "jp-default-order-test"
        japanNamed.flag = "🇯🇵"
        japanNamed.name = "JP-VLESS-Reality"
        var usNamed = validated[0]
        usNamed.id = "us-default-order-test"
        usNamed.flag = "🇺🇸"
        usNamed.name = "US-VLESS-Reality"
        let intentionallyJapanFirst = [japanNamed, usNamed]
        guard ConfigPipeline.preferredCloudExit(
            in: intentionallyJapanFirst,
            named: "US Reality"
        )?.id == usNamed.id,
        ConfigPipeline.orderedCloudExits(
            intentionallyJapanFirst,
            preferredName: "US Reality"
        ).first?.id == usNamed.id,
        ConfigPipeline.preferredCloudExit(
            in: intentionallyJapanFirst,
            named: "JP Reality"
        )?.id == japanNamed.id else {
            throw TestFailure("regional Reality exit was not selected deterministically")
        }
        for node in validated {
            guard node.realityPublicKey?.isEmpty == false,
                  node.realityShortId?.isEmpty == false else {
                throw TestFailure("\(node.name) lost its Reality credentials")
            }
            let endpoints = try ConfigPipeline.dialEndpoints(for: node)
            guard endpoints == [
                .init(host: node.server.lowercased(), port: UInt16(node.port), transport: "tcp"),
            ] else {
                throw TestFailure("\(node.name) does not have an exact TCP endpoint contract")
            }
        }
        let inlineReality = """
        proxies:
          - {name: Inline-Reality, type: vless, server: 1.1.1.1, port: 443, uuid: 00000000-0000-4000-8000-000000000099, network: tcp, tls: true, servername: inline.example.com, reality-opts: {public-key: CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC, short-id: 0011223344556677}}
        """
        guard let parsedInline = ConfigParser.parseSubscription(inlineReality).first,
              parsedInline.realityPublicKey?.isEmpty == false,
              parsedInline.realityShortId == "0011223344556677" else {
            throw TestFailure("inline Reality options were not preserved")
        }
        let selected = validated[0]
        let sanitizedNodes = validated.enumerated().map { index, original in
            var node = original
            // Mihomo config validation does not dial this address. Use a
            // syntactically public value because protected import deliberately
            // rejects RFC 5737/private ranges.
            node.server = "8.8.4.\(index + 4)"
            node.uuid = "00000000-0000-4000-8000-\(String(format: "%012d", index + 1))"
            node.password = node.password.map { _ in "test-only-password" }
            node.username = node.username.map { _ in "test-only-user" }
            node.realityPublicKey = node.realityPublicKey.map {
                _ in "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
            }
            node.realityShortId = node.realityShortId.map { _ in "0123456789abcdef" }
            return node
        }
        let sanitizedNode = sanitizedNodes[0]
        let stableRouteAddresses = Array(Set(sanitizedNodes.map(\.server))).sorted()
        let stableRouteExclusionBlock =
            "\n  route-exclude-address:\n"
            + stableRouteAddresses.map { "    - \"\($0)/32\"\n" }.joined()
            + "\nproxies:"

        let overlay = ConfigPipeline.OverlayConfig(
            mixedPort: 31_234,
            externalController: "127.0.0.1:31235",
            secret: "test-only-controller-secret",
            mode: "global",
            logLevel: "info",
            allowLan: true,
            tunEnabled: true,
            selectedNodeName: sanitizedNode.name,
            tonoTransport: .init(port: 31_236)
        )
        let controllerParts = overlay.externalController.split(
            separator: ":",
            omittingEmptySubsequences: false
        )
        guard overlay.mixedPort > 0, overlay.mixedPort <= 65_535,
              controllerParts.count == 2, controllerParts[0] == "127.0.0.1",
              let controllerPort = Int(controllerParts[1]),
              controllerPort > 0, controllerPort <= 65_535,
              ["debug", "info", "warning", "error", "silent"].contains(overlay.logLevel) else {
            throw TestFailure(
                "test overlay mismatch: mixed=\(overlay.mixedPort), " +
                "controller=\(overlay.externalController), log=\(overlay.logLevel)"
            )
        }
        let runtime = try ConfigPipeline.buildOwnedTonoRuntime(
            // Cloud catalog nodes are supplied through the validated model
            // path; no source document contributes runtime policy.
            subscriptionYAML: "proxies: []\n",
            overlay: overlay,
            transport: overlay.tonoTransport!,
            customNodes: sanitizedNodes
        )
        let required = [
            ("owned-marker", "# Tono owned runtime"),
            ("lan-off", "\nallow-lan: false\n"),
            ("ipv6-off", "\nipv6: false\n"),
            ("udp-rule-engine", "\nudp: true\n"),
            ("rule-mode", "\nmode: rule\n"),
            ("unified-delay", "\nunified-delay: true\n"),
            ("demand-process-lookup", "\nfind-process-mode: strict\n"),
            ("disable-stale-selection-cache", "\n  store-selected: false\n"),
            ("disable-direct-icmp", "\n  disable-icmp-forwarding: true\n"),
            (
                "protected-loopback-dns",
                "\n  listen: \(ProtectedDNSContract.listener)\n"
            ),
            (
                "dns-upstream-through-tono-exit",
                "\n    - https://1.1.1.1/dns-query#Tono-Exit\n"
            ),
            (
                "proxy-dns-upstream-through-tono-exit",
                "\n    - https://8.8.8.8/dns-query#Tono-Exit\n"
            ),
            ("dns-hijack", "\n  dns-hijack:\n"),
            ("strict-tun-route", "\n  strict-route: true\n"),
            ("gvisor-tun-stack", "\n  stack: gvisor\n"),
            ("owned-tun", "\n  device: utun199\n"),
            (
                "stable-catalog-route-exclusions",
                stableRouteExclusionBlock
            ),
            ("final-route", "\n  - MATCH,Tono-Exit"),
            ("reality", "\n    reality-opts:\n"),
            ("reality-servername", "\n    servername: "),
            ("reality-key", "\n      public-key: "),
            ("reality-short-id", "\n      short-id: "),
        ]
        let missing = required.filter { !runtime.contains($0.1) }.map(\.0)
        guard missing.isEmpty else {
            throw TestFailure("owned runtime omitted: \(missing.joined(separator: ","))")
        }
        guard !runtime.contains("\nmode: global\n"),
              !runtime.contains("\n      fallback:\n"),
              !runtime.contains("\n      default-nameserver:\n"),
              !runtime.contains("skip-cert-verify: true"),
              !runtime.contains("\n    sni:"),
              runtime.contains("\n      - \"\(escaped(selected.name))\"") else {
            throw TestFailure("owned runtime accepted an unsafe source policy")
        }
        for node in sanitizedNodes {
            guard let servername = node.sni,
                  runtime.contains(
                    "\n    servername: \"\(escaped(servername))\"\n"
                  ) else {
                throw TestFailure("\(node.name) lost its Reality servername")
            }
        }

        var cloudOnlyOverlay = overlay
        cloudOnlyOverlay.tonoTransport = nil
        let cloudRuntime = try ConfigPipeline.buildOwnedTonoRuntime(
            subscriptionYAML: "mode: global\nrules:\n  - MATCH,DIRECT\n",
            overlay: cloudOnlyOverlay,
            transport: nil,
            customNodes: sanitizedNodes
        )
        guard cloudRuntime.contains("# Tono owned runtime"),
              cloudRuntime.contains("\n  - MATCH,Tono-Exit"),
              cloudRuntime.contains("\n      - \"\(escaped(selected.name))\""),
              cloudRuntime.contains(stableRouteExclusionBlock),
              !cloudRuntime.contains(ConfigPipeline.homeNodeName),
              !cloudRuntime.contains("PROCESS-NAME,tailscale"),
              !cloudRuntime.contains("PROCESS-NAME,tono-core-helper"),
              !cloudRuntime.contains("\nmode: global\n"),
              !cloudRuntime.contains("MATCH,DIRECT") else {
            throw TestFailure("cloud-only fallback did not preserve the owned fail-closed runtime")
        }

        var claudeHomeOverlay = cloudOnlyOverlay
        claudeHomeOverlay.claudeHomeNodeName = sanitizedNode.name
        claudeHomeOverlay.defaultNodeName = sanitizedNode.name
        let claudeHomeRuntime = try ConfigPipeline.buildOwnedTonoRuntime(
            subscriptionYAML: "proxies: []\n",
            overlay: claudeHomeOverlay,
            transport: nil,
            customNodes: sanitizedNodes
        )
        let claudeHomeRequired = [
            "name: \"\(ConfigPipeline.claudeHomeGroupName)\"",
            "AND,((NETWORK,TCP),(PROCESS-NAME,Claude)),\(ConfigPipeline.claudeHomeGroupName)",
            "AND,((NETWORK,TCP),(PROCESS-NAME,claude)),\(ConfigPipeline.claudeHomeGroupName)",
            "AND,((NETWORK,TCP),(PROCESS-NAME,claude.exe)),\(ConfigPipeline.claudeHomeGroupName)",
            "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,claude.ai)),\(ConfigPipeline.claudeHomeGroupName)",
            "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,claude.com)),\(ConfigPipeline.claudeHomeGroupName)",
            "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,anthropic.com)),\(ConfigPipeline.claudeHomeGroupName)",
            "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,claudeusercontent.com)),\(ConfigPipeline.claudeHomeGroupName)",
        ]
        guard claudeHomeRequired.allSatisfy(claudeHomeRuntime.contains),
              !claudeHomeRuntime.contains("PROCESS-NAME,Claude)),Tono-Exit") else {
            throw TestFailure("Claude home route was not isolated in the owned runtime")
        }

        var claudeSocks5Overlay = cloudOnlyOverlay
        claudeSocks5Overlay.claudeHomeSocks5 = .init(
            host: "residential.example.com",
            port: 11_080,
            username: "residential-user",
            password: "test-only-password"
        )
        let claudeSocks5Runtime = try ConfigPipeline.buildOwnedTonoRuntime(
            subscriptionYAML: "proxies: []\n",
            overlay: claudeSocks5Overlay,
            transport: nil,
            customNodes: sanitizedNodes
        )
        let residentialProxy = ConfigPipeline.homeResidentialProxyName
        guard claudeSocks5Runtime.contains("name: \"\(residentialProxy)\""),
              claudeSocks5Runtime.contains("server: \"residential.example.com\""),
              claudeSocks5Runtime.contains("dialer-proxy: \"\(ConfigPipeline.exitGroupName)\""),
              claudeSocks5Runtime.contains("udp: false"),
              claudeSocks5Runtime.contains("- \"\(residentialProxy)\""),
              claudeSocks5Runtime.contains(
                  "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,claude.ai)),\(ConfigPipeline.claudeHomeGroupName)"
              ),
              !claudeSocks5Runtime.contains("PROCESS-NAME,Claude)),Tono-Exit") else {
            throw TestFailure("homeSocks5 Claude chain was not fail-closed and TCP-scoped")
        }

        // Every named assistant provider must ride the residential hop, and the
        // shared infrastructure the public AI rule lists bundle in must not:
        // gstatic.com in particular is this group's own liveness probe, so
        // routing it here would test the hop through itself.
        for provider in ConfigPipeline.assistantHomeDomainSuffixes {
            guard claudeSocks5Runtime.contains(
                "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,\(provider))),\(ConfigPipeline.claudeHomeGroupName)"
            ) else {
                throw TestFailure("assistant provider \(provider) was not routed to the residential hop")
            }
        }
        for shared in ["gstatic.com", "auth0.com", "stripe.com", "sentry.io", "statsig.com", "googleapis.com", "x.com"] {
            guard !claudeSocks5Runtime.contains(
                "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,\(shared))),\(ConfigPipeline.claudeHomeGroupName)"
            ) else {
                throw TestFailure("shared infrastructure \(shared) must not be pinned to the residential hop")
            }
        }

        // The residential hop is a consumer uplink reached through a second
        // hop; a one-member `select` group left every Claude stream with no
        // failover and no liveness check, which is how requests died
        // mid-response while the exit probe still reported healthy. The hop
        // must stay first, the protected exit must back it, and both members
        // must remain protected exits so nothing here can egress directly.
        let claudeGroupBlock = claudeSocks5Runtime
            .components(separatedBy: "name: \"\(ConfigPipeline.claudeHomeGroupName)\"")
            .dropFirst()
            .first ?? ""
        let residentialIndex = claudeGroupBlock.range(of: "- \"\(residentialProxy)\"")?.lowerBound
        let exitIndex = claudeGroupBlock.range(of: "- \"\(ConfigPipeline.exitGroupName)\"")?.lowerBound
        guard claudeGroupBlock.contains("type: fallback"),
              let residentialIndex,
              let exitIndex,
              residentialIndex < exitIndex,
              claudeGroupBlock.contains("url: \"\(ConfigPipeline.claudeHomeHealthURL)\""),
              claudeGroupBlock.contains(
                  "interval: \(ConfigPipeline.managedDirectHealthIntervalSeconds)"
              ),
              !claudeGroupBlock.contains("- DIRECT"),
              !claudeGroupBlock.contains("- \"\(ConfigPipeline.directProxyName)\"") else {
            throw TestFailure(
                "Claude home group must be a health-checked fallback that prefers the residential hop and backs it with the protected exit only"
            )
        }

        let managedDirectPolicy = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [
                .init(
                    host: "res.wx.qq.com",
                    addresses: ["43.146.27.19"],
                    ports: [80, 443]
                ),
            ],
            webDomainPins: [
                .init(
                    host: "www.bilibili.com",
                    addresses: ["120.92.78.97"],
                    ports: [443]
                ),
            ],
            mediaEndpoints: [
                .init(address: "43.146.27.17", port: 443, transport: "udp"),
                .init(address: "43.146.27.17", port: 8000, transport: "udp"),
            ],
            tcpEndpoints: [
                .init(address: "49.51.67.253", port: 80, transport: "tcp"),
            ]
        )
        let validatedDirectPolicy = try ConfigPipeline.validatedManagedDirectPolicy(
            managedDirectPolicy,
            excluding: Set(sanitizedNodes.map(\.server))
        )
        guard validatedDirectPolicy?.sessionEndpoints.count == 6 else {
            throw TestFailure("managed direct policy did not produce exact PF tuples")
        }
        let fallbackTargets = ConfigPipeline.managedDirectFallbackTargets(
            for: validatedDirectPolicy
        )
        guard fallbackTargets.count == 3,
              Set(fallbackTargets.map(\.groupName)).count == 3,
              let fallback80 = fallbackTargets.first(where: {
                  $0.host == "res.wx.qq.com" && $0.port == 80
              }),
              let fallback443 = fallbackTargets.first(where: {
                  $0.host == "res.wx.qq.com" && $0.port == 443
              }),
              let tcpFallback80 = fallbackTargets.first(where: {
                  $0.host == "49.51.67.253" && $0.port == 80
              }),
              fallback80.host == "res.wx.qq.com",
              fallback80.testURL == "http://res.wx.qq.com/",
              fallback443.host == "res.wx.qq.com",
              fallback443.testURL == "https://res.wx.qq.com/",
              tcpFallback80.testURL == "http://mmbiz.qpic.cn/",
              fallbackTargets.allSatisfy({
                  $0.groupName.hasPrefix(
                      ConfigPipeline.managedDirectFallbackGroupPrefix
                  )
              }) else {
            throw TestFailure("managed DIRECT fallback targets were not exact")
        }
        let managedDirectRuntime = try ConfigPipeline.buildOwnedTonoRuntime(
            subscriptionYAML: "proxies: []\n",
            overlay: cloudOnlyOverlay,
            transport: nil,
            customNodes: sanitizedNodes,
            directPolicy: managedDirectPolicy
        )
        let claudeProtectedRuntime = try ConfigPipeline.buildOwnedTonoRuntime(
            subscriptionYAML: "proxies: []\n",
            overlay: claudeSocks5Overlay,
            transport: nil,
            customNodes: sanitizedNodes,
            directPolicy: managedDirectPolicy
        )
        guard let weChatProcessPathRegex =
                ConfigPipeline.managedDirectProcessPathRegexes.first else {
            throw TestFailure("managed DIRECT omitted the standard WeChat bundle")
        }
        let directRule80 =
            "AND,((NETWORK,TCP),(DST-PORT,80),(DOMAIN,res.wx.qq.com),(PROCESS-PATH-REGEX,\(weChatProcessPathRegex))),\(fallback80.groupName)"
        let directRule443 =
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN,res.wx.qq.com),(PROCESS-PATH-REGEX,\(weChatProcessPathRegex))),\(fallback443.groupName)"
        let pinnedIPRule443 =
            "AND,((NETWORK,TCP),(DST-PORT,443),(IP-CIDR,43.146.27.19/32,no-resolve),(PROCESS-PATH-REGEX,\(weChatProcessPathRegex))),\(fallback443.groupName)"
        let tcpDirectRule80 =
            "AND,((NETWORK,TCP),(DST-PORT,80),(IP-CIDR,49.51.67.253/32,no-resolve),(PROCESS-PATH-REGEX,\(weChatProcessPathRegex))),\(tcpFallback80.groupName)"
        // Claude Code's launcher is named after its version, so the basename
        // rules can never match it. These assert the path rules exist, target
        // the residential hop, and are never rewritten onto a direct target.
        let assistantPathRules = ConfigPipeline.assistantHomeProcessPathRegexes.map {
            "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,\($0))),\(ConfigPipeline.claudeHomeGroupName)"
        }
        let webDirectRule =
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN,www.bilibili.com)),Tono-China-Web"
        let mediaRule443 =
            "AND,((NETWORK,UDP),(DST-PORT,443),(IP-CIDR,43.146.27.17/32,no-resolve),(PROCESS-PATH-REGEX,\(weChatProcessPathRegex))),Tono-China-Direct"
        let mediaRule8000 =
            "AND,((NETWORK,UDP),(DST-PORT,8000),(IP-CIDR,43.146.27.17/32,no-resolve),(PROCESS-PATH-REGEX,\(weChatProcessPathRegex))),Tono-China-Direct"
        let directRulePrecedesMatch: Bool
        if let directRuleRange = managedDirectRuntime.range(of: directRule443),
           let matchRuleRange = managedDirectRuntime.range(of: "  - MATCH,Tono-Exit") {
            directRulePrecedesMatch = directRuleRange.lowerBound < matchRuleRange.lowerBound
        } else {
            directRulePrecedesMatch = false
        }
        let claudeRules = [
            "AND,((NETWORK,TCP),(PROCESS-NAME,Claude)),Tono-Exit",
            "AND,((NETWORK,TCP),(PROCESS-NAME,claude)),Tono-Exit",
            "AND,((NETWORK,TCP),(PROCESS-NAME,claude.exe)),Tono-Exit",
        ]
        let claudeRulesPrecedeDirect = claudeRules.allSatisfy { rule in
            guard let claudeRange = managedDirectRuntime.range(of: rule),
                  let directRange = managedDirectRuntime.range(of: directRule443) else {
                return false
            }
            return claudeRange.lowerBound < directRange.lowerBound
        }
        let claudeProtectedRules = [
            "AND,((NETWORK,TCP),(PROCESS-NAME,Claude)),Tono-Claude-Home",
            "AND,((NETWORK,TCP),(PROCESS-NAME,claude)),Tono-Claude-Home",
            "AND,((NETWORK,TCP),(PROCESS-NAME,claude.exe)),Tono-Claude-Home",
            "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,claude.ai)),Tono-Claude-Home",
            "AND,((NETWORK,TCP),(DOMAIN-SUFFIX,anthropic.com)),Tono-Claude-Home",
        ] + assistantPathRules
        let claudeProtectedRulesPrecedeDirect = claudeProtectedRules.allSatisfy { rule in
            guard let claudeRange = claudeProtectedRuntime.range(of: rule),
                  let directRange = claudeProtectedRuntime.range(of: directRule443) else {
                return false
            }
            return claudeRange.lowerBound < directRange.lowerBound
        }
        let claudeProtectedRulesHaveNoDirectTarget = claudeProtectedRules.allSatisfy { rule in
            !claudeProtectedRuntime.contains(rule.replacingOccurrences(
                of: "Tono-Claude-Home",
                with: "Tono-China-Direct"
            )) && !claudeProtectedRuntime.contains(rule.replacingOccurrences(
                of: "Tono-Claude-Home",
                with: "Tono-China-Web-Direct"
            ))
        }
        let bundleTCP80Rule =
            "AND,((NETWORK,TCP),(DST-PORT,80),(PROCESS-PATH-REGEX,"
            + "^\\/Applications\\/WeChat\\.app\\/)),\(ConfigPipeline.exitGroupName)"
        let bundleDirectRule =
            "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,"
            + "^\\/Applications\\/WeChat\\.app\\/)),\(ConfigPipeline.appDirectGroupName)"
        let bundleTCP80PrecedesBundleDirect: Bool
        if let a = managedDirectRuntime.range(of: bundleTCP80Rule),
           let b = managedDirectRuntime.range(of: bundleDirectRule) {
            bundleTCP80PrecedesBundleDirect = a.lowerBound < b.lowerBound
        } else {
            bundleTCP80PrecedesBundleDirect = false
        }
        let fallbackGroupCount = managedDirectRuntime
            .components(separatedBy: "\n    type: fallback\n")
            .count - 1
        // `Tono-China-Web` is a fallback group too, so the WeChat per-port
        // groups are no longer the whole population. Counting it explicitly
        // keeps the per-port invariant meaningful instead of loosening it.
        let webFallbackGroupCount = managedDirectRuntime
            .contains("name: \"\(ConfigPipeline.webDirectGroupName)\"") ? 1 : 0
        // The reviewed bundle's own route is a fallback group too now, so a
        // bare `direct` outbound can no longer strand a flow it cannot reach.
        let appFallbackGroupCount = managedDirectRuntime
            .contains("name: \"\(ConfigPipeline.appDirectGroupName)\"") ? 1 : 0
        // Scoped to this group's own block. A bare `contains` of the two member
        // lines passed while the group had no exit member at all, because the
        // WeChat per-port groups list the same pair — an assertion that cannot
        // fail for the reason it was written.
        let appDirectFallsBackToExit: Bool
        if let header = managedDirectRuntime.range(
            of: "- name: \"\(ConfigPipeline.appDirectGroupName)\"\n"
        ) {
            let block = managedDirectRuntime[header.upperBound...]
                .prefix(while: { $0 != "-" || true })
                .prefix(300)
            let end = block.range(of: "\n  - name:")?.lowerBound ?? block.endIndex
            let body = block[..<end]
            appDirectFallsBackToExit =
                body.contains("- \"\(ConfigPipeline.directProxyName)\"")
                && body.contains("- \"\(ConfigPipeline.exitGroupName)\"")
                && body.contains("type: fallback")
        } else {
            appDirectFallsBackToExit = false
        }
        let fallback443Block = """
          - name: "\(fallback443.groupName)"
            type: fallback
            proxies:
              - REJECT
              - "Tono-China-Direct"
              - "Tono-Exit"
            url: "https://res.wx.qq.com/"
            interval: 60
            timeout: 3500
            lazy: false
            hidden: true
        """
        let managedDirectChecks = [
            ("proxy", managedDirectRuntime.contains("\n  - name: \"Tono-China-Direct\"\n")),
            ("web-proxy", managedDirectRuntime.contains("\n  - name: \"Tono-China-Web-Direct\"\n")),
            ("type", managedDirectRuntime.contains("\n    type: direct\n")),
            ("interface", managedDirectRuntime.contains("\n    interface-name: \"en0\"\n")),
            (
                "host-pin",
                managedDirectRuntime.contains(
                    "\n  \"res.wx.qq.com\":\n    - \"43.146.27.19\"\n"
                )
            ),
            (
                "web-host-pin",
                managedDirectRuntime.contains(
                    "\n  \"www.bilibili.com\":\n    - \"120.92.78.97\"\n"
                )
            ),
            ("tcp-80-fallback-rule", managedDirectRuntime.contains(directRule80)),
            ("tcp-443-fallback-rule", managedDirectRuntime.contains(directRule443)),
            ("pinned-ip-443-fallback-rule", managedDirectRuntime.contains(pinnedIPRule443)),
            ("tcp-ip-80-fallback-rule", managedDirectRuntime.contains(tcpDirectRule80)),
            ("web-tcp-rule", managedDirectRuntime.contains(webDirectRule)),
            ("udp-443-rule", managedDirectRuntime.contains(mediaRule443)),
            ("udp-8000-rule", managedDirectRuntime.contains(mediaRule8000)),
            ("rule-order", directRulePrecedesMatch),
            ("claude-process-rules", claudeRulesPrecedeDirect),
            ("claude-protected-before-all-direct-rules", claudeProtectedRulesPrecedeDirect),
            ("claude-protected-never-direct", claudeProtectedRulesHaveNoDirectTarget),
            ("udp-fail-closed", managedDirectRuntime.contains("AND,((NETWORK,UDP)),REJECT")),
            ("app-direct-group-exists", appFallbackGroupCount == 1),
            ("app-direct-falls-back-to-exit", appDirectFallsBackToExit),
            (
                "one-fallback-per-wechat-port",
                fallbackGroupCount - webFallbackGroupCount - appFallbackGroupCount
                    == fallbackTargets.count
            ),
            ("fail-closed-fallback-order", managedDirectRuntime.contains(fallback443Block)),
            (
                "no-web-fallback-group",
                !fallbackTargets.contains { $0.host == "www.bilibili.com" }
            ),
            (
                "no-unchecked-wechat-direct-tcp",
                !managedDirectRuntime.contains(
                    "DOMAIN,res.wx.qq.com),(PROCESS-PATH-REGEX,\(weChatProcessPathRegex))),Tono-China-Direct"
                )
            ),
            (
                "no-impossible-tcp-domain-cidr-and",
                !managedDirectRuntime.contains(
                    "DOMAIN,res.wx.qq.com),(IP-CIDR,43.146.27.19/32"
                )
            ),
            ("no-name-only-identity", !managedDirectRuntime.contains("PROCESS-NAME,WeChat")),
            ("no-domain-suffix", !managedDirectRuntime.contains("DOMAIN-SUFFIX")),
            // TCP/80 on the direct path never returned a byte across two
            // measured sessions, so it goes to the protected exit — and it must
            // be matched before the bundle-wide direct rule or it is dead.
            (
                "reviewed-bundle-tcp80-uses-exit",
                bundleTCP80PrecedesBundleDirect
            ),
            // The reviewed bundle routes direct as a whole: address enumeration
            // cannot follow a CDN that rotates ranges and answers no DNS.
            (
                "reviewed-bundle-tcp-direct",
                managedDirectRuntime.contains(
                    "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,^\\/Applications\\/WeChat\\.app\\/)),\(ConfigPipeline.appDirectGroupName)"
                )
            ),
            (
                "reviewed-bundle-udp-direct",
                managedDirectRuntime.contains(
                    "AND,((NETWORK,UDP),(PROCESS-PATH-REGEX,^\\/Applications\\/WeChat\\.app\\/)),\(ConfigPipeline.appDirectGroupName)"
                )
            ),
            // Everything the engine does not route direct must still reach the
            // protected exit, so a dead tunnel stays fail-closed for it.
            (
                "catch-all-still-protected",
                managedDirectRuntime.contains("MATCH,\(ConfigPipeline.exitGroupName)")
                    && !managedDirectRuntime.contains("MATCH,DIRECT")
            ),
            // The connect-path prime was shortened for latency; the runtime
            // groups must keep the generous steady-state budget so a congested
            // but usable direct path is not flapped onto the proxy.
            (
                "runtime-keeps-steady-state-timeout",
                managedDirectRuntime.contains(
                    "timeout: \(ConfigPipeline.managedDirectHealthTimeoutMilliseconds)"
                )
                    && !managedDirectRuntime.contains(
                        "timeout: \(ConfigPipeline.managedDirectPrimeTimeoutMilliseconds)"
                    )
            ),
            ("no-domain-keyword", !managedDirectRuntime.contains("DOMAIN-KEYWORD")),
            ("no-wide-cidr", !managedDirectRuntime.contains("43.146.27.0/24")),
            ("no-direct-fallback", !managedDirectRuntime.contains("MATCH,DIRECT")),
        ]
        let failedManagedDirectChecks = managedDirectChecks
            .filter { !$0.1 }
            .map(\.0)
        guard failedManagedDirectChecks.isEmpty else {
            throw TestFailure(
                "managed DIRECT runtime failed: "
                    + failedManagedDirectChecks.joined(separator: ",")
            )
        }

        let suffixOnlyPolicy = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [],
            webDomainPins: [],
            webDomainSuffixes: [
                .init(host: "edu.cn", ports: [80, 443]),
                .init(host: "baidu.com", ports: [443]),
            ],
            mediaEndpoints: []
        )
        let validatedSuffixOnlyPolicy = try ConfigPipeline.validatedManagedDirectPolicy(
            suffixOnlyPolicy,
            excluding: Set(sanitizedNodes.map(\.server))
        )
        let suffixRuntime = try ConfigPipeline.buildOwnedTonoRuntime(
            subscriptionYAML: "proxies: []\n",
            overlay: cloudOnlyOverlay,
            transport: nil,
            customNodes: sanitizedNodes,
            directPolicy: suffixOnlyPolicy
        )
        // Suffix routes are rendered now that both original objections are
        // answered: the reviewed-bundle port permit carries a dial with no
        // exact-address PF entry, and the route targets a fallback group so an
        // unreachable China path retreats to the tunnel instead of killing the
        // flow. Two properties still have to hold, and they are what this
        // guards: a suffix must never point at the bare `direct` outbound
        // (that is the no-failover shape), and the answer behind it must come
        // from China DoH or the "direct" hop would cross the Pacific twice.
        let suffixRuleEdu =
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,edu.cn)),"
            + ConfigPipeline.webDirectGroupName
        // A UDP suffix rule emitted after the terminal UDP rejection would be
        // unreachable, which is indistinguishable from not emitting it at all
        // until someone measures a failed QUIC handshake.
        let suffixRuleEduUDP =
            "AND,((NETWORK,UDP),(DST-PORT,443),(DOMAIN-SUFFIX,edu.cn)),"
            + ConfigPipeline.webDirectGroupName
        let udpSuffixPrecedesReject: Bool
        if let ruleRange = suffixRuntime.range(of: suffixRuleEduUDP),
           let rejectRange = suffixRuntime.range(of: "AND,((NETWORK,UDP)),REJECT") {
            udpSuffixPrecedesReject = ruleRange.lowerBound < rejectRange.lowerBound
        } else {
            udpSuffixPrecedesReject = false
        }
        guard validatedSuffixOnlyPolicy?.sessionEndpoints.isEmpty == true,
              validatedSuffixOnlyPolicy?.webDomainSuffixes.count == 2,
              suffixRuntime.contains(suffixRuleEdu),
              udpSuffixPrecedesReject,
              !suffixRuntime.contains(
                  "(DOMAIN-SUFFIX,edu.cn)),\(ConfigPipeline.webDirectProxyName)"
              ),
              suffixRuntime.contains("name: \"\(ConfigPipeline.webDirectGroupName)\""),
              suffixRuntime.contains("    \"+.edu.cn\": ["),
              suffixRuntime.contains("    \"+.baidu.com\": ["),
              suffixRuntime.contains("AND,((NETWORK,UDP)),REJECT"),
              suffixRuntime.contains("MATCH,Tono-Exit"),
              !suffixRuntime.contains("MATCH,DIRECT") else {
            throw TestFailure("v4 suffix policy did not render a failover-backed direct route")
        }
        let claudeProtectedSuffixRuntime = try ConfigPipeline.buildOwnedTonoRuntime(
            subscriptionYAML: "proxies: []\n",
            overlay: claudeSocks5Overlay,
            transport: nil,
            customNodes: sanitizedNodes,
            directPolicy: suffixOnlyPolicy
        )
        let claudeRulesPrecedeChinaSuffix: Bool
        if let eduRange = claudeProtectedSuffixRuntime.range(of: "DOMAIN-SUFFIX,edu.cn") {
            claudeRulesPrecedeChinaSuffix = claudeProtectedRules.allSatisfy { rule in
                guard let claudeRange = claudeProtectedSuffixRuntime.range(of: rule)
                else { return false }
                return claudeRange.lowerBound < eduRange.lowerBound
            }
        } else {
            claudeRulesPrecedeChinaSuffix = false
        }
        // The assistant rules must still precede the global UDP rejection and the
        // terminal MATCH, and must never be rewritten onto a direct target.
        guard claudeProtectedRules.allSatisfy({ rule in
                  guard let claudeRange = claudeProtectedSuffixRuntime.range(of: rule),
                        let matchRange = claudeProtectedSuffixRuntime.range(
                            of: "AND,((NETWORK,UDP)),REJECT"
                        )
                  else { return false }
                  return claudeRange.lowerBound < matchRange.lowerBound
              }),
              // The suffix route now exists, so the property worth protecting
              // is precedence, not absence: an assistant domain must never be
              // captured by a China suffix, and mihomo takes the first match.
              claudeRulesPrecedeChinaSuffix,
              claudeProtectedRules.allSatisfy({ rule in
                  !claudeProtectedSuffixRuntime.contains(rule.replacingOccurrences(
                      of: "Tono-Claude-Home",
                      with: "Tono-China-Direct"
                  )) && !claudeProtectedSuffixRuntime.contains(rule.replacingOccurrences(
                      of: "Tono-Claude-Home",
                      with: "Tono-China-Web-Direct"
                  ))
              }),
              claudeProtectedSuffixRuntime.contains("AND,((NETWORK,UDP)),REJECT"),
              claudeProtectedSuffixRuntime.contains("#Tono-Exit") else {
            throw TestFailure("Claude protection was not preserved with v3 edu.cn suffix routing")
        }
        guard try ConfigPipeline.validatedManagedDirectSuffix("edu.cn") == "edu.cn" else {
            throw TestFailure("edu.cn was not admitted as an exact direct suffix")
        }
        do {
            _ = try ConfigPipeline.validatedManagedDirectSuffix("www.edu.cn")
            throw TestFailure("direct suffix validation accepted a subdomain")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }
        // Live in published policy revision 7. One unrecognised suffix fails the
        // whole policy document, so dropping an entry that published policy still
        // uses takes down every managed-direct route at once — this asserts the
        // direction that actually matters: the client must keep accepting it.
        guard try ConfigPipeline.validatedManagedDirectSuffix("ccxe.com.cn")
                == "ccxe.com.cn" else {
            throw TestFailure("client rejected a suffix that live policy uses")
        }

        // The resolver-host ceiling must admit the control plane's own maxima
        // (32 `domains` + 32 `webDomains`). It used to stop at 48, so a policy
        // that was valid at the boundary made every client discard managed
        // direct routing wholesale.
        let maximumResolverHosts = (0..<32).map { "host-\($0).qq.com" }
            + (0..<32).map { "host-\($0).bilibili.com" }
        guard let wideResolverPolicy = try ConfigPipeline.validatedManagedDirectPolicy(
            .init(
                physicalInterface: "en0",
                domainPins: [],
                mediaEndpoints: [],
                directResolverHosts: maximumResolverHosts
            )
        ), wideResolverPolicy.directResolverHosts.count == 64 else {
            throw TestFailure("resolver hosts rejected the published policy maxima")
        }

        // The residential hop is the one policy-supplied address that had no
        // public-address screening at all.
        for privateHost in ["127.0.0.1", "192.168.1.10", "10.0.0.5", "192.88.99.1"] {
            guard ConfigPipeline.validatedHomeSocks5(
                .init(
                    host: privateHost,
                    port: 11_080,
                    username: "u",
                    password: "p"
                )
            ) == nil else {
                throw TestFailure(
                    "residential hop accepted non-public address \(privateHost)"
                )
            }
        }
        guard ConfigPipeline.validatedHomeSocks5(
            .init(
                host: "residential.example.com",
                port: 11_080,
                username: "u",
                password: "p"
            )
        ) != nil else {
            throw TestFailure("residential hop rejected a valid hostname")
        }
        do {
            _ = try ConfigPipeline.validatedPublicIPv4(
                "192.88.99.1",
                field: "6to4 relay anycast"
            )
            throw TestFailure("public address screening accepted 6to4 relay anycast")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        do {
            _ = try ConfigPipeline.validatedManagedDirectPolicy(
                .init(
                    physicalInterface: "utun199",
                    domainPins: managedDirectPolicy.domainPins,
                    mediaEndpoints: managedDirectPolicy.mediaEndpoints
                )
            )
            throw TestFailure("managed DIRECT accepted a tunnel interface")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }
        do {
            _ = try ConfigPipeline.validatedManagedDirectPolicy(
                .init(
                    physicalInterface: "en0",
                    domainPins: [
                        .init(host: "res.wx.qq.com", addresses: ["1.1.1.1"], ports: [443]),
                    ],
                    mediaEndpoints: []
                )
            )
            throw TestFailure("managed DIRECT accepted a permanently protected address")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }
        do {
            _ = try ConfigPipeline.validatedManagedDirectDomain("*.qq.com")
            throw TestFailure("managed DIRECT accepted a wildcard domain")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }
        do {
            _ = try ConfigPipeline.validatedWebDirectDomain("api.anthropic.com")
            throw TestFailure("web DIRECT accepted a protected domain")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }
        do {
            _ = try ConfigPipeline.validatedManagedDirectPolicy(
                .init(
                    physicalInterface: "en0",
                    domainPins: [
                        .init(host: "v.qq.com", addresses: ["9.9.9.9"], ports: [443]),
                    ],
                    webDomainPins: [
                        .init(host: "v.qq.com", addresses: ["9.9.9.9"], ports: [443]),
                    ],
                    mediaEndpoints: []
                )
            )
            throw TestFailure("web DIRECT accepted a duplicate WeChat domain")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }
        do {
            _ = try ConfigPipeline.validatedManagedDirectPolicy(
                .init(
                    physicalInterface: "en0",
                    domainPins: [],
                    mediaEndpoints: [
                        .init(address: "43.146.27.17", port: 443, transport: "tcp"),
                    ]
                )
            )
            throw TestFailure("managed media DIRECT accepted TCP")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }
        for builtInName in ["DIRECT", "REJECT"] {
            var reservedBuiltInNode = selected
            reservedBuiltInNode.name = builtInName
            do {
                _ = try ConfigPipeline.validatedOwnedNodes([reservedBuiltInNode])
                throw TestFailure(
                    "Mihomo built-in name \(builtInName) was not reserved"
                )
            } catch is ConfigPipeline.TonoInjectionError {
                // Expected.
            }
        }
        var reservedFallbackNode = selected
        reservedFallbackNode.name =
            ConfigPipeline.managedDirectFallbackGroupPrefix + "0123456789abcdef"
        do {
            _ = try ConfigPipeline.validatedOwnedNodes([reservedFallbackNode])
            throw TestFailure("managed DIRECT fallback group prefix was not reserved")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        let generatedCloudURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-cloud-only-\(UUID().uuidString).yaml")
        defer { try? FileManager.default.removeItem(at: generatedCloudURL) }
        let generatedCloudDigest = try ConfigPipeline.generateRuntime(
            subscriptionYAML: "mode: global\nrules:\n  - MATCH,DIRECT\n",
            overlay: cloudOnlyOverlay,
            customNodes: sanitizedNodes,
            outputPath: generatedCloudURL
        )
        let generatedCloud = try String(contentsOf: generatedCloudURL, encoding: .utf8)
        guard !generatedCloudDigest.isEmpty,
              generatedCloud == cloudRuntime else {
            throw TestFailure("nil home descriptor fell through to the legacy YAML path")
        }

        guard let runtimeDirectoryPath = CommandLine.arguments.last else {
            throw TestFailure("missing sanitized runtime directory")
        }
        let runtimeDirectory = URL(
            fileURLWithPath: runtimeDirectoryPath,
            isDirectory: true
        )
        let directoryValues = try runtimeDirectory.resourceValues(
            forKeys: [.isDirectoryKey, .isSymbolicLinkKey]
        )
        guard directoryValues.isDirectory == true,
              directoryValues.isSymbolicLink != true else {
            throw TestFailure("sanitized runtime destination must be a directory")
        }
        let managedDirectRuntimeURL = runtimeDirectory
            .appendingPathComponent("managed-direct.yaml", isDirectory: false)
        try Data(managedDirectRuntime.utf8).write(
            to: managedDirectRuntimeURL,
            options: .atomic
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: managedDirectRuntimeURL.path
        )
        let claudeSocks5RuntimeURL = runtimeDirectory
            .appendingPathComponent("claude-home-socks5.yaml", isDirectory: false)
        try Data(claudeSocks5Runtime.utf8).write(
            to: claudeSocks5RuntimeURL,
            options: .atomic
        )
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: claudeSocks5RuntimeURL.path
        )
        for (index, node) in sanitizedNodes.enumerated() {
            var selectedOverlay = cloudOnlyOverlay
            selectedOverlay.selectedNodeName = node.name
            let selectedRuntime = try ConfigPipeline.buildOwnedTonoRuntime(
                subscriptionYAML: "proxies: []\n",
                overlay: selectedOverlay,
                transport: nil,
                customNodes: sanitizedNodes
            )
            let groupMarker = """
            proxy-groups:
              - name: "\(ConfigPipeline.exitGroupName)"
                type: select
                proxies:
                  - "\(escaped(node.name))"
            """
            guard selectedRuntime.contains(groupMarker),
                  selectedRuntime.contains(stableRouteExclusionBlock),
                  !selectedRuntime.contains(ConfigPipeline.homeNodeName) else {
                throw TestFailure(
                    "\(node.name) selection changed the stable TUN route contract"
                )
            }
            let runtimeURL = runtimeDirectory
                .appendingPathComponent("\(index)-selected.yaml", isDirectory: false)
            try Data(selectedRuntime.utf8).write(to: runtimeURL, options: .atomic)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: runtimeURL.path
            )
        }

        var injected = selected
        injected.name = "safe\nrules:\n  - MATCH,DIRECT"
        do {
            _ = try ConfigPipeline.validatedOwnedNode(injected)
            throw TestFailure("newline node-name injection was accepted")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        var nonVLESS = selected
        nonVLESS.type = .hysteria2
        nonVLESS.password = "test-only-password"
        do {
            _ = try ConfigPipeline.validatedOwnedNode(nonVLESS)
            throw TestFailure("non-VLESS node was accepted")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        var plaintext = selected
        plaintext.tls = false
        do {
            _ = try ConfigPipeline.validatedOwnedNode(plaintext)
            throw TestFailure("plaintext VLESS node was accepted")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        var plainTLS = selected
        plainTLS.realityPublicKey = nil
        plainTLS.realityShortId = nil
        do {
            _ = try ConfigPipeline.validatedOwnedNode(plainTLS)
            throw TestFailure("plain VLESS TLS node was accepted as Reality")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        var invalidRealityKey = selected
        invalidRealityKey.realityPublicKey = "not-a-reality-public-key"
        do {
            _ = try ConfigPipeline.validatedOwnedNode(invalidRealityKey)
            throw TestFailure("invalid Reality public key was accepted")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        var invalidShortID = selected
        invalidShortID.realityShortId = "not-hex"
        do {
            _ = try ConfigPipeline.validatedOwnedNode(invalidShortID)
            throw TestFailure("invalid Reality short ID was accepted")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        var unsupportedTransport = selected
        unsupportedTransport.network = "ws"
        do {
            _ = try ConfigPipeline.validatedOwnedNode(unsupportedTransport)
            throw TestFailure("unaudited VLESS transport was accepted")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        var invalidUUID = selected
        invalidUUID.uuid = "not-a-uuid"
        do {
            _ = try ConfigPipeline.validatedOwnedNode(invalidUUID)
            throw TestFailure("invalid VLESS UUID was accepted")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        var privateEndpoint = selected
        privateEndpoint.server = "192.168.1.10"
        do {
            _ = try ConfigPipeline.validatedOwnedNode(privateEndpoint)
            throw TestFailure("private proxy endpoint was accepted")
        } catch is ConfigPipeline.TonoInjectionError {
            // Expected.
        }

        try verifyPolicySignatureContract()

        print(
            "multi-exit fixture validated and selected individually: " +
            "\(validated.map(\.name).joined(separator: ", "))"
        )
    }

    /// The offline policy signing contract.
    ///
    /// Signing is what lets a new domain reach the fleet without a client
    /// release: the client checks who authored the policy instead of matching its
    /// contents against a compiled-in allowlist. Two things must hold for that to
    /// be safe, and both are asserted here — a document whose signature does not
    /// verify is refused rather than downgraded, and no signature ever lets a
    /// protected host leave the tunnel.
    private static func verifyPolicySignatureContract() throws {
        let json = #"{"version":4,"domains":[],"mediaEndpoints":[],"webDomains":[{"host":"www.dianping.com","ports":[443]}],"directSuffixes":[],"tcpEndpoints":[]}"#
        let signer = Curve25519.Signing.PrivateKey()
        let publicKey = signer.publicKey.rawRepresentation.base64EncodedString()
        let sign = { (message: String) -> String in
            try! signer.signature(for: Data(message.utf8)).base64EncodedString()
        }
        let context = ManagedTrafficPolicySignature.context

        // The context prefix is part of the signed bytes and every implementation
        // must use the same one. A mismatch means signatures verify nowhere, which
        // presents as the whole fleet silently falling back to its allowlist.
        guard context == "tono-traffic-policy-v1\n" else {
            throw TestFailure("policy signature context drifted from the control plane's")
        }

        guard ManagedTrafficPolicySignature.verdict(json: json, signature: nil) == .unsigned,
              ManagedTrafficPolicySignature.verdict(json: json, signature: "") == .unsigned else {
            throw TestFailure("an absent signature must read as unsigned, not as a failure")
        }
        guard ManagedTrafficPolicySignature.verdict(
                json: json,
                signature: sign(context + json),
                publicKeyBase64: publicKey
              ) == .trusted else {
            throw TestFailure("a good signature over the served bytes did not verify")
        }
        // Every way a signature can be wrong reads as untrustworthy, never as
        // unsigned. Downgrading to unsigned would let anyone strip trust by
        // corrupting one field, and the allowlist would then decide.
        let bad: [(String, String?)] = [
            ("signed without the context prefix", sign(json)),
            ("signed over a different document", sign(context + json + " ")),
            ("signed by another key", try Curve25519.Signing.PrivateKey()
                .signature(for: Data((context + json).utf8)).base64EncodedString()),
            ("not base64", "not-a-signature"),
            ("right encoding, wrong length", Data(repeating: 0, count: 32).base64EncodedString()),
        ]
        for (reason, signature) in bad {
            guard ManagedTrafficPolicySignature.verdict(
                    json: json,
                    signature: signature,
                    publicKeyBase64: publicKey
                  ) == .untrustworthy else {
                throw TestFailure("a signature \(reason) was not treated as untrustworthy")
            }
        }

        // The compiled-in production key must be a usable Ed25519 key. A typo here
        // makes every signed policy untrustworthy, and because that path refuses
        // the document, managed direct routing would stop fleet-wide the moment a
        // signed policy is published.
        guard let shipped = Data(base64Encoded: ManagedTrafficPolicySignature.publicKeyBase64),
              shipped.count == 32,
              (try? Curve25519.Signing.PublicKey(rawRepresentation: shipped)) != nil else {
            throw TestFailure("the compiled-in policy signing public key is not a valid Ed25519 key")
        }

        // What a signature buys: a host on no allowlist becomes routable.
        for host in ["www.dianping.com", "static.dianping.com"] {
            guard (try? ConfigPipeline.validatedWebDirectDomain(host)) == nil else {
                throw TestFailure("\(host) is on an allowlist, so it proves nothing about trust")
            }
            guard try ConfigPipeline.validatedWebDirectDomain(host, trusted: true) == host else {
                throw TestFailure("a trusted policy could not carry \(host)")
            }
        }
        guard try ConfigPipeline.validatedManagedDirectSuffix("dianping.com", trusted: true)
                == "dianping.com",
              (try? ConfigPipeline.validatedManagedDirectSuffix("dianping.com")) == nil else {
            throw TestFailure("trust did not open the suffix path, or the allowlist never closed it")
        }

        // What a signature must never buy. If this ever passes, one leaked key
        // exposes this product's own control plane and its users' assistant
        // traffic — strictly worse than the allowlist trust replaces.
        for host in ["api.anthropic.com", "anthropic.com", "claude.ai", "www.claude.ai",
                     "tono.app", "api.tono.app", "tono.com"] {
            for (name, validate) in [
                ("exact WeChat domain", ConfigPipeline.validatedManagedDirectDomain),
                ("web domain", ConfigPipeline.validatedWebDirectDomain),
                ("direct suffix", ConfigPipeline.validatedManagedDirectSuffix),
            ] as [(String, (String, Bool) throws -> String)] {
                guard (try? validate(host, true)) == nil else {
                    throw TestFailure(
                        "a signed policy pulled the protected host \(host) out of the tunnel via \(name)"
                    )
                }
            }
        }

        // Syntax is still enforced under trust: a signature attests to authorship,
        // not to the document being well formed. Before trust existed the
        // allowlist was the only thing rejecting these.
        for malformed in ["*.dianping.com", "dianping", "-dianping.com",
                          "a..b.com", "http://dianping.com", "dianping.com:443",
                          "dian ping.com", "xn--"] {
            guard (try? ConfigPipeline.validatedWebDirectDomain(malformed, trusted: true)) == nil else {
                throw TestFailure("a trusted policy carried the malformed host \(malformed)")
            }
        }
        // A trailing dot is normalised away rather than rejected, so this
        // validator is not what stops it. The processor is: it keeps an entry only
        // when validation returns the host unchanged, which a normalised value
        // never does. Pinned here because removing that comparison would make
        // these entries route under a name the policy did not publish.
        guard try ConfigPipeline.validatedWebDirectDomain("dianping.com.", trusted: true)
                == "dianping.com" else {
            throw TestFailure("a trailing dot is expected to normalise, not to be rejected")
        }

        print("policy signing contract verified: trust opens the allowlist, never the protected list")
    }

    private static func escaped(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}

private struct TestFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
