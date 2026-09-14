import XCTest

final class CompanionUITests: XCTestCase {
    @MainActor func testPreviewClearlyLabelsNoVPNAndOffersLocations() {
        let app = XCUIApplication()
        app.launchEnvironment["TONO_PREVIEW_STATE"] = "protected"
        app.launch()
        XCTAssertTrue(app.staticTexts["preview.banner"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["home.action"].isEnabled)
        app.buttons["home.locations"].tap()
        XCTAssertTrue(app.navigationBars["Location"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Japan"].exists)
        app.buttons["Japan"].tap()
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Preview location selection — not network verification"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
