import Foundation
import NetworkExtension
import TonoKit

/// Outside commands (widget button, Live Activity, Control Center), performed in the app process.
/// Only switches Tono's existing VPN configuration: no sign-in, no catalog, no settings. On Demand
/// follows the switch exactly as in the app (on with a start, off before a stop), so iOS neither
/// restarts a tunnel the user stopped nor leaves a started one without its recovery rule. Switches go
/// through the app's own lifecycle (`TunnelController.lifecycle`): the latest switch from either wins.
enum TunnelCommand {
    @MainActor
    static func set(on: Bool) async throws {
        // Off takes over at once, before any wait: a start still saving does not reach the system after it.
        guard on else {
            await TunnelController.lifecycle.stop(Steps())
            return
        }
        // Configuration discovery is a lifecycle step too: an Off arriving during that wait
        // must supersede this On, not be overwritten when discovery finally returns.
        try await TunnelController.lifecycle.start(Steps())
    }

    /// The command's steps: Tono's existing configuration, read again in its turn. A start arms On
    /// Demand (saving only when it was off) and never writes settings or creates a configuration.
    @MainActor
    private final class Steps: TunnelLifecycleSteps {
        private var manager: NETunnelProviderManager?
        private var saved = false

        var onDemandEnabled: Bool { manager?.isOnDemandEnabled == true }

        func refresh() async -> Bool {
            manager = try? await TunnelController.savedConfiguration()
            return manager != nil
        }

        func saveForStart() async throws {
            let signedIn = KeychainTokenStore().loadTokens() != nil
            let hasInputs = StatusStore.url != nil && (try? SharedFiles.loadInputs()) != nil
            if let refusal = TunnelCommandGate.checkStart(signedIn: signedIn, configured: manager?.isEnabled == true, hasInputs: hasInputs) {
                throw TunnelCommandError(refusal: refusal)
            }
            guard let manager else { throw TunnelCommandError(refusal: .needsPermission) }
            guard !manager.isOnDemandEnabled else { return }
            manager.isOnDemandEnabled = true
            try await manager.saveToPreferences()
            saved = true
        }

        func reloadForStart() async throws {
            if saved { try await manager?.loadFromPreferences() }
        }

        func startTunnel() throws {
            guard let manager else { throw TunnelCommandError(refusal: .needsPermission) }
            // Sign-out may have cleared the account while save/reload awaited iOS.
            let hasInputs = StatusStore.url != nil && (try? SharedFiles.loadInputs()) != nil
            if let refusal = TunnelCommandGate.checkStart(signedIn: KeychainTokenStore().loadTokens() != nil,
                                                          configured: manager.isEnabled, hasInputs: hasInputs) {
                throw TunnelCommandError(refusal: refusal)
            }
            // Retry a live tunnel without routes in place; never claim a reload was confirmed here.
            let status = manager.connection.status
            if status == .connected || status == .reasserting,
               let session = manager.connection as? NETunnelProviderSession {
                try session.sendProviderMessage(TunnelMessage.reload.encoded) { _ in }
            } else {
                try manager.connection.startVPNTunnel()
            }
        }

        func disarmOnDemand() async {
            guard let manager else { return }
            manager.isOnDemandEnabled = false
            try? await manager.saveToPreferences()
        }

        func stopTunnel() async {
            manager?.connection.stopVPNTunnel()
        }

        func removeConfiguration() async {
            guard let manager else { return }
            manager.connection.stopVPNTunnel()
            try? await manager.removeFromPreferences()
        }
    }
}
