import Foundation
import Darwin

extension KillSwitchManager {
    @discardableResult
    static func writeRules(
        state: KillSwitchState,
        allowedUID: uid_t
    ) throws -> String {
        let rules = renderRules(state: state, allowedUID: allowedUID)
        try writeRuleText(rules)
        return rules
    }

    static func writeRuleText(_ rules: String) throws {
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
    }

    /// Wired and Wi-Fi interfaces present now (`enN`, which also covers USB
    /// and Thunderbolt Ethernet and iPhone USB tethering). VPN clients use
    /// utun, ipsec or ppp and are never in this list.
    static func physicalEgressInterfaces() -> [String] {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return [] }
        defer { freeifaddrs(head) }
        var names = Set<String>()
        for entry in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let name = String(cString: entry.pointee.ifa_name)
            guard name.hasPrefix("en"), name.count > 2,
                  name.dropFirst(2).allSatisfy({ $0.isASCII && $0.isNumber }) else { continue }
            names.insert(name)
        }
        return names.sorted()
    }

    static func renderRules(
        state: KillSwitchState,
        allowedUID: uid_t,
        physicalInterfaces: [String] = KillSwitchManager.physicalEgressInterfaces()
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
                "pass in quick on llw0 all keep state (if-bound) label \"tono-continuity\""
            )
            lines.append(
                "pass out quick on llw0 all keep state (if-bound) label \"tono-continuity\""
            )
            lines.append(
                "pass in quick on bridge100 all keep state (if-bound) label \"tono-continuity\""
            )
            lines.append(
                "pass out quick on bridge100 all keep state (if-bound) label \"tono-continuity\""
            )
            lines.append(
                "pass out quick inet proto udp to 224.0.0.251 port 5353 keep state (if-bound) label \"tono-mdns\""
            )
            lines.append(
                "pass in quick inet proto udp to 224.0.0.251 port 5353 keep state (if-bound) label \"tono-mdns\""
            )
            lines.append(
                "pass out quick inet6 proto udp to ff02::fb port 5353 keep state (if-bound) label \"tono-mdns\""
            )
            lines.append(
                "pass in quick inet6 proto udp to ff02::fb port 5353 keep state (if-bound) label \"tono-mdns\""
            )
            // LAN ranges bypass the TUN, so DNS sent straight to a LAN resolver
            // would never meet `hijack-dns`. System DNS is the loopback listener;
            // nothing protected needs plain DNS or DoT to the LAN. Scoped to the
            // physical interfaces so a company VPN running beside Tono keeps the
            // DNS it pushes to its own utun. With no physical interface found,
            // the block stays unscoped: fail closed. PF only: the app's
            // Protected DNS audit still holds the session on that VPN's split
            // DNS (provisional product decision; see
            // holdProtectedDNSSupplementalConflict).
            let lanDNSScope = physicalInterfaces.isEmpty
                ? ""
                : "on { \(physicalInterfaces.joined(separator: ", ")) } "
            lines.append(
                "block drop out quick \(lanDNSScope)inet proto { tcp, udp } to { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 } port { 53, 853 } label \"tono-lan-dns\""
            )
            lines.append(
                "block drop out quick \(lanDNSScope)inet6 proto { tcp, udp } to { fe80::/10, fc00::/7, ff00::/8 } port { 53, 853 } label \"tono-lan-dns\""
            )
            lines.append(
                "pass out quick inet to { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 } keep state (if-bound) label \"tono-lan\""
            )
            lines.append(
                "pass in quick inet from { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 } keep state (if-bound) label \"tono-lan\""
            )
            lines.append(
                "pass out quick inet6 to fe80::/10 keep state (if-bound) label \"tono-linklocal\""
            )
            lines.append(
                "pass in quick inet6 to fe80::/10 keep state (if-bound) label \"tono-linklocal\""
            )
            lines.append(
                "pass out quick inet6 to { ff00::/8, fc00::/7 } keep state (if-bound) label \"tono-linklocal\""
            )
            lines.append(
                "pass in quick inet6 from { fe80::/10, ff00::/8, fc00::/7 } keep state (if-bound) label \"tono-linklocal\""
            )
            // DHCP is identified by ports alone, and any local process can send
            // from port 68, so the destination carries the bound: the limited
            // broadcast only (unicast renewal to a LAN server is `tono-lan`).
            // Server replies come from the server's own address, so the inbound
            // permit cannot name one; `no state` keeps it from creating a return
            // path that would let port 68 answer an arbitrary public host.
            lines.append(
                "pass out quick inet proto udp from any port 68 to 255.255.255.255 port 67 keep state (if-bound) label \"tono-dhcp\""
            )
            lines.append(
                "pass in quick inet proto udp from any port 67 to any port 68 no state label \"tono-dhcp\""
            )
            lines.append(
                "pass out quick inet6 proto ipv6-icmp icmp6-type { 133, 134, 135, 136, 137 } keep state (if-bound) label \"tono-ndp\""
            )
            lines.append(
                "pass in quick inet6 proto ipv6-icmp icmp6-type { 133, 134, 135, 136, 137 } keep state (if-bound) label \"tono-ndp\""
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
            // Restricted to two UIDs: root (the helper's DERP map refresh) and
            // the interactive user the app runs as (control-plane recovery while
            // the tunnel is down). Without a `user` clause — the only exception
            // family that lacked one — *any* local process, including other
            // local users', could send to these addresses on 443 outside the
            // tunnel.
            //
            // This is a UID boundary, not an app boundary. PF's `user` matches
            // the socket owner's UID and PF has no process or code-signing
            // condition, so every process the interactive user runs matches it
            // exactly as the signed app does. The control plane is fronted by
            // shared anycast addresses and the edge routes by SNI, so such a
            // process can still reach an unrelated origin on these addresses
            // from the physical interface, including in Protected Offline. The
            // bound is these pinned addresses and TCP 443 only. Binding it to
            // the app requires the bootstrap requests to be issued by root (the
            // helper) or a dedicated identity and this rule to match only that;
            // see #331 for the design.
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
        // Only while a TUN is up, like continuity above. With no tunnel this
        // address-free permit is not a scoped exception but root web-port
        // egress on the physical interface, and the connect's first arm runs
        // before the TUN exists. Dropped rather than refused: a throw would
        // fail every connect that sends the flag early, and without the permit
        // the bundle's direct traffic still fails closed.
        if state.reviewedBundleDirectEnabled && !state.tunnelInterfaces.isEmpty {
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
        let candidate = try hookedMainConfiguration(original)

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

    /// /etc/pf.conf with Tono's marked hook in place: what an arm writes.
    /// Pure, so removal can be checked against exactly this text.
    static func hookedMainConfiguration(_ original: String) throws -> String {
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
        return candidate
    }

    /// Full removal only (`--emergency-reset`), after PF is released: take
    /// Tono's marked block back out of /etc/pf.conf and delete the two backups
    /// this helper wrote before its first edits. A disarm never calls this; the
    /// hook stays while Tono is installed. Every line outside the markers is
    /// kept, and an old backup is never copied over the live file.
    static func removeMainHookAndBackups(
        mainPath: String = killSwitchMainPFPath,
        backupPaths: [String] = [killSwitchMainBackupPath, killSwitchHostsBackupPath]
    ) throws {
        let originalData = try secureRead(mainPath, maximumBytes: 1024 * 1024)
        guard let original = String(data: originalData, encoding: .utf8) else {
            throw HelperFailure.invalid("The main PF configuration is not UTF-8.")
        }
        let unhooked = try unhookedMainConfiguration(original)
        if unhooked != original {
            try atomicWrite(path: mainPath, data: Data(unhooked.utf8), permissions: 0o644)
        }
        // Only once the hook is out: with malformed markers the backups are
        // what a person would need to repair the file by hand.
        for path in backupPaths {
            try removeIfPresent(path, requiredType: mode_t(S_IFREG), allowedOwner: 0)
        }
    }

    /// The inverse of `hookedMainConfiguration`: drop the marked block and the
    /// blank line a first arm leaves after it. Lines outside the markers stay.
    static func unhookedMainConfiguration(_ hooked: String) throws -> String {
        var lines = hooked.components(separatedBy: "\n")
        let begins = lines.indices.filter { lines[$0] == killSwitchBeginMarker }
        let ends = lines.indices.filter { lines[$0] == killSwitchEndMarker }
        if begins.isEmpty, ends.isEmpty,
           !hooked.contains(killSwitchBeginMarker), !hooked.contains(killSwitchEndMarker) {
            return hooked
        }
        guard begins.count == 1, ends.count == 1, begins[0] < ends[0] else {
            throw HelperFailure.invalid("Malformed Tono PF markers.")
        }
        var upper = ends[0] + 1
        if upper < lines.count, lines[upper].isEmpty { upper += 1 }
        lines.removeSubrange(begins[0]..<upper)
        var unhooked = lines.joined(separator: "\n")
        if hooked.hasSuffix("\n"), !unhooked.hasSuffix("\n") { unhooked += "\n" }
        return unhooked
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

    static let reviewedBundleLabel = "label \"tono-bundle\""

    /// Whether the Core may stop without its utun while the reviewed-bundle
    /// permit is loaded (#608), judged from the anchor file and the recorded
    /// baseline. The baseline is never changed here: the next arm is measured
    /// against the full set, so one that really drops the permit still sees
    /// it withdrawn and flushes, and the app's arm restoring it once the
    /// tunnel exists withdraws nothing.
    enum ReviewedBundleWithholding: Equatable {
        /// No permit in the baseline (none recorded counts as none), or the
        /// file is the baseline without it: an earlier withhold completed.
        case notLoaded
        /// Load `rules`, the file without the permit. `disposal` is always
        /// `.keep`: dropping a `from any to any` permit through an arm reduces
        /// to `.full` in `withdrawnHosts`, a machine-wide flush on every
        /// reload and policy apply, while this only stops new states for the
        /// restart. If writing or loading fails, `rollback` (the file as read)
        /// goes back on disk so file, kernel and baseline agree again and the
        /// idle loop can retry; the Core must not stop.
        case withhold(rules: String, disposal: StateDisposal, rollback: String)
        /// The file is not the ruleset the baseline came from, so the permit
        /// may be loaded and cannot be taken out safely: the Core must not stop.
        case unknown
    }

    static func reviewedBundleWithholding(
        loaded: String,
        baseline: Set<String>?
    ) -> ReviewedBundleWithholding {
        guard let baseline,
              baseline.contains(where: { $0.contains(reviewedBundleLabel) }) else { return .notLoaded }
        let loadedPassRules = passRules(in: loaded)
        if loadedPassRules == baseline.filter({ !$0.contains(reviewedBundleLabel) }) {
            return .notLoaded
        }
        guard loadedPassRules == baseline else { return .unknown }
        let rules = loaded.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.contains(reviewedBundleLabel) }
            .joined(separator: "\n")
        return .withhold(rules: rules, disposal: .keep, rollback: loaded)
    }

    static func ensureAnchorLoaded(flushStates: Bool) throws {
        try ensureAnchorLoaded(disposal: flushStates ? .full : .keep)
    }

    /// `standaloneMain` loads a Tono-owned main ruleset that references only
    /// the Tono anchor instead of hooking `/etc/pf.conf`. Only the emergency
    /// block uses it, and only after the normal path failed: that file can be
    /// unparseable (another product's `load anchor` left pointing at a deleted
    /// file), and the block must not depend on it. At boot nothing else would
    /// enable PF, so a block that failed with `/etc/pf.conf` left the machine
    /// unprotected until repaired.
    static func ensureAnchorLoaded(
        disposal: StateDisposal,
        standaloneMain: Bool = false
    ) throws {
        let mainChanged = try standaloneMain ? false : ensureMainHook()
        // Read only where it decides the load, as before. No answer fails the
        // load rather than reading as a missing anchor.
        var mainAnchorMissing = false
        if !standaloneMain, !mainChanged { mainAnchorMissing = try !mainAnchorActive() }
        let loaded: HelperCommandResult
        if standaloneMain {
            try atomicWrite(
                path: killSwitchStandaloneMainPath,
                data: Data(renderStandaloneMain(childPath: killSwitchPFPath).utf8),
                permissions: 0o600
            )
            loaded = try run("/sbin/pfctl", ["-f", killSwitchStandaloneMainPath])
        } else if mainChanged || mainAnchorMissing
                    || FileManager.default.fileExists(atPath: killSwitchStandaloneMainPath) {
            // Installing/recovering the anchor point requires one main ruleset
            // load. Normal arm/reassert operations must not flush unrelated
            // dynamic macOS anchors. A standalone emergency main is replaced
            // the first time `/etc/pf.conf` loads again, so the system anchors
            // it left out come back.
            loaded = try run("/sbin/pfctl", ["-f", killSwitchMainPFPath])
            if loaded.status == 0 { unlink(killSwitchStandaloneMainPath) }
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
        try holdPFEnableReference()
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
        guard try effectiveStatus() else {
            throw HelperFailure.system("Kill Switch verification failed.")
        }
    }

    static func renderStandaloneMain(childPath: String) -> String {
        """
        # Managed by Tono Kill Switch — emergency main ruleset, used only while
        # \(killSwitchMainPFPath) cannot be loaded
        anchor "\(killSwitchAnchor)"
        load anchor "\(killSwitchAnchor)" from "\(childPath)"

        """
    }

    /// Longest a read-only `pfctl` query (`-s`, `-sr`) may run. One answers
    /// in tens of milliseconds. 3 s, plus the two 1 s waits for SIGTERM and
    /// SIGKILL, keeps a query that meets a wedged `/dev/pf` to about 5 s, under
    /// the app's default 6 s wait on a helper request. Loads, flushes, enable
    /// and release keep `helperCommandDeadline`.
    static let pfctlQueryDeadline: TimeInterval = 3

    /// `pfctl`'s output for a read-only query, or nil when it answered with a
    /// failure. Throws when it gave no answer at all (it could not start, or
    /// ran past its deadline). That is no evidence of anything, so no caller
    /// may release, forget or disable on it, and a chain of commands stops
    /// there instead of waiting out one deadline per command (#639 review).
    static func pfctlQuery(
        _ arguments: [String],
        deadline: TimeInterval = KillSwitchManager.pfctlQueryDeadline
    ) throws -> String? {
        let result = try run("/sbin/pfctl", arguments, deadline: deadline)
        guard result.status == 0 else { return nil }
        return String(data: result.output, encoding: .utf8)
    }

    static func pfEnabled() throws -> Bool {
        guard let text = try pfctlQuery(["-s", "info"]) else { return false }
        return text.lowercased().contains("status: enabled")
    }

    static func mainAnchorActive() throws -> Bool {
        guard let text = try pfctlQuery(["-sr"]) else { return false }
        return text.contains("anchor \"\(killSwitchAnchor)\"")
    }

    static func childAnchorActive() throws -> Bool {
        guard let text = try pfctlQuery(["-a", killSwitchAnchor, "-sr"]) else { return false }
        return text.lowercased().contains("block drop out quick all")
    }

    static func effectiveStatus() throws -> Bool {
        guard try pfEnabled(), try mainAnchorActive() else { return false }
        return try childAnchorActive()
    }

    // MARK: - PF enable reference

    /// A token this helper acquired but could not record. Held in memory only,
    /// so a failing record write costs one token per process, not one per check.
    nonisolated(unsafe) static var unrecordedPFEnableReference: PFEnableReference?

    /// A `pfctl -E` token and the boot it was issued in. Tokens are kernel
    /// state: one recorded in an earlier boot means nothing now and must never
    /// be released, because the same value may belong to another program.
    struct PFEnableReference: Equatable {
        let token: String
        let boot: String
    }

    /// A `pfctl -E` killed at its deadline. The kernel issues the token before
    /// pfctl prints it, so the child may hold one that nothing recorded
    /// (#639 review, opus:F2). `pfctl -s References` lists each token with the
    /// PID that took it and its age, so once the child has exited a later
    /// pass can still find its token. The PID alone proves nothing: a token
    /// outlives the pfctl that took it and PIDs come back, so only a row the
    /// child's own lifetime accounts for is its token.
    struct PFEnableAcquire {
        let pid: pid_t
        let boot: String
        /// Wall-clock second read before the child was spawned.
        let spawned: time_t
        let child: PFEnableChildExit
        /// Every word `pfctl -s References` printed just before the child
        /// was spawned, or nil when that listing gave no answer. No token in
        /// it can be the child's, however the wall clock moved (#643 review,
        /// opus:F3).
        let listedBefore: Set<String>?
        /// `CLOCK_MONOTONIC` nanoseconds when `run` gave up on the child.
        let gaveUp: UInt64
    }

    /// When a `pfctl -E` child exited: the wall-clock second its termination
    /// handler ran, after the process was reaped, and the monotonic time of
    /// that call. Until then the child still holds its PID, so no other
    /// process can have taken a token under it. Set on Foundation's queue and
    /// read on the request thread.
    final class PFEnableChildExit: @unchecked Sendable {
        private let lock = NSLock()
        private var reported: (second: time_t, monotonic: UInt64)?

        func record() {
            lock.lock()
            if reported == nil {
                reported = (time(nil), clock_gettime_nsec_np(CLOCK_MONOTONIC))
            }
            lock.unlock()
        }

        var exited: (second: time_t, monotonic: UInt64)? {
            lock.lock()
            defer { lock.unlock() }
            return reported
        }
    }

    /// How long after `run` gave up on a `pfctl -E` child its termination
    /// handler may run and still settle a claim. The PID is free from the
    /// reap on, and the handler's second closes the claim window, so a late
    /// handler would stretch that window over whoever takes the PID next
    /// (#643 review, codex:F2). Later than this, nothing is claimed.
    static let pfEnableExitReportLimit: UInt64 = 5_000_000_000

    /// Held in memory only, like `unrecordedPFEnableReference`.
    nonisolated(unsafe) static var unsettledPFEnableAcquire: PFEnableAcquire?

    /// Tokens a newer recorded one replaced that pfctl has not yet answered
    /// for: their listing or their `-X` gave no answer, so they may still be
    /// held. Held in memory only, like `unrecordedPFEnableReference`; the next
    /// hold and the periodic check retry them while the recorded token holds
    /// PF, and disarm releases them (#643 review, grok:F2, opus:F1).
    nonisolated(unsafe) static var supersededPFEnableReferences: [PFEnableReference] = []

    /// PF stays enabled while any enable reference is held. Enabling it only
    /// when it was off meant this helper held none whenever something else had
    /// enabled PF first, so that program releasing its own token (`pfctl -X`)
    /// stopped PF under an armed kill switch and nothing noticed. This helper
    /// now always holds a token of its own, recorded so disarm can release
    /// exactly that one.
    ///
    /// The new token is recorded before the previous one is released, so this
    /// helper never takes PF through a zero count itself.
    ///
    /// `releaseToken` releases a token no record could hold, or one a newer
    /// record replaced, and throws, as `run` does, when pfctl gave no answer.
    /// `heldReference` is `heldPFEnableReference`; the self-test replaces it
    /// to stage a check that reads a held record as not held.
    static func holdPFEnableReference(
        recordPath: String = killSwitchPFReferencePath,
        releaseToken: (String) throws -> Void = {
            _ = try KillSwitchManager.run("/sbin/pfctl", ["-X", $0])
        },
        heldReference: (String) throws -> PFEnableReference? = {
            try KillSwitchManager.heldPFEnableReference(recordPath: $0)
        }
    ) throws {
        if let held = try heldReference(recordPath) {
            // The recorded token holds PF, so one it replaced can go now.
            try? releaseSupersededPFEnableReferences(
                boot: held.boot,
                keeping: held.token,
                releaseToken: releaseToken
            )
            return
        }
        guard let boot = try? TonoAuthenticatedPeer.bootSession() else {
            // Without a boot identity a token cannot be recorded safely, and
            // taking an unrecorded one on every check would leak references.
            // Keep the pre-reference behaviour for this unexpected case.
            if try !pfEnabled() { _ = try run("/sbin/pfctl", ["-e"]) }
            guard try pfEnabled() else { throw HelperFailure.system("PF enable failed.") }
            return
        }
        try settlePFEnableAcquire()
        if unsettledPFEnableAcquire != nil {
            // That `-E` may still be inside the kernel. Another would queue
            // behind it and could leave a second token nothing can find, so
            // hold PF on the kernel's anonymous reference meanwhile, as when
            // no token can be recorded.
            guard holdAnonymousPFEnableReference() else {
                throw HelperFailure.system("PF enable failed.")
            }
            return
        }
        let previous = readPFEnableReference(recordPath)
        let token: String
        if let pending = unrecordedPFEnableReference, pending.boot == boot,
           try pfEnabled(), try pfEnableReferenceListed(pending.token) {
            // A token from an earlier failed record write is still held.
            // Retry recording that one instead of taking another.
            token = pending.token
        } else {
            unrecordedPFEnableReference = nil
            // Status ignored, as in `settlePFEnableAcquire`: with no token at
            // all the kernel answers ENOENT.
            let listedBefore = (try? run(
                "/sbin/pfctl", ["-s", "References"],
                deadline: pfctlQueryDeadline
            )).map {
                Set(String(decoding: $0.output, as: UTF8.self)
                    .split(whereSeparator: \.isWhitespace)
                    .map(String.init))
            }
            var child: pid_t = 0
            let spawned = time(nil)
            let childExit = PFEnableChildExit()
            let acquired: HelperCommandResult
            do {
                acquired = try run(
                    "/sbin/pfctl", ["-E"],
                    started: { child = $0 },
                    ended: { childExit.record() }
                )
            } catch {
                // Settled on a later pass once the child has exited, not
                // listed now: another query here would wait behind the same
                // pfctl.
                if child > 0 {
                    unsettledPFEnableAcquire = .init(
                        pid: child,
                        boot: boot,
                        spawned: spawned,
                        child: childExit,
                        listedBefore: listedBefore,
                        gaveUp: clock_gettime_nsec_np(CLOCK_MONOTONIC)
                    )
                }
                throw error
            }
            guard acquired.status == 0,
                  let issued = parsePFEnableToken(String(decoding: acquired.output, as: UTF8.self))
            else {
                throw HelperFailure.system(
                    acquired.message.isEmpty ? "PF enable failed." : acquired.message
                )
            }
            token = issued
        }
        let record = try JSONSerialization.data(
            withJSONObject: ["token": token, "boot": boot],
            options: [.sortedKeys]
        )
        // Listed as replaced before the write, which can throw after its
        // rename has already dropped the previous token from the record
        // (#643 review, codex:F4). While the record still names it, every
        // release of replaced tokens keeps the recorded one.
        if let previous, previous.boot == boot, previous.token != token,
           !supersededPFEnableReferences.contains(previous) {
            supersededPFEnableReferences.append(previous)
        }
        do {
            try atomicWrite(path: recordPath, data: record, permissions: 0o600)
        } catch {
            // PF is enabled and referenced, which is what protection needs.
            // Keep the older record (and its token) rather than orphaning it.
            FileHandle.standardError.write(Data(
                "tono: PF enable reference could not be recorded\n".utf8
            ))
            // A token on no record outlives this process, so a helper whose
            // startup kept failing took one more at every launchd restart
            // (TM-claude-6). Hold PF with the kernel's anonymous reference
            // first, then release the new token: the count never reaches zero.
            if holdAnonymousPFEnableReference() {
                do {
                    try releaseToken(token)
                    unrecordedPFEnableReference = nil
                } catch {
                    // A `-X` with no answer may not have released it (#639
                    // review, codex:F2). Forgotten here, the token outlives
                    // this process with nothing left to release it; kept, the
                    // next check retries and disarm releases it.
                    unrecordedPFEnableReference = .init(token: token, boot: boot)
                }
                return
            }
            // Unconfirmed, releasing the new token here could stop PF under an
            // armed kill switch when nothing else holds a reference, so keep
            // it in memory: the next check retries this write with the same
            // token instead of taking one more every ten seconds, and disarm
            // releases it.
            unrecordedPFEnableReference = .init(token: token, boot: boot)
            return
        }
        unrecordedPFEnableReference = nil
        // The new token is held and recorded. The previous one is forgotten
        // only once pfctl has answered for it: a listing or `-X` with no
        // answer leaves it held, and forgotten here nothing would release it
        // (#643 review, grok:F2).
        try? releaseSupersededPFEnableReferences(
            boot: boot,
            keeping: token,
            releaseToken: releaseToken
        )
    }

    /// Releases the tokens a newer recorded one replaced, oldest first. Each
    /// is forgotten once pfctl has answered for it: released, or no longer
    /// listed. The first that gets no answer may still be held, so it and
    /// those after it stay for the next check or disarm, and this throws. A
    /// token from another boot means nothing now, and one whose value is the
    /// token `keeping` still holds PF with must not be released: both are
    /// only forgotten. A boot that could not be read (nil) is not another
    /// boot: nothing is forgotten on it, and this throws (#643 review,
    /// grok:F3 = codex:F6).
    static func releaseSupersededPFEnableReferences(
        boot: String?,
        keeping: String?,
        queryDeadline: TimeInterval = KillSwitchManager.pfctlQueryDeadline,
        releaseToken: (String) throws -> Void = {
            _ = try KillSwitchManager.run("/sbin/pfctl", ["-X", $0])
        }
    ) throws {
        guard !supersededPFEnableReferences.isEmpty else { return }
        guard boot != nil else {
            throw HelperFailure.system("Boot session unknown; replaced PF references kept.")
        }
        while let superseded = supersededPFEnableReferences.first {
            if superseded.boot == boot, superseded.token != keeping,
               try pfEnableReferenceListed(superseded.token, deadline: queryDeadline) {
                try releaseToken(superseded.token)
            }
            supersededPFEnableReferences.removeFirst()
        }
    }

    /// `pfctl -e` holds PF with the kernel's one anonymous enable reference:
    /// xnu's `DIOCSTART` starts PF with it, or, while PF runs, adds it unless
    /// it is already held ("pf already enabled"). Asking again never adds a
    /// second, and only `pfctl -d` drops it, so after a record failure PF
    /// stays enabled (with Tono's anchor emptied) past disarm.
    static func holdAnonymousPFEnableReference() -> Bool {
        guard let enabled = try? run("/sbin/pfctl", ["-e"]),
              enabled.status == 0 || enabled.message.contains("already enabled") else {
            return false
        }
        return (try? pfEnabled()) == true
    }

    /// Releases the reference this helper recorded, if the kernel still holds
    /// it in this boot, and then forgets it. PF stops only if no other program
    /// holds a reference, which is exactly the correct outcome.
    ///
    /// A token is forgotten only once pfctl has answered for it. Past a
    /// listing or a `-X` that never reported back it may still be held, so
    /// this throws and keeps the record (and any unrecorded token) for the
    /// next arm to reuse or the next disarm to release (#639 review, opus:F2).
    static func releasePFEnableReference(
        recordPath: String = killSwitchPFReferencePath,
        queryDeadline: TimeInterval = KillSwitchManager.pfctlQueryDeadline
    ) throws {
        let boot = try? TonoAuthenticatedPeer.bootSession()
        try settlePFEnableAcquire(deadline: queryDeadline)
        if let held = readPFEnableReference(recordPath), held.boot == boot,
           try pfEnableReferenceListed(held.token, deadline: queryDeadline) {
            _ = try run("/sbin/pfctl", ["-X", held.token])
        }
        unlink(recordPath)
        if let pending = unrecordedPFEnableReference, pending.boot == boot,
           try pfEnableReferenceListed(pending.token, deadline: queryDeadline) {
            _ = try run("/sbin/pfctl", ["-X", pending.token])
        }
        unrecordedPFEnableReference = nil
        try releaseSupersededPFEnableReferences(
            boot: boot,
            keeping: nil,
            queryDeadline: queryDeadline
        )
    }

    /// Settles a `pfctl -E` that ran past its deadline, once its child has
    /// exited: the one listed token the child's lifetime accounts for becomes
    /// the unrecorded reference the next hold records and disarm releases.
    /// With none, the child took none this helper can prove, and nothing is
    /// claimed. Until the child exits it may still take one, so the question
    /// stays open; its own termination handler says when, so a PID another
    /// process has taken over cannot hold it open. Throws when the listing
    /// gives no answer.
    static func settlePFEnableAcquire(
        deadline: TimeInterval = KillSwitchManager.pfctlQueryDeadline
    ) throws {
        guard let acquire = unsettledPFEnableAcquire,
              let exited = acquire.child.exited else { return }
        // Without the listing from before the spawn, or with a termination
        // handler that ran long after `run` gave up, no row can be tied to
        // this child: settle, claiming nothing.
        guard let listedBefore = acquire.listedBefore,
              exited.monotonic <= acquire.gaveUp
                || exited.monotonic - acquire.gaveUp <= pfEnableExitReportLimit else {
            unsettledPFEnableAcquire = nil
            return
        }
        let listedFrom = time(nil)
        // Status ignored: with no token at all the kernel answers ENOENT.
        let listed = try run("/sbin/pfctl", ["-s", "References"], deadline: deadline)
        let listedTo = time(nil)
        if let token = pfEnableToken(
            takenBy: acquire.pid,
            spawned: acquire.spawned,
            exited: exited.second,
            listedFrom: listedFrom,
            listedTo: listedTo,
            listedBefore: listedBefore,
            in: String(decoding: listed.output, as: UTF8.self)
        ) {
            unrecordedPFEnableReference = .init(token: token, boot: acquire.boot)
        }
        unsettledPFEnableAcquire = nil
    }

    /// The token `pfctl -s References` lists for the pfctl process `pid`, only
    /// if the child that held that PID from `spawned` until `exited` took it.
    /// Rows read `PID  Process Name  TOKEN  <d> days HH:MM:SS`: xnu stamps each
    /// token with the calendar second it was issued and pfctl prints its age,
    /// so a row listed between `listedFrom` and `listedTo` was issued between
    /// `listedFrom - age` and `listedTo - age`. A row that range does not place
    /// wholly inside the child's lifetime was issued under another holder of
    /// the PID, or cannot be told apart from one, and is never returned:
    /// leaking this child's token only keeps PF enabled past disarm, while
    /// releasing another program's could stop PF under it (#639 review,
    /// opus:F1 = codex:F1). One `-E` takes at most one token, so two rows in
    /// the lifetime are not this child's either. The kernel hands a PID out
    /// again only after cycling through the others (up to 99999), which no Mac
    /// does inside the second or so these whole-second bounds leave open.
    ///
    /// The window is wall-clock time, so a clock stepped back before the
    /// spawn can place an older token inside it. A token already listed
    /// before the spawn (`listedBefore`) is never the child's, so it is
    /// skipped before anything is counted (#643 review, opus:F3).
    static func pfEnableToken(
        takenBy pid: pid_t,
        spawned: time_t,
        exited: time_t,
        listedFrom: time_t,
        listedTo: time_t,
        listedBefore: Set<String>,
        in listing: String
    ) -> String? {
        // A wall clock stepped back meanwhile orders nothing.
        guard spawned <= exited, listedFrom <= listedTo else { return nil }
        var found: [String] = []
        for line in listing.split(separator: "\n") {
            let words = line.split(whereSeparator: \.isWhitespace)
            guard words.count == 6, words[0] == String(pid), words[1] == "pfctl",
                  words[4] == "days",
                  let age = pfEnableTokenAge(days: words[3], clock: words[5]) else {
                continue
            }
            let token = String(words[2])
            guard token.range(of: #"^[0-9]{1,20}$"#, options: .regularExpression) != nil,
                  !listedBefore.contains(token),
                  listedFrom - age >= spawned,
                  listedTo - age <= exited else {
                continue
            }
            found.append(token)
        }
        return found.count == 1 ? found[0] : nil
    }

    /// Seconds in pfctl's `<d> days HH:MM:SS`, or nil for any other shape:
    /// the day count is 1 to 6 digits and each clock field exactly two, so a
    /// sign, an empty field (`00::00:40`) or a short one (`0:00:40`) is no age
    /// and claims nothing (#643 review, codex:F3).
    static func pfEnableTokenAge(days: Substring, clock: Substring) -> time_t? {
        guard days.range(of: #"^[0-9]{1,6}$"#, options: .regularExpression) != nil,
              clock.range(of: #"^[0-9]{2}:[0-9]{2}:[0-9]{2}$"#, options: .regularExpression) != nil
        else {
            return nil
        }
        let parts = clock.split(separator: ":")
        guard let dayCount = time_t(days),
              parts.count == 3,
              let hours = time_t(parts[0]), (0..<24).contains(hours),
              let minutes = time_t(parts[1]), (0..<60).contains(minutes),
              let seconds = time_t(parts[2]), (0..<60).contains(seconds) else {
            return nil
        }
        return dayCount * 86_400 + hours * 3_600 + minutes * 60 + seconds
    }

    /// The recorded reference, only if it was issued in this boot and the
    /// kernel still lists it. `pfctl -d` invalidates every token. Throws when
    /// pfctl gives no answer.
    static func heldPFEnableReference(
        recordPath: String = killSwitchPFReferencePath
    ) throws -> PFEnableReference? {
        guard let held = readPFEnableReference(recordPath),
              held.boot == (try? TonoAuthenticatedPeer.bootSession()),
              try pfEnabled(),
              try pfEnableReferenceListed(held.token) else { return nil }
        return held
    }

    static func readPFEnableReference(_ path: String) -> PFEnableReference? {
        guard let data = try? secureRead(path, maximumBytes: 4096),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["token"] as? String,
              token.range(of: #"^[0-9]{1,20}$"#, options: .regularExpression) != nil,
              let boot = object["boot"] as? String, !boot.isEmpty else { return nil }
        return .init(token: token, boot: boot)
    }

    /// pfctl prints `Token : <n>` for `-E`.
    static func parsePFEnableToken(_ output: String) -> String? {
        guard let range = output.range(
            of: #"(?<=Token : )[0-9]{1,20}"#,
            options: .regularExpression
        ) else { return nil }
        return String(output[range])
    }

    static func pfEnableReferenceListed(
        _ token: String,
        deadline: TimeInterval = KillSwitchManager.pfctlQueryDeadline
    ) throws -> Bool {
        guard let text = try pfctlQuery(["-s", "References"], deadline: deadline) else {
            return false
        }
        return text.split(whereSeparator: \.isWhitespace).contains { $0 == token }
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

    /// Longest a helper command may run. A `pfctl` load or query finishes in
    /// well under a second even on a busy Mac, and the relay-map `curl` caps
    /// itself at 10 s (`--max-time`), so this fires only on a wedged child.
    /// Unbounded, one held the helper's single request thread, and with it
    /// `/core/stop`, forever (R609-F2).
    static let helperCommandDeadline: TimeInterval = 15

    /// Past `deadline` the command has failed, whatever it would have done:
    /// no caller may read a load, an enable or a release that never reported
    /// back as done. The child gets SIGTERM, then SIGKILL, each waited on
    /// for a second; one stuck in the kernel beyond that exits on its own.
    /// `ended` runs once the child has exited and been reaped, even after
    /// this call has given up on it.
    static func run(
        _ executable: String,
        _ arguments: [String],
        deadline: TimeInterval = KillSwitchManager.helperCommandDeadline,
        started: (pid_t) -> Void = { _ in },
        ended: @escaping @Sendable () -> Void = {}
    ) throws -> HelperCommandResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        let exited = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in
            ended()
            exited.signal()
        }
        try process.run()
        started(process.processIdentifier)
        // Drained on its own thread, so a child that fills the pipe still
        // exits. The block holds the read end and the process until the
        // child's end closes, so a read abandoned below still finishes, frees
        // its descriptor, and the child is still reaped.
        let output = HelperCommandOutput()
        let reader = pipe.fileHandleForReading
        DispatchQueue.global(qos: .utility).async {
            withExtendedLifetime(process) {
                output.finish(reader.readDataToEndOfFile())
            }
        }
        let end = DispatchTime.now() + deadline
        if exited.wait(timeout: end) == .success, output.wait(until: end) {
            return .init(status: process.terminationStatus, output: output.data)
        }
        if process.isRunning {
            process.terminate()
            if exited.wait(timeout: .now() + 1) == .timedOut, process.isRunning {
                kill(process.processIdentifier, SIGKILL)
                _ = exited.wait(timeout: .now() + 1)
            }
        }
        let name = (executable as NSString).lastPathComponent
        throw HelperFailure.system(
            "\(name) did not finish within \(Int(deadline.rounded(.up))) seconds."
        )
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
