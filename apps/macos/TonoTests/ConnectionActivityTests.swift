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
        XCTAssertEqual(ProxyNode.displayName(for: "Tokyo · Fuji · hy2"), "Tokyo · Fuji")
        XCTAssertEqual(ProxyNode.catalogBaseName(for: "Tokyo · Sakura · hy2"), "Tokyo · Sakura")
        let hy2 = ProxyNode(id: "hy2", flag: "🇯🇵", name: "Tokyo · Sakura · hy2", type: .hysteria2)
        XCTAssertEqual(hy2.displayName, "Tokyo · Sakura")
        XCTAssertEqual(hy2.protocolType, String(localized: "Backup channel"))
        XCTAssertNotEqual(hy2.protocolType, "Hysteria2")
        let names: Set<String> = [
            "Tokyo · Sakura",
            "Tokyo · Sakura · hy2",
            "Los Angeles · Sunset",
        ]
        XCTAssertEqual(
            ProxyNode.backupChannelName(selected: "Tokyo · Sakura", catalogNames: names),
            "Tokyo · Sakura · hy2"
        )
        XCTAssertNil(ProxyNode.backupChannelName(selected: "Tokyo · Sakura · hy2", catalogNames: names))
        // No sibling here, but Tokyo hy2 is still a remaining next hand.
        XCTAssertEqual(
            ProxyNode.backupChannelName(selected: "Los Angeles · Sunset", catalogNames: names),
            "Tokyo · Sakura · hy2"
        )
        XCTAssertEqual(
            ProxyNode.backupChannelName(
                selected: "Tokyo · Sakura",
                catalogNames: ["Tokyo · Sakura", "Los Angeles · Sunset", "Los Angeles · Sunset · hy2"]
            ),
            "Los Angeles · Sunset · hy2"
        )
        XCTAssertEqual(
            ProxyNode.backupChannelName(
                selected: "Tokyo · Sakura · hy2",
                catalogNames: ["Tokyo · Sakura · hy2", "Los Angeles · Sunset · hy2"]
            ),
            "Los Angeles · Sunset · hy2"
        )
        XCTAssertNil(
            ProxyNode.backupChannelName(
                selected: "Tokyo · Sakura",
                catalogNames: ["Tokyo · Sakura", "Los Angeles · Sunset"]
            )
        )
        XCTAssertEqual(
            ProxyNode.backupChannelName(
                selected: "🇯🇵 Tokyo · Sakura",
                catalogNames: names
            ),
            "Tokyo · Sakura · hy2"
        )
        XCTAssertEqual(
            ProxyNode.backupChannelName(
                selected: "Tokyo · Sakura",
                catalogNames: ["🇯🇵 Tokyo · Sakura", "🇯🇵 Tokyo · Sakura · hy2"]
            ),
            "🇯🇵 Tokyo · Sakura · hy2"
        )
        let bothCities: Set<String> = [
            "Tokyo · Sakura",
            "Tokyo · Sakura · hy2",
            "Los Angeles · Sunset",
            "Los Angeles · Sunset · hy2",
        ]
        XCTAssertEqual(
            ProxyNode.backupChannelName(selected: "Tokyo · Sakura", catalogNames: bothCities),
            "Los Angeles · Sunset · hy2"
        )
        XCTAssertEqual(
            ProxyNode.backupChannelName(selected: "Los Angeles · Sunset", catalogNames: bothCities),
            "Los Angeles · Sunset · hy2"
        )
        XCTAssertEqual(
            ProxyNode.backupChannelName(selected: "JP-VLESS-Reality", catalogNames: bothCities),
            "Los Angeles · Sunset · hy2"
        )
        let dedirockFleet: Set<String> = [
            "JP-VLESS-Reality",
            "Buffalo · Niagara", "Buffalo · Niagara · hy2",
            "Buffalo · Erie", "Buffalo · Erie · hy2",
            "Los Angeles · Sunset", "Los Angeles · Sunset · hy2",
            "Los Angeles · Mesa", "Los Angeles · Mesa · hy2",
            "US-VLESS-Reality", "US-VLESS-Reality · hy2",
        ]
        XCTAssertFalse(ProxyNode.hy2UdpIsVendorBlocked("US-VLESS-Reality · hy2"))
        XCTAssertFalse(ProxyNode.hy2UdpIsVendorBlocked("Buffalo · Niagara · hy2"))
        XCTAssertEqual(
            ProxyNode.backupChannelName(selected: "US-VLESS-Reality", catalogNames: dedirockFleet),
            "US-VLESS-Reality · hy2"
        )
        let tokyoHand = ProxyNode.backupChannelName(
            selected: "JP-VLESS-Reality",
            catalogNames: dedirockFleet
        )
        XCTAssertNotNil(tokyoHand)
        XCTAssertFalse(ProxyNode.hy2UdpIsVendorBlocked(tokyoHand!))
        XCTAssertTrue(ProxyNode.isHy2CatalogName(tokyoHand!))
        XCTAssertNotEqual(tokyoHand, "JP-VLESS-Reality · hy2")
        XCTAssertTrue(ProxyNode.hy2UdpIsVendorBlocked("Tokyo · Sakura · hy2"))
        XCTAssertFalse(ProxyNode.hy2UdpIsVendorBlocked("Tokyo · Sakura"))
        XCTAssertTrue(ProxyNode.hy2UdpIsVendorBlocked("JP-VLESS-Reality · hy2"))
        XCTAssertFalse(ProxyNode.hy2UdpIsVendorBlocked("Los Angeles · Sunset · hy2"))
        XCTAssertTrue(ProxyNode.isHy2CatalogName("Tokyo · Sakura · hy2"))
        XCTAssertFalse(ProxyNode.isHy2CatalogName("Tokyo · Sakura"))
        XCTAssertEqual(nodeRouteTitle(for: "Tokyo · Sakura"), nodeCityTitle("Tokyo · Sakura"))
        XCTAssertEqual(
            nodeRouteTitle(for: "Tokyo · Sakura · hy2"),
            "\(nodeCityTitle("Tokyo · Sakura")) · Sakura · \(String(localized: "Backup channel"))"
        )
        XCTAssertEqual(
            nodeRouteTitle(for: "🇯🇵 Tokyo · Sakura · hy2"),
            "\(nodeCityTitle("Tokyo · Sakura")) · Sakura · \(String(localized: "Backup channel"))"
        )
        XCTAssertEqual(
            nodeListRegionCode(flag: "", name: "Los Angeles · Sunset · hy2"),
            udpBackupRegionCode
        )
        XCTAssertEqual(nodeListRegionCode(flag: "", name: "Los Angeles · Sunset"), "US")
        XCTAssertEqual(nodeListRegionLabel(udpBackupRegionCode), String(localized: "Backup UDP"))
        XCTAssertFalse(
            ProxyNode.isCityFailoverCandidate("Tokyo · Sakura · hy2", after: "Tokyo · Sakura")
        )
        XCTAssertFalse(
            ProxyNode.isCityFailoverCandidate("Tokyo · Sakura", after: "Tokyo · Sakura · hy2")
        )
        XCTAssertTrue(
            ProxyNode.isCityFailoverCandidate("Buffalo · Niagara", after: "Tokyo · Sakura")
        )
        XCTAssertTrue(
            ProxyNode.isCityFailoverCandidate("Buffalo · Niagara", after: "Tokyo · Sakura · hy2")
        )
        XCTAssertFalse(
            ProxyNode.isCityFailoverCandidate(
                "🇯🇵 Tokyo · Sakura · hy2",
                after: "Tokyo · Sakura"
            )
        )
        XCTAssertTrue(
            ManualBackupChannelOffer.shouldShow(
                hasSibling: true,
                protectionBlocked: false,
                connecting: false,
                connected: false,
                disconnecting: false,
                hasFailureRecord: true
            )
        )
        XCTAssertFalse(
            ManualBackupChannelOffer.shouldShow(
                hasSibling: true,
                protectionBlocked: false,
                connecting: false,
                connected: false,
                disconnecting: false,
                hasFailureRecord: false
            )
        )
        XCTAssertTrue(
            ManualBackupChannelOffer.shouldShow(
                hasSibling: true,
                protectionBlocked: true,
                connecting: false,
                connected: false,
                disconnecting: false,
                hasFailureRecord: false
            )
        )
        XCTAssertTrue(
            ReleasedConnectFailureActions.shouldOfferRetryAndRoute(
                protectionBlocked: false,
                connecting: false,
                disconnecting: false,
                hasFailureRecord: true
            )
        )
        XCTAssertFalse(
            ReleasedConnectFailureActions.shouldOfferRetryAndRoute(
                protectionBlocked: false,
                connecting: false,
                disconnecting: false,
                hasFailureRecord: false
            )
        )
        XCTAssertFalse(
            ReleasedConnectFailureActions.shouldOfferRetryAndRoute(
                protectionBlocked: true,
                connecting: false,
                disconnecting: false,
                hasFailureRecord: true
            )
        )
        XCTAssertFalse(CatalogCityFailover.shouldRotate(after: .coreExitUnreachable))
        XCTAssertFalse(CatalogCityFailover.shouldRotate(after: .unknownClassifiedFailure))
        XCTAssertFalse(CatalogCityFailover.shouldRotate(after: nil))
        XCTAssertTrue(
            ProtectedFailureCode.coreExitUnreachable.userMessage
                .localizedCaseInsensitiveContains("backup")
        )
        XCTAssertTrue(IdleCatalogSelect.shouldConnect(connected: false, protectionBlocked: false))
        XCTAssertFalse(IdleCatalogSelect.shouldConnect(connected: false, protectionBlocked: true))
        XCTAssertFalse(IdleCatalogSelect.shouldConnect(connected: true, protectionBlocked: false))
        XCTAssertFalse(
            IdleCatalogSelect.shouldConnect(
                connected: false,
                protectionBlocked: false,
                connecting: true
            )
        )
        XCTAssertTrue(
            IdleCatalogSelect.shouldRetryProtected(connected: false, protectionBlocked: true)
        )
        XCTAssertFalse(
            IdleCatalogSelect.shouldRetryProtected(connected: false, protectionBlocked: false)
        )
        XCTAssertFalse(
            IdleCatalogSelect.shouldRetryProtected(connected: true, protectionBlocked: true)
        )
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
