import Foundation

/// The failure the app shows and the user's switches in flight, kept together so the state-intent
/// rule (cross-platform state-intent rule) is decided in one testable place: what the tunnel
/// reports when it goes down is read against what the user asked for.
public struct TunnelIntentLedger: Equatable, Sendable {
    /// Last failure the user has not dismissed (app-side catalog failure or extension stop reason).
    public private(set) var failure: String?
    /// Set from "switch on" until the tunnel first reports connected; a stop in between is a start failure.
    public private(set) var userStarting = false
    /// The user (or sign-out) is stopping a tunnel that is up: its stop is expected, not a failure.
    public private(set) var userStopping = false
    /// The user's last explicit switch was off (Disconnect, Cancel, sign-out) and no session came up
    /// since: a stop the tunnel reports or recorded after it is the user's, never a failure.
    public private(set) var stoppedByUser = false

    public init() {}

    /// An app-side failure (catalog, account, a start the system refused).
    public mutating func fail(_ code: String) { failure = code }

    public mutating func clearFailure() { failure = nil }

    /// The user switched on: nothing an earlier session said is about this start.
    public mutating func userWantsOn() {
        failure = nil
        stoppedByUser = false
    }

    /// The start is handed to the system.
    public mutating func starting() { userStarting = true }

    /// The start ended before reaching the system (superseded, refused, declined).
    public mutating func startEnded() { userStarting = false }

    /// Explicit disconnect or Cancel. `tunnel` is Network Extension's status when the user pressed it.
    /// The user's own stop never shows a failure.
    public mutating func userStops(tunnel: TunnelStatus) {
        failure = nil
        userStarting = false
        userStopping = tunnel != .disconnected && tunnel != .invalid
        stoppedByUser = true
    }

    /// Sign-out takes the configuration away: its stop is expected.
    public mutating func signingOut() {
        userStarting = false
        userStopping = true
        stoppedByUser = true
    }

    /// Sign-out finished: nothing of the old account's session is shown.
    public mutating func signedOut() {
        failure = nil
        userStopping = false
    }

    /// Network Extension reported a status. Returns how a stop is classified when it went down
    /// (nil for any other status).
    @discardableResult
    public mutating func tunnel(_ status: TunnelStatus, before: TunnelStatus, recordedFailure: String?) -> TunnelStop? {
        switch status {
        case .connected:
            // A session is up again (the user's start, On Demand after a crash or jetsam, an outside
            // command): what stopped an earlier one no longer describes anything.
            userStarting = false
            failure = nil
            stoppedByUser = false
            return nil
        case .connecting:
            // A start the user did not make here (Control Center, Settings, On Demand): the earlier
            // stop is no longer the user's last word, so this start's failure is shown.
            if !userStopping { stoppedByUser = false }
            return nil
        case .disconnected, .invalid:
            var stop = TunnelStop.classify(before: before, userStarting: userStarting,
                                           userStopping: userStopping || stoppedByUser,
                                           recordedFailure: recordedFailure)
            // That outside start never connected and the tunnel recorded why. On Demand stays as it
            // is (`stoppedBySystem`): this app did not arm it.
            if stop == .expected, before == .connecting, !userStopping, !stoppedByUser, let recordedFailure {
                stop = .stoppedBySystem(recordedFailure)
            }
            switch stop {
            case .startFailed(let code), .stoppedBySystem(let code): failure = code
            case .expected: break
            }
            userStarting = false
            userStopping = false
            return stop
        default:
            return nil
        }
    }

    /// Back in the foreground: a failure the tunnel recorded while the app was away is shown when the
    /// tunnel is down and nothing else is. Returns whether the failure changed.
    @discardableResult
    public mutating func foreground(tunnel: TunnelStatus, recordedFailure: String?) -> Bool {
        guard !tunnel.isUp, let recordedFailure, failure == nil, !userStopping, !stoppedByUser else { return false }
        failure = recordedFailure
        return true
    }
}
