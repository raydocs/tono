import Foundation
import CryptoKit

nonisolated extension ConfigPipeline {
    /// Product inputs have already passed account/catalog/policy ownership and
    /// freshness admission. Revalidate transport/route fields here; this value
    /// is not a Started or Connected receipt.
    struct OwnedSingBoxRuntime: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
        let runtimeJSON: Data
        let runtimeSHA256: String
        let dialEndpoints: [DialEndpoint]
        let directEndpoints: [DirectEndpoint]
        let unavailableNodes: [String: String]
        var description: String { "sing-box runtime sha256=\(runtimeSHA256) unavailable=\(unavailableNodes.count)" }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
    }

    static func singBoxUnavailableReason(_ node: ProxyNode) -> String? {
        if node.type == .hysteria2, node.tlsFingerprint != nil {
            return "TONO_SINGBOX_HY2_DER_PIN_UNSUPPORTED"
        }
        if node.type != .vless && node.type != .hysteria2 {
            return "TONO_SINGBOX_UNSUPPORTED_TRANSPORT"
        }
        return nil
    }

    static func buildSingBoxRuntime(
        overlay: OverlayConfig,
        nodes inputNodes: [ProxyNode],
        directPlan: ManagedDirectRuntimePolicy?,
        requiredCapabilities: [String] = []
    ) throws -> OwnedSingBoxRuntime {
        let known: Set<String> = ["reality-tcp", "hy2", "direct", "home", "dns-proxied", "tun", "clash-api"]
        guard Set(requiredCapabilities).isSubset(of: known) else { throw SingBoxError.unsupportedPolicy }
        let control = overlay.externalController.split(separator: ":")
        let base64Secret = Data(base64Encoded: overlay.secret)?.count == 32
        let hexSecret = overlay.secret.count == 64 && overlay.secret.allSatisfy { $0.isHexDigit }
        guard overlay.tunEnabled, !overlay.allowLan, overlay.mode == "rule",
              control.count == 2, control[0] == "127.0.0.1",
              let controllerPort = Int(control[1]), (1024...65535).contains(controllerPort),
              (1024...65535).contains(overlay.mixedPort), controllerPort != overlay.mixedPort,
              base64Secret || hexSecret else { throw SingBoxError.invalidControl }
        let nodes = try validatedOwnedNodes(inputNodes)
        let plan = try validatedManagedDirectPolicy(directPlan, excluding: Set(nodes.map(\.server)))
        let reserved: Set<String> = ["Tono-TUN", "Tono-DNS", "Tono-Mixed", "Tono-FakeIP", "Tono-DoH", "Tono-Hosts", "Tono-China-DNS"]
        guard nodes.allSatisfy({ !reserved.contains($0.name) }) else { throw SingBoxError.invalidNode }
        let unavailable = Dictionary(uniqueKeysWithValues: nodes.compactMap { node in
            singBoxUnavailableReason(node).map { (node.name, $0) }
        })
        let usable = nodes.filter { unavailable[$0.name] == nil }
        let selected = overlay.selectedNodeName
        if unavailable[selected] != nil { throw SingBoxError.unsupportedTransport }
        if requiredCapabilities.contains("hy2"), !usable.contains(where: { $0.type == .hysteria2 }) {
            throw SingBoxError.unsupportedTransport
        }
        let transport = overlay.tonoTransport
        if let transport {
            guard transport.host == "127.0.0.1", transport.port != 0 else { throw SingBoxError.unsupportedHomeRoute }
        }
        guard usable.contains(where: { $0.name == selected }) || (selected == homeNodeName && transport != nil) else {
            throw SingBoxError.invalidNode
        }
        let homeSocks = validatedHomeSocks5(overlay.claudeHomeSocks5)
        let home = admittedResidentialTerminal(overlay: overlay, validatedOwnedNodes: usable)
        guard overlay.claudeHomeSocks5 == nil || homeSocks != nil,
              homeSocks != nil || overlay.claudeHomeNodeName == nil || home != nil else {
            throw SingBoxError.unsupportedHomeRoute
        }
        if requiredCapabilities.contains("home"), home == nil, transport == nil { throw SingBoxError.unsupportedHomeRoute }
        if requiredCapabilities.contains("direct"), plan == nil { throw SingBoxError.unsupportedPolicy }

        var outbounds: [[String: Any]] = try usable.map { node in
            switch node.type {
            case .vless:
                guard let uuid = node.uuid, let sni = node.sni,
                      let key = node.realityPublicKey, let shortID = node.realityShortId else {
                    throw SingBoxError.unsupportedTransport
                }
                let fingerprint = node.clientFingerprint ?? "chrome"
                guard ["chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized"].contains(fingerprint) else {
                    throw SingBoxError.unsupportedFingerprint
                }
                var outbound: [String: Any] = [
                    "type": "vless", "tag": node.name, "server": node.server, "server_port": node.port,
                    "uuid": uuid, "tls": ["enabled": true, "server_name": sni,
                        "utls": ["enabled": true, "fingerprint": fingerprint],
                        "reality": ["enabled": true, "public_key": key, "short_id": shortID]],
                ]
                if let flow = node.flow { outbound["flow"] = flow }
                return outbound
            case .hysteria2:
                guard let password = node.password, !password.isEmpty else {
                    throw SingBoxError.unsupportedTransport
                }
                let serverName = node.sni ?? node.server
                let outbound: [String: Any] = [
                    "type": "hysteria2",
                    "tag": node.name,
                    "server": node.server,
                    "server_port": node.port,
                    "password": password,
                    "tls": [
                        "enabled": true,
                        "server_name": serverName,
                    ],
                ]
                return outbound
            default:
                throw SingBoxError.unsupportedTransport
            }
        }
        if let transport {
            var outbound: [String: Any] = ["type": "socks", "tag": homeNodeName,
                "server": "127.0.0.1", "server_port": transport.port, "version": "5", "network": "tcp"]
            if let username = transport.username { outbound["username"] = username }
            if let password = transport.password { outbound["password"] = password }
            outbounds.append(outbound)
        }
        let choices = (transport == nil ? [] : [homeNodeName]) + usable.map(\.name)
        outbounds.append(["type": "selector", "tag": exitGroupName, "default": selected,
                          "outbounds": [selected] + choices.filter { $0 != selected }, "interrupt_exist_connections": true])
        outbounds.append(["type": "direct", "tag": "DIRECT"])
        if let homeSocks {
            outbounds.append(["type": "socks", "tag": homeResidentialProxyName, "version": "5",
                              "server": homeSocks.host, "server_port": homeSocks.port,
                              "username": homeSocks.username, "password": homeSocks.password,
                              "network": "tcp", "detour": exitGroupName])
        }
        if let home {
            outbounds.append(["type": "selector", "tag": claudeHomeGroupName, "outbounds": [home], "default": home])
        }
        if let plan {
            // No automatic direct-to-exit fallback or request replay.
            for tag in [directProxyName, webDirectProxyName] {
                outbounds.append(["type": "direct", "tag": tag, "bind_interface": plan.physicalInterface,
                    "domain_resolver": ["server": "Tono-China-DNS", "strategy": "ipv4_only"]])
            }
            outbounds.append(["type": "selector", "tag": appDirectGroupName, "outbounds": [directProxyName], "default": directProxyName])
            outbounds.append(["type": "selector", "tag": webDirectGroupName, "outbounds": [webDirectProxyName], "default": webDirectProxyName])
        }
        var dnsServers: [[String: Any]] = [
            ["type": "fakeip", "tag": "Tono-FakeIP", "inet4_range": "198.19.0.0/16"],
            ["type": "https", "tag": "Tono-DoH", "server": "1.1.1.1", "server_port": 443,
             "path": "/dns-query", "tls": ["enabled": true, "server_name": "1.1.1.1"], "detour": exitGroupName],
        ]
        var dnsRules: [[String: Any]] = [["query_type": ["AAAA"], "action": "predefined", "rcode": "NOERROR"]]
        var rules: [[String: Any]] = [
            ["inbound": ["Tono-DNS"], "action": "hijack-dns"],
            ["port": [53], "action": "hijack-dns"],
        ]
        let assistant = home == nil ? exitGroupName : claudeHomeGroupName
        if home != nil {
            rules.append(["network": "tcp", "domain_suffix": assistantHomeDomainSuffixes, "action": "route", "outbound": assistant])
            rules.append(["network": "tcp", "ip_cidr": assistantHomeIPv4Cidrs, "action": "route", "outbound": assistant])
        }
        rules.append(["network": "tcp", "process_name": assistantHomeProcessNames, "action": "route", "outbound": assistant])
        rules.append(["network": "tcp", "process_path_regex": assistantHomeProcessPathRegexes, "action": "route", "outbound": assistant])
        if let plan {
            var hosts: [String: [String]] = [:]
            for pin in plan.domainPins + plan.webDomainPins { hosts[pin.host] = pin.addresses }
            if !hosts.isEmpty {
                dnsServers.append(["type": "hosts", "tag": "Tono-Hosts", "predefined": hosts])
                dnsRules.append(["inbound": ["Tono-DNS", "Tono-TUN", "Tono-Mixed"],
                    "domain": hosts.keys.sorted(), "action": "route", "server": "Tono-Hosts"])
            }
            dnsServers.append(["type": "https", "tag": "Tono-China-DNS", "server": "223.5.5.5", "server_port": 443,
                "path": "/dns-query", "tls": ["enabled": true, "server_name": "223.5.5.5"], "detour": directProxyName])
            if !plan.directResolverHosts.isEmpty {
                dnsRules.append(["domain": plan.directResolverHosts, "action": "route", "server": "Tono-China-DNS"])
            }
            let suffixes = plan.effectiveWebDomainSuffixes
            // Sampled once. Empty when no reviewed bundle passes its signature
            // check; an empty process_path_regex would match every process.
            let appRegexes = plan.nativeAppDirect ? managedDirectProcessPathRegexes : []
            let resolverSuffixes = Array(Set(suffixes.map(\.host) + (appRegexes.isEmpty ? [] : wechatDirectDNSSuffixes))).sorted()
            if !resolverSuffixes.isEmpty {
                dnsRules.append(["domain_suffix": resolverSuffixes, "action": "route", "server": "Tono-China-DNS"])
            }
            if !appRegexes.isEmpty {
                // These are the helper's existing reviewed-bundle ports.
                // Exact policy tuples below can authorize additional ports.
                rules.append(["process_path_regex": appRegexes,
                    "network": ["tcp", "udp"], "port": [80, 443, 8000, 8080], "action": "route", "outbound": appDirectGroupName])
                for endpoint in plan.sessionEndpoints {
                    rules.append(["process_path_regex": appRegexes,
                        "ip_cidr": ["\(endpoint.address)/32"], "network": endpoint.transport,
                        "port": [Int(endpoint.port)], "action": "route", "outbound": appDirectGroupName])
                }
                rules.append(["process_path_regex": appRegexes, "action": "reject"])
            }
            for pin in plan.webDomainPins {
                rules.append(["domain": [pin.host], "action": "resolve", "server": "Tono-Hosts", "strategy": "ipv4_only"])
                rules.append(["type": "logical", "mode": "and", "rules": [
                    ["domain": [pin.host]], ["ip_cidr": pin.addresses.map { "\($0)/32" }],
                    ["network": "tcp", "port": pin.ports.map(Int.init)]
                ], "action": "route", "outbound": webDirectGroupName])
            }
            for suffix in suffixes {
                rules.append(["domain_suffix": [suffix.host], "port": suffix.ports.map(Int.init),
                    "network": ["tcp", "udp"], "action": "route", "outbound": webDirectGroupName])
            }
        }
        // Controller /dns/query and outbound resolution need real answers.
        // Only packets arriving from the protected client listeners get fake IP.
        dnsRules.append(["inbound": ["Tono-DNS", "Tono-TUN", "Tono-Mixed"], "query_type": ["A"], "action": "route", "server": "Tono-FakeIP"])
        rules.append(["ip_cidr": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "224.0.0.0/4", "255.255.255.255/32", "fe80::/10", "fc00::/7", "ff00::/8", "127.0.0.0/8", "::1/128"], "action": "route", "outbound": "DIRECT"])
        rules.append(["network": "udp", "port": [5353], "action": "route", "outbound": "DIRECT"])
        rules.append(["process_name": ["sharingd", "rapportd", "SidecarDisplayAgent", "identityservicesd"], "action": "route", "outbound": "DIRECT"])
        rules.append(["ip_version": 6, "action": "reject"])
        rules.append(["network": ["udp", "icmp"], "action": "reject"])
        let localSubnets = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "fe80::/10", "fc00::/7", "224.0.0.0/4"]
        let exclusions = Array(Set(usable.map(\.server))).sorted().map { "\($0)/32" } + localSubnets
        let runtime: [String: Any] = [
            "log": ["level": overlay.logLevel == "warning" ? "warn" : overlay.logLevel],
            "dns": ["servers": dnsServers, "rules": dnsRules, "final": "Tono-DoH", "strategy": "ipv4_only"],
            "inbounds": [
                ["type": "tun", "tag": "Tono-TUN", "interface_name": tonoTunInterface,
                 "address": ["198.18.0.1/30"], "dns_address": ["198.18.0.2"], "dns_mode": "disabled",
                 "auto_route": true, "strict_route": false, "mtu": 1500, "multi_queue": false, "route_exclude_address": exclusions],
                ["type": "direct", "tag": "Tono-DNS", "listen": "127.0.0.1", "listen_port": 53],
                ["type": "mixed", "tag": "Tono-Mixed", "listen": "127.0.0.1", "listen_port": overlay.mixedPort],
            ],
            "outbounds": outbounds,
            "route": ["auto_detect_interface": true, "rules": rules, "final": exitGroupName,
                      "default_domain_resolver": ["server": "Tono-DoH", "strategy": "ipv4_only"]],
            "experimental": ["cache_file": ["enabled": false], "clash_api": [
                "external_controller": overlay.externalController, "secret": overlay.secret, "default_mode": "rule",
                "access_control_allow_origin": [String](), "access_control_allow_private_network": false]],
        ]
        let data = try JSONSerialization.data(withJSONObject: runtime, options: [.sortedKeys])
        guard data.count <= 8 * 1024 * 1024 else { throw SingBoxError.invalidNode }
        let endpoints = try uniqueDialEndpoints(
            dialEndpoints(for: usable.first { $0.name == selected })
                + dialEndpoints(for: usable.first { $0.name == home })
        )
        return OwnedSingBoxRuntime(runtimeJSON: data,
            runtimeSHA256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
            dialEndpoints: endpoints,
            directEndpoints: Array(Set((plan?.sessionEndpoints ?? []) + (plan == nil ? [] : managedDirectResolverEndpoints))),
            unavailableNodes: unavailable)
    }
}
