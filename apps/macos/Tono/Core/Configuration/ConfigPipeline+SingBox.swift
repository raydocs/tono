import Foundation
import CryptoKit

// M1 only. Frozen contract: 7f64978c5d9d5b8551e0b81f7247cb5a630ebf56.
// No product caller, signature admission, staging, process or network operations.
nonisolated extension ConfigPipeline {
    enum SingBoxError: String, Error, LocalizedError, CustomStringConvertible {
        case untrustedSnapshot = "TONO_SINGBOX_UNTRUSTED_SNAPSHOT"
        case unsupportedPolicy = "TONO_SINGBOX_UNSUPPORTED_POLICY"
        case unsupportedHomeRoute = "TONO_SINGBOX_UNSUPPORTED_HOME_ROUTE"
        case unsupportedTransport = "TONO_SINGBOX_UNSUPPORTED_TRANSPORT"
        case invalidNode = "TONO_SINGBOX_INVALID_NODE"
        case unsupportedFingerprint = "TONO_SINGBOX_UNSUPPORTED_FINGERPRINT"
        case invalidControl = "TONO_SINGBOX_INVALID_CONTROL"
        var description: String { rawValue }
        var errorDescription: String? { rawValue }
    }

    /// A synthetic document is deliberately NOT a verified product snapshot.
    /// M2 must obtain actual owner-bound admission; this type cannot grant it.
    struct SingBoxOfflineSnapshot: CustomStringConvertible, CustomDebugStringConvertible,
        CustomReflectable {
        enum Status { case syntheticOfflineOnly, unverified, expired, revoked }
        let rawJSON: Data
        let identity: String
        let revision: Int
        let digest: String // Existing document convention: base64url SHA-256.
        let status: Status
        var description: String { "SingBoxOfflineSnapshot(redacted)" }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: [:]) }
    }

    /// Explicit even when no plan exists. nil means incomplete information.
    struct SingBoxDerivedRequirements {
        var nativeAppDirect = true // Preserve the macOS product default.
        var webDirect = false
        var directLease = false
        var homeRoute = false
        var tailnetOrSOCKS = false
        var additionalCapabilities: [String] = []
    }

    struct SingBoxRuntimeDraft: CustomStringConvertible, CustomDebugStringConvertible,
        CustomReflectable {
        enum Lifecycle { case syntheticDraftOnly }
        let lifecycle = Lifecycle.syntheticDraftOnly
        static let profile = "reality-tcp-no-special-routing-v1"
        let runtimeJSON: Data
        let runtimeSHA256: String
        let dialEndpoints: [DialEndpoint]
        let generation: UInt64
        let catalogSnapshot: SingBoxOfflineSnapshot
        let policySnapshot: SingBoxOfflineSnapshot
        let nodeCount: Int
        let selectedIndex: Int
        // No transition to checked, started or Connected. check is external
        // parser evidence only, never a process/native ownership receipt.
        var description: String {
            "\(Self.profile) nodes=\(nodeCount) selectedIndex=\(selectedIndex) sha256=\(runtimeSHA256) syntheticDraftOnly"
        }
        var debugDescription: String { description }
        var customMirror: Mirror { Mirror(self, children: ["summary": description]) }
    }

    /// Native nodes encoded as a complete synthetic catalog document with keys
    /// `nodes` and `routing`. This is NOT the server wire schema or privileged IPC.
    /// Requiring raw documents avoids accepting a filtered/sanitized empty policy.
    static func makeSingBoxOfflineDraft(
        catalog: SingBoxOfflineSnapshot,
        policy: SingBoxOfflineSnapshot,
        selected: String,
        directPlan: ManagedDirectRuntimePolicy?,
        derivedRequirements: SingBoxDerivedRequirements?,
        platform: String,
        controllerPort: Int,
        mixedPort: Int,
        controllerSecret: String,
        generation: UInt64
    ) throws -> SingBoxRuntimeDraft {
        func document(_ snapshot: SingBoxOfflineSnapshot) throws -> [String: Any] {
            let digest = Data(SHA256.hash(data: snapshot.rawJSON)).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
            guard snapshot.status == .syntheticOfflineOnly,
                  !snapshot.identity.isEmpty, snapshot.revision >= 0,
                  snapshot.rawJSON.count <= 1024 * 1024,
                  snapshot.digest == digest,
                  let object = try? JSONSerialization.jsonObject(with: snapshot.rawJSON),
                  let dictionary = object as? [String: Any] else {
                throw SingBoxError.untrustedSnapshot
            }
            return dictionary
        }
        let rawCatalog = try document(catalog)
        let rawPolicy = try document(policy)
        guard catalog.identity == policy.identity else { throw SingBoxError.untrustedSnapshot }
        guard Set(rawCatalog.keys) == Set(["nodes", "routing"]),
              let routing = rawCatalog["routing"] as? [String: Any] else {
            throw SingBoxError.unsupportedPolicy
        }
        // Presence matters, including null, an invalid value or an empty name.
        guard routing["homeProxy"] == nil, routing["homeSocks5"] == nil else {
            throw SingBoxError.unsupportedHomeRoute
        }
        guard Set(routing.keys).isSubset(of: ["defaultProxy"]) else {
            throw SingBoxError.unsupportedPolicy
        }
        let policyKeys: Set<String> = ["version", "domains", "mediaEndpoints", "webDomains", "directSuffixes"]
        guard Set(rawPolicy.keys) == policyKeys,
              let version = rawPolicy["version"] as? NSNumber,
              version.stringValue == "3" else { throw SingBoxError.unsupportedPolicy }
        for key in policyKeys.subtracting(["version"]) {
            guard let values = rawPolicy[key] as? [Any], values.isEmpty else {
                throw SingBoxError.unsupportedPolicy
            }
        }
        guard let requirements = derivedRequirements else { throw SingBoxError.unsupportedPolicy }
        guard !requirements.homeRoute else { throw SingBoxError.unsupportedHomeRoute }
        guard !requirements.tailnetOrSOCKS else { throw SingBoxError.unsupportedTransport }
        guard directPlan == nil, !requirements.nativeAppDirect, !requirements.webDirect,
              !requirements.directLease, requirements.additionalCapabilities.isEmpty else {
            throw SingBoxError.unsupportedPolicy
        }
        guard let rawNodes = rawCatalog["nodes"] as? [[String: Any]],
              (1...200).contains(rawNodes.count) else { throw SingBoxError.invalidNode }
        // JSONDecoder ignores unknown keys. Reject them first instead of losing
        // required transport/route semantics at that boundary.
        let nodeKeys: Set<String> = [
            "id", "flag", "name", "type", "server", "port", "relay", "latency", "isActive",
            "subscriptionId", "username", "password", "uuid", "cipher", "udp", "sni",
            "skipCertVerify", "network", "wsPath", "wsHost", "grpcServiceName", "tls",
            "alterId", "flow", "clientFingerprint", "tlsFingerprint", "realityPublicKey", "realityShortId",
        ]
        for node in rawNodes {
            guard Set(node.keys).isSubset(of: nodeKeys) else { throw SingBoxError.unsupportedPolicy }
            guard node["type"] as? String == "vless",
                  node["network"] == nil || node["network"] as? String == "tcp" else {
                throw SingBoxError.unsupportedTransport
            }
            guard node["relay"] as? String == "" else { throw SingBoxError.unsupportedTransport }
        }
        let nodes: [ProxyNode]
        do {
            let data = try JSONSerialization.data(withJSONObject: rawNodes)
            nodes = try validatedOwnedNodes(JSONDecoder().decode([ProxyNode].self, from: data))
        } catch { throw SingBoxError.invalidNode } // Do not expose admission's node-bearing errors.
        let reserved: Set<String> = ["Tono-TUN", "Tono-DNS", "Tono-Mixed", "Tono-FakeIP", "Tono-DoH"]
        for node in nodes {
            guard !reserved.contains(node.name),
                  let key = node.realityPublicKey,
                  Data(base64Encoded: key.replacingOccurrences(of: "-", with: "+")
                    .replacingOccurrences(of: "_", with: "/") + "=")?.count == 32 else {
                throw SingBoxError.invalidNode
            }
            guard node.clientFingerprint == "chrome" else { throw SingBoxError.unsupportedFingerprint }
            // No DER pin conversion or ignored alternate transport options.
            guard node.tlsFingerprint == nil, node.wsPath == nil, node.wsHost == nil,
                  node.grpcServiceName == nil, node.alterId == nil,
                  node.password == nil, node.username == nil, node.cipher == nil else {
                throw SingBoxError.unsupportedTransport
            }
        }
        guard let selectedIndex = nodes.firstIndex(where: { $0.name == selected }) else {
            throw SingBoxError.invalidNode
        }
        guard platform == "macos-arm64", (1...65535).contains(controllerPort), controllerPort != 53,
              (0...65535).contains(mixedPort), mixedPort != 53,
              mixedPort == 0 || mixedPort != controllerPort,
              let secret = Data(base64Encoded: controllerSecret), secret.count == 32,
              secret.base64EncodedString() == controllerSecret else { throw SingBoxError.invalidControl }

        var outbounds: [[String: Any]] = nodes.map { node in
            var outbound: [String: Any] = [
                "type": "vless", "tag": node.name, "server": node.server, "server_port": node.port,
                "uuid": node.uuid!,
                "tls": ["enabled": true, "server_name": node.sni!,
                        "utls": ["enabled": true, "fingerprint": "chrome"],
                        "reality": ["enabled": true, "public_key": node.realityPublicKey!,
                                    "short_id": node.realityShortId!]],
            ]
            if let flow = node.flow { outbound["flow"] = flow }
            return outbound
        }
        outbounds.append(["type": "selector", "tag": "Tono-Exit", "default": selected,
                          "outbounds": [selected] + nodes.filter { $0.name != selected }.map(\.name),
                          "interrupt_exist_connections": true])
        func ipv4Number(_ address: String) -> UInt32 {
            address.split(separator: ".").reduce(0) { ($0 << 8) | UInt32($1)! }
        }
        let exclusions = Set(nodes.map(\.server)).sorted { ipv4Number($0) < ipv4Number($1) }.map { "\($0)/32" }
        var inbounds: [[String: Any]] = [
            ["type": "tun", "tag": "Tono-TUN", "interface_name": "utun199",
             "address": ["198.18.0.1/30"], "dns_address": ["198.18.0.2"], "dns_mode": "disabled",
             "auto_route": true, "strict_route": false, "mtu": 1500, "multi_queue": false,
             "route_exclude_address": exclusions],
            ["type": "direct", "tag": "Tono-DNS", "listen": "127.0.0.1", "listen_port": 53],
        ]
        if mixedPort != 0 {
            inbounds.append(["type": "mixed", "tag": "Tono-Mixed", "listen": "127.0.0.1", "listen_port": mixedPort])
        }
        let runtime: [String: Any] = [
            "log": ["level": "warn"],
            "dns": [
                "servers": [
                    ["type": "fakeip", "tag": "Tono-FakeIP", "inet4_range": "198.19.0.0/16"],
                    ["type": "https", "tag": "Tono-DoH", "server": "1.1.1.1", "server_port": 443,
                     "path": "/dns-query", "tls": ["enabled": true, "server_name": "1.1.1.1"], "detour": "Tono-Exit"],
                ],
                "rules": [["query_type": ["AAAA"], "action": "predefined", "rcode": "NOERROR"],
                          ["query_type": ["A"], "action": "route", "server": "Tono-FakeIP"]],
                "final": "Tono-DoH", "strategy": "ipv4_only",
            ],
            "inbounds": inbounds, "outbounds": outbounds,
            "route": ["auto_detect_interface": true,
                      "rules": [["ip_version": 6, "action": "reject"],
                                ["inbound": ["Tono-DNS"], "action": "hijack-dns"],
                                ["port": [53], "action": "hijack-dns"],
                                ["network": ["udp", "icmp"], "action": "reject"]],
                      "final": "Tono-Exit"],
            "experimental": ["cache_file": ["enabled": false],
                             "clash_api": ["external_controller": "127.0.0.1:\(controllerPort)",
                                           "secret": controllerSecret, "default_mode": "rule",
                                           "access_control_allow_origin": ["tauri://localhost"],
                                           "access_control_allow_private_network": false]],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: runtime, options: [.sortedKeys]),
              data.count <= 8 * 1024 * 1024 else { throw SingBoxError.invalidNode }
        return SingBoxRuntimeDraft(
            runtimeJSON: data,
            runtimeSHA256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
            dialEndpoints: try dialEndpoints(for: nodes[selectedIndex]), generation: generation,
            catalogSnapshot: catalog, policySnapshot: policy, nodeCount: nodes.count, selectedIndex: selectedIndex
        )
    }
}
