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

            // Layer 2: tint overlay controlled by slider. Dark mode tints to
            // near-black — the system `.background` gray reads as slate, not
            // the black-glass depth the surfaces are designed against.
            Rectangle()
                .fill(
                    colorScheme == .dark
                        ? AnyShapeStyle(Color(hex: "0D0D0F"))
                        : AnyShapeStyle(.background)
                )
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
                // Warm paper with a faint dot grid — a quiet, tactile ground
                // in the Manus register. No gradients; the brand color lives
                // only in the glyph the page carries.
                ZStack {
                    (colorScheme == .dark ? Color(hex: "18181A") : Color(hex: "F5F5F2"))
                        .opacity(0.94)
                    GateDotGrid()
                        .foregroundStyle(
                            colorScheme == .dark
                                ? Color.white.opacity(0.05)
                                : Color.black.opacity(0.045)
                        )
                }
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

/// Sparse 1pt dot lattice, the tactile texture of the gate's paper ground.
private struct GateDotGrid: View {
    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 22
            var y: CGFloat = spacing / 2
            while y < size.height {
                var x: CGFloat = spacing / 2
                while x < size.width {
                    context.fill(
                        Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)),
                        with: .style(.foreground)
                    )
                    x += spacing
                }
                y += spacing
            }
        }
    }
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
