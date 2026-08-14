import Foundation
import Darwin

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
        let service: String
        let servers: [String]
    }

    private struct CommandResult {
        let status: Int32
        let output: String
    }

    private static let supportDirectory = "/Library/Application Support/Tono"
    private static let statePath = "\(supportDirectory)/protected-dns.json"
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
        guard try Self.availableServices().contains(service) else {
            throw HelperFailure.invalid("The selected network service is unavailable.")
        }

        if let previous = try loadSnapshot() {
            if previous.service != service {
                try Self.setDNS(previous.servers, for: previous.service)
                try verify(previous.servers, for: previous.service)
                try removeSnapshot()
            } else {
                try Self.setDNS([Self.protectedDNSServer], for: service)
                try verify([Self.protectedDNSServer], for: service)
                return response(
                    configured: true,
                    snapshotPresent: true,
                    service: service
                )
            }
        }

        var servers = try Self.currentDNS(for: service)
        if servers == [Self.protectedDNSServer] {
            // A previous session left the Mihomo listener in place without a
            // snapshot. Recording that as "original DNS" makes Restore Internet
            // write 127.0.0.1 back after Mihomo is gone.
            servers = []
        }
        let snapshot = Snapshot(
            service: service,
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
        return response(
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
    func restore() throws -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        let snapshot = try loadSnapshot()
        let services = try Self.allServices()
        var failure: Error?

        func attempt(_ servers: [String], for service: String) {
            do {
                try Self.setDNS(servers, for: service)
                try verify(servers, for: service)
            } catch {
                failure = failure ?? error
            }
        }

        if let snapshot, services.contains(snapshot.service) {
            attempt(snapshot.servers, for: snapshot.service)
        }
        for service in services {
            let current = (try? Self.currentDNS(for: service)) ?? []
            // Only loopback is swept. A service the user pointed somewhere of
            // their own is not ours to rewrite.
            guard current == [Self.protectedDNSServer] else { continue }
            attempt(snapshot?.service == service ? snapshot!.servers : [], for: service)
        }
        if let failure {
            throw failure
        }
        try removeSnapshot()
        return response(
            configured: false,
            snapshotPresent: false,
            service: snapshot?.service
        )
    }

    func status() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        do {
            guard let snapshot = try loadSnapshot() else {
                return response(
                    configured: false,
                    snapshotPresent: false,
                    service: nil
                )
            }
            let configured =
                try Self.currentDNS(for: snapshot.service) == [Self.protectedDNSServer]
            return response(
                configured: configured,
                snapshotPresent: true,
                service: snapshot.service
            )
        } catch {
            return [
                "ok": false,
                "configured": false,
                "snapshotPresent": false,
                "error": "Protected DNS status is unavailable.",
            ]
        }
    }

    private func response(
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

    // MARK: - networksetup

    private static func currentDNS(for service: String) throws -> [String] {
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
        let values = servers.isEmpty ? ["Empty"] : servers
        let result = try runNetworkSetup(["-setdnsservers", service] + values)
        guard result.status == 0 else {
            throw HelperFailure.system("Could not update the protected DNS settings.")
        }
    }

    /// Services macOS currently has enabled. Protecting a disabled adapter is
    /// meaningless, so `enable` validates against this narrower set.
    private static func availableServices() throws -> Set<String> {
        try listServices(includingDisabled: false)
    }

    /// Every service in the configuration, disabled ones included. Recovery has
    /// to reach those: a disabled adapter keeps whatever DNS it was left with.
    private static func allServices() throws -> Set<String> {
        try listServices(includingDisabled: true)
    }

    private static func listServices(includingDisabled: Bool) throws -> Set<String> {
        let result = try runNetworkSetup(["-listallnetworkservices"])
        guard result.status == 0 else {
            throw HelperFailure.system("Could not enumerate network services.")
        }
        return parseServices(result.output, includingDisabled: includingDisabled)
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
