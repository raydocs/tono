import SwiftUI

struct ProxiesView: View {
    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var accountSession
    @Environment(\.colorScheme) private var colorScheme
    @State private var showingAddNode = false
    @State private var editingNode: ProxyNode?
    @State private var isTesting = false
    @State private var isRefreshingCatalog = false
    @State private var catalogFeedback: String?
    @State private var catalogRefreshSucceeded = false
    @State private var searchText = ""
    @State private var nodeFilter: NodeFilter = .all
    @State private var targetGroup: ProxyService.MihomoGroup?

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

    private enum NodeFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case us = "US"
        case japan = "Japan"

        var id: Self { self }

        var icon: String {
            switch self {
            case .all: "square.grid.2x2"
            case .us: "🇺🇸"
            case .japan: "🇯🇵"
            }
        }
    }

    // MARK: - Proxy Groups (from mihomo API)

    private let groupIcons: [String: String] = [
        "YouTube": "play.rectangle.fill", "Netflix": "film.fill", "Disney": "sparkles",
        "Spotify": "music.note", "Telegram": "paperplane.fill", "Google": "magnifyingglass",
        "OpenAI": "brain.head.profile.fill", "Apple": "apple.logo", "Microsoft": "desktopcomputer",
        "Steam": "gamecontroller.fill", "HK": "globe.asia.australia.fill", "JP": "globe.asia.australia.fill",
        "SG": "globe.asia.australia.fill", "TW": "globe.asia.australia.fill", "US": "globe.americas.fill",
        "PROXY": "switch.2", "Proxies": "switch.2", "Auto Select": "bolt.fill",
        "Fallback": "arrow.triangle.2.circlepath", "GLOBAL": "globe",
    ]

    private var proxyGroups: [ProxyService.MihomoGroup] {
        if !appState.proxyService.groups.isEmpty {
            return appState.proxyService.groups
        }
        return localProxyGroups
    }

    private var localProxyGroups: [ProxyService.MihomoGroup] {
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

    @State private var expandedSections: Set<String> = []

    private func proxyGroupsSection(_ groups: [ProxyService.MihomoGroup]) -> some View {
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
                        .background(.white.opacity(isActive ? 0.7 : 0.35),
                                    in: RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(
                                    isActive
                                        ? Color(hex: "4B6EFF").opacity(0.5)
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

    // MARK: - Nodes Section (flat list from mihomo API)

    private var nodesSection: some View {
        let allNodes = appState.proxyRegions.filter { $0.id != "custom" }
            .flatMap(\.nodes)
        let localNodes = filteredNodes(from: allNodes)

        return Group {
            if !localNodes.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        sectionTitle("Cloud Servers", count: localNodes.count)
                        if localNodes.count != allNodes.count {
                            Text("of " + String(allNodes.count))
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.tertiary)
                        }
                    }

                    let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(localNodes) { node in
                            localNodeCard(node)
                        }
                    }
                }
            } else {
                ContentUnavailableView(
                    allNodes.isEmpty ? "No Cloud Servers" : "No Matching Servers",
                    systemImage: allNodes.isEmpty ? "network.slash" : "magnifyingglass",
                    description: Text(
                        allNodes.isEmpty
                            ? "Sign in and wait for the protected server catalog to synchronize."
                            : "Try a different search or region filter."
                    )
                )
                .frame(maxWidth: .infinity, minHeight: 260)
            }
        }
    }

    private func localNodeCard(_ node: ProxyNode) -> some View {
        let isActive = appState.selectedNodeId == node.id || appState.selectedNodeId == node.name
        let isSwitching = appState.switchingNodeId == node.id || appState.switchingNodeId == node.name
        let runtimeNode = appState.proxyService.nodes.first {
            $0.name == node.name
                || ConfigParser.extractFlag(from: $0.name).cleanName
                    == ConfigParser.extractFlag(from: node.name).cleanName
        }
        return Button {
            appState.selectNode(node.name)
        } label: {
            HStack(spacing: 8) {
                Text(node.flag)
                    .font(.system(size: 14))
                VStack(alignment: .leading, spacing: 2) {
                    Text(node.displayName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(node.type.rawValue)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
                Spacer(minLength: 0)
                if isSwitching {
                    HStack(spacing: 4) {
                        ProgressView()
                            .controlSize(.mini)
                        Text("Connecting…")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                } else if let runtimeNode, runtimeNode.latency > 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(runtimeNode.latency)ms")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(
                                runtimeNode.latency < 200 ? Color(hex: "30D158")
                                    : runtimeNode.latency < 400 ? Color(hex: "FF9F0A")
                                    : Color(hex: "FF3B30")
                            )
                        Text(isActive ? "Selected" : "Ready")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.tertiary)
                    }
                } else if runtimeNode?.lastTestFailed == true {
                    Text("Timeout")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Color(hex: "FF3B30").opacity(0.7))
                } else {
                    Text(isActive ? "Selected" : "Ready")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(isActive ? Color.accentColor : Color.secondary)
                }

                if isActive {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color(hex: "30D158"))
                }
            }
            .padding(10)
            .background(
                isActive ? Color.accentColor.opacity(0.15) : .white.opacity(colorScheme == .dark ? 0.06 : 0.7),
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isActive ? Color.accentColor.opacity(0.5) : .white.opacity(colorScheme == .dark ? 0.12 : 0.7), lineWidth: 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(
            appState.isConnecting
                || appState.isDisconnecting
                || (appState.switchingNodeId != nil && !isSwitching)
        )
    }

    private func nodeCard(_ node: ProxyService.MihomoNode) -> some View {
        let isActive = appState.proxyService.activeNodeName == node.name
        return Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                appState.selectNode(node.name)
            }
        } label: {
            HStack(spacing: 8) {
                Text(node.flag)
                    .font(.system(size: 14))
                VStack(alignment: .leading, spacing: 2) {
                    Text(
                        ProxyNode.displayName(
                            for: ConfigParser.extractFlag(from: node.name).cleanName
                        )
                    )
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(node.type)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
                Spacer(minLength: 0)
                if node.latency > 0 {
                    Text("\(node.latency)ms")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(node.latency < 200 ? Color(hex: "30D158") :
                                        node.latency < 400 ? Color(hex: "FF9F0A") :
                                        Color(hex: "FF3B30"))
                } else if node.lastTestFailed {
                    Text("Timeout")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Color(hex: "FF3B30").opacity(0.7))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(.white.opacity(isActive ? 0.7 : 0.35),
                        in: RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(
                        isActive
                            ? Color(hex: "4B6EFF").opacity(0.5)
                            : .white.opacity(colorScheme == .dark ? 0.1 : 0.5),
                        lineWidth: 0.5
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func sectionTitle(_ title: LocalizedStringKey, count: Int) -> some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .kerning(1.0)
                .foregroundStyle(.secondary)

            Text("\(count)")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
        }
    }

    private func groupIcon(for group: ProxyService.MihomoGroup) -> String {
        switch group.type {
        case "Selector":
            return "square.grid.2x2.fill"
        case "URLTest":
            return "bolt.fill"
        case "Fallback":
            return "arrow.triangle.2.circlepath"
        case "LoadBalance":
            return "scalemass.fill"
        case "Relay":
            return "point.3.connected.trianglepath.dotted"
        default:
            return "folder.fill"
        }
    }

    private func groupTarget(for group: ProxyService.MihomoGroup) -> String {
        if let now = group.now, !now.isEmpty {
            return ConfigParser.extractFlag(from: now).cleanName
        }
        return groupTypeName(group.type)
    }

    private func currentProxyGroup(named name: String) -> ProxyService.MihomoGroup? {
        proxyGroups.first { $0.name == name }
    }

    private func groupPopoverBinding(for group: ProxyService.MihomoGroup) -> Binding<Bool> {
        Binding {
            targetGroup?.id == group.id
        } set: { isPresented in
            if isPresented {
                targetGroup = group
            } else if targetGroup?.id == group.id {
                targetGroup = nil
            }
        }
    }

    private func groupTargetPicker(_ group: ProxyService.MihomoGroup) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: groupIcons[group.name] ?? groupIcon(for: group))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .frame(width: 18)

                VStack(alignment: .leading, spacing: 2) {
                    Text(group.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text("Choose Target")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }

                Spacer(minLength: 0)
            }

            Divider()
                .opacity(0.35)

            if !appState.isConnected {
                emptyTargetMessage("Core not connected")
            } else if group.all.isEmpty {
                emptyTargetMessage("No targets available")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(group.all.enumerated()), id: \.offset) { _, target in
                            targetChoiceButton(target, in: group)
                        }
                    }
                }
                .frame(maxHeight: 320)
                .scrollIndicators(.hidden)
            }
        }
        .padding(12)
        .frame(width: 300)
    }

    private func targetChoiceButton(_ target: String, in group: ProxyService.MihomoGroup) -> some View {
        let isSelected = group.now == target
        return Button {
            appState.selectProxyTarget(target, inGroup: group.name)
            targetGroup = nil
        } label: {
            HStack(spacing: 8) {
                targetIcon(for: target)
                    .frame(width: 18)

                VStack(alignment: .leading, spacing: 2) {
                    Text(targetDisplayName(target))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    if let meta = targetMeta(for: target) {
                        Text(meta)
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(hex: "30D158"))
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(
                isSelected ? Color.accentColor.opacity(0.12) : Color.clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func emptyTargetMessage(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 54)
    }

    @ViewBuilder
    private func targetIcon(for target: String) -> some View {
        if let node = mihomoNode(named: target) {
            Text(node.flag)
                .font(.system(size: 13))
        } else {
            Image(systemName: targetSystemIcon(for: target))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
    }

    private func targetSystemIcon(for target: String) -> String {
        if let icon = groupIcons[target] { return icon }
        switch target {
        case "DIRECT":
            return "arrow.up.right.circle.fill"
        case "REJECT", "REJECT-DROP":
            return "xmark.octagon.fill"
        case "PASS":
            return "arrow.right.circle.fill"
        default:
            if let group = currentProxyGroup(named: target) {
                return groupIcon(for: group)
            }
            return "circle.grid.2x2.fill"
        }
    }

    private func targetDisplayName(_ target: String) -> String {
        let cleanName = ConfigParser.extractFlag(from: target).cleanName
        return ProxyNode.displayName(for: cleanName.isEmpty ? target : cleanName)
    }

    private func targetMeta(for target: String) -> String? {
        if target == "DIRECT" {
            return String(localized: "Direct")
        }
        if target == "REJECT" || target == "REJECT-DROP" {
            return String(localized: "Reject")
        }
        if let group = currentProxyGroup(named: target) {
            return groupTypeName(group.type)
        }
        return mihomoNode(named: target)?.type
    }

    private func mihomoNode(named target: String) -> ProxyService.MihomoNode? {
        appState.proxyService.nodes.first {
            $0.name == target || ConfigParser.extractFlag(from: $0.name).cleanName == target
        }
    }

    private func groupTypeName(_ type: String) -> String {
        switch type {
        case "Selector":
            return String(localized: "Selector")
        case "URLTest":
            return String(localized: "URL Test")
        case "Fallback":
            return String(localized: "Fallback")
        case "LoadBalance":
            return String(localized: "Load Balance")
        case "Relay":
            return String(localized: "Relay")
        default:
            return type
        }
    }

    private func runtimeGroupType(from type: String) -> String {
        switch type.lowercased() {
        case "select", "selector":
            return "Selector"
        case "url-test", "urltest":
            return "URLTest"
        case "fallback":
            return "Fallback"
        case "load-balance", "loadbalance":
            return "LoadBalance"
        case "relay":
            return "Relay"
        default:
            return type
        }
    }

    private func moreText(_ count: Int) -> String {
        String(format: String(localized: "%lld more"), Int64(count))
    }

    private func filteredNodes(from nodes: [ProxyNode]) -> [ProxyNode] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedLowercase

        return nodes.filter { node in
            let matchesFilter: Bool
            switch nodeFilter {
            case .all:
                matchesFilter = true
            case .us:
                matchesFilter = node.flag.contains("🇺🇸")
                    || node.name.localizedCaseInsensitiveContains("US")
            case .japan:
                matchesFilter = node.flag.contains("🇯🇵")
                    || node.name.localizedCaseInsensitiveContains("JP")
                    || node.name.localizedCaseInsensitiveContains("Japan")
            }

            guard !query.isEmpty else { return matchesFilter }
            return matchesFilter
                && (node.displayName.localizedLowercase.contains(query)
                    || node.name.localizedLowercase.contains(query)
                    || node.type.displayName.localizedLowercase.contains(query))
        }
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Nodes")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.primary)
                Text("Choose a secure exit for your protected traffic.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            HStack(spacing: 10) {
                if AppProfile.isDev {
                    GradientAddButton("Add Node") {
                        withAnimation(.easeOut(duration: 0.25)) {
                            showingAddNode = true
                        }
                    }
                }

                if appState.isConnected {
                    Button {
                        guard !isTesting else { return }
                        isTesting = true
                        Task {
                            await appState.testAllLatency()
                            isTesting = false
                        }
                    } label: {
                        HStack(spacing: 5) {
                            if isTesting {
                                ProgressView()
                                    .controlSize(.mini)
                            } else {
                                Image(systemName: "bolt.fill")
                                    .font(.system(size: 11))
                            }
                            Text("Test Latency")
                            .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .fixedSize()
                    .disabled(
                        isTesting
                            || appState.isConnecting
                            || appState.isDisconnecting
                            || appState.switchingNodeId != nil
                    )
                    .glassEffect(
                        .regular.tint(.white.opacity(0.08)),
                        in: Capsule()
                    )
                }
            }
        }
    }

    private var catalogSummary: some View {
        HStack(spacing: 12) {
            Image(systemName: catalogStatusIcon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(catalogStatusColor)
                .frame(width: 30, height: 30)
                .background(catalogStatusColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))

            VStack(alignment: .leading, spacing: 2) {
                Text(catalogStatusTitle)
                    .font(.system(size: 12, weight: .semibold))
                Text(catalogStatusDetail)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if let catalogFeedback {
                Text(catalogFeedback)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(catalogRefreshSucceeded ? Color.green : Color.orange)
                    .lineLimit(1)
            }

            Button {
                refreshCatalog()
            } label: {
                HStack(spacing: 5) {
                    if isRefreshingCatalog {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    Text(isRefreshingCatalog ? "Refreshing…" : "Refresh")
                        .font(.system(size: 11, weight: .semibold))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(.white.opacity(0.08)), in: Capsule())
            .disabled(isRefreshingCatalog || accountSession.state != .ready)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .background(.white.opacity(colorScheme == .dark ? 0.07 : 0.42), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.65), lineWidth: 0.5)
        )
    }

    private var nodeToolbar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                TextField("Search servers", text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))

                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.white.opacity(colorScheme == .dark ? 0.07 : 0.38), in: RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.6), lineWidth: 0.5)
            )

            HStack(spacing: 3) {
                ForEach(NodeFilter.allCases) { filter in
                    Button {
                        nodeFilter = filter
                    } label: {
                        HStack(spacing: 4) {
                            if filter == .all {
                                Image(systemName: filter.icon)
                                    .font(.system(size: 10, weight: .semibold))
                            } else {
                                Text(filter.icon)
                                    .font(.system(size: 11))
                            }
                            Text(filter.rawValue)
                                .font(.system(size: 10, weight: .semibold))
                        }
                        .foregroundStyle(nodeFilter == filter ? .primary : .secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 7)
                        .background(
                            nodeFilter == filter ? Color.accentColor.opacity(0.14) : .clear,
                            in: Capsule()
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(3)
            .background(.white.opacity(colorScheme == .dark ? 0.06 : 0.32), in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(.white.opacity(colorScheme == .dark ? 0.1 : 0.55), lineWidth: 0.5)
            )

            Spacer(minLength: 0)
        }
    }

    private var catalogStatusTitle: String {
        if accountSession.catalogFailureMessage != nil {
            return String(localized: "Using last verified catalog")
        }
        if appState.managedCatalogNodeCount > 0 {
            return String(localized: "Verified server catalog")
        }
        return String(localized: "Waiting for server catalog")
    }

    private var catalogStatusDetail: String {
        let count = appState.managedCatalogNodeCount
        let serverCount = String.localizedStringWithFormat(
            String(localized: "%lld cloud servers"),
            Int64(count)
        )
        if let version = appState.managedCatalogVersion {
            return "\(serverCount) · v\(version) · updates automatically"
        }
        return "\(serverCount) · waiting for the first verified sync"
    }

    private var catalogStatusIcon: String {
        accountSession.catalogFailureMessage == nil && appState.managedCatalogNodeCount > 0
            ? "checkmark.shield.fill"
            : "exclamationmark.shield"
    }

    private var catalogStatusColor: Color {
        accountSession.catalogFailureMessage == nil && appState.managedCatalogNodeCount > 0
            ? Color.green
            : Color.orange
    }

    private func refreshCatalog() {
        guard !isRefreshingCatalog else { return }
        isRefreshingCatalog = true
        catalogFeedback = nil
        Task {
            let succeeded = await accountSession.refreshManagedCatalog()
            isRefreshingCatalog = false
            catalogRefreshSucceeded = succeeded
            catalogFeedback = succeeded
                ? String(localized: "Updated")
                : String(localized: "Using last verified copy")
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
