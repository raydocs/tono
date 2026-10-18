import SwiftUI
import UIKit

/// Tono design tokens, identical to the Android client (`ui/Tokens.kt`) and the desktop design
/// system: ink-blue night, warm amber/coral sun, smoked surfaces, shared status colours.
enum TonoColor {
    static let night = Color(hex: 0x0B0D1A)
    static let nightDeep = Color(hex: 0x06070F)
    static let ink = Color(hex: 0x14162A)
    static let smoke = Color(hex: 0x17151F)
    static let smokeHigh = Color(hex: 0x221F2B)
    static let hairline = Color.white.opacity(0.12)
    static let textPrimary = Color(hex: 0xF7F3EE)
    static let textSecondary = Color(hex: 0xF7F3EE, opacity: 0.66)
    static let textTertiary = Color(hex: 0xF7F3EE, opacity: 0.58)  // ≥ 4.5:1 on the night surfaces

    static let sunCore = Color(hex: 0xFFE2A8)
    static let sunMid = Color(hex: 0xFFB46A)
    static let sunEdge = Color(hex: 0xFF7A59)
    static let ember = Color(hex: 0xB8442E)
    static let moon = Color(hex: 0xF4EEDC)

    /// Desktop status tokens: connected ≠ latency-good green on purpose.
    static let connected = Color(hex: 0x2ED573)
    static let latencyGood = Color(hex: 0x30D158)
    static let warning = Color(hex: 0xFF9F0A)
    static let error = Color(hex: 0xFF453A)
    static let neutral = Color(hex: 0x98989D)
    static let accent = Color(hex: 0xFFB46A)

    static let actionFill = LinearGradient(colors: [Color(hex: 0xFFD6A3), Color(hex: 0xFF9E6B)], startPoint: .topLeading, endPoint: .bottomTrailing)
    static let actionInk = Color(hex: 0x2A1406)
    /// Default glass tint: the sea's indigo, lighter than the night, so glass reads as a lit surface
    /// over the water rather than a dark pill.
    static let glassTint = Color(hex: 0x2B3066)
}

/// Desktop control-motion contract: press 100 ms, state 220 ms, surface 350 ms, one arrival spring.
enum TonoMotion {
    static let press = Animation.easeOut(duration: 0.1)
    static let state = Animation.timingCurve(0.2, 0, 0, 1, duration: 0.22)
    static let surface = Animation.spring(response: 0.35, dampingFraction: 1)
    /// Android `spring(dampingRatio = 0.85, stiffness = 120)`.
    static let arrival = Animation.interpolatingSpring(stiffness: 120, damping: 2 * 0.85 * 120.0.squareRoot())
    static let ambient = Animation.timingCurve(0.25, 0, 0.25, 1, duration: 1.8)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }

    /// Linear sRGB-component interpolation (Compose `lerp`), for colours drawn in a Canvas.
    static func mix(_ a: Color, _ b: Color, _ t: Double) -> Color {
        let x = UIColor(a).rgba, y = UIColor(b).rgba
        let k = min(max(t, 0), 1)
        return Color(.sRGB, red: x.0 + (y.0 - x.0) * k, green: x.1 + (y.1 - x.1) * k, blue: x.2 + (y.2 - x.2) * k, opacity: x.3 + (y.3 - x.3) * k)
    }
}

private extension UIColor {
    var rgba: (Double, Double, Double, Double) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return (r, g, b, a)
    }
}

enum LatencyLevelColor {
    static func color(_ ms: Int?) -> Color {
        guard let ms else { return TonoColor.neutral }
        return ms < 200 ? TonoColor.latencyGood : ms < 400 ? TonoColor.warning : TonoColor.error
    }
}

/// Localised copy. Keys and wording are shared with Android (`res/values*/strings.xml`).
enum L {
    static func t(_ key: String, _ args: CVarArg...) -> String {
        let format = NSLocalizedString(key, comment: "")
        return args.isEmpty ? format : String(format: format, locale: Locale.current, arguments: args)
    }

    static var isChinese: Bool { Locale.preferredLanguages.first?.hasPrefix("zh") == true }
}

// MARK: - Type and surfaces

/// Fixed design sizes that still follow Dynamic Type (`@ScaledMetric` against a text style).
private struct TonoFont: ViewModifier {
    @ScaledMetric private var size: CGFloat
    private let weight: Font.Weight
    private let design: Font.Design

    init(size: CGFloat, weight: Font.Weight, design: Font.Design, relativeTo style: Font.TextStyle) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: style)
        self.weight = weight
        self.design = design
    }

    func body(content: Content) -> some View { content.font(.system(size: size, weight: weight, design: design)) }
}

/// The iOS text style whose default (Large) size is this design size, if any. Those sizes use the
/// system text style itself, so Dynamic Type and the accessibility audit see a native text style;
/// other sizes (display titles, the code field) scale through `@ScaledMetric`.
private func textStyle(forDesignSize size: CGFloat) -> Font.TextStyle? {
    switch size {
    case 34: return .largeTitle
    case 28: return .title
    case 22: return .title2
    case 20: return .title3
    case 17: return .body
    case 16: return .callout
    case 15: return .subheadline
    case 13: return .footnote
    case 12: return .caption
    case 11: return .caption2
    default: return nil
    }
}

/// Reduce Motion / Reduce Transparency as Tono's views read them: the system settings, or in DEBUG
/// builds the `-TonoReduceMotion` / `-TonoReduceTransparency` launch arguments, so CI can capture
/// both variants in a simulator (simctl cannot toggle them). Apply `tonoAccessibility()` at every
/// presentation root (app root, sheets, covers).
private struct TonoReduceMotionKey: EnvironmentKey { static let defaultValue = false }
private struct TonoReduceTransparencyKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var tonoReduceMotion: Bool {
        get { self[TonoReduceMotionKey.self] }
        set { self[TonoReduceMotionKey.self] = newValue }
    }
    var tonoReduceTransparency: Bool {
        get { self[TonoReduceTransparencyKey.self] }
        set { self[TonoReduceTransparencyKey.self] = newValue }
    }
}

enum DebugAccessibility {
    #if DEBUG
    static let reduceMotion = CommandLine.arguments.contains("-TonoReduceMotion")
    static let reduceTransparency = CommandLine.arguments.contains("-TonoReduceTransparency")
    /// Sheets open at the large detent. iOS 26 draws the medium detent slightly scaled, which the
    /// audit reads as clipped text; the same content is audited at full size.
    static let largeSheets = CommandLine.arguments.contains("-TonoLargeSheets")
    #else
    static let reduceMotion = false
    static let reduceTransparency = false
    static let largeSheets = false
    #endif
}

private struct TonoAccessibilityRoot: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.accessibilityReduceTransparency) private var systemReduceTransparency

    func body(content: Content) -> some View {
        content
            .environment(\.tonoReduceMotion, systemReduceMotion || DebugAccessibility.reduceMotion)
            .environment(\.tonoReduceTransparency, systemReduceTransparency || DebugAccessibility.reduceTransparency)
    }
}

/// Liquid Glass where the system has it (iOS 26), a material before that, and an opaque smoke
/// surface when Reduce Transparency is on. A light scene-coloured tint (not the night: that read as
/// a dark pill) keeps text contrast, and a rim lit from above gives the edge the sky's light. Glass
/// is for the control layer only (buttons floating over the sea); content inside sheets uses
/// `contentCard`, so glass never sits on glass.
private struct GlassSurface<S: Shape>: ViewModifier {
    let shape: S
    let tint: Color?
    /// Tappable glass: iOS 26 answers the touch itself (scale, highlight).
    let interactive: Bool
    @Environment(\.tonoReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        if reduceTransparency || contrast == .increased {
            content
                .background(TonoColor.smoke, in: shape)
                .overlay(shape.stroke(Color.white.opacity(contrast == .increased ? 0.4 : 0.12), lineWidth: 1))
        } else if #available(iOS 26.0, *) {
            content
                .background(sheen)
                .glassEffect(.regular.tint((tint ?? TonoColor.glassTint).opacity(0.3)).interactive(interactive), in: shape)
                .overlay(rim)
        } else {
            content
                .background(sheen)
                .background((tint ?? TonoColor.glassTint).opacity(0.36), in: shape)
                .background(.ultraThinMaterial, in: shape)
                .overlay(rim)
        }
    }

    /// Light falling on the upper half, over the glass and under the label.
    private var sheen: some View {
        shape.fill(LinearGradient(colors: [Color.white.opacity(0.07), .clear], startPoint: .top, endPoint: .center))
            .allowsHitTesting(false)
    }

    /// Bright where the sky lights the top edge, faint underneath.
    private var rim: some View {
        shape.stroke(LinearGradient(colors: [Color.white.opacity(0.34), Color.white.opacity(0.05), Color.white.opacity(0.12)],
                                    startPoint: .top, endPoint: .bottom), lineWidth: 0.8)
            .allowsHitTesting(false)
    }
}

/// Content surface inside a sheet: a smoked fill, not glass (the sheet itself is the glass).
private struct ContentCard<S: Shape>: ViewModifier {
    let shape: S
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content
            .background(TonoColor.smokeHigh.opacity(contrast == .increased ? 1 : 0.6), in: shape)
            .overlay(shape.stroke(Color.white.opacity(contrast == .increased ? 0.4 : 0.06), lineWidth: 1))
    }
}

extension View {
    func tonoAccessibility() -> some View { modifier(TonoAccessibilityRoot()) }

    @ViewBuilder
    func tonoFont(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body,
                  design: Font.Design = .default) -> some View {
        if let native = textStyle(forDesignSize: size) {
            font(.system(native, design: design, weight: weight))
        } else {
            modifier(TonoFont(size: size, weight: weight, design: design, relativeTo: style))
        }
    }

    func glassSurface<S: Shape>(_ shape: S, tint: Color? = nil, interactive: Bool = false) -> some View {
        modifier(GlassSurface(shape: shape, tint: tint, interactive: interactive))
    }

    func contentCard<S: Shape>(_ shape: S) -> some View {
        modifier(ContentCard(shape: shape))
    }
}
