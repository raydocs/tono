import SwiftUI
import AppKit

/// Resolves a client process name to the owning application's real icon.
///
/// Mihomo reports the executable name only, so the icon is recovered by
/// matching against currently running applications. A process that has already
/// exited, or a helper with no bundle, resolves to nil exactly once and is then
/// cached — the connection list re-renders on every traffic tick and must never
/// re-walk the process table per row.
@MainActor
private enum ClientAppIconCache {
    private static var cache: [String: NSImage?] = [:]

    static func icon(for processName: String) -> NSImage? {
        if let cached = cache[processName] { return cached }
        var resolved: NSImage?
        if processName == "Claude" || processName == "Claude Code" {
            let candidates = [
                "/Applications/Claude.app",
                NSHomeDirectory() + "/Applications/Claude.app",
            ]
            if let path = candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) {
                resolved = NSWorkspace.shared.icon(forFile: path)
            }
        }
        if resolved == nil, processName == "Tono" {
            resolved = NSWorkspace.shared.icon(forFile: "/Applications/Tono.app")
        }
        if resolved == nil {
            for app in NSWorkspace.shared.runningApplications {
                let executable = app.executableURL?.lastPathComponent
                guard executable == processName
                        || app.localizedName == processName
                        || (processName == "Claude Code" && (executable == "Claude"
                            || app.localizedName == "Claude"))
                        || (processName == "Grok" && (
                            app.localizedName == "Grok Bot"
                            || (executable?.hasPrefix("grok-") == true)
                        ))
                        || (processName == "Google Chrome" && (
                            app.localizedName == "Google Chrome"
                            || executable?.hasPrefix("Google Chrome") == true
                        ))
                else { continue }
                if let bundleURL = app.bundleURL {
                    resolved = NSWorkspace.shared.icon(forFile: bundleURL.path)
                }
                break
            }
        }
        cache[processName] = resolved
        return resolved
    }
}

private struct ClientAppIcon: View {
    let processName: String?

    var body: some View {
        ZStack {
            if let processName, let icon = ClientAppIconCache.icon(for: processName) {
                Image(nsImage: icon)
                    .resizable()
                    .frame(width: 22, height: 22)
            } else {
                Image(systemName: processName == nil ? "globe" : "app.dashed")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 22, height: 22)
            }
        }
        .frame(width: 22, height: 22)
        .help(processName ?? "")
    }
}

private func activityBytes(_ bytes: Int64) -> String {
    TonoByteFormat.bytes(bytes)
}

/// One colour per path class, used by every split bar and legend on this page so
/// a colour means the same thing in the header card and in an app's own row.
private enum RouteTint {
    static let direct = TonoStatus.positive
    static let residential = Color(hex: "BF5AF2")
    static let tunnel = TonoBrand.accent
    static let blocked = TonoStatus.neutral
}

/// Proportional bar for a route split.
///
/// Segments below a pixel are dropped rather than rounded up: a hairline that
/// cannot be read is worse than an absent one, because it implies a category is
/// present at a size the eye cannot compare.
private struct RouteSplitBar: View {
    let split: AppTrafficLedger.RouteSplit
    var height: CGFloat = 6

    private var segments: [(Color, Int64)] {
        [
            (RouteTint.direct, split.direct),
            (RouteTint.residential, split.residential),
            (RouteTint.tunnel, split.tunnel),
            (RouteTint.blocked, split.blocked),
        ].filter { $0.1 > 0 }
    }

    var body: some View {
        GeometryReader { geometry in
            let total = max(split.total, 1)
            HStack(spacing: 1) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    let width = geometry.size.width * CGFloat(segment.1) / CGFloat(total)
                    if width >= 1 {
                        Rectangle().fill(segment.0).frame(width: width)
                    }
                }
                if segments.isEmpty {
                    Rectangle().fill(.secondary.opacity(0.18))
                }
            }
            .frame(height: height)
            .clipShape(Capsule())
        }
        .frame(height: height)
    }
}

/// Data card.
///
/// Deliberately *not* `.glassEffect(.regular)` like the chrome and the Dashboard
/// stat cards: this page puts numbers at 26pt over an animating mesh gradient,
/// and regular glass drops their contrast to the point where a rate is hard to
/// read at a glance. Chrome stays glass; data sits on a near-opaque surface and
/// keeps only the glass border and corner radius so the two still belong to one
/// design. The transparency slider in Settings governs the chrome, not this.
private struct ActivityCard<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: LocalizedStringKey
    var accessory: AnyView?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Spacer(minLength: 4)
                if let accessory { accessory }
            }
            content
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            .white.opacity(colorScheme == .dark ? 0.06 : 0.62),
            in: RoundedRectangle(cornerRadius: 14)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14).strokeBorder(
                .white.opacity(colorScheme == .dark ? 0.10 : 0.75),
                lineWidth: 0.5
            )
        )
    }
}

struct ActivityView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme
    @State private var selectedFilter: String = "All"
    @State private var section: Section = .apps
    @State private var connectionQuery = ""
    @State private var isTestingLatency = false
    @State private var trafficHistory = TrafficHistory()

    private enum Section: String, CaseIterable {
        case apps = "Apps"
        case connections = "Connections"
    }

    private let filters = ["All", "Proxied", "Home", "Direct", "Rejected"]

    private var filteredConnections: [ConnectionEntry] {
        let query = connectionQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return appState.connections.filter { entry in
            if selectedFilter != "All", entry.type.rawValue != selectedFilter {
                return false
            }
            if query.isEmpty { return true }
            return [
                entry.domain,
                entry.processName ?? "",
                entry.destination,
                entry.nodeName,
                entry.route,
                entry.network,
                entry.protocolName,
            ].contains { $0.lowercased().contains(query) }
        }
    }

    private var selectedExitLatency: Int? {
        guard let name = appState.proxyService.activeNodeName else { return nil }
        guard let node = appState.proxyService.nodes.first(where: { $0.name == name }),
              node.latency > 0 else { return nil }
        return node.latency
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
                .padding(.bottom, 14)

            // One container so neighbouring cards' glass borders merge and move
            // together — the part of this that a screenshot of another client
            // cannot be copied into.
            GlassEffectContainer(spacing: 10) {
                statCards
            }
            .padding(.bottom, 14)

            sectionPicker
                .padding(.bottom, 12)

            switch section {
            case .apps: appsList
            case .connections: connectionsList
            }
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 16)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onChange(of: appState.trafficStats.downloadSpeed) { _, _ in
            guard appState.trafficFeedLive else { return }
            trafficHistory.record(
                up: appState.trafficStats.uploadSpeed,
                down: appState.trafficStats.downloadSpeed
            )
        }
    }

    // MARK: - Stat cards

    private var statCards: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                ActivityCard(
                    title: "Current exit",
                    accessory: AnyView(latencyRefreshButton)
                ) {
                    if let ms = selectedExitLatency {
                        Text(LatencyLevel.spokenTitle(for: ms, kind: .exit))
                            .font(.system(size: 26, weight: .semibold, design: .rounded))
                            .foregroundStyle(
                                Color(hex: LatencyLevel.level(for: ms, kind: .exit).color)
                            )
                    } else {
                        Text("—")
                            .font(.system(size: 26, weight: .semibold, design: .rounded))
                    }
                    // Every other surface localizes the city; this one printed
                    // the raw catalog name, so Activity said "Tokyo · Fuji"
                    // while the Dashboard said 东京.
                    Text(
                        appState.proxyService.activeNodeName.map(nodeCityTitle)
                            ?? String(localized: "No exit selected")
                    )
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                ActivityCard(title: "Upload") {
                    if appState.trafficFeedLive {
                        rateValue(appState.trafficStats.uploadSpeed, tint: TonoTraffic.upload)
                    } else {
                        Text("—")
                            .font(.system(size: 26, weight: .semibold, design: .rounded))
                    }
                    Text("\(activityBytes(appState.trafficStats.totalUpload)) total")
                        .font(.system(size: 10)).foregroundStyle(.tertiary)
                }

                ActivityCard(title: "Download") {
                    if appState.trafficFeedLive {
                        rateValue(appState.trafficStats.downloadSpeed, tint: TonoTraffic.download)
                    } else {
                        Text("—")
                            .font(.system(size: 26, weight: .semibold, design: .rounded))
                    }
                    Text("\(activityBytes(appState.trafficStats.totalDownload)) total")
                        .font(.system(size: 10)).foregroundStyle(.tertiary)
                }
            }

            HStack(spacing: 10) {
                ActivityCard(title: "Active connections") {
                    Text(
                        appState.connectionsFeedLive
                            ? "\(appState.connections.count)"
                            : "—"
                    )
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    Text("\(appState.appTrafficLedger.apps.count) apps seen this session")
                        .font(.system(size: 10)).foregroundStyle(.tertiary).lineLimit(1)
                }

                ActivityCard(title: "Traffic by route · this session") {
                    let split = appState.appTrafficLedger.overall
                    Text(activityBytes(split.total))
                        .font(.system(size: 26, weight: .semibold, design: .rounded))
                    RouteSplitBar(split: split, height: 7).padding(.top, 1)
                    routeLegend(split)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func rateValue(_ bytesPerSecond: Int64, tint: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(TonoByteFormat.bytes(bytesPerSecond))
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                // An idle line is not a healthy line; only a moving rate earns
                // the accent colour.
                .foregroundStyle(bytesPerSecond > 0 ? tint : Color.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text("/s").font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    private func routeLegend(_ split: AppTrafficLedger.RouteSplit) -> some View {
        HStack(spacing: 10) {
            legendItem("Direct", RouteTint.direct, split.direct)
            legendItem("Residential", RouteTint.residential, split.residential)
            legendItem("Tunnel", RouteTint.tunnel, split.tunnel)
            if split.blocked > 0 {
                legendItem("Blocked", RouteTint.blocked, split.blocked)
            }
            Spacer(minLength: 0)
        }
    }

    private func legendItem(
        _ label: LocalizedStringKey,
        _ tint: Color,
        _ bytes: Int64
    ) -> some View {
        HStack(spacing: 4) {
            Circle().fill(tint).frame(width: 6, height: 6)
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
            Text(activityBytes(bytes))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
    }

    /// Probes the selected exit only. The kill switch permits that address and no
    /// other, so a sweep across the whole node list would measure a firewall
    /// rather than a network — which is why the label names one exit instead of
    /// promising "test all".
    private var latencyRefreshButton: some View {
        Button {
            guard !isTestingLatency, appState.isConnected else { return }
            isTestingLatency = true
            Task {
                await appState.testSelectedExitLatency()
                isTestingLatency = false
            }
        } label: {
            if isTestingLatency {
                ProgressView().controlSize(.mini)
            } else {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(
                        appState.isConnected
                            ? AnyShapeStyle(.tint)
                            : AnyShapeStyle(.tertiary)
                    )
            }
        }
        .buttonStyle(.plain)
        .disabled(isTestingLatency || !appState.isConnected)
        .help(String(localized: "Re-test the selected exit"))
    }

    // MARK: - Section picker

    private var sectionPicker: some View {
        HStack(spacing: 6) {
            ForEach(Section.allCases, id: \.self) { candidate in
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) { section = candidate }
                } label: {
                    Text(LocalizedStringKey(candidate.rawValue))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(section == candidate ? .white : .secondary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(
                            section == candidate
                                ? AnyShapeStyle(TonoBrand.accent)
                                : AnyShapeStyle(.white.opacity(colorScheme == .dark ? 0.08 : 0.4)),
                            in: Capsule()
                        )
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }

            if section == .connections {
                Divider().frame(height: 16).padding(.horizontal, 4)
                filterPills
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    TextField(
                        "Filter by app, domain, or destination",
                        text: $connectionQuery
                    )
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .frame(width: 200)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(
                    .white.opacity(colorScheme == .dark ? 0.08 : 0.4),
                    in: Capsule()
                )
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: - Apps

    private var appsList: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(appState.appTrafficLedger.apps) { app in
                    AppTrafficRow(app: app, peak: appState.appTrafficLedger.apps.first?.total ?? 1)
                }
                if appState.appTrafficLedger.apps.isEmpty {
                    Text(appsEmptyCopy)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 40)
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    // MARK: - Connections

    @ViewBuilder
    private var connectionsList: some View {
        if filteredConnections.isEmpty {
            Text(connectionsEmptyCopy)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 40)
        } else {
            ScrollView {
                ZStack(alignment: .leading) {
                    timelineLine
                    LazyVStack(spacing: 14) {
                        ForEach(filteredConnections) { entry in
                            LogEntryRow(entry: entry) {
                                Task { await appState.closeConnection(entry.id) }
                            }
                        }
                        // Say it under a filter too. Suppressing it there hid
                        // the truncation exactly when a search could be
                        // silently missing matches beyond the cap.
                        if appState.connectionsDisplayLimited {
                            Text("Showing the newest \(ConnectionActivityPresentation.maxDisplayed) connections.")
                                .font(.system(size: 11))
                                .foregroundStyle(.tertiary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, 4)
                        }
                    }
                    .padding(.leading, 32)
                    .padding(.bottom, 8)
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private var appsEmptyCopy: String {
        if !appState.isConnected {
            return String(localized: "Connect to see which apps use which route.")
        }
        if !appState.connectionsFeedLive {
            return String(localized: "Reading connections…")
        }
        return String(localized: "Waiting for the first traffic sample…")
    }

    private var connectionsEmptyCopy: String {
        if !appState.isConnected {
            return String(localized: "Connect Tono to view live activity.")
        }
        if !appState.connectionsFeedLive {
            return String(localized: "Reading connections…")
        }
        if selectedFilter != "All" || !connectionQuery.isEmpty {
            return String(localized: "No connections match these filters.")
        }
        if appState.trafficStats.activeConnections > 0 {
            return String(localized: "Only local DNS lookups are open; those stay hidden.")
        }
        return String(localized: "No active connections.")
    }

    // MARK: - Timeline Line

    private var timelineLine: some View {
        LinearGradient(
            colors: [TonoBrand.accent, .secondary.opacity(0.3)],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(width: 2)
        .padding(.leading, 10)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack(alignment: .center) {
            Text("Activity")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(.primary)

            Spacer()

            if !appState.connections.isEmpty, section == .connections {
                Button {
                    Task { await appState.closeAllConnections() }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark.circle")
                            .font(.system(size: 11))
                        Text("Close All")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(Color(hex: "FF6E52"))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color(hex: "FF6E52").opacity(0.3), lineWidth: 0.5))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var filterPills: some View {
        HStack(spacing: 6) {
            ForEach(filters, id: \.self) { filter in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { selectedFilter = filter }
                } label: {
                    Text(LocalizedStringKey(filter))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(selectedFilter == filter ? .primary : .secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .background(
                            .white.opacity(
                                selectedFilter == filter
                                    ? (colorScheme == .dark ? 0.16 : 0.7)
                                    : (colorScheme == .dark ? 0.06 : 0.3)
                            ),
                            in: Capsule()
                        )
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - App Traffic Row

private struct AppTrafficRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let app: AppTrafficLedger.AppTotals
    /// The largest total on the page, so every bar shares one scale and two rows
    /// can be compared by length rather than only by their labels.
    let peak: Int64

    var body: some View {
        HStack(spacing: 11) {
            ClientAppIcon(processName: app.id == AppTrafficLedger.unattributed ? nil : app.id)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Text(app.id == AppTrafficLedger.unattributed
                         ? String(localized: "Unattributed")
                         : app.id)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                    if app.liveConnections > 0 {
                        Text("\(app.liveConnections)")
                            .font(.system(size: 9, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(.secondary.opacity(0.14), in: Capsule())
                    }
                    Spacer(minLength: 6)
                    Text(activityBytes(app.total))
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                }

                // Two bars: the outer one scales this app against the busiest,
                // the inner one splits it by route. A single bar could show one
                // or the other, and the interesting question needs both.
                ZStack(alignment: .leading) {
                    Capsule().fill(.secondary.opacity(0.12)).frame(height: 6)
                    GeometryReader { geometry in
                        RouteSplitBar(split: app.split, height: 6)
                            .frame(
                                width: max(
                                    geometry.size.width
                                        * CGFloat(app.total)
                                        / CGFloat(max(peak, 1)),
                                    2
                                )
                            )
                    }
                    .frame(height: 6)
                }

                HStack(spacing: 10) {
                    Label(activityBytes(app.upload), systemImage: "arrow.up")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Label(activityBytes(app.download), systemImage: "arrow.down")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            .white.opacity(colorScheme == .dark ? 0.05 : 0.5),
            in: RoundedRectangle(cornerRadius: 12)
        )
    }
}

// MARK: - Log Entry Row

private struct LogEntryRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let entry: ConnectionEntry
    var onClose: (() -> Void)?
    @State private var isHovered = false

    // Same palette as RouteTint so the per-connection dots agree with the
    // header split bar and legend on this page.
    private var dotColor: Color {
        switch entry.type {
        case .proxied:  return RouteTint.tunnel
        case .home:     return RouteTint.residential
        case .direct:   return RouteTint.direct
        case .rejected: return RouteTint.blocked
        }
    }

    @ViewBuilder
    private func directionRow(
        symbol: String,
        value: String,
        tint: Color
    ) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(tint)
            Text(value.isEmpty ? "0 B" : value)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.primary)
        }
    }

    private var latencyStyle: (fg: String, bg: String) {
        // Same latency banding as the node cards (LatencyLevel.level(for:)),
        // so a given millisecond count is the same colour app-wide.
        guard let ms = entry.latency else { return ("98989D", "000000") }
        let color = LatencyLevel.level(for: ms, kind: .exit).color
        return (color, color)
    }

    var body: some View {
        HStack(spacing: 0) {
            // Timeline dot
            Circle()
                .fill(.white)
                .frame(width: 10, height: 10)
                .overlay(Circle().strokeBorder(dotColor, lineWidth: 2))
                .shadow(color: dotColor.opacity(0.4), radius: 4)
                .offset(x: -26)

            // Card content
            HStack(spacing: 16) {
                // Client app icon. The process is the identity a user actually
                // recognises — the host is secondary detail.
                ClientAppIcon(processName: entry.processName)

                // Client process + destination host
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        if let processName = entry.processName {
                            Text(processName)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                                .layoutPriority(1)
                            Text(entry.domain)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        } else {
                            Text(entry.domain)
                                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    // Routing policy is deliberately not surfaced here: Tono
                    // decides it and the user never configures it, so naming
                    // the matched rule would only invite questions about
                    // settings that do not exist.
                    Text(
                        [
                            entry.network.isEmpty ? entry.protocolName : entry.network,
                            entry.destination,
                        ]
                        .filter { !$0.isEmpty }
                        .joined(separator: " • ")
                    )
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Node
                HStack(spacing: 6) {
                    Text(entry.nodeFlag)
                        .font(.system(size: 14))
                    Text(ProxyNode.displayName(for: entry.nodeName))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(width: 160, alignment: .leading)
                .help(entry.route.isEmpty ? entry.nodeName : entry.route)

                // Per-flow latency is not in the `/connections` snapshot.
                // A permanent "--" looked like every row had timed out.
                if let ms = entry.latency {
                    Text("\(ms)ms")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color(hex: latencyStyle.fg))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color(hex: latencyStyle.bg).opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                        .frame(width: 80)
                }

                // Stats: two directions, or the combined total when a source
                // has not filled the split counters in.
                VStack(alignment: .trailing, spacing: 2) {
                    if entry.downloadText.isEmpty, entry.uploadText.isEmpty {
                        Text(entry.dataSize)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.primary)
                        Text(entry.dataLabel)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    } else {
                        directionRow(
                            symbol: "arrow.down",
                            value: entry.downloadText,
                            tint: TonoTraffic.download
                        )
                        directionRow(
                            symbol: "arrow.up",
                            value: entry.uploadText,
                            tint: TonoTraffic.upload
                        )
                    }
                }
                .frame(width: 88, alignment: .trailing)

                // Close button
                Button {
                    onClose?()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 24, height: 24)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .opacity(isHovered ? 1 : 0)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
        }
        .background(
            isHovered
                ? .white.opacity(colorScheme == .dark ? 0.15 : 0.9)
                : .white.opacity(colorScheme == .dark ? 0.08 : 0.4),
            in: RoundedRectangle(cornerRadius: 18)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.7), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.15)) {
                isHovered = hovering
            }
        }
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        ActivityView()
    }
    .frame(width: 900, height: 600)
    .environment({
        let state = AppState()
        state.loadMockData()
        return state
    }())
}
