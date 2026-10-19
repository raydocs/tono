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
    let idle = ReleaseProcesses(state: { _ in .gone }, groupMembers: { _, _ in [] }, bootSession: { "boot" }, kill: { _ in })

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
    let admitted = try? authority.admit(expectedGeneration: 7, processes: idle, restoreExecutor: { executorRestores += 1 })
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
    let liveWorker = ReleaseProcesses(state: { $0 == 4242 ? .alive(worker) : .gone }, groupMembers: { _, _ in [] },
                                      bootSession: { "boot" }, kill: { _ in })
    check(liveWorker.unretiredReason(running) != nil, "running worker blocks admission")

    // A survivor of SIGKILL blocks admission until it is gone.
    var stuckRecord = releasedRecord
    stuckRecord.workerBootSession = "boot"
    stuckRecord.stuck = [.init(pid: 99, startSeconds: 3, startMicroseconds: 4)]
    let stuckAlive = ReleaseProcesses(state: { $0 == 99 ? .alive(.init(pid: 99, startSeconds: 3, startMicroseconds: 4)) : .gone },
                                      groupMembers: { _, _ in [] }, bootSession: { "boot" }, kill: { _ in })
    check(stuckAlive.unretiredReason(stuckRecord) != nil, "stuck writer blocks admission")

    // Only a record from this boot can block: an earlier boot ended its work.
    check(stuckAlive.unretiredReason({ var r = stuckRecord; r.workerBootSession = "earlier"; return r }()) == nil,
          "earlier boot does not block")
    // Sol R2-F3: a restart ends processes, not an unfinished or unsettled
    // release, and not lost history: those need a release in this boot.
    check(idle.unretiredReason({ var r = stuckRecord; r.workerBootSession = "earlier"; r.workerFinished = false; return r }()) != nil,
          "a restart does not retire an unfinished release")
    check(idle.unretiredReason({ var r = stuckRecord; r.workerBootSession = "earlier"; r.unsettled = ["dns"]; return r }()) != nil,
          "a restart does not retire an unsettled release")
    check(idle.unretiredReason({ var r = stuckRecord; r.workerBootSession = "earlier"; r.historyLostBoot = "earlier"; return r }()) != nil,
          "a restart does not retire lost history")

    // Real kernel: a dead worker's children are found by session and ended.
    check(deadWorkerSessionIsEnded(), "dead worker session is ended before admission")
    check(unreapedZombieIsGone(), "an unreaped zombie is gone, not unknown")
    check(deletedExecutableIsUnidentified(asUser: true) == false, "a user's deleted non-platform executable is not unidentified")
    check(deletedExecutableIsUnidentified(asUser: false) == true, "a root process with a deleted executable stays unidentified")

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

    // R-F1: clean, agreeing reads are not terminal evidence. A Tono command
    // child still alive (found by its arguments, here not killed) leaves its
    // components unknown, and so does an unverified bootout.
    let cleanReads = ReleaseCleanup.componentNames.map {
        ReleaseReport.Component(name: $0, readback: "restored", risk: "unknown", detail: nil)
    }
    let proven = ReleaseWorker.TerminalEvidence(quarantineVerified: true, writersEnded: true, busy: [], storedDNSUsesTonoResolver: false)
    check(ReleaseReport.outcome(components: ReleaseWorker.settle(first: cleanReads, second: cleanReads, evidence: proven),
                                stuck: [], finished: true) == "restored",
          "clean reads with terminal evidence are restored")
    var unverified = proven
    unverified.quarantineVerified = false
    check(ReleaseReport.outcome(components: ReleaseWorker.settle(first: cleanReads, second: cleanReads, evidence: unverified),
                                stuck: [], finished: true) == "unknown",
          "clean reads with an unverified bootout are not restored")
    check(liveTaggedChildKeepsComponentsUnsettled(cleanReads: cleanReads, proven: proven),
          "clean reads with a live Tono command child are not restored")

    // R-F2: a retry carries an unfinished worker forward instead of dropping
    // it, and the new record still refuses Connect.
    var crashed = releasedRecord
    crashed.worker = worker
    crashed.workerBootSession = "boot"
    crashed.workerFinished = false
    let carried = ReleaseWorker.carryForward(crashed, currentBoot: "boot", processes: liveWorker)
    var retried = crashed
    retried.worker = .init(pid: 5151, startSeconds: 9, startMicroseconds: 9)
    retried.workerFinished = true
    retried.earlier = carried.earlier
    check(carried.earlier.map(\.worker) == [worker] && liveWorker.unretiredReason(retried) != nil,
          "retry keeps an unretired worker")

    // R-F2: an inspection error is unknown, never gone.
    let unreadable = ReleaseProcesses(state: { _ in .unknown }, groupMembers: { _, _ in [] }, bootSession: { "boot" }, kill: { _ in })
    check(unreadable.unretiredReason(running) != nil, "unreadable worker blocks admission")

    // R-F2: a missing boot identity counts as the same boot.
    check(stuckAlive.unretiredReason({ var r = stuckRecord; r.workerBootSession = nil; return r }()) != nil,
          "missing boot identity does not skip the checks")

    // R-F2: a worker that is gone still leaves its session and group to empty.
    var goneWorker = releasedRecord
    goneWorker.worker = worker
    goneWorker.workerBootSession = "boot"
    let heldGroup = ReleaseProcesses(state: { _ in .gone }, groupMembers: { _, _ in [777] }, bootSession: { "boot" }, kill: { _ in })
    check(heldGroup.unretiredReason(goneWorker) != nil, "a live process in the release group blocks admission")

    // R-F2: history lost to a corrupt record blocks the rest of that boot.
    var lost = releasedRecord
    lost.historyLostBoot = "boot"
    check(idle.unretiredReason(lost) != nil, "lost history blocks admission in its boot")

    // R-F1: an unsettled component recorded by the release blocks admission.
    var unsettledRecord = releasedRecord
    unsettledRecord.unsettled = ["dns"]
    check(idle.unretiredReason(unsettledRecord) != nil, "unsettled component blocks admission")

    // R-F3: a protective request without a generation on a released machine
    // is refused, not admitted, and the record does not move.
    try? authority.save(releasedRecord)
    let implicit = (try? SocketServer.enforceSessionGeneration(nil, kind: .protective, authority: authority)) != nil
    check(!implicit && (try? authority.load()) == releasedRecord, "headerless arm on a released machine is refused")

    // R-F3: admission is a compare-and-swap on the generation read before.
    let wrongExpected = (try? authority.admit(expectedGeneration: 20, processes: idle)) != nil
    let noExpected = (try? authority.admit(processes: idle)) != nil
    check(!wrongExpected && !noExpected && (try? authority.load()) == releasedRecord,
          "admission with another generation changes nothing")

    // R-F4: a release-direction request must name the current generation.
    check(ReleaseAuthority.verdict(record: releasedRecord, generation: 20, kind: .releasing) == .stale
            && ReleaseAuthority.verdict(record: secured, generation: nil, kind: .releasing) == .needsAdmission,
          "teardown from before a release, or without a generation, is refused")

    // R-F5: a step that did not prove itself is never restored.
    check(ReleaseReport.outcome(components: [clean], stuck: [], finished: true, failures: ["save failed"]) == "unknown",
          "failed step is unknown")
    check(ReleaseLaunchd.state("com.raydocs.tono.self-test-absent") == .notLoaded, "launchd reads back an absent job")

    // R-F6: a worker that died after the bootout leaves the daemon to the
    // release job, which puts it back without re-arming anything.
    var quarantined = releasedRecord
    quarantined.worker = worker
    quarantined.workerBootSession = "boot"
    quarantined.daemonBootedOut = true
    quarantined.executorQuarantined = true
    try? authority.save(quarantined)
    var restores = 0
    let recovered = ReleaseQuarantine.recover(authority: authority, processes: idle, restore: { restores += 1; return true })
    let afterRecovery = try? authority.load()
    check(recovered == .clear && restores == 1 && afterRecovery?.daemonBootedOut == nil
            && afterRecovery?.mode == .released && afterRecovery?.executorQuarantined == true,
          "dead worker's quarantine is recovered without re-arming")
    try? authority.save(quarantined)
    let failedRecovery = ReleaseQuarantine.recover(authority: authority, processes: idle, restore: { false })
    check(failedRecovery != .clear && (try? authority.load())?.daemonRecoveryFailure != nil
            && (try? authority.load())?.daemonBootedOut == true,
          "failed recovery stays visible")

    // R-M2: an emergency command that gets C marks the machine released with
    // a new generation; without C it runs and leaves the record alone.
    try? authority.save(secured)
    var ran = 0
    _ = runEmergencyUnderReleaseAuthority(authority: authority) { ran += 1; return true }
    let afterEmergency = try? authority.load()
    check(ran == 1 && afterEmergency?.mode == .released && (afterEmergency?.generation ?? 0) > 20
            && afterEmergency?.unsettled == ReleaseCleanup.componentNames,
          "emergency under C releases with a new generation")
    try? authority.save(secured)
    _ = try? authority.withLock(timeout: 1) { (_: Int32) -> Bool in
        runEmergencyUnderReleaseAuthority(authority: authority) { ran += 1; return true }
    }
    check(ran == 2 && (try? authority.load()) == secured, "emergency without C leaves the record alone")

    // #1571: use the production durable authority API, then reconstruct it
    // just as a restarted daemon does. A failed replacement cannot retire
    // strict intent; only the explicitly fenced emergency release can.
    do {
        try authority.save(secured)
        try authority.bindRuntime(generation: 20, digest: "strict-fixture", strict: true, requestedMode: "three-tier")
        let restarted = ReleaseAuthority(directory: directory, owner: geteuid())
        let persisted = try restarted.load()
        var mismatchRefused = false
        do {
            try restarted.bindRuntime(generation: 20, digest: "wrong-mode", strict: true, requestedMode: "stable")
        } catch { mismatchRefused = true }
        var downgradeRefused = false
        do {
            try restarted.bindRuntime(generation: 20, digest: "stable-fixture", strict: false, requestedMode: "stable")
        } catch { downgradeRefused = true }
        var replacementRefused = false
        do {
            try restarted.bindRuntime(generation: 20, digest: "different-strict-fixture", strict: true, requestedMode: "three-tier")
        } catch { replacementRefused = true }
        var blocked = KillSwitchManager.emergencyState(preserving: nil)
        blocked.strictBlocking = persisted.strictIntent
        let rules = KillSwitchManager.renderRules(state: blocked, allowedUID: geteuid(), physicalInterfaces: ["en0"])
        let unchanged = try restarted.load() == persisted
        _ = runEmergencyUnderReleaseAuthority(authority: restarted) { true }
        let explicitlyReleased = try restarted.load()
        check(persisted.strictIntent && unchanged && mismatchRefused && downgradeRefused && replacementRefused
                && rules.contains("block drop out quick all") && !rules.contains("user root")
                && !explicitlyReleased.strictIntent && explicitlyReleased.generation > 20,
              "strict restart and failed replacement retain block; fenced explicit release retires intent")
    } catch {
        check(false, "strict restart and failed replacement retain block; fenced explicit release retires intent")
    }

    return passed
}

/// A real gated command child, as `KillSwitchManager.run` starts it, held at
/// its gate. The release must find it by its arguments; with the kill
/// withheld it stays alive, and its components must not settle.
private func liveTaggedChildKeepsComponentsUnsettled(cleanReads: [ReleaseReport.Component],
                                                     proven: ReleaseWorker.TerminalEvidence) -> Bool {
    var gate: [Int32] = [-1, -1]
    guard pipe(&gate) == 0 else { return false }
    defer { close(gate[1]) }
    var actions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&actions)
    defer { posix_spawn_file_actions_destroy(&actions) }
    posix_spawn_file_actions_adddup2(&actions, gate[0], 0)
    let argv: [UnsafeMutablePointer<CChar>?] = [
        strdup("/bin/sh"), strdup("-c"), strdup(KillSwitchManager.commandGateScript),
        strdup("/sbin/pfctl"), strdup("-s"), strdup("info"), nil,
    ]
    defer { argv.forEach { free($0) } }
    var pid: pid_t = 0
    let spawned = posix_spawn(&pid, "/bin/sh", &actions, nil, argv, nil)
    close(gate[0])
    guard spawned == 0 else { return false }
    defer {
        kill(pid, SIGKILL)
        var status: Int32 = 0
        waitpid(pid, &status, 0)
    }
    usleep(300_000)
    let withheld = ReleaseProcesses(state: { ReleaseProcessTable.state(of: $0) },
                                    groupMembers: { ReleaseProcessTable.members(session: $0, group: $1) },
                                    bootSession: { "boot" }, kill: { _ in })
    let outcome = ReleaseChildren.end(processes: withheld)
    var evidence = proven
    evidence.busy = outcome.busy
    let settled = ReleaseWorker.settle(first: cleanReads, second: cleanReads, evidence: evidence)
    guard outcome.stuck.contains(where: { $0.pid == pid }), outcome.busy.contains("pf"),
          ReleaseReport.outcome(components: settled, stuck: outcome.stuck.map(\.pid), finished: true) == "unknown",
          ReleaseReport.outcome(components: settled, stuck: [], finished: true) == "unknown" else {
        fputs("release tagged child \(pid): \(ReleaseProcessTable.arguments(of: pid) ?? []), busy \(outcome.busy)\n", stderr)
        return false
    }
    return true
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
          (ReleaseProcessTable.sessionMembers(pid) ?? []).count >= 3 else {
        fputs("release session members of \(pid): \(ReleaseProcessTable.sessionMembers(pid) ?? []), getsid \(getsid(pid))\n", stderr)
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
    return reason == nil && ReleaseProcessTable.sessionMembers(pid) == []
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

/// A child that has exited keeps its pid until it is reaped. It can no longer
/// change anything, so it reads as gone; `unknown` would hold the release
/// open until the Mac restarts.
private func unreapedZombieIsGone() -> Bool {
    let argv: [UnsafeMutablePointer<CChar>?] = [strdup("/usr/bin/true"), nil]
    defer { argv.forEach { free($0) } }
    var pid: pid_t = 0
    guard posix_spawn(&pid, "/usr/bin/true", nil, nil, argv, nil) == 0 else { return false }
    defer {
        var status: Int32 = 0
        while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
    }
    var info = siginfo_t()
    var waited: Int32
    repeat { waited = waitid(P_PID, id_t(pid), &info, WEXITED | WNOWAIT) } while waited == -1 && errno == EINTR
    guard waited == 0, kill(pid, 0) == 0 else { return false }
    let state = ReleaseProcessTable.state(of: pid)
    guard state == .gone else {
        fputs("release zombie \(pid): \(state)\n", stderr)
        return false
    }
    return true
}

/// An app updated while it runs keeps executing a file that no longer has a
/// path. Copied from `/bin/sleep` and re-signed ad hoc, so it is not platform
/// code; `asUser` runs it as nobody through sudo, otherwise it runs as root.
/// Answers whether the release scan named it as unidentified, or nil when the
/// setup did not hold (the copy must be alive, listed and pathless).
private func deletedExecutableIsUnidentified(asUser: Bool) -> Bool? {
    var template = Array("/private/tmp/tono-release-exe.XXXXXX".utf8CString)
    guard mkdtemp(&template) != nil else { return nil }
    let directory = String(cString: template)
    defer { try? FileManager.default.removeItem(atPath: directory) }
    let copy = directory + "/updated-app"
    guard chmod(directory, 0o755) == 0,
          (try? FileManager.default.copyItem(atPath: "/bin/sleep", toPath: copy)) != nil,
          chmod(copy, 0o755) == 0 else { return nil }
    let signer = Process()
    signer.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
    signer.arguments = ["--force", "--sign", "-", copy]
    signer.standardOutput = FileHandle.nullDevice
    signer.standardError = FileHandle.nullDevice
    guard (try? signer.run()) != nil else { return nil }
    signer.waitUntilExit()
    guard signer.terminationStatus == 0 else { return nil }
    let launcher = asUser ? "/usr/bin/sudo" : copy
    let words = asUser ? ["sudo", "-n", "-u", "nobody", "--", copy, "30"] : [copy, "30"]
    let argv: [UnsafeMutablePointer<CChar>?] = words.map { strdup($0) } + [nil]
    defer { argv.forEach { free($0) } }
    var spawned: pid_t = 0
    guard posix_spawn(&spawned, launcher, nil, nil, argv, nil) == 0 else { return nil }
    // sudo runs the command as its child; find the process executing the copy.
    var target: pid_t = 0
    for _ in 0..<40 where target == 0 {
        usleep(50_000)
        target = (ReleaseProcessTable.listPIDs() ?? []).first { pid in
            (pid == spawned || ReleaseProcessTable.parent(of: pid) == spawned)
                && ReleaseProcessTable.path(of: pid) == copy
        } ?? 0
    }
    defer {
        if target > 0 { kill(target, SIGKILL) }
        kill(spawned, SIGKILL)
        var status: Int32 = 0
        waitpid(spawned, &status, 0)
    }
    guard target > 0, unlink(copy) == 0, ReleaseProcessTable.path(of: target) == nil,
          case .alive(_) = ReleaseProcessTable.state(of: target),
          ReleaseProcessTable.listPIDs()?.contains(target) == true else {
        fputs("release deleted executable \(target): setup did not hold\n", stderr)
        return nil
    }
    let observeOnly = ReleaseProcesses(state: { ReleaseProcessTable.state(of: $0) },
                                       groupMembers: { ReleaseProcessTable.members(session: $0, group: $1) },
                                       bootSession: { "boot" }, kill: { _ in })
    let outcome = ReleaseChildren.end(processes: observeOnly)
    guard !outcome.failures.contains(where: { $0.contains("could not be listed") }) else { return nil }
    let named = outcome.failures.contains { failure in
        failure.split(whereSeparator: { !$0.isNumber }).contains(Substring(String(target)))
    }
    fputs("release deleted executable \(target) as \(asUser ? "nobody" : "root"): named \(named)\n", stderr)
    return named
}
