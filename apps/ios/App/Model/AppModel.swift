import Foundation
import Libbox
import Network
import SwiftUI
import TonoKit
import UIKit

/// One cloud line as the UI shows it: only nodes from the admitted catalog, never invented.
struct LineItem: Identifiable, Equatable {
    var id: String { name }
    let name: String
    let city: String
    let label: String
    var latencyMS: Int?
}

enum HomeKind: Equatable { case none, residential, catalogNode(String) }

struct LoginState: Equatable {
    var email = ""
    var challengeID: String?
    var busy = false
    var errorCode: String?
}

/// The app's single source of truth. The tunnel state comes from NEVPNStatus, the exit checks from
/// the app's own requests through the tunnel, failures from the App Group; `ConnectionState.derive`
/// turns them into the one phase every screen reads.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var phase: Phase = .signedOut
    @Published private(set) var reason: String?
    @Published private(set) var lines: [LineItem] = []
    @Published private(set) var homeKind: HomeKind = .none
    @Published private(set) var usingCachedCatalog = false
    @Published private(set) var cloudProbe = ExitProbe()
    @Published private(set) var homeProbe = ExitProbe()
    @Published private(set) var rx: Int64 = 0
    @Published private(set) var tx: Int64 = 0
    @Published private(set) var connectedSince: Date?
    @Published private(set) var underlyingIPv6 = false
    @Published private(set) var coreVersion = ""
    @Published var login = LoginState()
    @Published private(set) var email: String? = Preferences.email
    @Published private(set) var mode: RoutingMode = Preferences.mode
    @Published private(set) var selectedNode: String? = Preferences.selectedNode
    @Published private(set) var includeAllNetworks: Bool = Preferences.includeAllNetworks

    private let session: AccountSession
    private let tokens = KeychainTokenStore()
    private let cache = FileCatalogCache()
    private let tunnel = TunnelController()
    private let traffic = TrafficMonitor()
    private let pathMonitor = NWPathMonitor()
    private var catalog: LoadedCatalog?

    // Facts behind the phase.
    private var signedIn: Bool
    private var preparing = false
    private var tunnelStatus: TunnelStatus = .invalid
    private var failure: String?
    private var permission: String?
    /// Set from "switch on" until the tunnel first reports connected; a stop in between is a start failure.
    private var userStarting = false
    private var userStopping = false
    /// The user's latest switch intent; a switch-off during PREPARING stops the start that is in flight.
    private var wantOn = false
    private var probeTask: Task<Void, Never>?
    #if DEBUG
    fileprivate var previewPhase: (Phase, String?)?
    #endif

    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    init(preview: Bool = false) {
        let client = ControlPlaneClient(clientVersion: Self.appVersion, transport: AppTransport())
        session = AccountSession(api: client, tokens: tokens, cache: cache)
        signedIn = tokens.loadTokens() != nil
        guard !preview else { return }
        Self.setUpLibbox()
        coreVersion = LibboxVersion()
        traffic.onRate = { [weak self] down, up in self?.rx = down; self?.tx = up }
        tunnel.onStatus = { [weak self] status, since in self?.tunnelChanged(status, since: since) }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let v6 = path.status == .satisfied && path.supportsIPv6
            Task { @MainActor in self?.underlyingIPv6 = v6 }
        }
        pathMonitor.start(queue: DispatchQueue(label: "tono.app.path"))
        recompute()
    }

    /// The app reads the extension's command socket from the same App Group base path.
    private static func setUpLibbox() {
        let options = LibboxSetupOptions()
        options.basePath = SharedFiles.boxBase.path
        options.workingPath = SharedFiles.boxWorking.path
        options.tempPath = SharedFiles.boxTemp.path
        options.appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        options.appMarketingVersion = appVersion
        var error: NSError?
        LibboxSetup(options, &error)
    }

    // MARK: - Lifecycle

    func onLaunch() async {
        #if DEBUG
        if previewPhase != nil { return }
        #endif
        await tunnel.load()
        if signedIn { await refreshCatalog(quiet: true) }
        recompute()
    }

    func onForeground() async {
        #if DEBUG
        if previewPhase != nil { return }
        #endif
        await tunnel.load()
        if tunnelStatus == .connected, cloudProbe.state != .checking { runProbes() }
        if !tunnelStatus.isUp, let f = SharedFiles.loadFailure(), failure == nil, !userStopping {
            failure = f.code
            recompute()
        }
    }

    // MARK: - Sign-in

    func sendCode(_ raw: String) async {
        let email = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        login.email = email
        guard AccountSession.isPlausibleEmail(email) else { login.errorCode = "INVALID_EMAIL"; return }
        login.busy = true
        login.errorCode = nil
        defer { login.busy = false }
        do {
            login.challengeID = try await session.startEmail(email, deviceName: Self.deviceName, installationID: Preferences.installationID)
        } catch {
            login.errorCode = AccountErrors.reasonCode(error)
        }
    }

    func verify(_ code: String) async {
        guard let challenge = login.challengeID else { return }
        guard code.count == 6, code.allSatisfy(\.isNumber) else { login.errorCode = "INVALID_CODE"; return }
        login.busy = true
        login.errorCode = nil
        defer { login.busy = false }
        do {
            let reported = try await session.verify(challengeID: challenge, code: code)
            Preferences.email = reported ?? login.email
            email = Preferences.email
            signedIn = true
            failure = nil
            login = LoginState()
            recompute()
            await refreshCatalog(quiet: true)
        } catch {
            login.errorCode = AccountErrors.reasonCode(error)
        }
    }

    func changeEmail() { login.challengeID = nil; login.errorCode = nil }

    func signOut() async {
        probeTask?.cancel()
        traffic.stop()
        userStopping = true
        await tunnel.remove()
        await session.signOut()
        SharedFiles.removeInputs()
        SharedFiles.clearFailure()
        cache.clear()
        Preferences.email = nil
        email = nil
        catalog = nil
        lines = []
        signedIn = false
        failure = nil
        permission = nil
        userStopping = false
        recompute()
    }

    // MARK: - Connect / disconnect

    func connect() async {
        guard signedIn, !phase.busy else { return }
        wantOn = true
        failure = nil
        permission = nil
        SharedFiles.clearFailure()
        preparing = true
        recompute()
        defer { preparing = false; recompute() }
        guard await refreshCatalog(quiet: false), let loaded = catalog, wantOn else { return }
        do {
            try SharedFiles.saveInputs(inputs(for: loaded))
            userStarting = true
            try await tunnel.start(includeAllNetworks: includeAllNetworks)
        } catch TunnelError.denied {
            userStarting = false
            permission = "DENIED"
        } catch {
            userStarting = false
            failure = "CORE_START"
        }
    }

    func disconnect() async {
        wantOn = false
        userStarting = false
        userStopping = tunnelStatus != .disconnected && tunnelStatus != .invalid
        probeTask?.cancel()
        recompute()
        await tunnel.stop()
    }

    func toggle(_ on: Bool) {
        #if DEBUG
        if previewPhase != nil { return }
        #endif
        Task { on ? await connect() : await disconnect() }
    }

    func recheck() { runProbes() }

    // MARK: - Lines and mode

    func select(_ name: String) async {
        guard lines.contains(where: { $0.name == name }) else { return }
        selectedNode = name
        Preferences.selectedNode = name
        await pushInputs()
    }

    func setMode(_ newMode: RoutingMode) async {
        mode = newMode
        Preferences.mode = newMode
        await pushInputs()
    }

    func setIncludeAllNetworks(_ on: Bool) async {
        includeAllNetworks = on
        Preferences.includeAllNetworks = on
        guard tunnel.manager != nil else { return }
        // Takes effect on the next start; iOS does not apply protocol options to a running tunnel.
        _ = try? await tunnel.prepare(includeAllNetworks: on, onDemand: tunnel.manager?.isOnDemandEnabled ?? false)
    }

    func measureLatency() async {
        let results: [String: Int?]
        if tunnelStatus.isUp, let data = await tunnel.send(.measure), let json = try? JSON.parse(data), let obj = json.object {
            var r: [String: Int?] = [:]
            for (name, value) in obj.pairs { r[name] = value.int }
            results = r
        } else if !tunnelStatus.isUp, let nodes = catalog?.catalog.cloudNodes {
            // Tunnel off: the app's own sockets reach the nodes directly.
            results = await NodeLatency.measure(nodes)
        } else {
            return
        }
        lines = lines.map { var l = $0; if let v = results[l.name] { l.latencyMS = v }; return l }
    }

    /// "Where does this site go?" against the graph built from the current catalog and settings.
    func explain(_ host: String) -> RouteAnswer? {
        guard let catalog = catalog?.catalog else { return nil }
        let config = SingBoxConfig.build(ConfigInput(catalog: catalog, selectedCloudNode: selectedNode, mode: mode,
                                                     underlyingIPv6: underlyingIPv6, cacheFilePath: nil))
        return RouteExplainer.answer(config: config, catalog: catalog, host: host)
    }

    // MARK: - Internals

    private func inputs(for loaded: LoadedCatalog) -> TunnelInputs {
        TunnelInputs(catalogBody: loaded.body, mode: mode, selectedNode: selectedNode)
    }

    /// Writes the inputs and asks a running tunnel to rebuild its graph in place.
    private func pushInputs() async {
        guard let loaded = catalog else { return }
        try? SharedFiles.saveInputs(inputs(for: loaded))
        if tunnelStatus.isUp, let reply = await tunnel.send(.reload), !reply.isEmpty {
            // The extension keeps the previous graph running when the new one is refused.
            failure = "CORE_START"
            recompute()
        } else if tunnelStatus.isUp {
            runProbes()
        }
    }

    @discardableResult
    private func refreshCatalog(quiet: Bool) async -> Bool {
        do {
            let loaded = try await session.loadCatalog()
            apply(loaded)
            return true
        } catch {
            if AccountErrors.isSessionEnded(error) {
                await signOut()
                failure = "SESSION_ENDED"
                recompute()
                return false
            }
            if !quiet { failure = AccountErrors.reasonCode(error) }
            return false
        }
    }

    private func apply(_ loaded: LoadedCatalog) {
        catalog = loaded
        usingCachedCatalog = loaded.fromCache
        let previous = Dictionary(uniqueKeysWithValues: lines.map { ($0.name, $0.latencyMS) })
        lines = loaded.catalog.cloudNodes.map { LineItem(name: $0.name, city: $0.city, label: $0.label, latencyMS: previous[$0.name] ?? nil) }
        if selectedNode == nil || !lines.contains(where: { $0.name == selectedNode }) {
            selectedNode = loaded.catalog.defaultCloudNode ?? lines.first?.name
        }
        switch loaded.catalog.home {
        case .socks5: homeKind = .residential
        case .catalogNode(let node): homeKind = .catalogNode(node.city)
        case nil: homeKind = .none
        }
    }

    private func tunnelChanged(_ status: TunnelStatus, since: Date?) {
        let before = tunnelStatus
        tunnelStatus = status
        connectedSince = status.isUp ? since : nil
        switch status {
        case .connected:
            userStarting = false
            traffic.start()
            if before != .connected { runProbes() }
            Task { await readStatus() }
        case .disconnected, .invalid:
            traffic.stop()
            probeTask?.cancel()
            cloudProbe = ExitProbe()
            homeProbe = ExitProbe()
            switch TunnelStop.classify(before: before, userStarting: userStarting, userStopping: userStopping,
                                       recordedFailure: SharedFiles.loadFailure()?.code) {
            case .startFailed(let code):
                failure = code
                Task { await tunnel.disableOnDemand() }
            case .stoppedBySystem(let code):
                failure = code
            case .expected:
                break
            }
            userStarting = false
            userStopping = false
        default:
            break
        }
        recompute()
    }

    private func readStatus() async {
        guard let data = await tunnel.send(.status), let json = try? JSON.parse(data) else { return }
        if let core = json["core"]?.string { coreVersion = core }
        if let v6 = json["ipv6"]?.bool { underlyingIPv6 = v6 }
    }

    private func runProbes() {
        probeTask?.cancel()
        cloudProbe = ExitProbe(state: .checking)
        homeProbe = ExitProbe(state: .checking)
        recompute()
        probeTask = Task { [weak self] in
            let cloud = await Self.probe(Probes.cloudURL)
            guard !Task.isCancelled else { return }
            self?.cloudProbe = cloud
            self?.recompute()
            let home = await Self.probe(Probes.homeURL)
            guard !Task.isCancelled else { return }
            self?.homeProbe = home
            self?.recompute()
        }
    }

    /// One request through the live tunnel (this process's traffic is routed by it).
    private static func probe(_ url: URL) async -> ExitProbe {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.waitsForConnectivity = false
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        let started = Date()
        do {
            let (data, response) = try await session.data(from: url)
            guard response is HTTPURLResponse else { return ExitProbe(state: .failed) }
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            return ExitProbe(state: .ok, location: Probes.location(fromTrace: String(decoding: data.prefix(4096), as: UTF8.self)), latencyMS: ms)
        } catch {
            return ExitProbe(state: .failed)
        }
    }

    private func recompute() {
        let facts = ConnectionFacts(signedIn: signedIn, preparing: preparing, tunnel: tunnelStatus, configured: tunnel.configured,
                                    cloudProbe: cloudProbe, homeProbe: homeProbe, failure: failure, permission: permission)
        var derived = ConnectionState.derive(facts)
        #if DEBUG
        if let previewPhase { derived = (previewPhase.0, previewPhase.1) }
        #endif
        guard derived.phase != phase || derived.reason != reason else { return }
        withAnimation(.easeInOut(duration: 0.22)) {
            phase = derived.phase
            reason = derived.reason
        }
    }

    private static var deviceName: String {
        let name = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return String((name.isEmpty ? "iPhone" : name).prefix(100))
    }
}

#if DEBUG
extension AppModel {
    /// Design preview for screenshots (DEBUG builds only; launch argument `-TonoPreview CONNECTED`).
    /// Shows TonoKit's fictional fixture lines with no account, no network and no tunnel. Release
    /// builds do not contain this code, so a shipped app can never display invented lines.
    static func preview(_ phase: Phase) -> AppModel {
        let m = AppModel(preview: true)
        m.apply(LoadedCatalog(catalog: SampleCatalog.catalog(), body: "", fromCache: false))
        m.lines = m.lines.enumerated().map { var l = $0.element; l.latencyMS = [86, 231][$0.offset % 2]; return l }
        m.email = "preview@example.com"
        m.show(phase)
        return m
    }

    /// `-TonoPreviewCycle`: walks the service states the way a real session moves through them,
    /// so the state-transition motion can be recorded in a simulator.
    static func previewCycle() -> AppModel {
        let m = preview(.idle)
        let script: [(Phase, Double)] = [(.idle, 2), (.preparing, 1.2), (.connecting, 2.4), (.connected, 3.4), (.degraded, 3),
                                          (.connected, 2.6), (.disconnecting, 1.2), (.idle, 2.4), (.connecting, 1.8), (.failed, 3)]
        Task { @MainActor in
            while true {
                for (phase, seconds) in script {
                    m.show(phase)
                    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                }
            }
        }
        return m
    }

    private func show(_ phase: Phase) {
        if phase.tunnelUp {
            connectedSince = connectedSince ?? Date().addingTimeInterval(-47 * 60)
            cloudProbe = ExitProbe(state: .ok, location: "JP", latencyMS: 92)
            homeProbe = phase == .degraded ? ExitProbe(state: .failed) : ExitProbe(state: .ok, location: "US", latencyMS: 210)
            rx = 2_340_000
            tx = 184_000
        } else {
            connectedSince = nil
            cloudProbe = ExitProbe()
            homeProbe = ExitProbe()
            rx = 0
            tx = 0
        }
        let reason: String? = phase == .degraded ? "HOME_UNREACHABLE" : phase == .failed ? "HOME_UNAVAILABLE" : nil
        previewPhase = (phase, reason)
        recompute()
    }
}
#endif

extension TunnelStatus {
    var isUp: Bool { self == .connected || self == .reasserting }
}
