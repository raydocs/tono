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

extension ConnectionStage {
    /// Noun form for "stopped while …" copy (Windows `progress.stepNames`). The
    /// raw value is the progressive label shown while the step runs; a failed
    /// step is no longer in progress.
    var stepName: String {
        switch self {
        case .preparing: String(localized: "stepName.preparing")
        case .preparingHelper: String(localized: "stepName.preparingHelper")
        case .startingKillSwitch: String(localized: "stepName.startingKillSwitch")
        case .startingTunnel: String(localized: "stepName.startingTunnel")
        case .lockingTraffic: String(localized: "stepName.lockingTraffic")
        case .applyingCloudPolicy: String(localized: "stepName.applyingCloudPolicy")
        case .securingDNS: String(localized: "stepName.securingDNS")
        case .checkingExit: String(localized: "stepName.checkingExit")
        case .verifyingTraffic: String(localized: "stepName.verifyingTraffic")
        }
    }
}
