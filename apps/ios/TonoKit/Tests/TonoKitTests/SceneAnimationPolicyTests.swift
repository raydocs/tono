import XCTest
@testable import TonoKit

final class SceneAnimationPolicyTests: XCTestCase {
    func testSceneRunsInTheForegroundAndHoldsItsFrameWhenUnseenOrPowerIsShort() {
        func paused(active: Bool = true, sheet: Bool = false, lowPower: Bool = false,
                    thermal: SceneAnimationPolicy.Thermal = .nominal) -> Bool {
            SceneAnimationPolicy.paused(appActive: active, sheetCovering: sheet, lowPowerMode: lowPower, thermal: thermal)
        }
        XCTAssertFalse(paused())
        XCTAssertFalse(paused(thermal: .fair))
        XCTAssertTrue(paused(active: false))
        XCTAssertTrue(paused(sheet: true))
        XCTAssertTrue(paused(lowPower: true))
        XCTAssertTrue(paused(thermal: .serious))
        XCTAssertTrue(paused(thermal: .critical))
    }
}
