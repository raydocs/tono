import SwiftUI

/// Brand ramp shared by the route mark and the selected-state hairline.
/// Matches the Windows tokens in `tono-ui/theme.ts` (indigo → violet → peach,
/// the sweep of the TO monogram).
///
/// The accent is sampled from the monogram's violet band. It needs one value
/// per appearance: the violet that clears AA on a white card is too dark on
/// the night ground, and vice versa.
enum TonoBrand {
    /// Accent for icons, selection, focus rings and tinted text.
    /// 4.8:1 on white, 7.0:1 on the dark card.
    static let accent = Color(lightHex: "7457F5", darkHex: "AB9EFF")
    /// Solid stand-in for the action gradient (its midpoint); use the
    /// gradient on real buttons, this where a gradient cannot be drawn.
    static let actionFill = Color(lightHex: "6A4CF0", darkHex: "7457F5")
    /// The primary action surface: a short violet sweep, lighter at the
    /// top-left where light would catch it. White type stays above 4.5:1 at
    /// the midpoint and 5.4:1+ at the deep end.
    static var actionGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(lightHex: "8266FF", darkHex: "8F76FF"),
                Color(lightHex: "5B3FE0", darkHex: "6A4CF0"),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
    /// Colored shadow under the action surface.
    static let actionShadow = Color(hex: "5B3FE0")
    /// The monogram's deep end; only used inside the ramp.
    static let indigo = Color(hex: "2B2FB8")
    static let accentSoft = Color(hex: "7B5CFF")
    static let accentWarm = Color(hex: "FFB07A")

    /// Welcome v2 cream / night ground and type. Sheen geometry lives in
    /// `WelcomeGround`; opacities are applied there too.
    static let welcomeGround = Color(lightHex: "F3EDE2", darkHex: "12122A")
    static let welcomeSheen1 = Color(lightHex: "FFFFFF", darkHex: "7B5CFF")
    static let welcomeSheen2 = Color(lightHex: "D6C8B2", darkHex: "FFB07A")
    static let welcomeInk = Color(lightHex: "1B1F4B", darkHex: "F3F1F7")
    static let welcomeMuted = Color(lightHex: "5A5E7A", darkHex: "B9B7CC")

    static var routeGradient: LinearGradient {
        LinearGradient(
            colors: [indigo, accentSoft, accentWarm],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

/// Semantic status ramp shared across the app. Mirrors TONO_COLORS in the
/// Windows tono-ui/theme.ts. Connection green (2ED573) and latency green
/// (30D158) are deliberately distinct.
enum TonoStatus {
    static let connected = Color(hex: "2ED573")
    static let positive = Color(hex: "30D158")   // latency good / success chips
    static let blocked = Color(hex: "FF9F0A")    // protected offline / degraded
    static let error = Color(hex: "FF453A")
    static let neutral = Color.secondary          // standby / not tested
    /// Concrete gray for fills and gradients (`Color.secondary` is dynamic).
    static let standby = Color(hex: "98989D")
}

/// Traffic-direction colours shared by the chart, the Activity header rates
/// and each connection row, so upload/download always read the same.
enum TonoTraffic {
    static let download = TonoStatus.connected
    static let upload = Color(hex: "64D2FF")
}

enum TonoMotion {
    static func easeOut(_ duration: Double, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeOut(duration: duration)
    }

    static func easeInOut(_ duration: Double, reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .easeInOut(duration: duration)
    }
}
