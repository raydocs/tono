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
///
/// Also holds the SystemProxy bounded-wait regression
/// (MAC-PROXY-PROMPT-UNBOUNDED), the only other test of SystemProxy helpers.
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

    /// R3-O5 regression: the helper's `/dns/enable` took the first service
    /// named "Wi-Fi" from every Network Location. Only the current location's
    /// services are candidates now, even when another location's same-named
    /// copy comes first or is named primary; the app's primary service ID
    /// wins among them, and a name that still matches two services without a
    /// primary among them is refused rather than guessed.
    func testDNSEnableTargetsTheServiceIDNotTheFirstSameNamedService() {
        typealias Candidate = ProtectedDNSServiceIdentity.Candidate
        let otherLocationWiFi = Candidate(id: "LOCATION-A-WIFI", name: "Wi-Fi")
        let services = [
            otherLocationWiFi,
            Candidate(id: "LOCATION-B-WIFI", name: "Wi-Fi"),
            Candidate(id: "LOCATION-B-ETHERNET", name: "Ethernet"),
        ]
        let current: Set<String> = ["LOCATION-B-WIFI", "LOCATION-B-ETHERNET"]
        XCTAssertEqual(
            ProtectedDNSServiceIdentity.select(
                named: "Wi-Fi", services: services, currentLocationIDs: current,
                primaryServiceIDs: []
            ),
            "LOCATION-B-WIFI"
        )
        XCTAssertEqual(
            ProtectedDNSServiceIdentity.select(
                named: "Wi-Fi", services: services, currentLocationIDs: current,
                primaryServiceIDs: [otherLocationWiFi.id, "LOCATION-B-WIFI"]
            ),
            "LOCATION-B-WIFI"
        )
        XCTAssertNil(
            ProtectedDNSServiceIdentity.select(
                named: "Wi-Fi", services: [otherLocationWiFi], currentLocationIDs: current,
                primaryServiceIDs: [otherLocationWiFi.id]
            )
        )

        let twins = services + [Candidate(id: "WIFI-1", name: "Wi-Fi")]
        let currentWithTwin = current.union(["WIFI-1"])
        XCTAssertEqual(
            ProtectedDNSServiceIdentity.select(
                named: "Wi-Fi", services: twins, currentLocationIDs: currentWithTwin,
                primaryServiceIDs: ["WIFI-1"]
            ),
            "WIFI-1"
        )
        XCTAssertNil(
            ProtectedDNSServiceIdentity.select(
                named: "Wi-Fi", services: twins, currentLocationIDs: currentWithTwin,
                primaryServiceIDs: ["LOCATION-B-ETHERNET"]
            )
        )
    }

    /// MAC-PROXY-PROMPT-UNBOUNDED regression: the administrator prompt behind
    /// `networksetup` used to be waited on forever, wedging every privileged
    /// coordinator caller. The bounded wait must kill a subprocess that
    /// outlives its deadline and report the timeout.
    func testBoundedWaitKillsSubprocessPastItsDeadline() throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sleep")
        process.arguments = ["5"]
        try process.run()

        let started = Date()
        let timedOut = SystemProxy.waitForExit(process, timeout: 0.5)

        XCTAssertTrue(timedOut)
        XCTAssertFalse(process.isRunning)
        XCTAssertLessThan(
            Date().timeIntervalSince(started),
            5,
            "the wait must give up well before sleep exits on its own"
        )
    }
}
