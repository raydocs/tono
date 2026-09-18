import Foundation
import Security

/// Separate keychain service/group shared ONLY by the app and its extension.
/// Refresh token and account session stay app-only. No raw cloud bytes on disk.
struct TunnelGrant: Codable {
    let accountID: String
    let deviceID: String
    let accessToken: String
    let selected: String
    let generation: UUID
    let issuedAt: Date
    var scope: String { accountID + ":" + deviceID }
}

struct TunnelVault {
    private func query(_ account: String) throws -> [String: Any] {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "TonoTunnelKeychainGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { throw Blocker.keychainUnavailable }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "com.ninx.tono.tunnel",
                kSecAttrAccessGroup as String: group,
                kSecAttrAccount as String: account,
                kSecAttrSynchronizable as String: false]
    }

    func read(_ account: String) throws -> Data? {
        var q = try query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Blocker.keychainUnavailable }
        return data
    }

    func watermark(scope: String) throws -> String {
        try Self.decodeWatermark(read("watermark:" + scope))
    }

    /// Only a missing item means first use. Go validates the nonempty JSON next.
    static func decodeWatermark(_ data: Data?) throws -> String {
        guard let data else { return "" }
        guard !data.isEmpty, data.count <= 4096,
              let value = String(data: data, encoding: .utf8) else { throw Blocker.invalidPolicy }
        return value
    }

    func write(_ data: Data, account: String) throws {
        let q = try query(account)
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(q.merging(attributes) { _, value in value } as CFDictionary, nil) == errSecSuccess else {
                throw Blocker.keychainUnavailable
            }
        } else if status != errSecSuccess { throw Blocker.keychainUnavailable }
    }

    func revoke() throws {
        let status = SecItemDelete(try query("grant") as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Blocker.keychainUnavailable }
        // Retain anti-rollback receipts across logout and crash/reinstall.
    }

    func grant(now: Date = .now) throws -> TunnelGrant {
        guard let data = try read("grant"), data.count <= 32768,
              let grant = try? JSONDecoder().decode(TunnelGrant.self, from: data),
              !grant.accountID.isEmpty, !grant.deviceID.isEmpty, !grant.accessToken.isEmpty,
              grant.issuedAt <= now, now.timeIntervalSince(grant.issuedAt) < 86400 else { throw Blocker.sessionExpired }
        return grant
    }
}
