import XCTest
@testable import Tono

final class ConnectStageWireTests: XCTestCase {
    func testWireKeysMatchTheSharedStageList() {
        XCTAssertEqual(
            ConnectionStage.allCases.map(\.wireKey),
            [
                "preparing",
                "preparingService",
                "startingKillSwitch",
                "startingTunnel",
                "lockingTraffic",
                "applyingCloudPolicy",
                "securingDNS",
                "checkingExit",
                "verifyingTraffic",
            ]
        )
    }
}
