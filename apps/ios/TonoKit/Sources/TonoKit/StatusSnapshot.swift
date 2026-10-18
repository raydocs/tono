import Foundation

/// The connection status other processes (widgets, the Control Center control, the Live Activity)
/// may show. Written to the App Group by the app (from NEVPNStatus and its exit checks) and by the
/// packet tunnel (start, stop, and a heartbeat while it runs); read with `StatusReading.read`,
/// which decides whether it is still fresh enough to state as current. A snapshot is never
/// invented: no file means "unavailable", an old one is shown as "last known".
public struct StatusSnapshot: Equatable, Sendable {
    public enum State: String, Sendable, CaseIterable {
        /// Signed in, tunnel down by choice.
        case off
        /// Starting, or reconnecting after a network change.
        case connecting
        case on
        /// Up, one exit check failed (matched traffic fails closed).
        case degraded
        /// Did not start, or stopped without the user.
        case failed
        /// No account on this phone: nothing can be switched on from outside the app.
        case signedOut

        public var tunnelUp: Bool { self == .on || self == .degraded }
        /// The switch reads on (Control Center, widget button).
        public var switchOn: Bool { self == .on || self == .degraded || self == .connecting }
    }

    public enum Writer: String, Sendable { case app, tunnel }

    public static let version = 1
    /// The tunnel refreshes its snapshot this often while it runs.
    public static let heartbeat: TimeInterval = 5 * 60
    /// Older than this, a snapshot is "last known", not "now" (three missed heartbeats).
    public static let freshFor: TimeInterval = 15 * 60

    public var state: State
    /// Display name of the cloud line in use ("Tokyo · Dawn"); nil when unknown.
    public var exit: String?
    /// When the tunnel came up (drives the "connected for" timer).
    public var since: Date?
    /// Short reason code for failed / degraded / connecting ("NETWORK_CHANGED", "CORE_STOPPED", …).
    public var reason: String?
    public var updatedAt: Date
    public var writer: Writer

    public init(state: State, exit: String? = nil, since: Date? = nil, reason: String? = nil, updatedAt: Date, writer: Writer) {
        self.state = state
        self.exit = exit
        self.since = since
        self.reason = reason
        self.updatedAt = updatedAt
        self.writer = writer
    }

    /// The app's view of a phase, as the shared state other processes read.
    public static func fromApp(_ phase: Phase, reason: String?, exit: String?, since: Date?, now: Date) -> StatusSnapshot {
        let state: State
        switch phase {
        case .signedOut: state = .signedOut
        case .idle, .needsPermission, .disconnecting: state = .off
        case .preparing, .connecting: state = .connecting
        case .connected: state = .on
        case .degraded: state = .degraded
        case .failed: state = .failed
        }
        return StatusSnapshot(state: state, exit: exit, since: state.tunnelUp ? since : nil,
                              reason: state == .off || state == .on ? nil : reason, updatedAt: now, writer: .app)
    }

    /// The tunnel's own write. While it runs it keeps the app's finer state (degraded, the exit
    /// name) for the same session and only refreshes the time; a stop always wins. `routing` is
    /// whether sing-box runs a graph: a live process without one is not a connection, so its
    /// heartbeat says failed (ROUTES_STOPPED), never on.
    public static func fromTunnel(running: Bool, routing: Bool = true, since: Date?, failure: String?,
                                  previous: StatusSnapshot?, now: Date) -> StatusSnapshot {
        guard running else {
            return StatusSnapshot(state: failure == nil ? .off : .failed, exit: previous?.exit, since: nil,
                                  reason: failure, updatedAt: now, writer: .tunnel)
        }
        guard routing else {
            return StatusSnapshot(state: .failed, exit: previous?.exit, since: nil, reason: "ROUTES_STOPPED",
                                  updatedAt: now, writer: .tunnel)
        }
        // Same session: the app's start time (iOS connectedDate) and the tunnel's own differ by the
        // time the start took, so they are compared within a minute.
        if let previous, previous.state.tunnelUp, let a = previous.since, let b = since, abs(a.timeIntervalSince(b)) < 60 {
            var kept = previous
            kept.updatedAt = now
            kept.writer = .tunnel
            return kept
        }
        return StatusSnapshot(state: .on, exit: previous?.exit, since: since, reason: nil, updatedAt: now, writer: .tunnel)
    }

    public func encoded() -> Data {
        var o = JSONObject()
        o["version"] = .int(Self.version)
        o["state"] = .string(state.rawValue)
        o["exit"] = exit.map(JSON.string) ?? .null
        o["since"] = since.map { JSON.number($0.timeIntervalSince1970) } ?? .null
        o["reason"] = reason.map(JSON.string) ?? .null
        o["updatedAt"] = .number(updatedAt.timeIntervalSince1970)
        o["writer"] = .string(writer.rawValue)
        return Data(JSON.object(o).serialized().utf8)
    }

    /// nil for anything unreadable or from another version: unreadable is "unavailable", not "off".
    public static func decode(_ data: Data) -> StatusSnapshot? {
        guard let json = try? JSON.parse(data), json["version"]?.int == version,
              let state = json["state"]?.string.flatMap(State.init(rawValue:)),
              case .number(let updated)? = json["updatedAt"],
              let writer = json["writer"]?.string.flatMap(Writer.init(rawValue:)) else { return nil }
        var since: Date?
        if case .number(let s)? = json["since"] { since = Date(timeIntervalSince1970: s) }
        return StatusSnapshot(state: state, exit: json["exit"]?.string, since: since, reason: json["reason"]?.string,
                              updatedAt: Date(timeIntervalSince1970: updated), writer: writer)
    }
}

/// What a widget or control may say about the tunnel at a given moment.
public enum StatusReading: Equatable, Sendable {
    /// Nothing reported yet (fresh install, App Group unreadable, file from another version).
    case unavailable
    /// Reported within `StatusSnapshot.freshFor`: shown as the current state.
    case fresh(StatusSnapshot)
    /// Older: shown as "last known at <time>", never as the current state.
    case stale(StatusSnapshot)

    public static func read(_ snapshot: StatusSnapshot?, now: Date) -> StatusReading {
        guard let snapshot else { return .unavailable }
        // A clock that moved backwards (or a file from the future) is not evidence of freshness.
        let age = now.timeIntervalSince(snapshot.updatedAt)
        guard age >= -60, age <= StatusSnapshot.freshFor else { return .stale(snapshot) }
        return .fresh(snapshot)
    }

    /// The moment a fresh reading turns stale, for a widget timeline entry.
    public static func staleAt(_ snapshot: StatusSnapshot) -> Date {
        snapshot.updatedAt.addingTimeInterval(StatusSnapshot.freshFor)
    }

    public var snapshot: StatusSnapshot? {
        switch self {
        case .unavailable: return nil
        case .fresh(let s), .stale(let s): return s
        }
    }

    /// The switch value a control may show: only a fresh reading says on.
    public var switchOn: Bool {
        if case .fresh(let s) = self { return s.state.switchOn }
        return false
    }
}

/// What a widget, Lock Screen accessory and the Control Center switch say for a reading: the title
/// (a localisation key), whether the switch reads on, and what their one button does. Kept here so
/// the path heartbeat → shared snapshot → widget wording is tested in one place.
public struct StatusWording: Equatable, Sendable {
    public enum Action: Equatable, Sendable { case connect, retry, disconnect, openApp }

    public let titleKey: String
    public let switchOn: Bool
    public let action: Action

    public init(titleKey: String, switchOn: Bool, action: Action) {
        self.titleKey = titleKey
        self.switchOn = switchOn
        self.action = action
    }

    public init(_ reading: StatusReading) {
        guard case .fresh(let s) = reading else {
            titleKey = reading.snapshot == nil ? "widget_unavailable_title" : "widget_stale_title"
            switchOn = false
            action = .openApp
            return
        }
        titleKey = Self.titleKey(s.state, reason: s.reason)
        switchOn = s.state.switchOn
        switch s.state {
        case .signedOut: action = .openApp
        case .failed: action = .retry
        default: action = s.state.switchOn ? .disconnect : .connect
        }
    }

    public static func titleKey(_ state: StatusSnapshot.State, reason: String?) -> String {
        switch state {
        case .on: return "state_connected"
        case .degraded: return "state_degraded"
        case .connecting: return reason == "NETWORK_CHANGED" ? "state_reconnecting" : "state_connecting"
        case .off: return "state_idle"
        case .failed:
            if reason == "CORE_STOPPED" { return "state_dropped" }
            if reason == "ROUTES_STOPPED" { return "state_routes_stopped" }
            return "state_failed"
        case .signedOut: return "state_signed_out"
        }
    }
}

/// The only commands a widget, Live Activity or Control Center control can send. They switch the
/// tunnel Tono already configured; nothing outside the app can sign in, change the catalog, the
/// line, the mode or the system protection options.
public enum TunnelCommandGate {
    public enum Refusal: String, Error, Sendable {
        /// No account on this phone.
        case signedOut
        /// The VPN configuration is missing or was never allowed; only the app may ask iOS for it.
        case needsPermission
        /// No admitted tunnel inputs yet (the app has not connected once since sign-in).
        case needsApp
    }

    /// Checks done before switching on. Switching off needs nothing: stopping is always allowed.
    public static func checkStart(signedIn: Bool, configured: Bool, hasInputs: Bool) -> Refusal? {
        if !signedIn { return .signedOut }
        if !configured { return .needsPermission }
        if !hasInputs { return .needsApp }
        return nil
    }
}
