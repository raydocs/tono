import Foundation
import Darwin

/// Secondary hold after a non-strict crash or hang has already opened the
/// original network. It can name only the Anthropic inbound prefixes and a
/// fixed list of first-party AI suffixes. It has no way to say "all",
/// "default", or a shared CDN.
///
/// The kill-switch anchor is not reused. Re-enabling PF to carry two block
/// lines can also bring back a general block, so the prefixes are blackhole
/// routes and the names are `/etc/resolver` files. Both are best-effort.
/// A failure leaves the network open.
enum SelectiveFailOpen {
    static let ipv4Prefix = "160.79.104.0/23"
    static let ipv6Prefix = "2607:6bc0::/48"
    /// TEST-NET-1. Nothing answers there, and it is not the helper's loopback
    /// listener, a public resolver, or the Windows TUN DNS address.
    static let sinkholeDNS = "192.0.2.1"

    /// Exclusive first-party suffixes. Shared infrastructure that appears in
    /// the connected-session home list (Stripe, npm, GitHub, Cloudflare,
    /// Datadog, Google, Meta, Facebook) is intentionally absent. `chat.com`
    /// and `ai.com` are absent too: they are too generic to sinkhole.
    static let suffixes = [
        "anthropic.com",
        "claude.ai",
        "claude.com",
        "claude.app",
        "claude.site",
        "clau.de",
        "anthropic.ai",
        "claudestudio.com",
        "claudemcpclient.com",
        "claudemcpcontent.com",
        "claudeusercontent.com",
        "chatgpt.com",
        "openai.com",
        "oaistatic.com",
        "oaiusercontent.com",
        "grok.com",
        "grok.x.com",
        "grokipedia.com",
        "x.ai",
        "perplexity.ai",
        "perplexity.com",
        "pplx.ai",
        // Model API namespaces only; general Alibaba Cloud stays available.
        "dashscope.aliyuncs.com",
        "dashscope-intl.aliyuncs.com",
        "dashscope-us.aliyuncs.com",
        "maas.aliyuncs.com",
    ]

    enum ReleaseKind {
        case crashOrHang
        case restoreOrDisconnect
        case armTunnel
    }

    enum FollowUp {
        case apply
        case remove
    }

    static func followUp(_ kind: ReleaseKind) -> FollowUp {
        switch kind {
        case .crashOrHang:
            return .apply
        case .restoreOrDisconnect, .armTunnel:
            return .remove
        }
    }

    static func resolverBody() -> String {
        "nameserver \(sinkholeDNS)\n"
    }

    static func resolverPath(for suffix: String) -> String? {
        guard suffixes.contains(suffix),
              suffix.contains("."),
              !suffix.contains("/"),
              !suffix.contains("\\"),
              suffix != ".",
              !suffix.hasPrefix(".") else {
            return nil
        }
        return "/etc/resolver/\(suffix)"
    }

    static func routeAddArguments() -> [[String]] {
        // Darwin requires a gateway sockaddr for RTM_ADD, including blackhole
        // routes. Loopback supplies an always-local, same-family next hop;
        // RTF_BLACKHOLE discards the packet before loopback delivery.
        [
            ["/sbin/route", "-n", "add", "-inet", "-net", ipv4Prefix, "127.0.0.1", "-blackhole"],
            ["/sbin/route", "-n", "add", "-inet6", "-net", ipv6Prefix, "::1", "-blackhole"],
        ]
    }

    static func routeDeleteArguments() -> [[String]] {
        [
            ["/sbin/route", "-n", "delete", "-inet", "-net", ipv4Prefix],
            ["/sbin/route", "-n", "delete", "-inet6", "-net", ipv6Prefix],
        ]
    }

    /// Read-only RTM_GET of each prefix, paired by index with the deletes.
    static func routeGetArguments() -> [[String]] {
        [
            ["/sbin/route", "-n", "get", "-inet", "-net", ipv4Prefix],
            ["/sbin/route", "-n", "get", "-inet6", "-net", ipv6Prefix],
        ]
    }

    /// How `route -n get` prints each prefix when that exact route exists.
    static let routeReadbackIdentity: [String: (destination: String, mask: String)] = [
        ipv4Prefix: ("160.79.104.0", "255.255.254.0"),
        ipv6Prefix: ("2607:6bc0::", "ffff:ffff:ffff::"),
    ]

    /// #1164: a delete names only the destination, so it removes whatever
    /// route holds this exact prefix. Tono only ever adds blackhole routes.
    /// The delete is skipped only on positive evidence of someone else's
    /// route: the readback names this exact prefix and its flags lack
    /// BLACKHOLE. No answer, unparseable output or a different best match
    /// keeps the delete, so a Tono blackhole is never left behind.
    static func readbackShowsForeignRoute(_ output: String, prefix: String) -> Bool {
        guard let names = readbackFlags(output, prefix: prefix) else { return false }
        return !names.isEmpty && !names.contains("BLACKHOLE")
    }

    /// What is known about one part of Tono's AI layer on this Mac.
    enum LayerReading: Equatable {
        case present
        case absent
        case unknown
    }

    /// A `route -n get` of one prefix. Absent only on proof: "not in table",
    /// a different best match, or this exact prefix held by a route that is
    /// not a blackhole (not Tono's). A blackhole on this exact prefix is
    /// Tono's. Any other exit or output proves nothing.
    static func routeLayerReading(status: Int32, output: String, prefix: String) -> LayerReading {
        guard status == 0 else { return output.contains("not in table") ? .absent : .unknown }
        if let names = readbackFlags(output, prefix: prefix), !names.isEmpty {
            return names.contains("BLACKHOLE") ? .present : .absent
        }
        let fields = readbackFields(output)
        guard let identity = routeReadbackIdentity[prefix],
              let destination = fields["destination"], let mask = fields["mask"] else { return .unknown }
        return destination == identity.destination && mask == identity.mask ? .unknown : .absent
    }

    private static func readbackFields(_ output: String) -> [String: String] {
        var fields: [String: String] = [:]
        for line in output.split(separator: "\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let key = parts[0].trimmingCharacters(in: .whitespaces)
            guard ["destination", "mask", "flags"].contains(key), fields[key] == nil else { continue }
            fields[key] = parts[1].trimmingCharacters(in: .whitespaces)
        }
        return fields
    }

    /// The flag names of an exact-prefix readback; nil for any other answer.
    private static func readbackFlags(_ output: String, prefix: String) -> [String]? {
        guard let identity = routeReadbackIdentity[prefix] else { return nil }
        let fields = readbackFields(output)
        guard fields["destination"] == identity.destination,
              fields["mask"] == identity.mask,
              let flags = fields["flags"], flags.hasPrefix("<"), flags.hasSuffix(">") else {
            return nil
        }
        return flags.dropFirst().dropLast().split(separator: ",").map(String.init)
    }

    /// A command may run only when it names exactly one of the two prefixes
    /// and cannot be a default route.
    static func commandIsPrefixOnly(_ args: [String]) -> Bool {
        guard args.first == "/sbin/route" else { return false }
        let joined = args.joined(separator: " ")
        let banned = ["0.0.0.0/0", "::/0", " default", " all", "any"]
        if banned.contains(where: { joined.contains($0) }) { return false }
        let hasV4 = joined.contains(ipv4Prefix)
        let hasV6 = joined.contains(ipv6Prefix)
        return hasV4 != hasV6
    }

    /// Exercise Darwin's actual argument parser and routing-message encoder.
    /// `-d` returns before the routing-socket write, so no routes are changed.
    /// A zero exit status alone is insufficient: route can exit zero after a
    /// rejected add. XNU requires a gateway sockaddr even for a blackhole.
    static func runRouteGatewaySelfTest() -> Bool {
        guard geteuid() == 0 else { return false }
        let commands = routeAddArguments()
        guard commands.count == 2 else { return false }
        for (command, gateway) in zip(commands, ["127.0.0.1", "::1"]) {
            guard let parsed = try? KillSwitchManager.run(
                "/sbin/route", ["-d", "-v"] + Array(command.dropFirst()), deadline: 3
            ), parsed.status == 0 else { return false }
            let message = String(decoding: parsed.output, as: UTF8.self)
            guard message.contains("BLACKHOLE"), message.contains(gateway),
                  message.split(separator: "\n").contains(where: {
                      $0.hasPrefix("sockaddrs:") && $0.contains("GATEWAY")
                  }) else {
                fputs("selective fail-open: blackhole routing message has no loopback gateway\n", stderr)
                return false
            }
        }
        return true
    }

    static func runSelfTests() -> Bool {
        if followUp(.crashOrHang) != .apply
            || followUp(.restoreOrDisconnect) != .remove
            || followUp(.armTunnel) != .remove {
            fputs("selective fail-open: crash applies, restore and arm remove\n", stderr)
            return false
        }
        let routes = routeAddArguments() + routeDeleteArguments() + routeGetArguments()
        if routes.contains(where: { !commandIsPrefixOnly($0) })
            || commandIsPrefixOnly(["/sbin/route", "-n", "add", "-inet", "-net", "0.0.0.0/0", "-blackhole"])
            || commandIsPrefixOnly(["/sbin/route", "add", "default", "192.0.2.1"]) {
            fputs("selective fail-open: route command was not prefix-only\n", stderr)
            return false
        }
        // #1164: an administrator's exact-prefix route survives cleanup; a
        // Tono blackhole and a default best match are still deleted.
        let foreign = "destination: 160.79.104.0\n       mask: 255.255.254.0\n    gateway: 10.0.0.1\n"
            + "      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING>\n"
        if !readbackShowsForeignRoute(foreign, prefix: ipv4Prefix)
            || readbackShowsForeignRoute(
                foreign.replacingOccurrences(of: "STATIC,", with: "STATIC,BLACKHOLE,"), prefix: ipv4Prefix
            )
            || readbackShowsForeignRoute(
                "destination: default\n       mask: default\n      flags: <UP,GATEWAY,DONE,STATIC>\n",
                prefix: ipv4Prefix
            ) {
            fputs("selective fail-open: route cleanup ownership readback is wrong\n", stderr)
            return false
        }
        if resolverPath(for: "claude.ai") != "/etc/resolver/claude.ai"
            || resolverPath(for: "google.com") != nil
            || resolverPath(for: "stripe.com") != nil
            || resolverPath(for: ".") != nil
            || resolverPath(for: "") != nil {
            fputs("selective fail-open: resolver path admitted a shared or empty name\n", stderr)
            return false
        }
        for suffix in ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com", "maas.aliyuncs.com"] {
            if resolverPath(for: suffix) != "/etc/resolver/\(suffix)" {
                fputs("selective fail-open: dedicated model API is missing\n", stderr)
                return false
            }
        }
        if resolverPath(for: "aliyuncs.com") != nil
            || resolverPath(for: "oss-cn-hangzhou.aliyuncs.com") != nil {
            fputs("selective fail-open: general Alibaba Cloud must remain open\n", stderr)
            return false
        }
        let body = resolverBody()
        if body != "nameserver 192.0.2.1\n"
            || body.contains("127.0.0.1")
            || body.contains("1.1.1.1")
            || body.contains("8.8.8.8")
            || body.contains("198.18.0.2") {
            fputs("selective fail-open: sinkhole resolver is not TEST-NET-1\n", stderr)
            return false
        }
        let banned = ["stripe.com", "cloudflare.com", "google.com", "meta.com", "facebook.com", "npmjs.org", "chat.com", "ai.com"]
        if banned.contains(where: { suffixes.contains($0) }) {
            fputs("selective fail-open: suffix list includes shared infrastructure\n", stderr)
            return false
        }
        return true
    }
}

/// Writes and deletes the secondary layer. Never throws into a release:
/// the original network is already open, and a stuck route must not put
/// the general block back.
enum SelectiveFailOpenInstaller {
    static func runResolverOwnershipSelfTest() -> Bool {
        guard geteuid() == 0 else { return false }
        let scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-selective-ownership-\(UUID().uuidString)")
        let resolvers = scratch.appendingPathComponent("resolver").path
        let originals = scratch.appendingPathComponent("originals").path
        let path = resolvers + "/openai.com"
        let original = Data("nameserver 10.20.30.40\nsearch_order 7\n".utf8)
        do {
            try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: false)
            defer { try? FileManager.default.removeItem(at: scratch) }
            try KillSwitchManager.ensureRootDirectory(resolvers, permissions: 0o750)
            try KillSwitchManager.atomicWrite(
                path: path, data: original, permissions: 0o660, owner: 501, group: 20
            )
            let sinkhole = Data(SelectiveFailOpen.resolverBody().utf8)
            // A pre-receipt sinkhole goes even before any receipt directory exists.
            let legacy = resolvers + "/claude.ai"
            try KillSwitchManager.atomicWrite(path: legacy, data: sinkhole, permissions: 0o644)
            removeResolvers(directory: resolvers, originalsDirectory: originals)
            guard try Data(contentsOf: URL(fileURLWithPath: path)) == original,
                  !FileManager.default.fileExists(atPath: legacy) else { return false }
            writeResolvers(directory: resolvers, originalsDirectory: originals)
            guard try Data(contentsOf: URL(fileURLWithPath: path)) == sinkhole else { return false }
            // A fresh apply must not save the sinkhole as the user's original.
            writeResolvers(directory: resolvers, originalsDirectory: originals)
            removeResolvers(directory: resolvers, originalsDirectory: originals)
            var metadata = stat()
            guard try Data(contentsOf: URL(fileURLWithPath: path)) == original,
                  lstat(path, &metadata) == 0, metadata.st_mode & 0o777 == 0o660,
                  metadata.st_uid == 501, metadata.st_gid == 20,
                  !FileManager.default.fileExists(atPath: resolvers + "/claude.ai") else { return false }
            // Apply over a pre-receipt sinkhole must not save it as an original.
            try KillSwitchManager.atomicWrite(path: legacy, data: sinkhole, permissions: 0o644)
            writeResolvers(directory: resolvers, originalsDirectory: originals)
            removeResolvers(directory: resolvers, originalsDirectory: originals)
            guard !FileManager.default.fileExists(atPath: legacy) else { return false }
            // A newer administrator resolver is also foreign at cleanup time.
            writeResolvers(directory: resolvers, originalsDirectory: originals)
            let changed = Data("nameserver 10.99.0.1\n".utf8)
            try KillSwitchManager.atomicWrite(
                path: path, data: changed, permissions: 0o644, allowForeignExisting: true
            )
            removeResolvers(directory: resolvers, originalsDirectory: originals)
            return try Data(contentsOf: URL(fileURLWithPath: path)) == changed
                && lstat(resolvers, &metadata) == 0 && metadata.st_mode & 0o777 == 0o750
        } catch { return false }
    }

    static func applyBestEffort() {
        guard SelectiveFailOpen.followUp(.crashOrHang) == .apply else { return }
        writeResolvers()
        for args in SelectiveFailOpen.routeAddArguments() {
            runRoute(args, logFailure: true)
        }
    }

    /// False when a route delete did not finish or a resolver could not be
    /// restored, so the caller keeps the removal pending and retries it.
    @discardableResult
    static func removeBestEffort() -> Bool {
        var removed = true
        for (lookup, args) in zip(SelectiveFailOpen.routeGetArguments(), SelectiveFailOpen.routeDeleteArguments()) {
            if routeIsForeign(lookup) {
                FileHandle.standardError.write(Data(
                    "tono: kept a selective-prefix route that is not a Tono blackhole\n".utf8
                ))
                continue
            }
            // A missing route is the normal case on disconnect. Do not log it.
            if !runRoute(args, logFailure: false) { removed = false }
        }
        return removeResolvers() && removed
    }

    /// Read-only. Any failure answers false, which keeps the delete.
    private static func routeIsForeign(_ args: [String]) -> Bool {
        guard let executable = args.first, SelectiveFailOpen.commandIsPrefixOnly(args),
              let prefix = args.last else { return false }
        guard let result = try? KillSwitchManager.run(executable, Array(args.dropFirst()), deadline: 3),
              result.status == 0 else { return false }
        return SelectiveFailOpen.readbackShowsForeignRoute(
            String(decoding: result.output.prefix(16 * 1024), as: UTF8.self), prefix: prefix
        )
    }

    /// Read-only. True only when this Mac provably holds none of Tono's AI
    /// layer. It reads the system, not the recovery record or the receipts:
    /// a full disk can lose the record, and a corrupt receipt can keep it
    /// pending after the layer is gone. Every resolver and route must read
    /// `.absent`; `.present` or `.unknown` anywhere answers false.
    static func layerProvenAbsent(
        directory: String = "/etc/resolver",
        routeReadback: ([String]) -> (status: Int32, output: String)? = { args in
            guard let executable = args.first, SelectiveFailOpen.commandIsPrefixOnly(args),
                  let result = try? KillSwitchManager.run(executable, Array(args.dropFirst()), deadline: 3)
            else { return nil }
            return (result.status, String(decoding: result.output.prefix(16 * 1024), as: UTF8.self))
        }
    ) -> Bool {
        for suffix in SelectiveFailOpen.suffixes where SelectiveFailOpen.resolverPath(for: suffix) != nil {
            guard resolverLayerReading(at: directory + "/" + suffix) == .absent else { return false }
        }
        for args in SelectiveFailOpen.routeGetArguments() {
            guard let prefix = args.last, let answer = routeReadback(args),
                  SelectiveFailOpen.routeLayerReading(
                      status: answer.status, output: answer.output, prefix: prefix
                  ) == .absent else { return false }
        }
        return true
    }

    /// Tono writes only a regular file holding exactly the sinkhole body.
    /// Absent: no entry, a parent that is not a directory, a symlink or
    /// other non-regular entry (never followed), or a regular file of
    /// another size. Unknown: an entry that cannot be inspected or read.
    /// Directory permissions are not checked: reading is safe, and an unsafe
    /// directory can still hold a sinkhole that cleanup refused to touch.
    static func resolverLayerReading(at path: String) -> SelectiveFailOpen.LayerReading {
        let body = Data(SelectiveFailOpen.resolverBody().utf8)
        var metadata = stat()
        guard lstat(path, &metadata) == 0 else {
            return errno == ENOENT || errno == ENOTDIR ? .absent : .unknown
        }
        guard metadata.st_mode & S_IFMT == S_IFREG, metadata.st_size == off_t(body.count) else { return .absent }
        guard let contents = try? KillSwitchManager.secureRead(
            path, maximumBytes: body.count, requireRootOwnership: false
        ) else { return .unknown }
        return contents == body ? .present : .absent
    }

    private static let originalsPath = "/Library/Application Support/Tono/selective-resolvers"
    private static let maximumResolverBytes = 1024 * 1024

    private struct ResolverOriginal: Codable {
        let contents: Data?
        let permissions: UInt16
        let owner: UInt32
        let group: UInt32
    }

    /// A receipt must commit before an existing resolver is replaced. It
    /// survives helper death and repeated apply never snapshots our sinkhole.
    static func writeResolvers(
        directory: String = "/etc/resolver",
        originalsDirectory: String = originalsPath
    ) {
        do {
            var metadata = stat()
            if lstat(directory, &metadata) == 0 {
                guard isSecureDirectory(directory) else {
                    throw HelperFailure.invalid("Selective resolver directory is unsafe.")
                }
            } else {
                guard errno == ENOENT else {
                    throw HelperFailure.system("Cannot inspect selective resolver directory.")
                }
                try KillSwitchManager.ensureRootDirectory(directory, permissions: 0o755)
            }
            try KillSwitchManager.ensureRootDirectory(originalsDirectory, permissions: 0o700)
        } catch {
            logResolverFailure(error)
            return
        }
        let body = Data(SelectiveFailOpen.resolverBody().utf8)
        for suffix in SelectiveFailOpen.suffixes {
            guard SelectiveFailOpen.resolverPath(for: suffix) != nil else { continue }
            let path = directory + "/" + suffix
            let receipt = originalsDirectory + "/" + suffix
            do {
                let current = try resolverOriginal(at: path)
                var metadata = stat()
                let receiptPresent = lstat(receipt, &metadata) == 0
                if receiptPresent {
                    _ = try loadOriginal(at: receipt)
                } else if errno != ENOENT {
                    throw HelperFailure.system("Cannot inspect selective resolver receipt.")
                }
                if !receiptPresent || current.contents != body {
                    // A sinkhole with no receipt is a pre-receipt Tono write,
                    // not the user's original. Record it as absent.
                    let original = !receiptPresent && current.contents == body
                        ? ResolverOriginal(contents: nil, permissions: 0o644, owner: 0, group: 0)
                        : current
                    let data = try JSONEncoder().encode(original)
                    try KillSwitchManager.atomicWrite(path: receipt, data: data, permissions: 0o600)
                }
                try KillSwitchManager.atomicWrite(
                    path: path, data: body, permissions: 0o644, allowForeignExisting: true
                )
            } catch { logResolverFailure(error) }
        }
    }

    /// Missing ownership evidence means this file belongs to someone else.
    /// A newer administrator replacement also survives Tono cleanup.
    @discardableResult
    static func removeResolvers(
        directory: String = "/etc/resolver",
        originalsDirectory: String = originalsPath
    ) -> Bool {
        guard isSecureDirectory(directory) else { return true }
        var originalsMetadata = stat()
        let originalsPresent = lstat(originalsDirectory, &originalsMetadata) == 0
        guard !originalsPresent || isSecureDirectory(originalsDirectory) else { return true }
        var removed = true
        let body = Data(SelectiveFailOpen.resolverBody().utf8)
        for suffix in SelectiveFailOpen.suffixes {
            guard SelectiveFailOpen.resolverPath(for: suffix) != nil else { continue }
            let path = directory + "/" + suffix
            let receipt = originalsDirectory + "/" + suffix
            var metadata = stat()
            guard originalsPresent, lstat(receipt, &metadata) == 0 else {
                if !originalsPresent || errno == ENOENT, !removeLegacySinkhole(at: path, body: body) {
                    removed = false
                }
                continue
            }
            do {
                let original = try loadOriginal(at: receipt)
                let current = try resolverOriginal(at: path)
                if current.contents == body {
                    if let contents = original.contents {
                        try KillSwitchManager.atomicWrite(
                            path: path, data: contents, permissions: mode_t(original.permissions),
                            owner: uid_t(original.owner), group: gid_t(original.group),
                            allowForeignExisting: true
                        )
                    } else {
                        guard unlink(path) == 0 else { throw HelperFailure.system("Cannot remove owned resolver.") }
                        try KillSwitchManager.fsyncParent(path)
                    }
                }
                guard unlink(receipt) == 0 else { throw HelperFailure.system("Cannot retire resolver receipt.") }
                try KillSwitchManager.fsyncParent(receipt)
            } catch {
                logResolverFailure(error)
                removed = false
            }
        }
        return removed
    }

    /// Helpers before 4.52.27 wrote the sinkhole without a receipt. Only Tono
    /// writes this exact body, and a leftover one fails the connected DNS audit.
    private static func removeLegacySinkhole(at path: String, body: Data) -> Bool {
        do {
            guard try resolverOriginal(at: path).contents == body else { return true }
            guard unlink(path) == 0 else { throw HelperFailure.system("Cannot remove legacy resolver.") }
            try KillSwitchManager.fsyncParent(path)
            return true
        } catch {
            logResolverFailure(error)
            return false
        }
    }

    private static func resolverOriginal(at path: String) throws -> ResolverOriginal {
        var metadata = stat()
        guard lstat(path, &metadata) == 0 else {
            if errno == ENOENT { return .init(contents: nil, permissions: 0o644, owner: 0, group: 0) }
            throw HelperFailure.system("Cannot inspect selective resolver.")
        }
        let contents = try KillSwitchManager.secureRead(
            path, maximumBytes: maximumResolverBytes, requireRootOwnership: false
        )
        return .init(
            contents: contents,
            permissions: UInt16(metadata.st_mode & 0o777),
            owner: UInt32(metadata.st_uid),
            group: UInt32(metadata.st_gid)
        )
    }

    private static func loadOriginal(at path: String) throws -> ResolverOriginal {
        let data = try KillSwitchManager.secureRead(path, maximumBytes: 2 * maximumResolverBytes)
        let original = try JSONDecoder().decode(ResolverOriginal.self, from: data)
        guard original.permissions <= 0o777,
              (original.contents?.count ?? 0) <= maximumResolverBytes else {
            throw HelperFailure.invalid("Selective resolver receipt is invalid.")
        }
        return original
    }

    private static func isSecureDirectory(_ path: String) -> Bool {
        var metadata = stat()
        return lstat(path, &metadata) == 0
            && metadata.st_mode & S_IFMT == S_IFDIR
            && metadata.st_uid == 0 && metadata.st_mode & 0o022 == 0
    }

    private static func logResolverFailure(_ error: Error) {
        FileHandle.standardError.write(Data("tono: selective resolver recovery failed: \(error)\n".utf8))
    }

    /// False only when the command did not finish. A nonzero exit (no such
    /// route) is the normal answer and counts as done.
    @discardableResult
    private static func runRoute(_ args: [String], logFailure: Bool) -> Bool {
        guard let executable = args.first, SelectiveFailOpen.commandIsPrefixOnly(args) else {
            FileHandle.standardError.write(Data(
                "tono: refused a selective route command that was not prefix-only\n".utf8
            ))
            return true
        }
        do {
            _ = try KillSwitchManager.run(executable, Array(args.dropFirst()), deadline: 3)
            return true
        } catch {
            if logFailure {
                FileHandle.standardError.write(Data(
                    "tono: selective route command did not finish: \(error)\n".utf8
                ))
            }
            return false
        }
    }

}
