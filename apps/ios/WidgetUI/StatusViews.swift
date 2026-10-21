import SwiftUI
import TonoKit
import WidgetKit

/// The sun on the horizon in miniature: the same mark and sky logic as the app's sea scene, so the
/// widget reads at a glance (sun up = on, low and red = failed, moon = off or unknown).
struct HorizonGlyph: View {
    let sunRise: Double
    let warn: Bool
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            // Sun, clipped at the horizon (60% down).
            Circle()
                .fill(LinearGradient(colors: warn ? [TonoColor.sunMid, TonoColor.ember] : [TonoColor.sunCore, TonoColor.sunEdge],
                                     startPoint: .top, endPoint: .bottom))
                .frame(width: size * 0.5, height: size * 0.5)
                .offset(y: size * (0.35 - 0.3 * sunRise))
                .opacity(sunRise > 0 ? 1 : 0)
            if sunRise == 0 {
                Image(systemName: "moon.fill").font(.system(size: size * 0.32)).foregroundStyle(TonoColor.moon)
                    .offset(x: size * 0.12, y: -size * 0.12)
            }
        }
        .frame(width: size, height: size * 0.6, alignment: .center)
        .clipped()
        .overlay(alignment: .bottom) {
            Rectangle().fill(TonoColor.textPrimary.opacity(0.5)).frame(height: 1)
        }
        .frame(width: size, height: size, alignment: .top)
        .overlay(alignment: .bottom) {
            VStack(spacing: size * 0.06) {
                ForEach(0..<3, id: \.self) { i in
                    Capsule().fill((warn ? TonoColor.sunMid : TonoColor.sunCore).opacity(sunRise > 0 ? 0.55 - Double(i) * 0.15 : 0.15))
                        .frame(width: size * (0.42 - CGFloat(i) * 0.1), height: max(1, size * 0.035))
                }
            }
            .padding(.bottom, size * 0.08)
        }
        .accessibilityHidden(true)
    }
}

/// The Tono mark as a template (one colour), for system-tinted places: Lock Screen accessories, the
/// Dynamic Island, tinted / clear Home Screen widgets.
struct MarkGlyph: View {
    var size: CGFloat = 20
    /// Spoken label where the mark alone carries the state (Dynamic Island); nil = decorative.
    var label: String?

    var body: some View {
        let image = Image("TonoMark").resizable().renderingMode(.template).interpolation(.high).scaledToFit()
            .frame(width: size, height: size)
        if let label {
            image.accessibilityLabel(label)
        } else {
            image.accessibilityHidden(true)
        }
    }
}

/// "Preview" tag on every fixture rendering (DEBUG gallery, preview Live Activity). Yellow outline
/// on a dark fill: it stays unmistakable without a solid yellow block on every card.
struct PreviewTag: View {
    var body: some View {
        Text(L.t("preview_tag"))
            .font(.caption2.weight(.bold))
            .foregroundStyle(Color.yellow)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Color.black.opacity(0.55), in: Capsule())
            .overlay(Capsule().stroke(Color.yellow.opacity(0.8), lineWidth: 1))
            .fixedSize()
            .accessibilityLabel(L.t("preview_tag_a11y"))
    }
}

/// Night sky behind home-screen widgets (also the gallery card), warmer as the sun rises.
struct WidgetSky: View {
    let sunRise: Double
    var body: some View {
        LinearGradient(colors: [TonoColor.night, Color.mix(TonoColor.night, TonoColor.ember, 0.35 * sunRise), TonoColor.nightDeep],
                       startPoint: .top, endPoint: .bottom)
    }
}

/// Home-screen and Lock Screen widget content for one `StatusPresentation`.
struct StatusWidgetView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let p: StatusPresentation
    let family: WidgetFamily
    /// Buttons run `SetTunnelIntent`; the DEBUG gallery renders them inert.
    var interactive = true
    var preview = false

    var body: some View {
        content
            // The tag takes the same corner on both Home Screen sizes (it sat mid-card on the medium
            // widget). Lock Screen widgets are too small to share a corner: the gallery tags them
            // underneath.
            .overlay(alignment: .topTrailing) {
                if preview && (family == .systemSmall || family == .systemMedium) { PreviewTag() }
            }
            // Widgets have a fixed size: text grows with Dynamic Type up to xxxLarge, then stops
            // (Apple's guidance for widgets); the app itself follows every size.
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline:
            Text(p.detail.map { "Tono · \(p.title) · \($0)" } ?? "Tono · \(p.title)")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 1) {
                    if p.isOn {
                        MarkGlyph(size: 22).widgetAccentable()
                    } else {
                        Image(systemName: p.stale || p.tone == .unknown ? "questionmark" : "moon.fill")
                            .font(.system(size: 17, weight: .semibold))
                    }
                    Text(p.isOn ? L.t("widget_on_short") : (p.stale || p.tone == .unknown ? "?" : L.t("widget_off_short")))
                        .font(.system(size: 10, weight: .semibold))
                        .minimumScaleFactor(0.7)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(p.accessibilityLabel)
        case .accessoryRectangular:
            // As on the Home Screen card: the middle line goes before anything is cut.
            ViewThatFits(in: .vertical) {
                rectangularLines(middle: true)
                rectangularLines(middle: false)
                rectangularLines(middle: false, whole: false)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(p.accessibilityLabel)
        case .systemMedium:
            HStack(alignment: .center, spacing: 14) {
                summary
                Spacer(minLength: 0)
                actionButton
            }
        default:
            summary
        }
    }

    private func rectangularLines(middle: Bool, whole: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                MarkGlyph(size: 16).widgetAccentable()
                Text(p.title).font(.headline).lineLimit(whole ? 2 : 1).minimumScaleFactor(whole ? 1 : 0.7)
                    .fixedSize(horizontal: false, vertical: whole)
            }
            if middle, let since = p.since {
                Text(timerInterval: since...Date.distantFuture, countsDown: false).font(.body.monospacedDigit()).lineLimit(1)
            } else if middle, let detail = p.detail {
                Text(detail).font(.body).lineLimit(2).fixedSize(horizontal: false, vertical: whole)
            }
            // A stale reading has no timer or detail line, so its "Last known: … at …" gets two.
            Text(p.footnote).font(.caption).foregroundStyle(.secondary)
                .lineLimit(p.stale ? 2 : 1).minimumScaleFactor(whole ? 1 : 0.7)
                .fixedSize(horizontal: false, vertical: whole)
        }
    }

    /// The card's lines. A widget has a fixed size, so the first layout whose lines all fit whole is
    /// used: the glyph shrinks, then goes, then the timer, and only then the detail line (what is
    /// wrong: "Home not answering"). The state and the "as of / last known" line always stay;
    /// nothing is cut mid-word ("Connection dr…" at xxxLarge in round 11). VoiceOver reads every
    /// line from the label either way.
    private var summary: some View {
        ViewThatFits(in: .vertical) {
            summaryLines(glyph: 40, timer: true, detail: true)
            summaryLines(glyph: 28, timer: true, detail: true)
            summaryLines(glyph: 0, timer: true, detail: true)
            summaryLines(glyph: 0, timer: false, detail: true)
            summaryLines(glyph: 0, timer: false, detail: false)
            // Last resort, never expected at xxxLarge: shrink rather than drop the state.
            summaryLines(glyph: 0, timer: false, detail: false, whole: false)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(p.accessibilityLabel)
    }

    /// `whole`: each line takes the height it needs (so `ViewThatFits` rejects a layout that would
    /// truncate) instead of being cut to the space left.
    private func summaryLines(glyph: CGFloat, timer: Bool, detail: Bool, whole: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if glyph > 0 {
                HStack(alignment: .top) {
                    // Tinted and clear Home Screens (iOS 18 / 26) draw one colour: the mark, accented.
                    if renderingMode == .fullColor {
                        HorizonGlyph(sunRise: p.sunRise, warn: p.tone == .warn || p.tone == .error, size: glyph)
                    } else {
                        MarkGlyph(size: glyph * 0.8).widgetAccentable()
                    }
                    Spacer(minLength: 0)
                }
                Spacer(minLength: 2)
            }
            Text(p.title)
                .font(.headline)
                .foregroundStyle(TonoColor.textPrimary)
                .lineLimit(whole ? 3 : 2).minimumScaleFactor(whole ? 1 : 0.7)
                .fixedSize(horizontal: false, vertical: whole)
            if timer, let since = p.since {
                Text(timerInterval: since...Date.distantFuture, countsDown: false)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(TonoColor.textSecondary)
                    .lineLimit(1)
                    .fixedSize(horizontal: false, vertical: whole)
            }
            if detail, let line = p.detail {
                Text(line).font(.footnote).foregroundStyle(TonoColor.textSecondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: whole)
            }
            Text(p.footnote)
                .font(.caption)
                .foregroundStyle(p.stale ? TonoColor.warning : TonoColor.textTertiary)
                .lineLimit(whole ? 3 : 2).minimumScaleFactor(whole ? 1 : 0.7)
                .fixedSize(horizontal: false, vertical: whole)
        }
    }

    @ViewBuilder private var actionButton: some View {
        let label = Text(p.actionTitle)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(p.action == .connect || p.action == .retry ? TonoColor.actionInk : TonoColor.textPrimary)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background {
                if p.action == .connect || p.action == .retry {
                    Capsule().fill(TonoColor.actionFill)
                } else {
                    Capsule().strokeBorder(TonoColor.sunMid.opacity(0.6), lineWidth: 1)
                }
            }
        if interactive && p.action != .openApp {
            if #available(iOS 17.0, *) {
                Button(intent: SetTunnelIntent(value: p.action != .disconnect)) { label }
                    .buttonStyle(.plain)
            } else {
                Link(destination: URL(string: "tono://home")!) { label }
            }
        } else if interactive {
            Link(destination: URL(string: "tono://home")!) { label }
        } else {
            label
        }
    }
}

// MARK: - Live Activity

/// Presentation of a Live Activity content state, with the same freshness rule as the widgets.
struct ActivityPresentation {
    let p: StatusPresentation

    @available(iOS 16.1, *)
    init(_ state: TonoActivityAttributes.ContentState, stale: Bool) {
        let snapshot = StatusSnapshot(state: StatusSnapshot.State(rawValue: state.state) ?? .off, exit: state.exit,
                                      since: state.since, reason: state.reason, updatedAt: Date(), writer: .app)
        p = StatusPresentation(stale ? .stale(snapshot) : .fresh(snapshot))
    }
}

/// Lock Screen / banner presentation of the Live Activity (also the expanded island's body).
struct ActivityLockView: View {
    let p: StatusPresentation
    let preview: Bool

    var body: some View {
        HStack(spacing: 14) {
            HorizonGlyph(sunRise: p.sunRise, warn: p.tone == .warn || p.tone == .error, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                // The tag sits in the trailing column, over the timer, so the title keeps its line and
                // never breaks mid-word ("Connect-ed").
                Text(p.title).font(.headline).foregroundStyle(TonoColor.textPrimary)
                    .lineLimit(1).minimumScaleFactor(0.8)
                if let detail = p.detail {
                    Text(detail).font(.subheadline).foregroundStyle(TonoColor.textSecondary).lineLimit(1)
                }
                if p.stale {
                    Text(L.t("la_stale")).font(.caption).foregroundStyle(TonoColor.warning).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 4) {
                if preview { PreviewTag() }
                if let since = p.since {
                    Text(timerInterval: since...Date.distantFuture, countsDown: false)
                        .font(.title3.monospacedDigit().weight(.medium))
                        .foregroundStyle(TonoColor.textPrimary)
                        .multilineTextAlignment(.trailing)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: 96, alignment: .trailing)
                }
            }
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }
}
