import UIKit
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

    @MainActor func testPermissionStepExplainsBeforeTheSystemPromptThenConnects() {
        let app = launch("NEEDS_PERMISSION")
        let button = primary(app)
        XCTAssertEqual(button.label, "Allow VPN")
        button.tap()
        // The primer comes first; "Not now" leaves the state as it was.
        XCTAssertTrue(app.staticTexts["primerTitle"].waitForExistence(timeout: 4))
        app.buttons["primerLater"].tap()
        waitHittable(button)
        XCTAssertEqual(title(app), "Needs permission")
        button.tap()
        let proceed = app.buttons["primerContinue"]
        XCTAssertTrue(proceed.waitForExistence(timeout: 4))
        proceed.tap()
        waitLabel(button, "Disconnect")
    }

    @MainActor func testOnboardingLeadsToSignIn() {
        let app = launch("SIGNED_OUT", ["-TonoPreviewOnboarding"])
        XCTAssertTrue(app.staticTexts["onboardTitle"].waitForExistence(timeout: 6))
        XCTAssertFalse(app.buttons["primaryAction"].exists)
        app.buttons["onboardContinue"].tap()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 4), "sign-in email field after onboarding")
    }

    @MainActor func testNetworkChangeSaysReconnecting() {
        let app = launch("CONNECTING", ["-TonoPreviewReason", "NETWORK_CHANGED"])
        let status = app.staticTexts["statusLine"]
        XCTAssertTrue(status.waitForExistence(timeout: 6))
        XCTAssertEqual(title(app), "Reconnecting")
        XCTAssertEqual(status.label, "Network changed")
        XCTAssertEqual(primary(app).label, "Cancel connecting")
    }

    @MainActor func testDroppedConnectionExplainsAndOffersRetry() {
        let app = launch("FAILED", ["-TonoPreviewReason", "CORE_STOPPED"])
        let reason = app.buttons["reasonLine"]
        XCTAssertTrue(reason.waitForExistence(timeout: 6))
        // A session that dropped is not a start that failed ("Didn't connect").
        XCTAssertEqual(title(app), "Connection dropped")
        XCTAssertEqual(reason.label, "iOS will try to reconnect")
        XCTAssertEqual(primary(app).label, "Retry")
    }

    /// The cloud exit is not answering: "Other line" in Details leads to the line picker, not just
    /// back to Home.
    @MainActor func testCloudFailureOtherLineOpensTheLinePicker() {
        let app = launch("FAILED", ["-TonoPreviewReason", "CLOUD_UNREACHABLE"])
        let reason = app.buttons["reasonLine"]
        XCTAssertTrue(reason.waitForExistence(timeout: 6))
        reason.tap()
        let other = app.buttons["Other line"]
        XCTAssertTrue(other.waitForExistence(timeout: 4))
        other.tap()
        let line = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Los Angeles")).firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 4), "line picker did not open after Other line")
        save(XCUIScreen.main.screenshot(), "other-line-opens-lines")
    }

    /// A widget reading older than its freshness window never says "Connected" as its title.
    @MainActor func testStaleWidgetSaysStatusUnknown() {
        let app = launch("CONNECTED", ["-TonoPreviewWidgets"])
        let stale = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Status unknown, Last known: Connected at")).firstMatch
        XCTAssertTrue(stale.waitForExistence(timeout: 8), "no stale card reading \"Status unknown, Last known: Connected at …\"")
        let staleConnected = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Connected", "Last known")).firstMatch
        XCTAssertFalse(staleConnected.exists, "a stale card still leads with Connected: \(staleConnected.label)")
    }

    @MainActor func testEmptyLineListOffersRetryAndLoadingSaysSo() {
        var app = launch("IDLE", ["-TonoPreviewLines", "empty"])
        app.buttons["exitCapsule"].tap()
        XCTAssertTrue(app.staticTexts["linesEmpty"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.buttons["linesRetry"].isHittable)
        app = launch("IDLE", ["-TonoPreviewLines", "loading"])
        app.buttons["exitCapsule"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["linesLoading"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.staticTexts["linesEmpty"].exists)
    }

    /// The preview Live Activity in the simulator's Dynamic Island (real ActivityKit, fixture
    /// content tagged Preview). Captures land in `TONO_SHOTS` when the runner passes it.
    @MainActor func testPreviewLiveActivityShowsInDynamicIsland() throws {
        let app = launch("CONNECTED", ["-TonoPreviewLiveActivity"])
        XCTAssertTrue(primary(app).waitForExistence(timeout: 6))
        sleep(2)
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let island = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Connected")).firstMatch
        let shown = island.waitForExistence(timeout: 8)
        save(XCUIScreen.main.screenshot(), "live-activity-island-compact")
        if shown {
            island.press(forDuration: 1.2)
            sleep(2)
            save(XCUIScreen.main.screenshot(), "live-activity-island-expanded")
        }
        XCTAssertTrue(shown, "no Live Activity element in the Dynamic Island:\n\(springboard.debugDescription.prefix(3000))")
        // End the fixture activity (an idle preview ends it), so it cannot appear in a later capture
        // such as the real widget on the Home Screen.
        _ = launch("IDLE", ["-TonoPreviewLiveActivity"])
        sleep(3)
        XCUIDevice.shared.press(.home)
        let gone = NSPredicate(format: "exists == false")
        XCTAssertEqual(XCTWaiter().wait(for: [expectation(for: gone, evaluatedWith: island)], timeout: 8), .completed,
                       "the preview Live Activity is still shown after an idle preview")
    }

    /// The real Tono widget in SpringBoard's widget gallery (the system host, not the app's own
    /// gallery): the system lists "Tono status" and renders the extension with the real shared
    /// status, which the preview never writes, so it must not claim a state. Then it places the
    /// widget on the Home Screen and asserts it is there and reads "Status unavailable". Named to
    /// run last, so a Home Screen left in edit mode cannot disturb another test.
    @MainActor func testZZRealWidgetInTheSystemGallery() {
        let app = launch("IDLE")
        XCTAssertTrue(primary(app).waitForExistence(timeout: 6))
        XCUIDevice.shared.press(.home)
        sleep(2)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        func tap(_ element: XCUIElement, _ name: String) {
            XCTAssertTrue(element.waitForExistence(timeout: 6), "SpringBoard step not found: \(name)")
            element.tap()
            sleep(1)
        }
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7)).press(forDuration: 1.6)
        sleep(1)
        tap(springboard.buttons.matching(NSPredicate(format: "label == 'Edit' OR identifier == 'edit-mode-button'")).firstMatch, "edit")
        tap(springboard.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Add Widget'")).firstMatch, "add-widget")
        let search = springboard.searchFields.firstMatch
        tap(search, "search")
        search.typeText("Tono")
        sleep(2)
        tap(springboard.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Tono'")).firstMatch, "result")
        let listed = springboard.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Tono status")).firstMatch
        XCTAssertTrue(listed.waitForExistence(timeout: 6), "the system gallery does not list the Tono status widget")
        save(XCUIScreen.main.screenshot(), "real-widget-gallery")
        let unavailable = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Status unavailable")).firstMatch
        let shownAsText = unavailable.waitForExistence(timeout: 3)
        // The sheet's own "Add Widget" is the last one in the tree (the edit menu's may linger).
        let adds = springboard.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Add Widget'")).allElementsBoundByIndex
        adds.last?.tap()
        sleep(2)
        XCUIDevice.shared.press(.home)
        sleep(2)
        let placed = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Status unavailable")).firstMatch
            .waitForExistence(timeout: 4)
        save(XCUIScreen.main.screenshot(), "real-widget-home-screen")
        print("REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=\(shownAsText ? "yes" : "no") placed-and-read=\(placed ? "yes" : "no")")
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(placed, "the Tono widget is not on the Home Screen reading \"Status unavailable\" after Add Widget")
    }

    /// Simulator CPU / memory while Home shows a connected session (sea animating). Mac-host
    /// numbers, not an iPhone; printed for the record, no threshold.
    @MainActor func testSimulatorPerformanceSample() {
        let app = XCUIApplication()
        app.launchArguments = ["-TonoPreview", "CONNECTED", "-AppleLanguages", "(en)"]
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        measure(metrics: [XCTCPUMetric(application: app), XCTMemoryMetric(application: app)], options: options) {
            app.launch()
            _ = app.buttons["primaryAction"].waitForExistence(timeout: 10)
            sleep(5)
        }
    }

    @MainActor private func save(_ shot: XCUIScreenshot, _ name: String) {
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["TONO_SHOTS"], !dir.isEmpty {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
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
        // Scrolled: the content passes under the navigation bar (iOS 26 scroll edge effect).
        app.swipeUp()
        save(XCUIScreen.main.screenshot(), "settings-scrolled-under-bar")
        close.tap()
        waitHittable(primary(app))
        // One-handed: Home's own Settings entry sits in the bottom third, next to Details.
        let gear = app.buttons["settingsButton"]
        XCTAssertTrue(gear.waitForExistence(timeout: 4))
        let screen = app.windows.firstMatch.frame
        XCTAssertGreaterThan(gear.frame.minY, screen.height * 2 / 3, "Settings entry at \(gear.frame), screen \(screen)")
        gear.tap()
        XCTAssertTrue(close.waitForExistence(timeout: 6))
        close.tap()
        waitHittable(primary(app))
    }

    /// One-handed back paths: each Home entry sits in the lower half, and each surface it opens
    /// (Lines, Details, Settings, and Settings reached through Details) closes with a downward
    /// swipe straight back to Home, with no button at the top of the screen.
    @MainActor func testEverySheetClosesWithASwipeBackToHome() {
        let app = launch("CONNECTED")
        let button = primary(app)
        let screen = app.windows.firstMatch.frame
        let paths: [(entry: String, via: String?, marker: XCUIElement)] = [
            ("exitCapsule", nil, app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Los Angeles")).firstMatch),
            ("detailsButton", nil, app.buttons["detailsSettings"]),
            ("settingsButton", nil, app.buttons["settingsClose"]),
            ("detailsButton", "detailsSettings", app.buttons["settingsClose"]),
        ]
        for path in paths {
            let entry = app.buttons[path.entry]
            XCTAssertTrue(entry.waitForExistence(timeout: 4), path.entry)
            XCTAssertGreaterThan(entry.frame.minY, screen.height / 2, "\(path.entry) at \(entry.frame)")
            entry.tap()
            if let via = path.via {
                let row = app.buttons[via]
                XCTAssertTrue(row.waitForExistence(timeout: 4), via)
                row.tap()
            }
            XCTAssertTrue(path.marker.waitForExistence(timeout: 6), "\(path.entry) → \(path.via ?? "-") did not open")
            app.swipeDown(velocity: .fast)
            waitHittable(button)
            XCTAssertFalse(path.marker.isHittable, "\(path.entry) → \(path.via ?? "-") still open after the swipe")
        }
        XCTAssertEqual(button.label, "Disconnect")
    }

    /// Interrupted start (preview fixture, no tunnel): open the line picker while connecting, leave
    /// the app and come back; after the sheet closes Home tells the arrived state, not a stale one.
    @MainActor func testStartInterruptedBySheetAndAppSwitchArrivesConnected() {
        let app = launch("IDLE", ["-TonoPreviewSlow"])
        let button = primary(app)
        button.tap()
        waitLabel(button, "Cancel connecting", timeout: 2)
        app.buttons["exitCapsule"].tap()
        let line = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Los Angeles")).firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 4))
        XCUIDevice.shared.press(.home)
        sleep(2)
        app.activate()
        XCTAssertTrue(line.waitForExistence(timeout: 6), "the line picker should still be open after returning")
        app.swipeDown(velocity: .fast)
        waitHittable(button)
        waitLabel(button, "Disconnect", timeout: 10)
        XCTAssertEqual(title(app), "Connected")
        save(XCUIScreen.main.screenshot(), "interrupted-start-arrives-connected")
    }

    /// Types a site into Details' route check and submits it from the keyboard.
    @MainActor private func checkSite(_ app: XCUIApplication, _ host: String) {
        // The wrapping field is a text view on iOS 26; Details has no other input.
        let field = app.descendants(matching: .any).matching(NSPredicate(format: "elementType == %d OR elementType == %d",
                                                                        XCUIElement.ElementType.textField.rawValue,
                                                                        XCUIElement.ElementType.textView.rawValue)).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 6), "route check field missing from Details")
        if !field.isHittable { app.swipeUp() }
        field.tap()
        field.typeText(host + "\n")
    }

    /// The answer is on screen after Search, not just in the tree: the keyboard has gone and the
    /// answer lies inside the window, hittable (round 8: it sat under the keyboard while CI was green).
    @MainActor func testRouteCheckAnswerIsVisibleAfterSubmit() {
        let app = launch("DEGRADED", ["-TonoPreviewSheet", "details"])
        checkSite(app, "example.com")
        let answer = app.descendants(matching: .any)["routeAnswer"]
        XCTAssertTrue(answer.waitForExistence(timeout: 4), "no route answer in Details")
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 0"), object: app.keyboards)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 4), .completed, "the keyboard stayed up over the answer")
        waitHittable(answer)
        XCTAssertTrue(app.windows.firstMatch.frame.contains(answer.frame), "answer at \(answer.frame) is off screen")
        XCTAssertTrue(answer.label.hasPrefix("example.com goes directly over your own network."), answer.label)
        save(XCUIScreen.main.screenshot(), "details-route-check")
    }

    /// Switching the mode re-answers the same site instead of leaving the old answer up:
    /// example.com goes direct under Three-tier and through the cloud under Stable.
    @MainActor func testRouteCheckAnswerFollowsTheMode() {
        let app = launch("DEGRADED", ["-TonoPreviewSheet", "details"])
        checkSite(app, "example.com")
        let answer = app.descendants(matching: .any)["routeAnswer"]
        XCTAssertTrue(answer.waitForExistence(timeout: 4))
        XCTAssertTrue(answer.label.hasPrefix("example.com goes directly"), answer.label)
        let stable = app.buttons["Stable"]
        XCTAssertTrue(stable.waitForExistence(timeout: 4))
        // The mode sits above the routes: scroll back up to it.
        if !stable.isHittable { app.scrollViews.firstMatch.swipeDown() }
        stable.tap()
        let cloud = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@", "example.com goes through the cloud exit."),
                                              object: answer)
        XCTAssertEqual(XCTWaiter().wait(for: [cloud], timeout: 4), .completed, "answer stayed \"\(answer.label)\" after Stable")
        save(XCUIScreen.main.screenshot(), "details-route-check-stable")
    }

    /// Editing the site takes the old answer away at once: it was about another site.
    @MainActor func testRouteCheckEditingTheSiteClearsTheAnswer() {
        let app = launch("CONNECTED", ["-TonoPreviewSheet", "details"])
        checkSite(app, "example.com")
        let answer = app.descendants(matching: .any)["routeAnswer"]
        XCTAssertTrue(answer.waitForExistence(timeout: 4))
        let field = app.descendants(matching: .any).matching(NSPredicate(format: "elementType == %d OR elementType == %d",
                                                                        XCUIElement.ElementType.textField.rawValue,
                                                                        XCUIElement.ElementType.textView.rawValue)).firstMatch
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3) + "org")
        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: answer)
        XCTAssertEqual(XCTWaiter().wait(for: [cleared], timeout: 4), .completed, "answer \"\(answer.label)\" stayed after editing the site")
    }

    /// Something that is not a site gets a sentence saying so, where the answer would be.
    @MainActor func testRouteCheckSaysWhenTheQueryIsNotASite() {
        let app = launch("CONNECTED", ["-TonoPreviewSheet", "details"])
        checkSite(app, "hello world")
        let message = app.descendants(matching: .any)["routeCheckMessage"]
        XCTAssertTrue(message.waitForExistence(timeout: 4), "no feedback for a query that is not a site")
        waitHittable(message)
        XCTAssertTrue(message.label.contains("isn't a site address"), message.label)
        XCTAssertFalse(app.descendants(matching: .any)["routeAnswer"].exists)
        save(XCUIScreen.main.screenshot(), "details-route-check-invalid")
    }

    /// A mode switch the tunnel refuses (injected: the reload is refused and the previous graph
    /// keeps running) never shows the new mode as in effect: the old mode stays selected, the
    /// answer and lanes stay on it, Details says the switch failed, and so does Home.
    @MainActor func testRefusedModeSwitchKeepsShowingTheModeInEffect() {
        let app = launch("CONNECTED", ["-TonoPreviewSheet", "details", "-TonoPreviewApplyFails", "reload"])
        checkSite(app, "example.com")
        let answer = app.descendants(matching: .any)["routeAnswer"]
        XCTAssertTrue(answer.waitForExistence(timeout: 4))
        let stable = app.buttons["mode_STABLE"]
        XCTAssertTrue(stable.waitForExistence(timeout: 4))
        if !stable.isHittable { app.scrollViews.firstMatch.swipeDown() }
        stable.tap()
        let note = app.descendants(matching: .any)["modeNotApplied"]
        XCTAssertTrue(note.waitForExistence(timeout: 4), "no word in Details that the switch failed")
        XCTAssertEqual(note.label, "Couldn't switch to Stable. Still using Three-tier.")
        XCTAssertTrue(app.buttons["mode_THREE_TIER"].isSelected, "Three-tier should stay selected")
        XCTAssertFalse(stable.isSelected)
        XCTAssertTrue(answer.label.hasPrefix("example.com goes directly"), answer.label)
        XCTAssertTrue(answer.label.contains("Three-tier"), answer.label)
        save(XCUIScreen.main.screenshot(), "details-mode-refused")
        // Close Details (a large sheet first drops to medium), so Home's line is what is captured.
        let home = app.buttons["routeNote"]
        XCTAssertTrue(home.waitForExistence(timeout: 4), "Home does not say the switch failed")
        for _ in 0..<4 where !home.isHittable { app.swipeDown(velocity: .fast); sleep(1) }
        waitHittable(home)
        XCTAssertTrue(home.label.hasPrefix("Couldn't switch to Stable"), home.label)
        save(XCUIScreen.main.screenshot(), "home-mode-refused")
    }

    /// A mode switch the tunnel answers neither for the rebuild nor for what it runs (injected):
    /// neither mode is claimed. No segment is selected, Details says the switch is unconfirmed, and
    /// the route check gives no rule-based answer until a status read settles it.
    @MainActor func testUnansweredModeSwitchClaimsNeitherMode() {
        let app = launch("CONNECTED", ["-TonoPreviewSheet", "details", "-TonoPreviewApplyFails", "silent"])
        let stable = app.buttons["mode_STABLE"]
        XCTAssertTrue(stable.waitForExistence(timeout: 4))
        if !stable.isHittable { app.scrollViews.firstMatch.swipeDown() }
        stable.tap()
        let note = app.descendants(matching: .any)["modeNotApplied"]
        XCTAssertTrue(note.waitForExistence(timeout: 4), "no word in Details that the switch is unconfirmed")
        XCTAssertEqual(note.label, "Couldn't confirm the switch to Stable")
        XCTAssertFalse(app.buttons["mode_THREE_TIER"].isSelected, "Three-tier is claimed although the switch may have run")
        XCTAssertFalse(stable.isSelected, "Stable is claimed although the tunnel never confirmed it")
        checkSite(app, "example.com")
        let message = app.descendants(matching: .any)["routeCheckMessage"]
        XCTAssertTrue(message.waitForExistence(timeout: 4))
        XCTAssertTrue(message.label.hasPrefix("Tono couldn't confirm which routes are in use"), message.label)
        XCTAssertFalse(app.descendants(matching: .any)["routeAnswer"].exists)
        save(XCUIScreen.main.screenshot(), "details-mode-unconfirmed")
    }

    /// A refusal whose put-back of the inputs file also fails is said, not swallowed.
    @MainActor func testFailedPutBackOfTheFileIsSaid() {
        let app = launch("CONNECTED", ["-TonoPreviewSheet", "details", "-TonoPreviewApplyFails", "putback"])
        let stable = app.buttons["mode_STABLE"]
        XCTAssertTrue(stable.waitForExistence(timeout: 4))
        if !stable.isHittable { app.scrollViews.firstMatch.swipeDown() }
        stable.tap()
        let note = app.descendants(matching: .any)["modeNotApplied"]
        XCTAssertTrue(note.waitForExistence(timeout: 4))
        XCTAssertEqual(note.label, "Couldn't switch to Stable. Still using Three-tier. Couldn't save the routes in use either; Tono will retry.")
    }

    /// A line switch shows on Home as pending until the tunnel confirms it (injected: a slow
    /// confirmation), then names the new line.
    @MainActor func testLineSwitchIsPendingOnHomeUntilConfirmed() {
        let app = launch("CONNECTED", ["-TonoPreviewApplyFails", "slow"])
        let exit = app.buttons["exitCapsule"]
        XCTAssertTrue(exit.waitForExistence(timeout: 6))
        exit.tap()
        let other = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Los Angeles")).firstMatch
        XCTAssertTrue(other.waitForExistence(timeout: 4))
        other.tap()
        let pending = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "Switching to Los Angeles"), object: exit)
        XCTAssertEqual(XCTWaiter().wait(for: [pending], timeout: 3), .completed, exit.label)
        XCTAssertFalse(exit.label.hasPrefix("Lines: Los Angeles"), "the new line is named before it is confirmed: \(exit.label)")
        save(XCUIScreen.main.screenshot(), "home-line-pending")
        let confirmed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label BEGINSWITH %@ AND NOT label CONTAINS %@",
                                                                         "Lines: Los Angeles", "Switching"), object: exit)
        XCTAssertEqual(XCTWaiter().wait(for: [confirmed], timeout: 8), .completed, exit.label)
    }

    /// The widget card the extension's heartbeat produces after a rebuild and its restore were
    /// both refused (built through `TunnelGraph`, the shared-file encoding and `StatusWording`, in
    /// the real widget view): it says Routes stopped with Retry, never Connected; the Control
    /// Center switch reads off with the same words.
    @MainActor func testWidgetFromAHeartbeatWithNoGraphSaysRoutesStopped() {
        let app = launch("CONNECTED", ["-TonoPreviewWidgets", "-TonoPreviewWidgetsRoutes"])
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Routes stopped, Retry rebuilds them")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 8), "no card reading \"Routes stopped, Retry rebuilds them, …\"")
        XCTAssertTrue(app.staticTexts["Retry"].exists, "the card's button is not Retry")
        save(XCUIScreen.main.screenshot(), "widget-routes-stopped")
        let control = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Tono, Routes stopped")).firstMatch
        XCTAssertTrue(control.exists, "no Control Center switch reading off with Routes stopped")
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
    // Every screen is audited even after an earlier one fails, so one CI run lists every issue.

    @MainActor func testAccessibilityAuditHomeStates() throws {
        var failures: [String] = []
        for phase in ["SIGNED_OUT", "IDLE", "NEEDS_PERMISSION", "CONNECTING", "CONNECTED", "DEGRADED", "FAILED"] {
            failures += try audit(launch(phase), name: "home-\(phase)")
        }
        failures += try audit(launch("SIGNED_OUT", ["-TonoPreviewOnboarding"]), name: "onboarding")
        failures += try audit(launch("CONNECTING", ["-TonoPreviewReason", "NETWORK_CHANGED"]), name: "home-network-changed")
        failures += try audit(launch("FAILED", ["-TonoPreviewReason", "CORE_STOPPED"]), name: "home-dropped")
        failures += try audit(launch("IDLE", ["-TonoPreviewOffline"]), name: "home-offline")
        // Widget cards have the system's fixed sizes and stop growing at xxxLarge (Apple's widget
        // guidance): Dynamic Type / clipping flags there are logged and checked on the AX5 capture.
        failures += try audit(launch("CONNECTED", ["-TonoPreviewWidgets"]), name: "widget-gallery", fixedSizeWidgets: true)
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    @MainActor func testAccessibilityAuditSheets() throws {
        var failures: [String] = []
        for sheet in ["lines", "details", "settings"] {
            failures += try audit(launch("DEGRADED", ["-TonoPreviewSheet", sheet, "-TonoLargeSheets"]), name: "sheet-\(sheet)")
        }
        failures += try audit(launch("NEEDS_PERMISSION", ["-TonoPreviewSheet", "primer", "-TonoLargeSheets"]), name: "sheet-primer")
        failures += try audit(launch("IDLE", ["-TonoPreviewSheet", "lines", "-TonoPreviewLines", "empty", "-TonoLargeSheets"]),
                              name: "sheet-lines-empty")
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    @MainActor func testAccessibilityAuditLargestText() throws {
        let largest = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        var failures: [String] = []
        failures += try audit(launch("CONNECTED", largest), name: "largest-text-connected")
        failures += try audit(launch("FAILED", largest), name: "largest-text-failed")
        failures += try audit(launch("SIGNED_OUT", largest), name: "largest-text-signin")
        failures += try audit(launch("SIGNED_OUT", largest + ["-TonoPreviewOnboarding"]), name: "largest-text-onboarding",
                              atLargestSize: true)
        failures += try audit(launch("NEEDS_PERMISSION", largest + ["-TonoPreviewSheet", "primer"]), name: "largest-text-primer",
                              atLargestSize: true)
        // At AX5 "may be clipped at larger sizes" has no larger size to happen at: those predictions are
        // logged, and the AX5 English captures in the artifact are the clipping check for these screens.
        failures += try audit(launch("DEGRADED", largest + ["-TonoPreviewSheet", "details"]), name: "largest-text-details",
                              atLargestSize: true)
        failures += try audit(launch("DEGRADED", largest + ["-TonoPreviewSheet", "settings"]), name: "largest-text-settings",
                              atLargestSize: true)
        failures += try audit(launch("DEGRADED", largest + ["-TonoPreviewSheet", "lines"]), name: "largest-text-lines",
                              atLargestSize: true)
        failures += try audit(launch("DEGRADED", largest), name: "largest-text-degraded")
        failures += try audit(launch("CONNECTING", largest + ["-TonoPreviewReason", "NETWORK_CHANGED"]), name: "largest-text-network-changed")
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    /// Contrast at the largest text size measured without Apple's audit: the audit changes the text
    /// size while it runs, so its in-place flags are re-measured after it (above). This sweep takes
    /// every text and control on screen at AX5, at rest, from its own pixels (4.5:1), scrolling each
    /// sheet once, so a contrast problem that exists only at large sizes cannot pass unseen.
    @MainActor func testLargestTextContrastSweep() {
        let largest = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        let screens: [(String, String, [String])] = [
            ("connected", "CONNECTED", []), ("degraded", "DEGRADED", []), ("failed", "FAILED", []),
            ("network-changed", "CONNECTING", ["-TonoPreviewReason", "NETWORK_CHANGED"]),
            ("details", "DEGRADED", ["-TonoPreviewSheet", "details"]), ("lines", "DEGRADED", ["-TonoPreviewSheet", "lines"]),
            ("settings", "DEGRADED", ["-TonoPreviewSheet", "settings"]),
        ]
        var failures: [String] = []
        var checked = 0
        for (name, phase, extra) in screens {
            let app = launch(phase, largest + extra)
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
            sleep(2)
            var result = Self.sweep(app, name: "largest-\(name)")
            if !extra.isEmpty {
                app.swipeUp(velocity: .slow)
                sleep(1)
                let lower = Self.sweep(app, name: "largest-\(name)-scrolled")
                result = (result.checked + lower.checked, result.failures + lower.failures)
            }
            print("SWEEP largest-\(name): checked \(result.checked) texts/controls, \(result.failures.count) below 4.5:1 or under 44x44 pt")
            result.failures.forEach { print($0) }
            checked += result.checked
            failures += result.failures
        }
        XCTAssertGreaterThan(checked, 40, "the sweep measured almost nothing")
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    /// WCAG contrast of an element's text against its own background, from a screenshot of the
    /// element. Background = the median pixel. Text = the glyph core: among the ink pixels (at least
    /// 1.5:1 from the background, lighter or darker), the one at the 90th percentile of contrast.
    /// Until round 11 the text was the 97th percentile of all pixels, which reads background when
    /// ink covers under 3% of the element: Details' 362 x 52 pt Settings row (2.1% ink, white text
    /// at 15.3:1 in the capture) measured 1.2:1. Both values are logged for every measurement, and
    /// `testContrastMeasureFailsLowContrastTextInASparseRow` keeps this method failing 3:1 and 4:1
    /// text in the same kind of row.
    @MainActor static func measuredContrast(_ element: XCUIElement) -> Double? {
        guard let cg = element.screenshot().image.cgImage else { return nil }
        let w = cg.width, h = cg.height
        guard w > 0, h > 0 else { return nil }
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        func lin(_ c: UInt8) -> Double {
            let v = Double(c) / 255
            return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        var lum: [Double] = []
        lum.reserveCapacity(w * h)
        for i in stride(from: 0, to: bytes.count, by: 4) {
            lum.append(0.2126 * lin(bytes[i]) + 0.7152 * lin(bytes[i + 1]) + 0.0722 * lin(bytes[i + 2]))
        }
        let sorted = lum.sorted()
        let background = sorted[sorted.count / 2]
        func ratio(_ l: Double) -> Double { (max(l, background) + 0.05) / (min(l, background) + 0.05) }
        let percentile = ratio(background < 0.18 ? sorted[sorted.count * 97 / 100] : sorted[sorted.count * 3 / 100])
        let ink = lum.map(ratio).filter { $0 >= 1.5 }.sorted()
        // No ink to speak of (under 0.05% of the pixels): the text is not visible against its background.
        let core = ink.count >= max(20, lum.count / 2000) ? ink[ink.count * 9 / 10] : (ink.last ?? 1)
        print(String(format: "MEASURE id=%@ label=%@: glyph core %.1f:1 (ink %.2f%%), 97th percentile %.1f:1",
                     element.identifier, String(element.label.prefix(40)), core, Double(ink.count) * 100 / Double(lum.count), percentile))
        return core
    }

    /// Calibration of `measuredContrast` on CI: a DEBUG probe draws rows built like Details'
    /// Settings row (full-width card, 52 pt, one short word) with text at about 3:1, 4:1 and the
    /// app's primary text. The two low ones must fail 4.5:1 and the primary one must pass, so a
    /// measurement that passes everything cannot go unnoticed.
    @MainActor func testContrastMeasureFailsLowContrastTextInASparseRow() {
        let app = launch("CONNECTED", ["-TonoPreviewContrastProbe"])
        for (id, passes) in [("probe3", false), ("probe4", false), ("probePrimary", true)] {
            let row = app.descendants(matching: .any)[id]
            XCTAssertTrue(row.waitForExistence(timeout: 6), id)
            guard let ratio = Self.measuredContrast(row) else { return XCTFail("\(id): no pixels") }
            XCTAssertEqual(ratio >= 4.5, passes, String(format: "%@ measured %.1f:1", id, ratio))
        }
    }

    /// Runs Apple's audit and returns one line per issue (empty when the screen is clean).
    @MainActor private func audit(_ app: XCUIApplication, name: String, atLargestSize: Bool = false,
                                  fixedSizeWidgets: Bool = false) throws -> [String] {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs an iOS 17+ runtime") }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        sleep(2)
        var found: [String] = []
        var unattributed: [String] = []
        var offscreen: [(String, XCUIElement)] = []
        var settle: [(String, XCUIElement)] = []
        var dumped = false
        do {
            try app.performAccessibilityAudit { issue in
                let element = issue.element
                // The yellow DEBUG badge is not part of the product (compiled out of Release).
                if element?.identifier == "previewBadge" { return true }
                let line = "AUDIT \(name): [\(issue.auditType.rawValue)] \(issue.compactDescription) | \(issue.detailedDescription) | "
                    + (element.map { "\($0.elementType.rawValue) id=\($0.identifier) label=\($0.label) frame=\($0.frame)" } ?? "no element")
                // Apple's contrast check misreads text over gradients and glass (it flags 17:1 white on
                // near-black). Each contrast flag is re-measured from the element's own pixels; only a
                // measured ratio under WCAG AA 4.5:1 counts as a failure, and every flag stays in the log.
                // An element past the screen edge has no pixels to measure yet: it is scrolled into
                // view and measured after the audit.
                if issue.auditType == .contrast, let element, !app.windows.firstMatch.frame.contains(element.frame) {
                    print(line + " | off screen; measured after scrolling")
                    offscreen.append((line, element))
                    return true
                }
                if issue.auditType == .contrast, let element, let ratio = Self.measuredContrast(element) {
                    let verdict = ratio >= 4.5 ? "PASSES" : "FAILS"
                    print(line + String(format: " | measured %.1f:1 %@ WCAG AA", ratio, verdict))
                    if ratio >= 4.5 { return true }
                    // The audit changes the text size while it runs, so a frame read here can belong to
                    // another layout than the pixels (Details' Settings row read 1.2:1 at the place
                    // the larger text had moved it, run 39156608142). Measured again once the audit
                    // has finished and the screen is back at its own size; that measurement decides.
                    settle.append((line, element))
                    return true
                }
                if atLargestSize, issue.auditType == .textClipped {
                    print(line + " | prediction past the largest size; see the AX5 capture")
                    return true
                }
                if fixedSizeWidgets, issue.auditType == .textClipped || issue.auditType == .dynamicType {
                    print(line + " | fixed-size widget card, Dynamic Type capped at xxxLarge; see the AX5 capture")
                    return true
                }
                print(line)
                // A contrast or hit-area flag Apple cannot tie to any element is checked by sweeping
                // every exposed text and control on the screen (below) instead of being dropped.
                if element == nil, issue.auditType == .contrast || issue.auditType == .hitRegion {
                    unattributed.append(line)
                    return true
                }
                found.append(line)
                if element == nil && !dumped {
                    dumped = true
                    print("TREE \(name):\n\(app.debugDescription)")
                }
                return true
            }
        } catch {
            found.append("AUDIT \(name): audit error \(error)")
        }
        if !unattributed.isEmpty {
            let sweep = Self.sweep(app, name: name)
            print("SWEEP \(name): \(unattributed.count) unattributed flag(s); checked \(sweep.checked) texts/controls, "
                  + "\(sweep.failures.count) below 4.5:1 or under 44x44 pt")
            sweep.failures.forEach { print($0) }
            found += sweep.failures
        }
        if !settle.isEmpty { sleep(1) }
        for (line, element) in settle {
            let ratio = app.windows.firstMatch.frame.contains(element.frame) ? Self.measuredContrast(element) : nil
            let result = ratio.map { String(format: "after the audit: measured %.1f:1 %@ WCAG AA", $0, $0 >= 4.5 ? "PASSES" : "FAILS") }
                ?? "after the audit: not on screen to measure"
            print(line + " | " + result)
            if (ratio ?? 0) < 4.5 { found.append(line + " | " + result) }
        }
        for (line, element) in offscreen {
            let window = app.windows.firstMatch.frame
            for _ in 0..<4 where !window.contains(element.frame) {
                app.swipeUp(velocity: .slow)
            }
            let ratio = window.contains(element.frame) ? Self.measuredContrast(element) : nil
            let result = ratio.map { String(format: "measured %.1f:1 %@ WCAG AA", $0, $0 >= 4.5 ? "PASSES" : "FAILS") }
                ?? "could not scroll into view"
            print(line + " | " + result)
            if (ratio ?? 0) < 4.5 { found.append(line + " | " + result) }
        }
        return found
    }

    /// Every text and control on screen: controls at least 44x44 pt, text and controls at least
    /// 4.5:1 measured from their own pixels.
    @MainActor static func sweep(_ app: XCUIApplication, name: String) -> (checked: Int, failures: [String]) {
        let window = app.windows.firstMatch.frame
        let controls: Set<XCUIElement.ElementType> = [.button, .switch, .textField, .secureTextField, .link, .slider]
        var checked = 0
        var failures: [String] = []
        for element in app.descendants(matching: .any).allElementsBoundByIndex {
            let type = element.elementType
            guard type == .staticText || controls.contains(type), element.identifier != "previewBadge" else { continue }
            let frame = element.frame
            guard !frame.isEmpty, window.contains(frame) else { continue }
            checked += 1
            let what = "\(type.rawValue) id=\(element.identifier) label=\(element.label) frame=\(frame)"
            if controls.contains(type), element.isHittable, frame.width < 44 || frame.height < 44 {
                failures.append("SWEEP \(name): hit area under 44x44 pt | \(what)")
            }
            // WCAG 1.4.3 exempts inactive controls (the disabled sign-in button). A control whose
            // text is exposed as its own static texts is measured through them: over a 358 pt glass
            // capsule the few text pixels fall below the percentile used here.
            let hasText = controls.contains(type) && element.staticTexts.count > 0
            if element.isEnabled, !hasText, let ratio = measuredContrast(element), ratio < 4.5 {
                // XCUITest lists Home's elements under an open sheet too (the AX5 Lines sweep measured
                // Home's "86 ms" at 1.0:1: the sheet's own background). Only a failing element that is
                // also not hittable is taken as covered; it is logged, never silently dropped.
                if !element.isHittable {
                    print(String(format: "SWEEP %@: %.1f:1 but not hittable (covered by a sheet), not counted | %@", name, ratio, what))
                } else {
                    failures.append(String(format: "SWEEP %@: measured %.1f:1 under WCAG AA | %@", name, ratio, what))
                }
            }
        }
        return (checked, failures)
    }
}
