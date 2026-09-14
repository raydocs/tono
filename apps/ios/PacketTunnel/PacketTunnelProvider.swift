import Foundation
import NetworkExtension

/// No fake packet pump, external process, unverified library or direct fallback.
/// Failed admission does not establish a system-wide kill switch; UI says unprotected.
final class PacketTunnelProvider: NEPacketTunnelProvider {
    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        completionHandler(NSError(domain: "com.ninx.tono.PacketTunnel", code: 1,
                                  userInfo: [NSLocalizedDescriptionKey: Blocker.coreUnavailable.message]))
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        guard messageData.count <= 4096,
              let request = try? JSONDecoder().decode(TunnelRequest.self, from: messageData),
              request.version == TunnelContract.protocolVersion else {
            completionHandler?(nil)
            return
        }
        let receipt = TunnelReceipt(version: TunnelReceipt.version, generation: request.generation,
                                    observedAt: .now, state: .actionRequired, blocker: .coreUnavailable,
                                    routesInstalled: false, dnsInstalled: false, coreRunning: false,
                                    probeSucceeded: false)
        completionHandler?(try? JSONEncoder().encode(receipt))
    }
}
