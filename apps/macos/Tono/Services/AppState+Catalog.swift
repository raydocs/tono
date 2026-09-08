import SwiftUI
import CryptoKit

extension AppState {
    // MARK: - Managed Catalog

    func acceptManagedExitCatalog(
        _ response: TonoExitCatalogResponse
    ) async throws {
        // No account is bound any more, so nothing fetched for the previous one
        // may land. A sign-out that raced this request is not a rejected update
        // and must not be reported as one.
        guard let owner = ManagedExitCatalogOwnership.currentAccount else { return }
        do {
            try await installManagedExitCatalog(
                ManagedExitCatalogCache(
                    revision: response.revision,
                    yaml: response.yaml,
                    sha256: response.sha256,
                    updatedAt: response.updatedAt,
                    routing: response.routing,
                    owner: owner
                ),
                persistCache: true,
                allowRuntimeTransition: true
            )
        } catch {
            errorMessage = String(localized: "Cloud server update was rejected; the last verified catalog remains active. \(error.localizedDescription)")
            throw error
        }
    }

    func installManagedExitCatalog(
        _ catalog: ManagedExitCatalogCache,
        persistCache: Bool,
        allowRuntimeTransition: Bool
    ) async throws {
        // Exits are issued per account, so a catalog belonging to a different
        // one is refused however current its revision is.
        guard ManagedExitCatalogOwnership.accepts(catalog.owner) else {
            throw TonoAPIClient.APIError.invalidResponse
        }
        let routingToken = Self.catalogRoutingToken(routing: catalog.routing)
        if catalog.revision < managedCatalogRevision {
            // Never accept a control-plane rollback over a newer cached catalog.
            return
        }
        // The revision is fleet-wide while the body is per account: only a
        // matching revision AND digest AND routing token is the catalog already
        // installed. Two of those move independently — a per-account YAML at an
        // unchanged fleet revision, and a routing document that moves neither.
        if Self.catalogIsAlreadyInstalled(
            catalog,
            routingToken: routingToken,
            installedRevision: managedCatalogRevision,
            installedDigest: managedCatalogDigest,
            installedRoutingToken: managedCatalogRoutingToken
        ) {
            return
        }

        let nodes = try await managedCatalogProcessor.validate(
            catalog,
            customNodes: customNodes
        )

        // A slower older validation must never overwrite a newer catalog if
        // callers overlap (for example, manual refresh plus periodic sync), and
        // the signed-in account can change across the same suspension point.
        guard ManagedExitCatalogOwnership.accepts(catalog.owner) else {
            throw TonoAPIClient.APIError.invalidResponse
        }
        if catalog.revision < managedCatalogRevision {
            return
        }
        if Self.catalogIsAlreadyInstalled(
            catalog,
            routingToken: routingToken,
            installedRevision: managedCatalogRevision,
            installedDigest: managedCatalogDigest,
            installedRoutingToken: managedCatalogRoutingToken
        ) {
            return
        }
        if persistCache {
            try await managedCatalogProcessor.persistIfNewest(
                catalog,
                routingToken: routingToken
            )
            // Another catalog can apply while the disk actor is writing, and a
            // sign-out that raced the write leaves its file behind.
            guard ManagedExitCatalogOwnership.accepts(catalog.owner) else {
                ConfigStorage.shared.removeManagedExitCatalog()
                throw TonoAPIClient.APIError.invalidResponse
            }
            if catalog.revision < managedCatalogRevision {
                return
            }
            if Self.catalogIsAlreadyInstalled(
                catalog,
                routingToken: routingToken,
                installedRevision: managedCatalogRevision,
                installedDigest: managedCatalogDigest,
                installedRoutingToken: managedCatalogRoutingToken
            ) {
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
        managedCatalogRoutingToken = routingToken
        managedCatalogRouting = validatedRouting
        refreshTrafficInfrastructureDestinations()
        ManagedExitCatalogOwnership.recordInstalled(
            owner: catalog.owner,
            discard: { [weak self] in
                guard let self else { return }
                self.discardManagedExitCatalogState()
            }
        )

        if selectedCloudNodeWasRemoved {
            if liveSessionTornDown {
                // A removal that took a session down is a real classified
                // outcome, so the copyable diagnostic names it instead of
                // reporting no classification at all for the teardown the user
                // just saw. A removal on an idle Mac ended no session, and
                // recording one there would leave every later report and every
                // unrelated failure attributed to it.
                lastClassifiedFailure = ProtectedConnectivity.failure(
                    .catalogNodeRemoved,
                    stage: "catalogInstall",
                    attempt: 1,
                    generation: connectionCoordinator.protectionOperationGeneration,
                    detail: "selected catalog exit absent at revision \(catalog.revision)"
                )
            }
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
            applyManagedCatalogToRuntime()
        } else if isConnecting {
            managedCatalogReloadPending = true
        }
    }

    /// Freshness of the sibling routing document — the home proxy, the default
    /// proxy, and the credential-bearing home SOCKS5.
    ///
    /// Derived from the served document rather than read out of the response,
    /// so a control plane that publishes no digest of its own is covered by the
    /// same comparison. The recipe is the one the control plane uses for
    /// `routingSha256` — the three directives joined by newlines, SHA-256,
    /// unpadded base64url, with an absent document hashed as empty material —
    /// so the served value can replace this one verbatim without any token
    /// moving. A routing-only rotation moves neither the fleet revision nor the
    /// proxies digest, and that is the change that leaves a client dialing
    /// retired credentials. The credential is hashed, never stored or logged in
    /// the clear.
    private static func catalogRoutingToken(
        routing: TonoExitCatalogRouting?
    ) -> String {
        var homeSocks5 = ""
        if let socks5 = routing?.homeSocks5 {
            homeSocks5 = [
                socks5.host,
                String(socks5.port),
                socks5.username,
                socks5.password,
            ].joined(separator: "\n")
        }
        let material = [
            routing?.homeProxy ?? "",
            routing?.defaultProxy ?? "",
            homeSocks5,
        ].joined(separator: "\n")
        let digest = Data(SHA256.hash(data: Data(material.utf8)))
            .base64EncodedString()
        return digest
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
    }

    /// True only when every part of the freshness key matches what is already
    /// installed. A matching revision with a different digest or routing token
    /// is what a per-account payload looks like, not a protocol violation.
    private static func catalogIsAlreadyInstalled(
        _ catalog: ManagedExitCatalogCache,
        routingToken: String,
        installedRevision: Int,
        installedDigest: String?,
        installedRoutingToken: String?
    ) -> Bool {
        catalog.revision == installedRevision
            && installedDigest == catalog.sha256
            && installedRoutingToken == routingToken
    }

    /// Applying a catalog rewrites the whole runtime config, and the full
    /// reload that follows closes every connection in the session. A fleet-wide
    /// node add or removal changes those bytes for every connected customer at
    /// once, so the apply waits for streaming responses to finish — bounded the
    /// same way the pin refresh is bounded, because a catalog that is deferred
    /// forever is its own outage.
    func applyManagedCatalogToRuntime() {
        guard isConnected else { return }
        if hasInFlightProxiedStream,
           catalogApplyDeferralCount < Self.catalogApplyMaximumDeferrals {
            catalogApplyDeferralCount += 1
            managedCatalogReloadPending = true
            LocalTrafficAudit.shared.recordEvent(
                "managed_catalog_apply_deferred",
                details: [
                    "reason": "in_flight_proxied_stream",
                    "deferral": String(catalogApplyDeferralCount),
                    "limit": String(Self.catalogApplyMaximumDeferrals),
                ]
            )
            return
        }
        if catalogApplyDeferralCount > 0 {
            LocalTrafficAudit.shared.recordEvent(
                "managed_catalog_apply_forced",
                details: ["deferrals": String(catalogApplyDeferralCount)]
            )
        }
        catalogApplyDeferralCount = 0
        managedCatalogReloadPending = false
        reloadCoreConfig()
    }

    /// Drops every managed exit and the revision/digest that gate a newer one.
    /// Called by ownership when the account changes, so no exit — and no gate
    /// that would reject the next account's own catalog — outlives the session
    /// it was issued for. Custom nodes are the user's own and are kept.
    private func discardManagedExitCatalogState() {
        proxyRegions.removeAll { $0.id != "custom" }
        managedCatalogRevision = -1
        managedCatalogDigest = nil
        managedCatalogRoutingToken = nil
        managedCatalogRouting = nil
        refreshTrafficInfrastructureDestinations()
        saveProxyRegionsOnly()
        let processor = managedCatalogProcessor
        Task { await processor.reset() }
    }

    private func refreshTrafficInfrastructureDestinations() {
        var hosts: Set<String> = []
        let residentialHop = managedCatalogRouting?.homeSocks5?.host
        if let host = residentialHop {
            let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                hosts.insert(trimmed)
            }
        }
        appTrafficLedger.setInfrastructureDestinations(hosts)
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
            errorMessage = String(
                localized: "Cloud app-routing update was rejected; all traffic remains protected by the current route."
            )
            throw error
        }
    }

    func installManagedTrafficPolicy(
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
        errorMessage = String(
            localized: "Secure app routing was updated; Tono is applying it without opening direct Internet."
        )
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

    func initialDirectPolicy(
        physicalInterface: String,
        policy: TonoTrafficPolicy
    ) throws -> ConfigPipeline.ManagedDirectRuntimePolicy? {
        guard !policy.domains.isEmpty || !policy.mediaEndpoints.isEmpty
                || !policy.tcpEndpoints.isEmpty
                || !policy.webDomains.isEmpty
                || !policy.directSuffixes.isEmpty else {
            return nil
        }
        // `mediaEndpoints` and `tcpEndpoints` are deliberately not carried into
        // the runtime policy below, so the conversions that used to build them
        // are gone rather than computed and dropped — the only two warnings in
        // the build, and the shape that hides a field being silently ignored.
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
            // Native-app pins and media endpoints are reviewed-bundle-only
            // inputs. They are not copied into the Mac runtime because the
            // bundle-wide process rule already handles the app's rotating
            // HTTPDNS/raw-IP traffic; web pins/suffixes remain separate.
            mediaEndpoints: [],
            tcpEndpoints: [],
            directResolverHosts: (policy.domains + policy.webDomains)
                .map(\.host),
            trusted: policy.trusted,
            nativeAppDirect: !policy.domains.isEmpty
                || !policy.mediaEndpoints.isEmpty
                || !policy.tcpEndpoints.isEmpty
        )
        return try ConfigPipeline.validatedManagedDirectPolicy(
            runtime,
            excluding: managedDirectProtectedAddresses()
        )
    }

    func armSwitchKillSwitch(
        proxyEndpoints: [ConfigPipeline.DialEndpoint]
    ) async throws {
        try await PrivilegedRuntimeCoordinator.shared.armKillSwitch(
            tunnelInterfaces: [ConfigPipeline.tonoTunInterface],
            proxyEndpoints: proxyEndpoints,
            sessionDirectEndpoints: activeDirectPolicy?.sessionEndpoints ?? [],
            tailscaleBootstrapEnabled: AppProfile.homeExitEnabled && tonoTransport != nil,
            reviewedBundleDirect:
                activeDirectPolicy?.requiresAddressFreeDirectPermit == true
        )
    }

    /// Close leftover sockets still pinned to the previous exit. Do not
    /// `closeAllConnections`: that severs WeChat/Claude flows that already
    /// moved, and is not a silent switch.
    func closeConnectionsBoundToExit(
        _ exitName: String?,
        using api: CoreControllerClient
    ) async {
        guard let exitName, !exitName.isEmpty else { return }
        let tracked = (try? await api.getConnections())?.connections ?? []
        for connection in tracked where connection.isBoundToExit(exitName) {
            try? await api.closeConnection(id: connection.id)
        }
    }

    /// PF proxy permits for the currently selected exit, matching what the
    /// connect and reload transactions arm.
    func currentProxyEndpoints() -> [ConfigPipeline.DialEndpoint] {
        let selected = selectedExitNode()
        return ((try? ConfigPipeline.dialEndpoints(for: selected)) ?? [])
            + claudeHomeDialEndpoints(excluding: selected)
    }

    /// Claude's home route is a second exact proxy endpoint, so it must be
    /// admitted to PF whenever the selected exit is armed. Do not duplicate a
    /// selected node: the helper's endpoint set is intentionally unique.
    func claudeHomeDialEndpoints(
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

    func recordLongLivedRouteActivity(_ connections: [APIConnection]) {
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

    func refreshManagedDirectPins() async {
        guard isConnected, isOwnedTonoMode,
              switchingNodeId == nil,
              connectionCoordinator.configReloadTask == nil,
              let api = coreController,
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
              switchingNodeId == nil, connectionCoordinator.configReloadTask == nil,
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
            trusted: current.trusted,
            nativeAppDirect: current.nativeAppDirect
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
    private func awaitResolverReadiness(probeHost: String?, api: CoreControllerClient) async {
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

    func resolveManagedDirectDomains(
        policy: TonoTrafficPolicy,
        base: ConfigPipeline.ManagedDirectRuntimePolicy?,
        api: CoreControllerClient
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
        let resolverHosts = base?.directResolverHosts
            ?? (policy.domains + policy.webDomains).map(\.host)
        // Everything this session will permit that is not a web pin, counted by
        // the same computed property the validator counts, so the budget below
        // cannot drift from the ceiling it exists to keep us under.
        let withoutWebPins = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: physicalInterface,
            domainPins: [],
            webDomainPins: [],
            webDomainSuffixes: base?.webDomainSuffixes ?? [],
            mediaEndpoints: [],
            tcpEndpoints: [],
            directResolverHosts: resolverHosts,
            trusted: policy.trusted,
            nativeAppDirect: base?.nativeAppDirect ?? (
                !policy.domains.isEmpty
                    || !policy.mediaEndpoints.isEmpty
                    || !policy.tcpEndpoints.isEmpty
            )
        )
        // Trim to the ceiling rather than walk into it. Over the limit,
        // `validatedManagedDirectPolicy` throws, the catch below returns nil,
        // and the session runs with no web pins whatsoever — losing every
        // reviewed host to keep the ones that did not fit. The control plane
        // can reach that on its own: 32 `webDomains` is its published maximum
        // and resolves to as many as 258 session endpoints.
        let budgeted = ConfigPipeline.pinsWithinSessionEndpointBudget(
            webPins,
            seededBy: withoutWebPins.sessionEndpoints
        )
        if !budgeted.dropped.isEmpty {
            // Named, because the alternative reading of a short pin list is
            // "those hosts failed to resolve", which is a different fault with
            // a different fix, and `managed_direct_domains_unresolved` below
            // would otherwise report it as exactly that.
            LocalTrafficAudit.shared.recordEvent(
                "managed_direct_pins_over_budget",
                details: [
                    "limit": String(ConfigPipeline.maximumSessionDirectEndpoints),
                    "kept": String(budgeted.kept.count),
                    "dropped": String(budgeted.dropped.count),
                    "dropped_hosts": budgeted.dropped
                        .prefix(8)
                        .joined(separator: ","),
                ]
            )
        }
        let runtime = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: physicalInterface,
            domainPins: [],
            webDomainPins: budgeted.kept,
            webDomainSuffixes: base?.webDomainSuffixes ?? [],
            mediaEndpoints: [],
            tcpEndpoints: [],
            directResolverHosts: resolverHosts,
            trusted: policy.trusted,
            nativeAppDirect: base?.nativeAppDirect ?? (
                !policy.domains.isEmpty
                    || !policy.mediaEndpoints.isEmpty
                    || !policy.tcpEndpoints.isEmpty
            )
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
        api: CoreControllerClient
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
    var activeProxyPort: Int? {
        if isConnected { return config.mixedPort }
        if let tono = tonoTransport { return Int(tono.port) }
        return nil
    }

}
