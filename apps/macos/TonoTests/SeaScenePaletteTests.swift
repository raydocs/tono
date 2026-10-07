import AppKit
import QuartzCore
import XCTest
@testable import Tono

@MainActor
final class SeaScenePaletteTests: XCTestCase {
    func testBackingScaleChangeRebakesContentsAtUnchangedPointSize() async throws {
        let view = SeaSceneNativeView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))
        let window = SeaScaleFixtureWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view
        defer { view.stop(); window.contentView = nil; window.close() }
        view.layout()
        let scene = try XCTUnwrap(view.layer?.sublayers?.first)
        let original = try XCTUnwrap(scene.sublayers?.first)
        XCTAssertEqual(scene.contentsScale, 1)
        window.fixtureScale = 2
        view.viewDidChangeBackingProperties()
        view.layout()
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertFalse(scene.sublayers?.first === original)
        XCTAssertEqual(scene.contentsScale, 2)
        let grain = try XCTUnwrap(scene.sublayers?.first(where: { $0.name == "grain" }))
        XCTAssertEqual(grain.contentsScale, 2)
        XCTAssertEqual((try XCTUnwrap(grain.contents) as! CGImage).width, 640)
        XCTAssertEqual(view.bounds.size, CGSize(width: 320, height: 200))
    }

    func testResizeReusesTheTreeUntilLiveResizeEndsOrLayoutSettles() async throws {
        let view = SeaSceneNativeView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))
        defer { view.stop() }
        view.layout()
        let scene = try XCTUnwrap(view.layer?.sublayers?.first)
        let original = try XCTUnwrap(scene.sublayers?.first)
        view.viewWillStartLiveResize()
        for width in 321...350 {
            view.setFrameSize(CGSize(width: width, height: 220))
            view.layout()
            XCTAssertTrue(scene.sublayers?.first === original, "live resize must not rebake every layout")
        }
        view.viewDidEndLiveResize()
        let afterDrag = try XCTUnwrap(scene.sublayers?.first)
        XCTAssertFalse(afterDrag === original)
        XCTAssertTrue(CATransform3DIsIdentity(scene.sublayerTransform))
        view.setFrameSize(CGSize(width: 360, height: 230))
        view.layout()
        view.setFrameSize(CGSize(width: 370, height: 240))
        view.layout()
        XCTAssertTrue(scene.sublayers?.first === afterDrag, "full-screen resize layouts share the same debounce")
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertFalse(scene.sublayers?.first === afterDrag)
        let finalSky = try XCTUnwrap(scene.sublayers?.first)
        XCTAssertEqual(finalSky.bounds.width, 370)
        XCTAssertEqual(finalSky.bounds.height, 132, accuracy: 0.000001)
        XCTAssertTrue(CATransform3DIsIdentity(scene.sublayerTransform))
    }

    func testPhaseChangeWhilePausedHasNoTransitionToReplay() throws {
        let view = SeaSceneNativeView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))
        defer { view.stop() }
        view.configure(phase: .day, progress: nil, preference: "Full", reduceMotion: false,
                       decorations: true, active: false)
        view.layout()
        let scene = try XCTUnwrap(view.layer?.sublayers?.first)
        XCTAssertEqual(scene.speed, 0)
        view.configure(phase: .night, progress: nil, preference: "Full", reduceMotion: false,
                       decorations: true, active: false)
        func transitionCount(_ layer: CALayer) -> Int {
            (layer.animationKeys() ?? []).filter { $0.hasPrefix("transition-") }.count
                + (layer.sublayers ?? []).reduce(0) { $0 + transitionCount($1) }
        }
        XCTAssertEqual(transitionCount(scene), 0, "phase changes during pause must snap to latest state, not replay later")
        XCTAssertEqual(scene.speed, 0)
    }

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
        let waterColor = try XCTUnwrap(water.colors?.first)
        let skyColor = try XCTUnwrap(sky.colors?.last)
        XCTAssertEqual(CFGetTypeID(waterColor as CFTypeRef), CGColor.typeID)
        XCTAssertEqual(CFGetTypeID(skyColor as CFTypeRef), CGColor.typeID)
        let waterTop = try XCTUnwrap((waterColor as! CGColor).components)
        let skyBottom = try XCTUnwrap((skyColor as! CGColor).components)
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

    func testStarTierOpacityOverridesTheBaseLikeTheWindowsCascade() throws {
        let view = SeaSceneNativeView(frame: NSRect(x: 0, y: 0, width: 920, height: 600))
        view.configure(phase: .night, progress: nil, preference: "Static", reduceMotion: false,
                       decorations: true, active: true)
        view.layout()
        defer { view.stop() }
        func find(_ layer: CALayer, _ name: String) -> CALayer? {
            if layer.name == name { return layer }
            return layer.sublayers?.compactMap { find($0, name) }.first
        }
        let root = try XCTUnwrap(view.layer)
        XCTAssertEqual(try XCTUnwrap(find(root, "stars-0")?.sublayers?.first).opacity, 0.3)
        XCTAssertEqual(try XCTUnwrap(find(root, "stars-1")?.sublayers?.first).opacity, 0.55)
        XCTAssertEqual(try XCTUnwrap(find(root, "stars-2")?.sublayers?.first).opacity, 0.9)
    }


    func testSceneKeepsTopDownCoordinatesAcrossTheAppKitBackingHierarchy() throws {
        let view = SeaSceneNativeView(frame: NSRect(x: 0, y: 0, width: 920, height: 600))
        view.configure(phase: .day, progress: nil, preference: "Static", reduceMotion: true, decorations: false, active: true)
        view.layout()
        defer { view.stop() }
        let scene = try XCTUnwrap(view.layer?.sublayers?.first)
        XCTAssertTrue(scene.contentsAreFlipped(), "CSS top-down geometry must not double-flip AppKit's own backing hierarchy")
        XCTAssertTrue(view.layerUsesCoreImageFilters, "the custom sublayer's documented Core Image blend modes must be enabled")
    }

}

@MainActor
private final class SeaScaleFixtureWindow: NSWindow {
    var fixtureScale: CGFloat = 1
    override var backingScaleFactor: CGFloat { fixtureScale }
}
