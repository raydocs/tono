import SwiftUI
import TonoKit

/// Details behind the home screen: where each kind of traffic goes right now, what happened (the
/// full reason and its one action), and the routing mode. Home keeps only the state, one line and
/// the action.
struct DetailsSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text(L.t("details")).tonoFont(22, .semibold, relativeTo: .title2).foregroundStyle(TonoColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if let code = model.reason, BannerAction.showsBanner(model.phase, reason: code) {
                    section(L.t("details_why")) {
                        let action = BannerAction.forPhase(model.phase, reason: code)
                        Banner(text: PhaseText.reason(code), tone: model.phase == .failed ? TonoColor.error : TonoColor.warning,
                               action: action.title, onAction: { perform(action) })
                    }
                }
                section(L.t("details_routes")) { lanes }
                section(L.t("details_mode")) { modePicker }
            }
            .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .modifier(SheetSurface())
        .presentationDetents([.medium, .large])
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
        case .otherLine: dismiss()
        case .recheck: model.recheck()
        case .none: break
        }
    }

    private var lanes: some View {
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
        }
        .padding(.vertical, 4)
        .glassSurface(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var modePicker: some View {
        VStack(spacing: 0) {
            modeRow(.threeTier, title: L.t("mode_three_tier_short"), desc: L.t("mode_three_tier_desc"))
            LaneDivider()
            modeRow(.stable, title: L.t("mode_stable_short"), desc: L.t("mode_stable_desc"))
        }
        .glassSurface(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func modeRow(_ mode: RoutingMode, title: String, desc: String) -> some View {
        let selected = model.mode == mode
        return Button {
            guard !selected else { return }
            Task { await model.setMode(mode) }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .strokeBorder(selected ? TonoColor.accent : TonoColor.textTertiary, lineWidth: 1.6)
                    .background(Circle().fill(selected ? TonoColor.accent : .clear).padding(5))
                    .frame(width: 20, height: 20)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                    Text(desc).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
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
                Text(name).tonoFont(14, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary)
                HStack(spacing: 6) {
                    Text(dest).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.textSecondary)
                    if live, let probe, let color = probeColor(probe) {
                        StatusDot(color: color, size: 6)
                        if let status = status(probe) {
                            Text(status).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.textTertiary)
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
        case .ok: return p.location
        case .failed: return L.t("lane_down")
        case .checking: return L.t("lane_checking")
        case .unknown: return nil
        }
    }
}
