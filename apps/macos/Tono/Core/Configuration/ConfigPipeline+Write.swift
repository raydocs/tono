import Foundation
import CryptoKit
import Darwin
import AppKit
import Security

/// Produces runtime.yaml from subscription YAML + minimal overlay.
/// Follows Verge's principle: subscription config is immutable, overlay only control fields.
extension ConfigPipeline {
    static func extractProxiesSection(from lines: [String]) -> String {
        guard let start = lines.firstIndex(where: {
            !$0.hasPrefix(" ") && !$0.hasPrefix("\t") &&
            ($0 == "proxies:" || $0.hasPrefix("proxies:"))
        }) else { return "" }
        var end = start + 1
        while end < lines.count {
            let line = lines[end]
            if !line.isEmpty && !line.hasPrefix(" ") && !line.hasPrefix("\t") && !line.hasPrefix("#") {
                break
            }
            end += 1
        }
        return lines[(start + 1)..<end].joined(separator: "\n")
    }

    /// Pure line transformation retained for unit tests of non-Tono inject paths.
    static func injectTono(_ descriptor: TonoTransportDescriptor, into lines: inout [String], tunEnabled: Bool) throws {
        let owned = try buildOwnedTonoRuntime(
            subscriptionYAML: lines.joined(separator: "\n"),
            overlay: OverlayConfig(tunEnabled: tunEnabled, tonoTransport: descriptor),
            transport: descriptor,
            customNodes: []
        )
        lines = owned.components(separatedBy: .newlines)
    }

    static func yamlScalar(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n").replacingOccurrences(of: "\r", with: "\\r")
    }

    static func secureWrite(_ value: String, to outputPath: URL) throws -> String {
        let data = Data(value.utf8)
        try data.write(to: outputPath, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: outputPath.path
        )
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Convert a ProxyNode to mihomo YAML proxy entry.
    ///
    /// Only the legacy (non-owned) runtime path reaches this. Every value here
    /// comes from imported subscription YAML, so all of them are escaped: an
    /// unescaped quote or newline in a node name, password, or relay label
    /// injected arbitrary YAML — including rules — into the generated runtime.
    /// The privileged helper refuses to run a runtime without the owned-config
    /// banner, so this was a latent path rather than a live one.
    static func nodeToYAML(_ node: ProxyNode, knownNames: [String] = []) -> String {
        var y = "  - name: \"\(yamlScalar(node.name))\"\n"
        y += "    type: \(node.type.rawValue)\n"
        y += "    server: \"\(yamlScalar(node.server))\"\n"
        y += "    port: \(node.port)\n"
        if let user = node.username, !user.isEmpty { y += "    username: \"\(yamlScalar(user))\"\n" }
        if let pw = node.password, !pw.isEmpty { y += "    password: \"\(yamlScalar(pw))\"\n" }
        if let uuid = node.uuid, !uuid.isEmpty { y += "    uuid: \"\(yamlScalar(uuid))\"\n" }
        if let cipher = node.cipher, !cipher.isEmpty { y += "    cipher: \"\(yamlScalar(cipher))\"\n" }
        if let aid = node.alterId { y += "    alterId: \(aid)\n" }
        y += "    udp: \(node.udp)\n"
        if !node.relay.isEmpty && node.relay != "Direct" {
            // Resolve dialer-proxy name: match against actual proxy names in config
            let relay = node.relay
            let resolved = knownNames.first(where: { $0 == relay })  // exact match first
                ?? knownNames.first(where: { relay.contains($0) })   // relay "🇯🇵 Japan | 01" contains config name "Japan | 01"
                ?? knownNames.first(where: { $0.contains(relay) })   // config name contains relay
                ?? relay
            y += "    dialer-proxy: \"\(yamlScalar(resolved))\"\n"
        }
        if let sni = node.sni, !sni.isEmpty {
            let key = node.type == .vless ? "servername" : "sni"
            y += "    \(key): \"\(yamlScalar(sni))\"\n"
        }
        if let scv = node.skipCertVerify, scv { y += "    skip-cert-verify: true\n" }
        if let tls = node.tls, tls { y += "    tls: true\n" }
        if let net = node.network, !net.isEmpty {
            y += "    network: \"\(yamlScalar(net))\"\n"
            if net == "ws" {
                y += "    ws-opts:\n"
                if let path = node.wsPath, !path.isEmpty { y += "      path: \"\(yamlScalar(path))\"\n" }
                if let host = node.wsHost, !host.isEmpty {
                    y += "      headers:\n        Host: \"\(yamlScalar(host))\"\n"
                }
            }
        }
        return y
    }
}
