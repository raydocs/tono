import XCTest
@testable import TonoKit

final class RoutingTests: XCTestCase {
    private func verdict(_ config: JSON, domain: String? = nil, ip: String? = nil, port: Int = 443, network: String = "tcp") throws -> RouteExplainer.Verdict {
        try RouteExplainer.explain(config, .init(domain: domain, ip: ip, port: port, network: network))
    }

    func testContractCountsMatchTheDesktopLists() {
        XCTAssertEqual(DesktopRoutingContract.cloudVideoSuffixes.count, 21)
        XCTAssertEqual(DesktopRoutingContract.homeSuffixes.count, 194)
        XCTAssertEqual(DesktopRoutingContract.mobileHomeAuxSuffixes, ["intercom.io", "intercomcdn.com", "arkoselabs.com", "workos.com", "featureassets.org"])
        XCTAssertEqual(DesktopRoutingContract.homeIPv4CIDRs, ["160.79.104.0/21"])
        XCTAssertEqual(DesktopRoutingContract.stunUDPPorts, [19302, 19303, 19304, 19305, 19306, 19307, 19308, 19309])
        XCTAssertEqual(DesktopRoutingContract.encryptedDNSPorts, [853])
        XCTAssertEqual(DesktopRoutingContract.publicStunSuffixes, ["stun.cloudflare.com", "turn.cloudflare.com", "global.stun.twilio.com", "stun.services.mozilla.com", "stunprotocol.org"])
        XCTAssertEqual(DesktopRoutingContract.overseasUDPRejectIPv4CIDRs.count, 33)
        XCTAssertEqual(DesktopRoutingContract.overseasUDPRejectIPv6CIDRs.count, 21)
    }

    func testVideoExceptionWinsOverTheBroadHomeParent() throws {
        let config = SampleCatalog.config()
        // googleapis.com is a Home parent; youtubei.googleapis.com is a cloud video exception.
        XCTAssertEqual(try verdict(config, domain: "youtubei.googleapis.com").outbound, SingBoxConfig.exitTag)
        XCTAssertEqual(try verdict(config, domain: "generativelanguage.googleapis.com").outbound, SingBoxConfig.homeSocksTag)
    }

    func testHomeTrafficOnUDPIsRejectedSoQUICFallsBackToTCP() throws {
        if case .reject = try verdict(SampleCatalog.config(), domain: "claude.ai", network: "udp") {} else {
            XCTFail("Home UDP must be rejected")
        }
    }

    func testRawAnthropicAddressFollowsHome() throws {
        XCTAssertEqual(try verdict(SampleCatalog.config(), ip: "160.79.111.254").outbound, SingBoxConfig.homeSocksTag)
        XCTAssertEqual(try verdict(SampleCatalog.config(), ip: "160.79.112.1").outbound, SingBoxConfig.directTag)
    }

    func testAIWithoutAssignedHomeGoesToCloudNeverDirect() throws {
        let config = SampleCatalog.config(routing: nil)
        XCTAssertEqual(try verdict(config, domain: "chatgpt.com").outbound, SingBoxConfig.exitTag)
    }

    func testThreeTierSendsUnlistedTrafficDirectAndStableSendsItToCloud() throws {
        XCTAssertEqual(try verdict(SampleCatalog.config(), domain: "example.com").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(SampleCatalog.config(mode: .stable), domain: "example.com").outbound, SingBoxConfig.exitTag)
        if case .reject = try verdict(SampleCatalog.config(mode: .stable), domain: "example.com", network: "udp") {} else {
            XCTFail("stable rejects ordinary UDP")
        }
    }

    func testStaleFakeAddressIsRejectedNotSentDirect() throws {
        if case .reject = try verdict(SampleCatalog.config(), ip: "198.18.200.7") {} else { XCTFail("stale fake-IP must be rejected") }
        if case .reject = try verdict(SampleCatalog.config(), ip: "fc00::1234") {} else { XCTFail("stale fake-IPv6 must be rejected") }
    }

    func testLANStaysLocalInBothModes() throws {
        XCTAssertEqual(try verdict(SampleCatalog.config(mode: .stable), ip: "192.168.1.20").outbound, SingBoxConfig.directTag)
        XCTAssertTrue(SingBoxConfig.tunRouteExclude.contains("192.168.0.0/16"))
    }

    func testGraphCarriesNoPerAppRules() {
        // iOS has no package identity; the Android-only package_name items must never appear.
        XCTAssertFalse(SampleCatalog.config().serialized().contains("package_name"))
    }

    func testTunUsesNetworkExtensionMTUAndCapturesIPv6() {
        let tun = SampleCatalog.config()["inbounds"]?.array?.first
        XCTAssertEqual(tun?["mtu"]?.int, 4064)
        XCTAssertEqual(tun?["address"]?.array?.compactMap(\.string), [SingBoxConfig.tunInet4, SingBoxConfig.tunInet6])
    }

    func testDirectAAAAIsEmptyOnlyWhenTheNetworkHasNoIPv6() throws {
        let noV6 = SampleCatalog.config(ipv6: false)
        XCTAssertEqual(try RouteExplainer.dnsServer(noV6, domain: "example.com", queryType: "AAAA"), "predefined")
        XCTAssertEqual(try RouteExplainer.dnsServer(noV6, domain: "claude.ai", queryType: "AAAA"), SingBoxConfig.dnsFakeIP)
        XCTAssertEqual(try RouteExplainer.dnsServer(SampleCatalog.config(), domain: "example.com", queryType: "AAAA"), SingBoxConfig.dnsLocal)
    }

    func testSelectorFallsBackToTheAccountDefaultWhenTheSavedNodeVanished() throws {
        let body = SampleCatalog.body(routing: CatalogRouting(defaultProxy: "Los Angeles · Grove"))
        let catalog = try CatalogAdmission.admit(body)
        let input = ConfigInput(catalog: catalog, selectedCloudNode: "Gone · Node", mode: .threeTier, underlyingIPv6: true, cacheFilePath: nil)
        XCTAssertEqual(SingBoxConfig.selectedNode(input).name, "Los Angeles · Grove")
    }

    func testOverseasUDPAndSTUNAreRejectedWhileDomesticUDPStaysDirectInThreeTier() throws {
        let threeTier = SampleCatalog.config()
        let stable = SampleCatalog.config(mode: .stable)

        for config in [threeTier, stable] {
            for port in DesktopRoutingContract.stunUDPPorts {
                if case .reject = try verdict(config, ip: "74.125.250.129", port: port, network: "udp") {} else {
                    XCTFail("Google STUN raw IP 74.125.250.129:\(port) must be rejected")
                }
                if case .reject = try verdict(config, domain: "stun1.l.google.com", port: port, network: "udp") {} else {
                    XCTFail("Google STUN domain on port \(port) must be rejected")
                }
            }
            for ip in ["74.125.250.129", "142.250.80.46", "172.217.160.142", "8.8.8.8", "1.1.1.1", "9.9.9.9", "149.112.112.112", "208.67.222.222", "208.67.220.220", "104.16.132.229", "160.79.104.10", "151.101.1.69", "149.154.167.91", "157.240.22.35", "2001:4860:4864:5:8000::1", "2001:4860:4860::8888", "2606:4700:4700::1111", "2620:fe::fe", "2620:119:35::35", "2607:6bc0::10", "2a04:4e40::1", "2a03:2880:f100:83:face:b00c:0:25de", "2001:67c:4e8:f002::a"] {
                for port in [53, 443, 3478, 5349] {
                    if port == 53 {
                        XCTAssertEqual(try verdict(config, ip: ip, port: port, network: "udp"), .hijackDNS)
                    } else if case .reject = try verdict(config, ip: ip, port: port, network: "udp") {} else {
                        XCTFail("Overseas UDP \(ip):\(port) must be rejected")
                    }
                }
            }
            for stunHost in DesktopRoutingContract.publicStunSuffixes {
                if case .reject = try verdict(config, domain: stunHost, port: 3478, network: "udp") {} else {
                    XCTFail("Public STUN domain \(stunHost) UDP must be rejected")
                }
                XCTAssertEqual(try verdict(config, domain: stunHost, port: 443, network: "tcp").outbound, SingBoxConfig.exitTag)
                XCTAssertEqual(try RouteExplainer.dnsServer(config, domain: stunHost, queryType: "A"), SingBoxConfig.dnsFakeIP)
                XCTAssertEqual(try RouteExplainer.dnsServer(config, domain: stunHost, queryType: "HTTPS"), "predefined")
            }
            // Encrypted DNS (DoT/DoQ port 853) is rejected so apps fall back to port-53 FakeIP DNS.
            for net in ["tcp", "udp"] {
                if case .reject = try verdict(config, ip: "8.8.8.8", port: 853, network: net) {} else {
                    XCTFail("DoT/DoQ 8.8.8.8:853/\(net) must be rejected")
                }
                if case .reject = try verdict(config, domain: "dns.google", port: 853, network: net) {} else {
                    XCTFail("DoT/DoQ dns.google:853/\(net) must be rejected")
                }
            }
        }

        // Claude auxiliary auth, SSO, and anti-bot challenge domains route to Home on TCP, reject UDP, and use FakeIP DNS.
        for host in ["intercom.io", "widget.intercom.io", "js.intercomcdn.com", "arkoselabs.com", "client-api.arkoselabs.com", "workos.com", "auth.workos.com", "statsig.com", "featureassets.org"] {
            XCTAssertEqual(try verdict(threeTier, domain: host, port: 443, network: "tcp").outbound, SingBoxConfig.homeSocksTag)
            if case .reject = try verdict(threeTier, domain: host, port: 443, network: "udp") {} else {
                XCTFail("Claude aux domain \(host) UDP must be rejected")
            }
            XCTAssertEqual(try RouteExplainer.dnsServer(threeTier, domain: host, queryType: "A"), SingBoxConfig.dnsFakeIP)
            XCTAssertEqual(try RouteExplainer.dnsServer(threeTier, domain: host, queryType: "HTTPS"), "predefined")
            XCTAssertEqual(try RouteExplainer.dnsServer(threeTier, domain: host, queryType: "SVCB"), "predefined")
        }

        // HTTPS (Type 65) and SVCB (Type 64) DNS queries never leak to local DNS for FakeIP/overseas domains.
        for host in ["claude.ai", "www.youtube.com", "x.com", "api.twitter.com"] {
            XCTAssertEqual(try RouteExplainer.dnsServer(threeTier, domain: host, queryType: "HTTPS"), "predefined")
            XCTAssertEqual(try RouteExplainer.dnsServer(threeTier, domain: host, queryType: "SVCB"), "predefined")
        }
        XCTAssertEqual(try RouteExplainer.dnsServer(threeTier, domain: "www.baidu.com", queryType: "HTTPS"), SingBoxConfig.dnsLocal)
        XCTAssertEqual(try RouteExplainer.dnsServer(stable, domain: "www.baidu.com", queryType: "HTTPS"), "predefined")

        // Domestic UDP (Douyin QUIC, WeChat voice/video, smart home P2P, NTP, LAN cast, 5G IPv6) stays direct in Three-Tier.
        XCTAssertEqual(try verdict(threeTier, domain: "quic.example.cn", port: 443, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, domain: "weixin.qq.com", port: 8000, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, ip: "101.1.2.6", port: 8000, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, ip: "43.146.27.17", port: 8000, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, ip: "223.5.5.5", port: 3478, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, ip: "114.114.114.114", port: 123, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, ip: "192.168.1.20", port: 5353, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, ip: "2408:8207:1800::1", port: 443, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, ip: "2409:8080:1000::1", port: 8000, network: "udp").outbound, SingBoxConfig.directTag)
        XCTAssertEqual(try verdict(threeTier, ip: "fe80::1", port: 5353, network: "udp").outbound, SingBoxConfig.directTag)
    }

    func testRouteCheckAnswersInUserTerms() {
        let answer = RouteExplainer.answer(config: SampleCatalog.config(), catalog: SampleCatalog.catalog(), host: "https://Claude.ai/new?x=1")
        XCTAssertEqual(answer, RouteAnswer(host: "claude.ai", tcp: .home, udp: .blocked))
        let stunAnswer = RouteExplainer.answer(config: SampleCatalog.config(), catalog: SampleCatalog.catalog(), host: "74.125.250.129:19302")
        XCTAssertEqual(stunAnswer, RouteAnswer(host: "74.125.250.129", tcp: .direct, udp: .blocked))
        XCTAssertEqual(RouteExplainer.cleanHost("[2001:db8::1]:443"), "2001:db8::1")
        XCTAssertNil(RouteExplainer.cleanHost("   "))
    }

    func testTunnelInputsRoundTripAndTheExtensionReAdmitsTheBody() throws {
        let inputs = TunnelInputs(catalogBody: SampleCatalog.body().serialized(), mode: .stable, selectedNode: "Tokyo · Dawn")
        XCTAssertEqual(try TunnelInputs.decode(inputs.encoded()), inputs)
        XCTAssertTrue(try inputs.makeConfig(underlyingIPv6: true, cacheFilePath: nil).contains("\"final\":\"Tono-Exit\""))
        var tampered = inputs
        tampered.catalogBody = inputs.catalogBody.replacingOccurrences(of: "9.9.9.9", with: "9.9.9.8")
        XCTAssertThrowsError(try tampered.makeConfig(underlyingIPv6: true, cacheFilePath: nil))
    }
}

private extension RouteExplainer.Verdict {
    var outbound: String? {
        if case .route(let o, _) = self { return o }
        return nil
    }
}
