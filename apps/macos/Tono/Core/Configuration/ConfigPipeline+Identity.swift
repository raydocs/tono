import Foundation
import CryptoKit
import Darwin
import AppKit
import Security

/// Produces runtime.yaml from subscription YAML + minimal overlay.
/// Follows Verge's principle: subscription config is immutable, overlay only control fields.
extension ConfigPipeline {
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
        "feishu.net", "feishuapp.cn", "feishuapp.com", "feishudoc.cn",
        "feishudoc.com", "feishumeetings.cn", "feishumeetings.com",
        "feishuimg.com", "feishukacdn.com", "larkofficecdn.com",
        "larkofficeimg.com", "larkcloud.com", "larkcloud.net",
        "getfeishu.cn", "getfeishu.com", "feishupkg.com", "feishuvc.cn",
        "feishuvc.com", "securityfeishu.cn", "securityfs.cn",
        "statusfeishu.cn",
        "dingtalk.cn", "dingtalk.com", "dingtalk.net", "dingtalkapps.com",
        "dingtalkcloud.com", "dingding.xin", "ztna-dingtalk.com", "ddurl.to",
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
        "edu.cn", "163.com", "netease.com", "126.net",
    ]

    /// Exact host families that may be placed in the application-direct
    /// `domains` field. This is intentionally narrower than the web suffix
    /// list: the caller is asking for a signed desktop application's raw-IP
    /// traffic to leave the tunnel, not for every browser tab under a public
    /// namespace.
    static let managedNativeDirectSuffixAllowlist = [
        "qq.com", "qq.com.cn", "qpic.cn", "qlogo.cn", "gtimg.cn",
        "gtimg.com", "wechat.com", "weixin.com", "weixinbridge.com",
        "wxs.qq.com",
        "feishu.cn", "feishucdn.com", "larksuite.com", "larkoffice.com",
        "feishu.net", "feishuapp.cn", "feishuapp.com", "feishudoc.cn",
        "feishudoc.com", "feishumeetings.cn", "feishumeetings.com",
        "feishuimg.com", "feishukacdn.com", "larkofficecdn.com",
        "larkofficeimg.com", "larkcloud.com", "larkcloud.net",
        "getfeishu.cn", "getfeishu.com", "feishupkg.com", "feishuvc.cn",
        "feishuvc.com", "securityfeishu.cn", "securityfs.cn",
        "statusfeishu.cn",
        // Feishu's official client firewall list also includes these shared
        // ByteDance/Feishu service namespaces. They stay in the native-app
        // list only; putting them in web suffix policy would bypass the
        // process boundary for ordinary browser traffic.
        "zjurl.cn", "snssdk.com", "pstatp.com", "byteimg.com",
        "bytedance.net", "bytedance.com", "byted-static.com",
        "bytegoofy.com", "feishu-3rd-party-services.com", "bytehwm.com",
        "ttwebview.com", "bytegecko.com", "bytescm.com", "kundou.cn",
        "bytetos.com", "zijieapi.com", "byteeffecttos.com", "bytednsdoc.com",
        "bytedanceapi.com", "volcvideo.com", "feelgood.cn", "baseopendev.com",
        "bytedapm.com", "ibytedapm.com", "larkenterprise.com", "aiforce.cloud",
        "aiforce.run",
        "dingtalk.cn", "dingtalk.com", "dingtalk.net", "dingtalkapps.com",
        "dingtalkcloud.com", "dingding.xin", "ztna-dingtalk.com", "ddurl.to",
    ]

    /// IPv4 prefixes, `a.b.c.d/len`, that an unsigned policy may pull out of
    /// the tunnel as a media or TCP endpoint. The address-shaped counterpart of
    /// the two suffix allowlists above, and it exists for the same reason: an
    /// unsigned document has no established author, so what it may carve out is
    /// what this build already agreed to.
    ///
    /// Empty, deliberately. A raw-IP endpoint is the one direct route with no
    /// hostname to review, and the addresses these entries carry are the access
    /// addresses a vendor's own HTTPDNS hands out — rotated per region, which is
    /// why policy publishes them rather than a domain. A prefix compiled in here
    /// would have to be re-released as often as the policy moves. Published
    /// policy is signed, so this list costs production nothing; an unsigned
    /// document asking for a raw-IP direct route is exactly what it refuses.
    static let managedDirectIPv4Allowlist: [String] = []

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
    /// Tencent-wide DNS — no bare `qq.com` here. Product web-direct now
    /// carries `qq.com` as a suffix route (browser + unidentified WeChat
    /// helpers); that list lives on `effectiveWebDomainSuffixes`, not this
    /// WeChat-resolver family list.
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
    /// Ceiling on the exact PF permits one session may carry.
    ///
    /// This is not a preference. The privileged helper independently refuses
    /// more than 256 `sessionDirectEndpoints`, and an installed helper is
    /// replaced only by a `HelperProtocolVersion` bump — so raising this number
    /// alone would produce an arm the daemon rejects, turning a partial loss of
    /// direct routes into a session that cannot connect at all. The two must
    /// move together or not move.
    static let maximumSessionDirectEndpoints = 256

    static let managedDirectResolverEndpoints = [
        DirectEndpoint(address: "223.5.5.5", port: 443, transport: "tcp"),
        DirectEndpoint(address: "223.6.6.6", port: 443, transport: "tcp"),
    ]
    /// WeChat 4.x, DingTalk and Feishu/Lark all perform important work in
    /// helper executables inside their app bundles. Process matching therefore
    /// covers the whole reviewed bundle prefix, not one exact executable path.
    /// The standard install locations are always present; Launch Services adds
    /// a non-standard install only after its bundle identity is checked.
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
    static let reviewedDirectDefaultBundlePaths = [
        "/Applications/WeChat.app/",
        "/Applications/微信.app/",
        "/Applications/DingTalk.app/",
        "/Applications/钉钉.app/",
        "/Applications/Feishu.app/",
        "/Applications/飞书.app/",
        "/Applications/Lark.app/",
    ]

    /// Bundle identifiers seen in macOS distributions. The standard
    /// `/Applications` paths above remain the primary compatibility path; this
    /// list lets a Launch Services-registered relocation work without trusting
    /// an arbitrary process name or path. A relocation is admitted only for
    /// vendors whose signing team has been captured below; otherwise it stays
    /// on the tunnel until a real signed bundle is reviewed.
    static let reviewedDirectBundleIdentifiers = [
        "com.tencent.xinWeChat",
        "com.alibaba.DingTalk",
        "com.alibaba.DingTalkMac",
        "com.alibaba.dingtalk",
        "com.dingtalk.DingTalk",
        "com.dingtalk.DingTalkMac",
        "com.bytedance.feishu",
        "com.bytedance.lark",
        "com.bytedance.Feishu",
        "com.bytedance.Lark",
        "com.larksuite.Feishu",
        "com.larksuite.Lark",
        "com.feishu.Feishu",
    ]

    /// Team identity captured from the official DingTalk macOS distribution.
    /// Feishu/Lark relocations stay fail-closed until a real signed bundle is
    /// inspected on a target Mac; the standard `/Applications` paths remain
    /// supported meanwhile.
    static let reviewedDirectTeamIdentifiers = [
        "com.alibaba.DingTalk": "XN6U3EV979",
        "com.alibaba.DingTalkMac": "XN6U3EV979",
        "com.alibaba.dingtalk": "XN6U3EV979",
        "com.dingtalk.DingTalk": "XN6U3EV979",
        "com.dingtalk.DingTalkMac": "XN6U3EV979",
    ]

    /// WeChat-only paths are kept separate because the audit counters are
    /// deliberately WeChat-specific. Routing uses the broader reviewed list.
    static var wechatProcessBundlePaths: [String] {
        var paths = ["/Applications/WeChat.app/", "/Applications/微信.app/"]
        let discovered = NSWorkspace.shared.urlsForApplications(
            withBundleIdentifier: "com.tencent.xinWeChat"
        )
        for url in discovered + applicationSubfolderBundles(named: ["WeChat.app", "微信.app"]) {
            let path = url.standardizedFileURL.resolvingSymlinksInPath().path + "/"
            guard isRulePayloadSafeBundlePath(path),
                  !paths.contains(path),
                  isSignedWeChatBundle(at: url) else { continue }
            paths.append(path)
        }
        return paths
    }

    static var managedDirectProcessBundlePaths: [String] {
        var paths = reviewedDirectDefaultBundlePaths
        for identifier in reviewedDirectBundleIdentifiers {
            let discovered = NSWorkspace.shared.urlsForApplications(
                withBundleIdentifier: identifier
            )
            for url in discovered {
                let path = url.standardizedFileURL.resolvingSymlinksInPath().path + "/"
                guard isRulePayloadSafeBundlePath(path),
                      !paths.contains(path),
                      isSignedReviewedDirectBundle(at: url, identifier: identifier) else {
                    continue
                }
                paths.append(path)
            }
        }
        for url in applicationSubfolderBundles(named: [
            "WeChat.app", "微信.app",
            "DingTalk.app", "钉钉.app",
            "Feishu.app", "飞书.app",
            "Lark.app",
        ]) {
            let path = url.standardizedFileURL.resolvingSymlinksInPath().path + "/"
            let identifier = Bundle(url: url)?.bundleIdentifier
            guard isRulePayloadSafeBundlePath(path),
                  !paths.contains(path),
                  let identifier,
                  reviewedDirectBundleIdentifiers.contains(identifier),
                  isSignedReviewedDirectBundle(at: url, identifier: identifier) else {
                continue
            }
            paths.append(path)
        }
        return paths
    }

    /// Launch Services sometimes never registers a bundle sitting one folder
    /// under `/Applications`, which is how `/Applications/联系软件/微信.app`
    /// disappeared from PROCESS-PATH-REGEX even though the signature was valid.
    /// Scan that single extra directory level; deeper trees stay fail-closed.
    static func applicationSubfolderBundles(
        named names: [String],
        under root: URL = URL(fileURLWithPath: "/Applications", isDirectory: true)
    ) -> [URL] {
        let fileManager = FileManager.default
        guard let folders = try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }
        var found: [URL] = []
        for folder in folders {
            guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
                  folder.pathExtension.lowercased() != "app" else { continue }
            for name in names {
                let candidate = folder.appendingPathComponent(name, isDirectory: true)
                var isDirectory: ObjCBool = false
                guard fileManager.fileExists(atPath: candidate.path, isDirectory: &isDirectory),
                      isDirectory.boolValue else { continue }
                found.append(candidate)
            }
        }
        return found
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

    static func isSignedWeChatBundle(at url: URL) -> Bool {
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

    /// Relocated office bundles get an Apple-anchored signature and an exact
    /// known bundle identifier. We do not grant arbitrary paths by basename;
    /// if a vendor changes its identifier, the path is omitted and traffic
    /// safely remains on the tunnel until the allowlist is updated.
    static func isSignedReviewedDirectBundle(
        at url: URL,
        identifier: String
    ) -> Bool {
        if identifier == "com.tencent.xinWeChat" {
            return isSignedWeChatBundle(at: url)
        }
        guard reviewedDirectBundleIdentifiers.contains(identifier),
              identifier.range(
                  of: #"^[A-Za-z0-9.-]+$"#,
                  options: .regularExpression
              ) != nil,
              let team = reviewedDirectTeamIdentifiers[identifier] else {
            return false
        }
        let requirementText =
            #"anchor apple generic and identifier "# + identifier
            + #""" and certificate leaf[subject.OU] = ""# + team + #"""#
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

    /// Keep as many resolved pins as the session-endpoint budget allows, and
    /// name the hosts that did not fit.
    ///
    /// `validatedManagedDirectPolicy` refuses a policy over
    /// `maximumSessionDirectEndpoints`, and refusal is all-or-nothing: the
    /// caller catches it and runs the session with no pins at all. That is the
    /// wrong shape for a ceiling the control plane can reach on its own —
    /// 32 `webDomains`, its published maximum, resolve to as many as 32 × 8
    /// addresses, which with the two China DoH resolver endpoints is 258. The
    /// comment on `directResolverHosts` above records this exact failure
    /// happening once already, discovered only after it had discarded every
    /// managed-direct route in the field.
    ///
    /// Counting is incremental and deduplicated, exactly as `sessionEndpoints`
    /// counts, so CDN hosts that share addresses cost nothing extra and no pin
    /// is dropped that would have fitted. Order decides who survives, so the
    /// caller must pass a stable one.
}
