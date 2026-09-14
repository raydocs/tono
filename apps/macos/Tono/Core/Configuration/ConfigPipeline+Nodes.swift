import Foundation
import CryptoKit
import Darwin
import AppKit
import Security

/// Produces runtime.yaml from subscription YAML + minimal overlay.
/// Follows Verge's principle: subscription config is immutable, overlay only control fields.
extension ConfigPipeline {
    static func dialEndpoints(for node: ProxyNode?) throws -> [DialEndpoint] {
        guard let node else { return [] }
        let validated = try validatedOwnedNode(node)
        let transport = validated.type == .hysteria2 ? "udp" : "tcp"
        return [
            .init(host: validated.server, port: UInt16(validated.port), transport: transport),
        ]
    }

    /// PF switch permits: keep insertion order, drop exact host/port/transport
    /// duplicates so old ∪ new can be armed without repeating a tuple.
    static func uniqueDialEndpoints(_ endpoints: [DialEndpoint]) -> [DialEndpoint] {
        var seen = Set<DialEndpoint>()
        var unique: [DialEndpoint] = []
        unique.reserveCapacity(endpoints.count)
        for endpoint in endpoints where seen.insert(endpoint).inserted {
            unique.append(endpoint)
        }
        return unique
    }

    /// Validate the credential-bearing residential upstream without ever
    /// logging its username or password. Callers must reject a present value
    /// when this returns nil; absence and invalidity are not interchangeable.
    static func validatedHomeSocks5(
        _ upstream: TonoExitCatalogHomeSocks5?
    ) -> TonoExitCatalogHomeSocks5? {
        guard let upstream,
              let host = try? normalizedHost(upstream.host, field: "homeSocks5 host"),
              !host.contains(":"),
              // `normalizedHost` returns IP literals unscreened. Every other
              // policy-supplied address in this file is public-only; without the
              // same gate here a catalog could point the residential hop at
              // loopback or a LAN address. It is dialed through `dialer-proxy:
              // Tono-Exit` today, so this is defence in depth rather than a live
              // leak — but it is the one address that had no screening at all.
              isPublicHostCandidate(host),
              (1...65_535).contains(upstream.port),
              !upstream.username.isEmpty,
              !upstream.password.isEmpty,
              upstream.username.utf8.count <= 255,
              upstream.password.utf8.count <= 255,
              upstream.username.unicodeScalars.allSatisfy({
                  $0.value >= 0x20 && $0.value != 0x7F
              }),
              upstream.password.unicodeScalars.allSatisfy({
                  $0.value >= 0x20 && $0.value != 0x7F
              })
        else { return nil }
        return TonoExitCatalogHomeSocks5(
            host: host,
            port: upstream.port,
            username: upstream.username,
            password: upstream.password
        )
    }

    /// Admission before a catalog may replace the verified cache. A default
    /// selector is a hint; a declared residential identity is a requirement.
    static func validateRequiredResidentialRouting(
        _ routing: TonoExitCatalogRouting?,
        nodes: [ProxyNode]
    ) throws {
        guard let routing else { return }
        if let upstream = routing.homeSocks5 {
            guard validatedHomeSocks5(upstream) != nil else {
                throw TonoInjectionError.unsafeOverlay
            }
        } else if let rawName = routing.homeProxy {
            let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanName = ConfigParser.extractFlag(from: name).cleanName
            guard !name.isEmpty, nodes.contains(where: {
                $0.name == name || ConfigParser.extractFlag(from: $0.name).cleanName == cleanName
            }) else {
                throw TonoInjectionError.unsafeOverlay
            }
        }
    }

    /// The terminal that the owned runtime actually admits for the residential
    /// contract. Audit callers use this same validation path rather than
    /// interpreting the latest (possibly newer) mutable catalog themselves.
    static func admittedResidentialTerminal(
        overlay: OverlayConfig,
        customNodes: [ProxyNode]
    ) throws -> String? {
        admittedResidentialTerminal(
            overlay: overlay,
            validatedOwnedNodes: try validatedOwnedNodes(customNodes)
        )
    }

    static func admittedResidentialTerminal(
        overlay: OverlayConfig,
        validatedOwnedNodes nodes: [ProxyNode]
    ) -> String? {
        if validatedHomeSocks5(overlay.claudeHomeSocks5) != nil {
            return homeResidentialProxyName
        }
        return overlay.claudeHomeNodeName
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .flatMap { name in
                nodes.contains(where: { $0.name == name }) ? name : nil
            }
    }

    static func validatedOwnedNodes(_ nodes: [ProxyNode]) throws -> [ProxyNode] {
        guard nodes.count <= 200 else {
            throw TonoInjectionError.unsafeNode("node list")
        }
        var names = Set([
            homeNodeName,
            exitGroupName,
            claudeHomeGroupName,
            homeResidentialProxyName,
            directProxyName,
            webDirectProxyName,
            webDirectGroupName,
            appDirectGroupName,
            "__tono_tailnet",
            // Mihomo installs these adapters before parsing user proxies. A
            // catalog collision would invalidate the entire owned runtime and
            // can also corrupt the managed WeChat fallback member references.
            "DIRECT",
            "REJECT",
            "REJECT-DROP",
            "COMPATIBLE",
            "PASS",
            "PASS-RULE",
        ])
        var result: [ProxyNode] = []
        for node in nodes {
            let validated = try validatedOwnedNode(node)
            guard !validated.name.hasPrefix(managedDirectFallbackGroupPrefix) else {
                throw TonoInjectionError.duplicateNode(validated.name)
            }
            guard names.insert(validated.name).inserted else {
                throw TonoInjectionError.duplicateNode(validated.name)
            }
            result.append(validated)
        }
        return result
    }

    static func validatedOwnedNode(_ node: ProxyNode) throws -> ProxyNode {
        if node.type == .hysteria2 {
            return try validatedOwnedHysteria2(node)
        }
        var value = node
        // Protected multi-exit mode deliberately starts with one audited
        // contract: VLESS over authenticated TLS/Reality and a TCP carrier.
        // Other protocols must not silently widen the root PF allowlist.
        guard node.type == .vless, node.tls == true,
              node.uuid?.isEmpty == false else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.name = try safeScalar(node.name, maximum: 128, field: node.name)
        value.server = try normalizedServerAddress(node.server, field: node.name)
        guard (1...65_535).contains(node.port), node.skipCertVerify != true else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.password = try optionalScalar(node.password, maximum: 1_024, field: node.name)
        value.username = try optionalScalar(node.username, maximum: 256, field: node.name)
        value.uuid = try optionalScalar(node.uuid, maximum: 128, field: node.name)
        value.cipher = try optionalScalar(node.cipher, maximum: 128, field: node.name)
        value.sni = try optionalHost(node.sni, field: node.name)
        value.wsHost = try optionalHost(node.wsHost, field: node.name)
        value.wsPath = try optionalScalar(node.wsPath, maximum: 2_048, field: node.name)
        value.grpcServiceName = try optionalScalar(node.grpcServiceName, maximum: 256, field: node.name)
        value.flow = try optionalScalar(node.flow, maximum: 128, field: node.name)
        value.clientFingerprint = try optionalScalar(node.clientFingerprint, maximum: 64, field: node.name)
        value.realityPublicKey = try optionalScalar(node.realityPublicKey, maximum: 256, field: node.name)
        value.realityShortId = try optionalScalar(node.realityShortId, maximum: 64, field: node.name)
        if let network = node.network?.lowercased(), network != "tcp" {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.network = node.network?.lowercased()
        guard let uuid = value.uuid, UUID(uuidString: uuid) != nil else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        // Production is deliberately Reality-only. Plain VLESS-over-TLS must
        // not silently widen the catalog contract or reach Mihomo as a route
        // that has never been covered by the endpoint/fail-closed tests.
        guard let publicKey = value.realityPublicKey,
              publicKey.utf8.count == 43,
              publicKey.unicodeScalars.allSatisfy({
                  $0.isASCII
                      && ($0.properties.isAlphabetic
                          || CharacterSet.decimalDigits.contains($0)
                          || $0 == "-"
                          || $0 == "_")
              }),
              value.sni != nil,
              let shortID = value.realityShortId,
              !shortID.isEmpty,
              shortID.utf8.count <= 16,
              shortID.utf8.count.isMultiple(of: 2),
              shortID.unicodeScalars.allSatisfy({
                  CharacterSet(charactersIn: "0123456789abcdefABCDEF")
                      .contains($0)
              })
        else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        if let flow = value.flow, flow != "xtls-rprx-vision" {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        return value
    }

    /// Same-node backup transport: Hysteria2 with a pinned leaf cert.
    /// Password is the managed UUID; TLS identity is `fingerprint`, never
    /// `skip-cert-verify`.
    static func validatedOwnedHysteria2(_ node: ProxyNode) throws -> ProxyNode {
        var value = node
        value.name = try safeScalar(node.name, maximum: 128, field: node.name)
        value.server = try normalizedServerAddress(node.server, field: node.name)
        guard (1...65_535).contains(node.port), node.skipCertVerify != true else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.password = try optionalScalar(node.password, maximum: 128, field: node.name)
        value.sni = try optionalHost(node.sni, field: node.name)
        value.username = nil
        value.uuid = nil
        value.cipher = nil
        value.flow = nil
        value.clientFingerprint = nil
        value.realityPublicKey = nil
        value.realityShortId = nil
        value.wsHost = nil
        value.wsPath = nil
        value.grpcServiceName = nil
        value.tls = nil
        if let network = node.network?.lowercased(), network != "udp" {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.network = node.network?.lowercased()
        guard let password = value.password,
              password.count == 36,
              UUID(uuidString: password) != nil,
              value.sni != nil,
              let fingerprint = normalizedSHA256Fingerprint(node.tlsFingerprint)
        else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.tlsFingerprint = fingerprint
        return value
    }

    static func normalizedSHA256Fingerprint(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let hex = raw
            .filter { $0 != ":" }
            .lowercased()
        guard hex.count == 64,
              hex.unicodeScalars.allSatisfy({
                  CharacterSet(charactersIn: "0123456789abcdef").contains($0)
              })
        else {
            return nil
        }
        return hex
    }

    static func ownedNodeYAML(_ node: ProxyNode) throws -> String {
        let value = try validatedOwnedNode(node)
        var yaml = """
          - name: "\(yamlScalar(value.name))"
            type: \(value.type.rawValue)
            server: "\(yamlScalar(value.server))"
            port: \(value.port)
            udp: \(value.udp)

        """
        func append(_ key: String, _ scalar: String?) {
            guard let scalar, !scalar.isEmpty else { return }
            yaml += "    \(key): \"\(yamlScalar(scalar))\"\n"
        }
        if value.type == .hysteria2 {
            append("password", value.password)
            append("sni", value.sni)
            append("fingerprint", value.tlsFingerprint)
            return yaml
        }
        append("username", value.username)
        append("password", value.password)
        append("uuid", value.uuid)
        append("cipher", value.cipher)
        // Mihomo's VLESS schema uses `servername`. Emitting the generic
        // `sni` alias is accepted syntactically but ignored by Reality, which
        // makes the server reject the handshake with `tls: internal error`.
        append("servername", value.sni)
        append("flow", value.flow)
        append("client-fingerprint", value.clientFingerprint)
        if let alterId = value.alterId {
            guard (0...65_535).contains(alterId) else {
                throw TonoInjectionError.unsafeNode(value.name)
            }
            yaml += "    alterId: \(alterId)\n"
        }
        if value.tls == true { yaml += "    tls: true\n" }
        if let network = value.network {
            yaml += "    network: \(network)\n"
            if network == "ws" {
                yaml += "    ws-opts:\n"
                appendIndented("path", value.wsPath, into: &yaml, spaces: 6)
                if let host = value.wsHost {
                    yaml += "      headers:\n"
                    appendIndented("Host", host, into: &yaml, spaces: 8)
                }
            } else if network == "grpc" {
                yaml += "    grpc-opts:\n"
                appendIndented("grpc-service-name", value.grpcServiceName, into: &yaml, spaces: 6)
            }
        }
        if let publicKey = value.realityPublicKey, let shortId = value.realityShortId {
            yaml += "    reality-opts:\n"
            appendIndented("public-key", publicKey, into: &yaml, spaces: 6)
            appendIndented("short-id", shortId, into: &yaml, spaces: 6)
        }
        return yaml
    }

    static func appendIndented(
        _ key: String,
        _ value: String?,
        into yaml: inout String,
        spaces: Int
    ) {
        guard let value, !value.isEmpty else { return }
        yaml += String(repeating: " ", count: spaces) +
            "\(key): \"\(yamlScalar(value))\"\n"
    }

    static func safeScalar(
        _ raw: String,
        maximum: Int,
        field: String
    ) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf8.count <= maximum,
              !value.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) else {
            throw TonoInjectionError.unsafeNode(field)
        }
        return value
    }

    static func optionalScalar(
        _ raw: String?,
        maximum: Int,
        field: String
    ) throws -> String? {
        guard let raw else { return nil }
        return try safeScalar(raw, maximum: maximum, field: field)
    }

    static func optionalHost(_ raw: String?, field: String) throws -> String? {
        guard let raw else { return nil }
        return try normalizedHost(raw, field: field)
    }

    static func normalizedServerAddress(_ raw: String, field: String) throws -> String {
        let value = try normalizedHost(raw, field: field)
        var ipv4 = in_addr()
        guard inet_pton(AF_INET, value, &ipv4) == 1,
              isPublicIPv4(ipv4) else {
            // Hostname bootstrap would require a separate authenticated DoH
            // contract. Protected multi-exit mode accepts public IP literals
            // only, rejects private/reserved ranges before import, and
            // currently limits proxy egress to IPv4. SNI/Reality server names
            // remain supported separately.
            throw TonoInjectionError.unsafeNode(field)
        }
        return value
    }

    static func validatedPublicIPv4(_ raw: String, field: String) throws -> String {
        try normalizedServerAddress(raw, field: field)
    }

    /// Hosts that must never be routed direct, whatever a policy says and
    /// whoever signed it.
    ///
    /// A signature relaxes *which hosts may* leave the tunnel. It must never
    /// relax which hosts may not. Folding these in would make one leaked signing
    /// key sufficient to expose this product's own control plane and its users'
    /// assistant traffic — strictly worse than the allowlist a signature
    /// replaces, and the opposite of what signing is for.
    ///
    /// Mirrors `protectedSuffixes` in services/control-plane/src/index.ts. Until
    /// a signature could relax an allowlist these were enforced only implicitly,
    /// by never appearing on one; a trusted path needs them stated.
}
