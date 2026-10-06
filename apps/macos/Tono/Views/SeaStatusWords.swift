import Foundation

enum SeaStatusWords {
    static func title(kind: MenuBarProtectionStatus.Kind, connected: Bool, unknown: Bool, disconnecting: Bool) -> String {
        if unknown { return String(localized: "Protection status unconfirmed") }
        switch kind {
        case .connected, .degraded:
            return connected ? String(localized: "Connected") : String(localized: "Not connected")
        case .standby: return String(localized: "Not connected")
        case .connecting:
            return disconnecting ? String(localized: "Disconnecting") : String(localized: "Connecting")
        case .blocked:
            return String(localized: "Protected, not connected")
        case .unconfirmed: return String(localized: "Protection status unconfirmed")
        }
    }
}
