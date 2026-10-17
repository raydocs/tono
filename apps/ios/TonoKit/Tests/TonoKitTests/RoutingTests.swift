import XCTest
@testable import TonoKit

final class RoutingTests: XCTestCase {
    private func verdict(_ config: JSON, domain: String? = nil, ip: String? = nil, network: String = "tcp") throws -> RouteExplainer.Verdict {
        try RouteExplainer.explain(config, .init(domain: domain, ip: ip, network: network))
    }

    func testContractCountsMatchTheDesktopLists() {
        XCTAssertEqual(DesktopRoutingContract.cloudVideoSuffixes.count, 21)
        XCTAssertEqual(DesktopRoutingContract.homeSuffixes.count, 166)
        XCTAssertEqual(DesktopRoutingContract.homeIPv4CIDRs, ["160.79.104.0/21"])
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

    func testRouteCheckAnswersInUserTerms() {
        let answer = RouteExplainer.answer(config: SampleCatalog.config(), catalog: SampleCatalog.catalog(), host: "https://Claude.ai/new?x=1")
        XCTAssertEqual(answer, RouteAnswer(host: "claude.ai", tcp: .home, udp: .blocked))
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
