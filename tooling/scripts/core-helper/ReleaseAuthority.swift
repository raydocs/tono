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
        case unavailable(String)

        var code: String {
            switch self {
            case .releaseInProgress: "RELEASE_IN_PROGRESS"
            case .releaseUnfinished: "RELEASE_UNFINISHED"
            case .recordCorrupt: "RELEASE_RECORD_CORRUPT"
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
                "Tono's restore record is unreadable. Choose Restore internet once, then connect."
            case .unavailable(let detail):
                "Tono could not check the restore record: \(detail)"
            }
        }
    }

    /// Connect admission (§10.2 rule 2): under C, only when no release work
    /// can still run. Returns the session generation the caller must carry
    /// on every privileged request of this session.
    func admit(
        lockTimeout: TimeInterval = 1.5,
        processes: ReleaseProcesses = .live,
        restoreExecutor: () -> Void = {}
    ) throws -> UInt64 {
        do {
            return try withLock(timeout: lockTimeout) { _ -> UInt64 in
                var record: Record
                do { record = try load() } catch Failure.corrupt { throw AdmissionRefusal.recordCorrupt }
                if record.mode == .secured { return record.generation }
                if let reason = processes.unretiredReason(record) {
                    throw AdmissionRefusal.releaseUnfinished(reason)
                }
                record.mode = .secured
                record.generation = Self.nextGeneration(after: record.generation)
                record.worker = nil
                record.workerBootSession = nil
                record.workerFinished = true
                record.stuck = []
                let executorWasQuarantined = record.executorQuarantined
                record.executorQuarantined = false
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

    /// What a privileged request carrying `generation` may do now. Reads the
    /// record without C: the record is replaced atomically, and a release
    /// that lands right after this check kills this daemon before its
    /// cleanup starts, so the effect either finished first or never runs.
    enum RequestKind { case protective, releasing }

    enum GenerationVerdict: Equatable {
        case allowed
        /// Protective request without a generation on a released machine:
        /// the caller must admit first (legacy apps are admitted implicitly).
        case needsAdmission
        case stale
    }

    static func verdict(record: Record, generation: UInt64?, kind: RequestKind) -> GenerationVerdict {
        switch (kind, record.mode) {
        case (.protective, .released):
            return generation == nil ? .needsAdmission : .stale
        case (.protective, .secured):
            guard let generation else { return .allowed }
            return generation == record.generation ? .allowed : .stale
        case (.releasing, .secured):
            guard let generation else { return .allowed }
            return generation == record.generation ? .allowed : .stale
        case (.releasing, .released):
            // Already released: a late teardown cannot hurt a session that
            // does not exist yet. The next admission moves the generation on.
            return .allowed
        }
    }
}

/// Process inspection used to decide whether a release slot can retire.
struct ReleaseProcesses {
    var incarnation: (pid_t) -> ReleaseAuthority.Incarnation?
    var sessionMembers: (pid_t) -> [pid_t]
    var bootSession: () -> String?
    var kill: (pid_t) -> Void

    static let live = ReleaseProcesses(
        incarnation: { ReleaseProcessTable.incarnation(of: $0) },
        sessionMembers: { ReleaseProcessTable.sessionMembers($0) },
        bootSession: { try? TonoAuthenticatedPeer.bootSession() },
        kill: { _ = Darwin.kill($0, SIGKILL) }
    )

    func alive(_ recorded: ReleaseAuthority.Incarnation) -> Bool {
        incarnation(recorded.pid) == recorded
    }

    /// Members of the recorded worker's session. A session id is not reused
    /// while any member exists, so members found under it are the worker's
    /// own children; a live leader with another start time is a reused pid
    /// whose session is not ours.
    func workerSessionMembers(_ worker: ReleaseAuthority.Incarnation) -> [pid_t] {
        if let leader = incarnation(worker.pid), leader != worker { return [] }
        return sessionMembers(worker.pid)
    }

    /// Nil when the latest release can retire. A worker from an earlier boot
    /// ended with that boot; its persistent residue is read back by the next
    /// release, and replay sources are quarantined, not trusted.
    func unretiredReason(_ record: ReleaseAuthority.Record) -> String? {
        let sameBoot = record.workerBootSession != nil && record.workerBootSession == bootSession()
        if sameBoot, let worker = record.worker {
            if alive(worker) { return "the restore is still running." }
            var members = workerSessionMembers(worker)
            if !members.isEmpty {
                // The worker is gone; what is left is its own release work.
                // Ending it cannot touch a session that is not admitted yet.
                members.forEach(kill)
                let end = Date().addingTimeInterval(2)
                while Date() < end {
                    members = workerSessionMembers(worker)
                    if members.isEmpty { break }
                    usleep(50_000)
                }
                if !members.isEmpty {
                    return "a restore step is still running (process \(members.map(String.init).joined(separator: ", ")))."
                }
            }
        }
        if sameBoot {
            let survivors = record.stuck.filter(alive)
            if !survivors.isEmpty {
                return "an old Tono process could not be stopped (process \(survivors.map { String($0.pid) }.joined(separator: ", ")))."
            }
        }
        return nil
    }
}

/// Kernel process table reads. Anything unreadable is reported as absent by
/// these helpers; callers that must stay fail-closed check the release
/// record first.
enum ReleaseProcessTable {
    static func incarnation(of pid: pid_t) -> ReleaseAuthority.Incarnation? {
        guard pid > 0 else { return nil }
        var info = proc_bsdinfo()
        let size = withUnsafeMutablePointer(to: &info) { pointer in
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, pointer, Int32(MemoryLayout<proc_bsdinfo>.size))
        }
        guard size == MemoryLayout<proc_bsdinfo>.size, info.pbi_status != UInt32(SZOMB) else { return nil }
        return .init(pid: pid, startSeconds: info.pbi_start_tvsec, startMicroseconds: info.pbi_start_tvusec)
    }

    static func path(of pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
        let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
        guard length > 0 else { return nil }
        return String(cString: buffer)
    }

    static func allPIDs() -> [pid_t] {
        let estimate = proc_listallpids(nil, 0)
        guard estimate > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(estimate) + 64)
        let count = pids.withUnsafeMutableBufferPointer { buffer in
            proc_listallpids(buffer.baseAddress, Int32(buffer.count * MemoryLayout<pid_t>.size))
        }
        guard count > 0 else { return [] }
        return Array(pids.prefix(Int(count))).filter { $0 > 0 }
    }

    /// Live (non-zombie) members of session `sid`.
    static func sessionMembers(_ sid: pid_t) -> [pid_t] {
        guard sid > 0 else { return [] }
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_SESSION, sid]
        var size = 0
        guard sysctl(&mib, 4, nil, &size, nil, 0) == 0 else { return [] }
        let stride = MemoryLayout<kinfo_proc>.stride
        let capacity = size / stride + 16
        var table = [kinfo_proc](repeating: kinfo_proc(), count: capacity)
        size = capacity * stride
        let status = table.withUnsafeMutableBufferPointer { buffer in
            sysctl(&mib, 4, buffer.baseAddress, &size, nil, 0)
        }
        guard status == 0 else { return [] }
        return table.prefix(size / stride)
            .filter { $0.kp_proc.p_stat != CChar(SZOMB) }
            .map { $0.kp_proc.p_pid }
            .filter { $0 > 0 }
    }
}
