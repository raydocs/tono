import Foundation
import Darwin
import CryptoKit

/// The daemon and the separately registered executor use the same lock and
/// ledger. No in-memory acknowledgement survives a failed durable write.
final class UpdateStorage {
    static let directory = "/Library/Application Support/Tono/Updates"
    let root: String
    private let lockFD: Int32
    private let synchronizeDirectory: (String) throws -> Void

    enum Execution: String, Codable {
        case reserved, staged, consumed, replacing, replaced, rollingBack, rolledBack
    }

    struct Attempt: Codable {
        let manifest: Data
        let signature: Data
        var receipt: UpdateContractV1.Receipt
        let initiatingToken: Data
        let initiatingBoot: String
        var successorToken: Data?
        var successorBoot: String?
        var execution: Execution
        var originalComponents: UpdateContractV1.Components?
        var requiresTUN: Bool
        var disconnectRequested: Bool
        var disconnectVerified: Bool
    }

    struct Ledger: Codable {
        var generation: UInt64 = 0
        var highWater: UInt64 = 0
        var attempt: Attempt?
    }

    /// Storage major of `ledger.json`. Absent means 1, the unversioned v1
    /// layout; a writer emits `schemaVersion` only once it writes 2 or later.
    /// Within one major an older executor copy ignores keys it does not know,
    /// so additive fields must be optional and safe to drop. Anything else
    /// bumps the major, which is refused as newer evidence (retained), not as
    /// corruption. See docs/UPDATE_PROTOCOL_V1.md.
    static let schemaVersion: UInt64 = 1

    private struct SchemaProbe: Decodable { let schemaVersion: UInt64? }

    init(root: String = UpdateStorage.directory,
         synchronizeDirectory: @escaping (String) throws -> Void = UpdateStorage.syncDirectory) throws {
        self.root = root
        self.synchronizeDirectory = synchronizeDirectory
        if root == Self.directory {
            // Startup reconciliation runs before DNS/PF managers, including on
            // the first helper install. Do not rely on them creating this.
            _ = try secureMetadata("/Library", type: mode_t(S_IFDIR), owner: 0)
            _ = try secureMetadata("/Library/Application Support", type: mode_t(S_IFDIR), owner: 0)
            try ensureRootDirectory("/Library/Application Support/Tono", permissions: 0o700)
            try Self.syncDirectory("/Library/Application Support")
        }
        try ensureRootDirectory(root, permissions: 0o700)
        try Self.syncDirectory(URL(fileURLWithPath: root).deletingLastPathComponent().path)
        lockFD = open(root + "/lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard lockFD >= 0 else { throw HelperFailure.system("Update lock is unavailable.") }
        do { _ = try secureMetadata(root + "/lock", type: mode_t(S_IFREG), owner: 0) }
        catch { close(lockFD); throw error }
    }

    deinit { close(lockFD) }

    func locked<T>(_ body: () throws -> T) throws -> T {
        // launchctl bootout must be able to stop a daemon waiting behind the
        // executor. A blocking flock would otherwise deadlock that bootout.
        while flock(lockFD, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR else {
                throw HelperFailure.system("Update lock unavailable or helper stopping.")
            }
            // The stop request is our own update executor's bootout SIGTERM.
            // Report it as a clean stop, not as lock or ledger trouble, so the
            // daemon can exit without arming fail-closed evidence barriers.
            guard helperShutdownRequested == 0 else {
                throw HelperFailure.stopping("Update lock unavailable or helper stopping.")
            }
            usleep(50_000)
        }
        defer { flock(lockFD, LOCK_UN) }
        return try body()
    }

    func load() throws -> Ledger {
        let path = root + "/ledger.json"
        var metadata = stat()
        if lstat(path, &metadata) != 0, errno == ENOENT { return Ledger() }
        let bytes = try Self.read(path, maximum: 128 * 1024)
        guard let schema = try? JSONDecoder().decode(SchemaProbe.self, from: bytes).schemaVersion ?? 1,
              schema >= 1 else {
            throw HelperFailure.invalid("Update ledger is corrupt; retained for recovery.")
        }
        guard schema <= Self.schemaVersion else {
            throw HelperFailure.invalid("Update ledger was written by a newer Tono (schema \(schema)); retained for that version.")
        }
        let ledger = try JSONDecoder().decode(Ledger.self, from: bytes)
        let canonical = try UpdateContractV1.canonical(ledger)
        guard canonical == bytes || Self.knownFieldsMatch(bytes, canonical: canonical),
              ledger.generation <= UpdateContractV1.maxInteger,
              ledger.highWater <= UpdateContractV1.maxInteger else {
            throw HelperFailure.invalid("Update ledger is corrupt; retained for recovery.")
        }
        if let attempt = ledger.attempt {
            let manifest = try UpdateContractV1.ReleaseManifest.decode(attempt.manifest)
            _ = try UpdateContractV1.Receipt.decode(
                UpdateContractV1.canonical(attempt.receipt), manifest: manifest
            )
            guard ledger.generation >= (attempt.receipt.successorGeneration ?? attempt.receipt.initiatingGeneration),
                  attempt.execution == .reserved || attempt.execution == .staged
                    || ledger.highWater >= manifest.releaseSequence else {
                throw HelperFailure.invalid("Update execution evidence is inconsistent.")
            }
        }
        // A previous save may have renamed successfully but failed its final
        // directory sync. Re-establish durability before any query/replay can
        // acknowledge that visible candidate or retire its recovery entry.
        try synchronizeDirectory(root)
        return ledger
    }

    /// Keys this build does not know are skipped; every key it does know must
    /// carry exactly the value that re-encodes canonically.
    static func knownFieldsMatch(_ bytes: Data, canonical: Data) -> Bool {
        func project(_ value: Any, onto reference: Any) -> Any {
            guard let object = value as? [String: Any], let known = reference as? [String: Any] else { return value }
            var kept = [String: Any]()
            for (key, knownValue) in known { if let present = object[key] { kept[key] = project(present, onto: knownValue) } }
            return kept
        }
        guard let file = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let known = try? JSONSerialization.jsonObject(with: canonical) as? [String: Any],
              let projected = project(file, onto: known) as? [String: Any],
              // Only keys this build does not know may make the bytes non-canonical.
              !NSDictionary(dictionary: file).isEqual(to: projected) else { return false }
        return NSDictionary(dictionary: projected).isEqual(to: known)
    }

    func save(_ ledger: Ledger) throws {
        try Self.write(UpdateContractV1.canonical(ledger), to: root + "/ledger.json",
                       synchronizeDirectory: synchronizeDirectory)
    }

    func attemptDirectory(_ attempt: Attempt) -> String {
        root + "/" + attempt.receipt.attemptId
    }

    static func read(_ path: String, maximum: Int) throws -> Data {
        let metadata = try secureMetadata(path, type: mode_t(S_IFREG), owner: 0)
        guard metadata.st_size <= maximum else { throw HelperFailure.invalid("Update record is too large.") }
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw HelperFailure.system("Cannot read update record.") }
        defer { close(fd) }
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count == 0 { return result }
            if count < 0, errno == EINTR { continue }
            guard count > 0, result.count + count <= maximum else {
                throw HelperFailure.system("Cannot read bounded update record.")
            }
            result.append(contentsOf: buffer.prefix(count))
        }
    }

    static func write(_ bytes: Data, to path: String,
                      synchronizeDirectory: (String) throws -> Void = UpdateStorage.syncDirectory) throws {
        let temporary = path + "." + UUID().uuidString
        let fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw HelperFailure.system("Cannot create update record.") }
        defer { close(fd); unlink(temporary) }
        try bytes.withUnsafeBytes {
            if let base = $0.baseAddress { try writeAll(fd, bytes: base, count: $0.count) }
        }
        // F_FULLFSYNC includes the drive cache on macOS. A failed directory
        // sync after rename is an uncertain write, never permission to mutate.
        guard fchown(fd, 0, 0) == 0, fchmod(fd, 0o600) == 0,
              fsync(fd) == 0, fcntl(fd, F_FULLFSYNC) == 0,
              rename(temporary, path) == 0 else {
            throw HelperFailure.system("Update record was not durably committed.")
        }
        try synchronizeDirectory(URL(fileURLWithPath: path).deletingLastPathComponent().path)
    }

    static func syncDirectory(_ path: String) throws {
        let fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw HelperFailure.system("Cannot open update directory.") }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw HelperFailure.system("Cannot sync update directory.") }
    }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func fileDigest(_ path: String) throws -> String {
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw HelperFailure.invalid("Update component cannot be opened.") }
        defer { close(fd) }
        var metadata = stat()
        guard fstat(fd, &metadata) == 0, fileType(metadata) == mode_t(S_IFREG) else {
            throw HelperFailure.invalid("Update component is not a regular file.")
        }
        var hash = SHA256()
        var buffer = [UInt8](repeating: 0, count: 65_536)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { throw HelperFailure.system("Cannot hash update component.") }
            hash.update(data: Data(buffer.prefix(count)))
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
