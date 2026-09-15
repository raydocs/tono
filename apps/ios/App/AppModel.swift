import Foundation
import Observation

@MainActor @Observable
final class AppModel {
    enum AccountRecovery: Equatable {
        case restoreSession, finishSignOut, forgetSavedSession

        var message: String {
            switch self {
            case .restoreSession: "Tono needs to check your saved session before signing you in. Check your connection and retry."
            case .finishSignOut: "Sign-out cleanup is incomplete. Unlock this device and retry before closing Tono."
            case .forgetSavedSession: "Your saved sign-in cannot be read. Forget it to sign in again with your email."
            }
        }

        var actionTitle: String {
            switch self {
            case .restoreSession: "Retry saved sign-in"
            case .finishSignOut: "Retry sign-out cleanup"
            case .forgetSavedSession: "Forget saved sign-in"
            }
        }
    }

    private let cloud: CloudClient
    private let tunnel: any TunnelControlling
    private let preferences: UserDefaults?
    private(set) var machine = ProtectionMachine()
    private(set) var user: CloudUser?
    private(set) var devices: [CloudDevice] = []
    private(set) var accountRecovery: AccountRecovery? = .restoreSession
    private(set) var busy = false
    var notice: String?
    var challenge: EmailChallenge?
    var challengeExpires: Date?
    var diagnostics = DiagnosticBuffer()
    let distribution: String?
    private(set) var diagnosticPolicy: DiagnosticPolicy
    private(set) var onDemand: Bool
    private(set) var paused: Bool
    private(set) var selectedLocation: String?
    private(set) var previewState: ProtectionState?
    var isPreview: Bool { previewState != nil }
    var state: ProtectionState { previewState ?? machine.state }
    var locationTitle: String { selectedLocation ?? "Automatic" }

    init(cloud: CloudClient? = nil, tunnel: (any TunnelControlling)? = nil,
         preferences defaults: UserDefaults? = UserDefaults(suiteName: TunnelContract.appGroup),
         distribution: String? = Bundle.main.object(forInfoDictionaryKey: "TonoDistribution") as? String) {
        self.cloud = cloud ?? CloudClient()
        self.tunnel = tunnel ?? TunnelController()
        self.preferences = defaults
        self.distribution = distribution
        onDemand = defaults?.object(forKey: "onDemand") as? Bool ?? true
        paused = defaults?.bool(forKey: "paused") ?? false
        selectedLocation = defaults?.string(forKey: "selectedLocation")
        let stored = defaults?.string(forKey: "diagnosticPolicy").flatMap(DiagnosticPolicy.init(rawValue:))
        // Production is a ceiling, including upgrades from a comprehensive TestFlight setting.
        diagnosticPolicy = .resolve(stored, distribution: distribution)
        #if DEBUG
        if let value = ProcessInfo.processInfo.environment["TONO_PREVIEW_STATE"],
           let state = ProtectionState(rawValue: value) { previewState = state }
        #endif
    }

    func setDiagnosticPolicy(_ requested: DiagnosticPolicy) {
        diagnosticPolicy = .resolve(requested, distribution: distribution)
        preferences?.set(diagnosticPolicy.rawValue, forKey: "diagnosticPolicy")
        diagnostics.clear() // do not retain comprehensive history after opt-down
    }

    func restore() async {
        guard !isPreview, !busy, user == nil else { return }
        await perform {
            accountRecovery = .restoreSession
            guard try cloud.restore() != nil else {
                accountRecovery = nil
                return
            }
            user = try await cloud.me()
            accountRecovery = nil // cached identity never substitutes for a successful /me
            if paused { machine.pause() } else { machine.fail(.coreUnavailable) }
        }
    }

    func retryAccountRecovery() async {
        switch accountRecovery {
        case .restoreSession: await restore()
        case .finishSignOut:
            await perform {
                _ = try cloud.finishPendingLogout()
                clearAccountState()
            }
        case .forgetSavedSession:
            await perform {
                try cloud.signOut()
                clearAccountState()
            }
        case nil: return
        }
    }

    func sendCode(email: String) async {
        await perform {
            challenge = nil
            challengeExpires = nil
            let result = try await cloud.start(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
            challenge = result
            challengeExpires = Date.now.addingTimeInterval(TimeInterval(result.expiresIn))
        }
    }

    func verifyCode(_ code: String) async {
        await perform {
            guard let challenge, let expiry = challengeExpires, expiry > .now else { throw Blocker.invalidCode }
            let result = try await cloud.verify(challenge: challenge.challengeId, code: code)
            user = result.user
            accountRecovery = nil
            self.challenge = nil
            challengeExpires = nil
            machine.fail(.coreUnavailable)
        }
    }

    func connect() async {
        guard !isPreview else { return }
        await perform {
            let generation = machine.begin()
            diagnostics.append(.init(kind: .stateChanged, state: .connecting), policy: diagnosticPolicy)
            try await tunnel.start(generation: generation, onDemand: onDemand)
            // A future implementation must observe current extension receipts, not set Protected here.
        }
    }

    func expireProtectionReceipt() {
        guard !isPreview else { return }
        machine.expire()
    }

    func pause() async {
        guard !isPreview else { return }
        await perform {
            try await tunnel.pause()
            paused = true
            preferences?.set(true, forKey: "paused")
            machine.pause()
            diagnostics.append(.init(kind: .pauseRequested, state: .paused), policy: diagnosticPolicy)
        }
    }

    func setOnDemand(_ wanted: Bool) async {
        if !wanted { await pause(); guard machine.state == .paused else { return } }
        onDemand = wanted
        preferences?.set(wanted, forKey: "onDemand")
    }

    func refreshLocations() async {
        guard !isPreview else { return }
        await perform {
            let policy = try await cloud.policy()
            _ = try PolicyAdmission.verify(policy, previousRevision: nil)
            let catalog = try await cloud.catalog()
            try PolicyAdmission.verifyCatalog(catalog)
        }
    }

    func refreshDevices() async {
        guard !isPreview else { return }
        await perform { devices = try await cloud.devices() }
    }

    func removeDevice(_ device: CloudDevice) async {
        await perform {
            try await cloud.revoke(device)
            devices = try await cloud.devices()
        }
    }

    func signOut() async {
        await perform {
            try await tunnel.pause()
            machine.pause()
            paused = true
            preferences?.set(true, forKey: "paused")
            try cloud.signOut()
            clearAccountState()
        }
    }

    private func clearAccountState() {
        user = nil
        devices = []
        accountRecovery = nil
        challenge = nil
        challengeExpires = nil
        selectedLocation = nil
        preferences?.removeObject(forKey: "selectedLocation")
        diagnostics.clear()
    }

    func uploadDiagnostics(userInitiated: Bool = true) async {
        guard !isPreview, !busy, user != nil, diagnosticPolicy != .off, !diagnostics.events.isEmpty else { return }
        await perform(showErrors: userInitiated) {
            let report = diagnostics.report(policy: diagnosticPolicy)
            guard let payload = try TelemetryPayload.encode(report, state: state) else { return }
            try await cloud.upload(payload)
            diagnostics.clear()
            if userInitiated { notice = "Diagnostics received by Tono." }
        }
    }

    #if DEBUG
    func preview(_ state: ProtectionState) { previewState = state }
    func selectPreviewLocation(_ name: String?) { selectedLocation = name }
    #endif

    private func perform(showErrors: Bool = true, _ operation: () async throws -> Void) async {
        guard !busy, !isPreview else { return }
        busy = true
        notice = nil
        let started = Date.now
        defer { busy = false }
        do { try await operation() }
        catch is CancellationError { return }
        catch {
            let blocker = error as? Blocker ?? .serviceUnavailable
            if blocker == .sessionExpired {
                clearAccountState() // RootView changes identity and exposes sign-in.
                machine.fail(.sessionExpired)
                notice = blocker.message // terminal auth loss is never a silent upload failure
                do { try cloud.invalidateTerminalSession() }
                catch {
                    accountRecovery = .finishSignOut
                    notice = Blocker.sessionExpired.message + " " + Blocker.keychainUnavailable.message
                        + " " + AccountRecovery.finishSignOut.message
                }
                return // do not retain account-scoped telemetry after authentication loss
            }
            if showErrors { notice = blocker.message }
            if cloud.logoutPending {
                clearAccountState()
                accountRecovery = .finishSignOut
                return
            }
            if blocker == .savedSessionCorrupt {
                clearAccountState()
                accountRecovery = .forgetSavedSession
                machine.fail(blocker)
                return
            }
            if machine.state == .connecting { machine.fail(blocker) }
            diagnostics.append(.init(kind: .admissionRefused, state: machine.state, blocker: blocker,
                                     elapsedSeconds: Int(Date.now.timeIntervalSince(started))), policy: diagnosticPolicy)
        }
    }
}

enum TelemetryPayload {
    /// Maps only allowlisted local values into the EXISTING /telemetry/windows contract.
    static func encode(_ report: DiagnosticReport, state: ProtectionState, now: Date = .now) throws -> Data? {
        let timestamp = Int64(max(0, now.timeIntervalSince1970) / 60) * 60_000
        // Drop stale/clock-skewed samples, never relabel their time as the upload time.
        let recent = report.events.filter { $0.observedAtMs <= timestamp && $0.observedAtMs >= timestamp - 21_600_000 }
        guard report.policy != .off, !recent.isEmpty,
              report.policy == .comprehensive || recent.contains(where: { $0.blocker != nil }) else { return nil }
        let events: [[String: Any]] = recent.map { event in
            var result: [String: Any] = ["ts": event.observedAtMs, "kind": event.kind.rawValue,
                                         "to": event.state.rawValue]
            if report.policy == .comprehensive { result["elapsedMs"] = event.elapsedBucket * 1000 }
            if let blocker = event.blocker { result["code"] = blocker.rawValue }
            return result
        }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let window: [String: Any] = [
            "schemaVersion": 1, "kind": "periodic_window", "windowStartMs": recent.map(\.observedAtMs).min() ?? timestamp,
            "windowEndMs": timestamp,
            "appVersion": "0.1.0", "osVersion": "iOS \(os.majorVersion).\(os.minorVersion)", "osArch": "arm64",
            "platform": "ios", "uiState": state.rawValue, "accountState": "signedIn",
            "eventCount": events.count, "eventsDropped": min(report.dropped + report.events.count - recent.count, 1_000_000), "events": events,
        ]
        return try JSONSerialization.data(withJSONObject: ["window": window], options: [.sortedKeys])
    }
}
