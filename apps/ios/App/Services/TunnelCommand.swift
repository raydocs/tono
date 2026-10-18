import Foundation
import NetworkExtension
import TonoKit

/// Outside commands (widget button, Live Activity, Control Center), performed in the app process.
/// Only switches Tono's existing VPN configuration: no sign-in, no catalog, no settings. On Demand
/// follows the switch exactly as in the app (on with a start, off before a stop), so iOS neither
/// restarts a tunnel the user stopped nor leaves a started one without its recovery rule.
enum TunnelCommand {
    @MainActor
    static func set(on: Bool) async throws {
        let manager = try await NETunnelProviderManager.loadAllFromPreferences().first {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == TunnelController.providerBundleID
        }
        guard on else {
            guard let manager else { return }
            if manager.isOnDemandEnabled {
                manager.isOnDemandEnabled = false
                try? await manager.saveToPreferences()
            }
            manager.connection.stopVPNTunnel()
            return
        }
        let signedIn = KeychainTokenStore().loadTokens() != nil
        // StatusStore.url is nil without the App Group (unsigned simulator build): no inputs, no trap.
        let hasInputs = StatusStore.url != nil && (try? SharedFiles.loadInputs()) != nil
        if let refusal = TunnelCommandGate.checkStart(signedIn: signedIn, configured: manager?.isEnabled == true, hasInputs: hasInputs) {
            throw TunnelCommandError(refusal: refusal)
        }
        guard let manager else { return }
        // Retry while the tunnel runs without routes (a refused rebuild): starting would do nothing,
        // so ask the extension to rebuild; its heartbeat then reports what runs.
        let status = manager.connection.status
        if status == .connected || status == .reasserting, let session = manager.connection as? NETunnelProviderSession {
            try session.sendProviderMessage(TunnelMessage.reload.encoded) { _ in }
            return
        }
        if !manager.isOnDemandEnabled {
            manager.isOnDemandEnabled = true
            try await manager.saveToPreferences()
            try await manager.loadFromPreferences()
        }
        try manager.connection.startVPNTunnel()
    }
}
