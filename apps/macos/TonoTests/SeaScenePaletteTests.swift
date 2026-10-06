import XCTest
@testable import Tono

final class SeaScenePaletteTests: XCTestCase {
    func testFirstWaterCompositionIsDarkerThanSkyHorizonInEveryPhase() {
        func luminance(_ color: SeaSceneRGB) -> Double {
            func linear(_ value: Double) -> Double {
                value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * linear(color.red)
                + 0.7152 * linear(color.green)
                + 0.0722 * linear(color.blue)
        }

        func horizonContrast(_ phase: SeaPresentationPhase) -> Double {
            let palette = SeaScenePalette.forPhase(phase)
            return luminance(SeaSceneRGB(hex: palette.sky[2]))
                - luminance(palette.waterSurface)
        }

        XCTAssertGreaterThan(horizonContrast(.day), 0.015)
        XCTAssertGreaterThan(horizonContrast(.dawn), 0.015)
        XCTAssertGreaterThan(horizonContrast(.dusk), 0.015)
        XCTAssertGreaterThan(horizonContrast(.blocked), 0.015)
        XCTAssertGreaterThan(horizonContrast(.night), 0.015)
    }
}
