import XCTest
@testable import Tono

@MainActor
final class LaunchDNSRepairTests: XCTestCase {
    func testRepairedHelperRestoresDNSWithoutSnapshot() async throws {
        var events: [String] = []
        let repaired = try await RuntimeCleanup.repairProtectedDNSAtLaunch(
            prepareHelper: { events.append("repair") },
            status: {
                events.append("status")
                return (available: true, configured: false, snapshotPresent: false, service: nil)
            },
            restoreDNS: {
                events.append("restore")
                return true
            }
        )

        XCTAssertTrue(repaired)
        XCTAssertEqual(events, ["repair", "status", "restore"])
    }
}
