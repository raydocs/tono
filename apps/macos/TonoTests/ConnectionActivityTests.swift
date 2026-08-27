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
                fixture(
                    host: "claude.ai",
                    destinationIP: "160.79.104.10",
                    chains: ["Tono-Exit"]
                )
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

    func testFlagsComeFromWholeWordsSoHomeAndChinaRoutesAreNotForeign() {
        // "Tono-Home-Residential" contains "de" and "Tono-China-Direct"
        // contains "in"; substring matching flew a German flag over home
        // traffic and an Indian one over WeChat's Tencent hops.
        XCTAssertEqual(ConfigParser.guessFlag(from: "Tono-Home-Residential"), "🌐")
        XCTAssertEqual(ConfigParser.guessFlag(from: "Tono-China-Direct"), "🌐")
        XCTAssertEqual(ConfigParser.guessFlag(from: "Tono-Claude-Home"), "🌐")
        // Real exits still resolve.
        XCTAssertEqual(ConfigParser.guessFlag(from: "Tokyo · Fuji"), "🇯🇵")
        XCTAssertEqual(ConfigParser.guessFlag(from: "US-VLESS-Reality"), "🇺🇸")
        XCTAssertEqual(ConfigParser.guessFlag(from: "Los Angeles · Sunset"), "🇺🇸")
    }

    func testTokyoWireNameResolvesToACityLikeItsWindowsCounterpart() {
        XCTAssertEqual(ProxyNode.displayName(for: "JP-VLESS-Reality"), "Tokyo · Dawn")
        // Same wire name, same codename as Windows' node-meta.ts.
        XCTAssertEqual(ProxyNode.displayName(for: "US-VLESS-Reality"), "Los Angeles · Grove")
        XCTAssertEqual(ProxyNode.displayName(for: "Tokyo · Fuji"), "Tokyo · Fuji")
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
