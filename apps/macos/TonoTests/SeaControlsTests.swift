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
        XCTAssertTrue(toggle.accessibilityPerformPress())
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
        XCTAssertTrue(option.accessibilityPerformPress())
        XCTAssertEqual(selected, "Second")
        XCTAssertEqual(writes, 1)
    }

    private func mount<V: View>(_ host: NSHostingView<V>) -> NSWindow {
        let window = NSWindow(contentRect: CGRect(x: 80, y: 80, width: 450, height: 180),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        return window
    }

    private func element(named name: String, in host: NSView) async throws -> any NSAccessibilityProtocol {
        // Only the fixture's untyped child tree; no system AX permission or
        // typed navigation-order bridge (which older SwiftUI hosts can crash).
        for _ in 0..<20 {
            var queue: [AnyObject] = [host]
            var visited = Set<ObjectIdentifier>()
            while !queue.isEmpty, visited.count < 128 {
                let next = queue.removeFirst()
                guard visited.insert(ObjectIdentifier(next)).inserted else { continue }
                let full = next as? any NSAccessibilityProtocol
                let object = next as? NSObject
                let label = full?.accessibilityLabel()
                    ?? (object?.accessibilityAttributeValue(.description) as? String)
                    ?? (object?.accessibilityAttributeValue(.title) as? String)
                if label == name, let full { return full }
                let children = full?.accessibilityChildren()
                    ?? (object?.accessibilityAttributeValue(.children) as? [Any]) ?? []
                queue += children.compactMap { $0 as? NSObject }
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        XCTFail("Native accessible control missing: \(name)")
        throw NSError(domain: "SeaControlsTests", code: 1)
    }
}
