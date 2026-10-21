import Foundation
import Security
import TonoKit

/// Session tokens in the app's own Keychain item. The packet tunnel has no access to them (it is
/// not in a shared keychain access group) and never talks to the control plane.
final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service = "com.raydocs.tono.ios.session"
    private let account = "tokens"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func loadTokens() -> SessionTokens? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
              let json = try? JSON.parse(data), let a = json["access"]?.string, let r = json["refresh"]?.string else { return nil }
        // Items saved before bindings existed have none; AccountSession assigns one on first use.
        return SessionTokens(access: a, refresh: r, binding: json["binding"]?.string)
    }

    func saveTokens(_ tokens: SessionTokens) throws {
        var fields: [(String, JSON)] = [("access", .string(tokens.access)), ("refresh", .string(tokens.refresh))]
        if let binding = tokens.binding { fields.append(("binding", .string(binding))) }
        let data = Data(JSON.object(JSONObject(fields)).serialized().utf8)
        let update: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            // Readable after the first unlock so a background catalog refresh works; never synced or backed up.
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Keychain write failed (\(status))"])
        }
    }

    func clearTokens() { SecItemDelete(query as CFDictionary) }
}

/// The last admitted catalog, in the app's own Application Support (not the App Group): only the
/// app falls back to it, and only on a network failure within seven days, for the sign-in recorded
/// as its owner. A file without an owner (written before owners existed) decodes ownerless and is
/// never reused.
final class FileCatalogCache: CatalogCache, @unchecked Sendable {
    private var url: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Tono", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("catalog-cache.json")
    }

    func loadCatalog() -> CachedCatalog? {
        guard let data = try? Data(contentsOf: url), let json = try? JSON.parse(data),
              let body = json["body"]?.string, let revision = json["revision"]?.int, let at = json["fetchedAt"]?.int else { return nil }
        return CachedCatalog(body: body, revision: revision, fetchedAt: Date(timeIntervalSince1970: TimeInterval(at)), owner: json["owner"]?.string)
    }

    func saveCatalog(_ cached: CachedCatalog) throws {
        var fields: [(String, JSON)] = [("body", .string(cached.body)), ("revision", .int(cached.revision)),
                                        ("fetchedAt", .int(Int(cached.fetchedAt.timeIntervalSince1970)))]
        if let owner = cached.owner { fields.append(("owner", .string(owner))) }
        let json = JSON.object(JSONObject(fields))
        var target = url
        try Data(json.serialized().utf8).write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? target.setResourceValues(values)
    }

    func clear() { try? FileManager.default.removeItem(at: url) }

    func clearCatalog() { clear() }
}

/// Small non-secret preferences.
enum Preferences {
    private static let defaults = UserDefaults.standard

    /// Stable per-install identifier the control plane uses to recognise this device (8–200 chars).
    static var installationID: String {
        if let id = defaults.string(forKey: "installationId") { return id }
        let id = "ios-" + UUID().uuidString.lowercased()
        defaults.set(id, forKey: "installationId")
        return id
    }

    static var mode: RoutingMode {
        get { defaults.string(forKey: "routingMode").flatMap(RoutingMode.init(rawValue:)) ?? .threeTier }
        set { defaults.set(newValue.rawValue, forKey: "routingMode") }
    }

    static var selectedNode: String? {
        get { defaults.string(forKey: "selectedNode") }
        set { defaults.set(newValue, forKey: "selectedNode") }
    }

    /// iOS "include all networks": on by default (stricter; see decision 129).
    static var includeAllNetworks: Bool {
        get { defaults.object(forKey: "includeAllNetworks") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "includeAllNetworks") }
    }

    static var email: String? {
        get { defaults.string(forKey: "accountEmail") }
        set { defaults.set(newValue, forKey: "accountEmail") }
    }

    /// Live Activity (Lock Screen + Dynamic Island). Off by default: it puts the line name on the
    /// Lock Screen (decision 130, provisional).
    static var liveActivity: Bool {
        get { defaults.bool(forKey: "liveActivity") }
        set { defaults.set(newValue, forKey: "liveActivity") }
    }

    /// The first-run introduction was shown (once per install).
    static var onboarded: Bool {
        get { defaults.bool(forKey: "onboarded") }
        set { defaults.set(newValue, forKey: "onboarded") }
    }
}
