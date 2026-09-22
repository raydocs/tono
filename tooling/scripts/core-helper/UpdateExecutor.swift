import Foundation
import Darwin
import Security

/// A copy of the OLD signed helper, outside every replacement destination,
/// runs as its own launchd job. Reboot and daemon replacement cannot remove its
/// executable, ledger, backup or recovery entry.
enum UpdateExecutor {
    static let label = "com.raydocs.tono.update-executor"
    static let plist = "/Library/LaunchDaemons/\(label).plist"
    static let daemonLabel = "com.raydocs.tono.core-helper"
    static let daemonPlist = "/Library/LaunchDaemons/\(daemonLabel).plist"

    static func retire() throws {
        do { try UpdatePackage.run("/bin/launchctl", ["bootout", "system/" + label]) }
        catch {
            if (try? UpdatePackage.run("/bin/launchctl", ["print", "system/" + label])) != nil { throw error }
        }
        guard unlink(plist) == 0 || errno == ENOENT else { throw HelperFailure.system("Cannot retire committed update entry.") }
        try UpdateStorage.syncDirectory("/Library/LaunchDaemons")
    }

    static func stage(source: String, uid: uid_t, manifest: UpdateContractV1.ReleaseManifest,
                      directory: String) throws -> UpdateContractV1.Components {
        try ensureRootDirectory(directory, permissions: 0o700)
        let target = try manifest.target(.macosArm64)
        let archive = directory + "/package.zip"
        try UpdatePackage.snapshot(source, owner: uid, target: target, to: archive)
        try UpdateZIP.validate(archive)
        try ensureRootDirectory(directory + "/expanded", permissions: 0o700)
        try UpdatePackage.run("/usr/bin/ditto", ["-x", "-k", archive, directory + "/expanded"])
        let bundle = directory + "/expanded/Tono.app"
        try UpdatePackage.secureTree(bundle)
        try UpdatePackage.checkTarget(bundle, manifest: manifest)
        let original = try UpdatePackage.components(UpdatePackage.appPath, installed: true)
        try FileManager.default.copyItem(atPath: UpdatePackage.appPath, toPath: directory + "/backup.app")
        try UpdatePackage.secureTree(directory + "/backup.app")
        try FileManager.default.copyItem(atPath: mihomoPath, toPath: directory + "/backup.core")
        try FileManager.default.copyItem(atPath: UpdatePackage.helperPath, toPath: directory + "/backup.helper")
        try FileManager.default.copyItem(atPath: UpdatePackage.helperPath, toPath: directory + "/executor")
        _ = try UpdatePackage.verifyCode(directory + "/executor", identifier: "com.raydocs.tono.helper")
        _ = try UpdatePackage.verifyCode(directory + "/backup.app", identifier: "com.raydocs.tono")
        _ = try UpdatePackage.verifyCode(directory + "/backup.core", identifier: "sing-box")
        _ = try UpdatePackage.verifyCode(directory + "/backup.helper", identifier: "com.raydocs.tono.helper")
        guard try UpdateStorage.fileDigest(directory + "/backup.app" + UpdatePackage.appExecutable) == original.appSha256,
              try UpdateStorage.fileDigest(directory + "/backup.core") == original.coreSha256,
              try UpdateStorage.fileDigest(directory + "/backup.helper") == original.privilegedSha256 else {
            throw HelperFailure.invalid("Installed components changed during rollback staging.")
        }
        try syncTree(directory)
        return original
    }

    static func launch(storage: UpdateStorage, attempt: UpdateStorage.Attempt) throws {
        guard [.consumed, .replacing, .rollingBack].contains(attempt.execution) else {
            throw HelperFailure.invalid("Executor has no consumed update.")
        }
        let executable = storage.attemptDirectory(attempt) + "/executor"
        _ = try secureMetadata(executable, type: mode_t(S_IFREG), owner: 0)
        _ = try UpdatePackage.verifyCode(executable, identifier: "com.raydocs.tono.helper")
        let object: [String: Any] = [
            "Label": label, "ProgramArguments": [executable, "--update-executor"],
            "RunAtLoad": true, "KeepAlive": ["SuccessfulExit": false], "ThrottleInterval": 30,
            "Umask": 63, "StandardOutPath": "/dev/null", "StandardErrorPath": "/dev/null",
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: object, format: .xml, options: 0)
        // Consumption was already synced before this repair-resource mutation.
        try UpdateStorage.write(data, to: plist)
        guard chmod(plist, 0o644) == 0 else { throw HelperFailure.system("Cannot secure update launch entry.") }
        // An already running executor owns the lock; never bootout/kick it.
        do { try UpdatePackage.run("/bin/launchctl", ["bootstrap", "system", plist]) }
        catch { try UpdatePackage.run("/bin/launchctl", ["print", "system/" + label]) }
    }

    /// Called before constructing CoreManager or restoring normal desired
    /// state. A corrupt ledger installs a fail-closed barrier and stops launch.
    static func startup() throws -> Bool {
        let storage = try UpdateStorage()
        return try storage.locked {
            guard let attempt = try storage.load().attempt, attempt.receipt.phase != .committed else { return false }
            if attempt.execution == .consumed && (attempt.receipt.blockedReason != nil || attempt.disconnectRequested) { return false }
            if [.consumed, .replacing, .rollingBack].contains(attempt.execution) {
                try launch(storage: storage, attempt: attempt)
                return true
            }
            return false
        }
    }

    static func run() -> Bool {
        guard geteuid() == 0 else { return false }
        do {
            let uid = try readAllowedUID()
            let storage = try UpdateStorage()
            let initial = try storage.locked { try storage.load().attempt }
            guard let initial else { return true }
            guard initial.receipt.phase != .committed else { return true }
            if initial.execution == .replaced || initial.execution == .rolledBack {
                try startDaemon()
                return true
            }
            if initial.execution == .consumed && (initial.receipt.blockedReason != nil || initial.disconnectRequested) {
                try startDaemon()
                return true
            }
            // Allow the initiating UI to read the consumed receipt and quit.
            // Do not hold flock during this wait (the status query needs it).
            if initial.execution == .consumed, initial.initiatingBoot == (try TonoAuthenticatedPeer.bootSession()) {
                for _ in 0..<300 where processExists(initial.initiatingToken) { usleep(100_000) }
                guard !processExists(initial.initiatingToken) else {
                    throw HelperFailure.invalid("Initiating App did not exit after update consumption.")
                }
            }
            try storage.locked {
                try perform(storage: storage, validate: { attempt in
                    let manifest = try UpdatePackage.verifyManifest(attempt.manifest, signature: attempt.signature)
                    let directory = storage.attemptDirectory(attempt)
                    guard attempt.receipt.owner == "uid:\(uid):YY57758GS7:com.raydocs.tono",
                          attempt.receipt.installedLocationSha256 == UpdateTransaction.location,
                          try UpdateStorage.fileDigest(directory + "/package.zip") == manifest.target(.macosArm64).artifactSha256 else {
                        throw HelperFailure.invalid("Executor target binding differs from the consumed input.")
                    }
                    try UpdatePackage.checkTarget(directory + "/expanded/Tono.app", manifest: manifest)
                    // Consumption is already durable. Stop the old daemon,
                    // then independently re-observe/restore offline ownership
                    // before touching the first installed binary. This also
                    // reconciles DNS/PF after a reboot between prepare/execute.
                    try stopDaemon()
                    let firewall = try KillSwitchManager(allowedUID: uid)
                    let runtime = try UpdateRuntime(core: CoreManager(allowedUID: uid), firewall: firewall,
                        dns: ProtectedDNSManager(), power: PowerTransitionGate())
                    let expected: UpdateContractV1.Protection = attempt.receipt.requiredRecovery == .unprotected ? .unprotected : .protectedOffline
                    guard try runtime.prepare(attempt.receipt.requiredRecovery) == expected else {
                        throw HelperFailure.invalid("Executor cannot verify offline Core/TUN/DNS/proxy/PF state.")
                    }
                }, replace: { attempt in
                    try stopDaemon()
                    let directory = storage.attemptDirectory(attempt)
                    try replaceFile(from: directory + "/expanded/Tono.app", to: UpdatePackage.appPath, in: directory)
                    try replaceFile(from: directory + "/expanded/Tono.app" + UpdatePackage.coreExecutable, to: mihomoPath, in: directory)
                    try replaceFile(from: directory + "/expanded/Tono.app" + UpdatePackage.helperExecutable, to: UpdatePackage.helperPath, in: directory)
                    let manifest = try UpdateContractV1.ReleaseManifest.decode(attempt.manifest)
                    guard try UpdatePackage.components(UpdatePackage.appPath, installed: true) == manifest.target(.macosArm64).components else {
                        throw HelperFailure.invalid("Installed components did not converge.")
                    }
                }, rollback: { attempt in
                    try stopDaemon()
                    let directory = storage.attemptDirectory(attempt)
                    guard let original = attempt.originalComponents,
                          try UpdateStorage.fileDigest(directory + "/backup.app" + UpdatePackage.appExecutable) == original.appSha256,
                          try UpdateStorage.fileDigest(directory + "/backup.core") == original.coreSha256,
                          try UpdateStorage.fileDigest(directory + "/backup.helper") == original.privilegedSha256 else {
                        throw HelperFailure.invalid("Rollback assets are not the captured installation.")
                    }
                    _ = try UpdatePackage.verifyCode(directory + "/backup.app", identifier: "com.raydocs.tono")
                    _ = try UpdatePackage.verifyCode(directory + "/backup.core", identifier: "sing-box")
                    _ = try UpdatePackage.verifyCode(directory + "/backup.helper", identifier: "com.raydocs.tono.helper")
                    try replaceFile(from: directory + "/backup.app", to: UpdatePackage.appPath, in: directory)
                    try replaceFile(from: directory + "/backup.core", to: mihomoPath, in: directory)
                    try replaceFile(from: directory + "/backup.helper", to: UpdatePackage.helperPath, in: directory)
                    guard try UpdatePackage.components(UpdatePackage.appPath, installed: true) == original else {
                        throw HelperFailure.invalid("Rollback components did not converge.")
                    }
                })
            }
            try startDaemon()
            // The executor never impersonates the App on helper IPC. Launch
            // Services starts a new user process, which must authenticate anew.
            try UpdatePackage.run("/bin/launchctl", ["asuser", String(uid), "/usr/bin/sudo", "-u", "#\(uid)", "/usr/bin/open", "-n", UpdatePackage.appPath])
            return true
        } catch {
            // Keep all evidence; do not turn an exception into "not installed".
            // Before the replacing write no binary mutation occurred. Mark
            // this consumed attempt blocked and make diagnostics available.
            if let storage = try? UpdateStorage() {
                let blocked = try? storage.locked { () throws -> Bool in
                    var ledger = try storage.load()
                    guard ledger.attempt?.execution == .consumed else { return false }
                    ledger.attempt?.receipt.blockedReason = .installationUncertain
                    try storage.save(ledger)
                    return true
                }
                if blocked == true { try? startDaemon(); return true }
            }
            // Interrupted replacement/rollback retries recovery, not install.
            return false
        }
    }

    /// Real durable execution boundary used by the daemon's independent entry
    /// and failure tests. A restart at replacing always rolls back; it never
    /// runs the forward replacement a second time.
    static func perform(storage: UpdateStorage,
                        validate: (UpdateStorage.Attempt) throws -> Void,
                        replace: (UpdateStorage.Attempt) throws -> Void,
                        rollback: (UpdateStorage.Attempt) throws -> Void) throws {
        var ledger = try storage.load()
        guard var attempt = ledger.attempt else { throw HelperFailure.invalid("Missing consumed update.") }
        if attempt.execution == .replaced || attempt.execution == .rolledBack || attempt.receipt.phase == .committed { return }
        guard [.consumed, .replacing, .rollingBack].contains(attempt.execution) else { throw HelperFailure.invalid("Unconsumed executor request.") }
        if attempt.execution == .consumed {
            let now = UInt64(max(0, Date().timeIntervalSince1970))
            guard attempt.receipt.blockedReason == nil, !attempt.disconnectRequested,
                  now >= attempt.receipt.updatedAtUnix, now < attempt.receipt.expiresAtUnix else {
                throw HelperFailure.invalid("Consumed update is blocked or expired; manual recovery required.")
            }
            try validate(attempt)
            attempt.execution = .replacing
            ledger.attempt = attempt
            try storage.save(ledger)
            do {
                try replace(attempt)
                attempt.execution = .replaced
                ledger.attempt = attempt
                try storage.save(ledger)
                return
            } catch {
                // A failed post-replacement write may already be visible.
                // Reload instead of replacing it with an older in-memory fact.
                ledger = try storage.load()
                attempt = ledger.attempt!
                if attempt.execution == .replaced { throw error }
            }
        }
        attempt.execution = .rollingBack
        attempt.receipt.blockedReason = .installationUncertain
        ledger.attempt = attempt
        try storage.save(ledger)
        try rollback(attempt)
        attempt.execution = .rolledBack
        ledger.attempt = attempt
        try storage.save(ledger) // highWater and last proof phase are unchanged.
    }

    static func replaceFile(from source: String, to destination: String, in directory: String) throws {
        let incoming = directory + "/incoming-" + UUID().uuidString
        try FileManager.default.copyItem(atPath: source, toPath: incoming)
        var metadata = stat()
        guard lstat(incoming, &metadata) == 0 else { throw HelperFailure.system("Missing replacement input.") }
        if fileType(metadata) == mode_t(S_IFDIR) { try UpdatePackage.secureTree(incoming); try syncTree(incoming) }
        else {
            guard fileType(metadata) == mode_t(S_IFREG), chown(incoming, 0, 0) == 0, chmod(incoming, 0o755) == 0 else {
                throw HelperFailure.invalid("Unsafe replacement executable.")
            }
            try syncFile(incoming)
        }
        if lstat(destination, &metadata) == 0 {
            // Never remove the outgoing asset. Even a half-failed rollback
            // retains its predecessor and the original sealed backup.
            let retired = directory + "/retired-" + UUID().uuidString
            guard rename(destination, retired) == 0 else { throw HelperFailure.system("Cannot retire installed component.") }
            try UpdateStorage.syncDirectory(directory)
        } else if errno != ENOENT { throw HelperFailure.system("Cannot inspect installed component.") }
        guard rename(incoming, destination) == 0 else { throw HelperFailure.system("Cannot replace installed component.") }
        try UpdateStorage.syncDirectory(URL(fileURLWithPath: destination).deletingLastPathComponent().path)
        try UpdateStorage.syncDirectory(directory)
    }

    private static func processExists(_ token: Data) -> Bool {
        var code: SecCode?
        return SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: token] as CFDictionary, [], &code) == errSecSuccess
    }

    private static func stopDaemon() throws {
        do { try UpdatePackage.run("/bin/launchctl", ["bootout", "system/" + daemonLabel]) }
        catch {
            // Already absent after a crash is fine; a still-registered daemon
            // is not. No concurrent daemon may own replacement/recovery.
            if (try? UpdatePackage.run("/bin/launchctl", ["print", "system/" + daemonLabel])) != nil { throw error }
        }
    }

    private static func startDaemon() throws {
        do { try UpdatePackage.run("/bin/launchctl", ["bootstrap", "system", daemonPlist]) }
        catch { try UpdatePackage.run("/bin/launchctl", ["print", "system/" + daemonLabel]) }
    }

    private static func syncFile(_ path: String) throws {
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw HelperFailure.system("Cannot sync private update file.") }
        defer { close(fd) }
        guard fsync(fd) == 0, fcntl(fd, F_FULLFSYNC) == 0 else { throw HelperFailure.system("Private update file is not durable.") }
    }

    static func syncTree(_ path: String) throws {
        guard let enumerator = FileManager.default.enumerator(atPath: path) else { throw HelperFailure.invalid("Missing update tree.") }
        var directories = [path]
        for case let entry as String in enumerator {
            let full = path + "/" + entry
            var metadata = stat()
            guard lstat(full, &metadata) == 0 else { throw HelperFailure.system("Cannot inspect update tree.") }
            if fileType(metadata) == mode_t(S_IFDIR) { directories.append(full) }
            else { try syncFile(full) }
        }
        for directory in directories.reversed() { try UpdateStorage.syncDirectory(directory) }
    }
}
