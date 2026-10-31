import XCTest
@testable import TonoKit

final class SceneAnimationPolicyTests: XCTestCase {
    func testSceneKeepsMovingWhileSeenAndHoldsStillOnlyWhenUnseenOrCritical() {
        func interval(active: Bool = true, sheet: Bool = false, lowPower: Bool = false,
                      thermal: SceneAnimationPolicy.Thermal = .nominal) -> Double? {
            SceneAnimationPolicy.frameInterval(appActive: active, sheetCovering: sheet, lowPowerMode: lowPower, thermal: thermal)
        }
        XCTAssertEqual(interval(), 1.0 / 30)
        XCTAssertEqual(interval(lowPower: true), 1.0 / 15)
        XCTAssertEqual(interval(thermal: .serious), 1.0 / 15)
        XCTAssertNil(interval(active: false))
        XCTAssertNil(interval(sheet: true))
        XCTAssertNil(interval(thermal: .critical))
    }
}
