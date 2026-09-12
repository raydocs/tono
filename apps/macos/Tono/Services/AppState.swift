import SwiftUI
import Observation
import Security
import CryptoKit
import Darwin

// MARK: - App State

@Observable
final class AppState {
    nonisolated static let managedCatalogRegionID = ManagedCatalogIdentity.regionID
    nonisolated static let managedCatalogSourceID = ManagedCatalogIdentity.sourceID
    // Navigation
    var selectedPage: AppPage = .dashboard {
        didSet {
            guard selectedPage != oldValue else { return }
            updateLiveStreamSubscriptions()
        }
    }
    var isMainWindowVisible = false

    // Dashboard
    var isConnected: Bool = false {
        didSet {
            guard isConnected != oldValue else { return }
            LocalTrafficAudit.shared.recordEvent(
                isConnected ? "connected" : "disconnected",
                details: auditProtectionDetails()
            )
        }
    }
    var isConnecting: Bool = false
    var isDisconnecting: Bool = false
    var connectionStage: ConnectionStage = .preparing {
        didSet {
            guard connectionStage != oldValue else { return }
            let now = Date()
            var details = ["stage": connectionStage.rawValue]
            if isConnecting {
                completedConnectionStages.insert(oldValue)
                if let connectionStageStartedAt {
                    let elapsedMs = max(
                        0,
                        Int(now.timeIntervalSince(connectionStageStartedAt) * 1_000)
                    )
                    details["previous_stage"] = oldValue.rawValue
                    details["previous_stage_duration_ms"] = String(elapsedMs)
                    // The audit log already carried this, but only as JSONL on
                    // disk, so nothing could show a user or support which step
                    // actually consumed the connect time.
                    if lastConnectionStageDurations.count < 32 {
                        lastConnectionStageDurations.append(
                            StageDuration(stage: oldValue, milliseconds: elapsedMs)
                        )
                    }
                }
                connectionStageStartedAt = now
            }
            LocalTrafficAudit.shared.recordEvent(
                "connection_stage",
                details: details
            )
        }
    }
    struct StageDuration: Identifiable {
        let stage: ConnectionStage
        let milliseconds: Int
        var id: String { stage.rawValue }
    }

    /// Per-step timings for the most recent connect transaction, surfaced on
    /// the Support page so a slow connect can be attributed to a step.
    var lastConnectionStageDurations: [StageDuration] = []
    var disconnectionStage: DisconnectionStage = .finishingOperation
    var connectionStartedAt: Date?
    var connectionStageStartedAt: Date?
    var disconnectionStartedAt: Date?
    var completedConnectionStages: Set<ConnectionStage> = []
    var lastConnectionFailure: ConnectionFailure?
    /// Failed update journal still on disk. Dashboard tells the customer to
    /// disconnect and reinstall; a later connect must not hide this.
    var updateIncomplete: Bool = UpdateHandoffStore.showsIncompleteUpdate()
    var isProtectedReconnectScheduled = false
    var protectedReconnectAttempt = 0
    var protectedReconnectNextAttemptAt: Date?
    /// A connect failure that only the user can resolve (a denied
    /// administrator prompt, a failed helper installation) pauses the
    /// automatic reconnect loop: retrying the identical transaction would
    /// re-trigger the same prompt or fail the same way forever. PF stays
    /// fail-closed; Retry Now and Protected Offline remain available.
    var protectedReconnectPausedForUserAction = false
    /// A repeated-failure pause is new-information-sensitive: a network-change
    /// kick may lift it (the environment changed, the outcome may differ). A
    /// user-action pause (denied admin prompt) must never be lifted by a route
    /// flap, or the credential dialog would re-appear uninvited.
    var protectedReconnectPauseLiftsOnNetworkChange = false
    var lastProtectedFailureSignature: String?
    /// Last TUN origin that proved the data plane. Health checks start this
    /// one first so a live session is not hit by three cold TLS races.
    var lastSuccessfulProbeOrigin: String?
    var consecutiveProtectedFailureCount = 0
    /// The protected path failed and PF is intentionally still blocking direct
    /// egress. Keep this distinct from ordinary "Not Connected" so the user
    /// can explicitly restore normal Internet instead of unknowingly retrying
    /// into another fail-closed transition.
    var isProtectionBlocked: Bool = false
    var switchingNodeId: String? = nil
    var proxyMode: ProxyMode = .rule
    var activeNode: ProxyNode? = nil
    var networkInfo: NetworkInfo = NetworkInfo()
    var trafficStats: TrafficStats = TrafficStats()
    /// True after `/traffic` has delivered at least one frame for this session.
    var trafficFeedLive = false
    /// True after `/connections` has delivered at least one frame for this session.
    var connectionsFeedLive = false
    var errorMessage: String? = nil {
        didSet {
            guard let errorMessage, errorMessage != oldValue else { return }
            LocalTrafficAudit.shared.recordEvent(
                "user_visible_error",
                details: ["message": errorMessage]
            )
        }
    }
    var isProxyDegraded: Bool = false
    var isRecoveringProtectedConnection: Bool = false
    var lastClassifiedFailure: ProtectedFailure?
    var healthCounters = ProtectedHealthCounters()
    var tonoTransport: TonoTransportDescriptor? = nil
    private(set) var cloudOnlyTransportReady = false
    var isTonoReady: Bool {
        // Leftover imported names such as `US-VLESS-Reality` used to make
        // Tono look ready even when the signed catalog had not loaded. Those
        // imports never completed a China connect in the customer log.
        if defaultCloudExitNode() != nil { return true }
        if tonoTransport != nil { return true }
        return false
    }
    var isOwnedTonoMode: Bool {
        tonoTransport != nil || cloudOnlyTransportReady
    }

    // Proxies
    var proxyRegions: [ProxyRegion] = []
    var selectedNodeId: String? = nil

    // Rules
    var rules: [RuleItem] = []
    var activeRules: [APIRule] = []
    var ruleProviders: [String: APIRuleProvider] = [:]
    /// Cached provider rules for search (lazy-loaded on first search)
    var providerRulesCache: [APIRule] = []
    var isLoadingProviderRules = false
    var providerRulesLoaded = false

    /// Total rule count: inline rules + all provider rules
    var totalRuleCount: Int {
        let inline = isConnected && !activeRules.isEmpty
            ? activeRules.count
            : rules.count
        let providerTotal = ruleProviders.values.reduce(0) { $0 + $1.ruleCount }
        return inline + providerTotal
    }

    /// All searchable rules: inline active rules + cached provider rules
    var allSearchableRules: [APIRule] {
        activeRules + providerRulesCache
    }

    // Activity
    var connections: [ConnectionEntry] = []
    /// True when live flows (after hiding loopback DNS) exceed the displayed cap.
    var connectionsDisplayLimited = false
    /// Per-app totals with a route split. Fed from every connections
    /// snapshot, not only while the Activity page is visible.
    let appTrafficLedger = AppTrafficLedger()
    /// Oldest currently-open proxied flow, used to hold a disruptive pin
    /// refresh until streaming responses have finished.
    var oldestProxiedConnectionStart: Date?
    var pinRefreshDeferralCount = 0
    /// Catalog applies held back so far for the same reason a pin refresh is
    /// held back: the reload that follows one closes every open connection.
    var catalogApplyDeferralCount = 0
    static let catalogApplyMaximumDeferrals = 3
    var lastManagedDirectActivity: Date?

    // Logs
    var logEntries: [LogEntry] = []
    var logLevel: String = "info"

    // Subscriptions
    var subscriptions: [SubscriptionInfo] = []
    var autoUpdateTimer: Timer?
    private var proxyGuardTimer: Timer?
    private var latencyTestTimer: Timer?
    /// Catalog exits already tried in this fail-closed connect loop. Reset on
    /// a fresh user connect so a China GFW hit on one city can move on.
    private var catalogFailoverNamesTried: Set<String> = []
    var resumeProtectionAfterWake = false
    var initialDataLoaded = false
    var autoConnectRequested = false
    var managedCatalogRevision = -1
    var managedCatalogDigest: String?
    /// Freshness of the sibling routing document. The fleet-wide revision and
    /// the YAML digest both describe the proxies list only, so a routing-only
    /// rotation — a new home SOCKS5 credential, or a rebind onto a different
    /// catalog home exit — is invisible to either.
    var managedCatalogRoutingToken: String?
    var managedCatalogRouting: TonoExitCatalogRouting?

    /// Read-only view of the cloud-assigned residential line, for display.
    /// The assistant lanes (Claude, ChatGPT, Grok) egress through it.
    var residentialHomeHost: String? { managedCatalogRouting?.homeSocks5?.host }

    /// Whether Claude / assistant traffic is dynamically routed via residential upstream.
    var isClaudeHomeActive: Bool {
        guard isConnected else { return false }
        return managedCatalogRouting?.homeSocks5 != nil || managedCatalogRouting?.homeProxy != nil
    }
    var isClaudeHomeConfigured: Bool {
        managedCatalogRouting?.homeSocks5 != nil || managedCatalogRouting?.homeProxy != nil
    }
    var managedCatalogReloadPending = false
    var managedTrafficPolicy = TonoTrafficPolicy(
        version: 1,
        domains: [],
        mediaEndpoints: []
    )
    var managedTrafficPolicyRevision = -1
    var managedTrafficPolicyDigest: String?
    /// Signature of the revision currently installed, so an unsigned copy of a
    /// revision the server has since signed is not mistaken for already applied.
    var managedTrafficPolicySignature: String?
    var activeDirectPolicy: ConfigPipeline.ManagedDirectRuntimePolicy?
    var catalogSelectionRequiresChoice = false
    let initialDataLoader = InitialDataLoader()
    var initialDataLoadTask: Task<InitialDiskSnapshot, Never>?
    let managedCatalogProcessor = ManagedCatalogProcessor()
    let managedTrafficPolicyProcessor = ManagedTrafficPolicyProcessor()
    let persistenceWriter = AppStatePersistenceWriter()
    var persistenceTask: Task<Void, Never>?

    // Runtime config
    var config: RuntimeConfig = RuntimeConfig()

    // Core components
    let coreRuntime = CoreRuntimeManager()
    let connectionCoordinator = ConnectionCoordinator()
    let subscriptionManager = SubscriptionManager()
    let proxyService = ProxyService()
    private let providerRuleLoader = ProviderRuleLoader()
    var coreController: CoreControllerClient?
    var webSocket: CoreWebSocket?
    /// Digest of the config the running core actually loaded, as opposed to the
    /// last one written to disk. A rewrite that reproduces these bytes has
    /// nothing to reload, and the reload is what closes every open connection.
    var loadedRuntimeConfigDigest: String?
    var residentialRouteAuditContext: ResidentialRouteAuditContext?
    var residentialRouteAuditGeneration: UInt64 = 0
    var pendingFullConfigReload = false
    var pendingDirectPolicyReload:
        ConfigPipeline.ManagedDirectRuntimePolicy?
    var networkInfoTask: Task<Void, Never>?
    var protectedDNSService: String?

    // MARK: - Init

    init() {
        config.secret = Self.controllerSecret()
        LocalTrafficAudit.shared.recordEvent(
            "app_state_initialized",
            details: [
                "app_version": Bundle.main.object(
                    forInfoDictionaryKey: "CFBundleShortVersionString"
                ) as? String ?? "unknown",
                "build": Bundle.main.object(
                    forInfoDictionaryKey: "CFBundleVersion"
                ) as? String ?? "unknown",
            ]
        )
    }

    func setLocalTrafficAuditEnabled(_ enabled: Bool) {
        LocalTrafficAudit.shared.setEnabled(enabled)
        updateLiveStreamSubscriptions()
    }

    func setClaudeTrafficResearchEnabled(_ enabled: Bool) {
        LocalTrafficAudit.shared.setClaudeTrafficResearchEnabled(enabled)
        updateLiveStreamSubscriptions()
    }

    func setAggregatedAppRoutingResearchEnabled(_ enabled: Bool) {
        AppRoutingResearch.shared.setEnabled(enabled)
        updateLiveStreamSubscriptions()
    }

    func appRoutingResearchActivationChanged() {
        updateLiveStreamSubscriptions()
    }

    func setMainWindowVisible(_ visible: Bool) {
        guard isMainWindowVisible != visible else { return }
        isMainWindowVisible = visible
        updateLiveStreamSubscriptions()
    }

    /// Dynamic-store notifications replace the old five-second route and DNS
    /// command polling. Debounce the burst emitted by one macOS transition,
    /// then inspect the committed primary service and root-owned DNS state
    /// once. PF remains the synchronous leak boundary while this runs.
    func handleSystemNetworkChange() {
        if !isConnected {
            guard KillSwitchService.isArmed, isTonoReady,
                  !isConnecting, !isDisconnecting else { return }
            // Wake recovery owns its barrier/retry sequence. Dynamic Store
            // emits several route and DNS notifications during the same wake;
            // they must not create a second coordinator that races its connect.
            guard connectionCoordinator.wakeRecoveryTask == nil else { return }
            LocalTrafficAudit.shared.recordEvent(
                "protected_reconnect_network_kick",
                details: auditProtectionDetails()
            )
            scheduleProtectedReconnect(immediate: true)
            return
        }
        guard isConnected, !isConnecting, !isDisconnecting else { return }
        LocalTrafficAudit.shared.recordEvent(
            "system_network_change_observed",
            details: auditProtectionDetails()
        )
        connectionCoordinator.networkEnvironmentTask?.cancel()
        connectionCoordinator.networkEnvironmentTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(750))
            guard let self, !Task.isCancelled, self.isConnected,
                  !self.isConnecting, !self.isDisconnecting else { return }
            let primaryService =
                await PrivilegedRuntimeCoordinator.shared.primaryNetworkService()
            let dnsIntegrity = if let service = self.protectedDNSService {
                await PrivilegedRuntimeCoordinator.shared
                    .protectedDNSIntegrity(service: service)
            } else {
                PrivilegedRuntimeCoordinator.ProtectedDNSIntegrity.broken
            }
            guard !Task.isCancelled, self.isConnected else { return }
            // An unreachable helper is not evidence that DNS was tampered with;
            // tearing the session down on it closes every flow for a restart
            // that resolves itself.
            guard dnsIntegrity != .unverifiable else {
                self.connectionCoordinator.networkEnvironmentTask = nil
                return
            }
            guard primaryService != self.protectedDNSService
                    || dnsIntegrity == .broken else {
                self.connectionCoordinator.networkEnvironmentTask = nil
                return
            }
            self.connectionCoordinator.networkEnvironmentTask = nil
            LocalTrafficAudit.shared.recordEvent(
                "system_network_change_requires_reconnect",
                details: self.auditProtectionDetails()
            )
            self.disconnect(releaseKillSwitch: false)
            self.errorMessage = String(
                localized: "The active network changed; Kill Switch is blocking traffic while Tono protects the new connection."
            )
            self.scheduleProtectedReconnect(immediate: true)
        }
    }

    /// Close observation sockets immediately and move an active session toward
    /// the helper's bootstrap-only PF state before macOS powers networking
    /// down. The root helper independently installs an emergency all-block on
    /// the power event, so a delayed GUI callback cannot create an egress gap.
    /// Quiesce connect/health/switch work before a Sparkle install. PF stays
    /// armed until cleanup proves DNS + core stop, or the journal records a
    /// fail-closed handoff.
    func prepareForSoftwareUpdate(nextVersion: String) async -> UpdateHandoffJournal {
        connectionCoordinator.bumpGeneration()
        connectionCoordinator.coreMonitorTask?.cancel()
        connectionCoordinator.nodeSwitchTask?.cancel()
        connectionCoordinator.protectedReconnectTask?.cancel()
        connectionCoordinator.connectTask?.cancel()
        isProtectedReconnectScheduled = false
        var journal = UpdateHandoffJournal(
            phase: .updatePrepared,
            previousAppVersion: Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String ?? "unknown",
            nextAppVersion: nextVersion,
            coreVersion: "v1.19.30-tono-gvisor-adaptive.1",
            coreSHA256: "",
            buildCommit: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            helperProtocolVersion: HelperProtocolVersion.current,
            wasConnected: isConnected || isConnecting || isProtectionBlocked,
            keepKillSwitchArmed: isConnected || isConnecting || isProtectionBlocked || KillSwitchService.isArmed,
            selectedNodeAnonymousId: selectedExitNode()?.id,
            catalogRevision: nil,
            connectionGeneration: connectionCoordinator.protectionOperationGeneration
        )
        // Each hop has to start from the phase actually reached. Advancing the
        // written value and then advancing the original again skips a step,
        // and a skipped step is refused: the journal then records an illegal
        // transition rather than the clean shutdown that did happen, and every
        // later hop inherits the wrong phase.
        journal = journal.advancing(to: .connectionQuiescing)
        try? UpdateHandoffStore.write(journal)
        if isConnected || isConnecting {
            await disconnectAndWait(releaseKillSwitch: false)
        }
        journal = journal.advancing(to: .cleanShutdownCompleted)
        try? UpdateHandoffStore.write(journal)
        return journal
    }

    func markProtectedUpdateHandoff(_ journal: UpdateHandoffJournal) {
        let next = journal.advancing(to: .protectedHandoffRecorded)
        try? UpdateHandoffStore.write(next)
    }

    func prepareForSystemSleep() {
        let shouldResume = isConnected || isConnecting || isProtectionBlocked
            || KillSwitchService.isArmed
        resumeProtectionAfterWake = shouldResume
        LocalTrafficAudit.shared.recordEvent(
            "system_will_sleep",
            details: auditProtectionDetails()
        )
        guard shouldResume else { return }
        connectionCoordinator.bumpGeneration()
        connectionCoordinator.wakeRecoveryTask?.cancel()
        connectionCoordinator.wakeRecoveryTask = nil
        connectionCoordinator.sleepRestrictTask?.cancel()
        connectionCoordinator.sleepRestrictTask = nil
        connectionCoordinator.networkEnvironmentTask?.cancel()
        connectionCoordinator.networkEnvironmentTask = nil
        connectionCoordinator.protectedReconnectTask?.cancel()
        connectionCoordinator.protectedReconnectTask = nil
        connectionCoordinator.protectedReconnectID = nil
        connectionCoordinator.lastProtectedReconnectKick = nil
        isProtectedReconnectScheduled = false
        protectedReconnectAttempt = 0
        protectedReconnectNextAttemptAt = nil
        if isConnected || isConnecting || coreRuntime.isRunning {
            disconnect(releaseKillSwitch: false)
        } else if KillSwitchService.isArmed || isProtectionBlocked {
            connectionCoordinator.sleepRestrictTask?.cancel()
            connectionCoordinator.sleepRestrictTask = Task {
                try? await PrivilegedRuntimeCoordinator.shared
                    .restrictKillSwitchToBootstrap()
            }
        }
    }

    /// A wake never inherits a green UI or stale TUN/DNS assumption. Reassert
    /// PF, wait briefly for macOS to publish its new primary service, and run
    /// the full transactional connect path again. Until that commits, traffic
    /// remains fail-closed.
    func resumeAfterSystemWake() {
        let shouldResume = resumeProtectionAfterWake || KillSwitchService.isArmed
        resumeProtectionAfterWake = false
        LocalTrafficAudit.shared.recordEvent(
            "system_did_wake",
            details: auditProtectionDetails()
        )
        guard shouldResume else { return }
        connectionCoordinator.bumpGeneration()
        connectionCoordinator.networkEnvironmentTask?.cancel()
        connectionCoordinator.networkEnvironmentTask = nil
        connectionCoordinator.wakeRecoveryTask?.cancel()
        connectionCoordinator.wakeRecoveryTask = Task { [weak self] in
            guard let self else { return }
            if self.isConnected || self.isConnecting || self.coreRuntime.isRunning {
                self.disconnect(releaseKillSwitch: false)
            }
            _ = await self.connectionCoordinator.sleepRestrictTask?.value
            self.connectionCoordinator.sleepRestrictTask = nil
            await self.finishPendingDisconnect()
            var barrierReady = false
            for delay in [0, 1, 2, 5, 10, 30] {
                if delay > 0 {
                    try? await Task.sleep(for: .seconds(delay))
                }
                guard !Task.isCancelled else { return }
                if !barrierReady {
                    do {
                        try await PrivilegedRuntimeCoordinator.shared
                            .reassertKillSwitchIfNeeded()
                        barrierReady = true
                    } catch {
                        self.isProtectionBlocked = true
                        self.errorMessage = String(
                            localized: "Wake protection is still being reasserted; Internet remains blocked. \(error.localizedDescription)"
                        )
                        continue
                    }
                }
                guard self.isTonoReady else {
                    self.isProtectionBlocked = true
                    self.errorMessage = String(
                        localized: "Waiting for the protected route after wake; Internet remains blocked."
                    )
                    continue
                }
                guard !self.isConnected, !self.isConnecting,
                      !self.isDisconnecting else {
                    // A connect may already have started from another
                    // transport-ready callback. Do not leave a completed task
                    // handle that suppresses every later route-change kick.
                    if !Task.isCancelled {
                        self.connectionCoordinator.wakeRecoveryTask = nil
                    }
                    return
                }
                self.isProtectionBlocked = true
                self.errorMessage = String(
                    localized: "Re-protecting this Mac after wake. Kill Switch is blocking direct traffic."
                )
                self.connect()
                self.connectionCoordinator.wakeRecoveryTask = nil
                return
            }
            self.connectionCoordinator.wakeRecoveryTask = nil
            // Exhausting the wake delays must not strand a fail-closed host
            // with nothing scheduled: sleep preparation cancelled the standard
            // reconnect loop, and on a stable network no route-change kick may
            // ever arrive. Hand ownership to the persistent loop, exactly as
            // post-connect failures do.
            if !Task.isCancelled, self.isProtectionBlocked, !self.isConnected {
                self.scheduleProtectedReconnect()
            }
        }
    }

    private static func controllerSecret() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return UUID().uuidString }
        return Data(bytes).base64EncodedString()
    }

    /// Starts the mandatory TUN automatically once both the authenticated
    /// Tailscale descriptor and local persisted state are ready. A nil
    /// descriptor is a protected-path failure: stop Mihomo, retain PF.
    func acceptTonoTransport(_ descriptor: TonoTransportDescriptor?) async {
        tonoTransport = descriptor
        cloudOnlyTransportReady = false
        guard descriptor != nil else {
            autoConnectRequested = false
            if isDisconnecting {
                await finishPendingDisconnect()
            } else if isConnected || isConnecting || coreRuntime.isRunning {
                await disconnectAndWait(releaseKillSwitch: false)
            }
            return
        }
        autoConnectRequested = true
        attemptAutomaticConnect()
    }

    /// Makes the authenticated cloud-only session ready for an explicit user
    /// connection. Only a validated managed cloud exit may be selected; the
    /// owned runtime omits Home-US entirely.
    func acceptCloudOnlyTransport(resumeProtection: Bool = false) throws {
        tonoTransport = nil
        cloudOnlyTransportReady = true
        let selected = selectedExitNode()
            ?? defaultCloudExitNode()
        guard let selected else {
            cloudOnlyTransportReady = false
            autoConnectRequested = false
            throw TonoSidecarService.Error.commandFailed(
                "No managed cloud exit is available."
            )
        }
        guard applyProxySelection(selected.name) else {
            cloudOnlyTransportReady = false
            autoConnectRequested = false
            throw TonoSidecarService.Error.commandFailed(
                "The managed cloud exit could not be selected."
            )
        }
        // A sweep's rotation reaches here through `proxyService.activeNodeName`,
        // and it has proven nothing yet; saving it would lose the user's own
        // region to a detour. The persist after a successful connect commits it.
        if !isUnprovenFailoverTarget(selected.name) {
            persistProxySelection(selected.name)
        }
        catalogSelectionRequiresChoice = false
        // A normal signed-in launch remains an explicit user choice. After a
        // crash, however, PF is already fail-closed; recover the selected route
        // automatically instead of leaving the machine offline at a dashboard.
        autoConnectRequested = resumeProtection
        attemptAutomaticConnect()
    }

    func attemptAutomaticConnect() {
        guard autoConnectRequested, initialDataLoaded, isTonoReady,
              !catalogSelectionRequiresChoice, !isConnected, !isConnecting else { return }
        // connect() silently no-ops while a previous disconnect drains. The
        // intent flag must survive that window, or a crash-recovery launch
        // stays fail-closed at the dashboard with nothing scheduled.
        if isDisconnecting {
            Task { [weak self] in
                await self?.finishPendingDisconnect()
                self?.attemptAutomaticConnect()
            }
            return
        }
        autoConnectRequested = false
        connect()
    }

    // Computed
    var totalNodes: Int {
        proxyRegions.flatMap(\.nodes).count
    }

    var isCoreAvailable: Bool {
        coreRuntime.findBinary() != nil
    }

    var customNodes: [ProxyNode] {
        proxyRegions.filter { $0.id == "custom" }.flatMap(\.nodes)
    }

    var managedCatalogNodeCount: Int {
        proxyRegions.first(where: { $0.id == Self.managedCatalogRegionID })?.nodes.count ?? 0
    }

    var managedCatalogVersion: Int? {
        managedCatalogRevision >= 0 ? managedCatalogRevision : nil
    }

    /// Restore the route the user actually selected. While Home-US is disabled,
    /// every authenticated session takes the managed-cloud startup path.
    var prefersManagedCloudExit: Bool {
        !AppProfile.homeExitEnabled || selectedExitNode() != nil
    }

    var importedExitNodes: [ProxyNode] {
        proxyRegions.flatMap(\.nodes)
    }

    func selectedExitNode() -> ProxyNode? {
        guard let target = currentProxySelectionTarget() else { return nil }
        guard target != ConfigPipeline.homeNodeName else { return nil }
        if let node = localProxyNode(matching: target) {
            return node
        }
        return nil
    }

    private var savedProxyTargetName: String? {
        normalizedProxyTarget(AppProfile.defaults.string(forKey: SettingsKey.selectedProxyTargetName))
    }

    private func normalizedProxyTarget(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    func currentProxySelectionTarget() -> String? {
        normalizedProxyTarget(proxyService.activeNodeName)
            ?? normalizedProxyTarget(activeNode?.name)
            ?? normalizedProxyTarget(selectedNodeId)
            ?? savedProxyTargetName
    }

    func persistProxySelection(_ target: String?) {
        if let target = normalizedProxyTarget(target) {
            noteCatalogFailoverLanding(on: target)
            AppProfile.defaults.set(target, forKey: SettingsKey.selectedProxyTargetName)
        } else {
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
        }
    }

    func localProxyNode(matching target: String) -> ProxyNode? {
        proxyRegions.flatMap(\.nodes).first {
            proxyTarget($0.name, matches: target) || proxyTarget($0.id, matches: target)
        }
    }

    /// Prefer the requested US Reality exit across catalog naming variants. If
    /// it is temporarily absent, retain availability with the first verified
    /// managed-cloud node.
    /// Catalog exits are the only ones proven for Tono. A leftover imported
    /// name such as `US-VLESS-Reality` never passed from a China network in
    /// the customer log; if the signed catalog is present, use it.
    var managedCatalogNodes: [ProxyNode] {
        proxyRegions
            .first(where: { $0.id == Self.managedCatalogRegionID })?
            .nodes ?? []
    }

    func preferManagedCatalogExitForConnect() -> ProxyNode? {
        let selected = selectedExitNode()
        let catalog = managedCatalogNodes
        guard !catalog.isEmpty else { return selected }
        if let selected,
           catalog.contains(where: {
               $0.id == selected.id || proxyTarget($0.name, matches: selected.name)
           }) {
            return selected
        }
        guard let preferred = defaultCloudExitNode() else { return selected }
        _ = applyProxySelection(preferred.name)
        persistProxySelection(preferred.name)
        LocalTrafficAudit.shared.recordEvent(
            "connect_retargeted_to_catalog",
            details: [
                "from": selected?.name ?? "none",
                "to": preferred.name,
            ]
        )
        return preferred
    }

    private func defaultCloudExitNode() -> ProxyNode? {
        let nodes = managedCatalogNodes
        if let preferred = managedCatalogRouting?.defaultProxy,
           let node = nodes.first(where: { proxyTarget($0.name, matches: preferred) }) {
            return node
        }
        return ConfigPipeline.preferredCloudExit(
            in: nodes,
            named: AppProfile.defaultCloudExitName
        )
    }

    /// Next signed catalog city. Leftover imported names are never candidates.
    func nextCatalogExit(
        after current: ProxyNode?,
        in catalog: [ProxyNode]
    ) -> ProxyNode? {
        guard !catalog.isEmpty else { return nil }
        if let current, let currentIndex = catalog.firstIndex(where: { $0.id == current.id }) {
            let rotated = Array(catalog.dropFirst(currentIndex + 1))
                + Array(catalog.prefix(currentIndex + 1))
            return rotated.first(where: { node in
                ProxyNode.isCityFailoverCandidate(node.name, after: current.name)
            })
        }
        if let preferred = defaultCloudExitNode(),
           ProxyNode.isCityFailoverCandidate(preferred.name, after: current?.name) {
            return preferred
        }
        return catalog.first(where: { node in
            ProxyNode.isCityFailoverCandidate(node.name, after: current?.name)
        })
    }

    /// The city the user chose, and the city a failover sweep is currently
    /// trying instead. A rotation is a recovery detour, not a new preference:
    /// nothing reaches the saved selection until a session has actually come up
    /// on the rotated city.
    private var catalogFailoverOriginalTarget: String?
    private var catalogFailoverAttemptTarget: String?

    /// Commits a failover detour to the saved selection once the connection it
    /// was made for is live, and says so — the user picked another city and is
    /// otherwise never told that theirs could not be reached.
    private func noteCatalogFailoverLanding(on target: String) {
        guard let original = catalogFailoverOriginalTarget,
              let attempted = catalogFailoverAttemptTarget else { return }
        // Anything reaching the saved target ends the detour: a landed rotation
        // because it landed, and any other selection — an explicit switch, a
        // catalog default — on its own terms. A detour left armed outlives the
        // sweep and commits itself against whatever connect comes next, naming
        // a city the user chose as one Tono had to fall back to.
        catalogFailoverOriginalTarget = nil
        catalogFailoverAttemptTarget = nil
        guard proxyTarget(attempted, matches: target), isConnected else { return }
        guard !proxyTarget(original, matches: target) else { return }
        LocalTrafficAudit.shared.recordEvent(
            "connect_catalog_failover_committed",
            details: [
                "from": original,
                "to": target,
            ]
        )
        errorMessage = String(
            localized: "\(original) could not be reached, so Tono connected through \(target) and made it the selected cloud server."
        )
    }

    /// Whether this name is the rotation a sweep is currently trying. It has
    /// carried no session yet, so nothing may save it as the user's own region;
    /// the persist that follows a successful connect is what commits it.
    private func isUnprovenFailoverTarget(_ name: String) -> Bool {
        guard let attempted = catalogFailoverAttemptTarget else { return false }
        return proxyTarget(attempted, matches: name)
    }

    /// Ends a failover sweep: the counter of cities already tried, and the
    /// detour that has not landed. Both belong to one sweep, so both go together
    /// — an attempt left behind arms a banner against an unrelated connect.
    func clearCatalogFailoverSweep() {
        catalogFailoverNamesTried = []
        catalogFailoverOriginalTarget = nil
        catalogFailoverAttemptTarget = nil
    }

    /// Next unused catalog city for a failover sweep. Not called on the live
    /// `CORE_EXIT_UNREACHABLE` path: that TLS close repeats on every city from
    /// China, and hopping only moved the picker. `CatalogCityFailover` keeps
    /// it off until G2.8 has home-broadband proof.
    @discardableResult
    func rotateCatalogExitAfterConnectFailure() -> Bool {
        let catalog = managedCatalogNodes
        let current = selectedExitNode()
        if let current {
            catalogFailoverNamesTried.insert(current.name)
        }
        guard let next = nextCatalogExit(after: current, in: catalog),
              !catalogFailoverNamesTried.contains(next.name) else {
            LocalTrafficAudit.shared.recordEvent(
                "connect_catalog_failover_exhausted",
                details: [
                    "tried": catalogFailoverNamesTried.sorted().joined(separator: ","),
                    "catalog": String(catalog.count),
                ]
            )
            return false
        }
        catalogFailoverNamesTried.insert(next.name)
        if catalogFailoverOriginalTarget == nil {
            catalogFailoverOriginalTarget = savedProxyTargetName ?? current?.name
        }
        catalogFailoverAttemptTarget = next.name
        // In memory only. This city has proven nothing yet, and a sweep that
        // ends without a connection must leave the user's own choice saved.
        _ = applyProxySelection(next.name)
        lastProtectedFailureSignature = nil
        consecutiveProtectedFailureCount = 0
        LocalTrafficAudit.shared.recordEvent(
            "connect_catalog_failover",
            details: [
                "from": current?.name ?? "none",
                "to": next.name,
            ]
        )
        return true
    }

    /// Build 10 corrects the previous exact-name-only default once. After this
    /// migration, an explicit JP selection remains sticky across launches.
    @discardableResult
    func migrateCloudExitDefaultIfNeeded() -> Bool {
        let currentVersion = AppProfile.defaults.integer(
            forKey: SettingsKey.cloudExitDefaultPolicyVersion
        )
        guard currentVersion < 1, let preferred = defaultCloudExitNode() else {
            return false
        }
        selectedNodeId = preferred.id
        activeNode = preferred
        proxyService.activeNodeName = preferred.name
        persistProxySelection(preferred.name)
        AppProfile.defaults.set(1, forKey: SettingsKey.cloudExitDefaultPolicyVersion)
        return true
    }

    func isMainProxyGroup(_ name: String) -> Bool {
        name == ConfigPipeline.exitGroupName || name == "PROXY" || name == "Proxies"
    }

    private func mainProxyGroups(containing target: String) -> [ProxyService.MihomoGroup] {
        let candidates = proxyService.groups.filter { $0.isSelector && $0.all.contains(target) }
        let preferred = candidates.filter { isMainProxyGroup($0.name) }
        if !preferred.isEmpty { return preferred }

        if let activeGroupName = proxyService.activeGroupName,
           let active = candidates.first(where: { $0.name == activeGroupName }) {
            return [active]
        }

        return candidates.first.map { [$0] } ?? []
    }

    func restoreProxySelection(preferredTarget: String? = nil, persistFallback: Bool = false) {
        if let target = normalizedProxyTarget(preferredTarget) ?? savedProxyTargetName,
           applyProxySelection(target) {
            return
        }

        applyDefaultProxySelection(persist: persistFallback)
    }

    @discardableResult
    func applyProxySelection(_ target: String) -> Bool {
        let localNodes = proxyRegions.flatMap(\.nodes)
        if target == ConfigPipeline.homeNodeName {
            guard AppProfile.homeExitEnabled else { return false }
            selectedNodeId = ConfigPipeline.homeNodeName
            activeNode = nil
            proxyService.activeNodeName = ConfigPipeline.homeNodeName
            return true
        }
        if let node = localProxyNode(matching: target) {
            selectedNodeId = node.id
            activeNode = node
            proxyService.activeNodeName = node.name
            return true
        }

        if let node = proxyService.nodes.first(where: { proxyTarget($0.name, matches: target) }) {
            selectedNodeId = node.name
            activeNode = localNodes.first(where: { proxyTarget($0.name, matches: node.name) })
            proxyService.activeNodeName = node.name
            return true
        }

        if let groupName = proxyGroupNames().first(where: { proxyTarget($0, matches: target) }) {
            selectedNodeId = groupName
            activeNode = nil
            proxyService.activeNodeName = groupName
            return true
        }

        return false
    }

    func applyDefaultProxySelection(persist: Bool) {
        if let node = defaultCloudExitNode() {
            selectedNodeId = node.id
            activeNode = node
            proxyService.activeNodeName = node.name
            if persist { persistProxySelection(node.name) }
        } else if AppProfile.homeExitEnabled {
            selectedNodeId = ConfigPipeline.homeNodeName
            activeNode = nil
            proxyService.activeNodeName = ConfigPipeline.homeNodeName
            if persist { persistProxySelection(ConfigPipeline.homeNodeName) }
        } else {
            selectedNodeId = nil
            activeNode = nil
            proxyService.activeNodeName = nil
            if persist { persistProxySelection(nil) }
        }
    }

    func proxyTarget(_ candidate: String, matches target: String) -> Bool {
        if candidate == target { return true }
        let cleanCandidate = ConfigParser.extractFlag(from: candidate).cleanName
        let cleanTarget = ConfigParser.extractFlag(from: target).cleanName
        return cleanCandidate == target || candidate == cleanTarget || cleanCandidate == cleanTarget
    }

    private func proxyGroupNames() -> [String] {
        var names = proxyService.groups.map(\.name)
        guard AppProfile.isDev else { return Array(Set(names)) }
        if let yaml = ConfigStorage.shared.loadSubscriptionYAML() {
            names.append(contentsOf: ConfigParser.parseClashYAMLProxyGroups(yaml).map(\.name))
        }
        return Array(Set(names))
    }

    // MARK: - Proxy Guard

    /// Periodically verify system proxy hasn't been tampered with by other software.
    func startProxyGuard() {
        stopProxyGuard()
        proxyGuardTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isConnected, SystemProxy.didSetProxy else { return }
                let intact = await PrivilegedRuntimeCoordinator.shared.systemProxyIsIntact()
                guard self.isConnected, SystemProxy.didSetProxy else { return }
                if !intact {
                    do {
                        try await PrivilegedRuntimeCoordinator.shared.reapplySystemProxy()
                        self.isProxyDegraded = false
                    } catch {
                        self.isProxyDegraded = true
                        self.errorMessage = String(localized: "System proxy lost: \(error.localizedDescription)")
                    }
                } else if self.isProxyDegraded {
                    self.isProxyDegraded = false
                }
            }
        }
    }

    func stopProxyGuard() {
        proxyGuardTimer?.invalidate()
        proxyGuardTimer = nil
    }

    // MARK: - Periodic Latency Test

    func startLatencyTestTimer() {
        stopLatencyTestTimer()
        // Bulk subscription sweeps stay banned in Tono mode — they would probe
        // the whole catalog. But the selected exit still needs re-measuring, or
        // the badge shows the number from connect time for the whole session
        // even after the line degrades.
        let interval: TimeInterval = isOwnedTonoMode ? 120 : 300
        latencyTestTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isConnected else { return }
                if self.isOwnedTonoMode {
                    guard let selected = self.proxyService.activeNodeName else { return }
                    _ = await self.proxyService.testLatency(name: selected)
                } else {
                    await self.proxyService.testAllLatency()
                }
            }
        }
    }

    func stopLatencyTestTimer() {
        latencyTestTimer?.invalidate()
        latencyTestTimer = nil
    }

    // MARK: - Apply Setting Changes at Runtime

    /// Dynamically apply a setting change via PATCH /configs without reconnecting.
    func applySettingChange(key: String, value: Any) {
        if isOwnedTonoMode {
            if key == "tun", let tun = value as? [String: Any], tun["enable"] as? Bool == false {
                errorMessage = String(localized: "Tono requires TUN mode while cloud protection is active.")
                return
            }
            if key == "allow-lan", value as? Bool == true {
                errorMessage = String(localized: "Tono does not expose the protected route to LAN clients.")
                return
            }
        }
        guard isConnected, let api = coreController else { return }

        Task {
            do {
                try await api.patchConfig([key: value])

                // If port changed, re-configure system proxy with new port
                if key == "mixed-port" || key == "port" || key == "socks-port" {
                    if let port = value as? Int {
                        config.mixedPort = port
                        config.port = port
                        config.socksPort = port
                    }
                    if !config.tunEnabled {
                        do {
                            try await PrivilegedRuntimeCoordinator.shared
                                .replaceSystemProxy(
                                    httpPort: config.mixedPort,
                                    socksPort: config.mixedPort
                                )
                        } catch {
                            self.errorMessage = String(
                                localized: "System proxy: \(error.localizedDescription)"
                            )
                        }
                    }
                }

                if key == "allow-lan", let val = value as? Bool {
                    config.allowLan = val
                }

                // TUN hot-switch: toggle system proxy accordingly
                if key == "tun", let tunDict = value as? [String: Any], let enable = tunDict["enable"] as? Bool {
                    config.tunEnabled = enable
                    if enable {
                        // TUN handles routing — disable system proxy
                        stopProxyGuard()
                        do {
                            try await PrivilegedRuntimeCoordinator.shared
                                .disableSystemProxyIfNeeded()
                            isProxyDegraded = false
                        } catch {
                            isProxyDegraded = true
                            errorMessage = String(
                                localized: "System proxy: \(error.localizedDescription)"
                            )
                        }
                    } else {
                        // TUN off — enable system proxy
                        do {
                            try await PrivilegedRuntimeCoordinator.shared
                                .enableSystemProxy(
                                    httpPort: config.mixedPort,
                                    socksPort: config.mixedPort
                                )
                            startProxyGuard()
                            isProxyDegraded = false
                        } catch {
                            isProxyDegraded = true
                            errorMessage = String(
                                localized: "System proxy: \(error.localizedDescription)"
                            )
                        }
                    }
                }
            } catch {
                errorMessage = String(
                    localized: "Could not apply the setting: \(error.localizedDescription)"
                )
            }
        }
    }

    // MARK: - API Data Fetching


    func fetchActiveRules() async {
        guard let api = coreController else {
            print("[Tono]","fetchActiveRules: no API")
            return
        }
        for delay in [0, 1, 2, 5] {
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
            }
            guard isConnected else { return }
            do {
                let rulesResponse = try await api.getRules()
                let providersResponse = try? await api.getRuleProviders()
                let providerTotal = providersResponse?.providers.values.reduce(0) { $0 + $1.ruleCount } ?? 0
                print("[Tono]","fetchActiveRules: \(rulesResponse.rules.count) inline rules, \(providersResponse?.providers.count ?? 0) providers (\(providerTotal) total)")
                await MainActor.run {
                    self.activeRules = rulesResponse.rules
                    self.ruleProviders = providersResponse?.providers ?? [:]
                }
                if providerTotal > 0 { return }
            } catch {
                print("[Tono]","fetchActiveRules failed: \(error)")
            }
        }
    }

    /// Load all provider rules for search by reading local cache files.
    /// mihomo API doesn't expose provider rule contents, so we read the YAML files directly.
    func loadProviderRulesForSearch() {
        guard isConnected, !providerRulesLoaded, !isLoadingProviderRules else { return }
        isLoadingProviderRules = true

        let providers = ruleProviders
        let inlineRules = activeRules
        let rulesetDir = coreRuntime.configDirectory.appendingPathComponent("ruleset")
        Task { [weak self] in
            guard let self else { return }
            let allRules = await providerRuleLoader.load(
                providers: providers,
                inlineRules: inlineRules,
                directory: rulesetDir
            )
            guard isConnected else {
                isLoadingProviderRules = false
                return
            }
            providerRulesCache = allRules
            providerRulesLoaded = true
            isLoadingProviderRules = false
        }
    }

    /// Run curl on a background thread through either Mihomo's explicit local
    /// proxy or the ordinary system route that applications use.
    private func curlHTTPS(
        _ urlString: String,
        timeout: Int = 6,
        useExplicitProxy: Bool
    ) async -> String? {
        guard URL(string: urlString)?.scheme?.lowercased() == "https" else {
            return nil
        }
        let port = config.mixedPort
        let processBox = CancellableProcessBox()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    let proc = Process()
                    guard processBox.register(proc) else {
                        continuation.resume(returning: nil)
                        return
                    }
                    defer { processBox.clear(proc) }
                    proc.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
                    proc.environment = [
                        "PATH": "/usr/bin:/bin",
                        "LC_ALL": "C",
                    ]
                    var arguments = [
                        "--silent",
                        "--show-error",
                        "--fail",
                        "--proto", "=https",
                        "--proto-redir", "=https",
                        "--max-redirs", "0",
                        "--max-filesize", "\(64 * 1_024)",
                        "--max-time", "\(timeout)",
                    ]
                    if useExplicitProxy {
                        arguments += [
                            "--proxy", "http://127.0.0.1:\(port)",
                            "--noproxy", "",
                        ]
                    } else {
                        arguments += ["--noproxy", "*"]
                    }
                    arguments.append(urlString)
                    proc.arguments = arguments
                    let pipe = Pipe()
                    proc.standardOutput = pipe
                    proc.standardError = FileHandle.nullDevice
                    do {
                        try proc.run()
                        var data = Data()
                        var exceededLimit = false
                        while let chunk = try pipe.fileHandleForReading.read(upToCount: 16 * 1_024),
                              !chunk.isEmpty {
                            guard chunk.count <= 64 * 1_024 - data.count else {
                                exceededLimit = true
                                if proc.isRunning { proc.terminate() }
                                try? pipe.fileHandleForReading.close()
                                break
                            }
                            data.append(chunk)
                        }
                        proc.waitUntilExit()
                        guard !exceededLimit, proc.terminationStatus == 0 else {
                            continuation.resume(returning: nil)
                            return
                        }
                        continuation.resume(returning: String(decoding: data, as: UTF8.self))
                    } catch {
                        if proc.isRunning { proc.terminate() }
                        continuation.resume(returning: nil)
                    }
                }
            }
        } onCancel: {
            processBox.cancel()
        }
    }

    /// Verify the actual user-visible TUN route without consulting macOS proxy
    /// settings. This intentionally runs as the signed-in user: a root/helper
    /// probe or Mihomo's controller delay endpoint can succeed even when normal
    /// application packets are blocked before reaching the core.
    private func testSystemTUNDataPlaneWithRetry(
        timeout: Int = 8,
        attempts: Int = 2,
        retryIntervalMs: UInt64 = 500
    ) async -> Bool {
        let attemptCount = max(1, attempts)
        for attempt in 0..<attemptCount {
            if Task.isCancelled { return false }
            if case .won = await ProtectedConnectivityVerifier.raceSystemTUNProbes(
                timeoutSeconds: timeout
            ) {
                return true
            }

            guard attempt + 1 < attemptCount else { break }
            do {
                try await Task.sleep(for: .milliseconds(retryIntervalMs))
            } catch {
                return false
            }
        }
        return false
    }

    func advisoryControllerExitProbe(
        api: CoreControllerClient,
        selectedExit: ProxyNode?
    ) async -> ProbeCheck {
        guard selectedExit != nil else { return .ok }
        let health = await api.testProxyDelay(
            name: ConfigPipeline.exitGroupName,
            url: ProtectedProbeOrigin.google.url,
            timeout: 5_000
        )
        if let delay = health.delay, delay > 0 {
            return .ok
        }
        return .failed(health.message ?? "controller delay unavailable")
    }

    func verifyProtectedConnection(
        controller: ProbeCheck? = nil,
        controllerTask: Task<ProbeCheck, Never>? = nil,
        mixedPort: Int,
        generation: UInt64,
        rounds: Int
    ) async -> ConnectivityVerdict {
        var lastFailure: ProtectedFailure?
        for round in 1...max(1, rounds) {
            if Task.isCancelled {
                controllerTask?.cancel()
                return .failed(
                    ProtectedConnectivity.failure(
                        .unknownClassifiedFailure,
                        stage: "verifyingTraffic",
                        attempt: round,
                        generation: generation,
                        detail: "cancelled"
                    )
                )
            }
            if generation != connectionCoordinator.protectionOperationGeneration {
                controllerTask?.cancel()
                return .failed(
                    ProtectedConnectivity.failure(
                        .unknownClassifiedFailure,
                        stage: "verifyingTraffic",
                        attempt: round,
                        generation: generation,
                        detail: "stale generation"
                    )
                )
            }
            let includeMixed = round == max(1, rounds)
            let race = await ProtectedConnectivityVerifier.raceSystemTUNProbes(
                timeoutSeconds: 12,
                preferredLabel: lastSuccessfulProbeOrigin
            )
            if case .won(let label) = race {
                lastSuccessfulProbeOrigin = label
            }
            let tun = race.tunCheck
            let mixed: ProbeCheck?
            if includeMixed, case .failed = tun {
                switch await ProtectedConnectivityVerifier.raceSystemTUNProbes(
                    timeoutSeconds: 8,
                    mixedProxyPort: mixedPort
                ) {
                case .won:
                    mixed = .ok
                case .lost(let probes):
                    mixed = .failed(probes.map(\.redactedDetail).joined(separator: "; "))
                }
            } else {
                mixed = nil
            }
            let controllerResult: ProbeCheck
            if case .ok = tun {
                controllerResult = controller ?? .ok
            } else if includeMixed {
                if let controller {
                    controllerResult = controller
                } else if let controllerTask {
                    controllerResult = await controllerTask.value
                } else {
                    controllerResult = .ok
                }
            } else {
                controllerResult = controller ?? .ok
            }
            let decision = ProtectedConnectivity.classifyPostLock(
                controller: controllerResult,
                tun: tun,
                mixed: mixed,
                networkOffline: PhysicalNetworkReachability.shared
                    .isPhysicallyOffline,
                stage: "verifyingTraffic",
                attempt: round,
                generation: generation
            )
            switch decision {
            case .connected(let advisory):
                ConnectionTelemetryBuffer.shared.record(
                    "probeResult",
                    reason: "ok",
                    counter: round,
                    generation: Int(generation)
                )
                return .connected(controllerAdvisory: advisory)
            case .retry(let failure):
                lastFailure = failure
                ConnectionTelemetryBuffer.shared.record(
                    "probeResult",
                    reason: failure.code.rawValue,
                    error: failure.detail,
                    counter: round,
                    generation: Int(generation)
                )
                if round < max(1, rounds) {
                    let delayRange = ProtectedConnectivity.postLockRoundDelayMsRange
                    let delay = UInt64.random(
                        in: UInt64(delayRange.lowerBound)...UInt64(delayRange.upperBound)
                    )
                    try? await Task.sleep(for: .milliseconds(delay))
                }
            }
        }
        return .failed(
            lastFailure ?? ProtectedConnectivity.failure(
                .unknownClassifiedFailure,
                stage: "verifyingTraffic",
                attempt: rounds,
                generation: generation,
                detail: "verification exhausted"
            )
        )
    }

    func scheduleBackgroundOptionalPolicy() {
        let policy = managedTrafficPolicy
        guard !policy.domains.isEmpty || !policy.webDomains.isEmpty else { return }
        // Arming PF, rewriting config.yaml, syncing it to the helper and
        // reloading the controller is the same runtime mutation the reload and
        // node-switch paths perform, and the helper hard-enforces the synced
        // digest. Take the shared serialization handle so two of them cannot
        // interleave, and so disconnect drains this one with the others rather
        // than letting it re-arm PF after a release.
        guard connectionCoordinator.configReloadTask == nil, switchingNodeId == nil else {
            ConnectionTelemetryBuffer.shared.record(
                "optionalPolicyRollback",
                reason: "runtime_mutation_in_flight",
                generation: Int(connectionCoordinator.protectionOperationGeneration)
            )
            return
        }
        ConnectionTelemetryBuffer.shared.record(
            "optionalPolicyBegin",
            revision: managedTrafficPolicyRevision,
            generation: Int(connectionCoordinator.protectionOperationGeneration)
        )
        connectionCoordinator.configReloadRequestID += 1
        let requestID = connectionCoordinator.configReloadRequestID
        connectionCoordinator.configReloadTask = Task { [weak self] in
            guard let self else { return }
            await self.applyOptionalDirectPolicyInBackground(policy: policy)
            self.finishConfigReloadRequest(requestID)
        }
    }

    private func applyOptionalDirectPolicyInBackground(policy: TonoTrafficPolicy) async {
        guard isConnected, !isDisconnecting, !Task.isCancelled,
              let api = coreController else { return }
        let generation = connectionCoordinator.protectionOperationGeneration
        ConnectionTelemetryBuffer.shared.record(
            "optionalPolicyBegin",
            action: "resolve",
            revision: managedTrafficPolicyRevision,
            generation: Int(generation)
        )
        let base = activeDirectPolicy
        let resolved = await resolveManagedDirectDomains(
            policy: policy,
            base: base,
            api: api
        )
        guard generation == connectionCoordinator.protectionOperationGeneration, isConnected,
              !Task.isCancelled else { return }
        guard let resolved, resolved != base else {
            ConnectionTelemetryBuffer.shared.record(
                "optionalPolicyRollback",
                reason: "unchanged_or_unresolved",
                generation: Int(generation)
            )
            return
        }
        do {
            try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                apiHosts: [],
                tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                proxyEndpoints: currentProxyEndpoints(),
                sessionDirectEndpoints: resolved.sessionEndpoints,
                tailscaleBootstrapEnabled: AppProfile.homeExitEnabled && tonoTransport != nil,
                helperPrepared: true,
                reviewedBundleDirect: resolved.requiresAddressFreeDirectPermit
            )
            guard generation == connectionCoordinator.protectionOperationGeneration,
                  !Task.isCancelled else { return }
            let runtimeNodes = importedExitNodes
            let overlay = currentOwnedRuntimeOverlay()
            let digest = try await coreRuntime.writeRuntimeConfig(
                overlay: overlay,
                customNodes: runtimeNodes,
                directPolicy: resolved
            )
            let runtimeConfigPath = try await PrivilegedRuntimeCoordinator.shared
                .syncCoreConfig(
                    configDirectory: coreRuntime.configDirectory.path,
                    configSHA256: digest
                )
            try await api.reloadConfig(path: runtimeConfigPath)
            // Disconnect cancels this task and then waits for it before it
            // restores DNS and disarms PF, so anything past here is time a user
            // who tapped Restore internet spends waiting. The verification
            // below is eight seconds of exactly that, and the session it would
            // verify is already going away.
            guard generation == connectionCoordinator.protectionOperationGeneration,
                  !Task.isCancelled else { return }
            loadedRuntimeConfigDigest = digest
            commitResidentialRouteAuditContext(
                overlay: overlay,
                nodes: runtimeNodes,
                digest: digest
            )
            let tun = await ProtectedConnectivityVerifier.raceSystemTUNProbes(timeoutSeconds: 8)
            guard generation == connectionCoordinator.protectionOperationGeneration else { return }
            if case .lost = tun {
                ConnectionTelemetryBuffer.shared.record(
                    "optionalPolicyRollback",
                    reason: "tun_failed_after_reload",
                    generation: Int(generation)
                )
                // Roll back the same three copies the forward transaction
                // changed. Rewriting only the user-owned file left the helper's
                // root snapshot and the live core on the failed policy. Keep
                // the home-routing directives too: omitting them silently
                // changed Claude's egress identity during rollback.
                let rollbackOverlay = currentOwnedRuntimeOverlay()
                let rollbackNodes = importedExitNodes
                let rollbackDigest = try await coreRuntime.writeRuntimeConfig(
                    overlay: rollbackOverlay,
                    customNodes: rollbackNodes,
                    directPolicy: base
                )
                let rollbackPath = try await PrivilegedRuntimeCoordinator.shared
                    .syncCoreConfig(
                        configDirectory: coreRuntime.configDirectory.path,
                        configSHA256: rollbackDigest
                    )
                try await api.reloadConfig(path: rollbackPath)
                loadedRuntimeConfigDigest = rollbackDigest
                commitResidentialRouteAuditContext(
                    overlay: rollbackOverlay,
                    nodes: rollbackNodes,
                    digest: rollbackDigest
                )
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    apiHosts: [],
                    tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                    proxyEndpoints: currentProxyEndpoints(),
                    sessionDirectEndpoints: base?.sessionEndpoints ?? [],
                    tailscaleBootstrapEnabled:
                        AppProfile.homeExitEnabled && tonoTransport != nil,
                    helperPrepared: true,
                    reviewedBundleDirect:
                        base?.requiresAddressFreeDirectPermit == true
                )
                return
            }
            activeDirectPolicy = resolved
            ConnectionTelemetryBuffer.shared.record(
                "optionalPolicyCommit",
                revision: managedTrafficPolicyRevision,
                generation: Int(generation)
            )
        } catch {
            ConnectionTelemetryBuffer.shared.record(
                "optionalPolicyRollback",
                error: error.localizedDescription,
                generation: Int(generation)
            )
        }
    }

    private func testSystemTUNDataPlane(
        timeout: Int = 8,
        resolvedAddress: String? = nil
    ) async -> Bool {
        guard config.tunEnabled else { return true }
        let processBox = CancellableProcessBox()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    let proc = Process()
                    guard processBox.register(proc) else {
                        continuation.resume(returning: false)
                        return
                    }
                    defer { processBox.clear(proc) }
                    proc.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
                    proc.environment = [
                        "PATH": "/usr/bin:/bin",
                        "LC_ALL": "C",
                    ]
                    var arguments = [
                        "--silent",
                        "--show-error",
                        "--output", "/dev/null",
                        "--write-out", "%{http_code}",
                        "--proto", "=https",
                        "--max-redirs", "0",
                        "--connect-timeout", "\(max(2, timeout - 2))",
                        "--max-time", "\(max(3, timeout))",
                        "--noproxy", "*",
                    ]
                    if let resolvedAddress {
                        arguments += [
                            "--resolve",
                            "www.gstatic.com:443:\(resolvedAddress)",
                        ]
                    }
                    arguments.append("https://www.gstatic.com/generate_204")
                    proc.arguments = arguments
                    let output = Pipe()
                    proc.standardOutput = output
                    proc.standardError = FileHandle.nullDevice
                    do {
                        try proc.run()
                        proc.waitUntilExit()
                        let data = output.fileHandleForReading.readDataToEndOfFile()
                        let status = String(decoding: data, as: UTF8.self)
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        continuation.resume(
                            returning: proc.terminationStatus == 0 && status == "204"
                        )
                    } catch {
                        if proc.isRunning { proc.terminate() }
                        continuation.resume(returning: false)
                    }
                }
            }
        } onCancel: {
            processBox.cancel()
        }
    }

    /// Fixed, parameter-free probes used only by the explicitly opted-in
    /// Claude research action. Raw IPs remain in the local mode-0600 audit;
    /// the control plane receives only bounded verdicts.
    func claudeTrafficResearchSnapshot() async
        -> TonoClaudeTrafficResearchSnapshot {
        guard LocalTrafficAudit.isClaudeTrafficResearchEnabled else {
            return LocalTrafficAudit.shared.claudeTrafficResearchSnapshot()
        }
        async let exitIdentity = probeExitIdentityConsistency()
        async let physicalBypass = probePhysicalInterfaceBypass()
        return LocalTrafficAudit.shared.claudeTrafficResearchSnapshot(
            exitIdentityConsistency: await exitIdentity,
            physicalBypassProbe: await physicalBypass
        )
    }

    private func probeExitIdentityConsistency() async -> String {
        guard isConnected, !isProtectionBlocked else { return "INCONCLUSIVE" }
        async let systemRaw = curlHTTPS(
            "https://api.ipapi.is",
            timeout: 8,
            useExplicitProxy: false
        )
        async let proxyRaw = curlHTTPS(
            "https://api.ipapi.is",
            timeout: 8,
            useExplicitProxy: true
        )
        let systemIP = Self.exitIPAddress(from: await systemRaw)
        let proxyIP = Self.exitIPAddress(from: await proxyRaw)
        let verdict: String
        if let systemIP, let proxyIP {
            verdict = systemIP == proxyIP ? "MATCHED" : "MISMATCHED"
        } else {
            verdict = "INCONCLUSIVE"
        }
        LocalTrafficAudit.shared.recordEvent(
            "claude_exit_identity_probe",
            details: [
                "verdict": verdict,
                "system_exit_ip": systemIP ?? "unknown",
                "proxy_exit_ip": proxyIP ?? "unknown",
            ]
        )
        return verdict
    }

    private func probePhysicalInterfaceBypass() async -> String {
        guard isConnected, !isProtectionBlocked, let api = coreController,
              let address = try? await api.resolveIPv4("www.gstatic.com").first,
              await testSystemTUNDataPlane(
                timeout: 6,
                resolvedAddress: address
              ) else {
            return "INCONCLUSIVE"
        }
        let detectedInterface = await PrivilegedRuntimeCoordinator.shared
            .primaryNetworkInterface()
        let currentPhysicalInterface = detectedInterface.flatMap {
            $0 != "lo0" && !$0.hasPrefix("utun") ? $0 : nil
        }
        let interface = currentPhysicalInterface
            ?? activeDirectPolicy?.physicalInterface
        guard let interface, interface != "lo0",
              !interface.hasPrefix("utun") else {
            return "INCONCLUSIVE"
        }
        let result = await Self.probePhysicalTCP(
            address: address,
            interface: interface,
            timeoutMilliseconds: 4_000
        )
        let verdict = switch result {
        case .blocked: "BLOCKED"
        case .reachable: "REACHABLE"
        case .inconclusive: "INCONCLUSIVE"
        }
        LocalTrafficAudit.shared.recordEvent(
            "claude_physical_bypass_probe",
            details: ["verdict": verdict, "interface": interface]
        )
        return verdict
    }

    nonisolated private static func probePhysicalTCP(
        address: String,
        interface: String,
        timeoutMilliseconds: Int32
    ) async -> PhysicalBypassSocketResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(
                    returning: physicalTCPProbe(
                        address: address,
                        interface: interface,
                        timeoutMilliseconds: timeoutMilliseconds
                    )
                )
            }
        }
    }

    nonisolated private static func physicalTCPProbe(
        address: String,
        interface: String,
        timeoutMilliseconds: Int32
    ) -> PhysicalBypassSocketResult {
        var ipv4 = in_addr()
        guard inet_pton(AF_INET, address, &ipv4) == 1 else {
            return .inconclusive
        }
        var interfaceIndex = if_nametoindex(interface)
        guard interfaceIndex != 0 else { return .inconclusive }

        let descriptor = Darwin.socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
        guard descriptor >= 0 else { return .inconclusive }
        defer { Darwin.close(descriptor) }
        guard setsockopt(
            descriptor,
            IPPROTO_IP,
            IP_BOUND_IF,
            &interfaceIndex,
            socklen_t(MemoryLayout.size(ofValue: interfaceIndex))
        ) == 0,
              fcntl(descriptor, F_SETFL, O_NONBLOCK) == 0 else {
            return .inconclusive
        }

        var destination = sockaddr_in()
        destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        destination.sin_family = sa_family_t(AF_INET)
        destination.sin_port = UInt16(443).bigEndian
        destination.sin_addr = ipv4
        let connectResult = withUnsafePointer(to: &destination) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(
                    descriptor,
                    $0,
                    socklen_t(MemoryLayout<sockaddr_in>.size)
                )
            }
        }
        if connectResult == 0 { return .reachable }
        let initialError = errno
        if initialError == ECONNREFUSED || initialError == ECONNRESET {
            return .reachable
        }
        guard initialError == EINPROGRESS else { return .inconclusive }

        var event = pollfd(
            fd: descriptor,
            events: Int16(POLLOUT),
            revents: 0
        )
        let pollResult = Darwin.poll(&event, 1, timeoutMilliseconds)
        if pollResult == 0 { return .blocked }
        guard pollResult > 0 else { return .inconclusive }

        var socketError: Int32 = 0
        var socketErrorLength = socklen_t(MemoryLayout.size(ofValue: socketError))
        guard getsockopt(
            descriptor,
            SOL_SOCKET,
            SO_ERROR,
            &socketError,
            &socketErrorLength
        ) == 0 else {
            return .inconclusive
        }
        if socketError == 0 || socketError == ECONNREFUSED
            || socketError == ECONNRESET {
            return .reachable
        }
        return socketError == ETIMEDOUT ? .blocked : .inconclusive
    }

    private static func exitIPAddress(from raw: String?) -> String? {
        guard let raw, raw.utf8.count <= 64 * 1_024,
              let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
              let ip = json["ip"] as? String,
              !ip.isEmpty, ip.utf8.count <= 64,
              !ip.contains(where: { $0.isWhitespace }) else {
            return nil
        }
        return ip
    }

    nonisolated static func waitForOwnedTunnelInterface(
        attempts: Int = 50,
        intervalMs: UInt64 = 100
    ) async -> Bool {
        for _ in 0..<max(1, attempts) {
            if Task.isCancelled { return false }
            if KillSwitchService.interfaceExists(ConfigPipeline.tonoTunInterface) {
                return true
            }
            try? await Task.sleep(for: .milliseconds(intervalMs))
        }
        return KillSwitchService.interfaceExists(ConfigPipeline.tonoTunInterface)
    }

    /// Query Mihomo's DNS listener directly while macOS is still using its
    /// original resolver. A fake-IP answer proves all of the following before
    /// the system mutation: port 53 is owned by this core, its internal DNS
    /// module is active, and its DoH request can traverse Tono-Exit.
    ///
    /// The listener can lag the controller bind by a few hundred milliseconds.
    /// Keep the same 5 s ceiling, but spend it on short retries instead of one
    /// long `dig` that treats "not bound yet" the same as a dead exit.
    func testLocalProtectedDNS(timeout: Int = 5) async -> Bool {
        let deadline = Date().addingTimeInterval(TimeInterval(max(1, timeout)))
        while Date() < deadline {
            if Task.isCancelled { return false }
            let remaining = max(1, Int(deadline.timeIntervalSinceNow.rounded(.up)))
            if await testProtectedDNS(
                server: ProtectedDNSContract.server,
                port: ProtectedDNSContract.port,
                timeout: min(2, remaining)
            ) {
                return true
            }
            if Date() >= deadline { break }
            try? await Task.sleep(for: .milliseconds(150))
        }
        return false
    }

    func testSystemProtectedDNS() async -> Bool {
        for attempt in 0..<3 {
            let timeout = attempt == 0 ? 1 : 2
            if await testProtectedDNS(server: nil, port: nil, timeout: timeout) {
                return true
            }
            guard attempt < 2, !Task.isCancelled else { return false }
            try? await Task.sleep(for: .milliseconds(200))
        }
        return false
    }

    /// Chromium writes Local State by replace/rename. One short retry keeps a
    /// harmless in-flight atomic save from looking like a permanent scan gap;
    /// a second incomplete result remains fail-closed.
    func scanBrowserProtectedDNS() async -> BrowserDNSDiagnostics.Report {
        let first = await Task.detached(priority: .userInitiated) {
            BrowserDNSDiagnostics.scan()
        }.value
        guard first.outcome == .incomplete, !Task.isCancelled else { return first }
        try? await Task.sleep(for: .milliseconds(150))
        guard !Task.isCancelled else { return first }
        return await Task.detached(priority: .userInitiated) {
            BrowserDNSDiagnostics.scan()
        }.value
    }

    func recordBrowserDNSPreflight(_ report: BrowserDNSDiagnostics.Report) {
        for (browser, result) in [
            ("chrome", report.chrome), ("edge", report.edge),
        ] {
            ConnectionTelemetryBuffer.shared.record(
                "browserDNSPreflight",
                probe: browser,
                reason: result.failureReason?.rawValue,
                mode: result.source.rawValue,
                counter: result.preferenceStoreCount,
                generation: Int(connectionCoordinator.protectionOperationGeneration),
                outcome: result.outcome.rawValue
            )
        }
    }

    /// Distinguish Encrypted DNS / Private Relay hijacks from a dead listener.
    /// The listener preflight already passed; a public system answer means
    /// macOS is not using 127.0.0.1:53.
    func systemProtectedDNSFailureMessage() async -> String {
        let listener = await ProtectedDNSProbe.queryListener(
            server: ProtectedDNSContract.server,
            port: ProtectedDNSContract.port,
            timeout: 2
        )
        let system = await ProtectedDNSProbe.querySystemResolver(timeout: 2)
        if ProtectedDNSProbe.systemResolverBypassesProtectedListener(
            listenerAnswers: listener,
            systemAnswers: system
        ) {
            return String(
                localized: "This Mac is still using Encrypted DNS or iCloud Private Relay, so apps bypass Tono's protected resolver. Turn Encrypted DNS and Private Relay off, then reconnect."
            )
        }
        return String(
            localized: "The macOS protected DNS path did not pass its end-to-end check."
        )
    }

    private func testProtectedDNS(
        server: String?,
        port: Int?,
        timeout: Int
    ) async -> Bool {
        let budget = TimeInterval(max(1, timeout))
        let answers: [String]
        if let server, let port {
            answers = await ProtectedDNSProbe.queryListener(
                server: server,
                port: port,
                timeout: budget
            )
        } else {
            answers = await ProtectedDNSProbe.querySystemResolver(timeout: budget)
        }
        return ProtectedDNSProbe.containsFakeIP(answers)
    }

    func fetchNetworkInfo() async {
        // This is display-only work. Never close user connections here: the
        // explicit node-switch and config-reload transactions already close
        // stale flows before requesting refreshed exit information.
        await MainActor.run { self.networkInfo = NetworkInfo() }

        // Try immediately, then use short bounded retries while the selected
        // Reality path settles. The old unconditional two-second pause made
        // every successful connection and node switch feel unresponsive.
        for attempt in 0..<7 {
            if attempt > 0 {
                try? await Task.sleep(for: .seconds(1))
            }
            guard isConnected, !Task.isCancelled else { return }

            if let raw = await curlHTTPS(
                "https://api.ipapi.is",
                useExplicitProxy: true
            ),
               let data = raw.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               json["error"] == nil,
               let ip = json["ip"] as? String, !ip.isEmpty {
                // The response is flat: `cc`, `asn_org`, `company_name`, and the
                // `is_*` risk flags. It used to nest `location` and `asn`, and
                // reading those keys is why the exit row showed "--" for both
                // fields on every install. Nested forms are still accepted so a
                // provider that restores them does not break this again.
                let nestedLocation = json["location"] as? [String: Any]
                let nestedASN = json["asn"] as? [String: Any]
                let country = (json["cc"] as? String)
                    ?? (nestedLocation?["country_code"] as? String)
                    ?? ""
                let city = nestedLocation?["city"] as? String ?? ""
                let organisation = (json["asn_org"] as? String)
                    ?? (json["company_name"] as? String)
                    ?? (nestedASN?["org"] as? String)
                    ?? ""
                let located = [city, country]
                    .filter { !$0.isEmpty }
                    .joined(separator: ", ")
                let info = NetworkInfo(
                    ip: ip,
                    org: organisation.isEmpty ? "--" : organisation,
                    location: located.isEmpty ? "--" : located
                )
                networkInfo = info
                // The risk flags go to the audit trail, not to the exit row. They
                // are one vendor's ASN-ownership heuristic, and the residential
                // hops this product sells are flagged `is_datacenter` by it while
                // working perfectly against the service that matters. Showing a
                // verdict that contradicts the product would alarm a user over a
                // disagreement between two vendors; recording it lets support see
                // the same disagreement when it is relevant.
                let flag = { (key: String) in
                    (json[key] as? Bool).map { $0 ? "true" : "false" } ?? "--"
                }
                LocalTrafficAudit.shared.recordEvent(
                    "exit_identity_observed",
                    details: [
                        "exit_ip": info.ip,
                        "location": info.location,
                        "asn_org": info.org,
                        "vendor_datacenter": flag("is_datacenter"),
                        "vendor_vpn": flag("is_vpn"),
                        "vendor_proxy": flag("is_proxy"),
                    ]
                )
                return
            }
        }
    }

    // MARK: - Update Connections from WebSocket

    /// Returns the number of connections the list is willing to show, which is
    /// what the "active connections" headline must report.
    @discardableResult
    func updateConnections(from response: APIConnectionsResponse) -> Int {
        guard let apiConnections = response.connections else {
            connections = []
            connectionsDisplayLimited = false
            return 0
        }
        let timestamp = Date.now.formatted(
            .dateTime.hour(.twoDigits(amPM: .omitted))
                .minute(.twoDigits)
                .second(.twoDigits)
        )
        let cap = ConnectionActivityPresentation.maxDisplayed
        // /connections comes back in no guaranteed order, so capping it raw
        // could drop the newest flows while claiming to show them, and rows
        // reshuffled on every frame. `start` is RFC3339, so descending string
        // order is descending time order.
        let visible = apiConnections
            .filter { !ConnectionActivityPresentation.isLoopback($0) }
            .sorted { $0.start > $1.start }
        let visibleCount = visible.count
        let mapped = visible.prefix(cap).map {
            connectionEntry(from: $0, timestamp: timestamp)
        }
        connections = Array(mapped)
        connectionsDisplayLimited = visibleCount > cap
        return visibleCount
    }

    private func connectionEntry(
        from conn: APIConnection,
        timestamp: String
    ) -> ConnectionEntry {
        let type = ConnectionActivityPresentation.type(for: conn)
        let chainNode = conn.chains.first ?? "Direct"
        let flag = ConfigParser.guessFlag(from: chainNode)
        let destinationHost = conn.metadata.destinationIP ?? "unknown"
        let destination = conn.metadata.destinationPort.map {
            "\(destinationHost):\($0)"
        } ?? destinationHost
        let host = conn.metadata.host.isEmpty
            ? (conn.metadata.destinationIP ?? "unknown")
            : conn.metadata.host
        let process = appTrafficLedger.resolvedProcessName(for: conn)
        return ConnectionEntry(
            id: conn.id,
            domain: host,
            protocolName: conn.metadata.type,
            rule: "\(conn.rule)\(conn.rulePayload.map { " (\($0))" } ?? "")",
            nodeFlag: flag,
            nodeName: chainNode,
            latency: nil,
            dataSize: formatBytes(conn.download + conn.upload),
            dataLabel: "Traffic",
            timestamp: timestamp,
            type: type,
            network: conn.metadata.network.uppercased(),
            destination: destination,
            processName: process == AppTrafficLedger.unattributed ? nil : process,
            route: conn.chains.isEmpty
                ? "Direct"
                : conn.chains.joined(separator: " → "),
            uploadText: formatBytes(conn.upload),
            downloadText: formatBytes(conn.download)
        )
    }

    /// Resolves the control-plane host through the protected resolver and stores
    /// the answer for the helper's next arm.
    ///
    /// Runs only while connected, which is the whole point: the resolver reached
    /// here is Mihomo's, over the tunnel, so this never queries the physical
    /// network's DNS — the exact thing `allowSystemResolution: false` exists to
    /// prevent during protected recovery.
    func refreshControlPlanePinCache(api: CoreControllerClient) async {
        guard let host = TonoAPIClient.configuredBaseURL().host?.lowercased(),
              !host.isEmpty else { return }
        guard let answers = try? await api.resolveIPv4(host), !answers.isEmpty else {
            return
        }
        KillSwitchService.rememberControlPlaneAddresses(answers, for: host)
    }

    func trafficAuditProtectionSnapshot()
        -> TrafficAuditProtectionSnapshot {
        TrafficAuditProtectionSnapshot(
            connected: isConnected,
            connecting: isConnecting,
            protectionBlocked: isProtectionBlocked,
            killSwitchArmed: KillSwitchService.isArmed,
            tunPresent: KillSwitchService.interfaceExists(
                ConfigPipeline.tonoTunInterface
            ),
            protectedDNSConfigured: protectedDNSService != nil,
            selectedExit: proxyService.activeNodeName
                ?? activeNode?.name
                ?? selectedNodeId
                ?? "unknown"
        )
    }

    private func currentOwnedRuntimeOverlay() -> ConfigPipeline.OverlayConfig {
        ConfigPipeline.OverlayConfig(
            mixedPort: config.mixedPort,
            externalController: config.externalController,
            secret: config.secret,
            mode: "rule",
            logLevel: "warning",
            allowLan: false,
            tunEnabled: true,
            selectedNodeName: selectedExitNode()?.name ?? ConfigPipeline.homeNodeName,
            tonoTransport: tonoTransport,
            claudeHomeNodeName: managedCatalogRouting?.homeProxy,
            defaultNodeName: managedCatalogRouting?.defaultProxy,
            claudeHomeSocks5: managedCatalogRouting?.homeSocks5
        )
    }

    func commitResidentialRouteAuditContext(
        overlay: ConfigPipeline.OverlayConfig,
        nodes: [ProxyNode],
        digest: String
    ) {
        // A native start/reload can finish after disconnect cancelled its
        // caller. Never resurrect that runtime's admission in a later session.
        guard !Task.isCancelled, isConnected || isConnecting else { return }
        let terminal: String?
        do {
            terminal = try ConfigPipeline.admittedResidentialTerminal(
                overlay: overlay,
                customNodes: nodes
            )
        } catch {
            // Generation already succeeded with the same validation, so this
            // can only indicate programmer drift. Keep the prior evidence
            // rather than publishing a context that did not describe runtime.
            return
        }
        residentialRouteAuditGeneration &+= 1
        let context = ResidentialRouteAuditContext(
            generation: residentialRouteAuditGeneration,
            runtimeConfigDigest: digest,
            admittedTerminal: terminal
        )
        residentialRouteAuditContext = context
        LocalTrafficAudit.shared.setResidentialRouteContext(context)
        LocalTrafficAudit.setAssistantDirectFirstMember(terminal)
        // Callback-time lookup alone would stamp a buffered old WebSocket
        // frame with the new context. Invalidate its receive task at commit.
        webSocket?.restartConnectionsStreamAfterRuntimeChange()
    }

    func compactRemoteDiagnosticSnapshot() -> TonoDiagnosticSnapshot {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        let selected = proxyService.activeNodeName ?? activeNode?.name ?? "unknown"
        let stageLabel: String
        if isConnecting {
            stageLabel = connectionStage.rawValue
        } else if isDisconnecting {
            stageLabel = disconnectionStage.rawValue
        } else if isProtectionBlocked {
            stageLabel = "Protected Offline"
        } else if isConnected {
            stageLabel = "Protected"
        } else {
            stageLabel = "Standby"
        }
        let lastErrorCategory: String? = errorMessage.map { _ in
            switch lastConnectionFailure?.stage {
            case .preparing: "preparation"
            case .preparingHelper: "helper"
            case .startingKillSwitch, .lockingTraffic: "kill_switch"
            case .startingTunnel: "tunnel"
            case .applyingCloudPolicy: "policy"
            case .securingDNS: "dns"
            case .checkingExit: "exit_check"
            case .verifyingTraffic: "data_plane"
            case nil: "other"
            }
        }
        return TonoDiagnosticSnapshot(
            appVersion: String(version.prefix(100)), build: String(build.prefix(100)),
            connected: isConnected, connecting: isConnecting, disconnecting: isDisconnecting,
            protectionBlocked: isProtectionBlocked, killSwitchArmed: KillSwitchService.isArmed,
            utunPresent: KillSwitchService.interfaceExists(ConfigPipeline.tonoTunInterface),
            protectedDNSConfigured: protectedDNSService != nil,
            selectedExit: String(selected.prefix(100)), connectionStage: String(stageLabel.prefix(100)),
            reconnectAttempt: min(max(protectedReconnectAttempt, 0), 1000),
            lastErrorCategory: lastErrorCategory,
            lastCrashLabel: nil,
            catalogRevision: managedCatalogVersion
        )
    }

    func auditProtectionDetails() -> [String: String] {
        let snapshot = trafficAuditProtectionSnapshot()
        return [
            "connected": String(snapshot.connected),
            "connecting": String(snapshot.connecting),
            "protection_blocked": String(snapshot.protectionBlocked),
            "kill_switch_armed": String(snapshot.killSwitchArmed),
            "tun_present": String(snapshot.tunPresent),
            "protected_dns_configured": String(
                snapshot.protectedDNSConfigured
            ),
            "selected_exit": snapshot.selectedExit,
        ]
    }
}

// MARK: - Helpers

private func formatBytes(_ bytes: Int64) -> String {
    ConnectionByteFormat.string(bytes)
}

private enum ConnectionByteFormat {
    static func string(_ bytes: Int64) -> String {
        formatter.string(fromByteCount: bytes)
    }

    private static let formatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useBytes, .useKB, .useMB, .useGB]
        formatter.countStyle = .binary
        formatter.allowsNonnumericFormatting = false
        return formatter
    }()
}
