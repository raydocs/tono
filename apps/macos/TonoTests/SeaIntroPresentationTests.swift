import XCTest
@testable import Tono

final class SeaIntroPresentationTests: XCTestCase {
    func testThreeIllustrativePanelsAdvanceToFinalStepOnlyOnce() {
        XCTAssertEqual(SeaIntroStep.connected.next, .offline)
        XCTAssertEqual(SeaIntroStep.offline.next, .routes)
        XCTAssertNil(SeaIntroStep.routes.next)
        XCTAssertEqual(SeaIntroStep.routes.previous, .offline)
        XCTAssertEqual(SeaIntroStep.connected.scenePhase, .day)
        XCTAssertEqual(SeaIntroStep.offline.scenePhase, .blocked)
        XCTAssertEqual(SeaIntroStep.routes.scenePhase, .night)
    }
}
