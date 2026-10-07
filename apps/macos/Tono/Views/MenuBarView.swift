import AppKit
import SwiftUI

/// Menu bar extra: state, current node, one safe action, Open Tono, Quit.
/// Not a second dashboard — no TUN toggle, IP, DNS, or node list.
struct MenuBarView: View {
    @SeaAppearancePreference private var seaAppearance
    static let popoverWidth: CGFloat = 280

    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var accountSession
    @Environment(\.openWindow) private var openWindow
    @State private var routeProposal: RouteRecommendation?
    @State private var showingRouteConfirmation = false
    @State private var staleRouteProposal = false

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
                if seaAppearance { seaQuickRoutes }
                menuDivider
                openTonoButton
                quitButton
            }
            .padding(.bottom, 8)
            .frame(width: Self.popoverWidth)
        }
        .frame(width: Self.popoverWidth)
        .frame(maxHeight: maximumPopoverHeight)
        .background {
            if seaAppearance { SeaSecondaryScene() }
        }
        .modifier(SeaPageAppearance())
        .environment(\.seaAccent, SeaPresentationPhase.resolve(status: status.kind, disconnecting: appState.isDisconnecting, failed: appState.lastConnectionFailure != nil) == .day ? SeaTheme.warm : SeaTheme.cool)
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

    private var header: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(seaAppearance && status.kind == .connecting ? SeaTheme.cool : status.color)
                .frame(width: 8, height: 8)
                .shadow(color: appState.isConnected ? TonoStatus.connected.opacity(0.6) : .clear, radius: 3)
            VStack(alignment: .leading, spacing: 1) {
                if !seaAppearance {
                    Text("Tono").font(.system(size: 13, weight: .semibold))
                }
                Text(seaAppearance ? LocalizedStringKey(SeaStatusWords.key(kind: status.kind, connected: appState.isConnected, protectionBlocked: appState.isProtectionBlocked,
                    unknown: appState.isProtectionUnconfirmed || appState.isProtectionBlockUnreadable,
                    disconnecting: appState.isDisconnecting)) : status.title)
                    .font(.system(size: seaAppearance ? 20 : 11, weight: seaAppearance ? .light : .regular))
                    .foregroundStyle(seaAppearance ? SeaTheme.text : .secondary)
                    .lineLimit(seaAppearance ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)
                if seaAppearance, status.kind == .degraded {
                    Text(appState.isRecoveringProtectedConnection
                         ? String(localized: "Recovering protected connection…")
                         : String(localized: "Exit not responding — checking"))
                        .font(.system(size: 11)).foregroundStyle(SeaTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, seaAppearance ? 16 : 12)
        .padding(.bottom, 8)
    }

    private var currentNode: some View {
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
                    appState.connect()
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
                VStack(alignment: .leading, spacing: 4) {
                    Text("Choose another route").font(.system(size: 10)).foregroundStyle(SeaTheme.muted)
                    ForEach(routes) { node in
                        Button {
                            guard accountSession.user?.id == owner,
                                  owner == ManagedExitCatalogOwnership.currentAccount, canAct else { return }
                            switch SeaMenuPresentation.action(for: node, recommendation: recommendation) {
                            case .reviewRecommendation(let proposal):
                                routeProposal = proposal
                                staleRouteProposal = false
                                showingRouteConfirmation = true
                            case .selectManualNode(let name):
                                appState.selectNode(name)
                            }
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "arrow.up.right").accessibilityHidden(true)
                                Text(nodeRouteTitle(node)).lineLimit(1)
                                Spacer(minLength: 4)
                            }
                            .font(.system(size: 12)).padding(.vertical, 6).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).disabled(!canAct)
                        .accessibilityLabel(String(localized: "Connect using \(nodeRouteTitle(node))"))
                    }
                    if staleRouteProposal {
                        Text("The account, catalog, route preference, or connection changed. Review a fresh recommendation.")
                            .font(.system(size: 11)).foregroundStyle(SeaTheme.warm)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
        }
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
