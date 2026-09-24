import Foundation
import Darwin
import Security

/// Root on disposable hosted macOS only. No real network, launchd, installed
/// App or publisher key is used. File staging, durable storage, executor control
/// flow, replacement renames and Security's loaded-code comparison are real.
func runUpdateSelfTests() -> Bool {
    guard geteuid() == 0 else { fputs("Update self-test requires root.\n", stderr); return false }
    var failures = [String]()
    func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try condition() else { throw HelperFailure.invalid(message) }
    }
    func refuses(_ operation: () throws -> Void) throws {
        var refused = false
        do { try operation() } catch { refused = true }
        try check(refused, "Expected refusal did not occur")
    }
    func test(_ name: String, _ body: (String) throws -> Void) {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("tono-update-test-" + UUID().uuidString)
        do {
            try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: temporary) }
            guard let physicalPath = canonicalPath(temporary.path) else {
                throw HelperFailure.invalid("Cannot resolve the private test directory.")
            }
            try body(physicalPath)
            print("PASS update: \(name)")
        } catch { failures.append(name); fputs("FAIL update: \(name): \(error)\n", stderr) }
    }
    let components = UpdateContractV1.Components(appSha256: String(repeating: "a", count: 64),
        coreSha256: String(repeating: "b", count: 64), privilegedSha256: String(repeating: "c", count: 64))
    let manifest = UpdateContractV1.ReleaseManifest(appVersion: "0.0.73", buildCommit: String(repeating: "d", count: 40),
        kind: "tonoUpdateManifest", protocolVersion: 1, releaseId: "native-test", releaseSequence: 14,
        targets: [.init(artifactSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", artifactSizeBytes: 3,
                        components: components, id: .macosArm64),
                  .init(artifactSha256: String(repeating: "f", count: 64), artifactSizeBytes: 17, components: components, id: .windowsX86_64)])
    let owner = TonoAuthenticatedPeer(uid: 501, auditToken: Data("old-incarnation".utf8), bundleURL: URL(fileURLWithPath: UpdatePackage.appPath))
    let successor = TonoAuthenticatedPeer(uid: 501, auditToken: Data("new-incarnation".utf8), bundleURL: owner.bundleURL)
    func effects() -> UpdateTransaction.Effects {
        .init(authenticate: { _ in }, installedFloor: { 5 }, installedComponents: { components },
              stage: { _, _, _, _ in components }, observe: { .protectedOffline }, prepare: { _ in .protectedOffline },
              recovery: { _ in .protectedOffline }, disconnect: {}, launchExecutor: { _ in })
    }
    func reserved(_ store: UpdateStorage, _ engine: UpdateTransaction) throws {
        try engine.reserve(peer: owner, manifest: manifest, manifestBytes: UpdateContractV1.canonical(manifest), signature: Data())
        var ledger = try store.load()
        ledger.attempt?.execution = .staged // Substituted successful private native-code verification only.
        try store.save(ledger)
        try engine.prepare(peer: owner)
    }

    test("private-copy-signature-and-path-refusal") { directory in
        let input = directory + "/input"
        try Data("abc".utf8).write(to: URL(fileURLWithPath: input))
        try UpdatePackage.snapshot(input, owner: 0, target: manifest.target(.macosArm64), to: directory + "/private")
        try Data("abd".utf8).write(to: URL(fileURLWithPath: input))
        try check(UpdateStorage.read(directory + "/private", maximum: 3) == Data("abc".utf8), "Private snapshot followed mutable input")
        try refuses { try UpdatePackage.snapshot(input, owner: 0, target: manifest.target(.macosArm64), to: directory + "/bad-hash") }
        symlink(directory, directory + "/alias")
        try refuses { _ = try UpdatePackage.openInput(directory + "/alias/input", owner: 0) }
        let store = try UpdateStorage(root: directory + "/store")
        let engine = UpdateTransaction(storage: store, effects: effects())
        try refuses { try engine.stage(peer: owner, manifestBytes: UpdateContractV1.canonical(manifest),
                                       signature: Data(Data(repeating: 0, count: 64).base64EncodedString().utf8), packagePath: input) }
        try check(store.load().attempt == nil, "Bad signature reserved an update")
        try refuses { _ = try UpdatePackage.verifyCode(input, identifier: "com.raydocs.tono") }
        try refuses { try UpdateZIP.validate(input) }
    }

    test("durable-consume-write-failure-and-lost-ack") { directory in
        let store = try UpdateStorage(root: directory)
        var failWrite = true
        var failDirectorySync = false
        var launches = 0
        var io = effects()
        io.launchExecutor = { _ in launches += 1 }
        let engine = UpdateTransaction(storage: store, effects: io, persist: { candidate in
            if candidate.attempt?.execution == .consumed && failWrite { throw HelperFailure.system("injected write failure") }
            if candidate.attempt?.execution == .consumed && failDirectorySync {
                try UpdateStorage.write(UpdateContractV1.canonical(candidate), to: directory + "/ledger.json",
                    synchronizeDirectory: { _ in throw HelperFailure.system("injected post-rename directory sync failure") })
            } else { try store.save(candidate) }
        })
        try reserved(store, engine)
        let before = try UpdateStorage.read(directory + "/ledger.json", maximum: 128 * 1024)
        try refuses { try engine.execute(peer: owner) }
        try check(launches == 0, "Executor launched before consumed write")
        try check(UpdateStorage.read(directory + "/ledger.json", maximum: 128 * 1024) == before, "Failed consume changed disk")
        failWrite = false
        failDirectorySync = true
        try refuses { try engine.execute(peer: owner) }
        try check(launches == 0, "Failed directory sync acknowledged consumption")
        var allowDurabilityRetry = false
        let loaded = try UpdateStorage(root: directory, synchronizeDirectory: { path in
            guard allowDurabilityRetry else { throw HelperFailure.system("injected durability retry failure") }
            try UpdateStorage.syncDirectory(path)
        })
        let restarted = UpdateTransaction(storage: loaded, effects: io)
        try refuses { try restarted.resumeConsumedExecutor(peer: owner) }
        try check(launches == 0, "Visible-but-unsynced consume launched repair resources")
        allowDurabilityRetry = true
        // load re-establishes directory durability for the visible rename;
        // query repairs only this consumed executor, not a second admission.
        var durable = try loaded.load()
        try check(durable.highWater == 14 && durable.attempt?.execution == .consumed, "Consumed evidence missing after reload")
        try restarted.resumeConsumedExecutor(peer: owner)
        try refuses { try restarted.consume(&durable) }
        try refuses { try restarted.reserve(peer: owner, manifest: manifest, manifestBytes: UpdateContractV1.canonical(manifest), signature: Data()) }
        try check(launches == 1, "Replay reinstalled")
        try FileManager.default.createDirectory(atPath: directory + "/occupied", withIntermediateDirectories: false)
        try refuses { try UpdateStorage.write(Data("refused rename".utf8), to: directory + "/occupied") }
        try check(loaded.load().highWater == 14, "Atomic write failure lowered high-water")
    }

    test("interrupted-replacement-restarts-only-rollback") { directory in
        let store = try UpdateStorage(root: directory + "/store")
        let engine = UpdateTransaction(storage: store, effects: effects())
        try reserved(store, engine)
        try engine.execute(peer: owner)
        let live = directory + "/live", backup = directory + "/backup", replacement = directory + "/new"
        try Data("old".utf8).write(to: URL(fileURLWithPath: live))
        try Data("old".utf8).write(to: URL(fileURLWithPath: backup))
        try Data("new".utf8).write(to: URL(fileURLWithPath: replacement))
        var forward = 0
        try refuses {
            try UpdateExecutor.perform(storage: store, validate: { _ in }, replace: { _ in
                try check(store.load().attempt?.execution == .replacing && store.load().highWater == 14, "Mutation preceded consumed evidence")
                forward += 1
                try UpdateExecutor.replaceFile(from: replacement, to: live, in: directory)
                throw HelperFailure.system("injected interrupted replacement")
            }, rollback: { _ in throw HelperFailure.system("injected interrupted rollback") })
        }
        try check(Data(contentsOf: URL(fileURLWithPath: live)) == Data("new".utf8), "Real replacement did not run")
        let restarted = try UpdateStorage(root: directory + "/store")
        try UpdateExecutor.perform(storage: restarted, validate: { _ in }, replace: { _ in forward += 1 }, rollback: { _ in
            try UpdateExecutor.replaceFile(from: backup, to: live, in: directory)
        })
        try check(forward == 1, "Restart ran forward replacement twice")
        try check(Data(contentsOf: URL(fileURLWithPath: live)) == Data("old".utf8), "Rollback did not restore bytes")
        let result = try restarted.load()
        try check(result.highWater == 14 && result.attempt?.execution == .rolledBack, "Rollback erased consumed evidence")
        try check(result.attempt?.receipt.phase == .installationAuthorized && result.attempt?.receipt.blockedReason == .installationUncertain,
                  "Rollback fabricated successful identity/recovery")
        try check(FileManager.default.fileExists(atPath: backup), "Rollback asset was deleted")
    }

    test("successor-incarnation-components-and-recovery-binding") { directory in
        let store = try UpdateStorage(root: directory)
        var recovery: UpdateContractV1.Protection = .protectedOffline
        var refusePhase: UpdateContractV1.Phase?
        var failAdoptionSync = false
        var observedProtection: UpdateContractV1.Protection = .connected
        var io = effects()
        io.observe = { observedProtection }
        io.recovery = { _ in recovery }
        let engine = UpdateTransaction(storage: store, effects: io, persist: { candidate in
            if let refusePhase, candidate.attempt?.receipt.phase == refusePhase {
                throw HelperFailure.system("injected owner-boundary write failure")
            }
            if failAdoptionSync && candidate.attempt?.receipt.phase == .installedIdentityVerified {
                try UpdateStorage.write(UpdateContractV1.canonical(candidate), to: directory + "/ledger.json",
                    synchronizeDirectory: { _ in throw HelperFailure.system("injected adoption directory sync failure") })
            } else { try store.save(candidate) }
        })
        try reserved(store, engine)
        // Preparation is now protected offline; capture was Connected.
        observedProtection = .protectedOffline
        try engine.execute(peer: owner)
        try refuses { try engine.reconcile(peer: successor) }
        try UpdateExecutor.perform(storage: store, validate: { _ in }, replace: { _ in }, rollback: { _ in })
        try refuses { try engine.reconcile(peer: owner) }
        let wrongOwner = TonoAuthenticatedPeer(uid: 502, auditToken: successor.auditToken, bundleURL: owner.bundleURL)
        try refuses { try engine.reconcile(peer: wrongOwner) }
        var wrong = io
        wrong.installedComponents = { .init(appSha256: String(repeating: "e", count: 64), coreSha256: components.coreSha256, privilegedSha256: components.privilegedSha256) }
        try refuses { try UpdateTransaction(storage: store, effects: wrong).reconcile(peer: successor) }
        refusePhase = .installedIdentityVerified
        try refuses { try engine.reconcile(peer: successor) }
        try check(store.load().attempt?.successorToken == nil && store.load().generation == 1,
                  "Failed adoption published a successor grant")
        refusePhase = nil
        failAdoptionSync = true
        try refuses { try engine.reconcile(peer: successor) }
        var allowAdoptionRetry = false
        let uncertainStore = try UpdateStorage(root: directory, synchronizeDirectory: { path in
            guard allowAdoptionRetry else { throw HelperFailure.system("injected adoption retry failure") }
            try UpdateStorage.syncDirectory(path)
        })
        let uncertain = UpdateTransaction(storage: uncertainStore, effects: io)
        try refuses { try uncertain.gate(method: "POST", path: "/core/start", peer: successor) }
        allowAdoptionRetry = true
        try uncertain.gate(method: "POST", path: "/core/start", peer: successor)
        failAdoptionSync = false
        try engine.reconcile(peer: successor)
        let generation = try store.load().generation
        try engine.reconcile(peer: successor)
        try check(store.load().generation == generation, "Idempotent query allocated a second successor")
        try refuses { try engine.commit(peer: successor) } // Protected Offline is not captured Connected.
        try check(store.load().attempt?.receipt.phase == .installedIdentityVerified, "Wrong recovery committed")
        recovery = .connected
        refusePhase = .recoveryVerified
        try refuses { try engine.commit(peer: successor) }
        try check(store.load().attempt?.receipt.phase == .installedIdentityVerified, "Failed recovery write advanced proof")
        refusePhase = .committed
        try refuses { try engine.commit(peer: successor) }
        try check(store.load().attempt?.receipt.phase == .recoveryVerified, "Failed commit released pending state")
        refusePhase = nil
        try engine.commit(peer: successor)
        try check(store.load().attempt?.receipt.phase == .committed, "Verified successor did not commit")
    }

    test("explicit-disconnect-retains-consumed-obligation") { directory in
        let store = try UpdateStorage(root: directory)
        var releases = 0
        var io = effects()
        io.disconnect = { releases += 1 }
        let engine = UpdateTransaction(storage: store, effects: io)
        try reserved(store, engine)
        try engine.execute(peer: owner)
        let obligation = try store.load().attempt?.receipt.requiredRecovery
        try refuses { try engine.cancel(peer: owner) }
        try engine.disconnect(peer: owner)
        let result = try store.load()
        try check(releases == 1 && result.attempt?.disconnectVerified == true, "Explicit release was not recorded")
        try check(result.highWater == 14 && result.attempt?.execution == .consumed
                  && result.attempt?.receipt.requiredRecovery == obligation
                  && result.attempt?.receipt.phase == .installationAuthorized, "Disconnect fabricated update completion")
        try refuses { try engine.execute(peer: owner) }
        try refuses { try engine.retireUnconsumed(peer: owner) }
        try refuses { try engine.gate(method: "POST", path: "/helper/upgrade", peer: owner) }
        try refuses { try engine.gate(method: "POST", path: "/core/start", peer: successor) }
    }

    test("unconsumed-retirement-archives-before-new-admission") { directory in
        let store = try UpdateStorage(root: directory)
        var baseline = UpdateStorage.Ledger()
        baseline.highWater = 7
        try store.save(baseline)
        var observed: UpdateContractV1.Protection = .protectedOffline
        var refuseRetirementWrite = false
        var io = effects()
        io.observe = { observed }
        let engine = UpdateTransaction(storage: store, effects: io, persist: { candidate in
            if candidate.attempt == nil && refuseRetirementWrite {
                throw HelperFailure.system("injected retirement write failure")
            }
            try store.save(candidate)
        })
        try engine.reserve(peer: owner, manifest: manifest, manifestBytes: UpdateContractV1.canonical(manifest), signature: Data())
        try engine.cancel(peer: owner)
        guard let original = try store.load().attempt else { throw HelperFailure.invalid("Missing cancelled attempt") }
        try refuses { try engine.retireUnconsumed(peer: owner) }
        try engine.disconnect(peer: owner)
        // A recorded release Boolean is insufficient; real readback must agree.
        try refuses { try engine.retireUnconsumed(peer: owner) }
        observed = .unprotected
        let wrongOwner = TonoAuthenticatedPeer(uid: 502, auditToken: successor.auditToken, bundleURL: owner.bundleURL)
        try refuses { try engine.retireUnconsumed(peer: wrongOwner) }
        refuseRetirementWrite = true
        try refuses { try engine.retireUnconsumed(peer: owner) }
        try check(store.load().attempt?.receipt.attemptId == original.receipt.attemptId, "Failed retirement released the active attempt")
        try refuses { try engine.reserve(peer: successor, manifest: manifest, manifestBytes: UpdateContractV1.canonical(manifest), signature: Data()) }
        refuseRetirementWrite = false
        try engine.retireUnconsumed(peer: owner)
        let retired = try store.load()
        try check(retired.attempt == nil && retired.highWater == 7 && retired.generation == 1, "Retirement erased ordering evidence")
        let archive = try UpdateStorage.read(directory + "/" + original.receipt.attemptId + ".json", maximum: 128 * 1024)
        let retained = try JSONDecoder().decode(UpdateStorage.Attempt.self, from: archive)
        try check(retained.receipt.blockedReason == .cancelled && retained.receipt.phase == .preparing
                  && retained.receipt.requiredRecovery == .protectedOffline && retained.disconnectVerified,
                  "Retirement rewrote the obligation or deleted failure evidence")
        try engine.reserve(peer: successor, manifest: manifest, manifestBytes: UpdateContractV1.canonical(manifest), signature: Data())
        let fresh = try store.load()
        try check(fresh.generation == 2 && fresh.highWater == 7 && fresh.attempt?.receipt.attemptId != original.receipt.attemptId,
                  "Retry reused a retired grant or lost high-water")
    }

    test("old-mapped-process-refused-after-disk-replacement") { directory in
        let path = directory + "/process"
        try FileManager.default.copyItem(atPath: "/bin/sleep", toPath: path)
        let child = Process()
        child.executableURL = URL(fileURLWithPath: path)
        child.arguments = ["20"]
        try child.run()
        defer { if child.isRunning { child.terminate() }; child.waitUntilExit() }
        func identities() throws -> (SecCode, SecStaticCode) {
            var dynamic: SecCode?
            var installed: SecStaticCode?
            guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid: child.processIdentifier] as CFDictionary, [], &dynamic) == errSecSuccess,
                  let dynamic, SecStaticCodeCreateWithPath(URL(fileURLWithPath: path) as CFURL, [], &installed) == errSecSuccess,
                  let installed else { throw HelperFailure.invalid("Cannot inspect native fixture process") }
            return (dynamic, installed)
        }
        usleep(100_000)
        let before = try identities()
        try UpdatePackage.sameCode(before.0, installed: before.1)
        try UpdateExecutor.replaceFile(from: "/bin/cat", to: path, in: directory)
        let after = try identities() // Fresh lookup; never reuse cached SecCode metadata.
        try refuses { try UpdatePackage.sameCode(after.0, installed: after.1) }
        try check(child.isRunning, "Fixture exited before stale-mapped identity was checked")
    }
    test("startup-interrupted-by-own-executor-bootout-does-not-arm-emergency-block") { directory in
        // The executor holds the lock (perform/validate runs for seconds);
        // the daemon's startup waits behind it and receives the bootout SIGTERM.
        let holder = try UpdateStorage(root: directory)
        var armed = 0
        try holder.locked {
            let daemon = try UpdateStorage(root: directory)
            helperShutdownRequested = 1
            defer { helperShutdownRequested = 0 }
            let clean = try UpdateExecutor.startup(storage: daemon, emergencyBlock: { armed += 1 })
            try check(clean, "A bootout while waiting behind the executor's lock is a clean stop")
        }
        try check(armed == 0, "Executor bootout during startup armed the emergency block")
        // Only the bootout whitelist is clean; an unreadable ledger keeps
        // arming the fail-closed barrier and stops launch as before.
        let corrupt = try UpdateStorage(root: directory + "/corrupt")
        try UpdateStorage.write(Data("not a ledger".utf8), to: directory + "/corrupt/ledger.json")
        var corrupted = 0
        try refuses {
            _ = try UpdateExecutor.startup(storage: corrupt, emergencyBlock: { corrupted += 1 })
        }
        try check(corrupted == 1, "Corrupt-ledger startup stopped arming the emergency block")
    }
    test("rolled-back-attempt-can-be-retired-after-verified-disconnect") { directory in
        let store = try UpdateStorage(root: directory)
        var observed: UpdateContractV1.Protection = .protectedOffline
        var io = effects()
        io.observe = { observed }
        let engine = UpdateTransaction(storage: store, effects: io)
        try reserved(store, engine)
        try engine.execute(peer: owner)
        // The executor's replacement fails and the rollback restores the
        // captured installation: the attempt is consumed and rolled back.
        try UpdateExecutor.perform(storage: store, validate: { _ in }, replace: { _ in
            throw HelperFailure.system("injected replacement failure")
        }, rollback: { _ in })
        try check(store.load().attempt?.execution == .rolledBack, "Fixture must reach a rolled-back consumed attempt")
        let attemptId = try store.load().attempt?.receipt.attemptId
        try engine.disconnect(peer: owner)
        observed = .unprotected
        // Today's unconsumed-only retirement refused here and every gate
        // stayed closed forever; the resolved archive must end the attempt.
        try engine.retire(peer: owner)
        let ledger = try store.load()
        try check(ledger.attempt == nil && ledger.highWater == 14 && ledger.generation == 1,
                  "A verified rollback must archive without lowering the high-water mark or generation")
        let archive = try UpdateStorage.read(directory + "/" + (attemptId ?? "") + ".json", maximum: 128 * 1024)
        let retained = try JSONDecoder().decode(UpdateStorage.Attempt.self, from: archive)
        try check(retained.execution == .rolledBack && retained.receipt.blockedReason == .installationUncertain
                  && retained.disconnectVerified && retained.receipt.phase == .installationAuthorized,
                  "Resolved retirement erased failure evidence or fabricated a proof phase")
        try engine.gate(method: "POST", path: "/core/start", peer: successor)
    }
    test("successor-relaunch-after-adoption-can-be-readopted-and-commit") { directory in
        let store = try UpdateStorage(root: directory)
        var successorAlive = true
        var io = effects()
        io.successorAlive = { _ in successorAlive }
        let engine = UpdateTransaction(storage: store, effects: io)
        try reserved(store, engine)
        try engine.execute(peer: owner)
        try UpdateExecutor.perform(storage: store, validate: { _ in }, replace: { _ in }, rollback: { _ in })
        try check(store.load().attempt?.execution == .replaced, "Fixture must reach a replaced installation")
        try engine.reconcile(peer: successor)
        let relaunched = TonoAuthenticatedPeer(uid: 501, auditToken: Data("third-incarnation".utf8), bundleURL: owner.bundleURL)
        // While the bound successor is provably alive, its grant is exclusive.
        try refuses { try engine.reconcile(peer: relaunched) }
        try check(store.load().attempt?.successorToken == successor.auditToken && store.load().generation == 2,
                  "A live bound successor lost its grant")
        // The bound incarnation exits; the executor-relaunched App re-binds
        // the grant (fresh generation, same proof phase) and can commit.
        successorAlive = false
        try engine.reconcile(peer: relaunched)
        let ledger = try store.load()
        try check(ledger.generation == 3 && ledger.attempt?.successorToken == relaunched.auditToken
                  && ledger.attempt?.receipt.phase == .installedIdentityVerified
                  && ledger.attempt?.receipt.successorGeneration == 3,
                  "Re-adoption must allocate a fresh successor generation without changing the proof phase")
        try engine.commit(peer: relaunched)
        try check(store.load().attempt?.receipt.phase == .committed, "A relaunched successor must be able to commit")
    }
    test("ledger-ignores-additive-fields-and-refuses-a-newer-schema-major") { directory in
        let store = try UpdateStorage(root: directory)
        try reserved(store, UpdateTransaction(storage: store, effects: effects()))
        let path = directory + "/ledger.json"
        let before = try store.load()
        guard var file = try JSONSerialization.jsonObject(with: UpdateStorage.read(path, maximum: 128 * 1024)) as? [String: Any],
              var attempt = file["attempt"] as? [String: Any] else { throw HelperFailure.invalid("Fixture ledger is not an object") }
        // What a later helper may add within schema 1: optional, safe to drop.
        attempt["futureFact"] = "x"
        file["attempt"] = attempt
        file["futureFact"] = true
        try UpdateStorage.write(JSONSerialization.data(withJSONObject: file, options: [.sortedKeys]), to: path)
        let loaded = try store.load()
        try check(loaded.generation == before.generation && loaded.highWater == before.highWater
                  && loaded.attempt?.receipt.attemptId == before.attempt?.receipt.attemptId
                  && loaded.attempt?.execution == before.attempt?.execution,
                  "Additive fields from a newer helper must not read as a corrupt ledger")
        file["schemaVersion"] = 2
        let newer = try JSONSerialization.data(withJSONObject: file, options: [.sortedKeys])
        try UpdateStorage.write(newer, to: path)
        var refusal = ""
        do { _ = try store.load() } catch HelperFailure.invalid(let message) { refusal = message }
        try check(refusal.contains("newer Tono (schema 2)"), "A newer schema major must be refused as newer, not corrupt")
        try check(UpdateStorage.read(path, maximum: 128 * 1024) == newer, "Newer evidence must be retained")
    }
    // Tono.app dragged to the Trash left a KeepAlive helper that re-armed PF
    // at every boot with no app left to release it (H19-O-F1). A helper start
    // releases and removes the installation only when no Tono app is left in
    // Applications and no update attempt could be putting one back.
    test("helper-start-releases-only-when-tono-was-removed") { directory in
        let applications = directory + "/Applications"
        try FileManager.default.createDirectory(atPath: applications, withIntermediateDirectories: true)
        var releases = 0
        let release: (UpdateStorage) -> Bool = { _ in releases += 1; return true }
        let idle = try UpdateStorage(root: directory + "/idle")
        let renamed = applications + "/Tono Beta.app/Contents"
        try FileManager.default.createDirectory(atPath: renamed, withIntermediateDirectories: true)
        try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": "com.raydocs.tono"],
                                           format: .xml, options: 0)
            .write(to: URL(fileURLWithPath: renamed + "/Info.plist"))
        try check(!releaseIfTonoWasRemoved(storage: idle, applicationsDirectory: applications,
                                           userApplicationsDirectory: nil, clientRunning: { false }, release: release)
                  && releases == 0, "A renamed Tono app in Applications lost its protection")
        try FileManager.default.removeItem(atPath: applications + "/Tono Beta.app")
        let updating = try UpdateStorage(root: directory + "/updating")
        try reserved(updating, UpdateTransaction(storage: updating, effects: effects()))
        try check(!releaseIfTonoWasRemoved(storage: updating, applicationsDirectory: applications,
                                           userApplicationsDirectory: nil, clientRunning: { false }, release: release)
                  && releases == 0, "An unfinished update lost its protection while the app was away")
        try check(!releaseIfTonoWasRemoved(storage: idle, applicationsDirectory: directory + "/unreadable",
                                           userApplicationsDirectory: nil, clientRunning: { false },
                                           release: release) && releases == 0,
                  "An Applications folder that cannot be read counted as no app")
        try check(releaseIfTonoWasRemoved(storage: idle, applicationsDirectory: applications,
                                          userApplicationsDirectory: nil, clientRunning: { false }, release: release)
                  && releases == 1, "A helper whose app was removed kept its installation")
    }
    // The running app moved to ~/Applications and a helper restart released
    // PF under it; a later launch from there refused to start and reinstall
    // looped. A running Tono client or Tono.app in the bound user's
    // ~/Applications keeps the installation (MA-Codex-1).
    test("helper-start-keeps-protection-for-a-running-or-user-folder-tono") { directory in
        let applications = directory + "/Applications"
        let userApplications = directory + "/home/Applications"
        try FileManager.default.createDirectory(atPath: applications, withIntermediateDirectories: true)
        var releases = 0
        let release: (UpdateStorage) -> Bool = { _ in releases += 1; return true }
        let idle = try UpdateStorage(root: directory + "/idle")
        try check(!releaseIfTonoWasRemoved(storage: idle, applicationsDirectory: applications,
                                           userApplicationsDirectory: nil, clientRunning: { true }, release: release)
                  && releases == 0, "A running Tono client lost its protection at a helper restart")
        try FileManager.default.createDirectory(atPath: userApplications + "/Tono.app/Contents",
                                                withIntermediateDirectories: true)
        try check(!releaseIfTonoWasRemoved(storage: idle, applicationsDirectory: applications,
                                           userApplicationsDirectory: userApplications, clientRunning: { false },
                                           release: release) && releases == 0,
                  "Tono.app in ~/Applications lost its protection")
        // Only a process whose kernel short name is "Tono" is a candidate. A
        // candidate whose path or signature cannot be looked up may be Tono
        // with its bundle deleted under it: doubt keeps protection unless it
        // definitely exited (live: false) or definitely fails the requirement
        // (signed: false). Any other process, or a failed name lookup, is
        // skipped even when its other lookups fail.
        let tono = "/Users/a/Applications/Tono.app" + UpdatePackage.appExecutable
        let candidate: (Int32) -> String? = { _ in "Tono" }
        try check(tonoClientAmong([42], name: candidate, path: { _ in nil }, live: { _ in true },
                                  signed: { _ in false }),
                  "A live candidate whose path lookup failed counted as no Tono client")
        try check(tonoClientAmong([42], name: candidate, path: { _ in nil }, live: { _ in nil },
                                  signed: { _ in false }),
                  "A candidate whose liveness lookup failed counted as exited")
        try check(tonoClientAmong([42], name: candidate, path: { _ in tono }, live: { _ in true },
                                  signed: { _ in nil }),
                  "A candidate whose signature check errored counted as not Tono")
        try check(!tonoClientAmong([42], name: candidate, path: { _ in nil }, live: { _ in false },
                                   signed: { _ in nil })
                  && !tonoClientAmong([42], name: candidate, path: { _ in tono }, live: { _ in true },
                                      signed: { _ in false }),
                  "An exited candidate or a requirement mismatch counted as a Tono client")
        try check(!tonoClientAmong([42], name: { _ in "mdworker" }, path: { _ in nil }, live: { _ in nil },
                                   signed: { _ in nil })
                  && !tonoClientAmong([42], name: { _ in nil }, path: { _ in nil }, live: { _ in true },
                                      signed: { _ in nil }),
                  "A non-candidate or unnamed process with failing lookups counted as a Tono client")
        // Hosted runner: no signed Tono client runs, so the real scan must not
        // fall back to doubt (requirement, pid listing or lookup failure).
        try check(!tonoClientProcessRunning(), "The Tono process scan found a client on a host without Tono")
    }
    print("Update production-bound tests: \(13 - failures.count) passed, \(failures.count) failed; native-device acceptance NOT performed")
    return failures.isEmpty
}
