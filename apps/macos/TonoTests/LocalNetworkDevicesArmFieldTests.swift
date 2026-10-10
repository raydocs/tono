import XCTest
@testable import Tono

/// D7 (A29): "Allow local network devices" on the app side of the helper
/// boundary.
final class LocalNetworkDevicesArmFieldTests: XCTestCase {

    /// The arm request carries `allowLocalNetworkDevices` only when the
    /// setting is on. A helper older than the field rejects any arm that
    /// carries it, so the default (off, or never set) must send nothing; the
    /// helper reads absence as off and renders no LAN pass.
    func testArmRequestCarriesLocalNetworkDevicesOnlyWhenTheSettingIsOn() throws {
        let suite = "LocalNetworkDevicesArmFieldTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        func fields() -> [String: Any] {
            HelperManager.localNetworkDevicesArmFields(
                SettingsKey.allowsLocalNetworkDevices(defaults: defaults)
            )
        }
        XCTAssertTrue(fields().isEmpty, "never set must send no field")
        defaults.set(false, forKey: SettingsKey.allowLocalNetworkDevices)
        XCTAssertTrue(fields().isEmpty, "off must send no field")
        defaults.set(true, forKey: SettingsKey.allowLocalNetworkDevices)
        XCTAssertEqual(fields().count, 1)
        XCTAssertEqual(fields()["allowLocalNetworkDevices"] as? Bool, true)
    }

    /// Review F1 (lost update): the setting is turned off while an arm that
    /// read it as on is still in flight. That arm's completion must not mark
    /// the session current; the health check sees the helper holds on while
    /// the setting is off, re-arms, and ends with the helper holding off.
    func testToggleDuringAnInFlightArmIsReappliedByTheNextHealthCheck() throws {
        let savedIPC = KillSwitchService.armIPC
        let savedSetting = KillSwitchService.localNetworkDevicesSetting
        let savedArmed = KillSwitchService.isArmed
        defer {
            KillSwitchService.armIPC = savedIPC
            KillSwitchService.localNetworkDevicesSetting = savedSetting
            KillSwitchService.isArmed = savedArmed
            KillSwitchService.appliedLocalNetworkDevices = nil
        }
        var setting = true
        KillSwitchService.localNetworkDevicesSetting = { setting }
        let committed: KillSwitchService.ArmReply = (
            armed: true, wanted: true, live: true,
            healed: false, flushedStates: false, killedHosts: 0
        )
        func armSession() throws {
            try KillSwitchService.arm(
                apiHosts: [],
                tunnelInterfaces: [],
                proxyEndpoints: [],
                sessionDirectEndpoints: [],
                helperPrepared: true,
                reviewedBundleDirect: false
            )
        }

        // The first arm read "on"; the user turns it off before it returns.
        KillSwitchService.armIPC.deliver = { _ in
            setting = false
            return committed
        }
        try armSession()
        XCTAssertEqual(KillSwitchService.appliedLocalNetworkDevices, true)
        XCTAssertTrue(
            KillSwitchService.localNetworkDevicesNeedReassert,
            "the helper holds on while the setting is off: the next tick must re-arm"
        )

        // The health check's re-arm reads the current setting.
        KillSwitchService.armIPC.deliver = { _ in committed }
        try armSession()
        XCTAssertEqual(KillSwitchService.appliedLocalNetworkDevices, false)
        XCTAssertFalse(KillSwitchService.localNetworkDevicesNeedReassert)
    }
}
