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
    static let textTertiary = Color(hex: 0xF7F3EE, opacity: 0.44)

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

/// Liquid Glass where the system has it (iOS 26), a dark material before that, and an opaque smoke
/// surface when Reduce Transparency is on. The tint keeps text contrast over a bright sky.
private struct GlassSurface<S: Shape>: ViewModifier {
    let shape: S
    let tint: Color?
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        if reduceTransparency || contrast == .increased {
            content
                .background(TonoColor.smoke, in: shape)
                .overlay(shape.stroke(Color.white.opacity(contrast == .increased ? 0.4 : 0.12), lineWidth: 1))
        } else if #available(iOS 26.0, *) {
            content.glassEffect(.regular.tint((tint ?? TonoColor.night).opacity(0.38)), in: shape)
        } else {
            content
                .background((tint ?? TonoColor.night).opacity(0.42), in: shape)
                .background(.ultraThinMaterial, in: shape)
                .overlay(shape.stroke(Color.white.opacity(0.14), lineWidth: 1))
        }
    }
}

extension View {
    func tonoFont(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body,
                  design: Font.Design = .default) -> some View {
        modifier(TonoFont(size: size, weight: weight, design: design, relativeTo: style))
    }

    func glassSurface<S: Shape>(_ shape: S, tint: Color? = nil) -> some View {
        modifier(GlassSurface(shape: shape, tint: tint))
    }
}
