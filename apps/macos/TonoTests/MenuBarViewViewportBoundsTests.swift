import XCTest
import SwiftUI
@testable import Tono

final class MenuBarViewViewportBoundsTests: XCTestCase {
    func testMenuBarViewDefaultWidth() {
        let view = MenuBarView()
        _ = view
        // MenuBarView is 280pt wide fixed popover
        XCTAssertEqual(MenuBarView.popoverWidth, 280)
    }

    func testPopoverHeightClampingAcrossScreenSizes() {
        // Small screen: visible frame 150pt -> clamped to max(120, 150 - 80) = 120
        XCTAssertEqual(MenuBarView.clampedPopoverHeight(for: 150), 120)

        // Medium small screen: visible frame 300pt -> 300 - 80 = 220
        XCTAssertEqual(MenuBarView.clampedPopoverHeight(for: 300), 220)

        // Standard laptop: visible frame 800pt -> capped at max 480pt
        XCTAssertEqual(MenuBarView.clampedPopoverHeight(for: 800), 480)

        // Large 4K/5K monitor: visible frame 1400pt -> capped at max 480pt
        XCTAssertEqual(MenuBarView.clampedPopoverHeight(for: 1400), 480)
    }
}
