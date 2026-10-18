import SwiftUI
import UIKit
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
                if model.lines.isEmpty {
                    // Never an empty list without a word: loading says so, a failed load offers a retry.
                    if model.catalogLoading { loading } else { empty }
                } else {
                    LazyVStack(spacing: 6) {
                        ForEach(model.lines) { line in row(line) }
                    }
                }
            }
        }
        .padding(.horizontal, 20).padding(.top, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .modifier(SheetSurface())
        .presentationDetents(ax || DebugAccessibility.largeSheets ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var loading: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(0..<2, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(TonoColor.smokeHigh.opacity(0.6))
                    .frame(height: 56)
                    .overlay(alignment: .leading) {
                        Capsule().fill(TonoColor.textTertiary.opacity(0.25)).frame(width: 120, height: 12).padding(.leading, 40)
                    }
            }
            HStack(spacing: 8) {
                ProgressView().tint(TonoColor.textSecondary)
                Text(L.t("lines_loading")).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textSecondary)
            }
            .padding(.top, 6)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L.t("lines_loading"))
        .accessibilityIdentifier("linesLoading")
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L.t("lines_empty_title")).tonoFont(17, .semibold, relativeTo: .body).foregroundStyle(TonoColor.textPrimary)
                .accessibilityIdentifier("linesEmpty")
            Text(L.t("lines_empty_body")).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            QuietButton(title: L.t("lines_retry")) { Task { await model.reloadLines() } }
                .accessibilityIdentifier("linesRetry")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TonoColor.smokeHigh.opacity(0.6), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func row(_ line: LineItem) -> some View {
        let selected = line.name == model.selectedNode
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
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
                        .fixedSize(horizontal: false, vertical: true)
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
            // System sheet glass, smoked enough that Home's title never shows through behind rows
            // (0.72 read as a thick smoke over the glass in round 8's reviews; 0.6 still hides it).
            content.background(TonoColor.smoke.opacity(0.6).ignoresSafeArea())
        } else {
            content.background(TonoColor.smoke.ignoresSafeArea())
        }
    }
}
