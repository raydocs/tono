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
        for suffix in SelectiveFailOpen.suffixes {
            guard let path = SelectiveFailOpen.resolverPath(for: suffix) else { continue }
            if isSymbolicLink(path) { continue }
            try? FileManager.default.removeItem(atPath: path)
        }
    }

    private static func writeResolvers() {
        let directory = "/etc/resolver"
        if isSymbolicLink(directory) { return }
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: directory, isDirectory: &isDirectory) {
            if !isDirectory.boolValue { return }
        } else {
            do {
                try FileManager.default.createDirectory(
                    atPath: directory,
                    withIntermediateDirectories: false,
                    attributes: [.posixPermissions: 0o755]
                )
            } catch {
                FileHandle.standardError.write(Data(
                    "tono: selective resolver directory was not created: \(error)\n".utf8
                ))
                return
            }
        }
        let body = Data(SelectiveFailOpen.resolverBody().utf8)
        for suffix in SelectiveFailOpen.suffixes {
            guard let path = SelectiveFailOpen.resolverPath(for: suffix) else { continue }
            if isSymbolicLink(path) { continue }
            if !FileManager.default.createFile(
                atPath: path,
                contents: body,
                attributes: [.posixPermissions: 0o644]
            ) {
                FileHandle.standardError.write(Data(
                    "tono: selective resolver was not written for \(suffix)\n".utf8
                ))
            }
        }
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

    private static func isSymbolicLink(_ path: String) -> Bool {
        var info = stat()
        guard lstat(path, &info) == 0 else { return false }
        return info.st_mode & S_IFMT == S_IFLNK
    }
}
