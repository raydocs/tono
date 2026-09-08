import SwiftUI

extension AppState {
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
        trafficFeedLive = true
        connectionsFeedLive = true
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

    func saveProxyRegionsOnly() {
        let regions = proxyRegions
        let previous = persistenceTask
        let writer = persistenceWriter
        persistenceTask = Task {
            _ = await previous?.value
            await writer.saveRegions(regions)
        }
    }

    func finishPendingPersistence() async {
        // Termination is the one end of a session with no telemetry window
        // after it. The ring is in memory only, so a user who quits after a
        // failed connect would take exactly those events with them; fold them
        // into the audit, which does outlive the process.
        drainConnectionTelemetryToAudit()
        let pending = persistenceTask
        _ = await pending?.value
    }

    /// Moves the redacted telemetry ring into the local audit. The events carry
    /// no host, address, token or payload, so this adds nothing to the audit
    /// that the audit does not already record.
    private func drainConnectionTelemetryToAudit() {
        // The audit is the only thing that outlives the process here, and it
        // drops every event while the local traffic log is switched off. Empty
        // the ring only into a sink that keeps what it is handed.
        guard LocalTrafficAudit.isEnabled else { return }
        let drained = ConnectionTelemetryBuffer.shared.drain()
        for event in drained.events {
            var details = ["kind": event.kind]
            if let stage = event.stage { details["stage"] = stage }
            if let code = event.code { details["code"] = code }
            if let reason = event.reason { details["reason"] = reason }
            if let node = event.node { details["node"] = node }
            if let elapsedMs = event.elapsedMs {
                details["elapsed_ms"] = String(elapsedMs)
            }
            if let counter = event.counter { details["counter"] = String(counter) }
            if let generation = event.generation {
                details["generation"] = String(generation)
            }
            if let error = event.error { details["error"] = error }
            LocalTrafficAudit.shared.recordEvent(
                "telemetry_event_retained",
                details: details
            )
        }
        if drained.dropped > 0 {
            LocalTrafficAudit.shared.recordEvent(
                "telemetry_events_dropped",
                details: ["count": String(drained.dropped)]
            )
        }
    }
}
