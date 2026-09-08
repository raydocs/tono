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
