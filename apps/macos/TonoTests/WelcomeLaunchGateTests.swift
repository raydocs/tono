import XCTest
@testable import Tono

@MainActor
final class WelcomeLaunchGateTests: XCTestCase {
    func testIntroWhenUnseenAndSignedOut() {
        XCTAssertTrue(
            WelcomeLaunchGate.showsIntro(introSeen: false, sessionState: .signedOut)
        )
        XCTAssertTrue(
            WelcomeLaunchGate.showsIntro(
                introSeen: false,
                sessionState: .error("offline")
            )
        )
    }

    func testGateWhenIntroAlreadySeen() {
        XCTAssertFalse(
            WelcomeLaunchGate.showsIntro(introSeen: true, sessionState: .signedOut)
        )
        XCTAssertFalse(
            WelcomeLaunchGate.showsIntro(
                introSeen: true,
                sessionState: .error("offline")
            )
        )
        XCTAssertFalse(
            WelcomeLaunchGate.showsIntro(introSeen: true, sessionState: .ready)
        )
    }

    func testSignedInNeverShowsIntro() {
        XCTAssertFalse(
            WelcomeLaunchGate.showsIntro(introSeen: false, sessionState: .ready)
        )
        XCTAssertFalse(
            WelcomeLaunchGate.showsIntro(introSeen: false, sessionState: .enrolling)
        )
        XCTAssertFalse(
            WelcomeLaunchGate.showsIntro(introSeen: false, sessionState: .suspended)
        )
    }

    func testRestoringDoesNotFlashIntro() {
        XCTAssertFalse(
            WelcomeLaunchGate.showsIntro(introSeen: false, sessionState: .restoring)
        )
    }
}
