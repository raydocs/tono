import SwiftUI
import XCTest
@testable import Tono

@MainActor
final class SeaAppearanceTests: XCTestCase {
    func testProductionSchemeIgnoresStoredThemeWithoutOverwritingIt() {
        let defaults = AppProfile.defaults
        let previous = defaults.object(forKey: SettingsKey.themeMode)
        defer {
            if let previous { defaults.set(previous, forKey: SettingsKey.themeMode) }
            else { defaults.removeObject(forKey: SettingsKey.themeMode) }
        }
        defaults.set("Light", forKey: SettingsKey.themeMode)
        XCTAssertEqual(TonoApp.preferredScheme, .dark)
        XCTAssertEqual(defaults.string(forKey: SettingsKey.themeMode), "Light")
        defaults.set("Dark", forKey: SettingsKey.themeMode)
        XCTAssertEqual(TonoApp.preferredScheme, .dark)
        XCTAssertEqual(defaults.string(forKey: SettingsKey.themeMode), "Dark")
    }

    func testConnectionShortcutMappingRetainsToggleCancelAndDisconnectGuard() {
        XCTAssertEqual(ConnectPillKeyboardShortcut(isConnecting: false, isDisconnecting: false).key,
                       KeyEquivalent("k"))
        XCTAssertEqual(ConnectPillKeyboardShortcut(isConnecting: true, isDisconnecting: false).key,
                       KeyEquivalent("."))
        XCTAssertNil(ConnectPillKeyboardShortcut(isConnecting: false, isDisconnecting: true).key)
        XCTAssertEqual(ConnectPillKeyboardShortcut(isConnecting: true, isDisconnecting: true).key,
                       KeyEquivalent("."))
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
