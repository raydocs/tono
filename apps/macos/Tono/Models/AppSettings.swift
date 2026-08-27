import AppKit
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
    /// Whether a crash from the previous run may be named in the diagnostic
    /// snapshot this client already sends every twenty minutes.
    ///
    /// Deliberately not `remoteDiagnosticsEnabled`: that switch also starts a
    /// fifteen-second poll for remote device actions, so gating crash labels on
    /// it meant nobody could report a crash without also granting the control
    /// plane the ability to act on their machine. Reporting a crash and being
    /// remotely actionable are different consents, and only the first should be
    /// on by default.
    nonisolated static let crashReportingEnabled =
        "crashReportingEnabled"
    static let hasCompletedOnboarding = "hasCompletedOnboarding"
    static let hasChosenInterfaceLanguage = "hasChosenInterfaceLanguage"
    static let selectedProxyTargetName = "selectedProxyTargetName"
    static let cloudExitDefaultPolicyVersion = "cloudExitDefaultPolicyVersion"
    static let windowGeometryPolicyVersion = "windowGeometryPolicyVersion"
    static let didStartCore = "didStartCore"
    static let lastTunEnabled = "lastTunEnabled"
}

enum InterfaceLanguagePreference {
    static let auto = "Auto"
    static let english = "English"
    static let simplifiedChinese = "简体中文"
    static let options = [auto, english, simplifiedChinese]

    static var storedLanguage: String {
        AppProfile.defaults.string(forKey: SettingsKey.interfaceLanguage) ?? auto
    }

    static var hasChosen: Bool {
        if AppProfile.defaults.bool(forKey: SettingsKey.hasChosenInterfaceLanguage) {
            return true
        }
        // Existing installs that already picked English/Chinese in Settings
        // should not be sent back through the first-launch chooser.
        switch storedLanguage {
        case english, simplifiedChinese:
            AppProfile.defaults.set(true, forKey: SettingsKey.hasChosenInterfaceLanguage)
            return true
        default:
            break
        }
        // A returning install that never touched the picker (left on Auto).
        // Blocking those people on the chooser would delay session restore
        // and can leave Kill Switch armed with no Restore Internet control.
        if AppProfile.defaults.object(forKey: SettingsKey.didStartCore) != nil {
            AppProfile.defaults.set(true, forKey: SettingsKey.hasChosenInterfaceLanguage)
            return true
        }
        return false
    }

    static func apply(_ language: String) {
        let value: String
        switch language {
        case english, simplifiedChinese, auto:
            value = language
        default:
            value = auto
        }
        AppProfile.defaults.set(value, forKey: SettingsKey.interfaceLanguage)
        AppProfile.defaults.set(true, forKey: SettingsKey.hasChosenInterfaceLanguage)
        syncAppleLanguages(from: value)
    }

    static func syncAppleLanguagesFromStore() {
        syncAppleLanguages(from: storedLanguage)
    }

    static func syncAppleLanguages(from language: String) {
        switch language {
        case english:
            UserDefaults.standard.set(["en"], forKey: "AppleLanguages")
        case simplifiedChinese:
            UserDefaults.standard.set(["zh-Hans"], forKey: "AppleLanguages")
        default:
            UserDefaults.standard.removeObject(forKey: "AppleLanguages")
        }
    }

    static func relaunch() {
        let path = Bundle.main.bundlePath
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-c", "sleep 0.4; /usr/bin/open \"$1\"", "--", path]
        try? process.run()
        NSApp.terminate(nil)
    }
}
