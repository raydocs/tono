import Foundation
import Darwin
import Security

/// All methods run under storage.locked, including ordinary IPC interlocks.
/// Effects are substituted only by the standalone native regression harness;
/// SocketServer always constructs live effects, never from request data/env.
final class UpdateTransaction {
    struct Effects {
        var authenticate: (TonoAuthenticatedPeer) throws -> Void
        var installedFloor: () throws -> UInt64
        var installedComponents: () throws -> UpdateContractV1.Components
        var stage: (String, uid_t, UpdateContractV1.ReleaseManifest, String) throws -> UpdateContractV1.Components
        var observe: () throws -> UpdateContractV1.Protection
        var prepare: (UpdateContractV1.Protection) throws -> UpdateContractV1.Protection
        var recovery: (Bool) throws -> UpdateContractV1.Protection
        var disconnect: () throws -> Void
        var launchExecutor: (UpdateStorage.Attempt) throws -> Void
        var cleanupCommitted: () throws -> Void = {}
        /// Whether a bound successor's audit token still resolves to a live
        /// process. Re-adoption is allowed only when this is false (or the
        /// recorded boot session has ended).
        var successorAlive: (Data) -> Bool = UpdateExecutor.processExists
    }

    let storage: UpdateStorage
    private let effects: Effects
    private let persist: (UpdateStorage.Ledger) throws -> Void
    private let now: () -> UInt64

    init(storage: UpdateStorage, effects: Effects,
         persist: ((UpdateStorage.Ledger) throws -> Void)? = nil,
         now: @escaping () -> UInt64 = { UInt64(max(0, Date().timeIntervalSince1970)) }) {
        self.storage = storage
        self.effects = effects
        self.persist = persist ?? storage.save
        self.now = now
    }

    static func live(storage: UpdateStorage, runtime: UpdateRuntime) -> UpdateTransaction {
        UpdateTransaction(storage: storage, effects: Effects(
            authenticate: UpdatePackage.livePeer,
            installedFloor: {
                _ = try UpdatePackage.verifyCode(UpdatePackage.appPath, identifier: "com.raydocs.tono")
                return try UpdatePackage.buildSource(UpdatePackage.appPath).releaseSequence!
            },
            installedComponents: {
                try UpdatePackage.runningHelperMatchesInstalled()
                return try UpdatePackage.components(UpdatePackage.appPath, installed: true)
            },
            stage: UpdateExecutor.stage,
            observe: runtime.observe,
            prepare: runtime.prepare,
            recovery: runtime.verifyRecovery,
            disconnect: runtime.disconnect,
            launchExecutor: { try UpdateExecutor.launch(storage: storage, attempt: $0) },
            cleanupCommitted: UpdateExecutor.retire
        ))
    }

    static func owner(_ peer: TonoAuthenticatedPeer) -> String { "uid:\(peer.uid):YY57758GS7:com.raydocs.tono" }
    static let location = UpdateStorage.digest(Data("com.raydocs.tono\n/Applications/Tono.app\n".utf8))

    func offer(peer: TonoAuthenticatedPeer, manifest: Data, signature: Data) throws -> Bool {
        let verified = try UpdatePackage.verifyManifest(manifest, signature: signature)
        try effects.authenticate(peer)
        let ledger = try storage.load()
        guard ledger.attempt == nil || ledger.attempt?.receipt.phase == .committed else {
            throw HelperFailure.invalid("Resolve the pending update before accepting another offer.")
        }
        return try verified.releaseSequence > max(ledger.highWater, effects.installedFloor())
    }

    func status() throws -> [String: Any] {
        guard let attempt = try storage.load().attempt else { return ["ok": true, "pending": false] }
        let pending = attempt.receipt.phase != .committed
        var result: [String: Any] = [
            "ok": true, "pending": pending,
            "receipt": try JSONSerialization.jsonObject(with: UpdateContractV1.canonical(attempt.receipt)),
            "execution": attempt.execution.rawValue,
            "disconnectVerified": attempt.disconnectVerified,
        ]
        if pending && (now() < attempt.receipt.updatedAtUnix || now() >= attempt.receipt.expiresAtUnix) {
            result["diagnostic"] = "Update record expired or clock moved backwards; protection and evidence retained."
        }
        return result
    }

    /// A lost consume acknowledgement may also precede launchd registration.
    /// A query from the same initiating incarnation repairs only that one
    /// consumed executor entry; it never consumes or authorizes a new install.
    func resumeConsumedExecutor(peer: TonoAuthenticatedPeer) throws {
        let ledger = try storage.load()
        guard let attempt = ledger.attempt, attempt.execution == .consumed,
              attempt.receipt.blockedReason == nil, !attempt.disconnectRequested,
              attempt.initiatingToken == peer.auditToken,
              attempt.initiatingBoot == (try TonoAuthenticatedPeer.bootSession()) else { return }
        _ = try bound(ledger, peer: peer, initiating: true)
        try effects.launchExecutor(attempt)
    }

    func stage(peer: TonoAuthenticatedPeer, manifestBytes: Data, signature: Data, packagePath: String) throws {
        // Signature refusal occurs before reserving or touching the network.
        let manifest = try UpdatePackage.verifyManifest(manifestBytes, signature: signature)
        try reserve(peer: peer, manifest: manifest, manifestBytes: manifestBytes, signature: signature)
        var ledger = try storage.load()
        guard var attempt = ledger.attempt else { throw HelperFailure.invalid("Missing reserved update.") }
        do {
            let directory = storage.attemptDirectory(attempt)
            guard try effects.stage(packagePath, peer.uid, manifest, directory) == attempt.originalComponents else {
                throw HelperFailure.invalid("The installed components changed after reservation.")
            }
            attempt.execution = .staged
            ledger.attempt = attempt
            try persist(ledger)
        } catch {
            // Keep the reserved receipt and any partial private staging; never
            // erase forensic input or resume by overwriting this attempt.
            try block(.preparationFailed, ledger: storage.load())
            throw error
        }
    }

    /// Signature verification stays at the only production admission caller.
    /// Tests call this boundary with a typed fixture to exercise actual durable
    /// reservation, not to claim that unsigned fixtures are release evidence.
    func reserve(peer: TonoAuthenticatedPeer, manifest: UpdateContractV1.ReleaseManifest,
                 manifestBytes: Data, signature: Data) throws {
        try effects.authenticate(peer)
        var ledger = try storage.load()
        guard ledger.attempt == nil || ledger.attempt?.receipt.phase == .committed else {
            throw HelperFailure.invalid("An update attempt is already pending. Query or recover it; do not reinstall.")
        }
        guard manifest.releaseSequence > ledger.highWater,
              manifest.releaseSequence > (try effects.installedFloor()) else {
            throw HelperFailure.invalid("Update release sequence is stale or already consumed.")
        }
        let protection = try effects.observe()
        guard protection != .unknown else { throw HelperFailure.invalid("Unknown network protection refuses update admission.") }
        let original = try effects.installedComponents()
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess,
              ledger.generation < UpdateContractV1.maxInteger - 1 else { throw HelperFailure.system("Cannot allocate update identity.") }
        let time = now()
        guard time > 0, time < UpdateContractV1.maxInteger - 172_800 else { throw HelperFailure.invalid("Invalid update clock.") }
        if let previous = ledger.attempt {
            try effects.cleanupCommitted()
            try UpdateStorage.write(UpdateContractV1.canonical(previous), to: storage.root + "/" + previous.receipt.attemptId + ".json")
        }
        ledger.generation += 1
        let receipt = UpdateContractV1.Receipt(
            attemptId: random.map { String(format: "%02x", $0) }.joined(), blockedReason: nil,
            createdAtUnix: time, expiresAtUnix: time + 172_800, initiatingGeneration: ledger.generation,
            installedLocationSha256: Self.location, kind: "tonoUpdateReceipt",
            manifestSha256: try manifest.sha256(), owner: Self.owner(peer), phase: .preparing,
            protocolVersion: 1, requiredRecovery: protection, successorGeneration: nil,
            targetId: .macosArm64, updatedAtUnix: time
        )
        ledger.attempt = .init(manifest: manifestBytes, signature: signature, receipt: receipt,
                               initiatingToken: peer.auditToken, initiatingBoot: try TonoAuthenticatedPeer.bootSession(),
                               successorToken: nil, successorBoot: nil, execution: .reserved,
                               originalComponents: original, requiresTUN: if_nametoindex("utun199") != 0,
                               disconnectRequested: false, disconnectVerified: false)
        try persist(ledger) // Before private ownership transfer or runtime changes.
    }

    func prepare(peer: TonoAuthenticatedPeer) throws {
        var ledger = try storage.load()
        var attempt = try bound(ledger, peer: peer, initiating: true)
        guard attempt.execution == .staged, attempt.receipt.phase == .preparing else {
            throw HelperFailure.invalid("Update is not privately staged.")
        }
        do {
            let manifest = try UpdateContractV1.ReleaseManifest.decode(attempt.manifest)
            let protection = try effects.prepare(attempt.receipt.requiredRecovery)
            attempt.receipt = try attempt.receipt.propose(manifest: manifest,
                context: context(attempt, peer: peer),
                observation: .preparationVerified(artifactSha256: manifest.target(.macosArm64).artifactSha256, protection: protection))
            ledger.attempt = attempt
            try persist(ledger)
        } catch {
            try block(.preparationFailed, ledger: storage.load())
            throw error
        }
    }

    func execute(peer: TonoAuthenticatedPeer) throws {
        var ledger = try storage.load()
        let attempt = try bound(ledger, peer: peer, initiating: true)
        // Lost ACK is status-only: it may re-start the independent recovery
        // entry, but cannot mint another consume or another install.
        if attempt.execution == .staged {
            guard attempt.receipt.phase == .installationAuthorized else {
                throw HelperFailure.invalid("Update preparation has not authorized installation.")
            }
            let observed = try effects.observe()
            let expected: UpdateContractV1.Protection = attempt.receipt.requiredRecovery == .unprotected ? .unprotected : .protectedOffline
            guard observed == expected else { throw HelperFailure.invalid("Protection changed before update consumption.") }
            try consume(&ledger)
        }
        guard let consumed = ledger.attempt, consumed.execution == .consumed else {
            throw HelperFailure.invalid("Update has already executed; reconcile its durable state.")
        }
        try effects.launchExecutor(consumed)
    }

    func consume(_ ledger: inout UpdateStorage.Ledger) throws {
        guard var attempt = ledger.attempt, attempt.execution == .staged,
              attempt.receipt.phase == .installationAuthorized, attempt.receipt.blockedReason == nil,
              !attempt.disconnectRequested else { throw HelperFailure.invalid("Update consumption refused.") }
        let manifest = try UpdateContractV1.ReleaseManifest.decode(attempt.manifest)
        guard manifest.releaseSequence > ledger.highWater else { throw HelperFailure.invalid("Update sequence already consumed.") }
        var candidate = ledger
        candidate.highWater = manifest.releaseSequence
        attempt.execution = .consumed
        candidate.attempt = attempt
        try persist(candidate) // Both facts, atomically, BEFORE executor registration or mutation.
        ledger = candidate
    }

    func reconcile(peer: TonoAuthenticatedPeer) throws {
        var ledger = try storage.load()
        guard var attempt = ledger.attempt, attempt.receipt.phase != .committed else { return }
        try effects.authenticate(peer)
        try validTime(attempt)
        let boot = try TonoAuthenticatedPeer.bootSession()
        guard attempt.receipt.owner == Self.owner(peer), attempt.receipt.blockedReason == nil,
              !attempt.disconnectRequested, attempt.execution == .replaced,
              attempt.initiatingToken != peer.auditToken || attempt.initiatingBoot != boot else { throw HelperFailure.invalid("Pending update needs recovery; no successor grant.") }
        let manifest = try UpdateContractV1.ReleaseManifest.decode(attempt.manifest)
        let components = try effects.installedComponents()
        guard components == (try manifest.target(.macosArm64).components) else { throw HelperFailure.invalid("Installed update components differ.") }
        if let token = attempt.successorToken {
            guard token == peer.auditToken, attempt.successorBoot == boot else {
                // The successor grant binds one live incarnation, not the first
                // one forever. A recorded successor from another boot cannot
                // authenticate in this one, and a same-boot token that no
                // longer resolves to a live process has exited — the
                // executor's own relaunch path creates exactly that successor.
                // While the bound successor is provably alive, nobody else
                // may take the grant.
                guard attempt.successorBoot != boot || !effects.successorAlive(token) else {
                    throw HelperFailure.invalid("Update successor incarnation changed; recovery remains pending.")
                }
                guard ledger.generation < UpdateContractV1.maxInteger else { throw HelperFailure.invalid("Update generation exhausted.") }
                ledger.generation += 1
                // Change the generation, not the phase: the durable proof
                // phase and its evidence stay untouched (the shared receipt
                // model has no re-adoption proposal from
                // installedIdentityVerified), and only the incarnation grant
                // moves to the freshly authenticated live successor.
                attempt.receipt.successorGeneration = ledger.generation
                attempt.receipt.updatedAtUnix = now()
                attempt.successorToken = peer.auditToken
                attempt.successorBoot = boot
                ledger.attempt = attempt
                try persist(ledger)
                return
            }
            return
        }
        guard ledger.generation < UpdateContractV1.maxInteger else { throw HelperFailure.invalid("Update generation exhausted.") }
        ledger.generation += 1
        attempt.receipt = try attempt.receipt.propose(manifest: manifest,
            context: context(attempt, peer: peer, generation: ledger.generation),
            observation: .installedIdentityVerified(components: components))
        attempt.successorToken = peer.auditToken
        attempt.successorBoot = boot
        ledger.attempt = attempt
        try persist(ledger)
    }

    func commit(peer: TonoAuthenticatedPeer) throws {
        var ledger = try storage.load()
        guard ledger.attempt?.receipt.phase != .committed else { try effects.cleanupCommitted(); return }
        var attempt = try bound(ledger, peer: peer, initiating: false)
        let manifest = try UpdateContractV1.ReleaseManifest.decode(attempt.manifest)
        if attempt.receipt.phase == .installedIdentityVerified {
            attempt.receipt = try attempt.receipt.propose(manifest: manifest,
                context: context(attempt, peer: peer),
                observation: .recoveryVerified(components: effects.installedComponents(), protection: effects.recovery(attempt.requiresTUN)))
            ledger.attempt = attempt
            try persist(ledger)
        }
        // Revalidate the live process, binaries and network again after the
        // recovery write. A reconnect/exit/power transition is not a commit.
        try effects.authenticate(peer)
        attempt.receipt = try attempt.receipt.propose(manifest: manifest,
            context: context(attempt, peer: peer),
            observation: .commitVerified(components: effects.installedComponents(), protection: effects.recovery(attempt.requiresTUN)))
        ledger.attempt = attempt
        try persist(ledger)
        try effects.cleanupCommitted()
        // Rollback assets are deliberately retained even after commit for now;
        // garbage collection is not part of transaction correctness.
    }

    func cancel(peer: TonoAuthenticatedPeer) throws {
        let ledger = try storage.load()
        let attempt = try bound(ledger, peer: peer, initiating: true)
        guard attempt.execution == .reserved || attempt.execution == .staged else {
            throw HelperFailure.invalid("Consumed updates cannot be cancelled.")
        }
        try block(.cancelled, ledger: ledger)
    }

    func disconnect(peer: TonoAuthenticatedPeer) throws {
        var ledger = try storage.load()
        guard var attempt = ledger.attempt, attempt.receipt.phase != .committed else {
            throw HelperFailure.invalid("No pending update owns Disconnect.")
        }
        // Expiry/blocked status does not deny a real owner's explicit release.
        try effects.authenticate(peer)
        guard attempt.receipt.owner == Self.owner(peer) else { throw HelperFailure.invalid("Update Disconnect owner differs.") }
        attempt.disconnectRequested = true
        ledger.attempt = attempt
        try persist(ledger)
        try effects.disconnect()
        attempt.disconnectVerified = true
        ledger.attempt = attempt
        try persist(ledger)
        // Do not rewrite requiredRecovery, relabel a phase, clear highWater or
        // erase a consumed attempt. This is not cancellation or commit.
    }

    func retireUnconsumed(peer: TonoAuthenticatedPeer) throws {
        var ledger = try storage.load()
        try effects.authenticate(peer)
        guard var attempt = ledger.attempt,
              attempt.execution == .reserved || attempt.execution == .staged,
              attempt.receipt.owner == Self.owner(peer),
              attempt.receipt.installedLocationSha256 == Self.location,
              attempt.originalComponents == (try effects.installedComponents()),
              attempt.disconnectRequested, attempt.disconnectVerified,
              try effects.observe() == .unprotected else {
            throw HelperFailure.invalid("Only an unconsumed attempt with verified explicit Disconnect can be retired.")
        }
        // Expiry/blocked state does not prevent cleanup, but grants no new
        // installation. Keep the original obligation and last successful proof
        // in an independently durable archive before clearing the active slot.
        if attempt.receipt.blockedReason == nil { attempt.receipt.blockedReason = .cancelled }
        try UpdateStorage.write(UpdateContractV1.canonical(attempt),
            to: storage.root + "/" + attempt.receipt.attemptId + ".json")
        ledger.attempt = nil
        try persist(ledger) // Generation and consumed high-water are unchanged.
    }

    /// One transport endpoint, two retire predicates: unconsumed reservations
    /// keep their existing retirement; every consumed-side attempt uses the
    /// resolved archive below. Both require the owner's verified explicit
    /// Disconnect, and neither ever lowers the consumed high-water mark.
    func retire(peer: TonoAuthenticatedPeer?) throws {
        switch try storage.load().attempt?.execution {
        case .reserved, .staged:
            guard let peer else { throw HelperFailure.invalid("Update retirement requires an authenticated owner.") }
            try retireUnconsumed(peer: peer)
        default:
            try retireResolved(peer: peer)
        }
    }

    /// The terminal state for an attempt whose replacement can no longer be
    /// completed by its bound incarnations: the executor blocked or rolled
    /// back before `.replaced`, the attempt expired or was explicitly
    /// abandoned after consumption, or a fully replaced installation was
    /// explicitly abandoned by its user. The owner's verified explicit
    /// Disconnect (U4: never fabricated completion) plus an independent
    /// on-disk component proof — the captured original components for
    /// pre-replacement/rolled-back attempts, the signed target components for
    /// an abandoned replacement — sanction archiving the evidence and
    /// clearing the active slot. `peer` is nil only for the root emergency
    /// CLI, which already holds strictly greater privilege and its own
    /// verified release; every IPC caller authenticates a live owner peer.
    func retireResolved(peer: TonoAuthenticatedPeer?) throws {
        var ledger = try storage.load()
        if let peer {
            try effects.authenticate(peer)
            guard ledger.attempt?.receipt.owner == Self.owner(peer) else {
                throw HelperFailure.invalid("Only the update owner can retire a resolved attempt.")
            }
        }
        guard var attempt = ledger.attempt, attempt.receipt.phase != .committed,
              attempt.execution == .consumed || attempt.execution == .rolledBack || attempt.execution == .replaced,
              attempt.receipt.installedLocationSha256 == Self.location,
              attempt.disconnectRequested, attempt.disconnectVerified,
              try effects.observe() == .unprotected else {
            throw HelperFailure.invalid("Only a resolved update attempt with verified explicit Disconnect can be retired.")
        }
        if attempt.execution == .replaced {
            let manifest = try UpdateContractV1.ReleaseManifest.decode(attempt.manifest)
            guard try effects.installedComponents() == manifest.target(.macosArm64).components else {
                throw HelperFailure.invalid("Replaced installation components differ; evidence retained.")
            }
        } else {
            // A consumed attempt never entered replacement and a rolled-back
            // one restored its capture; both must still hash to the original.
            guard attempt.originalComponents == (try effects.installedComponents()) else {
                throw HelperFailure.invalid("Installed components differ from the captured original; evidence retained.")
            }
        }
        // Same archive discipline as unconsumed retirement: the receipt keeps
        // its last proof phase and gains a terminal blocked reason; the
        // consumed high-water mark and generation counter are unchanged.
        if attempt.receipt.blockedReason == nil { attempt.receipt.blockedReason = .cancelled }
        try UpdateStorage.write(UpdateContractV1.canonical(attempt),
            to: storage.root + "/" + attempt.receipt.attemptId + ".json")
        ledger.attempt = nil
        try persist(ledger)
        // The executor entry has nothing left to recover; retire it exactly
        // like a committed transaction does.
        try effects.cleanupCommitted()
    }

    func gate(method: String, path: String, peer: TonoAuthenticatedPeer) throws {
        guard method != "GET", !path.hasPrefix("/update/") else { return }
        let ledger = try storage.load()
        guard let attempt = ledger.attempt, attempt.receipt.phase != .committed else { return }
        if path == "/core/stop" || path == "/dns/restore" { return } // Tightening/cleanup only.
        if ["/core/start", "/core/sync", "/killswitch/arm", "/dns/enable"].contains(path) {
            _ = try bound(ledger, peer: peer, initiating: false)
            guard attempt.receipt.requiredRecovery == .connected else { throw HelperFailure.invalid("Update does not authorize reconnect.") }
            return
        }
        throw HelperFailure.coded(code: "UPDATE_PENDING", message: "Pending update owns runtime changes. Use explicit update Disconnect or recovery.")
    }

    private func bound(_ ledger: UpdateStorage.Ledger, peer: TonoAuthenticatedPeer, initiating: Bool) throws -> UpdateStorage.Attempt {
        try effects.authenticate(peer)
        guard let attempt = ledger.attempt, attempt.receipt.owner == Self.owner(peer),
              attempt.receipt.installedLocationSha256 == Self.location,
              attempt.receipt.blockedReason == nil, !attempt.disconnectRequested,
              (initiating ? attempt.initiatingBoot : attempt.successorBoot) == (try TonoAuthenticatedPeer.bootSession()),
              (initiating ? attempt.initiatingToken : attempt.successorToken) == peer.auditToken else {
            throw HelperFailure.invalid("Update owner/incarnation is not authorized.")
        }
        try validTime(attempt)
        return attempt
    }

    private func validTime(_ attempt: UpdateStorage.Attempt) throws {
        guard now() >= attempt.receipt.updatedAtUnix, now() < attempt.receipt.expiresAtUnix else {
            throw HelperFailure.invalid("Update expired or clock moved backwards; evidence retained.")
        }
    }

    private func context(_ attempt: UpdateStorage.Attempt, peer: TonoAuthenticatedPeer, generation: UInt64? = nil) -> UpdateContractV1.Context {
        .init(attemptId: attempt.receipt.attemptId, owner: Self.owner(peer), installedLocationSha256: Self.location,
              targetId: .macosArm64, generation: generation ?? attempt.receipt.successorGeneration ?? attempt.receipt.initiatingGeneration, nowUnix: now())
    }

    private func block(_ reason: UpdateContractV1.BlockReason, ledger: UpdateStorage.Ledger) throws {
        var candidate = ledger
        guard candidate.attempt != nil else { return }
        candidate.attempt?.receipt.blockedReason = reason
        try persist(candidate)
    }
}
