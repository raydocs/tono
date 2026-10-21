import Foundation
import Darwin
import SystemConfiguration

/// Preemptive "Restore internet" (PROPOSAL §10 v5, IMPLEMENTATION.md).
///
/// The app talks to a separate launchd job (`com.raydocs.tono.release`), not
/// to the helper daemon, so a daemon stuck behind a long update or repair
/// cannot delay the release. Each release runs in a fresh worker process that
/// is its own session leader: every effect the release causes runs in that
/// worker or in one of its children, so "the session is empty" is the
/// retirement condition for the whole release.
enum ReleaseService {
    static let label = "com.raydocs.tono.release"
    static let binaryPath = "/Library/PrivilegedHelperTools/tono-release"
    static let plistPath = "/Library/LaunchDaemons/com.raydocs.tono.release.plist"
    static let socketPath = "/var/run/tono-release.sock"
    static let daemonLabel = UpdateExecutor.daemonLabel
    static let daemonPlist = UpdateExecutor.daemonPlist

    /// The app's own deadline is a few seconds longer; it never waits on a
    /// worker that did not answer.
    static let answerDeadline: TimeInterval = 25
    static let serviceAnswerDeadline: TimeInterval = 28
    static let hardDeadline: TimeInterval = 90
}

// MARK: - Report

struct ReleaseReport: Codable, Equatable {
    struct Component: Codable, Equatable {
        /// pf, ai, dns, core, processes
        let name: String
        /// restored | residual | unreadable
        var readback: String
        /// settled | unknown
        var risk: String
        var detail: String?
    }

    /// restored | partial | unknown | busy | superseded
    var outcome: String
    var generation: UInt64?
    var components: [Component]
    var stuck: [Int32]
    /// False when the answer deadline came first; work continues.
    var finished: Bool
    var detail: String?
    /// Lifecycle, quarantine, scan and durability steps that did not prove
    /// themselves. Any entry makes the outcome unknown (R-F5).
    var failures: [String]? = nil

    /// `restored` only when every component reads back clean and settled,
    /// nothing that could still change the network is left, every step
    /// proved itself, and the worker finished.
    static func outcome(components: [Component], stuck: [Int32], finished: Bool, failures: [String] = []) -> String {
        if !finished || !stuck.isEmpty || !failures.isEmpty { return "unknown" }
        if components.contains(where: { $0.readback == "unreadable" || $0.risk != "settled" }) { return "unknown" }
        if components.contains(where: { $0.readback == "residual" }) { return "partial" }
        return components.isEmpty ? "unknown" : "restored"
    }

    static func refusal(_ outcome: String, detail: String, generation: UInt64? = nil) -> ReleaseReport {
        ReleaseReport(outcome: outcome, generation: generation, components: [], stuck: [], finished: true, detail: detail)
    }

    func json() -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return (try? encoder.encode(self)) ?? Data(#"{"outcome":"unknown","components":[],"stuck":[],"finished":false}"#.utf8)
    }
}

// MARK: - Worker

/// `tono-release --release-worker`: one release, one process, one session.
enum ReleaseWorker {
    struct Request: Codable {
        let requestID: String
        let expectedGeneration: UInt64?
    }

    /// Serialises report lines on stdout. The first line is the answer the
    /// app waits for; later lines replace it.
    final class Reporter: @unchecked Sendable {
        private let lock = NSLock()
        private var report = ReleaseReport(outcome: "unknown", generation: nil, components: [], stuck: [], finished: false, detail: nil)

        func update(_ change: (inout ReleaseReport) -> Void) {
            lock.lock()
            defer { lock.unlock() }
            change(&report)
        }

        /// Records a step that did not prove itself. Collected, never
        /// overwritten, so the outcome is chosen from all of them.
        func fail(_ note: String) {
            update { $0.failures = ($0.failures ?? []) + [note] }
        }

        /// Writes the current report. Unfinished components, failed steps
        /// and an unfinished worker make the outcome unknown, never restored.
        func emit(finished: Bool) {
            lock.lock()
            defer { lock.unlock() }
            var line = report
            line.finished = finished
            if line.outcome != "busy" && line.outcome != "superseded" {
                line.outcome = ReleaseReport.outcome(components: line.components, stuck: line.stuck,
                                                     finished: finished, failures: line.failures ?? [])
            }
            var data = line.json()
            data.append(0x0A)
            FileHandle.standardOutput.write(data)
        }
    }

    static func run(authority: ReleaseAuthority = ReleaseAuthority()) -> Int32 {
        let reporter = Reporter()
        guard geteuid() == 0 else {
            reporter.update { $0 = .refusal("unknown", detail: "The release worker must run as root.") }
            reporter.emit(finished: true)
            return 1
        }
        guard let line = readLine(strippingNewline: true),
              let request = try? JSONDecoder().decode(Request.self, from: Data(line.utf8)) else {
            reporter.update { $0 = .refusal("unknown", detail: "Invalid release request.") }
            reporter.emit(finished: true)
            return 1
        }
        startWatchdog(reporter)
        var outcome: Int32 = 0
        do {
            try authority.withLock(timeout: 3) { _ in
                outcome = try releaseLocked(request: request, authority: authority, reporter: reporter)
            }
        } catch ReleaseAuthority.Failure.busy {
            // Never terminate or clean up without C (E-F5-v4-F1).
            reporter.update { $0 = .refusal("busy", detail: "Another restore is still running.") }
            reporter.emit(finished: true)
            return 2
        } catch {
            // A failed save leaves the record uncertain: never restored.
            reporter.fail("Restore could not record its progress: \(error)")
            outcome = 1
        }
        // After the release itself: the daemon waits for C at start, so it
        // comes up once this returns.
        if case .pending(let reason) = ReleaseQuarantine.recover(
            authority: authority, exempt: ReleaseProcessTable.incarnation(of: getpid())
        ) {
            reporter.fail(reason)
        }
        reporter.emit(finished: true)
        return outcome
    }

    /// At the answer deadline the app gets the state as it is, with every
    /// unfinished step unknown. At the hard deadline the worker ends its own
    /// session, so nothing it started outlives it unrecorded. The record
    /// still says unfinished, and the release job puts the daemon back.
    private static func startWatchdog(_ reporter: Reporter) {
        Thread.detachNewThread {
            Thread.sleep(forTimeInterval: ReleaseService.answerDeadline)
            reporter.emit(finished: false)
            Thread.sleep(forTimeInterval: ReleaseService.hardDeadline - ReleaseService.answerDeadline)
            reporter.update { $0.detail = "Restore stopped at its time limit." }
            reporter.emit(finished: false)
            let me = getpid()
            for member in ReleaseProcessTable.members(session: getsid(0), group: getpgrp()) ?? [] where member != me {
                kill(member, SIGKILL)
            }
            _exit(3)
        }
    }

    private static func releaseLocked(request: ReleaseWorker.Request, authority: ReleaseAuthority, reporter: Reporter) throws -> Int32 {
        let processes = ReleaseProcesses.live
        let currentBoot = processes.bootSession()
        var record: ReleaseAuthority.Record
        var recordWasCorrupt = false
        do { record = try authority.load() } catch ReleaseAuthority.Failure.corrupt {
            // Unreadable history is not a reason to keep the user offline,
            // so the release runs. The new generation is clock-based, so it
            // still exceeds any generation an earlier session could carry.
            // The lost history may have named work that is still running,
            // so Connect stays refused for the rest of this boot (R-F2).
            record = ReleaseAuthority.Record()
            record.historyLostBoot = currentBoot ?? ""
            recordWasCorrupt = true
        }
        if let expected = request.expectedGeneration, record.mode == .secured, record.generation != expected {
            reporter.update { $0 = .refusal("superseded", detail: "A newer connection replaced the session this restore was for.", generation: record.generation) }
            return 0
        }
        if record.mode == .secured || recordWasCorrupt {
            record.generation = ReleaseAuthority.nextGeneration(after: record.generation)
        }
        let (carried, carriedStuck) = carryForward(record, currentBoot: currentBoot, processes: processes)
        record.mode = .released
        record.requestID = String(request.requestID.prefix(64))
        guard let me = ReleaseProcessTable.incarnation(of: getpid()) else {
            throw ReleaseAuthority.Failure.io("Worker identity is unreadable.")
        }
        record.worker = me
        record.workerSession = getsid(0)
        record.workerGroup = getpgrp()
        record.workerBootSession = currentBoot
        record.workerFinished = false
        record.earlier = carried.isEmpty ? nil : carried
        record.stuck = carriedStuck
        // Unsettled until this release proves otherwise.
        record.unsettled = ReleaseCleanup.componentNames
        // Durable before the bootout, so the release job can put the daemon
        // back if this worker dies (R-F6).
        record.daemonBootedOut = true
        // Durable before any effect: a crash from here on leaves a record
        // that names this worker's session.
        try authority.save(record)
        let generation = record.generation
        reporter.update { $0.generation = generation }

        // 1. Launch quarantine and termination of every old writer.
        let executorWasInstalled = FileManager.default.fileExists(atPath: UpdateExecutor.plist)
        let stop = ReleaseStop.stopWriters(earlier: carried, processes: processes)
        record.stuck = carriedStuck.filter { processes.liveness($0) != .gone } + stop.stuck
        record.earlier = stop.earlier.isEmpty ? nil : stop.earlier
        record.executorQuarantined = record.executorQuarantined || executorWasInstalled
        try authority.save(record)
        let stuckPIDs = record.stuck.map(\.pid)
        reporter.update { $0.stuck = stuckPIDs }
        stop.failures.forEach(reporter.fail)

        // 2. A pending native update must not resume its own teardown or
        //    re-arm when its executor comes back.
        ReleaseStop.markUpdateDisconnectRequested()

        // 3. Cleanup, then every Tono command child ended and confirmed gone,
        //    then the second read. One more round when it is not clean.
        var components = ReleaseCleanup.cleanAndRead()
        reporter.update { $0.components = components }
        var children = ReleaseChildren.end()
        Thread.sleep(forTimeInterval: 1)
        var second = ReleaseCleanup.read()
        if second.contains(where: { $0.readback != "restored" }) {
            components = ReleaseCleanup.cleanAndRead()
            children = ReleaseChildren.end()
            Thread.sleep(forTimeInterval: 1)
            second = ReleaseCleanup.read()
        }
        children.failures.forEach(reporter.fail)

        let stuckNow = record.stuck + children.stuck
        let evidence = TerminalEvidence(
            quarantineVerified: stop.quarantineVerified,
            writersEnded: stop.failures.isEmpty && stop.earlier.isEmpty && stuckNow.isEmpty && children.failures.isEmpty,
            busy: children.busy,
            storedDNSUsesTonoResolver: ReleaseCleanup.storedDNSUsesTonoResolver()
        )
        let settled = settle(first: components, second: second, evidence: evidence)
        record.stuck = stuckNow
        record.unsettled = settled.filter { $0.risk != "settled" }.map(\.name)
        // History lost in an earlier boot named only processes that ended with
        // it; this release read everything back settled, so it is checked.
        // History lost in this boot stays until a restart (Sol R2-F3).
        if record.unsettled?.isEmpty == true, let lost = record.historyLostBoot,
           !lost.isEmpty, let currentBoot, !ReleaseAuthority.sameBoot(lost, currentBoot) {
            record.historyLostBoot = nil
        }
        record.workerFinished = true
        let finalStuck = stuckNow.map(\.pid)
        reporter.update {
            $0.components = settled
            $0.stuck = finalStuck
        }
        try authority.save(record)
        return 0
    }

    /// R-F2: the previous worker and every earlier one not yet retired are
    /// carried into `earlier` instead of being dropped, and so are survivors
    /// of SIGKILL. Only proof retires them: a provably earlier boot, or gone
    /// with an empty session and group.
    static func carryForward(
        _ record: ReleaseAuthority.Record,
        currentBoot: String?,
        processes: ReleaseProcesses
    ) -> (earlier: [ReleaseAuthority.Slot], stuck: [ReleaseAuthority.Incarnation]) {
        var earlier = record.earlier ?? []
        if let previous = ReleaseProcesses.slot(of: record) { earlier.append(previous) }
        earlier = earlier.filter {
            ReleaseAuthority.sameBoot($0.bootSession, currentBoot) && processes.retireReason($0) != nil
        }
        let stuck = ReleaseAuthority.sameBoot(record.workerBootSession, currentBoot)
            ? record.stuck.filter { processes.liveness($0) != .gone }
            : []
        return (earlier, stuck)
    }

    /// What the release proved beyond its two reads.
    struct TerminalEvidence {
        /// launchd read back both jobs as not loaded.
        var quarantineVerified: Bool
        /// Every old writer, earlier worker and Tono command child ended and
        /// confirmed gone, and every scan succeeded.
        var writersEnded: Bool
        /// Components a live or unidentified writer could still change.
        var busy: Set<String>
        var storedDNSUsesTonoResolver: Bool?
    }

    /// R-F1: two agreeing reads are the current readback, not proof that
    /// nothing changes later. A component is settled only when both reads
    /// agree and there is terminal evidence as well: every writer that could
    /// touch it ended and confirmed gone, the quarantine read back, and its
    /// own channel has a terminal basis (PF: no pfctl child alive, its
    /// ioctls are synchronous; DNS: no writer and no networksetup child
    /// alive, and the stored preferences configd applies are clean).
    /// Everything else stays unknown.
    static func settle(
        first: [ReleaseReport.Component],
        second: [ReleaseReport.Component],
        evidence: TerminalEvidence
    ) -> [ReleaseReport.Component] {
        second.map { component -> ReleaseReport.Component in
            var copy = component
            let earlier = first.first { $0.name == component.name }
            var terminal = evidence.quarantineVerified && evidence.writersEnded && !evidence.busy.contains(component.name)
            if component.name == "dns" { terminal = terminal && evidence.storedDNSUsesTonoResolver == false }
            copy.risk = (earlier?.readback == component.readback && terminal) ? "settled" : "unknown"
            return copy
        }
    }

    /// Bootstraps the helper daemon unless it is loaded. True only when a
    /// readback shows it loaded, or when it is not installed at all. The
    /// update executor stays quarantined until the next admitted Connect.
    static func restoreDaemon() -> Bool {
        guard FileManager.default.fileExists(atPath: ReleaseService.daemonPlist) else { return true }
        if ReleaseLaunchd.state(ReleaseService.daemonLabel) == .loaded { return true }
        // The command's status is not the proof; the readback below is.
        _ = try? KillSwitchManager.run("/bin/launchctl", ["bootstrap", "system", ReleaseService.daemonPlist], deadline: 5)
        return ReleaseLaunchd.state(ReleaseService.daemonLabel) == .loaded
    }
}

// MARK: - Launch quarantine

enum ReleaseLaunchd {
    enum JobState: Equatable { case loaded, notLoaded, unknown }

    /// launchd's own answer. `print` exits 113 ("Could not find service")
    /// for a job that is not loaded; anything else unexpected is unknown.
    static func state(_ label: String) -> JobState {
        guard let result = try? KillSwitchManager.run("/bin/launchctl", ["print", "system/" + label], deadline: 3) else {
            return .unknown
        }
        if result.status == 0 { return .loaded }
        if result.status == 113 || result.message.lowercased().contains("could not find service") { return .notLoaded }
        return .unknown
    }

    /// Boots `label` out. Its status is not proof: bootout also fails for a
    /// job that was never loaded, and can time out while launchd finishes
    /// it. The caller reads the state back (R-F5).
    static func bootOut(_ label: String) {
        _ = try? KillSwitchManager.run("/bin/launchctl", ["bootout", "system/" + label], deadline: 4)
    }
}

/// R-F6: puts the helper daemon back after a release booted it out, from the
/// worker that did it or, when that worker died (crash, hard cap), from the
/// release job at its start and after each worker exits. It never re-arms:
/// the record stays released, so the daemon refuses every protective
/// request, and the update executor stays quarantined until the next
/// admitted Connect. A failure is written to the record and retried.
enum ReleaseQuarantine {
    enum Result: Equatable {
        case clear
        case pending(String)
    }

    static func recover(
        authority: ReleaseAuthority = ReleaseAuthority(),
        processes: ReleaseProcesses = .live,
        exempt: ReleaseAuthority.Incarnation? = nil,
        lockTimeout: TimeInterval = 3,
        restore: () -> Bool = { ReleaseWorker.restoreDaemon() }
    ) -> Result {
        let failure = "The Tono helper could not be started again after Restore internet; the restore service keeps retrying."
        do {
            return try authority.withLock(timeout: lockTimeout) { _ -> Result in
                var record: ReleaseAuthority.Record
                do { record = try authority.load() } catch ReleaseAuthority.Failure.corrupt {
                    // Whether a release booted it out is unknown. Bringing it
                    // back arms nothing: it refuses protective requests while
                    // the record is unreadable.
                    return restore() ? .clear : .pending(failure)
                }
                guard record.daemonBootedOut == true else { return .clear }
                if let worker = record.worker, worker != exempt, processes.liveness(worker) != .gone {
                    return .pending("Restore internet is still running.")
                }
                if restore() {
                    record.daemonBootedOut = nil
                    record.daemonRecoveryFailure = nil
                    try authority.save(record)
                    return .clear
                }
                record.daemonRecoveryFailure = failure
                try authority.save(record)
                return .pending(failure)
            }
        } catch {
            return .pending("\(failure) (\(error))")
        }
    }
}

// MARK: - Stop old writers

enum ReleaseStop {
    /// Every privileged Tono executable except the release job itself.
    static func isWriter(path: String) -> Bool {
        if path == ReleaseService.binaryPath { return false }
        if path.hasPrefix("/Library/PrivilegedHelperTools/tono-") { return true }
        if path.hasPrefix(UpdateStorage.directory + "/") { return true }
        return false
    }

    struct WriterScan {
        let all: [pid_t]
        let writers: [pid_t]
    }

    /// Writers outside this worker's session. Nil when the process list
    /// could not be read. A live process whose executable cannot be read is
    /// left to `ReleaseChildren.end`, which counts it as unknown.
    static func writerScan() -> WriterScan? {
        let me = getpid()
        let mySession = getsid(0)
        guard let all = ReleaseProcessTable.listPIDs() else { return nil }
        let writers = all.filter { pid in
            guard pid != me, getsid(pid) != mySession,
                  let path = ReleaseProcessTable.path(of: pid) else { return false }
            return isWriter(path: path)
        }
        return WriterScan(all: all, writers: writers)
    }

    /// Every descendant of `roots` among `all`, by parent pid.
    static func descendants(of roots: Set<pid_t>, among all: [pid_t]) -> Set<pid_t> {
        var parents: [pid_t: pid_t] = [:]
        for pid in all {
            if let parent = ReleaseProcessTable.parent(of: pid) { parents[pid] = parent }
        }
        var found = Set<pid_t>()
        var grew = true
        while grew {
            grew = false
            for (pid, parent) in parents where !found.contains(pid) && (roots.contains(parent) || found.contains(parent)) {
                found.insert(pid)
                grew = true
            }
        }
        return found
    }

    struct Result {
        var stuck: [ReleaseAuthority.Incarnation] = []
        /// Earlier release workers still not proven gone with an empty session.
        var earlier: [ReleaseAuthority.Slot] = []
        /// Both jobs read back as not loaded after their bootout.
        var quarantineVerified = false
        var failures: [String] = []
    }

    /// Boots out the daemon and the update executor so launchd cannot start
    /// them again during the release, SIGKILLs every writer, every earlier
    /// release worker's session and every command child a writer started,
    /// and confirms each is gone. What is still alive or could not be
    /// checked keeps Connect blocked.
    static func stopWriters(earlier: [ReleaseAuthority.Slot], processes: ReleaseProcesses = .live) -> Result {
        var result = Result()
        let labels = [ReleaseService.daemonLabel, UpdateExecutor.label]
        // A live writer's children are Tono's whatever their arguments.
        // Snapshot them before their parent dies and they are reparented.
        var children = Set<pid_t>()
        if let scan = writerScan() { children = descendants(of: Set(scan.writers), among: scan.all) }
        let bootouts = DispatchGroup()
        for label in labels {
            DispatchQueue.global(qos: .userInitiated).async(group: bootouts) { ReleaseLaunchd.bootOut(label) }
        }
        // A KeepAlive restart can land between the kill and the bootout.
        for _ in 0..<3 {
            if let scan = writerScan() {
                children.formUnion(descendants(of: Set(scan.writers), among: scan.all))
                scan.writers.forEach { kill($0, SIGKILL) }
            }
            // An earlier worker's tail would put the daemon back mid-release.
            for slot in earlier {
                if processes.liveness(slot.worker) == .alive { processes.kill(slot.worker.pid) }
                processes.groupMembers(slot.session, slot.group)?.forEach(processes.kill)
            }
            usleep(300_000)
        }
        _ = bootouts.wait(timeout: .now() + 5)

        // The quarantine is what launchd reads back, not the bootout status.
        var notLoaded = Set<String>()
        let quarantineEnd = Date().addingTimeInterval(3)
        while notLoaded.count < labels.count {
            for label in labels where !notLoaded.contains(label) && ReleaseLaunchd.state(label) == .notLoaded {
                notLoaded.insert(label)
            }
            guard notLoaded.count < labels.count, Date() < quarantineEnd else { break }
            for label in labels where !notLoaded.contains(label) { ReleaseLaunchd.bootOut(label) }
            usleep(200_000)
        }
        result.quarantineVerified = notLoaded.count == labels.count
        if !result.quarantineVerified {
            result.failures.append("launchd could not confirm that Tono's helper is stopped.")
        }

        let end = Date().addingTimeInterval(3)
        var scan = writerScan()
        while let current = scan, !current.writers.isEmpty, Date() < end {
            current.writers.forEach { kill($0, SIGKILL) }
            usleep(100_000)
            scan = writerScan()
        }
        if let final = scan {
            for pid in final.writers {
                switch ReleaseProcessTable.state(of: pid) {
                case .alive(let found): result.stuck.append(found)
                case .unknown: result.failures.append("Tono process \(pid) could not be checked.")
                case .gone: break
                }
            }
        } else {
            result.failures.append("The running processes could not be listed.")
        }
        let ended = ReleaseChildren.end(startedByWriters: children)
        result.stuck += ended.stuck
        result.failures += ended.failures
        result.earlier = earlier.filter { processes.retireReason($0) != nil }
        if !result.earlier.isEmpty {
            result.failures.append("An earlier restore could not be ended.")
        }
        return result
    }

    /// Bounded: the update lock may be held by a process this release could
    /// not see (an installer shell). Abandoning the wait changes nothing.
    static func markUpdateDisconnectRequested() {
        let done = DispatchSemaphore(value: 0)
        Thread.detachNewThread {
            defer { done.signal() }
            guard let storage = try? UpdateStorage() else { return }
            try? storage.locked {
                var ledger = try storage.load()
                guard var attempt = ledger.attempt, attempt.receipt.phase != .committed,
                      !attempt.disconnectRequested else { return }
                attempt.disconnectRequested = true
                ledger.attempt = attempt
                try storage.save(ledger)
            }
        }
        _ = done.wait(timeout: .now() + 3)
    }
}

/// Command children Tono starts through `KillSwitchManager.run`: `pfctl`,
/// `networksetup` and `route`, each behind the `/bin/sh` admission gate until
/// it execs. There is no process group, so a child of a killed helper is
/// reparented to launchd and can still write after its parent is gone. The
/// release finds them by executable and arguments (`KERN_PROCARGS2`), not by
/// parent. Arguments that cannot be read are unknown, never "not ours".
enum ReleaseChildren {
    /// The components each command can change.
    static let tools: [String: [String]] = [
        "/sbin/pfctl": ["pf", "ai"],
        "/usr/sbin/networksetup": ["dns"],
        "/sbin/route": ["ai"],
    ]
    static let allComponents = ReleaseCleanup.componentNames

    enum Verdict: Equatable {
        /// Cannot change a release component.
        case unrelated
        /// Tono's: ended by the release.
        case tono([String])
        /// A writer not provably Tono's: left alone, but its components have
        /// no terminal basis while it runs.
        case foreign([String])
        /// Not readable: may be Tono's.
        case unknown([String])
    }

    /// `/bin/sh` on macOS re-executes the selected shell in the same
    /// process, so the gate can run under any of these paths.
    static let shells: Set<String> = ["/bin/sh", "/bin/bash", "/bin/dash", "/bin/zsh"]

    static func classify(path: String, arguments: [String]?, startedByWriter: Bool) -> Verdict {
        if shells.contains(path) {
            guard let arguments else { return .unknown(allComponents) }
            guard arguments.count > 3, arguments[1] == "-c",
                  arguments[2] == KillSwitchManager.commandGateScript else { return .unrelated }
            return .tono(tools[arguments[3]] ?? allComponents)
        }
        guard let components = tools[path] else { return .unrelated }
        guard let arguments else { return .unknown(components) }
        if startedByWriter || isMarked(path: path, arguments: arguments) { return .tono(components) }
        return mutates(path: path, arguments: arguments) ? .foreign(components) : .unrelated
    }

    /// Tono's markers: its anchor and PF files, its resolver address, the AI
    /// hold prefixes.
    static func isMarked(path: String, arguments: [String]) -> Bool {
        let rest = arguments.dropFirst()
        switch path {
        case "/sbin/pfctl":
            return rest.contains {
                $0 == killSwitchAnchor || $0.hasPrefix(ReleaseAuthority.liveDirectory + "/") || $0.hasPrefix("/etc/.tono-pf")
            }
        case "/usr/sbin/networksetup":
            return rest.contains("-setdnsservers") && rest.contains(ProtectedDNSContract.server)
        case "/sbin/route":
            return rest.contains(SelectiveFailOpen.ipv4Prefix) || rest.contains(SelectiveFailOpen.ipv6Prefix)
        default:
            return false
        }
    }

    /// Whether an invocation can change state. Errs towards yes.
    static func mutates(path: String, arguments: [String]) -> Bool {
        let rest = Array(arguments.dropFirst())
        switch path {
        case "/sbin/pfctl":
            // Flags combine (`-nf`); `-n` only parses a file.
            let letters = Set(rest.filter { $0.hasPrefix("-") }.flatMap { $0.dropFirst() })
            if !letters.isDisjoint(with: Set("eEdXFkKTDx")) { return true }
            return letters.contains("f") && !letters.contains("n")
        case "/usr/sbin/networksetup":
            let readOnly = ["-get", "-list", "-print", "-help", "-version", "-is"]
            return rest.contains { argument in
                argument.hasPrefix("-") && !readOnly.contains(where: { argument.hasPrefix($0) })
            }
        case "/sbin/route":
            return rest.contains { ["add", "delete", "change", "flush"].contains($0) }
        default:
            return false
        }
    }

    struct Outcome {
        /// Components with no terminal basis: a writer that could change
        /// them is alive or could not be identified.
        var busy: Set<String> = []
        var stuck: [ReleaseAuthority.Incarnation] = []
        var failures: [String] = []
    }

    /// Ends every Tono command child (SIGKILL, then up to 2 s for each to be
    /// gone) and reports which components still have a live writer. Never
    /// ends this worker. `startedByWriters` are children a live writer had.
    static func end(startedByWriters known: Set<pid_t> = [],
                    processes: ReleaseProcesses = .live) -> Outcome {
        var outcome = Outcome()
        let me = getpid()
        guard let all = ReleaseProcessTable.listPIDs() else {
            outcome.busy = Set(allComponents)
            outcome.failures.append("The running processes could not be listed.")
            return outcome
        }
        var tono: [(ReleaseAuthority.Incarnation, [String])] = []
        var unidentified: [pid_t] = []
        for pid in all where pid != me {
            let state = ReleaseProcessTable.state(of: pid)
            if state == .gone { continue }
            guard let path = ReleaseProcessTable.path(of: pid) else {
                // An executable that cannot be read could be any of them, or
                // a Tono core whose file an upgrade replaced. A user's app
                // updated while it runs has no path either; when the kernel
                // shows it is neither root nor platform code it is neither,
                // and must not hold every component busy.
                if !ReleaseProcessTable.cannotWrite(pid),
                   ReleaseProcessTable.state(of: pid) != .gone { unidentified.append(pid) }
                continue
            }
            let verdict = classify(path: path, arguments: ReleaseProcessTable.arguments(of: pid),
                                   startedByWriter: known.contains(pid))
            switch verdict {
            case .unrelated:
                break
            case .tono(let components):
                guard case .alive(let found) = state else {
                    outcome.busy.formUnion(components)
                    outcome.failures.append("Tono command \(pid) could not be checked.")
                    continue
                }
                tono.append((found, components))
            case .foreign(let components), .unknown(let components):
                // One that exited meanwhile proves nothing either way.
                if ReleaseProcessTable.state(of: pid) != .gone { outcome.busy.formUnion(components) }
            }
        }
        if !unidentified.isEmpty {
            outcome.busy = Set(allComponents)
            outcome.failures.append("Process \(unidentified.map(String.init).joined(separator: ", ")) could not be identified.")
        }
        tono.forEach { processes.kill($0.0.pid) }
        let end = Date().addingTimeInterval(2)
        var remaining = tono
        while !remaining.isEmpty && Date() < end {
            usleep(50_000)
            remaining = remaining.filter { processes.liveness($0.0) != .gone }
        }
        for (child, components) in remaining {
            outcome.busy.formUnion(components)
            switch processes.liveness(child) {
            case .alive: outcome.stuck.append(child)
            case .unknown: outcome.failures.append("Tono command \(child.pid) could not be checked.")
            case .gone: break
            }
        }
        return outcome
    }
}

// MARK: - Cleanup and readback

enum ReleaseCleanup {
    static let componentNames = ["pf", "ai", "dns", "core"]

    static func cleanAndRead() -> [ReleaseReport.Component] {
        let uid = try? readAllowedUID()
        // A stale Core is stopped by the constructor; the writers above are
        // already gone, so this normally finds nothing. These are effects;
        // only the readback below is evidence.
        if let uid { _ = try? CoreManager(allowedUID: uid) }
        if let dns = try? ProtectedDNSManager() {
            _ = try? dns.restore(deferringLossNotice: true)
        }
        if let uid, let manager = try? KillSwitchManager(allowedUID: uid) {
            _ = try? manager.disarm(preserveAIHold: false)
        }
        return read()
    }

    static func read() -> [ReleaseReport.Component] {
        [readPF(), readAI(), readDNS(), readCore()]
    }

    private static func component(_ name: String, _ readback: String, _ detail: String? = nil) -> ReleaseReport.Component {
        .init(name: name, readback: readback, risk: "unknown", detail: detail)
    }

    static func readPF() -> ReleaseReport.Component {
        guard let live = try? KillSwitchManager.effectiveStatus() else {
            return component("pf", "unreadable", "PF status could not be read.")
        }
        if live { return component("pf", "residual", "Tono's block is still loaded.") }
        if KillSwitchManager.stateFileExists() { return component("pf", "residual", "Saved protection intent remains.") }
        return component("pf", "restored")
    }

    static func readAI() -> ReleaseReport.Component {
        if KillSwitchManager.selectiveRemovalPending() {
            return component("ai", "residual", "AI service hold removal is pending.")
        }
        do {
            if try KillSwitchManager.selectiveRecoveryDisposition() == true {
                return component("ai", "residual", "AI service hold is retained.")
            }
        } catch {
            return component("ai", "unreadable", "AI service hold state could not be read.")
        }
        return component("ai", "restored")
    }

    static func readDNS() -> ReleaseReport.Component {
        guard let manager = try? ProtectedDNSManager() else {
            return component("dns", "unreadable", "DNS state could not be opened.")
        }
        let status = manager.status()
        guard status["ok"] as? Bool == true else {
            return component("dns", status["snapshotPresent"] as? Bool == true ? "residual" : "unreadable",
                             "DNS status could not be read.")
        }
        if status["snapshotPresent"] as? Bool == true {
            return component("dns", "residual", "Saved DNS settings were not restored.")
        }
        guard let servers = globalDNSServers() else {
            return component("dns", "unreadable", "System DNS could not be read.")
        }
        if servers.contains("127.0.0.1") {
            return component("dns", "residual", "System DNS still points at Tono's stopped resolver.")
        }
        return component("dns", "restored")
    }

    /// The resolver configd actually applied, not the stored preference.
    static func globalDNSServers() -> [String]? {
        guard let store = SCDynamicStoreCreate(nil, "tono-release" as CFString, nil, nil) else { return nil }
        guard let value = SCDynamicStoreCopyValue(store, "State:/Network/Global/DNS" as CFString) as? [String: Any] else {
            // No global DNS at all (offline) is not Tono's resolver.
            return []
        }
        return value["ServerAddresses"] as? [String] ?? []
    }

    /// Whether any service of the current location stores Tono's resolver
    /// in the preferences file; nil when it cannot be read.
    ///
    /// DNS terminal basis (R-F1). `SCPreferencesCommitChanges` writes the
    /// preferences file synchronously, and configd applies what that file
    /// holds whenever `SCPreferencesApplyChanges` notifies it (configd-1405:
    /// SCPCommit.c, SCPApply.c, Plugins/PreferencesMonitor/prefsmon.c). Once
    /// no process that could commit is alive, the worker's own commit (or a
    /// dead writer's, already in the file) is the latest, and a later apply
    /// can only apply this file. So a clean file with no live writer is the
    /// last state configd can reach.
    static func storedDNSUsesTonoResolver() -> Bool? {
        guard let prefs = SCPreferencesCreate(nil, "tono-release" as CFString, nil),
              let currentSet = SCNetworkSetCopyCurrent(prefs),
              let services = SCNetworkSetCopyServices(currentSet) else { return nil }
        for index in 0..<CFArrayGetCount(services) {
            let service = unsafeBitCast(CFArrayGetValueAtIndex(services, index), to: SCNetworkService.self)
            guard let protocolRef = SCNetworkServiceCopyProtocol(service, kSCNetworkProtocolTypeDNS),
                  let configuration = SCNetworkProtocolGetConfiguration(protocolRef) as NSDictionary?,
                  let servers = configuration[kSCPropNetDNSServerAddresses] as? [String] else { continue }
            if servers.contains(ProtectedDNSContract.server) { return true }
        }
        return false
    }

    static func readCore() -> ReleaseReport.Component {
        guard let all = ReleaseProcessTable.listPIDs() else {
            return component("core", "unreadable", "The running processes could not be listed.")
        }
        let cores = all.filter {
            ReleaseProcessTable.path(of: $0) == "/Library/PrivilegedHelperTools/tono-sing-box"
        }
        if !cores.isEmpty {
            return component("core", "residual", "Tono's network core is still running (process \(cores.map(String.init).joined(separator: ", "))).")
        }
        return component("core", "restored")
    }
}

// MARK: - Spawning a worker

enum ReleaseSpawn {
    struct Running {
        let pid: pid_t
        let output: Int32
    }

    /// Starts `executable --release-worker` as a new session leader with only
    /// stdin/stdout connected, and writes the request to its stdin.
    static func worker(executable: String, request: ReleaseWorker.Request) throws -> Running {
        var input: [Int32] = [-1, -1]
        var output: [Int32] = [-1, -1]
        guard pipe(&input) == 0 else { throw HelperFailure.system("Release pipe unavailable.") }
        guard pipe(&output) == 0 else {
            close(input[0]); close(input[1])
            throw HelperFailure.system("Release pipe unavailable.")
        }
        for fd in input + output { _ = fcntl(fd, F_SETFD, FD_CLOEXEC) }
        var actions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_adddup2(&actions, input[0], 0)
        posix_spawn_file_actions_adddup2(&actions, output[1], 1)
        posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0)
        var attributes: posix_spawnattr_t?
        posix_spawnattr_init(&attributes)
        defer { posix_spawnattr_destroy(&attributes) }
        posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETSID | POSIX_SPAWN_CLOEXEC_DEFAULT))
        let argv: [UnsafeMutablePointer<CChar>?] = [strdup(executable), strdup("--release-worker"), nil]
        let environment: [UnsafeMutablePointer<CChar>?] = [strdup("PATH=/usr/bin:/bin:/usr/sbin:/sbin"), nil]
        defer {
            argv.forEach { free($0) }
            environment.forEach { free($0) }
        }
        var pid: pid_t = 0
        let status = posix_spawn(&pid, executable, &actions, &attributes, argv, environment)
        close(input[0])
        close(output[1])
        guard status == 0 else {
            close(input[1]); close(output[0])
            throw HelperFailure.system("Release worker could not start (\(status)).")
        }
        var body = (try? JSONEncoder().encode(request)) ?? Data("{}".utf8)
        body.append(0x0A)
        body.withUnsafeBytes { buffer in
            if let base = buffer.baseAddress { try? writeAll(input[1], bytes: base, count: buffer.count) }
        }
        close(input[1])
        return Running(pid: pid, output: output[0])
    }
}

/// One running worker, shared by every request that arrives while it runs.
final class ReleaseRun: @unchecked Sendable {
    let pid: pid_t
    private let condition = NSCondition()
    private var latest: Data?
    private var ended = false

    /// `onEnd` runs once the worker has exited and been reaped, however it
    /// ended (a normal exit, the hard-cap `_exit`, or a crash).
    init(_ running: ReleaseSpawn.Running, onEnd: @escaping @Sendable () -> Void = {}) {
        pid = running.pid
        let fd = running.output
        Thread.detachNewThread { [self] in
            var pending = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = Darwin.read(fd, &buffer, buffer.count)
                if count < 0, errno == EINTR { continue }
                if count <= 0 { break }
                pending.append(contentsOf: buffer.prefix(count))
                while let newline = pending.firstIndex(of: 0x0A) {
                    let line = Data(pending[pending.startIndex..<newline])
                    pending.removeSubrange(pending.startIndex...newline)
                    condition.lock()
                    latest = line
                    condition.broadcast()
                    condition.unlock()
                }
                if pending.count > 256 * 1024 { pending.removeAll() }
            }
            close(fd)
            var status: Int32 = 0
            while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
            condition.lock()
            ended = true
            condition.broadcast()
            condition.unlock()
            onEnd()
        }
    }

    var isRunning: Bool {
        condition.lock()
        defer { condition.unlock() }
        return !ended
    }

    /// The latest report line, waiting at most until `deadline`. A worker
    /// that never answered is reported as unknown, never as restored.
    func answer(before deadline: Date) -> Data {
        condition.lock()
        defer { condition.unlock() }
        while latest == nil && !ended {
            guard condition.wait(until: deadline) else { break }
        }
        if let latest { return latest }
        let detail = ended ? "The restore worker ended without a report." : "The restore worker did not answer in time."
        return ReleaseReport.refusal("unknown", detail: detail).json()
    }
}

// MARK: - The release job

/// `tono-release --release-daemon`: the KeepAlive job the app connects to.
final class ReleaseDaemon {
    private let allowedUID: uid_t
    private let authorizer: TonoPeerAuthorizer
    private var serverFD: Int32 = -1
    private let lock = NSLock()
    private var current: ReleaseRun?
    private let executable: String
    private var recoveryRunning = false
    private var recoveryRequests = 0

    init() throws {
        guard geteuid() == 0 else { throw HelperFailure.invalid("The release service must run as root.") }
        allowedUID = try readAllowedUID()
        authorizer = try TonoPeerAuthorizer(allowedUID: allowedUID)
        executable = ReleaseProcessTable.path(of: getpid()) ?? ReleaseService.binaryPath
        try setupSocket()
    }

    private func setupSocket() throws {
        try removeIfPresent(ReleaseService.socketPath, requiredType: mode_t(S_IFSOCK), allowedOwner: allowedUID)
        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { throw HelperFailure.system("Could not create release socket.") }
        _ = fcntl(serverFD, F_SETFD, FD_CLOEXEC)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let copied = ReleaseService.socketPath.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) { tuple in
                tuple.withMemoryRebound(to: CChar.self, capacity: 104) { strlcpy($0, source, 104) }
            }
        }
        guard copied < 104 else { throw HelperFailure.invalid("Release socket path is too long.") }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(serverFD, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        let group = try allowedGroup(for: allowedUID)
        guard bound == 0,
              chown(ReleaseService.socketPath, allowedUID, group) == 0,
              chmod(ReleaseService.socketPath, 0o600) == 0,
              listen(serverFD, 16) == 0 else {
            throw HelperFailure.system("Could not secure release socket.")
        }
    }

    func run() {
        // A worker that died (crash, hard cap) before putting the daemon
        // back, or a release job restarted meanwhile (R-F6).
        scheduleRecovery()
        while helperShutdownRequested == 0 {
            var descriptor = pollfd(fd: serverFD, events: Int16(POLLIN), revents: 0)
            let ready = poll(&descriptor, 1, 1_000)
            if ready <= 0 { continue }
            let client = accept(serverFD, nil, nil)
            if client < 0 { continue }
            _ = fcntl(client, F_SETFD, FD_CLOEXEC)
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                handle(client)
                close(client)
            }
        }
        close(serverFD)
        unlink(ReleaseService.socketPath)
    }

    private func handle(_ client: Int32) {
        var timeout = timeval(tv_sec: 3, tv_usec: 0)
        _ = withUnsafePointer(to: &timeout) {
            setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }
        guard authorizer.accepts(socket: client) else {
            sendResponse(client, status: 403, object: ["ok": false, "error": "Forbidden."])
            return
        }
        do {
            let request = try readRequest(client)
            switch (request.method, request.path) {
            case ("POST", "/release"):
                let object = try jsonObject(request.body)
                guard let requestID = object["requestID"] as? String, !requestID.isEmpty, requestID.count <= 64 else {
                    throw HelperFailure.invalid("Invalid release request.")
                }
                let expected = (object["expectedGeneration"] as? NSNumber)?.uint64Value
                let run = try startOrJoin(.init(requestID: requestID, expectedGeneration: expected))
                let answer = run.answer(before: Date().addingTimeInterval(ReleaseService.serviceAnswerDeadline))
                sendRaw(client, body: answer)
            case ("GET", "/release/status"):
                sendResponse(client, status: 200, object: statusObject())
            default:
                sendResponse(client, status: 404, object: ["ok": false, "error": "Not found."])
            }
        } catch let failure as HelperFailure {
            sendResponse(client, status: 400, object: ["ok": false, "error": failure.message])
        } catch {
            sendResponse(client, status: 500, object: ["ok": false, "error": "Internal release error."])
        }
    }

    /// A Restore pressed again while one runs joins it instead of starting a
    /// second worker that would only find C busy.
    private func startOrJoin(_ request: ReleaseWorker.Request) throws -> ReleaseRun {
        lock.lock()
        defer { lock.unlock() }
        if let current, current.isRunning { return current }
        let run = ReleaseRun(try ReleaseSpawn.worker(executable: executable, request: request)) { [weak self] in
            self?.scheduleRecovery()
        }
        current = run
        return run
    }

    /// Runs `ReleaseQuarantine.recover` until it reports clear, retrying a
    /// pending one every 15 s. A request that arrives while it runs makes it
    /// check again, so a worker that ends meanwhile is never missed.
    private func scheduleRecovery() {
        lock.lock()
        recoveryRequests += 1
        let start = !recoveryRunning
        recoveryRunning = true
        lock.unlock()
        guard start else { return }
        Thread.detachNewThread { [self] in
            while true {
                lock.lock()
                let seen = recoveryRequests
                lock.unlock()
                let result = ReleaseQuarantine.recover()
                lock.lock()
                if (result == .clear && recoveryRequests == seen) || helperShutdownRequested != 0 {
                    recoveryRunning = false
                    lock.unlock()
                    return
                }
                lock.unlock()
                if result != .clear { Thread.sleep(forTimeInterval: 15) }
            }
        }
    }

    private func statusObject() -> [String: Any] {
        lock.lock()
        let running = current?.isRunning == true
        lock.unlock()
        var object: [String: Any] = ["ok": true, "running": running, "version": helperVersion]
        if let record = try? ReleaseAuthority().load() {
            object["mode"] = record.mode.rawValue
            object["generation"] = NSNumber(value: record.generation)
            if record.daemonBootedOut == true { object["helperQuarantined"] = true }
            if let failure = record.daemonRecoveryFailure { object["helperRecoveryFailure"] = failure }
        } else {
            object["mode"] = "unknown"
        }
        return object
    }

    private func sendRaw(_ fd: Int32, body: Data) {
        var response = Data(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8
        )
        response.append(body)
        response.withUnsafeBytes { buffer in
            if let base = buffer.baseAddress { try? writeAll(fd, bytes: base, count: buffer.count) }
        }
    }

    static func runMain() -> Int32 {
        do {
            try ReleaseDaemon().run()
            return 0
        } catch {
            return 1
        }
    }
}

// MARK: - Administrator command

/// `sudo tono-core-helper --release`: the same worker, started the same way.
/// It reports busy instead of stopping a holder of C.
func runReleaseCommand() -> Int32 {
    guard geteuid() == 0 else {
        fputs("Tono restore must be run with sudo.\n", stderr)
        return 1
    }
    let executable = ReleaseProcessTable.path(of: getpid()) ?? CommandLine.arguments[0]
    do {
        let run = ReleaseRun(try ReleaseSpawn.worker(
            executable: executable,
            request: .init(requestID: "cli-" + UUID().uuidString.prefix(8), expectedGeneration: nil)
        ))
        // The command waits for the final line, not only the first answer.
        let deadline = Date().addingTimeInterval(ReleaseService.hardDeadline + 5)
        var answer = run.answer(before: deadline)
        while run.isRunning && Date() < deadline {
            usleep(200_000)
            answer = run.answer(before: deadline)
        }
        FileHandle.standardOutput.write(answer)
        FileHandle.standardOutput.write(Data("\n".utf8))
        let report = try? JSONDecoder().decode(ReleaseReport.self, from: answer)
        return report?.outcome == "restored" ? 0 : 1
    } catch {
        fputs("Tono restore could not start: \(error)\n", stderr)
        return 1
    }
}

/// `--emergency-disarm` and `--emergency-reset` against the release lock C
/// (R-M2). Two cases, kept apart on purpose:
///
/// - C is free within 3 s: the command runs under C as a release. Before
///   any effect the record is written released with a bumped generation, so
///   every earlier session's requests go stale, and every component is
///   unsettled because the command reads nothing back: Connect then waits
///   for a Restore internet that proves the network settled.
/// - C stays busy or unusable: manual break-glass. The command runs its
///   effect without C and does not touch the record. It is outside the
///   preemptive-release guarantee; an administrator chose it.
func runEmergencyUnderReleaseAuthority(
    authority: ReleaseAuthority = ReleaseAuthority(),
    _ body: () -> Bool
) -> Bool {
    // Both commands refuse without root themselves.
    guard geteuid() == 0 else { return body() }
    do {
        return try authority.withLock(timeout: 3) { _ -> Bool in
            let currentBoot = try? TonoAuthenticatedPeer.bootSession()
            var record: ReleaseAuthority.Record
            do { record = try authority.load() } catch ReleaseAuthority.Failure.corrupt {
                record = ReleaseAuthority.Record()
                record.historyLostBoot = currentBoot ?? ""
            }
            record.generation = ReleaseAuthority.nextGeneration(after: record.generation)
            record.mode = .released
            record.requestID = "emergency"
            record.unsettled = ReleaseCleanup.componentNames
            do {
                try authority.save(record)
            } catch {
                fputs("Tono could not record the emergency release (\(error)); continuing as manual break-glass.\n", stderr)
            }
            return body()
        }
    } catch {
        fputs("Tono's restore lock is busy or unavailable (\(error)); running as manual break-glass without updating the restore record.\n", stderr)
        return body()
    }
}

// MARK: - Installation of the release job

/// The helper daemon installs the release job from its own executable, so
/// every way a helper arrives (app install, silent upgrade, native update)
/// also brings the matching release job. A rolled-back helper that predates
/// this leaves the newer release job in place.
enum ReleaseInstaller {
    static func plistData() -> Data? {
        let plist: [String: Any] = [
            "Label": ReleaseService.label,
            "ProgramArguments": [ReleaseService.binaryPath, "--release-daemon"],
            "AssociatedBundleIdentifiers": ["com.raydocs.tono"],
            "RunAtLoad": true,
            "KeepAlive": true,
            "ProcessType": "Interactive",
            "StandardOutPath": "/dev/null",
            "StandardErrorPath": "/dev/null",
        ]
        return try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
    }

    static func ensureInstalled(source: String = "/Library/PrivilegedHelperTools/tono-core-helper",
                                authority: ReleaseAuthority = ReleaseAuthority()) {
        guard geteuid() == 0, let plist = plistData(),
              let wanted = try? UpdateStorage.fileDigest(source) else { return }
        let binaryCurrent = (try? UpdateStorage.fileDigest(ReleaseService.binaryPath)) == wanted
        let plistCurrent = FileManager.default.contents(atPath: ReleaseService.plistPath) == plist
        let loaded = (try? KillSwitchManager.run("/bin/launchctl", ["print", "system/" + ReleaseService.label], deadline: 3))?.status == 0
        if binaryCurrent && plistCurrent && loaded { return }
        // Never replace the release job while a release holds C.
        _ = try? authority.withLock(timeout: 0) { _ in
            if !binaryCurrent {
                let temporary = ReleaseService.binaryPath + ".new"
                unlink(temporary)
                guard (try? FileManager.default.copyItem(atPath: source, toPath: temporary)) != nil,
                      chown(temporary, 0, 0) == 0, chmod(temporary, 0o755) == 0,
                      (try? UpdateStorage.fileDigest(temporary)) == wanted,
                      rename(temporary, ReleaseService.binaryPath) == 0 else {
                    unlink(temporary)
                    return
                }
            }
            if !plistCurrent {
                let temporary = ReleaseService.plistPath + ".new"
                unlink(temporary)
                guard FileManager.default.createFile(atPath: temporary, contents: plist),
                      chown(temporary, 0, 0) == 0, chmod(temporary, 0o644) == 0,
                      rename(temporary, ReleaseService.plistPath) == 0 else {
                    unlink(temporary)
                    return
                }
            }
            _ = try? KillSwitchManager.run("/bin/launchctl", ["bootout", "system/" + ReleaseService.label], deadline: 5)
            _ = try? KillSwitchManager.run("/bin/launchctl", ["bootstrap", "system", ReleaseService.plistPath], deadline: 5)
        }
    }

    /// Part of every helper removal.
    static func remove() {
        _ = try? KillSwitchManager.run("/bin/launchctl", ["bootout", "system/" + ReleaseService.label], deadline: 5)
        unlink(ReleaseService.plistPath)
        unlink(ReleaseService.binaryPath)
        unlink(ReleaseService.socketPath)
    }
}
