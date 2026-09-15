import Foundation
import NetworkExtension
#if canImport(Tonomobile)
import Tonomobile
#endif

/// Public packet-flow only. All lifecycle state is owned by `queue`; Go reads
/// block on a separate queue and are unblocked by Close, never by polling.
final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let queue = DispatchQueue(label: "com.ninx.tono.tunnel.lifecycle")
    private var epoch = UUID()
    private var grant: TunnelGrant?
    private var task: Task<Void, Never>?
    private var healthy = false
    private var lastProbe: Date?
    private var packetReadPending = false
    private var blocker: Blocker? = .coreUnavailable
    #if canImport(Tonomobile)
    private var core: TonomobileSession?
    #endif

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        queue.async {
            do {
                try SingBoxIdentity.requireEmbeddedCore()
                self.grant = try TunnelVault().grant()
                self.epoch = UUID()
                #if canImport(Tonomobile)
                self.refresh(self.epoch, completion: completionHandler)
                #else
                throw Blocker.coreUnavailable
                #endif
            } catch { completionHandler(error as? Blocker ?? Blocker.tunnelUnavailable) }
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        queue.async {
            self.epoch = UUID()
            self.task?.cancel()
            self.healthy = false
            #if canImport(Tonomobile)
            self.core?.close()
            self.core = nil
            #endif
            completionHandler()
        }
    }

    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        guard messageData.count <= 4096,
              let request = try? JSONDecoder().decode(TunnelRequest.self, from: messageData),
              request.version == TunnelContract.protocolVersion else {
            completionHandler?(nil)
            return
        }
        queue.async {
            guard let grant = self.grant, request.generation == grant.generation else { completionHandler?(nil); return }
            let fresh = self.lastProbe.map { $0 <= .now && Date.now.timeIntervalSince($0) <= 10 } ?? false
            let protected = self.healthy && fresh
            let receipt = TunnelReceipt(version: TunnelReceipt.version, generation: grant.generation,
                observedAt: .now, state: protected ? .protected : .recovering, blocker: self.blocker,
                routesInstalled: protected, dnsInstalled: protected, coreRunning: protected,
                probeSucceeded: protected)
            completionHandler?(try? JSONEncoder().encode(receipt))
        }
    }

    #if canImport(Tonomobile)
    private func refresh(_ token: UUID, completion: ((Error?) -> Void)? = nil) {
        guard token == epoch, let grant else { completion?(Blocker.tunnelUnavailable); return }
        healthy = false
        core?.close()
        core = nil
        task = Task {
            do {
                let (catalog, policy) = try await TunnelCloud().fetch(grant)
                try Task.checkCancellation()
                self.queue.async {
                    guard token == self.epoch else { completion?(Blocker.tunnelUnavailable); return }
                    do {
                        let current = try TunnelVault().grant()
                        guard current.generation == grant.generation, current.scope == grant.scope else { throw Blocker.sessionExpired }
                        let old = try TunnelVault().watermark(scope: grant.scope)
                        var error: NSError?
                        guard let admission = TonomobilePrepare(catalog, policy, grant.selected, old, &error), error == nil else {
                            throw Blocker.unsupportedPolicy
                        }
                        // Persist before installing routes/start. Corruption never resets receipts.
                        try TunnelVault().write(Data(admission.watermark().utf8), account: "watermark:" + grant.scope)
                        self.setTunnelNetworkSettings(Self.settings()) { settingsError in
                            self.queue.async {
                                guard token == self.epoch else { completion?(Blocker.tunnelUnavailable); return }
                                do {
                                    guard settingsError == nil else { throw Blocker.tunnelUnavailable }
                                    let candidate: TonomobileSession? = try admission.start()
                                    guard let core = candidate else { throw Blocker.coreUnavailable }
                                    self.core = core
                                    self.readPackets()
                                    self.writePackets(token, core: core)
                                    try core.probe()
                                    self.lastProbe = .now
                                    self.healthy = true
                                    self.blocker = nil
                                    self.heartbeat(token, core: core)
                                    completion?(nil)
                                    self.queue.asyncAfter(deadline: .now() + 120) {
                                        guard token == self.epoch else { return }
                                        self.epoch = UUID() // fence packet callbacks from previous core
                                        self.refresh(self.epoch)
                                    }
                                } catch { self.failed(error, completion: completion) }
                            }
                        }
                    } catch { self.failed(error, completion: completion) }
                }
            } catch {
                self.queue.async {
                    guard token == self.epoch else { completion?(Blocker.tunnelUnavailable); return }
                    self.failed(error, completion: completion)
                }
            }
        }
    }

    private static func settings() -> NEPacketTunnelNetworkSettings {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "198.18.0.2")
        settings.mtu = 1280
        let ipv4 = NEIPv4Settings(addresses: ["198.18.0.1"], subnetMasks: ["255.255.255.252"])
        ipv4.includedRoutes = [.default()]
        let ipv6 = NEIPv6Settings(addresses: ["fdfe:dcba:9876::1"], networkPrefixLengths: [126])
        ipv6.includedRoutes = [.default()]
        let dns = NEDNSSettings(servers: ["198.18.0.2"])
        dns.matchDomains = [""]
        dns.matchDomainsNoSearch = true
        settings.ipv4Settings = ipv4
        settings.ipv6Settings = ipv6
        settings.dnsSettings = dns
        return settings
    }

    private func readPackets() {
        guard !packetReadPending, core != nil else { return }
        packetReadPending = true
        packetFlow.readPackets { packets, families in
            self.queue.async {
                self.packetReadPending = false
                guard let core = self.core else { return }
                do {
                    guard packets.count == families.count else { throw Blocker.tunnelUnavailable }
                    for (packet, family) in zip(packets, families) {
                        guard let first = packet.first,
                              (first >> 4 == 4 && family.int32Value == AF_INET) ||
                              (first >> 4 == 6 && family.int32Value == AF_INET6) else { throw Blocker.tunnelUnavailable }
                        try core.write(packet)
                    }
                    self.readPackets()
                } catch { self.failed(error) }
            }
        }
    }

    private func heartbeat(_ token: UUID, core: TonomobileSession) {
        queue.asyncAfter(deadline: .now() + 5) {
            guard token == self.epoch else { return }
            DispatchQueue.global(qos: .utility).async {
                do {
                    // A revoked local grant stops before the next cloud refresh.
                    let grant = try TunnelVault().grant()
                    try core.probe()
                    self.queue.async {
                        guard token == self.epoch else { return }
                        guard grant.generation == self.grant?.generation else { self.failed(Blocker.sessionExpired); return }
                        self.lastProbe = .now
                        self.heartbeat(token, core: core)
                    }
                } catch {
                    self.queue.async { if token == self.epoch { self.failed(error) } }
                }
            }
        }
    }

    private func writePackets(_ token: UUID, core: TonomobileSession) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                while true {
                    let next: Data? = try core.read()
                    guard let packet = next, let first = packet.first else { break }
                    let accepted = self.queue.sync {
                        token == self.epoch && self.packetFlow.writePackets([packet],
                            withProtocols: [NSNumber(value: first >> 4 == 4 ? AF_INET : AF_INET6)])
                    }
                    if !accepted { throw Blocker.tunnelUnavailable }
                }
                throw Blocker.tunnelUnavailable
            } catch {
                self.queue.async { if token == self.epoch { self.failed(error) } }
            }
        }
    }

    private func failed(_ error: Error, completion: ((Error?) -> Void)? = nil) {
        epoch = UUID()
        healthy = false
        blocker = error as? Blocker ?? .tunnelUnavailable // never surface Go/parser/credential text
        core?.close()
        core = nil
        if blocker == .sessionExpired { try? TunnelVault().revoke() }
        if let completion { completion(blocker) }
        else { cancelTunnelWithError(blocker) }
    }
    #endif
}
