import SwiftUI

extension AppState {
    // MARK: - Managed exit catalog

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
    func assignUnattributedSubscriptionRuntime(to subscriptionId: String) -> Bool {
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

}
