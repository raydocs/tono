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
    @Environment(\.tonoReduceTransparency) private var reduceTransparency
    /// The phase the last haptic was decided from (Android `PhaseHaptics` keeps the same).
    @State private var hapticPhase: Phase?
    /// Sheets zoom out of the control that opened them.
    @Namespace private var zoom
    @ScaledMetric(relativeTo: .body) private var gearScaled: CGFloat = 20
    private var gearGlyph: CGFloat { min(gearScaled, 36) }

    var body: some View {
        ZStack(alignment: .top) {
            TonoColor.night.ignoresSafeArea()
            SeaScene(sky: sky, horizon: 0.42)
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
                // VoiceOver should read the state and its controls first (title → status → action →
                // line → details), then the top bar. XCUITest lists elements in layout order, so this
                // order is not checked in CI; it needs a VoiceOver pass on a device.
                topBar
                    .accessibilityElement(children: .contain)
                    .accessibilitySortPriority(0)
                Group {
                    if typeSize.isAccessibilitySize {
                        BottomScroll { controls.padding(.top, 24) }
                    } else {
                        Spacer(minLength: 0)
                        // No GlassEffectContainer here: it lifts the primary capsule's background glass
                        // over its label and blurs "Disconnect" (caught by the contrast sweep, run 39097318071).
                        controls
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilitySortPriority(1)
            }
            // Sort priorities only order siblings inside one accessibility container.
            .accessibilityElement(children: .contain)
        }
        .sheet(isPresented: $showLines) {
            LinesSheet().environmentObject(model).tonoAccessibility()
                .zoomTransition("lines", in: zoom, enabled: !reduceMotion)
        }
        .sheet(isPresented: $model.showVPNPrimer) {
            VPNPrimerSheet().environmentObject(model).tonoAccessibility()
                .zoomTransition("primary", in: zoom, enabled: !reduceMotion)
        }
        .sheet(isPresented: $showDetails) {
            DetailsSheet(onSettings: openSettingsFromDetails, onOtherLine: openLinesFromDetails).environmentObject(model).tonoAccessibility()
                .zoomTransition("details", in: zoom, enabled: !reduceMotion)
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
            // `-TonoPreviewSheetCycle`: opens and closes each sheet in turn, so the zoom out of its
            // control can be recorded (simctl cannot tap).
            if args.contains("-TonoPreviewSheetCycle") {
                Task { @MainActor in
                    let sheets: [Binding<Bool>] = [$showLines, $showDetails, $showSettings]
                    while true {
                        for sheet in sheets {
                            try? await Task.sleep(nanoseconds: 1_600_000_000)
                            sheet.wrappedValue = true
                            try? await Task.sleep(nanoseconds: 2_600_000_000)
                            sheet.wrappedValue = false
                        }
                    }
                }
            }
        }
        #endif
        // A sheet, not a full-screen cover: swipe down closes it with the thumb.
        .sheet(isPresented: $showSettings) {
            SettingsView().environmentObject(model).tonoAccessibility()
                .zoomTransition("settings", in: zoom, enabled: !reduceMotion)
        }
        .onChange(of: model.phase) { next in
            StateFeedback.arrived(at: next, from: hapticPhase)
            hapticPhase = next
        }
        // VoiceOver magic tap (two-finger double tap) runs the primary action from anywhere.
        .accessibilityAction(.magicTap) {
            if let want = PrimaryAction(model.phase).wantsTunnel { model.toggle(want) }
        }
    }

    private var sky: SkyState { SkyState(model.phase, reason: model.reason) }

    /// The glass takes the colour of the sky above it: indigo at night, rose once the sun is up,
    /// ember when something is wrong.
    private var glassTint: Color {
        switch sky {
        case .night, .dawn: return TonoColor.glassTint
        case .rising, .reconnecting, .day: return Color(hex: 0x5A2E52)
        case .duskWarning, .ember: return Color(hex: 0x5A2A2C)
        }
    }

    /// The sea's reflection continues under the controls as one soft column of light, so both glass
    /// capsules show the same light through them (round 8 drew a separate ellipse on each, which
    /// read as two stamps). The sun's sits at the centre, the moon's to the right (the moon is drawn
    /// at 78% of the width; the capsules start 22 pt in).
    private var reflection: (color: Color, x: CGFloat) {
        switch sky {
        case .night: return (TonoColor.moon.opacity(0.4), 0.81)
        case .dawn, .rising, .reconnecting, .day: return (TonoColor.sunMid, 0.5)
        case .duskWarning, .ember: return (TonoColor.sunEdge.opacity(0.8), 0.5)
        }
    }

    private func openLinesFromDetails() {
        showDetails = false
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 450_000_000)
            showLines = true
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
            // The wordmark is a name, not content: at accessibility sizes the mark alone keeps the
            // room for the state and its controls.
            if !typeSize.isAccessibilitySize {
                Text("Tono").tonoFont(17, .semibold, relativeTo: .headline).foregroundStyle(TonoColor.textPrimary)
            }
            Spacer()
        }
        // Settings lives in the bottom row with Details, inside the thumb's reach; the top bar
        // only names the app. Same height as before, so the sky does not move.
        .frame(minHeight: 48)
        .padding(.leading, 22).padding(.trailing, 16).padding(.top, 4)
    }

    /// At accessibility sizes one word per line, each kept whole (shrunk if it must be): a wrapped
    /// title broke "Reconnecting" inside the word at AX5 (round 11 capture). Read as one header.
    @ViewBuilder private func stateTitle(_ title: String) -> some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(title.split(separator: " ").enumerated()), id: \.offset) { _, word in
                    Text(String(word)).lineLimit(1).minimumScaleFactor(0.5)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title)
            .accessibilityAddTraits(.isStaticText)
        } else {
            Text(title)
        }
    }

    /// Everything the thumb needs, at the bottom: state, one line, one action, the exit, details.
    private var controls: some View {
        VStack(alignment: .leading, spacing: 0) {
            // The old title leaves before the new one arrives, in place (a ZStack, so they never stack
            // and never show two words at once).
            ZStack(alignment: .leading) {
                stateTitle(PhaseText.title(model.phase, reason: model.reason))
                    .tracking(0.5)
                    .tonoFont(40, .light, relativeTo: .largeTitle)
                    .foregroundStyle(TonoColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("stateTitle")
                    .id(PhaseText.title(model.phase, reason: model.reason))
                    // Android `crossRise`: the new word rises in from a third of its height after the old
                    // one has lifted and gone.
                    .transition(.swap(rise: 16, reduceMotion: reduceMotion))
            }
            ZStack(alignment: .leading) { statusLine }
                .frame(minHeight: 32, alignment: .topLeading)
                .padding(.top, 4)
                .padding(.bottom, 10)
            VStack(spacing: 10) {
                ActionCapsule(phase: model.phase, reason: model.reason, connectedSince: model.connectedSince, glassTint: glassTint) { model.toggle($0) }
                    .zoomSource("primary", in: zoom)
                    .accessibilityIdentifier("primaryAction")
                exitCapsule
            }
            .background { if !reduceTransparency { ReflectionColumn(color: reflection.color, x: reflection.x) } }
            let footer = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout())
            footer {
                if model.phase.tunnelUp {
                    Text(L.t("speed_line", Format.rate(model.rx), Format.rate(model.tx)))
                        .tonoFont(12, .medium, relativeTo: .caption).monospacedDigit()
                        .foregroundStyle(TonoColor.textTertiary)
                        // Rates roll between live values; the drop to zero as the tunnel stops is not
                        // animated, or the digits morph into each other while the line fades
                        // ("184/4 K", state-cycle @ b36d07d 17.3 s).
                        .contentTransition(model.rx == 0 && model.tx == 0 ? .identity : .numericText())
                        .animation(model.rx == 0 && model.tx == 0 ? nil : TonoMotion.state, value: model.rx)
                        .frame(minHeight: 44)
                        .accessibilityElement(children: .combine)
                        .transition(.opacity)
                }
                if !typeSize.isAccessibilitySize { Spacer() }
                // Two separate glass controls with a clear gap, so Settings and Details never read
                // as one button (round 9 review).
                HStack(spacing: 14) {
                    // A glass circle like the old top-right gear, so it reads as a control; the
                    // glyph grows with the text size.
                    Button { showSettings = true } label: {
                        GlyphIcon(glyph: .gear, tint: TonoColor.textPrimary, size: gearGlyph)
                            .frame(width: gearGlyph + 26, height: gearGlyph + 26)
                            .glassSurface(Circle(), tint: glassTint, interactive: true)
                            .contentShape(Circle())
                    }
                    .buttonStyle(PressScale(glass: true))
                    .zoomSource("settings", in: zoom)
                    .accessibilityLabel(L.t("settings_title"))
                    .accessibilityIdentifier("settingsButton")
                    Button { showDetails = true } label: {
                        HStack(spacing: 4) {
                            Text(L.t("details")).tonoFont(15, .medium, relativeTo: .subheadline)
                            GlyphIcon(glyph: .chevronUp, tint: TonoColor.textPrimary, size: 14)
                        }
                        .foregroundStyle(TonoColor.textPrimary)
                        .padding(.horizontal, 16)
                        .frame(minWidth: 64, minHeight: gearGlyph + 26)
                        .glassSurface(Capsule(), tint: glassTint, interactive: true)
                        .contentShape(Capsule())
                        .accessibilityElement(children: .ignore)
                    }
                    .buttonStyle(PressScale(glass: true))
                    .zoomSource("details", in: zoom)
                    .accessibilityLabel(L.t("details"))
                    .accessibilityIdentifier("detailsButton")
                }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 22)
        .padding(.bottom, 6)
        .animation(reduceMotion ? nil : TonoMotion.state, value: model.phase)
        .transaction { if reduceMotion { $0.animation = nil; $0.disablesAnimations = true } }
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
            .id(reason)
            .transition(.swap(rise: 8, reduceMotion: reduceMotion))
        } else if let note = model.routeNote(full: false), model.phase.tunnelUp {
            // A mode or line switch the tunnel refused: said on Home too, since the sheet it was made
            // in may already be closed. Opens where the switch is made.
            Button {
                if model.routeChange?.requested.mode != model.mode { showDetails = true } else { showLines = true }
            } label: {
                HStack(spacing: 8) {
                    StatusDot(color: TonoColor.warning, size: 7)
                    Text(note).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary)
                    GlyphIcon(glyph: .chevronRight, tint: TonoColor.textSecondary, size: 12)
                }
                .frame(minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
                .accessibilityElement(children: .ignore)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.routeNote(full: true) ?? note)
            .accessibilityIdentifier("routeNote")
            .id(note)
            .transition(.swap(rise: 8, reduceMotion: reduceMotion))
        } else if let text = PhaseText.status(model) {
            // The element is the 44 pt row, not the 18 pt glyph run (accessibility audit: hit area).
            Text(text).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textSecondary)
                .frame(minHeight: 44, alignment: .leading)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("statusLine")
                .id(text)
                .transition(.swap(rise: 8, reduceMotion: reduceMotion))
        }
    }

    private var exitCapsule: some View {
        // Only the line in use (confirmed while the tunnel is up), never another one in its place.
        let line = model.currentLine
        let name = line.map(model.displayName) ?? L.t(model.routing == nil ? "line_pick" : "line_unconfirmed")
        let latency = line?.latencyMS.map { L.t("latency_ms", $0) } ?? L.t("line_untested")
        let ax = typeSize.isAccessibilitySize
        let nameText = Text(name).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
        let cached = Text(L.t("lines_cached")).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.warning)
        let latencyText = Text(latency).tonoFont(15, .medium, relativeTo: .subheadline).monospacedDigit()
            .foregroundStyle(TonoColor.textSecondary)
        let chevron = GlyphIcon(glyph: .chevronDown, tint: TonoColor.textTertiary, size: 14)
        // A line switch waiting on the tunnel spins where the latency was; one it never answered
        // says Unconfirmed there, so the name above is not read as confirmed.
        let change = model.unsettled(\.node)
        let asked = change.map { c in model.lines.first { $0.name == c.value }.map(model.displayName) ?? c.value ?? "" }
        let trailing = Group {
            if let change, change.pending {
                ProgressView().controlSize(.small).tint(TonoColor.textPrimary)
            } else if change != nil {
                Text(L.t("line_unconfirmed")).tonoFont(13, .medium, relativeTo: .footnote).foregroundStyle(TonoColor.warning)
            } else {
                latencyText
            }
        }
        let status: String = {
            guard let change, let asked else { return latency }
            return change.pending ? L.t("route_switching", asked) : L.t("route_unconfirmed", asked)
        }()
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
                        HStack { trailing; Spacer(minLength: 8); chevron }
                    }
                    .padding(.horizontal, 20).padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassSurface(RoundedRectangle(cornerRadius: 26, style: .continuous), tint: glassTint, interactive: true)
                    .contentShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                } else {
                    HStack(spacing: 12) {
                        StatusDot(color: LatencyLevelColor.color(line?.latencyMS))
                        VStack(alignment: .leading, spacing: 2) {
                            nameText.lineLimit(1)
                            if model.usingCachedCatalog { cached.lineLimit(2) }
                        }
                        Spacer(minLength: 0)
                        trailing.fixedSize()
                        chevron
                    }
                    .padding(.horizontal, 18)
                    .frame(minHeight: 52)
                    .glassSurface(Capsule(), tint: glassTint, interactive: true)
                    .contentShape(Capsule())
                }
            }
            .accessibilityElement(children: .ignore)
        }
        .buttonStyle(PressScale(glass: true))
        .zoomSource("lines", in: zoom)
        .accessibilityLabel("\(L.t("lines_title")): \(name), \(status)")
        .accessibilityIdentifier("exitCapsule")
    }
}

/// The primary capsule: exactly one action per phase. Warm gradient when it starts something,
/// a glass capsule with a sunrise fill while connecting, and a warm-edged glass capsule with the
/// session timer while connected.
struct ActionCapsule: View {
    let phase: Phase
    var reason: String?
    let connectedSince: Date?
    var glassTint: Color? = nil
    let onToggle: (Bool) -> Void
    @Environment(\.tonoReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var fill: Double = 0
    @State private var fillOpacity: Double = 1
    @State private var shake: CGFloat = 0
    @State private var shownPhase: Phase?
    @State private var shownReconnecting = false

    /// DEBUG negative control for the label measurement (`-TonoPreviewRound11Fill`): round 11's
    /// translucent fill with the white label only, in the real scene. Always false in Release.
    static let round11Fill: Bool = {
        #if DEBUG
        return CommandLine.arguments.contains("-TonoPreviewRound11Fill")
        #else
        return false
        #endif
    }()

    private var action: PrimaryAction { PrimaryAction(phase) }
    /// iOS reasserting a tunnel that was up: the capsule keeps its warm edge and a light passes
    /// along it, instead of replaying the sunrise of a first start.
    private var reconnecting: Bool { phase == .connecting && reason == "NETWORK_CHANGED" }

    var body: some View {
        Button {
            guard let want = action.wantsTunnel else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onToggle(want)
        } label: {
            labelRow(filled ? TonoColor.actionInk : TonoColor.textPrimary.opacity(action == .disconnecting ? 0.5 : 1))
                // The sunrise fill is opaque and light: over it the label is drawn in the action ink
                // (8.6:1 or more on the fill), over the glass beside it in white. White on the fill
                // read 3.0:1 (Preparing) and 3.9:1 (Connecting) in round 11's captures.
                .overlay {
                    if !filled && !Self.round11Fill {
                        labelRow(TonoColor.actionInk)
                            .mask(alignment: .leading) { fillMask }
                            .opacity(fill > 0 ? fillOpacity : 0)
                            .accessibilityHidden(true)
                    }
                }
            .background { background }
            .overlay {
                shape.stroke(phase.tunnelUp || reconnecting ? TonoColor.sunMid.opacity(0.55) : .clear, lineWidth: 1)
            }
            .contentShape(shape)
            // One leaf: the timer and arrow are not hit targets of their own; the timer is read in the value.
            .accessibilityElement(children: .ignore)
        }
        .buttonStyle(PressScale(glass: !filled))
        .disabled(action.wantsTunnel == nil)
        .modifier(Shake(amount: shake))
        .transaction { if reduceMotion { $0.animation = nil; $0.disablesAnimations = true } }
        .onAppear {
            fill = PrimaryAction.progress(phase)
            fillOpacity = phase.tunnelUp || reconnecting ? 0 : 1
            shownPhase = phase
            shownReconnecting = reconnecting
        }
        // Keyed on the phase and the reason together: the iOS 16 `onChange` closure sees the previous
        // render's properties, so `reason` read inside it would be stale (state-cycle-en.mp4 @ fc9c812
        // replayed the sunrise on connected → reconnecting).
        .onChange(of: CapsuleState(phase: phase, reconnecting: reconnecting)) { change in
            let next = change.phase
            let wasUp = shownPhase?.tunnelUp == true || shownReconnecting
            shownPhase = next
            shownReconnecting = change.reconnecting
            if reduceMotion {
                fill = PrimaryAction.progress(next)
                fillOpacity = next.tunnelUp || change.reconnecting ? 0 : 1
                return
            }
            // Connected ⇄ partly working ⇄ reconnecting keeps the warm edge; the sunrise plays only
            // on the way up from off.
            if wasUp && (next.tunnelUp || change.reconnecting) {
                fillOpacity = 0
                return
            }
            let target = PrimaryAction.progress(next)
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.9)) { fill = target; if target > 0 { fillOpacity = 1 } }
            if next.tunnelUp {
                // Hand over to the warm edge as the connected label arrives.
                withAnimation(.easeOut(duration: 0.6).delay(0.3)) { fillOpacity = 0 }
            }
            if next == .failed && !reduceMotion {
                withAnimation(.linear(duration: 0.38)) { shake += 1 }
            }
        }
        .accessibilityLabel(action == .cancel ? L.t("a11y_cancel_connect") : title)
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        if phase.tunnelUp || reconnecting, let connectedSince {
            return PhaseText.title(phase, reason: reason) + ", " + L.t("a11y_connected_for", PhaseText.clock(since: connectedSince, now: Date()))
        }
        return PhaseText.title(phase, reason: reason)
    }

    /// A capsule, or a rounded rectangle once accessibility text makes it two lines tall (a tall
    /// capsule's round ends would cut into the label).
    private var shape: AnyShape {
        typeSize.isAccessibilitySize ? AnyShape(RoundedRectangle(cornerRadius: 28, style: .continuous)) : AnyShape(Capsule())
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

    /// The label row at full capsule width, in one ink.
    private func labelRow(_ ink: Color) -> some View {
        // Accessibility sizes: the action gets the full width and the session timer goes under
        // it, instead of the label shrinking beside a fixed-width timer.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
                                                  : AnyLayout(HStackLayout())
        return layout {
            // One line at every text size: shrink rather than hyphenate ("Dis-con-nect") at AX sizes.
            // The old action leaves before the new one shows, so "Connect" and "Cancel" never overlap.
            ZStack(alignment: .leading) {
                Text(title).tonoFont(17, .semibold, relativeTo: .body)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .id(title)
                    .transition(.swap(rise: 0, reduceMotion: reduceMotion))
            }
            .layoutPriority(1)
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            trailing
        }
        .padding(.vertical, typeSize.isAccessibilitySize ? 10 : 0)
        .foregroundStyle(ink)
        .padding(.horizontal, 22)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
    }

    /// The filled part of the capsule, the same width as the sunrise fill.
    private var fillMask: some View {
        GeometryReader { geo in
            // The fill's own shape (round right end), so ink never lands on the glass beside it.
            shape.frame(width: max(geo.size.height, geo.size.width * fill), height: geo.size.height)
        }
    }

    @ViewBuilder private var trailing: some View {
        if filled {
            if !typeSize.isAccessibilitySize { GlyphIcon(glyph: .arrow, tint: TonoColor.actionInk, size: 18) }
        } else if phase.tunnelUp || reconnecting, let connectedSince {
            // A network change does not end the session: its clock keeps running (iOS keeps the
            // connected date while it reasserts).
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(PhaseText.clock(since: connectedSince, now: context.date))
                    .tonoFont(15, .medium, relativeTo: .subheadline).monospacedDigit()
                    .foregroundStyle(TonoColor.textSecondary)
                    .lineLimit(1).fixedSize()
            }
            // The clock arrives after the sunrise fill has handed over, not on top of its bright
            // end (state-cycle @ b36d07d 2.7 s; a fade tied to the fill still showed it faintly).
            .transition(reduceMotion ? .identity : .asymmetric(insertion: .opacity.animation(.easeOut(duration: 0.3).delay(1.4)),
                                    removal: .opacity.animation(.easeOut(duration: 0.1))))
        }
    }

    @ViewBuilder private var background: some View {
        if filled {
            shape.fill(TonoColor.actionFill)
        } else {
            ZStack(alignment: .leading) {
                Color.clear.glassSurface(shape, tint: glassTint, interactive: true)
                GeometryReader { geo in
                    shape
                        // Opaque, the Connect capsule's own warm gradient: the ink label over it is 8.6:1 or more.
                        .fill(Self.round11Fill
                              ? LinearGradient(colors: [TonoColor.sunEdge.opacity(0.55), TonoColor.sunCore.opacity(0.85)],
                                               startPoint: .leading, endPoint: .trailing)
                              : LinearGradient(colors: [Color(hex: 0xFF9E6B), Color(hex: 0xFFD6A3)],
                                               startPoint: .leading, endPoint: .trailing))
                        .frame(width: max(geo.size.height, geo.size.width * fill))
                        .opacity(fill > 0 ? fillOpacity : 0)
                }
                .clipShape(shape)
                if reconnecting && !reduceMotion { ReacquireSweep().clipShape(shape) }
            }
        }
    }
}

extension AnyTransition {
    /// Text that changes in place: the old words fade out in 100 ms, then the new ones fade in (and
    /// rise `rise` points), so two states are never legible on top of each other.
    static func swap(rise: CGFloat, reduceMotion: Bool) -> AnyTransition {
        if reduceMotion { return .identity }
        let leave = AnyTransition.opacity.animation(.easeOut(duration: 0.1))
        let arrive = AnyTransition.opacity.animation(TonoMotion.state.delay(0.1))
        guard rise > 0 else { return .asymmetric(insertion: arrive, removal: leave) }
        return .asymmetric(insertion: arrive.combined(with: .offset(y: rise)), removal: leave.combined(with: .offset(y: -rise * 0.75)))
    }
}

/// The reflection's light under the capsules: one vertical column, brightest near the horizon,
/// blurred, behind the glass (which carries it through). Decorative.
private struct ReflectionColumn: View {
    let color: Color
    let x: CGFloat

    var body: some View {
        GeometryReader { geo in
            Rectangle()
                .fill(LinearGradient(colors: [color.opacity(0.34), color.opacity(0.1)], startPoint: .top, endPoint: .bottom))
                .frame(width: 64, height: geo.size.height + 24)
                .blur(radius: 16)
                .position(x: geo.size.width * x, y: geo.size.height / 2)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct CapsuleState: Equatable {
    let phase: Phase
    let reconnecting: Bool
}

/// A soft warm band crossing the capsule every 1.6 s (the reflection's light, in the control),
/// while iOS reasserts the tunnel. Decorative; Reduce Motion leaves the static warm edge.
private struct ReacquireSweep: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
            let p = (timeline.date.timeIntervalSinceReferenceDate / 1.6).truncatingRemainder(dividingBy: 1)
            GeometryReader { geo in
                let band = geo.size.width * 0.35
                LinearGradient(colors: [.clear, TonoColor.sunMid.opacity(0.28), .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: band)
                    .offset(x: -band + (geo.size.width + band) * p)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
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
    /// The state title. A start that failed and a session that dropped are different stories, as
    /// are a first start and iOS reconnecting after a network change.
    static func title(_ p: Phase, reason: String? = nil) -> String {
        if p == .failed, reason == "CORE_STOPPED" { return L.t("state_dropped") }
        // The tunnel did connect; what stopped is its routing after a refused change.
        if p == .failed, reason == "ROUTES_STOPPED" { return L.t("state_routes_stopped") }
        if p == .connecting, reason == "NETWORK_CHANGED" { return L.t("state_reconnecting") }
        // Network Extension says up; the tunnel has not confirmed what it runs.
        if p == .connecting, reason == "UNCONFIRMED" { return L.t("state_unconfirmed") }
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
            if m.reason == "UNCONFIRMED" { return L.t("status_unconfirmed") }
            return m.reason == "NETWORK_CHANGED" ? L.t("status_network_changed") : L.t("sentence_connecting")
        case .connected, .degraded:
            if m.offline { return L.t("status_offline") }
            let home = m.homeKind == .none ? nil : (m.homeProbe.state == .ok ? m.homeProbe.location.map { L.isChinese ? region($0) : $0.uppercased() } : nil)
            if let home { return L.t("status_protected_home", home) }
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
        "REVOKED", "DENIED", "SESSION_ENDED", "CATALOG_ROLLBACK", "CORE_STOPPED", "NETWORK_CHANGED", "ROUTES_STOPPED",
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

/// A sheet grows out of the control that opened it and shrinks back into it (iOS 18 zoom; on
/// iOS 26 the glass control morphs into the sheet). Reduce Motion keeps the plain sheet.
private struct ZoomSource: ViewModifier {
    let id: String
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}

private struct ZoomTransition: ViewModifier {
    let id: String
    let namespace: Namespace.ID
    let enabled: Bool

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *), enabled {
            content.navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            content
        }
    }
}

// App only: the widget extension compiles Theme.swift and has no sheets.
extension View {
    func zoomSource(_ id: String, in namespace: Namespace.ID) -> some View {
        modifier(ZoomSource(id: id, namespace: namespace))
    }

    func zoomTransition(_ id: String, in namespace: Namespace.ID, enabled: Bool) -> some View {
        modifier(ZoomTransition(id: id, namespace: namespace, enabled: enabled))
    }
}
