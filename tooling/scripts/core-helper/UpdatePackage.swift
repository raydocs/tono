import Foundation
import CryptoKit
import Darwin
import Security

enum UpdatePackage {
    static let appPath = "/Applications/Tono.app"
    static let helperPath = "/Library/PrivilegedHelperTools/tono-core-helper"
    static let appExecutable = "/Contents/MacOS/Tono"
    static let coreExecutable = "/Contents/Resources/sing-box"
    static let helperExecutable = "/Contents/Resources/tono-core-helper"
    // Same release identity as SUPublicEDKey. It is compiled into root code;
    // neither a downloaded key nor mutable App preferences can override it.
    static let publicKey = "uOGYz+x/v6Q8X73dlBY2BHZhBpV7jghAfum980nBiAQ="

    static func verifyManifest(_ bytes: Data, signature: Data) throws -> UpdateContractV1.ReleaseManifest {
        guard bytes.count <= UpdateContractV1.maxBytes, signature.count <= 4096,
              let text = String(data: signature, encoding: .utf8),
              let raw = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)), raw.count == 64,
              let key = Data(base64Encoded: publicKey),
              try Curve25519.Signing.PublicKey(rawRepresentation: key).isValidSignature(raw, for: bytes) else {
            throw HelperFailure.invalid("Detached update signature is invalid.")
        }
        return try UpdateContractV1.ReleaseManifest.decode(bytes)
    }

    static func requirement(_ identifier: String) throws -> SecRequirement {
        let text = #"anchor apple generic and identifier "\#(identifier)" and certificate leaf[subject.OU] = "YY57758GS7" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and entitlement["com.apple.security.get-task-allow"] absent"#
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess,
              let requirement else { throw HelperFailure.invalid("Update signing requirement is invalid.") }
        return requirement
    }

    @discardableResult
    static func verifyCode(_ path: String, identifier: String) throws -> SecStaticCode {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(URL(fileURLWithPath: path) as CFURL, [], &code) == errSecSuccess,
              let code,
              SecStaticCodeCheckValidity(code,
                SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode),
                try requirement(identifier)) == errSecSuccess else {
            throw HelperFailure.invalid("Update code is not the sealed Tono Developer ID build.")
        }
        return code
    }

    static func livePeer(_ peer: TonoAuthenticatedPeer) throws {
        guard peer.bundleURL.path == appPath, canonicalPath(appPath) == appPath else {
            throw HelperFailure.invalid("Update requires the registered /Applications/Tono.app.")
        }
        // Manual bootstrap may be owned by the authenticated installing user;
        // executor-installed successors are root-owned. Another user's bundle
        // and writable/shared component directories cannot register here.
        for suffix in ["", "/Contents", "/Contents/MacOS", "/Contents/Resources"] {
            _ = try secureMetadata(appPath + suffix, type: mode_t(S_IFDIR), owner: 0, allowOwner: peer.uid)
        }
        _ = try secureMetadata(appPath + appExecutable, type: mode_t(S_IFREG), owner: 0, allowOwner: peer.uid)
        let installed = try verifyCode(appPath, identifier: "com.raydocs.tono")
        var live: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil,
            [kSecGuestAttributeAudit: peer.auditToken] as CFDictionary, [], &live) == errSecSuccess,
              let live, SecCodeCheckValidity(live, [], try requirement("com.raydocs.tono")) == errSecSuccess else {
            throw HelperFailure.invalid("Update requesting process is no longer authenticated.")
        }
        try sameCode(live, installed: installed)
    }

    static func runningHelperMatchesInstalled() throws {
        var live: SecCode?
        guard SecCodeCopySelf([], &live) == errSecSuccess, let live else {
            throw HelperFailure.invalid("Cannot authenticate the running update helper.")
        }
        try sameCode(live, installed: verifyCode(helperPath, identifier: "com.raydocs.tono.helper"))
    }

    static func sameCode(_ live: SecCode, installed: SecStaticCode) throws {
        // SecCodeCopySigningInformation(dynamic) alone reads disk metadata.
        // This public dynamic validity check compares the kernel-loaded
        // CDHash to disk and rejects an old process after path replacement
        // with errSecCSStaticCodeChanged (Apple Security Code.cpp).
        guard SecCodeCheckValidity(live, [], nil) == errSecSuccess else {
            throw HelperFailure.invalid("Loaded update process no longer matches its on-disk image.")
        }
        var dynamicInfo: CFDictionary?
        var staticInfo: CFDictionary?
        guard SecCodeCopySigningInformation(live, SecCSFlags(rawValue: kSecCSSigningInformation), &dynamicInfo) == errSecSuccess,
              SecCodeCopySigningInformation(installed, SecCSFlags(rawValue: kSecCSSigningInformation), &staticInfo) == errSecSuccess,
              let a = (dynamicInfo as? [String: Any])?[kSecCodeInfoUnique as String] as? Data,
              let b = (staticInfo as? [String: Any])?[kSecCodeInfoUnique as String] as? Data,
              a == b else { throw HelperFailure.invalid("Running and registered code identities differ.") }
    }

    static func components(_ bundle: String, installed: Bool = false) throws -> UpdateContractV1.Components {
        _ = try verifyCode(bundle, identifier: "com.raydocs.tono")
        let core = installed ? mihomoPath : bundle + coreExecutable
        let helper = installed ? helperPath : bundle + helperExecutable
        _ = try verifyCode(core, identifier: "sing-box")
        _ = try verifyCode(helper, identifier: "com.raydocs.tono.helper")
        if installed {
            _ = try secureMetadata(core, type: mode_t(S_IFREG), owner: 0)
            _ = try secureMetadata(helper, type: mode_t(S_IFREG), owner: 0)
        }
        return try .init(appSha256: UpdateStorage.fileDigest(bundle + appExecutable),
                         coreSha256: UpdateStorage.fileDigest(core),
                         privilegedSha256: UpdateStorage.fileDigest(helper))
    }

    struct BuildSource: Decodable {
        let commit: String?
        let releaseSequence: UInt64?
    }

    static func buildSource(_ bundle: String) throws -> BuildSource {
        // Caller first validates the entire signature, including this resource.
        let bytes = try Data(contentsOf: URL(fileURLWithPath: bundle + "/Contents/Resources/tono-build-source.json"))
        guard bytes.count < 4096 else { throw HelperFailure.invalid("Invalid update build metadata.") }
        let value = try JSONDecoder().decode(BuildSource.self, from: bytes)
        guard let sequence = value.releaseSequence, (1...UpdateContractV1.maxInteger).contains(sequence),
              let commit = value.commit, commit.count == 40 else {
            throw HelperFailure.invalid("This build has no signed update sequence floor. Use a paired candidate for manual bootstrap.")
        }
        return value
    }

    static func checkTarget(_ bundle: String, manifest: UpdateContractV1.ReleaseManifest) throws {
        guard try components(bundle) == manifest.target(.macosArm64).components else {
            throw HelperFailure.invalid("Private update components do not match the manifest.")
        }
        let source = try buildSource(bundle)
        let info = try PropertyListSerialization.propertyList(
            from: Data(contentsOf: URL(fileURLWithPath: bundle + "/Contents/Info.plist")), format: nil
        ) as? [String: Any]
        guard source.commit == manifest.buildCommit, source.releaseSequence == manifest.releaseSequence,
              info?["CFBundleShortVersionString"] as? String == manifest.appVersion else {
            throw HelperFailure.invalid("Signed update build metadata does not match the manifest.")
        }
    }

    /// Open each component relative to its parent FD. realpath followed by
    /// open(path) would permit an ancestor swap between the two operations.
    static func openInput(_ path: String, owner: uid_t) throws -> (Int32, stat) {
        guard path.hasPrefix("/"), !path.utf8.contains(0) else { throw HelperFailure.invalid("Invalid package path.") }
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        guard !parts.isEmpty, !parts.contains(".."), !parts.contains(".") else { throw HelperFailure.invalid("Invalid package path.") }
        var parent = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard parent >= 0 else { throw HelperFailure.system("Cannot open package root.") }
        for (index, part) in parts.enumerated() {
            let flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | (index == parts.count - 1 ? 0 : O_DIRECTORY)
            let next = openat(parent, String(part), flags)
            close(parent)
            guard next >= 0 else { throw HelperFailure.invalid("Package path traverses an unavailable or linked entry.") }
            parent = next
        }
        var metadata = stat()
        guard fstat(parent, &metadata) == 0, fileType(metadata) == mode_t(S_IFREG),
              metadata.st_uid == owner, metadata.st_nlink == 1, metadata.st_mode & 0o022 == 0 else {
            close(parent)
            throw HelperFailure.invalid("Package input ownership, permissions or type is invalid.")
        }
        return (parent, metadata)
    }

    static func snapshot(_ source: String, owner: uid_t, target: UpdateContractV1.Target, to destination: String) throws {
        let (input, before) = try openInput(source, owner: owner)
        defer { close(input) }
        guard before.st_size == target.artifactSizeBytes else { throw HelperFailure.invalid("Package size mismatch.") }
        let output = open(destination, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard output >= 0 else { throw HelperFailure.system("Cannot reserve private package.") }
        defer { close(output) }
        var count: Int64 = 0
        var buffer = [UInt8](repeating: 0, count: 65_536)
        while true {
            let n = Darwin.read(input, &buffer, buffer.count)
            if n == 0 { break }
            if n < 0, errno == EINTR { continue }
            guard n > 0 else { throw HelperFailure.system("Package read failed.") }
            count += Int64(n)
            guard count <= before.st_size else { throw HelperFailure.invalid("Package grew during staging.") }
            try buffer.withUnsafeBytes { try writeAll(output, bytes: $0.baseAddress!, count: n) }
        }
        var after = stat()
        guard fstat(input, &after) == 0, count == before.st_size, after.st_size == before.st_size,
              after.st_mtimespec.tv_sec == before.st_mtimespec.tv_sec,
              after.st_mtimespec.tv_nsec == before.st_mtimespec.tv_nsec,
              fchown(output, 0, 0) == 0, fsync(output) == 0, fcntl(output, F_FULLFSYNC) == 0,
              try UpdateStorage.fileDigest(destination) == target.artifactSha256 else {
            throw HelperFailure.invalid("Private package bytes do not match the signed target.")
        }
        try UpdateStorage.syncDirectory(URL(fileURLWithPath: destination).deletingLastPathComponent().path)
    }

    static func run(_ executable: String, _ arguments: [String]) throws {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: executable)
        child.arguments = arguments
        child.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": "/var/root"]
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        try child.run()
        child.waitUntilExit()
        guard child.terminationStatus == 0 else { throw HelperFailure.system("Native update operation failed: \(URL(fileURLWithPath: executable).lastPathComponent).") }
    }

    static func secureTree(_ path: String) throws {
        var paths = [path]
        guard let enumerator = FileManager.default.enumerator(atPath: path) else {
            throw HelperFailure.invalid("Cannot enumerate private bundle.")
        }
        for case let entry as String in enumerator { paths.append(path + "/" + entry) }
        for entry in paths {
            var metadata = stat()
            guard lstat(entry, &metadata) == 0,
                  [mode_t(S_IFREG), mode_t(S_IFDIR)].contains(fileType(metadata)), metadata.st_nlink == 1 || fileType(metadata) == mode_t(S_IFDIR),
                  chown(entry, 0, 0) == 0,
                  chmod(entry, fileType(metadata) == mode_t(S_IFDIR) || metadata.st_mode & 0o111 != 0 ? 0o755 : 0o644) == 0 else {
                throw HelperFailure.invalid("Linked or unsafe private bundle entry.")
            }
        }
    }
}

/// Preflight before ditto: reject aliases, special files, duplicate paths,
/// traversal, encryption, multi-disk/ZIP64 and expansion bombs. Tono's v1 full
/// bundle has no embedded framework symlinks. No archive-selected output path.
enum UpdateZIP {
    static func validate(_ path: String) throws {
        let file = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
        defer { try? file.close() }
        let length = try file.seekToEnd()
        guard length >= 22 else { throw HelperFailure.invalid("Invalid update ZIP.") }
        try file.seek(toOffset: length - min(length, 65_557))
        let tail = try file.readToEnd() ?? Data()
        func integer(_ bytes: Data, _ index: Int, _ width: Int) throws -> Int {
            guard index >= 0, index + width <= bytes.count else { throw HelperFailure.invalid("Truncated update ZIP.") }
            return (0..<width).reduce(0) { $0 | Int(bytes[index + $1]) << (8 * $1) }
        }
        guard let end = (0...(tail.count - 22)).reversed().first(where: {
            tail[$0..<$0+4].elementsEqual([0x50, 0x4b, 0x05, 0x06])
        }), try integer(tail, end + 4, 4) == 0,
              try integer(tail, end + 8, 2) == integer(tail, end + 10, 2),
              end + 22 + (try integer(tail, end + 20, 2)) == tail.count else {
            throw HelperFailure.invalid("Unsupported update ZIP directory.")
        }
        let entries = try integer(tail, end + 10, 2)
        let size = try integer(tail, end + 12, 4)
        let offset = try integer(tail, end + 16, 4)
        guard entries > 0, entries < 65_535, size <= 32 * 1024 * 1024,
              UInt64(offset + size) == length - UInt64(tail.count - end) else {
            throw HelperFailure.invalid("Invalid update ZIP bounds.")
        }
        try file.seek(toOffset: UInt64(offset))
        let directory = try file.read(upToCount: size) ?? Data()
        var cursor = 0
        var inflated: UInt64 = 0
        var names = Set<String>()
        for _ in 0..<entries {
            guard try integer(directory, cursor, 4) == 0x02014b50,
                  try integer(directory, cursor + 8, 2) & 1 == 0 else { throw HelperFailure.invalid("Invalid update ZIP entry.") }
            let nameSize = try integer(directory, cursor + 28, 2)
            let extraSize = try integer(directory, cursor + 30, 2)
            let commentSize = try integer(directory, cursor + 32, 2)
            let mode = try integer(directory, cursor + 38, 4) >> 16
            let local = try integer(directory, cursor + 42, 4)
            guard cursor + 46 + nameSize <= directory.count else { throw HelperFailure.invalid("Truncated ZIP name.") }
            let bytes = directory.subdata(in: cursor + 46..<cursor + 46 + nameSize)
            guard let name = String(data: bytes, encoding: .utf8),
                  name.hasPrefix("Tono.app/") || name == "__MACOSX/" || name.hasPrefix("__MACOSX/Tono.app/") || name == "__MACOSX/._Tono.app",
                  !name.split(separator: "/").contains(".."), !name.split(separator: "/").contains("."),
                  !name.contains("\\"), !name.contains("//"),
                  name.utf8.allSatisfy({ $0 >= 32 && $0 != 127 }),
                  [0, Int(S_IFREG), Int(S_IFDIR)].contains(mode & Int(S_IFMT)),
                  names.insert(name.lowercased()).inserted else { throw HelperFailure.invalid("Unsafe ZIP path or link.") }
            try file.seek(toOffset: UInt64(local))
            let header = try file.read(upToCount: 30 + nameSize) ?? Data()
            guard try integer(header, 0, 4) == 0x04034b50,
                  try integer(header, 26, 2) == nameSize,
                  header.dropFirst(30) == bytes else { throw HelperFailure.invalid("ZIP local entry differs from directory.") }
            inflated += UInt64(try integer(directory, cursor + 24, 4))
            guard inflated <= 8_589_934_592 else { throw HelperFailure.invalid("Update ZIP expansion exceeds limit.") }
            cursor += 46 + nameSize + extraSize + commentSize
        }
        guard cursor == directory.count else { throw HelperFailure.invalid("Update ZIP has trailing directory data.") }
    }
}
