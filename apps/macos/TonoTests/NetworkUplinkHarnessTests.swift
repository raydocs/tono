import XCTest
@testable import Tono

/// Simulated network-change harness. XCTest cannot switch Wi-Fi, sleep the
/// Mac, or drive SCDynamicStore. Each test is one uplink reading against a
/// baseline; `NetworkUplinkSnapshot.classify` is the decision the connected
/// reconciler and the one-minute audit both use. `.moved` is the only verdict
/// that may stop the tunnel. PF is not touched here.
final class NetworkUplinkHarnessTests: XCTestCase {
    private let homeWiFi = NetworkUplinkSnapshot(
        primaryService: "Wi-Fi",
        primaryInterface: "en0",
        ipv4Address: "192.168.1.40",
        ipv4Gateway: "192.168.1.1",
        ipv6Gateway: "fe80::1"
    )

    func testDockingEthernetDoesNotCountAsARoam() {
        // The old fingerprint hashed every up IPv4 address, so en1 appearing
        // while en0 stayed the default route scheduled a protected reconnect.
        let before = PhysicalInterfaceFingerprint.fromEntries([
            ("en0", "192.168.1.40")
        ])
        let docked = PhysicalInterfaceFingerprint.fromEntries([
            ("en0", "192.168.1.40"),
            ("en1", "10.0.0.5")
        ])
        XCTAssertNotEqual(before, docked)
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: homeWiFi, to: homeWiFi),
            .stay,
            "the default uplink is unchanged when another adapter gains an address"
        )
    }

    func testPublicWiFiToHomeWiFiMoves() {
        var cafe = homeWiFi
        cafe.ipv4Address = "10.8.0.14"
        cafe.ipv4Gateway = "10.8.0.1"
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: cafe, to: homeWiFi),
            .moved
        )
    }

    func testSameAddressWithANewGatewayMoves() {
        var renewed = homeWiFi
        renewed.ipv4Gateway = "192.168.1.254"
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: homeWiFi, to: renewed),
            .moved,
            "a DHCP renew that keeps the address and replaces the router is a move"
        )
    }

    func testWiFiToEthernetMoves() {
        let ethernet = NetworkUplinkSnapshot(
            primaryService: "Ethernet",
            primaryInterface: "en7",
            ipv4Address: "10.0.0.20",
            ipv4Gateway: "10.0.0.1",
            ipv6Gateway: "fe80::2"
        )
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: homeWiFi, to: ethernet),
            .moved
        )
    }

    func testDHCPGapIsInconclusiveAndMustNotTearTheTunnelDown() {
        var gap = homeWiFi
        gap.ipv4Address = nil
        gap.ipv4Gateway = nil
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: homeWiFi, to: gap),
            .inconclusive
        )
    }

    func testAPIPADuringRenewalIsNotANewNetwork() {
        var apipa = homeWiFi
        apipa.ipv4Address = "169.254.12.8"
        apipa.ipv4Gateway = "0.0.0.0"
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: homeWiFi, to: apipa),
            .inconclusive
        )
    }

    func testSameSubnetRoamStays() {
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: homeWiFi, to: homeWiFi),
            .stay,
            "an AP roam that keeps the address and the gateway keeps the tunnel"
        )
    }

    func testIPv6OnlyGatewayChangeMoves() {
        let left = NetworkUplinkSnapshot(
            primaryService: "Wi-Fi",
            primaryInterface: "en0",
            ipv4Address: nil,
            ipv4Gateway: nil,
            ipv6Gateway: "fe80::1"
        )
        var right = left
        right.ipv6Gateway = "fe80::2"
        XCTAssertEqual(NetworkUplinkSnapshot.classify(from: left, to: right), .moved)
    }

    func testDualStackIPv6RouterChurnDoesNotMove() {
        var churn = homeWiFi
        churn.ipv6Gateway = "fe80::abcd"
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: homeWiFi, to: churn),
            .stay,
            "IPv6 router advertisements must not black-hole a stable IPv4 uplink"
        )
    }

    func testUnreadablePrimaryIsInconclusive() {
        let missing = NetworkUplinkSnapshot(
            primaryService: nil,
            primaryInterface: nil,
            ipv4Address: nil,
            ipv4Gateway: nil,
            ipv6Gateway: nil
        )
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(from: homeWiFi, to: missing),
            .inconclusive,
            "a store miss is not proof the uplink moved"
        )
    }

    func testMissingBaselineAdoptsAMatchingService() {
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(
                from: nil,
                to: homeWiFi,
                protectedService: "Wi-Fi"
            ),
            .adopt
        )
    }

    func testMissingBaselineTreatsADifferentServiceAsAMove() {
        XCTAssertEqual(
            NetworkUplinkSnapshot.classify(
                from: nil,
                to: homeWiFi,
                protectedService: "Ethernet"
            ),
            .moved
        )
    }
}
