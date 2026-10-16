import AppKit
import XCTest
@testable import Tono

/// The status item draws the sun-on-the-horizon glyphs from the asset catalog.
/// A missing image set renders an empty status item, and a non-template one
/// ignores the light/dark bar tint.
final class MenuBarStatusImageTests: XCTestCase {
    func testEveryProtectionStateHasADistinctTemplateImage() throws {
        let kinds: [MenuBarProtectionStatus.Kind] = [.blocked, .connecting, .connected, .degraded, .unconfirmed, .standby]
        var names = Set<String>()
        for kind in kinds {
            let name = MenuBarProtectionStatus.imageName(for: kind)
            let image = try XCTUnwrap(NSImage(named: name), name)
            XCTAssertTrue(image.isTemplate, name)
            XCTAssertEqual(image.size, NSSize(width: 18, height: 18), name)
            names.insert(name)
        }
        XCTAssertEqual(names.count, kinds.count)
    }
}
