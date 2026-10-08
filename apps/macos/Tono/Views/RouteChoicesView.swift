import SwiftUI

struct RouteChoicesView: View {
    @SeaAppearancePreference private var seaAppearance
    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var account: AccountSession?
    @State private var proposal: RouteRecommendation?
    @State private var showingConfirmation = false
    @State private var stale = false
    @State private var showingHelp = false

    var body: some View {
        if let owner = account?.user?.id, account?.isReady == true,
           owner == ManagedExitCatalogOwnership.currentAccount {
            let region = appState.routePreferences.preferredRegion(owner: owner)
            let regions = appState.routePreferenceRegions
            let regionSelection = Binding(
                get: { appState.routePreferences.preferredRegion(owner: owner) ?? "" },
                set: { value in
                    guard account?.user?.id == owner, account?.isReady == true else { return }
                    appState.setPreferredRouteRegion(value.isEmpty ? nil : value, owner: owner)
                }
            )
            Group {
                if seaAppearance {
                    seaPanel(owner: owner, region: region, regions: regions, regionSelection: regionSelection)
                } else {
                    legacyPanel(owner: owner, region: region, regions: regions, regionSelection: regionSelection)
                }
            }
            .confirmationDialog(String(localized: "Connect using this route?"), isPresented: $showingConfirmation, titleVisibility: .visible) {
                Button("Connect") {
                    guard let proposal, proposal.owner == account?.user?.id, account?.isReady == true else { return }
                    stale = !appState.confirmRouteRecommendation(proposal)
                }
                Button("Cancel", role: .cancel) { proposal = nil }
            } message: {
                if let proposal {
                    Text(nodeRouteTitle(for: proposal.name))
                    Text("This starts a connection only after confirmation. It never switches an already connected exit.")
                }
            }
        }
    }

    private func review(owner: String) {
        proposal = appState.routeRecommendation(owner: owner)
        stale = false
        showingConfirmation = proposal != nil
    }

    private func isSelected(_ name: String) -> Bool {
        guard let selected = appState.selectedNodeId else { return false }
        if selected == name { return true }
        return appState.proxyRegions.flatMap(\.nodes)
            .first(where: { $0.id == selected || $0.name == selected })?.name == name
    }

    /// Sea: one panel. Tag, line, latency, one short reason, and either the
    /// neutral Selected tag or one quiet Use (which still opens the
    /// confirmation). The region picker and the full reason live in the "?".
    private func seaPanel(owner: String, region: String?, regions: [String], regionSelection: Binding<String>) -> some View {
        let recommendation = appState.routeRecommendation(owner: owner)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SeaTag(title: "Recommended")
                Button { showingHelp.toggle() } label: {
                    Text(verbatim: "?").font(.system(size: 12, weight: .medium))
                        .foregroundStyle(SeaTheme.warm)
                        .frame(width: 22, height: 22)
                        .overlay { Circle().strokeBorder(.white.opacity(0.14), lineWidth: 1) }
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("About recommendations")
                .popover(isPresented: $showingHelp, arrowEdge: .bottom) {
                    seaHelp(region: region, regions: regions, regionSelection: regionSelection, recommendation: recommendation)
                }
                if recommendation == nil {
                    Text("No recommendation right now.")
                        .font(.system(size: 13)).foregroundStyle(SeaTheme.muted)
                }
            }
            if let recommendation {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(nodeRouteTitle(for: recommendation.name))
                            .font(.system(size: 20, weight: .light)).foregroundStyle(SeaTheme.text)
                        if let latency = appState.proxyService.node(named: recommendation.name)?.latency, latency > 0 {
                            Text(LatencyLevel.spokenTitle(for: latency, kind: .exit))
                                .font(.system(size: 13)).monospacedDigit().foregroundStyle(SeaTheme.muted)
                        }
                        Text(recommendation.successfulAt == nil
                             ? "Catalog choice, not tested. Nothing was switched."
                             : "Connected successfully in the last 24 hours.")
                            .font(.system(size: 13)).foregroundStyle(SeaTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    if isSelected(recommendation.name) {
                        SeaTag(title: "Selected")
                    } else {
                        Button("Use") { review(owner: owner) }
                            .buttonStyle(SeaButtonStyle(variant: .quiet, size: .row))
                            .accessibilityLabel("Review recommended route")
                    }
                }
            }
            if region != nil, appState.routeRecommendationNodes(owner: owner).isEmpty {
                Text("No available route in your fixed region. Choose another region or Any region to clear it; Tono will not recommend outside it.")
                    .font(.system(size: 12)).foregroundStyle(SeaTheme.attention)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if stale {
                Text("The account, catalog, route preference, or connection changed. Review a fresh recommendation.")
                    .font(.system(size: 12)).foregroundStyle(SeaTheme.attention)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(SeaPanelSurface())
    }

    private func seaHelp(region: String?, regions: [String], regionSelection: Binding<String>,
                         recommendation: RouteRecommendation?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Fixed recommendation region").font(.system(size: 12)).foregroundStyle(SeaTheme.muted)
            SeaMenuButton(
                title: Text(verbatim: region.map { regions.contains($0) ? $0 : String(localized: "Saved region unavailable") }
                            ?? String(localized: "Any region")),
                accessibilityLabel: Text("Fixed recommendation region")
            ) {
                Button("Any region") { regionSelection.wrappedValue = "" }
                ForEach(regions, id: \.self) { option in
                    Button { regionSelection.wrappedValue = option } label: { Text(verbatim: option) }
                }
                if let region, !regions.contains(region) {
                    Button("Saved region unavailable") { regionSelection.wrappedValue = region }
                }
            }
            Text("Recommendations only. Manual choices and the connected exit do not change.")
            // The full reason; the panel keeps one short sentence.
            if let successfulAt = recommendation?.successfulAt {
                Text("Succeeded within 24 hours in this catalog. Favorites rank only among recent successful routes; latency alone does not decide.")
                Text(successfulAt, format: .dateTime.month().day().hour().minute())
                    .monospacedDigit().foregroundStyle(SeaTheme.tertiary)
            } else if recommendation != nil {
                Text("Catalog choice only: no recent successful route in this catalog. Reachability is unknown; no background test or switch was performed.")
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(SeaTheme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(16)
        .frame(width: 320, alignment: .leading)
    }

    private func legacyPanel(owner: String, region: String?, regions: [String], regionSelection: Binding<String>) -> some View {
            VStack(alignment: .leading, spacing: 6) {
                if seaAppearance {
                    SeaMenuButton(
                        title: Text(verbatim: region.map { regions.contains($0) ? $0 : String(localized: "Saved region unavailable") }
                                    ?? String(localized: "Any region")),
                        accessibilityLabel: Text("Fixed recommendation region")
                    ) {
                        Button("Any region") { regionSelection.wrappedValue = "" }
                        ForEach(regions, id: \.self) { option in
                            Button { regionSelection.wrappedValue = option } label: { Text(verbatim: option) }
                        }
                        if let region, !regions.contains(region) {
                            Button("Saved region unavailable") { regionSelection.wrappedValue = region }
                        }
                    }
                } else {
                    Picker("Fixed recommendation region", selection: regionSelection) {
                        Text("Any region").tag("")
                        ForEach(regions, id: \.self) { Text(verbatim: $0).tag($0) }
                        if let region, !regions.contains(region) {
                            Text("Saved region unavailable").tag(region)
                        }
                    }
                    .pickerStyle(.menu)
                    .font(.system(size: 12))
                }
                Text("Recommendations only. Manual choices and the connected exit do not change.")
                    .font(.system(size: seaAppearance ? 12 : 11))
                    .foregroundStyle(seaAppearance ? SeaTheme.muted : Color.secondary)
                if region != nil, appState.routeRecommendationNodes(owner: owner).isEmpty {
                    Text("No available route in your fixed region. Choose another region or Any region to clear it; Tono will not recommend outside it.")
                        .font(.system(size: seaAppearance ? 12 : 11))
                        .foregroundStyle(seaAppearance ? SeaTheme.attention : Color.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let recommendation = appState.routeRecommendation(owner: owner) {
                    if seaAppearance {
                        Rectangle().fill(.white.opacity(0.06)).frame(height: 1).padding(.vertical, 4)
                    } else {
                        Divider().padding(.vertical, 4)
                    }
                    RouteRecommendationDetails(proposal: recommendation)
                    Button("Review recommended route") { review(owner: owner) }
                    .modifier(SeaActionStyle(variant: .quiet, legacy: .automatic))
                }
                if stale {
                    Text("The account, catalog, route preference, or connection changed. Review a fresh recommendation.")
                        .font(.system(size: seaAppearance ? 12 : 11))
                        .foregroundStyle(seaAppearance ? SeaTheme.attention : Color.orange)
                }
            }
            .padding(seaAppearance ? 20 : 12)
            .frame(maxWidth: seaAppearance ? .infinity : 520, alignment: .leading)
            .background(.primary.opacity(seaAppearance ? 0 : 0.04), in: RoundedRectangle(cornerRadius: 12))
            .modifier(SeaPanelSurface())
    }
}

struct RouteRecommendationDetails: View {
    @SeaAppearancePreference private var seaAppearance
    let proposal: RouteRecommendation
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if seaAppearance {
                HStack(spacing: 8) {
                    SeaTag(title: "Recommended")
                    Text(nodeRouteTitle(for: proposal.name)).font(.system(size: 15))
                }
            } else {
            Label(nodeRouteTitle(for: proposal.name), systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                .font(.system(size: 12, weight: .semibold))
            }
            if let successfulAt = proposal.successfulAt {
                Text("Succeeded within 24 hours in this catalog. Favorites rank only among recent successful routes; latency alone does not decide.")
                    .font(.system(size: seaAppearance ? 12 : 11))
                    .foregroundStyle(seaAppearance ? SeaTheme.muted : Color.secondary)
                Text(successfulAt, format: .dateTime.month().day().hour().minute())
                    .font(.system(size: seaAppearance ? 12 : 10)).monospacedDigit()
                    .foregroundStyle(seaAppearance ? SeaTheme.tertiary : Color.secondary)
            } else {
                Text("Catalog choice only: no recent successful route in this catalog. Reachability is unknown; no background test or switch was performed.")
                    .font(.system(size: seaAppearance ? 12 : 11))
                    .foregroundStyle(seaAppearance ? SeaTheme.muted : Color.secondary)
            }
        }.fixedSize(horizontal: false, vertical: true)
    }
}
