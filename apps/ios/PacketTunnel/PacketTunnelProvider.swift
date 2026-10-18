import Foundation
import Libbox
import NetworkExtension
import TonoKit
import os.log

/// Tono's packet tunnel: sing-box (libbox, pinned v1.15.0-alpha.12) behind NEPacketTunnelProvider.
///
/// The app writes `TunnelInputs` to the App Group and starts the tunnel; this process re-admits
/// the catalog, builds the sing-box graph (TonoKit `SingBoxConfig`, same graph as Android) and
/// runs it. On Demand restarts after a crash, jetsam or reboot read the same inputs, so matched
/// traffic is held while the tunnel comes back instead of leaving the phone directly. The
/// extension holds no account tokens and never contacts the control plane.
final class PacketTunnelProvider: NEPacketTunnelProvider {
    static let log = Logger(subsystem: "com.raydocs.tono.ios", category: "tunnel")

    private var commandServer: LibboxCommandServer?
    private lazy var platform = TunnelPlatform(provider: self)
    private let underlying = UnderlyingNetwork()
    private var inputs: TunnelInputs?
    #if os(iOS)
    private var screenObserver: ScreenStateObserver?
    #endif
    private let reloadQueue = DispatchQueue(label: "tono.tunnel.reload")
    /// One start/reload at a time: app messages, IPv6 changes and core requests can overlap.
    private let serviceLock = NSLock()
    /// Shared status for widgets and the Control Center switch: written at start and stop, and
    /// refreshed every `StatusSnapshot.heartbeat` so readers can tell a live tunnel from an old file.
    private var startedAt: Date?
    private var heartbeat: DispatchSourceTimer?

    override init() {
        LibboxPrepareCrashSignalHandlers()
        super.init()
        LibboxReinstallCrashSignalHandlers()
    }

    override func startTunnel(options: [String: NSObject]?) async throws {
        SharedFiles.clearFailure()
        underlying.start()
        do {
            try setUpLibbox()
        } catch {
            throw fail("CORE_START", "libbox setup: \(error.localizedDescription)")
        }
        do {
            try startService(reloadInputs: true)
        } catch let e as CatalogRejected {
            stopService()
            throw fail(e.code, e.message)
        } catch {
            stopService()
            throw fail("CORE_START", error.localizedDescription)
        }
        underlying.onIPv6Change = { [weak self] _ in self?.reloadInPlace(reason: "underlying IPv6 changed") }
        #if os(iOS)
        if let commandServer { screenObserver = ScreenStateObserver(commandServer: commandServer) }
        #endif
        startedAt = Date()
        writeStatus(running: true)
        let timer = DispatchSource.makeTimerSource(queue: reloadQueue)
        timer.schedule(deadline: .now() + StatusSnapshot.heartbeat, repeating: StatusSnapshot.heartbeat, leeway: .seconds(30))
        timer.setEventHandler { [weak self] in self?.writeStatus(running: true) }
        timer.resume()
        heartbeat = timer
        Self.log.info("tunnel started")
    }

    private func writeStatus(running: Bool) {
        let failure = running ? nil : SharedFiles.loadFailure()?.code
        let snapshot = StatusSnapshot.fromTunnel(running: running, since: startedAt, failure: failure,
                                                 previous: StatusStore.load(), now: Date())
        if StatusStore.save(snapshot) { StatusReload.all() }
    }

    override func stopTunnel(with reason: NEProviderStopReason) async {
        Self.log.info("tunnel stopping, reason \(reason.rawValue, privacy: .public)")
        #if os(iOS)
        screenObserver?.cancel()
        screenObserver = nil
        #endif
        underlying.onIPv6Change = nil
        stopService()
        if let server = commandServer {
            try? await Task.sleep(nanoseconds: 100_000_000)
            server.close()
            commandServer = nil
        }
        underlying.stop()
        heartbeat?.cancel()
        heartbeat = nil
        defer { writeStatus(running: false); startedAt = nil }
        // Stops the system did not ask the user about are worth explaining in the app.
        switch reason {
        case .userInitiated, .providerDisabled, .configurationDisabled, .configurationRemoved, .superceded,
             .userLogout, .userSwitch, .appUpdate, .none:
            break
        default:
            SharedFiles.recordFailure(TunnelFailure(code: "CORE_STOPPED", message: "stopped by the system (\(reason.rawValue))", at: Date()))
        }
    }

    override func handleAppMessage(_ messageData: Data) async -> Data? {
        switch TunnelMessage.decode(messageData) {
        case .reload:
            do {
                reasserting = true
                defer { reasserting = false }
                try startService(reloadInputs: true)
                return nil
            } catch {
                // The previous graph keeps running; matched traffic keeps its old routes.
                return Data("reload failed: \(error)".utf8)
            }
        case .measure:
            var nodes: [VlessNode] = []
            if let body = currentInputs()?.catalogBody, let catalog = try? CatalogAdmission.admit(JSON.parse(body)) {
                nodes = catalog.cloudNodes
            }
            let results = await NodeLatency.measure(nodes)
            var reply = JSONObject()
            for (name, ms) in results { reply[name] = ms.map { JSON.int($0) } ?? .null }
            return Data(JSON.object(reply).serialized().utf8)
        case .status:
            return Data(JSON.obj(
                ("core", .string(LibboxVersion())),
                ("ipv6", .bool(underlying.hasGlobalIPv6)),
                ("path", .string(underlying.summary))
            ).serialized().utf8)
        case nil:
            return Data("unknown message".utf8)
        }
    }

    override func sleep() async {
        commandServer?.pause()
    }

    override func wake() {
        commandServer?.wake()
    }

    // MARK: - libbox

    private func setUpLibbox() throws {
        guard commandServer == nil else { return }
        let options = LibboxSetupOptions()
        options.basePath = SharedFiles.boxBase.path
        options.workingPath = SharedFiles.boxWorking.path
        options.tempPath = SharedFiles.boxTemp.path
        options.logMaxLines = 300
        #if DEBUG
        options.debug = true
        #endif
        options.crashReportSource = "tono-ios-tunnel"
        options.appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        options.appMarketingVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        // The packet tunnel has a ~50 MB jetsam limit; let sing-box shed connections before iOS kills it.
        options.oomKillerEnabled = true
        var error: NSError?
        LibboxSetup(options, &error)
        if let error { throw error }
        let server = LibboxNewCommandServer(platform, platform, &error)
        if let error { throw error }
        guard let server else { throw NSError(domain: "Tono", code: 1, userInfo: [NSLocalizedDescriptionKey: "no command server"]) }
        try server.start()
        commandServer = server
    }

    /// Builds the graph from the current inputs and starts (or hot-reloads) sing-box.
    /// `reloadInputs` re-reads the App Group file (start and app-requested reloads); IPv6 and core
    /// reloads rebuild from the inputs already in memory.
    private func startService(reloadInputs: Bool = false) throws {
        serviceLock.lock()
        defer { serviceLock.unlock() }
        if reloadInputs || inputs == nil {
            do {
                inputs = try SharedFiles.loadInputs()
            } catch {
                throw CatalogRejected("NO_INPUTS", "tunnel inputs are missing or unreadable: \(error)")
            }
        }
        guard let inputs, let commandServer else { throw CatalogRejected("NO_INPUTS", "no inputs") }
        let config = try inputs.makeConfig(underlyingIPv6: underlying.hasGlobalIPv6, cacheFilePath: SharedFiles.cacheDB.path)
        try commandServer.startOrReloadService(config, options: LibboxOverrideOptions())
    }

    private func currentInputs() -> TunnelInputs? {
        serviceLock.lock()
        defer { serviceLock.unlock() }
        return inputs
    }

    func stopService() {
        do {
            try commandServer?.closeService()
        } catch {
            Self.log.error("close service: \(error.localizedDescription, privacy: .public)")
        }
        platform.reset()
    }

    /// sing-box asked to reload (command client) or the underlying IPv6 changed.
    func reloadInPlace(reason: String) {
        reloadQueue.async { [weak self] in
            guard let self else { return }
            Self.log.info("reloading: \(reason, privacy: .public)")
            self.reasserting = true
            defer { self.reasserting = false }
            do {
                try self.startService()
            } catch {
                Self.log.error("reload failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// sing-box stopped its own service (fatal error inside the core).
    func coreStopped() {
        SharedFiles.recordFailure(TunnelFailure(code: "CORE_STOPPED", message: "sing-box stopped the service", at: Date()))
        cancelTunnelWithError(NSError(domain: "Tono", code: 2, userInfo: [NSLocalizedDescriptionKey: "sing-box stopped"]))
    }

    private func fail(_ code: String, _ message: String) -> Error {
        Self.log.error("start failed \(code, privacy: .public): \(message, privacy: .public)")
        SharedFiles.recordFailure(TunnelFailure(code: code, message: message, at: Date()))
        writeStatus(running: false)
        return NSError(domain: "Tono", code: 3, userInfo: [NSLocalizedDescriptionKey: "\(code): \(message)"])
    }
}
