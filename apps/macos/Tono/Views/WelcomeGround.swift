import SwiftUI

/// Static Welcome v2 ground: solid cream / night plus two faint elliptical
/// sheens. Sheens drop under Reduce Transparency and Increase Contrast. The
/// composite is rasterized once via `drawingGroup()` — never a live backdrop
/// sample.
struct WelcomeGround: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            ZStack {
                TonoBrand.welcomeGround
                if showSheens {
                    sheen(
                        color: TonoBrand.welcomeSheen1.opacity(isDark ? 0.22 : 0.70),
                        center: isDark ? CGPoint(x: 0.70, y: 1.00) : CGPoint(x: 0.30, y: 0.00),
                        scale: isDark ? CGSize(width: 1.6, height: 1.1) : CGSize(width: 1.4, height: 1.1),
                        in: size
                    )
                    sheen(
                        color: TonoBrand.welcomeSheen2.opacity(isDark ? 0.10 : 0.55),
                        center: isDark ? CGPoint(x: 0.85, y: 0.90) : CGPoint(x: 0.60, y: 1.10),
                        scale: isDark ? CGSize(width: 1.2, height: 0.8) : CGSize(width: 1.6, height: 0.8),
                        in: size
                    )
                }
            }
            .frame(width: size.width, height: size.height)
            .drawingGroup()
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }

    private var isDark: Bool { colorScheme == .dark }
    private var showSheens: Bool { !reduceTransparency && contrast != .increased }

    /// CSS-style `ellipse {scale} at {center}` radial, fading to transparent
    /// at 70% of the ellipse radius.
    private func sheen(
        color: Color,
        center: CGPoint,
        scale: CGSize,
        in size: CGSize
    ) -> some View {
        let ellipseW = size.width * scale.width
        let ellipseH = size.height * scale.height
        let diameter = max(ellipseW, ellipseH)
        return Circle()
            .fill(
                RadialGradient(
                    stops: [
                        .init(color: color, location: 0),
                        .init(color: color.opacity(0), location: 0.70),
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: diameter / 2
                )
            )
            .frame(width: diameter, height: diameter)
            .scaleEffect(
                x: diameter > 0 ? ellipseW / diameter : 1,
                y: diameter > 0 ? ellipseH / diameter : 1
            )
            .position(x: size.width * center.x, y: size.height * center.y)
    }
}

#Preview("Welcome ground · Light") {
    WelcomeGround()
        .frame(width: 600, height: 400)
        .preferredColorScheme(.light)
}

#Preview("Welcome ground · Dark") {
    WelcomeGround()
        .frame(width: 600, height: 400)
        .preferredColorScheme(.dark)
}
