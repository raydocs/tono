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

    /// `restored` only when every component reads back clean, nothing that
    /// could still change the network is left, and the worker finished.
    static func outcome(components: [Component], stuck: [Int32], finished: Bool) -> String {
        if !finished || !stuck.isEmpty { return "unknown" }
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

        /// Writes the current report. Unfinished components and an
        /// unfinished worker make the outcome unknown, never restored.
        func emit(finished: Bool) {
            lock.lock()
            defer { lock.unlock() }
            var line = report
            line.finished = finished
            if line.outcome != "busy" && line.outcome != "superseded" {
                line.outcome = ReleaseReport.outcome(components: line.components, stuck: line.stuck, finished: finished)
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
            reporter.update {
                $0.detail = "Restore could not record its progress: \(error)"
            }
            reporter.emit(finished: true)
            restoreDaemonIfBootedOut()
            return 1
        }
        // After C is released: the daemon waits for C at start, so starting
        // it while holding C would only delay it.
        restoreDaemonIfBootedOut()
        reporter.emit(finished: true)
        return outcome
    }

    /// At the answer deadline the app gets the state as it is, with every
    /// unfinished step unknown. At the hard deadline the worker ends its own
    /// session, so nothing it started outlives it unrecorded.
    private static func startWatchdog(_ reporter: Reporter) {
        Thread.detachNewThread {
            Thread.sleep(forTimeInterval: ReleaseService.answerDeadline)
            reporter.emit(finished: false)
            Thread.sleep(forTimeInterval: ReleaseService.hardDeadline - ReleaseService.answerDeadline)
            reporter.update { $0.detail = "Restore stopped at its time limit." }
            reporter.emit(finished: false)
            let me = getpid()
            for member in ReleaseProcessTable.sessionMembers(getsid(0)) where member != me {
                kill(member, SIGKILL)
            }
            _exit(3)
        }
    }

    private static func releaseLocked(request: ReleaseWorker.Request, authority: ReleaseAuthority, reporter: Reporter) throws -> Int32 {
        var record: ReleaseAuthority.Record
        var recordWasCorrupt = false
        do { record = try authority.load() } catch ReleaseAuthority.Failure.corrupt {
            // Unreadable history is not a reason to keep the user offline.
            // The new generation is clock-based, so it still exceeds any
            // generation an earlier session could carry.
            record = ReleaseAuthority.Record()
            recordWasCorrupt = true
        }
        if let expected = request.expectedGeneration, record.mode == .secured, record.generation != expected {
            reporter.update { $0 = .refusal("superseded", detail: "A newer connection replaced the session this restore was for.", generation: record.generation) }
            return 0
        }
        if record.mode == .secured || recordWasCorrupt {
            record.generation = ReleaseAuthority.nextGeneration(after: record.generation)
        }
        record.mode = .released
        record.requestID = String(request.requestID.prefix(64))
        guard let me = ReleaseProcessTable.incarnation(of: getpid()) else {
            throw ReleaseAuthority.Failure.io("Worker identity is unreadable.")
        }
        record.worker = me
        record.workerBootSession = try? TonoAuthenticatedPeer.bootSession()
        record.workerFinished = false
        // Durable before any effect: a crash from here on leaves a record
        // that names this worker's session.
        try authority.save(record)
        let generation = record.generation
        reporter.update { $0.generation = generation }

        // 1. Launch quarantine and termination of every old writer.
        let executorWasInstalled = FileManager.default.fileExists(atPath: UpdateExecutor.plist)
        let stuck = ReleaseStop.stopWriters()
        record.stuck = stuck
        record.executorQuarantined = record.executorQuarantined || executorWasInstalled
        try authority.save(record)
        reporter.update { $0.stuck = stuck.map(\.pid) }

        // 2. A pending native update must not resume its own teardown or
        //    re-arm when its executor comes back.
        ReleaseStop.markUpdateDisconnectRequested()

        // 3. Cleanup and per-component readback, twice with a pause, and one
        //    more cleanup round when the second read disagrees.
        var components = ReleaseCleanup.cleanAndRead()
        reporter.update { $0.components = components }
        Thread.sleep(forTimeInterval: 1)
        var second = ReleaseCleanup.read()
        if second.contains(where: { $0.readback != "restored" }) {
            components = ReleaseCleanup.cleanAndRead()
            Thread.sleep(forTimeInterval: 1)
            second = ReleaseCleanup.read()
        }
        let settled = second.map { component -> ReleaseReport.Component in
            var copy = component
            let first = components.first { $0.name == component.name }
            copy.risk = (first?.readback == component.readback && stuck.isEmpty) ? "settled" : "unknown"
            return copy
        }
        reporter.update { $0.components = settled }

        record.workerFinished = true
        try authority.save(record)
        return 0
    }

    /// Puts the helper daemon back so the app keeps working. The update
    /// executor stays quarantined until the next admitted Connect.
    static func restoreDaemonIfBootedOut() {
        guard FileManager.default.fileExists(atPath: ReleaseService.daemonPlist) else { return }
        if (try? KillSwitchManager.run("/bin/launchctl", ["print", "system/" + ReleaseService.daemonLabel], deadline: 3))?.status == 0 {
            return
        }
        _ = try? KillSwitchManager.run("/bin/launchctl", ["bootstrap", "system", ReleaseService.daemonPlist], deadline: 5)
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

    static func writerPIDs() -> [pid_t] {
        let me = getpid()
        let mySession = getsid(0)
        return ReleaseProcessTable.allPIDs().filter { pid in
            guard pid != me, getsid(pid) != mySession,
                  let path = ReleaseProcessTable.path(of: pid) else { return false }
            return isWriter(path: path)
        }
    }

    /// Boots out the daemon and the update executor so launchd cannot start
    /// them again during the release, and SIGKILLs every writer. Returns the
    /// writers that are still alive afterwards; they keep Connect blocked.
    static func stopWriters() -> [ReleaseAuthority.Incarnation] {
        let bootouts = DispatchGroup()
        for label in [ReleaseService.daemonLabel, UpdateExecutor.label] {
            DispatchQueue.global(qos: .userInitiated).async(group: bootouts) {
                _ = try? KillSwitchManager.run("/bin/launchctl", ["bootout", "system/" + label], deadline: 4)
            }
        }
        // A KeepAlive restart can land between the kill and the bootout.
        for _ in 0..<3 {
            writerPIDs().forEach { kill($0, SIGKILL) }
            usleep(300_000)
        }
        _ = bootouts.wait(timeout: .now() + 5)
        let end = Date().addingTimeInterval(3)
        var remaining = writerPIDs()
        while !remaining.isEmpty && Date() < end {
            remaining.forEach { kill($0, SIGKILL) }
            usleep(100_000)
            remaining = writerPIDs()
        }
        return remaining.compactMap(ReleaseProcessTable.incarnation(of:))
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

// MARK: - Cleanup and readback

enum ReleaseCleanup {
    static func cleanAndRead() -> [ReleaseReport.Component] {
        let uid = try? readAllowedUID()
        // A stale Core is stopped by the constructor; the writers above are
        // already gone, so this normally finds nothing.
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

    static func readCore() -> ReleaseReport.Component {
        let cores = ReleaseProcessTable.allPIDs().filter {
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

    init(_ running: ReleaseSpawn.Running) {
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
        let run = ReleaseRun(try ReleaseSpawn.worker(executable: executable, request: request))
        current = run
        return run
    }

    private func statusObject() -> [String: Any] {
        lock.lock()
        let running = current?.isRunning == true
        lock.unlock()
        var object: [String: Any] = ["ok": true, "running": running, "version": helperVersion]
        if let record = try? ReleaseAuthority().load() {
            object["mode"] = record.mode.rawValue
            object["generation"] = NSNumber(value: record.generation)
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
