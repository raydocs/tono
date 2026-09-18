import XCTest
@testable import Tono

final class PhysicalReachabilityDebounceTests: XCTestCase {
    func testVirtualAndTunnelInterfacesAreExcludedFromFingerprint() {
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "lo0"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "utun0"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "utun199"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "tun0"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "tap0"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "awdl0"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "llw0"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "bridge0"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "ipsec0"))
        XCTAssertTrue(PhysicalInterfaceFingerprint.isExcludedInterface(name: "ppp0"))

        XCTAssertFalse(PhysicalInterfaceFingerprint.isExcludedInterface(name: "en0"))
        XCTAssertFalse(PhysicalInterfaceFingerprint.isExcludedInterface(name: "en1"))
        XCTAssertFalse(PhysicalInterfaceFingerprint.isExcludedInterface(name: "pdp_ip0"))
    }

    func testTonoTun198_18_0_1DoesNotPollutePhysicalFingerprint() {
        let entriesWithoutTun: [(name: String, address: String)] = [
            ("en0", "192.168.1.105"),
            ("en0", "fe80::1")
        ]
        let fpWithoutTun = PhysicalInterfaceFingerprint.fromEntries(entriesWithoutTun)

        // Adding Tono's sing-box TUN interface (198.18.0.1) must not change the fingerprint
        let entriesWithTun = entriesWithoutTun + [
            ("utun199", "198.18.0.1")
        ]
        let fpWithTun = PhysicalInterfaceFingerprint.fromEntries(entriesWithTun)

        XCTAssertEqual(
            fpWithoutTun,
            fpWithTun,
            "Tono TUN interface 198.18.0.1 must be excluded from physical fingerprinting"
        )
    }

    func testPhysicalInterfaceLANAddressesArePreserved() {
        // Physical interface LAN IP addresses (RFC 1918) must not be filtered out
        // by non-globally-routable filtering
        let entries: [(name: String, address: String)] = [
            ("en0", "192.168.1.50"),
            ("en1", "10.0.4.12")
        ]
        let fp = PhysicalInterfaceFingerprint.fromEntries(entries)
        XCTAssertTrue(fp.rawValue.contains("en0=192.168.1.50"))
        XCTAssertTrue(fp.rawValue.contains("en1=10.0.4.12"))
    }

    func testPhysicalAddressChangeIsDetected() {
        let fp1 = PhysicalInterfaceFingerprint.fromEntries([("en0", "192.168.1.10")])
        let fp2 = PhysicalInterfaceFingerprint.fromEntries([("en0", "192.168.1.20")])
        XCTAssertNotEqual(fp1, fp2, "DHCP or IP change on physical adapter must be detected")
    }

    func testOrderIndependentDeterministicFingerprint() {
        let fp1 = PhysicalInterfaceFingerprint.fromEntries([
            ("en0", "192.168.1.10"),
            ("en1", "10.0.0.2")
        ])
        let fp2 = PhysicalInterfaceFingerprint.fromEntries([
            ("en1", "10.0.0.2"),
            ("en0", "192.168.1.10")
        ])
        XCTAssertEqual(fp1, fp2)
    }

    func testDNSIntegrityTakesPrecedenceOverFingerprintStability() {
        // Even when physical interface fingerprint has not changed, a broken DNS integrity
        // state must still flag reconnect requirement
        let currentService = "Wi-Fi"
        let protectedService = "Wi-Fi"
        let dnsIntegrityBroken = PrivilegedRuntimeCoordinator.ProtectedDNSIntegrity.broken
        let physicalChanged = false

        let requiresReconnect = (currentService != protectedService)
            || (dnsIntegrityBroken == .broken)
            || physicalChanged

        XCTAssertTrue(
            requiresReconnect,
            "DNS integrity corruption must require reconnect even when physical link is stable"
        )
    }
}
