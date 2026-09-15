import Foundation

enum ProtectionState: String, Codable, CaseIterable, Sendable {
    case ready, connecting, protected, recovering, paused, actionRequired

    var title: String {
        switch self {
        case .ready: "Ready"
        case .connecting: "Connecting"
        case .protected: "Protected"
        case .recovering: "Recovering"
        case .paused: "Paused"
        case .actionRequired: "Action Required"
        }
    }

    var detail: String {
        switch self {
        case .ready: "A private connection, when you're ready."
        case .connecting: "Establishing your private connection."
        case .protected: "Your connection is private."
        case .recovering: "Restoring your private connection."
        case .paused: "Protection is off until you resume."
        case .actionRequired: "Protection is not established. Review the details below."
        }
    }
}

enum Blocker: String, Codable, Error, Sendable {
    case coreUnavailable, catalogAdapterUnavailable, unsupportedPolicy
    case invalidPolicy, artifactMismatch, sessionExpired, serviceUnavailable
    case deviceLimit, invalidCode, keychainUnavailable, tunnelUnavailable
    case savedSessionCorrupt

    var message: String {
        switch self {
        case .coreUnavailable: "This build has no approved iOS sing-box library. Protection cannot start."
        case .catalogAdapterUnavailable: "The managed catalog needs an approved iOS adapter before locations can be used."
        case .unsupportedPolicy: "This account requires protection rules that this build cannot enforce."
        case .invalidPolicy: "Tono could not verify the current protection policy."
        case .artifactMismatch: "The networking library does not match the approved build identity."
        case .sessionExpired: "Your session has expired. Sign in again."
        case .serviceUnavailable: "Tono could not reach the account service. Try again."
        case .deviceLimit: "Your device allowance is full. Remove an old device from an already signed-in Tono app, then request a new code."
        case .invalidCode: "This code is invalid or expired. Request a new code."
        case .keychainUnavailable: "Secure storage is unavailable. Unlock this device and try again."
        case .savedSessionCorrupt: "Your saved sign-in is damaged. Forget it, then sign in again."
        case .tunnelUnavailable: "The VPN configuration could not be updated. Protection status is unknown."
        }
    }
}

/// Only a current extension receipt can establish Protected, never NEVPNStatus alone.
struct ProtectionMachine: Sendable {
    private(set) var generation = UUID()
    private(set) var state: ProtectionState = .ready
    private(set) var blocker: Blocker?
    private var lastObservation: Date?

    mutating func begin() -> UUID {
        generation = UUID()
        state = .connecting
        blocker = nil
        lastObservation = nil
        return generation
    }

    /// Reattach to a persisted authorized attempt, without trusting NEVPNStatus.
    mutating func observeExisting(_ generation: UUID) {
        self.generation = generation
        state = .recovering
        blocker = nil
        lastObservation = nil
    }

    mutating func receive(_ receipt: TunnelReceipt, now: Date = .now) {
        expire(now: now)
        guard [.connecting, .protected, .recovering].contains(state),
              receipt.version == TunnelReceipt.version,
              receipt.generation == generation,
              receipt.observedAt <= now,
              lastObservation.map({ receipt.observedAt > $0 }) ?? true,
              now.timeIntervalSince(receipt.observedAt) <= 10 else { return }
        if receipt.state == .actionRequired {
            fail(receipt.blocker ?? .tunnelUnavailable)
            return
        }
        if receipt.state == .protected {
            guard receipt.routesInstalled, receipt.dnsInstalled, receipt.coreRunning,
                  receipt.probeSucceeded, receipt.blocker == nil else {
                fail(.tunnelUnavailable)
                return
            }
        }
        lastObservation = receipt.observedAt
        state = receipt.state
        blocker = receipt.blocker
    }

    /// A silent extension exit must withdraw Protected even without another IPC
    /// message. Clock rollback also invalidates wall-clock receipts. Native code
    /// must call this on foreground entry and while displaying runtime health.
    mutating func expire(now: Date = .now) {
        guard state == .protected, let observed = lastObservation else { return }
        if observed > now || now.timeIntervalSince(observed) > 10 {
            // Foreground after suspension is missing evidence, not proof of a
            // failed tunnel. Preserve generation and replay fence for reobservation.
            state = .recovering
            blocker = .tunnelUnavailable
        }
    }

    mutating func fail(_ reason: Blocker) {
        generation = UUID() // a failed attempt cannot be revived by a queued success
        state = .actionRequired
        blocker = reason
        lastObservation = nil
    }
    mutating func pause() {
        generation = UUID() // invalidates queued start/probe callbacks
        state = .paused
        blocker = nil
        lastObservation = nil
    }
}

enum TunnelContract {
    static let appGroup = "group.com.ninx.tono"
    static let providerBundleID = "com.ninx.tono.PacketTunnel"
    static let protocolVersion = 1
}

struct TunnelRequest: Codable, Sendable {
    let version: Int
    let generation: UUID
    // Observation only. Start credentials/configuration never travel over provider messages.
    let command: Command
    enum Command: String, Codable { case status }
}

struct TunnelReceipt: Codable, Sendable {
    static let version = 1
    let version: Int
    let generation: UUID
    let observedAt: Date
    let state: ProtectionState
    let blocker: Blocker?
    let routesInstalled: Bool
    let dnsInstalled: Bool
    let coreRunning: Bool
    let probeSucceeded: Bool
}

/// Not a wire schema. Inputs must come from a verified, platform-admitted policy.
/// Current cloud routing does NOT supply an ordered backup list or fallback grant.
struct ResidentialRoutePlan: Sendable {
    enum Selection: Equatable, Sendable { case automatic, pinned(String) }
    enum Route: Equatable, Sendable { case residential(String), entry, blocked }
    let selection: Selection
    let orderedHomes: [String]
    let allowsEntryFallback: Bool
    let requiresHome: Bool
    private(set) var index = 0

    var current: Route {
        if case let .pinned(id) = selection {
            return index == 0 && orderedHomes.contains(id) ? .residential(id) : .blocked
        }
        if index < orderedHomes.count { return .residential(orderedHomes[index]) }
        return allowsEntryFallback && !requiresHome ? .entry : .blocked
    }

    mutating func failed() { index += 1 }
    // No timer/healthy-primary callback resets index: a working backup stays selected.
}
