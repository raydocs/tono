import SwiftUI

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >> 8) & 0xFF) / 255
        let b = Double(int & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

/// Frosted glass background with a readable minimum tint. The appearance
/// control varies the tint without ever making the app fully transparent.
struct MeshGradientBackground: View {
    /// When true, the login gate (and similar full-window brand surfaces)
    /// get a light-mode brand wash. Default stays identical to the previous
    /// two-layer frost so Dashboard and every existing call site are unchanged.
    var emphasis: Bool = false

    @AppStorage(SettingsKey.glassTransparency) private var glassTransparency: Double = 50
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            // Layer 1: always-on behind-window blur
            FrostedGlassView()
                .ignoresSafeArea()

            // Layer 2: tint overlay controlled by slider
            Rectangle()
                .fill(.background)
                // A larger "Transparency" value should reveal more of the
                // frosted backdrop, while retaining enough tint for legibility.
                .opacity(0.94 - (min(max(glassTransparency, 0), 100) / 100.0) * 0.22)
                .ignoresSafeArea()

            if emphasis {
                emphasisWash
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }

    /// Light mode needs a real brand presence — frost + `.background` reads
    /// as a blank sheet. Dark mode already has contrast, so the wash stays
    /// quieter.
    private var emphasisWash: some View {
        Group {
            if colorScheme == .dark {
                RadialGradient(
                    colors: [
                        TonoBrand.accent.opacity(0.10),
                        TonoBrand.accentSoft.opacity(0.05),
                        .clear,
                    ],
                    center: .topTrailing,
                    startRadius: 40,
                    endRadius: 560
                )
            } else {
                LinearGradient(
                    colors: [
                        TonoBrand.accent.opacity(0.20),
                        TonoBrand.accentSoft.opacity(0.12),
                        TonoBrand.accentWarm.opacity(0.10),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        }
    }
}

struct FrostedGlassView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

#Preview("Dark") {
    MeshGradientBackground()
        .frame(width: 600, height: 400)
        .preferredColorScheme(.dark)
}

#Preview("Light") {
    MeshGradientBackground()
        .frame(width: 600, height: 400)
        .preferredColorScheme(.light)
}

#Preview("Light · emphasis") {
    MeshGradientBackground(emphasis: true)
        .frame(width: 600, height: 400)
        .preferredColorScheme(.light)
}

#Preview("Dark · emphasis") {
    MeshGradientBackground(emphasis: true)
        .frame(width: 600, height: 400)
        .preferredColorScheme(.dark)
}
