import XCTest
@testable import Tono

/// `route_classification` is what an uploaded audit is read by, and for four
/// days of one Mac's log it answered "UNCLASSIFIED" 16 074 times out of 38 956 —
/// not because those routes were unknown, but because two whole categories had
/// nowhere else to go. Every message below is copied from that log.
final class CoreRouteClassificationTests: XCTestCase {
    private func classify(_ message: String) -> String {
        LocalTrafficAudit.classifyCoreRouteLog(message)
    }

    func testResidentialAndGenericProxyCountsPartitionObservedConnections() {
        let wasEnabled = LocalTrafficAudit.isClaudeTrafficResearchEnabled
        LocalTrafficAudit.shared.setClaudeTrafficResearchEnabled(true)
        defer {
            LocalTrafficAudit.shared.setClaudeTrafficResearchEnabled(wasEnabled)
        }

        let protection = TrafficAuditProtectionSnapshot(
            connected: true,
            connecting: false,
            protectionBlocked: false,
            killSwitchArmed: true,
            tunPresent: true,
            protectedDNSConfigured: true,
            selectedExit: "US"
        )
        let metadata = APIConnectionMetadata(
            network: "tcp",
            type: "HTTP",
            process: "Claude",
            processPath: "/Applications/Claude.app/Contents/MacOS/Claude",
            sourceIP: "198.18.0.1",
            destinationIP: "203.0.113.1",
            sourcePort: "51000",
            destinationPort: "443",
            host: "api.anthropic.com"
        )
        LocalTrafficAudit.shared.recordConnections(
            [
                APIConnection(
                    id: UUID().uuidString,
                    metadata: metadata,
                    upload: 1,
                    download: 2,
                    start: "now",
                    chains: [
                        ConfigPipeline.homeResidentialProxyName,
                        ConfigPipeline.claudeHomeGroupName,
                    ],
                    rule: "DOMAIN-SUFFIX",
                    rulePayload: "anthropic.com"
                ),
                APIConnection(
                    id: UUID().uuidString,
                    metadata: metadata,
                    upload: 3,
                    download: 4,
                    start: "now",
                    chains: [ConfigPipeline.exitGroupName],
                    rule: "MATCH",
                    rulePayload: nil
                ),
                APIConnection(
                    id: UUID().uuidString,
                    metadata: APIConnectionMetadata(
                        network: "tcp",
                        type: "HTTPS",
                        process: "Google Chrome",
                        processPath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                        sourceIP: "198.18.0.2",
                        destinationIP: "203.0.113.2",
                        sourcePort: "51001",
                        destinationPort: "443",
                        host: "challenges.cloudflare.com"
                    ),
                    upload: 1,
                    download: 1,
                    start: "now",
                    chains: [ConfigPipeline.exitGroupName],
                    rule: "MATCH",
                    rulePayload: nil
                ),
            ],
            protection: protection
        )

        let snapshot = LocalTrafficAudit.shared.claudeTrafficResearchSnapshot()
        XCTAssertEqual(snapshot.observedConnectionCount, 3)
        XCTAssertEqual(snapshot.residentialConnectionCount, 1)
        XCTAssertEqual(snapshot.proxiedConnectionCount, 2)
        XCTAssertEqual(
            snapshot.unsafeProtectionObservationCount,
            2,
            "a protected Claude endpoint on the generic exit must invalidate the residential proof"
        )
        XCTAssertEqual(
            snapshot.residentialConnectionCount
                + snapshot.proxiedConnectionCount
                + snapshot.directConnectionCount
                + snapshot.blockedConnectionCount,
            snapshot.observedConnectionCount
        )
    }

    func testRejectIsBlockedRatherThanUnrecognised() {
        // 13 670 of the unclassified lines. `Tono-WeChat-TCP-*` groups carry
        // REJECT as their fail-closed first member, so this is by design and
        // high-volume; filing it as "unrecognised" buried the real unknowns.
        XCTAssertEqual(
            classify(
                "[TCP] 198.18.0.1:59211(WeChat) --> 43.146.27.17:443 "
                + "match AND(((Network,tcp),(DstPort,443))) using REJECT"
            ),
            "BLOCKED"
        )
    }

    func testLinesThatRouteNothingAreNotCalledRoutes() {
        // 2 339 of them. `recordCoreLogs` receives every core log line, not
        // only routing decisions.
        XCTAssertEqual(
            classify("[TCP] connection to 1.1.1.1:443 using fake ping echo"),
            "NOT_A_ROUTE"
        )
        XCTAssertEqual(
            classify("Health check via HTTP may result in failed tests."),
            "NOT_A_ROUTE"
        )
        XCTAssertEqual(classify("Start initial provider default"), "NOT_A_ROUTE")
    }

    func testManagedDirectGroupsAndOutbounds() {
        for outbound in [
            ConfigPipeline.directProxyName,
            ConfigPipeline.webDirectProxyName,
            ConfigPipeline.appDirectGroupName,
            ConfigPipeline.webDirectGroupName,
            ConfigPipeline.managedDirectFallbackGroupPrefix + "a1b2c3d4",
        ] {
            XCTAssertEqual(
                classify(
                    "[TCP] 198.18.0.1:1(WeChat) --> mmbiz.qpic.cn:443 "
                    + "match RULE using \(outbound)[\(ConfigPipeline.directProxyName)]"
                ),
                "MANAGED_DIRECT",
                outbound
            )
        }
    }

    func testSignatureDoesNotRelaxProtectedAssistantHosts() {
        for host in [
            "api.anthropic.com", "claude.ai", "claude.com", "claude.app",
            "claude.site", "clau.de", "anthropic.ai", "claudestudio.com",
            "claudemcpclient.com", "claudemcpcontent.com",
            "downloads.claudeusercontent.com", "servd-anthropic-website.b-cdn.net",
            "challenges.cloudflare.com", "cf-assets.www.cloudflare.com",
            "cloudflareinsights.com", "browser-intake-datadoghq.com",
            "browser-intake-us5-datadoghq.com",
            "browser-intake-us3-datadoghq.com",
            "browser-intake-ap1-datadoghq.com",
            "browser-intake-ap2-datadoghq.com",
            "browser-intake-datadoghq.eu", "browser-intake-ddog-gov.com",
            "api.datadoghq.com",
            "api.statsig.com", "api.statsigapi.net", "featuregates.org",
            "growthbook.io", "stripe.network", "storage.googleapis.com",
            "registry.npmjs.org", "raw.githubusercontent.com", "formulae.brew.sh",
            "o123.ingest.sentry.io", "tono.app", "tono.com",
        ] {
            XCTAssertThrowsError(
                try ConfigPipeline.validatedManagedDirectDomain(host, trusted: true),
                host
            )
            XCTAssertThrowsError(
                try ConfigPipeline.validatedWebDirectDomain(host, trusted: true),
                host
            )
            XCTAssertThrowsError(
                try ConfigPipeline.validatedManagedDirectSuffix(host, trusted: true),
                host
            )
        }

        // A direct suffix owns all of its children, so a protected child also
        // makes every parent suffix unsafe even when the policy is signed.
        for host in [
            "googleapis.com", "githubusercontent.com", "npmjs.org", "brew.sh",
            "b-cdn.net", "www.cloudflare.com",
        ] {
            XCTAssertThrowsError(
                try ConfigPipeline.validatedManagedDirectSuffix(host, trusted: true),
                host
            )
        }
    }

    func testApplicationSubfolderScanFindsWeChatOneLevelDown() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-wechat-scan-\(UUID().uuidString)", isDirectory: true)
        let nested = root.appendingPathComponent("联系软件", isDirectory: true)
        let wechat = nested.appendingPathComponent("微信.app", isDirectory: true)
        let siblingApp = root.appendingPathComponent("WeChat.app", isDirectory: true)
        try FileManager.default.createDirectory(at: wechat, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: siblingApp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let found = ConfigPipeline.applicationSubfolderBundles(
            named: ["WeChat.app", "微信.app"],
            under: root
        )
        XCTAssertEqual(
            found.map { $0.resolvingSymlinksInPath().path }.sorted(),
            [wechat.resolvingSymlinksInPath().path]
        )
    }

    func testReviewedChinaOfficeAppsShareTheWeChatDirectBoundary() {
        let bundlePaths = ConfigPipeline.managedDirectProcessBundlePaths
        XCTAssertTrue(bundlePaths.contains("/Applications/WeChat.app/"))
        XCTAssertTrue(bundlePaths.contains("/Applications/DingTalk.app/"))
        XCTAssertTrue(bundlePaths.contains("/Applications/Feishu.app/"))
        XCTAssertTrue(bundlePaths.contains("/Applications/Lark.app/"))

        let regexes = ConfigPipeline.managedDirectProcessPathRegexes
        XCTAssertTrue(regexes.contains(
            ConfigPipeline.rulePathRegex(for: "/Applications/DingTalk.app/")
        ))
        XCTAssertTrue(regexes.contains(
            ConfigPipeline.rulePathRegex(for: "/Applications/Feishu.app/")
        ))
        XCTAssertTrue(regexes.contains(
            ConfigPipeline.rulePathRegex(for: "/Applications/Lark.app/")
        ))

        XCTAssertNoThrow(try ConfigPipeline.validatedManagedDirectDomain(
            "open.dingtalk.com"
        ))
        XCTAssertNoThrow(try ConfigPipeline.validatedManagedDirectDomain(
            "open.feishu.cn"
        ))
        XCTAssertNoThrow(try ConfigPipeline.validatedManagedDirectDomain(
            "api.snssdk.com"
        ))
        XCTAssertNoThrow(try ConfigPipeline.validatedManagedDirectSuffix(
            "dingtalk.com"
        ))
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectSuffix(
            "snssdk.com"
        ))
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectDomain(
            "evil-dingtalk.com"
        ))

        let node = Fixture.realityNode()
        let runtimePolicy = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [
                .init(
                    host: "open.dingtalk.com",
                    addresses: ["9.0.0.10"],
                    ports: [443]
                ),
            ],
            mediaEndpoints: [],
            directResolverHosts: ["open.dingtalk.com"]
        )
        let runtime = try! Fixture.ownedRuntime(
            overlay: Fixture.overlay(selectedNodeName: node.name),
            nodes: [node],
            directPolicy: runtimePolicy
        )
        let dingRegex = ConfigPipeline.rulePathRegex(
            for: "/Applications/DingTalk.app/"
        )
        XCTAssertTrue(runtime.contains(
            "AND,((NETWORK,TCP),(PROCESS-PATH-REGEX,\(dingRegex))),Tono-China-App"
        ))
    }

    func testWebOnlySuffixDoesNotArmOfficeProcessRouting() {
        let node = Fixture.realityNode()
        let runtimePolicy = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [],
            webDomainPins: [],
            webDomainSuffixes: [
                .init(host: "feishu.cn", ports: [443]),
            ],
            mediaEndpoints: [],
            directResolverHosts: ["feishu.cn"],
            nativeAppDirect: false
        )
        let runtime = try! Fixture.ownedRuntime(
            overlay: Fixture.overlay(selectedNodeName: node.name),
            nodes: [node],
            directPolicy: runtimePolicy
        )
        let dingRegex = ConfigPipeline.rulePathRegex(
            for: "/Applications/DingTalk.app/"
        )
        XCTAssertFalse(runtime.contains(
            "PROCESS-PATH-REGEX,\(dingRegex)"
        ))
        XCTAssertTrue(runtime.contains(
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,feishu.cn)),Tono-China-Web"
        ))
        XCTAssertTrue(runtime.contains(
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,qq.com)),Tono-China-Web"
        ))
        XCTAssertTrue(runtime.contains(
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,baidu.com)),Tono-China-Web"
        ))
        XCTAssertTrue(runtime.contains(
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,aliyuncs.com)),Tono-China-Web"
        ))
        XCTAssertTrue(runtime.contains(
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,edu.cn)),Tono-China-Web"
        ))
        XCTAssertTrue(runtime.contains(
            "AND,((NETWORK,TCP),(DST-PORT,443),(DOMAIN-SUFFIX,weixinbridge.com)),Tono-China-Web"
        ))
        XCTAssertTrue(runtimePolicy.requiresAddressFreeDirectPermit)
    }

    func testExitAndResidentialAreProxied() {
        XCTAssertEqual(
            classify(
                "[TCP] 198.18.0.1:2(curl) --> example.com:443 "
                + "match MATCH using Tono-Exit[US-VLESS-Reality]"
            ),
            "PROXIED"
        )
        XCTAssertEqual(
            classify(
                "[TCP] 198.18.0.1:3(Claude) --> api.anthropic.com:443 match "
                + "AND(((Network,tcp),(ProcessName,Claude))) "
                + "using Tono-Claude-Home[Tono-Home-Residential]"
            ),
            "PROXIED"
        )
    }

    func testPlainDirectStaysDistinctFromManagedDirect() {
        // DIRECT is not proof PF put the packet on the wire, so it keeps its
        // own label rather than being folded into MANAGED_DIRECT.
        XCTAssertEqual(
            classify(
                "[ICMP] 198.18.0.1 --> 1.1.1.1 match MATCH using DIRECT"
            ),
            "DIRECT_ATTEMPT"
        )
    }

    func testDirectFirstGroupOnItsDirectMemberIsNotAFallback() {
        // 706 of these in the retained log, and none of the other kind: the
        // group has never actually failed over, which is why the detection had
        // to be written against Mihomo's format rather than a sample of it.
        XCTAssertNil(
            LocalTrafficAudit.managedDirectGroupThatFellBack(
                "[TCP] 198.18.0.1:1(WeChat) --> 43.175.230.137:80 match "
                + "AND(((Network,tcp),(ProcessPathRegex,x))) "
                + "using Tono-China-App[Tono-China-Direct]"
            )
        )
        XCTAssertNil(
            LocalTrafficAudit.managedDirectGroupThatFellBack(
                "[TCP] 198.18.0.1:2(curl) --> api.bilibili.com:443 match RULE "
                + "using Tono-China-Web[Tono-China-Web-Direct]"
            )
        )
    }

    func testDirectFirstGroupOnAnythingElseIsAFallback() {
        // The bracket carries the leaf proxy, never the intermediate group, so
        // a failed over group names the exit node — matching on "Tono-Exit"
        // would have detected nothing.
        XCTAssertEqual(
            LocalTrafficAudit.managedDirectGroupThatFellBack(
                "[TCP] 198.18.0.1:3(WeChat) --> snsvideo.c2c.wechat.com:80 match "
                + "AND(((Network,tcp),(ProcessPathRegex,x))) "
                + "using Tono-China-App[US-VLESS-Reality]"
            ),
            ConfigPipeline.appDirectGroupName
        )
    }

    func testAssistantGroupIsSilentUntilAResidentialHopExists() {
        // No hop means the group either does not exist or its first member is a
        // catalog node whose name is not knowable here. Reporting either would
        // be a guess.
        LocalTrafficAudit.setAssistantDirectFirstMember(nil)
        XCTAssertNil(
            LocalTrafficAudit.managedDirectGroupThatFellBack(
                "[TCP] 198.18.0.1:5(Claude) --> api.anthropic.com:443 match RULE "
                + "using Tono-Claude-Home[US-VLESS-Reality]"
            )
        )
    }

    func testAssistantLeavingTheResidentialHopIsReported() {
        // The one failover that changes who the user appears to be: Claude and
        // ChatGPT are routed through a home connection on purpose, and this
        // group moves them to the datacenter exit without any other signal
        // changing — both readings are still "PROXIED".
        LocalTrafficAudit.setAssistantDirectFirstMember(
            ConfigPipeline.homeResidentialProxyName
        )
        defer { LocalTrafficAudit.setAssistantDirectFirstMember(nil) }
        XCTAssertNil(
            LocalTrafficAudit.managedDirectGroupThatFellBack(
                "[TCP] 198.18.0.1:6(Claude) --> api.anthropic.com:443 match RULE "
                + "using Tono-Claude-Home[Tono-Home-Residential]"
            ),
            "sitting on the residential hop is the healthy state"
        )
        XCTAssertEqual(
            LocalTrafficAudit.managedDirectGroupThatFellBack(
                "[TCP] 198.18.0.1:7(Claude) --> api.anthropic.com:443 match RULE "
                + "using Tono-Claude-Home[US-VLESS-Reality]"
            ),
            ConfigPipeline.claudeHomeGroupName
        )
    }

    func testOrdinaryExitRoutesAreNotReportedAsFallbacks() {
        XCTAssertNil(
            LocalTrafficAudit.managedDirectGroupThatFellBack(
                "[TCP] 198.18.0.1:4(curl) --> example.com:443 "
                + "match MATCH using Tono-Exit[US-VLESS-Reality]"
            )
        )
        XCTAssertNil(
            LocalTrafficAudit.managedDirectGroupThatFellBack(
                "Health check via HTTP may result in failed tests."
            )
        )
    }

    func testAnOutboundNobodyRecognisesStillReportsItself() {
        XCTAssertEqual(
            classify(
                "[TCP] 198.18.0.1:4(x) --> y:443 match MATCH using Some-New-Group[z]"
            ),
            LocalTrafficAudit.unclassifiedRoute
        )
    }
}
