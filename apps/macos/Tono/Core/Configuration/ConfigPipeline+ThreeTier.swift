import CryptoKit
import Foundation

nonisolated extension ConfigPipeline {
    /// Compiling a graph is not session readiness: the Helper independently
    /// binds its digest and admits physical grants under the release generation.
    static func buildThreeTierSingBoxRuntime(
        overlay: OverlayConfig,
        nodes: [ProxyNode],
        physicalInterface: String,
        fakeIPSlot: Int = 0
    ) throws -> OwnedSingBoxRuntime {
        guard overlay.claudeHomeSocks5 != nil, overlay.tonoTransport == nil,
              !overlay.allowLocalNetworkDevices else { throw SingBoxError.unsupportedPolicy }
        let compiled = try buildSingBoxRuntime(overlay: overlay, nodes: nodes, directPlan: nil, fakeIPSlot: fakeIPSlot)
        guard var runtime = try JSONSerialization.jsonObject(with: compiled.runtimeJSON) as? [String: Any],
              var outbounds = runtime["outbounds"] as? [[String: Any]],
              let dns = runtime["dns"] as? [String: Any], let servers = dns["servers"] as? [[String: Any]],
              let fakeRange = servers.first?["inet4_range"] as? String else { throw SingBoxError.unsupportedPolicy }
        let graph = try ThreeTierRoutingContract.graph(home: homeResidentialProxyName,
            physicalInterface: physicalInterface, fakeRange: fakeRange)
        // Only the selected cloud selector survives. In particular, do not
        // carry stable LAN/direct or a Home alias into a different graph.
        outbounds.removeAll { $0["type"] as? String == "direct"
            || ($0["type"] as? String == "selector" && $0["tag"] as? String != exitGroupName) }
        guard !outbounds.contains(where: { $0["tag"] as? String == ThreeTierRoutingContract.direct }),
              let direct = graph["direct_outbound"] as? [String: Any] else { throw SingBoxError.unsupportedPolicy }
        outbounds.append(direct)
        runtime["outbounds"] = outbounds
        runtime["route"] = graph["route"]
        runtime["dns"] = graph["dns"]
        guard ThreeTierRoutingContract.admits(runtime) else { throw SingBoxError.unsupportedPolicy }
        let data = try JSONSerialization.data(withJSONObject: runtime, options: [.sortedKeys])
        guard data.count <= 8 * 1024 * 1024 else { throw SingBoxError.unsupportedPolicy }
        return OwnedSingBoxRuntime(runtimeJSON: data,
            runtimeSHA256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
            dialEndpoints: compiled.dialEndpoints,
            directEndpoints: [.init(address: "223.5.5.5", port: 443, transport: "tcp")],
            unavailableNodes: compiled.unavailableNodes)
    }
}
