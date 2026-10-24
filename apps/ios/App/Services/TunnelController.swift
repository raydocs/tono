import Foundation
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

    /// One lifecycle for every path in this process that switches the tunnel: the app and the outside
    /// command (widget, Live Activity, Control Center). The latest switch wins, and saves, reloads,
    /// starts and stops run one at a time, so a Cancel is never overwritten by a start still saving.
    static let lifecycle = TunnelStartCoordinator()

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

    /// Tono's saved configuration, if any.
    static func savedConfiguration() async throws -> NETunnelProviderManager? {
        try await NETunnelProviderManager.loadAllFromPreferences().first {
            ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == providerBundleID
        }
    }

    /// Loads the existing configuration without creating one (no system prompt), in turn with the switches.
    func load() async {
        await Self.lifecycle.exclusive {
            manager = try? await Self.savedConfiguration()
        }
        if let manager { publish(manager.connection) } else { onStatus?(.disconnected, nil) }
    }

    var configured: Bool { manager?.isEnabled == true }

    var status: TunnelStatus { manager.map { Self.map($0.connection.status) } ?? .invalid }

    /// Saves the system protection options on Tono's existing configuration, in turn with the switches.
    /// On Demand stays as the latest switch saved it: `onDemand` is the caller's earlier view and is
    /// not written. No configuration is created here (no system prompt for a setting).
    func prepare(includeAllNetworks: Bool, onDemand _: Bool) async throws -> NETunnelProviderManager {
        try await Self.lifecycle.exclusive {
            guard await refresh(), let m = manager else { throw TunnelError.notConfigured }
            try await write(m, includeAllNetworks: includeAllNetworks, onDemand: m.isOnDemandEnabled)
            try await m.loadFromPreferences()
            return m
        }
    }

    /// Starts the tunnel unless a later switch (Cancel, sign-out, an outside command, another start)
    /// takes over before it reaches the system: then nothing starts and `.superseded` returns, no error.
    /// Throws only while this start is still the latest, after taking its On Demand off again.
    @discardableResult
    func start(includeAllNetworks: Bool) async throws -> TunnelStartCoordinator.StartOutcome {
        try await Self.lifecycle.start(Steps(self, includeAllNetworks: includeAllNetworks))
    }

    /// Explicit disconnect: takes over from any start at once; On Demand off first (or iOS restarts the
    /// tunnel at once), then the provider stops (its `stopTunnel` closes sing-box's service).
    func stop() async {
        await Self.lifecycle.stop(Steps(self))
    }

    /// A user-started connection failed: do not let On Demand loop on it in the background. A newer
    /// start on its way keeps its own On Demand.
    func disableOnDemand() async {
        await Self.lifecycle.disarmAfterFailedStart(Steps(self))
    }

    /// Sign-out: the configuration (and its On Demand rule) leaves the phone. Takes over at once.
    func remove() async {
        await Self.lifecycle.remove(Steps(self))
    }

    func send(_ message: TunnelMessage) async -> Data? {
        guard let session = manager?.connection as? NETunnelProviderSession, session.status == .connected else { return nil }
        // Network Extension may never call the handler (a hung or killed tunnel): the question ends
        // at the message's timeout with no answer, and a reply after that is dropped.
        return await ProviderReply.ask(timeout: message.replyTimeout,
                                       schedule: { delay, work in DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work) },
                                       send: { reply in try session.sendProviderMessage(message.encoded) { reply($0) } })
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

    /// Reads the configuration again before acting on it (the outside command saves its own copy), or
    /// finds one this controller has not seen yet.
    private func refresh() async -> Bool {
        if let m = manager {
            try? await m.loadFromPreferences()
        } else {
            manager = try? await Self.savedConfiguration()
        }
        return manager != nil
    }

    /// Writes Tono's configuration and saves it. The first save shows the iOS "Add VPN Configurations"
    /// prompt; declining it throws `TunnelError.denied`.
    private func write(_ m: NETunnelProviderManager, includeAllNetworks: Bool, onDemand: Bool) async throws {
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
    }

    /// The lifecycle's steps on this controller's manager.
    @MainActor
    private final class Steps: TunnelLifecycleSteps {
        private let owner: TunnelController
        /// The start's option; a stop or removal writes no settings.
        private let includeAllNetworks: Bool?

        init(_ owner: TunnelController, includeAllNetworks: Bool? = nil) {
            self.owner = owner
            self.includeAllNetworks = includeAllNetworks
        }

        var onDemandEnabled: Bool { owner.manager?.isOnDemandEnabled == true }

        func refresh() async -> Bool { await owner.refresh() }

        func saveForStart() async throws {
            let m = owner.manager ?? NETunnelProviderManager()
            let current = (m.protocolConfiguration as? NETunnelProviderProtocol)?.includeAllNetworks ?? true
            try await owner.write(m, includeAllNetworks: includeAllNetworks ?? current, onDemand: true)
            // Kept even when a later switch supersedes this start: its stop finds this save and disarms it.
            owner.manager = m
        }

        func reloadForStart() async throws {
            guard let m = owner.manager else { throw TunnelError.notConfigured }
            // Apple: reload after the first save before starting, or the start can fail with "configuration invalid".
            try await m.loadFromPreferences()
        }

        func startTunnel() throws {
            guard let m = owner.manager else { throw TunnelError.notConfigured }
            try m.connection.startVPNTunnel()
        }

        func disarmOnDemand() async {
            guard let m = owner.manager else { return }
            m.isOnDemandEnabled = false
            try? await m.saveToPreferences()
        }

        /// No libbox `serviceClose()` first: sing-box answers it through `serviceStop`, which the
        /// provider must read as the core stopping on its own (CORE_STOPPED), so a user's disconnect
        /// would be shown as a dropped connection. The provider's `stopTunnel` closes the service.
        func stopTunnel() async {
            guard let m = owner.manager else { return }
            m.connection.stopVPNTunnel()
        }

        func removeConfiguration() async {
            guard let m = owner.manager else { return }
            m.connection.stopVPNTunnel()
            try? await m.removeFromPreferences()
            owner.manager = nil
        }
    }
}

enum TunnelError: Error { case denied, notConfigured }
