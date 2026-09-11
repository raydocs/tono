import SwiftUI

extension ProxiesView {
    var nodesSection: some View {
        let allNodes = cloudNodes
        let localNodes = filteredNodes(from: allNodes)
        let grouped = Dictionary(grouping: localNodes) {
            nodeListRegionCode(flag: $0.flag, name: $0.name)
        }
        let regionCodes = nodeListRegionSorted(Array(grouped.keys))

        return Group {
            if !localNodes.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        sectionTitle("Cloud Servers", count: localNodes.count)
                        if localNodes.count != allNodes.count {
                            // Concatenation bypassed the catalog entirely, so
                            // this read "of 17" in Chinese.
                            Text("of \(allNodes.count)")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.tertiary)
                        }
                    }

                    // Adaptive columns: cards hold a comfortable width and the
                    // column count follows the window instead of stretching
                    // two cards across however much space there is.
                    let columns = [GridItem(.adaptive(minimum: 284, maximum: 430), spacing: 12)]
                    ForEach(regionCodes, id: \.self) { code in
                        regionHeader(code, count: grouped[code]?.count ?? 0)
                            .padding(.top, regionCodes.first == code ? 0 : 8)
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(grouped[code] ?? []) { node in
                                localNodeCard(node)
                            }
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

    func localNodeCard(_ node: ProxyNode) -> some View {
        let isActive = appState.selectedNodeId == node.id || appState.selectedNodeId == node.name
        let isSwitching = appState.switchingNodeId == node.id || appState.switchingNodeId == node.name
        let runtimeNode = appState.proxyService.node(named: node.name)
        // The badge already carries the measurement state ("未测速"/a number), so
        // this line only speaks to whether the node can be connected to.
        let statusTitle: String = if runtimeNode?.lastTestFailed == true {
            String(localized: "Unavailable")
        } else {
            String(localized: "Ready to connect")
        }
        let statusColor: Color = runtimeNode?.lastTestFailed == true
            ? TonoStatus.error
            : .secondary
        let isDisabled = appState.isConnecting
            || appState.isDisconnecting
            || (appState.switchingNodeId != nil && !isSwitching)
        return Button {
            withAnimation(TonoMotion.easeOut(0.35, reduceMotion: reduceMotion)) {
                appState.selectNode(node.name)
            }
        } label: {
            NodeCardSurface(
                isActive: isActive,
                isDisabled: isDisabled,
                activeLineNamespace: activeLineNS
            ) {
            VStack(alignment: .leading, spacing: 13) {
                HStack(alignment: .top, spacing: 11) {
                    NodeRouteMark(city: nodeCityParts(node.displayName).city)

                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 7) {
                            // City first — the name users actually think in;
                            // hy2 must say 备用通道 on this line, not only in
                            // the tiny protocol chip, or Choose another route
                            // shows two identical 东京 cards.
                            Text(nodeRouteTitle(node))
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                                .layoutPriority(1)

                            if let codename = nodeCityParts(node.displayName).codename {
                                Text(codename)
                                    .font(.system(size: 9, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2.5)
                                    .background(.primary.opacity(0.05), in: Capsule())
                            }

                            if isActive {
                                Text("ACTIVE")
                                    .font(.system(size: 8, weight: .bold, design: .rounded))
                                    .kerning(0.7)
                                    .foregroundStyle(TonoStatus.positive)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 3)
                                    .background(TonoStatus.positive.opacity(0.12), in: Capsule())
                            }
                        }

                        HStack(spacing: 6) {
                            nodeMetaChip(node.protocolType.uppercased(), systemImage: "lock.fill")
                            Label(
                                nodeRegionCode(flag: node.flag, name: node.name),
                                systemImage: "globe"
                            )
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                            if !node.relay.isEmpty {
                                Text(node.relay)
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }

                    Spacer(minLength: 0)

                    if isSwitching {
                        HStack(spacing: 5) {
                            ProgressView()
                                .controlSize(.mini)
                            Text("Connecting…")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(TonoBrand.accent)
                        }
                    } else {
                        NodeLatencyBadge(
                            latency: runtimeNode?.latency ?? 0,
                            didFail: runtimeNode?.lastTestFailed == true
                        )
                    }
                }

                // Active and connecting states already read from the ACTIVE
                // chip / spinner above — the footer only invites selection.
                if !isActive && !isSwitching {
                    HStack(spacing: 7) {
                        Image(systemName: "circle.dotted")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(statusColor)
                        Text(statusTitle)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(statusColor)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            }
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .animation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion), value: isActive)
        .animation(TonoMotion.easeOut(0.2, reduceMotion: reduceMotion), value: isSwitching)
        .accessibilityLabel(localNodeAccessibilitySummary(
            node: node,
            isActive: isActive,
            isSwitching: isSwitching,
            latency: runtimeNode?.latency ?? 0,
            didFail: runtimeNode?.lastTestFailed == true
        ))
    }

    func localNodeAccessibilitySummary(
        node: ProxyNode,
        isActive: Bool,
        isSwitching: Bool,
        latency: Int,
        didFail: Bool
    ) -> String {
        var parts = [
            node.displayName,
            nodeRegionCode(flag: node.flag, name: node.name),
            node.protocolType,
        ]
        if latency > 0 { parts.append(String(localized: "\(latency) milliseconds")) }
        if isSwitching {
            parts.append(String(localized: "connecting"))
        } else if isActive {
            parts.append(String(localized: "active"))
        } else if didFail {
            parts.append(String(localized: "unavailable"))
        }
        return parts.joined(separator: ", ")
    }

    @ViewBuilder
    func nodeMetaChip(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.system(size: 9, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.42), in: Capsule())
    }

    func nodeCard(_ node: ProxyService.MihomoNode) -> some View {
        let isActive = appState.proxyService.activeNodeName == node.name
        return Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                appState.selectNode(node.name)
            }
        } label: {
            HStack(spacing: 8) {
                let clean = ProxyNode.displayName(
                    for: ConfigParser.extractFlag(from: node.name).cleanName
                )
                NodeRouteMark(size: 32, city: nodeCityParts(clean).city)
                VStack(alignment: .leading, spacing: 2) {
                    Text(clean)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(node.type)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }
                Spacer(minLength: 0)
                if node.latency > 0 {
                    Text(LatencyLevel.spokenTitle(for: node.latency, kind: .exit))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Color(hex: LatencyLevel.level(for: node.latency, kind: .exit).color))
                } else if node.lastTestFailed {
                    Text("Timeout")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(TonoStatus.error.opacity(0.7))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                .white.opacity(colorScheme == .dark
                    ? (isActive ? 0.14 : 0.07)
                    : (isActive ? 0.7 : 0.35)),
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(
                        isActive
                            ? TonoBrand.accent.opacity(0.5)
                            : .white.opacity(colorScheme == .dark ? 0.1 : 0.5),
                        lineWidth: 0.5
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    func regionHeader(_ code: String, count: Int) -> some View {
        HStack(spacing: 6) {
            Label(nodeListRegionLabel(code), systemImage: "globe")
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .kerning(0.8)
                .foregroundStyle(.secondary)
            Text("\(count)")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.tertiary)
        }
    }

    func sectionTitle(_ title: LocalizedStringKey, count: Int) -> some View {
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

    func groupIcon(for group: ProxyService.MihomoGroup) -> String {
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

    func groupTarget(for group: ProxyService.MihomoGroup) -> String {
        if let now = group.now, !now.isEmpty {
            return ConfigParser.extractFlag(from: now).cleanName
        }
        return groupTypeName(group.type)
    }

    func currentProxyGroup(named name: String) -> ProxyService.MihomoGroup? {
        proxyGroups.first { $0.name == name }
    }

    func groupPopoverBinding(for group: ProxyService.MihomoGroup) -> Binding<Bool> {
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

    func groupTargetPicker(_ group: ProxyService.MihomoGroup) -> some View {
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

    func targetChoiceButton(_ target: String, in group: ProxyService.MihomoGroup) -> some View {
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
                        .foregroundStyle(TonoStatus.positive)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(
                isSelected ? TonoBrand.accent.opacity(0.12) : Color.clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    func emptyTargetMessage(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 54)
    }

    @ViewBuilder
    func targetIcon(for target: String) -> some View {
        if mihomoNode(named: target) != nil {
            NodeRouteMark(size: 18)
        } else {
            Image(systemName: targetSystemIcon(for: target))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
    }

    func targetSystemIcon(for target: String) -> String {
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

    func targetDisplayName(_ target: String) -> String {
        let cleanName = ConfigParser.extractFlag(from: target).cleanName
        return ProxyNode.displayName(for: cleanName.isEmpty ? target : cleanName)
    }

    func targetMeta(for target: String) -> String? {
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

    func mihomoNode(named target: String) -> ProxyService.MihomoNode? {
        appState.proxyService.nodes.first {
            $0.name == target || ConfigParser.extractFlag(from: $0.name).cleanName == target
        }
    }

    func groupTypeName(_ type: String) -> String {
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

    func runtimeGroupType(from type: String) -> String {
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

    func moreText(_ count: Int) -> String {
        String(format: String(localized: "%lld more"), Int64(count))
    }

    @ViewBuilder
    func regionFilterChip(_ code: String?) -> some View {
        let isOn = regionFilter == code
        Button {
            regionFilter = code
        } label: {
            HStack(spacing: 4) {
                if let code {
                    Text(nodeListRegionLabel(code))
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                } else {
                    Image(systemName: "square.grid.2x2")
                        .font(.system(size: 10, weight: .semibold))
                    Text("All")
                        .font(.system(size: 10, weight: .semibold))
                }
            }
            .foregroundStyle(isOn ? .primary : .secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(
                isOn ? TonoBrand.accent.opacity(0.14) : .clear,
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
    }

    func filteredNodes(from nodes: [ProxyNode]) -> [ProxyNode] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedLowercase

        return nodes.filter { node in
            let matchesFilter = regionFilter == nil
                || nodeListRegionCode(flag: node.flag, name: node.name) == regionFilter
            if ProxyNode.hy2UdpIsVendorBlocked(node.name) { return false }

            guard !query.isEmpty else { return matchesFilter }
            return matchesFilter
                && (node.displayName.localizedLowercase.contains(query)
                    || node.name.localizedLowercase.contains(query)
                    || node.type.displayName.localizedLowercase.contains(query))
        }
    }
}
