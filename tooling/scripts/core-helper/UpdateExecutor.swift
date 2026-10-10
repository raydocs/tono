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
        try bootout(label)
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
        try UpdatePackage.run("/usr/bin/ditto", ["-x", "-k", archive, directory + "/expanded"], deadline: HelperChildDeadline.ditto)
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
        do { try UpdatePackage.run("/bin/launchctl", ["bootstrap", "system", plist], deadline: HelperChildDeadline.launchctl) }
        catch { try UpdatePackage.run("/bin/launchctl", ["print", "system/" + label], deadline: HelperChildDeadline.launchctl) }
    }

    /// Startup failure used to install an emergency block, and skipped that
    /// block entirely when the allowed uid could not be read (BRICK-M13).
    /// There is no strict kill switch, and no uid is required to release.
    private static func armEmergencyBlock() {
        // Same class as a crash/hang release: open the general block, then
        // best-effort restore a saved dead-loopback DNS snapshot and apply
        // the secondary AI sinkhole. releaseInstalledBlock alone omitted
        // both (M4-UPDATE-SELECTIVE-OMISSION / M4-UPDATE-LEDGER-DNS).
        KillSwitchManager.releaseInstalledBlock()
        if let dns = try? ProtectedDNSManager() {
            try? dns.restore(deferringLossNotice: true)
        }
        SelectiveFailOpenInstaller.applyBestEffort()
    }

    /// Called before constructing CoreManager or restoring normal desired
    /// state. A corrupt ledger stops launch. The default failure action
    /// releases a saved kill switch; it does not install one (BRICK-M13).
    /// Intent is read only under the update lock, including when normal store
    /// opening failed but the existing root directory and lock are secure.
    /// A Mac that was never connected is not blocked by a store it cannot read.
    /// A stop request that arrives while this daemon waits behind the update
    /// lock is not corruption: that SIGTERM is our own update executor's
    /// `launchctl bootout` (the spin guard exists precisely so a bootout can
    /// stop a waiting daemon), the executor owns the replacement flow, and it
    /// bootstraps this daemon back afterwards. Stopping then is clean: no PF
    /// action, exit success.
    static func startup(storage: UpdateStorage? = nil,
                        protectionWanted: () -> Bool = KillSwitchManager.stateFileExists,
                        emergencyBlock: () throws -> Void = armEmergencyBlock) throws -> Bool {
        do {
            let openedStorage: UpdateStorage
            do { openedStorage = try storage ?? UpdateStorage() }
            catch {
                let openingError = error
                // An unsafe or missing directory/lock is not authority for a
                // lockless read. Preserve the original startup failure.
                do {
                    try UpdateStorage.withRootLockForStartup {
                        if protectionWanted() { try? emergencyBlock() }
                    }
                } catch HelperFailure.stopping { return true }
                catch { }
                throw openingError
            }
            return try openedStorage.locked {
                do {
                    guard let attempt = try openedStorage.load().attempt, attempt.receipt.phase != .committed else { return false }
                    if attempt.execution == .consumed && (attempt.receipt.blockedReason != nil || attempt.disconnectRequested) { return false }
                    if [.consumed, .replacing, .rollingBack].contains(attempt.execution) {
                        try launch(storage: openedStorage, attempt: attempt)
                        return true
                    }
                    return false
                } catch HelperFailure.stopping(let message) {
                    throw HelperFailure.stopping(message)
                } catch {
                    if protectionWanted() { try? emergencyBlock() }
                    throw error
                }
            }
        } catch HelperFailure.stopping {
            return true
        }
    }

    /// Ordinary repair must not replace components while a pending attempt
    /// still owns its captured originals. Explicit retirement is separate.
    static func allowsOrdinaryInstall(_ attempt: UpdateStorage.Attempt?) -> Bool {
        attempt == nil || attempt?.receipt.phase == .committed
    }

    static func run() -> Bool {
        guard geteuid() == 0 else { return false }
        return settle(FailureRecovery()) { try execute() }
    }

    /// What a failed executor run may do to the network (#1504 review
    /// R5-F3), behind seams for the self-test. Each reader answers nil when
    /// it cannot tell.
    struct FailureRecovery {
        /// The saved connection target: `released` is an operator release.
        var target: () -> HelperTarget.Reading = { HelperTarget.read() }
        /// The consumed attempt's own Disconnect request.
        var disconnectRequested: () -> Bool? = {
            guard let storage = try? UpdateStorage() else { return nil }
            do {
                return try storage.locked { try storage.load().attempt?.disconnectRequested ?? false }
            } catch {
                return nil
            }
        }
        /// `killswitch.state`: present, definitely absent, or nil.
        var protectionSaved: () -> Bool? = {
            var metadata = stat()
            if lstat(killSwitchStatePath, &metadata) == 0 { return true }
            return errno == ENOENT ? false : nil
        }
        var release: () -> Void = { UpdateExecutor.releaseAfterFailure() }
        /// Marks a consumed attempt blocked; true when it did.
        var markBlocked: () -> Bool = { UpdateExecutor.markConsumedAttemptBlocked() }
        var startDaemon: () throws -> Void = { try UpdateExecutor.startDaemon() }
    }

    /// Only an explicit release intent lets a failed run release the network:
    /// an operator release on record, the attempt's own Disconnect, or no
    /// saved protection at all (the user is disconnected). A failure, a
    /// timeout or a launch with no answer is none of these; neither is a
    /// reading that cannot be made (unknown refuses, never releases).
    static func failureMayRelease(target: HelperTarget.Reading, disconnectRequested: Bool?,
                                  protectionSaved: Bool?) -> Bool {
        if case .recorded(let recorded) = target, recorded.mode == .released { return true }
        if disconnectRequested == true { return true }
        return protectionSaved == false
    }

    /// Runs `body`; on any failure keeps all evidence (an exception is never
    /// "not installed") and settles the network. A failed rollback used to
    /// leave the helper stopped and PF up with no recovery short of another
    /// boot (BRICK-M8), so this released PF and DNS on every failure, and a
    /// bounded `launchctl bootstrap` or successor `open` that merely ran out
    /// of time (the daemon may well be starting) released a protected
    /// update's block and DNS with nobody asking for it (#1504 review R5-F3).
    /// Now the block and protected DNS stay unless `failureMayRelease`; the
    /// daemon is still started for a blocked attempt (it restores saved
    /// protection), and an interrupted replacement or rollback exits failed
    /// so launchd reruns this executor (`KeepAlive`), which retries recovery.
    static func settle(_ recovery: FailureRecovery, _ body: () throws -> Bool) -> Bool {
        do {
            return try body()
        } catch {
            if failureMayRelease(target: recovery.target(), disconnectRequested: recovery.disconnectRequested(),
                                 protectionSaved: recovery.protectionSaved()) {
                recovery.release()
            }
            // Before the replacing write no binary mutation occurred. Mark
            // this consumed attempt blocked and make diagnostics available.
            if recovery.markBlocked() { try? recovery.startDaemon(); return true }
            // Interrupted replacement/rollback retries recovery, not install.
            return false
        }
    }

    /// The release a failed run makes under an explicit release intent:
    /// the general block first, then a saved dead-loopback DNS snapshot,
    /// then the secondary AI layer once PF is gone, or the next helper
    /// launch skips it once the intent file is deleted
    /// (M4-UPDATE-SELECTIVE-OMISSION).
    static func releaseAfterFailure() {
        KillSwitchManager.releaseInstalledBlock()
        if let dns = try? ProtectedDNSManager() {
            try? dns.restore(deferringLossNotice: true)
        }
        SelectiveFailOpenInstaller.applyBestEffort()
    }

    static func markConsumedAttemptBlocked() -> Bool {
        guard let storage = try? UpdateStorage() else { return false }
        let blocked = try? storage.locked { () throws -> Bool in
            var ledger = try storage.load()
            guard ledger.attempt?.execution == .consumed else { return false }
            ledger.attempt?.receipt.blockedReason = .installationUncertain
            try storage.save(ledger)
            return true
        }
        return blocked == true
    }

    private static func execute() throws -> Bool {
        let uid = try readAllowedUID()
        let storage = try UpdateStorage()
        let initial = try storage.locked { try storage.load().attempt }
        guard let initial else { return true }
        guard initial.receipt.phase != .committed else { return true }
        if initial.execution == .replaced || initial.execution == .rolledBack {
            try startDaemon()
            try launchSuccessor(uid: uid, attempt: initial)
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
        let installed = try storage.locked { try storage.load().attempt }
        guard let installed else { throw HelperFailure.invalid("Installed update evidence disappeared.") }
        try launchSuccessor(uid: uid, attempt: installed)
        return true
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

    /// Audit tokens are only meaningful within one boot; a token that no longer
    /// resolves to a live code object proves that incarnation exited. Shared
    /// with the transaction's successor re-adoption check.
    static func processExists(_ token: Data) -> Bool {
        var code: SecCode?
        return SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributeAudit: token] as CFDictionary, [], &code) == errSecSuccess
    }

    private static func stopDaemon() throws {
        try bootout(daemonLabel)
    }

    /// `launchctl bootout system/<label>`. Already absent after a crash is
    /// fine; a still-registered daemon is not: no concurrent daemon may own
    /// replacement or recovery. Only launchd's definite "no such service"
    /// (`print` exit 113) counts as absent (#1504 review R5-F4): a bootout
    /// or a `print` that failed otherwise, ran out of time or never started
    /// is no answer, and the stop is refused, as `--emergency-disarm`'s own
    /// stop does (`OperatorDaemonStop`).
    static func bootout(
        _ label: String,
        launchctl: ([String]) throws -> Int32 = {
            try UpdatePackage.status("/bin/launchctl", $0, deadline: HelperChildDeadline.launchctl)
        }
    ) throws {
        let service = "system/" + label
        var failure: any Error = HelperFailure.system("Native update operation failed: launchctl.")
        do {
            guard try launchctl(["bootout", service]) != 0 else { return }
        } catch {
            failure = error
        }
        guard (try? launchctl(["print", service])) == OperatorDaemonStop.launchctlNoSuchService else {
            throw failure
        }
    }

    private static func startDaemon() throws {
        do { try UpdatePackage.run("/bin/launchctl", ["bootstrap", "system", daemonPlist], deadline: HelperChildDeadline.launchctl) }
        catch { try UpdatePackage.run("/bin/launchctl", ["print", "system/" + daemonLabel], deadline: HelperChildDeadline.launchctl) }
    }

    private static func launchSuccessor(uid: uid_t, attempt: UpdateStorage.Attempt) throws {
        if let token = attempt.successorToken,
           attempt.successorBoot == (try TonoAuthenticatedPeer.bootSession()), processExists(token) { return }
        // Re-enter this path after a crash between the replaced write and
        // launch. The executor does not impersonate the App on helper IPC;
        // Launch Services starts a fresh process that must authenticate anew.
        try UpdatePackage.run("/bin/launchctl", ["asuser", String(uid), "/usr/bin/sudo", "-u", "#\(uid)", "/usr/bin/open", "-n", UpdatePackage.appPath], deadline: HelperChildDeadline.openApp)
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
