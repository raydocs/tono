import CryptoKit
import Foundation
import Observation

/// Additive, bounded local preferences. No node credentials, endpoints or
/// account identifiers are stored. Catalog membership is checked on every read.
@MainActor @Observable
final class LocalRoutePreferences {
    struct Success: Codable {
        let name: String
        let at: Date
        let catalogDigest: String
    }
    private struct Account: Codable {
        var favorites: [String] = []
        var successes: [Success] = []
        var updatedAt = Date()
    }
    static let storageKey = "localRoutePreferences.v1"
    static let successFreshness: TimeInterval = 24 * 60 * 60
    private let defaults: UserDefaults
    private var accounts: [String: Account]

    init(defaults: UserDefaults = AppProfile.defaults) {
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.storageKey), data.count <= 65_536,
           let decoded = try? JSONDecoder().decode([String: Account].self, from: data),
           decoded.count <= 8,
           decoded.allSatisfy({ key, value in
               key.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
                   && value.favorites.count <= 32 && value.successes.count <= 16
                   && value.favorites.allSatisfy { !$0.isEmpty && $0.utf8.count <= 400 }
                   && value.successes.allSatisfy { !$0.name.isEmpty && $0.name.utf8.count <= 400 && $0.catalogDigest.count <= 64 }
           }) {
            accounts = decoded
        } else {
            accounts = [:]
        }
    }

    private func key(_ owner: String) -> String {
        SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func favorites(owner: String, catalog: [ProxyNode]) -> Set<String> {
        let allowed = Set(catalog.map { ProxyNode.catalogBaseName(for: $0.name) })
        return Set(accounts[key(owner)]?.favorites ?? []).intersection(allowed)
    }

    func toggleFavorite(_ name: String, owner: String, catalog: [ProxyNode]) {
        guard catalog.contains(where: { $0.name == name }), name.utf8.count <= 400 else { return }
        var account = accounts[key(owner)] ?? Account()
        let base = ProxyNode.catalogBaseName(for: name)
        var names = favorites(owner: owner, catalog: catalog)
        if names.contains(base) { names.remove(base) }
        else if names.count < 32 { names.insert(base) }
        account.favorites = names.sorted()
        save(account, owner: owner)
    }

    func recordSuccess(_ name: String, owner: String, catalog: [ProxyNode], digest: String, now: Date = Date()) {
        guard catalog.contains(where: { $0.name == name }), name.utf8.count <= 400,
              !digest.isEmpty, digest.count <= 64 else { return }
        var account = accounts[key(owner)] ?? Account()
        let base = ProxyNode.catalogBaseName(for: name)
        account.successes.removeAll { ProxyNode.catalogBaseName(for: $0.name) == base }
        account.successes.insert(Success(name: name, at: now, catalogDigest: digest), at: 0)
        account.successes = Array(account.successes.prefix(16))
        save(account, owner: owner)
    }

    func recentSuccesses(owner: String, catalog: [ProxyNode], now: Date = Date()) -> [Success] {
        let allowed = Set(catalog.map(\.name))
        return (accounts[key(owner)]?.successes ?? []).filter {
            allowed.contains($0.name) && now.timeIntervalSince($0.at) >= 0
                && now.timeIntervalSince($0.at) <= Self.successFreshness
        }.sorted { $0.at > $1.at }
    }

    func retireSuccess(_ name: String, owner: String) {
        guard var account = accounts[key(owner)], account.successes.contains(where: { $0.name == name }) else { return }
        account.successes.removeAll { $0.name == name }
        save(account, owner: owner)
    }

    private func save(_ value: Account, owner: String) {
        var account = value
        account.updatedAt = Date()
        accounts[key(owner)] = account
        if accounts.count > 8 {
            let retained = accounts.sorted { $0.value.updatedAt > $1.value.updatedAt }.prefix(8)
            accounts = Dictionary(uniqueKeysWithValues: retained.map { ($0.key, $0.value) })
        }
        guard let data = try? JSONEncoder().encode(accounts), data.count <= 65_536 else { return }
        defaults.set(data, forKey: Self.storageKey)
    }
}

struct RouteRecommendation: Identifiable {
    let id = UUID()
    let owner: String
    let generation: UInt64
    let catalogDigest: String
    let name: String
    let successfulAt: Date?
}
