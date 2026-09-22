import SwiftUI

struct RouteChoicesView: View {
    @Environment(AppState.self) private var appState
    @Environment(AccountSession.self) private var account: AccountSession?
    @State private var proposal: RouteRecommendation?
    @State private var showingConfirmation = false
    @State private var stale = false

    var body: some View {
        if let owner = account?.user?.id, account?.isReady == true,
           let recommendation = appState.routeRecommendation(owner: owner) {
            VStack(alignment: .leading, spacing: 6) {
                RouteRecommendationDetails(proposal: recommendation)
                Button("Review recommended route") {
                    proposal = appState.routeRecommendation(owner: owner)
                    stale = false
                    showingConfirmation = proposal != nil
                }
                if stale {
                    Text("The account, catalog, or connection changed. Review a fresh recommendation.")
                        .font(.system(size: 11)).foregroundStyle(.orange)
                }
            }
            .padding(12)
            .frame(maxWidth: 520, alignment: .leading)
            .background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
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
}

struct RouteRecommendationDetails: View {
    let proposal: RouteRecommendation
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(nodeRouteTitle(for: proposal.name), systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                .font(.system(size: 12, weight: .semibold))
            if let successfulAt = proposal.successfulAt {
                Text("Succeeded within 24 hours in this catalog. Favorites rank only among recent successful routes; latency alone does not decide.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                Text(successfulAt, format: .dateTime.month().day().hour().minute())
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            } else {
                Text("Catalog choice only: no recent successful route in this catalog. Reachability is unknown; no background test or switch was performed.")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }.fixedSize(horizontal: false, vertical: true)
    }
}
