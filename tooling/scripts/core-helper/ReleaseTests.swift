import Foundation
import Darwin

/// `--release-self-test`, run as root on hosted macOS CI. One check per
/// behavior; each prints what failed.
func runReleaseSelfTests() -> Bool {
    var template = Array("/private/tmp/tono-release-test.XXXXXX".utf8CString)
    guard geteuid() == 0, mkdtemp(&template) != nil else {
        fputs("release self-test needs root\n", stderr)
        return false
    }
    let directory = String(cString: template)
    defer { try? FileManager.default.removeItem(atPath: directory) }
    let authority = ReleaseAuthority(directory: directory, owner: geteuid())
    var passed = true
    func check(_ condition: Bool, _ name: String) {
        if condition { print("PASS release \(name)") } else {
            fputs("FAIL release \(name)\n", stderr)
            passed = false
        }
    }
    let idle = ReleaseProcesses(incarnation: { _ in nil }, sessionMembers: { _ in [] }, bootSession: { "boot" }, kill: { _ in })

    // A machine that never ran a release is secured at generation 0.
    check((try? authority.load()) == ReleaseAuthority.Record(), "missing record reads as secured")

    // A corrupt record is never auto-retired: admission refuses with a reason.
    FileManager.default.createFile(atPath: authority.recordPath, contents: Data("{".utf8))
    chmod(authority.recordPath, 0o600)
    do {
        _ = try authority.admit(processes: idle)
        check(false, "corrupt record refuses admission")
    } catch let refusal as ReleaseAuthority.AdmissionRefusal {
        check(refusal == .recordCorrupt, "corrupt record refuses admission")
    } catch {
        check(false, "corrupt record refuses admission")
    }

    // Admission while C is held elsewhere changes nothing and says why.
    var released = ReleaseAuthority.Record()
    released.mode = .released
    released.generation = 7
    try? authority.save(released)
    let busyAdmission = try? authority.withLock(timeout: 1) { (_: Int32) -> ReleaseAuthority.AdmissionRefusal? in
        do {
            _ = try authority.admit(lockTimeout: 0.1, processes: idle)
            return nil
        } catch let refusal as ReleaseAuthority.AdmissionRefusal {
            return refusal
        }
    }
    check(busyAdmission == ReleaseAuthority.AdmissionRefusal.releaseInProgress && (try? authority.load()) == released,
          "admission without C changes nothing")

    // Admission after a finished release moves the generation on and puts
    // the quarantined update executor back exactly once.
    released.executorQuarantined = true
    try? authority.save(released)
    var executorRestores = 0
    let admitted = try? authority.admit(processes: idle, restoreExecutor: { executorRestores += 1 })
    let afterAdmission = try? authority.load()
    check(admitted != nil && admitted! > 7 && afterAdmission?.mode == .secured
            && afterAdmission?.generation == admitted && afterAdmission?.executorQuarantined == false
            && executorRestores == 1,
          "admission secures a new generation and restores the executor")

    // Generation verdicts: old-session effects are refused.
    var secured = ReleaseAuthority.Record()
    secured.generation = 20
    var releasedRecord = ReleaseAuthority.Record()
    releasedRecord.mode = .released
    releasedRecord.generation = 21
    check(ReleaseAuthority.verdict(record: releasedRecord, generation: nil, kind: .protective) == .needsAdmission,
          "unadmitted protective request needs admission")
    check(ReleaseAuthority.verdict(record: releasedRecord, generation: 20, kind: .protective) == .stale,
          "protective request from before the release is stale")
    check(ReleaseAuthority.verdict(record: secured, generation: 19, kind: .releasing) == .stale,
          "teardown from an earlier session is stale")
    check(ReleaseAuthority.verdict(record: secured, generation: 20, kind: .protective) == .allowed,
          "current session request is allowed")

    // A live worker blocks admission.
    let worker = ReleaseAuthority.Incarnation(pid: 4242, startSeconds: 1, startMicroseconds: 2)
    var running = releasedRecord
    running.worker = worker
    running.workerBootSession = "boot"
    let liveWorker = ReleaseProcesses(incarnation: { $0 == 4242 ? worker : nil }, sessionMembers: { _ in [] },
                                      bootSession: { "boot" }, kill: { _ in })
    check(liveWorker.unretiredReason(running) != nil, "running worker blocks admission")

    // A survivor of SIGKILL blocks admission until it is gone.
    var stuckRecord = releasedRecord
    stuckRecord.workerBootSession = "boot"
    stuckRecord.stuck = [.init(pid: 99, startSeconds: 3, startMicroseconds: 4)]
    let stuckAlive = ReleaseProcesses(incarnation: { $0 == 99 ? .init(pid: 99, startSeconds: 3, startMicroseconds: 4) : nil },
                                      sessionMembers: { _ in [] }, bootSession: { "boot" }, kill: { _ in })
    check(stuckAlive.unretiredReason(stuckRecord) != nil, "stuck writer blocks admission")

    // Only a record from this boot can block: an earlier boot ended its work.
    check(stuckAlive.unretiredReason({ var r = stuckRecord; r.workerBootSession = "earlier"; return r }()) == nil,
          "earlier boot does not block")

    // Real kernel: a dead worker's children are found by session and ended.
    check(deadWorkerSessionIsEnded(), "dead worker session is ended before admission")

    // Outcome: only clean, settled, finished readback is restored.
    let clean = ReleaseReport.Component(name: "pf", readback: "restored", risk: "settled", detail: nil)
    var residual = clean
    residual.readback = "residual"
    var unsettled = clean
    unsettled.risk = "unknown"
    check(ReleaseReport.outcome(components: [clean], stuck: [], finished: true) == "restored", "clean readback is restored")
    check(ReleaseReport.outcome(components: [clean, residual], stuck: [], finished: true) == "partial", "residual is partial")
    check(ReleaseReport.outcome(components: [clean, unsettled], stuck: [], finished: true) == "unknown", "unsettled is unknown")
    check(ReleaseReport.outcome(components: [clean], stuck: [], finished: false) == "unknown", "deadline answer is unknown")
    check(ReleaseReport.outcome(components: [clean], stuck: [5], finished: true) == "unknown", "stuck writer is unknown")

    // E-F5-v4-F1: a worker that cannot get C reports busy and touches nothing.
    check(workerWithoutLockReportsBusy(), "worker without C reports busy")

    return passed
}

/// Starts `/bin/sh` as a session leader with two children, kills only the
/// leader, and checks that the release check ends the children.
private func deadWorkerSessionIsEnded() -> Bool {
    var attributes: posix_spawnattr_t?
    posix_spawnattr_init(&attributes)
    defer { posix_spawnattr_destroy(&attributes) }
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETSID))
    let argv: [UnsafeMutablePointer<CChar>?] = [strdup("/bin/sh"), strdup("-c"), strdup("/bin/sleep 30 & /bin/sleep 30 & wait"), nil]
    defer { argv.forEach { free($0) } }
    var pid: pid_t = 0
    guard posix_spawn(&pid, "/bin/sh", nil, &attributes, argv, nil) == 0 else { return false }
    usleep(300_000)
    guard let leader = ReleaseProcessTable.incarnation(of: pid),
          ReleaseProcessTable.sessionMembers(pid).count >= 3 else {
        kill(-pid, SIGKILL)
        return false
    }
    kill(pid, SIGKILL)
    var status: Int32 = 0
    waitpid(pid, &status, 0)
    var record = ReleaseAuthority.Record()
    record.mode = .released
    record.worker = leader
    record.workerBootSession = try? TonoAuthenticatedPeer.bootSession()
    let reason = ReleaseProcesses.live.unretiredReason(record)
    return reason == nil && ReleaseProcessTable.sessionMembers(pid).isEmpty
}

private func workerWithoutLockReportsBusy() -> Bool {
    guard let executable = ReleaseProcessTable.path(of: getpid()) else { return false }
    let live = ReleaseAuthority()
    let report = try? live.withLock(timeout: 2) { (_: Int32) -> ReleaseReport? in
        guard let run = try? ReleaseSpawn.worker(executable: executable,
                                                 request: .init(requestID: "self-test", expectedGeneration: nil)) else { return nil }
        let answer = ReleaseRun(run).answer(before: Date().addingTimeInterval(10))
        return try? JSONDecoder().decode(ReleaseReport.self, from: answer)
    }
    guard let report else { return false }
    return report.outcome == "busy" && report.components.isEmpty
}
