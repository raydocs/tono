import XCTest
@testable import Tono

@MainActor
final class SeaAppearanceTests: XCTestCase {
    func testSeaAppearanceIsOffInFreshDevicePreferences() throws {
        let suite = "tono-sea-appearance-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertNil(defaults.object(forKey: SeaAppearance.enabledKey))
        XCTAssertFalse(defaults.bool(forKey: SeaAppearance.enabledKey))
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
