import SwiftUI
import Observation
import Security
import CryptoKit
import Darwin

nonisolated final class CancellableProcessBox: @unchecked Sendable {
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

nonisolated enum PhysicalBypassSocketResult: Sendable {
    case blocked
    case reachable
    case inconclusive
}

actor ProviderRuleLoader {
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

nonisolated struct InitialDiskSnapshot: Sendable {
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

    var localizedTitle: String {
        String(localized: String.LocalizationValue(rawValue))
    }
}

enum DisconnectionStage: String {
    case finishingOperation = "Finishing the current operation…"
    case stoppingTunnel = "Stopping the protected tunnel…"
    case preservingProtection = "Keeping direct traffic blocked…"
    case restoringDNS = "Restoring system DNS…"
    case restoringNetwork = "Restoring network access…"

    var localizedTitle: String {
        String(localized: String.LocalizationValue(rawValue))
    }
}

struct ConnectionFailure: Equatable {
    let stage: ConnectionStage
    let message: String
    let occurredAt: Date
}

actor InitialDataLoader {
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

actor ManagedCatalogProcessor {
    private var persistedRevision = -1
    private var persistedDigest: String?
    private var persistedRoutingToken: String?

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
    func persistIfNewest(
        _ catalog: ManagedExitCatalogCache,
        routingToken: String
    ) throws {
        if catalog.revision < persistedRevision {
            return
        }
        // The revision is fleet-wide while the body is issued per account, so a
        // matching revision carrying a different digest is the next account's
        // own payload, not a conflicting copy of this one. The routing document
        // is per account too and moves no revision at all, so it carries its
        // own freshness token into the same comparison.
        if catalog.revision == persistedRevision,
           persistedDigest == catalog.sha256,
           persistedRoutingToken == routingToken {
            return
        }
        try ConfigStorage.shared.saveManagedExitCatalog(catalog)
        persistedRevision = catalog.revision
        persistedDigest = catalog.sha256
        persistedRoutingToken = routingToken
    }

    /// Releases the write gate when the cache it describes has been discarded,
    /// so the next account's catalog is not compared against a revision and
    /// digest that no longer exist on disk.
    func reset() {
        persistedRevision = -1
        persistedDigest = nil
        persistedRoutingToken = nil
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

actor ManagedTrafficPolicyProcessor {
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
            guard let address = try? ConfigPipeline.validatedManagedDirectAddress(
                    entry.address,
                    field: "managed media address",
                    trusted: trusted
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
            guard let address = try? ConfigPipeline.validatedManagedDirectAddress(
                    entry.address,
                    field: "managed TCP address",
                    trusted: trusted
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

actor AppStatePersistenceWriter {
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
