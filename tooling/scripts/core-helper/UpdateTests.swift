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
            try body(temporary.resolvingSymlinksInPath().path)
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
        var launches = 0
        var io = effects()
        io.launchExecutor = { _ in launches += 1 }
        let engine = UpdateTransaction(storage: store, effects: io, persist: { candidate in
            if candidate.attempt?.execution == .consumed && failWrite { throw HelperFailure.system("injected write failure") }
            try store.save(candidate)
        })
        try reserved(store, engine)
        let before = try UpdateStorage.read(directory + "/ledger.json", maximum: 128 * 1024)
        try refuses { try engine.execute(peer: owner) }
        try check(launches == 0, "Executor launched before consumed write")
        try check(UpdateStorage.read(directory + "/ledger.json", maximum: 128 * 1024) == before, "Failed consume changed disk")
        failWrite = false
        try engine.execute(peer: owner)
        let loaded = try UpdateStorage(root: directory)
        let restarted = UpdateTransaction(storage: loaded, effects: io)
        var durable = try loaded.load()
        try check(durable.highWater == 14 && durable.attempt?.execution == .consumed, "Consumed evidence missing after reload")
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
        var recovery: UpdateContractV1.Protection = .connected
        var refusePhase: UpdateContractV1.Phase?
        var io = effects()
        io.recovery = { _ in recovery }
        let engine = UpdateTransaction(storage: store, effects: io, persist: { candidate in
            if let refusePhase, candidate.attempt?.receipt.phase == refusePhase {
                throw HelperFailure.system("injected owner-boundary write failure")
            }
            try store.save(candidate)
        })
        try reserved(store, engine)
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
        try engine.reconcile(peer: successor)
        let generation = try store.load().generation
        try engine.reconcile(peer: successor)
        try check(store.load().generation == generation, "Idempotent query allocated a second successor")
        try refuses { try engine.commit(peer: successor) } // Connected is not captured Protected Offline.
        try check(store.load().attempt?.receipt.phase == .installedIdentityVerified, "Wrong recovery committed")
        recovery = .protectedOffline
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
        try refuses { try engine.gate(method: "POST", path: "/helper/upgrade", peer: owner) }
        try refuses { try engine.gate(method: "POST", path: "/core/start", peer: successor) }
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
    print("Update production-bound tests: \(6 - failures.count) passed, \(failures.count) failed; native-device acceptance NOT performed")
    return failures.isEmpty
}
