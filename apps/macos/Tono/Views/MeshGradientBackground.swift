import AppKit
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

    /// Resolves independently of `@Environment(\.colorScheme)` so brand tokens
    /// can be stored as `static let`s.
    init(lightHex: String, darkHex: String) {
        self.init(nsColor: NSColor(name: nil) { appearance in
            let hex = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? darkHex : lightHex
            let trimmed = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
            var int: UInt64 = 0
            Scanner(string: trimmed).scanHexInt64(&int)
            return NSColor(
                srgbRed: CGFloat((int >> 16) & 0xFF) / 255,
                green: CGFloat((int >> 8) & 0xFF) / 255,
                blue: CGFloat(int & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

/// Clarity's content ground. Native navigation owns its material; never stack
/// a second live behind-window blur under it. The appearance slider controls
/// the blue tint, not GPU work. Sign-in always uses the quietest ground.
struct MeshGradientBackground: View {
    var emphasis: Bool = false
    @AppStorage(SettingsKey.glassTransparency) private var glassTransparency: Double = 50
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        ZStack {
            colorScheme == .dark ? Color(hex: "141922") : Color(hex: "F6F8FC")
            if !emphasis && !reduceTransparency && contrast != .increased {
                (colorScheme == .dark ? Color(hex: "202B45") : Color(hex: "E4EBFA"))
                    .opacity(min(max(glassTransparency, 0), 100) / 100 * 0.22)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

#Preview("Dark") {
    MeshGradientBackground().frame(width: 600, height: 400).preferredColorScheme(.dark)
}

#Preview("Light") {
    MeshGradientBackground().frame(width: 600, height: 400).preferredColorScheme(.light)
}
