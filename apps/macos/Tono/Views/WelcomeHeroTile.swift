import SwiftUI

/// Welcome v2 hero: the TO icon tile as a physical object. Corner radius is
/// 22% of the side; shadows and the light-theme ground-contact ellipse come
/// from `docs/welcome-v2.md` §2. Rises 12 pt and fades in once over 400 ms.
struct WelcomeHeroTile: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            let radius = side * 0.22
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)

            ZStack {
                if !isDark {
                    Ellipse()
                        .fill(Color(hex: "1B1F4B").opacity(0.22))
                        .frame(width: side * 0.84, height: side * 0.10)
                        .blur(radius: 6)
                        .offset(y: side * 0.48)
                }

                spreadShadow(
                    color: isDark
                        ? Color(hex: "7B5CFF").opacity(0.45)
                        : Color(hex: "2B2FB8").opacity(0.35),
                    y: isDark ? 40 : 30,
                    blur: isDark ? 80 : 60,
                    spread: -20,
                    side: side,
                    cornerRadius: radius
                )

                if !isDark {
                    spreadShadow(
                        color: Color(hex: "1B1F4B").opacity(0.35),
                        y: 18,
                        blur: 30,
                        spread: -18,
                        side: side,
                        cornerRadius: radius
                    )
                }

                Image("WelcomeHero")
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: side, height: side)
                    .clipShape(shape)
                    .overlay {
                        if isDark {
                            shape.strokeBorder(Color.white.opacity(0.06), lineWidth: 1)
                        }
                    }
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .offset(y: appeared || reduceMotion ? 0 : 12)
            .opacity(appeared || reduceMotion ? 1 : 0)
        }
        .onAppear {
            if reduceMotion {
                appeared = true
            } else {
                withAnimation(TonoMotion.easeOut(0.4, reduceMotion: false)) {
                    appeared = true
                }
            }
        }
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }

    private var isDark: Bool { colorScheme == .dark }

    /// CSS `spread` is not a SwiftUI shadow parameter; a smaller (negative
    /// spread) rounded rect, offset and blurred, is the same shape.
    private func spreadShadow(
        color: Color,
        y: CGFloat,
        blur: CGFloat,
        spread: CGFloat,
        side: CGFloat,
        cornerRadius: CGFloat
    ) -> some View {
        let span = max(0, side + spread * 2)
        return RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(color)
            .frame(width: span, height: span)
            .offset(y: y)
            .blur(radius: blur)
    }
}

#Preview("Welcome hero tile · Light") {
    ZStack {
        WelcomeGround()
        WelcomeHeroTile()
            .frame(width: 240, height: 240)
    }
    .frame(width: 480, height: 480)
    .preferredColorScheme(.light)
}

#Preview("Welcome hero tile · Dark") {
    ZStack {
        WelcomeGround()
        WelcomeHeroTile()
            .frame(width: 240, height: 240)
    }
    .frame(width: 480, height: 480)
    .preferredColorScheme(.dark)
}
