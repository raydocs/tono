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
    // Every screen is audited even after an earlier one fails, so one CI run lists every issue.

    @MainActor func testAccessibilityAuditHomeStates() throws {
        var failures: [String] = []
        for phase in ["SIGNED_OUT", "IDLE", "NEEDS_PERMISSION", "CONNECTING", "CONNECTED", "DEGRADED", "FAILED"] {
            failures += try audit(launch(phase), name: "home-\(phase)")
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    @MainActor func testAccessibilityAuditSheets() throws {
        var failures: [String] = []
        for sheet in ["lines", "details", "settings"] {
            failures += try audit(launch("DEGRADED", ["-TonoPreviewSheet", sheet]), name: "sheet-\(sheet)")
        }
        XCTAssertTrue(failures.isEmpty, failures.joined(separator: "\n"))
    }

    @MainActor func testAccessibilityAuditLargestText() throws {
        let largest = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        var failures: [String] = []
        failures += try audit(launch("CONNECTED", largest), name: "largest-text-connected")
        failures += try audit(launch("FAILED", largest), name: "largest-text-failed")
        failures += try audit(launch("SIGNED_OUT", largest), name: "largest-text-signin")
        failures += try audit(launch("DEGRADED", largest + ["-TonoPreviewSheet", "details"]), name: "largest-text-details")
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
    @MainActor private func audit(_ app: XCUIApplication, name: String) throws -> [String] {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit needs an iOS 17+ runtime") }
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        sleep(2)
        var found: [String] = []
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
                if issue.auditType == .contrast, let element, let ratio = Self.measuredContrast(element) {
                    let verdict = ratio >= 4.5 ? "PASSES" : "FAILS"
                    print(line + String(format: " | measured %.1f:1 %@ WCAG AA", ratio, verdict))
                    if ratio >= 4.5 { return true }
                }
                print(line)
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
        return found
    }
}
