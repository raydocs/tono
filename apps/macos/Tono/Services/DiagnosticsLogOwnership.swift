import Foundation

/// An opaque, durable account/consent stamp. Records acquire it before entering
/// the asynchronous writer; old queued records cannot inherit a later login.
nonisolated final class DiagnosticsLogOwnership: @unchecked Sendable {
    static let shared = DiagnosticsLogOwnership()
    private struct Saved: Codable {
        let owner: String
        let id: String
    }
    private let lock = NSLock()
    private let defaults: UserDefaults
    private let enabled: @Sendable () -> Bool
    private let key = "diagnosticsLogUploadOwnership.v1"
    private var owner: String?
    private var scope: String?

    init(defaults: UserDefaults = AppProfile.defaults,
         enabled: @escaping @Sendable () -> Bool = {
             LocalTrafficAudit.isEnabled && SettingsKey.isNetworkLogUploadEnabled()
         }) {
        self.defaults = defaults
        self.enabled = enabled
    }

    @discardableResult
    func activate(owner: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        self.owner = owner
        return refreshLocked()
    }

    func abandon() {
        lock.lock(); defer { lock.unlock() }
        owner = nil
        scope = nil
        defaults.removeObject(forKey: key)
    }

    func consentChanged() {
        lock.lock(); defer { lock.unlock() }
        _ = refreshLocked()
    }

    func currentScope() -> String? {
        lock.lock(); defer { lock.unlock() }
        return enabled() ? scope : nil
    }

    func isCurrent(_ id: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return enabled() && scope == id
    }

    func withCurrent<R>(_ id: String, action: () -> R) -> R? {
        lock.lock(); defer { lock.unlock() }
        guard enabled(), scope == id else { return nil }
        return action()
    }

    private func refreshLocked() -> String? {
        guard enabled(), let owner else {
            scope = nil
            defaults.removeObject(forKey: key)
            return nil
        }
        let saved = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Saved.self, from: $0) }
        let next = saved?.owner == owner ? saved!.id : UUID().uuidString
        guard let data = try? JSONEncoder().encode(Saved(owner: owner, id: next)) else {
            scope = nil
            return nil
        }
        defaults.set(data, forKey: key)
        scope = defaults.data(forKey: key) == data ? next : nil
        return scope
    }
}
