import Foundation
import Darwin
import SystemConfiguration

// Operator release (`--emergency-disarm`), decision 084.
//
// The helper already has a persisted "what PF should hold" record
// (`killswitch.state`, absent = disconnected) and an in-memory generation
// (`KillSwitchManager.stateGeneration`) that lets a newer protection change
// supersede an arm still in flight. Neither survives a restart as "an
// administrator released this Mac", and the app and the helper are separate
// processes, so the one addition is a persisted target with a monotonic
// generation: `secured <n>` (an explicit user Connect began session n) or
// `released <n>` (an administrator released; nothing automatic may arm).

/// The helper's persisted connection target.
struct HelperTarget: Equatable {
    enum Mode: String {
        case secured
        case released
    }

    var mode: Mode
    var generation: UInt64

    static let path = "/Library/Application Support/Tono/target-state"

    enum Reading: Equatable {
        /// No record: no operator release and no session were ever recorded.
        /// Behavior is the one before decision 084.
        case missing
        case recorded(HelperTarget)
        /// Fails closed for the release: no automatic re-arm, an explicit
        /// error, cleanup continues.
        case unreadable(String)

        var isUnreadable: Bool {
            if case .unreadable = self { return true }
            return false
        }
    }

    /// Set only in the `--emergency-disarm` process, before anything else:
    /// the release intent holds in memory at once, whatever the disk does.
    nonisolated(unsafe) static var processOverride: HelperTarget?

    static func encode(_ target: HelperTarget) -> Data {
        Data("\(target.mode.rawValue) \(target.generation)\n".utf8)
    }

    static func decode(_ data: Data) -> HelperTarget? {
        guard let text = String(data: data, encoding: .utf8), text.hasSuffix("\n") else { return nil }
        let fields = text.dropLast().split(separator: " ", omittingEmptySubsequences: false)
        guard fields.count == 2, let mode = Mode(rawValue: String(fields[0])),
              fields[1].allSatisfy(\.isASCII), fields[1].allSatisfy(\.isNumber),
              let generation = UInt64(fields[1]) else { return nil }
        return HelperTarget(mode: mode, generation: generation)
    }

    /// The target as this process must obey it: the in-memory release first.
    static func read() -> Reading {
        if let processOverride { return .recorded(processOverride) }
        return readFile()
    }

    static func readFile(path: String = HelperTarget.path, requireRootOwnership: Bool = true) -> Reading {
        var metadata = stat()
        guard lstat(path, &metadata) == 0 else {
            let code = errno
            return code == ENOENT ? .missing : .unreadable("the target record cannot be inspected (errno \(code))")
        }
        guard let data = try? KillSwitchManager.secureRead(
            path, maximumBytes: 64, requireRootOwnership: requireRootOwnership
        ) else { return .unreadable("the target record cannot be read") }
        guard let target = decode(data) else { return .unreadable("the target record is not valid") }
        return .recorded(target)
    }

    static func write(_ target: HelperTarget) throws {
        try KillSwitchManager.atomicWrite(path: path, data: encode(target), permissions: 0o600)
    }

    /// Monotonic. An unreadable record restarts from the clock so a new
    /// value is still above any the app could hold.
    static func nextGeneration(after reading: Reading, now: Date) -> UInt64 {
        switch reading {
        case .recorded(let target):
            return target.generation == .max ? 1 : target.generation + 1
        case .missing:
            return 1
        case .unreadable:
            return max(1, UInt64(max(0, now.timeIntervalSince1970) * 1000))
        }
    }

    enum Admission: Equatable {
        case allowed
        case refused(code: String, message: String)
    }

    /// Whether an arm (or a Core start, sync or DNS enable) may proceed.
    /// `sessionGeneration` is what an app arm carries: the generation its
    /// user Connect began. nil (helper-internal arms, an app that has not
    /// begun a session since it launched) is allowed only when no operator
    /// release holds.
    static func admission(_ reading: Reading, sessionGeneration: UInt64?) -> Admission {
        switch reading {
        case .unreadable(let detail):
            return .refused(
                code: "TARGET_STATE_UNREADABLE",
                message: "Tono's helper cannot read its saved connection target (\(detail)), so it does "
                    + "not reconnect on its own. Click Connect in Tono to start a new session."
            )
        case .recorded(let target) where target.mode == .released:
            return .refused(
                code: "OPERATOR_RELEASED",
                message: "An administrator released Tono's network protection. Click Connect in Tono to reconnect."
            )
        case .recorded(let target):
            if let sessionGeneration, sessionGeneration != target.generation {
                return .refused(
                    code: "SESSION_SUPERSEDED",
                    message: "This connection belongs to an earlier Connect and was not applied."
                )
            }
            return .allowed
        case .missing:
            return .allowed
        }
    }

    static func requireAdmission(
        sessionGeneration: UInt64?,
        reading: () -> Reading = { HelperTarget.read() }
    ) throws {
        if case .refused(let code, let message) = admission(reading(), sessionGeneration: sessionGeneration) {
            throw HelperFailure.coded(code: code, message: message)
        }
    }

    /// Helper-internal re-arms (PF supervision, the power barrier, relaunching
    /// a dead owner app) run only when no operator release holds.
    static func automaticRearmAllowed(_ reading: Reading) -> Bool {
        admission(reading, sessionGeneration: nil) == .allowed
    }

    /// The refusal an operator release (or an unreadable target) means right
    /// now, read fresh; nil when protection may still change.
    static func releaseRefusal(reading: () -> Reading = { HelperTarget.read() }) -> HelperFailure? {
        if case .refused(let code, let message) = admission(reading(), sessionGeneration: nil) {
            return .coded(code: code, message: message)
        }
        return nil
    }

    static func requireNoRelease() throws {
        if let failure = releaseRefusal() { throw failure }
    }

    /// The one shape every irreversible protection effect takes (PF load,
    /// 127.0.0.1 DNS write, AI sinkhole or route install, app relaunch): the
    /// target is read right before it and again right after. A release that
    /// landed in between, however long the effect stalled, wins: the effect
    /// is undone and the caller stops with the release's refusal. The read
    /// after runs whether the effect returned or threw (#1504 review F1/F2):
    /// an effect can throw after it committed (PF loaded, then the
    /// verification failed; System Configuration committed, then Apply
    /// failed), and a thrown effect under a release is undone too.
    static func guardedEffect<T>(
        allowed: () -> Bool = { HelperTarget.automaticRearmAllowed(HelperTarget.read()) },
        refusal: () -> HelperFailure? = { HelperTarget.releaseRefusal() },
        _ effect: () throws -> T,
        undo: () -> Void
    ) throws -> T {
        guard allowed() else { throw refusal() ?? releasedFailure }
        let result = Result<T, any Error> { try effect() }
        guard allowed() else {
            undo()
            throw refusal() ?? releasedFailure
        }
        return try result.get()
    }

    /// `guardedEffect` over a sequence of install steps: each runs only while
    /// the target allows it, and a release seen before or after any step
    /// undoes the whole install and stops. False when stopped.
    @discardableResult
    static func stepsUnlessReleased(
        _ steps: [() -> Void],
        allowed: () -> Bool = { HelperTarget.automaticRearmAllowed(HelperTarget.read()) },
        undo: () -> Void
    ) -> Bool {
        for step in steps {
            guard allowed() else {
                undo()
                return false
            }
            step()
        }
        guard allowed() else {
            undo()
            return false
        }
        return true
    }

    static let releasedFailure = HelperFailure.coded(
        code: "OPERATOR_RELEASED",
        message: "An administrator released Tono's network protection. Click Connect in Tono to reconnect."
    )

    /// Where the target lives, behind a seam for the self-tests. Every
    /// read-modify-write of the target holds `lockPath` (bounded), in the
    /// daemon's `/session/connect` and in `--emergency-disarm` alike.
    struct Store {
        var path: String = HelperTarget.path
        var requireRootOwnership = true
        var lockBudget: TimeInterval = 2
        var write: (HelperTarget, String) throws -> Void = { target, path in
            try KillSwitchManager.atomicWrite(path: path, data: HelperTarget.encode(target), permissions: 0o600)
        }
        /// `rename(2)`, behind a seam so the self-test can fail one step of
        /// the repair below.
        var move: (String, String) -> Int32 = { rename($0, $1) }

        var lockPath: String { path + ".lock" }

        func read() -> Reading {
            HelperTarget.readFile(path: path, requireRootOwnership: requireRootOwnership)
        }

        func withLock<T>(_ body: () throws -> T) throws -> T {
            let parent = (path as NSString).deletingLastPathComponent
            if requireRootOwnership {
                try KillSwitchManager.ensureRootDirectory(parent, permissions: 0o700)
            }
            let fd = open(lockPath, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0o600)
            guard fd >= 0 else { throw HelperFailure.system("The target lock cannot be opened (errno \(errno)).") }
            defer { close(fd) }
            var metadata = stat()
            guard fstat(fd, &metadata) == 0, metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                  !requireRootOwnership || (metadata.st_uid == 0 && metadata.st_mode & 0o022 == 0) else {
                throw HelperFailure.system("The target lock is not a private root-owned file.")
            }
            do {
                return try UpdateStorage.withLock(fd, budget: lockBudget, body)
            } catch let failure as HelperFailure where failure.code == "UPDATE_LOCK_TIMEOUT" {
                throw HelperFailure.coded(
                    code: "TARGET_STATE_BUSY",
                    message: "Tono's helper could not get its connection target in time. Click Connect again."
                )
            }
        }

        /// Writes `target` over the record (caller holds the lock). A record
        /// that cannot be read as Tono's (wrong type, owner, mode or content)
        /// is moved aside, never followed or reused, but never before its
        /// replacement exists (#1504 review F3): the replacement is written
        /// (synced) beside it first, so a full or failing disk fails here with
        /// the unreadable record, which refuses every automatic re-arm, still
        /// in place. Only then is the record moved aside and the replacement
        /// renamed in; if that rename fails, the record is moved back. A
        /// missing target would read as "no release ever recorded".
        func commit(_ target: HelperTarget, replacingUnreadable: Bool, now: Date) throws {
            guard replacingUnreadable else {
                try write(target, path)
                return
            }
            let staged = path + ".staged-\(UUID().uuidString)"
            try write(target, staged)
            let aside = path + ".invalid-\(UInt64(max(0, now.timeIntervalSince1970) * 1000))"
            guard move(path, aside) == 0 || errno == ENOENT else {
                let code = errno
                unlink(staged)
                throw HelperFailure.system("The unreadable target record cannot be moved aside (errno \(code)).")
            }
            guard move(staged, path) == 0 else {
                let code = errno
                unlink(staged)
                if move(aside, path) != 0 {
                    // Last resort: an empty record is unreadable too, so the
                    // target keeps refusing rather than reading as missing.
                    let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
                    if fd >= 0 { close(fd) }
                }
                throw HelperFailure.system("The target record could not be replaced (errno \(code)).")
            }
            if requireRootOwnership { try? KillSwitchManager.fsyncParent(path) }
        }
    }

    /// 0 when no generation is on record (no file, or an unreadable one).
    static func currentGeneration(_ reading: Reading) -> UInt64 {
        if case .recorded(let target) = reading { return target.generation }
        return 0
    }

    /// `GET /session`: what an explicit user Connect compares against.
    static func sessionStatus(_ reading: Reading) -> [String: Any] {
        switch reading {
        case .recorded(let target):
            return ["ok": true, "target": target.mode.rawValue, "sessionGeneration": NSNumber(value: target.generation)]
        case .missing:
            return ["ok": true, "target": "missing", "sessionGeneration": NSNumber(value: UInt64(0))]
        case .unreadable(let detail):
            return ["ok": true, "target": "unreadable", "sessionGeneration": NSNumber(value: UInt64(0)), "detail": detail]
        }
    }

    static let supersededConnectMessage = "Tono's connection target changed while connecting (an administrator "
        + "released protection, or another Connect began). Click Connect again."

    /// `/session/connect`: an explicit user Connect, the only way out of an
    /// operator release. Compare-and-swap under the target lock: `expected`
    /// is the generation the app read just before; anything written since (an
    /// operator release above all) wins and this Connect fails. An unreadable
    /// record is moved aside and replaced. A failed write throws a concrete
    /// `TARGET_STATE_UNWRITABLE`; the old target stays.
    static func beginSession(expected: UInt64, store: Store = Store(), now: Date = Date()) throws -> UInt64 {
        do {
            return try store.withLock {
                let reading = store.read()
                guard currentGeneration(reading) == expected else {
                    throw HelperFailure.coded(code: "SESSION_SUPERSEDED", message: supersededConnectMessage)
                }
                let generation = nextGeneration(after: reading, now: now)
                try store.commit(
                    HelperTarget(mode: .secured, generation: generation),
                    replacingUnreadable: reading.isUnreadable, now: now
                )
                return generation
            }
        } catch let failure as HelperFailure where failure.code == "SESSION_SUPERSEDED" || failure.code == "TARGET_STATE_BUSY" {
            throw failure
        } catch {
            let detail = (error as? HelperFailure)?.message ?? String(describing: error)
            throw HelperFailure.coded(
                code: "TARGET_STATE_UNWRITABLE",
                message: "Tono's helper could not save its connection target in /Library/Application Support/Tono "
                    + "(\(detail)). Free some disk space or repair the startup disk, then click Connect again."
            )
        }
    }

    /// The arm field. A JSON integer, never a Boolean or a fraction.
    static func sessionGeneration(_ value: Any?) throws -> UInt64? {
        guard let value else { return nil }
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              let generation = UInt64(exactly: number.doubleValue), number.doubleValue >= 0,
              number.uint64Value == generation else {
            throw HelperFailure.invalid("sessionGeneration must be a non-negative integer.")
        }
        return generation
    }

    /// `--emergency-disarm`: `released <n+1>` under the target lock, so it
    /// always lands above whatever a concurrent Connect read. Runs off the
    /// release's critical path. An unreadable record is moved aside.
    static func persistOperatorRelease(store: Store = Store(), now: Date = Date()) throws -> HelperTarget {
        try store.withLock {
            let reading = store.read()
            let target = HelperTarget(mode: .released, generation: nextGeneration(after: reading, now: now))
            try store.commit(target, replacingUnreadable: reading.isUnreadable, now: now)
            return target
        }
    }
}

// MARK: - Bounded work

/// Work on its own thread that the caller waits for at most a budget. Past
/// it the work is abandoned: never awaited, ended when the process exits.
final class BoundedTask<Value>: @unchecked Sendable {
    private let finished = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var value: Value?

    init(_ body: @escaping () -> Value) {
        let thread = Thread { [self] in
            let result = body()
            lock.lock()
            value = result
            lock.unlock()
            finished.signal()
        }
        thread.start()
    }

    /// The result, or nil when the work did not finish within `seconds`.
    func wait(_ seconds: TimeInterval) -> Value? {
        guard finished.wait(timeout: .now() + max(0, seconds)) == .success else { return nil }
        finished.signal()
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

/// Every phase of `--emergency-disarm` either finishes or is abandoned at
/// its budget, so the command ends by `total` whatever launchctl, the update
/// lock, a child process, System Configuration or the disk does.
struct OperatorRecoveryBudget {
    /// Waited for only before a restart; the write runs beside the stop phase.
    var persist: TimeInterval = 3
    var stop: TimeInterval = 20
    /// The release in four independent steps, each on its own thread with
    /// its own budget, PF first so nothing else can hold the block.
    var pf: TimeInterval = 15
    var dns: TimeInterval = 20
    var ai: TimeInterval = 15
    /// The full release (stale Core, update ledger, the rest of the disarm).
    var release: TimeInterval = 45
    /// Update lock inside the full release; past it update cleanup is skipped.
    var lock: TimeInterval = 5
    /// Each child process the full release starts (TERM, KILL, abandon).
    var child: TimeInterval = 15
    var verify: TimeInterval = 20
    /// Settle: a gap, a second readback; if anything reappeared (a helper or
    /// executor that survived the bootout), the PF / DNS / AI steps once
    /// more and a third readback.
    var settleGap: TimeInterval = 1
    var settleRead: TimeInterval = 4
    var repairPF: TimeInterval = 5
    var repairDNS: TimeInterval = 10
    var repairAI: TimeInterval = 5
    /// The on-disk re-read of the target before a restart.
    var recheck: TimeInterval = 2
    var restart: TimeInterval = 10

    /// Every phase is waited for at most its budget; the restart's launchctl
    /// at most its deadline plus the kill grace.
    var total: TimeInterval {
        persist + stop + pf + dns + ai + release + verify
            + settleGap + settleRead + repairPF + repairDNS + repairAI + settleRead
            + recheck + restart + operatorKillGrace
    }
}

/// `KillSwitchManager.run` waits one second after SIGTERM and one after
/// SIGKILL; this is the margin a launchctl call gets past its deadline.
let operatorKillGrace: TimeInterval = 2.5

// MARK: - Stopping the daemon

/// What `--emergency-disarm` learned when it tried to stop the daemon first.
/// Only launchd's definite "no such service" counts as gone; a launchctl that
/// failed or ran out of time is `unknown`, never `stopped` or `notLoaded`.
enum OperatorDaemonStop: Equatable {
    /// launchd had no such service before any bootout.
    case notLoaded
    /// After this command's bootout, launchd had no such service.
    case stopped
    /// launchd still listed the service when the time ran out.
    case stillLoaded(bootout: Int32?)
    /// launchctl gave no definite answer in time.
    case unknown

    /// `launchctl print`'s exit status for a service launchd does not have.
    static let launchctlNoSuchService: Int32 = 113
}

/// `/bin/launchctl` on its own thread: spawn and wait together end by
/// `deadline + operatorKillGrace`, measured from before the spawn, whatever
/// `posix_spawn` or the child does. Past it the call is abandoned. nil means
/// no answer (could not start, or ran out of time).
func runOperatorLaunchctl(
    _ arguments: [String],
    deadline: TimeInterval,
    runner: @escaping ([String], TimeInterval) -> Int32? = { arguments, deadline in
        (try? KillSwitchManager.run("/bin/launchctl", arguments, deadline: deadline))?.status
    }
) -> Int32? {
    BoundedTask { runner(arguments, deadline) }.wait(deadline + operatorKillGrace) ?? nil
}

/// R3-O4: boot the daemon out of the system domain and wait until launchd no
/// longer has it, so the release below is the only writer. The phase ends by
/// `budget` seconds of wall time, including each call's kill grace.
func stopHelperDaemonForOperator(
    launchctl: @escaping ([String], TimeInterval) -> Int32? = { runOperatorLaunchctl($0, deadline: $1) },
    pause: @escaping () -> Void = { usleep(200_000) },
    now: @escaping () -> Date = { Date() },
    budget: TimeInterval = 20
) -> OperatorDaemonStop {
    let service = "system/\(UpdateExecutor.daemonLabel)"
    let end = now().addingTimeInterval(budget)
    // The deadline left for one launchctl call, keeping its kill grace inside
    // `end`; nil once too little is left to start another.
    func callDeadline(cap: TimeInterval) -> TimeInterval? {
        let left = end.timeIntervalSince(now()) - operatorKillGrace
        return left >= 0.2 ? min(cap, left) : nil
    }
    guard let first = callDeadline(cap: 5) else { return .unknown }
    let before = launchctl(["print", service], first)
    if before == OperatorDaemonStop.launchctlNoSuchService { return .notLoaded }
    // Loaded, or launchd gave no answer: bootout of an absent service only fails.
    guard let bootoutDeadline = callDeadline(cap: 15) else { return .unknown }
    let bootout = launchctl(["bootout", service], bootoutDeadline)
    var lastAnswer: Int32?
    while let deadline = callDeadline(cap: 5) {
        let status = launchctl(["print", service], deadline)
        if status == OperatorDaemonStop.launchctlNoSuchService {
            // Gone after a failed bootout of a service nobody saw loaded:
            // it may never have been there, so this command does not claim it.
            return bootout == 0 || before == 0 ? .stopped : .unknown
        }
        lastAnswer = status
        // A failed bootout gets one look, not the full wait.
        if bootout != 0 { break }
        pause()
    }
    return lastAnswer == 0 ? .stillLoaded(bootout: bootout) : .unknown
}

// MARK: - Readback

/// Per component: `.absent` restored, `.present` Tono's residue is still in
/// place, `.unknown` it could not be read. A failed query is never restored.
struct OperatorRecoveryReading: Equatable {
    var pfBlock: SelectiveFailOpen.LayerReading
    var dns: SelectiveFailOpen.LayerReading
    var aiResolvers: SelectiveFailOpen.LayerReading
    var aiRoutes: SelectiveFailOpen.LayerReading

    static let unknown = OperatorRecoveryReading(
        pfBlock: .unknown, dns: .unknown, aiResolvers: .unknown, aiRoutes: .unknown
    )

    var restored: Bool {
        [pfBlock, dns, aiResolvers, aiRoutes].allSatisfy { $0 == .absent }
    }

    /// Something of Tono's was read in place (not merely unread).
    var residuePresent: Bool {
        [pfBlock, dns, aiResolvers, aiRoutes].contains(.present)
    }

    var lines: [String] {
        func describe(_ reading: SelectiveFailOpen.LayerReading, _ residue: String) -> String {
            switch reading {
            case .absent: return "restored"
            case .present: return "NOT restored (\(residue))"
            case .unknown: return "unknown (could not be read)"
            }
        }
        return [
            "PF broad block: " + describe(pfBlock, "Tono's block is still in effect"),
            "DNS: " + describe(dns, "a service or the active resolver still uses Tono's 127.0.0.1, or a restore is pending"),
            "AI sinkhole resolvers: " + describe(aiResolvers, "a Tono file is still in /etc/resolver"),
            "AI blackhole routes: " + describe(aiRoutes, "a Tono blackhole route is still installed"),
        ]
    }

    static func combine(_ readings: [SelectiveFailOpen.LayerReading]) -> SelectiveFailOpen.LayerReading {
        if readings.contains(.present) { return .present }
        if readings.contains(.unknown) { return .unknown }
        return .absent
    }

    /// Tono's broad block lives in its child anchor. Restored when that anchor
    /// holds no block, or PF is disabled, or the main ruleset no longer hooks
    /// the anchor; every one of those must be an answer, not a failure.
    static func pfBlockReading(query: ([String]) -> HelperCommandResult?) -> SelectiveFailOpen.LayerReading {
        guard let child = query(["-a", killSwitchAnchor, "-sr"]), child.status == 0 else { return .unknown }
        guard String(decoding: child.output, as: UTF8.self).lowercased().contains("block drop out quick all") else {
            return .absent
        }
        guard let info = query(["-s", "info"]), info.status == 0,
              let main = query(["-sr"]), main.status == 0 else { return .unknown }
        let status = String(decoding: info.output, as: UTF8.self).lowercased()
        let enabled: Bool
        if status.contains("status: enabled") { enabled = true }
        else if status.contains("status: disabled") { enabled = false }
        else { return .unknown }
        let hooked = String(decoding: main.output, as: UTF8.self).contains("anchor \"\(killSwitchAnchor)\"")
        return enabled && hooked ? .present : .absent
    }

    static func aiRoutesReading(
        readback: ([String]) -> (status: Int32, output: String)?
    ) -> SelectiveFailOpen.LayerReading {
        combine(SelectiveFailOpen.routeGetArguments().map { args in
            guard let prefix = args.last, let answer = readback(args) else { return .unknown }
            return SelectiveFailOpen.routeLayerReading(status: answer.status, output: answer.output, prefix: prefix)
        })
    }

    static func aiResolversReading(
        read: (String) -> SelectiveFailOpen.LayerReading = { SelectiveFailOpenInstaller.resolverLayerReading(at: $0) }
    ) -> SelectiveFailOpen.LayerReading {
        combine(SelectiveFailOpen.suffixes.compactMap { SelectiveFailOpen.resolverPath(for: $0) }.map(read))
    }

    /// The live system, each query bounded (pfctl and route 3 s).
    static func readSystem() -> OperatorRecoveryReading {
        let pf = pfBlockReading { arguments in
            try? KillSwitchManager.run("/sbin/pfctl", arguments, deadline: 3)
        }
        let dns = (try? ProtectedDNSManager())?.operatorResidueReading() ?? .unknown
        let resolvers = aiResolversReading()
        let routes = aiRoutesReading { args in
            guard let executable = args.first, SelectiveFailOpen.commandIsPrefixOnly(args),
                  let result = try? KillSwitchManager.run(executable, Array(args.dropFirst()), deadline: 3)
            else { return nil }
            return (result.status, String(decoding: result.output.prefix(16 * 1024), as: UTF8.self))
        }
        return OperatorRecoveryReading(pfBlock: pf, dns: dns, aiResolvers: resolvers, aiRoutes: routes)
    }
}

// MARK: - The command

/// The release's independent steps (decision 084). The PF step is
/// emergency-only, idempotent and scoped to Tono's own anchor: it never
/// flushes or reloads the main ruleset, and it needs neither System
/// Configuration, the update store nor the disk, so nothing that can stall
/// there keeps the broad block.
enum OperatorReleaseSteps {
    static func flushTonoAnchor(
        run: ([String]) -> HelperCommandResult? = { try? KillSwitchManager.run("/sbin/pfctl", $0, deadline: 10) }
    ) -> Bool {
        guard let flushed = run(["-a", killSwitchAnchor, "-F", "all"]) else { return false }
        return flushed.status == 0
    }

    static func restoreDNS() -> Bool {
        do {
            _ = try ProtectedDNSManager().restore(deferringLossNotice: true)
            return true
        } catch {
            fputs("Tono emergency recovery could not restore DNS in its first pass: \(error)\n", stderr)
            return false
        }
    }

    static func removeAILayer() -> Bool {
        KillSwitchManager.reconcileSelectiveRecoveryUnderTarget(
            rearmAllowed: false, generalIntentPresent: false, disposition: nil, removalPending: true
        )
    }
}

struct OperatorRecoveryResult {
    var stop: OperatorDaemonStop
    /// Each nil: the step did not finish within its budget.
    var pfFlushed: Bool?
    var dnsRestored: Bool?
    var aiRemoved: Bool?
    var release: EmergencyReleaseOutcome?
    /// The first readback, right after the release.
    var firstReading: OperatorRecoveryReading
    /// The settled readback every claim is made on.
    var reading: OperatorRecoveryReading
    /// The PF / DNS / AI steps ran a second time because residue reappeared
    /// (or stayed) after the settle gap.
    var reapplied: Bool
    /// nil when the write did not finish within its budget.
    var persisted: Result<HelperTarget, Error>?
    /// The on-disk target re-read after a successful write; nil when not
    /// read, `.some(nil)` when the read did not finish in time.
    var recheck: HelperTarget.Reading??
    /// nil when no restart was attempted; otherwise launchctl's answer.
    var restart: Int32??
    var elapsed: TimeInterval

    var persistedTarget: HelperTarget? {
        if case .success(let target)? = persisted { return target }
        return nil
    }

    /// `released` with this command's generation is what is on disk now.
    var targetConfirmed: Bool {
        guard let persistedTarget, case .some(.some(.recorded(let onDisk))) = recheck else { return false }
        return onDisk == persistedTarget
    }

    /// Success is claimed only when the release finished, every component
    /// reads back restored, and this command's `released` is on disk.
    var succeeded: Bool {
        release == .released && reading.restored && targetConfirmed
    }
}

/// The ordered `--emergency-disarm`: (1) release intent in memory, its write
/// started beside everything else; (2) bounded bootout; (3) the release in
/// independent bounded steps, PF first, then DNS, the AI layer, and the full
/// release; (4) bounded readback; (5) a bounded re-read of the target, and a
/// restart only when this command's `released` is what is on disk, so the
/// daemon comes back refusing every arm but keeps cleaning up. Anything else
/// leaves the daemon stopped: nothing can re-arm unaware of the release.
func runOperatorEmergencyDisarm(
    budget: OperatorRecoveryBudget = OperatorRecoveryBudget(),
    latch: () -> Void = { HelperTarget.processOverride = HelperTarget(mode: .released, generation: 0) },
    persist: @escaping () throws -> HelperTarget = { try HelperTarget.persistOperatorRelease() },
    stopDaemon: (TimeInterval) -> OperatorDaemonStop = { stopHelperDaemonForOperator(budget: $0) },
    flushPF: @escaping () -> Bool = { OperatorReleaseSteps.flushTonoAnchor() },
    restoreDNS: @escaping () -> Bool = { OperatorReleaseSteps.restoreDNS() },
    removeAI: @escaping () -> Bool = { OperatorReleaseSteps.removeAILayer() },
    release: @escaping () -> EmergencyReleaseOutcome,
    verify: @escaping () -> OperatorRecoveryReading = { OperatorRecoveryReading.readSystem() },
    pause: (TimeInterval) -> Void = { usleep(useconds_t(max(0, $0) * 1_000_000)) },
    readTarget: @escaping () -> HelperTarget.Reading = { HelperTarget.readFile() },
    restartDaemon: (TimeInterval) -> Int32? = {
        runOperatorLaunchctl(["bootstrap", "system", UpdateExecutor.daemonPlist], deadline: $0)
    }
) -> OperatorRecoveryResult {
    let started = Date()
    latch()
    let persistence = BoundedTask { () -> Result<HelperTarget, Error> in Result { try persist() } }
    let stop = stopDaemon(budget.stop)
    let pf = BoundedTask(flushPF).wait(budget.pf)
    let dns = BoundedTask(restoreDNS).wait(budget.dns)
    let ai = BoundedTask(removeAI).wait(budget.ai)
    let outcome = BoundedTask(release).wait(budget.release)
    let first = BoundedTask(verify).wait(budget.verify) ?? .unknown
    // Settle (decision 084): a helper or update executor that survived the
    // bootout may have reinstalled something after the first readback.
    pause(budget.settleGap)
    var reading = BoundedTask(verify).wait(budget.settleRead) ?? .unknown
    var reapplied = false
    if first.residuePresent || reading.residuePresent {
        reapplied = true
        if reading.pfBlock != .absent { _ = BoundedTask(flushPF).wait(budget.repairPF) }
        if reading.dns != .absent { _ = BoundedTask(restoreDNS).wait(budget.repairDNS) }
        if reading.aiResolvers != .absent || reading.aiRoutes != .absent {
            _ = BoundedTask(removeAI).wait(budget.repairAI)
        }
        reading = BoundedTask(verify).wait(budget.settleRead) ?? .unknown
    }
    let persisted = persistence.wait(budget.persist)
    var result = OperatorRecoveryResult(
        stop: stop, pfFlushed: pf, dnsRestored: dns, aiRemoved: ai, release: outcome,
        firstReading: first, reading: reading, reapplied: reapplied,
        persisted: persisted, recheck: nil, restart: nil, elapsed: 0
    )
    if result.persistedTarget != nil {
        result.recheck = .some(BoundedTask(readTarget).wait(budget.recheck))
        if result.targetConfirmed, stop != .notLoaded {
            result.restart = .some(restartDaemon(budget.restart))
        }
    }
    result.elapsed = Date().timeIntervalSince(started)
    return result
}

/// The CLI entry: bounds every child and the update lock in this process,
/// runs the release, and reports. Exit status 0 only when `succeeded`.
func runOperatorEmergencyDisarmCommand(budget: OperatorRecoveryBudget = OperatorRecoveryBudget()) -> Bool {
    guard geteuid() == 0 else {
        fputs("Tono emergency recovery must be run with sudo.\n", stderr)
        return false
    }
    UpdatePackage.operatorChildDeadline = budget.child
    let result = runOperatorEmergencyDisarm(
        budget: budget,
        release: { emergencyRelease(lockBudget: budget.lock) }
    )
    for line in operatorRecoveryReport(result) { print(line) }
    return result.succeeded
}

private let unsavedReleaseAdvice = "This command did not start Tono's helper again, so a restarted helper "
    + "cannot re-arm unaware of the release; a helper this command could not stop does not know about it. "
    + "Click Connect in Tono to reconnect (it asks to start the helper again)."

func operatorRecoveryReport(_ result: OperatorRecoveryResult) -> [String] {
    func step(_ name: String, _ done: Bool?) -> String {
        switch done {
        case true?: return "\(name): done."
        case false?: return "\(name): FAILED."
        case nil: return "\(name): did not finish within its time budget."
        }
    }
    var lines: [String] = []
    switch result.stop {
    case .notLoaded:
        lines.append("Helper daemon: was not running.")
    case .stopped:
        lines.append("Helper daemon: stopped before the release, so nothing else changed PF or DNS during it.")
    case .stillLoaded(let bootout):
        let answer = bootout.map { "exit \($0)" } ?? "no answer"
        lines.append("Helper daemon: still registered after launchctl bootout (\(answer)); it may have run beside the release.")
    case .unknown:
        lines.append("Helper daemon: launchctl gave no definite answer; it may have run beside the release.")
    }
    lines.append(step("PF block flush (Tono's anchor only)", result.pfFlushed))
    lines.append(step("DNS restore", result.dnsRestored))
    lines.append(step("AI layer removal", result.aiRemoved))
    switch result.release {
    case nil: lines.append("Full release: did not finish within its time budget.")
    case .refused?: lines.append("Full release: PF could not be released.")
    case .dnsRestoreFailed?: lines.append("Full release: PF released; DNS restore failed.")
    case .coreStillRunning?: lines.append("Full release: PF and DNS released; a Tono Core process survived SIGKILL.")
    case .released?: lines.append("Full release: finished.")
    }
    if result.reapplied {
        lines.append("Settle: residue was found after the release; PF / DNS / AI cleanup ran once more. Final readback:")
    }
    lines += result.reading.lines
    switch result.persisted {
    case .success(let target)?:
        if result.targetConfirmed {
            lines.append("Saved target: released by an administrator (generation \(target.generation)). "
                + "Tono will not reconnect on its own; click Connect in Tono to reconnect.")
        } else {
            lines.append("ERROR: the saved release (generation \(target.generation)) is no longer what is on disk "
                + "(a Connect replaced it, or it could not be read back in time). " + unsavedReleaseAdvice)
        }
    case .failure(let error)?:
        lines.append("ERROR: the release could not be saved (\(error)). " + unsavedReleaseAdvice)
    case nil:
        lines.append("ERROR: the release could not be saved within its time budget. " + unsavedReleaseAdvice)
    }
    switch result.restart {
    case .some(.some(0)):
        lines.append("Helper daemon: started again in released mode; it keeps cleaning up and refuses every reconnect until you click Connect.")
    case .some(let status):
        lines.append("Helper daemon: launchctl bootstrap gave \(status.map { "exit \($0)" } ?? "no answer").")
    case .none:
        break
    }
    if result.succeeded {
        lines.append("Tono network protection is released and the network is restored.")
    } else {
        let cleanup = result.restart == .some(.some(0))
            ? "The helper keeps retrying the cleanup."
            : "Nothing is retrying the cleanup; run this command again or restart the Mac."
        lines.append("NOT fully restored. \(cleanup)")
    }
    return lines
}

// MARK: - Self-tests

func runOperatorReleaseSelfTests() -> Bool {
    func fail(_ label: String, _ detail: Any = "") -> Bool {
        FileHandle.standardError.write(Data("operator release \(label): \(detail)\n".utf8))
        return false
    }
    enum Injected: Error { case failure }
    let now = Date(timeIntervalSince1970: 1_000)
    func elapsed(since start: Date) -> TimeInterval { Date().timeIntervalSince(start) }

    // Target record: format, missing, unreadable.
    guard HelperTarget.decode(HelperTarget.encode(HelperTarget(mode: .released, generation: 42)))
            == HelperTarget(mode: .released, generation: 42),
          HelperTarget.decode(Data("released 4x\n".utf8)) == nil,
          HelperTarget.decode(Data("armed 4\n".utf8)) == nil,
          HelperTarget.decode(Data("secured 4".utf8)) == nil else { return fail("record format") }
    let directory = NSTemporaryDirectory() + "tono-target-\(UUID().uuidString)"
    guard mkdir(directory, 0o700) == 0 else { return fail("temporary directory") }
    defer { try? FileManager.default.removeItem(atPath: directory) }
    var store = HelperTarget.Store()
    store.path = directory + "/target"
    store.requireRootOwnership = false
    store.lockBudget = 0.3
    store.write = { target, path in
        try HelperTarget.encode(target).write(to: URL(fileURLWithPath: path), options: .atomic)
    }
    func put(_ text: String) -> Bool {
        FileManager.default.createFile(atPath: store.path, contents: Data(text.utf8))
    }
    guard store.read() == .missing, put("garbage"), case .unreadable = store.read() else {
        return fail("missing or unreadable record")
    }

    let later = Date(timeIntervalSince1970: 2_000)
    // A user Connect repairs an unreadable record (bad content, or a
    // directory in its place): moved aside, a fresh `secured` written.
    guard (try? HelperTarget.beginSession(expected: 0, store: store, now: now)) == 1_000_000,
          store.read() == .recorded(HelperTarget(mode: .secured, generation: 1_000_000)),
          unlink(store.path) == 0, mkdir(store.path, 0o700) == 0,
          (try? HelperTarget.beginSession(expected: 0, store: store, now: later)) == 2_000_000,
          store.read() == .recorded(HelperTarget(mode: .secured, generation: 2_000_000)) else {
        return fail("repair by Connect", store.read())
    }
    // A genuinely unwritable target is a concrete error, never swallowed.
    var unwritable = store
    unwritable.write = { _, _ in throw Injected.failure }
    var unwritableCode: String?
    do { _ = try HelperTarget.beginSession(expected: 2_000_000, store: unwritable, now: now) }
    catch let failure as HelperFailure { unwritableCode = failure.code } catch {}
    guard unwritableCode == "TARGET_STATE_UNWRITABLE",
          store.read() == .recorded(HelperTarget(mode: .secured, generation: 2_000_000)) else {
        return fail("unwritable target", unwritableCode ?? "none")
    }

    // Concurrent Connect vs operator release: the Connect read generation 6,
    // the release lands (7) before its write: the release wins.
    guard put("secured 6\n"), HelperTarget.currentGeneration(store.read()) == 6,
          let released = try? HelperTarget.persistOperatorRelease(store: store, now: now),
          released == HelperTarget(mode: .released, generation: 7) else { return fail("operator release write") }
    var staleCode: String?
    do { _ = try HelperTarget.beginSession(expected: 6, store: store, now: now) }
    catch let failure as HelperFailure { staleCode = failure.code } catch {}
    guard staleCode == "SESSION_SUPERSEDED", store.read() == .recorded(released) else {
        return fail("released must win", staleCode ?? "applied")
    }
    // A busy target lock is bounded too.
    let holder = open(store.lockPath, O_RDWR | O_CLOEXEC)
    defer { if holder >= 0 { close(holder) } }
    guard holder >= 0, flock(holder, LOCK_EX | LOCK_NB) == 0 else { return fail("target lock setup") }
    let busyStart = Date()
    var busyCode: String?
    do { _ = try HelperTarget.beginSession(expected: 7, store: store, now: now) }
    catch let failure as HelperFailure { busyCode = failure.code } catch {}
    guard busyCode == "TARGET_STATE_BUSY", elapsed(since: busyStart) < 1.5,
          (try? HelperTarget.persistOperatorRelease(store: store, now: now)) == nil else {
        return fail("busy target lock", busyCode ?? "acquired")
    }
    flock(holder, LOCK_UN)

    // Latch semantics: the release refuses the old generation, a heal or an
    // automatic reconnect (no generation), and so does an unreadable record.
    let disk = store.read()
    guard case .refused(let releasedCode, _) = HelperTarget.admission(disk, sessionGeneration: 6),
          releasedCode == "OPERATOR_RELEASED",
          case .refused = HelperTarget.admission(disk, sessionGeneration: nil),
          case .refused = HelperTarget.admission(disk, sessionGeneration: 7),
          !HelperTarget.automaticRearmAllowed(disk),
          case .refused(let unreadableCode, _) = HelperTarget.admission(.unreadable("x"), sessionGeneration: nil),
          unreadableCode == "TARGET_STATE_UNREADABLE",
          !HelperTarget.automaticRearmAllowed(.unreadable("x")) else {
        return fail("operator release refusals", disk)
    }
    // A Connect that read the release begins generation 8: its arms pass,
    // then a heal or automatic reconnect of the same session; 6 and 7 never.
    guard let connected = try? HelperTarget.beginSession(expected: 7, store: store, now: now),
          connected == 8,
          HelperTarget.admission(store.read(), sessionGeneration: 8) == .allowed,
          HelperTarget.admission(store.read(), sessionGeneration: nil) == .allowed,
          case .refused(let supersededCode, _) = HelperTarget.admission(store.read(), sessionGeneration: 6),
          supersededCode == "SESSION_SUPERSEDED",
          case .refused = HelperTarget.admission(store.read(), sessionGeneration: 7),
          HelperTarget.admission(.missing, sessionGeneration: nil) == .allowed else {
        return fail("user Connect", store.read())
    }
    guard (try? HelperTarget.sessionGeneration(NSNumber(value: 8))) == .some(8),
          (try? HelperTarget.sessionGeneration(kCFBooleanTrue)) == nil,
          (try? HelperTarget.sessionGeneration(NSNumber(value: 1.5))) == nil,
          (try? HelperTarget.sessionGeneration(NSNumber(value: -1))) == nil else {
        return fail("sessionGeneration field")
    }

    // Watchdog under a release: nothing loads PF (no supervision, no permit
    // withhold, no owner relaunch); a saved block goes at once.
    guard SocketServer.watchdogSteps(rearmAllowed: false, coreRunning: true, stateFilePresent: true, coreDownChecks: 0)
            == [.releaseBlock, .reconcileAI, .recoverDNS],
          SocketServer.watchdogSteps(rearmAllowed: false, coreRunning: false, stateFilePresent: false, coreDownChecks: 0)
            == [.reconcileAI, .recoverDNS],
          SocketServer.watchdogSteps(rearmAllowed: true, coreRunning: true, stateFilePresent: true, coreDownChecks: 0)
            == [.relaunchOwner, .supervise],
          SocketServer.watchdogSteps(rearmAllowed: true, coreRunning: false, stateFilePresent: true, coreDownChecks: 1)
            == [.relaunchOwner, .withholdPermit] else {
        return fail("watchdog plan")
    }

    // AI hold after a restart under the release: a saved "retain" never
    // reinstalls it; its removal is retried until the system reads it gone.
    var applied = 0
    var removals = 0
    var present = true
    let removedNow = KillSwitchManager.reconcileSelectiveRecoveryUnderTarget(
        rearmAllowed: false, generalIntentPresent: false, disposition: true, removalPending: false,
        layerProvenAbsent: { !present }, markReleasing: {},
        applySelectiveLayer: { applied += 1 },
        removeSelectiveLayer: { removals += 1; return false },
        completeRemoval: {}
    )
    let removedLater = KillSwitchManager.reconcileSelectiveRecoveryUnderTarget(
        rearmAllowed: false, generalIntentPresent: false, disposition: true, removalPending: false,
        layerProvenAbsent: { !present }, markReleasing: {},
        applySelectiveLayer: { applied += 1 },
        removeSelectiveLayer: { removals += 1; present = false; return true },
        completeRemoval: {}
    )
    guard !removedNow, removedLater, applied == 0, removals == 2 else {
        return fail("AI hold under release", "\(applied) \(removals)")
    }

    // Per-component readback: a failed query is unknown, never restored.
    func pf(_ child: HelperCommandResult?, info: HelperCommandResult?, main: HelperCommandResult?)
        -> SelectiveFailOpen.LayerReading {
        OperatorRecoveryReading.pfBlockReading { arguments in
            if arguments.first == "-a" { return child }
            return arguments == ["-s", "info"] ? info : main
        }
    }
    func answer(_ text: String, _ status: Int32 = 0) -> HelperCommandResult {
        HelperCommandResult(status: status, output: Data(text.utf8))
    }
    let block = answer("block drop out quick all\n")
    let hooked = answer("anchor \"\(killSwitchAnchor)\" all\n")
    guard pf(nil, info: nil, main: nil) == .unknown,
          pf(answer("", 1), info: nil, main: nil) == .unknown,
          pf(answer("pass out quick all\n"), info: nil, main: nil) == .absent,
          pf(block, info: answer("Status: Enabled for 0 days"), main: hooked) == .present,
          pf(block, info: answer("Status: Disabled"), main: hooked) == .absent,
          pf(block, info: nil, main: hooked) == .unknown,
          pf(block, info: answer("Status: Enabled"), main: answer("", 1)) == .unknown,
          OperatorRecoveryReading.aiRoutesReading(readback: { _ in nil }) == .unknown,
          OperatorRecoveryReading.aiResolversReading(read: { _ in .absent }) == .absent,
          OperatorRecoveryReading.aiResolversReading(read: { _ in .unknown }) == .unknown,
          OperatorRecoveryReading.combine([.absent, .unknown, .present]) == .present,
          !OperatorRecoveryReading(pfBlock: .absent, dns: .unknown, aiResolvers: .absent, aiRoutes: .absent).restored,
          OperatorReleaseSteps.flushTonoAnchor(run: { $0 == ["-a", killSwitchAnchor, "-F", "all"] ? answer("") : nil }),
          !OperatorReleaseSteps.flushTonoAnchor(run: { _ in nil })
    else { return fail("per-component readback") }

    // Order: release intent in memory before the bootout, the bootout before
    // the release, PF before DNS before the AI layer before the full release,
    // and a restart only once this command's `released` reads back.
    var events: [String] = []
    let eventLock = NSLock()
    func record(_ event: String) {
        eventLock.lock()
        events.append(event)
        eventLock.unlock()
    }
    let clean = OperatorRecoveryReading(pfBlock: .absent, dns: .absent, aiResolvers: .absent, aiRoutes: .absent)
    let saved = HelperTarget(mode: .released, generation: 9)
    let ordered = runOperatorEmergencyDisarm(
        latch: { record("latch") },
        persist: { saved },
        stopDaemon: { _ in record("stop"); return .stopped },
        flushPF: { record("pf"); return true },
        restoreDNS: { record("dns"); return true },
        removeAI: { record("ai"); return true },
        release: { record("release"); return .released },
        verify: { record("verify"); return clean },
        pause: { _ in },
        readTarget: { record("recheck"); return .recorded(saved) },
        restartDaemon: { _ in record("restart"); return 0 }
    )
    guard ordered.succeeded,
          events == ["latch", "stop", "pf", "dns", "ai", "release", "verify", "verify", "recheck", "restart"] else {
        return fail("order", events)
    }

    // Stalled System Configuration and update store: PF is still flushed
    // first, and the command ends within its budget.
    var tight = OperatorRecoveryBudget()
    tight.persist = 0.2
    tight.stop = 0.2
    tight.pf = 0.3
    tight.dns = 0.3
    tight.ai = 0.3
    tight.release = 0.3
    tight.verify = 0.3
    tight.settleGap = 0.1
    tight.settleRead = 0.3
    tight.repairPF = 0.2
    tight.repairDNS = 0.2
    tight.repairAI = 0.2
    tight.recheck = 0.2
    tight.restart = 0.2
    events = []
    let stalledStart = Date()
    let stalled = runOperatorEmergencyDisarm(
        budget: tight,
        latch: {},
        persist: { saved },
        stopDaemon: { _ in .stopped },
        flushPF: { record("pf"); return true },
        restoreDNS: { sleep(30); return true },
        removeAI: { true },
        release: { sleep(30); return .released },
        verify: { clean },
        pause: { _ in },
        readTarget: { .recorded(saved) },
        restartDaemon: { _ in 0 }
    )
    guard stalled.pfFlushed == true, stalled.dnsRestored == nil, stalled.release == nil, events == ["pf"],
          !stalled.succeeded, elapsed(since: stalledStart) < tight.total + 0.5 else {
        return fail("stalled DNS and update store", "\(events) \(elapsed(since: stalledStart))")
    }

    // Interleaving (decision 084): an effect admitted before the release
    // stalls until after it, then resumes. The post-effect read sees the
    // release, undoes the effect, and the caller stops with the refusal; an
    // effect not yet started never runs.
    var allowedNow = true
    var effects = 0
    var undone = 0
    var interleavedCode: String?
    do {
        try HelperTarget.guardedEffect(allowed: { allowedNow }, refusal: { nil }, {
            effects += 1
            allowedNow = false // the CLI released while this PF load / DNS write stalled
        }, undo: { undone += 1 })
    } catch let failure as HelperFailure { interleavedCode = failure.code } catch {}
    do {
        try HelperTarget.guardedEffect(allowed: { allowedNow }, refusal: { nil }, { effects += 1 }, undo: { undone += 1 })
    } catch {}
    guard interleavedCode == "OPERATOR_RELEASED", effects == 1, undone == 1 else {
        return fail("interleaved effect", "\(interleavedCode ?? "none") \(effects) \(undone)")
    }
    // An AI install paused between entries: what went in comes out, the rest
    // never goes in.
    allowedNow = true
    var installed = 0
    var removedAll = 0
    let installCompleted = HelperTarget.stepsUnlessReleased(
        [{ installed += 1; allowedNow = false }, { installed += 1 }],
        allowed: { allowedNow },
        undo: { removedAll += 1 }
    )
    guard !installCompleted, installed == 1, removedAll == 1 else {
        return fail("interleaved AI install", "\(installed) \(removedAll)")
    }
    // The CLI's settle pass: a block that a surviving helper reloaded after
    // the first readback is flushed again; residue that stays is reported.
    func settle(_ readings: [OperatorRecoveryReading]) -> (OperatorRecoveryResult, [String]) {
        var calls = 0
        var flushes: [String] = []
        let lock = NSLock()
        let result = runOperatorEmergencyDisarm(
            latch: {}, persist: { saved }, stopDaemon: { _ in .stillLoaded(bootout: 5) },
            flushPF: { lock.lock(); flushes.append("pf"); lock.unlock(); return true },
            restoreDNS: { true }, removeAI: { true }, release: { .released },
            verify: {
                lock.lock()
                defer { lock.unlock() }
                calls += 1
                return readings[min(calls, readings.count) - 1]
            },
            pause: { _ in }, readTarget: { .recorded(saved) }, restartDaemon: { _ in 0 }
        )
        return (result, flushes)
    }
    let reloaded = OperatorRecoveryReading(pfBlock: .present, dns: .absent, aiResolvers: .absent, aiRoutes: .absent)
    let (healed, healedFlushes) = settle([clean, reloaded, clean])
    let (stuck, stuckFlushes) = settle([clean, reloaded, reloaded])
    guard healed.reapplied, healed.succeeded, healedFlushes == ["pf", "pf"],
          stuck.reapplied, !stuck.succeeded, stuckFlushes == ["pf", "pf"],
          operatorRecoveryReport(stuck).contains("PF broad block: NOT restored (Tono's block is still in effect)")
    else { return fail("settle", "\(healedFlushes) \(stuckFlushes)") }

    // Persistence failure, or a target replaced before the restart: no
    // restart, an explicit error, never success.
    events = []
    let unsaved = runOperatorEmergencyDisarm(
        latch: {}, persist: { throw Injected.failure }, stopDaemon: { _ in .stopped },
        flushPF: { true }, restoreDNS: { true }, removeAI: { true }, release: { .released },
        verify: { clean }, pause: { _ in }, readTarget: { .recorded(saved) },
        restartDaemon: { _ in record("restart"); return 0 }
    )
    let replaced = runOperatorEmergencyDisarm(
        latch: {}, persist: { saved }, stopDaemon: { _ in .stopped },
        flushPF: { true }, restoreDNS: { true }, removeAI: { true }, release: { .released },
        verify: { clean }, pause: { _ in }, readTarget: { .recorded(HelperTarget(mode: .secured, generation: 10)) },
        restartDaemon: { _ in record("restart"); return 0 }
    )
    guard !unsaved.succeeded, unsaved.restart == nil, !replaced.succeeded, replaced.restart == nil, events.isEmpty,
          operatorRecoveryReport(unsaved).contains(where: { $0.hasPrefix("ERROR: the release could not be saved") }),
          operatorRecoveryReport(replaced).contains(where: { $0.hasPrefix("ERROR: the saved release") })
    else { return fail("unsaved or replaced release", events) }

    // Residue (an update disconnect that swallowed a DNS write) is not
    // success; the daemon still comes back, refusing arms, to keep cleaning.
    let residue = runOperatorEmergencyDisarm(
        latch: {}, persist: { saved }, stopDaemon: { _ in .stopped },
        flushPF: { true }, restoreDNS: { false }, removeAI: { true }, release: { .released },
        verify: { OperatorRecoveryReading(pfBlock: .absent, dns: .present, aiResolvers: .absent, aiRoutes: .absent) },
        pause: { _ in }, readTarget: { .recorded(saved) }, restartDaemon: { _ in 0 }
    )
    guard !residue.succeeded, residue.restart == .some(.some(0)),
          operatorRecoveryReport(residue).contains("DNS: NOT restored (a service or the active resolver still uses Tono's 127.0.0.1, or a restore is pending)")
    else { return fail("residue") }

    // Overall budget: every phase hangs, the command still ends by `total`.
    let hungStart = Date()
    let hung = runOperatorEmergencyDisarm(
        budget: tight, latch: {},
        persist: { sleep(30); return saved },
        stopDaemon: { _ in .stopped },
        flushPF: { sleep(30); return true }, restoreDNS: { sleep(30); return true },
        removeAI: { sleep(30); return true }, release: { sleep(30); return .released },
        verify: { sleep(30); return clean }, readTarget: { .recorded(saved) },
        restartDaemon: { _ in 0 }
    )
    let hungElapsed = elapsed(since: hungStart)
    guard hung.pfFlushed == nil, hung.release == nil, hung.reading == .unknown, hung.persisted == nil,
          hung.restart == nil, !hung.succeeded, hungElapsed < tight.total + 0.5 else {
        return fail("total budget", hungElapsed)
    }

    // Hung update lock: another holder never releases it.
    let lockPath = directory + "/lock"
    let lockHolder = open(lockPath, O_RDWR | O_CREAT | O_CLOEXEC, 0o600)
    let waiter = open(lockPath, O_RDWR | O_CLOEXEC)
    defer {
        if lockHolder >= 0 { close(lockHolder) }
        if waiter >= 0 { close(waiter) }
    }
    guard lockHolder >= 0, waiter >= 0, flock(lockHolder, LOCK_EX | LOCK_NB) == 0 else { return fail("lock setup") }
    let lockStart = Date()
    var lockCode: String?
    do {
        try UpdateStorage.withLock(waiter, budget: 0.3) {}
    } catch let failure as HelperFailure {
        lockCode = failure.code
    } catch {}
    guard lockCode == "UPDATE_LOCK_TIMEOUT", elapsed(since: lockStart) < 1.5 else {
        return fail("update lock budget", lockCode ?? "acquired")
    }

    // A stalled spawn: launchctl calls end by deadline + grace, measured
    // from before the spawn.
    let spawnStart = Date()
    let spawned = runOperatorLaunchctl(["print", "system/x"], deadline: 0.3, runner: { _, _ in sleep(30); return 0 })
    guard spawned == nil, elapsed(since: spawnStart) < 0.3 + operatorKillGrace + 0.5 else {
        return fail("stalled spawn", elapsed(since: spawnStart))
    }

    // Hung child (SIGTERM ignored) under the operator child deadline, and a
    // hung launchctl in the stop phase: both end within their budgets.
    let hangingChild = ["-c", "trap '' TERM; exec /bin/sleep 30"]
    UpdatePackage.operatorChildDeadline = 0.5
    let childStart = Date()
    let childEnded = (try? UpdatePackage.run("/bin/sh", hangingChild, deadline: 30)) == nil
    UpdatePackage.operatorChildDeadline = nil
    guard childEnded, elapsed(since: childStart) < 3.5 else { return fail("hung child") }
    let stopStart = Date()
    let hungStop = stopHelperDaemonForOperator(
        launchctl: { arguments, deadline in
            runOperatorLaunchctl(arguments, deadline: deadline, runner: { _, deadline in
                (try? KillSwitchManager.run("/bin/sh", hangingChild, deadline: deadline))?.status
            })
        },
        budget: 4
    )
    guard hungStop == .unknown, elapsed(since: stopStart) < 5 else {
        return fail("hung launchctl", hungStop)
    }

    // Stop phase answers: only "no such service" is gone.
    var loaded = true
    var bootoutStatus: Int32? = 0
    var printAfterBootout: Int32? = OperatorDaemonStop.launchctlNoSuchService
    func scripted() -> OperatorDaemonStop {
        var clock = Date(timeIntervalSince1970: 0)
        loaded = true
        return stopHelperDaemonForOperator(
            launchctl: { arguments, _ in
                if arguments[0] == "bootout" {
                    loaded = false
                    return bootoutStatus
                }
                return loaded ? 0 : printAfterBootout
            },
            pause: { clock.addTimeInterval(1) },
            now: { clock }
        )
    }
    let gone = scripted()
    bootoutStatus = 5
    printAfterBootout = 0
    let refused = scripted()
    bootoutStatus = 0
    printAfterBootout = nil
    let silent = scripted()
    guard gone == .stopped, refused == .stillLoaded(bootout: 5), silent == .unknown else {
        return fail("stop answers", "\(gone) \(refused) \(silent)")
    }
    return true
}

// MARK: - Interleaving regressions (#1504 round 5)
//
// One per failure sequence the review named. Each drives the real code path
// (the PF load gate, the target store's repair, the relaunch runner, the
// update child runner) with the kernel, disk or child replaced by an injected
// stall or failure; the target flips through `HelperTarget.processOverride`,
// which every target read in this process obeys.

private enum InjectedFailure: Error { case partialCommit, diskFull, renameFailed }

private func selfTestFail(_ label: String, _ detail: Any = "") -> Bool {
    FileHandle.standardError.write(Data("operator release \(label): \(detail)\n".utf8))
    return false
}

/// Runs `body` with the target held in memory, PF loads behind `seam`, and
/// both reset afterwards.
private func withInjectedTarget<T>(
    _ target: HelperTarget,
    seam: KillSwitchManager.BlockLoadSeam? = nil,
    _ body: () throws -> T
) rethrows -> T {
    let previousTarget = HelperTarget.processOverride
    let previousSeam = KillSwitchManager.blockLoadSeam
    HelperTarget.processOverride = target
    KillSwitchManager.blockLoadSeam = seam
    defer {
        HelperTarget.processOverride = previousTarget
        KillSwitchManager.blockLoadSeam = previousSeam
    }
    return try body()
}

private let selfTestSecured = HelperTarget(mode: .secured, generation: 5)
private let selfTestReleased = HelperTarget(mode: .released, generation: 6)

/// F1: a LAN widening derived from the armed rules stalls in its disk write;
/// meanwhile the CLI persists `released`, flushes PF and deletes the saved
/// intent. When the widening resumes it must not load the block, and the
/// rules it wrote must not stay on disk. A block that still reached the
/// kernel with no saved intent is released by the released-mode watchdog.
func runLateLANWideningAfterReleaseSelfTest() -> Bool {
    var events: [String] = []
    let seam = KillSwitchManager.BlockLoadSeam(
        load: { events.append("load") },
        undo: { events.append("undo") }
    )
    var code: String?
    withInjectedTarget(selfTestSecured, seam: seam) {
        do {
            try KillSwitchManager.applyWidenedLANScope("block drop out quick all\n", writeRules: { _ in
                events.append("write")
                // The release lands while this write is stalled.
                HelperTarget.processOverride = selfTestReleased
            })
        } catch let failure as HelperFailure {
            code = failure.code
        } catch {}
    }
    guard code == "OPERATOR_RELEASED", events == ["write", "undo"] else {
        return selfTestFail("late LAN widening", "\(code ?? "none") \(events)")
    }
    // The same widening with the release landing during the kernel load:
    // the loaded block is undone.
    events = []
    code = nil
    let loadSeam = KillSwitchManager.BlockLoadSeam(
        load: { events.append("load"); HelperTarget.processOverride = selfTestReleased },
        undo: { events.append("undo") }
    )
    withInjectedTarget(selfTestSecured, seam: loadSeam) {
        do {
            try KillSwitchManager.applyWidenedLANScope("block drop out quick all\n", writeRules: { _ in })
        } catch let failure as HelperFailure {
            code = failure.code
        } catch {}
    }
    guard code == "OPERATOR_RELEASED", events.first == "load", events.dropFirst().allSatisfy({ $0 == "undo" }),
          events.count >= 2 else {
        return selfTestFail("LAN widening released during load", "\(code ?? "none") \(events)")
    }
    // With no saved intent left, the released-mode watchdog still releases a
    // block it reads in Tono's anchor.
    guard SocketServer.watchdogSteps(
        rearmAllowed: false, coreRunning: false, stateFilePresent: false, blockPresent: true, coreDownChecks: 0
    ) == [.releaseBlock, .reconcileAI, .recoverDNS] else {
        return selfTestFail("released watchdog without saved intent")
    }
    return true
}

/// F1: a PF load (the one arm, supervision repair, permit withholding and
/// the power barrier share) commits the block, then throws (enable
/// reference, state flush or verification), and a release landed meanwhile.
/// The throw must not skip the undo; the caller gets the release's refusal.
/// Without a release the load's own error still comes back, nothing undone.
func runReleaseDuringPartialPFCommitSelfTest() -> Bool {
    var undone = 0
    var code: String?
    let seam = KillSwitchManager.BlockLoadSeam(
        load: {
            HelperTarget.processOverride = selfTestReleased
            throw InjectedFailure.partialCommit
        },
        undo: { undone += 1 }
    )
    withInjectedTarget(selfTestSecured, seam: seam) {
        do { try KillSwitchManager.ensureAnchorLoaded(flushStates: true) }
        catch let failure as HelperFailure { code = failure.code }
        catch {}
    }
    guard code == "OPERATOR_RELEASED", undone == 1 else {
        return selfTestFail("partial PF commit under release", "\(code ?? "none") \(undone)")
    }
    var passedThrough = false
    let plain = KillSwitchManager.BlockLoadSeam(load: { throw InjectedFailure.partialCommit }, undo: { undone += 1 })
    withInjectedTarget(selfTestSecured, seam: plain) {
        do { try KillSwitchManager.ensureAnchorLoaded(flushStates: true) }
        catch InjectedFailure.partialCommit { passedThrough = true }
        catch {}
    }
    guard passedThrough, undone == 1 else {
        return selfTestFail("partial PF commit without release", "\(passedThrough) \(undone)")
    }
    return true
}

/// F3: repairing an unreadable target must never leave it missing (missing
/// reads as "no release recorded" and allows automatic re-arms). A full
/// disk while writing the replacement, or a failed rename into place,
/// leaves the unreadable record, which still refuses.
func runFailedTargetRepairKeepsRefusalSelfTest() -> Bool {
    let directory = NSTemporaryDirectory() + "tono-target-repair-\(UUID().uuidString)"
    guard mkdir(directory, 0o700) == 0 else { return selfTestFail("repair directory") }
    defer { try? FileManager.default.removeItem(atPath: directory) }
    var store = HelperTarget.Store()
    store.path = directory + "/target"
    store.requireRootOwnership = false
    store.lockBudget = 0.3
    store.write = { target, path in
        try HelperTarget.encode(target).write(to: URL(fileURLWithPath: path), options: .atomic)
    }
    func refusing() -> Bool {
        guard case .unreadable = store.read() else { return false }
        return !HelperTarget.automaticRearmAllowed(store.read())
    }
    let now = Date(timeIntervalSince1970: 3_000)
    guard FileManager.default.createFile(atPath: store.path, contents: Data("garbage".utf8)), refusing() else {
        return selfTestFail("repair setup")
    }
    // The replacement cannot be written (ENOSPC): nothing was moved.
    var full = store
    full.write = { _, _ in throw InjectedFailure.diskFull }
    guard (try? HelperTarget.persistOperatorRelease(store: full, now: now)) == nil,
          (try? HelperTarget.beginSession(expected: 0, store: full, now: now)) == nil,
          refusing() else {
        return selfTestFail("repair on a full disk", store.read())
    }
    // The replacement is staged, but renaming it into place fails: the
    // record is moved back.
    var stuck = store
    stuck.move = { from, to in
        if from.contains(".staged-") { errno = EIO; return -1 }
        return rename(from, to)
    }
    guard (try? HelperTarget.persistOperatorRelease(store: stuck, now: now)) == nil, refusing(),
          (try? FileManager.default.contentsOfDirectory(atPath: directory))?
            .contains(where: { $0.contains(".staged-") }) == false else {
        return selfTestFail("repair with a failed rename", store.read())
    }
    // The same repair with a working disk still succeeds.
    guard let released = try? HelperTarget.persistOperatorRelease(store: store, now: now),
          store.read() == .recorded(released) else {
        return selfTestFail("repair", store.read())
    }
    return true
}

/// M1: the dead owner's relaunch is admitted, then an operator release lands
/// while `Process.run()` is still pending. The request must be stopped before
/// it does anything (here: before the child writes its marker).
func runOwnerRelaunchReleasedDuringSpawnSelfTest() -> Bool {
    final class Box: @unchecked Sendable {
        let lock = NSLock()
        var allowed = true
        let ended = DispatchSemaphore(value: 0)
        func read() -> Bool { lock.lock(); defer { lock.unlock() }; return allowed }
        func release() { lock.lock(); allowed = false; lock.unlock() }
    }
    let box = Box()
    let marker = NSTemporaryDirectory() + "tono-relaunch-\(UUID().uuidString)"
    defer { unlink(marker) }
    SocketServer.requestOwnerRelaunch(
        "/bin/sh", ["-c", "/bin/sleep 1; /usr/bin/touch \"$0\"", marker],
        allowed: { box.read() },
        launch: { process in
            box.release() // the release lands while the launch is pending
            try process.run()
        },
        ended: { box.ended.signal() }
    )
    guard box.ended.wait(timeout: .now() + 10) == .success else {
        return selfTestFail("relaunch during release: never ended")
    }
    usleep(1_500_000)
    guard !FileManager.default.fileExists(atPath: marker) else {
        return selfTestFail("relaunch during release: the request ran")
    }
    return true
}

/// Owner requirement: the update executor's and recovery's children are
/// bounded in the daemon and the executor too, not only under
/// `--emergency-disarm` (no operator deadline here). A child that ignores
/// SIGTERM ends within its deadline plus the kill waits, as a failure; the
/// update lock's wait is finite.
func runUpdateChildBoundedSelfTest() -> Bool {
    guard UpdatePackage.operatorChildDeadline == nil else { return selfTestFail("update child: operator deadline set") }
    let started = Date()
    let ended = (try? UpdatePackage.run("/bin/sh", ["-c", "trap '' TERM; exec /bin/sleep 30"], deadline: 0.5)) == nil
    let elapsed = Date().timeIntervalSince(started)
    guard ended, elapsed < 3.5, UpdateStorage.lockWaitBudget.isFinite,
          UpdateStorage.lockWaitBudget > HelperChildDeadline.installScript else {
        return selfTestFail("update child bounded", elapsed)
    }
    return true
}
