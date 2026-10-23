import XCTest

/// Settings as a form, on the DEBUG design preview (fixture data, no account, no tunnel): the
/// first screen holds the controls, the routing rules sit one screen down, and Sign out asks
/// first. These prove navigation, the switches' wiring and the VoiceOver labels; they say nothing
/// about the tunnel, the saved preference or routing.
final class SettingsUITests: XCTestCase {
    private static let largest = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Settings open on launch (`-TonoPreviewSheet settings`), in the given language.
    @MainActor private func launchSettings(_ lang: String = "en", phase: String = "CONNECTED", _ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-TonoPreview", phase, "-TonoReduceMotion", "-TonoPreviewSheet", "settings",
                               "-AppleLanguages", "(\(lang))", "-AppleLocale", lang == "en" ? "en_US" : "zh_CN"] + extra
        app.launch()
        XCTAssertTrue(app.buttons["settingsClose"].waitForExistence(timeout: 10), "\(lang): Settings did not open")
        return app
    }

    @MainActor private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["TONO_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    /// A list row or header by identifier, whatever element type the List exposes it as.
    @MainActor private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Back from the rules screen through the navigation bar (the sheet's close circle is not in the bar).
    @MainActor private func goBack(_ app: XCUIApplication) {
        let back = app.navigationBars.buttons.firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 4), "no back button")
        back.tap()
    }

    /// The first screen at the largest text size, both languages: the protection group is the
    /// first header and its switch is on screen and tappable without scrolling. (The old screen
    /// put five lines of explanation first and cut its first control at the bottom edge.)
    @MainActor func testLargestTextFirstScreenShowsTheProtectionSwitch() {
        for lang in ["en", "zh-Hans"] {
            let app = launchSettings(lang, phase: "DEGRADED", Self.largest)
            let toggle = app.switches["includeAllToggle"]
            XCTAssertTrue(toggle.waitForExistence(timeout: 6), "\(lang): protection switch missing")
            let header = element(app, "settingsProtectionHeader")
            XCTAssertTrue(header.exists, "\(lang): protection header missing")
            let window = app.windows.firstMatch.frame
            XCTAssertLessThan(header.frame.minY, toggle.frame.minY, "\(lang): header \(header.frame) is not above the switch \(toggle.frame)")
            XCTAssertLessThanOrEqual(toggle.frame.maxY, window.maxY, "\(lang): switch \(toggle.frame) runs past the screen \(window)")
            XCTAssertTrue(toggle.isHittable, "\(lang): switch not reachable without scrolling")
            // The List is lazy: at AX5 the rules row may not exist until scrolled. If it is laid
            // out, it comes after the switch; either way the switch is the first control.
            let rules = element(app, "settingsRoutingRules")
            if rules.exists {
                XCTAssertGreaterThan(rules.frame.minY, toggle.frame.minY, "\(lang): rules row \(rules.frame) above the switch \(toggle.frame)")
            }
            save("settings-\(lang)-ax5-first-screen")
            app.terminate()
        }
    }

    /// English, default size: the rules row carries the mode in effect and opens one screen that
    /// says where to change it; back returns; both switches flip from their row and Include all
    /// says it applies on the next connect; Sign out asks before acting and Cancel keeps Settings.
    @MainActor func testRulesAreOneScreenDownSwitchesFlipAndSignOutAsksFirst() {
        let app = launchSettings()
        save("settings-en-default-first-screen")
        let rules = element(app, "settingsRoutingRules")
        XCTAssertTrue(rules.waitForExistence(timeout: 6))
        XCTAssertTrue(rules.label.contains("Three-tier"), "mode value missing from the row: \(rules.label)")
        rules.tap()
        let scope = element(app, "routingScope")
        XCTAssertTrue(scope.waitForExistence(timeout: 6), "rules screen did not open")
        XCTAssertTrue(scope.label.hasPrefix("Order:"), scope.label)
        let whereLine = element(app, "settingsModeWhere")
        XCTAssertTrue(whereLine.waitForExistence(timeout: 4))
        XCTAssertEqual(whereLine.label, "Change in Details.")
        let threeTier = element(app, "rulesMode_THREE_TIER")
        XCTAssertTrue(threeTier.label.contains("In use"), "mode in effect not marked: \(threeTier.label)")
        XCTAssertFalse(element(app, "rulesMode_STABLE").label.contains("In use"))
        save("settings-en-rules")
        goBack(app)
        XCTAssertTrue(rules.waitForExistence(timeout: 6), "back did not return to Settings")

        let live = app.switches["liveActivityToggle"]
        XCTAssertTrue(live.waitForExistence(timeout: 4))
        let liveBefore = live.value as? String
        live.tap()
        XCTAssertNotEqual(live.value as? String, liveBefore, "Live Activity did not flip from its row")

        let include = app.switches["includeAllToggle"]
        let includeBefore = include.value as? String
        include.tap()
        XCTAssertNotEqual(include.value as? String, includeBefore, "Include all did not flip from its row")
        XCTAssertTrue(include.label.contains("Applies the next time Tono connects."), include.label)

        let signOut = app.buttons["settingsSignOut"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 4))
        if !signOut.isHittable { app.swipeUp() }
        signOut.tap()
        let sheet = app.sheets.firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 6), "Sign out acted without asking")
        XCTAssertTrue(sheet.buttons["Sign out"].exists)
        save("settings-en-sign-out-confirm")
        // The action sheet's Cancel is its own element under the sheet, not inside it.
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["settingsClose"].waitForExistence(timeout: 4), "Cancel closed Settings")
        XCTAssertFalse(sheet.exists)
    }

    /// Chinese, default size: the same first screen, rules screen and confirmation, with the
    /// Chinese copy (full-width punctuation, the mode name in the row).
    @MainActor func testChineseFirstScreenRulesAndSignOutConfirm() {
        let app = launchSettings("zh-Hans")
        save("settings-zh-default-first-screen")
        let rules = element(app, "settingsRoutingRules")
        XCTAssertTrue(rules.waitForExistence(timeout: 6))
        XCTAssertTrue(rules.label.contains("三层路由"), rules.label)
        rules.tap()
        let whereLine = element(app, "settingsModeWhere")
        XCTAssertTrue(whereLine.waitForExistence(timeout: 6), "rules screen did not open")
        XCTAssertEqual(whereLine.label, "在「详情」中切换。")
        save("settings-zh-rules")
        goBack(app)
        let signOut = app.buttons["settingsSignOut"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 6))
        if !signOut.isHittable { app.swipeUp() }
        signOut.tap()
        let sheet = app.sheets.firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 6), "Sign out acted without asking")
        XCTAssertTrue(sheet.buttons["退出登录"].exists)
        save("settings-zh-sign-out-confirm")
        app.buttons["取消"].tap()
        XCTAssertTrue(app.buttons["settingsClose"].waitForExistence(timeout: 4))
    }
}
