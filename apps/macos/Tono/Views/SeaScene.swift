import SwiftUI

enum SeaAppearance {
    /// Retained for pre-release preference diagnostics; production no longer reads it.
    static let enabledKey = "seaAppearanceEnabled"
    static let motionKey = "seaMotionMode"
    static let motionOptions = ["Auto", "Full", "Simple", "Static"]

    static func animates(_ mode: String, reduceMotion: Bool) -> Bool {
        !reduceMotion && (mode == "Auto" || mode == "Full")
    }
}

/// Render fixtures can exercise the real views without writing the device's
/// preferences. Production leaves this nil and always uses the sea appearance.
private struct SeaAppearanceOverrideKey: EnvironmentKey {
    static let defaultValue: Bool? = nil
}

private struct SeaDecorationsOverrideKey: EnvironmentKey {
    static let defaultValue: Bool? = nil
}

extension EnvironmentValues {
    var seaAppearanceOverride: Bool? {
        get { self[SeaAppearanceOverrideKey.self] }
        set { self[SeaAppearanceOverrideKey.self] = newValue }
    }

    /// Render fixtures can show both appearances without changing accessibility preferences.
    var seaDecorationsOverride: Bool? {
        get { self[SeaDecorationsOverrideKey.self] }
        set { self[SeaDecorationsOverrideKey.self] = newValue }
    }
}

/// The existing SwiftUI navigation and every existing page stay in place.
/// The sea appearance makes their native controls legible on the night ground.
struct SeaPageAppearance: ViewModifier {
    @SeaAppearancePreference private var enabled

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.environment(\.colorScheme, .dark).preferredColorScheme(.dark).tint(SeaTheme.cool)
        } else {
            content
        }
    }
}

/// A quiet, non-status-bearing horizon under the native secondary pages.
/// It never implies a confirmed connection; the dashboard alone owns that.
struct SeaSecondaryScene: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                LinearGradient(
                    colors: [Color(hex: "0A0A12"), Color(hex: "0E0D18"), Color(hex: "12111E")],
                    startPoint: .top, endPoint: .bottom
                )
                if !reduceTransparency && contrast != .increased {
                    Ellipse()
                        .fill(RadialGradient(
                            colors: [Color(hex: "FF9650").opacity(0.16),
                                     Color(hex: "BE463C").opacity(0.06), .clear],
                            center: .center, startRadius: 0,
                            endRadius: geometry.size.width * 0.65
                        ))
                        .frame(width: geometry.size.width * 1.5,
                               height: geometry.size.height * 0.65)
                        .position(x: geometry.size.width * 0.80,
                                  y: geometry.size.height * 1.04)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .accessibilityHidden(true)
    }
}

/// Presentation only. A warm disc is reserved for confirmed protection; a
/// blocked or unreadable helper never gets the connected sky.
enum SeaPresentationPhase: Equatable {
    case night, dawn, day, dusk, blocked

    static func resolve(
        status: MenuBarProtectionStatus.Kind,
        disconnecting: Bool, failed: Bool
    ) -> Self {
        switch status {
        case .blocked, .unconfirmed: return .blocked
        case .degraded: return .dusk
        case .connecting: return disconnecting ? .dusk : .dawn
        case .connected: return .day
        case .standby: return failed ? .dusk : .night
        }
    }
}

/// The water is a dark base with a phase tint that fades before the foreground.
/// Stops are the sRGB compositions of those two fields at the CSS control depths.
struct SeaSceneRGB {
    let red: Double
    let green: Double
    let blue: Double

    init(hex: String) {
        let value = Int(hex, radix: 16) ?? 0
        red = Double((value >> 16) & 0xFF) / 255
        green = Double((value >> 8) & 0xFF) / 255
        blue = Double(value & 0xFF) / 255
    }

    private init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    func mixed(with other: Self, amount: Double) -> Self {
        Self(red: red * (1 - amount) + other.red * amount,
             green: green * (1 - amount) + other.green * amount,
             blue: blue * (1 - amount) + other.blue * amount)
    }

    var color: Color { Color(red: red, green: green, blue: blue) }
}

struct SeaScenePalette {
    let sky: [String]
    let tintStart: String
    let tintStartOpacity: Double
    let tintMiddle: String
    let tintMiddleOpacity: Double
    let tintMiddleDepth: Double
    let tintFadeDepth: Double
    let reflection: String

    private func baseWater(at depth: Double) -> SeaSceneRGB {
        SeaSceneRGB(hex: "0B0D19").mixed(with: SeaSceneRGB(hex: "05060A"), amount: depth)
    }

    var waterSurface: SeaSceneRGB {
        baseWater(at: 0).mixed(with: SeaSceneRGB(hex: tintStart), amount: tintStartOpacity)
    }

    var waterStops: [Gradient.Stop] {
        [.init(color: waterSurface.color, location: 0),
         .init(color: baseWater(at: tintMiddleDepth)
            .mixed(with: SeaSceneRGB(hex: tintMiddle), amount: tintMiddleOpacity).color,
               location: tintMiddleDepth),
         .init(color: baseWater(at: tintFadeDepth).color, location: tintFadeDepth),
         .init(color: baseWater(at: 1).color, location: 1)]
    }

    static func forPhase(_ phase: SeaPresentationPhase) -> Self {
        switch phase {
        case .day:
            return .init(sky: ["08070D", "42272B", "B66C4B"],
                         tintStart: "FFA660", tintStartOpacity: 0.34,
                         tintMiddle: "AA4036", tintMiddleOpacity: 0.12,
                         tintMiddleDepth: 0.32, tintFadeDepth: 0.76,
                         reflection: "FFD9A0")
        case .dawn:
            return .init(sky: ["070813", "392238", "A84A42"],
                         tintStart: "CE4232", tintStartOpacity: 0.50,
                         tintMiddle: "5C1628", tintMiddleOpacity: 0.26,
                         tintMiddleDepth: 0.26, tintFadeDepth: 0.70,
                         reflection: "FFAA73")
        case .dusk:
            return .init(sky: ["080811", "312039", "80363A"],
                         tintStart: "CE4232", tintStartOpacity: 0.50,
                         tintMiddle: "5C1628", tintMiddleOpacity: 0.26,
                         tintMiddleDepth: 0.26, tintFadeDepth: 0.70,
                         reflection: "E98167")
        case .blocked:
            return .init(sky: ["0A0912", "2D1D30", "753638"],
                         tintStart: "CE4232", tintStartOpacity: 0.50,
                         tintMiddle: "5C1628", tintMiddleOpacity: 0.26,
                         tintMiddleDepth: 0.26, tintFadeDepth: 0.70,
                         reflection: "DE8069")
        case .night:
            return .init(sky: ["04050A", "1A1D38", "505A91"],
                         tintStart: "566294", tintStartOpacity: 0.50,
                         tintMiddle: "262951", tintMiddleOpacity: 0.26,
                         tintMiddleDepth: 0.26, tintFadeDepth: 0.70,
                         reflection: "CED8FF")
        }
    }
}

struct SeaScene: View {
    let phase: SeaPresentationPhase
    let motionEnabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.seaDecorationsOverride) private var decorationsOverride

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let horizon = height * 0.55
            let waterHeight = height - horizon
            let disc = min(max(height * 0.25, 120), 230)
            let palette = SeaScenePalette.forPhase(phase)
            let decorationsEnabled = decorationsOverride ?? (!reduceTransparency && contrast != .increased)
            ZStack(alignment: .topLeading) {
                LinearGradient(colors: palette.sky.map(Color.init(hex:)),
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: horizon)

                if phase == .night {
                    if decorationsEnabled {
                        starField(width: width, horizon: horizon)
                        Circle()
                            .fill(RadialGradient(
                                colors: [Color(hex: "CED8FF").opacity(0.20), .clear],
                                center: .center, startRadius: 0, endRadius: disc * 0.34
                            ))
                            .frame(width: disc * 0.72, height: disc * 0.72)
                            .position(x: width * 0.78, y: horizon * 0.40)
                    }
                    Circle()
                        .fill(Color(hex: "F4EEE2"))
                        .frame(width: disc * 0.19, height: disc * 0.19)
                        .mask {
                            Circle()
                                .fill(.white)
                                .overlay {
                                    Circle()
                                        .fill(.black)
                                        .offset(x: disc * 0.055, y: -disc * 0.055)
                                        .blendMode(.destinationOut)
                                }
                                .compositingGroup()
                        }
                        .rotationEffect(.degrees(-16))
                        .position(x: width * 0.78, y: horizon * 0.40)
                } else {
                    if decorationsEnabled {
                        Circle()
                            .fill(RadialGradient(
                                colors: [Color(hex: "FFAA60").opacity(0.23),
                                         Color(hex: "F06054").opacity(0.09), .clear],
                                center: .center, startRadius: disc * 0.35,
                                endRadius: disc * 1.9
                            ))
                            .frame(width: disc * 3.8, height: disc * 3.8)
                            .position(x: width * 0.72, y: sunY(horizon: horizon, disc: disc))
                        Circle()
                            .fill(RadialGradient(
                                colors: [Color(hex: "FFE9C2").opacity(0.46),
                                         Color(hex: "FFCB7F").opacity(0.28), .clear],
                                center: .center, startRadius: disc * 0.43,
                                endRadius: disc * 0.68
                            ))
                            .frame(width: disc * 1.36, height: disc * 1.36)
                            .position(x: width * 0.72, y: sunY(horizon: horizon, disc: disc))
                    }
                    let sunFill = LinearGradient(
                        colors: phase == .day
                            ? [Color(hex: "FFF6DE"), Color(hex: "FFD58E"),
                               Color(hex: "FFA35E"), Color(hex: "F2685A")]
                            : [Color(hex: "FFB86E"), Color(hex: "FF7A44"),
                               Color(hex: "E0403E"), Color(hex: "9A1E38")],
                        startPoint: .top, endPoint: .bottom
                    )
                    if decorationsEnabled {
                        Circle()
                            .fill(sunFill)
                            .frame(width: disc, height: disc)
                            .blur(radius: disc * 0.02)
                            .position(x: width * 0.72, y: sunY(horizon: horizon, disc: disc))
                    }
                    Circle()
                        .fill(sunFill)
                        .frame(width: disc, height: disc)
                        .position(x: width * 0.72, y: sunY(horizon: horizon, disc: disc))
                }

                LinearGradient(
                    stops: palette.waterStops,
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: waterHeight)
                .offset(y: horizon)

                if decorationsEnabled {
                    Ellipse()
                        .fill(RadialGradient(
                            stops: [.init(color: Color(hex: palette.reflection).opacity(0.38), location: 0),
                                    .init(color: Color(hex: phase == .night ? "566294" : "FF9664")
                                        .opacity(0.12), location: 0.48),
                                    .init(color: .clear, location: 1)],
                            center: .center, startRadius: 0, endRadius: disc * 1.35
                        ))
                        .frame(width: disc * 2.7, height: 9)
                        .position(x: width * (phase == .night ? 0.78 : 0.72), y: horizon + 3)
                    reflection(width: width, waterHeight: waterHeight, disc: disc,
                               palette: palette)
                        .frame(width: width, height: waterHeight)
                        .clipped()
                        .offset(y: horizon)
                }
            }
            .frame(width: width, height: height)
            .clipped()
            .animation(motionEnabled && !reduceMotion ? .easeInOut(duration: 0.45) : nil, value: phase)
        }
        .accessibilityHidden(true)
    }

    private func sunY(horizon: CGFloat, disc: CGFloat) -> CGFloat {
        switch phase {
        case .day: return horizon - disc * 0.7
        case .dawn: return horizon - disc * 0.08
        case .dusk, .blocked: return horizon + disc * 0.36
        case .night: return horizon + disc
        }
    }

    private func reflection(width: CGFloat, waterHeight: CGFloat, disc: CGFloat,
                            palette: SeaScenePalette) -> some View {
        let isMoon = phase == .night
        let centerX = width * (isMoon ? 0.78 : 0.72)
        let light = Color(hex: palette.reflection)
        let glowWidth = disc * (isMoon ? 0.8 : 1.7)
        let glowRadius = glowWidth * 0.5
        return ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(RadialGradient(
                    stops: [.init(color: light.opacity(isMoon ? 0.08 : 0.19), location: 0),
                            .init(color: light.opacity(isMoon ? 0.025 : 0.06), location: 0.45),
                            .init(color: .clear, location: 0.85),
                            .init(color: .clear, location: 1)],
                    center: .top, startRadius: 0, endRadius: glowRadius
                ))
                .frame(width: glowWidth, height: glowRadius)
                .scaleEffect(x: 1, y: waterHeight * 0.82 / glowRadius, anchor: .top)
                .position(x: centerX, y: glowRadius * 0.5)

            // A deterministic column: small near-horizon dashes broaden and
            // fragment toward the viewer, never a set of full-width stripes.
            ForEach(0..<28, id: \.self) { index in
                let depth = CGFloat(index) / 28
                let spread = disc * (0.12 + depth * (isMoon ? 0.32 : 0.75))
                let offset = CGFloat((index * 37) % 17 - 8) / 8 * spread * 0.54
                let length = disc * (0.10 + depth * (isMoon ? 0.19 : 0.36))
                    * (index.isMultiple(of: 4) ? 0.48 : 1)
                Capsule()
                    .fill(LinearGradient(colors: [.clear,
                                                  light.opacity(isMoon ? 0.32 : 0.78), .clear],
                                         startPoint: .leading, endPoint: .trailing))
                    .frame(width: length, height: index.isMultiple(of: 5) ? 1.7 : 0.9)
                    .position(x: centerX + offset,
                              y: 3 + depth * waterHeight * 0.92)
            }
        }
        .mask(LinearGradient(
            stops: [.init(color: .white, location: 0),
                    .init(color: .white.opacity(isMoon ? 0.24 : 0.65), location: 0.20),
                    .init(color: .clear, location: 0.94)],
            startPoint: .top, endPoint: .bottom
        ))
    }

    private func starField(width: CGFloat, horizon: CGFloat) -> some View {
        ForEach(0..<18, id: \.self) { index in
            Circle()
                .fill(.white.opacity(index.isMultiple(of: 3) ? 0.55 : 0.26))
                .frame(width: index.isMultiple(of: 4) ? 2 : 1,
                       height: index.isMultiple(of: 4) ? 2 : 1)
                .position(x: width * CGFloat((index * 37 + 11) % 97) / 100,
                          y: horizon * CGFloat((index * 23 + 9) % 82) / 100)
        }
    }
}
