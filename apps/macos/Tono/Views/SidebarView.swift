import SwiftUI

struct SidebarView: View {
    @Binding var selectedPage: AppPage
    @AppStorage(SettingsKey.logsEnabled) private var logsEnabled = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var hoveredPage: AppPage?

    // Keep the primary flow focused on connection, servers, and diagnostics.
    // Catalog synchronization is part of Nodes; it is not a separate user
    // destination.
    private var mainPages: [AppPage] {
        // Routing rules are deployed from the control plane, identically for
        // every user, so there is nothing here for a user to manage. The page
        // and its enum case are kept for internal builds; they are simply not
        // reachable destinations.
        [.dashboard, .proxies, .activity, .logs].filter { page in
            if page == .logs { return logsEnabled }
            return true
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 品牌区
            HStack(spacing: 10) {
                LiquidClashLogo(compact: true)
                    .frame(width: 22, height: 22)
                Text(AppProfile.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                if let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String {
                    Text("v\(version)")
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 26)

            // 主导航 — roomy rows; the air between items is part of the
            // glass language, not wasted space.
            VStack(alignment: .leading, spacing: 7) {
                ForEach(mainPages) { page in
                    navigationItem(for: page)
                }
            }

            Spacer()

            // Support 与 Settings 推至底部
            Divider()
                .opacity(0.35)
                .padding(.horizontal, 8)
                .padding(.bottom, 10)
            VStack(alignment: .leading, spacing: 7) {
                navigationItem(for: .support)
                navigationItem(for: .settings)
            }
        }
        .padding(.bottom, 12)
        .padding(.horizontal, 6)
        .navigationSplitViewColumnWidth(min: 220, ideal: 220, max: 280)
        .onChange(of: logsEnabled) { _, newValue in
            if !newValue && selectedPage == .logs {
                selectedPage = .dashboard
            }
        }
    }

    @ViewBuilder
    private func navigationItem(for page: AppPage) -> some View {
        let isSelected = selectedPage == page
        let item = Button {
            selectedPage = page
        } label: {
            HStack(spacing: 10) {
                Image(systemName: page.icon)
                    .font(.system(size: 15))
                    .frame(width: 22, alignment: .center)
                    // The brand gradient lives in the selected icon — the
                    // only color the row carries; the glass does the rest.
                    .foregroundStyle(
                        isSelected
                            ? AnyShapeStyle(TonoBrand.routeGradient)
                            : AnyShapeStyle(.primary)
                    )
                Text(page.displayName)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .symbolRenderingMode(.monochrome)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .background {
                // Liquid glass selection: a lifted glass capsule, not a
                // filled color block.
                if isSelected {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.white.opacity(colorScheme == .dark ? 0.13 : 0.78))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(
                                    .white.opacity(colorScheme == .dark ? 0.22 : 0.9),
                                    lineWidth: 0.5
                                )
                        }
                        .shadow(color: .black.opacity(colorScheme == .dark ? 0.3 : 0.10), radius: 8, y: 3)
                } else if hoveredPage == page {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.white.opacity(colorScheme == .dark ? 0.07 : 0.5))
                }
            }
            .overlay(alignment: .leading) {
                if isSelected {
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [TonoBrand.accent, TonoBrand.accentSoft],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: 3)
                        .padding(.vertical, 8)
                        .padding(.leading, 4)
                }
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredPage = hovering ? page : (hoveredPage == page ? nil : hoveredPage)
        }
        .animation(TonoMotion.easeOut(0.15, reduceMotion: reduceMotion), value: hoveredPage)
        .animation(TonoMotion.easeOut(0.15, reduceMotion: reduceMotion), value: isSelected)

        if let shortcut = commandShortcut(for: page) {
            item.keyboardShortcut(shortcut, modifiers: .command)
        } else {
            item
        }
    }

    /// ⌘1–⌘4 follow the visible `mainPages` order so Logs only claims ⌘4
    /// when that destination is actually in the sidebar.
    private func commandShortcut(for page: AppPage) -> KeyEquivalent? {
        guard let index = mainPages.firstIndex(of: page), index < 9 else { return nil }
        return KeyEquivalent(Character(String(index + 1)))
    }
}

#Preview {
    @Previewable @State var page: AppPage = .dashboard
    SidebarView(selectedPage: $page)
        .frame(width: 220, height: 600)
}
