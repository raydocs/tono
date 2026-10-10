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

    /// `/session/connect`: an explicit user Connect. The only way out of an
    /// operator release. A failed write throws; the old target stays.
    static func beginSession(
        reading: Reading = HelperTarget.read(),
        now: Date = Date(),
        write: (HelperTarget) throws -> Void = { try HelperTarget.write($0) }
    ) throws -> UInt64 {
        let generation = nextGeneration(after: reading, now: now)
        do {
            try write(HelperTarget(mode: .secured, generation: generation))
        } catch {
            throw HelperFailure.coded(
                code: "TARGET_STATE_UNWRITABLE",
                message: "Tono's helper could not save the new connection target; protection was not changed."
            )
        }
        return generation
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

    /// `--emergency-disarm`: `released <n+1>`, written off the release's
    /// critical path.
    static func persistOperatorRelease(
        now: Date = Date(),
        readFile: () -> Reading = { HelperTarget.readFile() },
        write: (HelperTarget) throws -> Void = { try HelperTarget.write($0) }
    ) throws -> HelperTarget {
        let target = HelperTarget(mode: .released, generation: nextGeneration(after: readFile(), now: now))
        try write(target)
        return target
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
    /// Update lock inside the release; past it update cleanup is skipped.
    var lock: TimeInterval = 5
    /// Each child process the release starts (TERM, KILL, abandon).
    var child: TimeInterval = 15
    var release: TimeInterval = 60
    var verify: TimeInterval = 20
    var restart: TimeInterval = 10

    /// The restart's launchctl may spend 2 s past its deadline killing it.
    var total: TimeInterval { persist + stop + release + verify + restart + 2 }
}

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

/// `/bin/launchctl` through `KillSwitchManager.run`: past `deadline` the child
/// gets SIGTERM, then SIGKILL, each waited on for one second, and is then
/// abandoned. nil means no answer (could not start, or ran out of time).
func runOperatorLaunchctl(_ arguments: [String], deadline: TimeInterval) -> Int32? {
    (try? KillSwitchManager.run("/bin/launchctl", arguments, deadline: deadline))?.status
}

/// R3-O4: boot the daemon out of the system domain and wait until launchd no
/// longer has it, so the release below is the only writer. The phase ends by
/// `budget` seconds of wall time, including the up to two seconds
/// `runOperatorLaunchctl` may spend killing a child past its deadline.
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
        let left = end.timeIntervalSince(now()) - 2
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

struct OperatorRecoveryResult {
    var stop: OperatorDaemonStop
    /// nil: the release did not finish within its budget.
    var release: EmergencyReleaseOutcome?
    var reading: OperatorRecoveryReading
    /// nil when the write did not finish within its budget.
    var persisted: Result<HelperTarget, Error>?
    /// nil when no restart was attempted; otherwise launchctl's answer.
    var restart: Int32??
    var elapsed: TimeInterval

    var persistedTarget: HelperTarget? {
        if case .success(let target)? = persisted { return target }
        return nil
    }

    /// Success is claimed only when the release finished, every component
    /// reads back restored, and the release intent is on disk.
    var succeeded: Bool {
        release == .released && reading.restored && persistedTarget != nil
    }
}

/// The ordered `--emergency-disarm`: (1) release intent in memory, its write
/// started beside everything else; (2) bounded bootout; (3) bounded network
/// release; (4) bounded readback; (5) a restart only once `released` is on
/// disk, so the daemon comes back refusing every arm but keeps cleaning up.
/// Persistence failure leaves the daemon stopped: nothing can re-arm.
func runOperatorEmergencyDisarm(
    budget: OperatorRecoveryBudget = OperatorRecoveryBudget(),
    latch: () -> Void = { HelperTarget.processOverride = HelperTarget(mode: .released, generation: 0) },
    persist: @escaping () throws -> HelperTarget = { try HelperTarget.persistOperatorRelease() },
    stopDaemon: (TimeInterval) -> OperatorDaemonStop = { stopHelperDaemonForOperator(budget: $0) },
    release: @escaping () -> EmergencyReleaseOutcome,
    verify: @escaping () -> OperatorRecoveryReading = { OperatorRecoveryReading.readSystem() },
    restartDaemon: (TimeInterval) -> Int32? = {
        runOperatorLaunchctl(["bootstrap", "system", UpdateExecutor.daemonPlist], deadline: $0)
    }
) -> OperatorRecoveryResult {
    let started = Date()
    latch()
    let persistence = BoundedTask { () -> Result<HelperTarget, Error> in Result { try persist() } }
    let stop = stopDaemon(budget.stop)
    let outcome = BoundedTask(release).wait(budget.release)
    let reading = BoundedTask(verify).wait(budget.verify) ?? .unknown
    let persisted = persistence.wait(budget.persist)
    var restart: Int32??
    if stop != .notLoaded, case .success? = persisted {
        restart = .some(restartDaemon(budget.restart))
    }
    return OperatorRecoveryResult(
        stop: stop, release: outcome, reading: reading, persisted: persisted,
        restart: restart, elapsed: Date().timeIntervalSince(started)
    )
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
    switch result.release {
    case nil: lines.append("Release: did not finish within its time budget.")
    case .refused?: lines.append("Release: PF could not be released.")
    case .dnsRestoreFailed?: lines.append("Release: PF released; DNS restore failed.")
    case .coreStillRunning?: lines.append("Release: PF and DNS released; a Tono Core process survived SIGKILL.")
    case .released?: lines.append("Release: finished.")
    }
    lines += result.reading.lines
    switch result.persisted {
    case .success(let target)?:
        lines.append("Saved target: released by an administrator (generation \(target.generation)). "
            + "Tono will not reconnect on its own; click Connect in Tono to reconnect.")
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

    // Target record: format, missing, unreadable.
    guard HelperTarget.decode(HelperTarget.encode(HelperTarget(mode: .released, generation: 42)))
            == HelperTarget(mode: .released, generation: 42),
          HelperTarget.decode(Data("released 4x\n".utf8)) == nil,
          HelperTarget.decode(Data("armed 4\n".utf8)) == nil,
          HelperTarget.decode(Data("secured 4".utf8)) == nil else { return fail("record format") }
    let directory = NSTemporaryDirectory() + "tono-target-\(UUID().uuidString)"
    guard mkdir(directory, 0o700) == 0 else { return fail("temporary directory") }
    defer {
        unlink(directory + "/target")
        rmdir(directory)
    }
    let file = directory + "/target"
    guard HelperTarget.readFile(path: file, requireRootOwnership: false) == .missing,
          FileManager.default.createFile(atPath: file, contents: Data("garbage".utf8)),
          case .unreadable = HelperTarget.readFile(path: file, requireRootOwnership: false) else {
        return fail("missing or unreadable record")
    }

    // Latch semantics: an operator release refuses every arm that is not a
    // newer user Connect: the old session's generation, a heal or an
    // automatic reconnect (no generation), and so does an unreadable record.
    var disk = HelperTarget.Reading.recorded(HelperTarget(mode: .secured, generation: 6))
    let released = try? HelperTarget.persistOperatorRelease(
        now: now, readFile: { disk }, write: { disk = .recorded($0) }
    )
    guard released == HelperTarget(mode: .released, generation: 7),
          HelperTarget.admission(disk, sessionGeneration: 6)
            == .refused(code: "OPERATOR_RELEASED", message: operatorReleasedMessage(disk)),
          case .refused = HelperTarget.admission(disk, sessionGeneration: nil),
          case .refused = HelperTarget.admission(disk, sessionGeneration: 7),
          !HelperTarget.automaticRearmAllowed(disk),
          case .refused(let unreadableCode, _) = HelperTarget.admission(.unreadable("x"), sessionGeneration: nil),
          unreadableCode == "TARGET_STATE_UNREADABLE",
          !HelperTarget.automaticRearmAllowed(.unreadable("x")) else {
        return fail("operator release refusals", disk)
    }
    // A failed Connect write keeps the release.
    guard (try? HelperTarget.beginSession(reading: disk, now: now, write: { _ in throw Injected.failure })) == nil,
          case .refused = HelperTarget.admission(disk, sessionGeneration: nil) else {
        return fail("failed Connect write")
    }
    // A user Connect begins generation 8: its arms pass, then a heal or an
    // automatic reconnect of the same session; generation 6 and 7 never.
    guard let connected = try? HelperTarget.beginSession(reading: disk, now: now, write: { disk = .recorded($0) }),
          connected == 8,
          HelperTarget.admission(disk, sessionGeneration: 8) == .allowed,
          HelperTarget.admission(disk, sessionGeneration: nil) == .allowed,
          case .refused(let staleCode, _) = HelperTarget.admission(disk, sessionGeneration: 6),
          staleCode == "SESSION_SUPERSEDED",
          case .refused = HelperTarget.admission(disk, sessionGeneration: 7),
          HelperTarget.admission(.missing, sessionGeneration: nil) == .allowed,
          HelperTarget.nextGeneration(after: .unreadable("x"), now: now) == 1_000_000 else {
        return fail("user Connect", disk)
    }
    guard (try? HelperTarget.sessionGeneration(NSNumber(value: 8))) == .some(8),
          (try? HelperTarget.sessionGeneration(kCFBooleanTrue)) == nil,
          (try? HelperTarget.sessionGeneration(NSNumber(value: 1.5))) == nil,
          (try? HelperTarget.sessionGeneration(NSNumber(value: -1))) == nil else {
        return fail("sessionGeneration field")
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
          !OperatorRecoveryReading(pfBlock: .absent, dns: .unknown, aiResolvers: .absent, aiRoutes: .absent).restored
    else { return fail("per-component readback") }

    // Order and restart: the release intent is in memory before the
    // bootout, the bootout comes before the release, and the daemon comes
    // back only once `released` is on disk.
    var events: [String] = []
    let eventLock = NSLock()
    func record(_ event: String) {
        eventLock.lock()
        events.append(event)
        eventLock.unlock()
    }
    let clean = OperatorRecoveryReading(pfBlock: .absent, dns: .absent, aiResolvers: .absent, aiRoutes: .absent)
    let ordered = runOperatorEmergencyDisarm(
        latch: { record("latch") },
        persist: { HelperTarget(mode: .released, generation: 9) },
        stopDaemon: { _ in record("stop"); return .stopped },
        release: { record("release"); return .released },
        verify: { record("verify"); return clean },
        restartDaemon: { _ in record("restart"); return 0 }
    )
    guard ordered.succeeded, events == ["latch", "stop", "release", "verify", "restart"] else {
        return fail("order", events)
    }

    // Persistence failure: no restart, an explicit error, never success.
    events = []
    let unsaved = runOperatorEmergencyDisarm(
        latch: {},
        persist: { throw Injected.failure },
        stopDaemon: { _ in .stopped },
        release: { .released },
        verify: { clean },
        restartDaemon: { _ in record("restart"); return 0 }
    )
    guard !unsaved.succeeded, unsaved.restart == nil, events.isEmpty,
          operatorRecoveryReport(unsaved).contains(where: { $0.hasPrefix("ERROR: the release could not be saved") })
    else { return fail("persistence failure", events) }

    // A release that reports success but leaves residue (an update
    // disconnect that swallowed a DNS write) is not success; the daemon still
    // comes back, refusing arms, to keep cleaning up.
    let residue = runOperatorEmergencyDisarm(
        latch: {},
        persist: { HelperTarget(mode: .released, generation: 9) },
        stopDaemon: { _ in .stopped },
        release: { .released },
        verify: { OperatorRecoveryReading(pfBlock: .absent, dns: .present, aiResolvers: .absent, aiRoutes: .absent) },
        restartDaemon: { _ in 0 }
    )
    guard !residue.succeeded, residue.restart == .some(.some(0)),
          operatorRecoveryReport(residue).contains("DNS: NOT restored (a service or the active resolver still uses Tono's 127.0.0.1, or a restore is pending)")
    else { return fail("residue") }

    // Overall budget: every phase hangs, the command still ends by `total`.
    var tight = OperatorRecoveryBudget()
    tight.persist = 0.2
    tight.stop = 0.2
    tight.release = 0.3
    tight.verify = 0.3
    tight.restart = 0.2
    let hungStart = Date()
    let hung = runOperatorEmergencyDisarm(
        budget: tight,
        latch: {},
        persist: { sleep(30); return HelperTarget(mode: .released, generation: 9) },
        stopDaemon: { _ in .stopped },
        release: { sleep(30); return .released },
        verify: { sleep(30); return clean },
        restartDaemon: { _ in record("hung restart"); return 0 }
    )
    let hungElapsed = Date().timeIntervalSince(hungStart)
    guard hung.release == nil, hung.reading == .unknown, hung.persisted == nil, hung.restart == nil,
          !hung.succeeded, hungElapsed < tight.total + 0.5 else {
        return fail("total budget", hungElapsed)
    }

    // Hung update lock: another holder never releases it.
    let lockPath = directory + "/lock"
    let holder = open(lockPath, O_RDWR | O_CREAT | O_CLOEXEC, 0o600)
    let waiter = open(lockPath, O_RDWR | O_CLOEXEC)
    defer {
        if holder >= 0 { close(holder) }
        if waiter >= 0 { close(waiter) }
        unlink(lockPath)
    }
    guard holder >= 0, waiter >= 0, flock(holder, LOCK_EX | LOCK_NB) == 0 else { return fail("lock setup") }
    let lockStart = Date()
    var lockCode: String?
    do {
        try UpdateStorage.withLock(waiter, budget: 0.3) {}
    } catch let failure as HelperFailure {
        lockCode = failure.code
    } catch {}
    guard lockCode == "UPDATE_LOCK_TIMEOUT", Date().timeIntervalSince(lockStart) < 1.5 else {
        return fail("update lock budget", lockCode ?? "acquired")
    }

    // Hung child (SIGTERM ignored) under the operator child deadline, and a
    // hung launchctl in the stop phase: both end within their budgets.
    let hangingChild = ["-c", "trap '' TERM; exec /bin/sleep 30"]
    UpdatePackage.operatorChildDeadline = 0.5
    let childStart = Date()
    let childEnded = (try? UpdatePackage.run("/bin/sh", hangingChild)) == nil
    UpdatePackage.operatorChildDeadline = nil
    guard childEnded, Date().timeIntervalSince(childStart) < 3.5 else { return fail("hung child") }
    let stopStart = Date()
    let hungStop = stopHelperDaemonForOperator(
        launchctl: { _, deadline in
            (try? KillSwitchManager.run("/bin/sh", hangingChild, deadline: deadline))?.status
        },
        budget: 3
    )
    guard hungStop == .unknown, Date().timeIntervalSince(stopStart) < 4.5 else {
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

private func operatorReleasedMessage(_ reading: HelperTarget.Reading) -> String {
    if case .refused(_, let message) = HelperTarget.admission(reading, sessionGeneration: nil) { return message }
    return ""
}
