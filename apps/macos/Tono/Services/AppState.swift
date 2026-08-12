import SwiftUI
import Observation
import Security
import CryptoKit
import Darwin

nonisolated private final class CancellableProcessBox: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false

    func register(_ process: Process) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !cancelled else { return false }
        self.process = process
        return true
    }

    func clear(_ process: Process) {
        lock.lock()
        if self.process === process {
            self.process = nil
        }
        lock.unlock()
    }

    func cancel() {
        let running: Process?
        lock.lock()
        cancelled = true
        running = process
        lock.unlock()
        if running?.isRunning == true {
            running?.terminate()
        }
    }
}

nonisolated private enum PhysicalBypassSocketResult: Sendable {
    case blocked
    case reachable
    case inconclusive
}

nonisolated private enum ManagedDirectHealthResult: Sendable {
    case direct
    case protectedExit
    case unavailable
    case controllerError(String)
}

private actor ProviderRuleLoader {
    private static let maximumProviderBytes = 8 * 1_024 * 1_024
    private static let maximumRules = 200_000

    func load(
        providers: [String: APIRuleProvider],
        inlineRules: [APIRule],
        directory: URL
    ) -> [APIRule] {
        var providerProxyMap: [String: String] = [:]
        for rule in inlineRules
            where rule.type == "RuleSet" || rule.type == "RULE-SET"
        {
            providerProxyMap[rule.payload] = rule.proxy
        }

        var allRules: [APIRule] = []
        for (name, provider) in providers.sorted(by: { $0.key < $1.key }) {
            guard name.utf8.count <= 255,
                  !name.contains("/"),
                  !name.contains("\\"),
                  name != ".",
                  name != ".." else { continue }
            let filePath = directory.appendingPathComponent("\(name).yaml")
            guard let values = try? filePath.resourceValues(forKeys: [
                .isRegularFileKey,
                .isSymbolicLinkKey,
                .fileSizeKey,
            ]),
                  values.isRegularFile == true,
                  values.isSymbolicLink != true,
                  let size = values.fileSize,
                  size > 0,
                  size <= Self.maximumProviderBytes,
                  let content = try? String(contentsOf: filePath, encoding: .utf8)
            else { continue }

            let proxyTarget = providerProxyMap[name] ?? name
            let behavior = provider.behavior.lowercased()
            let defaultType = behavior == "ipcidr" ? "IP-CIDR" : "DOMAIN"
            for line in content.components(separatedBy: .newlines) {
                guard allRules.count < Self.maximumRules else { return allRules }
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard trimmed.hasPrefix("- ") else { continue }
                let value = String(trimmed.dropFirst(2))
                    .trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
                guard !value.isEmpty else { continue }

                if behavior == "classical" {
                    let parts = value.split(separator: ",", maxSplits: 1)
                    if parts.count == 2 {
                        allRules.append(APIRule(
                            type: String(parts[0]),
                            payload: String(parts[1]),
                            proxy: proxyTarget
                        ))
                    } else {
                        allRules.append(APIRule(
                            type: defaultType,
                            payload: value,
                            proxy: proxyTarget
                        ))
                    }
                } else {
                    let cleanValue = value.hasPrefix("+.")
                        ? String(value.dropFirst(2))
                        : value
                    allRules.append(APIRule(
                        type: defaultType,
                        payload: cleanValue,
                        proxy: proxyTarget
                    ))
                }
            }
        }
        return allRules
    }
}

nonisolated private struct InitialDiskSnapshot: Sendable {
    let proxyRegions: [ProxyRegion]
    let rules: [RuleItem]
    let cachedCatalog: ManagedExitCatalogCache?
    let cachedTrafficPolicy: ManagedTrafficPolicyCache?
    let config: ClashConfig?
}

enum ConnectionStage: String, CaseIterable, Hashable {
    case preparing = "Preparing protection…"
    case preparingHelper = "Preparing secure helper…"
    case startingKillSwitch = "Starting Kill Switch…"
    case startingTunnel = "Starting protected tunnel…"
    case lockingTraffic = "Locking traffic to tunnel…"
    case applyingCloudPolicy = "Applying secure app routing…"
    case securingDNS = "Securing DNS…"
    case checkingExit = "Checking secure exit…"
    case verifyingTraffic = "Verifying traffic protection…"
}

enum DisconnectionStage: String {
    case finishingOperation = "Finishing the current operation…"
    case stoppingTunnel = "Stopping the protected tunnel…"
    case preservingProtection = "Keeping direct traffic blocked…"
    case restoringDNS = "Restoring system DNS…"
    case restoringNetwork = "Restoring network access…"
}

struct ConnectionFailure: Equatable {
    let stage: ConnectionStage
    let message: String
    let occurredAt: Date
}

private actor InitialDataLoader {
    func load() -> InitialDiskSnapshot {
        let storage = ConfigStorage.shared
        let rawSubscriptionYAML = storage.loadRawSubscriptionYAML()
        var rules = storage.loadRules() ?? []

        // Legacy subscription repair is useful only in the isolated developer
        // profile. Do the potentially large YAML parse here instead of during
        // the first SwiftUI render.
        if AppProfile.isDev {
            let needsRepair = rules.isEmpty
                || rules.contains { $0.policyName == nil && $0.policy == .proxy }
            let yamlHasRules = rawSubscriptionYAML?.components(
                separatedBy: .newlines
            ).contains {
                $0.trimmingCharacters(in: .whitespaces) == "rules:"
            } ?? false
            if needsRepair, yamlHasRules, let rawSubscriptionYAML {
                let parsed = ConfigParser.parseClashYAMLRules(
                    rawSubscriptionYAML,
                    source: .subscription
                )
                if !parsed.isEmpty {
                    rules = rules.filter { $0.source == .user } + parsed
                    storage.saveRules(rules)
                }
            }
        } else {
            // Production runtime rules are generated by ConfigPipeline and
            // queried from Mihomo. Never surface stale editable legacy rules.
            rules = []
        }

        return InitialDiskSnapshot(
            proxyRegions: storage.loadProxyRegions() ?? [],
            rules: rules,
            cachedCatalog: storage.loadManagedExitCatalog(),
            cachedTrafficPolicy: storage.loadManagedTrafficPolicy(),
            config: storage.loadConfig()
        )
    }
}

private actor ManagedCatalogProcessor {
    private var persistedRevision = -1
    private var persistedDigest: String?

    func validate(
        _ catalog: ManagedExitCatalogCache,
        customNodes: [ProxyNode]
    ) throws -> [ProxyNode] {
        guard catalog.revision >= 0,
              catalog.yaml.utf8.count <= 1024 * 1024,
              catalog.sha256 == Self.digest(catalog.yaml)
        else {
            throw TonoAPIClient.APIError.invalidResponse
        }

        var nodes = ConfigParser.parseSubscription(catalog.yaml)
        if nodes.isEmpty {
            guard catalog.yaml.trimmingCharacters(
                in: .whitespacesAndNewlines
            ) == "proxies: []" else {
                throw TonoAPIClient.APIError.invalidResponse
            }
        }
        for index in nodes.indices {
            nodes[index].subscriptionId = AppState.managedCatalogSourceID
        }
        nodes = try ConfigPipeline.validatedOwnedNodes(nodes)
        nodes = ConfigPipeline.orderedCloudExits(
            nodes,
            preferredName: AppProfile.defaultCloudExitName
        )
        _ = try ConfigPipeline.validatedOwnedNodes(nodes + customNodes)

        return nodes
    }

    /// Manual refresh and the minute timer may overlap. Preserve monotonic
    /// cache writes even if their validations finish out of order.
    func persistIfNewest(_ catalog: ManagedExitCatalogCache) throws {
        if catalog.revision < persistedRevision {
            return
        }
        if catalog.revision == persistedRevision {
            guard persistedDigest == catalog.sha256 else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            return
        }
        try ConfigStorage.shared.saveManagedExitCatalog(catalog)
        persistedRevision = catalog.revision
        persistedDigest = catalog.sha256
    }

    private static func digest(_ yaml: String) -> String {
        let digest = Data(SHA256.hash(data: Data(yaml.utf8)))
            .base64EncodedString()
        return digest
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
    }
}

private actor ManagedTrafficPolicyProcessor {
    private var persistedRevision = -1
    private var persistedDigest: String?

    func validate(
        _ cache: ManagedTrafficPolicyCache,
        protectedAddresses: Set<String>
    ) throws -> TonoTrafficPolicy {
        guard cache.revision >= 0,
              cache.json.utf8.count <= 64 * 1024,
              cache.sha256 == Self.digest(cache.json),
              let data = cache.json.data(using: .utf8),
              let policy = try? JSONDecoder().decode(
                TonoTrafficPolicy.self,
                from: data
              ),
              // Forward compatible. Pinning the accepted versions meant a revision
              // this build had not heard of discarded the whole document, so every
              // policy change needed a client release — and a missed release looks
              // exactly like an empty policy. The Windows client sat in that state
              // for days without a symptom anyone could name. A newer revision is
              // read as the newest shape this build knows; fields a declared
              // version does not promise are ignored below rather than required to
              // be absent.
              policy.version >= 1 else {
            throw TonoAPIClient.APIError.invalidResponse
        }
        let verdict = ManagedTrafficPolicySignature.verdict(
            json: cache.json,
            signature: cache.signature
        )
        if verdict == .untrustworthy {
            // Refused whole, unlike an entry this build does not understand. A
            // dropped entry is a document whose author is known and whose
            // contents are partly unsupported; a bad signature is a document
            // whose author is not known at all, and honouring any of it would
            // make the signature decorative.
            LocalTrafficAudit.shared.recordEvent(
                "managed_direct_policy_signature_rejected",
                details: [
                    "revision": String(cache.revision),
                    "policy_version": String(policy.version),
                ]
            )
            throw TonoAPIClient.APIError.invalidResponse
        }
        let trusted = verdict == .trusted
        // Trimmed rather than refused. A published list longer than this build's
        // limit means the limit is stale, and answering that by routing nothing at
        // all is worse than routing the part that fits.
        let declaredWeb = policy.version >= 2 ? Array(policy.webDomains.prefix(32)) : []
        let declaredSuffixes = policy.version >= 3 ? Array(policy.directSuffixes.prefix(64)) : []
        let declaredTCP = policy.version >= 4 ? Array(policy.tcpEndpoints.prefix(64)) : []
        let policyDomains = Array(policy.domains.prefix(32))
        let policyMedia = Array(policy.mediaEndpoints.prefix(64))

        // Dropped, not fatal, from here down. An entry this build will not honour is
        // still not routed — the safety property is unchanged — but it no longer
        // takes every other route in the document with it. Every drop is named in
        // `dropped` and recorded by the caller: replacing "silently discarded
        // everything" with "silently discarded some" would be the same fault.
        var dropped: [String] = []
        var seenHosts = Set<String>()
        let domains = policyDomains.compactMap { entry -> TonoTrafficPolicyDomain? in
            guard let host = try? ConfigPipeline.validatedManagedDirectDomain(entry.host, trusted: trusted),
                  host == entry.host,
                  seenHosts.insert(host).inserted,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                dropped.append(entry.host)
                return nil
            }
            return TonoTrafficPolicyDomain(
                host: host,
                ports: entry.ports.sorted()
            )
        }.sorted { $0.host < $1.host }

        var seenAddresses = Set<String>()
        let media = policyMedia.compactMap { entry -> TonoTrafficPolicyMediaEndpoint? in
            guard let address = try? ConfigPipeline.validatedPublicIPv4(
                    entry.address,
                    field: "managed media address"
                  ),
                  address == entry.address,
                  !protectedAddresses.contains(address),
                  seenAddresses.insert(address).inserted,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 443 || $0 == 8000 }) else {
                dropped.append(entry.address)
                return nil
            }
            return TonoTrafficPolicyMediaEndpoint(
                address: address,
                ports: entry.ports.sorted()
            )
        }.sorted { $0.address < $1.address }

        var seenTCPAddresses = Set<String>()
        let tcp = declaredTCP.compactMap { entry -> TonoTrafficPolicyMediaEndpoint? in
            guard let address = try? ConfigPipeline.validatedPublicIPv4(
                    entry.address,
                    field: "managed TCP address"
                  ),
                  address == entry.address,
                  !protectedAddresses.contains(address),
                  seenTCPAddresses.insert(address).inserted,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                dropped.append(entry.address)
                return nil
            }
            return TonoTrafficPolicyMediaEndpoint(
                address: address,
                ports: entry.ports.sorted()
            )
        }.sorted { $0.address < $1.address }

        let webDomains = declaredWeb.compactMap { entry -> TonoTrafficPolicyDomain? in
            guard let host = try? ConfigPipeline.validatedWebDirectDomain(entry.host, trusted: trusted),
                  host == entry.host,
                  seenHosts.insert(host).inserted,
                  entry.ports == [443] else {
                dropped.append(entry.host)
                return nil
            }
            return TonoTrafficPolicyDomain(host: host, ports: [443])
        }.sorted { $0.host < $1.host }

        var seenSuffixes = Set<String>()
        let directSuffixes = declaredSuffixes.compactMap { entry -> TonoTrafficPolicyDomain? in
            guard let host = try? ConfigPipeline.validatedManagedDirectSuffix(entry.host, trusted: trusted),
                  host == entry.host,
                  seenSuffixes.insert(host).inserted,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                dropped.append(entry.host)
                return nil
            }
            return TonoTrafficPolicyDomain(
                host: host,
                ports: entry.ports.sorted()
            )
        }.sorted { $0.host < $1.host }

        if !dropped.isEmpty || policy.version > 4 {
            // Recorded because degrading is only an improvement while it is visible.
            // Hosts are named: which entry a build does not understand is the whole
            // diagnostic, and a count alone would have said nothing useful about the
            // Windows client running for days with no policy.
            LocalTrafficAudit.shared.recordEvent(
                "managed_direct_policy_entries_dropped",
                details: [
                    "revision": String(cache.revision),
                    "policy_version": String(policy.version),
                    "dropped": String(dropped.count),
                    // Bounded: a report is a diagnostic, not a copy of the document.
                    "hosts": dropped.sorted().prefix(12).joined(separator: ","),
                    "newer_than_known": String(policy.version > 4),
                    // Which gate did the dropping: an allowlist this build ships,
                    // or this build's own limits. Without it a signed policy whose
                    // new hosts were dropped anyway is indistinguishable from an
                    // unsigned one.
                    "trusted": String(trusted),
                ]
            )
        }
        return TonoTrafficPolicy(
            version: policy.version,
            domains: domains,
            mediaEndpoints: media,
            tcpEndpoints: tcp,
            webDomains: webDomains,
            directSuffixes: directSuffixes,
            trusted: trusted
        )
    }

    func persistIfNewest(_ cache: ManagedTrafficPolicyCache) throws {
        // This actor has no lifetime across launches. Re-check the existing
        // authenticated cache before writing so a late old response cannot
        // replace a newer policy just because the actor's in-memory revision
        // floor was reset to -1.
        // A signature arriving for a revision already on disk is a write worth
        // making, not a no-op. A build predating verification cached this revision
        // without one, and skipping the write here would leave every upgraded
        // install permanently reading it as unsigned — so the first policy that
        // needs a signature would be dropped on exactly those machines.
        var signatureIsNew = false
        if let persisted = ConfigStorage.shared.loadManagedTrafficPolicy() {
            if persisted.revision > cache.revision { return }
            if persisted.revision == cache.revision,
               persisted.sha256 != cache.sha256 {
                throw TonoAPIClient.APIError.invalidResponse
            }
            if persisted.revision == cache.revision {
                switch ManagedTrafficPolicySignature.sameRevisionTransition(
                    from: persisted.signature,
                    to: cache.signature
                ) {
                case .unchanged:
                    break
                case .upgradeToTrusted:
                    signatureIsNew = true
                case .downgradeAttempt:
                    // An unsigned response cannot erase authorship already
                    // established for these exact bytes.
                    return
                case .replacementAttempt:
                    throw TonoAPIClient.APIError.invalidResponse
                }
            }
        }
        if cache.revision < persistedRevision { return }
        if cache.revision == persistedRevision, !signatureIsNew {
            guard persistedDigest == cache.sha256 else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            return
        }
        try ConfigStorage.shared.saveManagedTrafficPolicy(cache)
        persistedRevision = cache.revision
        persistedDigest = cache.sha256
    }

    private static func digest(_ value: String) -> String {
        let digest = Data(SHA256.hash(data: Data(value.utf8)))
            .base64EncodedString()
        return digest
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
    }
}

private actor AppStatePersistenceWriter {
    func saveRegions(_ regions: [ProxyRegion]) {
        ConfigStorage.shared.saveProxyRegions(regions)
    }

    func save(
        regions: [ProxyRegion],
        rules: [RuleItem],
        config: ClashConfig
    ) {
        let storage = ConfigStorage.shared
        storage.saveProxyRegions(regions)
        storage.saveRules(rules)
        storage.saveConfig(config)
    }
}

// MARK: - Network Info

struct NetworkInfo {
    var ip: String = "--"
    /// Network operator behind the exit address, from the lookup's ASN owner.
    ///
    /// Replaces the old `asType`, which read a nested `asn.type` field the
    /// provider stopped returning: the response is flat now, so every client
    /// displayed "--" for it. Naming the operator is also the more useful fact —
    /// it is what a support conversation can act on.
    var org: String = "--"
    /// Country code. The provider no longer returns a city on this endpoint, so
    /// claiming one would be inventing it.
    var location: String = "--"
}

// MARK: - Traffic Stats

struct TrafficStats {
    var uploadSpeed: Int64 = 0
    var downloadSpeed: Int64 = 0
    var totalUpload: Int64 = 0
    var totalDownload: Int64 = 0
    var activeConnections: Int = 0
}

// MARK: - App State

@Observable
final class AppState {
    nonisolated fileprivate static let managedCatalogRegionID =
        "tono-managed-catalog"
    nonisolated fileprivate static let managedCatalogSourceID =
        "tono-managed-catalog"
    // Navigation
    var selectedPage: AppPage = .dashboard {
        didSet {
            guard selectedPage != oldValue else { return }
            updateLiveStreamSubscriptions()
        }
    }
    private(set) var isMainWindowVisible = false

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
    private(set) var lastConnectionStageDurations: [StageDuration] = []
    var disconnectionStage: DisconnectionStage = .finishingOperation
    private(set) var connectionStartedAt: Date?
    private(set) var connectionStageStartedAt: Date?
    private(set) var disconnectionStartedAt: Date?
    private(set) var completedConnectionStages: Set<ConnectionStage> = []
    private(set) var lastConnectionFailure: ConnectionFailure?
    private(set) var isProtectedReconnectScheduled = false
    private(set) var protectedReconnectAttempt = 0
    private(set) var protectedReconnectNextAttemptAt: Date?
    /// A connect failure that only the user can resolve (a denied
    /// administrator prompt, a failed helper installation) pauses the
    /// automatic reconnect loop: retrying the identical transaction would
    /// re-trigger the same prompt or fail the same way forever. PF stays
    /// fail-closed; Retry Now and Protected Offline remain available.
    private(set) var protectedReconnectPausedForUserAction = false
    /// A repeated-failure pause is new-information-sensitive: a network-change
    /// kick may lift it (the environment changed, the outcome may differ). A
    /// user-action pause (denied admin prompt) must never be lifted by a route
    /// flap, or the credential dialog would re-appear uninvited.
    private var protectedReconnectPauseLiftsOnNetworkChange = false
    private var lastProtectedFailureSignature: String?
    private var consecutiveProtectedFailureCount = 0
    private var connectAttemptID: UUID?
    private var connectWatchdogTask: Task<Void, Never>?
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
    var tonoTransport: TonoTransportDescriptor? = nil
    private(set) var cloudOnlyTransportReady = false
    var isTonoReady: Bool {
        tonoTransport != nil || (cloudOnlyTransportReady && selectedExitNode() != nil)
    }
    private var isOwnedTonoMode: Bool {
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
    /// Per-app totals with a route split. Fed from every connections
    /// snapshot, not only while the Activity page is visible.
    let appTrafficLedger = AppTrafficLedger()
    /// Oldest currently-open proxied flow, used to hold a disruptive pin
    /// refresh until streaming responses have finished.
    private var oldestProxiedConnectionStart: Date?
    private var pinRefreshDeferralCount = 0
    private var lastManagedDirectActivity: Date?

    // Logs
    var logEntries: [LogEntry] = []
    var logLevel: String = "info"

    // Subscriptions
    var subscriptions: [SubscriptionInfo] = []
    private var autoUpdateTimer: Timer?
    private var proxyGuardTimer: Timer?
    private var latencyTestTimer: Timer?
    private var coreMonitorTask: Task<Void, Never>?
    private var protectedReconnectTask: Task<Void, Never>?
    private var protectedReconnectID: UUID?
    private var lastProtectedReconnectKick: Date?
    private var networkEnvironmentTask: Task<Void, Never>?
    private var wakeRecoveryTask: Task<Void, Never>?
    private var resumeProtectionAfterWake = false
    private var initialDataLoaded = false
    private var autoConnectRequested = false
    private var managedCatalogRevision = -1
    private var managedCatalogDigest: String?
    private var managedCatalogRouting: TonoExitCatalogRouting?
    private var managedCatalogReloadPending = false
    private var managedTrafficPolicy = TonoTrafficPolicy(
        version: 1,
        domains: [],
        mediaEndpoints: []
    )
    private var managedTrafficPolicyRevision = -1
    private var managedTrafficPolicyDigest: String?
    /// Signature of the revision currently installed, so an unsigned copy of a
    /// revision the server has since signed is not mistaken for already applied.
    private var managedTrafficPolicySignature: String?
    private var activeDirectPolicy: ConfigPipeline.ManagedDirectRuntimePolicy?
    private var catalogSelectionRequiresChoice = false
    private let initialDataLoader = InitialDataLoader()
    private var initialDataLoadTask: Task<InitialDiskSnapshot, Never>?
    private let managedCatalogProcessor = ManagedCatalogProcessor()
    private let managedTrafficPolicyProcessor = ManagedTrafficPolicyProcessor()
    private let persistenceWriter = AppStatePersistenceWriter()
    private var persistenceTask: Task<Void, Never>?

    // Clash config
    var config: ClashConfig = ClashConfig()

    // Core components
    let clashManager = ClashManager()
    let subscriptionManager = SubscriptionManager()
    let proxyService = ProxyService()
    private let providerRuleLoader = ProviderRuleLoader()
    private var clashAPI: ClashAPI?
    private var webSocket: ClashWebSocket?
    private var connectTask: Task<Void, Never>?
    private var configReloadTask: Task<Void, Never>?
    private var configReloadRequestID = 0
    private var pendingFullConfigReload = false
    private var pendingDirectPolicyReload:
        ConfigPipeline.ManagedDirectRuntimePolicy?
    private var disconnectSequence: Task<Void, Never>?
    private var disconnectRequestID = 0
    /// Invalidates helper-status observations when a newer protected network
    /// transition starts while the IPC request is in flight.
    private var protectionOperationGeneration: UInt64 = 0
    private var networkInfoTask: Task<Void, Never>?
    private var nodeSwitchTask: Task<Void, Never>?
    private var protectedDNSService: String?

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
                  !isDisconnecting else { return }
            // Wake recovery owns its barrier/retry sequence. Dynamic Store
            // emits several route and DNS notifications during the same wake;
            // they must not create a second coordinator that races its connect.
            guard wakeRecoveryTask == nil else { return }
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
        networkEnvironmentTask?.cancel()
        networkEnvironmentTask = Task { [weak self] in
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
                self.networkEnvironmentTask = nil
                return
            }
            guard primaryService != self.protectedDNSService
                    || dnsIntegrity == .broken else {
                self.networkEnvironmentTask = nil
                return
            }
            self.networkEnvironmentTask = nil
            LocalTrafficAudit.shared.recordEvent(
                "system_network_change_requires_reconnect",
                details: self.auditProtectionDetails()
            )
            self.disconnect(releaseKillSwitch: false)
            self.errorMessage =
                "The active network changed; Kill Switch is blocking traffic while Tono protects the new connection."
            self.scheduleProtectedReconnect(immediate: true)
        }
    }

    /// Close observation sockets immediately and move an active session toward
    /// the helper's bootstrap-only PF state before macOS powers networking
    /// down. The root helper independently installs an emergency all-block on
    /// the power event, so a delayed GUI callback cannot create an egress gap.
    func prepareForSystemSleep() {
        let shouldResume = isConnected || isConnecting || isProtectionBlocked
            || KillSwitchService.isArmed
        resumeProtectionAfterWake = shouldResume
        LocalTrafficAudit.shared.recordEvent(
            "system_will_sleep",
            details: auditProtectionDetails()
        )
        guard shouldResume else { return }
        protectionOperationGeneration &+= 1
        wakeRecoveryTask?.cancel()
        wakeRecoveryTask = nil
        networkEnvironmentTask?.cancel()
        networkEnvironmentTask = nil
        protectedReconnectTask?.cancel()
        protectedReconnectTask = nil
        protectedReconnectID = nil
        lastProtectedReconnectKick = nil
        isProtectedReconnectScheduled = false
        protectedReconnectAttempt = 0
        protectedReconnectNextAttemptAt = nil
        if isConnected || isConnecting || clashManager.isRunning {
            disconnect(releaseKillSwitch: false)
        } else {
            Task {
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
        protectionOperationGeneration &+= 1
        networkEnvironmentTask?.cancel()
        networkEnvironmentTask = nil
        wakeRecoveryTask?.cancel()
        wakeRecoveryTask = Task { [weak self] in
            guard let self else { return }
            if self.isConnected || self.isConnecting || self.clashManager.isRunning {
                self.disconnect(releaseKillSwitch: false)
            }
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
                        self.errorMessage =
                            "Wake protection is still being reasserted; Internet remains blocked. \(error.localizedDescription)"
                        continue
                    }
                }
                guard self.isTonoReady else {
                    self.isProtectionBlocked = true
                    self.errorMessage =
                        "Waiting for the protected route after wake; Internet remains blocked."
                    continue
                }
                guard !self.isConnected, !self.isConnecting,
                      !self.isDisconnecting else {
                    // A connect may already have started from another
                    // transport-ready callback. Do not leave a completed task
                    // handle that suppresses every later route-change kick.
                    if !Task.isCancelled {
                        self.wakeRecoveryTask = nil
                    }
                    return
                }
                self.isProtectionBlocked = true
                self.errorMessage =
                    "Re-protecting this Mac after wake. Kill Switch is blocking direct traffic."
                self.connect()
                self.wakeRecoveryTask = nil
                return
            }
            self.wakeRecoveryTask = nil
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
            } else if isConnected || isConnecting || clashManager.isRunning {
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
        persistProxySelection(selected.name)
        catalogSelectionRequiresChoice = false
        // A normal signed-in launch remains an explicit user choice. After a
        // crash, however, PF is already fail-closed; recover the selected route
        // automatically instead of leaving the machine offline at a dashboard.
        autoConnectRequested = resumeProtection
        attemptAutomaticConnect()
    }

    private func attemptAutomaticConnect() {
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
        clashManager.findBinary() != nil
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

    private var importedExitNodes: [ProxyNode] {
        proxyRegions.flatMap(\.nodes)
    }

    private func selectedExitNode() -> ProxyNode? {
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

    private func currentProxySelectionTarget() -> String? {
        normalizedProxyTarget(proxyService.activeNodeName)
            ?? normalizedProxyTarget(activeNode?.name)
            ?? normalizedProxyTarget(selectedNodeId)
            ?? savedProxyTargetName
    }

    private func persistProxySelection(_ target: String?) {
        if let target = normalizedProxyTarget(target) {
            AppProfile.defaults.set(target, forKey: SettingsKey.selectedProxyTargetName)
        } else {
            AppProfile.defaults.removeObject(forKey: SettingsKey.selectedProxyTargetName)
        }
    }

    private func localProxyNode(matching target: String) -> ProxyNode? {
        proxyRegions.flatMap(\.nodes).first {
            proxyTarget($0.name, matches: target) || proxyTarget($0.id, matches: target)
        }
    }

    /// Prefer the requested US Reality exit across catalog naming variants. If
    /// it is temporarily absent, retain availability with the first verified
    /// managed-cloud node.
    private func defaultCloudExitNode() -> ProxyNode? {
        let nodes = proxyRegions
            .first(where: { $0.id == Self.managedCatalogRegionID })?
            .nodes ?? []
        if let preferred = managedCatalogRouting?.defaultProxy,
           let node = nodes.first(where: { proxyTarget($0.name, matches: preferred) }) {
            return node
        }
        return ConfigPipeline.preferredCloudExit(
            in: nodes,
            named: AppProfile.defaultCloudExitName
        )
    }

    /// Build 10 corrects the previous exact-name-only default once. After this
    /// migration, an explicit JP selection remains sticky across launches.
    @discardableResult
    private func migrateCloudExitDefaultIfNeeded() -> Bool {
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

    private func isMainProxyGroup(_ name: String) -> Bool {
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
    private func applyProxySelection(_ target: String) -> Bool {
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

    private func applyDefaultProxySelection(persist: Bool) {
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

    private func proxyTarget(_ candidate: String, matches target: String) -> Bool {
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

    // MARK: - Connection Control

    func connect() {
        guard !isConnected && !isConnecting && !isDisconnecting else { return }
        guard !catalogSelectionRequiresChoice else {
            errorMessage = String(localized: "Choose an available cloud server before reconnecting.")
            return
        }
        guard isTonoReady else {
            errorMessage = String(localized: "No protected Tono cloud exit is ready.")
            return
        }
        protectionOperationGeneration &+= 1
        isProtectionBlocked = false
        connectionStage = .preparing
        completedConnectionStages = []
        lastConnectionStageDurations = []
        lastConnectionFailure = nil
        connectionStartedAt = Date()
        connectionStageStartedAt = connectionStartedAt
        if !isProtectedReconnectScheduled {
            protectedReconnectAttempt = 0
            protectedReconnectNextAttemptAt = nil
        }
        isConnecting = true
        errorMessage = nil
        // Any fresh connect attempt is user-visible intent to try again; the
        // reconnect loop re-pauses if the same user-action failure repeats.
        protectedReconnectPausedForUserAction = false

        // Sync settings from UserDefaults to config. The Settings field can
        // persist partial input (focus loss skips its onSubmit validation), so
        // the same 1024...65535 contract is enforced here: anything else —
        // including a privileged port like "78" — falls back to the default.
        let portString = AppProfile.defaults.string(forKey: SettingsKey.mixedPort) ?? "7890"
        let port = Int(portString).flatMap { (1024...65535).contains($0) ? $0 : nil } ?? 7890
        config.mixedPort = port
        // Tono always requires TUN; LAN exposure is never allowed.
        config.tunEnabled = true
        config.allowLan = false
        config.mode = ProxyMode.rule.rawValue.lowercased()
        proxyMode = .rule

        let selectedExit = selectedExitNode()
        let selectedExitName = selectedExit?.name ?? ConfigPipeline.homeNodeName
        LocalTrafficAudit.shared.recordEvent(
            "connect_requested",
            details: ["selected_exit": selectedExitName]
        )

        let overlay = ConfigPipeline.OverlayConfig(
            mixedPort: port,
            secret: config.secret,
            mode: "rule",
            logLevel: "info",
            allowLan: false,
            tunEnabled: true,
            selectedNodeName: selectedExitName,
            tonoTransport: tonoTransport,
            claudeHomeNodeName: managedCatalogRouting?.homeProxy,
            defaultNodeName: managedCatalogRouting?.defaultProxy,
            claudeHomeSocks5: managedCatalogRouting?.homeSocks5
        )
        let apiHost = (Bundle.main.object(forInfoDictionaryKey: "TonoAPIBaseURL") as? String)
            .flatMap { URL(string: $0)?.host }

        // Health-check: poll /version until mihomo is ready
        let apiPort = config.externalController.split(separator: ":").last.flatMap { Int($0) } ?? 9090
        let api = ClashAPI(port: apiPort, secret: config.secret)
        let runtimeNodes = importedExitNodes
        let usesHomeBootstrap = AppProfile.homeExitEnabled && tonoTransport != nil
        let trafficPolicy = managedTrafficPolicy

        let attemptID = UUID()
        connectAttemptID = attemptID
        // Every stage is individually bounded, but their worst-case sum is
        // multi-minute. One overall deadline converts a wedged-but-not-erroring
        // attempt into the ordinary failure path instead of an endless spinner.
        connectWatchdogTask?.cancel()
        connectWatchdogTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(240))
            // A first-run attempt can legitimately sit on the administrator
            // prompt past the deadline; the prompt itself is already bounded
            // (180s in HelperManager), so grant that stage one extension
            // instead of tearing down under the user's credential dialog.
            if let self, !Task.isCancelled, self.isConnecting,
               self.connectAttemptID == attemptID,
               self.connectionStage == .preparingHelper
                || self.connectionStage == .preparing {
                try? await Task.sleep(for: .seconds(200))
            }
            guard let self, !Task.isCancelled,
                  self.isConnecting, self.connectAttemptID == attemptID else {
                return
            }
            LocalTrafficAudit.shared.recordEvent(
                "connect_watchdog_fired",
                details: ["stage": String(describing: self.connectionStage)]
            )
            let stalledMessage = String(
                localized: "The connection attempt stalled and was stopped."
            )
            if KillSwitchService.isArmed {
                self.disconnect(releaseKillSwitch: false)
                self.errorMessage = stalledMessage + " "
                    + String(localized: "Kill Switch is blocking traffic while Tono retries. Tap Protected Offline to restore normal Internet.")
                self.scheduleProtectedReconnect()
            } else {
                self.errorMessage = stalledMessage
                self.disconnect(releaseKillSwitch: true)
            }
        }
        connectTask = Task { [weak self, clashManager] in
            guard let self else { return }
            do {
                guard let networkService =
                    await PrivilegedRuntimeCoordinator.shared.primaryNetworkService()
                else {
                    throw SystemProxyError.noNetworkService
                }
                self.protectedDNSService = networkService
                var physicalInterface = await PrivilegedRuntimeCoordinator.shared
                    .primaryNetworkInterface()
                // A mid-transition network handoff can briefly report no
                // primary interface. Giving up here silently drops the whole
                // managed-direct feature for the session, so retry first.
                for _ in 0..<3 where physicalInterface == nil {
                    try await Task.sleep(for: .milliseconds(300))
                    physicalInterface = await PrivilegedRuntimeCoordinator.shared
                        .primaryNetworkInterface()
                }
                let policyIsEmpty = trafficPolicy.domains.isEmpty
                    && trafficPolicy.webDomains.isEmpty
                    && trafficPolicy.directSuffixes.isEmpty
                    && trafficPolicy.mediaEndpoints.isEmpty
                    && trafficPolicy.tcpEndpoints.isEmpty
                var committedDirectPolicy: ConfigPipeline.ManagedDirectRuntimePolicy?
                if let physicalInterface {
                    do {
                        committedDirectPolicy = try self.initialDirectPolicy(
                            physicalInterface: physicalInterface,
                            policy: trafficPolicy
                        )
                    } catch {
                        committedDirectPolicy = nil
                        LocalTrafficAudit.shared.recordEvent(
                            "managed_direct_policy_invalid",
                            details: ["error": String(describing: error)]
                        )
                    }
                } else {
                    committedDirectPolicy = nil
                    if !policyIsEmpty {
                        LocalTrafficAudit.shared.recordEvent(
                            "managed_direct_no_primary_interface"
                        )
                    }
                }
                let proxyEndpoints = try ConfigPipeline.dialEndpoints(for: selectedExit)
                    + self.claudeHomeDialEndpoints(excluding: selectedExit)
                // Always arm before TUN comes up so a crash mid-connect cannot
                // leak the real IP. The actor keeps this blocking PF/helper work
                // off SwiftUI and ordered with a possible cancel/disconnect.
                self.connectionStage = .preparingHelper
                try await PrivilegedRuntimeCoordinator.shared.prepareHelper()
                try Task.checkCancellation()
                let protectedDNSState =
                    await PrivilegedRuntimeCoordinator.shared.protectedDNSStatus()
                // System resolution is allowed only on a clean, unprotected
                // first connection. Protected recovery, wake, and hotspot
                // transitions must use the helper's validated pin cache and
                // never query a possibly local/dead or ISP-provided resolver.
                let allowSystemResolution =
                    !KillSwitchService.isArmed
                        && protectedDNSState.available
                        && !protectedDNSState.configured
                        && !protectedDNSState.snapshotPresent
                self.connectionStage = .startingKillSwitch
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    // Retain only Tono's exact control-plane HTTPS addresses as
                    // a bounded crash-recovery path. Background applications
                    // still cannot use direct Internet or system DNS while PF
                    // is armed.
                    apiHosts: [apiHost].compactMap { $0 },
                    tunnelInterfaces: [],
                    proxyEndpoints: proxyEndpoints,
                    // Mihomo starts below with the committed policy's UDP
                    // media direct rules already in its config. Granting the
                    // matching PF exceptions in this same arm closes the
                    // multi-second window where those direct dials were
                    // silently dropped; the endpoints are already validated
                    // and harmless before Mihomo exists (root-only pass).
                    sessionDirectEndpoints:
                        committedDirectPolicy?.sessionEndpoints ?? [],
                    tailscaleBootstrapEnabled: usesHomeBootstrap,
                    allowSystemResolution: allowSystemResolution,
                    helperPrepared: true,
                    reviewedBundleDirect: committedDirectPolicy != nil
                )
                try Task.checkCancellation()
                self.connectionStage = .startingTunnel
                try await clashManager.start(
                    overlay: overlay,
                    customNodes: runtimeNodes,
                    directPolicy: committedDirectPolicy,
                    helperPrepared: true
                )
                RuntimeCleanup.markCoreStarted(tunEnabled: self.config.tunEnabled)
                try Task.checkCancellation()
                try await api.waitUntilReady()
                try Task.checkCancellation()
                var ownedInterfaceReady = false
                for _ in 0..<20 {
                    if KillSwitchService.interfaceExists(ConfigPipeline.tonoTunInterface) {
                        ownedInterfaceReady = true
                        break
                    }
                    try await Task.sleep(for: .milliseconds(100))
                }
                try Task.checkCancellation()
                guard ownedInterfaceReady else {
                    throw KillSwitchService.Error.commandFailed(
                        "Mihomo did not create the owned \(ConfigPipeline.tonoTunInterface) interface."
                    )
                }
                // The helper refuses arbitrary/nonexistent interfaces. Only after
                // Mihomo is healthy may traffic leave through its owned TUN.
                self.connectionStage = .lockingTraffic
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    // The control plane is needed as a bounded direct recovery
                    // path before the tunnel exists. Once utun199 is live, clear
                    // that physical-interface exception so API traffic must use
                    // the protected exit as well.
                    apiHosts: [],
                    tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                    proxyEndpoints: proxyEndpoints,
                    sessionDirectEndpoints:
                        committedDirectPolicy?.sessionEndpoints ?? [],
                    tailscaleBootstrapEnabled: usesHomeBootstrap,
                    helperPrepared: true,
                    reviewedBundleDirect: committedDirectPolicy != nil
                )
                try Task.checkCancellation()
                self.connectionStage = .applyingCloudPolicy
                if !trafficPolicy.domains.isEmpty
                    || !trafficPolicy.webDomains.isEmpty,
                   committedDirectPolicy != nil {
                    let resolvedPolicy = await self.resolveManagedDirectDomains(
                        policy: trafficPolicy,
                        base: committedDirectPolicy,
                        api: api
                    )
                    try Task.checkCancellation()
                    // Surface partial or total resolution failure instead of
                    // letting the stage report success with zero direct pins.
                    //
                    // Counts only what is actually attempted. The reviewed
                    // bundle's own hosts are no longer resolved — its rule
                    // matches by process path — so including them reported
                    // "expected 38, resolved 26" for a run that tried 27 and got
                    // 26. An instrument that overstates the denominator invents a
                    // failure, and during this session that one sent the
                    // investigation looking for eleven missing answers.
                    let expectedDomains = trafficPolicy.webDomains.count
                    let resolvedDomains = (resolvedPolicy?.domainPins.count ?? 0)
                        + (resolvedPolicy?.webDomainPins.count ?? 0)
                    if resolvedDomains < expectedDomains {
                        LocalTrafficAudit.shared.recordEvent(
                            "managed_direct_domains_unresolved",
                            details: [
                                "expected": String(expectedDomains),
                                "resolved": String(resolvedDomains),
                            ]
                        )
                    }
                    if resolvedPolicy != committedDirectPolicy,
                       let resolvedPolicy {
                        // Permit only the exact resolved tuples before the
                        // runtime can select its interface-bound DIRECT path.
                        try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                            apiHosts: [],
                            tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                            proxyEndpoints: proxyEndpoints,
                            sessionDirectEndpoints: resolvedPolicy.sessionEndpoints,
                            tailscaleBootstrapEnabled: usesHomeBootstrap,
                            helperPrepared: true,
                            reviewedBundleDirect: true
                        )
                        try Task.checkCancellation()
                        try await clashManager.rewriteConfig(
                            overlay: overlay,
                            customNodes: runtimeNodes,
                            directPolicy: resolvedPolicy
                        )
                        let runtimeConfigPath = try await
                            PrivilegedRuntimeCoordinator.shared.syncCoreConfig(
                                configDirectory: clashManager.configDirectory.path,
                                configSHA256: try self.requireRuntimeConfigDigest()
                            )
                        try Task.checkCancellation()
                        try await api.reloadConfig(path: runtimeConfigPath)
                        await self.primeManagedDirectFallbackGroups(
                            policy: resolvedPolicy,
                            api: api
                        )
                        try Task.checkCancellation()
                        committedDirectPolicy = resolvedPolicy
                        LocalTrafficAudit.shared.recordEvent(
                            "managed_direct_policy_activated",
                            details: [
                                // Always 0 on macOS, and that is correct rather
                                // than broken: the bundle-wide process rule
                                // matches first, so emitting the per-host pins
                                // would add fallback groups and PF entries for
                                // rules Mihomo never reaches. Windows *does* use
                                // the same field — it turns those hosts into
                                // `hosts:` SNI recovery and per-host rules — so
                                // the entries are not dead weight in the policy,
                                // only unused here. Reporting received alongside
                                // emitted stops the pair reading as a fault, as
                                // it did to the last person who went looking.
                                "domains_emitted": String(resolvedPolicy.domainPins.count),
                                "domains_received": String(trafficPolicy.domains.count),
                                "web_domains": String(
                                    resolvedPolicy.webDomainPins.count
                                ),
                                "endpoints": String(
                                    resolvedPolicy.sessionEndpoints.count
                                ),
                            ]
                        )
                    }
                }
                // The selected-exit handshake and protected DNS preflight are
                // independent once PF and utun199 are live. Running them in
                // parallel removes a cold-handshake round trip from first-run
                // startup without allowing either check to be skipped.
                let exitHealthTask = Task { [api, selectedExit] in
                    guard let selectedExit else { return true }
                    let healthStartedAt = Date()
                    let health = await api.testProxyDelayWithRetry(
                        // Probe the selector itself rather than a proxy by
                        // name, proving the active data path matches the
                        // runtime's committed selection.
                        name: ConfigPipeline.exitGroupName,
                        url: "https://www.gstatic.com/generate_204",
                        timeout: 5_000
                    )
                    let succeeded = health.delay.map { $0 > 0 } == true
                    var details = [
                        "selected_exit": selectedExit.name,
                        "target": ConfigPipeline.exitGroupName,
                        "succeeded": String(succeeded),
                        "duration_ms": String(
                            max(0, Int(Date().timeIntervalSince(healthStartedAt) * 1_000))
                        ),
                    ]
                    if let delay = health.delay {
                        details["delay_ms"] = String(delay)
                    }
                    if let message = health.message, !message.isEmpty {
                        details["message"] = String(message.prefix(200))
                    }
                    LocalTrafficAudit.shared.recordEvent(
                        "exit_health_check_finished",
                        details: details
                    )
                    return succeeded
                }
                defer { exitHealthTask.cancel() }
                // Prove the root-owned loopback DNS listener can resolve through
                // the selected protected exit before changing any system DNS
                // setting. This makes the transition transactional: a port
                // conflict, broken DoH route, or node failure still leaves the
                // user's original Internet untouched.
                self.connectionStage = .securingDNS
                guard await self.testLocalProtectedDNS() else {
                    throw ClashAPIError.requestFailed(
                        "Mihomo's protected local DNS listener did not pass its preflight check."
                    )
                }
                LocalTrafficAudit.shared.recordEvent(
                    "local_dns_verified",
                    details: self.auditProtectionDetails()
                )
                try Task.checkCancellation()
                // macOS cannot hijack DNS queries addressed to a directly
                // reachable LAN resolver (commonly the DHCP router). Point the
                // active service at Mihomo's verified loopback listener only
                // after utun199 and its PF allowance are live. The root helper
                // snapshots and restores the original DHCP/custom setting.
                try await PrivilegedRuntimeCoordinator.shared.enableProtectedDNS(
                    service: networkService
                )
                try Task.checkCancellation()
                // `networksetup` echoing 127.0.0.1 proves only that the setting
                // was written. Require an ordinary unqualified DNS client to
                // receive Mihomo's fake IP through macOS's active resolver
                // before the UI can ever report Connected.
                guard await self.testSystemProtectedDNS() else {
                    throw ClashAPIError.requestFailed(
                        "The macOS protected DNS path did not pass its end-to-end check."
                    )
                }
                LocalTrafficAudit.shared.recordEvent(
                    "system_dns_verified",
                    details: self.auditProtectionDetails()
                )
                try Task.checkCancellation()
                // This is the same signed-in-user curl check that previously
                // ran only after the controller's exit probe. Both checks are
                // independent once PF, TUN, and protected system DNS are live,
                // so overlap their network waits without skipping either
                // safety gate. Weak networks can otherwise add two full
                // sequential timeouts to every reconnect.
                let dataPlaneTask = Task { [weak self] in
                    guard let self else { return false }
                    return await self.testSystemTUNDataPlaneWithRetry()
                }
                defer { dataPlaneTask.cancel() }
                self.connectionStage = .checkingExit
                let exitReady = await withTaskCancellationHandler {
                    await exitHealthTask.value
                } onCancel: {
                    exitHealthTask.cancel()
                    dataPlaneTask.cancel()
                }
                try Task.checkCancellation()
                guard exitReady else {
                    throw ClashAPIError.requestFailed(
                        "The selected Reality server did not pass its protected health check."
                    )
                }
                try Task.checkCancellation()
                // A controller delay probe only proves that Mihomo can dial the
                // selected exit. It does not prove that ordinary applications
                // can enter the TUN. Build 13 could therefore report Connected
                // while every browser request stalled on utun199. Exercise the
                // same no-proxy system route an application uses before
                // committing the connected UI state.
                self.connectionStage = .verifyingTraffic
                let dataPlaneReady = await withTaskCancellationHandler {
                    await dataPlaneTask.value
                } onCancel: {
                    exitHealthTask.cancel()
                    dataPlaneTask.cancel()
                }
                try Task.checkCancellation()
                guard dataPlaneReady else {
                    throw ClashAPIError.requestFailed(
                        "The protected system data path did not pass its end-to-end check."
                    )
                }
                LocalTrafficAudit.shared.recordEvent(
                    "system_data_plane_verified",
                    details: self.auditProtectionDetails()
                )
                self.activeDirectPolicy = committedDirectPolicy
                // Learn the control plane's current addresses while a safe
                // resolver exists. Nothing uses them now — the arm above cleared
                // `apiHosts`, so API traffic goes through the exit like
                // everything else — they are for the next fail-closed window
                // where no tunnel exists and system DNS is blocked. Without this
                // that window can only offer addresses compiled into the build,
                // and an address rotation between two releases leaves a machine
                // that has to be rescued by finding the restore button.
                await self.refreshControlPlanePinCache(api: api)
                // /core/start already snapshots the exact digested config into
                // the root-owned runtime directory before launching Mihomo.
                // Reloading that identical file here added another helper/API
                // round trip and could interrupt a healthy first connection.
                let committed = await self.onCoreStarted(api: api)
                guard committed else { return }
                self.completedConnectionStages.insert(self.connectionStage)
                self.isConnecting = false
                self.connectionStartedAt = nil
                self.connectionStageStartedAt = nil
                self.protectedReconnectNextAttemptAt = nil
                self.connectionStage = .preparing
                self.lastProtectedFailureSignature = nil
                self.consecutiveProtectedFailureCount = 0
                self.connectWatchdogTask?.cancel()
                self.connectWatchdogTask = nil
                self.connectTask = nil
            } catch {
                // A second click while connecting is an intentional cancel.
                // The serialized disconnect sequence runs after any in-flight
                // helper operation, so a late arm/start cannot win the race.
                if Task.isCancelled { return }
                let failedStage = self.connectionStage
                let failedAt = Date()
                let totalDuration = self.connectionStartedAt.map {
                    max(0, Int(failedAt.timeIntervalSince($0) * 1_000))
                }
                let stageDuration = self.connectionStageStartedAt.map {
                    max(0, Int(failedAt.timeIntervalSince($0) * 1_000))
                }
                let status = await PrivilegedRuntimeCoordinator.shared.coreStatus()
                var failureDetails = [
                    "error": error.localizedDescription,
                    "stage": failedStage.rawValue,
                ]
                if let totalDuration {
                    failureDetails["duration_ms"] = String(totalDuration)
                }
                if let stageDuration {
                    failureDetails["stage_duration_ms"] = String(stageDuration)
                }
                LocalTrafficAudit.shared.recordEvent(
                    "connect_failed",
                    details: failureDetails
                )
                await MainActor.run {
                    // An explicit Disconnect/Quit can cancel while the status
                    // request is in flight. Never let this stale failure path
                    // re-arm protection after the user released it.
                    guard !Task.isCancelled else { return }
                    let failureMessage: String
                    if let diagnostic = status.lastError, !diagnostic.isEmpty {
                        failureMessage = String(
                            localized: "Core startup failed: \(diagnostic)"
                        )
                    } else if !status.running {
                        failureMessage = String(
                            localized: "Protection startup failed: \(error.localizedDescription)"
                        )
                    } else {
                        failureMessage = String(
                            localized: "Connection check failed: \(error.localizedDescription)"
                        )
                    }
                    // Deterministic failures repeat verbatim; a fourth try of
                    // three identical same-stage outcomes will not differ.
                    // Environmental failures (no network service while Wi-Fi
                    // is off) are excluded: they repeat identically too, but
                    // resolve themselves — pausing on them would strand a
                    // fail-closed host that used to self-heal.
                    let environmentalFailure: Bool
                    if case SystemProxyError.noNetworkService = error {
                        environmentalFailure = true
                    } else {
                        environmentalFailure = false
                    }
                    if environmentalFailure {
                        // Leave the counter untouched either way.
                    } else {
                        let failureSignature =
                            "\(failedStage.rawValue)|\(failureMessage.prefix(120))"
                        if failureSignature == self.lastProtectedFailureSignature {
                            self.consecutiveProtectedFailureCount += 1
                        } else {
                            self.lastProtectedFailureSignature = failureSignature
                            self.consecutiveProtectedFailureCount = 1
                        }
                    }
                    self.lastConnectionFailure = ConnectionFailure(
                        stage: failedStage,
                        message: failureMessage,
                        occurredAt: failedAt
                    )
                    self.connectionStageStartedAt = nil
                    self.connectWatchdogTask?.cancel()
                    if KillSwitchService.isArmed {
                        // Once PF has committed, every automatic failure path is
                        // fail-closed. Only the user's explicit Protected Offline
                        // action may restore direct Internet.
                        self.disconnect(releaseKillSwitch: false)
                        if Self.failureRequiresUserAction(error) {
                            self.protectedReconnectPausedForUserAction = true
                            self.protectedReconnectPauseLiftsOnNetworkChange = false
                            self.errorMessage = failureMessage + " "
                                + String(localized: "Kill Switch is blocking traffic. Automatic retries are paused because this needs your action — tap Retry Now after resolving it, or Protected Offline to restore normal Internet.")
                        } else if !environmentalFailure,
                                  self.consecutiveProtectedFailureCount >= 3 {
                            self.protectedReconnectPausedForUserAction = true
                            self.protectedReconnectPauseLiftsOnNetworkChange = true
                            self.errorMessage = failureMessage + " "
                                + String(localized: "The same failure repeated three times, so automatic retries are paused. Tap Retry Now to try again, or Protected Offline to restore normal Internet.")
                        } else {
                            self.errorMessage = failureMessage + " "
                                + String(localized: "Kill Switch is blocking traffic while Tono retries. Tap Protected Offline to restore normal Internet.")
                            self.scheduleProtectedReconnect()
                        }
                    } else {
                        // Installation/authorization can fail before PF exists.
                        // Do not claim the unrestricted host is protected or
                        // repeatedly trigger an administrator prompt. Releasing
                        // clears the failure card, but exactly these first-run
                        // failures need the copyable diagnostics — restore it.
                        self.errorMessage = failureMessage
                        let preservedFailure = self.lastConnectionFailure
                        let preservedStages = self.completedConnectionStages
                        self.disconnect(releaseKillSwitch: true)
                        self.lastConnectionFailure = preservedFailure
                        self.completedConnectionStages = preservedStages
                    }
                }
            }
        }
    }

    /// Stops Mihomo/TUN. Kill switch is NOT disarmed here — that only happens on
    /// intentional logout / user "turn off protection" so a crash or health failure
    /// leaves the host fail-closed via Kill Switch.
    func disconnect(releaseKillSwitch: Bool = false) {
        protectionOperationGeneration &+= 1
        LocalTrafficAudit.shared.recordEvent(
            "disconnect_requested",
            details: [
                "release_kill_switch": String(releaseKillSwitch),
                "was_connected": String(isConnected),
            ]
        )
        let protectionMayBeActive = isProtectionBlocked
            || isConnected
            || isConnecting
            || KillSwitchService.isArmed
        // An explicit release can spend up to 180 seconds on the administrator
        // repair prompt. Keep the UI protected/offline until core stop, DNS
        // restoration, and PF disarm have all committed.
        isProtectionBlocked = !releaseKillSwitch || protectionMayBeActive
        let runtimeMayOwnNetwork =
            KillSwitchService.isArmed
                || AppProfile.defaults.bool(forKey: SettingsKey.didStartCore)
                || HelperManager.hasInstalledHelperArtifact
        let shouldStopCore = isConnected
            || isConnecting
            || clashManager.isRunning
            || AppProfile.defaults.bool(forKey: SettingsKey.didStartCore)
        if releaseKillSwitch {
            // A released host starts a genuinely new story; stale failure
            // history must not let a single failure in a future session trip
            // the "repeated three times" pause.
            lastProtectedFailureSignature = nil
            consecutiveProtectedFailureCount = 0
            protectedReconnectPausedForUserAction = false
            protectedReconnectPauseLiftsOnNetworkChange = false
            protectedReconnectTask?.cancel()
            protectedReconnectTask = nil
            protectedReconnectID = nil
            lastProtectedReconnectKick = nil
            isProtectedReconnectScheduled = false
            protectedReconnectAttempt = 0
            protectedReconnectNextAttemptAt = nil
            wakeRecoveryTask?.cancel()
            wakeRecoveryTask = nil
            resumeProtectionAfterWake = false
            autoConnectRequested = false
            connectionStartedAt = nil
            connectionStageStartedAt = nil
            completedConnectionStages = []
            lastConnectionFailure = nil
        }
        // Connection-scoped observations. `/connections` stops arriving once the
        // core is gone, so leaving these set would have the next session judge a
        // phantom stream from the previous one — old enough to look in-flight —
        // and needlessly defer its first pin refreshes.
        oldestProxiedConnectionStart = nil
        lastManagedDirectActivity = nil
        pinRefreshDeferralCount = 0
        // Drained below alongside connect/nodeSwitch/configReload rather than
        // merely cancelled: this monitor issues privileged probes, and a task
        // suspended on the coordinator actor resumes regardless of cancellation,
        // so the release sequence has to wait for it to unwind before it
        // restores DNS and disarms PF.
        let pendingCoreMonitor = coreMonitorTask
        pendingCoreMonitor?.cancel()
        coreMonitorTask = nil
        networkEnvironmentTask?.cancel()
        networkEnvironmentTask = nil
        networkInfoTask?.cancel()
        networkInfoTask = nil
        let pendingNodeSwitch = nodeSwitchTask
        pendingNodeSwitch?.cancel()
        nodeSwitchTask = nil
        let pendingConfigReload = configReloadTask
        pendingConfigReload?.cancel()
        configReloadTask = nil
        pendingFullConfigReload = false
        pendingDirectPolicyReload = nil

        // Cancel any in-progress connect Task. The teardown sequence waits for
        // it to leave the serialized helper actor before issuing stop/disarm.
        let pendingConnect = connectTask
        pendingConnect?.cancel()
        connectTask = nil
        isConnecting = false
        connectionStage = .preparing
        isDisconnecting = true
        disconnectionStartedAt = Date()
        disconnectionStage = .finishingOperation
        switchingNodeId = nil

        // Stop WebSocket streams
        webSocket?.stopAll()
        webSocket = nil
        clashAPI = nil
        proxyService.setAPI(nil)

        // Stop UI-side streams/timers immediately; blocking system operations
        // continue on the serialized runtime actor.
        stopProxyGuard()
        stopLatencyTestTimer()

        // Reset state
        isConnected = false
        isProxyDegraded = false
        networkInfo = NetworkInfo()
        trafficStats = TrafficStats()
        connections = []
        appTrafficLedger.reset()
        logEntries = []
        activeRules = []
        ruleProviders = [:]
        providerRulesCache = []
        providerRulesLoaded = false
        isLoadingProviderRules = false
        activeDirectPolicy = nil

        disconnectRequestID += 1
        let requestID = disconnectRequestID
        let previousDisconnect = disconnectSequence
        disconnectSequence = Task { [weak self, clashManager] in
            _ = await previousDisconnect?.value
            _ = await pendingConnect?.value
            _ = await pendingNodeSwitch?.value
            _ = await pendingConfigReload?.value
            _ = await pendingCoreMonitor?.value

            var transitionError: String?
            var helperReadyForRelease = true
            if releaseKillSwitch {
                do {
                    // A helper that rejects this GUI will also reject core stop,
                    // DNS restoration, and disarm. Repair once, while PF remains
                    // fail-closed, before attempting any release operation.
                    try await PrivilegedRuntimeCoordinator.shared
                        .repairRejectingHelperForExplicitReleaseIfNeeded()
                } catch {
                    helperReadyForRelease = false
                    transitionError = String(
                        localized: "Tono's network helper rejected this copy of Tono, so protection was not released and your traffic stays protected. Choose Restore internet again to repair the helper and release protection. If repair keeps failing, the Support page has a recovery command. \(error.localizedDescription)"
                    )
                    LocalTrafficAudit.shared.recordEvent(
                        "helper_release_repair_failed",
                        details: ["error": error.localizedDescription]
                    )
                }
            }

            await MainActor.run {
                self?.disconnectionStage = .stoppingTunnel
            }
            let stopped = helperReadyForRelease
                ? (shouldStopCore ? await clashManager.stopAsync() : true)
                : false
            let coreStillRunning = helperReadyForRelease && shouldStopCore
                ? await PrivilegedRuntimeCoordinator.shared.coreStatus().running
                : false
            // A failed identity repair aborts the privileged release sequence.
            // Do not infer "stopped" from an unauthorized status endpoint.
            let coreStopped = helperReadyForRelease
                && (stopped || !coreStillRunning)
            if coreStopped {
                RuntimeCleanup.clearCoreStarted()
            }

            var protectedDNSRestored = !releaseKillSwitch
            if releaseKillSwitch {
                await MainActor.run {
                    self?.disconnectionStage = .restoringDNS
                }
                if helperReadyForRelease {
                    do {
                        _ = try await PrivilegedRuntimeCoordinator.shared
                            .restoreProtectedDNSIfConfigured()
                        protectedDNSRestored = true
                    } catch {
                        // A first-run user may cancel the administrator prompt
                        // before any helper, PF rule, core, or DNS snapshot exists.
                        // Only that provably pristine case can treat an absent
                        // helper as "nothing to restore."
                        protectedDNSRestored = !runtimeMayOwnNetwork
                        if !protectedDNSRestored {
                            transitionError =
                                "Protected DNS restore failed; Kill Switch remains active. \(error.localizedDescription)"
                        }
                    }
                }
            } else {
                await MainActor.run {
                    self?.disconnectionStage = .preservingProtection
                }
            }
            var transitionLeavesProtectionBlocked =
                !releaseKillSwitch || !coreStopped || !protectedDNSRestored
            if !coreStopped, transitionError == nil {
                transitionError =
                    "The protected core could not be stopped. Kill Switch remains active; retry disconnecting."
            }
            do {
                try await PrivilegedRuntimeCoordinator.shared.disableSystemProxyIfNeeded()
            } catch {
                transitionError = String(
                    localized: "System proxy could not be turned off. Disable the proxy manually in System Settings > Network."
                )
            }

            if releaseKillSwitch {
                await MainActor.run {
                    self?.disconnectionStage = .restoringNetwork
                }
            }
            if helperReadyForRelease {
                do {
                    if releaseKillSwitch, coreStopped, protectedDNSRestored {
                        try await PrivilegedRuntimeCoordinator.shared.disarmKillSwitch()
                        transitionLeavesProtectionBlocked = false
                    } else {
                        try await PrivilegedRuntimeCoordinator.shared.restrictKillSwitchToBootstrap()
                        transitionLeavesProtectionBlocked = true
                    }
                } catch {
                    transitionLeavesProtectionBlocked = true
                    transitionError = String(localized: "Kill switch transition failed: \(error.localizedDescription)")
                }
            } else {
                transitionLeavesProtectionBlocked = true
            }

            await MainActor.run {
                guard let self else { return }
                self.isProtectionBlocked = transitionLeavesProtectionBlocked
                if releaseKillSwitch, !transitionLeavesProtectionBlocked {
                    self.protectedDNSService = nil
                }
                if let transitionError {
                    self.errorMessage = transitionError
                }
                if self.disconnectRequestID == requestID {
                    self.isDisconnecting = false
                    self.disconnectionStartedAt = nil
                }
            }
        }
    }

    func disconnectAndWait(releaseKillSwitch: Bool = false) async {
        disconnect(releaseKillSwitch: releaseKillSwitch)
        let pending = disconnectSequence
        _ = await pending?.value
    }

    func finishPendingDisconnect() async {
        let pending = disconnectSequence
        _ = await pending?.value
    }

    private func onCoreStarted(api: ClashAPI) async -> Bool {
        guard isConnecting, !Task.isCancelled else { return false }
        clashAPI = api
        proxyService.setAPI(api)

        // Auto-enable system proxy (skip for TUN mode — TUN handles routing itself)
        var proxyFailed = false
        if !config.tunEnabled {
            do {
                try await PrivilegedRuntimeCoordinator.shared.enableSystemProxy(
                    httpPort: config.mixedPort,
                    socksPort: config.mixedPort
                )
                startProxyGuard()
            } catch {
                errorMessage = String(localized: "System proxy failed: \(error.localizedDescription). Core is running but traffic is NOT proxied.")
                proxyFailed = true
            }
        }

        // Disconnect waits for this task before disabling the system proxy and
        // stopping Mihomo. If cancellation arrived during proxy setup, do not
        // resurrect the UI as connected while that teardown is queued.
        guard isConnecting, !Task.isCancelled else { return false }
        isConnected = true
        isProtectionBlocked = false
        isProxyDegraded = proxyFailed
        startCoreMonitor()
        if managedCatalogReloadPending {
            managedCatalogReloadPending = false
            reloadCoreConfig()
        }
        let port = config.externalController.split(separator: ":").last.flatMap { Int($0) } ?? 9090

        // Start WebSocket streams
        let ws = ClashWebSocket(port: port, secret: config.secret)
        webSocket = ws

        ws.onTraffic = { [weak self] traffic in
            guard let self else { return }
            var stats = self.trafficStats
            stats.uploadSpeed = traffic.up
            stats.downloadSpeed = traffic.down
            self.trafficStats = stats
        }

        ws.onConnections = { [weak self] response in
            guard let self else { return }
            if let apiConnections = response.connections {
                LocalTrafficAudit.shared.recordConnections(
                    apiConnections,
                    protection: self.trafficAuditProtectionSnapshot()
                )
                // Refresh scheduling depends on this, so it must not be gated on
                // a window being visible: the rest of this handler only feeds
                // the Activity list, but pin refreshes have to make the same
                // decision whether or not anyone is looking at that page.
                self.recordLongLivedRouteActivity(apiConnections)
                // Above the visibility guard deliberately: totals that only
                // advance while someone is looking at Activity would depend on
                // where the user navigated, which is worse than showing none.
                self.appTrafficLedger.ingest(apiConnections)
            }
            guard self.isMainWindowVisible,
                  self.selectedPage == .activity else { return }
            var stats = self.trafficStats
            stats.totalUpload = response.uploadTotal
            stats.totalDownload = response.downloadTotal
            stats.activeConnections = response.connections?.count ?? 0
            self.trafficStats = stats
            self.updateConnections(from: response)
        }

        ws.onLogs = { [weak self] entries in
            LocalTrafficAudit.shared.recordCoreLogs(entries)
            let logsEnabled = AppProfile.defaults.object(forKey: SettingsKey.logsEnabled) as? Bool ?? true
            guard logsEnabled, let self, self.isMainWindowVisible,
                  self.selectedPage == .logs else { return }

            let now = Date()
            self.logEntries.append(contentsOf: entries.map {
                LogEntry(level: $0.level, message: $0.message, timestamp: now)
            })
            // Keep last 500 logs
            if self.logEntries.count > 500 {
                self.logEntries.removeFirst(self.logEntries.count - 500)
            }
        }

        ws.onStreamStalled = { stream in
            LocalTrafficAudit.shared.recordEvent(
                "audit_observer_stream_stalled",
                details: [
                    "stream": stream,
                    "protection_impact": "none",
                ]
            )
        }
        ws.onStreamRecovered = { stream in
            LocalTrafficAudit.shared.recordEvent(
                "audit_observer_stream_recovered",
                details: [
                    "stream": stream,
                    "protection_impact": "none",
                ]
            )
        }

        updateLiveStreamSubscriptions()

        // The generated Tono-Exit group's `now` value is authoritative. Avoid a
        // redundant PF reload + health probe immediately after a successful
        // start; that old round trip made the UI appear connected and then hang.
        networkInfoTask?.cancel()
        networkInfoTask = Task { [weak self] in
            guard let self else { return }
            await self.proxyService.refresh()
            await MainActor.run {
                if let selected = self.proxyService.activeNodeName,
                   self.applyProxySelection(selected) {
                    self.proxyService.activeGroupName = ConfigPipeline.exitGroupName
                    self.persistProxySelection(selected)
                } else {
                    self.restoreProxySelection(persistFallback: true)
                }
            }
            // PF permits only the selected endpoint, so never fan out latency
            // probes to every imported node.
            if let selected = self.proxyService.activeNodeName {
                _ = await self.proxyService.testLatency(name: selected)
            }
            guard !Task.isCancelled else { return }
            await self.fetchNetworkInfo()
        }
        Task { await fetchActiveRules() }
        if !isOwnedTonoMode {
            startLatencyTestTimer()
        }

        // Legacy subscription networking is available only in the explicitly
        // isolated developer profile. Production server state comes solely
        // from the authenticated managed catalog.
        let failedSubs = AppProfile.isDev
            ? subscriptions.filter { $0.nodeCount == 0 && $0.isEnabled }
            : []
        if !failedSubs.isEmpty, isOwnedTonoMode {
            Task {
                try? await Task.sleep(for: .seconds(2))
                try? await updateAllSubscriptions()
            }
        }
        return true
    }

    /// Controller streams are observation only, never part of TUN/PF safety.
    /// UI-only streams stop with their page. The optional local audit keeps
    /// only its low-frequency connection and route evidence streams alive.
    private func updateLiveStreamSubscriptions() {
        guard isConnected, let webSocket else { return }

        if isMainWindowVisible, selectedPage == .dashboard {
            webSocket.startTrafficStream()
        } else {
            webSocket.stopTrafficStream()
            trafficStats.uploadSpeed = 0
            trafficStats.downloadSpeed = 0
        }

        let localAuditEnabled = LocalTrafficAudit.isEnabled
        let claudeTrafficResearchEnabled =
            LocalTrafficAudit.isClaudeTrafficResearchEnabled
        let appRoutingResearchEnabled = AppRoutingResearch.isCollectionActive
        // Pin-refresh scheduling reads this stream, so it has to run for the
        // whole connected session. Gating it on the audit toggle alone meant a
        // user who turned the audit log off — the obvious choice in a privacy
        // product — silently lost every pin refresh, which is the exact
        // stranding this refresher exists to prevent.
        if isConnected || localAuditEnabled || claudeTrafficResearchEnabled
            || appRoutingResearchEnabled
            || (isMainWindowVisible && selectedPage == .activity) {
            webSocket.startConnectionsStream(intervalMilliseconds: 2_500)
        } else {
            webSocket.stopConnectionsStream()
        }

        let logsEnabled =
            AppProfile.defaults.object(forKey: SettingsKey.logsEnabled) as? Bool
                ?? true
        if localAuditEnabled || claudeTrafficResearchEnabled
            || (isMainWindowVisible && selectedPage == .logs && logsEnabled) {
            webSocket.startLogsStream(level: logLevel)
        } else {
            webSocket.stopLogsStream()
        }
    }

    /// Keep the root-owned Mihomo/TUN path alive while the signed-in sidecar is
    /// healthy. Loss of Mihomo removes its exact utun; detecting that interface
    /// avoids a synchronous helper IPC call on the UI actor. Recovery fails
    /// closed first, then retries the same selected exit.
    private func startCoreMonitor() {
        coreMonitorTask?.cancel()
        coreMonitorTask = Task { [weak self] in
            var healthCycle = 0
            var consecutiveHealthFailures = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard let self, !Task.isCancelled, self.isConnected else { return }
                if self.config.tunEnabled {
                    let tunExists = KillSwitchService.interfaceExists(
                        ConfigPipeline.tonoTunInterface
                    )
                    guard tunExists else {
                        self.disconnect(releaseKillSwitch: false)
                        self.errorMessage =
                            "Protected TUN stopped; Kill Switch is blocking traffic while Tono retries."
                        self.scheduleProtectedReconnect()
                        return
                    }
                    healthCycle += 1
                    // Network and DNS changes arrive through SCDynamicStore.
                    // Keep a once-per-minute command-based audit only as a
                    // fallback for missed notifications, reducing process
                    // launches from roughly 36/minute to three/minute.
                    if healthCycle.isMultiple(of: 6),
                       let service = self.protectedDNSService {
                        // Both probes queue behind the release sequence on the
                        // one privileged actor, so a user who taps Restore
                        // internet inside this window has their DNS restored
                        // *before* these resume. Without re-checking, the stale
                        // verdict then re-armed protection and blamed "Protected
                        // DNS stopped" — an explicit release silently undone.
                        // Cancelling coreMonitorTask cannot help: a task
                        // suspended on an actor call still resumes.
                        let observedGeneration = self.protectionOperationGeneration
                        let primaryService =
                            await PrivilegedRuntimeCoordinator.shared
                                .primaryNetworkService()
                        guard !Task.isCancelled, self.isConnected,
                              self.protectionOperationGeneration == observedGeneration
                        else { return }
                        guard primaryService == service else {
                            self.disconnect(releaseKillSwitch: false)
                            self.errorMessage =
                                "The active network changed; Kill Switch is blocking traffic while Tono protects the new connection."
                            self.scheduleProtectedReconnect()
                            return
                        }
                        let dnsIntegrity =
                            await PrivilegedRuntimeCoordinator.shared
                                .protectedDNSIntegrity(service: service)
                        guard !Task.isCancelled, self.isConnected,
                              self.protectionOperationGeneration == observedGeneration
                        else { return }
                        guard dnsIntegrity != .unverifiable else { continue }
                        guard dnsIntegrity == .intact else {
                            self.disconnect(releaseKillSwitch: false)
                            self.errorMessage =
                                "Protected DNS stopped; Kill Switch is blocking traffic while Tono retries."
                            self.scheduleProtectedReconnect()
                            return
                        }
                    }
                }

                guard self.isOwnedTonoMode else { continue }
                if !self.config.tunEnabled { healthCycle += 1 }
                // A helper self-heal reinstalls PF from persisted state, which
                // deliberately omits this session's direct exceptions — Mihomo
                // keeps routing WeChat direct while PF silently drops it.
                // Re-arm with the live session's endpoints as soon as the
                // helper reports a heal.
                // Never race a node switch or config reload: both arm PF with
                // transaction-specific endpoint unions this reassert would
                // clobber. The flag stays set and retries next cycle.
                if KillSwitchService.needsSessionExceptionReassert,
                   self.switchingNodeId == nil,
                   self.configReloadTask == nil {
                    LocalTrafficAudit.shared.recordEvent(
                        "killswitch_heal_reassert",
                        details: [
                            "session_endpoints": String(
                                self.activeDirectPolicy?.sessionEndpoints.count ?? 0
                            ),
                        ]
                    )
                    do {
                        try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                            apiHosts: [],
                            tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                            proxyEndpoints: self.currentProxyEndpoints(),
                            sessionDirectEndpoints:
                                self.activeDirectPolicy?.sessionEndpoints ?? [],
                            tailscaleBootstrapEnabled:
                                AppProfile.homeExitEnabled && self.tonoTransport != nil,
                            helperPrepared: true,
                            reviewedBundleDirect: self.activeDirectPolicy != nil
                        )
                        // Only a successful re-arm may consume the intent: a
                        // busy helper or a generation-guard rejection must
                        // leave the flag set so the next tick retries instead
                        // of silently black-holing session direct traffic.
                        KillSwitchService.needsSessionExceptionReassert = false
                    } catch {
                        LocalTrafficAudit.shared.recordEvent(
                            "killswitch_heal_reassert_failed",
                            details: ["error": error.localizedDescription]
                        )
                    }
                }
                // This refresh existed because pins were the only thing routing
                // these hosts direct, so a rotated CDN answer stranded the flow
                // on a stale /32. Pins are no longer that load-bearing: the
                // reviewed bundle routes direct by process path, and the web
                // hosts route direct by domain suffix with China DoH behind
                // them. Neither reads a pin.
                //
                // What the refresh does still cost is exact and measured. It
                // rewrites the runtime config, and `api.reloadConfig` tears
                // down every connection in the session — timed here at 21m26s
                // after connect, with all 20 health probes then timing out and
                // zero targets reachable directly. That is the customer-facing
                // "Connection closed mid-response" in AI tools and long
                // downloads, and it recurred for as long as a session stayed
                // up. Address churn is normal CDN behaviour; severing every
                // long-lived connection to chase it is not a trade worth
                // making now that nothing depends on the result.
                //
                // Pins therefore stay a connect-time snapshot and a redundant
                // narrower match. A stale one costs a redundant rule, not a
                // route: the suffix and process rules still resolve and dial
                // the current address.
                //
                // A policy with no suffix routes has no such backstop, so the
                // refresh stays available for it rather than being deleted.
                // The same predicate the decision uses, so the schedule and the
                // decision cannot drift apart into a refresh that is scheduled
                // and then always declined, or worse the reverse.
                let pinsAreLoadBearing =
                    self.activeDirectPolicy?.webDomainSuffixes.isEmpty ?? false
                if pinsAreLoadBearing, healthCycle.isMultiple(of: 30) {
                    await self.refreshManagedDirectPins()
                    guard !Task.isCancelled, self.isConnected else { return }
                }
                // Full external probes are recovery/liveness checks, not the
                // leak barrier. Run them every 30 seconds so a dead cloud
                // exit cannot leave Claude waiting for several minutes. Wake,
                // connect, network-change, and node-switch paths still verify
                // immediately.
                guard healthCycle.isMultiple(of: 3),
                      self.switchingNodeId == nil,
                      self.configReloadTask == nil,
                      let api = self.clashAPI,
                      let selected = self.proxyService.activeNodeName
                else { continue }

                let health = await api.testProxyDelayWithRetry(
                    name: selected,
                    url: "https://www.gstatic.com/generate_204",
                    timeout: 4_000,
                    attempts: 2,
                    retryIntervalMs: 300
                )
                let dataPlaneReady = if let delay = health.delay, delay > 0 {
                    await self.testSystemTUNDataPlaneWithRetry(
                        timeout: 6,
                        attempts: 2,
                        retryIntervalMs: 300
                    )
                } else {
                    false
                }
                guard !Task.isCancelled, self.isConnected else { return }
                guard self.switchingNodeId == nil,
                      self.configReloadTask == nil else {
                    consecutiveHealthFailures = 0
                    continue
                }
                if let delay = health.delay, delay > 0, dataPlaneReady {
                    consecutiveHealthFailures = 0
                    self.isProxyDegraded = false
                    continue
                }

                consecutiveHealthFailures += 1
                self.isProxyDegraded = true
                guard consecutiveHealthFailures >= 2 else { continue }

                // A failed managed cloud exit should not force Claude to wait
                // through the full reconnect backoff while the same node is
                // retried. This also applies when Home-US is enabled: the
                // Home/Claude route stays on Tono-Home-Residential, while its
                // dialer-proxy and the ordinary Tono-Exit traffic both depend
                // on the selected managed cloud exit. Try one other validated
                // catalog node while TUN and PF remain live. The node-switch
                // transaction moves the exact root-only endpoint permit first,
                // verifies both Mihomo and ordinary user traffic, and only
                // then commits the new selection. If it cannot complete, the
                // existing fail-closed reconnect path below remains the only
                // recovery route.
                if await self.attemptAutomaticCloudFailover() {
                    consecutiveHealthFailures = 0
                    self.isProxyDegraded = false
                    continue
                }
                guard self.isConnected, !self.isDisconnecting else { return }
                self.disconnect(releaseKillSwitch: false)
                self.errorMessage = self.importedExitNodes.count > 1
                    ? String(localized: "Protected system traffic stopped responding; Kill Switch is blocking traffic while Tono reconnects.")
                    : String(localized: "Protected system traffic stopped responding and no alternate server is available; Kill Switch is blocking traffic while Tono reconnects.")
                self.scheduleProtectedReconnect()
                return
            }
        }
    }

    /// Switch to one alternate validated managed cloud exit without releasing
    /// the protected TUN/PF transaction. When Home-US is enabled this changes
    /// only the cloud dialer beneath the Home/Claude route; it does not replace
    /// the Home-US identity or move Claude to the ordinary cloud exit.
    private func attemptAutomaticCloudFailover() async -> Bool {
        guard isConnected,
              !isDisconnecting,
              switchingNodeId == nil,
              configReloadTask == nil,
              let current = selectedExitNode() else {
            return false
        }
        // A single validated node has nowhere to fail over to, so the caller
        // falls through to the fail-closed reconnect path and retries the same
        // exit. Record that separately: without it the resulting generic
        // "stopped responding" message hides the actual reason from support,
        // and this branch is indistinguishable from a healthy no-op.
        guard importedExitNodes.count > 1 else {
            LocalTrafficAudit.shared.recordEvent(
                "automatic_cloud_failover_unavailable",
                details: ["reason": "single_validated_node"]
            )
            return false
        }

        let nodes = importedExitNodes
        guard let currentIndex = nodes.firstIndex(where: { $0.id == current.id }) else {
            return false
        }
        let rotated = Array(nodes.dropFirst(currentIndex + 1))
            + Array(nodes.prefix(currentIndex + 1))
        guard let candidate = rotated.first(where: { node in
            node.id != current.id && !proxyTarget(node.name, matches: current.name)
        }) else {
            return false
        }

        LocalTrafficAudit.shared.recordEvent(
            "automatic_cloud_failover_requested",
            details: [
                "from": current.name,
                "to": candidate.name,
            ]
        )
        selectNode(candidate.name)
        guard let switchTask = nodeSwitchTask else { return false }
        _ = await switchTask.value
        guard !Task.isCancelled,
              isConnected,
              !isDisconnecting,
              switchingNodeId == nil,
              let active = selectedExitNode(),
              active.id == candidate.id else {
            return false
        }
        errorMessage = nil
        LocalTrafficAudit.shared.recordEvent(
            "automatic_cloud_failover_succeeded",
            details: ["selected_exit": candidate.name]
        )
        return true
    }

    /// Non-prompting foreground reconciliation for the documented root
    /// emergency recovery path. Only an authenticated helper response that
    /// confirms both armed=false and wanted=false may clear Protected Offline.
    func reconcileExternalProtectionState() {
        guard isProtectionBlocked, !isConnected, !isConnecting,
              !isDisconnecting else { return }
        Task { [weak self] in
            _ = await self?.reconcileConfirmedExternalProtectionRelease()
        }
    }

    /// Returns true only when a confirmed external release was accepted. Every
    /// unavailable, malformed, or rejecting response remains fail-closed.
    @discardableResult
    private func reconcileConfirmedExternalProtectionRelease() async -> Bool {
        guard isProtectionBlocked, !isConnected, !isConnecting,
              !isDisconnecting else { return false }
        let observedGeneration = protectionOperationGeneration
        let observation = await PrivilegedRuntimeCoordinator.shared
            .refreshKillSwitchStatus()
        guard !Task.isCancelled,
              protectionOperationGeneration == observedGeneration,
              isProtectionBlocked, !isConnected, !isConnecting,
              !isDisconnecting else { return false }

        switch observation {
        case .unavailable:
            return false
        case .rejected:
            // No automatic retry can make an identity/UID rejection succeed.
            // Do not prompt on activation; the explicit Protected Offline
            // action owns the one administrator repair attempt.
            protectedReconnectPausedForUserAction = true
            protectedReconnectPauseLiftsOnNetworkChange = false
            protectedReconnectTask?.cancel()
            protectedReconnectTask = nil
            protectedReconnectID = nil
            isProtectedReconnectScheduled = false
            protectedReconnectNextAttemptAt = nil
            errorMessage =
                String(
                    localized: "Tono's network helper rejected this copy of Tono, so automatic retries are paused. Choose Repair and reconnect to reinstall the helper, or Restore internet to turn protection off. If repair keeps failing, the Support page has a recovery command."
                )
            return false
        case .confirmed(let requiresProtectionRecovery):
            KillSwitchService.isArmed = requiresProtectionRecovery
            guard !requiresProtectionRecovery else { return false }
            acceptConfirmedExternalProtectionRelease()
            return true
        }
    }

    private func acceptConfirmedExternalProtectionRelease() {
        protectionOperationGeneration &+= 1
        KillSwitchService.isArmed = false
        KillSwitchService.needsSessionExceptionReassert = false
        protectedReconnectTask?.cancel()
        protectedReconnectTask = nil
        protectedReconnectID = nil
        lastProtectedReconnectKick = nil
        isProtectedReconnectScheduled = false
        protectedReconnectAttempt = 0
        protectedReconnectNextAttemptAt = nil
        protectedReconnectPausedForUserAction = false
        protectedReconnectPauseLiftsOnNetworkChange = false
        lastProtectedFailureSignature = nil
        consecutiveProtectedFailureCount = 0
        wakeRecoveryTask?.cancel()
        wakeRecoveryTask = nil
        resumeProtectionAfterWake = false
        autoConnectRequested = false
        connectionStartedAt = nil
        connectionStageStartedAt = nil
        completedConnectionStages = []
        lastConnectionFailure = nil
        protectedDNSService = nil
        isProtectionBlocked = false
        errorMessage = nil
        LocalTrafficAudit.shared.recordEvent(
            "external_protection_release_confirmed"
        )
    }

    /// Failures the automatic reconnect loop can never resolve: repeating the
    /// identical transaction would re-raise the same administrator prompt or
    /// fail installation the same way. Weak-network and transient helper
    /// errors deliberately stay retryable.
    private static func failureRequiresUserAction(_ error: Error) -> Bool {
        switch error {
        case KillSwitchService.Error.userDenied,
             KillSwitchService.Error.installFailed,
             KillSwitchService.Error.helperRejected,
             HelperInstallError.userDenied,
             HelperInstallError.resourceNotFound,
             HelperInstallError.installFailed,
             HelperIPCError.forbidden:
            true
        default:
            false
        }
    }

    private func scheduleProtectedReconnect(immediate: Bool = false) {
        // A network-change kick carries new information: a repeated-failure
        // pause may be lifted (the environment changed, the outcome can
        // differ). A user-action pause stays — only Retry Now lifts it, or
        // the admin prompt would re-appear on every route flap.
        if immediate, protectedReconnectPausedForUserAction,
           protectedReconnectPauseLiftsOnNetworkChange {
            protectedReconnectPausedForUserAction = false
            protectedReconnectPauseLiftsOnNetworkChange = false
            lastProtectedFailureSignature = nil
            consecutiveProtectedFailureCount = 0
        }
        if immediate {
            let now = Date()
            if let lastProtectedReconnectKick,
               now.timeIntervalSince(lastProtectedReconnectKick) < 30,
               protectedReconnectTask != nil {
                return
            }
            lastProtectedReconnectKick = now
            protectedReconnectTask?.cancel()
            protectedReconnectTask = nil
            protectedReconnectID = nil
        } else if protectedReconnectTask != nil {
            // The existing loop owns the attempt counter. A failed connect must
            // never cancel it and reset weak-network backoff to two seconds.
            return
        }

        let recoveryID = UUID()
        protectedReconnectID = recoveryID
        isProtectedReconnectScheduled = true
        protectedReconnectTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if self.protectedReconnectID == recoveryID {
                    self.protectedReconnectTask = nil
                    self.protectedReconnectID = nil
                    self.isProtectedReconnectScheduled = false
                    self.protectedReconnectNextAttemptAt = nil
                    if self.isConnected || !self.isProtectionBlocked {
                        self.protectedReconnectAttempt = 0
                    }
                }
            }

            // Stay responsive through brief packet loss, then settle at a
            // battery-friendly 30-second cadence for prolonged weak signal.
            let delays = [2, 5, 10, 20, 30]
            var attempt = 0
            while !Task.isCancelled {
                // A user-action failure recorded by the previous attempt ends
                // the loop; Retry Now starts a fresh one.
                if self.protectedReconnectPausedForUserAction { return }
                let delay = immediate && attempt == 0
                    ? 0
                    : delays[min(attempt, delays.count - 1)]
                self.protectedReconnectAttempt = attempt + 1
                self.protectedReconnectNextAttemptAt = delay > 0
                    ? Date().addingTimeInterval(TimeInterval(delay))
                    : nil
                if delay > 0 {
                    try? await Task.sleep(for: .seconds(delay))
                }
                guard !Task.isCancelled else { return }
                if !self.isTonoReady {
                    attempt += 1
                    continue
                }
                self.protectedReconnectNextAttemptAt = nil

                await self.finishPendingDisconnect()
                guard !Task.isCancelled, !self.isConnected else { return }
                // Root emergency recovery may have released helper-owned PF
                // state while this loop was sleeping. Accept only an
                // authenticated unarmed status and exit before connect can
                // re-arm it; rejection pauses for explicit helper repair.
                if await self.reconcileConfirmedExternalProtectionRelease() {
                    return
                }
                guard !Task.isCancelled,
                      !self.protectedReconnectPausedForUserAction else { return }
                if self.catalogSelectionRequiresChoice {
                    return
                }
                if self.isConnecting {
                    let pending = self.connectTask
                    _ = await pending?.value
                } else if !self.isDisconnecting {
                    LocalTrafficAudit.shared.recordEvent(
                        "protected_reconnect_attempt",
                        details: [
                            "attempt": String(attempt + 1),
                            "delay_seconds": String(delay),
                            "selected_exit": self.selectedExitNode()?.name ?? "unknown",
                        ]
                    )
                    self.connect()
                    let pending = self.connectTask
                    _ = await pending?.value
                }
                await self.finishPendingDisconnect()
                if self.isConnected { return }
                attempt += 1
            }
        }
    }

    /// Let the user bypass the weak-network backoff without weakening PF. The
    /// previous recovery loop is cancelled by ID before a new immediate loop
    /// waits for any in-flight teardown and starts the same full transaction.
    func retryProtectedConnectionNow() {
        guard isProtectionBlocked, !isConnected, !isConnecting else { return }
        protectedReconnectPausedForUserAction = false
        protectedReconnectPauseLiftsOnNetworkChange = false
        // Explicit user intent earns a fresh cycle of three attempts, not a
        // single shot against a counter already sitting at the threshold.
        lastProtectedFailureSignature = nil
        consecutiveProtectedFailureCount = 0
        protectedReconnectTask?.cancel()
        protectedReconnectTask = nil
        protectedReconnectID = nil
        lastProtectedReconnectKick = nil
        isProtectedReconnectScheduled = false
        protectedReconnectNextAttemptAt = nil
        scheduleProtectedReconnect(immediate: true)
    }

    // MARK: - Proxy Management

    /// Select a node/group by name or id.
    func selectNode(_ nameOrId: String) {
        guard !isDisconnecting, switchingNodeId == nil else { return }
        guard configReloadTask == nil else {
            errorMessage =
                "Secure routing is updating. Try switching the cloud server again in a moment."
            return
        }
        if nameOrId == ConfigPipeline.homeNodeName,
           !AppProfile.homeExitEnabled || tonoTransport == nil {
            errorMessage = String(localized: "Home-US is temporarily disabled. Choose a managed cloud server.")
            return
        }
        let desiredNode = nameOrId == ConfigPipeline.homeNodeName
            ? nil
            : localProxyNode(matching: nameOrId)
        let nodeName = desiredNode?.name ?? ConfigPipeline.homeNodeName
        guard nameOrId == ConfigPipeline.homeNodeName || desiredNode != nil else {
            errorMessage = String(localized: "The selected node is unavailable.")
            return
        }

        if isConnected,
           let current = proxyService.activeNodeName,
           proxyTarget(current, matches: nodeName) {
            selectedNodeId = desiredNode?.id ?? ConfigPipeline.homeNodeName
            activeNode = desiredNode
            persistProxySelection(nodeName)
            networkInfoTask?.cancel()
            networkInfoTask = Task { [weak self] in
                await self?.fetchNetworkInfo()
            }
            return
        }

        guard isConnected else {
            selectedNodeId = desiredNode?.id ?? ConfigPipeline.homeNodeName
            activeNode = desiredNode
            proxyService.activeNodeName = nodeName
            persistProxySelection(nodeName)
            if catalogSelectionRequiresChoice {
                catalogSelectionRequiresChoice = false
                autoConnectRequested = true
                attemptAutomaticConnect()
            }
            return
        }
        // Cancel previous IP detection
        networkInfoTask?.cancel()
        networkInfo = NetworkInfo()
        switchingNodeId = desiredNode?.id ?? nodeName
        let api = clashAPI
        let switchStartedAt = Date()
        LocalTrafficAudit.shared.recordEvent(
            "node_switch_requested",
            details: [
                "from": proxyService.activeNodeName ?? "unknown",
                "to": nodeName,
            ]
        )
        nodeSwitchTask = Task { [weak self] in
            guard let self else { return }
            defer {
                self.switchingNodeId = nil
                self.startPendingConfigReloadIfPossible()
            }
            guard let api else { return }
            do {
                let endpoints = try ConfigPipeline.dialEndpoints(for: desiredNode)
                    + self.claudeHomeDialEndpoints(excluding: desiredNode)
                // The owned runtime excludes every validated catalog address,
                // so its TUN route fingerprint is stable across selections.
                // Move the exact PF permission first; until the selector moves,
                // the old route is simply blocked rather than sent directly.
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                    proxyEndpoints: endpoints,
                    sessionDirectEndpoints:
                        activeDirectPolicy?.sessionEndpoints ?? [],
                    tailscaleBootstrapEnabled: AppProfile.homeExitEnabled && tonoTransport != nil,
                    reviewedBundleDirect: activeDirectPolicy != nil
                )
                try Task.checkCancellation()
                try await api.selectProxy(
                    group: ConfigPipeline.exitGroupName,
                    proxy: nodeName
                )
                try Task.checkCancellation()
                // Fallback health is URL-specific and may still describe the
                // previous selected exit. Refresh every exact WeChat group now
                // so the new node's reachability is authoritative immediately.
                await primeManagedDirectFallbackGroups(
                    policy: activeDirectPolicy,
                    api: api
                )
                try Task.checkCancellation()
                try await api.closeAllConnections()
                try Task.checkCancellation()
                // Prove both the selector handshake and ordinary signed-in-user
                // traffic before committing the new route. Run the independent
                // probes together so the stronger check does not add a healthy
                // path round trip; retrying the data plane only affects a weak
                // or briefly cold Reality path.
                let dataPlaneTask = Task { [weak self] in
                    guard let self else { return false }
                    return await self.testSystemTUNDataPlaneWithRetry()
                }
                defer { dataPlaneTask.cancel() }
                let health = await withTaskCancellationHandler {
                    await api.testProxyDelayWithRetry(
                        name: ConfigPipeline.exitGroupName,
                        url: "https://www.gstatic.com/generate_204",
                        timeout: 5_000
                    )
                } onCancel: {
                    dataPlaneTask.cancel()
                }
                try Task.checkCancellation()
                guard let delay = health.delay, delay > 0 else {
                    throw ClashAPIError.requestFailed("Selected node health check failed")
                }
                let dataPlaneReady = await withTaskCancellationHandler {
                    await dataPlaneTask.value
                } onCancel: {
                    dataPlaneTask.cancel()
                }
                try Task.checkCancellation()
                guard dataPlaneReady else {
                    throw ClashAPIError.requestFailed(
                        "Selected node system data path failed"
                    )
                }
                await proxyService.refresh()
                selectedNodeId = desiredNode?.id ?? ConfigPipeline.homeNodeName
                activeNode = desiredNode
                proxyService.activeGroupName = ConfigPipeline.exitGroupName
                proxyService.activeNodeName = nodeName
                persistProxySelection(nodeName)
                LocalTrafficAudit.shared.recordEvent(
                    "node_switch_succeeded",
                    details: [
                        "selected_exit": nodeName,
                        "duration_ms": String(
                            max(0, Int(Date().timeIntervalSince(switchStartedAt) * 1_000))
                        ),
                    ]
                )
                networkInfoTask?.cancel()
                networkInfoTask = Task { [weak self] in
                    await self?.fetchNetworkInfo()
                }
            } catch is CancellationError {
                return
            } catch {
                // URLSession reports cancellation as URLError.cancelled rather
                // than CancellationError. An intentional disconnect must not
                // be converted into an automatic protected reconnect.
                guard !Task.isCancelled, !isDisconnecting else { return }
                LocalTrafficAudit.shared.recordEvent(
                    "node_switch_failed",
                    details: [
                        "requested_exit": nodeName,
                        "duration_ms": String(
                            max(0, Int(Date().timeIntervalSince(switchStartedAt) * 1_000))
                        ),
                        "error": error.localizedDescription,
                    ]
                )
                // The new endpoint remains the only PF exception, and stopping
                // Mihomo removes the TUN exception. Never fall back to the old
                // node or direct networking without a verified transition.
                // Reconnect the previously committed selection; if that
                // transaction also fails, connect() remains Protected Offline.
                disconnect(releaseKillSwitch: false)
                errorMessage =
                    "Node switch failed; Tono is restoring the previous protected route. "
                    + error.localizedDescription
                scheduleProtectedReconnect()
            }
        }
    }

    func selectProxyTarget(_ target: String, inGroup groupName: String) {
        guard isConnected else { return }
        if isMainProxyGroup(groupName) {
            selectNode(target)
            return
        }

        networkInfoTask?.cancel()
        networkInfo = NetworkInfo()
        let isMainGroup = isMainProxyGroup(groupName)
        networkInfoTask = Task.detached { [weak self] in
            guard let appState = self else { return }
            await appState.proxyService.selectProxy(group: groupName, proxy: target)
            if isMainGroup {
                await MainActor.run {
                    appState.selectedNodeId = target
                    appState.activeNode = appState.localProxyNode(matching: target)
                    appState.proxyService.activeGroupName = groupName
                    appState.proxyService.activeNodeName = target
                    appState.persistProxySelection(target)
                }
            }
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await appState.fetchNetworkInfo()
        }
    }

    func toggleRegion(_ regionId: String) {
        if let idx = proxyRegions.firstIndex(where: { $0.id == regionId }) {
            proxyRegions[idx].isExpanded.toggle()
        }
    }

    // MARK: - Mode

    func setProxyMode(_ mode: ProxyMode) {
        guard !isOwnedTonoMode || mode == .rule else {
            errorMessage = String(localized: "Tono keeps Rule mode locked so traffic cannot bypass the protected cloud route.")
            return
        }
        proxyMode = mode
        if isConnected, let api = clashAPI {
            Task {
                try? await api.updateMode(mode.rawValue.lowercased())
                await MainActor.run { self.networkInfo = NetworkInfo() }
                await fetchNetworkInfo()
            }
        }
    }

    // MARK: - Node Management

    func addNode(_ node: ProxyNode) {
        let flag = node.flag.isEmpty ? "🌐" : node.flag
        var nodeWithFlag = node
        nodeWithFlag.flag = flag
        do {
            _ = try ConfigPipeline.validatedOwnedNodes(importedExitNodes + [nodeWithFlag])
        } catch {
            errorMessage = error.localizedDescription
            return
        }

        let regionId = "custom"
        if let idx = proxyRegions.firstIndex(where: { $0.id == regionId }) {
            proxyRegions[idx].nodes.append(nodeWithFlag)
        } else {
            let region = ProxyRegion(id: regionId, name: "CUSTOM NODES", nodes: [nodeWithFlag])
            proxyRegions.append(region)
        }
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    func updateNode(_ node: ProxyNode) {
        let candidates = importedExitNodes.map { $0.id == node.id ? node : $0 }
        do {
            _ = try ConfigPipeline.validatedOwnedNodes(candidates)
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        for i in proxyRegions.indices {
            if let j = proxyRegions[i].nodes.firstIndex(where: { $0.id == node.id }) {
                proxyRegions[i].nodes[j] = node
                if selectedNodeId == node.id {
                    activeNode = node
                    proxyService.activeNodeName = node.name
                    persistProxySelection(node.name)
                }
                saveState()
                if isConnected { reloadCoreConfig() }
                return
            }
        }
    }

    func deleteNode(_ nodeId: String) {
        for i in proxyRegions.indices {
            proxyRegions[i].nodes.removeAll { $0.id == nodeId }
        }
        proxyRegions.removeAll { $0.nodes.isEmpty }
        if selectedNodeId == nodeId || activeNode?.id == nodeId {
            restoreProxySelection(persistFallback: true)
        }
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    func clearAllNodes() {
        proxyRegions.removeAll()
        selectedNodeId = nil
        activeNode = nil
        proxyService.activeNodeName = nil
        persistProxySelection(nil)
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    // MARK: - Rules

    func addRule(_ rule: RuleItem) {
        rules.append(rule)
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    func deleteRule(_ ruleId: String) {
        rules.removeAll { $0.id == ruleId }
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    func moveRule(from source: IndexSet, to destination: Int) {
        rules.move(fromOffsets: source, toOffset: destination)
        saveState()
        if isConnected { reloadCoreConfig() }
    }

    /// Rewrite config on disk and tell mihomo to reload it.
    ///
    /// `applyingDirectPolicy` switches the transaction into a lightweight
    /// pins-only refresh: the pending policy is armed and written instead of
    /// `activeDirectPolicy`, established connections are left alone (no
    /// close-all, no exit health gate), the pending policy is committed only
    /// after a successful reload, and a failure keeps the session up instead
    /// of tearing it down fail-closed.
    func reloadCoreConfig(
        applyingDirectPolicy pendingDirectPolicy:
            ConfigPipeline.ManagedDirectRuntimePolicy? = nil
    ) {
        // Do not cancel a mutation after PF or Mihomo may already have accepted
        // part of it. Coalesce behind the active transaction instead; the most
        // recent pin set wins, while a requested full rewrite is preserved.
        if configReloadTask != nil || switchingNodeId != nil {
            if let pendingDirectPolicy {
                pendingDirectPolicyReload = pendingDirectPolicy
            } else {
                pendingFullConfigReload = true
            }
            return
        }
        let portString = AppProfile.defaults.string(forKey: SettingsKey.mixedPort) ?? "7890"
        let port = Int(portString).flatMap { (1024...65535).contains($0) ? $0 : nil } ?? 7890
        let overlay = ConfigPipeline.OverlayConfig(
            mixedPort: port,
            secret: config.secret,
            mode: config.mode,
            logLevel: config.logLevel,
            allowLan: config.allowLan,
            tunEnabled: config.tunEnabled,
            selectedNodeName: selectedExitNode()?.name ?? ConfigPipeline.homeNodeName,
            tonoTransport: tonoTransport,
            claudeHomeNodeName: managedCatalogRouting?.homeProxy,
            defaultNodeName: managedCatalogRouting?.defaultProxy,
            claudeHomeSocks5: managedCatalogRouting?.homeSocks5
        )
        let selectedExit = selectedExitNode()
        let selectedExitName = selectedExit?.name
        let runtimeNodes = importedExitNodes
        let transport = tonoTransport
        let api = clashAPI
        let ownedRuntime = isOwnedTonoMode
        configReloadRequestID += 1
        let requestID = configReloadRequestID
        let pinsOnlyRefresh = pendingDirectPolicy != nil
        configReloadTask = Task { [weak self] in
            guard let self else { return }
            let effectiveDirectPolicy = pendingDirectPolicy ?? activeDirectPolicy
            var pinsRuntimeCommitted = false
            do {
                // During a pins-only refresh, arm the union of old and new
                // endpoints: the old config keeps dialing old pins until the
                // reload lands, and a mid-transaction failure must leave every
                // in-force pin PF-permitted. The next full arm converges back
                // to the exact set.
                let sessionEndpoints: [ConfigPipeline.DirectEndpoint]
                if pinsOnlyRefresh {
                    sessionEndpoints = Array(Set(
                        (effectiveDirectPolicy?.sessionEndpoints ?? [])
                            + (self.activeDirectPolicy?.sessionEndpoints ?? [])
                    )).sorted {
                        ($0.transport, $0.port, $0.address)
                            < ($1.transport, $1.port, $1.address)
                    }
                } else {
                    sessionEndpoints = effectiveDirectPolicy?.sessionEndpoints ?? []
                }
                try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                    tunnelInterfaces: KillSwitchService.interfaceExists(ConfigPipeline.tonoTunInterface)
                        ? [ConfigPipeline.tonoTunInterface]
                        : [],
                    proxyEndpoints: (try ConfigPipeline.dialEndpoints(for: selectedExit))
                        + self.claudeHomeDialEndpoints(excluding: selectedExit),
                    sessionDirectEndpoints: sessionEndpoints,
                    tailscaleBootstrapEnabled: AppProfile.homeExitEnabled && transport != nil,
                    reviewedBundleDirect: effectiveDirectPolicy != nil
                )
                try Task.checkCancellation()
                try await clashManager.rewriteConfig(
                    overlay: overlay,
                    customNodes: runtimeNodes,
                    directPolicy: effectiveDirectPolicy
                )
                try Task.checkCancellation()
                guard let api else {
                    finishConfigReloadRequest(requestID)
                    return
                }
                let runtimeConfigPath = try await PrivilegedRuntimeCoordinator.shared.syncCoreConfig(
                    configDirectory: clashManager.configDirectory.path,
                    configSHA256: try requireRuntimeConfigDigest()
                )
                try Task.checkCancellation()
                try await api.reloadConfig(path: runtimeConfigPath)

                if let pendingDirectPolicy {
                    // Mihomo has accepted the new pins, so they are now the
                    // authoritative in-memory policy even if a later PF call
                    // fails. Do not honor cancellation between this commit and
                    // exact PF convergence: disconnect is the only safe exit.
                    self.activeDirectPolicy = pendingDirectPolicy
                    pinsRuntimeCommitted = true
                    // The pre-reload arm intentionally allowed old ∪ new so
                    // the old runtime could keep dialing during the swap. Once
                    // Mihomo commits the new config, immediately remove the old
                    // tuples rather than leaving a growing root PF allowlist.
                    try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
                        tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
                        proxyEndpoints: (try ConfigPipeline.dialEndpoints(
                            for: selectedExit
                        )) + self.claudeHomeDialEndpoints(excluding: selectedExit),
                        sessionDirectEndpoints:
                            pendingDirectPolicy.sessionEndpoints,
                        tailscaleBootstrapEnabled:
                            AppProfile.homeExitEnabled && transport != nil,
                        // The convergence arm rewrites the whole ruleset, so
                        // omitting this drops the reviewed-bundle permit while
                        // the rule engine still routes that bundle direct —
                        // those packets then hit `block drop out quick all` and
                        // the app silently black-holes until the next full arm.
                        reviewedBundleDirect: true
                    )
                    // Priming immediately after a reload measured 20 of 20
                    // targets timing out and 0 reachable directly, versus 10
                    // reachable on the same targets at connect. Those verdicts
                    // are not noise: a fallback group with no healthy direct
                    // member sends traffic that belongs on the direct path
                    // through the tunnel until the next probe cycle. Wait for
                    // the controller to answer before asking it anything.
                    try? await api.waitUntilReady()
                    await primeManagedDirectFallbackGroups(
                        policy: pendingDirectPolicy,
                        api: api
                    )
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_pins_refreshed",
                        details: [
                            "domains": String(pendingDirectPolicy.domainPins.count),
                            "web_domains": String(
                                pendingDirectPolicy.webDomainPins.count
                            ),
                            "endpoints": String(
                                pendingDirectPolicy.sessionEndpoints.count
                            ),
                        ]
                    )
                } else if let effectiveDirectPolicy {
                    await primeManagedDirectFallbackGroups(
                        policy: effectiveDirectPolicy,
                        api: api
                    )
                }
                try Task.checkCancellation()
                if ownedRuntime, selectedExitName != nil, !pinsOnlyRefresh {
                    try await api.closeAllConnections()
                    try Task.checkCancellation()
                    let health = await api.testProxyDelayWithRetry(
                        name: ConfigPipeline.exitGroupName,
                        url: "https://www.gstatic.com/generate_204",
                        timeout: 5_000
                    )
                    try Task.checkCancellation()
                    guard let delay = health.delay, delay > 0 else {
                        throw ClashAPIError.requestFailed(
                            "Updated cloud server health check failed"
                        )
                    }
                    await proxyService.refresh()
                    networkInfoTask?.cancel()
                    networkInfoTask = Task { [weak self] in
                        await self?.fetchNetworkInfo()
                    }
                }
                finishConfigReloadRequest(requestID)
            } catch is CancellationError {
                guard pinsRuntimeCommitted, !isDisconnecting else { return }
                LocalTrafficAudit.shared.recordEvent(
                    "managed_direct_pf_convergence_cancelled"
                )
                disconnect(releaseKillSwitch: false)
                errorMessage =
                    "Secure WeChat routing was interrupted while updating; Kill Switch is blocking traffic while Tono retries."
                scheduleProtectedReconnect(immediate: true)
            } catch {
                // Once Mihomo accepted new pins, neither cancellation nor a
                // superseding reload may leave PF at the temporary union. This
                // branch must win over the ordinary stale-request guards.
                if pinsOnlyRefresh, pinsRuntimeCommitted {
                    guard !isDisconnecting else { return }
                    // The core is already using the new exact pins but PF could
                    // not converge from old ∪ new to the new set. Stop the core
                    // and return to bootstrap-only protection; treating this as
                    // a harmless background failure would retain stale direct
                    // permissions indefinitely.
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_pf_convergence_failed",
                        details: ["error": String(describing: error)]
                    )
                    disconnect(releaseKillSwitch: false)
                    errorMessage =
                        "Secure WeChat routing could not finish updating; Kill Switch is blocking traffic while Tono retries."
                    scheduleProtectedReconnect(immediate: true)
                    return
                }
                guard !Task.isCancelled, !isDisconnecting else { return }
                guard configReloadRequestID == requestID else { return }
                if pinsOnlyRefresh {
                    // A background pin refresh must never take the session
                    // down. The armed endpoint set is a superset of the
                    // active one, the old config is still in force, and the
                    // next monitor cycle will retry.
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_refresh_failed",
                        details: ["error": String(describing: error)]
                    )
                    finishConfigReloadRequest(requestID)
                } else if ownedRuntime {
                    finishConfigReloadRequest(requestID, startPending: false)
                    disconnect(releaseKillSwitch: false)
                    errorMessage =
                        "Updated cloud route failed; Kill Switch is blocking traffic while Tono retries. \(error.localizedDescription)"
                    scheduleProtectedReconnect()
                } else {
                    finishConfigReloadRequest(requestID)
                    errorMessage =
                        "Failed to apply the updated core configuration: \(error.localizedDescription)"
                }
            }
        }
    }

    /// Completes one serialized runtime mutation and starts the newest queued
    /// request. Pin changes take precedence because a full rewrite will then
    /// naturally include the newly committed exact direct policy.
    private func finishConfigReloadRequest(
        _ requestID: Int,
        startPending: Bool = true
    ) {
        guard configReloadRequestID == requestID else { return }
        configReloadTask = nil
        guard startPending, isConnected, !isDisconnecting else {
            if !startPending {
                pendingDirectPolicyReload = nil
                pendingFullConfigReload = false
            }
            return
        }
        startPendingConfigReloadIfPossible()
    }

    private func startPendingConfigReloadIfPossible() {
        guard configReloadTask == nil, switchingNodeId == nil,
              isConnected, !isDisconnecting else { return }
        if let policy = pendingDirectPolicyReload {
            pendingDirectPolicyReload = nil
            reloadCoreConfig(applyingDirectPolicy: policy)
        } else if pendingFullConfigReload {
            pendingFullConfigReload = false
            reloadCoreConfig()
        }
    }

    /// Populate Mihomo's URL-specific fallback state before new application
    /// connections rely on it. Tests run concurrently, so the barrier costs at
    /// most one bounded probe timeout rather than host-count × timeout. A host
    /// probe never fails the protected tunnel: REJECT remains the deterministic
    /// all-down result, and controller errors are audited separately.
    private func primeManagedDirectFallbackGroups(
        policy: ConfigPipeline.ManagedDirectRuntimePolicy?,
        api: ClashAPI
    ) async {
        let targets = ConfigPipeline.managedDirectFallbackTargets(for: policy)
        guard !targets.isEmpty else { return }
        let results = await withTaskGroup(
            of: ManagedDirectHealthResult.self,
            returning: [ManagedDirectHealthResult].self
        ) { group in
            for target in targets {
                group.addTask {
                    do {
                        let outcome = try await api.testProxyGroupMembers(
                            name: target.groupName,
                            url: target.testURL,
                            timeout: ConfigPipeline
                                .managedDirectPrimeTimeoutMilliseconds
                        )
                        switch outcome {
                        case .reachableMembers(let delays):
                            if delays[ConfigPipeline.directProxyName] != nil {
                                return .direct
                            }
                            if delays[ConfigPipeline.exitGroupName] != nil {
                                return .protectedExit
                            }
                            return .unavailable
                        case .allUnavailable:
                            return .unavailable
                        }
                    } catch {
                        return .controllerError(
                            String(error.localizedDescription.prefix(200))
                        )
                    }
                }
            }
            var values: [ManagedDirectHealthResult] = []
            for await value in group { values.append(value) }
            return values
        }
        guard !Task.isCancelled else { return }
        var direct = 0
        var protectedExit = 0
        var unavailable = 0
        var controllerErrors: [String] = []
        for result in results {
            switch result {
            case .direct: direct += 1
            case .protectedExit: protectedExit += 1
            case .unavailable: unavailable += 1
            case .controllerError(let message): controllerErrors.append(message)
            }
        }
        var details = [
            "targets": String(targets.count),
            "direct": String(direct),
            "protected_exit": String(protectedExit),
            "unavailable": String(unavailable),
            "controller_errors": String(controllerErrors.count),
        ]
        if let firstError = controllerErrors.first {
            details["first_error"] = firstError
        }
        LocalTrafficAudit.shared.recordEvent(
            "managed_direct_health_primed",
            details: details
        )
    }

    private func requireRuntimeConfigDigest() throws -> String {
        guard let digest = clashManager.runtimeConfigSHA256 else {
            throw HelperIPCError.invalidResponse
        }
        return digest
    }

    // MARK: - Connection Management

    func closeConnection(_ connectionId: String) async {
        guard let api = clashAPI else { return }
        do {
            try await api.closeConnection(id: connectionId)
            await MainActor.run {
                connections.removeAll { $0.id == connectionId }
            }
        } catch {
            errorMessage =
                "Could not close the connection: \(error.localizedDescription)"
        }
    }

    func clearLogs() {
        logEntries.removeAll()
    }

    func closeAllConnections() async {
        guard let api = clashAPI else { return }
        do {
            try await api.closeAllConnections()
            await MainActor.run {
                connections.removeAll()
                trafficStats.activeConnections = 0
            }
        } catch {
            errorMessage =
                "Could not close active connections: \(error.localizedDescription)"
        }
    }

    // MARK: - Latency Testing

    func testNodeLatency(_ name: String) async {
        guard isOwnedTonoMode, clashAPI != nil else { return }
        guard proxyTarget(name, matches: proxyService.activeNodeName ?? "") else { return }
        _ = await proxyService.testLatency(name: proxyService.activeNodeName ?? name)
    }

    func testAllLatency() async {
        // Testing all imported endpoints would require opening all of them in
        // PF. Protected mode probes only the current selection.
        guard isOwnedTonoMode, clashAPI != nil else { return }
        guard let selected = proxyService.activeNodeName else { return }
        _ = await proxyService.testLatency(name: selected)
    }


    // MARK: - Managed exit catalog

    func acceptManagedExitCatalog(
        _ response: TonoExitCatalogResponse
    ) async throws {
        do {
            try await installManagedExitCatalog(
                ManagedExitCatalogCache(
                    revision: response.revision,
                    yaml: response.yaml,
                    sha256: response.sha256,
                    updatedAt: response.updatedAt,
                    routing: response.routing
                ),
                persistCache: true,
                allowRuntimeTransition: true
            )
        } catch {
            errorMessage = String(localized: "Cloud server update was rejected; the last verified catalog remains active. \(error.localizedDescription)")
            throw error
        }
    }

    private func installManagedExitCatalog(
        _ catalog: ManagedExitCatalogCache,
        persistCache: Bool,
        allowRuntimeTransition: Bool
    ) async throws {
        if catalog.revision < managedCatalogRevision {
            // Never accept a control-plane rollback over a newer cached catalog.
            return
        }
        if catalog.revision == managedCatalogRevision {
            guard managedCatalogDigest == catalog.sha256 else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            return
        }

        let nodes = try await managedCatalogProcessor.validate(
            catalog,
            customNodes: customNodes
        )

        // A slower older validation must never overwrite a newer catalog if
        // callers overlap (for example, manual refresh plus periodic sync).
        if catalog.revision < managedCatalogRevision {
            return
        }
        if catalog.revision == managedCatalogRevision {
            guard managedCatalogDigest == catalog.sha256 else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            return
        }
        if persistCache {
            try await managedCatalogProcessor.persistIfNewest(catalog)
            // Another catalog can apply while the disk actor is writing.
            if catalog.revision < managedCatalogRevision {
                return
            }
            if catalog.revision == managedCatalogRevision {
                guard managedCatalogDigest == catalog.sha256 else {
                    throw TonoAPIClient.APIError.invalidResponse
                }
                return
            }
        }

        let validatedRouting = validatedCatalogRouting(catalog.routing, nodes: nodes)

        let previousSelection = currentProxySelectionTarget()
        let previousCloudNodes = proxyRegions
            .filter { $0.id != "custom" }
            .flatMap(\.nodes)
        let selectedCloudNodeWasRemoved: Bool = if let previousSelection,
                                                   previousSelection != ConfigPipeline.homeNodeName {
            previousCloudNodes.contains { proxyTarget($0.name, matches: previousSelection) }
                && !nodes.contains { proxyTarget($0.name, matches: previousSelection) }
        } else {
            false
        }

        let liveSessionTornDown = allowRuntimeTransition
            && selectedCloudNodeWasRemoved
            && (isConnected || isConnecting)
        if liveSessionTornDown {
            // Remove both the old TUN and its exact PF endpoint before changing
            // the visible selection. Automatic connect remains blocked until
            // the user explicitly chooses a surviving exit.
            disconnect(releaseKillSwitch: false)
        }

        let customRegions = proxyRegions.filter { $0.id == "custom" }
        let managedRegions = nodes.isEmpty
            ? []
            : [ProxyRegion(
                id: Self.managedCatalogRegionID,
                name: "TONO CLOUD",
                nodes: nodes
            )]
        proxyRegions = managedRegions + customRegions
        managedCatalogRevision = catalog.revision
        managedCatalogDigest = catalog.sha256
        managedCatalogRouting = validatedRouting

        if selectedCloudNodeWasRemoved {
            applyDefaultProxySelection(persist: true)
            if managedCatalogRouting?.defaultProxy != nil,
               currentProxySelectionTarget() != nil {
                catalogSelectionRequiresChoice = false
                errorMessage = String(localized: "The selected cloud server was removed. Tono switched to the managed default cloud server.")
                if liveSessionTornDown {
                    autoConnectRequested = true
                    attemptAutomaticConnect()
                }
            } else {
                catalogSelectionRequiresChoice = true
                autoConnectRequested = false
                errorMessage = String(localized: "The selected cloud server was removed. Kill Switch is still blocking traffic; choose another cloud server.")
            }
        } else if !migrateCloudExitDefaultIfNeeded() {
            restoreProxySelection(preferredTarget: previousSelection, persistFallback: true)
        }
        if allowRuntimeTransition {
            saveState()
        } else {
            saveProxyRegionsOnly()
        }

        guard allowRuntimeTransition else { return }
        if isConnected {
            reloadCoreConfig()
        } else if isConnecting {
            managedCatalogReloadPending = true
        }
    }

    private func validatedCatalogRouting(
        _ routing: TonoExitCatalogRouting?,
        nodes: [ProxyNode]
    ) -> TonoExitCatalogRouting? {
        guard let routing else { return nil }

        func validatedName(_ raw: String?, field: String) -> String? {
            guard let raw else { return nil }
            let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty,
                  nodes.contains(where: { proxyTarget($0.name, matches: name) })
            else {
                LocalTrafficAudit.shared.recordEvent(
                    "managed_catalog_routing_ignored",
                    details: ["field": field]
                )
                return nil
            }
            return nodes.first(where: { proxyTarget($0.name, matches: name) })?.name
        }

        let homeSocks5 = ConfigPipeline.validatedHomeSocks5(routing.homeSocks5)
        if routing.homeSocks5 != nil, homeSocks5 == nil {
            // Never include the credential-bearing value in diagnostics.
            LocalTrafficAudit.shared.recordEvent(
                "managed_catalog_routing_ignored",
                details: ["field": "homeSocks5"]
            )
        }
        // homeSocks5 is the stronger directive: if both arrive in a hand
        // edited cache, keep exactly one Claude home route.
        let homeProxy = homeSocks5 == nil
            ? validatedName(routing.homeProxy, field: "homeProxy")
            : nil
        let defaultProxy = validatedName(routing.defaultProxy, field: "defaultProxy")
        guard homeProxy != nil || homeSocks5 != nil || defaultProxy != nil else {
            return nil
        }
        return TonoExitCatalogRouting(
            homeProxy: homeProxy,
            defaultProxy: defaultProxy,
            homeSocks5: homeSocks5
        )
    }

    // MARK: - Managed traffic policy

    func acceptManagedTrafficPolicy(
        _ response: TonoTrafficPolicyResponse
    ) async throws {
        do {
            try await installManagedTrafficPolicy(
                ManagedTrafficPolicyCache(
                    revision: response.revision,
                    json: response.json,
                    sha256: response.sha256,
                    updatedAt: response.updatedAt,
                    signature: response.signature
                ),
                persistCache: true,
                allowRuntimeTransition: true
            )
        } catch {
            errorMessage =
                "Cloud app-routing update was rejected; all traffic remains protected by the current route."
            throw error
        }
    }

    private func installManagedTrafficPolicy(
        _ cache: ManagedTrafficPolicyCache,
        persistCache: Bool,
        allowRuntimeTransition: Bool
    ) async throws {
        // The processor actor is recreated on every launch, while the
        // mode-0600 disk cache may contain a newer policy than a delayed or
        // stale control-plane response. Never let that response downgrade
        // the active policy (or overwrite the newer cache) during startup.
        if let persisted = ConfigStorage.shared.loadManagedTrafficPolicy() {
            if persisted.revision > cache.revision {
                if persisted.revision > managedTrafficPolicyRevision {
                    try await installManagedTrafficPolicy(
                        persisted,
                        persistCache: false,
                        allowRuntimeTransition: allowRuntimeTransition
                    )
                }
                return
            }
            if persisted.revision == cache.revision {
                guard persisted.sha256 == cache.sha256 else {
                    throw TonoAPIClient.APIError.invalidResponse
                }
                switch ManagedTrafficPolicySignature.sameRevisionTransition(
                    from: persisted.signature,
                    to: cache.signature
                ) {
                case .unchanged, .upgradeToTrusted:
                    break
                case .downgradeAttempt:
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_policy_signature_downgrade_ignored",
                        details: ["revision": String(cache.revision)]
                    )
                    return
                case .replacementAttempt:
                    throw TonoAPIClient.APIError.invalidResponse
                }
            }
        }
        if cache.revision < managedTrafficPolicyRevision { return }
        if cache.revision == managedTrafficPolicyRevision {
            guard managedTrafficPolicyDigest == cache.sha256 else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            switch ManagedTrafficPolicySignature.sameRevisionTransition(
                from: managedTrafficPolicySignature,
                to: cache.signature
            ) {
            case .unchanged:
                return
            case .upgradeToTrusted:
                break
            case .downgradeAttempt:
                LocalTrafficAudit.shared.recordEvent(
                    "managed_direct_policy_signature_downgrade_ignored",
                    details: ["revision": String(cache.revision)]
                )
                return
            case .replacementAttempt:
                throw TonoAPIClient.APIError.invalidResponse
            }
        }
        // Same revision, same bytes, different signature is not "already
        // installed". It is the upgrade case: a build that predates signature
        // verification cached this revision without its signature, so the copy
        // applied at startup was validated against the compiled-in allowlist and
        // dropped any host that allowlist does not name. Returning here would leave
        // it dropped until the *next* revision is published — which is exactly the
        // revision that first carries a new domain, so the feature would appear not
        // to work for every user who upgraded rather than installed fresh.

        let policy = try await managedTrafficPolicyProcessor.validate(
            cache,
            protectedAddresses: managedDirectProtectedAddresses()
        )
        // These two ask whether another task installed this document while this one
        // was validating. A document includes its signature, so an unsigned copy of
        // the same revision does not count as having installed the signed one.
        if cache.revision < managedTrafficPolicyRevision { return }
        if cache.revision == managedTrafficPolicyRevision {
            guard managedTrafficPolicyDigest == cache.sha256 else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            switch ManagedTrafficPolicySignature.sameRevisionTransition(
                from: managedTrafficPolicySignature,
                to: cache.signature
            ) {
            case .unchanged:
                return
            case .upgradeToTrusted:
                break
            case .downgradeAttempt:
                return
            case .replacementAttempt:
                throw TonoAPIClient.APIError.invalidResponse
            }
        }
        if persistCache {
            try await managedTrafficPolicyProcessor.persistIfNewest(cache)
            if cache.revision < managedTrafficPolicyRevision { return }
            if cache.revision == managedTrafficPolicyRevision {
                guard managedTrafficPolicyDigest == cache.sha256 else {
                    throw TonoAPIClient.APIError.invalidResponse
                }
                switch ManagedTrafficPolicySignature.sameRevisionTransition(
                    from: managedTrafficPolicySignature,
                    to: cache.signature
                ) {
                case .unchanged:
                    return
                case .upgradeToTrusted:
                    break
                case .downgradeAttempt:
                    return
                case .replacementAttempt:
                    throw TonoAPIClient.APIError.invalidResponse
                }
            }
        }

        let behaviorChanged = policy != managedTrafficPolicy
        managedTrafficPolicy = policy
        managedTrafficPolicyRevision = cache.revision
        managedTrafficPolicyDigest = cache.sha256
        managedTrafficPolicySignature = cache.signature

        guard allowRuntimeTransition, behaviorChanged,
              isConnected || isConnecting else { return }
        // Policy changes are rare. Reuse the already-audited full protected
        // reconnect instead of hot-editing PF states under an active Reality
        // socket. The bootstrap-only transition clears every session exception.
        disconnect(releaseKillSwitch: false)
        errorMessage =
            "Secure app routing was updated; Tono is applying it without opening direct Internet."
        scheduleProtectedReconnect(immediate: true)
    }

    private func managedDirectProtectedAddresses() -> Set<String> {
        var addresses = Set(importedExitNodes.map(\.server))
        if let bootstrap = Bundle.main.object(
            forInfoDictionaryKey: "TonoAPIBootstrapAddresses"
        ) as? [String] {
            addresses.formUnion(bootstrap)
        }
        addresses.formUnion(["1.1.1.1", "8.8.8.8"])
        return addresses
    }

    private func initialDirectPolicy(
        physicalInterface: String,
        policy: TonoTrafficPolicy
    ) throws -> ConfigPipeline.ManagedDirectRuntimePolicy? {
        guard !policy.domains.isEmpty || !policy.mediaEndpoints.isEmpty
                || !policy.tcpEndpoints.isEmpty
                || !policy.webDomains.isEmpty
                || !policy.directSuffixes.isEmpty else {
            return nil
        }
        let media = policy.mediaEndpoints.flatMap { endpoint in
            endpoint.ports.compactMap { port in
                UInt16(exactly: port).map {
                    ConfigPipeline.DirectEndpoint(
                        address: endpoint.address,
                        port: $0,
                        transport: "udp"
                    )
                }
            }
        }
        let tcp = policy.tcpEndpoints.flatMap { endpoint in
            endpoint.ports.compactMap { port in
                UInt16(exactly: port).map {
                    ConfigPipeline.DirectEndpoint(
                        address: endpoint.address,
                        port: $0,
                        transport: "tcp"
                    )
                }
            }
        }
        let directSuffixes = try policy.directSuffixes.map { entry in
            let host = try ConfigPipeline.validatedManagedDirectSuffix(
                entry.host,
                trusted: policy.trusted
            )
            guard host == entry.host,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                throw ConfigPipeline.TonoInjectionError.unsafeNode(
                    "managed direct suffix"
                )
            }
            let ports = entry.ports.compactMap(UInt16.init(exactly:))
            guard ports.count == entry.ports.count else {
                throw ConfigPipeline.TonoInjectionError.unsafeNode(
                    "managed direct suffix"
                )
            }
            return ConfigPipeline.DirectDomainSuffix(
                host: host,
                ports: ports.sorted()
            )
        }.sorted { $0.host < $1.host }
        let runtime = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: physicalInterface,
            domainPins: [],
            webDomainPins: [],
            webDomainSuffixes: directSuffixes,
            // Both are reviewed-bundle-only routes that the bundle-wide process
            // rule already matches first, so emitting them would add fallback
            // groups and PF endpoints for rules mihomo never reaches.
            mediaEndpoints: [],
            tcpEndpoints: [],
            directResolverHosts: (policy.domains + policy.webDomains)
                .map(\.host),
            trusted: policy.trusted
        )
        return try ConfigPipeline.validatedManagedDirectPolicy(
            runtime,
            excluding: managedDirectProtectedAddresses()
        )
    }

    /// PF proxy permits for the currently selected exit, matching what the
    /// connect and reload transactions arm.
    private func currentProxyEndpoints() -> [ConfigPipeline.DialEndpoint] {
        let selected = selectedExitNode()
        return ((try? ConfigPipeline.dialEndpoints(for: selected)) ?? [])
            + claudeHomeDialEndpoints(excluding: selected)
    }

    /// Claude's home route is a second exact proxy endpoint, so it must be
    /// admitted to PF whenever the selected exit is armed. Do not duplicate a
    /// selected node: the helper's endpoint set is intentionally unique.
    private func claudeHomeDialEndpoints(
        excluding selected: ProxyNode?
    ) -> [ConfigPipeline.DialEndpoint] {
        guard managedCatalogRouting?.homeSocks5 == nil,
              let homeName = managedCatalogRouting?.homeProxy,
              let home = proxyRegions
                .flatMap(\.nodes)
                .first(where: { proxyTarget($0.name, matches: homeName) }),
              home.id != selected?.id
        else { return [] }
        return (try? ConfigPipeline.dialEndpoints(for: home)) ?? []
    }

    /// Safety net against total pin staleness: re-resolves the managed-direct
    /// domains mid-session and, only when a host's committed pins have mostly
    /// drained out of the live answer set, rolls a merged pin set through the
    /// lightweight pins-only reload. Deliberately does nothing while the
    /// committed pins still overlap the live answers — CDN round-robin
    /// reshuffles answers on every query, and reacting to every reshuffle
    /// would churn PF and the runtime config all session long.
    /// A pin refresh rewrites the runtime config, asks Mihomo to reload it, and
    /// re-arms PF twice. Established flows do not survive that, so a rotating
    /// WeChat CDN address was able to cut a Claude or ChatGPT response in half
    /// every few minutes. Streaming responses are the whole point of those
    /// routes, so the refresh waits for them — bounded, because pins that stay
    /// stale eventually break WeChat outright: `hosts:` keeps resolving a
    /// retired address, and no fallback group can rescue a dead dial target.
    private static let pinRefreshStreamGraceSeconds: TimeInterval = 5
    private static let pinRefreshMaximumDeferrals = 3

    private func recordLongLivedRouteActivity(_ connections: [APIConnection]) {
        let now = Date.now
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        // Keyed on traffic that the direct policy is *meant* to serve, not on
        // traffic already riding the direct chain. Pin resolution can fail for
        // a whole session, and then nothing reaches the direct route at all —
        // keying on the chain would let that session never refresh and leave
        // the route permanently proxied.
        let policyHosts = managedDirectPolicyHosts
        var oldest: Date?
        for connection in connections {
            if connection.chains.contains(ConfigPipeline.directProxyName)
                || connection.chains.contains(where: {
                    $0.hasPrefix(ConfigPipeline.managedDirectFallbackGroupPrefix)
                }) {
                lastManagedDirectActivity = now
            } else {
                let host = connection.metadata.host.lowercased()
                if !host.isEmpty, policyHosts.contains(where: {
                    host == $0 || host.hasSuffix(".\($0)")
                }) {
                    lastManagedDirectActivity = now
                }
            }
            // Only the assistant route. `MATCH,Tono-Exit` is the terminal rule,
            // so including the exit group would match every proxied flow in a
            // full-tunnel session and make this permanently true — deferring
            // every refresh to the cap and then forcing one mid-stream anyway.
            guard connection.chains.contains(ConfigPipeline.claudeHomeGroupName)
            else { continue }
            let started = formatter.date(from: connection.start)
                ?? ISO8601DateFormatter().date(from: connection.start)
            guard let started, started <= now else { continue }
            if oldest == nil || started < oldest! { oldest = started }
        }
        oldestProxiedConnectionStart = oldest
    }

    /// Pins exist for one purpose: keeping reviewed China-direct dials working.
    /// When nothing has used that route for a while, refreshing them buys
    /// nobody anything and still costs every open connection, so the rotation
    /// is simply allowed to go stale until the route is used again — a connect
    /// or a node switch rebuilds it from scratch anyway.
    private var managedDirectRouteRecentlyUsed: Bool {
        guard let lastManagedDirectActivity else { return false }
        return Date.now.timeIntervalSince(lastManagedDirectActivity)
            < Self.managedDirectIdleWindowSeconds
    }

    private static let managedDirectIdleWindowSeconds: TimeInterval = 600

    /// Hosts the current direct policy is responsible for, used to notice that
    /// the route is wanted even while it is failing.
    private var managedDirectPolicyHosts: [String] {
        (managedTrafficPolicy.domains + managedTrafficPolicy.webDomains)
            .map { $0.host.lowercased() }
    }

    /// True while a proxied flow has been open long enough to be a stream
    /// rather than a short request that can simply be retried.
    private var hasInFlightProxiedStream: Bool {
        guard let oldestProxiedConnectionStart else { return false }
        return Date.now.timeIntervalSince(oldestProxiedConnectionStart)
            >= Self.pinRefreshStreamGraceSeconds
    }

    private func refreshManagedDirectPins() async {
        guard isConnected, isOwnedTonoMode,
              switchingNodeId == nil,
              configReloadTask == nil,
              let api = clashAPI,
              let base = activeDirectPolicy,
              !managedTrafficPolicy.domains.isEmpty
                || !managedTrafficPolicy.webDomains.isEmpty
        else { return }
        let resolved = await resolveManagedDirectDomains(
            policy: managedTrafficPolicy,
            base: base,
            api: api
        )
        guard !Task.isCancelled, isConnected,
              switchingNodeId == nil, configReloadTask == nil,
              let resolved else { return }
        guard let merged = Self.mergedManagedDirectPolicy(
            current: base,
            resolved: resolved
        ), merged != base else { return }
        do {
            let validated = try ConfigPipeline.validatedManagedDirectPolicy(
                merged,
                excluding: managedDirectProtectedAddresses()
            )
            guard let validated, validated != base else { return }
            // The branch structure lives in ManagedDirectRefreshPolicy so it can
            // be exercised without a connected session; this call site only
            // gathers the inputs and carries out the verdict.
            let decision = ManagedDirectRefreshPolicy.decide(
                .init(
                    pinsAreLoadBearing: base.webDomainSuffixes.isEmpty,
                    routeUsedRecently: managedDirectRouteRecentlyUsed,
                    hasInFlightProxiedStream: hasInFlightProxiedStream,
                    deferralsSoFar: pinRefreshDeferralCount,
                    maximumDeferrals: Self.pinRefreshMaximumDeferrals
                )
            )
            pinRefreshDeferralCount = ManagedDirectRefreshPolicy
                .deferralCount(after: decision)
            switch decision {
            case .skipPinsNotLoadBearing:
                return
            case .skipRouteIdle:
                LocalTrafficAudit.shared.recordEvent(
                    "managed_direct_pins_refresh_skipped_idle",
                    details: ["idle_window_s": String(Int(Self.managedDirectIdleWindowSeconds))]
                )
                return
            case .deferForInFlightStream(let deferral):
                LocalTrafficAudit.shared.recordEvent(
                    "managed_direct_pins_refresh_deferred",
                    details: [
                        "reason": "in_flight_proxied_stream",
                        "deferral": String(deferral),
                        "limit": String(Self.pinRefreshMaximumDeferrals),
                    ]
                )
                return
            case .apply(let forcedAfterDeferrals):
                if forcedAfterDeferrals > 0 {
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_pins_refresh_forced",
                        details: ["deferrals": String(forcedAfterDeferrals)]
                    )
                }
                reloadCoreConfig(applyingDirectPolicy: validated)
            }
        } catch {
            LocalTrafficAudit.shared.recordEvent(
                "managed_direct_refresh_invalid",
                details: ["error": String(describing: error)]
            )
        }
    }

    /// Merges freshly resolved pins into the committed set, per host:
    /// - a host whose committed addresses still overlap the live answers by
    ///   two or more is left untouched (still serviceable, avoid churn);
    /// - a mostly drained host keeps its still-live addresses first, then
    ///   fills with fresh answers up to the validated 8-address cap;
    /// - a host that failed to resolve keeps its last known-good pins;
    /// - hosts new to the resolved set are adopted as-is.
    /// Returns nil when nothing needs to change.
    // Exposed to tests: pin stickiness decides how often a config reload —
    // and with it every severed long-lived connection — happens at all.
    static func mergedManagedDirectPolicy(
        current: ConfigPipeline.ManagedDirectRuntimePolicy,
        resolved: ConfigPipeline.ManagedDirectRuntimePolicy
    ) -> ConfigPipeline.ManagedDirectRuntimePolicy? {
        func mergePins(
            _ currentPins: [ConfigPipeline.DirectDomainPin],
            _ resolvedPins: [ConfigPipeline.DirectDomainPin]
        ) -> [ConfigPipeline.DirectDomainPin] {
            let resolvedByHost = Dictionary(
                uniqueKeysWithValues: resolvedPins.map { ($0.host, $0) }
            )
            var currentHosts = Set(currentPins.map(\.host))
            var pins = currentPins.map { pin -> ConfigPipeline.DirectDomainPin in
                guard let fresh = resolvedByHost[pin.host] else { return pin }
                let freshSet = Set(fresh.addresses)
                let live = pin.addresses.filter { freshSet.contains($0) }
                // Absence from one answer is not evidence that a committed
                // address stopped working: these hosts are CDN names whose DNS
                // returns a rotating slice of a large pool, so requiring two
                // survivors rewrote most pins every cycle. That rewrite is what
                // made `merged != base` true every few minutes, and each one
                // costs a config reload that severs every long-lived
                // connection. Replace a pin only when nothing it holds appears
                // any more, which is the case that actually means stale.
                guard live.isEmpty else { return pin }
                var addresses = live
                for address in fresh.addresses where !addresses.contains(address) {
                    guard addresses.count < 8 else { break }
                    addresses.append(address)
                }
                return ConfigPipeline.DirectDomainPin(
                    host: pin.host,
                    addresses: addresses.sorted(),
                    ports: fresh.ports
                )
            }
            for fresh in resolvedPins where !currentHosts.contains(fresh.host) {
                currentHosts.insert(fresh.host)
                pins.append(fresh)
            }
            return pins.sorted { $0.host < $1.host }
        }
        let merged = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: current.physicalInterface,
            domainPins: mergePins(current.domainPins, resolved.domainPins),
            webDomainPins: mergePins(
                current.webDomainPins,
                resolved.webDomainPins
            ),
            webDomainSuffixes: current.webDomainSuffixes,
            mediaEndpoints: current.mediaEndpoints,
            tcpEndpoints: current.tcpEndpoints,
            directResolverHosts: current.directResolverHosts,
            trusted: current.trusted
        )
        return merged == current ? nil : merged
    }

    /// Pin resolution used to race Mihomo's resolver: a connect that reached
    /// this point before the DoH upstream was usable had all 38 hosts exhaust
    /// their retry ladders together — measured at 35 of 38 failing in the same
    /// millisecond, costing 7.6s and leaving the session with almost no pins,
    /// which is why the WeChat direct share swung between roughly half and
    /// three quarters depending on who won the race. One cheap probe first
    /// turns that into a short wait. Any non-throwing reply proves the resolver
    /// answers — an empty answer counts, since emptiness is a verdict about the
    /// name, not about readiness.
    private func awaitResolverReadiness(probeHost: String?, api: ClashAPI) async {
        guard let probeHost else { return }
        let startedAt = Date()
        let deadline = startedAt.addingTimeInterval(5)
        var attempts = 0
        while Date() < deadline {
            if Task.isCancelled { return }
            attempts += 1
            if (try? await api.resolveIPv4(probeHost)) != nil {
                if attempts > 1 {
                    LocalTrafficAudit.shared.recordEvent(
                        "managed_direct_resolver_ready",
                        details: [
                            "attempts": String(attempts),
                            "waited_ms": String(
                                Int(Date().timeIntervalSince(startedAt) * 1_000)
                            ),
                        ]
                    )
                }
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        LocalTrafficAudit.shared.recordEvent(
            "managed_direct_resolver_never_ready",
            details: ["attempts": String(attempts)]
        )
    }

    private func resolveManagedDirectDomains(
        policy: TonoTrafficPolicy,
        base: ConfigPipeline.ManagedDirectRuntimePolicy?,
        api: ClashAPI
    ) async -> ConfigPipeline.ManagedDirectRuntimePolicy? {
        guard !policy.webDomains.isEmpty,
              let physicalInterface = base?.physicalInterface else {
            return base
        }
        // The reviewed bundle's own pins, TCP endpoints and media endpoints are
        // no longer resolved, and none of them are emitted. Every rule they fed
        // carried `PROCESS-PATH-REGEX` for the same bundle, and the bundle-wide
        // process rule is emitted ahead of them, so mihomo never reached one:
        // the observed dial to an address no pin contained matched
        // `AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,…))`, which is the whole
        // reason enumerating its rotating HTTPDNS addresses was abandoned.
        //
        // Dropping them removes 11 DNS resolutions, ~120 PF session endpoints,
        // and the 20 per-host fallback groups whose connect-time prime probed
        // 20 targets before the session was allowed to report connected.
        //
        // Web hosts are still resolved. They are exact `DOMAIN` routes, and
        // while the addresses no longer decide anything — routing matches on
        // the name, region-correct answers come from `nameserver-policy`, and
        // PF admits the dial by port — expressing them as suffixes to skip the
        // resolution would widen `feishu.cn` and `xiaohongshu.com` into every
        // subdomain. That distinction is the control plane's to make, not this
        // client's.
        let protectedAddresses = managedDirectProtectedAddresses()
        await awaitResolverReadiness(
            probeHost: policy.webDomains.first?.host,
            api: api
        )
        let webPins = await resolveManagedDirectDomainPins(
            policy.webDomains,
            protectedAddresses: protectedAddresses,
            api: api
        )
        let runtime = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: physicalInterface,
            domainPins: [],
            webDomainPins: webPins,
            webDomainSuffixes: base?.webDomainSuffixes ?? [],
            mediaEndpoints: [],
            tcpEndpoints: [],
            directResolverHosts: base?.directResolverHosts
                ?? (policy.domains + policy.webDomains).map(\.host),
            trusted: policy.trusted
        )
        do {
            return try ConfigPipeline.validatedManagedDirectPolicy(
                runtime,
                excluding: protectedAddresses
            )
        } catch {
            LocalTrafficAudit.shared.recordEvent(
                "managed_direct_policy_invalid",
                details: ["error": String(describing: error)]
            )
            return nil
        }
    }

    private func resolveManagedDirectDomainPins(
        _ domains: [TonoTrafficPolicyDomain],
        protectedAddresses: Set<String>,
        api: ClashAPI
    ) async -> [ConfigPipeline.DirectDomainPin] {
        let pins = await withTaskGroup(
            of: ConfigPipeline.DirectDomainPin?.self
        ) { group in
            for domain in domains {
                group.addTask {
                    // The runtime's DoH upstream can be cold right after the
                    // tunnel comes up; one 2s attempt silently dropping the
                    // domain for the whole session is not acceptable. Retry
                    // briefly, then audit the drop so it is diagnosable.
                    var resolvedAnswers: [String]?
                    for attempt in 0..<3 {
                        if Task.isCancelled { return nil }
                        if attempt > 0 {
                            try? await Task.sleep(
                                for: .milliseconds(500 * (1 << (attempt - 1)))
                            )
                        }
                        if let answers = try? await api.resolveIPv4(domain.host) {
                            resolvedAnswers = answers
                            break
                        }
                    }
                    guard let answers = resolvedAnswers else {
                        // A cancelled task ends with nil answers too; only a
                        // genuine resolution failure is worth an audit entry.
                        if !Task.isCancelled {
                            LocalTrafficAudit.shared.recordEvent(
                                "managed_direct_resolution_failed",
                                details: ["host": domain.host]
                            )
                        }
                        return nil
                    }
                    var addresses = Set<String>()
                    for raw in answers.prefix(16) {
                        guard let address = try? ConfigPipeline.validatedPublicIPv4(
                            raw,
                            field: "managed direct DNS answer"
                        ), !protectedAddresses.contains(address) else { continue }
                        addresses.insert(address)
                        if addresses.count == 8 { break }
                    }
                    guard !addresses.isEmpty else {
                        // Resolution succeeded but every answer was filtered
                        // (non-public, or colliding with a protected address).
                        // Without this event the drop is indistinguishable
                        // from a healthy domain in the audit trail.
                        LocalTrafficAudit.shared.recordEvent(
                            "managed_direct_answers_filtered",
                            details: [
                                "host": domain.host,
                                "answer_count": String(answers.count),
                            ]
                        )
                        return nil
                    }
                    let ports = domain.ports.compactMap(UInt16.init(exactly:))
                    guard ports.count == domain.ports.count else { return nil }
                    return ConfigPipeline.DirectDomainPin(
                        host: domain.host,
                        addresses: addresses.sorted(),
                        ports: ports.sorted()
                    )
                }
            }
            var resolved: [ConfigPipeline.DirectDomainPin] = []
            for await pin in group {
                if let pin { resolved.append(pin) }
            }
            return resolved.sorted { $0.host < $1.host }
        }
        return pins
    }

    // MARK: - User subscription

    /// Proxy port for subscription downloads. Prefer Mihomo mixed-port when up;
    /// otherwise the local Tailscale SOCKS (already exit-node pinned).
    private var activeProxyPort: Int? {
        if isConnected { return config.mixedPort }
        if let tono = tonoTransport { return Int(tono.port) }
        return nil
    }

    private var subscriptionUsesSocks5: Bool {
        !isConnected && tonoTransport != nil
    }

    /// Network fetch of subscriptions is gated on a healthy Tono transport.
    /// Callers may still add/store URLs while offline; refresh waits for ready.
    private func requireTransportForNetworkFetch() throws {
        guard isTonoReady else {
            throw SubscriptionError.downloadFailed
        }
    }

    func updateSubscription(url: String) async throws {
        guard AppProfile.isDev else {
            throw SubscriptionError.downloadFailed
        }
        try requireTransportForNetworkFetch()
        switch SubscriptionURLPolicy.validate(url) {
        case .failure(let rejection):
            throw rejection
        case .success:
            break
        }
        let existingSubscription = subscriptions.first { $0.url == url }
        let subscriptionId = existingSubscription?.id ?? UUID().uuidString
        let previousSelection = currentProxySelectionTarget()
        // Prefer Mihomo mixed-port so downloads go Home-US, never proxy-free.
        let (regions, rawYAML, userInfo) = try await subscriptionManager.fetchAndOrganize(
            url: url,
            proxyPort: activeProxyPort,
            tonoMode: true,
            useSocks5: subscriptionUsesSocks5
        )
        _ = try ConfigPipeline.validatedOwnedNodes(
            regions.flatMap(\.nodes) + customNodes
        )
        let sourcedRegions = Self.assignSubscription(subscriptionId, to: regions)
        await MainActor.run {
            let customRegions = self.proxyRegions.filter { $0.id == "custom" }
            self.proxyRegions = sourcedRegions + customRegions
            self.restoreProxySelection(preferredTarget: previousSelection, persistFallback: true)
            // Merge rules: keep user rules, replace subscription rules
            let hasRules = rawYAML.components(separatedBy: .newlines)
                .contains { $0.trimmingCharacters(in: .whitespaces) == "rules:" }
            if hasRules {
                let parsedRules = ConfigParser.parseClashYAMLRules(rawYAML, source: .subscription, subscriptionId: subscriptionId)
                if !parsedRules.isEmpty {
                    let userRules = self.rules.filter { $0.source == .user }
                    self.rules = userRules + parsedRules
                }
            }
            self.saveState()
        }

        // Save raw YAML for mihomo to use directly
        ConfigStorage.shared.saveRawSubscriptionYAML(rawYAML)

        // Save subscription info with traffic data
        let info = SubscriptionInfo(
            id: subscriptionId,
            url: url,
            name: existingSubscription?.name ?? "Default",
            lastUpdate: Date(),
            nodeCount: regions.flatMap(\.nodes).count,
            isEnabled: existingSubscription?.isEnabled ?? true,
            upload: userInfo?.upload,
            download: userInfo?.download,
            total: userInfo?.total,
            expire: userInfo?.expire
        )
        if let idx = subscriptions.firstIndex(where: { $0.url == url }) {
            subscriptions[idx] = info
        }
        await subscriptionManager.saveSubscriptionInfo(
            info
        )
    }

    @discardableResult
    func addSubscription(url: String, name: String, isEnabled: Bool = true) -> String {
        guard AppProfile.isDev else {
            errorMessage = AppDelegate.managedCatalogImportMessage
            return ""
        }
        // Store even if not ready; never download here.
        let validatedURL: String
        switch SubscriptionURLPolicy.validate(url) {
        case .success(let u):
            validatedURL = u.absoluteString
        case .failure(let rejection):
            errorMessage = rejection.localizedDescription
            return ""
        }
        let displayName = name.isEmpty ? Self.extractSubscriptionName(from: validatedURL) : name
        if isEnabled {
            for i in subscriptions.indices {
                subscriptions[i].isEnabled = false
            }
        }
        let sub = SubscriptionInfo(url: validatedURL, name: displayName, isEnabled: isEnabled)
        subscriptions.append(sub)
        Task { await subscriptionManager.saveSubscriptions(subscriptions) }
        return sub.id
    }

    func removeSubscription(_ id: String) {
        guard let removed = subscriptions.first(where: { $0.id == id }) else { return }
        let removedWasEnabled = removed.isEnabled
        subscriptions.removeAll { $0.id == id }
        _ = Self.normalizeSingleEnabledSubscription(&subscriptions)
        let hasEnabledSubscription = subscriptions.contains(where: \.isEnabled)

        if removedWasEnabled && !hasEnabledSubscription {
            ConfigStorage.shared.saveRawSubscriptionYAML("")
        }

        let didRemoveRuntimeContent = removeSubscriptionRuntimeContent(
            for: id,
            includeUnattributedSubscriptionContent: removedWasEnabled || !hasEnabledSubscription
        )
        if didRemoveRuntimeContent, isConnected {
            reloadCoreConfig()
        }
        Task { await subscriptionManager.saveSubscriptions(subscriptions) }
    }

    func renameSubscription(_ id: String, name: String) {
        guard let idx = subscriptions.firstIndex(where: { $0.id == id }) else { return }
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        subscriptions[idx].name = trimmedName.isEmpty
            ? Self.extractSubscriptionName(from: subscriptions[idx].url)
            : trimmedName
        Task { await subscriptionManager.saveSubscriptions(subscriptions) }
    }

    func deactivateSubscription(_ id: String) {
        guard let idx = subscriptions.firstIndex(where: { $0.id == id }) else { return }
        subscriptions[idx].isEnabled = false
        if !subscriptions.contains(where: \.isEnabled) {
            clearSubscriptionRuntimeState()
        }
        Task { await subscriptionManager.saveSubscriptions(subscriptions) }
    }

    func setSubscriptionEnabled(_ id: String, enabled: Bool) {
        guard let idx = subscriptions.firstIndex(where: { $0.id == id }) else { return }

        if enabled {
            for i in subscriptions.indices {
                subscriptions[i].isEnabled = i == idx
            }
        } else {
            subscriptions[idx].isEnabled = false
            if !subscriptions.contains(where: \.isEnabled) {
                clearSubscriptionRuntimeState()
            }
        }

        Task { await subscriptionManager.saveSubscriptions(subscriptions) }
    }

    func activateSubscription(_ id: String) async throws {
        guard let idx = subscriptions.firstIndex(where: { $0.id == id }) else { return }
        let previousSubscriptions = subscriptions

        for i in subscriptions.indices {
            subscriptions[i].isEnabled = i == idx
        }
        await subscriptionManager.saveSubscriptions(subscriptions)

        do {
            try await updateAllSubscriptions()
        } catch {
            subscriptions = previousSubscriptions
            await subscriptionManager.saveSubscriptions(subscriptions)
            throw error
        }
    }

    func updateSubscriptionDetails(_ id: String, name: String, url: String) {
        guard let idx = subscriptions.firstIndex(where: { $0.id == id }) else { return }

        let trimmedURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let urlChanged = subscriptions[idx].url != trimmedURL

        subscriptions[idx].url = trimmedURL
        subscriptions[idx].name = trimmedName.isEmpty ? Self.extractSubscriptionName(from: trimmedURL) : trimmedName

        if urlChanged {
            subscriptions[idx].lastUpdate = nil
            subscriptions[idx].nodeCount = 0
            subscriptions[idx].upload = nil
            subscriptions[idx].download = nil
            subscriptions[idx].total = nil
            subscriptions[idx].expire = nil
        }

        Task { await subscriptionManager.saveSubscriptions(subscriptions) }
    }

    /// Extract a human-readable name from a subscription URL.
    /// e.g. "https://example.com/sub?target=clash&..." → "example.com"
    /// e.g. "https://example.com/clash/config.yaml" → "example.com"
    private static func extractSubscriptionName(from urlString: String) -> String {
        guard let url = URL(string: urlString),
              let host = url.host else {
            return "Subscription"
        }
        // Remove common prefixes
        var name = host
        for prefix in ["api.", "sub.", "www.", "subscribe."] {
            if name.hasPrefix(prefix) && name.count > prefix.count + 3 {
                name = String(name.dropFirst(prefix.count))
                break
            }
        }
        return name
    }

    func updateAllSubscriptions() async throws {
        try requireTransportForNetworkFetch()
        _ = Self.normalizeSingleEnabledSubscription(&subscriptions)
        let previousSelection = currentProxySelectionTarget()
        let (regions, updatedSubs, rawYAML) = try await subscriptionManager.fetchAllAndOrganize(
            subscriptions,
            proxyPort: activeProxyPort,
            tonoMode: true,
            useSocks5: subscriptionUsesSocks5
        )
        _ = try ConfigPipeline.validatedOwnedNodes(
            regions.flatMap(\.nodes) + customNodes
        )
        await MainActor.run {
            self.subscriptions = updatedSubs
            // Preserve custom nodes across subscription updates
            let customRegions = self.proxyRegions.filter { $0.id == "custom" }
            self.proxyRegions = regions + customRegions
            self.restoreProxySelection(preferredTarget: previousSelection, persistFallback: true)
            // Merge rules: keep user rules, replace subscription rules
            let hasRulesSection = rawYAML.components(separatedBy: .newlines)
                .contains { $0.trimmingCharacters(in: .whitespaces) == "rules:" }
            if hasRulesSection {
                let activeSubscriptionId = updatedSubs.first(where: \.isEnabled)?.id
                let parsedRules = ConfigParser.parseClashYAMLRules(rawYAML, source: .subscription, subscriptionId: activeSubscriptionId)
                if !parsedRules.isEmpty {
                    let userRules = self.rules.filter { $0.source == .user }
                    self.rules = userRules + parsedRules
                }
            }
            self.saveState()
        }
        await subscriptionManager.saveSubscriptions(updatedSubs)

        if !rawYAML.isEmpty {
            ConfigStorage.shared.saveRawSubscriptionYAML(rawYAML)
        }
    }

    private static func normalizeSingleEnabledSubscription(_ subscriptions: inout [SubscriptionInfo]) -> Bool {
        var foundEnabled = false
        var changed = false

        for i in subscriptions.indices where subscriptions[i].isEnabled {
            if foundEnabled {
                subscriptions[i].isEnabled = false
                changed = true
            } else {
                foundEnabled = true
            }
        }

        return changed
    }

    private func clearSubscriptionRuntimeState() {
        let customRegions = proxyRegions.filter { $0.id == "custom" }
        proxyRegions = customRegions
        restoreProxySelection(persistFallback: true)
        rules = rules.filter { $0.source == .user }
        saveState()
        ConfigStorage.shared.saveRawSubscriptionYAML("")
        if isConnected { reloadCoreConfig() }
    }

    private static func assignSubscription(_ subscriptionId: String, to regions: [ProxyRegion]) -> [ProxyRegion] {
        regions.map { region in
            var sourcedRegion = region
            sourcedRegion.nodes = region.nodes.map { node in
                var sourcedNode = node
                sourcedNode.subscriptionId = subscriptionId
                return sourcedNode
            }
            return sourcedRegion
        }
    }

    @discardableResult
    private func removeSubscriptionRuntimeContent(for subscriptionId: String, includeUnattributedSubscriptionContent: Bool) -> Bool {
        let previousSelection = currentProxySelectionTarget()
        var removedNode = false
        var removedRule = false

        proxyRegions = proxyRegions.compactMap { region in
            guard region.id != "custom" else { return region }

            var filteredRegion = region
            filteredRegion.nodes.removeAll { node in
                let shouldRemove = node.subscriptionId == subscriptionId
                    || (includeUnattributedSubscriptionContent && node.subscriptionId == nil)
                if shouldRemove { removedNode = true }
                return shouldRemove
            }
            return filteredRegion.nodes.isEmpty ? nil : filteredRegion
        }

        let previousRuleCount = rules.count
        rules.removeAll { rule in
            rule.subscriptionId == subscriptionId
                || (includeUnattributedSubscriptionContent && rule.source == .subscription && rule.subscriptionId == nil)
        }
        removedRule = rules.count != previousRuleCount

        guard removedNode || removedRule else { return false }

        restoreProxySelection(preferredTarget: previousSelection, persistFallback: true)
        saveState()
        return true
    }

    @discardableResult
    private func assignUnattributedSubscriptionRuntime(to subscriptionId: String) -> Bool {
        var changed = false

        for regionIndex in proxyRegions.indices where proxyRegions[regionIndex].id != "custom" {
            for nodeIndex in proxyRegions[regionIndex].nodes.indices where proxyRegions[regionIndex].nodes[nodeIndex].subscriptionId == nil {
                proxyRegions[regionIndex].nodes[nodeIndex].subscriptionId = subscriptionId
                changed = true
            }
        }

        for ruleIndex in rules.indices where rules[ruleIndex].source == .subscription && rules[ruleIndex].subscriptionId == nil {
            rules[ruleIndex].subscriptionId = subscriptionId
            changed = true
        }

        return changed
    }

    func startAutoUpdate(intervalHours: Int = 6) {
        guard AppProfile.isDev else { return }
        stopAutoUpdate()
        let interval = TimeInterval(intervalHours * 3600)
        autoUpdateTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                try? await self?.updateAllSubscriptions()
            }
        }
    }

    func stopAutoUpdate() {
        autoUpdateTimer?.invalidate()
        autoUpdateTimer = nil
    }

    // MARK: - Proxy Guard

    /// Periodically verify system proxy hasn't been tampered with by other software.
    private func startProxyGuard() {
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

    private func stopProxyGuard() {
        proxyGuardTimer?.invalidate()
        proxyGuardTimer = nil
    }

    // MARK: - Periodic Latency Test

    private func startLatencyTestTimer() {
        stopLatencyTestTimer()
        // Never run bulk subscription outbound latency tests in Tono mode.
        if isOwnedTonoMode { return }
        latencyTestTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isConnected, !self.isOwnedTonoMode else { return }
                await self.proxyService.testAllLatency()
            }
        }
    }

    private func stopLatencyTestTimer() {
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
        guard isConnected, let api = clashAPI else { return }

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
                            self.errorMessage =
                                "System proxy: \(error.localizedDescription)"
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
                            errorMessage =
                                "System proxy: \(error.localizedDescription)"
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
                            errorMessage =
                                "System proxy: \(error.localizedDescription)"
                        }
                    }
                }
            } catch {
                errorMessage =
                    "Could not apply the setting: \(error.localizedDescription)"
            }
        }
    }

    // MARK: - API Data Fetching


    private func fetchActiveRules() async {
        guard let api = clashAPI else {
            print("[LiquidClash]","fetchActiveRules: no API")
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
                print("[LiquidClash]","fetchActiveRules: \(rulesResponse.rules.count) inline rules, \(providersResponse?.providers.count ?? 0) providers (\(providerTotal) total)")
                await MainActor.run {
                    self.activeRules = rulesResponse.rules
                    self.ruleProviders = providersResponse?.providers ?? [:]
                }
                if providerTotal > 0 { return }
            } catch {
                print("[LiquidClash]","fetchActiveRules failed: \(error)")
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
        let rulesetDir = clashManager.configDirectory.appendingPathComponent("ruleset")
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
            if await testSystemTUNDataPlane(timeout: timeout) { return true }

            guard attempt + 1 < attemptCount else { break }
            do {
                try await Task.sleep(for: .milliseconds(retryIntervalMs))
            } catch {
                return false
            }
        }
        return false
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
        guard isConnected, !isProtectionBlocked, let api = clashAPI,
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

    /// Query Mihomo's DNS listener directly while macOS is still using its
    /// original resolver. A fake-IP answer proves all of the following before
    /// the system mutation: port 53 is owned by this core, its internal DNS
    /// module is active, and its DoH request can traverse Tono-Exit.
    private func testLocalProtectedDNS(timeout: Int = 5) async -> Bool {
        await testProtectedDNS(
            server: ProtectedDNSContract.server,
            port: ProtectedDNSContract.port,
            timeout: timeout
        )
    }

    private func testSystemProtectedDNS() async -> Bool {
        for attempt in 0..<3 {
            if await testProtectedDNS(server: nil, port: nil, timeout: 2) {
                return true
            }
            guard attempt < 2, !Task.isCancelled else { return false }
            try? await Task.sleep(for: .milliseconds(200))
        }
        return false
    }

    private func testProtectedDNS(
        server: String?,
        port: Int?,
        timeout: Int
    ) async -> Bool {
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
                    proc.executableURL = URL(fileURLWithPath: "/usr/bin/dig")
                    proc.environment = [
                        "PATH": "/usr/bin:/bin",
                        "LC_ALL": "C",
                    ]
                    var arguments: [String] = []
                    if let server {
                        arguments.append("@\(server)")
                    }
                    if let port {
                        arguments.append(contentsOf: ["-p", "\(port)"])
                    }
                    arguments.append(contentsOf: [
                        "www.gstatic.com",
                        "A",
                        "+short",
                        "+time=\(max(1, timeout))",
                        "+tries=1",
                    ])
                    proc.arguments = arguments
                    let output = Pipe()
                    proc.standardOutput = output
                    proc.standardError = FileHandle.nullDevice
                    do {
                        try proc.run()
                        proc.waitUntilExit()
                        let data = output.fileHandleForReading.readDataToEndOfFile()
                        guard data.count <= 4 * 1_024 else {
                            continuation.resume(returning: false)
                            return
                        }
                        let values = String(decoding: data, as: UTF8.self)
                            .split(whereSeparator: \.isNewline)
                            .map {
                                $0.trimmingCharacters(
                                    in: .whitespacesAndNewlines
                                )
                            }
                        continuation.resume(
                            returning: proc.terminationStatus == 0
                                && values.contains(where: {
                                    $0.hasPrefix("198.18.")
                                })
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

    private func fetchNetworkInfo() async {
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

    private func updateConnections(from response: APIConnectionsResponse) {
        guard let apiConnections = response.connections else { return }
        let timestamp = Date.now.formatted(
            .dateTime.hour(.twoDigits(amPM: .omitted))
                .minute(.twoDigits)
                .second(.twoDigits)
        )

        connections = apiConnections.prefix(50).map { conn in
            let type: ConnectionType
            if conn.chains.contains("REJECT") || conn.rule == "REJECT" {
                type = .rejected
            } else if conn.chains.contains("DIRECT") || conn.rule == "DIRECT" {
                type = .direct
            } else {
                type = .proxied
            }

            let chainNode = conn.chains.first ?? "Direct"
            let flag = ConfigParser.guessFlag(from: chainNode)
            let destinationHost = conn.metadata.destinationIP ?? "unknown"
            let destination = conn.metadata.destinationPort.map {
                "\(destinationHost):\($0)"
            } ?? destinationHost

            return ConnectionEntry(
                id: conn.id,
                domain: conn.metadata.host.isEmpty ? (conn.metadata.destinationIP ?? "unknown") : conn.metadata.host,
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
                processName: conn.metadata.process?.isEmpty == false
                    ? conn.metadata.process
                    : nil,
                route: conn.chains.isEmpty
                    ? "Direct"
                    : conn.chains.joined(separator: " → "),
                uploadText: formatBytes(conn.upload),
                downloadText: formatBytes(conn.download)
            )
        }
    }

    /// Resolves the control-plane host through the protected resolver and stores
    /// the answer for the helper's next arm.
    ///
    /// Runs only while connected, which is the whole point: the resolver reached
    /// here is Mihomo's, over the tunnel, so this never queries the physical
    /// network's DNS — the exact thing `allowSystemResolution: false` exists to
    /// prevent during protected recovery.
    private func refreshControlPlanePinCache(api: ClashAPI) async {
        guard let host = TonoAPIClient.configuredBaseURL().host?.lowercased(),
              !host.isEmpty else { return }
        guard let answers = try? await api.resolveIPv4(host), !answers.isEmpty else {
            return
        }
        KillSwitchService.rememberControlPlaneAddresses(answers, for: host)
    }

    private func trafficAuditProtectionSnapshot()
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

    func compactRemoteDiagnosticSnapshot() -> TonoDiagnosticSnapshot {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        let selected = proxyService.activeNodeName ?? activeNode?.name ?? "unknown"
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
            selectedExit: String(selected.prefix(100)), connectionStage: String(connectionStage.rawValue.prefix(100)),
            reconnectAttempt: min(max(protectedReconnectAttempt, 0), 1000),
            lastErrorCategory: lastErrorCategory,
            lastCrashLabel: nil
        )
    }

    private func auditProtectionDetails() -> [String: String] {
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

    // MARK: - Persistence

    /// Loads local disk state only. Network refresh is deferred until
    /// `refreshSubscriptionsIfReady()` when AccountSession reports ready + descriptor.
    func loadInitialData() async {
        guard !initialDataLoaded else { return }
        let loadTask: Task<InitialDiskSnapshot, Never>
        if let initialDataLoadTask {
            loadTask = initialDataLoadTask
        } else {
            let loader = initialDataLoader
            let task = Task { await loader.load() }
            initialDataLoadTask = task
            loadTask = task
        }
        let snapshot = await loadTask.value
        // Multiple SwiftUI scene tasks may await the same disk snapshot. Only
        // the first applies it; every caller still returns after it is ready.
        guard !initialDataLoaded else { return }

        let runtimeControllerSecret = config.secret

        proxyRegions = snapshot.proxyRegions
        rules = snapshot.rules
        if let cachedCatalog = snapshot.cachedCatalog {
            do {
                try await installManagedExitCatalog(
                    cachedCatalog,
                    persistCache: false,
                    allowRuntimeTransition: false
                )
            } catch {
                // Never keep legacy subscription regions active merely because
                // the authenticated cache is absent or invalid.
                proxyRegions.removeAll { $0.id != "custom" }
            }
        } else {
            proxyRegions.removeAll { $0.id != "custom" }
        }
        if let cachedTrafficPolicy = snapshot.cachedTrafficPolicy {
            do {
                try await installManagedTrafficPolicy(
                    cachedTrafficPolicy,
                    persistCache: false,
                    allowRuntimeTransition: false
                )
            } catch {
                managedTrafficPolicy = TonoTrafficPolicy(
                    version: 1,
                    domains: [],
                    mediaEndpoints: []
                )
                managedTrafficPolicyRevision = -1
                managedTrafficPolicyDigest = nil
                managedTrafficPolicySignature = nil
            }
        }
        print("[Tono] loadInitialData: \(proxyRegions.count) regions, \(rules.count) rules from disk")

        restoreProxySelection()

        if let savedConfig = snapshot.config {
            config = savedConfig
            // The Mihomo controller credential is ephemeral and never trusted
            // from disk, including preferences written by older releases.
            config.secret = runtimeControllerSecret
        }

        // Load subscription metadata from disk only — no network until transport ready.
        if AppProfile.isDev {
            var loadedSubscriptions = await subscriptionManager.loadSubscriptions()
            let normalized = Self.normalizeSingleEnabledSubscription(&loadedSubscriptions)
            subscriptions = loadedSubscriptions
            if normalized {
                await subscriptionManager.saveSubscriptions(loadedSubscriptions)
            }
            if let enabledSubscriptionId = loadedSubscriptions.first(where: \.isEnabled)?.id,
               assignUnattributedSubscriptionRuntime(to: enabledSubscriptionId) {
                saveState()
            }
        } else {
            subscriptions = []
        }
        initialDataLoaded = true
        initialDataLoadTask = nil
        attemptAutomaticConnect()
        // Do NOT auto-refresh over the network here (P0 gate).
    }

    /// Call after AccountSession is `.ready` and `tonoTransport` is set.
    func refreshSubscriptionsIfReady() async {
        guard AppProfile.isDev, isTonoReady, !subscriptions.isEmpty else { return }
        try? await updateAllSubscriptions()
    }

    /// Load mock data for previews only
    func loadMockData() {
        proxyRegions = mockProxyRegions
        rules = mockRules
        connections = mockConnections
        selectedNodeId = proxyRegions.first?.nodes.first?.id
        activeNode = proxyRegions.first?.nodes.first
    }

    func saveState() {
        let regions = proxyRegions
        let currentRules = rules
        let currentConfig = config
        let previous = persistenceTask
        let writer = persistenceWriter
        persistenceTask = Task {
            _ = await previous?.value
            await writer.save(
                regions: regions,
                rules: currentRules,
                config: currentConfig
            )
        }
    }

    private func saveProxyRegionsOnly() {
        let regions = proxyRegions
        let previous = persistenceTask
        let writer = persistenceWriter
        persistenceTask = Task {
            _ = await previous?.value
            await writer.saveRegions(regions)
        }
    }

    func finishPendingPersistence() async {
        let pending = persistenceTask
        _ = await pending?.value
    }
}

// MARK: - Helpers

private func formatBytes(_ bytes: Int64) -> String {
    if bytes < 1024 { return "\(bytes) B" }
    let kb = Double(bytes) / 1024
    if kb < 1024 { return String(format: "%.1f KB", kb) }
    let mb = kb / 1024
    if mb < 1024 { return String(format: "%.1f MB", mb) }
    let gb = mb / 1024
    return String(format: "%.2f GB", gb)
}
