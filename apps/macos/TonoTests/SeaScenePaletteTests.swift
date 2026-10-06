import XCTest
@testable import Tono

final class SeaScenePaletteTests: XCTestCase {
    func testWaterStartsAtSkyHorizonInEveryPhase() {
        XCTAssertEqual(SeaScenePalette.forPhase(.day).water.first,
                       SeaScenePalette.forPhase(.day).sky.last)
        XCTAssertEqual(SeaScenePalette.forPhase(.dawn).water.first,
                       SeaScenePalette.forPhase(.dawn).sky.last)
        XCTAssertEqual(SeaScenePalette.forPhase(.dusk).water.first,
                       SeaScenePalette.forPhase(.dusk).sky.last)
        XCTAssertEqual(SeaScenePalette.forPhase(.blocked).water.first,
                       SeaScenePalette.forPhase(.blocked).sky.last)
        XCTAssertEqual(SeaScenePalette.forPhase(.night).water.first,
                       SeaScenePalette.forPhase(.night).sky.last)
    }
}
