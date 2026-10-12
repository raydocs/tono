import XCTest
@testable import Tono

final class SeaBackdropDimTests: XCTestCase {
    func testInnerPagesKeepADimmedSceneUnlessTransparencyIsReduced() {
        XCTAssertEqual(SeaBackdropDim.resolve(home: true, reduceTransparency: false),
                       SeaBackdropDim(sceneOpacity: 1, sceneBlur: 0, groundOpacity: 0))
        let inner = SeaBackdropDim.resolve(home: false, reduceTransparency: false)
        XCTAssertGreaterThan(inner.sceneOpacity, 0)
        XCTAssertLessThan(inner.sceneOpacity, 1)
        XCTAssertGreaterThan(inner.sceneBlur, 0)
        XCTAssertLessThan(inner.groundOpacity, 1)
        XCTAssertEqual(SeaBackdropDim.resolve(home: false, reduceTransparency: true),
                       SeaBackdropDim(sceneOpacity: 0, sceneBlur: 0, groundOpacity: 1))
    }
}
