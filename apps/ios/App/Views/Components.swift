import SwiftUI

/// Line glyphs drawn in code (1.6 pt strokes on a 24 pt grid), same set as Android `Glyphs.kt`. Decorative.
enum Glyph { case ai, video, apps, gear, chevronRight, chevronUp, chevronDown, back, arrow }

struct GlyphIcon: View {
    let glyph: Glyph
    var tint: Color
    var size: CGFloat = 22

    var body: some View {
        Canvas { ctx, canvasSize in
            let s = min(canvasSize.width, canvasSize.height) / 24
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
            let style = StrokeStyle(lineWidth: 1.6 * s, lineCap: .round, lineJoin: .round)
            func line(_ a: CGPoint, _ b: CGPoint, width: CGFloat? = nil) {
                var path = Path(); path.move(to: a); path.addLine(to: b)
                ctx.stroke(path, with: .color(tint), style: StrokeStyle(lineWidth: width ?? style.lineWidth, lineCap: .round))
            }
            func poly(_ points: [CGPoint], closed: Bool = false, fill: Bool = false) {
                var path = Path(); path.addLines(points); if closed { path.closeSubpath() }
                if fill { ctx.fill(path, with: .color(tint)) } else { ctx.stroke(path, with: .color(tint), style: style) }
            }
            switch glyph {
            case .ai:
                ctx.stroke(Path(roundedRect: CGRect(x: 5 * s, y: 5 * s, width: 14 * s, height: 14 * s), cornerRadius: 3 * s), with: .color(tint), style: style)
                for i in 0..<3 {
                    let c = CGFloat(8 + i * 4)
                    line(p(c, 2), p(c, 5)); line(p(c, 19), p(c, 22)); line(p(2, c), p(5, c)); line(p(19, c), p(22, c))
                }
                ctx.fill(Path(ellipseIn: CGRect(x: 9.8 * s, y: 9.8 * s, width: 4.4 * s, height: 4.4 * s)), with: .color(tint))
            case .video:
                ctx.stroke(Path(roundedRect: CGRect(x: 3 * s, y: 5 * s, width: 18 * s, height: 14 * s), cornerRadius: 3.5 * s), with: .color(tint), style: style)
                poly([p(10, 9), p(15.5, 12), p(10, 15)], closed: true, fill: true)
            case .apps:
                for x in [4.0, 13.0] { for y in [4.0, 13.0] {
                    ctx.stroke(Path(roundedRect: CGRect(x: x * s, y: y * s, width: 7 * s, height: 7 * s), cornerRadius: 2 * s), with: .color(tint), style: style)
                } }
            case .gear:
                for i in 0..<8 {
                    let a = Double(i) * .pi / 4
                    line(p(12 + 7 * cos(a), 12 + 7 * sin(a)), p(12 + 9.5 * cos(a), 12 + 9.5 * sin(a)), width: 2.6 * s)
                }
                ctx.stroke(Path(ellipseIn: CGRect(x: 5.5 * s, y: 5.5 * s, width: 13 * s, height: 13 * s)), with: .color(tint), style: style)
                ctx.stroke(Path(ellipseIn: CGRect(x: 9.4 * s, y: 9.4 * s, width: 5.2 * s, height: 5.2 * s)), with: .color(tint), style: style)
            case .chevronRight:
                poly([p(9, 6), p(15, 12), p(9, 18)])
            case .chevronUp:
                poly([p(6, 15), p(12, 9), p(18, 15)])
            case .chevronDown:
                poly([p(6, 9), p(12, 15), p(18, 9)])
            case .back:
                poly([p(15, 5), p(8, 12), p(15, 19)])
            case .arrow:
                line(p(4, 12), p(19, 12))
                poly([p(14, 7), p(19, 12), p(14, 17)])
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The sun-on-horizon mark, generated from the desktop brand source (decision 095).
struct TonoMark: View {
    var size: CGFloat = 28
    var body: some View {
        Image("TonoMark").resizable().interpolation(.high).scaledToFit().frame(width: size, height: size).accessibilityHidden(true)
    }
}

/// Primary action: the warm sun gradient with a dark ink label (desktop primary capsule); flat smoke when disabled.
struct PrimaryButton: View {
    let title: String
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .tonoFont(17, .semibold, relativeTo: .body)
                .foregroundStyle(enabled ? TonoColor.actionInk : TonoColor.textTertiary)
                .frame(maxWidth: .infinity, minHeight: 52)
                .padding(.horizontal, 20)
                .background(enabled ? AnyShapeStyle(TonoColor.actionFill) : AnyShapeStyle(TonoColor.smokeHigh), in: Capsule())
        }
        .buttonStyle(PressScale())
        .disabled(!enabled)
    }
}

struct QuietButton: View {
    let title: String
    var color: Color = TonoColor.textPrimary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .tonoFont(15, .medium, relativeTo: .subheadline)
                .foregroundStyle(color)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 18)
                .frame(minHeight: 44)
                .overlay(Capsule().strokeBorder(TonoColor.hairline, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(PressScale())
    }
}

struct PressScale: ButtonStyle {
    /// The label is interactive glass: on iOS 26 the glass answers the press, so no second scale.
    var glass = false

    func makeBody(configuration: Configuration) -> some View {
        PressScaleBody(configuration: configuration, glass: glass)
    }
}

private struct PressScaleBody: View {
    let configuration: ButtonStyleConfiguration
    let glass: Bool
    @Environment(\.tonoReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !glassAnswers ? 0.97 : 1)
            .animation(TonoMotion.press, value: configuration.isPressed)
    }

    private var glassAnswers: Bool {
        guard glass, !reduceTransparency, contrast != .increased else { return false }
        if #available(iOS 26.0, *) { return true }
        return false
    }
}

struct StatusDot: View {
    let color: Color
    var size: CGFloat = 8
    /// Grows with the text beside it (up to twice), so a dot still reads at accessibility sizes.
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let side = size * min(scale, 2)
        Circle().fill(color).frame(width: side, height: side).accessibilityHidden(true)
    }
}

/// Smoked card used for settings sections; same surface as the home sheet.
struct SmokeCard<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.tonoReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(TonoColor.smoke.opacity(reduceTransparency || contrast == .increased ? 1 : 0.82), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.white.opacity(contrast == .increased ? 0.4 : 0.08), lineWidth: 1))
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View {
        // No extra tracking: the audit read tracked caps as clipped text.
        Text(text.uppercased())
            .tonoFont(12, .medium, relativeTo: .caption)
            .foregroundStyle(TonoColor.textTertiary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, 6).padding(.top, 18).padding(.bottom, 8)
            .accessibilityAddTraits(.isHeader)
    }
}

struct Banner: View {
    let text: String
    let tone: Color
    let action: String?
    let onAction: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // The action goes under the text at accessibility sizes instead of squeezing it.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                                                  : AnyLayout(HStackLayout(spacing: 10))
        layout {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                StatusDot(color: tone)
                Text(text).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary).frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if let action { QuietButton(title: action, color: tone, action: onAction) }
        }
        .padding(.leading, 14).padding(.trailing, 8).padding(.vertical, 10)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(tone.opacity(0.45), lineWidth: 1))
    }
}

/// Text field on the night surface (Android `fieldColors`).
struct TonoField: View {
    let title: String
    @Binding var text: String
    var large = false
    /// Grows to a second and third line instead of clipping large text (the field in a narrow row);
    /// the caller turns a typed return into submit.
    var wraps = false

    var body: some View {
        field
            .tonoFont(large ? 24 : 17, large ? .medium : .regular, relativeTo: large ? .title2 : .body, design: large ? .rounded : .default)
            .foregroundStyle(TonoColor.textPrimary)
            .tint(TonoColor.accent)
            .padding(.horizontal, 16)
            .frame(minHeight: 54)
            .background(TonoColor.nightDeep.opacity(0.4), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(TonoColor.hairline, lineWidth: 1))
    }

    @ViewBuilder private var field: some View {
        let prompt = Text(title).foregroundColor(TonoColor.textTertiary)
        if wraps {
            TextField("", text: $text, prompt: prompt, axis: .vertical).lineLimit(1...3)
                .padding(.vertical, 12)
        } else {
            TextField("", text: $text, prompt: prompt)
        }
    }
}

/// Scrolls at accessibility text sizes but keeps short content on the bottom edge (the thumb zone,
/// over the scrim) instead of floating it to the top over the sky.
struct BottomScroll<Content: View>: View {
    var startAtBottom = false
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { geo in
            if #available(iOS 17.0, *) {
                scroll(height: geo.size.height)
                    .defaultScrollAnchor(startAtBottom ? .bottom : nil)
            } else if startAtBottom {
                ScrollViewReader { proxy in
                    scroll(height: geo.size.height)
                        .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            } else {
                scroll(height: geo.size.height)
            }
        }
    }

    private func scroll(height: CGFloat) -> some View {
        ScrollView {
            content.frame(maxWidth: .infinity, minHeight: height, alignment: .bottom)
                .id("bottom")
        }
    }
}
