import XCTest
@testable import Tono

/// The bundle-wide rule makes WeChat direct; this file is about the answer
/// behind that route. Four days of one Mac's audit had `mmbiz.qpic.cn` pinned
/// and resolving through China DoH while `snsvideo.c2c.wechat.com` — the
/// busiest WeChat host on the machine, 200 connections — was not on any policy
/// list, so its name was resolved through the exit and the direct dial waited
/// on a lookup that crossed the Pacific first.
final class WeChatResolverPolicyTests: XCTestCase {
    private func runtime(
        directPolicy: ConfigPipeline.ManagedDirectRuntimePolicy?
    ) throws -> String {
        try Fixture.ownedRuntime(
            overlay: Fixture.overlay(selectedNodeName: "US-VLESS-Reality"),
            nodes: [Fixture.realityNode()],
            directPolicy: directPolicy
        )
    }

    private func nameserverPolicy(_ yaml: String) -> [String] {
        guard let start = yaml.range(of: "  nameserver-policy:\n") else { return [] }
        var keys: [String] = []
        for line in yaml[start.upperBound...].components(separatedBy: "\n") {
            guard line.hasPrefix("    \"") else { break }
            guard let close = line.dropFirst(5).firstIndex(of: "\"") else { break }
            keys.append(String(line[line.index(line.startIndex, offsetBy: 5)..<close]))
        }
        return keys
    }

    func testWeChatFamiliesResolveThroughChinaDoHWithNoPolicyHostsAtAll() throws {
        // The regression: this whole block used to be skipped unless published
        // policy carried a resolver host or a web suffix, so on a policy that
        // pins IP endpoints only, WeChat resolved entirely through the exit.
        let yaml = try runtime(directPolicy: Fixture.directPolicy())
        let keys = Set(nameserverPolicy(yaml))
        XCTAssertFalse(keys.isEmpty, "nameserver-policy was not emitted at all")
        for suffix in ConfigPipeline.wechatDirectDNSSuffixes {
            XCTAssertTrue(keys.contains(suffix), "missing \(suffix)")
            XCTAssertTrue(keys.contains("+.\(suffix)"), "missing +.\(suffix)")
        }
    }

    func testTheHostsThatWereActuallyBeingMissedAreCovered() throws {
        let keys = Set(nameserverPolicy(try runtime(
            directPolicy: Fixture.directPolicy()
        )))
        // Each of these appeared in the audit resolving through the exit.
        let observed = [
            "snsvideo.c2c.wechat.com", "mmsns.c2c.wechat.com", "dns.wechat.com",
            "mmbiz.qpic.cn", "wx.qlogo.cn", "cube.weixinbridge.com",
            "liteapp.weixin.qq.com", "res.wx.qq.com", "wxsmw.wxs.qq.com",
        ]
        for host in observed {
            let covered = ConfigPipeline.wechatDirectDNSSuffixes.contains {
                host == $0 || host.hasSuffix(".\($0)")
            }
            XCTAssertTrue(covered, "\(host) is still not covered by any suffix")
            let wildcards = ConfigPipeline.wechatDirectDNSSuffixes
                .filter { host.hasSuffix(".\($0)") }
                .map { "+.\($0)" }
            for wildcard in wildcards {
                XCTAssertTrue(keys.contains(wildcard), "\(host) needs \(wildcard)")
            }
        }
    }

    func testTheseResolveOverTheDirectOutboundNotTheExit() throws {
        let yaml = try runtime(directPolicy: Fixture.directPolicy())
        guard let line = yaml.components(separatedBy: "\n")
            .first(where: { $0.hasPrefix("    \"+.wechat.com\":") }) else {
            return XCTFail("no +.wechat.com entry")
        }
        XCTAssertTrue(
            line.contains("#\(ConfigPipeline.directProxyName)"),
            "resolving through anything but the interface-bound direct outbound "
            + "defeats the point: \(line)"
        )
        XCTAssertFalse(line.contains(ConfigPipeline.exitGroupName), line)
    }

    func testWeChatsInAppBrowserKeepsOrdinaryResolution() throws {
        // The same audit shows WeChat opening chase.com, tesla.com and Google.
        // A per-process DNS override would have sent those to AliDNS too; a
        // suffix list is what keeps them out of it.
        let keys = Set(nameserverPolicy(try runtime(
            directPolicy: Fixture.directPolicy()
        )))
        for host in ["google.com", "+.google.com", "chase.com", "tesla.com"] {
            XCTAssertFalse(keys.contains(host), "\(host) must not be redirected")
        }
    }

    func testNoTencentWideWildcardSlipsIn() throws {
        // A bare `qq.com` would swallow `v.qq.com` video and everything else
        // the managed policy governs separately.
        for suffix in ConfigPipeline.wechatDirectDNSSuffixes {
            XCTAssertNotEqual(suffix, "qq.com")
            XCTAssertNotEqual(suffix, "tencent.com")
        }
        let keys = Set(nameserverPolicy(try runtime(
            directPolicy: Fixture.directPolicy()
        )))
        XCTAssertFalse(keys.contains("+.qq.com"))
    }

    func testPublishedPolicyHostsSurviveAlongsideThem() throws {
        let yaml = try runtime(directPolicy: Fixture.directPolicy(
            directResolverHosts: ["mp.weixin.qq.com", "acs.youku.com"]
        ))
        let keys = Set(nameserverPolicy(yaml))
        XCTAssertTrue(keys.contains("acs.youku.com"))
        XCTAssertTrue(keys.contains("mp.weixin.qq.com"))
        XCTAssertTrue(keys.contains("+.wechat.com"))
    }
}
