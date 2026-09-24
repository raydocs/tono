import XCTest
@testable import Tono

/// X2-3 regression: with no IPv4 default route to map, Protected DNS picked
/// the first service named "Wi-Fi" even while Ethernet carried the traffic,
/// then wrote 127.0.0.1 to the idle adapter and audited only that adapter.
/// The service must come from the primary macOS itself elected.
final class ProtectedDNSServiceSelectionTests: XCTestCase {

    func testIPv6PrimaryEthernetIsSelectedOverEnabledWiFiWithoutIPv4Default() {
        let observation = SystemNetworkObservation(
            ipv4PrimaryServiceID: nil,
            ipv6PrimaryServiceID: "ETHERNET-ID",
            serviceNames: [
                "WIFI-ID": "Wi-Fi",
                "ETHERNET-ID": "Ethernet",
            ],
            effectiveDNSServers: ["fe80::1%en7"]
        )

        XCTAssertEqual(observation.primaryServiceName, "Ethernet")
    }
}
