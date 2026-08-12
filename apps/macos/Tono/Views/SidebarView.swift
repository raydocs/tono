import SwiftUI

struct SidebarView: View {
    @Binding var selectedPage: AppPage
    @AppStorage(SettingsKey.logsEnabled) private var logsEnabled = true

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
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, 16)

            // 主导航
            ForEach(mainPages) { page in
                navigationItem(for: page)
            }

            Spacer()

            // Support 与 Settings 推至底部
            navigationItem(for: .support)
            navigationItem(for: .settings)
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
        Button {
            selectedPage = page
        } label: {
            HStack(spacing: 10) {
                Image(systemName: page.icon)
                    .font(.system(size: 15))
                    .frame(width: 22, alignment: .center)
                Text(page.displayName)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .symbolRenderingMode(.monochrome)
            .foregroundStyle(isSelected ? .white : .primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
            .background(
                isSelected
                    ? Color.accentColor
                    : .clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    @Previewable @State var page: AppPage = .dashboard
    SidebarView(selectedPage: $page)
        .frame(width: 220, height: 600)
}
