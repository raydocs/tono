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
        let routes = routeAddArguments() + routeDeleteArguments()
        if routes.contains(where: { !commandIsPrefixOnly($0) })
            || commandIsPrefixOnly(["/sbin/route", "-n", "add", "-inet", "-net", "0.0.0.0/0", "-blackhole"])
            || commandIsPrefixOnly(["/sbin/route", "add", "default", "192.0.2.1"]) {
            fputs("selective fail-open: route command was not prefix-only\n", stderr)
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
            removeResolvers(directory: resolvers, originalsDirectory: originals)
            guard try Data(contentsOf: URL(fileURLWithPath: path)) == original else { return false }
            writeResolvers(directory: resolvers, originalsDirectory: originals)
            let sinkhole = Data(SelectiveFailOpen.resolverBody().utf8)
            guard try Data(contentsOf: URL(fileURLWithPath: path)) == sinkhole else { return false }
            // A fresh apply must not save the sinkhole as the user's original.
            writeResolvers(directory: resolvers, originalsDirectory: originals)
            removeResolvers(directory: resolvers, originalsDirectory: originals)
            var metadata = stat()
            guard try Data(contentsOf: URL(fileURLWithPath: path)) == original,
                  lstat(path, &metadata) == 0, metadata.st_mode & 0o777 == 0o660,
                  metadata.st_uid == 501, metadata.st_gid == 20,
                  !FileManager.default.fileExists(atPath: resolvers + "/claude.ai") else { return false }
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

    static func removeBestEffort() {
        for args in SelectiveFailOpen.routeDeleteArguments() {
            // A missing route is the normal case on disconnect. Do not log it.
            runRoute(args, logFailure: false)
        }
        removeResolvers()
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
                    let data = try JSONEncoder().encode(current)
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
    static func removeResolvers(
        directory: String = "/etc/resolver",
        originalsDirectory: String = originalsPath
    ) {
        guard isSecureDirectory(directory), isSecureDirectory(originalsDirectory) else { return }
        let body = Data(SelectiveFailOpen.resolverBody().utf8)
        for suffix in SelectiveFailOpen.suffixes {
            guard SelectiveFailOpen.resolverPath(for: suffix) != nil else { continue }
            let path = directory + "/" + suffix
            let receipt = originalsDirectory + "/" + suffix
            var metadata = stat()
            guard lstat(receipt, &metadata) == 0 else { continue }
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
            } catch { logResolverFailure(error) }
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

    private static func runRoute(_ args: [String], logFailure: Bool) {
        guard let executable = args.first, SelectiveFailOpen.commandIsPrefixOnly(args) else {
            FileHandle.standardError.write(Data(
                "tono: refused a selective route command that was not prefix-only\n".utf8
            ))
            return
        }
        do {
            _ = try KillSwitchManager.run(executable, Array(args.dropFirst()), deadline: 3)
        } catch {
            if logFailure {
                FileHandle.standardError.write(Data(
                    "tono: selective route command did not finish: \(error)\n".utf8
                ))
            }
        }
    }

}
