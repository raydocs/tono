import Foundation
import Darwin

/// The machine-level release authority C (PROPOSAL §10 v5, IMPLEMENTATION.md).
///
/// One fixed lock file serialises every release, every Connect admission and
/// every change of the durable release record. The lock file is never renamed
/// or unlinked; the record is a separate file replaced atomically. A holder
/// that dies only releases the lock: the record still names the release
/// worker, and nothing is retired until that worker's whole session is gone.
struct ReleaseAuthority {
    static let liveDirectory = "/Library/Application Support/Tono"

    let directory: String
    /// Root in production. Self-tests running under sudo use 0 as well.
    let owner: uid_t

    init(directory: String = ReleaseAuthority.liveDirectory, owner: uid_t = 0) {
        self.directory = directory
        self.owner = owner
    }

    var lockPath: String { directory + "/release.lock" }
    var recordPath: String { directory + "/release-state.json" }

    enum Mode: String, Codable { case secured, released }

    /// A process incarnation: a pid alone is reused by the kernel.
    struct Incarnation: Codable, Equatable {
        let pid: Int32
        let startSeconds: UInt64
        let startMicroseconds: UInt64
    }

    struct Record: Codable, Equatable {
        var schema: Int = 1
        var mode: Mode = .secured
        var generation: UInt64 = 0
        var requestID: String?
        /// The worker of the latest release. Its session (`setsid`) holds
        /// every effect the release ran; the release slot is retired only
        /// when that session is empty.
        var worker: Incarnation?
        var workerBootSession: String?
        var workerFinished: Bool = true
        /// Tono processes that survived SIGKILL during the release.
        var stuck: [Incarnation] = []
        /// The update executor job was booted out by the release and is put
        /// back only by the next admitted Connect.
        var executorQuarantined: Bool = false
        // The fields below are optional so a record written before them
        // still decodes instead of reading as corrupt.
        /// Session and process group of `worker`. Both equal its pid: the
        /// worker starts as a session leader.
        var workerSession: Int32?
        var workerGroup: Int32?
        /// Workers of earlier releases that were not yet proven gone with an
        /// empty session when a newer release replaced `worker` (R-F2).
        var earlier: [Slot]?
        /// Components whose late-change risk the latest release could not
        /// retire (R-F1). They keep Connect refused in this boot.
        var unsettled: [String]?
        /// A corrupt record was replaced in this boot session ("" when the
        /// boot could not be read). The lost history may have named running
        /// work, so admission stays refused for the rest of that boot.
        var historyLostBoot: String?
        /// The helper daemon was booted out by a release and is not yet
        /// proven loaded again (R-F6).
        var daemonBootedOut: Bool?
        var daemonRecoveryFailure: String?
        /// Strict intent survives daemon death and reboot. Admission cannot
        /// downgrade it; only the authenticated release worker retires it.
        var strictRuntimeDigest: String?
        var strictIntent: Bool { mode == .secured && strictRuntimeDigest != nil }
    }

    /// One release worker and the session/process group it ran its effects in.
    struct Slot: Codable, Equatable {
        let worker: Incarnation
        let session: Int32
        let group: Int32
        let bootSession: String?
    }

    /// Only two readable, different boot sessions prove a reboot in between.
    /// A missing identity on either side counts as the same boot, so it can
    /// never skip a check (R-F2).
    static func sameBoot(_ recorded: String?, _ current: String?) -> Bool {
        guard let recorded, !recorded.isEmpty, let current, !current.isEmpty else { return true }
        return recorded == current
    }

    enum Failure: Error, Equatable {
        /// C is held by someone else for longer than the caller may wait.
        case busy
        /// The record exists but cannot be trusted. Never auto-retired.
        case corrupt
        case unsafe(String)
        case io(String)
    }

    // MARK: - Lock

    /// Runs `body` while holding C. Waits at most `timeout` seconds and never
    /// terminates or touches a holder that does not let go (E-F5-v4-F1).
    func withLock<T>(timeout: TimeInterval, _ body: (Int32) throws -> T) throws -> T {
        try ensureDirectory()
        let fd = open(lockPath, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw Failure.io("Release lock is unavailable.") }
        defer { close(fd) }
        var opened = stat()
        var linked = stat()
        guard fstat(fd, &opened) == 0,
              lstat(lockPath, &linked) == 0,
              opened.st_dev == linked.st_dev, opened.st_ino == linked.st_ino,
              opened.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              opened.st_uid == owner,
              opened.st_mode & 0o077 == 0,
              opened.st_nlink == 1 else {
            throw Failure.unsafe("Release lock changed or is unsafe.")
        }
        let end = Date().addingTimeInterval(max(0, timeout))
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR else {
                throw Failure.io("Release lock failed.")
            }
            guard Date() < end else { throw Failure.busy }
            usleep(20_000)
        }
        defer { flock(fd, LOCK_UN) }
        return try body(fd)
    }

    /// True while another process holds C. Never blocks.
    func lockHeldElsewhere() -> Bool {
        do {
            return try withLock(timeout: 0) { _ in false }
        } catch Failure.busy {
            return true
        } catch {
            return false
        }
    }

    private func ensureDirectory() throws {
        var metadata = stat()
        if lstat(directory, &metadata) != 0 {
            guard errno == ENOENT, mkdir(directory, 0o700) == 0 else {
                throw Failure.io("Release directory is unavailable.")
            }
            guard lstat(directory, &metadata) == 0 else {
                throw Failure.io("Release directory is unavailable.")
            }
        }
        guard metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              metadata.st_uid == owner,
              metadata.st_mode & 0o022 == 0 else {
            throw Failure.unsafe("Release directory is unsafe.")
        }
    }

    // MARK: - Record

    /// Missing means the machine never ran a release: secured, generation 0.
    func load() throws -> Record {
        var metadata = stat()
        if lstat(recordPath, &metadata) != 0 {
            guard errno == ENOENT else { throw Failure.io("Release record is unreadable.") }
            return Record()
        }
        guard metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              metadata.st_uid == owner,
              metadata.st_mode & 0o077 == 0,
              metadata.st_size <= 64 * 1024 else {
            throw Failure.corrupt
        }
        guard let data = FileManager.default.contents(atPath: recordPath),
              let record = try? JSONDecoder().decode(Record.self, from: data),
              record.schema == 1 else {
            throw Failure.corrupt
        }
        return record
    }

    /// Atomic and durable: temporary file, full fsync, rename, directory
    /// fsync. A failure is an uncertain write and stops the caller.
    func save(_ record: Record) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(record) else { throw Failure.io("Release record encoding failed.") }
        let temporary = recordPath + ".new." + String(getpid())
        unlink(temporary)
        let fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw Failure.io("Release record could not be written.") }
        var renamed = false
        defer {
            close(fd)
            if !renamed { unlink(temporary) }
        }
        try data.withUnsafeBytes { buffer in
            if let base = buffer.baseAddress { try writeAll(fd, bytes: base, count: buffer.count) }
        }
        guard fchown(fd, owner, 0) == 0, fchmod(fd, 0o600) == 0,
              fsync(fd) == 0, fcntl(fd, F_FULLFSYNC) == 0 else {
            throw Failure.io("Release record was not durably written.")
        }
        guard rename(temporary, recordPath) == 0 else {
            throw Failure.io("Release record was not committed.")
        }
        renamed = true
        let directoryFD = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directoryFD >= 0 else { throw Failure.io("Release directory could not be synced.") }
        defer { close(directoryFD) }
        guard fsync(directoryFD) == 0 else { throw Failure.io("Release directory could not be synced.") }
    }

    /// Monotonic and never below wall-clock milliseconds, so a record lost to
    /// corruption still yields a generation above any earlier session's.
    static func nextGeneration(after previous: UInt64, now: Date = Date()) -> UInt64 {
        let clock = UInt64(max(0, now.timeIntervalSince1970 * 1_000))
        return max(previous &+ 1, clock)
    }

    // MARK: - Admission

    enum AdmissionRefusal: Error, Equatable {
        case releaseInProgress
        case releaseUnfinished(String)
        case recordCorrupt
        case staleGeneration
        case unavailable(String)

        var code: String {
            switch self {
            case .releaseInProgress: "RELEASE_IN_PROGRESS"
            case .releaseUnfinished: "RELEASE_UNFINISHED"
            case .recordCorrupt: "RELEASE_RECORD_CORRUPT"
            case .staleGeneration: "STALE_GENERATION"
            case .unavailable: "RELEASE_STATE_UNAVAILABLE"
            }
        }

        var message: String {
            switch self {
            case .releaseInProgress:
                "Restore internet is still running. Connect is available when it finishes."
            case .releaseUnfinished(let detail):
                "An earlier Restore internet has not finished: \(detail)"
            case .recordCorrupt:
                "Tono's restore record is unreadable. Choose Restore internet once, then restart the Mac before connecting."
            case .staleGeneration:
                "Tono's connection state changed while this request was on its way. Choose Connect again."
            case .unavailable(let detail):
                "Tono could not check the restore record: \(detail)"
            }
        }
    }

    /// Connect admission (§10.2 rule 2), a compare-and-swap under C: the
    /// caller read `expectedGeneration` just before, and the generation moves
    /// on only if nothing changed it in between (R-F3). Returns the session
    /// generation the caller must carry on every privileged request.
    ///
    /// A caller without an expected generation (an app that predates this
    /// check) keeps the old behaviour on a secured machine and is never
    /// admitted across a release.
    func admit(
        expectedGeneration: UInt64? = nil,
        lockTimeout: TimeInterval = 1.5,
        processes: ReleaseProcesses = .live,
        restoreExecutor: () -> Void = {}
    ) throws -> UInt64 {
        do {
            return try withLock(timeout: lockTimeout) { _ -> UInt64 in
                var record: Record
                do { record = try load() } catch Failure.corrupt { throw AdmissionRefusal.recordCorrupt }
                guard let expectedGeneration else {
                    if record.mode == .secured { return record.generation }
                    throw AdmissionRefusal.staleGeneration
                }
                guard expectedGeneration == record.generation else { throw AdmissionRefusal.staleGeneration }
                let wasReleased = record.mode == .released
                if wasReleased, let reason = processes.unretiredReason(record) {
                    throw AdmissionRefusal.releaseUnfinished(reason)
                }
                if wasReleased { record.strictRuntimeDigest = nil }
                record.mode = .secured
                record.generation = Self.nextGeneration(after: record.generation)
                var executorWasQuarantined = false
                if wasReleased {
                    record.worker = nil
                    record.workerBootSession = nil
                    record.workerSession = nil
                    record.workerGroup = nil
                    record.workerFinished = true
                    record.stuck = []
                    record.earlier = nil
                    record.unsettled = nil
                    record.historyLostBoot = nil
                    // The daemon answering this admission is loaded.
                    record.daemonBootedOut = nil
                    record.daemonRecoveryFailure = nil
                    executorWasQuarantined = record.executorQuarantined
                    record.executorQuarantined = false
                }
                try save(record)
                if executorWasQuarantined { restoreExecutor() }
                return record.generation
            }
        } catch Failure.busy {
            throw AdmissionRefusal.releaseInProgress
        } catch let refusal as AdmissionRefusal {
            throw refusal
        } catch {
            throw AdmissionRefusal.unavailable(String(describing: error))
        }
    }

    /// Called only after validation of the root snapshot and its bounded graph.
    func bindRuntime(generation: UInt64, digest: String, strict: Bool, requestedMode: String?) throws {
        try withLock(timeout: 1.5) { _ in
            var record = try load()
            guard requestedMode == nil || requestedMode == (strict ? "three-tier" : "stable"),
                  generation == record.generation, record.mode == .secured,
                  record.strictRuntimeDigest == nil || (strict && record.strictRuntimeDigest == digest) else {
                throw Failure.unsafe("Routing mode/runtime mismatch or strict session downgrade. Explicitly disconnect first.")
            }
            if strict { record.strictRuntimeDigest = digest }
            try save(record)
        }
    }

    /// What a privileged request carrying `generation` may do now. The
    /// daemon decides under C (`SocketServer.enforceSessionGeneration`).
    enum RequestKind { case protective, releasing }

    enum GenerationVerdict: Equatable {
        case allowed
        /// No generation where one is required: a protective request on a
        /// released machine, or any release-direction request. Refused;
        /// nothing is admitted implicitly (R-F3, R-F4).
        case needsAdmission
        case stale
    }

    static func verdict(record: Record, generation: UInt64?, kind: RequestKind) -> GenerationVerdict {
        guard let generation else {
            // Only what apps before admission sent: a protective request on
            // a secured machine.
            return kind == .protective && record.mode == .secured ? .allowed : .needsAdmission
        }
        guard generation == record.generation else { return .stale }
        // A released machine has no admitted session. Arming it waits for an
        // admission, which moves the generation on; a teardown that names
        // the current generation is harmless.
        return kind == .protective && record.mode == .released ? .stale : .allowed
    }
}

/// Process inspection used to decide whether a release slot can retire.
/// Every read is typed: a failed inspection is `unknown`, which blocks like
/// a live process and is never taken as gone (R-F2).
struct ReleaseProcesses {
    var state: (pid_t) -> ReleaseProcessTable.State
    /// Live members of a session or process group; nil when the process
    /// table could not be read.
    var groupMembers: (_ session: pid_t, _ group: pid_t) -> [pid_t]?
    var bootSession: () -> String?
    var kill: (pid_t) -> Void

    static let live = ReleaseProcesses(
        state: { ReleaseProcessTable.state(of: $0) },
        groupMembers: { ReleaseProcessTable.members(session: $0, group: $1) },
        bootSession: { try? TonoAuthenticatedPeer.bootSession() },
        kill: { _ = Darwin.kill($0, SIGKILL) }
    )

    enum Liveness: Equatable { case alive, gone, unknown }

    func liveness(_ recorded: ReleaseAuthority.Incarnation) -> Liveness {
        switch state(recorded.pid) {
        case .alive(let found): return found == recorded ? .alive : .gone
        case .gone: return .gone
        case .unknown: return .unknown
        }
    }

    /// Nil when `slot`'s worker is gone and nothing is left in its session
    /// or process group. What is left is that release's own work: it is
    /// ended here, because no session can have been admitted after it. A
    /// live leader with another start time is a reused pid; Darwin does not
    /// hand out a pid that still names a session or group, so that session
    /// is empty.
    func retireReason(_ slot: ReleaseAuthority.Slot) -> String? {
        switch liveness(slot.worker) {
        case .alive: return "the restore is still running."
        case .unknown: return "the restore process could not be checked."
        case .gone: break
        }
        if case .alive(let found) = state(slot.worker.pid), found != slot.worker { return nil }
        guard var members = groupMembers(slot.session, slot.group) else {
            return "the restore's processes could not be listed."
        }
        if members.isEmpty { return nil }
        members.forEach(kill)
        let end = Date().addingTimeInterval(2)
        while Date() < end {
            usleep(50_000)
            guard let now = groupMembers(slot.session, slot.group) else {
                return "the restore's processes could not be listed."
            }
            members = now
            if members.isEmpty { return nil }
        }
        return "a restore step is still running (process \(members.map(String.init).joined(separator: ", ")))."
    }

    /// The latest worker as a slot. Records from before the session/group
    /// fields use the worker's pid, which is what both were.
    static func slot(of record: ReleaseAuthority.Record) -> ReleaseAuthority.Slot? {
        guard let worker = record.worker else { return nil }
        return .init(worker: worker, session: record.workerSession ?? worker.pid,
                     group: record.workerGroup ?? worker.pid, bootSession: record.workerBootSession)
    }

    /// Nil when the release record can retire and Connect may be admitted:
    /// every worker of this boot gone with an empty session and group, no
    /// survivor of SIGKILL, the latest release finished with every component
    /// settled, and no lost history. A provably earlier boot retires only
    /// processes (Sol R2-F3): an unfinished or unsettled release, or lost
    /// history, still needs a release in this boot to read everything back.
    func unretiredReason(_ record: ReleaseAuthority.Record) -> String? {
        let current = bootSession()
        if let lost = record.historyLostBoot {
            return ReleaseAuthority.sameBoot(lost, current)
                ? "Tono's restore history was lost earlier in this session of the Mac. Restart the Mac, then choose Restore internet."
                : "Tono's restore history was lost before the Mac restarted. Choose Restore internet again."
        }
        let sameBoot = ReleaseAuthority.sameBoot(record.workerBootSession, current)
        var slots = (record.earlier ?? []).filter { ReleaseAuthority.sameBoot($0.bootSession, current) }
        if sameBoot, let latest = Self.slot(of: record) { slots.insert(latest, at: 0) }
        for slot in slots {
            if let reason = retireReason(slot) { return reason }
        }
        if sameBoot {
            var survivors: [Int32] = []
            for stuck in record.stuck where liveness(stuck) != .gone { survivors.append(stuck.pid) }
            if !survivors.isEmpty {
                return "an old Tono process could not be stopped or checked (process \(survivors.map(String.init).joined(separator: ", ")))."
            }
        }
        if !record.workerFinished {
            return "the last restore stopped before it finished. Choose Restore internet again."
        }
        if let unsettled = record.unsettled, !unsettled.isEmpty {
            return "Tono could not prove that \(unsettled.joined(separator: ", ")) cannot change again. Choose Restore internet again."
        }
        return nil
    }
}

/// Kernel process table reads.
enum ReleaseProcessTable {
    /// `unknown` when the process exists but could not be read: callers
    /// treat it as alive.
    enum State: Equatable {
        case alive(ReleaseAuthority.Incarnation)
        case gone
        case unknown
    }

    static func state(of pid: pid_t) -> State {
        guard pid > 0 else { return .gone }
        var info = proc_bsdinfo()
        // A nonzero arg also finds an unreaped zombie; with 0 a zombie is
        // ESRCH here while kill(pid, 0) still succeeds, which read as unknown.
        let size = withUnsafeMutablePointer(to: &info) { pointer in
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 1, pointer, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        if size == MemoryLayout<proc_bsdinfo>.size {
            // A zombie has exited: it can no longer change anything.
            if info.pbi_status == UInt32(SZOMB) { return .gone }
            return .alive(.init(pid: pid, startSeconds: info.pbi_start_tvsec, startMicroseconds: info.pbi_start_tvusec))
        }
        // Only ESRCH proves there is no such process.
        if Darwin.kill(pid, 0) != 0, errno == ESRCH { return .gone }
        return .unknown
    }

    /// The live incarnation, or nil when gone or unreadable. Only for
    /// identifying a process that is known to exist (this worker's own).
    static func incarnation(of pid: pid_t) -> ReleaseAuthority.Incarnation? {
        if case .alive(let found) = state(of: pid) { return found }
        return nil
    }

    static func parent(of pid: pid_t) -> pid_t? {
        var info = proc_bsdinfo()
        let size = withUnsafeMutablePointer(to: &info) { pointer in
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, pointer, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        guard size == MemoryLayout<proc_bsdinfo>.size else { return nil }
        return pid_t(info.pbi_ppid)
    }

    /// True only when the kernel shows `pid` can be neither a command a
    /// release ends nor a Tono writer: none of its user ids is root (every
    /// Tono writer runs as root) and its running code is not platform code
    /// (every command a release ends is). Both are kernel state set at exec,
    /// not claims the process makes. Any read that fails answers false.
    static func cannotWrite(_ pid: pid_t) -> Bool {
        var info = proc_bsdinfo()
        let size = withUnsafeMutablePointer(to: &info) { pointer in
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, pointer, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        guard size == MemoryLayout<proc_bsdinfo>.size,
              info.pbi_uid != 0, info.pbi_ruid != 0, info.pbi_svuid != 0 else { return false }
        var flags: UInt32 = 0
        guard csops(pid, csOpsStatus, &flags, MemoryLayout<UInt32>.size) == 0 else { return false }
        return flags & csPlatformBinary == 0
    }

    static func path(of pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
        let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        guard length > 0 else { return nil }
        return String(cString: buffer)
    }

    /// Every pid, or nil when the kernel list could not be read.
    static func listPIDs() -> [pid_t]? {
        let estimate = proc_listallpids(nil, 0)
        guard estimate > 0 else { return nil }
        var pids = [pid_t](repeating: 0, count: Int(estimate) + 64)
        let count = pids.withUnsafeMutableBufferPointer { buffer in
            proc_listallpids(buffer.baseAddress, Int32(buffer.count * MemoryLayout<pid_t>.size))
        }
        guard count > 0 else { return nil }
        return Array(pids.prefix(Int(count))).filter { $0 > 0 }
    }

    /// Live (non-zombie) members of session `session` or process group
    /// `group`; nil when the process list could not be read. Runs as root,
    /// so no process is hidden. A member whose state cannot be read counts.
    static func members(session: pid_t, group: pid_t) -> [pid_t]? {
        guard session > 0 || group > 0 else { return [] }
        guard let all = listPIDs() else { return nil }
        return all.filter { pid in
            guard (session > 0 && getsid(pid) == session) || (group > 0 && getpgid(pid) == group) else { return false }
            return state(of: pid) != .gone
        }
    }

    static func sessionMembers(_ sid: pid_t) -> [pid_t]? {
        members(session: sid, group: 0)
    }

    /// The argument vector from `KERN_PROCARGS2`, or nil when it could not
    /// be read (the process exited, or the kernel refused). Callers treat
    /// nil as unknown, never as "not ours".
    static func arguments(of pid: pid_t) -> [String]? {
        var argmax: Int32 = 0
        var argmaxSize = MemoryLayout<Int32>.size
        var argmaxMIB: [Int32] = [CTL_KERN, KERN_ARGMAX]
        guard sysctl(&argmaxMIB, 2, &argmax, &argmaxSize, nil, 0) == 0, argmax > 0 else { return nil }
        var buffer = [UInt8](repeating: 0, count: Int(argmax))
        var size = buffer.count
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        guard sysctl(&mib, 3, &buffer, &size, nil, 0) == 0,
              size > MemoryLayout<Int32>.size, size <= buffer.count else { return nil }
        // Layout: argc, the executable path, NUL padding, then argc strings.
        let argc = Int(buffer.withUnsafeBytes { $0.load(as: Int32.self) })
        guard argc >= 0 else { return nil }
        var index = MemoryLayout<Int32>.size
        while index < size && buffer[index] != 0 { index += 1 }
        while index < size && buffer[index] == 0 { index += 1 }
        var arguments: [String] = []
        while arguments.count < argc && index < size {
            var end = index
            while end < size && buffer[end] != 0 { end += 1 }
            arguments.append(String(decoding: buffer[index..<end], as: UTF8.self))
            index = end + 1
        }
        return arguments.count == argc ? arguments : nil
    }
}

/// `csops(2)`: exported by libsystem_kernel, declared by no SDK module.
@_silgen_name("csops")
private func csops(_ pid: pid_t, _ ops: UInt32, _ useraddr: UnsafeMutableRawPointer?, _ usersize: Int) -> Int32
private let csOpsStatus: UInt32 = 0 // CS_OPS_STATUS
private let csPlatformBinary: UInt32 = 0x0400_0000 // CS_PLATFORM_BINARY
