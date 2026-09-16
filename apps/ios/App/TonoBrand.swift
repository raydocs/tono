import SwiftUI

/// Dribbble-direction product tokens. UI only; no runtime, catalog or
/// protection-semantics impact. Hex follows the approved web prototype.
enum TonoBrand {
    /// Primary violet `#7457F5` / `#AB9EFF`. The only tint in the app.
    static let accent = dynamic(
        light: UIColor(red: 0x74 / 255, green: 0x57 / 255, blue: 0xF5 / 255, alpha: 1),
        dark: UIColor(red: 0xAB / 255, green: 0x9E / 255, blue: 0xFF / 255, alpha: 1)
    )
    /// App ground: airy light `#F3F4FC`→`#EDF0F8`, night `#17172E`→`#101024`.
    static let ground = LinearGradient(
        colors: [dynamic(light: .init(red: 0xF3 / 255, green: 0xF4 / 255, blue: 0xFC / 255, alpha: 1), dark: .init(red: 0x17 / 255, green: 0x17 / 255, blue: 0x2E / 255, alpha: 1)),
                 dynamic(light: .init(red: 0xED / 255, green: 0xF0 / 255, blue: 0xF8 / 255, alpha: 1), dark: .init(red: 0x10 / 255, green: 0x10 / 255, blue: 0x24 / 255, alpha: 1))],
        startPoint: .top, endPoint: .bottom
    )
    /// Power-button indigo ramp, both modes.
    static let powerTop = Color(red: 0x8B / 255, green: 0x9C / 255, blue: 0xFF / 255)
    static let powerMid = Color(red: 0x4F / 255, green: 0x46 / 255, blue: 0xE5 / 255)
    static let powerDeep = Color(red: 0x3B / 255, green: 0x36 / 255, blue: 0xC4 / 255)
    /// Halo + orb light.
    static let halo = Color(red: 0x63 / 255, green: 0x66 / 255, blue: 0xF1 / 255)
    static let orbLight = Color(red: 0xC9 / 255, green: 0xE4 / 255, blue: 0xFF / 255)
    static let orbMid = Color(red: 0x3B / 255, green: 0x6E / 255, blue: 0xF0 / 255)
    static let orbDeep = Color(red: 0x2B / 255, green: 0x3F / 255, blue: 0xC4 / 255)

    private static func dynamic(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}
