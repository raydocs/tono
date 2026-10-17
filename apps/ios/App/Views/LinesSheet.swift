import SwiftUI
import TonoKit

/// Cloud line picker. Lines come only from the admitted exit catalog; nothing is invented here.
struct LinesSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var testing = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let ax = typeSize.isAccessibilitySize
        VStack(alignment: .leading, spacing: 12) {
            // At accessibility sizes title and button stack, and each row stacks, so nothing truncates.
            (ax ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout())) {
                Text(L.t("lines_title")).tonoFont(22, .semibold, relativeTo: .title2).foregroundStyle(TonoColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if !ax { Spacer() }
                QuietButton(title: L.t("lines_test")) {
                    guard !testing else { return }
                    testing = true
                    Task { await model.measureLatency(); testing = false }
                }
                .opacity(testing ? 0.5 : 1)
            }
            if model.usingCachedCatalog {
                Text(L.t("lines_cached")).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.warning)
            }
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(model.lines) { line in row(line) }
                }
            }
        }
        .padding(.horizontal, 20).padding(.top, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .modifier(SheetSurface())
        .presentationDetents(ax ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ line: LineItem) -> some View {
        let selected = line.name == model.selectedNode
        return Button {
            Task { await model.select(line.name) }
            dismiss()
        } label: {
            let ax = typeSize.isAccessibilitySize
            let latency = Text(line.latencyMS.map { L.t("latency_ms", $0) } ?? L.t("line_untested"))
                .tonoFont(15, .medium, relativeTo: .subheadline).monospacedDigit().foregroundStyle(TonoColor.textSecondary)
            let inUse = Text(L.t("lines_in_use")).tonoFont(12, .medium, relativeTo: .caption).foregroundStyle(TonoColor.accent)
            HStack(alignment: ax ? .top : .center, spacing: 12) {
                StatusDot(color: LatencyLevelColor.color(line.latencyMS))
                    .padding(.top, ax ? 10 : 0)
                VStack(alignment: .leading, spacing: 2) {
                    Text(Format.city(line.city, chinese: L.isChinese)).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                    if !line.label.isEmpty {
                        Text(line.label).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.textSecondary)
                    }
                    if ax {
                        latency
                        if selected { inUse }
                    }
                }
                if !ax {
                    Spacer(minLength: 8)
                    latency.layoutPriority(1)
                    if selected { inUse.layoutPriority(1) }
                }
                if ax { Spacer(minLength: 0) }
            }
            .padding(.horizontal, 16).padding(.vertical, ax ? 12 : 0)
            .frame(minHeight: 56)
            .background((selected ? TonoColor.accent.opacity(0.14) : TonoColor.smokeHigh.opacity(0.6)),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressScale())
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// iOS 26 gives sheets Liquid Glass; earlier systems get the smoked surface.
struct SheetSurface: ViewModifier {
    @Environment(\.tonoReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *), !reduceTransparency {
            // System sheet glass, smoked enough that Home's title never shows through behind rows.
            content.background(TonoColor.smoke.opacity(0.72).ignoresSafeArea())
        } else {
            content.background(TonoColor.smoke.ignoresSafeArea())
        }
    }
}
