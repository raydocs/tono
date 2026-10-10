import Foundation
import Darwin
import SystemConfiguration

/// Owns the temporary macOS DNS override required by Mihomo TUN.
///
/// macOS cannot hijack DNS queries sent to a directly reachable LAN resolver.
/// While protection is active, the authenticated root helper points the
/// current network service at Mihomo's root-owned loopback DNS listener. Using
/// loopback avoids binding the replacement resolver to the physical Wi-Fi
/// route. The original explicit DNS list (or DHCP/Empty state) is persisted
/// before mutation and restored on disconnect, failed connect, or emergency
/// recovery.
final class ProtectedDNSManager {
    private struct Snapshot: Codable, Equatable {
        /// Display name when the snapshot was taken. Kept for diagnosis and
        /// for snapshots without `serviceID`; macOS lets the user rename a
        /// service while Tono holds its DNS, so the name alone cannot find
        /// the service these servers belong to.
        let service: String
        /// `SCNetworkServiceGetServiceID`, stable across renames. Absent in
        /// snapshots written by older helpers, and when System Configuration
        /// could not name the service at enable time.
        var serviceID: String? = nil
        let servers: [String]
    }

    /// A network service as one enumeration saw it. `id` is nil only when
    /// enumeration fell back to `networksetup`, which lists names alone.
    private struct NetworkService: Hashable {
        let id: String?
        let name: String
    }

    /// Where a snapshot's original servers go back to.
    private enum SnapshotOwner {
        case service(NetworkService)
        /// No service can take them: an enumeration that carries IDs has no
        /// service with the recorded ID (macOS deleted it), or a name-only
        /// snapshot's name is gone.
        case missing
        /// The enumeration has no IDs, so a renamed service cannot be told
        /// apart from a deleted one. A retry with System Configuration can.
        case unresolved
    }

    /// How System Configuration finds a service: by its recorded ID when
    /// there is one, otherwise by display name.
    private enum ServiceKey {
        case name(String)
        case id(String)

        func resolve(in prefs: SCPreferences) -> SCNetworkService? {
            switch self {
            case .name(let name):
                return ProtectedDNSManager.namedService(prefs, name)
            case .id(let id):
                return SCNetworkServiceCopy(prefs, id as CFString)
            }
        }
    }

    private struct CommandResult {
        let status: Int32
        let output: String
    }

    private static let supportDirectory = "/Library/Application Support/Tono"
    private static let statePath = "\(supportDirectory)/protected-dns.json"
    private static let completedRestorePath = "\(supportDirectory)/protected-dns.restored"
    private static let completedRestoreBody = Data("tono-dns-restored-v1\n".utf8)
    /// Left by a release no app reply carries (native update preparation,
    /// `--emergency-disarm`, `--emergency-reset`) when the original servers
    /// had no service to go back to. Presence is the record (TM-claude-4).
    private static let originalLossNoticePath = "\(supportDirectory)/protected-dns.original-not-restored"
    static let protectedDNSServer = ProtectedDNSContract.server
    private static let maximumStateBytes = 16 * 1024
    /// One cap for every DNS server list this helper reads, saves, loads and
    /// writes. Reads had no limit while load/write capped at 8, so enabling
    /// on a service with more resolvers (corporate/VPN, IPv4+IPv6 lists)
    /// recorded a snapshot restore had to quarantine: the original DNS could
    /// never come back and a failed enable could not roll back
    /// (MAC-DNS-SNAPSHOT-OVER-8). 32 sits far above any real list and still
    /// fits `maximumStateBytes` with room to spare.
    private static let maximumDNSServerCount = 32
    private let lock = NSLock()
    private var ownedRestoreCompleted = false
    private var completedRestoreInvalidated = false

    init() throws {
        try Self.ensureRootDirectory()
    }

    private static func completedRestoreReceiptPresent(path: String = completedRestorePath) -> Bool {
        var metadata = stat()
        guard lstat(path, &metadata) == 0, metadata.st_mode & 0o077 == 0 else { return false }
        return (try? KillSwitchManager.secureRead(path, maximumBytes: 32)) == completedRestoreBody
    }

    private static func saveCompletedRestoreReceipt(path: String = completedRestorePath) throws {
        try KillSwitchManager.atomicWrite(path: path, data: completedRestoreBody, permissions: 0o600)
    }

    private static func clearCompletedRestoreReceipt(path: String = completedRestorePath) throws {
        var metadata = stat()
        guard lstat(path, &metadata) == 0 else {
            if errno == ENOENT { return }
            throw HelperFailure.system("Could not inspect DNS restoration receipt.")
        }
        guard metadata.st_uid == 0, metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              metadata.st_mode & 0o077 == 0, unlink(path) == 0 else {
            throw HelperFailure.invalid("Could not retire DNS restoration receipt.")
        }
        try KillSwitchManager.fsyncParent(path)
    }

    private func recordCompletedRestore() {
        ownedRestoreCompleted = true
        completedRestoreInvalidated = false
        do { try Self.saveCompletedRestoreReceipt() } catch {
            // Receipt persistence cannot hold ordinary Internet after DNS
            // recovery succeeded. Same-process repeated cleanup still has proof.
            FileHandle.standardError.write(Data("tono: DNS restoration receipt not saved: \(error)\n".utf8))
        }
    }

    private func clearCompletedRestore() throws {
        try Self.clearCompletedRestoreReceipt()
        ownedRestoreCompleted = false
        completedRestoreInvalidated = true
    }

    private func invalidateCompletedRestoreForCorruption() {
        ownedRestoreCompleted = false
        completedRestoreInvalidated = true
        do { try Self.clearCompletedRestoreReceipt() } catch {
            FileHandle.standardError.write(Data("tono: stale DNS restoration receipt not retired: \(error)\n".utf8))
        }
    }

    /// No earlier retirement may suppress recovery of a new DNS override.
    private func writeManagedDNS(_ servers: [String], _ service: NetworkService) throws {
        try clearCompletedRestore()
        try Self.writeDNS(servers, on: service)
    }

    func enable(service rawService: String) throws -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }

        let service = try Self.validateService(rawService)
        // Resolve the selected service ID before reading or writing DNS;
        // name-only fallback is for services without an ID, not failed ID I/O.
        let serviceID = try Self.requireServiceID(named: service, lookup: Self.scServiceID)
        let selected = NetworkService(id: serviceID, name: service)
        let previous = try loadSnapshotQuarantiningCorruption()
        let existingServers: [String]
        do {
            existingServers = try Self.readDNS(on: selected)
        } catch {
            guard try Self.availableServices().contains(service) else {
                throw HelperFailure.invalid("The selected network service is unavailable.")
            }
            throw error
        }

        if let previous {
            if !Self.isSameService(previous, name: service, id: serviceID) {
                try Self.retirePreviousSnapshot(
                    previous,
                    services: try Self.allServices(),
                    read: Self.readDNS,
                    write: writeManagedDNS,
                    removeSnapshot: removeSnapshot,
                    archiveSnapshot: { try Self.quarantineSnapshot(reason: "superseded") },
                    recordCompletedRestore: recordCompletedRestore
                )
            } else {
                try Self.reenableSameOwner(
                    previous,
                    service: selected,
                    read: Self.readDNS,
                    write: writeManagedDNS,
                    save: save,
                    archiveSnapshot: { try Self.quarantineSnapshot(reason: "superseded") }
                )
                return Self.response(
                    configured: true,
                    snapshotPresent: true,
                    service: service
                )
            }
        }

        var servers = existingServers
        if servers == [Self.protectedDNSServer] {
            // A previous session left the Mihomo listener in place without a
            // snapshot. Recording that as "original DNS" makes Restore Internet
            // write 127.0.0.1 back after Mihomo is gone.
            servers = []
        }
        // Refuse before the first system change: a snapshot restore would
        // reject can never be recovered from — its quarantine leaves the
        // service on automatic DNS instead of the user's resolvers.
        guard servers.count <= Self.maximumDNSServerCount else {
            throw HelperFailure.invalid("The current DNS settings are invalid.")
        }
        let snapshot = Snapshot(
            service: service,
            serviceID: serviceID,
            servers: servers
        )
        // Persist recovery state before changing the first system setting.
        try save(snapshot)
        do {
            try writeManagedDNS([Self.protectedDNSServer], selected)
            guard try Self.readDNS(on: selected) == [Self.protectedDNSServer] else {
                throw HelperFailure.system("The protected DNS transition did not commit.")
            }
        } catch {
            if (try? writeManagedDNS(snapshot.servers, selected)) != nil,
               (try? Self.readDNS(on: selected)) == snapshot.servers {
                recordCompletedRestore()
                try? removeSnapshot()
            }
            throw error
        }
        return Self.response(
            configured: true,
            snapshotPresent: true,
            service: service
        )
    }

    /// Put the recorded resolvers back, then make sure no network service is
    /// left pointing at a Mihomo listener that is about to stop existing.
    ///
    /// Two rules the previous shape got wrong, both of which end as "Restore
    /// Internet took my DNS away":
    ///
    /// - Every service is swept, including ones macOS currently has disabled.
    ///   `-listallnetworkservices` marks those with a leading `*`, and skipping
    ///   them deleted the snapshot while leaving `127.0.0.1` in their stored
    ///   configuration, ready to take effect the moment the user re-enables the
    ///   adapter with nothing left to recover it from.
    /// - One service that refuses to commit does not abandon the rest. The
    ///   failure is still raised, so PF stays armed and the caller can retry,
    ///   but the services that could be recovered already have been, and the
    ///   snapshot survives so the retry still knows the original resolvers.
    ///
    /// A fatally corrupt snapshot file no longer aborts the transaction
    /// before it starts: it is quarantined aside and the sweep runs
    /// snapshotless, because `save` is atomic — a file that fails the
    /// ownership/content checks is an external event (backup restore,
    /// permission drift, truncation) that no retry can repair, and refusing
    /// here used to leave PF fail-closed with no outlet at all, not even
    /// `--emergency-disarm`. See `restoreTransaction`.
    ///
    /// `deferringLossNotice` is for a release no app reply carries (native
    /// update preparation, emergency recovery): a lost original is recorded
    /// for the app's next `/dns/restore` reply instead of reaching nobody.
    func restore(deferringLossNotice: Bool = false) throws -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        let outcome = try Self.restoreTransaction(
            snapshotResult: Result(catching: loadSnapshot),
            services: try Self.allServices(),
            read: Self.readDNS,
            write: Self.writeDNS,
            removeSnapshot: removeSnapshot,
            archiveSnapshot: { try Self.quarantineSnapshot(reason: $0) },
            quarantine: { try Self.quarantineSnapshot() },
            activate: Self.scApplyDNSPreferences,
            completedRestoreAvailable: {
                !self.completedRestoreInvalidated
                    && (self.ownedRestoreCompleted || Self.completedRestoreReceiptPresent())
            },
            recordCompletedRestore: recordCompletedRestore,
            invalidateCompletedRestore: invalidateCompletedRestoreForCorruption
        )
        var object = Self.response(
            configured: false,
            snapshotPresent: false,
            service: outcome.snapshot?.service
        )
        if Self.reportsOriginalLoss(
            originalRestored: outcome.originalRestored,
            deferred: deferringLossNotice,
            noticePath: Self.originalLossNoticePath
        ) {
            // The loopback sweep is proven, so release is safe, but the
            // recorded servers were not restored (the service disappeared
            // or a newer DNS choice superseded them). Keep archive evidence.
            object["originalDNSRestored"] = false
        }
        return object
    }

    /// Update admission/commit cannot infer restored DNS from an absent
    /// snapshot alone. Read every persisted service and active resolver state.
    func verifyRestored() throws {
        lock.lock()
        defer { lock.unlock() }
        guard try loadSnapshot() == nil else { throw HelperFailure.invalid("DNS recovery is still pending.") }
        for service in try Self.allServices() {
            guard try !Self.isStoppedTonoResolver(Self.readDNS(on: service)) else {
                throw HelperFailure.invalid("A network service still uses the stopped Tono resolver.")
            }
        }
        guard let store = SCDynamicStoreCreate(nil, "Tono update DNS readback" as CFString, nil, nil),
              let values = SCDynamicStoreCopyMultiple(store, nil,
                ["State:/Network/Service/.*/DNS", "State:/Network/Global/DNS"] as CFArray) as? [String: Any] else {
            throw HelperFailure.invalid("Active DNS state cannot be inspected.")
        }
        for case let config as [String: Any] in values.values {
            if let servers = config[kSCPropNetDNSServerAddresses as String] as? [String],
               Self.isStoppedTonoResolver(servers) {
                throw HelperFailure.invalid("The active resolver still points to the stopped Core.")
            }
        }
    }

    /// Whether a DNS server list may be Tono's resolver left behind by a
    /// stopped Core. Tono writes DNS only as exactly `[127.0.0.1]`; a list
    /// that merely contains it is another product's and blocked every native
    /// update (BRICK-M4).
    static func isStoppedTonoResolver(_ servers: [String]) -> Bool {
        servers == [protectedDNSServer]
    }

    /// Helper start, or the idle loop, after the Core is stopped. A snapshot
    /// is the evidence this helper changed DNS. Restoring it while a Core is
    /// still running would pull the resolver out from under a live session.
    /// A stopped Core restores even if a kill switch was wanted: a dead
    /// listener must not be left as the system resolver. Without a snapshot
    /// this does not sweep a stranger's loopback DNS (BRICK-M12).
    static func shouldRecoverDNSAtBoot(
        coreRunning: Bool,
        snapshotPresent: Bool
    ) -> Bool {
        !coreRunning && snapshotPresent
    }

    /// The same recovery transaction runs against either System Configuration
    /// or controlled I/O. Snapshot removal is part of the transaction, not a
    /// decision a test or caller can make independently of service readback.
    ///
    /// The snapshot's service is found by its recorded ID, not its display
    /// name. Matching by name turned a rename into "not our service": the
    /// sweep reset it to automatic DNS and the snapshot holding its static
    /// servers was deleted. Returns false when no service can take the
    /// original servers or a newer choice superseded them; the snapshot is
    /// then archived, not deleted.
    @discardableResult
    private static func restoreServices(
        snapshot: Snapshot?,
        services: Set<NetworkService>,
        read: (NetworkService) throws -> [String],
        write: ([String], NetworkService) throws -> Void,
        removeSnapshot: () throws -> Void,
        archiveSnapshot: (String) throws -> Void,
        snapshotlessSweepRequired: Bool = true,
        recordCompletedRestore: () -> Void = {}
    ) throws -> Bool {
        var failure: Error?

        func attempt(_ servers: [String], for service: NetworkService) {
            do {
                try write(servers, service)
                guard try read(service) == servers else {
                    throw HelperFailure.system("The protected DNS transition did not commit.")
                }
            } catch {
                failure = failure ?? error
            }
        }

        var target: NetworkService?
        var ownerMissing = false
        var superseded = false
        if let snapshot {
            switch owner(of: snapshot, in: services) {
            case .service(let service):
                target = service
                do {
                    let current = try read(service)
                    // A prior restore can commit these originals to disk
                    // before Apply fails. Reapply before retiring its snapshot.
                    if current == [Self.protectedDNSServer] || current == snapshot.servers {
                        attempt(snapshot.servers, for: service)
                    } else if current != snapshot.servers {
                        superseded = true
                    }
                } catch {
                    failure = failure ?? error
                }
            case .missing:
                ownerMissing = true
            case .unresolved:
                // Not proof of anything: keep the snapshot where it is and
                // refuse release until an enumeration with IDs can decide.
                failure = failure ?? HelperFailure.system(
                    "The protected DNS service cannot be identified."
                )
            }
        }
        for service in services where snapshot != nil || snapshotlessSweepRequired {
            let current: [String]
            do {
                current = try read(service)
            } catch {
                // Unreadable is not DHCP/empty: the adapter can still point
                // at our dead loopback listener. Recover the other services,
                // but retain the snapshot and refuse release until a retry
                // can prove every service safe.
                failure = failure ?? error
                continue
            }
            // Only loopback is swept. A service the user pointed somewhere of
            // their own is not ours to rewrite. When a snapshot names an
            // owner, another service on exactly 127.0.0.1 is not proof we
            // set it (BRICK-M12). A snapshotless restore (corrupt snapshot)
            // still clears loopback unless a completed owned restore has
            // retained proof that this is only repeated cleanup.
            guard current == [Self.protectedDNSServer] else { continue }
            if snapshot != nil {
                guard let target, service == target, !superseded else { continue }
                attempt(snapshot?.servers ?? [], for: service)
            } else {
                attempt([], for: service)
            }
        }
        if let failure {
            throw failure
        }
        // Keep ownership evidence across deletion/archive, so a second
        // cleanup cannot reinterpret a foreign loopback service as Tono's.
        if snapshot != nil { recordCompletedRestore() }
        if ownerMissing {
            try archiveSnapshot("orphaned")
            return false
        }
        if superseded {
            try archiveSnapshot("superseded")
            return false
        }
        try removeSnapshot()
        return true
    }

    /// A handoff may retire the old snapshot only after reading its owner by
    /// stable identity. A later explicit DNS choice is not Tono's to restore.
    private static func retirePreviousSnapshot(
        _ snapshot: Snapshot,
        services: Set<NetworkService>,
        read: (NetworkService) throws -> [String],
        write: ([String], NetworkService) throws -> Void,
        removeSnapshot: () throws -> Void,
        archiveSnapshot: () throws -> Void,
        recordCompletedRestore: () -> Void = {}
    ) throws {
        guard case .service(let owner) = owner(of: snapshot, in: services) else {
            throw HelperFailure.invalid("The previously protected network service is unavailable.")
        }
        let current = try read(owner)
        if current == [Self.protectedDNSServer] || current == snapshot.servers {
            try write(snapshot.servers, owner)
            guard try read(owner) == snapshot.servers else {
                throw HelperFailure.system("The protected DNS transition did not commit.")
            }
            recordCompletedRestore()
            try removeSnapshot()
        } else {
            recordCompletedRestore()
            try archiveSnapshot()
        }
    }

    /// Re-enabling the same owner is a new DNS transition too. If another
    /// actor selected explicit DNS since the old snapshot, preserve that
    /// choice as the new recovery target before writing Tono's listener.
    private static func reenableSameOwner(
        _ previous: Snapshot,
        service: NetworkService,
        read: (NetworkService) throws -> [String],
        write: ([String], NetworkService) throws -> Void,
        save: (Snapshot) throws -> Void,
        archiveSnapshot: () throws -> Void
    ) throws {
        let current = try read(service)
        if current != [protectedDNSServer] && current != previous.servers {
            // Archive first: a failed archive/save never changes system DNS,
            // and a retry can still recover whichever snapshot was durable.
            try archiveSnapshot()
            try save(Snapshot(service: service.name, serviceID: service.id, servers: current))
        } else if previous.service != service.name {
            try save(Snapshot(
                service: service.name,
                serviceID: previous.serviceID ?? service.id,
                servers: previous.servers
            ))
        }
        try write([protectedDNSServer], service)
        guard try read(service) == [protectedDNSServer] else {
            throw HelperFailure.system("The protected DNS transition did not commit.")
        }
    }

    private static func owner(
        of snapshot: Snapshot,
        in services: Set<NetworkService>
    ) -> SnapshotOwner {
        if let id = snapshot.serviceID {
            guard !services.isEmpty, services.allSatisfy({ $0.id != nil }) else {
                return .unresolved
            }
            return services.first(where: { $0.id == id }).map(SnapshotOwner.service) ?? .missing
        }
        if let service = services.first(where: { $0.name == snapshot.service }) {
            return .service(service)
        }
        return snapshot.serviceID == nil ? .missing : .unresolved
    }

    private static func isSameService(_ snapshot: Snapshot, name: String, id: String?) -> Bool {
        if let recorded = snapshot.serviceID {
            return id.map({ recorded == $0 }) ?? false
        }
        return snapshot.service == name
    }

    /// The restore transaction over an injected snapshot outcome, mirroring
    /// `statusResponse`. Production restore() owns the real snapshot, reader,
    /// writer, quarantine, and removal.
    ///
    /// A `.failure` carrying `HelperFailure.invalid` means the snapshot file
    /// exists but is provably not a valid snapshot (wrong owner, type, mode,
    /// size, or content). `save` is fsync+rename, so that state is permanent —
    /// "retain the snapshot and let the caller retry" can never succeed and
    /// used to brick restore, `--emergency-disarm`, and `--emergency-reset`
    /// at the same line. The way out is the same one Windows
    /// `recover_unreadable_snapshot` takes: quarantine the file aside (kept
    /// for diagnosis, never counted as restoration evidence), then run the
    /// snapshotless sweep — every service still pointing at the loopback
    /// listener is returned to DHCP/Empty, which needs no snapshot and does
    /// not fabricate original values. Services with their own resolvers are
    /// untouched, and the per-service readback proof still decides whether
    /// the caller may release PF.
    ///
    /// Every other failure (`.system` read/inspect errors) is still thrown
    /// unchanged: those can clear on retry, and M2's retain-and-refuse
    /// contract stays meaningful for them.
    private static func restoreTransaction(
        snapshotResult: Result<Snapshot?, Error>,
        services: Set<NetworkService>,
        read: (NetworkService) throws -> [String],
        write: ([String], NetworkService) throws -> Void,
        removeSnapshot: () throws -> Void,
        archiveSnapshot: (String) throws -> Void,
        quarantine: () throws -> Void,
        activate: () throws -> Void = {},
        completedRestoreAvailable: () -> Bool = { false },
        recordCompletedRestore: () -> Void = {},
        invalidateCompletedRestore: () -> Void = {}
    ) throws -> (snapshot: Snapshot?, originalRestored: Bool) {
        let snapshot: Snapshot?
        let snapshotlessSweepRequired: Bool
        switch snapshotResult {
        case .success(let loaded):
            snapshot = loaded
            snapshotlessSweepRequired = loaded != nil || !completedRestoreAvailable()
        case .failure(let error):
            guard let failure = error as? HelperFailure, case .invalid = failure else {
                throw error
            }
            invalidateCompletedRestore()
            try quarantine()
            snapshot = nil
            // Corrupt current evidence is not a completed prior restore.
            snapshotlessSweepRequired = true
        }
        let originalRestored = try restoreServices(
            snapshot: snapshot,
            services: services,
            read: read,
            write: write,
            removeSnapshot: removeSnapshot,
            archiveSnapshot: archiveSnapshot,
            snapshotlessSweepRequired: snapshotlessSweepRequired,
            recordCompletedRestore: recordCompletedRestore
        )
        // A previous snapshotless write may have committed automatic DNS
        // while Apply failed. Empty persisted settings alone do not prove
        // the dead listener is gone from active configuration. Activate the
        // stored preferences without rewriting another service's custom DNS.
        if snapshot == nil { try activate() }
        return (snapshot, originalRestored)
    }

    func status() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return Self.statusResponse(
            snapshotResult: Result(catching: loadSnapshot),
            read: Self.currentDNS,
            readByID: { try Self.scCurrentDNS(.id($0)) }
        )
    }

    /// The status report as a transaction over injected I/O, mirroring
    /// restoreServices. Production status() owns the real snapshot and
    /// reader.
    ///
    /// A snapshot that loaded is a pending restore even when its service has
    /// become unreadable (renamed or deleted service, failing networksetup):
    /// restore() sweeps loopback DNS off every service it can still read and
    /// handles a missing snapshot service explicitly. Collapsing that state
    /// into snapshotPresent:false made the app refuse to call /dns/restore at
    /// all, so the read failure is reported separately while the snapshot
    /// stays visible for recovery.
    ///
    /// A snapshot file that exists but is fatally invalid is reported the
    /// same way: restore() quarantines it and runs the snapshotless sweep
    /// (see restoreTransaction), so hiding it behind snapshotPresent:false
    /// kept the app from ever calling /dns/restore and left only the sudo
    /// outlet. Transient `.system` inspection failures still report
    /// snapshotPresent:false.
    private static func statusResponse(
        snapshotResult: Result<Snapshot?, Error>,
        read: (String) throws -> [String],
        readByID: ((String) throws -> [String])? = nil
    ) -> [String: Any] {
        let snapshot: Snapshot?
        switch snapshotResult {
        case .success(let loaded):
            snapshot = loaded
        case .failure(let error):
            if let failure = error as? HelperFailure, case .invalid = failure {
                return [
                    "ok": false,
                    "configured": false,
                    "snapshotPresent": true,
                    "error": "Protected DNS state is unreadable; restore will quarantine it.",
                ]
            }
            return [
                "ok": false,
                "configured": false,
                "snapshotPresent": false,
                "error": "Protected DNS status is unavailable.",
            ]
        }
        guard let snapshot else {
            return Self.response(
                configured: false,
                snapshotPresent: false,
                service: nil
            )
        }
        do {
            let servers: [String]
            if let id = snapshot.serviceID, let readByID {
                servers = try readByID(id)
            } else {
                servers = try read(snapshot.service)
            }
            let configured = servers == [Self.protectedDNSServer]
            return Self.response(
                configured: configured,
                snapshotPresent: true,
                service: snapshot.service
            )
        } catch {
            return [
                "ok": false,
                "configured": false,
                "snapshotPresent": true,
                "service": snapshot.service,
                "error": "Protected DNS status is unavailable.",
            ]
        }
    }

    private static func response(
        configured: Bool,
        snapshotPresent: Bool,
        service: String?
    ) -> [String: Any] {
        var object: [String: Any] = [
            "ok": true,
            "configured": configured,
            "snapshotPresent": snapshotPresent,
            "version": helperVersion,
        ]
        if let service { object["service"] = service }
        return object
    }

    // MARK: - Snapshot

    /// Load the snapshot, treating a fatally corrupt file as "no snapshot"
    /// after renaming it aside (`restoreTransaction` documents why retrying
    /// can never repair it). The loopback guard in `enable` already refuses
    /// to record our own resolver as an original, so a fresh snapshot taken
    /// over a quarantined file cannot inherit the contamination. Transient
    /// `.system` read failures are still thrown for a retry to handle.
    private func loadSnapshotQuarantiningCorruption() throws -> Snapshot? {
        do {
            return try loadSnapshot()
        } catch let failure as HelperFailure {
            guard case .invalid = failure else { throw failure }
            try Self.quarantineSnapshot()
            return nil
        }
    }

    private func loadSnapshot() throws -> Snapshot? {
        var metadata = stat()
        guard lstat(Self.statePath, &metadata) == 0 else {
            if errno == ENOENT { return nil }
            throw HelperFailure.system("Could not inspect protected DNS state.")
        }
        guard metadata.st_uid == 0,
              metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              metadata.st_mode & 0o077 == 0,
              metadata.st_size > 0,
              metadata.st_size <= Self.maximumStateBytes else {
            throw HelperFailure.invalid("Protected DNS state is unsafe.")
        }
        let fd = open(Self.statePath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard fd >= 0 else {
            throw HelperFailure.system("Could not read protected DNS state.")
        }
        defer { close(fd) }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while data.count <= Self.maximumStateBytes {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw HelperFailure.system("Could not read protected DNS state.")
            }
            data.append(buffer, count: count)
        }
        guard data.count <= Self.maximumStateBytes,
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
              Self.isRestorableSnapshot(snapshot) else {
            throw HelperFailure.invalid("Protected DNS state is invalid.")
        }
        return snapshot
    }

    /// The content rules a decoded snapshot must pass before restore trusts
    /// it. The server-count cap is the same constant `save` refuses to exceed
    /// and `writeDNS` refuses to apply, so whatever this helper records can
    /// always be loaded and restored. Static so the self-test can prove a
    /// saved list survives load validation.
    private static func isRestorableSnapshot(_ snapshot: Snapshot) -> Bool {
        (try? validateService(snapshot.service)) != nil
            && (snapshot.serviceID.map({ (try? validateService($0)) != nil }) ?? true)
            && snapshot.servers.count <= maximumDNSServerCount
            && snapshot.servers.allSatisfy(isIPAddress)
    }

    private func save(_ snapshot: Snapshot) throws {
        guard snapshot.servers.count <= Self.maximumDNSServerCount else {
            throw HelperFailure.invalid("A protected DNS snapshot is invalid.")
        }
        let data = try JSONEncoder().encode(snapshot)
        guard data.count <= Self.maximumStateBytes else {
            throw HelperFailure.invalid("Protected DNS state is too large.")
        }
        try clearCompletedRestore()
        let temporary = "\(Self.statePath).new"
        let fd = open(
            temporary,
            O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW,
            0o600
        )
        guard fd >= 0 else {
            throw HelperFailure.system("Could not persist protected DNS state.")
        }
        var descriptorIsOpen = true
        defer {
            if descriptorIsOpen {
                close(fd)
            }
        }
        do {
            try data.withUnsafeBytes {
                guard let base = $0.baseAddress else { return }
                var offset = 0
                while offset < $0.count {
                    let written = Darwin.write(
                        fd,
                        base.advanced(by: offset),
                        $0.count - offset
                    )
                    if written < 0, errno == EINTR { continue }
                    guard written > 0 else {
                        throw HelperFailure.system(
                            "Could not persist protected DNS state."
                        )
                    }
                    offset += written
                }
            }
            guard fsync(fd) == 0,
                  fchown(fd, 0, 0) == 0,
                  fchmod(fd, 0o600) == 0 else {
                throw HelperFailure.system("Could not commit protected DNS state.")
            }
            // A failed close must not be retried: the descriptor may already
            // have been consumed and subsequently reused by the process.
            descriptorIsOpen = false
            guard close(fd) == 0,
                  rename(temporary, Self.statePath) == 0 else {
                throw HelperFailure.system("Could not commit protected DNS state.")
            }
        } catch {
            unlink(temporary)
            throw error
        }
    }

    private func removeSnapshot() throws {
        guard unlink(Self.statePath) == 0 || errno == ENOENT else {
            throw HelperFailure.system("Could not clear protected DNS state.")
        }
    }

    /// Rename an unrestored snapshot aside instead of deleting its only
    /// record of the old resolvers. The support directory is root-only 0700,
    /// so the renamed
    /// file stays unreachable whatever metadata made it unworthy of trust;
    /// root ownership is re-asserted anyway because losing it is one of the
    /// corruption modes. ENOENT — nothing to quarantine — is not an error:
    /// the caller proceeds as a plain missing snapshot. `orphaned` sets aside
    /// a valid snapshot whose service no longer exists; `superseded` keeps a
    /// valid snapshot whose owner now has a newer external DNS choice.
    private static func quarantineSnapshot(reason: String = "corrupt") throws {
        let quarantined = "\(statePath).\(reason)-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString)"
        guard rename(statePath, quarantined) == 0 else {
            if errno == ENOENT { return }
            throw HelperFailure.system("Could not quarantine protected DNS state.")
        }
        chown(quarantined, 0, 0)
        chmod(quarantined, 0o600)
    }

    // MARK: - System Configuration (networksetup fallback)

    private static func currentDNS(for service: String) throws -> [String] {
        if let servers = try? scCurrentDNS(.name(service)) {
            return servers
        }
        let result = try runNetworkSetup(["-getdnsservers", service])
        guard result.status == 0 else {
            throw HelperFailure.system("Could not read the current DNS settings.")
        }
        return try parseDNSOutput(result.output)
    }

    private static func setDNS(_ servers: [String], for service: String) throws {
        guard servers.count <= maximumDNSServerCount, servers.allSatisfy(isIPAddress) else {
            throw HelperFailure.invalid("A protected DNS snapshot is invalid.")
        }
        if (try? scSetDNS(servers, .name(service))) != nil {
            return
        }
        let values = servers.isEmpty ? ["Empty"] : servers
        let result = try runNetworkSetup(["-setdnsservers", service] + values)
        guard result.status == 0 else {
            throw HelperFailure.system("Could not update the protected DNS settings.")
        }
    }

    /// A stable ID is the only authority for ID-bearing services. Falling
    /// back to the old name after an ID I/O error can reach a different,
    /// same-named service and destroy its DNS.
    private static func readDNS(on service: NetworkService) throws -> [String] {
        try readDNS(
            on: service,
            readByID: { try scCurrentDNS(.id($0)) },
            readByName: { try currentDNS(for: $0) }
        )
    }

    private static func readDNS(
        on service: NetworkService,
        readByID: (String) throws -> [String],
        readByName: (String) throws -> [String]
    ) throws -> [String] {
        if let id = service.id { return try readByID(id) }
        return try readByName(service.name)
    }

    private static func writeDNS(_ servers: [String], on service: NetworkService) throws {
        try writeDNS(
            servers,
            on: service,
            writeByID: { try scSetDNS($0, .id($1)) },
            writeByName: { try setDNS($0, for: $1) }
        )
    }

    private static func writeDNS(
        _ servers: [String],
        on service: NetworkService,
        writeByID: ([String], String) throws -> Void,
        writeByName: ([String], String) throws -> Void
    ) throws {
        // The guard lives in the injectable layer so the self-test exercises
        // the same check production writes go through.
        guard servers.count <= maximumDNSServerCount, servers.allSatisfy(isIPAddress) else {
            throw HelperFailure.invalid("A protected DNS snapshot is invalid.")
        }
        if let id = service.id {
            try writeByID(servers, id)
        } else {
            try writeByName(servers, service.name)
        }
    }

    /// Services macOS currently has enabled. Protecting a disabled adapter is
    /// meaningless, so `enable` validates against this narrower set.
    private static func availableServices() throws -> Set<String> {
        try Set(listServices(includingDisabled: false).map(\.name))
    }

    /// Every service in the configuration, disabled ones included. Recovery has
    /// to reach those: a disabled adapter keeps whatever DNS it was left with.
    private static func allServices() throws -> Set<NetworkService> {
        try listServices(includingDisabled: true)
    }

    private static func listServices(includingDisabled: Bool) throws -> Set<NetworkService> {
        if let services = try? scListServices(includingDisabled: includingDisabled),
           !services.isEmpty {
            return services
        }
        let result = try runNetworkSetup(["-listallnetworkservices"])
        guard result.status == 0 else {
            throw HelperFailure.system("Could not enumerate network services.")
        }
        return Set(
            parseServices(result.output, includingDisabled: includingDisabled)
                .map { NetworkService(id: nil, name: $0) }
        )
    }

    /// New protection always records a positive stable identity. Legacy
    /// name-only snapshots may still be restored, but a failed lookup must
    /// not create another one or send writes to an unproven display name.
    private static func requireServiceID(
        named service: String,
        lookup: (String) throws -> String?
    ) throws -> String {
        guard let id = try lookup(service), !id.isEmpty else {
            throw HelperFailure.system("The selected DNS service cannot be identified.")
        }
        return id
    }

    /// Only the current Network Location's services are candidates, and the
    /// primary service the app took the name from wins (R3-O5). Every other
    /// location keeps its own same-named copy, which `namedService` would
    /// return as readily as the live one.
    private static func scServiceID(named service: String) throws -> String? {
        let primaryIDs = primaryServiceIDs()
        return try withPreferences(lock: false) { prefs in
            guard let all = SCNetworkServiceCopyAll(prefs),
                  let currentSet = SCNetworkSetCopyCurrent(prefs),
                  let members = SCNetworkSetCopyServices(currentSet) else {
                throw HelperFailure.system("Could not read the current network location.")
            }
            var services: [ProtectedDNSServiceIdentity.Candidate] = []
            for index in 0..<CFArrayGetCount(all) {
                let entry = unsafeBitCast(
                    CFArrayGetValueAtIndex(all, index),
                    to: SCNetworkService.self
                )
                guard let id = SCNetworkServiceGetServiceID(entry) as String?,
                      let name = SCNetworkServiceGetName(entry) as String? else { continue }
                services.append(ProtectedDNSServiceIdentity.Candidate(id: id, name: name))
            }
            var currentIDs = Set<String>()
            for index in 0..<CFArrayGetCount(members) {
                let member = unsafeBitCast(
                    CFArrayGetValueAtIndex(members, index),
                    to: SCNetworkService.self
                )
                if let id = SCNetworkServiceGetServiceID(member) as String? {
                    currentIDs.insert(id)
                }
            }
            return ProtectedDNSServiceIdentity.select(
                named: service,
                services: services,
                currentLocationIDs: currentIDs,
                primaryServiceIDs: primaryIDs
            )
        }
    }

    /// IPv4 then IPv6 `PrimaryService`, as the app reads them. Unreadable
    /// leaves selection to a name that is unique in the current location.
    private static func primaryServiceIDs() -> [String] {
        guard let store = SCDynamicStoreCreate(
            nil, "Tono protected DNS service" as CFString, nil, nil
        ) else { return [] }
        return [kSCEntNetIPv4, kSCEntNetIPv6].compactMap { (entity: CFString) -> String? in
            let key = SCDynamicStoreKeyCreateNetworkGlobalEntity(
                nil, kSCDynamicStoreDomainState, entity
            )
            let value = SCDynamicStoreCopyValue(store, key) as? [String: Any]
            return value?[kSCDynamicStorePropNetPrimaryService as String] as? String
        }
    }

    private static func scCurrentDNS(_ key: ServiceKey) throws -> [String] {
        try withPreferences(lock: false) { prefs in
            guard let networkService = key.resolve(in: prefs) else {
                throw HelperFailure.invalid("The selected network service is unavailable.")
            }
            // No count cap on reads: `verifyRestored` and the restore sweeps
            // read every service, and refusing a long foreign list there
            // would block recovery. `enable` checks the cap itself before
            // any system change.
            return dnsServers(on: networkService)
        }
    }

    private static func scSetDNS(_ servers: [String], _ key: ServiceKey) throws {
        try withPreferences(lock: true) { prefs in
            guard let networkService = key.resolve(in: prefs) else {
                throw HelperFailure.invalid("The selected network service is unavailable.")
            }
            guard let protocolRef = SCNetworkServiceCopyProtocol(
                networkService,
                kSCNetworkProtocolTypeDNS
            ) else {
                throw HelperFailure.system("Could not open the DNS protocol.")
            }
            var configuration: [String: Any] = [:]
            if let existing = SCNetworkProtocolGetConfiguration(protocolRef) {
                configuration = (existing as NSDictionary as? [String: Any]) ?? [:]
            }
            if servers.isEmpty {
                // Same as `networksetup -setdnsservers <service> Empty`:
                // drop the explicit list so DHCP/automatic resolvers return.
                configuration.removeValue(forKey: kSCPropNetDNSServerAddresses as String)
            } else {
                configuration[kSCPropNetDNSServerAddresses as String] = servers
            }
            guard SCNetworkProtocolSetConfiguration(protocolRef, configuration as CFDictionary),
                  SCPreferencesCommitChanges(prefs),
                  SCPreferencesApplyChanges(prefs) else {
                throw HelperFailure.system("Could not update the protected DNS settings.")
            }
        }
    }

    private static func scApplyDNSPreferences() throws {
        try withPreferences(lock: true) { prefs in
            guard SCPreferencesApplyChanges(prefs) else {
                throw HelperFailure.system("Could not activate the restored DNS settings.")
            }
        }
    }

    private static func scListServices(includingDisabled: Bool) throws -> Set<NetworkService> {
        try withPreferences(lock: false) { prefs in
            guard let array = SCNetworkServiceCopyAll(prefs) else {
                throw HelperFailure.system("Could not enumerate network services.")
            }
            var services = Set<NetworkService>()
            let count = CFArrayGetCount(array)
            for index in 0..<count {
                let service = unsafeBitCast(
                    CFArrayGetValueAtIndex(array, index),
                    to: SCNetworkService.self
                )
                let id = SCNetworkServiceGetServiceID(service) as String?
                // A service renamed to something `enable` would refuse can
                // still hold our loopback DNS; with an ID, recovery reaches it.
                guard let name = SCNetworkServiceGetName(service) as String?,
                      id != nil || (try? validateService(name)) != nil else { continue }
                if !includingDisabled, !SCNetworkServiceGetEnabled(service) {
                    continue
                }
                services.insert(NetworkService(id: id, name: name))
            }
            return services
        }
    }

    /// First service with this name in any Network Location. Only name-only
    /// paths (legacy snapshots, enumeration without IDs) use it; `enable`
    /// resolves through `scServiceID`.
    private static func namedService(_ prefs: SCPreferences, _ name: String) -> SCNetworkService? {
        guard let array = SCNetworkServiceCopyAll(prefs) else { return nil }
        let count = CFArrayGetCount(array)
        for index in 0..<count {
            let service = unsafeBitCast(
                CFArrayGetValueAtIndex(array, index),
                to: SCNetworkService.self
            )
            if SCNetworkServiceGetName(service) as String? == name {
                return service
            }
        }
        return nil
    }

    private static func dnsServers(on service: SCNetworkService) -> [String] {
        guard let protocolRef = SCNetworkServiceCopyProtocol(service, kSCNetworkProtocolTypeDNS),
              let configuration = SCNetworkProtocolGetConfiguration(protocolRef) as NSDictionary?,
              let servers = configuration[kSCPropNetDNSServerAddresses] as? [String]
        else {
            return []
        }
        return servers.filter { !$0.isEmpty && isIPAddress($0) }
    }

    private static func withPreferences<T>(lock: Bool, _ body: (SCPreferences) throws -> T) throws -> T {
        guard let prefs = SCPreferencesCreate(nil, "tono-core-helper" as CFString, nil) else {
            throw HelperFailure.system("Could not open network preferences.")
        }
        if lock {
            try lockPreferences(prefs)
        }
        defer {
            if lock {
                SCPreferencesUnlock(prefs)
            }
        }
        return try body(prefs)
    }

    private static func lockPreferences(_ prefs: SCPreferences) throws {
        // The sole request/watchdog thread must not wait for another network
        // settings writer. Keep the DNS snapshot and let the caller retry.
        guard SCPreferencesLock(prefs, false) else {
            throw HelperFailure.system("Could not lock network preferences.")
        }
    }

    /// Uses isolated preferences, never the system network configuration.
    /// The waiter must report contention while the other session still owns
    /// the lock. Releasing the owner also unblocks the original implementation
    /// before the test exits, so a regression cannot hang the test process.
    static func runPreferencesContentionSelfTest() -> Bool {
        guard geteuid() == 0 else { return false }
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-dns-lock-test-\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700]
            )
        } catch { return false }
        defer { try? FileManager.default.removeItem(at: directory) }
        let prefsID = directory.appendingPathComponent("preferences.plist").path as CFString
        guard let owner = SCPreferencesCreate(nil, "tono-lock-owner" as CFString, prefsID),
              let contender = SCPreferencesCreate(nil, "tono-lock-contender" as CFString, prefsID),
              SCPreferencesLock(owner, false) else { return false }
        let finished = DispatchSemaphore(value: 0)
        let busy = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .userInitiated).async {
            defer { finished.signal() }
            do {
                try lockPreferences(contender)
                SCPreferencesUnlock(contender)
            } catch {
                if SCError() == kSCStatusPrefsBusy { busy.signal() }
            }
        }
        let finishedWhileHeld = finished.wait(timeout: .now() + 3) == .success
        SCPreferencesUnlock(owner)
        if !finishedWhileHeld,
           finished.wait(timeout: .now() + 3) != .success { return false }
        return finishedWhileHeld && busy.wait(timeout: .now()) == .success
    }

    static func parseServices(
        _ output: String,
        includingDisabled: Bool
    ) -> Set<String> {
        var services = Set<String>()
        for line in output.components(separatedBy: .newlines).dropFirst() {
            var value = line.trimmingCharacters(in: .whitespacesAndNewlines)
            // The asterisk is `networksetup`'s disabled marker, not part of the
            // name every other subcommand expects.
            if value.hasPrefix("*") {
                guard includingDisabled else { continue }
                value = String(value.dropFirst())
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
            guard !value.isEmpty,
                  (try? validateService(value)) != nil else { continue }
            services.insert(value)
        }
        return services
    }

    private static func runNetworkSetup(_ arguments: [String]) throws -> CommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/networksetup")
        process.arguments = arguments
        process.environment = [
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "LC_ALL": "C",
        ]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            throw HelperFailure.system("Could not run the protected DNS command.")
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard data.count <= 64 * 1024 else {
            throw HelperFailure.system("Protected DNS command output is too large.")
        }
        return .init(
            status: process.terminationStatus,
            output: String(decoding: data, as: UTF8.self)
        )
    }

    private static func parseDNSOutput(_ output: String) throws -> [String] {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("There aren't any DNS Servers set on ") {
            return []
        }
        let servers = trimmed.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !servers.isEmpty, servers.count <= maximumDNSServerCount,
              servers.allSatisfy(isIPAddress) else {
            throw HelperFailure.invalid("The current DNS settings are invalid.")
        }
        return servers
    }

    private static func validateService(_ raw: String) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value == raw, !value.isEmpty, value.utf8.count <= 128,
              !value.unicodeScalars.contains(where: {
                  $0.value < 0x20 || $0.value == 0x7f
              }) else {
            throw HelperFailure.invalid("Invalid network service.")
        }
        return value
    }

    private static func isIPAddress(_ raw: String) -> Bool {
        var ipv4 = in_addr()
        if inet_pton(AF_INET, raw, &ipv4) == 1 { return true }
        var ipv6 = in6_addr()
        return inet_pton(AF_INET6, raw, &ipv6) == 1
    }

    private static func ensureRootDirectory() throws {
        var metadata = stat()
        if lstat(supportDirectory, &metadata) != 0 {
            guard errno == ENOENT, mkdir(supportDirectory, 0o700) == 0 else {
                throw HelperFailure.system("Could not create protected DNS storage.")
            }
        } else {
            guard metadata.st_uid == 0,
                  metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                  metadata.st_mode & 0o022 == 0 else {
                throw HelperFailure.invalid("Protected DNS storage is unsafe.")
            }
        }
        guard chown(supportDirectory, 0, 0) == 0,
              chmod(supportDirectory, 0o700) == 0 else {
            throw HelperFailure.system("Could not secure protected DNS storage.")
        }
    }

    /// A stopped Core with a snapshot restores DNS, including when a kill
    /// switch was wanted. A running Core, or no snapshot, does not.
    static func runBootDNSRecoveryDecisionSelfTest() -> Bool {
        let restoresStopped = shouldRecoverDNSAtBoot(
            coreRunning: false,
            snapshotPresent: true
        )
        let skipsLiveCore = !shouldRecoverDNSAtBoot(
            coreRunning: true,
            snapshotPresent: true
        )
        let skipsForeign = !shouldRecoverDNSAtBoot(
            coreRunning: false,
            snapshotPresent: false
        )
        let ok = restoresStopped && skipsLiveCore && skipsForeign
        if !ok {
            FileHandle.standardError.write(Data("boot DNS recovery decision failed\n".utf8))
        }
        return ok
    }

    /// Fault-injected lifecycle regression. No live DNS preferences or root
    /// snapshot are changed; production restoreServices owns every decision.
    static func runRestoreReadFailureSelfTest() -> Bool {
        enum ReadFailure: Error { case injected }
        let snapshot = Snapshot(service: "Wi-Fi", servers: ["9.9.9.9"])
        var settings = [
            "Wi-Fi": [protectedDNSServer],
            "Disabled Ethernet": [protectedDNSServer],
            "Bridge": [protectedDNSServer],
            "Custom": ["8.8.4.4"],
        ]
        var unreadable = true
        var snapshotRemoved = false
        func restore() throws {
            try restoreServices(
                snapshot: snapshot,
                services: Set(settings.keys.map { NetworkService(id: nil, name: $0) }),
                read: { service in
                    if service.name == "Disabled Ethernet", unreadable { throw ReadFailure.injected }
                    return settings[service.name]!
                },
                write: { settings[$1.name] = $0 },
                removeSnapshot: { snapshotRemoved = true },
                archiveSnapshot: { _ in }
            )
        }
        var refused = false
        do { try restore() } catch ReadFailure.injected { refused = true } catch {}
        guard refused, !snapshotRemoved,
              settings["Wi-Fi"] == ["9.9.9.9"],
              settings["Bridge"] == [protectedDNSServer],
              settings["Disabled Ethernet"] == [protectedDNSServer],
              settings["Custom"] == ["8.8.4.4"] else {
            print("DNS restore read-failure regression FAILED: refused=\(refused), snapshotRemoved=\(snapshotRemoved)")
            return false
        }
        unreadable = false
        do { try restore() } catch { return false }
        guard snapshotRemoved,
              settings["Disabled Ethernet"] == [protectedDNSServer],
              settings["Bridge"] == [protectedDNSServer],
              settings["Wi-Fi"] == ["9.9.9.9"],
              settings["Custom"] == ["8.8.4.4"] else {
            return false
        }
        print("DNS restore read-failure regression passed: failure retains snapshot; other loopback services stay")
        return true
    }

    /// Fault-injected status regression. No live DNS preferences or root
    /// snapshot are read; production statusResponse owns the real reader.
    static func runStatusUnreadableServiceSelfTest() -> Bool {
        enum ReadFailure: Error { case injected }
        let snapshot = Snapshot(service: "Wi-Fi", servers: ["9.9.9.9"])
        let status = statusResponse(snapshotResult: .success(snapshot)) { _ in
            throw ReadFailure.injected
        }
        let snapshotPresent = status["snapshotPresent"] as? Bool
        guard snapshotPresent == true,
              (status["ok"] as? Bool) == false,
              (status["configured"] as? Bool) == false,
              (status["service"] as? String) == "Wi-Fi" else {
            print("DNS status unreadable-service regression FAILED: snapshotPresent=\(snapshotPresent.map { "\($0)" } ?? "nil")")
            return false
        }
        print("DNS status unreadable-service regression passed: a loaded snapshot stays present when its service is unreadable")
        return true
    }

    /// Fault-injected quarantine regression. No live DNS preferences or root
    /// snapshot are changed; production restoreTransaction owns every
    /// decision.
    ///
    /// Before the quarantine path, restore() propagated the loadSnapshot
    /// failure before any service was touched: the loopback sweep never ran
    /// and every outlet (restore, --emergency-disarm, --emergency-reset)
    /// died on the same throw.
    static func runCorruptSnapshotSelfTest() -> Bool {
        var settings = [
            "Wi-Fi": [protectedDNSServer],
            "Custom": ["8.8.4.4"],
        ]
        var quarantined = false
        do {
            _ = try restoreTransaction(
                snapshotResult: .failure(HelperFailure.invalid("Protected DNS state is invalid.")),
                services: Set(settings.keys.map { NetworkService(id: nil, name: $0) }),
                read: { settings[$0.name]! },
                write: { settings[$1.name] = $0 },
                removeSnapshot: {},
                archiveSnapshot: { _ in },
                quarantine: { quarantined = true }
            )
        } catch {
            print("DNS corrupt-snapshot regression FAILED: restore threw \(error)")
            return false
        }
        let status = statusResponse(
            snapshotResult: .failure(HelperFailure.invalid("Protected DNS state is invalid.")),
            read: { settings[$0]! }
        )
        let statusSnapshotPresent = status["snapshotPresent"] as? Bool
        guard quarantined,
              settings["Wi-Fi"] == [],
              settings["Custom"] == ["8.8.4.4"],
              statusSnapshotPresent == true,
              (status["ok"] as? Bool) == false else {
            print(
                "DNS corrupt-snapshot regression FAILED: quarantined=\(quarantined), "
                    + "Wi-Fi=\(settings["Wi-Fi"] ?? []), Custom=\(settings["Custom"] ?? []), "
                    + "status snapshotPresent=\(statusSnapshotPresent.map { "\($0)" } ?? "nil")"
            )
            return false
        }
        print(
            "DNS corrupt-snapshot regression passed: an unreadable snapshot is quarantined "
                + "and the snapshotless loopback sweep still runs; status keeps it visible"
        )
        return true
    }

    /// Fault-injected rename regression (X3-1). No live DNS preferences or
    /// root snapshot are changed; production restoreServices owns every
    /// decision.
    ///
    /// The user renames the protected service while Tono holds its DNS; its
    /// service ID stays. Matched by display name, restore reset the renamed
    /// service to automatic DNS and deleted the only record of its static
    /// resolvers, then reported success.
    static func runRenamedServiceRestoreSelfTest() -> Bool {
        let snapshot = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: ["10.0.0.53"])
        let renamed = NetworkService(id: "S1", name: "办公无线")
        let other = NetworkService(id: "S2", name: "Ethernet")
        var settings = [renamed: [protectedDNSServer], other: ["8.8.4.4"]]
        var readBack = false
        var removedBeforeReadBack = false
        var snapshotRemoved = false
        var restoredOriginal = false
        do {
            restoredOriginal = try restoreServices(
                snapshot: snapshot,
                services: Set(settings.keys),
                read: { service in
                    let servers = settings[service]!
                    if service == renamed, servers == ["10.0.0.53"] { readBack = true }
                    return servers
                },
                write: { settings[$1] = $0 },
                removeSnapshot: {
                    removedBeforeReadBack = !readBack
                    snapshotRemoved = true
                },
                archiveSnapshot: { _ in }
            )
        } catch {
            print("DNS renamed-service regression FAILED: restore threw \(error)")
            return false
        }
        guard settings[renamed] == ["10.0.0.53"],
              settings[other] == ["8.8.4.4"],
              restoredOriginal, snapshotRemoved, !removedBeforeReadBack else {
            print(
                "DNS renamed-service regression FAILED: renamed=\(settings[renamed] ?? []), "
                    + "restoredOriginal=\(restoredOriginal), snapshotRemoved=\(snapshotRemoved), "
                    + "removedBeforeReadBack=\(removedBeforeReadBack)"
            )
            return false
        }
        print("DNS renamed-service regression passed: a renamed service gets its original DNS back by service ID")
        return true
    }

    /// A newer explicit setting on the same stable service ID supersedes the
    /// snapshot; release must not report the saved original as restored.
    static func runSupersededRestoreSelfTest() -> Bool {
        let snapshot = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: ["10.0.0.53"])
        let owner = NetworkService(id: "S1", name: "Renamed Wi-Fi")
        let other = NetworkService(id: "S2", name: "Ethernet")
        var settings = [owner: ["9.9.9.9"], other: [protectedDNSServer]]
        var ownerWrites = 0
        var removed = false
        var archived: String?
        let restored: Bool
        do {
            restored = try restoreServices(
                snapshot: snapshot,
                services: Set(settings.keys),
                read: { settings[$0]! },
                write: { servers, service in
                    if service == owner { ownerWrites += 1 }
                    settings[service] = servers
                },
                removeSnapshot: { removed = true },
                archiveSnapshot: { archived = $0 }
            )
        } catch {
            print("DNS superseded-restore regression FAILED: \(error)")
            return false
        }
        guard !restored, !removed, archived == "superseded", ownerWrites == 0,
              settings[owner] == ["9.9.9.9"], settings[other] == [protectedDNSServer] else {
            print("DNS superseded-restore regression FAILED: newer DNS was changed or a foreign resolver was cleared")
            return false
        }
        print("DNS superseded-restore regression passed: newer DNS retained, foreign loopback kept")
        return true
    }

    /// A second service left on 127.0.0.1 is not Tono's just because the
    /// address matches. The snapshot owner is restored; the other service stays.
    static func runForeignLoopbackKeptSelfTest() -> Bool {
        let snapshot = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: ["10.0.0.53"])
        let owner = NetworkService(id: "S1", name: "Wi-Fi")
        let other = NetworkService(id: "S2", name: "Ethernet")
        var settings = [owner: [protectedDNSServer], other: [protectedDNSServer]]
        var removed = false
        let restored: Bool
        do {
            restored = try restoreServices(
                snapshot: snapshot,
                services: Set(settings.keys),
                read: { settings[$0]! },
                write: { settings[$1] = $0 },
                removeSnapshot: { removed = true },
                archiveSnapshot: { _ in }
            )
        } catch {
            print("DNS foreign-loopback regression FAILED: \(error)")
            return false
        }
        guard restored, removed,
              settings[owner] == ["10.0.0.53"],
              settings[other] == [protectedDNSServer] else {
            print(
                "DNS foreign-loopback regression FAILED: owner=\(settings[owner] ?? []), "
                    + "other=\(settings[other] ?? [])"
            )
            return false
        }
        print("DNS foreign-loopback regression passed: only the snapshot owner was rewritten")
        return true
    }

    /// A service handoff likewise cannot restore a snapshot over a newer
    /// explicit setting on the former owner's stable service ID.
    static func runSupersededHandoffSelfTest() -> Bool {
        let snapshot = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: ["10.0.0.53"])
        let owner = NetworkService(id: "S1", name: "Renamed Wi-Fi")
        let next = NetworkService(id: "S2", name: "Ethernet")
        var settings = [owner: ["9.9.9.9"], next: ["8.8.4.4"]]
        var writes = 0
        var removed = false
        var archived = false
        do {
            try retirePreviousSnapshot(
                snapshot,
                services: Set(settings.keys),
                read: { settings[$0]! },
                write: { servers, service in
                    writes += 1
                    settings[service] = servers
                },
                removeSnapshot: { removed = true },
                archiveSnapshot: { archived = true }
            )
        } catch {
            print("DNS superseded-handoff regression FAILED: \(error)")
            return false
        }
        guard archived, !removed, writes == 0,
              settings[owner] == ["9.9.9.9"], settings[next] == ["8.8.4.4"] else {
            print("DNS superseded-handoff regression FAILED: newer DNS was changed or snapshot discarded")
            return false
        }
        print("DNS superseded-handoff regression passed: newer DNS retained and old snapshot archived")
        return true
    }

    /// An ID I/O failure must never address a reused display name. These
    /// are the same dispatchers used by production restore and handoff.
    static func runStableIDIOFailureSelfTest() -> Bool {
        enum IDFailure: Error { case injected }
        let owner = NetworkService(id: "S1", name: "Wi-Fi")
        var nameReads = 0
        var nameWrites = 0
        var readRefused = false
        var writeRefused = false
        do {
            _ = try readDNS(
                on: owner,
                readByID: { _ in throw IDFailure.injected },
                readByName: { _ in nameReads += 1; return ["9.9.9.9"] }
            )
        } catch IDFailure.injected { readRefused = true } catch {}
        do {
            try writeDNS(
                ["10.0.0.53"],
                on: owner,
                writeByID: { _, _ in throw IDFailure.injected },
                writeByName: { _, _ in nameWrites += 1 }
            )
        } catch IDFailure.injected { writeRefused = true } catch {}
        guard readRefused, writeRefused, nameReads == 0, nameWrites == 0 else {
            print("DNS stable-ID I/O regression FAILED: an ID failure reached a display name")
            return false
        }
        print("DNS stable-ID I/O regression passed: ID read/write failures propagate without name fallback")
        return true
    }

    /// Re-enable after an external DNS change must persist that newer choice
    /// before loopback, then restore it on disconnect; retry cannot resurrect
    /// the older snapshot or archive the new one again.
    static func runSameOwnerReenableSelfTest() -> Bool {
        enum WriteFailure: Error { case injected }
        let owner = NetworkService(id: "S1", name: "Renamed Wi-Fi")
        let old = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: ["10.0.0.53"])
        var durable = old
        var current = ["9.9.9.9"]
        var archived: [Snapshot] = []
        var writeBeforeSave = false
        var failFirstWrite = true
        var removed = false
        func reenable() throws {
            try reenableSameOwner(
                durable,
                service: owner,
                read: { _ in current },
                write: { servers, _ in
                    if durable.servers != ["9.9.9.9"] || archived != [old] {
                        writeBeforeSave = true
                    }
                    if failFirstWrite {
                        failFirstWrite = false
                        throw WriteFailure.injected
                    }
                    current = servers
                },
                save: { durable = $0 },
                archiveSnapshot: { archived.append(durable) }
            )
        }
        do {
            do {
                try reenable()
                print("DNS same-owner re-enable regression FAILED: injected write was accepted")
                return false
            } catch WriteFailure.injected {
                guard durable.servers == ["9.9.9.9"], archived == [old],
                      current == ["9.9.9.9"] else {
                    print("DNS same-owner re-enable regression FAILED: write failure lost recovery evidence")
                    return false
                }
            } catch {
                throw error
            }
            try reenable()
            try reenable()
            let restored = try restoreServices(
                snapshot: durable,
                services: [owner],
                read: { _ in current },
                write: { servers, _ in current = servers },
                removeSnapshot: { removed = true },
                archiveSnapshot: { _ in }
            )
            guard restored, removed, !writeBeforeSave, archived == [old],
                  durable.serviceID == owner.id, durable.servers == ["9.9.9.9"],
                  current == ["9.9.9.9"] else {
                print("DNS same-owner re-enable regression FAILED: newer DNS or recovery evidence lost")
                return false
            }
        } catch {
            print("DNS same-owner re-enable regression FAILED: \(error)")
            return false
        }
        print("DNS same-owner re-enable regression passed: write failure retained evidence; retry restored newer DNS")
        return true
    }

    /// First enable must refuse absent or failed identity before any DNS
    /// I/O, even when no prior ID-bearing snapshot exists.
    static func runEnableIdentityFailureSelfTest() -> Bool {
        enum LookupFailure: Error { case injected }
        var missingRefused = false
        var lookupFailurePreserved = false
        do {
            _ = try requireServiceID(named: "Wi-Fi", lookup: { _ in nil })
        } catch HelperFailure.system { missingRefused = true } catch {}
        do {
            _ = try requireServiceID(named: "Wi-Fi", lookup: { _ in throw LookupFailure.injected })
        } catch LookupFailure.injected { lookupFailurePreserved = true } catch {}
        guard missingRefused, lookupFailurePreserved else {
            print("DNS enable-identity regression FAILED: absent or failed lookup was admitted")
            return false
        }
        print("DNS enable-identity regression passed: absent and failed lookup refuse protection")
        return true
    }

    /// MAC-DNS-SNAPSHOT-OVER-8: reads carried no count limit while load and
    /// write capped at 8, so enabling on a 9+-resolver service recorded a
    /// snapshot restore had to quarantine: the original DNS could never come
    /// back, and a failed enable could not roll back. One constant now caps
    /// read, save, load and write, so a 9-server list round-trips every
    /// layer, and an over-cap list is refused everywhere.
    static func runServerCountCapSelfTest() -> Bool {
        let nine = (1...9).map { "192.0.2.\($0)" }
        var written: [String] = []
        do {
            guard try parseDNSOutput(nine.joined(separator: "\n")) == nine else {
                print("DNS server-count cap regression FAILED: a 9-server read was rejected")
                return false
            }
            try writeDNS(
                nine,
                on: NetworkService(id: "S1", name: "Wi-Fi"),
                writeByID: { servers, _ in written = servers },
                writeByName: { _, _ in }
            )
        } catch {
            print("DNS server-count cap regression FAILED: 9 servers refused at read or write: \(error)")
            return false
        }
        guard written == nine else {
            print("DNS server-count cap regression FAILED: the 9-server write did not reach the service")
            return false
        }
        let snapshot = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: nine)
        do {
            let decoded = try JSONDecoder().decode(
                Snapshot.self,
                from: JSONEncoder().encode(snapshot)
            )
            guard decoded == snapshot, isRestorableSnapshot(decoded) else {
                print("DNS server-count cap regression FAILED: a 9-server snapshot failed load validation")
                return false
            }
        } catch {
            print("DNS server-count cap regression FAILED: snapshot round-trip threw \(error)")
            return false
        }
        let overCap = (1...maximumDNSServerCount + 1).map { "198.51.100.\($0)" }
        do {
            try writeDNS(
                overCap,
                on: NetworkService(id: "S1", name: "Wi-Fi"),
                writeByID: { _, _ in },
                writeByName: { _, _ in }
            )
            print("DNS server-count cap regression FAILED: an over-cap write was accepted")
            return false
        } catch {}
        guard (try? parseDNSOutput(overCap.joined(separator: "\n"))) == nil,
              !isRestorableSnapshot(Snapshot(service: "Wi-Fi", servers: overCap)) else {
            print("DNS server-count cap regression FAILED: an over-cap list passed read or load validation")
            return false
        }
        print("DNS server-count cap regression passed: 9 servers round-trip read/write/load; over-cap refused everywhere")
        return true
    }

    /// Whether a restore reply carries `originalDNSRestored: false`. A
    /// deferred release also records its loss at `noticePath`; any other
    /// reply reports its own loss or a recorded one, and removes the record
    /// so the app is told once.
    static func reportsOriginalLoss(
        originalRestored: Bool,
        deferred: Bool,
        noticePath: String
    ) -> Bool {
        if deferred {
            if !originalRestored {
                let fd = open(noticePath, O_WRONLY | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
                if fd >= 0 {
                    close(fd)
                } else {
                    FileHandle.standardError.write(Data(
                        "tono: the unrestored original DNS could not be recorded for the app\n".utf8
                    ))
                }
            }
            return !originalRestored
        }
        let recorded = unlink(noticePath) == 0
        return !originalRestored || recorded
    }

    /// A loss recorded by a deferred release that no `/dns/restore` reply
    /// has reported yet.
    static var originalLossRecorded: Bool {
        access(originalLossNoticePath, F_OK) == 0
    }

    /// TM-claude-4: native update preparation and emergency recovery release
    /// DNS with no app reply to carry `originalDNSRestored: false`. Their loss
    /// must reach the app's next `/dns/restore` reply, and only that one.
    static func runDeferredOriginalLossSelfTest() -> Bool {
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-dns-original-loss-\(getpid())").path
        unlink(path)
        defer { unlink(path) }
        let deferred = reportsOriginalLoss(originalRestored: false, deferred: true, noticePath: path)
        let nextReply = reportsOriginalLoss(originalRestored: true, deferred: false, noticePath: path)
        let laterReply = reportsOriginalLoss(originalRestored: true, deferred: false, noticePath: path)
        guard deferred, nextReply, !laterReply else {
            print(
                "DNS deferred-loss regression FAILED: deferred=\(deferred), "
                    + "nextReply=\(nextReply), laterReply=\(laterReply)"
            )
            return false
        }
        print("DNS deferred-loss regression passed: a loss with no app reply reaches the next /dns/restore once")
        return true
    }

    /// A renamed service still answers by `serviceID`. The display name in
    /// the snapshot is stale and must not be the status key.
    static func runRenamedServiceStatusSelfTest() -> Bool {
        let snapshot = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: ["9.9.9.9"])
        let status = statusResponse(snapshotResult: .success(snapshot), read: { _ in
            ["1.1.1.1"]
        }, readByID: { id in
            guard id == "S1" else {
                throw HelperFailure.invalid("Unexpected service id.")
            }
            return [protectedDNSServer]
        })
        guard (status["configured"] as? Bool) == true,
              (status["snapshotPresent"] as? Bool) == true else {
            print("DNS renamed-service status regression FAILED")
            return false
        }
        print("DNS renamed-service status regression passed: status follows serviceID")
        return true
    }

    static func runRestoreApplyRetrySelfTest() -> Bool {
        enum ApplyFailure: Error { case injected }
        let snapshot = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: ["9.9.9.9"])
        let owner = NetworkService(id: "S1", name: "Wi-Fi")
        var persisted = [protectedDNSServer]
        var active = persisted
        var failApply = true
        var writes = 0
        var removed = false
        func restore() throws {
            try restoreServices(
                snapshot: snapshot,
                services: [owner],
                read: { _ in persisted },
                write: { servers, _ in
                    writes += 1
                    persisted = servers
                    if failApply {
                        failApply = false
                        throw ApplyFailure.injected
                    }
                    active = servers
                },
                removeSnapshot: { removed = true },
                archiveSnapshot: { _ in }
            )
        }
        do { try restore(); return false } catch ApplyFailure.injected {} catch { return false }
        guard !removed, persisted == snapshot.servers, active == [protectedDNSServer] else {
            return false
        }
        do { try restore() } catch { return false }
        return removed && writes == 2 && active == snapshot.servers
    }

    static func runSnapshotlessRestoreApplyRetrySelfTest() -> Bool {
        enum ApplyFailure: Error { case injected }
        let owner = NetworkService(id: "S1", name: "Wi-Fi")
        let foreign = NetworkService(id: "S2", name: "Ethernet")
        var persisted = [owner: [protectedDNSServer], foreign: ["9.9.9.9"]]
        var active = persisted
        var writes = 0
        var activations = 0
        var failActivation = true
        func restore() throws {
            _ = try restoreTransaction(
                snapshotResult: .success(nil),
                services: [owner, foreign],
                read: { persisted[$0] ?? [] },
                write: { servers, service in
                    writes += 1
                    persisted[service] = servers
                    // Model Commit succeeding while its first Apply fails.
                    throw ApplyFailure.injected
                },
                removeSnapshot: {}, archiveSnapshot: { _ in }, quarantine: {},
                activate: {
                    activations += 1
                    if failActivation {
                        failActivation = false
                        throw ApplyFailure.injected
                    }
                    active = persisted
                }
            )
        }
        do { try restore(); return false } catch ApplyFailure.injected {} catch { return false }
        guard persisted[owner] == [], active[owner] == [protectedDNSServer] else { return false }
        // No write is needed on retry, but failed activation is not success.
        do { try restore(); return false } catch ApplyFailure.injected {} catch { return false }
        do { try restore() } catch { return false }
        let passed = writes == 1 && activations == 2 && active[owner] == []
            && persisted[foreign] == ["9.9.9.9"] && active[foreign] == ["9.9.9.9"]
        print("DNS snapshotless Apply retry regression \(passed ? "passed" : "FAILED")")
        return passed
    }

    static func runRepeatedOwnedRestoreSelfTest() -> Bool {
        guard geteuid() == 0 else { return false }
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-dns-retirement-\(UUID().uuidString)")
        let receipt = directory.appendingPathComponent("receipt").path
        let owner = NetworkService(id: "S1", name: "Wi-Fi")
        let foreign = NetworkService(id: "S2", name: "Ethernet")
        let original = ["9.9.9.9"]
        var dns = [owner: [protectedDNSServer], foreign: [protectedDNSServer]]
        var activations = 0
        var snapshot: Snapshot? = Snapshot(service: owner.name, serviceID: owner.id, servers: original)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
            defer { try? FileManager.default.removeItem(at: directory) }
            func restore() throws {
                _ = try restoreTransaction(
                    snapshotResult: .success(snapshot), services: [owner, foreign],
                    read: { dns[$0] ?? [] }, write: { dns[$1] = $0 },
                    removeSnapshot: { snapshot = nil }, archiveSnapshot: { _ in snapshot = nil },
                    quarantine: {}, activate: { activations += 1 },
                    completedRestoreAvailable: { completedRestoreReceiptPresent(path: receipt) },
                    recordCompletedRestore: { try? saveCompletedRestoreReceipt(path: receipt) }
                )
            }
            try restore()
            guard snapshot == nil, dns[owner] == original, dns[foreign] == [protectedDNSServer],
                  completedRestoreReceiptPresent(path: receipt) else { return false }
            // Model the second app cleanup and a fresh helper reading the receipt.
            try restore()
            guard dns[owner] == original, dns[foreign] == [protectedDNSServer],
                  activations == 1 else { return false }
            try clearCompletedRestoreReceipt(path: receipt)
            // A later transition invalidates proof: independent snapshotless
            // crash recovery must still sweep the exact stopped listener.
            try restore()
            return dns[owner] == original && dns[foreign] == [] && activations == 2
        } catch { return false }
    }

    static func runHandoffApplyRetrySelfTest() -> Bool {
        enum ApplyFailure: Error { case injected }
        let snapshot = Snapshot(service: "Wi-Fi", serviceID: "S1", servers: ["9.9.9.9"])
        let owner = NetworkService(id: "S1", name: "Wi-Fi")
        var persisted = [protectedDNSServer]
        var active = persisted
        var failApply = true
        var writes = 0
        var removed = false
        func retire() throws {
            try retirePreviousSnapshot(
                snapshot,
                services: [owner],
                read: { _ in persisted },
                write: { servers, _ in
                    writes += 1
                    persisted = servers
                    if failApply {
                        failApply = false
                        throw ApplyFailure.injected
                    }
                    active = servers
                },
                removeSnapshot: { removed = true },
                archiveSnapshot: {}
            )
        }
        do { try retire(); return false } catch ApplyFailure.injected {} catch { return false }
        guard !removed, persisted == snapshot.servers, active == [protectedDNSServer] else {
            return false
        }
        do { try retire() } catch { return false }
        return removed && writes == 2 && active == snapshot.servers
    }

    static func runSelfTests() -> Bool {
        do {
            guard try validateService("Wi-Fi") == "Wi-Fi",
                  try parseDNSOutput(
                    "There aren't any DNS Servers set on Wi-Fi.\n"
                  ).isEmpty,
                  try parseDNSOutput("1.1.1.1\n2606:4700:4700::1111\n")
                    == ["1.1.1.1", "2606:4700:4700::1111"],
                  protectedDNSServer == "127.0.0.1",
                  ProtectedDNSContract.port == 53,
                  isIPAddress(protectedDNSServer) else {
                return false
            }
            do {
                _ = try validateService("Wi-Fi\nInjected")
                return false
            } catch {}
            do {
                _ = try parseDNSOutput("not-an-address\n")
                return false
            } catch {}
            let listing = """
            An asterisk (*) denotes that a network service is disabled.
            Wi-Fi
            *Thunderbolt Bridge
            Ethernet

            """
            guard parseServices(listing, includingDisabled: false)
                    == ["Wi-Fi", "Ethernet"],
                  // Recovery has to reach a disabled adapter, and it must ask
                  // for it by the name every other subcommand accepts.
                  parseServices(listing, includingDisabled: true)
                    == ["Wi-Fi", "Ethernet", "Thunderbolt Bridge"] else {
                return false
            }
            return runRestoreApplyRetrySelfTest()
                && runSnapshotlessRestoreApplyRetrySelfTest()
                && runHandoffApplyRetrySelfTest()
                && runSupersededRestoreSelfTest()
                && runForeignLoopbackKeptSelfTest()
                && runSupersededHandoffSelfTest()
                && runStableIDIOFailureSelfTest()
                && runSameOwnerReenableSelfTest()
                && runEnableIdentityFailureSelfTest()
                && runBootDNSRecoveryDecisionSelfTest()
                && runRenamedServiceStatusSelfTest()
                && runServerCountCapSelfTest()
        } catch {
            return false
        }
    }
}
