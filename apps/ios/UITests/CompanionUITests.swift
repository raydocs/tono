import XCTest

final class CompanionUITests: XCTestCase {
    @MainActor func testMalformedSessionExposesForgetThenCleanupRetryThenEmailLogin() {
        let app = XCUIApplication()
        app.launchEnvironment["TONO_PREVIEW_STATE"] = ""
        app.launchEnvironment["TONO_ACCOUNT_FIXTURE"] = "malformed-session"
        app.launch()
        XCTAssertTrue(app.alerts["Tono"].waitForExistence(timeout: 5))
        app.alerts["Tono"].buttons["OK"].tap()
        let recovery = app.buttons["login.retry"]
        XCTAssertTrue(recovery.waitForExistence(timeout: 3))
        XCTAssertEqual(recovery.label, "Forget saved sign-in")
        XCTAssertTrue(recovery.isHittable)
        XCTAssertFalse(app.textFields["login.email"].exists)
        XCTAssertFalse(app.buttons["home.action"].exists)
        recovery.tap() // injected first deletion failure; production cleanup path creates the marker
        XCTAssertTrue(app.alerts["Tono"].waitForExistence(timeout: 3))
        app.alerts["Tono"].buttons["OK"].tap()
        XCTAssertEqual(recovery.label, "Retry sign-out cleanup")
        XCTAssertTrue(recovery.isHittable)
        XCTAssertFalse(app.textFields["login.email"].exists)
        recovery.tap()
        XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 3))
        XCTAssertFalse(recovery.exists)
        XCTAssertFalse(app.buttons["home.action"].exists)
    }

    @MainActor func testPreviewClearlyLabelsNoVPNAndOffersLocations() {
        let app = XCUIApplication()
        app.launchEnvironment["TONO_PREVIEW_STATE"] = "protected"
        app.launchEnvironment["TONO_ACCOUNT_FIXTURE"] = ""
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
