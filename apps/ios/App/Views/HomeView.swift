import SwiftUI
import TonoKit
import UIKit

/// Home (direction B, shared with Android and the desktop): the sea carries the state at a glance;
/// the thumb zone holds the state title, one status line, the primary capsule, the exit capsule and
/// the Details entry. Routes, the full reason and the mode live in `DetailsSheet`.
struct HomeView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showLines = false
    @State private var showDetails = false
    @State private var showSettings = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.tonoReduceMotion) private var reduceMotion
    /// The phase the last haptic was decided from (Android `PhaseHaptics` keeps the same).
    @State private var hapticPhase: Phase?

    var body: some View {
        ZStack(alignment: .top) {
            TonoColor.night.ignoresSafeArea()
            SeaScene(sky: SkyState(model.phase), horizon: 0.42)
            // Legibility scrim behind the lower controls; the sea stays visible above it.
            // Large text pushes the controls up over the sky, so the scrim starts higher there.
            // At accessibility sizes the text sits on the sky itself, so the scrim is near-opaque there.
            LinearGradient(colors: typeSize.isAccessibilitySize
                               ? [TonoColor.nightDeep.opacity(0.35), TonoColor.nightDeep.opacity(0.9), TonoColor.nightDeep.opacity(0.95)]
                               : [.clear, TonoColor.nightDeep.opacity(0.55), TonoColor.nightDeep.opacity(0.85)],
                           startPoint: UnitPoint(x: 0.5, y: typeSize.isAccessibilitySize ? 0.0 : 0.45), endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            VStack(spacing: 0) {
                // VoiceOver reads the state and its controls first (title → status → action → line →
                // details), then the top bar: the answer to "am I protected?" comes before chrome.
                topBar
                    .accessibilityElement(children: .contain)
                    .accessibilitySortPriority(0)
                Group {
                    if typeSize.isAccessibilitySize {
                        BottomScroll { controls.padding(.top, 24) }
                    } else {
                        Spacer(minLength: 0)
                        controls
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilitySortPriority(1)
            }
            // Sort priorities only order siblings inside one accessibility container.
            .accessibilityElement(children: .contain)
        }
        .sheet(isPresented: $showLines) { LinesSheet().environmentObject(model).tonoAccessibility() }
        .sheet(isPresented: $model.showVPNPrimer) { VPNPrimerSheet().environmentObject(model).tonoAccessibility() }
        .sheet(isPresented: $showDetails) {
            DetailsSheet(onSettings: openSettingsFromDetails).environmentObject(model).tonoAccessibility()
        }
        #if DEBUG
        .onAppear {
            // Design preview only: `-TonoPreviewSheet lines|details|settings` opens a surface for screenshots.
            let args = CommandLine.arguments
            if let i = args.firstIndex(of: "-TonoPreviewSheet"), i + 1 < args.count {
                showLines = args[i + 1] == "lines"
                showDetails = args[i + 1] == "details"
                showSettings = args[i + 1] == "settings"
                if args[i + 1] == "primer" { model.showVPNPrimer = true }
            }
        }
        #endif
        // A sheet, not a full-screen cover: swipe down closes it with the thumb.
        .sheet(isPresented: $showSettings) { SettingsView().environmentObject(model).tonoAccessibility() }
        .onChange(of: model.phase) { next in
            StateFeedback.arrived(at: next, from: hapticPhase)
            hapticPhase = next
        }
        // VoiceOver magic tap (two-finger double tap) runs the primary action from anywhere.
        .accessibilityAction(.magicTap) {
            if let want = PrimaryAction(model.phase).wantsTunnel { model.toggle(want) }
        }
    }

    private func openSettingsFromDetails() {
        showDetails = false
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 450_000_000)
            showSettings = true
        }
    }

    private var topBar: some View {
        HStack(spacing: 8) {
            TonoMark(size: 24)
            Text("Tono").tonoFont(17, .semibold, relativeTo: .headline).foregroundStyle(TonoColor.textPrimary)
            Spacer()
            Button { showSettings = true } label: {
                GlyphIcon(glyph: .gear, tint: TonoColor.textPrimary, size: 20)
                    .frame(width: 48, height: 48)
                    .glassSurface(Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(PressScale())
            .accessibilityLabel(L.t("settings_title"))
            .accessibilityIdentifier("settingsButton")
        }
        .padding(.leading, 22).padding(.trailing, 16).padding(.top, 4)
    }

    /// Everything the thumb needs, at the bottom: state, one line, one action, the exit, details.
    private var controls: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Old and new titles cross-fade in place (a ZStack, so they never stack during the change).
            ZStack(alignment: .leading) {
                Text(PhaseText.title(model.phase))
                    .tracking(0.5)
                    .tonoFont(40, .light, relativeTo: .largeTitle)
                    .foregroundStyle(TonoColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("stateTitle")
                    .id(model.phase)
                    // Android `crossRise`: the new word rises in from a third of its height, the old one
                    // lifts a quarter and fades faster.
                    .transition(reduceMotion ? AnyTransition.opacity
                                : AnyTransition.asymmetric(insertion: .opacity.animation(TonoMotion.state.delay(0.06)).combined(with: .offset(y: 16)),
                                                           removal: .opacity.animation(.easeOut(duration: 0.12)).combined(with: .offset(y: -12))))
            }
            ZStack(alignment: .leading) { statusLine }
                .frame(minHeight: 32, alignment: .topLeading)
                .padding(.top, 4)
                .padding(.bottom, 10)
            ActionCapsule(phase: model.phase, connectedSince: model.connectedSince) { model.toggle($0) }
                .accessibilityIdentifier("primaryAction")
            exitCapsule.padding(.top, 10)
            let footer = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout())
            footer {
                if model.phase.tunnelUp {
                    Text(L.t("speed_line", Format.rate(model.rx), Format.rate(model.tx)))
                        .tonoFont(12, .medium, relativeTo: .caption).monospacedDigit()
                        .foregroundStyle(TonoColor.textTertiary)
                        .contentTransition(.numericText())
                        .animation(TonoMotion.state, value: model.rx)
                        .frame(minHeight: 44)
                        .accessibilityElement(children: .combine)
                        .transition(.opacity)
                }
                if !typeSize.isAccessibilitySize { Spacer() }
                Button { showDetails = true } label: {
                    HStack(spacing: 4) {
                        Text(L.t("details")).tonoFont(15, .medium, relativeTo: .subheadline)
                        GlyphIcon(glyph: .chevronUp, tint: TonoColor.textSecondary, size: 14)
                    }
                    .foregroundStyle(TonoColor.textSecondary)
                    .frame(minWidth: 64, minHeight: 48)
                    .padding(.horizontal, 6)
                    .contentShape(Rectangle())
                    .accessibilityElement(children: .ignore)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L.t("details"))
                .accessibilityIdentifier("detailsButton")
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 6)
        .animation(TonoMotion.state, value: model.phase)
    }

    /// One quiet line under the title: exits when connected, progress while connecting, the short
    /// reason when something is wrong (the full reason lives in Details).
    @ViewBuilder private var statusLine: some View {
        let reason = model.reason
        if let reason, BannerAction.showsBanner(model.phase, reason: reason) {
            // The short reason opens Details (full reason + its one action); 44 pt tall for the thumb.
            Button { showDetails = true } label: {
                HStack(spacing: 8) {
                    StatusDot(color: model.phase == .failed ? TonoColor.error : TonoColor.warning, size: 7)
                    Text(PhaseText.short(reason)).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary)
                    GlyphIcon(glyph: .chevronRight, tint: TonoColor.textSecondary, size: 12)
                }
                .frame(minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
                .accessibilityElement(children: .ignore)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(PhaseText.short(reason))
            .accessibilityHint(PhaseText.reason(reason))
            .accessibilityIdentifier("reasonLine")
        } else if let text = PhaseText.status(model) {
            // The element is the 44 pt row, not the 18 pt glyph run (accessibility audit: hit area).
            Text(text).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textSecondary)
                .frame(minHeight: 44, alignment: .leading)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("statusLine")
        }
    }

    private var exitCapsule: some View {
        let line = model.lines.first { $0.name == model.selectedNode } ?? model.lines.first
        let name = line.map { Format.city($0.city, chinese: L.isChinese) + ($0.label.isEmpty ? "" : " · \($0.label)") } ?? L.t("line_pick")
        let latency = line?.latencyMS.map { L.t("latency_ms", $0) } ?? L.t("line_untested")
        let ax = typeSize.isAccessibilitySize
        let nameText = Text(name).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
        let cached = Text(L.t("lines_cached")).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.warning)
        let latencyText = Text(latency).tonoFont(15, .medium, relativeTo: .subheadline).monospacedDigit()
            .foregroundStyle(TonoColor.textSecondary)
        let chevron = GlyphIcon(glyph: .chevronDown, tint: TonoColor.textTertiary, size: 14)
        return Button { showLines = true } label: {
            Group {
                if ax {
                    // Accessibility sizes: the name gets the full width on its own lines (a capsule row
                    // broke "Tokyo" mid-word), latency and the chevron sit under it.
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            StatusDot(color: LatencyLevelColor.color(line?.latencyMS))
                            nameText.fixedSize(horizontal: false, vertical: true)
                        }
                        if model.usingCachedCatalog { cached.fixedSize(horizontal: false, vertical: true) }
                        HStack { latencyText; Spacer(minLength: 8); chevron }
                    }
                    .padding(.horizontal, 20).padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassSurface(RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                } else {
                    HStack(spacing: 12) {
                        StatusDot(color: LatencyLevelColor.color(line?.latencyMS))
                        VStack(alignment: .leading, spacing: 2) {
                            nameText.lineLimit(1)
                            if model.usingCachedCatalog { cached.lineLimit(2) }
                        }
                        Spacer(minLength: 0)
                        latencyText.fixedSize()
                        chevron
                    }
                    .padding(.horizontal, 18)
                    .frame(minHeight: 52)
                    .glassSurface(Capsule())
                    .contentShape(Capsule())
                }
            }
            .accessibilityElement(children: .ignore)
        }
        .buttonStyle(PressScale())
        .accessibilityLabel("\(L.t("lines_title")): \(name), \(latency)")
        .accessibilityIdentifier("exitCapsule")
    }
}

/// The primary capsule: exactly one action per phase. Warm gradient when it starts something,
/// a glass capsule with a sunrise fill while connecting, and a warm-edged glass capsule with the
/// session timer while connected.
struct ActionCapsule: View {
    let phase: Phase
    let connectedSince: Date?
    let onToggle: (Bool) -> Void
    @Environment(\.tonoReduceMotion) private var reduceMotion
    @State private var fill: Double = 0
    @State private var fillOpacity: Double = 1
    @State private var shake: CGFloat = 0
    @State private var shownPhase: Phase?

    private var action: PrimaryAction { PrimaryAction(phase) }

    var body: some View {
        Button {
            guard let want = action.wantsTunnel else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onToggle(want)
        } label: {
            HStack {
                // One line at every text size: shrink rather than hyphenate ("Dis-con-nect") at AX sizes.
                Text(title).tonoFont(17, .semibold, relativeTo: .body)
                    .lineLimit(1).minimumScaleFactor(0.6)
                Spacer(minLength: 8)
                trailing
            }
            .foregroundStyle(filled ? TonoColor.actionInk : TonoColor.textPrimary.opacity(action == .disconnecting ? 0.5 : 1))
            .padding(.horizontal, 22)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background { background }
            .overlay {
                Capsule().strokeBorder(phase.tunnelUp ? TonoColor.sunMid.opacity(0.55) : .clear, lineWidth: 1)
            }
            .contentShape(Capsule())
            // One leaf: the timer and arrow are not hit targets of their own; the timer is read in the value.
            .accessibilityElement(children: .ignore)
        }
        .buttonStyle(PressScale())
        .disabled(action.wantsTunnel == nil)
        .modifier(Shake(amount: shake))
        .onAppear { fill = PrimaryAction.progress(phase); fillOpacity = phase.tunnelUp ? 0 : 1; shownPhase = phase }
        .onChange(of: phase) { next in
            let wasUp = shownPhase?.tunnelUp == true
            shownPhase = next
            // Connected ⇄ partly working keeps the warm edge; the sunrise plays only on the way up.
            if wasUp && next.tunnelUp { return }
            let target = PrimaryAction.progress(next)
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.9)) { fill = target; if target > 0 { fillOpacity = 1 } }
            if next.tunnelUp {
                // Sunrise completes, then hands over to the warm edge.
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.6).delay(0.9)) { fillOpacity = 0 }
            }
            if next == .failed && !reduceMotion {
                withAnimation(.linear(duration: 0.38)) { shake += 1 }
            }
        }
        .accessibilityLabel(action == .cancel ? L.t("a11y_cancel_connect") : title)
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        if phase.tunnelUp, let connectedSince {
            return PhaseText.title(phase) + ", " + L.t("a11y_connected_for", PhaseText.clock(since: connectedSince, now: Date()))
        }
        return PhaseText.title(phase)
    }

    private var filled: Bool { action == .connect || action == .retry || action == .allowVPN }

    private var title: String {
        switch action {
        case .connect: return L.t("action_connect")
        case .retry: return L.t("action_retry")
        case .allowVPN: return L.t("action_allow_vpn")
        case .cancel: return L.t("action_cancel")
        case .disconnect: return L.t("action_disconnect")
        case .disconnecting: return L.t("action_disconnecting")
        case .signIn: return L.t("state_signed_out")
        }
    }

    @ViewBuilder private var trailing: some View {
        if filled {
            GlyphIcon(glyph: .arrow, tint: TonoColor.actionInk, size: 18)
        } else if phase.tunnelUp, let connectedSince {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(PhaseText.clock(since: connectedSince, now: context.date))
                    .tonoFont(15, .medium, relativeTo: .subheadline).monospacedDigit()
                    .foregroundStyle(TonoColor.textSecondary)
                    .lineLimit(1).fixedSize()
            }
        }
    }

    @ViewBuilder private var background: some View {
        if filled {
            Capsule().fill(TonoColor.actionFill)
        } else {
            ZStack(alignment: .leading) {
                Color.clear.glassSurface(Capsule())
                GeometryReader { geo in
                    Capsule()
                        .fill(LinearGradient(colors: [TonoColor.sunEdge.opacity(0.55), TonoColor.sunCore.opacity(0.85)],
                                             startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(geo.size.height, geo.size.width * fill))
                        .opacity(fill > 0 ? fillOpacity : 0)
                }
                .clipShape(Capsule())
            }
        }
    }
}

/// A short horizontal shake for a failed start (skipped under Reduce Motion).
private struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    /// Android's failure nudge: -7 pt at 60 ms, 6 at 140, -3 at 230, rest at 380 (one unit of `amount`).
    private static let keys: [(t: CGFloat, x: CGFloat)] = [(0, 0), (60.0 / 380, -7), (140.0 / 380, 6), (230.0 / 380, -3), (1, 0)]

    func effectValue(size: CGSize) -> ProjectionTransform {
        let t = amount - amount.rounded(.down)
        var x: CGFloat = 0
        for (a, b) in zip(Self.keys, Self.keys.dropFirst()) where t >= a.t && t <= b.t {
            x = a.x + (b.x - a.x) * (t - a.t) / (b.t - a.t)
        }
        return ProjectionTransform(CGAffineTransform(translationX: x, y: 0))
    }
}

/// System haptics when a state arrives, as Android `PhaseHaptics`: success only when a start
/// reaches connected (not on partly working → connected), error when it fails, nothing else.
/// Pressing the capsule adds a light tap (Android CONTEXT_CLICK). Not felt in a simulator.
enum StateFeedback {
    static func arrived(at phase: Phase, from previous: Phase?) {
        switch HapticCue.forChange(from: previous, to: phase) {
        case .success: UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
        case nil: break
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

    /// Session clock on the disconnect capsule: m:ss, then h:mm:ss.
    static func clock(since: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(since)))
        let h = seconds / 3600, m = seconds % 3600 / 60, s = seconds % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }

    /// The line under the title when nothing is wrong.
    @MainActor static func status(_ m: AppModel) -> String? {
        switch m.phase {
        case .idle: return m.offline ? L.t("status_offline") : L.t("sentence_idle")
        case .needsPermission: return L.t("sentence_permission_short")
        case .preparing: return L.t("sentence_preparing")
        case .connecting:
            // iOS reasserting the tunnel after a network change reads differently from a first start.
            return m.reason == "NETWORK_CHANGED" ? L.t("short_NETWORK_CHANGED") : L.t("sentence_connecting")
        case .connected, .degraded:
            let cloud = m.cloudProbe.state == .ok ? m.cloudProbe.location.map(region) : nil
            let home = m.homeKind == .none ? nil : (m.homeProbe.state == .ok ? m.homeProbe.location.map(region) : nil)
            if let cloud, let home { return L.t("status_exit_both", cloud, home) }
            if let cloud { return L.t("status_exit_cloud", cloud) }
            return L.t("status_protected")
        default: return nil
        }
    }

    /// "JP" → "日本" / "Japan" (the probe reports an ISO region code); unknown codes stay as they are.
    static func region(_ code: String) -> String {
        Locale(identifier: L.isChinese ? "zh-Hans" : "en").localizedString(forRegionCode: code) ?? code
    }

    static func short(_ code: String) -> String {
        knownReasons.contains(code) ? L.t("short_\(code)") : L.t("reason_generic", code)
    }

    static let knownReasons: Set<String> = [
        "HOME_UNAVAILABLE", "NETWORK", "RATE_LIMITED", "CORE_START", "CLOUD_UNREACHABLE", "HOME_UNREACHABLE",
        "REVOKED", "DENIED", "SESSION_ENDED", "CATALOG_ROLLBACK", "CORE_STOPPED", "NETWORK_CHANGED",
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
