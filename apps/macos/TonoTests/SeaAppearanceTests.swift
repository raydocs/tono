import SwiftUI
import XCTest
@testable import Tono

@MainActor
final class SeaAppearanceTests: XCTestCase {
    func testSeaAppearanceDefaultsOnAndPreservesExplicitDeviceOptOut() throws {
        let suite = "tono-sea-appearance-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preference = AppStorage<Bool>(wrappedValue: SeaAppearance.defaultEnabled,
                                         SeaAppearance.enabledKey, store: defaults)
        XCTAssertNil(defaults.object(forKey: SeaAppearance.enabledKey))
        XCTAssertTrue(preference.wrappedValue)
        preference.wrappedValue = false
        XCTAssertFalse(try XCTUnwrap(defaults.object(forKey: SeaAppearance.enabledKey) as? Bool))
        let restored = AppStorage<Bool>(wrappedValue: SeaAppearance.defaultEnabled,
                                       SeaAppearance.enabledKey, store: defaults)
        XCTAssertFalse(restored.wrappedValue, "a stored opt-out must not be overwritten by the new default")
        restored.wrappedValue = true
        XCTAssertTrue(try XCTUnwrap(defaults.object(forKey: SeaAppearance.enabledKey) as? Bool))
    }

    func testSeaSceneNeverShowsConfirmedDayWithoutConfirmedConnection() {
        XCTAssertEqual(SeaPresentationPhase.resolve(
            status: .standby, disconnecting: false, failed: false
        ), .night)
        XCTAssertEqual(SeaPresentationPhase.resolve(
            status: .blocked, disconnecting: false, failed: false
        ), .blocked)
        XCTAssertEqual(SeaPresentationPhase.resolve(
            status: .unconfirmed, disconnecting: false, failed: false
        ), .blocked)
        XCTAssertEqual(SeaPresentationPhase.resolve(
            status: .connecting, disconnecting: true, failed: false
        ), .dusk)
        XCTAssertEqual(SeaPresentationPhase.resolve(
            status: .degraded, disconnecting: false, failed: false
        ), .dusk)
        XCTAssertEqual(SeaPresentationPhase.resolve(
            status: .connected, disconnecting: false, failed: false
        ), .day)
        let app = AppState()
        app.isConnected = true
        app.isProtectionUnconfirmed = true
        XCTAssertEqual(SeaPresentationPhase.resolve(
            status: MenuBarProtectionStatus(app).kind,
            disconnecting: app.isDisconnecting, failed: false
        ), .blocked)
    }

    func testSeaMotionRespectsStaticAndReducedMotion() {
        XCTAssertFalse(SeaAppearance.animates("Full", reduceMotion: true))
        XCTAssertFalse(SeaAppearance.animates("Static", reduceMotion: false))
        XCTAssertTrue(SeaAppearance.animates("Auto", reduceMotion: false))
    }
}
