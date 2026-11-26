import SwiftUI

struct SidebarView: View {
    @Environment(\.seaAccent) private var seaAccent
    @Environment(\.appUpdater) private var appUpdater: AppUpdater?
    @SeaAppearancePreference private var seaAppearance
    @Binding var selectedPage: AppPage
    @AppStorage(SettingsKey.logsEnabled, store: AppProfile.defaults) private var logsEnabled = true
    @SeaDisplayPreferences private var displayPreferences
    private var reduceMotion: Bool { displayPreferences.reduceMotion }
    @Environment(\.colorScheme) private var colorScheme
    @State private var hoveredPage: AppPage?
    @Namespace private var navNS

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
                TonoLogo(compact: true)
                    .frame(width: 22, height: 22)
                Text(AppProfile.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)

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

            if let appUpdater {
                SidebarUpdatePill(updater: appUpdater)
            }

            Rectangle()
                .fill(.white.opacity(displayPreferences.contrast == .increased ? 0.30 : (colorScheme == .dark ? 0.07 : 0.08)))
                .frame(height: 0.75)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)

            // Support 与 Settings 推至底部
            VStack(alignment: .leading, spacing: 7) {
                navigationItem(for: .support)
                navigationItem(for: .settings)
            }
        }
        .padding(.bottom, 12)
        .padding(.horizontal, 6)
        .background {
            if seaAppearance {
                let opaque = displayPreferences.reduceTransparency || displayPreferences.contrast == .increased
                Group {
                    if opaque {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(SeaTheme.opaquePanel)
                    } else {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(Color.clear)
                            .glassEffect(.regular.tint(.black.opacity(0.30)), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    }
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(
                            SeaTheme.specularBorder(contrast: displayPreferences.contrast, reduceTransparency: displayPreferences.reduceTransparency, topOpacity: 0.14, bottomOpacity: 0.04),
                            lineWidth: displayPreferences.contrast == .increased ? 1 : 0.75
                        )
                }
                .padding(6)
            }
        }
        .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 280)
        .onChange(of: logsEnabled) { _, newValue in
            if !newValue && selectedPage == .logs {
                selectedPage = .dashboard
            }
        }
    }

    @ViewBuilder
    private func navigationItem(for page: AppPage) -> some View {
        let isSelected = selectedPage == page
        let isHovered = hoveredPage == page
        let item = Button {
            selectedPage = page
        } label: {
            HStack(spacing: 10) {
                Image(systemName: page.icon)
                    .font(.system(size: 15, weight: isSelected ? .medium : .regular))
                    .frame(width: 22, alignment: .center)
                    // The brand accent lives in the selected icon — the
                    // only color the row carries; the glass does the rest.
                    .foregroundStyle(
                        isSelected
                            ? (seaAppearance ? AnyShapeStyle(seaAccent) : AnyShapeStyle(TonoBrand.routeGradient))
                            : (seaAppearance ? AnyShapeStyle(isHovered ? SeaTheme.text : SeaTheme.muted) : AnyShapeStyle(.primary))
                    )
                Text(seaAppearance && page == .proxies ? LocalizedStringKey("Servers")
                    : (seaAppearance && page == .dashboard ? LocalizedStringKey("sea.nav.home") : page.displayName))
                    .font(.system(size: 13, weight: isSelected ? .semibold : .medium))
                    .foregroundStyle(seaAppearance ? (isSelected ? SeaTheme.text : SeaTheme.text.opacity(isHovered ? 0.94 : 0.84)) : .primary)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .symbolRenderingMode(.monochrome)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .frame(height: seaAppearance ? 34 : 38)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .background {
                // Liquid glass selection: a lifted glass capsule, not a
                // filled color block.
                if isSelected {
                    // One capsule per group slides to the chosen item
                    // (matched geometry); crossing groups it fades instead of
                    // stretching through the spacer.
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(
                            seaAppearance
                                ? (displayPreferences.reduceTransparency ? Color(hex: "2B2834") : .white.opacity(0.11))
                                : .white.opacity(colorScheme == .dark ? 0.13 : 0.78)
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(
                                    seaAppearance
                                        ? SeaTheme.specularBorder(contrast: displayPreferences.contrast, reduceTransparency: displayPreferences.reduceTransparency, topOpacity: 0.18, bottomOpacity: 0.05)
                                        : AnyShapeStyle(Color.white.opacity(colorScheme == .dark ? 0.22 : 0.9)),
                                    lineWidth: displayPreferences.contrast == .increased ? 1 : 0.65
                                )
                        }
                        .shadow(color: displayPreferences.reduceTransparency ? .clear : .black.opacity(colorScheme == .dark ? 0.24 : 0.10), radius: 8, y: 3)
                        .matchedGeometryEffect(id: indicatorID(for: page), in: navNS)
                } else if isHovered {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.white.opacity(displayPreferences.reduceTransparency ? 0.09 : (colorScheme == .dark ? 0.065 : 0.5)))
                        .overlay {
                            if displayPreferences.contrast == .increased {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(.white.opacity(0.35), lineWidth: 0.75)
                            }
                        }
                }
            }
            .overlay(alignment: .leading) {
                if isSelected {
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: seaAppearance ? [seaAccent, seaAccent.opacity(0.65)] : [TonoBrand.accent, TonoBrand.accentSoft],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .frame(width: seaAppearance ? 2.5 : 3)
                        .padding(.vertical, 8)
                        .padding(.leading, 4)
                        .matchedGeometryEffect(id: indicatorID(for: page) + ".line", in: navNS)
                }
            }
        }
        .buttonStyle(SidebarRowButtonStyle(reduceMotion: reduceMotion))
        .pointerStyle(.link)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .onHover { hovering in
            hoveredPage = hovering ? page : (hoveredPage == page ? nil : hoveredPage)
        }
        .animation(TonoMotion.hover(reduceMotion: reduceMotion), value: hoveredPage)
        .animation(TonoMotion.nav(reduceMotion: reduceMotion), value: isSelected)

        if let shortcut = commandShortcut(for: page) {
            item.keyboardShortcut(shortcut, modifiers: .command)
        } else {
            item
        }
    }

    private func indicatorID(for page: AppPage) -> String {
        mainPages.contains(page) ? "nav.main" : "nav.footer"
    }

    /// ⌘1–⌘4 follow the visible `mainPages` order so Logs only claims ⌘4
    /// when that destination is actually in the sidebar.
    private func commandShortcut(for page: AppPage) -> KeyEquivalent? {
        guard let index = mainPages.firstIndex(of: page), index < 9 else { return nil }
        return KeyEquivalent(Character(String(index + 1)))
    }
}

private struct SidebarRowButtonStyle: ButtonStyle {
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(TonoMotion.press(reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

#Preview {
    @Previewable @State var page: AppPage = .dashboard
    SidebarView(selectedPage: $page)
        .frame(width: 220, height: 600)
        .environment(\.appUpdater, AppUpdater(enabled: false))
}
