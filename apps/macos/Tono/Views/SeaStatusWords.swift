import Foundation

enum SeaStatusWords {
    static func title(kind: MenuBarProtectionStatus.Kind, connected: Bool, protectionBlocked: Bool, unknown: Bool, disconnecting: Bool) -> String {
        if unknown { return String(localized: "Protection status unconfirmed") }
        switch kind {
        case .connected, .degraded:
            return connected ? String(localized: "Connected") : String(localized: "Not connected")
        case .standby: return String(localized: "Not connected")
        case .connecting:
            return disconnecting ? String(localized: "Disconnecting") : String(localized: "Connecting")
        case .blocked:
            return protectionBlocked ? String(localized: "Protected, not connected") : String(localized: "Not connected")
        case .unconfirmed: return String(localized: "Protection status unconfirmed")
        }
    }
}
