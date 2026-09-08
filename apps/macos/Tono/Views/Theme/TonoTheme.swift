import SwiftUI

/// Brand ramp shared by the route mark and the selected-state hairline.
/// Matches the Windows tokens in `tono-ui/theme.ts` (accent → soft → warm,
/// the blue-to-peach sweep of the TO monogram).
enum TonoBrand {
    /// Solid action surface; the multicolor ramp belongs to the mark only.
    static let actionFill = Color(hex: "3658C9")
    static let accent = Color(hex: "4B6EFF")
    static let accentSoft = Color(hex: "7B5CFF")
    static let accentWarm = Color(hex: "FFB07A")

    static var routeGradient: LinearGradient {
        LinearGradient(
            colors: [accent, accentSoft, accentWarm],
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
    static let connecting = Color(hex: "FFD60A")
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
}
