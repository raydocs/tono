import Foundation

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

@main
private struct AppRoutingResearchClassifierTests {
    static func main() throws {
        let positiveFamilies: [(String?, String?, String)] = [
            (
                "not-a-reviewed-helper",
                "/Applications/WeChat.app/Contents/Frameworks/WeChatAppEx.framework/Helpers/WeChatAppEx",
                "wechat"
            ),
            (
                nil,
                "/Applications/企业微信.app/Contents/Frameworks/Helper.framework/Helpers/Helper",
                "wecom"
            ),
            (
                nil,
                "/Applications/VooV Meeting.app/Contents/MacOS/VooV Meeting",
                "tencent_meeting"
            ),
            (
                nil,
                "/Applications/BaiduNetdisk_mac.app/Contents/MacOS/BaiduNetdisk_mac",
                "baidu_netdisk"
            ),
            ("NeteaseMusic", nil, "netease_music"),
            ("claude", nil, "claude"),
            (
                "2.1.225",
                "/Users/x/.local/share/claude/versions/2.1.225",
                "claude"
            ),
            (
                "Claude Helper",
                "/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper",
                "claude"
            ),
        ]
        for (process, path, expected) in positiveFamilies {
            let actual = AppRoutingResearchClassifier.family(
                process: process,
                path: path
            )
            guard actual == expected else {
                throw TestFailure(
                    "expected family \(expected), got \(actual) for \(path ?? process ?? "nil")"
                )
            }
        }

        let unknownCases: [(String?, String?)] = [
            ("wecompliance-agent", nil),
            ("awesunset", nil),
            ("safarivirus", nil),
            (nil, "/tmp/WeChat.app/Contents/MacOS/WeChat"),
            (nil, "/Applications/FakeWeChat.app/Contents/MacOS/WeChat"),
            (nil, "/Applications/WeChat.app/../../private"),
            (nil, "/Applications/WeChat.app//Contents/MacOS/WeChat"),
            (nil, "/Applications/Private.app/Contents/MacOS/WeChat"),
            (nil, "/Applications/WeChat.app/Content/MacOS/WeChat"),
        ]
        for (process, path) in unknownCases {
            let actual = AppRoutingResearchClassifier.family(
                process: process,
                path: path
            )
            guard actual == "other" else {
                throw TestFailure(
                    "unknown app escaped `other` as \(actual): \(path ?? process ?? "nil")"
                )
            }
        }

        let componentCases: [(String, String, String?)] = [
            (
                "wechat",
                "/Applications/WeChat.app/Contents/MacOS/WeChat",
                "main_executable"
            ),
            (
                "wecom",
                "/Applications/企业微信.app/Contents/Frameworks/Helper.framework/Helpers/Helper",
                "framework_helper"
            ),
            (
                "tencent_meeting",
                "/Applications/VooV Meeting.app/Contents/XPCServices/Media.xpc/Contents/MacOS/Media",
                "xpc_service"
            ),
            (
                "wps",
                "/Applications/wpsoffice.app/Contents/PlugIns/Writer.plugin/Contents/MacOS/Writer",
                "plugin_helper"
            ),
            (
                "baidu_netdisk",
                "/Applications/BaiduNetdisk_mac.app/Contents/MacOS/unknown-helper-name",
                "bundle_helper"
            ),
            (
                "wechat",
                "/Users/customer/Applications/WeChat.app/Contents/MacOS/WeChat",
                nil
            ),
            (
                "chrome",
                "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper",
                nil
            ),
            (
                "other",
                "/Applications/Private.app/Contents/MacOS/Private",
                nil
            ),
        ]
        for (app, path, expected) in componentCases {
            let actual = AppRoutingResearchClassifier.bundleComponent(
                for: app,
                processPath: path
            )
            guard actual == expected else {
                throw TestFailure(
                    "expected component \(expected ?? "nil"), got \(actual ?? "nil") for \(app)"
                )
            }
        }

        guard AppRoutingResearchClassifier.families.count == 27,
              AppRoutingResearchClassifier.componentFamilies.count == 18,
              AppRoutingResearchClassifier.bundleComponents.count == 5 else {
            throw TestFailure("fixed classifier vocabulary size drifted")
        }
        print("app-routing research classifier regressions passed")
    }
}
