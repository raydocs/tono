import Foundation
import CryptoKit
import Darwin
import AppKit
import Security

/// Produces runtime.yaml from subscription YAML + minimal overlay.
/// Follows Verge's principle: subscription config is immutable, overlay only control fields.
nonisolated struct ConfigPipeline {
    /// Mihomo is the only process allowed to create this interface. The kill
    /// switch validates that this exact interface exists before exempting it.
    static let tonoTunInterface = "utun199"

    struct OverlayConfig: Sendable {
        var mixedPort: Int = 7890
        var externalController: String = "127.0.0.1:9090"
        var secret: String = ""
        var mode: String = "rule"
        var logLevel: String = "info"
        var allowLan: Bool = false
        var tunEnabled: Bool = false
        /// `Home-US` or the exact name of one sanitized imported node.
        var selectedNodeName: String = "Home-US"
        /// Present only after Tono reports a healthy, exit-node-pinned SOCKS endpoint.
        var tonoTransport: TonoTransportDescriptor? = nil
        /// Optional managed route for Claude traffic. The control plane may
        /// omit this until the corresponding home/default node is published.
        var claudeHomeNodeName: String? = nil
        var defaultNodeName: String? = nil
        /// Optional cloud-assigned residential SOCKS5 upstream. It is chained
        /// through `Tono-Exit`, so its host is not a direct PF exception.
        var claudeHomeSocks5: TonoExitCatalogHomeSocks5? = nil
    }

    struct DialEndpoint: Equatable, Sendable {
        let host: String
        let port: UInt16
        let transport: String
    }

    struct DirectEndpoint: Hashable, Equatable, Sendable {
        let address: String
        let port: UInt16
        let transport: String
    }

    struct DirectDomainPin: Equatable, Sendable {
        let host: String
        let addresses: [String]
        let ports: [UInt16]
    }

    /// An exact, allowlisted suffix route. Unlike a resolved domain pin, a
    /// suffix route intentionally carries no IP addresses or PF endpoints.
    struct DirectDomainSuffix: Equatable, Sendable {
        let host: String
        let ports: [UInt16]
    }

    struct ManagedDirectRuntimePolicy: Equatable, Sendable {
        let physicalInterface: String
        let domainPins: [DirectDomainPin]
        let webDomainPins: [DirectDomainPin]
        let webDomainSuffixes: [DirectDomainSuffix]
        let mediaEndpoints: [DirectEndpoint]
        /// Exact reviewed TCP IP endpoints used by native WeChat HTTPDNS.
        /// These receive TCP rules and per-endpoint health fallbacks; UDP
        /// media endpoints remain isolated in `mediaEndpoints`.
        let tcpEndpoints: [DirectEndpoint]
        /// Policy hostnames (pre-resolution) that must resolve through the
        /// interface-bound direct outbound via the China DoH resolvers, so the
        /// pinned answers are region-correct instead of exit-geolocated.
        let directResolverHosts: [String]
        /// True only when the source traffic-policy signature verified. This
        /// runtime metadata is what lets a signed policy carry a new reviewed
        /// hostname through every validation layer, not merely the decoder.
        let trusted: Bool

        init(
            physicalInterface: String,
            domainPins: [DirectDomainPin],
            webDomainPins: [DirectDomainPin] = [],
            webDomainSuffixes: [DirectDomainSuffix] = [],
            mediaEndpoints: [DirectEndpoint],
            tcpEndpoints: [DirectEndpoint] = [],
            directResolverHosts: [String] = [],
            trusted: Bool = false
        ) {
            self.physicalInterface = physicalInterface
            self.domainPins = domainPins
            self.webDomainPins = webDomainPins
            self.webDomainSuffixes = webDomainSuffixes
            self.mediaEndpoints = mediaEndpoints
            self.tcpEndpoints = tcpEndpoints
            self.directResolverHosts = directResolverHosts
            self.trusted = trusted
        }

        var sessionEndpoints: [DirectEndpoint] {
            let domainEndpoints = (domainPins + webDomainPins).flatMap { pin in
                pin.addresses.flatMap { address in
                    pin.ports.map {
                        DirectEndpoint(
                            address: address,
                            port: $0,
                            transport: "tcp"
                        )
                    }
                }
            }
            // The China DoH resolvers must be PF-permitted whenever managed
            // domains need region-correct resolution through the direct path.
            let resolverEndpoints = directResolverHosts.isEmpty
                ? []
                : ConfigPipeline.managedDirectResolverEndpoints
            return Array(Set(
                domainEndpoints + tcpEndpoints + mediaEndpoints
                    + resolverEndpoints
            )).sorted {
                ($0.transport, $0.port, $0.address)
                    < ($1.transport, $1.port, $1.address)
            }
        }

        var isEmpty: Bool {
            domainPins.isEmpty && webDomainPins.isEmpty
                && webDomainSuffixes.isEmpty && mediaEndpoints.isEmpty
                && tcpEndpoints.isEmpty
                && directResolverHosts.isEmpty
        }
    }

    static let homeNodeName = "Home-US"
    static let exitGroupName = "Tono-Exit"
    static let claudeHomeGroupName = "Tono-Claude-Home"
    static let homeResidentialProxyName = "Tono-Home-Residential"
    static let directProxyName = "Tono-China-Direct"
    static let webDirectProxyName = "Tono-China-Web-Direct"
    /// Wraps the interface-bound web direct outbound so a China path that is
    /// unreachable from where the user actually sits degrades to the tunnel
    /// instead of killing the flow. A bare `direct` outbound has no failover:
    /// that is why suffix routes were withheld even after PF stopped being the
    /// obstacle. The probe is class-level, not per destination — mihomo scores
    /// fallback members by URL — which answers "can this machine reach China
    /// directly at all", the question that actually distinguishes the two
    /// members.
    static let webDirectGroupName = "Tono-China-Web"
    /// Same failover the web routes got, for the reviewed bundle's own direct
    /// path. Without it the bundle-wide process rule pointed at a bare `direct`
    /// outbound, so a destination unreachable from where the user sits died
    /// there instead of retreating to the tunnel — observed as six retries to
    /// one address with bytes sent and nothing received, while other direct
    /// flows in the same session moved 13 MB.
    static let appDirectGroupName = "Tono-China-App"
    /// Reachable over plain HTTP from inside China and answers 204, so the
    /// probe measures the direct path rather than a TLS handshake. Port 80 is
    /// inside the reviewed-bundle permit, so the probe itself is not blocked.
    /// Probe for the China-direct fallback groups.
    ///
    /// Was Xiaomi's captive-portal check, which shares nothing with the traffic
    /// it gates except the port. This is a Tencent host on the same port as the
    /// WeChat flows the app group carries, so a Tencent-wide TCP/80 problem — the
    /// shape of what was originally measured when WeChat's port 80 was detoured
    /// through the exit — now flips the group instead of being invisible to it.
    ///
    /// It still cannot see a hang specific to one rotating CDN address; nothing
    /// short of probing every address could, and that is documented where the
    /// group is emitted. Verified against mihomo rather than assumed: it answers
    /// 302 and mihomo records the member alive at ~89 ms.
    static let chinaDirectHealthURL = "http://res.wx.qq.com/"
    /// Names the per-pin health groups this build no longer emits. The name is
    /// still reserved against catalog nodes and still recognised by the proxy
    /// picker and the audit classifier, because a core left running a runtime
    /// generated by an earlier build will still report these groups until the
    /// next reconnect regenerates its config.
    static let managedDirectFallbackGroupPrefix = "Tono-WeChat-TCP-"
    static let managedDirectHealthIntervalSeconds = 60
    /// Steady-state budget written into the runtime fallback groups. Kept
    /// generous so a congested but usable direct path is not flapped away.
    static let managedDirectHealthTimeoutMilliseconds = 3_500
    /// Liveness probe for the chained Claude route. Deliberately not an
    /// Anthropic endpoint: this fires every interval on every client, and a
    /// generic 204 already distinguishes a stalled hop from a healthy one.
    static let claudeHomeHealthURL = "https://www.gstatic.com/generate_204"

    /// Assistant providers that must egress through the residential hop. They
    /// score datacenter ranges as abuse, so a shared cloud exit invites
    /// challenges and blocks that a residential identity avoids.
    ///
    /// Emitted before every direct rule, which also guarantees none of this
    /// traffic can be captured by a China-direct exception later in the chain.
    /// Deliberately excluded: `x.com`, which is Twitter at large rather than
    /// Grok, and `google.com` / `googleapis.com` / `gstatic.com` at large.
    /// Gemini is pinned by its product hostnames so Search, YouTube, and
    /// Tono's own home-group probe stay off the residential hop.
    /// Only first-party provider domains belong here. Shared infrastructure the
    /// public AI rule lists bundle in — auth0, stripe, sentry, statsig, datadog,
    /// segment, cloudflare.net, googleapis.com, gstatic.com — is used by
    /// thousands of unrelated apps, so routing it here would push ordinary
    /// traffic onto a consumer uplink. `gstatic.com` would be actively harmful:
    /// it is this group's own liveness probe, and sending the probe through the
    /// hop it is meant to test would mask exactly the stalls we check for.
    static let assistantHomeDomainSuffixes = [
        // Anthropic
        "anthropic.com",
        "claude.ai",
        "claude.com",
        "claude.app",
        "claude.site",
        "clau.de",
        "claudestudio.com",
        "claudemcpclient.com",
        "claudemcpcontent.com",
        "claudeusercontent.com",
        // OpenAI, including Codex. `chat.com` and `ai.com` are OpenAI-owned
        // entry points that redirect into ChatGPT.
        "chatgpt.com",
        "openai.com",
        "chat.com",
        "ai.com",
        "oaistatic.com",
        "oaiusercontent.com",
        // xAI. `grok.x.com` is listed on its own so Grok-on-X is covered
        // without routing the whole of x.com through the residential hop.
        "grok.com",
        "grok.x.com",
        "grokipedia.com",
        "x.ai",
        // Perplexity
        "perplexity.ai",
        "perplexity.com",
        "pplx.ai",
        // Gemini product hosts only. Not google.com / googleapis.com / gstatic.com.
        "gemini.google.com",
        "bard.google.com",
        "aistudio.google.com",
        "generativelanguage.googleapis.com",
        "notebooklm.google.com",
    ]
    /// Anthropic's own unicast (ARIN AP-2440). Claude Code has been seen
    /// dialing `160.79.104.10` by raw IP, which no DOMAIN-SUFFIX can catch.
    /// IPv6 prefixes stay off this list: the runtime is `ipv6: false`, so
    /// AAAA never reaches TUN. `1.1.1.1` / `8.8.8.8` stay off too: they are
    /// Tono's exit probe.
    static let assistantHomeIPv4Cidrs = [
        "160.79.104.0/21",
    ]

    /// Assistant clients pinned by process, for the case where a desktop app or
    /// CLI reaches an endpoint that is not covered by the suffix list.
    /// Both cases and the `.exe` forms are listed because mihomo matches the
    /// complete basename: the npm-distributed Claude Code launcher is observed
    /// as `claude.exe` even on macOS, and the Codex and ChatGPT CLIs ship under
    /// inconsistent capitalisation.
    static let assistantHomeProcessNames = [
        "Claude",
        "claude",
        "claude.exe",
        // Electron's main helper has no parentheses. GPU/Renderer helpers
        // still cannot be named here — `,()` would break the AND payload —
        // so `/Claude\.app/` below covers those.
        "Claude Helper",
        "ChatGPT",
        "chatgpt",
        "ChatGPT.exe",
        "Codex",
        "codex",
        "Codex.exe",
    ]
    /// Basename matching misses two shapes that matter, so these are matched by
    /// install path instead.
    ///
    /// Claude Code's launcher is the version directory's own file, so its
    /// process name is a version string — `2.1.223` on this machine. No entry in
    /// the list above could ever match it, which left every endpoint outside the
    /// assistant suffix list leaving through the datacenter exit while the API
    /// calls used the residential hop: one account, two networks. It was found
    /// by noticing Claude Code's telemetry upload on the wrong path, and
    /// chasing telemetry hostnames one at a time is the enumeration approach
    /// that already failed for WeChat's rotating addresses.
    ///
    /// The desktop apps are Electron, so they spawn helpers like
    /// `Claude Helper (Renderer)`. A bundle prefix covers the whole bundle the
    /// way the reviewed-bundle rule does.
    ///
    /// Unlike the reviewed-bundle direct permit, these paths need no signature
    /// review: the target is a protected residential hop, not the physical
    /// interface, so a process that matched one it should not still leaves
    /// through the tunnel and still fails closed.
    /// Deliberately unanchored. These were `^/Applications/Claude.app/` and
    /// friends, which is the same assumption that had already cost WeChat its
    /// entire China-direct path: a customer whose bundle sits in `~/Applications`
    /// — what macOS itself suggests for a non-administrator install — or in a
    /// folder of their own matched nothing, so the Electron helpers that do the
    /// actual fetching left through the datacenter exit while the CLI, matched by
    /// process name, used the residential hop. One account, two egress
    /// identities, and nothing on screen to say so.
    ///
    /// `PROCESS-PATH-REGEX` is a contains match, verified rather than assumed: a
    /// process under a nested `Claude.app` matches `/Claude\.app/` while an
    /// unrelated path does not. So naming the bundle is enough and its location
    /// stops mattering, on any volume at any depth.
    ///
    /// The npm entry covers every prefix `npm -g`, pnpm and bun can choose; the
    /// installer entry covers any home directory layout. Widening is safe here
    /// for the reason below: the target is a protected hop, so a process matched
    /// by mistake still leaves through the tunnel and still fails closed.
    ///
    /// Residual limit: a *renamed* Claude.app still misses. Unlike WeChat, whose
    /// Chinese installer produces `微信.app` by default, this bundle ships as
    /// Claude.app and renaming it is a deliberate act.
    static let assistantHomeProcessPathRegexes = [
        "/\\.local/share/claude/versions/",
        "/node_modules/@anthropic-ai/claude-code/",
        "/Claude\\.app/",
        "/ChatGPT\\.app/",
        "/\\.local/share/codex/",
        "/node_modules/@openai/codex/",
    ]

    /// Claude Code's versioned launcher is named `2.1.223`, not `claude`.
    static func isClaudeCodeIdentity(process: String, processPath: String) -> Bool {
        let path = processPath.lowercased()
        // Desktop is `Claude`; the CLI is `claude` / `claude.exe`. Do not
        // lowercase the desktop name into the CLI bucket.
        if process == "claude" || process == "claude.exe" { return true }
        if path.contains("/.local/share/claude/versions/") { return true }
        if path.contains("/node_modules/@anthropic-ai/claude-code/") { return true }
        return false
    }

    static func isClaudeAppIdentity(process: String, processPath: String) -> Bool {
        let name = process
        let path = processPath.lowercased()
        if path.contains("/claude.app/") { return true }
        if name == "Claude" || name.hasPrefix("Claude Helper") { return true }
        return false
    }
    /// Exact suffixes accepted by traffic-policy v3. They are rendered only
    /// as TCP DOMAIN-SUFFIX rules; the control plane and client both reject
    /// arbitrary suffixes and subdomain-shaped entries here.
    static let managedWebDirectSuffixAllowlist = [
        "bilibili.com", "biliapi.net", "bilivideo.com", "hdslb.com",
        "qq.com", "gtimg.cn", "gtimg.com", "iqiyi.com", "qiyi.com",
        "qiyipic.com", "iqiyipic.com", "youku.com", "ykimg.com",
        "xiaohongshu.com", "xhslink.com", "xhscdn.com",
        "feishu.cn", "feishucdn.com", "larksuite.com", "larkoffice.com",
        "baidu.com", "baidupcs.com", "bcebos.com", "baidubcs.com",
        "bdstatic.com", "bdimg.com", "aliyuncs.com", "10jqka.com.cn",
        "iwencai.com", "eastmoney.com", "dfcfw.com", "sina.com.cn",
        "sinajs.cn", "legulegu.com", "optbbs.com", "100ppi.com",
        // `ccxe.com.cn` is live in published policy revision 7. Removing it here
        // made this client reject the *entire* policy — every WeChat direct pin
        // and every web acceleration route with it — because one unrecognised
        // suffix fails the whole document. The client allowlist must therefore be
        // a superset of what published policy actually uses; it is never safe to
        // narrow it against the Worker source alone, since the deployed Worker
        // may still accept entries this checkout no longer lists.
        "awtmt.com", "cls.cn", "cninfo.com.cn", "ccxe.com.cn",
        "pushplus.plus", "baostock.com", "sse.com.cn", "szse.cn",
        "zoom.us", "zoom.com", "zoomgov.com", "oray.com", "sunlogin.com",
        "edu.cn",
    ]
    /// Domain families the reviewed WeChat bundle dials, resolved through China
    /// DoH on the interface-bound direct outbound.
    ///
    /// The bundle-wide process rule already sends every WeChat socket to
    /// `appDirectGroupName`, but a route is only as good as the answer behind
    /// it. Published policy pins exact hostnames, and the ones WeChat actually
    /// uses are not the ones on that list: over four days of one Mac's audit,
    /// `mmbiz.qpic.cn` was pinned while `snsvideo.c2c.wechat.com` — the busiest
    /// WeChat host on the machine — was not, so its name was resolved through
    /// `#Tono-Exit` and the "direct" dial waited on a lookup that crossed the
    /// Pacific first.
    ///
    /// Suffixes, not the process, on purpose: WeChat's in-app browser opens
    /// ordinary sites (`chase.com`, `google.com`, `tesla.com` all appear in the
    /// same audit), and those must keep resolving the way every other app's
    /// hostnames do. Kept to families that are unambiguously WeChat rather than
    /// Tencent-wide — no bare `qq.com`, which would swallow `v.qq.com` video
    /// and everything else the managed policy governs separately.
    ///
    /// Accepted limitation, the same one the managed suffixes already carry: a
    /// `nameserver-policy` entry has no fallback to the global nameserver, so
    /// if the direct outbound cannot reach AliDNS these names stop resolving
    /// rather than resolving through the exit.
    static let wechatDirectDNSSuffixes = [
        "wechat.com",       // snsvideo.c2c, mmsns.c2c, mmhead.c2c, dns, dl
        "weixinbridge.com", // cube, badjs
        "qpic.cn",          // mmbiz, mmsns, wework
        "qlogo.cn",         // wx.qlogo
        "weixin.qq.com",    // mp, game, liteapp, wwfile.work
        "wx.qq.com",        // res
        "wxs.qq.com",       // wxa, wxsmw
    ]

    /// AliDNS DoH over TCP/443 with IP-literal certificates. Managed-direct
    /// domains resolve through these upstreams via the interface-bound direct
    /// outbound (nameserver-policy `#Tono-China-Direct`), which keeps pinned
    /// answers region-correct. TCP/443 stays inside the helper's session
    /// endpoint contract, and TLS server authentication protects the answers
    /// that feed the hosts pins and the PF allowlist.
    static let managedDirectResolverURLs = [
        "https://223.5.5.5/dns-query",
        "https://223.6.6.6/dns-query",
    ]
    static let managedDirectResolverEndpoints = [
        DirectEndpoint(address: "223.5.5.5", port: 443, transport: "tcp"),
        DirectEndpoint(address: "223.6.6.6", port: 443, transport: "tcp"),
    ]
    /// WeChat 4.x performs image/media/CDN transfer in helper executables that
    /// live inside the app bundle but are not the main binary (WeChatAppEx, its
    /// dedicated NetworkService helper, WeChatHelper, wxplayer, wxocr). Process
    /// matching therefore covers the whole reviewed bundle prefix, not one
    /// exact executable path. The standard install location is always present;
    /// a Launch Services lookup adds the real install path so a non-standard
    /// install keeps routing and audit attribution.
    ///
    /// Adoption is gated on the code signature and on being safe to embed in a
    /// Mihomo rule payload — and on nothing else. It used to also require the
    /// bundle be *named* `WeChat.app` and its path be printable ASCII, and both
    /// of those excluded the install a customer actually had:
    ///
    ///     /Applications/联系软件/微信.app/Contents/MacOS/WeChat
    ///
    /// A renamed bundle inside a folder of their own — ordinary housekeeping,
    /// and the localized name is what the Chinese installer offers. Every one of
    /// that account's WeChat connections fell through to `MATCH,Tono-Exit`: 342
    /// of 342 in one three-hour window, including the TCP/443 flows that should
    /// have been direct, so China-direct had never once worked for them while
    /// the UI reported the policy as active. Neither gate bought anything a
    /// signature does not: `isSignedWeChatBundle` requires an Apple-anchored
    /// signature claiming `com.tencent.xinWeChat` from Tencent's team, and
    /// anyone able to satisfy that can equally name their bundle `WeChat.app`.
    ///
    /// What must still hold is what the rule payload cannot survive: control
    /// characters would corrupt the emitted YAML line. Non-ASCII is fine — the
    /// rule is UTF-8 and matched by RE2. Commas and parentheses, which delimit
    /// Mihomo AND sub-rules, are not rejected either: they are emitted as RE2
    /// hex escapes so the payload never contains the character itself. A folder
    /// called `Apps (2)` is ordinary, and rejecting it would be the same failure
    /// as rejecting `微信.app` — a customer whose layout we did not anticipate
    /// silently losing the whole feature.
    /// Recomputed on each access rather than cached for the process lifetime.
    ///
    /// It was a `static let`, which meant a customer who installed or moved
    /// WeChat while Tono was running got no China-direct routing until they
    /// quit and reopened the app — with the UI reporting the policy as active
    /// the whole time, which is the same silent shape as the path gates this
    /// replaced. Cost is one Launch Services query and one signature check per
    /// bundle, on a path that runs when a config is built, not per packet.
    ///
    /// Remaining limit: a bundle Launch Services has never registered is still
    /// invisible, and the list is sampled when the runtime is generated, so a
    /// move mid-session is picked up on the next connect or policy refresh
    /// rather than immediately.
    static var managedDirectProcessBundlePaths: [String] {
        var paths = ["/Applications/WeChat.app/"]
        let discovered = NSWorkspace.shared.urlsForApplications(
            withBundleIdentifier: "com.tencent.xinWeChat"
        )
        for url in discovered {
            let path = url.standardizedFileURL.resolvingSymlinksInPath().path + "/"
            guard isRulePayloadSafeBundlePath(path),
                  !paths.contains(path),
                  isSignedWeChatBundle(at: url) else { continue }
            paths.append(path)
        }
        return paths
    }

    /// Whether a bundle path can be embedded in a Mihomo rule without changing
    /// how that rule parses.
    ///
    /// Separated from the discovery loop so it can be tested without a signed
    /// bundle on disk, which is the part of adoption a test cannot fabricate.
    static func isRulePayloadSafeBundlePath(_ path: String) -> Bool {
        guard path.hasPrefix("/"), path.hasSuffix("/"), path.count <= 1_024
        else { return false }
        // Control characters, DEL, and the Unicode line/paragraph separators a
        // YAML emitter would treat as a break.
        return path.unicodeScalars.allSatisfy {
            $0.value >= 0x20 && $0.value != 0x7F
                && $0.value != 0x2028 && $0.value != 0x2029
                && $0.value != 0x85
        }
    }

    /// Path shape is not an identity. Launch Services returns whatever bundle
    /// currently claims `com.tencent.xinWeChat`, and any process running as the
    /// user can register `~/Applications/WeChat.app` — a location it can write —
    /// to have its own executables matched by the PROCESS-PATH-REGEX rules and
    /// so reach the pinned Tencent endpoints outside the tunnel. Requiring an
    /// Apple-anchored signature that claims WeChat's identifier raises that from
    /// "drop a binary anywhere you can write" to holding a revocable Apple
    /// signing identity and signing under someone else's identifier.
    ///
    /// Basic validation only: this is an identity question, not an integrity
    /// audit of a multi-hundred-megabyte bundle, and deep validation here would
    /// hash every resource on the connect path. `/Applications/WeChat.app` is
    /// unconditionally trusted as before — it is the reviewed location and is not
    /// writable without administrator rights.
    ///
    /// Tencent's Developer ID team, so adoption is pinned to Tencent rather than
    /// to any Apple-issued signature that merely claims WeChat's identifier
    /// (`identifier` is not namespaced per team — anyone can sign code with it).
    /// Read from a known-good install rather than from documentation:
    ///
    ///     $ codesign -dv --verbose=2 /Applications/WeChat.app
    ///     Identifier=com.tencent.xinWeChat
    ///     Authority=Developer ID Application: Tencent Mobile International
    ///               Limited (5A4RE8SF68)
    ///     TeamIdentifier=5A4RE8SF68
    ///
    /// If Tencent ever ships under a second team, adoption fails closed: the
    /// bundle is skipped, WeChat routes through the tunnel, and nothing leaks.
    static let reviewedWeChatTeamIdentifier: String? = "5A4RE8SF68"

    private static func isSignedWeChatBundle(at url: URL) -> Bool {
        var requirementText =
            #"anchor apple generic and identifier "com.tencent.xinWeChat""#
        if let team = reviewedWeChatTeamIdentifier,
           team.unicodeScalars.allSatisfy({
               $0.isASCII && ($0.properties.isAlphabetic
                   || CharacterSet.decimalDigits.contains($0))
           }), !team.isEmpty {
            requirementText += #" and certificate leaf[subject.OU] = ""# + team + #"""#
        }
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(
            url as CFURL,
            SecCSFlags(rawValue: 0),
            &code
        ) == errSecSuccess, let code else { return false }
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(
            requirementText as CFString,
            SecCSFlags(rawValue: 0),
            &requirement
        ) == errSecSuccess, let requirement else { return false }
        return SecStaticCodeCheckValidity(
            code,
            SecCSFlags(rawValue: kSecCSBasicValidateOnly),
            requirement
        ) == errSecSuccess
    }

    /// Anchored RE2 patterns for Mihomo PROCESS-PATH-REGEX sub-rules, derived
    /// from the reviewed bundle prefixes so the two can never drift apart.
    static var managedDirectProcessPathRegexes: [String] {
        managedDirectProcessBundlePaths.map(rulePathRegex(for:))
    }

    /// Anchored RE2 pattern for one bundle prefix, with the three characters
    /// Mihomo's rule grammar owns replaced by hex escapes.
    ///
    /// A comma separates AND sub-rules and parentheses delimit them, so a path
    /// containing either would be split in the wrong place — backslash-escaping
    /// does not help, because the splitting happens before the regex is parsed.
    /// `\x2c` and friends carry the character without the payload containing
    /// it. Verified against mihomo rather than assumed: a process under a
    /// directory named `a,b` matches a rule written with `\x2c`, while one
    /// outside it does not.
    static func rulePathRegex(for path: String) -> String {
        // Built one character at a time rather than by escaping the whole path
        // and patching the result. The patching version replaced `\(` and then
        // `(`, which is order-dependent: dropping the first replacement left the
        // second one rewriting the parenthesis *inside* the backslash escape and
        // producing `\\x28`, a literal backslash followed by an escape. The
        // pattern still contained no delimiter, so a "contains" assertion could
        // not see it. Per-character has no such ordering to get wrong.
        var escaped = ""
        for character in path {
            switch character {
            case ",": escaped += "\\x2c"
            case "(": escaped += "\\x28"
            case ")": escaped += "\\x29"
            default:
                escaped += NSRegularExpression.escapedPattern(for: String(character))
            }
        }
        let pattern = "^" + escaped
        // Backstop, not the mechanism: if a future edit reintroduces a literal
        // delimiter the emitted ruleset would silently mis-parse, and a crash
        // here is preferable to a rule that routes the wrong traffic.
        precondition(
            !pattern.contains(",") && !pattern.contains("(")
                && !pattern.contains(")"),
            "managed direct bundle path unsafe for rule emission"
        )
        return pattern
    }

    /// Finds the product-default cloud exit without depending on one exact
    /// catalog spelling. For example, `US Reality`, `US-VLESS-Reality`, and a
    /// flag-prefixed equivalent all resolve to the US Reality preference.
    static func preferredCloudExit(
        in nodes: [ProxyNode],
        named preferredName: String
    ) -> ProxyNode? {
        guard !nodes.isEmpty else { return nil }
        let preferredCompact = compactCloudExitName(preferredName)
        if let exact = nodes.first(where: {
            compactCloudExitName($0.name) == preferredCompact
                || compactCloudExitName($0.id) == preferredCompact
        }) {
            return exact
        }

        let preferredWords = cloudExitWords(preferredName)
        let wantsUS = preferredWords.contains("US")
            || (preferredWords.contains("UNITED") && preferredWords.contains("STATES"))
        let wantsJP = preferredWords.contains("JP")
            || preferredWords.contains("JAPAN")
            || preferredWords.contains("JAPANESE")
        let wantsReality = preferredWords.contains("REALITY")
        if wantsUS || wantsJP,
           let regional = nodes.first(where: { node in
               let words = cloudExitWords(node.name)
               let isUS = node.flag == "🇺🇸"
                   || words.contains("US")
                   || (words.contains("UNITED") && words.contains("STATES"))
               let isJP = node.flag == "🇯🇵"
                   || words.contains("JP")
                   || words.contains("JAPAN")
                   || words.contains("JAPANESE")
               let isRequestedRegion = (wantsUS && isUS) || (wantsJP && isJP)
               return isRequestedRegion && (!wantsReality || words.contains("REALITY"))
           }) {
            return regional
        }
        return nodes.first
    }

    static func orderedCloudExits(
        _ nodes: [ProxyNode],
        preferredName: String
    ) -> [ProxyNode] {
        guard let preferred = preferredCloudExit(in: nodes, named: preferredName),
              let index = nodes.firstIndex(where: { $0.id == preferred.id }) else {
            return nodes
        }
        var ordered = nodes
        ordered.remove(at: index)
        ordered.insert(preferred, at: 0)
        return ordered
    }

    private static func compactCloudExitName(_ value: String) -> String {
        String(value.uppercased().unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0)
        })
    }

    private static func cloudExitWords(_ value: String) -> Set<String> {
        let separated = String(value.uppercased().unicodeScalars.map {
            CharacterSet.alphanumerics.contains($0) ? Character(String($0)) : " "
        })
        return Set(separated.split(whereSeparator: \.isWhitespace).map(String.init))
    }

    /// Default DNS config injected when subscription YAML has no dns: section.
    /// Without this, system DNS is used → DNS pollution → wrong GeoIP → all traffic DIRECT.
    private static let defaultDNS = """
    dns:
      enable: true
      listen: \(ProtectedDNSContract.listener)
      enhanced-mode: fake-ip
      fake-ip-range: 198.18.0.1/16
      default-nameserver:
        - 223.5.5.5
        - 119.29.29.29
      proxy-server-nameserver:
        - 223.5.5.5
        - 119.29.29.29
      nameserver:
        - 223.5.5.5
        - 119.29.29.29
      fallback:
        - 1.1.1.1
        - 8.8.8.8
      fallback-filter:
        geoip: true
        geoip-code: CN
    """

    /// Tono resolves through the pinned home route. IP-literal DoH endpoints avoid
    /// a bootstrap DNS query outside Home-US.
    private static let tonoDNS = """
    dns:
      enable: true
      listen: \(ProtectedDNSContract.listener)
      enhanced-mode: fake-ip
      fake-ip-range: 198.18.0.1/16
      use-hosts: true
      respect-rules: true
      proxy-server-nameserver:
        - https://1.1.1.1/dns-query#Tono-Exit
        - https://8.8.8.8/dns-query#Tono-Exit
      nameserver:
        - https://1.1.1.1/dns-query#Tono-Exit
        - https://8.8.8.8/dns-query#Tono-Exit
    """

    /// Default TUN config. Every validated catalog endpoint is excluded from
    /// the TUN route so changing the selector never requires rebuilding the
    /// interface. This does not grant direct egress: PF still permits only the
    /// root-owned core to the exact currently selected IP/port.
    private static func tunYAML(routeExclusions: [String] = []) -> String {
        var yaml = """
        tun:
          enable: true
          stack: gvisor
          device: \(tonoTunInterface)
          auto-route: true
          auto-detect-interface: true
          strict-route: true
          # Mihomo's gVisor ICMP path bypasses normal MATCH rules and otherwise
          # opens a host-direct ICMP socket. PF blocks it, but disable the path
          # at its source so ping can never attempt physical direct egress.
          disable-icmp-forwarding: true
          dns-hijack:
            - any:53
            - tcp://any:53
        """
        if !routeExclusions.isEmpty {
            yaml += "\n  route-exclude-address:\n"
            for address in routeExclusions {
                yaml += "    - \"\(address)/32\"\n"
            }
            yaml.removeLast()
        }
        return yaml
    }

    /// All proxy server hostnames found in the subscription YAML (for fake-ip-filter)
    private static func extractProxyServerHosts(from lines: [String]) -> [String] {
        var hosts: Set<String> = []
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            // Match "server: hostname" in both multi-line and inline formats
            guard let range = trimmed.range(of: "server:") else { continue }
            var value = trimmed[range.upperBound...]
                .trimmingCharacters(in: .whitespaces)
            // Remove trailing comma or brace for inline format
            if let commaIdx = value.firstIndex(of: ",") { value = String(value[..<commaIdx]) }
            if let braceIdx = value.firstIndex(of: "}") { value = String(value[..<braceIdx]) }
            value = value.trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            // Skip IPs and empty values
            if value.isEmpty { continue }
            if value.allSatisfy({ $0.isNumber || $0 == "." || $0 == ":" }) { continue }
            hosts.insert(value)
        }
        return Array(hosts)
    }

    /// All proxy names found in the subscription YAML (for resolving dialer-proxy names)
    private static func extractProxyNames(from lines: [String]) -> [String] {
        var names: [String] = []
        var inProxies = false
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed == "proxies:" { inProxies = true; continue }
            if inProxies && !line.isEmpty && !line.hasPrefix(" ") && !line.hasPrefix("\t") && !trimmed.hasPrefix("-") && !trimmed.hasPrefix("#") {
                inProxies = false
            }
            guard inProxies else { continue }
            // Multi-line format: "- name: xxx"
            if trimmed.hasPrefix("- name:") {
                let name = trimmed.replacingOccurrences(of: "- name:", with: "")
                    .trimmingCharacters(in: .whitespaces)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                if !name.isEmpty { names.append(name) }
            }
            // Inline format: "- {name: xxx, ...}"
            if trimmed.hasPrefix("- {") && trimmed.contains("name:") {
                if let nameStart = trimmed.range(of: "name:") {
                    let afterName = trimmed[nameStart.upperBound...].trimmingCharacters(in: .whitespaces)
                    let nameValue = afterName.prefix(while: { $0 != "," && $0 != "}" })
                        .trimmingCharacters(in: .whitespaces)
                        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                    if !nameValue.isEmpty { names.append(String(nameValue)) }
                }
            }
        }
        return names
    }

    /// Generate runtime.yaml from subscription YAML + overlay config + optional custom nodes.
    @discardableResult
    static func generateRuntime(
        subscriptionYAML: String,
        overlay: OverlayConfig,
        customNodes: [ProxyNode] = [],
        directPolicy: ManagedDirectRuntimePolicy? = nil,
        outputPath: URL
    ) throws -> String {
        // Tono mode: never text-delete sections from subscription YAML. Build a fully owned
        // runtime and import only proxy definitions (no rules/dns/tun/proxy-groups from sub).
        if overlay.tonoTransport != nil || overlay.selectedNodeName != homeNodeName {
            let owned = try buildOwnedTonoRuntime(
                subscriptionYAML: subscriptionYAML,
                overlay: overlay,
                transport: overlay.tonoTransport,
                customNodes: customNodes,
                directPolicy: directPolicy
            )
            return try secureWrite(owned, to: outputPath)
        }

        var lines = subscriptionYAML.components(separatedBy: .newlines)

        // Fields we ALWAYS override (control fields only)
        let forceOverrides: [(key: String, value: String)] = [
            ("port", "0"),
            ("socks-port", "0"),
            ("redir-port", "0"),
            ("mixed-port", "\(overlay.mixedPort)"),
            ("external-controller", "'\(overlay.externalController)'"),
            ("secret", "\"\(yamlScalar(overlay.secret))\""),
            ("allow-lan", "\(overlay.allowLan)"),
            ("mode", overlay.mode),
            ("log-level", overlay.logLevel),
        ]

        // Replace existing top-level keys
        var appliedKeys: Set<String> = []
        for i in lines.indices {
            let line = lines[i]
            guard !line.isEmpty, !line.hasPrefix(" "), !line.hasPrefix("\t"), !line.hasPrefix("#") else { continue }
            for (key, value) in forceOverrides {
                if line.hasPrefix("\(key):") {
                    lines[i] = "\(key): \(value)"
                    appliedKeys.insert(key)
                }
            }
        }

        // Prepend any missing override keys
        var header = "# Tono runtime config\n"
        for (key, value) in forceOverrides where !appliedKeys.contains(key) {
            header += "\(key): \(value)\n"
        }

        // DNS handling: use subscription DNS if present, inject defaults if missing.
        let hasDNS = lines.contains { $0.hasPrefix("dns:") && !$0.hasPrefix(" ") }
        if !hasDNS {
            var dnsConfig = defaultDNS
            let proxyHosts = extractProxyServerHosts(from: lines)
            if !proxyHosts.isEmpty {
                let filterEntries = proxyHosts.map { "    - \"+.\($0)\"" }.joined(separator: "\n")
                dnsConfig += "\n  fake-ip-filter:\n" + filterEntries
            }
            header += "\n" + dnsConfig + "\n"
        } else {
            let proxyHosts = extractProxyServerHosts(from: lines)
            var patches: [String] = []
            let dnsContent = lines.joined(separator: "\n")
            if !dnsContent.contains("default-nameserver") {
                patches.append("  default-nameserver:\n    - 223.5.5.5\n    - 119.29.29.29")
            }
            if !dnsContent.contains("proxy-server-nameserver") {
                patches.append("  proxy-server-nameserver:\n    - 223.5.5.5\n    - 119.29.29.29")
            }
            if !dnsContent.contains("fake-ip-filter") && !proxyHosts.isEmpty {
                let filterEntries = proxyHosts.map { "    - \"+.\($0)\"" }.joined(separator: "\n")
                patches.append("  fake-ip-filter:\n" + filterEntries)
            }
            if !patches.isEmpty, let dnsIdx = lines.firstIndex(where: { $0.hasPrefix("dns:") }) {
                lines.insert(patches.joined(separator: "\n"), at: dnsIdx + 1)
            }
        }

        // Add TUN config if enabled and not present
        if overlay.tunEnabled && !lines.contains(where: { $0.hasPrefix("tun:") && !$0.hasPrefix(" ") }) {
            header += "\n" + tunYAML() + "\n"
        }

        // Inject custom nodes into proxies section and first Selector group
        if !customNodes.isEmpty {
            let proxyNames = extractProxyNames(from: lines)
            let insertion = customNodes.map { nodeToYAML($0, knownNames: proxyNames) }.joined()
            if let proxiesIdx = lines.firstIndex(where: { $0.hasPrefix("proxies:") }) {
                lines.insert(insertion, at: proxiesIdx + 1)
            } else {
                lines.append("proxies:")
                lines.append(insertion)
            }

            // Add custom node names to Selector groups so mihomo can select them
            let customNames = customNodes.map { $0.name }
            let nameEntries = customNames.map { "      - \"\($0)\"" }.joined(separator: "\n")
            if let groupsIdx = lines.firstIndex(where: { $0.hasPrefix("proxy-groups:") }) {
                var i = groupsIdx + 1
                var foundTarget = false
                while i < lines.count {
                    let line = lines[i]
                    if !line.isEmpty && !line.hasPrefix(" ") && !line.hasPrefix("\t") && !line.hasPrefix("-") && !line.hasPrefix("#") {
                        break
                    }
                    // Look for "- name: Proxies" or "- name: PROXY" group
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    if trimmed.contains("name:") && (trimmed.contains("Proxies") || trimmed.contains("PROXY")) {
                        foundTarget = true
                    }
                    // Insert after the "proxies:" line of the target group
                    if foundTarget && trimmed == "proxies:" {
                        lines.insert(nameEntries, at: i + 1)
                        break
                    }
                    i += 1
                }
            }
        }

        let finalYAML = header + "\n" + lines.joined(separator: "\n")
        return try secureWrite(finalYAML, to: outputPath)
    }

    enum TonoInjectionError: LocalizedError {
        case unsafeDescriptor, unsafeOverlay, unsafeNode(String), duplicateNode(String), missingSelection
        var errorDescription: String? {
            switch self {
            case .unsafeDescriptor: return "Tono descriptor must use loopback and a non-zero port."
            case .unsafeOverlay: return "Tono runtime control settings are invalid."
            case .unsafeNode(let name): return "Proxy node \(name) contains unsupported or unsafe fields."
            case .duplicateNode(let name): return "Proxy node name \(name) is duplicated or reserved."
            case .missingSelection: return "The selected proxy node is unavailable."
            }
        }
    }

    /// Fully owned Tono runtime. Imported YAML is never copied into the runtime.
    /// Only validated ProxyNode fields are re-serialized below.
    static func buildOwnedTonoRuntime(
        subscriptionYAML: String,
        overlay: OverlayConfig,
        transport: TonoTransportDescriptor?,
        customNodes: [ProxyNode],
        directPolicy: ManagedDirectRuntimePolicy? = nil
    ) throws -> String {
        if let transport {
            guard transport.host == "127.0.0.1", transport.port != 0 else {
                throw TonoInjectionError.unsafeDescriptor
            }
        }
        let controllerParts = overlay.externalController.split(separator: ":", omittingEmptySubsequences: false)
        guard overlay.mixedPort > 0, overlay.mixedPort <= 65_535,
              controllerParts.count == 2, controllerParts[0] == "127.0.0.1",
              let controllerPort = Int(controllerParts[1]), controllerPort > 0, controllerPort <= 65_535,
              ["debug", "info", "warning", "error", "silent"].contains(overlay.logLevel)
        else {
            throw TonoInjectionError.unsafeOverlay
        }
        _ = subscriptionYAML

        let nodes = try validatedOwnedNodes(customNodes)
        let directPolicy = try validatedManagedDirectPolicy(
            directPolicy,
            excluding: Set(nodes.map(\.server))
        )
        let selected = overlay.selectedNodeName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (selected == homeNodeName && transport != nil) ||
                nodes.contains(where: { $0.name == selected }) else {
            throw TonoInjectionError.missingSelection
        }
        let claudeHomeSocks5 = validatedHomeSocks5(overlay.claudeHomeSocks5)
        let claudeHome = claudeHomeSocks5 == nil
            ? overlay.claudeHomeNodeName
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .flatMap { name in
                    nodes.contains(where: { $0.name == name }) ? name : nil
                }
            : nil
        let preferredDefault = overlay.defaultNodeName
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .flatMap { name in
                nodes.contains(where: { $0.name == name }) ? name : nil
            }

        var proxyBlock = "proxies:\n"
        if let transport {
            proxyBlock += "  - name: \"\(homeNodeName)\"\n    type: socks5\n    server: 127.0.0.1\n    port: \(transport.port)\n    udp: \(transport.udp)\n"
            if let username = transport.username {
                proxyBlock += "    username: \"\(yamlScalar(username))\"\n"
            }
            if let password = transport.password {
                proxyBlock += "    password: \"\(yamlScalar(password))\"\n"
            }
        }
        for node in nodes {
            proxyBlock += try ownedNodeYAML(node)
        }
        if let claudeHomeSocks5 {
            proxyBlock += """
              - name: "\(homeResidentialProxyName)"
                type: socks5
                server: "\(yamlScalar(claudeHomeSocks5.host))"
                port: \(claudeHomeSocks5.port)
                username: "\(yamlScalar(claudeHomeSocks5.username))"
                password: "\(yamlScalar(claudeHomeSocks5.password))"
                dialer-proxy: "\(exitGroupName)"
                udp: false

            """
        }
        if let directPolicy,
           !directPolicy.domainPins.isEmpty
            || !directPolicy.mediaEndpoints.isEmpty
            || !directPolicy.tcpEndpoints.isEmpty
            || !directPolicy.directResolverHosts.isEmpty
            // Suffix routes resolve through this outbound too, so a
            // suffix-only policy must still define it or `nameserver-policy`
            // would reference a proxy that does not exist.
            || !directPolicy.webDomainSuffixes.isEmpty {
            proxyBlock += """
              - name: "\(directProxyName)"
                type: direct
                interface-name: "\(yamlScalar(directPolicy.physicalInterface))"
                ip-version: ipv4-only

            """
        }
        // Referenced by both exact web pins and suffix routes now that the
        // reviewed-bundle port permit lets a root-originated direct dial leave
        // without an exact-address PF entry.
        if let directPolicy,
           !directPolicy.webDomainPins.isEmpty
            || !directPolicy.webDomainSuffixes.isEmpty {
            proxyBlock += """
              - name: "\(webDirectProxyName)"
                type: direct
                interface-name: "\(yamlScalar(directPolicy.physicalInterface))"
                ip-version: ipv4-only

            """
        }

        var choices = (transport == nil ? [] : [homeNodeName]) + nodes.map(\.name)
        if let index = choices.firstIndex(of: selected) {
            choices.remove(at: index)
            choices.insert(selected, at: 0)
        }
        if let preferredDefault, preferredDefault != selected,
           let index = choices.firstIndex(of: preferredDefault) {
            choices.remove(at: index)
            choices.insert(preferredDefault, at: min(1, choices.count))
        }
        let choiceLines = choices.map { "      - \"\(yamlScalar($0))\"" }
            .joined(separator: "\n")

        // IPv6 is a second data plane (TUN, fake-ip6, PF inet6). Leave it
        // off: AAAA dials fail-close at PF and the client retries IPv4.
        var yaml = """
        # Tono owned runtime — imported YAML is parsed, validated, and re-serialized
        port: 0
        socks-port: 0
        redir-port: 0
        mixed-port: \(overlay.mixedPort)
        external-controller: '\(overlay.externalController)'
        secret: "\(yamlScalar(overlay.secret))"
        allow-lan: false
        ipv6: false
        udp: true
        mode: rule
        log-level: \(overlay.logLevel)
        unified-delay: true
        find-process-mode: strict
        profile:
          # Runtime config order is the committed selection. Never let a stale
          # cache.db choice override it after a protected config reload.
          store-selected: false

        """
        if let directPolicy,
           !directPolicy.domainPins.isEmpty
            || !directPolicy.webDomainPins.isEmpty {
            yaml += "hosts:\n"
            for pin in (directPolicy.domainPins + directPolicy.webDomainPins)
                .sorted(by: { $0.host < $1.host }) {
                yaml += "  \"\(yamlScalar(pin.host))\":\n"
                for address in pin.addresses {
                    yaml += "    - \"\(address)\"\n"
                }
            }
            yaml += "\n"
        }
        yaml += tonoDNS + "\n"
        // Emitted on the same condition as the bundle group itself, so the
        // routing decision and the resolver behind it can never disagree.
        let wechatResolverKeys =
            directPolicy != nil && !managedDirectProcessPathRegexes.isEmpty
                ? wechatDirectDNSSuffixes.flatMap { [$0, "+.\($0)"] }
                : []
        if let directPolicy,
           !directPolicy.directResolverHosts.isEmpty
            || !directPolicy.webDomainSuffixes.isEmpty
            || !wechatResolverKeys.isEmpty {
            // Managed-direct hostnames resolve via China DoH through the
            // interface-bound direct outbound so /dns/query returns
            // region-correct answers for pinning. Client-facing answers for
            // already-pinned hosts still come from hosts: (use-hosts wins).
            let upstreams = managedDirectResolverURLs
                .map { "\"\($0)#\(directProxyName)\"" }
                .joined(separator: ", ")
            yaml += "  nameserver-policy:\n"
            var policyKeys: [String] = directPolicy.directResolverHosts
                + wechatResolverKeys
            // A suffix route is only as good as the answer behind it. Resolved
            // through the exit, a China CDN hands back the node nearest the
            // exit, so the "direct" hop would then cross the Pacific twice.
            // These wildcards keep the whole matched subtree resolving through
            // China DoH over the interface-bound direct outbound, which is the
            // same mechanism that kept pinned answers region-correct — and it
            // never needed the pin to work.
            for suffix in directPolicy.webDomainSuffixes {
                policyKeys.append(suffix.host)
                policyKeys.append("+.\(suffix.host)")
            }
            for host in Set(policyKeys).sorted() {
                yaml += "    \"\(yamlScalar(host))\": [\(upstreams)]\n"
            }
        }
        if let directPolicy,
           !directPolicy.domainPins.isEmpty
            || !directPolicy.webDomainPins.isEmpty {
            // WeChat's HTTPDNS hands its helpers raw CDN IPs; without a Host
            // those flows can never match the pinned DOMAIN rules and fall to
            // the exit. Sniff TLS on 443 and override the destination ONLY
            // for the reviewed pinned hosts (force-domain with global
            // override off), which re-routes exactly those dials through the
            // hosts:/PF-bounded pins while every other flow keeps its
            // original metadata and routing.
            yaml += "\nsniffer:\n"
            yaml += "  enable: true\n"
            yaml += "  parse-pure-ip: true\n"
            yaml += "  override-destination: false\n"
            yaml += "  sniff:\n"
            yaml += "    TLS:\n"
            yaml += "      ports: [443]\n"
            yaml += "  force-domain:\n"
            for pin in (directPolicy.domainPins + directPolicy.webDomainPins)
                .sorted(by: { $0.host < $1.host }) {
                yaml += "    - \"\(yamlScalar(pin.host))\"\n"
            }
        }
        if overlay.tunEnabled {
            // Keep the route fingerprint independent of the selected proxy.
            // A selector-only switch can then preserve gVisor/TUN state while
            // PF remains the authoritative, exact endpoint boundary.
            let routeExclusions = Array(Set(nodes.map(\.server))).sorted()
            yaml += "\n" + tunYAML(routeExclusions: routeExclusions) + "\n"
        }
        yaml += "\n" + proxyBlock + "\n"
        yaml += """
        proxy-groups:
          - name: "\(exitGroupName)"
            type: select
            proxies:
        \(choiceLines)

        """
        // The residential hop is a consumer uplink behind NAT and is itself
        // dialed through the protected exit (dialer-proxy), so a stall there
        // used to kill every Claude connection mid-response with nowhere to go:
        // a one-member `select` group has no failover and no health check, and
        // the exit probe only ever tested the exit, never this chained path.
        // Keep the residential hop first so a healthy session is unchanged, and
        // fall back to the protected exit rather than stranding the request.
        // Both members are protected exits, so fail-closed is unaffected —
        // only the egress identity changes while the residential hop is down.
        if claudeHomeSocks5 != nil {
            yaml += """
              - name: "\(claudeHomeGroupName)"
                type: fallback
                proxies:
                  - "\(homeResidentialProxyName)"
                  - "\(exitGroupName)"
                url: "\(claudeHomeHealthURL)"
                interval: \(managedDirectHealthIntervalSeconds)
                timeout: \(managedDirectHealthTimeoutMilliseconds)
                lazy: false

            """
        } else if let claudeHome {
            yaml += """
              - name: "\(claudeHomeGroupName)"
                type: fallback
                proxies:
                  - "\(yamlScalar(claudeHome))"
                  - "\(exitGroupName)"
                url: "\(claudeHomeHealthURL)"
                interval: \(managedDirectHealthIntervalSeconds)
                timeout: \(managedDirectHealthTimeoutMilliseconds)
                lazy: false

            """
        }
        if directPolicy != nil, !managedDirectProcessPathRegexes.isEmpty {
            yaml += """
              - name: "\(appDirectGroupName)"
                type: fallback
                proxies:
                  - "\(directProxyName)"
                  - "\(exitGroupName)"
                url: "\(chinaDirectHealthURL)"
                interval: \(managedDirectHealthIntervalSeconds)
                timeout: \(managedDirectHealthTimeoutMilliseconds)
                lazy: false

            """
        }
        if let directPolicy,
           !directPolicy.webDomainPins.isEmpty
            || !directPolicy.webDomainSuffixes.isEmpty {
            yaml += """
              - name: "\(webDirectGroupName)"
                type: fallback
                proxies:
                  - "\(webDirectProxyName)"
                  - "\(exitGroupName)"
                url: "\(chinaDirectHealthURL)"
                interval: \(managedDirectHealthIntervalSeconds)
                timeout: \(managedDirectHealthTimeoutMilliseconds)
                lazy: false

            """
        }
        yaml += "\nrules:\n"
        // Claude App/Code are permanently protected before every trial
        // exception. The native WeChat rules below additionally require an
        // executable inside the reviewed /Applications/WeChat.app bundle; the
        // separate web rules remain bounded to an exact reviewed hostname and
        // TCP/443. Native WeChat rules emit DOMAIN and separate IP-literal
        // variants, never an impossible DOMAIN+IP-CIDR conjunction. The
        // pinned addresses still bound egress via the hosts: entries
        // (use-hosts resolves the direct dial to exactly those IPs) and the
        // PF session allowlist.
        let hasResidentialHop = claudeHome != nil || claudeHomeSocks5 != nil
        let assistantTarget = hasResidentialHop ? claudeHomeGroupName : exitGroupName
        for process in Self.assistantHomeProcessNames {
            yaml += "  - AND,((NETWORK,TCP),(PROCESS-NAME,\(process))),\(assistantTarget)\n"
        }
        for pathRegex in Self.assistantHomeProcessPathRegexes {
            // Commas and parentheses would break out of the AND payload.
            precondition(
                !pathRegex.contains(",") && !pathRegex.contains("(")
                    && !pathRegex.contains(")"),
                "assistant process path regex unsafe for rule emission"
            )
            yaml += "  - AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,\(pathRegex))),\(assistantTarget)\n"
        }
        // Domain rules exist only to divert assistant traffic onto the
        // residential hop. Without that hop they would be pure noise — MATCH
        // already sends these to the protected exit — and emitting them anyway
        // would put DOMAIN-SUFFIX into a runtime whose direct exceptions are
        // deliberately exact-host only.
        if hasResidentialHop {
            for suffix in Self.assistantHomeDomainSuffixes {
                yaml += "  - AND,((NETWORK,TCP),(DOMAIN-SUFFIX,\(suffix))),\(assistantTarget)\n"
            }
            for cidr in Self.assistantHomeIPv4Cidrs {
                yaml += "  - AND,((NETWORK,TCP),(IP-CIDR,\(cidr),no-resolve)),\(assistantTarget)\n"
            }
        }
        if transport != nil {
            yaml += "  - PROCESS-NAME,tailscaled,DIRECT\n"
            yaml += "  - PROCESS-NAME,tailscale,DIRECT\n"
        }
        if let directPolicy {
            // WeChat resolves its message channel through its own HTTPDNS and
            // dials raw addresses, so the pinned DOMAIN rules below can only
            // ever match its CDN traffic: 84% of observed dials carried no
            // hostname at all, across six different /16 ranges that Tencent
            // rotates. Enumerating addresses cannot converge on that, and every
            // attempt to keep the enumeration fresh reloads the runtime and
            // severs unrelated long-lived connections. Route the whole reviewed
            // bundle direct instead and let the pins below stay as a redundant
            // narrower match. Everything else still reaches `MATCH,Tono-Exit`,
            // so this changes what WeChat does, not what anything else does.
            // Sampled once: the property queries Launch Services, and two
            // loops reading it separately could emit a ruleset that permits a
            // bundle in one direction and not the other if an install landed
            // between them.
            let bundlePathRegexes = managedDirectProcessPathRegexes
            for processPathRegex in bundlePathRegexes {
                // TCP/80 used to be sent to the protected exit here, because
                // five measured direct dials returned no bytes. That
                // measurement was taken on this project's own Mac, whose direct
                // path is a US ISP — a path no customer has. On a customer in
                // China the same rule sends WeChat's main channel on a
                // transpacific round trip, and two audit logs from one such
                // customer show what that costs: 320 of 388 and 217 of 300
                // WeChat connections left through the exit, all of them TCP/80,
                // while the destinations were China Telecom and China Mobile
                // access points (112.65.193.0/24, 221.181.99.0/24,
                // 101.91.37.0/24, 122.188.0.0/16) being reached via Los
                // Angeles. One address was re-dialled 88 times with 63% of the
                // gaps at or under three seconds, 28 of them in the first
                // minute after connecting — the same spinning the rule was
                // written to stop, now caused by it.
                //
                // The original evidence also no longer reproduces on the
                // machine it came from: a TCP/80 dial to the four hottest of
                // those destinations returns 101, 45, 289 and 45 bytes on the
                // direct path, matching the exit path byte for byte. Windows
                // never had this exception — `WECHAT_PROCESS_NAMES` routes the
                // whole bundle direct — so macOS was the outlier.
                //
                // TCP/80 now joins the bundle-wide rule below, which is
                // direct-first with the exit as a fallback member. Accepted
                // limitation, unchanged from before: that group's probe is a
                // cheap HTTP/80 request, so a destination-specific hang keeps
                // the group on direct instead of failing over. If the original
                // symptom returns it will show in the audit log as repeated
                // WeChat :80 dials on `Tono-China-Direct`, and the fix then is a
                // probe that shares the failure mode — not a blanket detour.
                yaml += "  - AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,\(processPathRegex))),\(appDirectGroupName)\n"
                yaml += "  - AND,((NETWORK,UDP),(PROCESS-PATH-REGEX,\(processPathRegex))),\(appDirectGroupName)\n"
            }
            // The exact host/port pins that used to live here are gone. Every
            // one of them carried the same PROCESS-PATH-REGEX as the
            // bundle-wide rule emitted above plus a narrower port, domain or
            // address, and mihomo takes the first matching rule — so no pin
            // could ever fire. They were kept anyway as "a redundant narrower
            // match". Each pin also built its own `fallback` group with
            // `lazy: false`, so at the time they were reachable a Mac
            // health-probed one URL per pinned host/port every interval for
            // rules that could not match, and primed every one of them inside
            // the connect transaction.
            //
            // That cost was already gone before this deletion: 189acf6 stopped
            // carrying `domainPins`, `mediaEndpoints` and `tcpEndpoints` into
            // the runtime policy, so the loops below had nothing to iterate and
            // `managedDirectFallbackTargets` returned empty. What is removed
            // here is the machinery, not the cost — code that could only ever
            // run again by accident.
            //
            // The pinned addresses are still load-bearing, just not as rules:
            // they populate `hosts:` so use-hosts resolves the direct dial to
            // exactly those IPs, and they become `sessionEndpoints` for the PF
            // allowlist. What is gone is a second copy of a routing decision
            // the bundle-wide rule already makes.
            // Browser video acceleration is intentionally narrower than a
            // China/GEOIP bypass: an exact cloud-reviewed host, TCP/443, and
            // no suffix or process fallback. The pinned IPv4 answers still
            // constrain the dial through hosts: and the PF session allowlist.
            // Claude's own process-name rules above still win first.
            for pin in directPolicy.webDomainPins {
                for port in pin.ports {
                    yaml += "  - AND,((NETWORK,TCP),(DST-PORT,\(port)),(DOMAIN,\(pin.host))),\(webDirectGroupName)\n"
                }
            }
            // Suffix routes were withheld for two reasons, and both have been
            // answered rather than waived.
            //
            // The first was PF: a suffix route carries no resolved addresses,
            // so it produced no `sessionEndpoints` and no exact-address permit,
            // and `block drop out quick all` discarded every dial it sent to
            // the interface-bound direct outbound. That is no longer how the
            // ruleset works. The reviewed-bundle permit passes root-originated
            // direct dials on the ports this policy uses, which is why WeChat's
            // HTTPDNS addresses — never pinned, never PF-listed — moved 1.6 MB,
            // 1.3 MB and 1.1 MB directly in a single measured session.
            //
            // The second was failover: a bare `direct` outbound cannot retreat
            // to the tunnel, so an unreachable China path killed the flow. The
            // route now targets a fallback group, which is a class-level answer
            // to a class-level question ("can this machine reach China at all")
            // rather than the per-destination scoring mihomo does not offer.
            //
            // What this does change is the managed-direct invariant: a suffix
            // is a wildcard exception, so every subdomain of a listed host now
            // takes the direct path. That is the point — enumerating exact
            // hosts is what forced the pin refresh whose config reload severed
            // every long-lived connection — but it widens the direct surface,
            // and `MATCH,Tono-Exit` remains the only thing behind it.
            for suffix in directPolicy.webDomainSuffixes {
                for port in suffix.ports {
                    yaml += "  - AND,((NETWORK,TCP),(DST-PORT,\(port)),(DOMAIN-SUFFIX,\(suffix.host))),\(webDirectGroupName)\n"
                    // Without this the browser's QUIC attempt reaches the
                    // global UDP rejection, and every one of these sites pays a
                    // failed handshake before falling back to TCP. The port set
                    // is the same one the TCP route already uses and the same
                    // one the PF permit covers, so this widens the protocol,
                    // not the destination — and the terminal UDP rejection
                    // still stands for everything not listed here.
                    yaml += "  - AND,((NETWORK,UDP),(DST-PORT,\(port)),(DOMAIN-SUFFIX,\(suffix.host))),\(webDirectGroupName)\n"
                }
            }
        }
        yaml += "  - AND,((NETWORK,UDP)),REJECT\n"
        yaml += """
          - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
          - IP-CIDR6,::1/128,DIRECT,no-resolve
          - MATCH,\(exitGroupName)
        """
        return yaml
    }

    static func dialEndpoints(for node: ProxyNode?) throws -> [DialEndpoint] {
        guard let node else { return [] }
        let validated = try validatedOwnedNode(node)
        return [
            .init(host: validated.server, port: UInt16(validated.port), transport: "tcp"),
        ]
    }

    /// Validate the credential-bearing residential upstream without ever
    /// logging its username or password. Invalid optional routing degrades to
    /// the normal full-tunnel runtime instead of rejecting the catalog.
    static func validatedHomeSocks5(
        _ upstream: TonoExitCatalogHomeSocks5?
    ) -> TonoExitCatalogHomeSocks5? {
        guard let upstream,
              let host = try? normalizedHost(upstream.host, field: "homeSocks5 host"),
              !host.contains(":"),
              // `normalizedHost` returns IP literals unscreened. Every other
              // policy-supplied address in this file is public-only; without the
              // same gate here a catalog could point the residential hop at
              // loopback or a LAN address. It is dialed through `dialer-proxy:
              // Tono-Exit` today, so this is defence in depth rather than a live
              // leak — but it is the one address that had no screening at all.
              isPublicHostCandidate(host),
              (1...65_535).contains(upstream.port),
              !upstream.username.isEmpty,
              !upstream.password.isEmpty,
              upstream.username.utf8.count <= 255,
              upstream.password.utf8.count <= 255,
              upstream.username.unicodeScalars.allSatisfy({
                  $0.value >= 0x20 && $0.value != 0x7F
              }),
              upstream.password.unicodeScalars.allSatisfy({
                  $0.value >= 0x20 && $0.value != 0x7F
              })
        else { return nil }
        return TonoExitCatalogHomeSocks5(
            host: host,
            port: upstream.port,
            username: upstream.username,
            password: upstream.password
        )
    }

    static func validatedOwnedNodes(_ nodes: [ProxyNode]) throws -> [ProxyNode] {
        guard nodes.count <= 200 else {
            throw TonoInjectionError.unsafeNode("node list")
        }
        var names = Set([
            homeNodeName,
            exitGroupName,
            claudeHomeGroupName,
            homeResidentialProxyName,
            directProxyName,
            webDirectProxyName,
            webDirectGroupName,
            appDirectGroupName,
            "__tono_tailnet",
            // Mihomo installs these adapters before parsing user proxies. A
            // catalog collision would invalidate the entire owned runtime and
            // can also corrupt the managed WeChat fallback member references.
            "DIRECT",
            "REJECT",
            "REJECT-DROP",
            "COMPATIBLE",
            "PASS",
            "PASS-RULE",
        ])
        var result: [ProxyNode] = []
        for node in nodes {
            let validated = try validatedOwnedNode(node)
            guard !validated.name.hasPrefix(managedDirectFallbackGroupPrefix) else {
                throw TonoInjectionError.duplicateNode(validated.name)
            }
            guard names.insert(validated.name).inserted else {
                throw TonoInjectionError.duplicateNode(validated.name)
            }
            result.append(validated)
        }
        return result
    }

    static func validatedOwnedNode(_ node: ProxyNode) throws -> ProxyNode {
        var value = node
        // Protected multi-exit mode deliberately starts with one audited
        // contract: VLESS over authenticated TLS/Reality and a TCP carrier.
        // Other protocols must not silently widen the root PF allowlist.
        guard node.type == .vless, node.tls == true,
              node.uuid?.isEmpty == false else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.name = try safeScalar(node.name, maximum: 128, field: node.name)
        value.server = try normalizedServerAddress(node.server, field: node.name)
        guard (1...65_535).contains(node.port), node.skipCertVerify != true else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.password = try optionalScalar(node.password, maximum: 1_024, field: node.name)
        value.username = try optionalScalar(node.username, maximum: 256, field: node.name)
        value.uuid = try optionalScalar(node.uuid, maximum: 128, field: node.name)
        value.cipher = try optionalScalar(node.cipher, maximum: 128, field: node.name)
        value.sni = try optionalHost(node.sni, field: node.name)
        value.wsHost = try optionalHost(node.wsHost, field: node.name)
        value.wsPath = try optionalScalar(node.wsPath, maximum: 2_048, field: node.name)
        value.grpcServiceName = try optionalScalar(node.grpcServiceName, maximum: 256, field: node.name)
        value.flow = try optionalScalar(node.flow, maximum: 128, field: node.name)
        value.clientFingerprint = try optionalScalar(node.clientFingerprint, maximum: 64, field: node.name)
        value.realityPublicKey = try optionalScalar(node.realityPublicKey, maximum: 256, field: node.name)
        value.realityShortId = try optionalScalar(node.realityShortId, maximum: 64, field: node.name)
        if let network = node.network?.lowercased(), network != "tcp" {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        value.network = node.network?.lowercased()
        guard let uuid = value.uuid, UUID(uuidString: uuid) != nil else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        // Production is deliberately Reality-only. Plain VLESS-over-TLS must
        // not silently widen the catalog contract or reach Mihomo as a route
        // that has never been covered by the endpoint/fail-closed tests.
        guard let publicKey = value.realityPublicKey,
              publicKey.utf8.count == 43,
              publicKey.unicodeScalars.allSatisfy({
                  $0.isASCII
                      && ($0.properties.isAlphabetic
                          || CharacterSet.decimalDigits.contains($0)
                          || $0 == "-"
                          || $0 == "_")
              }),
              value.sni != nil,
              let shortID = value.realityShortId,
              !shortID.isEmpty,
              shortID.utf8.count <= 16,
              shortID.utf8.count.isMultiple(of: 2),
              shortID.unicodeScalars.allSatisfy({
                  CharacterSet(charactersIn: "0123456789abcdefABCDEF")
                      .contains($0)
              })
        else {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        if let flow = value.flow, flow != "xtls-rprx-vision" {
            throw TonoInjectionError.unsafeNode(node.name)
        }
        return value
    }

    private static func ownedNodeYAML(_ node: ProxyNode) throws -> String {
        let value = try validatedOwnedNode(node)
        var yaml = """
          - name: "\(yamlScalar(value.name))"
            type: \(value.type.rawValue)
            server: "\(yamlScalar(value.server))"
            port: \(value.port)
            udp: \(value.udp)

        """
        func append(_ key: String, _ scalar: String?) {
            guard let scalar, !scalar.isEmpty else { return }
            yaml += "    \(key): \"\(yamlScalar(scalar))\"\n"
        }
        append("username", value.username)
        append("password", value.password)
        append("uuid", value.uuid)
        append("cipher", value.cipher)
        // Mihomo's VLESS schema uses `servername`. Emitting the generic
        // `sni` alias is accepted syntactically but ignored by Reality, which
        // makes the server reject the handshake with `tls: internal error`.
        append("servername", value.sni)
        append("flow", value.flow)
        append("client-fingerprint", value.clientFingerprint)
        if let alterId = value.alterId {
            guard (0...65_535).contains(alterId) else {
                throw TonoInjectionError.unsafeNode(value.name)
            }
            yaml += "    alterId: \(alterId)\n"
        }
        if value.tls == true { yaml += "    tls: true\n" }
        if let network = value.network {
            yaml += "    network: \(network)\n"
            if network == "ws" {
                yaml += "    ws-opts:\n"
                appendIndented("path", value.wsPath, into: &yaml, spaces: 6)
                if let host = value.wsHost {
                    yaml += "      headers:\n"
                    appendIndented("Host", host, into: &yaml, spaces: 8)
                }
            } else if network == "grpc" {
                yaml += "    grpc-opts:\n"
                appendIndented("grpc-service-name", value.grpcServiceName, into: &yaml, spaces: 6)
            }
        }
        if let publicKey = value.realityPublicKey, let shortId = value.realityShortId {
            yaml += "    reality-opts:\n"
            appendIndented("public-key", publicKey, into: &yaml, spaces: 6)
            appendIndented("short-id", shortId, into: &yaml, spaces: 6)
        }
        return yaml
    }

    private static func appendIndented(
        _ key: String,
        _ value: String?,
        into yaml: inout String,
        spaces: Int
    ) {
        guard let value, !value.isEmpty else { return }
        yaml += String(repeating: " ", count: spaces) +
            "\(key): \"\(yamlScalar(value))\"\n"
    }

    private static func safeScalar(
        _ raw: String,
        maximum: Int,
        field: String
    ) throws -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf8.count <= maximum,
              !value.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) else {
            throw TonoInjectionError.unsafeNode(field)
        }
        return value
    }

    private static func optionalScalar(
        _ raw: String?,
        maximum: Int,
        field: String
    ) throws -> String? {
        guard let raw else { return nil }
        return try safeScalar(raw, maximum: maximum, field: field)
    }

    private static func optionalHost(_ raw: String?, field: String) throws -> String? {
        guard let raw else { return nil }
        return try normalizedHost(raw, field: field)
    }

    private static func normalizedServerAddress(_ raw: String, field: String) throws -> String {
        let value = try normalizedHost(raw, field: field)
        var ipv4 = in_addr()
        guard inet_pton(AF_INET, value, &ipv4) == 1,
              isPublicIPv4(ipv4) else {
            // Hostname bootstrap would require a separate authenticated DoH
            // contract. Protected multi-exit mode accepts public IP literals
            // only, rejects private/reserved ranges before import, and
            // currently limits proxy egress to IPv4. SNI/Reality server names
            // remain supported separately.
            throw TonoInjectionError.unsafeNode(field)
        }
        return value
    }

    static func validatedPublicIPv4(_ raw: String, field: String) throws -> String {
        try normalizedServerAddress(raw, field: field)
    }

    /// Hosts that must never be routed direct, whatever a policy says and
    /// whoever signed it.
    ///
    /// A signature relaxes *which hosts may* leave the tunnel. It must never
    /// relax which hosts may not. Folding these in would make one leaked signing
    /// key sufficient to expose this product's own control plane and its users'
    /// assistant traffic — strictly worse than the allowlist a signature
    /// replaces, and the opposite of what signing is for.
    ///
    /// Mirrors `protectedSuffixes` in services/control-plane/src/index.ts. Until
    /// a signature could relax an allowlist these were enforced only implicitly,
    /// by never appearing on one; a trusted path needs them stated.
    static let managedDirectProtectedSuffixes = [
        "anthropic.com", "claude.ai", "tono.app", "tono.com",
    ]

    private static func isProtectedFromDirect(_ host: String) -> Bool {
        managedDirectProtectedSuffixes.contains {
            host == $0 || host.hasSuffix(".\($0)")
        }
    }

    /// `trusted` is set only after an Ed25519 signature over the policy document
    /// has verified against the compiled-in public key. It skips the allowlist
    /// and nothing else: hostname syntax and the protected suffixes above are
    /// still enforced, because a signature attests to authorship, not to the
    /// document being well formed or safe.
    static func validatedManagedDirectDomain(
        _ raw: String,
        trusted: Bool = false
    ) throws -> String {
        let host = try normalizedHost(raw, field: "managed direct domain")
        guard !isProtectedFromDirect(host) else {
            throw TonoInjectionError.unsafeNode("managed direct domain")
        }
        if trusted { return host }
        let allowedSuffixes = [
            "qq.com", "qq.com.cn", "qpic.cn", "qlogo.cn", "gtimg.cn",
            "gtimg.com", "wechat.com", "weixin.com", "weixinbridge.com",
            "wxs.qq.com",
        ]
        guard allowedSuffixes.contains(where: {
            host == $0 || host.hasSuffix(".\($0)")
        }) else {
            throw TonoInjectionError.unsafeNode("managed direct domain")
        }
        return host
    }

    static func validatedWebDirectDomain(
        _ raw: String,
        trusted: Bool = false
    ) throws -> String {
        let host = try normalizedHost(raw, field: "managed web direct domain")
        guard !isProtectedFromDirect(host) else {
            throw TonoInjectionError.unsafeNode("managed web direct domain")
        }
        if trusted { return host }
        let allowedSuffixes = managedWebDirectSuffixAllowlist
        let allowedExactHosts = ["ykimg.alicdn.com"]
        guard allowedExactHosts.contains(host) || allowedSuffixes.contains(where: {
            host == $0 || host.hasSuffix(".\($0)")
        }) else {
            throw TonoInjectionError.unsafeNode("managed web direct domain")
        }
        return host
    }

    /// Validate the exact suffix value used by traffic-policy v3. A host such
    /// as `www.edu.cn` is valid for an exact web pin, but it is not itself an
    /// admitted suffix rule; only `edu.cn` may be emitted here.
    static func validatedManagedDirectSuffix(
        _ raw: String,
        trusted: Bool = false
    ) throws -> String {
        let host = try normalizedHost(raw, field: "managed direct suffix")
        guard !isProtectedFromDirect(host) else {
            throw TonoInjectionError.unsafeNode("managed direct suffix")
        }
        if trusted { return host }
        guard managedWebDirectSuffixAllowlist.contains(host) else {
            throw TonoInjectionError.unsafeNode("managed direct suffix")
        }
        return host
    }

    static func validatedManagedDirectPolicy(
        _ policy: ManagedDirectRuntimePolicy?,
        excluding protectedAddresses: Set<String> = []
    ) throws -> ManagedDirectRuntimePolicy? {
        guard let policy else { return nil }
        let interface = policy.physicalInterface
        guard interface.range(
            of: #"^[a-z][a-z0-9]{0,14}$"#,
            options: .regularExpression
        ) == interface.startIndex..<interface.endIndex,
              interface != "lo0", !interface.hasPrefix("utun") else {
            throw TonoInjectionError.unsafeOverlay
        }
        if policy.isEmpty { return policy }
        let permanentlyProtected = protectedAddresses.union(["1.1.1.1", "8.8.8.8"])
        guard policy.domainPins.count <= 32,
              policy.webDomainPins.count <= 32,
              policy.webDomainSuffixes.count <= 64,
              policy.mediaEndpoints.count <= 128,
              policy.tcpEndpoints.count <= 128,
              policy.sessionEndpoints.count <= 256,
              // Resolver hosts are one entry per managed or web direct policy
              // hostname, so this must admit the control plane's own maxima
              // (32 `domains` + 32 `webDomains`). A lower ceiling silently
              // discarded the entire managed-direct policy — every WeChat and
              // web direct route with it — as soon as the published policy grew
              // past it, leaving only a local audit event behind.
              policy.directResolverHosts.count <= 64 else {
            throw TonoInjectionError.unsafeOverlay
        }
        // Resolver hosts feed nameserver-policy emission; each must be a
        // cloud-reviewed managed or web direct hostname, unique after
        // normalization.
        let resolverHosts = try policy.directResolverHosts.map { raw -> String in
            if let host = try? validatedManagedDirectDomain(
                raw,
                trusted: policy.trusted
            ) { return host }
            return try validatedWebDirectDomain(raw, trusted: policy.trusted)
        }
        guard Set(resolverHosts).count == resolverHosts.count else {
            throw TonoInjectionError.unsafeOverlay
        }

        var seenHosts = Set<String>()
        let pins = try policy.domainPins.map { pin in
            let host = try validatedManagedDirectDomain(
                pin.host,
                trusted: policy.trusted
            )
            guard seenHosts.insert(host).inserted,
                  !pin.addresses.isEmpty, pin.addresses.count <= 8,
                  !pin.ports.isEmpty,
                  Set(pin.ports).count == pin.ports.count,
                  pin.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                throw TonoInjectionError.unsafeNode("managed direct domain")
            }
            let addresses = try pin.addresses.map {
                try validatedPublicIPv4($0, field: "managed direct address")
            }
            guard Set(addresses).count == addresses.count,
                  addresses.allSatisfy({ !permanentlyProtected.contains($0) }) else {
                throw TonoInjectionError.unsafeNode("managed direct address")
            }
            return DirectDomainPin(
                host: host,
                addresses: addresses.sorted(),
                ports: pin.ports.sorted()
            )
        }.sorted { $0.host < $1.host }

        let webPins = try policy.webDomainPins.map { pin in
            let host = try validatedWebDirectDomain(
                pin.host,
                trusted: policy.trusted
            )
            guard seenHosts.insert(host).inserted,
                  !pin.addresses.isEmpty, pin.addresses.count <= 8,
                  pin.ports == [443] else {
                throw TonoInjectionError.unsafeNode("managed web direct domain")
            }
            let addresses = try pin.addresses.map {
                try validatedPublicIPv4($0, field: "managed web direct address")
            }
            guard Set(addresses).count == addresses.count,
                  addresses.allSatisfy({ !permanentlyProtected.contains($0) }) else {
                throw TonoInjectionError.unsafeNode("managed web direct address")
            }
            return DirectDomainPin(
                host: host,
                addresses: addresses.sorted(),
                ports: [443]
            )
        }.sorted { $0.host < $1.host }

        var seenSuffixes = Set<String>()
        let webDomainSuffixes = try policy.webDomainSuffixes.map { suffix in
            let host = try validatedManagedDirectSuffix(
                suffix.host,
                trusted: policy.trusted
            )
            guard host == suffix.host,
                  seenSuffixes.insert(host).inserted,
                  !suffix.ports.isEmpty,
                  Set(suffix.ports).count == suffix.ports.count,
                  suffix.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                throw TonoInjectionError.unsafeNode("managed direct suffix")
            }
            let ports = suffix.ports.sorted()
            return DirectDomainSuffix(host: host, ports: ports)
        }.sorted { $0.host < $1.host }

        let media = try policy.mediaEndpoints.map { endpoint in
            let address = try validatedPublicIPv4(
                endpoint.address,
                field: "managed media address"
            )
            guard !permanentlyProtected.contains(address),
                  endpoint.transport == "udp",
                  endpoint.port == 443 || endpoint.port == 8000 else {
                throw TonoInjectionError.unsafeNode("managed media endpoint")
            }
            return DirectEndpoint(
                address: address,
                port: endpoint.port,
                transport: "udp"
            )
        }
        let uniqueMedia = Array(Set(media)).sorted {
            ($0.port, $0.address) < ($1.port, $1.address)
        }
        let tcp = try policy.tcpEndpoints.map { endpoint in
            let address = try validatedPublicIPv4(
                endpoint.address,
                field: "managed TCP address"
            )
            guard !permanentlyProtected.contains(address),
                  endpoint.transport == "tcp",
                  endpoint.port == 80 || endpoint.port == 443 else {
                throw TonoInjectionError.unsafeNode("managed TCP endpoint")
            }
            return DirectEndpoint(
                address: address,
                port: endpoint.port,
                transport: "tcp"
            )
        }
        let uniqueTCP = Array(Set(tcp)).sorted {
            ($0.port, $0.address) < ($1.port, $1.address)
        }
        return ManagedDirectRuntimePolicy(
            physicalInterface: interface,
            domainPins: pins,
            webDomainPins: webPins,
            webDomainSuffixes: webDomainSuffixes,
            mediaEndpoints: uniqueMedia,
            tcpEndpoints: uniqueTCP,
            directResolverHosts: resolverHosts.sorted(),
            trusted: policy.trusted
        )
    }

    /// True when an already-normalized host is either a DNS name or a public
    /// IPv4 literal. A normalized host that parses as an address but is not
    /// public is rejected; hostnames are resolved later through the protected
    /// resolver and are screened again there.
    private static func isPublicHostCandidate(_ host: String) -> Bool {
        var ipv4 = in_addr()
        if inet_pton(AF_INET, host, &ipv4) == 1 { return isPublicIPv4(ipv4) }
        var ipv6 = in6_addr()
        if inet_pton(AF_INET6, host, &ipv6) == 1 { return false }
        return true
    }

    private static func isPublicIPv4(_ address: in_addr) -> Bool {
        let bytes = withUnsafeBytes(of: address) { Array($0) }
        guard bytes.count == 4 else { return false }
        return bytes[0] != 0 &&
            bytes[0] != 10 &&
            bytes[0] != 127 &&
            !(bytes[0] == 100 && (64...127).contains(bytes[1])) &&
            !(bytes[0] == 169 && bytes[1] == 254) &&
            !(bytes[0] == 172 && (16...31).contains(bytes[1])) &&
            !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 0) &&
            !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 2) &&
            !(bytes[0] == 192 && bytes[1] == 168) &&
            // 6to4 relay anycast. The control plane rejects it too; without
            // this the two sides disagreed about what "public" means.
            !(bytes[0] == 192 && bytes[1] == 88 && bytes[2] == 99) &&
            !(bytes[0] == 198 && (18...19).contains(bytes[1])) &&
            !(bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100) &&
            !(bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113) &&
            bytes[0] < 224
    }

    private static func normalizedHost(_ raw: String, field: String) throws -> String {
        let host = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !host.isEmpty, host.utf8.count <= 253, !host.contains("%"),
              host.unicodeScalars.allSatisfy({ $0.isASCII && $0.value > 0x20 && $0.value < 0x7F }) else {
            throw TonoInjectionError.unsafeNode(field)
        }
        var ipv4 = in_addr()
        var ipv6 = in6_addr()
        if inet_pton(AF_INET, host, &ipv4) == 1 || inet_pton(AF_INET6, host, &ipv6) == 1 {
            return host
        }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.allSatisfy({ label in
            guard !label.isEmpty, label.utf8.count <= 63,
                  label.first != "-", label.last != "-" else { return false }
            return label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        }) else {
            throw TonoInjectionError.unsafeNode(field)
        }
        return host
    }

    /// Extract the `proxies:` sequence body only (list items under proxies).
    static func extractProxiesSection(from lines: [String]) -> String {
        guard let start = lines.firstIndex(where: {
            !$0.hasPrefix(" ") && !$0.hasPrefix("\t") &&
            ($0 == "proxies:" || $0.hasPrefix("proxies:"))
        }) else { return "" }
        var end = start + 1
        while end < lines.count {
            let line = lines[end]
            if !line.isEmpty && !line.hasPrefix(" ") && !line.hasPrefix("\t") && !line.hasPrefix("#") {
                break
            }
            end += 1
        }
        return lines[(start + 1)..<end].joined(separator: "\n")
    }

    /// Pure line transformation retained for unit tests of non-Tono inject paths.
    static func injectTono(_ descriptor: TonoTransportDescriptor, into lines: inout [String], tunEnabled: Bool) throws {
        let owned = try buildOwnedTonoRuntime(
            subscriptionYAML: lines.joined(separator: "\n"),
            overlay: OverlayConfig(tunEnabled: tunEnabled, tonoTransport: descriptor),
            transport: descriptor,
            customNodes: []
        )
        lines = owned.components(separatedBy: .newlines)
    }

    private static func yamlScalar(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n").replacingOccurrences(of: "\r", with: "\\r")
    }

    private static func secureWrite(_ value: String, to outputPath: URL) throws -> String {
        let data = Data(value.utf8)
        try data.write(to: outputPath, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: outputPath.path
        )
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Convert a ProxyNode to mihomo YAML proxy entry.
    ///
    /// Only the legacy (non-owned) runtime path reaches this. Every value here
    /// comes from imported subscription YAML, so all of them are escaped: an
    /// unescaped quote or newline in a node name, password, or relay label
    /// injected arbitrary YAML — including rules — into the generated runtime.
    /// The privileged helper refuses to run a runtime without the owned-config
    /// banner, so this was a latent path rather than a live one.
    private static func nodeToYAML(_ node: ProxyNode, knownNames: [String] = []) -> String {
        var y = "  - name: \"\(yamlScalar(node.name))\"\n"
        y += "    type: \(node.type.rawValue)\n"
        y += "    server: \"\(yamlScalar(node.server))\"\n"
        y += "    port: \(node.port)\n"
        if let user = node.username, !user.isEmpty { y += "    username: \"\(yamlScalar(user))\"\n" }
        if let pw = node.password, !pw.isEmpty { y += "    password: \"\(yamlScalar(pw))\"\n" }
        if let uuid = node.uuid, !uuid.isEmpty { y += "    uuid: \"\(yamlScalar(uuid))\"\n" }
        if let cipher = node.cipher, !cipher.isEmpty { y += "    cipher: \"\(yamlScalar(cipher))\"\n" }
        if let aid = node.alterId { y += "    alterId: \(aid)\n" }
        y += "    udp: \(node.udp)\n"
        if !node.relay.isEmpty && node.relay != "Direct" {
            // Resolve dialer-proxy name: match against actual proxy names in config
            let relay = node.relay
            let resolved = knownNames.first(where: { $0 == relay })  // exact match first
                ?? knownNames.first(where: { relay.contains($0) })   // relay "🇯🇵 Japan | 01" contains config name "Japan | 01"
                ?? knownNames.first(where: { $0.contains(relay) })   // config name contains relay
                ?? relay
            y += "    dialer-proxy: \"\(yamlScalar(resolved))\"\n"
        }
        if let sni = node.sni, !sni.isEmpty {
            let key = node.type == .vless ? "servername" : "sni"
            y += "    \(key): \"\(yamlScalar(sni))\"\n"
        }
        if let scv = node.skipCertVerify, scv { y += "    skip-cert-verify: true\n" }
        if let tls = node.tls, tls { y += "    tls: true\n" }
        if let net = node.network, !net.isEmpty {
            y += "    network: \"\(yamlScalar(net))\"\n"
            if net == "ws" {
                y += "    ws-opts:\n"
                if let path = node.wsPath, !path.isEmpty { y += "      path: \"\(yamlScalar(path))\"\n" }
                if let host = node.wsHost, !host.isEmpty {
                    y += "      headers:\n        Host: \"\(yamlScalar(host))\"\n"
                }
            }
        }
        return y
    }
}
