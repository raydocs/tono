import CryptoKit
import Darwin
import Foundation
import IOKit
import os
import Security

nonisolated struct KeychainStore: Sendable {
    enum Key: String, Sendable { case refreshToken, installationId, tailscaleStateKey, deviceAnchor }
    enum Error: Swift.Error { case unexpectedStatus(OSStatus), invalidData }

    private let service: String
    private let suppressionDirectory: URL
    /// `SecItemCopyMatching`, unless a test stands in for a keychain that
    /// refuses a read (locked, or interaction not allowed).
    private let copyMatching: @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
    private let updateItem: @Sendable (CFDictionary, CFDictionary) -> OSStatus
    private let deleteItem: @Sendable (CFDictionary) -> OSStatus
    private let writeRecoveryRecord: @Sendable (String, URL) throws -> Void
    init(
        service: String = Bundle.main.bundleIdentifier.map { "\($0).tono" } ?? "app.tono.account",
        suppressionDirectory: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Tono/credential-suppression", isDirectory: true),
        copyMatching: @escaping @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = {
            SecItemCopyMatching($0, $1)
        },
        updateItem: @escaping @Sendable (CFDictionary, CFDictionary) -> OSStatus = {
            SecItemUpdate($0, $1)
        },
        deleteItem: @escaping @Sendable (CFDictionary) -> OSStatus = {
            SecItemDelete($0)
        },
        writeRecoveryRecord: @escaping @Sendable (String, URL) throws -> Void = {
            try RuntimeCleanup.writeSynced($0, to: $1)
        }
    ) {
        self.service = service
        self.suppressionDirectory = suppressionDirectory
        self.copyMatching = copyMatching
        self.updateItem = updateItem
        self.deleteItem = deleteItem
        self.writeRecoveryRecord = writeRecoveryRecord
    }

    func data(for key: Key) throws -> Data? {
        var query = base(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = copyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw Error.unexpectedStatus(status) }
        guard let data = item as? Data else { throw Error.invalidData }
        return data
    }

    func set(_ data: Data, for key: Key) throws {
        let query = base(key)
        let update = [kSecValueData as String: data]
        let status = updateItem(query as CFDictionary, update as CFDictionary)
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
        let status = deleteItem(base(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Error.unexpectedStatus(status) }
    }

    /// Contains no credential. The service digest keeps independently injected
    /// stores from suppressing one another after a refused replacement.
    private var suppressionURL: URL {
        let digest = SHA256.hash(data: Data(service.utf8)).map { String(format: "%02x", $0) }.joined()
        return suppressionDirectory.appendingPathComponent(digest)
    }

    func suppressRefreshTokenRestoration() throws {
        try writeRecoveryRecord("signed-out", suppressionURL)
    }

    func isRefreshTokenRestorationSuppressed() throws -> Bool {
        let path = suppressionURL.path
        // Existence is the refusal signal; never open a substituted FIFO or
        // follow a symlink just to ask whether restoration is suppressed.
        var metadata = stat()
        if lstat(path, &metadata) == 0 { return true }
        if errno == ENOENT { return false }
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    func clearRefreshTokenSuppression() throws {
        do { try FileManager.default.removeItem(at: suppressionURL) }
        catch let error as CocoaError where error.code == .fileNoSuchFile { return }
    }

    private var adoptionURL: URL { suppressionURL.appendingPathExtension("accepted") }

    private func adoptionProof(for refresh: String) -> String {
        "adopted-v1:" + SHA256.hash(data: Data("tono-adopted-refresh:\(service):\(refresh)".utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    /// Recovery is opt-in, bound to the token actually committed to Keychain.
    /// A token from an older build has no proof and must sign in again.
    func recordAcceptedRefreshToken(_ refresh: String) throws {
        try writeRecoveryRecord(adoptionProof(for: refresh), adoptionURL)
    }

    func hasAcceptedRefreshToken(_ refresh: String) throws -> Bool {
        let descriptor = Darwin.open(adoptionURL.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else {
            if errno == ENOENT || errno == ENOTDIR || errno == ELOOP { return false }
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        defer { Darwin.close(descriptor) }
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        let expected = Data(adoptionProof(for: refresh).utf8)
        guard metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), metadata.st_uid == geteuid(),
              metadata.st_mode & 0o022 == 0, metadata.st_size == off_t(expected.count) else { return false }
        var bytes = [UInt8](repeating: 0, count: expected.count)
        let count = bytes.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
        return count == expected.count && Data(bytes) == expected
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
