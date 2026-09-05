import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var columnVisibility: NavigationSplitViewVisibility = .doubleColumn

    var body: some View {
        @Bindable var appState = appState

        ZStack {
            MeshGradientBackground()

            NavigationSplitView(columnVisibility: $columnVisibility) {
                SidebarView(selectedPage: $appState.selectedPage)
                    .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 280)
            } detail: {
                VStack(spacing: 0) {
                    if appState.isProtectionBlocked {
                        ProtectedOfflineBanner()
                    }
                    ZStack(alignment: .topTrailing) {
                        Group {
                            switch appState.selectedPage {
                            case .dashboard:
                                DashboardView()
                            case .proxies:
                                ProxiesView()
                            case .rules:
                                RulesView()
                            case .activity:
                                ActivityView()
                            case .logs:
                                LogsView()
                            case .support:
                                SupportView()
                            case .settings:
                                SettingsView()
                            }
                        }

                        if let error = appState.errorMessage {
                            ErrorBanner(message: error) {
                                appState.errorMessage = nil
                            }
                            .padding(16)
                            .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                        }
                    }
                    .frame(minWidth: 660, minHeight: 540)
                    .animation(
                        TonoMotion.easeOut(0.18, reduceMotion: reduceMotion),
                        value: appState.errorMessage != nil
                    )
                }
            }
            .navigationSplitViewStyle(.balanced)
        }
    }
}

private struct ProtectedOfflineBanner: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Circle()
                .fill(TonoStatus.blocked)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text("Protected Offline")
                    .font(.system(size: 13, weight: .semibold))
                Text("Direct traffic is blocked. Restore internet from here if you need the network.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button("Retry now") {
                appState.retryProtectedConnectionNow()
            }
            .buttonStyle(.borderedProminent)
            .tint(TonoStatus.blocked)
            .controlSize(.small)
            .disabled(!appState.isTonoReady || appState.isDisconnecting)
            Button("Restore internet") {
                appState.disconnect(releaseKillSwitch: true)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            Button("Choose another route") {
                appState.selectedPage = .proxies
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(TonoStatus.blocked.opacity(0.12))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(TonoStatus.blocked.opacity(0.28))
                .frame(height: 1)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

private struct ErrorBanner: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .padding(.top, 1)

            Text(message)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 22, height: 22)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: 480, alignment: .leading)
        .glassEffect(
            .regular.tint(.orange.opacity(0.08)),
            in: RoundedRectangle(cornerRadius: 14)
        )
        .shadow(color: .black.opacity(0.12), radius: 16, y: 7)
    }
}

#Preview {
    ContentView()
        .environment(AppState())
}
