import SwiftUI

/// Production always uses the sea appearance; only render fixtures override it.
@propertyWrapper
struct SeaAppearancePreference: DynamicProperty {
    @Environment(\.seaAppearanceOverride) private var previewOverride
    var wrappedValue: Bool { previewOverride ?? true }
}

enum SeaTheme {
    static let text = Color(hex: "F6F2EC")
    static let muted = text.opacity(0.72)
    static let cool = Color(hex: "D5DAFF")
    static let warm = Color(hex: "FFD58E")
    static let ink = Color(hex: "1A0F0A")
    static let tertiary = text.opacity(0.56)
    static let subtle = text.opacity(0.42)
    static let opaquePanel = Color(hex: "17151C")
    // Reduce Transparency fills: each control's translucent fill flattened onto
    // the opaque panel, so controls stay visible instead of matching the panel.
    static let opaqueQuiet = Color(hex: "2A282E")
    static let opaqueTrack = Color(hex: "232127")
    static let opaqueGood = Color(hex: "2A3231")
    static let opaqueAttention = Color(hex: "41352D")
    static let danger = Color(hex: "FF9A8A")
    static let good = Color(hex: "BFECC9")
    static let attention = Color(hex: "FFD9A0")
    static let primaryGradient = LinearGradient(
        stops: [.init(color: Color(hex: "FFE9C4"), location: 0),
                .init(color: Color(hex: "FFB877"), location: 0.6),
                .init(color: Color(hex: "FF9E63"), location: 1)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}

struct SeaPanelSurface: ViewModifier {
    @SeaAppearancePreference private var enabled
    @SeaDisplayPreferences private var display

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content
                .background {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(display.reduceTransparency || display.contrast == .increased
                            ? AnyShapeStyle(SeaTheme.opaquePanel)
                            : AnyShapeStyle(LinearGradient(colors: [.white.opacity(0.075), .white.opacity(0.04)],
                                                         startPoint: .top, endPoint: .bottom)))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(display.contrast == .increased ? 0.45 : (display.reduceTransparency ? 0.14 : 0.06)), lineWidth: 1)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(LinearGradient(colors: [.white.opacity(0.12), .clear], startPoint: .top, endPoint: .bottom), lineWidth: 1)
                }
        } else { content }
    }
}

struct SeaPanel<Content: View>: View {
    let title: String?
    let icon: String?
    let content: Content

    init(_ title: String? = nil, icon: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let title {
                Text(LocalizedStringKey(title))
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(SeaTheme.muted)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(SeaPanelSurface())
    }
}

/// The empty-state mark: a crescent over the horizon in the scene's own
/// language, so an empty panel reads as quiet rather than unloaded.
struct SeaEmptyMark: View {
    var body: some View {
        Canvas { context, size in
            let accent = SeaTheme.cool
            var moon = Path()
            moon.addArc(center: CGPoint(x: size.width * 0.62, y: 22), radius: 13,
                        startAngle: .degrees(-70), endAngle: .degrees(200), clockwise: false)
            moon.addArc(center: CGPoint(x: size.width * 0.62 + 5, y: 19), radius: 11,
                        startAngle: .degrees(200), endAngle: .degrees(-70), clockwise: true)
            moon.closeSubpath()
            context.fill(moon, with: .color(accent.opacity(0.8)))
            for (x, y, r, a) in [(size.width * 0.22, 14.0, 1.2, 0.5), (size.width * 0.38, 26.0, 0.9, 0.4), (size.width * 0.88, 20.0, 1.0, 0.45)] {
                context.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)),
                             with: .color(accent.opacity(a)))
            }
            var horizon = Path()
            horizon.move(to: CGPoint(x: 4, y: 47))
            horizon.addLine(to: CGPoint(x: size.width - 4, y: 47))
            context.stroke(horizon, with: .color(accent.opacity(0.35)), lineWidth: 1)
        }
        .frame(width: 96, height: 56)
        .accessibilityHidden(true)
    }
}

struct SeaPageHeading: View {
    let title: String
    var subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(LocalizedStringKey(title))
                .font(.system(size: 28, weight: .regular)).tracking(-0.5)
                .foregroundStyle(SeaTheme.text).accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(LocalizedStringKey(subtitle)).font(.system(size: 13))
                    .foregroundStyle(SeaTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Sea primary chrome; a render override can still exercise legacy prominence.
struct SeaPrimaryAction: ViewModifier {
    @SeaAppearancePreference private var enabled

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.buttonStyle(SeaButtonStyle(variant: .primary))
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}
