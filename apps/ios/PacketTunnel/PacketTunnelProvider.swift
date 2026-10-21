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
    /// The inputs sing-box was last started from and whether a graph runs. A refused rebuild can
    /// leave none running; the heartbeat then says so instead of "on". Guarded by `serviceLock`.
    private var graph = TunnelGraph()
    #if os(iOS)
    private var screenObserver: ScreenStateObserver?
    #endif
    private let reloadQueue = DispatchQueue(label: "tono.tunnel.reload")
    /// One start/reload at a time: app messages, IPv6 changes and core requests can overlap.
    private let serviceLock = NSLock()
    /// Serialises this process's status writes (heartbeat timer, app reloads, start and stop).
    private let statusLock = NSLock()
    /// The tunnel's part of the shared status (`TunnelReport`), the only routing fact widgets and the
    /// Control Center switch state as current: written at start and stop, after every graph change
    /// and status question, and every `StatusSnapshot.heartbeat` so readers can tell a live tunnel
    /// from an old file.
    private var startedAt: Date?
    private var heartbeat: DispatchSourceTimer?
    /// Set when sing-box stopped its own service (`coreStopped`): from then on every record and
    /// answer says no graph runs. Its own lock, so the core's callback never waits on `serviceLock`.
    private let stopLock = NSLock()
    private var coreStopCode: String?

    override init() {
        LibboxPrepareCrashSignalHandlers()
        super.init()
        LibboxReinstallCrashSignalHandlers()
    }

    override func startTunnel(options: [String: NSObject]?) async throws {
        // A new session: nothing an earlier start said is about this one.
        serviceLock.lock()
        graph = TunnelGraph()
        serviceLock.unlock()
        stopLock.lock()
        coreStopCode = nil
        stopLock.unlock()
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
        timer.setEventHandler { [weak self] in _ = self?.writeStatus(running: true) }
        timer.resume()
        heartbeat = timer
        Self.log.info("tunnel started")
    }

    /// Not called with `serviceLock` held. One tunnel write at a time, each with the graph as it is
    /// when it writes: a heartbeat that read the graph before a reload cannot land after the reload's
    /// own write. The file lock is taken only after the graph is read, never while a reload runs.
    /// Returns the answer for the graph it wrote.
    @discardableResult
    private func writeStatus(running: Bool) -> TunnelAnswer {
        statusLock.lock()
        defer { statusLock.unlock() }
        serviceLock.lock()
        let current = graph
        serviceLock.unlock()
        let since = startedAt
        let now = Date()
        let stopped = coreStop()
        let failure = running ? nil : SharedFiles.loadFailure()?.code
        let report = current.report(process: running, since: since, failure: failure, now: now, coreStopped: stopped)
        if StatusStore.update({ ($0 ?? SharedStatus()).writingTunnel(report) }) { StatusReload.all() }
        return current.answer(since: since, now: now, coreStopped: stopped)
    }

    private func coreStop() -> String? {
        stopLock.lock()
        defer { stopLock.unlock() }
        return coreStopCode
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
            // Not `reasserting`: the app asked for this rebuild, the network did not change.
            let (reply, answer) = reloadFromApp()
            writeStatus(running: true)
            return reply.encoded(answer: answer)
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
            // The tunnel renews its own record when asked; the reply carries the same answer.
            let answer = writeStatus(running: true)
            return Data(JSON.obj(
                ("core", .string(LibboxVersion())),
                ("ipv6", .bool(underlying.hasGlobalIPv6)),
                ("path", .string(underlying.summary)),
                ("running", answer.routing?.json ?? .null),
                ("tunnel", answer.json)
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
    /// `reloadInputs` re-reads the App Group file (start); IPv6 and core reloads rebuild from the
    /// inputs already in memory.
    private func startService(reloadInputs: Bool = false) throws {
        serviceLock.lock()
        defer { serviceLock.unlock() }
        let next: TunnelInputs
        if !reloadInputs, let held = graph.inputs {
            next = held
        } else {
            do {
                next = try SharedFiles.loadInputs()
            } catch {
                throw CatalogRejected("NO_INPUTS", "tunnel inputs are missing or unreadable: \(error)")
            }
        }
        try graph.run(next, build: build, start: start)
    }

    /// Admission and the config build fail before libbox is touched: a running graph stays intact.
    private func build(_ inputs: TunnelInputs) throws -> String {
        try inputs.makeConfig(underlyingIPv6: underlying.hasGlobalIPv6, cacheFilePath: SharedFiles.cacheDB.path)
    }

    /// libbox's StartOrReloadService closes the running graph before it builds this one.
    private func start(_ config: String) throws {
        guard let commandServer else { throw CatalogRejected("NO_INPUTS", "no command server") }
        try commandServer.startOrReloadService(config, options: LibboxOverrideOptions())
    }

    /// The app changed the mode or line. Answers with what actually runs afterwards, so the app
    /// never shows a graph this process did not start; on a refusal the inputs file goes back to
    /// the graph that last ran (`TunnelGraph.reload`). The answer is taken under the same lock, so
    /// it names the graph the reply is about.
    private func reloadFromApp() -> (ReloadReply, TunnelAnswer) {
        serviceLock.lock()
        defer { serviceLock.unlock() }
        let reply = graph.reload(load: { try SharedFiles.loadInputs() }, build: build, start: start, persist: { inputs in
            do {
                try SharedFiles.saveInputs(inputs)
            } catch {
                Self.log.error("put back inputs: \(error.localizedDescription, privacy: .public)")
            }
        })
        if case .refused(let code, let running) = reply {
            Self.log.error("reload refused \(code, privacy: .public); graph running: \(running != nil, privacy: .public)")
        }
        return (reply, graph.answer(since: startedAt, now: Date(), coreStopped: coreStop()))
    }

    private func currentInputs() -> TunnelInputs? {
        serviceLock.lock()
        defer { serviceLock.unlock() }
        return graph.inputs
    }

    func stopService() {
        serviceLock.lock()
        graph.closed()
        serviceLock.unlock()
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
            // A failed in-place rebuild can leave no graph: widgets hear it now, not at the next beat.
            self.writeStatus(running: true)
        }
    }

    /// sing-box stopped its own service (fatal error inside the core). Nothing runs from now on: the
    /// latch makes every later record and answer say so, and the stop is written to the shared status
    /// before the tunnel is cancelled (iOS ends the process in its own time). Written from the reload
    /// queue so this callback never waits on `serviceLock`, which its caller may hold.
    func coreStopped() {
        SharedFiles.recordFailure(TunnelFailure(code: "CORE_STOPPED", message: "sing-box stopped the service", at: Date()))
        stopLock.lock()
        coreStopCode = "CORE_STOPPED"
        stopLock.unlock()
        reloadQueue.async { [weak self] in
            guard let self else { return }
            self.writeStatus(running: false)
            self.cancelTunnelWithError(NSError(domain: "Tono", code: 2, userInfo: [NSLocalizedDescriptionKey: "sing-box stopped"]))
        }
    }

    private func fail(_ code: String, _ message: String) -> Error {
        Self.log.error("start failed \(code, privacy: .public): \(message, privacy: .public)")
        SharedFiles.recordFailure(TunnelFailure(code: code, message: message, at: Date()))
        writeStatus(running: false)
        return NSError(domain: "Tono", code: 3, userInfo: [NSLocalizedDescriptionKey: "\(code): \(message)"])
    }
}
