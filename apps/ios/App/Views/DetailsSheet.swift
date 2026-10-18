import SwiftUI
import TonoKit
import UIKit

/// Details behind the home screen: where each kind of traffic goes right now, what happened (the
/// full reason and its one action), and the routing mode. Home keeps only the state, one line and
/// the action.
struct DetailsSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    /// Settings from inside the sheet as well (Home has it in the bottom row).
    private let onSettings: () -> Void
    /// "Other line" (the cloud exit is not answering) closes Details and opens the line picker.
    private let onOtherLine: () -> Void

    init(onSettings: @escaping () -> Void = {}, onOtherLine: @escaping () -> Void = {}) {
        self.onSettings = onSettings
        self.onOtherLine = onOtherLine
    }

    /// Medium by default (large at accessibility sizes); typing in the route check grows it to large,
    /// so the field, the keyboard and the answer fit together.
    @State private var detent: PresentationDetent = .medium

    private var detents: Set<PresentationDetent> {
        typeSize.isAccessibilitySize || DebugAccessibility.largeSheets ? [.large] : [.medium, .large]
    }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(L.t("details")).tonoFont(22, .semibold, relativeTo: .title2).foregroundStyle(TonoColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let code = model.reason, BannerAction.showsBanner(model.phase, reason: code) {
                    section(L.t("details_why")) {
                        let action = BannerAction.forPhase(model.phase, reason: code)
                        Banner(text: PhaseText.reason(code), tone: model.phase == .failed ? TonoColor.error : TonoColor.warning,
                               action: action.title, onAction: { perform(action) })
                    }
                }
                // The mode first: it decides the routes listed under it.
                section(L.t("details_mode")) { modePicker }
                section(L.t("details_routes")) { lanes(proxy) }
                Button(action: onSettings) {
                    HStack(spacing: 12) {
                        GlyphIcon(glyph: .gear, tint: TonoColor.textSecondary, size: 20)
                        Text(L.t("settings_title")).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                        Spacer(minLength: 0)
                        GlyphIcon(glyph: .chevronRight, tint: TonoColor.textSecondary, size: 14)
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 52)
                    .contentCard(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressScale())
                .accessibilityIdentifier("detailsSettings")
            }
            .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 20)
        }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .modifier(SheetSurface())
        .presentationDetents(detents, selection: $detent)
        .onAppear { if !detents.contains(detent) { detent = .large } }
        .presentationDragIndicator(.visible)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title)
            content()
        }
    }

    private func perform(_ action: BannerAction) {
        switch action {
        case .allow, .retry: model.toggle(true); dismiss()
        case .otherLine: onOtherLine()
        case .recheck: model.recheck()
        case .none: break
        }
    }

    private func lanes(_ proxy: ScrollViewProxy) -> some View {
        let homeDest: String
        switch model.homeKind {
        case .none: homeDest = L.t("lane_cloud_no_home")
        case .residential: homeDest = L.t("lane_home")
        case .catalogNode(let city): homeDest = L.t("lane_home_node", Format.city(city, chinese: L.isChinese))
        }
        let live = model.phase.tunnelUp
        return VStack(spacing: 0) {
            Lane(glyph: .ai, name: L.t("lane_ai"), dest: homeDest, probe: model.homeKind == .none ? model.cloudProbe : model.homeProbe, live: live)
            LaneDivider()
            Lane(glyph: .video, name: L.t("lane_video"), dest: L.t("lane_cloud"), probe: model.cloudProbe, live: live)
            LaneDivider()
            Lane(glyph: .apps, name: L.t("lane_other"), dest: L.t(model.mode == .stable ? "lane_cloud" : "lane_local"),
                 probe: model.mode == .stable ? model.cloudProbe : nil, live: live)
            LaneDivider()
            // "Where does a site go?" in the same card as where traffic goes (moved out of Settings);
            // the field's prompt carries the question, so it needs no section of its own.
            VStack(alignment: .leading, spacing: 8) {
                RouteCheck(onAnswer: {
                    // After the keyboard has gone and the answer has laid out.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        withAnimation(TonoMotion.surface) { proxy.scrollTo("routeAnswer", anchor: .bottom) }
                    }
                }, onFocus: { focused in
                    guard focused else { return }
                    detent = .large
                    // Lift the field and Check clear of the keyboard's top edge, not flush with it.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        withAnimation(TonoMotion.surface) { proxy.scrollTo("routeCheck", anchor: .center) }
                    }
                })
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .id("routeCheck")
        }
        .padding(.vertical, 4)
        .contentCard(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    /// Two segments and one plain sentence for the mode in effect. A switch shows as pending on the
    /// segment asked for until the tunnel confirms it; a refusal says so here and keeps the old one.
    private var modePicker: some View {
        let pending = model.changingRoutes ? model.routeChange?.requested.mode : nil
        return VStack(alignment: .leading, spacing: 8) {
            // Accessibility sizes stack the two, so "Three-tier" never breaks inside the word.
            let row = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 4)) : AnyLayout(HStackLayout(spacing: 4))
            row {
                modeSegment(.threeTier, pending: pending)
                modeSegment(.stable, pending: pending)
            }
            .padding(4)
            .contentCard(RoundedRectangle(cornerRadius: 16, style: .continuous))
            Group {
                if let pending, pending != model.mode {
                    Text(L.t("route_switching", ModeText.name(pending))).foregroundStyle(TonoColor.textSecondary)
                } else if let note = model.routeNote(full: true), model.routeChange?.requested.mode != model.mode {
                    Text(note).foregroundStyle(TonoColor.warning).accessibilityIdentifier("modeNotApplied")
                } else {
                    Text(ModeText.line(model.mode)).foregroundStyle(TonoColor.textSecondary).accessibilityIdentifier("modeLine")
                }
            }
            .tonoFont(14, relativeTo: .footnote)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 4)
        }
    }

    private func modeSegment(_ mode: RoutingMode, pending: RoutingMode?) -> some View {
        let selected = model.mode == mode
        let waiting = pending == mode && !selected
        return Button {
            guard !selected else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            Task { await model.setMode(mode) }
        } label: {
            HStack(spacing: 6) {
                if waiting { ProgressView().controlSize(.mini).tint(TonoColor.textPrimary) }
                Text(ModeText.name(mode)).tonoFont(16, .medium, relativeTo: .callout)
                    .foregroundStyle(selected ? TonoColor.textPrimary : TonoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(TonoColor.accent.opacity(0.28))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(TonoColor.accent.opacity(0.7), lineWidth: 1))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(pending != nil)
        .accessibilityLabel(ModeText.name(mode))
        .accessibilityValue(waiting ? L.t("route_switching", ModeText.name(mode)) : "")
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .accessibilityIdentifier("mode_\(mode.rawValue)")
    }
}

enum ModeText {
    static func name(_ mode: RoutingMode) -> String { L.t(mode == .stable ? "mode_stable_short" : "mode_three_tier_short") }
    /// What the mode does, in one plain sentence.
    static func line(_ mode: RoutingMode) -> String { L.t(mode == .stable ? "mode_stable_line" : "mode_three_tier_line") }
}

private struct LaneDivider: View {
    var body: some View { Rectangle().fill(TonoColor.hairline).frame(height: 1).padding(.leading, 46) }
}

private struct Lane: View {
    let glyph: Glyph
    let name: String
    let dest: String
    let probe: ExitProbe?
    let live: Bool

    var body: some View {
        HStack(spacing: 10) {
            GlyphIcon(glyph: glyph, tint: live ? TonoColor.accent : TonoColor.textTertiary)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Text(dest).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if live, let probe, let color = probeColor(probe) {
                        StatusDot(color: color, size: 6)
                        if let status = status(probe) {
                            Text(status).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.textTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
    }

    private func probeColor(_ p: ExitProbe) -> Color? {
        switch p.state {
        case .ok: return TonoColor.connected
        case .failed: return TonoColor.error
        case .checking: return TonoColor.warning
        case .unknown: return nil
        }
    }

    private func status(_ p: ExitProbe) -> String? {
        switch p.state {
        case .ok: return p.location.map(PhaseText.region)
        case .failed: return L.t("lane_down")
        case .checking: return L.t("lane_checking")
        case .unknown: return nil
        }
    }
}
