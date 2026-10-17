import Foundation
import TonoKit

/// Files the app and the packet tunnel share through the App Group container.
///
/// Holds the tunnel inputs (admitted catalog body + choices), the extension's last failure and
/// sing-box's working directory (command socket, cache.db). Tokens never live here: they stay in
/// the app's own Keychain items. Files are written with complete-until-first-unlock protection so
/// an On Demand restart after reboot can read them once the phone has been unlocked once.
enum SharedFiles {
    static var appGroup: String {
        Bundle.main.object(forInfoDictionaryKey: "TonoAppGroup") as? String ?? "group.com.raydocs.tono.ios"
    }

    static var container: URL {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            // Missing entitlement is a build error, not a runtime state; fail loudly in development.
            preconditionFailure("App Group \(appGroup) is not available; check the entitlements")
        }
        return url
    }

    /// sing-box basePath: libbox puts its command socket here (both processes must agree).
    static var boxBase: URL { container }
    static var boxWorking: URL { directory(container.appendingPathComponent("Library/Caches/Working", isDirectory: true)) }
    static var boxTemp: URL { directory(container.appendingPathComponent("Library/Caches", isDirectory: true)) }
    static var cacheDB: URL { boxWorking.appendingPathComponent("cache.db") }

    static var inputsURL: URL { directory(container.appendingPathComponent("Tono", isDirectory: true)).appendingPathComponent("tunnel-inputs.json") }
    static var failureURL: URL { directory(container.appendingPathComponent("Tono", isDirectory: true)).appendingPathComponent("tunnel-failure.json") }

    static func directory(_ url: URL) -> URL {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = url
        try? mutable.setResourceValues(values)
        return url
    }

    static func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func saveInputs(_ inputs: TunnelInputs) throws { try write(inputs.encoded(), to: inputsURL) }

    static func loadInputs() throws -> TunnelInputs { try TunnelInputs.decode(Data(contentsOf: inputsURL)) }

    static func removeInputs() {
        try? FileManager.default.removeItem(at: inputsURL)
        try? FileManager.default.removeItem(at: cacheDB)
    }

    static func recordFailure(_ failure: TunnelFailure) { try? write(failure.encoded(), to: failureURL) }

    static func loadFailure() -> TunnelFailure? {
        (try? Data(contentsOf: failureURL)).flatMap(TunnelFailure.decode)
    }

    static func clearFailure() { try? FileManager.default.removeItem(at: failureURL) }
}
