import Foundation
import NetworkExtension

@MainActor
protocol TunnelControlling {
    func start(generation: UUID, onDemand: Bool, selected: String) async throws
    func activeGeneration() async throws -> UUID?
    func pause() async throws
    func observe(generation: UUID, completion: @escaping (TunnelReceipt?) -> Void)
}

extension TunnelControlling {
    func activeGeneration() async throws -> UUID? { nil }
    func observe(generation: UUID, completion: @escaping (TunnelReceipt?) -> Void) { completion(nil) }
}

@MainActor
final class TunnelController: TunnelControlling {
    private let cloud: CloudClient

    init(cloud: CloudClient? = nil) { self.cloud = cloud ?? CloudClient() }

    static func configuration(onDemand: Bool) -> NETunnelProviderManager {
        let manager = NETunnelProviderManager()
        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = TunnelContract.providerBundleID
        proto.serverAddress = "Tono managed protection"
        proto.includeAllNetworks = true
        proto.excludeLocalNetworks = false
        proto.excludeAPNs = false
        proto.excludeCellularServices = false
        // Apple applies enforceRoutes only when includeAllNetworks is false.
        // Unavoidable system exclusions still exist; see README before activation.
        proto.enforceRoutes = false
        proto.disconnectOnSleep = false
        proto.providerConfiguration = ["version": TunnelContract.protocolVersion]
        manager.protocolConfiguration = proto
        manager.localizedDescription = "Tono"
        let rule = NEOnDemandRuleConnect()
        rule.interfaceTypeMatch = .any
        manager.onDemandRules = [rule]
        manager.isOnDemandEnabled = onDemand
        manager.isEnabled = true
        return manager
    }

    func start(generation: UUID, onDemand: Bool, selected: String = "") async throws {
        // Before touching system preferences, not after installing a reconnect loop.
        try SingBoxIdentity.requireEmbeddedCore()
        let existing = try await NETunnelProviderManager.loadAllFromPreferences().filter {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == TunnelContract.providerBundleID
        }
        guard existing.count <= 1 else { throw Blocker.tunnelUnavailable }
        let template = Self.configuration(onDemand: onDemand)
        let manager = existing.first ?? template
        guard manager.connection.status == .disconnected || manager.connection.status == .invalid else {
            throw Blocker.tunnelUnavailable
        }
        // Fence On Demand before awaiting cloud I/O or replacing shared credentials.
        if !existing.isEmpty { try await Self.disable(manager) }
        try await cloud.stageTunnel(generation: generation, selected: selected)
        guard try TunnelVault().grant().generation == generation else { throw Blocker.sessionExpired }
        manager.protocolConfiguration = template.protocolConfiguration
        manager.onDemandRules = template.onDemandRules
        manager.isOnDemandEnabled = onDemand
        manager.isEnabled = true
        manager.localizedDescription = "Tono"
        try await manager.saveToPreferences()
        try await manager.loadFromPreferences()
        try manager.connection.startVPNTunnel()
    }

    func activeGeneration() async throws -> UUID? {
        let managers = try await NETunnelProviderManager.loadAllFromPreferences().filter {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == TunnelContract.providerBundleID
        }
        guard managers.count <= 1 else { throw Blocker.tunnelUnavailable }
        guard let manager = managers.first,
              manager.connection.status != .disconnected, manager.connection.status != .invalid else { return nil }
        let grant = try TunnelVault().grant()
        guard grant.accountID == cloud.credentials?.user.id else { throw Blocker.sessionExpired }
        return grant.generation
    }

    func observe(generation: UUID, completion: @escaping (TunnelReceipt?) -> Void) {
        Task {
            do {
                let managers = try await NETunnelProviderManager.loadAllFromPreferences()
                guard let manager = managers.first(where: {
                    ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == TunnelContract.providerBundleID
                }), let session = manager.connection as? NETunnelProviderSession else { completion(nil); return }
                let data = try JSONEncoder().encode(TunnelRequest(version: TunnelContract.protocolVersion,
                    generation: generation, command: .status))
                try session.sendProviderMessage(data) { response in
                    let receipt = response.flatMap { $0.count <= 4096 ? try? JSONDecoder().decode(TunnelReceipt.self, from: $0) : nil }
                    Task { @MainActor in completion(receipt) }
                }
            } catch { completion(nil) }
        }
    }

    func pause() async throws {
        var failure: Error?
        do { try TunnelVault().revoke() } catch { failure = error }
        // Even a failed Keychain revoke must attempt to disable/stop every profile.
        let managers = try await NETunnelProviderManager.loadAllFromPreferences()
        for manager in managers where
            (manager.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == TunnelContract.providerBundleID {
            do { try await Self.disable(manager) } catch { failure = failure ?? error }
        }
        if let failure { throw failure }
    }

    private static func disable(_ manager: NETunnelProviderManager) async throws {
        // Save disable BEFORE stop; otherwise On Demand can reconnect during pause.
        manager.isOnDemandEnabled = false
        manager.isEnabled = false
        do {
            try await manager.saveToPreferences()
            try await manager.loadFromPreferences()
            guard !manager.isOnDemandEnabled, !manager.isEnabled else { throw Blocker.tunnelUnavailable }
        } catch {
            // Best effort even if persistence fails. Cleanup must remain pending.
            manager.connection.stopVPNTunnel()
            throw error
        }
        manager.connection.stopVPNTunnel()
        for _ in 0..<30 {
            if manager.connection.status == .disconnected || manager.connection.status == .invalid { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard manager.connection.status == .disconnected || manager.connection.status == .invalid else {
            throw Blocker.tunnelUnavailable
        }
    }
}
