import XCTest
@testable import Tono

/// X2-3 regression: Protected DNS wrote 127.0.0.1 to Wi-Fi while Ethernet
/// carried the traffic, then audited only Wi-Fi.
///
/// The old `primaryNetworkService()` mapped the IPv4 default interface (en7)
/// through `networksetup -listnetworkserviceorder`, whose output is
///
///     (1) Ethernet
///     (Hardware Port: Ethernet, Device: en7)
///     (2) Wi-Fi
///     (Hardware Port: Wi-Fi, Device: en0)
///
/// The parser treated every line starting with "(" as a service header, so
/// the device lines were swallowed as services with an empty name and the
/// `Device:` branch never ran. The mapping always failed and the function
/// fell back to the first service named "Wi-Fi" — here the idle adapter.
/// This test cannot be run against that code (it has no `observe:` seam and
/// the old path shelled out), so the red state is that reasoning plus a
/// compile failure, not a recorded failing run.
final class ProtectedDNSServiceSelectionTests: XCTestCase {

    func testWiredIPv4PrimaryIsSelectedWhileWiFiIsAlsoUp() {
        let observation = SystemNetworkObservation(
            ipv4PrimaryServiceID: "ETHERNET-ID",
            ipv6PrimaryServiceID: "ETHERNET-ID",
            serviceNames: [
                "WIFI-ID": "Wi-Fi",
                "ETHERNET-ID": "Ethernet",
            ],
            effectiveDNSServers: ["192.168.1.1"]
        )

        XCTAssertEqual(
            SystemProxy.primaryNetworkService(observe: { observation }),
            "Ethernet"
        )
    }
}
