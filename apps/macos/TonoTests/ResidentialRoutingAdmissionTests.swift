import XCTest
@testable import Tono

final class ResidentialRoutingAdmissionTests: XCTestCase {
    func testMalformedResidentialDirectivesCannotDecodeAsNoHomeRoute() {
        for routing in [
            #"{"homeProxy":17}"#,
            #"{"homeSocks5":"not-an-upstream"}"#,
            #"{"homeSocks5":{"host":"home.example","port":"bad","username":"u","password":"p"}}"#,
            #"{"homeSocks5":{"host":"home.example","port":11080,"username":"u"}}"#,
            #"[]"#,
        ] {
            let json = #"{"revision":1,"yaml":"proxies: []","sha256":"test","routing":\#(routing)}"#
            XCTAssertThrowsError(try JSONDecoder().decode(TonoExitCatalogResponse.self, from: Data(json.utf8)), routing)
        }
    }

    func testCatalogAdmissionRejectsMissingOrInvalidDeclaredHomeBeforePersistence() throws {
        XCTAssertThrowsError(try ConfigPipeline.validateRequiredResidentialRouting(
            .init(homeProxy: "missing-home"), nodes: []
        ))
        XCTAssertThrowsError(try ConfigPipeline.validateRequiredResidentialRouting(
            .init(homeSocks5: .init(host: "home.example", port: 11080, username: "u", password: "")),
            nodes: []
        ))
        XCTAssertNoThrow(try ConfigPipeline.validateRequiredResidentialRouting(
            .init(defaultProxy: "missing-default"), nodes: []
        ))
        XCTAssertNoThrow(try ConfigPipeline.validateRequiredResidentialRouting(
            .init(homeProxy: "ignored-name", homeSocks5: .init(
                host: "home.example", port: 11080, username: "u", password: "p"
            )), nodes: []
        ))
    }

    func testAbsentHomeAndAnInvalidDefaultHintStillDecode() throws {
        let json = #"{"revision":1,"yaml":"proxies: []","sha256":"test","routing":{"defaultProxy":17}}"#
        let decoded = try JSONDecoder().decode(TonoExitCatalogResponse.self, from: Data(json.utf8))
        XCTAssertNil(decoded.routing?.homeProxy)
        XCTAssertNil(decoded.routing?.homeSocks5)
        XCTAssertNil(decoded.routing?.defaultProxy)
    }
}
