import XCTest
@testable import Tono

/// A healthy tick used to nil every errorMessage. A rejected catalog update
/// shares that field and was disappearing within one probe interval.
final class HealthTickErrorTests: XCTestCase {

    @MainActor
    func testHealthyTickClearsOnlyTheMonitorsOwnMessage() async {
        let app = AppState()
        app.isConnected = true
        app.config.tunEnabled = true
        app.tunInterfaceExists = { _ in true }
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.coreController = CoreControllerClient()
        app.raceHealthTrafficProbes = { _, _ in .won("test") }
        let catalogRejection = "Cloud server update was rejected; the last verified catalog remains active."
        app.errorMessage = catalogRejection
        var state = AppState.CoreMonitorState()
        state.healthCycle = 1

        let kept = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(kept, .continueMonitoring)
        XCTAssertEqual(app.errorMessage, catalogRejection)
        XCTAssertTrue(app.isConnected)

        app.errorMessage = String(localized: "Recovering protected connection…")
        state.healthCycle = 1
        let cleared = await app.runCoreMonitorTick(state: &state)
        XCTAssertEqual(cleared, .continueMonitoring)
        XCTAssertNil(app.errorMessage)
    }
}
