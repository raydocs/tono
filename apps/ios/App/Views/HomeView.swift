import SwiftUI
import TonoKit

/// Home: the sea scene carries the state at a glance; everything the thumb needs lives in the
/// smoked sheet at the bottom (reason → switch → line → lanes → speed), as on Android.
struct HomeView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showLines = false
    @State private var showSettings = false

    var body: some View {
        ZStack {
            TonoColor.night.ignoresSafeArea()
            SeaScene(sky: SkyState(model.phase), horizon: 0.44)
            VStack(spacing: 0) {
                topBar
                hero.padding(.horizontal, 28).padding(.vertical, 8)
                Spacer(minLength: 12)
                sheet
            }
        }
        .sheet(isPresented: $showLines) { LinesSheet().environmentObject(model) }
        #if DEBUG
        .onAppear {
            // Design preview only: `-TonoPreviewSheet lines|settings` opens a surface for screenshots.
            let args = CommandLine.arguments
            if let i = args.firstIndex(of: "-TonoPreviewSheet"), i + 1 < args.count {
                showLines = args[i + 1] == "lines"
                showSettings = args[i + 1] == "settings"
            }
        }
        #endif
        .fullScreenCover(isPresented: $showSettings) { SettingsView().environmentObject(model) }
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            TonoMark(size: 28)
            Text("Tono").font(.system(size: 17, weight: .semibold)).foregroundStyle(TonoColor.textPrimary)
            Spacer()
            Button { showSettings = true } label: {
                GlyphIcon(glyph: .gear, tint: TonoColor.textSecondary).frame(width: 48, height: 48).contentShape(Circle())
            }
            .accessibilityLabel(L.t("settings_title"))
        }
        .padding(.leading, 22).padding(.trailing, 10).padding(.top, 6)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(PhaseText.title(model.phase))
                .font(.system(size: 44, weight: .light))
                .tracking(0.5)
                .foregroundStyle(TonoColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
                .id(model.phase)
                .transition(.opacity)
            if let sentence = PhaseText.sentence(model) {
                Text(sentence).font(.system(size: 17)).lineSpacing(3).foregroundStyle(TonoColor.textSecondary)
                    .transition(.opacity)
            }
            if model.phase.tunnelUp, let since = model.connectedSince {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text(PhaseText.duration(since: since, now: context.date))
                        .font(.system(size: 14)).foregroundStyle(TonoColor.textTertiary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(TonoMotion.state, value: model.phase)
        .accessibilityElement(children: .combine)
    }

    private var sheet: some View {
        VStack(spacing: 14) {
            reasonBanner
            SunSwitch(
                isOn: model.phase.switchOn,
                busy: model.phase.busy,
                hint: L.t(model.phase.busy ? "switch_hint_busy" : model.phase.switchOn ? "switch_hint_on" : "switch_hint_off"),
                a11yLabel: L.t("switch_a11y"),
                stateLabel: PhaseText.title(model.phase),
                onToggle: { model.toggle($0) }
            )
            linePill
            lanes
            if model.phase.tunnelUp {
                Text(L.t("speed_line", Format.rate(model.rx), Format.rate(model.tx)))
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundStyle(TonoColor.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 2)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 10)
        .background(
            UnevenSheetShape(radius: 30)
                .fill(LinearGradient(colors: [TonoColor.smoke.opacity(0.90), TonoColor.nightDeep.opacity(0.97)], startPoint: .top, endPoint: .bottom))
                .overlay(UnevenSheetShape(radius: 30).stroke(TonoColor.hairline, lineWidth: 1))
                .ignoresSafeArea(edges: .bottom)
        )
        .animation(TonoMotion.state, value: model.phase)
    }

    @ViewBuilder private var reasonBanner: some View {
        if BannerAction.showsBanner(model.phase, reason: model.reason), let code = model.reason {
            let action = BannerAction.forPhase(model.phase, reason: code)
            Banner(text: PhaseText.reason(code), tone: model.phase == .failed ? TonoColor.error : TonoColor.warning,
                   action: action.title, onAction: { perform(action) })
                .transition(.opacity.combined(with: .move(edge: .top)))
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    private func perform(_ action: BannerAction) {
        switch action {
        case .allow, .retry: model.toggle(true)
        case .otherLine: showLines = true
        case .recheck: model.recheck()
        case .none: break
        }
    }

    private var linePill: some View {
        let line = model.lines.first { $0.name == model.selectedNode } ?? model.lines.first
        let name = line.map { Format.city($0.city, chinese: L.isChinese) + ($0.label.isEmpty ? "" : " · \($0.label)") } ?? L.t("line_pick")
        let latency = line?.latencyMS.map { L.t("latency_ms", $0) } ?? L.t("line_untested")
        return Button { showLines = true } label: {
            HStack(spacing: 12) {
                StatusDot(color: LatencyLevelColor.color(line?.latencyMS))
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.system(size: 16, weight: .medium)).foregroundStyle(TonoColor.textPrimary).lineLimit(1)
                    if model.usingCachedCatalog {
                        Text(L.t("lines_cached")).font(.system(size: 11)).foregroundStyle(TonoColor.warning).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Text(latency).font(.system(size: 14, weight: .medium).monospacedDigit()).foregroundStyle(TonoColor.textSecondary)
                GlyphIcon(glyph: .chevronRight, tint: TonoColor.textTertiary, size: 18)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 56)
            .background(TonoColor.smokeHigh.opacity(0.8), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(PressScale())
        .accessibilityHint(L.t("lines_title"))
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
            if model.mode == .stable {
                Lane(glyph: .apps, name: L.t("lane_other"), dest: L.t("lane_cloud"), probe: model.cloudProbe, live: live)
            } else {
                Lane(glyph: .apps, name: L.t("lane_other"), dest: L.t("lane_local"), probe: nil, live: live)
            }
        }
        .padding(.vertical, 4)
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(TonoColor.hairline, lineWidth: 1))
    }
}

private struct LaneDivider: View {
    var body: some View { Rectangle().fill(TonoColor.hairline).frame(height: 1).padding(.leading, 50) }
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
                .animation(.easeInOut(duration: 0.35), value: live)
            Text(name).font(.system(size: 14)).foregroundStyle(TonoColor.textPrimary).lineLimit(1)
            Spacer(minLength: 4)
            GlyphIcon(glyph: .arrow, tint: TonoColor.textTertiary, size: 14)
            Text(dest).font(.system(size: 14)).foregroundStyle(TonoColor.textSecondary).lineLimit(1)
            if live, let probe, let color = probeColor(probe) {
                StatusDot(color: color, size: 7)
                if let status = status(probe), !status.isEmpty {
                    Text(status).font(.system(size: 11)).foregroundStyle(TonoColor.textTertiary)
                }
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
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

/// Top-rounded sheet (UnevenRoundedRectangle needs iOS 17).
struct UnevenSheetShape: Shape {
    let radius: CGFloat
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: rect.maxY))
        p.addLine(to: CGPoint(x: 0, y: radius))
        p.addArc(center: CGPoint(x: radius, y: radius), radius: radius, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX - radius, y: 0))
        p.addArc(center: CGPoint(x: rect.maxX - radius, y: radius), radius: radius, startAngle: .degrees(270), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        return p
    }
}

/// Phase copy (Android `Text.kt`).
enum PhaseText {
    static func title(_ p: Phase) -> String {
        switch p {
        case .signedOut: return L.t("state_signed_out")
        case .idle: return L.t("state_idle")
        case .needsPermission: return L.t("state_permission")
        case .preparing: return L.t("state_preparing")
        case .connecting: return L.t("state_connecting")
        case .connected: return L.t("state_connected")
        case .degraded: return L.t("state_degraded")
        case .disconnecting: return L.t("state_disconnecting")
        case .failed: return L.t("state_failed")
        }
    }

    @MainActor static func sentence(_ m: AppModel) -> String? {
        switch m.phase {
        case .idle: return L.t("sentence_idle")
        case .needsPermission: return L.t("sentence_permission")
        case .preparing: return L.t("sentence_preparing")
        case .connecting: return L.t("sentence_connecting")
        case .connected:
            if m.homeKind == .none { return L.t(m.mode == .stable ? "sentence_connected_stable_no_home" : "sentence_connected_no_home") }
            return L.t(m.mode == .stable ? "sentence_connected_stable" : "sentence_connected_three_tier")
        default: return nil
        }
    }

    static func duration(since: Date, now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(since) / 60))
        if minutes < 1 { return L.t("duration_just") }
        if minutes < 60 { return L.t("duration_minutes", minutes) }
        return L.t("duration_hours", minutes / 60, minutes % 60)
    }

    static let knownReasons: Set<String> = [
        "HOME_UNAVAILABLE", "NETWORK", "RATE_LIMITED", "CORE_START", "CLOUD_UNREACHABLE", "HOME_UNREACHABLE",
        "REVOKED", "DENIED", "SESSION_ENDED", "CATALOG_ROLLBACK", "CORE_STOPPED",
    ]

    static func reason(_ code: String) -> String {
        knownReasons.contains(code) ? L.t("reason_\(code)") : L.t("reason_generic", code)
    }

    static func signInError(_ code: String) -> String {
        let known: Set<String> = ["INVALID_EMAIL", "INVALID_CODE", "INVALID_OR_EXPIRED_CODE", "NETWORK", "RATE_LIMITED", "DEVICE_LIMIT"]
        return known.contains(code) ? L.t("signin_error_\(code)") : L.t("signin_error_generic", code)
    }
}

extension BannerAction {
    var title: String? {
        switch self {
        case .allow: return L.t("action_allow")
        case .otherLine: return L.t("action_other_line")
        case .recheck: return L.t("action_recheck")
        case .retry: return L.t("action_retry")
        case .none: return nil
        }
    }
}
