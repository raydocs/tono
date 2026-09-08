import SwiftUI

extension ProxiesView {
    // MARK: - Header

    var headerRow: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Nodes")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.primary)
                Text("Choose a secure exit for your protected traffic.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            HStack(spacing: 10) {
                if AppProfile.isDev {
                    GradientAddButton("Add Node") {
                        withAnimation(.easeOut(duration: 0.25)) {
                            showingAddNode = true
                        }
                    }
                }

                if appState.isConnected {
                    Button {
                        guard !isTesting else { return }
                        isTesting = true
                        Task {
                            await appState.testSelectedExitLatency()
                            isTesting = false
                        }
                    } label: {
                        HStack(spacing: 5) {
                            if isTesting {
                                ProgressView()
                                    .controlSize(.mini)
                            } else {
                                Image(systemName: "bolt.fill")
                                    .font(.system(size: 11))
                            }
                            // Says what it measures. "Test Latency" next to a
                            // grid of untested cards read as a list-wide sweep,
                            // and users concluded testing was broken when the
                            // other cards stayed unmeasured.
                            Text("Test current exit")
                            .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .fixedSize()
                    .disabled(
                        isTesting
                            || appState.isConnecting
                            || appState.isDisconnecting
                            || appState.switchingNodeId != nil
                    )
                    .glassEffect(
                        .regular.tint(.white.opacity(0.08)),
                        in: Capsule()
                    )
                }
            }
        }
    }

    var catalogSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: catalogStatusIcon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(catalogStatusColor)
                    .frame(width: 30, height: 30)
                    .background(catalogStatusColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))

                VStack(alignment: .leading, spacing: 2) {
                    Text(catalogStatusTitle)
                        .font(.system(size: 12, weight: .semibold))
                    Text(catalogStatusDetail)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                if let catalogFeedback {
                    Text(catalogFeedback)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(catalogRefreshSucceeded ? Color.green : Color.orange)
                        .lineLimit(1)
                        .transition(.opacity)
                }

                Button {
                    refreshCatalog()
                } label: {
                    HStack(spacing: 5) {
                        if isRefreshingCatalog {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 10, weight: .semibold))
                        }
                        Text(isRefreshingCatalog ? "Refreshing…" : "Refresh")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.tint(.white.opacity(0.08)), in: Capsule())
                .disabled(isRefreshingCatalog || accountSession.state != .ready)
            }

            // The amber shield and "last verified" title said only that a
            // refresh had failed. The reason was stored and never read, so
            // support had to ask for it, and the traffic policy — which pins
            // the WeChat direct route — had no line here at all.
            if let reason = accountSession.catalogFailureMessage {
                catalogIssueRow(
                    label: String(localized: "Server catalog refresh failed"),
                    reason: reason
                )
            }
            if let reason = accountSession.trafficPolicyFailureMessage {
                catalogIssueRow(
                    label: String(localized: "Traffic policy refresh failed"),
                    reason: reason
                )
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .background(.white.opacity(colorScheme == .dark ? 0.07 : 0.42), in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.65), lineWidth: 0.5)
        )
    }

    var nodeToolbar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                TextField("Search servers", text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .focused($isSearchFocused)

                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.white.opacity(colorScheme == .dark ? 0.07 : 0.38), in: RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.6), lineWidth: 0.5)
            )

            HStack(spacing: 3) {
                regionFilterChip(nil)
                ForEach(regionOptions, id: \.self) { code in
                    regionFilterChip(code)
                }
            }
            .padding(3)
            .background(.white.opacity(colorScheme == .dark ? 0.06 : 0.32), in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(.white.opacity(colorScheme == .dark ? 0.1 : 0.55), lineWidth: 0.5)
            )

            Spacer(minLength: 0)
        }
    }

    func catalogIssueRow(label: String, reason: String) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.orange)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.primary)
                Text(reason)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    var catalogStatusTitle: String {
        if accountSession.catalogFailureMessage != nil {
            return String(localized: "Using last verified catalog")
        }
        if appState.managedCatalogNodeCount > 0 {
            return String(localized: "Verified server catalog")
        }
        return String(localized: "Waiting for server catalog")
    }

    var catalogStatusDetail: String {
        let count = appState.managedCatalogNodeCount
        let serverCount = String.localizedStringWithFormat(
            String(localized: "%lld cloud servers"),
            Int64(count)
        )
        if let version = appState.managedCatalogVersion {
            return String(localized: "\(serverCount) · v\(version) · updates automatically")
        }
        return String(localized: "\(serverCount) · waiting for the first verified sync")
    }

    var catalogStatusIcon: String {
        accountSession.catalogFailureMessage == nil && appState.managedCatalogNodeCount > 0
            ? "checkmark.shield.fill"
            : "exclamationmark.shield"
    }

    var catalogStatusColor: Color {
        accountSession.catalogFailureMessage == nil && appState.managedCatalogNodeCount > 0
            ? Color.green
            : Color.orange
    }

    func refreshCatalog() {
        guard !isRefreshingCatalog else { return }
        isRefreshingCatalog = true
        catalogFeedbackDismissal?.cancel()
        catalogFeedbackDismissal = nil
        catalogFeedback = nil
        Task {
            let succeeded = await accountSession.refreshManagedCatalog()
            isRefreshingCatalog = false
            catalogRefreshSucceeded = succeeded
            withAnimation(.easeOut(duration: 0.2)) {
                catalogFeedback = succeeded
                    ? String(localized: "Updated")
                    : String(localized: "Using last verified copy")
            }
            // Success is transient; a fallback-copy warning stays visible.
            if succeeded {
                catalogFeedbackDismissal = Task {
                    try? await Task.sleep(for: .seconds(2))
                    guard !Task.isCancelled else { return }
                    withAnimation(.easeOut(duration: 0.3)) {
                        catalogFeedback = nil
                    }
                }
            }
        }
    }
}
