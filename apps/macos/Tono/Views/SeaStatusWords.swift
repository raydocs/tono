import Foundation

enum SeaStatusWords {
    static func key(kind: MenuBarProtectionStatus.Kind, connected: Bool, protectionBlocked: Bool, unknown: Bool, disconnecting: Bool) -> String {
        if unknown { return "Protection status unconfirmed" }
        switch kind {
        case .connected, .degraded:
            return connected ? "Connected" : "Not connected"
        case .standby: return "Not connected"
        case .connecting:
            return disconnecting ? "sea.status.disconnecting" : "sea.status.connecting"
        case .blocked:
            return protectionBlocked ? "Protected, not connected" : "Not connected"
        case .unconfirmed: return "Protection status unconfirmed"
        }
    }
}
