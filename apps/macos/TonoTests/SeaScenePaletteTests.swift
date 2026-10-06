import AppKit
import QuartzCore
import XCTest
@testable import Tono

@MainActor
final class SeaScenePaletteTests: XCTestCase {
    func testWaterStartsOnItsOwnDarkBaseRatherThanTheSkyHorizon() throws {
        let view = SeaSceneNativeView(frame: NSRect(x: 0, y: 0, width: 920, height: 600))
        view.configure(phase: .day, progress: nil, preference: "Static", reduceMotion: false,
                       decorations: false, active: true)
        view.layout()
        defer { view.stop() }
        func find(_ layer: CALayer, _ name: String) -> CALayer? {
            if layer.name == name { return layer }
            return layer.sublayers?.compactMap { find($0, name) }.first
        }
        let root = try XCTUnwrap(view.layer)
        let water = try XCTUnwrap(find(root, "water-night") as? CAGradientLayer)
        let sky = try XCTUnwrap(find(root, "sky-night") as? CAGradientLayer)
        let waterTop = try XCTUnwrap((water.colors?.first as? CGColor)?.components)
        let skyBottom = try XCTUnwrap((sky.colors?.last as? CGColor)?.components)
        XCTAssertLessThan(waterTop[0], skyBottom[0])
        XCTAssertLessThan(waterTop[1], skyBottom[1])
        XCTAssertLessThan(waterTop[2], skyBottom[2])
        XCTAssertEqual(waterTop.last, 1, "the water's own base is opaque, never a glowing sky continuation")
    }

    func testFullLiteAndStaticChangeTheActualCompositorLoops() throws {
        let view = SeaSceneNativeView(frame: NSRect(x: 0, y: 0, width: 920, height: 600))
        defer { view.stop() }
        view.configure(phase: .day, progress: nil, preference: "Full", reduceMotion: false, decorations: true, active: true)
        view.layout()
        func count(_ layer: CALayer) -> Int {
            (layer.animationKeys()?.count ?? 0) + (layer.sublayers ?? []).reduce(0) { $0 + count($1) }
        }
        let root = try XCTUnwrap(view.layer)
        let full = count(root)
        view.configure(phase: .day, progress: nil, preference: "Lite", reduceMotion: false, decorations: true, active: true)
        let lite = count(root)
        XCTAssertGreaterThan(full, lite)
        XCTAssertGreaterThan(lite, 0, "Lite retains the near-water/reflection loops")
        view.configure(phase: .day, progress: nil, preference: "Static", reduceMotion: false, decorations: true, active: true)
        XCTAssertEqual(count(root), 0, "Static removes loops and in-flight phase transitions")
    }

}
