import Foundation
import NetworkExtension

@MainActor
protocol TunnelControlling {
    func start(generation: UUID, onDemand: Bool) async throws
    func pause() async throws
}

@MainActor
final class TunnelController: TunnelControlling {
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

    func start(generation: UUID, onDemand: Bool) async throws {
        // Before touching system preferences, not after installing a reconnect loop.
        try SingBoxIdentity.requireEmbeddedCore()
        // Unreachable until an approved core + policy adapter replaces the admission gate.
        // Persisted profile creation/start is intentionally not enabled in this scaffold.
        throw Blocker.coreUnavailable
    }

    func pause() async throws {
        let managers = try await NETunnelProviderManager.loadAllFromPreferences()
        for manager in managers where
            (manager.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == TunnelContract.providerBundleID {
            // Save disable BEFORE stop; otherwise On Demand can reconnect during pause.
            manager.isOnDemandEnabled = false
            manager.isEnabled = false
            try await manager.saveToPreferences()
            try await manager.loadFromPreferences()
            guard !manager.isOnDemandEnabled, !manager.isEnabled else { throw Blocker.tunnelUnavailable }
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
}
