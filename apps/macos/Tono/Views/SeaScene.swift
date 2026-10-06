import SwiftUI

enum SeaAppearance {
    static let enabledKey = "seaAppearanceEnabled"
    static let motionKey = "seaMotionMode"
    static let motionOptions = ["Auto", "Full", "Simple", "Static"]

    static func animates(_ mode: String, reduceMotion: Bool) -> Bool {
        !reduceMotion && (mode == "Auto" || mode == "Full")
    }
}

/// Render fixtures can exercise the real views without writing the device's
/// AppStorage preference. Production leaves this nil and uses AppProfile.
private struct SeaAppearanceOverrideKey: EnvironmentKey {
    static let defaultValue: Bool? = nil
}

extension EnvironmentValues {
    var seaAppearanceOverride: Bool? {
        get { self[SeaAppearanceOverrideKey.self] }
        set { self[SeaAppearanceOverrideKey.self] = newValue }
    }
}

/// The existing SwiftUI navigation and every existing page stay in place.
/// This preference only makes their native controls legible on the night ground.
struct SeaPageAppearance: ViewModifier {
    @AppStorage(SeaAppearance.enabledKey, store: AppProfile.defaults)
    private var enabled = false
    @Environment(\.seaAppearanceOverride) private var previewOverride

    @ViewBuilder
    func body(content: Content) -> some View {
        if previewOverride ?? enabled {
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

/// Static scene colors. Water begins with the exact last sky stop in every
/// phase; a different first water stop reads as a false band at the horizon.
struct SeaScenePalette {
    let sky: [String]
    let deepWater: String
    let reflection: String

    var water: [String] { [sky[2], deepWater, "05060A"] }

    static func forPhase(_ phase: SeaPresentationPhase) -> Self {
        switch phase {
        case .day:
            return .init(sky: ["08070D", "42272B", "B66C4B"],
                         deepWater: "301E25", reflection: "FFD9A0")
        case .dawn:
            return .init(sky: ["070813", "392238", "A84A42"],
                         deepWater: "291821", reflection: "FFAA73")
        case .dusk:
            return .init(sky: ["080811", "312039", "80363A"],
                         deepWater: "211720", reflection: "E98167")
        case .blocked:
            return .init(sky: ["0A0912", "2D1D30", "753638"],
                         deepWater: "20151D", reflection: "DE8069")
        case .night:
            return .init(sky: ["04050A", "1A1D38", "343A60"],
                         deepWater: "121628", reflection: "CED8FF")
        }
    }
}

struct SeaScene: View {
    let phase: SeaPresentationPhase
    let motionEnabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let horizon = height * 0.55
            let waterHeight = height - horizon
            let disc = min(max(height * 0.25, 120), 230)
            let palette = SeaScenePalette.forPhase(phase)
            let decorationsEnabled = !reduceTransparency && contrast != .increased
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
                    Circle()
                        .fill(LinearGradient(
                            colors: phase == .day
                                ? [Color(hex: "FFF6DE"), Color(hex: "FFD58E"),
                                   Color(hex: "FFA35E"), Color(hex: "F2685A")]
                                : [Color(hex: "FFB86E"), Color(hex: "FF7A44"),
                                   Color(hex: "E0403E"), Color(hex: "9A1E38")],
                            startPoint: .top, endPoint: .bottom
                        ))
                        .frame(width: disc, height: disc)
                        .mask {
                            Circle().fill(RadialGradient(
                                stops: [.init(color: .black, location: 0),
                                        .init(color: .black, location: 0.88),
                                        .init(color: .clear, location: 1)],
                                center: .center, startRadius: 0, endRadius: disc * 0.5
                            ))
                        }
                        .position(x: width * 0.72, y: sunY(horizon: horizon, disc: disc))
                }

                LinearGradient(
                    colors: palette.water.map(Color.init(hex:)),
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: waterHeight)
                .offset(y: horizon)

                if decorationsEnabled {
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
        return ZStack(alignment: .topLeading) {
            Ellipse()
                .fill(RadialGradient(
                    colors: [light.opacity(isMoon ? 0.08 : 0.19), .clear],
                    center: .top, startRadius: 0, endRadius: waterHeight * 0.72
                ))
                .frame(width: disc * (isMoon ? 0.8 : 1.7), height: waterHeight * 1.15)
                .position(x: centerX, y: waterHeight * 0.40)

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
