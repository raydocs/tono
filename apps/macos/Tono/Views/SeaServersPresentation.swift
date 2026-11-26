import SwiftUI

enum SeaServerPresentation {
    static let otherRegionsCode = "GL"

    static func favorites(in nodes: [ProxyNode], names: Set<String>) -> [ProxyNode] {
        nodes.filter { names.contains(ProxyNode.catalogBaseName(for: $0.name)) }
    }

    /// Country evidence only; guessed initials collapse into "Other regions"
    /// (Windows `node-meta.ts`), so a tab never reads as two stray letters.
    static func regionCode(flag: String, name: String) -> String {
        if ProxyNode.isHy2CatalogName(name) { return udpBackupRegionCode }
        return catalogNodeRegionCode(flag: flag, name: name) ?? otherRegionsCode
    }

    static func regionLabel(_ code: String) -> String {
        if code == udpBackupRegionCode { return String(localized: "Backup UDP") }
        if code == otherRegionsCode { return String(localized: "Other regions") }
        let language = Bundle.main.preferredLocalizations.first ?? "en"
        return Locale(identifier: language).localizedString(forRegionCode: code) ?? code
    }

    /// Countries by name, then the backup channel, then "Other regions" last.
    static func sortedRegions(_ codes: [String]) -> [String] {
        func rank(_ code: String) -> Int {
            code == otherRegionsCode ? 2 : code == udpBackupRegionCode ? 1 : 0
        }
        return codes.sorted { a, b in
            rank(a) != rank(b)
                ? rank(a) < rank(b)
                : regionLabel(a).localizedStandardCompare(regionLabel(b)) == .orderedAscending
        }
    }
}

/// Three bars for the exit latency band; none lit when untested.
struct SeaSignalBars: View {
    let latency: Int
    var didFail = false

    private var lit: Int {
        guard !didFail, latency > 0 else { return 0 }
        switch LatencyLevel.level(for: latency, kind: .exit) {
        case .low: return 3
        case .mid: return 2
        case .high: return 1
        }
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            if lit == 0 {
                // Not measured yet: one hollow ring, so "untested" never reads as "weak".
                Circle()
                    .strokeBorder(
                        didFail ? SeaTheme.danger.opacity(0.82) : SeaTheme.text.opacity(0.32),
                        lineWidth: didFail ? 1.25 : 1
                    )
                    .frame(width: 7, height: 7)
            } else {
                ForEach(0..<3, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(index < lit ? AnyShapeStyle(SeaTheme.primaryGradient)
                                          : AnyShapeStyle(SeaTheme.text.opacity(0.22)))
                        .frame(width: 3, height: CGFloat(5 + index * 3))
                }
            }
        }
        .frame(height: 11)
        .accessibilityHidden(true)
    }
}

extension ProxiesView {
    var seaFavoriteNames: Set<String> {
        guard let owner = accountSession.user?.id,
              owner == ManagedExitCatalogOwnership.currentAccount else { return [] }
        return Set(appState.routePreferences.favorites(owner: owner, catalog: appState.managedCatalogNodes))
    }

    var seaHeaderRow: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("Servers")
                .font(.system(size: 28, weight: .medium)).tracking(-0.5)
                .foregroundStyle(SeaTheme.text).accessibilityAddTraits(.isHeader)
                .lineLimit(1)
            Spacer(minLength: 12)
            if AppProfile.isDev {
                GradientAddButton("Add Node") {
                    withAnimation(.easeOut(duration: 0.25)) { showingAddNode = true }
                }
            }
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(isSearchFocused ? SeaTheme.attention : SeaTheme.muted)
                    .accessibilityHidden(true)
                TextField("Search servers", text: $searchText)
                    .textFieldStyle(.plain).focused($isSearchFocused)
                if !searchText.isEmpty {
                    SeaSearchClearButton(reduceMotion: reduceMotion) { searchText = "" }
                        .accessibilityLabel("Clear search")
                }
            }
            .modifier(SeaFieldSurface(focused: isSearchFocused, minHeight: 40))
            .frame(width: 260)
            if appState.isConnected {
                // Measures the selected exit only, never a list-wide sweep.
                Button { testCurrentExit() } label: {
                    HStack(spacing: 6) {
                        if isTesting { ProgressView().controlSize(.mini) }
                        Text("Test current")
                    }
                }
                .buttonStyle(SeaButtonStyle(variant: .quiet))
                .fixedSize()
                .disabled(isTesting || appState.isConnecting || appState.isDisconnecting
                    || appState.switchingNodeId != nil)
                .accessibilityLabel("Test current exit")
            }
        }
    }

    /// Text tabs: All, regions by name, Favorites.
    var seaNodeToolbar: some View {
        let all = "All", favorites = "Favorites"
        let labels = Dictionary(uniqueKeysWithValues: regionOptions.map { ($0, SeaServerPresentation.regionLabel($0)) })
        let selection = Binding<String>(
            get: {
                if seaFavoritesOnly { return favorites }
                return regionFilter.flatMap { labels[$0] } ?? all
            },
            set: { value in
                withAnimation(TonoMotion.stateChange(reduceMotion: reduceMotion)) {
                    seaFavoritesOnly = value == favorites
                    regionFilter = labels.first(where: { $0.value == value })?.key
                }
            }
        )
        return ScrollView(.horizontal, showsIndicators: false) {
            SeaTabs(label: "Server filter", selection: selection,
                    options: [all] + regionOptions.compactMap { labels[$0] } + [favorites])
        }
    }

    var seaNodesSection: some View {
        let nodes = filteredNodes(from: cloudNodes)
        let favorites = SeaServerPresentation.favorites(in: nodes, names: seaFavoriteNames)
        let listTitle = regionFilter.map(SeaServerPresentation.regionLabel) ?? String(localized: "All servers")
        return VStack(alignment: .leading, spacing: 20) {
            if !favorites.isEmpty {
                seaServerGroup(String(localized: "Favorites"), nodes: favorites)
            }
            if !seaFavoritesOnly, !nodes.isEmpty {
                seaServerGroup(listTitle, nodes: nodes)
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
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: "\(title) · \(nodes.count)")
                .font(.system(size: 12, weight: .semibold)).tracking(0.3).monospacedDigit()
                .foregroundStyle(SeaTheme.tertiary).accessibilityAddTraits(.isHeader)
                .padding(.bottom, 6)
            LazyVStack(spacing: 2) {
                ForEach(nodes) { seaServerRow($0) }
            }
        }
    }

    private func seaServerRow(_ node: ProxyNode) -> some View {
        let selected = appState.selectedNodeId == node.id || appState.selectedNodeId == node.name
        let switching = appState.switchingNodeId == node.id || appState.switchingNodeId == node.name
        let runtime = appState.proxyService.node(named: node.name)
        let latency = runtime?.latency ?? 0
        let didFail = runtime?.lastTestFailed == true
        let disabled = appState.isConnecting || appState.isDisconnecting
            || (appState.switchingNodeId != nil && !switching)
        return HStack(spacing: 6) {
            if let owner = accountSession.user?.id, owner == ManagedExitCatalogOwnership.currentAccount {
                let favorite = seaFavoriteNames.contains(ProxyNode.catalogBaseName(for: node.name))
                SeaFavoriteButton(favorite: favorite, reduceMotion: reduceMotion) {
                    appState.toggleRouteFavorite(node.name, owner: owner)
                }
                .accessibilityLabel(favorite ? "Remove favorite" : "Favorite")
                .accessibilityIdentifier("routeFavorite-\(ProxyNode.catalogBaseName(for: node.name))")
            }
            Button {
                withAnimation(TonoMotion.easeOut(0.35, reduceMotion: reduceMotion)) {
                    appState.selectNode(node.name)
                }
            } label: {
                HStack(spacing: 10) {
                    NodeRouteMark(size: 30, city: nodeCityParts(node.displayName).city,
                                  gradient: SeaTheme.primaryGradient, warmTile: true)
                    Text(nodeRouteTitle(node))
                        .font(.system(size: 15, weight: selected || switching ? .medium : .regular))
                        .foregroundStyle(SeaTheme.text).lineLimit(1)
                    if selected && !switching {
                        SeaTag(title: "ACTIVE", kind: .good)
                    }
                    Spacer(minLength: 8)
                    if switching {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.mini)
                            Text("Switching server…")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(SeaTheme.cool)
                        }
                    } else {
                        SeaSignalBars(latency: latency, didFail: didFail)
                        Group {
                            if didFail {
                                Text("Timeout")
                            } else if latency > 0 {
                                Text(LatencyLevel.spokenTitle(for: latency, kind: .exit))
                                    .contentTransition(reduceMotion ? .identity : .numericText())
                            } else {
                                Text("Not tested")
                            }
                        }
                        .font(.system(size: 13)).monospacedDigit()
                        .foregroundStyle(didFail ? SeaTheme.danger : (latency > 0 ? SeaTheme.muted : SeaTheme.tertiary))
                        .animation(TonoMotion.numeric(reduceMotion: reduceMotion), value: latency)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(SeaServerRowButtonStyle(reduceMotion: reduceMotion)).disabled(disabled)
            .accessibilityLabel(localNodeAccessibilitySummary(node: node, isActive: selected,
                isSwitching: switching, latency: latency, didFail: didFail))
        }
        .padding(.leading, 4).padding(.trailing, 14)
        .modifier(SeaWarmRowSurface(selected: selected, switching: switching, reduceMotion: reduceMotion))
        .overlay(alignment: .bottom) {
            Rectangle().fill(.white.opacity(0.06)).frame(height: 0.75)
                .padding(.leading, 44).padding(.trailing, 14)
        }
        .animation(TonoMotion.stateChange(reduceMotion: reduceMotion), value: selected)
        .animation(TonoMotion.stateChange(reduceMotion: reduceMotion), value: switching)
    }

    /// One tertiary line with a text Refresh; refresh and policy failures keep
    /// their own rows so the reason stays readable.
    var seaCatalogFooter: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(.white.opacity(0.07)).frame(height: 0.75).padding(.bottom, 4)
            HStack(spacing: 10) {
                Group {
                    if accountSession.catalogFailureMessage != nil {
                        Text(verbatim: "\(catalogStatusTitle) · \(catalogStatusDetail)")
                            .foregroundStyle(SeaTheme.attention)
                    } else {
                        Text(verbatim: catalogStatusDetail).foregroundStyle(SeaTheme.tertiary)
                    }
                }
                .font(.system(size: 12)).monospacedDigit().lineLimit(1)
                if let catalogFeedback {
                    Text(verbatim: catalogFeedback)
                        .font(.system(size: 12)).monospacedDigit()
                        .foregroundStyle(catalogRefreshSucceeded ? SeaTheme.good : SeaTheme.attention)
                        .lineLimit(1)
                        .transition(.opacity)
                }
                Spacer(minLength: 8)
                Button(isRefreshingCatalog ? "Refreshing…" : "Refresh") { refreshCatalog() }
                    .buttonStyle(SeaButtonStyle(variant: .text, size: .row))
                    .font(.system(size: 13))
                    .disabled(isRefreshingCatalog || accountSession.state != .ready)
            }
            if let reason = accountSession.catalogFailureMessage {
                catalogIssueRow(label: String(localized: "Server catalog refresh failed"), reason: reason)
            }
            if let reason = accountSession.trafficPolicyFailureMessage {
                catalogIssueRow(label: String(localized: "Traffic policy refresh failed"), reason: reason)
            }
        }
    }
}

private struct SeaSearchClearButton: View {
    let reduceMotion: Bool
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(hovered ? SeaTheme.text : SeaTheme.muted)
                .frame(width: 22, height: 22)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .animation(TonoMotion.hover(reduceMotion: reduceMotion), value: hovered)
    }
}

private struct SeaFavoriteButton: View {
    let favorite: Bool
    let reduceMotion: Bool
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: favorite ? "star.fill" : "star")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(favorite ? SeaTheme.warm : (hovered ? SeaTheme.text : SeaTheme.subtle))
                .scaleEffect(!reduceMotion && hovered ? 1.08 : 1)
                .frame(width: 32, height: 44)
                .background(.white.opacity(hovered ? 0.06 : 0), in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .animation(TonoMotion.hover(reduceMotion: reduceMotion), value: hovered)
    }
}

private struct SeaServerRowButtonStyle: ButtonStyle {
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.992 : 1)
            .animation(TonoMotion.press(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// Hover and selection on a sea list row: a warm wash with a sunrise edge on
/// the selected row, matching the Windows rows.
struct SeaWarmRowSurface: ViewModifier {
    let selected: Bool
    var switching: Bool = false
    let reduceMotion: Bool
    @SeaDisplayPreferences private var display
    @State private var hovered = false

    static func washOpacity(selected: Bool, hovered: Bool) -> Double {
        selected ? 0.09 : (hovered ? 0.06 : 0)
    }

    private var backgroundStyle: AnyShapeStyle {
        if display.reduceTransparency {
            if switching { return AnyShapeStyle(Color(hex: "202331")) }
            if selected { return AnyShapeStyle(Color(hex: "29211D")) }
            if hovered { return AnyShapeStyle(Color(hex: "211E25")) }
            return AnyShapeStyle(Color.clear)
        }
        if switching {
            return AnyShapeStyle(SeaTheme.cool.opacity(0.08))
        }
        return AnyShapeStyle(Color(hex: "FFD6A0").opacity(Self.washOpacity(selected: selected, hovered: hovered)))
    }

    func body(content: Content) -> some View {
        content
            .background(backgroundStyle, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                if switching || selected || (display.contrast == .increased && hovered) {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(
                            switching
                                ? SeaTheme.cool.opacity(display.contrast == .increased ? 0.55 : 0.24)
                                : Color(hex: "FFD6A0").opacity(display.contrast == .increased ? 0.55 : 0.16),
                            lineWidth: display.contrast == .increased ? 1 : 0.65
                        )
                }
            }
            .overlay(alignment: .leading) {
                if switching {
                    RoundedRectangle(cornerRadius: 1).fill(SeaTheme.cool)
                        .frame(width: 2).padding(.vertical, 8)
                } else if selected {
                    RoundedRectangle(cornerRadius: 1).fill(Color(hex: "FFB877"))
                        .frame(width: 2).padding(.vertical, 8)
                }
            }
            .onHover { hovered = $0 }
            .animation(TonoMotion.hover(reduceMotion: reduceMotion), value: hovered)
    }
}
