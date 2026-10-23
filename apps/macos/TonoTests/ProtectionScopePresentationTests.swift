import SwiftUI
import XCTest
@testable import Tono

/// MAC-PROTECTION-SCOPE-COPY: a verified AI Home session protects listed AI
/// only and leaves ordinary traffic DIRECT (decision 130), so its status may
/// not claim the whole host is protected. The scope comes from the session the
/// Core runtime captured at connect, never from the saved Settings choice: the
/// saved mode describes the next connect and can differ from what this
/// session runs (decision 131).
@MainActor
final class ProtectionScopePresentationTests: XCTestCase {
    private var savedSession: Any?
    private var savedStrict: Any?
    private var savedChoice: Any?

    override func setUp() {
        super.setUp()
        savedSession = AppProfile.defaults.object(forKey: SettingsKey.routingSession)
        savedStrict = AppProfile.defaults.object(forKey: "strictRoutingSessionIntent")
        savedChoice = AppProfile.defaults.object(forKey: SettingsKey.desktopRoutingMode)
        AppProfile.defaults.removeObject(forKey: "strictRoutingSessionIntent")
    }

    override func tearDown() {
        restore(savedSession, forKey: SettingsKey.routingSession)
        restore(savedStrict, forKey: "strictRoutingSessionIntent")
        restore(savedChoice, forKey: SettingsKey.desktopRoutingMode)
        super.tearDown()
    }

    func testAnAIHomeSessionScopesTheConnectedStatusAndASavedSettingCannotOverrideIt() throws {
        let app = AppState()
        // The saved choice is for the next connect; this session runs AI Home.
        AppProfile.defaults.set("stable", forKey: SettingsKey.desktopRoutingMode)
        try app.coreRuntime.captureRoutingMode("ai-home", physicalInterface: "en0")
        app.isConnected = true

        let connected = MenuBarProtectionStatus(app)
        XCTAssertEqual(connected.kind, .connected)
        XCTAssertEqual(key(of: connected.title), "AI protected",
                       "a verified AI Home session never claims whole-host protection")

        // Degraded and unconfirmed keep their precedence and make no AI claim.
        app.isProxyDegraded = true
        let degraded = MenuBarProtectionStatus(app)
        XCTAssertEqual(degraded.kind, .degraded)
        XCTAssertEqual(key(of: degraded.title), "Degraded")
        app.isProxyDegraded = false
        app.isProtectionUnconfirmed = true
        let unconfirmed = MenuBarProtectionStatus(app)
        XCTAssertEqual(unconfirmed.kind, .unconfirmed)
        XCTAssertEqual(key(of: unconfirmed.title), "Protection unknown")
        app.isProtectionUnconfirmed = false

        // A saved AI Home choice over a Stable session stays whole-host.
        AppProfile.defaults.set("ai-home", forKey: SettingsKey.desktopRoutingMode)
        app.isConnected = false
        try app.coreRuntime.captureRoutingMode("stable", physicalInterface: nil)
        app.isConnected = true
        let stable = MenuBarProtectionStatus(app)
        XCTAssertEqual(stable.kind, .connected)
        XCTAssertEqual(key(of: stable.title), "Protected")
    }

    /// The catalog key behind a `LocalizedStringKey`, read by reflection so
    /// the assertion names the exact string the UI asks the catalog for.
    private func key(of title: LocalizedStringKey) -> String? {
        Mirror(reflecting: title).children.first { $0.label == "key" }?.value as? String
    }

    private func restore(_ value: Any?, forKey key: String) {
        if let value { AppProfile.defaults.set(value, forKey: key) } else { AppProfile.defaults.removeObject(forKey: key) }
    }
}
