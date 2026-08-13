import Foundation

/// Pure, on-device attribution for aggregated routing research. Only values from
/// these fixed vocabularies can cross into the persisted aggregate or wire
/// snapshot. Raw process names and paths never leave this classifier.
nonisolated enum AppRoutingResearchClassifier {
    static let families = Set([
        "wechat", "qq", "feishu", "lark", "dingtalk", "trae", "chrome",
        "edge", "safari", "firefox", "arc", "brave", "claude", "wecom",
        "tencent_meeting", "wps", "baidu_netdisk", "alipan", "douyin",
        "bilibili", "netease_music", "qq_music", "xunlei", "jianying",
        "youdao", "awesun", "other",
    ])

    static let componentFamilies = Set([
        "wechat", "qq", "feishu", "lark", "dingtalk", "wecom",
        "tencent_meeting", "wps", "baidu_netdisk", "alipan", "douyin",
        "bilibili", "netease_music", "qq_music", "xunlei", "jianying",
        "youdao", "awesun",
    ])

    static let bundleComponents = Set([
        "main_executable", "framework_helper", "xpc_service",
        "plugin_helper", "bundle_helper",
    ])

    /// App roots are exact, reviewed tokens. Several China-market apps use a
    /// localized bundle name, but even those inputs map only to a fixed family.
    private static let bundleRoots: [String: Set<String>] = [
        "wechat": ["wechat", "weixin"],
        "qq": ["qq"],
        "feishu": ["feishu"],
        "lark": ["lark"],
        "dingtalk": ["dingtalk"],
        "wecom": ["企业微信"],
        "tencent_meeting": ["voov meeting", "tencentmeeting"],
        "wps": ["wpsoffice"],
        "baidu_netdisk": ["baidunetdisk_mac"],
        "alipan": ["adrive"],
        "douyin": ["抖音"],
        "bilibili": ["哔哩哔哩"],
        "netease_music": ["neteasemusic"],
        "qq_music": ["qqmusic"],
        "xunlei": ["thunder"],
        "jianying": ["videofusion-macos"],
        "youdao": ["网易有道翻译"],
        "awesun": ["awesun"],
        "trae": ["trae"],
        "chrome": ["google chrome"],
        "edge": ["microsoft edge"],
        "safari": ["safari"],
        "firefox": ["firefox"],
        "arc": ["arc"],
        "brave": ["brave browser"],
        "claude": ["claude"],
    ]

    /// Exact process-name fallback is intentionally narrower than bundle-path
    /// attribution. Helpers in a reviewed app bundle are classified from their
    /// structural path; arbitrary prefix matches must remain `other`.
    private static let processNames: [String: Set<String>] = [
        "wechat": [
            "wechat", "weixin", "wechatappex", "wechat helper",
            "wechathelper", "wechat networkservice", "wxplayer", "wxocr",
        ],
        "qq": ["qq", "qq helper"],
        "feishu": ["feishu"],
        "lark": ["lark"],
        "dingtalk": ["dingtalk"],
        "wecom": ["企业微信", "wecom", "wxwork"],
        "tencent_meeting": [
            "voov meeting", "tencentmeeting", "wemeet", "wemeetapp",
        ],
        "wps": ["wpsoffice", "wps office"],
        "baidu_netdisk": ["baidunetdisk", "baidunetdisk_mac"],
        "alipan": ["adrive", "aliyundrive"],
        "douyin": ["抖音", "douyin"],
        "bilibili": ["哔哩哔哩", "bilibili"],
        "netease_music": ["neteasemusic"],
        "qq_music": ["qqmusic"],
        "xunlei": ["thunder"],
        "jianying": ["videofusion", "videofusion-macos", "jianying"],
        "youdao": ["网易有道翻译", "youdaodict"],
        "awesun": ["awesun"],
        "trae": ["trae"],
        "chrome": ["google chrome"],
        "edge": ["microsoft edge"],
        "safari": ["safari"],
        "firefox": ["firefox"],
        "arc": ["arc"],
        "brave": ["brave browser"],
        "claude": ["claude", "claude.exe", "claude helper"],
    ]

    private struct StandardBundlePath {
        let root: String
        let relative: [String]
    }

    /// Iterated in sorted order, not in `Set` order. Attribution must be a
    /// function of the input alone: `Set` iteration order varies between launches
    /// (it depends on the seeded hash), so the moment any token appears under two
    /// families the same connection would be attributed differently from run to
    /// run and the aggregates would disagree with themselves. No token overlaps
    /// today; this makes that a correctness property instead of a coincidence.
    private static let orderedFamilies = families.filter { $0 != "other" }.sorted()

    static func family(process: String?, path: String?) -> String {
        let bundleRoot = standardBundlePath(path)?.root
        if let bundleRoot {
            for family in orderedFamilies {
                if bundleRoots[family]?.contains(bundleRoot) == true {
                    return family
                }
            }
        }
        // Official Claude Code installers do not live under /Applications.
        // The versioned launcher is named `2.1.223`, so process-name fallback
        // cannot recover it.
        if let path {
            let lower = path.lowercased()
            if lower.contains("/.local/share/claude/versions/")
                || lower.contains("/node_modules/@anthropic-ai/claude-code/")
                || lower.contains("/claude.app/") {
                return "claude"
            }
        }

        let processName = (process ?? "").lowercased()
        guard !processName.isEmpty else { return "other" }
        for family in orderedFamilies {
            if processNames[family]?.contains(processName) == true {
                return family
            }
        }
        return "other"
    }

    /// Converts only exact reviewed native-app paths under the standard
    /// system-wide Applications directory into a fixed low-cardinality token.
    /// Executable names, path text, usernames and custom install roots are never
    /// returned and cannot enter the wire model.
    static func bundleComponent(for app: String, processPath: String?) -> String? {
        guard componentFamilies.contains(app),
              let path = standardBundlePath(processPath),
              bundleRoots[app]?.contains(path.root) == true,
              let directory = path.relative.first else { return nil }

        switch directory {
        case "frameworks":
            return "framework_helper"
        case "xpcservices":
            return "xpc_service"
        case "plugins":
            return "plugin_helper"
        case "helpers":
            return "bundle_helper"
        case "library" where path.relative.dropFirst().first == "loginitems":
            return "bundle_helper"
        case "macos":
            guard path.relative.count == 2 else { return "bundle_helper" }
            return path.relative[1] == path.root
                ? "main_executable"
                : "bundle_helper"
        default:
            return nil
        }
    }

    private static func standardBundlePath(_ processPath: String?)
        -> StandardBundlePath? {
        guard let path = processPath,
              path.utf8.count >= 20, path.utf8.count <= 1_024,
              path.hasPrefix("/"), !path.contains("\\"),
              !path.contains("//"),
              path.unicodeScalars.allSatisfy({
                  $0.value >= 0x20 && $0.value != 0x7F
              }) else { return nil }
        let components = path.split(
            separator: "/",
            omittingEmptySubsequences: false
        )
        guard components.first?.isEmpty == true,
              components.dropFirst().allSatisfy({
                  !$0.isEmpty && $0 != "." && $0 != ".."
              }), components.count >= 6,
              components[1].lowercased() == "applications",
              components[3].lowercased() == "contents" else { return nil }

        let bundle = components[2].lowercased()
        guard bundle.hasSuffix(".app") else { return nil }
        let root = String(bundle.dropLast(".app".count))
        guard !root.isEmpty else { return nil }
        return StandardBundlePath(
            root: root,
            relative: components.dropFirst(4).map { $0.lowercased() }
        )
    }
}
