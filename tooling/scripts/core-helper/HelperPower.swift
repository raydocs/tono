import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt

/// Serializes network-opening helper requests against the kernel power
/// transition. Once sleep begins, no late GUI request may replace the
/// emergency PF state or restart the owned core. Existing requests finish
/// before `beginSleep()` returns, after which the power callback installs the
/// all-block barrier and stops Mihomo.
final class PowerTransitionGate: @unchecked Sendable {
    private let lock = NSLock()
    private var sleeping = false

    func whileAwake<T>(_ operation: () throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        guard !sleeping else {
            throw HelperFailure.invalid(
                "The system is entering sleep; network protection remains fail-closed."
            )
        }
        return try operation()
    }

    func isAwake() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return !sleeping
    }

    func beginSleep() {
        lock.lock()
        sleeping = true
        lock.unlock()
    }

    func finishWakeBarrier() {
        lock.lock()
        sleeping = false
        lock.unlock()
    }

    static func runSelfTests() -> Bool {
        let gate = PowerTransitionGate()
        guard (try? gate.whileAwake { 7 }) == 7 else { return false }
        gate.beginSleep()
        do {
            _ = try gate.whileAwake { 9 }
            return false
        } catch {
            gate.finishWakeBarrier()
            return (try? gate.whileAwake { 11 }) == 11
        }
    }
}

/// Installs the fail-closed barrier from the privileged process at the actual
/// macOS power event. On sleep it commits PF first, then stops the owned core;
/// on wake it reasserts the emergency block before the GUI can rebuild TUN and
/// DNS. Missing GUI notifications therefore affect recovery latency, not leak
/// safety.
final class HelperPowerMonitor: @unchecked Sendable {
    private let killSwitch: KillSwitchManager
    private let core: CoreManager
    private let transitionGate: PowerTransitionGate
    private let queue = DispatchQueue(label: "com.raydocs.tono.helper-power")
    private var rootPort: io_connect_t = 0
    private var notifier: io_object_t = 0
    private var notificationPort: IONotificationPortRef?

    init(
        killSwitch: KillSwitchManager,
        core: CoreManager,
        transitionGate: PowerTransitionGate
    ) {
        self.killSwitch = killSwitch
        self.core = core
        self.transitionGate = transitionGate
    }

    func start() throws {
        guard rootPort == 0 else { return }
        let callback: IOServiceInterestCallback = {
            refcon, _, messageType, messageArgument in
            guard let refcon else { return }
            let monitor = Unmanaged<HelperPowerMonitor>
                .fromOpaque(refcon)
                .takeUnretainedValue()
            monitor.handle(messageType, argument: messageArgument)
        }
        let port = IORegisterForSystemPower(
            Unmanaged.passUnretained(self).toOpaque(),
            &notificationPort,
            callback,
            &notifier
        )
        guard port != 0, let notificationPort else {
            if let notificationPort {
                IONotificationPortDestroy(notificationPort)
                self.notificationPort = nil
            }
            throw HelperFailure.system(
                "Could not register the helper power-transition monitor."
            )
        }
        rootPort = port
        IONotificationPortSetDispatchQueue(notificationPort, queue)
    }

    private func handle(
        _ messageType: UInt32,
        argument: UnsafeMutableRawPointer?
    ) {
        switch messageType {
        case tonoIOMessageCanSystemSleep:
            IOAllowPowerChange(rootPort, Int(bitPattern: argument))
        case tonoIOMessageSystemWillSleep:
            // Wait for any already-authorized arm/start/disarm request, then
            // reject all later ones before committing the emergency barrier.
            transitionGate.beginSleep()
            let wasProtected = killSwitch.secureForPowerTransition()
            if wasProtected { try? core.stop() }
            IOAllowPowerChange(rootPort, Int(bitPattern: argument))
        case tonoIOMessageSystemWillPowerOn:
            // Keep the request gate closed while devices and routes are still
            // resuming. A second barrier at HasPoweredOn covers any stale state
            // the kernel restored with the physical interfaces.
            _ = killSwitch.secureForPowerTransition()
        case tonoIOMessageSystemHasPoweredOn:
            _ = killSwitch.secureForPowerTransition()
            // GUI recovery may proceed only after emergency PF is reasserted.
            transitionGate.finishWakeBarrier()
        default:
            break
        }
    }

    func stop() {
        if let notificationPort {
            IONotificationPortSetDispatchQueue(notificationPort, nil)
        }
        if notifier != 0 {
            IODeregisterForSystemPower(&notifier)
            notifier = 0
        }
        if rootPort != 0 {
            IOServiceClose(rootPort)
            rootPort = 0
        }
        if let notificationPort {
            IONotificationPortDestroy(notificationPort)
            self.notificationPort = nil
        }
    }

    deinit {
        stop()
    }
}
