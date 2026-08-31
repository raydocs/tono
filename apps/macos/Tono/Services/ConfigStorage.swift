import Foundation
import Darwin

// MARK: - Config Storage

nonisolated final class ConfigStorage: @unchecked Sendable {
    static let shared = ConfigStorage()

    private let fileManager: FileManager

    /// ~/Library/Application Support/Tono/
    let appSupportDirectory: URL

    private init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        let base = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent(
                "Library/Application Support",
                isDirectory: true
            )
        let url = base
            .appendingPathComponent(AppProfile.appSupportDirectoryName, isDirectory: true)
        if !fileManager.fileExists(atPath: url.path) {
            try? fileManager.createDirectory(
                at: url,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        }
        try? fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
        appSupportDirectory = url
    }

    /// Config file path
    var configFilePath: URL {
        appSupportDirectory.appendingPathComponent("config.json")
    }

    // MARK: - Config

    func saveConfig(_ config: ClashConfig) {
        var persisted = config
        // The local controller credential is per-process and must never survive
        // a restart or be exposed in the preferences file.
        persisted.secret = ""
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(persisted) else { return }
        try? writeSensitive(data, to: configFilePath)
    }

    func loadConfig() -> ClashConfig? {
        guard let data = try? Data(contentsOf: configFilePath) else { return nil }
        return try? JSONDecoder().decode(ClashConfig.self, from: data)
    }

    // MARK: - Proxy Regions

    func saveProxyRegions(_ regions: [ProxyRegion]) {
        let container = RegionContainer(regions: regions.map { region in
            RegionContainer.Region(
                id: region.id,
                name: region.name,
                nodes: region.nodes,
                isExpanded: region.isExpanded
            )
        })
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        guard let data = try? encoder.encode(container) else { return }
        let url = appSupportDirectory.appendingPathComponent("regions.json")
        try? writeSensitive(data, to: url)
    }

    func loadProxyRegions() -> [ProxyRegion]? {
        let url = appSupportDirectory.appendingPathComponent("regions.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let container = try? JSONDecoder().decode(RegionContainer.self, from: data) else { return nil }
        return container.regions.map { region in
            ProxyRegion(id: region.id, name: region.name, nodes: region.nodes, isExpanded: region.isExpanded)
        }
    }

    // MARK: - Runtime Config Path

    var runtimeConfigPath: URL {
        appSupportDirectory.appendingPathComponent("config", isDirectory: true)
            .appendingPathComponent("config.yaml")
    }

    // MARK: - Subscription YAML (immutable, stored as-is)

    var subscriptionYAMLPath: URL {
        appSupportDirectory.appendingPathComponent("subscription_raw.yaml")
    }

    func saveSubscriptionYAML(_ yaml: String) {
        if let data = yaml.data(using: .utf8) {
            try? writeSensitive(data, to: subscriptionYAMLPath)
        }
    }

    func loadSubscriptionYAML() -> String? {
        try? String(contentsOf: subscriptionYAMLPath, encoding: .utf8)
    }

    /// Legacy aliases for compatibility during migration
    func saveRawSubscriptionYAML(_ yaml: String) { saveSubscriptionYAML(yaml) }
    func loadRawSubscriptionYAML() -> String? { loadSubscriptionYAML() }

    // MARK: - Managed exit catalog

    private var managedExitCatalogPath: URL {
        appSupportDirectory.appendingPathComponent("managed-exit-catalog.json")
    }

    func saveManagedExitCatalog(_ catalog: ManagedExitCatalogCache) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try writeSensitive(encoder.encode(catalog), to: managedExitCatalogPath)
    }

    func loadManagedExitCatalog() -> ManagedExitCatalogCache? {
        guard let attributes = try? fileManager.attributesOfItem(
            atPath: managedExitCatalogPath.path
        ),
              let permissions = (attributes[.posixPermissions] as? NSNumber)?.uint16Value,
              permissions & 0o077 == 0,
              let owner = (attributes[.ownerAccountID] as? NSNumber)?.uint32Value,
              owner == getuid()
        else { return nil }
        guard let values = try? managedExitCatalogPath.resourceValues(forKeys: [
            .isRegularFileKey,
            .isSymbolicLinkKey,
            .fileSizeKey,
        ]),
              values.isRegularFile == true,
              values.isSymbolicLink != true,
              let size = values.fileSize,
              size > 0,
              size <= 2 * 1024 * 1024,
              let data = try? Data(contentsOf: managedExitCatalogPath, options: .mappedIfSafe)
        else { return nil }
        return try? JSONDecoder().decode(ManagedExitCatalogCache.self, from: data)
    }

    func removeManagedExitCatalog() {
        try? fileManager.removeItem(at: managedExitCatalogPath)
    }

    // MARK: - Managed traffic policy

    private var managedTrafficPolicyPath: URL {
        appSupportDirectory.appendingPathComponent("managed-traffic-policy.json")
    }

    func saveManagedTrafficPolicy(_ policy: ManagedTrafficPolicyCache) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try writeSensitive(encoder.encode(policy), to: managedTrafficPolicyPath)
    }

    func loadManagedTrafficPolicy() -> ManagedTrafficPolicyCache? {
        guard let attributes = try? fileManager.attributesOfItem(
            atPath: managedTrafficPolicyPath.path
        ),
              let permissions = (attributes[.posixPermissions] as? NSNumber)?.uint16Value,
              permissions & 0o077 == 0,
              let owner = (attributes[.ownerAccountID] as? NSNumber)?.uint32Value,
              owner == getuid()
        else { return nil }
        guard let values = try? managedTrafficPolicyPath.resourceValues(forKeys: [
            .isRegularFileKey,
            .isSymbolicLinkKey,
            .fileSizeKey,
        ]),
              values.isRegularFile == true,
              values.isSymbolicLink != true,
              let size = values.fileSize,
              size > 0,
              size <= 128 * 1024,
              let data = try? Data(
                contentsOf: managedTrafficPolicyPath,
                options: .mappedIfSafe
              )
        else { return nil }
        return try? JSONDecoder().decode(ManagedTrafficPolicyCache.self, from: data)
    }

    // MARK: - Rules

    func saveRules(_ rules: [RuleItem]) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        guard let data = try? encoder.encode(rules) else { return }
        let url = appSupportDirectory.appendingPathComponent("rules.json")
        try? writeSensitive(data, to: url)
    }

    func loadRules() -> [RuleItem]? {
        let url = appSupportDirectory.appendingPathComponent("rules.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode([RuleItem].self, from: data)
    }

    func writeSensitive(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

nonisolated struct ManagedExitCatalogCache: Codable, Sendable, Equatable {
    let revision: Int
    let yaml: String
    let sha256: String
    let updatedAt: Int?
    let routing: TonoExitCatalogRouting?
    /// The account this catalog was issued to. Decoded as optional so a cache
    /// written by an earlier build loads instead of being discarded on a decode
    /// failure — an unattributable cache is then refused by ownership, which is
    /// a decision the caller can see rather than a silent absence.
    let owner: String?

    init(
        revision: Int,
        yaml: String,
        sha256: String,
        updatedAt: Int?,
        routing: TonoExitCatalogRouting?,
        owner: String? = nil
    ) {
        self.revision = revision
        self.yaml = yaml
        self.sha256 = sha256
        self.updatedAt = updatedAt
        self.routing = routing
        self.owner = owner
    }
}

/// Which account the managed exit catalog belongs to.
///
/// Catalog bodies are issued per account — the control plane writes each
/// signed-in user's own client identity into the exits it publishes — while the
/// revision is a fleet-wide counter, so a catalog left behind by a previous
/// sign-in cannot be told apart from the current one by revision alone. Sign-in
/// adopts an account and discards a catalog issued to a different one; sign-out
/// discards the catalog outright, before the next account can reach it.
@MainActor
enum ManagedExitCatalogOwnership {
    private enum Binding: Equatable {
        /// Launch, before the stored session has been validated.
        case unknown
        case signedOut
        case account(String)
    }

    private static var binding: Binding = .unknown
    private static var installedAccount: String?
    private static var hasInstalledCatalog = false
    private static var discardInstalledCatalog: (@MainActor () -> Void)?

    /// The account a freshly fetched catalog is recorded against.
    static var currentAccount: String? {
        if case let .account(userID) = binding { return userID }
        return nil
    }

    /// Whether a catalog issued to `owner` may be installed. Before the stored
    /// session is validated the cache is accepted so a fail-closed launch still
    /// has usable exits offline; `adopt` reconciles it once the account is known.
    static func accepts(_ owner: String?) -> Bool {
        switch binding {
        case .unknown: true
        case .signedOut: false
        case let .account(userID): owner == userID
        }
    }

    static func recordInstalled(
        owner: String?,
        discard: @escaping @MainActor () -> Void
    ) {
        installedAccount = owner
        hasInstalledCatalog = true
        discardInstalledCatalog = discard
    }

    /// Binds the catalog to the signed-in account and discards one issued to a
    /// different account — including a cache written before owners were
    /// recorded, whose account cannot be established.
    static func adopt(_ userID: String) {
        binding = .account(userID)
        guard hasInstalledCatalog, installedAccount != userID else { return }
        discardInstalled()
    }

    /// Sign-out barrier: no exit issued to this account may reach the next one.
    static func purge() {
        binding = .signedOut
        discardInstalled()
    }

    private static func discardInstalled() {
        installedAccount = nil
        hasInstalledCatalog = false
        // Released with the catalog it describes: `purge` runs on every
        // sign-out path, and a hook left behind would keep firing for an
        // install that no longer exists.
        let discard = discardInstalledCatalog
        discardInstalledCatalog = nil
        discard?()
        ConfigStorage.shared.removeManagedExitCatalog()
    }
}

nonisolated struct ManagedTrafficPolicyCache: Codable, Sendable, Equatable {
    let revision: Int
    let json: String
    let sha256: String
    let updatedAt: Int?
    /// Carried through the cache so a policy that was trusted when it arrived is
    /// still trusted after a restart. Decoded as optional so a cache written by
    /// an earlier build loads instead of being discarded — a cache that fails to
    /// decode means no managed routing until the next successful fetch.
    let signature: String?

    init(revision: Int, json: String, sha256: String, updatedAt: Int?, signature: String? = nil) {
        self.revision = revision
        self.json = json
        self.sha256 = sha256
        self.updatedAt = updatedAt
        self.signature = signature
    }
}

// MARK: - Region Container (Codable wrapper)

nonisolated private struct RegionContainer: Codable {
    nonisolated struct Region: Codable {
        let id: String
        let name: String
        let nodes: [ProxyNode]
        let isExpanded: Bool
    }
    let regions: [Region]
}
