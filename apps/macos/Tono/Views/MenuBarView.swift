import AppKit
import SwiftUI

/// Menu bar extra: state, current node, one safe action, Open Tono, Quit.
/// Not a second dashboard — no TUN toggle, IP, DNS, or node list.
struct MenuBarView: View {
    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var accountSession
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            currentNode
            primaryAction
            if appState.isProtectionBlocked
                || (KillSwitchService.isArmed && accountSession.state != .ready) {
                restoreAction
            }
            menuDivider
            openTonoButton
            quitButton
        }
        .padding(.bottom, 8)
        .frame(width: 280)
        .fixedSize()
    }

    private var statusColor: Color {
        if appState.isProtectionBlocked { return TonoStatus.blocked }
        if appState.isConnecting || appState.isDisconnecting || appState.isProxyDegraded {
            return TonoStatus.connecting
        }
        if appState.isConnected { return TonoStatus.connected }
        return TonoStatus.neutral
    }

    private var statusTitle: LocalizedStringKey {
        if appState.isDisconnecting { return "Disconnecting…" }
        if appState.isConnecting { return LocalizedStringKey(appState.connectionStage.rawValue) }
        if appState.isProtectedReconnectScheduled { return "Waiting to retry…" }
        if appState.protectedReconnectPausedForUserAction {
            return "Protected Offline · retries paused"
        }
        if appState.isProtectionBlocked { return "Protected Offline" }
        if appState.isProxyDegraded { return "Degraded" }
        if appState.isConnected { return "Protected" }
        return "Standby"
    }

    private var header: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
                .shadow(color: appState.isConnected ? TonoStatus.connected.opacity(0.6) : .clear, radius: 3)
            VStack(alignment: .leading, spacing: 1) {
                Text("Tono")
                    .font(.system(size: 13, weight: .semibold))
                Text(statusTitle)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private var currentNode: some View {
        Text(nodeLabel)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
    }

    private var nodeLabel: String {
        let name = appState.activeNode?.name ?? appState.proxyService.activeNodeName ?? ""
        guard !name.isEmpty else { return String(localized: "No server selected") }
        let (flag, clean) = ConfigParser.extractFlag(from: name)
        return "\(ProxyNode.displayName(for: clean)) · \(nodeRegionCode(flag: flag, name: clean))"
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
            actionButton(
                title: appState.protectedReconnectPausedForUserAction
                    ? "Repair and reconnect"
                    : "Retry now",
                prominent: true
            ) {
                appState.retryProtectedConnectionNow()
            }
            .disabled(!canAct)
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
            actionButton(title: "Connect", prominent: true) {
                appState.connect()
            }
            .disabled(!canAct)
        }
    }

    private var restoreAction: some View {
        Button {
            Task { @MainActor in
                if accountSession.state == .ready {
                    appState.disconnect(releaseKillSwitch: true)
                } else {
                    await accountSession.restoreDirectInternet()
                }
            }
        } label: {
            Text("Restore internet (turn off protection)")
                .font(.system(size: 12, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }

    private func actionButton(
        title: LocalizedStringKey,
        prominent: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(
                    prominent
                        ? TonoBrand.accent.opacity(0.92)
                        : Color.primary.opacity(0.06),
                    in: Capsule()
                )
                .foregroundStyle(prominent ? Color.white : Color.primary)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var openTonoButton: some View {
        Button(action: openMainWindow) {
            Label("Open Tono", systemImage: "macwindow")
                .font(.system(size: 12, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }

    private var quitButton: some View {
        Button {
            NSApp.terminate(nil)
        } label: {
            Label("Quit Tono", systemImage: "power")
                .font(.system(size: 12, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
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
