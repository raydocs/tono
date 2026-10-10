import SwiftUI

enum SeaServerPresentation {
    static func favorites(in nodes: [ProxyNode], names: Set<String>) -> [ProxyNode] {
        nodes.filter { names.contains(ProxyNode.catalogBaseName(for: $0.name)) }
    }
}

extension ProxiesView {
    var seaFavoriteNames: Set<String> {
        guard let owner = accountSession.user?.id,
              owner == ManagedExitCatalogOwnership.currentAccount else { return [] }
        return Set(appState.routePreferences.favorites(owner: owner, catalog: appState.managedCatalogNodes))
    }

    var seaNodeToolbar: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(SeaTheme.muted).accessibilityHidden(true)
                TextField("Search servers", text: $searchText)
                    .textFieldStyle(.plain).focused($isSearchFocused)
                if !searchText.isEmpty {
                    Button { searchText = "" } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain).accessibilityLabel("Clear search")
                }
            }
            .modifier(SeaFieldSurface(focused: isSearchFocused))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    regionFilterChip(nil)
                    ForEach(regionOptions, id: \.self) { regionFilterChip($0) }
                    Divider().frame(height: 16)
                    Button { seaFavoritesOnly.toggle() } label: {
                        Label("Favorites", systemImage: seaFavoritesOnly ? "star.fill" : "star")
                            .font(.system(size: 12, weight: .medium)).padding(.horizontal, 12).padding(.vertical, 7)
                            .background(seaFavoritesOnly ? seaAccent.opacity(0.14) : .clear, in: Capsule())
                    }
                    .buttonStyle(.plain).foregroundStyle(seaAccent)
                    .accessibilityAddTraits(seaFavoritesOnly ? [.isSelected] : [])
                }
            }
        }
    }

    var seaNodesSection: some View {
        let nodes = filteredNodes(from: cloudNodes)
        let favorites = SeaServerPresentation.favorites(in: nodes, names: seaFavoriteNames)
        return VStack(alignment: .leading, spacing: 16) {
            if !favorites.isEmpty {
                seaServerGroup("Favorites", nodes: favorites)
            }
            if !seaFavoritesOnly {
                seaServerGroup("Cloud Servers", nodes: nodes)
            }
            if nodes.isEmpty || (seaFavoritesOnly && favorites.isEmpty) {
                ContentUnavailableView(
                    seaFavoritesOnly ? "No favorite servers" : (cloudNodes.isEmpty ? "No Cloud Servers" : "No Matching Servers"),
                    systemImage: seaFavoritesOnly ? "star" : "magnifyingglass",
                    description: Text(cloudNodes.isEmpty
                        ? "Sign in and wait for the protected server catalog to synchronize."
                        : "Try a different search or region filter.")
                )
                .frame(maxWidth: .infinity, minHeight: 180)
            }
        }
    }

    private func seaServerGroup(_ title: String, nodes: [ProxyNode]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(LocalizedStringKey(title)).font(.system(size: 13))
                Text("\(nodes.count)").monospacedDigit()
            }
            .foregroundStyle(SeaTheme.muted).accessibilityAddTraits(.isHeader)
            LazyVStack(spacing: 4) {
                ForEach(nodes) { seaServerRow($0) }
            }
        }
    }

    private func seaServerRow(_ node: ProxyNode) -> some View {
        let selected = appState.selectedNodeId == node.id || appState.selectedNodeId == node.name
        let switching = appState.switchingNodeId == node.id || appState.switchingNodeId == node.name
        let runtime = appState.proxyService.node(named: node.name)
        let recent: LocalRoutePreferences.Success? = accountSession.user.flatMap { user in
            guard user.id == ManagedExitCatalogOwnership.currentAccount else { return nil }
            return appState.routePreferences.recentSuccesses(owner: user.id, catalog: appState.managedCatalogNodes)
                .first(where: { $0.name == node.name })
        }
        let disabled = appState.isConnecting || appState.isDisconnecting
            || (appState.switchingNodeId != nil && !switching)
        return HStack(spacing: 10) {
            if let owner = accountSession.user?.id, owner == ManagedExitCatalogOwnership.currentAccount {
                let favorite = seaFavoriteNames.contains(ProxyNode.catalogBaseName(for: node.name))
                Button { appState.toggleRouteFavorite(node.name, owner: owner) } label: {
                    Image(systemName: favorite ? "star.fill" : "star")
                        .foregroundStyle(favorite ? SeaTheme.warm : SeaTheme.muted)
                        .frame(width: 28, height: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(favorite ? "Remove favorite" : "Favorite")
                .accessibilityIdentifier("routeFavorite-\(ProxyNode.catalogBaseName(for: node.name))")
            }
            Button {
                withAnimation(TonoMotion.easeOut(0.35, reduceMotion: reduceMotion)) {
                    appState.selectNode(node.name)
                }
            } label: {
                HStack(spacing: 12) {
                    Text(node.flag).font(.system(size: 20)).frame(width: 30).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(nodeRouteTitle(node)).font(.system(size: 15)).lineLimit(1)
                        HStack(spacing: 6) {
                            Text(nodeListRegionLabel(nodeListRegionCode(flag: node.flag, name: node.name)))
                            Text(node.protocolType.uppercased())
                            if let recent {
                                Text("Last successful connection")
                                Text(recent.at, format: .dateTime.hour().minute())
                            }
                        }
                        .font(.system(size: 12)).monospacedDigit().foregroundStyle(SeaTheme.muted).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    if switching {
                        ProgressView().controlSize(.small)
                    } else {
                        if selected { SeaTag(title: "Selected") }
                        NodeLatencyBadge(latency: runtime?.latency ?? 0, didFail: runtime?.lastTestFailed == true)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain).disabled(disabled)
            .accessibilityLabel(localNodeAccessibilitySummary(node: node, isActive: selected,
                isSwitching: switching, latency: runtime?.latency ?? 0, didFail: runtime?.lastTestFailed == true))
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
        .background(selected ? seaAccent.opacity(0.10) : .white.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(selected ? 0.16 : 0.04), lineWidth: 1) }
    }
}
