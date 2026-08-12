import Foundation

// MARK: - App Settings Keys

enum SettingsKey {
    static let launchAtStartup = "launchAtStartup"
    static let interfaceLanguage = "interfaceLanguage"
    static let subscriptionURL = "subscriptionURL"
    static let mixedPort = "mixedPort"
    static let tunMode = "tunMode"
    static let allowLAN = "allowLAN"
    static let themeMode = "themeMode"
    static let glassTransparency = "glassTransparency"
    static let liquidAnimation = "liquidAnimation"
    static let checkForUpdates = "checkForUpdates"
    static let logsEnabled = "logsEnabled"
    static let remoteDiagnosticsEnabled = "remoteDiagnosticsEnabled"
    nonisolated static let claudeTrafficResearchEnabled =
        "claudeTrafficResearchEnabled"
    nonisolated static let aggregatedAppRoutingResearchEnabled =
        "aggregatedAppRoutingResearchEnabled"
    nonisolated static let localTrafficAuditEnabled =
        "localTrafficAuditEnabled"
    /// Test-programme network-log upload. Distinct key from the research
    /// toggles: those upload aggregates with no hostnames, this uploads the
    /// audit log verbatim, and conflating them would let one consent stand in
    /// for the other.
    nonisolated static let networkLogUploadEnabled =
        "networkLogUploadEnabled"
    static let hasCompletedOnboarding = "hasCompletedOnboarding"
    static let selectedProxyTargetName = "selectedProxyTargetName"
    static let cloudExitDefaultPolicyVersion = "cloudExitDefaultPolicyVersion"
    static let windowGeometryPolicyVersion = "windowGeometryPolicyVersion"
    static let didStartCore = "didStartCore"
    static let lastTunEnabled = "lastTunEnabled"
}
