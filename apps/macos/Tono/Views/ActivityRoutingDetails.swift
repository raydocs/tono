import SwiftUI

struct ActivityRoutingDetails: View {
    let entries: [ConnectionEntry]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Why this route?").font(.headline)
                Text("Tono manages these rules. Each flow can take a different path. This shows up to eight currently reported flows; totals can include closed flows whose rule evidence is no longer available.")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                if entries.isEmpty {
                    Text("No current flow evidence. Generate traffic in the app while connected, then check Activity again.")
                        .font(.system(size: 12))
                }
                ForEach(Array(entries.prefix(8))) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.domain).font(.system(size: 12, weight: .semibold))
                        if let explanation = entry.routingExplanation {
                            Text(explanation.summary).font(.system(size: 12))
                            Text(explanation.ruleExplanation).font(.system(size: 11)).foregroundStyle(.secondary)
                            Text(entry.rule).font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                            Text("Observed chain · terminal first")
                                .font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                            Text(explanation.chain.isEmpty ? String(localized: "Unknown") : explanation.chain.joined(separator: " ← "))
                                .font(.system(size: 11, design: .monospaced)).textSelection(.enabled)
                        } else {
                            Text("The terminal route is unknown. A rule or selector name alone cannot prove the egress.")
                                .font(.system(size: 12))
                        }
                    }.fixedSize(horizontal: false, vertical: true)
                    Divider()
                }
            }.padding(20)
        }
        .frame(width: 500, height: 440)
    }
}
