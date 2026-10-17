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

    @MainActor
    func testDomesticProofKeepsStrictSessionDegradedWithoutCloudQualification() async {
        let previous = AppProfile.defaults.object(forKey: "strictRoutingSessionIntent")
        defer { AppProfile.defaults.set(previous, forKey: "strictRoutingSessionIntent") }
        AppProfile.defaults.set(true, forKey: "strictRoutingSessionIntent")
        let app = AppState()
        app.isConnected = true
        app.config.tunEnabled = true
        app.tunInterfaceExists = { _ in true }
        app.tonoTransport = TonoTransportDescriptor(port: 1080)
        app.coreController = CoreControllerClient()
        app.raceHealthTrafficProbes = { _, _ in .lost([]) }
        var state = AppState.CoreMonitorState()
        state.healthCycle = 1
        state.consecutiveHealthFailures = 5
        var domesticCalls = 0

        let kept = await app.runCoreMonitorTick(state: &state, domesticProbe: {
            domesticCalls += 1
            return true
        })
        XCTAssertEqual(kept, .continueMonitoring)
        XCTAssertEqual(domesticCalls, 1)
        XCTAssertTrue(app.isConnected)
        XCTAssertTrue(app.isProxyDegraded)
        XCTAssertFalse(app.isRecoveringProtectedConnection)
        XCTAssertEqual(state.consecutiveHealthFailures, 0)
        XCTAssertNotNil(app.errorMessage)
        XCTAssertNil(app.lastSuccessfulProbeOrigin)

        // A real cloud proof, not the domestic proof, clears this notice.
        app.raceHealthTrafficProbes = { _, _ in .won("Google") }
        state.healthCycle = 1
        _ = await app.runCoreMonitorTick(state: &state)
        XCTAssertFalse(app.isProxyDegraded)
        XCTAssertNil(app.errorMessage)

        // Stable mode must not consult the new domestic escape hatch.
        AppProfile.defaults.set(false, forKey: "strictRoutingSessionIntent")
        app.raceHealthTrafficProbes = { _, _ in .lost([]) }
        state.healthCycle = 1
        _ = await app.runCoreMonitorTick(state: &state, domesticProbe: {
            XCTFail("Stable mode must retain its existing cloud-only proof")
            return true
        })
        XCTAssertEqual(state.consecutiveHealthFailures, 1)
    }
}
