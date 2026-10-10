import Foundation

/// D7 (A29): "Allow local network devices" converging across PF (the helper)
/// and the Core (the sing-box document).
///
/// The user's choice is a generation-numbered `desired` value. Every PF arm
/// and every Core document carries the generation it was built from and
/// records what it applied, or that the outcome is unknown, only when that
/// generation is not older than what is already recorded: a stale result can
/// never overwrite a newer one. The connected session's health check reloads
/// PF and the Core together (one `reloadCoreConfig`) while either lags
/// `desired`, at most `automaticAttemptLimit` times. A fault the helper
/// reports, a helper too old for the setting, or an exhausted budget is an
/// explicit error: automatic attempts stop until the user acts (toggles the
/// setting or connects again). Nothing here loosens PF; it only decides when
/// to re-apply.
nonisolated enum LocalNetworkDevicesSync {
    struct Setting: Equatable, Sendable {
        let generation: UInt64
        let allow: Bool
    }

    enum Applied: Equatable, Sendable {
        case known(Setting)
        case unknown(generation: UInt64)

        var generation: UInt64 {
            switch self {
            case .known(let setting): setting.generation
            case .unknown(let generation): generation
            }
        }
    }

    enum Fault: Equatable, Sendable {
        /// The helper could not tighten to off and holds the protected fault
        /// (block-all, or the Core stopped). Its message.
        case helper(String)
        /// The helper's arm reply does not say what it enforces: a helper
        /// older than the setting, which would keep the LAN open while the
        /// app showed off.
        case helperTooOld
        /// The automatic attempts for this generation all failed.
        case attemptsExhausted
    }

    static let automaticAttemptLimit = 3

    private static let lock = NSLock()
    nonisolated(unsafe) private static var desiredValue: Setting?
    nonisolated(unsafe) private static var pfValue: Applied?
    nonisolated(unsafe) private static var coreValue: Applied?
    nonisolated(unsafe) private static var attempts = 0
    nonisolated(unsafe) private static var faultValue: Fault?

    /// The stored choice, read once when nothing has been chosen in this
    /// process. Replaced by tests.
    nonisolated(unsafe) static var readStoredSetting: () -> Bool = {
        SettingsKey.allowsLocalNetworkDevices()
    }

    static var desired: Setting {
        lock.withLock { desiredLocked() }
    }

    private static func desiredLocked() -> Setting {
        if let desiredValue { return desiredValue }
        let initial = Setting(generation: 0, allow: readStoredSetting())
        desiredValue = initial
        return initial
    }

    /// The user changed the setting: a new generation, a fresh budget, and
    /// any fault cleared, because the toggle is the user's retry.
    @discardableResult
    static func settingChanged(_ allow: Bool) -> Setting {
        lock.withLock {
            let next = Setting(generation: desiredLocked().generation + 1, allow: allow)
            desiredValue = next
            attempts = 0
            faultValue = nil
            return next
        }
    }

    static func recordPF(_ result: Applied) {
        lock.withLock { pfValue = newer(pfValue, result) }
    }

    static func recordCore(_ result: Applied) {
        lock.withLock { coreValue = newer(coreValue, result) }
    }

    /// The helper rewrote PF without this session's arm (a heal, a release):
    /// what it holds is unknown at the generation last recorded.
    static func pfBecameUnknown() {
        lock.withLock { pfValue = .unknown(generation: pfValue?.generation ?? 0) }
    }

    /// The Core document no longer runs (the Core stopped or was replaced).
    static func coreBecameUnknown() {
        lock.withLock { coreValue = .unknown(generation: coreValue?.generation ?? 0) }
    }

    /// Recent Core documents by digest, with the setting each was built from.
    nonisolated(unsafe) private static var documents: [(digest: String, setting: Setting)] = []

    /// The runtime writer produced these bytes from this setting.
    static func documentWritten(digest: String, setting: Setting) {
        lock.withLock {
            documents.removeAll { $0.digest == digest }
            documents.append((digest, setting))
            if documents.count > 16 { documents.removeFirst(documents.count - 16) }
        }
    }

    /// The helper started or synced the Core on this document. A digest this
    /// process did not write is an unknown document.
    static func documentInstalled(digest: String) {
        lock.withLock {
            if let setting = documents.last(where: { $0.digest == digest })?.setting {
                coreValue = newer(coreValue, .known(setting))
            } else {
                coreValue = .unknown(generation: coreValue?.generation ?? 0)
            }
        }
    }

    private static func newer(_ current: Applied?, _ result: Applied) -> Applied {
        guard let current, result.generation < current.generation else { return result }
        return current
    }

    static func recordFault(_ fault: Fault) {
        lock.withLock { faultValue = fault }
    }

    static var fault: Fault? { lock.withLock { faultValue } }
    static var pfApplied: Applied? { lock.withLock { pfValue } }
    static var coreApplied: Applied? { lock.withLock { coreValue } }

    /// PF and the Core both hold `desired`.
    static var converged: Bool {
        lock.withLock {
            let desired = desiredLocked()
            return pfValue == .known(desired) && coreValue == .known(desired)
        }
    }

    /// Asked by the health check before it reloads PF and the Core. True
    /// spends one automatic attempt. Converged (for instance after the user
    /// connected again) resets the budget and clears the fault; a fault, or
    /// running out of attempts (which records the fault), answers false.
    static func takeAutomaticAttempt() -> Bool {
        lock.withLock {
            let desired = desiredLocked()
            if pfValue == .known(desired) && coreValue == .known(desired) {
                attempts = 0
                faultValue = nil
                return false
            }
            guard faultValue == nil else { return false }
            guard attempts < automaticAttemptLimit else {
                faultValue = .attemptsExhausted
                return false
            }
            attempts += 1
            return true
        }
    }

    /// The text the session shows for a fault.
    static var faultMessage: String? {
        switch fault {
        case .helper:
            String(localized: "Tono couldn't block local network devices, so all traffic is blocked to keep you protected. Turn the setting off and on again, or reconnect.")
        case .helperTooOld:
            String(localized: "The network helper is too old to block local network devices. Reconnect to update it.")
        case .attemptsExhausted:
            String(localized: "Tono couldn't apply the local network devices setting. Reconnect to try again.")
        case nil:
            nil
        }
    }

    static func resetForTesting() {
        lock.withLock {
            desiredValue = nil
            pfValue = nil
            coreValue = nil
            attempts = 0
            faultValue = nil
            documents = []
        }
    }
}

extension AppState {
    /// The user changed "Allow local network devices". PF and the Core move
    /// together: one full reload arms PF with the new generation and installs
    /// a Core document built from it; a reload already running queues this
    /// one behind it. Disconnected, the next connect applies the setting.
    func localNetworkDevicesSettingChanged(_ allow: Bool) {
        let setting = LocalNetworkDevicesSync.settingChanged(allow)
        LocalTrafficAudit.shared.recordEvent(
            "local_network_devices_setting",
            details: ["enabled": String(allow), "generation": String(setting.generation)]
        )
        showLocalNetworkDevicesFault()
        if isConnected, !isDisconnecting { reloadCoreConfig() }
    }

    /// One bounded step of the health check toward PF and the Core both
    /// holding the setting (`LocalNetworkDevicesSync.takeAutomaticAttempt`).
    func convergeLocalNetworkDevices() {
        defer { showLocalNetworkDevicesFault() }
        guard isConnected, !isDisconnecting, switchingNodeId == nil,
              connectionCoordinator.configReloadTask == nil,
              LocalNetworkDevicesSync.takeAutomaticAttempt() else { return }
        let desired = LocalNetworkDevicesSync.desired
        LocalTrafficAudit.shared.recordEvent(
            "local_network_devices_converge",
            details: ["enabled": String(desired.allow), "generation": String(desired.generation)]
        )
        reloadCoreConfig()
    }

    /// A fault is an explicit error state: shown once in the banner and kept
    /// under the setting until the user acts or PF and the Core converge.
    func showLocalNetworkDevicesFault() {
        let message = LocalNetworkDevicesSync.faultMessage
        guard message != localNetworkDevicesFaultMessage else { return }
        localNetworkDevicesFaultMessage = message
        if let message { errorMessage = message }
    }
}
