import XCTest
@testable import TonoKit

final class SeaMotionTests: XCTestCase {
    func testLowPowerStopsOnlyTheAmbientLoopsAndReduceMotionWins() {
        let lite = SeaMotion(reduceMotion: false, lowPower: true)
        XCTAssertFalse(lite.ambient)
        XCTAssertTrue(lite.status, "the reconnect cue stays in Low Power")
        let both = SeaMotion(reduceMotion: true, lowPower: true)
        XCTAssertEqual(both, .still)
        XCTAssertFalse(both.status)
        XCTAssertTrue(SeaMotion(reduceMotion: false, lowPower: false).ambient)
    }
}
