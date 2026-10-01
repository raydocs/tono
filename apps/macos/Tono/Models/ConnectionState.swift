import Foundation

enum ConnectionStage: String, CaseIterable, Hashable {
    case preparing = "Preparing protection…"
    case preparingHelper = "Preparing secure helper…"
    case startingKillSwitch = "Starting Kill Switch…"
    case startingTunnel = "Starting protected tunnel…"
    case lockingTraffic = "Locking traffic to tunnel…"
    case applyingCloudPolicy = "Applying secure app routing…"
    case securingDNS = "Securing DNS…"
    case checkingExit = "Checking secure exit…"
    case verifyingTraffic = "Verifying traffic protection…"

    var localizedTitle: String {
        String(localized: String.LocalizationValue(rawValue))
    }

    /// Existing stage string for the local telemetry buffer.
    var telemetryKey: String {
        switch self {
        case .preparing: "preparing"
        case .preparingHelper: "preparingHelper"
        case .startingKillSwitch: "startingKillSwitch"
        case .startingTunnel: "startingTunnel"
        case .lockingTraffic: "lockingTraffic"
        case .applyingCloudPolicy: "applyingCloudPolicy"
        case .securingDNS: "securingDNS"
        case .checkingExit: "checkingExit"
        case .verifyingTraffic: "verifyingTraffic"
        }
    }

    /// Same strings as `tono-core` `connect_timing::WIRE_KEYS` and Windows `stage_key`.
    var wireKey: String {
        switch self {
        case .preparing: "preparing"
        case .preparingHelper: "preparingService"
        case .startingKillSwitch: "startingKillSwitch"
        case .startingTunnel: "startingTunnel"
        case .lockingTraffic: "lockingTraffic"
        case .applyingCloudPolicy: "applyingCloudPolicy"
        case .securingDNS: "securingDNS"
        case .checkingExit: "checkingExit"
        case .verifyingTraffic: "verifyingTraffic"
        }
    }
}

enum DisconnectionStage: String {
    case finishingOperation = "Finishing the current operation…"
    case stoppingTunnel = "Stopping the protected tunnel…"
    case preservingProtection = "Keeping direct traffic blocked…"
    case restoringDNS = "Restoring system DNS…"
    case restoringNetwork = "Restoring network access…"

    var localizedTitle: String {
        String(localized: String.LocalizationValue(rawValue))
    }
}

struct ConnectionFailure: Equatable {
    let stage: ConnectionStage
    let message: String
    let occurredAt: Date
}
