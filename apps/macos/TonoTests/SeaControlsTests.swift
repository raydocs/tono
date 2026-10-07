import AppKit
import SwiftUI
import XCTest
@testable import Tono

@MainActor
final class SeaControlsTests: XCTestCase {
    func testPageAndRowButtonsMeasureAtTheirNativeTargetHeights() {
        let page = NSHostingView(rootView: Button("Connect", action: {})
            .buttonStyle(SeaButtonStyle(variant: .primary)))
        let row = NSHostingView(rootView: Button("Refresh", action: {})
            .buttonStyle(SeaButtonStyle(size: .row)))
        XCTAssertEqual(page.fittingSize.height, 40, accuracy: 0.5)
        XCTAssertEqual(row.fittingSize.height, 32, accuracy: 0.5)
    }

    func testFieldMeasuresAtItsNativeTargetHeightWithoutChangingItsValue() {
        var value = "fixture@example.test"
        let field = NSHostingView(rootView: TextField("Email", text: Binding(
            get: { value }, set: { value = $0 })).textFieldStyle(SeaFieldStyle()))
        XCTAssertEqual(field.fittingSize.height, 48, accuracy: 0.5)
        XCTAssertEqual(value, "fixture@example.test")
    }

    func testToggleAccessiblePressUsesTheOriginalBindingAndRetainsItsName() async throws {
        var enabled = false
        let host = NSHostingView(rootView: Toggle("B fixture toggle", isOn: Binding(
            get: { enabled }, set: { enabled = $0 }))
            .toggleStyle(SeaToggleStyle()).labelsHidden().padding(20))
        let window = mount(host)
        defer { window.orderOut(nil); window.close() }
        let toggle = try await element(named: "B fixture toggle", in: host)
        XCTAssertTrue(press(toggle))
        XCTAssertTrue(enabled)
    }

    func testSegmentedChoiceAccessiblePressUsesTheOriginalSelectionSetter() async throws {
        var selected = "First"
        var writes = 0
        let host = NSHostingView(rootView: SeaChoice(label: "B fixture choice", selection: Binding(
            get: { selected }, set: { selected = $0; writes += 1 }), options: ["First", "Second"])
            .padding(20))
        let window = mount(host)
        defer { window.orderOut(nil); window.close() }
        let option = try await element(named: "Second", in: host)
        XCTAssertTrue(press(option))
        XCTAssertEqual(selected, "Second")
        XCTAssertEqual(writes, 1)
    }

    private func mount<V: View>(_ host: NSHostingView<V>) -> NSWindow {
        let window = NSWindow(contentRect: CGRect(x: 80, y: 80, width: 450, height: 180),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        host.layoutSubtreeIfNeeded()
        return window
    }

    private func element(named name: String, in host: NSView) async throws -> NSObject {
        // Only the fixture's untyped child tree; no system AX permission or
        // typed navigation-order bridge (which older SwiftUI hosts can crash).
        var diagnostics: [String] = []
        for _ in 0..<40 {
            var queue: [AnyObject] = [host]
            if let window = host.window { queue.insert(window, at: 0) }
            diagnostics = []
            var visited = Set<ObjectIdentifier>()
            while !queue.isEmpty, visited.count < 128 {
                let next = queue.removeFirst()
                guard visited.insert(ObjectIdentifier(next)).inserted else { continue }
                let full = next as? any NSAccessibilityProtocol
                let object = next as? NSObject
                let labels = [full?.accessibilityLabel(),
                    modernValue("accessibilityLabel", of: object) as? String,
                    object?.accessibilityAttributeValue(.description) as? String,
                    object?.accessibilityAttributeValue(.title) as? String,
                    full?.accessibilityValue() as? String,
                    modernValue("accessibilityValue", of: object) as? String]
                    .compactMap { $0 }
                diagnostics.append("type=\(type(of: next)) labels=\(labels) full=\(full != nil) modernChildren=\(object?.responds(to: NSSelectorFromString("accessibilityChildren")) == true)")
                if labels.contains(name), let object { return object }
                var children = full?.accessibilityChildren() ?? []
                if children.isEmpty {
                    children = modernValue("accessibilityChildren", of: object) as? [Any] ?? []
                }
                if children.isEmpty {
                    children = object?.accessibilityAttributeValue(.children) as? [Any] ?? []
                }
                queue += children.compactMap { $0 as? NSObject }
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        let raw = diagnostics.joined(separator: "\n")
        let attachment = XCTAttachment(string: raw)
        attachment.name = "sea-controls-AX-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        print("SeaControls AX \(name):\n\(raw)")
        XCTFail("Native accessible control missing: \(name)")
        throw NSError(domain: "SeaControlsTests", code: 1)
    }

    private func modernValue(_ name: String, of object: NSObject?) -> AnyObject? {
        // SwiftUI can vend public role-based AX elements without declaring
        // the entire NSAccessibilityProtocol. Use the documented id-returning
        // selectors, not private proxy members or the typed navigation array.
        let selector = NSSelectorFromString(name)
        guard let object, object.responds(to: selector) else { return nil }
        return object.perform(selector)?.takeUnretainedValue()
    }

    private func press(_ object: NSObject) -> Bool {
        if let full = object as? any NSAccessibilityProtocol { return full.accessibilityPerformPress() }
        if let button = object as? any NSAccessibilityButton { return button.accessibilityPerformPress() }
        let selector = NSSelectorFromString("accessibilityPerformPress")
        guard object.responds(to: selector), let implementation = object.method(for: selector) else { return false }
        // accessibilityPerformPress is a documented BOOL-returning selector;
        // perform(_:) cannot be used for a non-object return value.
        typealias Press = @convention(c) (AnyObject, Selector) -> Bool
        return unsafeBitCast(implementation, to: Press.self)(object, selector)
    }
}
