import Foundation

/// The packet tunnel's part of the shared status, written only by the tunnel (start, stop, every
/// graph change, each status question and the heartbeat). It is the one routing fact other
/// processes may state as current, and `beatAt` is its age: only the tunnel renews it. A tunnel
/// process killed without its stop write (jetsam, a crash) leaves `running` true; nothing on disk
/// can tell that at once, so the claim lasts only until `beatAt` + `StatusSnapshot.freshFor`.
public struct TunnelReport: Equatable, Sendable {
    /// One packet-tunnel start (`TunnelGraph.session`).
    public var session: String
    /// When that start began: orders two starts' writes.
    public var opened: Date
    /// Bumped by every graph start, rebuild or close within the session.
    public var generation: Int
    /// The tunnel process is up; false once it stopped or failed to start.
    public var running: Bool
    /// The graph in use while running; nil: none runs.
    public var routing: RouteSettings?
    /// When the tunnel came up (drives the "connected for" timer).
    public var since: Date?
    /// Why it stopped, when it stopped on a failure.
    public var failure: String?
    public var beatAt: Date
    /// The digest of the catalog the graph in use was built from (`TunnelAnswer.catalog`); nil while
    /// none runs or in a file from before the field.
    public var catalog: String?

    public init(session: String, opened: Date, generation: Int, running: Bool, routing: RouteSettings?,
                since: Date?, failure: String?, beatAt: Date, catalog: String? = nil) {
        self.session = session
        self.opened = opened
        self.generation = generation
        self.running = running
        self.routing = routing
        self.since = since
        self.failure = failure
        self.beatAt = beatAt
        self.catalog = routing == nil ? nil : catalog
    }
}

/// The app's part of the shared status, written only by the app. It may say what the app knows
/// that is not a connection claim (signed out, off, starting, a failure Network Extension
/// reported, no confirmation yet) and may decorate the tunnel's confirmed graph (an exit check
/// failed, the display name of the line). It never makes a widget say connected on its own.
public struct AppNote: Equatable, Sendable {
    public enum State: String, Sendable, CaseIterable {
        case signedOut, off, connecting, failed
        /// The app's checks agree with the tunnel's graph / one of them failed. Decoration only.
        case up, degraded

        public init(_ phase: Phase) {
            switch phase {
            case .signedOut: self = .signedOut
            case .idle, .needsPermission, .disconnecting: self = .off
            case .preparing, .connecting: self = .connecting
            case .connected: self = .up
            case .degraded: self = .degraded
            case .failed: self = .failed
            }
        }

        var decorates: Bool { self == .up || self == .degraded }
    }

    public var state: State
    public var reason: String?
    /// The tunnel answer (start and graph) the app's state was derived from; nil when it had none.
    public var session: String?
    public var generation: Int?
    /// The catalog node `exit` names: the name is shown only while the tunnel runs that node.
    public var node: String?
    public var exit: String?
    public var writtenAt: Date
    /// The catalog `exit` was named from (the confirmed graph's, `AppStatus.catalog`): the name is
    /// shown only beside a tunnel report of the same catalog.
    public var catalog: String?

    public init(state: State, reason: String? = nil, session: String? = nil, generation: Int? = nil,
                node: String? = nil, exit: String? = nil, writtenAt: Date, catalog: String? = nil) {
        self.state = state
        self.reason = reason
        self.session = session
        self.generation = generation
        self.node = node
        self.exit = exit
        self.writtenAt = writtenAt
        self.catalog = catalog
    }

    /// The app's phase as a note. `answer` is the tunnel answer the phase was derived from (nil while
    /// the tunnel is down or unconfirmed); `line` the confirmed node and its display name.
    public init(_ phase: Phase, reason: String?, answer: TunnelAnswer?, line: (node: String, name: String)?, now: Date) {
        let state = State(phase)
        self.init(state: state, reason: state == .off || state == .up ? nil : reason, session: answer?.session,
                  generation: answer?.generation, node: line?.node, exit: line?.name, writtenAt: now, catalog: answer?.catalog)
    }
}

/// The App Group status file (`StatusFile`): the tunnel's report and the app's note, each written
/// only by its owner, read through `reading(now:)` by the widgets, the Control Center control and
/// the Live Activity. Version 2; an older file reads as unavailable until the next write.
public struct SharedStatus: Equatable, Sendable {
    public static let version = 2

    public var tunnel: TunnelReport?
    public var app: AppNote?

    public init(tunnel: TunnelReport? = nil, app: AppNote? = nil) {
        self.tunnel = tunnel
        self.app = app
    }

    // MARK: - Writes

    /// The tunnel's write; the app's note stays. nil (leave the file) for a report from an earlier
    /// start than the one on file (a stopping process finishing after a new one began), from an
    /// older graph of the same start, from an earlier moment of the same graph (a beat that lost the
    /// race to a later write), or one that says nothing new within a minute of the last.
    public func writingTunnel(_ report: TunnelReport) -> SharedStatus? {
        if let old = tunnel {
            if old.session == report.session {
                if report.generation < old.generation { return nil }
                if report.generation == old.generation, report.beatAt < old.beatAt { return nil }
                var same = report
                same.beatAt = old.beatAt
                if same == old, report.beatAt.timeIntervalSince(old.beatAt) < 60 { return nil }
            } else if old.opened > report.opened {
                return nil
            }
        }
        var next = self
        next.tunnel = report
        return next
    }

    /// The app's write; the tunnel's report stays (the app can neither renew nor replace it).
    public func writingApp(_ note: AppNote) -> SharedStatus? {
        guard note != app else { return nil }
        var next = self
        next.app = note
        return next
    }

    // MARK: - Reading

    /// What other processes may say now. Only a running tunnel report younger than `freshFor` makes
    /// a connection claim; the app's note can name its line, mark it degraded for the same graph, or
    /// override it with something less (off, failed, starting, unconfirmed) it learnt later.
    /// `AppStatus.resolve` takes the same report under the same rule, so the app and these surfaces
    /// agree once the app has written its note.
    public func reading(now: Date) -> StatusReading {
        if let note = app, !note.state.decorates, governs(note) {
            return StatusReading.read(StatusSnapshot(state: StatusSnapshot.State(note.state), reason: note.reason,
                                                     updatedAt: note.writtenAt, writer: .app), now: now)
        }
        guard let tunnel else { return .unavailable }
        var s: StatusSnapshot
        if !tunnel.running {
            s = StatusSnapshot(state: tunnel.failure == nil ? .off : .failed, reason: tunnel.failure, updatedAt: tunnel.beatAt, writer: .tunnel)
        } else if let routing = tunnel.routing {
            s = StatusSnapshot(state: .on, since: tunnel.since, updatedAt: tunnel.beatAt, writer: .tunnel)
            if let note = app, note.state == .degraded, note.session == tunnel.session, note.generation == tunnel.generation {
                s.state = .degraded
                s.reason = note.reason
            }
            // A name the app gave for another node, or from another catalog than the one the graph was
            // built from, is never shown in place of the one that runs.
            if let named = app, let node = named.node, node == routing.node,
               let catalog = tunnel.catalog, named.catalog == catalog { s.exit = named.exit }
        } else {
            // A live process without a graph is not a connection.
            s = StatusSnapshot(state: .failed, reason: "ROUTES_STOPPED", updatedAt: tunnel.beatAt, writer: .tunnel)
        }
        return StatusReading.read(s, now: now)
    }

    /// Whether a note that says less than connected speaks for later than the tunnel's report. A note
    /// about the same start is placed by graph, then by time; the app takes that start's later
    /// reports too (`ConfirmationTracker.observed`). Any other note (another start, or none the app
    /// heard from) yields only to a start opened after it, or to negative news written after it: a
    /// report the app could not tie to its session never turns its "not confirmed" into connected.
    /// Off and signed out are the user's intent: a start opened before them that reports it stopped
    /// or failed afterwards (the stop the user asked for) never turns them into a failure.
    private func governs(_ note: AppNote) -> Bool {
        guard let tunnel else { return true }
        let negative = !tunnel.running || tunnel.routing == nil
        if note.state == .off || note.state == .signedOut, negative, tunnel.opened <= note.writtenAt { return true }
        if let session = note.session, session == tunnel.session, let generation = note.generation {
            if generation != tunnel.generation { return generation > tunnel.generation }
            return note.writtenAt >= tunnel.beatAt
        }
        if tunnel.opened > note.writtenAt { return false }
        return !(negative && tunnel.beatAt > note.writtenAt)
    }

    // MARK: - Encoding

    public func encoded() -> Data {
        var o = JSONObject()
        o["version"] = .int(Self.version)
        if let t = tunnel {
            o["tunnel"] = JSON.obj(("session", .string(t.session)), ("opened", .number(t.opened.timeIntervalSince1970)),
                                   ("generation", .int(t.generation)), ("running", .bool(t.running)),
                                   ("routing", t.routing?.json ?? .null), ("since", Self.date(t.since)),
                                   ("failure", t.failure.map(JSON.string) ?? .null), ("beatAt", .number(t.beatAt.timeIntervalSince1970)),
                                   ("catalogDigest", t.catalog.map(JSON.string) ?? .null))
        }
        if let a = app {
            o["app"] = JSON.obj(("state", .string(a.state.rawValue)), ("reason", a.reason.map(JSON.string) ?? .null),
                                ("session", a.session.map(JSON.string) ?? .null), ("generation", a.generation.map(JSON.int) ?? .null),
                                ("node", a.node.map(JSON.string) ?? .null), ("exit", a.exit.map(JSON.string) ?? .null),
                                ("writtenAt", .number(a.writtenAt.timeIntervalSince1970)), ("catalogDigest", a.catalog.map(JSON.string) ?? .null))
        }
        return Data(JSON.object(o).serialized().utf8)
    }

    /// nil for anything unreadable or from another version: unreadable is "unavailable", not "off".
    public static func decode(_ data: Data) -> SharedStatus? {
        guard let json = try? JSON.parse(data), json["version"]?.int == version else { return nil }
        var status = SharedStatus()
        if let t = json["tunnel"], t != .null {
            guard let session = t["session"]?.string, let opened = number(t["opened"]), let generation = t["generation"]?.int,
                  let running = t["running"]?.bool, let beat = number(t["beatAt"]), let routingJSON = t["routing"] else { return nil }
            let routing = RouteSettings(routingJSON)
            guard routing != nil || routingJSON == .null, let catalog = TunnelAnswer.digest(t["catalogDigest"]) else { return nil }
            status.tunnel = TunnelReport(session: session, opened: Date(timeIntervalSince1970: opened), generation: generation,
                                         running: running, routing: routing, since: number(t["since"]).map(Date.init(timeIntervalSince1970:)),
                                         failure: t["failure"]?.string, beatAt: Date(timeIntervalSince1970: beat), catalog: catalog)
        }
        if let a = json["app"], a != .null {
            guard let state = a["state"]?.string.flatMap(AppNote.State.init(rawValue:)), let written = number(a["writtenAt"]),
                  let catalog = TunnelAnswer.digest(a["catalogDigest"]) else { return nil }
            status.app = AppNote(state: state, reason: a["reason"]?.string, session: a["session"]?.string,
                                 generation: a["generation"]?.int, node: a["node"]?.string, exit: a["exit"]?.string,
                                 writtenAt: Date(timeIntervalSince1970: written), catalog: catalog)
        }
        return status
    }

    private static func number(_ json: JSON?) -> Double? {
        if case .number(let d)? = json { return d }
        return nil
    }

    private static func date(_ date: Date?) -> JSON { date.map { JSON.number($0.timeIntervalSince1970) } ?? .null }
}

extension StatusSnapshot.State {
    /// A note's own claim, for the cases it may make one (decorations are not read through this).
    init(_ state: AppNote.State) {
        switch state {
        case .signedOut: self = .signedOut
        case .off: self = .off
        case .connecting: self = .connecting
        case .failed: self = .failed
        case .up: self = .on
        case .degraded: self = .degraded
        }
    }
}
