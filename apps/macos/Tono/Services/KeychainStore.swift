import CryptoKit
import Foundation
import IOKit
import os
import Security

nonisolated struct KeychainStore: Sendable {
    enum Key: String, Sendable { case refreshToken, installationId, tailscaleStateKey, deviceAnchor }
    enum Error: Swift.Error { case unexpectedStatus(OSStatus), invalidData }

    private let service: String
    init(service: String = Bundle.main.bundleIdentifier.map { "\($0).tono" } ?? "app.tono.account") { self.service = service }

    func data(for key: Key) throws -> Data? {
        var query = base(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Error.unexpectedStatus(status) }
        guard let data = item as? Data else { throw Error.invalidData }
        return data
    }

    func set(_ data: Data, for key: Key) throws {
        let query = base(key)
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query; add[kSecValueData as String] = data
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw Error.unexpectedStatus(addStatus) }
        } else if status != errSecSuccess { throw Error.unexpectedStatus(status) }
    }

    func string(for key: Key) throws -> String? {
        guard let data = try data(for: key) else { return nil }
        guard let value = String(data: data, encoding: .utf8) else { throw Error.invalidData }
        return value
    }
    func set(_ value: String, for key: Key) throws { try set(Data(value.utf8), for: key) }
    func remove(_ key: Key) throws {
        let status = SecItemDelete(base(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Error.unexpectedStatus(status) }
    }
    func installationId() throws -> String {
        if let existing = try string(for: .installationId) { return existing }
        let value = UUID().uuidString.lowercased(); try set(value, for: .installationId); return value
    }

    /// These items live in the file-based login keychain, which ignores
    /// `kSecAttrAccessible`, so "ThisDeviceOnly" does not hold: Migration
    /// Assistant or a restore carries the keychain to another Mac. Two Macs
    /// would then share one device identity and one single-use refresh token.
    /// The stored anchor travels with them and the hardware does not, so a
    /// mismatch drops this copy of the session. The Mac signs in as a new
    /// device, and the original keeps its own session. A store from an earlier
    /// build, with no anchor, adopts the current one. Returns whether the
    /// session was dropped.
    @discardableResult
    func discardSessionCopiedFromAnotherMac(
        currentAnchor: String?,
        recordAnchor: ((String) throws -> Void)? = nil
    ) throws -> Bool {
        guard let currentAnchor else { return false }
        let record: (String) throws -> Void = recordAnchor ?? { try self.set($0, for: .deviceAnchor) }
        guard let stored = try string(for: .deviceAnchor) else {
            // Adopting the anchor is bookkeeping. If it cannot be written, the
            // session stays and the next launch tries again.
            do {
                try record(currentAnchor)
            } catch {
                Logger(subsystem: "com.raydocs.tono", category: "account")
                    .error("Could not record the device anchor: \(String(describing: error), privacy: .public)")
            }
            return false
        }
        guard stored != currentAnchor else { return false }
        try remove(.refreshToken)
        try remove(.installationId)
        try record(currentAnchor)
        return true
    }

    /// A digest of this Mac's `IOPlatformUUID`, or nil when it cannot be read.
    static func hardwareAnchor() -> String? {
        let platform = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
        guard platform != 0 else { return nil }
        defer { IOObjectRelease(platform) }
        guard let uuid = IORegistryEntryCreateCFProperty(
            platform, kIOPlatformUUIDKey as CFString, kCFAllocatorDefault, 0
        )?.takeRetainedValue() as? String, !uuid.isEmpty else { return nil }
        return SHA256.hash(data: Data("tono-device-anchor:\(uuid)".utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    private func base(_ key: Key) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: key.rawValue, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    }
}
