import Foundation
import SystemConfiguration

// MARK: - System Proxy Error

enum SystemProxyError: LocalizedError {
    case noNetworkService
    case commandFailed(String)
    case privilegesDenied

    var errorDescription: String? {
        switch self {
        case .noNetworkService:
            "No active network service found."
        case .commandFailed(let detail):
            "System proxy command failed: \(detail)"
        case .privilegesDenied:
            "Administrator privileges were denied."
        }
    }
}

// MARK: - Saved Proxy State

/// Snapshot of the original system proxy settings before we modify them.
nonisolated private struct ProxySnapshot: Codable {
    var httpEnabled: Bool
    var httpServer: String
    var httpPort: Int
    var httpsEnabled: Bool
    var httpsServer: String
    var httpsPort: Int
    var socksEnabled: Bool
    var socksServer: String
    var socksPort: Int
}

// MARK: - System Proxy Manager

nonisolated struct SystemProxy {

    // MARK: UserDefaults Keys

    private static let didSetProxyKey = "Tono_didSetSystemProxy"
    private static let snapshotKey = "Tono_proxySnapshot"
    private static let activePortKey = "Tono_activeProxyPort"
    private static let activeSocksPortKey = "Tono_activeSocksPort"
    private static let activeServiceKey = "Tono_activeProxyService"

    /// Mark that we have set the system proxy
    private static func markProxySet() {
        AppProfile.defaults.set(true, forKey: didSetProxyKey)
    }

    /// Clear the marker and snapshot
    private static func clearProxyMark() {
        AppProfile.defaults.removeObject(forKey: didSetProxyKey)
        AppProfile.defaults.removeObject(forKey: snapshotKey)
        AppProfile.defaults.removeObject(forKey: activePortKey)
        AppProfile.defaults.removeObject(forKey: activeSocksPortKey)
        AppProfile.defaults.removeObject(forKey: activeServiceKey)
    }

    /// Check if we previously set the system proxy
    static var didSetProxy: Bool {
        AppProfile.defaults.bool(forKey: didSetProxyKey)
    }

    // MARK: - Read Current Proxy Settings

    /// Parse output of networksetup -getwebproxy / -getsecurewebproxy / -getsocksfirewallproxy
    private static func parseProxyInfo(_ arguments: [String]) -> (enabled: Bool, server: String, port: Int) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/networksetup")
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: data, encoding: .utf8) ?? ""

        var enabled = false
        var server = ""
        var port = 0

        for line in output.components(separatedBy: .newlines) {
            let parts = line.components(separatedBy: ": ")
            guard parts.count == 2 else { continue }
            let key = parts[0].trimmingCharacters(in: .whitespaces)
            let value = parts[1].trimmingCharacters(in: .whitespaces)
            switch key {
            case "Enabled": enabled = (value == "Yes")
            case "Server": server = value
            case "Port": port = Int(value) ?? 0
            default: break
            }
        }
        return (enabled, server, port)
    }

    /// Capture current proxy settings before we overwrite them.
    private static func snapshot(for service: String) -> ProxySnapshot {
        let http = parseProxyInfo(["-getwebproxy", service])
        let https = parseProxyInfo(["-getsecurewebproxy", service])
        let socks = parseProxyInfo(["-getsocksfirewallproxy", service])

        return ProxySnapshot(
            httpEnabled: http.enabled, httpServer: http.server, httpPort: http.port,
            httpsEnabled: https.enabled, httpsServer: https.server, httpsPort: https.port,
            socksEnabled: socks.enabled, socksServer: socks.server, socksPort: socks.port
        )
    }

    /// Save current proxy settings to UserDefaults before we overwrite them
    private static func saveSnapshot(service: String) {
        persistSnapshot(snapshot(for: service))
    }

    private static func persistSnapshot(_ snapshot: ProxySnapshot) {
        if let data = try? JSONEncoder().encode(snapshot) {
            AppProfile.defaults.set(data, forKey: snapshotKey)
        }
    }

    /// Load saved snapshot
    private static func loadSnapshot() -> ProxySnapshot? {
        guard let data = AppProfile.defaults.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(ProxySnapshot.self, from: data)
    }

    /// List all available network service names
    private static func listNetworkServices() -> [String] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/networksetup")
        process.arguments = ["-listallnetworkservices"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let output = String(data: data, encoding: .utf8) else { return [] }

        return output.components(separatedBy: .newlines)
            .filter { !$0.isEmpty && !$0.contains("*") && !$0.contains("denotes") }
    }

    /// Get the BSD interface currently used by the default IPv4 route.
    static func primaryNetworkInterface() -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/sbin/route")
        process.arguments = ["-n", "get", "default"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let output = String(data: data, encoding: .utf8) else { return nil }

        for line in output.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("interface:") else { continue }
            let interface = trimmed
                .replacingOccurrences(of: "interface:", with: "")
                .trimmingCharacters(in: .whitespaces)
            return interface.isEmpty ? nil : interface
        }

        return nil
    }

    /// The service macOS itself elected as primary, by name — the name
    /// `networksetup` and the helper address a service by.
    ///
    /// `route -n get default` only sees the IPv4 default route. When it had
    /// none (IPv6-only, CLAT, a transition) this used to fall back to the
    /// first service called "Wi-Fi" whether or not it carried anything, and
    /// Protected DNS was written to an idle adapter while the one in use kept
    /// its own resolver. There is no guess any more: with no primary service
    /// the caller gets nil and refuses to write DNS.
    ///
    /// `observe` exists so a test can drive this exact entry point with a
    /// captured observation; production always reads the live store.
    static func primaryNetworkService(
        observe: () -> SystemNetworkObservation? = { SystemNetworkObservation.current() }
    ) -> String? {
        observe()?.primaryServiceName
    }

    /// Resolve the saved service name, falling back to primary if the saved one no longer exists
    private static func savedOrPrimaryService() -> String? {
        if let saved = AppProfile.defaults.string(forKey: activeServiceKey) {
            if listNetworkServices().contains(saved) {
                return saved
            }
        }
        return primaryNetworkService()
    }

    // MARK: - Enable System Proxy

    static func enable(httpPort: Int, socksPort: Int, service: String? = nil) throws {
        guard let networkService = service ?? primaryNetworkService() else {
            throw SystemProxyError.noNetworkService
        }

        // Persist recovery state before the first networksetup mutation. If the
        // process is killed between commands, the next launch must still know
        // which service and snapshot to restore.
        saveSnapshot(service: networkService)
        AppProfile.defaults.set(networkService, forKey: activeServiceKey)
        AppProfile.defaults.set(httpPort, forKey: activePortKey)
        AppProfile.defaults.set(socksPort, forKey: activeSocksPortKey)
        markProxySet()

        let commands: [[String]] = [
            ["-setproxybypassdomains", networkService, "localhost", "127.0.0.1", "*.local"],
            ["-setwebproxy", networkService, "127.0.0.1", "\(httpPort)"],
            ["-setwebproxystate", networkService, "on"],
            ["-setsecurewebproxy", networkService, "127.0.0.1", "\(httpPort)"],
            ["-setsecurewebproxystate", networkService, "on"],
            ["-setsocksfirewallproxy", networkService, "127.0.0.1", "\(socksPort)"],
            ["-setsocksfirewallproxystate", networkService, "on"],
        ]

        do {
            do {
                for args in commands {
                    try runNetworkSetup(args)
                }
            } catch {
                try runNetworkSetupWithPrivileges(commands)
            }
        } catch {
            // A failed command sequence may have already changed one or more
            // proxy classes. Roll back immediately when possible; otherwise
            // retain the marker so cleanupIfStale() retries on next launch.
            do {
                try restoreOrTurnOffProxy(service: networkService)
                clearProxyMark()
            } catch {
                // Preserve the original failure while keeping recovery state.
            }
            throw error
        }
    }

    // MARK: - Disable / Restore System Proxy

    static func disable(service: String? = nil) throws {
        guard let networkService = service ?? savedOrPrimaryService() else {
            throw SystemProxyError.noNetworkService
        }

        try restoreOrTurnOffProxy(service: networkService)
        clearProxyMark()
    }

    /// Restore original settings if we have a snapshot, otherwise just turn off.
    private static func restoreOrTurnOffProxy(service: String) throws {
        if let snapshot = loadSnapshot() {
            try restore(snapshot, service: service)
        } else {
            try turnOffProxy(service: service)
        }
    }

    private static func turnOffProxy(service: String) throws {
        let commands: [[String]] = [
            ["-setwebproxystate", service, "off"],
            ["-setsecurewebproxystate", service, "off"],
            ["-setsocksfirewallproxystate", service, "off"],
        ]
        do {
            for args in commands { try runNetworkSetup(args) }
        } catch {
            try runNetworkSetupWithPrivileges(commands)
        }
    }

    /// Restore proxy settings from a snapshot
    private static func restore(_ snapshot: ProxySnapshot, service: String) throws {
        var commands: [[String]] = []

        if snapshot.httpEnabled && !snapshot.httpServer.isEmpty {
            commands.append(["-setwebproxy", service, snapshot.httpServer, "\(snapshot.httpPort)"])
            commands.append(["-setwebproxystate", service, "on"])
        } else {
            commands.append(["-setwebproxystate", service, "off"])
        }

        if snapshot.httpsEnabled && !snapshot.httpsServer.isEmpty {
            commands.append(["-setsecurewebproxy", service, snapshot.httpsServer, "\(snapshot.httpsPort)"])
            commands.append(["-setsecurewebproxystate", service, "on"])
        } else {
            commands.append(["-setsecurewebproxystate", service, "off"])
        }

        if snapshot.socksEnabled && !snapshot.socksServer.isEmpty {
            commands.append(["-setsocksfirewallproxy", service, snapshot.socksServer, "\(snapshot.socksPort)"])
            commands.append(["-setsocksfirewallproxystate", service, "on"])
        } else {
            commands.append(["-setsocksfirewallproxystate", service, "off"])
        }

        do {
            for args in commands { try runNetworkSetup(args) }
        } catch {
            try runNetworkSetupWithPrivileges(commands)
        }
    }

    // MARK: - Cleanup Stale Proxy

    /// Restore system proxy only if we previously set it (tracked via UserDefaults marker).
    /// Called on app launch to recover from crash/force-quit.
    static func cleanupIfStale() {
        guard didSetProxy else { return }
        guard primaryNetworkService() != nil else { return }

        try? disable()
    }

    // MARK: - Proxy Guard

    /// Check if system proxy still points to our ports. Returns false if tampered.
    static func verifyProxyIntact() -> Bool {
        guard didSetProxy else { return true }
        guard let service = primaryNetworkService() else { return true }

        let expectedPort = AppProfile.defaults.integer(forKey: activePortKey)
        let expectedSocks = AppProfile.defaults.integer(forKey: activeSocksPortKey)
        guard expectedPort > 0 else { return true }

        if let saved = AppProfile.defaults.string(forKey: activeServiceKey), saved != service {
            return false
        }

        let http = parseProxyInfo(["-getwebproxy", service])
        let socks = parseProxyInfo(["-getsocksfirewallproxy", service])

        return http.enabled && http.server == "127.0.0.1" && http.port == expectedPort
            && socks.enabled && socks.server == "127.0.0.1" && socks.port == expectedSocks
    }

    /// Re-apply our proxy settings (called by Proxy Guard when tampering detected)
    static func reapply() throws {
        let httpPort = AppProfile.defaults.integer(forKey: activePortKey)
        let socksPort = AppProfile.defaults.integer(forKey: activeSocksPortKey)
        guard httpPort > 0, socksPort > 0 else { return }
        guard let service = primaryNetworkService() else { return }

        let savedService = AppProfile.defaults.string(forKey: activeServiceKey)
        let replacementSnapshot: ProxySnapshot?
        if let savedService, savedService != service {
            try? restoreOrTurnOffProxy(service: savedService)
            replacementSnapshot = snapshot(for: service)
        } else if savedService == nil {
            replacementSnapshot = snapshot(for: service)
        } else {
            replacementSnapshot = nil
        }

        let commands: [[String]] = [
            ["-setwebproxy", service, "127.0.0.1", "\(httpPort)"],
            ["-setwebproxystate", service, "on"],
            ["-setsecurewebproxy", service, "127.0.0.1", "\(httpPort)"],
            ["-setsecurewebproxystate", service, "on"],
            ["-setsocksfirewallproxy", service, "127.0.0.1", "\(socksPort)"],
            ["-setsocksfirewallproxystate", service, "on"],
        ]

        do {
            for args in commands { try runNetworkSetup(args) }
        } catch {
            try runNetworkSetupWithPrivileges(commands)
        }

        if let replacementSnapshot {
            persistSnapshot(replacementSnapshot)
        }
        AppProfile.defaults.set(service, forKey: activeServiceKey)
        AppProfile.defaults.set(httpPort, forKey: activePortKey)
        AppProfile.defaults.set(socksPort, forKey: activeSocksPortKey)
        markProxySet()
    }

    // MARK: - Helpers

    /// Run networksetup and throw on failure
    private static func runNetworkSetup(_ arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/networksetup")
        process.arguments = arguments
        let errPipe = Pipe()
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errPipe
        try process.run()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
            let errMsg = String(data: errData, encoding: .utf8) ?? "exit code \(process.terminationStatus)"
            throw SystemProxyError.commandFailed(errMsg.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    /// Run multiple networksetup commands with admin privileges via osascript
    private static func runNetworkSetupWithPrivileges(_ commands: [[String]]) throws {
        // Build a single shell script with all commands
        let shellCommands = commands.map { args in
            let escaped = args.map { "'\($0.replacingOccurrences(of: "'", with: "'\\''"))'" }
            return "/usr/sbin/networksetup " + escaped.joined(separator: " ")
        }.joined(separator: " && ")

        let script = "do shell script \"\(shellCommands.replacingOccurrences(of: "\"", with: "\\\""))\" with administrator privileges"

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        let errPipe = Pipe()
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errPipe
        try process.run()
        process.waitUntilExit()

        if process.terminationStatus != 0 {
            let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
            let errMsg = String(data: errData, encoding: .utf8) ?? ""
            if errMsg.contains("-128") || errMsg.contains("canceled") || errMsg.contains("User canceled") {
                throw SystemProxyError.privilegesDenied
            }
            throw SystemProxyError.commandFailed(errMsg.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }
}

// MARK: - System Network Observation

/// What System Configuration reports about the network macOS is actually
/// using. Protected DNS selects its service and audits its effect from this
/// value, so both decisions can be exercised with a captured observation
/// instead of the live dynamic store.
nonisolated struct SystemNetworkObservation: Equatable {
    /// `State:/Network/Global/IPv4` → `PrimaryService` (a service ID).
    var ipv4PrimaryServiceID: String?
    /// `State:/Network/Global/IPv6` → `PrimaryService` (a service ID).
    var ipv6PrimaryServiceID: String?
    /// Service ID → the name `SCNetworkServiceGetName` gives it, which is
    /// how `networksetup` and the helper look a service up.
    var serviceNames: [String: String]
    /// `State:/Network/Global/DNS` → `ServerAddresses`: the default resolver
    /// macOS is really querying. Nil when there is none.
    var effectiveDNSServers: [String]?
    /// Split-DNS resolvers macOS consults *instead of* the default resolver
    /// for matching domains, restricted to those with a server that is not
    /// loopback: `State:/Network/Service/*/DNS` entries that carry
    /// `SupplementalMatchDomains` (VPN and profile split DNS) and
    /// `/etc/resolver/*` files. Nil when they could not be enumerated.
    ///
    /// A non-primary service's plain `ServerAddresses` are deliberately not
    /// listed: they only answer queries explicitly scoped to that interface,
    /// and every host with Wi-Fi and Ethernet both up carries one.
    var conflictingSupplementalResolvers: [SupplementalResolver]? = []

    /// One split-DNS rule that sends matching names past the protected
    /// listener. Carried for the user message and the audit log.
    nonisolated struct SupplementalResolver: Equatable {
        /// The dynamic-store key or `/etc/resolver` file it came from.
        var source: String
        var domains: [String]
        /// Only the non-loopback servers.
        var servers: [String]
    }

    /// The IPv4 primary when macOS has one, otherwise the IPv6 primary. An
    /// IPv4 primary without a name (a VPN's dynamic service, a half-written
    /// setup) is not skipped in favour of IPv6: macOS routes and resolves
    /// IPv4 through that IPv4 primary, so writing 127.0.0.1 to the IPv6
    /// primary instead would protect a service the default resolver is not
    /// taken from. Nil means "do not write DNS".
    var primaryServiceName: String? {
        guard let serviceID = ipv4PrimaryServiceID ?? ipv6PrimaryServiceID,
              let name = serviceNames[serviceID],
              !name.isEmpty
        else { return nil }
        return name
    }

    /// True only when every default resolver macOS uses is the protected
    /// loopback listener. The helper's readback proves what was stored on
    /// one service; this is what the system is actually resolving through.
    var effectiveResolverIsProtected: Bool {
        guard let servers = effectiveDNSServers, !servers.isEmpty else { return false }
        return servers.allSatisfy { $0 == ProtectedDNSContract.server }
    }

    /// 127.0.0.0/8 and ::1 stay on this Mac (a local dnsmasq for `.test`, the
    /// protected listener itself); anything else leaves it.
    static func isLoopback(_ server: String) -> Bool {
        let address = server.split(separator: "%", maxSplits: 1).first.map(String.init) ?? server
        if address == "::1" { return true }
        var ipv4 = in_addr()
        return inet_pton(AF_INET, address, &ipv4) == 1 && address.hasPrefix("127.")
    }

    /// The nameservers an `/etc/resolver/<domain>` file names; the file name
    /// is the match domain unless a `domain` line overrides it.
    static func supplementalResolver(
        resolverFile contents: String,
        named fileName: String
    ) -> SupplementalResolver? {
        var domain = fileName
        var servers: [String] = []
        for line in contents.components(separatedBy: .newlines) {
            let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
            guard fields.count >= 2, !fields[0].hasPrefix("#") else { continue }
            switch fields[0] {
            case "nameserver": servers.append(String(fields[1]))
            case "domain": domain = String(fields[1])
            default: continue
            }
        }
        let leaving = servers.filter { !isLoopback($0) }
        guard !leaving.isEmpty else { return nil }
        return SupplementalResolver(
            source: "/etc/resolver/\(fileName)",
            domains: [domain],
            servers: leaving
        )
    }

    /// Nil when `/etc/resolver` exists but cannot be read; an absent
    /// directory is the ordinary case and has no resolvers.
    static func resolverDirectoryConflicts(
        at directory: String = "/etc/resolver"
    ) -> [SupplementalResolver]? {
        let fileManager = FileManager.default
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: directory, isDirectory: &isDirectory) else {
            return []
        }
        guard isDirectory.boolValue,
              let names = try? fileManager.contentsOfDirectory(atPath: directory)
        else { return nil }
        var found: [SupplementalResolver] = []
        for name in names.sorted() where !name.hasPrefix(".") {
            guard let contents = try? String(
                contentsOfFile: (directory as NSString).appendingPathComponent(name),
                encoding: .utf8
            ) else { return nil }
            if let resolver = supplementalResolver(resolverFile: contents, named: name) {
                found.append(resolver)
            }
        }
        return found
    }

    /// Nil only when the dynamic store cannot be opened or read.
    static func current() -> SystemNetworkObservation? {
        guard let store = SCDynamicStoreCreate(
            nil,
            "com.raydocs.tono.primary-service" as CFString,
            nil,
            nil
        ) else { return nil }
        let ipv4Key = SCDynamicStoreKeyCreateNetworkGlobalEntity(
            nil, kSCDynamicStoreDomainState, kSCEntNetIPv4
        ) as String
        let ipv6Key = SCDynamicStoreKeyCreateNetworkGlobalEntity(
            nil, kSCDynamicStoreDomainState, kSCEntNetIPv6
        ) as String
        let dnsKey = SCDynamicStoreKeyCreateNetworkGlobalEntity(
            nil, kSCDynamicStoreDomainState, kSCEntNetDNS
        ) as String
        let serviceDNSPattern = SCDynamicStoreKeyCreateNetworkServiceEntity(
            nil, kSCDynamicStoreDomainState, kSCCompAnyRegex, kSCEntNetDNS
        ) as String
        guard let values = SCDynamicStoreCopyMultiple(
            store,
            [ipv4Key, ipv6Key, dnsKey] as CFArray,
            [serviceDNSPattern] as CFArray
        ) as? [String: Any] else { return nil }

        func primaryService(_ key: String) -> String? {
            (values[key] as? [String: Any])?[kSCDynamicStorePropNetPrimaryService as String]
                as? String
        }
        let primaryIDs = [primaryService(ipv4Key), primaryService(ipv6Key)].compactMap { $0 }
        var names: [String: String] = [:]
        if !primaryIDs.isEmpty,
           let prefs = SCPreferencesCreate(nil, "com.raydocs.tono.primary-service" as CFString, nil) {
            for serviceID in primaryIDs {
                guard let service = SCNetworkServiceCopy(prefs, serviceID as CFString),
                      let name = SCNetworkServiceGetName(service) as String?
                else { continue }
                names[serviceID] = name
            }
        }
        // Every per-service DNS entry comes back from the pattern; only the
        // ones with match domains are split DNS.
        var supplemental: [SupplementalResolver] = []
        for key in values.keys.sorted() where key != dnsKey {
            guard let entry = values[key] as? [String: Any],
                  let domains = entry[kSCPropNetDNSSupplementalMatchDomains as String] as? [String],
                  !domains.isEmpty
            else { continue }
            let servers = (entry[kSCPropNetDNSServerAddresses as String] as? [String] ?? [])
                .filter { !isLoopback($0) }
            guard !servers.isEmpty else { continue }
            supplemental.append(
                SupplementalResolver(source: key, domains: domains, servers: servers)
            )
        }
        let fileResolvers = resolverDirectoryConflicts()
        return SystemNetworkObservation(
            ipv4PrimaryServiceID: primaryService(ipv4Key),
            ipv6PrimaryServiceID: primaryService(ipv6Key),
            serviceNames: names,
            effectiveDNSServers: (values[dnsKey] as? [String: Any])?[
                kSCPropNetDNSServerAddresses as String
            ] as? [String],
            conflictingSupplementalResolvers: fileResolvers.map { supplemental + $0 }
        )
    }
}
