import AppKit
import SwiftUI

/// The single Tono product mark used by the macOS connection control and
/// sidebar. The source is the app icon asset, which is also the same artwork
/// shipped by the Windows shell; state is communicated by the surrounding
/// glow rather than by swapping the brand colors.
struct LiquidClashLogo: View {
    var compact: Bool = false
    var isConnected: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var brandIcon: Image {
        if let icon = NSImage(named: NSImage.applicationIconName) {
            return Image(nsImage: icon)
        }
        // Keep previews and unusual bundle layouts usable when AppKit has not
        // registered the application icon name yet.
        return Image("AppIcon")
    }

    var body: some View {
        brandIcon
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .scaleEffect(compact || reduceMotion ? 1 : (isConnected ? 1.03 : 1))
            .shadow(
                color: compact || !isConnected
                    ? .clear
                    : TonoStatus.connected.opacity(0.42),
                radius: compact ? 0 : 8
            )
            .animation(
                (compact || reduceMotion) ? nil : .easeOut(duration: 0.22),
                value: isConnected
            )
            .accessibilityHidden(true)
    }
}

#Preview("Logo") {
    ZStack {
        LinearGradient(
            colors: [Color(hex: "F0F3FA"), Color(hex: "D9E0EF")],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        LiquidClashLogo()
            .frame(width: 220, height: 220)
    }
    .frame(width: 360, height: 360)
}
