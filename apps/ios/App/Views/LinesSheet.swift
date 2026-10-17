import SwiftUI
import TonoKit

/// Cloud line picker. Lines come only from the admitted exit catalog; nothing is invented here.
struct LinesSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var testing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(L.t("lines_title")).font(.system(size: 22, weight: .semibold)).foregroundStyle(TonoColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                QuietButton(title: L.t("lines_test")) {
                    guard !testing else { return }
                    testing = true
                    Task { await model.measureLatency(); testing = false }
                }
                .opacity(testing ? 0.5 : 1)
            }
            if model.usingCachedCatalog {
                Text(L.t("lines_cached")).font(.system(size: 13)).foregroundStyle(TonoColor.warning)
            }
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(model.lines) { line in row(line) }
                }
            }
        }
        .padding(.horizontal, 20).padding(.top, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(TonoColor.smoke.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ line: LineItem) -> some View {
        let selected = line.name == model.selectedNode
        return Button {
            Task { await model.select(line.name) }
            dismiss()
        } label: {
            HStack(spacing: 12) {
                StatusDot(color: LatencyLevelColor.color(line.latencyMS))
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.city(line.city, chinese: L.isChinese)).font(.system(size: 16, weight: .medium)).foregroundStyle(TonoColor.textPrimary).lineLimit(1)
                    if !line.label.isEmpty {
                        Text(line.label).font(.system(size: 13)).foregroundStyle(TonoColor.textSecondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Text(line.latencyMS.map { L.t("latency_ms", $0) } ?? L.t("line_untested"))
                    .font(.system(size: 14, weight: .medium).monospacedDigit()).foregroundStyle(TonoColor.textSecondary)
                if selected {
                    Text(L.t("lines_in_use")).font(.system(size: 12, weight: .medium)).foregroundStyle(TonoColor.accent)
                }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 56)
            .background((selected ? TonoColor.accent.opacity(0.14) : TonoColor.smokeHigh.opacity(0.6)),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressScale())
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
