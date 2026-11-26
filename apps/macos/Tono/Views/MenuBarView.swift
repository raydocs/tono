import AppKit
import SwiftUI

/// Menu bar extra: state, current node, one safe action, Open Tono, Quit.
/// Not a second dashboard — no TUN toggle, IP, DNS, or node list.
struct MenuBarView: View {
    @SeaAppearancePreference private var seaAppearance
    static let popoverWidth: CGFloat = 300

    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var accountSession
    @Environment(\.openWindow) private var openWindow
    @SeaDisplayPreferences private var displayPreferences
    private var reduceMotion: Bool { displayPreferences.reduceMotion }
    @State private var routeProposal: RouteRecommendation?
    @State private var showingRouteConfirmation = false
    @State private var staleRouteProposal = false
    /// Measured content height: the panel is as tall as what it shows, and
    /// scrolls only past the screen-bounded maximum.
    @State private var contentHeight: CGFloat = 0

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                header
                currentNode
                RecoveryNotice(appState: appState)
                    .padding(.horizontal, 16)
                    .padding(.bottom, appState.recoveryFeedback == nil ? 0 : 10)
                primaryAction
                if appState.isProtectionBlocked || appState.isProtectionUnconfirmed
                    || (KillSwitchService.isArmed && accountSession.state != .ready) {
                    restoreAction
                }
                if seaAppearance {
                    seaQuickRoutes
                    seaFooter
                } else {
                    menuDivider
                    openTonoButton
                    quitButton
                }
            }
            .padding(.bottom, 8)
            .frame(width: Self.popoverWidth)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .frame(width: Self.popoverWidth)
        .frame(height: contentHeight > 0 ? min(contentHeight, maximumPopoverHeight) : nil)
        .frame(maxHeight: maximumPopoverHeight)
        .background {
            if seaAppearance { SeaSecondaryScene() }
        }
        .modifier(SeaPageAppearance())
        .environment(\.seaAccent, seaPhase == .day ? SeaTheme.warm : SeaTheme.cool)
        .confirmationDialog(String(localized: "Connect using this route?"), isPresented: $showingRouteConfirmation, titleVisibility: .visible) {
            Button("Connect") {
                guard let routeProposal, routeProposal.owner == accountSession.user?.id,
                      canAct else { staleRouteProposal = true; return }
                staleRouteProposal = !appState.confirmRouteRecommendation(routeProposal)
                self.routeProposal = nil
            }
            Button("Cancel", role: .cancel) { routeProposal = nil }
        } message: {
            if let routeProposal {
                Text(nodeRouteTitle(for: routeProposal.name))
                Text("This starts a connection only after confirmation. It never switches an already connected exit.")
            }
        }
    }

    static func clampedPopoverHeight(for screenHeight: CGFloat) -> CGFloat {
        let available = max(120, screenHeight - 80)
        return min(available, 480)
    }

    private var maximumPopoverHeight: CGFloat {
        let mouseLocation = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { NSMouseInRect(mouseLocation, $0.frame, false) })
            ?? NSScreen.main
        let screenHeight = screen?.visibleFrame.height ?? 600
        return Self.clampedPopoverHeight(for: screenHeight)
    }

    private var status: MenuBarProtectionStatus {
        MenuBarProtectionStatus(appState)
    }

    private var seaPhase: SeaPresentationPhase {
        SeaPresentationPhase.resolve(status: status.kind, disconnecting: appState.isDisconnecting,
                                     failed: appState.lastConnectionFailure != nil)
    }

    private var statusDot: some View {
        Circle()
            .fill(status.color)
            .frame(width: 8, height: 8)
            .shadow(color: appState.isConnected ? TonoStatus.connected.opacity(0.6) : .clear, radius: 3)
    }

    private var header: some View {
        HStack(alignment: seaAppearance ? .firstTextBaseline : .center, spacing: 10) {
            if !seaAppearance { statusDot }
            VStack(alignment: .leading, spacing: 1) {
                if !seaAppearance {
                    Text("Tono").font(.system(size: 13, weight: .semibold))
                }
                Text(seaAppearance ? LocalizedStringKey(SeaStatusWords.key(kind: status.kind, connected: appState.isConnected, protectionBlocked: appState.isProtectionBlocked,
                    unknown: appState.isProtectionUnconfirmed || appState.isProtectionBlockUnreadable,
                    disconnecting: appState.isDisconnecting)) : status.title)
                    .font(.system(size: seaAppearance ? 20 : 11, weight: seaAppearance ? .medium : .regular))
                    .foregroundStyle(seaAppearance ? SeaTheme.text : .secondary)
                    .lineLimit(seaAppearance ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                if seaAppearance, status.kind == .degraded {
                    Text(appState.isRecoveringProtectedConnection
                         ? String(localized: "Recovering protected connection…")
                         : String(localized: "Exit not responding — checking"))
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(SeaTheme.attention)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            if seaAppearance { SeaStatusMark(phase: seaPhase).alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 7 } }
        }
        .padding(.horizontal, 16)
        .padding(.top, seaAppearance ? 16 : 12)
        .padding(.bottom, 10)
    }

    @ViewBuilder
    private var currentNode: some View {
        if seaAppearance {
            VStack(alignment: .leading, spacing: 6) {
                if appState.switchingNodeId != nil {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.mini)
                        Text("Switching server…")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(SeaTheme.cool)
                            .lineLimit(1)
                    }
                } else {
                    let activeName = appState.activeNode?.name ?? appState.proxyService.activeNodeName ?? ""
                    HStack(spacing: 8) {
                        if !activeName.isEmpty {
                            let cleanCity = nodeCityParts(ProxyNode.displayName(for: ConfigParser.extractFlag(from: activeName).cleanName)).city
                            NodeRouteMark(size: 20, city: cleanCity, gradient: SeaTheme.primaryGradient, warmTile: true)
                        }
                        Text(seaNodeLabel)
                            .font(.system(size: 13, weight: activeName.isEmpty ? .regular : .medium))
                            .foregroundStyle(activeName.isEmpty ? SeaTheme.muted : SeaTheme.text)
                            .lineLimit(1)
                    }
                }
                if appState.isConnected, appState.trafficFeedLive || appState.isClaudeHomeActive {
                    HStack(spacing: 6) {
                        if appState.trafficFeedLive {
                            Text(verbatim: "↓ \(TonoByteFormat.bytes(appState.trafficStats.downloadSpeed))/s · ↑ \(TonoByteFormat.bytes(appState.trafficStats.uploadSpeed))/s")
                                .monospacedDigit()
                        }
                        if appState.isClaudeHomeActive {
                            if appState.trafficFeedLive { Text(verbatim: "·") }
                            Text("Claude AI").foregroundStyle(SeaTheme.good)
                        }
                    }
                    .font(.system(size: 12)).foregroundStyle(SeaTheme.tertiary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                displayPreferences.reduceTransparency ? SeaTheme.opaqueQuiet : .white.opacity(0.055),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        SeaTheme.specularBorder(contrast: displayPreferences.contrast, reduceTransparency: displayPreferences.reduceTransparency, topOpacity: 0.14, bottomOpacity: 0.04),
                        lineWidth: displayPreferences.contrast == .increased ? 1 : 0.65
                    )
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        } else {
            legacyCurrentNode
        }
    }

    /// The line's name as Home shows it: no flag, no region code.
    private var seaNodeLabel: String {
        let name = appState.activeNode?.name ?? appState.proxyService.activeNodeName ?? ""
        guard !name.isEmpty else { return String(localized: "No server selected") }
        return nodeRouteTitle(for: name)
    }

    private var legacyCurrentNode: some View {
        HStack(spacing: 6) {
            Text(nodeLabel)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if appState.isClaudeHomeActive {
                Circle()
                    .fill(TonoStatus.connected)
                    .frame(width: 5, height: 5)
                Text("Claude AI")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(TonoStatus.connected)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private var nodeLabel: String {
        let name = appState.activeNode?.name ?? appState.proxyService.activeNodeName ?? ""
        guard !name.isEmpty else { return String(localized: "No server selected") }
        let (flag, clean) = ConfigParser.extractFlag(from: name)
        let region = nodeRegionCode(flag: flag, name: clean)
        let flagEmoji = UnicodeCountryFlag.emoji(for: region)
        let prefix = flagEmoji.map { "\($0) " } ?? ""
        return "\(prefix)\(nodeRouteTitle(for: name)) · \(region)"
    }

    private var busy: Bool {
        appState.isConnecting || appState.isDisconnecting
    }

    private var canAct: Bool {
        accountSession.state == .ready && appState.isTonoReady && !busy
    }

    @ViewBuilder
    private var primaryAction: some View {
        if appState.isProtectionBlocked, accountSession.state == .ready {
            VStack(spacing: 0) {
                actionButton(
                    title: appState.protectedReconnectPausedForUserAction
                        ? "Repair and reconnect"
                        : "Retry now",
                    prominent: true
                ) {
                    appState.retryProtectedConnectionNow()
                }
                .disabled(!canAct)
                if appState.shouldOfferManualBackupChannel() {
                    actionButton(title: "Try backup channel", prominent: true, seaVariant: .quiet) {
                        appState.tryBackupChannelManually()
                    }
                    .disabled(!canAct)
                }
            }
        } else if appState.isConnected {
            actionButton(title: "Disconnect and restore internet", prominent: false) {
                appState.disconnect(releaseKillSwitch: true)
            }
            .disabled(!canAct)
        } else if busy {
            actionButton(
                title: appState.isDisconnecting ? "Disconnecting…" : "Connecting…",
                prominent: false
            ) {}
            .disabled(true)
        } else {
            VStack(spacing: 0) {
                actionButton(title: "Connect", prominent: true) {
                    appState.userConnect()
                }
                .disabled(!canAct)
                if appState.shouldOfferManualBackupChannel() {
                    actionButton(title: "Try backup channel", prominent: true, seaVariant: .quiet) {
                        appState.tryBackupChannelManually()
                    }
                    .disabled(!canAct)
                }
            }
        }
    }

    private var restoreAction: some View {
        Button {
            Task { @MainActor in
                if accountSession.state == .ready {
                    appState.restoreInternet()
                } else {
                    await accountSession.restoreDirectInternet()
                }
            }
        } label: {
            Text("Restore internet (turn off protection)")
                .font(.system(size: seaAppearance ? 15 : 12, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .modifier(SeaActionStyle(variant: .text, size: .row))
        .padding(.horizontal, 16)
        .padding(.vertical, seaAppearance ? 0 : 6)
    }

    private func actionButton(
        title: LocalizedStringKey,
        prominent: Bool,
        seaVariant: SeaButtonVariant? = nil,
        action: @escaping () -> Void
    ) -> some View {
        let seaStyle = seaVariant ?? (prominent ? SeaButtonVariant.primary : .quiet)
        return Button(action: action) {
            Text(title)
                .font(.system(size: seaAppearance ? 15 : 12, weight: seaAppearance ? .medium : .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, seaAppearance ? 0 : 8)
                .background {
                    if !seaAppearance {
                        Capsule().fill(prominent
                            ? AnyShapeStyle(TonoBrand.accent.opacity(0.92))
                            : AnyShapeStyle(Color.primary.opacity(0.06)))
                    }
                }
                .foregroundStyle(seaAppearance ? (seaStyle == .primary ? SeaTheme.ink : SeaTheme.text) : (prominent ? Color.white : Color.primary))
                .contentShape(Capsule())
        }
        .modifier(SeaActionStyle(variant: seaStyle))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var seaQuickRoutes: some View {
        if !busy, let owner = accountSession.user?.id,
           owner == ManagedExitCatalogOwnership.currentAccount,
           accountSession.state == .ready {
            let catalog = appState.managedCatalogNodes
            let recommendation = appState.routeRecommendation(owner: owner)
            let routes = SeaMenuPresentation.quickRoutes(catalog: catalog,
                recommended: recommendation?.name,
                favorites: appState.routePreferences.favorites(owner: owner, catalog: catalog),
                selected: appState.activeNode?.name ?? appState.proxyService.activeNodeName)
            if !routes.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Rectangle()
                        .fill(.white.opacity(displayPreferences.contrast == .increased ? 0.28 : 0.07))
                        .frame(height: 0.75)
                        .padding(.bottom, 6)
                    ForEach(routes) { node in
                        let isSwitching = appState.switchingNodeId == node.id || appState.switchingNodeId == node.name
                        SeaMenuQuickRouteRow(
                            node: node,
                            isSwitching: isSwitching,
                            enabled: canAct && appState.switchingNodeId == nil,
                            display: displayPreferences
                        ) {
                            guard accountSession.user?.id == owner,
                                  owner == ManagedExitCatalogOwnership.currentAccount,
                                  canAct, appState.switchingNodeId == nil else { return }
                            switch SeaMenuPresentation.action(for: node, recommendation: recommendation) {
                            case .reviewRecommendation(let proposal):
                                routeProposal = proposal
                                staleRouteProposal = false
                                showingRouteConfirmation = true
                            case .selectManualNode(let name):
                                appState.selectNode(name)
                            }
                        }
                        .accessibilityLabel(String(localized: "Connect using \(nodeRouteTitle(node))"))
                    }
                    if staleRouteProposal {
                        Text("The account, catalog, route preference, or connection changed. Review a fresh recommendation.")
                            .font(.system(size: 11)).foregroundStyle(SeaTheme.warm)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 4)
            }
        }
    }

    /// One row of text buttons: Open Tono, Switch server, Quit.
    private var seaFooter: some View {
        VStack(spacing: 4) {
            Rectangle()
                .fill(.white.opacity(displayPreferences.contrast == .increased ? 0.28 : 0.07))
                .frame(height: 0.75)
                .padding(.horizontal, 16)
            HStack(spacing: 0) {
                Button("Open Tono", action: openMainWindow)
                    .buttonStyle(SeaMenuFooterButtonStyle())
                Spacer(minLength: 4)
                Button("Switch server") {
                    appState.selectedPage = .proxies
                    openMainWindow()
                }
                .buttonStyle(SeaMenuFooterButtonStyle())
                Spacer(minLength: 4)
                Button("Quit") { NSApp.terminate(nil) }
                    .buttonStyle(SeaMenuFooterButtonStyle(destructive: true))
                    .accessibilityLabel("Quit Tono")
            }
            .padding(.horizontal, 12)
        }
        .padding(.top, 4)
    }

    private var openTonoButton: some View {
        Button(action: openMainWindow) {
            Label("Open Tono", systemImage: "macwindow")
                .font(.system(size: seaAppearance ? 15 : 12, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .modifier(SeaActionStyle(variant: .text, size: .row))
        .padding(.horizontal, 16)
        .padding(.vertical, seaAppearance ? 0 : 6)
    }

    private var quitButton: some View {
        Button {
            NSApp.terminate(nil)
        } label: {
            Label("Quit Tono", systemImage: "power")
                .font(.system(size: seaAppearance ? 15 : 12, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .modifier(SeaActionStyle(variant: .danger, size: .row))
        .padding(.horizontal, 16)
        .padding(.vertical, seaAppearance ? 0 : 6)
    }

    private struct SeaMenuQuickRouteRow: View {
        let node: ProxyNode
        let isSwitching: Bool
        let enabled: Bool
        let display: SeaDisplayOptions
        let action: () -> Void
        @State private var hovered = false

        var body: some View {
            Button(action: action) {
                HStack(spacing: 8) {
                    NodeRouteMark(size: 20, city: nodeCityParts(node.displayName).city,
                                  gradient: SeaTheme.primaryGradient, warmTile: true)
                    Text(nodeRouteTitle(node)).lineLimit(1)
                    Spacer(minLength: 4)
                    if isSwitching {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(hovered && enabled ? SeaTheme.text : SeaTheme.muted)
                            .accessibilityHidden(true)
                    }
                }
                .font(.system(size: 13.5, weight: .medium)).foregroundStyle(SeaTheme.text)
                .padding(.horizontal, 8)
                .frame(minHeight: 34)
                .background(
                    display.reduceTransparency
                        ? (hovered && enabled ? Color(hex: "2B2421") : Color.clear)
                        : Color(hex: "FFD6A0").opacity(hovered && enabled ? 0.08 : 0),
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )
                .overlay {
                    if display.contrast == .increased && hovered && enabled {
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .strokeBorder(Color(hex: "FFD6A0").opacity(0.45), lineWidth: 1)
                    }
                }
                .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            .buttonStyle(SeaMenuRowButtonStyle(reduceMotion: display.reduceMotion))
            .disabled(!enabled)
            .opacity(enabled ? 1 : 0.45)
            .onHover { hovered = enabled ? $0 : false }
            .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
        }
    }

    private struct SeaMenuRowButtonStyle: ButtonStyle {
        let reduceMotion: Bool

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
                .animation(TonoMotion.press(reduceMotion: reduceMotion), value: configuration.isPressed)
        }
    }

    private struct SeaMenuFooterButtonStyle: ButtonStyle {
        var destructive: Bool = false
        @SeaDisplayPreferences private var display
        @State private var hovered = false

        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(
                    hovered
                        ? (destructive ? SeaTheme.danger : SeaTheme.text)
                        : SeaTheme.text.opacity(0.84)
                )
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .frame(minHeight: 30)
                .background(.white.opacity(hovered ? 0.08 : 0), in: Capsule())
                .contentShape(Capsule())
                .opacity(configuration.isPressed ? 0.65 : 1)
                .scaleEffect(configuration.isPressed && !display.reduceMotion ? 0.97 : 1)
                .animation(TonoMotion.press(reduceMotion: display.reduceMotion), value: configuration.isPressed)
                .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
                .onHover { hovered = $0 }
        }
    }

    private var menuDivider: some View {
        Rectangle()
            .fill(Color.primary.opacity(0.06))
            .frame(height: 0.5)
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
    }

    private func openMainWindow() {
        var found = false
        for window in NSApp.windows
            where window.title == "Tono"
            || window.identifier?.rawValue.contains("main") == true
        {
            window.deminiaturize(nil)
            window.makeKeyAndOrderFront(nil)
            found = true
            break
        }
        if !found {
            openWindow(id: "main")
        }
        NSApp.activate(ignoringOtherApps: true)
    }
}

/// The drawn mark the Windows tray uses: a sun while connecting or connected,
/// a crescent moon while idle, a red sun when something needs attention.
private struct SeaStatusMark: View {
    let phase: SeaPresentationPhase

    var body: some View {
        switch phase {
        case .night:
            Circle()
                .fill(Color(hex: "F4EEE2"))
                .mask {
                    Rectangle()
                        .overlay(Circle().offset(x: -6, y: 3).blendMode(.destinationOut))
                        .compositingGroup()
                }
                .rotationEffect(.degrees(-18))
                .frame(width: 16, height: 16)
                .shadow(color: Color(hex: "F4EEE2").opacity(0.2), radius: 6)
        case .dusk, .blocked:
            disc([Color(hex: "FFB08A"), Color(hex: "E85A44")], glow: Color(hex: "E85A44").opacity(0.33))
        case .dawn, .day:
            disc([Color(hex: "FFF6DE"), Color(hex: "FFD58E"), Color(hex: "FF9E63")],
                 glow: Color(hex: "FFB877").opacity(0.4))
        }
    }

    private func disc(_ colors: [Color], glow: Color) -> some View {
        Circle()
            .fill(RadialGradient(colors: colors, center: UnitPoint(x: 0.5, y: 0.35), startRadius: 0, endRadius: 9))
            .frame(width: 14, height: 14)
            .shadow(color: glow, radius: 6)
    }
}
