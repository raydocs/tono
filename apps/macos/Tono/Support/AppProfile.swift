import Foundation

nonisolated enum AppProfile {
    static let devArgument = "--tono-dev"
    static let devEnvironmentKey = "TONO_PROFILE"
    /// Temporary release policy while the built-in Home-US path is being fixed.
    /// Keeping this as one switch makes it possible to restore the path without
    /// deleting the audited fail-closed implementation.
    static let homeExitEnabled = false
    static let defaultCloudExitName = "US Reality"

    static var isDev: Bool {
        ProcessInfo.processInfo.arguments.contains(devArgument)
            || ProcessInfo.processInfo.environment[devEnvironmentKey] == "dev"
    }

    static var displayName: String {
        isDev ? "Tono Dev" : "Tono"
    }

    static var appSupportDirectoryName: String {
        isDev ? "Tono-Dev" : "Tono"
    }

    nonisolated(unsafe) static let defaults: UserDefaults = {
        #if DEBUG
        if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil {
            let suite = "com.raydocs.tono.xctest.\(ProcessInfo.processInfo.processIdentifier)"
            UserDefaults.standard.removePersistentDomain(forName: suite)
            if let defaults = UserDefaults(suiteName: suite) {
                return defaults
            }
        }
        #endif
        guard isDev,
              let defaults = UserDefaults(suiteName: "com.raydocs.tono.dev") else {
            return .standard
        }
        return defaults
    }()
}
