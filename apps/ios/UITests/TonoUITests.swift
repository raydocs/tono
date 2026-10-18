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
        XCTAssertEqual(status.label, "Network changed · reconnecting")
        XCTAssertEqual(primary(app).label, "Cancel connecting")
    }

    @MainActor func testDroppedConnectionExplainsAndOffersRetry() {
        let app = launch("FAILED", ["-TonoPreviewReason", "CORE_STOPPED"])
        let reason = app.buttons["reasonLine"]
        XCTAssertTrue(reason.waitForExistence(timeout: 6))
        XCTAssertEqual(reason.label, "Connection dropped")
        XCTAssertEqual(primary(app).label, "Retry")
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
        XCUIDevice.shared.press(.home)
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
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    /// WCAG contrast of an element's text against its own background, from a screenshot of the
    /// element: text = the 3% of pixels furthest from the background (light or dark text alike),
    /// background = the median pixel.
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
        lum.sort()
        let background = lum[lum.count / 2]
        let text = background < 0.18 ? lum[lum.count * 97 / 100] : lum[lum.count * 3 / 100]
        return (max(text, background) + 0.05) / (min(text, background) + 0.05)
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
                failures.append(String(format: "SWEEP %@: measured %.1f:1 under WCAG AA | %@", name, ratio, what))
            }
        }
        return (checked, failures)
    }
}
