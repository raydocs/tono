import Foundation
import Libbox
import NetworkExtension
import TonoKit

/// Owns Tono's one NETunnelProviderManager: creates it (iOS asks the user once), keeps the system
/// protection options in step with the app's settings, starts and stops the tunnel, and reports
/// NEVPNStatus changes.
@MainActor
final class TunnelController {
    static var providerBundleID: String {
        Bundle.main.object(forInfoDictionaryKey: "TonoTunnelBundleID") as? String ?? "com.raydocs.tono.ios.tunnel"
    }

    private(set) var manager: NETunnelProviderManager?
    var onStatus: ((TunnelStatus, Date?) -> Void)?
    private var observer: NSObjectProtocol?

    init() {
        // Only Tono's own configuration posts here (an app sees only the managers it created).
        observer = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: nil, queue: .main) { [weak self] note in
            guard let connection = note.object as? NEVPNConnection else { return }
            let status = Self.map(connection.status), since = connection.connectedDate
            Task { @MainActor in self?.onStatus?(status, since) }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// Loads the existing configuration without creating one (no system prompt).
    func load() async {
        manager = try? await NETunnelProviderManager.loadAllFromPreferences().first {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == Self.providerBundleID
        }
        if let manager { publish(manager.connection) } else { onStatus?(.disconnected, nil) }
    }

    var configured: Bool { manager?.isEnabled == true }

    var status: TunnelStatus { manager.map { Self.map($0.connection.status) } ?? .invalid }

    /// Saves Tono's configuration. The first save shows the iOS "Add VPN Configurations" prompt;
    /// declining it throws `TunnelError.denied`.
    func prepare(includeAllNetworks: Bool, onDemand: Bool) async throws -> NETunnelProviderManager {
        let m = manager ?? NETunnelProviderManager()
        let proto = (m.protocolConfiguration as? NETunnelProviderProtocol) ?? NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.providerBundleID
        proto.serverAddress = "Tono"
        // Stricter default: the system routes everything through the tunnel and holds traffic while
        // it restarts. LAN stays reachable; APNs and cellular services stay outside so calls and
        // push keep working (Apple's guidance for full-tunnel VPNs).
        proto.includeAllNetworks = includeAllNetworks
        proto.excludeLocalNetworks = true
        if #available(iOS 16.4, *) {
            proto.excludeAPNs = true
            proto.excludeCellularServices = true
        }
        proto.enforceRoutes = !includeAllNetworks
        proto.disconnectOnSleep = false
        m.protocolConfiguration = proto
        m.localizedDescription = "Tono"
        m.isEnabled = true
        let rule = NEOnDemandRuleConnect()
        rule.interfaceTypeMatch = .any
        m.onDemandRules = [rule]
        m.isOnDemandEnabled = onDemand
        do {
            try await m.saveToPreferences()
        } catch {
            throw Self.isPermissionError(error) ? TunnelError.denied : error
        }
        // Apple: reload after the first save before starting, or the start can fail with "configuration invalid".
        try await m.loadFromPreferences()
        manager = m
        return m
    }

    func start(includeAllNetworks: Bool) async throws {
        let m = try await prepare(includeAllNetworks: includeAllNetworks, onDemand: true)
        try m.connection.startVPNTunnel()
    }

    /// Explicit disconnect: On Demand off first (or iOS restarts the tunnel at once), then let
    /// sing-box close its connections before the provider stops.
    func stop() async {
        guard let m = manager else { return }
        if m.isOnDemandEnabled {
            m.isOnDemandEnabled = false
            try? await m.saveToPreferences()
        }
        await Task.detached { try? LibboxNewStandaloneCommandClient()?.serviceClose() }.value
        m.connection.stopVPNTunnel()
    }

    /// A user-started connection failed: do not let On Demand loop on it in the background.
    func disableOnDemand() async {
        guard let m = manager, m.isOnDemandEnabled else { return }
        m.isOnDemandEnabled = false
        try? await m.saveToPreferences()
    }

    /// Sign-out: the configuration (and its On Demand rule) leaves the phone.
    func remove() async {
        guard let m = manager else { return }
        m.connection.stopVPNTunnel()
        try? await m.removeFromPreferences()
        manager = nil
    }

    func send(_ message: TunnelMessage) async -> Data? {
        guard let session = manager?.connection as? NETunnelProviderSession, session.status == .connected else { return nil }
        return await withCheckedContinuation { continuation in
            do {
                try session.sendProviderMessage(message.encoded) { continuation.resume(returning: $0) }
            } catch {
                continuation.resume(returning: nil)
            }
        }
    }

    func lastDisconnectError() async -> Error? {
        guard let connection = manager?.connection else { return nil }
        do {
            try await connection.fetchLastDisconnectError()
            return nil
        } catch {
            return error
        }
    }

    private func publish(_ connection: NEVPNConnection) {
        onStatus?(Self.map(connection.status), connection.connectedDate)
    }

    nonisolated static func map(_ status: NEVPNStatus) -> TunnelStatus {
        switch status {
        case .invalid: return .invalid
        case .disconnected: return .disconnected
        case .connecting: return .connecting
        case .connected: return .connected
        case .reasserting: return .reasserting
        case .disconnecting: return .disconnecting
        @unknown default: return .invalid
        }
    }

    static func isPermissionError(_ error: Error) -> Bool {
        let e = error as NSError
        return e.domain == NEVPNErrorDomain && e.code == NEVPNError.Code.configurationReadWriteFailed.rawValue
            || e.domain == "NEConfigurationErrorDomain" && e.code == 10 // permission denied
    }
}

enum TunnelError: Error { case denied }
