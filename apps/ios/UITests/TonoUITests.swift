import XCTest

/// Taps through the DEBUG design preview on a simulator: fixture data, no account, no network and
/// no tunnel. These tests prove the interaction wiring, the VoiceOver labels and Apple's
/// accessibility audit for each screen; they say nothing about sign-in, connectivity or routing.
/// Launched with `-TonoReduceMotion` so the sea is still and XCUITest sees an idle app.
final class TonoUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor private func launch(_ phase: String, _ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-TonoPreview", phase, "-TonoReduceMotion",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        app.launch()
        return app
    }

    @MainActor private func primary(_ app: XCUIApplication) -> XCUIElement {
        let button = app.buttons["primaryAction"]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "primary capsule missing")
        return button
    }

    /// Waits until the element's accessibility label is `label` (VoiceOver reads exactly this).
    @MainActor private func waitLabel(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 6,
                           file: StaticString = #filePath, line: UInt = #line) {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label), object: element)
        if XCTWaiter().wait(for: [done], timeout: timeout) != .completed {
            XCTFail("label stayed \"\(element.label)\", expected \"\(label)\"", file: file, line: line)
        }
    }

    @MainActor private func waitHittable(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: element)
        if XCTWaiter().wait(for: [done], timeout: 6) != .completed {
            XCTFail("\(element) never became hittable", file: file, line: line)
        }
    }

    @MainActor private func title(_ app: XCUIApplication) -> String {
        app.staticTexts.matching(identifier: "stateTitle").firstMatch.label
    }

    @MainActor func testConnectThenDisconnect() {
        let app = launch("IDLE")
        let button = primary(app)
        XCTAssertEqual(button.label, "Connect")
        button.tap()
        waitLabel(button, "Cancel connecting", timeout: 2)
        waitLabel(button, "Disconnect")
        XCTAssertEqual(title(app), "Connected")
        button.tap()
        waitLabel(button, "Connect")
        XCTAssertEqual(title(app), "Not connected")
    }

    @MainActor func testCancelWhileConnecting() {
        let app = launch("IDLE", ["-TonoPreviewSlow"])
        let button = primary(app)
        button.tap()
        waitLabel(button, "Cancel connecting", timeout: 2)
        button.tap()
        waitLabel(button, "Connect")
        XCTAssertEqual(title(app), "Not connected")
    }

    @MainActor func testFailedStartExplainsAndRetries() {
        let app = launch("IDLE", ["-TonoPreviewFailFirst"])
        let button = primary(app)
        button.tap()
        waitLabel(button, "Retry")
        XCTAssertEqual(title(app), "Didn't connect")
        // The short reason opens Details with the full reason.
        let reason = app.buttons["reasonLine"]
        XCTAssertTrue(reason.waitForExistence(timeout: 2))
        reason.tap()
        XCTAssertTrue(app.staticTexts["What happened".uppercased()].waitForExistence(timeout: 4)
                      || app.staticTexts["What happened"].exists)
        app.swipeDown(velocity: .fast)
        waitHittable(button)
        button.tap()
        waitLabel(button, "Disconnect")
    }

    @MainActor func testPermissionStepConnects() {
        let app = launch("NEEDS_PERMISSION")
        let button = primary(app)
        XCTAssertEqual(button.label, "Allow VPN")
        button.tap()
        waitLabel(button, "Disconnect")
    }

    @MainActor func testSettingsReachableFromDetailsAndCloses() {
        let app = launch("CONNECTED")
        let details = app.buttons["detailsButton"]
        XCTAssertTrue(details.waitForExistence(timeout: 6))
        details.tap()
        let settingsRow = app.buttons["detailsSettings"]
        XCTAssertTrue(settingsRow.waitForExistence(timeout: 4))
        settingsRow.tap()
        let close = app.buttons["settingsClose"]
        XCTAssertTrue(close.waitForExistence(timeout: 6))
        XCTAssertEqual(close.label, "Close settings")
        close.tap()
        waitHittable(primary(app))
    }

    @MainActor func testLinePickerSelectsAndCloses() {
        let app = launch("CONNECTED")
        let exit = app.buttons["exitCapsule"]
        XCTAssertTrue(exit.waitForExistence(timeout: 6))
        XCTAssertTrue(exit.label.hasPrefix("Lines: "), exit.label)
        exit.tap()
        let other = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Los Angeles")).firstMatch
        XCTAssertTrue(other.waitForExistence(timeout: 4))
        other.tap()
        XCTAssertTrue(exit.waitForExistence(timeout: 4))
        let picked = NSPredicate(format: "label CONTAINS %@", "Los Angeles")
        let done = XCTNSPredicateExpectation(predicate: picked, object: exit)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: 4), .completed, exit.label)
    }

    // MARK: - Apple accessibility audit (contrast, hit regions, Dynamic Type, labels, clipping)

    @MainActor func testAccessibilityAuditHomeStates() throws {
        for phase in ["SIGNED_OUT", "IDLE", "CONNECTING", "CONNECTED", "DEGRADED", "FAILED"] {
            try audit(launch(phase), name: "home-\(phase)")
        }
    }

    @MainActor func testAccessibilityAuditSheets() throws {
        for sheet in ["lines", "details", "settings"] {
            try audit(launch("DEGRADED", ["-TonoPreviewSheet", sheet]), name: "sheet-\(sheet)")
        }
    }

    @MainActor func testAccessibilityAuditLargestText() throws {
        try audit(launch("CONNECTED", ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]),
                  name: "largest-text-connected")
        try audit(launch("SIGNED_OUT", ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]),
                  name: "largest-text-signin")
    }

    @MainActor private func audit(_ app: XCUIApplication, name: String) throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs an iOS 17+ runtime") }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        sleep(2)
        try app.performAccessibilityAudit { issue in
            let element = issue.element
            // The yellow DEBUG badge is not part of the product (compiled out of Release).
            if element?.identifier == "previewBadge" { return true }
            print("AUDIT \(name): [\(issue.auditType)] \(issue.compactDescription) — \(element?.debugDescription.prefix(200) ?? "no element")")
            return false
        }
    }
}
