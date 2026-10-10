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

    // Hosted CI has no assistive client, so SwiftUI vends no AX tree to walk
    // (run 37705768424: only NSAccessibilityReparentingCellProxy leaves without
    // labels or children). These fixtures drive the drawn controls with real
    // window mouse events instead; VoiceOver semantics of the accessibility
    // representation stay unverified there.
    func testToggleClickUsesTheOriginalBinding() async throws {
        var enabled = false
        let host = NSHostingView(rootView: Toggle("B fixture toggle", isOn: Binding(
            get: { enabled }, set: { enabled = $0 }))
            .toggleStyle(SeaToggleStyle()).labelsHidden().padding(20))
        let window = mount(host)
        defer { window.orderOut(nil); window.close() }
        // The 36 x 20 track sits inside the 20 pt padding.
        try await click(host, x: 20 + 18, y: 20 + 10)
        try await waitUntil("toggle binding written") { enabled }
        XCTAssertTrue(enabled)
    }

    func testSegmentedChoiceClickUsesTheOriginalSelectionSetter() async throws {
        var selected = "First"
        var writes = 0
        let host = NSHostingView(rootView: SeaChoice(label: "B fixture choice", selection: Binding(
            get: { selected }, set: { selected = $0; writes += 1 }), options: ["First", "Second"])
            .padding(20))
        let window = mount(host)
        defer { window.orderOut(nil); window.close() }
        // Inside the unselected right segment's own 13 pt padding, not on its
        // glyphs: the whole capsule is the hit area.
        let size = host.bounds.size
        try await click(host, x: size.width - 20 - 3 - 6, y: size.height / 2)
        try await waitUntil("segment selection written") { selected == "Second" }
        XCTAssertEqual(selected, "Second")
        XCTAssertEqual(writes, 1)
    }

    private func mount<V: View>(_ host: NSHostingView<V>) -> NSWindow {
        let window = NSWindow(contentRect: CGRect(origin: CGPoint(x: 80, y: 80), size: host.fittingSize),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        host.layoutSubtreeIfNeeded()
        return window
    }

    /// A real left click delivered through the window; the point is measured
    /// from the host's top-left corner.
    private func click(_ host: NSView, x: CGFloat, y: CGFloat) async throws {
        let window = try XCTUnwrap(host.window)
        let local = CGPoint(x: x, y: host.isFlipped ? y : host.bounds.height - y)
        let location = host.convert(local, to: nil)
        for (type, pressure) in [(NSEvent.EventType.leftMouseDown, Float(1)), (.leftMouseUp, Float(0))] {
            let event = try XCTUnwrap(NSEvent.mouseEvent(
                with: type, location: location, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 0, clickCount: 1, pressure: pressure))
            window.sendEvent(event)
            try await Task.sleep(for: .milliseconds(40))
        }
    }

    private func waitUntil(_ what: String, _ condition: () -> Bool) async throws {
        for _ in 0..<40 where !condition() {
            try await Task.sleep(for: .milliseconds(25))
        }
        if !condition() { XCTFail("Not observed after a real click: \(what)") }
    }
}
