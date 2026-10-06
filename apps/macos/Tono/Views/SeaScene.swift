import SwiftUI

enum SeaAppearance {
    /// Retained for pre-release preference diagnostics; production no longer reads it.
    static let enabledKey = "seaAppearanceEnabled"
    static let motionKey = "seaMotionMode"
    static let motionOptions = ["Auto", "Full", "Lite", "Static"]

    static func animates(_ mode: String, reduceMotion: Bool) -> Bool {
        !reduceMotion && mode != "Static"
    }
}

/// Render fixtures can exercise the real views without writing the device's
/// preferences. Production leaves this nil and always uses the sea appearance.
private struct SeaAppearanceOverrideKey: EnvironmentKey {
    static let defaultValue: Bool? = nil
}

private struct SeaSceneInWindowKey: EnvironmentKey {
    static let defaultValue = false
}

private struct SeaDecorationsOverrideKey: EnvironmentKey {
    static let defaultValue: Bool? = nil
}

extension EnvironmentValues {
    var seaSceneInWindow: Bool {
        get { self[SeaSceneInWindowKey.self] }
        set { self[SeaSceneInWindowKey.self] = newValue }
    }

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
    @SeaDisplayPreferences private var displayPreferences
    private var reduceTransparency: Bool { displayPreferences.reduceTransparency }
    private var contrast: ColorSchemeContrast { displayPreferences.contrast }

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

struct SeaScene: View {
    let phase: SeaPresentationPhase
    let motionEnabled: Bool
    var progress: Double? = nil
    var active = true
    @AppStorage(SeaAppearance.motionKey, store: AppProfile.defaults) private var motionPreference = "Auto"
    private var reduceMotion: Bool { displayPreferences.reduceMotion }
    @SeaDisplayPreferences private var displayPreferences
    private var reduceTransparency: Bool { displayPreferences.reduceTransparency }
    private var contrast: ColorSchemeContrast { displayPreferences.contrast }
    @Environment(\.seaDecorationsOverride) private var decorationsOverride

    var body: some View {
        SeaSceneLayerView(phase: phase, progress: progress,
            preference: motionEnabled ? motionPreference : "Static",
            reduceMotion: reduceMotion,
            decorations: decorationsOverride ?? (!reduceTransparency && contrast != .increased),
            active: active)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}
