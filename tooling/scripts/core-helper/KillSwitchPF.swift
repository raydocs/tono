import Foundation
import Darwin

extension KillSwitchManager {
    @discardableResult
    static func writeRules(
        state: KillSwitchState,
        allowedUID: uid_t
    ) throws -> String {
        let rules = renderRules(state: state, allowedUID: allowedUID)
        try atomicWrite(
            path: killSwitchPFPath,
            data: Data(rules.utf8),
            permissions: 0o600
        )
        let checked = try run("/sbin/pfctl", ["-nf", killSwitchPFPath])
        guard checked.status == 0 else {
            throw HelperFailure.system(
                checked.message.isEmpty ? "PF rule validation failed." : checked.message
            )
        }
        return rules
    }

    static func renderRules(
        state: KillSwitchState,
        allowedUID: uid_t
    ) -> String {
        var lines = [
            "# Managed by Tono Kill Switch — do not edit",
            // Mihomo's controller is loopback-only. Both directions must pass
            // through the child anchor or the app's SYN reaches 127.0.0.1 but
            // the controller response is dropped while PF is fail-closed.
            // Bind every state to the interface where PF created it. macOS PF
            // defaults to floating states; without this, a state established
            // on a TUN that disappears could continue matching after the
            // kernel reroutes the same flow to a physical interface.
            // Every rule carries a class `label`, and that is load-bearing rather
            // than cosmetic.
            //
            // pfctl merges rules it considers interchangeable. An exact permit
            // (`to 198.12.84.154 port 443 user root`) is a strict subset of the
            // reviewed-bundle permit (`from any to any port { 80, 443, 8000, 8080 }
            // user root`), so the optimizer collapsed it away entirely: measured on
            // a live armed machine, `pf.tono.conf` held 58 exact permits and the
            // kernel held 13 rules with *zero* of them. The pins were unmeasurable
            // because they did not exist — every question about what the boundary
            // actually permits had to be answered by egress probing instead of by
            // reading a counter.
            //
            // Two rules with different labels are no longer interchangeable, because
            // collapsing them would lose the accounting, so the optimizer keeps
            // both. `pfctl -a tono.killswitch -s labels` then attributes packets per
            // class: whether the exit pin is carrying traffic or the bundle permit is
            // absorbing it becomes a number instead of an inference.
            //
            // No traffic decision changes. Pins render before the bundle permits and
            // every rule is `quick`, so first match wins; a pin permits a subset of
            // what the bundle permits, and both verdicts are `pass`. What changes is
            // which rule gets the credit.
            //
            // Position matters: `label` goes last, after `keep state (if-bound)`.
            // Verified against pfctl on macOS 25.4 for all eight rendered forms —
            // interface rules, `user { 0, uid }` (which expands per uid and keeps the
            // label on each), inet6, udp, `port { ... }` (expands per port), and the
            // terminating `block drop`. A bad position is a parse error that takes
            // the whole ruleset down and leaves the session unable to arm at all,
            // which is why this was proven on a real machine before shipping.
            "pass in quick on lo0 all keep state (if-bound) label \"tono-loopback\"",
            "pass out quick on lo0 all keep state (if-bound) label \"tono-loopback\"",
        ]
        // Only while a TUN is up. Emergency fail-closed has no tunnel and
        // must not keep Sidecar/clipboard as a side channel.
        if !state.tunnelInterfaces.isEmpty {
            lines.append(
                "pass in quick on awdl0 all keep state (if-bound) label \"tono-continuity\""
            )
            lines.append(
                "pass out quick on awdl0 all keep state (if-bound) label \"tono-continuity\""
            )
            lines.append(
                "pass out quick inet proto udp to 224.0.0.251 port 5353 keep state (if-bound) label \"tono-mdns\""
            )
            lines.append(
                "pass out quick inet6 proto udp to ff02::fb port 5353 keep state (if-bound) label \"tono-mdns\""
            )
            lines.append(
                "pass out quick inet6 to fe80::/10 keep state (if-bound) label \"tono-linklocal\""
            )
        }
        for interface in state.tunnelInterfaces.sorted() {
            // Host packets leave through the TUN while proxied replies return
            // through it. Keep both directions explicit: macOS PF can otherwise
            // accept the route while silently starving Mihomo's packet path.
            lines.append(
                "pass in quick on \(interface) all keep state (if-bound) label \"tono-tunnel\""
            )
            lines.append(
                "pass out quick on \(interface) all keep state (if-bound) label \"tono-tunnel\""
            )
        }

        var controlEndpoints = Set<KillSwitchEndpoint>()
        for addresses in state.resolvedHosts.values {
            for address in addresses {
                controlEndpoints.insert(
                    .init(address: address, transport: "tcp", port: 443)
                )
            }
        }
        for endpoint in controlEndpoints.sorted(by: {
            ($0.transport, $0.port, $0.address) < ($1.transport, $1.port, $1.address)
        }) {
            // Restricted to the two identities that legitimately use this
            // bootstrap path: the root helper (DERP map refresh) and the signed
            // app running as the interactive user (control-plane recovery while
            // the tunnel is down). Without a `user` clause — the only exception
            // family that lacked one — *any* local process could send to these
            // addresses on 443 outside the tunnel. Because the control plane is
            // fronted by shared anycast addresses and the edge routes by SNI,
            // that was enough for an unprivileged process to reach an unrelated
            // origin of its choosing on the same address and disclose the real
            // IP while the kill switch was armed.
            let family = endpoint.address.contains(":") ? "inet6" : "inet"
            lines.append(
                "pass out quick \(family) proto \(endpoint.transport) " +
                "to \(endpoint.address) port \(endpoint.port) " +
                "user { 0, \(allowedUID) } keep state (if-bound) label \"tono-control\""
            )
        }
        for endpoint in state.derpEndpoints.sorted(by: {
            ($0.transport, $0.port, $0.address) < ($1.transport, $1.port, $1.address)
        }) {
            // tailscaled owns DERP/STUN transport and runs as root. Restricting
            // these steady-state physical-interface exceptions prevents an
            // unprivileged app or spawned tool from using a DERP tuple to
            // bypass the protected TUN.
            let family = endpoint.address.contains(":") ? "inet6" : "inet"
            lines.append(
                "pass out quick \(family) proto \(endpoint.transport) " +
                "to \(endpoint.address) port \(endpoint.port) user root " +
                "keep state (if-bound) label \"tono-derp\""
            )
        }
        for target in state.proxyTargets.sorted(by: {
            ($0.transport, $0.port, $0.host) < ($1.transport, $1.port, $1.host)
        }) {
            for address in target.addresses.sorted() {
                let family = address.contains(":") ? "inet6" : "inet"
                lines.append(
                    "pass out quick \(family) proto \(target.transport) " +
                    "to \(address) port \(target.port) user root keep state (if-bound) " +
                    "label \"tono-exit\""
                )
            }
        }
        for endpoint in state.sessionDirectEndpoints {
            lines.append(
                "pass out quick inet proto \(endpoint.transport) " +
                "to \(endpoint.address) port \(endpoint.port) user root keep state (if-bound) " +
                "label \"tono-direct\""
            )
        }
        if state.reviewedBundleDirectEnabled {
            // The reviewed bundle's traffic is routed direct by the rule engine,
            // and those packets leave as root from the core, so no `to <address>`
            // exception can express them: the addresses rotate and mostly never
            // appear in DNS. Scoped as tightly as PF allows — root only, and
            // only the ports that traffic uses — so a rule-engine mistake can at
            // worst escape on a web port instead of any port. Everything the
            // engine does not route direct still reaches `MATCH,Tono-Exit`, so a
            // dead tunnel remains fail-closed for it.
            //
            // `from any to any` is not decoration: PF only accepts `port` as
            // part of a host specification, so the shorter `proto tcp port {…}`
            // is a parse error that takes the whole ruleset down and leaves the
            // session unable to arm at all.
            for transport in ["tcp", "udp"] {
                lines.append(
                    "pass out quick inet proto \(transport) from any to any " +
                    "port { \(reviewedBundleDirectPorts.map(String.init).joined(separator: ", ")) } " +
                    "user root keep state (if-bound) label \"tono-bundle\""
                )
            }
        }
        lines.append("block drop out quick all label \"tono-block\"")
        return lines.joined(separator: "\n") + "\n"
    }

    @discardableResult
    static func ensureMainHook() throws -> Bool {
        let originalData = try secureRead(killSwitchMainPFPath, maximumBytes: 1024 * 1024)
        guard let original = String(data: originalData, encoding: .utf8) else {
            throw HelperFailure.invalid("The main PF configuration is not UTF-8.")
        }
        let hasBegin = original.contains(killSwitchBeginMarker)
        let hasEnd = original.contains(killSwitchEndMarker)
        guard hasBegin == hasEnd else {
            throw HelperFailure.invalid("Malformed Tono PF markers.")
        }

        let snippet = """
        \(killSwitchBeginMarker)
        anchor "\(killSwitchAnchor)"
        load anchor "\(killSwitchAnchor)" from "\(killSwitchPFPath)"
        \(killSwitchEndMarker)

        """
        let candidate: String
        if hasBegin,
           let begin = original.range(of: killSwitchBeginMarker),
           let end = original.range(
            of: killSwitchEndMarker,
            range: begin.upperBound..<original.endIndex
           ) {
            let suffixStart = original.index(afterLineContaining: end)
            candidate = String(original[..<begin.lowerBound]) +
                snippet +
                String(original[suffixStart...]).trimmingLeadingNewlines()
        } else {
            let legacy = """

            # Tono kill switch
            anchor "\(killSwitchAnchor)"
            load anchor "\(killSwitchAnchor)" from "\(killSwitchPFPath)"

            """
            var cleaned = original.replacingOccurrences(of: legacy, with: "\n")
            guard !cleaned.contains("anchor \"\(killSwitchAnchor)\""),
                  !cleaned.contains("load anchor \"\(killSwitchAnchor)\"") else {
                throw HelperFailure.invalid("An unmanaged Tono PF anchor already exists.")
            }
            var lines = cleaned.components(separatedBy: .newlines)
            var insertion = lines.count
            for (index, line) in lines.enumerated() {
                let value = line.trimmingCharacters(in: .whitespaces)
                if value.hasPrefix("anchor ") || value.hasPrefix("pass ") ||
                    value.hasPrefix("block ") || value.hasPrefix("match ") {
                    insertion = index
                    break
                }
            }
            lines.insert(contentsOf: snippet.components(separatedBy: .newlines), at: insertion)
            cleaned = lines.joined(separator: "\n")
            if original.hasSuffix("\n"), !cleaned.hasSuffix("\n") { cleaned += "\n" }
            candidate = cleaned
        }

        // Second arm / reassert almost always leaves /etc/pf.conf unchanged.
        // Re-validating the same text with two `pfctl -nf` runs does not
        // change the hook and only delays the child-anchor reload.
        if candidate == original {
            return false
        }

        let candidatePath = "/etc/.tono-pf-\(UUID().uuidString)"
        defer { unlink(candidatePath) }
        try atomicWrite(
            path: candidatePath,
            data: Data(candidate.utf8),
            permissions: 0o600
        )
        let candidateCheck = try run("/sbin/pfctl", ["-nf", candidatePath])
        guard candidateCheck.status == 0 else {
            throw HelperFailure.system(
                candidateCheck.message.isEmpty
                    ? "Main PF validation failed."
                    : candidateCheck.message
            )
        }
        if candidate != original {
            if !FileManager.default.fileExists(atPath: killSwitchMainBackupPath) {
                try atomicWrite(
                    path: killSwitchMainBackupPath,
                    data: originalData,
                    permissions: 0o600
                )
            }
            try atomicWrite(
                path: killSwitchMainPFPath,
                data: Data(candidate.utf8),
                permissions: 0o644
            )
        }
        let installedCheck = try run("/sbin/pfctl", ["-nf", killSwitchMainPFPath])
        guard installedCheck.status == 0 else {
            throw HelperFailure.system(
                installedCheck.message.isEmpty
                    ? "Installed PF configuration is invalid."
                    : installedCheck.message
            )
        }
        return candidate != original
    }

    /// What to do about states established under rules that no longer exist.
    ///
    /// A withdrawal must never leave a usable state behind — that is the whole
    /// point of the kill switch — but `pfctl -F states` achieves it by freeing
    /// every state on the machine, which severs every unrelated flow the user
    /// has open. `.targeted` kills only states involving the addresses whose
    /// permits went away, which is a superset of what the withdrawn rules could
    /// have created (the rules were address+port+user, this kills the address)
    /// and therefore cannot under-kill.
    enum StateDisposal: Equatable {
        case keep
        case targeted([String])
        case full
    }

    /// Reduces withdrawn pass rules to the addresses they permitted, or nil when
    /// any of them is not expressible that way.
    ///
    /// Returning nil is the safe answer and the common one for anything
    /// structural: interface rules (`pass in quick on utun199 all`), the
    /// reviewed-bundle `from any to any` permits, and any future shape all fall
    /// back to the machine-wide flush. Only the address-scoped exceptions — exit
    /// endpoints, DERP tuples, proxy targets, control-plane pins — take the
    /// narrow path, and those are exactly the ones that churn on a node switch.
    static func withdrawnHosts(_ withdrawn: Set<String>) -> [String]? {
        guard !withdrawn.isEmpty else { return [] }
        var hosts: Set<String> = []
        for rule in withdrawn {
            // Deliberately matched against this file's own renderer rather than
            // parsing PF generally: a rule shape it does not recognise must
            // reach the fallback, not a best guess.
            guard let range = rule.range(of: #"(?<= to )[0-9A-Fa-f:.]+(?= port )"#, options: .regularExpression)
            else { return nil }
            let host = String(rule[range])
            // `from any to any` renders as `to any`, which the pattern above
            // rejects; this is belt and braces for a renderer change.
            guard host != "any", host.rangeOfCharacter(from: CharacterSet(charactersIn: "0123456789:")) != nil
            else { return nil }
            hosts.insert(host)
        }
        return hosts.sorted()
    }

    static func ensureAnchorLoaded(flushStates: Bool) throws {
        try ensureAnchorLoaded(disposal: flushStates ? .full : .keep)
    }

    static func ensureAnchorLoaded(disposal: StateDisposal) throws {
        let mainChanged = try ensureMainHook()
        let loaded: HelperCommandResult
        if mainChanged || !mainAnchorActive() {
            // Installing/recovering the anchor point requires one main ruleset
            // load. Normal arm/reassert operations must not flush unrelated
            // dynamic macOS anchors.
            loaded = try run("/sbin/pfctl", ["-f", killSwitchMainPFPath])
        } else {
            loaded = try run(
                "/sbin/pfctl",
                ["-a", killSwitchAnchor, "-f", killSwitchPFPath]
            )
        }
        guard loaded.status == 0 else {
            throw HelperFailure.system(
                loaded.message.isEmpty ? "Main PF load failed." : loaded.message
            )
        }
        if !pfEnabled() {
            let enabled = try run("/sbin/pfctl", ["-e"])
            guard enabled.status == 0 || pfEnabled() else {
                throw HelperFailure.system(
                    enabled.message.isEmpty ? "PF enable failed." : enabled.message
                )
            }
        }
        switch disposal {
        case .keep:
            break
        case .targeted(let hosts):
            // Ordering matters: the new ruleset is already loaded above, so a
            // killed state cannot be re-established under the rule that was
            // withdrawn. `-k 0.0.0.0/0 -k <host>` is the documented way to kill
            // by destination irrespective of source.
            for host in hosts {
                let wildcard = host.contains(":") ? "::/0" : "0.0.0.0/0"
                let killed = try run("/sbin/pfctl", ["-k", wildcard, "-k", host])
                // A kill that fails leaves a state the withdrawn rule created,
                // which is the one outcome that must not be tolerated: fall
                // back to the machine-wide flush rather than continuing.
                guard killed.status == 0 else {
                    let flushed = try run("/sbin/pfctl", ["-F", "states"])
                    guard flushed.status == 0 else {
                        throw HelperFailure.system(
                            flushed.message.isEmpty
                                ? "PF state flush failed." : flushed.message
                        )
                    }
                    break
                }
            }
        case .full:
            let flushed = try run("/sbin/pfctl", ["-F", "states"])
            guard flushed.status == 0 else {
                throw HelperFailure.system(
                    flushed.message.isEmpty ? "PF state flush failed." : flushed.message
                )
            }
        }
        guard effectiveStatus() else {
            throw HelperFailure.system("Kill Switch verification failed.")
        }
    }

    static func pfEnabled() -> Bool {
        guard let result = try? run("/sbin/pfctl", ["-s", "info"]),
              result.status == 0,
              let text = String(data: result.output, encoding: .utf8) else {
            return false
        }
        return text.lowercased().contains("status: enabled")
    }

    static func mainAnchorActive() -> Bool {
        guard let result = try? run("/sbin/pfctl", ["-sr"]),
              result.status == 0,
              let text = String(data: result.output, encoding: .utf8) else {
            return false
        }
        return text.contains("anchor \"\(killSwitchAnchor)\"")
    }

    static func childAnchorActive() -> Bool {
        guard let result = try? run(
            "/sbin/pfctl",
            ["-a", killSwitchAnchor, "-sr"]
        ), result.status == 0,
              let text = String(data: result.output, encoding: .utf8) else {
            return false
        }
        return text.lowercased().contains("block drop out quick all")
    }

    static func effectiveStatus() -> Bool {
        pfEnabled() && mainAnchorActive() && childAnchorActive()
    }

    // MARK: - Root-owned I/O and commands

    static func ensureRootDirectory(
        _ path: String,
        permissions: mode_t
    ) throws {
        var metadata = stat()
        if lstat(path, &metadata) != 0 {
            guard errno == ENOENT, mkdir(path, permissions) == 0 else {
                throw HelperFailure.system("Could not create a secure root directory.")
            }
        } else {
            guard (metadata.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR),
                  metadata.st_uid == 0,
                  metadata.st_mode & 0o022 == 0 else {
                throw HelperFailure.invalid("A root-owned directory is unsafe.")
            }
        }
        guard chown(path, 0, 0) == 0, chmod(path, permissions) == 0 else {
            throw HelperFailure.system("Could not secure a root-owned directory.")
        }
    }

    static func secureRead(_ path: String, maximumBytes: Int) throws -> Data {
        let fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard fd >= 0 else {
            throw HelperFailure.system("A required root-owned file is unavailable.")
        }
        defer { close(fd) }
        var metadata = stat()
        guard fstat(fd, &metadata) == 0,
              (metadata.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
              metadata.st_uid == 0,
              metadata.st_mode & 0o022 == 0,
              metadata.st_size >= 0,
              metadata.st_size <= maximumBytes else {
            throw HelperFailure.invalid("A root-owned file is unsafe.")
        }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw HelperFailure.system("Could not read a root-owned file.")
            }
            data.append(buffer, count: count)
            guard data.count <= maximumBytes else {
                throw HelperFailure.invalid("A root-owned file is too large.")
            }
        }
        return data
    }

    static func atomicWrite(
        path: String,
        data: Data,
        permissions: mode_t
    ) throws {
        let parent = (path as NSString).deletingLastPathComponent
        if parent == "/Library/Application Support/Tono" {
            try ensureRootDirectory(parent, permissions: 0o700)
        }
        var existing = stat()
        if lstat(path, &existing) == 0 {
            guard (existing.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
                  existing.st_uid == 0,
                  existing.st_mode & 0o022 == 0 else {
                throw HelperFailure.invalid("Refusing to replace an unsafe root-owned file.")
            }
        } else if errno != ENOENT {
            throw HelperFailure.system("Could not inspect a root-owned file.")
        }

        let temporary = "\(parent)/.tono-\(UUID().uuidString)"
        let fd = open(
            temporary,
            O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
            0o600
        )
        guard fd >= 0 else {
            throw HelperFailure.system("Could not create an atomic root-owned file.")
        }
        var committed = false
        defer {
            close(fd)
            if !committed { unlink(temporary) }
        }
        try data.withUnsafeBytes {
            guard let base = $0.baseAddress else { return }
            var offset = 0
            while offset < $0.count {
                let count = Darwin.write(fd, base.advanced(by: offset), $0.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw HelperFailure.system("Could not write a root-owned file.")
                }
                guard count > 0 else {
                    throw HelperFailure.system("Could not write a root-owned file.")
                }
                offset += count
            }
        }
        guard fsync(fd) == 0,
              fchown(fd, 0, 0) == 0,
              fchmod(fd, permissions) == 0,
              rename(temporary, path) == 0 else {
            throw HelperFailure.system("Could not commit a root-owned file.")
        }
        committed = true
        try fsyncParent(path)
    }

    static func fsyncParent(_ path: String) throws {
        let parent = (path as NSString).deletingLastPathComponent
        let fd = open(parent, O_RDONLY | O_CLOEXEC)
        guard fd >= 0 else {
            throw HelperFailure.system("Could not open a root-owned directory.")
        }
        defer { close(fd) }
        guard fsync(fd) == 0 else {
            throw HelperFailure.system("Could not persist a root-owned directory.")
        }
    }

    static func run(
        _ executable: String,
        _ arguments: [String]
    ) throws -> HelperCommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return .init(status: process.terminationStatus, output: output)
    }

    static func runBoundedSystemLookup(
        _ host: String,
        timeoutMilliseconds: Int
    ) throws -> HelperCommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/dscacheutil")
        process.arguments = ["-q", "host", "-a", "name", host]
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()

        let deadline = Date().addingTimeInterval(
            Double(max(100, timeoutMilliseconds)) / 1_000
        )
        while process.isRunning, Date() < deadline {
            usleep(20_000)
        }
        if process.isRunning {
            process.terminate()
            for _ in 0..<10 where process.isRunning { usleep(20_000) }
        }
        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
        }
        process.waitUntilExit()
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        guard output.count <= 64 * 1024 else {
            throw HelperFailure.invalid("Endpoint resolver output is too large.")
        }
        return .init(status: process.terminationStatus, output: output)
    }

    // MARK: - Pure self-tests

    /// Hands a rendered ruleset to `pfctl -n` so the parser — not a substring
    /// assertion — decides whether it is valid. Substring assertions cannot
    /// catch a malformed rule they were written to match: a permit missing its
    /// host specification passed every content check and then failed to load on
    /// the user's machine, leaving two builds unable to arm at all.
    ///
    /// `nil` means the check could not run (pfctl needs root to open /dev/pf),
    /// never "valid". Callers must surface a skip rather than absorb it.
    static func pfSyntaxAccepts(_ rules: String) -> Bool? {
        guard geteuid() == 0 else { return nil }
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-pf-syntax-check.conf").path
        guard let _ = try? Data(rules.utf8).write(to: URL(fileURLWithPath: path)) else {
            return nil
        }
        defer { try? FileManager.default.removeItem(atPath: path) }
        guard let result = try? run("/sbin/pfctl", ["-nf", path]) else { return nil }
        if result.status != 0 {
            FileHandle.standardError.write(Data("pf syntax: \(result.message)\n".utf8))
        }
        return result.status == 0
    }

    /// Lifecycle coverage for the ruleset, exercised through `pfctl` itself.
    ///
    /// Every fault this session shipped was a lifecycle fault, not a rendering
    /// fault: a permit revoked by a later re-arm, a rule shape the parser
    /// rejects, a contract change that never reached the installed daemon.
    /// String assertions over a rendered document cannot see any of those,
    /// which is why they all reached a user's machine before anything noticed.
    ///
    /// PF is global state, and that is the real reason this coverage did not
    /// exist: a test that arms for real can take the machine's network down.
    /// So these rules load into an anchor no parent ruleset references. Loading
    /// is genuine — `pfctl -f` parses and installs it, and `pfctl -sr` reads
    /// back what the kernel actually holds — while an unreferenced anchor is
    /// never evaluated against a packet, so no traffic decision changes.
    ///
    /// Deliberately not parameterised: the anchor and the scratch path are
    /// compiled in, so there is no seam for a caller to point this at the
    /// production anchor, `/etc/pf.conf`, or the real state file.
}
