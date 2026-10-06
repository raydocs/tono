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
            content.environment(\.colorScheme, .dark).preferredColorScheme(.dark)
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
                    colors: [Color(hex: "111A30"), Color(hex: "26364D"), Color(hex: "102139")],
                    startPoint: .top, endPoint: .bottom
                )
                if !reduceTransparency && contrast != .increased {
                    Ellipse()
                        .fill(Color(hex: "7187A5").opacity(0.12))
                        .frame(width: geometry.size.width * 1.2, height: geometry.size.height * 0.22)
                        .position(x: geometry.size.width * 0.55, y: geometry.size.height * 0.78)
                    Rectangle()
                        .fill(LinearGradient(colors: [Color(hex: "8498AE").opacity(0.18), .clear],
                                             startPoint: .top, endPoint: .bottom))
                        .frame(height: 2)
                        .offset(y: geometry.size.height * 0.72)
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

struct SeaScene: View {
    let phase: SeaPresentationPhase
    let motionEnabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    private var isWarm: Bool { phase == .day || phase == .dawn }
    private var sky: [Color] {
        switch phase {
        case .day: return [Color(hex: "211F38"), Color(hex: "76495A"), Color(hex: "E18B67")]
        case .dawn: return [Color(hex: "151B36"), Color(hex: "45415C"), Color(hex: "B76868")]
        case .dusk: return [Color(hex: "131831"), Color(hex: "39324D"), Color(hex: "8F505C")]
        case .blocked: return [Color(hex: "17172C"), Color(hex: "463144"), Color(hex: "96535C")]
        case .night: return [Color(hex: "0D1429"), Color(hex: "1B2441"), Color(hex: "343D65")]
        }
    }

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let horizon = height * 0.57
            let disc = min(max(height * 0.25, 120), 230)
            ZStack(alignment: .topLeading) {
                LinearGradient(colors: sky, startPoint: .top, endPoint: .bottom)

                if phase == .night {
                    if !reduceTransparency && contrast != .increased {
                        starField(width: width, horizon: horizon)
                    }
                    Circle()
                        .fill(Color(hex: "E5E8FA"))
                        .frame(width: disc * 0.17, height: disc * 0.17)
                        .overlay(alignment: .topTrailing) {
                            Circle()
                                .fill(Color(hex: "202B4B"))
                                .frame(width: disc * 0.16, height: disc * 0.16)
                                .offset(x: disc * 0.045, y: -disc * 0.045)
                        }
                        .position(x: width * 0.72, y: horizon * 0.40)
                } else {
                    if !reduceTransparency && contrast != .increased {
                        Circle()
                            .fill(RadialGradient(colors: [Color(hex: "FFBC85").opacity(0.35), .clear],
                                                 center: .center, startRadius: disc * 0.3, endRadius: disc * 1.15))
                            .frame(width: disc * 2.3, height: disc * 2.3)
                            .position(x: width * 0.72, y: sunY(horizon: horizon, disc: disc))
                    }
                    Circle()
                        .fill(LinearGradient(
                            colors: isWarm ? [Color(hex: "FFE4A7"), Color(hex: "FF9B69")]
                                : [Color(hex: "EE977B"), Color(hex: "B84F5A")],
                            startPoint: .top, endPoint: .bottom
                        ))
                        .frame(width: disc, height: disc)
                        .position(x: width * 0.72, y: sunY(horizon: horizon, disc: disc))
                }

                LinearGradient(
                    colors: [Color(hex: "443B60"), Color(hex: "111B33"), Color(hex: "0B1429")],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: height - horizon)
                .offset(y: horizon)

                // Static, geometry-scaled ripples. No display link or steady
                // frame work, including in the full motion preference.
                if !reduceTransparency && contrast != .increased {
                    ForEach(0..<12, id: \.self) { index in
                        Capsule()
                            .fill((isWarm ? Color(hex: "F5B48D") : Color(hex: "8996C0"))
                                .opacity(isWarm ? 0.17 - Double(index) * 0.009 : 0.08))
                            .frame(width: width * (0.07 + CGFloat(index % 4) * 0.035), height: 1)
                            .position(
                                x: width * (0.61 + CGFloat((index * 7) % 13) * 0.017),
                                y: horizon + CGFloat(index + 1) * (height - horizon) / 14
                            )
                    }
                }
                LinearGradient(colors: [sky[2].opacity(0.4), .clear],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 20)
                    .offset(y: horizon - 8)
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
