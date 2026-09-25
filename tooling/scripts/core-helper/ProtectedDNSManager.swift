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
    /// Left by a release no app reply carries (native update preparation,
    /// `--emergency-disarm`, `--emergency-reset`) when the original servers
    /// had no service to go back to. Presence is the record (TM-claude-4).
    private static let originalLossNoticePath = "\(supportDirectory)/protected-dns.original-not-restored"
    static let protectedDNSServer = ProtectedDNSContract.server
    private static let maximumStateBytes = 16 * 1024
    private let lock = NSLock()

    init() throws {
        try Self.ensureRootDirectory()
    }

    func enable(service rawService: String) throws -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }

        let service = try Self.validateService(rawService)
        // `networksetup -getdnsservers` already fails for a missing service.
        // Listing every service first was a second process spawn on every
        // connect just to answer the same question.
        let existingServers: [String]
        do {
            existingServers = try Self.currentDNS(for: service)
        } catch {
            guard try Self.availableServices().contains(service) else {
                throw HelperFailure.invalid("The selected network service is unavailable.")
            }
            throw error
        }

        let serviceID = try? Self.scServiceID(named: service)

        if let previous = try loadSnapshotQuarantiningCorruption() {
            if !Self.isSameService(previous, name: service, id: serviceID) {
                let services = try Self.allServices()
                guard case .service(let owner) = Self.owner(of: previous, in: services) else {
                    throw HelperFailure.invalid(
                        "The previously protected network service is unavailable."
                    )
                }
                try Self.writeDNS(previous.servers, on: owner)
                guard try Self.readDNS(on: owner) == previous.servers else {
                    throw HelperFailure.system("The protected DNS transition did not commit.")
                }
                try removeSnapshot()
            } else {
                if previous.service != service {
                    // Same service by ID, renamed since the snapshot. Status
                    // reads by the recorded name, so record the current one.
                    try save(Snapshot(
                        service: service,
                        serviceID: previous.serviceID ?? serviceID,
                        servers: previous.servers
                    ))
                }
                try Self.setDNS([Self.protectedDNSServer], for: service)
                try verify([Self.protectedDNSServer], for: service)
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
        let snapshot = Snapshot(
            service: service,
            serviceID: serviceID,
            servers: servers
        )
        // Persist recovery state before changing the first system setting.
        try save(snapshot)
        do {
            try Self.setDNS([Self.protectedDNSServer], for: service)
            try verify([Self.protectedDNSServer], for: service)
        } catch {
            if (try? Self.setDNS(snapshot.servers, for: service)) != nil,
               (try? verify(snapshot.servers, for: service)) != nil {
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
            archiveSnapshot: { try Self.quarantineSnapshot(reason: "orphaned") },
            quarantine: { try Self.quarantineSnapshot() }
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
            // recorded servers had no service left to go back to. They stay
            // on disk beside the state file, not claimed as restored.
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
            guard try !Self.readDNS(on: service).contains(Self.protectedDNSServer) else {
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
               servers.contains(Self.protectedDNSServer) {
                throw HelperFailure.invalid("The active resolver still points to the stopped Core.")
            }
        }
    }

    /// The same recovery transaction runs against either System Configuration
    /// or controlled I/O. Snapshot removal is part of the transaction, not a
    /// decision a test or caller can make independently of service readback.
    ///
    /// The snapshot's service is found by its recorded ID, not its display
    /// name. Matching by name turned a rename into "not our service": the
    /// sweep reset it to automatic DNS and the snapshot holding its static
    /// servers was deleted. Returns false when no service can take the
    /// original servers; the snapshot is then archived, not deleted.
    @discardableResult
    private static func restoreServices(
        snapshot: Snapshot?,
        services: Set<NetworkService>,
        read: (NetworkService) throws -> [String],
        write: ([String], NetworkService) throws -> Void,
        removeSnapshot: () throws -> Void,
        archiveSnapshot: () throws -> Void
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
        if let snapshot {
            switch owner(of: snapshot, in: services) {
            case .service(let service):
                target = service
                attempt(snapshot.servers, for: service)
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
        for service in services {
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
            // their own is not ours to rewrite.
            guard current == [Self.protectedDNSServer] else { continue }
            attempt(service == target ? snapshot?.servers ?? [] : [], for: service)
        }
        if let failure {
            throw failure
        }
        if ownerMissing {
            try archiveSnapshot()
            return false
        }
        try removeSnapshot()
        return true
    }

    private static func owner(
        of snapshot: Snapshot,
        in services: Set<NetworkService>
    ) -> SnapshotOwner {
        if let id = snapshot.serviceID, !services.isEmpty,
           services.allSatisfy({ $0.id != nil }) {
            guard let service = services.first(where: { $0.id == id }) else {
                return .missing
            }
            return .service(service)
        }
        if let service = services.first(where: { $0.name == snapshot.service }) {
            return .service(service)
        }
        return snapshot.serviceID == nil ? .missing : .unresolved
    }

    private static func isSameService(_ snapshot: Snapshot, name: String, id: String?) -> Bool {
        if let recorded = snapshot.serviceID, let id {
            return recorded == id
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
        archiveSnapshot: () throws -> Void,
        quarantine: () throws -> Void
    ) throws -> (snapshot: Snapshot?, originalRestored: Bool) {
        let snapshot: Snapshot?
        switch snapshotResult {
        case .success(let loaded):
            snapshot = loaded
        case .failure(let error):
            guard let failure = error as? HelperFailure, case .invalid = failure else {
                throw error
            }
            try quarantine()
            snapshot = nil
        }
        let originalRestored = try restoreServices(
            snapshot: snapshot,
            services: services,
            read: read,
            write: write,
            removeSnapshot: removeSnapshot,
            archiveSnapshot: archiveSnapshot
        )
        return (snapshot, originalRestored)
    }

    func status() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return Self.statusResponse(
            snapshotResult: Result(catching: loadSnapshot),
            read: Self.currentDNS
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
        read: (String) throws -> [String]
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
            let configured =
                try read(snapshot.service) == [Self.protectedDNSServer]
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

    private func verify(_ expected: [String], for service: String) throws {
        guard try Self.currentDNS(for: service) == expected else {
            throw HelperFailure.system("The protected DNS transition did not commit.")
        }
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
              (try? Self.validateService(snapshot.service)) != nil,
              snapshot.serviceID.map({ (try? Self.validateService($0)) != nil }) ?? true,
              snapshot.servers.count <= 8,
              snapshot.servers.allSatisfy(Self.isIPAddress) else {
            throw HelperFailure.invalid("Protected DNS state is invalid.")
        }
        return snapshot
    }

    private func save(_ snapshot: Snapshot) throws {
        let data = try JSONEncoder().encode(snapshot)
        guard data.count <= Self.maximumStateBytes else {
            throw HelperFailure.invalid("Protected DNS state is too large.")
        }
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

    /// Rename an unreadable snapshot aside instead of deleting it: even a
    /// corrupt file is the only record of what this machine's resolvers used
    /// to be, and it is diagnosis evidence for the external event that
    /// produced it. The support directory is root-only 0700, so the renamed
    /// file stays unreachable whatever metadata made it unworthy of trust;
    /// root ownership is re-asserted anyway because losing it is one of the
    /// corruption modes. ENOENT — nothing to quarantine — is not an error:
    /// the caller proceeds as a plain missing snapshot. `orphaned` sets aside
    /// a valid snapshot whose service no longer exists, for the same reason.
    private static func quarantineSnapshot(reason: String = "corrupt") throws {
        let quarantined = "\(statePath).\(reason)-\(Int(Date().timeIntervalSince1970))"
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
        guard servers.count <= 8, servers.allSatisfy(isIPAddress) else {
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

    /// By service ID when the enumeration supplied one. The name, current
    /// as of that same enumeration, is the `networksetup` fallback.
    private static func readDNS(on service: NetworkService) throws -> [String] {
        if let id = service.id, let servers = try? scCurrentDNS(.id(id)) {
            return servers
        }
        return try currentDNS(for: service.name)
    }

    private static func writeDNS(_ servers: [String], on service: NetworkService) throws {
        guard servers.count <= 8, servers.allSatisfy(isIPAddress) else {
            throw HelperFailure.invalid("A protected DNS snapshot is invalid.")
        }
        if let id = service.id, (try? scSetDNS(servers, .id(id))) != nil {
            return
        }
        try setDNS(servers, for: service.name)
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

    private static func scServiceID(named service: String) throws -> String? {
        try withPreferences(lock: false) { prefs in
            namedService(prefs, service).flatMap {
                SCNetworkServiceGetServiceID($0) as String?
            }
        }
    }

    private static func scCurrentDNS(_ key: ServiceKey) throws -> [String] {
        try withPreferences(lock: false) { prefs in
            guard let networkService = key.resolve(in: prefs) else {
                throw HelperFailure.invalid("The selected network service is unavailable.")
            }
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
            guard SCPreferencesLock(prefs, true) else {
                throw HelperFailure.system("Could not lock network preferences.")
            }
        }
        defer {
            if lock {
                SCPreferencesUnlock(prefs)
            }
        }
        return try body(prefs)
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
        guard !servers.isEmpty, servers.count <= 8,
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
                archiveSnapshot: {}
            )
        }
        var refused = false
        do { try restore() } catch ReadFailure.injected { refused = true } catch {}
        guard refused, !snapshotRemoved,
              settings["Wi-Fi"] == ["9.9.9.9"],
              settings["Bridge"] == [],
              settings["Disabled Ethernet"] == [protectedDNSServer],
              settings["Custom"] == ["8.8.4.4"] else {
            print("DNS restore read-failure regression FAILED: refused=\(refused), snapshotRemoved=\(snapshotRemoved)")
            return false
        }
        unreadable = false
        do { try restore() } catch { return false }
        guard snapshotRemoved, settings["Disabled Ethernet"] == [],
              settings["Wi-Fi"] == ["9.9.9.9"], settings["Custom"] == ["8.8.4.4"] else {
            return false
        }
        print("DNS restore read-failure regression passed: failure retains snapshot; retry restores all services")
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
                archiveSnapshot: {},
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
                archiveSnapshot: {}
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
            return true
        } catch {
            return false
        }
    }
}
