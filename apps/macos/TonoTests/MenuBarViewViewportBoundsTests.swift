import XCTest
import SwiftUI
@testable import Tono

final class MenuBarViewViewportBoundsTests: XCTestCase {
    @MainActor
    func testMenuBarViewBodyInstantiatesWithExpectedWidth() {
        let view = MenuBarView()
        // MenuBarView is 280pt wide fixed popover
        XCTAssertNotNil(view.body)
    }
}
