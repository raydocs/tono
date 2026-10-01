import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt
import Security

final class SocketServer {
    private let allowedUID: uid_t
    private let allowedGID: gid_t
    private let authorizer: TonoPeerAuthorizer
    private let core: CoreManager
    private let killSwitch: KillSwitchManager
    private let protectedDNS: ProtectedDNSManager
    private let transitionGate: PowerTransitionGate
    private let powerMonitor: HelperPowerMonitor
    private let updates: UpdateTransaction
    private var serverFD: Int32 = -1
    /// Last `openNetworkEpoch` observed by the idle loop. A newer epoch means
    /// an arm or a release committed, so the core-down count starts over.
    private var openNetworkEpoch: UInt64 = 0
    private var consecutiveCoreDownChecks = 0
    /// The peer that last successfully armed or started the Core, with the
    /// kernel's start time for that pid so a reused pid is not mistaken for
    /// the recorded incarnation. In memory only: a restarted helper has no
    /// owner and keeps its current behavior.
    private var sessionOwner: SessionOwner?
    /// Idle-loop checks, 10s apart, with the bootstrap-only block still held
    /// after its recorded owner died.
    private var consecutiveOrphanedOwnerChecks = 0

    /// The process identity behind a peer socket, as read from the kernel —
    /// never app-supplied.
    struct SessionOwner {
        let pid: pid_t
        let startSeconds: UInt64
        let startMicroseconds: UInt64
    }

    /// Launch does not install PF. `run()` releases a leftover after this
    /// init has stopped a stale Core. A Core that is still running is left
    /// alone.
    init(allowedUID: uid_t, killSwitch: KillSwitchManager) throws {
        self.allowedUID = allowedUID
        self.killSwitch = killSwitch
        allowedGID = try allowedGroup(for: allowedUID)
        authorizer = try TonoPeerAuthorizer(allowedUID: allowedUID)
        try ensureRootDirectory(socketDirectory, permissions: 0o755)
        core = try CoreManager(allowedUID: allowedUID)
        protectedDNS = try ProtectedDNSManager()
        transitionGate = PowerTransitionGate()
        updates = .live(storage: try UpdateStorage(), runtime: UpdateRuntime(
            core: core, firewall: killSwitch, dns: protectedDNS, power: transitionGate
        ))
        powerMonitor = HelperPowerMonitor(
            killSwitch: killSwitch,
            core: core,
            transitionGate: transitionGate
        )
        try setupSocket()
        try powerMonitor.start()
    }

    /// The Core constructor has already stopped a stale child. A snapshot
    /// left behind then points the system resolver at a listener that is
    /// gone. Failure stays on the snapshot: startup must not turn it into
    /// a PF block.
    private func recoverDNSAfterStoppedCore() {
        let snapshotPresent = protectedDNS.status()["snapshotPresent"] as? Bool == true
        guard ProtectedDNSManager.shouldRecoverDNSAtBoot(
            coreRunning: core.status().running,
            snapshotPresent: snapshotPresent
        ) else { return }
        do {
            _ = try protectedDNS.restore(deferringLossNotice: true)
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            FileHandle.standardError.write(Data(
                "tono: boot DNS recovery kept the saved resolvers: \(detail)\n".utf8
            ))
        }
    }

    deinit {
        if serverFD >= 0 { close(serverFD) }
    }

    private func setupSocket() throws {
        try removeIfPresent(socketPath, requiredType: mode_t(S_IFSOCK), allowedOwner: allowedUID)
        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { throw HelperFailure.system("Could not create helper socket.") }
        _ = fcntl(serverFD, F_SETFD, FD_CLOEXEC)

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let copied = socketPath.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) { tuple in
                tuple.withMemoryRebound(to: CChar.self, capacity: 104) {
                    strlcpy($0, source, 104)
                }
            }
        }
        guard copied < 104 else { throw HelperFailure.invalid("Helper socket path is too long.") }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(serverFD, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0,
              chown(socketPath, allowedUID, allowedGID) == 0,
              chmod(socketPath, 0o600) == 0,
              listen(serverFD, 8) == 0 else {
            throw HelperFailure.system("Could not secure helper socket.")
        }
    }

    /// A saved DNS snapshot with the Core stopped still points the resolver
    /// at a listener that is gone. Restore it at launch. Do not touch DNS
    /// while the Core is running.
    static func shouldRestoreSavedDNSAtLaunch(coreRunning: Bool, snapshotPresent: Bool) -> Bool {
        !coreRunning && snapshotPresent
    }

    /// Idle-loop checks, 10s apart, with a bootstrap-only block still held
    /// after its recorded owner died. Three is about 30s, like the core-down
    /// threshold: long enough that a slow live connect is never misread,
    /// short enough not to stretch the outage.
    static let orphanedBootstrapReleaseThreshold = 3

    /// What the Core-running branch of the idle loop should do about a
    /// bootstrap-only block (a saved state whose `tunnelInterfaces` is
    /// empty). A committed session never releases: it stays online through
    /// its tunnel even when the app died. No recorded owner (this daemon
    /// restarted mid-session) never releases either: the owner is unknown,
    /// not gone. Anything unreadable counts as alive, so doubt keeps
    /// protection.
    static func orphanedBootstrapAction(
        stateFilePresent: Bool,
        bootstrapOnly: Bool,
        ownerRecorded: Bool,
        ownerAlive: Bool,
        consecutiveChecks: Int
    ) -> OrphanedBootstrapAction {
        guard stateFilePresent, bootstrapOnly, ownerRecorded, !ownerAlive else {
            return .reset
        }
        return consecutiveChecks >= orphanedBootstrapReleaseThreshold ? .release : .count
    }

    func run() {
        // After listen, before any client. The stale Core is already gone.
        // macOS has no strict kill-switch opt-in, so a helper start with the
        // Core down opens the original network. A Core that is still running
        // keeps the block it already has. DNS restore uses the same
        // SCPreferences path as disconnect and has no extra deadline.
        releaseLeftoverBlockIfCoreStopped()
        recoverDNSAfterStoppedCore()
        var lastProtectionCheck = Date()
        while helperShutdownRequested == 0 {
            // Low-frequency check between requests. Under the update lock
            // like every IPC mutation, so it cannot interleave with an arm
            // or an out-of-process emergency disarm.
            if Date().timeIntervalSince(lastProtectionCheck) >= 10 {
                lastProtectionCheck = Date()
                // BRICK-M11: deleting the app while this daemon stays up used
                // to leave PF in place until the next start. This takes the
                // update lock itself; do not call it from inside locked.
                if releaseIfTonoWasRemoved() { return }
                // Supervise only while the Core is running. While it is down,
                // withhold the bundle permit at once and release the saved
                // block after the watchdog threshold.
                try? updates.storage.locked {
                    observeCoreForWatchdog()
                }
            }
            var descriptor = pollfd(
                fd: serverFD,
                events: Int16(POLLIN),
                revents: 0
            )
            // IPC wakes poll immediately. A one-second timeout exists only to
            // observe the signal flag and avoids four idle helper wakeups/sec.
            let ready = poll(&descriptor, 1, 1_000)
            if ready == 0 { continue }
            if ready < 0 {
                if errno == EINTR { continue }
                usleep(100_000)
                continue
            }
            guard descriptor.revents & Int16(POLLIN) != 0 else { continue }
            let client = accept(serverFD, nil, nil)
            if client < 0 {
                if errno == EINTR { continue }
                usleep(100_000)
                continue
            }
            handle(client)
            close(client)
        }
        // launchd replacement/bootout is a normal lifecycle event. Reap the
        // owned child before this helper exits so the next version never races
        // an orphaned controller or TUN.
        try? core.stop()
    }

    /// Immediate release at start. Idempotent: no state file means no pfctl.
    /// A running Core is not disarmed and is not reinstalled from the file.
    private func releaseLeftoverBlockIfCoreStopped() {
        guard KillSwitchManager.shouldReleaseLeftoverAtLaunch(
            coreRunning: core.status().running,
            stateFilePresent: KillSwitchManager.stateFileExists()
        ) else { return }
        do {
            _ = try killSwitch.disarm()
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            FileHandle.standardError.write(Data(
                "tono: startup release could not clear the kill switch: \(detail)\n".utf8
            ))
            return
        }
        // The general block is already gone. Skip the secondary layer if an
        // arm committed while this release held the lock.
        killSwitch.applySelectiveLayerIfReleased()
    }

    /// While the Core is running, keep the in-session block (a live connect
    /// must not leak). When the Core stays down, release instead of
    /// reinstalling that block. The threshold skips the short gap between
    /// arm and the Core process appearing.
    private func observeCoreForWatchdog() {
        let epoch = killSwitch.openNetworkEpoch
        if epoch != openNetworkEpoch {
            openNetworkEpoch = epoch
            consecutiveCoreDownChecks = 0
        }
        if KillSwitchManager.shouldReinstallKillSwitch(coreRunning: core.status().running) {
            consecutiveCoreDownChecks = 0
            // MAC-ORPHAN-BOOTSTRAP-PF: an app that died between /core/start
            // and the lock arm leaves this branch reinstalling a bootstrap
            // block nobody is left to lift. Check that before supervising.
            if observeOrphanedBootstrap() { return }
            killSwitch.superviseProtection()
            return
        }
        // The Core took its utun with it (#608). Narrow the reviewed-bundle
        // permit immediately. The all-block, if still saved, waits for the
        // threshold below so a connect can start the Core.
        try? killSwitch.withholdReviewedBundlePermit()
        if KillSwitchManager.stateFileExists() {
            consecutiveCoreDownChecks += 1
            // DNS stays put until the block is released. Restoring it during
            // the gap between arm and the Core process would undo a connect.
            guard KillSwitchManager.watchdogShouldRestoreNetwork(
                consecutiveCoreDownChecks: consecutiveCoreDownChecks
            ) else { return }
            do {
                _ = try killSwitch.disarm()
            } catch {
                let detail = (error as? HelperFailure)?.message ?? String(describing: error)
                FileHandle.standardError.write(Data(
                    "tono: watchdog could not clear the kill switch: \(detail)\n".utf8
                ))
                return
            }
            killSwitch.applySelectiveLayerIfReleased()
        } else {
            consecutiveCoreDownChecks = 0
        }
        recoverDNSAfterStoppedCore()
    }

    /// MAC-ORPHAN-BOOTSTRAP-PF: the app armed the bootstrap block (empty
    /// `tunnelInterfaces`), called /core/start, and then died before the arm
    /// that commits the tunnel — with chained residential proxies that window
    /// runs to tens of seconds. The Core is still running, so the branch
    /// above would reinstall that block every 10s and the Mac stays offline
    /// until Tono is relaunched. Returns true once the release has run, so
    /// this pass does not also supervise the block it just lifted.
    private func observeOrphanedBootstrap() -> Bool {
        // A pending native update owns runtime changes and may arm in-process
        // after the old app exited. Leave it to the update's own recovery; an
        // unreadable ledger counts as pending.
        let updatePending: Bool
        if let ledger = try? updates.storage.load() {
            updatePending = ledger.attempt.map { attempt in attempt.receipt.phase != .committed } ?? false
        } else {
            updatePending = true
        }
        if updatePending {
            consecutiveOrphanedOwnerChecks = 0
            return false
        }
        let owner = sessionOwner
        switch Self.orphanedBootstrapAction(
            stateFilePresent: KillSwitchManager.stateFileExists(),
            bootstrapOnly: (try? killSwitch.loadState())?.tunnelInterfaces.isEmpty ?? false,
            ownerRecorded: owner != nil,
            ownerAlive: owner.map { !Self.sessionOwnerHasExited($0) } ?? true,
            consecutiveChecks: consecutiveOrphanedOwnerChecks
        ) {
        case .reset:
            consecutiveOrphanedOwnerChecks = 0
        case .count:
            consecutiveOrphanedOwnerChecks += 1
        case .release:
            releaseOrphanedBootstrap(owner: owner)
            return true
        }
        return false
    }

    /// Fail open exactly as a disconnect would, minus the app: stop the Core
    /// (it holds the TUN and the protected DNS listener), lift PF, then put
    /// the saved resolvers back. Best-effort at every step; with the owner
    /// cleared, later passes supervise or release again as their findings
    /// dictate.
    private func releaseOrphanedBootstrap(owner: SessionOwner?) {
        do {
            try core.stop()
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            FileHandle.standardError.write(Data(
                "tono: orphaned bootstrap core stop failed: \(detail)\n".utf8
            ))
        }
        do {
            try Self.releaseOrphanedBootstrapProtection(
                disarm: { _ = try killSwitch.disarm() },
                applySelectiveLayer: killSwitch.applySelectiveLayerIfReleased
            )
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            FileHandle.standardError.write(Data(
                "tono: orphaned bootstrap release failed: \(detail)\n".utf8
            ))
        }
        recoverDNSAfterStoppedCore()
        clearSessionOwner()
        FileHandle.standardError.write(Data(
            "tono: the app (pid \(owner?.pid ?? 0)) died before committing the tunnel; released its bootstrap kill switch\n".utf8
        ))
    }

    static func releaseOrphanedBootstrapProtection(
        disarm: () throws -> Void,
        applySelectiveLayer: () -> Void
    ) throws {
        try disarm()
        applySelectiveLayer()
    }

    /// A successful arm or start from an authenticated peer makes that peer
    /// the session owner; a later one replaces it. Only the main app passes
    /// the authorizer for these routes, and it is long-lived.
    private func recordSessionOwner(socket: Int32) {
        let pid = Self.peerPID(socket: socket)
        guard pid > 0, let start = Self.processStartTime(pid: pid) else { return }
        sessionOwner = SessionOwner(
            pid: pid,
            startSeconds: start.seconds,
            startMicroseconds: start.microseconds
        )
        consecutiveOrphanedOwnerChecks = 0
    }

    /// The session is over: stop, disarm, or the orphan release above.
    private func clearSessionOwner() {
        sessionOwner = nil
        consecutiveOrphanedOwnerChecks = 0
    }

    /// PID of the process that opened the peer socket, straight from the
    /// kernel; -1 when the option does not answer.
    static func peerPID(socket: Int32) -> pid_t {
        var pid: pid_t = -1
        var length = socklen_t(MemoryLayout<pid_t>.size)
        let outcome = withUnsafeMutablePointer(to: &pid) {
            getsockopt(socket, SOL_LOCAL, LOCAL_PEERPID, $0, &length)
        }
        return outcome == 0 ? pid : -1
    }

    /// Process start time from the kernel, so pid reuse is detectable. nil
    /// when the process cannot be read.
    static func processStartTime(pid: pid_t) -> (seconds: UInt64, microseconds: UInt64)? {
        var info = proc_bsdinfo()
        let size = withUnsafeMutablePointer(to: &info) { pointer in
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, pointer, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        guard size == MemoryLayout<proc_bsdinfo>.size else { return nil }
        return (info.pbi_start_tvsec, info.pbi_start_tvusec)
    }

    /// Whether the recorded owner incarnation is definitely gone: no such
    /// pid, a zombie, or a start time that moved (the kernel reissued the
    /// pid to another process). Anything unreadable counts as alive, so
    /// doubt keeps protection.
    static func sessionOwnerHasExited(_ owner: SessionOwner) -> Bool {
        var info = proc_bsdinfo()
        let size = withUnsafeMutablePointer(to: &info) { pointer in
            proc_pidinfo(owner.pid, PROC_PIDTBSDINFO, 0, pointer, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        if size == MemoryLayout<proc_bsdinfo>.size {
            return info.pbi_status == UInt32(SZOMB)
                || info.pbi_start_tvsec != owner.startSeconds
                || info.pbi_start_tvusec != owner.startMicroseconds
        }
        return kill(owner.pid, 0) == -1 && errno == ESRCH
    }

    private func handle(_ client: Int32) {
        _ = fcntl(client, F_SETFD, FD_CLOEXEC)
        var timeout = timeval(tv_sec: 3, tv_usec: 0)
        _ = withUnsafePointer(to: &timeout) {
            setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }
        _ = withUnsafePointer(to: &timeout) {
            setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }

        guard authorizer.accepts(socket: client) else {
            sendResponse(client, status: 403, object: ["ok": false, "error": "Forbidden."])
            return
        }

        do {
            let request = try readRequest(client)
            try updates.storage.locked {
                // Keep the existing authorizer for ordinary networking. A
                // pending update additionally requires the registered bundle.
                let peer = authorizer.peerIdentity(socket: client)
                if let peer { try updates.gate(method: request.method, path: request.path, peer: peer) }
                else if request.method != "GET" { throw HelperFailure.invalid("Cannot bind helper mutation to a peer bundle.") }
                if request.path.hasPrefix("/update/") {
                    guard let peer else { throw HelperFailure.invalid("Cannot authenticate update peer.") }
                    try handleUpdate(request, peer: peer, client: client)
                } else {
                    try handleRuntime(request, client: client)
                }
            }
        } catch let failure as HelperFailure {
            let status = failure.code == "CORE_ALREADY_RUNNING" ? 409 : 400
            var body: [String: Any] = ["ok": false, "error": failure.message]
            if let code = failure.code { body["code"] = code }
            sendResponse(client, status: status, object: body)
        } catch {
            sendResponse(client, status: 500, object: ["ok": false, "error": "Internal helper error; pending update evidence is retained."])
        }
    }

    private func handleRuntime(_ request: HTTPRequest, client: Int32) throws {
            switch (request.method, request.path) {
            case ("GET", "/version"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: ["ok": true, "version": helperVersion])
            case ("GET", "/core/status"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                let status = core.status()
                var object: [String: Any] = ["ok": true, "running": status.running]
                if let pid = status.pid { object["pid"] = Int(pid) }
                if let lastError = status.lastError {
                    object["lastError"] = String(lastError.prefix(600))
                }
                sendResponse(client, status: 200, object: object)
            case ("POST", "/core/start"):
                let object = try jsonObject(request.body)
                guard object.count == 2,
                      let directory = object["configDir"] as? String,
                      let digest = object["configSHA256"] as? String else {
                    throw HelperFailure.invalid("Invalid start request.")
                }
                try core.start(
                    configDirectory: directory,
                    configSHA256: digest,
                    startAllowed: {
                        transitionGate.isAwake() && killSwitch.status()["live"] as? Bool == true
                    }
                )
                recordSessionOwner(socket: client)
                sendResponse(client, status: 200, object: ["ok": true])
            case ("POST", "/core/sync"):
                let object = try jsonObject(request.body)
                guard object.count == 2,
                      let directory = object["configDir"] as? String,
                      let digest = object["configSHA256"] as? String else {
                    throw HelperFailure.invalid("Invalid sync request.")
                }
                let path = try core.sync(
                    configDirectory: directory,
                    configSHA256: digest,
                    startAllowed: {
                        transitionGate.isAwake() && killSwitch.status()["live"] as? Bool == true
                    },
                    // The old Core's utun goes away with it (#608). A failure
                    // fails the sync with the old Core still running.
                    beforeStop: { try killSwitch.withholdReviewedBundlePermit() }
                )
                sendResponse(client, status: 200, object: ["ok": true, "configPath": path])
            case ("DELETE", "/core/stop"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                // The Core's utun goes away with it (#608). Best effort: the
                // stop must still happen, and the idle loop retries.
                do {
                    try killSwitch.withholdReviewedBundlePermit()
                } catch {
                    let detail = (error as? HelperFailure)?.message ?? String(describing: error)
                    FileHandle.standardError.write(Data("tono: \(detail)\n".utf8))
                }
                try core.stop()
                clearSessionOwner()
                sendResponse(client, status: 200, object: ["ok": true])
            case ("GET", "/killswitch/status"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: killSwitch.status())
            case ("GET", "/killswitch/health"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: killSwitch.health())
            case ("POST", "/killswitch/arm"):
                let object = try jsonObject(request.body)
                try validateKillSwitchArmFields(object)
                let response = try killSwitch.arm(
                    object,
                    commitAllowed: { transitionGate.isAwake() }
                )
                recordSessionOwner(socket: client)
                sendResponse(client, status: 200, object: response)
            case ("POST", "/killswitch/disarm"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                let response = try transitionGate.whileAwake {
                    try killSwitch.disarm()
                }
                clearSessionOwner()
                sendResponse(client, status: 200, object: response)
            case ("GET", "/dns/status"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: protectedDNS.status())
            case ("POST", "/dns/enable"):
                let object = try jsonObject(request.body)
                guard object.count == 1,
                      let service = object["service"] as? String else {
                    throw HelperFailure.invalid("Invalid protected DNS request.")
                }
                sendResponse(
                    client,
                    status: 200,
                    object: try protectedDNS.enable(service: service)
                )
            case ("POST", "/dns/restore"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: try protectedDNS.restore())
            case ("POST", "/helper/upgrade"):
                let object = try jsonObject(request.body)
                guard let helperSrc = object["helperSource"] as? String,
                      let mihomoSrc = object["mihomoSource"] as? String else {
                    throw HelperFailure.invalid("Invalid helper upgrade request.")
                }
                guard let peerBundle = authorizer.peerBundleURL(socket: client) else {
                    throw HelperFailure.invalid("Upgrade requires an authenticated peer bundle.")
                }
                try stageAndUpgrade(
                    helperSource: helperSrc,
                    mihomoSource: mihomoSrc,
                    peerBundlePath: peerBundle.path
                )
                sendResponse(client, status: 200, object: ["ok": true, "restarting": true])
                helperShutdownRequested = 1
            default:
                sendResponse(client, status: 404, object: ["ok": false, "error": "Not found."])
            }
    }

    private func handleUpdate(_ request: HTTPRequest, peer: TonoAuthenticatedPeer, client: Int32) throws {
        if request.method == "POST", request.path == "/update/offer" {
            let object = try jsonObject(request.body)
            guard object.count == 2, let manifest = object["manifest"] as? String,
                  let signature = object["signature"] as? String,
                  let bytes = Data(base64Encoded: manifest), let sig = Data(base64Encoded: signature) else {
                throw HelperFailure.invalid("Invalid detached update offer.")
            }
            sendResponse(client, status: 200, object: ["ok": true,
                "available": try updates.offer(peer: peer, manifest: bytes, signature: sig)])
            return
        }
        if request.method == "POST", request.path == "/update/stage" {
            let object = try jsonObject(request.body)
            guard object.count == 3, let manifest = object["manifest"] as? String,
                  let signature = object["signature"] as? String, let package = object["package"] as? String,
                  let bytes = Data(base64Encoded: manifest), let sig = Data(base64Encoded: signature) else {
                throw HelperFailure.invalid("Invalid update staging request.")
            }
            try updates.stage(peer: peer, manifestBytes: bytes, signature: sig, packagePath: package)
        } else {
            guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected update body.") }
            switch (request.method, request.path) {
            case ("GET", "/update/status"): try updates.resumeConsumedExecutor(peer: peer)
            case ("POST", "/update/prepare"): try updates.prepare(peer: peer)
            case ("POST", "/update/execute"): try transitionGate.whileAwake { try updates.execute(peer: peer) }
            case ("POST", "/update/reconcile"): try updates.reconcile(peer: peer)
            case ("POST", "/update/commit"): try transitionGate.whileAwake { try updates.commit(peer: peer) }
            case ("POST", "/update/cancel"): try updates.cancel(peer: peer)
            case ("POST", "/update/disconnect"): try updates.disconnect(peer: peer)
            case ("POST", "/update/retire"): try transitionGate.whileAwake { try updates.retire(peer: peer) }
            default: throw HelperFailure.invalid("Unknown update operation.")
            }
        }
        sendResponse(client, status: 200, object: try updates.status())
    }

    private func stageAndUpgrade(
        helperSource: String,
        mihomoSource: String,
        peerBundlePath: String
    ) throws {
        let allowedPrefix = peerBundlePath.hasSuffix("/") ? peerBundlePath + "Contents/" : peerBundlePath + "/Contents/"
        guard helperSource.hasPrefix(allowedPrefix),
              mihomoSource.hasPrefix(allowedPrefix),
              !helperSource.contains(".."),
              !mihomoSource.contains("..") else {
            throw HelperFailure.invalid("Upgrade source paths must reside inside the authenticated peer bundle.")
        }

        var resolvedHelper = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard realpath(helperSource, &resolvedHelper) != nil else {
            throw HelperFailure.invalid("Cannot resolve helper source path.")
        }
        let realHelperPath = String(cString: resolvedHelper)
        guard realHelperPath.hasPrefix(allowedPrefix) else {
            throw HelperFailure.invalid("Helper source path escapes authenticated peer bundle.")
        }

        var resolvedMihomo = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard realpath(mihomoSource, &resolvedMihomo) != nil else {
            throw HelperFailure.invalid("Cannot resolve core source path.")
        }
        let realMihomoPath = String(cString: resolvedMihomo)
        guard realMihomoPath.hasPrefix(allowedPrefix) else {
            throw HelperFailure.invalid("Core source path escapes authenticated peer bundle.")
        }

        // The candidates must be the requesting App's own sealed resources,
        // and that App must pass the installer's Developer ID requirement with
        // its nested code and resources intact.
        let bundlePath = String(allowedPrefix.dropLast("/Contents/".count))
        guard realHelperPath == bundlePath + UpdatePackage.helperExecutable,
              realMihomoPath == bundlePath + UpdatePackage.coreExecutable else {
            throw HelperFailure.invalid("Upgrade sources must be the peer bundle's sealed helper and core.")
        }
        _ = try UpdatePackage.verifyCode(bundlePath, identifier: "com.raydocs.tono")

        let helperFD = open(realHelperPath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard helperFD >= 0 else {
            throw HelperFailure.invalid("Cannot safely open helper source.")
        }
        close(helperFD)

        let mihomoFD = open(realMihomoPath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard mihomoFD >= 0 else {
            throw HelperFailure.invalid("Cannot safely open core source.")
        }
        close(mihomoFD)

        try UpdatePackage.verifyCode(realHelperPath, identifier: "com.raydocs.tono.helper")
        try UpdatePackage.verifyCode(realMihomoPath, identifier: "sing-box")

        let helperTemp = "/Library/PrivilegedHelperTools/tono-core-helper.new"
        let mihomoTemp = "/Library/PrivilegedHelperTools/tono-sing-box.new"
        let helperDest = "/Library/PrivilegedHelperTools/tono-core-helper"
        let mihomoDest = "/Library/PrivilegedHelperTools/tono-sing-box"

        unlink(helperTemp)
        unlink(mihomoTemp)

        let p1 = Process()
        p1.executableURL = URL(fileURLWithPath: "/usr/bin/install")
        p1.arguments = ["-o", "root", "-g", "wheel", "-m", "0755", realHelperPath, helperTemp]
        try p1.run()
        p1.waitUntilExit()
        guard p1.terminationStatus == 0 else {
            throw HelperFailure.system("Could not copy helper binary.")
        }

        let p2 = Process()
        p2.executableURL = URL(fileURLWithPath: "/usr/bin/install")
        p2.arguments = ["-o", "root", "-g", "wheel", "-m", "0755", realMihomoPath, mihomoTemp]
        try p2.run()
        p2.waitUntilExit()
        guard p2.terminationStatus == 0 else {
            unlink(helperTemp)
            throw HelperFailure.system("Could not copy core binary.")
        }

        do {
            try UpdatePackage.verifyCode(helperTemp, identifier: "com.raydocs.tono.helper")
            try UpdatePackage.verifyCode(mihomoTemp, identifier: "sing-box")
            // Ask the verified root-owned copy, not the user-writable source,
            // which version it is. A silent upgrade only moves forward; an
            // older or equal build needs the administrator install.
            // Read stdout only: a runtime warning on stderr must not turn a
            // valid version line into an unparsable one.
            let probe = Process()
            probe.executableURL = URL(fileURLWithPath: helperTemp)
            probe.arguments = ["--version"]
            probe.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
            let stdout = Pipe()
            probe.standardOutput = stdout
            probe.standardError = FileHandle.nullDevice
            try probe.run()
            let output = stdout.fileHandleForReading.readDataToEndOfFile()
            probe.waitUntilExit()
            let candidate = String(decoding: output.prefix(64), as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard probe.terminationStatus == 0,
                  helperUpgradeAdmissible(running: helperVersion, candidate: candidate) else {
                throw HelperFailure.invalid("Silent helper upgrade requires a newer helper version.")
            }
        } catch {
            unlink(helperTemp)
            unlink(mihomoTemp)
            throw error
        }

        guard rename(helperTemp, helperDest) == 0 else {
            unlink(helperTemp)
            unlink(mihomoTemp)
            throw HelperFailure.system("Could not replace helper binary.")
        }
        guard rename(mihomoTemp, mihomoDest) == 0 else {
            unlink(mihomoTemp)
            throw HelperFailure.system("Could not replace core binary.")
        }
    }
}

/// The idle loop's verdict on a bootstrap-only block whose recorded owner
/// may be gone.
enum OrphanedBootstrapAction: Equatable {
    /// The conditions do not hold; any count from earlier checks is void.
    case reset
    /// The owner is gone; count this check.
    case count
    /// The owner stayed gone past the threshold; fail open.
    case release
}

/// Silent upgrades never move the root helper backwards. Versions are the
/// three-part numeric `HelperProtocolVersion` strings; anything else fails
/// closed.
func helperUpgradeAdmissible(running: String, candidate: String) -> Bool {
    func parts(_ version: String) -> [Int]? {
        let fields = version.split(separator: ".", omittingEmptySubsequences: false)
        guard fields.count == 3,
              fields.allSatisfy({ !$0.isEmpty && $0.count <= 6 && $0.utf8.allSatisfy { $0 >= 48 && $0 <= 57 } }) else {
            return nil
        }
        return fields.compactMap { Int($0) }
    }
    guard let running = parts(running), let candidate = parts(candidate) else { return false }
    return running.lexicographicallyPrecedes(candidate)
}

func runHelperUpgradeAdmissionSelfTest() -> Bool {
    !helperUpgradeAdmissible(running: "4.6.0", candidate: "4.5.0")
        && !helperUpgradeAdmissible(running: "4.6.0", candidate: "4.6.0")
        && helperUpgradeAdmissible(running: "4.9.0", candidate: "4.10.0")
}
