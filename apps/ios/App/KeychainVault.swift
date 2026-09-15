import Foundation
import Security

@MainActor
protocol CredentialVault {
    func read(_ account: String) throws -> Data?
    func write(_ data: Data, account: String) throws
    func remove(_ account: String) throws
    func installationID() throws -> String
}

/// App-only credentials. App Group contains no tokens or raw catalog/policy.
/// AfterFirstUnlockThisDeviceOnly permits future locked-device extension access
/// only after a separately approved keychain-access-group design; no sync/backup.
struct KeychainVault: CredentialVault {
    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.ninx.tono.account",
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: false]
    }

    func read(_ account: String) throws -> Data? {
        var query = query(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        if status == errSecDecode && account == "session" { throw Blocker.savedSessionCorrupt }
        guard status == errSecSuccess, let data = result as? Data else { throw Blocker.keychainUnavailable }
        return data
    }

    func write(_ data: Data, account: String) throws {
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query(account) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let insert = query(account).merging(attributes) { _, new in new }
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw Blocker.keychainUnavailable }
        } else if status != errSecSuccess { throw Blocker.keychainUnavailable }
    }

    func remove(_ account: String) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Blocker.keychainUnavailable }
    }

    func installationID() throws -> String {
        if let data = try read("installation"), let id = String(data: data, encoding: .utf8) { return id }
        let id = UUID().uuidString
        try write(Data(id.utf8), account: "installation")
        return id
    }
}
