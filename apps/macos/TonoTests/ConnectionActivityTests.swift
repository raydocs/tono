import XCTest
@testable import Tono

final class ConnectionActivityTests: XCTestCase {
    func testLoopbackDnsIsHiddenFromTheActivityList() {
        let dns = fixture(
            host: "",
            destinationIP: "127.0.0.1",
            destinationPort: "53",
            chains: ["DIRECT"]
        )
        XCTAssertTrue(ConnectionActivityPresentation.isLoopback(dns))
        XCTAssertFalse(
            ConnectionActivityPresentation.isLoopback(
                fixture(host: "claude.ai", destinationIP: "160.79.104.10")
            )
        )
    }

    func testResidentialChainIsHomeNotCloud() {
        let home = fixture(
            host: "api.anthropic.com",
            chains: [ConfigPipeline.homeResidentialProxyName, ConfigPipeline.claudeHomeGroupName]
        )
        XCTAssertEqual(ConnectionActivityPresentation.type(for: home), .home)

        let cloud = fixture(host: "example.com", chains: ["Tono-Exit", "Tokyo"])
        XCTAssertEqual(ConnectionActivityPresentation.type(for: cloud), .proxied)
    }

    func testDisplayCapMatchesTheWindowsActivityWindow() {
        XCTAssertEqual(ConnectionActivityPresentation.maxDisplayed, 2_000)
    }

    private func fixture(
        host: String,
        destinationIP: String = "203.0.113.10",
        destinationPort: String = "443",
        chains: [String]
    ) -> APIConnection {
        APIConnection(
            id: "c-\(host)",
            metadata: APIConnectionMetadata(
                network: "tcp",
                type: "TCP",
                process: nil,
                processPath: nil,
                sourceIP: "198.18.0.1",
                destinationIP: destinationIP,
                sourcePort: "1",
                destinationPort: destinationPort,
                host: host
            ),
            upload: 0,
            download: 0,
            start: "0",
            chains: chains,
            rule: "Match",
            rulePayload: nil
        )
    }
}
