import SwiftUI

struct ProxiesView: View {
    @Environment(AppState.self) var appState
    @Environment(AccountSession.self) var accountSession
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @FocusState var isSearchFocused: Bool
    @State var showingAddNode = false
    @State var editingNode: ProxyNode?
    @State var isTesting = false
    @State var isRefreshingCatalog = false
    @State var catalogFeedback: String?
    @State var catalogRefreshSucceeded = false
    @State var searchText = ""
    @State var regionFilter: String?
    @State var targetGroup: ProxyService.MihomoGroup?
    @State var catalogFeedbackDismissal: Task<Void, Never>?
    @Namespace var activeLineNS

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
            catalogSummary
                .padding(.top, 14)
            nodeToolbar
                .padding(.top, 12)
                .padding(.bottom, 16)

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if AppProfile.isDev && !proxyGroups.isEmpty {
                        proxyGroupsSection(proxyGroups)
                    }

                    nodesSection

                    if AppProfile.isDev {
                        ForEach(appState.proxyRegions.filter { $0.id == "custom" }) { region in
                            RegionGroupView(
                                region: region,
                                selectedNodeId: appState.selectedNodeId,
                                onToggleExpand: {
                                    withAnimation(.easeInOut(duration: 0.25)) {
                                        appState.toggleRegion(region.id)
                                    }
                                },
                                onSelectNode: { node in
                                    appState.selectNode(node.id)
                                },
                                onDeleteNode: { node in
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        appState.deleteNode(node.id)
                                    }
                                },
                                onEditNode: { node in
                                    editingNode = node
                                    showingAddNode = true
                                }
                            )
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onChange(of: showingAddNode) { _, showing in
            if !showing { editingNode = nil }
        }
        .onChange(of: selectedNodeName) { oldValue, newValue in
            // Restore/initial catalog sync assigns the selection without a
            // user switch; only announce a real node-to-node change.
            guard oldValue != nil, let newValue, oldValue != newValue else { return }
            let nodes = appState.proxyRegions.flatMap(\.nodes)
            let wireName = nodes.first { $0.id == newValue || $0.name == newValue }?.name
                ?? newValue
            // Announce the same localized city the card shows, including
            // 备用通道 when the user picked the hy2 sibling.
            ToastCenter.shared.show(
                String(localized: "Switched to \(nodeRouteTitle(for: wireName))"),
                systemImage: "checkmark.circle.fill"
            )
        }
        .onChange(of: regionOptions) { _, options in
            // A catalog refresh can retire the filtered region; fall back to
            // All instead of pinning the list to an empty result.
            if let filter = regionFilter, !options.contains(filter) {
                regionFilter = nil
            }
        }
        .background {
            Button("Search servers") {
                isSearchFocused = true
            }
            .keyboardShortcut("f", modifiers: .command)
            .opacity(0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .overlay {
            if showingAddNode {
                AddNodeSheet(isPresented: $showingAddNode, onAdd: { node in
                    if editingNode != nil {
                        appState.updateNode(node)
                    } else {
                        appState.addNode(node)
                    }
                }, editingNode: editingNode)
                .transition(.opacity)
            }
        }
    }

    /// The selection resolved to the exit's name.
    ///
    /// Catalog nodes carry an `id` generated fresh on every parse, so installing
    /// a revision hands every server a new one while the selection — restored by
    /// name onto the same server — has not moved. The name is what a real switch
    /// changes, which is what the "Switched to" toast is announcing.
    var selectedNodeName: String? {
        guard let selected = appState.selectedNodeId else { return nil }
        if let node = appState.proxyRegions.flatMap(\.nodes)
            .first(where: { $0.id == selected || $0.name == selected }) {
            return node.name
        }
        // Everything that is not a catalog node — a proxy group, the home exit,
        // a runtime-only node — is already stored under its own stable name and
        // reaches `activeNodeName` unchanged. An id that matches neither is a
        // selection left behind by a catalog that was dropped, not a switch.
        guard appState.proxyService.activeNodeName == selected else { return nil }
        return selected
    }

    /// Region chips are derived from the catalog itself: "All" plus every
    /// region code that actually appears, so new regions show up without a
    /// code change. `nil` means no region filter.
    var regionOptions: [String] {
        nodeListRegionSorted(Array(Set(cloudNodes.compactMap { node in
            ProxyNode.hy2UdpIsVendorBlocked(node.name)
                ? nil
                : nodeListRegionCode(flag: node.flag, name: node.name)
        })))
    }

    var cloudNodes: [ProxyNode] {
        appState.proxyRegions.filter { $0.id != "custom" }.flatMap(\.nodes)
    }

    // MARK: - Proxy Groups (from mihomo API)

    let groupIcons: [String: String] = [
        "YouTube": "play.rectangle.fill", "Netflix": "film.fill", "Disney": "sparkles",
        "Spotify": "music.note", "Telegram": "paperplane.fill", "Google": "magnifyingglass",
        "OpenAI": "brain.head.profile.fill", "Apple": "apple.logo", "Microsoft": "desktopcomputer",
        "Steam": "gamecontroller.fill", "HK": "globe.asia.australia.fill", "JP": "globe.asia.australia.fill",
        "SG": "globe.asia.australia.fill", "TW": "globe.asia.australia.fill", "US": "globe.americas.fill",
        "PROXY": "switch.2", "Proxies": "switch.2", "Auto Select": "bolt.fill",
        "Fallback": "arrow.triangle.2.circlepath", "GLOBAL": "globe",
    ]

    var proxyGroups: [ProxyService.MihomoGroup] {
        if !appState.proxyService.groups.isEmpty {
            return appState.proxyService.groups
        }
        return localProxyGroups
    }

    var localProxyGroups: [ProxyService.MihomoGroup] {
        guard let yaml = ConfigStorage.shared.loadSubscriptionYAML() else { return [] }
        return ConfigParser.parseClashYAMLProxyGroups(yaml).map { group in
            ProxyService.MihomoGroup(
                id: group.name,
                name: group.name,
                type: runtimeGroupType(from: group.type),
                now: group.proxies.first,
                all: group.proxies,
                latency: 0
            )
        }
    }

    @State var expandedSections: Set<String> = []

    func proxyGroupsSection(_ groups: [ProxyService.MihomoGroup]) -> some View {
        let title = "proxy-groups"
        let maxVisible = 9
        let isExpanded = expandedSections.contains(title)
        let visibleGroups = isExpanded ? groups : Array(groups.prefix(maxVisible))

        return VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Proxy Groups", count: groups.count)

            let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(visibleGroups) { group in
                    let icon = groupIcons[group.name] ?? groupIcon(for: group)
                    let target = groupTarget(for: group)
                    let isActive = group.name == appState.proxyService.activeGroupName
                        || group.name == appState.proxyService.activeNodeName
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            if group.isSelector && !group.all.isEmpty {
                                targetGroup = group
                            } else {
                                appState.selectNode(group.name)
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: icon)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .frame(width: 16)
                            Text(group.name)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            Text(target)
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(
                            .white.opacity(colorScheme == .dark
                                ? (isActive ? 0.14 : 0.07)
                                : (isActive ? 0.7 : 0.35)),
                            in: RoundedRectangle(cornerRadius: 8)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(
                                    isActive
                                        ? TonoBrand.accent.opacity(0.5)
                                        : .white.opacity(colorScheme == .dark ? 0.1 : 0.5),
                                    lineWidth: 0.5
                                )
                        )
                        .contentShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: groupPopoverBinding(for: group), arrowEdge: .bottom) {
                        groupTargetPicker(currentProxyGroup(named: group.name) ?? group)
                    }
                }
            }

            if groups.count > maxVisible {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        if isExpanded {
                            expandedSections.remove(title)
                        } else {
                            expandedSections.insert(title)
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(isExpanded ? String(localized: "Collapse") : moreText(groups.count - maxVisible))
                            .font(.system(size: 11, weight: .medium))
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

}

#Preview {
    ZStack {
        MeshGradientBackground()
        ProxiesView()
    }
    .frame(width: 700, height: 600)
    .environment({
        let state = AppState()
        state.loadMockData()
        return state
    }())
    .environment(AccountSession(
        sidecar: TonoSidecarService(),
        descriptorConsumer: { _ in }
    ))
}
