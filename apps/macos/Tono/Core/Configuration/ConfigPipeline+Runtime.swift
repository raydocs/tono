import Foundation
import CryptoKit
import Darwin
import AppKit
import Security

/// Produces runtime.yaml from subscription YAML + minimal overlay.
/// Follows Verge's principle: subscription config is immutable, overlay only control fields.
extension ConfigPipeline {
    static func pinsWithinSessionEndpointBudget(
        _ pins: [DirectDomainPin],
        seededBy fixed: [DirectEndpoint],
        limit: Int = maximumSessionDirectEndpoints
    ) -> (kept: [DirectDomainPin], dropped: [String]) {
        var accepted = Set(fixed)
        var kept: [DirectDomainPin] = []
        var dropped: [String] = []
        for pin in pins {
            var candidate = accepted
            for address in pin.addresses {
                for port in pin.ports {
                    candidate.insert(
                        DirectEndpoint(
                            address: address,
                            port: port,
                            transport: "tcp"
                        )
                    )
                }
            }
            if candidate.count <= limit {
                accepted = candidate
                kept.append(pin)
            } else {
                dropped.append(pin.host)
            }
        }
        return (kept, dropped)
    }

    /// Finds the product-default cloud exit without depending on one exact
    /// catalog spelling. For example, `US Reality`, `US-VLESS-Reality`, and a
    /// flag-prefixed equivalent all resolve to the US Reality preference.
    static func preferredCloudExit(
        in nodes: [ProxyNode],
        named preferredName: String
    ) -> ProxyNode? {
        let primaries = nodes.filter { !ProxyNode.isHy2CatalogName($0.name) }
        guard !primaries.isEmpty else { return nil }
        let preferredCompact = compactCloudExitName(preferredName)
        if let exact = primaries.first(where: {
            compactCloudExitName($0.name) == preferredCompact
                || compactCloudExitName($0.id) == preferredCompact
        }) {
            return exact
        }

        let preferredWords = cloudExitWords(preferredName)
        let wantsUS = preferredWords.contains("US")
            || (preferredWords.contains("UNITED") && preferredWords.contains("STATES"))
        let wantsJP = preferredWords.contains("JP")
            || preferredWords.contains("JAPAN")
            || preferredWords.contains("JAPANESE")
        let wantsReality = preferredWords.contains("REALITY")
        if wantsUS || wantsJP,
           let regional = primaries.first(where: { node in
               let words = cloudExitWords(node.name)
               let isUS = node.flag == "🇺🇸"
                   || words.contains("US")
                   || (words.contains("UNITED") && words.contains("STATES"))
               let isJP = node.flag == "🇯🇵"
                   || words.contains("JP")
                   || words.contains("JAPAN")
                   || words.contains("JAPANESE")
               let isRequestedRegion = (wantsUS && isUS) || (wantsJP && isJP)
               return isRequestedRegion && (!wantsReality || words.contains("REALITY"))
           }) {
            return regional
        }
        return primaries.first
    }

    static func orderedCloudExits(
        _ nodes: [ProxyNode],
        preferredName: String
    ) -> [ProxyNode] {
        guard let preferred = preferredCloudExit(in: nodes, named: preferredName),
              let index = nodes.firstIndex(where: { $0.id == preferred.id }) else {
            return nodes
        }
        var ordered = nodes
        ordered.remove(at: index)
        ordered.insert(preferred, at: 0)
        return ordered
    }

    static func compactCloudExitName(_ value: String) -> String {
        String(value.uppercased().unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0)
        })
    }

    static func cloudExitWords(_ value: String) -> Set<String> {
        let separated = String(value.uppercased().unicodeScalars.map {
            CharacterSet.alphanumerics.contains($0) ? Character(String($0)) : " "
        })
        return Set(separated.split(whereSeparator: \.isWhitespace).map(String.init))
    }

    /// Default DNS config injected when subscription YAML has no dns: section.
    /// Without this, system DNS is used → DNS pollution → wrong GeoIP → all traffic DIRECT.
    static let defaultDNS = """
    dns:
      enable: true
      listen: \(ProtectedDNSContract.listener)
      enhanced-mode: fake-ip
      fake-ip-range: 198.18.0.1/16
      default-nameserver:
        - 223.5.5.5
        - 119.29.29.29
      proxy-server-nameserver:
        - 223.5.5.5
        - 119.29.29.29
      nameserver:
        - 223.5.5.5
        - 119.29.29.29
      fallback:
        - 1.1.1.1
        - 8.8.8.8
      fallback-filter:
        geoip: true
        geoip-code: CN
    """

    /// Tono resolves through the pinned home route. IP-literal DoH endpoints avoid
    /// a bootstrap DNS query outside Home-US.
    static let tonoDNS = """
    dns:
      enable: true
      listen: \(ProtectedDNSContract.listener)
      enhanced-mode: fake-ip
      fake-ip-range: 198.18.0.1/16
      use-hosts: true
      respect-rules: true
      proxy-server-nameserver:
        - https://1.1.1.1/dns-query#Tono-Exit
        - https://8.8.8.8/dns-query#Tono-Exit
      nameserver:
        - https://1.1.1.1/dns-query#Tono-Exit
        - https://8.8.8.8/dns-query#Tono-Exit
    """

    /// Default TUN config. Every validated catalog endpoint is excluded from
    /// the TUN route so changing the selector never requires rebuilding the
    /// interface. This does not grant direct egress: PF still permits only the
    /// root-owned core to the exact currently selected IP/port.
    static func tunYAML(routeExclusions: [String] = []) -> String {
        var yaml = """
        tun:
          enable: true
          stack: gvisor
          device: \(tonoTunInterface)
          auto-route: true
          auto-detect-interface: true
          strict-route: true
          # Mihomo's gVisor ICMP path bypasses normal MATCH rules and otherwise
          # opens a host-direct ICMP socket. PF blocks it, but disable the path
          # at its source so ping can never attempt physical direct egress.
          disable-icmp-forwarding: true
          dns-hijack:
            - any:53
            - tcp://any:53
        """
        if !routeExclusions.isEmpty {
            yaml += "\n  route-exclude-address:\n"
            for address in routeExclusions {
                yaml += "    - \"\(address)/32\"\n"
            }
            yaml.removeLast()
        }
        return yaml
    }

    /// All proxy server hostnames found in the subscription YAML (for fake-ip-filter)
    static func extractProxyServerHosts(from lines: [String]) -> [String] {
        var hosts: Set<String> = []
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            // Match "server: hostname" in both multi-line and inline formats
            guard let range = trimmed.range(of: "server:") else { continue }
            var value = trimmed[range.upperBound...]
                .trimmingCharacters(in: .whitespaces)
            // Remove trailing comma or brace for inline format
            if let commaIdx = value.firstIndex(of: ",") { value = String(value[..<commaIdx]) }
            if let braceIdx = value.firstIndex(of: "}") { value = String(value[..<braceIdx]) }
            value = value.trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            // Skip IPs and empty values
            if value.isEmpty { continue }
            if value.allSatisfy({ $0.isNumber || $0 == "." || $0 == ":" }) { continue }
            hosts.insert(value)
        }
        return Array(hosts)
    }

    /// All proxy names found in the subscription YAML (for resolving dialer-proxy names)
    static func extractProxyNames(from lines: [String]) -> [String] {
        var names: [String] = []
        var inProxies = false
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed == "proxies:" { inProxies = true; continue }
            if inProxies && !line.isEmpty && !line.hasPrefix(" ") && !line.hasPrefix("\t") && !trimmed.hasPrefix("-") && !trimmed.hasPrefix("#") {
                inProxies = false
            }
            guard inProxies else { continue }
            // Multi-line format: "- name: xxx"
            if trimmed.hasPrefix("- name:") {
                let name = trimmed.replacingOccurrences(of: "- name:", with: "")
                    .trimmingCharacters(in: .whitespaces)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                if !name.isEmpty { names.append(name) }
            }
            // Inline format: "- {name: xxx, ...}"
            if trimmed.hasPrefix("- {") && trimmed.contains("name:") {
                if let nameStart = trimmed.range(of: "name:") {
                    let afterName = trimmed[nameStart.upperBound...].trimmingCharacters(in: .whitespaces)
                    let nameValue = afterName.prefix(while: { $0 != "," && $0 != "}" })
                        .trimmingCharacters(in: .whitespaces)
                        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                    if !nameValue.isEmpty { names.append(String(nameValue)) }
                }
            }
        }
        return names
    }

    /// Generate runtime.yaml from subscription YAML + overlay config + optional custom nodes.
    @discardableResult
    static func generateRuntime(
        subscriptionYAML: String,
        overlay: OverlayConfig,
        customNodes: [ProxyNode] = [],
        directPolicy: ManagedDirectRuntimePolicy? = nil,
        outputPath: URL
    ) throws -> String {
        // Tono mode: never text-delete sections from subscription YAML. Build a fully owned
        // runtime and import only proxy definitions (no rules/dns/tun/proxy-groups from sub).
        if overlay.tonoTransport != nil || overlay.selectedNodeName != homeNodeName {
            let owned = try buildOwnedTonoRuntime(
                subscriptionYAML: subscriptionYAML,
                overlay: overlay,
                transport: overlay.tonoTransport,
                customNodes: customNodes,
                directPolicy: directPolicy
            )
            return try secureWrite(owned, to: outputPath)
        }

        var lines = subscriptionYAML.components(separatedBy: .newlines)

        // Fields we ALWAYS override (control fields only)
        let forceOverrides: [(key: String, value: String)] = [
            ("port", "0"),
            ("socks-port", "0"),
            ("redir-port", "0"),
            ("mixed-port", "\(overlay.mixedPort)"),
            ("external-controller", "'\(overlay.externalController)'"),
            ("secret", "\"\(yamlScalar(overlay.secret))\""),
            ("allow-lan", "\(overlay.allowLan)"),
            ("mode", overlay.mode),
            ("log-level", overlay.logLevel),
        ]

        // Replace existing top-level keys
        var appliedKeys: Set<String> = []
        for i in lines.indices {
            let line = lines[i]
            guard !line.isEmpty, !line.hasPrefix(" "), !line.hasPrefix("\t"), !line.hasPrefix("#") else { continue }
            for (key, value) in forceOverrides {
                if line.hasPrefix("\(key):") {
                    lines[i] = "\(key): \(value)"
                    appliedKeys.insert(key)
                }
            }
        }

        // Prepend any missing override keys
        var header = "# Tono runtime config\n"
        for (key, value) in forceOverrides where !appliedKeys.contains(key) {
            header += "\(key): \(value)\n"
        }

        // DNS handling: use subscription DNS if present, inject defaults if missing.
        let hasDNS = lines.contains { $0.hasPrefix("dns:") && !$0.hasPrefix(" ") }
        if !hasDNS {
            var dnsConfig = defaultDNS
            let proxyHosts = extractProxyServerHosts(from: lines)
            if !proxyHosts.isEmpty {
                let filterEntries = proxyHosts.map { "    - \"+.\($0)\"" }.joined(separator: "\n")
                dnsConfig += "\n  fake-ip-filter:\n" + filterEntries
            }
            header += "\n" + dnsConfig + "\n"
        } else {
            let proxyHosts = extractProxyServerHosts(from: lines)
            var patches: [String] = []
            let dnsContent = lines.joined(separator: "\n")
            if !dnsContent.contains("default-nameserver") {
                patches.append("  default-nameserver:\n    - 223.5.5.5\n    - 119.29.29.29")
            }
            if !dnsContent.contains("proxy-server-nameserver") {
                patches.append("  proxy-server-nameserver:\n    - 223.5.5.5\n    - 119.29.29.29")
            }
            if !dnsContent.contains("fake-ip-filter") && !proxyHosts.isEmpty {
                let filterEntries = proxyHosts.map { "    - \"+.\($0)\"" }.joined(separator: "\n")
                patches.append("  fake-ip-filter:\n" + filterEntries)
            }
            if !patches.isEmpty, let dnsIdx = lines.firstIndex(where: { $0.hasPrefix("dns:") }) {
                lines.insert(patches.joined(separator: "\n"), at: dnsIdx + 1)
            }
        }

        // Add TUN config if enabled and not present
        if overlay.tunEnabled && !lines.contains(where: { $0.hasPrefix("tun:") && !$0.hasPrefix(" ") }) {
            header += "\n" + tunYAML() + "\n"
        }

        // Inject custom nodes into proxies section and first Selector group
        if !customNodes.isEmpty {
            let proxyNames = extractProxyNames(from: lines)
            let insertion = customNodes.map { nodeToYAML($0, knownNames: proxyNames) }.joined()
            if let proxiesIdx = lines.firstIndex(where: { $0.hasPrefix("proxies:") }) {
                lines.insert(insertion, at: proxiesIdx + 1)
            } else {
                lines.append("proxies:")
                lines.append(insertion)
            }

            // Add custom node names to Selector groups so mihomo can select them
            let customNames = customNodes.map { $0.name }
            let nameEntries = customNames.map { "      - \"\($0)\"" }.joined(separator: "\n")
            if let groupsIdx = lines.firstIndex(where: { $0.hasPrefix("proxy-groups:") }) {
                var i = groupsIdx + 1
                var foundTarget = false
                while i < lines.count {
                    let line = lines[i]
                    if !line.isEmpty && !line.hasPrefix(" ") && !line.hasPrefix("\t") && !line.hasPrefix("-") && !line.hasPrefix("#") {
                        break
                    }
                    // Look for "- name: Proxies" or "- name: PROXY" group
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    if trimmed.contains("name:") && (trimmed.contains("Proxies") || trimmed.contains("PROXY")) {
                        foundTarget = true
                    }
                    // Insert after the "proxies:" line of the target group
                    if foundTarget && trimmed == "proxies:" {
                        lines.insert(nameEntries, at: i + 1)
                        break
                    }
                    i += 1
                }
            }
        }

        let finalYAML = header + "\n" + lines.joined(separator: "\n")
        return try secureWrite(finalYAML, to: outputPath)
    }

    enum TonoInjectionError: LocalizedError {
        case unsafeDescriptor, unsafeOverlay, unsafeNode(String), duplicateNode(String), missingSelection
        var errorDescription: String? {
            switch self {
            case .unsafeDescriptor: return "Tono descriptor must use loopback and a non-zero port."
            case .unsafeOverlay: return "Tono runtime control settings are invalid."
            case .unsafeNode(let name): return "Proxy node \(name) contains unsupported or unsafe fields."
            case .duplicateNode(let name): return "Proxy node name \(name) is duplicated or reserved."
            case .missingSelection: return "The selected proxy node is unavailable."
            }
        }
    }

    /// Fully owned Tono runtime. Imported YAML is never copied into the runtime.
    /// Only validated ProxyNode fields are re-serialized below.
    static func buildOwnedTonoRuntime(
        subscriptionYAML: String,
        overlay: OverlayConfig,
        transport: TonoTransportDescriptor?,
        customNodes: [ProxyNode],
        directPolicy: ManagedDirectRuntimePolicy? = nil
    ) throws -> String {
        if let transport {
            guard transport.host == "127.0.0.1", transport.port != 0 else {
                throw TonoInjectionError.unsafeDescriptor
            }
        }
        let controllerParts = overlay.externalController.split(separator: ":", omittingEmptySubsequences: false)
        guard overlay.mixedPort > 0, overlay.mixedPort <= 65_535,
              controllerParts.count == 2, controllerParts[0] == "127.0.0.1",
              let controllerPort = Int(controllerParts[1]), controllerPort > 0, controllerPort <= 65_535,
              ["debug", "info", "warning", "error", "silent"].contains(overlay.logLevel)
        else {
            throw TonoInjectionError.unsafeOverlay
        }
        _ = subscriptionYAML

        let nodes = try validatedOwnedNodes(customNodes)
        let directPolicy = try validatedManagedDirectPolicy(
            directPolicy,
            excluding: Set(nodes.map(\.server))
        )
        let selected = overlay.selectedNodeName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (selected == homeNodeName && transport != nil) ||
                nodes.contains(where: { $0.name == selected }) else {
            throw TonoInjectionError.missingSelection
        }
        let claudeHomeSocks5 = validatedHomeSocks5(overlay.claudeHomeSocks5)
        let claudeHome = admittedResidentialTerminal(
            overlay: overlay,
            validatedOwnedNodes: nodes
        )
        guard overlay.claudeHomeSocks5 == nil || claudeHomeSocks5 != nil,
              claudeHomeSocks5 != nil || overlay.claudeHomeNodeName == nil || claudeHome != nil
        else {
            // Never turn an explicitly required but unusable home identity
            // into a successfully generated cloud-only configuration.
            throw TonoInjectionError.unsafeOverlay
        }
        let preferredDefault = overlay.defaultNodeName
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .flatMap { name in
                nodes.contains(where: { $0.name == name }) ? name : nil
            }

        var proxyBlock = "proxies:\n"
        if let transport {
            proxyBlock += "  - name: \"\(homeNodeName)\"\n    type: socks5\n    server: 127.0.0.1\n    port: \(transport.port)\n    udp: \(transport.udp)\n"
            if let username = transport.username {
                proxyBlock += "    username: \"\(yamlScalar(username))\"\n"
            }
            if let password = transport.password {
                proxyBlock += "    password: \"\(yamlScalar(password))\"\n"
            }
        }
        for node in nodes {
            proxyBlock += try ownedNodeYAML(node)
        }
        if let claudeHomeSocks5 {
            proxyBlock += """
              - name: "\(homeResidentialProxyName)"
                type: socks5
                server: "\(yamlScalar(claudeHomeSocks5.host))"
                port: \(claudeHomeSocks5.port)
                username: "\(yamlScalar(claudeHomeSocks5.username))"
                password: "\(yamlScalar(claudeHomeSocks5.password))"
                dialer-proxy: "\(exitGroupName)"
                udp: false

            """
        }
        if let directPolicy,
           !directPolicy.domainPins.isEmpty
            || !directPolicy.mediaEndpoints.isEmpty
            || !directPolicy.tcpEndpoints.isEmpty
            || !directPolicy.directResolverHosts.isEmpty
            // Suffix routes resolve through this outbound too, so a
            // suffix-only policy must still define it or `nameserver-policy`
            // would reference a proxy that does not exist.
            || !directPolicy.effectiveWebDomainSuffixes.isEmpty {
            proxyBlock += """
              - name: "\(directProxyName)"
                type: direct
                interface-name: "\(yamlScalar(directPolicy.physicalInterface))"
                ip-version: ipv4-only

            """
        }
        // Referenced by both exact web pins and suffix routes now that the
        // reviewed-bundle port permit lets a root-originated direct dial leave
        // without an exact-address PF entry.
        if let directPolicy,
           !directPolicy.webDomainPins.isEmpty
            || !directPolicy.effectiveWebDomainSuffixes.isEmpty {
            proxyBlock += """
              - name: "\(webDirectProxyName)"
                type: direct
                interface-name: "\(yamlScalar(directPolicy.physicalInterface))"
                ip-version: ipv4-only

            """
        }

        var choices = (transport == nil ? [] : [homeNodeName]) + nodes.map(\.name)
        if let index = choices.firstIndex(of: selected) {
            choices.remove(at: index)
            choices.insert(selected, at: 0)
        }
        if let preferredDefault, preferredDefault != selected,
           let index = choices.firstIndex(of: preferredDefault) {
            choices.remove(at: index)
            choices.insert(preferredDefault, at: min(1, choices.count))
        }
        let choiceLines = choices.map { "      - \"\(yamlScalar($0))\"" }
            .joined(separator: "\n")

        // IPv6 is a second data plane (TUN, fake-ip6, PF inet6). Leave it
        // off: AAAA dials fail-close at PF and the client retries IPv4.
        var yaml = """
        # Tono owned runtime — imported YAML is parsed, validated, and re-serialized
        port: 0
        socks-port: 0
        redir-port: 0
        mixed-port: \(overlay.mixedPort)
        external-controller: '\(overlay.externalController)'
        secret: "\(yamlScalar(overlay.secret))"
        allow-lan: false
        ipv6: false
        udp: true
        mode: rule
        log-level: \(overlay.logLevel)
        # Warm-path RTT for UI delay. Connect uses the TUN probe, not /delay.
        unified-delay: true
        find-process-mode: \(directPolicy != nil || overlay.tonoTransport != nil || overlay.claudeHomeSocks5 != nil || overlay.claudeHomeNodeName != nil ? "strict" : "off")
        profile:
          # Runtime config order is the committed selection. Never let a stale
          # cache.db choice override it after a protected config reload.
          store-selected: false

        """
        if let directPolicy,
           !directPolicy.domainPins.isEmpty
            || !directPolicy.webDomainPins.isEmpty {
            yaml += "hosts:\n"
            for pin in (directPolicy.domainPins + directPolicy.webDomainPins)
                .sorted(by: { $0.host < $1.host }) {
                yaml += "  \"\(yamlScalar(pin.host))\":\n"
                for address in pin.addresses {
                    yaml += "    - \"\(address)\"\n"
                }
            }
            yaml += "\n"
        }
        yaml += tonoDNS + "\n"
        // Emitted on the same condition as the bundle group itself, so the
        // routing decision and the resolver behind it can never disagree.
        let wechatResolverKeys =
            directPolicy != nil && !managedDirectProcessPathRegexes.isEmpty
                ? wechatDirectDNSSuffixes.flatMap { [$0, "+.\($0)"] }
                : []
        if let directPolicy,
           !directPolicy.directResolverHosts.isEmpty
            || !directPolicy.effectiveWebDomainSuffixes.isEmpty
            || !wechatResolverKeys.isEmpty {
            // Managed-direct hostnames resolve via China DoH through the
            // interface-bound direct outbound so /dns/query returns
            // region-correct answers for pinning. Client-facing answers for
            // already-pinned hosts still come from hosts: (use-hosts wins).
            let upstreams = managedDirectResolverURLs
                .map { "\"\($0)#\(directProxyName)\"" }
                .joined(separator: ", ")
            yaml += "  nameserver-policy:\n"
            var policyKeys: [String] = directPolicy.directResolverHosts
                + wechatResolverKeys
            // A suffix route is only as good as the answer behind it. Resolved
            // through the exit, a China CDN hands back the node nearest the
            // exit, so the "direct" hop would then cross the Pacific twice.
            // These wildcards keep the whole matched subtree resolving through
            // China DoH over the interface-bound direct outbound, which is the
            // same mechanism that kept pinned answers region-correct — and it
            // never needed the pin to work.
            for suffix in directPolicy.effectiveWebDomainSuffixes {
                policyKeys.append(suffix.host)
                policyKeys.append("+.\(suffix.host)")
            }
            for host in Set(policyKeys).sorted() {
                yaml += "    \"\(yamlScalar(host))\": [\(upstreams)]\n"
            }
        }
        if let directPolicy,
           !directPolicy.domainPins.isEmpty
            || !directPolicy.webDomainPins.isEmpty {
            // WeChat's HTTPDNS hands its helpers raw CDN IPs; without a Host
            // those flows can never match the pinned DOMAIN rules and fall to
            // the exit. Sniff TLS on 443 and override the destination ONLY
            // for the reviewed pinned hosts (force-domain with global
            // override off), which re-routes exactly those dials through the
            // hosts:/PF-bounded pins while every other flow keeps its
            // original metadata and routing.
            yaml += "\nsniffer:\n"
            yaml += "  enable: true\n"
            yaml += "  parse-pure-ip: true\n"
            yaml += "  override-destination: false\n"
            yaml += "  sniff:\n"
            yaml += "    TLS:\n"
            yaml += "      ports: [443]\n"
            yaml += "  force-domain:\n"
            for pin in (directPolicy.domainPins + directPolicy.webDomainPins)
                .sorted(by: { $0.host < $1.host }) {
                yaml += "    - \"\(yamlScalar(pin.host))\"\n"
            }
        }
        if overlay.tunEnabled {
            // Keep the route fingerprint independent of the selected proxy.
            // A selector-only switch can then preserve gVisor/TUN state while
            // PF remains the authoritative, exact endpoint boundary.
            let routeExclusions = Array(Set(nodes.map(\.server))).sorted()
            yaml += "\n" + tunYAML(routeExclusions: routeExclusions) + "\n"
        }
        yaml += "\n" + proxyBlock + "\n"
        yaml += """
        proxy-groups:
          - name: "\(exitGroupName)"
            type: select
            proxies:
        \(choiceLines)

        """
        // The residential hop is an egress-identity requirement, not an
        // availability preference. A fallback to Tono-Exit would keep the
        // request inside TUN but silently change the public IP from the home
        // broadband address to the datacenter address. Keep this group to one
        // member so a home-path failure is visible as an assistant failure,
        // never as a successful request with the wrong egress identity.
        if claudeHomeSocks5 != nil {
            yaml += """
              - name: "\(claudeHomeGroupName)"
                type: select
                proxies:
                  - "\(homeResidentialProxyName)"

            """
        } else if let claudeHome {
            yaml += """
              - name: "\(claudeHomeGroupName)"
                type: select
                proxies:
                  - "\(yamlScalar(claudeHome))"

            """
        }
        if let directPolicy,
           directPolicy.nativeAppDirect,
           !managedDirectProcessPathRegexes.isEmpty {
            yaml += """
              - name: "\(appDirectGroupName)"
                type: fallback
                proxies:
                  - "\(directProxyName)"
                  - "\(exitGroupName)"
                url: "\(chinaDirectHealthURL)"
                interval: \(managedDirectHealthIntervalSeconds)
                timeout: \(managedDirectHealthTimeoutMilliseconds)
                lazy: false

            """
        }
        if let directPolicy,
           !directPolicy.webDomainPins.isEmpty
            || !directPolicy.effectiveWebDomainSuffixes.isEmpty {
            yaml += """
              - name: "\(webDirectGroupName)"
                type: fallback
                proxies:
                  - "\(webDirectProxyName)"
                  - "\(exitGroupName)"
                url: "\(chinaDirectHealthURL)"
                interval: \(managedDirectHealthIntervalSeconds)
                timeout: \(managedDirectHealthTimeoutMilliseconds)
                lazy: false

            """
        }
        yaml += "\nrules:\n"
        // Claude App/Code are permanently protected before every trial
        // exception. The native reviewed-app rules below additionally require
        // an executable inside one of the reviewed WeChat/DingTalk/Feishu
        // bundle paths; the
        // separate web rules remain bounded to an exact reviewed hostname and
        // TCP/443. Native WeChat rules emit DOMAIN and separate IP-literal
        // variants, never an impossible DOMAIN+IP-CIDR conjunction. The
        // pinned addresses still bound egress via the hosts: entries
        // (use-hosts resolves the direct dial to exactly those IPs) and the
        // PF session allowlist.
        let hasResidentialHop = claudeHome != nil || claudeHomeSocks5 != nil
        let assistantTarget = hasResidentialHop ? claudeHomeGroupName : exitGroupName
        // Domain rules exist only to divert assistant traffic onto the
        // residential hop. Without that hop they would be pure noise — MATCH
        // already sends these to the protected exit — and emitting them anyway
        // would put DOMAIN-SUFFIX into a runtime whose direct exceptions are
        // deliberately exact-host only.
        if hasResidentialHop {
            for suffix in Self.assistantHomeDomainSuffixes {
                yaml += "  - AND,((NETWORK,TCP),(DOMAIN-SUFFIX,\(suffix))),\(assistantTarget)\n"
            }
            for cidr in Self.assistantHomeIPv4Cidrs {
                yaml += "  - AND,((NETWORK,TCP),(IP-CIDR,\(cidr),no-resolve)),\(assistantTarget)\n"
            }
        }
        // Process rules are a fallback after hostname identity. In particular,
        // npm and bun run Claude Code as node/node.exe; a process-wide Node rule
        // would capture unrelated development traffic.
        for process in Self.assistantHomeProcessNames {
            yaml += "  - AND,((NETWORK,TCP),(PROCESS-NAME,\(process))),\(assistantTarget)\n"
        }
        for pathRegex in Self.assistantHomeProcessPathRegexes {
            // Commas and parentheses would break out of the AND payload.
            precondition(
                !pathRegex.contains(",") && !pathRegex.contains("(")
                    && !pathRegex.contains(")"),
                "assistant process path regex unsafe for rule emission"
            )
            yaml += "  - AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,\(pathRegex))),\(assistantTarget)\n"
        }
        if transport != nil {
            yaml += "  - PROCESS-NAME,tailscaled,DIRECT\n"
            yaml += "  - PROCESS-NAME,tailscale,DIRECT\n"
        }
        if let directPolicy, directPolicy.nativeAppDirect {
            // WeChat resolves its message channel through its own HTTPDNS and
            // dials raw addresses, so the pinned DOMAIN rules below can only
            // ever match its CDN traffic: 84% of observed dials carried no
            // hostname at all, across six different /16 ranges that Tencent
            // rotates. Enumerating addresses cannot converge on that, and every
            // attempt to keep the enumeration fresh reloads the runtime and
            // severs unrelated long-lived connections. Route the whole reviewed
            // bundle direct instead and let the pins below stay as a redundant
            // narrower match. Everything else still reaches `MATCH,Tono-Exit`,
            // so this changes what WeChat does, not what anything else does.
            // Sampled once: the property queries Launch Services, and two
            // loops reading it separately could emit a ruleset that permits a
            // bundle in one direction and not the other if an install landed
            // between them.
            let bundlePathRegexes = managedDirectProcessPathRegexes
            for processPathRegex in bundlePathRegexes {
                // TCP/80 used to be sent to the protected exit here, because
                // five measured direct dials returned no bytes. That
                // measurement was taken on this project's own Mac, whose direct
                // path is a US ISP — a path no customer has. On a customer in
                // China the same rule sends WeChat's main channel on a
                // transpacific round trip, and two audit logs from one such
                // customer show what that costs: 320 of 388 and 217 of 300
                // WeChat connections left through the exit, all of them TCP/80,
                // while the destinations were China Telecom and China Mobile
                // access points (112.65.193.0/24, 221.181.99.0/24,
                // 101.91.37.0/24, 122.188.0.0/16) being reached via Los
                // Angeles. One address was re-dialled 88 times with 63% of the
                // gaps at or under three seconds, 28 of them in the first
                // minute after connecting — the same spinning the rule was
                // written to stop, now caused by it.
                //
                // The original evidence also no longer reproduces on the
                // machine it came from: a TCP/80 dial to the four hottest of
                // those destinations returns 101, 45, 289 and 45 bytes on the
                // direct path, matching the exit path byte for byte. Windows
                // never had this exception — `WECHAT_PROCESS_NAMES` routes the
                // whole bundle direct — so macOS was the outlier.
                //
                // TCP/80 now joins the bundle-wide rule below, which is
                // direct-first with the exit as a fallback member. Accepted
                // limitation, unchanged from before: that group's probe is a
                // cheap HTTP/80 request, so a destination-specific hang keeps
                // the group on direct instead of failing over. If the original
                // symptom returns it will show in the audit log as repeated
                // WeChat :80 dials on `Tono-China-Direct`, and the fix then is a
                // probe that shares the failure mode — not a blanket detour.
                yaml += "  - AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,\(processPathRegex))),\(appDirectGroupName)\n"
                yaml += "  - AND,((NETWORK,UDP),(PROCESS-PATH-REGEX,\(processPathRegex))),\(appDirectGroupName)\n"
            }
        }
        if let directPolicy {
            // The exact host/port pins that used to live here are gone. Every
            // one of them carried the same PROCESS-PATH-REGEX as the
            // bundle-wide rule emitted above plus a narrower port, domain or
            // address, and mihomo takes the first matching rule — so no pin
            // could ever fire. They were kept anyway as "a redundant narrower
            // match". Each pin also built its own `fallback` group with
            // `lazy: false`, so at the time they were reachable a Mac
            // health-probed one URL per pinned host/port every interval for
            // rules that could not match, and primed every one of them inside
            // the connect transaction.
            //
            // That cost was already gone before this deletion: 189acf6 stopped
            // carrying `domainPins`, `mediaEndpoints` and `tcpEndpoints` into
            // the runtime policy, so the loops below had nothing to iterate and
            // `managedDirectFallbackTargets` returned empty. What is removed
            // here is the machinery, not the cost — code that could only ever
            // run again by accident.
            //
            // The pinned addresses are still load-bearing, just not as rules:
            // they populate `hosts:` so use-hosts resolves the direct dial to
            // exactly those IPs, and they become `sessionEndpoints` for the PF
            // allowlist. What is gone is a second copy of a routing decision
            // the bundle-wide rule already makes.
            // Browser video acceleration is intentionally narrower than a
            // China/GEOIP bypass: an exact cloud-reviewed host, TCP/443, and
            // no suffix or process fallback. The pinned IPv4 answers still
            // constrain the dial through hosts: and the PF session allowlist.
            // Claude's own process-name rules above still win first.
            for pin in directPolicy.webDomainPins {
                for port in pin.ports {
                    yaml += "  - AND,((NETWORK,TCP),(DST-PORT,\(port)),(DOMAIN,\(pin.host))),\(webDirectGroupName)\n"
                }
            }
            // Suffix routes were withheld for two reasons, and both have been
            // answered rather than waived.
            //
            // The first was PF: a suffix route carries no resolved addresses,
            // so it produced no `sessionEndpoints` and no exact-address permit,
            // and `block drop out quick all` discarded every dial it sent to
            // the interface-bound direct outbound. That is no longer how the
            // ruleset works. The reviewed native-app permit passes root-originated
            // direct dials on the ports this policy uses, which is why WeChat's
            // HTTPDNS addresses — never pinned, never PF-listed — moved 1.6 MB,
            // 1.3 MB and 1.1 MB directly in a single measured session.
            //
            // The second was failover: a bare `direct` outbound cannot retreat
            // to the tunnel, so an unreachable China path killed the flow. The
            // route now targets a fallback group, which is a class-level answer
            // to a class-level question ("can this machine reach China at all")
            // rather than the per-destination scoring mihomo does not offer.
            //
            // What this does change is the managed-direct invariant: a suffix
            // is a wildcard exception, so every subdomain of a listed host now
            // takes the direct path. That is the point — enumerating exact
            // hosts is what forced the pin refresh whose config reload severed
            // every long-lived connection — but it widens the direct surface,
            // and `MATCH,Tono-Exit` remains the only thing behind it.
            for suffix in directPolicy.effectiveWebDomainSuffixes {
                for port in suffix.ports {
                    yaml += "  - AND,((NETWORK,TCP),(DST-PORT,\(port)),(DOMAIN-SUFFIX,\(suffix.host))),\(webDirectGroupName)\n"
                    // Without this the browser's QUIC attempt reaches the
                    // global UDP rejection, and every one of these sites pays a
                    // failed handshake before falling back to TCP. The port set
                    // is the same one the TCP route already uses and the same
                    // one the PF permit covers, so this widens the protocol,
                    // not the destination — and the terminal UDP rejection
                    // still stands for everything not listed here.
                    yaml += "  - AND,((NETWORK,UDP),(DST-PORT,\(port)),(DOMAIN-SUFFIX,\(suffix.host))),\(webDirectGroupName)\n"
                }
            }
        }
        yaml += "  - AND,((NETWORK,UDP)),REJECT\n"
        yaml += """
          - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
          - IP-CIDR6,::1/128,DIRECT,no-resolve
          - MATCH,\(exitGroupName)
        """
        return yaml
    }

}
