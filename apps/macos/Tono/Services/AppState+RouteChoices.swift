import Foundation

extension AppState {
    func routeRecommendation(owner: String, now: Date = Date()) -> RouteRecommendation? {
        guard owner == ManagedExitCatalogOwnership.currentAccount,
              !isConnected, !isConnecting, !isDisconnecting, switchingNodeId == nil,
              connectionCoordinator.configReloadTask == nil,
              let digest = managedCatalogDigest else { return nil }
        let available = managedCatalogNodes.filter {
            ConfigPipeline.singBoxUnavailableReason($0) == nil && !ProxyNode.hy2UdpIsVendorBlocked($0.name)
        }
        let favorites = routePreferences.favorites(owner: owner, catalog: available)
        let proven = routePreferences.recentSuccesses(owner: owner, catalog: available, now: now)
            .filter { $0.catalogDigest == digest }
        // Favorite is a preference, not a health result. It only wins among
        // recent verified successes in this exact account catalog.
        let recent = proven.first { favorites.contains(ProxyNode.catalogBaseName(for: $0.name)) } ?? proven.first
        let fallback = available.first { $0.name == managedCatalogRouting?.defaultProxy }
            ?? available.first { $0.name == currentProxySelectionTarget() }
            ?? available.first
        guard let name = recent?.name ?? fallback?.name else { return nil }
        return RouteRecommendation(owner: owner, generation: connectionCoordinator.protectionOperationGeneration,
                                   catalogDigest: digest, name: name, successfulAt: recent?.at)
    }

    /// Revalidate immediately before the existing selection/connect owner runs.
    /// A confirmation left open while a healthy connection starts cannot switch it.
    @discardableResult
    func confirmRouteRecommendation(_ proposal: RouteRecommendation, now: Date = Date()) -> Bool {
        guard !isConnected, !isConnecting, !isDisconnecting, switchingNodeId == nil,
              proposal.owner == ManagedExitCatalogOwnership.currentAccount,
              proposal.generation == connectionCoordinator.protectionOperationGeneration,
              proposal.catalogDigest == managedCatalogDigest,
              let current = routeRecommendation(owner: proposal.owner, now: now),
              current.name == proposal.name, current.successfulAt == proposal.successfulAt else { return false }
        selectNode(proposal.name)
        return true
    }

    func toggleRouteFavorite(_ name: String, owner: String) {
        guard owner == ManagedExitCatalogOwnership.currentAccount else { return }
        routePreferences.toggleFavorite(name, owner: owner, catalog: managedCatalogNodes)
    }

    /// Call only after data-plane verification and final protection convergence,
    /// never from selection/persistence or a failed switch's recovery intent.
    func recordVerifiedRouteSuccess(_ name: String, owner: String?, generation: UInt64, now: Date = Date()) {
        guard let owner, owner == ManagedExitCatalogOwnership.currentAccount,
              generation == connectionCoordinator.protectionOperationGeneration,
              isConnected, !isDisconnecting, !isProxyDegraded,
              currentProxySelectionTarget() == name,
              let digest = managedCatalogDigest else { return }
        routePreferences.recordSuccess(name, owner: owner, catalog: managedCatalogNodes, digest: digest, now: now)
    }

    /// A newer failed attempt retires that route's successful evidence; do not
    /// guess the failed route from a selection that may already have changed.
    func retireFailedRouteSuccess(_ name: String, owner: String?, generation: UInt64) {
        guard let owner, owner == ManagedExitCatalogOwnership.currentAccount,
              generation == connectionCoordinator.protectionOperationGeneration else { return }
        routePreferences.retireSuccess(name, owner: owner)
    }
}
