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

enum RouteCheckResult: Equatable {
    case answer(RouteAnswer)
    case empty, invalid(String), noLines, routesStopped
    /// A switch the tunnel never answered: which routes are in use is not known.
    case unconfirmed
}

/// A mode or line change the tunnel has not (yet) confirmed. The routes on screen stay the ones in
/// effect (`AppModel.mode`, `selectedNode`) until it does.
enum RouteChange: Equatable {
    case pending(RouteSettings)
    case failed(requested: RouteSettings, code: String)
    /// The tunnel answered neither the rebuild nor what it runs: the request may be in effect or
    /// not, so the screens claim neither until a status read settles it.
    case unconfirmed(RouteSettings)

    var requested: RouteSettings {
        switch self {
        case .pending(let s), .failed(let s, _), .unconfirmed(let s): return s
        }
    }
}

struct LoginState: Equatable {
    var email = ""
    var challengeID: String?
    var busy = false
    var errorCode: String?
}

/// The app's single source of truth. The tunnel state comes from NEVPNStatus, what the tunnel runs
/// from the tunnel's own word (`ConfirmationTracker`: its stamped replies and its own report in the
/// shared status, the one the widgets read), the exit checks from the app's own requests through the
/// tunnel against that confirmed graph, failures from the App Group; `AppStatus.resolve` turns them
/// into the one phase every screen reads, and its note carries the same result to the widgets, the
/// control and the Live Activity. Nothing positive is claimed without the tunnel's word.
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
    /// The mode and line chosen: what the tunnel last confirmed while it runs, or saved for the next
    /// start when it is off. Screens state them as in use only through `routing` (`currentLine`,
    /// `routesUnconfirmed`), never a request.
    @Published private(set) var mode: RoutingMode = Preferences.mode
    @Published private(set) var selectedNode: String? = Preferences.selectedNode
    @Published private(set) var routeChange: RouteChange?
    /// What the tunnel confirmed it runs, while that still counts; nil while it is not up (the saved
    /// choice is then what the next start builds).
    @Published private(set) var routing: RoutingConfirmation?
    /// The tunnel's stamped answers for the Network Extension session the app sees.
    private var tracker = ConfirmationTracker()
    /// The last resolution (`recompute`): the shared status note is written from it.
    private var resolved: AppStatus?
    /// The exit checks and the confirmed graph they run against.
    private var checks = ExitChecks()
    /// Asks the tunnel again before its answer stops counting.
    private var reconfirmTask: Task<Void, Never>?
    /// Resolves again when the confirmation held expires, whether or not anything else happens.
    private var expiryTask: Task<Void, Never>?
    private var expiryAt: Date?
    /// The inputs file should hold these (the routes in use) but the put-back after a refusal failed.
    /// Retried on the next change, foreground and connect; said in the change's note meanwhile.
    @Published private(set) var unsavedRoutes: RouteSettings?
    @Published private(set) var includeAllNetworks: Bool = Preferences.includeAllNetworks
    /// Changed while the tunnel is on: iOS applies it only when the tunnel next starts, so the running
    /// tunnel still uses the previous value until then.
    @Published private(set) var includeAllPending = false
    @Published private(set) var liveActivityEnabled: Bool = Preferences.liveActivity
    /// First run: the one-screen introduction before sign-in.
    @Published private(set) var showOnboarding: Bool = !Preferences.onboarded
    /// Shown before the first iOS "Add VPN Configurations" prompt (and after a declined one).
    @Published var showVPNPrimer = false
    /// No usable network path right now (shown under the title; connecting stays possible).
    @Published private(set) var offline = false
    /// The catalog request in flight (the line picker shows a loading state instead of "no lines").
    @Published private(set) var catalogLoading = false

    private let session: AccountSession
    private let tokens = KeychainTokenStore()
    private let cache = FileCatalogCache()
    private let tunnel = TunnelController()
    private let traffic = TrafficMonitor()
    private let pathMonitor = NWPathMonitor()
    private let liveActivity = LiveActivityController()
    /// The primer was answered for the start in progress.
    private var primerConfirmed = false
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
    fileprivate var previewRun: Task<Void, Never>?
    fileprivate var previewFailuresLeft = 0
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
            let offline = path.status != .satisfied
            Task { @MainActor in
                self?.underlyingIPv6 = v6
                if self?.offline != offline { self?.offline = offline }
            }
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
        if previewPhase != nil {
            // A Live Activity can only start from the foreground: the preview one starts after launch.
            if CommandLine.arguments.contains("-TonoPreviewLiveActivity") {
                try? await Task.sleep(nanoseconds: 800_000_000)
                publishStatus(force: true)
            }
            return
        }
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
        // The tunnel's own report on file first (it may say ROUTES_STOPPED, or a newer beat), then
        // ask it what runs: the phase from before the app was suspended may be older than both.
        recompute()
        if tunnelStatus == .connected { await readStatus() }
        publishStatus(force: true)
        if tunnelStatus == .connected, cloudProbe.state != .checking { runProbes() }
        retryPutBack()
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
        if isPreview { return }
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
        // Retry after a refused rebuild left the running tunnel without routes: rebuild in place.
        if routesStopped, tunnelStatus.isUp {
            await change(routeSettings, retry: true)
            return
        }
        // Before iOS asks to add the VPN configuration, say what it is and why (once per ask).
        if !tunnel.configured && !primerConfirmed {
            showVPNPrimer = true
            return
        }
        primerConfirmed = false
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
            unsavedRoutes = nil
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
        if previewPhase != nil { previewToggle(on); return }
        #endif
        Task { on ? await connect() : await disconnect() }
    }

    /// The primer's Continue: go on to the iOS prompt.
    func confirmVPNPrimer() {
        showVPNPrimer = false
        primerConfirmed = true
        toggle(true)
    }

    func dismissVPNPrimer() {
        showVPNPrimer = false
        primerConfirmed = false
    }

    func finishOnboarding() {
        showOnboarding = false
        if !isPreview { Preferences.onboarded = true }
    }

    func setLiveActivity(_ on: Bool) {
        liveActivityEnabled = on
        if isPreview { return }
        Preferences.liveActivity = on
        publishStatus(force: true)
    }

    /// The line picker's "Try again" when the catalog could not be loaded.
    func reloadLines() async {
        if isPreview { return }
        await refreshCatalog(quiet: false)
        recompute()
    }

    func recheck() {
        if isPreview { return }
        runProbes()
    }

    /// DEBUG design preview: fixture data, nothing persisted, no network, no tunnel.
    var isPreview: Bool {
        #if DEBUG
        return previewPhase != nil
        #else
        return false
        #endif
    }

    // MARK: - Lines and mode

    /// The tunnel is up but its graph was closed by a refused rebuild and could not be restored.
    var routesStopped: Bool { routing == .noGraph }

    /// The line in use: the confirmed one while the tunnel is up (nil when nothing is confirmed, or
    /// the confirmed node is not in the catalog: never another line in its place), else the choice.
    var currentLine: LineItem? {
        let name: String?
        switch routing {
        case nil: name = selectedNode
        case .graph(let s)?: name = s.node
        case .noGraph?, .unknown?: return nil
        }
        return lines.first { $0.name == name }
    }

    func select(_ name: String) async {
        guard lines.contains(where: { $0.name == name }) else { return }
        await change(RouteSettings(mode: mode, node: name))
    }

    func setMode(_ newMode: RoutingMode) async {
        await change(RouteSettings(mode: newMode, node: selectedNode))
    }

    var routeSettings: RouteSettings { RouteSettings(mode: mode, node: selectedNode) }

    var changingRoutes: Bool { if case .pending = routeChange { return true }; return false }

    /// The mode (`\.mode`) or line (`\.node`) a switch is waiting on or that was never confirmed;
    /// nil when that part is settled.
    func unsettled<T: Equatable>(_ part: KeyPath<RouteSettings, T>) -> (value: T, pending: Bool)? {
        switch routeChange {
        case .pending(let r) where r[keyPath: part] != routeSettings[keyPath: part]: return (r[keyPath: part], true)
        case .unconfirmed(let r) where r[keyPath: part] != routeSettings[keyPath: part]: return (r[keyPath: part], false)
        default: return nil
        }
    }

    /// A switch the tunnel never answered, or a running tunnel that has not confirmed (or no longer
    /// confirms) its graph, or one that confirmed none runs: no mode or line is in use that a screen
    /// could state, and the saved choice never stands in for one.
    var routesUnconfirmed: Bool {
        if case .unconfirmed = routeChange { return true }
        return routing == .unknown || routing == .noGraph
    }

    /// Mode and line changes. The screens show the request as pending and keep describing the
    /// routes in effect until the tunnel confirms; a refusal is said where the change was made and
    /// on Home, and the in-effect routes stay as they are.
    private func change(_ requested: RouteSettings, retry: Bool = false) async {
        let previous = routeSettings
        // After an unconfirmed switch either choice is a real request, including the previous one.
        guard !changingRoutes, retry || routesUnconfirmed || requested != previous else { return }
        routeChange = .pending(requested)
        let report: RouteApplyReport
        #if DEBUG
        if isPreview {
            report = await previewApply(requested, previous: previous)
            finish(report, requested: requested)
            return
        }
        #endif
        retryPutBack()
        // The tunnel's reply to this switch (or its silence) replaces what it said before, unless
        // the session ended while it was asked.
        let ticket = tunnelStatus.isUp ? tracker.ask() : nil
        if let loaded = catalog {
            let tunnel = self.tunnel
            report = await RouteApply.run(requested, previous: previous, tunnelUp: ticket != nil,
                                          save: { try SharedFiles.saveInputs(TunnelInputs(catalogBody: loaded.body, mode: $0.mode, selectedNode: $0.node)) },
                                          reload: { await tunnel.send(.reload) },
                                          status: { await tunnel.send(.status) },
                                          acceptReply: { [weak self] answer in
                                              guard let self else { return false }
                                              return self.tracker.permits(RouteApplyReport(.unconfirmed(requested), answer: answer), ticket: ticket)
                                          })
        } else {
            // No catalog yet, so no tunnel to rebuild: the choice is kept for the first start.
            report = RouteApplyReport(.saved(requested))
        }
        // Asked of a session that has since ended, or answered about an older graph than one heard
        // since: the reply says nothing about what runs now, so it moves neither the routes, the
        // pending change nor the put-back. What the tunnel says now decides (`recompute`).
        guard tracker.settle(report, ticket: ticket) else {
            routeChange = nil
            recompute()
            return
        }
        finish(report, requested: requested)
    }

    /// Asks the tunnel again what it runs (2, 5 and 10 s later) instead of waiting for the next
    /// foreground or connection event.
    private func settleUnconfirmed() {
        if isPreview { return }
        Task { [weak self] in
            for delay: UInt64 in [2, 5, 10] {
                try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
                guard let self, self.routesUnconfirmed, self.tunnelStatus.isUp else { return }
                await self.readStatus()
            }
        }
    }

    /// Writes the routes in use back to the inputs file after an earlier put-back failed.
    private func retryPutBack() {
        guard let s = unsavedRoutes, !isPreview, let loaded = catalog else { return }
        if (try? SharedFiles.saveInputs(TunnelInputs(catalogBody: loaded.body, mode: s.mode, selectedNode: s.node))) != nil {
            unsavedRoutes = nil
        }
    }

    private func finish(_ report: RouteApplyReport, requested: RouteSettings) {
        unsavedRoutes = report.owed(before: unsavedRoutes)
        let outcome = report.outcome
        #if DEBUG
        // The preview has no tunnel: its injected replies stand for the tunnel's answer.
        if isPreview, phase.tunnelUp || routing != nil {
            switch outcome {
            case .applied(let s): routing = .graph(s)
            case .notApplied(let code, let inEffect) where code != "SAVE_FAILED": routing = inEffect.map(RoutingConfirmation.graph) ?? .noGraph
            case .unconfirmed: routing = .unknown
            default: break
            }
        }
        #endif
        switch outcome {
        case .applied(let s), .saved(let s):
            setInEffect(s)
            routeChange = nil
            if case .applied = outcome, !isPreview { runProbes() } else { recompute() }
        case .notApplied(let code, let inEffect):
            if let inEffect { setInEffect(inEffect) }
            routeChange = .failed(requested: requested, code: code)
            recompute()
            #if DEBUG
            if previewPhase != nil, routesStopped { previewPhase = (.failed, "ROUTES_STOPPED"); recompute() }
            #endif
            if let note = routeNote(full: true) { UIAccessibility.post(notification: .announcement, argument: note) }
        case .unconfirmed:
            routeChange = .unconfirmed(requested)
            recompute()
            settleUnconfirmed()
            if let note = routeNote(full: true) { UIAccessibility.post(notification: .announcement, argument: note) }
        }
    }

    private func setInEffect(_ s: RouteSettings) {
        mode = s.mode
        if lines.contains(where: { $0.name == s.node }) || s.node == nil { selectedNode = s.node }
        if isPreview { return }
        Preferences.mode = mode
        Preferences.selectedNode = selectedNode
    }

    /// "Couldn't switch to Stable" (short, Home) or with what is still in use (full, the sheets);
    /// "Couldn't confirm …" when the tunnel never answered. Nothing once what runs is what was asked.
    func routeNote(full: Bool) -> String? {
        let line = { (name: String?) in self.lines.first { $0.name == name }.map(self.displayName) ?? name ?? "" }
        let unsaved = full && unsavedRoutes != nil ? " " + L.t("route_unsaved") : ""
        switch routeChange {
        case .unconfirmed(let requested):
            let want = requested.mode != mode ? ModeText.name(requested.mode) : line(requested.node)
            return L.t("route_unconfirmed", want) + unsaved
        case .failed(let requested, _) where requested != routeSettings:
            if requested.mode != mode {
                let want = ModeText.name(requested.mode), have = ModeText.name(mode)
                return (full && !routesStopped ? L.t("route_not_applied_full", want, have) : L.t("route_not_applied", want)) + unsaved
            }
            // "Still using" names only a line the tunnel confirmed and the catalog lists.
            if full, !routesStopped, let have = currentLine.map(displayName) {
                return L.t("route_not_applied_full", line(requested.node), have) + unsaved
            }
            return L.t("route_not_applied", line(requested.node)) + unsaved
        default:
            return nil
        }
    }

    func setIncludeAllNetworks(_ on: Bool) async {
        includeAllNetworks = on
        includeAllPending = phase.switchOn
        if isPreview { return }
        Preferences.includeAllNetworks = on
        guard tunnel.manager != nil else { return }
        // Takes effect on the next start; iOS does not apply protocol options to a running tunnel.
        // `tunnel.start` passes the value again, so a failed save here is repaired by the next start.
        _ = try? await tunnel.prepare(includeAllNetworks: on, onDemand: tunnel.manager?.isOnDemandEnabled ?? false)
    }

    func measureLatency() async {
        if isPreview { return }
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

    /// The route check's result for what was typed: an answer, or why there is none.
    func check(_ input: String) -> RouteCheckResult {
        let typed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if typed.isEmpty { return .empty }
        guard RouteExplainer.cleanHost(typed) != nil else { return .invalid(typed) }
        // No graph runs: no rule-based answer would describe this phone right now.
        if routesStopped { return .routesStopped }
        // Which graph runs is not known: an answer from either mode's rules could be wrong.
        if routesUnconfirmed { return .unconfirmed }
        let settings: RouteSettings
        switch routing {
        case nil: settings = routeSettings
        case .graph(let s)?:
            // A confirmed line this catalog does not list: its rules are not here to answer from.
            guard s.node == nil || lines.contains(where: { $0.name == s.node }) else { return .unconfirmed }
            settings = s
        case .noGraph?, .unknown?: return .unconfirmed
        }
        guard let answer = explain(typed, settings) else { return .noLines }
        return .answer(answer)
    }

    /// "Where does this site go?" against the graph built from the current catalog and the routes in
    /// use (confirmed by the running tunnel, or the choice for the next start).
    func explain(_ host: String, _ settings: RouteSettings) -> RouteAnswer? {
        guard let catalog = catalog?.catalog else { return nil }
        let config = SingBoxConfig.build(ConfigInput(catalog: catalog, selectedCloudNode: settings.node, mode: settings.mode,
                                                     underlyingIPv6: underlyingIPv6, cacheFilePath: nil))
        return RouteExplainer.answer(config: config, catalog: catalog, host: host)
    }

    // MARK: - Internals

    private func inputs(for loaded: LoadedCatalog) -> TunnelInputs {
        TunnelInputs(catalogBody: loaded.body, mode: mode, selectedNode: selectedNode)
    }

    @discardableResult
    private func refreshCatalog(quiet: Bool) async -> Bool {
        catalogLoading = true
        defer { catalogLoading = false }
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
        // Any change of Network Extension's session (a stop, a start, a reconnect, reasserting, a new
        // connected date) makes what the tunnel said before about another moment: ask again.
        if status != before || (status.isUp ? since : nil) != connectedSince {
            tracker.sessionEnded()
            reconfirmTask?.cancel()
            probeTask?.cancel()
        }
        tunnelStatus = status
        connectedSince = status.isUp ? since : nil
        switch status {
        case .connected:
            userStarting = false
            traffic.start()
            // The exit checks start once the tunnel confirms a graph (`recompute`).
            Task { await readStatus() }
        case .disconnected, .invalid:
            includeAllPending = false
            if case .failed = routeChange { routeChange = nil }
            // Stopped before it answered: the file holds the request, so the next start builds it.
            if case .unconfirmed(let requested) = routeChange { setInEffect(requested); routeChange = nil }
            traffic.stop()
            probeTask?.cancel()
            checks = ExitChecks()
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

    /// Asks the tunnel what it runs. Its stamped answer becomes the confirmation; no answer to the
    /// latest question (the reply's timeout included) clears it; a reply to a question asked before
    /// the session changed is dropped.
    private func readStatus() async {
        let ticket = tracker.ask()
        let data = await tunnel.send(.status)
        let json = data.flatMap { try? JSON.parse($0) }
        if let core = json?["core"]?.string { coreVersion = core }
        if let v6 = json?["ipv6"]?.bool { underlyingIPv6 = v6 }
        tracker.received(TunnelAnswer.decode(data), ticket: ticket)
        recompute()
        scheduleReconfirm()
    }

    /// What the tunnel confirmed becomes the routes in use (and the choice for the next start), and
    /// settles a switch it never answered. A switch in flight is settled by its own reply.
    private func adoptConfirmed(_ routing: RoutingConfirmation?) {
        guard !changingRoutes, let routing, routing != .unknown else { return }
        var settings: RouteSettings?
        if case .graph(let s) = routing { settings = s }
        if case .unconfirmed(let requested) = routeChange {
            if settings != requested {
                // The unanswered switch did not take: say so, and keep the file on what runs.
                routeChange = .failed(requested: requested, code: "NO_REPLY")
                if let settings { unsavedRoutes = settings; retryPutBack() }
            } else {
                routeChange = nil
            }
        }
        if let settings, settings != routeSettings { setInEffect(settings) }
    }

    /// At the held confirmation's expiry the app resolves again, so it turns into "not confirmed"
    /// on time even when no reply, report or other event comes.
    private func scheduleExpiry() {
        let now = Date()
        let at = tunnelStatus.isUp ? tracker.expiresAt.flatMap { $0 > now ? $0 : nil } : nil
        guard at != expiryAt else { return }
        expiryTask?.cancel()
        expiryAt = at
        guard let at else { return }
        expiryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64((at.timeIntervalSince(now) + 1) * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            self.expiryAt = nil
            self.recompute()
        }
    }

    /// While the tunnel is up, ask again before the answer held stops counting, so an answer that
    /// expires (or a tunnel that stopped answering) turns into "not confirmed" on its own.
    private func scheduleReconfirm() {
        reconfirmTask?.cancel()
        guard tunnelStatus.isUp, !isPreview else { return }
        reconfirmTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(StatusSnapshot.heartbeat * 1_000_000_000))
            guard let self, !Task.isCancelled, self.tunnelStatus.isUp else { return }
            await self.readStatus()
        }
    }

    /// Runs the exit checks again against the graph confirmed now; with none confirmed there is
    /// nothing they could certify.
    private func runProbes() {
        guard tunnelStatus.isUp, let graph = tracker.stamp(now: Date()) else { return }
        startProbes(for: graph)
        recompute()
    }

    /// A confirmed graph the exit checks have not run against yet (first confirmation, a rebuild, a
    /// restart or a reconnect) gets its own.
    private func startChecksIfNeeded(now: Date) {
        guard tunnelStatus.isUp, let graph = tracker.stamp(now: now), graph != checks.graph else { return }
        startProbes(for: graph)
    }

    /// Results land only while the checks are still those of `graph`: an older run cannot certify a
    /// graph confirmed since (`AppStatus.resolve` also ignores checks of any other graph).
    private func startProbes(for graph: GraphStamp) {
        probeTask?.cancel()
        checks = ExitChecks(cloud: ExitProbe(state: .checking), home: ExitProbe(state: .checking), graph: graph)
        probeTask = Task { [weak self] in
            let cloud = await Self.probe(Probes.cloudURL)
            guard let self, !Task.isCancelled, self.checks.graph == graph else { return }
            self.checks.cloud = cloud
            self.recompute()
            let home = await Self.probe(Probes.homeURL)
            guard !Task.isCancelled, self.checks.graph == graph else { return }
            self.checks.home = home
            self.recompute()
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
        let now = Date()
        var known = routing
        var derived: (phase: Phase, reason: String?)
        var bindingChanged = false
        #if DEBUG
        let preview = previewPhase
        #else
        let preview: (Phase, String?)? = nil
        #endif
        if let preview {
            derived = preview
        } else {
            // The tunnel's own report, the same the widgets read, is taken on every event.
            if tunnelStatus.isUp { tracker.observed(StatusStore.load()?.tunnel) }
            startChecksIfNeeded(now: now)
            let facts = ConnectionFacts(signedIn: signedIn, preparing: preparing, tunnel: tunnelStatus, configured: tunnel.configured,
                                        failure: failure, permission: permission)
            let status = AppStatus.resolve(facts, checks: checks, tracker: tracker, now: now)
            bindingChanged = status.session != resolved?.session || status.generation != resolved?.generation
            resolved = status
            known = status.routing
            derived = (status.phase, status.reason)
            if cloudProbe != status.cloud { cloudProbe = status.cloud }
            if homeProbe != status.home { homeProbe = status.home }
            adoptConfirmed(status.routing)
            scheduleExpiry()
        }
        let routingChanged = known != routing
        if routingChanged { routing = known }
        guard derived.phase != phase || derived.reason != reason || routingChanged || bindingChanged else { return }
        withAnimation(.easeInOut(duration: 0.22)) {
            phase = derived.phase
            reason = derived.reason
        }
        publishStatus()
    }

    /// The display name of the line in use, as the exit capsule shows it; nil when it is not known.
    var exitName: String? { currentLine.map(displayName) }

    /// "Tokyo" (localised city); "Tokyo · Dawn" only when another line is also in Tokyo.
    func displayName(_ line: LineItem) -> String {
        let city = Format.city(line.city, chinese: L.isChinese)
        return LineNaming.showsLabel(line.name, among: lines.map(\.name)) ? "\(city) · \(line.label)" : city
    }

    /// Shares the phase with widgets, the control and the Live Activity as the app's note: it can
    /// say less than the tunnel (off, failed, starting, unconfirmed) or decorate the graph the tunnel
    /// confirmed, never make a connection claim or renew the tunnel's. Every surface then shows the
    /// one reading `SharedStatus.reading` resolves. The DEBUG preview never writes the shared status:
    /// a fixture must not reach a real widget or control.
    private func publishStatus(force: Bool = false) {
        let now = Date()
        #if DEBUG
        if previewPhase != nil {
            if CommandLine.arguments.contains("-TonoPreviewLiveActivity") {
                let state = StatusSnapshot.State(phase)
                let snapshot = StatusSnapshot(state: state, exit: exitName, since: state.tunnelUp ? connectedSince : nil,
                                              reason: state == .off || state == .on ? nil : reason, updatedAt: now, writer: .app)
                liveActivity.sync(.fresh(snapshot), enabled: true, preview: true)
            }
            return
        }
        #endif
        // Names only the confirmed line while the tunnel is up (none while nothing is confirmed).
        let line = currentLine.map { (node: $0.name, name: displayName($0)) }
        let note = resolved?.note(line: line, now: now) ?? AppNote(phase, reason: reason, answer: nil, line: line, now: now)
        let wrote = StatusStore.update { ($0 ?? SharedStatus()).writingApp(note) }
        if wrote || force { StatusReload.all() }
        liveActivity.sync(StatusStore.load()?.reading(now: now) ?? .unavailable, enabled: liveActivityEnabled)
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
        let args = CommandLine.arguments
        m.previewFailuresLeft = args.contains("-TonoPreviewFailFirst") ? 1 : 0
        m.offline = args.contains("-TonoPreviewOffline")
        m.showOnboarding = args.contains("-TonoPreviewOnboarding")
        // `-TonoPreviewLines empty|loading`: the line picker's empty and loading states.
        if let i = args.firstIndex(of: "-TonoPreviewLines"), i + 1 < args.count {
            m.lines = []
            m.catalogLoading = args[i + 1] == "loading"
        }
        m.show(phase)
        return m
    }

    /// `-TonoPreviewCycle`: walks the service states the way a real session moves through them,
    /// so the state-transition motion can be recorded in a simulator.
    static func previewCycle() -> AppModel {
        let m = preview(.idle)
        // A network change (iOS reasserting the tunnel) sits between two connected stretches, so the
        // recording shows it next to a first start.
        let script: [(Phase, Double, String?)] = [
            (.idle, 2, nil), (.preparing, 1.2, nil), (.connecting, 2.4, nil), (.connected, 3.4, nil), (.degraded, 3, nil),
            (.connected, 2.6, nil), (.connecting, 3, "NETWORK_CHANGED"), (.connected, 2.4, nil), (.disconnecting, 1.2, nil),
            (.idle, 2.4, nil), (.connecting, 1.8, nil), (.failed, 3, nil),
        ]
        Task { @MainActor in
            while true {
                for (phase, seconds, reason) in script {
                    m.show(phase, reason: reason)
                    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                }
            }
        }
        return m
    }

    /// Interactive preview (DEBUG): the primary capsule walks the same phases a real start/stop does,
    /// with fixture timings and no tunnel, so UI tests can tap through connect, cancel, fail/retry and
    /// disconnect. `-TonoPreviewFailFirst` makes the first start fail (Home exit unavailable).
    fileprivate func previewToggle(_ on: Bool) {
        // The primer comes before the (simulated) iOS prompt, as in a real first start.
        if on, phase == .needsPermission, !primerConfirmed {
            showVPNPrimer = true
            return
        }
        primerConfirmed = false
        previewRun?.cancel()
        let steps: [(Phase, Double)]
        if on {
            if previewFailuresLeft > 0 {
                previewFailuresLeft -= 1
                steps = [(.preparing, 0.8), (.connecting, 1.4), (.failed, 0)]
            } else {
                steps = [(.preparing, 0.8), (.connecting, 1.6), (.connected, 0)]
            }
        } else {
            steps = [(.disconnecting, phase.tunnelUp ? 0.9 : 0.5), (.idle, 0)]
        }
        // `-TonoPreviewSlow` stretches the walk so a UI test can tap Cancel mid-start without racing it.
        let pace = CommandLine.arguments.contains("-TonoPreviewSlow") ? 3.0 : 1.0
        previewRun = Task { @MainActor [weak self] in
            for (next, base) in steps {
                let seconds = base * pace
                guard let self, !Task.isCancelled else { return }
                if next == .connected { self.connectedSince = Date() }
                self.show(next)
                if seconds > 0 { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
            }
        }
    }

    private func show(_ phase: Phase, reason override: String? = nil) {
        var reason: String? = phase == .degraded ? "HOME_UNREACHABLE" : phase == .failed ? "HOME_UNAVAILABLE" : nil
        // `-TonoPreviewReason NETWORK_CHANGED|CORE_STOPPED|…` shows another reason for the same phase.
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-TonoPreviewReason"), i + 1 < args.count, phase != .idle { reason = args[i + 1] }
        if let override { reason = override }
        if phase == .connecting, reason == "NETWORK_CHANGED" {
            // Reasserting keeps the session and its connected date (as `tunnelChanged` does for
            // `.reasserting`); only the probes restart.
            connectedSince = connectedSince ?? Date().addingTimeInterval(-47 * 60)
            cloudProbe = ExitProbe(state: .checking)
            homeProbe = ExitProbe(state: .checking)
        } else if phase.tunnelUp {
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
        // The preview's stand-in for the tunnel's answer: up phases run the chosen routes.
        if phase.tunnelUp { routing = .graph(routeSettings) }
        else if phase == .connecting, reason == "UNCONFIRMED" { routing = .unknown }
        else if phase == .failed, reason == "ROUTES_STOPPED" { routing = .noGraph }
        else { routing = nil }
        previewPhase = (phase, reason)
        recompute()
    }

    /// The real `RouteApply` with an injected fault (`-TonoPreviewApplyFails save|send|silent|reload|stopped|putback|slow`):
    /// the write is refused; the tunnel does not answer the rebuild but its status shows the old
    /// graph; it answers neither; it refuses and keeps the previous graph; it refuses with no graph
    /// left; it refuses and the put-back of the file fails; it confirms after 3 s. Without the argument the
    /// change is confirmed after 0.7 s.
    fileprivate func previewApply(_ requested: RouteSettings, previous: RouteSettings) async -> RouteApplyReport {
        let args = CommandLine.arguments
        let fault = args.firstIndex(of: "-TonoPreviewApplyFails").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
        // Long enough for the pending state to be seen and recorded.
        try? await Task.sleep(nanoseconds: fault == "slow" ? 3_000_000_000 : 700_000_000)
        var writes = 0
        return await RouteApply.run(requested, previous: previous, tunnelUp: phase.tunnelUp,
                                    save: { _ in
                                        writes += 1
                                        if fault == "save" || (fault == "putback" && writes > 1) { throw CocoaError(.fileWriteNoPermission) }
                                    },
                                    reload: {
                                        switch fault {
                                        case "send", "silent": return nil
                                        case "reload", "putback": return ReloadReply.refused(code: "CORE_START", running: previous).encoded
                                        case "stopped": return ReloadReply.refused(code: "CORE_START", running: nil).encoded
                                        default: return ReloadReply.applied(requested).encoded
                                        }
                                    },
                                    status: {
                                        fault == "send" ? Data(JSON.obj(("running", previous.json)).serialized().utf8) : nil
                                    })
    }
}
#endif
