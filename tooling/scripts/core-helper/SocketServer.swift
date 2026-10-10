import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt
import Security
import SystemConfiguration

func upgradeSourceIsRegular(_ mode: mode_t) -> Bool {
    (mode & S_IFMT) == S_IFREG
}

/// `lstat` rejects a FIFO or symlink before `open`. `O_NONBLOCK` covers the
/// replacement that lands between the two. The fd is the inode that was
/// checked, so a later copy does not reopen the user path.
func openUpgradeSource(_ path: String) throws -> Int32 {
    var metadata = stat()
    guard lstat(path, &metadata) == 0 else {
        throw HelperFailure.invalid("Cannot inspect upgrade source.")
    }
    guard upgradeSourceIsRegular(metadata.st_mode) else {
        throw HelperFailure.invalid("Upgrade source is not a regular file.")
    }
    let fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
    guard fd >= 0 else {
        throw HelperFailure.invalid("Cannot safely open upgrade source.")
    }
    var opened = stat()
    guard fstat(fd, &opened) == 0,
          upgradeSourceIsRegular(opened.st_mode),
          opened.st_dev == metadata.st_dev,
          opened.st_ino == metadata.st_ino else {
        close(fd)
        throw HelperFailure.invalid("Upgrade source changed before it was opened.")
    }
    return fd
}

func copyUpgradeSource(
    from source: Int32,
    to destination: String,
    shouldContinue: () -> Bool
) throws {
    guard shouldContinue() else {
        throw HelperFailure.stopping("Helper is stopping.")
    }
    unlink(destination)
    let output = open(destination, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o755)
    guard output >= 0 else {
        throw HelperFailure.system("Could not create upgrade copy.")
    }
    var committed = false
    defer {
        close(output)
        if !committed { unlink(destination) }
    }
    var buffer = [UInt8](repeating: 0, count: 65_536)
    while true {
        guard shouldContinue() else {
            throw HelperFailure.stopping("Helper is stopping.")
        }
        let count = Darwin.read(source, &buffer, buffer.count)
        if count == 0 { break }
        if count < 0 {
            if errno == EINTR { continue }
            throw HelperFailure.system("Could not read upgrade source.")
        }
        try buffer.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else {
                throw HelperFailure.system("Could not read upgrade source.")
            }
            try writeAll(output, bytes: base, count: count)
        }
    }
    let owner = geteuid()
    guard fchown(output, owner, getegid()) == 0,
          fchmod(output, 0o755) == 0,
          fsync(output) == 0 else {
        throw HelperFailure.system("Could not finish upgrade copy.")
    }
    committed = true
}

/// Copies run outside the update lock. Their paths must belong exclusively to
/// this attempt so cancellation cannot unlink an installer's replacement.
struct SilentUpgradeStaging {
    let directory: String
    var helperPath: String { directory + "/tono-core-helper" }
    var corePath: String { directory + "/tono-sing-box" }

    init(parent: String = "/Library/PrivilegedHelperTools") throws {
        var template = Array((parent + "/tono-upgrade.XXXXXX").utf8CString)
        guard mkdtemp(&template) != nil else {
            throw HelperFailure.system("Could not create private upgrade staging.")
        }
        directory = String(cString: template)
    }

    func remove() {
        unlink(helperPath)
        unlink(corePath)
        rmdir(directory)
    }
}

/// The caller admits the replacement under the durable update lock and keeps
/// that lock until both renames have completed.
func replaceSilentUpgradeCopies(
    staging: SilentUpgradeStaging,
    helperDestination: String = "/Library/PrivilegedHelperTools/tono-core-helper",
    coreDestination: String = "/Library/PrivilegedHelperTools/tono-sing-box",
    commit: (_ replace: () throws -> Void) throws -> Void
) throws {
    try commit {
        guard rename(staging.helperPath, helperDestination) == 0 else {
            throw HelperFailure.system("Could not replace helper binary.")
        }
        guard rename(staging.corePath, coreDestination) == 0 else {
            throw HelperFailure.system("Could not replace core binary.")
        }
    }
}

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
    /// Relaunches of the app issued for the current recorded owner after it
    /// died, and the idle-loop checks since the last one.
    private var orphanedOwnerRelaunchAttempts = 0
    private var checksSinceOrphanedOwnerRelaunch = 0
    /// The exit probe a committed session with a dead owner is waiting on,
    /// and how many in a row have failed.
    private var orphanedTunnelProbe: OrphanedTunnelProbe?
    private var consecutiveOrphanedTunnelFailures = 0

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
    private func recoverDNSAfterStoppedCore(operatorReleased: Bool = false) {
        let snapshotPresent = protectedDNS.status()["snapshotPresent"] as? Bool == true
        guard ProtectedDNSManager.shouldRecoverDNSAtBoot(
            // Under an operator release no session may keep 127.0.0.1, even
            // beside a Core that survived the release.
            coreRunning: operatorReleased ? false : core.status().running,
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

    /// How many times the app is brought back for one dead owner, and how
    /// many idle-loop checks (10s apart) separate two launches. Two: the
    /// first catches a crash, the second a launch that did not come up; an
    /// app that keeps dying is not restarted forever, and the releases
    /// below still end the outage.
    static let orphanedOwnerRelaunchLimit = 2
    static let orphanedOwnerRelaunchSpacing = 3

    /// MAC-ORPHAN-OWNER-RELAUNCH: whether this idle-loop check relaunches the
    /// app. The recorded owner died while PF still holds a block (bootstrap
    /// or committed); the relaunched app finds the armed state and resumes
    /// the route itself, as it does after any crash. No recorded owner is
    /// unknown, not gone; a pending native update launches its own
    /// successor; a sleeping Mac waits.
    static func orphanedOwnerRelaunchDue(
        protectionPresent: Bool,
        ownerRecorded: Bool,
        ownerAlive: Bool,
        awake: Bool,
        updatePending: Bool,
        attempts: Int,
        checksSinceLastAttempt: Int
    ) -> Bool {
        guard protectionPresent, ownerRecorded, !ownerAlive, awake, !updatePending else { return false }
        guard attempts < orphanedOwnerRelaunchLimit else { return false }
        return attempts == 0 || checksSinceLastAttempt >= orphanedOwnerRelaunchSpacing
    }

    /// Failed exit probes, one per idle-loop check (10s apart), counted in a
    /// row before the next failure releases a committed session whose owner
    /// died: the seventh, about 70s after the first probe. A path that blips
    /// recovers inside that, and the Mac is not left without a network for
    /// much longer.
    static let orphanedTunnelReleaseThreshold = 6

    /// What the Core-running branch of the idle loop should do about a
    /// committed session (a saved state with `tunnelInterfaces`) whose
    /// recorded owner died (MAC-ORPHAN-TUNNEL-SESSION, #1269).
    /// `exitReachable` is false only for the Core's own verdict that the
    /// exit failed, and nil while no probe has answered.
    static func orphanedTunnelAction(
        stateFilePresent: Bool,
        committed: Bool,
        ownerRecorded: Bool,
        ownerAlive: Bool,
        uplinkPresent: Bool,
        exitReachable: Bool?,
        consecutiveFailures: Int
    ) -> OrphanedTunnelAction {
        // A live owner runs its own health checks. No recorded owner (this
        // daemon restarted mid-session) is unknown, not gone. Without an
        // uplink no exit can answer, and the session resumes by itself when
        // one returns. Doubt keeps protection.
        guard stateFilePresent, committed, ownerRecorded, !ownerAlive, uplinkPresent else {
            return .reset
        }
        guard let exitReachable else { return .wait }
        if exitReachable { return .reset }
        return consecutiveFailures >= orphanedTunnelReleaseThreshold ? .release : .count
    }

    /// Whether macOS has a primary IPv4 service with a router on an
    /// interface that is not itself a tunnel. The Core's utun is not a
    /// network service, so this is expected to stay the physical uplink
    /// while the tunnel is up. Another VPN as the primary service, or
    /// anything unreadable, counts as absent.
    static func uplinkPresent() -> Bool {
        guard let store = SCDynamicStoreCreate(nil, "Tono orphaned session uplink" as CFString, nil, nil),
              let global = SCDynamicStoreCopyValue(store, "State:/Network/Global/IPv4" as CFString) as? [String: Any],
              global["Router"] is String,
              let interface = global["PrimaryInterface"] as? String else {
            return false
        }
        return !["utun", "ipsec", "ppp"].contains { interface.hasPrefix($0) }
    }

    func run() {
        // After listen, before any client. The stale Core is already gone.
        // macOS has no strict kill-switch opt-in, so a helper start with the
        // Core down opens the original network. A Core that is still running
        // keeps the block it already has. DNS restore uses the same
        // SCPreferences path as disconnect and has no extra deadline.
        releaseLeftoverBlockIfCoreStopped()
        recoverDNSAfterStoppedCore(operatorReleased: !HelperTarget.automaticRearmAllowed(HelperTarget.read()))
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
        // Under an operator release no Core keeps a block (decision 084).
        guard !core.status().running || !HelperTarget.automaticRearmAllowed(HelperTarget.read()) else { return }
        guard KillSwitchManager.stateFileExists() else {
            killSwitch.reconcileSelectiveRecoveryIfReleased()
            return
        }
        do {
            _ = try killSwitch.disarm(preserveAIHold: KillSwitchManager.automaticReleasePreservesAIHold())
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            FileHandle.standardError.write(Data(
                "tono: startup release could not clear the kill switch: \(detail)\n".utf8
            ))
            return
        }
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
        // An operator release (or an unreadable target) keeps the cleanup
        // going but never loads PF, re-arms or relaunches the app; each effect
        // re-reads the target where it acts (decision 084).
        let rearmAllowed = HelperTarget.automaticRearmAllowed(HelperTarget.read())
        let coreRunning = core.status().running
        let stateFilePresent = KillSwitchManager.stateFileExists()
        if rearmAllowed, !coreRunning, stateFilePresent {
            consecutiveCoreDownChecks += 1
        } else {
            consecutiveCoreDownChecks = 0
        }
        // No running Core, no session to probe: an answer from the one that
        // stopped must not count against the next.
        if !(rearmAllowed && coreRunning) { resetOrphanedTunnel() }
        for step in Self.watchdogSteps(
            rearmAllowed: rearmAllowed,
            coreRunning: coreRunning,
            stateFilePresent: stateFilePresent,
            coreDownChecks: consecutiveCoreDownChecks
        ) {
            switch step {
            case .relaunchOwner:
                // The app is the only thing that reconnects or shows the state.
                // Bring it back before deciding anything about its session.
                observeOrphanedOwner()
            case .supervise:
                // MAC-ORPHAN-BOOTSTRAP-PF: an app that died between /core/start
                // and the lock arm leaves this branch reinstalling a bootstrap
                // block nobody is left to lift. Check that before supervising.
                if observeOrphanedBootstrap() { return }
                if observeOrphanedTunnel() { return }
                killSwitch.superviseProtection()
            case .withholdPermit:
                // The Core took its utun with it (#608). Narrow the
                // reviewed-bundle permit immediately.
                try? killSwitch.withholdReviewedBundlePermit()
            case .releaseBlock:
                do {
                    _ = try killSwitch.disarm(preserveAIHold: KillSwitchManager.automaticReleasePreservesAIHold())
                } catch {
                    let detail = (error as? HelperFailure)?.message ?? String(describing: error)
                    FileHandle.standardError.write(Data(
                        "tono: watchdog could not clear the kill switch: \(detail)\n".utf8
                    ))
                    return
                }
            case .reconcileAI:
                killSwitch.reconcileSelectiveRecoveryIfReleased()
            case .recoverDNS:
                recoverDNSAfterStoppedCore(operatorReleased: !rearmAllowed)
            }
        }
    }

    enum WatchdogStep: Equatable {
        case relaunchOwner, supervise, withholdPermit, releaseBlock, reconcileAI, recoverDNS
    }

    /// One idle-loop pass. With the target allowing re-arm: a running Core
    /// keeps its supervised block; a Core down narrows the permit at once and
    /// releases a saved block after the threshold, so a connect can start the
    /// Core; DNS stays put until then. Under an operator release (or an
    /// unreadable target) nothing loads PF: a saved block is released at once,
    /// the AI layer's removal is retried, DNS is restored even beside a Core
    /// that survived.
    static func watchdogSteps(
        rearmAllowed: Bool,
        coreRunning: Bool,
        stateFilePresent: Bool,
        coreDownChecks: Int
    ) -> [WatchdogStep] {
        guard rearmAllowed else {
            return (stateFilePresent ? [.releaseBlock] : []) + [.reconcileAI, .recoverDNS]
        }
        if coreRunning { return [.relaunchOwner, .supervise] }
        var steps: [WatchdogStep] = [.relaunchOwner, .withholdPermit]
        if stateFilePresent {
            guard KillSwitchManager.watchdogShouldRestoreNetwork(consecutiveCoreDownChecks: coreDownChecks) else {
                return steps
            }
            steps.append(.releaseBlock)
        } else {
            steps.append(.reconcileAI)
        }
        return steps + [.recoverDNS]
    }

    /// MAC-ORPHAN-OWNER-RELAUNCH: the app that owns the session died while
    /// PF still holds a block. Launch Services starts the installed app in
    /// the owner's session, as the native update's successor launch does; it
    /// authenticates anew, finds the armed state and resumes the route, so
    /// the menu bar and the reconnect logic are back within seconds instead
    /// of the Mac waiting for the releases below. The launch is a request to
    /// the user's session, not a wait for the app.
    private func observeOrphanedOwner() {
        let owner = sessionOwner
        let ownerAlive = owner.map { !Self.sessionOwnerHasExited($0) } ?? true
        if owner != nil, !ownerAlive, orphanedOwnerRelaunchAttempts > 0 {
            checksSinceOrphanedOwnerRelaunch += 1
        }
        guard Self.orphanedOwnerRelaunchDue(
            protectionPresent: KillSwitchManager.stateFileExists(),
            ownerRecorded: owner != nil,
            ownerAlive: ownerAlive,
            awake: transitionGate.isAwake(),
            updatePending: nativeUpdatePending(),
            attempts: orphanedOwnerRelaunchAttempts,
            checksSinceLastAttempt: checksSinceOrphanedOwnerRelaunch
        ) else { return }
        orphanedOwnerRelaunchAttempts += 1
        checksSinceOrphanedOwnerRelaunch = 0
        do {
            try Self.relaunchInstalledApp(uid: allowedUID)
            FileHandle.standardError.write(Data(
                "tono: the app (pid \(owner?.pid ?? 0)) died with protection held; asked its session to relaunch it (attempt \(orphanedOwnerRelaunchAttempts))\n".utf8
            ))
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            FileHandle.standardError.write(Data(
                "tono: could not relaunch the app after its owner died: \(detail)\n".utf8
            ))
        }
    }

    /// Only the installed, correctly signed bundle is launched, and only as
    /// the allowed user: root asks that user's Launch Services, it does not
    /// run the app. The app must authenticate on helper IPC like any peer.
    /// The request is not awaited: this runs inside the idle loop under the
    /// update lock, and a stuck `open` must not stall IPC or the releases
    /// that follow it. `sudo -n` can never prompt; a non-zero exit is logged
    /// by the termination handler and still counts as an attempt.
    static func relaunchInstalledApp(uid: uid_t) throws {
        _ = try UpdatePackage.verifyCode(UpdatePackage.appPath, identifier: "com.raydocs.tono")
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        child.arguments = ["asuser", String(uid), "/usr/bin/sudo", "-n", "-u", "#\(uid)", "/usr/bin/open", UpdatePackage.appPath]
        child.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": "/var/root"]
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        child.terminationHandler = { process in
            guard process.terminationStatus != 0 else { return }
            FileHandle.standardError.write(Data(
                "tono: the relaunch request exited with status \(process.terminationStatus)\n".utf8
            ))
        }
        try child.run()
    }

    /// MAC-ORPHAN-BOOTSTRAP-PF: the app armed the bootstrap block (empty
    /// `tunnelInterfaces`), called /core/start, and then died before the arm
    /// that commits the tunnel — with chained residential proxies that window
    /// runs to tens of seconds. The Core is still running, so the branch
    /// above would reinstall that block every 10s and the Mac stays offline
    /// until Tono is relaunched. Returns true once the release has run, so
    /// this pass does not also supervise the block it just lifted.
    private func observeOrphanedBootstrap() -> Bool {
        if nativeUpdatePending() {
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
            releaseOrphanedSession(
                owner: owner,
                reason: "died before committing the tunnel; released its bootstrap kill switch"
            )
            return true
        }
        return false
    }

    /// A pending native update owns runtime changes and may arm in-process
    /// after the old app exited. Leave it to the update's own recovery; an
    /// unreadable ledger counts as pending.
    private func nativeUpdatePending() -> Bool {
        guard let ledger = try? updates.storage.load() else { return true }
        return ledger.attempt.map { attempt in attempt.receipt.phase != .committed } ?? false
    }

    /// MAC-ORPHAN-TUNNEL-SESSION (#1269): the app died while connected. The
    /// Core is running, so the branch above keeps the committed block, and
    /// that is right while the exit answers: traffic still flows through
    /// the tunnel. If the exit then stops answering, every packet still goes
    /// to the TUN, PF permits nothing else, and nobody is left to lift it;
    /// the Mac had no network until Tono was opened again. Probe the exit
    /// through the owned Core and release once it has stayed unreachable for
    /// the threshold. The probe never blocks this loop: one check starts it,
    /// a later one reads it. Returns true once the release has run.
    private func observeOrphanedTunnel() -> Bool {
        let owner = sessionOwner
        let stateFilePresent = KillSwitchManager.stateFileExists()
        // A pending native update owns the runtime, as in the bootstrap
        // check above; an unreadable state is not a committed session.
        let committed = !nativeUpdatePending()
            && !((try? killSwitch.loadState())?.tunnelInterfaces.isEmpty ?? true)
        let ownerAlive = owner.map { !Self.sessionOwnerHasExited($0) } ?? true
        let uplinkPresent = transitionGate.isAwake() && Self.uplinkPresent()
        let failures = consecutiveOrphanedTunnelFailures
        let decide = { (exitReachable: Bool?) in
            Self.orphanedTunnelAction(
                stateFilePresent: stateFilePresent,
                committed: committed,
                ownerRecorded: owner != nil,
                ownerAlive: ownerAlive,
                uplinkPresent: uplinkPresent,
                exitReachable: exitReachable,
                consecutiveFailures: failures
            )
        }
        // Only the Core's own "the exit failed" counts. A controller that
        // gave no verdict proves nothing about the exit, so the streak
        // starts over as it does for an exit that answered.
        switch decide(orphanedTunnelProbe?.answer().map { $0 != .unreachable }) {
        case .reset:
            resetOrphanedTunnel()
            // Such an exit is probed again. Anything else that reset (a
            // live or unknown owner, no uplink, asleep, no committed
            // session) asks the Core nothing.
            guard decide(nil) == .wait else { return false }
        case .wait:
            if orphanedTunnelProbe != nil { return false }
        case .count:
            consecutiveOrphanedTunnelFailures += 1
        case .release:
            resetOrphanedTunnel()
            releaseOrphanedSession(
                owner: owner,
                reason: "died and its exit stayed unreachable; released its kill switch"
            )
            return true
        }
        // A runtime config that cannot be read starts no probe, so nothing
        // counts and the block stays. The origin alternates with the streak.
        orphanedTunnelProbe = OrphanedTunnelProbe(origin: consecutiveOrphanedTunnelFailures)
        return false
    }

    private func resetOrphanedTunnel() {
        orphanedTunnelProbe = nil
        consecutiveOrphanedTunnelFailures = 0
    }

    /// Fail open exactly as a disconnect would, minus the app: stop the Core
    /// (it holds the TUN and the protected DNS listener), lift PF, then put
    /// the saved resolvers back. Best-effort at every step; with the owner
    /// cleared, later passes supervise or release again as their findings
    /// dictate.
    private func releaseOrphanedSession(owner: SessionOwner?, reason: String) {
        do {
            try core.stop()
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            FileHandle.standardError.write(Data(
                "tono: orphaned session core stop failed: \(detail)\n".utf8
            ))
        }
        do {
            try Self.releaseOrphanedBootstrapProtection(
                disarm: { _ = try killSwitch.disarm(preserveAIHold: KillSwitchManager.automaticReleasePreservesAIHold()) },
                applySelectiveLayer: {}
            )
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            FileHandle.standardError.write(Data(
                "tono: orphaned session release failed: \(detail)\n".utf8
            ))
        }
        recoverDNSAfterStoppedCore()
        clearSessionOwner()
        FileHandle.standardError.write(Data(
            "tono: the app (pid \(owner?.pid ?? 0)) \(reason)\n".utf8
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
    private func recordSessionOwner(_ peer: SessionOwner?) {
        // Whatever was counted or asked belongs to the previous owner. A
        // peer that could not be read is an unknown owner, not that one.
        clearSessionOwner()
        sessionOwner = peer
    }

    /// Read as soon as the peer is accepted, before the request is read or
    /// served: an app that dies while its start runs is still the owner the
    /// orphan checks look for.
    private func peerOwner(socket: Int32) -> SessionOwner? {
        let pid = Self.peerPID(socket: socket)
        guard pid > 0, let start = Self.processStartTime(pid: pid) else { return nil }
        return SessionOwner(
            pid: pid,
            startSeconds: start.seconds,
            startMicroseconds: start.microseconds
        )
    }

    /// The session is over: stop, disarm, or the orphan release above.
    private func clearSessionOwner() {
        sessionOwner = nil
        consecutiveOrphanedOwnerChecks = 0
        orphanedOwnerRelaunchAttempts = 0
        checksSinceOrphanedOwnerRelaunch = 0
        resetOrphanedTunnel()
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
        let owner = peerOwner(socket: client)

        do {
            let request = try readRequest(client)
            if request.method == "POST", request.path == "/helper/upgrade" {
                // The copy must not hold the update lock. A FIFO used to block
                // inside this lock, so SIGTERM was never observed and
                // `--emergency-disarm` spun until the open returned.
                try handleSilentUpgrade(request, client: client)
            } else {
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
                        try handleRuntime(request, client: client, owner: owner)
                    }
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

    private func handleRuntime(_ request: HTTPRequest, client: Int32, owner: SessionOwner?) throws {
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
            case ("GET", "/session"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: HelperTarget.sessionStatus(HelperTarget.readFile()))
            case ("POST", "/session/connect"):
                // Only the app's explicit user Connect sends this (decision
                // 084): it is what ends an operator release. `expectedGeneration`
                // is what its GET /session read; a newer target wins.
                let object = try jsonObject(request.body)
                guard object.count == 1,
                      let expected = try HelperTarget.sessionGeneration(object["expectedGeneration"]) else {
                    throw HelperFailure.invalid("Invalid session request.")
                }
                let generation = try HelperTarget.beginSession(expected: expected)
                sendResponse(client, status: 200, object: [
                    "ok": true, "sessionGeneration": NSNumber(value: generation),
                ])
            case ("POST", "/core/start"):
                try HelperTarget.requireAdmission(sessionGeneration: nil)
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
                            && HelperTarget.automaticRearmAllowed(HelperTarget.read())
                    }
                )
                recordSessionOwner(owner)
                sendResponse(client, status: 200, object: ["ok": true])
            case ("POST", "/core/sync"):
                try HelperTarget.requireAdmission(sessionGeneration: nil)
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
                            && HelperTarget.automaticRearmAllowed(HelperTarget.read())
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
            case ("GET", "/killswitch/ai-recovery"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: try killSwitch.selectiveAIRecoveryStatus())
            case ("GET", "/killswitch/health"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: killSwitch.health())
            case ("POST", "/killswitch/arm"):
                let object = try jsonObject(request.body)
                try validateKillSwitchArmFields(object)
                let response = try killSwitch.arm(
                    object,
                    sessionGeneration: try HelperTarget.sessionGeneration(object["sessionGeneration"]),
                    commitAllowed: { transitionGate.isAwake() }
                )
                recordSessionOwner(owner)
                sendResponse(client, status: 200, object: response)
            case ("POST", "/killswitch/quit"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                let response = try transitionGate.whileAwake {
                    guard !core.status().running else {
                        throw HelperFailure.invalid("Core must be stopped before Quit release.")
                    }
                    return try killSwitch.releaseForQuit()
                }
                clearSessionOwner()
                sendResponse(client, status: 200, object: response)
            case ("POST", "/killswitch/disarm"), ("POST", "/killswitch/release"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                let response = try transitionGate.whileAwake {
                    try killSwitch.disarm(preserveAIHold: request.path == "/killswitch/release")
                }
                clearSessionOwner()
                sendResponse(client, status: 200, object: response)
            case ("GET", "/dns/status"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: protectedDNS.status())
            case ("POST", "/dns/enable"):
                try HelperTarget.requireAdmission(sessionGeneration: nil)
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
            case ("POST", "/update/release"): try updates.disconnect(peer: peer, preserveAIHold: true)
            case ("POST", "/update/retire"): try transitionGate.whileAwake { try updates.retire(peer: peer) }
            default: throw HelperFailure.invalid("Unknown update operation.")
            }
        }
        sendResponse(client, status: 200, object: try updates.status())
    }

    /// Auth and the pending-update gate take the lock only for the ledger
    /// read. The file copy runs outside it, and the rename takes the lock
    /// again so a shutdown or a new pending update can still win.
    private func handleSilentUpgrade(_ request: HTTPRequest, client: Int32) throws {
        let object = try jsonObject(request.body)
        guard let helperSrc = object["helperSource"] as? String,
              let mihomoSrc = object["mihomoSource"] as? String else {
            throw HelperFailure.invalid("Invalid helper upgrade request.")
        }
        guard let peerBundle = authorizer.peerBundleURL(socket: client) else {
            throw HelperFailure.invalid("Upgrade requires an authenticated peer bundle.")
        }
        try updates.storage.locked {
            guard let peer = authorizer.peerIdentity(socket: client) else {
                throw HelperFailure.invalid("Cannot bind helper mutation to a peer bundle.")
            }
            try updates.gate(method: request.method, path: request.path, peer: peer)
        }
        try stageAndUpgrade(
            helperSource: helperSrc,
            mihomoSource: mihomoSrc,
            peerBundlePath: peerBundle.path
        ) { replace in
            try updates.storage.locked {
                guard helperShutdownRequested == 0 else {
                    throw HelperFailure.stopping("Helper is stopping.")
                }
                guard let peer = authorizer.peerIdentity(socket: client) else {
                    throw HelperFailure.invalid("Cannot bind helper mutation to a peer bundle.")
                }
                try updates.gate(method: request.method, path: request.path, peer: peer)
                try replace()
            }
        }
        sendResponse(client, status: 200, object: ["ok": true, "restarting": true])
        helperShutdownRequested = 1
    }

    private func stageAndUpgrade(
        helperSource: String,
        mihomoSource: String,
        peerBundlePath: String,
        commit: (_ replace: () throws -> Void) throws -> Void
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

        let helperFD = try openUpgradeSource(realHelperPath)
        defer { close(helperFD) }
        let mihomoFD = try openUpgradeSource(realMihomoPath)
        defer { close(mihomoFD) }

        let staging = try SilentUpgradeStaging()
        defer { staging.remove() }
        let helperTemp = staging.helperPath
        let mihomoTemp = staging.corePath

        let continueCopy = { helperShutdownRequested == 0 }
        try copyUpgradeSource(from: helperFD, to: helperTemp, shouldContinue: continueCopy)
        do {
            try copyUpgradeSource(from: mihomoFD, to: mihomoTemp, shouldContinue: continueCopy)
        } catch {
            unlink(helperTemp)
            throw error
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
            guard helperShutdownRequested == 0 else {
                throw HelperFailure.stopping("Helper is stopping.")
            }
            try replaceSilentUpgradeCopies(staging: staging, commit: commit)
        } catch {
            unlink(helperTemp)
            unlink(mihomoTemp)
            throw error
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

/// The idle loop's verdict on a committed session whose recorded owner may be
/// gone.
enum OrphanedTunnelAction: Equatable {
    /// The conditions do not hold; any count from earlier probes is void.
    case reset
    /// No probe has answered since the last check; the count stands.
    case wait
    /// The exit did not answer; count this probe.
    case count
    /// The exit stayed unreachable past the threshold; fail open.
    case release
}

/// One exit probe for an orphaned committed session. It starts on creation
/// and is read by a later idle-loop check, so the loop never waits on it.
final class OrphanedTunnelProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var verdict: ExitDelayVerdict?
    private let session: URLSession

    init?(origin: Int) {
        guard let request = try? UpdateRuntime.exitDelayRequest(origin: origin) else { return nil }
        // Straight to the loopback controller, whatever the system proxy is.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        session = URLSession(configuration: configuration)
        session.dataTask(with: request) { [weak self] data, response, error in
            self?.finish(UpdateRuntime.exitDelayVerdict(data: data, response: response, error: error))
        }.resume()
    }

    deinit { session.invalidateAndCancel() }

    private func finish(_ answered: ExitDelayVerdict) {
        lock.lock()
        verdict = answered
        lock.unlock()
    }

    /// nil until the controller has answered or the request has failed.
    func answer() -> ExitDelayVerdict? {
        lock.lock()
        defer { lock.unlock() }
        return verdict
    }
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
