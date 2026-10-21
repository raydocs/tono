#if DEBUG
import SwiftUI
import TonoKit
import WidgetKit

/// DEBUG only (`-TonoPreviewWidgets`): the widget and Live Activity views rendered inside the app
/// with fixture readings, for screenshots of every state, including stale and unavailable. These
/// are the same SwiftUI views the extension uses, not the system Home Screen; every card carries
/// the Preview tag. `-TonoPreviewWidgetsLight` puts them on a light wallpaper.
struct WidgetGallery: View {
    private let now = Date()
    /// As the app names it: the city alone while no other line shares it.
    private var exit: String { Format.city("Tokyo", chinese: L.isChinese) }
    private var light: Bool { CommandLine.arguments.contains("-TonoPreviewWidgetsLight") }

    private var on: StatusReading {
        .fresh(StatusSnapshot(state: .on, exit: exit, since: now.addingTimeInterval(-47 * 60), updatedAt: now.addingTimeInterval(-90), writer: .tunnel))
    }
    private var degraded: StatusReading {
        .fresh(StatusSnapshot(state: .degraded, exit: exit, since: now.addingTimeInterval(-12 * 60), reason: "HOME_UNREACHABLE", updatedAt: now.addingTimeInterval(-60), writer: .app))
    }
    private var stale: StatusReading {
        .stale(StatusSnapshot(state: .on, exit: exit, since: now.addingTimeInterval(-3 * 3600), updatedAt: now.addingTimeInterval(-40 * 60), writer: .tunnel))
    }
    private var dropped: StatusReading {
        .fresh(StatusSnapshot(state: .failed, exit: exit, reason: "CORE_STOPPED", updatedAt: now.addingTimeInterval(-120), writer: .tunnel))
    }
    /// Not a fixture: built the way the extension builds it. A rebuild and the restore of the old
    /// graph are both refused (`TunnelGraph`, as in PacketTunnelProvider), the heartbeat's report
    /// lands beside the app's Connected note, and the reading comes back through the shared file's
    /// encoding.
    private var routesStopped: StatusReading {
        struct Refused: Error {}
        var graph = TunnelGraph(opened: now.addingTimeInterval(-21 * 60))
        try? graph.run(TunnelInputs(catalogBody: "", mode: .threeTier, selectedNode: nil), build: { _ in "" }, start: { _ in })
        let since = now.addingTimeInterval(-20 * 60)
        let answer = graph.answer(since: since, now: now.addingTimeInterval(-10 * 60))
        _ = graph.reload(load: { TunnelInputs(catalogBody: "", mode: .stable, selectedNode: nil) }, build: { _ in "" },
                         start: { _ in throw Refused() }, persist: { _ in })
        let app = AppNote(.connected, reason: nil, answer: answer, line: nil, now: now.addingTimeInterval(-10 * 60))
        let shared = SharedStatus(app: app).writingTunnel(graph.report(process: true, since: since, failure: nil, now: now.addingTimeInterval(-30)))
        return shared.flatMap { SharedStatus.decode($0.encoded()) }?.reading(now: now) ?? .unavailable
    }
    private var off: StatusReading {
        .fresh(StatusSnapshot(state: .off, exit: exit, updatedAt: now.addingTimeInterval(-300), writer: .app))
    }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(L.t("gallery_title")).font(.title2.weight(.semibold)).foregroundStyle(light ? .black : TonoColor.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(L.t("gallery_note")).font(.footnote).foregroundStyle(light ? .black.opacity(0.7) : TonoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 14) {
                    card(on, .systemSmall)
                    card(stale, .systemSmall)
                }
                HStack(spacing: 14) {
                    card(dropped, .systemSmall)
                    card(.unavailable, .systemSmall)
                }
                card(routesStopped, .systemMedium).id("routesStopped")
                card(degraded, .systemMedium)
                card(off, .systemMedium)
                Text(L.t("gallery_lock")).font(.headline).foregroundStyle(light ? .black : TonoColor.textPrimary).padding(.top, 6)
                lockScreen
                Text(L.t("gallery_control")).font(.headline).foregroundStyle(light ? .black : TonoColor.textPrimary).padding(.top, 6)
                controls.id("controls")
            }
            .padding(20)
        }
        .onAppear {
            // `-TonoPreviewWidgetsBottom`: start at the Control Center row (screenshots cannot scroll).
            if CommandLine.arguments.contains("-TonoPreviewWidgetsBottom") { proxy.scrollTo("controls", anchor: .bottom) }
            // `-TonoPreviewWidgetsRoutes`: the card the heartbeat writes when no graph runs.
            if CommandLine.arguments.contains("-TonoPreviewWidgetsRoutes") { proxy.scrollTo("routesStopped", anchor: .center) }
        }
        }
        // Cards scroll under a strip the colour of the top of the wallpaper, not under the clock;
        // the fixtures badge lives in that strip, so it never floats over a card.
        .safeAreaInset(edge: .top, spacing: 0) {
            PreviewBadge()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background((light ? Color(hex: 0xDCE6F2) : Color(hex: 0x1B2236)).ignoresSafeArea(edges: .top))
        }
        .background(background.ignoresSafeArea())
        .accessibilityIdentifier("widgetGallery")
    }

    private var background: some View {
        LinearGradient(colors: light ? [Color(hex: 0xDCE6F2), Color(hex: 0xF4E3D3)] : [Color(hex: 0x1B2236), Color(hex: 0x3A2430)],
                       startPoint: .top, endPoint: .bottom)
    }

    private func card(_ reading: StatusReading, _ family: WidgetFamily) -> some View {
        let p = StatusPresentation(reading)
        let size: CGSize = family == .systemMedium ? CGSize(width: 362, height: 170) : CGSize(width: 170, height: 170)
        return StatusWidgetView(p: p, family: family, interactive: false, preview: true)
            .padding(16)
            .frame(width: size.width, height: size.height)
            .background(WidgetSky(sunRise: p.sunRise))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .environment(\.colorScheme, .dark)
    }

    private var lockScreen: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                lockWidget(on)
                lockWidget(stale)
            }
            .foregroundStyle(.white)
            ActivityLockView(p: StatusPresentation(on), preview: true)
                .background(TonoColor.night.opacity(0.92), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            ActivityLockView(p: StatusPresentation(stale), preview: true)
                .background(TonoColor.night.opacity(0.92), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .padding(14)
        .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .environment(\.colorScheme, .dark)
    }

    private func lockWidget(_ reading: StatusReading) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            StatusWidgetView(p: StatusPresentation(reading), family: .accessoryRectangular, interactive: false, preview: true)
                .frame(width: 172, height: 76)
            PreviewTag()
        }
    }

    /// The Control Center switch's symbol and labels for on, off, no fresh reading and routes
    /// stopped (the system draws the real control; this shows the custom symbols render).
    private var controls: some View {
        let stopped = routesStopped
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 18) { controlRow(stopped) }
            VStack(alignment: .leading, spacing: 12) { controlRow(stopped) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .accessibilityIdentifier("galleryControls")
    }

    @ViewBuilder private func controlRow(_ stopped: StatusReading) -> some View {
        control(on: true, label: L.t("widget_on_short"))
        control(on: false, label: L.t("widget_off_short"))
        control(on: false, label: L.t("widget_unknown_short"))
        if case .fresh(let s) = stopped {
            control(on: StatusWording(stopped).switchOn, label: L.t(StatusWording.titleKey(s.state, reason: s.reason)))
        }
    }

    private func control(on: Bool, label: String) -> some View {
        VStack(spacing: 6) {
            Image(on ? "tono.sun.on" : "tono.sun.off")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(on ? TonoColor.actionInk : Color.white)
                .frame(width: 64, height: 64)
                .background(on ? TonoColor.sunMid.opacity(0.95) : Color.white.opacity(0.18), in: Circle())
            Text(label).font(.caption.weight(.medium)).foregroundStyle(.white)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tono, \(label)")
    }
}
#endif
