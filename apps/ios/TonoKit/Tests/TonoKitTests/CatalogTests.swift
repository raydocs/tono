import XCTest
@testable import TonoKit

final class CatalogTests: XCTestCase {
    func testSHA256MatchesKnownVector() {
        XCTAssertEqual(SHA256.hex(SHA256.digest(Array("abc".utf8))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        // 56-byte message forces the length into a second block.
        XCTAssertEqual(SHA256.hex(SHA256.digest(Array("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8))),
                       "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
    }

    func testAdmitsFixtureWithSocksHomeAndKeepsBothCloudNodes() throws {
        let catalog = try CatalogAdmission.admit(SampleCatalog.body())
        XCTAssertEqual(catalog.cloudNodes.map(\.name), ["Tokyo · Dawn", "Los Angeles · Grove"])
        XCTAssertEqual(catalog.home, .socks5(SampleCatalog.socks))
        XCTAssertEqual(catalog.cloudNodes[1].realityShortID, "c3d4e5")
        XCTAssertNil(catalog.cloudNodes[1].flow)
        XCTAssertEqual(catalog.cloudNodes[0].city, "Tokyo")
        XCTAssertEqual(catalog.cloudNodes[0].label, "Dawn")
    }

    func testGatewayHostnameHomeLineIsAdmittedButSpecialUseAndNumericNamesAreNot() throws {
        func admit(_ host: String) throws -> ExitCatalog {
            try CatalogAdmission.admit(SampleCatalog.body(routing: CatalogRouting(homeSocks5: HomeSocks5(
                host: host, port: 1080, username: "home-user", password: "home-pass"))))
        }
        let gateway = HomeSocks5(host: "isp.decodo.com", port: 1080, username: "home-user", password: "home-pass")
        XCTAssertEqual(try admit("isp.decodo.com").home, .socks5(gateway))
        let outbound = SampleCatalog.config(routing: CatalogRouting(homeSocks5: gateway))["outbounds"]?.array?
            .first { $0["tag"]?.string == "Tono-Home-Residential" }
        XCTAssertEqual(outbound?["server"]?.string, "isp.decodo.com")
        XCTAssertEqual(outbound?["detour"]?.string, "Tono-Exit")
        for host in ["ISP.decodo.com", "decodo", "isp.decodo.com.", "-isp.decodo.com", "isp_x.decodo.com", "127.0.0.0x1",
                     "0x7f.0.0.1", "1.2.3", "localhost.decodo.com", "gw.localhost", "gw.local", "gw.internal", "gw.test",
                     "example.com", "gw.example.org", "x.onion", "1.1.1.1.in-addr.arpa", "192.168.1.2"] {
            XCTAssertThrowsError(try admit(host), host) { XCTAssertEqual(($0 as? CatalogRejected)?.code, "HOME_SOCKS", host) }
        }
    }

    func testCatalogNodeHomeIsRemovedFromTheCloudList() throws {
        let catalog = try CatalogAdmission.admit(SampleCatalog.body(routing: CatalogRouting(homeProxy: "Los Angeles · Grove")))
        XCTAssertEqual(catalog.cloudNodes.map(\.name), ["Tokyo · Dawn"])
        XCTAssertEqual(catalog.homeNodeName, "Los Angeles · Grove")
    }

    func testAssignedHomeMissingFromCatalogRefusesInsteadOfFallingBackToCloud() {
        XCTAssertThrowsError(try CatalogAdmission.admit(SampleCatalog.body(routing: CatalogRouting(homeProxy: "Buffalo · Gone")))) {
            XCTAssertEqual(($0 as? CatalogRejected)?.code, "HOME_UNAVAILABLE")
        }
    }

    func testTamperedYamlFailsTheDigest() {
        var body = SampleCatalog.body().object!
        body["yaml"] = .string(SampleCatalog.yaml.replacingOccurrences(of: "8.8.4.4", with: "8.8.8.8"))
        XCTAssertThrowsError(try CatalogAdmission.admit(.object(body))) {
            XCTAssertEqual(($0 as? CatalogRejected)?.code, "CATALOG_DIGEST")
        }
    }

    func testRoutingDocumentWithoutItsDigestIsRefused() {
        XCTAssertThrowsError(try CatalogAdmission.admit(SampleCatalog.body(includeRoutingDigest: false))) {
            XCTAssertEqual(($0 as? CatalogRejected)?.code, "ROUTING_DIGEST")
        }
    }

    func testEmptyRoutingDigestMatchesTheWorkerRecipe() {
        // control-plane catalog.ts routingSha256(undefined) = sha256("\n\n") base64url.
        XCTAssertEqual(CatalogAdmission.routingDigest(nil), SHA256.base64URL("\n\n"))
        XCTAssertNoThrow(try CatalogAdmission.admit(SampleCatalog.body(routing: nil)))
    }

    func testLineLabelShowsOnlyWhenACityHasTwoLines() {
        let two = ["Tokyo · Dawn", "Los Angeles · Grove"]
        XCTAssertFalse(LineNaming.showsLabel("Tokyo · Dawn", among: two))
        let sameCity = ["Tokyo · Dawn", "tokyo · Dusk", "Los Angeles · Grove"]
        XCTAssertTrue(LineNaming.showsLabel("Tokyo · Dawn", among: sameCity))
        XCTAssertFalse(LineNaming.showsLabel("Los Angeles · Grove", among: sameCity))
        XCTAssertFalse(LineNaming.showsLabel("Tokyo", among: ["Tokyo", "Tokyo · Dusk"]))
    }

    func testHy2BlockIsStrippedNotAdmittedAsASecondIdentity() throws {
        let yaml = SampleCatalog.yaml + "  - {name: \"Tokyo · Dawn · hy2\", type: hysteria2, server: 8.8.4.4, port: 443, password: x}\n"
        let nodes = try CatalogAdmission.admitYAML(yaml)
        XCTAssertEqual(nodes.map(\.name), ["Tokyo · Dawn", "Los Angeles · Grove"])
    }

    func testSkipCertVerifyIsRefused() {
        let yaml = SampleCatalog.yaml.replacingOccurrences(of: "    tls: true\n", with: "    tls: true\n    skip-cert-verify: true\n")
        XCTAssertThrowsError(try CatalogAdmission.admitYAML(yaml)) { XCTAssertEqual(($0 as? CatalogRejected)?.code, "NODE_TLS") }
    }

    func testPrivateOrBenchmarkServerAddressIsRefused() {
        let yaml = SampleCatalog.yaml.replacingOccurrences(of: "server: 8.8.4.4", with: "server: 198.18.0.9")
        XCTAssertThrowsError(try CatalogAdmission.admitYAML(yaml)) { XCTAssertEqual(($0 as? CatalogRejected)?.code, "NODE_SERVER") }
    }

    func testReservedNodeNameIsRefused() {
        let yaml = SampleCatalog.yaml.replacingOccurrences(of: "name: Tokyo · Dawn", with: "name: Tono-Exit")
        XCTAssertThrowsError(try CatalogAdmission.admitYAML(yaml)) { XCTAssertEqual(($0 as? CatalogRejected)?.code, "NODE_NAME") }
    }

    func testYamlRejectsTabIndentation() {
        XCTAssertThrowsError(try CatalogYAML.parse("proxies:\n\t- name: a\n"))
    }

    func testYamlRejectsAnchorsAndDuplicateKeys() {
        XCTAssertThrowsError(try CatalogYAML.parse("proxies: &a []\n"))
        XCTAssertThrowsError(try CatalogYAML.parse("a: 1\na: 2\n"))
    }

    func testYamlKeepsHashInsideQuotesAndStripsComments() throws {
        let v = try CatalogYAML.parse("name: \"a # b\"  # comment\nother: 'it''s'\n")
        XCTAssertEqual(v["name"]?.scalar, "a # b")
        XCTAssertEqual(v["other"]?.scalar, "it's")
    }

    func testJSONRoundTripKeepsOrderAndEscapes() throws {
        let text = #"{"b":1,"a":"x\"y\né😀","c":[true,null,-2.5]}"#
        let parsed = try JSON.parse(text)
        XCTAssertEqual(parsed.object?.keys, ["b", "a", "c"])
        XCTAssertEqual(parsed["a"]?.string, "x\"y\né😀")
        XCTAssertEqual(try JSON.parse(parsed.serialized()), parsed)
        XCTAssertThrowsError(try JSON.parse(#"{"a":1,}"#))
        XCTAssertNil(JSON.number(7.5).int)
    }
}
