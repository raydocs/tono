import AppKit
import SwiftUI

struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(SeaAppearance.enabledKey, store: AppProfile.defaults)
    private var seaAppearanceEnabled = false
    @Environment(\.seaAppearanceOverride) private var seaAppearanceOverride
    @AppStorage(SeaAppearance.motionKey, store: AppProfile.defaults)
    private var seaMotionMode = "Auto"
    @Namespace private var dashboardNS
    @State private var trafficHistory = TrafficHistory()
    @State private var showsDataUsagePopover = false
    @State private var showsSeaDetails = false
    /// When the pill last flipped into connecting. A click that lands within
    /// `cancelGraceInterval` of that moment is ignored: the pill is now the
    /// Cancel control while connecting, so without this a double-click on
    /// Connect would cancel the attempt and release fail-closed protection.
    @State private var connectingSince: Date?
    private static let cancelGraceInterval: TimeInterval = 1.2
    private var showsSeaAppearance: Bool { seaAppearanceOverride ?? seaAppearanceEnabled }

    var body: some View {
        Group {
            if showsSeaAppearance { seaDashboard } else { legacyDashboard }
        }
        .modifier(SeaPageAppearance())
        .background {
            if showsSeaAppearance {
                SeaScene(phase: seaPhase, motionEnabled: SeaAppearance.animates(
                    seaMotionMode, reduceMotion: reduceMotion
                ))
            }
        }
        .contentShape(Rectangle())
        // Surfaces swap with the critically damped contract spring; the one
        // overshoot in the app belongs to the connected glow, not the layout.
        .animation(TonoMotion.surfaceIn(reduceMotion: reduceMotion), value: appState.isConnected)
        .animation(TonoMotion.surfaceIn(reduceMotion: reduceMotion), value: showsConnectionDetails)
        .onChange(of: appState.isConnecting) { _, connecting in
            connectingSince = connecting ? Date() : nil
        }
        .onChange(of: appState.isConnected) { _, connected in
            if !connected {
                appState.networkInfo = NetworkInfo()
            }
        }
        .onAppear {
            appState.updateIncomplete = UpdateHandoffStore.showsIncompleteUpdate()
        }
    }

    private var legacyDashboard: some View {
        GlassEffectContainer(spacing: 24) {
            VStack(spacing: 0) {
                dashboardHeader

                if appState.updateIncomplete {
                    Text(UpdateHandoffStore.incompleteUpdateCopy)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(TonoStatus.blocked)
                        .multilineTextAlignment(.center)
                        .padding(.top, 12)
                        .accessibilityIdentifier("updateIncompleteNotice")
                }

                // Center: ConnectPill + ActiveNodeCard
                Spacer(minLength: 12)

                VStack(alignment: .center, spacing: 24) {
                    RecoveryNotice(appState: appState)
                        .frame(maxWidth: 520, alignment: .leading)
                    ConnectPill(isConnected: Binding(
                        get: { appState.isConnected },
                        set: { newValue in
                            if appState.isConnecting {
                                // Same path as ConnectionProgressCard's
                                // "Cancel and restore internet" — no extra
                                // confirmation; the card does not confirm.
                                // Ignore the first moments so a double-click
                                // on Connect cannot turn into a cancel.
                                guard let since = connectingSince,
                                      Date().timeIntervalSince(since) >= Self.cancelGraceInterval else {
                                    return
                                }
                                appState.restoreInternet()
                            } else if appState.isProtectionBlocked
                                        || appState.isProtectionUnconfirmed {
                                appState.restoreInternet()
                            } else if newValue {
                                appState.connect()
                            } else {
                                appState.disconnect(releaseKillSwitch: true)
                            }
                        }
                    ), isConnecting: appState.isConnecting,
                       isDisconnecting: appState.isDisconnecting,
                       isProtectionBlocked: appState.isProtectionBlocked
                           && !appState.isProtectionBlockUnreadable,
                       isProtectionUnconfirmed: appState.isProtectionUnconfirmed
                           || appState.isProtectionBlockUnreadable,
                       isRecovering: appState.isRecoveringProtectedConnection,
                       connectionStage: appState.connectionStage,
                       disconnectionStage: appState.disconnectionStage,
                       nodeName: appState.activeNode?.name ?? appState.proxyService.activeNodeName,
                       nodeLatency: (appState.activeNode?.name ?? appState.proxyService.activeNodeName)
                           .map(appState.proxyService.latency(forNodeNamed:)) ?? 0)
                        .glassEffectID("pill", in: dashboardNS)

                    if showsConnectionDetails {
                        ConnectionProgressCard(appState: appState)
                            .glassEffectID("connection-progress", in: dashboardNS)
                            .glassEffectTransition(.materialize)
                            .transition(TonoMotion.surfaceTransition)
                    } else if let nodeName = appState.activeNode?.name ?? appState.proxyService.activeNodeName {
                        let nodeLatency = appState.proxyService.latency(forNodeNamed: nodeName)
                        ActiveNodeCard(
                            nodeName: nodeName,
                            groupName: appState.isConnected ? appState.proxyService.activeGroupName : String(localized: "Ready to connect"),
                            latency: nodeLatency,
                            eyebrow: appState.isConnected ? "ACTIVE SERVER" : "SELECTED SERVER",
                            isConnected: appState.isConnected,
                            isClaudeHomeActive: appState.isClaudeHomeActive,
                            claudeHomeHost: appState.residentialHomeHost,
                            onSwitch: { appState.selectedPage = .proxies }
                        )
                            .glassEffectID("card", in: dashboardNS)
                            .glassEffectTransition(.materialize)
                            .transition(TonoMotion.surfaceTransition)
                    }

                    if !showsConnectionDetails {
                        RouteChoicesView()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .center)

                Spacer(minLength: 12)

                if !showsConnectionDetails {
                    dashboardOverview
                    if appState.isConnected {
                        networkInfoBar
                    }
                }
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var seaStatusKey: String {
        SeaStatusWords.key(kind: MenuBarProtectionStatus(appState).kind, connected: appState.isConnected, protectionBlocked: appState.isProtectionBlocked,
            unknown: appState.isProtectionUnconfirmed || appState.isProtectionBlockUnreadable,
            disconnecting: appState.isDisconnecting)
    }

    private var seaDashboard: some View {
        GeometryReader { geometry in
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: showsConnectionDetails ? 12 : 20) {
                    seaDashboardHeader
                    if appState.updateIncomplete {
                        Text(UpdateHandoffStore.incompleteUpdateCopy)
                            .font(.system(size: 13)).foregroundStyle(SeaTheme.warm)
                            .accessibilityIdentifier("updateIncompleteNotice")
                    }
                    if !showsConnectionDetails {
                        seaConnectionAction
                    }
                    seaLineChip
                    RecoveryNotice(appState: appState)
                        .frame(maxWidth: 520, alignment: .leading)
                    if showsConnectionDetails {
                        ConnectionProgressCard(appState: appState)
                            .frame(maxWidth: 520, alignment: .leading)
                    }
                    Button { showsSeaDetails = true } label: {
                        Label("Details", systemImage: "chevron.up")
                            .font(.system(size: 12)).foregroundStyle(SeaTheme.muted)
                    }
                    .buttonStyle(.plain).accessibilityIdentifier("seaDashboardDetails")
                }
                .foregroundStyle(SeaTheme.text)
                .frame(maxWidth: .infinity, minHeight: max(0, geometry.size.height - (showsConnectionDetails ? 48 : 64)), alignment: .topLeading)
                .padding(showsConnectionDetails ? 24 : 32)
            }
        }
        .environment(\.colorScheme, .dark)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showsSeaDetails) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        SeaPageHeading(title: "Details")
                        Spacer()
                        Button("Close") { showsSeaDetails = false }.keyboardShortcut(.cancelAction)
                    }
                    if let name = appState.activeNode?.name ?? appState.proxyService.activeNodeName {
                        ActiveNodeCard(nodeName: name,
                            groupName: appState.isConnected ? appState.proxyService.activeGroupName : String(localized: "Ready to connect"),
                            latency: appState.proxyService.latency(forNodeNamed: name),
                            eyebrow: appState.isConnected ? "ACTIVE SERVER" : "SELECTED SERVER",
                            isConnected: appState.isConnected, isClaudeHomeActive: appState.isClaudeHomeActive,
                            claudeHomeHost: appState.residentialHomeHost,
                            onSwitch: { showsSeaDetails = false; appState.selectedPage = .proxies })
                    }
                    RouteChoicesView()
                    dashboardOverview
                    if appState.isConnected { networkInfoBar }
                }
                .padding(24).frame(minWidth: 560, maxWidth: 760)
            }
            .frame(minWidth: 560, idealWidth: 640, maxWidth: 760,
                   minHeight: 360, idealHeight: 520, maxHeight: 640)
            .background(SeaSecondaryScene())
            .environment(\.colorScheme, .dark).preferredColorScheme(.dark)
        }
    }

    @ViewBuilder
    private var seaConnectionAction: some View {
        let quiet = appState.isConnected || appState.isConnecting || appState.isDisconnecting
        let title = appState.isDisconnecting ? String(localized: "Disconnecting…")
            : appState.isConnecting ? String(localized: "Cancel connection")
            : (appState.isProtectionUnconfirmed || appState.isProtectionBlockUnreadable) ? String(localized: "Restore internet")
            : appState.isConnected ? String(localized: "Disconnect") : String(localized: "Connect")
        if quiet {
            Button(action: seaToggleConnection) {
                Text(title).font(.system(size: 14, weight: .medium))
                    .foregroundStyle(SeaTheme.text).frame(width: 190, height: 44)
                    .background(.white.opacity(0.08), in: Capsule())
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain).disabled(appState.isDisconnecting)
        } else {
            Button(title, action: seaToggleConnection)
                .buttonStyle(GateProminentButtonStyle()).frame(width: 190)
        }
    }

    private func seaToggleConnection() {
        if appState.isConnecting {
            guard let since = connectingSince,
                  Date().timeIntervalSince(since) >= Self.cancelGraceInterval else { return }
            appState.restoreInternet()
        } else if appState.isProtectionBlocked || appState.isProtectionUnconfirmed || appState.isProtectionBlockUnreadable {
            appState.restoreInternet()
        } else if !appState.isConnected {
            appState.connect()
        } else {
            appState.disconnect(releaseKillSwitch: true)
        }
    }

    private var seaLineChip: some View {
        Button { appState.selectedPage = .proxies } label: {
            HStack(spacing: 8) {
                Circle().fill(seaPhase == .day ? SeaTheme.warm : SeaTheme.cool.opacity(0.60))
                    .frame(width: 6, height: 6).accessibilityHidden(true)
                if let name = appState.activeNode?.name ?? appState.proxyService.activeNodeName {
                    Text(nodeRouteTitle(for: name)).lineLimit(1)
                    let runtime = appState.proxyService.node(named: name)
                    if runtime?.lastTestFailed == true {
                        Text("Timeout").foregroundStyle(SeaTheme.muted)
                    } else if let latency = runtime?.latency, latency > 0 {
                        Text(LatencyLevel.spokenTitle(for: latency, kind: .exit)).foregroundStyle(SeaTheme.muted)
                    }
                } else { Text("No server selected") }
                Image(systemName: "chevron.down").accessibilityHidden(true)
            }
            .font(.system(size: 12)).foregroundStyle(SeaTheme.text)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(.plain).frame(maxWidth: 440, alignment: .leading)
        .accessibilityHint("Choose another route")
    }

    private var seaPhase: SeaPresentationPhase {
        SeaPresentationPhase.resolve(
            status: MenuBarProtectionStatus(appState).kind,
            disconnecting: appState.isDisconnecting,
            failed: appState.lastConnectionFailure != nil
        )
    }

    private var seaDashboardHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LocalizedStringKey(seaStatusKey))
                .font(.system(size: showsConnectionDetails ? 32 : 44, weight: .light)).tracking(-0.7)
                .foregroundStyle(SeaTheme.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(seaSummary)
                .font(.system(size: 14)).foregroundStyle(SeaTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 440, alignment: .leading)
    }

    private var seaSummary: String {
        if appState.isConnecting { return String(localized: "Securing your connection") }
        if appState.isDisconnecting { return String(localized: "Finishing network transition") }
        if appState.isRecoveringProtectedConnection {
            return String(localized: "Recovering protected connection…")
        }
        if MenuBarProtectionStatus(appState).kind == .blocked && !appState.isProtectionBlocked {
            return String(localized: "Connection needs attention")
        }
        if appState.lastConnectionFailure != nil && !appState.isConnected {
            return String(localized: "Connection needs attention")
        }
        return protectionDetail
    }

    private var dashboardHeader: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Dashboard")
                    .font(.system(size: 24, weight: .semibold))

                Text("Reality cloud protection")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            HStack(spacing: 7) {
                Circle()
                    .fill(statusBadgeColor)
                    .frame(width: 7, height: 7)
                    .shadow(color: statusBadgeColor.opacity(0.45), radius: 3)

                Text(statusBadgeTitle)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 7)
            .background(statusBadgeColor.opacity(0.10), in: Capsule())
            .overlay {
                Capsule()
                    .strokeBorder(statusBadgeColor.opacity(0.18), lineWidth: 1)
            }
        }
    }

    private var dashboardOverview: some View {
        HStack(spacing: 10) {
            DashboardStatCard(
                title: "Protection",
                value: protectionValue,
                detail: protectionDetail,
                systemImage: appState.isConnected ? "checkmark.shield.fill" : "shield",
                tint: appState.isConnected ? TonoStatus.positive : TonoStatus.neutral
            )

            DashboardStatCard(
                title: "Server pool",
                value: serverPoolValue,
                detail: serverPoolDetail,
                systemImage: "globe",
                tint: Color(hex: "32ADE6")
            )

            Button {
                showsDataUsagePopover.toggle()
            } label: {
                DashboardStatCard(
                    title: "Live traffic",
                    value: trafficSummaryValue,
                    detail: trafficSummaryDetail,
                    systemImage: "waveform.path.ecg",
                    tint: showsSeaAppearance ? SeaTheme.cool : Color(hex: "5856D6")
                )
            }
            .buttonStyle(.plain)
            .popover(isPresented: $showsDataUsagePopover, arrowEdge: .top) {
                DataUsageSummaryView(appState: appState, isCard: false)
                    .padding(16)
                    .frame(width: 320)
            }
            .help("View data usage summary")
        }
    }

    private var statusBadgeTitle: LocalizedStringKey {
        if appState.isConnecting { return "Connecting" }
        if appState.isDisconnecting { return "Disconnecting" }
        if appState.isProtectionBlockUnreadable { return "Protection unknown" }
        if appState.isProtectionBlocked { return "Protected offline" }
        if appState.isProtectionUnconfirmed { return "Protection unknown" }
        if isDegradedWhileConnected { return "Protected — exit degraded" }
        return appState.isConnected ? "Protected" : "Standby"
    }

    private var statusBadgeColor: Color {
        if appState.isConnecting || appState.isDisconnecting { return TonoBrand.accent }
        if appState.isProtectionBlocked || appState.isProtectionUnconfirmed {
            return TonoStatus.blocked
        }
        if isDegradedWhileConnected { return TonoStatus.blocked }
        return appState.isConnected ? TonoStatus.positive : TonoStatus.neutral
    }

    /// The health loop marks a degraded exit on its first failed probe, well
    /// before the second failure triggers failover. Only the menu bar used to
    /// show it, so the main window stayed green while traffic was stalling.
    private var isDegradedWhileConnected: Bool {
        appState.isConnected
            && appState.isProxyDegraded
            && !appState.isConnecting
            && !appState.isDisconnecting
    }

    private var protectionValue: String {
        if appState.isConnecting { return String(localized: "Connecting") }
        if appState.isDisconnecting { return String(localized: "Finishing") }
        if appState.isProtectionBlockUnreadable { return String(localized: "Unknown") }
        if appState.isProtectionBlocked { return String(localized: "Offline") }
        if appState.isProtectionUnconfirmed { return String(localized: "Unknown") }
        if isDegradedWhileConnected { return String(localized: "Degraded") }
        return appState.isConnected
            ? String(localized: "Protected")
            : String(localized: "Standby")
    }

    private var protectionDetail: String {
        if appState.isProtectionBlockUnreadable {
            return String(localized: "Direct traffic may be blocked")
        }
        if appState.isProtectionBlocked {
            return String(localized: "Direct traffic blocked")
        }
        if appState.isProtectionUnconfirmed {
            return String(localized: "Direct traffic may be blocked")
        }
        if isDegradedWhileConnected {
            return String(localized: "Exit not responding — checking")
        }
        if appState.isConnected { return String(localized: "Traffic is routed") }
        return String(localized: "Ready to connect")
    }

    private var serverPoolValue: String {
        let count = appState.managedCatalogNodeCount
        return count > 0
            ? String(localized: "\(count) exits")
            : String(localized: "Loading")
    }

    private var serverPoolDetail: String {
        appState.managedCatalogNodeCount > 0
            ? String(localized: "Verified catalog")
            : String(localized: "Refreshing catalog")
    }

    private var trafficSummaryValue: String {
        guard appState.isConnected else { return String(localized: "Idle") }
        if !appState.trafficFeedLive {
            return String(localized: "Reading traffic…")
        }
        let speed = max(appState.trafficStats.uploadSpeed, appState.trafficStats.downloadSpeed)
        return speed > 0 ? formatSpeed(speed) : String(localized: "Connected")
    }

    private var trafficSummaryDetail: String {
        guard appState.isConnected else { return String(localized: "No active route") }
        if !appState.trafficFeedLive {
            return String(localized: "Dashboard has not reached the core yet — retrying")
        }
        return String(localized: "\(appState.trafficStats.activeConnections) active")
    }

    private var showsConnectionDetails: Bool {
        appState.isConnecting
            || appState.isDisconnecting
            || appState.isProtectionBlocked
            || appState.lastConnectionFailure != nil
    }


    // MARK: - Network Info Bar

    private var networkInfoBar: some View {
        HStack(spacing: 14) {
            infoItem(label: "IP", value: appState.networkInfo.ip)
            infoItem(label: "Network", value: appState.networkInfo.org)
            infoItem(label: "Location", value: locationDisplayValue)
            infoItem(label: "DNS", value: ProtectedDNSContract.server)
                .help(
                    "System DNS: \(ProtectedDNSContract.server) · "
                        + "Upstream: 1.1.1.1 / 8.8.8.8 DoH via the protected exit"
                )
            // The residential lane carries the assistant traffic (Claude,
            // ChatGPT, Grok). Whenever the cloud has assigned one, keep its
            // address visible — the customer paid for that line to exist.
            if let homeHost = appState.residentialHomeHost {
                HStack(alignment: .top, spacing: 5) {
                    Image(systemName: "wifi")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Color(hex: "BF5AF2"))
                        .padding(.top, 1)
                    infoItem(label: "Home line", value: homeHost)
                }
                .help("Claude, ChatGPT and Grok egress through this residential line.")
            }

            Spacer(minLength: 8)

            // Keep the sparkline and rates at intrinsic width. The four info
            // columns share leftover space; without this priority the rates
            // wrap to one glyph per line in a ~700pt content column.
            HStack(spacing: 10) {
                TrafficSparkline(
                    history: trafficHistory,
                    isLive: appState.isConnected && appState.trafficFeedLive
                )

                VStack(alignment: .trailing, spacing: 2) {
                    speedReadout(
                        systemImage: "arrow.up",
                        speed: appState.trafficStats.uploadSpeed
                    )
                    speedReadout(
                        systemImage: "arrow.down",
                        speed: appState.trafficStats.downloadSpeed
                    )
                }
                .fixedSize()
            }
            .layoutPriority(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        // Same width and glass as the stat cards above — the bar is part of
        // the same bottom cluster, not a separate patch.
        .background(
            .white.opacity(colorScheme == .dark ? 0.05 : 0.5),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    .white.opacity(colorScheme == .dark ? 0.10 : 0.7),
                    lineWidth: 0.5
                )
        }
        .padding(.top, 10)
        .task {
            // AppState publishes only the newest reading, so sample on a fixed
            // cadence: an idle stretch is as meaningful to the series as a spike.
            while !Task.isCancelled {
                // Only plot readings the feed actually delivered. Sampling
                // while it is down drew a flat zero line that looks like a
                // measured idle stretch.
                if appState.trafficFeedLive {
                    trafficHistory.record(
                        up: appState.trafficStats.uploadSpeed,
                        down: appState.trafficStats.downloadSpeed
                    )
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private var locationDisplayValue: String {
        let loc = appState.networkInfo.location
        guard loc != "--" && !loc.isEmpty else { return "--" }
        let candidate = loc.split(separator: ",").last?
            .trimmingCharacters(in: .whitespaces) ?? loc
        if let flag = UnicodeCountryFlag.emoji(for: candidate) {
            return "\(flag) \(loc)"
        }
        return loc
    }

    private func infoItem(label: LocalizedStringKey, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.tertiary)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
    }

    private func speedReadout(systemImage: String, speed: Int64) -> some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(.system(size: 9, weight: .bold))
            Text(formatSpeed(speed))
                .font(.system(size: 11, design: .monospaced))
        }
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }

    private func formatSpeed(_ bytesPerSec: Int64) -> String {
        TonoByteFormat.rate(bytesPerSec)
    }
}

private struct ConnectionProgressCard: View {
    @SeaAppearancePreference private var seaAppearance
    @Bindable var appState: AppState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: .leading, spacing: 12) {
                header(now: context.date)

                if appState.isConnecting {
                    stageDots
                }

                if !highlightedStages.isEmpty {
                    Divider().opacity(0.45)

                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(highlightedStages, id: \.self) { stage in
                            stageRow(stage)
                        }
                    }
                }

                if !appState.isConnecting,
                   !appState.isDisconnecting,
                   let failure = appState.lastConnectionFailure {
                    failureBlock(failure)
                }

                actionRow
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: 520, alignment: .leading)
            .glassEffect(
                .regular.tint(cardTint),
                in: RoundedRectangle(cornerRadius: 18)
            )
            // A failure shifts the tint over 220 ms; it does not snap or shake.
            .animation(
                TonoMotion.stateChange(reduceMotion: reduceMotion),
                value: appState.lastConnectionFailure != nil
            )
        }
    }

    /// One dot per known stage, in order. Discrete on purpose: the stages
    /// take wildly different times, so a time-based bar would leap and stall.
    private var stageDots: some View {
        HStack(spacing: 6) {
            ForEach(ConnectionStage.allCases, id: \.self) { stage in
                Circle()
                    .fill(dotColor(stage))
                    .frame(width: 6, height: 6)
            }
        }
        .padding(.leading, 43)
        .accessibilityHidden(true)
        .animation(
            TonoMotion.stateChange(reduceMotion: reduceMotion),
            value: appState.connectionStage
        )
    }

    private func dotColor(_ stage: ConnectionStage) -> Color {
        if appState.completedConnectionStages.contains(stage) { return seaAppearance ? SeaTheme.cool : TonoBrand.accent }
        if stage == appState.connectionStage { return (seaAppearance ? SeaTheme.cool : TonoBrand.accent).opacity(0.55) }
        if appState.lastConnectionFailure?.stage == stage { return TonoStatus.blocked }
        return Color.secondary.opacity(0.35)
    }

    /// Current and failed steps only — listing every pending stage pushes
    /// Restore internet below the fold on the one screen that needs it.
    private var highlightedStages: [ConnectionStage] {
        ConnectionStage.allCases.filter { stage in
            (appState.isConnecting && stage == appState.connectionStage)
                || appState.lastConnectionFailure?.stage == stage
        }
    }

    private var cardTint: Color {
        if appState.lastConnectionFailure != nil, !appState.isConnecting {
            return .orange.opacity(0.08)
        }
        return (seaAppearance ? SeaTheme.cool : TonoBrand.accent).opacity(0.06)
    }

    @ViewBuilder
    private func header(now: Date) -> some View {
        HStack(alignment: .top, spacing: 11) {
            ZStack {
                Circle()
                    .fill(headerColor.opacity(0.14))
                    .frame(width: 32, height: 32)

                if appState.isConnecting || appState.isDisconnecting {
                    ProgressView()
                        .controlSize(.small)
                        .tint(headerColor)
                } else {
                    Image(systemName: "exclamationmark.shield.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(headerColor)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(headerTitle)
                    .font(.system(size: 13, weight: .semibold))

                if appState.isConnecting {
                    ZStack(alignment: .leading) {
                        Text(LocalizedStringKey(appState.connectionStage.rawValue))
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .id(appState.connectionStage)
                            .transition(TonoMotion.textSwapTransition)
                    }
                    .animation(
                        TonoMotion.textSwap(reduceMotion: reduceMotion),
                        value: appState.connectionStage
                    )
                } else if appState.isDisconnecting {
                    Text(LocalizedStringKey(appState.disconnectionStage.rawValue))
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                } else if let nextAttempt = appState.protectedReconnectNextAttemptAt {
                    Text("Retry \(appState.protectedReconnectAttempt) in \(seconds(until: nextAttempt, now: now))s")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                } else if let failure = appState.lastConnectionFailure {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 4) {
                            Text("Failed at")
                            Text(LocalizedStringKey(failure.stage.rawValue))
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        if !appState.isProtectionBlocked {
                            Text("Direct internet is available. Support code TONO_CONNECT_RELEASED.")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                } else {
                    Text("Direct traffic remains blocked while Tono waits to retry.")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 8)

            if let startedAt = activeStartedAt {
                VStack(alignment: .trailing, spacing: 3) {
                    Text("TOTAL \(elapsedSeconds(since: startedAt, now: now))s")
                    if appState.isConnecting,
                       let stageStartedAt = appState.connectionStageStartedAt {
                        Text("STEP \(elapsedSeconds(since: stageStartedAt, now: now))s")
                    }
                }
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
            } else if appState.protectedReconnectAttempt > 0 {
                Text("TRY \(appState.protectedReconnectAttempt)")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(headerColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(headerColor.opacity(0.10), in: Capsule())
            }
        }
    }

    private var headerTitle: LocalizedStringKey {
        if appState.isConnecting {
            return appState.protectedReconnectAttempt > 0
                ? "Reconnecting securely"
                : "Securing your connection"
        }
        if appState.isDisconnecting { return "Finishing network transition" }
        if appState.isProtectedReconnectScheduled { return "Connection interrupted — retrying" }
        return "Connection needs attention"
    }

    private var headerColor: Color {
        appState.lastConnectionFailure != nil && !appState.isConnecting
            ? .orange
            : (seaAppearance ? SeaTheme.cool : TonoBrand.accent)
    }

    private var activeStartedAt: Date? {
        if appState.isConnecting { return appState.connectionStartedAt }
        if appState.isDisconnecting { return appState.disconnectionStartedAt }
        return nil
    }

    private func stageRow(_ stage: ConnectionStage) -> some View {
        HStack(spacing: 7) {
            stageIcon(stage)
                .frame(width: 14, height: 14)

            Text(LocalizedStringKey(stage.rawValue))
                .font(.system(size: 10.5, weight: stage == appState.connectionStage && appState.isConnecting ? .semibold : .regular))
                .foregroundStyle(stageTextColor(stage))
                .lineLimit(1)
                .minimumScaleFactor(0.76)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func stageIcon(_ stage: ConnectionStage) -> some View {
        if appState.isConnecting, stage == appState.connectionStage {
            ProgressView()
                .controlSize(.mini)
                .scaleEffect(0.72)
        } else if appState.completedConnectionStages.contains(stage) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(TonoStatus.connected)
        } else if !appState.isConnecting,
                  appState.lastConnectionFailure?.stage == stage {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(.orange)
        } else {
            Image(systemName: "circle")
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
        }
    }

    private func stageTextColor(_ stage: ConnectionStage) -> Color {
        if appState.isConnecting, stage == appState.connectionStage { return .primary }
        if appState.completedConnectionStages.contains(stage) { return .secondary }
        if appState.lastConnectionFailure?.stage == stage { return .orange }
        return .secondary.opacity(0.65)
    }

    private func failureBlock(_ failure: ConnectionFailure) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text("What failed")
                    .font(.system(size: 11, weight: .semibold))
            }

            Text(failure.message)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private var actionRow: some View {
        HStack(spacing: 10) {
            if appState.isConnecting {
                Button("Cancel and restore internet") {
                    appState.restoreInternet()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            } else if appState.isProtectionBlocked {
                Button(appState.protectedReconnectPausedForUserAction
                    ? "Repair and reconnect"
                    : "Retry now") {
                    appState.retryProtectedConnectionNow()
                }
                .buttonStyle(GateProminentButtonStyle())
                .controlSize(.small)
                .disabled(!appState.isTonoReady || appState.isDisconnecting)

                Button("Restore internet") {
                    appState.restoreInternet()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                if appState.shouldOfferManualBackupChannel() {
                    Button("Try backup channel") {
                        appState.tryBackupChannelManually()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            } else if ReleasedConnectFailureActions.shouldOfferRetryAndRoute(
                protectionBlocked: appState.isProtectionBlocked,
                connecting: appState.isConnecting,
                disconnecting: appState.isDisconnecting,
                hasFailureRecord: appState.lastConnectionFailure != nil
            ) {
                Button("Retry now") {
                    appState.connect()
                }
                .buttonStyle(GateProminentButtonStyle())
                .controlSize(.small)
                .disabled(!appState.isTonoReady || appState.isDisconnecting)

                Button("Choose another route") {
                    appState.selectedPage = .proxies
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                if appState.shouldOfferManualBackupChannel() {
                    Button("Try backup channel") {
                        appState.tryBackupChannelManually()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            } else if appState.shouldOfferManualBackupChannel() {
                Button("Try backup channel") {
                    appState.tryBackupChannelManually()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            Spacer()

            if let failure = appState.lastConnectionFailure {
                Button {
                    copyFailure(failure)
                } label: {
                    Label("Copy details", systemImage: "doc.on.doc")
                }
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
            }
        }
    }

    private func elapsedSeconds(since date: Date, now: Date) -> Int {
        max(0, Int(now.timeIntervalSince(date)))
    }

    private func seconds(until date: Date, now: Date) -> Int {
        max(0, Int(ceil(date.timeIntervalSince(now))))
    }

    private func copyFailure(_ failure: ConnectionFailure) {
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
            ?? "unknown"
        let server = appState.activeNode?.name
            ?? appState.proxyService.activeNodeName
            ?? "unknown"
        let classified = appState.lastClassifiedFailure
        let code = classified?.code.rawValue ?? "none"
        let stage = classified?.stage ?? failure.stage.rawValue
        let classifiedDetail = classified?.copyableDetail ?? "none"
        let summary = """
        Tono connection report
        Build: \(build)
        Server: \(server)
        Code: \(code)
        Stage: \(stage)
        Failed step: \(failure.stage.rawValue)
        Error: \(failure.message)
        Classified: \(classifiedDetail)
        Retry attempt: \(appState.protectedReconnectAttempt)
        Kill Switch: \(KillSwitchService.isArmed ? "active" : "inactive")
        Recovery command (last resort, restores normal internet):
        sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-reset
        """
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(summary, forType: .string)
        NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .default)
        ToastCenter.shared.show(String(localized: "Copied"), systemImage: "doc.on.doc.fill")
    }
}

private struct DashboardStatCard: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: LocalizedStringKey
    let value: String
    let detail: String
    let systemImage: String
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                Text(value)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)

                Text(detail)
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }

            Spacer(minLength: 0)
        }
        .padding(11)
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        // One neutral glass for all three cards: the status color lives only
        // in the icon chip. Tinted glass side by side read as mismatched
        // patches, and adjacent Liquid Glass shapes render merge bridges.
        .background(
            .white.opacity(colorScheme == .dark ? 0.05 : 0.5),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    .white.opacity(colorScheme == .dark ? 0.10 : 0.7),
                    lineWidth: 0.5
                )
        }
    }
}

// MARK: - Previews

#Preview("Disconnected") {
    ZStack {
        MeshGradientBackground()
        DashboardView()
    }
    .frame(width: 680, height: 600)
    .environment(AppState())
}

#Preview("Connected") {
    ZStack {
        MeshGradientBackground()
        DashboardView()
    }
    .frame(width: 680, height: 600)
    .environment({
        let state = AppState()
        state.isConnected = true
        state.networkInfo = NetworkInfo(
            ip: "192.0.2.1",
            org: "NTT America, Inc.",
            location: "US"
        )
        return state
    }())
}
