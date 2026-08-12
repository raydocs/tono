import AppKit
import SwiftUI

struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @Namespace private var dashboardNS
    @State private var trafficHistory = TrafficHistory()

    var body: some View {
        @Bindable var appState = appState

        GlassEffectContainer(spacing: 24) {
            VStack(spacing: 0) {
                dashboardHeader

                // Center: ConnectPill + ActiveNodeCard
                Spacer(minLength: 12)

                VStack(spacing: 24) {
                    ConnectPill(isConnected: Binding(
                        get: { appState.isConnected },
                        set: { newValue in
                            if appState.isConnecting {
                                // ConnectPill is disabled during transitions;
                                // cancellation lives on the explicitly labeled
                                // action below so a retry click cannot disarm PF.
                            } else if appState.isProtectionBlocked {
                                appState.disconnect(releaseKillSwitch: true)
                            } else if newValue {
                                appState.connect()
                            } else {
                                appState.disconnect(releaseKillSwitch: true)
                            }
                        }
                    ), isConnecting: appState.isConnecting,
                       isDisconnecting: appState.isDisconnecting,
                       isProtectionBlocked: appState.isProtectionBlocked,
                       connectionStage: appState.connectionStage,
                       disconnectionStage: appState.disconnectionStage)
                        .glassEffectID("pill", in: dashboardNS)

                    if showsConnectionDetails {
                        ConnectionProgressCard(appState: appState)
                            .glassEffectID("connection-progress", in: dashboardNS)
                            .glassEffectTransition(.materialize)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    } else if let nodeName = appState.activeNode?.name ?? appState.proxyService.activeNodeName {
                        let nodeLatency = appState.proxyService.nodes.first(where: { $0.name == nodeName })?.latency ?? 0
                        ActiveNodeCard(
                            nodeName: nodeName,
                            groupName: appState.isConnected ? appState.proxyService.activeGroupName : String(localized: "Ready to connect"),
                            latency: nodeLatency,
                            eyebrow: appState.isConnected ? "ACTIVE SERVER" : "SELECTED SERVER",
                            onSwitch: { appState.selectedPage = .proxies }
                        )
                            .glassEffectID("card", in: dashboardNS)
                            .glassEffectTransition(.materialize)
                            .transition(.opacity)
                    }

                }

                Spacer(minLength: 12)

                dashboardOverview

                // Network info bar (when connected)
                if appState.isConnected {
                    networkInfoBar
                }
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .contentShape(Rectangle())
        .animation(.spring(duration: 0.5, bounce: 0.15), value: appState.isConnected)
        .onChange(of: appState.isConnected) { _, connected in
            if !connected {
                appState.networkInfo = NetworkInfo()
            }
        }
    }

    private var dashboardHeader: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Dashboard")
                    .font(.system(size: 27, weight: .bold))

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
                tint: appState.isConnected ? Color(hex: "30D158") : Color(hex: "8E8E93")
            )

            DashboardStatCard(
                title: "Server pool",
                value: serverPoolValue,
                detail: serverPoolDetail,
                systemImage: "globe",
                tint: Color(hex: "32ADE6")
            )

            DashboardStatCard(
                title: "Live traffic",
                value: trafficSummaryValue,
                detail: trafficSummaryDetail,
                systemImage: "waveform.path.ecg",
                tint: Color(hex: "5856D6")
            )
        }
    }

    private var statusBadgeTitle: LocalizedStringKey {
        if appState.isConnecting { return "Connecting" }
        if appState.isDisconnecting { return "Disconnecting" }
        if appState.isProtectionBlocked { return "Protected offline" }
        if isDegradedWhileConnected { return "Protected — exit degraded" }
        return appState.isConnected ? "Protected" : "Standby"
    }

    private var statusBadgeColor: Color {
        if appState.isConnecting || appState.isDisconnecting { return Color(hex: "B29500") }
        if appState.isProtectionBlocked { return Color(hex: "FF9F0A") }
        if isDegradedWhileConnected { return Color(hex: "FF9F0A") }
        return appState.isConnected ? Color(hex: "30D158") : Color(hex: "8E8E93")
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
        if appState.isProtectionBlocked { return String(localized: "Offline") }
        if isDegradedWhileConnected { return String(localized: "Degraded") }
        return appState.isConnected
            ? String(localized: "Protected")
            : String(localized: "Standby")
    }

    private var protectionDetail: String {
        if appState.isProtectionBlocked {
            return String(localized: "Direct traffic blocked")
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
        let speed = max(appState.trafficStats.uploadSpeed, appState.trafficStats.downloadSpeed)
        return speed > 0 ? formatSpeed(speed) : String(localized: "Connected")
    }

    private var trafficSummaryDetail: String {
        guard appState.isConnected else { return String(localized: "No active route") }
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
        HStack(spacing: 24) {
            infoItem(label: "IP", value: appState.networkInfo.ip)
            infoItem(label: "ASN Type", value: appState.networkInfo.asType)
            infoItem(label: "City", value: appState.networkInfo.city)
            infoItem(label: "DNS", value: ProtectedDNSContract.server)
                .help(
                    "System DNS: \(ProtectedDNSContract.server) · "
                        + "Upstream: 1.1.1.1 / 8.8.8.8 DoH via the protected exit"
                )

            Spacer()

            // Traffic stats
            HStack(spacing: 16) {
                TrafficSparkline(
                    history: trafficHistory,
                    isLive: appState.isConnected
                )

                HStack(spacing: 4) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.secondary)
                    Text(formatSpeed(appState.trafficStats.uploadSpeed))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 4) {
                    Image(systemName: "arrow.down")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.secondary)
                    Text(formatSpeed(appState.trafficStats.downloadSpeed))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .task {
            // AppState publishes only the newest reading, so sample on a fixed
            // cadence: an idle stretch is as meaningful to the series as a spike.
            while !Task.isCancelled {
                trafficHistory.record(
                    up: appState.trafficStats.uploadSpeed,
                    down: appState.trafficStats.downloadSpeed
                )
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func infoItem(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.tertiary)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private func formatSpeed(_ bytesPerSec: Int64) -> String {
        let kb = Double(bytesPerSec) / 1024
        if kb < 1024 { return String(format: "%.1f KB/s", kb) }
        let mb = kb / 1024
        return String(format: "%.1f MB/s", mb)
    }
}

private struct ConnectionProgressCard: View {
    @Bindable var appState: AppState

    private let columns = [
        GridItem(.flexible(), spacing: 12, alignment: .leading),
        GridItem(.flexible(), spacing: 12, alignment: .leading),
    ]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: .leading, spacing: 12) {
                header(now: context.date)

                if appState.isConnecting || appState.lastConnectionFailure != nil {
                    Divider().opacity(0.45)

                    LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                        ForEach(ConnectionStage.allCases, id: \.self) { stage in
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
        }
    }

    private var cardTint: Color {
        if appState.lastConnectionFailure != nil, !appState.isConnecting {
            return .orange.opacity(0.08)
        }
        return Color(hex: "4B6EFF").opacity(0.06)
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
                    Text(LocalizedStringKey(appState.connectionStage.rawValue))
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                } else if appState.isDisconnecting {
                    Text(LocalizedStringKey(appState.disconnectionStage.rawValue))
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                } else if let nextAttempt = appState.protectedReconnectNextAttemptAt {
                    Text("Retry \(appState.protectedReconnectAttempt) in \(seconds(until: nextAttempt, now: now))s")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                } else if let failure = appState.lastConnectionFailure {
                    HStack(spacing: 4) {
                        Text("Failed at")
                        Text(LocalizedStringKey(failure.stage.rawValue))
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
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
            : Color(hex: "FFD60A")
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
                .foregroundStyle(Color(hex: "2ED573"))
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
                    appState.disconnect(releaseKillSwitch: true)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            } else if appState.isProtectionBlocked, !appState.isDisconnecting {
                Button(appState.protectedReconnectPausedForUserAction
                    ? "Repair and reconnect"
                    : "Retry now") {
                    appState.retryProtectedConnectionNow()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!appState.isTonoReady)

                Button("Restore internet") {
                    appState.disconnect(releaseKillSwitch: true)
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
        let summary = """
        Tono connection report
        Build: \(build)
        Server: \(server)
        Failed step: \(failure.stage.rawValue)
        Error: \(failure.message)
        Retry attempt: \(appState.protectedReconnectAttempt)
        Kill Switch: \(KillSwitchService.isArmed ? "active" : "inactive")
        Recovery command (last resort, restores normal internet):
        sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-reset
        """
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(summary, forType: .string)
    }
}

private struct DashboardStatCard: View {
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
        .glassEffect(
            .regular.tint(tint.opacity(0.045)),
            in: RoundedRectangle(cornerRadius: 14)
        )
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
        state.networkInfo = NetworkInfo(ip: "192.0.2.1", asType: "ISP", city: "Tokyo, JP")
        return state
    }())
}
