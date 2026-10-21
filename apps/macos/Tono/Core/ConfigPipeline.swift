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
        var mixedPort: Int = 28990
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
        /// "Allow local network devices" (D7). Off, the default, rejects the
        /// local ranges in the Core. Callers pass one snapshot of
        /// `LocalNetworkDevicesSync.desired`: the value and the generation it
        /// belongs to, so an installed document records what it applied.
        var allowLocalNetworkDevices: Bool = false
        var localNetworkDevicesGeneration: UInt64 = 0
    }

    struct DialEndpoint: Hashable, Equatable, Sendable {
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

        /// Whether this suffix already routes the pinned host direct on every
        /// port the pin names. Only then is the pin a redundant narrower match.
        func covers(_ pin: DirectDomainPin) -> Bool {
            let suffix = host.lowercased()
            let name = pin.host.lowercased()
            return (name == suffix || name.hasSuffix("." + suffix))
                && Set(pin.ports).isSubset(of: Set(ports))
        }
    }

    struct ManagedDirectRuntimePolicy: Equatable, Sendable {
        let physicalInterface: String
        let domainPins: [DirectDomainPin]
        let webDomainPins: [DirectDomainPin]
        let webDomainSuffixes: [DirectDomainSuffix]
        let mediaEndpoints: [DirectEndpoint]
        /// Exact reviewed TCP IP endpoints used by native-app HTTPDNS.
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
        /// Whether this policy contains the native-app direct surface. Web-only
        /// policies may still use exact/suffix web routes, but must not arm the
        /// address-free reviewed-bundle port permit or route office processes.
        let nativeAppDirect: Bool

        init(
            physicalInterface: String,
            domainPins: [DirectDomainPin],
            webDomainPins: [DirectDomainPin] = [],
            webDomainSuffixes: [DirectDomainSuffix] = [],
            mediaEndpoints: [DirectEndpoint],
            tcpEndpoints: [DirectEndpoint] = [],
            directResolverHosts: [String] = [],
            trusted: Bool = false,
            nativeAppDirect: Bool = true
        ) {
            self.physicalInterface = physicalInterface
            self.domainPins = domainPins
            self.webDomainPins = webDomainPins
            self.webDomainSuffixes = webDomainSuffixes
            self.mediaEndpoints = mediaEndpoints
            self.tcpEndpoints = tcpEndpoints
            self.directResolverHosts = directResolverHosts
            self.trusted = trusted
            self.nativeAppDirect = nativeAppDirect
        }

        /// PF has no hostname-aware rule. A suffix route therefore needs the
        /// bounded root-originated port permit even when this policy contains
        /// no native-app surface. Exact web pins use session endpoints and do
        /// not need this wider permit.
        /// Product web-direct suffixes, always on when a managed-direct plan
        /// exists: unidentified helpers and browsers hit these trees.
        static let productWebDirectSuffixes: [DirectDomainSuffix] = [
            DirectDomainSuffix(host: "qq.com", ports: [80, 443]),
            DirectDomainSuffix(host: "baidu.com", ports: [80, 443]),
            DirectDomainSuffix(host: "aliyuncs.com", ports: [80, 443]),
            DirectDomainSuffix(host: "edu.cn", ports: [80, 443]),
            DirectDomainSuffix(host: "weixinbridge.com", ports: [80, 443]),
            DirectDomainSuffix(host: "bilibili.com", ports: [80, 443]),
            DirectDomainSuffix(host: "taobao.com", ports: [80, 443]),
            DirectDomainSuffix(host: "tmall.com", ports: [80, 443]),
            DirectDomainSuffix(host: "alipay.com", ports: [80, 443]),
            DirectDomainSuffix(host: "alicdn.com", ports: [80, 443]),
            DirectDomainSuffix(host: "jd.com", ports: [80, 443]),
            DirectDomainSuffix(host: "douyin.com", ports: [80, 443]),
            DirectDomainSuffix(host: "163.com", ports: [80, 443]),
            DirectDomainSuffix(host: "netease.com", ports: [80, 443]),
            DirectDomainSuffix(host: "weibo.com", ports: [80, 443]),
            DirectDomainSuffix(host: "meituan.com", ports: [80, 443]),
            DirectDomainSuffix(host: "dianping.com", ports: [80, 443]),
            DirectDomainSuffix(host: "pinduoduo.com", ports: [80, 443]),
            DirectDomainSuffix(host: "amap.com", ports: [80, 443]),
            DirectDomainSuffix(host: "douyu.com", ports: [80, 443]),
            DirectDomainSuffix(host: "huya.com", ports: [80, 443]),
            DirectDomainSuffix(host: "kuaishou.com", ports: [80, 443]),
            DirectDomainSuffix(host: "yy.com", ports: [80, 443]),
            DirectDomainSuffix(host: "ixigua.com", ports: [80, 443]),
            DirectDomainSuffix(host: "iqiyi.com", ports: [80, 443]),
            DirectDomainSuffix(host: "youku.com", ports: [80, 443]),
            DirectDomainSuffix(host: "mgtv.com", ports: [80, 443]),
            DirectDomainSuffix(host: "xiaohongshu.com", ports: [80, 443]),
            DirectDomainSuffix(host: "wps.cn", ports: [80, 443]),
            DirectDomainSuffix(host: "kdocs.cn", ports: [80, 443]),
            DirectDomainSuffix(host: "yuque.com", ports: [80, 443]),
            DirectDomainSuffix(host: "voovmeeting.com", ports: [80, 443]),
            DirectDomainSuffix(host: "12306.cn", ports: [80, 443]),
            DirectDomainSuffix(host: "kugou.com", ports: [80, 443]),
            DirectDomainSuffix(host: "kuwo.cn", ports: [80, 443]),
            DirectDomainSuffix(host: "migu.cn", ports: [80, 443]),
            DirectDomainSuffix(host: "ximalaya.com", ports: [80, 443]),
            DirectDomainSuffix(host: "qingting.fm", ports: [80, 443]),
            DirectDomainSuffix(host: "xylink.com", ports: [80, 443]),
            DirectDomainSuffix(host: "zhumu.me", ports: [80, 443]),
            DirectDomainSuffix(host: "quanshi.com", ports: [80, 443]),
            DirectDomainSuffix(host: "zhihu.com", ports: [80, 443]),
            DirectDomainSuffix(host: "zhimg.com", ports: [80, 443]),
            DirectDomainSuffix(host: "goofish.com", ports: [80, 443]),
            DirectDomainSuffix(host: "1688.com", ports: [80, 443]),
            DirectDomainSuffix(host: "10086.cn", ports: [80, 443]),
            DirectDomainSuffix(host: "cmecloud.cn", ports: [80, 443]),
            DirectDomainSuffix(host: "miit.gov.cn", ports: [80, 443]),
        ]

        var effectiveWebDomainSuffixes: [DirectDomainSuffix] {
            var suffixes = webDomainSuffixes
            for extra in Self.productWebDirectSuffixes {
                if !suffixes.contains(where: { $0.host == extra.host }) {
                    suffixes.append(extra)
                }
            }
            return suffixes.sorted { $0.host < $1.host }
        }

        /// Web pins the runtime still resolves and dials from their pinned
        /// addresses. A pin that a policy suffix already covers is left out of
        /// the runtime: the suffix rule resolves it through the China DNS at
        /// dial time, so a retired CDN address cannot strand the host, and the
        /// pin needs no refresh (a refresh reloads the whole session). Without
        /// policy suffixes every web pin stays.
        var staticWebDomainPins: [DirectDomainPin] {
            webDomainPins.filter { pin in
                !webDomainSuffixes.contains { $0.covers(pin) }
            }
        }

        /// Whether a pin still decides a dial, so that its refresh is worth the
        /// session reload it costs. Pins are the only route for a policy with no
        /// suffix rules; with them, only a pin no suffix covers is.
        var pinsAreLoadBearing: Bool {
            webDomainSuffixes.isEmpty || !staticWebDomainPins.isEmpty
        }

        var requiresAddressFreeDirectPermit: Bool {
            nativeAppDirect || !effectiveWebDomainSuffixes.isEmpty
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
    /// Link-local and multicast must not hit the global UDP reject or MATCH
    /// exit. These prefixes cannot reach the public internet.
    static let appleContinuityDirectRules = """
      - IP-CIDR,224.0.0.0/4,DIRECT,no-resolve
      - IP-CIDR,169.254.0.0/16,DIRECT,no-resolve
      - IP-CIDR6,ff00::/8,DIRECT,no-resolve
      - IP-CIDR6,fe80::/10,DIRECT,no-resolve
      - AND,((NETWORK,UDP),(DST-PORT,5353)),DIRECT

    """
    /// Prefixes Darwin `auto_route` must not install via utun. sing-tun's
    /// Darwin table is `1.0.0.0/8` … `128.0.0.0/1`; anything in that span that
    /// is missing here is delivered to the TUN. A later DIRECT rule cannot
    /// turn a captured limited broadcast or multicast packet back into a
    /// link transmission. Loopback is not listed: `lo0`'s connected route is
    /// more specific than those aggregates. Carrier NAT (`100.64.0.0/10`) is
    /// not listed: excluding the whole block would send off-link carrier
    /// addresses out the physical interface. This list is static. PF is not
    /// taught new prefixes here; a dynamic on-link allow is a ruleset change
    /// that has to be proven on a Mac before it may arm.
    static let tunRouteExcludeCIDRs = [
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
        "224.0.0.0/4",
        "255.255.255.255/32",
        "fe80::/10",
        "fc00::/7",
        "ff00::/8",
    ]
    static let claudeHomeGroupName = "Tono-Claude-Home"
    static let homeResidentialProxyName = "Tono-Home-Residential"
    static let directProxyName = "Tono-China-Direct"
    static let webDirectProxyName = "Tono-China-Web-Direct"
    /// Wraps the interface-bound web direct outbound so a China path that is
    /// unreachable from where the user actually sits degrades to the tunnel
    /// instead of killing the flow. A bare `direct` outbound has no failover;
    /// the probe is class-level, not per destination — mihomo scores fallback
    /// members by URL — which answers "can this machine reach China directly
    /// at all", the question that actually distinguishes the two members.
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

    /// Dedicated Model Studio APIs within the otherwise DIRECT Alibaba tree.
    /// Regional, coding, workspace, trial and token-plan hosts are descendants.
    /// Generated with the Home/video arrays below from direct_domains.rs;
    /// edit that source, then run tooling/scripts/sync-routing-domains.mjs --write.
    static let dedicatedModelAPISuffixes = [
        "dashscope.aliyuncs.com",
        "dashscope-intl.aliyuncs.com",
        "dashscope-us.aliyuncs.com",
        "maas.aliyuncs.com",
    ]

    /// Owner-selected residential destinations, before every DIRECT rule.
    /// Google/GitHub and Reddit/TikTok (including video) deliberately share
    /// the assigned Home identity. Cloud video exceptions precede this list
    /// and process fallbacks, including YouTube children of googleapis.com.
    /// Shared CDN/ByteDance parents, x.com and gstatic.com remain excluded;
    /// gstatic is also the independent cloud-path probe.
    static let assistantHomeDomainSuffixes = dedicatedModelAPISuffixes + [
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
        "servd-anthropic-website.b-cdn.net",
        "challenges.cloudflare.com",
        "cf-assets.www.cloudflare.com",
        "cloudflareinsights.com",
        "browser-intake-datadoghq.com",
        "browser-intake-us5-datadoghq.com",
        "browser-intake-us3-datadoghq.com",
        "browser-intake-ap1-datadoghq.com",
        "browser-intake-ap2-datadoghq.com",
        "browser-intake-datadoghq.eu",
        "browser-intake-ddog-gov.com",
        "datadoghq.com",
        "statsig.com",
        "statsigapi.net",
        "featuregates.org",
        "growthbook.io",
        "cdn.usefathom.com",
        "stripe.com",
        "stripecdn.com",
        "link.com",
        "hcaptcha.com",
        "stripe.network",
        "storage.googleapis.com",
        "registry.npmjs.org",
        "raw.githubusercontent.com",
        "formulae.brew.sh",
        "sentry.io",
        "chatgpt.com",
        "openai.com",
        "chat.com",
        "ai.com",
        "oaistatic.com",
        "oaiusercontent.com",
        "sora.com",
        "grok.com",
        "grok.x.com",
        "grokipedia.com",
        "x.ai",
        "perplexity.ai",
        "perplexity.com",
        "pplx.ai",
        "gemini.google.com",
        "bard.google.com",
        "aistudio.google.com",
        "generativelanguage.googleapis.com",
        "notebooklm.google.com",
        "ai.google.dev",
        "gemini.google",
        "deepmind.com",
        "deepmind.google",
        "notebooklm.google",
        "antigravity.google",
        "generativeai.google",
        "makersuite.google.com",
        "jules.google.com",
        "antigravity-unleash.goog",
        "aida.googleapis.com",
        "geller-pa.googleapis.com",
        "aisandbox-pa.googleapis.com",
        "cloudcode-pa.googleapis.com",
        "robinfrontend-pa.googleapis.com",
        "alkalicore-pa.clients6.google.com",
        "daily-cloudcode-pa.googleapis.com",
        "proactivebackend-pa.googleapis.com",
        "alkalimakersuite-pa.clients6.google.com",
        "g.ai",
        "dify.ai",
        "poe.com",
        "groq.com",
        "cursor.sh",
        "ampcode.com",
        "jasper.ai",
        "openart.ai",
        "clipdrop.co",
        "chatgpt.site",
        "openrouter.ai",
        "api.github.com",
        "api.jetbrains.ai",
        "gateway.ai.cloudflare.com",
        "muse.ai",
        "meta.ai",
        "muse.meta.com",
        "www.muse.ai",
        "meta.com",
        "facebook.com",
        "fb.com",
        "fb.me",
        "fb.watch",
        "fbcdn.net",
        "facebook.net",
        "messenger.com",
        "instagram.com",
        "cdninstagram.com",
        "ig.me",
        "threads.net",
        "gmail.com",
        "mail.google.com",
        "googlemail.com",
        "inbox.google.com",
        "accounts.google.com",
        "myaccount.google.com",
        "oauth2.googleapis.com",
        "mail-pa.clients6.google.com",
        "gmail.googleapis.com",
        "google.com",
        "googleapis.com",
        "github.com",
        "githubusercontent.com",
        "githubassets.com",
        "redd.it",
        "reddit.app.link",
        "reddit.com",
        "redditblog.com",
        "reddithelp.com",
        "redditinc.com",
        "redditmail.com",
        "redditmedia.com",
        "redditspace.com",
        "redditstatic.com",
        "redditstatus.com",
        "reddit.map.fastly.net",
        "muscdn.com",
        "musical.ly",
        "tik-tokapi.com",
        "tiktok-minis.com",
        "tiktok-row.net",
        "tiktok.com",
        "tiktokcdn-eu.com",
        "tiktokcdn-us.com",
        "tiktokcdn.com",
        "tiktokd.net",
        "tiktokd.org",
        "tiktokeu-cdn.com",
        "tiktokglobalshopv.com",
        "tiktokminis.us",
        "tiktokrow-cdn.com",
        "tiktokv.com",
        "tiktokv.eu",
        "tiktokv.us",
        "tiktokw.eu",
        "tiktokw.us",
        "ttcdn-us.com",
        "ttlivecdn.com",
        "ttoverseaus.net",
        "ttwstatic.com",
        "tiktokcdn-us.com.edgesuite.net",
        "tiktokcdn.com.akamaized.net",
        "tiktokcdn.com.edgesuite.net",
        "tiktokv.com.edgekey.net",
        "tiktokv.com.edgesuite.net",
        "p16-tiktokcdn-com.akamaized.net",
        "p16-tiktok-dm-sticker-sign-sg.ibyteimg.com",
    ]

    /// Cloud-only video sites/media/APIs, even inside a Home-pinned process.
    /// TCP pins plus UDP rejection avoid a SOCKS/Reality UDP DIRECT fallback.
    static let cloudVideoDomainSuffixes = [
        "youtube.com",
        "youtube-nocookie.com",
        "youtu.be",
        "googlevideo.com",
        "ytimg.com",
        "youtube.googleapis.com",
        "youtubei.googleapis.com",
        "youtubeembeddedplayer.googleapis.com",
        "youtube-ui.l.google.com",
        "wide-youtube.l.google.com",
        "yt3.googleusercontent.com",
        "ggpht.com",
        "pornhub.com",
        "pornhub.org",
        "pornhubpremium.com",
        "phncdn.com",
        "phprcdn.com",
        "porngub.com",
        "pornhub-deutsch.net",
        "pornhubapparel.com",
        "gaytube.com",
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
        // Editors that host Claude/Codex/ChatGPT. A Cursor or VS Code process
        // talking to Anthropic must share the residential hop when one is
        // bound; without a hop these rows still target Tono-Exit, same as MATCH.
        // Helper names with parentheses are covered by the bundle path regexes.
        "Cursor",
        "Cursor Helper",
        "Cursor.exe",
        "Code",
        "Code Helper",
        "Code.exe",
        "Windsurf",
        "Windsurf Helper",
        "Windsurf.exe",
        "Trae",
        "Trae Helper",
        "Trae.exe",
        "Zed",
        "Zed.exe",
        "VSCodium",
        "VSCodium.exe",
        "Grok",
        "grok",
        "grok.exe",
        "Grok Helper",
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
        "/\\.pnpm/@anthropic-ai\\+claude-code",
        "/\\.local/bin/claude",
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
        "/Claude\\.app/",
        "/ChatGPT\\.app/",
        "/\\.local/share/codex/",
        "/node_modules/@openai/codex/",
        "/Cursor\\.app/",
        "/Visual Studio Code\\.app/",
        "/Windsurf\\.app/",
        "/Trae\\.app/",
        "/Zed\\.app/",
        "/VSCodium\\.app/",
        "/Grok\\.app/",
    ]

    /// Claude Code's versioned launcher is named `2.1.223`, not `claude`.
}
